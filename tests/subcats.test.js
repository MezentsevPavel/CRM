'use strict';
// Слова директора 2026-11-08: «В дереве каталога сделать раскрывающийся список: нажимаю на инверторы — все в инверторах, но должна быть
// раскрывающаяся галочка (стрелка)… Инверторы → сетевые, гибридные, автономные → далее фирма. Добавить категорию ИБП… Аккумуляторы разбить
// на литий-железофосфат, АГМ, гель, АГМ+гель, гель-карбон, АГМ-карбон… Контроллеры — MPPT или PWM (ШИМ). Защита и соединение — автоматически…
// Панели сразу по фирмам. Когда в фирму заходишь — весь список этой фирмы, разные мощности».
// Здесь: разбор по видам (Catalog.classify — настоящие названия из таблицы каталога и листа остатков), снимок каталога, Catalog.merge,
// шаг MIGRATIONS[22] рабочей базы и экран (стрелка, уровень «фирма», согласованность с фильтром «Бренд», раскрытое не сохраняется).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { load } = require('./load.js');
const kit = require('./server-kit.js');
const gen = require('../tools/catalog-snapshot.js');

const NOW = new Date(2026, 10, 8, 12, 0, 0);
const SEP = ' › ';
const plain = v => JSON.parse(JSON.stringify(v === undefined ? null : v));

