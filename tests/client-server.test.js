'use strict';
// Браузер в серверном режиме (таск 03; R01, R02, R03, R04, R06, R07, R15, R17i, R20i, R22i): страница грузится
// load({ globals: { CRM_SERVER: 1, fetch, EventSource } }) и работает против настоящего сервера createApp (tests/server-kit.js).
// fetch «браузера» держит свой cookie и шлёт относительные адреса на сервер; EventSource — на том же fetch.
// Ожидаемое — из критериев таска, interfaces.md и spec.md (тексты), а не из кода страницы.

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.js');
const kit = require('./server-kit.js');

const OFF_TEXT = 'Нет связи с сервером — изменения сохранятся, когда связь вернётся';

// ——— «браузер» ———
function browser(srv) {
  const jar = { cookie: '' }, calls = [], net = { down: false };
  async function bfetch(url, opt = {}) {
    if (net.down) throw new TypeError('fetch failed');
    calls.push({ method: opt.method || 'GET', url, body: typeof opt.body === 'string' ? opt.body : null });
    const headers = { ...(opt.headers || {}) };
    if (jar.cookie) headers.cookie = jar.cookie;
    const res = await fetch(srv.url + url, { ...opt, headers });
    const set = res.headers.get('set-cookie');
    if (set) jar.cookie = /Max-Age=0/i.test(set) ? '' : set.split(';')[0];
    return res;
  }
  const streams = [];
  class FakeEventSource {
    constructor(url) {
      this.readyState = 0; this.ls = {}; this.ctrl = new AbortController(); this.onerror = null;
      streams.push(this); this.run(url);
    }
    addEventListener(t, f) { (this.ls[t] ||= []).push(f); }
    close() { this.readyState = 2; this.ctrl.abort(); }
    async run(url) {
      try {
        const res = await fetch(srv.url + url, { headers: jar.cookie ? { cookie: jar.cookie } : {}, signal: this.ctrl.signal });
        if (res.status === 200) {
          this.readyState = 1;
          let buf = '';
          for await (const chunk of res.body) {
            buf += Buffer.from(chunk).toString('utf8');
            let i;
            while ((i = buf.indexOf('\n\n')) >= 0) {
              const block = buf.slice(0, i); buf = buf.slice(i + 2);
              const ev = /^event: (.+)$/m.exec(block), data = /^data: (.*)$/m.exec(block);
              if (ev) (this.ls[ev[1]] || []).forEach(f => f({ data: data ? data[1] : '' }));
            }
          }
        }
      } catch { /* закрыт */ }
      if (this.readyState !== 2) { this.readyState = 2; if (this.onerror) this.onerror({}); }
    }
  }
  return { jar, calls, net, fetch: bfetch, EventSource: FakeEventSource, closeAll: () => streams.forEach(s => s.close()) };
}

