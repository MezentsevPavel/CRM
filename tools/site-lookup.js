'use strict';
// Ищет на сайте wind-solar.ru товары по названиям из таблицы остатков, которых нет в каталоге CRM, и снимает с их страниц
// артикул, бренд, цену, наличие и ссылку — всё, что есть на странице; чего нет, остаётся пустым («нет данных»). Два шага:
//   node tools/site-lookup.js search <названия.json> <кандидаты.json>
//        для каждого названия — что нашёл поиск сайта (/search?q=…) и насколько совпали слова: score от 0 до 1. Страницы товаров
//        не открываются. Решение, какой кандидат — тот самый товар, принимает человек: он правит файл, оставляя у названия одно поле path.
//   node tools/site-lookup.js fetch <выбранное.json> <товары.json>
//        <выбранное.json> — [{ "name": "название из таблицы", "path": "/collection/…/product/…" }]; страницы этих товаров читаются,
//        результат — { rows: [{ name, key, model, brand, price, avail, url, sku }] }, цена 0 на сайте = «нет данных».
// По одному запросу за раз с паузой; ходит только на wind-solar.ru. Повторный запуск докачивает недостающее.

const fs = require('node:fs');
const { parseProduct } = require('./site-catalog.js');

const BASE = 'https://www.wind-solar.ru';
const PAUSE_MS = 350;
const sleep = ms => new Promise(ok => setTimeout(ok, ms));
const unescapeHtml = s => String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const LAT = { 'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'Х': 'X', 'У': 'Y' };
const latin = s => String(s).toUpperCase().replace(/Ё/g, 'Е').replace(/[А-Я]/g, c => LAT[c] || c);
const flat = s => latin(s).replace(/[^A-Z0-9А-Я]/g, '');
// слова, по которым не отличить один товар от другого
const STOP = new Set(['ИНВЕРТОР', 'ГИБРИДНЫЙ', 'СОЛНЕЧНАЯ', 'СОЛНЕЧНЫЙ', 'ПАНЕЛЬ', 'БАТАРЕЯ', 'АККУМУЛЯТОРНАЯ', 'КОНТРОЛЛЕР', 'ЗАРЯДА', 'АВТОНОМНЫЙ', 'КОМПЛЕКТ',
  'МОДУЛЬ', 'СЕТЕВОЙ', 'УСТРОЙСТВО', 'ЗАРЯДНОЕ', 'ПРЕДОХРАНИТЕЛЬ', 'ВЫКЛЮЧАТЕЛЬ', 'АВТОМАТ', 'КОРПУС', 'ДЕРЖАТЕЛЬ', 'КОННЕКТОР', 'ПРОВОД', 'КАБЕЛЬ', 'ДЛЯ']);
const tokens = name => [...new Set(String(name).split(/[\s,;()[\]/«»"*+]+/).map(t => t.replace(/^[^A-Za-zА-Яа-я0-9]+|[^A-Za-zА-Яа-я0-9]+$/g, '')).filter(Boolean))];
const hasDigit = t => /\d/.test(t);

async function get(url) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (CRM wind-solar catalog)' }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error('ответ ' + res.status);
      return await res.text();
    } catch (e) { last = e; await sleep(800 * (i + 1)); }
  }
  throw new Error(`${url}: ${last.message}`);
}

// Карточки результатов поиска → [{id, path, title}]
function cards(html) {
  const out = [], seen = new Set();
  for (const m of html.matchAll(/<form[^>]*data-product-id="(\d+)"[\s\S]*?<\/form>/g)) {
    const link = /href="(\/collection\/[^"#?]+\/product\/[^"#?]+)"/.exec(m[0]);
    const alt = /alt="([^"]+)"/.exec(m[0]);
    if (!link || seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ id: m[1], path: link[1], title: alt ? unescapeHtml(alt[1]).replace(/\s+/g, ' ').trim() : '' });
  }
  return out;
}

// Что искать: слова с цифрами как написаны (самые длинные), самое длинное слово без цифр, не из общих — и каждое отдельным запросом
function queries(name) {
  const t = tokens(name), dig = t.filter(hasDigit).sort((a, b) => b.length - a.length).slice(0, 2);
  const word = t.filter(w => !hasDigit(w) && w.length >= 5 && !STOP.has(latin(w).replace(/[^A-ZА-Я]/g, '')) && !STOP.has(w.toUpperCase())).sort((a, b) => b.length - a.length)[0];
  return [...dig, ...(word ? [word] : [])];
}

// Доля важных слов названия, которые стоят в названии на сайте: слова с цифрами весят втрое. 0…1
function score(name, title) {
  const hay = flat(title);
  let have = 0, all = 0;
  for (const w of tokens(name)) {
    const f = flat(w);
    if (f.length < 2 || STOP.has(w.toUpperCase())) continue;
    const weight = hasDigit(w) ? 3 : 1;
    all += weight;
    if (hay.includes(f)) have += weight;
  }
  return all ? Math.round(have / all * 100) / 100 : 0;
}

async function search(names, dst) {
  const done = fs.existsSync(dst) ? JSON.parse(fs.readFileSync(dst, 'utf8')) : [];
  const have = new Set(done.map(d => d.name));
  for (const [i, name] of names.entries()) {
    if (have.has(name)) continue;
    const seen = new Map();
    let err = null;
    for (const q of queries(name)) {
      try {
        await sleep(PAUSE_MS);
        for (const c of cards(await get(`${BASE}/search?q=${encodeURIComponent(q)}`))) if (!seen.has(c.id)) seen.set(c.id, { ...c, score: score(name, c.title) });
      } catch (e) { err = e.message; }
    }
    const candidates = [...seen.values()].sort((a, b) => b.score - a.score).slice(0, 5);
    done.push({ name, queries: queries(name), candidates, ...(err ? { error: err } : {}) });
    fs.writeFileSync(dst, JSON.stringify(done, null, 1));
    console.log(`${i + 1}/${names.length} ${candidates[0] ? candidates[0].score : '—'}  ${name.slice(0, 55)}${candidates[0] ? '  ⇒  ' + candidates[0].title.slice(0, 55) : ''}`);
  }
}

async function fetchPages(picked, dst) {
  const out = fs.existsSync(dst) ? JSON.parse(fs.readFileSync(dst, 'utf8')) : { rows: [], skipped: [] };
  const have = new Set(out.rows.map(r => r.name));
  for (const [i, p] of picked.entries()) {
    if (have.has(p.name)) continue;
    await sleep(PAUSE_MS);
    try {
      const j = parseProduct(await get(BASE + p.path), p.path);
      if (!j) { out.skipped.push(`${p.path}: на странице нет данных о товаре`); continue; }
      out.rows.push({ name: p.name, ...j });
    } catch (e) { out.skipped.push(`${p.path}: ${e.message}`); }
    fs.writeFileSync(dst, JSON.stringify(out, null, 1));
    console.log(`${i + 1}/${picked.length} ${p.name.slice(0, 60)}`);
  }
  fs.writeFileSync(dst, JSON.stringify(out, null, 1));
}

async function main([mode, src, dst]) {
  if (!['search', 'fetch'].includes(mode) || !src || !dst) { console.error('node tools/site-lookup.js search|fetch <вход.json> <выход.json>'); return 2; }
  const input = JSON.parse(fs.readFileSync(src, 'utf8'));
  await (mode === 'search' ? search(input, dst) : fetchPages(input, dst));
  return 0;
}

module.exports = { cards, queries, score, tokens };
if (require.main === module) main(process.argv.slice(2)).then(c => process.exit(c));
