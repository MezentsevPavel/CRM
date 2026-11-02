'use strict';
// Перенос остатков и клиентов (таск 04, R13, R14, R23i, R24i). Ожидаемое — из критериев таска и spec.md («Колонки переноса»):
// CSV искусственные, собраны здесь же; настоящих данных фирмы в тестах нет. Кодировку проверяем эталоном — TextDecoder Node.

const test = require('node:test');
const assert = require('node:assert/strict');
const { load, bootPage } = require('./load.js');
const { start, call, director, employee, changes, state } = require('./server-kit.js');

const INPUT = 'Ввод остатков';
const NOW = new Date(2026, 10, 2, 12, 0, 0);

// Байты в Windows-1251: обратная таблица строится из эталонного декодера Node
const REV1251 = (() => {
  const d = new TextDecoder('windows-1251'), m = new Map();
  for (let b = 0; b < 256; b++) m.set(d.decode(Uint8Array.of(b)), b);
  return m;
})();
const enc1251 = text => Uint8Array.from([...text].map(ch => { if (!REV1251.has(ch)) throw new Error('нет в cp1251: ' + ch); return REV1251.get(ch); }));
const encUtf8 = (text, bom) => Uint8Array.from([...(bom ? [0xEF, 0xBB, 0xBF] : []), ...Buffer.from(text, 'utf8')]);
const plain = v => JSON.parse(JSON.stringify(v));

// Лист «Остатки» искусственный: заголовок не в первой строке, разделы, пустые и текстовые клетки, резервы
const STOCK_CSV = [
  'Выгрузка с корса общая;;;;;;;',
  'Остатки на сегодня;;;;;;;',
  'Наименование;Склад ИП;НПП;ВС;Ответхранение;В пути;Бой;Резерв',
  'Солнечные панели;;;;;;;',
  'Панель Икс-100;12;5;;;;;',
  'Панель Игрек-200;0;;3;2;4;1;"36шт автоношкин, 64 Алексей Н."',
  'Крепёж;;;;;;;',
  'Крепление Зет;7;;;;;;Петров',
  'Инверторы / ИБП / конвертеры;;;;;;;',
  'Инвертор Омега;под заказ;;;;;;',
  ';;;;;;;',
].join('\n');
const tableOf = (app, csv) => app.Import.parseCsv(csv);

// ——— кодировка и разбор CSV ———
test('Import.decode: UTF-8 с BOM и без, Windows-1251; каждый байт cp1251 — как у эталона', () => {
  const { Import } = load();
  const text = 'Склад ИП;Панель «Икс» ёлка 12,5';
  assert.equal(Import.decode(encUtf8(text, false)), text);
  assert.equal(Import.decode(encUtf8(text, true)), text, 'BOM снят');
  assert.equal(Import.decode(enc1251(text.replace(/[«»]/g, '"'))), text.replace(/[«»]/g, '"'));
  assert.equal(Import.decode(enc1251('Остатки: ёЁ №1 — тире')), 'Остатки: ёЁ №1 — тире');
  for (let b = 0x80; b < 256; b++) {
    assert.equal(Import.decode(Uint8Array.of(b)), new TextDecoder('windows-1251').decode(Uint8Array.of(b)), 'байт ' + b.toString(16));
  }
  assert.equal(Import.decode(Uint8Array.of(0x41, 0x42)), 'AB', 'чистый ASCII');
  // валидный UTF-8 не принимается за cp1251: двухбайтная «Ж»
  assert.equal(Import.decode(Uint8Array.of(0xD0, 0x96)), 'Ж');
});

test('Import.decode: «Юникод-текст» Excel (UTF-16 LE и BE с BOM, табуляция) даёт те же строки, что UTF-8', () => {
  const { Import } = load();
  const csv = 'Наименование\tСклад ИП\tРезерв\r\nПанель «Икс» ёлка 😀\t12\t"36шт а, 64 б"\r\nЩит\t\t';
  const le = Uint8Array.from([0xFF, 0xFE, ...Buffer.from(csv, 'utf16le')]);
  const be = Uint8Array.from([0xFE, 0xFF, ...Buffer.from(csv, 'utf16le').swap16()]);
  const want = plain(Import.parseCsv(Import.decode(encUtf8(csv, true))));
  assert.equal(want.length, 3, 'эталон разобран');
  assert.deepEqual(plain(Import.parseCsv(Import.decode(le))), want, 'UTF-16 LE');
  assert.deepEqual(plain(Import.parseCsv(Import.decode(be))), want, 'UTF-16 BE');
  assert.equal(Import.decode(Uint8Array.of(0xFF, 0xFE, 0x41, 0x00, 0x42)), 'A', 'лишний байт нечётной длины отброшен');
  assert.equal(Import.decode(Uint8Array.of(0xFF, 0xFE)), '', 'один BOM — пусто');
});

