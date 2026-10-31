'use strict';
// Каталог и остатки (таск 02, ядро): снимки таблиц, склейка с каталогом, единственный расчёт остатка,
// резервы и журнал движений, переход данных на настоящие товары, ревизия сохранения.
// Ожидаемые значения — из описания в spec.md / таске 02 и из самих таблиц-снимков (данные, а не код под тестом):
// «свободно = годный остаток − резервы со склада», «Бой» и ответхранение в свободный не входят, пустое остаётся пустым.

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.js');

// ——— маленькое состояние для ядра ———
function mini(app, over = {}) {
  const base = app.Stock.defaults();
  return Object.assign({
    entities: base.entities, cities: base.cities,
    pipelines: app.Pipes.defaults(),
    products: [{ id: 'p1', name: 'Тестовый инвертор' }],
    stock: {}, aside: {}, reserves: [], moves: [], shipments: [],
  }, over);
}
const ETA = new Date(2026, 10, 5, 12);
// Товар p1: ИП — Иркутск 10, ИП — город не указан 5, НПП — Москва 3 → на складах 18.
// Бой 4, ответхранение 7, «В пути» без поставки 9 — отдельно. Резерв со склада 6 (ИП, Иркутск), резерв под поставку S1 — 2.
// S1 едет (20 шт); S2 уже на складе (final, 50 шт) и исходящая S3 (8 шт) — в «едет к нам» не входят.
function stateA(app) {
  return mini(app, {
    stock: { p1: { ip: { irk: 10, _: 5 }, npp: { msk: 3 } } },
    aside: { p1: { damaged: 4, custody: 7, transitNoShip: 9 } },
    reserves: [
      { id: 'r1', productId: 'p1', qty: 6, entityId: 'ip', cityId: 'irk', src: 'stock', dealId: 'Д-1' },
      { id: 'r2', productId: 'p1', qty: 2, entityId: 'ip', cityId: 'irk', src: 'S1', dealId: 'Д-2' },
    ],
    shipments: [
      { id: 'S1', dir: 'in', pipeId: 'ships', stageId: 'toStock', eta: ETA, items: [{ productId: 'p1', qty: 20 }] },
      { id: 'S2', dir: 'in', pipeId: 'ships', stageId: 'inStock', eta: new Date(2026, 9, 1), items: [{ productId: 'p1', qty: 50 }] },
      { id: 'S3', dir: 'out', pipeId: 'shipsOut', stageId: 'sent', eta: ETA, items: [{ productId: 'p1', qty: 8 }] },
    ],
  });
}
const at = new Date(2026, 9, 31, 10, 30);

// ——— снимки таблиц ———
const SHEETS = ['Инверторы', 'Аккумуляторы', 'Панели', 'Защита и соединения', 'Новые на сайте', 'Исключено'];

test('снимок каталога: все шесть листов PVCalc, у каждой позиции ключ и модель, цена — число или пусто', () => {
  const { CATALOG } = load();
  assert.equal(CATALOG.snapshot, '2026-10-31');
  assert.ok(CATALOG.source.includes('PVCalc'));
  for (const sheet of SHEETS) assert.ok(CATALOG.rows.some(r => r.sheet === sheet), `в снимке нет листа «${sheet}»`);
  assert.deepEqual([...new Set(CATALOG.rows.map(r => r.sheet))].sort(), [...SHEETS].sort(), 'лишний лист в снимке');
  for (const r of CATALOG.rows) {
    assert.ok(typeof r.key === 'string' && r.key, `позиция без ключа: ${r.model}`);
    assert.ok(typeof r.model === 'string' && r.model.trim(), `позиция ${r.key} без модели`);
    assert.ok(r.price === null || (typeof r.price === 'number' && r.price >= 0), `${r.key}: цена не число и не пусто`);
  }
  assert.equal(new Set(CATALOG.rows.map(r => r.key)).size, CATALOG.rows.length, 'ключи каталога повторяются');
  assert.ok(CATALOG.rows.some(r => r.price === null), 'в таблице есть позиции без цены — в снимке они пустые, не нули');
});

test('снимок остатков: в строках нет резерва, пустое — null, числа — числа', () => {
  const { STOCK_SNAPSHOT } = load();
  assert.equal(STOCK_SNAPSHOT.snapshot, '2026-10-31');
  const FIELDS = ['name', 'cat', 'ip', 'npp', 'vs', 'custody', 'transit', 'damaged'].sort();
  for (const r of STOCK_SNAPSHOT.rows) {
    assert.deepEqual(Object.keys(r).sort(), FIELDS, `${r.name}: набор полей не тот — колонки «Резерв» в снимке быть не должно`);
    assert.ok(typeof r.name === 'string' && r.name.trim());
    for (const f of ['ip', 'npp', 'vs', 'custody', 'transit', 'damaged']) {
      assert.ok(r[f] === null || (typeof r[f] === 'number' && isFinite(r[f])), `${r.name}: «${f}» — ни число, ни null`);
    }
  }
  assert.ok(STOCK_SNAPSHOT.rows.some(r => r.ip === 0), 'ноль из таблицы пропал (0 и «пусто» — разное)');
  assert.ok(STOCK_SNAPSHOT.rows.some(r => r.ip === null), 'пустое в снимке не null');
  assert.ok(!STOCK_SNAPSHOT.rows.some(r => /в 1С актуально/i.test(r.name)), 'строка « в 1С актуально» должна быть пропущена');
});

// ——— нормализация и склейка ———
test('Catalog.norm: регистр, ё/е, кавычки, тире и пробелы не мешают, цифры и модель — мешают', () => {
  const { Catalog } = load();
  const same = (a, b) => assert.equal(Catalog.norm(a), Catalog.norm(b), `«${a}» ≠ «${b}»`);
  const diff = (a, b) => assert.notEqual(Catalog.norm(a), Catalog.norm(b), `«${a}» = «${b}», а должны различаться`);
  same('Инвертор  DEYE   SUN-12K', 'инвертор deye sun-12k');
  same('Аккумулятор «Вектор» ёмкий', 'Аккумулятор "вектор" емкий');
  same('Панель OS – 450W', 'Панель OS-450W');
  same('Панель OS—450W', 'панель os-450w');
  same(' Бокс HT8WAY ', 'бокс ht8way');
  diff('Инвертор DEYE SUN-12K', 'Инвертор DEYE SUN-10K');
  diff('Панель OS-450W', 'Панель OS-450');
  diff('Инвертор DEYE SUN-12K', 'Гибридный инвертор DEYE SUN-12K');
});

