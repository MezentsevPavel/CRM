'use strict';
// Директор 2026-11-13: «указал «в наличии», а позиции без остатков показываются» — фильтр «Наличие» смотрел на статус сайта
// («в наличии» / «предзаказ»), а не на склад. Теперь есть «Остаток на складе»; статус сайта называется «Статус на сайте».

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.js');

function world() {
  const a = load();
  const { S } = a;
  a.setMe(S.people.find(p => p.role === 'director').id);
  const [pa, pb, pc] = S.products.filter(p => p.inCatalog).slice(0, 3);
  S.stock = { [pa.id]: { ip: { irk: 5 } }, [pb.id]: { ip: { irk: 0 } } };   // у третьего остатка в таблице нет вовсе
  S.reserves = [];
  S.ui.cat = 'Все'; S.ui.sq = ''; S.ui.brand = ''; S.ui.avail = ''; S.ui.stk = ''; S.ui.catf = ''; S.ui.deficit = false;
  return { a, S, pa, pb, pc };
}
const ids = (a, ...pp) => Array.from(a.stockRows()).filter(p => pp.some(x => x.id === p.id)).map(p => p.id).sort();

test('фильтр «Остаток на складе»: есть / нет (0) / нет данных; по каждому свой набор позиций', () => {
  const { a, S, pa, pb, pc } = world();
  S.ui.stk = 'has';
  assert.deepEqual(ids(a, pa, pb, pc), [pa.id], 'есть на складе — только позиция с остатком 5');
  S.ui.stk = 'none';
  assert.deepEqual(ids(a, pa, pb, pc), [pb.id], 'нет на складе — только та, где в таблице стоит 0');
  S.ui.stk = 'unk';
  assert.deepEqual(ids(a, pa, pb, pc), [pc.id], 'нет данных об остатке — позиция без числа');
  S.ui.stk = '';
  assert.deepEqual(ids(a, pa, pb, pc), [pa.id, pb.id, pc.id].sort(), 'без фильтра — все');
});

test('«Статус на сайте» остаётся отдельным фильтром и не подменяет склад; подписи на экране; «Сбросить» очищает оба', () => {
  const { a, S, pa } = world();
  pa.avail = 'в наличии';
  S.ui.avail = 'в наличии';
  S.ui.stk = 'has';
  assert.ok(a.stockRows().every(p => p.avail === 'в наличии'), 'статус сайта не действует');
  assert.ok(a.stockRows().every(p => a.Stock.summary(S, p.id).onHand > 0), 'в списке есть позиции без остатка');
  const html = a.vStock();
  assert.match(html, /Остаток на складе/);
  assert.match(html, /Статус на сайте/);
  assert.match(html, /Любой статус на сайте/);
  assert.doesNotMatch(html, /Любое наличие/, 'прежняя подпись «наличие» осталась');
  a.A['stock-reset']();
  assert.deepEqual([S.ui.avail, S.ui.stk], ['', '']);
});
