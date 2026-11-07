'use strict';
// Слова директора 2026-11-07: «Новые товары — пусть все могут создавать пока. Мне нужен список номенклатуры в стиле иерархия. Нужна
// возможность добавления категории товара и подкатегорий. Например, электрика — это категория, автоматы — подкатегория, трёхпозиционные
// переключатели, АВР — тоже подкатегории, и так далее».
// Здесь: право «Добавлять товары» у всех ролей (REV 20), дерево категорий (Catalog), права сервера (Guard), перенос рабочей базы
// (MIGRATIONS[20]) и экран («Товары и остатки» с деревом слева, окно «Категории»). Данные искусственные.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { load: loadRaw } = require('./load.js');
const kit = require('./server-kit.js');

// В снимке каталога теперь есть настоящая «Электрика» поставщиков (Сибэлком, Энергосфера) со своим деревом. Эти тесты проверяют само дерево
// на выдуманных «Электрика → Автоматы → АВР», поэтому убираем из демо настоящие товары и узлы этой ветки: дерево и товары — как были.
function withoutSupplierBranch(a) {
  if (!a.S) return a;
  a.S.products = a.S.products.filter(p => p.sheet !== 'Электрика');
  const gone = new Set((a.S.categories || []).filter(c => /^Электрика( › |$)/.test(a.Catalog.pathOf(a.S, c.id))).map(c => c.id));
  a.S.categories = (a.S.categories || []).filter(c => !gone.has(c.id));
  return a;
}
const load = opts => withoutSupplierBranch(loadRaw(opts));
const plain = v => JSON.parse(JSON.stringify(v === undefined ? null : v));
const deq = (actual, expected, msg) => assert.deepEqual(plain(actual), plain(expected), msg);
const NOW = new Date(2026, 10, 7, 12, 0, 0);
const SEP = ' › ';

// Демо с деревом «Электрика → Автоматы → АВР» и «Электрика → Трёхпозиционные переключатели»; в «Автоматы» один тестовый товар
function tree(a) {
  const { Catalog, S } = a;
  const el = Catalog.catAdd(S, { name: 'Электрика' }).node;
  const au = Catalog.catAdd(S, { name: 'Автоматы', parentId: el.id }).node;
  const avr = Catalog.catAdd(S, { name: 'АВР', parentId: el.id }).node;
  const sw = Catalog.catAdd(S, { name: 'Трёхпозиционные переключатели', parentId: el.id }).node;
  return { el, au, avr, sw };
}
const addProduct = (a, name, cat) => { const r = a.Catalog.add(a.S, { name, cat }); assert.equal(r.ok, true, r.reason); return r.product; };

// ——— право и начальное дерево ———
test('право «Добавлять товары в номенклатуру» — у каждой встроенной роли и у каждого сотрудника демо (слово директора 2026-11-07)', () => {
  const a = load();
  for (const r of a.S.roles.filter(x => x.builtin)) assert.equal(r.perms.catalog, true, `у роли «${r.name}» нет права catalog`);
  for (const p of a.S.people) assert.equal(a.Perms.can(a.S, p.id, 'catalog'), true, `${p.name} не может добавлять товары`);
  assert.ok(a.Store.REV >= 20, 'форма записей изменилась (дерево категорий, артикул, право) — REV не ниже 20');
});

test('демо и пустая рабочая база: дерево собрано из категорий товаров, у каждого товара путь есть в дереве; верхний уровень — в привычном порядке', () => {
  const a = load(), s = a.seedBase();
  for (const [what, st] of [['демо', a.S], ['seedBase', s]]) {
    assert.ok(st.categories.length > 0, `${what}: дерева нет`);
    assert.equal(new Set(st.categories.map(c => c.id)).size, st.categories.length, `${what}: id узлов повторяются`);
    for (const p of st.products) assert.equal(a.Catalog.hasPath(st, p.cat), true, `${what}: у «${p.name}» категории «${p.cat}» нет в дереве`);
    // слово директора 2026-11-08: после инверторов — новая категория «ИБП»
    deq(st.categories.filter(c => !c.parentId).map(c => c.name).slice(0, 4), ['Панели', 'Инверторы', 'ИБП', 'Аккумуляторы'], `${what}: порядок верхнего уровня`);
  }
  // число товаров в узлах сходится с числом товаров
  const rows = a.Catalog.rows(a.S);
  assert.equal(rows.filter(r => r.depth === 0).reduce((n, r) => n + r.total, 0), a.S.products.length);
  assert.ok(rows.every(r => !r.virtual), 'в свежем демо нет путей вне дерева');
});

