'use strict';
// Сделки и лента (таск 09, ядро): сумма по строкам, заведение, этапы и отказ, резерв строки, колонки канбана,
// единая лента карточек, демо-сделки. Экранов здесь нет.
// Ожидаемые значения — из таска 09 и spec.md (истории 92–100), посчитаны вручную; не из кода под тестом.

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.js');

const NOW = new Date(2026, 9, 31, 12, 0);
const T1 = new Date(2026, 9, 31, 13, 0);
const T2 = new Date(2026, 9, 31, 14, 0);
const T3 = new Date(2026, 9, 31, 15, 0);

// Маленькое состояние: директор, менеджеры B2B (b1) и B2C (c1), кладовщик; три товара и остаток панелей: 10 шт. (ИП, Иркутск).
//   pa «Панель А» — цена сайта 10 000; pb «Инвертор Б» — цены нет; pc «Кабель В» — цена 1 500.
function mini(app) {
  const st = Object.assign({
    roles: app.Perms.defaultRoles(),
    people: [
      { id: 'dir', name: 'Директор', role: 'director' },
      { id: 'b1', name: 'Менеджер B2B', role: 'managerB2b' },
      { id: 'c1', name: 'Менеджер B2C', role: 'managerB2c' },
      { id: 'wh', name: 'Кладовщик', role: 'warehouse' },
    ],
    prefs: { notify: {} }, notes: [], leads: [], deals: [], clients: [], feed: [], msgs: [], reserves: [], moves: [], shipments: [],
    pipelines: app.Pipes.defaults(),
    products: [
      { id: 'pa', name: 'Панель А', price: 10000, inCatalog: true },
      { id: 'pb', name: 'Инвертор Б', price: null, inCatalog: true },
      { id: 'pc', name: 'Кабель В', price: 1500, inCatalog: true },
    ],
    stock: { pa: { ip: { irk: 10 } }, pc: { ip: { irk: 100 } } }, aside: {},
  }, app.Stock.defaults());
  st.cB2b = app.Clients.create(st, { name: 'ООО „Пример-Агро“', inn: '0000000001', phone: '+7 900 000-00-01' }, 'dir', NOW).client;
  st.cB2c = app.Clients.create(st, { name: 'Клиент-пример', phone: '+7 900 000-00-02' }, 'dir', NOW).client;
  return st;
}
const make = (app, st, type, by, extra) =>
  app.Deals.create(st, Object.assign({ clientId: type === 'b2b' ? st.cB2b.id : st.cB2c.id, type }, extra), by, NOW).id;
const deal = (st, id) => st.deals.find(d => d.id === id);
const ids = list => [...list].map(x => x.id).sort();
// значения поля у записей — массивом этой страницы (массив из node:vm для deepEqual чужой)
const col = (list, f) => Array.from(list, f);

test('total: строки со скидкой — количество × цена × (1 − скидка/100); без строк — вписанная сумма; без цены строка не входит', () => {
  const { Deals } = load();
  // 2 × 10 000 со скидкой 10 % = 18 000; 3 × 1 500 без скидки = 4 500
  assert.equal(Deals.total({ items: [{ productId: 'pa', qty: 2, price: 10000, disc: 10 }, { productId: 'pc', qty: 3, price: 1500, disc: 0 }], amount: 999 }), 22500);
  // 3 × 1 000 со скидкой 7,5 % = 2 775
  assert.equal(Deals.total({ items: [{ text: 'Монтаж', qty: 3, price: 1000, disc: 7.5 }] }), 2775);
  // строк нет — вписанная сумма; нет и её — ноль
  assert.equal(Deals.total({ items: [], amount: 480000 }), 480000);
  assert.equal(Deals.total({ amount: 1180000 }), 1180000);
  assert.equal(Deals.total({ items: [] }), 0);
  // цены нет (null) — «нет данных», не ноль рублей: строка в сумму не входит, а noPrice её называет
  const d = { items: [{ productId: 'pb', qty: 1, price: null, disc: 0 }, { productId: 'pa', qty: 1, price: 10000, disc: 0 }], amount: 5 };
  assert.equal(Deals.total(d), 10000);
  assert.deepEqual([...Deals.noPrice(d)], [0]);
  assert.equal(Deals.lineSum({ qty: 2, price: 10000, disc: 10 }), 18000);
});

test('create: без клиента или типа — отказ и missing; с ними — воронка своего типа, первый этап, менеджер по умолчанию — я', () => {
  const app = load(), { Deals } = app;
  const st = mini(app);
  let r = Deals.create(st, { type: 'b2b' }, 'dir', NOW);
  assert.equal(r.ok, false);
  assert.deepEqual([...r.missing], ['client']);
  r = Deals.create(st, { clientId: st.cB2b.id }, 'dir', NOW);
  assert.equal(r.ok, false);
  assert.deepEqual([...r.missing], ['type']);
  r = Deals.create(st, { clientId: 'К-404', type: 'b2x' }, 'dir', NOW);
  assert.deepEqual([...r.missing], ['client', 'type'], 'несуществующий клиент и неизвестный тип приняты');
  assert.equal(st.deals.length, 0, 'при отказе сделка записана');
  assert.equal(Deals.create(st, { clientId: st.cB2b.id, type: 'b2b' }, 'wh', NOW).ok, false, 'кладовщик без права «клиенты» завёл сделку');

  const id = make(app, st, 'b2b', 'b1', { object: 'СЭС на склад', phone: '+7 900 000-00-01' });
  assert.equal(id, 'Д-301', 'номера сделок идут с 301');
  const d = deal(st, id);
  assert.deepEqual([d.type, d.pipeId, d.stageId, d.managerId, d.clientId, d.client, d.channel], ['b2b', 'dealsB2b', 'request', 'b1', st.cB2b.id, 'ООО „Пример-Агро“', 'phone']);
  assert.equal(d.object, 'СЭС на склад');
  assert.equal(Deals.total(d), 0);
  const d2 = deal(st, make(app, st, 'b2c', 'dir', { managerId: 'c1' }));
  assert.deepEqual([d2.pipeId, d2.managerId, d2.contact, d2.object], ['dealsB2c', 'c1', 'Клиент-пример', 'нет данных: что продаём']);
  const d3 = deal(st, make(app, st, 'b2b', 'dir'));
  assert.equal(d3.managerId, null, 'директор не менеджер — менеджера нет, пока не назначат');
  // запись в ленте
  const e = st.feed.find(x => x.ref.t === 'deal' && x.ref.id === id);
  assert.ok(e && e.kind === 'create' && e.by === 'b1' && e.at === NOW);
});

test('update: сумму руками вписать нельзя, если есть строки; отказ — ничего не меняется; правка полей пишется в ленту', () => {
  const app = load(), { Deals } = app;
  const st = mini(app);
  const id = make(app, st, 'b2b', 'b1');
  let r = Deals.update(st, id, { amount: 500000, contact: 'Николай' }, 'b1', T1);
  assert.equal(r.ok, true);
  assert.equal(Deals.total(deal(st, id)), 500000, 'без строк сумма — вписанная');
  assert.ok(Deals.addItem(st, id, { productId: 'pa', qty: 2 }, 'b1', T1).ok);
  assert.equal(Deals.total(deal(st, id)), 20000, 'есть строки — сумма по ним');
  r = Deals.update(st, id, { contact: 'Пётр', amount: 1 }, 'b1', T2);
  assert.equal(r.ok, false);
  assert.ok(r.reason.includes('строки'), r.reason);
  assert.equal(deal(st, id).contact, 'Николай', 'отказ, а контакт всё же поменялся');
  assert.equal(deal(st, id).amount, 500000);
  assert.equal(Deals.total(deal(st, id)), 20000);
  // поля правятся, в ленте — кто, что и было→стало
  r = Deals.update(st, id, { contact: 'Пётр', channel: 'max', managerId: null }, 'dir', T2);
  assert.equal(r.ok, true);
  assert.deepEqual([...r.changed].sort(), ['channel', 'contact', 'managerId']);
  const e = st.feed.filter(x => x.kind === 'field').pop();
  assert.ok(e.text.includes('Контакт: Николай → Пётр') && e.text.includes('Менеджер: Менеджер B2B → нет данных'), e.text);
  assert.equal(e.by, 'dir');
  assert.equal(e.at, T2);
  assert.equal(Deals.update(st, id, { channel: 'почтовый голубь' }, 'dir', T2).ok, false);
  assert.equal(Deals.update(st, id, { clientId: 'К-404' }, 'dir', T2).ok, false);
  // чужой тип и кладовщик сделку не правят
  assert.equal(Deals.update(st, id, { contact: 'X' }, 'c1', T2).ok, false, 'менеджер B2C правит сделку B2B');
  assert.equal(Deals.update(st, id, { contact: 'X' }, 'wh', T2).ok, false);
  // смена типа — воронка нового типа, этап тот же
  assert.equal(Deals.move(st, id, 'offer', 'dir', T2).ok, true);
  assert.equal(Deals.update(st, id, { type: 'b2c' }, 'dir', T3).ok, true);
  assert.deepEqual([deal(st, id).pipeId, deal(st, id).stageId], ['dealsB2c', 'offer']);
});

