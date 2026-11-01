'use strict';
// База сервера — один файл SQLite (node:sqlite). Здесь только таблицы и запросы; что в них класть, решают auth, sync, files.
//   docs(key, id, data, ver, seq)  — документы общего состояния (Docs.split): data — JSON документа
//   meta(k, v)                     — seq (номер последней проведённой пачки), rev (ревизия формы записей), счётчики номеров
//   users(personId, login, hash, salt, mustChange, disabled) — вход; пароль — только scrypt-хеш с солью
//   sessions(tokenHash, personId, tag, createdAt, lastSeen, expiresAt, foreign) — в базе только sha256 токена
//   files(id, name, type, size, by, at, deletedAt), file_refs(fileId, key, docId) — файлы на диске и кто на них ссылается
//   log(seq, at, personId, key, docId, op) — журнал правок: кто, когда, что
//   attempts(login, ip, at)        — неудачные попытки входа (предел попыток)

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS docs (key TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, ver INTEGER NOT NULL, seq INTEGER NOT NULL, PRIMARY KEY (key, id));
CREATE TABLE IF NOT EXISTS users (personId TEXT PRIMARY KEY, login TEXT UNIQUE, hash TEXT, salt TEXT, mustChange INTEGER NOT NULL DEFAULT 0, disabled INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions (tokenHash TEXT PRIMARY KEY, personId TEXT NOT NULL, tag TEXT NOT NULL, createdAt INTEGER NOT NULL, lastSeen INTEGER NOT NULL, expiresAt INTEGER NOT NULL, "foreign" INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS sessions_person ON sessions(personId);
CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, size INTEGER NOT NULL, by TEXT, at INTEGER NOT NULL, deletedAt INTEGER);
CREATE TABLE IF NOT EXISTS file_refs (fileId TEXT NOT NULL, key TEXT NOT NULL, docId TEXT NOT NULL, PRIMARY KEY (fileId, key, docId));
CREATE INDEX IF NOT EXISTS file_refs_doc ON file_refs(key, docId);
CREATE TABLE IF NOT EXISTS log (n INTEGER PRIMARY KEY AUTOINCREMENT, seq INTEGER NOT NULL, at INTEGER NOT NULL, personId TEXT, key TEXT NOT NULL, docId TEXT NOT NULL, op TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS log_doc ON log(key, docId);
CREATE TABLE IF NOT EXISTS attempts (login TEXT NOT NULL, ip TEXT, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS attempts_login ON attempts(login, at);
`;

function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'crm.db');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  const q = sql => db.prepare(sql);
  const st = {
    metaGet: q('SELECT v FROM meta WHERE k = ?'),
    metaSet: q('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v'),
    docsAll: q('SELECT key, id, data FROM docs'),
    docsCount: q('SELECT COUNT(*) AS n FROM docs'),
    docPut: q(`INSERT INTO docs (key, id, data, ver, seq) VALUES (?, ?, ?, 1, ?)
      ON CONFLICT(key, id) DO UPDATE SET data = excluded.data, ver = docs.ver + 1, seq = excluded.seq`),
    docDel: q('DELETE FROM docs WHERE key = ? AND id = ?'),
    logAdd: q('INSERT INTO log (seq, at, personId, key, docId, op) VALUES (?, ?, ?, ?, ?, ?)'),
    logLast: q('SELECT personId FROM log WHERE key = ? AND docId = ? ORDER BY n DESC LIMIT 1'),
  };

  // Всё или ничего: fn внутри одной транзакции записи
  function tx(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch { /* транзакция уже закрыта */ }
      throw e;
    }
  }

  const meta = {
    get: k => { const r = st.metaGet.get(k); return r ? r.v : null; },
    set: (k, v) => st.metaSet.run(k, String(v)),
    num: k => { const r = st.metaGet.get(k); return r ? Number(r.v) || 0 : 0; },
  };

  return {
    db, file, tx, meta, prepare: q,
    docs: {
      all: () => st.docsAll.all(),
      count: () => st.docsCount.get().n,
      put: (key, id, data, seq) => st.docPut.run(key, id, data, seq),
      del: (key, id) => st.docDel.run(key, id),
    },
    log: {
      add: (seq, at, personId, key, docId, op) => st.logAdd.run(seq, at, personId, key, docId, op),
      lastBy: (key, docId) => { const r = st.logLast.get(key, docId); return r ? r.personId : null; },
    },
    close: () => { try { db.close(); } catch { /* уже закрыта */ } },
  };
}

module.exports = { openDb };
