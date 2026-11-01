'use strict';
// Отправки (таск 07, ядро): заявка с пятью обязательными полями, права, уведомления, «собрано N из M»,
// перемещение между складами (товар уходит при «В пути», приходит при «Доставлена»), списание при продаже,
// сохранение файлов заявок, демо-данные. Ожидаемые значения — из таска 07 и историй 79–89 (spec.md): числа
// считаются руками (было 10, ушло 4 — стало 6), а не вызовом кода под тестом.

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.js');

const plain = x => JSON.parse(JSON.stringify(x));
const NOW = new Date(2026, 10, 1, 12, 0);
const later = n => new Date(NOW.getTime() + n * 60000);

// Воронка отправок по умолчанию — как в interfaces.md (проверяется на seed() отдельным тестом).
const PIPE = () => ({ id: 'dispatch', kind: 'dispatch', name: 'Отправки', stages: [
  { id: 'new', name: 'Новая' }, { id: 'picking', name: 'Собирается' }, { id: 'ready', name: 'Готова к отправке' },
  { id: 'onWay', name: 'В пути' }, { id: 'delivered', name: 'Доставлена', flag: 'final' }, { id: 'cancelled', name: 'Отменена', flag: 'final' },
] });

// Маленькое состояние: директор, два менеджера (mgr — автор заявок, mgr2 — нет), логист, кладовщик, два водителя.
// Товар pv — в клетке «ИП, Иркутск» 10, inv — 3.
function world(app, over = {}) {
  const base = app.Stock.defaults();
  const roles = app.Perms.defaultRoles();
  roles.push({ id: 'driver', name: 'Водитель', builtin: true, perms: { dispatch: true } });
  const people = [['dir', 'director'], ['mgr', 'managerB2b'], ['mgr2', 'managerB2b'], ['log', 'logist'], ['wh', 'warehouse'], ['drv', 'driver'], ['drv2', 'driver']]
    .map(([id, role]) => ({ id, name: 'Сотрудник ' + id, role, demo: true }));
  return Object.assign({
    v: 3, entities: base.entities, cities: base.cities, roles, people,
    pipelines: [...app.Pipes.defaults(), PIPE()],
    products: [{ id: 'pv', name: 'Панель тестовая' }, { id: 'inv', name: 'Инвертор тестовый' }],
    stock: { pv: { ip: { irk: 10 } }, inv: { ip: { irk: 3 } } },
    aside: {}, reserves: [], moves: [], shipments: [], dispatches: [], feed: [], notes: [], deals: [], prefs: { notify: {} },
  }, over);
}
const sale = (over = {}) => ({
  purpose: 'sale', to: { name: 'Клиент-пример 1', phone: '+7 900 000-00-01' }, address: 'г. Иркутск, ул. Примерная, 1 (пример)',
  when: { date: '2026-11-05' }, items: [{ productId: 'pv', qty: 2 }], ...over,
});
const IRK = { entityId: 'ip', cityId: 'irk' }, MSK = { entityId: 'ip', cityId: 'msk' };
const transfer = (over = {}) => sale({ purpose: 'transfer', from: IRK, toCell: MSK, address: '', items: [{ productId: 'pv', qty: 4 }], ...over });
const cell = (app, st, pid, c) => app.Stock.grid(st, pid).cell(c.entityId, c.cityId);
// весь товар: во всех клетках плюс в пути (Stock.summary — единственный расчёт)
const balance = (app, st, pid) => { const k = app.Stock.summary(st, pid, NOW); return k.onHand + k.incoming; };
const make = (app, st, data, by = 'mgr') => { const r = app.Dispatch.create(st, data, by, NOW); assert.equal(r.ok, true, r.reason); return r.id; };
const go = (app, st, id, stageId, by = 'log', n = 1) => app.Dispatch.setStage(st, id, stageId, by, later(n));

// ——— Dispatch.create ———
test('Dispatch.create: без получателя, адреса, телефона, даты или списка заявка не сохраняется — missing называет поле', () => {
  const app = load(), { Dispatch } = app;
  const cases = {
    name: sale({ to: { name: '  ', phone: '+7 900 000-00-01' } }),
    address: sale({ address: '' }),
    phone: sale({ to: { name: 'Клиент-пример 1', phone: '' } }),
    date: sale({ when: {} }),
    items: sale({ items: [] }),
  };
  for (const [field, data] of Object.entries(cases)) {
    const st = world(app);
    const r = Dispatch.create(st, data, 'mgr', NOW);
    assert.equal(r.ok, false, `без поля ${field} заявка создалась`);
    assert.deepEqual(plain(r.missing), [field], `missing для ${field}`);
    assert.equal(st.dispatches.length, 0, `без поля ${field} заявка осталась в списке`);
    assert.equal(st.notes.length, 0, `без поля ${field} ушло уведомление`);
    const word = { name: 'получатель', address: 'адрес', phone: 'телефон', date: 'дата', items: 'список' }[field];
    assert.ok(r.reason.startsWith('Не заполнено:') && r.reason.includes(word), r.reason);
  }
  // строка списка с товаром, но без количества, — список не годится; пустая строка формы пропускается
  const st = world(app);
  assert.deepEqual(plain(Dispatch.create(st, sale({ items: [{ productId: 'pv', qty: 0 }] }), 'mgr', NOW).missing), ['items']);
  assert.deepEqual(plain(Dispatch.create(st, sale({ items: [{ productId: 'нет-такого', qty: 1 }] }), 'mgr', NOW).missing), ['items']);
  assert.equal(Dispatch.create(st, sale({ items: [{ text: '', qty: '' }, { text: 'Шнур (пример)', qty: 2 }] }), 'mgr', NOW).ok, true);
  // всё сразу
  const none = Dispatch.create(world(app), { purpose: 'sale' }, 'mgr', NOW);
  assert.deepEqual(plain(none.missing), ['name', 'address', 'phone', 'date', 'items']);
});

test('Dispatch.create: создаёт любой сотрудник; заявка встаёт на первый этап, номер ОТ-NNN, в ленте — «создана»', () => {
  const app = load(), { Dispatch, Feed } = app;
  const st = world(app);
  const id = make(app, st, sale({ when: { date: '2026-11-05', from: '10:00', till: '14:00' }, note: 'Позвонить', dealId: undefined }), 'mgr2');
  assert.equal(id, 'ОТ-001');
  const d = st.dispatches[0];
  assert.equal(d.number, 'ОТ-001');
  assert.equal(d.stageId, 'new');
  assert.equal(d.pipeId, 'dispatch');
  assert.equal(d.by, 'mgr2');
  assert.equal(d.purpose, 'sale');
  assert.deepEqual(plain(d.when), { date: new Date(2026, 10, 5).toISOString(), from: '10:00', till: '14:00' });
  assert.equal(make(app, st, sale()), 'ОТ-002');
  const feed = Feed.of(st, { t: 'dispatch', id });
  assert.equal(feed.length, 1);
  assert.equal(feed[0].kind, 'create');
  // перемещение: адрес — склада-получателя; адреса нет — «нет данных: адрес»
  const t1 = make(app, st, transfer());
  assert.equal(Dispatch.byId(st, t1).address, 'нет данных: адрес');
  st.cities.find(c => c.id === 'msk').address = 'г. Москва, склад-пример';
  const t2 = make(app, st, transfer());
  assert.equal(Dispatch.byId(st, t2).address, 'г. Москва, склад-пример');
  // сделка, которой нет, — отказ
  assert.equal(Dispatch.create(st, sale({ dealId: 'Д-999' }), 'mgr', NOW).ok, false);
});

test('Dispatch.create: у перемещения обязательны склады «откуда» и «куда», и они разные', () => {
  const app = load(), { Dispatch } = app;
  const st = world(app);
  assert.deepEqual(plain(Dispatch.create(st, transfer({ from: undefined }), 'mgr', NOW).missing), ['from']);
  assert.deepEqual(plain(Dispatch.create(st, transfer({ toCell: undefined }), 'mgr', NOW).missing), ['toCell']);
  assert.deepEqual(plain(Dispatch.create(st, transfer({ toCell: IRK }), 'mgr', NOW).missing), ['toCell']);
  // «откуда» может быть клеткой с «нет данных: город» — так лежат остатки в таблице менеджеров, «куда» — только настоящий склад
  assert.equal(Dispatch.create(st, transfer({ from: { entityId: 'ip', cityId: '_' } }), 'mgr', NOW).ok, true);
  assert.equal(Dispatch.create(st, transfer({ toCell: { entityId: 'ip', cityId: '_' } }), 'mgr', NOW).ok, false);
  assert.equal(st.dispatches.length, 1);
});

// ——— права ———
test('canWork, canEdit, canCancel: автор, логист и менеджер-не-автор', () => {
  const app = load(), { Dispatch } = app;
  const st = world(app);
  const id = make(app, st, sale(), 'mgr');
  const d = () => Dispatch.byId(st, id);
  // вести отправки — право dispatch: логист, кладовщик, водитель, директор; менеджеры без него
  for (const p of ['log', 'wh', 'drv', 'dir']) assert.equal(Dispatch.canWork(st, p), true, p);
  for (const p of ['mgr', 'mgr2']) assert.equal(Dispatch.canWork(st, p), false, p);
  // править: с правом всегда, автор — пока «Новая»
  assert.equal(Dispatch.canEdit(st, 'mgr', d()), true, 'автор правит новую');
  assert.equal(Dispatch.canEdit(st, 'log', d()), true);
  assert.equal(Dispatch.canEdit(st, 'mgr2', d()), false, 'менеджер-не-автор не правит');
  // отменить: автор и логист до «В пути», менеджер-не-автор — нет
  assert.equal(Dispatch.canCancel(st, 'mgr', d()), true);
  assert.equal(Dispatch.canCancel(st, 'log', d()), true);
  assert.equal(Dispatch.canCancel(st, 'mgr2', d()), false);
  assert.equal(go(app, st, id, 'picking', 'wh').ok, true);
  assert.equal(Dispatch.canEdit(st, 'mgr', d()), false, 'автор не правит заявку, которую уже собирают');
  assert.equal(Dispatch.canEdit(st, 'log', d()), true);
  assert.equal(Dispatch.canCancel(st, 'mgr', d()), true, 'автор отменяет до «В пути»');
  assert.equal(go(app, st, id, 'ready').ok, true);
  assert.equal(go(app, st, id, 'onWay', 'drv').ok, true);
  assert.equal(Dispatch.canCancel(st, 'mgr', d()), false, 'в пути автор уже не отменяет');
  assert.equal(Dispatch.canCancel(st, 'log', d()), true, 'логист отменяет и в пути');
  assert.equal(go(app, st, id, 'cancelled', 'mgr').ok, false);
  assert.equal(go(app, st, id, 'cancelled', 'log', 5).ok, true);
  assert.equal(Dispatch.canCancel(st, 'log', d()), false, 'отменённую не отменяют');
});

test('setStage: этапы двигают только с правом; автор без права только отменяет до «В пути»; чужой менеджер — ничего', () => {
  const app = load(), { Dispatch } = app;
  const st = world(app);
  const id = make(app, st, sale(), 'mgr');
  for (const by of ['mgr', 'mgr2']) {
    const r = go(app, st, id, 'picking', by);
    assert.equal(r.ok, false, `${by} двинул этап`);
  }
  assert.equal(go(app, st, id, 'cancelled', 'mgr2').ok, false, 'чужой менеджер отменил');
  assert.equal(Dispatch.byId(st, id).stageId, 'new');
  assert.equal(go(app, st, id, 'нет-такого', 'log').ok, false);
  assert.equal(go(app, st, id, 'new', 'log').ok, false, 'тот же этап');
  assert.equal(go(app, st, id, 'cancelled', 'mgr').ok, true, 'автор отменил свою новую заявку');
  assert.equal(Dispatch.byId(st, id).stageId, 'cancelled');
});

// ——— уведомления ———
test('уведомления «Отправки»: новая заявка — логисту и кладовщику; водитель — ему; автору каждый этап, который сменил другой', () => {
  const app = load(), { Dispatch, Notify } = app;
  const st = world(app);
  const unread = p => Notify.unread(st, p).length;
  const id = make(app, st, sale(), 'mgr');
  assert.equal(st.notes.length, 1);
  assert.equal(st.notes[0].kind, 'dispatch');
  assert.deepEqual(plain(st.notes[0].to).sort(), ['log', 'wh'], 'новая заявка: логист и кладовщик');
  assert.equal(unread('mgr'), 0, 'автор о своей же заявке не уведомляется');
  assert.equal(unread('drv'), 0);
  assert.equal(unread('log'), 1, 'логист получил только новую заявку');
  // водитель назначен — ему
  assert.equal(Dispatch.assign(st, id, 'drv', 'log', later(1)).ok, true);
  assert.equal(unread('drv'), 1);
  assert.ok(st.notes[0].to.includes('drv'));
  assert.equal(unread('drv2'), 0, 'другой водитель не уведомляется');
  assert.equal(unread('mgr'), 0, 'назначение водителя автору не приходит: это не этап');
  // каждый этап, который сменил другой, — автору
  go(app, st, id, 'picking', 'wh', 2);
  assert.equal(unread('mgr'), 1);
  go(app, st, id, 'ready', 'log', 3);
  go(app, st, id, 'onWay', 'drv', 4);
  assert.equal(unread('mgr'), 3);
  assert.ok(st.notes[0].to.includes('mgr') && st.notes[0].text.includes('В пути'));
  assert.equal(unread('mgr2'), 0, 'чужой менеджер ничего не получает');
  // исполнители новую заявку получили, а ход каждой — нет: логист и кладовщик не получают смену этапа и назначение водителя
  assert.equal(unread('log'), 1, 'логист получил смену этапа чужой заявки');
  assert.equal(unread('wh'), 1, 'кладовщик получил смену этапа или назначение водителя');
  // этап, который автор сменил сам, ему не приходит
  const own = make(app, st, sale(), 'mgr');
  const before = unread('mgr');
  assert.equal(go(app, st, own, 'cancelled', 'mgr', 5).ok, true);
  assert.equal(unread('mgr'), before, 'автор получил уведомление о своей же отмене');
  assert.ok(!st.notes[0].to.includes('mgr'), 'автор записан в получатели смены этапа, которую сделал сам');
  // выключенный у себя вид не приходит
  st.prefs.notify.mgr = { dispatchStep: false };
  go(app, st, id, 'delivered', 'drv', 6);
  assert.equal(unread('mgr'), before);
});