test('Feed.of: комментарий и смена этапа сделки — по времени, новые сверху; при равном времени позже добавленное выше', () => {
  const app = load(), { Deals, Feed } = app;
  const st = mini(app);
  const id = make(app, st, 'b2b', 'b1');                            // NOW: «Сделка создана»
  assert.equal(Feed.comment(st, { t: 'deal', id }, 'Позвонил, ждёт КП', 'b1', T1).ok, true);
  assert.equal(Deals.move(st, id, 'calc', 'b1', T2).ok, true);
  const feed = Feed.of(st, { t: 'deal', id });
  assert.deepEqual(col(feed, e => e.kind), ['stage', 'comment', 'create']);
  assert.equal(feed[0].text, 'Этап: «Заявка» → «Расчёт»');
  assert.equal(feed[1].text, 'Позвонил, ждёт КП');
  assert.equal(feed[1].by, 'b1');
  assert.equal(feed[1].at, T1);
  // записи другой сделки и чужие ссылки в ленту не попадают
  const other = make(app, st, 'b2b', 'b1');
  Feed.comment(st, { t: 'deal', id: other }, 'Другая сделка', 'b1', T3);
  assert.deepEqual(col(Feed.of(st, { t: 'deal', id }), e => e.kind), ['stage', 'comment', 'create']);
  // одно и то же время: выше то, что записано позже
  Feed.add(st, { t: 'client', id: 'К-9' }, { kind: 'comment', text: 'первый', by: 'dir', at: T3 });
  Feed.add(st, { t: 'client', id: 'К-9' }, { kind: 'comment', text: 'второй', by: 'dir', at: T3 });
  assert.deepEqual(col(Feed.of(st, { t: 'client', id: 'К-9' }).slice(0, 2), e => e.text), ['второй', 'первый']);
  // запись без ссылки, без текста или без времени не записывается
  const n = st.feed.length;
  assert.equal(Feed.add(st, null, { text: 'x', at: T1 }), null);
  assert.equal(Feed.add(st, { t: 'deal', id }, { text: '  ', at: T1 }), null);
  assert.equal(Feed.add(st, { t: 'deal', id }, { text: 'x' }), null);
  assert.equal(st.feed.length, n);
});

test('lose: без причины — отказ, сделка на месте; с причиной — «Провалена», из колонок уходит; успешную провалить нельзя; reopen возвращает', () => {
  const app = load(), { Deals, Pipes } = app;
  const st = mini(app);
  const id = make(app, st, 'b2b', 'b1');
  Deals.move(st, id, 'offer', 'b1', T1);
  for (const bad of [undefined, null, '', '   ']) {
    const r = Deals.lose(st, id, bad, 'b1', T2);
    assert.equal(r.ok, false, `причина ${JSON.stringify(bad)} принята`);
    assert.ok(r.reason.includes('причину'), r.reason);
  }
  assert.equal(deal(st, id).lostReason, undefined);
  assert.equal(Deals.state(st, deal(st, id)), 'open');
  assert.equal(st.feed.filter(e => e.kind === 'lose').length, 0, 'отказ без причины попал в ленту');

  assert.equal(Deals.lose(st, id, 'Дорого', 'b1', T2).ok, true);
  const d = deal(st, id);
  assert.deepEqual([d.lostReason, d.lostAt, d.stageId, Deals.state(st, d)], ['Дорого', T2, 'offer', 'lost']);
  assert.equal(st.feed.filter(e => e.kind === 'lose')[0].text, 'Провалена: Дорого');
  assert.equal(Deals.columns(st, 'dealsB2b', {}, 'b1').reduce((n, c) => n + c.count, 0), 0, 'проваленная сделка в колонках');
  assert.equal(Deals.columns(st, 'dealsB2b', { lost: true }, 'b1').reduce((n, c) => n + c.count, 0), 1, 'filter.lost не вернул проваленную');
  assert.equal(Deals.move(st, id, 'contract', 'b1', T3).ok, false, 'проваленную сделку двинули');
  assert.equal(Deals.win(st, id, 'b1', T3).ok, false);
  assert.equal(Deals.lose(st, id, 'Другое', 'b1', T3).ok, false, 'второй отказ');
  assert.equal(Deals.reopen(st, id, 'b1', T3).ok, true);
  assert.deepEqual([deal(st, id).lostReason, deal(st, id).lostAt, Deals.state(st, deal(st, id))], [undefined, undefined, 'open']);
  assert.equal(Deals.move(st, id, 'contract', 'b1', T3).ok, true);

  // «Успешно»: этап с флагом final, wonAt; потом провалить нельзя; назад на другой этап — wonAt снимается
  const id2 = make(app, st, 'b2b', 'b1');
  assert.equal(Deals.move(st, id2, 'нет-такого', 'b1', T1).ok, false);
  assert.equal(Deals.move(st, id2, 'request', 'b1', T1).ok, false, 'на тот же этап');
  assert.equal(Deals.move(st, id2, 'done', 'b1', T2).ok, true, 'перевод на «Сдана» — это «Успешно»');
  const w = deal(st, id2);
  assert.deepEqual([w.stageId, w.wonAt, Deals.state(st, w), Pipes.isFinal(st, w.pipeId, w.stageId)], ['done', T2, 'won', true]);
  assert.equal(st.feed.filter(e => e.kind === 'win').length, 1);
  assert.equal(Deals.lose(st, id2, 'Дорого', 'b1', T3).ok, false, 'успешную сделку провалили');
  assert.equal(Deals.win(st, id2, 'b1', T3).ok, false, 'второе «Успешно»');
  assert.equal(Deals.move(st, id2, 'payment', 'b1', T3).ok, true);
  assert.deepEqual([deal(st, id2).wonAt, Deals.state(st, deal(st, id2))], [undefined, 'open']);
  // причины по умолчанию — общий список
  assert.deepEqual([...Deals.reasons(st)], ['Дорого', 'Выбрали другого', 'Не дозвонились', 'Передумали', 'Другое']);
});

