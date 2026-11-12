'use strict';
// Просьбы директора 2026-11-12: «отдельно пункт Резервы, где можно просто выбрать из списка всё, что нужно поставить в резерв»
// и «задержку перед открытием фото при наведении хотя бы 1 секунду».
// Числа разобраны руками: товар А лежит 3 шт. на одном юрлице и 4 на другом — 6 шт. ставятся двумя резервами (4 + 2);
// товар Б — 2 шт., просят 5 — отказ, и тогда не ставится ничего, даже А.

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.js');

const js = x => JSON.parse(JSON.stringify(x));

function setup() {
  const a = load();
  const { S } = a;
  a.setMe(S.people.find(p => p.role === 'director').id);
  assert.ok(S.entities.length >= 2, 'в демо меньше двух юрлиц — тест не может разложить резерв по клеткам');
  const [e1, e2] = S.entities.map(e => e.id);
  const [pa, pb] = S.products.slice(0, 2).map(p => p.id);
  S.stock = {}; S.reserves = [];
  S.stock[pa] = { [e1]: { _: 3 }, [e2]: { _: 4 } };
  S.stock[pb] = { [e1]: { _: 2 } };
  return { a, S, e1, e2, pa, pb };
}
const until = () => new Date(Date.now() + 5 * 864e5);

test('резерв списком без сделки: 6 шт. из клеток 4 и 3 — два резерва (4 + 2), «для кого» у каждого', () => {
  const { a, S, e1, e2, pa } = setup();
  assert.equal(a.rsvFree(S, pa), 7);
  assert.deepEqual(js(a.rsvSplit(S, pa, 6)), [{ entityId: e2, cityId: '_', qty: 4 }, { entityId: e1, cityId: '_', qty: 2 }]);
  assert.equal(a.rsvSplit(S, pa, 8), null, '8 из 7 свободных разложилось');
  const res = a.rsvPlace(S, [{ productId: pa, qty: 6 }], { forWho: 'под Иванова', until: until() }, S.me, new Date());
  assert.equal(res.ok, true, res.reason);
  assert.deepEqual(js(S.reserves.map(r => [r.productId, r.entityId, r.qty, r.forWho])), [[pa, e2, 4, 'под Иванова'], [pa, e1, 2, 'под Иванова']]);
  assert.equal(a.Stock.summary(S, pa).free, 1, 'свободно должно остаться 7 − 6 = 1');
});

test('резерв списком: одна строка не проходит — не ставится ничего, причина у этой строки', () => {
  const { a, S, pa, pb } = setup();
  const res = a.rsvPlace(S, [{ productId: pa, qty: 2 }, { productId: pb, qty: 5 }], { forWho: 'под Петрова', until: until() }, S.me, new Date());
  assert.equal(res.ok, false);
  assert.equal(S.reserves.length, 0, 'товар А зарезервирован, хотя Б не прошёл');
  assert.match(res.errs[pb], /только 2/);
  assert.equal(res.errs[pa], undefined);
  // без «для кого», без выбора и со сроком в прошлом — отказ до всяких записей
  assert.match(a.rsvPlace(S, [{ productId: pa, qty: 1 }], { forWho: ' ', until: until() }, S.me, new Date()).reason, /для кого/);
  assert.match(a.rsvPlace(S, [], { forWho: 'х', until: until() }, S.me, new Date()).reason, /Ничего не выбрано/);
  assert.match(a.rsvPlace(S, [{ productId: pa, qty: 1 }], { forWho: 'х', until: new Date(Date.now() - 3 * 864e5) }, S.me, new Date()).reason, /прошлом/);
  assert.equal(S.reserves.length, 0);
});

test('резерв списком под сделку: не больше, чем осталось по строкам сделки; резерв привязан к сделке', () => {
  const { a, S, e1 } = setup();
  const d = S.deals.find(x => a.Deals.state(S, x) === 'open' && (x.items || []).some(i => i.productId));
  assert.ok(d, 'в демо нет открытой сделки с товаром');
  const pid = d.items.find(i => i.productId).productId;
  S.stock[pid] = { [e1]: { _: 1000 } };
  const rest = a.Deals.left(S, d, pid);
  assert.ok(rest > 0);
  assert.ok(a.rsvDeals().some(x => x.id === d.id), 'сделки нет в списке выбора');
  const over = a.rsvPlace(S, [{ productId: pid, qty: rest + 1 }], { dealId: d.id, until: until() }, S.me, new Date());
  assert.equal(over.ok, false);
  assert.match(over.errs[pid], new RegExp(`можно ещё ${rest}`));
  const ok = a.rsvPlace(S, [{ productId: pid, qty: rest }], { dealId: d.id, until: until() }, S.me, new Date());
  assert.equal(ok.ok, true, ok.reason);
  assert.ok(S.reserves.every(r => r.dealId === d.id));
  assert.equal(a.Deals.left(S, d, pid), 0);
});

