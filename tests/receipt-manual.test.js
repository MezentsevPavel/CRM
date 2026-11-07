'use strict';
// Слова директора 2026-11-07: «Оприходовать товар: „вставьте список из Excel — название, количество, юрлицо“ — тут я не особо понимаю,
// что сделать. Я могу тут вручную ввести».
// Здесь: инструкция над полем вставки (колонки, пример на настоящих названиях номенклатуры, «Вставить пример»), вкладки «Вставить список» /
// «Ввести вручную», таблица строк с поиском товара по названию и артикулу, и то, что ручной ввод идёт в ту же проверку и ту же
// Import.applyReceipt, что и вставка. Данные искусственные.

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.js');

const plain = v => JSON.parse(JSON.stringify(v === undefined ? null : v));
const deq = (actual, expected, msg) => assert.deepEqual(plain(actual), plain(expected), msg);
const NOW = new Date(2026, 10, 7, 12, 0, 0);

const PANEL = { id: 'u-m1', name: 'Тестовая панель Альфа 550 Вт', sku: 'ПАН-550' };
const INV = { id: 'u-m2', name: 'Тестовый инвертор Бета 5 кВт', sku: 'ИНВ-5000' };
const CABLE = { id: 'u-m3', name: 'Тестовый кабель Гамма 4 мм2' };   // артикула нет

function page(me = 'p1') {
  const a = load({ now: NOW });
  for (const p of [PANEL, INV, CABLE]) {
    const rec = { id: p.id, name: p.name, brand: null, cat: 'Тест', price: null, avail: null, url: null, src: 'user', inCatalog: false };
    if (p.sku) rec.sku = p.sku;
    a.S.products.push(rec);
  }
  a.S.stock[PANEL.id] = { ip: { irk: 5 } };
  a.setMe(me);
  a.S.view = 'stock';
  a.render();
  const root = a.byId('modal-root'), modal = { innerHTML: '', scrollTop: 0 };
  root.querySelector = sel => (sel === '.modal' ? modal : null);
  return { a, root, modal };
}
const cellOf = (a, pid, e = 'ip', c = 'irk') => ((a.S.stock[pid] || {})[e] || {})[c];
const entId = (a, i = 0) => a.S.entities[i].id, cityId = (a, i = 0) => a.S.cities[i].id;

// ——— инструкция ———
test('окно «Оприходовать»: над полем вставки — колонки словами, как копировать из Excel, пример из трёх строк на названиях из номенклатуры и кнопка «Вставить пример»', () => {
  const { a, root } = page();
  a.A['rcpt-open']();
  const html = root.innerHTML;
  assert.match(html, /Колонки: Артикул или Название — Количество — Юрлицо — Склад/);
  assert.match(html, /юрлицо и склад можно не писать/i);
  assert.match(html, /копировать прямо из Excel/);
  assert.match(html, /data-act="rcpt-example"[^>]*>Вставить пример</);
  // пример — три строки, каждая опознаётся по настоящей номенклатуре (название или артикул, который есть у товара)
  const ex = a.rcptExample();
  assert.equal(ex.length, 3);
  for (const r of ex) {
    const hit = a.S.products.some(p => p.name === r.id || a.Catalog.skuOf(p) === r.id);
    assert.ok(hit, `пример «${r.id}» — не из номенклатуры`);
  }
  assert.equal((html.match(/<tr><td>/g) || []).length, 3, 'пример показан таблицей из трёх строк');
  for (const r of ex) assert.ok(html.includes(a.esc(r.id)), 'название из примера — на экране');
});

test('«Вставить пример» кладёт пример в поле, и он разбирается тем же разбором без ошибок и без «выберите»; у номенклатуры с артикулом пример идёт и по артикулу', () => {
  const { a, root, modal } = page();
  // три первых товара с короткими названиями получают артикулы: вторая строка примера — по артикулу
  const short = a.S.products.filter(p => p.name.length <= 60).slice(0, 3);
  short.forEach((p, i) => { p.sku = `ПРИМЕР-${i + 1}`; });
  a.A['rcpt-open']();
  a.A['rcpt-example']();
  assert.match(modal.innerHTML, new RegExp(`ПРИМЕР-2`), 'вторая строка — артикул');
  assert.ok(a.RCPT.text.split('\n').length === 3);
  a.byId('rc-text').value = a.RCPT.text;
  a.FORMS['rcpt-parse']();
  const P = a.rcptPlan();
  deq(P.lines.map(l => l.status), ['found', 'found', 'found'], 'пример разбирается: ' + P.lines.map(l => l.error).join('; '));
  deq(P.lines.map(l => l.productId), short.map(p => p.id));
  assert.equal(P.ready, true);
  assert.equal(modal.innerHTML.includes('id="rc-go">'), true);
});