test('Import.parseCsv: разделитель ; , таб сам, кавычки, кавычка внутри, перевод строки в кавычках, CRLF', () => {
  const { Import } = load();
  assert.deepEqual(plain(Import.parseCsv('a;b;c\n1;2;3')), [['a', 'b', 'c'], ['1', '2', '3']]);
  assert.deepEqual(plain(Import.parseCsv('a,b,c\r\n1,2,3\r\n')), [['a', 'b', 'c'], ['1', '2', '3']]);
  assert.deepEqual(plain(Import.parseCsv('a\tb\tc\n1\t2\t3')), [['a', 'b', 'c'], ['1', '2', '3']]);
  assert.deepEqual(plain(Import.parseCsv('a;"b;1";c\n"x ""q"" y";"две\nстроки";z')), [['a', 'b;1', 'c'], ['x "q" y', 'две\nстроки', 'z']]);
  // запятая внутри ячейки файла с ; не делает его файлом с запятой
  assert.deepEqual(plain(Import.parseCsv('Имя;Резерв;ВС\nПанель;36шт а, 64 б;5\nЩит;;2')), [['Имя', 'Резерв', 'ВС'], ['Панель', '36шт а, 64 б', '5'], ['Щит', '', '2']]);
  assert.deepEqual(plain(Import.parseCsv('')), []);
});

// ——— лист «Остатки» ———
test('Import.stockRows: заголовок не в первой строке, разделы, пустые и текстовые клетки, резерв', () => {
  const app = load(), { Import } = app;
  const r = plain(Import.stockRows(tableOf(app, STOCK_CSV)));
  assert.deepEqual(r.problems, []);
  assert.equal(r.rows.length, 4);
  const [a, b, c, d] = r.rows;
  assert.deepEqual([a.name, a.cat, a.ip, a.npp, a.vs, a.custody, a.transit, a.damaged, a.reserve], ['Панель Икс-100', 'Солнечные панели', 12, 5, null, null, null, null, null]);
  assert.deepEqual([b.name, b.ip, b.npp, b.vs, b.custody, b.transit, b.damaged, b.reserve], ['Панель Игрек-200', 0, null, 3, 2, 4, 1, '36шт автоношкин, 64 Алексей Н.']);
  assert.equal(b.cat, 'Солнечные панели');
  assert.deepEqual([c.name, c.cat, c.ip, c.reserve], ['Крепление Зет', 'Солнечные панели › Крепёж', 7, 'Петров']);
  assert.deepEqual([d.name, d.cat, d.ip], ['Инвертор Омега', 'Инверторы / ИБП / конвертеры', null], 'текст в числовой клетке — null');
  assert.deepEqual(d.junk, [{ column: 'Склад ИП', text: 'под заказ' }]);
  assert.equal(a.junk, undefined);
});

test('Import.stockRows: файл без колонки названия, не CSV, пустой — понятный текст в problems', () => {
  const app = load(), { Import } = app;
  const p = csv => plain(Import.stockRows(tableOf(app, csv)));
  assert.match(p('').problems.join(' '), /пуст/i);
  assert.equal(p('').rows.length, 0);
  assert.match(p('Привет, это письмо\nа не таблица').problems.join(' '), /заголов/i);
  assert.match(p('Склад ИП;НПП;ВС\n1;2;3\n4;5;6').problems.join(' '), /назван/i, 'нет текстовой колонки');
  assert.match(Import.stockRows([['%PDF-1.4\u0000\u0001binary']]).problems.join(' '), /не CSV|двоичн/i);
  assert.match(p('Наименование;Склад ИП;НПП\n').problems.join(' '), /нет ни одного товара/i);
  // колонка названия без заголовка — первая текстовая
  const q = p(';Склад ИП;НПП\nПанель;1;2');
  assert.deepEqual(q.problems, []);
  assert.equal(q.rows[0].name, 'Панель');
});

test('Import.parseReserve: «36шт автоношкин, 64 Алексей Н.» → два резерва; «Петров» → в rest', () => {
  const { Import } = load();
  assert.deepEqual(plain(Import.parseReserve('36шт автоношкин, 64 Алексей Н.')), { items: [{ qty: 36, note: 'автоношкин' }, { qty: 64, note: 'Алексей Н.' }], rest: null });
  assert.deepEqual(plain(Import.parseReserve('Петров')), { items: [], rest: 'Петров' });
  assert.deepEqual(plain(Import.parseReserve('10 шт. Иванов; Сидоров')), { items: [{ qty: 10, note: 'Иванов' }], rest: 'Сидоров' });
  assert.deepEqual(plain(Import.parseReserve('Иванов 5шт')), { items: [{ qty: 5, note: 'Иванов' }], rest: null });
  assert.deepEqual(plain(Import.parseReserve('0шт Нулёв')), { items: [], rest: '0шт Нулёв' }, 'ноль штук — не резерв');
  assert.deepEqual(plain(Import.parseReserve('')), { items: [], rest: null });
  assert.deepEqual(plain(Import.parseReserve(null)), { items: [], rest: null });
});

