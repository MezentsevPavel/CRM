'use strict';
// Помощники тестов сервера (не тест — tests/index.js берёт только *.test.js). Сервер поднимается на временной папке и
// свободном порту, часы подменяются (clock.t), пароли генерируются здесь же, запросы — fetch из Node 24.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createApp } = require('../server/app.js');

const T0 = Date.parse('2026-11-02T10:00:00+08:00');
const secret = () => crypto.randomBytes(12).toString('base64url');

async function start(opts = {}) {
  const dir = opts.dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'crm-test-'));
  const clock = opts.clock || { t: T0 };
  const app = await createApp({ dataDir: dir, port: 0, now: () => clock.t, ...opts, clock: undefined });
  return {
    app, dir, clock, url: app.url,
    async stop(keep) { await app.close(); if (!keep) fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

// Запрос к серверу. write — запрос записи (POST с X-CRM: 1, если не задано noCrm)
async function call(srv, method, route, { cookie, body, headers = {}, noCrm, raw } = {}) {
  const h = { ...headers };
  if (cookie) h.cookie = cookie;
  if (method === 'POST' && !noCrm) h['X-CRM'] = '1';
  let payload;
  if (raw !== undefined) payload = raw;
  else if (body !== undefined) { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const res = await fetch(srv.url + route, { method, headers: h, body: payload });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, body: data, headers: res.headers, text: type.includes('json') ? JSON.stringify(data) : null };
}

async function login(srv, user, password, foreign = false) {
  const r = await call(srv, 'POST', '/api/login', { body: { login: user, password, foreign } });
  const set = r.headers.get('set-cookie') || '';
  return { ...r, setCookie: set, cookie: r.status === 200 ? set.split(';')[0] : null };
}

// Директор p1 с входом
async function director(srv, name = 'Директор (тест)') {
  const password = secret();
  const pid = await srv.app.admin.createDirector('boss', password, name);
  const { cookie } = await login(srv, 'boss', password);
  return { pid, cookie, password, login: 'boss' };
}

// Пачка изменений от сеанса; changes — [{key, id, base, data} | {key, id, base, deleted}]
const changes = (srv, cookie, list, view) => call(srv, 'POST', '/api/changes', { cookie, body: { changes: list, view } });
// Состояние человека (GET /api/state) с номером правки seq и вкладкой view
const state = async (srv, cookie) => { const b = (await call(srv, 'GET', '/api/state', { cookie })).body; return { ...b.state, seq: b.seq, view: b.view }; };
const docOf = (st, key, id) => (st[key] || []).find(x => x.id === id);

// Сотрудник: директор заводит человека, логин и пароль; сотрудник входит и меняет пароль
async function employee(srv, boss, person) {
  const r = await changes(srv, boss.cookie, [{ key: 'people', id: person.id, base: null, data: person }]);
  if (r.status !== 200) throw new Error('сотрудник не заведён: ' + r.text);
  const userLogin = 'u' + person.id;
  await call(srv, 'POST', `/api/users/${person.id}/login`, { cookie: boss.cookie, body: { login: userLogin } });
  const issued = await call(srv, 'POST', `/api/users/${person.id}/password`, { cookie: boss.cookie, body: {} });
  const first = await login(srv, userLogin, issued.body.password);
  const password = secret();
  const ch = await call(srv, 'POST', '/api/password', { cookie: first.cookie, body: { old: issued.body.password, password } });
  if (ch.status !== 200) throw new Error('пароль не сменён: ' + ch.text);
  return { pid: person.id, cookie: first.cookie, login: userLogin, password };
}

const dateDoc = ms => ({ $date: new Date(ms).toISOString() });
// Сделка в минимальной форме, как её кладёт Deals.create
function deal(id, { type = 'b2c', managerId, client = 'Клиент (тест)', clientId = '', amount = 150000, stageId = 'request', at = T0 } = {}) {
  return {
    id, clientId, client, contact: client, kind: 'Частный клиент', object: 'СЭС (тест)', type,
    pipeId: type === 'b2b' ? 'dealsB2b' : 'dealsB2c', stageId, managerId, channel: 'phone', amount, phone: '', email: '',
    items: [], at: dateDoc(at),
  };
}

// Поток событий /api/events: собирает события, wait(fn, ms) ждёт подходящего
async function events(srv, cookie) {
  const ctrl = new AbortController();
  const res = await fetch(srv.url + '/api/events', { headers: { cookie }, signal: ctrl.signal });
  const got = [];
  let buf = '';
  const waiters = [];
  const check = () => { for (const w of [...waiters]) { const e = got.find(w.fn); if (e) { waiters.splice(waiters.indexOf(w), 1); w.ok(e); } } };
  (async () => {
    try {
      for await (const chunk of res.body) {
        buf += Buffer.from(chunk).toString('utf8');
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = /^event: (.+)$/m.exec(block), data = /^data: (.*)$/m.exec(block);
          if (ev) got.push({ event: ev[1], data: data ? JSON.parse(data[1]) : null, at: Date.now() });
        }
        check();
      }
    } catch { /* поток закрыт */ }
    got.push({ event: 'closed', at: Date.now() });
    check();
  })();
  return {
    status: res.status, got,
    wait: (fn, ms = 5000) => new Promise((ok, fail) => {
      const e = got.find(fn);
      if (e) return ok(e);
      const w = { fn, ok: x => { clearTimeout(timer); ok(x); } };
      const timer = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); fail(new Error('событие не пришло за ' + ms + ' мс')); }, ms);
      waiters.push(w);
    }),
    close: () => ctrl.abort(),
  };
}

module.exports = { T0, secret, start, call, login, director, employee, changes, state, docOf, deal, dateDoc, events };
