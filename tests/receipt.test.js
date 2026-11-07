'use strict';
// «Оприходовать товар» — приход без поставки списком из Excel (Import.receiptRows / receiptPlan / applyReceipt, Guard, экран).
// Слова директора: «Просто пришло какое-то количество товара разного: часть уже есть в номенклатуре, а часть ещё не существует.
// У меня есть список товара, в Excel или от руки написанный» — «Да, сделай» (вставить список, CRM находит позиции, по незнакомым
// спрашивает «создать новый» или «это тот же, что …», после проверки «Оприходовать» — в журнале «Приход» с именем и датой).
// Данные искусственные: товары «Тестовая …» заводятся тут же; людей берём из демо (p1 директор, p2 менеджер, p5 кладовщик, p6 логист).

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.js');
const kit = require('./server-kit.js');

// Данные из страницы живут в другом окружении (vm): сравниваем их как JSON, иначе deepStrictEqual видит чужие Array и Object
const plain = v => JSON.parse(JSON.stringify(v === undefined ? null : v));
const deq = (actual, expected, msg) => assert.deepEqual(plain(actual), plain(expected), msg);

const NOW = new Date(2026, 10, 7, 12, 0, 0);
const DOC = 'Оприходование 07.11.2026';
const PANEL = { id: 'u-t1', name: 'Тестовая панель Альфа 550 Вт' };
const INV = { id: 'u-t2', name: 'Тестовый инвертор Бета 5 кВт' };
const CABLE = { id: 'u-t3', name: 'Тестовый кабель «Гамма» 4 мм2' };

// Демо с тремя искусственными товарами; у панели в клетке «ИП, Иркутск» уже лежит 5
function app(opts = {}) {
  const a = load({ now: NOW, ...opts });
  for (const p of [PANEL, INV, CABLE]) a.S.products.push({ id: p.id, name: p.name, brand: null, cat: 'Тест', price: null, avail: null, url: null, src: 'user', inCatalog: false });
  a.S.stock[PANEL.id] = { ip: { irk: 5 } };
  return a;
}
const tab = (...rows) => rows.map(r => r.join('\t')).join('\n');
const plan = (a, text, opts = {}) => {
  const r = a.Import.receiptRows(text);
  deq(r.problems, [], 'список не разобран: ' + r.problems);
  return { rows: r.rows, header: r.header, P: a.Import.receiptPlan(a.S, r.rows, { entityId: 'ip', cityId: 'irk', canCreate: true, ...opts }) };
};
const cellOf = (a, pid, e = 'ip', c = 'irk') => ((a.S.stock[pid] || {})[e] || {})[c];

// ——— разбор списка ———
test('receiptRows: вставка из Excel — табуляции, заголовок опознаётся по названиям колонок, строки нумеруются как в списке', () => {
  const a = app();
  const r = a.Import.receiptRows(tab(['Название', 'Количество', 'Юрлицо', 'Склад'], ['Тестовая панель Альфа 550 Вт', '10', 'ИП', 'Иркутск'], ['Тестовый кабель «Гамма» 4 мм2', '100', '', '']));
  deq(r.problems, []);
  assert.equal(r.header, 'Название · Количество · Юрлицо · Склад', 'заголовок показан, а не оприходован');
  deq(r.rows.map(x => [x.line, x.name, x.qty, x.entity, x.city, x.pick]), [
    [2, 'Тестовая панель Альфа 550 Вт', '10', 'ИП', 'Иркутск', ''],
    [3, 'Тестовый кабель «Гамма» 4 мм2', '100', '', '', ''],
  ]);
});

test('receiptRows: без заголовка первая строка — товар; колонки по порядку; юрлицо и склад можно не давать', () => {
  const a = app();
  const r = a.Import.receiptRows(tab(['Тестовая панель Альфа 550 Вт', '10'], ['Тестовый кабель «Гамма» 4 мм2', '100', 'НПП']));
  assert.equal(r.header, null);
  deq(r.rows.map(x => [x.line, x.name, x.qty, x.entity, x.city]), [[1, 'Тестовая панель Альфа 550 Вт', '10', '', ''], [2, 'Тестовый кабель «Гамма» 4 мм2', '100', 'НПП', '']]);
});

test('receiptRows: заголовок с незнакомыми словами — заголовок, если в колонке количества не число; названия колонок переставляют колонки', () => {
  const a = app();
  const odd = a.Import.receiptRows(tab(['Что приехало', 'Сколько'], ['Тестовая панель Альфа 550 Вт', '10']));
  assert.equal(odd.header, 'Что приехало · Сколько');
  assert.equal(odd.rows.length, 1);
  const swapped = a.Import.receiptRows(tab(['Кол-во', 'Номенклатура', 'Город'], ['10', 'Тестовая панель Альфа 550 Вт', 'Иркутск']));
  deq(swapped.rows.map(x => [x.name, x.qty, x.city]), [['Тестовая панель Альфа 550 Вт', '10', 'Иркутск']], 'колонки найдены по названиям, а не по порядку');
});

