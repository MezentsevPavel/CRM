'use strict';
// Таск 06, третий кусок: главный экран «что сделать сегодня», строка «что здесь и зачем», группы меню, пустые списки,
// «Пульт проверки», реестр поиска. Ожидаемые значения — из таска, спецификации и чисел, разобранных вручную по данным
// (а не вызовом той же функции, что стоит под тестом).

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.js');

const asRole = (app, role) => {
  const p = app.S.people.find(x => x.role === role);
  app.setMe(p.id);
  return p;
};
const view = app => app.document.getElementById('view').innerHTML;
const tile = (app, id) => app.homeTiles().find(t => t.id === id);
const ids = app => Array.from(app.homeTiles(), t => t.id);
// «Сегодня в 23:59» и «вчера» — срок дела или задачи относительно настоящего момента
const todayLate = () => { const d = new Date(); d.setHours(23, 59, 0, 0); return d; };
const hoursAgo = n => new Date(Date.now() - n * 36e5);
const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(12, 0, 0, 0); return d; };
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
// сумма сделки по данным: строки с ценой — количество × цена × (1 − скидка/100); строк нет — вписанная сумма
const byHand = d => (d.items && d.items.length
  ? d.items.reduce((s, it) => s + (typeof it.price === 'number' ? it.qty * it.price * (100 - (it.disc || 0)) / 100 : 0), 0)
  : (d.amount || 0));
// открытая сделка по данным: не проиграна и стоит на этапе без флага final
const openDeal = (app, d) => {
  const stage = app.S.pipelines.find(p => p.id === d.pipeId).stages.find(s => s.id === d.stageId);
  return !d.lostReason && !(stage && stage.flag === 'final');
};
const pushAct = (app, ref, owner, due, extra = {}) => {
  app.S.acts.push({ id: 'ax' + (app.S.acts.length + 1), ref, type: 'todo', title: 'Дело для проверки', due, ownerId: owner, by: owner, at: new Date(), remind: null, ...extra });
};

// ——— плитки главного экрана ———

test('плитка «Поставки к приёмке» = поставки на этапе «прибыло» не принятые; растёт, когда прибывает ещё одна', () => {
  const app = load();
  asRole(app, 'director');
  const arrived = app.S.pipelines.find(p => p.kind === 'ships' && p.dir !== 'out').stages.find(s => s.flag === 'arrived').id;
  const hand = () => app.S.shipments.filter(s => s.dir === 'in' && !s.received && s.stageId === arrived).length;
  assert.ok(hand() > 0, 'в демо нет поставок к приёмке — проверка пустая');
  assert.equal(tile(app, 'receipt').value, hand());
  assert.equal(tile(app, 'receipt').value, app.Ships.awaitingReceipt(app.S).length);
  // ещё одну поставку в пути переводим на «прибыло» — число плитки растёт на единицу
  const before = hand();
  const moving = app.S.shipments.find(s => s.dir === 'in' && !s.received && s.stageId !== arrived && !app.isDone(s));
  app.Ships.setStage(app.S, moving.id, arrived, null, new Date());
  assert.equal(hand(), before + 1);
  assert.equal(tile(app, 'receipt').value, before + 1);
  assert.ok(app.VIEWS.home().includes(`data-tile="receipt"><span class="k-l">Поставки к приёмке</span><b class="k-v">${before + 1}</b>`), 'на экране нет нового числа');
});

test('плитка «Мои дела»: сегодня и просроченные считает Acts.counts; чужие дела и завтрашние не входят', () => {
  const app = load();
  const me = asRole(app, 'director');
  app.S.acts = [];
  const deal = app.S.deals.find(d => openDeal(app, d));
  const ref = { t: 'deal', id: deal.id };
  pushAct(app, ref, me.id, hoursAgo(3));            // просрочено
  pushAct(app, ref, me.id, hoursAgo(30));           // просрочено
  pushAct(app, ref, me.id, todayLate());            // сегодня
  pushAct(app, ref, me.id, tomorrow());             // завтра — не в счёт
  pushAct(app, ref, 'p2', hoursAgo(2));             // чужое — не в счёт
  pushAct(app, ref, me.id, hoursAgo(5), { doneAt: new Date(), result: 'сделано' }); // выполнено — не в счёт
  const t = tile(app, 'acts');
  assert.equal(t.overdue, 2);
  assert.equal(t.today, 1);
  assert.equal(t.value, 3);
  const c = app.Acts.counts(app.S, me.id, new Date());
  assert.deepEqual([t.today, t.overdue], [c.today, c.overdue], 'плитка не равна Acts.counts');
  assert.ok(t.tone === 'bad', 'просроченные дела — плитка тревожная');
});

