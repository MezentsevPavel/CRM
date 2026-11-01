'use strict';
// Копии базы (таск 04, R08, R19i): ночная копия VACUUM INTO в data/backups, 30 последних, копия пропущенного при старте,
// список/скачать/сделать сейчас/восстановить для директора, команды server/admin.js backups и restore.
// Время — местное (как у сервера по TZ): тесты берут его теми же геттерами, поэтому не зависят от пояса машины.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { start, call, director, employee, changes, state, deal, events } = require('./server-kit.js');
const admin = require('../server/admin.js');

const at = (d, h = 0, mi = 0, s = 0) => new Date(2026, 10, d, h, mi, s).getTime();
const backupsDir = srv => path.join(srv.dir, 'backups');
const files = srv => (fs.existsSync(backupsDir(srv)) ? fs.readdirSync(backupsDir(srv)).filter(f => f.endsWith('.db')).sort() : []);
const nightly = d => `crm-2026-11-${String(d).padStart(2, '0')}.db`;
const get = (srv, who, route) => call(srv, 'GET', route, { cookie: who.cookie });
const post = (srv, who, route, body) => call(srv, 'POST', route, { cookie: who.cookie, body: body || {} });

async function firm(srv) {
  const boss = await director(srv);
  const ivan = await employee(srv, boss, { id: 'p5', name: 'Иван Кладовщиков (тест)', role: 'warehouse', dept: 'stock' });
  return { boss, ivan };
}
const dealIds = async (srv, who) => (await state(srv, who.cookie)).deals.map(d => d.id).sort();
const put = (srv, who, id) => changes(srv, who.cookie, [{ key: 'deals', id, base: null, data: deal(id, { managerId: 'p1' }) }]);
const docsIn = file => { const d = new DatabaseSync(file, { readOnly: true }); try { return d.prepare('SELECT key, id FROM docs').all().map(r => r.key + '/' + r.id); } finally { d.close(); } };

test('копия: при старте — пропущенная делается; в час по TZ — crm-ГГГГ-ММ-ДД.db, второй раз за день не делается; внутри настоящая база', async () => {
  const clock = { t: at(1, 10) };
  const srv = await start({ clock });
  try {
    assert.deepEqual(files(srv), [nightly(1)], 'при старте копий не было — сделана');
    const { boss } = await firm(srv);
    await put(srv, boss, 'Д-901');
    clock.t = at(2, 2, 59);
    assert.equal(await srv.app.backups.tick(), null, 'до 03:00 следующей копии ещё нет');
    assert.deepEqual(files(srv), [nightly(1)]);
    clock.t = at(2, 3, 0);
    const made = await srv.app.backups.tick();
    assert.equal(made.name, nightly(2));
    assert.deepEqual(files(srv), [nightly(1), nightly(2)]);
    clock.t = at(2, 15, 30);
    assert.equal(await srv.app.backups.tick(), null, 'за день одна');
    assert.ok(docsIn(path.join(backupsDir(srv), nightly(2))).includes('deals/Д-901'), 'в копии то, что было в базе');
    assert.ok(!docsIn(path.join(backupsDir(srv), nightly(1))).includes('deals/Д-901'), 'старая копия осталась прежней');
    const copy = new DatabaseSync(path.join(backupsDir(srv), nightly(2)), { readOnly: true });
    assert.equal(copy.prepare("SELECT login FROM users WHERE personId = 'p1'").get().login, 'boss', 'пользователи тоже в копии');
    copy.close();
    assert.equal(files(srv).some(f => f.endsWith('.tmp')), false);
  } finally { await srv.stop(); }
});

test('копия: хранится CRM_BACKUP_KEEP последних, старые удаляются; час задаётся', async () => {
  const clock = { t: at(1, 1) };
  const srv = await start({ clock, backupKeep: 3, backupHour: 5 });
  try {
    for (let d = 1; d <= 7; d++) {
      clock.t = at(d, 4, 59);
      await srv.app.backups.tick();
      clock.t = at(d, 5, 0);
      await srv.app.backups.tick();
    }
    assert.deepEqual(files(srv), [nightly(5), nightly(6), nightly(7)], 'три последние');
    clock.t = at(7, 23);
    assert.equal(await srv.app.backups.tick(), null);
  } finally { await srv.stop(); }
});