// Страница в серверном режиме; toasts() — тексты тостов, window — слушатели окна (beforeunload)
function page(srv, globals = {}) {
  const b = browser(srv);
  const winL = {}, made = [], reloads = [];
  const window = { addEventListener: (t, f) => { (winL[t] ||= []).push(f); }, focus() {} };
  const app = load({ globals: { CRM_SERVER: 1, fetch: b.fetch, EventSource: b.EventSource, window, location: { hash: '', reload: () => reloads.push(1) }, atob, Blob, ...globals } });
  const orig = app.document.createElement;
  app.document.createElement = tag => { const e = orig(tag); made.push(e); return e; };
  const text = h => String(h || '').replace(/<[^>]+>/g, '');
  return {
    app, b, winL, reloads,
    toasts: () => made.filter(e => e.className === 'toast').map(e => text(e.innerHTML)),
    html: id => app.byId(id).innerHTML,
  };
}
async function open(srv, login, password) {
  const p = page(srv);
  assert.equal(await p.app.serverBoot(), 'gate');
  assert.equal(await p.app.serverLogin(login, password), 'ready');
  return p;
}
async function until(fn, ms = 5000, what = 'условие') {
  const t = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t > ms) throw new Error(what + ' не выполнилось за ' + ms + ' мс');
    await new Promise(r => setTimeout(r, 20));
  }
}
const live = (app, v) => JSON.parse(JSON.stringify(v), app.Store.revive);
const dealOf = (app, id) => app.S.deals.find(d => d.id === id);
// Новая сделка в S страницы (форма сделки как у server-kit.deal) с номером из запаса сервера
function addDeal(app, opts) {
  const id = app.Ids.next('Д-', () => null);
  app.S.deals.push(live(app, kit.deal(id, opts)));
  app.save();
  return id;
}
async function withServer(fn) {
  const srv = await kit.start();
  const pages = [];
  try { await fn(srv, pages); } finally { pages.forEach(p => p.b.closeAll()); await srv.stop(); }
}
// Фирма: директор p1 и менеджер B2C p2 (Анна)
async function firm(srv) {
  const boss = await kit.director(srv);
  const anna = await kit.employee(srv, boss, { id: 'p2', name: 'Анна (тест)', role: 'managerB2c', dept: 'sales' });
  return { boss, anna };
}

test('вход на узком экране: галочка «Чужой компьютер» — flex с подписью одним блоком, пояснение под подписью и переносится', () => {
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'css', '72-server.css'), 'utf8');
  const rule = sel => (css.match(new RegExp(sel.replace(/[.]/g, '\.') + '\{([^}]*)\}')) || [])[1] || '';
  assert.match(rule('.srv-box .check'), /display:flex/);
  assert.match(rule('.srv-box .check input'), /flex:none/);
  assert.match(rule('.srv-box .check-t'), /min-width:0/);
  assert.match(rule('.srv-box .check small'), /display:block/);
});

test('вход: без сеанса — окно входа; неверный пароль — «Неверный логин или пароль»; после входа — данные фирмы без демо, «Кто я», почты и пульта', () => withServer(async (srv, pages) => {
  const { boss } = await firm(srv);
  const p = page(srv); pages.push(p);
  assert.equal(await p.app.serverBoot(), 'gate');
  assert.equal(p.app.S, null, 'до входа данных нет');
  const gate = p.html('srv-root');
  for (const w of ['Вход в CRM', 'Логин', 'Пароль', 'Чужой компьютер', 'data-form="srv-login"']) assert.ok(gate.includes(w), 'в окне входа нет: ' + w);
  // «Чужой компьютер»: подпись и пояснение — один блок рядом с галочкой (иначе на узком экране две колонки и подпись уезжает)
  assert.match(gate, /<input type="checkbox" id="srv-foreign"><span class="check-t">Чужой компьютер<small[^>]*>[^<]+<\/small><\/span><\/label>/);

  assert.equal(await p.app.serverLogin('boss', 'не тот пароль'), 'error');
  assert.equal(p.app.byId('srv-err').textContent, 'Неверный логин или пароль');
  assert.equal(p.app.S, null);

  assert.equal(await p.app.serverLogin('boss', boss.password), 'ready');
  const S = p.app.S;
  assert.equal(S.me, boss.pid, 'S.me — из сеанса');
  assert.deepEqual([...S.people.map(x => x.id)].sort(), ['p1', 'p2']);
  assert.ok(!JSON.stringify(p.app.Store.plain(S)).includes('"demo":true'), 'демо-записей нет');
  assert.equal(p.html('srv-root'), '', 'окно входа закрыто');
  assert.equal(p.app.document.documentElement.dataset.mode, 'server', 'метка для CSS: «Кто я», «Прототип» и «Сбросить» спрятаны');
  const nav = p.app.navItems().map(n => n.id);
  for (const id of ['mail', 'messages', 'sims']) assert.ok(!nav.includes(id), 'в меню есть ' + id);
  for (const id of ['home', 'deals', 'team', 'settings']) assert.ok(nav.includes(id), 'в меню нет ' + id);
  const tabs = p.app.settingsTabs().map(t => t.id);
  assert.ok(!tabs.includes('mail') && !tabs.includes('data'), 'вкладки «Почта» и «Данные» спрятаны: ' + tabs);
  const side = p.html('side');
  assert.ok(side.includes('data-act="srv-logout"') && side.includes('Выйти'), '«Выйти» в меню');
  assert.ok(side.includes('data-act="srv-password"') && side.includes('Сменить пароль'), '«Сменить пароль» рядом с именем');
  // имитаций Битрикса и перечня «что живёт в Битриксе» нет; «Войти как» в сотрудниках нет
  const leadSet = p.app.vLeadSettings();
  assert.ok(!leadSet.includes('Имитация') && !leadSet.includes('Что ещё живёт в Битриксе24'), 'имитации Битрикса в настройках');
  assert.ok(!p.app.vLeads().includes('Имитация'), 'имитации в «Лидах»');
  assert.ok(!p.app.vTeam().includes('view-as'), '«Войти как» в сотрудниках');
}));

