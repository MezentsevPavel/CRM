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
      assert.match(u.hash, /^scrypt\$1024\$8\$1\$[0-9a-f]{128}$/);
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

// ——— предел попыток по компьютеру ———
// Адрес клиента приходит от Caddy в X-Forwarded-For (соединение с этой же машины); в тестах его ставим сами.
const A = '203.0.113.5', B = '203.0.113.6', C = '203.0.113.7';
const loginFrom = (srv, ip, user, password) => call(srv, 'POST', '/api/login', { body: { login: user, password }, headers: { 'X-Forwarded-For': ip } });

test('вход: 5 неудач с адреса А закрывают вход под этим логином только с А — с Б тот же логин и верный пароль входят; другие логины с А тоже', async () => {
  const srv = await start();
  try {
    const boss = await director(srv);
    const anna = await employee(srv, boss, { id: 'p2', name: 'Анна (тест)', role: 'managerB2c', dept: 'sales' });
    for (let i = 0; i < 5; i++) assert.equal((await loginFrom(srv, A, 'boss', secret())).status, 401, 'попытка ' + (i + 1));
    const closed = await loginFrom(srv, A, 'boss', boss.password);
    assert.equal(closed.status, 429, 'с А вход закрыт даже с верным паролем');
    assert.equal(closed.body.retryMin, 15);
    assert.equal((await loginFrom(srv, B, 'boss', boss.password)).status, 200, 'с Б директор входит');
    assert.equal((await loginFrom(srv, A, anna.login, anna.password)).status, 200, 'с А другой логин входит: закрыта пара, а не адрес');
    srv.clock.t += 15 * MIN + 1;
    assert.equal((await loginFrom(srv, A, 'boss', boss.password)).status, 200, 'через 15 минут и с А');
  } finally { await srv.stop(); }
});

test('вход: 20 неудач с адреса по любым логинам закрывают адрес целиком; удачный вход под своей учёткой счёт адреса не обнуляет', async () => {
  const srv = await start();
  try {
    const boss = await director(srv);
    // 19 неудач по разным логинам, включая несуществующие
    for (let i = 0; i < 19; i++) assert.equal((await loginFrom(srv, C, i % 2 ? 'boss' + i : 'нет' + i, secret())).status, 401, 'попытка ' + (i + 1));
    assert.equal((await loginFrom(srv, C, 'boss', secret())).status, 401, '20-я неудача ещё отвечает как неудача');
    const closed = await loginFrom(srv, C, 'boss', boss.password);
    assert.equal(closed.status, 429, 'после 20 неудач адрес закрыт и для верного пароля');
    assert.equal((await loginFrom(srv, B, 'boss', boss.password)).status, 200, 'другой адрес не закрыт');
    srv.clock.t += 15 * MIN + 1;
    assert.equal((await loginFrom(srv, C, 'boss', boss.password)).status, 200);
    // обнулить счёт адреса удачным входом нельзя: 4 круга «4 неудачи и свой вход» и ещё 4 неудачи = 20 неудач
    srv.clock.t += 20 * MIN;
    for (let round = 0; round < 4; round++) {
      for (let i = 0; i < 4; i++) assert.equal((await loginFrom(srv, A, 'boss', secret())).status, 401);
      assert.equal((await loginFrom(srv, A, 'boss', boss.password)).status, 200, 'круг ' + (round + 1) + ': вход сбрасывает счёт пары, не адреса');
    }
    for (let i = 0; i < 4; i++) assert.equal((await loginFrom(srv, A, 'boss', secret())).status, 401);
    assert.equal((await loginFrom(srv, A, 'boss', boss.password)).status, 429, 'счёт адреса не обнулился');
  } finally { await srv.stop(); }
});

test('адрес клиента: X-Forwarded-For верен только с этой же машины, берётся последний элемент; с чужого адреса игнорируется', () => {
  const { clientIp } = require('../server/app.js');
  assert.equal(clientIp('127.0.0.1', '198.51.100.1'), '198.51.100.1');
  assert.equal(clientIp('::ffff:127.0.0.1', '198.51.100.1, 198.51.100.2'), '198.51.100.2', 'последний — тот, что дописал Caddy');
  assert.equal(clientIp('::1', '2001:db8::5'), '2001:db8::5');
  assert.equal(clientIp('127.0.0.1', undefined), '127.0.0.1');
  assert.equal(clientIp('127.0.0.1', 'не-адрес'), '127.0.0.1', 'мусор вместо адреса — адрес соединения');
  // с чужого адреса заголовок написал сам клиент
  assert.equal(clientIp('203.0.113.9', '198.51.100.1'), '203.0.113.9');
  assert.equal(clientIp('::ffff:203.0.113.9', '127.0.0.1'), '203.0.113.9');
  assert.equal(clientIp('2001:db8::1', '198.51.100.1'), '2001:db8::1');
});

