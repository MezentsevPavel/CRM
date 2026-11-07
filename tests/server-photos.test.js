'use strict';
// Сервер: фото товара (слова директора 2026-11-08: «вручную заменить, добавить, удалить фото», хранятся у нас, а не ссылкой на чужой
// сайт). Фото — файлы сервера (data/files/<id>) в product.photos; загрузка идёт по обычному маршруту файлов с заголовком
// X-File-Kind: photo, привязка — обычной пачкой на ключ products, права проверяет Guard (catalog) и files.checkRefs (файл существует,
// свой или видимый, настоящая картинка). Видят фото те, у кого есть право «остатки» (stock), как карточку товара.
// Данные искусственные: «картинки» — несколько байт с настоящими началами PNG, JPEG, GIF и WebP.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { T0, start, call, director, employee, changes, state, dateDoc } = require('./server-kit.js');

const DAY = 24 * 3600e3;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 1, 2, 3]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.from([1, 0, 1, 0, 0, 0, 0x3b])]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x1a, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.from([1, 2, 3, 4])]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const HTML = Buffer.from('<!doctype html><script>alert(1)</script>');

const upload = (srv, cookie, bytes, name = 'вид спереди.png', type = 'image/png', kind = 'photo') => call(srv, 'POST', '/api/files', {
  cookie, raw: bytes, headers: { 'Content-Type': type, 'X-File-Name': encodeURIComponent(name), ...(kind ? { 'X-File-Kind': kind } : {}) },
});
const product = (id, photos) => ({ id, name: 'Инвертор (тест фото)', brand: null, cat: 'Без раздела', price: null, avail: null, url: null, src: 'user', inCatalog: false, ...(photos ? { photos } : {}) });
const photoOf = (up, by = 'p1') => ({ id: up.id, name: up.name, type: up.type, size: up.size, url: up.url, by, at: dateDoc(T0), data: null });
const put = (srv, cookie, base, data) => changes(srv, cookie, [{ key: 'products', id: data.id, base, data }]);
const dbRows = (srv, sql, ...args) => { const d = new DatabaseSync(path.join(srv.dir, 'crm.db'), { readOnly: true }); try { return d.prepare(sql).all(...args); } finally { d.close(); } };

// Директор; Анна — менеджер B2C (есть и stock, и catalog); Вера — роль без права «остатки», но с catalog; Гена — роль с «остатки», без catalog
async function firm(srv) {
  const boss = await director(srv);
  const role = (id, name, perms) => changes(srv, boss.cookie, [{ key: 'roles', id, base: null, data: { id, name, builtin: false, perms } }]);
  assert.equal((await role('noStock', 'Без остатков (тест)', { catalog: true })).status, 200);
  assert.equal((await role('noCatalog', 'Без каталога (тест)', { stock: true })).status, 200);
  const anna = await employee(srv, boss, { id: 'p2', name: 'Анна (тест)', role: 'managerB2c', dept: 'sales' });
  const vera = await employee(srv, boss, { id: 'p6', name: 'Вера (тест)', role: 'noStock', dept: 'sales' });
  const gena = await employee(srv, boss, { id: 'p7', name: 'Гена (тест)', role: 'noCatalog', dept: 'stock' });
  return { boss, anna, vera, gena };
}

test('фото товара: загрузка PNG → привязка к товару → другой сеанс скачивает с Content-Type image/png под CSP страницы; без права «остатки» — 403 и в данных фото нет', async () => {
  const srv = await start();
  try {
    const { boss, anna, vera } = await firm(srv);
    const up = await upload(srv, boss.cookie, PNG);
    assert.equal(up.status, 200, up.text);
    assert.equal(up.body.type, 'image/png');
    assert.match(up.body.url, /^\/api\/files\/fl[0-9a-f]{24}$/);
    const p = product('u-ph1', [photoOf(up.body)]);
    assert.equal((await put(srv, boss.cookie, null, p)).status, 200);

    const got = await call(srv, 'GET', up.body.url, { cookie: anna.cookie });
    assert.equal(got.status, 200);
    assert.ok(got.body.equals(PNG), 'скачано не то, что загружено');
    assert.equal(got.headers.get('content-type'), 'image/png');
    assert.equal(got.headers.get('x-content-type-options'), 'nosniff');
    assert.match(got.headers.get('content-disposition'), /^inline;/, 'картинка не показывается в браузере, а скачивается');
    const mine = (await state(srv, anna.cookie)).products.find(x => x.id === 'u-ph1');
    assert.deepEqual(mine.photos.map(f => f.url), [up.body.url], 'второй сеанс не получил фото товара');

    // под CSP страницы картинки сервера разрешены (img-src 'self'), а чужие — нет
    const page = await call(srv, 'GET', '/', { cookie: anna.cookie });
    const img = (page.headers.get('content-security-policy').split(/;\s*/).find(d => d.startsWith('img-src ')) || '').split(' ').slice(1);
    assert.ok(img.includes("'self'"), 'картинки сервера CSP не разрешает: ' + img);
    assert.ok(!img.some(s => /^https?:|\*/.test(s)), 'CSP пускает картинки с чужих адресов: ' + img);

    // без права «остатки»: файл не отдаётся, в данных товара фото нет
    assert.equal((await call(srv, 'GET', up.body.url, { cookie: vera.cookie })).status, 403);
    const seen = (await state(srv, vera.cookie)).products.find(x => x.id === 'u-ph1');
    assert.ok(seen, 'товар скрыт целиком');
    assert.equal('photos' in seen, false, 'человек без права «остатки» получил список фото');
    // ... и его правка товара (название) не стирает фото
    assert.equal((await put(srv, vera.cookie, seen, { ...seen, name: 'Инвертор (тест фото, правка Веры)' })).status, 200);
    const after = (await state(srv, boss.cookie)).products.find(x => x.id === 'u-ph1');
    assert.equal(after.name, 'Инвертор (тест фото, правка Веры)');
    assert.deepEqual(after.photos.map(f => f.url), [up.body.url], 'правка без права «остатки» стёрла фото');
  } finally { await srv.stop(); }
});