// ——— «собрано N из M» ———
test('Dispatch.picked: «собрано N из M» по отметкам строк; отмечает только тот, кто ведёт отправки', () => {
  const app = load(), { Dispatch } = app;
  const st = world(app);
  const id = make(app, st, sale({ items: [{ productId: 'pv', qty: 2 }, { productId: 'inv', qty: 1 }, { text: 'Шнур (пример)', qty: 3 }] }));
  const d = () => Dispatch.byId(st, id);
  assert.deepEqual(plain(Dispatch.picked(d())), { done: 0, total: 3 });
  assert.equal(Dispatch.pick(st, id, 0, true, 'wh', later(1)).ok, true);
  assert.equal(Dispatch.pick(st, id, 2, true, 'wh', later(2)).ok, true);
  assert.deepEqual(plain(Dispatch.picked(d())), { done: 2, total: 3 });
  assert.equal(Dispatch.pick(st, id, 2, false, 'wh', later(3)).ok, true);
  assert.deepEqual(plain(Dispatch.picked(d())), { done: 1, total: 3 });
  assert.equal(Dispatch.pick(st, id, 1, true, 'mgr', later(4)).ok, false, 'менеджер отметил «собрано»');
  assert.equal(Dispatch.pick(st, id, 9, true, 'wh', later(5)).ok, false, 'такой строки нет');
  assert.deepEqual(plain(Dispatch.picked(d())), { done: 1, total: 3 });
  // отметка пишется в ленту
  assert.ok(app.Feed.of(st, { t: 'dispatch', id }).some(e => e.kind === 'item' && /Собрано 2 из 3/.test(e.text)));
});

// ——— перемещение между складами ———
test('перемещение: «В пути» — клетка «откуда» −qty и приход в пути +qty; «Доставлена» — товар в «куда», в пути пусто; сумма не меняется', () => {
  const app = load(), { Dispatch, Stock } = app;
  const st = world(app);
  const id = make(app, st, transfer());
  const total = () => balance(app, st, 'pv');
  assert.equal(total(), 10);
  for (const s of ['picking', 'ready']) {
    assert.equal(go(app, st, id, s, 'wh').ok, true);
    assert.equal(cell(app, st, 'pv', IRK), 10, `на этапе ${s} склад уже тронут`);
    assert.equal(Stock.summary(st, 'pv', NOW).incoming, 0);
    assert.equal(total(), 10);
  }
  // «В пути»
  const r = go(app, st, id, 'onWay', 'drv', 5);
  assert.equal(r.ok, true, r.reason);
  assert.equal(cell(app, st, 'pv', IRK), 6, 'из клетки «откуда» ушло 4');
  const k = Stock.summary(st, 'pv', NOW);
  assert.equal(k.incoming, 4, 'в пути 4 как приход на склад-получатель');
  assert.equal(k.onHand, 6);
  assert.equal(k.free, 6);
  assert.equal(k.freeAfter, 10, 'свободно после прихода: 6 + 4');
  assert.equal(total(), 10);
  const inc = Stock.incomingOf(st, 'pv');
  assert.equal(inc.length, 1);
  assert.equal(inc[0].shipId, 'ОТ-001', 'в пути — под номером заявки');
  assert.equal(inc[0].qty, 4);
  assert.equal(inc[0].entityId + '|' + inc[0].cityId, 'ip|msk', 'приход — на склад-получатель');
  assert.equal(Stock.freeIn(st, 'ОТ-001', 'pv'), 0, 'под груз в пути резерв не ставится');
  // «Доставлена»
  assert.equal(go(app, st, id, 'delivered', 'drv', 9).ok, true);
  assert.equal(cell(app, st, 'pv', IRK), 6);
  assert.equal(cell(app, st, 'pv', MSK), 4, 'товар пришёл в клетку «куда»');
  assert.equal(Stock.summary(st, 'pv', NOW).incoming, 0, 'в пути снова столько же, сколько было: ничего');
  assert.equal(Stock.incomingOf(st, 'pv').length, 0);
  assert.equal(total(), 10);
  // журнал: одна запись «Перемещение» откуда → куда с номером заявки (G04); «Доставлена» ничего не движет
  const mv = st.moves.filter(m => m.doc === 'ОТ-001');
  assert.equal(mv.length, 1);
  assert.deepEqual(plain(mv.map(m => [m.kind, m.qty, m.cityId, m.toCityId])), [['Перемещение', 4, 'irk', 'msk']]);
  assert.equal(Dispatch.byId(st, id).moved, true);
});

test('перемещение: груз в пути входит в incoming вместе с поставками и идёт по дате ожидания', () => {
  const app = load(), { Stock } = app;
  const st = world(app);
  st.shipments.push({ id: 'S1', dir: 'in', pipeId: 'ships', stageId: 'toStock', eta: new Date(2026, 10, 20), items: [{ productId: 'pv', qty: 20 }] });
  const id = make(app, st, transfer({ when: { date: '2026-11-05' } }));
  go(app, st, id, 'onWay', 'drv');
  const k = Stock.summary(st, 'pv', NOW);
  assert.equal(k.incoming, 24, 'поставка 20 + перемещение 4');
  assert.equal(k.freeAfter, 6 + 24);
  assert.deepEqual(plain(Stock.incomingOf(st, 'pv').map(x => x.shipId)), ['ОТ-001', 'S1'], 'сначала то, что ближе по дате');
  assert.equal(new Date(k.nextEta).getTime(), new Date(2026, 10, 5).getTime());
});

test('перемещение: отмена в пути и возврат на этап до «В пути» возвращают товар в «откуда»; повторный «В пути» второй раз не списывает', () => {
  const app = load(), { Dispatch, Stock } = app;
  const st = world(app);
  const id = make(app, st, transfer());
  const total = () => balance(app, st, 'pv');
  go(app, st, id, 'onWay', 'log', 1);
  assert.equal(cell(app, st, 'pv', IRK), 6);
  // назад на «Готова к отправке» — товар вернулся
  assert.equal(go(app, st, id, 'ready', 'log', 2).ok, true);
  assert.equal(cell(app, st, 'pv', IRK), 10);
  assert.equal(Stock.summary(st, 'pv', NOW).incoming, 0);
  assert.equal(Dispatch.byId(st, id).moved, false);
  // снова «В пути» — уходит один раз
  go(app, st, id, 'onWay', 'log', 3);
  assert.equal(cell(app, st, 'pv', IRK), 6, 'второй «В пути» списал дважды');
  assert.equal(go(app, st, id, 'onWay', 'log', 4).ok, false, 'тот же этап второй раз');
  assert.equal(cell(app, st, 'pv', IRK), 6);
  // отмена в пути — тоже возврат
  assert.equal(go(app, st, id, 'cancelled', 'log', 5).ok, true);
  assert.equal(cell(app, st, 'pv', IRK), 10, 'отмена в пути не вернула товар');
  assert.ok(!cell(app, st, 'pv', MSK), 'в клетке «куда» после возврата ничего нет');
  assert.equal(Stock.summary(st, 'pv', NOW).incoming, 0);
  assert.equal(total(), 10);
  // журнал: два ухода и два возврата, ничего лишнего
  assert.equal(st.moves.filter(m => m.doc === 'ОТ-001').length, 4);
});

test('перемещение: этап, вставленный после «В пути», товар не двигает; «Доставлена» — один раз', () => {
  const app = load(), { Pipes, Stock } = app;
  const st = world(app);
  Pipes.addStage(st, 'dispatch', 'Разгрузка', 'onWay');
  const extra = st.pipelines.find(p => p.id === 'dispatch').stages.find(s => s.name === 'Разгрузка').id;
  const id = make(app, st, transfer());
  go(app, st, id, 'onWay', 'log', 1);
  assert.equal(go(app, st, id, extra, 'log', 2).ok, true);
  assert.equal(cell(app, st, 'pv', IRK), 6, 'этап после «В пути» списал ещё раз');
  assert.equal(Stock.summary(st, 'pv', NOW).incoming, 4, 'груз всё ещё в пути');
  assert.equal(go(app, st, id, 'delivered', 'log', 3).ok, true);
  assert.equal(cell(app, st, 'pv', MSK), 4);
  // после доставки вернуть груз на более ранний этап нельзя — обратной заявкой
  const back = go(app, st, id, 'ready', 'log', 4);
  assert.equal(back.ok, false);
  assert.match(back.reason, /обратн/);
  assert.equal(cell(app, st, 'pv', MSK), 4);
  assert.equal(cell(app, st, 'pv', IRK), 6);
  assert.equal(app.Dispatch.byId(st, id).stageId, 'delivered');
});

test('перемещение: отмена после доставки движение не откатывает и подсказывает «нужна обратная заявка»', () => {
  const app = load(), { Dispatch } = app;
  const st = world(app);
  const id = make(app, st, transfer());
  go(app, st, id, 'onWay', 'log', 1);
  go(app, st, id, 'delivered', 'log', 2);
  const r = go(app, st, id, 'cancelled', 'log', 3);
  assert.equal(r.ok, true);
  assert.match(r.note, /нужна обратная заявка/);
  assert.equal(cell(app, st, 'pv', MSK), 4, 'отмена после доставки откатила движение');
  assert.equal(cell(app, st, 'pv', IRK), 6);
  assert.equal(balance(app, st, 'pv'), 10);
  assert.equal(Dispatch.byId(st, id).stageId, 'cancelled');
  assert.ok(app.Feed.of(st, { t: 'dispatch', id })[0].text.includes('нужна обратная заявка'), 'подсказки нет в ленте');
  // заявку снова открыли и довели до «Доставлена»: товар второй раз не приходит
  assert.equal(go(app, st, id, 'delivered', 'log', 4).ok, true);
  assert.equal(cell(app, st, 'pv', MSK), 4);
});

test('перемещение: в «откуда» меньше, чем в заявке, — «В пути» отказ, этап и склад не меняются, названо, чего не хватает', () => {
  const app = load(), { Dispatch } = app;
  const st = world(app);
  // pv нужно 8 из 10 — хватает; inv нужно 5 из 3 — нет
  const id = make(app, st, transfer({ items: [{ productId: 'pv', qty: 8 }, { productId: 'inv', qty: 5 }] }));
  go(app, st, id, 'picking', 'wh', 1);
  const r = go(app, st, id, 'onWay', 'log', 2);
  assert.equal(r.ok, false);
  assert.match(r.reason, /Не хватает/);
  assert.match(r.reason, /Инвертор тестовый — нужно 5, есть 3/);
  assert.doesNotMatch(r.reason, /Панель тестовая/, 'панели хватает — её называть не нужно');
  assert.deepEqual(plain(r.short), [{ productId: 'inv', name: 'Инвертор тестовый', need: 5, have: 3 }]);
  assert.equal(Dispatch.byId(st, id).stageId, 'picking', 'этап сменился несмотря на отказ');
  assert.equal(cell(app, st, 'pv', IRK), 10, 'панели списались, хотя инвертора не хватило');
  assert.equal(cell(app, st, 'inv', IRK), 3);
  assert.equal(st.moves.length, 0);
  // две строки одного товара считаются вместе: 6 + 6 > 10
  const two = make(app, st, transfer({ items: [{ productId: 'pv', qty: 6 }, { productId: 'pv', qty: 6 }] }));
  const r2 = go(app, st, two, 'onWay', 'log', 3);
  assert.equal(r2.ok, false);
  assert.equal(r2.short[0].need, 12);
  assert.equal(cell(app, st, 'pv', IRK), 10);
});

test('«Продажа» и «Другое»: смена этапа склад не трогает ни на одном этапе', () => {
  const app = load(), { Stock } = app;
  for (const purpose of ['sale', 'other']) {
    const st = world(app);
    const data = purpose === 'sale' ? sale() : sale({ purpose: 'other', items: [{ productId: 'pv', qty: 2 }, { text: 'Образцы (пример)', qty: 1 }] });
    const id = make(app, st, data);
    const stockBefore = JSON.stringify(st.stock), before = Stock.summary(st, 'pv', NOW);
    for (const s of ['picking', 'ready', 'onWay', 'delivered']) {
      assert.equal(go(app, st, id, s, 'log').ok, true, `${purpose}: ${s}`);
      assert.equal(JSON.stringify(st.stock), stockBefore, `${purpose}: на этапе ${s} остатки изменились`);
      assert.equal(Stock.summary(st, 'pv', NOW).incoming, 0, `${purpose}: на этапе ${s} появился приход в пути`);
    }
    assert.equal(go(app, st, id, 'cancelled', 'log').ok, true);
    assert.deepEqual(plain(Stock.summary(st, 'pv', NOW)), plain(before));
    assert.equal(st.moves.length, 0, `${purpose}: в журнале появились движения`);
  }
});

