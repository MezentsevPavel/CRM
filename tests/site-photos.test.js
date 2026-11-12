'use strict';
// tools/site-photos.js (слова директора 2026-11-12: «нужно фото, и все фото сложить в отдельную папку под названием товара»):
// какие картинки берутся со страницы товара и как называются папки. Страницы здесь искусственные; сеть не нужна.

const test = require('node:test');
const assert = require('node:assert/strict');
const { galleryOf, folderName, readCatalog } = require('../tools/site-photos.js');

const U = (id, name) => `https://cdn.insales-shop.ru/images/products/1/4677/${id}/${name}`;

test('галерея страницы: оригиналы по порядку, без превью и @webp, каждое фото один раз; чужие картинки сайта не берутся', () => {
  const html = `<meta property="og:image" content="${U(11, 'A_01.png')}">
    <img src="${U(11, 'thumb_A_01.png')}"> <img src="${U(11, 'A_01.png')}@webp">
    <a href="${U(12, 'A_02.png')}"><img src="${U(12, 'small_A_02.png')}"></a>
    <img src="${U(13, 'A_03.jpg')}"> {"url":"${U(11, 'thumb_A_01.png')}&quot;,&quot;original_url&quot;:&quot;https:"}
    <img src="https://cdn.insales-shop.ru/images/collections/1/561/96592433/medium_baner.png">
    <img src="https://cdn.insales-shop.ru/assets/1/7332/favicon.png">`;
  assert.deepEqual(galleryOf(html), [U(11, 'A_01.png'), U(12, 'A_02.png'), U(13, 'A_03.jpg')]);
  assert.deepEqual(galleryOf('<p>нет картинок</p>'), []);
});

test('папка товара: название без знаков, запрещённых в Windows; длинное сокращается; одинаковые различаются ключом', () => {
  const used = new Set();
  assert.equal(folderName('Гибридный инвертор DEYE SUN-10K [10kW / 48V: MPPT?]', '1', used), 'Гибридный инвертор DEYE SUN-10K [10kW 48V MPPT]');
  assert.ok(folderName('Я'.repeat(300), '2', used).length <= 110);
  assert.equal(folderName('Панель 550 Вт', '3', used), 'Панель 550 Вт');
  assert.equal(folderName('Панель 550 вт', '4', used), 'Панель 550 вт (4)', 'дубль по названию без учёта регистра');
  assert.equal(folderName('...', '5', new Set()), 'товар 5');
});

test('снимок каталога читается: у товаров сайта есть ссылка на wind-solar.ru; товары поставщиков (Сибэлком и др.) ведут на чужие сайты — их скрипт пропускает', () => {
  const rows = readCatalog();
  assert.ok(rows.length > 200 && rows.every(r => r.key && r.model));
  const site = rows.filter(r => /^https:\/\/(www\.)?wind-solar\.ru\//.test(r.url || ''));
  assert.ok(site.length > 150, 'ссылок на сайт мало: ' + site.length);
  assert.ok(rows.some(r => r.url && !site.includes(r)), 'ожидались ссылки поставщиков');
});