test('копия: выключенный сервер не лишает копии — при старте делается одна за пропущенное, повторный старт в тот же день не добавляет', async () => {
  const clock = { t: at(3, 10) };
  const a = await start({ clock });
  const dir = a.dir;
  try {
    assert.deepEqual(files(a), [nightly(3)]);
    await a.stop(true);
    clock.t = at(6, 9);
    const b = await start({ clock, dataDir: dir });
    assert.deepEqual(files(b), [nightly(3), nightly(6)], 'за 4 и 5 ноября одна копия, не две');
    await b.stop(true);
    clock.t = at(6, 9, 30);
    const c = await start({ clock, dataDir: dir });
    assert.deepEqual(files(c), [nightly(3), nightly(6)]);
    await c.stop(false);
  } catch (e) { fs.rmSync(dir, { recursive: true, force: true }); throw e; }
});

test('копии по API: список, сделать сейчас, скачать; не директору — 403; чужое имя файла не пускает', async () => {
  const clock = { t: at(2, 12) };
  const srv = await start({ clock });
  try {
    const { boss, ivan } = await firm(srv);
    for (const [m, r] of [['GET', '/api/backups'], ['POST', '/api/backups'], ['GET', '/api/backups/' + nightly(2)], ['POST', `/api/backups/${nightly(2)}/restore`]]) {
      const res = await call(srv, m, r, { cookie: ivan.cookie, body: m === 'POST' ? {} : undefined });
      assert.equal(res.status, 403, m + ' ' + r);
      assert.match(res.body.error, /Нет прав/);
    }
    assert.equal((await call(srv, 'GET', '/api/backups', {})).status, 401);
    const list = await get(srv, boss, '/api/backups');
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.backups.map(b => [b.name, b.kind]), [[nightly(2), 'nightly']]);
    assert.ok(list.body.backups[0].size > 0);
    assert.deepEqual([list.body.keep, list.body.hour], [30, 3]);

    clock.t = at(2, 14, 30, 5);
    const made = await post(srv, boss, '/api/backups');
    assert.equal(made.status, 200);
    assert.equal(made.body.backup.name, 'crm-2026-11-02-143005.db');
    assert.equal(made.body.backup.kind, 'manual');
    const list2 = await get(srv, boss, '/api/backups');
    assert.deepEqual(list2.body.backups.map(b => b.name), ['crm-2026-11-02-143005.db', nightly(2)], 'новые сверху');

    const dl = await get(srv, boss, '/api/backups/crm-2026-11-02-143005.db');
    assert.equal(dl.status, 200);
    assert.ok(dl.body.equals(fs.readFileSync(path.join(backupsDir(srv), 'crm-2026-11-02-143005.db'))));
    assert.equal(dl.body.subarray(0, 15).toString('latin1'), 'SQLite format 3');
    assert.match(dl.headers.get('content-disposition'), /attachment; filename="crm-2026-11-02-143005\.db"/);
    for (const bad of ['..%2Fcrm.db', '..%5Ccrm.db', 'crm.db', 'crm-2026-11-02.db.tmp', '..', 'crm-2099-01-01.db']) {
      const r = await get(srv, boss, '/api/backups/' + bad);
      assert.ok([400, 404].includes(r.status), bad + ' → ' + r.status);
    }
  } finally { await srv.stop(); }
});

test('восстановление: сперва копия текущей («перед восстановлением»), база заменена, вкладкам — reload, сеансы живых сотрудников целы, ушедшие — нет', async () => {
  const clock = { t: at(2, 12) };
  const srv = await start({ clock });
  try {
    const { boss } = await firm(srv);
    await put(srv, boss, 'Д-901');
    clock.t = at(2, 13);
    const copy = (await post(srv, boss, '/api/backups')).body.backup.name;
    // после копии: ещё сделка и ещё сотрудник
    await put(srv, boss, 'Д-902');
    const anna = await employee(srv, boss, { id: 'p2', name: 'Анна Менеджерова (тест)', role: 'managerB2c', dept: 'sales' });
    assert.deepEqual(await dealIds(srv, boss), ['Д-901', 'Д-902']);
    const ev = await events(srv, boss.cookie);
    clock.t = at(2, 16, 0, 9);
    const r = await post(srv, boss, `/api/backups/${copy}/restore`);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.before, 'crm-2026-11-02-160009-before-restore.db');
    await ev.wait(e => e.event === 'reload');
    ev.close();
    assert.deepEqual(await dealIds(srv, boss), ['Д-901'], 'Д-902 из базы ушла, Д-901 на месте');
    // копия текущей базы перед восстановлением содержит то, что было до него
    assert.ok(docsIn(path.join(backupsDir(srv), r.body.before)).includes('deals/Д-902'));
    assert.equal((await get(srv, boss, '/api/me')).status, 200, 'сеанс директора жив');
    assert.equal((await get(srv, anna, '/api/me')).status, 401, 'Анны в копии нет — её сеанс закрыт');
    assert.equal((await state(srv, boss.cookie)).people.some(p => p.id === 'p2'), false);
    // работа продолжается
    assert.equal((await put(srv, boss, 'Д-903')).status, 200);
    assert.deepEqual(await dealIds(srv, boss), ['Д-901', 'Д-903']);
  } finally { await srv.stop(); }
});