test('фото товара: свой снимок каталога — фото лежит в правке товара и доходит до других сеансов', async () => {
  const srv = await start();
  try {
    const { boss, anna } = await firm(srv);
    const cur = (await state(srv, boss.cookie)).products;
    const snap = cur.find(x => x.src === 'catalog');
    assert.ok(snap, 'в рабочей базе нет товара снимка каталога');
    const up = await upload(srv, anna.cookie, JPG, 'снимок.jpg', 'image/jpeg');
    assert.equal(up.status, 200, up.text);
    const r = await put(srv, anna.cookie, snap, { ...snap, photos: [photoOf(up.body, 'p2')] });
    assert.equal(r.status, 200, r.text);
    const back = (await state(srv, boss.cookie)).products.find(x => x.id === snap.id);
    assert.deepEqual(back.photos.map(f => f.url), [up.body.url]);
    assert.equal(back.name, snap.name, 'правка фото испортила остальные поля товара');
    assert.equal((await call(srv, 'GET', up.body.url, { cookie: boss.cookie })).status, 200);
  } finally { await srv.stop(); }
});

test('фото товара: загрузка JPEG, GIF, WebP принимается и тип берётся по содержимому; SVG, HTML и текст — 415 по содержимому и по типу, на диске ничего не остаётся', async () => {
  const srv = await start();
  try {
    const { boss } = await firm(srv);
    for (const [bytes, type, want] of [[JPG, 'application/octet-stream', 'image/jpeg'], [GIF, 'image/gif', 'image/gif'], [WEBP, 'image/webp', 'image/webp'], [PNG, 'image/jpeg', 'image/png']]) {
      const r = await upload(srv, boss.cookie, bytes, 'фото', type);
      assert.equal(r.status, 200, `${want}: ${r.text}`);
      assert.equal(r.body.type, want, 'тип записан по заявленному, а не по содержимому');
    }
    const before = fs.readdirSync(path.join(srv.dir, 'files')).length;
    for (const [what, bytes, type] of [
      ['SVG с типом SVG', SVG, 'image/svg+xml'], ['SVG под видом PNG', SVG, 'image/png'], ['HTML под видом JPEG', HTML, 'image/jpeg'],
      ['текст', Buffer.from('просто текст'), 'text/plain'], ['пустой файл', Buffer.alloc(0), 'image/png'], ['PDF', Buffer.from('%PDF-1.4 ...'), 'application/pdf'],
    ]) {
      const r = await upload(srv, boss.cookie, bytes, 'не-фото', type);
      assert.equal(r.status, 415, `${what}: ${r.status}`);
      assert.match(r.body.error, /Фото товара — только JPEG, PNG, WebP или GIF/, what);
    }
    assert.equal(fs.readdirSync(path.join(srv.dir, 'files')).length, before, 'отказанные файлы остались на диске');
    assert.equal(dbRows(srv, 'SELECT COUNT(*) AS n FROM files')[0].n, before, 'отказанные файлы остались в базе');
    // обычное вложение (без метки фото) по-прежнему принимает любой тип
    assert.equal((await upload(srv, boss.cookie, SVG, 'схема.svg', 'image/svg+xml', null)).status, 200);
  } finally { await srv.stop(); }
});