test('первый вход с выданным паролем: сначала смена пароля (не короче 8), потом CRM', () => withServer(async (srv, pages) => {
  const boss = await kit.director(srv);
  await kit.changes(srv, boss.cookie, [{ key: 'people', id: 'p2', base: null, data: { id: 'p2', name: 'Анна (тест)', role: 'managerB2c', dept: 'sales' } }]);
  await kit.call(srv, 'POST', '/api/users/p2/login', { cookie: boss.cookie, body: { login: 'anna' } });
  const issued = (await kit.call(srv, 'POST', '/api/users/p2/password', { cookie: boss.cookie, body: {} })).body.password;
  const p = page(srv); pages.push(p);
  await p.app.serverBoot();
  assert.equal(await p.app.serverLogin('anna', issued), 'password');
  assert.equal(p.app.S, null, 'до смены пароля CRM не открывается');
  assert.ok(p.html('srv-root').includes('Придумайте свой пароль'));
  assert.equal(await p.app.serverPassword(issued, 'коротко', 'коротко', true), 'error');
  assert.match(p.app.byId('srv-err').textContent, /не короче 8 символов/);
  const mine = kit.secret();
  assert.equal(await p.app.serverPassword(issued, mine, mine, true), 'ready');
  assert.equal(p.app.S.me, 'p2');
  assert.equal((await kit.login(srv, 'anna', mine)).status, 200, 'новый пароль работает');
}));

test('связка: сделка, созданная в одной вкладке, появляется в другой сама; одновременные сделки — разные номера из запаса', () => withServer(async (srv, pages) => {
  const { boss, anna } = await firm(srv);
  const A = await open(srv, 'boss', boss.password), B = await open(srv, anna.login, anna.password);
  pages.push(A, B);
  for (const pfx of ['Д-', 'Л-', 'К-', 'П-', 'ОТ-']) assert.equal(A.app.srv.pools[pfx].length, 5, 'запас номеров ' + pfx);
  const a = addDeal(A.app, { managerId: 'p2', client: 'Клиент А' });
  const b = addDeal(B.app, { managerId: 'p2', client: 'Клиент Б' });
  assert.match(a, /^Д-\d+$/); assert.match(b, /^Д-\d+$/);
  assert.notEqual(a, b, 'номера разные');
  await Promise.all([A.app.serverIdle(), B.app.serverIdle()]);
  await until(() => dealOf(B.app, a), 5000, 'сделка А у второй вкладки');
  await until(() => dealOf(A.app, b), 5000, 'сделка Б у первой вкладки');
  assert.equal(dealOf(B.app, a).client, 'Клиент А');
  const st = await kit.state(srv, boss.cookie);
  assert.deepEqual(st.deals.map(d => d.id).sort(), [a, b].sort(), 'обе сделки на сервере');
  // прочие id — с меткой сеанса и вкладки, без обращения к серверу
  const t = A.app.Store.freeId(A.app.S.tasks, 't');
  assert.ok(t.startsWith('t' + A.app.srv.tag), t);
  assert.notEqual(A.app.Store.freeId(A.app.S.tasks, 't'), t);
}));

