'use strict';
// Обновление CRM по кнопке («Настройки → Обновление», только директор). Сервер сам смотрит на GitHub, какая версия последняя,
// и по команде директора ставит её: копия базы → скачивание архива нужного коммита → проверка → замена кода → перезапуск.
// Данные (папка data) не трогаются. Прежний код складывается в data/update-backup (одна последняя копия) — вернуть вручную.
//
// Откуда: репозиторий CRM_UPDATE_REPO (по умолчанию MezentsevPavel/CRM), ветка master; репозиторий должен быть открытым.
// Что установлено, помнит файл .crm-version рядом с кодом ({sha, at, message}); в git он не лежит (.gitignore). Если файла нет
// (папку скопировали руками), версия — «нет данных», а «Обновить» ставит последнюю.
// Перезапуск: сервер выходит с кодом 75, а поднимает его снова systemd (на Ubuntu) или start.cmd / start.sh (на компьютере).
// Без такой обвязки сервер сам не встанет, поэтому он только ставит код и просит перезапустить его вручную.
// Если папка скачана через git (рядом есть .git), обновление идёт командой git pull --ff-only с ветки master: версию тогда говорит
// сам git, файл .crm-version не нужен. Нет команды git (папку скопировали вместе с .git на компьютер без git) — обновление архивом. Папка не на master или с несохранёнными правками кода не обновляется (чтобы ничего не потерять).

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');

const REPO = 'MezentsevPavel/CRM';
const BRANCH = 'master';
const EXIT_CODE = 75;
const MAX_BYTES = 100 * 1024 * 1024;
// Что не копируется из архива: данные, рабочие папки разработки, тесты
const SKIP = new Set(['.git', '.github', '.claude', '.autopilot', 'data', 'tests', 'node_modules', '.crm-version']);
// Без этих файлов архив — не CRM, и код не заменяется
const REQUIRED = ['server/main.js', 'server/app.js', 'tools/vm-load.js', 'crm-wind-solar.html'];

class UpdateError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const short = sha => String(sha || '').slice(0, 7);
// «feat: фото товара» → «фото товара»; служебные коммиты (docs, test, chore) в «Что нового» не показываются
const WORK = /^(feat|fix|refactor|perf)(\([^)]*\))?:\s*/i;
const SERVICE = /^(docs|test|chore|ci|build)(\([^)]*\))?:/i;
function titleOf(message) {
  const first = String(message || '').split('\n')[0].trim();
  return first.replace(WORK, '');
}

