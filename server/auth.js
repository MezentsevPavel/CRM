'use strict';
// Вход, пароли и сеансы.
// Пароль хранится только как scrypt-хеш с собственной солью (таблица users) и сравнивается за постоянное время.
// Токен сеанса — 32 случайных байта; в cookie crm_sid — сам токен, в базе — только его sha256.
// Неверный логин и неверный пароль — один и тот же ответ и та же работа (scrypt по подставной соли), чтобы
// по ответу и по времени нельзя было узнать, есть ли такой логин.
// Пароль — scrypt N=2^17, r=8, p=1 (около 0,3 с и 128 МБ на проверку); параметры записаны в самой строке хеша
// («scrypt$131072$8$1$<hex>»), поэтому прежние хеши (без приставки, N=2^14) продолжают проверяться, а при удачном входе пароль
// записывается заново текущими параметрами.
// Попытки считаются по компьютеру (адрес клиента, его определяет server/app.js): 5 неудач с одного адреса по одному логину за
// 15 минут закрывают этому адресу вход под этим логином, 20 неудач с адреса по любым логинам — вход с адреса целиком.
// С другого адреса тот же логин входит: чужими неудачами директора не запереть.
// Ни хеш, ни соль, ни токен не попадают в ответы, состояние и журналы.

const crypto = require('node:crypto');

const COOKIE = 'crm_sid';
const KEYLEN = 64;
// Текущие параметры хеша и прежние (хеш без приставки). maxmem с запасом: scrypt занимает 128·N·r байт (при N=2^17 — ровно 128 МБ)
const COST_LOG2 = 17;
const LEGACY = { N: 16384, r: 8, p: 1 };
const MAXMEM = 256 * 1024 * 1024;
const FAIL_MAX = 5;
const IP_FAIL_MAX = 20;
const LOCK_MS = 15 * 60e3;
const FOREIGN_MS = 12 * 3600e3;
const LONG_MS = 30 * 24 * 3600e3;
const TOUCH_MS = 60e3;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 256;
const LOGIN_MAX = 64;
const BAD_LOGIN = 'Неверный логин или пароль';
// без похожих друг на друга знаков: 0/O, 1/l/I
const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const scrypt = (password, salt, { N, r, p }) => new Promise((ok, fail) => {
  crypto.scrypt(String(password).normalize('NFC'), salt, KEYLEN, { N, r, p, maxmem: MAXMEM }, (e, key) => (e ? fail(e) : ok(key)));
});
// Строка хеша → { params, hex }. Без приставки — прежний хеш (N=2^14); приставка с чужими или нелепыми параметрами — null.
function parseHash(text) {
  const t = String(text || '');
  if (!t.startsWith('scrypt$')) return /^[0-9a-f]+$/.test(t) ? { params: LEGACY, hex: t, legacy: true } : null;
  const [, n, r, p, hex] = t.split('$');
  const params = { N: Number(n), r: Number(r), p: Number(p) };
  const ok = Number.isInteger(params.N) && params.N >= 1024 && params.N <= 2 ** 20 && (params.N & (params.N - 1)) === 0
    && Number.isInteger(params.r) && params.r >= 1 && params.r <= 16 && Number.isInteger(params.p) && params.p >= 1 && params.p <= 4;
  return ok && /^[0-9a-f]+$/.test(hex || '') ? { params, hex, legacy: false } : null;
}
// Хеш записан не текущими параметрами — при удачном входе его надо записать заново
function needsRehash(text, costLog2 = COST_LOG2) {
  const h = parseHash(text);
  return !h || h.params.N !== 2 ** costLog2 || h.params.r !== 8 || h.params.p !== 1;
}
// costLog2 — степень двойки для N; в работе всегда COST_LOG2, меньше его берут только тесты (иначе набор тестов считал бы часами)
async function hashPassword(password, costLog2 = COST_LOG2) {
  const salt = crypto.randomBytes(16);
  const params = { N: 2 ** costLog2, r: 8, p: 1 };
  const key = await scrypt(password, salt, params);
  return { hash: `scrypt$${params.N}$${params.r}$${params.p}$${key.toString('hex')}`, salt: salt.toString('hex') };
}
async function verifyPassword(password, hash, saltHex) {
  const h = parseHash(hash);
  if (!h) return false;
  const key = await scrypt(password, Buffer.from(saltHex, 'hex'), h.params);
  const want = Buffer.from(h.hex, 'hex');
  return want.length === key.length && crypto.timingSafeEqual(key, want);
}
// Подставная пара для несуществующего логина: та же работа scrypt, результат всегда «нет»
const makeDummy = costLog2 => ({
  hash: `scrypt$${2 ** costLog2}$8$1$${crypto.randomBytes(KEYLEN).toString('hex')}`,
  salt: crypto.randomBytes(16).toString('hex'),
});

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const normLogin = s => (typeof s === 'string' ? s.trim().toLowerCase() : '');
const validLogin = s => !!s && s.length <= LOGIN_MAX && /^[^\s]+$/.test(s);
function generatePassword(len = 12) {
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}
function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