test('восстановление: не база, чужая база, база новее кода — отказ с текстом, текущая база не тронута; admin.restore то же самое', async () => {
  const clock = { t: at(2, 12) };
  const srv = await start({ clock });
  try {
    const { boss } = await firm(srv);
    await put(srv, boss, 'Д-901');
    const before = await dealIds(srv, boss);
    const dir = backupsDir(srv);
    fs.writeFileSync(path.join(dir, 'crm-2026-01-01.db'), Buffer.from('это не база данных, просто текст '.repeat(100)));
    const other = new DatabaseSync(path.join(dir, 'crm-2026-01-02.db'));
    other.exec('CREATE TABLE t (x)'); other.close();
    fs.copyFileSync(path.join(dir, nightly(2)), path.join(dir, 'crm-2026-01-03.db'));
    const newer = new DatabaseSync(path.join(dir, 'crm-2026-01-03.db'));
    newer.exec("UPDATE meta SET v = '999' WHERE k = 'rev'"); newer.close();
    const expect = { 'crm-2026-01-01.db': /не база|поврежд|не копия/i, 'crm-2026-01-02.db': /не копия базы CRM/i, 'crm-2026-01-03.db': /новее/i };
    for (const [name, re] of Object.entries(expect)) {
      const r = await post(srv, boss, `/api/backups/${name}/restore`);
      assert.equal(r.status, 400, name);
      assert.match(r.body.error, re, name);
      await assert.rejects(srv.app.admin.restore(name), re, 'admin.restore: ' + name);
    }
    assert.equal((await post(srv, boss, '/api/backups/crm-2099-01-01.db/restore')).status, 404);
    assert.deepEqual(await dealIds(srv, boss), before, 'база не тронута');
    assert.equal(files(srv).some(f => f.includes('before-restore')), false, 'и копия «перед восстановлением» не плодится на отказ');
  } finally { await srv.stop(); }
});

test('admin.restore(файл) — то же, что кнопка: возвращает имя копии «перед восстановлением»', async () => {
  const clock = { t: at(2, 12) };
  const srv = await start({ clock });
  try {
    const { boss } = await firm(srv);
    await put(srv, boss, 'Д-901');
    const name = (await post(srv, boss, '/api/backups')).body.backup.name;
    await put(srv, boss, 'Д-902');
    const out = await srv.app.admin.restore(name);
    assert.match(out.before, /before-restore\.db$/);
    assert.deepEqual(await dealIds(srv, boss), ['Д-901']);
  } finally { await srv.stop(); }
});

test('server/admin.js: backups показывает список, restore <файл> --yes восстанавливает при остановленном сервере', async () => {
  const clock = { t: at(2, 12) };
  const srv = await start({ clock });
  const dir = srv.dir;
  const saved = { data: process.env.CRM_DATA, log: console.log, err: console.error };
  try {
    const { boss } = await firm(srv);
    await put(srv, boss, 'Д-901');
    const name = (await post(srv, boss, '/api/backups')).body.backup.name;
    await put(srv, boss, 'Д-902');
    await srv.stop(true);

    const out = [];
    process.env.CRM_DATA = dir;
    console.log = (...a) => out.push(a.join(' '));
    console.error = (...a) => out.push(a.join(' '));
    assert.equal(await admin.main(['backups']), 0);
    assert.ok(out.join('\n').includes(name), 'имя копии в списке');
    assert.match(out.join('\n'), /нужны|копи/i);
    out.length = 0;
    assert.equal(await admin.main(['restore', 'crm-2099-01-01.db', '--yes']), 1, 'нет такой копии — отказ');
    assert.match(out.join('\n'), /нет/i);
    out.length = 0;
    assert.equal(await admin.main(['restore', name, '--yes']), 0, out.join('\n'));
    assert.match(out.join('\n'), /перезапусти/i, 'подсказка про запущенный сервер');
    console.log = saved.log; console.error = saved.err;

    const copy = docsIn(path.join(dir, 'crm.db'));
    assert.ok(copy.includes('deals/Д-901') && !copy.includes('deals/Д-902'));
    assert.ok(files({ dir }).some(f => f.includes('before-restore')));
  } finally {
    console.log = saved.log; console.error = saved.err;
    if (saved.data === undefined) delete process.env.CRM_DATA; else process.env.CRM_DATA = saved.data;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