test('Catalog.build: склеивается только точное совпадение; похожие, но разные и дубли — «нет в каталоге»', () => {
  const { Catalog } = load();
  const catalog = { rows: [
    { key: '100', model: 'Гибридный инвертор DEYE SUN-12K', brand: 'DEYE', price: 300000, avail: 'в наличии', url: 'https://x/1', cat: 'инвертор', sheet: 'Инверторы' },
    { key: '101', model: 'Гибридный инвертор DEYE SUN-10K', brand: 'DEYE', price: null, avail: 'предзаказ', url: null, cat: 'инвертор', sheet: 'Инверторы' },
    { key: '102', model: 'Аккумуляторная батарея «VEKTOR» 12,8-100', brand: 'VEKTOR', price: 33300, avail: 'предзаказ', url: null, cat: 'АКБ', sheet: 'Аккумуляторы' },
    { key: '103', model: 'Панель OS-450W', brand: null, price: 9000, avail: 'в наличии', url: null, cat: 'панель', sheet: 'Панели' },
  ] };
  const snap = { rows: [
    { name: 'гибридный  инвертор deye sun-12k', cat: 'ИНВЕРТОРЫ / ИБП / КОНВЕРТЕРЫ › MUST', ip: 1, npp: null, vs: 0, custody: null, transit: 2, damaged: null }, // совпало
    { name: 'Гибридный инвертор DEYE SUN-8K', cat: 'ИНВЕРТОРЫ / ИБП / КОНВЕРТЕРЫ › MUST', ip: 5, npp: 6, vs: null, custody: null, transit: null, damaged: null }, // не совпало
    { name: 'Аккумуляторная батарея VEKTOR 12,8-200', cat: 'АККУМУЛЯТОРНЫЕ БАТАРЕИ', ip: null, npp: 7, vs: null, custody: 3, transit: null, damaged: 1 }, // похожая, но другая ёмкость
    { name: 'Панель OS-450W', cat: 'Солнечные панели', ip: 1, npp: null, vs: null, custody: null, transit: null, damaged: null }, // дубль 1
    { name: 'Панель OS-450W', cat: 'Солнечные панели', ip: 2, npp: null, vs: null, custody: null, transit: null, damaged: null }, // дубль 2: неоднозначно
  ] };
  const b = Catalog.build(catalog, snap);
  const byId = Object.fromEntries(b.products.map(p => [p.id, p]));
  // совпавшее: карточка сайта, остатки по ИП/ВС под ключом каталога, пустое НПП — нет ключа, «В пути» — в aside
  assert.equal(byId['100'].inCatalog, true);
  assert.equal(byId['100'].src, 'catalog');
  assert.equal(byId['100'].price, 300000);
  assert.deepEqual(JSON.parse(JSON.stringify(b.stock['100'])), { ip: { _: 1 }, vs: { _: 0 } }, 'остаток по юрлицам, город «_», пусто не записано, ноль сохранён');
  assert.deepEqual(JSON.parse(JSON.stringify(b.aside['100'])), { damaged: null, custody: null, transitNoShip: 2 });
  // не совпавшие и дубли — отдельные товары без пары в каталоге, 3 + 2 строки
  const extra = b.products.filter(p => !p.inCatalog);
  assert.equal(extra.length, 4, 'не склеились 4 строки остатков: SUN-8K, VEKTOR 200 и два дубля');
  assert.ok(extra.every(p => p.src === 'sheet' && p.price === null && p.url === null && p.brand === null));
  assert.equal(b.unmatched.length, 4);
  assert.equal(b.products.length, 4 + 4, 'позиции каталога не теряются и не удваиваются');
  assert.equal(b.stock['101'], undefined, 'SUN-10K похож на SUN-12K, но остаток ему не достался');
  assert.equal(b.stock['103'], undefined, 'при двух строках с одним названием склейка неоднозначна — не склеивать');
  // категория несклеенной строки — по разделу таблицы; id уникальны
  assert.ok(extra.some(p => p.name.includes('SUN-8K') && p.cat === 'Инверторы'));
  assert.ok(extra.some(p => p.name.includes('VEKTOR 12,8-200') && p.cat === 'Аккумуляторы'));
  assert.equal(new Set(b.products.map(p => p.id)).size, b.products.length);
  const v = extra.find(p => p.name.includes('VEKTOR 12,8-200'));
  assert.deepEqual(JSON.parse(JSON.stringify(b.stock[v.id])), { npp: { _: 7 } });
  assert.deepEqual(JSON.parse(JSON.stringify(b.aside[v.id])), { damaged: 1, custody: 3, transitNoShip: null });
});

test('Catalog.build на настоящих снимках: каждая строка остатков склеена или помечена; склейка — только по названию', () => {
  const { Catalog, CATALOG, STOCK_SNAPSHOT } = load();
  const b = Catalog.build(CATALOG, STOCK_SNAPSHOT);
  const inCat = b.products.filter(p => p.inCatalog), out = b.products.filter(p => !p.inCatalog);
  assert.equal(inCat.length, CATALOG.rows.length, 'в товарах не все позиции каталога');
  const glued = STOCK_SNAPSHOT.rows.length - b.unmatched.length;
  assert.equal(out.length, b.unmatched.length);
  assert.equal(b.products.length, CATALOG.rows.length + b.unmatched.length);
  assert.ok(glued > 0 && b.unmatched.length > 0, 'в таблице есть и совпавшие, и несовпавшие названия');
  // независимая проверка: простое сравнение без регистра и лишних пробелов находит ровно столько же пар
  // («Задняя опора … 30-60» против «… 30-60⁰» с значком градуса — не пара)
  const simple = s => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const cat = new Map(CATALOG.rows.map(r => [simple(r.model), r.key]));
  const exact = STOCK_SNAPSHOT.rows.filter(r => cat.has(simple(r.name)));
  assert.equal(glued, exact.length, `склеено ${glued}, а точных совпадений по простому сравнению ${exact.length}`);
  // пересчёт остатка: сумма ИП+НПП+ВС в stock равна сумме в таблице для всего, что склеено или заведено
  const sumRows = STOCK_SNAPSHOT.rows.reduce((a, r) => a + (r.ip || 0) + (r.npp || 0) + (r.vs || 0), 0);
  const sumStock = Object.values(b.stock).reduce((a, byE) => a + Object.values(byE).reduce((x, byC) => x + Object.values(byC).reduce((y, n) => y + n, 0), 0), 0);
  assert.equal(sumStock, sumRows, 'остатки при переносе потерялись или удвоились');
  assert.ok(out.every(p => p.name && !p.inCatalog && p.src === 'sheet'));
});

test('Catalog.query: слова поиска, категория, бренд, наличие и «нет в каталоге» — вместе', () => {
  const { Catalog } = load();
  const st = { products: [
    { id: '1', name: 'Гибридный инвертор DEYE SUN-12K', brand: 'DEYE', cat: 'Инверторы', avail: 'в наличии', inCatalog: true },
    { id: '2', name: 'Гибридный инвертор DEYE SUN-10K', brand: 'DEYE', cat: 'Инверторы', avail: 'предзаказ', inCatalog: true },
    { id: '3', name: 'Аккумулятор VEKTOR', brand: 'VEKTOR', cat: 'Аккумуляторы', avail: 'в наличии', inCatalog: true },
    { id: 'sheet-004', name: 'Солнечная панель HAVEL 340', brand: null, cat: 'Панели', avail: null, inCatalog: false },
  ] };
  const ids = f => Catalog.query(st, f).map(p => p.id).join(',');
  assert.equal(ids({}), '1,2,3,sheet-004');
  assert.equal(ids({ q: 'инвертор deye' }), '1,2');
  assert.equal(ids({ q: 'ИНВЕРТОР 12k' }), '1');
  assert.equal(ids({ q: 'vektor' }), '3', 'бренд ищется как слово');
  assert.equal(ids({ q: 'sheet-004' }), 'sheet-004', 'ключ ищется как слово');
  assert.equal(ids({ cat: 'Аккумуляторы' }), '3');
  assert.equal(ids({ brand: 'DEYE', avail: 'предзаказ' }), '2');
  assert.equal(ids({ inCatalog: false }), 'sheet-004');
  assert.equal(ids({ q: 'havel', cat: 'Инверторы' }), '');
  assert.deepEqual(Array.from(Catalog.cats(st)), ['Панели', 'Инверторы', 'Аккумуляторы'], 'привычный порядок: панели, инверторы, аккумуляторы');
  assert.deepEqual(Array.from(Catalog.brands(st)), ['DEYE', 'VEKTOR']);
});

// ——— таблица «юрлицо × город» ———
test('Stock.grid: юрлица и города по справочнику, «нет данных» — отдельной колонкой, пустые клетки пусты, итоги по строкам и столбцам', () => {
  const app = load();
  const g = app.Stock.grid(stateA(app), 'p1');
  assert.deepEqual(Array.from(g.rows, r => r.id), ['ip', 'npp', 'vs']);
  assert.deepEqual(Array.from(g.cols, c => c.id), ['irk', 'msk', 'krd', '_'], 'колонка «_» (город не указан) — в конце');
  assert.equal(g.cols.find(c => c.id === '_').name, 'нет данных: город');
  assert.equal(g.cell('ip', 'irk'), 10);
  assert.equal(g.cell('ip', '_'), 5);
  assert.equal(g.cell('npp', 'msk'), 3);
  assert.equal(g.cell('npp', 'irk'), null, 'пустая клетка — null, не 0');
  assert.equal(g.cell('vs', 'krd'), null);
  assert.equal(g.totals.rows.ip, 15);
  assert.equal(g.totals.rows.npp, 3);
  assert.equal(g.totals.rows.vs, null, 'строка без чисел — итог пуст');
  assert.equal(g.totals.cols.irk, 10);
  assert.equal(g.totals.cols.krd, null);
  assert.equal(g.totals.cols._, 5);
  assert.equal(g.totals.all, 18);
  // нулевая клетка — это ноль, а не пусто
  const z = app.Stock.grid(mini(app, { stock: { p1: { ip: { irk: 0 } } } }), 'p1');
  assert.equal(z.cell('ip', 'irk'), 0);
  assert.equal(z.totals.all, 0);
  assert.equal(app.Stock.grid(mini(app), 'p1').totals.all, null, 'нет ни одного числа — итог пуст');
});

