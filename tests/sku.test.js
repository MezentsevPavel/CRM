'use strict';
// Слова директора 2026-11-07: «Ещё везде нужен артикул. Прям абсолютно везде, чтобы по артикулу поиск, работа с артикулом»;
// «Оприходовать товар: „вставьте список из Excel — название, количество, юрлицо“ — тут я не особо понимаю, что сделать.
// Я могу тут вручную ввести».
// Здесь: поле товара sku (Catalog), поиск по артикулу, артикул на экранах и в текстах, колонка «Артикул» в переносе остатков и в списке
// прихода, права сервера на поле, инструкция и ручной ввод в окне «Оприходовать товар». Данные искусственные: артикулы придуманы тестом.

const test = require('node:test');
const assert = require('node:assert/strict');
const { load: loadRaw } = require('./load.js');
// Тесты про артикул, который вводит человек, держат в демо товары без артикула; у товаров снимка каталога артикулы с сайта теперь есть
// (tests/catalog-sync.test.js), а товары «Электрики» поставщиков находятся по словам «автомат», «32А», поэтому здесь и то и другое убрано — проверяется только поле, которое ставят руками.
const load = opts => { const a = loadRaw(opts); if (a.S) { a.S.products = a.S.products.filter(p => p.sheet !== 'Электрика'); for (const p of a.S.products) if (p.src === 'catalog') delete p.sku; } return a; };

const plain = v => JSON.parse(JSON.stringify(v === undefined ? null : v));
const deq = (actual, expected, msg) => assert.deepEqual(plain(actual), plain(expected), msg);
const NOW = new Date(2026, 10, 7, 12, 0, 0);

// Три товара с придуманными артикулами; четвёртый — без артикула
function world() {
  const a = load({ now: NOW });
  const add = (name, sku) => { const r = a.Catalog.add(a.S, { name, cat: 'Тест', sku }); assert.equal(r.ok, true, r.reason); return r.product; };
  const p1 = add('Тест Автомат трёхполюсный', 'АВТ-3П-32A');
  const p2 = add('Тест Переключатель трёхпозиционный', 'ПЕР 3ПОЗ 63');
  const p3 = add('Тест АВР двухвводный', 'avr/2in');
  const p4 = add('Тест Кабель без артикула');
  return { a, p1, p2, p3, p4 };
}
const tab = (...rows) => rows.map(r => r.join('\t')).join('\n');

// ——— ядро: поле, сравнение, поиск ———
test('Catalog: артикул — необязательная строка товара; skuKey не различает регистр, пробелы, дефисы, точки, подчёркивания и косые; label даёт «название (арт. X)»', () => {
  const { a, p1, p4 } = world();
  const { Catalog } = a;
  assert.equal(p1.sku, 'АВТ-3П-32A');
  assert.equal(p4.sku, undefined, 'не указан — поля нет, а не пустая строка и не «0»');
  assert.equal(Catalog.skuOf(p4), '');
  assert.equal(Catalog.skuKey('АВТ-3П-32A'), Catalog.skuKey('авт 3п 32a'));
  assert.equal(Catalog.skuKey('AB_12.3/4'), 'ab1234');
  assert.equal(Catalog.label(p1), 'Тест Автомат трёхполюсный (арт. АВТ-3П-32A)');
  assert.equal(Catalog.label(p4), 'Тест Кабель без артикула', 'нет артикула — одно название, без выдуманного');
  assert.equal(Catalog.label(undefined), 'нет данных: товар');
  assert.equal(a.skuText(p4), 'Артикул: нет данных');
  assert.equal(a.skuText(p1), 'АВТ-3П-32A', 'в списках — просто артикул, без слов «арт.»');
  // управляющие знаки и пробелы чистятся, длина ограничена
  assert.equal(Catalog.skuClean('  A\u0000 B\n C  '), 'A B C');
  assert.equal(Catalog.add(a.S, { name: 'Тест длинный', sku: 'x'.repeat(200) }).product.sku.length, Catalog.SKU_MAX);
});

