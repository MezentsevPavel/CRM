'use strict';
// Права на чтение (таск 01 серверной сборки): Visible.of — копия общего состояния для человека, Visible.client и
// Visible.task — единственные правила видимости клиента и задачи. Ожидания — из interfaces.md («Visible.of»), прав ролей
// по спецификации (R03, R27–R30: инженер и кладовщик без «цен», логист и водитель без «клиентов») и демо-данных
// (Д-311 — сделка B2C Анны С., Д-314 — B2B Максима Л.), а не из кода под тестом.

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.js');

const NOW = new Date(2026, 10, 1, 12, 0);
const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x));
const ids = list => Array.from(list, x => x.id).sort();

let APP = null;
const app = () => APP || (APP = load({ now: NOW }));
// Демо-человек каждой из девяти ролей
const ROLES = ['director', 'managerB2b', 'managerB2c', 'logist', 'warehouse', 'chiefEngineer', 'engineer', 'rop', 'driver'];
const personOf = (st, role) => st.people.find(p => p.role === role).id;

test('Visible.of: для каждой из девяти ролей — только видимые сделки, лиды, клиенты, задачи, лента и дела; исходник не меняется', () => {
  const { seed, Visible, Leads, Perms } = app();
  const st = seed();
  const before = canon(st);
  for (const role of ROLES) {
    const pid = personOf(st, role), v = Visible.of(st, pid);
    assert.deepEqual(ids(v.deals), ids(Leads.dealsVisible(st, pid)), `${role}: сделки`);
    assert.deepEqual(ids(v.leads), ids(Leads.visible(st, pid)), `${role}: лиды`);
    assert.deepEqual(ids(v.clients), ids(st.clients.filter(c => Visible.client(st, c, pid))), `${role}: клиенты`);
    assert.deepEqual(ids(v.tasks), ids(st.tasks.filter(t => Visible.task(st, t, pid))), `${role}: задачи`);
    const deals = new Set(v.deals.map(d => d.id)), leads = new Set(v.leads.map(l => l.id)), clients = new Set(v.clients.map(c => c.id));
    const refOk = r => (r.t === 'deal' ? deals.has(r.id) : r.t === 'lead' ? leads.has(r.id) : r.t === 'client' ? clients.has(r.id) : r.t === 'dispatch');
    assert.ok(v.feed.every(e => refOk(e.ref)), `${role}: в ленте запись невидимой карточки`);
    assert.ok(v.acts.every(a => refOk(a.ref)), `${role}: дело невидимой карточки`);
    assert.equal(v.feed.length, st.feed.filter(e => refOk(e.ref)).length, `${role}: из ленты пропали видимые записи`);
    // личного в копии нет
    for (const k of ['me', 'view', 'ui', 'rcv', 'v']) assert.ok(!(k in v), `${role}: личный ключ ${k} в копии`);
    // уведомления: свои; с правом «вся фирма» — все
    if (Perms.can(st, pid, 'firm')) assert.equal(v.notes.length, st.notes.length, `${role}: директору не все уведомления`);
    else assert.ok(v.notes.every(n => n.to.includes(pid)), `${role}: чужое уведомление`);
    // почта и переписка с клиентами — пустые
    assert.equal(v.mail.letters.length + v.mail.boxes.length + v.mail.suppliers.length, 0, `${role}: почта`);
    assert.equal(v.msgs.length, 0, `${role}: переписка`);
  }
  assert.equal(canon(st), before, 'Visible.of изменил исходное состояние');
});

test('Visible.of: кто что видит по ролям демо — B2B не видит сделку B2C, логист и водитель — ни одной, инженеры — все', () => {
  const { seed, Visible } = app();
  const st = seed();
  const of = role => Visible.of(st, personOf(st, role));
  const b2b = of('managerB2b');
  assert.ok(b2b.deals.some(d => d.id === 'Д-314'), 'менеджер B2B не видит свою Д-314');
  assert.ok(!b2b.deals.some(d => d.id === 'Д-311'), 'менеджер B2B видит сделку B2C Д-311');
  assert.ok(b2b.deals.every(d => d.type === 'b2b' || d.managerId === personOf(st, 'managerB2b')));
  assert.equal(of('logist').deals.length, 0);
  assert.equal(of('driver').deals.length, 0);
  assert.equal(of('chiefEngineer').deals.length, st.deals.length);
  assert.equal(of('director').deals.length, st.deals.length);
  // поставки — с правом остатков, перевозок или приёмки; у водителя их нет
  assert.equal(of('driver').shipments.length, 0);
  assert.equal(of('logist').shipments.length, st.shipments.length);
  assert.equal(of('warehouse').shipments.length, st.shipments.length);
});