// ——— разбор по видам ———
// [верхняя категория, название, ссылка, столбцы таблицы, ожидаемый путь]. Названия — настоящие (таблица каталога PVCalc и лист «Остатки»).
const NONE = SEP + 'Без подкатегории';
const CASES = [
  ['Инверторы', 'Сетевой инвертор DEYE-SUN-20K-G05', '', null, 'Инверторы › Сетевые'],
  ['Инверторы', 'Сетевой солнечный инвертор DEYE-SUN-30K-G05 (30kW / 3P / PV 39 kW)', '', null, 'Инверторы › Сетевые'],
  ['Инверторы', 'Сетевой микроинвертор DEYE SUN1600G3-EU-230 (1600W / 1P)', '', null, 'Инверторы › Сетевые'],
  ['Инверторы', 'Гибридный инвертор GD6248SMH', '', null, 'Инверторы › Гибридные'],
  ['Инверторы', 'Гибридный солнечный инвертор SILA V 1000M', '', null, 'Инверторы › Гибридные'],
  ['Инверторы', 'Солнечный инвертор SMARTWATT INV HYBRID II, 6.2 кВт, АКБ 48 В, 1 фаза, 1 MPPT', '', null, 'Инверторы › Гибридные'],
  ['Инверторы', 'Автономный инвертор СибКонтакт ИС-12-1500V (DC-AC / 12В-220В / 1500Вт)', '', null, 'Инверторы › Автономные'],
  ['Инверторы', 'Автономный инвертор СибКонтакт СибВатт 2024 [DC-AC / 24В-220В / 2000Вт]', '', null, 'Инверторы › Автономные'],
  ['Инверторы', 'ИБП MUST EP20-300 PRO Wall (12В / 300Вт / 10A / Настенный)', '', null, 'ИБП'],
  ['Инверторы', 'Источник бесперебойного питания МАП SIN 9кВт 24В GHYBRID', '', null, 'ИБП'],
  // в названии вида нет: берутся столбцы таблицы, потом ссылка на сайте; нигде не сказано — «Без подкатегории»
  ['Инверторы', 'Солнечный инвертор Энергия SunWatt 3200 (3200W / 24V / PV 3500W 30-450В / MPPT)', '', null, 'Инверторы' + NONE],
  ['Инверторы', 'Солнечный инвертор Энергия SunWatt 3200 (3200W / 24V / PV 3500W 30-450В / MPPT)', '', { hybrid: 'да' }, 'Инверторы › Гибридные'],
  ['Инверторы', 'Солнечный инвертор Энергия SunWatt 3200 (3200W / 24V / PV 3500W 30-450В / MPPT)', '', { hybrid: 'нет' }, 'Инверторы › Сетевые'],
  ['Инверторы', 'Солнечный инвертор Энергия SunWatt 3200', 'https://www.wind-solar.ru/collection/Hybrid-Inverters-DEYE/product/x', null, 'Инверторы › Гибридные'],
  ['Инверторы', 'Солнечный инвертор Энергия SunWatt 3200', 'https://www.wind-solar.ru/collection/On-Grid-Inverters/product/x', null, 'Инверторы › Сетевые'],
  ['Инверторы', 'Модуль TechFine WIFI Doungle', '', null, 'Инверторы' + NONE],
  // аккумуляторы
  ['Аккумуляторы', 'Аккумуляторная батарея WINDSOLAR LFP Smart BLOCK 12V 100AH (100AH / 12.8V / 1280WH / BMS)', '', null, 'Аккумуляторы › Литий-железофосфат (LiFePO4)'],
  ['Аккумуляторы', 'Аккумуляторная батарея Dyness A48100 (100Ah / 48V / 4800Wh / LiFePO4)', '', null, 'Аккумуляторы › Литий-железофосфат (LiFePO4)'],
  ['Аккумуляторы', 'Аккумуляторная батарея PylonTech US2000C', 'https://www.wind-solar.ru/collection/PYLONTECH-Battery-LiFePO4/product/x', null, 'Аккумуляторы › Литий-железофосфат (LiFePO4)'],
  ['Аккумуляторы', 'Аккумуляторная батарея PylonTech US2000C', '', { chem: 'LiFePO4' }, 'Аккумуляторы › Литий-железофосфат (LiFePO4)'],
  ['Аккумуляторы', 'Аккумуляторная батарея VEKTOR ENERGY GPL 12-100 [100Ah / 12V / AGM]', '', null, 'Аккумуляторы › АГМ'],
  ['Аккумуляторы', 'Аккумуляторная батарея VEKTOR ENERGY GPL 12-26 (26Ah / 12V / AGM)', '', null, 'Аккумуляторы › АГМ'],
  ['Аккумуляторы', 'Аккумуляторная батарея VEKTOR ENERGY GEL 12-100 [100Ah / 12V / AGM+GEL]', '', null, 'Аккумуляторы › АГМ+Гель'],
  ['Аккумуляторы', 'Аккумуляторная батарея VEKTOR ENERGY GL 12-55 [55Ah / 12V / AGM+GEL]', '', null, 'Аккумуляторы › АГМ+Гель'],
  ['Аккумуляторы', 'Аккумуляторная батарея VEKTOR ENERGY VPbC 12-100 [100Ah / 12V / GEL+CARBON]', '', null, 'Аккумуляторы › Гель-карбон'],
  ['Аккумуляторы', 'Аккумуляторная батарея VEKTOR ENERGY VRC 12-200 (200Ah / 12V / AGM+CARBON)', '', null, 'Аккумуляторы › АГМ-карбон'],
  ['Аккумуляторы', 'Аккумуляторная батарея 12V 100Ah [12V / GEL]', '', null, 'Аккумуляторы › Гель'],   // в таблице одиночного геля нет: название выдумано только для проверки
  ['Аккумуляторы', 'Аккумуляторная батарея VEKTOR ENERGY HRL 12-410W [115Ah / 12V ]', '', null, 'Аккумуляторы' + NONE],
  ['Аккумуляторы', 'AVANBAT 12-40', '', null, 'Аккумуляторы' + NONE],
  // зарядные устройства и балансиры лежат в разделе аккумуляторов, но аккумуляторами не являются — даже если в названии LiFePO4
  ['Аккумуляторы', 'Зарядное устройство для LiFePO4 АКБ SCLP12-10 (12В / 10А / 20-480Ач)', '', null, 'Аккумуляторы' + NONE],
  ['Аккумуляторы', 'DELTA LFP Charger 24V60F 1500ВТ', '', null, 'Аккумуляторы' + NONE],
  ['Аккумуляторы', 'Балансир TAICO Battery Equalizer ВЕ24M [2 АКБ / LCD]', '', null, 'Аккумуляторы' + NONE],
  // контроллеры
  ['Контроллеры', 'Контроллер КЭС DOMINATOR MPPT 200/100', '', null, 'Контроллеры › MPPT'],
  ['Контроллеры', 'Контроллер заряда SRNE MPPT MC2420N10 [20A / 12/24V / 260/520W]', '', null, 'Контроллеры › MPPT'],
  ['Контроллеры', 'Контроллер заряда JUTA CM6024Z [60A / 12/24V / USB / PWM]', '', null, 'Контроллеры › PWM (ШИМ)'],
  ['Контроллеры', 'Rонтроллер заряда ШИМ LS102460EPLI', '', null, 'Контроллеры › PWM (ШИМ)'],
  ['Контроллеры', 'Контроллер заряда SRNE HP2420 PWM 20A [20A / 12/24V / USB] шим', '', null, 'Контроллеры › PWM (ШИМ)'],
  ['Контроллеры', 'Контроллер EPSolar LS2024100EPLI [20A / 12/24V]', '', null, 'Контроллеры' + NONE],
  ['Контроллеры', 'Адаптер Bluetooth BT-2 для контроллеров SRNE серии MC', '', null, 'Контроллеры' + NONE],
  // защита и соединения
  ['Защита и соединения', 'Авт выключатель 2п 16А ВА47-63N С НОВАЯ ЛИНЕЙКА "EKF" PROXIMA', '', null, 'Защита и соединения › Автоматические выключатели'],
  ['Защита и соединения', 'Автоматический выключатель постоянного тока TOMZN TOB-7Z-63 [DIN / 25A / 2P / 1000V]', '', null, 'Защита и соединения › Автоматические выключатели'],
  ['Защита и соединения', 'Дифференциальный автомат АД14 C63А 8P', '', null, 'Защита и соединения › Автоматические выключатели'],
  ['Защита и соединения', 'Автомат защиты от перенапряжения Fangke HYS4-PV-500 2P', '', null, 'Защита и соединения › УЗИП'],
  ['Защита и соединения', 'УЗИП GULEI GL2 C40 Surge Protective Device', '', null, 'Защита и соединения › УЗИП'],
  ['Защита и соединения', 'Предохранитель ANL Fuse 150А (nominal 32V DC)', '', null, 'Защита и соединения › Предохранители'],
  ['Защита и соединения', 'Держатель предохранителя TOMZN TOPV-32 1100В', '', null, 'Защита и соединения › Предохранители'],
  ['Защита и соединения', 'Контактор IEK КМИ-23211 32А 230В/АС-3 1НЗ', '', null, 'Защита и соединения › Контакторы'],
  ['Защита и соединения', 'Коннектор MC4 AB [универсальный, комплект из двух разъемов]', '', null, 'Защита и соединения › Коннекторы MC4'],
  ['Защита и соединения', 'Наконечник ТМЛ 25-10-8 (100) РФ', '', null, 'Защита и соединения › Наконечники'],
  ['Защита и соединения', 'Провод ПуГВнг(А)-LS 1х25 бел Кабэкс ГОСТ', '', null, 'Защита и соединения › Кабель и провода'],
  ['Защита и соединения', 'Комплект проводов 1000/10х2 М6-2', '', null, 'Защита и соединения › Кабель и провода'],
  ['Защита и соединения', 'Корпус пласт ЩРН-П- 12 IP41 Basic', '', null, 'Защита и соединения › Щиты, корпуса и боксы'],
  ['Защита и соединения', 'Бокс HT8WAY', '', null, 'Защита и соединения › Щиты, корпуса и боксы'],
  ['Защита и соединения', 'Комплект крепления MAX для четырех панелей изменением угла наклона 0.5 метр', '', null, 'Защита и соединения › Крепёж и монтаж'],
  ['Защита и соединения', 'WS - Inter Clamp 30/35', '', null, 'Защита и соединения › Крепёж и монтаж'],
  ['Защита и соединения', 'Профтруба 40×20×2 мм', '', null, 'Защита и соединения › Крепёж и монтаж'],
  ['Защита и соединения', 'Токоизмерительные клещи SPLIT CORE CTSA016 на 100 А / 50 mA', '', null, 'Защита и соединения › Измерительные приборы'],
  ['Защита и соединения', 'Розетка Рар 10-3-ОП DIN', '', null, 'Защита и соединения' + NONE],
  ['Защита и соединения', 'Защитный диод MC4 30А (диод Шоттки)', '', null, 'Защита и соединения' + NONE],
  // у этих категорий видов нет
  ['Панели', 'Солнечная панель HAVEL 340', '', null, 'Панели'],
  ['Кабель', 'Комплект подключения Solar Cable 10м х 2 шт (4mm, M/F)', '', null, 'Кабель'],
];

