'use strict';
// Общий загрузчик кода страницы в node:vm — им пользуются тесты (tests/load.js) и сервер (server/runtime.js).
//   loadCode(opts)  исполняет src/js/*.js (кроме 90-boot.js) в node:vm с заглушками document, localStorage, location
//                   и отдаёт { api, ctx, sandbox, storage }: api — всё объявленное на верхнем уровне (функции и константы)
//                   свойствами-геттерами, значение всегда текущее (S, например).
//   fakeWindow(opts) заглушки окружения браузера (их же берёт bootPage в tests/load.js).
//   Параметры: storage — localStorage, hash — location.hash, dark — тёмная ли тема устройства (prefers-color-scheme;
//              не задан — matchMedia нет), now — «сейчас» страницы (new Date() и Date.now() без аргументов отдают его),
//              globals — что ещё положить в окно (например, CRM_SERVER: 1 или поддельный FileReader).

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { jsFiles } = require('./build.js');

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
  // таймеры страницы (тосты, отложенное сохранение) не держат процесс
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

// Код src/js без запуска страницы (90-boot.js) — в node:vm. Состояние S не поднимается: это делает вызывающий.
function loadCode(opts = {}) {
  const files = jsFiles().filter(f => path.basename(f) !== '90-boot.js');
  const code = files.map(f => fs.readFileSync(f, 'utf8')).join('\n');
  const { sandbox, storage } = fakeWindow(opts);
  const ctx = vm.createContext(sandbox);
  // Как в сборке — строгий режим; но без IIFE, чтобы объявления верхнего уровня были видны снаружи.
  vm.runInContext("'use strict';\n" + code, ctx, { filename: 'src/js/*.js' });
  const api = {};
  for (const name of declaredNames(code)) {
    let top = false;
    try { top = vm.runInContext(`typeof ${name} !== 'undefined'`, ctx); } catch { top = false; }
    if (top) Object.defineProperty(api, name, { get: () => vm.runInContext(name, ctx), enumerable: true });
  }
  return { api, ctx, sandbox, storage };
}

module.exports = { loadCode, fakeWindow, fakeEl };