test('receiptRows: запятая в названии при табуляциях — не разделитель; CSV с «;» из файла (Import.decode) разбирается тем же кодом; пустые строки и пробелы', () => {
  const a = app();
  const t = a.Import.receiptRows(tab(['Кабель, 4 мм2, красный', '10'], ['', ''], ['  Панель   Альфа ', ' 3 ']));
  deq(t.rows.map(x => [x.line, x.name, x.qty]), [[1, 'Кабель, 4 мм2, красный', '10'], [3, 'Панель   Альфа', '3']], 'пустая строка пропущена, пробелы по краям сняты');
  const csv = Buffer.from('﻿Наименование;Количество\r\nПанель Альфа;12\r\n"Кабель; особый";3\r\n', 'utf8');
  const f = a.Import.receiptRows(a.Import.decode(Uint8Array.from(csv)));
  assert.equal(f.header, 'Наименование · Количество');
  deq(f.rows.map(x => [x.name, x.qty]), [['Панель Альфа', '12'], ['Кабель; особый', '3']]);
});

test('receiptRows: пустой список, двоичный мусор и список из одного заголовка — понятный отказ, а не пустая таблица', () => {
  const a = app();
  assert.match(a.Import.receiptRows('  \n\n ').problems[0], /пустой/);
  assert.match(a.Import.receiptRows('PK\u0003\u0004\u0000\u0000x\t1').problems[0], /двоичные/);
  assert.match(a.Import.receiptRows(tab(['Название', 'Количество'])).problems[0], /нет ни одной строки/);
});

test('receiptQty: целое больше нуля; «1 200» и «10 шт» можно; «10,5», «0», «-3», «много», пусто — ошибка с причиной', () => {
  const { Import } = app();
  assert.equal(Import.receiptQty('10').n, 10);
  assert.equal(Import.receiptQty(' 1 200 ').n, 1200);
  assert.equal(Import.receiptQty('10 шт').n, 10);
  assert.equal(Import.receiptQty('7.0').n, 7);
  for (const [raw, re] of [['10,5', /не целое/], ['0', /больше нуля/], ['-3', /больше нуля/], ['много', /не число/], ['', /не указано/]]) {
    const r = Import.receiptQty(raw);
    assert.equal(r.n, undefined, raw);
    assert.match(r.error, re, raw);
  }
});

// ——— сопоставление ———
test('receiptPlan: точное совпадение находится само — без регистра, лишних пробелов, ё/е, кавычек; по ключу товара тоже', () => {
  const a = app();
  a.S.products.push({ id: 'u-t4', name: 'Тестовый щиток Ёлка', brand: null, cat: 'Тест', price: null, avail: null, url: null, src: 'user', inCatalog: false });
  const { P } = plan(a, tab(['тестовая  ПАНЕЛЬ альфа 550 вт', '1'], ['ТЕСТОВЫЙ ЩИТОК ЕЛКА', '2'], ['Тестовый кабель Гамма 4 мм2', '3'], ['u-t2', '4']));
  deq(P.lines.map(l => [l.status, l.productId]), [['found', PANEL.id], ['found', 'u-t4'], ['found', CABLE.id], ['found', INV.id]]);
  assert.equal(P.ready, true);
  deq(P.groups.map(g => [g.productId, g.qty, g.entityId, g.cityId]), [[PANEL.id, 1, 'ip', 'irk'], ['u-t4', 2, 'ip', 'irk'], [CABLE.id, 3, 'ip', 'irk'], [INV.id, 4, 'ip', 'irk']]);
});

test('receiptPlan: похожее (опечатка, не всё слово) — до трёх вариантов на выбор, пока не выбрано, строка ждёт; «это тот же» берёт выбранный товар', () => {
  const a = app();
  const { rows, P } = plan(a, tab(['Тестовая панел Альфа 550', '10']));
  const L = P.lines[0];
  assert.equal(L.status, 'choose');
  assert.ok(L.candidates.length >= 1 && L.candidates.length <= 3, 'вариантов: ' + L.candidates.length);
  assert.equal(L.candidates[0].id, PANEL.id, 'самый похожий — первым');
  assert.equal(P.ready, false);
  rows[0].pick = PANEL.id;
  const P2 = a.Import.receiptPlan(a.S, rows, { entityId: 'ip', cityId: 'irk', canCreate: true });
  deq([P2.lines[0].status, P2.lines[0].productId, P2.ready], ['picked', PANEL.id, true]);
});

