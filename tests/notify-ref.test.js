'use strict';
// Кликабельные уведомления: у каждого уведомления есть ссылка на объект (ref: {t, id}), нажатие в колокольчике, в списке
// уведомлений и на главном экране открывает карточку тем же действием, что и из своего раздела, и отмечает уведомление
// прочитанным. Объекта не видно или его нет — короткое сообщение, без ошибки.
// Люди демо: p1 директор, p2 менеджер B2C, p3 менеджер B2B, p5 кладовщик, p6 логист.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./load.js');

const SRC = path.join(__dirname, '..', 'src', 'js');

// ——— поиск вызовов в исходниках ———
// Разбор текста вызова: скобки, строки и шаблоны с вложенными ${…}. Нужен только чтобы разрезать аргументы по запятым.
function skipStr(s, i) {
  const q = s[i];
  i++;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') { i += 2; continue; }
    if (c === q) return i + 1;
    if (q === '`' && c === '$' && s[i + 1] === '{') { i = skipBraces(s, i + 1); continue; }
    i++;
  }
  throw new Error('строка не закрыта');
}
function skipBraces(s, i) {
  let depth = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "'" || c === '"' || c === '`') { i = skipStr(s, i); continue; }
    if (c === '{') depth++;
    if (c === '}') { depth--; if (depth === 0) return i + 1; }
    i++;
  }
  throw new Error('скобка не закрыта');
}
function argsOf(s, open) {
  let depth = 0, i = open, start = open + 1;
  const out = [];
  while (i < s.length) {
    const c = s[i];
    if (c === "'" || c === '"' || c === '`') { i = skipStr(s, i); continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) { out.push(s.slice(start, i).trim()); return out; }
    } else if (c === ',' && depth === 1) { out.push(s.slice(start, i).trim()); start = i + 1; }
    i++;
  }
  throw new Error('вызов не закрыт');
}
// Все вызовы Notify.push / Notify.pushFor в src/js (кроме самого ядра уведомлений и комментариев): [{file, line, name, args}]
function pushCalls() {
  const calls = [];
  for (const file of fs.readdirSync(SRC).filter(f => f.endsWith('.js') && f !== '37-notify.js')) {
    const text = fs.readFileSync(path.join(SRC, file), 'utf8');
    const re = /Notify\.(pushFor|push)\(/g;
    let m;
    while ((m = re.exec(text))) {
      const lineStart = text.lastIndexOf('\n', m.index) + 1;
      if (text.slice(lineStart, m.index).includes('//')) continue;          // упоминание в комментарии
      calls.push({ file, line: text.slice(0, m.index).split('\n').length, name: m[1], args: argsOf(text, m.index + m[0].length - 1) });
    }
  }
  return calls;
}

test('каждый вызов Notify.push и Notify.pushFor в коде передаёт ref седьмым аргументом', () => {
  const calls = pushCalls();
  assert.ok(calls.length >= 18, `нашли только ${calls.length} вызовов — разбор сломался`);
  for (const c of calls) {
    const where = `${c.file}:${c.line} Notify.${c.name}`;
    assert.equal(c.args.length, 7, `${where}: ${c.args.length} аргументов, а нужно 7 (ref последним)`);
    assert.match(c.args[6], /^(\{\s*t:\s*[^}]+\}|(?:[\w$]+\.)*ref)$/, `${where}: седьмой аргумент не ссылка: ${c.args[6]}`);
  }
});