// ——— дерево: добавить, переименовать, перенести, удалить ———
test('Catalog.catAdd: электрика → автоматы, АВР, трёхпозиционные переключатели; путь строится из дерева; повтор, пустое, «›» и «Без раздела» — отказ с причиной', () => {
  const a = load(), { Catalog } = a, n0 = a.S.categories.length;
  const t = tree(a);
  assert.equal(a.S.categories.length, n0 + 4);
  deq([Catalog.pathOf(a.S, t.au.id), Catalog.pathOf(a.S, t.avr.id), Catalog.pathOf(a.S, t.sw.id)], ['Электрика › Автоматы', 'Электрика › АВР', 'Электрика › Трёхпозиционные переключатели']);
  const no = (o, re) => { const r = Catalog.catAdd(a.S, o); assert.equal(r.ok, false); assert.match(r.reason, re); assert.equal(a.S.categories.length, n0 + 4, 'отказ не должен менять дерево'); };
  no({ name: ' электрика ' }, /уже есть на верхнем уровне/);
  no({ name: 'ЭЛЕКТРИКА' }, /уже есть/);
  no({ name: 'автоматы', parentId: t.el.id }, /уже есть/);
  no({ name: '   ' }, /Нужно название/);
  no({ name: 'Реле › Таймеры' }, /нельзя знак/);
  no({ name: 'Без раздела' }, /подпись товаров без категории/);
  no({ name: 'Новая', parentId: 'c-нет' }, /Родительской категории нет/);
  // то же имя в другой ветке — можно
  assert.equal(Catalog.catAdd(a.S, { name: 'Автоматы', parentId: a.S.categories.find(c => c.name === 'Панели').id }).ok, true);
});

test('Catalog.catEdit: переименование и перенос меняют пути товаров во всей ветке, чужие не трогают; нельзя внутрь себя, нельзя в занятое имя', () => {
  const a = load(), { Catalog, S } = a, t = tree(a);
  const m1 = addProduct(a, 'Автомат 1P C16 (тест)', 'Электрика › Автоматы');
  const m2 = addProduct(a, 'Автомат 3P C32 (тест)', 'Электрика › Автоматы');
  const sub = Catalog.catAdd(S, { name: 'Модульные', parentId: t.au.id }).node;
  const m3 = addProduct(a, 'Автомат модульный (тест)', 'Электрика › Автоматы › Модульные');
  const other = addProduct(a, 'АВР на 63 А (тест)', 'Электрика › АВР');
  const panels = S.products.filter(p => p.cat === 'Панели').map(p => p.id);
  const r = Catalog.catEdit(S, t.au.id, { name: 'Автоматика' });
  assert.equal(r.ok, true, r.reason);
  deq([r.was, r.now, r.moved], ['Электрика › Автоматы', 'Электрика › Автоматика', 3]);
  deq([m1.cat, m2.cat, m3.cat, other.cat], ['Электрика › Автоматика', 'Электрика › Автоматика', 'Электрика › Автоматика › Модульные', 'Электрика › АВР']);
  assert.equal(Catalog.pathOf(S, sub.id), 'Электрика › Автоматика › Модульные');
  deq(S.products.filter(p => p.cat === 'Панели').map(p => p.id), panels, 'товары другой категории не тронуты');
  // перенос: «Автоматика» на верхний уровень — путь укорачивается у всей ветки
  const mv = Catalog.catEdit(S, t.au.id, { parentId: '' });
  assert.equal(mv.ok, true, mv.reason);
  deq([m1.cat, m3.cat], ['Автоматика', 'Автоматика › Модульные']);
  // нельзя внутрь себя и внутрь своей подкатегории; нельзя под имя, уже занятое рядом
  for (const to of [t.au.id, sub.id]) {
    const bad = Catalog.catEdit(S, t.au.id, { parentId: to });
    assert.equal(bad.ok, false); assert.match(bad.reason, /внутрь себя/);
  }
  const dup = Catalog.catEdit(S, t.au.id, { name: 'Электрика' });
  assert.equal(dup.ok, false); assert.match(dup.reason, /уже есть/);
  deq([m1.cat, m3.cat], ['Автоматика', 'Автоматика › Модульные'], 'отказы не меняют пути товаров');
  assert.equal(Catalog.catEdit(S, 'c-нет', { name: 'X' }).ok, false);
});

test('Catalog.catDelete: пустую можно; с товарами или подкатегориями — нельзя, причина названа числами; пустой путь после удаления ни у кого не остался', () => {
  const a = load(), { Catalog, S } = a, t = tree(a);
  addProduct(a, 'Автомат 1P (тест)', 'Электрика › Автоматы');
  addProduct(a, 'Автомат 2P (тест)', 'Электрика › Автоматы');
  const n = S.categories.length;
  let r = Catalog.catDelete(S, t.au.id);
  assert.equal(r.ok, false); assert.match(r.reason, /«Электрика › Автоматы» нельзя: в ней 2 товара/);
  r = Catalog.catDelete(S, t.el.id);
  assert.equal(r.ok, false); assert.match(r.reason, /3 подкатегории и 2 товара/);
  assert.equal(S.categories.length, n, 'отказ ничего не удалил');
  r = Catalog.catDelete(S, t.avr.id);
  assert.equal(r.ok, true); assert.equal(r.path, 'Электрика › АВР');
  assert.equal(S.categories.length, n - 1);
  assert.equal(Catalog.nodeOf(S, 'Электрика › АВР'), null);
  assert.equal(Catalog.catDelete(S, t.avr.id).ok, false, 'второй раз — такой категории нет');
});