test('receiptPlan: схожих слов мало — вариантов нет (не больше трёх всегда); два товара с одним названием — оба на выбор', () => {
  const a = app();
  for (let i = 0; i < 6; i++) a.S.products.push({ id: 'u-w' + i, name: `Тестовая лампа Омега ${i}`, brand: null, cat: 'Тест', price: null, avail: null, url: null, src: 'user', inCatalog: false });
  const { P } = plan(a, tab(['Тестовая лампа Омега', '1'], ['Совсем новая штука Зет-9', '2']));
  assert.equal(P.lines[0].candidates.length, 3, 'шесть похожих — показаны три');
  deq(P.lines[1].candidates, [], 'похожих нет');
  a.S.products.push({ id: 'u-d1', name: 'Тестовый дубль', brand: null, cat: 'Тест', price: null, avail: null, url: null, src: 'user', inCatalog: false }, { id: 'u-d2', name: 'тестовый  ДУБЛЬ', brand: null, cat: 'Тест', price: null, avail: null, url: null, src: 'user', inCatalog: false });
  const d = plan(a, tab(['Тестовый дубль', '1'])).P.lines[0];
  assert.equal(d.status, 'choose', 'два одинаковых названия — сам не выберет');
  deq(d.candidates.map(c => c.id).sort(), ['u-d1', 'u-d2']);
});

test('receiptPlan: «создать новый товар» — только с правом catalog; «пропустить» снимает строку, ошибки пропущенной строки не мешают', () => {
  const a = app();
  const { rows } = plan(a, tab(['Совсем новая штука', '7'], ['Кабель', 'десять']));
  rows[0].pick = 'new';
  const can = a.Import.receiptPlan(a.S, rows, { entityId: 'ip', cityId: 'irk', canCreate: true });
  deq([can.lines[0].status, can.created, can.positions, can.units], ['new', 1, 1, 7]);
  const cant = a.Import.receiptPlan(a.S, rows, { entityId: 'ip', cityId: 'irk', canCreate: false });
  assert.equal(cant.lines[0].status, 'error');
  assert.match(cant.lines[0].error, /нет права добавлять товары/);
  assert.equal(can.ready, false, 'вторая строка с ошибкой количества');
  rows[1].pick = 'skip';
  const done = a.Import.receiptPlan(a.S, rows, { entityId: 'ip', cityId: 'irk', canCreate: true });
  deq([done.lines[1].status, done.skipped, done.errors, done.ready], ['skip', 1, 0, true]);
});

test('receiptPlan: одинаковый товар в двух строках одного склада складывается с предупреждением; в разных складах — две записи; новый товар в двух строках — один', () => {
  const a = app();
  const { rows, P } = plan(a, tab(['Тестовая панель Альфа 550 Вт', '3'], ['тестовая панель альфа 550 вт', '4'], ['Тестовая панель Альфа 550 Вт', '5', 'НПП', 'Москва'], ['Новинка Дельта', '2'], ['новинка  дельта', '6']));
  deq(P.groups.filter(g => !g.isNew).map(g => [g.productId, g.entityId, g.cityId, g.qty]), [[PANEL.id, 'ip', 'irk', 7], [PANEL.id, 'npp', 'msk', 5]]);
  assert.equal(P.warnings.length, 1, 'предупреждение про сложенные строки, а не про разные склады: ' + P.warnings);
  assert.match(P.warnings[0], /строки 1 и 2.*всего 7/);
  rows[3].pick = 'new'; rows[4].pick = 'new';
  const N = a.Import.receiptPlan(a.S, rows, { entityId: 'ip', cityId: 'irk', canCreate: true });
  assert.equal(N.created, 1, 'одно название — один новый товар');
  deq(N.groups.filter(g => g.isNew).map(g => [g.qty, g.lines]), [[8, [4, 5]]]);
  assert.equal(N.warnings.length, 2);
});

test('receiptPlan: юрлицо и склад из строки сопоставляются со справочником без регистра и ё/е; неизвестные и пустые без «всё это приходит на» — ошибка строки', () => {
  const a = app();
  const { rows } = plan(a, tab(['Тестовая панель Альфа 550 Вт', '1', 'нпп', 'МОСКВА'], ['Тестовый кабель «Гамма» 4 мм2', '2', 'ООО Ромашка', ''], ['Тестовый инвертор Бета 5 кВт', '3', '', 'Урюпинск'], ['Тестовый инвертор Бета 5 кВт', '4']));
  const P = a.Import.receiptPlan(a.S, rows, { entityId: 'vs', cityId: 'krd', canCreate: true });
  deq([P.lines[0].entityId, P.lines[0].cityId, P.lines[0].status], ['npp', 'msk', 'found'], 'своё юрлицо и город строки');
  assert.equal(P.lines[1].status, 'error');
  assert.match(P.lines[1].error, /юрлица «ООО Ромашка» нет в справочнике/);
  assert.match(P.lines[2].error, /склада \(города\) «Урюпинск» нет в справочнике/);
  deq([P.lines[3].entityId, P.lines[3].cityId], ['vs', 'krd'], 'у строки нет своих — подставлено «всё это приходит на»');
  const none = a.Import.receiptPlan(a.S, rows.slice(3), { canCreate: true });
  assert.match(none.lines[0].error, /не выбрано юрлицо/);
  assert.match(none.lines[0].error, /не выбран склад/);
  assert.equal(none.ready, false);
});

