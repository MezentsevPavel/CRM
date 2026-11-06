'use strict';
// Продажа от юрлица и счёт между юрлицами (просьба директора после сборки): «менеджер B2B продаёт от Виндсолар, а товар на
// НПП — надо запрашивать счёт от своей Виндсолар у НПП»; «по умолчанию B2B продаёт от Виндсолар, B2C — от ИП Нелюбин».
// Ожидаемое — из этих слов и чисел, разобранных руками (в клетке «НПП, Иркутск» 40, в резерве 5 — свободно 35), а не из кода.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { load } = require('./load.js');
const kit = require('./server-kit.js');

const NOW = new Date(2026, 10, 1, 12, 0);
const later = n => new Date(NOW.getTime() + n * 60000);
const plain = x => JSON.parse(JSON.stringify(x));

const PIPE = () => ({ id: 'dispatch', kind: 'dispatch', name: 'Отправки', stages: [
  { id: 'new', name: 'Новая' }, { id: 'picking', name: 'Собирается' }, { id: 'ready', name: 'Готова к отправке' },
  { id: 'onWay', name: 'В пути' }, { id: 'delivered', name: 'Доставлена', flag: 'final' }, { id: 'cancelled', name: 'Отменена', flag: 'final' },
] });
// Фирма: директор dir, менеджер B2B mgr, менеджер B2C mgrc, логист log, бухгалтер acc (роль без типа). Юрлица ИП, НПП, ВС.
// Панель pv: «ВС, Иркутск» 12, «НПП, Иркутск» 40 (из них 5 под резервом сделки), «НПП, Москва» 7. Инвертор inv: «ИП, Москва» 5.
// Кабель cab: остатка нет.
function world(app, over = {}) {
  const base = app.Stock.defaults();
  const roles = app.Perms.defaultRoles();
  const people = [['dir', 'director', 'mgmt'], ['mgr', 'managerB2b', 'sales'], ['mgrc', 'managerB2c', 'sales'], ['log', 'logist', 'logistics'], ['acc', 'engineer', 'mgmt']]
    .map(([id, role, dept]) => ({ id, name: 'Сотрудник ' + id, role, dept, demo: true }));
  return Object.assign({
    v: 3, entities: base.entities, cities: base.cities, roles, people,
    depts: [{ id: 'mgmt', name: 'Руководство' }, { id: 'sales', name: 'Продажи' }, { id: 'logistics', name: 'Логистика' }],
    pipelines: [...app.Pipes.defaults(), PIPE()],
    products: [{ id: 'pv', name: 'Панель тестовая' }, { id: 'inv', name: 'Инвертор тестовый' }, { id: 'cab', name: 'Кабель тестовый' }],
    stock: { pv: { vs: { irk: 12 }, npp: { irk: 40, msk: 7 } }, inv: { ip: { msk: 5 } } },
    reserves: [{ id: 'r1', productId: 'pv', qty: 5, entityId: 'npp', cityId: 'irk', src: 'stock', dealId: 'Д-1' }],
    aside: {}, moves: [], shipments: [], dispatches: [], feed: [], notes: [], deals: [], tasks: [], prefs: { notify: {} },
    billing: { seller: { b2b: 'vs', b2c: 'ip' } },
  }, over);
}
const NPP_IRK = { entityId: 'npp', cityId: 'irk' }, VS_IRK = { entityId: 'vs', cityId: 'irk' }, IP_MSK = { entityId: 'ip', cityId: 'msk' };
const sale = (over = {}) => ({
  purpose: 'sale', seller: 'vs', to: { name: 'Клиент-пример 1', phone: '+7 900 000-00-01' }, address: 'г. Иркутск, ул. Примерная, 1 (пример)',
  when: { date: '2026-11-05' }, items: [{ productId: 'pv', qty: 3, from: NPP_IRK }], ...over,
});
const make = (app, st, data, by = 'mgr') => { const r = app.Dispatch.create(st, data, by, NOW); assert.equal(r.ok, true, r.reason); return r.id; };
const ask = (app, st, id, owner = 'npp', by = 'mgr', n = 1) => { const r = app.Dispatch.requestBill(st, id, owner, by, later(n)); assert.equal(r.ok, true, r.reason); return r.task; };
const bills = (st, id) => st.tasks.filter(t => t.bill && t.bill.dispatchId === id);
const done = (app, st, t) => app.Pipes.isFinal(st, t.boardId, t.stageId);

