'use strict';
// Лиды и сделки (таск 04, ядро): тип по заявке, распределение по менеджерам, действия над лидом,
// создание сделки, видимость лидов и сделок, демо-данные. Экранов лидов здесь нет.
// Ожидаемые значения — из таска 04 и spec.md (истории 48–55), разобраны вручную; не из кода под тестом.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { load } = require('./load.js');
const { loadCode } = require('../tools/vm-load.js');

const NOW = new Date(2026, 9, 31, 12, 0);
const LATER = new Date(2026, 9, 31, 13, 0);

// Маленькое состояние: директор, два менеджера B2B (b1, b2), менеджер B2C (c1), кладовщик.
function mini(app, over = {}) {
  return Object.assign({
    roles: app.Perms.defaultRoles(),
    people: [
      { id: 'dir', name: 'Директор', role: 'director' },
      { id: 'b1', name: 'Менеджер B2B 1', role: 'managerB2b' },
      { id: 'b2', name: 'Менеджер B2B 2', role: 'managerB2b' },
      { id: 'c1', name: 'Менеджер B2C 1', role: 'managerB2c' },
      { id: 'wh', name: 'Кладовщик', role: 'warehouse' },
    ],
    prefs: { notify: {} }, notes: [], leads: [], deals: [], pipelines: app.Pipes.defaults(),
  }, over);
}
// Лид в списке состояния «как есть»: для проверок распределения, видимости и фильтров.
const raw = (id, managerId, stageId = 'new', type = 'b2b') => ({ id, managerId, stageId, pipeId: 'leads', type, history: [] });
const B2B = { source: 'site', name: 'Клиент-пример', company: 'ООО Пример', text: 'Нужна станция для склада' };
const B2C = { source: 'bitrix', name: 'Клиент-пример', phone: '+7 900 000-00-01', text: 'Нужна станция для дома' };
const NONE = { source: 'site', name: 'Клиент-пример' };

test('classify: компания → B2B; только ИНН → B2B; только телефон → B2C; только почта → B2C; ничего → null', () => {
  const { Leads } = load();
  assert.equal(Leads.classify({ company: 'ООО Пример' }), 'b2b');
  assert.equal(Leads.classify({ company: 'ООО Пример', phone: '+7 900 000-00-01' }), 'b2b', 'и компания, и телефон — всё равно B2B');
  assert.equal(Leads.classify({ inn: '0000000001' }), 'b2b');
  assert.equal(Leads.classify({ phone: '+7 900 000-00-01' }), 'b2c');
  assert.equal(Leads.classify({ email: 'primer@example.com' }), 'b2c');
  assert.equal(Leads.classify({ name: 'Клиент-пример', text: 'Звоните' }), null);
  assert.equal(Leads.classify({ company: '  ', inn: '', phone: ' ', email: '' }), null, 'пробелы — не данные');
});

test('route: типа B2B менеджеров нет → null; из двух менеджеров типа — у кого меньше открытых; закрытые не считаются', () => {
  const app = load(), { Leads } = app;
  const noB2b = mini(app, { people: mini(app).people.filter(p => p.role !== 'managerB2b') });
  assert.equal(Leads.route(noB2b, { company: 'ООО Пример' }), null, 'менеджеров B2B нет — «Нераспределённые»');
  assert.equal(Leads.route(noB2b, { phone: '+7 900 000-00-01' }), 'c1', 'для B2C менеджер есть');
  assert.equal(Leads.route(mini(app), { name: 'без данных' }), null, 'тип не определён — «Нераспределённые»');

  const st = mini(app);
  // b1: два открытых. b2: один открытый и три закрытых (Отказ, Сделка создана) — открытых меньше у b2
  st.leads.push(raw('Л-1', 'b1'), raw('Л-2', 'b1', 'qualified'), raw('Л-3', 'b2', 'contacted'),
    raw('Л-4', 'b2', 'lost'), raw('Л-5', 'b2', 'lost'), raw('Л-6', 'b2', 'deal'));
  assert.equal(Leads.route(st, { company: 'ООО Пример' }), 'b2');
  // у c1 лидов нет, но он не B2B — на выбор не влияет
  assert.equal(Leads.route(st, { inn: '0000000001' }), 'b2');
  // поровну — первый в списке людей
  assert.equal(Leads.route(mini(app), { company: 'ООО Пример' }), 'b1');
});

test('create: тип, менеджер, первый этап, источник, история; уведомление менеджеру и директору', () => {
  const app = load(), { Leads, Pipes } = app;
  const st = mini(app);
  const lead = Leads.create(st, B2B, NOW);
  assert.equal(lead.type, 'b2b');
  assert.equal(lead.managerId, 'b1');
  assert.equal(lead.source, 'site');
  assert.equal(lead.stageId, 'new');
  assert.equal(Pipes.stage(st, lead.pipeId, lead.stageId).name, 'Новый');
  assert.equal(lead.history.length, 2, 'пришёл + назначен');
  assert.equal(st.leads.length, 1);
  assert.equal(st.leads[0].id, lead.id);
  const n = st.notes[0];
  assert.equal(n.kind, 'lead');
  assert.deepEqual([...n.to].sort(), ['b1', 'dir'], 'менеджеру и директору, больше никому');
  assert.ok(n.text.includes(lead.id), 'в уведомлении номер лида');
  assert.ok(app.Notify.unread(st, 'b1').length === 1, 'у менеджера непрочитанное');
  // второй лид B2B уходит второму менеджеру: у b1 уже один открытый
  assert.equal(Leads.create(st, B2B, NOW).managerId, 'b2');
  assert.notEqual(st.leads[0].id, st.leads[1].id);
});

test('create: лид без типа — «Нераспределённый», уведомление только директору; неизвестный источник — ошибка', () => {
  const app = load(), { Leads } = app;
  const st = mini(app);
  const lead = Leads.create(st, NONE, NOW);
  assert.equal(lead.type, null);
  assert.equal(lead.managerId, null);
  assert.deepEqual([...st.notes[0].to], ['dir']);
  assert.ok(lead.history.some(h => h.text.includes('Нераспределённый')), 'причина в истории');
  assert.throws(() => Leads.create(st, { ...B2B, source: 'fax' }, NOW), /источник/);
});

test('take: нераспределённый лид своего типа — себе, с записью в историю; чужой тип, чужой лид и без права — нельзя', () => {
  const app = load(), { Leads } = app;
  const st = mini(app, { people: mini(app).people.filter(p => p.id !== 'c1') });
  const lead = Leads.create(st, B2C, NOW);   // менеджера B2C нет → нераспределённый
  assert.equal(lead.managerId, null);
  st.people.push({ id: 'c1', name: 'Менеджер B2C 1', role: 'managerB2c' });
  const before = lead.history.length;
  assert.equal(Leads.take(st, lead.id, 'b1', LATER), null, 'менеджер B2B не берёт лид B2C');
  assert.equal(Leads.take(st, lead.id, 'wh', LATER), null, 'у кладовщика нет права «лиды»');
  assert.equal(lead.managerId, null);
  assert.equal(lead.history.length, before);
  assert.ok(Leads.take(st, lead.id, 'c1', LATER));
  assert.equal(lead.managerId, 'c1');
  assert.equal(lead.history.length, before + 1);
  assert.equal(lead.history[before].by, 'c1');
  assert.equal(lead.history[before].at, LATER);
  assert.equal(Leads.take(st, lead.id, 'dir', LATER), null, 'лид уже у другого менеджера');
});

test('contacted: этап «Связались» и запись в историю; лид, ушедший дальше, назад не едет', () => {
  const app = load(), { Leads, Pipes } = app;
  const st = mini(app);
  const lead = Leads.create(st, B2B, NOW);
  const before = lead.history.length;
  assert.ok(Leads.contacted(st, lead.id, 'b1', LATER));
  assert.equal(Pipes.stage(st, lead.pipeId, lead.stageId).name, 'Связались');
  assert.equal(lead.history.length, before + 1);
  assert.equal(lead.history[before].by, 'b1');
  lead.stageId = 'qualified';
  Leads.contacted(st, lead.id, 'b1', LATER);
  assert.equal(lead.stageId, 'qualified', 'назад на «Связались» не возвращается');
  assert.equal(lead.history.length, before + 2, 'но запись в историю есть');
});

test('close: этап «Отказ», причина в истории; без причины и закрытый лид — нельзя', () => {
  const app = load(), { Leads, Pipes } = app;
  const st = mini(app);
  const lead = Leads.create(st, B2B, NOW);
  const before = lead.history.length;
  assert.equal(Leads.close(st, lead.id, '   ', 'b1', LATER), null, 'причина обязательна');
  assert.equal(lead.stageId, 'new');
  assert.ok(Leads.close(st, lead.id, 'Купил у других', 'b1', LATER));
  assert.equal(Pipes.stage(st, lead.pipeId, lead.stageId).name, 'Отказ');
  assert.equal(lead.history.length, before + 1);
  assert.ok(lead.history[before].text.includes('Купил у других'));
  assert.equal(Leads.close(st, lead.id, 'ещё раз', 'b1', LATER), null, 'закрытый лид закрывать не нужно');
  assert.equal(Leads.contacted(st, lead.id, 'b1', LATER), null, 'и вести тоже');
});

test('transfer: директор передаёт менеджеру или типу, менеджер получает уведомление; не директор — нельзя', () => {
  const app = load(), { Leads } = app;
  const st = mini(app);
  const lead = Leads.create(st, B2B, NOW);       // → b1
  const before = lead.history.length;
  assert.equal(Leads.transfer(st, lead.id, { managerId: 'b2' }, 'b1', LATER), null, 'менеджер лиды не передаёт');
  assert.equal(lead.managerId, 'b1');
  assert.ok(Leads.transfer(st, lead.id, { managerId: 'b2' }, 'dir', LATER));
  assert.equal(lead.managerId, 'b2');
  assert.equal(lead.history.length, before + 1);
  assert.equal(lead.history[before].by, 'dir');
  assert.ok(st.notes[0].to.includes('b2'), 'новый менеджер узнал о лиде');
  // передача типу: лид без типа → B2C, менеджер B2C у нас один
  const none = Leads.create(st, NONE, NOW);
  assert.ok(Leads.transfer(st, none.id, { type: 'b2c' }, 'dir', LATER));
  assert.equal(none.type, 'b2c');
  assert.equal(none.managerId, 'c1');
  // тип без менеджеров → нераспределённый этого типа
  const noMgr = mini(app, { people: mini(app).people.filter(p => p.role !== 'managerB2b') });
  const l2 = Leads.create(noMgr, NONE, NOW);
  Leads.transfer(noMgr, l2.id, { type: 'b2b' }, 'dir', LATER);
  assert.equal(l2.type, 'b2b');
  assert.equal(l2.managerId, null);
  // лид другого типа менеджеру: тип лида становится типом менеджера (сделка потом пойдёт в его воронку)
  Leads.transfer(st, lead.id, { managerId: 'c1' }, 'dir', LATER);
  assert.equal(lead.type, 'b2c');
  assert.equal(Leads.transfer(st, lead.id, { managerId: 'wh' }, 'dir', LATER), null, 'кладовщику лид не передать');
  assert.equal(Leads.transfer(st, lead.id, {}, 'dir', LATER), null, 'не сказано кому');
});

