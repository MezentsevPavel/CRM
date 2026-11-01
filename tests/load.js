'use strict';
// Загрузчик для тестов — единственный шов между тестами и кодом страницы.
//   load()          исполняет src/js/*.js (кроме 90-boot.js) в node:vm с заглушками document,
//                   localStorage, location, поднимает состояние как запуск (S = startState(), без
//                   первой отрисовки) и отдаёт всё объявленное на верхнем уровне
//                   (функции и константы) как свойства-геттеры: значение всегда текущее (S, например);
//                   ещё storage (содержимое localStorage) и document (заглушка: <html> — document.documentElement;
//                   document.dispatchEvent({type, target}) вызывает слушатели страницы — input, change, click…).
//   bootPage(html)  исполняет код <script> собранной страницы целиком, включая запуск,
//                   на заглушке DOM и отдаёт элементы по id — что страница в них нарисовала.
//   Параметры обоих: storage — localStorage, hash — location.hash,
//                    dark — тёмная ли тема устройства (prefers-color-scheme); не задан — matchMedia нет.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { jsFiles } = require('../tools/build.js');

// Заглушка элемента: столько, сколько нужно коду при загрузке и первой отрисовке.
function fakeEl(id) {
  const cls = new Set();
  return {
    id, innerHTML: '', textContent: '', value: '', hidden: false, scrollTop: 0,
    dataset: {}, style: {},
    classList: {
      add: (...c) => c.forEach(x => cls.add(x)),
      remove: (...c) => c.forEach(x => cls.delete(x)),
      toggle: (c, on) => ((on ?? !cls.has(c)) ? cls.add(c) : cls.delete(c), cls.has(c)),
      contains: c => cls.has(c),
    },
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
    closest: () => null, focus() {}, scrollTo() {},
    appendChild() {}, remove() {}, insertAdjacentHTML() {},
  };
}

// Заглушки окружения браузера. storage — содержимое localStorage, hash — location.hash,
// dark — ответ prefers-color-scheme: dark (undefined — в окружении нет matchMedia),
// now — «сейчас» страницы: new Date() и Date.now() без аргументов отдают его (undefined — настоящие часы),
// globals — что ещё положить в окно (например, поддельный FileReader).
function fakeWindow({ storage = {}, hash = '', dark, now, globals } = {}) {
  const els = new Map();
  const byId = id => { if (!els.has(id)) els.set(id, fakeEl(id)); return els.get(id); };
  // слушатели страницы на document запоминаются: тест шлёт событие через dispatchEvent({type, target})
  const listeners = {};
  const document = {
    addEventListener(type, f) { (listeners[type] ||= []).push(f); },
    removeEventListener(type, f) { listeners[type] = (listeners[type] || []).filter(x => x !== f); },
    dispatchEvent(ev) { (listeners[ev.type] || []).forEach(f => f(ev)); return true; },
    getElementById: byId,
    querySelector: () => null, querySelectorAll: () => [],
    createElement: tag => fakeEl(tag),
    documentElement: fakeEl('html'),
  };
  const localStorage = {
    getItem: k => (Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: k => { delete storage[k]; },
  };
  // таймеры страницы (тосты, отложенное сохранение) не держат процесс тестов
  const timer = (f, ms) => { const t = setTimeout(f, ms); t.unref?.(); return t; };
  const sandbox = { document, localStorage, location: { hash }, console, setTimeout: timer, clearTimeout };
  if (globals) Object.assign(sandbox, globals);
  if (now !== undefined) {
    const at = new Date(now).getTime();
    sandbox.Date = new Proxy(Date, {
      construct: (D, args) => new D(...(args.length ? args : [at])),
      get: (D, key) => (key === 'now' ? () => at : Reflect.get(D, key)),
    });
  }
  if (dark !== undefined) {
    sandbox.matchMedia = q => ({ matches: /prefers-color-scheme:\s*dark/.test(q) && !!dark, addEventListener() {}, removeEventListener() {} });
  }
  return { sandbox, byId, storage };
}

// Имена, объявленные в коде: const/let/var/function. Внутренние имена потом отсеиваются проверкой.
const declaredNames = code => [...new Set(
  [...code.matchAll(/(?:^|[;{}\s])(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/g)].map(m => m[1]),
)];

function load(opts = {}) {
  const files = jsFiles().filter(f => path.basename(f) !== '90-boot.js');
  const code = files.map(f => fs.readFileSync(f, 'utf8')).join('\n');
  const { sandbox, storage } = fakeWindow(opts);
  const ctx = vm.createContext(sandbox);
  // Как в сборке — строгий режим; но без IIFE, чтобы объявления верхнего уровня были видны снаружи.
  vm.runInContext("'use strict';\n" + code, ctx, { filename: 'src/js/*.js' });
  // состояние — как при запуске страницы: из localStorage или seed(), только без первой отрисовки
  vm.runInContext("if (typeof startState === 'function') S = startState();", ctx);
  const api = {};
  for (const name of declaredNames(code)) {
    let top = false;
    try { top = vm.runInContext(`typeof ${name} !== 'undefined'`, ctx); } catch { top = false; }
    if (top) Object.defineProperty(api, name, { get: () => vm.runInContext(name, ctx), enumerable: true });
  }
  Object.defineProperty(api, 'storage', { value: storage });
  Object.defineProperty(api, 'document', { value: sandbox.document });
  return api;
}

function bootPage(html, opts = {}) {
  const m = html.match(/<script>([\s\S]*)<\/script>/);
  if (!m) throw new Error('В странице нет <script>');
  const { sandbox, byId, storage } = fakeWindow(opts);
  vm.runInContext(m[1], vm.createContext(sandbox), { filename: 'crm-wind-solar.html' });
  return { byId, storage, document: sandbox.document };
}

module.exports = { load, bootPage };