test('плитка «Сделки без следующего шага»: Acts.noNext по видимым открытым сделкам; у менеджера B2C — только его тип', () => {
  const app = load();
  const mgr = asRole(app, 'managerB2c');
  app.S.acts = [];
  // вручную: видимые менеджеру B2C открытые сделки — его типа или его собственные
  const mine = app.S.deals.filter(d => openDeal(app, d) && (d.type === 'b2c' || d.managerId === mgr.id));
  assert.ok(mine.length >= 2 && app.S.deals.some(d => d.type === 'b2b' && openDeal(app, d)), 'в демо мало сделок — проверка пустая');
  assert.equal(tile(app, 'nonext').value, mine.length, 'без дел все открытые видимые сделки — «без следующего шага»');
  pushAct(app, { t: 'deal', id: mine[0].id }, mgr.id, tomorrow());
  assert.equal(tile(app, 'nonext').value, mine.length - 1, 'дело у сделки не убрало её из плитки');
  const core = mine.filter(d => app.Acts.noNext(app.S, { t: 'deal', id: d.id })).length;
  assert.equal(tile(app, 'nonext').value, core, 'плитка не равна Acts.noNext');
  // директору видны сделки обоих типов
  asRole(app, 'director');
  const all = app.S.deals.filter(d => openDeal(app, d) && !app.S.acts.some(a => !a.doneAt && a.ref.t === 'deal' && a.ref.id === d.id)).length;
  assert.equal(tile(app, 'nonext').value, all);
});

test('плитка «Отправки на сегодня»: открытые заявки с датой «сегодня»; у водителя — только назначенные ему', () => {
  const app = load();
  asRole(app, 'director');
  const closed = ['delivered', 'cancelled'];
  const hand = pid => app.S.dispatches.filter(d => sameDay(d.when.date, new Date()) && !closed.includes(d.stageId) && (!pid || d.driverId === pid)).length;
  assert.ok(hand() > hand(app.S.people.find(p => p.role === 'driver').id), 'в демо у водителя столько же заявок, сколько у всех — проверка пустая');
  assert.equal(tile(app, 'dispatch').value, hand());
  assert.equal(tile(app, 'dispatch').value, app.Dispatch.query(app.S, { today: true, now: new Date() }).filter(d => !closed.includes(d.stageId)).length);
  for (const role of ['logist', 'warehouse']) {
    asRole(app, role);
    assert.equal(tile(app, 'dispatch').value, hand(), `${role}: число отправок не равно общему`);
  }
  const drv = asRole(app, 'driver');
  assert.equal(tile(app, 'dispatch').value, hand(drv.id), 'у водителя на плитке не только его заявки');
  // заявка отменена — уходит из плитки
  const one = app.S.dispatches.find(d => sameDay(d.when.date, new Date()) && d.driverId === drv.id && !closed.includes(d.stageId));
  one.stageId = 'cancelled';
  assert.equal(tile(app, 'dispatch').value, hand(drv.id));
});

test('плитка «Резервы с истёкшим сроком»: Stock.expired; в последний день срока резерв ещё действует', () => {
  const app = load();
  asRole(app, 'managerB2c');
  const deal = app.S.deals.find(d => d.type === 'b2c' && openDeal(app, d));
  const p = app.S.products.find(x => x.id === app.S.reserves[0].productId);
  const mk = (id, until, dealId) => ({ id, productId: p.id, qty: 1, entityId: 'ip', cityId: 'irk', src: 'stock', dealId, until });
  app.S.reserves = [mk('rx1', app.day(-1), deal.id), mk('rx2', app.day(-3), deal.id), mk('rx3', app.day(0), deal.id), mk('rx4', app.day(5), deal.id)];
  assert.equal(tile(app, 'reserves').value, 2, 'вышедшими должны быть вчерашний и позавчерашний, но не сегодняшний');
  assert.deepEqual(Array.from(app.Stock.expired(app.S, new Date()), r => r.id).sort(), ['rx1', 'rx2']);
  // резерв под чужую сделку (другой тип) менеджеру B2C не виден
  const other = app.S.deals.find(d => d.type === 'b2b');
  app.S.reserves.push(mk('rx5', app.day(-2), other.id));
  assert.equal(tile(app, 'reserves').value, 2, 'менеджер B2C видит просроченный резерв сделки B2B');
  asRole(app, 'director');
  assert.equal(tile(app, 'reserves').value, 3);
  // «Требует внимания» называет просроченные резервы
  assert.ok(app.VIEWS.home().includes('Срок резерва вышел'));
});