test('columns: сумма колонки равна сумме total её сделок; менеджер B2B не видит в колонках сделки B2C; «Мои» и поиск сужают', () => {
  const app = load(), { Deals } = app;
  const st = mini(app);
  // B2B, менеджер b1: «Заявка» — Д-301 (2 × 10 000 − 10 % = 18 000) и Д-302 (вписано 100 000); «КП» — Д-303 (4 × 1 500 = 6 000)
  // и Д-304 (Инвертор Б без цены + панель за 25 000 → в сумму идёт только известная цена = 25 000); Д-305 провалена
  const d1 = make(app, st, 'b2b', 'b1', { object: 'Склад' }), d2 = make(app, st, 'b2b', 'b1', { amount: 100000 });
  const d3 = make(app, st, 'b2b', 'b1'), d4 = make(app, st, 'b2b', 'b1'), d5 = make(app, st, 'b2b', 'b1');
  Deals.addItem(st, d1, { productId: 'pa', qty: 2, disc: 10 }, 'b1', T1);
  Deals.addItem(st, d3, { productId: 'pc', qty: 4 }, 'b1', T1);
  Deals.addItem(st, d4, { productId: 'pb', qty: 1 }, 'b1', T1);
  Deals.addItem(st, d4, { productId: 'pa', qty: 1, price: 25000 }, 'b1', T1);
  Deals.move(st, d3, 'offer', 'b1', T1); Deals.move(st, d4, 'offer', 'b1', T1);
  Deals.lose(st, d5, 'Передумали', 'b1', T1);
  // B2C, менеджер c1: «Заявка» — 1 × 10 000
  const c1 = make(app, st, 'b2c', 'c1');
  Deals.addItem(st, c1, { productId: 'pa', qty: 1 }, 'c1', T1);

  const cols = Deals.columns(st, 'dealsB2b', {}, 'b1');
  assert.deepEqual(col(cols, c => c.stage.id), ['request', 'calc', 'offer', 'contract', 'payment', 'delivery', 'install', 'done']);
  const by = id => cols.find(c => c.stage.id === id);
  assert.deepEqual([by('request').count, by('request').sum], [2, 118000]);
  assert.deepEqual([by('offer').count, by('offer').sum], [2, 31000]);
  assert.deepEqual(ids(by('request').deals), [d1, d2].sort());
  for (const c of cols) assert.equal(c.sum, c.deals.reduce((s, d) => s + Deals.total(d), 0), `сумма колонки «${c.stage.name}» не равна сумме сделок`);
  assert.equal(cols.reduce((n, c) => n + c.count, 0), 4, 'проваленная в колонках');

  // менеджер B2B не видит сделок B2C: в колонках воронки B2C у него пусто, у директора — сделка на месте
  assert.equal(Deals.columns(st, 'dealsB2c', {}, 'b1').reduce((n, c) => n + c.count, 0), 0);
  assert.equal(Deals.columns(st, 'dealsB2c', {}, 'dir').reduce((n, c) => n + c.count, 0), 1);
  assert.equal(Deals.columns(st, 'dealsB2c', {}, 'dir')[0].sum, 10000);
  assert.equal(Deals.columns(st, 'dealsB2b', {}, 'wh').reduce((n, c) => n + c.count, 0), 0, 'кладовщик без права «клиенты»');
  // «Мои» и поиск
  assert.equal(Deals.columns(st, 'dealsB2b', { mine: true }, 'dir').reduce((n, c) => n + c.count, 0), 0, 'у директора своих сделок нет');
  assert.equal(Deals.columns(st, 'dealsB2b', { mine: true }, 'b1').reduce((n, c) => n + c.count, 0), 4);
  const found = Deals.columns(st, 'dealsB2b', { q: 'склад' }, 'b1');
  assert.deepEqual(ids(found.flatMap(c => c.deals)), [d1], 'поиск по тексту сделки');
  assert.deepEqual([...Deals.columns(st, 'нет-такой', {}, 'dir')], []);
});

test('строки товаров: цена сайта по умолчанию, «нет данных» без неё; своя строка; проверки; правка и удаление пишутся в ленту', () => {
  const app = load(), { Deals } = app;
  const st = mini(app);
  const id = make(app, st, 'b2b', 'b1');
  const first = Deals.addItem(st, id, { productId: 'pa', qty: 2 }, 'b1', T1);
  assert.deepEqual([first.ok, first.idx], [true, 0]);
  Deals.addItem(st, id, { productId: 'pb' }, 'b1', T1);
  Deals.addItem(st, id, { text: 'Монтаж и пусконаладка (пример)', qty: 1, price: 50000, disc: 0 }, 'b1', T1);
  const items = deal(st, id).items;
  assert.deepEqual([items[0].price, items[0].disc, items[0].qty], [10000, 0, 2], 'цена сайта не подставилась');
  assert.deepEqual([items[1].price, items[1].qty], [null, 1], 'цены сайта нет — должно быть null, а не 0');
  assert.deepEqual([...Deals.noPrice(deal(st, id))], [1]);
  assert.equal(Deals.total(deal(st, id)), 70000);
  // нельзя: количество 0, неизвестный товар, пустая своя строка, скидка 150 %
  for (const bad of [{ productId: 'pa', qty: 0 }, { productId: 'нет' }, { text: '  ' }, { productId: 'pa', disc: 150 }, { productId: 'pa', price: -5 }]) {
    assert.equal(Deals.addItem(st, id, bad, 'b1', T1).ok, false, JSON.stringify(bad));
  }
  assert.equal(deal(st, id).items.length, 3);
  // цену вписали — total учёл; скидку поставили; цену убрали — снова «нет данных»
  assert.equal(Deals.setItem(st, id, 1, { price: 20000 }, 'b1', T2).ok, true);
  assert.equal(Deals.total(deal(st, id)), 90000);
  assert.equal(Deals.setItem(st, id, 0, { disc: 25 }, 'b1', T2).ok, true);
  assert.equal(Deals.total(deal(st, id)), 2 * 10000 * 0.75 + 20000 + 50000);
  assert.equal(Deals.setItem(st, id, 0, { price: null }, 'b1', T2).ok, true);
  assert.deepEqual([...Deals.noPrice(deal(st, id))], [0]);
  assert.equal(Deals.setItem(st, id, 0, { qty: 0 }, 'b1', T2).ok, false);
  assert.equal(Deals.setItem(st, id, 9, { qty: 1 }, 'b1', T2).ok, false);
  const e = st.feed.filter(x => x.kind === 'item');
  assert.ok(e.some(x => x.text.includes('Панель А') && x.text.includes('Скидка: 0 → 25')), col(e, x => x.text).join(' | '));
  // удаление
  assert.equal(Deals.removeItem(st, id, 2, 'b1', T3).ok, true);
  assert.equal(deal(st, id).items.length, 2);
  assert.ok(st.feed.some(x => x.kind === 'item' && x.text.startsWith('Убрана строка: Монтаж')));
  assert.equal(Deals.removeItem(st, id, 5, 'b1', T3).ok, false);
});

test('reserveItem: больше свободного — отказ с объяснением склада; в пределах — резерв сделки, остаток уменьшился; ни лишнего, ни без права', () => {
  const app = load(), { Deals, Stock } = app;
  const st = mini(app);
  const id = make(app, st, 'b2b', 'b1');
  Deals.addItem(st, id, { productId: 'pa', qty: 20 }, 'b1', T1);
  Deals.addItem(st, id, { text: 'Монтаж' }, 'b1', T1);
  const cell = { entityId: 'ip', cityId: 'irk' };
  const free = () => Stock.summary(st, 'pa', T1).free;
  assert.equal(free(), 10);

  // в строке 20, на складе 10: просим 15 — склад отказывает и называет число
  let r = Deals.reserveItem(st, id, 0, { ...cell, qty: 15 }, 'b1', T1);
  assert.equal(r.ok, false);
  assert.ok(r.reason.includes('свободно только 10'), r.reason);
  assert.equal(r.max, 10);
  assert.equal(st.reserves.length, 0, 'при отказе резерв записан');
  assert.equal(free(), 10);
  // по умолчанию — вся строка (20): тот же отказ
  assert.ok(Deals.reserveItem(st, id, 0, cell, 'b1', T1).reason.includes('свободно только 10'));

  // 4 шт.: резерв сделки, со склада, остаток 6
  r = Deals.reserveItem(st, id, 0, { ...cell, qty: 4 }, 'b1', T1);
  assert.equal(r.ok, true, r.reason);
  assert.equal(st.reserves.length, 1);
  assert.deepEqual([st.reserves[0].dealId, st.reserves[0].productId, st.reserves[0].qty, st.reserves[0].src, st.reserves[0].entityId, st.reserves[0].cityId], [id, 'pa', 4, 'stock', 'ip', 'irk']);
  assert.equal(free(), 6);
  assert.equal(Deals.reserved(st, deal(st, id), 'pa'), 4);
  const e = st.feed.find(x => x.kind === 'reserve');
  assert.ok(e && e.by === 'b1' && e.at === T1 && e.text.includes('панель А') && e.text.includes('со склада (ИП, Иркутск)'), e && e.text);
  assert.ok(st.notes.some(n => n.kind === 'reserve' && n.text.includes(id)), 'складу и директору не ушло уведомление');
  assert.equal(st.moves[0].kind, 'Резерв', 'в журнале движений нет записи о резерве');

  // в строке осталось 16, на складе 6: просим больше строки — отказ строки; просим по умолчанию — отказ склада
  assert.ok(Deals.reserveItem(st, id, 0, { ...cell, qty: 17 }, 'b1', T2).reason.includes('можно ещё 16'));
  assert.ok(Deals.reserveItem(st, id, 0, cell, 'b1', T2).reason.includes('свободно только 6'));
  assert.equal(Deals.reserveItem(st, id, 0, { ...cell, qty: 6 }, 'b1', T2).ok, true);
  assert.equal(free(), 0);
  // свою строку, чужого и кладовщика — нельзя; неизвестную строку — нельзя
  assert.equal(Deals.reserveItem(st, id, 1, cell, 'b1', T2).ok, false);
  assert.equal(Deals.reserveItem(st, id, 7, cell, 'b1', T2).ok, false);
  assert.equal(Deals.reserveItem(st, id, 0, { ...cell, qty: 1 }, 'wh', T2).ok, false);
  assert.equal(Deals.reserveItem(st, id, 0, { ...cell, qty: 1 }, 'c1', T2).ok, false, 'менеджер B2C резервирует по сделке B2B');

  // пока резерв стоит, строку не убрать; снял резерв — товар вернулся в свободный
  assert.equal(Deals.removeItem(st, id, 0, 'b1', T3).ok, false);
  assert.ok(Deals.removeItem(st, id, 0, 'b1', T3).reason.includes('резерв'));
  assert.equal(Deals.unreserve(st, id, st.reserves[0].id, 'b1', T3).ok, true);
  assert.equal(free(), 4);
  assert.equal(Deals.unreserve(st, id, 'r404', 'b1', T3).ok, false);
  assert.ok(st.feed.some(x => x.kind === 'reserve' && x.text.startsWith('Снят резерв')));
});