test('toDeal: сделка в воронке своего типа, первый этап, тот же менеджер, контакт и текст; лид — «Сделка создана» со ссылкой', () => {
  const app = load(), { Leads, Pipes } = app;
  const st = mini(app);
  st.deals.push({ id: 'Д-322' });
  const lead = Leads.create(st, B2B, NOW);                 // b1
  const id = Leads.toDeal(st, lead.id, 'b1', LATER);
  assert.equal(id, 'Д-323', 'номер продолжает нумерацию сделок');
  const d = st.deals.find(x => x.id === id);
  assert.equal(d.type, 'b2b');
  assert.equal(d.pipeId, 'dealsB2b');
  assert.equal(Pipes.stage(st, d.pipeId, d.stageId).name, 'Заявка', 'первый этап воронки');
  assert.equal(d.managerId, 'b1');
  assert.equal(d.client, 'ООО Пример');
  assert.equal(d.contact, 'Клиент-пример');
  assert.equal(d.object, 'Нужна станция для склада');
  assert.equal(d.leadId, lead.id);
  assert.equal(Pipes.stage(st, lead.pipeId, lead.stageId).name, 'Сделка создана');
  assert.equal(lead.dealId, id);
  assert.ok(lead.history[lead.history.length - 1].text.includes(id));
  assert.equal(Leads.toDeal(st, lead.id, 'b1', LATER), null, 'вторую сделку из лида не создать');
  // B2C — в свою воронку, с телефоном лида
  const c = Leads.create(st, B2C, NOW);
  const id2 = Leads.toDeal(st, c.id, 'c1', LATER);
  const d2 = st.deals.find(x => x.id === id2);
  assert.equal(d2.pipeId, 'dealsB2c');
  assert.equal(d2.client, 'Клиент-пример');
  assert.equal(d2.phone, '+7 900 000-00-01');
  assert.equal(d2.managerId, 'c1');
  // закрытый лид и лид без менеджера в сделку не превращаются
  const lost = Leads.create(st, B2B, NOW); Leads.close(st, lost.id, 'причина', 'b2', LATER);
  assert.equal(Leads.toDeal(st, lost.id, 'b2', LATER), null);
  const free = Leads.create(st, NONE, NOW);
  assert.equal(Leads.toDeal(st, free.id, 'dir', LATER), null, 'у лида нет менеджера и типа');
  assert.equal(st.deals.length, 3);
});

test('visible: менеджер B2B не видит лиды B2C, директор видит все и «Нераспределённые», без права «лиды» — никаких', () => {
  const app = load(), { Leads } = app;
  const st = mini(app);
  const lb = Leads.create(st, B2B, NOW), lc = Leads.create(st, B2C, NOW), ln = Leads.create(st, NONE, NOW);
  const ids = p => [...Leads.visible(st, p)].map(l => l.id).sort();
  assert.deepEqual(ids('b1'), [lb.id], 'менеджер B2B — только B2B');
  assert.deepEqual(ids('c1'), [lc.id], 'менеджер B2C — только B2C');
  assert.deepEqual(ids('dir'), [lb.id, lc.id, ln.id].sort(), 'директор — все, и нераспределённый тоже');
  assert.deepEqual(ids('wh'), []);
  // лид своего типа другого менеджера этого типа виден (b2 не ведёт lb, но он B2B)
  assert.deepEqual(ids('b2'), [lb.id]);
  // свой лид виден, даже если он другого типа (директор передал)
  app.Leads.transfer(st, lb.id, { managerId: 'c1' }, 'dir', LATER);
  assert.deepEqual(ids('c1'), [lb.id, lc.id].sort());
  assert.deepEqual(ids('b1'), [], 'после передачи B2B-менеджер лид уже не видит');
  // нет права «лиды» у менеджера — не видит ничего
  st.roles.find(r => r.id === 'managerB2b').perms.leads = false;
  assert.deepEqual(ids('b2'), []);
});

test('dealsVisible: менеджер не видит сделок чужого типа; с правом «все типы» видит; директор — все; без «клиентов» — никаких', () => {
  const app = load(), { Leads, Perms } = app;
  const st = mini(app);
  st.deals.push({ id: 'Д-1', type: 'b2b', managerId: 'b1' }, { id: 'Д-2', type: 'b2c', managerId: 'c1' }, { id: 'Д-3', type: 'b2b', managerId: 'b2' });
  const ids = p => [...Leads.dealsVisible(st, p)].map(d => d.id).sort();
  assert.equal(Perms.can(st, 'b1', 'dealsAll'), false, 'по умолчанию у менеджера права «все типы» нет');
  assert.deepEqual(ids('b1'), ['Д-1', 'Д-3'], 'B2B — обе сделки типа, чужого типа нет');
  assert.deepEqual(ids('c1'), ['Д-2']);
  assert.deepEqual(ids('dir'), ['Д-1', 'Д-2', 'Д-3']);
  assert.deepEqual(ids('wh'), ['Д-1', 'Д-2', 'Д-3'], 'у кладовщика по умолчанию права «клиенты» и «все типы»');
  st.roles.find(r => r.id === 'warehouse').perms.clients = false;
  assert.deepEqual(ids('wh'), [], 'без права «клиенты» сделок нет');
  st.roles.find(r => r.id === 'managerB2b').perms.dealsAll = true;
  assert.deepEqual(ids('b1'), ['Д-1', 'Д-2', 'Д-3'], 'с правом «все типы» видит и B2C');
  assert.deepEqual(ids('c1'), ['Д-2'], 'право выдано только роли B2B');
});

test('раздел «Сделки»: менеджер видит только сделки своего типа, директор — все; карточку чужой сделки не открыть', () => {
  const app = load();
  // демо: Д-311, Д-318, Д-305, Д-322 — B2C (Анна С. p2, Олег Н. p10); Д-314, Д-320 — B2B (Максим Л. p3)
  app.setMe('p1');
  // директор переключает типы: сперва B2B, кнопкой — B2C; на экране обе кнопки
  const all = app.vDeals();
  assert.ok(all.includes('data-type="b2b"') && all.includes('data-type="b2c"'), 'у директора нет переключателя B2B / B2C');
  for (const c of ['КФХ Петровых', 'ИП Кузнецов']) assert.ok(all.includes(c), `директору не видно ${c}`);
  assert.ok(!all.includes('Иванов Сергей'), 'на вкладке B2B видны сделки B2C');
  app.A['deal-type']({ dataset: { type: 'b2c' } });
  const allC = app.vDeals();
  for (const c of ['Иванов Сергей', 'Волкова Мария']) assert.ok(allC.includes(c), `на вкладке B2C директору не видно ${c}`);
  assert.ok(!allC.includes('КФХ Петровых'), 'на вкладке B2C видны сделки B2B');
  app.setMe('p3');                 // менеджер B2B
  const b2b = app.vDeals();
  assert.ok(b2b.includes('КФХ Петровых') && b2b.includes('ИП Кузнецов'), 'свои сделки B2B не показаны');
  assert.ok(!b2b.includes('Иванов Сергей') && !b2b.includes('Волкова Мария'), 'видны сделки B2C');
  assert.ok(!b2b.includes('Сделки B2C'), 'воронка B2C без видимых сделок показана');
  assert.ok(app.DRAWERS.deal('Д-314'), 'своя карточка не открылась');
  assert.equal(app.DRAWERS.deal('Д-311'), null, 'открылась карточка сделки B2C');
  app.setMe('p2');                 // менеджер B2C
  assert.ok(!app.vDeals().includes('КФХ Петровых'));
  // с правом «все типы» — появляется переключатель и видны сделки B2B
  app.S.roles.find(r => r.id === 'managerB2c').perms.dealsAll = true;
  assert.ok(app.vDeals().includes('data-type="b2b"'));
  app.A['deal-type']({ dataset: { type: 'b2b' } });
  assert.ok(app.vDeals().includes('КФХ Петровых'));
  assert.ok(app.DRAWERS.deal('Д-314'));
});

test('демо: 20+ лидов с пометкой «пример», оба источника, «Нераспределённые», оба типа; лиды и сделки согласованы', () => {
  const app = load(), { Leads, Perms, Store } = app;
  const st = app.seed();
  assert.ok(st.leads.length >= 20, `лидов в демо: ${st.leads.length}`);
  assert.equal(st.leadSource, 'both');
  for (const l of st.leads) {
    assert.equal(l.demo, true, `${l.id}: не помечен demo`);
    assert.match(`${l.name} ${l.company}`, /пример/i, `${l.id}: в имени или компании нет слова «пример»`);
    assert.match(l.text, /пример/i, `${l.id}: текст заявки не помечен`);
    if (l.stageId === 'lost') assert.match(l.reason, /пример/i, `${l.id}: причина отказа не помечена`);
    if (l.phone) assert.match(l.phone, /^\+7 900 000-00-\d\d$/, `${l.id}: телефон не демонстрационный`);
  }
  assert.deepEqual([...new Set(st.leads.map(l => l.source))].sort(), ['bitrix', 'site']);
  assert.ok(st.leads.filter(l => !l.managerId).length >= 1, 'нет нераспределённых');
  assert.ok(st.leads.some(l => l.type === 'b2b' && l.managerId) && st.leads.some(l => l.type === 'b2c' && l.managerId));
  // менеджер лида — менеджер его типа; этап есть в воронке; тип совпадает с заявкой
  for (const l of st.leads) {
    assert.ok(app.Pipes.stage(st, l.pipeId, l.stageId), `${l.id}: этапа нет`);
    assert.equal(l.type, Leads.classify(l), `${l.id}: тип не по заявке`);
    if (l.managerId) assert.equal(Perms.roleOf(st, l.managerId).scope, l.type, `${l.id}: менеджер другого типа`);
  }
  assert.ok(st.leads.some(l => l.stageId === 'lost') && st.leads.some(l => l.stageId === 'deal') && st.leads.some(l => l.stageId === 'new'), 'в демо не все этапы');
  // сделка из лида: ссылки в обе стороны; все сделки (и v2, и новые) — с типом и менеджером того же типа
  for (const l of st.leads.filter(x => x.stageId === 'deal')) {
    const d = st.deals.find(x => x.id === l.dealId);
    assert.ok(d, `${l.id}: сделки ${l.dealId} нет`);
    assert.equal(d.leadId, l.id);
    assert.equal(d.managerId, l.managerId);
  }
  for (const d of st.deals) {
    assert.ok(d.type === 'b2b' || d.type === 'b2c', `${d.id}: нет типа`);
    assert.equal(Perms.roleOf(st, d.managerId)?.scope, d.type, `${d.id}: менеджер другого типа`);
  }
  // лиды переживают сохранение: даты и ссылки на месте
  const back = Store.load(Store.dump(st).text);
  assert.equal(back.leads.length, st.leads.length);
  assert.equal(back.leads[0].history[0].at.getTime(), st.leads[0].history[0].at.getTime());
  assert.equal(back.leadSource, 'both');
});