// store — server/db.js; now() → мс; personOf(personId) → человек из состояния или null
// costLog2 — степень двойки для N новых хешей (по умолчанию 17; тесты берут меньше)
function createAuth({ store, now, secureCookie, personOf, costLog2 = COST_LOG2 }) {
  const q = store.prepare;
  const DUMMY = makeDummy(costLog2);
  const S = {
    user: q('SELECT personId, login, hash, salt, mustChange, disabled FROM users WHERE login = ?'),
    userOf: q('SELECT personId, login, hash, salt, mustChange, disabled FROM users WHERE personId = ?'),
    users: q('SELECT personId, login, mustChange, disabled, hash IS NOT NULL AS hasPassword FROM users'),
    userAdd: q('INSERT INTO users (personId, login) VALUES (?, ?)'),
    userLogin: q('UPDATE users SET login = ? WHERE personId = ?'),
    userPass: q('UPDATE users SET hash = ?, salt = ?, mustChange = ? WHERE personId = ?'),
    userDisabled: q('UPDATE users SET disabled = ? WHERE personId = ?'),
    fails: q('SELECT at FROM attempts WHERE login = ? AND ip = ? AND at > ? ORDER BY at DESC'),
    ipFails: q('SELECT at FROM attempts WHERE ip = ? AND at > ? ORDER BY at DESC'),
    failAdd: q('INSERT INTO attempts (login, ip, at) VALUES (?, ?, ?)'),
    // «Простить» логин: его неудачи перестают считаться по логину, но остаются в счёте адреса (login = '' — ничей).
    // Удалять их нельзя: иначе удачный вход под своей учёткой обнулял бы счёт адреса.
    failForgive: q("UPDATE attempts SET login = '' WHERE login = ? AND ip = ?"),
    failForgiveAll: q("UPDATE attempts SET login = '' WHERE login = ?"),
    failOld: q('DELETE FROM attempts WHERE at < ?'),
    sesAdd: q('INSERT INTO sessions (tokenHash, personId, tag, createdAt, lastSeen, expiresAt, "foreign") VALUES (?, ?, ?, ?, ?, ?, ?)'),
    ses: q('SELECT tokenHash, personId, tag, createdAt, lastSeen, expiresAt, "foreign" AS isForeign FROM sessions WHERE tokenHash = ?'),
    sesTouch: q('UPDATE sessions SET lastSeen = ?, expiresAt = ? WHERE tokenHash = ?'),
    sesDel: q('DELETE FROM sessions WHERE tokenHash = ?'),
    sesOfPerson: q('SELECT tokenHash FROM sessions WHERE personId = ?'),
    sesDelPerson: q('DELETE FROM sessions WHERE personId = ?'),
    sesCount: q('SELECT personId, COUNT(*) AS n FROM sessions WHERE expiresAt > ? GROUP BY personId'),
    sesExpired: q('SELECT tokenHash FROM sessions WHERE expiresAt <= ?'),
    sesDelExpired: q('DELETE FROM sessions WHERE expiresAt <= ?'),
  };

  const cookie = (token, foreign) => [
    `${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax',
    ...(secureCookie ? ['Secure'] : []),
    ...(foreign ? [] : [`Max-Age=${Math.floor(LONG_MS / 1000)}`]),
  ].join('; ');
  const clearCookie = () => [`${COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', ...(secureCookie ? ['Secure'] : []), 'Max-Age=0'].join('; ');

  // Проверки пароля, которые идут прямо сейчас: параллельные попытки считаются, как если бы уже не удались
  const pending = new Map();
  const busy = (key, d) => { const n = (pending.get(key) || 0) + d; if (n > 0) pending.set(key, n); else pending.delete(key); };
  const addrOf = ip => String(ip || '').slice(0, 64);
  const pairKey = (l, addr) => 'p\u0001' + addr + '\u0001' + l;
  const ipKey = addr => 'i\u0001' + addr;
  // Сколько минут ждать, если неудач (rows — их время, от новых к старым, за последние 15 минут; ещё не завершённые проверки
  // считаются неудачами) набралось max и больше. Замок снимается, когда неудач снова станет меньше max (0 — можно)
  function waitFor(rows, inFlight, max, t) {
    if (rows.length + inFlight < max) return 0;
    const edge = rows.length >= max ? rows[max - 1].at : (rows.length ? rows[0].at : t);
    return Math.max(1, Math.ceil((edge + LOCK_MS - t) / 60e3));
  }
  // Сколько минут ждать до следующей попытки входа с адреса addr под логином login (0 — можно)
  function lockedFor(login, addr, t) {
    const byAddr = waitFor(S.ipFails.all(addr, t - LOCK_MS), pending.get(ipKey(addr)) || 0, IP_FAIL_MAX, t);
    const byPair = login ? waitFor(S.fails.all(login, addr, t - LOCK_MS), pending.get(pairKey(login, addr)) || 0, FAIL_MAX, t) : 0;
    return Math.max(byAddr, byPair);
  }
  const tooMany = min => ({ status: 429, body: { error: `Слишком много попыток, попробуй через ${min} мин`, retryMin: min } });

  // Метка сеанса: короткая и уникальная навсегда (счётчик в meta) — из неё браузер строит свои внутренние id
  function nextTag() {
    const n = store.meta.num('tags') + 1;
    store.meta.set('tags', n);
    return 'k' + n.toString(36);
  }
  function openSession(personId, foreign) {
    const token = crypto.randomBytes(32).toString('base64url');
    const t = now();
    S.sesAdd.run(sha256(token), personId, nextTag(), t, t, t + (foreign ? FOREIGN_MS : LONG_MS), foreign ? 1 : 0);
    return token;
  }

  async function login({ login: rawLogin, password, foreign }, ip) {
    const l = normLogin(rawLogin);
    const addr = addrOf(ip);
    const t = now();
    const counted = !!l && l.length <= LOGIN_MAX;
    const wait = lockedFor(counted ? l : '', addr, t);
    if (wait) return tooMany(wait);
    const pw = typeof password === 'string' && password.length <= PASSWORD_MAX ? password : '';
    const u = counted ? S.user.get(l) : undefined;
    const usable = !!(u && u.hash && u.salt && !u.disabled && personOf(u.personId));
    const keys = counted ? [ipKey(addr), pairKey(l, addr)] : [ipKey(addr)];
    for (const k of keys) busy(k, 1);
    let match = false;
    try {
      match = await verifyPassword(pw, usable ? u.hash : DUMMY.hash, usable ? u.salt : DUMMY.salt);
      // Прежний хеш считается в разы быстрее нового: без добавки по времени было бы видно, что такой логин есть
      if (usable && !match && needsRehash(u.hash, costLog2)) await verifyPassword(pw, DUMMY.hash, DUMMY.salt);
    } finally { for (const k of keys) busy(k, -1); }
    if (!(usable && match && pw)) {
      S.failAdd.run(counted ? l : '', addr, now());
      return { status: 401, body: { error: BAD_LOGIN } };
    }
    S.failForgive.run(l, addr);
    // Пароль верен, а хеш записан прежними параметрами — записать заново текущими
    if (needsRehash(u.hash, costLog2)) {
      const h = await hashPassword(pw, costLog2);
      S.userPass.run(h.hash, h.salt, u.mustChange ? 1 : 0, u.personId);
    }
    const token = openSession(u.personId, !!foreign);
    const p = personOf(u.personId);
    return {
      status: 200, cookie: cookie(token, !!foreign),
      body: { person: { id: p.id, name: p.name, role: p.role }, mustChange: !!u.mustChange },
    };
  }

  // Сеанс запроса по cookie или null. Долгий сеанс продлевается: 30 дней с последнего захода.
  function session(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const row = S.ses.get(sha256(token));
    const t = now();
    if (!row || row.expiresAt <= t) return null;
    const u = S.userOf.get(row.personId);
    if (!u || u.disabled || !personOf(row.personId)) return null;
    let refresh = null;
    if (!row.isForeign && t - row.lastSeen >= TOUCH_MS) {
      S.sesTouch.run(t, t + LONG_MS, row.tokenHash);
      refresh = cookie(token, false);
    }
    return { tokenHash: row.tokenHash, personId: row.personId, tag: row.tag, foreign: !!row.isForeign, mustChange: !!u.mustChange, refresh };
  }

  const closeSession = tokenHash => { S.sesDel.run(tokenHash); return [tokenHash]; };
  function closePerson(personId) {
    const list = S.sesOfPerson.all(personId).map(r => r.tokenHash);
    S.sesDelPerson.run(personId);
    return list;
  }

  async function changePassword(ses, { old, password } = {}, ip) {
    const u = S.userOf.get(ses.personId);
    if (!u || !u.hash) return { status: 400, body: { error: 'Пароль не задан — попроси директора выдать новый' } };
    const addr = addrOf(ip);
    const t = now();
    const wait = lockedFor(u.login, addr, t);
    if (wait) return tooMany(wait);
    const keys = [ipKey(addr), pairKey(u.login, addr)];
    for (const k of keys) busy(k, 1);
    let ok = false;
    try { ok = typeof old === 'string' && old.length <= PASSWORD_MAX && await verifyPassword(old, u.hash, u.salt); }
    finally { for (const k of keys) busy(k, -1); }
    if (!ok) {
      S.failAdd.run(u.login, addr, now());
      return { status: 400, body: { error: 'Старый пароль неверный' } };
    }
    if (typeof password !== 'string' || [...password].length < PASSWORD_MIN) {
      return { status: 400, body: { error: `Новый пароль — не короче ${PASSWORD_MIN} символов` } };
    }
    if (password.length > PASSWORD_MAX) return { status: 400, body: { error: `Новый пароль — не длиннее ${PASSWORD_MAX} символов` } };
    const h = await hashPassword(password, costLog2);
    S.userPass.run(h.hash, h.salt, 0, ses.personId);
    S.failForgive.run(u.login, addr);
    // остальные сеансы этого человека закрываются: новый пароль — новый вход везде, кроме этого окна
    const others = S.sesOfPerson.all(ses.personId).map(r => r.tokenHash).filter(h2 => h2 !== ses.tokenHash);
    for (const x of others) S.sesDel.run(x);
    return { status: 200, body: { ok: true }, closed: others };
  }

  // ——— сотрудники (директор) ———
  function setLogin(personId, rawLogin) {
    const l = normLogin(rawLogin);
    if (!validLogin(l)) return { status: 400, body: { error: `Логин — без пробелов, от 1 до ${LOGIN_MAX} символов` } };
    const taken = S.user.get(l);
    if (taken && taken.personId !== personId) return { status: 400, body: { error: 'Такой логин уже занят' } };
    if (S.userOf.get(personId)) S.userLogin.run(l, personId); else S.userAdd.run(personId, l);
    return { status: 200, body: { personId, login: l } };
  }
  // Новый пароль: показывается один раз в ответе; при входе его надо сменить; прежние сеансы закрываются
  async function issuePassword(personId, password = generatePassword(), mustChange = true) {
    const u = S.userOf.get(personId);
    if (!u || !u.login) return { status: 400, body: { error: 'Сначала задай логин' } };
    const h = await hashPassword(password, costLog2);
    S.userPass.run(h.hash, h.salt, mustChange ? 1 : 0, personId);
    S.failForgiveAll.run(u.login);
    const closed = closePerson(personId);
    return { status: 200, body: { personId, login: u.login, password }, closed };
  }
  function setDisabled(personId, disabled) {
    if (!S.userOf.get(personId)) return { status: 400, body: { error: 'У сотрудника нет логина' } };
    S.userDisabled.run(disabled ? 1 : 0, personId);
    const closed = disabled ? closePerson(personId) : [];
    return { status: 200, body: { personId, disabled: !!disabled }, closed };
  }
  function list() {
    const counts = new Map(S.sesCount.all(now()).map(r => [r.personId, r.n]));
    return S.users.all().map(u => ({
      personId: u.personId, login: u.login, hasPassword: !!u.hasPassword, mustChange: !!u.mustChange, disabled: !!u.disabled,
      sessions: counts.get(u.personId) || 0,
    }));
  }
  const userOf = personId => { const u = S.userOf.get(personId); return u ? { personId: u.personId, login: u.login, disabled: !!u.disabled } : null; };

  // Обслуживание: истёкшие сеансы и старые попытки входа. → закрытые сеансы (tokenHash)
  function sweep() {
    const t = now();
    const gone = S.sesExpired.all(t).map(r => r.tokenHash);
    S.sesDelExpired.run(t);
    S.failOld.run(t - 24 * 3600e3);
    return gone;
  }

  return {
    COOKIE, login, session, clearCookie, closeSession, closePerson, changePassword,
    setLogin, issuePassword, setDisabled, list, userOf, sweep, normLogin,
  };
}

module.exports = { createAuth, hashPassword, verifyPassword, needsRehash, generatePassword, PASSWORD_MIN, BAD_LOGIN, COST_LOG2 };