// ——— единственный расчёт остатка ———
test('Stock.summary: свободно = годный остаток − резервы со склада; «Бой», ответхранение и «В пути» в свободный не входят', () => {
  const app = load();
  const st = stateA(app);
  const k = app.Stock.summary(st, 'p1', at);
  assert.equal(k.onHand, 18, '10 + 5 + 3');
  assert.equal(k.reservedStock, 6);
  assert.equal(k.free, 12, '18 − 6');
  assert.equal(k.damaged, 4);
  assert.equal(k.custody, 7);
  assert.equal(k.transitNoShip, 9);
  assert.equal(k.known, true);
  // Бой / ответхранение / «В пути» сколько угодно — свободный тот же
  st.aside.p1 = { damaged: 100, custody: 200, transitNoShip: 300 };
  assert.equal(app.Stock.summary(st, 'p1', at).free, 12);
  assert.equal(app.Stock.summary(st, 'p1', at).onHand, 18);
  // резерв со склада меняет свободный один к одному
  st.reserves[0].qty = 10;
  assert.equal(app.Stock.summary(st, 'p1', at).free, 8);
});

test('Stock.summary: «свободно после прихода» учитывает поставки в пути и резервы под них; принятые и исходящие не в счёт', () => {
  const app = load();
  const st = stateA(app);
  const k = app.Stock.summary(st, 'p1', at);
  assert.equal(k.incoming, 20, 'S1 едет; S2 уже принята, S3 — отгрузка клиенту');
  assert.equal(k.reservedIncoming, 2);
  assert.equal(k.freeAfter, 30, '12 + 20 − 2');
  assert.equal(k.nextEta.getTime(), ETA.getTime());
  assert.deepEqual(Array.from(app.Stock.incomingOf(st, 'p1'), x => [x.shipId, x.qty]), [['S1', 20]]);
  // поставку приняли (этап final) — она больше не «едет», резерв под неё остаётся до перевода на склад
  st.shipments[0].stageId = 'inStock';
  const after = app.Stock.summary(st, 'p1', at);
  assert.equal(after.incoming, 0);
  assert.equal(after.freeAfter, 10, '12 + 0 − 2');
  assert.equal(after.nextEta, null);
});

test('Stock.summary: товара нет в таблице остатков — остаток не известен (known:false), это не «нуль на складе»', () => {
  const app = load();
  const k = app.Stock.summary(mini(app), 'p1', at);
  assert.equal(k.known, false);
  assert.equal(k.onHand, 0);
  assert.equal(k.damaged, null);
  assert.equal(k.custody, null);
  assert.equal(k.transitNoShip, null);
  const zero = app.Stock.summary(mini(app, { stock: { p1: { ip: { irk: 0 } } } }), 'p1', at);
  assert.equal(zero.known, true, 'ноль в таблице — известный остаток');
});

// ——— резервы и журнал ———
test('Stock.canReserve: больше свободного нельзя, причина называет число; свободное в клетке и по товару', () => {
  const app = load();
  const st = stateA(app);
  // ИП, Иркутск: 10 на складе, 6 уже в резерве → можно 4
  let c = app.Stock.canReserve(st, { productId: 'p1', qty: 5, entityId: 'ip', cityId: 'irk' });
  assert.equal(c.ok, false);
  assert.equal(c.max, 4);
  assert.ok(c.reason.includes('4'), `причина должна называть число 4: «${c.reason}»`);
  assert.ok(c.reason.includes('ИП') && c.reason.includes('Иркутск'), 'причина называет юрлицо и город');
  c = app.Stock.canReserve(st, { productId: 'p1', qty: 4, entityId: 'ip', cityId: 'irk' });
  assert.equal(c.ok, true);
  // город не указан в таблице: клетка ИП × «нет данных» — 5
  assert.equal(app.Stock.canReserve(st, { productId: 'p1', qty: 6, entityId: 'ip', cityId: '_' }).max, 5);
  // в клетке, где ничего нет, резерва нет
  c = app.Stock.canReserve(st, { productId: 'p1', qty: 1, entityId: 'vs', cityId: 'krd' });
  assert.equal(c.ok, false);
  assert.equal(c.max, 0);
  // не больше свободного по товару в целом: за клеткой «ВС, Иркутск» забыли резерв 9 → свободно 18 − 15 = 3
  st.reserves.push({ id: 'r9', productId: 'p1', qty: 9, entityId: 'vs', cityId: 'irk', src: 'stock', dealId: 'Д-9' });
  assert.equal(app.Stock.summary(st, 'p1', at).free, 3);
  assert.equal(app.Stock.canReserve(st, { productId: 'p1', qty: 1, entityId: 'ip', cityId: '_' }).max, 3, 'в клетке 5, но по товару свободно 3');
  // количество: ноль, дробное, текст
  for (const qty of [0, -2, 1.5, 'много']) assert.equal(app.Stock.canReserve(st, { productId: 'p1', qty, entityId: 'ip', cityId: 'irk' }).ok, false, `qty ${qty}`);
  // резерв из поставки: в S1 20, под неё уже 2 → можно 18
  c = app.Stock.canReserve(st, { productId: 'p1', qty: 19, src: 'S1' });
  assert.equal(c.ok, false);
  assert.equal(c.max, 18);
  assert.ok(c.reason.includes('18'));
  assert.equal(app.Stock.canReserve(st, { productId: 'p1', qty: 18, src: 'S1' }).ok, true);
  // принятой поставки среди ожидаемых нет
  assert.equal(app.Stock.canReserve(st, { productId: 'p1', qty: 1, src: 'S2' }).ok, false);
});

test('Stock.reserve / unreserve: резерв сразу виден в свободном, снятие возвращает товар, обе операции в журнале', () => {
  const app = load();
  const st = stateA(app);
  const before = app.Stock.summary(st, 'p1', at);
  const ok = app.Stock.reserve(st, { productId: 'p1', qty: 4, entityId: 'ip', cityId: 'irk', dealId: 'Д-7', until: ETA, by: 'p2', at });
  assert.equal(ok.ok, true);
  assert.equal(ok.reserve.entityId, 'ip');
  assert.equal(ok.reserve.cityId, 'irk');
  assert.equal(ok.reserve.src, 'stock');
  assert.equal(app.Stock.summary(st, 'p1', at).free, before.free - 4, 'резерв не уменьшил свободный остаток');
  const m = st.moves[0];
  assert.deepEqual([m.kind, m.productId, m.qty, m.doc, m.by, m.entityId, m.cityId], ['Резерв', 'p1', 4, 'Д-7', 'p2', 'ip', 'irk']);
  assert.equal(m.at.getTime(), at.getTime());
  // ещё хоть один в эту клетку — отказ, ничего не записано
  const n = st.moves.length, r = st.reserves.length;
  const no = app.Stock.reserve(st, { productId: 'p1', qty: 1, entityId: 'ip', cityId: 'irk', dealId: 'Д-8', until: ETA, by: 'p2', at });
  assert.equal(no.ok, false);
  assert.equal(no.max, 0);
  assert.equal(st.moves.length, n);
  assert.equal(st.reserves.length, r);
  // снять — товар вернулся
  const off = app.Stock.unreserve(st, ok.reserve.id, 'p3', at);
  assert.equal(off.ok, true);
  assert.equal(app.Stock.summary(st, 'p1', at).free, before.free, 'снятие резерва не вернуло товар в свободный');
  assert.deepEqual([st.moves[0].kind, st.moves[0].qty, st.moves[0].doc, st.moves[0].by], ['Снят резерв', 4, 'Д-7', 'p3']);
  assert.equal(app.Stock.unreserve(st, 'нет-такого', 'p3', at).ok, false);
  // резерв под поставку берёт юрлицо и город поставки
  st.shipments[0].entityId = 'npp'; st.shipments[0].cityId = 'msk';
  const sh = app.Stock.reserve(st, { productId: 'p1', qty: 3, src: 'S1', dealId: 'Д-7', until: ETA, by: 'p2', at });
  assert.equal(sh.ok, true);
  assert.deepEqual([sh.reserve.entityId, sh.reserve.cityId], ['npp', 'msk']);
  assert.equal(app.Stock.summary(st, 'p1', at).reservedIncoming, 5);
});