test('фото товара: привязать как фото не картинку нельзя, даже если она загружена обычным вложением и названа PNG — 403; SVG, чужой адрес, лишний data — 403', async () => {
  const srv = await start();
  try {
    const { boss } = await firm(srv);
    const svgAsPng = (await upload(srv, boss.cookie, SVG, 'подмена.png', 'image/png', null)).body;
    const svg = (await upload(srv, boss.cookie, SVG, 'схема.svg', 'image/svg+xml', null)).body;
    const real = (await upload(srv, boss.cookie, PNG, 'настоящее.png', 'image/png', null)).body;
    const tries = [
      ['SVG, названный PNG', product('u-ph2', [photoOf(svgAsPng)]), /фото товара — только JPEG, PNG, WebP или GIF/],
      ['SVG как есть', product('u-ph3', [photoOf(svg)]), /фото товара — можно только фото: JPEG, PNG, WebP или GIF/],
      ['javascript: вместо адреса', product('u-ph4', [{ ...photoOf(real), url: 'javascript:alert(1)' }]), /Нет прав: фото товара — файл должен быть загружен на сервер/],
      ['чужой адрес', product('u-ph5', [{ ...photoOf(real), url: 'https://example.invalid/x.png' }]), /Нет прав/],
      ['адрес с хвостом', product('u-ph6', [{ ...photoOf(real), url: real.url + '" onerror=1' }]), /Нет прав/],
      ['данные в записи', product('u-ph7', [{ ...photoOf(real), data: 'data:image/png;base64,QQ==' }]), /файл должен быть загружен на сервер/],
      ['не список', product('u-ph8', 'не список'), /список не больше 20/],
      ['без названия', product('u-ph9', [{ ...photoOf(real), name: '' }]), /у фото должно быть название/],
      ['одинаковый номер дважды', product('u-ph10', [photoOf(real), photoOf(real)]), /у каждого фото свой номер/],
    ];
    for (const [what, data, re] of tries) {
      const r = await put(srv, boss.cookie, null, data);
      assert.equal(r.status, 403, `${what}: ${r.status} ${r.text}`);
      assert.match(r.body.error, re, what);
    }
    const many = Array.from({ length: 21 }, (_, i) => ({ ...photoOf(real), id: 'fl' + String(i).padStart(24, '0') }));
    const r = await put(srv, boss.cookie, null, product('u-ph11', many));
    assert.equal(r.status, 403);
    assert.match(r.body.error, /не больше 20 файлов/);
    assert.equal((await put(srv, boss.cookie, null, product('u-ph12', [photoOf(real)]))).status, 200, 'настоящее фото, загруженное вложением, не принято');
    for (const id of ['u-ph2', 'u-ph3', 'u-ph4', 'u-ph11']) assert.equal((await state(srv, boss.cookie)).products.some(x => x.id === id), false, id + ' всё же записан');
  } finally { await srv.stop(); }
});

test('фото товара: чужая и несуществующая ссылка — 403; без права catalog — 403; с правом и своим файлом — 200', async () => {
  const srv = await start();
  try {
    const { boss, anna, gena } = await firm(srv);
    const secret = (await upload(srv, boss.cookie, PNG, 'закрытое.png')).body;     // загрузил директор, нигде не прикреплено
    const own = (await upload(srv, anna.cookie, PNG, 'моё.png')).body;
    const gone = { ...photoOf(own, 'p2'), id: 'fl' + '0'.repeat(24), url: '/api/files/fl' + '0'.repeat(24) };
    let r = await put(srv, anna.cookie, null, product('u-ph20', [photoOf(secret, 'p2')]));
    assert.equal(r.status, 403, 'чужой файл прикреплён: ' + r.text);
    assert.match(r.body.error, /чужой или несуществующий файл/);
    r = await put(srv, anna.cookie, null, product('u-ph21', [gone]));
    assert.equal(r.status, 403, 'несуществующий файл прикреплён: ' + r.text);
    assert.match(r.body.error, /чужой или несуществующий файл/);
    // без права catalog: нужное право названо
    const mine = (await upload(srv, gena.cookie, PNG, 'гена.png')).body;
    r = await put(srv, gena.cookie, null, product('u-ph22', [photoOf(mine, 'p7')]));
    assert.equal(r.status, 403);
    assert.match(r.body.error, /Нет прав: менять товары и каталог — нужно право «Добавлять товары в номенклатуру»/);
    // с правом и своим файлом — можно
    assert.equal((await put(srv, anna.cookie, null, product('u-ph23', [photoOf(own, 'p2')]))).status, 200);
    // уже привязанный к товару файл видят и могут привязать к другому товару те, кто видит товар (Анна видит товар с остатками)
    const first = (await state(srv, anna.cookie)).products.find(x => x.id === 'u-ph23');
    assert.equal((await put(srv, boss.cookie, null, product('u-ph24', [first.photos[0]]))).status, 200);
    // Гена (есть «остатки») видит фото, но менять товар не может
    assert.equal((await call(srv, 'GET', own.url, { cookie: gena.cookie })).status, 200);
    const seen = (await state(srv, gena.cookie)).products.find(x => x.id === 'u-ph23');
    r = await put(srv, gena.cookie, seen, { ...seen, photos: [] });
    assert.equal(r.status, 403);
  } finally { await srv.stop(); }
});