test('Catalog.query: поиск по артикулу — целиком и частью, без регистра, пробелов и дефисов; точное совпадение первым; вместе со словом названия', () => {
  const { a, p1, p2, p3, p4 } = world();
  const ids = q => a.Catalog.query(a.S, { q }).map(p => p.id);
  deq(ids('АВТ-3П-32A'), [p1.id], 'целиком');
  deq(ids('авт3п32а').length, 0, 'лат. «A» и кир. «а» — разные буквы: артикул ищется как написан');
  deq(ids('авт 3п 32a'), [p1.id], 'пробелы вместо дефисов');
  deq(ids('3П-32'), [p1.id], 'часть артикула');
  deq(ids('пер3поз63'), [p2.id], 'без пробелов и с другим регистром');
  deq(ids('AVR-2IN'), [p3.id], 'дефис вместо косой, регистр');
  deq(ids('Автомат 32a'), [p1.id], 'слово названия и часть артикула вместе');
  assert.ok(!ids('кабель без артикула').includes(p1.id) && ids('кабель без артикула').includes(p4.id), 'по названию — как раньше');
  // точное совпадение — в начале списка, даже если по порядку позже
  const late = a.Catalog.add(a.S, { name: 'Тест Поздний', sku: 'ТЕСТ-7' }).product;
  const early = a.Catalog.add(a.S, { name: 'Тест Ранний', sku: 'ТЕСТ-70' }).product;
  a.S.products.splice(a.S.products.indexOf(early), 1); a.S.products.splice(a.S.products.indexOf(late), 0, early);
  deq(ids('ТЕСТ-7').slice(0, 2), [late.id, early.id], 'точный «ТЕСТ-7» перед «ТЕСТ-70»');
});

test('Catalog.setSku и bySku: поставить, заменить, убрать; такой же артикул у другого товара — не отказ, а список «same»; длиннее предела — отказ', () => {
  const { a, p1, p2, p4 } = world();
  const { Catalog, S } = a;
  let r = Catalog.setSku(S, p4.id, ' кб-4 ');
  assert.equal(r.ok, true); assert.equal(p4.sku, 'кб-4'); deq(r.same, []);
  r = Catalog.setSku(S, p2.id, 'авт 3п-32A');
  assert.equal(r.ok, true, 'повтор артикула не запрещён');
  deq(r.same.map(p => p.id), [p1.id], 'но названо, у кого он уже есть');
  deq(Catalog.bySku(S, 'АВТ-3П-32A', p2.id).map(p => p.id), [p1.id]);
  deq(Catalog.bySku(S, ''), [], 'пустой артикул не ищется');
  r = Catalog.setSku(S, p4.id, '');
  assert.equal(r.ok, true); assert.equal('sku' in p4, false, 'пусто — поле убрано, снова «нет данных»');
  assert.equal(Catalog.setSku(S, p4.id, 'y'.repeat(Catalog.SKU_MAX + 1)).ok, false);
  assert.equal(Catalog.setSku(S, 'нет-такого', 'z').ok, false);
});

// ——— права сервера ———
function batch(a, fn) {
  const docs = a.Docs.split(a.S), st0 = a.Docs.join(docs);
  fn(a.S);
  return { st0, changes: a.Docs.diff(docs, a.Docs.split(a.S)) };
}
const check = (a, b, pid) => a.Guard.check(b.st0, pid, b.changes, NOW);

test('Guard: артикул пишет право catalog (в той же записи товара); не строка и длиннее предела — отказ; без права — отказ', () => {
  const a = load({ now: NOW });
  const p = a.Catalog.add(a.S, { name: 'Тест Товар для артикула' }).product;
  const b1 = batch(a, st => a.Catalog.setSku(st, p.id, 'ТЕСТ-1'));
  assert.equal(check(a, b1, 'p3'), null, 'менеджер с catalog');
  const bad = batch(a, st => { st.products.find(x => x.id === p.id).sku = 12345; });
  assert.match(check(a, bad, 'p3').text, /артикул — строка не длиннее/);
  const long = batch(a, st => { st.products.find(x => x.id === p.id).sku = 'q'.repeat(a.Catalog.SKU_MAX + 1); });
  assert.match(check(a, long, 'p3').text, /артикул — строка не длиннее/);
  const a2 = load({ now: NOW });
  const p2 = a2.Catalog.add(a2.S, { name: 'Тест Товар для артикула' }).product;
  a2.S.roles.find(r => r.id === 'managerB2b').perms.catalog = false;
  const b2 = batch(a2, st => a2.Catalog.setSku(st, p2.id, 'ТЕСТ-2'));
  const r = check(a2, b2, 'p3');
  assert.match(r.text, /^Нет прав: /); assert.match(r.text, /менять товары/);
});

