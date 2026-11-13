'use strict';
// Директор 2026-11-13: «по рабочей таблице (Google) синхронизировать остатки и резервы… в таблице указаны иногда просто Резерв —
// создать эти резервы». «Настройки → Перенос»: ссылка на Google-таблицу → сервер забирает лист CSV → тот же разбор и
// предпросмотр, что у файла → «Загрузить». Таблица здесь искусственная (в формате выгрузки Google: запятые); Google подменён.

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.js');
const { start, call, director, employee, state } = require('./server-kit.js');

const ID = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-ab';
const LINK = `https://docs.google.com/spreadsheets/d/${ID}/edit?pli=1&gid=302343963#gid=302343963`;
const CSV = [
  'Товар,Склад ИП,НПП,ВС,ответхранение,В пути,Резерв,Бой',
  'Солнечные панели,,,,,,,',
  'Панель Тест-630,17,,,,,14 шт Алексей Н,',
  'Модуль Тест-631,,138,180,,,"36шт автоношкин, 64 Алексей Н.",',
  'Инверторы,,,,,,,',
  'Инвертор Тест-20К,,1,,,,1шт- Резерв Новгородская 25( Под клиента),',
  'Инвертор Тест-3К,1 после ремонта,,,,,,',
].join('\n');

// Подмена Google: запоминает адреса, отдаёт то, что велели
function fakeGoogle() {
  const g = { urls: [], reply: { status: 200, type: 'text/csv; charset=utf-8', body: CSV }, fail: null };
  g.fetch = async url => {
    g.urls.push(url);
    if (g.fail) throw g.fail;
    const { status, type, body } = g.reply;
    return { ok: status >= 200 && status < 300, status, headers: { get: h => (/content-type/i.test(h) ? type : null) }, text: async () => body };
  };
  return g;
}

test('ссылка на Google-таблицу → адрес выгрузки листа CSV; чужие адреса — нет', () => {
  const { Import } = load();
  const exp = gid => `https://docs.google.com/spreadsheets/d/${ID}/export?format=csv&gid=${gid}`;
  assert.equal(Import.sheetCsvUrl(LINK), exp('302343963'));
  assert.equal(Import.sheetCsvUrl(`  docs.google.com/spreadsheets/d/${ID}/edit#gid=7 `), exp('7'));
  assert.equal(Import.sheetCsvUrl(`https://docs.google.com/spreadsheets/d/${ID}`), exp('0'), 'лист не указан — первый');
  for (const bad of ['', 'Остатки', `https://docs.google.com.evil.example/spreadsheets/d/${ID}/edit`, `https://evil.example/docs.google.com/spreadsheets/d/${ID}`,
    'https://docs.google.com/spreadsheets/d/short/edit', `https://docs.google.com/document/d/${ID}/edit`]) {
    assert.equal(Import.sheetCsvUrl(bad), null, bad);
  }
});

async function firm(srv) {
  const boss = await director(srv);
  const ivan = await employee(srv, boss, { id: 'p5', name: 'Иван Кладовщиков (тест)', role: 'warehouse', dept: 'stock' });
  return { boss, ivan };
}

test('сервер: «взять из таблицы» — только директор; ходит только на docs.google.com; закрытая таблица и нет связи — понятная причина', async () => {
  const g = fakeGoogle(), srv = await start({ fetchSheet: g.fetch });
  try {
    const { boss, ivan } = await firm(srv);
    const post = (who, url) => call(srv, 'POST', '/api/import/sheet', { cookie: who.cookie, body: { url } });
    assert.equal((await post(ivan, LINK)).status, 403, 'кладовщику — нет');
    const bad = await post(boss, 'https://evil.example/x.csv');
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /не ссылка на Google-таблицу/);
    assert.equal(g.urls.length, 0, 'по чужой ссылке сервер куда-то ходил');
    const ok = await post(boss, LINK);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.csv, CSV);
    assert.deepEqual(g.urls, [`https://docs.google.com/spreadsheets/d/${ID}/export?format=csv&gid=302343963`]);
    // таблица не открыта по ссылке: Google отдаёт страницу входа
    g.reply = { status: 200, type: 'text/html; charset=utf-8', body: '<html>вход</html>' };
    const shut = await post(boss, LINK);
    assert.equal(shut.status, 422);
    assert.match(shut.body.error, /Все, у кого есть ссылка/);
    g.reply = { status: 404, type: 'text/html', body: '' };
    assert.match((await post(boss, LINK)).body.error, /не найдены/);
    g.fail = new Error('ECONNRESET');
    const off = await post(boss, LINK);
    assert.equal(off.status, 422, 'ошибка Google не должна выглядеть как «сервер не отвечает» (5xx)');
    assert.match(off.body.error, /Нет связи с Google/);
    assert.deepEqual((await state(srv, boss.cookie)).stock, {}, 'получение таблицы само ничего не меняет');
  } finally { await srv.stop(); }
});

