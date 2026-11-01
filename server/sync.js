'use strict';
// Общее состояние фирмы на сервере. Оно целиком в памяти (тот же объект, что S прототипа, без личного), грузится из
// таблицы docs при старте и пишется документами в одной транзакции на пачку. Правки идут по одной — гонок нет.
// Каждой вкладке (view) сервер помнит, что уже отдал, и на /api/sync шлёт разницу: новое, изменённое, исчезнувшее.
// Пачка изменений: трёхстороннее слияние каждой правки (Docs.merge) с тем, что лежит у сервера, проверка прав (Guard)
// и ссылок на файлы, каскад названия клиента, запись всего или ничего, строка журнала на каждую запись.

const crypto = require('node:crypto');

// Номера, которые выдаёт сервер (R03.1): откуда брать занятые, с какого числа начинать, сколько цифр
const NUMBERED = {
  'Д-': { taken: st => (st.deals || []).map(d => d.id), min: 300 },
  'Л-': { taken: st => (st.leads || []).map(l => l.id), min: 100 },
  'К-': { taken: st => (st.clients || []).map(c => c.id), min: 0 },
  'П-': { taken: st => (st.shipments || []).filter(s => s.dir === 'in').map(s => s.id), min: 0 },
  'ОТ-': { taken: st => (st.dispatches || []).map(d => d.number), min: 0, pad: 3 },
};
const KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const VIEW_IDLE_MS = 6 * 3600e3;
const VIEWS_PER_SESSION = 20;
const BATCH_MAX = 5000;