test('фото товара: удаление и замена снимают привязку (file_refs), файл помечается к уборке и стирается через 30 дней; главное фото — первое в списке и порядок переживает запись', async () => {
  const srv = await start();
  try {
    const { boss, anna } = await firm(srv);
    const up = async (bytes, name) => (await upload(srv, boss.cookie, bytes, name, 'image/png')).body;
    const f1 = await up(PNG, 'а.png'), f2 = await up(JPG, 'б.jpg'), f3 = await up(GIF, 'в.gif');
    const refs = id => dbRows(srv, 'SELECT key, docId FROM file_refs WHERE fileId = ?', id.id).length;
    const file = id => dbRows(srv, 'SELECT deletedAt FROM files WHERE id = ?', id.id)[0];
    const onDisk = id => fs.existsSync(path.join(srv.dir, 'files', id.id));
    let cur = product('u-ph30', [photoOf(f1), photoOf(f2), photoOf(f3)]);
    assert.equal((await put(srv, boss.cookie, null, cur)).status, 200);
    assert.deepEqual([f1, f2, f3].map(refs), [1, 1, 1]);
    // «Сделать главным»: порядок меняется, привязки те же
    let next = { ...cur, photos: [photoOf(f3), photoOf(f1), photoOf(f2)] };
    assert.equal((await put(srv, anna.cookie, cur, next)).status, 200);
    cur = (await state(srv, boss.cookie)).products.find(x => x.id === 'u-ph30');
    assert.deepEqual(cur.photos.map(f => f.name), ['в.gif', 'а.png', 'б.jpg']);
    assert.deepEqual([f1, f2, f3].map(refs), [1, 1, 1]);
    // замена среднего фото новым файлом на том же месте (новый файл загрузил директор: чужой неприкреплённый файл Анне не отдать)
    const f4 = await up(PNG, 'г.png');
    next = { ...cur, photos: [cur.photos[0], photoOf(f4), cur.photos[2]] };
    assert.equal((await put(srv, boss.cookie, cur, next)).status, 200);
    assert.deepEqual([f1, f4].map(refs), [0, 1], 'замена не сняла привязку старого файла и не поставила новую');
    assert.ok(file(f1).deletedAt !== null, 'заменённый файл не помечен к уборке');
    assert.equal(file(f4).deletedAt, null);
    // удаление всех: файлы помечены, список пуст
    cur = (await state(srv, boss.cookie)).products.find(x => x.id === 'u-ph30');
    assert.equal((await put(srv, anna.cookie, cur, { ...cur, photos: [] })).status, 200);
    assert.deepEqual([f1, f2, f3, f4].map(refs), [0, 0, 0, 0]);
    assert.ok([f1, f2, f3, f4].every(f => file(f).deletedAt !== null), 'удалённые не помечены к уборке');
    srv.clock.t = T0 + 29 * DAY; srv.app.tick();
    assert.ok([f1, f2, f3, f4].every(onDisk), 'файлы стёрты раньше 30 дней');
    srv.clock.t = T0 + 31 * DAY; srv.app.tick();
    assert.ok([f1, f2, f3, f4].every(f => !onDisk(f)), 'через 30 дней файлы остались');
    assert.equal(dbRows(srv, 'SELECT COUNT(*) AS n FROM files WHERE id IN (?, ?, ?, ?)', f1.id, f2.id, f3.id, f4.id)[0].n, 0, 'записи о стёртых файлах остались');
  } finally { await srv.stop(); }
});

test('фото товара: удаление самого товара тоже снимает привязку', async () => {
  const srv = await start();
  try {
    const { boss } = await firm(srv);
    const f = (await upload(srv, boss.cookie, PNG, 'п.png')).body;
    const p = product('u-ph40', [photoOf(f)]);
    assert.equal((await put(srv, boss.cookie, null, p)).status, 200);
    assert.equal(dbRows(srv, 'SELECT * FROM file_refs WHERE fileId = ?', f.id).length, 1);
    const r = await changes(srv, boss.cookie, [{ key: 'products', id: 'u-ph40', base: p, deleted: true }]);
    assert.equal(r.status, 200, r.text);
    assert.equal(dbRows(srv, 'SELECT * FROM file_refs WHERE fileId = ?', f.id).length, 0);
    assert.notEqual(dbRows(srv, 'SELECT deletedAt FROM files WHERE id = ?', f.id)[0].deletedAt, null);
  } finally { await srv.stop(); }
});