// ——— продавец и клетка по умолчанию ———
test('продавец по умолчанию: менеджер B2B — ВС, B2C — ИП; директор и роль без типа — пусто; соответствие берётся из настроек', () => {
  const app = load(), st = world(app), { Dispatch } = app;
  assert.equal(Dispatch.defaultSeller(st, 'mgr'), 'vs');
  assert.equal(Dispatch.defaultSeller(st, 'mgrc'), 'ip');
  assert.equal(Dispatch.defaultSeller(st, 'dir'), '');
  assert.equal(Dispatch.defaultSeller(st, 'acc'), '');
  // директор поменял в «Складах и юрлицах» — B2B теперь от НПП; юрлица нет в справочнике — пусто, а не выдуманное
  st.billing.seller = { b2b: 'npp', b2c: 'нет-такого' };
  assert.equal(Dispatch.defaultSeller(st, 'mgr'), 'npp');
  assert.equal(Dispatch.defaultSeller(st, 'mgrc'), '');
  // в новой базе соответствие уже заведено: B2B — ВС, B2C — ИП
  assert.deepEqual(plain(app.seedBase().billing), { seller: { b2b: 'vs', b2c: 'ip' } });
});

test('клетки товара и клетка строки по умолчанию: свободное без резерва, нули не показываются; сначала юрлицо продавца', () => {
  const app = load(), st = world(app), { Dispatch, Stock } = app;
  // НПП, Иркутск: 40 − 5 в резерве = 35; ВС, Иркутск: 12; НПП, Москва: 7 — по убыванию свободного
  assert.deepEqual(plain(Stock.cells(st, 'pv')), [{ entityId: 'npp', cityId: 'irk', free: 35 }, { entityId: 'vs', cityId: 'irk', free: 12 }, { entityId: 'npp', cityId: 'msk', free: 7 }]);
  assert.deepEqual(plain(Stock.cells(st, 'cab')), []);
  // продавец ВС: его клетка, хоть у НПП больше; продавец ИП (у него панели нет) — где больше всего свободного
  assert.deepEqual(plain(Dispatch.defaultFrom(st, 'pv', 'vs')), VS_IRK);
  assert.deepEqual(plain(Dispatch.defaultFrom(st, 'pv', 'ip')), NPP_IRK);
  assert.deepEqual(plain(Dispatch.defaultFrom(st, 'pv', '')), NPP_IRK);
  assert.equal(Dispatch.defaultFrom(st, 'cab', 'vs'), null);
  // bestCell — та же первая клетка
  assert.deepEqual(plain(Stock.bestCell(st, 'pv')), NPP_IRK);
});

