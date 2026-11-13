'use strict';
// Директор 2026-11-13: «по умолчанию все товары приходят в Иркутск; должна быть возможность перемещения по складам/городам;
// у позиции нет города — напоминание или возможность указать». Числа разобраны руками в самих тестах.

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.js');

const plain = v => JSON.parse(JSON.stringify(v));
const fresh = S => ({ products: [], stock: {}, aside: {}, reserves: [], entities: S.entities, cities: S.cities, moves: [] });
const row = (name, ip, npp) => ({ name, cat: 'Тест', ip, npp, vs: null, custody: null, transit: null, damaged: null, reserve: null, junk: [] });

test('Stock.defaultCityId: город «Иркутск» из справочника; нет такого — «нет данных», а не выдумка', () => {
  const { Stock, S } = load();
  assert.equal(Stock.defaultCityId(S), 'irk');
  assert.equal(Stock.defaultCityId({ cities: [{ id: 'x', name: ' иРкутск ' }] }), 'x');
  assert.equal(Stock.defaultCityId({ cities: [{ id: 'msk', name: 'Москва' }] }), Stock.ANY);
  assert.equal(Stock.defaultCityId({}), Stock.ANY);
});

test('перенос остатков: всё ложится в Иркутск; перемещения, сделанные в CRM в другие города, при новой загрузке остаются (не больше, чем по таблице)', () => {
  const app = load(), { Import, Stock, S } = app;
  const rows = [row('Тест-А', 10, 4)];
  const st = fresh(S);
  Import.applyStock(st, rows, null, new Date());
  const pid = Object.keys(st.stock)[0];
  assert.deepEqual(plain(st.stock[pid]), { ip: { irk: 10 }, npp: { irk: 4 } }, 'остаток без города в Иркутске');
  // директор перенёс 6 из Иркутска (ИП) в Москву
  assert.equal(Stock.move(st, { kind: Stock.KINDS.transfer, productId: pid, qty: 6, entityId: 'ip', cityId: 'irk', toEntityId: 'ip', toCityId: 'msk', doc: 'тест', by: null, at: new Date() }).ok, true);
  assert.deepEqual(plain(st.stock[pid].ip), { irk: 4, msk: 6 });
  // таблица обновилась: у ИП стало 9 — Москва сохраняется (6), Иркутск — остальное (3); у НПП без изменений
  Import.applyStock(st, [row('Тест-А', 9, 4)], null, new Date());
  assert.deepEqual(plain(st.stock[pid].ip), { msk: 6, irk: 3 });
  assert.deepEqual(plain(st.stock[pid].npp), { irk: 4 });
  // таблица показала меньше, чем перенесено: Москва урезается до таблицы, Иркутск 0
  Import.applyStock(st, [row('Тест-А', 5, 4)], null, new Date());
  assert.deepEqual(plain(st.stock[pid].ip), { msk: 5, irk: 0 });
  // повтор того же файла журнал не трогает
  const before = st.moves.length;
  Import.applyStock(st, [row('Тест-А', 5, 4)], null, new Date());
  assert.equal(st.moves.length, before, 'тот же файл дописал журнал');
});

test('перенос остатков: остаток «без города» от прежних переносов уходит в Иркутск; в журнале — нуль на старой клетке и остаток на новой; нет Иркутска — «нет данных» как было', () => {
  const { Import, Stock, S } = load();
  const st = fresh(S);
  Import.applyStock(st, [row('Тест-Б', 7, null)], null, new Date());
  const pid = Object.keys(st.stock)[0];
  st.stock[pid] = { ip: { [Stock.ANY]: 7 } };   // как после переноса прежней версии
  const n = st.moves.length;
  Import.applyStock(st, [row('Тест-Б', 7, null)], null, new Date());
  assert.deepEqual(plain(st.stock[pid]), { ip: { irk: 7 } });
  const added = plain(st.moves.slice(0, st.moves.length - n));
  assert.deepEqual(added.map(m => [m.cityId, m.qty]).sort(), [['_', 0], ['irk', 7]]);
  const noIrk = { ...fresh(S), cities: [{ id: 'msk', name: 'Москва' }] };
  Import.applyStock(noIrk, [row('Тест-Б', 3, null)], null, new Date());
  assert.deepEqual(plain(noIrk.stock[Object.keys(noIrk.stock)[0]]), { ip: { _: 3 } }, 'Иркутска в справочнике нет — город не выдуман');
});

function pageWith(role) {
  const a = load();
  const { S } = a;
  a.setMe(S.people.find(p => p.role === role).id);
  const p = S.products.find(x => x.inCatalog);
  S.stock = { [p.id]: { ip: { [a.Stock.ANY]: 10 }, npp: { irk: 5 } } };
  S.reserves = [{ id: 'rz1', productId: p.id, qty: 3, entityId: 'ip', cityId: a.Stock.ANY, src: 'stock', forWho: 'тест', by: S.me, at: new Date(), until: new Date(Date.now() + 864e5) }];
  return { a, S, p };
}

