'use strict';
// Обновляет снимок каталога src/js/10-catalog-data.js выгрузкой из Google-таблицы «PVCalc — параметры оборудования».
// Снимок руками не правится: его пишет только этот скрипт, чтобы любой разбор таблицы можно было повторить.
//
//   node tools/catalog-snapshot.js <выгрузка.json>          — переписать снимок
//   node tools/catalog-snapshot.js <выгрузка.json> --dry     — только отчёт, файл не трогать
//   node tools/catalog-snapshot.js --links <_ссылки.json> [--dry] — проставить ссылку на страницу сайта позициям, у которых её нет в снимке
//        (файл — { "<ключ>": "https://www.wind-solar.ru/collection/…/product/…" }, его пишет tools/site-photos.js). Ссылка, уже стоящая в снимке, не меняется;
//        принимаются только адреса карточек wind-solar.ru.
//   node tools/catalog-snapshot.js --extra <лист.json> [--dry] — добавить позиции листа «ИБП и контроллеры» (лист, который 2026-11-12 добавили в таблицу:
//        ИБП и контроллеры заряда с сайта; скрипт синхронизации таблицы его не трогает). Остальные позиции снимка не меняются. Файл —
//        { "date": "…", "header": [заголовки листа], "rows": [[ячейки строки], …] } (то, что отдаёт чтение листа); столбцы ищутся по заголовку:
//        «Ключ», «Модель», «Бренд», «Вид» (ИБП | Контроллер…), «Цена сайта», «Наличие», «Ссылка», «Артикул». Позиция с ключом, который уже есть
//        в снимке на другом листе, не дублируется. Повторный прогон того же листа даёт тот же файл.
//
// Выгрузка (JSON; в git её не кладут — в ней лежат цены и ссылки поставщиков на день выгрузки):
//   { "date": "2026-11-07",
//     "sheets": { "<лист>": [["<ключ каталога>", "<артикул с сайта или пусто>"], …], … },   — последний столбец «Артикул (с сайта)»
//     "electrics": { "header": [заголовки листа «Электрика»], "rows": [[ячейки строки], …] },
//     "specs": { "<ключ каталога>": { "hybrid": "да"|"нет", "chem": "LiFePO4" }, … } }   — необязательно: столбцы «Гибрид (с АКБ)» листа «Инверторы»
//                                                                                         и «Химия (справочно)» листа «Аккумуляторы»
// Столбцы листа «Электрика» ищутся по заголовку, а не по номеру. Позиции остальных листов (строки CATALOG.rows) берутся из прежнего
// снимка как есть: меняются только артикул (sku), категория (cat — путь вида «Инверторы › Гибридные», его выбирает Catalog.classify по столбцам
// таблицы, ссылке на сайте и названию) и позиции листа «Электрика» (sheet:'Электрика'); повторный прогон той же выгрузки даёт тот же файл.
//
// Что кладётся в строку «Электрики»: key = код позиции, model = название, sku = артикул, unit = «Ед.», cat = путь категории
// («Электрика › Автоматы»), supplier = «Сибэлком» | «Энергосфера» (по домену ссылки), supplierPrice = цена поставщика, priceDate = дата цены,
// url = ссылка на карточку поставщика. price (наша цена продажи) всегда null: цена поставщика не цена продажи. Чего в таблице нет —
// null («нет данных»), ничего не подставляется.

const fs = require('node:fs');
const path = require('node:path');
const { loadCode } = require('./vm-load.js');

const FILE = path.join(__dirname, '..', 'src', 'js', '10-catalog-data.js');
const SHEET = 'Электрика';
const EXTRA_SHEET = 'ИБП и контроллеры';
// Второй добавочный лист: товары, которые нашлись на сайте по названиям из таблицы остатков (tools/site-lookup.js) и которых не было в каталоге.
// Файл тот же формат, плюс поле "sheet": "Из таблицы остатков"; «Вид» — ИБП, Контроллер или любой верхний раздел каталога (Catalog.CATS).
const STOCK_EXTRA_SHEET = 'Из таблицы остатков';
// код позиции → путь категории; незнакомый префикс — «Электрика»
const CAT_BY_PREFIX = [
  ['supplier-breaker-', 'Электрика › Автоматы'],
  ['supplier-cable-', 'Электрика › Кабель'],
  ['supplier-enclosure-', 'Электрика › Щиты и боксы'],
  ['supplier-spd-', 'Электрика › УЗИП'],
];
const SUPPLIER_BY_HOST = [['sibelkom.ru', 'Сибэлком'], ['energosf.ru', 'Энергосфера']];