// ——— запрос счёта ———
test('строка из клетки чужого юрлица: без подтверждения задачи нет — «не запрошен»; «Запросить» — одна задача директору с перечнем и номером заявки', () => {
  const app = load(), st = world(app), { Dispatch } = app;
  const id = make(app, st, sale({ items: [{ productId: 'pv', qty: 3, from: NPP_IRK }, { productId: 'pv', qty: 2, from: { entityId: 'npp', cityId: 'msk' } }, { productId: 'pv', qty: 1, from: VS_IRK }] }));
  const d = Dispatch.byId(st, id);
  assert.equal(d.seller, 'vs');
  assert.deepEqual(plain(d.items.map(i => i.from)), [NPP_IRK, { entityId: 'npp', cityId: 'msk' }, VS_IRK]);
  // сохранение заявки задачу не ставит: в карточке «не запрошен», вопрос формы — «Запросить счёт для ВС от НПП?»
  assert.equal(st.tasks.length, 0, 'задача поставлена без подтверждения');
  assert.deepEqual(plain(Dispatch.billView(st, d).map(b => [b.pair, b.state, b.text, b.ask, b.question])),
    [['НПП → ВС', 'none', 'не запрошен', true, 'Запросить счёт для ВС от НПП?']]);
  // «Запросить» — одна задача на пару; кто выставляет счета не выбран — директору
  const t = ask(app, st, id);
  assert.equal(bills(st, id).length, 1);
  assert.equal(t.title, 'Выставить счёт: НПП → ВС');
  assert.deepEqual(plain(t.to), { t: 'p', id: 'dir' });
  assert.equal(t.from, 'mgr');
  assert.deepEqual(plain(t.bill), { dispatchId: id, owner: 'npp', seller: 'vs' });
  assert.match(t.desc, new RegExp(`^Заявка на отправку ${id} \\(Клиент-пример 1\\)`));
  assert.ok(t.desc.includes('Панель тестовая — 3 (склад НПП, Иркутск); Панель тестовая — 2 (склад НПП, Москва)'), t.desc);
  assert.ok(!t.desc.includes('— 1 '), 'строка со склада самого продавца в счёт не входит');
  assert.equal(done(app, st, t), false);
  // исполнителю — уведомление со ссылкой на задачу; в ленте заявки — запись о запросе; второй раз — отказ
  const n = st.notes.find(x => x.kind === 'task' && x.ref && x.ref.id === t.id);
  assert.ok(n && n.to.includes('dir') && n.text.includes(id), 'исполнителю нет уведомления');
  assert.ok(st.feed.some(e => e.ref.id === id && e.text.startsWith('Запрошен счёт НПП → ВС')));
  assert.equal(Dispatch.requestBill(st, id, 'npp', 'mgr', later(2)).ok, false);
  assert.equal(bills(st, id).length, 1);
  // карточка: «запрошен», задача сделана — «выставлен»
  assert.equal(Dispatch.billView(st, d)[0].state, 'asked');
  assert.match(Dispatch.billView(st, d)[0].text, /^запрошен \(задача на этапе «Новые», исполнитель Сотрудник dir\)$/);
  t.stageId = 'done';
  assert.deepEqual([Dispatch.billView(st, d)[0].state, Dispatch.billView(st, d)[0].text], ['done', 'выставлен (задача сделана)']);
  // запросить может автор и тот, кто ведёт отправки; другой менеджер — нет
  st.people.push({ id: 'mgr2', name: 'Сотрудник mgr2', role: 'managerB2b', dept: 'sales' });
  const id2 = make(app, st, sale());
  assert.equal(Dispatch.requestBill(st, id2, 'npp', 'mgr2', later(3)).ok, false);
  assert.equal(Dispatch.requestBill(st, id2, 'npp', 'log', later(3)).ok, true);
});

test('кто выставляет счета — выбранный в настройках сотрудник; две строки двух чужих юрлиц — два вопроса и две задачи; своя клетка — вопроса нет', () => {
  const app = load(), st = world(app), { Dispatch } = app;
  st.billing.billerId = 'acc';
  const two = make(app, st, sale({ items: [{ productId: 'pv', qty: 3, from: NPP_IRK }, { productId: 'inv', qty: 1, from: IP_MSK }] }));
  assert.deepEqual(plain(Dispatch.billView(st, Dispatch.byId(st, two)).map(b => b.question).sort()), ['Запросить счёт для ВС от ИП?', 'Запросить счёт для ВС от НПП?']);
  ask(app, st, two, 'npp'); ask(app, st, two, 'ip');
  const ts = bills(st, two);
  assert.deepEqual(ts.map(t => [t.title, t.to.id]).sort(), [['Выставить счёт: ИП → ВС', 'acc'], ['Выставить счёт: НПП → ВС', 'acc']]);
  assert.ok(ts.find(t => t.bill.owner === 'ip').desc.includes('Инвертор тестовый — 1 (склад ИП, Москва)'));
  // выбранного сотрудника больше нет — директору
  st.billing.billerId = 'нет-такого';
  assert.equal(Dispatch.billPlan(st, Dispatch.byId(st, two))[0].to.id, 'dir');
  // своя клетка, клетка «нет данных: юрлицо», своя строка текстом и заявка без продавца — счёта не требуют
  for (const data of [sale({ items: [{ productId: 'pv', qty: 2, from: VS_IRK }, { text: 'Документы (пример)', qty: 1 }] }),
    sale({ items: [{ productId: 'pv', qty: 2, from: { entityId: '_', cityId: '_' } }] }), sale({ seller: '', items: [{ productId: 'pv', qty: 2, from: NPP_IRK }] })]) {
    const id = make(app, st, data);
    assert.deepEqual(plain(Dispatch.billView(st, Dispatch.byId(st, id))), [], JSON.stringify(data.items));
    assert.equal(Dispatch.requestBill(st, id, 'npp', 'mgr', later(1)).ok, false);
  }
  // перемещение продавца и клеток строк не держит
  const tr = make(app, st, { ...sale(), purpose: 'transfer', from: NPP_IRK, toCell: VS_IRK, address: '' }, 'log');
  assert.equal(Dispatch.byId(st, tr).seller, undefined);
  assert.equal(Dispatch.byId(st, tr).items[0].from, undefined);
  assert.equal(st.tasks.length, 2);
});

