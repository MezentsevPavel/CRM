'use strict';
// Сервер: база, страница, общее состояние, пачки изменений, живые обновления, номера, уведомления по времени, ревизия
// (таск 02, R01, R03, R05, R07.2, R20i). Ожидаемое — из interfaces.md, критериев таска и ядра таска 01 (Visible.of,
// посчитанное здесь же отдельной загрузкой ядра), а не из кода сервера.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { build } = require('../tools/build.js');
const { load, bootPage } = require('./load.js');
const { T0, start, call, login, secret, director, employee, changes, state, docOf, deal, dateDoc, events } = require('./server-kit.js');

const MIN = 60e3;
let CORE = null;
const core = () => CORE || (CORE = load({ globals: { CRM_SERVER: 1 } }));
const db = srv => new DatabaseSync(path.join(srv.dir, 'crm.db'), { readOnly: true });
const count = (srv, sql, ...args) => { const d = db(srv); try { return d.prepare(sql).get(...args).n; } finally { d.close(); } };
const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x));

// Фирма для проверок: директор p1, менеджер B2C p2, менеджер B2B p3, инженер p4 (без права «цены»)
async function firm(srv) {
  const boss = await director(srv);
  const anna = await employee(srv, boss, { id: 'p2', name: 'Анна (тест)', role: 'managerB2c', dept: 'sales' });
  const max = await employee(srv, boss, { id: 'p3', name: 'Максим (тест)', role: 'managerB2b', dept: 'sales' });
  const eng = await employee(srv, boss, { id: 'p4', name: 'Инженер (тест)', role: 'engineer', dept: 'eng' });
  return { boss, anna, max, eng };
}