test('Stock.move: приход, отгрузка, списание в бой, перемещение меняют остаток и пишутся в журнал; отказ ничего не меняет', () => {
  const app = load();
  const st = stateA(app), K = app.Stock.KINDS;
  const rec = app.Stock.move(st, { kind: K.receive, productId: 'p1', qty: 7, entityId: 'npp', cityId: 'msk', doc: 'П-1', by: 'p5', at });
  assert.equal(rec.ok, true);
  assert.equal(app.Stock.grid(st, 'p1').cell('npp', 'msk'), 10, '3 + 7');
  assert.equal(app.Stock.summary(st, 'p1', at).onHand, 25);
  assert.deepEqual([st.moves[0].kind, st.moves[0].qty, st.moves[0].doc, st.moves[0].by, st.moves[0].entityId, st.moves[0].cityId], ['Приход', 7, 'П-1', 'p5', 'npp', 'msk']);
  // приход в клетку, где ничего не было: клетка появляется
  app.Stock.move(st, { kind: K.receive, productId: 'p1', qty: 2, entityId: 'vs', cityId: 'krd', doc: 'П-2', by: 'p5', at });
  assert.equal(app.Stock.grid(st, 'p1').cell('vs', 'krd'), 2);
  // отгрузка и списание в бой
  assert.equal(app.Stock.move(st, { kind: K.ship, productId: 'p1', qty: 4, entityId: 'ip', cityId: 'irk', doc: 'О-1', by: 'p5', at }).ok, true);
  assert.equal(app.Stock.grid(st, 'p1').cell('ip', 'irk'), 6);
  assert.equal(app.Stock.move(st, { kind: K.damage, productId: 'p1', qty: 1, entityId: 'ip', cityId: 'irk', doc: 'Акт-1', by: 'p5', at }).ok, true);
  assert.equal(app.Stock.grid(st, 'p1').cell('ip', 'irk'), 5);
  assert.equal(app.Stock.summary(st, 'p1', at).damaged, 5, 'бой 4 + 1');
  // перемещение: откуда и куда в журнале
  assert.equal(app.Stock.move(st, { kind: K.transfer, productId: 'p1', qty: 2, entityId: 'ip', cityId: 'irk', toEntityId: 'ip', toCityId: 'msk', doc: 'Пер-1', by: 'p5', at }).ok, true);
  assert.equal(app.Stock.grid(st, 'p1').cell('ip', 'irk'), 3);
  assert.equal(app.Stock.grid(st, 'p1').cell('ip', 'msk'), 2);
  assert.deepEqual([st.moves[0].toEntityId, st.moves[0].toCityId], ['ip', 'msk']);
  // больше, чем в клетке, — отказ без изменений; и резерв так двигать нельзя
  const n = st.moves.length, snapshot = JSON.stringify(st.stock);
  const bad = app.Stock.move(st, { kind: K.ship, productId: 'p1', qty: 99, entityId: 'ip', cityId: 'irk', doc: 'О-2', by: 'p5', at });
  assert.equal(bad.ok, false);
  assert.ok(bad.reason.includes('99') && bad.reason.includes('3'), 'причина называет, сколько есть и сколько нужно');
  assert.equal(app.Stock.move(st, { kind: K.reserve, productId: 'p1', qty: 1, entityId: 'ip', cityId: 'irk', doc: 'Д-1', by: 'p2', at }).ok, false);
  assert.equal(app.Stock.move(st, { kind: K.receive, productId: 'p1', qty: 0, entityId: 'ip', cityId: 'irk', doc: 'П-3', by: 'p5', at }).ok, false);
  assert.equal(st.moves.length, n);
  assert.equal(JSON.stringify(st.stock), snapshot);
});

// ——— демо-данные на настоящих товарах ———
test('seed(): ни одна запись не ссылается на несуществующий товар, юрлицо или город', () => {
  const app = load();
  const st = app.seed();
  const pids = new Set(st.products.map(p => p.id));
  assert.equal(pids.size, st.products.length, 'id товаров повторяются');
  assert.ok(st.products.length > 242, 'товаров меньше, чем позиций каталога');
  const place = new Set([...st.entities.map(e => e.id), '_']), towns = new Set([...st.cities.map(c => c.id), '_']);
  const need = (id, what) => assert.ok(pids.has(id), `${what}: товара «${id}» нет`);
  for (const r of st.reserves) { need(r.productId, `резерв ${r.id}`); assert.ok(place.has(r.entityId) && towns.has(r.cityId), `резерв ${r.id}: юрлицо или город не из справочника`); }
  for (const m of st.moves) { need(m.productId, `движение ${m.doc}`); assert.ok(place.has(m.entityId) && towns.has(m.cityId), `движение ${m.doc}: юрлицо или город`); }
  for (const s of st.shipments) for (const it of s.items) need(it.productId, `поставка ${s.id}`);
  for (const id of Object.keys(st.stock)) need(id, 'остаток');
  for (const id of Object.keys(st.aside)) need(id, 'бой / ответхранение / в пути');
  // справочники: три юрлица и три города, адрес склада пуст («нет данных: адрес»)
  assert.deepEqual(Array.from(st.entities, e => e.name), ['ИП', 'НПП', 'ВС']);
  assert.deepEqual(Array.from(st.cities, c => c.name), ['Иркутск', 'Москва', 'Краснодар']);
  assert.ok(st.cities.every(c => c.address === ''));
  // сравнить с настоящим остатком: «Солнечная панель HAVEL 340» — на складе ИП 98 (таблица менеджеров)
  const row = app.STOCK_SNAPSHOT.rows.find(r => r.name === 'Солнечная панель HAVEL 340');
  const p = st.products.find(x => x.name === row.name);
  assert.equal(st.stock[p.id].ip._, row.ip);
  assert.equal(p.inCatalog, false, 'такой модели на сайте нет — «нет в каталоге»');
});

test('демо-ссылки v2 переведены на позиции того же вида: панель — панель, инвертор — инвертор, АКБ — аккумулятор', () => {
  const app = load();
  const st = app.seed();
  // вид выдуманного товара v2 — из notes.md (Панели, Инверторы, Аккумуляторы…); новая позиция — настоящая и того же вида
  const KIND = { 'PV-550M': 'Панели', 'INV-H6': 'Инверторы', 'INV-G10': 'Инверторы', 'BAT-LFP-100': 'Аккумуляторы', 'CTRL-60': 'Контроллеры' };
  for (const [sku, cat] of Object.entries(KIND)) {
    const link = app.DEMO_LINKS[sku];
    assert.ok(link, `для ${sku} нет настоящей позиции`);
    assert.equal(link.cat, cat);
    const p = st.products.find(x => app.Catalog.norm(x.name) === app.Catalog.norm(link.name));
    assert.ok(p, `${sku}: позиции «${link.name}» нет среди товаров — ссылки ушли бы на запасную`);
    assert.equal(p.cat, cat, `${sku}: позиция другого вида`);
  }
  for (const sku of Object.keys(app.DEMO_LINKS)) assert.ok(!st.products.some(p => p.id === sku || p.sku === sku), `выдуманный товар ${sku} остался`);
  // записи v2 стоят на настоящих товарах, и резерв со склада не больше остатка в его клетке
  const k = new Map(st.products.map(p => [p.id, p]));
  for (const r of st.reserves.filter(x => x.src === 'stock')) {
    const have = app.Stock.grid(st, r.productId).cell(r.entityId, r.cityId);
    assert.ok(have !== null && have > 0, `резерв ${r.id} со склада, а в клетке ${r.entityId}/${r.cityId} товара «${k.get(r.productId).name}» нет`);
  }
});

