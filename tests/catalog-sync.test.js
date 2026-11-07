'use strict';
// Каталог из таблицы PVCalc: артикулы товаров сайта и лист «Электрика» (Сибэлком, Энергосфера) — товары поставщиков, которых может
// не быть на складе. Здесь: форма снимка (src/js/10-catalog-data.js), его генератор tools/catalog-snapshot.js, Catalog.merge,
// шаг MIGRATIONS[21] у рабочей базы, карточка товара и кнопка «Обновить каталог из снимка». Слова директора — «Заказывают срочно и
// потом оприходуют»; цена поставщика не цена продажи. Данные в тестах искусственные (цифры реальных позиций не сверяются).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { load } = require('./load.js');
const kit = require('./server-kit.js');
const gen = require('../tools/catalog-snapshot.js');

const plain = v => JSON.parse(JSON.stringify(v === undefined ? null : v));
const text = html => String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const asDirector = app => { app.setMe(app.S.people.find(p => p.role === 'director').id); return app; };
const HEAD = ['Код позиции (не менять)', 'Название', 'Артикул', 'Ед.', 'Цена, ₽', 'Дата цены', 'Ссылка на карточку'];

// ——— снимок ———
test('снимок: лист «Электрика» — у каждой позиции поставщик по домену ссылки, цена продажи пуста, категория «Электрика › …»', () => {
  const { CATALOG } = load();
  const el = CATALOG.rows.filter(r => r.sheet === 'Электрика');
  assert.ok(el.length >= 30, 'лист «Электрика» не загружен');
  const by = { 'sibelkom.ru': 'Сибэлком', 'energosf.ru': 'Энергосфера' };
  for (const r of el) {
    assert.ok(r.key.startsWith('supplier-'), r.key);
    assert.equal(r.price, null, `${r.key}: цена продажи у товара поставщика должна быть пустой`);
    assert.ok(r.cat === 'Электрика' || r.cat.startsWith('Электрика › '), `${r.key}: категория «${r.cat}»`);
    assert.ok(r.supplierPrice === null || (typeof r.supplierPrice === 'number' && r.supplierPrice > 0), `${r.key}: цена поставщика`);
    if (r.url) assert.equal(r.supplier, by[new URL(r.url).hostname.replace(/^www\./, '')], `${r.key}: поставщик не по домену ссылки`);
    else assert.equal(r.supplier, null, `${r.key}: нет ссылки — нет поставщика, не выдуманный`);
  }
  assert.ok(el.some(r => r.supplier === 'Сибэлком') && el.some(r => r.supplier === 'Энергосфера'));
  const pref = { 'supplier-breaker-': 'Электрика › Автоматы', 'supplier-cable-': 'Электрика › Кабель', 'supplier-enclosure-': 'Электрика › Щиты и боксы', 'supplier-spd-': 'Электрика › УЗИП' };
  for (const r of el) { const k = Object.keys(pref).find(p => r.key.startsWith(p)); assert.equal(r.cat, k ? pref[k] : 'Электрика', r.key); }
  // позиция, в которой в таблице почти пусто, загружена как есть, без выдуманного
  const bare = el.find(r => r.url === null && r.supplierPrice === null);
  assert.ok(bare, 'позиция без цены и ссылки должна быть в снимке');
  assert.deepEqual([bare.sku, bare.unit, bare.priceDate], [null, null, null]);
});

test('снимок: артикулы проставлены почти у всех позиций сайта, пустой остаётся пустым (не ключ и не название)', () => {
  const { CATALOG } = load();
  const site = CATALOG.rows.filter(r => r.sheet !== 'Электрика');
  const withSku = site.filter(r => r.sku);
  assert.ok(withSku.length / site.length > 0.9, `артикулов ${withSku.length} из ${site.length}`);
  for (const r of site) {
    assert.ok(r.sku === null || (typeof r.sku === 'string' && r.sku === r.sku.trim() && r.sku.length <= 60), `${r.key}: артикул`);
    if (r.sku) assert.notEqual(r.sku, r.key, `${r.key}: в артикул подставлен ключ`);
  }
  assert.ok(site.some(r => r.sku === null), 'в таблице есть позиции без артикула — в снимке они пустые');
});

