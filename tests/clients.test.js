'use strict';
// Клиенты (таск 09, ядро): поиск дублей по телефону, почте и ИНН, заведение и правка, findOrCreate,
// связанные лиды, сделки и сообщения, клиент сделки из лида, демо-клиенты.
// Ожидаемые значения — из таска 09 и spec.md (истории 99–100), разобраны вручную; не из кода под тестом.

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.js');

const NOW = new Date(2026, 9, 31, 12, 0);
const LATER = new Date(2026, 9, 31, 13, 0);

// Маленькое состояние: директор, менеджеры B2B (b1) и B2C (c1), кладовщик (без права «клиенты»).
function mini(app, over = {}) {
  return Object.assign({
    // кладовщик без права «клиенты»: эти тесты проверяют отказ без права (по умолчанию у кладовщика оно есть)
    roles: app.Perms.defaultRoles().map(r => r.id === 'warehouse' ? { ...r, perms: { ...r.perms, clients: false, dealsAll: false } } : r),
    people: [
      { id: 'dir', name: 'Директор', role: 'director' },
      { id: 'b1', name: 'Менеджер B2B', role: 'managerB2b' },
      { id: 'c1', name: 'Менеджер B2C', role: 'managerB2c' },
      { id: 'wh', name: 'Кладовщик', role: 'warehouse' },
    ],
    prefs: { notify: {} }, notes: [], leads: [], deals: [], clients: [], feed: [], msgs: [], pipelines: app.Pipes.defaults(),
  }, over);
}
const ids = list => [...list].map(x => x.id).sort();

test('find: телефон сравнивается по цифрам — «+7 900 000-00-01» и «89000000001» один и тот же', () => {
  const app = load(), { Clients } = app;
  const st = mini(app);
  const a = Clients.create(st, { name: 'Клиент-пример А', phones: ['+7 900 000-00-01'] }, 'dir', NOW).client;
  Clients.create(st, { name: 'Клиент-пример Б', phone: '+7 900 000-00-02' }, 'dir', NOW);
  for (const q of ['89000000001', '8 (900) 000-00-01', '+79000000001', '9000000001', '7 900 000 00 01']) {
    assert.deepEqual(ids(Clients.find(st, { phone: q })), [a.id], `«${q}» не нашёл клиента А`);
  }
  assert.deepEqual(ids(Clients.find(st, { phone: '+7 900 000-00-03' })), [], 'другой номер найден');
  assert.deepEqual(ids(Clients.find(st, { phone: '000-00-01' })), [], 'совпали только последние цифры — это не тот же телефон');
  assert.deepEqual(ids(Clients.find(st, { phone: '' })), [], 'пустой телефон не должен находить всех');
  assert.deepEqual(ids(Clients.find(st, {})), []);
});

test('find: почта без учёта регистра и пробелов; ИНН по цифрам; сначала совпавшие по ИНН, потом по телефону, потом по почте', () => {
  const app = load(), { Clients } = app;
  const st = mini(app);
  const byMail = Clients.create(st, { name: 'Клиент-пример Почта', email: 'Primer1@Example.com' }, 'dir', NOW).client;
  const byPhone = Clients.create(st, { name: 'Клиент-пример Телефон', phone: '+7 900 000-00-05' }, 'dir', NOW).client;
  const byInn = Clients.create(st, { name: 'ООО „Пример-ИНН“', inn: '0000000007' }, 'dir', NOW).client;
  assert.deepEqual(ids(Clients.find(st, { email: ' primer1@example.COM ' })), [byMail.id]);
  assert.deepEqual(ids(Clients.find(st, { inn: '0000 000 007' })), [byInn.id]);
  assert.deepEqual(ids(Clients.find(st, { inn: '0000000008' })), []);
  // запрос совпал сразу с тремя разными клиентами: порядок — ИНН, телефон, почта
  const order = Clients.find(st, { inn: '0000000007', phone: '89000000005', email: 'primer1@example.com' }).map(c => c.id);
  assert.deepEqual([...order], [byInn.id, byPhone.id, byMail.id]);
});

test('create: без названия — отказ с missing; ИНН делает клиента компанией; один телефон в двух записях — один; без права «клиенты» нельзя', () => {
  const app = load(), { Clients } = app;
  const st = mini(app);
  const bad = Clients.create(st, { phone: '+7 900 000-00-01' }, 'dir', NOW);
  assert.equal(bad.ok, false);
  assert.deepEqual([...bad.missing], ['name']);
  assert.equal(st.clients.length, 0, 'клиент без названия записан');

  const ok = Clients.create(st, { name: 'ООО „Пример-Строй“', inn: '0000000001', phones: ['+7 900 000-00-01', '89000000001', '+7 900 000-00-02'] }, 'b1', NOW);
  assert.equal(ok.ok, true);
  const c = st.clients[0];
  assert.equal(c.id, ok.id);
  assert.equal(c.kind, 'company', 'есть ИНН — компания');
  assert.deepEqual([...c.phones], ['+7 900 000-00-01', '+7 900 000-00-02'], 'один и тот же номер записан дважды');
  assert.equal(Clients.create(st, { name: 'Клиент-пример' }, 'dir', NOW).client.kind, 'person');
  // в ленте клиента — запись «заведён» с автором и временем
  const e = st.feed.find(x => x.ref.t === 'client' && x.ref.id === c.id);
  assert.ok(e && e.by === 'b1' && e.at === NOW && e.kind === 'create');
  // кладовщик клиентов не заводит
  const no = Clients.create(st, { name: 'Клиент-пример В' }, 'wh', NOW);
  assert.equal(no.ok, false);
  assert.equal(st.clients.length, 2);
});