// ——— ядро ———
test('Notify.push и pushFor кладут ref в уведомление; неизвестный вид или пустой номер — ошибка; без ref — null', () => {
  const { Notify } = load();
  const st = { people: [{ id: 'a', role: 'director' }, { id: 'b', role: 'warehouse' }], prefs: { notify: {} }, notes: [] };
  const now = new Date(2026, 10, 1, 12);
  const n = Notify.push(st, 'reserve', null, 'текст', now, [], { t: 'deal', id: 'Д-1', junk: 1 });
  assert.deepEqual({ ...n.ref }, { t: 'deal', id: 'Д-1' }, 'ref не скопирован чисто');
  const many = Notify.pushFor(st, 'reserve', null, id => (id === 'a' ? 'для директора' : 'для склада'), now, [], { t: 'product', id: 'sheet-1' });
  assert.equal(many.length, 2);
  assert.ok(many.every(x => x.ref && x.ref.t === 'product' && x.ref.id === 'sheet-1'), 'pushFor потерял ref');
  assert.equal(Notify.push(st, 'reserve', null, 'без ссылки', now).ref, null);
  assert.throws(() => Notify.push(st, 'reserve', null, 'x', now, [], { t: 'planet', id: '1' }), /ссылк/);
  assert.throws(() => Notify.push(st, 'reserve', null, 'x', now, [], { t: 'deal', id: '' }), /ссылк/);
  assert.deepEqual([...Notify.REF_KINDS].sort(), ['client', 'deal', 'dispatch', 'lead', 'mail', 'product', 'ship', 'task']);
});

test('демо-уведомления: у каждого есть ссылка, и она ведёт на существующую запись, которую директор может открыть', () => {
  const app = load();
  assert.ok(app.S.notes.length >= 10);
  app.setMe('p1');
  for (const n of app.S.notes) {
    assert.ok(n.ref, `у демо-уведомления «${n.text.slice(0, 40)}» нет ссылки`);
    assert.equal(app.refState(n.ref).state, 'ok', `демо-уведомление «${n.text.slice(0, 40)}» ведёт на ${n.ref.t} ${n.ref.id}: ${app.refState(n.ref).text}`);
  }
});