test('плитка «Мои задачи на сегодня»: сегодня и просроченные, моего отдела тоже; закрытые и завтрашние не входят', () => {
  const app = load();
  const me = asRole(app, 'director');
  const board = app.Pipes.of(app.S, 'tasks')[0];
  const open = board.stages.find(s => !s.flag).id, done = board.stages.find(s => s.flag === 'final').id;
  app.S.tasks = [];
  const mk = (id, due, stageId, to) => ({ id, title: 'Задача ' + id, to: to || { t: 'p', id: me.id }, from: 'p2', due, boardId: board.id, stageId, prio: 'normal', desc: '', at: new Date(), deal: '' });
  app.S.tasks.push(mk('tx1', todayLate(), open), mk('tx2', hoursAgo(30), open), mk('tx3', tomorrow(), open),
    mk('tx4', hoursAgo(30), done), mk('tx5', todayLate(), open, { t: 'p', id: 'p2' }), mk('tx6', hoursAgo(50), open, { t: 'd', id: me.dept }));
  const t = tile(app, 'tasks');
  assert.equal(t.today, 1, 'на сегодня: только tx1');
  assert.equal(t.overdue, 2, 'просрочены: tx2 и задача отдела tx6; закрытая tx4 не в счёт');
  assert.equal(t.value, 3);
  assert.equal(t.tone, 'bad');
  // «просрочена» — то же определение, что в списке задач
  assert.equal(t.overdue, app.S.tasks.filter(x => app.taskMine(x) && app.taskOverdue(x)).length);
  // нулевая плитка спокойная: не красная
  app.S.tasks = [];
  const z = tile(app, 'tasks');
  assert.equal(z.value, 0);
  assert.equal(z.tone, '', 'нулевая плитка тревожная');
  assert.ok(app.VIEWS.home().includes('class="ttile calm"'), 'у нулевой плитки нет спокойного вида');
});

test('плитка «Новые лиды»: Leads.fresh; у кладовщика её нет, у менеджера B2C есть', () => {
  const app = load();
  const mgr = asRole(app, 'managerB2c');
  assert.equal(tile(app, 'leads').value, app.Leads.fresh(app.S, mgr.id).length);
  // вручную: открытые лиды менеджера на первом этапе воронки
  const first = app.Pipes.of(app.S, 'leads')[0].stages[0].id;
  assert.equal(tile(app, 'leads').value, app.S.leads.filter(l => l.managerId === mgr.id && l.stageId === first).length);
  asRole(app, 'warehouse');
  assert.ok(!ids(app).includes('leads'), 'у кладовщика есть плитка лидов');
  assert.ok(!app.VIEWS.home().includes('data-tile="leads"'));
  asRole(app, 'rop');
  assert.ok(ids(app).includes('leads'), 'у РОП нет плитки лидов');
});

test('у каждой роли свой набор плиток: лишнего не показываем', () => {
  const app = load();
  const want = {
    director: ['tasks', 'leads', 'receipt', 'reserves', 'dispatch', 'acts', 'nonext'],
    managerB2b: ['tasks', 'leads', 'reserves', 'acts', 'nonext'],
    managerB2c: ['tasks', 'leads', 'reserves', 'acts', 'nonext'],
    logist: ['tasks', 'receipt', 'dispatch', 'acts'],
    warehouse: ['tasks', 'receipt', 'dispatch', 'acts'],
    driver: ['tasks', 'dispatch', 'acts'],
    engineer: ['tasks', 'acts'],
  };
  for (const [role, list] of Object.entries(want)) {
    asRole(app, role);
    assert.deepEqual(ids(app), list, `${role}: набор плиток не тот`);
  }
  asRole(app, 'driver');
  assert.ok(ids(app).includes('dispatch'), 'у водителя нет плитки отправок');
});

test('нажатие на плитку открывает нужный список уже с фильтром', () => {
  const app = load();
  const click = id => app.A['home-tile']({ dataset: { tile: id } });
  asRole(app, 'director');
  click('nonext');
  assert.equal(app.S.view, 'deals');
  assert.equal(app.S.ui.deals.acts, 'none', 'фильтр «без дел» не включён');
  click('leads');
  assert.equal(app.S.view, 'leads');
  assert.equal(app.S.ui.leads.stage, app.Pipes.of(app.S, 'leads')[0].stages[0].id, 'лиды не отфильтрованы по первому этапу');
  click('receipt');
  assert.equal(app.S.view, 'receiving');
  click('reserves');
  assert.equal(app.S.view, 'stock');
  click('tasks');
  assert.equal(app.S.view, 'tasks');
  const drv = asRole(app, 'driver');
  click('dispatch');
  assert.equal(app.S.view, 'dispatch');
  assert.deepEqual([app.S.ui.dispatch.today, app.S.ui.dispatch.driver], [true, drv.id], 'у водителя не включены «сегодня» и он сам как водитель');
  assert.equal(app.dspList(app.dspSel(), false).length, tile(app, 'dispatch').value + app.dspList(app.dspSel(), false).filter(d => ['delivered', 'cancelled'].includes(d.stageId)).length, 'список после нажатия показывает не то, что плитка');
  // плитку, которой у роли нет, нажать нельзя
  app.S.view = 'home';
  click('leads');
  assert.equal(app.S.view, 'home', 'водитель открыл лиды плиткой');
  // у логиста приёмки нет — плитка ведёт в поставки на этап «прибыло»
  asRole(app, 'logist');
  click('receipt');
  assert.equal(app.S.view, 'logistics');
  assert.equal(app.S.ui.ships.stage, app.Pipes.of(app.S, 'ships').find(p => p.dir !== 'out').stages.find(s => s.flag === 'arrived').id);
});