test('правка заявки: количество — новый перечень в задаче; чужую строку убрали — задача снята; вернули — снова «не запрошен», запрос открывает ту же задачу', () => {
  const app = load(), st = world(app), { Dispatch } = app;
  const id = make(app, st, sale({ items: [{ productId: 'pv', qty: 3, from: NPP_IRK }, { productId: 'pv', qty: 1, from: VS_IRK }] }));
  const t = ask(app, st, id);
  // количество 3 → 4: та же задача, новый перечень
  assert.equal(Dispatch.update(st, id, { items: [{ productId: 'pv', qty: 4, from: NPP_IRK }, { productId: 'pv', qty: 1, from: VS_IRK }] }, 'mgr', later(1)).ok, true);
  assert.equal(bills(st, id).length, 1);
  assert.ok(t.desc.includes('Панель тестовая — 4 (склад НПП, Иркутск)'), t.desc);
  // строку с НПП убрали — задача снята: пометка и «готово», исполнителю уведомление
  assert.equal(Dispatch.update(st, id, { items: [{ productId: 'pv', qty: 1, from: VS_IRK }] }, 'mgr', later(2)).ok, true);
  assert.equal(t.dropped, 'в заявке больше нет этого товара на продажу от этого юрлица');
  assert.equal(done(app, st, t), true);
  assert.ok(st.notes.some(n => n.ref && n.ref.id === t.id && n.text.startsWith(`Задача «${t.title}» снята`) && n.to.includes('dir')));
  assert.deepEqual(plain(Dispatch.billView(st, Dispatch.byId(st, id)).map(b => b.state)), ['dropped']);
  // вернули — сама задача не открывается: «не запрошен»; запрос — та же задача, на первом этапе, без пометки
  assert.equal(Dispatch.update(st, id, { items: [{ productId: 'pv', qty: 2, from: NPP_IRK }] }, 'mgr', later(3)).ok, true);
  assert.equal(done(app, st, t), true);
  assert.deepEqual(plain(Dispatch.billView(st, Dispatch.byId(st, id)).map(b => b.state)), ['none']);
  assert.equal(ask(app, st, id, 'npp', 'mgr', 4), t);
  assert.equal(bills(st, id).length, 1);
  assert.equal(t.dropped, undefined);
  assert.equal(done(app, st, t), false);
  // продавец ВС → ИП: пара НПП → ВС снята, НПП → ИП не запрошена
  assert.equal(Dispatch.update(st, id, { seller: 'ip' }, 'mgr', later(5)).ok, true);
  assert.deepEqual(plain(Dispatch.billView(st, Dispatch.byId(st, id)).map(b => [b.pair, b.state])), [['НПП → ИП', 'none'], ['НПП → ВС', 'dropped']]);
});