// ——— сохранение: ревизия формы данных ———
test('Store.REV: dump пишет ревизию, load принимает свою и отбрасывает прежнюю; прежняя форма — демо без ошибки', () => {
  const app = load();
  const { Store } = app;
  assert.equal(typeof Store.REV, 'number');
  const text = Store.dump(app.S).text;
  assert.equal(JSON.parse(text).rev, Store.REV, 'ревизия не записана в сохранение');
  const back = Store.load(text);
  assert.ok(back, 'сохранение своей ревизии не прочиталось');
  assert.equal(back.rev, undefined, 'служебная ревизия просочилась в состояние');
  assert.equal(back.products.length, app.S.products.length);
  // та же схема v3, но ревизия прежняя или без ревизии (сохранение до перехода на настоящие товары)
  const prev = JSON.parse(text);
  prev.rev = Store.REV - 1;
  assert.equal(Store.load(JSON.stringify(prev)), null, 'сохранение прежней ревизии прочиталось');
  delete prev.rev;
  assert.equal(Store.load(JSON.stringify(prev)), null, 'сохранение без ревизии прочиталось');
  // запуск страницы с таким сохранением в браузере: демо, а не падение
  const old = {
    v: 3, me: 'p3', view: 'stock', people: [{ id: 'p3', name: 'Старый', role: 'director', dept: 'mgmt' }],
    products: [{ sku: 'PV-550M', name: 'Солнечная панель 550 Вт, моно', cat: 'Панели', unit: 'шт', price: 14900, stock: 86 }],
    reserves: [{ id: 'r1', productId: 'PV-550M', dealId: 'Д-311', qty: 22, src: 'stock' }], moves: [], shipments: [], deals: [], tasks: [], notes: [],
  };
  const fresh = load({ storage: { [Store.KEY]: JSON.stringify(old) } });
  assert.ok(fresh.S.products.length > 242, 'вместо демо осталось старое сохранение');
  assert.ok(fresh.S.products.every(p => typeof p.id === 'string' && !('sku' in p)));
  assert.equal(fresh.S.me, 'p1', 'человек из старого сохранения не должен остаться');
  assert.doesNotThrow(() => { fresh.render(); fresh.VIEWS.stock(); });
});

// ——— прежние разделы на настоящих товарах ———
test('раздел «Товары и остатки» и карточка товара работают на настоящих данных; поиск в шапке находит товар', () => {
  const app = load();
  app.render();
  const html = app.VIEWS.stock();
  // список идёт по страницам: на первой — первые позиции, остальные находятся поиском и фильтрами
  assert.ok(html.includes(app.esc(app.S.products[0].name)));
  app.S.ui.catf = 'out';
  assert.ok(app.stockTable().includes('нет в каталоге'), 'позиции без пары в каталоге не помечены');
  app.S.ui.catf = '';
  const p = app.S.products.find(x => x.name === 'Солнечная панель HAVEL 340');
  const d = app.DRAWERS.product(p.id);
  assert.ok(d && d.body.includes('Поставить резерв') && d.body.includes('Юрлицо'), 'в карточке нет формы резерва с юрлицом');
  assert.ok(d.title.includes('HAVEL 340'));
  // фильтр по категории и поиск идут через Catalog.query
  app.S.ui.cat = 'Панели'; app.S.ui.sq = 'havel 340';
  const t = app.stockTable();
  assert.ok(t.includes('HAVEL 340') && !t.includes('GD6248SMH'));
  assert.ok(app.searchRes('havel 340').some(r => r.type === 'Товар' && r.act.includes(`data-pid="${p.id}"`)));
  // товар без строки в таблице остатков — «нет данных», а не 0
  const none = app.S.products.find(x => x.inCatalog && !app.Stock.summary(app.S, x.id, new Date()).known && !app.S.reserves.some(r => r.productId === x.id));
  app.S.ui.cat = 'Все'; app.S.ui.sq = none.id;
  assert.ok(app.stockTable().includes('нет данных'));
});

test('форма резерва: больше свободного — ошибка с числом; верное количество проходит, снятие возвращает товар', () => {
  const app = load();
  app.render();
  const { Stock } = app;
  const row = app.STOCK_SNAPSHOT.rows.find(r => r.name === 'Солнечная панель HAVEL 340');
  const p = app.S.products.find(x => x.name === row.name);
  app.S.reserves = app.S.reserves.filter(r => r.productId !== p.id); // остаётся то, что в таблице: ИП — 98
  const free = () => Stock.summary(app.S, p.id, new Date()).free;
  assert.equal(free(), row.ip);
  const el = id => app.document.getElementById(id);
  const fill = qty => {
    el('rs-deal').value = app.S.deals[0].id; el('rs-qty').value = String(qty); el('rs-src').value = 'stock';
    el('rs-ent').value = 'ip'; el('rs-city').value = '_'; el('rs-until').value = app.iso(app.day(5));
    el('rs-err').hidden = true; el('rs-err').textContent = '';
  };
  const movesBefore = app.S.moves.length;
  fill(row.ip + 1);
  app.FORMS.reserve({ dataset: { pid: p.id } });
  assert.equal(el('rs-err').hidden, false, 'ошибка не показана');
  assert.ok(el('rs-err').textContent.includes(String(row.ip)), `ошибка не называет число ${row.ip}: «${el('rs-err').textContent}»`);
  assert.equal(app.S.moves.length, movesBefore, 'отказ попал в журнал');
  assert.equal(free(), row.ip);
  fill(row.ip);
  app.FORMS.reserve({ dataset: { pid: p.id } });
  assert.equal(free(), 0, 'резерв не уменьшил свободный остаток');
  assert.equal(app.S.moves.length, movesBefore + 1);
  assert.equal(app.S.moves[0].kind, 'Резерв');
  const r = app.S.reserves.find(x => x.productId === p.id);
  assert.deepEqual([r.entityId, r.cityId, r.qty], ['ip', '_', row.ip]);
  app.A.unreserve({ dataset: { id: r.id } });
  assert.equal(free(), row.ip, 'снятие резерва не вернуло товар');
  assert.equal(app.S.moves[0].kind, 'Снят резерв');
});

test('«Новый товар» и «Новая поставка»: товар заводится без выдуманных полей, поставка сразу видна в «едет к нам»', () => {
  const app = load();
  app.render();
  const el = id => app.document.getElementById(id);
  el('np-name').value = 'Мой кабель'; el('np-unit').value = 'м'; el('np-cat').value = 'Кабель'; el('np-price').value = '';
  app.FORMS.product();
  const u = app.S.products.find(p => p.src === 'user');
  assert.ok(u, 'товар не добавлен');
  assert.deepEqual([u.name, u.cat, u.unit, u.price, u.brand, u.url, u.avail, u.inCatalog], ['Мой кабель', 'Кабель', 'м', null, null, null, null, false]);
  assert.equal(app.S.products.filter(p => p.id === u.id).length, 1, 'id нового товара повторился');
  app.FORMS.product();
  assert.equal(app.S.products.filter(p => p.src === 'user').length, 1, 'товар с тем же названием добавился второй раз');
  assert.match(el('np-err').textContent, /уже есть/);
  assert.ok(!app.stockTable().includes('undefined'));
  // поставка, созданная формой, считается в «едет к нам» тем же Stock
  const p = app.S.products.find(x => x.name === 'Солнечная панель HAVEL 340');
  const before = app.Stock.summary(app.S, p.id, new Date());
  el('ns-from').value = 'Поставщик для проверки'; el('ns-car').value = app.CARRIERS[0]; el('ns-doc').value = ''; el('ns-stage').value = 'ordered'; el('ns-eta').value = app.iso(app.day(5));
  app.FORMS.ship({ querySelectorAll: () => [{ querySelector: s => ({ value: s === 'select' ? p.id : '12' }) }] });
  const after = app.Stock.summary(app.S, p.id, new Date());
  assert.equal(after.incoming, before.incoming + 12);
  assert.equal(after.freeAfter, before.freeAfter + 12);
});