// ——— вкладки ———
test('вкладки «Вставить список» и «Ввести вручную»: переключение не теряет вставленный текст; на вкладке «вручную» — таблица, «Добавить строку», «Проверить»', () => {
  const { a, modal } = page();
  a.A['rcpt-open']();
  assert.match(a.byId('modal-root').innerHTML, /aria-selected="true" data-act="rcpt-tab" data-tab="paste"/);
  assert.match(a.byId('modal-root').innerHTML, /aria-selected="false" data-act="rcpt-tab" data-tab="manual"/);
  assert.match(a.byId('modal-root').innerHTML, /data-form="rcpt-parse"/);
  a.byId('rc-text').value = 'Мой текст\t3';
  a.A['rcpt-tab']({ dataset: { tab: 'manual' } });
  const m = modal.innerHTML;
  assert.match(m, /data-form="rcpt-manual"/);
  assert.match(m, /id="rcm-body"/);
  assert.match(m, /data-act="rcm-add"[^>]*>.*Добавить строку/s);
  assert.match(m, />Проверить</);
  assert.match(m, /Название или артикул/);
  assert.match(m, /<option value="">как выше<\/option>/, 'юрлицо и склад строки — «как выше» по умолчанию');
  assert.doesNotMatch(m, /id="rc-text"/);
  a.A['rcpt-tab']({ dataset: { tab: 'paste' } });
  assert.match(modal.innerHTML, /Мой текст/, 'текст со вкладки «вставить» сохранился');
  a.A['rcpt-tab']({ dataset: { tab: 'нет-такой' } });
  assert.equal(a.RCPT.tab, 'paste', 'чужое значение вкладки не принимается');
});

// ——— ручной ввод ———
test('ручной ввод: поиск товара по названию и по артикулу, выбор, количество, юрлицо и склад по умолчанию из «Всё это приходит на»; «Проверить» → тот же шаг проверки', () => {
  const { a, modal } = page();
  a.A['rcpt-open']();
  a.A['rcpt-tab']({ dataset: { tab: 'manual' } });
  // строка 1: ищем по артикулу «пан 550» (без дефиса и в другом регистре)
  a.ON.input['rcm-q']({ dataset: { i: '0' }, value: 'пан 550' });
  assert.match(a.byId('rcm-res-0').innerHTML, new RegExp(`data-pid="${PANEL.id}"`), 'найден по артикулу');
  assert.match(a.byId('rcm-res-0').innerHTML, /арт\. ПАН-550/, 'артикул виден в результате');
  a.ON.input['rcm-q']({ dataset: { i: '0' }, value: 'ё' });
  assert.equal(a.byId('rcm-res-0').innerHTML, '', 'меньше двух знаков — результатов нет');
  a.ON.input['rcm-q']({ dataset: { i: '0' }, value: 'инвертор бета' });
  assert.match(a.byId('rcm-res-0').innerHTML, new RegExp(`data-pid="${INV.id}"`), 'и по названию');
  a.A['rcm-pick']({ dataset: { i: '0', pid: INV.id } });
  assert.match(a.byId('rcm-body').innerHTML, /<b>Тестовый инвертор Бета 5 кВт<\/b> <small class="sku">арт\. ИНВ-5000<\/small>/, 'выбранный товар — с артикулом');
  a.ON.input['rcm-f']({ dataset: { i: '0', f: 'qty' }, value: '4' });
  // строка 2: товар без артикула; строка 3 — пустая и пропадёт
  a.A['rcm-add']();
  a.A['rcm-add']();
  assert.equal(a.RCPT.manual.length, 3);
  a.ON.input['rcm-q']({ dataset: { i: '1' }, value: 'кабель гамма' });
  a.A['rcm-pick']({ dataset: { i: '1', pid: CABLE.id } });
  assert.match(a.byId('rcm-body').innerHTML, /нет данных: артикул/, 'у товара без артикула — «нет данных: артикул»');
  a.ON.change['rcm-f']({ dataset: { i: '1', f: 'qty' }, value: '20' });
  a.ON.change['rcm-f']({ dataset: { i: '1', f: 'city' }, value: cityId(a, 1) });
  a.ON.change['rcm-f']({ dataset: { i: '1', f: 'entity' }, value: entId(a, 1) });
  a.ON.change['rcpt-def']({ dataset: { f: 'entityId' }, value: entId(a, 0) });
  a.ON.change['rcpt-def']({ dataset: { f: 'cityId' }, value: cityId(a, 0) });
  a.FORMS['rcpt-manual']();
  assert.equal(a.RCPT.stage, 'check', 'ушли на шаг проверки');
  assert.match(modal.innerHTML, /проверьте список/);
  const P = a.rcptPlan();
  deq(P.lines.map(l => [l.line, l.status, l.productId, l.qty]), [[1, 'found', INV.id, 4], [2, 'found', CABLE.id, 20]], 'пустая третья строка пропала, номера — как в таблице');
  deq(P.lines.map(l => [l.entityId, l.cityId]), [[entId(a, 0), cityId(a, 0)], [entId(a, 1), cityId(a, 1)]], 'без своего склада — «всё это приходит на», со своим — свой');
  assert.equal(P.ready, true);
  // назад: таблица на месте, вкладка та же
  a.A['rcpt-back']();
  assert.equal(a.RCPT.tab, 'manual');
  assert.equal(a.RCPT.manual[0].pid, INV.id);
  assert.match(modal.innerHTML, /id="rcm-body"/);
});