test('в продукте после build: sku, unit и данные поставщика переходят из снимка; у позиции без них полей нет', () => {
  const a = load();
  const built = a.Catalog.build(a.CATALOG, { rows: [] }).products;
  const one = a.CATALOG.rows.find(r => r.supplier && r.supplierPrice && r.sku && r.priceDate);
  const p = built.find(x => x.id === one.key);
  assert.deepEqual([p.sku, p.unit, p.supplier, p.supplierPrice, p.priceDate, p.price, p.url], [one.sku, one.unit, one.supplier, one.supplierPrice, one.priceDate, null, one.url]);
  const bare = built.find(x => x.id === 'supplier-cable-ac-3x25');
  for (const f of ['sku', 'unit', 'supplier', 'supplierPrice', 'priceDate']) assert.equal(f in bare, false, `у пустой позиции не должно быть поля ${f}`);
  assert.equal(bare.url, null);
});

// ——— генератор снимка ———
test('генератор: цена «1 569,32» разбирается верно, пустое и мусор — null; поставщик по домену; категория по префиксу кода', () => {
  assert.equal(gen.money('1 569,32'), 1569.32);
  assert.equal(gen.money('1 569,32'), 1569.32);
  assert.equal(gen.money('467,14'), 467.14);
  assert.equal(gen.money('2250'), 2250);
  assert.equal(gen.money(''), null);
  assert.equal(gen.money(undefined), null);
  assert.equal(gen.money('по запросу'), null);
  assert.equal(gen.supplierOf('https://www.sibelkom.ru/catalog/x/'), 'Сибэлком');
  assert.equal(gen.supplierOf('https://energosf.ru/catalog/x/'), 'Энергосфера');
  assert.equal(gen.supplierOf('https://example.com/sibelkom.ru'), null, 'домен только в пути — не поставщик');
  assert.equal(gen.supplierOf(''), null);
  assert.equal(gen.catOf('supplier-spd-dc'), 'Электрика › УЗИП');
  assert.equal(gen.catOf('supplier-fuse-1'), 'Электрика', 'неизвестный префикс');
});

test('генератор: свод выгрузки со снимком — артикулы по ключу, «Электрика» с нуля, пустое остаётся null, повтор даёт тот же файл', () => {
  const prev = { source: 'S', snapshot: '2026-10-31', rows: [
    { key: '1', model: 'Инвертор А', brand: 'X', price: 100, avail: 'в наличии', url: 'https://wind-solar.ru/a', from: null, cat: 'инвертор', sheet: 'Инверторы' },
    { key: '2', model: "Панель Б'в", brand: null, price: null, avail: null, url: null, from: null, cat: 'панель', sheet: 'Панели' },
    { key: 'supplier-old', model: 'Прежняя электрика', brand: null, price: null, avail: null, url: null, from: null, cat: 'Электрика', sheet: 'Электрика', sku: 'OLD' },
  ] };
  const dump = { date: '2026-11-07', sheets: { Инверторы: [['1', ' ABC-1 ']], Панели: [['2', '']] }, electrics: { header: [...HEAD].reverse(), rows: [] } };
  dump.electrics.header = HEAD;
  dump.electrics.rows = [
    ['supplier-breaker-x', 'Автомат', 'A-16', 'шт', '1 569,32', '2026-09-07', 'https://sibelkom.ru/c/'],
    ['supplier-cable-y', 'Кабель', '', 'м', '', '', ''],
    ['', 'строка без кода'],
  ];
  const { catalog, report } = gen.build(prev, dump);
  assert.equal(report.skuSet, 1);
  assert.deepEqual(catalog.rows.map(r => r.key), ['1', '2', 'supplier-breaker-x', 'supplier-cable-y'], 'старая «Электрика» заменена, строка без кода отброшена');
  assert.equal(catalog.rows[0].sku, 'ABC-1');
  assert.equal(catalog.rows[1].sku, null, 'пустой артикул — null, не ключ и не название');
  const e = catalog.rows[2];
  assert.deepEqual([e.model, e.sku, e.unit, e.price, e.supplier, e.supplierPrice, e.priceDate, e.cat], ['Автомат', 'A-16', 'шт', null, 'Сибэлком', 1569.32, '2026-09-07', 'Электрика › Автоматы']);
  const c = catalog.rows[3];
  assert.deepEqual([c.sku, c.unit === 'м', c.supplier, c.supplierPrice, c.priceDate, c.url], [null, true, null, null, null, null]);
  // записанный файл читается обратно тем же кодом и повтор прогона ничего не меняет
  const file = gen.render('// шапка\r\nconst CATALOG = {};\r\n', catalog, '2026-11-07');
  assert.ok(file.includes("Панель Б\\'в"), 'апостроф экранирован');
  assert.ok(file.includes('\r\n'), 'переводы строк как в исходном файле');
  const back = gen.load(file);
  assert.deepEqual(plain(back), plain(catalog));
  assert.equal(gen.render(file, gen.build(back, dump).catalog, '2026-11-07'), file);
  // столбец ищется по заголовку, а не по номеру
  const moved = { ...dump, electrics: { header: ['Лишний', ...HEAD], rows: dump.electrics.rows.map(r => ['x', ...r]) } };
  assert.equal(gen.build(prev, moved).catalog.rows[2].sku, 'A-16');
  assert.throws(() => gen.build(prev, { ...dump, electrics: { header: ['Название'], rows: [] } }), /нет столбца/);
});