// ——— снимки не живут в сохранении браузера ———
test('сохранение без снимка: товаров снимка в записи нет, размер разумный; после dump → load все товары на месте, свои товары и правки целы', () => {
  const app = load();
  const { Store, S } = app;
  const text = Store.dump(S).text;
  // суть: в записи нет ни одного товара снимка каталога (ищем по их id), а не «запись короче N символов»
  const snapIds = new Set(S.products.filter(p => p.src === 'catalog' || p.src === 'sheet').map(p => p.id));
  assert.equal(snapIds.size, 434, 'в демо-состоянии 434 товара снимка');
  const leaked = JSON.parse(text).products.filter(p => snapIds.has(p.id));
  assert.equal(leaked.length, 0, `в сохранение попали товары снимка каталога: ${leaked.length}`);
  // запасной предел: запись не разрастается. Демо-поставки (126 штук, у шести по 50–150 позиций) весят в ней около 150 тысяч
  // символов; товары снимка добавили бы ещё около 116 тысяч — предел их не пропустит
  assert.ok(text.length < 230000, `сохранение после seed() весит ${text.length} символов`);
  // всё, что пользователь добавил и поправил, сохраняется; всё остальное восстанавливается из снимка
  S.products.push({ id: 'u1', name: 'Мой кабель', brand: null, cat: 'Кабель', unit: 'м', price: 77, avail: null, url: null, src: 'user', inCatalog: false });
  const havel = S.products.find(p => p.name === 'Солнечная панель HAVEL 340');
  havel.price = 12345;
  const gone = S.products.findIndex(p => p.id === 'sheet-001');
  const goneId = S.products.splice(gone, 1)[0].id;
  const back = Store.load(Store.dump(S).text);
  assert.equal(JSON.stringify(back.products), JSON.stringify(S.products), 'после dump → load товары не те');
  assert.equal(back.products.find(p => p.id === havel.id).price, 12345, 'правка товара из снимка потеряна');
  assert.ok(!back.products.some(p => p.id === goneId), 'удалённый товар вернулся из снимка');
  assert.equal(back.products.length, 434, 'число товаров после загрузки: 434 из снимка − 1 удалённый + 1 свой');
  // запуск страницы с таким сохранением поднимает те же товары
  const again = load({ storage: { [Store.KEY]: Store.dump(S).text } });
  assert.equal(again.S.products.length, 434);
  assert.equal(again.S.products.find(p => p.id === havel.id).price, 12345);
});