test('Feed.of: резервы сделки (и поставленные до ленты), сообщения клиенту, история лида; у клиента — ленты его сделок и лидов только видимых', () => {
  const app = load(), { Deals, Feed } = app;
  const st = mini(app);
  const idB = make(app, st, 'b2b', 'b1'), idC = make(app, st, 'b2c', 'c1');
  // резерв старого образца: без отметки времени, время — в журнале движений; и сообщения клиенту
  st.reserves.push({ id: 'r1', productId: 'pa', qty: 2, src: 'stock', entityId: 'ip', cityId: 'irk', dealId: idB, until: T3 });
  st.moves.unshift({ at: T1, productId: 'pa', kind: 'Резерв', qty: 2, doc: idB, by: 'b1' });
  st.msgs.push({ id: 'm1', at: T2, deal: idB, channel: 'telegram', by: 'b1', text: 'Панели зарезервировали' }, { id: 'm2', at: T3, deal: idB, channel: 'telegram', inbound: true, text: 'Спасибо, жду' });
  const feed = Feed.of(st, { t: 'deal', id: idB });
  assert.deepEqual(col(feed, e => e.kind), ['msg', 'msg', 'reserve', 'create']);
  assert.equal(feed[0].text, 'Спасибо, жду');
  assert.equal(feed[0].data.inbound, true);
  assert.equal(feed[2].at, T1, 'время резерва старого образца — из журнала движений');
  assert.equal(feed[2].by, 'b1');
  assert.ok(feed[2].text.startsWith('Резерв: панель А — 2 со склада'), feed[2].text);
  // новый резерв через сделку попадает в ленту один раз, не дважды (своя запись и сам резерв)
  Deals.addItem(st, idB, { productId: 'pa', qty: 5 }, 'b1', T1);
  assert.equal(Deals.reserveItem(st, idB, 0, { entityId: 'ip', cityId: 'irk', qty: 3 }, 'b1', T2).ok, true);
  assert.equal(Feed.of(st, { t: 'deal', id: idB }).filter(e => e.kind === 'reserve').length, 2);
  // лид: его история — в ленте лида, новая сверху
  st.leads.push({ id: 'Л-1', phone: '+7 900 000-00-01', type: 'b2b', managerId: 'b1', history: [{ at: NOW, by: null, text: 'Лид пришёл: сайт' }, { at: T1, by: 'b1', text: 'Связались с клиентом' }] });
  const lf = Feed.of(st, { t: 'lead', id: 'Л-1' });
  assert.deepEqual(col(lf, e => e.text), ['Связались с клиентом', 'Лид пришёл: сайт']);
  assert.ok(lf.every(e => e.kind === 'history' && e.ref.t === 'lead'));
  // клиент: свои записи + ленты сделок и лидов; B2B-менеджер не получает записи сделки B2C
  const mixed = app.Clients.create(st, { name: 'Клиент-пример Смешанный', phone: '+7 900 000-00-01' }, 'dir', NOW).client;
  st.deals.find(d => d.id === idB).clientId = mixed.id;
  st.deals.find(d => d.id === idC).clientId = mixed.id;
  Feed.add(st, { t: 'deal', id: idC }, { kind: 'comment', text: 'Секрет B2C', by: 'c1', at: T3 });
  const dir = Feed.of(st, { t: 'client', id: mixed.id }, 'dir');
  assert.ok(dir.some(e => e.text === 'Секрет B2C') && dir.some(e => e.text === 'Связались с клиентом') && dir.some(e => e.text === 'Спасибо, жду') && dir.some(e => e.kind === 'create' && e.ref.t === 'client'));
  const b1 = Feed.of(st, { t: 'client', id: mixed.id }, 'b1');
  assert.ok(!b1.some(e => e.text === 'Секрет B2C'), 'менеджер B2B увидел запись по сделке B2C');
  assert.ok(b1.some(e => e.text === 'Спасибо, жду'));
  assert.ok(dir.every((e, i) => i === 0 || new Date(dir[i - 1].at) >= new Date(e.at)), 'лента клиента не по времени');
});

test('feedHtml и комментарий: поле «Комментарий», записи, экранирование; без права — без поля; пустой комментарий и чужая карточка — отказ', () => {
  const app = load(), { Deals, Feed } = app;
  const st = mini(app);
  const id = make(app, st, 'b2b', 'b1');
  st.me = 'b1';
  assert.equal(Feed.comment(st, { t: 'deal', id }, 'Звонил <b>клиенту</b>', 'b1', T1).ok, true);
  Deals.move(st, id, 'calc', 'b1', T2);
  const html = app.feedHtml({ t: 'deal', id }, st);
  assert.ok(html.includes('data-form="feed-comment"') && html.includes('placeholder="Комментарий"'), 'нет поля «Комментарий»');
  assert.ok(html.includes('Звонил &lt;b&gt;клиенту&lt;/b&gt;') && !html.includes('<b>клиенту</b>'), 'текст не экранирован');
  assert.ok(html.indexOf('Этап: «Заявка» → «Расчёт»') < html.indexOf('Звонил'), 'новое должно быть выше');
  assert.ok(html.includes('Менеджер B2B') && html.includes('Комментарий</b>'));
  // кладовщик: ленту видно, писать нельзя
  st.me = 'wh';
  const ro = app.feedHtml({ t: 'deal', id }, st);
  assert.ok(!ro.includes('data-form="feed-comment"') && ro.includes('нет права'), 'кладовщику показали поле комментария');
  // отказы
  assert.equal(Feed.comment(st, { t: 'deal', id }, '   ', 'b1', T3).ok, false);
  assert.equal(Feed.comment(st, { t: 'deal', id }, 'Чужой', 'c1', T3).ok, false, 'менеджер B2C пишет в сделку B2B');
  assert.equal(Feed.comment(st, { t: 'deal', id }, 'Чужой', 'wh', T3).ok, false);
  assert.equal(Feed.comment(st, { t: 'deal', id: 'Д-404' }, 'Нет такой', 'dir', T3).ok, false);
});

test('форма комментария на странице: текст из поля уходит в ленту от имени «Кто я», поле очищается; пустое — ничего не пишет', () => {
  const app = load();
  const S = app.S;
  S.me = 'p1';
  const d = S.deals[0], ref = { t: 'deal', id: d.id };
  const field = app.document.getElementById('feed-text');
  const before = app.Feed.of(S, ref).length;
  field.value = '   ';
  app.feedCommentForm({ dataset: { t: 'deal', id: d.id } });
  assert.equal(app.Feed.of(S, ref).length, before, 'пустой комментарий записан');
  field.value = ' Клиент просит скидку ';
  app.feedCommentForm({ dataset: { t: 'deal', id: d.id } });
  const top = app.Feed.of(S, ref)[0];
  assert.deepEqual([top.kind, top.text, top.by], ['comment', 'Клиент просит скидку', 'p1']);
  assert.equal(app.Feed.of(S, ref).length, before + 1);
  assert.equal(field.value, '');
});