test('переименование этапа не ломает заявки: этап хранится по id, перемещение работает как прежде', () => {
  const app = load(), { Dispatch, Pipes } = app;
  const st = world(app);
  const id = make(app, st, transfer());
  go(app, st, id, 'picking', 'wh', 1);
  assert.equal(Pipes.renameStage(st, 'dispatch', 'onWay', 'Едет к клиенту').ok, true);
  assert.equal(Pipes.renameStage(st, 'dispatch', 'picking', 'На сборке').ok, true);
  assert.equal(Dispatch.byId(st, id).stageId, 'picking');
  assert.equal(Dispatch.query(st, { stage: 'picking' }).length, 1);
  go(app, st, id, 'ready', 'log', 2);
  assert.equal(go(app, st, id, 'onWay', 'log', 3).ok, true);
  assert.equal(cell(app, st, 'pv', IRK), 6, 'после переименования «В пути» не списало');
  assert.ok(app.Feed.of(st, { t: 'dispatch', id })[0].text.includes('Едет к клиенту'), 'в ленте старое название');
  // этап удалён — заявки на нём переехали на выбранный
  const other = make(app, st, sale());
  go(app, st, other, 'picking', 'wh', 4);
  assert.equal(Pipes.removeStage(st, 'dispatch', 'picking', 'ready').moved, 1);
  assert.equal(Dispatch.byId(st, other).stageId, 'ready');
});

test('Pipes.addPipe: вторая воронка отправок — копия этапов первой; заявки уезжают при её удалении', () => {
  const app = load(), { Pipes, Dispatch } = app;
  const st = world(app);
  const p = Pipes.addPipe(st, 'dispatch', 'Срочные');
  assert.ok(p, 'воронку отправок не завести');
  assert.deepEqual(plain(p.stages.map(s => [s.id, s.flag || ''])), plain(st.pipelines.find(x => x.id === 'dispatch').stages.map(s => [s.id, s.flag || ''])));
  p.stages[0].name = 'Срочная новая';
  assert.equal(st.pipelines.find(x => x.id === 'dispatch').stages[0].name, 'Новая', 'этапы общие, а не копия');
  const id = make(app, st, sale());
  assert.equal(Pipes.items(st, 'dispatch').length, 1);
  assert.equal(Pipes.removePipe(st, 'dispatch', p.id).moved, 1);
  assert.equal(Dispatch.byId(st, id).pipeId, p.id);
  assert.equal(Dispatch.byId(st, id).stageId, 'new');
});

// ——— списание при продаже ———
test('Stock.sell: из клетки уходит qty, в журнале «Отгрузка» с документом; без права sell и больше остатка — отказ', () => {
  const app = load(), { Stock } = app;
  const st = world(app);
  const r = Stock.sell(st, { productId: 'pv', qty: 3, ...IRK, doc: 'Д-1' }, 'mgr', NOW);
  assert.equal(r.ok, true, r.reason);
  assert.equal(cell(app, st, 'pv', IRK), 7);
  assert.deepEqual(plain(st.moves.map(m => [m.kind, m.qty, m.doc, m.by])), [['Отгрузка', 3, 'Д-1', 'mgr']]);
  assert.equal(Stock.summary(st, 'pv', NOW).onHand, 7);
  // право sell: у менеджеров, РОП (в демо) и директора; у логиста и кладовщика его нет
  for (const by of ['log', 'wh', 'drv']) {
    const x = Stock.sell(st, { productId: 'pv', qty: 1, ...IRK, doc: 'Д-1' }, by, NOW);
    assert.equal(x.ok, false, `${by} списал без права`);
    assert.match(x.reason, /нет права/);
  }
  assert.equal(cell(app, st, 'pv', IRK), 7);
  assert.equal(Stock.sell(st, { productId: 'pv', qty: 1, ...IRK, doc: 'Д-1' }, 'dir', NOW).ok, true, 'директору можно');
  // больше, чем в клетке, — нельзя, с объяснением; ничего не изменилось
  const before = JSON.stringify(st.stock), n = st.moves.length;
  const big = Stock.sell(st, { productId: 'pv', qty: 7, ...IRK, doc: 'Д-1' }, 'mgr', NOW);
  assert.equal(big.ok, false);
  assert.match(big.reason, /только 6, а нужно 7/);
  assert.equal(JSON.stringify(st.stock), before);
  assert.equal(st.moves.length, n);
  assert.equal(Stock.sell(st, { productId: 'pv', qty: 0, ...IRK }, 'mgr', NOW).ok, false);
  assert.equal(Stock.sell(st, { productId: 'pv', qty: 1.5, ...IRK }, 'mgr', NOW).ok, false);
});

test('Stock.sell по резерву: резерв снимается и товар списывается одним действием, свободный остаток не меняется', () => {
  const app = load(), { Stock } = app;
  const st = world(app);
  const res = Stock.reserve(st, { productId: 'pv', qty: 5, ...IRK, dealId: 'Д-1', by: 'mgr', at: NOW });
  assert.equal(res.ok, true, res.reason);
  const free = () => Stock.summary(st, 'pv', NOW).free;
  assert.equal(free(), 5, 'до списания: 10 в клетке − 5 в резерве');
  // продали 5 из 5 в резерве
  const r = Stock.sell(st, { productId: 'pv', qty: 5, reserveId: res.reserve.id, doc: 'Д-1' }, 'mgr', NOW);
  assert.equal(r.ok, true, r.reason);
  assert.equal(cell(app, st, 'pv', IRK), 5, 'клетка −5');
  assert.equal(st.reserves.length, 0, 'резерв не снят');
  assert.equal(free(), 5, 'свободный остаток изменился при списании по резерву');
  assert.ok(st.moves.some(m => m.kind === 'Снят резерв' && m.qty === 5), 'снятие резерва не записано');
  // часть резерва: продали 2 из 4 — остаётся резерв на 2, свободно по-прежнему 5 − ... считаем: в клетке 5, в резерве 4 → 1
  const res2 = Stock.reserve(st, { productId: 'pv', qty: 4, ...IRK, dealId: 'Д-2', by: 'mgr', at: NOW });
  assert.equal(free(), 1);
  assert.equal(Stock.sell(st, { productId: 'pv', qty: 2, reserveId: res2.reserve.id, doc: 'Д-2' }, 'mgr', NOW).ok, true);
  assert.equal(st.reserves[0].qty, 2, 'в резерве осталось 2');
  assert.equal(cell(app, st, 'pv', IRK), 3);
  assert.equal(free(), 1, 'свободный остаток изменился при частичном списании');
  // нельзя списать больше, чем в резерве; чужой товар; несуществующий резерв
  assert.equal(Stock.sell(st, { productId: 'pv', qty: 3, reserveId: res2.reserve.id }, 'mgr', NOW).ok, false);
  assert.equal(Stock.sell(st, { productId: 'inv', qty: 1, reserveId: res2.reserve.id }, 'mgr', NOW).ok, false);
  assert.equal(Stock.sell(st, { productId: 'pv', qty: 1, reserveId: 'нет' }, 'mgr', NOW).ok, false);
  // без права — резерв не трогается
  assert.equal(Stock.sell(st, { productId: 'pv', qty: 1, reserveId: res2.reserve.id }, 'log', NOW).ok, false);
  assert.equal(st.reserves[0].qty, 2);
  assert.equal(cell(app, st, 'pv', IRK), 3);
});

test('Dispatch.sell: строка «Продажи» помечается «списано: кто, когда, откуда»; дважды, текстовую строку и перемещение — нельзя', () => {
  const app = load(), { Dispatch } = app;
  const st = world(app);
  const id = make(app, st, sale({ items: [{ productId: 'pv', qty: 2 }, { text: 'Шнур (пример)', qty: 1 }] }));
  const r = Dispatch.sell(st, id, 0, IRK, 'mgr', later(3));
  assert.equal(r.ok, true, r.reason);
  const line = Dispatch.byId(st, id).items[0];
  assert.equal(line.sold.by, 'mgr');
  assert.equal(line.sold.entityId + '|' + line.sold.cityId, 'ip|irk');
  assert.equal(line.sold.at.getTime(), later(3).getTime());
  assert.match(Dispatch.soldText(st, line), /^списано: Сотрудник mgr, .+«ИП, Иркутск»$/);
  assert.equal(cell(app, st, 'pv', IRK), 8);
  assert.equal(st.moves[0].doc, 'ОТ-001');
  assert.equal(Dispatch.sell(st, id, 0, IRK, 'mgr', later(4)).ok, false, 'вторая попытка списала ещё');
  assert.equal(cell(app, st, 'pv', IRK), 8);
  assert.equal(Dispatch.sell(st, id, 1, IRK, 'mgr', later(4)).ok, false, 'строка своим текстом');
  assert.equal(Dispatch.sell(st, id, 5, IRK, 'mgr', later(4)).ok, false, 'нет такой строки');
  const other = make(app, st, sale({ items: [{ productId: 'pv', qty: 1 }] }));
  assert.equal(Dispatch.sell(st, other, 0, IRK, 'log', later(5)).ok, false, 'логист без права sell');
  assert.equal(cell(app, st, 'pv', IRK), 8);
  const mv = make(app, st, transfer());
  assert.equal(Dispatch.sell(st, mv, 0, IRK, 'mgr', later(5)).ok, false, 'у перемещения списывать при продаже нечего');
  // не хватает в клетке — отказ без пометки
  const big = make(app, st, sale({ items: [{ productId: 'inv', qty: 5 }] }));
  assert.equal(Dispatch.sell(st, big, 0, IRK, 'mgr', later(6)).ok, false);
  assert.equal(Dispatch.byId(st, big).items[0].sold, undefined);
  assert.equal(cell(app, st, 'inv', IRK), 3);
});

// ---- остальное ядро ----
test('Dispatch.update: автор правит «Новую», потом нет; проверка как при создании; груз в пути не меняет состав', () => {
  const app = load(), { Dispatch } = app;
  const st = world(app);
  const id = make(app, st, sale({ items: [{ productId: 'pv', qty: 2 }, { productId: 'inv', qty: 1 }] }), 'mgr');
  assert.equal(Dispatch.update(st, id, { to: { name: 'Клиент-пример 9', phone: '+7 900 000-00-09' } }, 'mgr', later(1)).ok, true);
  assert.equal(Dispatch.byId(st, id).to.name, 'Клиент-пример 9');
  assert.equal(Dispatch.byId(st, id).items.length, 2, 'остальное сохранилось');
  const bad = Dispatch.update(st, id, { address: '' }, 'mgr', later(2));
  assert.equal(bad.ok, false);
  assert.deepEqual(plain(bad.missing), ['address']);
  assert.equal(Dispatch.update(st, id, { note: 'x' }, 'mgr2', later(2)).ok, false, 'чужой менеджер');
  // отметка «собрано» остаётся у строки, которую не меняли
  Dispatch.pick(st, id, 0, true, 'wh', later(3));
  assert.equal(Dispatch.update(st, id, { items: [{ productId: 'pv', qty: 2 }, { productId: 'inv', qty: 4 }] }, 'log', later(4)).ok, true);
  assert.equal(Dispatch.byId(st, id).items[0].picked, true);
  assert.equal(Dispatch.byId(st, id).items[1].qty, 4);
  go(app, st, id, 'picking', 'wh', 5);
  assert.equal(Dispatch.update(st, id, { note: 'x' }, 'mgr', later(6)).ok, false, 'автор правит заявку, которую уже собирают');
  // перемещение в пути: состав и склады менять нельзя, примечание можно
  const t = make(app, st, transfer());
  go(app, st, t, 'onWay', 'log', 7);
  assert.equal(Dispatch.update(st, t, { items: [{ productId: 'pv', qty: 1 }] }, 'log', later(8)).ok, false);
  assert.equal(Dispatch.update(st, t, { toCell: { entityId: 'ip', cityId: 'krd' } }, 'log', later(8)).ok, false);
  assert.equal(Dispatch.update(st, t, { note: 'Пример' }, 'log', later(8)).ok, true);
  assert.equal(cell(app, st, 'pv', IRK), 6);
});

test('Dispatch.assign и comment: водителя назначает тот, кто ведёт отправки; в ленте пишет любой сотрудник (раздел видят все)', () => {
  const app = load(), { Dispatch, Feed } = app;
  const st = world(app);
  const id = make(app, st, sale(), 'mgr');
  assert.equal(Dispatch.assign(st, id, 'drv', 'mgr', later(1)).ok, false, 'менеджер назначил водителя');
  assert.equal(Dispatch.assign(st, id, 'mgr2', 'log', later(1)).ok, false, 'водителем назначен менеджер');
  assert.equal(Dispatch.assign(st, id, 'drv', 'log', later(1)).ok, true);
  assert.equal(Dispatch.byId(st, id).driverId, 'drv');
  assert.equal(Dispatch.assign(st, id, 'drv', 'log', later(2)).ok, false, 'тот же водитель второй раз');
  assert.equal(Dispatch.assign(st, id, '', 'log', later(3)).ok, true);
  assert.equal(Dispatch.byId(st, id).driverId, undefined);
  assert.deepEqual(plain(Dispatch.drivers(st).map(p => p.id)), ['drv', 'drv2']);
  for (const [by, ok] of [['mgr', true], ['log', true], ['drv', true], ['mgr2', true], ['нет-такого', false]]) {
    assert.equal(Dispatch.comment(st, id, 'Примечание ' + by, by, later(4)).ok, ok, by);
  }
  assert.equal(Dispatch.comment(st, 'ОТ-999', 'Некуда', 'mgr2', later(4)).ok, false, 'комментарий к несуществующей заявке');
  assert.equal(Dispatch.comment(st, id, '  ', 'log', later(5)).ok, false, 'пустой комментарий');
  const texts = Feed.of(st, { t: 'dispatch', id }).filter(e => e.kind === 'comment').map(e => e.text);
  assert.deepEqual(plain(texts).sort(), ['Примечание drv', 'Примечание log', 'Примечание mgr', 'Примечание mgr2']);
});