test('Catalog.classify: вид по настоящим названиям — инверторы, ИБП, каждый вид АКБ, MPPT / PWM, защита; неопределённое — «Без подкатегории»', () => {
  const { Catalog } = load();
  for (const [top, name, url, spec, want] of CASES) assert.equal(Catalog.classify(top, { name, url, spec }), want, `${top}: «${name}»`);
});

test('Catalog.classify: столбцы таблицы сильнее ссылки, ссылка сильнее названия; «автономный» в названии сильнее «нет» в столбце «Гибрид»', () => {
  const { Catalog } = load();
  const hy = 'https://www.wind-solar.ru/collection/Hybrid-Inverters-DEYE/product/x';
  assert.equal(Catalog.classify('Инверторы', { name: 'Сетевой инвертор X', url: hy, spec: { hybrid: 'да' } }), 'Инверторы › Гибридные');
  assert.equal(Catalog.classify('Инверторы', { name: 'Сетевой инвертор X', url: hy }), 'Инверторы › Гибридные');
  assert.equal(Catalog.classify('Инверторы', { name: 'Сетевой инвертор X' }), 'Инверторы › Сетевые');
  assert.equal(Catalog.classify('Инверторы', { name: 'Автономный инвертор X', spec: { hybrid: 'нет' } }), 'Инверторы › Автономные');
});

test('Catalog.classifyLoose: позиция листа остатков без вида в названии получает вид по коду модели из каталога; два разных вида — не угадывает', () => {
  const { Catalog } = load();
  const pool = [
    { name: 'Гибридный солнечный инвертор BJ4024 (4 kW / 24V)', sku: 'BJ4024', cat: 'Инверторы › Гибридные' },
    { name: 'Сетевой солнечный инвертор DEYE-SUN-25K-G05 (25kW / 3P)', sku: 'DEYE-SUN-25K-G05', cat: 'Инверторы › Сетевые' },
    { name: 'Гибридный инвертор ZZ-5000 (5 kW)', sku: 'ZZ-5000', cat: 'Инверторы › Гибридные' },
    { name: 'Сетевой инвертор ZZ-5000X', sku: 'ZZ-5000X', cat: 'Инверторы › Сетевые' },
  ];
  assert.equal(Catalog.classifyLoose('Инверторы', 'BJ4024SMHGW', pool), 'Инверторы › Гибридные');
  assert.equal(Catalog.classifyLoose('Инверторы', 'Децентрализованный инвертор Deye SUN-25K-G05', pool), 'Инверторы › Сетевые');
  assert.equal(Catalog.classifyLoose('Инверторы', 'ZZ-5000', pool), 'Инверторы' + NONE, 'ZZ-5000 есть и в гибридном, и в сетевом — вид не назван');
  assert.equal(Catalog.classifyLoose('Инверторы', 'Нечто 12', pool), 'Инверторы' + NONE, 'короткое название не ищется');
  assert.equal(Catalog.classifyLoose('Панели', 'BJ4024SMHGW', pool), 'Панели', 'у панелей видов нет');
});

