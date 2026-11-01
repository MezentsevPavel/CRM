'use strict';
// Загрузчик для тестов — единственный шов между тестами и кодом страницы. Сам код грузит tools/vm-load.js
// (им же пользуется сервер, server/runtime.js).
//   load()          исполняет src/js/*.js (кроме 90-boot.js) в node:vm с заглушками document,
//                   localStorage, location, поднимает состояние как запуск (S = startState(), без
//                   первой отрисовки) и отдаёт всё объявленное на верхнем уровне
//                   (функции и константы) как свойства-геттеры: значение всегда текущее (S, например);
//                   ещё storage (содержимое localStorage) и document (заглушка: <html> — document.documentElement;
//                   document.dispatchEvent({type, target}) вызывает слушатели страницы — input, change, click…).
//   bootPage(html)  исполняет все <script> собранной страницы по порядку (серверная страница — два: метка CRM_SERVER
//                   и основной), включая запуск, на заглушке DOM и отдаёт элементы по id — что страница в них нарисовала.
//   Параметры обоих: storage — localStorage, hash — location.hash,
//                    dark — тёмная ли тема устройства (prefers-color-scheme); не задан — matchMedia нет,
//                    now — «сейчас» страницы, globals — что ещё положить в окно.

const vm = require('node:vm');
const { loadCode, fakeWindow } = require('../tools/vm-load.js');

function load(opts = {}) {
  const { api, ctx, sandbox, storage } = loadCode(opts);
  // состояние — как при запуске страницы: из localStorage или seed(), только без первой отрисовки
  vm.runInContext("if (typeof startState === 'function') S = startState();", ctx);
  Object.defineProperty(api, 'storage', { value: storage });
  Object.defineProperty(api, 'document', { value: sandbox.document });
  return api;
}

function bootPage(html, opts = {}) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  if (!scripts.length) throw new Error('В странице нет <script>');
  const { sandbox, byId, storage } = fakeWindow(opts);
  const ctx = vm.createContext(sandbox);
  // window.X в скрипте метки — глобальное имя X, как в браузере
  if (scripts.length > 1 && sandbox.window === undefined) {
    sandbox.window = vm.runInContext('this', ctx);
    sandbox.addEventListener = () => {};
    sandbox.removeEventListener = () => {};
  }
  for (const code of scripts) vm.runInContext(code, ctx, { filename: 'crm-wind-solar.html' });
  return { byId, storage, document: sandbox.document };
}

module.exports = { load, bootPage };