test('update: пустое название нельзя; новое название едет в сделки клиента; правка пишется в ленту клиента', () => {
  const app = load(), { Clients } = app;
  const st = mini(app);
  const c = Clients.create(st, { name: 'Клиент-пример А', phone: '+7 900 000-00-01' }, 'dir', NOW).client;
  st.deals.push({ id: 'Д-1', clientId: c.id, client: 'Клиент-пример А' }, { id: 'Д-2', clientId: 'К-99', client: 'Чужой' });
  assert.equal(Clients.update(st, c.id, { name: '   ' }, 'dir', LATER).ok, false);
  assert.equal(c.name, 'Клиент-пример А');
  const r = Clients.update(st, c.id, { name: 'Клиент-пример Б', email: 'b@example.com', phones: ['+7 900 000-00-09'] }, 'dir', LATER);
  assert.equal(r.ok, true);
  assert.deepEqual([...r.changed].sort(), ['email', 'name', 'phones']);
  assert.equal(c.name, 'Клиент-пример Б');
  assert.deepEqual([...c.phones], ['+7 900 000-00-09']);
  assert.equal(st.deals[0].client, 'Клиент-пример Б', 'название в сделке клиента не обновилось');
  assert.equal(st.deals[1].client, 'Чужой', 'чужая сделка тронута');
  const e = st.feed.find(x => x.kind === 'field' && x.ref.id === c.id);
  assert.ok(e && e.at === LATER && e.by === 'dir' && e.text.includes('Клиент-пример А') && e.text.includes('Клиент-пример Б'));
  // ничего не изменилось — записи в ленте нет
  const n = st.feed.length;
  assert.deepEqual([...Clients.update(st, c.id, { name: 'Клиент-пример Б' }, 'dir', LATER).changed], []);
  assert.equal(st.feed.length, n);
  assert.equal(Clients.update(st, 'К-404', { name: 'X' }, 'dir', LATER).ok, false);
});

test('findOrCreate: найденный клиент дополняется новым телефоном и почтой, но не затирается; нет совпадения — новый клиент', () => {
  const app = load(), { Clients } = app;
  const st = mini(app);
  const a = Clients.create(st, { name: 'Клиент-пример А', phone: '+7 900 000-00-01', email: 'a@example.com' }, 'dir', NOW).client;
  const same = Clients.findOrCreate(st, { name: 'Другое имя', phone: '89000000001', phones: ['+7 900 000-00-07'], email: 'other@example.com', inn: '0000000003' }, 'dir', LATER);
  assert.equal(same.created, false);
  assert.equal(same.client, a, 'не вернул того же клиента');
  assert.equal(st.clients.length, 1);
  assert.equal(a.name, 'Клиент-пример А', 'название затёрто');
  assert.equal(a.email, 'a@example.com', 'занятая почта затёрта');
  assert.deepEqual([...a.phones], ['+7 900 000-00-01', '+7 900 000-00-07'], 'новый телефон не дописан, а старый записан заново');
  assert.equal(a.inn, '0000000003', 'пустой ИНН не заполнен');
  // нет совпадения — новый клиент с тем, что дали
  const fresh = Clients.findOrCreate(st, { name: 'Клиент-пример Б', phone: '+7 900 000-00-02', managerId: 'c1', demo: true }, 'dir', LATER);
  assert.equal(fresh.created, true);
  assert.equal(st.clients.length, 2);
  assert.equal(fresh.client.managerId, 'c1');
  assert.equal(fresh.client.demo, true);
  // нет ни совпадения, ни названия — клиента не будет
  const none = Clients.findOrCreate(st, { phone: '+7 900 000-00-03' }, 'dir', LATER);
  assert.equal(none.client, null);
  assert.equal(st.clients.length, 2);
});

test('related: лиды (явная привязка или тот же телефон), сделки и сообщения; менеджер B2B не получает сделки и сообщения B2C', () => {
  const app = load(), { Clients } = app;
  const st = mini(app);
  const c = Clients.create(st, { name: 'Клиент-пример А', phone: '+7 900 000-00-01', inn: '0000000001' }, 'dir', NOW).client;
  const other = Clients.create(st, { name: 'Клиент-пример Б', phone: '+7 900 000-00-02' }, 'dir', NOW).client;
  const L = (id, extra) => Object.assign({ id, managerId: null, stageId: 'new', pipeId: 'leads', type: 'b2b', history: [] }, extra);
  st.leads.push(
    L('Л-1', { phone: '8 900 000 00 01' }),                       // тот же телефон, не привязан
    L('Л-2', { clientId: c.id, phone: '+7 900 000-00-77' }),      // привязан явно, телефон другой
    L('Л-3', { phone: '+7 900 000-00-01', clientId: other.id }),  // телефон тот же, но привязан к другому — не наш
    L('Л-4', { phone: '+7 900 000-00-02' }));                     // чужой
  st.deals.push(
    { id: 'Д-1', clientId: c.id, type: 'b2b', managerId: 'b1' },
    { id: 'Д-2', clientId: c.id, type: 'b2c', managerId: 'c1' },
    { id: 'Д-3', clientId: other.id, type: 'b2b', managerId: 'b1' });
  st.msgs.push({ id: 'm1', deal: 'Д-1', text: 'a' }, { id: 'm2', deal: 'Д-2', text: 'b' }, { id: 'm3', deal: 'Д-3', text: 'c' });
  const all = Clients.related(st, c.id);
  assert.deepEqual(ids(all.leads), ['Л-1', 'Л-2']);
  assert.deepEqual(ids(all.deals), ['Д-1', 'Д-2']);
  assert.deepEqual(ids(all.msgs), ['m1', 'm2']);
  assert.deepEqual([...all.dispatches], []);
  // менеджер B2B: видит только сделки B2B (и сообщения по ним); директор — обе
  const mine = Clients.related(st, c.id, 'b1');
  assert.deepEqual(ids(mine.deals), ['Д-1'], 'менеджер B2B увидел сделку B2C');
  assert.deepEqual(ids(mine.msgs), ['m1'], 'менеджер B2B увидел сообщение по сделке B2C');
  assert.deepEqual(ids(Clients.related(st, c.id, 'dir').deals), ['Д-1', 'Д-2']);
  assert.deepEqual(ids(Clients.related(st, c.id, 'wh').deals), [], 'кладовщик без права «клиенты» видит сделки');
  assert.deepEqual([...Clients.related(st, 'К-404').deals], []);
});