const catOf = code => (CAT_BY_PREFIX.find(([p]) => String(code).startsWith(p)) || [null, 'Электрика'])[1];
function supplierOf(url) {
  if (!url) return null;
  let host;
  try { host = new URL(url).hostname.toLowerCase(); } catch (e) { return null; }
  const hit = SUPPLIER_BY_HOST.find(([d]) => host === d || host.endsWith('.' + d));
  return hit ? hit[1] : null;
}
// «1 569,32» → 1569.32; пусто или не число → null
function money(v) {
  const s = String(v ?? '').replace(/[\s  ]/g, '').replace(',', '.');
  if (!s || !/^\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}
const text = v => { const s = String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim(); return s || null; };
const isoDate = v => { const s = String(v ?? '').trim(); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; };

// строка электрики из таблицы → строка снимка
function electricRow(cells, col) {
  const at = name => cells[col[name]];
  const code = text(at('code')), url = text(at('url'));
  return {
    key: code, model: text(at('name')), brand: null, price: null, avail: null, url, from: null,
    cat: catOf(code), sheet: SHEET,
    sku: text(at('sku')), unit: text(at('unit')), supplier: supplierOf(url), supplierPrice: money(at('price')), priceDate: isoDate(at('date')),
  };
}
function columns(header) {
  const find = (...names) => {
    const i = header.findIndex(h => names.some(n => String(h).trim().toLowerCase().startsWith(n)));
    if (i < 0) throw new Error(`В листе «${SHEET}» нет столбца «${names[0]}»`);
    return i;
  };
  return { code: find('код позиции'), name: find('название'), sku: find('артикул'), unit: find('ед.'), price: find('цена'), date: find('дата цены'), url: find('ссылка') };
}

// ——— лист «ИБП и контроллеры» ———
const TOP_BY_KIND = [[/^ибп/i, 'ИБП'], [/^контроллер/i, 'Контроллеры']];
function extraColumns(header) {
  const find = (...names) => {
    const i = header.findIndex(h => names.some(n => String(h).trim().toLowerCase().startsWith(n)));
    if (i < 0) throw new Error(`В листе «${EXTRA_SHEET}» нет столбца «${names[0]}»`);
    return i;
  };
  return { key: find('ключ'), model: find('модель'), brand: find('бренд'), kind: find('вид'), price: find('цена'), avail: find('наличие'), url: find('ссылка'), sku: find('артикул') };
}
// → { catalog, report }: позиции этого листа (extra.sheet, по умолчанию «ИБП и контроллеры») заменяются целиком, остальные остаются как были
function buildExtra(prev, extra) {
  const { Catalog } = loadCode().api;
  const col = extraColumns(extra.header);
  const sheet = extra.sheet || EXTRA_SHEET;
  if (![EXTRA_SHEET, STOCK_EXTRA_SHEET].includes(sheet)) throw new Error(`Неизвестный добавочный лист «${sheet}»`);
  const keep = prev.rows.filter(r => r.sheet !== sheet);
  const have = new Set(keep.map(r => String(r.key)));
  const report = { added: 0, knownElsewhere: [], noKind: [], dupes: [], cats: {}, noSub: [], noPrice: 0, noSku: 0 };
  const rows = [], seen = new Set();
  for (const c of extra.rows) {
    const key = text(c[col.key]), model = text(c[col.model]);
    if (!key || !model) continue;
    if (have.has(key)) { report.knownElsewhere.push(model); continue; }
    if (seen.has(key)) { report.dupes.push(model); continue; }
    const kind = text(c[col.kind]) || '';
    const top = (TOP_BY_KIND.find(([re]) => re.test(kind)) || [])[1] || (Catalog.CATS.includes(kind) ? kind : undefined);
    if (!top) { report.noKind.push(model); continue; }
    seen.add(key);
    const url = text(c[col.url]);
    const cat = Catalog.classify(top, { name: model, url });
    report.cats[cat] = (report.cats[cat] || 0) + 1;
    if (cat.endsWith(Catalog.SEP + Catalog.SUB_NONE)) report.noSub.push(model);
    const price = money(c[col.price]), sku = text(c[col.sku]);
    if (!price) report.noPrice++;
    if (!sku) report.noSku++;
    rows.push({ key, model, brand: text(c[col.brand]), price: price || null, avail: text(c[col.avail]), url, from: null, cat, sheet, sku });
  }
  report.added = rows.length;
  return { catalog: { ...prev, rows: [...keep, ...rows] }, report };
}

// Ссылки на карточки сайта позициям без ссылки: { catalog, report: { set, skipped } }
const SHOP_URL = /^https:\/\/www\.wind-solar\.ru\/collection\/[^/]+\/product\/[^/?#]+$/;
function applyLinks(prev, links) {
  const report = { set: 0, skipped: [] };
  const rows = prev.rows.map(r => {
    const u = links[String(r.key)];
    if (u === undefined || r.url) return r;
    if (!SHOP_URL.test(String(u))) { report.skipped.push(`${r.key}: не адрес карточки сайта`); return r; }
    report.set++;
    return { ...r, url: String(u) };
  });
  return { catalog: { ...prev, rows }, report };
}

// ——— запись в формате файла ———
const lit = v => {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return String(v);
  return "'" + String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'";
};
const rowText = r => '  {' + Object.entries(r).map(([k, v]) => `${k}:${lit(v)}`).join(',') + '}';

function build(prev, dump) {
  const rows = prev.rows.filter(r => r.sheet !== SHEET).map(r => { const { sku, ...rest } = r; return rest; });
  const report = { skuSet: 0, skuEmpty: [], skuUnknownKeys: [], dupes: [], electrics: 0, electricGaps: [], total: 0 };
  const bySheetKey = new Map();
  for (const [sheet, pairs] of Object.entries(dump.sheets || {})) for (const [k, sku] of pairs) bySheetKey.set(String(k), { sheet, sku: text(sku) });
  for (const k of bySheetKey.keys()) if (!rows.some(r => String(r.key) === k)) report.skuUnknownKeys.push(k);
  const { Catalog } = loadCode().api, specs = dump.specs || {};
  report.cats = {}; report.noSub = [];
  const withSku = rows.map(r => {
    const hit = bySheetKey.get(String(r.key));
    const sku = hit ? hit.sku : null;
    if (sku) report.skuSet++; else report.skuEmpty.push(r.model);
    const cat = Catalog.classify(Catalog.topOf(r.cat), { name: r.model, url: r.url, spec: specs[String(r.key)] });
    report.cats[cat] = (report.cats[cat] || 0) + 1;
    if (cat.endsWith(Catalog.SEP + Catalog.SUB_NONE)) report.noSub.push(r.model);
    return { ...r, cat, sku };
  });
  report.total = withSku.length;
  const col = columns(dump.electrics.header);
  const electrics = dump.electrics.rows.filter(c => c && text(c[col.code])).map(c => electricRow(c, col));
  report.electrics = electrics.length;
  for (const e of electrics) {
    const gaps = ['sku', 'unit', 'supplierPrice', 'priceDate', 'url', 'supplier'].filter(f => e[f] === null);
    if (gaps.length) report.electricGaps.push({ model: e.model, gaps });
  }
  const all = [...withSku, ...electrics];
  const bySku = new Map();
  for (const r of all) if (r.sku) bySku.set(r.sku.toLowerCase(), [...(bySku.get(r.sku.toLowerCase()) || []), r]);
  for (const [, list] of bySku) if (list.length > 1) report.dupes.push(list.map(r => r.model));
  return { catalog: { ...prev, rows: all }, report };
}

function render(src, catalog, date) {
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const head = src.split(/\r?\n/).filter(l => l.startsWith('//') && !l.startsWith('// Артикулы (sku)') && !l.startsWith('// Лист «ИБП и контроллеры»') && !l.startsWith('// Лист «Из таблицы остатков»') && !l.startsWith('// Лист «Электрика»') && !l.startsWith('//   price (наша цена продажи) у них'));
  head.forEach((l, i) => { if (l.startsWith('// cat — ')) head[i] = '// cat — категория: путь вида «Инверторы › Гибридные» (его выбирает Catalog.classify по столбцам таблицы, ссылке на сайте и названию; не назван — «… › Без подкатегории»); sheet — лист таблицы, откуда она взята.'; });
  head.forEach((l, i) => { if (/^\/\/ Листы:/.test(l)) head[i] = '// Листы: Инверторы, Аккумуляторы, Панели, Защита и соединения, Новые на сайте, Исключено, Электрика, ИБП и контроллеры, Из таблицы остатков.'; });
  head.push(`// Артикулы (sku) — столбец «Артикул (с сайта)» листов таблицы, выгрузка ${date}; пусто в таблице — null («Артикул: нет данных»). Дубли артикулов не убираются.`);
  head.push('// Лист «ИБП и контроллеры» (добавлен в таблицу 2026-11-12: ИБП и контроллеры заряда с сайта wind-solar.ru; скрипт синхронизации таблицы его не трогает) — позиции с sheet ИБП и контроллеры.');
  head.push('// Лист «Из таблицы остатков» (2026-11-13: товары с сайта wind-solar.ru, найденные по названиям из рабочей таблицы остатков; tools/site-lookup.js) — позиции с sheet Из таблицы остатков.');
  head.push('// Лист «Электрика» (Сибэлком, Энергосфера): товары поставщиков, не обязательно лежащие на складе; supplierPrice/priceDate — цена поставщика и её дата;');
  head.push('//   price (наша цена продажи) у них null. Снимок пишет tools/catalog-snapshot.js из выгрузки таблицы, руками не правится.');
  const lines = catalog.rows.map(rowText);
  return head.join(eol) + eol
    + `const CATALOG = {source:${lit(catalog.source)}, snapshot:${lit(catalog.snapshot)}, rows:[` + eol
    + lines.join(',' + eol) + eol + ']};' + eol;
}

function load(src) {
  return new Function(src.replace(/^const CATALOG\b/m, 'var CATALOG') + '\nreturn CATALOG;')();
}

module.exports = { build, buildExtra, applyLinks, extraColumns, EXTRA_SHEET, STOCK_EXTRA_SHEET, render, load, money, supplierOf, catOf, electricRow, columns, FILE, SHEET };

if (require.main === module && process.argv.includes('--links')) {
  const args = process.argv.slice(2), file = args[args.indexOf('--links') + 1];
  if (!file || file.startsWith('--')) { console.error('Нужен файл ссылок: node tools/catalog-snapshot.js --links <_ссылки.json> [--dry]'); process.exit(2); }
  const links = JSON.parse(fs.readFileSync(file, 'utf8'));
  const src = fs.readFileSync(FILE, 'utf8');
  const prev = load(src);
  const { catalog, report } = applyLinks(prev, links);
  if (!args.includes('--dry')) fs.writeFileSync(FILE, render(src, catalog, (/выгрузка (\d{4}-\d{2}-\d{2})/.exec(src) || [])[1] || '?'), 'utf8');
  console.log(JSON.stringify({ ссылок_проставлено: report.set, пропущено: report.skipped }, null, 1));
} else if (require.main === module && process.argv.includes('--extra')) {
  const args = process.argv.slice(2), file = args[args.indexOf('--extra') + 1];
  if (!file || file.startsWith('--')) { console.error('Нужен файл листа: node tools/catalog-snapshot.js --extra <лист.json> [--dry]'); process.exit(2); }
  const dump = JSON.parse(fs.readFileSync(file, 'utf8'));
  const src = fs.readFileSync(FILE, 'utf8');
  const { catalog, report } = buildExtra(load(src), dump);
  if (!args.includes('--dry')) fs.writeFileSync(FILE, render(src, catalog, dump.date || '?'), 'utf8');
  console.log(JSON.stringify({ добавлено: report.added, по_категориям: report.cats, без_подкатегории: report.noSub, уже_есть_на_другом_листе: report.knownElsewhere, без_вида: report.noKind, дубли_в_листе: report.dupes, без_цены: report.noPrice, без_артикула: report.noSku }, null, 1));
} else if (require.main === module) {
  const [file, flag] = process.argv.slice(2);
  if (!file) { console.error('Нужна выгрузка: node tools/catalog-snapshot.js <выгрузка.json> [--dry]'); process.exit(2); }
  const dump = JSON.parse(fs.readFileSync(file, 'utf8'));
  const src = fs.readFileSync(FILE, 'utf8');
  const { catalog, report } = build(load(src), dump);
  if (flag !== '--dry') fs.writeFileSync(FILE, render(src, catalog, dump.date || '?'), 'utf8');
  console.log(JSON.stringify({
    позиций: report.total, артикул_проставлен: report.skuSet, артикул_пуст: report.skuEmpty.length, электрика: report.electrics,
    по_категориям: report.cats, без_подкатегории: report.noSub, ключи_выгрузки_без_позиции: report.skuUnknownKeys, дубли_артикулов: report.dupes, электрика_пропуски: report.electricGaps,
  }, null, 1));
}