test('Dispatch.query: поиск по номеру, получателю и адресу; «Мои», «На сегодня», этап, водитель', () => {
  const app = load(), { Dispatch } = app;
  const st = world(app);
  const a = make(app, st, sale({ when: { date: '2026-11-01' }, to: { name: 'Клиент-пример 1', phone: '+7 900 000-00-01' }, address: 'г. Иркутск, ул. Берёзовая, 5 (пример)' }), 'mgr');
  const b = make(app, st, sale({ when: { date: '2026-11-03' }, to: { name: 'Клиент-пример 2', phone: '+7 900 000-00-02' }, address: 'г. Москва, ул. Липовая, 7 (пример)' }), 'mgr2');
  const c = make(app, st, sale({ when: { date: '2026-11-02' } }), 'mgr');
  Dispatch.assign(st, b, 'drv', 'log', later(1));
  go(app, st, c, 'cancelled', 'mgr', 2);
  const ids = f => plain(Dispatch.query(st, { now: NOW, ...f }).map(d => d.id));
  assert.deepEqual(ids({}), [a, b, c], 'открытые по дате, закрытые в конце');
  assert.deepEqual(ids({ q: 'ОТ-002' }), [b]);
  assert.deepEqual(ids({ q: 'ot-002' }), [], 'латиница вместо кириллицы — не то же самое');
  assert.deepEqual(ids({ q: 'клиент-пример 2' }), [b]);
  assert.deepEqual(ids({ q: 'берёзовая' }), [a]);
  assert.deepEqual(ids({ q: 'иркутск береза' }), [], 'все слова должны найтись');
  assert.deepEqual(ids({ mine: true, personId: 'mgr' }), [a, c], 'мои — где я автор');
  assert.deepEqual(ids({ mine: true, personId: 'drv' }), [b], 'мои — где я водитель');
  assert.deepEqual(ids({ today: true }), [a]);
  assert.deepEqual(ids({ stage: 'cancelled' }), [c]);
  assert.deepEqual(ids({ driver: 'drv' }), [b]);
});

// ——— сохранение ———
test('Store.dump: не влезло в браузер — файлы заявок выкинуты и помечены unsaved:true, остальное цело; фото приёмки считаются отдельно', () => {
  const app = load(), { Store } = app;
  const big = 'data:application/pdf;base64,' + 'B'.repeat(4000);
  const pic = 'data:image/png;base64,' + 'C'.repeat(4000);
  const photo = 'data:image/jpeg;base64,' + 'A'.repeat(4000);
  const st = {
    v: 3,
    shipments: [{ id: 's1', received: { photos: 1, urls: [photo], note: 'коробка мятая' } }],
    dispatches: [
      { id: 'ОТ-001', to: { name: 'Клиент-пример 1' }, items: [{ productId: 'pv', qty: 2 }],
        files: [{ id: 'fl1', name: 'счёт.pdf', type: 'application/pdf', size: 3000, data: big }, { id: 'fl2', name: 'схема.png', type: 'image/png', size: 3000, data: pic }] },
      { id: 'ОТ-002', to: { name: 'Клиент-пример 2' }, items: [], files: [] },
    ],
  };
  const roomy = Store.dump(st, 100000);
  assert.equal(roomy.droppedFiles, 0);
  assert.equal(roomy.droppedPhotos, 0);
  assert.equal(Store.load(roomy.text).dispatches[0].files[0].data, big, 'места хватает — файл не тронут');

  // предел, в который не влезает ни одно вложение: уходят все три (выкидывается только лишнее — тест F1·6 в repair.test.js)
  const tight = Store.dump(st, 1500);
  assert.equal(tight.droppedFiles, 2);
  assert.equal(tight.droppedPhotos, 1, 'картинка в заявке — файл заявки, а не фото приёмки');
  assert.ok(tight.text.length <= 1500 && tight.fits, 'без файлов и фото должно влезть');
  const back = Store.load(tight.text);
  const [f1, f2] = back.dispatches[0].files;
  assert.equal(f1.data, null);
  assert.equal(f1.unsaved, true, 'у файла нет пометки unsaved:true');
  assert.equal(f2.unsaved, true, 'у картинки-файла нет пометки unsaved:true');
  assert.equal(f2.unsaved.photos, undefined);
  assert.equal(f1.name, 'счёт.pdf');
  assert.equal(f1.size, 3000);
  assert.equal(back.dispatches[0].to.name, 'Клиент-пример 1', 'остальное заявки потеряно');
  assert.equal(back.dispatches[0].items[0].qty, 2);
  assert.equal(back.dispatches[1].files.length, 0);
  assert.equal(back.shipments[0].received.note, 'коробка мятая');
  assert.equal(back.shipments[0].received.unsaved.photos, 1);
  assert.equal(st.dispatches[0].files[0].data, big, 'dump испортил само состояние');
});

test('Store: ревизия данных поднята — сохранение без заявок прежней ревизии не читается', () => {
  const { Store } = load();
  assert.ok(Store.REV >= 10, `REV=${Store.REV}`);
  const text = Store.dump({ v: 3, people: [] }).text;
  assert.notEqual(Store.load(text), null);
  assert.equal(Store.load(text.replace(`"rev":${Store.REV}`, '"rev":9')), null);
});

// ——— демо-данные и роль ———
test('демо: 15+ заявок «пример» на разных этапах и с разными целями, часть на сегодня; воронка, роль «Водитель», два водителя', () => {
  const app = load(), { Pipes, Perms, Stock } = app;
  const st = app.seed();
  const list = st.dispatches;
  assert.ok(list.length >= 15, `заявок ${list.length}`);
  assert.deepEqual(plain([...new Set(list.map(d => d.purpose))].sort()), ['other', 'sale', 'transfer']);
  assert.ok(list.every(d => d.demo === true), 'заявка без пометки демо');
  const pipe = st.pipelines.find(p => p.kind === 'dispatch');
  assert.deepEqual(plain(pipe.stages.map(s => [s.id, s.name, s.flag || ''])), [
    ['new', 'Новая', ''], ['picking', 'Собирается', ''], ['ready', 'Готова к отправке', ''],
    ['onWay', 'В пути', ''], ['delivered', 'Доставлена', 'final'], ['cancelled', 'Отменена', 'final'],
  ]);
  const stages = new Set(list.map(d => d.stageId));
  for (const s of pipe.stages) assert.ok(stages.has(s.id), `в демо нет заявки на этапе «${s.name}»`);
  assert.ok(list.every(d => Pipes.stage(st, d.pipeId, d.stageId)), 'заявка на несуществующем этапе');
  const today = app.day(0, 0, 0).toDateString();
  assert.ok(list.filter(d => new Date(d.when.date).toDateString() === today).length >= 3, 'на сегодня меньше трёх');
  // получатели, телефоны и адреса явно демонстрационные; строки — настоящие товары каталога
  for (const d of list) {
    assert.match(d.to.phone, /^\+7 900 000-00-\d\d$/, d.id);
    assert.ok(/-пример \d+$/.test(d.to.name) || /^Склад: /.test(d.to.name), `${d.id}: получатель ${d.to.name}`);
    if (d.purpose === 'transfer') assert.equal(d.address, 'нет данных: адрес', `${d.id}: адрес склада подставлен выдуманный`);
    else assert.match(d.address, /\(пример\)$/, d.id);
    assert.ok(d.items.length >= 1);
    for (const it of d.items) {
      if (it.productId) assert.ok(st.products.some(p => p.id === it.productId), `${d.id}: товара ${it.productId} нет`);
      else assert.match(it.text, /пример/);
    }
  }
  assert.ok(list.some(d => d.items.some(i => i.productId && st.products.find(p => p.id === i.productId).inCatalog)), 'нет ни одного товара из каталога сайта');
  assert.ok(list.some(d => d.files.length && d.files[0].data), 'нет заявки с файлом');
  assert.ok(list.some(d => d.dealId), 'нет заявки из сделки');
  // роль и водители
  const role = st.roles.find(r => r.id === 'driver');
  assert.equal(role.name, 'Водитель');
  assert.equal(role.builtin, true);
  assert.equal(Perms.removeRole(st, 'driver').ok, false, 'встроенную роль удалили');
  const drivers = st.people.filter(p => p.role === 'driver');
  assert.equal(drivers.length, 2);
  assert.ok(drivers.every(p => p.demo === true));
  assert.equal(Perms.can(st, drivers[0].id, 'dispatch'), true);
  for (const k of ['prices', 'firm', 'clients', 'stock', 'sell', 'admin']) assert.equal(Perms.can(st, drivers[0].id, k), false, `у водителя право ${k}`);
  // права dispatch и sell подписаны, раздаются как в таске
  assert.equal(Perms.LIST.find(p => p[0] === 'dispatch')[1], 'Вести отправки');
  assert.equal(Perms.LIST.find(p => p[0] === 'sell')[1], 'Списывать при продаже');
  const who = (r, k) => Perms.can(st, st.people.find(p => p.role === r).id, k);
  for (const r of ['logist', 'warehouse', 'driver', 'director']) assert.equal(who(r, 'dispatch'), true, `dispatch у ${r}`);
  for (const r of ['managerB2b', 'managerB2c', 'rop', 'director']) assert.equal(who(r, 'sell'), true, `sell у ${r}`);
  for (const r of ['managerB2b', 'managerB2c', 'rop', 'engineer']) assert.equal(who(r, 'dispatch'), false, `dispatch у ${r}`);
  for (const r of ['logist', 'warehouse', 'driver', 'engineer', 'chiefEngineer']) assert.equal(who(r, 'sell'), false, `sell у ${r}`);
  // водители назначены на заявки в работе
  assert.ok(list.some(d => d.driverId === drivers[0].id) && list.some(d => d.driverId === drivers[1].id));
  // демо-перемещения не доходят до «В пути» (F1·7): настоящий снимок остатков демо не трогает
  const tr = list.filter(d => d.purpose === 'transfer');
  assert.ok(tr.length >= 3, 'в демо нет перемещений');
  for (const d of tr) assert.ok(['new', 'picking', 'ready', 'cancelled'].includes(d.stageId) && !d.moved, `${d.number}: демо-перемещение увезло товар`);
  const back = list.find(d => d.purpose === 'transfer' && d.stageId === 'cancelled');
  assert.ok(back && !back.moved, 'отменённое перемещение увезло товар');
  // склад перемещения согласован: «В пути» — товар в приходе под номером заявки и ушёл из «откуда»; отмена возвращает
  const ready = list.find(d => d.purpose === 'transfer' && d.stageId === 'ready');
  assert.ok(ready && !ready.moved, 'до «В пути» склад уже тронут');
  const from = it => Stock.grid(st, it.productId).cell(ready.from.entityId, ready.from.cityId);
  const was = ready.items.map(from);
  const r1 = app.Dispatch.setStage(st, ready.id, 'onWay', 'p6', new Date());
  assert.equal(r1.ok, true, r1.reason);
  assert.equal(ready.moved, true);
  ready.items.forEach((it, i) => {
    const inc = Stock.incomingOf(st, it.productId).find(x => x.shipId === ready.number);
    assert.ok(inc && inc.qty >= it.qty, `${ready.number}: товара ${it.productId} нет в пути`);
    assert.equal(from(it), was[i] - it.qty, `${ready.number}: товар ${it.productId} не ушёл из «откуда»`);
  });
  assert.equal(app.Dispatch.setStage(st, ready.id, 'cancelled', 'p6', new Date()).ok, true);
  assert.equal(ready.moved, false, 'отменённое в пути не вернулось');
  assert.deepEqual(ready.items.map(from), was, 'отмена не вернула товар в «откуда»');
  // каждая заявка на сделку и клиента ссылается на живую сделку
  for (const d of list.filter(x => x.dealId)) assert.ok(st.deals.some(x => x.id === d.dealId));
  // ход демо-заявок записан в ленту
  assert.ok(st.feed.filter(f => f.ref.t === 'dispatch').length >= list.length * 2);
  // демо не рассылает уведомления: при первом запуске у логиста не сыплются «Новая заявка»
  assert.ok(!st.notes.some(n => n.kind === 'dispatch'), 'демо-заявки наслали уведомлений');
});

test('Notify: вид «dispatch» известен, подписан для списка уведомлений, получатели — логист и кладовщик', () => {
  const app = load();
  assert.deepEqual(plain(app.Notify.RECIPIENTS.dispatch), ['logist', 'warehouse']);
  assert.equal(app.KIND.dispatch.l, 'Отправки');
  assert.equal(app.Pipes.KINDS.includes('dispatch'), true);
});

// ——— раздел «Отправки» (экран): вид на seed(), форма, карточка, права, уведомления ———
// Экран читает глобальное S; тест берёт состояние seed() страницы (load() поднимает его как запуск) и меняет только «Кто я».
const asPerson = (app, id) => { app.S.me = id; app.S.ui.drawer = null; app.S.ui.dispatch = null; app.S.view = 'dispatch'; return app.S; };
const personWith = (app, role) => app.S.people.find(p => p.role === role).id;
// Поля формы в заглушке DOM: значения ставит тест, как ввёл бы человек
const fill = (app, values) => { for (const [id, v] of Object.entries(values)) app.document.getElementById(id).value = v; };
const ALL = { 'dsp-name': 'Клиент-пример 77', 'dsp-phone': '+7 900 000-00-77', 'dsp-address': 'г. Иркутск, ул. Примерная, 77 (пример)', 'dsp-date': '2026-11-05', 'dsp-from': '', 'dsp-till': '', 'dsp-note': '' };