test('move: на обычный этап — смена и запись в историю; на «Сделка создана» — сделка; на «Отказ» без причины — отказ', () => {
  const app = load(), { Leads, Pipes } = app;
  const st = mini(app);
  const lead = Leads.create(st, B2B, NOW);                 // b1, этап «Новый»
  const before = lead.history.length;
  // обычный этап: смена, запись «кто и когда»
  assert.ok(Leads.move(st, lead.id, 'qualified', 'b1', LATER));
  assert.equal(Pipes.stage(st, lead.pipeId, lead.stageId).name, 'Квалифицирован');
  assert.equal(lead.history.length, before + 1);
  assert.equal(lead.history[before].by, 'b1');
  assert.equal(lead.history[before].at, LATER);
  assert.equal(lead.history[before].text, 'Квалифицирован');
  // назад на «Связались» — тоже обычная смена этапа, с записью
  assert.ok(Leads.move(st, lead.id, 'contacted', 'b1', LATER));
  assert.equal(lead.stageId, 'contacted');
  assert.equal(lead.history.length, before + 2);
  // на тот же этап и на несуществующий — нельзя, истории не прибавилось
  assert.equal(Leads.move(st, lead.id, 'contacted', 'b1', LATER), null);
  assert.equal(Leads.move(st, lead.id, 'нет-такого', 'b1', LATER), null);
  assert.equal(lead.history.length, before + 2);
  // чужой тип лид не двигает; кладовщик без права «лиды» — тоже
  assert.equal(Leads.move(st, lead.id, 'new', 'c1', LATER), null, 'менеджер B2C не двигает лид B2B');
  assert.equal(Leads.move(st, lead.id, 'new', 'wh', LATER), null);
  assert.equal(lead.stageId, 'contacted');

  // «Отказ» без причины — отказ, лид на месте; с причиной — закрыт, причина в истории
  assert.equal(Leads.move(st, lead.id, 'lost', 'b1', LATER), null);
  assert.equal(Leads.move(st, lead.id, 'lost', 'b1', LATER, '   '), null, 'пробелы — не причина');
  assert.equal(lead.stageId, 'contacted');
  assert.ok(Leads.move(st, lead.id, 'lost', 'b1', LATER, 'Купил у других'));
  assert.equal(Pipes.stage(st, lead.pipeId, lead.stageId).name, 'Отказ');
  assert.equal(lead.reason, 'Купил у других');
  assert.equal(Leads.move(st, lead.id, 'new', 'b1', LATER), null, 'закрытый лид из «Отказа» не возвращается');

  // «Сделка создана»: появилась сделка в воронке своего типа, лид ссылается на неё
  const l2 = Leads.create(st, B2B, NOW);
  const nDeals = st.deals.length;
  assert.ok(Leads.move(st, l2.id, 'deal', l2.managerId, LATER));
  assert.equal(st.deals.length, nDeals + 1);
  assert.equal(l2.stageId, 'deal');
  const d = st.deals.find(x => x.id === l2.dealId);
  assert.ok(d, 'у лида нет ссылки на сделку');
  assert.equal(d.leadId, l2.id);
  assert.equal(d.pipeId, 'dealsB2b');
  // нераспределённый лид в сделку не превращается — этап не меняется
  const free = Leads.create(st, NONE, NOW);
  assert.equal(Leads.move(st, free.id, 'deal', 'dir', LATER), null);
  assert.equal(free.stageId, 'new');
  assert.equal(st.deals.length, nDeals + 1);
});

// ═══════════════ экраны, настройки, имитации и РОП (таск 04, второй кусок) ═══════════════
// Идём через публичные входы страницы: setMe/go, A[…], FORMS[…], поля data-on, SIMS, события document.
// Ожидания считаются заново по данным S.leads / S.deals, а не вызовом Leads.* и не из кода экрана.
const personBy = (app, role) => app.S.people.find(p => p.role === role).id;
const asRole = (app, role) => { app.setMe(personBy(app, role)); return app; };
const viewHtml = app => app.document.getElementById('view').innerHTML;
const idsIn = html => [...html.matchAll(/data-act="open-lead" data-id="([^"]+)"/g)].map(m => m[1]);
const openLeadsView = (app, role) => { asRole(app, role); app.go('leads'); return viewHtml(app); };
const fireOn = (app, type, key, value, extra = {}) => app.document.dispatchEvent({ type, target: { dataset: { on: key, ...extra }, value, checked: true } });
// id списка из S — списком этого мира (S создан в vm, у его массивов свой прототип)
const idsOf = list => [...list].map(x => x.id).sort();
const finished = l => l.stageId === 'lost' || l.stageId === 'deal';

test('РОП: в демо есть Елена Г. с ролью «РОП»; в «Кто я» она есть; лидов она не получает, потому что у роли нет типа', () => {
  const app = load(), { Leads, Perms } = app, st = app.seed();
  const rop = st.people.find(p => p.role === 'rop');
  assert.ok(rop, 'в демо-команде нет РОП');
  assert.equal(rop.name, 'Елена Г.');
  assert.equal(rop.demo, true);
  assert.equal(Perms.roleOf(st, rop.id).name, 'РОП (руководитель отдела продаж)');
  assert.equal(Perms.roleOf(st, rop.id).scope, undefined, 'у РОП не должно быть типа');
  assert.equal(Perms.roleOf(st, rop.id).builtin, true);
  assert.ok(!Leads.managers(st).some(m => m.id === rop.id), 'РОП в списке менеджеров для распределения');
  // 40 лидов всех видов подряд — ни один не достаётся РОП
  const demoCount = st.leads.length;
  for (let i = 0; i < 40; i++) Leads.create(st, [B2B, B2C, NONE, { source: 'site', inn: '0000000001' }][i % 4], NOW);
  assert.equal(st.leads.length, demoCount + 40);
  assert.ok(st.leads.every(l => l.managerId !== rop.id), 'лид ушёл РОП');
  // «Кто я»: РОП в списке, подпись «Имя — Роль»
  app.setMe(rop.id);
  assert.ok(app.document.getElementById('role').innerHTML.includes(`>${rop.name} — РОП (руководитель отдела продаж)</option>`));
});

test('РОП: права по таску есть, лишних нет; право leadsAssign подписано по-русски, у менеджера его нет', () => {
  const app = load(), { Perms } = app, st = app.seed();
  const rop = st.people.find(p => p.role === 'rop').id, mgr = st.people.find(p => p.role === 'managerB2b').id;
  const have = ['leads', 'leadsAssign', 'dealsAll', 'clients', 'dealsEdit', 'stock', 'prices', 'reserve', 'write', 'mail', 'sell', 'tasksAssign']; // tasksAssign — как в прошлой версии прототипа (таск 06); dealsEdit — таск F1
  for (const k of have) assert.equal(Perms.can(st, rop, k), true, `у РОП нет права ${k}`);
  for (const k of Perms.LIST.map(p => p[0]).filter(k => !have.includes(k))) assert.equal(Perms.can(st, rop, k), false, `у РОП лишнее право ${k}`);
  assert.equal(Perms.LIST.find(p => p[0] === 'leadsAssign')[1], 'Распределять и передавать лиды');
  assert.equal(Perms.can(st, 'p1', 'leadsAssign'), true, 'у директора право есть');
  assert.equal(Perms.can(st, mgr, 'leadsAssign'), false, 'у менеджера по умолчанию права нет');
});

test('передать лид: решает право «Распределять и передавать лиды», а не название роли; без права менеджер не передаёт, РОП передаёт', () => {
  const app = load(), { Leads } = app, st = app.seed();
  const mgr = st.people.find(p => p.role === 'managerB2b').id, rop = st.people.find(p => p.role === 'rop').id;
  const free = st.leads.find(l => !l.managerId && !finished(l));
  assert.ok(free, 'в демо нет нераспределённого лида');
  assert.equal(Leads.canTransfer(st, mgr), false);
  assert.equal(Leads.can(st, free.id, mgr).transfer, false);
  assert.equal(Leads.transfer(st, free.id, { type: 'b2c' }, mgr, LATER), null, 'менеджер без права передал лид');
  assert.equal(free.managerId, null);
  // РОП передаёт типу: менеджер по меньшей загрузке получает лид и уведомление
  assert.equal(Leads.can(st, free.id, rop).transfer, true);
  const before = st.notes.length;
  assert.ok(Leads.transfer(st, free.id, { type: 'b2c' }, rop, LATER));
  assert.equal(free.type, 'b2c');
  assert.equal(st.people.find(p => p.id === free.managerId).role, 'managerB2c');
  assert.equal(st.notes.length, before + 1);
  assert.ok(st.notes[0].to.includes(free.managerId));
  assert.equal(free.history[free.history.length - 1].by, rop, 'в истории — кто передал');
  // и менеджеру напрямую
  const other = st.people.filter(p => p.role === 'managerB2b')[1].id;
  assert.ok(Leads.transfer(st, free.id, { managerId: other }, rop, LATER));
  assert.equal(free.managerId, other);
  // право снято у РОП — передача пропала; выдано менеджеру — появилась (проверяется право, не роль)
  st.roles.find(r => r.id === 'rop').perms.leadsAssign = false;
  assert.equal(Leads.transfer(st, free.id, { managerId: mgr }, rop, LATER), null);
  st.roles.find(r => r.id === 'managerB2b').perms.leadsAssign = true;
  assert.ok(Leads.transfer(st, free.id, { managerId: mgr }, mgr, LATER), 'менеджер с выданным правом не смог передать');
});

test('РОП видит все лиды и «Нераспределённые», менеджер B2B — ни одного лида B2C', () => {
  const app = load(), { Leads } = app, st = app.seed();
  const rop = st.people.find(p => p.role === 'rop').id, b2b = st.people.find(p => p.role === 'managerB2b').id;
  assert.equal(Leads.visible(st, rop).length, st.leads.length, 'РОП видит не все лиды');
  assert.ok(Leads.visible(st, rop).some(l => !l.managerId), 'РОП не видит нераспределённых');
  const seen = Leads.visible(st, b2b);
  assert.ok(seen.length > 0 && seen.length < st.leads.length);
  assert.ok(seen.every(l => l.type === 'b2b' || l.managerId === b2b), 'менеджер B2B видит чужой тип');
  assert.ok(st.leads.filter(l => l.type === 'b2c').every(l => !seen.includes(l)));
});