test('Visible.of: резерв и движение невидимой сделки остаются, но без её номера — hidden; Stock.reserveView → «сделка скрыта»', () => {
  const { seed, Visible, Stock } = app();
  const st = seed();
  const pid = personOf(st, 'managerB2b'), v = Visible.of(st, pid);
  const r1 = v.reserves.find(r => r.id === 'r1');
  assert.ok(r1, 'резерв r1 (Д-311) пропал у менеджера B2B: остатки он видит');
  assert.equal(r1.dealId, 'hidden');
  assert.equal(v.reserves.find(r => r.id === 'r2').dealId, 'Д-314', 'номер своей сделки скрыт');
  assert.ok(!JSON.stringify(v.reserves).includes('Д-311'), 'номер невидимой сделки остался в резервах');
  assert.ok(!JSON.stringify(v.moves).includes('Д-311'), 'номер невидимой сделки остался в журнале');
  assert.ok(v.moves.some(m => m.doc === 'hidden'), 'движение «Резерв» по Д-311 пропало из журнала');
  const view = Stock.reserveView(v, r1, pid);
  assert.equal(view.deal, null);
  assert.equal(view.hasDeal, true);
  assert.equal(Stock.docView(v, 'hidden', pid), 'сделка скрыта');
  // логист видит все резервы, но ни одного номера сделки
  const lg = Visible.of(st, personOf(st, 'logist'));
  assert.equal(lg.reserves.length, st.reserves.length);
  assert.ok(lg.reserves.every(r => r.dealId === 'hidden'));
  // водитель остатков не видит: резервов в копии нет
  assert.equal(Visible.of(st, personOf(st, 'driver')).reserves.length, 0);
});

test('Visible.of: без права «цены» — ни цены товара, ни суммы и цен строк сделки, ни цены в тексте ленты; с правом — на месте', () => {
  const { seed, Visible } = app();
  const st = seed();
  for (const role of ['chiefEngineer', 'engineer', 'warehouse', 'logist']) {
    const v = Visible.of(st, personOf(st, role));
    assert.ok(v.products.every(p => !('price' in p)), `${role}: цена товара`);
    assert.ok(v.deals.every(d => !('amount' in d) && (d.items || []).every(it => !('price' in it))), `${role}: суммы сделок`);
    assert.ok(v.feed.every(e => !/\d[\d   ]*₽/.test(e.text)), `${role}: цена в ленте`);
    assert.ok(!/"price"|"amount"/.test(JSON.stringify(v.deals) + JSON.stringify(v.products)), `${role}: цена осталась`);
  }
  const mgr = Visible.of(st, personOf(st, 'managerB2c'));
  assert.ok(mgr.products.some(p => typeof p.price === 'number'), 'у менеджера пропали цены товаров');
  assert.ok(mgr.deals.some(d => typeof d.amount === 'number' && d.amount > 0), 'у менеджера пропали суммы');
  assert.ok(mgr.feed.some(e => /₽/.test(e.text)), 'у менеджера пропали цены в ленте');
});

test('Visible.of: prefs — только свои строки notify и sound; тема и вид карты — личное, в копию не идут', () => {
  const { seed, Visible } = app();
  const st = seed();
  st.prefs.notify = { p2: { ship: false }, p3: { lead: false } };
  st.prefs.sound = { p2: { on: true, kind: 'bell' }, p3: { on: false } };
  const v = Visible.of(st, 'p2');
  assert.equal(canon(v.prefs), canon({ notify: { p2: { ship: false } }, sound: { p2: { on: true, kind: 'bell' } } }));
  assert.equal(canon(Visible.of(st, 'p5').prefs), canon({ notify: {}, sound: {} }));
});