test('Deals.sumOf — сумма Deals.total по списку; колонка доски, шапка «Сделок» и плитка берут её одну', () => {
  const app = load();
  asRole(app, 'director');
  const open = app.S.deals.filter(d => openDeal(app, d));
  assert.ok(open.some(d => d.items.length) && open.length > 3);
  const want = open.reduce((s, d) => s + byHand(d), 0);
  assert.ok(Math.abs(app.Deals.sumOf(open) - want) < 0.01, `sumOf ${app.Deals.sumOf(open)} ≠ ${want}`);
  assert.equal(app.Deals.sumOf([]), 0);
  assert.equal(app.Deals.sumOf(undefined), 0);
  // колонки доски
  const pipe = app.dealPipe('b2b');
  const cols = app.Deals.columns(app.S, pipe.id, {}, app.S.me);
  assert.ok(cols.some(c => c.sum > 0));
  for (const c of cols) assert.equal(c.sum, app.Deals.sumOf(c.deals), `колонка «${c.stage.name}»: сумма не равна sumOf`);
  // шапка колонки на экране = то же число
  app.S.ui.dealType = 'b2b';
  const board = app.dealsBoard(pipe, 'b2b', app.dealsSel());
  for (const c of cols) if (c.sum) assert.ok(board.includes(`data-sum="${c.sum}"`), `в шапке колонки «${c.stage.name}» нет суммы ${c.sum}`);
  // меняем цену в одной сделке — колонка и шапка списка меняются вместе
  const d = cols.find(c => c.deals.some(x => x.items.length && x.items.some(i => typeof i.price === 'number'))).deals.find(x => x.items.length);
  d.items.forEach(i => { if (typeof i.price === 'number') i.price += 1000; });
  const cols2 = app.Deals.columns(app.S, pipe.id, {}, app.S.me);
  const was = cols.find(c => c.stage.id === d.stageId).sum, now = cols2.find(c => c.stage.id === d.stageId).sum;
  assert.ok(now > was, 'цена выросла, сумма колонки — нет');
  const list = app.Deals.query(app.S, app.dealsFilter(app.dealsSel(), 'b2b'), app.S.me);
  assert.ok(app.dealsBody().includes(app.rub(app.Deals.sumOf(list))), 'шапка списка сделок показывает не sumOf');
});

// ——— меню и подписи ———

test('в каждой группе меню не больше 6 пунктов — у каждой встроенной роли', () => {
  const app = load();
  const roles = app.S.roles.filter(r => r.builtin);
  assert.ok(roles.length >= 9, 'встроенных ролей меньше девяти');
  for (const r of roles) {
    const p = app.S.people.find(x => x.role === r.id);
    assert.ok(p, `у роли ${r.id} нет человека в демо`);
    app.S.me = p.id;
    const vis = app.navItems();
    for (const g of app.GROUPS) {
      const n = vis.filter(x => x.group === g).length;
      assert.ok(n <= app.MAX_GROUP, `${r.id}: в группе «${g}» ${n} пунктов`);
    }
    assert.ok(vis.every(x => app.GROUPS.includes(x.group)), `${r.id}: пункт меню без известной группы`);
  }
  assert.equal(app.MAX_GROUP, 6);
  // директор: «Пульт проверки» встал в группу «Управление»
  asRole(app, 'director');
  assert.ok(app.navItems().some(n => n.id === 'sims' && n.group === 'Управление'));
});

