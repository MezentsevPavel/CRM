'use strict';
// Сборка страницы: склеивает src/ и assets/ в один файл crm-wind-solar.html.
//   src/page.html   — каркас с местами {{CSS}}, {{JS}}, {{LOGO}}
//   src/css/*.css   — склеиваются по имени файла, по возрастанию
//   src/js/*.js     — склеиваются по имени файла, по возрастанию, в одну IIFE с 'use strict'
//   assets/windsolar-logo.png — data URI на место {{LOGO}}; такое место ровно одно (страница, стили или код),
//                                чтобы картинка в файле была один раз
// Запуск: node tools/build.js

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUT_NAME = 'crm-wind-solar.html';
const HEAD = '<!-- собрано из src/, руками не править: node tools/build.js -->';
const LOGO_FILE = path.join('assets', 'windsolar-logo.png');

const read = f => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');

// Файлы папки с нужным расширением — по имени, по возрастанию. Порядок склейки задан только здесь.
function sorted(dir, ext) {
  return fs.readdirSync(dir).filter(f => f.endsWith(ext)).sort().map(f => path.join(dir, f));
}
const cssFiles = (root = ROOT) => sorted(path.join(root, 'src', 'css'), '.css');
const jsFiles = (root = ROOT) => sorted(path.join(root, 'src', 'js'), '.js');

// Подстановка через split/join: в коде много знаков $, а String.replace понимает их как шаблон.
const fill = (text, key, value) => text.split(`{{${key}}}`).join(value);

function build(root = ROOT) {
  const page = read(path.join(root, 'src', 'page.html'));
  for (const key of ['CSS', 'JS']) {
    if (!page.includes(`{{${key}}}`)) throw new Error(`В src/page.html нет места {{${key}}}`);
  }
  const css = cssFiles(root).map(read).join('\n');
  const js = "(()=>{\n'use strict';\n\n" + jsFiles(root).map(read).join('\n') + '})();\n';
  const logo = 'data:image/png;base64,' + fs.readFileSync(path.join(root, LOGO_FILE)).toString('base64');
  let html = fill(page, 'CSS', css);
  html = fill(html, 'JS', js);
  const spots = html.split('{{LOGO}}').length - 1;
  if (spots !== 1) throw new Error(`Место {{LOGO}} должно быть ровно одно, а их ${spots}`);
  html = fill(html, 'LOGO', logo);
  return HEAD + '\n' + html;
}

module.exports = { build, cssFiles, jsFiles, ROOT, OUT_NAME, HEAD };

if (require.main === module) {
  const html = build();
  const out = path.join(ROOT, OUT_NAME);
  fs.writeFileSync(out, html, 'utf8');
  console.log(`Собрано: ${OUT_NAME} — ${Buffer.byteLength(html)} байт`);
}
