'use strict';
// Команды директора на сервере (без браузера):
//   node server/admin.js create-director          — завести директора: имя, логин, пароль (пароль вводится без эха)
//   node server/admin.js reset-password <логин>   — выдать новый пароль; показывается один раз, при входе его надо сменить
//   node server/admin.js import-photos <папка> <файл связки> — прикрепить готовые фото к товарам по ключу каталога (у кого фото ещё нет)
//   node server/admin.js backups                 — список копий базы (data/backups)
//   node server/admin.js restore <файл> [--yes]   — восстановить базу из копии (имя из списка или путь к файлу); перед этим
//                                                   снимается копия текущей базы; без --yes спрашивает подтверждение
// Папка данных — CRM_DATA (по умолчанию ./data). Работает и при запущенном сервере: он перечитает базу сам.

const fs = require('node:fs');
const path = require('node:path');
const { openCore, adminOf } = require('./app.js');
const { importPhotos } = require('./photos.js');

const HELP = 'Команды:\n  node server/admin.js create-director\n  node server/admin.js reset-password <логин>\n  node server/admin.js backups\n  node server/admin.js restore <файл> [--yes]\n  node server/admin.js import-photos <папка с фото> <файл связки .json или .js>';

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

const KB = n => (n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' КБ' : (n / 1048576).toFixed(1).replace('.', ',') + ' МБ');
const KIND = { nightly: 'ночная', manual: 'сделана вручную', 'before-restore': 'перед восстановлением' };

async function main(argv) {
  const yes = argv.includes('--yes');
  const [cmd, arg, arg2] = argv.filter(a => a !== '--yes');
  if (!['create-director', 'reset-password', 'backups', 'restore', 'import-photos'].includes(cmd)) { console.log(HELP); return cmd ? 1 : 0; }
  const dataDir = path.resolve(process.env.CRM_DATA || path.join(__dirname, '..', 'data'));
  const ctx = openCore({ dataDir });
  const admin = adminOf(ctx);
  try {
    if (cmd === 'backups') {
      const list = ctx.backups.list();
      if (!list.length) { console.log(`Копий пока нет (папка ${ctx.backups.dir}). Сервер делает их сам каждую ночь; в «Настройки → Копии» копию можно сделать сразу.`); return 0; }
      for (const b of list) console.log(`${b.name}  ${new Date(b.at).toLocaleString('ru-RU')}  ${KB(b.size)}  ${KIND[b.kind] || b.kind}`);
      console.log(`Хранится последних: ${ctx.backups.keep}. Восстановить: node server/admin.js restore <имя копии>`);
      return 0;
    }
    if (cmd === 'restore') {
      if (!arg) { console.error('Укажи копию: node server/admin.js restore <имя из списка backups или путь к файлу>'); return 1; }
      if (!ctx.backups.resolve(arg) && !fs.existsSync(arg)) { console.error(`Нет такой копии: ${arg}. Список: node server/admin.js backups`); return 1; }
      if (!yes) {
        const ok = (await ask(`База будет заменена копией «${arg}». Всё, что записано после неё, пропадёт; сначала снимется копия текущей базы. Введи «да», чтобы продолжить: `)).trim().toLowerCase();
        if (ok !== 'да') { console.error('Не подтверждено — база не тронута'); return 1; }
      }
      const r = await admin.restore(arg);
      console.log(`Готово. База восстановлена из «${r.from}». Копия прежней базы: ${r.before}.`);
      console.log('Если сервер запущен, перезапусти его (на сервере: systemctl restart crm), иначе открытые вкладки продолжат со старыми данными.');
      return 0;
    }
    if (cmd === 'import-photos') {
      if (!arg || !arg2) { console.error('Укажи папку с фото и файл связки: node server/admin.js import-photos <папка> <файл связки .json или .js>'); return 1; }
      if (!fs.existsSync(arg) || !fs.existsSync(arg2)) { console.error('Нет такой папки или файла связки — проверь пути'); return 1; }
      const boss = (ctx.sync.state.people || []).find(x => x.role === 'director');
      if (!boss) { console.error('В базе нет директора — сначала: node server/admin.js create-director'); return 1; }
      const r = importPhotos(ctx, { dir: path.resolve(arg), mapFile: path.resolve(arg2), by: boss.id });
      console.log(`Прикреплено фото: ${r.attached.length}. Пропущено: ${r.skipped.length}.`);
      for (const x of r.skipped.slice(0, 30)) console.log(`  ${x.key}: ${x.reason}`);
      if (r.skipped.length > 30) console.log(`  … и ещё ${r.skipped.length - 30}`);
      console.log('Работающий сервер подхватит фото сам; открытые вкладки покажут их после обновления страницы.');
      return 0;
    }
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