test('карточка товара: «Где лежит» — клетки с остатком; у клетки без города метка и «Указать город», у остальных «Переместить»; без права кнопок нет', () => {
  const { a, p } = pageWith('director');
  const html = a.dProduct(p).body;
  assert.match(html, /<h4 class="sh">Где лежит<\/h4>/);
  assert.match(html, /город не указан/);
  assert.match(html, new RegExp(`data-act="stock-move" data-pid="${p.id}" data-e="ip" data-c="_">Указать город`));
  assert.match(html, new RegExp(`data-act="stock-move" data-pid="${p.id}" data-e="npp" data-c="irk">Переместить`));
  assert.match(html, /без резерва 7/, 'из 10 под резервом 3 — перемещать можно 7');
  const keeper = a.S.people.find(x => a.Perms.can(a.S, x.id, 'stock') && !a.Perms.can(a.S, x.id, 'logistics') && !a.Perms.can(a.S, x.id, 'dispatch'));
  if (keeper) {
    a.setMe(keeper.id);
    assert.doesNotMatch(a.dProduct(p).body, /data-act="stock-move"/, 'кнопка есть без права');
  }
});

test('«Указать город» / «Переместить»: окно с остатком без резерва; перемещение — запись в журнале, остаток уходит, резерв остаётся; лишнее и «в ту же клетку» — отказ', () => {
  const { a, S, p } = pageWith('director');
  a.A['stock-move']({ dataset: { pid: p.id, e: 'ip', c: '_' } });
  assert.equal(S.ui.modal.type, 'stockMove');
  const win = a.MODALS.stockMove(S.ui.modal.id);
  assert.match(win, /Указать город:/);
  assert.match(win, /<option value="irk" selected>Иркутск<\/option>/, 'для клетки без города по умолчанию выбран Иркутск');
  assert.match(win, /max="7"/);
  const go = (qty, ent, city) => { a.byId('mv-qty').value = qty; a.byId('mv-ent').value = ent; a.byId('mv-city').value = city; a.byId('mv-doc').value = ''; a.FORMS['stock-move']({ dataset: { pid: p.id, e: 'ip', c: '_' } }); };
  go('8', 'ip', 'irk');
  assert.match(a.byId('mv-err').textContent, /только 7/, 'сверх свободного — отказ');
  go('3', 'ip', '_');
  assert.match(a.byId('mv-err').textContent, /одна и та же клетка/);
  assert.equal(S.stock[p.id].ip.irk, undefined, 'при отказе остаток сдвинулся');
  const n = S.moves.length;
  go('7', 'ip', 'irk');
  assert.deepEqual(plain(S.stock[p.id].ip), { _: 3, irk: 7 }, 'ушло 7, под резервом 3 осталось на месте');
  assert.equal(S.moves.length, n + 1);
  const m = S.moves[0];
  assert.deepEqual([m.kind, m.qty, m.entityId, m.cityId, m.toEntityId, m.toCityId], [a.Stock.KINDS.transfer, 7, 'ip', '_', 'ip', 'irk']);
  assert.equal(S.ui.modal, null, 'окно не закрылось');
  // теперь свободного в клетке без города нет — окно говорит об этом
  assert.match(a.MODALS.stockMove({ pid: p.id, e: 'ip', c: '_' }), /нет остатка без резерва/);
});

test('над списком «Товары»: напоминание «остаток без города» и «Всё в Иркутск» — свободная часть уходит в Иркутск, резервы остаются; пропадает, когда городов не осталось', () => {
  const { a, S, p } = pageWith('director');
  const bar = a.noCityBanner();
  assert.match(bar, /У 1 товара остаток без города \(всего 10 шт\.\)/);
  assert.match(bar, /data-act="nocity-all">Всё в Иркутск/);
  assert.match(a.vStock(), /class="nocity"/);
  a.A['nocity-all']();
  assert.equal(S.ui.modal.type, 'noCityAll');
  a.FORMS['nocity-all']();
  assert.deepEqual(plain(S.stock[p.id].ip), { _: 3, irk: 7 });
  assert.match(a.noCityBanner(), /всего 3 шт\./, 'под резервом осталось 3 — напоминание про них осталось');
  S.reserves = [];
  a.FORMS['nocity-all']();
  assert.equal(a.noCityBanner(), '', 'без города ничего нет — напоминания нет');
  assert.doesNotMatch(a.vStock(), /class="nocity"/);
});

test('оприходование: по умолчанию склад — Иркутск', () => {
  const { a } = pageWith('director');
  a.A['rcpt-open']();
  assert.equal(a.RCPT.cityId, 'irk');
  a.closeModal();
});
