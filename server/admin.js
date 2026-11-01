'use strict';
// Команды директора на сервере (без браузера):
//   node server/admin.js create-director          — завести директора: имя, логин, пароль (пароль вводится без эха)
//   node server/admin.js reset-password <логин>   — выдать новый пароль; показывается один раз, при входе его надо сменить
// Папка данных — CRM_DATA (по умолчанию ./data). Работает и при запущенном сервере: он перечитает базу сам.

const path = require('node:path');
const { openCore, adminOf } = require('./app.js');

const HELP = 'Команды:\n  node server/admin.js create-director\n  node server/admin.js reset-password <логин>';

// Прочитанное из входа, но ещё не разобранное на строки (ввод через конвейер приходит одним куском)
let rest = '';
// Строка с клавиатуры; hidden — без эха (пароль)
function ask(question, hidden = false) {
  return new Promise(resolve => {
    const input = process.stdin, out = process.stdout;
    out.write(question);
    if (!hidden || !input.isTTY) {
      const take = () => {
        const i = rest.indexOf('\n');
        if (i < 0) return false;
        const line = rest.slice(0, i).replace(/\r$/, '');
        rest = rest.slice(i + 1);
        resolve(line);
        return true;
      };
      if (take()) return;
      const onData = d => { rest += d.toString('utf8'); if (take()) { input.removeListener('data', onData); input.pause(); } };
      const onEnd = () => { input.removeListener('data', onData); const line = rest; rest = ''; resolve(line); };
      input.once('end', onEnd);
      input.resume();
      input.on('data', onData);
      return;
    }
    let value = '';
    input.setRawMode(true);
    input.resume();
    const onKey = d => {
      for (const ch of d.toString('utf8')) {
        if (ch === '\r' || ch === '\n') {
          input.setRawMode(false); input.removeListener('data', onKey); input.pause(); out.write('\n');
          return resolve(value);
        }
        if (ch === '\u0003') { input.setRawMode(false); out.write('\n'); process.exit(130); }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else if (ch >= ' ') value += ch;
      }
    };
    input.on('data', onKey);
  });
}

async function main([cmd, arg]) {
  if (cmd !== 'create-director' && cmd !== 'reset-password') { console.log(HELP); return cmd ? 1 : 0; }
  const dataDir = path.resolve(process.env.CRM_DATA || path.join(__dirname, '..', 'data'));
  const ctx = openCore({ dataDir });
  const admin = adminOf(ctx);
  try {
    if (cmd === 'create-director') {
      const name = (await ask('Имя директора (как показывать в CRM): ')).trim();
      const login = (await ask('Логин: ')).trim();
      const password = await ask('Пароль (не короче 8 символов, не показывается): ', true);
      const again = await ask('Пароль ещё раз: ', true);
      if (password !== again) { console.error('Пароли не совпали — директор не заведён'); return 1; }
      await admin.createDirector(login, password, name);
      console.log(`Директор заведён. Вход: логин «${ctx.auth.normLogin(login)}» и пароль, который ты ввёл.`);
      return 0;
    }
    const login = ctx.auth.normLogin(arg || '');
    const user = ctx.auth.list().find(u => u.login === login);
    if (!login || !user) { console.error('Нет сотрудника с таким логином'); return 1; }
    const password = await admin.resetPassword(user.personId);
    console.log(`Новый пароль для «${login}»: ${password}\nПокажи его сотруднику — при входе CRM попросит сменить. Больше он нигде не показывается.`);
    return 0;
  } catch (e) {
    console.error('Не получилось:', e.message);
    return 1;
  } finally {
    ctx.store.close();
  }
}

if (require.main === module) main(process.argv.slice(2)).then(code => process.exit(code));

module.exports = { main };