test('отмена заявки закрывает задачу с пометкой «заявка отменена»; уже выставленный счёт — пометка, что выставлен', () => {
  const app = load(), st = world(app), { Dispatch } = app;
  const id = make(app, st, sale());
  const t = ask(app, st, id);
  assert.equal(Dispatch.setStage(st, id, 'cancelled', 'mgr', later(1)).ok, true);
  assert.equal(t.dropped, 'заявка отменена');
  assert.equal(done(app, st, t), true);
  assert.equal(Dispatch.billView(st, Dispatch.byId(st, id))[0].text, 'снят: заявка отменена');
  // счёт по второй заявке успели выставить, потом заявку отменили
  const id2 = make(app, st, sale());
  const t2 = ask(app, st, id2);
  t2.stageId = 'done';
  assert.equal(Dispatch.setStage(st, id2, 'cancelled', 'mgr', later(2)).ok, true);
  assert.equal(t2.dropped, 'заявка отменена (счёт к этому времени уже выставлен)');
});

test('списание при продаже без указания клетки берёт клетку строки', () => {
  const app = load(), st = world(app), { Dispatch, Stock } = app;
  const id = make(app, st, sale({ items: [{ productId: 'pv', qty: 3, from: { entityId: 'npp', cityId: 'msk' } }] }));
  const r = Dispatch.sell(st, id, 0, null, 'mgr', later(1));
  assert.equal(r.ok, true, r.reason);
  // «НПП, Москва»: было 7, ушло 3 — стало 4; остальные клетки те же
  assert.equal(Stock.grid(st, 'pv').cell('npp', 'msk'), 4);
  assert.equal(Stock.grid(st, 'pv').cell('npp', 'irk'), 40);
  assert.equal(Stock.grid(st, 'pv').cell('vs', 'irk'), 12);
  assert.deepEqual(plain([Dispatch.byId(st, id).items[0].sold.entityId, Dispatch.byId(st, id).items[0].sold.cityId]), ['npp', 'msk']);
  // явно названная клетка сильнее клетки строки
  const id2 = make(app, st, sale({ items: [{ productId: 'pv', qty: 2, from: { entityId: 'npp', cityId: 'msk' } }] }));
  assert.equal(Dispatch.sell(st, id2, 0, VS_IRK, 'mgr', later(2)).ok, true);
  assert.equal(Stock.grid(st, 'pv').cell('vs', 'irk'), 10);
  assert.equal(Stock.grid(st, 'pv').cell('npp', 'msk'), 4);
});

// ——— права на сервере (Guard) ———
function batch(a, st, fn) {
  const docs = a.Docs.split(st);
  const st0 = a.Docs.join(docs);
  fn(st);
  return { st0, changes: a.Docs.diff(docs, a.Docs.split(st)) };
}
const check = (a, b, pid) => a.Guard.check(b.st0, pid, b.changes, NOW);