test('save(): на сервер — только изменённые общие документы; раздел, тема, вид поставок и черновик приёмки — в localStorage', () => withServer(async (srv, pages) => {
  const { boss } = await firm(srv);
  const A = await open(srv, 'boss', boss.password); pages.push(A);
  const id = addDeal(A.app, { managerId: 'p2' });
  await A.app.serverIdle();
  const posts = () => A.b.calls.filter(c => c.url === '/api/changes');
  const n0 = posts().length;
  A.app.S.view = 'stock'; A.app.S.prefs.theme = 'dark'; A.app.S.prefs.ship = { cols: 'x' };
  A.app.S.rcv = { shipId: 'П-1', qty: {}, dmg: {}, note: 'черновик', photos: [], done: null };
  A.app.save();
  await A.app.serverIdle();
  assert.equal(posts().length, n0, 'личное на сервер не ушло');
  const local = JSON.parse(A.app.storage['ws-crm-srv:p1']);
  assert.equal(local.view, 'stock'); assert.equal(local.theme, 'dark'); assert.deepEqual(local.ship, { cols: 'x' }); assert.equal(local.rcv.note, 'черновик');

  dealOf(A.app, id).object = 'СЭС 30 кВт (тест)';
  A.app.save();
  await A.app.serverIdle();
  assert.equal(posts().length, n0 + 1);
  const sent = JSON.parse(posts().at(-1).body);
  assert.deepEqual(sent.changes.map(c => [c.key, c.id]), [['deals', id]], 'одна изменённая сделка');
  assert.equal(sent.changes[0].base.object, 'СЭС (тест)', 'base — подтверждённая копия');
  assert.equal(sent.view, A.app.srv.view);
  assert.equal((await kit.state(srv, boss.cookie)).deals[0].object, 'СЭС 30 кВт (тест)');
}));

test('409: то же поле правил коллега — тост «Пока ты правил, «…» изменил(а) <имя>…» и свежая версия; разные поля — обе правки', () => withServer(async (srv, pages) => {
  const { boss, anna } = await firm(srv);
  const A = await open(srv, 'boss', boss.password), B = await open(srv, anna.login, anna.password);
  pages.push(A, B);
  const id = addDeal(A.app, { managerId: 'p2', client: 'Клиент В' });
  await A.app.serverIdle();
  await until(() => dealOf(B.app, id));
  // вторая вкладка не слышит событий: правки коллеги не успели прийти
  B.app.srv.es.close(); B.app.srv.es = null;
  dealOf(A.app, id).object = 'Вариант директора'; A.app.save();
  await A.app.serverIdle();
  dealOf(B.app, id).object = 'Вариант Анны'; B.app.save();
  await B.app.serverIdle();
  assert.ok(B.toasts().includes(`Пока ты правил, «${id} · Клиент В» изменил(а) Директор (тест) — показана свежая версия, повтори`), B.toasts().join(' | '));
  assert.equal(dealOf(B.app, id).object, 'Вариант директора', 'показана свежая версия');
  assert.equal((await kit.state(srv, boss.cookie)).deals[0].object, 'Вариант директора');
  assert.equal(B.app.srvPending(), false, 'своя проигравшая правка не висит неотправленной');

  // разные поля одной записи — обе правки сохраняются
  dealOf(A.app, id).phone = '+7 900 000-00-01'; A.app.save();
  await A.app.serverIdle();
  dealOf(B.app, id).object = 'Вариант Анны'; B.app.save();
  await B.app.serverIdle();
  const d = (await kit.state(srv, boss.cookie)).deals[0];
  assert.equal(d.phone, '+7 900 000-00-01');
  assert.equal(d.object, 'Вариант Анны');
}));

