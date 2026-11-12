'use strict';
// Просьба директора 2026-11-12: в таблицах — сортировка по нажатию на название столбца, выпадающий список сортировки и ширина
// столбцов, которую меняют перетаскиванием. Здесь: общие помощники (src/js/77-tables.js) и то, как они подключены к списку «Товары».
// Числа разобраны руками: остатки 5, 20, 3 и «нет данных» у четвёртого; сортировка по возрастанию 3, 5, 20, пустое всегда внизу.

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.js');

const js = x => JSON.parse(JSON.stringify(x));

test('сортировка: числа по возрастанию и убыванию, «нет данных» всегда внизу, при равенстве — по названию, строки по-русски', () => {
  const a = load();
  const get = (x, col) => x[col];
  const list = [{ n: 'Б', v: 5 }, { n: 'А', v: 20 }, { n: 'В', v: 3 }, { n: 'Г', v: null }, { n: 'Д', v: 5 }];
  const by = (dir, col = 'v', rows = list) => a.sortRows(rows, { col, dir }, get, x => x.n).map(x => x.n).join('');
  assert.equal(by('asc'), 'ВБДАГ', 'по возрастанию: 3, 5, 5 (Б раньше Д по названию), 20, пусто');
  assert.equal(by('desc'), 'АБДВГ', 'по убыванию: пусто всё равно внизу');
  const names = a.sortRows([{ n: 'ёж' }, { n: 'Яблоко' }, { n: 'арбуз' }, { n: 'Бук' }], { col: 'n', dir: 'asc' }, get, x => x.n).map(x => x.n);
  assert.deepEqual(js(names), ['арбуз', 'Бук', 'ёж', 'Яблоко'], 'русский алфавит без учёта регистра');
  assert.equal(a.sortRows(list, null, get, x => x.n), list, 'без сортировки список не меняется');
});

test('нажатие на название: тот же столбец — наоборот, другой — по возрастанию', () => {
  const a = load();
  assert.deepEqual(js(a.sortToggle(null, 'name')), { col: 'name', dir: 'asc' });
  assert.deepEqual(js(a.sortToggle({ col: 'name', dir: 'asc' }, 'name')), { col: 'name', dir: 'desc' });
  assert.deepEqual(js(a.sortToggle({ col: 'name', dir: 'desc' }, 'name')), { col: 'name', dir: 'asc' });
  assert.deepEqual(js(a.sortToggle({ col: 'name', dir: 'desc' }, 'free')), { col: 'free', dir: 'asc' });
});

test('заголовок: у сортируемого есть действие и aria-sort, стрелка только у выбранного, у всех — ручка ширины; несортируемый без действия', () => {
  const a = load();
  const on = a.thHtml('goods', { key: 'free', label: 'Свободно', num: 1, sort: true }, { col: 'free', dir: 'desc' });
  assert.match(on, /data-act="tbl-sort"/);
  assert.match(on, /aria-sort="descending"/);
  assert.match(on, /▼/);
  assert.match(on, /class="rz"/);
  const off = a.thHtml('goods', { key: 'name', label: 'Товар', sort: true }, { col: 'free', dir: 'desc' });
  assert.match(off, /aria-sort="none"/);
  assert.doesNotMatch(off, /[▲▼]/);
  const none = a.thHtml('goods', { key: 'pic', label: 'Картина' }, null);
  assert.doesNotMatch(none, /tbl-sort/);
  assert.match(none, /class="rz"/);
});

test('ширина столбцов: по умолчанию, сохранённая; слишком узкая и слишком широкая ограничиваются; запись переживает перезагрузку', () => {
  const a = load();
  const cols = [{ key: 'name', w: 380 }, { key: 'free', w: 130 }];
  assert.deepEqual(js(a.colwOf('goods', cols)).map(c => c.w), [380, 130]);
  a.colwSave('goods', { name: 500, free: 5 });
  assert.deepEqual(js(a.colwOf('goods', cols)).map(c => c.w), [500, 60], 'узкий столбец вырос до минимума');
  a.colwSave('goods', { name: 99999 });
  assert.equal(a.colwOf('goods', cols)[0].w, 900);
  a.colwSave('goods', { name: 410 });
  const again = load({ storage: js(a.storage) });
  assert.equal(again.colwOf('goods', cols)[0].w, 410, 'после перезагрузки ширина потерялась');
  const cg = a.colgroupHtml('goods', cols);
  assert.match(cg.html, /<col data-cw="name" style="width:410px">/);
  assert.equal(cg.style, 'width:540px');
});