function createUpdater({ appDir, dataDir, backups, restart, supervised = false, repo, branch, fetch: fetchFn, now = Date.now, timeoutMs = 20000, gitCmd } = {}) {
  const REPO_ = repo || process.env.CRM_UPDATE_REPO || REPO;
  const BRANCH_ = branch || process.env.CRM_UPDATE_BRANCH || BRANCH;
  const http = fetchFn || ((url, opts) => fetch(url, opts));
  const versionFile = path.join(appDir, '.crm-version');
  let busy = false;

  // Режим git — только если рядом есть .git И команда git работает: у скопированной папки .git остаётся, а git на компьютере может не стоять —
  // тогда обновление идёт архивом, как у папки без .git
  const GIT = gitCmd || 'git';
  const gitMode = () => fs.existsSync(path.join(appDir, '.git')) && !cp.spawnSync(GIT, ['--version'], { windowsHide: true }).error;
  const git = args => cp.spawnSync(GIT, args, { cwd: appDir, encoding: 'utf8', timeout: 120000, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  function gitCurrent() {
    const r = git(['log', '-1', '--format=%H%n%cI%n%s']);
    if (r.error || r.status !== 0) return null;
    const [sha, at, subject] = String(r.stdout).trim().split(/\r?\n/);
    return /^[0-9a-f]{40}$/.test(sha) ? { sha, at: at || null, message: titleOf(subject) } : null;
  }
  function current() {
    if (gitMode()) return gitCurrent();
    try {
      const v = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
      return v && typeof v.sha === 'string' && /^[0-9a-f]{7,40}$/.test(v.sha) ? { sha: v.sha, at: v.at || null, message: v.message || '' } : null;
    } catch { return null; }
  }
  // Что показать на экране без запроса к GitHub
  function info() {
    return { current: current(), supervised: !!supervised, git: gitMode(), repo: REPO_, branch: BRANCH_ };
  }

  async function get(url, what) {
    let res;
    try {
      res = await http(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'crm-wind-solar-updater' }, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
    } catch {
      throw new UpdateError(502, `Нет связи с GitHub (${what}). Проверьте интернет на этом компьютере и повторите.`);
    }
    if (res.status === 404) throw new UpdateError(502, `GitHub не отдал ${what}: репозиторий ${REPO_} не найден или закрыт.`);
    if (res.status === 403 || res.status === 429) throw new UpdateError(502, 'GitHub временно не отвечает (слишком много запросов). Повторите через час.');
    if (!res.ok) throw new UpdateError(502, `GitHub ответил ошибкой ${res.status} (${what}).`);
    return res;
  }

  // Последняя версия на GitHub и что в ней нового с установленной
  async function check() {
    const res = await get(`https://api.github.com/repos/${REPO_}/commits?sha=${encodeURIComponent(BRANCH_)}&per_page=30`, 'список версий');
    let list;
    try { list = await res.json(); } catch { list = null; }
    if (!Array.isArray(list) || !list.length || typeof list[0].sha !== 'string') throw new UpdateError(502, 'GitHub вернул непонятный ответ о версиях.');
    const row = c => ({ sha: c.sha, title: titleOf(c.commit && c.commit.message), at: (c.commit && c.commit.committer && c.commit.committer.date) || null, service: SERVICE.test(String((c.commit && c.commit.message) || '')) });
    const rows = list.map(row);
    const cur = current();
    const idx = cur ? rows.findIndex(r => r.sha === cur.sha) : -1;
    const fresh = cur ? (idx >= 0 ? rows.slice(0, idx) : rows) : rows.slice(0, 5);
    return {
      latest: rows[0],
      current: cur,
      // true — стоит последняя; false — есть новее; null — установленную версию определить нельзя
      upToDate: cur ? cur.sha === rows[0].sha : null,
      news: fresh.filter(r => !r.service).map(r => ({ sha: r.sha, title: r.title, at: r.at })),
      farBehind: !!cur && idx < 0,
    };
  }

  const entries = dir => fs.readdirSync(dir, { withFileTypes: true });
  // Копия только файлов и папок (ссылки пропускаются: архив не должен вывести наружу)
  function copyTree(from, to) {
    fs.mkdirSync(to, { recursive: true });
    for (const e of entries(from)) {
      const a = path.join(from, e.name), b = path.join(to, e.name);
      if (e.isDirectory()) copyTree(a, b);
      else if (e.isFile()) fs.copyFileSync(a, b);
    }
  }

  // Папка скачана через git: код обновляет сам git (быстрая перемотка, без слияний и перезаписи чужих правок)
  async function applyGit(target) {
    const branch = String(git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout).trim();
    if (branch !== BRANCH_) throw new UpdateError(409, `Папка стоит на ветке «${branch}», а не «${BRANCH_}»: кнопка её не трогает, обновляйте через git вручную.`);
    if (String(git(['status', '--porcelain', '--untracked-files=no']).stdout).trim()) throw new UpdateError(409, 'В папке есть несохранённые правки кода — обновление остановлено, чтобы их не потерять.');
    const from = gitCurrent();
    const backup = backups.make('manual');
    const pull = git(['pull', '--ff-only', 'origin', BRANCH_]);
    if (pull.error || pull.status !== 0) {
      const why = String(pull.stderr || pull.error || '').trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] || 'без объяснения';
      throw new UpdateError(500, 'git не смог обновить папку (' + why + '). Код не тронут.');
    }
    const now = gitCurrent();
    const restarting = !!supervised;
    if (restarting && typeof restart === 'function') setTimeout(() => restart(EXIT_CODE), 800);
    return { ok: true, from: from ? from.sha : null, to: now ? now.sha : target.latest.sha, title: target.latest.title, backup: backup.name, restarting };
  }

  async function apply() {
    if (busy) throw new UpdateError(409, 'Обновление уже идёт.');
    busy = true;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-update-'));
    try {
      const target = await check();
      if (target.upToDate) throw new UpdateError(409, 'Уже стоит последняя версия.');
      if (gitMode()) return await applyGit(target);
      const sha = target.latest.sha;
      if (!/^[0-9a-f]{40}$/.test(sha)) throw new UpdateError(502, 'GitHub вернул непонятный номер версии.');

      // 1. копия базы: если что-то пойдёт не так, к ней можно вернуться («Настройки → Копии»)
      const backup = backups.make('manual');

      // 2. архив именно этого коммита
      const res = await get(`https://codeload.github.com/${REPO_}/tar.gz/${sha}`, 'архив версии');
      const len = Number(res.headers.get('content-length') || 0);
      if (len > MAX_BYTES) throw new UpdateError(502, 'Архив версии слишком большой — установка отменена.');
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length > MAX_BYTES || bytes.length < 100) throw new UpdateError(502, 'Архив версии пришёл повреждённым — установка отменена.');
      fs.writeFileSync(path.join(tmp, 'v.tgz'), bytes);

      // 3. распаковка системной командой tar (есть в Windows 10+ и в Ubuntu); относительные имена — чтобы не спотыкаться о «D:»
      const out = path.join(tmp, 'x');
      fs.mkdirSync(out);
      const t = cp.spawnSync('tar', ['-xzf', '../v.tgz'], { cwd: out, timeout: 120000, windowsHide: true });
      if (t.error && t.error.code === 'ENOENT') throw new UpdateError(500, 'На этом компьютере нет команды tar, распаковать обновление нечем.');
      if (t.error || t.status !== 0) throw new UpdateError(500, 'Не удалось распаковать архив версии — установка отменена, код не тронут.');
      const tops = entries(out).filter(e => e.isDirectory());
      if (tops.length !== 1) throw new UpdateError(500, 'В архиве версии неожиданное устройство папок — установка отменена, код не тронут.');
      const src = path.join(out, tops[0].name);
      for (const f of REQUIRED) {
        if (!fs.existsSync(path.join(src, f))) throw new UpdateError(500, `В архиве версии нет файла ${f} — установка отменена, код не тронут.`);
      }

      // 4. прежний код — в сторону, новый — на его место; при сбое посреди замены возвращается прежний
      const keep = path.join(dataDir, 'update-backup');
      fs.rmSync(keep, { recursive: true, force: true });
      const replaced = entries(src).filter(e => !SKIP.has(e.name) && (e.isFile() || e.isDirectory())).map(e => e.name);
      for (const name of replaced) {
        const old = path.join(appDir, name);
        if (!fs.existsSync(old)) continue;
        fs.statSync(old).isDirectory() ? copyTree(old, path.join(keep, name)) : (fs.mkdirSync(keep, { recursive: true }), fs.copyFileSync(old, path.join(keep, name)));
      }
      try {
        for (const name of replaced) {
          const from = path.join(src, name), to = path.join(appDir, name);
          if (fs.statSync(from).isDirectory()) { fs.rmSync(to, { recursive: true, force: true }); copyTree(from, to); }
          else fs.copyFileSync(from, to);
        }
        fs.writeFileSync(versionFile, JSON.stringify({ sha, at: new Date(now()).toISOString(), message: target.latest.title }));
      } catch (e) {
        for (const name of replaced) {
          const saved = path.join(keep, name), to = path.join(appDir, name);
          if (!fs.existsSync(saved)) continue;
          try {
            if (fs.statSync(saved).isDirectory()) { fs.rmSync(to, { recursive: true, force: true }); copyTree(saved, to); } else fs.copyFileSync(saved, to);
          } catch { /* вернуть не вышло — прежний код остаётся в data/update-backup */ }
        }
        throw new UpdateError(500, 'Код заменить не удалось (' + e.message + '). Прежний код возвращён; если что-то выглядит странно — он лежит в data/update-backup.');
      }

      const restarting = !!supervised;
      if (restarting && typeof restart === 'function') setTimeout(() => restart(EXIT_CODE), 800);
      return { ok: true, from: target.current ? target.current.sha : null, to: sha, title: target.latest.title, backup: backup.name, restarting };
    } finally {
      busy = false;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  return { info, check, apply, EXIT_CODE };
}

module.exports = { createUpdater, UpdateError, EXIT_CODE, titleOf };