test('receiptPlan: ошибки строки — количество, название; каждая названа; план ничего не меняет в состоянии', () => {
  const a = app();
  const before = JSON.stringify(a.Store.plain(a.S));
  const r = a.Import.receiptRows(tab(['Тестовая панель Альфа 550 Вт', '0'], ['', '5'], ['Тестовая панель Альфа 550 Вт', '2,5']));
  const P = a.Import.receiptPlan(a.S, r.rows, { entityId: 'ip', cityId: 'irk', canCreate: true });
  deq(P.lines.map(l => l.status), ['error', 'error', 'error']);
  assert.match(P.lines[0].error, /больше нуля/);
  assert.match(P.lines[1].error, /нет названия/);
  assert.match(P.lines[2].error, /не целое/);
  assert.equal(P.ready, false);
  assert.equal(JSON.stringify(a.Store.plain(a.S)), before, 'сопоставление состояние не меняет');
});

// ——— проведение ———
test('applyReceipt: кладовщик оприходовал существующий товар — остаток вырос на количество (приход, а не замена), в журнале «Приход» с автором, временем и документом', () => {
  const a = app();
  const { rows } = plan(a, tab(['Тестовая панель Альфа 550 Вт', '10'], ['Тестовый кабель «Гамма» 4 мм2', '100', 'НПП', 'Москва']));
  const moves0 = a.S.moves.length;
  const r = a.Import.applyReceipt(a.S, rows, { entityId: 'ip', cityId: 'irk' }, 'p5', NOW);
  assert.equal(r.ok, true, r.reason);
  deq([r.positions, r.created, r.units, r.doc], [2, 0, 110, DOC]);
  assert.equal(cellOf(a, PANEL.id), 15, 'было 5, пришло 10');
  assert.equal(cellOf(a, CABLE.id, 'npp', 'msk'), 100, 'товар без остатка получил клетку');
  assert.equal(a.S.moves.length, moves0 + 2);
  const m = a.S.moves.find(x => x.productId === PANEL.id);
  deq([m.kind, m.qty, m.entityId, m.cityId, m.doc, m.by, +m.at], ['Приход', 10, 'ip', 'irk', DOC, 'p5', +NOW]);
  assert.equal(a.Stock.summary(a.S, PANEL.id).onHand, 15, 'свободный остаток считает Stock.summary по тем же клеткам');
  assert.equal(a.S.notes[0].kind, 'arrive', 'менеджеры и директор узнали о приходе');
  assert.match(a.S.notes[0].text, /Оприходован товар без поставки .*2 позиции/);
});

test('applyReceipt: директор оприходовал и новый товар — создан тем же кодом, что «Новый товар» (без цены и категории), остаток и журнал на месте', () => {
  const a = app();
  const { rows } = plan(a, tab(['Тестовая панель Альфа 550 Вт', '2'], ['Совсем новая штука', '7'], ['совсем  НОВАЯ штука', '1', 'НПП', 'Москва']));
  rows[1].pick = 'new'; rows[2].pick = 'new';
  const n0 = a.S.products.length;
  const r = a.Import.applyReceipt(a.S, rows, { entityId: 'ip', cityId: 'irk' }, 'p1', NOW);
  assert.equal(r.ok, true, r.reason);
  deq([r.positions, r.created], [3, 1], 'три записи (панель, новая в двух клетках), товар один');
  assert.equal(a.S.products.length, n0 + 1);
  const p = a.S.products.find(x => x.name === 'Совсем новая штука');
  deq([p.src, p.inCatalog, p.price, p.brand, p.avail, p.url, p.cat], ['user', false, null, null, null, null, a.Catalog.NO_CAT], 'цена — «нет данных», а не 0');
  assert.equal(cellOf(a, p.id), 7);
  assert.equal(cellOf(a, p.id, 'npp', 'msk'), 1);
  assert.equal(a.S.moves.filter(x => x.productId === p.id).length, 2);
  assert.ok(a.S.moves.slice(0, 3).every(x => x.kind === 'Приход' && x.doc === DOC), 'три новые записи журнала — приходы с документом «Оприходование <дата>»');
  // форма «Новый товар» и оприходование — один код: тот же товар по форме отвергается как повтор
  assert.equal(a.Catalog.add(a.S, { name: 'совсем новая  ШТУКА' }).ok, false);
});