// ——— запись остатков ———
const firstUnique = app => {
  const n = app.Catalog.norm, seen = new Map();
  for (const r of app.CATALOG.rows) seen.set(n(r.model), (seen.get(n(r.model)) || 0) + 1);
  return app.CATALOG.rows.find(r => seen.get(n(r.model)) === 1);
};
const stockState = app => { const st = app.seedBase(); return st; };

test('Import.applyStock: остатки заменены, «Ввод остатков» по товарам, резервы с примечанием без сделки', () => {
  const app = load(), { Import, Stock } = app;
  const st = stockState(app);
  const model = firstUnique(app);
  const rows = plain(Import.stockRows(tableOf(app, STOCK_CSV)).rows);
  rows.push({ name: model.model, cat: 'Солнечные панели', ip: 40, npp: null, vs: null, custody: null, transit: null, damaged: null, reserve: null });
  const r = plain(Import.applyStock(st, rows, 'p1', NOW));
  assert.deepEqual([r.products, r.matched, r.created, r.reserves], [5, 1, 4, 2]);
  // товар каталога получил остаток, остальные — товары «нет в каталоге» с id по названию
  assert.equal(st.stock[String(model.key)].ip._, 40);
  const x = st.products.find(p => p.id === 'sheet:панель икс-100');
  assert.ok(x && x.inCatalog === false && x.name === 'Панель Икс-100' && x.cat === 'Панели');
  assert.equal(st.stock['sheet:панель икс-100'].npp._, 5);
  assert.deepEqual(plain(st.aside['sheet:панель игрек-200']), { damaged: 1, custody: 2, transitNoShip: 4 });
  assert.equal(Stock.summary(st, 'sheet:панель икс-100').onHand, 17);
  assert.equal(Stock.summary(st, 'sheet:инвертор омега').known, false, 'текстовая клетка — остаток неизвестен');
  // движения: по товару и клетке, с положительным количеством
  const inputs = st.moves.filter(m => m.kind === INPUT);
  assert.equal(inputs.length, 5, 'клеток с остатком больше нуля: 2 + 1 + 1 + 1');
  assert.ok(inputs.every(m => m.qty > 0 && m.by === 'p1' && /^перенос.*02\.11\.2026/.test(m.doc) && m.id));
  assert.equal(inputs.find(m => m.productId === 'sheet:панель икс-100' && m.entityId === 'npp').qty, 5);
  assert.equal(inputs.some(m => m.productId === 'sheet:панель игрек-200' && m.entityId === 'ip'), false, 'ноль — не движение');
  // резервы
  const rs = st.reserves.filter(q => q.productId === 'sheet:панель игрек-200');
  assert.deepEqual([...rs.map(q => [q.qty, q.note, q.imported, q.src, q.dealId, q.entityId])], [[36, 'автоношкин', true, 'stock', undefined, 'vs'], [64, 'Алексей Н.', true, 'stock', undefined, 'vs']]);
  st.people = [{ id: 'p1', name: 'Директор', role: 'director', dept: 'mgmt' }];
  const view = Stock.reserveView(st, rs[0], 'p1');
  assert.deepEqual([view.note, view.hasDeal, view.deal], ['автоношкин', false, null]);
  // неразобранное: текст в числовой клетке и резерв без числа
  assert.deepEqual([...r.unparsed.map(u => [u.name, u.column, u.text])], [['Крепление Зет', 'Резерв', 'Петров'], ['Инвертор Омега', 'Склад ИП', 'под заказ']]);
  assert.equal(st.stockSheet.rows.length, 5);
  assert.equal(st.stockSheet.rows.some(q => 'reserve' in q || 'junk' in q), false, 'в состоянии нет текста резервов (имена клиентов) для всех');
});

test('Import.applyStock: повторный перенос того же файла — те же товары, остатки и резервы не удвоились', () => {
  const app = load(), { Import } = app;
  const st = stockState(app);
  const rows = plain(Import.stockRows(tableOf(app, STOCK_CSV)).rows);
  Import.applyStock(st, rows, 'p1', NOW);
  const once = plain({ stock: st.stock, aside: st.aside, products: st.products.map(p => p.id), reserves: st.reserves.map(q => [q.productId, q.qty, q.note]) });
  const movesOnce = st.moves.length;
  Import.applyStock(st, rows, 'p1', new Date(2026, 10, 2, 15, 0, 0));
  assert.deepEqual(plain({ stock: st.stock, aside: st.aside, products: st.products.map(p => p.id), reserves: st.reserves.map(q => [q.productId, q.qty, q.note]) }), once);
  assert.equal(new Set(st.products.map(p => p.id)).size, st.products.length, 'товары не продублировались');
  assert.equal(st.reserves.filter(q => q.imported).length, 2);
  assert.ok(st.moves.length > movesOnce, 'журнал дописывается: движение — запись, не правка');
  assert.equal(new Set(st.moves.map(m => m.id)).size, st.moves.length, 'у движений разные id');
  // другой файл заменяет: товар, которого в нём нет, остаток теряет; чужой (не из переноса) резерв остаётся
  st.reserves.push({ id: 'r-мой', productId: 'sheet:панель икс-100', qty: 1, entityId: 'ip', cityId: '_', src: 'stock', dealId: 'Д-1' });
  Import.applyStock(st, plain(Import.stockRows(tableOf(app, 'Наименование;Склад ИП;НПП\nПанель Икс-100;3;')).rows), 'p1', NOW);
  assert.deepEqual(plain(st.stock), { 'sheet:панель икс-100': { ip: { _: 3 } } });
  assert.deepEqual(plain(st.aside), {});
  assert.deepEqual([...st.reserves.map(q => q.id)], ['r-мой']);
});