test('у каждого пункта меню есть строка «что здесь и зачем», и оболочка ставит её под заголовком раздела', () => {
  const app = load();
  asRole(app, 'director');
  assert.ok(app.NAV.length >= 14);
  for (const n of app.NAV) {
    assert.ok(typeof n.hint === 'string' && n.hint.trim().length >= 20, `у раздела «${n.label}» нет строки «что здесь и зачем»`);
    assert.ok(n.hint.length <= 160, `строка раздела «${n.label}» длиннее 160 знаков — это уже не одна фраза`);
    assert.ok(!/\b(CRM|API|ID|воронк)/i.test(n.hint.replace(/воронки/g, '')) || n.id === 'settings', `в строке «${n.label}» жаргон`);
  }
  for (const n of app.navItems()) {
    app.go(n.id);
    assert.ok(view(app).startsWith(`<p class="sec-hint">${app.esc(n.hint)}</p>`), `раздел «${n.label}»: под заголовком нет его строки`);
  }
  // раздел, закрытый роли, строки не показывает — только «Нет доступа»
  asRole(app, 'engineer');
  app.S.view = 'team';
  app.render();
  assert.ok(view(app).includes('Нет доступа к разделу') && !view(app).includes('sec-hint'));
});

// ——— пустые списки ———

test('emptyState: текст, кнопка с действием и атрибутами; без кнопки — только текст; текст экранируется', () => {
  const app = load();
  const h = app.emptyState('Задач нет <b>совсем</b>.', 'Поставить', 'new-task', 'data-f="all"');
  assert.ok(h.includes('class="empty-st"') && h.includes('data-act="new-task"') && h.includes('data-f="all"') && h.includes('>Поставить</button>'));
  assert.ok(h.includes('&lt;b&gt;совсем') && !h.includes('<b>совсем'));
  const t = app.emptyState('Пусто.');
  assert.ok(t.includes('Пусто.') && !t.includes('<button'));
  assert.ok(!app.emptyState('Пусто.', '', 'x').includes('<button'), 'кнопка без подписи');
});

test('пустые списки во всех разделах объясняют, как наполнить, и дают кнопку с живым действием', () => {
  const app = load();
  asRole(app, 'director');
  const act = html => {
    const m = /class="empty-st">(?:(?!<\/div>)[\s\S])*?data-act="([^"]+)"/.exec(html);
    return m ? m[1] : null;
  };
  const cases = [];
  app.S.tasks = [];
  cases.push(['задачи', app.VIEWS.tasks(), 'new-task']);
  app.S.leads = [];
  cases.push(['лиды', app.leadBody(), 'lead-new']);
  app.S.deals = [];
  cases.push(['сделки', app.dealsBody(), 'deal-new']);
  app.S.clients = [];
  cases.push(['клиенты', app.clientsBody(), 'client-new']);
  app.S.dispatches = [];
  cases.push(['отправки', app.dspBody(), 'dsp-new']);
  app.S.ui.sq = 'ъъъъъъъъ';
  cases.push(['остатки по фильтру', app.stockTable(), 'stock-reset']);
  app.S.ui.mvPid = 'нет-такого';
  cases.push(['журнал движений', app.movesTable(), 'stock-journal']);
  app.setShipUi({ q: 'ъъъъъъъъ' });
  cases.push(['поставки по фильтру', app.shipTable(app.shipUi(), app.shipPrefs(), 'in', new Date()), 'ship-reset']);
  app.S.notes = [];
  cases.push(['уведомления', app.VIEWS.notifications(), 'note-k']);
  app.S.shipments = [];
  app.syncRcv();
  cases.push(['приёмка', app.VIEWS.receiving(), 'go']);
  app.S.ui.mail = { q: 'ъъъъъъъъ' };
  cases.push(['почта по запросу', app.mailItems(app.mailSel()), 'mail-q-clear']);
  for (const [name, html, want] of cases) {
    assert.ok(html.includes('class="empty-st"'), `${name}: пустой список без общего вида`);
    assert.equal(act(html), want, `${name}: кнопка пустого списка не «${want}»`);
    assert.equal(typeof app.A[want], 'function', `${name}: у кнопки «${want}» нет действия`);
  }
  // кнопки работают: сброс остатков чистит поиск, «Очистить поиск» в почте — запрос
  Object.assign(app.S.ui, { brand: 'x', avail: 'y', catf: 'in', deficit: true });
  app.A['stock-reset']();
  assert.deepEqual([app.S.ui.sq, app.S.ui.brand, app.S.ui.avail, app.S.ui.catf, app.S.ui.deficit, app.S.ui.cat], ['', '', '', '', false, 'Все']);
  app.A['mail-q-clear']();
  assert.equal(app.S.ui.mail.q, '');
  // главный экран без задач — тоже с кнопкой
  app.S.tasks = [];
  assert.ok(app.myTasksHtml().includes('data-act="new-task"'));
});

// ——— пульт проверки ———