// ——— Catalog.merge ———
function oldBase(a) {
  // рабочая база «как была»: товары сайта без артикулов и данных поставщика, без «Электрики»
  const { Catalog, CATALOG } = a;
  const rows = CATALOG.rows.filter(r => r.sheet !== 'Электрика').map(r => { const { sku, ...rest } = r; return rest; });
  const st = { products: Catalog.build({ ...CATALOG, rows }, { rows: [] }).products };
  st.categories = Catalog.treeFrom(st.products);
  return st;
}
test('Catalog.merge: добавляет товары снимка и «Электрику» с категориями, ставит артикулы; цены продажи и названия не трогает', () => {
  const a = load(), { Catalog, CATALOG } = a;
  const st = oldBase(a), before = plain(st.products);
  const n0 = st.products.length;
  const r = Catalog.merge(st, CATALOG);
  const el = CATALOG.rows.filter(x => x.sheet === 'Электрика');
  assert.equal(r.added.length, el.length);
  assert.equal(st.products.length, n0 + el.length);
  const expectSku = CATALOG.rows.filter(x => x.sheet !== 'Электрика' && x.sku).length;
  assert.equal(r.skuSet, expectSku);
  assert.equal(st.products.filter(p => p.sheet !== 'Электрика' && Catalog.skuOf(p)).length, expectSku);
  for (const p of before) {
    const now = st.products.find(x => x.id === p.id);
    assert.equal(now.name, p.name); assert.equal(now.price, p.price); assert.equal(now.cat, p.cat);
  }
  for (const p of st.products.filter(x => x.sheet === 'Электрика')) {
    assert.equal(p.price, null);
    assert.equal(Catalog.hasPath(st, p.cat), true, `${p.name}: категории «${p.cat}» нет в дереве`);
  }
  for (const path of ['Электрика', 'Электрика › Автоматы', 'Электрика › Кабель', 'Электрика › Щиты и боксы', 'Электрика › УЗИП']) assert.ok(Catalog.nodeOf(st, path), `нет узла «${path}»`);
  assert.equal(r.categories.length, st.categories.length - Catalog.treeFrom(before).length);
  // второй раз — ничего нового
  const again = Catalog.merge(st, CATALOG);
  assert.deepEqual([again.added.length, again.filled.length, again.skuSet, again.categories.length], [0, 0, 0, 0]);
});

