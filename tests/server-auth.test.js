'use strict';
// Сервер: вход, пароли, сеансы, сотрудники (таск 02, R04, R17i, R22i). Ожидаемое — из interfaces.md («HTTP API») и
// критериев таска: тексты ответов, 5 попыток / 15 минут, 12 часов / 30 дней, пароль не короче 8 символов.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { start, call, login, director, employee, changes, secret, events } = require('./server-kit.js');

const HOUR = 3600e3, DAY = 24 * HOUR, MIN = 60e3;
const db = srv => new DatabaseSync(path.join(srv.dir, 'crm.db'), { readOnly: true });

test('вход: верные логин и пароль — 200 и cookie crm_sid (HttpOnly, SameSite=Lax, 30 дней); Secure — только при secureCookie', async () => {
  const srv = await start();
  try {
    const password = secret();
    await srv.app.admin.createDirector('Boss', password, 'Директор (тест)');
    const r = await login(srv, ' boss ', password);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { person: { id: 'p1', name: 'Директор (тест)', role: 'director' }, mustChange: false });
    assert.match(r.setCookie, /^crm_sid=[A-Za-z0-9_-]{43}; /);
    assert.match(r.setCookie, /; HttpOnly/);
    assert.match(r.setCookie, /; SameSite=Lax/);
    assert.match(r.setCookie, /; Max-Age=2592000/);
    assert.doesNotMatch(r.setCookie, /Secure/);
    const me = await call(srv, 'GET', '/api/me', { cookie: r.cookie });
    assert.equal(me.status, 200);
    assert.equal(me.body.person.id, 'p1');
    assert.equal(typeof me.body.tag, 'string');
  } finally { await srv.stop(); }
  const sec = await start({ secureCookie: true });
  try {
    const password = secret();
    await sec.app.admin.createDirector('boss', password);
    assert.match((await login(sec, 'boss', password)).setCookie, /; Secure/);
  } finally { await sec.stop(); }
});

test('вход: неверный логин и неверный пароль — одинаковые 401 «Неверный логин или пароль»', async () => {
  const srv = await start();
  try {
    await director(srv);
    const wrongPass = await login(srv, 'boss', secret());
    const wrongLogin = await login(srv, 'nobody', secret());
    assert.equal(wrongPass.status, 401);
    assert.equal(wrongLogin.status, 401);
    assert.deepEqual(wrongPass.body, { error: 'Неверный логин или пароль' });
    assert.deepEqual(wrongLogin.body, wrongPass.body);
    assert.equal(wrongPass.setCookie, '');
  } finally { await srv.stop(); }
});

test('вход: 5 неудач по логину — 429 на 15 минут с retryMin, даже с верным паролем; через 15 минут — вход', async () => {
  const srv = await start();
  try {
    const boss = await director(srv);
    for (let i = 0; i < 5; i++) assert.equal((await login(srv, 'boss', secret())).status, 401, `попытка ${i + 1}`);
    const sixth = await login(srv, 'boss', boss.password);
    assert.equal(sixth.status, 429);
    assert.equal(sixth.body.retryMin, 15);
    assert.equal(sixth.body.error, 'Слишком много попыток, попробуй через 15 мин');
    srv.clock.t += 10 * MIN;
    assert.equal((await login(srv, 'boss', boss.password)).body.retryMin, 5);
    srv.clock.t += 5 * MIN + 1;
    assert.equal((await login(srv, 'boss', boss.password)).status, 200);
  } finally { await srv.stop(); }
});

test('сеанс: «Чужой компьютер» — cookie без срока и не дольше 12 ч; обычный — 30 дней с последнего захода; выход закрывает', async () => {
  const srv = await start();
  try {
    const boss = await director(srv);
    const foreign = await login(srv, 'boss', boss.password, true);
    assert.equal(foreign.status, 200);
    assert.doesNotMatch(foreign.setCookie, /Max-Age|Expires/);
    const usual = await login(srv, 'boss', boss.password);
    srv.clock.t += 11 * HOUR;
    assert.equal((await call(srv, 'GET', '/api/me', { cookie: foreign.cookie })).status, 200);
    srv.clock.t += 1 * HOUR + 1;
    assert.equal((await call(srv, 'GET', '/api/me', { cookie: foreign.cookie })).status, 401, 'чужой компьютер: 12 ч прошли');
    // обычный: заход через 29 дней продлевает ещё на 30
    srv.clock.t += 28 * DAY;
    assert.equal((await call(srv, 'GET', '/api/me', { cookie: usual.cookie })).status, 200);
    srv.clock.t += 29 * DAY;
    assert.equal((await call(srv, 'GET', '/api/me', { cookie: usual.cookie })).status, 200, 'продлён с последнего захода');
    srv.clock.t += 30 * DAY + 1;
    assert.equal((await call(srv, 'GET', '/api/me', { cookie: usual.cookie })).status, 401, '30 дней без захода');
    // выход
    const again = await login(srv, 'boss', boss.password);
    const out = await call(srv, 'POST', '/api/logout', { cookie: again.cookie });
    assert.equal(out.status, 200);
    assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal((await call(srv, 'GET', '/api/me', { cookie: again.cookie })).status, 401);
  } finally { await srv.stop(); }
});