test('новый лид: уведомление получает РОП вместе с директором и менеджером', () => {
  const app = load(), { Leads } = app, st = app.seed();
  const rop = st.people.find(p => p.role === 'rop').id;
  const lead = Leads.create(st, B2B, NOW);
  assert.equal(st.notes[0].kind, 'lead');
  assert.ok(st.notes[0].to.includes(rop), 'РОП не получил уведомление о лиде');
  assert.ok(st.notes[0].to.includes('p1') && st.notes[0].to.includes(lead.managerId));
});

test('Leads.can и Leads.fresh: кнопки карточки и число на пункте меню считаются ядром', () => {
  const app = load(), { Leads } = app;
  const st = mini(app);
  const mine = Leads.create(st, B2B, NOW);        // b1
  const free = Leads.create(st, NONE, NOW);       // нераспределённый, без типа
  assert.deepEqual({ ...Leads.can(st, mine.id, 'b1') }, { take: false, work: true, deal: true, transfer: false });
  // другой менеджер того же типа лид видит, но не ведёт
  assert.deepEqual({ ...Leads.can(st, mine.id, 'b2') }, { take: false, work: false, deal: false, transfer: false });
  // лид без типа менеджеру не виден — взять его он не может; тот, кто раздаёт, может всё, кроме сделки без менеджера
  assert.equal(Leads.can(st, free.id, 'b1').take, false);
  assert.deepEqual({ ...Leads.can(st, free.id, 'dir') }, { take: true, work: true, deal: false, transfer: true });
  // число на меню: свои новые; директору — ещё и нераспределённые
  assert.deepEqual([...Leads.fresh(st, 'b1')].map(l => l.id), [mine.id]);
  assert.deepEqual([...Leads.fresh(st, 'dir')].map(l => l.id), [free.id]);
  Leads.contacted(st, mine.id, 'b1', LATER);
  assert.deepEqual([...Leads.fresh(st, 'b1')], [], 'после «Связались» лид уже не новый');
  assert.deepEqual([...Leads.fresh(st, 'wh')], []);
});

test('Leads.allows / setSource: сайт и Битрикс24 включаются выбором; телефон и почта — всегда; неизвестное значение — отказ', () => {
  const app = load(), { Leads } = app, st = mini(app);
  assert.equal(Leads.setSource(st, 'bitrix'), true);
  assert.equal(st.leadSource, 'bitrix');
  assert.equal(Leads.allows(st, 'bitrix'), true);
  assert.equal(Leads.allows(st, 'site'), false);
  assert.equal(Leads.allows(st, 'phone'), true);
  Leads.setSource(st, 'site');
  assert.deepEqual([Leads.allows(st, 'bitrix'), Leads.allows(st, 'site')], [false, true]);
  Leads.setSource(st, 'both');
  assert.deepEqual([Leads.allows(st, 'bitrix'), Leads.allows(st, 'site')], [true, true]);
  assert.equal(Leads.setSource(st, 'fax'), false);
  assert.equal(st.leadSource, 'both', 'неизвестный источник записался');
});

test('раздел «Лиды»: пункт меню есть у директора, РОП и менеджеров, у кладовщика, инженера и логиста нет; число — только необработанные лиды человека, дела по лидам в него не входят', () => {
  const app = load();
  for (const role of ['director', 'rop', 'managerB2b', 'managerB2c']) {
    asRole(app, role);
    assert.ok(app.navItems().some(n => n.id === 'leads'), `${role}: нет пункта «Лиды»`);
    assert.ok(app.document.getElementById('side').innerHTML.includes('data-view="leads"'));
  }
  for (const role of ['warehouse', 'engineer', 'logist']) {
    asRole(app, role);
    assert.ok(!app.navItems().some(n => n.id === 'leads'), `${role}: пункт «Лиды» есть`);
  }
  // число на пункте менеджера — его лиды на первом этапе (считаем по данным); его дела по лидам в число не входят
  const mgr = app.S.leads.find(l => l.managerId && l.type === 'b2b' && l.stageId === 'new').managerId;
  app.setMe(mgr);
  const fresh = app.S.leads.filter(l => l.managerId === mgr && l.stageId === 'new').length;
  assert.ok(fresh > 0, 'в демо у менеджера нет новых лидов — проверка пустая');
  const expected = fresh;
  const badge = app.document.getElementById('side').innerHTML.match(/data-view="leads"><svg.*?<\/svg><span>Лиды<\/span><span class="cnt hot">(\d+)</);
  assert.ok(badge, 'на пункте нет числа');
  assert.equal(Number(badge[1]), expected);
  // прямой переход туда, где нет права, — «Нет доступа»
  asRole(app, 'warehouse'); app.S.view = 'leads'; app.render();
  assert.ok(viewHtml(app).includes('Нет доступа'));
});

test('счётчик у «Лидов» — число необработанных лидов; дело по лиду его не меняет; плитка «Новые лиды» на главном экране считает тем же Leads.fresh', () => {
  const app = load(), { S, Leads, Acts } = app;
  const badge = () => app.NAV.find(n => n.id === 'leads').badge();
  const side = () => (app.document.getElementById('side').innerHTML.match(/data-view="leads"><svg.*?<\/svg><span>Лиды<\/span><span class="cnt hot">(\d+)</) || [])[1];
  const tile = () => app.HOME_TILES.find(t => t.id === 'leads').calc().value;
  // независимый подсчёт по данным: открытый лид на первом этапе («Новый»), который ведёт сам человек;
  // директору и РОП — ещё и нераспределённые
  const byData = id => S.leads.filter(l => l.stageId === 'new' && (l.managerId === id || (!l.managerId && ['director', 'rop'].includes(S.people.find(p => p.id === id).role)))).length;
  for (const role of ['director', 'rop', 'managerB2b', 'managerB2c']) {
    // тот из людей роли, у кого есть необработанные лиды
    const who = S.people.filter(p => p.role === role).find(p => byData(p.id) > 0);
    assert.ok(who, `${role}: в демо нет необработанных лидов — проверка пустая`);
    app.setMe(who.id);
    const me = S.me, n = byData(me);
    assert.equal(badge(), n, `${role}: число в бейдже не равно числу необработанных лидов`);
    assert.equal(Leads.fresh(S, me).length, n);
    assert.equal(tile(), n, `${role}: плитка на главном экране считает иначе`);
    assert.equal(side(), String(n), `${role}: на пункте меню другое число`);
    // дело по лиду (просроченное) в число не входит — ни в бейдж, ни в плитку
    const lead = Leads.fresh(S, me)[0];
    const before = Acts.counts(S, me, new Date(), 'lead');
    const r = Acts.plan(S, { t: 'lead', id: lead.id }, { type: 'call', title: 'Перезвонить', due: new Date(Date.now() - 6e4), ownerId: me }, me, new Date());
    assert.equal(r.ok, true, r.reason);
    const after = Acts.counts(S, me, new Date(), 'lead');
    assert.equal(after.today + after.overdue, before.today + before.overdue + 1, 'дело по лиду не посчиталось — проверка пустая');
    assert.equal(badge(), n, `${role}: дело по лиду изменило число в бейдже`);
    assert.equal(tile(), n);
  }
  // лид взяли в работу («Связались») — он уходит из числа
  const n0 = badge(), lead = Leads.fresh(S, S.me)[0];
  Leads.contacted(S, lead.id, S.me, new Date());
  assert.equal(badge(), n0 - 1);
});

test('раздел «Лиды», список: директор видит все лиды и «Нераспределённые», менеджер B2B — ни одного лида B2C', () => {
  const app = load();
  const all = app.S.leads;
  // закрытый лид без менеджера в «Нераспределённые» не попадает: закрываем один из нераспределённых
  const toClose = all.find(l => !l.managerId && !finished(l));
  assert.ok(app.Leads.close(app.S, toClose.id, 'Пример причины: проверка', 'p1', new Date()));
  const dirHtml = openLeadsView(app, 'director');
  assert.deepEqual(idsIn(dirHtml).sort(), idsOf(all), 'директор видит не все лиды');
  const freeOpen = all.filter(l => !l.managerId && !finished(l));
  assert.ok(freeOpen.length >= 1);
  assert.ok(dirHtml.includes(`Нераспределённые · ${freeOpen.length}`), 'нет счётчика «Нераспределённые»');
  // метки источника и пример в списке
  assert.ok(dirHtml.includes('>сайт<') && dirHtml.includes('>Битрикс24<'), 'нет меток источника');
  assert.ok(dirHtml.includes('>пример<'), 'нет пометки «пример»');
  // отдельный фильтр: остаются только нераспределённые открытые
  app.A['lead-free']();
  assert.deepEqual(idsIn(viewHtml(app)).sort(), idsOf(freeOpen));
  app.A['lead-reset']();
  // менеджер B2B: ни одного лида B2C
  const b2bHtml = openLeadsView(app, 'managerB2b');
  const seen = idsIn(b2bHtml);
  assert.ok(seen.length > 0);
  for (const l of all.filter(x => x.type === 'b2c')) assert.ok(!seen.includes(l.id), `менеджер B2B видит лид B2C ${l.id}`);
  assert.deepEqual(seen.sort(), idsOf(all.filter(l => l.type === 'b2b' || l.managerId === personBy(app, 'managerB2b'))));
  // РОП видит всё, как директор
  assert.deepEqual(idsIn(openLeadsView(app, 'rop')).sort(), idsOf(all));
});

test('раздел «Лиды», фильтры и поиск: этап, тип, источник, менеджер, текст — каждый сужает список', () => {
  const app = load();
  const all = app.S.leads;
  openLeadsView(app, 'director');
  const fire = (k, v) => fireOn(app, 'change', 'lead-f', v, { k });
  fire('stage', 'lost');
  assert.deepEqual(idsIn(viewHtml(app)).sort(), idsOf(all.filter(l => l.stageId === 'lost')));
  fire('stage', '');
  fire('source', 'site');
  assert.deepEqual(idsIn(viewHtml(app)).sort(), idsOf(all.filter(l => l.source === 'site')));
  fire('type', 'b2c');
  assert.deepEqual(idsIn(viewHtml(app)).sort(), idsOf(all.filter(l => l.source === 'site' && l.type === 'b2c')));
  fire('source', ''); fire('type', '');
  const m = all.find(l => l.managerId).managerId;
  fire('manager', m);
  assert.deepEqual(idsIn(viewHtml(app)).sort(), idsOf(all.filter(l => l.managerId === m)));
  fire('manager', '');
  // поиск по телефону: ввод в поле перерисовывает только тело списка
  const withPhone = all.find(l => l.phone);
  app.document.getElementById('lead-body').innerHTML = '';
  fireOn(app, 'input', 'lead-q', withPhone.phone);
  const body = app.document.getElementById('lead-body').innerHTML;
  assert.deepEqual(idsIn(body).sort(), idsOf(all.filter(l => l.phone === withPhone.phone)));
  fireOn(app, 'input', 'lead-q', 'такого-не-найти-нигде');
  assert.ok(app.document.getElementById('lead-body').innerHTML.includes('По этим условиям лидов нет'));
});

