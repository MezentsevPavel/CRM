'use strict';
// Сервер CRM: HTTP поверх ядра прототипа. createApp — шов тестов сервера; openCore — то же без HTTP (для server/admin.js).
// Всё JSON, кроме страницы, файлов и потока событий. Запись — только POST с заголовком X-CRM: 1 (чужая страница
// такой заголовок без спроса не пошлёт), иначе 403; без сеанса — 401.

const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { openDb } = require('./db.js');
const { createRuntime } = require('./runtime.js');
const { createAuth, generatePassword, PASSWORD_MIN } = require('./auth.js');
const { createFiles } = require('./files.js');
const { createSync, isEmpty } = require('./sync.js');
const { createJobs } = require('./jobs.js');
const { createBackups } = require('./backup.js');
const { createUpdater } = require('./updater.js');
const { migrate } = require('./migrate.js');
const { build, stripGated, ROOT, OUT_NAME } = require('../tools/build.js');

const MARK = '<!--CRM-SERVER-->';
const JSON_MAX = 10 * 1024 * 1024;
const HEARTBEAT_MS = 25e3;

// Страница: собранный файл (нет — собрать в памяти) с меткой серверного режима перед основным скриптом.
// lite = для того, кто не вошёл: без закрытых кусков сборки (каталог с ценами, остатки, демо-записи) — только форма входа;
// метка CRM_LITE говорит странице, что после входа её нужно перезагрузить и получить полную.
function serverPage(lite = false) {
  const file = path.join(ROOT, OUT_NAME);
  const built = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : build();
  const html = lite ? stripGated(built) : built;
  const at = html.indexOf(MARK);
  if (at < 0) throw new Error(`В ${OUT_NAME} нет метки ${MARK} — пересобери страницу: node tools/build.js`);
  const body = html.slice(0, at) + (lite ? '<script>window.CRM_SERVER=1;window.CRM_LITE=1</script>' : '<script>window.CRM_SERVER=1</script>') + html.slice(at + MARK.length);
  return '<!doctype html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">\n</head>\n<body>\n'
    + body + '\n</body>\n</html>\n';
}

// Запрет посторонних скриптов (Content-Security-Policy). Скрипты страницы встроены в неё же, поэтому разрешены не словом
// 'unsafe-inline', а хэшем sha256 каждого из них — считается с тех байтов, что уходят в ответ, а не заранее. Чужой <script>,
// обработчик в атрибуте (onclick=), eval и javascript:-ссылка не выполняются. Подключения (fetch, поток событий) — только к себе;
// шрифты в страницу встроены data:-адресами, картинки — свои, data: (логотип, фото до отправки) и blob:. Стили встроены и
// в style="", поэтому для стилей 'unsafe-inline' остаётся — скрипты он не открывает.
function scriptHashes(html) {
  const out = [];
  for (const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
    // браузер читает страницу, заменив CRLF и CR на LF: хэш считается с того же текста
    const text = m[1].replace(/\r\n?/g, '\n');
    out.push("'sha256-" + crypto.createHash('sha256').update(text, 'utf8').digest('base64') + "'");
  }
  return [...new Set(out)];
}
function pageCsp(html) {
  return [
    "default-src 'self'",
    'script-src ' + (scriptHashes(html).join(' ') || "'none'"),
    "connect-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
  ].join('; ');
}
// Ответы без страницы (JSON, поток событий, копии): им не нужно ничего исполнять и встраивать
const API_CSP = "default-src 'none'; base-uri 'none'; frame-ancestors 'none'";

// Адрес клиента для счёта неудачных входов. Сервер слушает только 127.0.0.1, и настоящий адрес ему сообщает Caddy в заголовке
// X-Forwarded-For (deploy/install.sh ставит его сам: header_up X-Forwarded-For {remote_host}); берётся последний элемент — тот,
// что дописал Caddy. Заголовку верим, только если соединение пришло с этой же машины (127.0.0.1, ::1): с любого другого адреса
// его мог написать кто угодно, и тогда адрес — сам адрес соединения.
const bare = a => String(a || '').replace(/^::ffff:/i, '');
function clientIp(remoteAddress, forwardedFor) {
  const remote = bare(remoteAddress);
  if (remote !== '127.0.0.1' && remote !== '::1') return remote;
  const list = (Array.isArray(forwardedFor) ? forwardedFor.join(',') : String(forwardedFor || '')).split(',');
  const last = bare(list[list.length - 1].trim());
  return net.isIP(last) ? last : remote;
}

