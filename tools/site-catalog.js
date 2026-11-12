'use strict';
// Собирает с сайта wind-solar.ru товары разделов «ИБП» и «Контроллеры заряда» (в таблице PVCalc их нет — её скрипт берёт с сайта только
// инверторы, аккумуляторы, панели и защиту). Результат — JSON для листа «ИБП и контроллеры» таблицы и для tools/catalog-snapshot.js --extra.
//   node tools/site-catalog.js <файл.json>
// По одному запросу за раз с паузой; страницы самого сайта, ничего другого не открывается. Что не взято — в поле skipped, не выдумывается:
// цена 0 на сайте = «нет данных», пустой артикул = «нет данных».

const fs = require('node:fs');

const BASE = 'https://wind-solar.ru';
const PAUSE_MS = 350;
const SECTIONS = [
  { slug: 'ibp', kind: 'ИБП' },
  { slug: 'charge-controllers', kind: 'Контроллер' },
];
// Подразделы сайта, чьи товары не входят в «ИБП» и «Контроллеры»: аксессуары к контроллерам (датчики, дисплеи) — отдельная вещь
const NOT_THEM = ['aksessuary-dlya-kontrollerov'];
const LINK_RE = /href="(\/collection\/([^"#?/]+)\/product\/[^"#?]+)"/g;
const sleep = ms => new Promise(ok => setTimeout(ok, ms));
const unescapeHtml = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// Ссылки на товары со страницы раздела → [{path, slug}] без повторов
function linksOf(html) {
  const seen = new Map();
  for (const m of html.matchAll(LINK_RE)) if (!seen.has(m[1])) seen.set(m[1], { path: m[1], slug: m[2] });
  return [...seen.values()];
}

// Данные товара со страницы: блок data-product-json (id товара = ключ каталога, как у остальных позиций таблицы)
function parseProduct(html, pagePath) {
  const m = /data-product-json="([^"]+)"/.exec(html);
  if (!m) return null;
  let j;
  try { j = JSON.parse(unescapeHtml(m[1])); } catch { return null; }
  if (!j || !j.id || !j.title) return null;
  const vendorProp = (j.properties || []).find(p => p.permalink === 'vendor');
  const brand = vendorProp ? (j.characteristics || []).find(c => c.property_id === vendorProp.id) : null;
  const v = (j.variants || [])[0] || {};
  const price = Number(v.price != null ? v.price : j.price_min);
  const sku = String(v.sku == null ? '' : v.sku).trim();
  return {
    key: String(j.id),
    model: String(j.title).replace(/\s+/g, ' ').trim(),
    brand: brand && brand.title ? String(brand.title).trim() : null,
    price: price > 0 ? price : null,
    avail: j.available ? 'в наличии' : 'предзаказ',
    url: BASE.replace('://', '://www.') + (pagePath || j.url),
    sku: sku || null,
  };
}

async function get(url) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (CRM wind-solar catalog)' }, signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error('ответ ' + res.status);
      return await res.text();
    } catch (e) { last = e; await sleep(800 * (i + 1)); }
  }
  throw new Error(`${url}: ${last.message}`);
}

async function collect() {
  const out = { date: new Date().toISOString().slice(0, 10), rows: [], skipped: [] };
  const seen = new Set();
  for (const sec of SECTIONS) {
    for (let page = 1; page <= 30; page++) {
      const links = linksOf(await get(`${BASE}/collection/${sec.slug}?page=${page}`));
      const fresh = links.filter(l => !seen.has(l.path));
      if (!fresh.length) break;
      for (const l of fresh) {
        seen.add(l.path);
        await sleep(PAUSE_MS);
        if (NOT_THEM.includes(l.slug)) { out.skipped.push(`${l.path}: аксессуар к контроллеру, не контроллер`); continue; }
        let p;
        try { p = parseProduct(await get(BASE + l.path), l.path); } catch (e) { out.skipped.push(`${l.path}: ${e.message}`); continue; }
        if (!p) { out.skipped.push(`${l.path}: на странице нет данных о товаре`); continue; }
        if (out.rows.some(r => r.key === p.key)) continue;
        out.rows.push({ ...p, kind: sec.kind, slug: l.slug });
        process.stdout.write(`\r${out.rows.length} товаров   `);
      }
      await sleep(PAUSE_MS);
    }
  }
  return out;
}

async function main(argv) {
  if (!argv[0]) { console.error('Укажи файл результата: node tools/site-catalog.js <файл.json>'); return 1; }
  const out = await collect();
  fs.writeFileSync(argv[0], JSON.stringify(out, null, 1) + '\n');
  const by = {};
  for (const r of out.rows) by[r.kind] = (by[r.kind] || 0) + 1;
  console.log(`\nГотово: ${JSON.stringify(by)}; без цены: ${out.rows.filter(r => r.price === null).length}; без артикула: ${out.rows.filter(r => !r.sku).length}; пропущено: ${out.skipped.length}.`);
  return 0;
}

if (require.main === module) main(process.argv.slice(2)).then(code => process.exit(code));

module.exports = { linksOf, parseProduct, SECTIONS };
