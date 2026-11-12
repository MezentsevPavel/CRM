'use strict';
// Директор 2026-11-12: «Сделай всё же таблицей, чтобы всё влезло. Резерв и Списать сделай названия столбцов, но с галочкой у позиции».
// Числа разобраны руками: в строке 3 шт.; на складе 2 шт. у одного юрлица и 4 у другого — галочка ставит 3 шт.
// (из клетки, где больше: 3 из 4); если лежит только 1 — ставится 1, подпись «1 из 3», галочка не стоит.

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.js');

function setup() {
  const a = load();
  const { S } = a;
  a.setMe(S.people.find(p => p.role === 'director').id);
  const [e1, e2] = S.entities.map(e => e.id);
  const d = S.deals.find(x => a.Deals.state(S, x) === 'open' && (x.items || []).some(i => i.productId));
  assert.ok(d, 'в демо нет открытой сделки с товаром');
  const it = d.items.find(i => i.productId), pid = it.productId;
  d.items = d.items.filter(i => i === it || i.productId !== pid);
  it.qty = 3;
  S.stock = {}; S.reserves = [];
  S.stock[pid] = { [e1]: { _: 2 }, [e2]: { _: 4 } };
  a.S.ui.dealTab = 'items';
  const html = () => a.dealItems(d, true);
  const box = () => new RegExp(`<input type="checkbox" data-on="deal-rsv" data-id="${d.id}" data-pid="${pid}"( checked)?`).exec(html());
  return { a, S, d, it, pid, e1, e2, html, box };
}

test('товары сделки — таблица: столбцы «Резерв» и «Списать», строка товара — строка таблицы с галочками', () => {
  const { d, html } = setup();
  const h = html();
  assert.match(h, /<table class="tbl dl-tbl">/);
  assert.match(h, /<th class="dl-c">Резерв<\/th>/);
  assert.match(h, /<th class="dl-c">Списать<\/th>/);
  assert.equal((h.match(/<tr class="dline">/g) || []).length, d.items.length);
  assert.doesNotMatch(h, /class="dl-in"|>Зарезервировать<|>Списать при продаже</, 'остались прежние карточки и кнопки');
});

test('галочка «Резерв»: ставит всё по строке (3 из клетки, где 4), снятие галочки снимает резерв', () => {
  const { a, S, d, pid, e2, box } = setup();
  assert.equal(box()[1], undefined, 'галочка стоит без резерва');
  a.ON.change['deal-rsv']({ dataset: { id: d.id, pid }, checked: true });
  assert.deepEqual(S.reserves.map(r => [r.dealId, r.entityId, r.qty]), [[d.id, e2, 3]]);
  assert.equal(box()[1], ' checked', 'после резерва галочка не стоит');
  a.ON.change['deal-rsv']({ dataset: { id: d.id, pid }, checked: false });
  assert.equal(S.reserves.length, 0, 'галочку сняли — резерв остался');
  assert.equal(a.Stock.summary(S, pid).free, 6);
});

test('галочка «Резерв»: свободного не хватает на одну клетку — добирает из второй; не хватает вовсе — ставит сколько есть, «1 из 3»', () => {
  const { a, S, d, pid, e1, e2, html, box } = setup();
  S.stock[pid] = { [e1]: { _: 2 }, [e2]: { _: 2 } };
  a.ON.change['deal-rsv']({ dataset: { id: d.id, pid }, checked: true });
  assert.equal(S.reserves.reduce((s, r) => s + r.qty, 0), 3, 'не добрал из второй клетки');
  assert.equal(S.reserves.length, 2);
  a.ON.change['deal-rsv']({ dataset: { id: d.id, pid }, checked: false });
  S.stock[pid] = { [e1]: { _: 1 } };
  a.ON.change['deal-rsv']({ dataset: { id: d.id, pid }, checked: true });
  assert.equal(S.reserves.reduce((s, r) => s + r.qty, 0), 1);
  assert.equal(box()[1], undefined, 'резерв неполный, а галочка стоит');
  assert.match(html(), /<small class="dl-part">1 из 3<\/small>/);
});

test('галочка «Резерв» без остатков: понятная причина, ничего не ставится, галочка не встаёт', () => {
  const { a, S, d, pid } = setup();
  const said = [];
  a.byId('toasts').appendChild = el => said.push(el.innerHTML || '');
  S.stock = {};
  const t = { dataset: { id: d.id, pid }, checked: true };
  a.ON.change['deal-rsv'](t);
  assert.equal(S.reserves.length, 0);
  assert.equal(t.checked, false);
  assert.match(said.join(' '), /Нет данных: остатки на складах/);
  // остатки есть, но всё занято чужими резервами — «свободного нет», а не про «нет данных: юрлицо»
  const [e1] = S.entities.map(e => e.id);
  S.stock[pid] = { [e1]: { _: 1 } };
  S.reserves.push({ id: 'rX', productId: pid, qty: 1, entityId: e1, cityId: '_', src: 'stock', forWho: 'чужой' });
  a.ON.change['deal-rsv']({ dataset: { id: d.id, pid }, checked: true });
  assert.match(said.join(' '), /на складах нет — резерв не поставлен/);
  assert.equal(S.reserves.length, 1);
});

test('галочка «Списать»: открывает окно списания по сделке; когда всё списано — галочка стоит и не снимается', () => {
  const { a, S, d, pid, e2, html } = setup();
  const sell = () => new RegExp(`<input type="checkbox" data-on="deal-sell" data-id="${d.id}" data-pid="${pid}"( checked disabled)?`).exec(html());
  assert.equal(sell()[1], undefined);
  const t = { dataset: { id: d.id, pid }, checked: true };
  a.ON.change['deal-sell'](t);
  assert.equal(t.checked, false, 'галочка встала до списания');
  assert.equal(S.ui.modal.type, 'stockSell');
  assert.deepEqual([S.ui.modal.id.pid, S.ui.modal.id.did], [pid, d.id]);
  a.closeModal();
  assert.equal(a.Stock.sell(S, { productId: pid, qty: 2, entityId: e2, cityId: '_', doc: d.id }, S.me, new Date()).ok, true);
  assert.equal(sell()[1], undefined, 'списано 2 из 3, а галочка стоит');
  assert.match(html(), /<small class="dl-part">2 из 3<\/small>/);
  assert.equal(a.Stock.sell(S, { productId: pid, qty: 1, entityId: e2, cityId: '_', doc: d.id }, S.me, new Date()).ok, true);
  assert.equal(sell()[1], ' checked disabled');
});