test('живые события кладут ссылку: задача, поставка, лид, отправка, письмо, резерв сделки, приёмка, дело', () => {
  const app = load(), { S, Notify } = app;
  const refs = [];
  const before = () => S.notes.length;
  const fresh = n0 => S.notes.slice(0, S.notes.length - n0);
  const seen = (what, n0, t) => {
    const made = fresh(n0);
    assert.ok(made.length > 0, `${what}: уведомления нет`);
    assert.ok(made.every(n => n.ref && n.ref.t === t), `${what}: ссылка не ${t}: ${JSON.stringify(made.map(n => n.ref))}`);
    refs.push(...made.map(n => n.ref));
  };
  app.setMe('p1');
  // новая задача
  let n0 = before();
  const set = (id, v) => { app.byId(id).value = v; };
  set('t-title', 'Проверить ссылку'); set('t-to', 'p:p6'); set('t-due', '2026-11-05'); set('t-prio', 'normal'); set('t-deal', ''); set('t-desc', '');
  app.FORMS.task();
  const task = S.tasks.find(t => t.title === 'Проверить ссылку');
  seen('новая задача', n0, 'task');
  assert.equal(fresh(n0)[0].ref.id, task.id);
  // смена этапа задачи
  n0 = before();
  const stage = app.Pipes.of(S, 'tasks')[0].stages.find(s => s.id !== task.stageId && !s.flag);
  app.setTaskStatus(task.id, stage.id);
  seen('этап задачи', n0, 'task');
  // поставка: срок и этап
  n0 = before();
  const sh = S.shipments.find(s => s.id === 'П-1041');
  const next = app.Pipes.of(S, 'ships').find(p => p.id === sh.pipeId).stages.find(s => s.id !== sh.stageId && !s.flag);
  app.Ships.setStage(S, sh.id, next.id, 'p6', new Date());
  seen('этап поставки', n0, 'ship');
  // новый лид, лид ждёт
  n0 = before();
  const lead = app.Leads.create(S, { source: 'site', name: 'Клиент-пример', phone: '+7 900 000-01-01' }, new Date(Date.now() - 60 * 6e4));
  seen('новый лид', n0, 'lead');
  assert.equal(fresh(n0)[0].ref.id, lead.id);
  n0 = before();
  app.Leads.notifyWaiting(S, new Date());
  const waits = fresh(n0).filter(n => n.kind === 'leadWait');
  assert.ok(waits.length > 0 && waits.every(n => n.ref.t === 'lead'), '«лид ждёт» без ссылки на лид');
  // отправка
  n0 = before();
  const made = app.Dispatch.create(S, { purpose: 'sale', to: { name: 'Клиент-пример', phone: '+7 900 000-01-02' }, address: 'Иркутск', when: { date: new Date(2026, 10, 5, 10) }, items: [], dealId: '' }, 'p1', new Date());
  if (made.ok) seen('новая заявка на отправку', n0, 'dispatch');
  // письмо
  n0 = before();
  const box = S.mail.boxes[0];
  const letter = app.Mail.deliver(S, { boxId: box.id, from: 'a@example.com', fromName: 'Пример', subject: 'Тема', body: 'Текст' }, new Date());
  seen('письмо', n0, 'mail');
  assert.equal(fresh(n0)[0].ref.id, letter.id);
  // резерв по сделке
  n0 = before();
  const d = S.deals.find(x => !x.lostReason && x.type === 'b2c' && S.reserves.some(r => r.dealId === x.id));
  const r0 = S.reserves.find(r => r.dealId === d.id);
  app.Deals.unreserve(S, d.id, r0.id, 'p1', new Date());
  seen('снятие резерва', n0, 'deal');
  assert.equal(fresh(n0)[0].ref.id, d.id);
  // дело: напоминание ссылается на карточку дела
  n0 = before();
  app.Acts.plan(S, { t: 'deal', id: d.id }, { type: 'call', title: 'Позвонить', due: new Date(Date.now() - 6e4), remind: 0, ownerId: 'p1' }, 'p1', new Date());
  app.Acts.notify(S, new Date());
  seen('дело', n0, 'deal');
  // новый товар
  n0 = before();
  set('np-name', 'Товар для ссылки'); set('np-cat', S.products[0].cat); set('np-unit', 'шт'); app.byId('np-price').value = '';
  app.FORMS.product();
  const prod = S.products.find(p => p.name === 'Товар для ссылки');
  seen('новый товар', n0, 'product');
  assert.equal(fresh(n0)[0].ref.id, prod.id);
  assert.ok(refs.length >= 9);
  assert.ok(refs.every(x => Notify.REF_KINDS.includes(x.t)));
});