test('запись без X-CRM: 1 — 403; без сеанса — 401', async () => {
  const srv = await start();
  try {
    const boss = await director(srv);
    for (const route of ['/api/changes', '/api/logout', '/api/login', '/api/ids', '/api/password', '/api/files', '/api/users/p1/logout']) {
      const r = await call(srv, 'POST', route, { cookie: boss.cookie, body: {}, noCrm: true });
      assert.equal(r.status, 403, route);
    }
    assert.equal((await call(srv, 'GET', '/api/me', { cookie: boss.cookie })).status, 200, 'сеанс не закрыт запросом без заголовка');
    for (const route of ['/api/state', '/api/sync', '/api/me', '/api/events', '/api/users']) {
      assert.equal((await call(srv, 'GET', route)).status, 401, route);
    }
    for (const route of ['/api/changes', '/api/ids', '/api/password', '/api/logout']) {
      assert.equal((await call(srv, 'POST', route, { body: {} })).status, 401, route);
    }
    assert.equal((await call(srv, 'GET', '/api/state', { cookie: 'crm_sid=' + 'A'.repeat(43) })).status, 401, 'выдуманный токен');
  } finally { await srv.stop(); }
});

test('пароль: только scrypt с солью в users; ни хеша, ни соли, ни токена в ответах; смена — старый обязателен, новый ≥ 8', async () => {
  const srv = await start();
  try {
    const boss = await director(srv);
    const anna = await employee(srv, boss, { id: 'p2', name: 'Анна (тест)', role: 'managerB2c', dept: 'sales' });
    const d = db(srv);
    const rows = d.prepare('SELECT * FROM users').all();
    d.close();
    assert.equal(rows.length, 2);
    for (const u of rows) {
      assert.match(u.hash, /^[0-9a-f]{128}$/);
      assert.match(u.salt, /^[0-9a-f]{32}$/);
      assert.ok(!Object.values(u).includes(boss.password) && !Object.values(u).includes(anna.password), 'пароль открытым текстом');
    }
    assert.notEqual(rows[0].salt, rows[1].salt);
    const token = boss.cookie.split('=')[1];
    const texts = [
      (await call(srv, 'GET', '/api/state', { cookie: boss.cookie })).text,
      (await call(srv, 'GET', '/api/me', { cookie: boss.cookie })).text,
      (await call(srv, 'GET', '/api/users', { cookie: boss.cookie })).text,
      (await call(srv, 'GET', '/api/sync', { cookie: boss.cookie })).text,
    ].join('\n');
    for (const s of [...rows.map(u => u.hash), ...rows.map(u => u.salt), token, boss.password, anna.password]) assert.ok(!texts.includes(s));
    assert.doesNotMatch(texts, /"(hash|salt|tokenHash)"/);
    const sd = db(srv);
    const sessions = sd.prepare('SELECT tokenHash FROM sessions').all();
    sd.close();
    assert.ok(sessions.length > 0 && sessions.every(s => s.tokenHash !== token && /^[0-9a-f]{64}$/.test(s.tokenHash)), 'в базе только хеш токена');

    // смена пароля
    const bad = await call(srv, 'POST', '/api/password', { cookie: anna.cookie, body: { old: secret(), password: secret() } });
    assert.deepEqual([bad.status, bad.body.error], [400, 'Старый пароль неверный']);
    const short = await call(srv, 'POST', '/api/password', { cookie: anna.cookie, body: { old: anna.password, password: '1234567' } });
    assert.deepEqual([short.status, short.body.error], [400, 'Новый пароль — не короче 8 символов']);
    const next = secret();
    assert.equal((await call(srv, 'POST', '/api/password', { cookie: anna.cookie, body: { old: anna.password, password: next } })).status, 200);
    assert.equal((await login(srv, anna.login, anna.password)).status, 401);
    assert.equal((await login(srv, anna.login, next)).status, 200);
  } finally { await srv.stop(); }
});