test('applyReceipt: пока есть строка с ошибкой или выбором — отказ, и ничего не меняется; без права receive — отказ; кладовщику без catalog новый товар не создать', () => {
  const a = app();
  const { rows } = plan(a, tab(['Тестовая панель Альфа 550 Вт', '10'], ['Совсем новая штука', '7']));
  const snap = () => JSON.stringify(a.Store.plain(a.S));
  const before = snap();
  const wait = a.Import.applyReceipt(a.S, rows, { entityId: 'ip', cityId: 'irk' }, 'p1', NOW);
  assert.equal(wait.ok, false);
  assert.match(wait.reason, /ждут выбора 1/);
  assert.equal(snap(), before, 'отказ ничего не записал');
  rows[1].pick = 'new';
  const noCatalog = a.Import.applyReceipt(a.S, rows, { entityId: 'ip', cityId: 'irk' }, 'p5', NOW);
  assert.equal(noCatalog.ok, false, 'кладовщик не может создавать новые товары');
  assert.match(noCatalog.reason, /ошибкой 1/);
  assert.equal(snap(), before, 'и существующая первая строка тоже не проведена');
  const noReceive = a.Import.applyReceipt(a.S, rows, { entityId: 'ip', cityId: 'irk' }, 'p2', NOW);
  assert.equal(noReceive.ok, false);
  assert.match(noReceive.reason, /нет права принимать товар/);
  assert.equal(snap(), before);
  rows[1].pick = 'skip';
  assert.equal(a.Import.applyReceipt(a.S, rows, { entityId: 'ip', cityId: 'irk' }, 'p5', NOW).ok, true, 'пропустил новую — остальное проведено');
  rows.forEach(r => { r.pick = 'skip'; });
  assert.match(a.Import.applyReceipt(a.S, rows, { entityId: 'ip', cityId: 'irk' }, 'p5', NOW).reason, /все строки пропущены/);
});

// ——— сервер: Guard ———
function batch(a, fn) {
  const docs = a.Docs.split(a.S), st0 = a.Docs.join(docs);
  fn(a.S);
  return { st0, changes: a.Docs.diff(docs, a.Docs.split(a.S)) };
}
const check = (a, b, pid) => a.Guard.check(b.st0, pid, b.changes, NOW);
const receiptBatch = (a, text, by, picks = {}, opts = { entityId: 'ip', cityId: 'irk' }) => batch(a, st => {
  const r = a.Import.receiptRows(text);
  r.rows.forEach((x, i) => { if (picks[i]) x.pick = picks[i]; });
  const res = a.Import.applyReceipt(st, r.rows, opts, by, NOW);
  assert.equal(res.ok, true, res.reason);
});
function denied(r, what, re) {
  assert.ok(r, `${what}: пропущено`);
  assert.match(r.text, /^Нет прав: \S/, `${what}: «${r.text}»`);
  if (re) assert.match(r.text, re, `${what}: «${r.text}»`);
}

test('Guard: оприходование (Import.applyReceipt) — кладовщику с receive можно, директору с новым товаром можно; кладовщику с новым товаром и без receive — нельзя', () => {
  const a = app();
  const ok = receiptBatch(a, tab(['Тестовая панель Альфа 550 Вт', '10']), 'p5');
  deq([...new Set(ok.changes.map(c => c.key))].sort(), ['moves', 'notes', 'stock']);
  assert.equal(check(a, ok, 'p5'), null, 'кладовщик: приход существующего товара');
  // без права receive: свой приход тем же действием не провести (Import.applyReceipt откажет), поэтому пачка собрана движением руками
  for (const [pid, what] of [['p2', 'менеджер'], ['p6', 'логист']]) {
    const x = app(), own = batch(x, st => assert.equal(x.Stock.move(st, { kind: 'Приход', productId: PANEL.id, qty: 10, entityId: 'ip', cityId: 'irk', doc: DOC, by: pid, at: NOW }).ok, true));
    denied(check(x, own, pid), what + ' без receive', /Принимать товар/);
  }

  const b = app();
  const fresh = receiptBatch(b, tab(['Совсем новая штука', '7']), 'p1', { 0: 'new' });
  assert.ok(fresh.changes.some(c => c.key === 'products'), 'новый товар — в той же пачке');
  assert.equal(check(b, fresh, 'p1'), null, 'директор: новый товар и его приход');
  denied(check(b, fresh, 'p5'), 'кладовщик: чужая пачка с новым товаром', /Добавлять товары в номенклатуру/);
  // пачка кладовщика с новым товаром: тот же состав, но автор движения — он сам, и всё равно нельзя (нет права catalog)
  const c = app();
  const mine = batch(c, st => {
    const p = c.Catalog.add(st, { name: 'Совсем новая штука' }).product;
    assert.equal(c.Stock.move(st, { kind: 'Приход', productId: p.id, qty: 7, entityId: 'ip', cityId: 'irk', doc: DOC, by: 'p5', at: NOW }).ok, true);
  });
  denied(check(c, mine, 'p5'), 'кладовщик заводит новый товар', /Добавлять товары в номенклатуру/);
});