test('раздел «Отправки»: в меню у менеджера, водителя и роли, созданной директором; в виде — заявки со seed()', () => {
  const app = load(), { Perms } = app;
  const role = Perms.addRole(app.S, 'Бухгалтер-проверка', {});
  assert.ok(role, 'роль не создалась');
  app.S.people.push({ id: 'pAcc', name: 'Тест Бухгалтер', role: role.id, dept: 'sales', demo: true });
  const who = [['менеджер', personWith(app, 'managerB2b')], ['водитель', personWith(app, 'driver')], ['своя роль директора', 'pAcc']];
  for (const [label, id] of who) {
    asPerson(app, id);
    const nav = app.navItems().find(n => n.id === 'dispatch');
    assert.ok(nav, `${label}: раздела «Отправки» нет в меню`);
    assert.equal(nav.label, 'Отправки');
    const html = app.vDispatch();
    assert.ok(html.includes('Новая отправка'), `${label}: нет кнопки «Новая отправка»`);
    assert.equal((html.match(/data-act="open-dispatch"/g) || []).length >= app.S.dispatches.length, true, `${label}: показаны не все заявки`);
    assert.ok(html.includes('ОТ-004') && html.includes('Клиент-пример 4'), `${label}: нет заявки ОТ-004`);
  }
});

test('«Назначены мне»: у водителя вверху раздела — его открытые заявки; у менеджера блока нет', () => {
  const app = load();
  const drv = personWith(app, 'driver');
  asPerson(app, drv);
  const html = app.vDispatch();
  assert.ok(html.includes('Назначены мне'));
  const mineBlock = html.slice(html.indexOf('dsp-mine'), html.indexOf('<p class="hint">'));
  // ОТ-004 назначена Роману и в пути (демо), ОТ-017 — Василию и закрыта, ОТ-016 — Роману, но отменена
  assert.ok(mineBlock.includes('ОТ-004'), 'назначенная открытая заявка не показана');
  assert.ok(!mineBlock.includes('ОТ-017'), 'в блок попала чужая заявка');
  assert.ok(!mineBlock.includes('ОТ-016'), 'в блок попала закрытая заявка');
  asPerson(app, personWith(app, 'managerB2b'));
  assert.ok(!app.vDispatch().includes('Назначены мне'));
});

test('форма «Новая отправка»: без адреса не сохраняется и называет «адрес»; с адресом создаёт заявку', () => {
  const app = load(), { Dispatch } = app;
  const S = asPerson(app, personWith(app, 'managerB2b'));
  const n = S.dispatches.length, pid = S.products.find(p => p.inCatalog).id;
  app.openDispatchNew({ items: [{ productId: pid, qty: 1 }] });
  assert.ok(S.ui.modal && S.ui.modal.type === 'dispatchForm');
  fill(app, { ...ALL, 'dsp-address': '' });
  app.FORMS.dispatch({ dataset: {} });
  const err = app.document.getElementById('dsp-err');
  assert.ok(/адрес/.test(err.textContent), `ошибка не называет адрес: «${err.textContent}»`);
  assert.equal(err.hidden, false);
  assert.equal(S.dispatches.length, n, 'заявка без адреса сохранилась');
  fill(app, ALL);
  app.FORMS.dispatch({ dataset: {} });
  assert.equal(S.dispatches.length, n + 1);
  const d = S.dispatches[S.dispatches.length - 1];
  assert.deepEqual(plain([d.to.name, d.address, d.items.length, d.by]), ['Клиент-пример 77', 'г. Иркутск, ул. Примерная, 77 (пример)', 1, S.me]);
  assert.equal(Dispatch.byId(S, d.id).stageId, 'new');
});

test('форма: данные из сделки подставляются в поля; у перемещения — склады и адрес склада-получателя вместо поля адреса', () => {
  const app = load();
  const S = asPerson(app, personWith(app, 'managerB2b'));
  app.openDispatchNew({ purpose: 'transfer', dealId: 'Д-311', to: { name: 'Склад: проверка', phone: '+7 900 000-00-01' }, when: { date: new Date(2026, 10, 5) } });
  const html = app.document.getElementById('modal-root').innerHTML;
  assert.ok(html.includes('value="Склад: проверка"') && html.includes('value="2026-11-05"'), 'поля формы не заполнены данными');
  assert.ok(html.includes('Склад «откуда»') && html.includes('Склад «куда»'), 'нет складов перемещения');
  assert.ok(!html.includes('id="dsp-address"'), 'у перемещения поле адреса должно быть заменено подсказкой');
  assert.equal(S.ui.dspDraft.dealId, 'Д-311');
  // адрес склада-получателя: у города адрес не заполнен — «нет данных: адрес»; заполнили — подставился
  assert.ok(app.dspAddrHint({ toE: 'ip', toC: 'msk' }).includes('нет данных: адрес'));
  S.cities.find(c => c.id === 'msk').address = 'г. Москва, склад-проверка';
  assert.ok(app.dspAddrHint({ toE: 'ip', toC: 'msk' }).includes('г. Москва, склад-проверка'));
});

test('подсказка «свободно N» у товара из каталога равна Stock.summary(...).free (с учётом резервов, а не просто остатку)', () => {
  const app = load(), { Stock } = app;
  const S = app.S;
  // товар, у которого свободно не равно остатку: часть под резервом
  const p = S.products.find(x => { const k = Stock.summary(S, x.id); return k.known && k.reservedStock > 0 && k.free > 0 && k.free < 1000 && k.onHand !== k.free; });
  assert.ok(p, 'в демо нет товара с резервом для проверки');
  const k = Stock.summary(S, p.id);
  const hint = app.dspFreeText(p.id);
  assert.ok(new RegExp(`^свободно ${k.free}( |$)`).test(hint), `подсказка «${hint}», ожидалось «свободно ${k.free}»`);
  // та же подсказка в результатах поиска и в строке списка формы
  assert.ok(app.dspPresHtml(p.name.slice(0, 25)).includes(hint));
  assert.ok(app.dspItemsHtml({ items: [{ productId: p.id, qty: 1 }] }).includes(hint));
  // товара без остатков в таблице — честное «нет данных»
  const none = S.products.find(x => !Stock.summary(S, x.id).known);
  assert.equal(app.dspFreeText(none.id), 'остаток: нет данных');
});

test('карточка заявки: «Позвонить» (tel:), «Скопировать адрес», «собрано N из M», лента; без адреса копировать нечего', () => {
  const app = load();
  const S = asPerson(app, personWith(app, 'logist'));
  const c = app.DRAWERS.dispatch('ОТ-004');
  assert.ok(c.body.includes('href="tel:+79000000004"'), 'нет ссылки tel: на телефон +7 900 000-00-04');
  assert.ok(c.body.includes('Позвонить'));
  assert.ok(c.body.includes('Скопировать адрес'));
  assert.ok(c.body.includes('собрано 2 из 2'));
  assert.ok(c.body.includes('class="feed"') && c.body.includes('Заявка создана'), 'нет ленты заявки');
  assert.ok(c.title.includes('Клиент-пример 4') && c.kind.includes('ОТ-004'));
  // перемещение без адреса склада: адрес — «нет данных», копировать нечего
  const tr = S.dispatches.find(d => d.purpose === 'transfer' && d.address === app.Dispatch.NO_ADDRESS);
  const body = app.DRAWERS.dispatch(tr.id).body;
  assert.ok(body.includes('нет данных: адрес') && !body.includes('Скопировать адрес'));
  assert.ok(body.includes('Позвонить'));
  assert.equal(app.DRAWERS.dispatch('ОТ-999'), null);
});

test('карточка: кнопки этапов — по canWork, «Отменить» — по canCancel; чужой менеджер не видит ни того ни другого', () => {
  const app = load(), { Dispatch } = app;
  const S = app.S;
  const mgr = personWith(app, 'managerB2b'), other = S.people.find(p => p.role === 'managerB2b' && p.id !== mgr).id;
  const id = Dispatch.create(S, { purpose: 'sale', to: { name: 'Клиент-пример 78', phone: '+7 900 000-00-78' }, address: 'г. Иркутск, ул. Примерная, 78 (пример)', when: { date: new Date(2026, 10, 5) }, items: [{ text: 'Образцы', qty: 1 }] }, mgr, new Date(2026, 10, 1)).id;
  const body = who => { asPerson(app, who); return app.DRAWERS.dispatch(id).body; };
  const stages = who => (body(who).match(/data-act="dsp-stage"/g) || []).length;
  const cancel = who => body(who).includes('data-act="dsp-cancel-ask"');
  assert.equal(stages(personWith(app, 'logist')), 4, 'у логиста должно быть 4 перехода (без текущего и без отмены)');
  assert.equal(cancel(personWith(app, 'logist')), true);
  assert.equal(stages(mgr), 0, 'автор без права двигает этапы');
  assert.equal(cancel(mgr), true, 'автор не может отменить свою заявку');
  assert.equal(stages(other), 0);
  assert.equal(cancel(other), false, 'чужой менеджер видит «Отменить»');
  assert.ok(body(other).includes('Двигать этапы могут'));
  // «собрано» — галочки доступны только тем, кто ведёт отправки
  assert.ok(/<input type="checkbox"[^>]* disabled/.test(body(mgr)));
  assert.ok(!/<input type="checkbox"[^>]* disabled/.test(body(personWith(app, 'warehouse'))));
});

test('карточка: файлы — картинка миниатюрой, остальное названием и размером, не поместившееся — с пометкой', () => {
  const app = load(), { Dispatch } = app;
  const S = asPerson(app, personWith(app, 'logist'));
  const files = [
    { name: 'фото-груза.png', type: 'image/png', size: 2048, data: 'data:image/png;base64,iVBORw0KGgo=' },
    { name: 'накладная.pdf', type: 'application/pdf', size: 1500000, data: 'data:application/pdf;base64,JVBERi0=' },
    { name: 'архив.zip', type: 'application/zip', size: 9000000, data: null, unsaved: true },
  ];
  const r = Dispatch.create(S, { purpose: 'other', to: { name: 'Клиент-пример 79', phone: '+7 900 000-00-79' }, address: 'г. Иркутск, ул. Примерная, 79 (пример)', when: { date: new Date(2026, 10, 5) }, items: [{ text: 'Документы', qty: 1 }], files, note: 'Пример примечания: проверка' }, S.me, new Date(2026, 10, 1));
  assert.equal(r.ok, true, r.reason);
  const body = app.DRAWERS.dispatch(r.id).body;
  assert.ok(/<img src="data:image\/png;base64,iVBORw0KGgo=" alt="фото-груза.png">/.test(body), 'картинка не показана миниатюрой');
  assert.ok(body.includes('data-act="dsp-file"'), 'картинку нельзя открыть крупно');
  assert.ok(body.includes('накладная.pdf') && body.includes('1,4 МБ') && body.includes('download="накладная.pdf"'), 'документ не показан названием и размером со ссылкой');
  assert.ok(body.includes('архив.zip') && body.includes('не сохранено — мало места в браузере'), 'нет пометки у файла, который не поместился');
  assert.ok(!body.includes('href="null"'), 'у несохранённого файла есть ссылка');
  assert.ok(body.includes('Пример примечания: проверка'));
  // открыть крупно: окно с картинкой
  const f = S.dispatches.find(d => d.id === r.id).files[0];
  assert.ok(app.MODALS.dspFile(r.id + '|' + f.id).includes('class="dsp-big"'));
});

test('Feed.canComment для отправки: комментирует любой сотрудник — автор, исполнители и чужой менеджер; чужого сотрудника и чужой заявки нет', () => {
  const app = load(), { Feed, Dispatch } = app;
  const st = world(app);
  const id = make(app, st, sale(), 'mgr'), ref = { t: 'dispatch', id };
  assert.equal(Feed.canComment(st, 'mgr', ref), true, 'автор не может комментировать свою заявку');
  assert.equal(Feed.canComment(st, 'log', ref), true);
  assert.equal(Feed.canComment(st, 'drv', ref), true);
  assert.equal(Feed.canComment(st, 'mgr2', ref), true, 'чужой менеджер не может комментировать: раздел видят все');
  assert.equal(Feed.canComment(st, 'нет-такого', ref), false);
  assert.equal(Feed.canComment(st, 'mgr2', { t: 'dispatch', id: 'ОТ-999' }), false);
  assert.equal(Feed.comment(st, ref, 'Комментарий автора', 'mgr', later(1)).ok, true);
  assert.equal(Feed.comment(st, ref, 'Чужой', 'mgr2', later(2)).ok, true);
  // в карточке форма комментария — и у автора, и у чужого менеджера
  const S = app.S, author = personWith(app, 'managerB2b');
  const mine = Dispatch.create(S, sale({ items: [{ text: 'Образцы', qty: 1 }] }), author, later(3));
  assert.equal(mine.ok, true, mine.reason);
  asPerson(app, author);
  assert.ok(app.feedHtml({ t: 'dispatch', id: mine.id }).includes('data-form="feed-comment"'));
  asPerson(app, S.people.find(p => p.role === 'managerB2c').id);
  assert.ok(app.feedHtml({ t: 'dispatch', id: mine.id }).includes('data-form="feed-comment"'), 'у чужого менеджера нет формы комментария');
});