test('Leads.toDeal: клиент сделки — уже заведённый с тем же телефоном, иначе новый; лид и сделка ссылаются на него', () => {
  const app = load(), { Clients, Leads } = app;
  const st = mini(app);
  const old = Clients.create(st, { name: 'Клиент-пример Старый', phone: '89000000005' }, 'dir', NOW).client;
  const lead = Leads.create(st, { source: 'site', name: 'Контакт-пример', phone: '+7 900 000-00-05', text: 'Нужна станция' }, NOW, { silent: true });
  const id = Leads.toDeal(st, lead.id, lead.managerId, LATER);
  const d = st.deals.find(x => x.id === id);
  assert.equal(d.clientId, old.id, 'сделка привязана не к найденному клиенту');
  assert.equal(d.client, 'Клиент-пример Старый', 'название сделки — название найденного клиента');
  assert.equal(lead.clientId, old.id);
  assert.equal(st.clients.length, 1, 'завёлся второй клиент с тем же телефоном');
  // в ленте сделки — откуда она
  const e = st.feed.find(x => x.ref.t === 'deal' && x.ref.id === id);
  assert.ok(e && e.kind === 'create' && e.text.includes(lead.id) && e.at === LATER);
  // телефон другой — новый клиент, ИНН и название из заявки
  const l2 = Leads.create(st, { source: 'site', company: 'ООО „Пример-Агро“', inn: '0000000042', text: 'Расчёт' }, NOW, { silent: true });
  const id2 = Leads.toDeal(st, l2.id, l2.managerId, LATER);
  const d2 = st.deals.find(x => x.id === id2);
  const c2 = Clients.byId(st, d2.clientId);
  assert.equal(st.clients.length, 2);
  assert.ok(c2 && c2.id !== old.id && c2.name === 'ООО „Пример-Агро“' && c2.kind === 'company' && c2.inn === '0000000042');
  // тот же ИНН у третьего лида — снова он
  const l3 = Leads.create(st, { source: 'bitrix', name: 'Другой контакт', inn: '0000000042', text: 'Ещё' }, NOW, { silent: true });
  const id3 = Leads.toDeal(st, l3.id, l3.managerId, LATER);
  assert.equal(st.deals.find(x => x.id === id3).clientId, c2.id);
  assert.equal(st.clients.length, 2);
});

test('демо: у каждой сделки клиент, названия с «пример», телефоны +7 900 000-00-NN, дублей нет; лиды с тем же телефоном или ИНН — у того же клиента', () => {
  const app = load(), { S, Clients } = app;
  assert.ok(S.clients.length >= 25, `клиентов ${S.clients.length}`);
  for (const c of S.clients) {
    assert.equal(c.demo, true, `${c.id}: не помечен как демо`);
    assert.match(c.name, /пример/i, `${c.id}: в названии «${c.name}» нет «пример»`);
    for (const p of c.phones) assert.match(p, /^\+7 900 000-00-\d\d$/, `${c.id}: телефон ${p} не демонстрационный`);
    assert.ok(c.kind === 'company' || c.kind === 'person');
    // дубль — другой клиент с тем же телефоном, почтой или ИНН
    assert.deepEqual(ids(Clients.find(S, c)), [c.id], `${c.id}: дубль`);
  }
  for (const d of S.deals) {
    const c = Clients.byId(S, d.clientId);
    assert.ok(c, `${d.id}: клиента нет`);
    assert.equal(c.kind, d.type === 'b2b' ? 'company' : 'person', `${d.id}: вид клиента не по типу сделки`);
  }
  // лид, привязанный к клиенту, имеет с ним общие данные; лид, у которого есть подходящий клиент, не остаётся без привязки
  for (const l of S.leads.filter(x => x.clientId)) {
    const c = Clients.byId(S, l.clientId);
    assert.ok(c, `${l.id}: клиента нет`);
    assert.ok(Clients.find(S, l).some(x => x.id === c.id), `${l.id}: привязан к клиенту, с которым нет общих данных`);
  }
  for (const l of S.leads.filter(x => !x.clientId)) assert.deepEqual(ids(Clients.find(S, l)), [], `${l.id}: есть подходящий клиент, но лид не привязан`);
  const ivanov = S.clients.find(c => c.name.startsWith('Иванов Сергей'));
  const rel = Clients.related(S, ivanov.id);
  assert.deepEqual(ids(rel.deals), ['Д-311']);
  assert.ok(rel.leads.length >= 1 && rel.leads.every(l => l.phone === ivanov.phones[0]), 'повторный лид клиента не найден');
  assert.equal(rel.msgs.length, S.msgs.filter(m => m.deal === 'Д-311').length);
  const kfh = S.clients.find(c => c.name.startsWith('КФХ Петровых'));
  assert.ok(Clients.related(S, kfh.id).leads.some(l => l.inn === kfh.inn), 'лид с тем же ИНН не найден');
  // менеджер B2B (p3) не получает из карточки клиента B2C сделок; менеджер B2C (p2) получает
  assert.deepEqual(ids(Clients.related(S, ivanov.id, 'p3').deals), []);
  assert.deepEqual(ids(Clients.related(S, ivanov.id, 'p2').deals), ['Д-311']);
});