test('SIMS: все пять имитаций возвращают {text, view}, и в состоянии что-то появилось', () => {
  const app = load();
  asRole(app, 'director');
  app.Leads.setSource(app.S, 'both');
  assert.deepEqual(Array.from(app.SIMS, s => s.id).sort(), ['arrival', 'carrier', 'lead-bitrix', 'lead-site', 'mail']);
  const navIds = app.NAV.map(n => n.id);
  const snap = () => ({
    leads: app.S.leads.length, letters: app.S.mail.letters.length, notes: app.S.notes.length,
    marks: app.S.shipments.reduce((n, s) => n + s.history.length, 0), wait: app.Ships.awaitingReceipt(app.S).length,
  });
  for (const sim of app.SIMS) {
    const was = snap();
    const r = sim.run();
    const now = snap();
    assert.ok(r && typeof r.text === 'string' && r.text.length > 10, `${sim.id}: нет строки «что произошло»`);
    assert.ok(navIds.includes(r.view), `${sim.id}: view «${r.view}» — не раздел`);
    assert.ok(now.notes > was.notes, `${sim.id}: уведомление не пришло`);
    if (sim.id === 'lead-site' || sim.id === 'lead-bitrix') {
      assert.equal(now.leads, was.leads + 1, `${sim.id}: лид не появился`);
      const l = app.S.leads.find(x => x.id === r.id);
      assert.ok(l && l.source === (sim.id === 'lead-site' ? 'site' : 'bitrix'), `${sim.id}: id в ответе не от нового лида`);
      assert.equal(r.view, 'leads');
    } else if (sim.id === 'mail') {
      assert.equal(now.letters, was.letters + 1, 'письмо не появилось');
      assert.ok(app.S.mail.letters.some(x => x.id === r.id), 'id в ответе не от нового письма');
      assert.equal(r.view, 'mail');
    } else if (sim.id === 'carrier') {
      assert.equal(now.marks, was.marks + 1, 'в истории поставки не появилась отметка перевозчика');
      assert.ok(app.ship(r.id), 'id в ответе не от поставки');
    } else {
      assert.equal(now.wait, was.wait + 1, 'поставка не встала в «ждёт приёмки»');
      assert.ok(app.Ships.awaitingReceipt(app.S, app.ship(r.id)), 'поставка из ответа не ждёт приёмки');
    }
  }
});

test('SIMS: лид не создан (источник выключен) — текст объясняет, и в состоянии ничего не появилось', () => {
  const app = load();
  asRole(app, 'director');
  app.Leads.setSource(app.S, 'bitrix');
  const n = app.S.leads.length;
  const r = app.SIMS.find(s => s.id === 'lead-site').run();
  assert.equal(app.S.leads.length, n);
  assert.ok(r.text.includes('не создан') && r.view);
});

