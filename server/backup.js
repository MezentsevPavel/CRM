'use strict';
// Копии базы. Каждую ночь (час — CRM_BACKUP_HOUR, по умолчанию 3, по времени сервера TZ) сервер делает копию базы командой
// VACUUM INTO в data/backups и хранит CRM_BACKUP_KEEP (30) последних. Копия, пропущенная из-за выключенного сервера, делается
// при старте. Файлы фирмы (data/files) в копию не входят: они не перезаписываются, а удалённые лежат 30 дней — любая из копий
// с ними согласована.
//
// Имена: crm-ГГГГ-ММ-ДД.db — ночная; crm-ГГГГ-ММ-ДД-ЧЧММСС.db — «Сделать копию сейчас»;
//        crm-ГГГГ-ММ-ДД-ЧЧММСС-before-restore.db — копия текущей базы, снятая перед восстановлением.
// Восстановление не подменяет файл базы (его держит открытым сервер), а переписывает таблицы работающей базы из копии
// (ATTACH): сразу всё или ничего, с проверкой, что файл — копия базы CRM не новее программы.

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { MIGRATIONS, migrate } = require('./migrate.js');

const MINUTE = 60e3;
const NAME_RE = /^crm-(\d{4})-(\d{2})-(\d{2})(?:-(\d{2})(\d{2})(\d{2}))?(-before-restore)?\.db$/;
// Что переносится из копии. Вход (sessions, attempts) остаётся как есть; сеансы людей, которых в копии нет, закрываются.
const TABLES = ['docs', 'meta', 'users', 'files', 'file_refs', 'log'];
const REQUIRED = ['docs', 'meta', 'users', 'sessions', 'files', 'file_refs', 'log'];
// Счётчики в meta, которые не откатываются назад: номера и метки сеансов не должны повториться
const keepsMax = k => k === 'seq' || k === 'tags' || k.startsWith('ids:');

class BackupError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const pad = (n, w = 2) => String(n).padStart(w, '0');
const sql = p => "'" + String(p).replace(/'/g, "''") + "'";
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hms = d => pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());

// Час ночной копии: CRM_BACKUP_HOUR, целое 0–23; иначе 3. Сколько хранить: CRM_BACKUP_KEEP, целое от 1; иначе 30.
function envInt(value, min, max, def) {
  if (value === undefined || value === null || String(value).trim() === '') return def;
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : def;
}