test('«Товары»: сортировка по названию и по свободному числу, выпадающий список и нажатие на название меняют одно и то же; пустые внизу', () => {
  const a = load();
  const { S } = a;
  a.setMe(S.people.find(p => p.role === 'director').id);
  const ids = S.products.slice(0, 4).map(p => p.id);
  // остаток по единственному юрлицу: 5, 20, 3; у четвёртого данных нет
  const entity = S.entities ? S.entities[0].id : Object.keys(S.stock[ids[0]] || {})[0];
  assert.ok(entity, 'в демо нет юрлица для остатков');
  S.stock = {}; S.reserves = [];
  [5, 20, 3].forEach((n, i) => { S.stock[ids[i]] = { [entity]: { _: n } }; });
  S.ui.cat = 'Все'; S.ui.sq = ''; S.ui.brand = ''; S.ui.avail = ''; S.ui.catf = '';
  const order = col => { S.ui.sort = { col, dir: 'asc' }; return a.stockRows().map(p => p.id); };
  const byName = order('name');
  const sorted = [...S.products].map(p => p.name).sort((x, y) => x.localeCompare(y, 'ru', { numeric: true, sensitivity: 'base' }));
  assert.deepEqual(js(a.stockRows().map(p => p.name).slice(0, 5)), sorted.slice(0, 5), 'по названию: порядок не русский алфавит');
  assert.equal(byName.length, S.products.length);

  const free = order('free');
  const known = [ids[2], ids[0], ids[1]];
  assert.deepEqual(js(free.slice(0, 3)), known, 'свободно 3, 5, 20 по возрастанию');
  S.ui.sort = { col: 'free', dir: 'desc' };
  const desc = a.stockRows().map(p => p.id);
  assert.deepEqual(js(desc.slice(0, 3)), [ids[1], ids[0], ids[2]], 'по убыванию 20, 5, 3');
  assert.ok(desc.slice(3).every(id => !known.includes(id)), 'строки без данных не ушли вниз');

  // выпадающий список: «столбец:направление»; пустое значение возвращает порядок каталога
  a.ON.change.sort({ value: 'onHand:desc' });
  assert.deepEqual(js(S.ui.sort), { col: 'onHand', dir: 'desc' });
  assert.equal(S.ui.page, 0);
  a.ON.change.sort({ value: '' });
  assert.equal(S.ui.sort, null);
  // нажатие на название — тот же S.ui.sort
  a.A['tbl-sort']({ dataset: { tbl: 'goods', cw: 'free' } });
  assert.deepEqual(js(S.ui.sort), { col: 'free', dir: 'asc' });
  a.A['tbl-sort']({ dataset: { tbl: 'goods', cw: 'free' } });
  assert.deepEqual(js(S.ui.sort), { col: 'free', dir: 'desc' });
});

test('«Товары»: в таблице colgroup и заголовки с сортировкой; в выпадающем списке «Цена» только у кого есть право prices', () => {
  const a = load();
  const { S } = a;
  a.setMe(S.people.find(p => p.role === 'director').id);
  S.ui.sort = { col: 'name', dir: 'desc' };
  const html = a.stockTable();
  assert.match(html, /<table class="tbl rsz" style="width:\d+px"><colgroup>/);
  assert.match(html, /aria-sort="descending"[^>]*>Товар/);
  assert.equal((html.match(/data-act="tbl-sort"/g) || []).length, 7, 'сортируются семь столбцов (с ценой)');
  assert.equal((html.match(/class="rz"/g) || []).length, 8, 'ручка ширины — у всех восьми');
  const withPrice = a.STOCK_SORTS(true).map(x => x[0]), without = a.STOCK_SORTS(false).map(x => x[0]);
  assert.ok(withPrice.includes('price:asc') && !without.includes('price:asc'));
  assert.equal(a.sortKey({ col: 'name', dir: 'desc' }), 'name:desc');
  assert.equal(a.sortKey(null), '');
});