test('Import.applyStock: кривые строки не ломают базу (не число, без названия, не список)', () => {
  const app = load(), { Import } = app;
  const st = stockState(app);
  const before = JSON.stringify(plain({ stock: st.stock, reserves: st.reserves }));
  assert.throws(() => Import.applyStock(st, 'не список', 'p1', NOW), /строк/i);
  assert.equal(JSON.stringify(plain({ stock: st.stock, reserves: st.reserves })), before);
  const r = Import.applyStock(st, [null, { name: '' }, { name: '  ', ip: 5 }, { name: 'Щит', ip: 7, npp: Infinity, vs: -2, reserve: 5 }], 'p1', NOW);
  assert.equal(r.products, 1);
  assert.deepEqual(plain(st.stock), { 'sheet:щит': { ip: { _: 7 }, vs: { _: -2 } } }, 'Infinity — не число, пусто; минус остаётся как есть');
  assert.equal(st.moves.filter(m => m.kind === INPUT).length, 1, 'отрицательное — не движение');
});

// ——— рабочая база: снимок 31.10 не используется ———
test('SERVER: Catalog без снимка остатков — «нет данных: остаток»; unpack берёт строки из stockSheet', () => {
  const dem = load(), srv = load({ globals: { CRM_SERVER: 1 } });
  assert.ok(dem.Catalog.base().products.some(p => p.src === 'sheet'), 'демо: снимок на месте');
  const base = srv.Catalog.base();
  assert.equal(base.products.some(p => p.src === 'sheet'), false);
  assert.equal(base.products.length, srv.CATALOG.rows.length);
  assert.deepEqual(plain(base.stock), {});
  const st = srv.seedBase();
  assert.equal(st.products.length, srv.CATALOG.rows.length);
  const p = st.products[0];
  assert.equal(srv.Stock.summary(st, p.id).known, false);
  // сохранённое без переноса не возвращает снимок
  const packed = srv.Catalog.pack(st.products);
  const back = srv.Catalog.unpack({ ...plain(packed), stock: {}, aside: {} });
  assert.equal(back.products.length, srv.CATALOG.rows.length);
  assert.equal(back.products.some(q => q.src === 'sheet'), false);
  // после переноса — строки из stockSheet
  const st2 = srv.seedBase();
  srv.Import.applyStock(st2, plain(srv.Import.stockRows(srv.Import.parseCsv(STOCK_CSV)).rows), 'p1', NOW);
  const packed2 = srv.Catalog.pack(st2.products);
  const back2 = srv.Catalog.unpack({ ...plain(packed2), stockSheet: plain(st2.stockSheet), stock: {}, aside: {} });
  assert.deepEqual([...back2.products.filter(q => q.src === 'sheet').map(q => q.id)].sort(), ['sheet:инвертор омега', 'sheet:крепление зет', 'sheet:панель игрек-200', 'sheet:панель икс-100']);
  assert.equal(back2.products.length, srv.CATALOG.rows.length + 4, 'товары переноса не задвоены');
});

test('Stock.reserveView отдаёт примечание; резерв без сделки — hasDeal:false', () => {
  const app = load(), { Stock } = app;
  const st = app.seedBase();
  st.people = [{ id: 'p1', name: 'Директор', role: 'director', dept: 'mgmt' }];
  const pid = st.products[0].id;
  const r = { id: 'r1', productId: pid, qty: 3, entityId: 'ip', cityId: '_', src: 'stock', note: 'автоношкин', imported: true };
  st.reserves = [r];
  const v = Stock.reserveView(st, r, 'p1');
  assert.equal(v.note, 'автоношкин');
  assert.equal(v.hasDeal, false);
  assert.equal(v.deal, null);
  assert.equal(Stock.reserveView(st, { ...r, note: undefined }, 'p1').note, null);
});