// ——— перенос остатков: колонка «Артикул» ———
test('Import.stockRows и applyStock: колонка «Артикул» или «Арт.» ложится в товары листа; артикул, поставленный руками, не затирается; без колонки — как раньше', () => {
  const a = load({ now: NOW });
  const table = [
    ['Наименование', 'Арт.', 'Склад ИП', 'НПП', 'ВС'],
    ['Тестовые панели'],
    ['Тест Панель Лист А', 'ЛИСТ-А-1', '5', '', ''],
    ['Тест Панель Лист Б', '', '7', '', ''],
    ['Тест Панель Лист В', 'ЛИСТ-В-3', '2', '', ''],
  ];
  const parsed = a.Import.stockRows(table);
  deq(parsed.problems, []);
  deq(parsed.rows.map(r => r.sku), ['ЛИСТ-А-1', undefined, 'ЛИСТ-В-3']);
  assert.equal(parsed.rows[0].name, 'Тест Панель Лист А', 'название не спутано с артикулом');
  const res = a.Import.applyStock(a.S, parsed.rows, 'p1', NOW);
  assert.equal(res.skus, 2);
  const by = n => a.S.products.find(p => p.name === n);
  assert.equal(by('Тест Панель Лист А').sku, 'ЛИСТ-А-1');
  assert.equal(by('Тест Панель Лист Б').sku, undefined, 'у строки без артикула поля нет');
  // повторный перенос: поставленный руками артикул остаётся
  a.Catalog.setSku(a.S, by('Тест Панель Лист А').id, 'РУКАМИ-9');
  a.Import.applyStock(a.S, parsed.rows, 'p1', NOW);
  assert.equal(by('Тест Панель Лист А').sku, 'РУКАМИ-9');
  // таблица без колонки артикула
  const old = a.Import.stockRows([['Наименование', 'Склад ИП', 'НПП'], ['Раздел'], ['Тест Панель Лист Г', '1', '']]);
  deq(old.problems, []); assert.equal(old.rows[0].sku, undefined);
});

// ——— список прихода: артикул ———
test('receiptRows: заголовок «Артикул» — отдельная колонка; только артикул без названия; без заголовка первая колонка — «артикул или название»', () => {
  const a = load({ now: NOW });
  let r = a.Import.receiptRows(tab(['Артикул', 'Название', 'Количество'], ['А-1', 'Тест Один', '5'], ['', 'Тест Два', '3']));
  deq(r.rows.map(x => [x.sku, x.name, x.qty]), [['А-1', 'Тест Один', '5'], ['', 'Тест Два', '3']]);
  r = a.Import.receiptRows(tab(['Арт.', 'Кол-во'], ['А-1', '5']));
  deq(r.rows.map(x => [x.sku, x.name, x.qty]), [['А-1', '', '5']], 'есть «Артикул», а названия нет — товар опознаётся по артикулу');
  r = a.Import.receiptRows(tab(['А-1', '5'], ['Тест Два', '3']));
  deq(r.rows.map(x => [x.sku, x.name, x.qty]), [['', 'А-1', '5'], ['', 'Тест Два', '3']], 'без заголовка всё в первой колонке — разбор дальше');
});