test('search: список «Клиенты» ищет по названию, телефону (по цифрам, в любой записи), ИНН и почте; пустой запрос — все', () => {
  const app = load(), { Clients } = app;
  const st = mini(app);
  const a = Clients.create(st, { name: 'ООО „Пример-Строй“', inn: '0000000012', phone: '+7 900 000-00-11' }, 'dir', NOW).client;
  const b = Clients.create(st, { name: 'Клиент-пример Анна', phone: '+7 900 000-00-22', email: 'anna@example.com' }, 'dir', NOW).client;
  assert.deepEqual(ids(Clients.search(st, 'строй')), [a.id], 'по названию без учёта регистра');
  assert.deepEqual(ids(Clients.search(st, '89000000022')), [b.id], 'по телефону в другой записи');
  assert.deepEqual(ids(Clients.search(st, '000-00-11')), [a.id], 'по части телефона');
  assert.deepEqual(ids(Clients.search(st, '0000000012')), [a.id], 'по ИНН');
  assert.deepEqual(ids(Clients.search(st, 'ANNA@')), [b.id], 'по почте');
  assert.deepEqual(ids(Clients.search(st, 'нет такого')), []);
  assert.deepEqual(ids(Clients.search(st, '')), ids(st.clients), 'пустой запрос — все клиенты');
  assert.deepEqual(ids(Clients.search(st, '12')), [], 'две цифры — не поиск по телефону и ИНН');
});

// ——— экран: раздел «Клиенты», дубли в формах, причины отказа ———
// Экраны вызываются на seed() через публичный интерфейс страницы: VIEWS, DRAWERS, MODALS, FORMS, A и события document.
const asPerson = (app, id) => { app.setMe(id); return app; };
const input = (app, key, value, extra = {}) => app.document.dispatchEvent({ type: 'input', target: { dataset: { on: key, ...extra }, value } });
const change = (app, key, value, extra = {}) => app.document.dispatchEvent({ type: 'change', target: { dataset: { on: key, ...extra }, value, tagName: 'INPUT' } });
const el = (app, id) => app.document.getElementById(id);
const rowsOf = html => [...html.matchAll(/data-act="open-client" data-id="([^"]+)"/g)].map(m => m[1]);

test('раздел «Клиенты»: пункт меню в «Продажах» только с правом «клиенты»; вид на seed() содержит всех клиентов; поиск по ИНН оставляет нужного', () => {
  const app = load(), { S } = app;
  const nav = app.NAV.find(n => n.id === 'clients');
  assert.ok(nav && nav.group === 'Продажи' && nav.label === 'Клиенты', 'нет пункта «Клиенты» в «Продажах»');
  assert.equal(nav.ok(), true, 'директору раздел закрыт');
  asPerson(app, 'p6');                                   // логист: права «клиенты» нет
  assert.equal(nav.ok(), false, 'логисту открыт раздел «Клиенты»');
  assert.equal(app.DRAWERS.client('К-1'), null, 'логисту открылась карточка клиента');
  asPerson(app, 'p1');

  app.go('clients');
  const html = app.VIEWS.clients();
  assert.ok(S.clients.length >= 25);
  assert.deepEqual(rowsOf(html).sort(), ids(S.clients), 'в списке не все клиенты');
  for (const c of S.clients) assert.ok(html.includes(app.esc(c.name)), `в списке нет «${c.name}»`);
  // сколько сделок: у клиента Иванов (Д-311) — одна
  const ivanov = S.clients.find(c => c.name.startsWith('Иванов Сергей'));
  assert.match(html, new RegExp(`data-id="${ivanov.id}"[\\s\\S]*?<td class="num">1</td>`), 'у клиента одной сделки не «1»');

  // поиск по ИНН: ожидаемое — клиенты с этим ИНН, посчитанные по данным
  const inn = S.clients.find(c => c.inn).inn;
  const want = ids(S.clients.filter(c => c.inn === inn));
  assert.ok(want.length >= 1 && want.length < S.clients.length);
  input(app, 'client-q', inn);
  assert.deepEqual(rowsOf(app.VIEWS.clients()).sort(), want, 'поиск по ИНН нашёл не тех');
  assert.deepEqual(rowsOf(el(app, 'client-body').innerHTML).sort(), want, 'обработчик поиска не перерисовал список');
  // кроме ИНН — по имени
  input(app, 'client-q', 'иванов сергей');
  assert.deepEqual(rowsOf(app.VIEWS.clients()), [ivanov.id]);
  input(app, 'client-q', 'совсем нет такого');
  assert.deepEqual(rowsOf(app.VIEWS.clients()), []);
  assert.ok(app.VIEWS.clients().includes('По этим условиям клиентов нет'));
  // вид клиента
  app.A['client-reset']();
  app.A['client-kind']({ dataset: { k: 'company' } });
  assert.deepEqual(rowsOf(app.VIEWS.clients()).sort(), ids(S.clients.filter(c => c.kind === 'company')));
});