// ——— демо-данные ———
// Ожидания считаются заново по данным S (этапы воронки, строки, резервы), а не вызовом тех же функций.

test('демо: 25+ сделок обоих типов на всех этапах воронки, у каждой клиент; проваленные — с причиной из списка', () => {
  const app = load(), { S } = app;
  assert.ok(S.deals.length >= 25, `сделок ${S.deals.length}`);
  for (const type of ['b2b', 'b2c']) {
    const pipe = S.pipelines.find(p => p.kind === 'deals' && p.scope === type);
    for (const stage of pipe.stages) {
      const n = S.deals.filter(d => d.type === type && d.pipeId === pipe.id && d.stageId === stage.id && !d.lostReason).length;
      assert.ok(n >= 1, `${type}: на этапе «${stage.name}» нет ни одной сделки`);
    }
  }
  for (const d of S.deals) {
    assert.ok(d.demo === true, `${d.id}: не помечена как демо`);
    assert.ok(S.clients.some(c => c.id === d.clientId), `${d.id}: клиента ${d.clientId} нет`);
  }
  assert.deepEqual(Array.from(S.lostReasons, r => r.name), ['Дорого', 'Выбрали другого', 'Не дозвонились', 'Передумали', 'Другое']);
  const lost = S.deals.filter(d => d.lostReason);
  assert.ok(lost.length >= 2 && lost.some(d => d.type === 'b2b') && lost.some(d => d.type === 'b2c'), 'проваленных сделок мало');
  for (const d of lost) assert.ok(S.lostReasons.some(r => r.name === d.lostReason), `${d.id}: причина «${d.lostReason}» не из списка`);
  // успешные — на финальном этапе и с датой
  for (const d of S.deals.filter(x => x.wonAt)) assert.equal(app.Pipes.isFinal(S, d.pipeId, d.stageId), true, `${d.id}: «Успешно» не на финальном этапе`);
  assert.ok(S.deals.filter(d => d.wonAt).length >= 4);
});

test('демо: у части сделок строки из настоящего каталога по цене сайта; сумма — по строкам; «нет данных: цена» там, где цены сайта нет', () => {
  const app = load(), { S, Deals } = app;
  const withItems = S.deals.filter(d => d.items && d.items.length);
  assert.ok(withItems.length >= 10 && withItems.length < S.deals.length, `сделок со строками ${withItems.length}`);
  let catalogLines = 0;
  for (const d of withItems) {
    let want = 0;
    for (const it of d.items) {
      if (it.productId) {
        const p = S.products.find(x => x.id === it.productId);
        assert.ok(p, `${d.id}: товара ${it.productId} нет в каталоге`);
        assert.equal(it.price, typeof p.price === 'number' ? p.price : null, `${d.id}: цена строки не цена сайта`);
        if (p.inCatalog && typeof p.price === 'number') catalogLines++;
      } else assert.ok(it.text && it.price === null, `${d.id}: своя строка с придуманной ценой`);
      if (it.price !== null) want += it.qty * it.price * (100 - it.disc) / 100;
    }
    assert.ok(Math.abs(Deals.total(d) - want) < 0.01, `${d.id}: сумма ${Deals.total(d)} вместо ${want}`);
  }
  assert.ok(catalogLines >= 30, `строк с товаром каталога и ценой сайта ${catalogLines}`);
  assert.ok(withItems.some(d => Deals.noPrice(d).length), 'нет сделки со строкой «нет данных: цена»');
  assert.ok(withItems.some(d => d.items.some(i => i.disc > 0)), 'нет строки со скидкой');
});

test('демо: колонки по демо-данным — суммы и числа сходятся; менеджер B2B видит сделки B2B и не видит B2C; РОП видит обе воронки', () => {
  const app = load(), { S, Deals } = app;
  const open = type => S.deals.filter(d => d.type === type && !d.lostReason);
  const sumOf = list => list.reduce((s, d) => s + (d.items && d.items.length
    ? d.items.reduce((a, i) => a + (i.price === null ? 0 : i.qty * i.price * (100 - i.disc) / 100), 0) : d.amount || 0), 0);
  const count = (pipeId, who) => Deals.columns(S, pipeId, {}, who).reduce((n, c) => n + c.count, 0);
  for (const [pipeId, type] of [['dealsB2b', 'b2b'], ['dealsB2c', 'b2c']]) {
    const cols = Deals.columns(S, pipeId, {}, 'p1');
    assert.equal(cols.reduce((n, c) => n + c.count, 0), open(type).length, `${type}: число сделок в колонках`);
    assert.ok(Math.abs(cols.reduce((n, c) => n + c.sum, 0) - sumOf(open(type))) < 0.5, `${type}: сумма колонок`);
    for (const c of cols) assert.ok(Math.abs(c.sum - sumOf(c.deals)) < 0.01, `${type}/${c.stage.name}: сумма колонки`);
  }
  // p3 — менеджер B2B: все сделки B2B, в воронке B2C пусто; p2 — менеджер B2C: наоборот
  assert.equal(count('dealsB2b', 'p3'), open('b2b').length);
  assert.equal(count('dealsB2c', 'p3'), 0);
  assert.equal(count('dealsB2b', 'p2'), 0);
  assert.equal(count('dealsB2c', 'p2'), open('b2c').length);
  // p12 — РОП (право «все типы»): обе воронки; p5 — кладовщик: ничего
  assert.equal(count('dealsB2b', 'p12'), open('b2b').length);
  assert.equal(count('dealsB2c', 'p12'), open('b2c').length);
  assert.equal(count('dealsB2c', 'p5'), 0);
});

test('демо: в ленте прежней сделки — все её резервы и сообщения клиенту, как раньше; каждый шаг по воронке — запись в ленте; время не в будущем', () => {
  const app = load(), { S, Feed } = app;
  for (const id of ['Д-311', 'Д-314', 'Д-318', 'Д-305']) {
    const feed = Feed.of(S, { t: 'deal', id });
    assert.equal(feed.filter(e => e.kind === 'reserve').length, S.reserves.filter(r => r.dealId === id).length, `${id}: резервы в ленте`);
    assert.equal(feed.filter(e => e.kind === 'msg').length, S.msgs.filter(m => m.deal === id).length, `${id}: сообщения клиенту в ленте`);
    assert.ok(feed.every(e => e.at && new Date(e.at) <= new Date()), `${id}: в ленте запись из будущего`);
  }
  assert.equal(S.deals.find(d => d.id === 'Д-322').client, 'Орлов Пётр', 'название клиента в прежней сделке v2 изменилось');
  // сколько раз сделка сменила этап — столько записей «этап/успешно» в её ленте
  for (const d of S.deals) {
    const pipe = S.pipelines.find(p => p.id === d.pipeId), pos = pipe.stages.findIndex(s => s.id === d.stageId);
    const feed = Feed.of(S, { t: 'deal', id: d.id });
    assert.equal(feed.filter(e => e.kind === 'stage' || e.kind === 'win').length, pos, `${d.id}: шагов по воронке ${pos}, а в ленте иначе`);
    assert.ok(feed.some(e => e.kind === 'create'), `${d.id}: в ленте нет «создана»`);
    assert.equal(feed.filter(e => e.kind === 'lose').length, d.lostReason ? 1 : 0, `${d.id}: отказ в ленте`);
  }
});

test('демо переживает сохранение: клиенты, лента с датами, строки, причины отказа на месте; ревизия сохранения поднята', () => {
  const app = load(), { S, Store } = app;
  const back = Store.load(Store.dump(S).text);
  assert.ok(back, 'сохранение не читается обратно');
  assert.equal(back.clients.length, S.clients.length);
  assert.equal(back.feed.length, S.feed.length);
  assert.equal(back.feed[0].at.getTime(), S.feed[0].at.getTime(), 'дата ленты не вернулась датой');
  assert.equal(JSON.stringify(back.deals.map(d => d.items)), JSON.stringify(S.deals.map(d => d.items)));
  assert.equal(JSON.stringify(back.lostReasons), JSON.stringify(S.lostReasons));
  assert.ok(Store.REV >= 7, 'ревизия сохранения не ниже той, что принесли клиенты (7): позже её поднимали дела');
  // прежнее сохранение (ревизия 6, до клиентов) не читается: запуск возьмёт демо
  const old = JSON.parse(Store.dump(S).text);
  old.rev = 6;
  assert.equal(Store.load(JSON.stringify(old)), null);
});