test('уведомления: смену этапа чужой заявки получает автор, логист и кладовщик — нет; назначение — только водитель', () => {
  const app = load(), { Dispatch, Notify } = app;
  const st = world(app);
  const id = make(app, st, sale(), 'mgr');
  const before = st.notes.length;
  assert.equal(go(app, st, id, 'picking', 'wh', 1).ok, true);
  assert.equal(go(app, st, id, 'ready', 'log', 2).ok, true);
  assert.equal(Dispatch.assign(st, id, 'drv', 'log', later(3)).ok, true);
  const added = st.notes.slice(0, st.notes.length - before);
  assert.equal(added.length, 3);
  assert.ok(added.every(n => n.kind === 'dispatchStep'), 'ход заявки идёт отдельным видом');
  const stage = added.filter(n => n.text.includes('на этап'));
  assert.deepEqual(plain(stage.map(n => n.to)), [['mgr'], ['mgr']], 'смену этапа получает только автор');
  assert.deepEqual(plain(added.find(n => n.text.includes('назначена')).to), ['drv'], 'назначение получает только водитель');
  for (const p of ['log', 'wh']) {
    assert.equal(Notify.unread(st, p).filter(n => n.kind === 'dispatchStep').length, 0, `${p} получил ход чужой заявки`);
  }
  assert.deepEqual(plain(Notify.RECIPIENTS.dispatchStep), [], 'у хода заявки не должно быть постоянных адресатов');
});

