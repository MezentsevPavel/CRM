// Ядро общей базы: состояние режется на документы и собирается обратно (Docs), номера записей берутся у поставщика (Ids).
// Без DOM и сети: сервер и браузер зовут одни и те же функции. Документ — запись списка (ключ + id), строка остатков
// товара (stock/aside по id товара) или целый ключ (id ''). Значение документа — чистый JSON: даты как {$date: ISO}.

// ——— номера ———
// Поставщик номеров: в демо его нет — номера считает сам код по списку; в серверном режиме (72-server.js) номер выдаёт
// сервер, и два человека не получат один «Д-…». fn(prefix) → номер целиком ('Д-512', 'mv1840') или null — тогда как в демо.
const Ids = (() => {
  let supplier = null;
  function use(fn) { supplier = typeof fn === 'function' ? fn : null; }
  function next(prefix, fallback) {
    const got = supplier ? supplier(prefix) : null;
    return got === null || got === undefined || got === '' ? fallback() : String(got);
  }
  return { use, next };
})();

// ——— документы ———
const Docs = (() => {
  const SEP = '\u0001';
  // Классификация ключей верхнего уровня S. Новый ключ состояния обязан попасть сюда: тест сверяет с seed().
  const KEYS = {
    // массивы записей с id: документ — запись
    ARRAY: ['products', 'moves', 'reserves', 'shipments', 'shipRules', 'deals', 'leads', 'clients', 'feed', 'acts', 'tasks', 'msgs',
      'notes', 'dispatches', 'pipelines', 'depts', 'entities', 'cities', 'roles', 'people', 'rules', 'lostReasons'],
    // по id товара: документ — строка остатков (stock) или отложенного (aside) одного товара
    MAP: ['stock', 'aside'],
    // целиком одним документом с id ''
    WHOLE: ['mail', 'leadSource', 'leadWaitMin', 'tpl', 'address', 'prefs', 'stockSheet'],
    // личное: на сервер не уходит никогда
    LOCAL: ['me', 'view', 'ui', 'rcv', 'v'],
    // личные поля внутри prefs: тема и вид карты поставок
    LOCAL_PREFS: ['theme', 'ship'],
  };
  const kind = key => ['ARRAY', 'MAP', 'WHOLE', 'LOCAL'].find(c => KEYS[c].includes(key)) || null;
  const docId = (key, id) => key + SEP + (id === undefined || id === null ? '' : id);
  const parse = d => { const i = d.indexOf(SEP); return { key: d.slice(0, i), id: d.slice(i + 1) }; };
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const live = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v), Store.revive));

  // Равенство значений документа: объекты — по полям в любом порядке, массивы — по порядку
  function same(a, b) {
    if (a === b) return true;
    if (Array.isArray(a) || Array.isArray(b)) {
      return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i]));
    }
    if (!isObj(a) || !isObj(b)) return false;
    const ka = Object.keys(a).filter(k => a[k] !== undefined), kb = Object.keys(b).filter(k => b[k] !== undefined);
    return ka.length === kb.length && ka.every(k => same(a[k], b[k]));
  }

  // Общая часть prefs: всё, кроме личных полей
  function sharedPrefs(p) {
    const o = { ...(p || {}) };
    for (const k of KEYS.LOCAL_PREFS) delete o[k];
    return o;
  }

  // Товары — как в Catalog.pack: нетронутый товар снимка каталога документом не идёт (он константа файла), правленый —
  // документом с полной записью, снятый из списка — документом null; товары, добавленные руками, — документами как есть.
  function splitProducts(products, docs) {
    const packed = Catalog.pack(products);
    if (!packed) { for (const p of products || []) docs[docId('products', p.id)] = Store.plain(p); return; }
    const own = new Set(packed.products), edited = new Set(Object.keys(packed.productEdits || {}));
    for (const p of products) if (own.has(p) || edited.has(p.id)) docs[docId('products', p.id)] = Store.plain(p);
    for (const id of packed.productsRemoved || []) docs[docId('products', id)] = null;
  }

  // Состояние → { 'key\u0001id': value }. Личное (LOCAL, prefs.theme, prefs.ship) не идёт. Ключ вне классификации
  // идёт целиком: данные не теряются, а права на него — только у admin (Guard).
  function split(st) {
    const docs = {};
    for (const key of Object.keys(st || {})) {
      const k = kind(key), v = st[key];
      if (k === 'LOCAL' || v === undefined) continue;
      if (key === 'products') { splitProducts(v, docs); continue; }
      if (k === 'ARRAY') {
        for (const r of v || []) {
          if (!r || r.id === undefined || r.id === null || r.id === '') throw new Error(`Docs.split: запись без id в «${key}»`);
          docs[docId(key, r.id)] = Store.plain(r);
        }
      } else if (k === 'MAP') {
        for (const id of Object.keys(v || {})) docs[docId(key, id)] = Store.plain(v[id]);
      } else {
        docs[docId(key, '')] = Store.plain(key === 'prefs' ? sharedPrefs(v) : v);
      }
    }
    return docs;
  }

  // Номер в конце id (n12 → 12): при равном времени новее запись с большим номером
  const tail = id => { const m = /(\d+)$/.exec(String(id)); return m ? +m[1] : -1; };
  const atOf = r => { const t = r && r.at ? new Date(r.at).getTime() : NaN; return isNaN(t) ? -Infinity : t; };
  // уведомления и журнал склада — новые сверху, в каком бы порядке ни пришли документы
  const NEWEST_FIRST = ['notes', 'moves'];

  // Документы → состояние. into — состояние, в которое собрать: его личное (LOCAL, prefs.theme, prefs.ship) остаётся,
  // общее заменяется целиком. Записи списков — в порядке документов; товары снимка — сначала, как в Catalog.unpack.
  function join(docs, into) {
    const st = into || {};
    const localPrefs = {};
    for (const k of KEYS.LOCAL_PREFS) if (st.prefs && st.prefs[k] !== undefined) localPrefs[k] = st.prefs[k];
    for (const key of Object.keys(st)) if (kind(key) !== 'LOCAL') delete st[key];
    for (const key of KEYS.ARRAY) st[key] = [];
    for (const key of KEYS.MAP) st[key] = {};
    const prods = new Map();
    for (const d of Object.keys(docs || {})) {
      const { key, id } = parse(d), v = docs[d];
      if (key === 'products') { prods.set(id, v); continue; }
      const k = kind(key);
      if (k === 'ARRAY') { if (v !== null && v !== undefined) st[key].push(live(v)); }
      else if (k === 'MAP') { if (v !== null && v !== undefined) st[key][id] = live(v); }
      else if (k !== 'LOCAL') st[key] = live(v);
    }
    // товары: снимок каталога с правками и без снятых, затем свои
    const base = Catalog.base();
    for (const p of base.products) {
      if (!prods.has(p.id)) st.products.push({ ...p });
      else if (prods.get(p.id) !== null) st.products.push(live(prods.get(p.id)));
    }
    for (const [id, v] of prods) if (!base.byId.has(id) && v !== null && v !== undefined) st.products.push(live(v));
    for (const key of NEWEST_FIRST) {
      st[key] = st[key].map((r, i) => [r, i]).sort((a, b) => atOf(b[0]) - atOf(a[0]) || tail(b[0].id) - tail(a[0].id) || a[1] - b[1]).map(x => x[0]);
    }
    if (st.prefs || Object.keys(localPrefs).length) st.prefs = { ...(st.prefs || {}), ...localPrefs };
    return st;
  }

  // Прежнее значение документа, которого не было среди документов: у товара снимка — его запись из снимка
  function snapBase(key, id) {
    if (key !== 'products') return null;
    const p = Catalog.base().byId.get(id);
    return p ? Store.plain(p) : null;
  }

  // Что изменилось между двумя наборами документов: [{key, id, base, data}] — новые и изменённые,
  // [{key, id, base, deleted: true}] — удалённые. base — прежнее значение, у новой записи null.
  function diff(baseDocs, curDocs) {
    const out = [], b = baseDocs || {}, c = curDocs || {};
    for (const d of Object.keys(c)) {
      const { key, id } = parse(d);
      if (!(d in b)) {
        const prev = snapBase(key, id);
        if (!same(prev, c[d])) out.push({ key, id, base: prev, data: c[d] });
      } else if (!same(b[d], c[d])) out.push({ key, id, base: b[d], data: c[d] });
    }
    for (const d of Object.keys(b)) if (!(d in c)) { const { key, id } = parse(d); out.push({ key, id, base: b[d], deleted: true }); }
    return out;
  }

  const hasId = x => isObj(x) && x.id !== undefined && x.id !== null && x.id !== '';
  const byIdList = list => list.every(hasId) && new Set(list.map(x => String(x.id))).size === list.length;
  const isPrefix = (p, list) => p.length <= list.length && p.every((x, i) => same(x, list[i]));
  const at = (path, k) => (path ? path + '.' + k : String(k));

  // Трёхстороннее слияние: base — общее прошлое, mine — моя правка, theirs — то, что уже лежит у сервера.
  // Объекты — по полям; массивы записей с id — по id (добавленные с обеих сторон остаются); дописанные в конец
  // списки (история, прочитавшие) — обе дописки; одно место изменено по-разному — конфликт с путём к нему.
  // Удалённая запись — null. → {ok: true, value} | {ok: false, path}
  function merge(base, mine, theirs, path = '') {
    if (same(mine, theirs)) return { ok: true, value: mine };
    if (same(base, mine)) return { ok: true, value: theirs };
    if (same(base, theirs)) return { ok: true, value: mine };
    if (isObj(mine) && isObj(theirs) && (base === null || base === undefined || isObj(base))) {
      const b = base || {}, out = {};
      const keys = [...Object.keys(mine), ...Object.keys(theirs).filter(k => !(k in mine)), ...Object.keys(b).filter(k => !(k in mine) && !(k in theirs))];
      for (const k of keys) {
        const r = merge(b[k], mine[k], theirs[k], at(path, k));
        if (!r.ok) return r;
        if (r.value !== undefined) out[k] = r.value;
      }
      return { ok: true, value: out };
    }
    if (Array.isArray(mine) && Array.isArray(theirs) && (base === null || base === undefined || Array.isArray(base))) {
      const b = base || [];
      if (byIdList(b) && byIdList(mine) && byIdList(theirs)) {
        const get = (list, id) => list.find(x => String(x.id) === id);
        const ids = [...theirs.map(x => String(x.id)), ...mine.map(x => String(x.id)).filter(id => !get(theirs, id))];
        const out = [];
        for (const id of ids) {
          const r = merge(get(b, id) ?? null, get(mine, id) ?? null, get(theirs, id) ?? null, at(path, id));
          if (!r.ok) return r;
          if (r.value !== null && r.value !== undefined) out.push(r.value);
        }
        return { ok: true, value: out };
      }
      if (isPrefix(b, mine) && isPrefix(b, theirs)) {
        const mt = mine.slice(b.length), tt = theirs.slice(b.length).filter(x => !mt.some(y => same(x, y)));
        return { ok: true, value: [...b, ...mt, ...tt] };
      }
      if (b.length === mine.length && b.length === theirs.length) {
        const out = [];
        for (let i = 0; i < b.length; i++) {
          const r = merge(b[i], mine[i], theirs[i], at(path, i));
          if (!r.ok) return r;
          out.push(r.value);
        }
        return { ok: true, value: out };
      }
    }
    return { ok: false, path };
  }

  // Состояние после пачки изменений (формы Docs.diff): исходное st не меняется — затронутые списки и карты копируются,
  // остальное общее. Изменения личного (LOCAL) пропускаются. Товар снимка с документом null — снят из списка.
  function apply(st, changes) {
    const out = Object.assign({}, st), copied = new Set();
    const own = key => {
      if (!copied.has(key)) {
        copied.add(key);
        out[key] = kind(key) === 'MAP' ? Object.assign({}, st[key] || {}) : (Array.isArray(st[key]) ? st[key].slice() : []);
      }
      return out[key];
    };
    for (const c of changes || []) {
      const k = c.key === 'products' ? 'ARRAY' : kind(c.key);
      if (k === 'LOCAL') continue;
      const v = c.deleted ? null : live(c.data);
      if (k === 'ARRAY') {
        const list = own(c.key), i = list.findIndex(x => x && String(x.id) === String(c.id));
        if (v === null || v === undefined) { if (i >= 0) list.splice(i, 1); } else if (i >= 0) list[i] = v; else list.push(v);
      } else if (k === 'MAP') {
        const map = own(c.key);
        if (v === null || v === undefined) delete map[c.id]; else map[c.id] = v;
      } else if (c.deleted) delete out[c.key];
      else out[c.key] = c.key === 'prefs' ? Object.assign({}, v, Object.fromEntries(KEYS.LOCAL_PREFS.filter(f => st.prefs && st.prefs[f] !== undefined).map(f => [f, st.prefs[f]]))) : v;
    }
    return out;
  }

  // Текущее значение одного документа состояния (чистый JSON) или undefined, если его нет
  function get(st, key, id) {
    const d = docId(key, id);
    if (key === 'products' || kind(key) === 'ARRAY') {
      if (key === 'products') { const docs = {}; splitProducts(st.products, docs); return docs[d]; }
      const r = (st[key] || []).find(x => x && String(x.id) === String(id));
      return r ? Store.plain(r) : undefined;
    }
    if (kind(key) === 'MAP') { const v = (st[key] || {})[id]; return v === undefined ? undefined : Store.plain(v); }
    if (kind(key) === 'LOCAL' || st[key] === undefined) return undefined;
    return Store.plain(key === 'prefs' ? sharedPrefs(st.prefs) : st[key]);
  }

  return { SEP, KEYS, kind, docId, parse, same, split, join, diff, merge, get, apply };
})();