// Страница в серверном режиме, вошедшая под who; fetch — в тестовый сервер с cookie
async function openPage(srv, who) {
  const jar = { cookie: '' };
  const bfetch = async (url, opt = {}) => {
    const headers = { ...(opt.headers || {}) };
    if (jar.cookie) headers.cookie = jar.cookie;
    const res = await fetch(srv.url + url, { ...opt, headers });
    const set = res.headers.get('set-cookie');
    if (set) jar.cookie = /Max-Age=0/i.test(set) ? '' : set.split(';')[0];
    return res;
  };
  const app = load({ globals: { CRM_SERVER: 1, fetch: bfetch, window: { addEventListener() {}, focus() {} }, location: { hash: '', reload() {} }, atob, Blob } });
  assert.equal(await app.serverBoot(), 'gate');
  assert.equal(await app.serverLogin(who.login, who.password), 'ready');
  return app;
}

test('экран «Перенос»: ссылка → «Взять из таблицы» → предпросмотр с резервами → «Загрузить» ставит резервы; ссылку помнит браузер', async () => {
  const g = fakeGoogle(), srv = await start({ fetchSheet: g.fetch });
  try {
    const { boss } = await firm(srv);
    const app = await openPage(srv, boss);
    const tab = app.SETTINGS_TABS.find(t => t.id === 'transfer');
    assert.match(tab.render(), /data-form="tr-sheet"/);
    assert.match(tab.render(), /Взять из таблицы/);
    // пустая ссылка — причина, на сервер не ходим
    app.byId('tr-sheet-url').value = ' ';
    await app.FORMS['tr-sheet']();
    assert.match(tab.render(), /Вставьте ссылку/);
    assert.equal(g.urls.length, 0);
    app.byId('tr-sheet-url').value = LINK;
    await app.FORMS['tr-sheet']();
    const html = tab.render();
    assert.match(html, /В таблице найдено/);
    assert.match(html, /<b>4<\/b> резервов из колонки/, '14 + 36 + 64 + 1 — четыре резерва');
    assert.match(html, /1 после ремонта/, 'текст в числовой клетке назван');
    assert.equal(app.storage['crm-sheet-link'], LINK);
    assert.match(tab.render(), new RegExp(`value="${LINK.replace(/[.?*+^$[\]\\(){}|-]/g, '\\$&').replace(/&/g, '&amp;')}"`), 'ссылка не осталась в поле');
    // «Загрузить» — тем же /api/import/stock: резервы без сделки, количество — резервом, остальное — «для кого»
    await app.FORMS['tr-stock']();
    const st = await state(srv, boss.cookie);
    const rs = st.reserves.filter(r => r.imported).map(r => [r.qty, r.note]).sort((a, b) => a[0] - b[0]);
    assert.deepEqual(rs, [[1, 'Резерв Новгородская 25( Под клиента)'], [14, 'Алексей Н'], [36, 'автоношкин'], [64, 'Алексей Н.']]);
    assert.ok(st.reserves.every(r => !r.dealId));
    // таблица обновилась — повтор берёт новое, старые резервы переноса сверяются, а не удваиваются
    g.reply = { status: 200, type: 'text/csv', body: CSV.replace('14 шт Алексей Н', '10 шт Алексей Н') };
    await app.FORMS['tr-sheet']();
    await app.FORMS['tr-stock']();
    const st2 = await state(srv, boss.cookie);
    assert.deepEqual(st2.reserves.filter(r => r.imported).map(r => r.qty).sort((a, b) => a - b), [1, 10, 36, 64]);
  } finally { await srv.stop(); }
});
