'use strict';
// Запуск сервера CRM: node server/main.js
// Переменные: CRM_PORT (3000), CRM_HOST (127.0.0.1 — снаружи ходят через Caddy), CRM_DATA (./data), CRM_SECURE_COOKIE (0/1 —
// cookie только по https), CRM_FILE_MAX_MB (20), TZ (часовой пояс текстов уведомлений и сроков, например Asia/Irkutsk).
// Копии базы (CRM_BACKUP_HOUR, CRM_BACKUP_KEEP) — server/backup.js.

const path = require('node:path');
const { createApp } = require('./app.js');

const env = process.env;
const opts = {
  dataDir: path.resolve(env.CRM_DATA || path.join(__dirname, '..', 'data')),
  port: Number(env.CRM_PORT) || 3000,
  host: env.CRM_HOST || '127.0.0.1',
  secureCookie: env.CRM_SECURE_COOKIE === '1',
  fileMaxMb: Number(env.CRM_FILE_MAX_MB) || 20,
};

createApp(opts).then(app => {
  console.log(`CRM запущена: ${app.url} (данные: ${opts.dataDir})`);
  const stop = () => app.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}).catch(e => {
  console.error('CRM не запущена:', e.message);
  process.exit(1);
});
