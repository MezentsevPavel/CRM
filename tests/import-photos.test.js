'use strict';
// Команда admin.js import-photos (слова директора 2026-11-12: «если у тебя уже есть фото, закинь их в номенклатуру» —
// 35 фото инверторов и аккумуляторов лежат в папке PVCalc вместе со связкой «id каталога → файл»). Фото кладётся товару,
// у которого фото ещё нет; ключ каталога тот же, что у товара CRM. Данные искусственные: «картинка» — байты с началом PNG или JPEG.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { openCore } = require('../server/app.js');
const { readMap } = require('../server/photos.js');
const { start, call, login, director, employee, state } = require('./server-kit.js');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 1, 2, 3]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
const KEY_A = '405101090', KEY_B = '1763407769'; // два настоящих ключа каталога из снимка (DEYE SUN-12K, ASTERION 1.5 кВт)

function folder(files, mapName, mapText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-photos-'));
  for (const [name, bytes] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), bytes);
  const map = path.join(dir, mapName);
  fs.writeFileSync(map, mapText);
  return { dir, map };
}

// Открыть базу так же, как это делает admin.js (сервер остановлен), выполнить, закрыть
function withCore(dataDir, fn) {
  const ctx = openCore({ dataDir });
  try { return fn(ctx); } finally { ctx.store.close(); }
}

test('связка: JSON и .js-файл в стиле PVCalc читаются одинаково; лишнее без «file» пропускается', () => {
  const j = folder({}, 'map.json', JSON.stringify({ [KEY_A]: 'a.jpg', [KEY_B]: { file: 'b.jpg', kind: 'inverter' }, 777: { note: 'без файла' } }));
  assert.deepEqual(readMap(j.map), { [KEY_A]: 'a.jpg', [KEY_B]: 'b.jpg' });
  const js = folder({}, 'equipment-photos.js', `/* заголовок */ var DIR = 'img/'; var EQUIPMENT_PHOTOS = { ${KEY_A}: { file: "a.jpg", kind: "inverter" }, ${KEY_B}: { file: "b.jpg", kind: "battery" } };`);
  assert.deepEqual(readMap(js.map), { [KEY_A]: 'a.jpg', [KEY_B]: 'b.jpg' });
  const bad = folder({}, 'x.js', 'var X = 1;');
  assert.throws(() => readMap(bad.map), /не нашёлся объект/);
});

