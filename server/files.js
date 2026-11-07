'use strict';
// Файлы на диске сервера: data/files/<id>. В базе — только описание (таблица files) и ссылки записей на файл (file_refs).
// В записи файл — { id, name, type, size, url: '/api/files/<id>', by, at }; фото приёмки — строка url.
// Фото товара (product.photos) — те же файлы: загрузка с заголовком X-File-Kind: photo и привязка к товару проверяют содержимое
// (JPEG, PNG, WebP, GIF по первым байтам), тип в базе — по содержимому, а не по заявленному.
// Скачать может загрузивший и тот, кто видит запись со ссылкой на файл. Удалённый из всех записей файл лежит 30 дней
// (восстановленная копия базы не потеряет его), брошенный — ни разу не прикреплённый — 7 дней.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ID_RE = /^fl[0-9a-f]{24}$/;
const URL_RE = /\/api\/files\/(fl[0-9a-f]{24})/g;
const DAY = 24 * 3600e3;
const ABANDONED_MS = 7 * DAY;
const DELETED_MS = 30 * DAY;
// Показываются в браузере прямо (фото приёмки, PDF); остальное только скачивается
const INLINE = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']);

// Фото: по первым байтам (не по заявленному типу и не по расширению). SVG, HTML и всё прочее — null.
const PHOTO_ONLY = 'Фото товара — только JPEG, PNG, WebP или GIF; этот файл — не такая картинка';
function sniffImage(head) {
  const h = Buffer.from(head);
  if (h.length >= 3 && h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return 'image/jpeg';
  if (h.length >= 8 && h.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  const a = h.subarray(0, 6).toString('latin1');
  if (a === 'GIF87a' || a === 'GIF89a') return 'image/gif';
  if (h.length >= 12 && h.subarray(0, 4).toString('latin1') === 'RIFF' && h.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}
function sniffFile(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(12);
    const n = fs.readSync(fd, buf, 0, 12, 0);
    return sniffImage(buf.subarray(0, n));
  } catch { return null; } finally { if (fd !== undefined) fs.closeSync(fd); }
}
const cleanName = s => String(s || '').replace(/[\u0000-\u001f\u007f/\\]/g, '_').trim().slice(0, 200) || 'файл';
const cleanType = s => { const t = String(s || '').split(';')[0].trim().toLowerCase(); return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(t) ? t : 'application/octet-stream'; };
// Адрес файла сервера целиком: иначе строка с javascript: или кавычкой стала бы ссылкой или src картинки в браузере
const FILE_URL_RE = /^\/api\/files\/fl[0-9a-f]{24}$/;
const fileUrl = u => typeof u === 'string' && FILE_URL_RE.test(u);
// Каждый файл записи (поле files на любой глубине) — с адресом файла сервера, каждое фото приёмки (received.urls) — адрес
function urlsOk(value) {
  const stack = [value];
  while (stack.length) {
    const v = stack.pop();
    if (v === null || typeof v !== 'object') continue;
    if (Array.isArray(v.files) && !v.files.every(f => f && typeof f === 'object' && fileUrl(f.url))) return false;
    if (v.received && typeof v.received === 'object' && Array.isArray(v.received.urls) && !v.received.urls.every(fileUrl)) return false;
    for (const x of Object.values(v)) if (x !== null && typeof x === 'object') stack.push(x);
  }
  return true;
}
// Файлы, на которые ссылается значение документа
function idsIn(value) {
  const out = new Set();
  if (value === null || value === undefined) return out;
  for (const m of JSON.stringify(value).matchAll(URL_RE)) out.add(m[1]);
  return out;
}

// store — server/db.js; now() → мс; maxBytes — предел файла
function createFiles({ store, dataDir, maxBytes, now }) {
  const dir = path.join(dataDir, 'files');
  fs.mkdirSync(dir, { recursive: true });
  const q = store.prepare;
  const S = {
    add: q('INSERT INTO files (id, name, type, size, by, at, deletedAt) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    get: q('SELECT id, name, type, size, by, at, deletedAt FROM files WHERE id = ?'),
    refsOf: q('SELECT key, docId FROM file_refs WHERE fileId = ?'),
    refsOfDoc: q('SELECT fileId FROM file_refs WHERE key = ? AND docId = ?'),
    refDel: q('DELETE FROM file_refs WHERE key = ? AND docId = ?'),
    refAdd: q('INSERT OR IGNORE INTO file_refs (fileId, key, docId) VALUES (?, ?, ?)'),
    refCount: q('SELECT COUNT(*) AS n FROM file_refs WHERE fileId = ?'),
    mark: q('UPDATE files SET deletedAt = ? WHERE id = ?'),
    stale: q(`SELECT id FROM files WHERE NOT EXISTS (SELECT 1 FROM file_refs r WHERE r.fileId = files.id)
      AND ((deletedAt IS NULL AND at < ?) OR (deletedAt IS NOT NULL AND deletedAt < ?))`),
    del: q('DELETE FROM files WHERE id = ?'),
  };
  const mb = Math.round(maxBytes / 1048576);
  const TOO_BIG = `Файл больше ${mb} МБ — не загружен`;
  const fileOf = id => path.join(dir, id);

  // Загрузка: тело запроса — сам файл, имя — заголовок X-File-Name (encodeURIComponent). → {status, body}
  function upload(req, personId) {
    return new Promise(resolve => {
      const declared = Number(req.headers['content-length']);
      if (declared > maxBytes) { req.resume(); return resolve({ status: 413, body: { error: TOO_BIG } }); }
      let name;
      try { name = cleanName(decodeURIComponent(String(req.headers['x-file-name'] || ''))); } catch { name = cleanName(req.headers['x-file-name']); }
      const photo = String(req.headers['x-file-kind'] || '') === 'photo';
      let type = cleanType(req.headers['content-type']);
      const id = 'fl' + crypto.randomBytes(12).toString('hex');
      const part = fileOf(id) + '.part';
      const out = fs.createWriteStream(part, { flags: 'wx' });
      let size = 0, failed = false;
      const fail = (status, error) => {
        if (failed) return;
        failed = true;
        req.unpipe(out);
        out.destroy();
        fs.rm(part, { force: true }, () => resolve({ status, body: { error } }));
        req.resume();
      };
      req.on('data', chunk => { size += chunk.length; if (size > maxBytes) fail(413, TOO_BIG); });
      req.on('error', () => fail(400, 'Файл не дошёл до сервера — повтори'));
      out.on('error', () => fail(500, 'Не удалось сохранить файл на сервере'));
      out.on('finish', () => {
        if (failed) return;
        try {
          if (photo) {
            const real = sniffFile(part);
            if (!real) { fs.rmSync(part, { force: true }); return resolve({ status: 415, body: { error: PHOTO_ONLY } }); }
            type = real;
          }
          fs.renameSync(part, fileOf(id));
          const at = now();
          S.add.run(id, name, type, size, personId, at, null);
          resolve({ status: 200, body: { id, name, type, size, url: '/api/files/' + id } });
        } catch {
          fs.rm(part, { force: true }, () => {});
          resolve({ status: 500, body: { error: 'Не удалось сохранить файл на сервере' } });
        }
      });
      req.pipe(out);
    });
  }

  // Может ли человек скачать файл: загрузил сам или видит запись, которая на него ссылается (canSee(key, docId))
  function canRead(f, personId, canSee) {
    if (!f) return false;
    if (f.by === personId) return true;
    return S.refsOf.all(f.id).some(r => canSee(r.key, r.docId));
  }

  // GET /api/files/:id → отдаёт файл в res или {status, body}
  function download(id, personId, canSee, res) {
    if (!ID_RE.test(id)) return { status: 404, body: { error: 'Файл не найден' } };
    const f = S.get.get(id);
    if (!f) return { status: 404, body: { error: 'Файл не найден' } };
    if (!canRead(f, personId, canSee)) return { status: 403, body: { error: 'Нет доступа' } };
    const file = fileOf(id);
    if (!fs.existsSync(file)) return { status: 404, body: { error: 'Файл не найден' } };
    const inline = INLINE.has(f.type);
    res.writeHead(200, {
      'Content-Type': inline ? f.type : 'application/octet-stream',
      'Content-Length': fs.statSync(file).size,
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, max-age=86400',
    });
    fs.createReadStream(file).pipe(res);
    return null;
  }

  // Новые ссылки пачки на файлы: можно ссылаться только на свой файл или на тот, что человек уже видит.
  // Адрес файла в записи (files[].url, received.urls[]) — только адрес файла этого сервера.
  // changes — после слияния; → null или {key, id, text}
  function checkRefs(changes, personId, canSee) {
    for (const c of changes) {
      if (c.deleted) continue;
      if (!urlsOk(c.data)) return { key: c.key, id: c.id, text: 'Нет прав: адрес файла в записи — только адрес файла, загруженного на сервер CRM' };
      const had = new Set(S.refsOfDoc.all(c.key, String(c.id)).map(r => r.fileId));
      const photos = c.key === 'products' && c.data && Array.isArray(c.data.photos) ? idsIn(c.data.photos) : new Set();
      for (const id of idsIn(c.data)) {
        if (had.has(id)) continue;
        if (!canRead(S.get.get(id), personId, canSee)) return { key: c.key, id: c.id, text: 'Нет прав: прикрепить чужой или несуществующий файл' };
        if (photos.has(id) && !sniffFile(fileOf(id))) return { key: c.key, id: c.id, text: 'Нет прав: ' + PHOTO_ONLY.charAt(0).toLowerCase() + PHOTO_ONLY.slice(1) };
      }
    }
    return null;
  }

  // Ссылки документа заново — внутри транзакции записи пачки. Файл без ссылок помечается удалённым.
  function refresh(key, docId, data) {
    const before = S.refsOfDoc.all(key, docId).map(r => r.fileId);
    S.refDel.run(key, docId);
    const ids = idsIn(data);
    for (const id of ids) {
      if (!S.get.get(id)) continue;
      S.refAdd.run(id, key, docId);
      S.mark.run(null, id);
    }
    const t = now();
    for (const id of before) if (!ids.has(id) && S.refCount.get(id).n === 0) S.mark.run(t, id);
  }

  // Обслуживание: стереть брошенные старше 7 дней и удалённые из записей больше 30 дней назад. → сколько стёрто
  function sweep() {
    const t = now();
    let n = 0;
    for (const { id } of S.stale.all(t - ABANDONED_MS, t - DELETED_MS)) {
      fs.rmSync(fileOf(id), { force: true });
      S.del.run(id);
      n++;
    }
    return n;
  }

  return { upload, download, checkRefs, refresh, sweep, idsIn, TOO_BIG };
}

module.exports = { createFiles, idsIn };