test('карточка клиента: менеджер B2C не видит сделки B2B этого клиента, директор видит обе; сделка из карточки открывается; в карточке сделки — кнопка «клиент»', () => {
  const app = load(), { S, Clients, Deals } = app;
  const b2b = S.deals.find(d => d.id === 'Д-314');             // сделка B2B прежнего набора
  assert.equal(b2b.type, 'b2b');
  const client = Clients.byId(S, b2b.clientId);
  // тому же клиенту менеджер B2C (p2) заводит сделку B2C
  const made = Deals.create(S, { clientId: client.id, type: 'b2c', managerId: 'p2', object: 'Станция для дачи (пример)', channel: 'phone' }, 'p2', NOW);
  assert.equal(made.ok, true);

  asPerson(app, 'p1');
  let body = app.DRAWERS.client(client.id).body;
  assert.ok(body.includes('data-act="open-deal" data-id="Д-314"') && body.includes(`data-act="open-deal" data-id="${made.id}"`), 'директор не видит обе сделки клиента');
  asPerson(app, 'p2');                                          // менеджер B2C
  body = app.DRAWERS.client(client.id).body;
  assert.ok(body.includes(`data-act="open-deal" data-id="${made.id}"`), 'менеджер B2C не видит свою сделку B2C');
  assert.ok(!body.includes('Д-314'), 'менеджер B2C увидел сделку B2B в карточке клиента');
  // и лента клиента без записей сделки B2B
  assert.ok(!app.feedHtml({ t: 'client', id: client.id }).includes('Д-314'), 'в ленте клиента для менеджера B2C — запись сделки B2B');
  // менеджер B2B — наоборот
  asPerson(app, 'p3');
  body = app.DRAWERS.client(client.id).body;
  assert.ok(body.includes('data-id="Д-314"') && !body.includes(made.id), 'менеджер B2B видит не свои сделки');

  // из карточки клиента сделка открывается; у карточки сделки есть кнопка на клиента
  app.A['open-client']({ dataset: { id: client.id } });
  assert.deepEqual({ ...app.S.ui.drawer }, { type: 'client', id: client.id });
  app.A['open-deal']({ dataset: { id: 'Д-314' } });
  assert.deepEqual({ ...app.S.ui.drawer }, { type: 'deal', id: 'Д-314' });
  assert.ok(app.DRAWERS.deal('Д-314').body.includes(`data-act="open-client" data-id="${client.id}"`), 'в карточке сделки нет кнопки «клиент»');
  // связанные лиды: у клиента Иванов есть повторный лид, он показан и открывается
  asPerson(app, 'p1');
  const ivanov = S.clients.find(c => c.name.startsWith('Иванов Сергей'));
  const lead = Clients.related(S, ivanov.id).leads[0];
  assert.ok(app.DRAWERS.client(ivanov.id).body.includes(`data-act="open-lead" data-id="${lead.id}"`), 'лид клиента не показан в карточке');
});

test('карточка клиента: данные правятся на месте через Clients.update; пустое название не принимается', () => {
  const app = load(), { S, Clients } = app;
  asPerson(app, 'p1');
  const c = S.clients.find(x => x.name.startsWith('Иванов Сергей'));
  const id = c.id;
  const html = app.DRAWERS.client(id).body;
  for (const f of ['name', 'kind', 'inn', 'phones', 'email', 'managerId', 'address']) assert.ok(html.includes(`data-f="${f}"`), `нет поля «${f}»`);
  assert.ok(html.includes('нет данных: адрес'), 'пустой адрес не назван «нет данных»');
  change(app, 'client-f', 'Иванов Сергей Петрович (пример)', { id, f: 'name' });
  assert.equal(Clients.byId(S, id).name, 'Иванов Сергей Петрович (пример)');
  assert.equal(S.deals.find(d => d.clientId === id).client, 'Иванов Сергей Петрович (пример)', 'новое название не дошло до сделки');
  change(app, 'client-f', '+7 900 000-00-91, 89000000092', { id, f: 'phones' });
  assert.deepEqual([...Clients.byId(S, id).phones], ['+7 900 000-00-91', '89000000092']);
  assert.ok(S.feed.some(e => e.ref.t === 'client' && e.ref.id === id && e.kind === 'field' && e.text.includes('Телефоны')), 'правка не записана в ленту');
  change(app, 'client-f', '   ', { id, f: 'name' });
  assert.equal(Clients.byId(S, id).name, 'Иванов Сергей Петрович (пример)', 'пустое название принято');
  // логист: права «клиенты» нет — карточка закрыта
  asPerson(app, 'p6');
  assert.equal(app.DRAWERS.client(id), null);
});

test('дубли: в быстрой форме сделки телефон существующего клиента показывает «Похоже, это»; «Выбрать его» выбирает клиента; дубль всё же можно создать', () => {
  const app = load(), { S } = app;
  asPerson(app, 'p1');
  const c = S.clients.find(x => x.name.startsWith('Иванов Сергей'));
  assert.ok(app.MODALS.dealNew('').includes('id="dn-dup"'), 'в форме нет места под подсказку');
  assert.ok(app.MODALS.dealNew('').includes('data-on="deal-dup"'));
  app.openModal('dealNew', '');
  // тот же телефон другой записью: «8…» вместо «+7…»
  const typed = '8' + c.phones[0].replace(/\D/g, '').slice(1);
  el(app, 'dn-phone').value = typed;
  input(app, 'deal-dup', typed);
  const dup = el(app, 'dn-dup').innerHTML;
  assert.ok(dup.includes('Похоже, это'), 'нет «Похоже, это»');
  assert.ok(dup.includes(app.esc(c.name)) && dup.includes(c.id), 'нет найденного клиента');
  assert.ok(dup.includes('телефон'), 'не сказано, по чему совпало');
  assert.ok(dup.includes(`data-act="dup-open" data-id="${c.id}"`) && dup.includes(`data-act="dup-pick" data-id="${c.id}"`), 'нет ссылки или кнопки «Выбрать его»');
  assert.ok(dup.includes('Выбрать его'));
  // чужой телефон — подсказки нет
  el(app, 'dn-phone').value = '+7 911 111-11-11';
  input(app, 'deal-dup', '+7 911 111-11-11');
  assert.equal(el(app, 'dn-dup').innerHTML, '', 'подсказка у номера, которого нет');
  // ИНН — то же
  el(app, 'dn-phone').value = '';
  el(app, 'dn-inn').value = S.clients.find(x => x.inn).inn;
  input(app, 'deal-dup', '');
  assert.ok(el(app, 'dn-dup').innerHTML.includes('Похоже, это') && el(app, 'dn-dup').innerHTML.includes('ИНН'), 'по ИНН подсказки нет');
  el(app, 'dn-inn').value = '';

  // «Выбрать его»: клиент выбран в списке, поиск показывает его
  el(app, 'dn-phone').value = typed;
  app.A['dup-pick']({ dataset: { id: c.id } });
  assert.equal(el(app, 'dn-cq').value, c.name);
  assert.match(el(app, 'dn-cres').innerHTML, new RegExp(`value="${c.id}" data-on="deal-cs" checked`), 'найденный клиент не выбран');

  // без выбора дубль создать можно: подсказка не запрещает сохранение
  const before = S.clients.length, deals = S.deals.length;
  Object.assign(el(app, 'dn-type'), { value: 'b2c' });
  Object.assign(el(app, 'dn-cname'), { value: 'Иванов-дубль (пример)' });
  Object.assign(el(app, 'dn-mgr'), { value: 'p2' });
  Object.assign(el(app, 'dn-ch'), { value: 'phone' });
  el(app, 'dn-cres').innerHTML = '';
  app.FORMS['deal-new']({ dataset: { stage: '' } });
  assert.equal(S.clients.length, before + 1, 'дубль не создался');
  assert.equal(S.deals.length, deals + 1);
});