test('receiptPlan: сперва по артикулу (и в колонке артикула, и в первой колонке), потом по ключу, потом по названию; два товара с одним артикулом — на выбор', () => {
  const { a, p1, p2, p3 } = world();
  const plan = (rows, opts = {}) => a.Import.receiptPlan(a.S, rows, { entityId: 'ip', cityId: 'irk', canCreate: true, ...opts });
  const row = (name, sku, qty = '1') => ({ name, sku, qty, entity: '', city: '', pick: '' });
  let P = plan([row('авт 3п 32a', ''), row('', 'пер3поз63'), row('Чужое название', 'avr 2in'), row(p3.id, ''), row('Тест Автомат трёхполюсный', '')]);
  deq(P.lines.map(l => [l.status, l.productId]), [['found', p1.id], ['found', p2.id], ['found', p3.id], ['found', p3.id], ['found', p1.id]],
    'артикул в первой колонке, в своей колонке, артикул старше названия, ключ, название');
  assert.equal(P.lines[0].productSku, 'АВТ-3П-32A', 'в строке видно, какой артикул у найденного');
  // два товара с одним артикулом
  a.Catalog.setSku(a.S, p2.id, 'АВТ-3П-32A');
  P = plan([row('', 'авт 3п 32a')]);
  assert.equal(P.lines[0].status, 'choose'); deq(P.lines[0].candidates.map(c => c.id).sort(), [p1.id, p2.id].sort());
  assert.ok(P.lines[0].candidates.every(c => c.sku === 'АВТ-3П-32A'), 'у вариантов виден артикул');
  // артикула нет нигде: только артикул — на «новый товар» нужно название
  P = plan([{ ...row('', 'НЕТ-ТАКОГО'), pick: 'new' }]);
  assert.equal(P.lines[0].status, 'error'); assert.match(P.lines[0].error, /нужно название/);
  P = plan([{ ...row('Тест Совсем Новый', 'НОВ-77'), pick: 'new' }]);
  assert.equal(P.lines[0].status, 'new'); assert.equal(P.groups[0].sku, 'НОВ-77');
  P = plan([row('', '')]);
  assert.match(P.lines[0].error, /нет названия или артикула/);
});

test('applyReceipt: у нового товара артикул из строки сохраняется; найденному по артикулу остаток растёт, артикул не меняется; в тексте уведомления артикул не нужен', () => {
  const { a, p1 } = world();
  const rows = [{ name: '', sku: 'авт-3п-32a', qty: '4', entity: '', city: '', pick: '' }, { name: 'Тест Рождён Приходом', sku: 'РОД-1', qty: '2', entity: '', city: '', pick: 'new' }];
  const r = a.Import.applyReceipt(a.S, rows, { entityId: 'ip', cityId: 'irk' }, 'p1', NOW);
  assert.equal(r.ok, true, r.reason);
  assert.equal(a.S.stock[p1.id].ip.irk, 4);
  assert.equal(p1.sku, 'АВТ-3П-32A', 'артикул найденного не тронут');
  const made = a.S.products.find(p => p.name === 'Тест Рождён Приходом');
  assert.equal(made.sku, 'РОД-1');
  assert.equal(a.S.stock[made.id].ip.irk, 2);
});

// ——— экран ———
function page(me = 'p1') {
  const a = load({ now: NOW });
  a.setMe(me);
  a.S.view = 'stock';
  a.render();
  const modal = { innerHTML: '', scrollTop: 0 };
  a.byId('modal-root').querySelector = sel => (sel === '.modal' ? modal : null);
  return { a, modal };
}
const withSku = (a, n = 3) => a.S.products.slice(0, n).map((p, i) => { p.sku = `ТЕСТ-ЭКР-${i + 1}`; return p; });

test('экран: артикул в списке номенклатуры (под названием, а нет — «Артикул: нет данных»), в карточке первой строкой с «Изменить», в журнале движений, в глобальном поиске', () => {
  const { a } = page();
  const [p1] = withSku(a, 1), bare = a.S.products[5];
  assert.equal(bare.sku, undefined);
  const row = a.stockRow(p1, true), rowBare = a.stockRow(bare, true);
  assert.match(row, /<small class="sku">ТЕСТ-ЭКР-1<\/small>/);
  assert.match(rowBare, /<small class="sku muted">Артикул: нет данных<\/small>/);
  const card = a.dProduct(p1);
  assert.ok(card.body.indexOf('Артикул') >= 0 && card.body.indexOf('Артикул') < card.body.indexOf('Модель'), 'в карточке «Артикул» — первой строкой, выше «Модели»');
  assert.match(card.body, /<b class="mono">ТЕСТ-ЭКР-1<\/b> <button[^>]*data-act="product-sku"[^>]*>Изменить<\/button>/);
  assert.match(a.dProduct(bare).body, /Артикул: нет данных<\/span> <button[^>]*data-act="product-sku"[^>]*>Указать/);
  // журнал: строка и фильтр по товару
  a.Stock.move(a.S, { kind: 'Приход', productId: p1.id, qty: 3, entityId: 'ip', cityId: 'irk', doc: 'Тест', by: 'p1', at: NOW });
  assert.match(a.movesTable(), /ТЕСТ-ЭКР-1/);
  assert.match(a.movesPane(''), /ТЕСТ-ЭКР-1\)/, 'в списке «Товар» фильтра — название с артикулом');
  // глобальный поиск
  const hit = a.SEARCH.find(s => s.kind === 'product').find('тест-экр-1');
  assert.equal(hit.length >= 1 && hit[0].title, p1.name);
  assert.match(hit[0].sub, /ТЕСТ-ЭКР-1/, 'артикул виден в результате');
  // поиск номенклатуры: строка поиска и таблица
  a.S.ui.sq = 'тест эк р1'.replace(' р', 'р'); // «тест экр1» — без дефиса
  assert.match(a.stockTable(), /ТЕСТ-ЭКР-1/);
});