test('воронка: контейнер колонок с data-hscroll, колонка на каждый этап, карточки по этапам; перетаскивание идёт через setStage', () => {
  const app = load(), { Dispatch } = app;
  const S = asPerson(app, personWith(app, 'logist'));
  S.ui.dispatch = { view: 'funnel' };
  const html = app.vDispatch();
  assert.ok(html.includes('data-hscroll'), 'контейнер колонок без data-hscroll');
  for (const st of ['new', 'picking', 'ready', 'onWay', 'delivered', 'cancelled']) {
    const block = html.split(`data-dspcol="${st}"`)[1].split('data-dspcol=')[0];
    assert.equal((block.match(/class="tcard dspcard/g) || []).length, S.dispatches.filter(d => d.stageId === st).length, `в колонке ${st} лишние или пропавшие карточки`);
  }
  // перетаскивание: ОТ-009 (Новая) на «Собирается»
  assert.equal(Dispatch.byId(S, 'ОТ-009').stageId, 'new');
  assert.ok(app.dspMove('ОТ-009', 'picking'));
  assert.equal(Dispatch.byId(S, 'ОТ-009').stageId, 'picking');
  // автор без права двигать этапы не может: заявка остаётся на месте
  asPerson(app, personWith(app, 'managerB2b'));
  assert.equal(app.dspMove('ОТ-010', 'picking'), null);
  assert.equal(Dispatch.byId(S, 'ОТ-010').stageId, 'new');
});

test('фильтры раздела: поиск по номеру, этап, водитель, «На сегодня», «Мои» — в виде только подходящие заявки', () => {
  const app = load();
  const S = asPerson(app, personWith(app, 'logist'));
  const rows = html => [...html.matchAll(/data-act="open-dispatch" data-id="([^"]+)" tabindex/g)].map(m => m[1]);
  S.ui.dispatch = { q: 'ОТ-004' };
  assert.deepEqual(rows(app.dspBody()), ['ОТ-004']);
  S.ui.dispatch = { stage: 'cancelled' };
  assert.deepEqual(rows(app.dspBody()).sort(), plain(S.dispatches.filter(d => d.stageId === 'cancelled').map(d => d.id).sort()));
  const drv = personWith(app, 'driver');
  S.ui.dispatch = { driver: drv };
  assert.deepEqual(rows(app.dspBody()).sort(), plain(S.dispatches.filter(d => d.driverId === drv).map(d => d.id).sort()));
  S.ui.dispatch = { today: true };
  const today = new Date().toDateString();
  assert.deepEqual(rows(app.dspBody()).sort(), plain(S.dispatches.filter(d => new Date(d.when.date).toDateString() === today).map(d => d.id).sort()));
  // «Мои» — автор или водитель: у водителя это назначенные ему
  asPerson(app, drv);
  S.ui.dispatch = { mine: true };
  const mine = plain(S.dispatches.filter(d => d.by === drv || d.driverId === drv).map(d => d.id).sort());
  assert.ok(mine.length > 0);
  assert.deepEqual(rows(app.dspBody()).sort(), mine);
});

test('бейдж раздела: назначенные мне открытые; у ведущих отправки — ещё открытые на сегодня', () => {
  const app = load();
  const S = app.S, now = new Date();
  const open = d => !['delivered', 'cancelled'].includes(d.stageId);
  const sameDay = d => new Date(d.when.date).toDateString() === now.toDateString();
  const drv = personWith(app, 'driver');
  const want = S.dispatches.filter(d => open(d) && (d.driverId === drv || sameDay(d))).length;
  assert.ok(want > 0);
  assert.equal(app.dspBadge(S, drv, now), want);
  // менеджер без права и без назначений — ноль: чужие заявки на сегодня его не касаются
  assert.equal(app.dspBadge(S, personWith(app, 'managerB2b'), now), 0);
  assert.equal(app.NAV.find(n => n.id === 'dispatch').ok(), true);
});

test('правка своей заявки: автор открывает форму, поля заполнены, сохранение меняет заявку; в работе — отказ', () => {
  const app = load(), { Dispatch } = app;
  const S = app.S, mgr = personWith(app, 'managerB2b');
  const id = Dispatch.create(S, { purpose: 'sale', to: { name: 'Клиент-пример 80', phone: '+7 900 000-00-80' }, address: 'г. Иркутск, ул. Примерная, 80 (пример)', when: { date: new Date(2026, 10, 5) }, items: [{ text: 'Образцы', qty: 2 }], note: 'старое' }, mgr, new Date(2026, 10, 1)).id;
  asPerson(app, mgr);
  app.openDispatchEdit(id);
  const html = app.document.getElementById('modal-root').innerHTML;
  assert.ok(html.includes('Заявка ' + id) && html.includes('value="Клиент-пример 80"') && html.includes('Образцы') && html.includes('старое'));
  fill(app, { ...ALL, 'dsp-name': 'Клиент-пример 80', 'dsp-note': 'новое примечание', 'dsp-address': 'г. Иркутск, ул. Примерная, 80 (пример)' });
  app.FORMS.dispatch({ dataset: {} });
  assert.equal(Dispatch.byId(S, id).note, 'новое примечание');
  assert.equal(Dispatch.byId(S, id).items[0].text, 'Образцы', 'строка пропала при правке');
  // заявка ушла в работу — автор больше не правит
  Dispatch.setStage(S, id, 'picking', personWith(app, 'warehouse'), new Date(2026, 10, 1, 13));
  S.ui.modal = null;
  app.openDispatchEdit(id);
  assert.equal(S.ui.modal, null, 'форма правки открылась у заявки в работе');
  assert.ok(!app.DRAWERS.dispatch(id).body.includes('data-act="dsp-edit"'));
});

test('сохранение страницы: файлы заявок не поместились — тост говорит об этом один раз, а не при каждом сохранении', () => {
  const app = load(), { Dispatch, Store } = app;
  const S = asPerson(app, personWith(app, 'logist'));
  const toasts = [];
  app.document.getElementById('toasts').appendChild = el => toasts.push(el.innerHTML);
  // файл больше 2 МБ не прикрепить (Store.FILE_MAX): не влезают три файла в пределе, вместе больше Store.LIMIT
  const n = Math.ceil(Store.LIMIT / 3) + 1000;
  assert.ok(n < Store.FILE_MAX);
  const big = 'data:text/plain;base64,' + 'A'.repeat(n);
  const r = Dispatch.create(S, { purpose: 'other', to: { name: 'Клиент-пример 81', phone: '+7 900 000-00-81' }, address: 'г. Иркутск, ул. Примерная, 81 (пример)', when: { date: new Date(2026, 10, 5) }, items: [{ text: 'Документы', qty: 1 }], files: [1, 2, 3].map(k => ({ name: `большой-${k}.txt`, type: 'text/plain', size: big.length, data: big })) }, S.me, new Date(2026, 10, 1));
  assert.equal(r.ok, true, r.reason);
  assert.equal(app.save().ok, true);
  assert.equal(toasts.filter(t => t.includes('Файлы не сохранены — мало места в браузере')).length, 1, `тост про файлы заявок: ${JSON.stringify(toasts)}`);
  app.save();
  assert.equal(toasts.filter(t => t.includes('не сохранены')).length, 1, 'тост повторяется при каждом сохранении');
  // в сохранении файла нет, у файла пометка — после перезагрузки карточка говорит «не сохранено»
  const saved = JSON.parse(app.storage[Store.KEY]);
  const fs = saved.dispatches.find(d => d.id === r.id).files;
  const lost = fs.filter(f => f.unsaved === true && f.data === null);
  assert.ok(lost.length >= 1, 'ни один файл не помечен');
  assert.ok(fs.some(f => f.data === big && !f.unsaved), 'выкинуты все файлы, а не только те, что не влезли');
});

// ——— третий кусок: карточка товара с грузом в пути, списание из карточки, сделка, дела, клиент ———
test('карточка товара: груз перемещения в пути показан как «в пути: N, ОТ-NNN» со ссылкой на заявку и не падает; резерв под приход ему не предлагается', () => {
  const app = load(), { Stock } = app;
  const S = app.S;
  // демо-перемещения до «В пути» не доходят (F1·7): отправляем в путь готовые
  const go = S.dispatches.filter(d => d.purpose === 'transfer' && d.stageId === 'ready');
  assert.ok(go.length >= 2, 'в демо нет готовых к отправке перемещений');
  for (const d of go) { const r = app.Dispatch.setStage(S, d.id, 'onWay', 'p6', new Date()); assert.equal(r.ok, true, r.reason); }
  const ids = S.products.map(p => p.id).filter(id => Stock.incomingOf(S, id).some(x => x.dispatchId));
  for (const id of new Set(go.flatMap(d => d.items.map(it => it.productId)))) assert.ok(ids.includes(id), `у ${id} нет груза в пути`);
  for (const id of ids) {
    const mine = Stock.incomingOf(S, id).filter(x => x.dispatchId);
    let card;
    assert.doesNotThrow(() => { card = app.DRAWERS.product(id); }, `карточка ${id} упала`);
    for (const x of mine) {
      assert.ok(card.body.includes(x.shipId), `в карточке ${id} нет ${x.shipId}`);
      assert.ok(card.body.includes(`data-act="open-dispatch" data-id="${x.dispatchId}"`), `нет ссылки на заявку ${x.dispatchId}`);
      assert.ok(new RegExp(`в пути: [^<]*${x.qty}[^<]*, <button[^>]*>${x.shipId}</button>`).test(card.body), `нет «в пути: N, ${x.shipId}» в карточке ${id}`);
      assert.ok(!card.body.includes(`<option value="${x.shipId}"`), `груз ${x.shipId} предложен как поставка для резерва`);
    }
    // настоящие поставки в резерв по-прежнему предлагаются
    for (const x of Stock.incomingOf(S, id).filter(y => !y.dispatchId)) assert.ok(card.body.includes(`<option value="${x.shipId}"`), `поставка ${x.shipId} пропала из резерва`);
  }
});

test('Stock.sell без резерва: чужой резерв не даёт списать сверх свободного в клетке; по своему резерву — в его пределах', () => {
  const app = load(), { Stock } = app;
  const st = world(app);
  st.stock.pv.ip.msk = 8;   // вторая клетка: резерв в Иркутске ей не мешает
  // в Иркутске 10: под Д-1 зарезервировано 6 — свободно 4
  const res = Stock.reserve(st, { productId: 'pv', qty: 6, ...IRK, dealId: 'Д-1', by: 'mgr', at: NOW });
  assert.equal(res.ok, true, res.reason);
  const sell = (qty, extra = {}) => Stock.sell(st, { productId: 'pv', qty, ...IRK, doc: 'Д-2', ...extra }, 'mgr2', NOW);
  const before = JSON.stringify([st.stock, st.reserves, st.moves]);
  const over = sell(5);
  assert.equal(over.ok, false, 'списан товар, зарезервированный под Д-1');
  assert.match(over.reason, /резерв/);
  assert.match(over.reason, /только 4/, 'причина не называет, сколько можно');
  assert.equal(JSON.stringify([st.stock, st.reserves, st.moves]), before, 'отказ что-то изменил');
  assert.equal(Stock.sellMax(st, { productId: 'pv', ...IRK }), 4);
  assert.equal(Stock.sellMax(st, { productId: 'pv', ...MSK }), 8, 'резерв Иркутска ограничил Москву');
  assert.equal(Stock.sell(st, { productId: 'pv', qty: 8, ...MSK, doc: 'Д-2' }, 'mgr2', NOW).ok, true);
  // ровно свободное — можно; после этого свободное по товару не ушло в минус, резерв цел
  assert.equal(sell(4).ok, true);
  assert.equal(cell(app, st, 'pv', IRK), 6);
  assert.equal(st.reserves[0].qty, 6);
  assert.equal(Stock.summary(st, 'pv', NOW).free, 0, 'свободно по товару: 6 в клетке − 6 в резерве');
  assert.equal(sell(1).ok, false, 'списан последний зарезервированный');
  assert.equal(Stock.sellMax(st, { productId: 'pv', ...IRK }), 0);
  // по своему резерву — в его пределах, не больше
  assert.equal(Stock.sellMax(st, { productId: 'pv', reserveId: res.reserve.id }), 6);
  assert.equal(sell(7, { reserveId: res.reserve.id }).ok, false);
  assert.equal(sell(6, { reserveId: res.reserve.id }).ok, true);
  assert.equal(cell(app, st, 'pv', IRK), 0);
  assert.equal(st.reserves.length, 0);
  // резерв под поставку клетку не занимает: на складе этого товара ещё нет
  const st2 = world(app, { shipments: [{ id: 'П-1', dir: 'in', pipeId: 'ship-in', stageId: 'x', eta: NOW, items: [{ productId: 'pv', qty: 5 }], entityId: 'ip', cityId: 'irk' }] });
  st2.reserves.push({ id: 'r1', productId: 'pv', qty: 5, entityId: 'ip', cityId: 'irk', src: 'П-1', dealId: 'Д-3' });
  assert.equal(Stock.sellMax(st2, { productId: 'pv', ...IRK }), 10);
});

test('карточка товара: «Списать при продаже» у клетки и у резерва только с правом sell; окно спрашивает клетку, сколько и документ; отказ называет причину', () => {
  const app = load(), { Stock } = app;
  const S = asPerson(app, personWith(app, 'managerB2b'));
  const p = S.products.find(x => !S.reserves.some(r => r.productId === x.id) && Stock.grid(S, x.id).totals.all >= 5);
  const g = Stock.grid(S, p.id);
  const one = g.rows.flatMap(r => g.cols.map(c => ({ e: r.id, c: c.id, n: g.cell(r.id, c.id) }))).find(x => x.n >= 5);
  const card = pid => app.DRAWERS.product(pid).body;
  // кнопки: у клетки с остатком и у резерва со склада; у резерва под поставку (на складе товара нет) — нет
  assert.ok(card(p.id).includes(`data-act="stock-sell" data-pid="${p.id}" data-e="${one.e}" data-c="${one.c}"`), 'нет кнопки у клетки');
  // резервы сделок, которые этот менеджер видит (F1: чужие резервы карточка показывает без кнопок)
  const seen = new Set(app.Leads.dealsVisible(S, S.me).map(d => d.id));
  const rs = S.reserves.find(r => r.src === 'stock' && seen.has(r.dealId)), inbound = S.reserves.find(r => r.src !== 'stock' && seen.has(r.dealId));
  assert.ok(card(rs.productId).includes(`data-act="stock-sell" data-pid="${rs.productId}" data-rid="${rs.id}"`), 'нет кнопки у резерва');
  assert.ok(!card(inbound.productId).includes(`data-rid="${inbound.id}"`), 'резерв под поставку можно «списать»');
  // без права sell (логист видит склад) кнопок нет
  asPerson(app, personWith(app, 'logist'));
  assert.ok(!card(p.id).includes('stock-sell') && !card(rs.productId).includes('stock-sell'), 'кнопка есть у логиста без права sell');
  asPerson(app, personWith(app, 'managerB2b'));
  // окно: клетка, сколько, документ; подсказка «Можно списать» — Stock.sellMax
  app.A['stock-sell']({ dataset: { pid: p.id, e: one.e, c: one.c } });
  const html = app.document.getElementById('modal-root').innerHTML;
  assert.ok(S.ui.modal && S.ui.modal.type === 'stockSell');
  assert.ok(html.includes('id="ps-src"') && html.includes('id="ps-qty"') && html.includes('id="ps-doc"'), 'в окне нет клетки, количества или документа');
  assert.ok(html.includes(`Можно списать: ${Stock.sellMax(S, { productId: p.id, entityId: one.e, cityId: one.c })}`), 'подсказка не равна Stock.sellMax');
  // больше, чем в клетке, — отказ с причиной, склад не тронут
  const before = JSON.stringify(S.stock[p.id]), moves = S.moves.length;
  fill(app, { 'ps-src': `c:${one.e}|${one.c}`, 'ps-qty': String(one.n + 1), 'ps-doc': 'Д-тест' });
  app.FORMS['stock-sell']({ dataset: { pid: p.id } });
  const err = app.document.getElementById('ps-err');
  assert.equal(err.hidden, false);
  assert.match(err.textContent, new RegExp(`только ${one.n}, а нужно ${one.n + 1}`));
  assert.equal(JSON.stringify(S.stock[p.id]), before);
  assert.equal(S.moves.length, moves);
  // два списано: остаток клетки −2, в журнале «Отгрузка» с документом, окно закрыто
  fill(app, { 'ps-qty': '2' });
  app.FORMS['stock-sell']({ dataset: { pid: p.id } });
  assert.equal(Stock.grid(S, p.id).cell(one.e, one.c), one.n - 2);
  assert.deepEqual(plain([S.moves[0].kind, S.moves[0].qty, S.moves[0].doc, S.moves[0].by]), ['Отгрузка', 2, 'Д-тест', S.me]);
  assert.equal(S.ui.modal, null);
  // по резерву: резерв уменьшился, клетка −qty, свободное по товару то же
  const free = Stock.summary(S, rs.productId).free, cellBefore = Stock.grid(S, rs.productId).cell(rs.entityId, rs.cityId), qty = rs.qty;
  app.A['stock-sell']({ dataset: { pid: rs.productId, rid: rs.id } });
  const rhtml = app.document.getElementById('modal-root').innerHTML;
  assert.ok(rhtml.includes(`value="${qty}"`) && rhtml.includes(`value="${rs.dealId}"`), 'сколько и документ из резерва не подставлены');
  fill(app, { 'ps-src': 'r:' + rs.id, 'ps-qty': '3', 'ps-doc': rs.dealId });
  app.FORMS['stock-sell']({ dataset: { pid: rs.productId } });
  assert.equal(S.reserves.find(r => r.id === rs.id).qty, qty - 3);
  assert.equal(Stock.grid(S, rs.productId).cell(rs.entityId, rs.cityId), cellBefore - 3);
  assert.equal(Stock.summary(S, rs.productId).free, free, 'списание по резерву поменяло свободный остаток');
});

test('дела по отправке: Acts знает заявку — дело ставится, пока заявка не закрыта; закрыта (final-этап) — дел нет; в ленте отправки есть «Запланировать» и дела', () => {
  const app = load(), { Acts, Feed } = app;
  const st = world(app);
  const id = make(app, st, sale(), 'mgr'), ref = { t: 'dispatch', id };
  assert.ok(Acts.REFS.includes('dispatch'));
  assert.equal(Acts.alive(st, ref), true);
  assert.equal(Acts.alive(st, { t: 'dispatch', id: 'ОТ-999' }), false, 'нет такой заявки');
  assert.equal(Acts.refTitle(st, ref), 'Отправка ОТ-001 (Клиент-пример 1)');
  // дело ставят и выполняют; выполненное попадает в ленту заявки
  const a = Acts.plan(st, ref, { type: 'call', title: 'Позвонить получателю', due: new Date(NOW.getTime() - 3600000), ownerId: 'wh', remind: 0 }, 'log', NOW);
  assert.equal(a.ok, true, a.reason);
  assert.deepEqual(plain(Acts.open(st, ref).map(x => x.title)), ['Позвонить получателю']);
  assert.deepEqual(plain(Acts.counts(st, 'wh', NOW)), { today: 0, overdue: 1 }, 'просроченное дело отправки не посчитано');
  const note = Acts.notify(st, NOW);
  assert.equal(note.length, 1);
  assert.match(note[0].text, /Отправка ОТ-001 \(Клиент-пример 1\)/);
  assert.equal(Acts.done(st, a.id, 'Дозвонился, ждёт', 'wh', later(5)).ok, true);
  assert.ok(Feed.of(st, ref).some(e => e.kind === 'act' && /Дозвонился/.test(e.text)), 'выполненное дело не видно в ленте заявки');
  // заявка закрыта — дело поставить некуда, открытые не считаются и не напоминают
  const open = Acts.plan(st, ref, { type: 'todo', title: 'Приложить накладную', due: new Date(NOW.getTime() - 60000), ownerId: 'log', remind: 0 }, 'log', NOW);
  assert.equal(open.ok, true, open.reason);
  assert.equal(go(app, st, id, 'cancelled', 'log', 6).ok, true);
  assert.equal(Acts.alive(st, ref), false);
  assert.equal(Acts.plan(st, ref, { type: 'call', title: 'Ещё', due: later(60) }, 'log', later(7)).ok, false);
  assert.deepEqual(plain(Acts.counts(st, 'log', later(7))), { today: 0, overdue: 0 });
  assert.equal(Acts.notify(st, later(7)).length, 0, 'напоминание по закрытой заявке');
  const id2 = make(app, st, sale(), 'mgr');
  assert.equal(go(app, st, id2, 'delivered', 'log', 8).ok, true);
  assert.equal(Acts.alive(st, { t: 'dispatch', id: id2 }), false, 'доставленная заявка жива');
  // лента в карточке: «Запланировать» и список открытых дел — у живой заявки, у закрытой формы нет
  const S = asPerson(app, personWith(app, 'logist'));
  const mine = app.Dispatch.create(S, sale({ items: [{ text: 'Образцы', qty: 1 }] }), S.me, new Date(2026, 10, 1)).id;
  const plan = app.Acts.plan(S, { t: 'dispatch', id: mine }, { type: 'meet', title: 'Встретить водителя', due: new Date(2026, 10, 3, 10) }, S.me, new Date(2026, 10, 1));
  assert.equal(plan.ok, true, plan.reason);
  const html = app.feedHtml({ t: 'dispatch', id: mine }, S, new Date(2026, 10, 1));
  assert.ok(html.includes('data-form="act-plan"') && html.includes('Встретить водителя'), 'в ленте открытой заявки нет «Запланировать» или дела');
  app.Dispatch.setStage(S, mine, 'delivered', S.me, new Date(2026, 10, 2));
  assert.ok(!app.feedHtml({ t: 'dispatch', id: mine }, S, new Date(2026, 10, 3)).includes('data-form="act-plan"'), 'у закрытой заявки есть «Запланировать»');
});

test('Clients.related: отправки клиента — по его сделкам и по совпавшему телефону получателя (без повторов); в карточке клиента блок «Отправки» со ссылками', () => {
  const app = load(), { Clients, Dispatch } = app;
  const S = asPerson(app, personWith(app, 'director'));
  const ids = (cid, who) => plain(Clients.related(S, cid, who).dispatches.map(d => d.id)).sort();
  // демо: К-4 — клиент сделки Д-311 (заявка ОТ-004 по сделке); К-1 «Клиент-пример 4» — тот же телефон, что у получателя ОТ-004, сделки нет
  assert.deepEqual(ids('К-4', S.me), ['ОТ-004']);
  assert.deepEqual(ids('К-1', S.me), ['ОТ-004'], 'заявка с телефоном клиента не нашлась');
  assert.deepEqual(ids('К-2', S.me), [], 'у клиента без телефонов и сделок нашлись заявки');
  const mk = over => { const r = Dispatch.create(S, sale({ items: [{ text: 'Образцы', qty: 1 }], ...over }), S.me, new Date(2026, 10, 1)); assert.equal(r.ok, true, r.reason); return r.id; };
  // телефон клиента К-4 — +7 900 000-00-31; тот же номер, записанный через 8 и с пробелами, — тот же телефон
  const byPhone = mk({ to: { name: 'Получатель-пример', phone: '8 (900) 000-00-31' } });
  const other = mk({ to: { name: 'Другой-пример', phone: '+7 900 000-00-99' } });
  const both = mk({ dealId: 'Д-311', to: { name: 'Получатель-пример 2', phone: '+7 900 000-00-31' } });
  assert.deepEqual(ids('К-4', S.me), ['ОТ-004', byPhone, both].sort(), 'по телефону и по сделке без повторов');
  assert.deepEqual(ids('К-4'), ['ОТ-004', byPhone, both].sort(), 'без personId — то же');
  assert.ok(!ids('К-4', S.me).includes(other), 'чужой телефон попал в заявки клиента');
  // карточка клиента: блок со ссылками на заявки
  const body = app.DRAWERS.client('К-4').body;
  assert.ok(body.includes('Отправки · 3'), 'нет блока «Отправки · 3»');
  for (const x of ['ОТ-004', byPhone, both]) assert.ok(body.includes(`data-act="open-dispatch" data-id="${x}"`), `нет ссылки на ${x}`);
  assert.ok(!body.includes(`data-id="${other}"`));
  assert.ok(app.DRAWERS.client('К-2').body.includes('Отправок у этого клиента нет'), 'у клиента без заявок нет пометки');
});

test('из сделки: «Создать отправку» открывает форму с клиентом, телефоном, адресом клиента, товарами сделки и dealId; созданная заявка их несёт и видна в ленте сделки', () => {
  const app = load(), { Feed, Clients } = app;
  const S = asPerson(app, personWith(app, 'managerB2b'));
  const deal = S.deals.find(d => d.id === 'Д-311');
  const client = Clients.byId(S, deal.clientId);
  // кнопка в карточке сделки; у проваленной сделки её нет
  const card = () => app.DRAWERS.deal('Д-311').body;
  S.me = S.people.find(p => p.role === 'director').id;
  assert.ok(card().includes('data-act="deal-dispatch" data-id="Д-311"'), 'нет кнопки «Создать отправку» в карточке сделки');
  assert.ok(card().includes('Создать отправку'));
  // клиент без адреса — адрес пуст, не выдуман; есть адрес — подставлен
  app.A['deal-dispatch']({ dataset: { id: 'Д-311' } });
  let draft = S.ui.dspDraft;
  assert.ok(S.ui.modal && S.ui.modal.type === 'dispatchForm');
  assert.deepEqual(plain([draft.name, draft.phone, draft.address, draft.dealId, draft.purpose]), [client.name, deal.phone, '', 'Д-311', 'sale']);
  client.address = 'г. Иркутск, ул. Клиентская, 5 (пример)';
  app.A['deal-dispatch']({ dataset: { id: 'Д-311' } });
  draft = S.ui.dspDraft;
  assert.equal(draft.address, client.address);
  // товары сделки: каталожные — по productId, своя строка — текстом; количества те же
  assert.deepEqual(plain(draft.items), plain(deal.items.map(i => (i.productId ? { productId: i.productId, qty: i.qty } : { text: i.text, qty: i.qty }))));
  // человек вводит дату и сохраняет; в полях — то, что подставила форма
  fill(app, { 'dsp-name': draft.name, 'dsp-phone': draft.phone, 'dsp-address': draft.address, 'dsp-date': '2026-11-05', 'dsp-from': '', 'dsp-till': '', 'dsp-note': '' });
  const n = S.dispatches.length;
  app.FORMS.dispatch({ dataset: {} });
  assert.equal(S.dispatches.length, n + 1, 'заявка из сделки не создалась');
  const d = S.dispatches[S.dispatches.length - 1];
  assert.equal(d.dealId, 'Д-311');
  assert.deepEqual(plain(d.items.map(i => [i.productId || i.text, i.qty])), plain(deal.items.map(i => [i.productId || i.text, i.qty])));
  // отправка видна в ленте сделки: её записи подмешаны и подписаны «Отправка ОТ-NNN»; чужая сделка их не получает
  const feed = Feed.of(S, { t: 'deal', id: 'Д-311' });
  assert.ok(feed.some(e => e.ref.t === 'dispatch' && e.ref.id === d.id && e.kind === 'dispatch' && e.data.was === 'create'), 'создание заявки не видно в ленте сделки');
  assert.ok(feed.some(e => e.ref.t === 'dispatch' && e.ref.id === 'ОТ-004'), 'ранее созданная заявка сделки не видна');
  assert.ok(!feed.some(e => e.ref.t === 'dispatch' && e.ref.id === 'ОТ-005'), 'в ленту попала заявка другой сделки');
  assert.ok(!Feed.of(S, { t: 'deal', id: 'Д-314' }).some(e => e.ref.t === 'dispatch'), 'у сделки без заявок появились записи отправок');
  assert.ok(app.feedHtml({ t: 'deal', id: 'Д-311' }).includes(`Отправка ${d.id}`), 'в ленте сделки нет подписи «Отправка ОТ-NNN»');
  // ход заявки дальше попадает в ленту сделки
  app.Dispatch.setStage(S, d.id, 'picking', S.me, new Date(2026, 10, 2));
  const after = Feed.of(S, { t: 'deal', id: 'Д-311' });
  assert.ok(after.some(e => e.ref.id === d.id && e.kind === 'dispatch' && e.data.was === 'stage'), 'этап заявки не виден в ленте сделки');
  // этапы заявки не путаются с этапами самой сделки: у сделки по-прежнему только её собственные записи «Этап»
  assert.ok(!after.some(e => e.kind === 'stage' && e.ref.t === 'dispatch'), 'этап заявки показан как этап сделки');
  // проваленная сделка — кнопки нет
  app.Deals.lose(S, 'Д-311', 'Передумал', S.me, new Date(2026, 10, 2));
  assert.ok(!card().includes('deal-dispatch'), 'у проваленной сделки есть «Создать отправку»');
});

test('сделка: у строки товара «Списать при продаже» только с правом sell; списание идёт через резерв этой сделки и пишется в её ленту', () => {
  const app = load(), { Stock, Feed } = app;
  const S = app.S;
  const deal = S.deals.find(d => d.id === 'Д-311');
  const rs = S.reserves.find(r => r.dealId === 'Д-311' && r.src === 'stock');
  const pid = rs.productId;
  S.me = S.people.find(p => p.role === 'managerB2b').id;
  const items = () => app.dealItems(deal, true);
  assert.ok(items().includes(`data-act="stock-sell" data-pid="${pid}" data-did="Д-311"`), 'нет «Списать при продаже» у строки товара');
  const own = deal.items.find(i => !i.productId);
  assert.ok(own && (items().match(/data-act="stock-sell"/g) || []).length === deal.items.filter(i => i.productId).length, 'кнопка есть и у своей строки, или не у каждого товара каталога');
  // без права sell (главный инженер видит сделки, но не списывает) кнопки нет
  S.me = S.people.find(p => p.role === 'chiefEngineer').id;
  assert.ok(!items().includes('stock-sell'), 'кнопка есть без права sell');
  S.me = S.people.find(p => p.role === 'managerB2b').id;
  // окно: первым выбран резерв этой сделки, документ — номер сделки
  app.A['stock-sell']({ dataset: { pid, did: 'Д-311' } });
  const html = app.document.getElementById('modal-root').innerHTML;
  assert.ok(html.includes(`<option value="r:${rs.id}" selected>`), 'резерв сделки не выбран по умолчанию');
  assert.ok(html.includes('value="Д-311"'));
  // списали 2: резерв сделки уменьшился, клетка −2, свободное по товару то же, в ленте сделки — запись
  const free = Stock.summary(S, pid).free, cellN = Stock.grid(S, pid).cell(rs.entityId, rs.cityId), q = rs.qty;
  fill(app, { 'ps-src': 'r:' + rs.id, 'ps-qty': '2', 'ps-doc': 'Д-311' });
  app.FORMS['stock-sell']({ dataset: { pid, did: 'Д-311' } });
  assert.equal(S.reserves.find(r => r.id === rs.id).qty, q - 2);
  assert.equal(Stock.grid(S, pid).cell(rs.entityId, rs.cityId), cellN - 2);
  assert.equal(Stock.summary(S, pid).free, free);
  const rec = Feed.of(S, { t: 'deal', id: 'Д-311' }).find(e => e.kind === 'item' && /^Списано при продаже/.test(e.text));
  assert.ok(rec, 'списание не записано в ленту сделки');
  assert.equal(rec.by, S.me);
});

test('карточка заявки «Продажа»: «Списать при продаже» у строки каталога — по праву sell; окно с остатком и резервом сделки; списанная строка — «списано», без кнопки', () => {
  const app = load(), { Dispatch, Stock } = app;
  const S = app.S;
  const mgr = personWith(app, 'managerB2b'), wh = personWith(app, 'warehouse'), log = personWith(app, 'logist');
  const p = S.products.find(x => !S.reserves.some(r => r.productId === x.id) && Stock.grid(S, x.id).totals.all >= 5);
  const g = Stock.grid(S, p.id);
  const one = g.rows.flatMap(r => g.cols.map(c => ({ e: r.id, c: c.id, n: g.cell(r.id, c.id) }))).find(x => x.n >= 5);
  const data = (items, over = {}) => ({ purpose: 'sale', to: { name: 'Клиент-пример 91', phone: '+7 900 000-00-91' }, address: 'г. Иркутск, ул. Примерная, 91 (пример)', when: { date: new Date(2026, 10, 5) }, items, ...over });
  const id = Dispatch.create(S, data([{ productId: p.id, qty: 2 }, { text: 'Образцы (пример)', qty: 1 }]), mgr, NOW).id;
  const body = (who, did = id) => { asPerson(app, who); return app.DRAWERS.dispatch(did).body; };
  const buttons = html => (html.match(/data-act="dsp-sell"/g) || []).length;

  // кнопка: у менеджера с sell — только у строки из каталога (первой), не у «своей строки»
  const mine = body(mgr);
  assert.ok(mine.includes(`data-act="dsp-sell" data-id="${id}" data-i="0"`), 'нет кнопки у строки товара');
  assert.equal(buttons(mine), 1, 'кнопка есть и у своей строки');
  assert.ok(mine.includes('Списать при продаже'));
  // без права sell (кладовщик и логист ведут отправки, но не списывают) — кнопки нет; цель «Перемещение» — тоже
  assert.equal(buttons(body(wh)), 0, 'кнопка есть у кладовщика без права sell');
  assert.equal(buttons(body(log)), 0, 'кнопка есть у логиста без права sell');
  const tr = Dispatch.create(S, data([{ productId: p.id, qty: 1 }], { purpose: 'transfer', address: '', from: { entityId: one.e, cityId: one.c }, toCell: { entityId: S.entities[0].id, cityId: S.cities.find(c => c.id !== one.c).id } }), mgr, NOW);
  assert.equal(tr.ok, true, tr.reason);
  assert.equal(buttons(body(mgr, tr.id)), 0, 'у перемещения есть «Списать при продаже»');

  // окно: «Откуда» и «Можно списать» — по остатку клетки (резервов на товар нет, значит лежит столько, сколько есть)
  asPerson(app, mgr);
  app.A['dsp-sell']({ dataset: { id, i: '0' } });
  const html = app.document.getElementById('modal-root').innerHTML;
  assert.ok(S.ui.modal && S.ui.modal.type === 'dspSell');
  assert.ok(html.includes('id="ps-src"') && html.includes(`value="c:${one.e}|${one.c}"`), 'в окне нет клетки, где лежит товар');
  assert.ok(html.includes(`Можно списать: ${one.n}`), 'подсказка не равна остатку клетки');
  assert.ok(!html.includes('id="ps-qty"'), 'количество должно быть из строки, а не вводиться заново');

  // отказ: в строке больше, чем лежит, — причина в окне, склад и строка не тронуты
  const big = Dispatch.create(S, data([{ productId: p.id, qty: one.n + 1 }]), mgr, NOW).id;
  app.A['dsp-sell']({ dataset: { id: big, i: '0' } });
  fill(app, { 'ps-src': `c:${one.e}|${one.c}` });
  const before = JSON.stringify(S.stock[p.id]), moves = S.moves.length;
  app.FORMS['dsp-sell']({ dataset: { id: big, i: '0' } });
  const err = app.document.getElementById('ps-err');
  assert.equal(err.hidden, false);
  assert.match(err.textContent, new RegExp(`только ${one.n}, а нужно ${one.n + 1}`));
  assert.equal(JSON.stringify(S.stock[p.id]), before);
  assert.equal(S.moves.length, moves);
  assert.equal(Dispatch.byId(S, big).items[0].sold, undefined);
  assert.ok(S.ui.modal, 'после отказа окно закрылось');

  // списали: остаток клетки −2, строка помечена, окно закрыто; кнопки у строки больше нет, а «списано: кто, когда, откуда» есть
  app.A['dsp-sell']({ dataset: { id, i: '0' } });
  fill(app, { 'ps-src': `c:${one.e}|${one.c}` });
  app.FORMS['dsp-sell']({ dataset: { id, i: '0' } });
  assert.equal(Stock.grid(S, p.id).cell(one.e, one.c), one.n - 2);
  assert.equal(S.ui.modal, null);
  for (const who of [mgr, wh]) {
    const after = body(who);
    assert.equal(buttons(after), 0, 'у списанной строки осталась кнопка');
    assert.ok(after.includes('списано: ') && after.includes(Dispatch.soldText(S, Dispatch.byId(S, id).items[0])), 'строка не показывает «списано»');
  }
  assert.ok(body(mgr).includes(app.esc(`${Stock.entityName(S, one.e)}, ${Stock.cityName(S, one.c)}`)), 'в «списано» нет склада, откуда ушёл товар');
});

test('карточка заявки с dealId: в окне списания первым выбран резерв этой сделки; списание идёт по резерву, свободный остаток не меняется', () => {
  const app = load(), { Dispatch, Stock } = app;
  const S = app.S;
  const mgr = personWith(app, 'managerB2b');
  const rs = S.reserves.find(r => r.dealId === 'Д-311' && r.src === 'stock');
  assert.ok(rs && rs.qty >= 2, 'в демо у Д-311 нет резерва со склада');
  const mk = (items, dealId) => Dispatch.create(S, { purpose: 'sale', to: { name: 'Клиент-пример 92', phone: '+7 900 000-00-92' }, address: 'г. Иркутск, ул. Примерная, 92 (пример)', when: { date: new Date(2026, 10, 5) }, items, dealId }, mgr, NOW).id;
  // без сделки резерв не предлагается: только клетки
  asPerson(app, mgr);
  const free = mk([{ productId: rs.productId, qty: 2 }]);
  app.A['dsp-sell']({ dataset: { id: free, i: '0' } });
  assert.ok(!app.document.getElementById('modal-root').innerHTML.includes(`value="r:${rs.id}"`), 'резерв чужой сделки предложен заявке без сделки');
  // со сделкой — резерв Д-311 первым и выбран
  const id = mk([{ productId: rs.productId, qty: 2 }], 'Д-311');
  app.A['dsp-sell']({ dataset: { id, i: '0' } });
  const html = app.document.getElementById('modal-root').innerHTML;
  assert.ok(html.includes(`<option value="r:${rs.id}" selected>`), 'резерв сделки не выбран по умолчанию');
  assert.ok(html.includes(`Можно списать: ${Math.min(rs.qty, Stock.grid(S, rs.productId).cell(rs.entityId, rs.cityId))}`), 'подсказка не равна остатку резерва');
  const k = Stock.summary(S, rs.productId).free, cellN = Stock.grid(S, rs.productId).cell(rs.entityId, rs.cityId), q = rs.qty;
  fill(app, { 'ps-src': 'r:' + rs.id });
  app.FORMS['dsp-sell']({ dataset: { id, i: '0' } });
  assert.equal(S.reserves.find(r => r.id === rs.id).qty, q - 2, 'резерв сделки не уменьшился на 2');
  assert.equal(Stock.grid(S, rs.productId).cell(rs.entityId, rs.cityId), cellN - 2);
  assert.equal(Stock.summary(S, rs.productId).free, k, 'списание по резерву поменяло свободный остаток');
  assert.equal(Dispatch.byId(S, id).items[0].sold.cityId, rs.cityId || Stock.ANY);
});
