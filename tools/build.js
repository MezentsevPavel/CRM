'use strict';
// Сборка страницы: склеивает src/ и assets/ в один файл crm-wind-solar.html.
//   src/page.html   — каркас с местами {{CSS}}, {{JS}}, {{LOGO}}
//   src/css/*.css   — склеиваются по имени файла, по возрастанию
//   src/js/*.js     — склеиваются по имени файла, по возрастанию, в одну IIFE с 'use strict'
//   assets/fonts/fonts.css + *.woff2 — @font-face на место {{FONTS}}: url(файл) заменяется data:-адресом файла
//   assets/windsolar-logo.png — data URI на место {{LOGO}}; такое место ровно одно (страница, стили или код),
//                                чтобы картинка в файле была один раз
// Запуск: node tools/build.js

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const OUT_NAME = 'crm-wind-solar.html';
const HEAD = '<!-- собрано из src/, руками не править: node tools/build.js -->';
const LOGO_FILE = path.join('assets', 'windsolar-logo.png');
const FONTS_DIR = path.join('assets', 'fonts');

const read = f => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');

// Файлы папки с нужным расширением — по имени, по возрастанию. Порядок склейки задан только здесь.
function sorted(dir, ext) {
  return fs.readdirSync(dir).filter(f => f.endsWith(ext)).sort().map(f => path.join(dir, f));
}
const cssFiles = (root = ROOT) => sorted(path.join(root, 'src', 'css'), '.css');
const jsFiles = (root = ROOT) => sorted(path.join(root, 'src', 'js'), '.js');

// Подстановка через split/join: в коде много знаков $, а String.replace понимает их как шаблон.
const fill = (text, key, value) => text.split(`{{${key}}}`).join(value);

// Шрифты: правила @font-face из assets/fonts/fonts.css, файлы woff2 встроены data:-адресами —
// страница не обращается ни к Google, ни к серверу за шрифтами.
function fontsCss(root) {
  const dir = path.join(root, FONTS_DIR);
  return read(path.join(dir, 'fonts.css'))
    .replace(/^\/\*[\s\S]*?\*\/\n/, '') // шапка-комментарий файла в страницу не нужна
    .replace(/url\(([\w.-]+\.woff2)\)/g,
      (_, file) => 'url(data:font/woff2;base64,' + fs.readFileSync(path.join(dir, file)).toString('base64') + ')');
}

// ——— Закрытые куски страницы ———
// Сервер отдаёт страницу тому, кто не вошёл, без данных: снимков каталога с ценами и остатков и демо-записей.
// Сборка метит такие куски в одном и том же файле страницы, сервер вырезает их (stripGated) — второй копии кода нет.
//   /*CRM-GATE-OPEN*/ …кусок… /*CRM-GATE-STUB заглушка*/ /*CRM-GATE-CLOSE*/
// Вырезанный кусок заменяется заглушкой: объявлением с теми же именами, но без данных (или пустотой).
const GATE_OPEN = '/*CRM-GATE-OPEN*/', GATE_STUB = '/*CRM-GATE-STUB', GATE_END = '*/', GATE_CLOSE = '/*CRM-GATE-CLOSE*/';
const GATE_RE = /\/\*CRM-GATE-OPEN\*\/[\s\S]*?\/\*CRM-GATE-STUB([\s\S]*?)\*\/\/\*CRM-GATE-CLOSE\*\//g;
const gate = (text, stub = '') => {
  if (stub.includes(GATE_END)) throw new Error('В заглушке закрытого куска не может быть */');
  return GATE_OPEN + text + GATE_STUB + stub + GATE_END + GATE_CLOSE;
};
const stripGated = html => html.replace(GATE_RE, (_, stub) => stub);

// Что закрыто: файлы со снимками целиком (с заглушкой на месте), шаги SEEDS (демо-записи) и демо-команда seed().
const GATED_FILES = {
  '10-catalog-data.js': 'const CATALOG={source:null,snapshot:null,rows:[]};',
  '11-stock-data.js': 'const STOCK_SNAPSHOT={source:null,snapshot:null,rows:[]};',
};
const SEED_STEP = /^SEEDS\.push\([\s\S]*?^\}\);$/gm;   // шаг начинается и кончается в первой колонке
const SEED_TEAM = /^ {2}st\.people\.push\([\s\S]*?^ {2}\);$/m;   // демо-команда в seed() (20-model.js)
function gateFile(name, text) {
  // файл целиком кончается переводом строки, иначе метка попала бы в его последний комментарий
  if (name in GATED_FILES) return gate(text.endsWith('\n') ? text : text + '\n', GATED_FILES[name]);
  const steps = (text.match(/SEEDS\.push\(/g) || []).length;
  let found = 0;
  let out = text.replace(SEED_STEP, m => { found++; return gate(m); });
  if (found !== steps) throw new Error(`${name}: шагов SEEDS ${steps}, а закрыть удалось ${found} — шаг должен начинаться и кончаться в первой колонке (SEEDS.push( … ${'}'});)`);
  if (name === '20-model.js') {
    if (!SEED_TEAM.test(out)) throw new Error('20-model.js: не найдена демо-команда seed() (st.people.push( … ))');
    out = out.replace(SEED_TEAM, m => gate(m));
  }
  return out;
}

function build(root = ROOT) {
  const page = read(path.join(root, 'src', 'page.html'));
  for (const key of ['FONTS', 'CSS', 'JS']) {
    if (!page.includes(`{{${key}}}`)) throw new Error(`В src/page.html нет места {{${key}}}`);
  }
  const css = cssFiles(root).map(read).join('\n');
  const js = "(()=>{\n'use strict';\n\n" + jsFiles(root).map(f => gateFile(path.basename(f), read(f))).join('\n') + '})();\n';
  // страница без закрытых кусков обязана оставаться рабочим кодом
  new vm.Script(stripGated(js), { filename: 'страница без закрытых кусков' });
  const logo = 'data:image/png;base64,' + fs.readFileSync(path.join(root, LOGO_FILE)).toString('base64');
  let html = fill(page, 'FONTS', fontsCss(root));
  html = fill(html, 'CSS', css);
  html = fill(html, 'JS', js);
  const spots = html.split('{{LOGO}}').length - 1;
  if (spots !== 1) throw new Error(`Место {{LOGO}} должно быть ровно одно, а их ${spots}`);
  html = fill(html, 'LOGO', logo);
  return HEAD + '\n' + html;
}

module.exports = { build, cssFiles, jsFiles, stripGated, ROOT, OUT_NAME, HEAD };

if (require.main === module) {
  const html = build();
  const out = path.join(ROOT, OUT_NAME);
  fs.writeFileSync(out, html, 'utf8');
  console.log(`Собрано: ${OUT_NAME} — ${Buffer.byteLength(html)} байт`);
}