// ——— клиенты ———
const CONTACTS_CSV = [
  'ID;Имя;Фамилия;Отчество;Рабочий телефон;Мобильный телефон;Рабочий e-mail;Адрес;Компания;Должность;Ответственный;Источник',
  '11;Пётр;Сидоров;Иванович;+7 (900) 111-22-33;8 900 111 22 44, +7 900 111 22 55;sid@example.org;Иркутск, ул. Тестовая 1;ООО Ромашка;директор;Иван Менеджеров;Сайт',
  '12;Анна;;;;;anna@example.org;;;;Неизвестный Человек;Звонок',
  '13;;;;+7 900 000 00 00;;;;;;;',
  ';;;;;;;;;;;',
].join('\n');
const COMPANIES_CSV = [
  'ID;Название компании;ИНН;Телефон;E-mail;Фактический адрес;Юридический адрес;Адрес;Ответственный',
  '21;ООО "Ромашка";3801000001;+7 3952 11-22-33;info@romashka.example;;г. Иркутск, юр. 5;;Иван Менеджеров',
  '22;ИП Тестов;;;;;;Адрес без фактического;',
].join('\n');

test('Import.clientRows: контакты по колонкам Битрикса, компании по «Название компании», нераспознанные и без имени', () => {
  const app = load(), { Import } = app;
  const c = plain(Import.clientRows(tableOf(app, CONTACTS_CSV)));
  assert.deepEqual(c.problems, []);
  assert.equal(c.kind, 'person');
  assert.deepEqual(c.unknown, ['Источник']);
  assert.equal(c.skipped, 1, 'строка 13 без имени (только телефон); пустую строку не считаем');
  assert.deepEqual(c.rows[0], {
    kind: 'person', name: 'Сидоров Пётр Иванович', phones: ['+7 (900) 111-22-33', '8 900 111 22 44', '+7 900 111 22 55'], email: 'sid@example.org',
    inn: '', address: 'Иркутск, ул. Тестовая 1', org: 'ООО Ромашка, директор', managerName: 'Иван Менеджеров', bitrixId: '11',
  });
  assert.equal(c.rows[1].name, 'Анна');
  assert.equal(c.rows.length, 2);
  const k = plain(Import.clientRows(tableOf(app, COMPANIES_CSV)));
  assert.equal(k.kind, 'company');
  assert.deepEqual(k.unknown, []);
  assert.deepEqual(k.rows[0], {
    kind: 'company', name: 'ООО "Ромашка"', phones: ['+7 3952 11-22-33'], email: 'info@romashka.example', inn: '3801000001',
    address: 'г. Иркутск, юр. 5', org: '', managerName: 'Иван Менеджеров', bitrixId: '21',
  });
  assert.equal(k.rows[1].address, 'Адрес без фактического', 'первый непустой из «Адрес», «Фактический адрес», «Юридический адрес»');
  // файл не из Битрикса
  assert.match(plain(Import.clientRows(tableOf(app, 'a;b\n1;2'))).problems.join(' '), /колонк/i);
  assert.match(plain(Import.clientRows([])).problems.join(' '), /пуст/i);
});

const peopleState = app => {
  const st = app.seedBase();
  st.people = [{ id: 'p1', name: 'Директор', role: 'director', dept: 'mgmt' }, { id: 'p2', name: 'Иван Менеджеров', role: 'managerB2c', dept: 'sales' }];
  return st;
};

test('Import.applyClients: повтор того же файла не плодит клиентов, недостающее дописано, ответственный по точному имени, org в карточке', () => {
  const app = load(), { Import, Clients } = app;
  const st = peopleState(app);
  const contacts = plain(Import.clientRows(tableOf(app, CONTACTS_CSV)).rows);
  const companies = plain(Import.clientRows(tableOf(app, COMPANIES_CSV)).rows);
  assert.deepEqual(plain(Import.applyClients(st, contacts, 'p1', NOW)), { created: 2, merged: 0, skipped: 0 });
  assert.deepEqual(plain(Import.applyClients(st, companies, 'p1', NOW)), { created: 2, merged: 0, skipped: 0 });
  assert.equal(st.clients.length, 4);
  const sid = st.clients.find(c => c.bitrixId === '11' && c.kind === 'person');
  assert.equal(sid.name, 'Сидоров Пётр Иванович');
  assert.equal(sid.org, 'ООО Ромашка, директор');
  assert.equal(sid.managerId, 'p2');
  assert.equal(st.clients.find(c => c.name === 'Анна').managerId, undefined, 'Неизвестный Человек — менеджера нет');
  assert.equal(st.clients.find(c => c.name === 'ООО "Ромашка"').kind, 'company');
  // повтор
  assert.deepEqual(plain(Import.applyClients(st, contacts, 'p1', NOW)), { created: 0, merged: 2, skipped: 0 });
  assert.deepEqual(plain(Import.applyClients(st, companies, 'p1', NOW)), { created: 0, merged: 2, skipped: 0 });
  assert.equal(st.clients.length, 4, 'ни одного нового клиента');
  // тот же ИНН / телефон / почта в другом файле — дополняет, а не дублирует
  const more = [{ kind: 'company', name: 'Ромашка (другое имя)', phones: ['8 3952 11 22 33', '+7 900 555 66 77'], email: '', inn: '3801000001', address: '', org: '', managerName: '', bitrixId: '' }];
  assert.deepEqual(plain(Import.applyClients(st, more, 'p1', NOW)), { created: 0, merged: 1, skipped: 0 });
  const rom = st.clients.find(c => c.inn === '3801000001');
  assert.equal(rom.name, 'ООО "Ромашка"', 'занятое не затирается');
  assert.deepEqual(plain(rom.phones), ['+7 3952 11-22-33', '+7 900 555 66 77'], 'телефон 8… = +7… не задвоен, новый дописан');
  assert.deepEqual(plain(Import.applyClients(st, [{ name: ' ' }, { name: 'Без контактов', kind: 'person' }], 'p1', NOW)), { created: 1, merged: 0, skipped: 1 });
  const lone = { kind: 'person', name: 'Один Только', phones: [], email: '', inn: '', address: '', org: '', managerName: '', bitrixId: '77' };
  Import.applyClients(st, [lone], 'p1', NOW);
  assert.deepEqual(plain(Import.applyClients(st, [lone], 'p1', NOW)), { created: 0, merged: 1, skipped: 0 }, 'без контактов узнаётся по ID Битрикса');
  // правка org/bitrixId — как остальных полей
  assert.equal(Clients.update(st, sid.id, { org: 'ООО Другая' }, 'p1', NOW).ok, true);
  assert.equal(sid.org, 'ООО Другая');
});