test('ручной ввод: «новый товар» с названием и артикулом, «убрать строку», пустая таблица и строка без количества — понятная причина, а не тихий пропуск', () => {
  const { a, modal } = page();
  a.A['rcpt-open']();
  a.A['rcpt-tab']({ dataset: { tab: 'manual' } });
  a.FORMS['rcpt-manual']();
  assert.match(a.byId('rc-err').textContent, /Добавьте хотя бы одну строку/);
  assert.equal(a.RCPT.stage, 'input');
  // новый товар: набрали, нажали «Новый товар «…»»
  a.ON.input['rcm-q']({ dataset: { i: '0' }, value: 'Тест Совсем Новинка' });
  assert.match(a.byId('rcm-res-0').innerHTML, /data-act="rcm-new"[^>]*>.*Новый товар «Тест Совсем Новинка»/s);
  a.A['rcm-new']({ dataset: { i: '0' } });
  assert.match(a.byId('rcm-body').innerHTML, /placeholder="Название нового товара" value="Тест Совсем Новинка"/);
  assert.match(a.byId('rcm-body').innerHTML, /placeholder="Артикул \(необязательно\)"/);
  a.ON.input['rcm-f']({ dataset: { i: '0', f: 'sku' }, value: 'НОВ-1' });
  // вторая строка — без количества
  a.A['rcm-add']();
  a.ON.input['rcm-q']({ dataset: { i: '1' }, value: 'панель альфа' });
  a.A['rcm-pick']({ dataset: { i: '1', pid: PANEL.id } });
  a.ON.input['rcm-f']({ dataset: { i: '0', f: 'qty' }, value: '7' });
  a.ON.change['rcpt-def']({ dataset: { f: 'entityId' }, value: entId(a) });
  a.ON.change['rcpt-def']({ dataset: { f: 'cityId' }, value: cityId(a) });
  a.FORMS['rcpt-manual']();
  let P = a.rcptPlan();
  deq(P.lines.map(l => l.status), ['new', 'error']);
  assert.match(P.lines[1].error, /не указано количество/);
  assert.match(modal.innerHTML, /id="rc-go" disabled/, 'пока строка с ошибкой — «Оприходовать» недоступна');
  // убрали ошибочную строку на вкладке «вручную»
  a.A['rcpt-back']();
  a.A['rcm-del']({ dataset: { i: '1' } });
  assert.equal(a.RCPT.manual.length, 1);
  a.A['rcm-del']({ dataset: { i: '0' } });
  assert.equal(a.RCPT.manual.length, 1, 'последняя строка не исчезает — остаётся пустая');
  assert.equal(a.RCPT.manual[0].pid, '');
});