test('«Пульт проверки»: пункт меню только у директора и admin; запуск показывает, что вышло, ссылка ведёт туда', () => {
  const app = load();
  for (const role of ['managerB2b', 'managerB2c', 'logist', 'warehouse', 'engineer', 'driver', 'rop']) {
    asRole(app, role);
    assert.ok(!app.navItems().some(n => n.id === 'sims'), `${role}: пульт в меню`);
    // действие не сработает и по прямому вызову
    const n = app.S.leads.length;
    app.A['sim-run']({ dataset: { id: 'lead-site' } });
    assert.equal(app.S.leads.length, n, `${role}: запустил имитацию`);
    app.S.view = 'sims';
    app.render();
    assert.ok(view(app).includes('Нет доступа к разделу'), `${role}: пульт открылся по адресу`);
  }
  asRole(app, 'director');
  app.Leads.setSource(app.S, 'both');
  app.go('sims');
  let h = view(app);
  assert.ok(h.startsWith('<p class="sec-hint">'));
  for (const s of app.SIMS) assert.ok(h.includes(`data-act="sim-run" data-id="${s.id}"`), `в пульте нет кнопки «${s.id}»`);
  assert.deepEqual(Array.from(h.matchAll(/data-act="sim-run" data-id="([^"]+)"/g), m => m[1]), ['lead-site', 'lead-bitrix', 'mail', 'carrier', 'arrival'], 'карточки пульта идут не в порядке задачи');
  assert.ok(h.includes('Пока не запускали.') && !h.includes('Что произошло'));
  // запуск: лид появился, под кнопкой — что произошло и ссылка
  const n = app.S.leads.length;
  app.A['sim-run']({ dataset: { id: 'lead-site' } });
  assert.equal(app.S.leads.length, n + 1);
  const lead = app.S.leads[app.S.leads.length - 1];
  h = view(app);
  assert.ok(h.includes('Что произошло') && h.includes(`лид ${lead.id}`), 'в пульте не видно, что произошло');
  assert.ok(h.includes('data-act="sim-open" data-id="lead-site"') && h.includes('Посмотреть: Лиды'), 'нет ссылки на лиды');
  assert.ok(!h.includes('data-act="sim-open" data-id="mail"'), 'ссылка у имитации, которую не запускали');
  // ссылка открывает раздел и карточку лида
  app.A['sim-open']({ dataset: { id: 'lead-site' } });
  assert.equal(app.S.view, 'leads');
  assert.deepEqual([app.S.ui.drawer.type, app.S.ui.drawer.id], ['lead', lead.id]);
  // письмо: ссылка выбирает ящик и письмо
  app.go('sims');
  app.A['sim-run']({ dataset: { id: 'mail' } });
  const letter = app.S.mail.letters[app.S.mail.letters.length - 1];
  app.A['sim-open']({ dataset: { id: 'mail' } });
  assert.equal(app.S.view, 'mail');
  assert.equal(app.S.ui.mail.letter, letter.id);
  assert.equal(app.S.ui.mail.box, letter.boxId);
  // прибытие груза: ссылка открывает карточку поставки
  app.go('sims');
  app.A['sim-run']({ dataset: { id: 'arrival' } });
  const r = app.S.ui.sims.arrival;
  app.A['sim-open']({ dataset: { id: 'arrival' } });
  assert.deepEqual([app.S.view, app.S.ui.drawer.type, app.S.ui.drawer.id], ['logistics', 'ship', r.id]);
});

// ——— поиск ———

test('SEARCH: источники регистрируют сами разделы; директор находит товар, сделку, лид, клиента, отправку, поставку и задачу', () => {
  const app = load();
  asRole(app, 'director');
  assert.deepEqual(Array.from(app.SEARCH, s => s.kind).sort(), ['client', 'deal', 'dispatch', 'lead', 'product', 'ship', 'task']);
  for (const s of app.SEARCH) assert.ok(s.kind && s.label && typeof s.find === 'function');
  const S = app.S;
  const probes = [
    ['product', S.products.find(p => p.inCatalog).name, 'open-product'],
    ['deal', S.deals[0].client, 'open-deal'],
    ['lead', S.leads[0].company || S.leads[0].name, 'open-lead'],
    ['client', S.clients[0].name, 'open-client'],
    ['dispatch', S.dispatches[0].number, 'open-dispatch'],
    ['ship', S.shipments[0].id, 'open-ship'],
    ['task', S.tasks[0].title, 'open-task'],
  ];
  for (const [kind, q, act] of probes) {
    const r = app.searchRes(q).filter(x => x.kind === kind);
    assert.ok(r.length > 0, `поиск «${q}» не нашёл вид «${kind}»`);
    assert.ok(r.every(x => x.act.includes(`data-act="${act}"`) && x.label && x.type), `${kind}: запись не {type, label, act}`);
  }
  // короткая строка — ничего; новый источник подхватывается без правки оболочки
  assert.equal(app.searchRes('я').length, 0);
  app.SEARCH.push({ kind: 'x', label: 'Проба', find: q => [{ title: 'Нашёл ' + q, sub: 'sub', open: 'data-act="go" data-view="home"' }] });
  assert.ok(app.searchRes('проверка').some(x => x.kind === 'x' && x.label === 'Нашёл проверка' && x.type === 'Проба'));
});

test('поиск: менеджер B2C находит сделку своего типа и не находит сделку B2B; менеджер B2B — наоборот', () => {
  const app = load();
  const b2c = app.S.deals.find(d => d.type === 'b2c'), b2b = app.S.deals.find(d => d.type === 'b2b');
  const unique = d => app.S.deals.filter(x => x.client === d.client).length === 1;
  assert.ok(b2c && b2b && unique(b2c) && unique(b2b), 'в демо нет однозначных сделок двух типов');
  const found = (q, id) => app.searchRes(q).some(x => x.kind === 'deal' && x.act.includes(`data-id="${id}"`));
  asRole(app, 'managerB2c');
  assert.ok(found(b2c.client, b2c.id), 'менеджер B2C не нашёл сделку своего типа');
  assert.ok(!found(b2b.client, b2b.id), 'менеджер B2C нашёл сделку B2B');
  asRole(app, 'managerB2b');
  assert.ok(found(b2b.client, b2b.id), 'менеджер B2B не нашёл сделку своего типа');
  assert.ok(!found(b2c.client, b2c.id), 'менеджер B2B нашёл сделку B2C');
  // права: у кладовщика нет ни сделок, ни лидов, ни клиентов — только то, что ему открыто
  asRole(app, 'warehouse');
  const kinds = new Set(app.searchRes(b2c.client).map(x => x.kind));
  assert.ok(!kinds.has('deal') && !kinds.has('lead') && !kinds.has('client'));
});

test('Stock.expired: в последний день срока резерв действует, на следующий — вышел; без until не считается', () => {
  const app = load();
  const st = { reserves: [{ id: 'a', until: new Date(2026, 10, 1, 9) }, { id: 'b', until: new Date(2026, 10, 2, 0, 0) }, { id: 'c', until: new Date(2026, 9, 30, 23, 59) }, { id: 'd' }] };
  const now = new Date(2026, 10, 2, 8, 0);
  assert.deepEqual(Array.from(app.Stock.expired(st, now), r => r.id), ['a', 'c']);
  assert.deepEqual(Array.from(app.Stock.expired(st, new Date(2026, 10, 1, 23, 0)), r => r.id), ['c']);
  assert.equal(app.Stock.expired({}, now).length, 0);
});

test('главный экран: точка задачи — taskDot(t) по флагу и месту этапа, а не по id этапа', () => {
  const app = load();
  const me = asRole(app, 'director');
  app.S.pipelines.push({ id: 'odd', kind: 'tasks', name: 'Странная', stages: [
    { id: 'done', name: 'Старт' }, { id: 'review', name: 'Середина' }, { id: 'work', name: 'Финиш', flag: 'final' },
  ] });
  app.S.tasks = [
    { id: 'tz1', title: 'Середина пути', to: { t: 'p', id: me.id }, from: me.id, due: app.day(1), boardId: 'odd', stageId: 'review', prio: 'normal', desc: '', at: new Date() },
    { id: 'tz2', title: 'Только начали', to: { t: 'p', id: me.id }, from: me.id, due: app.day(2), boardId: 'odd', stageId: 'done', prio: 'normal', desc: '', at: new Date() },
  ];
  const h = app.myTasksHtml();
  assert.ok(h.includes('class="tdot info"'), 'точка середины пути не «info»');
  assert.ok(h.includes('class="tdot "'), 'точка первого этапа не пустая');
  assert.ok(!h.includes('tdot review') && !h.includes('tdot done'), 'цвет точки берётся из id этапа');
});

// ——— строки и подтверждения ———

test('строка таблицы поставок и журнала движений открывает карточку; поле внутри строки её не открывает', () => {
  const app = load();
  asRole(app, 'director');
  const s = app.S.shipments[0];
  const row = app.shipRow(s, app.shipPrefs(), new Date());
  assert.ok(row.startsWith('<tr class="srow click') && row.includes(`data-act="open-ship" data-id="${s.id}"`), 'строка поставки не открывает карточку');
  const m = app.S.moves[0];
  app.S.ui.mvPid = m.productId;
  assert.ok(app.movesTable().includes(`<tr class="click" data-act="open-product" data-pid="${m.productId}"`), 'строка журнала не открывает товар');
  // нажатие на поле внутри строки (список этапов) карточку не открывает, на саму строку — открывает
  const tr = { tagName: 'TR', dataset: { act: 'open-ship', id: s.id }, closest: () => null };
  const click = (target) => { app.S.ui.drawer = null; app.document.dispatchEvent({ type: 'click', target }); return app.S.ui.drawer; };
  const inner = tag => ({ tagName: tag, classList: { contains: () => false }, closest: sel => (sel === '[data-act]' ? tr : /select/.test(sel) ? { tagName: 'SELECT' } : null) });
  assert.equal(click(inner('SELECT')), null, 'выбор этапа в строке открыл карточку');
  const cell = { tagName: 'TD', classList: { contains: () => false }, closest: sel => (sel === '[data-act]' ? tr : null) };
  const d = click(cell);
  assert.deepEqual([d && d.type, d && d.id], ['ship', s.id], 'нажатие на строку не открыло карточку');
});

test('подтверждение: текст шаблона и адрес склада сохраняются сами, а когда закончили писать — короткое сообщение', () => {
  const app = load();
  asRole(app, 'director');
  const msgs = [];
  app.document.getElementById('toasts').appendChild = el => msgs.push(el.innerHTML || '');
  assert.equal(typeof app.ON.change.tpl, 'function', 'нет подтверждения у шаблона');
  assert.equal(typeof app.ON.change.addr, 'function', 'нет подтверждения у адреса склада');
  app.ON.change.tpl({}); app.ON.change.addr({});
  assert.ok(msgs.length === 2 && msgs[0].includes('Шаблон сообщения сохранён') && msgs[1].includes('Адрес склада сохранён'), 'сообщений нет: ' + msgs.join('|'));
});