test('Import.preview: считает тем же кодом, что запись, и ничего не меняет в состоянии', () => {
  const app = load(), { Import } = app;
  const st = peopleState(app);
  const rows = plain(Import.stockRows(tableOf(app, STOCK_CSV)).rows);
  const before = JSON.stringify(plain(st));
  const pv = plain(Import.preview('stock', st, rows, 'p1', NOW));
  assert.equal(JSON.stringify(plain(st)), before);
  assert.deepEqual(pv, plain(Import.applyStock(peopleState(app), rows, 'p1', NOW)));
  const cl = plain(Import.clientRows(tableOf(app, CONTACTS_CSV)).rows);
  assert.deepEqual(plain(Import.preview('clients', st, cl, 'p1', NOW)), { created: 2, merged: 0, skipped: 0 });
  assert.equal(st.clients.length, 0);
});

// ——— сервер: маршруты переноса ———
async function firm(srv) {
  const boss = await director(srv);
  const ivan = await employee(srv, boss, { id: 'p5', name: 'Иван Кладовщиков (тест)', role: 'warehouse', dept: 'stock' });
  const anna = await employee(srv, boss, { id: 'p2', name: 'Анна Менеджерова (тест)', role: 'managerB2c', dept: 'sales' });
  return { boss, ivan, anna };
}

test('сервер: перенос остатков — только директор, остатки в базе, «Ввод остатков» в журнале, повтор не удваивает, битое — 400', async () => {
  const srv = await start();
  try {
    const { boss, ivan } = await firm(srv);
    const app = load(), rows = plain(app.Import.stockRows(tableOf(app, STOCK_CSV)).rows);
    const post = (who, body) => call(srv, 'POST', '/api/import/stock', { cookie: who.cookie, body });
    assert.equal((await post(ivan, { rows })).status, 403, 'кладовщик — нет');
    const before = await state(srv, boss.cookie);
    assert.equal(before.products.some(p => p.src === 'sheet'), false, 'до переноса товаров из таблицы нет');
    assert.deepEqual(before.stock, {}, 'до переноса остатков нет');
    for (const bad of [{}, { rows: 'x' }, { rows: [1, 2] }, { rows: [] }]) {
      const r = await post(boss, bad);
      assert.equal(r.status, 400, JSON.stringify(bad));
      assert.match(r.body.error, /строк|перенос/i);
    }
    assert.deepEqual((await state(srv, boss.cookie)).stock, {}, 'база не тронута');

    const r = await post(boss, { rows });
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.products, r.body.reserves, r.body.created], [4, 2, 4]);
    const after = await state(srv, boss.cookie);
    assert.equal(after.stock['sheet:панель икс-100'].ip._, 12);
    assert.equal(after.moves.filter(m => m.kind === INPUT).length, 4, 'Икс: ИП и НПП, Игрек: ВС (ИП=0 — не движение), Зет: ИП');
    assert.equal(after.reserves.filter(x => x.imported).length, 2);
    assert.ok(after.stockSheet && after.stockSheet.rows.length === 4);
    // кладовщик видит остатки и резерв с примечанием
    const ivanSees = await state(srv, ivan.cookie);
    assert.equal(ivanSees.reserves.find(x => x.qty === 36).note, 'автоношкин');
    // повтор
    const again = await post(boss, { rows });
    assert.equal(again.status, 200);
    const twice = await state(srv, boss.cookie);
    assert.deepEqual(twice.stock, after.stock);
    assert.equal(twice.reserves.filter(x => x.imported).length, 2);
    assert.equal(twice.products.filter(p => p.src === 'sheet').length, 4);
  } finally { await srv.stop(); }
});

