'use strict';
// Обновление по кнопке (слова директора 2026-11-12: «кнопка обновить в CRM, чтобы приходило обновление по воздуху»).
// GitHub подменён: список версий и архив отдаёт заглушка fetch; архив собирается здесь же системной командой tar.
// Проверяется: что нового считается от установленной версии; код заменяется, а data и чужие файлы — нет; прежний код откладывается;
// кривой архив код не трогает; в рабочей копии (.git) и при последней версии ничего не ставится; перезапуск только под присмотром;
// маршруты — только директору; открытым вкладкам сервер сообщает версию страницы.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { createUpdater, titleOf } = require('../server/updater.js');
const { start, call, director, employee, events } = require('./server-kit.js');

const SHA = n => String(n).padStart(40, '0').replace(/0/g, (c, i) => (i % 2 ? 'a' : 'b')).slice(0, 39) + n;
const COMMITS = [
  { sha: SHA(5), commit: { message: 'feat: кнопка обновления\n\nтело', committer: { date: '2026-11-12T10:00:00Z' } } },
  { sha: SHA(4), commit: { message: 'docs: поправил инструкцию', committer: { date: '2026-11-12T09:00:00Z' } } },
  { sha: SHA(3), commit: { message: 'fix: даты в одном формате', committer: { date: '2026-11-11T10:00:00Z' } } },
  { sha: SHA(2), commit: { message: 'feat: фото товара', committer: { date: '2026-11-10T10:00:00Z' } } },
  { sha: SHA(1), commit: { message: 'feat: первая версия', committer: { date: '2026-11-09T10:00:00Z' } } },
];