test('Guard: «Запросить» проходит у автора заявки без права «ставить задачи другим отделам»; правка логиста снимает задачу; подделку — нет', () => {
  const a = load({ now: NOW }), st = world(a);
  for (const r of st.roles) if (r.id === 'managerB2b' || r.id === 'logist') r.perms.tasksAssign = false;
  assert.equal(a.Perms.can(st, 'mgr', 'tasksAssign'), false);
  let id;
  const saved = batch(a, st, s => { id = make(a, s, sale()); });
  assert.ok(!saved.changes.some(c => c.key === 'tasks'), 'сохранение заявки поставило задачу');
  // «Запросить» — отдельное действие: задача, уведомление, лента
  const made = batch(a, st, s => { ask(a, s, id); });
  assert.deepEqual([...new Set(made.changes.map(c => c.key))].sort(), ['feed', 'notes', 'tasks']);
  assert.equal(check(a, made, 'mgr'), null, 'запрос счёта не прошёл');
  // та же задача, но с другим текстом или другому человеку — отказ; запрос чужой заявки другим менеджером — отказ
  const forged = JSON.parse(JSON.stringify(made.changes), a.Store.revive);
  forged.find(c => c.key === 'tasks').data.desc = 'Выставить счёт на всё (подделка)';
  assert.match(check(a, { st0: made.st0, changes: forged }, 'mgr').text, /^Нет прав: ставить задачи другому отделу/);
  const toLog = JSON.parse(JSON.stringify(made.changes), a.Store.revive);
  toLog.find(c => c.key === 'tasks').data.to = { t: 'p', id: 'log' };
  assert.ok(check(a, { st0: made.st0, changes: toLog }, 'mgr'), 'задача не тому прошла');
  st.people.push({ id: 'mgr2', name: 'Сотрудник mgr2', role: 'managerB2b', dept: 'sales' });
  const other = JSON.parse(JSON.stringify(made.changes), a.Store.revive).map(c => (c.data && c.data.from === 'mgr' ? { ...c, data: { ...c.data, from: 'mgr2' } } : c.data && c.data.by === 'mgr' ? { ...c, data: { ...c.data, by: 'mgr2' } } : c));
  const st0b = a.Docs.join(a.Docs.split(made.st0)); st0b.people.push({ id: 'mgr2', name: 'Сотрудник mgr2', role: 'managerB2b', dept: 'sales' });
  assert.ok(a.Guard.check(st0b, 'mgr2', other, NOW), 'чужой менеджер запросил счёт по чужой заявке');
  // логист (право dispatch, задачу на доске не видит) убирает чужую строку — задача снимается его же пачкой
  const dropped = batch(a, st, s => { assert.equal(a.Dispatch.update(s, id, { items: [{ productId: 'pv', qty: 1, from: VS_IRK }] }, 'log', later(1)).ok, true); });
  assert.ok(dropped.changes.some(c => c.key === 'tasks'));
  assert.equal(a.Visible.task(st, bills(st, id)[0], 'log'), false, 'логист видит задачу на доске');
  assert.equal(a.Visible.taskSeen(st, bills(st, id)[0], 'log'), true, 'логисту задача не приходит в данных');
  assert.equal(check(a, dropped, 'log'), null, 'снятие задачи правкой заявки не прошло');
  // снять задачу без правки заявки и просто сдвинуть чужую задачу логист не может
  const raw = batch(a, st, s => { const t = bills(s, id)[0]; t.dropped = 'просто так'; });
  assert.ok(check(a, raw, 'log'), 'пометка «снята» без заявки прошла');
  const close = batch(a, st, s => { bills(s, id)[0].stageId = 'work'; });
  assert.ok(check(a, close, 'log'), 'логист сдвинул чужую задачу');
});

test('сервер: менеджер B2B без права ставить задачи другим отделам — заявка с товаром НПП без задачи, «Запросить» — задача у директора одной пачкой', async () => {
  const srv = await kit.start();
  const core = load({ globals: { CRM_SERVER: 1 } });
  // как у браузера (72-server.js): номера Д-, ОТ- … — свои, прочие id — уникальные на сеанс
  let k = 0;
  core.Ids.use(p => (/-$/.test(p) ? null : p + 'x' + (++k)));
  const live = st => { const x = JSON.parse(JSON.stringify(st), core.Store.revive); delete x.seq; delete x.view; return x; };
  const send = async (cookie, fn) => {
    const st = live(await kit.state(srv, cookie));
    const docs = core.Docs.split(st);
    fn(st);
    return kit.changes(srv, cookie, core.Docs.diff(docs, core.Docs.split(st)));
  };
  try {
    const boss = await kit.director(srv);
    const max = await kit.employee(srv, boss, { id: 'p3', name: 'Максим (тест)', role: 'managerB2b', dept: 'sales' });
    const pid = (await kit.state(srv, boss.cookie)).products[0].id;
    // директор снимает у менеджеров B2B право «ставить задачи другим отделам» и принимает 40 штук на «НПП, Иркутск»
    let r = await send(boss.cookie, st => {
      st.roles.find(x => x.id === 'managerB2b').perms.tasksAssign = false;
      assert.equal(core.Stock.move(st, { kind: 'Приход', productId: pid, qty: 40, entityId: 'npp', cityId: 'irk', doc: 'П-1', by: boss.pid, at: new Date(kit.T0) }).ok, true);
    });
    assert.equal(r.status, 200, r.text);
    // менеджер: продавец по умолчанию — ВС, клетка — «НПП, Иркутск» (у ВС товара нет); сохранение — без задачи
    let id;
    r = await send(max.cookie, st => {
      const seller = core.Dispatch.defaultSeller(st, 'p3');
      assert.equal(seller, 'vs');
      const from = core.Dispatch.defaultFrom(st, pid, seller);
      assert.deepEqual(plain(from), NPP_IRK);
      const made = core.Dispatch.create(st, sale({ seller, items: [{ productId: pid, qty: 3, from }] }), 'p3', new Date(kit.T0));
      assert.equal(made.ok, true, made.reason);
      id = made.id;
    });
    assert.equal(r.status, 200, r.text);
    assert.equal((await kit.state(srv, boss.cookie)).tasks.length, 0, 'задача без подтверждения');
    // «Запросить»
    r = await send(max.cookie, st => {
      const q = core.Dispatch.requestBill(st, id, 'npp', 'p3', new Date(kit.T0 + 60e3));
      assert.equal(q.ok, true, q.reason);
    });
    assert.equal(r.status, 200, r.text);
    const all = await kit.state(srv, boss.cookie);
    const ts = all.tasks.filter(t => t.bill && t.bill.dispatchId === id);
    assert.equal(ts.length, 1);
    assert.deepEqual([ts[0].title, ts[0].to.id, ts[0].from], ['Выставить счёт: НПП → ВС', boss.pid, 'p3']);
    assert.ok(all.notes.some(n => n.kind === 'task' && n.to.includes(boss.pid) && n.ref && n.ref.id === ts[0].id), 'директору нет уведомления');
    // одной пачкой: задача, уведомление и лента — один номер правки в журнале
    const db = new DatabaseSync(path.join(srv.dir, 'crm.db'), { readOnly: true });
    try {
      const rows = db.prepare("SELECT DISTINCT seq, key FROM log WHERE personId = 'p3' AND seq = (SELECT MAX(seq) FROM log WHERE personId = 'p3')").all();
      assert.deepEqual(rows.map(x => x.key).sort(), ['feed', 'notes', 'tasks'], JSON.stringify(rows));
    } finally { db.close(); }
  } finally { await srv.stop(); }
});