test('экран: «Изменить» артикул в карточке — окно, предупреждение о таком же артикуле у другого товара (не запрет), одно сохранение, «Указать» у товара без артикула', () => {
  const { a } = page();
  const [p1, p2] = withSku(a, 2);
  const saves = [];
  Object.defineProperty(a.storage, a.Store.KEY, { set: v => saves.push(v), get: () => saves[saves.length - 1], configurable: true, enumerable: true });
  a.A['product-sku']({ dataset: { pid: p2.id } });
  assert.match(a.byId('modal-root').innerHTML, /id="ps-sku"[^>]*value="ТЕСТ-ЭКР-2"/);
  // пока набирают чужой артикул — предупреждение под полем
  a.byId('ps-dup').hidden = true;
  a.ON.input['sku-dup']({ value: 'тест экр 1', dataset: { hint: 'ps-dup', pid: p2.id } });
  assert.match(a.byId('ps-dup').textContent, /такой артикул уже есть у «/);
  assert.equal(a.byId('ps-dup').hidden, false);
  a.byId('ps-sku').value = 'тест экр 1';
  const before = saves.length;
  a.FORMS['product-sku']({ dataset: { pid: p2.id } });
  assert.equal(p2.sku, 'тест экр 1', 'повтор не запрещён, сохранено');
  assert.equal(saves.length - before, 1, 'одно действие — одно сохранение');
  a.byId('ps-sku').value = '';
  a.FORMS['product-sku']({ dataset: { pid: p2.id } });
  assert.equal('sku' in p2, false, 'пусто — артикул убран');
  // право: без catalog нет кнопки и действие отказывает
  const q = page('p3');
  q.a.S.roles.find(r => r.id === 'managerB2b').perms.catalog = false;
  assert.doesNotMatch(q.a.dProduct(q.a.S.products[0]).body, /data-act="product-sku"/);
  q.a.A['product-sku']({ dataset: { pid: q.a.S.products[0].id } });
  assert.doesNotMatch(q.a.byId('modal-root').innerHTML, /id="ps-sku"/);
});

test('экран: «Новый товар» — поле «Артикул» (необязательно), предупреждение о повторе, артикул у созданного товара и в уведомлении', () => {
  const { a } = page();
  const [p1] = withSku(a, 1);
  assert.match(a.mProduct(), /id="np-sku"/);
  assert.match(a.mProduct(), /Необязательно\. Пусто — «Артикул: нет данных»/);
  const field = { 'np-name': 'Тест Новинка', 'np-unit': 'шт', 'np-cat': a.Catalog.NO_CAT, 'np-sku': 'тест-экр-1', 'np-price': null };
  for (const [id, v] of Object.entries(field)) { const e = a.byId(id); if (v !== null) e.value = v; }
  a.byId('np-price').value = '';
  a.FORMS.product();
  const made = a.S.products.find(p => p.name === 'Тест Новинка');
  assert.equal(made.sku, 'тест-экр-1');
  assert.ok(a.S.notes.some(n => /Тест Новинка \(арт\. тест-экр-1\)/.test(n.text)) || a.S.notify.some(n => /Тест Новинка \(арт\. тест-экр-1\)/.test(n.text)), 'в уведомлении — название с артикулом');
  assert.ok(p1);
});

