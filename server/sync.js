'use strict';
// Общее состояние фирмы на сервере. Оно целиком в памяти (тот же объект, что S прототипа, без личного), грузится из
// таблицы docs при старте и пишется документами в одной транзакции на пачку. Правки идут по одной — гонок нет.
// Каждой вкладке (view) сервер помнит, что уже отдал, и на /api/sync шлёт разницу: новое, изменённое, исчезнувшее.
// Пачка изменений: видимость записи, трёхстороннее слияние каждой правки (Docs.merge) в копии человека (Visible.of) и
// наложение итога на настоящую запись (скрытое от него остаётся настоящим), проверка прав (Guard)
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

  // Документ в копии человека (Visible.of): то, что ему отдано, — урезанное («hidden», без цен) или null, если не видно
  function viewOf(vis, key, id) {
    if (key === 'products') {
      const p = (vis.products || []).find(x => x && String(x.id) === id);
      return p ? plainOf(core.Store.plain(p)) : null;
    }
    return plainOf(Docs.get(vis, key, id));
  }

  // Наложить правку человека на настоящую запись. v — его урезанная версия, r — его итог слияния (тоже урезанный),
  // f — настоящая запись. Где у человека ничего не вырезано (v = f) — берётся r; где он не трогал (v = r) — f.
  // Вырезанное место, которое человек поменял (вписал сумму, заменил «hidden»), остаётся настоящим: r со скрытым
  // значением не сравнивается никогда, поэтому ответ не зависит от того, угадал ли человек.
  function overlay(v, r, f) {
    if (Docs.same(v, f)) return r;
    if (Docs.same(v, r)) return f;
    if (r === undefined || r === null) return r;
    const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
    if (isObj(v) && isObj(r) && isObj(f)) {
      const out = {};
      for (const k of new Set([...Object.keys(r), ...Object.keys(f), ...Object.keys(v)])) {
        const x = overlay(v[k], r[k], f[k]);
        if (x !== undefined) out[k] = x;
      }
      return out;
    }
    if (Array.isArray(v) && Array.isArray(r) && Array.isArray(f)) return overlayList(v, r, f);
    return f;
  }
  // Списки внутри записи. Записи с id — по id (чего человеку не показали, остаётся). Без id (строки сделки) Visible.of
  // длину не меняет: строка человека, равная его прежней, берёт настоящую с того же места; изменённая — с того же
  // индекса; остальные — новые, как есть.
  function overlayList(v, r, f) {
    const hasId = x => x !== null && typeof x === 'object' && x.id !== undefined && x.id !== null && x.id !== '';
    if ([v, r, f].every(list => list.every(hasId))) {
      const get = (list, id) => list.find(x => String(x.id) === id);
      const out = r.map(x => overlay(get(v, String(x.id)), x, get(f, String(x.id))));
      for (const x of f) if (!get(v, String(x.id)) && !get(r, String(x.id))) out.push(x);
      return out;
    }
    if (v.length !== f.length) return f;
    const used = new Array(v.length).fill(false), pair = r.map(() => -1);
    let from = 0;
    r.forEach((x, i) => {
      for (let k = from; k < v.length; k++) if (!used[k] && Docs.same(x, v[k])) { pair[i] = k; used[k] = true; from = k + 1; return; }
    });
    r.forEach((x, i) => { if (pair[i] < 0 && i < v.length && !used[i]) { pair[i] = i; used[i] = true; } });
    return r.map((x, i) => (pair[i] < 0 ? x : overlay(v[pair[i]], x, f[pair[i]])));
  }

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

  // Каскад объединения клиентов: уведомления на удалённого клиента, которых человек не видит (они чужие), тоже ссылаются
  // теперь на первого — иначе «Открыть» вело бы в пустоту. Видимые ему уведомления он переводит сам, в своей пачке.
  function cascadeMerge(list) {
    const merged = core.Guard.merges(st, list), out = [];
    if (!merged.size) return out;
    for (const n of st.notes || []) {
      const keep = n.ref && n.ref.t === 'client' ? merged.get(String(n.ref.id)) : undefined;
      if (!keep || list.some(x => x.key === 'notes' && String(x.id) === String(n.id))) continue;
      const cur = current('notes', String(n.id));
      out.push({ key: 'notes', id: String(n.id), base: cur, data: { ...cur, ref: { t: 'client', id: keep } }, op: 'cascade' });
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
    let vis = null;
    for (const c of changes) {
      if (!c || typeof c !== 'object' || typeof c.key !== 'string' || !KEY_RE.test(c.key) || BAD_KEYS.has(c.key)) return bad(400, 'Неверная запись в пачке');
      const id = c.id === undefined || c.id === null ? '' : String(c.id);
      if (id.length > 200) return bad(400, 'Неверная запись в пачке');
      const mine = c.deleted ? null : c.data;
      if (mine === undefined) return bad(400, 'Неверная запись в пачке');
      const base = c.base === undefined ? null : c.base;
      const theirs = current(c.key, id);
      // Видимость — до любого сравнения с настоящей записью. Существующая запись правится, только если она есть в копии
      // человека (Visible.of); несуществующую (и удалённую) можно только завести: правка или удаление её — тот же отказ,
      // что у невидимой, без имени удалившего.
      if (theirs === null && (base !== null || mine === null)) return bad(403, 'Нет прав: править эту запись', { key: c.key, id });
      let view = null;
      if (theirs !== null) {
        if (!vis) vis = core.Visible.of(st, ses.personId);
        view = viewOf(vis, c.key, id);
        if (view === null) return bad(403, 'Нет прав: править эту запись', { key: c.key, id });
      }
      // Слияние — в копии человека: его основа, его правка и его урезанная версия текущей записи
      const r = Docs.merge(base, mine, view);
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
      const merged = r.value === undefined ? null : r.value;
      if (Docs.same(merged, view)) continue;
      // Итог человека — на настоящую запись: вырезанное для него остаётся настоящим
      const value = merged === null || theirs === null ? merged : overlay(view, merged, theirs);
      if (Docs.same(value, theirs)) continue;
      list.push(value === null ? { key: c.key, id, base: theirs, deleted: true } : { key: c.key, id, base: theirs, data: value });
    }
    if (list.length) {
      const refusal = core.Guard.check(st, ses.personId, list, new Date(now()));
      if (refusal) return bad(403, refusal.text, { key: refusal.key, id: refusal.id });
      const fileRefusal = files.checkRefs(list, ses.personId, canSee(ses.personId));
      if (fileRefusal) return bad(403, fileRefusal.text, { key: fileRefusal.key, id: fileRefusal.id });
      commit([...list, ...cascade(list), ...cascadeMerge(list)], ses.personId);
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
