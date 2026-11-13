'use strict';
// Директор 2026-11-13: «не могу удалить юрлицо» — в «Настройки → Склады и юрлица» кнопки удаления не было. Теперь: удалить можно,
// пока на юрлице (городе) ничего нет; занято — отказ с причиной и числами. Числа разобраны руками в самих тестах.

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.js');
const { start, director, changes, state } = require('./server-kit.js');

const plain = v => JSON.parse(JSON.stringify(v));
function world() {
  const a = load();
  const { S } = a;
  a.setMe(S.people.find(p => p.role === 'director').id);
  S.entities.push({ id: 'zz', name: 'Лишнее юрлицо' });
  S.cities.push({ id: 'zc', name: 'Лишний город', address: '' });
  S.stock = {}; S.reserves = []; S.shipments = []; S.dispatches = []; S.billing = { seller: {} };
  return { a, S };
}

test('Stock.usage: остаток, резервы, поставки, заявки, продавец по умолчанию — каждое названо числом; нули и пусто не мешают', () => {
  const { a, S } = world();
  const { Stock } = a;
  assert.deepEqual(plain(Stock.usage(S, 'entity', 'zz')), [], 'пустое юрлицо свободно');
  S.stock = { p1: { zz: { irk: 3, zc: 4 } }, p2: { zz: { irk: 0 } }, p3: { zz: { irk: null } } };
  assert.deepEqual(plain(Stock.usage(S, 'entity', 'zz')), ['остаток 7 шт. по товарам: 1'], 'нули и пусто не считаются');
  assert.deepEqual(plain(Stock.usage(S, 'city', 'zc')), ['остаток 4 шт. по товарам: 1']);
  S.reserves = [{ id: 'r1', productId: 'p1', qty: 1, entityId: 'zz', cityId: 'irk' }, { id: 'r2', productId: 'p1', qty: 1, entityId: 'ip', cityId: 'zc' }];
  S.shipments = [{ id: 'П-1', entityId: 'zz', cityId: 'irk' }];
  S.dispatches = [{ id: 'd1', from: { entityId: 'ip', cityId: 'zc' }, toCell: { entityId: 'zz', cityId: 'irk' }, items: [] }];
  S.billing = { seller: { b2b: 'zz' } };
  assert.deepEqual(plain(Stock.usage(S, 'entity', 'zz')), ['остаток 7 шт. по товарам: 1', 'резервов: 1', 'поставок: 1', 'заявок на отправку: 1', 'назначено продавцом по умолчанию (Настройки → Склады и юрлица)']);
  assert.deepEqual(plain(Stock.usage(S, 'city', 'zc')), ['остаток 4 шт. по товарам: 1', 'резервов: 1', 'заявок на отправку: 1']);
});

test('Stock.removePlace: свободное убирается из справочника; занятое — отказ с причиной, справочник цел; неизвестное — отказ', () => {
  const { a, S } = world();
  const { Stock } = a;
  S.stock = { p1: { zz: { irk: 2 } } };
  const n = S.entities.length;
  const busy = Stock.removePlace(S, 'entity', 'zz');
  assert.equal(busy.ok, false);
  assert.match(busy.reason, /Юрлицо «Лишнее юрлицо» убрать нельзя: на нём остаток 2 шт\. по товарам: 1\./);
  assert.equal(S.entities.length, n, 'занятое юрлицо убрано');
  S.stock = { p1: { zz: { irk: 0 } } };
  const ok = Stock.removePlace(S, 'entity', 'zz');
  assert.deepEqual([ok.ok, ok.name], [true, 'Лишнее юрлицо']);
  assert.equal(S.entities.length, n - 1);
  assert.equal(Stock.removePlace(S, 'entity', 'zz').ok, false, 'второй раз — уже нет');
  assert.equal(Stock.removePlace(S, 'city', 'zc').ok, true, 'свободный город убирается');
  assert.equal(S.cities.some(c => c.id === 'zc'), false);
});

test('сетка остатков: убранное юрлицо и город с нулевыми клетками не показываются; с остатком — показываются, данные не теряются', () => {
  const { a, S } = world();
  const { Stock } = a;
  S.stock = { p1: { ip: { irk: 5 }, gone: { irk: 0, goneC: 0 } } };
  let g = Stock.grid(S, 'p1');
  assert.deepEqual(plain(g.rows.map(r => r.id)).filter(x => x === 'gone'), [], 'убранное юрлицо с нулями видно');
  assert.deepEqual(plain(g.cols.map(c => c.id)).filter(x => x === 'goneC'), [], 'убранный город с нулями виден');
  S.stock.p1.gone.irk = 2;
  g = Stock.grid(S, 'p1');
  assert.ok(g.rows.some(r => r.id === 'gone'), 'юрлицо с остатком пропало из сетки');
});

test('экран «Склады и юрлица»: у каждого юрлица и города «Удалить»; занятое — тост с причиной и окна нет; свободное — окно, «Удалить» убирает', () => {
  const { a, S } = world();
  const html = a.vWarehouses();
  for (const e of S.entities) assert.match(html, new RegExp(`data-act="place-del" data-kind="entity" data-id="${e.id}"`));
  for (const c of S.cities) assert.match(html, new RegExp(`data-act="place-del" data-kind="city" data-id="${c.id}"`));
  const said = [];
  a.byId('toasts').appendChild = el => said.push(el.innerHTML || '');
  S.stock = { p1: { zz: { irk: 2 } } };
  a.A['place-del']({ dataset: { kind: 'entity', id: 'zz' } });
  assert.equal(S.ui.modal, null, 'для занятого открылось окно удаления');
  assert.match(said.join(' '), /убрать нельзя: на нём остаток 2 шт\./);
  S.stock = {};
  a.A['place-del']({ dataset: { kind: 'entity', id: 'zz' } });
  assert.equal(S.ui.modal.type, 'placeDel');
  assert.match(a.MODALS.placeDel(S.ui.modal.id), /Удалить юрлицо «Лишнее юрлицо»\?/);
  a.FORMS['place-del']({ dataset: { kind: 'entity', id: 'zz' } });
  assert.equal(S.entities.some(e => e.id === 'zz'), false);
  assert.match(said.join(' '), /удалено из справочника/);
  a.A['place-del']({ dataset: { kind: 'city', id: 'zc' } });
  a.FORMS['place-del']({ dataset: { kind: 'city', id: 'zc' } });
  assert.equal(S.cities.some(c => c.id === 'zc'), false);
});

test('сервер: директор убирает юрлицо из справочника — запись принята, после этого его нет в состоянии', async () => {
  const srv = await start();
  try {
    const boss = await director(srv);
    const before = await state(srv, boss.cookie);
    const doc = before.entities.find(e => e.id === 'vs');
    assert.ok(doc, 'в пустой базе нет юрлица «ВС»');
    const r = await changes(srv, boss.cookie, [{ key: 'entities', id: 'vs', base: doc, deleted: true }]);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await state(srv, boss.cookie)).entities.some(e => e.id === 'vs'), false);
  } finally { await srv.stop(); }
});