test('экран: артикул в строке сделки и в поиске товара сделки; в ленте сделки — название с артикулом', () => {
  const { a } = page();
  const d = a.S.deals.find(x => (x.items || []).some(i => i.productId));
  const it = d.items.find(i => i.productId), p = a.product(it.productId);
  p.sku = 'СДЕЛКА-1';
  assert.match(a.dealLine(d, it, d.items.indexOf(it), true, true), /<small class="sku">СДЕЛКА-1<\/small>/, 'строка сделки');
  assert.equal(a.Deals.itemLabel(a.S, it), `${p.name} (арт. СДЕЛКА-1)`);
  assert.equal(a.Deals.itemName(a.S, it), p.name, 'название для экрана — прежнее, артикул рядом отдельно');
  const found = a.dealFound(d, 'сделка1');
  assert.ok(found.includes(`data-pid="${p.id}"`) && found.includes('СДЕЛКА-1'), 'поиск в сделке по артикулу без дефиса, артикул виден в ответе');
  // строка без артикула в сделке — «Артикул: нет данных»
  p.sku = '';
  assert.match(a.dealLine(d, it, d.items.indexOf(it), true, true), /Артикул: нет данных/);
  // лента сделки: добавили строку — в записи название с артикулом
  p.sku = 'СДЕЛКА-1';
  const n = a.S.feed.length;
  assert.equal(a.Deals.addItem(a.S, d.id, { productId: p.id }, 'p1', NOW).ok, true);
  assert.match(a.S.feed[a.S.feed.length - 1].text, /Добавлена строка: .*\(арт\. СДЕЛКА-1\)/);
  assert.equal(a.S.feed.length, n + 1);
});

test('экран: артикул в позициях поставки (строка и окно, поиск по позициям), в заявке на отправку (поиск, строка), в приёмке и в уведомлении о приёмке', () => {
  const { a } = page();
  const s = a.S.shipments.find(x => (x.items || []).length);
  const sp = a.product(s.items[0].productId);
  sp.sku = 'ПОСТ-1';
  assert.match(a.shipItems(s), /<small class="sku">ПОСТ-1<\/small>/);
  assert.match(a.shipItemsList(s, ''), /ПОСТ-1/);
  assert.ok(a.shipItemsList(s, 'пост1').includes(sp.name), 'поиск по позициям поставки — по артикулу без дефиса');
  assert.ok(!a.shipItemsList(s, 'нет-такого-артикула-zz').includes(sp.name));
  // поиск по поставкам в списке (Ships.query) — по артикулу товара в поставке
  const hits = a.Ships.query(a.S, { q: 'пост1' });
  assert.ok(hits.rows.some(x => x.id === s.id), 'поставка находится по артикулу своего товара');
  // заявка на отправку: поиск товара и строка
  a.S.ui.dspDraft = a.dspDraftFrom({}, '');
  assert.match(a.dspPresHtml('ПОСТ-1'), /ПОСТ-1/);
  a.S.ui.dspDraft.items.push({ productId: sp.id, qty: 2 });
  assert.match(a.dspItemsHtml(a.S.ui.dspDraft), /<small class="sku">ПОСТ-1<\/small>/);
  // приёмка: экран пересчёта (телефон) и итог перед подтверждением; недобор — в тексте
  const ship = a.S.shipments.find(x => x.dir === 'in' && (x.items || []).length > 0 && x.stageId !== 'inStock');
  ship.items.forEach((it, i) => { a.product(it.productId).sku = 'ПРИЁМ-' + (i + 1); });
  a.S.rcv = { shipId: ship.id, qty: {}, dmg: {}, note: '', photos: [], done: null };
  assert.match(a.rcvPhoneHtml(a.S.rcv, [ship]), /<small class="sku">ПРИЁМ-1<\/small>/, 'пересчёт товара');
  assert.match(a.rcvPreview(), /<small class="sku">ПРИЁМ-1<\/small>/, 'итог перед подтверждением');
  a.S.rcv.qty[ship.items[0].productId] = '0';
  assert.ok(a.rcvPlan().issues.some(x => /\(арт\. ПРИЁМ-1\)/.test(x)), 'в тексте недобора — с артикулом');
});