// ——— экраны раздела «Сделки» (таск 09, второй кусок): доска, карточка, товары, резерв, КП ———
// Виды зовутся на seed() (32 демо-сделки). Ожидаемые числа посчитаны здесь по данным руками (строка × цена × (1 − скидка)),
// не вызовом Deals.total; формат рубля — свой.

const asRole = (app, role) => { const p = app.S.people.find(x => x.role === role); app.setMe(p.id); return p; };
const view = app => app.document.getElementById('view').innerHTML;
const el = (app, id) => app.document.getElementById(id);
const money = n => Math.round(n).toLocaleString('ru-RU') + ' ₽';
const fmt = n => Number(n).toLocaleString('ru-RU');
// сумма сделки по данным: строки с ценой — количество × цена × (1 − скидка/100); строк нет — вписанная сумма
const byHand = d => (d.items && d.items.length
  ? d.items.reduce((s, it) => s + (typeof it.price === 'number' ? it.qty * it.price * (100 - (it.disc || 0)) / 100 : 0), 0)
  : (d.amount || 0));
const cardIds = html => [...html.matchAll(/data-act="open-deal" data-id="([^"]+)"/g)].map(m => m[1]).sort();
// колонки доски из разметки: этап, число сделок, сумма (число и подпись в шапке)
const boardCols = html => html.split('data-dcol="').slice(1).map(ch => ({
  id: ch.slice(0, ch.indexOf('"')),
  count: Number(/class="dcnt">(\d+) /.exec(ch)[1]),
  sum: Number(/data-sum="([\d.]+)"/.exec(ch)[1]),
  text: /data-sum="[\d.]+">([^<]+)</.exec(ch)[1],
}));
const idsOnly = list => [...list].map(d => d.id).sort();

test('доска «Сделки»: в шапке колонки число сделок и сумма в ₽ — сумма сделок колонки, посчитанная по строкам; обе воронки', () => {
  const app = load();
  asRole(app, 'director');
  app.go('deals');
  for (const type of ['b2b', 'b2c']) {
    app.A['deal-type']({ dataset: { type } });
    const cols = boardCols(view(app));
    const pipe = app.S.pipelines.find(p => p.kind === 'deals' && p.scope === type);
    assert.deepEqual(cols.map(c => c.id), Array.from(pipe.stages, s => s.id), 'колонки — не этапы воронки');
    for (const c of cols) {
      const ds = app.S.deals.filter(d => d.pipeId === pipe.id && d.stageId === c.id && !d.lostReason);
      const want = ds.reduce((s, d) => s + byHand(d), 0);
      assert.equal(c.count, ds.length, `${type}/${c.id}: число сделок`);
      assert.ok(Math.abs(c.sum - want) < 0.005, `${type}/${c.id}: сумма ${c.sum}, по данным ${want}`);
      assert.equal(c.text, money(want), `${type}/${c.id}: подпись суммы`);
    }
    assert.ok(cols.reduce((n, c) => n + c.count, 0) >= 10, `${type}: в демо мало открытых сделок`);
    assert.ok(cols.some(c => c.sum > 0));
  }
});

test('доска «Сделки»: менеджер B2C не видит ни одной сделки B2B — ни в доске, ни в таблице, ни с фильтром «Провалены»; карточка B2B не открывается', () => {
  const app = load();
  asRole(app, 'managerB2c');
  app.go('deals');
  const all = app.S.deals, b2b = all.filter(d => d.type === 'b2b');
  assert.ok(b2b.length >= 10 && all.some(d => d.type === 'b2c' && !d.lostReason), 'в демо нет сделок обоих типов');
  const want = idsOnly(all.filter(d => d.type === 'b2c' && !d.lostReason));
  for (const mode of ['board', 'table']) {
    app.A['deal-view']({ dataset: { v: mode } });
    app.A['deal-type']({ dataset: { type: 'b2b' } });           // просим B2B — ему показывают только свой тип
    const html = view(app);
    assert.deepEqual(cardIds(html), want, `${mode}: показаны не все его сделки или лишние`);
    for (const d of b2b) assert.ok(!html.includes(d.id) && !html.includes(d.client), `${mode}: видна сделка B2B ${d.id}`);
    assert.ok(!html.includes('data-act="deal-type"'), 'у менеджера есть переключатель типа');
  }
  app.A['deal-lostf']();
  const lostIds = cardIds(view(app));
  assert.deepEqual(lostIds, idsOnly(all.filter(d => d.type === 'b2c' && d.lostReason)), 'фильтр «Провалены»');
  for (const d of b2b) assert.equal(app.DRAWERS.deal(d.id), null, `открылась карточка ${d.id}`);
  // директор: оба типа, переключатель есть
  asRole(app, 'director');
  assert.ok(view(app).includes('data-type="b2b"') && view(app).includes('data-type="b2c"'));
});

test('фильтры «Мои», «Провалены» и поиск сужают доску и таблицу одним отбором; «Сбросить» возвращает', () => {
  const app = load();
  const me = asRole(app, 'managerB2b');
  app.go('deals');
  const open = app.S.deals.filter(d => d.type === 'b2b' && !d.lostReason);
  assert.deepEqual(cardIds(view(app)), idsOnly(open));
  app.A['deal-mine']();
  assert.deepEqual(cardIds(view(app)), idsOnly(open.filter(d => d.managerId === me.id)), '«Мои»');
  app.A['deal-mine']();
  const d0 = open[0];
  app.ON.input['deal-q']({ value: d0.client });
  const found = cardIds(app.dealsBody());
  assert.ok(found.includes(d0.id) && found.length < open.length, 'поиск по клиенту ничего не сузил');
  app.ON.input['deal-q']({ value: 'такого-клиента-нет-нигде' });
  assert.ok(app.dealsBody().includes('По этим условиям сделок нет'));
  app.A['deal-reset']();
  assert.deepEqual(cardIds(view(app)), idsOnly(open));
  app.A['deal-view']({ dataset: { v: 'table' } });
  assert.ok(view(app).includes('<table class="tbl">'));
});