// База, ядро, вход, файлы и состояние — без HTTP. Ревизия базы меньше Store.REV — миграции или отказ с текстом.
function openCore({ dataDir, now = Date.now, fileMaxMb = 20, secureCookie = false, onSeq, backupHour, backupKeep, passwordCostLog2 } = {}) {
  if (!dataDir) throw new Error('Не задана папка данных (CRM_DATA)');
  const clock = () => { const v = now(); return v instanceof Date ? v.getTime() : Number(v); };
  const store = openDb(dataDir);
  try {
    const core = createRuntime();
    const files = createFiles({ store, dataDir, maxBytes: fileMaxMb * 1048576, now: clock });
    let sync = null;
    const personOf = pid => (sync ? sync.personOf(pid) : null);
    const auth = createAuth({ store, now: clock, secureCookie: !!secureCookie, personOf, costLog2: passwordCostLog2 });
    sync = createSync({ store, core, now: clock, files, onSeq: s => onSeq && onSeq(s) });
    if (isEmpty(store)) sync.init();
    else {
      const rev = Number(store.meta.get('rev'));
      if (!Number.isInteger(rev) || store.meta.get('rev') === null) throw new Error('В базе нет ревизии (meta.rev) — это не база CRM или она повреждена. Данные не тронуты.');
      const refusal = migrate(store, rev, core.Store.REV, undefined, core);
      if (refusal) throw new Error(refusal);
    }
    sync.load();
    const backups = createBackups({ store, dataDir, sync, revision: core.Store.REV, core, now: clock, hour: backupHour, keep: backupKeep });
    return { store, core, files, auth, sync, backups, clock };
  } catch (e) {
    store.close();
    throw e;
  }
}

// Действия директора без браузера: завести директора, выдать новый пароль
function adminOf({ sync, auth, backups }) {
  async function createDirector(login, password, name) {
    if (typeof password !== 'string' || [...password].length < PASSWORD_MIN) throw new Error(`Пароль — не короче ${PASSWORD_MIN} символов`);
    const l = auth.normLogin(login);
    if (!l) throw new Error('Логин не задан');
    if (auth.list().some(u => u.login === l)) throw new Error('Такой логин уже занят');
    const personId = sync.system(work => {
      let n = 1;
      while ((work.people || []).some(p => p.id === 'p' + n)) n++;
      const id = 'p' + n;
      work.people = work.people || [];
      work.people.push({ id, name: String(name || '').trim() || l, role: 'director', dept: 'mgmt' });
      return id;
    });
    const r = auth.setLogin(personId, l);
    if (r.status !== 200) throw new Error(r.body.error);
    const p = await auth.issuePassword(personId, password, false);
    if (p.status !== 200) throw new Error(p.body.error);
    return personId;
  }
  async function resetPassword(personId) {
    const r = await auth.issuePassword(personId, generatePassword(), true);
    if (r.status !== 200) throw new Error(r.body.error);
    return r.body.password;
  }
  // Восстановить базу из копии (имя из data/backups или путь к файлу) — то же, что кнопка «Восстановить»
  async function restore(file) { return backups.restore(file); }
  return { createDirector, resetPassword, restore };
}

function send(res, status, body, headers = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': API_CSP,
    'Content-Length': Buffer.byteLength(text), ...headers,
  });
  res.end(text);
}
// Служебные имена объектов JavaScript: ключом, id или productId записи они подменили бы прототип объектов ядра сервера
// (ключ __proto__, записанный в JSON через экранирование символа, JSON.parse делает обычным полем). Обход без рекурсии — глубина любая.
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
function reservedName(value) {
  const stack = [value];
  while (stack.length) {
    const v = stack.pop();
    if (v === null || typeof v !== 'object') continue;
    for (const k of Object.keys(v)) {
      if (RESERVED.has(k)) return true;
      const x = v[k];
      if ((k === 'id' || k === 'productId') && typeof x === 'string' && RESERVED.has(x)) return true;
      if (x !== null && typeof x === 'object') stack.push(x);
    }
  }
  return false;
}
function readJson(req) {
  return new Promise(resolve => {
    const chunks = [];
    let size = 0, over = false;
    req.on('data', c => { size += c.length; if (size > JSON_MAX) over = true; else chunks.push(c); });
    req.on('end', () => {
      if (over) return resolve({ error: [413, 'Слишком большой запрос'] });
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({ value: {} });
      let value;
      try { value = JSON.parse(text); } catch { return resolve({ error: [400, 'Неверные данные: не JSON'] }); }
      if (reservedName(value)) return resolve({ error: [400, 'Неверные данные'] });
      resolve({ value });
    });
    req.on('error', () => resolve({ error: [400, 'Запрос не дошёл до сервера'] }));
  });
}