test('сервер: перенос клиентов — по порциям, без дублей; ответственный по имени; не директору — 403', async () => {
  const srv = await start();
  try {
    const { boss, anna } = await firm(srv);
    const app = load();
    const rows = plain(app.Import.clientRows(tableOf(app, CONTACTS_CSV.replace('Иван Менеджеров', 'Анна Менеджерова (тест)'))).rows);
    const post = (who, list) => call(srv, 'POST', '/api/import/clients', { cookie: who.cookie, body: { rows: list } });
    assert.equal((await post(anna, rows)).status, 403);
    assert.deepEqual((await post(boss, rows)).body, { created: 2, merged: 0, skipped: 0 });
    assert.deepEqual((await post(boss, rows)).body, { created: 0, merged: 2, skipped: 0 });
    const st = await state(srv, boss.cookie);
    assert.equal(st.clients.length, 2);
    const sid = st.clients.find(c => c.bitrixId === '11');
    assert.deepEqual([sid.org, sid.managerId, sid.kind], ['ООО Ромашка, директор', 'p2', 'person']);
    assert.equal((await post(boss, 'нет')).status, 400);
  } finally { await srv.stop(); }
});

// ——— экран «Настройки → Перенос» ———
// «Браузер» директора против настоящего сервера: fetch держит cookie и шлёт относительные адреса на сервер
async function openPage(srv, who) {
  const jar = { cookie: '' }, calls = [];
  const bfetch = async (url, opt = {}) => {
    calls.push({ url, method: opt.method || 'GET', body: typeof opt.body === 'string' ? opt.body : null, headers: opt.headers || {} });
    const headers = { ...(opt.headers || {}) };
    if (jar.cookie) headers.cookie = jar.cookie;
    const res = await fetch(srv.url + url, { ...opt, headers });
    const set = res.headers.get('set-cookie');
    if (set) jar.cookie = /Max-Age=0/i.test(set) ? '' : set.split(';')[0];
    return res;
  };
  const window = { addEventListener() {}, focus() {} };
  const app = load({ globals: { CRM_SERVER: 1, fetch: bfetch, window, location: { hash: '', reload() {} }, atob, Blob } });
  assert.equal(await app.serverBoot(), 'gate');
  assert.equal(await app.serverLogin(who.login, who.password), 'ready');
  return { app, calls };
}
const tabOf = app => app.SETTINGS_TABS.find(t => t.id === 'transfer');

test('экран «Перенос»: вкладка только директору и только на сервере; предпросмотр с числами; ошибка файла — текст; CSV нигде не остаётся', async () => {
  const srv = await start();
  try {
    const { boss, ivan } = await firm(srv);
    assert.ok(!load().SETTINGS_TABS.some(t => t.id === 'transfer'), 'в демо вкладки нет');
    const clerk = await openPage(srv, ivan);
    assert.equal(tabOf(clerk.app).ok(), false, 'кладовщику вкладки нет');
    const { app, calls } = await openPage(srv, boss);
    const tab = tabOf(app);
    assert.equal(tab.ok(), true);
    const before = calls.length;
    app.trStockRead(encUtf8(STOCK_CSV, true));
    const html = tab.render();
    assert.match(html, /Загрузить/);
    for (const w of ['товаров в файле', 'склеено с каталогом', 'с остатком', 'резервов из колонки', 'неразобранных']) assert.match(html, new RegExp(w), w);
    assert.match(html, /<b>4<\/b> товаров в файле/);
    assert.match(html, /<b>2<\/b> резервов/);
    assert.match(html, /Петров/, 'неразобранный резерв назван');
    assert.match(html, /под заказ/, 'и текст в числовой клетке');
    assert.equal(calls.length, before, 'предпросмотр на сервер не ходит');
    // файл-мусор: текст ошибки и нет кнопки «Загрузить»
    app.trStockRead(Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x00, 0x01]));
    const bad = tab.render();
    assert.match(bad, /не CSV|двоичн/i);
    assert.doesNotMatch(bad, /data-form="tr-stock"/);
    // клиенты: тип файла, числа, нераспознанные колонки
    app.trClientsRead(enc1251(CONTACTS_CSV));
    const cl = tab.render();
    assert.match(cl, /файл контактов Битрикса/);
    assert.match(cl, /<b>2<\/b> новых клиентов/);
    assert.match(cl, /<b>1<\/b> пропущено без имени/);
    assert.match(cl, /Нераспознанные колонки[^<]*Источник/);
    app.trClientsRead(enc1251(COMPANIES_CSV));
    assert.match(tab.render(), /файл компаний Битрикса/);
    // CSV остался только в памяти вкладки: в общих документах и в хранилище браузера его нет
    app.trStockRead(encUtf8(STOCK_CSV, false));
    assert.equal(JSON.stringify(app.Docs.split(app.S)).includes('автоношкин'), false);
    assert.equal(Object.values(app.storage).some(v => String(v).includes('автоношкин')), false);
  } finally { await srv.stop(); }
});