test('вход: заголовок X-Forwarded-For от клиента не обходит предел — дописанный Caddy последний элемент решает', async () => {
  const srv = await start();
  try {
    const boss = await director(srv);
    // клиент подсунул свой адрес первым, Caddy дописал настоящий (A): считается А
    for (let i = 0; i < 5; i++) await loginFrom(srv, `198.51.100.${i}, ${A}`, 'boss', secret());
    assert.equal((await loginFrom(srv, `198.51.100.99, ${A}`, 'boss', boss.password)).status, 429, 'смена первого элемента не помогла');
    assert.equal((await loginFrom(srv, B, 'boss', boss.password)).status, 200);
  } finally { await srv.stop(); }
});

// ——— стойкость хранения паролей ———
const { DatabaseSync: Sqlite } = require('node:sqlite');
const crypto = require('node:crypto');
const userRow = (srv, login) => { const d = db(srv); try { return d.prepare('SELECT hash, salt, mustChange FROM users WHERE login = ?').get(login); } finally { d.close(); } };

test('пароль: новый хеш — scrypt N=2^17 с параметрами в строке; Node 24 считает без ошибки; неверный пароль не проходит', async () => {
  const srv = await start({ passwordCostLog2: undefined });
  try {
    const boss = await director(srv);
    const row = userRow(srv, 'boss');
    assert.match(row.hash, /^scrypt\$131072\$8\$1\$[0-9a-f]{128}$/, 'N=2^17 = 131072, r=8, p=1 в самой строке');
    assert.equal((await login(srv, 'boss', boss.password)).status, 200);
    assert.equal((await login(srv, 'boss', secret())).status, 401);
  } finally { await srv.stop(); }
});

test('пароль: прежний хеш (N=2^14, без приставки) проверяется, а после удачного входа заменяется новым (2^17); неудачный вход его не трогает', async () => {
  const srv = await start({ passwordCostLog2: undefined });
  try {
    const boss = await director(srv);
    const password = secret(), salt = crypto.randomBytes(16);
    const old = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
    const w = new Sqlite(path.join(srv.dir, 'crm.db'));
    w.prepare('UPDATE users SET hash = ?, salt = ?, mustChange = 1 WHERE login = ?').run(old, salt.toString('hex'), 'boss');
    w.close();
    assert.equal((await login(srv, 'boss', boss.password)).status, 401, 'прежний пароль после подмены хеша не подходит');
    assert.equal(userRow(srv, 'boss').hash, old, 'неудачный вход хеш не менял');
    const ok = await login(srv, 'boss', password);
    assert.equal(ok.status, 200, 'прежний хеш проверяется');
    assert.equal(ok.body.mustChange, true);
    const now = userRow(srv, 'boss');
    assert.match(now.hash, /^scrypt\$131072\$8\$1\$[0-9a-f]{128}$/, 'после входа хеш записан новыми параметрами');
    assert.notEqual(now.salt, salt.toString('hex'), 'и с новой солью');
    assert.equal(now.mustChange, 1, 'требование сменить пароль перехеширование не сняло');
    assert.equal((await login(srv, 'boss', password)).status, 200, 'новый хеш проверяется тем же паролем');
    assert.equal((await login(srv, 'boss', boss.password)).status, 401);
  } finally { await srv.stop(); }
});

test('needsRehash: прежний хеш и хеш с иными параметрами — да, текущий — нет, мусор — да', () => {
  const { needsRehash } = require('../server/auth.js');
  assert.equal(needsRehash('a'.repeat(128)), true);
  assert.equal(needsRehash('scrypt$16384$8$1$' + 'a'.repeat(128)), true);
  assert.equal(needsRehash('scrypt$131072$8$1$' + 'a'.repeat(128)), false);
  assert.equal(needsRehash('scrypt$131072$8$1$' + 'a'.repeat(128), 10), true);
  assert.equal(needsRehash('scrypt$131073$8$1$zz'), true);
  assert.equal(needsRehash(null), true);
});

test('пароли: 5 входов одновременно — считается не больше двух scrypt сразу (по 128 МБ), остальные ждут очереди, все пять отвечают верно', async () => {
  const crypto = require('node:crypto');
  const real = crypto.scrypt;
  let now = 0, top = 0, calls = 0;
  // каждое обращение к scrypt считаем от вызова до ответа и держим подольше, чтобы наплыв был настоящим
  crypto.scrypt = (...a) => {
    const cb = a.pop();
    calls++; now++; top = Math.max(top, now);
    real(...a, (e, key) => setTimeout(() => { now--; cb(e, key); }, 40));
  };
  const srv = await start();
  try {
    const boss = await director(srv);
    calls = 0; top = 0;
    const answers = await Promise.all(Array.from({ length: 5 }, (_, i) => login(srv, 'boss', i === 4 ? secret() : boss.password)));
    assert.deepEqual(answers.map(r => r.status), [200, 200, 200, 200, 401], 'каждый получил свой верный ответ');
    assert.ok(calls >= 5, 'считались все пять проверок: ' + calls);
    assert.ok(top <= 2, 'одновременно считалось не больше двух: было ' + top);
    assert.ok(top >= 2, 'но и два сразу идут (очередь не по одному): было ' + top);
  } finally { crypto.scrypt = real; await srv.stop(); }
});