test('раздел «Резервы» в меню группы «Товар»; экран: выбор товаров со свободным остатком и список резервов; без права — только список', () => {
  const { a, S, pa, pb } = setup();
  const n = a.NAV.find(x => x.id === 'reserves');
  assert.ok(n && n.group === 'Товар' && a.VIEWS.reserves, 'раздела «Резервы» нет');
  a.rsvU().pick[pa] = 2;
  const html = a.vReserves();
  assert.match(html, /data-form="rsv"/);
  assert.match(html, /Выбрано: 1 товар, всего 2 шт\./);
  assert.match(html, new RegExp(`data-pid="${pb}"`), 'товара со свободным остатком нет в списке');
  // через форму: выбор → кнопка → резерв поставлен, выбор очищен
  a.byId('rsv-until').value = '';
  a.byId('rsv-for').value = 'под Сидорова';
  a.FORMS.rsv();
  assert.equal(S.reserves.length, 1);
  assert.equal(S.reserves[0].forWho, 'под Сидорова');
  assert.deepEqual(js(a.rsvU().pick), {});
  assert.match(a.vReserves(), /под Сидорова/);
  // кладовщик без права reserve: кнопок постановки нет, список есть
  const keeper = S.people.find(p => a.Perms.can(S, p.id, 'stock') && !a.Perms.can(S, p.id, 'reserve'));
  if (keeper) {
    a.setMe(keeper.id);
    const h = a.vReserves();
    assert.doesNotMatch(h, /data-form="rsv"/);
    assert.match(h, /Сейчас в резерве/);
  }
});

test('остатки не загружены — «нет данных: остатки», а не «свободного нет»; блоки в карточках с отступами (card-h / card-b)', () => {
  const { a, S } = setup();
  S.stock = {};
  const html = a.vReserves();
  assert.match(html, /Нет данных: остатки на складах/);
  assert.doesNotMatch(html, /Свободного товара на складах нет/);
  assert.equal((html.match(/class="card-h"/g) || []).length, 2, 'заголовки карточек без своей разметки — текст прилипнет к краю');
  assert.match(html, /<form class="card-b" data-form="rsv"/);
});

test('фото при наведении: открывается через 1 с, а не сразу; увёл мышь раньше — не открывается', () => {
  const timers = [], cleared = [];
  const a = load({ globals: {
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; },
    clearTimeout: id => cleared.push(id),
    matchMedia: q => ({ matches: /hover/.test(q), addEventListener() {}, removeEventListener() {} }),
    window: { innerWidth: 1600, innerHeight: 900, addEventListener() {}, removeEventListener() {} },
  } });
  assert.equal(a.PPREV_DELAY, 1000);
  const made = [];
  a.document.body = { appendChild: el => made.push(el) };
  a.document.createElement = () => ({ style: {}, setAttribute() {}, appendChild() {}, remove() {} });
  const thumb = { isConnected: true, src: 'x.jpg', getBoundingClientRect: () => ({ left: 100, right: 160, top: 100, height: 60, width: 60 }) };
  thumb.closest = s => (s === 'img.pthumb' ? thumb : null);
  const before = timers.length;
  a.document.dispatchEvent({ type: 'mouseover', target: thumb });
  assert.equal(made.length, 0, 'фото открылось сразу, без задержки');
  const t = timers.slice(before).find(x => x.ms === 1000);
  assert.ok(t, 'задержки 1 с нет');
  t.f();
  assert.equal(made.length, 1, 'через 1 с фото не открылось');
  // увёл мышь до конца задержки — таймер снят, фото не появится
  a.document.dispatchEvent({ type: 'mouseout', target: thumb });
  const n = timers.length;
  a.document.dispatchEvent({ type: 'mouseover', target: thumb });
  const id = timers.length;
  assert.equal(id, n + 1);
  a.document.dispatchEvent({ type: 'mouseout', target: thumb });
  assert.ok(cleared.includes(id), 'увёл мышь — а задержка не снята');
});