test('сервер: база ревизии 16 доводится до текущей (шаг 17) — появляется продавец по умолчанию (B2B — ВС, B2C — ИП), кто выставляет счета — не выбран', async () => {
  const srv = await kit.start();
  const dir = srv.dir;
  await kit.director(srv);
  await srv.stop(true);
  const file = path.join(dir, 'crm.db');
  const d = new DatabaseSync(file);
  d.prepare("DELETE FROM docs WHERE key = 'billing'").run();
  d.prepare("UPDATE meta SET v = '16' WHERE k = 'rev'").run();
  d.close();
  const again = await kit.start({ dataDir: dir });
  try {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      assert.equal(db.prepare("SELECT v FROM meta WHERE k = 'rev'").get().v, String(load().Store.REV));
      assert.deepEqual(JSON.parse(db.prepare("SELECT data FROM docs WHERE key = 'billing'").get().data), { seller: { b2b: 'vs', b2c: 'ip' } });
    } finally { db.close(); }
  } finally { await again.stop(); }
});

// ——— форма заявки ———
test('форма новой заявки у менеджера B2B: «Продаём от» — ВС, строка с панелью — клетка ВС; смена продавца подбирает клетку заново, выбор руками — нет', () => {
  const app = load(), { S, Dispatch } = app;
  const mgr = S.people.find(p => p.role === 'managerB2b');
  app.setMe(mgr.id);
  // товар, который лежит больше чем в одной клетке, хотя бы в одной — у ВС
  const p = S.products.find(x => app.Stock.cells(S, x.id).length > 1 && app.Stock.cells(S, x.id).some(c => c.entityId === 'vs'))
    || S.products.find(x => app.Stock.cells(S, x.id).length > 1);
  assert.ok(p, 'в демо нет товара в двух клетках');
  app.openDispatchNew();
  const x = S.ui.dspDraft;
  assert.equal(x.seller, 'vs');
  app.A['dsp-add']({ dataset: { pid: p.id } });
  assert.deepEqual(plain(x.items[0].from), plain(Dispatch.defaultFrom(S, p.id, 'vs')));
  const html = app.dspItemsHtml(x);
  assert.ok(html.includes('data-on="dsp-src"'), 'нет выбора «Откуда»');
  for (const c of app.Stock.cells(S, p.id)) assert.ok(html.includes(`${app.Stock.entityName(S, c.entityId)}, ${app.Stock.cityName(S, c.cityId)} — свободно`), 'клетка не показана');
  // другой продавец — клетка подобрана под него; выбранная руками клетка остаётся
  app.ON.change['dsp-seller']({ value: 'npp', dataset: {} });
  assert.deepEqual(plain(x.items[0].from), plain(Dispatch.defaultFrom(S, p.id, 'npp')));
  const other = app.Stock.cells(S, p.id).find(c => c.entityId !== 'npp') || app.Stock.cells(S, p.id)[1];
  app.ON.change['dsp-src']({ value: `${other.entityId}|${other.cityId}`, dataset: { i: '0' } });
  app.ON.change['dsp-seller']({ value: 'ip', dataset: {} });
  assert.deepEqual(plain(x.items[0].from), { entityId: other.entityId, cityId: other.cityId });
});