// ——— снимок ———
test('снимок: у каждой позиции каталога путь категории из постоянных узлов или «Без подкатегории»; верхняя категория прежняя; «Электрика» не тронута', () => {
  const { CATALOG, Catalog } = load();
  const was = { 'панель': 'Панели', 'инвертор': 'Инверторы', 'АКБ': 'Аккумуляторы', 'защита и соединения': 'Защита и соединения', 'кабель': 'Кабель' };
  const ok = new Set(Catalog.STRUCT_PATHS);
  for (const r of CATALOG.rows) {
    if (r.sheet === 'Электрика') { assert.ok(/^Электрика( › |$)/.test(r.cat), r.key); continue; }
    assert.ok(!was[r.cat], `${r.key}: в снимке осталась прежняя запись вида «${r.cat}»`);
    const top = r.cat.split(SEP)[0];
    assert.ok(ok.has(r.cat) || r.cat === 'Кабель' || r.cat === top + NONE, `${r.key}: категория «${r.cat}»`);
  }
  const n = path => CATALOG.rows.filter(r => r.cat === path).length;
  assert.ok(n('Инверторы › Гибридные') > 40 && n('Инверторы › Сетевые') > 15, 'инверторы разобраны');
  assert.equal(n('ИБП'), 77, 'ИБП с сайта (лист «ИБП и контроллеров»): 77 позиций');
  assert.ok(n('Аккумуляторы › Литий-железофосфат (LiFePO4)') >= 40);
});

test('tools/catalog-snapshot.js: путь категории пишется в снимок по столбцам таблицы, повторный прогон даёт тот же файл', () => {
  const rowOf = (key, model, cat, url) => ({ key, model, brand: 'B', price: 1, avail: null, url, from: null, cat, sheet: 'Инверторы' });
  const prev = { source: 's', snapshot: '2026-10-31', rows: [
    rowOf('1', 'Солнечный инвертор Энергия 1', 'инвертор', null), rowOf('2', 'Солнечный инвертор Энергия 2', 'инвертор', null),
    rowOf('3', 'Аккумуляторная батарея Z', 'АКБ', null), rowOf('4', 'Панель', 'панель', null), rowOf('5', 'Предохранитель ANL', 'защита и соединения', null)] };
  const head = ['Код позиции', 'Название', 'Артикул', 'Ед.', 'Цена', 'Дата цены', 'Ссылка'];
  const dump = { date: '2026-11-08', sheets: { 'Инверторы': [['1', 'a'], ['2', 'b']] }, electrics: { header: head, rows: [] },
    specs: { 1: { hybrid: 'да' }, 2: { hybrid: 'нет' }, 3: { chem: 'LiFePO4' } } };
  const { catalog, report } = gen.build(prev, dump);
  assert.deepEqual(catalog.rows.map(r => r.cat), ['Инверторы › Гибридные', 'Инверторы › Сетевые', 'Аккумуляторы › Литий-железофосфат (LiFePO4)', 'Панели', 'Защита и соединения › Предохранители']);
  assert.deepEqual(plain(report.noSub), []);
  const file = gen.render('// шапка\r\n// cat — вид позиции; sheet — лист таблицы, откуда она взята.\r\nconst CATALOG = {};\r\n', catalog, '2026-11-08');
  assert.ok(file.includes('// cat — категория: путь'), 'описание поля cat в шапке обновлено');
  const again = gen.build(gen.load(file), dump).catalog;
  assert.deepEqual(plain(again), plain(catalog), 'повторный прогон: путь остаётся путём');
  assert.equal(gen.render(file, again, '2026-11-08'), file);
  // без столбцов таблицы вид берётся из названия и ссылки; «Энергия» без слов о виде — «Без подкатегории», в отчёте
  const bare = gen.build(prev, { ...dump, specs: {} });
  assert.equal(bare.catalog.rows[0].cat, 'Инверторы' + NONE);
  assert.deepEqual(plain(bare.report.noSub), ['Солнечный инвертор Энергия 1', 'Солнечный инвертор Энергия 2', 'Аккумуляторная батарея Z']);
});

// ——— дерево категорий ———
test('дерево: постоянные узлы — Инверторы (3 вида), ИБП, Аккумуляторы (6 видов), Контроллеры (MPPT и PWM), Защита и соединения, Панели; ИБП — 77 с сайта', () => {
  const a = load(), s = a.seedBase();
  for (const [what, st] of [['демо', a.S], ['seedBase', s]]) {
    const kids = top => plain(st.categories.filter(c => c.parentId === (a.Catalog.nodeOf(st, top) || {}).id).map(c => c.name));
    assert.deepEqual(kids('Инверторы').slice(0, 3), ['Сетевые', 'Гибридные', 'Автономные'], what);
    assert.deepEqual(kids('Аккумуляторы').slice(0, 6), ['Литий-железофосфат (LiFePO4)', 'АГМ', 'Гель', 'АГМ+Гель', 'Гель-карбон', 'АГМ-карбон'], what);
    assert.deepEqual(kids('Контроллеры').slice(0, 2), ['MPPT', 'PWM (ШИМ)'], what);
    assert.ok(kids('Защита и соединения').includes('Автоматические выключатели') && kids('Защита и соединения').includes('Предохранители'), what);
    assert.deepEqual(kids('Панели'), [], `${what}: у панелей видов нет — сразу фирмы`);
    assert.ok(a.Catalog.nodeOf(st, 'ИБП'), `${what}: узла ИБП нет`);
    assert.deepEqual(plain(st.categories.filter(c => !c.parentId).map(c => c.name).slice(0, 6)), ['Панели', 'Инверторы', 'ИБП', 'Аккумуляторы', 'Контроллеры', 'Защита и соединения'], what);
    for (const p of st.products) assert.equal(a.Catalog.hasPath(st, p.cat), true, `${what}: у «${p.name}» категории «${p.cat}» нет в дереве`);
  }
  // в базе без остатков листа ИБП — 77 с сайта (лист «ИБП и контроллеры»)
  assert.equal(s.products.filter(p => p.cat === 'ИБП').length, 77);
  // в демо к ним добавлен один ИБП из листа остатков, по названию («МАП SIN»); второй («MUST EP20-300 PRO Wall») склеился с позицией каталога
  const ups = plain(a.S.products.filter(p => p.cat === 'ИБП').map(p => p.name));
  assert.equal(ups.length, 78);
  assert.ok(ups.includes('Источник бесперебойного питания МАП SIN 9кВт 24В GHYBRID'));
  assert.equal(ups.filter(n => /MUST EP20-300 PRO WALL/i.test(n)).length, 1, 'ИБП MUST EP20-300 PRO Wall продублирован');
});