test('пришло с сервера, а здесь своя неотправленная правка того же поля — не затирается молча: тост с именем и свежая версия', () => withServer(async (srv, pages) => {
  const { boss, anna } = await firm(srv);
  const A = await open(srv, 'boss', boss.password), B = await open(srv, anna.login, anna.password);
  pages.push(A, B);
  const id = addDeal(A.app, { managerId: 'p2', client: 'Клиент Г' });
  await A.app.serverIdle();
  await until(() => dealOf(B.app, id));
  // своя правка ещё не сохранена (ввод в поле до отложенного сохранения), а с сервера приходит правка того же поля
  dealOf(B.app, id).object = 'Правка Анны';
  dealOf(A.app, id).object = 'Правка директора'; A.app.save();
  await A.app.serverIdle();
  await until(() => B.toasts().some(t => t.startsWith('Пока ты правил')), 5000, 'тост конфликта');
  await B.app.serverIdle();
  assert.equal(dealOf(B.app, id).object, 'Правка директора');
  assert.ok(B.toasts().some(t => t.includes('изменил(а) Директор (тест)')), B.toasts().join(' | '));
}));

test('403: правка без права — откат к подтверждённой копии и тост с текстом сервера; удалённая другим запись — «уже удалена или недоступна»', () => withServer(async (srv, pages) => {
  const { boss, anna } = await firm(srv);
  const B = await open(srv, anna.login, anna.password); pages.push(B);
  const role = B.app.S.roles.find(r => r.id === 'managerB2c');
  const was = role.perms.admin;
  role.perms.admin = true; B.app.save();
  await B.app.serverIdle();
  assert.equal(B.app.S.roles.find(r => r.id === 'managerB2c').perms.admin, was, 'откат');
  assert.ok(B.toasts().some(t => t.startsWith('Нет прав')), B.toasts().join(' | '));
  assert.equal(B.app.srvPending(), false);

  // задачу удаляют в двух вкладках директора: вторая узнаёт, что записи уже нет
  const A1 = await open(srv, 'boss', boss.password), A2 = await open(srv, 'boss', boss.password);
  pages.push(A1, A2);
  const t = A1.app.Store.freeId(A1.app.S.tasks, 't'), board = A1.app.curBoard();
  A1.app.S.tasks.push({ id: t, title: 'Проверить (тест)', desc: '', to: { t: 'p', id: 'p1' }, from: 'p1', due: new Date(), boardId: board.id, stageId: A1.app.startStage(board.id).id, prio: 'normal', deal: '', at: new Date() });
  A1.app.save(); await A1.app.serverIdle();
  await until(() => A2.app.S.tasks.some(x => x.id === t));
  A2.app.srv.es.close(); A2.app.srv.es = null;
  A1.app.S.tasks.splice(A1.app.S.tasks.findIndex(x => x.id === t), 1); A1.app.save(); await A1.app.serverIdle();
  A2.app.S.tasks.splice(A2.app.S.tasks.findIndex(x => x.id === t), 1); A2.app.save(); await A2.app.serverIdle();
  assert.ok(A2.toasts().includes('Запись уже удалена или недоступна'), A2.toasts().join(' | '));
  assert.ok(!A2.toasts().some(t => t.startsWith('Нет прав')));
}));