// ——— нажатие ———
// Настоящий щелчок: слушатель страницы на document получает событие с целью, у которой closest('[data-act]') — строка
// уведомления, найденная в HTML экрана (а не вызов A['note-open'] напрямую).
const rowsOf = html => [...html.matchAll(/<li class="note[^"]*" data-act="note-open" data-id="(n\d+)"/g)].map(m => m[1]);
const clickNote = (app, id) => {
  const row = { tagName: 'LI', dataset: { act: 'note-open', id }, classList: { contains: () => false }, closest: () => null };
  const target = { tagName: 'SPAN', classList: { contains: () => false }, closest: sel => (sel === '[data-act]' ? row : null) };
  app.document.dispatchEvent({ type: 'click', target });
};
const toasts = app => { const list = []; app.document.getElementById('toasts').appendChild = el => list.push(el.innerHTML || ''); return list; };
const drawerText = app => app.document.getElementById('drawer-root').innerHTML;

test('нажатие на уведомление о задаче: открывается карточка задачи, уведомление прочитано — из колокольчика, из списка и с главного экрана', () => {
  for (const place of ['bell', 'list', 'home']) {
    const app = load(), { S } = app;
    app.setMe('p1');
    const set = (id, v) => { app.byId(id).value = v; };
    set('t-title', 'Подготовить акт'); set('t-to', 'p:p6'); set('t-due', '2026-11-05'); set('t-prio', 'normal'); set('t-deal', ''); set('t-desc', '');
    app.FORMS.task();
    const task = S.tasks.find(t => t.title === 'Подготовить акт');
    app.setMe('p6');
    const note = S.notes.find(n => n.kind === 'task' && n.ref && n.ref.id === task.id && n.to.includes('p6'));
    assert.ok(note && !note.read.includes('p6'), 'у логиста нет непрочитанного уведомления о задаче');
    const unread0 = app.unread().length;
    // строка с уведомлением на экране: в колокольчике, в списке уведомлений, на главном
    let html;
    if (place === 'bell') { app.document.getElementById('pop').hidden = true; app.A.bell(); html = app.document.getElementById('pop').innerHTML; }
    else if (place === 'list') html = app.vNotes();
    else html = app.VIEWS.home();
    if (place === 'bell') { note.read = note.read.filter(x => x !== 'p6'); }   // колокольчик при открытии сам читает; проверяем нажатие отдельно
    assert.ok(rowsOf(html).includes(note.id), `${place}: строка уведомления не нажимается`);
    assert.ok(unread0 >= 1);
    S.ui.drawer = null;
    clickNote(app, note.id);
    assert.deepEqual({ ...S.ui.drawer }, { type: 'task', id: task.id }, `${place}: карточка задачи не открылась`);
    assert.ok(drawerText(app).includes('Подготовить акт'), `${place}: в карточке нет задачи`);
    assert.ok(note.read.includes('p6'), `${place}: уведомление осталось непрочитанным`);
  }
});

test('нажатие открывает карточку тем же действием, что из раздела: у директора все виды ссылок; сделка, лид, клиент, поставка, отправка, товар, письмо', () => {
  const app = load(), { S } = app;
  app.setMe('p1');
  const push = ref => app.Notify.push(S, 'reserve', null, 'проверка', new Date(), ['p1'], ref);
  const dispatch = S.dispatches[0];
  const letter = S.mail.letters[0];
  const cases = [
    [{ t: 'deal', id: 'Д-311' }, { type: 'deal', id: 'Д-311' }],
    [{ t: 'lead', id: S.leads[0].id }, { type: 'lead', id: S.leads[0].id }],
    [{ t: 'client', id: S.clients[0].id }, { type: 'client', id: S.clients[0].id }],
    [{ t: 'ship', id: 'П-1041' }, { type: 'ship', id: 'П-1041' }],
    [{ t: 'dispatch', id: dispatch.id }, { type: 'dispatch', id: dispatch.id }],
    [{ t: 'product', id: S.products[0].id }, { type: 'product', id: S.products[0].id }],
    [{ t: 'task', id: 't1' }, { type: 'task', id: 't1' }],
  ];
  for (const [ref, want] of cases) {
    const n = push(ref);
    S.ui.drawer = null;
    clickNote(app, n.id);
    assert.deepEqual({ ...S.ui.drawer }, want, `ссылка ${ref.t} не открыла карточку`);
    assert.ok(n.read.includes('p1'), `${ref.t}: не прочитано`);
  }
  // письмо: открывается раздел «Почта», письмо выбрано и прочитано
  letter.read = false;
  const n = push({ t: 'mail', id: letter.id });
  clickNote(app, n.id);
  assert.equal(S.view, 'mail');
  assert.equal(S.ui.mail.letter, letter.id);
  assert.equal(S.ui.mail.box, letter.boxId);
  assert.equal(letter.read, true);
});

test('нажатие на уведомление у менеджера B2C: свои сделки и лиды открываются, у кладовщика — «нет доступа»', () => {
  const app = load(), { S, Leads } = app;
  const push = (ref, to) => app.Notify.push(S, 'reserve', null, 'проверка', new Date(), [to], ref);
  app.setMe('p2');
  const mine = Leads.dealsVisible(S, 'p2')[0], myLead = Leads.visible(S, 'p2')[0];
  for (const [ref, want] of [[{ t: 'deal', id: mine.id }, 'deal'], [{ t: 'lead', id: myLead.id }, 'lead']]) {
    const n = push(ref, 'p2');
    S.ui.drawer = null;
    clickNote(app, n.id);
    assert.equal(S.ui.drawer && S.ui.drawer.type, want, `менеджер B2C: ${want} своего типа не открылся`);
  }
  app.setMe('p5');
  const said = toasts(app);
  for (const ref of [{ t: 'deal', id: mine.id }, { t: 'lead', id: myLead.id }, { t: 'client', id: S.clients[0].id }]) {
    const n = push(ref, 'p5');
    S.ui.drawer = null;
    clickNote(app, n.id);
    assert.equal(S.ui.drawer, null, `кладовщик открыл ${ref.t}`);
    assert.ok(n.read.includes('p5'), 'без доступа уведомление осталось непрочитанным');
  }
  assert.equal(said.filter(t => t.includes('Нет доступа')).length, 3, said.join(' | '));
  assert.ok(said.every(t => !t.includes(mine.id) && !t.includes(mine.client)), 'сообщение называет сделку, которую человек не видит');
});

test('уведомление о чужой сделке не открывает её: менеджер B2B и сделка B2C — «нет доступа», карточка закрыта, уведомление прочитано', () => {
  const app = load(), { S, Leads } = app;
  const b2c = S.deals.find(d => d.type === 'b2c');
  assert.ok(b2c && !Leads.dealsVisible(S, 'p3').some(d => d.id === b2c.id), 'сделка B2C видна менеджеру B2B — проверка пустая');
  const n = app.Notify.push(S, 'reserve', null, 'Резерв по чужой сделке', new Date(), ['p3'], { t: 'deal', id: b2c.id });
  app.setMe('p3');
  const said = toasts(app);
  S.ui.drawer = null;
  assert.ok(!n.read.includes('p3'));
  clickNote(app, n.id);
  assert.equal(S.ui.drawer, null, 'чужая сделка открылась');
  assert.equal(drawerText(app), '', 'карточка нарисована');
  assert.ok(said.some(t => t.includes('Нет доступа')), said.join(' | '));
  assert.ok(n.read.includes('p3'), 'уведомление осталось непрочитанным');
  // директору та же сделка открывается
  app.setMe('p1');
  const m = app.Notify.push(S, 'reserve', null, 'Резерв по сделке', new Date(), ['p1'], { t: 'deal', id: b2c.id });
  clickNote(app, m.id);
  assert.deepEqual({ ...S.ui.drawer }, { type: 'deal', id: b2c.id });
});

test('удалённая запись: «запись удалена» без ошибки, уведомление прочитано; уведомление без ссылки не нажимается', () => {
  const app = load(), { S } = app;
  app.setMe('p1');
  const said = toasts(app);
  const gone = app.Notify.push(S, 'reserve', null, 'Удалённая', new Date(), ['p1'], { t: 'deal', id: 'Д-нет-такой' });
  S.ui.drawer = null;
  assert.doesNotThrow(() => clickNote(app, gone.id));
  assert.equal(S.ui.drawer, null);
  assert.ok(said.some(t => t.includes('Запись удалена')), said.join(' | '));
  assert.ok(gone.read.includes('p1'));
  // удалили сам объект уже после уведомления
  const task = S.tasks[0];
  const n = app.Notify.push(S, 'task', null, 'Про задачу', new Date(), ['p1'], { t: 'task', id: task.id });
  S.tasks.splice(S.tasks.indexOf(task), 1);
  clickNote(app, n.id);
  assert.ok(said.filter(t => t.includes('Запись удалена')).length === 2);
  // без ссылки (старое сохранение, внешнее уведомление): строка не нажимается, ошибки нет
  const plain = app.Notify.push(S, 'reserve', null, 'Без ссылки', new Date(), ['p1']);
  assert.ok(!rowsOf(app.vNotes()).includes(plain.id), 'строка без ссылки нажимается');
  assert.doesNotThrow(() => app.A['note-open']({ dataset: { id: plain.id } }));
  assert.equal(S.ui.drawer, null);
});