test('дубли: в окне «Новый клиент» совпавшие телефон, почта и ИНН дают «Похоже, это»; «Выбрать его» открывает найденного; новый клиент заводится', () => {
  const app = load(), { S, Clients } = app;
  asPerson(app, 'p1');
  assert.ok(app.MODALS.clientNew().includes('id="cn-dup"'));
  app.openModal('clientNew');
  const c = S.clients.find(x => x.email);
  assert.ok(c, 'в демо нет клиента с почтой');
  el(app, 'cn-phones').value = '+7 911 111-11-11, ' + c.phones[0];   // второй номер из списка — уже чей-то
  input(app, 'client-dup', '');
  let dup = el(app, 'cn-dup').innerHTML;
  assert.ok(dup.includes('Похоже, это') && dup.includes(app.esc(c.name)) && dup.includes('совпало: телефон'), 'телефон в списке не найден');
  el(app, 'cn-phones').value = '';
  el(app, 'cn-email').value = c.email.toUpperCase();
  input(app, 'client-dup', '');
  dup = el(app, 'cn-dup').innerHTML;
  assert.ok(dup.includes(app.esc(c.name)) && dup.includes('почта'), 'почта в другом регистре не найдена');
  el(app, 'cn-email').value = 'nobody@example.com';
  input(app, 'client-dup', '');
  assert.equal(el(app, 'cn-dup').innerHTML, '');

  // «Выбрать его» → окно закрыто, открыта карточка найденного, нового клиента нет
  const n = S.clients.length;
  app.A['dup-pick']({ dataset: { id: c.id } });
  assert.deepEqual({ ...S.ui.drawer }, { type: 'client', id: c.id });
  assert.equal(S.ui.modal, null);
  assert.equal(S.clients.length, n);

  // новый клиент: несколько телефонов через запятую, ИНН делает его компанией, менеджер выбран
  app.openModal('clientNew');
  Object.assign(el(app, 'cn-name'), { value: 'ООО „Пример-Новое“' });
  Object.assign(el(app, 'cn-kind'), { value: 'person' });
  Object.assign(el(app, 'cn-inn'), { value: '0000000999' });
  Object.assign(el(app, 'cn-phones'), { value: '+7 900 000-00-95, 89000000096' });
  Object.assign(el(app, 'cn-mgr'), { value: 'p3' });
  app.FORMS['client-new']({ dataset: {} });
  assert.equal(S.clients.length, n + 1);
  const made = S.clients[S.clients.length - 1];
  assert.ok(made.name === 'ООО „Пример-Новое“' && made.kind === 'company' && made.inn === '0000000999' && made.managerId === 'p3');
  assert.deepEqual([...made.phones], ['+7 900 000-00-95', '89000000096']);
  assert.deepEqual({ ...S.ui.drawer }, { type: 'client', id: made.id });
  // без названия — ошибка в окне, клиента нет
  app.openModal('clientNew');
  Object.assign(el(app, 'cn-name'), { value: '  ' });
  app.FORMS['client-new']({ dataset: {} });
  assert.equal(S.clients.length, n + 1);
  assert.ok(!el(app, 'cn-err').hidden && el(app, 'cn-err').textContent.length > 0);
  assert.ok(Clients.byId(S, made.id));
});