test('Stock, Feed, Dispatch, Ships: тексты уведомлений и ленты называют товар с артикулом, если он есть, и просто названием, если нет', () => {
  const { a } = page();
  const [p1] = withSku(a, 1), bare = a.S.products[7];
  assert.equal(bare.sku, undefined);
  // резерв без сделки — уведомление
  const cell = a.Stock.bestCell(a.S, p1.id);
  a.Stock.move(a.S, { kind: 'Приход', productId: p1.id, qty: 5, entityId: 'ip', cityId: 'irk', doc: 'Тест', by: 'p1', at: NOW });
  const r = a.Stock.reserveFor(a.S, { productId: p1.id, qty: 1, src: 'stock', entityId: 'ip', cityId: 'irk', until: new Date(2026, 10, 20), forWho: 'тест' }, 'p1', NOW);
  assert.equal(r.ok, true, r.reason);
  assert.match(a.S.notes[0].text, /резерв без сделки: .*\(арт\. ТЕСТ-ЭКР-1\)/i);
  assert.ok(cell);
  // лента: подпись резерва
  assert.match(a.Feed.reserveText(a.S, r.reserve), /\(арт\. ТЕСТ-ЭКР-1\)/);
  a.Stock.move(a.S, { kind: 'Приход', productId: bare.id, qty: 5, entityId: 'ip', cityId: 'irk', doc: 'Тест', by: 'p1', at: NOW });
  const r2 = a.Stock.reserveFor(a.S, { productId: bare.id, qty: 1, src: 'stock', entityId: 'ip', cityId: 'irk', until: new Date(2026, 10, 20), forWho: 'тест' }, 'p1', NOW);
  assert.doesNotMatch(a.Feed.reserveText(a.S, r2.reserve), /арт\./, 'нет артикула — ни слова «арт.», ни выдуманного');
  // отправка: «что везём» в уведомлении об этапе поставки
  const s = a.S.shipments.find(x => (x.items || []).length);
  a.product(s.items[0].productId).sku = 'КРАТКО-5';
  assert.match(a.Ships.brief(a.S, s), /\(арт\. КРАТКО-5\)/);
});

// ——— сервер ———
const kit = require('./server-kit.js');
test('сервер: сотрудник с правом catalog пишет артикул товара по HTTP, второй сеанс его видит; не строка — 403; без права — 403; артикул переживает перезапуск', async () => {
  const srv = await kit.start();
  try {
    const boss = await kit.director(srv);
    const sales = await kit.employee(srv, boss, { id: 'p3', name: 'Менеджер (тест)', role: 'managerB2b', dept: 'sales' });
    const prod = { id: 'u-s1', name: 'Автомат (тест артикула)', brand: null, cat: 'Без раздела', price: null, avail: null, url: null, src: 'user', inCatalog: false, sku: 'СЕРВ-1' };
    let r = await kit.changes(srv, sales.cookie, [{ key: 'products', id: 'u-s1', base: null, data: prod }]);
    assert.equal(r.status, 200, r.text);
    assert.equal((await kit.state(srv, boss.cookie)).products.find(p => p.id === 'u-s1').sku, 'СЕРВ-1', 'директор видит артикул');
    // замена и снятие артикула
    r = await kit.changes(srv, sales.cookie, [{ key: 'products', id: 'u-s1', base: prod, data: { ...prod, sku: 'СЕРВ-2' } }]);
    assert.equal(r.status, 200, r.text);
    // не строка
    const cur = (await kit.state(srv, boss.cookie)).products.find(p => p.id === 'u-s1');
    r = await kit.changes(srv, sales.cookie, [{ key: 'products', id: 'u-s1', base: cur, data: { ...cur, sku: 12345 } }]);
    assert.equal(r.status, 403, r.text); assert.match(r.body.error, /артикул — строка/);
    // директор отнимает право — менеджер артикул больше не меняет
    const role = (await kit.state(srv, boss.cookie)).roles.find(x => x.id === 'managerB2b');
    r = await kit.changes(srv, boss.cookie, [{ key: 'roles', id: 'managerB2b', base: role, data: { ...role, perms: { ...role.perms, catalog: false } } }]);
    assert.equal(r.status, 200, r.text);
    r = await kit.changes(srv, sales.cookie, [{ key: 'products', id: 'u-s1', base: cur, data: { ...cur, sku: 'ВЗЛОМ' } }]);
    assert.equal(r.status, 403, r.text); assert.match(r.body.error, /^Нет прав: /);
    assert.equal((await kit.state(srv, boss.cookie)).products.find(p => p.id === 'u-s1').sku, 'СЕРВ-2');
  } finally { await srv.stop(); }
});
