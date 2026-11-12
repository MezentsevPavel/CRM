'use strict';
// Лист «ИБП и контроллеры» (слова директора 2026-11-12: «в товарах нет ИБП и контроллеров — засунь их с сайта в таблицу и оттуда в CRM»):
// tools/catalog-snapshot.js --extra добавляет позиции листа в снимок каталога, не трогая остальные. Лист здесь искусственный.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const gen = require('../tools/catalog-snapshot.js');
const { load } = require('./load.js');

const HEADER = ['Ключ (id каталога) — не менять', 'Модель (название на сайте)', 'Бренд', 'Вид', 'Цена сайта, ₽', 'Наличие', 'Ссылка', 'Артикул (с сайта)'];
const W = 'https://www.wind-solar.ru/collection/';
const prev = () => gen.load(fs.readFileSync(gen.FILE, 'utf8'));
const js = x => JSON.parse(JSON.stringify(x));

test('лист «ИБП и контроллеры»: позиции попадают в снимок с видом по названию и ссылке; чужие позиции целы; пустая цена и артикул — null', () => {
  const p = prev();
  const known = p.rows.find(r => r.sheet !== 'Электрика' && r.sheet !== gen.EXTRA_SHEET);
  const extra = { date: '2026-11-12', header: HEADER, rows: [
    ['9000001', 'ИБП MUST EP20-1000 PRO [1000VA / 900W]', 'MUST', 'ИБП', '25 900', 'в наличии', W + 'must-ups/product/ibp-must', 'EP20-1000'],
    ['9000002', 'Контроллер заряда MPPT SCC-3024 30A', 'WINDSOLAR', 'Контроллер заряда', '4 320,50', 'предзаказ', W + 'mppt-kontrollery-zaryada-2/product/scc-3024', ''],
    ['9000003', 'Контроллер заряда PWM 20A', '', 'Контроллер заряда', '0', 'предзаказ', W + 'pwm-kontrollery-zaryada-2/product/pwm-20', null],
    ['9000005', 'Контроллер заряда DY1024DU [10A / 12/24V / USB]', 'WINDSOLAR', 'Контроллер заряда', '880', 'в наличии', W + 'pwm-kontrollery-zaryada-2/product/dy1024du', 'DY1024DU'],
    [known.key, 'Дубль позиции другого листа', '', 'ИБП', '1', '', '', ''],
    ['9000004', 'Что-то непонятное', '', 'Стабилизатор', '1', '', '', ''],
    ['9000001', 'Повтор строки', '', 'ИБП', '1', '', '', ''],
  ] };
  const { catalog, report } = gen.buildExtra(p, extra);
  const mine = catalog.rows.filter(r => r.sheet === gen.EXTRA_SHEET);
  assert.equal(mine.length, 4);
  assert.equal(report.added, 4);
  assert.deepEqual(js(report.knownElsewhere), ['Дубль позиции другого листа']);
  assert.deepEqual(js(report.noKind), ['Что-то непонятное']);
  assert.deepEqual(js(report.dupes), ['Повтор строки']);
  const by = k => mine.find(r => r.key === k);
  assert.deepEqual(js([by('9000001').cat, by('9000001').price, by('9000001').sku, by('9000001').brand]), ['ИБП', 25900, 'EP20-1000', 'MUST']);
  assert.equal(by('9000002').cat, 'Контроллеры › MPPT');
  assert.equal(by('9000002').price, 4320.5);
  assert.equal(by('9000002').sku, null, 'пустой артикул — нет данных, не пустая строка');
  assert.equal(by('9000003').cat, 'Контроллеры › PWM (ШИМ)');
  assert.equal(by('9000003').price, null, 'цена 0 на сайте — нет данных, не 0');
  assert.equal(by('9000003').brand, null);
  assert.equal(by('9000005').cat, 'Контроллеры › PWM (ШИМ)', 'в названии вида нет — берётся из раздела сайта в ссылке');
  // остальные позиции не тронуты
  assert.equal(catalog.rows.filter(r => r.sheet !== gen.EXTRA_SHEET).length, p.rows.filter(r => r.sheet !== gen.EXTRA_SHEET).length);
  assert.deepEqual(js(catalog.rows.find(r => r.key === known.key)), js(known));
});

test('повторный прогон того же листа даёт тот же снимок; файл читается обратно; позиции видны в каталоге как товары нужных видов', () => {
  const src = fs.readFileSync(gen.FILE, 'utf8');
  const extra = { date: '2026-11-12', header: HEADER, rows: [
    ['9000001', 'ИБП MUST EP20-1000 PRO [1000VA / 900W]', 'MUST', 'ИБП', '25900', 'в наличии', W + 'must-ups/product/ibp-must', 'EP20-1000'],
    ['9000002', 'Контроллер заряда MPPT SCC-3024 30A', 'WINDSOLAR', 'Контроллер заряда', '4320', 'предзаказ', W + 'mppt-kontrollery-zaryada-2/product/scc-3024', 'SCC-3024'],
  ] };
  const one = gen.buildExtra(gen.load(src), extra).catalog;
  const text1 = gen.render(src, one, extra.date);
  const two = gen.buildExtra(gen.load(text1), extra).catalog;
  assert.equal(gen.render(text1, two, extra.date), text1, 'повторный прогон меняет файл');
  assert.deepEqual(js(gen.load(text1).rows.filter(r => r.sheet === gen.EXTRA_SHEET).map(r => r.key)), ['9000001', '9000002']);
  assert.match(text1, /Листы: .*Электрика, ИБП и контроллеры\./);
  // в самой странице: товары нужных видов
  const a = load();
  const built = a.Catalog.build({ ...a.CATALOG, rows: gen.load(text1).rows }, { rows: [] }).products;
  assert.equal(built.find(p => p.id === '9000001').cat, 'ИБП');
  assert.equal(built.find(p => p.id === '9000002').cat, 'Контроллеры › MPPT');
});

test('в снимке уже лежат ИБП и контроллеры с сайта: позиции листа есть, у всех вид и ссылка на сайт', () => {
  const rows = prev().rows.filter(r => r.sheet === gen.EXTRA_SHEET);
  assert.ok(rows.length >= 50, 'ИБП и контроллеров в снимке мало: ' + rows.length);
  assert.ok(rows.some(r => r.cat === 'ИБП') && rows.some(r => r.cat.startsWith('Контроллеры')));
  assert.ok(rows.every(r => /^https:\/\/www\.wind-solar\.ru\//.test(r.url)), 'ссылка не на сайт');
  assert.ok(rows.every(r => r.price === null || r.price > 0), 'в цене не должно быть нуля');
  assert.ok(rows.every(r => !r.cat.endsWith('Без подкатегории')), 'есть контроллеры без вида: ' + rows.filter(r => r.cat.endsWith('Без подкатегории')).map(r => r.model).join('; '));
});
