'use strict';
// Сервер: файлы (таск 02, R06). Ожидаемое — из критериев таска и spec.md («Файлы»): в базе только описание, 20 МБ,
// «Файл больше N МБ — не загружен», скачивает загрузивший или видящий запись, 7 дней брошенному, 30 — удалённому.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { T0, start, call, director, employee, changes, state, docOf, dateDoc } = require('./server-kit.js');

const DAY = 24 * 3600e3;
const upload = (srv, cookie, bytes, name = 'Счёт №1.pdf', type = 'application/pdf') => call(srv, 'POST', '/api/files', {
  cookie, raw: bytes, headers: { 'Content-Type': type, 'X-File-Name': encodeURIComponent(name) },
});
const task = (id, to, from, files = []) => ({
  id, title: 'Задача с файлом (тест)', desc: '', to: { t: 'p', id: to }, from, due: dateDoc(T0 + DAY), boardId: 'tasksCommon',
  stageId: 'new', prio: 'mid', deal: '', at: dateDoc(T0), files,
});

async function firm(srv) {
  const boss = await director(srv);
  const anna = await employee(srv, boss, { id: 'p2', name: 'Анна (тест)', role: 'managerB2c', dept: 'sales' });
  const ivan = await employee(srv, boss, { id: 'p5', name: 'Иван (тест)', role: 'warehouse', dept: 'stock' });
  return { boss, anna, ivan };
}

test('файл: загрузка — на диск, в базе только описание; скачать может загрузивший и видящий запись, остальные — 403; ссылки обновляются с пачкой', async () => {
  const srv = await start();
  try {
    const { boss, anna, ivan } = await firm(srv);
    const bytes = crypto.randomBytes(50000);
    const up = await upload(srv, boss.cookie, bytes);
    assert.equal(up.status, 200);
    assert.match(up.body.id, /^fl[0-9a-f]{24}$/);
    assert.deepEqual(up.body, { id: up.body.id, name: 'Счёт №1.pdf', type: 'application/pdf', size: 50000, url: '/api/files/' + up.body.id });
    assert.ok(fs.readFileSync(path.join(srv.dir, 'files', up.body.id)).equals(bytes), 'на диске — тот же файл');
    const d = new DatabaseSync(path.join(srv.dir, 'crm.db'), { readOnly: true });
    const row = d.prepare('SELECT * FROM files WHERE id = ?').get(up.body.id);
    d.close();
    assert.deepEqual(Object.keys(row).sort(), ['at', 'by', 'deletedAt', 'id', 'name', 'size', 'type']);
    assert.ok(fs.statSync(path.join(srv.dir, 'crm.db')).size < 50000 || !fs.readFileSync(path.join(srv.dir, 'crm.db')).includes(bytes.subarray(0, 64)), 'содержимого файла в базе нет');

    const get = cookie => call(srv, 'GET', up.body.url, { cookie });
    const mine = await get(boss.cookie);
    assert.equal(mine.status, 200);
    assert.ok(mine.body.equals(bytes));
    assert.match(mine.headers.get('content-disposition'), /filename\*=UTF-8''%D0%A1%D1%87%D1%91%D1%82/);
    assert.equal((await get(anna.cookie)).status, 403, 'ещё ни к чему не прикреплён');

    const file = { ...up.body, by: 'p1', at: dateDoc(T0) };
    const t = task('tk1-1', 'p2', 'p1', [file]);
    assert.equal((await changes(srv, boss.cookie, [{ key: 'tasks', id: t.id, base: null, data: t }])).status, 200);
    assert.equal((await get(anna.cookie)).status, 200, 'Анна видит задачу — скачивает');
    const denied = await get(ivan.cookie);
    assert.deepEqual([denied.status, denied.body.error], [403, 'Нет доступа'], 'кладовщик задачу не видит');
    // файл убран из задачи — ссылка исчезла
    assert.equal((await changes(srv, boss.cookie, [{ key: 'tasks', id: t.id, base: t, data: { ...t, files: [] } }])).status, 200);
    assert.equal((await get(anna.cookie)).status, 403);
    assert.equal((await get(boss.cookie)).status, 200, 'загрузивший скачивает всегда');
    // путь — только по id: выйти из папки нельзя
    for (const bad of ['/api/files/..%2fcrm.db', '/api/files/..%5Ccrm.db', '/api/files/fl' + '0'.repeat(24), '/api/files/crm.db']) {
      assert.equal((await call(srv, 'GET', bad, { cookie: boss.cookie })).status, 404, bad);
    }
  } finally { await srv.stop(); }
});