test('Visible.client и Visible.task: правила видимости — одни на ядро и экраны; виды своих копий условий не держат', () => {
  const fs = require('node:fs'), path = require('node:path');
  const { seed, Visible, Clients } = app();
  const st = seed();
  // клиент: без права «клиенты» — никто; свой (менеджер клиента) — виден; новый без сделок и лидов — виден всем с правом
  const ivanov = st.clients.find(c => Clients.related(st, c.id).deals.some(d => d.id === 'Д-311'));
  assert.equal(Visible.client(st, ivanov, personOf(st, 'managerB2c')), true);
  assert.equal(Visible.client(st, ivanov, personOf(st, 'managerB2b')), false, 'B2B видит клиента сделки B2C');
  assert.equal(Visible.client(st, ivanov, personOf(st, 'logist')), false, 'без права «клиенты» клиент виден');
  const fresh = { id: 'К-999', kind: 'person', name: 'Новый клиент-пример', phones: [] };
  st.clients.push(fresh);
  assert.equal(Visible.client(st, fresh, personOf(st, 'managerB2b')), true);
  assert.equal(Visible.client(st, fresh, personOf(st, 'logist')), false, 'новый клиент виден без права «клиенты»');
  // задача: моя, моего отдела, поставленная мной, или право «все задачи»
  const t = { id: 't-x', to: { t: 'd', id: 'stock' }, from: 'p6' };
  assert.equal(Visible.task(st, t, 'p5'), true, 'кладовщику не видна задача его отдела');
  assert.equal(Visible.task(st, t, 'p6'), true, 'автору не видна его задача');
  assert.equal(Visible.task(st, t, 'p7'), false, 'инженеру видна задача склада');
  assert.equal(Visible.task(st, t, 'p1'), true, 'директору не видна задача');
  assert.equal(Visible.taskMine(st, t, 'p5'), true);
  assert.equal(Visible.taskMine(st, t, 'p6'), false);
  // второй копии условий в видах нет
  const src = f => fs.readFileSync(path.join(__dirname, '..', 'src', 'js', f), 'utf8');
  assert.match(src('70-clients.js'), /const clientVisible=\(c,pid=S\.me\)=>Visible\.client\(S,c,pid\)/);
  assert.match(src('20-model.js'), /const taskVisible=t=>Visible\.task\(S,t,me\(\)\.id\)/);
  assert.ok(!/Clients\.related\(S,c\.id,pid\)/.test(src('70-clients.js')), 'в 70-clients.js осталась своя копия правила клиента');
  assert.ok(!/can\('tasksAll'\)\|\|taskMine/.test(src('20-model.js')), 'в 20-model.js осталась своя копия правила задачи');
});

// Страница, поднятая на копии человека: как её соберёт браузер в серверном режиме — общее из Visible.of, личное своё
function pageFor(role) {
  const a = app(), st = a.seed(), pid = personOf(st, role);
  const copy = a.Visible.of(st, pid);
  Object.assign(copy, { v: 3, me: pid, view: 'home', rcv: null });
  copy.prefs = { ...copy.prefs, theme: 'auto', ship: {} };
  const text = a.Store.dump(copy).text;
  return { page: load({ now: NOW, storage: { [a.Store.KEY]: text } }), pid };
}

for (const role of ROLES) {
  test(`страница на копии Visible.of (${role}): каждый свой раздел рисуется, каждая видимая карточка открывается`, () => {
    const { page, pid } = pageFor(role);
    assert.equal(page.S.me, pid);
    const bad = /undefined|NaN|\[object Object\]/;
    for (const n of page.navItems()) {
      page.S.view = n.id;
      page.render();
      const html = page.byId('view').innerHTML;
      assert.ok(!html.includes('Нет доступа к разделу'), `${role}: раздел ${n.id} закрыт`);
      assert.ok(!bad.test(html), `${role}: в разделе ${n.id} — ${(html.match(bad) || [])[0]}`);
    }
    const open = (kind, list) => {
      for (const x of list) {
        const c = page.DRAWERS[kind](x.id);
        assert.ok(c && c.body, `${role}: карточка ${kind} ${x.id} не открылась`);
        assert.ok(!bad.test(c.body + c.title), `${role}: в карточке ${kind} ${x.id} — ${((c.body + c.title).match(bad) || [])[0]}`);
      }
    };
    if (page.can('clients')) open('deal', page.S.deals);
    if (page.can('clients')) open('client', page.S.clients);
    open('task', page.S.tasks);
    if (page.can('stock') || page.can('logistics')) open('ship', page.S.shipments);
    // товар с резервом невидимой сделки: «сделка скрыта», номера нет
    if (page.can('stock')) {
      const hidden = page.S.reserves.find(r => r.dealId === 'hidden');
      if (hidden) {
        const body = page.DRAWERS.product(hidden.productId).body;
        assert.ok(body.includes('сделка скрыта'), `${role}: в карточке товара нет «сделка скрыта»`);
        // служебное слово — ни в тексте, ни в номере у кнопки (атрибут hidden у полей формы — не оно)
        assert.ok(!/>[^<]*\bhidden\b[^<]*</.test(body) && !/data-[\w-]+="hidden"/.test(body), `${role}: в карточке товара служебное «hidden»`);
      }
    }
  });
}
