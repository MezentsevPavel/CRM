// Ядро: каталог товаров и склейка снимка остатков с каталогом. Чистая логика, без DOM.
// Источники — снимки CATALOG (10-catalog-data.js, таблица PVCalc) и STOCK_SNAPSHOT (11-stock-data.js, таблица менеджеров).
// Здесь же шаг SEEDS: настоящие товары и остатки вместо выдуманных товаров прототипа v2.

const Catalog = (() => {
  // Название для сравнения: без регистра, ё = е, без кавычек, любые тире = «-» без пробелов вокруг, один пробел.
  const norm = name => String(name ?? '').toLowerCase().replace(/ё/g, 'е')
    .replace(/[«»“”„"'`´]/g, '')
    .replace(/\s*[-‐‑‒–—−]\s*/g, '-')
    .replace(/\s+/g, ' ').trim();

  // Категории товаров: подписи на экране. Вид позиции каталога (колонка «Вид») и раздел таблицы менеджеров сводятся к ним.
  const CATS = ['Панели', 'Инверторы', 'Аккумуляторы', 'Контроллеры', 'Защита и соединения', 'Кабель'];
  const KIND_CAT = { 'панель': 'Панели', 'инвертор': 'Инверторы', 'АКБ': 'Аккумуляторы', 'защита и соединения': 'Защита и соединения', 'кабель': 'Кабель' };
  const SECTION_CAT = {
    'солнечные панели': 'Панели',
    'инверторы / ибп / конвертеры': 'Инверторы',
    'контроллеры заряда': 'Контроллеры',
    'аккумуляторные батареи': 'Аккумуляторы',
    'соединительное и защитное оборудование': 'Защита и соединения',
  };
  // Раздел листа остатков («Корень › Подраздел») → категория. Крепёж лежит в разделе панелей, но в каталоге
  // сайта он — «защита и соединения». Незнакомый раздел остаётся как в таблице: ничего не теряется.
  function sectionCat(section) {
    const [root, ...sub] = String(section ?? '').split(' › ');
    if (sub.some(s => norm(s).includes('крепеж'))) return 'Защита и соединения';
    return SECTION_CAT[norm(root)] || String(root).trim();
  }

  const isNum = v => typeof v === 'number' && isFinite(v);

  // Снимки → {products, stock, aside, unmatched}.
  // products: все позиции каталога (id = ключ каталога, inCatalog:true), затем строки остатков, не нашедшие пару
  //   (id 'sheet-NNN' по номеру строки, inCatalog:false — на экране «нет в каталоге»).
  // Строка остатков склеивается с позицией, только когда norm(название) совпал с norm(модель) ровно у одной позиции
  //   и ровно у одной строки остатков. Похожее, но не совпавшее, и неоднозначное не склеивается.
  // stock[productId][entityId]['_'] — остаток по юрлицу; города в таблице нет → ключ '_'. Пусто остаётся пусто, не 0.
  // aside[productId] = {damaged, custody, transitNoShip} — «Бой», ответхранение, «В пути»; есть, если заполнено хоть что-то.
  // unmatched: [{productId, name}] — строки остатков без пары в каталоге; ids[i] — товар i-й строки остатков.
  // opts.named (перенос из CSV, Import.applyStock): id товара без пары — 'sheet:' + нормализованное название (у второй строки
  //   с тем же названием — «#2»), а не по номеру строки: повторный перенос попадает в те же товары.
  function build(catalog, snapshot, opts = {}) {
    const products = catalog.rows.map(r => ({
      id: String(r.key), name: r.model, brand: r.brand ?? null, cat: KIND_CAT[r.cat] || r.cat,
      price: isNum(r.price) ? r.price : null, avail: r.avail ?? null, url: r.url ?? null,
      src: 'catalog', inCatalog: true, sheet: r.sheet,
    }));
    const byName = new Map();
    for (const p of products) { const k = norm(p.name); byName.set(k, [...(byName.get(k) || []), p.id]); }
    const rowsPerName = new Map();
    for (const r of snapshot.rows) { const k = norm(r.name); rowsPerName.set(k, (rowsPerName.get(k) || 0) + 1); }

    const stock = {}, aside = {}, unmatched = [], ids = [], used = new Set(products.map(p => p.id));
    snapshot.rows.forEach((r, i) => {
      const k = norm(r.name), same = byName.get(k);
      let id;
      if (same && same.length === 1 && rowsPerName.get(k) === 1) id = same[0];
      else {
        id = opts.named ? namedId(k, used) : 'sheet-' + String(i + 1).padStart(3, '0');
        products.push({ id, name: r.name, brand: null, cat: sectionCat(r.cat), price: null, avail: null, url: null, src: 'sheet', inCatalog: false });
        unmatched.push({ productId: id, name: r.name });
      }
      ids.push(id);
      for (const e of ['ip', 'npp', 'vs']) if (isNum(r[e])) (stock[id] || (stock[id] = {}))[e] = { _: r[e] };
      const a = { damaged: isNum(r.damaged) ? r.damaged : null, custody: isNum(r.custody) ? r.custody : null, transitNoShip: isNum(r.transit) ? r.transit : null };
      if (Object.values(a).some(v => v !== null)) aside[id] = a;
    });
    return { products, stock, aside, unmatched, ids };
  }
  // id товара листа по нормализованному названию; одинаковые названия различаются номером
  const NAMED_MAX = 120;
  function namedId(normName, used) {
    const key = 'sheet:' + normName.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, NAMED_MAX).trim();
    let id = key, n = 1;
    while (used.has(id)) id = key + '#' + (++n);
    used.add(id);
    return id;
  }

  // Товар, заведённый руками: единственное место, где он создаётся — форма «Новый товар» и «Оприходовать товар» (Import.applyReceipt).
  // o: {name, cat?, unit?, price?}. Категория не названа — NO_CAT (так же подписан товар листа остатков без раздела), единица и цена
  // не названы — пусто («нет данных»), не ноль. Название, уже стоящее в номенклатуре (Catalog.norm), — отказ: второй такой не заводится.
  // → {ok, product} | {ok:false, reason}; при отказе st не меняется.
  const NO_CAT = 'Без раздела';
  function add(st, o = {}) {
    const name = String(o.name ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    if (!name) return { ok: false, reason: 'Нужно наименование.' };
    if (st.products.some(p => norm(p.name) === norm(name))) return { ok: false, reason: `Товар «${name}» уже есть в номенклатуре.` };
    const product = { id: Store.freeId(st.products, 'u'), name, brand: null, cat: String(o.cat ?? '').trim() || NO_CAT, price: isNum(o.price) ? o.price : null, avail: null, url: null, src: 'user', inCatalog: false };
    if (o.unit) product.unit = o.unit;
    st.products.push(product);
    return { ok: true, product };
  }

  // Категории, которые есть у товаров: сначала привычный порядок CATS, потом остальные по алфавиту.
  function cats(st) {
    const have = new Set(st.products.map(p => p.cat));
    return [...CATS.filter(c => have.has(c)), ...[...have].filter(c => !CATS.includes(c)).sort((a, b) => a.localeCompare(b, 'ru'))];
  }
  function brands(st) {
    return [...new Set(st.products.map(p => p.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
  }

  // Поиск и фильтры: q — слова через пробел, каждое должно встретиться в названии, бренде или ключе;
  // cat, brand, avail ('в наличии' | 'предзаказ') — точное совпадение; inCatalog — true | false. Пустое не фильтрует.
  function query(st, { q, cat, brand, avail, inCatalog } = {}) {
    const words = norm(q).split(' ').filter(Boolean);
    return st.products.filter(p =>
      (!cat || p.cat === cat) && (!brand || p.brand === brand) && (!avail || p.avail === avail) &&
      (inCatalog === undefined || inCatalog === null || p.inCatalog === inCatalog) &&
      (!words.length || words.every(w => norm(p.name + ' ' + (p.brand || '') + ' ' + p.id).includes(w))));
  }

  // ——— снимок не живёт в сохранении браузера ———
  // Товары снимка (src 'catalog' и 'sheet') — константы файла: в сохранение они не пишутся, при загрузке встают из build().
  // В сохранении только изменяемое: товары, добавленные руками, правки полей товаров снимка и id снятых из списка.
  // Метка catalogSnapshot в записи говорит «товары снимка здесь не лежат»; без неё список товаров читается как есть.
  let baseCache = null;
  const base = () => {
    if (!baseCache) {
      // Рабочая база (SERVER): снимка остатков 31.10 в ней нет — остатки появляются только переносом (Import.applyStock)
      const built = build(CATALOG, SERVER ? { rows: [] } : STOCK_SNAPSHOT);
      baseCache = { ...built, byId: new Map(built.products.map(p => [p.id, p])) };
    }
    return baseCache;
  };
  const isSnap = p => p && (p.src === 'catalog' || p.src === 'sheet') && base().byId.has(p.id);
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

  // Список товаров состояния → поля для записи в сохранение; null — в списке нет товаров снимка (пишется как есть).
  function pack(products) {
    if (!Array.isArray(products) || !products.some(isSnap)) return null;
    const own = [], edits = {}, seen = new Set();
    for (const p of products) {
      if (!isSnap(p)) { own.push(p); continue; }
      seen.add(p.id);
      const ref = base().byId.get(p.id), diff = {};
      for (const k of new Set([...Object.keys(p), ...Object.keys(ref)])) if (!same(p[k], ref[k])) diff[k] = p[k] ?? null;
      if (Object.keys(diff).length) edits[p.id] = diff;
    }
    const removed = [...base().byId.keys()].filter(id => !seen.has(id));
    const out = { products: own, catalogSnapshot: CATALOG.snapshot };
    if (Object.keys(edits).length) out.productEdits = edits;
    if (removed.length) out.productsRemoved = removed;
    return out;
  }

  // Прочитанное состояние: товары снимка возвращаются на место (сначала снимок, затем добавленные руками). Меняет st.
  // В SERVER товары листа «Остатки» берутся из st.stockSheet (что загрузил перенос), а не из STOCK_SNAPSHOT; переноса не было —
  // в списке только позиции каталога, и остатка у них «нет данных».
  function unpack(st) {
    if (!st || !st.catalogSnapshot) return st;
    const edits = st.productEdits || {}, removed = new Set(st.productsRemoved || []);
    const sheet = SERVER ? build(CATALOG, { rows: (st.stockSheet && st.stockSheet.rows) || [] }, { named: true }).products.filter(p => !p.inCatalog) : [];
    const snap = [...base().products, ...sheet].filter(p => !removed.has(p.id)).map(p => ({ ...p, ...(edits[p.id] || {}) }));
    const have = new Set(snap.map(p => p.id));
    st.products = [...snap, ...(Array.isArray(st.products) ? st.products : []).filter(p => !have.has(p.id))];
    delete st.catalogSnapshot; delete st.productEdits; delete st.productsRemoved;
    return st;
  }

  return { norm, CATS, NO_CAT, build, add, cats, brands, query, sectionCat, base, pack, unpack };
})();

// Шаг SEEDS: товары и остатки — настоящие, из снимков. Демо-записи прототипа v2 (резервы, позиции поставок,
// движения) ссылались на 12 выдуманных товаров по артикулу; их переводит этот шаг на настоящие позиции того же
// вида: панель — на панель, инвертор — на инвертор, АКБ — на аккумулятор. Позиция выбрана по смыслу записи:
// где v2 резервировал со склада — позиция, у которой в таблице менеджеров есть остаток; где товар только едет
// (АКБ) — позиция из каталога сайта. Ветрогенераторов в каталоге нет: запись ведёт на инвертор.
// Позиция названа точно, как в источнике; нет такой — берётся первая того же вида, ссылки остаются целыми.
const DEMO_LINKS = {
  'PV-550M': { cat: 'Панели', name: 'Солнечная панель HAVEL 340' },
  'INV-H6': { cat: 'Инверторы', name: 'Гибридный инвертор GD6248SMH' },
  'INV-G10': { cat: 'Инверторы', name: 'Сетевой SMARTWATT GRID G2, 6 кВт' },
  'BAT-LFP-100': { cat: 'Аккумуляторы', name: 'Аккумуляторная батарея WINDSOLAR LFP Smart BLOCK 12V 100AH (100AH / 12.8V / 1280WH / BMS)' },
  'CTRL-60': { cat: 'Контроллеры', name: 'Контроллер КЭС DOMINATOR MPPT 200/100' },
  'CAB-6R': { cat: 'Защита и соединения', name: 'Кабель для СЭС PV-1F 2х4 мм2' },
  'CAB-6B': { cat: 'Защита и соединения', name: 'Провод ПуГВнг(А)-LS 1х25 бел Кабэкс ГОСТ' },
  'MC4': { cat: 'Защита и соединения', name: 'Коннектор MC4 AB (комплект из двух разъемов)' },
  'MNT-R4': { cat: 'Защита и соединения', name: 'Комплект крепления MAX для четырех панелей изменением угла наклона 0.5 метр' },
  'BOX-DC': { cat: 'Защита и соединения', name: 'Бокс HT8WAY' },
  'MTR-3F': { cat: 'Защита и соединения', name: 'Токоизмерительные клещи SPLIT CORE CTSA016 на 100 А / 50 mA' },
  'WND-3K': { cat: 'Инверторы', name: 'Гибридный инвертор ASTERION INV ECO II 1.5 кВт (1500W / 12V / PV 900W 30-160V / MPPT 60A)' },
};
// База: юрлица и города по умолчанию, товары — каталог сайта без снимка остатков; остатков и отложенного нет.
BASES.push(st => {
  Object.assign(st, Stock.defaults(), { products: Catalog.build(CATALOG, { rows: [] }).products, stock: {}, aside: {} });
});
SEEDS.push(st => {
  const built = Catalog.build(CATALOG, STOCK_SNAPSHOT);
  Object.assign(st, { products: built.products, stock: built.stock, aside: built.aside });
  const pick = ({ cat, name }) => st.products.find(p => p.cat === cat && Catalog.norm(p.name) === Catalog.norm(name))
    || st.products.find(p => p.cat === cat);
  const link = Object.fromEntries(Object.entries(DEMO_LINKS).map(([sku, rule]) => [sku, pick(rule).id]));
  const fix = id => link[id] || id;
  // поставки: юрлицо и город (демо), позиции — настоящие товары
  for (const s of st.shipments) {
    s.entityId = s.entityId || 'ip'; s.cityId = s.cityId || 'irk';
    for (const it of s.items) it.productId = fix(it.productId);
  }
  // резервы: со склада — из клетки, где больше свободного; под поставку — юрлицо и город поставки
  for (const r of st.reserves) r.productId = fix(r.productId);
  const cells = st.reserves.map(r => (r.src === 'stock' ? Stock.bestCell(st, r.productId) : null));
  st.reserves.forEach((r, i) => {
    const ship = r.src === 'stock' ? null : st.shipments.find(s => s.id === r.src);
    r.entityId = cells[i] ? cells[i].entityId : (ship ? ship.entityId : Stock.ANY);
    r.cityId = cells[i] ? cells[i].cityId : (ship ? ship.cityId : Stock.ANY);
  });
  // движения: товар и клетка склада
  for (const m of st.moves) {
    m.productId = fix(m.productId);
    const cell = Stock.bestCell(st, m.productId);
    m.entityId = cell.entityId; m.cityId = cell.cityId;
  }
});