test('Catalog.merge: введённое вручную не затирается — свой артикул, своя цена, своё название, свой поставщик', () => {
  const a = load(), { Catalog, CATALOG } = a;
  const st = oldBase(a);
  const site = CATALOG.rows.find(x => x.sheet !== 'Электрика' && x.sku && x.price);
  const mine = st.products.find(p => p.id === site.key);
  Object.assign(mine, { sku: 'МОЙ-АРТ', price: 1, name: 'Моё название', url: 'https://mine.example/x' });
  const el = CATALOG.rows.find(x => x.sheet === 'Электрика' && x.supplier && x.supplierPrice && x.priceDate && x.sku);
  // электрика уже заведена вручную под тем же кодом: часть полей своя, часть пустая
  st.products.push({ id: el.key, name: 'Своё название автомата', brand: null, cat: 'Без раздела', price: 500, avail: null, url: null, src: 'user', inCatalog: false, sku: 'РУЧНОЙ', supplierPrice: 7 });
  const r = Catalog.merge(st, CATALOG);
  assert.equal(mine.sku, 'МОЙ-АРТ'); assert.equal(mine.price, 1); assert.equal(mine.name, 'Моё название'); assert.equal(mine.url, 'https://mine.example/x');
  const m = st.products.find(p => p.id === el.key);
  assert.deepEqual([m.name, m.cat, m.price, m.sku, m.supplierPrice], ['Своё название автомата', 'Без раздела', 500, 'РУЧНОЙ', 7], 'своё осталось');
  assert.deepEqual([m.supplier, m.priceDate, m.url], [el.supplier, el.priceDate, el.url], 'пустое заполнено');
  assert.ok(r.filled.includes(m.id));
  assert.ok(!r.added.includes(m.id), 'товар с таким id не задваивается');
  assert.equal(st.products.filter(p => p.id === el.key).length, 1);
  assert.equal(r.skuSet, CATALOG.rows.filter(x => x.sheet !== 'Электрика' && x.sku).length - 1, 'у товара со своим артикулом артикул не считается проставленным');
});