test('ручной ввод и вставка дают одно и то же: те же остатки, журнал, новые товары (с категорией и артикулом) и одно сохранение; applyReceipt — одна на оба пути', () => {
  const rows = [['Тестовый инвертор Бета 5 кВт', '4'], ['Тест Рождённый вручную', '9']];
  // путь 1: вставка из Excel
  const A = page('p1').a;
  A.A['rcpt-open']();
  A.byId('rc-text').value = rows.map(r => r.join('\t')).join('\n');
  A.FORMS['rcpt-parse']();
  A.ON.change['rcpt-def']({ dataset: { f: 'entityId' }, value: entId(A) });
  A.ON.change['rcpt-def']({ dataset: { f: 'cityId' }, value: cityId(A) });
  A.ON.change['rcpt-f']({ dataset: { i: '1', f: 'sku' }, value: 'РВ-1' });
  A.ON.change['rcpt-pick']({ dataset: { i: '1' }, value: 'new' });
  // путь 2: вручную
  const { a: B, modal } = page('p1');
  B.A['rcpt-open']();
  B.A['rcpt-tab']({ dataset: { tab: 'manual' } });
  B.A['rcm-pick']({ dataset: { i: '0', pid: INV.id } });
  B.ON.input['rcm-f']({ dataset: { i: '0', f: 'qty' }, value: '4' });
  B.A['rcm-add']();
  B.A['rcm-new']({ dataset: { i: '1' } });
  B.ON.input['rcm-f']({ dataset: { i: '1', f: 'newName' }, value: 'Тест Рождённый вручную' });
  B.ON.input['rcm-f']({ dataset: { i: '1', f: 'sku' }, value: 'РВ-1' });
  B.ON.input['rcm-f']({ dataset: { i: '1', f: 'qty' }, value: '9' });
  B.ON.change['rcpt-def']({ dataset: { f: 'entityId' }, value: entId(B) });
  B.ON.change['rcpt-def']({ dataset: { f: 'cityId' }, value: cityId(B) });
  B.FORMS['rcpt-manual']();
  for (const x of [A, B]) {
    const saves = [];
    Object.defineProperty(x.storage, x.Store.KEY, { set: v => saves.push(v), get: () => saves[saves.length - 1], configurable: true, enumerable: true });
    x.FORMS['rcpt-go']();
    assert.equal(x.RCPT.stage, 'done', x.byId('rc-err').textContent);
    assert.equal(saves.length, 1, 'одно действие — одно сохранение');
  }
  const state = x => {
    const made = x.S.products.find(p => p.name === 'Тест Рождённый вручную');
    return { inv: cellOf(x, INV.id), made: made && { sku: made.sku, cat: made.cat, stock: cellOf(x, made.id) }, moves: x.S.moves.slice(0, 2).map(m => [m.kind, m.qty, m.entityId, m.cityId, m.doc]).sort() };
  };
  deq(state(B), state(A), 'остатки, новый товар и журнал — одинаковы');
  assert.equal(state(B).inv, 4); assert.equal(state(B).made.sku, 'РВ-1'); assert.equal(state(B).made.stock, 9);
  assert.equal(state(B).made.cat, B.Catalog.NO_CAT);
  assert.match(modal.innerHTML, /Оприходовано 2 позиции, создано 1 новый товар/);
});

test('ручной ввод и права: без права catalog нет «Нового товара», но товар из номенклатуры оприходовать можно; без права receive окно не открывается', () => {
  const { a } = page('p5');   // кладовщик
  a.S.roles.find(r => r.id === 'warehouse').perms.catalog = false;
  a.A['rcpt-open']();
  a.A['rcpt-tab']({ dataset: { tab: 'manual' } });
  a.ON.input['rcm-q']({ dataset: { i: '0' }, value: 'панель альфа' });
  assert.doesNotMatch(a.byId('rcm-res-0').innerHTML, /rcm-new/, 'новый товар — только с правом catalog');
  assert.match(a.byId('rcm-res-0').innerHTML, new RegExp(`data-pid="${PANEL.id}"`));
  a.ON.input['rcm-q']({ dataset: { i: '0' }, value: 'нет такого совсем' });
  assert.match(a.byId('rcm-res-0').innerHTML, /В номенклатуре такого нет/);
  a.A['rcm-new']({ dataset: { i: '0' } });
  assert.equal(a.RCPT.manual[0].isNew, false, 'действие «новый товар» без права не срабатывает');
  const q = page('p6');   // логист: receive нет
  q.a.A['rcpt-open']();
  assert.doesNotMatch(q.a.byId('modal-root').innerHTML, /Ввести вручную/);
});

test('Import.manualRows: выбранный товар — «название+артикул, это он»; новый — pick new; набранный текст без выбора — строка как из Excel; пустое пропускается', () => {
  const { a } = page();
  const r = a.Import.manualRows(a.S, [
    { pid: PANEL.id, q: 'неважно', qty: '2', entity: 'ip', city: 'irk' },
    { isNew: true, newName: ' Тест Новый ', sku: ' Н-1 ', qty: '3' },
    { q: 'Текст из поиска', qty: '1' },
    { pid: '', q: '', qty: '', entity: '', city: '' },
    { pid: 'нет-такого', q: '', qty: '5' },
  ]);
  deq(r.problems, []);
  deq(r.rows.map(x => [x.line, x.name, x.sku, x.pick, x.qty]), [
    [1, PANEL.name, 'ПАН-550', PANEL.id, '2'], [2, 'Тест Новый', 'Н-1', 'new', '3'], [3, 'Текст из поиска', '', '', '1'], [5, '', '', '', '5']]);
  deq(a.Import.manualRows(a.S, []).problems, ['Добавьте хотя бы одну строку: выберите товар и впишите количество.']);
  deq(a.Import.manualRows(a.S, null).rows, []);
});