test('нет связи: плашка, повтор сам, ничего не теряется; закрытие вкладки с неотправленным — предупреждение браузера', () => withServer(async (srv, pages) => {
  const { boss } = await firm(srv);
  const A = await open(srv, 'boss', boss.password); pages.push(A);
  const id = addDeal(A.app, { managerId: 'p2' });
  await A.app.serverIdle();
  A.b.net.down = true;
  dealOf(A.app, id).object = 'Правка без связи'; A.app.save();
  await A.app.serverIdle();
  const bar = A.app.byId('srv-off');
  assert.equal(bar.hidden, false);
  assert.ok(bar.innerHTML.includes(OFF_TEXT), bar.innerHTML);
  assert.equal(A.app.srvPending(), true);
  const ev = { returnValue: undefined, prevented: false, preventDefault() { this.prevented = true; } };
  A.winL.beforeunload.forEach(f => f(ev));
  assert.ok(ev.prevented, 'браузер предупредит о закрытии');
  A.b.net.down = false;                           // повтор — сам, через 2 с
  await until(async () => (await kit.state(srv, boss.cookie)).deals[0].object === 'Правка без связи', 6000, 'правка дошла после обрыва');
  await until(() => bar.hidden === true, 2000, 'плашка ушла');
  const ev2 = { prevented: false, preventDefault() { this.prevented = true; } };
  A.winL.beforeunload.forEach(f => f(ev2));
  assert.equal(ev2.prevented, false, 'всё отправлено — без предупреждения');
}));

test('сеанс закрыт посреди работы: окно входа поверх CRM; тот же человек — неотправленное уходит; другой — перезагрузка', () => withServer(async (srv, pages) => {
  const { boss, anna } = await firm(srv);
  const A = await open(srv, 'boss', boss.password), C = await open(srv, 'boss', boss.password);
  pages.push(A, C);
  const id = addDeal(A.app, { managerId: 'p2' });
  await A.app.serverIdle();
  await kit.call(srv, 'POST', '/api/users/p1/logout', { cookie: boss.cookie, body: {} });
  for (const p of [A, C]) {
    dealOf(p.app, id) && (dealOf(p.app, id).object = 'Правка после выхода');
    p.app.save(); await p.app.serverIdle();
    await until(() => p.html('srv-root').includes('Вход в CRM'), 3000, 'окно входа');
    assert.ok(p.html('srv-root').includes('srv-gate over'), 'поверх CRM');
    assert.ok(p.app.S, 'CRM под окном осталась');
  }
  assert.equal(A.app.srvPending(), true);
  assert.equal(await A.app.serverLogin('boss', boss.password), 'resumed');
  await A.app.serverIdle();
  const fresh = await kit.login(srv, 'boss', boss.password);
  assert.equal((await kit.state(srv, fresh.cookie)).deals[0].object, 'Правка после выхода', 'неотправленное ушло');
  assert.equal(await C.app.serverLogin(anna.login, anna.password), 'reload');
  assert.equal(C.reloads.length, 1);
}));

test('системное уведомление: вкладка свёрнута — Notification с текстом, щелчок открывает запись; без разрешения — кнопка в «Настройки → Уведомления»', () => withServer(async (srv, pages) => {
  const { boss, anna } = await firm(srv);
  const shown = [];
  class FakeNotification {
    constructor(title, opt) { this.title = title; this.opt = opt; shown.push(this); }
    close() {}
  }
  FakeNotification.permission = 'granted';
  const A = await open(srv, 'boss', boss.password);
  const B = page(srv, { Notification: FakeNotification }); pages.push(A, B);
  await B.app.serverBoot(); await B.app.serverLogin(anna.login, anna.password);
  B.app.document.hidden = true;
  const v = id => { A.app.byId(id).value = ''; return A.app.byId(id); };
  v('t-title').value = 'Позвонить клиенту (тест)'; v('t-to').value = 'p:p2'; v('t-due'); v('t-desc'); v('t-prio').value = 'normal'; v('t-deal');
  A.app.FORMS.task();
  await A.app.serverIdle();
  const note = await until(() => shown[0], 5000, 'системное окно');
  assert.equal(note.title, 'CRM wind-solar');
  assert.match(note.opt.body, /Новая задача: «Позвонить клиенту \(тест\)»/);
  const n = B.app.S.notes.find(x => x.id === note.opt.tag);
  assert.ok(!n.read.includes('p2'));
  note.onclick();
  assert.ok(B.app.S.notes.find(x => x.id === n.id).read.includes('p2'), 'прочитано');
  assert.deepEqual({ ...B.app.S.ui.drawer }, { type: 'task', id: n.ref.id }, 'открыта задача');

  FakeNotification.permission = 'default';
  assert.ok(B.app.vNotifySettings().includes('Разрешить всплывающие уведомления'));
  FakeNotification.permission = 'granted';
  assert.ok(!B.app.vNotifySettings().includes('data-act="srv-notify-perm"'));
  // вкладка открыта — системного окна нет (звук и колокол — как раньше)
  B.app.document.hidden = false;
  const before = shown.length;
  v('t-title').value = 'Вторая (тест)'; A.app.FORMS.task(); await A.app.serverIdle();
  await until(() => B.app.S.tasks.some(t => t.title === 'Вторая (тест)'));
  assert.equal(shown.length, before);
}));