test('раздел «Лиды», воронка: столбцы — этапы воронки лидов; перетаскивание меняет этап через Leads.move, чужой лид не двигается', () => {
  const app = load();
  openLeadsView(app, 'director');
  app.A['lead-view']({ dataset: { v: 'funnel' } });
  const html = viewHtml(app);
  const cols = [...html.matchAll(/data-lcol="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(cols, ['new', 'contacted', 'qualified', 'deal', 'lost'], 'столбцы воронки не по этапам воронки лидов');
  for (const c of cols) {
    const block = html.split(`data-lcol="${c}"`)[1].split('data-lcol=')[0];
    assert.equal((block.match(/class="tcard lcard/g) || []).length, app.S.leads.filter(l => l.stageId === c).length, `в столбце ${c} лишние или пропавшие карточки`);
  }
  assert.ok(html.includes('draggable="true"'));
  // менеджер перетаскивает свой лид: «Новый» → «Квалифицирован» → «Сделка создана»
  const mgr = app.S.leads.find(l => l.managerId && l.type === 'b2b' && l.stageId === 'new').managerId;
  app.setMe(mgr);
  const lead = app.S.leads.find(l => l.managerId === mgr && l.stageId === 'new');
  const hist = lead.history.length;
  const drop = (id, col) => app.document.dispatchEvent({ type: 'drop', preventDefault() {}, dataTransfer: { getData: () => id }, target: { closest: s => (s === '[data-lcol]' ? { dataset: { lcol: col }, classList: { remove() {} } } : null) } });
  drop(lead.id, 'qualified');
  assert.equal(lead.stageId, 'qualified');
  assert.equal(lead.history.length, hist + 1);
  assert.equal(lead.history[hist].by, mgr);
  const nDeals = app.S.deals.length;
  drop(lead.id, 'deal');
  assert.equal(app.S.deals.length, nDeals + 1);
  assert.ok(lead.dealId && app.S.deals.some(d => d.id === lead.dealId && d.leadId === lead.id));
  // чужой лид менеджер не двигает
  const foreign = app.S.leads.find(l => l.managerId && l.managerId !== mgr && l.type === 'b2b' && (l.stageId === 'new' || l.stageId === 'contacted'));
  assert.ok(foreign, 'в демо нет чужого открытого лида B2B');
  const was = foreign.stageId;
  drop(foreign.id, 'qualified');
  assert.equal(foreign.stageId, was, 'менеджер подвинул чужой лид');
  // на «Отказ» — окно с причиной, лид пока на месте
  const other = app.S.leads.find(l => l.id !== lead.id && l.managerId === mgr && !finished(l));
  assert.ok(other, 'у менеджера нет второго открытого лида');
  drop(other.id, 'lost');
  assert.equal(app.S.ui.modal.type, 'leadLost');
  assert.ok(!finished(other));
  app.document.getElementById('ll-reason').value = '   ';
  app.FORMS['lead-lost']({ dataset: { id: other.id } });
  assert.ok(!finished(other), 'закрылся без причины');
  assert.match(app.document.getElementById('ll-err').textContent, /причин/);
  app.document.getElementById('ll-reason').value = 'Выбрали другого поставщика';
  app.FORMS['lead-lost']({ dataset: { id: other.id } });
  assert.equal(other.stageId, 'lost');
  assert.equal(other.reason, 'Выбрали другого поставщика');
  assert.equal(app.S.ui.modal, null, 'окно не закрылось');
});

test('карточка лида: метка источника, контакт, компания, текст, история; «нет данных» там, где пусто; чужой лид не открывается', () => {
  const app = load();
  asRole(app, 'managerB2b');
  const own = app.S.leads.find(l => l.type === 'b2b' && l.company);
  const d = app.DRAWERS.lead(own.id);
  assert.ok(d, 'карточка лида не открылась');
  assert.equal(d.kind, 'Лид ' + own.id);
  assert.ok(d.body.includes(own.source === 'site' ? '>сайт<' : '>Битрикс24<'), 'нет метки источника');
  assert.ok(d.body.includes(own.company), 'нет компании');
  assert.ok(d.body.includes('Текст заявки') && d.body.includes('История') && d.body.includes('Лид пришёл'));
  assert.ok(d.body.includes('B2B'));
  // лид только с телефоном: почта — «нет данных: почта», компании в карточке нет
  asRole(app, 'director');
  const phoneOnly = app.S.leads.find(l => l.phone && !l.email && !l.company);
  const dp = app.DRAWERS.lead(phoneOnly.id);
  assert.ok(dp.body.includes('нет данных: почта'));
  assert.ok(!dp.body.includes('<dt>Компания</dt>'), 'пустая компания показана');
  // чужой тип — карточка не открывается
  asRole(app, 'managerB2b');
  assert.equal(app.DRAWERS.lead(app.S.leads.find(l => l.type === 'b2c').id), null);
  assert.equal(app.DRAWERS.lead('Л-нет'), null);
});

test('карточка лида: «Взять» у нераспределённого своего типа, «Передать» только у того, кто раздаёт; действия пишут историю, сделка — ссылкой', () => {
  const app = load();
  const mgrC = personBy(app, 'managerB2c');
  // нераспределённый лид типа B2C: снимаем менеджера у одного из новых
  const lead = app.S.leads.find(l => l.type === 'b2c' && l.managerId && l.stageId === 'new');
  lead.managerId = null;
  asRole(app, 'managerB2c');
  let body = app.DRAWERS.lead(lead.id).body;
  assert.ok(body.includes('data-act="lead-take"'), 'нет «Взять» у нераспределённого лида своего типа');
  assert.ok(!body.includes('data-form="lead-transfer"'), 'менеджер видит «Передать»');
  asRole(app, 'managerB2b');
  assert.equal(app.DRAWERS.lead(lead.id), null);
  // РОП и директор: «Передать» есть
  for (const role of ['rop', 'director']) {
    asRole(app, role);
    body = app.DRAWERS.lead(lead.id).body;
    assert.ok(body.includes('data-form="lead-transfer"'), `${role}: нет «Передать»`);
    assert.ok(body.includes('Нераспределённый'));
  }
  // «Взять» от имени менеджера B2C: лид у него, запись в истории, в карточке кнопки ведения
  app.setMe(mgrC);
  const hist = lead.history.length;
  app.A['lead-take']({ dataset: { id: lead.id } });
  assert.equal(lead.managerId, mgrC);
  assert.equal(lead.history.length, hist + 1);
  body = app.DRAWERS.lead(lead.id).body;
  for (const a of ['lead-contacted', 'lead-qualify', 'lead-deal', 'lead-close']) assert.ok(body.includes(`data-act="${a}"`), `нет кнопки ${a}`);
  assert.ok(!body.includes('data-act="lead-take"'));
  // «Связались» → этап и запись
  app.A['lead-contacted']({ dataset: { id: lead.id } });
  assert.equal(lead.stageId, 'contacted');
  assert.equal(lead.history.length, hist + 2);
  // «Создать сделку»: сделка заведена, в карточке — ссылка на неё, «Закрыть» уже нет
  const nDeals = app.S.deals.length;
  app.A['lead-deal']({ dataset: { id: lead.id } });
  assert.equal(app.S.deals.length, nDeals + 1);
  body = app.DRAWERS.lead(lead.id).body;
  assert.ok(body.includes(`data-act="open-deal" data-id="${lead.dealId}"`), 'нет ссылки на сделку');
  assert.ok(!body.includes('data-act="lead-close"'), 'у лида, ставшего сделкой, осталось «Закрыть»');
  asRole(app, 'director');
  assert.ok(!app.DRAWERS.lead(lead.id).body.includes('data-form="lead-transfer"'), 'закрытый лид можно передать');
});

test('карточка лида: форма «Передать» переводит лид менеджеру и пишет в историю; без права форма ничего не меняет', () => {
  const app = load();
  asRole(app, 'rop');
  const rop = personBy(app, 'rop');
  const lead = app.S.leads.find(l => l.type === 'b2b' && l.managerId && l.stageId === 'new');
  const mgrs = app.S.people.filter(p => p.role === 'managerB2b');
  const target = mgrs.find(p => p.id !== lead.managerId).id;
  const hist = lead.history.length;
  app.document.getElementById('lead-tr').value = `m:${target}`;
  app.FORMS['lead-transfer']({ dataset: { id: lead.id } });
  assert.equal(lead.managerId, target);
  assert.equal(lead.history.length, hist + 1);
  assert.equal(lead.history[hist].by, rop);
  // менеджер без права форму не пропустит, даже если вызвать её напрямую
  asRole(app, 'managerB2b');
  const stay = lead.managerId, away = mgrs.find(p => p.id !== stay).id;
  app.document.getElementById('lead-tr').value = `m:${away}`;
  app.FORMS['lead-transfer']({ dataset: { id: lead.id } });
  assert.equal(lead.managerId, stay, 'менеджер без права передал лид');
});

test('имитация «пришёл лид с сайта» / «из Битрикса24»: зарегистрированы; выключенный источник лид не создаёт, включённый — создаёт и уведомляет менеджера', () => {
  const app = load();
  const site = app.SIMS.find(s => s.label === 'Имитация: пришёл лид с сайта'), bitrix = app.SIMS.find(s => s.label === 'Имитация: пришёл лид из Битрикса24');
  assert.ok(site && bitrix, 'имитации не зарегистрированы в SIMS');
  // выключено: источник — только Битрикс24
  app.Leads.setSource(app.S, 'bitrix');
  const n0 = app.S.leads.length, notes0 = app.S.notes.length;
  site.run();
  assert.equal(app.S.leads.length, n0, 'выключенный источник создал лид');
  assert.equal(app.S.notes.length, notes0, 'выключенный источник создал уведомление');
  // Битрикс при этом работает
  bitrix.run();
  assert.equal(app.S.leads.length, n0 + 1);
  assert.equal(app.S.leads[n0].source, 'bitrix');
  // источник «оба»: сайт создаёт лид с источником site, менеджеру уходит уведомление
  app.Leads.setSource(app.S, 'both');
  site.run();
  const lead = app.S.leads[app.S.leads.length - 1];
  assert.equal(app.S.leads.length, n0 + 2);
  assert.equal(lead.source, 'site');
  assert.equal(lead.demo, true);
  assert.match(lead.text, /ример/);
  assert.ok(lead.managerId, 'имитация дала нераспределённый лид');
  assert.equal(app.Perms.roleOf(app.S, lead.managerId).scope, lead.type, 'менеджер не того типа');
  assert.equal(app.S.notes[0].kind, 'lead');
  assert.ok(app.S.notes[0].to.includes(lead.managerId), 'менеджер не получил уведомление');
  // только сайт: Битрикс выключен
  app.Leads.setSource(app.S, 'site');
  const n1 = app.S.leads.length;
  bitrix.run();
  assert.equal(app.S.leads.length, n1);
  // заявки имитации идут по кругу: все четыре вида дают лид с типом и менеджером
  app.Leads.setSource(app.S, 'both');
  for (let i = 0; i < 4; i++) site.run();
  assert.equal(app.S.leads.length, n1 + 4);
  assert.ok(app.S.leads.slice(n1).every(l => l.type && l.managerId), 'у лида имитации нет типа или менеджера');
});

test('кнопки имитации видны в разделе «Лиды» у директора и работают, у менеджера их нет', () => {
  const app = load();
  const dir = openLeadsView(app, 'director');
  assert.ok(dir.includes('data-act="lead-sim" data-source="site"') && dir.includes('Имитация: пришёл лид с сайта'));
  assert.ok(dir.includes('data-act="lead-sim" data-source="bitrix"') && dir.includes('Имитация: пришёл лид из Битрикса24'));
  const n = app.S.leads.length;
  app.A['lead-sim']({ dataset: { source: 'site' } });
  assert.equal(app.S.leads.length, n + 1, 'кнопка в разделе лид не создала');
  assert.ok(!openLeadsView(app, 'managerB2b').includes('data-act="lead-sim"'));
});

test('«Настройки → Лиды и сделки»: вкладка между «Почтой» и «Складами», только с правом «настройки»; источник запоминается; пояснение про Битрикс24', () => {
  const app = load();
  asRole(app, 'director');
  const labels = app.settingsTabs().map(t => t.label);
  const i = labels.indexOf('Лиды и сделки');
  assert.ok(i > 0, 'нет вкладки «Лиды и сделки»');
  assert.equal(labels[i - 1], 'Почта');
  assert.equal(labels[i + 1], 'Склады и юрлица');
  asRole(app, 'managerB2b');
  assert.ok(!app.settingsTabs().some(t => t.id === 'leads'), 'менеджер видит настройки лидов');
  asRole(app, 'director');
  app.S.ui.setTab = 'leads'; app.S.view = 'settings'; app.render();
  let html = viewHtml(app);
  assert.ok(/value="both" checked/.test(html), 'по умолчанию выбран вариант «оба»');
  for (const v of ['Битрикс24', 'Сайт напрямую', 'Оба']) assert.ok(html.includes(v), `нет варианта ${v}`);
  // пояснение — словами пользователя
  for (const t of ['почта, задачи', 'лиды с сайта', 'лиды и сделки', 'телефония или чаты', 'отказаться от Битрикса24', 'подключения', 'имитация']) assert.ok(html.toLowerCase().includes(t.toLowerCase()), `в пояснении нет «${t}»`);
  // выбор запоминается: в состоянии, на экране и после сохранения
  fireOn(app, 'change', 'lead-source', 'site');
  assert.equal(app.S.leadSource, 'site');
  html = viewHtml(app);
  assert.ok(/value="site" checked/.test(html) && !/value="both" checked/.test(html));
  assert.equal(app.Store.load(app.Store.dump(app.S).text).leadSource, 'site', 'выбор не сохраняется');
  fireOn(app, 'change', 'lead-source', 'bitrix');
  assert.equal(app.S.leadSource, 'bitrix');
  fireOn(app, 'change', 'lead-source', 'нет-такого');
  assert.equal(app.S.leadSource, 'bitrix', 'неизвестный источник записался');
  // и он действует: сайт выключен — имитация лид не создаёт
  const n = app.S.leads.length;
  app.A['lead-sim']({ dataset: { source: 'site' } });
  assert.equal(app.S.leads.length, n);
});

test('«Настройки → Лиды и сделки»: выбор «Битрикс24 / сайт» есть в демо и скрыт в рабочей версии, остальное на вкладке осталось', () => {
  const demo = asRole(load(), 'director');
  // в серверном режиме S поднимает вход в систему; здесь ставим состояние рабочей базы сами
  const { api: srv, ctx } = loadCode({ globals: { CRM_SERVER: 1 } });
  vm.runInContext("S = Object.assign(seedBase(), { me: 'pDir', ui: defaultUi() }); S.people.push({ id: 'pDir', name: 'Директор-пример', role: 'director' });", ctx);
  const tabHtml = app => app.SETTINGS_TABS.find(t => t.id === 'leads').render();
  const dh = tabHtml(demo), sh = tabHtml(srv);
  assert.ok(dh.includes('Откуда приходят лиды') && dh.includes('name="lead-source"') && dh.includes('Сайт напрямую'), 'в демо выбор источника пропал');
  assert.ok(!sh.includes('Откуда приходят лиды') && !sh.includes('lead-source') && !sh.includes('Сайт напрямую'), 'в рабочей версии выбор источника виден');
  assert.ok(!sh.includes('Битрикс24'), 'в рабочей версии на вкладке упоминается Битрикс24');
  for (const v of ['Время реакции на новый лид', 'Причины отказа']) assert.ok(sh.includes(v), 'на вкладке пропало «' + v + '»');
  assert.ok(srv.settingsTabs().some(t => t.id === 'leads'), 'вкладка осталась с содержимым, значит остаётся');
});

test('раздел «Сделки»: менеджер B2C видит только воронку B2C и только сделки B2C; у сделки видны тип и менеджер', () => {
  const app = load();
  asRole(app, 'managerB2c');
  app.go('deals');
  const html = viewHtml(app);
  assert.ok(html.includes('Сделки B2C'), 'нет воронки B2C');
  assert.ok(!html.includes('Сделки B2B'), 'видна воронка B2B');
  assert.ok(!html.includes('data-act="deal-type"'), 'у менеджера есть переключатель типа');
  // число сделок в воронке = сделки B2C из данных (считаем заново)
  // (проваленные сделки из колонок уходят в фильтр «Провалены» — в доске их нет)
  const funnelSum = [...html.matchAll(/class="dcnt">(\d+) /g)].reduce((s, m) => s + Number(m[1]), 0);
  const b2c = app.S.deals.filter(d => d.type === 'b2c');
  const open = b2c.filter(d => !d.lostReason);
  assert.equal(funnelSum, open.length);
  const rows = [...html.matchAll(/data-act="open-deal" data-id="([^"]+)"/g)].map(m => m[1]).sort();
  assert.deepEqual(rows, idsOf(open));
  // тип и менеджер — в доске и в карточке
  const d0 = open[0];
  const mgrName = app.S.people.find(p => p.id === d0.managerId).name;
  assert.ok(html.includes(mgrName) && html.includes('типа B2C'));
  const card = app.DRAWERS.deal(d0.id).body;
  assert.ok(card.includes('<option value="b2c" selected>B2C</option>') && card.includes(`<option value="${d0.managerId}" selected>${mgrName}</option>`));
  assert.ok(card.includes('Сделки B2C'), 'в карточке не сказано, в какой воронке сделка');
  // сделка из лида ведёт к лиду
  const fromLead = b2c.find(d => d.leadId);
  assert.ok(fromLead, 'в демо нет сделки из лида');
  asRole(app, 'director');
  assert.ok(app.DRAWERS.deal(fromLead.id).body.includes(`data-act="open-lead" data-id="${fromLead.leadId}"`), 'нет ссылки на лид');
  // менеджер B2B — наоборот
  asRole(app, 'managerB2b'); app.go('deals');
  const h2 = viewHtml(app);
  assert.ok(h2.includes('Сделки B2B') && !h2.includes('Сделки B2C'));
  // общий поиск не выдаёт сделки чужого типа: «Иванов Сергей» — клиент B2C
  assert.ok(!app.searchRes('Иванов Сергей').some(r => r.type === 'Сделка'), 'менеджер B2B нашёл сделку B2C через поиск');
  asRole(app, 'director');
  assert.ok(app.searchRes('Иванов Сергей').some(r => r.type === 'Сделка'), 'директор не нашёл сделку через поиск');
});

// ——— таск 10 (кусок 2): лид руками, дубли, дела при «Создать сделку», время реакции ———
// Ожидаемые значения посчитаны вручную: время — подмена NOW (пятница 31.10.2026, 12:00), порог по умолчанию 15 минут.

const MIN = 6e4;
const plusMin = n => new Date(NOW.getTime() + n * MIN);
// объекты из страницы живут в другом окружении vm: для deepEqual их сначала делают обычными
const plain = x => JSON.parse(JSON.stringify(x));

test('Leads.add: источник «другое» принят, тип и менеджер сами; без источника или без единого контакта — отказ; телефон существующего клиента находит его, привязка ставит clientId', () => {
  const app = load(), { Leads, Clients } = app, st = mini(app);
  assert.equal(Leads.SOURCE.other, 'другое');
  assert.equal(Leads.SOURCE.phone, 'звонок');
  const c = Clients.create(st, { name: 'ООО „Пример-Агро“', inn: '0000000001', phone: '+7 900 000-00-01' }, 'dir', NOW).client;
  // тот же номер в другой записи (8 вместо +7, скобки и дефисы) находит клиента
  const found = Clients.find(st, { phone: '8 (900) 000-00-01' });
  assert.deepEqual(plain(found.map(x => x.id)), [c.id], 'клиент по телефону не найден');
  // привязка к найденному
  const r = Leads.add(st, { source: 'phone', name: 'Иван', phone: '8 (900) 000-00-01', clientId: found[0].id }, 'dir', NOW);
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.lead.clientId, c.id, 'clientId не поставлен');
  assert.equal(r.lead.type, 'b2c');
  assert.equal(r.lead.managerId, 'c1', 'менеджер — по Leads.route');
  assert.equal(r.lead.source, 'phone');
  assert.ok(st.leads.includes(r.lead));
  assert.match(r.lead.history[0].text, /звонок/);
  assert.equal(r.lead.history[0].by, 'dir', 'кто завёл — в истории');
  // без привязки clientId нет
  assert.equal(Leads.add(st, { source: 'other', email: 'primer@example.com' }, 'dir', NOW).lead.clientId, undefined);
  // отказы
  assert.equal(Leads.add(st, { source: 'fax', name: 'Иван' }, 'dir', NOW).ok, false, 'неизвестный источник принят');
  const empty = Leads.add(st, { source: 'site', text: 'только текст' }, 'dir', NOW);
  assert.equal(empty.ok, false, 'лид без имени и контактов принят');
  assert.match(empty.reason, /имя|телефон/i);
  assert.equal(Leads.add(st, { source: 'site', name: 'Иван', clientId: 'К-нет' }, 'dir', NOW).ok, false, 'привязка к несуществующему клиенту принята');
  assert.equal(Leads.add(st, { source: 'site', name: 'Иван' }, 'wh', NOW).ok, false, 'кладовщик завёл лид');
});

test('toDeal: открытые дела лида переходят в сделку (ref меняется), в ленте сделки запись; выполненные остаются у лида; привязанный клиент становится клиентом сделки', () => {
  const app = load(), { Leads, Acts, Clients, Feed } = app, st = mini(app);
  const c = Clients.create(st, { name: 'Клиент-пример', phone: '+7 900 000-00-77' }, 'dir', NOW).client;
  const lead = Leads.add(st, { source: 'phone', name: 'Иван', phone: '+7 900 000-00-01', clientId: c.id }, 'dir', NOW).lead;
  const L1 = { t: 'lead', id: lead.id };
  const open1 = Acts.plan(st, L1, { type: 'call', title: 'Перезвонить', due: plusMin(60) }, 'c1', NOW).id;
  const open2 = Acts.plan(st, L1, { type: 'meet', title: 'Замер', due: plusMin(2000) }, 'c1', NOW).id;
  const gone = Acts.plan(st, L1, { type: 'mail', title: 'Письмо', due: plusMin(10) }, 'c1', NOW).id;
  Acts.done(st, gone, 'Отправили', 'c1', plusMin(5));
  const did = Leads.toDeal(st, lead.id, 'c1', plusMin(30));
  assert.ok(did, 'сделка не создана');
  assert.deepEqual(plain(Acts.byId(st, open1).ref), { t: 'deal', id: did });
  assert.deepEqual(plain(Acts.byId(st, open2).ref), { t: 'deal', id: did });
  assert.deepEqual(plain(Acts.byId(st, gone).ref), L1, 'выполненное дело ушло из лида');
  assert.deepEqual(plain(Acts.open(st, { t: 'deal', id: did }).map(a => a.id)), [open1, open2]);
  assert.equal(Acts.open(st, L1).length, 0);
  const text = Feed.of(st, { t: 'deal', id: did }).map(e => e.text).join('\n');
  assert.ok(text.includes('перенесены открытые дела') && text.includes('Перезвонить') && text.includes('Замер') && !text.includes('Письмо'), text);
  assert.equal(st.deals.find(d => d.id === did).clientId, c.id, 'клиент сделки — не тот, к которому привязан лид');
  assert.equal(st.clients.length, 1, 'завели лишнего клиента');
  // лид без дел: ни записи в ленте, ни ошибки
  const bare = Leads.add(st, { source: 'site', name: 'Пётр', phone: '+7 900 000-00-02' }, 'dir', NOW).lead;
  const did2 = Leads.toDeal(st, bare.id, 'c1', plusMin(30));
  assert.ok(!Feed.of(st, { t: 'deal', id: did2 }).some(e => /перенесены/.test(e.text)));
});

test('«лид ждёт»: есть РОП — получают РОП и директор; РОП нет — менеджеры типа лида (B2B, B2C, без типа — оба) и директор; директор выключает вид сам', () => {
  const app = load(), { Leads, Notify } = app;
  const MIN = 6e4, late = new Date(NOW.getTime() + 20 * MIN);
  // менеджеры: b1, b2 — B2B; c1 — B2C; кладовщик и директор — не менеджеры
  const wait = (st, data) => {
    const lead = Leads.create(st, data, NOW, { silent: true });
    const made = Leads.notifyWaiting(st, late);
    assert.equal(made.length, 1, 'ждёт один лид — одно уведомление');
    assert.equal(made[0].kind, 'leadWait');
    return { lead, to: [...made[0].to].sort() };
  };
  // РОП нет
  assert.deepEqual(wait(mini(app), B2B).to, ['b1', 'b2', 'dir'], 'лид B2B: менеджеры B2B и директор, менеджер B2C не получает');
  assert.deepEqual(wait(mini(app), B2C).to, ['c1', 'dir'], 'лид B2C: менеджеры B2C и директор');
  assert.deepEqual(wait(mini(app), NONE).to, ['b1', 'b2', 'c1', 'dir'], 'лид без типа: менеджеры обоих типов и директор');
  // нет менеджеров нужного типа — только директор
  const noB2b = mini(app, { people: mini(app).people.filter(p => p.role !== 'managerB2b') });
  assert.deepEqual(wait(noB2b, B2B).to, ['dir']);
  // есть РОП — РОП и директор, менеджеры не получают ни при каком типе
  for (const data of [B2B, B2C, NONE]) {
    const st = mini(app);
    st.roles = st.roles.concat(app.S.roles.filter(r => r.id === 'rop'));
    st.people.push({ id: 'rop1', name: 'РОП', role: 'rop' });
    assert.deepEqual(wait(st, data).to, ['dir', 'rop1']);
  }
  // директор выключил этот вид у себя («Настройки → Уведомления») — ему не приходит, остальным как раньше
  const st = mini(app);
  assert.equal(Notify.setWanted(st, 'dir', 'leadWait', false), true);
  assert.deepEqual(wait(st, B2C).to, ['c1']);
  // получатели считает одна функция
  assert.deepEqual([...Leads.waitRecipients(mini(app), { type: 'b2b' })].sort(), ['b1', 'b2']);
});

test('время реакции: «ждёт» только у открытого лида на первом этапе без действий дольше порога; уведомление РОП — один раз', () => {
  const app = load(), { Leads, Acts, Notify } = app, st = mini(app);
  st.roles = st.roles.concat(app.S.roles.filter(r => r.id === 'rop'));
  st.people.push({ id: 'rop1', name: 'РОП', role: 'rop' }, { id: 'rop2', name: 'РОП 2', role: 'rop' });
  const lead = Leads.create(st, B2C, NOW, { silent: true });
  assert.equal(Leads.waitMin(st), 15, 'порог по умолчанию');
  assert.equal(Leads.waiting(st, lead, plusMin(15)), null, 'ровно 15 минут — ещё не дольше');
  assert.equal(Leads.waiting(st, lead, plusMin(20)), 20);
  assert.equal(Leads.waiting(st, lead, plusMin(-5)), null, 'время до прихода лида');
  st.leadWaitMin = 30;
  assert.equal(Leads.waiting(st, lead, plusMin(20)), null, 'порог 30: 20 минут — ждать ещё можно');
  assert.equal(Leads.waiting(st, lead, plusMin(45)), 45);
  st.leadWaitMin = 15;
  // действие снимает ожидание: дело, комментарий, «Связались»
  const l2 = Leads.create(st, B2C, NOW, { silent: true });
  Acts.plan(st, { t: 'lead', id: l2.id }, { type: 'call', due: plusMin(100) }, 'c1', NOW);
  assert.equal(Leads.waiting(st, l2, plusMin(20)), null, 'запланированное дело — это действие');
  const l3 = Leads.create(st, B2C, NOW, { silent: true });
  app.Feed.comment(st, { t: 'lead', id: l3.id }, 'Звонил, не взяли', 'c1', plusMin(3));
  assert.equal(Leads.waiting(st, l3, plusMin(20)), null, 'комментарий — это действие');
  const l4 = Leads.create(st, B2C, NOW, { silent: true });
  Leads.contacted(st, l4.id, 'c1', plusMin(2));
  assert.equal(Leads.waiting(st, l4, plusMin(20)), null, '«Связались» — действие, и лид уже не на первом этапе');
  // закрытый лид не ждёт
  const l5 = Leads.create(st, B2C, NOW, { silent: true });
  Leads.close(st, l5.id, 'Не вышли на связь', 'c1', plusMin(1));
  assert.equal(Leads.waiting(st, l5, plusMin(20)), null);
  // остался один ждущий лид — lead. Уведомление: до порога тишина, после — РОП, второй раз не шлём
  const before = st.notes.length;
  assert.equal(Leads.notifyWaiting(st, plusMin(10)).length, 0);
  assert.equal(st.notes.length, before);
  const made = Leads.notifyWaiting(st, plusMin(20));
  assert.equal(made.length, 1, 'ждёт один лид — одно уведомление');
  assert.equal(made[0].kind, 'leadWait');
  assert.deepEqual([...made[0].to].sort(), ['dir', 'rop1', 'rop2'], 'есть РОП: получают РОП и директор, менеджеры нет');
  assert.ok(made[0].text.includes(lead.id) && made[0].text.includes('20 мин'), made[0].text);
  assert.equal(Leads.notifyWaiting(st, plusMin(40)).length, 0, 'второй раз то же уведомление ушло снова');
  assert.equal(st.notes.length, before + 1);
  assert.deepEqual([...Notify.RECIPIENTS.leadWait], ['director'], 'по карте — только директор; РОП или менеджеров добавляет Leads.waitRecipients');
  // новый лид — новое уведомление
  Leads.create(st, B2C, plusMin(41), { silent: true });
  assert.equal(Leads.notifyWaiting(st, plusMin(60)).length, 1);
});

// ——— экраны: «Новый лид», закрытие с причиной из списка, «ждёт», настройки ———

const elOf = (app, id) => app.document.getElementById(id);
const setVals = (app, vals) => { for (const [id, v] of Object.entries(vals)) elOf(app, id).value = v; };
const openLead = app => app.S.leads.find(l => l.managerId && !finished(l));

test('«Новый лид»: в разделе есть кнопка; в форме пять источников и нужные поля; телефон известного клиента показывает «Похоже, это клиент», «Привязать лид» ставит clientId, лид заводится с типом и менеджером', () => {
  const app = load(), { S } = app;
  openLeadsView(app, 'director');
  assert.ok(viewHtml(app).includes('data-act="lead-new"'), 'нет кнопки «Новый лид»');
  const form = app.MODALS.leadNew();
  for (const s of ['звонок', 'почта', 'сайт', 'Битрикс24', 'другое']) assert.ok(form.includes(`>${s}</option>`), 'нет источника ' + s);
  for (const f of ['ln-name', 'ln-phone', 'ln-email', 'ln-company', 'ln-inn', 'ln-text']) assert.ok(form.includes(`id="${f}"`), 'нет поля ' + f);
  assert.ok(form.includes('id="ln-dup"'));
  // известный клиент: телефон из демо
  const known = S.clients.find(c => c.phones.length);
  assert.ok(known, 'в демо нет клиента с телефоном');
  app.A['lead-new']({});
  setVals(app, { 'ln-phone': known.phones[0], 'ln-email': '', 'ln-inn': '' });
  fireOn(app, 'input', 'lead-dup', '');
  let dup = elOf(app, 'ln-dup').innerHTML;
  assert.ok(dup.includes('Похоже, это') && dup.includes(known.name) && dup.includes('data-act="lead-link"') && dup.includes('Привязать лид'), dup);
  assert.ok(!dup.includes('data-act="dup-pick"'), 'кнопка «Выбрать его» из «Клиентов» осталась: она открыла бы карточку вместо привязки');
  // привязка
  app.A['lead-link']({ dataset: { id: known.id } });
  dup = elOf(app, 'ln-dup').innerHTML;
  assert.ok(dup.includes('привязан к клиенту') && dup.includes(known.id) && dup.includes('data-act="lead-unlink"'), dup);
  app.A['lead-unlink']({});
  assert.ok(elOf(app, 'ln-dup').innerHTML.includes('data-act="lead-link"'), 'после «Не привязывать» подсказка не вернулась');
  app.A['lead-link']({ dataset: { id: known.id } });
  // сохранение
  const n = S.leads.length;
  setVals(app, { 'ln-source': 'mail', 'ln-name': 'Пример Иван', 'ln-company': '', 'ln-text': 'Звонили, просят расчёт' });
  app.FORMS['lead-new']({});
  assert.equal(S.leads.length, n + 1, 'лид не заведён: ' + elOf(app, 'ln-err').textContent);
  const lead = S.leads[S.leads.length - 1];
  assert.equal(lead.source, 'mail');
  assert.equal(lead.clientId, known.id);
  assert.equal(lead.type, 'b2c');
  assert.ok(lead.managerId, 'менеджер не выбран');
  assert.equal(lead.history[0].by, S.me, 'в истории не записано, кто завёл');
  assert.equal(S.ui.modal, null, 'окно не закрылось');
  assert.deepEqual(plain(S.ui.drawer), { type: 'lead', id: lead.id }, 'карточка нового лида не открылась');
  // пустая форма — отказ, лид не появляется
  app.A['lead-new']({});
  setVals(app, { 'ln-source': 'phone', 'ln-name': '', 'ln-phone': '', 'ln-email': '', 'ln-company': '', 'ln-inn': '', 'ln-text': 'только текст' });
  app.FORMS['lead-new']({});
  assert.equal(S.leads.length, n + 1);
  assert.match(elOf(app, 'ln-err').textContent, /хотя бы/);
});

test('закрытие лида: причины берутся из общего списка («Настройки → Лиды и сделки»); «Другое» — своими словами; список без «Другое» получает вариант свободного ввода', () => {
  const app = load(), { S, Deals } = app;
  asRole(app, 'director');
  const reasons = [...Deals.reasons(S)];
  assert.ok(reasons.length >= 3);
  let l = S.leads.find(x => x.managerId && !finished(x));
  let html = app.MODALS.leadLost(l.id);
  for (const r of reasons) assert.ok(html.includes(`<option value="${r}">${r}</option>`), 'нет причины из списка: ' + r);
  assert.equal((html.match(/<option/g) || []).length, reasons.length, 'в списке «Другое» уже есть — второго варианта быть не должно');
  assert.ok(html.includes('id="ll-other"'));
  // причина из списка
  setVals(app, { 'll-reason': reasons[0], 'll-other': '' });
  app.FORMS['lead-lost']({ dataset: { id: l.id } });
  assert.equal(l.stageId, 'lost');
  assert.equal(l.reason, reasons[0]);
  // «Другое» без слов — отказ; со словами — они и записываются
  l = S.leads.find(x => x.managerId && !finished(x));
  setVals(app, { 'll-reason': 'Другое', 'll-other': '  ' });
  app.FORMS['lead-lost']({ dataset: { id: l.id } });
  assert.match(elOf(app, 'll-err').textContent, /причин/);
  assert.notEqual(l.stageId, 'lost', 'лид закрыт без причины');
  setVals(app, { 'll-other': 'Купил у соседа' });
  app.FORMS['lead-lost']({ dataset: { id: l.id } });
  assert.equal(l.reason, 'Купил у соседа');
  // изменённый список: без «Другое» — добавляется вариант свободного ввода; пустой — только он
  S.lostReasons = [{ id: 'lr1', name: 'Дорого' }];
  html = app.MODALS.leadLost(l.id);
  assert.ok(html.includes('<option value="Дорого">') && html.includes('value="__other"'), html);
  S.lostReasons = [];
  l = S.leads.find(x => x.managerId && !finished(x));
  html = app.MODALS.leadLost(l.id);
  assert.equal((html.match(/<option/g) || []).length, 1);
  assert.ok(!/id="ll-other-f" hidden/.test(html), 'при пустом списке поле для своих слов спрятано');
  setVals(app, { 'll-reason': '__other', 'll-other': 'Свои слова' });
  app.FORMS['lead-lost']({ dataset: { id: l.id } });
  assert.equal(l.reason, 'Свои слова');
  // выбор «Другое» в списке показывает поле для слов
  S.lostReasons = undefined;
  const f = elOf(app, 'll-other-f');
  f.hidden = true;
  app.document.dispatchEvent({ type: 'change', target: { dataset: { on: 'lead-reason' }, value: 'Другое' } });
  assert.equal(f.hidden, false);
  app.document.dispatchEvent({ type: 'change', target: { dataset: { on: 'lead-reason' }, value: 'Дорого' } });
  assert.equal(f.hidden, true);
});

test('«ждёт N мин»: метка в списке и воронке; «Имитация: лид с сайта» даёт лид, который через 20 минут «ждёт»; РОП узнаёт один раз, демо-лиды при запуске тишину не нарушают', () => {
  const app = load(), { S, Leads } = app;
  asRole(app, 'director');
  app.render();
  assert.equal(S.notes.filter(n => n.kind === 'leadWait').length, 0, 'демо-лиды разослали уведомления при первом запуске');
  const sim = app.SIMS.find(s => s.id === 'lead-site');
  sim.run();
  const lead = S.leads[S.leads.length - 1];
  assert.ok(lead.sim, 'имитация не создала лид');
  const at = new Date(lead.at).getTime();
  assert.equal(app.leadWaitHtml(lead, new Date(at + 10 * MIN)), '', 'через 10 минут метки быть не должно');
  const html20 = app.leadWaitHtml(lead, new Date(at + 20 * MIN));
  assert.ok(html20.includes('ждёт 20 мин') && html20.includes('lead-wait'), html20);
  // в списке и в воронке — по настоящему времени: сдвигаем приход на 20 минут назад
  lead.at = new Date(Date.now() - 20 * MIN);
  const list = app.leadTable([lead]), card = app.leadCard(lead);
  assert.ok(list.includes('ждёт 20 мин'), 'в списке нет метки');
  assert.ok(card.includes('ждёт 20 мин'), 'в воронке нет метки');
  assert.ok(app.DRAWERS.lead(lead.id).body.includes('lead-waitnote'), 'в карточке нет пояснения');
  // РОП получает уведомление один раз
  const rop = S.people.find(p => p.role === 'rop').id, boss = S.people.find(p => p.role === 'director').id;
  app.render();
  let notes = S.notes.filter(n => n.kind === 'leadWait');
  assert.equal(notes.length, 1);
  assert.deepEqual(plain(notes[0].to).sort(), [boss, rop].sort(), 'получают РОП и директор');
  assert.ok(notes[0].text.includes(lead.id));
  app.render(); app.actsTick();
  assert.equal(S.notes.filter(n => n.kind === 'leadWait').length, 1, 'уведомление ушло повторно');
  // как только с лидом что-то сделали, метка исчезает
  app.Feed.comment(S, { t: 'lead', id: lead.id }, 'Позвонил', S.me, new Date());
  assert.ok(!app.leadTable([lead]).includes('ждёт'));
  assert.equal(Leads.waiting(S, lead, new Date()), null);
});

test('настройки «Лиды и сделки»: поле «Новый лид ждёт не дольше, мин» (по умолчанию 15) меняет порог; ноль и мусор — отказ', () => {
  const app = load(), { S, Leads } = app;
  asRole(app, 'director');
  let html = app.vLeadSettings();
  assert.ok(html.includes('Новый лид ждёт не дольше, мин') && html.includes('id="lead-wait"') && html.includes('value="15"'), 'нет поля или нет 15 по умолчанию');
  const lead = Leads.create(S, { source: 'site', name: 'Клиент-пример', phone: '+7 900 000-09-09' }, new Date(Date.now() - 10 * MIN), { silent: true });
  assert.equal(Leads.waiting(S, lead, new Date()), null, '10 минут при пороге 15 — ещё не ждёт');
  fireOn(app, 'change', 'lead-wait', '5');
  assert.equal(S.leadWaitMin, 5);
  assert.equal(Leads.waiting(S, lead, new Date()), 10, 'порог 5: лид уже ждёт');
  assert.ok(app.vLeadSettings().includes('value="5"'));
  for (const bad of ['0', 'abc', '-3', '1.5', '']) {
    fireOn(app, 'change', 'lead-wait', bad);
    assert.equal(S.leadWaitMin, 5, `значение «${bad}» принято`);
  }
  assert.ok(app.vLeadSettings().includes('Причины отказа') && app.vLeadSettings().includes('окно «Закрыть» у лида'));
  // без права «Настройки» — не меняется
  asRole(app, 'managerB2b');
  fireOn(app, 'change', 'lead-wait', '40');
  assert.equal(S.leadWaitMin, 5);
});

test('сделка: две строки одного товара — «Зарезервировать» не пропадает, пока не зарезервировано всё по товару; окно считает по сумме строк', () => {
  const app = load(), { S, Deals, Stock, DRAWERS, MODALS } = app;
  asRole(app, 'director');
  const now = new Date();
  const d = S.deals.find(x => Deals.state(S, x) === 'open');
  d.items = [];
  const prod = S.products.find(p => { const k = Stock.summary(S, p.id, now); return k.known && k.free >= 3 && Deals.reserved(S, d, p.id) === 0; });
  assert.ok(prod, 'в демо нет товара со свободным остатком');
  assert.ok(Deals.addItem(S, d.id, { productId: prod.id, qty: 1 }, S.me, now).ok);
  assert.ok(Deals.addItem(S, d.id, { productId: prod.id, qty: 1 }, S.me, now).ok);
  app.A['deal-tab']({ dataset: { tab: 'items' } });
  const btn = i => `data-act="deal-res" data-id="${d.id}" data-i="${i}"`;
  let body = DRAWERS.deal(d.id).body;
  assert.ok(body.includes(btn(0)) && body.includes(btn(1)));
  // резервируем 1 (одну штуку из двух): по товару ещё можно 1, поэтому кнопка есть у обеих строк
  const cell = Stock.bestCell(S, prod.id);
  const r = Deals.reserveItem(S, d.id, 0, { entityId: cell.entityId, cityId: cell.cityId, qty: 1 }, S.me, now);
  assert.equal(r.ok, true, r.reason);
  body = DRAWERS.deal(d.id).body;
  assert.ok(body.includes(btn(0)) && body.includes(btn(1)), 'после резерва одной штуки из двух кнопка пропала');
  const modal = MODALS.dealReserve(`${d.id}:1`);
  assert.ok(modal.includes('В сделке по этому товару') && modal.includes('осталось'), modal.slice(0, 600));
  assert.ok(modal.includes('id="dr-qty" class="inp" type="number" min="1" step="any" value="1"'), 'в окне предложено не 1 штука');
  // зарезервировали всё — кнопок нет
  assert.equal(Deals.reserveItem(S, d.id, 1, { entityId: cell.entityId, cityId: cell.cityId, qty: 1 }, S.me, now).ok, true);
  body = DRAWERS.deal(d.id).body;
  assert.ok(!body.includes(btn(0)) && !body.includes(btn(1)), 'кнопка осталась при полном резерве');
});