test('старт: GET / — собранная страница с window.CRM_SERVER=1 на месте метки; база из seedBase(); после перезапуска всё на месте', async () => {
  const srv = await start();
  let dir;
  try {
    const page = await fetch(srv.url + '/');
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.ok(!html.includes('<!--CRM-SERVER-->'));
    assert.match(html, /<script>window\.CRM_SERVER=1<\/script>\n<script>\n\(\(\)=>\{/);
    assert.ok(html.replace('<script>window.CRM_SERVER=1</script>', '<!--CRM-SERVER-->').includes(build()), 'остальное — собранная страница как есть');
    const { byId } = bootPage(html);
    assert.ok(byId('view').innerHTML.length > 0, 'страница с двумя <script> запускается');

    const boss = await director(srv);
    const st = await state(srv, boss.cookie);
    // seedBase: 9 ролей, 242 позиции каталога, люди — только заведённый директор, записей нет
    assert.equal(st.roles.length, 9);
    assert.equal(st.products.length, 242);
    assert.deepEqual(st.people, [{ id: 'p1', name: 'Директор (тест)', role: 'director', dept: 'mgmt' }]);
    for (const key of ['deals', 'leads', 'clients', 'tasks', 'shipments', 'dispatches', 'notes', 'feed', 'acts', 'moves', 'reserves']) assert.deepEqual(st[key], [], key);
    assert.ok(!JSON.stringify(st).includes('"demo":true'), 'демо-записей нет');

    const r = await changes(srv, boss.cookie, [{ key: 'deals', id: 'Д-301', base: null, data: deal('Д-301', { managerId: 'p1' }) }]);
    assert.equal(r.status, 200);
    dir = srv.dir;
  } finally { await srv.stop(true); }
  const again = await start({ dataDir: dir });
  try {
    // пароль директора тест не хранит: выдаём новый командой и меняем, как при первом входе
    const pw = await again.app.admin.resetPassword('p1');
    const first = await login(again, 'boss', pw);
    assert.equal((await call(again, 'POST', '/api/password', { cookie: first.cookie, body: { old: pw, password: secret() } })).status, 200);
    const st = await state(again, first.cookie);
    assert.equal(docOf(st, 'deals', 'Д-301').client, 'Клиент (тест)');
    assert.ok(st.seq >= 1, 'номер правки сохранён');
  } finally { await again.stop(); }
});

test('GET /api/state = Visible.of для человека сеанса: чужие сделки не приходят, без права «цены» — без сумм, dealId заявки невидимой сделки скрыт', async () => {
  const srv = await start();
  try {
    const { boss, anna, eng } = await firm(srv);
    const r = await changes(srv, boss.cookie, [
      { key: 'deals', id: 'Д-301', base: null, data: deal('Д-301', { managerId: 'p2', type: 'b2c' }) },
      { key: 'deals', id: 'Д-302', base: null, data: deal('Д-302', { managerId: 'p3', type: 'b2b', amount: 990000 }) },
      { key: 'dispatches', id: 'dsp1', base: null, data: { id: 'dsp1', number: 'ОТ-001', purpose: 'sale', by: 'p1', dealId: 'Д-302', items: [], pipeId: 'dispatch', stageId: 'new', at: dateDoc(T0) } },
    ]);
    assert.equal(r.status, 200, r.text);
    const full = await state(srv, boss.cookie);
    const mine = await state(srv, anna.cookie);
    assert.deepEqual(mine.deals.map(d => d.id), ['Д-301']);
    assert.equal(docOf(mine, 'dispatches', 'dsp1').dealId, 'hidden');
    const engineer = await state(srv, eng.cookie);
    assert.deepEqual(engineer.deals.map(d => d.id).sort(), ['Д-301', 'Д-302']);
    assert.ok(engineer.deals.every(d => !('amount' in d)), 'инженер без права «цены» сумм не получает');
    assert.ok(engineer.products.every(p => !('price' in p)));
    // то же, что посчитает ядро: Visible.of над полным состоянием (состояние директора — всё, кроме личного)
    const C = core();
    const { seq: _s, view: _v, ...fullState } = full;
    const whole = C.Docs.join(JSON.parse(JSON.stringify(C.Docs.split(JSON.parse(JSON.stringify(fullState), C.Store.revive)))));
    whole.prefs = { notify: {}, sound: {} };
    for (const [person, got] of [['p2', mine], ['p4', engineer]]) {
      const { seq, view, ...only } = got;
      const want = canon(C.Store.plain(C.Visible.of(whole, person))), have = canon(only);
      let i = 0; while (i < want.length && want[i] === have[i]) i++;
      assert.ok(have === want, `${person}: расхождение с ${i}: …${have.slice(i - 80, i + 80)}… ждали …${want.slice(i - 80, i + 80)}…`);
    }
  } finally { await srv.stop(); }
});

test('POST /api/changes: разные поля одной записи из двух сеансов — обе правки; одно поле — 409 с именем и свежими документами', async () => {
  const srv = await start();
  try {
    const { boss, anna } = await firm(srv);
    const base = deal('Д-301', { managerId: 'p2' });
    await changes(srv, boss.cookie, [{ key: 'deals', id: 'Д-301', base: null, data: base }]);
    const a = await changes(srv, anna.cookie, [{ key: 'deals', id: 'Д-301', base, data: { ...base, object: 'СЭС 15 кВт' } }]);
    const b = await changes(srv, boss.cookie, [{ key: 'deals', id: 'Д-301', base, data: { ...base, contact: 'Иван (тест)' } }]);
    assert.deepEqual([a.status, b.status], [200, 200]);
    const now = docOf(await state(srv, boss.cookie), 'deals', 'Д-301');
    assert.deepEqual([now.object, now.contact], ['СЭС 15 кВт', 'Иван (тест)']);
    // одно поле по-разному: Анна успела первой, правка директора с той же основы не проходит
    const view = (await call(srv, 'GET', '/api/state', { cookie: boss.cookie })).body.view;
    assert.equal((await changes(srv, anna.cookie, [{ key: 'deals', id: 'Д-301', base: now, data: { ...now, object: 'СЭС 20 кВт' } }])).status, 200);
    const before = count(srv, 'SELECT COUNT(*) AS n FROM log');
    const conflict = await changes(srv, boss.cookie, [{ key: 'deals', id: 'Д-301', base: now, data: { ...now, object: 'СЭС 30 кВт' } }], view);
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.by, 'Анна (тест)');
    assert.equal(conflict.body.error, 'Пока ты правил, запись изменил(а) Анна (тест) — показана свежая версия, повтори');
    assert.deepEqual([conflict.body.key, conflict.body.id], ['deals', 'Д-301']);
    assert.equal(conflict.body.docs.find(x => x.key === 'deals' && x.id === 'Д-301').data.object, 'СЭС 20 кВт', 'свежая версия — в ответе');
    assert.equal(docOf(await state(srv, boss.cookie), 'deals', 'Д-301').object, 'СЭС 20 кВт', 'моя правка не прошла');
    assert.equal(count(srv, 'SELECT COUNT(*) AS n FROM log'), before);
  } finally { await srv.stop(); }
});

test('POST /api/changes: отказ Guard — 403 «Нет прав…», пачка не проведена целиком; проведённая — строка log на каждую запись', async () => {
  const srv = await start();
  try {
    const { boss, anna } = await firm(srv);
    const seq0 = (await state(srv, anna.cookie)).seq;
    const logs0 = count(srv, 'SELECT COUNT(*) AS n FROM log');
    const task = { id: 'tk2-1', title: 'Позвонить (тест)', desc: '', to: { t: 'p', id: 'p2' }, from: 'p2', due: dateDoc(T0 + 86400e3), boardId: 'tasksCommon', stageId: 'new', prio: 'mid', deal: '', at: dateDoc(T0) };
    const roles = (await state(srv, boss.cookie)).roles;
    const director = roles.find(r => r.id === 'managerB2c');
    const bad = await changes(srv, anna.cookie, [
      { key: 'tasks', id: task.id, base: null, data: task },
      { key: 'roles', id: 'managerB2c', base: director, data: { ...director, perms: { ...director.perms, admin: true } } },
    ]);
    assert.equal(bad.status, 403);
    assert.match(bad.body.error, /^Нет прав: /);
    assert.deepEqual([bad.body.key, bad.body.id], ['roles', 'managerB2c']);
    const after = await state(srv, anna.cookie);
    assert.equal(after.seq, seq0);
    assert.equal(docOf(after, 'tasks', task.id), undefined, 'разрешённая часть пачки тоже не проведена');
    assert.equal(count(srv, 'SELECT COUNT(*) AS n FROM log'), logs0);
    // склад без движения — отказ
    const stock = await changes(srv, anna.cookie, [{ key: 'stock', id: 'zz-test', base: null, data: { ip: { _: 5 } } }]);
    assert.equal(stock.status, 403);
    // разрешённая пачка из трёх записей — три строки журнала
    const ok = await changes(srv, anna.cookie, [
      { key: 'tasks', id: task.id, base: null, data: task },
      { key: 'deals', id: 'Д-301', base: null, data: deal('Д-301', { managerId: 'p2' }) },
      { key: 'deals', id: 'Д-302', base: null, data: deal('Д-302', { managerId: 'p2' }) },
    ]);
    assert.equal(ok.status, 200, ok.text);
    const d = db(srv);
    const rows = d.prepare('SELECT seq, personId, key, docId, op FROM log WHERE n > ? ORDER BY n').all(logs0);
    d.close();
    assert.deepEqual(rows.map(r => [r.personId, r.key, r.docId, r.op]), [['p2', 'tasks', task.id, 'add'], ['p2', 'deals', 'Д-301', 'add'], ['p2', 'deals', 'Д-302', 'add']]);
    assert.ok(rows.every(r => r.seq === seq0 + 1));
  } finally { await srv.stop(); }
});

test('живые обновления: сеанс B получает seq по /api/events ≤ 5 с и забирает правку /api/sync; ставшая невидимой сделка — в gone', async () => {
  const srv = await start();
  try {
    const { boss, anna } = await firm(srv);
    const s = (await call(srv, 'GET', '/api/state', { cookie: anna.cookie })).body;
    const ev = await events(srv, anna.cookie);
    try {
      assert.equal(ev.status, 200);
      const sent = Date.now();
      const d = deal('Д-301', { managerId: 'p2' });
      const r = await changes(srv, boss.cookie, [{ key: 'deals', id: 'Д-301', base: null, data: d }]);
      const got = await ev.wait(e => e.event === 'seq' && e.data === r.body.seq, 5000);
      assert.ok(got.at - sent <= 5000);
      const sync = await call(srv, 'GET', `/api/sync?since=${s.seq}&view=${s.view}`, { cookie: anna.cookie });
      assert.deepEqual(sync.body.docs.map(x => [x.key, x.id]), [['deals', 'Д-301']]);
      assert.deepEqual(sync.body.gone, []);
      // второй раз — пусто: сервер помнит, что вкладка уже получила
      assert.deepEqual((await call(srv, 'GET', `/api/sync?view=${s.view}`, { cookie: anna.cookie })).body.docs, []);
      // сделку передали в B2B другому менеджеру — для Анны она исчезла
      await changes(srv, boss.cookie, [{ key: 'deals', id: 'Д-301', base: d, data: { ...d, type: 'b2b', pipeId: 'dealsB2b', managerId: 'p3' } }]);
      const gone = await call(srv, 'GET', `/api/sync?view=${s.view}`, { cookie: anna.cookie });
      assert.deepEqual(gone.body.gone, [{ key: 'deals', id: 'Д-301' }]);
      // вкладка, которую сервер не знает, получает всё заново
      const unknown = await call(srv, 'GET', '/api/sync?view=nope', { cookie: anna.cookie });
      assert.equal(unknown.body.full, true);
      assert.ok(unknown.body.docs.length > 0);
    } finally { ev.close(); }
  } finally { await srv.stop(); }
});

test('/api/ids: два сеанса параллельно берут номера Д- — все разные, у каждого по возрастанию; чужой префикс — 400', async () => {
  const srv = await start();
  try {
    const { boss, anna } = await firm(srv);
    await changes(srv, boss.cookie, [{ key: 'deals', id: 'Д-310', base: null, data: deal('Д-310', { managerId: 'p2' }) }]);
    const asks = [];
    for (let i = 0; i < 10; i++) for (const c of [boss.cookie, anna.cookie]) asks.push(call(srv, 'POST', '/api/ids', { cookie: c, body: { prefix: 'Д-', n: 3 } }));
    const got = (await Promise.all(asks)).map(r => r.body.ids);
    const all = got.flat();
    assert.equal(new Set(all).size, all.length, 'номера не повторяются');
    const num = id => Number(id.slice(2));
    for (const ids of got) assert.deepEqual(ids.map(num), [...ids.map(num)].sort((a, b) => a - b));
    assert.ok(all.every(id => /^Д-\d+$/.test(id) && num(id) > 310), 'после занятых');
    const ot = await call(srv, 'POST', '/api/ids', { cookie: anna.cookie, body: { prefix: 'ОТ-', n: 2 } });
    assert.deepEqual(ot.body.ids, ['ОТ-001', 'ОТ-002']);
    assert.equal((await call(srv, 'POST', '/api/ids', { cookie: anna.cookie, body: { prefix: 't', n: 1 } })).status, 400);
  } finally { await srv.stop(); }
});

test('уведомления по времени: сервер сам зовёт Acts.notify — при трёх открытых сеансах напоминание об одном деле одно', async () => {
  const srv = await start();
  try {
    const boss = await director(srv);
    const tabs = [boss.cookie, (await login(srv, 'boss', boss.password)).cookie, (await login(srv, 'boss', boss.password)).cookie];
    const views = [];
    for (const c of tabs) views.push((await call(srv, 'GET', '/api/state', { cookie: c })).body.view);
    const r = await changes(srv, boss.cookie, [
      { key: 'deals', id: 'Д-301', base: null, data: deal('Д-301', { managerId: 'p1' }) },
      { key: 'acts', id: 'ak1-1', base: null, data: { id: 'ak1-1', ref: { t: 'deal', id: 'Д-301' }, type: 'call', title: 'Перезвонить (тест)', due: dateDoc(T0 + 30 * MIN), ownerId: 'p1', by: 'p1', at: dateDoc(T0), remind: 15 } },
    ]);
    assert.equal(r.status, 200, r.text);
    srv.clock.t = T0 + 10 * MIN;
    assert.equal(srv.app.tick(), 0, 'рано: до напоминания больше 15 минут');
    srv.clock.t = T0 + 16 * MIN;
    assert.equal(srv.app.tick(), 1);
    srv.clock.t = T0 + 17 * MIN;
    assert.equal(srv.app.tick(), 0, 'второй раз не шлёт');
    for (let i = 0; i < 3; i++) {
      const s = await call(srv, 'GET', `/api/sync?view=${views[i]}`, { cookie: tabs[i] });
      const notes = s.body.docs.filter(d => d.key === 'notes');
      assert.equal(notes.length, 1, `вкладка ${i + 1}`);
      assert.equal(notes[0].data.kind, 'act');
      assert.deepEqual(notes[0].data.ref, { t: 'deal', id: 'Д-301' });
    }
    const all = (await state(srv, boss.cookie)).notes;
    assert.equal(all.length, 1);
    assert.equal(count(srv, "SELECT COUNT(*) AS n FROM log WHERE key = 'notes' AND personId IS NULL"), 1);
  } finally { await srv.stop(); }
});

test('каскад: новое название клиента уходит и в сделку, которую правящий не видит', async () => {
  const srv = await start();
  try {
    const { boss, anna } = await firm(srv);
    const client = { id: 'К-1', kind: 'person', name: 'Пётр (тест)', phones: [], managerId: 'p2' };
    const d = deal('Д-301', { managerId: 'p3', type: 'b2b', client: 'Пётр (тест)', clientId: 'К-1' });
    assert.equal((await changes(srv, boss.cookie, [{ key: 'clients', id: 'К-1', base: null, data: client }, { key: 'deals', id: 'Д-301', base: null, data: d }])).status, 200);
    const mine = await state(srv, anna.cookie);
    assert.equal(docOf(mine, 'deals', 'Д-301'), undefined, 'Анна сделку не видит');
    const r = await changes(srv, anna.cookie, [{ key: 'clients', id: 'К-1', base: docOf(mine, 'clients', 'К-1'), data: { ...client, name: 'Пётр Иванов (тест)' } }]);
    assert.equal(r.status, 200, r.text);
    assert.equal(docOf(await state(srv, boss.cookie), 'deals', 'Д-301').client, 'Пётр Иванов (тест)');
  } finally { await srv.stop(); }
});

test('ревизия: meta.rev меньше Store.REV и нет миграции — запуск отказан с текстом, данные не тронуты; база новее кода — отказ', async () => {
  const srv = await start();
  const dir = srv.dir;
  const boss = await director(srv);
  await changes(srv, boss.cookie, [{ key: 'deals', id: 'Д-301', base: null, data: deal('Д-301', { managerId: 'p1' }) }]);
  await srv.stop(true);
  const REV = core().Store.REV;
  const file = path.join(dir, 'crm.db');
  const setRev = v => { const d = new DatabaseSync(file); d.prepare("UPDATE meta SET v = ? WHERE k = 'rev'").run(String(v)); d.close(); };
  const docs = () => { const d = new DatabaseSync(file, { readOnly: true }); const n = d.prepare('SELECT COUNT(*) AS n FROM docs').get().n; d.close(); return n; };
  const n0 = docs();
  setRev(REV - 1);
  await assert.rejects(start({ dataDir: dir }), /нет шага миграции до ревизии .*Данные не тронуты/s);
  assert.equal(docs(), n0);
  setRev(REV + 1);
  await assert.rejects(start({ dataDir: dir }), /база новее кода/);
  assert.equal(docs(), n0);
  setRev(REV);
  const ok = await start({ dataDir: dir });
  await ok.stop();
});