test('import-photos: фото попадает товару, сервер отдаёт его картинкой; нет товара, не картинка и повторный запуск — пропуск без дублей', async () => {
  const srv = await start();
  const photos = folder({ 'a.jpg': PNG, 'b.jpg': JPG, 'fake.jpg': Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>') }, 'map.json',
    JSON.stringify({ [KEY_A]: 'a.jpg', [KEY_B]: 'fake.jpg', 123456: 'b.jpg' }));
  let boss;
  try {
    boss = await director(srv);
    await srv.stop(true);

    const first = withCore(srv.dir, ctx => require('../server/photos.js').importPhotos(ctx, { dir: photos.dir, mapFile: photos.map, by: ctx.sync.state.people.find(p => p.role === 'director').id }));
    assert.deepEqual(first.attached, [KEY_A]);
    assert.deepEqual(first.skipped.map(x => x.key).sort(), [KEY_B, '123456'].sort());
    assert.match(first.skipped.find(x => x.key === KEY_B).reason, /только JPEG, PNG, WebP или GIF/, 'подделка под фото не отвергнута');
    assert.match(first.skipped.find(x => x.key === '123456').reason, /нет товара/);

    // повторный запуск: у товара уже есть фото — ничего не прикрепляется, лишних файлов нет
    const again = withCore(srv.dir, ctx => require('../server/photos.js').importPhotos(ctx, { dir: photos.dir, mapFile: photos.map, by: ctx.sync.state.people.find(p => p.role === 'director').id }));
    assert.deepEqual(again.attached, []);
    assert.match(again.skipped.find(x => x.key === KEY_A).reason, /уже есть фото/);
    const db = new DatabaseSync(path.join(srv.dir, 'crm.db'), { readOnly: true });
    try {
      assert.equal(db.prepare('SELECT COUNT(*) n FROM files').get().n, 1, 'файлов стало не один');
      assert.equal(db.prepare('SELECT COUNT(*) n FROM file_refs').get().n, 1, 'привязок стало не одна');
    } finally { db.close(); }

    // сервер запускается заново: фото видно директору, файл скачивается картинкой под правильным типом
    const again2 = await start({ dataDir: srv.dir });
    try {
      const { cookie } = await login(again2, 'boss', boss.password);
      const st = await state(again2, cookie);
      const product = st.products.find(x => x.id === KEY_A);
      assert.equal(product.photos.length, 1, 'у товара нет фото');
      assert.match(product.photos[0].url, /^\/api\/files\/fl[0-9a-f]{24}$/);
      assert.equal(st.products.find(x => x.id === KEY_B).photos, undefined, 'подделка прикреплена');
      const got = await call(again2, 'GET', product.photos[0].url, { cookie });
      assert.equal(got.status, 200);
      assert.equal(got.headers.get('content-type'), 'image/png');
    } finally { await again2.stop(); }
  } finally {
    fs.rmSync(photos.dir, { recursive: true, force: true });
  }
});

// Готовые фото из поставки программы (assets/photos): кнопка «Загрузить готовые фото» в «Обновить ПО» (слова директора 2026-11-12: «давай третий»)
test('готовые фото из поставки: только директор; считает, сколько можно прикрепить; прикрепляет товарам без фото, повтор — ничего', async () => {
  const bundled = folder({ 'a.jpg': PNG, 'b.jpg': JPG }, 'map.json', JSON.stringify({ [KEY_A]: 'a.jpg', [KEY_B]: 'b.jpg', 123456: 'a.jpg' }));
  const srv = await start({ photosDir: bundled.dir });
  try {
    const boss = await director(srv);
    const ivan = await employee(srv, boss, { id: 'p5', name: 'Иван Кладовщиков (тест)', role: 'warehouse', dept: 'stock' });
    assert.equal((await call(srv, 'GET', '/api/photos/bundled', { cookie: ivan.cookie })).status, 403);
    assert.equal((await call(srv, 'POST', '/api/photos/bundled', { cookie: ivan.cookie })).status, 403);

    const st0 = await call(srv, 'GET', '/api/photos/bundled', { cookie: boss.cookie });
    assert.deepEqual([st0.body.total, st0.body.available], [3, 2], 'нет товара 123456 — не считается доступным');
    assert.deepEqual([st0.body.matched, st0.body.withPhoto], [2, 0]);

    const done = await call(srv, 'POST', '/api/photos/bundled', { cookie: boss.cookie });
    assert.equal(done.status, 200);
    assert.equal(done.body.attached, 2);
    assert.equal(done.body.available, 0);
    assert.deepEqual([done.body.matched, done.body.withPhoto], [2, 2], 'после загрузки у обоих товаров есть фото');
    const st = await state(srv, boss.cookie);
    assert.equal(st.products.find(x => x.id === KEY_A).photos.length, 1);
    const again = await call(srv, 'POST', '/api/photos/bundled', { cookie: boss.cookie });
    assert.equal(again.body.attached, 0, 'повтор прикрепил ещё');
    const db = new DatabaseSync(path.join(srv.dir, 'crm.db'), { readOnly: true });
    try { assert.equal(db.prepare('SELECT COUNT(*) n FROM files').get().n, 2, 'повтор плодит файлы'); } finally { db.close(); }
  } finally {
    await srv.stop();
    fs.rmSync(bundled.dir, { recursive: true, force: true });
  }
});

test('готовые фото в самой программе: связка assets/photos/map.json указывает на существующие картинки, ключи — на товары каталога', () => {
  const { bundled, readMap: read } = require('../server/photos.js');
  const b = bundled();
  const map = read(b.mapFile);
  assert.ok(Object.keys(map).length >= 35);
  for (const f of Object.values(map)) assert.ok(fs.existsSync(path.join(b.dir, f)), 'нет файла фото ' + f);
  assert.ok(map[KEY_A] && map[KEY_B], 'нет фото DEYE SUN-12K или ASTERION');
});
