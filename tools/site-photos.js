'use strict';
// Скачивает фото товаров со страниц сайта wind-solar.ru (ссылки — в снимке каталога src/js/10-catalog-data.js).
//   node tools/site-photos.js <папка> [--limit N]
// В <папке> для каждого товара создаётся своя папка с названием товара, в ней фото по порядку галереи: 01.png, 02.png, …
// Повторный запуск докачивает недостающее и ничего не качает дважды. Заодно пишутся:
//   _связка.json — «ключ каталога → главное фото (папка/01.png)»: её берёт `node server/admin.js import-photos <папка> <папка>/_связка.json`;
//   _отчёт.txt   — у каких товаров нет ссылки, не открылась страница или на ней нет фото.
// Страницы и картинки берутся только с самого сайта и его хранилища картинок (cdn.insales-shop.ru), по одному запросу за раз с паузой.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const PAUSE_MS = 350;
const MAX_IMAGE = 15 * 1024 * 1024;
const SHOP_HOSTS = new Set(['wind-solar.ru', 'www.wind-solar.ru']);
const CDN_HOST = 'cdn.insales-shop.ru';
const IMG_RE = /https?:\/\/cdn\.insales-shop\.ru\/images\/products\/(\d+\/\d+\/(\d+))\/([^/"'&@?\s<>)\\]+\.(?:png|jpe?g|webp|gif))/g;
const SIZED = /^(thumb|small|medium|large|compact|micro)_/i;

const sleep = ms => new Promise(ok => setTimeout(ok, ms));

// Строки каталога (ключ, название, ссылка) из снимка; сам снимок исполняется в пустой песочнице
function readCatalog(file = path.join(ROOT, 'src', 'js', '10-catalog-data.js')) {
  const box = {};
  vm.runInNewContext(fs.readFileSync(file, 'utf8') + '\n;this.__rows = CATALOG.rows;', box, { timeout: 5000 });
  return box.__rows.map(r => ({ key: String(r.key), model: String(r.model || ''), url: r.url || null }));
}

// Название товара → имя папки: без знаков, которые нельзя в имени папки Windows, не длиннее 110 знаков; одинаковые — с ключом в конце
function folderName(model, key, used) {
  let n = model.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').replace(/ ([\])])/g, '$1').replace(/([[(]) /g, '$1').trim().replace(/[. ]+$/, '');
  if (n.length > 110) n = n.slice(0, 110).replace(/[. ]+$/, '');
  if (!n) n = 'товар ' + key;
  let name = n;
  if (used.has(name.toLowerCase())) name = `${n} (${key})`;
  used.add(name.toLowerCase());
  return name;
}

// Адреса фото галереи из страницы товара: оригиналы (без thumb_/small_ и без @webp), каждое фото один раз, в порядке страницы
function galleryOf(html) {
  const seen = new Map();
  for (const m of html.matchAll(IMG_RE)) {
    const [url, , id, file] = m;
    if (SIZED.test(file) || seen.has(id)) continue;
    seen.set(id, url);
  }
  return [...seen.values()];
}

async function get(url, what, asText) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (CRM wind-solar photo import)' }, signal: AbortSignal.timeout(30000) });
      if (res.status === 404) throw Object.assign(new Error('страницы нет (404)'), { final: true });
      if (!res.ok) throw new Error('ответ ' + res.status);
      return asText ? await res.text() : { bytes: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') || '' };
    } catch (e) {
      last = e;
      if (e.final) break;
      await sleep(800 * (i + 1));
    }
  }
  throw new Error(`${what}: ${last.message}`);
}

async function main(argv) {
  const args = argv.filter(a => !a.startsWith('--'));
  const lim = argv.indexOf('--limit') >= 0 ? Number(argv[argv.indexOf('--limit') + 1]) : Infinity;
  const out = args[0] && !/^\d+$/.test(args[0]) ? path.resolve(args[0]) : null;
  if (!out) { console.error('Укажи папку: node tools/site-photos.js <папка> [--limit N]'); return 1; }
  fs.mkdirSync(out, { recursive: true });
  const rows = readCatalog();
  const used = new Set(), map = {}, report = [];
  let pages = 0, photos = 0, withPhotos = 0;
  for (const r of rows) {
    const dir = folderName(r.model, r.key, used);
    if (pages >= lim) break;
    if (!r.url) { report.push(`${r.key} ${r.model}: нет данных — в таблице нет ссылки на страницу сайта`); continue; }
    let host;
    try { host = new URL(r.url).hostname; } catch { host = ''; }
    if (!SHOP_HOSTS.has(host)) { report.push(`${r.key} ${r.model}: ссылка не на сайт wind-solar.ru (${r.url}) — пропущено`); continue; }
    pages++;
    let urls;
    try {
      urls = galleryOf(await get(r.url, 'страница товара', true));
    } catch (e) { report.push(`${r.key} ${r.model}: ${e.message}`); await sleep(PAUSE_MS); continue; }
    if (!urls.length) { report.push(`${r.key} ${r.model}: на странице нет фото`); await sleep(PAUSE_MS); continue; }
    const files = [];
    for (let i = 0; i < urls.length; i++) {
      const ext = path.extname(new URL(urls[i]).pathname).toLowerCase() || '.jpg';
      const rel = path.join(dir, String(i + 1).padStart(2, '0') + ext);
      const target = path.join(out, rel);
      if (!fs.existsSync(target)) {
        try {
          const img = await get(urls[i], 'фото', false);
          if (!/^image\//.test(img.type) || img.bytes.length < 200 || img.bytes.length > MAX_IMAGE) throw new Error('не картинка или слишком большая');
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, img.bytes);
          photos++;
        } catch (e) { report.push(`${r.key} ${r.model}: фото ${i + 1} не скачано — ${e.message}`); await sleep(PAUSE_MS); continue; }
        await sleep(PAUSE_MS);
      }
      files.push(rel);
    }
    if (files.length) { map[r.key] = files[0].split(path.sep).join('/'); withPhotos++; }
    process.stdout.write(`\r${pages} страниц, товаров с фото ${withPhotos}, скачано фото ${photos}   `);
    await sleep(PAUSE_MS);
  }
  fs.writeFileSync(path.join(out, '_связка.json'), JSON.stringify(map, null, 1) + '\n');
  fs.writeFileSync(path.join(out, '_отчёт.txt'), report.join('\n') + (report.length ? '\n' : ''));
  console.log(`\nГотово. Страниц открыто: ${pages}. Товаров с фото: ${withPhotos}. Новых фото скачано: ${photos}. Замечаний: ${report.length} (см. _отчёт.txt).`);
  return 0;
}

if (require.main === module) main(process.argv.slice(2)).then(code => process.exit(code));

module.exports = { galleryOf, folderName, readCatalog };