// ——— экраны: список «Товары», карточка, резерв, журнал, настройки ———
// Ожидаемые числа — из условий таска и самих снимков: в базе 434 позиции (242 из каталога PVCalc + 192 строки
// таблицы менеджеров «нет в каталоге»); из 208 строк таблицы менеджеров по названию склеились 16.
const plain = html => html.replace(/<[^>]+>/g, ' ').replace(/ | /g, ' ').replace(/\s+/g, ' ').trim();
const rowsIn = html => (html.match(/data-pid="/g) || []).length;
// событие поля data-on="<key>" так, как его шлёт браузер
const fire = (app, type, key, value, extra = {}) => app.document.dispatchEvent({ type, target: { dataset: { on: key, ...extra }, value, checked: value } });
const region = (app, id) => app.document.getElementById(id).innerHTML;
const money = n => n.toLocaleString('ru-RU').replace(/ | /g, ' ') + ' ₽';
const stockView = (app, tab) => { app.S.view = 'stock'; if (tab) app.S.ui.stockTab = tab; app.render(); return region(app, 'view'); };
const freeCell = (app, pid) => plain(app.stockTable().split('<tr ').find(r => r.includes(`data-pid="${pid}"`)).match(/<td class="num free">.*?<\/td>/)[0]);

test('«Товары»: число позиций видно, список идёт по страницам; поиск и фильтры сужают его и пересчитывают «показано N из M»', () => {
  const app = load();
  const view = plain(stockView(app));
  assert.match(view, /Показано 434 из 434 /, 'число позиций не видно');
  assert.match(view, /Страница 1 из 9/, 'список не разбит на страницы');
  assert.ok(rowsIn(region(app, 'view')) <= 50, 'на странице больше 50 строк — 434 строки сразу');
  // вторая страница — другие строки
  const first = html => html.match(/data-pid="([^"]+)"/)[1];
  const p1 = first(app.stockTable());
  app.A['stock-page']({ dataset: { page: '1' } });
  assert.match(plain(app.stockTable()), /Страница 2 из 9/);
  assert.notEqual(first(app.stockTable()), p1);
  const shown = () => plain(region(app, 'stock-tbl'));
  const count = () => Number(shown().match(/Показано (\d+) из 434/)[1]);
  // категория
  app.A['stock-cat']({ dataset: { cat: 'Панели' } });
  const panels = app.S.products.filter(p => p.cat === 'Панели').length;
  assert.ok(panels > 0 && panels < 434);
  assert.match(plain(app.stockTable()), new RegExp(`Показано ${panels} из 434`));
  assert.ok(!app.stockTable().includes('GD6248SMH'), 'в категории «Панели» остался инвертор');
  assert.match(plain(app.stockTable()), /Страница 1 из/, 'смена фильтра не вернула на первую страницу');
  app.A['stock-cat']({ dataset: { cat: 'Все' } });
  // бренд, наличие, «нет в каталоге» — полями data-on, как в браузере
  const deye = app.CATALOG.rows.filter(r => r.brand === 'DEYE').length;
  assert.ok(deye > 0);
  fire(app, 'change', 'brand', 'DEYE');
  assert.equal(count(), deye, 'фильтр по бренду DEYE');
  fire(app, 'change', 'brand', '');
  const inStock = app.CATALOG.rows.filter(r => r.avail === 'в наличии').length;
  fire(app, 'change', 'avail', 'в наличии');
  assert.equal(count(), inStock, 'фильтр по наличию');
  fire(app, 'change', 'avail', '');
  fire(app, 'change', 'catf', 'out');
  assert.equal(count(), 192, '«нет в каталоге» — 192 строки таблицы менеджеров');
  assert.ok(shown().includes('нет в каталоге'));
  fire(app, 'change', 'catf', 'in');
  assert.equal(count(), 242, '«в каталоге» — 242 позиции PVCalc');
  assert.ok(!shown().includes('нет в каталоге'), 'среди позиций каталога осталась «нет в каталоге»');
  fire(app, 'change', 'catf', '');
  // поиск
  fire(app, 'input', 'sq', 'havel 340');
  assert.ok(count() >= 1 && count() < 10);
  assert.ok(region(app, 'stock-tbl').includes('HAVEL 340'));
  fire(app, 'input', 'sq', 'такого-товара-нет-нигде');
  assert.match(shown(), /Показано 0 из 434/);
  assert.ok(shown().includes('Ничего не нашлось'));
});

test('«Товары»: в строке модель, бренд, категория, цена, «свободно сейчас» и пометка «нет в каталоге»; цены нет — «нет данных: цена»', () => {
  const app = load();
  const row = app.CATALOG.rows.find(r => r.sheet === 'Панели' && r.price > 0 && r.brand);
  app.S.ui.sq = row.key;
  const html = app.stockTable();
  const t = plain(html);
  assert.ok(t.includes(row.model) && t.includes(row.brand) && t.includes('Панели'), `в строке нет модели, бренда или категории: ${t}`);
  assert.ok(t.includes(money(row.price)), 'в строке нет цены');
  assert.ok(t.includes('Свободно сейчас'), 'нет столбца «Свободно сейчас»');
  const noPrice = app.CATALOG.rows.find(r => r.price === null);
  app.S.ui.sq = noPrice.key;
  assert.ok(plain(app.stockTable()).includes('нет данных: цена'));
  const sheet = app.S.products.find(p => !p.inCatalog && p.src === 'sheet');
  app.S.ui.sq = sheet.id;
  assert.ok(plain(app.stockTable()).includes('нет в каталоге'));
});

test('карточка товара: ключ, модель, бренд, категория, цена с подписью снимка, наличие и ссылка; без цены — «нет данных: цена»', () => {
  const app = load();
  const row = app.CATALOG.rows.find(r => r.sheet === 'Панели' && r.price > 0 && r.url && r.brand && r.avail);
  const d = app.DRAWERS.product(row.key);
  const t = plain(d.body);
  for (const part of [row.key, row.model, row.brand, 'Панели', row.avail, money(row.price), 'цена сайта, снимок 31.10.2026']) {
    assert.ok(t.includes(part), `в карточке нет «${part}»`);
  }
  assert.ok(d.body.includes(`href="${row.url}"`), 'нет ссылки на сайт');
  const bare = app.CATALOG.rows.find(r => r.price === null);
  const db = plain(app.DRAWERS.product(bare.key).body);
  assert.ok(db.includes('нет данных: цена'), 'пустая цена не подписана');
  assert.ok(!db.includes('₽'), 'у пустой цены появилась сумма');
  // позиция из таблицы менеджеров, которой нет в каталоге
  const sheet = app.S.products.find(p => p.src === 'sheet');
  const ds = plain(app.DRAWERS.product(sheet.id).body);
  assert.ok(ds.includes('нет в каталоге') && ds.includes('нет данных: бренд') && ds.includes('нет данных: цена'));
});

test('карточка товара: сетка «юрлицо × город» с итогами; где остатка нет — клетка пустая, не 0; колонка без города подписана', () => {
  const app = load();
  const rows = app.STOCK_SNAPSHOT.rows;
  const uniq = r => rows.filter(x => x.name === r.name).length === 1;
  const row = rows.find(r => r.ip > 0 && r.npp === null && r.vs === null && uniq(r) && app.S.products.some(p => p.name === r.name));
  const p = app.S.products.find(x => x.name === row.name);
  app.S.reserves = app.S.reserves.filter(r => r.productId !== p.id);
  const body = app.DRAWERS.product(p.id).body;
  const cells = title => {
    const tr = body.match(new RegExp(`<tr><th scope="row">${title}</th>(.*?)</tr>`));
    assert.ok(tr, `в сетке нет строки «${title}»`);
    return [...tr[1].matchAll(/<td[^>]*>(.*?)<\/td>/g)].map(m => m[1]);
  };
  // столбцы: Иркутск, Москва, Краснодар, «нет данных: город», Итого
  assert.deepEqual(cells('ИП'), ['', '', '', String(row.ip), String(row.ip)]);
  assert.deepEqual(cells('НПП'), ['', '', '', '', ''], 'пустые клетки показаны нулём или чем-то ещё');
  assert.deepEqual(cells('ВС'), ['', '', '', '', '']);
  assert.deepEqual(cells('Итого'), ['', '', '', String(row.ip), String(row.ip)]);
  assert.ok(plain(body).includes('нет данных: город'), 'колонка без города не подписана');
  assert.ok(plain(body).includes('таблица менеджеров, снимок 31.10.2026'), 'нет подписи источника остатков');
  // юрлицо переименовали в справочнике — сетка говорит новым названием
  app.S.entities.find(e => e.id === 'ip').name = 'ИП Иванов';
  assert.ok(plain(app.DRAWERS.product(p.id).body).includes('ИП Иванов'));
});

test('карточка товара: ответхранение, «В пути» из таблицы, «Бой», в резерве, свободно сейчас и после прихода — отдельно и с подписями', () => {
  const app = load();
  const rows = app.STOCK_SNAPSHOT.rows;
  const uniq = r => rows.filter(x => x.name === r.name).length === 1 && app.S.products.some(p => p.name === r.name);
  const card = row => plain(app.DRAWERS.product(app.S.products.find(p => p.name === row.name).id).body);
  const tile = (t, label) => (t.match(new RegExp(label + ' (\\d+|нет данных)')) || [])[1];
  // в таблице ответхранение, «Бой» и «В пути» стоят у разных позиций: у каждой своя плитка с числом из таблицы
  for (const [label, field] of [['Ответхранение', 'custody'], ['Бой', 'damaged'], ['В пути \\(из таблицы\\)', 'transit']]) {
    const row = rows.find(r => r[field] > 0 && uniq(r));
    assert.ok(row, `в снимке нет позиции с числом в колонке ${field}`);
    assert.equal(tile(card(row), label), String(row[field]), `плитка «${label}»`);
  }
  const cust = rows.find(r => r.custody > 0 && uniq(r));
  const t = card(cust);
  assert.ok(t.includes('считать ли в свободном — нет данных'), 'у ответхранения нет пометки');
  for (const label of ['В резерве', 'Свободно сейчас', 'Свободно после прихода']) assert.ok(t.includes(label), `нет «${label}»`);
  // у позиции без числа в «Бое» — «нет данных», не 0
  const noDmg = rows.find(r => r.damaged === null && r.ip > 0 && uniq(r));
  assert.equal(tile(card(noDmg), 'Бой'), 'нет данных');
});

test('«свободно»: список, карточка и форма резерва показывают число из Stock.summary — одно и то же', () => {
  const app = load();
  const { Stock } = app;
  const p = app.S.products.find(x => { const k = Stock.summary(app.S, x.id, new Date()); return k.known && k.reservedStock > 0 && k.free > 0 && k.free < 1000 && k.onHand < 1000; });
  assert.ok(p, 'нет позиции с остатком и резервом со склада');
  const k = Stock.summary(app.S, p.id, new Date());
  assert.notEqual(k.free, k.onHand, 'проверка слабая: свободное совпало с остатком');
  app.S.ui.sq = p.id;
  assert.equal(freeCell(app, p.id), String(k.free), 'в списке свободно не то');
  const body = plain(app.DRAWERS.product(p.id).body);
  assert.equal(body.match(/Свободно сейчас (\d+)/)[1], String(k.free), 'в карточке свободно не то');
  assert.equal(body.match(/Свободно после прихода (-?\d+)/)[1], String(k.freeAfter));
  assert.ok(body.includes(`Со склада — свободно ${k.free}`), 'в форме резерва свободно не то');
  // резерв уменьшает число везде сразу
  const cell = Stock.bestCell(app.S, p.id);
  const r = Stock.reserve(app.S, { productId: p.id, qty: 1, entityId: cell.entityId, cityId: cell.cityId, dealId: app.S.deals[0].id, until: new Date(), by: 'p2', at: new Date() });
  assert.ok(r.ok, r.reason);
  const k2 = Stock.summary(app.S, p.id, new Date());
  assert.equal(k2.free, k.free - 1);
  assert.ok(plain(app.DRAWERS.product(p.id).body).includes(`Со склада — свободно ${k2.free}`));
  assert.equal(freeCell(app, p.id), String(k2.free));
});

test('форма резерва: по умолчанию клетка bestCell, подсказка «можно поставить» из canReserve; больше нельзя — ошибка canReserve с числом', () => {
  const app = load();
  app.render();
  const { Stock } = app;
  const row = app.STOCK_SNAPSHOT.rows.find(r => r.name === 'Солнечная панель HAVEL 340');
  const p = app.S.products.find(x => x.name === row.name);
  app.S.reserves = app.S.reserves.filter(r => r.productId !== p.id);
  const body = app.DRAWERS.product(p.id).body;
  assert.match(body, /<option value="ip" selected>/, 'юрлицо по умолчанию — не клетка bestCell');
  assert.match(body, /<option value="_" selected>нет данных: город/, 'город по умолчанию — не клетка bestCell');
  assert.ok(plain(body).includes(`Можно поставить: ${row.ip}`), 'нет подсказки, сколько можно');
  // выбрали другую клетку — подсказка пересчитана тем же canReserve
  const el = id => app.document.getElementById(id);
  el('rs-src').value = 'stock'; el('rs-ent').value = 'npp'; el('rs-city').value = 'msk';
  app.S.ui.drawer = { type: 'product', id: p.id };
  fire(app, 'change', 'rsmax', 'npp');
  assert.equal(el('rs-max').textContent, `Можно поставить: ${Stock.canReserve(app.S, { productId: p.id, qty: 1, entityId: 'npp', cityId: 'msk', src: 'stock' }).max}`);
  assert.match(el('rs-max').textContent, /: 0$/);
  // больше свободного — отказ словами canReserve, число в тексте
  el('rs-deal').value = app.S.deals[0].id; el('rs-src').value = 'stock'; el('rs-ent').value = 'ip'; el('rs-city').value = '_';
  el('rs-qty').value = String(row.ip + 7); el('rs-until').value = app.iso(app.day(3));
  const before = app.S.reserves.length;
  app.FORMS.reserve({ dataset: { pid: p.id } });
  const why = Stock.canReserve(app.S, { productId: p.id, qty: row.ip + 7, entityId: 'ip', cityId: '_', src: 'stock' }).reason;
  assert.equal(el('rs-err').textContent, why);
  assert.ok(why.includes(String(row.ip)));
  assert.equal(app.S.reserves.length, before, 'резерв больше свободного поставлен');
});

test('журнал движений: кто, когда, что, сколько, откуда и куда; фильтры по товару и по виду', () => {
  const app = load();
  const { Stock, S } = app;
  const pid = 'sheet-004';
  const t0 = new Date(2026, 9, 31, 9, 5);
  const mv = Stock.move(S, { kind: Stock.KINDS.transfer, productId: pid, qty: 1, entityId: 'ip', cityId: '_', toEntityId: 'npp', toCityId: 'msk', doc: 'Т-1', by: 'p5', at: t0 });
  assert.ok(mv.ok, mv.reason);
  const html = stockView(app, 'moves');
  const view = plain(html);
  assert.match(view, new RegExp(`Показано ${S.moves.length} из ${S.moves.length} движ`), 'число движений не видно');
  for (const part of [app.person('p5').name, 'Перемещение', 'Т-1', 'ИП', 'НПП', 'Москва']) assert.ok(view.includes(part), `в журнале нет «${part}»`);
  assert.ok(html.includes('value="Снят резерв"'), 'в фильтре нет вида «Снят резерв»');
  fire(app, 'change', 'mvkind', 'Приход');
  const arrivals = S.moves.filter(m => m.kind === 'Приход').length;
  assert.ok(arrivals > 0);
  assert.match(plain(region(app, 'mv-tbl')), new RegExp(`Показано ${arrivals} из ${S.moves.length}`));
  assert.ok(!plain(region(app, 'mv-tbl')).includes('Перемещение'));
  fire(app, 'change', 'mvkind', '');
  fire(app, 'change', 'mvpid', pid);
  const mine = S.moves.filter(m => m.productId === pid).length;
  assert.ok(mine > 0 && mine < S.moves.length);
  assert.match(plain(region(app, 'mv-tbl')), new RegExp(`Показано ${mine} из ${S.moves.length}`));
  // из карточки товара — в журнал по этому товару
  S.ui.stockTab = 'goods'; S.ui.mvPid = '';
  app.A['stock-journal']({ dataset: { pid } });
  assert.equal(S.view, 'stock'); assert.equal(S.ui.stockTab, 'moves'); assert.equal(S.ui.mvPid, pid);
  // карточка товара показывает те же записи теми же словами
  const card = plain(app.DRAWERS.product(pid).body);
  assert.ok(card.includes('Перемещение') && card.includes(app.person('p5').name));
});

test('«Настройки → Склады и юрлица»: вкладка видна только с правом settings; города и юрлица добавляются и переименовываются; адрес пуст — «нет данных: адрес»', () => {
  const app = load();
  const { S } = app;
  const tab = app.SETTINGS_TABS.find(t => t.id === 'stock');
  assert.ok(tab, 'вкладки нет в реестре');
  assert.equal(tab.label, 'Склады и юрлица');
  assert.ok(app.settingsTabs().some(t => t.id === 'stock'), 'директору вкладка не видна');
  const other = S.people.find(p => !app.Perms.can(S, p.id, 'settings'));
  const director = S.me;
  S.me = other.id;
  assert.ok(!app.settingsTabs().some(t => t.id === 'stock'), 'вкладку видит тот, у кого нет права settings');
  S.me = director;
  // адреса пусты у всех трёх городов
  let html = tab.render();
  assert.equal((html.match(/placeholder="нет данных: адрес"/g) || []).length, 3, 'пустой адрес не подписан');
  for (const n of ['Иркутск', 'Москва', 'Краснодар', 'ИП', 'НПП', 'ВС']) assert.ok(html.includes(`value="${n}"`), `в справочнике нет «${n}»`);
  // переименовать
  fire(app, 'change', 'ent-name', 'ИП Иванов', { id: 'ip' });
  assert.equal(S.entities.find(e => e.id === 'ip').name, 'ИП Иванов');
  fire(app, 'change', 'city-name', 'Москва-Север', { id: 'msk' });
  assert.equal(S.cities.find(c => c.id === 'msk').name, 'Москва-Север');
  // пустое и повтор названия не принимаются
  fire(app, 'change', 'ent-name', '   ', { id: 'ip' });
  assert.equal(S.entities.find(e => e.id === 'ip').name, 'ИП Иванов');
  fire(app, 'change', 'ent-name', 'нпп', { id: 'vs' });
  assert.equal(S.entities.find(e => e.id === 'vs').name, 'ВС', 'юрлицу дали название другого юрлица');
  // адрес
  fire(app, 'change', 'city-addr', 'Иркутск, ул. Ленина, 1', { id: 'irk' });
  html = tab.render();
  assert.ok(html.includes('value="Иркутск, ул. Ленина, 1"'));
  assert.equal((html.match(/placeholder="нет данных: адрес"/g) || []).length, 2);
  // добавить
  const el = id => app.document.getElementById(id);
  el('ent-new').value = 'ООО Тест'; app.FORMS['entity-add']({});
  el('city-new').value = 'Новосибирск'; el('city-new-addr').value = ''; app.FORMS['city-add']({});
  assert.equal(S.entities.length, 4); assert.equal(S.cities.length, 4);
  assert.deepEqual([S.entities[3].name, S.cities[3].name, S.cities[3].address], ['ООО Тест', 'Новосибирск', '']);
  assert.equal(new Set(S.entities.map(e => e.id)).size, 4);
  assert.equal(new Set(S.cities.map(c => c.id)).size, 4);
  el('city-new').value = 'новосибирск'; app.FORMS['city-add']({});
  assert.equal(S.cities.length, 4, 'город с тем же названием добавился второй раз');
  assert.ok(el('city-err').textContent.length > 0);
  // новое юрлицо и город сразу есть в карточке товара (сетка и форма резерва)
  const p = S.products.find(x => x.name === 'Солнечная панель HAVEL 340');
  const body = app.DRAWERS.product(p.id).body;
  assert.ok(body.includes('ООО Тест') && body.includes('Новосибирск') && body.includes('ИП Иванов'));
  // справочники сохраняются
  const back = app.Store.load(app.Store.dump(S).text);
  assert.equal(back.entities[3].name, 'ООО Тест'); assert.equal(back.cities[0].address, 'Иркутск, ул. Ленина, 1');
});

test('«Настройки → Склады и юрлица»: источник каталога и склейка названы словами из таска', () => {
  const app = load();
  const t = plain(app.SETTINGS_TABS.find(x => x.id === 'stock').render());
  assert.ok(t.includes('Источник каталога: копия таблицы для CRM — нет данных: ссылка; сейчас — снимок таблицы PVCalc на 31.10.2026'));
  assert.ok(t.includes('Склеено по названию 16 из 208 строк таблицы менеджеров; остальные — «нет в каталоге»'));
});