test('демо: позиции листа остатков разобраны по виду (в том числе по коду модели), аксессуары не попали в аккумуляторы по видам', () => {
  const { S } = load();
  const cat = name => S.products.find(p => p.name === name).cat;
  assert.equal(cat('Автономный инвертор СибКонтакт ИС-12-1500V (DC-AC / 12В-220В / 1500Вт)'), 'Инверторы › Автономные');
  assert.equal(cat('BJ4024SMHGW'), 'Инверторы › Гибридные');
  assert.equal(cat('DEYE SE-F5-windows'), 'Аккумуляторы › Литий-железофосфат (LiFePO4)');
  assert.equal(cat('Контроллер КЭС DOMINATOR MPPT 200/100'), 'Контроллеры › MPPT');
  assert.equal(cat('Зарядное устройство WG-24BC 1500M (24В 50А)'), 'Аккумуляторы' + NONE);
  assert.equal(cat('Авт выключатель FPV-63-550 (32)'), 'Защита и соединения › Автоматические выключатели');
  // демо-ссылки (резервы, поставки) по-прежнему ведут на товары нужных видов
  for (const r of S.reserves) assert.ok(S.products.some(p => p.id === r.productId), 'резерв ведёт на несуществующий товар');
});

// ——— Catalog.merge: товар с прежней верхней категорией ———
function oldCats(a) {
  // база «как была» (ревизия 21): у всех товаров верхняя категория без вида, дерево без новых узлов
  const { Catalog, CATALOG } = a;
  const legacy = { 'Инверторы': 1, 'Аккумуляторы': 1, 'Контроллеры': 1, 'Защита и соединения': 1 };
  const st = { products: Catalog.build(CATALOG, { rows: [] }).products.map(p => ({ ...p, cat: legacy[p.cat.split(SEP)[0]] ? p.cat.split(SEP)[0] : p.cat })) };
  st.categories = [];
  for (const top of ['Панели', 'Инверторы', 'Аккумуляторы', 'Защита и соединения', 'Электрика']) Catalog.ensure(st, top);
  return st;
}
const sheetProduct = (id, name, cat) => ({ id, name, brand: null, cat, price: null, avail: null, url: null, src: 'sheet', inCatalog: false });

test('Catalog.merge: прежняя верхняя категория получает вид; ИБП уходят в «ИБП»; категория, поставленная руками, не меняется; повтор ничего не меняет', () => {
  const a = load(), { Catalog, CATALOG } = a;
  const st = oldCats(a);
  const site = k => st.products.find(p => p.id === CATALOG.rows.find(r => r.cat === k).key);
  const hybrid = st.products.find(p => p.id === CATALOG.rows.find(r => r.cat === 'Инверторы › Гибридные').key);
  const grid = st.products.find(p => p.id === CATALOG.rows.find(r => r.cat === 'Инверторы › Сетевые').key);
  const manual = st.products.find(p => p.id === CATALOG.rows.find(r => r.cat === 'Инверторы › Гибридные' && r.key !== hybrid.id).key);
  manual.cat = 'Электрика'; manual.price = 7;      // директор перенёс вручную
  const kept = st.products.find(p => p.id === CATALOG.rows.find(r => r.cat === 'Панели').key);
  st.products.push(sheetProduct('sheet:ups', 'ИБП Тестовый 1000', 'Инверторы'), sheetProduct('sheet:agm', 'Аккумуляторная батарея ТЕСТ [100Ah / 12V / AGM]', 'Аккумуляторы'),
    sheetProduct('sheet:own', 'Что-то вручную', 'Электрика'), sheetProduct('sheet:none', 'Прибор без вида 77', 'Защита и соединения'));
  assert.equal(hybrid.cat, 'Инверторы');
  const r = Catalog.merge(st, CATALOG);
  assert.equal(hybrid.cat, 'Инверторы › Гибридные'); assert.equal(grid.cat, 'Инверторы › Сетевые');
  assert.equal(manual.cat, 'Электрика', 'ручная категория не перетирается'); assert.equal(manual.price, 7);
  assert.equal(kept.cat, 'Панели');
  const by = id => st.products.find(p => p.id === id);
  assert.equal(by('sheet:ups').cat, 'ИБП'); assert.equal(by('sheet:agm').cat, 'Аккумуляторы › АГМ');
  assert.equal(by('sheet:own').cat, 'Электрика'); assert.equal(by('sheet:none').cat, 'Защита и соединения' + NONE);
  assert.ok(r.recat.includes(hybrid.id) && r.recat.includes('sheet:ups') && !r.recat.includes(manual.id));
  assert.ok(r.filled.includes(hybrid.id) && r.filled.includes('sheet:agm'), 'перекатегоризованные записаны как изменённые');
  for (const p of st.products) assert.equal(Catalog.hasPath(st, p.cat), true, `у «${p.name}» категории «${p.cat}» нет в дереве`);
  for (const path of Catalog.STRUCT_PATHS) assert.ok(Catalog.nodeOf(st, path), `нет узла «${path}»`);
  assert.ok(r.categories.length >= 10, 'новые узлы дерева перечислены');
  const again = Catalog.merge(st, CATALOG);
  assert.deepEqual([again.added.length, again.filled.length, again.recat.length, again.categories.length], [0, 0, 0, 0]);
  void site;
});

