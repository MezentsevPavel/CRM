'use strict';
// Справочник соответствий названий рабочей таблицы остатков → позиции каталога (src/js/13-sheet-aliases.js) и товары, найденные на сайте.
// Директор 2026-11-13: «найди на сайте остальную информацию — артикул, бренд, цены».

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.js');

test('справочник: каждый ключ — нормализованное название, каждая позиция есть в каталоге; одна позиция — одна строка таблицы', () => {
  const a = load();
  const keys = new Set(a.CATALOG.rows.map(r => String(r.key)));
  const entries = Object.entries(a.SHEET_ALIASES);
  assert.ok(entries.length >= 50, 'в справочнике мало пар: ' + entries.length);
  for (const [name, key] of entries) {
    assert.equal(name, a.Catalog.norm(name), `ключ «${name}» не нормализован — Catalog.aliasOf его не найдёт`);
    assert.ok(keys.has(key), `«${name}»: позиции ${key} нет в каталоге`);
  }
  const byKey = {};
  for (const [name, key] of entries) (byKey[key] = byKey[key] || []).push(name);
  const twice = Object.entries(byKey).filter(([, v]) => v.length > 1);
  assert.deepEqual(twice, [], 'две строки таблицы на одну позицию — остатки сложились бы: ' + JSON.stringify(twice));
  assert.equal(a.Catalog.aliasOf('  СОЛНЕЧНАЯ панель HAVEL 320 '), a.SHEET_ALIASES['солнечная панель havel 320']);
  assert.equal(a.Catalog.aliasOf('Нет такой строки'), null);
});

test('товары, найденные на сайте по таблице остатков: у каждого ключ сайта, ссылка на карточку, бренд и артикул; цена — число или пусто', () => {
  const { CATALOG } = load();
  const rows = CATALOG.rows.filter(r => r.sheet === 'Из таблицы остатков');
  assert.ok(rows.length >= 30, 'найденных на сайте позиций мало: ' + rows.length);
  for (const r of rows) {
    assert.match(r.key, /^\d+$/, `${r.model}: ключ — не id товара сайта`);
    assert.match(r.url, /^https:\/\/www\.wind-solar\.ru\/collection\/[^/]+\/product\//, `${r.model}: ссылка не на карточку сайта`);
    assert.ok(r.brand && r.sku, `${r.model}: нет бренда или артикула — «нет данных» должно быть названо, а не выдумано`);
    assert.ok(r.price === null || r.price > 0, `${r.model}: цена не число и не пусто`);
  }
});

test('экран «Перенос»: строки без пары, которые знает справочник, сразу указаны и видны в «Указано вами»; «Отменить» возвращает строку в список', async () => {
  const { start, director } = require('./server-kit.js');
  const srv = await start();
  try {
    const boss = await director(srv);
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
    assert.equal(await app.serverLogin(boss.login, boss.password), 'ready');
    const tab = app.SETTINGS_TABS.find(t => t.id === 'transfer');
    const csv = ['Товар,Склад ИП,НПП,ВС,ответхранение,В пути,Резерв,Бой', 'Панели,,,,,,,', 'Солнечная панель HAVEL 340,28,,,,,,2', 'Неведомая штука-1,5,,,,,,'].join('\n');
    app.trStockRead(new TextEncoder().encode(csv));
    const html = tab.render();
    assert.match(html, /Не нашли пару в каталоге: 1\./, 'знакомая справочнику строка осталась в списке');
    assert.match(html, /Указано вами \(1\)/);
    assert.match(html, /<b>1<\/b> строк сопоставлено с каталогом вручную/);
    const k = app.Catalog.norm('Солнечная панель HAVEL 340');
    app.A['tr-unlink']({ dataset: { k } });
    assert.match(tab.render(), /Не нашли пару в каталоге: 2\./, 'после «Отменить» строка не вернулась в список');
  } finally { await srv.stop(); }
});