test('карточка сделки: полоса этапов, вкладки «Детали», «Товары», «Лента»; клик по этапу двигает, «Провалена» и «Вернуть в работу» — по состоянию', () => {
  const app = load();
  asRole(app, 'director');
  const d = app.S.deals.find(x => !x.lostReason && !app.isDone(x) && x.type === 'b2b');
  const pipe = app.S.pipelines.find(p => p.id === d.pipeId);
  let body = app.DRAWERS.deal(d.id).body;
  assert.equal((body.match(/data-act="deal-stage"/g) || []).length, pipe.stages.length, 'в полосе не все этапы воронки');
  for (const label of ['Детали', 'Товары', 'Лента']) assert.ok(body.includes('>' + label), `нет вкладки «${label}»`);
  for (const act of ['deal-win', 'deal-lose', 'deal-kp']) assert.ok(body.includes(`data-act="${act}"`), `нет кнопки ${act}`);
  assert.ok(!body.includes('data-act="deal-reopen"'));
  assert.ok(body.includes('data-f="contact"') && body.includes('data-f="phone"') && body.includes('data-f="managerId"') && body.includes('data-f="channel"'), 'нет полей «Деталей»');

  // клик по этапу: сделка на этапе, в ленте запись
  const to = pipe.stages.find(s => s.id !== d.stageId && !s.flag).id;
  app.A['deal-stage']({ dataset: { id: d.id, st: to } });
  assert.equal(app.S.deals.find(x => x.id === d.id).stageId, to);
  assert.ok(app.Feed.of(app.S, { t: 'deal', id: d.id })[0].text.includes('Этап:'), 'смена этапа не в ленте');
  assert.ok(new RegExp(`class="dstep cur" data-act="deal-stage" data-id="${d.id}" data-st="${to}"`).test(app.DRAWERS.deal(d.id).body), 'текущий этап не отмечен');

  // «Провалена»: окно с причинами из Deals.reasons; пустая причина — отказ; с причиной — сделка проваленная
  const m = app.MODALS.dealLose(d.id);
  for (const r of app.Deals.reasons(app.S)) assert.ok(m.includes(`<option value="${r}">`), `в окне нет причины «${r}»`);
  el(app, 'dl-reason').value = '';
  app.FORMS['deal-lose']({ dataset: { id: d.id } });
  assert.ok(el(app, 'dl-err').textContent.includes('причин'), 'пустая причина принята');
  assert.equal(app.S.deals.find(x => x.id === d.id).lostReason, undefined);
  el(app, 'dl-reason').value = 'Дорого';
  el(app, 'dl-note').value = 'Сказали, что у соседей на 10 % дешевле';
  app.FORMS['deal-lose']({ dataset: { id: d.id } });
  const lost = app.S.deals.find(x => x.id === d.id);
  assert.equal(lost.lostReason, 'Дорого');
  assert.ok(app.Feed.of(app.S, { t: 'deal', id: d.id }).some(e => e.kind === 'comment' && e.text.includes('у соседей')), 'комментарий к отказу не в ленте');
  body = app.DRAWERS.deal(d.id).body;
  assert.ok(body.includes('Провалена: Дорого') && body.includes('data-act="deal-reopen"'));
  assert.ok(!body.includes('data-act="deal-win"') && !body.includes('data-act="deal-lose"'), 'у проваленной остались «Успешно» / «Провалена»');
  assert.equal((body.match(/data-act="deal-stage"[^>]* disabled/g) || []).length, pipe.stages.length, 'у проваленной этапы не заблокированы');
  app.A['deal-reopen']({ dataset: { id: d.id } });
  assert.equal(app.Deals.state(app.S, app.S.deals.find(x => x.id === d.id)), 'open');

  // «Успешно»
  app.A['deal-win']({ dataset: { id: d.id } });
  const won = app.S.deals.find(x => x.id === d.id);
  assert.deepEqual([app.Deals.state(app.S, won), app.Pipes.isFinal(app.S, won.pipeId, won.stageId)], ['won', true]);
  assert.ok(won.wonAt, 'не записано время «Успешно»');
  assert.ok(app.DRAWERS.deal(d.id).body.includes('Успешно закрыта'));
});

test('вкладка «Лента» в карточке — feedHtml со своим полем; вкладки переключаются', () => {
  const app = load();
  asRole(app, 'director');
  const d = app.S.deals[0];
  assert.ok(!app.DRAWERS.deal(d.id).body.includes('data-form="feed-comment"'), 'поле комментария на вкладке «Детали»');
  app.A['deal-tab']({ dataset: { tab: 'feed' } });
  const body = app.DRAWERS.deal(d.id).body;
  assert.ok(body.includes(`data-ref-t="deal" data-ref-id="${d.id}"`) && body.includes('data-form="feed-comment"'));
  app.A['deal-tab']({ dataset: { tab: 'items' } });
  assert.ok(app.DRAWERS.deal(d.id).body.includes('id="deal-ps"'));
  // открыли другую сделку — снова «Детали»
  app.A['open-deal']({ dataset: { id: d.id } });
  assert.ok(app.DRAWERS.deal(d.id).body.includes('data-f="contact"'));
});

test('форма комментария зарегистрирована в FORMS: отправка формы из ленты пишет комментарий от имени «Кто я»', () => {
  const app = load();
  asRole(app, 'managerB2b');
  assert.equal(app.FORMS['feed-comment'], app.feedCommentForm);
  const d = app.S.deals.find(x => x.type === 'b2b' && !x.lostReason);
  el(app, 'feed-text').value = 'Согласовали выезд на замер';
  let stopped = false;
  app.document.dispatchEvent({ type: 'submit', target: { dataset: { form: 'feed-comment', t: 'deal', id: d.id } }, preventDefault() { stopped = true; } });
  assert.ok(stopped, 'отправку формы страница не приняла (форма не зарегистрирована)');
  const top = app.Feed.of(app.S, { t: 'deal', id: d.id })[0];
  assert.deepEqual([top.kind, top.text, top.by], ['comment', 'Согласовали выезд на замер', app.S.me]);
});

test('вкладка «Товары»: «свободно N» из Stock.summary, «нет данных: цена», итог = сумма строк; правка цены и количества пересчитывает на месте; отказ возвращает значение', () => {
  const app = load();
  asRole(app, 'director');
  const d = app.S.deals.find(x => x.items.some(i => i.productId && app.Stock.summary(app.S, i.productId, new Date()).known) && x.items.some(i => i.price === null));
  assert.ok(d, 'в демо нет сделки со строкой без цены и товаром с остатком');
  app.A['deal-tab']({ dataset: { tab: 'items' } });
  const body = () => app.DRAWERS.deal(d.id).body;
  let b = body();
  for (const it of d.items.filter(i => i.productId)) {
    const k = app.Stock.summary(app.S, it.productId, new Date());
    if (k.known) assert.ok(b.includes('свободно ' + fmt(Math.max(0, k.free))), `нет «свободно ${k.free}»`);
  }
  assert.ok(b.includes('нет данных: цена'), 'строка без цены не названа');
  assert.equal((b.match(/<li class="dline">/g) || []).length, d.items.length);
  assert.equal(/id="di-total">([^<]+)</.exec(b)[1], money(byHand(d)), 'итог не равен сумме строк');
  assert.ok(b.includes('В итог не вошли строки без цены: ' + d.items.filter(i => i.price === null).length));
  // цена строки без цены: вписали — итог вырос на qty × цена
  const i0 = d.items.findIndex(i => i.price === null), before = byHand(d), it0 = d.items[i0];
  app.ON.change['deal-i']({ dataset: { id: d.id, i: String(i0), f: 'price' }, value: '5000', tagName: 'INPUT' });
  assert.equal(it0.price, 5000);
  assert.ok(Math.abs(byHand(d) - (before + it0.qty * 5000 * (100 - (it0.disc || 0)) / 100)) < 0.005);
  assert.equal(el(app, 'di-total').textContent, money(byHand(d)), 'итог на месте не пересчитался');
  // скидка 200 % — отказ, в поле возвращается прежнее значение
  const field = { dataset: { id: d.id, i: String(i0), f: 'disc' }, value: '200', tagName: 'INPUT' };
  app.ON.change['deal-i'](field);
  assert.equal(it0.disc || 0, 0);
  assert.equal(String(field.value), String(it0.disc || 0), 'в поле осталось неверное значение');
  // поиск по каталогу и добавление; своя строка
  const found = app.dealFound(d, 'панел');
  assert.ok(found.includes('data-act="deal-add-p"') && (found.match(/data-act="deal-add-p"/g) || []).length <= 8);
  assert.ok(app.dealFound(d, 'п').includes('хотя бы две буквы'));
  const pid = /data-pid="([^"]+)"/.exec(found)[1], n = d.items.length;
  app.A['deal-add-p']({ dataset: { id: d.id, pid } });
  assert.equal(d.items.length, n + 1);
  assert.equal(d.items[n].productId, pid);
  el(app, 'do-name').value = 'Доставка до объекта';
  el(app, 'do-qty').value = '1';
  el(app, 'do-price').value = '';
  app.FORMS['deal-own']({ dataset: { id: d.id } });
  assert.deepEqual([d.items[n + 1].text, d.items[n + 1].price], ['Доставка до объекта', null]);
  el(app, 'do-name').value = '  ';
  app.FORMS['deal-own']({ dataset: { id: d.id } });
  assert.ok(el(app, 'do-err').textContent.length > 0 && d.items.length === n + 2, 'пустая своя строка принята');
  // убрать строку
  app.A['deal-del-i']({ dataset: { id: d.id, i: String(n + 1) } });
  assert.equal(d.items.length, n + 1);
});