test('Guard: подделка оприходования — чужой by, количество 0 и дробное, неизвестный склад или юрлицо, нет товара — отказ целиком', () => {
  const a = app();
  const move = (st, o) => a.Stock.move(st, { kind: 'Приход', productId: PANEL.id, qty: 3, entityId: 'ip', cityId: 'irk', doc: DOC, by: 'p5', at: NOW, ...o });
  // чужой by: движение от имени директора, пачку шлёт кладовщик
  const other = batch(a, st => assert.equal(move(st, { by: 'p1' }).ok, true));
  denied(check(a, other, 'p5'), 'чужой by', /только от своего имени/);
  // количество 0: Stock.move его не примет — движение дописывается руками, остаток не меняется
  const zero = batch(app(), st => { st.moves.unshift({ id: 'mvZ', kind: 'Приход', productId: PANEL.id, qty: 0, entityId: 'ip', cityId: 'irk', doc: DOC, by: 'p5', at: NOW }); });
  denied(a.Guard.check(zero.st0, 'p5', zero.changes, NOW), 'количество 0', /больше нуля/);
  // дробное: 2.5 — число больше нуля, но не целое; остаток под него подогнан
  const half = batch(app(), st => { st.moves.unshift({ id: 'mvH', kind: 'Приход', productId: PANEL.id, qty: 2.5, entityId: 'ip', cityId: 'irk', doc: DOC, by: 'p5', at: NOW }); st.stock[PANEL.id].ip.irk += 2.5; });
  denied(a.Guard.check(half.st0, 'p5', half.changes, NOW), 'дробное количество', /целое/);
  for (const [what, cell] of [['неизвестный склад', { cityId: 'urupinsk' }], ['неизвестное юрлицо', { entityId: 'ooo' }], ['склад «нет данных»', { cityId: '_' }], ['юрлицо «нет данных»', { entityId: '_' }]]) {
    const b = batch(app(), st => assert.equal(move(st, cell).ok, true));
    denied(check(a, b, 'p5'), what, /из справочника/);
  }
  const noProduct = batch(app(), st => assert.equal(move(st, { productId: 'u-нет' }).ok, true));
  denied(check(a, noProduct, 'p5'), 'товара нет в номенклатуре', /нет в номенклатуре/);
  // тот же приход с настоящими данными проходит — отказы выше не от чего-то постороннего
  const good = batch(app(), st => assert.equal(move(st, {}).ok, true));
  assert.equal(check(a, good, 'p5'), null);
});

// ——— сервер: настоящий сервер и браузер ———
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

test('сервер: кладовщик оприходовал список через окно — одна запись на сервер, остаток и журнал видны директору; новый товар кладовщику недоступен', async () => {
  const srv = await kit.start();
  try {
    const boss = await kit.director(srv);
    const stockman = await kit.employee(srv, boss, { id: 'p5', name: 'Кладовщик (тест)', role: 'warehouse', dept: 'stock' });
    const P = (await kit.state(srv, boss.cookie)).products[0];
    const w = await openPage(srv, stockman.login, stockman.password);
    const { app: A } = w;
    A.byId('modal-root').querySelector = sel => (sel === '.modal' ? modal : null);
    const modal = { innerHTML: '', scrollTop: 0 };
    assert.ok(A.vStock().includes('data-act="rcpt-open"'), 'кнопка «Оприходовать товар» у кладовщика');
    assert.ok(!A.vStock().includes('data-act="new-product"'), 'а «Новый товар» — нет: нет права catalog');
    A.A['rcpt-open']();
    A.byId('rc-text').value = tab(['Название', 'Количество'], [P.name.toUpperCase(), '12'], ['Совсем новая штука', '4']);
    A.FORMS['rcpt-parse']();
    assert.match(modal.innerHTML, /проверьте список/);
    assert.ok(!modal.innerHTML.includes('создать новый товар'), 'кладовщику «создать новый» не предлагается');
    A.ON.change['rcpt-def']({ dataset: { f: 'entityId' }, value: 'ip' });
    A.ON.change['rcpt-def']({ dataset: { f: 'cityId' }, value: 'irk' });
    assert.match(modal.innerHTML, /id="rc-go" disabled/, 'есть неразобранная строка — «Оприходовать» неактивна');
    A.ON.change['rcpt-pick']({ dataset: { i: '1' }, value: 'skip' });
    assert.equal(A.byId('rc-go').disabled, false, 'строку пропустили — можно проводить');
    const n0 = posts(w);
    A.FORMS['rcpt-go']();
    await A.serverIdle();
    assert.equal(posts(w) - n0, 1, 'одна запись на сервер, а не по строке');
    assert.match(modal.innerHTML, /Оприходовано 1 позиция, создано 0 новых товаров/);
    // директор (второй сеанс) видит то же
    const st = await kit.state(srv, boss.cookie);
    assert.equal(st.stock[P.id].ip.irk, 12);
    const m = st.moves.find(x => x.productId === P.id);
    deq([m.kind, m.qty, m.by, m.entityId, m.cityId], ['Приход', 12, 'p5', 'ip', 'irk']);
    assert.match(m.doc, /^Оприходование \d\d\.\d\d\.\d{4}$/);
    assert.equal(st.products.length, 242, 'новый товар не создан');
  } finally { await srv.stop(); }
});