test('«Настройки → Лиды и сделки»: причины отказа добавляются, переименовываются и удаляются; проваленная сделка сохраняет текст причины', () => {
  const app = load(), { S, Deals } = app;
  asPerson(app, 'p1');
  assert.ok(app.settingsTabs().some(t => t.id === 'leads' && t.label === 'Лиды и сделки'), 'вкладка не переименована');
  const tab = () => app.SETTINGS_TABS.find(t => t.id === 'leads').render();
  const html = tab();
  assert.ok(html.includes('Причины отказа'));
  assert.ok(!html.includes('Клиенты и сделки'), 'осталось старое название «Клиенты и сделки»');
  for (const r of ['Дорого', 'Выбрали другого', 'Не дозвонились', 'Передумали', 'Другое']) assert.ok(html.includes(`value="${r}"`), `нет причины «${r}»`);
  assert.equal([...Deals.reasons(S)].length, 5);

  // добавить
  Object.assign(el(app, 'lr-new'), { value: '  Не устроил срок поставки ' });
  app.FORMS['reason-add']({ dataset: {} });
  assert.deepEqual([...Deals.reasons(S)].slice(-1), ['Не устроил срок поставки']);
  assert.ok(tab().includes('value="Не устроил срок поставки"'));
  // повтор (без учёта регистра) и пустая — отказ с объяснением, список не растёт
  Object.assign(el(app, 'lr-new'), { value: 'ДОРОГО' });
  app.FORMS['reason-add']({ dataset: {} });
  assert.ok(!el(app, 'lr-err').hidden && el(app, 'lr-err').textContent.includes('уже есть'));
  Object.assign(el(app, 'lr-new'), { value: '   ' });
  app.FORMS['reason-add']({ dataset: {} });
  assert.equal([...Deals.reasons(S)].length, 6);

  // новую причину можно выбрать в окне «Провалена» и записать в сделку
  const open = S.deals.find(d => !d.lostReason && Deals.state(S, d) === 'open');
  assert.ok(app.MODALS.dealLose(open.id).includes('value="Не устроил срок поставки"'), 'новой причины нет в окне «Провалена»');
  assert.equal(Deals.lose(S, open.id, 'Не устроил срок поставки', 'p1', NOW).ok, true);
  assert.ok(tab().includes('записана: 1'), 'не видно, сколько раз причина записана');

  // удалить: из списка пропала, у сделки текст остался
  const id = S.lostReasons.find(r => r.name === 'Не устроил срок поставки').id;
  app.A['reason-del']({ dataset: { id } });
  assert.ok(![...Deals.reasons(S)].includes('Не устроил срок поставки'));
  assert.ok(!app.MODALS.dealLose(S.deals.find(d => !d.lostReason).id).includes('Не устроил срок поставки'), 'удалённая причина осталась в окне «Провалена»');
  assert.equal(S.deals.find(d => d.id === open.id).lostReason, 'Не устроил срок поставки', 'удаление причины стёрло текст у проваленной сделки');
  assert.ok(app.DRAWERS.deal(open.id).body.includes('Не устроил срок поставки'), 'в карточке сделки пропала причина');

  // переименовать: список другой, проваленная сделка (Д-336 — «Дорого») прежняя
  const dorogo = S.lostReasons.find(r => r.name === 'Дорого').id;
  change(app, 'reason-name', 'Слишком дорого', { id: dorogo });
  assert.ok([...Deals.reasons(S)].includes('Слишком дорого') && ![...Deals.reasons(S)].includes('Дорого'));
  assert.equal(S.deals.find(d => d.id === 'Д-336').lostReason, 'Дорого');
  // в чужое имя переименовать нельзя
  change(app, 'reason-name', 'передумали', { id: dorogo });
  assert.ok([...Deals.reasons(S)].includes('Слишком дорого'));

  // без права «Настройки» список не меняется
  asPerson(app, 'p3');
  const n = [...Deals.reasons(S)].length;
  Object.assign(el(app, 'lr-new'), { value: 'Чужая причина' });
  app.FORMS['reason-add']({ dataset: {} });
  app.A['reason-del']({ dataset: { id: S.lostReasons[0].id } });
  assert.equal([...Deals.reasons(S)].length, n, 'менеджер без права «Настройки» поменял список причин');
});

// ——— объединение клиентов ———
// Демо-клиенты двух сделок: Д-311 (B2C, Анна p2) и Д-314 (B2B, Максим p3); к ним добавлено то, что должно переехать
function mergeFixture(app) {
  const { S, Clients, Acts } = app;
  const keep = Clients.byId(S, S.deals.find(d => d.id === 'Д-311').clientId);
  const drop = Clients.byId(S, S.deals.find(d => d.id === 'Д-314').clientId);
  drop.phones.push('+7 900 000-00-77');
  drop.address = 'Иркутск, ул. Пример, 1';
  drop.email = 'vtoroy@example.com';
  keep.email = keep.email || 'pervyj@example.com';
  const act = Acts.plan(S, { t: 'client', id: drop.id }, { type: 'call', title: 'Позвонить второму', due: new Date(2026, 10, 3, 10, 0) }, 'p1', NOW);
  assert.equal(act.ok, true, act.reason);
  S.notes.unshift({ id: 'n-merge', kind: 'task', by: null, at: NOW, text: 'Пример', to: ['p1'], read: [], ref: { t: 'client', id: drop.id } });
  return { keep, drop, act: act.act };
}
const on = id => r => !!r && r.t === 'client' && r.id === id;
const refsTo = (S, id) => S.deals.filter(d => d.clientId === id).length + S.leads.filter(l => l.clientId === id).length
  + [S.feed, S.acts, S.notes].reduce((n, list) => n + list.filter(x => on(id)(x.ref)).length, 0);

test('Clients.merge: сделки, лиды, дела, лента и уведомления второго у первого, контакты слиты без затирания, второй удалён, в ленте первого запись', () => {
  const app = load(), { S, Clients, Feed } = app;
  const { keep, drop, act } = mergeFixture(app);
  const before = Clients.refsTo(S, drop.id);
  assert.ok(before.deals.length && before.feed.length && before.acts.length === 1 && before.notes.length === 1, 'в примере есть что переносить');
  const keepEmail = keep.email, keepName = keep.name, keepPhones = [...keep.phones], n = S.clients.length, feedN = S.feed.length;
  const r = Clients.merge(S, keep.id, drop.id, 'p1', LATER);
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(JSON.parse(JSON.stringify(r.moved)), { deals: before.deals.length, leads: before.leads.length, feed: before.feed.length, acts: 1, notes: 1 });
  // второй удалён, ссылок на него не осталось нигде
  assert.equal(Clients.byId(S, drop.id), null);
  assert.equal(S.clients.length, n - 1);
  assert.equal(refsTo(S, drop.id), 0, 'на удалённого клиента что-то ещё ссылается');
  // всё переехало к первому
  for (const d of before.deals) assert.deepEqual([d.clientId, d.client], [keep.id, keepName]);
  for (const l of before.leads) assert.equal(l.clientId, keep.id);
  assert.deepEqual({ ...act.ref }, { t: 'client', id: keep.id });
  assert.deepEqual({ ...S.notes.find(x => x.id === 'n-merge').ref }, { t: 'client', id: keep.id });
  for (const e of before.feed) assert.equal(e.ref.id, keep.id);
  // контакты: занятое не затёрто, пустое и чужие телефоны добавлены
  assert.equal(keep.name, keepName);
  assert.equal(keep.email, keepEmail, 'почта первого осталась');
  assert.equal(keep.address, 'Иркутск, ул. Пример, 1', 'пустой адрес заполнен');
  assert.ok(keepPhones.every(p => keep.phones.includes(p)) && keep.phones.includes('+7 900 000-00-77'), 'телефоны слиты');
  assert.equal(new Set(keep.phones.map(Clients.phoneKey)).size, keep.phones.length, 'без повторов');
  // запись в ленте первого: одна новая, видом «merge», с номером удалённого
  assert.equal(S.feed.length, feedN + 1);
  const last = S.feed[S.feed.length - 1];
  assert.deepEqual([last.kind, last.ref.t, last.ref.id, last.data.dropId, last.by], ['merge', 'client', keep.id, drop.id, 'p1']);
  assert.ok(last.text.includes(drop.id) && last.text.includes(drop.name) && last.text.includes('vtoroy@example.com'), 'в записи названо, что объединено и что не перенесено: ' + last.text);
  assert.ok(Feed.of(S, { t: 'client', id: keep.id }).some(e => e.kind === 'merge'), 'запись видна в ленте клиента');
  assert.ok(Feed.of(S, { t: 'client', id: keep.id }).some(e => e.text.includes('Клиент заведён: ' + drop.name)), 'лента второго пришла к первому');
});

