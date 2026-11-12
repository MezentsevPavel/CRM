'use strict';
// Загрузка готовых фото товаров из папки на диске: «ключ товара → файл». Команда admin.js import-photos.
// Связка — JSON ({"405101090": "inverter-deye.jpg"} или {"405101090": {"file": "inverter-deye.jpg"}}) или .js-файл с таким
// объектом (так хранит связку PVCalc: `var EQUIPMENT_PHOTOS = {id: {file, ...}}`). Фото кладётся в начало списка product.photos,
// только если у товара фото ещё нет: то, что поставили руками, не трогается, повторный запуск ничего не удваивает.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Связка из файла → {ключ: имя файла}
function readMap(file) {
  const text = fs.readFileSync(file, 'utf8');
  let raw;
  if (/\.json$/i.test(file)) raw = JSON.parse(text);
  else {
    // .js — выполняется в пустой песочнице без доступа к процессу: ищется первый объект, у значений которого есть «file»
    const box = {};
    vm.runInNewContext(text, box, { timeout: 2000 });
    raw = Object.values(box).find(v => v && typeof v === 'object' && !Array.isArray(v)
      && Object.values(v).some(x => x && typeof x === 'object' && typeof x.file === 'string'));
    if (!raw) throw new Error('В файле связки не нашёлся объект «ключ → {file}»');
  }
  const out = {};
  for (const [key, v] of Object.entries(raw || {})) {
    const file = typeof v === 'string' ? v : v && typeof v === 'object' ? v.file : null;
    if (typeof file === 'string' && file) out[String(key)] = file;
  }
  return out;
}

// ctx — openCore(); dir — папка с фото; by — id человека, от чьего имени фото (директор).
// → { attached: [ключи], skipped: [{key, reason}] }; в базе всё меняется одной правкой.
function importPhotos(ctx, { dir, mapFile, by }) {
  const map = readMap(mapFile);
  const report = { attached: [], skipped: [] };
  const at = new Date(ctx.clock());
  const skip = (key, reason) => report.skipped.push({ key, reason });
  ctx.sync.system(st => {
    for (const [key, file] of Object.entries(map)) {
      const p = (st.products || []).find(x => String(x.id) === key);
      if (!p) { skip(key, 'в каталоге нет товара с таким ключом'); continue; }
      if (Array.isArray(p.photos) && p.photos.length) { skip(key, 'у товара уже есть фото'); continue; }
      const r = ctx.files.addLocal(path.join(dir, file), file, by, { photo: true });
      if (!r.ok) { skip(key, r.error); continue; }
      p.photos = [{ ...r.file, data: null, by, at }];
      report.attached.push(key);
    }
  }, by);
  return report;
}

module.exports = { importPhotos, readMap };