test('форма: после сохранения заявки с товаром чужого юрлица — вопрос «Запросить счёт для ВС от …?»; «Не сейчас» — задачи нет, в карточке кнопка; «Запросить» — задача исполнительному директору (пример)', () => {
  const app = load(), { S, Dispatch } = app;
  const fill = values => { for (const [k, v] of Object.entries(values)) app.document.getElementById(k).value = v; };
  const mgr = S.people.find(p => p.role === 'managerB2b');
  app.setMe(mgr.id);
  // в демо счета выставляет «Исполнительный директор (пример)»
  const exec = S.people.find(p => p.id === S.billing.billerId);
  assert.equal(exec && exec.name, 'Исполнительный директор (пример)');
  // товар, свободный только у чужого (не ВС) юрлица
  const p = S.products.find(x => { const c = app.Stock.cells(S, x.id); return c.length && c.every(y => y.entityId !== 'vs' && y.entityId !== '_'); });
  assert.ok(p, 'в демо нет товара на чужом юрлице');
  const owner = app.Stock.cells(S, p.id)[0].entityId;
  app.openDispatchNew();
  app.A['dsp-add']({ dataset: { pid: p.id } });
  assert.ok(app.dspItemsHtml(S.ui.dspDraft).includes('после сохранения CRM предложит запросить счёт'), 'нет пометки о чужом юрлице');
  fill({ 'dsp-name': 'Клиент-пример 78', 'dsp-phone': '+7 900 000-00-78', 'dsp-address': 'г. Иркутск, ул. Примерная, 78 (пример)', 'dsp-date': '2026-11-05', 'dsp-from': '', 'dsp-till': '', 'dsp-note': '' });
  const t0 = S.tasks.length;
  app.FORMS.dispatch({ dataset: {} });
  const d = S.dispatches[S.dispatches.length - 1];
  assert.equal(d.seller, 'vs');
  assert.equal(S.tasks.length, t0, 'задача без подтверждения');
  // окно-вопрос
  assert.equal(S.ui.modal && S.ui.modal.type, 'dspBill');
  const q = `Запросить счёт для ${app.Stock.entityName(S, 'vs')} от ${app.Stock.entityName(S, owner)}?`;
  assert.ok(app.MODALS.dspBill(d.id).includes(q), 'нет вопроса ' + q);
  assert.ok(app.MODALS.dspBill(d.id).includes('Не сейчас'));
  // «Не сейчас»
  app.A['close-modal']();
  assert.equal(S.tasks.length, t0);
  const card = () => app.DRAWERS.dispatch(d.id).body;
  assert.ok(card().includes('не запрошен') && card().includes('data-act="dsp-bill"'), 'в карточке нет «не запрошен» и кнопки');
  // «Запросить счёт» из карточки
  app.A['dsp-bill']({ dataset: { id: d.id, owner } });
  const t = S.tasks.find(x => x.bill && x.bill.dispatchId === d.id);
  assert.ok(t, 'задачи нет');
  assert.equal(t.to.id, exec.id);
  assert.ok(card().includes('запрошен (задача на этапе'), 'карточка не показывает «запрошен»');
  assert.ok(!card().includes('data-act="dsp-bill"'), 'кнопка осталась');
});