test('Clients.merge: отказ — тот же клиент, нет такого, нет права, невидимая сделка второго; состояние при отказе не меняется', () => {
  const app = load(), { S, Clients, Deals } = app;
  const { keep, drop } = mergeFixture(app);
  const snap = () => JSON.stringify(app.Docs.split(S));
  const was = snap();
  const no = (id1, id2, by, re) => {
    const r = Clients.merge(S, id1, id2, by, LATER);
    assert.equal(r.ok, false);
    assert.match(r.reason, re);
    assert.equal(snap(), was, 'отказ изменил состояние');
  };
  no(keep.id, keep.id, 'p1', /с ним самим/);
  no(keep.id, 'К-нет', 'p1', /нет/);
  no(keep.id, drop.id, 'p7', /нет права заводить и править клиентов/);   // инженер клиентов видит, но не правит
  // Анна (B2C) не видит клиента Д-314 (B2B)
  no(keep.id, drop.id, 'p2', /не виден/);
  // клиент виден Анне через её сделку, но у него есть ещё B2B-сделка Максима — её Анна не видит
  const hidden = Deals.create(S, { clientId: keep.id, type: 'b2b', managerId: 'p3' }, 'p1', NOW);
  assert.equal(hidden.ok, true, hidden.reason);
  const other = Clients.create(S, { name: 'Клиент-пример Третий', phone: '+7 900 000-00-79', managerId: 'p2' }, 'p1', NOW).client;
  assert.equal(Deals.create(S, { clientId: other.id, type: 'b2c', managerId: 'p2' }, 'p1', NOW).ok, true);
  const was2 = snap();
  const r = Clients.merge(S, other.id, keep.id, 'p2', LATER);
  assert.equal(r.ok, false);
  assert.match(r.reason, /не видны или которые вам нельзя править/);
  assert.equal(snap(), was2);
  // директор видит и правит всё — объединяет
  assert.equal(Clients.merge(S, other.id, keep.id, 'p1', LATER).ok, true);
});

test('демо: в карточке клиента есть «Объединить» (только у кого есть право править клиентов); выбор второго → подтверждение с текстом → клиент объединён, лента первого пополнена', () => {
  const app = load(), { S, Clients } = app;
  asPerson(app, 'p1');
  const { keep, drop, act } = mergeFixture(app);
  assert.ok(app.DRAWERS.client(keep.id).body.includes('data-act="client-merge"'), 'кнопки нет у директора');
  asPerson(app, 'p7');
  assert.ok(!app.DRAWERS.client(keep.id).body.includes('data-act="client-merge"'), 'кнопка у инженера, который клиентов не правит');
  app.A['client-merge']({ dataset: { id: keep.id } });
  assert.equal(S.ui.modal, null, 'инженеру окно не открылось');
  asPerson(app, 'p1');
  app.A['client-merge']({ dataset: { id: keep.id } });
  assert.equal(S.ui.modal.type, 'clientMerge');
  // поиск второго по имени; сам себя не предлагает
  input(app, 'client-mq', drop.name);
  const res = el(app, 'cm-res').innerHTML;
  assert.ok(res.includes(`value="${drop.id}"`), 'второй не найден поиском');
  assert.ok(!res.includes(`value="${keep.id}"`), 'клиент предложен сам себе');
  // без выбора — ошибка, дальше не идёт
  app.FORMS['client-merge']({ dataset: { id: keep.id } });
  assert.ok(!el(app, 'cm-err').hidden && /Выберите клиента/.test(el(app, 'cm-err').textContent));
  assert.equal(Clients.byId(S, drop.id) !== null, true);
  // выбран → подтверждение с текстом из задания
  change(app, 'client-mc', drop.id);
  app.FORMS['client-merge']({ dataset: { id: keep.id } });
  const confirm = app.MODALS.clientMerge(keep.id);
  assert.ok(confirm.includes(`${drop.name}</b> <small class="muted mono">${drop.id}</small> будет удалён, его сделки, задачи, дела, лента и контакты перейдут к <b>${keep.name}`), 'нет текста подтверждения');
  assert.equal(Clients.byId(S, drop.id) !== null, true, 'до подтверждения второй цел');
  // подтверждено
  app.FORMS['client-merge']({ dataset: { id: keep.id } });
  assert.equal(Clients.byId(S, drop.id), null, 'второй не удалён');
  assert.equal(S.ui.modal, null);
  assert.equal(refsTo(S, drop.id), 0);
  assert.equal(S.deals.find(d => d.id === 'Д-314').clientId, keep.id);
  assert.deepEqual({ ...act.ref }, { t: 'client', id: keep.id });
  assert.ok(app.feedHtml({ t: 'client', id: keep.id }).includes('Объединён с ' + drop.id), 'в ленте первого нет записи об объединении');
});