// ——— сервер: шаг 22 ———
test('сервер: база ревизии 21 доводится до 22 — новые узлы дерева, товар с прежней верхней категорией получает вид, ручная категория и цена остаются', async () => {
  const srv = await kit.start();
  const dir = srv.dir;
  await kit.director(srv);
  await srv.stop(true);
  const a = load(), { CATALOG } = a;
  const file = path.join(dir, 'crm.db');
  const d = new DatabaseSync(file);
  // база «как была»: дерево без видов, правленые товары лежат документами со старой категорией
  d.prepare("DELETE FROM docs WHERE key = 'categories'").run();
  const tops = ['Панели', 'Инверторы', 'Аккумуляторы', 'Контроллеры', 'Защита и соединения'];
  tops.forEach((n, i) => d.prepare("INSERT INTO docs (key, id, data, ver, seq) VALUES ('categories', ?, ?, 1, 0)").run('c' + (i + 1), JSON.stringify({ id: 'c' + (i + 1), name: n, parentId: null })));
  const row = CATALOG.rows.find(r => r.cat === 'Инверторы › Гибридные'), row2 = CATALOG.rows.find(r => r.cat === 'Инверторы › Гибридные' && r.key !== row.key);
  const base = a.Catalog.build(CATALOG, { rows: [] }).products;
  const edited = { ...base.find(p => p.id === row.key), cat: 'Инверторы', price: 12345 };       // правили цену, категория прежняя верхняя
  const moved = { ...base.find(p => p.id === row2.key), cat: 'Панели' };                          // директор перенёс руками
  const sheet = sheetProduct('sheet:тест агм', 'Аккумуляторная батарея ТЕСТ [100Ah / 12V / AGM+GEL]', 'Аккумуляторы');
  const own = { id: 'u-1', name: 'Мой инвертор', brand: null, cat: 'Инверторы', price: null, avail: null, url: null, src: 'user', inCatalog: false };
  for (const p of [edited, moved, sheet, own]) d.prepare("INSERT INTO docs (key, id, data, ver, seq) VALUES ('products', ?, ?, 1, 0)").run(p.id, JSON.stringify(p));
  d.prepare("UPDATE meta SET v = '21' WHERE k = 'rev'").run();
  d.close();
  const again = await kit.start({ dataDir: dir });
  try {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      assert.equal(db.prepare("SELECT v FROM meta WHERE k = 'rev'").get().v, String(a.Store.REV));
      const doc = (key, id) => { const r = db.prepare('SELECT data FROM docs WHERE key = ? AND id = ?').get(key, id); return r ? JSON.parse(r.data) : null; };
      assert.equal(doc('products', edited.id).cat, 'Инверторы › Гибридные'); assert.equal(doc('products', edited.id).price, 12345, 'цена правки не потеряна');
      assert.equal(doc('products', moved.id).cat, 'Панели', 'ручная категория не тронута');
      assert.equal(doc('products', sheet.id).cat, 'Аккумуляторы › АГМ+Гель');
      assert.equal(doc('products', 'u-1').cat, 'Инверторы', 'товар, заведённый руками, не тронут');
      const nodes = db.prepare("SELECT data FROM docs WHERE key = 'categories'").all().map(r => JSON.parse(r.data));
      const st = { categories: nodes };
      for (const p of a.Catalog.STRUCT_PATHS) assert.ok(a.Catalog.nodeOf(st, p), `нет узла «${p}»`);
      assert.equal(nodes.filter(n => !n.parentId && n.name === 'Инверторы').length, 1, 'верхний узел не задвоен');
    } finally { db.close(); }
  } finally { await again.stop(true); }
  // второй запуск ничего не меняет
  const before = new DatabaseSync(file, { readOnly: true });
  const n1 = before.prepare('SELECT COUNT(*) AS n FROM docs').get().n; before.close();
  const third = await kit.start({ dataDir: dir });
  await third.stop(true);
  const after = new DatabaseSync(file, { readOnly: true });
  assert.equal(after.prepare('SELECT COUNT(*) AS n FROM docs').get().n, n1); after.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ——— экран ———
function page() {
  const a = load({ now: NOW });
  a.setMe('p1');
  a.S.view = 'stock';
  a.render();
  return { a };
}
const rowsOf = html => [...String(html).matchAll(/<li class="ct-row([^"]*)" style="--d:(\d+)">(?:.*?)data-cat="([^"]*)"(?: data-brand="([^"]*)")?[^>]*>(?:<span>(.*?)<\/span><small>(\d+)<\/small>)/g)]
  .map(m => ({ cls: m[1], depth: Number(m[2]), cat: m[3], brand: m[4] === undefined ? null : m[4], name: m[5], n: Number(m[6]) }));
const dec = s => String(s).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const shown = html => Number(/Показано <b>(\d+)<\/b>/.exec(html)[1]);

test('экран: стрелка раскрывает и сворачивает виды (несколько уровней), название выбирает категорию и показывает товары всех её видов', () => {
  const { a } = page(), { A, Catalog, S } = a;
  const names = () => rowsOf(a.vStock()).map(r => r.name);
  assert.ok(!names().includes('Гибридные') && names().includes('Инверторы'), 'сначала всё свёрнуто');
  assert.match(a.vStock(), /data-act="cat-toggle" data-cat="Инверторы" aria-expanded="false"/);
  assert.match(a.vStock(), /<button type="button" class="ct-tg"[^>]*>\s*<svg class="ic[^"]*"/, 'стрелка — значок, а не буква');
  A['cat-toggle']({ dataset: { cat: 'Инверторы' } });
  assert.match(a.vStock(), /data-cat="Инверторы" aria-expanded="true"/);
  for (const n of ['Сетевые', 'Гибридные', 'Автономные']) assert.ok(names().includes(n), `после стрелки видно «${n}»`);
  assert.equal(S.ui.cat, 'Все', 'стрелка категорию не выбирает');
  // второй уровень: у «Гибридные» своя стрелка, под ней фирмы
  assert.ok(!rowsOf(a.vStock()).some(r => r.brand !== null), 'фирм не видно, пока вид не раскрыт');
  A['cat-toggle']({ dataset: { cat: 'Инверторы › Гибридные' } });
  const brands = rowsOf(a.vStock()).filter(r => r.brand !== null);
  assert.ok(brands.length >= 5 && brands.every(r => r.cat === 'Инверторы › Гибридные' && r.depth === 2), 'фирмы вида — на уровень глубже');
  A['cat-toggle']({ dataset: { cat: 'Инверторы' } });
  assert.ok(!names().includes('Гибридные'), 'свернули — видов и фирм не видно');
  // название: все товары категории, вместе с видами
  A['stock-cat']({ dataset: { cat: 'Инверторы' } });
  const inv = Catalog.query(S, { cat: 'Инверторы' }).length;
  assert.ok(inv > 100 && shown(a.stockTable()) === inv, 'показаны товары всех видов инверторов');
  assert.ok(names().includes('Сетевые'), 'выбранная категория раскрыта');
  A['stock-cat']({ dataset: { cat: 'Инверторы › Сетевые' } });
  assert.equal(shown(a.stockTable()), S.products.filter(p => p.cat === 'Инверторы › Сетевые').length);
  assert.match(a.vStock(), /class="ct-row on"[^>]*>(?:(?!<\/li>).)*data-cat="Инверторы › Сетевые"/s);
  assert.equal(shown((A['stock-cat']({ dataset: { cat: 'ИБП' } }), a.stockTable())), 78, 'ИБП из номенклатуры лежат в «ИБП»');
});

test('экран: выбранная ветка раскрыта сама, остальные свёрнуты; свёрнутую вручную ветку выбор снова раскрывает', () => {
  const { a } = page(), { A } = a;
  const names = () => rowsOf(a.vStock()).map(r => r.name);
  A['stock-cat']({ dataset: { cat: 'Аккумуляторы › АГМ' } });
  assert.ok(names().includes('АГМ-карбон') && names().includes('Гель-карбон'), 'виды выбранной ветки видны');
  assert.ok(!names().includes('Гибридные') && !names().includes('MPPT'), 'остальные ветки свёрнуты');
  A['cat-toggle']({ dataset: { cat: 'Аккумуляторы' } });
  assert.ok(!names().includes('АГМ-карбон'), 'свернули выбранную ветку стрелкой');
  A['stock-cat']({ dataset: { cat: 'Аккумуляторы › АГМ' } });
  assert.ok(names().includes('АГМ-карбон'), 'выбор снова раскрыл');
});

test('экран: под категорией без видов — фирмы её товаров с числом, по алфавиту; товары без фирмы — «Без бренда»; панели сразу по фирмам', () => {
  const { a } = page(), { A, S, Catalog } = a;
  A['stock-cat']({ dataset: { cat: 'Панели' } });
  const br = rowsOf(a.vStock()).filter(r => r.brand !== null);
  const want = {};
  for (const p of S.products.filter(p => p.cat === 'Панели')) { const b = p.brand || 'Без бренда'; want[b] = (want[b] || 0) + 1; }
  assert.deepEqual(br.map(r => [dec(r.brand), r.n]), [...Object.entries(want).filter(([b]) => b !== 'Без бренда').sort((x, y) => x[0].localeCompare(y[0], 'ru')), ...(want['Без бренда'] ? [['Без бренда', want['Без бренда']]] : [])]);
  assert.ok(br.length >= 6, 'у панелей несколько фирм');
  assert.ok(br.every(r => r.cat === 'Панели' && r.depth === 1), 'фирмы лежат под «Панели»');
  // фирма появилась сама: новый товар новой фирмы — новый узел, ничего не заводилось
  const before = S.categories.length;
  const add = Catalog.add(S, { name: 'Панель ТЕСТФИРМА 1', cat: 'Панели' }); add.product.brand = 'ТЕСТФИРМА';
  a.render();
  assert.ok(rowsOf(a.vStock()).some(r => r.brand === 'ТЕСТФИРМА' && r.n === 1), 'новая фирма видна');
  assert.equal(S.categories.length, before, 'фирмы в S.categories не хранятся');
  assert.ok(!JSON.stringify(S.categories).includes('ТЕСТФИРМА'));
  // у категории без единой фирмы уровня «фирма» нет (у АГМ-батарей с сайта фирма теперь есть — для проверки они обезличены)
  S.products.filter(p => p.cat === 'Аккумуляторы › АГМ').forEach(p => { p.brand = null; });
  A['stock-cat']({ dataset: { cat: 'Аккумуляторы › АГМ' } });
  assert.ok(!rowsOf(a.vStock()).some(r => r.brand !== null && r.cat === 'Аккумуляторы › АГМ'));
  // смешанная категория: «Без бренда» в конце
  Catalog.add(S, { name: 'АКБ без фирмы АГМ', cat: 'Аккумуляторы › АГМ' });
  S.products.find(p => p.cat === 'Аккумуляторы › АГМ' && p.name !== 'АКБ без фирмы АГМ').brand = 'ТЕСТБРЕНД';
  a.render();
  const mixed = rowsOf(a.vStock()).filter(r => r.brand !== null);
  assert.deepEqual(mixed.filter(r => r.cat === 'Аккумуляторы › АГМ').map(r => r.brand), ['ТЕСТБРЕНД', 'Без бренда']);
});

test('экран: выбор фирмы в дереве = категория + бренд, ровно как список «Бренд»; список и дерево всегда согласованы', () => {
  const { a } = page(), { A, S, Catalog, ON } = a;
  A['stock-cat']({ dataset: { cat: 'Инверторы › Гибридные' } });
  const node = rowsOf(a.vStock()).find(r => r.brand === 'DEYE');
  assert.ok(node && node.n === S.products.filter(p => p.cat === 'Инверторы › Гибридные' && p.brand === 'DEYE').length);
  A['stock-brand']({ dataset: { cat: 'Инверторы › Гибридные', brand: 'DEYE' } });
  assert.deepEqual([S.ui.cat, S.ui.brand], ['Инверторы › Гибридные', 'DEYE']);
  const want = Catalog.query(S, { cat: 'Инверторы › Гибридные', brand: 'DEYE' });
  assert.equal(shown(a.stockTable()), want.length);
  assert.ok(want.length > 5 && want.every(p => p.brand === 'DEYE'), 'все мощности этой фирмы');
  assert.match(a.vStock(), /class="ct-row ct-brand on"[^>]*>(?:(?!<\/li>).)*data-brand="DEYE"/s, 'узел фирмы подсвечен, а не категория');
  assert.ok(!rowsOf(a.vStock()).find(r => r.brand === null && r.cat === 'Инверторы › Гибридные').cls.includes('on'), 'категория сама не подсвечена');
  assert.match(a.vStock(), /<option value="DEYE" selected>DEYE<\/option>/, 'в списке «Бренд» выбран тот же бренд');
  // выбор в списке «Бренд» подсвечивает тот же узел
  ON.change.brand({ value: 'MUST' });
  assert.match(a.vStock(), /class="ct-row ct-brand on"[^>]*>(?:(?!<\/li>).)*data-brand="MUST"/s);
  // выбор названия категории — вся категория, фирма сбрасывается
  A['stock-cat']({ dataset: { cat: 'Инверторы › Гибридные' } });
  assert.equal(S.ui.brand, '');
  assert.equal(shown(a.stockTable()), S.products.filter(p => p.cat === 'Инверторы › Гибридные').length);
  // смена категории не оставляет чужую фирму
  A['stock-brand']({ dataset: { cat: 'Инверторы › Гибридные', brand: 'DEYE' } });
  A['stock-cat']({ dataset: { cat: 'Панели' } });
  assert.equal(S.ui.brand, '');
  // «Без бренда»: тот же фильтр у узла и у списка
  const mixed = 'Аккумуляторы › Литий-железофосфат (LiFePO4)';
  A['stock-brand']({ dataset: { cat: mixed, brand: 'Без бренда' } });
  const none = S.products.filter(p => p.cat === mixed && !p.brand);
  assert.ok(none.length > 0, 'в литии есть товары без фирмы (лист остатков)');
  assert.equal(shown(a.stockTable()), none.length);
  assert.match(a.vStock(), /<option value="Без бренда" selected>/);
});

test('экран: раскрытое и выбранная фирма не попадают в сохранение (S.ui не пишется), телефонная кнопка называет категорию и фирму', () => {
  const { a } = page(), { A, S } = a;
  A['cat-toggle']({ dataset: { cat: 'Аккумуляторы' } });
  A['stock-brand']({ dataset: { cat: 'Инверторы › Гибридные', brand: 'DEYE' } });
  assert.ok(S.ui.catOpen['Аккумуляторы'] === true);
  const dump = a.Store.dump(S).text;
  assert.ok(!dump.includes('catOpen'), 'раскрытое в сохранение не попало');
  assert.ok(!/"cat":"Инверторы › Гибридные","brand":"DEYE"/.test(dump) && !dump.includes('"ui"'), 'выбранная фирма в сохранение не попала');
  assert.match(a.vStock(), /Категория: Инверторы › Гибридные · DEYE/);
  assert.ok(a.vStock().includes('aria-expanded="true"'));
});