test('Catalog.add: путь заводится в дереве сам (существующие узлы берутся как есть, без регистра); пустая — «Без раздела»; setCat проверяет дерево', () => {
  const a = load(), { Catalog, S } = a, t = tree(a), n = S.categories.length;
  assert.equal(addProduct(a, 'Автомат А (тест)', 'электрика › автоматы').cat, 'Электрика › Автоматы', 'путь берётся из дерева');
  assert.equal(S.categories.length, n, 'новых узлов не появилось');
  assert.equal(addProduct(a, 'Реле Б (тест)', 'Электрика › Реле › Время').cat, 'Электрика › Реле › Время');
  assert.equal(S.categories.length, n + 2, 'недостающие уровни заведены');
  assert.equal(addProduct(a, 'Мелочь В (тест)', '').cat, 'Без раздела');
  assert.equal(S.categories.some(c => c.name === 'Без раздела'), false, '«Без раздела» — не узел дерева');
  const p = S.products.find(x => x.name === 'Автомат А (тест)');
  assert.equal(Catalog.setCat(S, p.id, 'Электрика › АВР').ok, true);
  assert.equal(p.cat, 'Электрика › АВР');
  const bad = Catalog.setCat(S, p.id, 'Электрика › Нет такой');
  assert.equal(bad.ok, false); assert.match(bad.reason, /нет в списке категорий/);
  assert.equal(p.cat, 'Электрика › АВР', 'отказ не меняет товар');
  assert.equal(Catalog.setCat(S, p.id, 'Без раздела').ok, true);
  assert.equal(p.cat, 'Без раздела');
  assert.equal(t.el.name, 'Электрика');
});

test('Catalog.query: выбранная категория показывает товары всех подкатегорий; «Без раздела» — товары без категории; поиск работает поверх', () => {
  const a = load(), { Catalog, S } = a;
  tree(a);
  const x1 = addProduct(a, 'Тест Автомат один', 'Электрика › Автоматы'), x2 = addProduct(a, 'Тест Реле два', 'Электрика'), x3 = addProduct(a, 'Тест Переключатель три', 'Электрика › Трёхпозиционные переключатели');
  const free = addProduct(a, 'Тест Без категории', '');
  const ids = list => list.map(p => p.id).sort();
  deq(ids(Catalog.query(S, { cat: 'Электрика' })), ids([x1, x2, x3]), 'родитель = свои и все подкатегории');
  deq(ids(Catalog.query(S, { cat: 'Электрика › Автоматы' })), [x1.id]);
  deq(ids(Catalog.query(S, { cat: 'Электрика', q: 'реле' })), [x2.id], 'поиск поверх категории');
  deq(ids(Catalog.query(S, { cat: 'Без раздела' })), [free.id]);
  assert.equal(Catalog.query(S, { cat: 'Электрик' }).length, 0, 'похожее начало — не та категория');
  assert.equal(Catalog.query(S, {}).length, S.products.length, 'без категории — все');
});

test('Catalog.rows: число товаров с подкатегориями; путь, которого нет в дереве (старые данные), показан узлом без id, товары не теряются', () => {
  const a = load(), { Catalog, S } = a, t = tree(a);
  addProduct(a, 'Тест А', 'Электрика › Автоматы'); addProduct(a, 'Тест Б', 'Электрика');
  S.products.push({ id: 'u-old', name: 'Старый товар', brand: null, cat: 'Старьё › Всякое', price: null, avail: null, url: null, src: 'user', inCatalog: false });
  const rows = Catalog.rows(S), by = p => rows.find(r => r.path === p);
  deq([by('Электрика').total, by('Электрика').own, by('Электрика › Автоматы').total, by('Электрика › АВР').total], [2, 1, 1, 0]);
  deq([by('Старьё').virtual, by('Старьё › Всякое').virtual, by('Старьё › Всякое').total, by('Старьё').total], [true, true, 1, 1]);
  assert.equal(by('Старьё › Всякое').id, '');
  assert.equal(by('Электрика').virtual, false);
  assert.equal(t.el.id, by('Электрика').id);
});

// ——— права сервера ———
function batch(a, fn) {
  const docs = a.Docs.split(a.S), st0 = a.Docs.join(docs);
  fn(a.S);
  return { st0, changes: a.Docs.diff(docs, a.Docs.split(a.S)) };
}
const check = (a, b, pid) => a.Guard.check(b.st0, pid, b.changes, NOW);
const denied = (r, what, re) => { assert.ok(r, `${what}: пропущено`); assert.match(r.text, /^Нет прав: \S/, what); if (re) assert.match(r.text, re, `${what}: «${r.text}»`); };

test('Guard: менеджер и кладовщик (право catalog у всех) заводят категорию, подкатегорию и товар в ней; без права catalog — отказ', () => {
  const a = load({ now: NOW });
  const add = st => { const t = tree({ Catalog: a.Catalog, S: st }); a.Catalog.add(st, { name: 'Автомат (тест)', cat: 'Электрика › Автоматы' }); return t; };
  for (const pid of ['p3', 'p5', 'p6']) {
    const b = batch(load({ now: NOW }), st => add(st));
    assert.equal(check(a, b, pid), null, `${pid} не смог завести категории и товар`);
  }
  // директор отнял право у менеджера B2B — тот же набор правок не проходит
  const a2 = load({ now: NOW });
  a2.S.roles.find(r => r.id === 'managerB2b').perms.catalog = false;
  const b2 = batch(a2, st => { a2.Catalog.catAdd(st, { name: 'Электрика' }); });
  denied(check(a2, b2, 'p3'), 'категория без права', /Добавлять товары в номенклатуру/);
  const b3 = batch(a2, st => { a2.Catalog.add(st, { name: 'Товар без права (тест)' }); });
  denied(check(a2, b3, 'p3'), 'товар без права', /Добавлять товары/);
});