test('файл: прикрепить чужой невидимый файл к своей записи нельзя — 403', async () => {
  const srv = await start();
  try {
    const { boss, anna } = await firm(srv);
    const up = await upload(srv, boss.cookie, Buffer.from('секрет'), 'договор.txt', 'text/plain');
    const t = task('tk2-1', 'p2', 'p2', [{ ...up.body, by: 'p2', at: dateDoc(T0) }]);
    const r = await changes(srv, anna.cookie, [{ key: 'tasks', id: t.id, base: null, data: t }]);
    assert.equal(r.status, 403);
    assert.equal(docOf(await state(srv, anna.cookie), 'tasks', t.id), undefined);
    assert.equal((await call(srv, 'GET', up.body.url, { cookie: anna.cookie })).status, 403);
  } finally { await srv.stop(); }
});

test('файл больше предела — 413 «Файл больше N МБ — не загружен», на диске ничего не остаётся', async () => {
  const srv = await start({ fileMaxMb: 1 });
  try {
    const boss = await director(srv);
    const r = await upload(srv, boss.cookie, crypto.randomBytes(1048576 + 1), 'большой.bin', 'application/octet-stream');
    assert.deepEqual([r.status, r.body.error], [413, 'Файл больше 1 МБ — не загружен']);
    assert.deepEqual(fs.readdirSync(path.join(srv.dir, 'files')), []);
    assert.equal((await upload(srv, boss.cookie, crypto.randomBytes(1048576))).status, 200, 'ровно предел — можно');
  } finally { await srv.stop(); }
});

test('обслуживание: брошенный файл стирается через 7 дней, удалённый из записи — через 30 дней после удаления', async () => {
  const srv = await start();
  try {
    const { boss } = await firm(srv);
    const lost = (await upload(srv, boss.cookie, Buffer.from('брошенный'))).body;
    const kept = (await upload(srv, boss.cookie, Buffer.from('прикреплённый'))).body;
    const t = task('tk1-1', 'p2', 'p1', [{ ...kept, by: 'p1', at: dateDoc(T0) }]);
    await changes(srv, boss.cookie, [{ key: 'tasks', id: t.id, base: null, data: t }]);
    const onDisk = f => fs.existsSync(path.join(srv.dir, 'files', f.id));
    srv.clock.t = T0 + 6 * DAY; srv.app.tick();
    assert.ok(onDisk(lost));
    srv.clock.t = T0 + 7 * DAY + 1; srv.app.tick();
    assert.ok(!onDisk(lost), 'брошенный старше 7 дней');
    assert.equal((await call(srv, 'GET', lost.url, { cookie: boss.cookie })).status, 404);
    assert.ok(onDisk(kept), 'прикреплённый лежит');
    // убрали из задачи в день 10: лежит до дня 40
    srv.clock.t = T0 + 10 * DAY;
    await changes(srv, boss.cookie, [{ key: 'tasks', id: t.id, base: t, data: { ...t, files: [] } }]);
    srv.clock.t = T0 + 39 * DAY; srv.app.tick();
    assert.ok(onDisk(kept), 'удалённый из записи лежит 30 дней');
    srv.clock.t = T0 + 40 * DAY + 1; srv.app.tick();
    assert.ok(!onDisk(kept));
  } finally { await srv.stop(); }
});