test('экран «Перенос»: «Загрузить» шлёт на сервер только разобранные строки и после ответа показывает «Загружено»; клиенты — порциями', async () => {
  const srv = await start();
  try {
    const { boss } = await firm(srv);
    const { app, calls } = await openPage(srv, boss);
    const tab = tabOf(app);
    app.trStockRead(encUtf8(STOCK_CSV, false));
    await app.trStockSend();
    const sent = calls.filter(c => c.url === '/api/import/stock');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].method, 'POST');
    assert.equal(sent[0].headers['X-CRM'], '1');
    const body = JSON.parse(sent[0].body);
    assert.equal(body.rows.length, 4);
    assert.equal(sent[0].body.includes('Выгрузка с корса'), false, 'заголовок файла и сам CSV не уходят');
    assert.match(tab.render(), /Загружено/);
    assert.doesNotMatch(tab.render(), /data-form="tr-stock"/, 'после загрузки кнопки уже нет');
    const st = await state(srv, boss.cookie);
    assert.equal(st.stock['sheet:панель икс-100'].npp._, 5);
    assert.equal(st.moves.filter(m => m.kind === INPUT).length, 4);
    // клиенты: 2500 строк — три запроса, итог суммируется, повтор того же файла дублей не даёт
    const rows = Array.from({ length: 2500 }, (_, i) => ({ kind: 'person', name: 'Клиент ' + i, phones: ['+7 900 ' + String(1000000 + i)], email: '', inn: '', address: '', org: '', managerName: '', bitrixId: String(i) }));
    const csv = ['ID;Имя;Телефон', ...rows.map(r => `${r.bitrixId};${r.name};${r.phones[0]}`)].join('\n');
    app.trClientsRead(encUtf8(csv, false));
    await app.trClientsSend();
    const chunks = calls.filter(c => c.url === '/api/import/clients');
    assert.deepEqual(chunks.map(c => JSON.parse(c.body).rows.length), [1000, 1000, 500]);
    assert.match(tab.render(), /<b>2[\s\u00a0\u202f]?500<\/b> новых клиентов/);
    assert.equal((await state(srv, boss.cookie)).clients.length, 2500);
    app.trClientsRead(encUtf8(csv, false));
    await app.trClientsSend();
    assert.match(tab.render(), /<b>0<\/b> новых клиентов/);
    assert.equal((await state(srv, boss.cookie)).clients.length, 2500, 'повтор не плодит клиентов');
  } finally { await srv.stop(); }
});

test('страница сервера: в сборке есть вкладки «Перенос» и «Копии»', () => {
  const html = require('../tools/build.js').build();
  assert.ok(html.includes("id:'transfer'") && html.includes("id:'backups'"));
  assert.ok(bootPage, 'bootPage подключён');
});

// ——— что видно в карточках ———
test('карточка товара и журнал склада: примечание резерва, «нет данных: сделка», «Снять» у резерва без сделки; в карточке клиента — «Компания»', () => {
  const app = load(), S = app.S;
  const boss = S.people.find(p => p.role === 'director').id;
  S.me = boss;
  app.Import.applyStock(S, plain(app.Import.stockRows(tableOf(app, STOCK_CSV)).rows), boss, NOW);
  const card = app.DRAWERS.product('sheet:панель игрек-200').body;
  assert.match(card, /автоношкин/);
  assert.match(card, /Алексей Н\./);
  assert.match(card, /нет данных: сделка/);
  assert.match(card, /data-act="unreserve"/, 'резерв без сделки снимается кнопкой');
  assert.match(card, /нет данных: срок/, 'срока у резерва из переноса нет');
  S.ui.stockTab = 'moves';
  const journal = app.movesTable();
  assert.match(journal, /перенос: автоношкин/, 'примечание в журнале');
  assert.match(journal, /Ввод остатков/);
  const c = app.Clients.make(S, { name: 'Сидоров', kind: 'person', org: 'ООО Ромашка, директор', phones: ['+7 900 111-22-33'] }, boss, NOW);
  assert.match(app.DRAWERS.client(c.id).body, /Компания[\s\S]*ООО Ромашка, директор/);
  const bare = app.Clients.make(S, { name: 'Без компании', kind: 'person' }, boss, NOW);
  assert.doesNotMatch(app.DRAWERS.client(bare.id).body, /for="cf-org"/);
});

test('SERVER: подпись источника остатков — перенос, а до него «нет данных», не снимок 31.10', async () => {
  const srv = await start();
  try {
    const { boss } = await firm(srv);
    const { app } = await openPage(srv, boss);
    assert.match(app.stockNote(), /нет данных: остатки ещё не перенесены/);
    assert.doesNotMatch(app.stockNote(), /31\.10/);
    app.S.stockSheet = { at: new Date(2026, 10, 2, 12), rows: [] };
    assert.equal(app.stockNote(), 'таблица менеджеров, перенос 02.11.2026');
    assert.match(load().stockNote(), /снимок 31\.10\.2026/, 'демо — как было');
  } finally { await srv.stop(); }
});