test('Guard: товар с категорией вне дерева — отказ; смена на путь из дерева — можно; удалить можно только пустую; переименование без обновления товаров — отказ', () => {
  // каждая пачка — на своём состоянии сервера: дерево «Электрика → Автоматы, АВР, переключатели» и товар в «Автоматах»
  const world = () => { const a = load({ now: NOW }), t = tree(a), p = addProduct(a, 'Автомат (тест)', 'Электрика › Автоматы'); return { a, t, p }; };
  let { a, t, p } = world();
  const b1 = batch(a, st => { st.products.push({ id: 'u-x', name: 'Чужой путь (тест)', brand: null, cat: 'Нет такой › категории', price: null, avail: null, url: null, src: 'user', inCatalog: false }); });
  denied(check(a, b1, 'p3'), 'товар вне дерева', /нет в списке категорий/);
  ({ a, t, p } = world());
  const b2 = batch(a, st => assert.equal(a.Catalog.setCat(st, p.id, 'Электрика › АВР').ok, true));
  assert.equal(check(a, b2, 'p3'), null, 'смена категории на путь из дерева');
  ({ a, t, p } = world());
  const b3 = batch(a, st => { st.products.find(x => x.id === p.id).cat = 'Электрика › Нет'; });
  denied(check(a, b3, 'p3'), 'смена на путь вне дерева', /нет в списке категорий/);
  // цена у старого товара с неизвестной категорией правится: проверяется только то, что пачка меняет в категории
  const a4 = load({ now: NOW });
  a4.S.products.push({ id: 'u-old', name: 'Старый (тест)', brand: null, cat: 'Старьё', price: null, avail: null, url: null, src: 'user', inCatalog: false });
  const price = batch(a4, st => { st.products.find(x => x.id === 'u-old').price = 100; });
  assert.equal(check(a4, price, 'p3'), null, 'правка цены товара со «старой» категорией не блокируется');
  // удаление непустой и пустой
  ({ a, t, p } = world());
  const b4 = batch(a, st => { st.categories.splice(st.categories.findIndex(c => c.id === t.au.id), 1); });
  denied(check(a, b4, 'p3'), 'удалить категорию с товаром', /только пустую/);
  ({ a, t, p } = world());
  const b5 = batch(a, st => { st.categories.splice(st.categories.findIndex(c => c.id === t.el.id), 1); });
  denied(check(a, b5, 'p3'), 'удалить категорию с подкатегориями', /только пустую/);
  ({ a, t, p } = world());
  const b6 = batch(a, st => { st.categories.splice(st.categories.findIndex(c => c.id === t.avr.id), 1); });
  assert.equal(check(a, b6, 'p3'), null, 'пустую можно');
  // переименование: целиком (категория + товары в одной пачке) — можно; одно имя узла без товаров — нельзя
  ({ a, t, p } = world());
  const b7 = batch(a, st => assert.equal(a.Catalog.catEdit(st, t.au.id, { name: 'Автоматика' }).ok, true));
  assert.ok(b7.changes.some(c => c.key === 'products') && b7.changes.some(c => c.key === 'categories'), 'переименование — и узел, и товары в одной пачке');
  assert.equal(check(a, b7, 'p3'), null, 'переименование целиком');
  const b8 = { st0: b7.st0, changes: b7.changes.filter(c => c.key === 'categories') };
  denied(check(a, b8, 'p3'), 'переименование без обновления товаров', /вне списка|нет в списке|товар/);
  // сломанное дерево: два узла с одним именем рядом, узел внутри себя
  ({ a, t, p } = world());
  const b9 = batch(a, st => { st.categories.push({ id: 'c-dup', name: 'автоматы', parentId: t.el.id }); });
  denied(check(a, b9, 'p3'), 'двойник рядом', /уже есть/);
  ({ a, t, p } = world());
  const b10 = batch(a, st => { st.categories.find(c => c.id === t.el.id).parentId = t.au.id; });
  denied(check(a, b10, 'p3'), 'узел внутри своей ветки', /внутри себя|уже есть|нет в списке/);
});