test('сервер: директор оприходовал со списком и новым товаром — товар появился у второго сеанса; подделки (нет receive, чужой by, 0, неизвестный склад, новый товар без catalog) — 403 и ничего не изменилось', async () => {
  const srv = await kit.start();
  try {
    const boss = await kit.director(srv);
    const stockman = await kit.employee(srv, boss, { id: 'p5', name: 'Кладовщик (тест)', role: 'warehouse', dept: 'stock' });
    const anna = await kit.employee(srv, boss, { id: 'p2', name: 'Анна (тест)', role: 'managerB2c', dept: 'sales' });
    const P = (await kit.state(srv, boss.cookie)).products[0].id;
    // директор через окно: существующий и новый товар
    const d = await openPage(srv, boss.login, boss.password);
    d.app.byId('modal-root').querySelector = sel => (sel === '.modal' ? modal : null);
    const modal = { innerHTML: '', scrollTop: 0 };
    d.app.A['rcpt-open']();
    d.app.byId('rc-text').value = tab(['Совсем новая штука', '7', 'НПП', 'Москва']);
    d.app.FORMS['rcpt-parse']();
    d.app.ON.change['rcpt-pick']({ dataset: { i: '0' }, value: 'new' });
    assert.match(modal.innerHTML || '', /проверьте список/);
    assert.equal(d.app.byId('rc-go').disabled, false);
    d.app.FORMS['rcpt-go']();
    await d.app.serverIdle();
    const after = await kit.state(srv, boss.cookie);
    const made = after.products.find(p => p.name === 'Совсем новая штука');
    assert.ok(made && made.price === null && made.src === 'user', 'новый товар без цены на сервере');
    assert.equal(after.stock[made.id].npp.msk, 7);
    assert.equal((await kit.state(srv, stockman.cookie)).products.find(p => p.id === made.id).name, 'Совсем новая штука', 'кладовщик (другой сеанс) видит новый товар');

    // подделки: пачка «приход + остаток» от разных людей
    const at = kit.dateDoc(kit.T0);
    const mv = (id, o = {}) => ({ id, at, productId: P, kind: 'Приход', qty: 3, entityId: 'ip', cityId: 'irk', doc: 'Оприходование 07.11.2026', by: 'p5', ...o });
    const batchOf = (id, o = {}) => [{ key: 'moves', id, base: null, data: mv(id, o) }, { key: 'stock', id: o.productId || P, base: null, data: { [o.entityId || 'ip']: { [o.cityId || 'irk']: o.qty === undefined ? 3 : o.qty } } }];
    const snap = async () => { const s = await kit.state(srv, boss.cookie); return JSON.stringify([s.seq, s.moves.length, s.products.length, s.stock]); };
    const base = await snap();
    const forged = [
      ['менеджер без receive', anna, batchOf('mvA1', { by: 'p2' }), /Принимать товар/],
      ['чужой by', stockman, batchOf('mvA2', { by: 'p1' }), /только от своего имени/],
      ['количество 0', stockman, [{ key: 'moves', id: 'mvA3', base: null, data: mv('mvA3', { qty: 0 }) }], /больше нуля/],
      ['неизвестный склад', stockman, batchOf('mvA4', { cityId: 'urupinsk' }), /из справочника/],
      ['неизвестное юрлицо', stockman, batchOf('mvA5', { entityId: 'ooo' }), /из справочника/],
      ['новый товар без catalog', stockman, [
        { key: 'products', id: 'u-forge', base: null, data: { id: 'u-forge', name: 'Подделка', brand: null, cat: 'Без раздела', price: null, avail: null, url: null, src: 'user', inCatalog: false } },
        ...batchOf('mvA6', { productId: 'u-forge' })], /Добавлять товары в номенклатуру/],
    ];
    for (const [what, who, list, re] of forged) {
      const r = await kit.changes(srv, who.cookie, list);
      assert.equal(r.status, 403, `${what}: ${r.status} ${r.text}`);
      assert.match(r.text, re, what);
      assert.equal(await snap(), base, `${what}: ничего не изменилось`);
    }
    // и честная пачка той же формы проходит — отказы выше именно от подделок
    assert.equal((await kit.changes(srv, stockman.cookie, batchOf('mvA7'))).status, 200);
  } finally { await srv.stop(); }
});