// ——— карточка и кнопка ———
test('карточка товара «Электрики»: «Цена поставщика (Сибэлком): … на 07.09.2026», ссылка на карточку поставщика, цена продажи — «нет данных: цена»', () => {
  const a = asDirector(load());
  const row = a.CATALOG.rows.find(x => x.supplier === 'Сибэлком' && x.supplierPrice && x.priceDate && x.url);
  const p = a.S.products.find(x => x.id === row.key);
  assert.ok(p, 'товара поставщика нет в демо');
  const body = a.DRAWERS.product(p.id).body, t = text(body);
  const day = row.priceDate.split('-').reverse().join('.');
  assert.ok(t.includes(`Цена поставщика (Сибэлком) ${a.rub(row.supplierPrice)} на ${day}`), t.slice(0, 600));
  assert.match(t, /Цена нет данных: цена/);
  assert.ok(body.includes(`href="${row.url}"`) && /Карточка у поставщика/.test(body));
  // позиция почти без данных: честно «нет данных», цены поставщика и ссылки нет
  const bare = a.S.products.find(x => x.id === 'supplier-cable-ac-3x25');
  const bt = text(a.DRAWERS.product(bare.id).body);
  assert.match(bt, /Цена поставщика нет данных: цена поставщика поставщик: нет данных/);
  assert.ok(!/href="https?:/.test(a.DRAWERS.product(bare.id).body));
  // товар сайта: строки про поставщика нет
  const site = a.S.products.find(x => x.sheet === 'Панели');
  assert.ok(!text(a.DRAWERS.product(site.id).body).includes('Цена поставщика'));
});

// ——— кнопка на экране настоящего сервера ———
function browser(srv) {
  const jar = { cookie: '' }, calls = [];
  async function bfetch(url, opt = {}) {
    calls.push({ method: opt.method || 'GET', url });
    const headers = { ...(opt.headers || {}) };
    if (jar.cookie) headers.cookie = jar.cookie;
    const res = await fetch(srv.url + url, { ...opt, headers });
    const set = res.headers.get('set-cookie');
    if (set) jar.cookie = /Max-Age=0/i.test(set) ? '' : set.split(';')[0];
    return res;
  }
  return { calls, fetch: bfetch };
}
async function openPage(srv, login, password) {
  const b = browser(srv);
  class QuietEventSource { constructor() { this.readyState = 1; } addEventListener() {} close() {} }
  const window = { addEventListener() {}, focus() {} };
  const app = load({ globals: { CRM_SERVER: 1, fetch: b.fetch, EventSource: QuietEventSource, window, location: { hash: '', reload() {} }, atob, Blob } });
  assert.equal(await app.serverBoot(), 'gate');
  assert.equal(await app.serverLogin(login, password), 'ready');
  return { app, b };
}
const posts = w => w.b.calls.filter(c => c.url === '/api/changes' && c.method === 'POST').length;

test('«Обновить каталог из снимка»: в демо кнопки нет; на сервере — одно действие одной записью (артикул правленому товару и дерево), в тосте сколько добавлено и проставлено', async () => {
  assert.ok(!asDirector(load()).vWarehouses().includes('catalog-merge'), 'в демо каталог и так равен снимку — кнопки нет');
  const srv = await kit.start();
  const dir = srv.dir;
  const boss = await kit.director(srv);
  await srv.stop(true);
  const file = path.join(dir, 'crm.db');
  const a = load();
  const site = a.CATALOG.rows.find(x => x.sheet === 'Панели' && x.sku && x.price);
  const d = new DatabaseSync(file);
  // рабочая база ревизии 21, созданная до обновления снимка: у правленого товара нет артикула, «Электрики» в дереве нет
  const mine = { ...a.Catalog.build(a.CATALOG, { rows: [] }).products.find(p => p.id === site.key), price: 123 };
  delete mine.sku;
  d.prepare("INSERT INTO docs (key, id, data, ver, seq) VALUES ('products', ?, ?, 1, 0)").run(site.key, JSON.stringify(mine));
  d.prepare("DELETE FROM docs WHERE key = 'categories' AND data LIKE '%Электрика%'").run();
  const wasNodes = d.prepare("SELECT COUNT(*) AS n FROM docs WHERE key = 'categories'").get().n;
  d.close();
  const again = await kit.start({ dataDir: dir });
  try {
    const w = await openPage(again, boss.login, boss.password), A = w.app;
    const said = [];
    A.byId('toasts').appendChild = el => said.push(el.innerHTML || '');
    A.S.view = 'settings'; A.render();
    assert.ok(A.vWarehouses().includes('data-act="catalog-merge"') && A.vWarehouses().includes('Обновить каталог из снимка'));
    assert.equal(A.Catalog.skuOf(A.S.products.find(p => p.id === site.key)), '');
    assert.ok(A.S.products.some(p => p.sheet === 'Электрика'), 'товары поставщиков приходят из кода сами');
    assert.equal(A.Catalog.nodeOf(A.S, 'Электрика › Автоматы'), null);
    const before = posts(w);
    A.A['catalog-merge']();
    await A.serverIdle();
    assert.equal(posts(w) - before, 1, 'одно действие — одна запись на сервер');
    assert.ok(said.join(' ').includes('добавлено 0 товаров, артикулов проставлено 1'), said.join(' | '));
    const st = await kit.state(again, (await kit.login(again, boss.login, boss.password)).cookie);
    const m = st.products.find(p => p.id === site.key);
    assert.equal(m.sku, site.sku); assert.equal(m.price, 123, 'своя цена цела');
    for (const p of ['Электрика › Автоматы', 'Электрика › Кабель', 'Электрика › Щиты и боксы', 'Электрика › УЗИП']) assert.ok(a.Catalog.nodeOf(st, p), `на сервере нет узла «${p}»`);
    for (const p of st.products.filter(x => x.sheet === 'Электрика')) assert.equal(a.Catalog.hasPath(st, p.cat), true, `${p.name}: «${p.cat}» нет в дереве`);
    assert.ok(st.categories.length > wasNodes);
    // повтор: нечего делать — на сервер не уходит ничего
    const b2 = posts(w);
    A.A['catalog-merge'](); await A.serverIdle();
    assert.equal(posts(w) - b2, 0, 'нечего добавлять — записи нет');
  } finally { await again.stop(true); }
  fs.rmSync(dir, { recursive: true, force: true });
});

// ——— рабочая база: шаг MIGRATIONS[21] ———
test('сервер: база ревизии 20 доводится до 21 — правленому товару дописывается пустое, введённое вручную и снятое остаются, дерево получает «Электрику»', async () => {
  const srv = await kit.start();
  const dir = srv.dir;
  await kit.director(srv);
  await srv.stop(true);
  const file = path.join(dir, 'crm.db');
  const a = load();
  const base = new Map(a.Catalog.build(a.CATALOG, { rows: [] }).products.map(p => [p.id, p]));
  const [s1, s2, s3] = a.CATALOG.rows.filter(x => x.sheet === 'Инверторы' && x.sku).slice(0, 3);
  const sup = a.CATALOG.rows.find(x => x.sheet === 'Электрика' && x.supplier && x.supplierPrice && x.priceDate);
  const d = new DatabaseSync(file);
  const put = (id, p) => d.prepare("INSERT INTO docs (key, id, data, ver, seq) VALUES ('products', ?, ?, 1, 0)").run(id, JSON.stringify(p));
  // база «как была»: правленые товары — полные записи без артикула; у одного артикул поставлен руками; один снят из списка;
  // товар поставщика правили руками (своя цена продажи)
  const strip = id => { const p = { ...base.get(id) }; delete p.sku; return p; };
  put(s1.key, { ...strip(s1.key), price: 111 });
  put(s2.key, { ...strip(s2.key), sku: 'МОЙ-АРТ' });
  d.prepare("INSERT INTO docs (key, id, data, ver, seq) VALUES ('products', ?, 'null', 1, 0)").run(s3.key);
  const edited = { ...base.get(sup.key), price: 777 };
  delete edited.supplier; delete edited.priceDate;
  put(sup.key, edited);
  d.prepare("DELETE FROM docs WHERE key = 'categories' AND data LIKE '%Электрика%'").run();
  d.prepare("UPDATE meta SET v = '20' WHERE k = 'rev'").run();
  d.close();
  const again = await kit.start({ dataDir: dir });
  try {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      assert.equal(db.prepare("SELECT v FROM meta WHERE k = 'rev'").get().v, String(a.Store.REV));
      const doc = id => { const r = db.prepare("SELECT data FROM docs WHERE key = 'products' AND id = ?").get(id); return r ? JSON.parse(r.data) : undefined; };
      assert.deepEqual([doc(s1.key).sku, doc(s1.key).price], [s1.sku, 111], 'пустой артикул дописан, цена своя');
      assert.equal(doc(s2.key).sku, 'МОЙ-АРТ', 'артикул, поставленный руками, цел');
      assert.equal(doc(s3.key), null, 'снятый из списка товар не вернулся');
      const m = doc(sup.key);
      assert.deepEqual([m.price, m.supplier, m.priceDate], [777, sup.supplier, sup.priceDate], 'у товара поставщика своя цена цела, пустое дописано');
      const names = db.prepare("SELECT data FROM docs WHERE key = 'categories'").all().map(r => JSON.parse(r.data).name);
      for (const n of ['Электрика', 'Автоматы', 'Кабель', 'Щиты и боксы', 'УЗИП']) assert.ok(names.includes(n), `нет узла «${n}»`);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM docs WHERE key = 'products'").get().n, 4, 'лишних документов товаров не появилось');
    } finally { db.close(); }
  } finally { await again.stop(true); }
  fs.rmSync(dir, { recursive: true, force: true });
});
