'use strict';
// Точка входа для команды проверки `node --test tests/`: Node 24 не обходит папку сам,
// а запускает её как модуль — то есть этот файл. Он подключает все tests/*.test.js по имени.

const fs = require('node:fs');
const path = require('node:path');

for (const f of fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort()) {
  require(path.join(__dirname, f));
}