// ——— экран (демо) ———
test('экран: кнопка «Оприходовать товар» — у кладовщика и директора, у менеджера и логиста нет; «Новый товар» по-прежнему только с правом catalog', () => {
  const a = app();
  const has = (me, act) => { a.S.me = me; a.S.ui.stockTab = 'goods'; return a.vStock().includes(`data-act="${act}"`); };
  deq(['p5', 'p1', 'p2', 'p6'].map(p => has(p, 'rcpt-open')), [true, true, false, false]);
  deq(['p5', 'p1'].map(p => has(p, 'new-product')), [false, true]);
});

test('экран: список из 5 строк — найдено, найдено с опечаткой по выбору, новая, ошибка; «Оприходовать» неактивна, пока не разобрано; итог и ссылка на журнал', () => {
  const a = app();
  a.S.me = 'p1';
  const root = a.byId('modal-root'), modal = { innerHTML: '', scrollTop: 0 };
  root.querySelector = sel => (sel === '.modal' ? modal : null);
  a.A['rcpt-open']();
  assert.match(root.innerHTML, /Вставьте список из Excel/);
  assert.match(root.innerHTML, /Всё это приходит на: юрлицо/);
  assert.match(root.innerHTML, /type="file"/);
  a.byId('rc-text').value = tab(['Тестовая панель Альфа 550 Вт', '10'], ['Тестовый кабель Гамма 4 мм2', '20'], ['Тестовая панел Альфа 550', '3'], ['Совсем новая штука', '7'], ['Тестовый инвертор Бета 5 кВт', 'пять']);
  a.FORMS['rcpt-parse']();
  const html = () => modal.innerHTML;
  assert.match(html(), /проверьте список/);
  assert.match(html(), /id="rc-go" disabled/);
  assert.match(html(), /не выбрано юрлицо/, 'без «всё это приходит на» строки без своего склада — с ошибкой');
  a.ON.change['rcpt-def']({ dataset: { f: 'entityId' }, value: 'ip' });
  a.ON.change['rcpt-def']({ dataset: { f: 'cityId' }, value: 'irk' });
  assert.match(html(), /ждут выбора 2/);
  assert.match(html(), /не число/);
  assert.match(html(), /это тот же: Тестовая панель Альфа 550 Вт/);
  assert.match(html(), /создать новый товар/);
  a.ON.change['rcpt-pick']({ dataset: { i: '2' }, value: PANEL.id });
  a.ON.change['rcpt-pick']({ dataset: { i: '3' }, value: 'new' });
  a.ON.change['rcpt-f']({ dataset: { i: '4', f: 'qty' }, value: '5' });
  assert.equal(a.byId('rc-go').disabled, false, 'всё разобрано');
  assert.match(a.byId('rc-sum').innerHTML, /Будет оприходовано: <b>4<\/b> позиции, всего 45, новых товаров: <b>1<\/b>/);
  assert.match(a.byId('rc-sum').innerHTML, /строки 1 и 3.*всего 13/, 'панель дважды — сложена, с предупреждением');
  a.FORMS['rcpt-go']();
  assert.match(html(), /Оприходовано 4 позиции, создано 1 новый товар/);
  assert.match(html(), /data-act="rcpt-journal"/);
  assert.equal(cellOf(a, PANEL.id), 18, '5 + 10 + 3');
  assert.equal(cellOf(a, CABLE.id), 20);
  assert.equal(cellOf(a, INV.id), 5, 'исправленное в предпросмотре количество «пять» → 5');
  const made = a.S.products.find(p => p.name === 'Совсем новая штука');
  assert.equal(cellOf(a, made.id), 7);
  a.A['rcpt-journal']();
  deq([a.S.view, a.S.ui.stockTab, a.S.ui.mvKind], ['stock', 'moves', 'Приход']);
  assert.ok(a.vStock().includes(DOC), 'в журнале — документ «Оприходование <дата>»');
});