// passwordCostLog2 — только для тестов: степень двойки для N новых хешей паролей (в работе не задаётся — 17)
async function createApp({ dataDir, port = 3000, host = '127.0.0.1', secureCookie = false, now = Date.now, fileMaxMb = 20, backupHour, backupKeep, passwordCostLog2, update = {} } = {}) {
  const page = serverPage(), pageLite = serverPage(true);
  // Признак версии страницы: после обновления кода он меняется, и открытые вкладки сами перезагружаются (событие build)
  const buildId = crypto.createHash('sha1').update(page).digest('hex').slice(0, 12);
  const pageHeaders = html => ({
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin', 'Content-Security-Policy': pageCsp(html),
  });
  const pageHead = pageHeaders(page), pageLiteHead = pageHeaders(pageLite);
  // Поток событий: сеанс → открытые потоки
  const streams = new Map();
  const write = (res, event, data) => { try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* поток закрыт */ } };
  const broadcast = (event, data) => { for (const set of streams.values()) for (const res of set) write(res, event, data); };
  function bye(tokenHashes) {
    for (const h of tokenHashes || []) {
      for (const res of streams.get(h) || []) { write(res, 'bye', {}); try { res.end(); } catch { /* уже закрыт */ } }
      streams.delete(h);
    }
  }

  const ctx = openCore({ dataDir, now, fileMaxMb, secureCookie, backupHour, backupKeep, passwordCostLog2, onSeq: s => broadcast('seq', s) });
  const { store, core, files, sync, auth, backups, clock } = ctx;
  // После восстановления базы все вкладки перезагружаются, а потоки закрытых сеансов закрываются
  backups.onRestored = ({ closed }) => { broadcast('reload', {}); bye(closed); };
  const closed = list => { sync.sweepViews(list); bye(list); };
  const updater = createUpdater({ appDir: path.join(__dirname, '..'), dataDir, backups, ...update });
  const jobs = createJobs({ sync, core, auth, files, now: clock, onClosed: bye });
  const can = (pid, right) => core.Perms.can(sync.state, pid, right);
  const personView = p => ({ id: p.id, name: p.name, role: p.role });

  async function api(req, res, url) {
    const method = req.method, route = url.pathname;
    if (method === 'POST' && req.headers['x-crm'] !== '1') return send(res, 403, { error: 'Запрос без заголовка X-CRM: 1 не принимается' });
    if (method !== 'GET' && method !== 'POST') return send(res, 405, { error: 'Метод не поддерживается' });
    sync.fresh();

    if (route === '/api/login' && method === 'POST') {
      const b = await readJson(req);
      if (b.error) return send(res, b.error[0], { error: b.error[1] });
      const r = await auth.login(b.value || {}, clientIp(req.socket.remoteAddress, req.headers['x-forwarded-for']));
      return send(res, r.status, r.body, r.cookie ? { 'Set-Cookie': r.cookie } : {});
    }

    const ses = auth.session(req);
    if (!ses) {
      if (route === '/api/files' && method === 'POST') req.resume();
      return send(res, 401, { error: 'Войди заново' }, { 'Set-Cookie': auth.clearCookie() });
    }
    const extra = ses.refresh ? { 'Set-Cookie': ses.refresh } : {};
    const me = sync.personOf(ses.personId);

    if (route === '/api/me' && method === 'GET') return send(res, 200, { person: personView(me), mustChange: ses.mustChange, tag: ses.tag }, extra);
    if (route === '/api/logout' && method === 'POST') {
      closed(auth.closeSession(ses.tokenHash));
      return send(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie() });
    }
    if (route === '/api/password' && method === 'POST') {
      const b = await readJson(req);
      if (b.error) return send(res, b.error[0], { error: b.error[1] });
      const r = await auth.changePassword(ses, b.value || {}, clientIp(req.socket.remoteAddress, req.headers['x-forwarded-for']));
      if (r.closed) closed(r.closed);
      return send(res, r.status, r.body, extra);
    }
    if (ses.mustChange) {
      if (route === '/api/files' && method === 'POST') req.resume();
      return send(res, 403, { error: 'Сначала смени пароль', mustChange: true }, extra);
    }

    if (route === '/api/state' && method === 'GET') return send(res, 200, sync.stateFor(ses), extra);
    if (route === '/api/sync' && method === 'GET') return send(res, 200, sync.syncFor(ses, url.searchParams.get('view') || req.headers['x-crm-view'] || ''), extra);
    if (route === '/api/changes' && method === 'POST') {
      const b = await readJson(req);
      if (b.error) return send(res, b.error[0], { error: b.error[1] });
      const v = b.value || {};
      const r = sync.apply(ses, String(v.view || req.headers['x-crm-view'] || ''), v.changes);
      return send(res, r.status, r.body, extra);
    }
    if (route === '/api/ids' && method === 'POST') {
      const b = await readJson(req);
      if (b.error) return send(res, b.error[0], { error: b.error[1] });
      const ids = sync.takeIds(String((b.value || {}).prefix || ''), (b.value || {}).n);
      return ids ? send(res, 200, { ids }, extra) : send(res, 400, { error: 'Номера с таким началом сервер не выдаёт' }, extra);
    }
    if (route === '/api/events' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', 'Content-Security-Policy': API_CSP, ...extra });
      res.write('retry: 3000\n\n');
      write(res, 'seq', sync.seq);
      write(res, 'build', buildId);
      const set = streams.get(ses.tokenHash) || new Set();
      streams.set(ses.tokenHash, set.add(res));
      req.on('close', () => { set.delete(res); if (!set.size && streams.get(ses.tokenHash) === set) streams.delete(ses.tokenHash); });
      return null;
    }
    if (route === '/api/files' && method === 'POST') {
      const r = await files.upload(req, ses.personId);
      return send(res, r.status, r.body, extra);
    }
    const fileRoute = /^\/api\/files\/([^/]+)$/.exec(route);
    if (fileRoute && method === 'GET') {
      const r = files.download(fileRoute[1], ses.personId, sync.canSee(ses.personId), res);
      return r ? send(res, r.status, r.body, extra) : null;
    }

    // ——— сотрудники: только директор (право admin) ———
    if (route === '/api/users' || route.startsWith('/api/users/')) {
      if (!can(ses.personId, 'admin')) return send(res, 403, { error: 'Нет прав: управлять сотрудниками' }, extra);
      if (route === '/api/users' && method === 'GET') {
        const people = new Map((sync.state.people || []).map(p => [p.id, p]));
        return send(res, 200, { users: auth.list().map(u => ({ ...u, name: (people.get(u.personId) || {}).name || 'нет данных: имя' })) }, extra);
      }
      const m = /^\/api\/users\/([^/]+)\/(login|password|disable|logout)$/.exec(route);
      if (!m || method !== 'POST') return send(res, 404, { error: 'Нет такого адреса' }, extra);
      const pid = decodeURIComponent(m[1]);
      if (!sync.personOf(pid)) return send(res, 404, { error: 'Нет такого сотрудника' }, extra);
      const b = await readJson(req);
      if (b.error) return send(res, b.error[0], { error: b.error[1] });
      const v = b.value || {};
      let r;
      if (m[2] === 'login') r = auth.setLogin(pid, v.login);
      else if (m[2] === 'password') r = await auth.issuePassword(pid);
      else if (m[2] === 'disable') {
        const off = v.disabled !== false;
        if (off && pid === ses.personId) return send(res, 400, { error: 'Себя отключить нельзя' }, extra);
        r = auth.setDisabled(pid, off);
      } else r = { status: 200, body: { personId: pid, closed: 0 }, closed: auth.closePerson(pid) };
      if (r.closed) { closed(r.closed); if (m[2] === 'logout') r.body.closed = r.closed.length; }
      return send(res, r.status, r.body, extra);
    }

    // ——— перенос и копии: только директор (право admin) ———
    const importRoute = /^\/api\/import\/(stock|clients)$/.exec(route);
    if (importRoute || route === '/api/backups' || route.startsWith('/api/backups/') || route.startsWith('/api/update')) {
      if (!can(ses.personId, 'admin')) return send(res, 403, { error: importRoute ? 'Нет прав: переносить данные' : route.startsWith('/api/update') ? 'Нет прав: обновлять CRM' : 'Нет прав: работать с копиями базы' }, extra);
    }
    if (importRoute && method === 'POST') {
      const b = await readJson(req);
      if (b.error) return send(res, b.error[0], { error: b.error[1] });
      // Исполняет та же функция ядра, что считала предпросмотр на экране (Import.apply*); CSV сюда не приходит — только разобранные строки
      try {
        const Import = core.api.Import, rows = (b.value || {}).rows, at = new Date(clock());
        const out = sync.system(work => (importRoute[1] === 'stock' ? Import.applyStock(work, rows, ses.personId, at) : Import.applyClients(work, rows, ses.personId, at)), ses.personId);
        return send(res, 200, out, extra);
      } catch (e) { return send(res, 400, { error: e.message }, extra); }
    }
    if (route === '/api/update' && method === 'GET') return send(res, 200, updater.info(), extra);
    if (route === '/api/update/check' && method === 'POST') {
      try { return send(res, 200, { ...updater.info(), ...(await updater.check()) }, extra); } catch (e) { return send(res, e.status || 500, { error: e.message }, extra); }
    }
    if (route === '/api/update/apply' && method === 'POST') {
      try { return send(res, 200, await updater.apply(), extra); } catch (e) { return send(res, e.status || 500, { error: e.message }, extra); }
    }
    if (route === '/api/backups' && method === 'GET') return send(res, 200, { backups: backups.list(), keep: backups.keep, hour: backups.hour }, extra);
    if (route === '/api/backups' && method === 'POST') {
      try { return send(res, 200, { backup: backups.make('manual') }, extra); } catch (e) { return send(res, e.status || 500, { error: e.message }, extra); }
    }
    const backupRoute = /^\/api\/backups\/([^/]+)(\/restore)?$/.exec(route);
    if (backupRoute) {
      let name;
      try { name = decodeURIComponent(backupRoute[1]); } catch { return send(res, 400, { error: 'Неверное имя копии' }, extra); }
      if (!backups.NAME_RE.test(name)) return send(res, 400, { error: 'Неверное имя копии' }, extra);
      if (!backupRoute[2] && method === 'GET') {
        const file = backups.resolve(name);
        if (!file) return send(res, 404, { error: 'Такой копии нет' }, extra);
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': API_CSP,
          'Content-Length': fs.statSync(file).size, 'Content-Disposition': `attachment; filename="${name}"`, ...extra,
        });
        fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
        return null;
      }
      if (backupRoute[2] && method === 'POST') {
        try { return send(res, 200, { ok: true, ...backups.restore(name) }, extra); } catch (e) { return send(res, e.status || 500, { error: e.message }, extra); }
      }
    }
    return send(res, 404, { error: 'Нет такого адреса' }, extra);
  }

  const server = http.createServer(async (req, res) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return send(res, 400, { error: 'Неверный адрес' }); }
    try {
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        // вошедшему — полная страница, остальным — только форма входа (сеанс проверяется так же, как в API)
        sync.fresh();
        const ses = auth.session(req);
        res.writeHead(200, { ...(ses ? pageHead : pageLiteHead), ...(ses && ses.refresh ? { 'Set-Cookie': ses.refresh } : {}) });
        return res.end(ses ? page : pageLite);
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Security-Policy': API_CSP });
      res.end('Нет такой страницы');
    } catch (e) {
      console.error('Ошибка запроса', req.method, url.pathname + ':', e.message);
      if (!res.headersSent) send(res, 500, { error: 'Ошибка сервера' }); else res.end();
    }
  });

  const heartbeat = setInterval(() => {
    for (const set of streams.values()) for (const res of set) { try { res.write(': ping\n\n'); } catch { /* закрыт */ } }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();
  jobs.start();
  backups.start();

  await new Promise((ok, fail) => { server.once('error', fail); server.listen(port, host, ok); });
  const addr = server.address();
  const url = `http://${addr.family === 'IPv6' ? `[${addr.address}]` : addr.address}:${addr.port}`;

  async function close() {
    jobs.stop();
    backups.stop();
    clearInterval(heartbeat);
    for (const set of streams.values()) for (const res of set) { try { res.end(); } catch { /* закрыт */ } }
    streams.clear();
    await new Promise(ok => { server.close(() => ok()); server.closeAllConnections?.(); });
    store.close();
  }

  return {
    url, close, admin: adminOf({ sync, auth, backups }), backups,
    // для тестов и задач: прогнать минутные задачи сейчас; разослать всем вкладкам «перезагрузись»
    tick: () => jobs.tick(),
    reloadAll: () => broadcast('reload', {}),
  };
}

module.exports = { createApp, openCore, adminOf, serverPage, pageCsp, scriptHashes, clientIp };
