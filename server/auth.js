'use strict';
// Вход, пароли и сеансы.
// Пароль хранится только как scrypt-хеш с собственной солью (таблица users) и сравнивается за постоянное время.
// Токен сеанса — 32 случайных байта; в cookie crm_sid — сам токен, в базе — только его sha256.
// Неверный логин и неверный пароль — один и тот же ответ и та же работа (scrypt по подставной соли), чтобы
// по ответу и по времени нельзя было узнать, есть ли такой логин. 5 неудач по логину за 15 минут — пауза 15 минут.
// Ни хеш, ни соль, ни токен не попадают в ответы, состояние и журналы.

const crypto = require('node:crypto');

const COOKIE = 'crm_sid';
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 64;
const FAIL_MAX = 5;
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

const scrypt = (password, salt) => new Promise((ok, fail) => {
  crypto.scrypt(String(password).normalize('NFC'), salt, KEYLEN, SCRYPT, (e, key) => (e ? fail(e) : ok(key)));
});
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt);
  return { hash: key.toString('hex'), salt: salt.toString('hex') };
}
async function verifyPassword(password, hashHex, saltHex) {
  const key = await scrypt(password, Buffer.from(saltHex, 'hex'));
  const want = Buffer.from(hashHex, 'hex');
  return want.length === key.length && crypto.timingSafeEqual(key, want);
}
// Подставная пара для несуществующего логина: та же работа scrypt, результат всегда «нет»
const DUMMY = { hash: crypto.randomBytes(KEYLEN).toString('hex'), salt: crypto.randomBytes(16).toString('hex') };

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
function createAuth({ store, now, secureCookie, personOf }) {
  const q = store.prepare;
  const S = {
    user: q('SELECT personId, login, hash, salt, mustChange, disabled FROM users WHERE login = ?'),
    userOf: q('SELECT personId, login, hash, salt, mustChange, disabled FROM users WHERE personId = ?'),
    users: q('SELECT personId, login, mustChange, disabled, hash IS NOT NULL AS hasPassword FROM users'),
    userAdd: q('INSERT INTO users (personId, login) VALUES (?, ?)'),
    userLogin: q('UPDATE users SET login = ? WHERE personId = ?'),
    userPass: q('UPDATE users SET hash = ?, salt = ?, mustChange = ? WHERE personId = ?'),
    userDisabled: q('UPDATE users SET disabled = ? WHERE personId = ?'),
    fails: q('SELECT at FROM attempts WHERE login = ? AND at > ? ORDER BY at DESC'),
    failAdd: q('INSERT INTO attempts (login, ip, at) VALUES (?, ?, ?)'),
    failClear: q('DELETE FROM attempts WHERE login = ?'),
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
  const busy = (l, d) => { const n = (pending.get(l) || 0) + d; if (n > 0) pending.set(l, n); else pending.delete(l); };
  // Сколько минут ждать до следующей попытки (0 — можно)
  function lockedFor(login, t) {
    const rows = S.fails.all(login, t - LOCK_MS);
    if (rows.length + (pending.get(login) || 0) < FAIL_MAX) return 0;
    const last = rows.length ? rows[0].at : t;
    return Math.max(1, Math.ceil((last + LOCK_MS - t) / 60e3));
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
    const t = now();
    if (l && l.length <= LOGIN_MAX) {
      const wait = lockedFor(l, t);
      if (wait) return tooMany(wait);
    }
    const pw = typeof password === 'string' && password.length <= PASSWORD_MAX ? password : '';
    const u = l && l.length <= LOGIN_MAX ? S.user.get(l) : undefined;
    const usable = !!(u && u.hash && u.salt && !u.disabled && personOf(u.personId));
    const counted = l && l.length <= LOGIN_MAX;
    if (counted) busy(l, 1);
    let match = false;
    try { match = await verifyPassword(pw, usable ? u.hash : DUMMY.hash, usable ? u.salt : DUMMY.salt); }
    finally { if (counted) busy(l, -1); }
    if (!(usable && match && pw)) {
      if (l && l.length <= LOGIN_MAX) S.failAdd.run(l, String(ip || '').slice(0, 64), now());
      return { status: 401, body: { error: BAD_LOGIN } };
    }
    S.failClear.run(l);
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

  async function changePassword(ses, { old, password } = {}) {
    const u = S.userOf.get(ses.personId);
    if (!u || !u.hash) return { status: 400, body: { error: 'Пароль не задан — попроси директора выдать новый' } };
    const t = now();
    const wait = lockedFor(u.login, t);
    if (wait) return tooMany(wait);
    busy(u.login, 1);
    let ok = false;
    try { ok = typeof old === 'string' && old.length <= PASSWORD_MAX && await verifyPassword(old, u.hash, u.salt); }
    finally { busy(u.login, -1); }
    if (!ok) {
      S.failAdd.run(u.login, '', now());
      return { status: 400, body: { error: 'Старый пароль неверный' } };
    }
    if (typeof password !== 'string' || [...password].length < PASSWORD_MIN) {
      return { status: 400, body: { error: `Новый пароль — не короче ${PASSWORD_MIN} символов` } };
    }
    if (password.length > PASSWORD_MAX) return { status: 400, body: { error: `Новый пароль — не длиннее ${PASSWORD_MAX} символов` } };
    const h = await hashPassword(password);
    S.userPass.run(h.hash, h.salt, 0, ses.personId);
    S.failClear.run(u.login);
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
    const h = await hashPassword(password);
    S.userPass.run(h.hash, h.salt, mustChange ? 1 : 0, personId);
    S.failClear.run(u.login);
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

module.exports = { createAuth, hashPassword, verifyPassword, generatePassword, PASSWORD_MIN, BAD_LOGIN };
