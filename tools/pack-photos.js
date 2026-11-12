'use strict';
// Кладёт главные фото, скачанные tools/site-photos.js, в поставку программы: assets/photos/<ключ>.jpg (800 px, JPEG) + запись в map.json.
//   node tools/pack-photos.js <папка с фото сайта>
// Берётся _связка.json из этой папки. Ключи, у которых фото в assets/photos уже есть, не перезаписываются (готовые фото PVCalc остаются).
// Уменьшение делает tools/resize-photos.ps1 (только Windows, встроенный System.Drawing; ничего не устанавливается).
// Эти файлы приезжают с обновлением, а кнопка «Настройки → Обновить ПО → Загрузить готовые фото» прикрепляет их товарам без фото.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const OUT = path.join(__dirname, '..', 'assets', 'photos');

function main(argv) {
  const src = argv[0] && path.resolve(argv[0]);
  if (!src || !fs.existsSync(path.join(src, '_связка.json'))) { console.error('Укажи папку с фото сайта (в ней должен быть _связка.json): node tools/pack-photos.js <папка>'); return 1; }
  const site = JSON.parse(fs.readFileSync(path.join(src, '_связка.json'), 'utf8'));
  const mapFile = path.join(OUT, 'map.json');
  const map = fs.existsSync(mapFile) ? JSON.parse(fs.readFileSync(mapFile, 'utf8')) : {};
  fs.mkdirSync(OUT, { recursive: true });
  const jobs = [];
  for (const [key, rel] of Object.entries(site)) {
    if (!/^[A-Za-z0-9_-]+$/.test(key)) continue;
    if (map[key] && fs.existsSync(path.join(OUT, map[key]))) continue;
    jobs.push({ key, src: path.join(src, rel), dst: path.join(OUT, key + '.jpg') });
  }
  if (!jobs.length) { console.log('Новых фото нет.'); return 0; }
  const list = path.join(os.tmpdir(), 'crm-pack-photos.json');
  fs.writeFileSync(list, JSON.stringify(jobs.map(j => ({ src: j.src, dst: j.dst }))), 'utf8');
  const r = cp.spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'resize-photos.ps1'), list], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  fs.rmSync(list, { force: true });
  if (r.error) { console.error('PowerShell не запустился:', r.error.message); return 1; }
  let ok = 0;
  const fails = [];
  for (const line of String(r.stdout).split(/\r?\n/)) {
    const p = line.split('\t');
    if (p[0] === 'ok') ok++;
    else if (p[0] === 'fail') fails.push(`${p[1]}: ${p[2]}`);
  }
  // Не уменьшилось (например, WebP: встроенный декодер его не знает) — кладётся как есть, если не крупнее 2 МБ; сервер WebP принимает
  for (const j of jobs) {
    if (fs.existsSync(j.dst)) { map[j.key] = j.key + '.jpg'; continue; }
    const ext = path.extname(j.src).toLowerCase();
    if (fs.existsSync(j.src) && fs.statSync(j.src).size <= 2 * 1024 * 1024 && /^\.(webp|png|jpe?g|gif)$/.test(ext)) {
      fs.copyFileSync(j.src, path.join(OUT, j.key + ext));
      map[j.key] = j.key + ext;
      fails.length && fails.pop();
      ok++;
    }
  }
  const sorted = Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(mapFile, JSON.stringify(sorted, null, 1) + '\n');
  console.log(`Добавлено фото: ${ok} из ${jobs.length}. Не получилось: ${jobs.length - ok}.`);
  for (const f of fails.slice(0, 20)) console.log('  ' + f);
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { main };