// ——— сервер: переход рабочей базы на ревизию 20 и запись по HTTP ———
test('сервер: база ревизии 19 доводится до 20 — всем ролям (и своей) ставится право catalog, дерево собирается из товаров один раз', async () => {
  const srv = await kit.start();
  const dir = srv.dir;
  const boss = await kit.director(srv);
  await srv.stop(true);
  const file = path.join(dir, 'crm.db');
  const d = new DatabaseSync(file);
  // база «как была»: у ролей права catalog нет, дерева нет; своя роль — тоже без права
  for (const r of d.prepare("SELECT id, data FROM docs WHERE key = 'roles'").all()) {
    const role = JSON.parse(r.data);
    if (role.all) continue;
    role.perms.catalog = false;
    d.prepare("UPDATE docs SET data = ? WHERE key = 'roles' AND id = ?").run(JSON.stringify(role), r.id);
  }
  const own = { id: 'own', name: 'Своя роль (тест)', perms: { stock: true, catalog: false } };
  d.prepare("INSERT INTO docs (key, id, data, ver, seq) VALUES ('roles', 'own', ?, 1, 0)").run(JSON.stringify(own));
  d.prepare("DELETE FROM docs WHERE key = 'categories'").run();
  d.prepare("UPDATE meta SET v = '19' WHERE k = 'rev'").run();
  // товар, которого нет в снимке, с вложенным путём
  const mine = { id: 'u-old', name: 'Автомат старый (тест)', brand: null, cat: 'Электрика › Автоматы', price: null, avail: null, url: null, src: 'user', inCatalog: false };
  d.prepare("INSERT INTO docs (key, id, data, ver, seq) VALUES ('products', 'u-old', ?, 1, 0)").run(JSON.stringify(mine));
  d.close();
  const again = await kit.start({ dataDir: dir });
  try {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      assert.equal(db.prepare("SELECT v FROM meta WHERE k = 'rev'").get().v, String(load().Store.REV));
      for (const r of db.prepare("SELECT id, data FROM docs WHERE key = 'roles'").all()) assert.equal(JSON.parse(r.data).perms.catalog, true, `у роли ${r.id} нет права catalog`);
      const nodes = db.prepare("SELECT data FROM docs WHERE key = 'categories'").all().map(r => JSON.parse(r.data));
      assert.ok(nodes.length > 5, 'дерево не собрано');
      const names = nodes.map(n => n.name);
      for (const need of ['Панели', 'Инверторы', 'Электрика', 'Автоматы']) assert.ok(names.includes(need), `нет узла «${need}»`);
      const el = nodes.find(n => n.name === 'Электрика'), au = nodes.find(n => n.name === 'Автоматы');
      assert.equal(au.parentId, el.id, 'Автоматы внутри Электрики');
    } finally { db.close(); }
    // на экране человека дерево есть, и у каждого товара путь в нём
    const st = await kit.state(again, (await kit.login(again, 'boss', boss.password)).cookie);
    assert.ok(st.categories.length > 5);
    const a = load();
    for (const p of st.products) assert.equal(a.Catalog.hasPath(st, p.cat), true, `у «${p.name}» категории «${p.cat}» нет в дереве`);
  } finally { await again.stop(true); }
  // второй запуск ничего не пересобирает
  const third = await kit.start({ dataDir: dir });
  try {
    const db = new DatabaseSync(file, { readOnly: true });
    try { assert.ok(db.prepare("SELECT COUNT(*) AS n FROM docs WHERE key = 'categories'").get().n > 5); } finally { db.close(); }
  } finally { await third.stop(); }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('сервер: сотрудник с правом catalog пишет категорию и товар по HTTP; товар вне дерева — 403; удаление непустой — 403; без права — 403', async () => {
  const srv = await kit.start();
  try {
    const boss = await kit.director(srv);
    const sales = await kit.employee(srv, boss, { id: 'p3', name: 'Менеджер (тест)', role: 'managerB2b', dept: 'sales' });
    const top = { id: 'c-e', name: 'Электрощиты', parentId: null }, sub = { id: 'c-a', name: 'Автоматы', parentId: 'c-e' };
    const prod = { id: 'u-t1', name: 'Автомат 1P (тест)', brand: null, cat: 'Электрощиты › Автоматы', price: null, avail: null, url: null, src: 'user', inCatalog: false };
    let r = await kit.changes(srv, sales.cookie, [
      { key: 'categories', id: 'c-e', base: null, data: top }, { key: 'categories', id: 'c-a', base: null, data: sub },
      { key: 'products', id: 'u-t1', base: null, data: prod }]);
    assert.equal(r.status, 200, r.text);
    // директор (второй сеанс) видит дерево и товар
    const st = await kit.state(srv, boss.cookie);
    deq(st.categories.filter(c => c.id.startsWith('c-')).map(c => c.name), ['Электрощиты', 'Автоматы']);
    assert.equal(st.products.find(p => p.id === 'u-t1').cat, 'Электрощиты › Автоматы');
    // товар с путём вне дерева
    r = await kit.changes(srv, sales.cookie, [{ key: 'products', id: 'u-t2', base: null, data: { ...prod, id: 'u-t2', name: 'Нет в дереве (тест)', cat: 'Нет такой' } }]);
    assert.equal(r.status, 403, r.text); assert.match(r.body.error, /нет в списке категорий/);
    // удалить непустую
    r = await kit.changes(srv, sales.cookie, [{ key: 'categories', id: 'c-a', base: sub, deleted: true }]);
    assert.equal(r.status, 403, r.text); assert.match(r.body.error, /только пустую/);
    // директор отнимает право — менеджер больше не пишет категории
    const roleDoc = (await kit.state(srv, boss.cookie)).roles.find(x => x.id === 'managerB2b');
    r = await kit.changes(srv, boss.cookie, [{ key: 'roles', id: 'managerB2b', base: roleDoc, data: { ...roleDoc, perms: { ...roleDoc.perms, catalog: false } } }]);
    assert.equal(r.status, 200, r.text);
    r = await kit.changes(srv, sales.cookie, [{ key: 'categories', id: 'c-z', base: null, data: { id: 'c-z', name: 'Ещё', parentId: null } }]);
    assert.equal(r.status, 403, r.text); assert.match(r.body.error, /^Нет прав: /);
  } finally { await srv.stop(); }
});

// ——— экран ———
function page() {
  const a = load({ now: NOW });
  a.setMe('p1');
  a.S.view = 'stock';
  a.render();
  const modal = { innerHTML: '', scrollTop: 0 };
  a.byId('modal-root').querySelector = sel => (sel === '.modal' ? modal : null);
  return { a, modal };
}
const rowsOf = html => [...String(html).matchAll(/<li class="ct-row[^"]*" style="--d:(\d+)">(?:.*?)data-cat="([^"]*)"[^>]*>(?:<span>(.*?)<\/span><small>(\d+)<\/small>)/g)].map(m => ({ depth: Number(m[1]), cat: m[2], name: m[3], n: Number(m[4]) }));

test('экран: слева дерево категорий с числом товаров («Все» и верхний уровень), подкатегории свёрнуты, пока не раскрыты; выбор категории показывает и её подкатегории', () => {
  const { a } = page(), { S, A } = a;
  const t = tree(a);
  addProduct(a, 'Тест Автомат один', 'Электрика › Автоматы'); addProduct(a, 'Тест Реле', 'Электрика');
  addProduct(a, 'Тест АВР один', 'Электрика › АВР');
  const tr = () => rowsOf(a.vStock());
  const top = tr();
  assert.equal(top[0].name, 'Все'); assert.equal(top[0].n, S.products.length);
  assert.ok(top.some(r => r.name === 'Электрика' && r.n === 3 && r.depth === 0), 'у «Электрика» число с подкатегориями');
  assert.ok(!top.some(r => r.name === 'Автоматы'), 'подкатегории свёрнуты');
  assert.match(a.vStock(), /data-act="cat-toggle" data-cat="Электрика" aria-expanded="false"/);
  A['cat-toggle']({ dataset: { cat: 'Электрика' } });
  const open = tr();
  assert.ok(open.some(r => r.name === 'Автоматы' && r.depth === 1 && r.n === 1 && r.cat === 'Электрика › Автоматы'), 'раскрыли — видны подкатегории с отступом');
  A['cat-toggle']({ dataset: { cat: 'Электрика' } });
  assert.ok(!tr().some(r => r.name === 'Автоматы'), 'свернули');
  // выбор родителя: в списке товары всех подкатегорий, и она раскрылась
  A['stock-cat']({ dataset: { cat: 'Электрика' } });
  assert.match(a.stockTable(), /Показано <b>3<\/b>/);
  assert.ok(a.stockTable().includes('Тест Автомат один') && a.stockTable().includes('Тест Реле') && a.stockTable().includes('Тест АВР один'));
  assert.ok(tr().some(r => r.name === 'Автоматы'), 'выбранная категория раскрыта');
  A['stock-cat']({ dataset: { cat: 'Электрика › АВР' } });
  assert.match(a.stockTable(), /Показано <b>1<\/b>/);
  assert.match(a.vStock(), /class="ct-row on"[^>]*>(?:(?!<\/li>).)*data-cat="Электрика › АВР"/s, 'выбранная подсвечена');
  A['stock-cat']({ dataset: { cat: 'Все' } });
  assert.match(a.stockTable(), new RegExp(`Показано <b>${S.products.length}</b>`));
  assert.equal(t.avr.name, 'АВР');
  // старых «табов» категорий больше нет
  assert.ok(!a.vStock().includes('class="chips"'), 'табы категорий остались рядом с деревом');
});

test('экран: «Без раздела» — отдельная строка дерева, только когда такие товары есть', () => {
  const { a } = page(), { A } = a;
  assert.ok(!rowsOf(a.vStock()).some(r => r.name === 'Без раздела'));
  addProduct(a, 'Тест Мелочь', '');
  const r = rowsOf(a.vStock()).find(x => x.name === 'Без раздела');
  assert.ok(r && r.n === 1);
  A['stock-cat']({ dataset: { cat: 'Без раздела' } });
  assert.match(a.stockTable(), /Показано <b>1<\/b>/);
});

test('экран: окно «Категории» — электрика → автоматы → АВР за три шага, каждый шаг — одно сохранение; повтор и пустое имя — ошибка в окне', () => {
  const { a, modal } = page(), { S, A, FORMS } = a;
  assert.match(a.vStock(), /data-act="cat-manage"/, 'кнопка «Категории» у директора');
  A['cat-manage']();
  assert.match(a.byId('modal-root').innerHTML, /Категории товаров/);
  const el = id => a.byId(id);
  const add = (name, parent) => { el('ct-name').value = name; el('ct-parent').value = parent; modal.innerHTML = ''; FORMS['cat-add'](); };
  add('Электрика', '');
  assert.ok(S.categories.some(c => c.name === 'Электрика' && !c.parentId));
  add('Автоматы', 'Электрика');
  add('АВР', 'Электрика › Автоматы');
  deq(S.categories.slice(-3).map(c => a.Catalog.pathOf(S, c.id)), ['Электрика', 'Электрика › Автоматы', 'Электрика › Автоматы › АВР']);
  assert.match(modal.innerHTML, /Электрика › Автоматы › АВР|АВР/, 'окно перерисовано со списком');
  assert.match(modal.innerHTML, /<option value="Электрика › Автоматы"[^>]*>   Автоматы/, 'выбор «куда добавить» — с отступом по уровню');
  const n = S.categories.length;
  add('электрика', '');
  assert.match(el('ct-err').textContent, /уже есть на верхнем уровне/); assert.equal(S.categories.length, n);
  add('  ', '');
  assert.match(el('ct-err').textContent, /Нужно название/);
});

test('экран: «Изменить» категорию — переименование и перенос обновляют пути товаров и выбранную категорию; удалить можно только пустую', () => {
  const { a, modal } = page(), { S, A, FORMS } = a, t = tree(a);
  const m1 = addProduct(a, 'Тест Автомат', 'Электрика › Автоматы');
  A['stock-cat']({ dataset: { cat: 'Электрика › Автоматы' } });
  A['cat-manage']();
  A['cat-edit']({ dataset: { id: t.au.id } });
  assert.match(a.byId('modal-root').innerHTML, /Категория «Автоматы»/);
  assert.match(a.byId('modal-root').innerHTML, /Удалить можно только пустую/);
  assert.match(a.byId('modal-root').innerHTML, /data-act="cat-del"[^>]*disabled/, 'кнопка «Удалить» у непустой неактивна');
  // удалить непустую — ошибка в окне, ничего не удалено
  const n = S.categories.length;
  A['cat-del']({ dataset: { id: t.au.id } });
  assert.match(a.byId('ce-err').textContent, /Удалить «Электрика › Автоматы» нельзя: в ней 1 товар/);
  assert.equal(S.categories.length, n);
  // переименовать и перенести
  a.byId('ce-name').value = 'Автоматика'; a.byId('ce-parent').value = '';
  FORMS['cat-edit']({ dataset: { id: t.au.id } });
  assert.equal(m1.cat, 'Автоматика');
  assert.equal(S.ui.cat, 'Автоматика', 'выбранная в списке категория поехала вместе с переименованной');
  assert.match(a.stockTable(), /Тест Автомат/);
  // пустую удаляют
  A['cat-del']({ dataset: { id: t.avr.id } });
  assert.equal(S.categories.some(c => c.id === t.avr.id), false);
  void modal;
});

test('экран: «Новый товар» — категория из дерева с отступами и «Без раздела»; товар встаёт в выбранную категорию; в карточке «Сменить категорию»', () => {
  const { a } = page(), { S, A, FORMS } = a, t = tree(a);
  A['new-product']();
  const html = a.byId('modal-root').innerHTML;
  assert.match(html, /<option value="Без раздела" selected>Без раздела<\/option>/, 'по умолчанию — «Без раздела»');
  assert.match(html, /<option value="Электрика › Автоматы">   Автоматы<\/option>/, 'уровни с отступом');
  const el = id => a.byId(id);
  el('np-name').value = 'Автомат трёхполюсный (тест)'; el('np-unit').value = 'шт'; el('np-cat').value = 'Электрика › Автоматы'; el('np-price').value = '';
  FORMS.product();
  const p = S.products.find(x => x.name === 'Автомат трёхполюсный (тест)');
  assert.equal(p.cat, 'Электрика › Автоматы');
  // карточка: путь и «Сменить категорию»
  const body = a.DRAWERS.product(p.id).body;
  assert.match(body, /Электрика › Автоматы <button type="button" class="link" data-act="product-cat"/);
  A['product-cat']({ dataset: { pid: p.id } });
  assert.match(a.byId('modal-root').innerHTML, /id="pc-cat"/);
  el('pc-cat').value = 'Электрика › АВР';
  FORMS['product-cat']({ dataset: { pid: p.id } });
  assert.equal(p.cat, 'Электрика › АВР');
  el('pc-cat').value = 'Электрика › Нет';
  FORMS['product-cat']({ dataset: { pid: p.id } });
  assert.match(el('pc-err').textContent, /нет в списке категорий/);
  assert.equal(p.cat, 'Электрика › АВР');
  assert.equal(t.sw.name, 'Трёхпозиционные переключатели');
});

test('экран: без права catalog нет кнопок «Категории» и «Сменить категорию», действия отказывают', () => {
  const { a } = page();
  a.S.roles.find(r => r.id === 'managerB2b').perms.catalog = false;
  a.setMe('p3');
  a.S.view = 'stock'; a.render();
  assert.ok(!a.vStock().includes('data-act="cat-manage"') && !a.vStock().includes('data-act="new-product"'));
  const p = a.S.products[0];
  assert.ok(!a.DRAWERS.product(p.id).body.includes('data-act="product-cat"'));
  a.A['cat-manage']();
  assert.ok(!a.byId('modal-root').innerHTML.includes('Категории товаров'), 'окно не открылось');
});

test('«Оприходовать товар»: новый товар заводит любой, у кого есть receive и catalog (кладовщик тоже); категория выбирается из дерева; «только директор» не пишется', () => {
  const { a } = page(), { Import, S } = a, t = tree(a);
  a.setMe('p5');
  const rows = Import.receiptRows('Тестовый автомат АВР 63 А\t7\tИП\tИркутск\nТестовое реле\t3\tИП\tИркутск').rows;
  rows[0].pick = 'new'; rows[1].pick = 'new'; rows[0].cat = 'Электрика › АВР';
  const P = Import.receiptPlan(S, rows, { canCreate: a.Perms.can(S, 'p5', 'catalog'), cat: 'Электрика' });
  assert.equal(P.ready, true, P.lines.map(l => l.error).join('; '));
  deq(P.groups.map(g => g.cat), ['Электрика › АВР', 'Электрика'], 'у строки своя категория, у второй — общая «для новых»');
  const r = Import.applyReceipt(S, rows, { cat: 'Электрика' }, 'p5', NOW);
  assert.equal(r.ok, true, r.reason);
  deq(r.products.map(id => S.products.find(p => p.id === id).cat), ['Электрика › АВР', 'Электрика']);
  // категория, которой нет в дереве, — ошибка строки, ничего не заведено
  const rows2 = Import.receiptRows('Тестовый товар Ещё\t1\tИП\tИркутск').rows;
  rows2[0].pick = 'new'; rows2[0].cat = 'Нет такой';
  const bad = Import.receiptPlan(S, rows2, { canCreate: true });
  assert.equal(bad.ready, false); assert.match(bad.lines[0].error, /категории «Нет такой» нет в списке/);
  const n = S.products.length;
  assert.equal(Import.applyReceipt(S, rows2, {}, 'p5', NOW).ok, false);
  assert.equal(S.products.length, n);
  assert.equal(t.avr.name, 'АВР');
});

test('перенос остатков: раздел листа, которого не было в дереве, становится категорией; повторный перенос дерево не двоит', () => {
  const a = load({ globals: { CRM_SERVER: 1 } });
  const st = a.seedBase();
  const rows = [
    { name: 'Тестовый автомат Альфа', cat: 'Электрощиты', ip: 5, npp: null, vs: null, custody: null, transit: null, damaged: null, reserve: null, junk: [] },
    { name: 'Тестовая панель Бета', cat: 'Солнечные панели', ip: 2, npp: null, vs: null, custody: null, transit: null, damaged: null, reserve: null, junk: [] },
  ];
  a.Import.applyStock(st, rows, 'p1', NOW);
  const n = st.categories.length;
  assert.ok(st.categories.some(c => c.name === 'Электрощиты'), 'раздел «Электрощиты» не стал категорией');
  assert.equal(st.categories.filter(c => c.name === 'Панели').length, 1, '«Солнечные панели» легли в существующие «Панели»');
  for (const p of st.products) assert.equal(a.Catalog.hasPath(st, p.cat), true, `${p.name}: «${p.cat}»`);
  a.Import.applyStock(st, rows, 'p1', NOW);
  assert.equal(st.categories.length, n, 'повторный перенос добавил узлы');
});

// ——— экран на настоящем сервере: одно действие — одна запись ———
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
const posts = p => p.b.calls.filter(c => c.url === '/api/changes' && c.method === 'POST').length;

test('сервер: через окно директор заводит «Электрощиты → Щитки», товар в ней и переименовывает ветку — каждое действие одной пачкой, второй сеанс видит новые пути', async () => {
  const srv = await kit.start();
  try {
    const boss = await kit.director(srv);
    const sales = await kit.employee(srv, boss, { id: 'p3', name: 'Менеджер (тест)', role: 'managerB2b', dept: 'sales' });
    const w = await openPage(srv, boss.login, boss.password), A = w.app;
    const modal = { innerHTML: '', scrollTop: 0 };
    A.byId('modal-root').querySelector = sel => (sel === '.modal' ? modal : null);
    A.S.view = 'stock'; A.render();
    A.A['cat-manage']();
    const el = id => A.byId(id);
    const step = async fn => { const n = posts(w); fn(); await A.serverIdle(); return posts(w) - n; };
    assert.equal(await step(() => { el('ct-name').value = 'Электрощиты'; el('ct-parent').value = ''; A.FORMS['cat-add'](); }), 1, 'категория — одна запись');
    assert.equal(await step(() => { el('ct-name').value = 'Щитки'; el('ct-parent').value = 'Электрощиты'; A.FORMS['cat-add'](); }), 1, 'подкатегория — одна запись');
    // новый товар в подкатегории: товар и (если надо) уровни — одной пачкой
    A.A['new-product']();
    assert.equal(await step(() => { el('np-name').value = 'Автомат 1P (тест)'; el('np-unit').value = 'шт'; el('np-cat').value = 'Электрощиты › Щитки'; el('np-price').value = ''; A.FORMS.product(); }), 1, 'товар — одна запись');
    // сотрудник (с правом catalog по умолчанию) видит дерево и товар
    const st = await kit.state(srv, sales.cookie);
    assert.ok(st.categories.some(c => c.name === 'Щитки'));
    assert.equal(st.products.find(p => p.name === 'Автомат 1P (тест)').cat, 'Электрощиты › Щитки');
    // переименование ветки: узел и товар в нём — одна пачка
    const au = A.S.categories.find(c => c.name === 'Щитки');
    A.A['cat-edit']({ dataset: { id: au.id } });
    assert.equal(await step(() => { el('ce-name').value = 'Автоматика'; el('ce-parent').value = 'Электрощиты'; A.FORMS['cat-edit']({ dataset: { id: au.id } }); }), 1, 'переименование ветки — одна запись');
    const st2 = await kit.state(srv, sales.cookie);
    assert.ok(st2.categories.some(c => c.name === 'Автоматика') && !st2.categories.some(c => c.name === 'Щитки'));
    assert.equal(st2.products.find(p => p.name === 'Автомат 1P (тест)').cat, 'Электрощиты › Автоматика', 'путь товара обновлён вместе с категорией');
    // непустую удалить нельзя — запись на сервер даже не уходит
    A.A['cat-edit']({ dataset: { id: au.id } });
    assert.equal(await step(() => A.A['cat-del']({ dataset: { id: au.id } })), 0, 'отказ — без записи на сервер');
  } finally { await srv.stop(); }
});