test('файлы: загрузка в /api/files, в записи {id, name, type, size, url, by, at} и data: null, скачивание по url; больше 20 МБ — отказ до загрузки; фото приёмки — адреса', () => withServer(async (srv, pages) => {
  const { boss } = await firm(srv);
  const A = await open(srv, 'boss', boss.password); pages.push(A);
  const uploads = () => A.b.calls.filter(c => c.url === '/api/files').length;
  A.app.attReadFiles([{ name: 'большой.pdf', type: 'application/pdf', size: 21 * 1048576 }], () => assert.fail('не должен загрузиться'));
  assert.equal(uploads(), 0, 'большой файл не отправлен');
  assert.ok(A.toasts().some(t => t.startsWith('Файл больше 20 МБ — не загружен')), A.toasts().join(' | '));

  const got = [];
  A.app.attReadFiles([new File(['привет, склад'], 'акт.txt', { type: 'text/plain' })], f => got.push(f));
  await until(() => got.length);
  assert.match(got[0].url, /^\/api\/files\/fl[0-9a-f]{24}$/);
  assert.equal(got[0].data, null);
  // к задаче — как из карточки (Attach.add)
  const board = A.app.curBoard(), t = A.app.Store.freeId(A.app.S.tasks, 't');
  A.app.S.tasks.push({ id: t, title: 'С файлом (тест)', desc: '', to: { t: 'p', id: 'p1' }, from: 'p1', due: new Date(), boardId: board.id, stageId: A.app.startStage(board.id).id, prio: 'normal', deal: '', at: new Date() });
  const rec = A.app.S.tasks.find(x => x.id === t);
  assert.equal(A.app.Attach.add(rec, got, 'p1', new Date()).ok, true);
  A.app.save(); await A.app.serverIdle();
  const f = (await kit.state(srv, boss.cookie)).tasks[0].files[0];
  assert.deepEqual(Object.keys(f).sort(), ['at', 'by', 'data', 'id', 'name', 'size', 'type', 'url']);
  assert.equal(f.data, null); assert.equal(f.name, 'акт.txt'); assert.equal(f.by, 'p1'); assert.equal(f.url, got[0].url);
  assert.ok(A.app.attFileHtml(rec.files[0], 'att-file', 'k').includes(`href="${f.url}"`), 'ссылка скачивания — url');
  const dl = await kit.call(srv, 'GET', f.url, { cookie: boss.cookie });
  assert.equal(dl.status, 200);
  assert.equal(Buffer.from(dl.body).toString('utf8'), 'привет, склад');

  // фото приёмки: после сжатия загружается, в черновик — адрес
  class FakeReader { readAsDataURL() { this.result = 'data:image/png;base64,iVBORw0KGgo='; this.onload(); } }
  class FakeImage { set src(v) { this.width = 1440; this.height = 960; this.onload(); } }
  const orig = A.app.document.createElement;
  A.app.document.createElement = tag => (tag === 'canvas' ? { getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/jpeg;base64,/9j/4AAQ' } : orig(tag));
  const P = page(srv, { FileReader: FakeReader, Image: FakeImage }); pages.push(P);
  P.app.document.createElement = A.app.document.createElement;
  await P.app.serverBoot(); await P.app.serverLogin('boss', boss.password);
  P.app.S.rcv = { shipId: 'П-1', qty: {}, dmg: {}, note: '', photos: [], done: null };
  P.app.addPhotos([{ name: 'груз.png', type: 'image/png', size: 10 }]);
  await until(() => P.app.S.rcv.photos.length);
  assert.match(P.app.S.rcv.photos[0], /^\/api\/files\/fl[0-9a-f]{24}$/);
  const img = await kit.call(srv, 'GET', P.app.S.rcv.photos[0], { cookie: boss.cookie });
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
}));

test('«Сотрудники» у директора: колонка «Логин», «Выдать пароль» (один раз), «Отключить»/«Включить», «Завершить сеансы»; у остальных раздела нет', () => withServer(async (srv, pages) => {
  const { boss, anna } = await firm(srv);
  const A = await open(srv, 'boss', boss.password); pages.push(A);
  A.app.go('team');
  await until(() => A.app.srv.users);
  A.app.render();
  const view = A.html('view');
  for (const w of ['<th>Логин</th>', 'boss', 'anna'.length ? anna.login : '', 'Выдать пароль', 'Отключить', 'Завершить сеансы', 'Новый сотрудник']) assert.ok(view.includes(w), 'нет: ' + w);

  // новый сотрудник: имя, отдел, роль, логин → пароль показан один раз
  const set = (id, v) => { A.app.byId(id).value = v; };
  set('ta-name', 'Пётр (тест)'); set('ta-login', 'petr'); set('ta-dept', 'sales'); set('ta-role', 'managerB2b');
  await A.app.FORMS['team-add']();
  const modal = A.html('modal-root');
  const pw = (/class="mono srv-pw">([^<]+)</.exec(modal) || [])[1];
  assert.ok(pw, 'пароль показан: ' + modal.slice(0, 200));
  assert.equal(A.app.srv.shown, null, 'второй раз пароль не показать');
  const pid = A.app.S.people.find(x => x.name === 'Пётр (тест)').id;
  const first = await kit.login(srv, 'petr', pw);
  assert.equal(first.status, 200);
  assert.equal((await kit.call(srv, 'GET', '/api/me', { cookie: first.cookie })).body.mustChange, true);

  // отключить — вход отклоняется; включить — снова можно
  await A.app.teamDisable(pid, true);
  assert.equal((await kit.login(srv, 'petr', pw)).status, 401);
  await A.app.teamDisable(pid, false);
  assert.equal((await kit.login(srv, 'petr', pw)).status, 200);

  const B = await open(srv, anna.login, anna.password); pages.push(B);
  assert.ok(!B.app.navItems().some(n => n.id === 'team'), 'у менеджера раздела нет');
}));

test('ночная перезагрузка: вкладка с прошлых суток — после 04:00, если нет неотправленного и открытой формы', () => withServer(async (srv, pages) => {
  const { boss } = await firm(srv);
  const A = await open(srv, 'boss', boss.password); pages.push(A);
  const due = A.app.serverNightDue;
  assert.equal(due(new Date(2026, 10, 1, 23, 0), new Date(2026, 10, 2, 3, 59)), false);
  assert.equal(due(new Date(2026, 10, 1, 23, 0), new Date(2026, 10, 2, 4, 0)), true);
  assert.equal(due(new Date(2026, 10, 2, 1, 0), new Date(2026, 10, 2, 5, 0)), false, 'открыта сегодня');
  A.app.srv.openedAt = new Date(Date.now() - 2 * 864e5);
  const at5 = new Date(); at5.setHours(5, 0, 0, 0);
  A.app.openModal('task');
  A.app.srvMinute(at5);
  assert.equal(A.reloads.length, 0, 'открыта форма');
  A.app.closeModal();
  A.app.srvMinute(at5);
  assert.equal(A.reloads.length, 1);
}));
