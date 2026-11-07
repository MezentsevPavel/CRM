'use strict';
// Миграции формы записей серверной базы. В браузере смена Store.REV стирает сохранённое; на сервере — никогда:
// база ревизии N доводится до Store.REV шагами из MIGRATIONS, а если шага нет — сервер не запускается и говорит почему.
// Шаг: MIGRATIONS[n] = ({ db, docs }) => void — переводит базу ревизии n − 1 в ревизию n внутри одной транзакции.
// docs — { all(), put(key, id, data, seq), del(key, id) } из server/db.js.

const MIGRATIONS = {
  // 17: продажа между юрлицами — документ billing: от какого юрлица продаёт менеджер по умолчанию (как в seedBase: B2B — ВС,
  // B2C — ИП); кто выставляет счета — не выбран (значит, директор). Юрлица, которого в базе нет, не ставим: тип остаётся без
  // продавца, его выбирают в заявке. Документ уже есть — не трогаем.
  17: ({ db, docs }) => {
    const rows = docs.all();
    if (rows.some(r => r.key === 'billing')) return;
    const have = new Set(rows.filter(r => r.key === 'entities').map(r => r.id));
    const want = { b2b: 'vs', b2c: 'ip' }, doc = { seller: {} };
    for (const [scope, id] of Object.entries(want)) if (have.has(id)) doc.seller[scope] = id;
    const seq = Number((db.prepare("SELECT v FROM meta WHERE k = 'seq'").get() || {}).v) || 0;
    docs.put('billing', '', JSON.stringify(doc), seq);
  },
  // 18: резерв без сделки, история резерва, «Сообщить, когда появится». Новые поля резерва и журнала необязательны: у старых
  // записей их нет, экран пишет «нет данных: кто / когда»; ключ watches без документов собирается пустым списком (Docs.join).
  // Переводить нечего — шаг только отмечает, что база этой формы.
  18: () => {},
  // 19: право «Настраивать авто-сообщения» (auto) — всем ролям, встроенным и своим (слова директора: шаблон сообщения клиентам
  // меняют все). Директору право и так есть. Снять его с роли можно в «Роли и права» как раньше.
  19: ({ db, docs }) => {
    const seq = Number((db.prepare("SELECT v FROM meta WHERE k = 'seq'").get() || {}).v) || 0;
    for (const r of docs.all()) {
      if (r.key !== 'roles') continue;
      const role = JSON.parse(r.data);
      if (!role.perms || role.perms.auto === true) continue;
      role.perms.auto = true;
      docs.put('roles', r.id, JSON.stringify(role), seq);
    }
  },
};

// → null, если всё в порядке; иначе текст отказа запуска. Данные при отказе не меняются.
function migrate(store, rev, target, registry = MIGRATIONS) {
  if (rev === target) return null;
  if (rev > target) {
    return `База ревизии ${rev}, а код ждёт ревизию ${target}: база новее кода. Данные не тронуты — поставь код той же или более новой версии.`;
  }
  for (let n = rev + 1; n <= target; n++) {
    if (typeof registry[n] !== 'function') {
      return `База ревизии ${rev}, а код ждёт ревизию ${target}: нет шага миграции до ревизии ${n} в server/migrate.js. `
        + 'Данные не тронуты — верни прежнюю версию кода или допиши миграцию.';
    }
  }
  store.tx(() => {
    for (let n = rev + 1; n <= target; n++) registry[n]({ db: store.db, docs: store.docs });
    store.meta.set('rev', target);
  });
  return null;
}

module.exports = { MIGRATIONS, migrate };