const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'crm-upd-'));
const put = (root, rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// Архив версии, как его отдаёт GitHub: одна папка верхнего уровня
function archive(files) {
  const work = tmpdir();
  const top = 'MezentsevPavel-CRM-' + SHA(5).slice(0, 7);
  for (const [rel, text] of Object.entries(files)) put(path.join(work, 'src', top), rel, text);
  const r = cp.spawnSync('tar', ['-czf', '../v.tgz', top], { cwd: path.join(work, 'src'), windowsHide: true });
  assert.equal(r.status, 0, 'tar не собрал архив: ' + (r.stderr || r.error));
  const bytes = fs.readFileSync(path.join(work, 'v.tgz'));
  fs.rmSync(work, { recursive: true, force: true });
  return bytes;
}
const NEW_FILES = {
  'server/main.js': 'NEW main', 'server/app.js': 'NEW app', 'tools/vm-load.js': 'NEW vm', 'crm-wind-solar.html': 'NEW page',
  'docs/a.md': 'NEW doc', 'data/crm.db': 'ИЗ АРХИВА — это не должно попасть в data', 'tests/x.test.js': 'не нужен',
};
function fakeFetch(bytes, commits = COMMITS) {
  const seen = [];
  const f = async (url) => {
    seen.push(String(url));
    if (/api\.github\.com\/repos\/[^/]+\/[^/]+\/commits/.test(url)) return new Response(JSON.stringify(commits), { status: 200 });
    if (/codeload\.github\.com\/[^/]+\/[^/]+\/tar\.gz\//.test(url)) return new Response(bytes, { status: 200 });
    return new Response('нет', { status: 404 });
  };
  f.seen = seen;
  return f;
}
// Папка «установленной» программы: старый код, данные, чужой файл
function installed(version) {
  const appDir = tmpdir();
  put(appDir, 'server/main.js', 'OLD main'); put(appDir, 'server/old-only.js', 'OLD only');
  put(appDir, 'crm-wind-solar.html', 'OLD page'); put(appDir, 'tools/vm-load.js', 'OLD vm');
  put(appDir, 'data/crm.db', 'МОЯ БАЗА'); put(appDir, 'мои-заметки.txt', 'заметки');
  if (version) put(appDir, '.crm-version', JSON.stringify({ sha: version, at: '2026-11-09T10:00:00Z', message: 'первая версия' }));
  return appDir;
}
const stubBackups = () => ({ made: [], make(kind) { this.made.push(kind); return { name: 'crm-2026-11-12-100000.db' }; } });
const wait = ms => new Promise(ok => setTimeout(ok, ms));

test('что нового: от установленной версии; служебные коммиты и приставки feat/fix не показываются; версия неизвестна — последние пять', async () => {
  assert.equal(titleOf('feat: кнопка обновления\n\nтело'), 'кнопка обновления');
  const mk = version => createUpdater({ appDir: installed(version), dataDir: tmpdir(), backups: stubBackups(), fetch: fakeFetch(Buffer.alloc(0)) });
  const mid = await mk(SHA(2)).check();
  assert.equal(mid.upToDate, false);
  assert.deepEqual(mid.news.map(n => n.title), ['кнопка обновления', 'даты в одном формате'], 'docs-коммит попал в «Что нового» или потерялся рабочий');
  assert.equal(mid.latest.sha, SHA(5));
  assert.equal((await mk(SHA(5)).check()).upToDate, true);
  const unknown = await mk(null).check();
  assert.equal(unknown.upToDate, null);
  assert.equal(unknown.current, null);
  assert.equal(unknown.news.length, 4, 'из пяти последних коммитов один служебный');
  const far = await mk('c'.repeat(40)).check();
  assert.equal(far.farBehind, true);
});

test('ошибки GitHub: нет связи, закрытый репозиторий, лимит запросов — понятными словами', async () => {
  const mk = f => createUpdater({ appDir: installed(null), dataDir: tmpdir(), backups: stubBackups(), fetch: f });
  await assert.rejects(mk(async () => { throw new Error('ENOTFOUND'); }).check(), /Нет связи с GitHub/);
  await assert.rejects(mk(async () => new Response('', { status: 404 })).check(), /не найден или закрыт/);
  await assert.rejects(mk(async () => new Response('', { status: 403 })).check(), /слишком много запросов/);
});

test('установка: код заменён (в том числе удалены файлы, которых в новой версии нет), data и чужие файлы целы, прежний код отложен, версия записана, копия базы сделана', async () => {
  const appDir = installed(SHA(2)), dataDir = path.join(appDir, 'data'), backups = stubBackups();
  const fetchFn = fakeFetch(archive(NEW_FILES));
  const u = createUpdater({ appDir, dataDir, backups, fetch: fetchFn, supervised: false });
  const r = await u.apply();
  assert.equal(r.ok, true);
  assert.equal(r.to, SHA(5));
  assert.equal(r.from, SHA(2));
  assert.equal(r.restarting, false);
  assert.deepEqual(backups.made, ['manual'], 'копия базы перед установкой не сделана');
  assert.equal(read(appDir, 'server/main.js'), 'NEW main');
  assert.equal(read(appDir, 'crm-wind-solar.html'), 'NEW page');
  assert.equal(read(appDir, 'docs/a.md'), 'NEW doc');
  assert.equal(fs.existsSync(path.join(appDir, 'server/old-only.js')), false, 'файл старой версии остался');
  assert.equal(read(appDir, 'data/crm.db'), 'МОЯ БАЗА', 'база затёрта архивом');
  assert.equal(read(appDir, 'мои-заметки.txt'), 'заметки');
  assert.equal(fs.existsSync(path.join(appDir, 'tests')), false, 'тесты скопированы в рабочую установку');
  assert.equal(read(dataDir, 'update-backup/server/main.js'), 'OLD main', 'прежний код не отложен');
  assert.equal(read(dataDir, 'update-backup/server/old-only.js'), 'OLD only');
  assert.equal(JSON.parse(read(appDir, '.crm-version')).sha, SHA(5));
  assert.equal(await u.check().then(c => c.upToDate), true, 'после установки версия не считается последней');
  assert.ok(fetchFn.seen.some(x => x.includes('/tar.gz/' + SHA(5))), 'архив взят не по номеру коммита');
  await assert.rejects(u.apply(), /Уже стоит последняя версия/);
});

test('перезапуск: под присмотром (systemd, start.cmd) сервер выходит с кодом 75 после ответа; без присмотра — не выходит', async () => {
  const run = async supervised => {
    const exits = [];
    const u = createUpdater({ appDir: installed(SHA(2)), dataDir: tmpdir(), backups: stubBackups(), fetch: fakeFetch(archive(NEW_FILES)), supervised, restart: c => exits.push(c) });
    const r = await u.apply();
    assert.equal(r.restarting, supervised);
    assert.deepEqual(exits, [], 'перезапуск раньше ответа');
    await wait(1100);
    return exits;
  };
  assert.deepEqual(await run(true), [75]);
  assert.deepEqual(await run(false), []);
});

test('кривой архив: код не тронут, ничего не ставится', async () => {
  const bad = installed(SHA(2));
  const noMain = { ...NEW_FILES }; delete noMain['server/main.js'];
  await assert.rejects(createUpdater({ appDir: bad, dataDir: tmpdir(), backups: stubBackups(), fetch: fakeFetch(archive(noMain)) }).apply(), /нет файла server\/main\.js/);
  assert.equal(read(bad, 'server/main.js'), 'OLD main');
  assert.equal(JSON.parse(read(bad, '.crm-version')).sha, SHA(2), 'версия переписана при неудаче');
  await assert.rejects(createUpdater({ appDir: installed(SHA(2)), dataDir: tmpdir(), backups: stubBackups(), fetch: fakeFetch(Buffer.from('это не архив, но длиннее ста байт '.repeat(5))) }).apply(), /распаковать архив/);

});

test('маршруты /api/update: только директор; проверка и установка через сервер; вкладкам сообщается версия страницы', async () => {
  const appDir = installed(SHA(2));
  const srv = await start({ update: { appDir, fetch: fakeFetch(archive(NEW_FILES)), supervised: false } });
  try {
    const boss = await director(srv);
    const ivan = await employee(srv, boss, { id: 'p5', name: 'Иван Кладовщиков (тест)', role: 'warehouse', dept: 'stock' });
    for (const [m, route] of [['GET', '/api/update'], ['POST', '/api/update/check'], ['POST', '/api/update/apply']]) {
      assert.equal((await call(srv, m, route, { cookie: ivan.cookie })).status, 403, `${route} открыт сотруднику`);
    }
    const info = await call(srv, 'GET', '/api/update', { cookie: boss.cookie });
    assert.equal(info.status, 200);
    assert.equal(info.body.current.sha, SHA(2));
    assert.equal(info.body.supervised, false);
    assert.equal(info.body.git, false);
    const chk = await call(srv, 'POST', '/api/update/check', { cookie: boss.cookie });
    assert.equal(chk.status, 200);
    assert.equal(chk.body.upToDate, false);
    assert.equal(chk.body.latest.sha, SHA(5));
    const ev = await events(srv, boss.cookie);
    try {
      const b = await ev.wait(e => e.event === 'build');
      assert.match(b.data, /^[0-9a-f]{12}$/);
    } finally { ev.close(); }
    const app = await call(srv, 'POST', '/api/update/apply', { cookie: boss.cookie });
    assert.equal(app.status, 200, app.text);
    assert.equal(app.body.restarting, false);
    assert.equal(read(appDir, 'server/main.js'), 'NEW main');
    assert.match(app.body.backup, /^crm-.*\.db$/);
    const again = await call(srv, 'POST', '/api/update/apply', { cookie: boss.cookie });
    assert.equal(again.status, 409);
  } finally { await srv.stop(); }
});

// Папка скачана через git (так стоит CRM на рабочем компьютере директора, 2026-11-12: «ничего не прилетело»): обновляет git pull --ff-only
const git = (cwd, ...args) => {
  const r = cp.spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, 'git ' + args.join(' ') + ': ' + r.stderr);
  return r.stdout.trim();
};
function gitWorld() {
  const root = tmpdir(), origin = path.join(root, 'origin.git'), author = path.join(root, 'author'), appDir = path.join(root, 'app');
  fs.mkdirSync(origin); git(origin, 'init', '--bare', '-b', 'master');
  fs.mkdirSync(author); git(author, 'init', '-b', 'master');
  git(author, 'config', 'user.email', 't@example.test'); git(author, 'config', 'user.name', 'Тест');
  put(author, 'server/main.js', 'OLD main'); put(author, 'data-note.txt', 'старое');
  git(author, 'add', '-A'); git(author, 'commit', '-m', 'feat: первая версия'); git(author, 'remote', 'add', 'origin', origin); git(author, 'push', 'origin', 'master');
  git(root, 'clone', '-b', 'master', origin, appDir);
  const publish = text => { put(author, 'server/main.js', text); git(author, 'commit', '-am', 'feat: новая версия'); git(author, 'push', 'origin', 'master'); return git(author, 'rev-parse', 'HEAD'); };
  return { appDir, publish };
}

test('папка через git: код обновляет git pull --ff-only; копия базы; перезапуск; на другой ветке и с несохранёнными правками — отказ без копии и без изменений', async () => {
  const w = gitWorld(), backups = stubBackups(), exits = [];
  const mk = () => createUpdater({ appDir: w.appDir, dataDir: tmpdir(), backups, fetch: fakeFetch(Buffer.alloc(0)), supervised: true, restart: c => exits.push(c) });
  const u = mk();
  assert.equal(u.info().git, true);
  assert.equal(u.info().current.sha, git(w.appDir, 'rev-parse', 'HEAD'), 'версию должен называть сам git');
  assert.equal(u.info().current.message, 'первая версия');

  // несохранённая правка кода — не обновлять и не копировать базу
  fs.writeFileSync(path.join(w.appDir, 'server/main.js'), 'МОЯ ПРАВКА');
  await assert.rejects(u.apply(), /несохранённые правки/);
  assert.deepEqual(backups.made, []);
  git(w.appDir, 'checkout', '--', 'server/main.js');
  // другая ветка
  git(w.appDir, 'checkout', '-b', 'feature');
  await assert.rejects(u.apply(), /стоит на ветке «feature»/);
  git(w.appDir, 'checkout', 'master');
  assert.deepEqual(backups.made, []);

  const head = w.publish('NEW main');
  const r = await u.apply();
  assert.equal(r.ok, true);
  assert.equal(r.to, head, 'версия после обновления — не та, что на сервере git');
  assert.equal(read(w.appDir, 'server/main.js'), 'NEW main');
  assert.deepEqual(backups.made, ['manual']);
  assert.equal(r.restarting, true);
  await wait(1100);
  assert.deepEqual(exits, [75]);
});

test('в папке остался .git, а команды git на компьютере нет: обновление идёт архивом, а не отказом', async () => {
  const appDir = installed(SHA(2));
  fs.mkdirSync(path.join(appDir, '.git'));
  const u = createUpdater({ appDir, dataDir: tmpdir(), backups: stubBackups(), fetch: fakeFetch(archive(NEW_FILES)), gitCmd: 'git-такой-команды-нет' });
  assert.equal(u.info().git, false);
  assert.equal(u.info().current.sha, SHA(2), 'версия должна браться из .crm-version');
  const r = await u.apply();
  assert.equal(r.to, SHA(5));
  assert.equal(read(appDir, 'server/main.js'), 'NEW main');
  assert.equal(fs.existsSync(path.join(appDir, '.git')), true, 'чужая .git затёрта');
});