test('резерв из сделки: окно показывает остаток; больше свободного — отказ с причиной склада и ничего не ставится; в пределах — резерв и «Снять»', () => {
  const app = load();
  asRole(app, 'director');
  const { S, Stock, Deals } = app;
  let pick = null;
  for (const d of S.deals) d.items.forEach((it, i) => {
    if (pick || !it.productId) return;
    const k = Stock.summary(S, it.productId, new Date());
    if (k.known && k.free >= 2 && it.qty > k.free && Deals.reserved(S, d, it.productId) === 0) pick = { d, i, it, free: k.free };
  });
  assert.ok(pick, 'в демо нет строки, где заказано больше, чем свободно');
  const { d, i, it, free } = pick;
  app.A['deal-tab']({ dataset: { tab: 'items' } });
  assert.ok(app.DRAWERS.deal(d.id).body.includes(`data-act="deal-res" data-id="${d.id}" data-i="${i}"`), 'нет кнопки «Зарезервировать»');
  const modal = app.MODALS.dealReserve(`${d.id}:${i}`);
  assert.ok(modal.includes('Свободно на складе: ' + fmt(free)) && modal.includes('Можно поставить:'), 'окно не показывает остаток');
  const cell = Stock.bestCell(S, it.productId);
  const set = (qty) => { el(app, 'dr-ent').value = cell.entityId; el(app, 'dr-city').value = cell.cityId; el(app, 'dr-qty').value = String(qty); el(app, 'dr-until').value = '2030-01-01'; };
  const n = S.reserves.length;
  set(it.qty);                                        // больше, чем свободно
  app.FORMS['deal-reserve']({ dataset: { id: d.id, i: String(i) } });
  assert.ok(el(app, 'dr-err').textContent.includes('свободно только ' + free), el(app, 'dr-err').textContent);
  assert.equal(S.reserves.length, n, 'при отказе резерв поставлен');
  el(app, 'dr-until').value = '2000-01-01';          // в прошлом
  app.FORMS['deal-reserve']({ dataset: { id: d.id, i: String(i) } });
  assert.ok(el(app, 'dr-err').textContent.includes('прошлом'));
  set(2);
  app.FORMS['deal-reserve']({ dataset: { id: d.id, i: String(i) } });
  assert.equal(S.reserves.length, n + 1);
  assert.deepEqual([S.reserves[n].dealId, S.reserves[n].productId, S.reserves[n].qty], [d.id, it.productId, 2]);
  assert.equal(Stock.summary(S, it.productId, new Date()).free, free - 2, 'свободный остаток не уменьшился');
  const body = app.DRAWERS.deal(d.id).body;
  assert.ok(body.includes('data-act="deal-unres"') && body.includes('в резерве по сделке: 2'));
  app.A['deal-unres']({ dataset: { id: d.id, rid: S.reserves[n].id } });
  assert.equal(S.reserves.length, n);
  assert.equal(Stock.summary(S, it.productId, new Date()).free, free);
});

test('КП: клиент, строки, итог, менеджер, дата; реквизиты фирмы и срок действия — «нет данных»; без права «цены» КП недоступно', () => {
  const app = load();
  asRole(app, 'director');
  const d = app.S.deals.find(x => x.items.length >= 3 && x.items.some(i => i.price === null) && x.managerId);
  const html = app.MODALS.dealKp(d.id);
  assert.ok(html.includes('нет данных: реквизиты фирмы') && html.includes('нет данных: срок действия'), 'нет заглушек «нет данных: …»');
    assert.ok(html.includes(`<b>${money(byHand(d))}</b>`), 'в КП нет итога сделки');
  assert.ok(html.includes(app.esc(d.client)) && html.includes(app.esc(app.S.people.find(p => p.id === d.managerId).name)), 'нет клиента или менеджера');
  for (const it of d.items) assert.ok(html.includes(app.esc(app.Deals.itemName(app.S, it))), 'нет строки ' + it.productId);
  assert.ok(html.includes('нет данных: цена') && html.includes('В итог не вошли строки без цены'), 'строка без цены не названа');
  assert.ok(html.includes('data-act="deal-print"') && html.includes('id="kp-logo"'));
  assert.ok(/\d{4} г\./.test(html), 'нет даты');
  // кнопка в карточке; без права «цены» (инженер) КП нет
  assert.ok(app.DRAWERS.deal(d.id).body.includes(`data-act="deal-kp" data-id="${d.id}"`));
  asRole(app, 'engineer');
  assert.ok(!app.MODALS.dealKp(d.id).includes('class="kp"'), 'инженеру без цен открылось КП');
  assert.ok(!app.DRAWERS.deal(d.id).body.includes('data-act="deal-kp"'));
  // печатается только КП: в печатном CSS скрыто всё, кроме окна
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'css', '56-deals.css'), 'utf8');
  const print = css.slice(css.indexOf('@media print'));
  assert.ok(/\.app[^{]*\{[^}]*display:\s*none/.test(print) && print.includes('#modal-root .modal-wrap'), 'печатный CSS не прячет всё, кроме КП');
});

test('«Новая сделка»: окно с поиском клиента и новым клиентом; тип — только доступные; менеджер по умолчанию я; создание через форму ставит сделку на этап колонки', () => {
  const app = load();
  const mgr = asRole(app, 'managerB2c');
  let m = app.MODALS.dealNew('');
  assert.ok(m.includes('name="dn-c" value="new"') && m.includes('data-on="deal-cq"') && m.includes('id="dn-cname"'), 'нет поиска клиента или нового клиента');
  assert.ok(m.includes('<option value="b2c" selected>B2C</option>') && !m.includes('value="b2b"'), 'менеджеру B2C предложен тип B2B');
  assert.ok(m.includes(`<option value="${mgr.id}" selected>${mgr.name} (я)</option>`), 'менеджер по умолчанию — не я');
  // поиск клиента: найден по куску названия и по телефону, в формате радио
  const c = app.S.clients[0], hit = app.dealClientOpts(c.name.slice(0, 6), '');
  assert.ok(hit.includes(`value="${c.id}"`) && hit.includes(' checked'), 'клиент не найден поиском');
  assert.ok(app.dealClientOpts('zzzzzz-нет-такого', '').includes('Такого клиента нет'));
  // форма: новый клиент + сделка на втором этапе
  asRole(app, 'director');
  const set = (id, v) => { el(app, id).value = v; };
  set('dn-type', 'b2b'); set('dn-cname', 'ООО „Пример-Новый“'); set('dn-email', ''); set('dn-inn', '0000000999');
  set('dn-phone', '+7 900 000-99-99'); set('dn-contact', 'Пётр'); set('dn-obj', 'Станция для склада'); set('dn-ch', 'max'); set('dn-mgr', 'p3');
  const nd = app.S.deals.length, nc = app.S.clients.length;
  app.FORMS['deal-new']({ dataset: { stage: 'calc' } });
  assert.equal(app.S.clients.length, nc + 1);
  assert.equal(app.S.deals.length, nd + 1);
  const d = app.S.deals[app.S.deals.length - 1], cl = app.S.clients[app.S.clients.length - 1];
  assert.deepEqual([d.client, d.clientId, d.type, d.stageId, d.managerId, d.contact, d.phone, d.object, d.channel],
    ['ООО „Пример-Новый“', cl.id, 'b2b', 'calc', 'p3', 'Пётр', '+7 900 000-99-99', 'Станция для склада', 'max']);
  assert.deepEqual([cl.kind, cl.inn], ['company', '0000000999']);
  assert.deepEqual(Array.from(app.Feed.of(app.S, { t: 'deal', id: d.id }), e => e.kind), ['stage', 'create']);
  assert.equal(app.S.ui.drawer && app.S.ui.drawer.id, d.id, 'после создания карточка не открылась');
  // без имени нового клиента — отказ, ничего не создано
  set('dn-cname', '  ');
  app.FORMS['deal-new']({ dataset: { stage: '' } });
  assert.ok(el(app, 'dn-err').textContent.includes('имя клиента') && app.S.deals.length === nd + 1 && app.S.clients.length === nc + 1);
});

test('«Сделок в работе» на главной: сумма по Deals.total (строки со скидкой), проваленные не считаются', () => {
  const app = load();
  asRole(app, 'director');
  const open = app.S.deals.filter(d => !app.isDone(d) && !d.lostReason);
  assert.ok(app.S.deals.some(d => d.lostReason) && open.some(d => d.items.length), 'в демо нет нужных сделок');
  const sum = open.reduce((s, d) => s + byHand(d), 0);
  const want = sum >= 1e6 ? (sum / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' млн ₽' : money(sum);
  const html = app.kpiHtml();
  assert.ok(html.includes(`<b class="k-v">${open.length}</b><span class="k-s ">на ${want}`), `на главной не «${open.length}» сделок «на ${want}»`);
  assert.ok(html.includes('data-view="deals"'));
});
