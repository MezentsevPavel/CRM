'use strict';
// Отдаёт собранный crm-wind-solar.html на http://localhost:<порт> в скелете <!doctype html>…,
// как его оборачивает хостинг артефактов. Файл читается заново на каждый запрос.
// Запуск: node tools/serve.js 5178

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { ROOT, OUT_NAME } = require('./build.js');

const port = Number(process.argv[2]) || 5178;
const file = path.join(ROOT, OUT_NAME);

const wrap = body => '<!doctype html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n'
  + '<meta name="viewport" content="width=device-width, initial-scale=1">\n</head>\n<body>\n'
  + body + '\n</body>\n</html>\n';

http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (req.method !== 'GET' || (url !== '/' && url !== '/index.html')) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Нет такой страницы');
    return;
  }
  let body;
  try {
    body = fs.readFileSync(file, 'utf8');
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Нет собранного файла ${OUT_NAME}: запустите node tools/build.js`);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(wrap(body));
}).listen(port, '127.0.0.1', () => {
  console.log(`CRM: http://localhost:${port}`);
});