function createBackups({ store, dataDir, sync, revision, now, keep, hour } = {}) {
  const env = process.env;
  const KEEP = envInt(keep !== undefined ? keep : env.CRM_BACKUP_KEEP, 1, 100000, 30);
  const HOUR = envInt(hour !== undefined ? hour : env.CRM_BACKUP_HOUR, 0, 23, 3);
  const dir = path.join(dataDir, 'backups');
  let timer = null;

  // Разбор имени: kind и ключ порядка (дата и время; у ночной — час её слота)
  function parse(name) {
    const m = NAME_RE.exec(name);
    if (!m) return null;
    const kind = m[7] ? 'before-restore' : m[4] ? 'manual' : 'nightly';
    return { name, kind, key: `${m[1]}${m[2]}${m[3]}${m[4] ? m[4] + m[5] + m[6] : pad(HOUR) + '0000'}` };
  }
  function list() {
    if (!fs.existsSync(dir)) return [];
    const out = [];
    for (const name of fs.readdirSync(dir)) {
      const p = parse(name);
      if (!p) continue;
      let st;
      try { st = fs.statSync(path.join(dir, name)); } catch { continue; }
      if (st.isFile()) out.push({ ...p, size: st.size, at: st.mtimeMs });
    }
    return out.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : a.name < b.name ? 1 : -1));
  }
  const publicOf = e => ({ name: e.name, size: e.size, at: e.at, kind: e.kind });

  function prune() {
    for (const e of list().slice(KEEP)) { try { fs.rmSync(path.join(dir, e.name), { force: true }); } catch { /* занят — удалится в следующий раз */ } }
  }

  // Копия базы сейчас. Пишется во временный файл и переименовывается: недописанной копии в списке не бывает.
  function make(kind = 'manual', noPrune = false) {
    fs.mkdirSync(dir, { recursive: true });
    const d = new Date(now());
    const name = kind === 'nightly' ? `crm-${ymd(d)}.db` : `crm-${ymd(d)}-${hms(d)}${kind === 'before-restore' ? '-before-restore' : ''}.db`;
    const target = path.join(dir, name), tmp = target + '.tmp';
    fs.rmSync(tmp, { force: true });
    try {
      store.db.exec(`VACUUM INTO ${sql(tmp)}`);
      fs.renameSync(tmp, target);
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      throw new BackupError(500, 'Копия не сделана: ' + e.message);
    }
    if (!noPrune) prune();
    return publicOf(list().find(x => x.name === name) || { name, kind, size: fs.statSync(target).size, at: Date.now() });
  }

  // Ночная копия, если для последнего срока (час HOUR сегодня, а если он ещё не наступил — вчера) копии ещё нет.
  // Зовётся каждую минуту и при старте: выключенный на ночь сервер делает пропущенную копию, как только включился.
  function tick() {
    const d = new Date(now());
    if (d.getHours() < HOUR) d.setDate(d.getDate() - 1);
    const slot = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(HOUR)}0000`;
    return list().some(e => e.key >= slot) ? null : make('nightly');
  }

  function start() {
    if (timer) return;
    try { tick(); } catch (e) { console.error('Копия базы не сделана:', e.message); }
    timer = setInterval(() => { try { tick(); } catch (e) { console.error('Копия базы не сделана:', e.message); } }, MINUTE);
    timer.unref?.();
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }

  // Имя из списка → путь; чужое имя (с путём, не по шаблону) не пускается
  function resolve(name) {
    const n = String(name || '');
    if (!NAME_RE.test(n)) return null;
    const p = path.join(dir, n);
    return fs.existsSync(p) && fs.statSync(p).isFile() ? p : null;
  }

  // Файл — копия базы CRM, не новее программы? → ревизия копии; иначе BackupError с понятным текстом
  function inspect(file) {
    let d;
    try {
      d = new DatabaseSync(file, { readOnly: true });
      const tables = new Set(d.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name));
      const missing = REQUIRED.find(t => !tables.has(t));
      if (missing) throw new BackupError(400, `Это не копия базы CRM: в файле нет таблицы «${missing}».`);
      const ok = d.prepare('PRAGMA quick_check').get();
      if (!ok || String(Object.values(ok)[0]) !== 'ok') throw new BackupError(400, 'Копия повреждена: проверка целостности не прошла. Базу не меняю.');
      const row = d.prepare("SELECT v FROM meta WHERE k = 'rev'").get();
      const rev = row ? Number(row.v) : NaN;
      if (!Number.isInteger(rev)) throw new BackupError(400, 'Это не копия базы CRM: в файле нет ревизии формы данных.');
      const target = revision;
      if (rev > target) throw new BackupError(400, `Копия новее программы (ревизия ${rev}, программа ждёт ${target}): базу не меняю. Поставь более новую версию программы.`);
      for (let n = rev + 1; n <= target; n++) {
        if (typeof MIGRATIONS[n] !== 'function') throw new BackupError(400, `Копия старше программы (ревизия ${rev}, программа ждёт ${target}), а шага миграции до ${n} нет: базу не меняю.`);
      }
      return rev;
    } catch (e) {
      if (e instanceof BackupError) throw e;
      throw new BackupError(400, 'Файл не открывается как база данных: он повреждён или это не копия базы CRM. Базу не меняю.');
    } finally {
      try { d && d.close(); } catch { /* уже закрыт */ }
    }
  }

  function columns(schema, table) {
    return store.db.prepare(`PRAGMA ${schema}.table_info(${table})`).all().map(r => r.name);
  }

  // Восстановить базу из копии: имя из списка (с кнопки) или путь к файлу (командой на сервере).
  // Порядок: проверить файл → снять копию текущей базы («перед восстановлением») → переписать таблицы одной транзакцией →
  // перечитать состояние → закрыть сеансы людей, которых в копии нет → onRestored (вкладкам — reload).
  // → { before: имя копии текущей базы, from: имя файла }. Отказ — BackupError (status 400/404).
  function restore(file) {
    const given = String(file || '');
    const src = resolve(given) || (!NAME_RE.test(given) && given && fs.existsSync(given) && fs.statSync(given).isFile() ? path.resolve(given) : null);
    if (!src) throw new BackupError(404, 'Такой копии нет.');
    const rev = inspect(src);
    const before = make('before-restore', true);
    const tokensBefore = store.db.prepare('SELECT tokenHash FROM sessions').all().map(r => r.tokenHash);
    const keepNow = new Map(store.db.prepare('SELECT k, v FROM meta').all().map(r => [r.k, r.v]));
    store.db.exec(`ATTACH DATABASE ${sql(src)} AS bk`);
    try {
      store.tx(() => {
        for (const t of TABLES) {
          const main = columns('main', t), bk = new Set(columns('bk', t));
          const cols = main.filter(c => bk.has(c)).map(c => `"${c}"`).join(', ');
          store.db.exec(`DELETE FROM main."${t}"`);
          store.db.exec(`INSERT INTO main."${t}" (${cols}) SELECT ${cols} FROM bk."${t}"`);
        }
        // счётчики номеров и меток сеансов — не меньше, чем были; seq — больше любого прежнего (чужой процесс увидит перемену)
        for (const [k, v] of keepNow) {
          if (!keepsMax(k)) continue;
          const got = store.meta.get(k);
          const top = Math.max(Number(v) || 0, got === null ? 0 : Number(got) || 0);
          store.meta.set(k, k === 'seq' ? top + 1 : top);
        }
        store.db.exec('DELETE FROM sessions WHERE personId NOT IN (SELECT personId FROM users)');
      });
    } finally {
      try { store.db.exec('DETACH DATABASE bk'); } catch { /* не подключена */ }
    }
    if (rev < revision) {
      const refusal = migrate(store, rev, revision);
      if (refusal) throw new BackupError(500, refusal);
    }
    sync.load();
    const alive = new Set(store.db.prepare('SELECT tokenHash FROM sessions').all().map(r => r.tokenHash));
    sync.sweepViews(tokensBefore);   // вкладки помнят, что получили от прежней базы: заново
    prune();
    if (api.onRestored) api.onRestored({ closed: tokensBefore.filter(h => !alive.has(h)) });
    return { before: before.name, from: path.basename(src) };
  }

  const api = {
    dir, keep: KEEP, hour: HOUR, NAME_RE, list: () => list().map(publicOf), make, tick, start, stop, resolve, restore, BackupError,
    onRestored: null,
  };
  return api;
}

module.exports = { createBackups, BackupError, NAME_RE };