test('выданный директором пароль — mustChange: до смены пароля данных нет (403), после — есть', async () => {
  const srv = await start();
  try {
    const boss = await director(srv);
    await changes(srv, boss.cookie, [{ key: 'people', id: 'p2', base: null, data: { id: 'p2', name: 'Олег (тест)', role: 'logist', dept: 'logistics' } }]);
    assert.equal((await call(srv, 'POST', '/api/users/p2/login', { cookie: boss.cookie, body: { login: 'oleg' } })).status, 200);
    const issued = await call(srv, 'POST', '/api/users/p2/password', { cookie: boss.cookie, body: {} });
    assert.equal(issued.status, 200);
    assert.match(issued.body.password, /^[A-Za-z2-9]{12}$/);
    const first = await login(srv, 'oleg', issued.body.password);
    assert.equal(first.body.mustChange, true);
    assert.equal((await call(srv, 'GET', '/api/me', { cookie: first.cookie })).body.mustChange, true);
    const blocked = await call(srv, 'GET', '/api/state', { cookie: first.cookie });
    assert.deepEqual([blocked.status, blocked.body.mustChange], [403, true]);
    assert.equal((await call(srv, 'POST', '/api/password', { cookie: first.cookie, body: { old: issued.body.password, password: secret() } })).status, 200);
    assert.equal((await call(srv, 'GET', '/api/state', { cookie: first.cookie })).status, 200);
    // пароль показан один раз: в списке сотрудников его нет
    const users = await call(srv, 'GET', '/api/users', { cookie: boss.cookie });
    assert.ok(!users.text.includes(issued.body.password));
    assert.deepEqual(users.body.users.find(u => u.personId === 'p2'), { personId: 'p2', login: 'oleg', hasPassword: true, mustChange: false, disabled: false, sessions: 1, name: 'Олег (тест)' });
  } finally { await srv.stop(); }
});

test('API директора: не директору — 403; «Отключить» закрывает сеансы сразу и не пускает; «Завершить сеансы»; admin.resetPassword', async () => {
  const srv = await start();
  try {
    const boss = await director(srv);
    const anna = await employee(srv, boss, { id: 'p2', name: 'Анна (тест)', role: 'managerB2c', dept: 'sales' });
    for (const [m, route] of [['GET', '/api/users'], ['POST', '/api/users/p1/password'], ['POST', '/api/users/p1/disable'], ['POST', '/api/users/p1/login'], ['POST', '/api/users/p1/logout']]) {
      const r = await call(srv, m, route, { cookie: anna.cookie, body: m === 'POST' ? { login: 'x' } : undefined });
      assert.equal(r.status, 403, route);
    }
    assert.equal((await login(srv, 'boss', boss.password)).status, 200, 'пароль директора не тронут');
    assert.equal((await call(srv, 'POST', '/api/users/p2/login', { cookie: boss.cookie, body: { login: 'boss' } })).status, 400, 'занятый логин');
    // завершить сеансы
    const out = await call(srv, 'POST', '/api/users/p2/logout', { cookie: boss.cookie, body: {} });
    assert.deepEqual([out.status, out.body.closed], [200, 1]);
    assert.equal((await call(srv, 'GET', '/api/me', { cookie: anna.cookie })).status, 401);
    // отключить
    const again = await login(srv, anna.login, anna.password);
    const stream = await events(srv, again.cookie);
    const off = await call(srv, 'POST', '/api/users/p2/disable', { cookie: boss.cookie, body: {} });
    assert.equal(off.status, 200);
    await stream.wait(e => e.event === 'bye', 2000);
    await stream.wait(e => e.event === 'closed', 2000);
    assert.equal((await call(srv, 'GET', '/api/state', { cookie: again.cookie })).status, 401, 'сеанс закрыт сразу');
    const denied = await login(srv, anna.login, anna.password);
    assert.deepEqual([denied.status, denied.body.error], [401, 'Неверный логин или пароль']);
    assert.equal((await call(srv, 'POST', '/api/users/p1/disable', { cookie: boss.cookie, body: {} })).status, 400, 'себя отключить нельзя');
    // включить обратно и выдать пароль командой (функция admin)
    assert.equal((await call(srv, 'POST', '/api/users/p2/disable', { cookie: boss.cookie, body: { disabled: false } })).status, 200);
    const fresh = await srv.app.admin.resetPassword('p2');
    assert.equal((await login(srv, anna.login, anna.password)).status, 401, 'старый пароль больше не подходит');
    const r = await login(srv, anna.login, fresh);
    assert.deepEqual([r.status, r.body.mustChange], [200, true]);
  } finally { await srv.stop(); }
});
