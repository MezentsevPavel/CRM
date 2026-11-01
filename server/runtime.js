'use strict';
// Ядро прототипа на сервере: src/js/*.js (без 90-boot.js) грузятся в node:vm тем же загрузчиком, что у тестов
// (tools/vm-load.js), в серверном режиме (CRM_SERVER). Экран и сервер считают одним кодом: права (Perms, Guard),
// видимость (Visible, Leads), документы (Docs), уведомления по времени (Acts.notify, Leads.notifyWaiting).

const { loadCode } = require('../tools/vm-load.js');

function createRuntime() {
  const { api } = loadCode({ globals: { CRM_SERVER: 1 } });
  const core = {};
  for (const name of ['Docs', 'Ids', 'Visible', 'Guard', 'Store', 'Perms', 'Leads', 'Acts', 'Notify', 'Stock', 'Catalog', 'seedBase']) {
    Object.defineProperty(core, name, { get: () => api[name], enumerable: true });
  }
  // JSON текста документа → значение с живыми датами (как Store.load)
  core.parse = text => JSON.parse(text, api.Store.revive);
  core.api = api;
  return core;
}

module.exports = { createRuntime };