function createSync({ store, core, now, files, onSeq }) {
  const { Docs } = core;
  let st = null;
  let seq = 0;
  const views = new Map();

  function load() {
    const docs = {};
    for (const r of store.docs.all()) docs[Docs.docId(r.key, r.id)] = JSON.parse(r.data);
    st = Docs.join(docs);
    seq = store.meta.num('seq');
  }
  // Новая база: структура seedBase() без демо и без людей
  function init() {
    const base = core.seedBase();
    const docs = Docs.split(base);
    store.tx(() => {
      for (const d of Object.keys(docs)) {
        const { key, id } = Docs.parse(d);
        store.docs.put(key, id, JSON.stringify(docs[d]), 0);
      }
      store.meta.set('seq', 0);
      store.meta.set('rev', core.Store.REV);
    });
  }
  // Базу правили мимо этого процесса (командой server/admin.js) — перечитать
  function fresh() { if (store.meta.num('seq') !== seq) load(); }

  // ——— номера ———
  function maxTaken(prefix) {
    const cfg = NUMBERED[prefix];
    let n = cfg.min;
    for (const x of cfg.taken(st)) {
      const s = String(x || '');
      if (s.startsWith(prefix)) { const v = parseInt(s.slice(prefix.length), 10); if (v > n) n = v; }
    }
    return n;
  }
  const format = (prefix, n) => prefix + (NUMBERED[prefix].pad ? String(n).padStart(NUMBERED[prefix].pad, '0') : String(n));
  // n следующих номеров по возрастанию; счётчик в базе — номер не повторится и после перезапуска
  function takeIds(prefix, n = 1) {
    if (!Object.hasOwn(NUMBERED, prefix)) return null;
    const count = Math.max(1, Math.min(20, Math.floor(Number(n)) || 1));
    const from = Math.max(store.meta.num('ids:' + prefix), maxTaken(prefix));
    store.meta.set('ids:' + prefix, from + count);
    return Array.from({ length: count }, (_, i) => format(prefix, from + i + 1));
  }
  const pools = () => Object.fromEntries(Object.keys(NUMBERED).map(p => [p, takeIds(p, 5)]));
  // Внутренние id, которые создаёт сам сервер (уведомления по времени): метка 's' — у вкладок метки 'k…'
  core.Ids.use(prefix => (Object.hasOwn(NUMBERED, prefix) ? takeIds(prefix, 1)[0] : (() => {
    const n = store.meta.num('ids:srv') + 1;
    store.meta.set('ids:srv', n);
    return prefix + 's' + n;
  })()));

  // ——— что видит человек ———
  const personOf = pid => (st.people || []).find(p => p.id === pid) || null;
  const nameOf = pid => (personOf(pid) || {}).name || 'нет данных: кто';
  function visibleDocs(pid) {
    const vis = core.Visible.of(st, pid);
    return { vis, docs: Docs.split(vis) };
  }
  const canSee = pid => (key, docId) => core.Visible.canSee(st, pid, key, docId);

  function newView(ses) {
    const mine = [...views.entries()].filter(([, v]) => v.session === ses.tokenHash).sort((a, b) => a[1].used - b[1].used);
    while (mine.length >= VIEWS_PER_SESSION) views.delete(mine.shift()[0]);
    const id = crypto.randomBytes(9).toString('base64url');
    const v = { session: ses.tokenHash, personId: ses.personId, sent: new Map(), used: now() };
    views.set(id, v);
    return [id, v];
  }
  const remember = (v, docs) => { v.sent = new Map(Object.keys(docs).map(d => [d, JSON.stringify(docs[d])])); v.used = now(); };

  // GET /api/state: всё, что видно человеку, и новая вкладка
  function stateFor(ses) {
    fresh();
    const { vis, docs } = visibleDocs(ses.personId);
    const [id, v] = newView(ses);
    remember(v, docs);
    return { seq, view: id, state: core.Store.plain(vis), ids: pools() };
  }
  // GET /api/sync: разница с тем, что вкладка уже получила. Вкладку забыли (перезапуск) — всё заново, full: true.
  function syncFor(ses, viewId) {
    fresh();
    const { docs } = visibleDocs(ses.personId);
    const v = views.get(viewId);
    if (!v || v.session !== ses.tokenHash) {
      const [id, nv] = newView(ses);
      remember(nv, docs);
      return { seq, view: id, full: true, docs: Object.keys(docs).map(d => ({ ...Docs.parse(d), data: docs[d] })), gone: [] };
    }
    const out = [], gone = [];
    for (const d of Object.keys(docs)) {
      const text = JSON.stringify(docs[d]);
      if (v.sent.get(d) !== text) { out.push({ ...Docs.parse(d), data: docs[d] }); v.sent.set(d, text); }
    }
    for (const d of [...v.sent.keys()]) if (!(d in docs)) { gone.push(Docs.parse(d)); v.sent.delete(d); }
    v.used = now();
    return { seq, view: viewId, docs: out, gone };
  }

  // ——— пачка изменений ———
  const plainOf = v => (v === undefined || v === null ? null : JSON.parse(JSON.stringify(v)));
  // Что лежит у сервера: документ или null. Товар снимка каталога без правок — его запись снимка.
  function current(key, id) {
    if (key === 'products') {
      const p = (st.products || []).find(x => x && String(x.id) === id);
      return p ? plainOf(core.Store.plain(p)) : null;
    }
    return plainOf(Docs.get(st, key, id));
  }
  const bad = (status, error, extra) => ({ status, body: { error, ...extra } });

  // Каскад: новое название клиента — во все его сделки, и в те, что правящему не видны (Clients.update делает это в
  // копии браузера только для видимых)
  function cascade(list) {
    const out = [];
    for (const c of list) {
      if (c.key !== 'clients' || c.deleted || !c.data) continue;
      const name = c.data.name;
      for (const d of st.deals || []) {
        if (d.clientId !== c.id || d.client === name) continue;
        if (list.some(x => x.key === 'deals' && x.id === d.id)) {
          const x = list.find(y => y.key === 'deals' && y.id === d.id);
          if (x.data && x.data.client !== name) x.data = { ...x.data, client: name };
          continue;
        }
        const cur = current('deals', d.id);
        out.push({ key: 'deals', id: d.id, base: cur, data: { ...cur, client: name }, op: 'cascade' });
      }
    }
    return out;
  }

  // Записать пачку (уже проверенную): документы, ссылки на файлы, журнал, seq — одной транзакцией
  function commit(list, personId) {
    const at = now();
    let next = seq + 1, stale = false;
    store.tx(() => {
      // базу мог поменять другой процесс (server/admin.js) — номер правки берётся после него, состояние перечитывается
      const dbSeq = store.meta.num('seq');
      if (dbSeq !== seq) { stale = true; next = Math.max(seq, dbSeq) + 1; }
      for (const c of list) {
        const id = String(c.id);
        if (c.deleted) store.docs.del(c.key, id); else store.docs.put(c.key, id, JSON.stringify(c.data), next);
        files.refresh(c.key, id, c.deleted ? null : c.data);
        store.log.add(next, at, personId, c.key, id, c.op || (c.deleted ? 'delete' : c.base === null ? 'add' : 'edit'));
      }
      store.meta.set('seq', next);
    });
    if (stale) load();
    else st = Docs.apply(st, list.map(({ key, id, base, data, deleted }) => (deleted ? { key, id, base, deleted } : { key, id, base, data })));
    seq = next;
    if (onSeq) onSeq(seq);
  }

  // POST /api/changes
  function apply(ses, viewId, changes) {
    if (!Array.isArray(changes)) return bad(400, 'Нет списка изменений');
    if (changes.length > BATCH_MAX) return bad(413, 'Слишком большая пачка изменений');
    fresh();
    const list = [];
    for (const c of changes) {
      if (!c || typeof c !== 'object' || typeof c.key !== 'string' || !KEY_RE.test(c.key) || BAD_KEYS.has(c.key)) return bad(400, 'Неверная запись в пачке');
      const id = c.id === undefined || c.id === null ? '' : String(c.id);
      if (id.length > 200) return bad(400, 'Неверная запись в пачке');
      const mine = c.deleted ? null : c.data;
      if (mine === undefined) return bad(400, 'Неверная запись в пачке');
      const theirs = current(c.key, id);
      const r = Docs.merge(c.base === undefined ? null : c.base, mine, theirs);
      if (!r.ok && theirs !== null && !core.Visible.canSee(st, ses.personId, c.key, id)) return bad(403, 'Нет прав: править эту запись', { key: c.key, id });
      if (!r.ok) {
        const who = store.log.lastBy(c.key, id);
        const by = who ? nameOf(who) : 'нет данных: кто';
        const fresh2 = viewId ? syncFor(ses, viewId) : null;
        return {
          status: 409,
          body: {
            error: `Пока ты правил, запись изменил(а) ${by} — показана свежая версия, повтори`, key: c.key, id, by,
            ...(fresh2 ? { seq: fresh2.seq, view: fresh2.view, docs: fresh2.docs, gone: fresh2.gone, full: fresh2.full } : { docs: [] }),
          },
        };
      }
      const value = r.value === undefined ? null : r.value;
      if (Docs.same(value, theirs)) continue;
      list.push(value === null ? { key: c.key, id, base: theirs, deleted: true } : { key: c.key, id, base: theirs, data: value });
    }
    if (list.length) {
      const refusal = core.Guard.check(st, ses.personId, list, new Date(now()));
      if (refusal) return bad(403, refusal.text, { key: refusal.key, id: refusal.id });
      const fileRefusal = files.checkRefs(list, ses.personId, canSee(ses.personId));
      if (fileRefusal) return bad(403, fileRefusal.text, { key: fileRefusal.key, id: fileRefusal.id });
      commit([...list, ...cascade(list)], ses.personId);
    }
    const out = viewId ? syncFor(ses, viewId) : { seq, docs: [], gone: [] };
    return { status: 200, body: out };
  }

  // Правка от самого сервера (уведомления по времени, заведение директора): fn меняет рабочую копию состояния
  function system(fn, personId = null) {
    fresh();
    const work = Docs.join(JSON.parse(JSON.stringify(Docs.split(st))));
    const result = fn(work);
    const changes = Docs.diff(Docs.split(st), Docs.split(work));
    if (changes.length) commit(changes.map(c => ({ ...c, base: c.base === undefined ? null : c.base })), personId);
    return result;
  }

  // Обслуживание вкладок: забыть неиспользуемые и вкладки закрытых сеансов
  function sweepViews(closed = []) {
    const t = now(), gone = new Set(closed);
    for (const [id, v] of views) if (t - v.used > VIEW_IDLE_MS || gone.has(v.session)) views.delete(id);
  }

  return {
    get state() { return st; },
    get seq() { return seq; },
    load, init, fresh, stateFor, syncFor, apply, system, takeIds, personOf, canSee, sweepViews, NUMBERED,
  };
}

// Первый запуск: база пустая → seedBase()
function isEmpty(store) { return store.meta.get('rev') === null && store.docs.count() === 0; }

module.exports = { createSync, isEmpty, NUMBERED };
