'use strict';
// Миграции формы записей серверной базы. В браузере смена Store.REV стирает сохранённое; на сервере — никогда:
// база ревизии N доводится до Store.REV шагами из MIGRATIONS, а если шага нет — сервер не запускается и говорит почему.
// Шаг: MIGRATIONS[n] = ({ db, docs }) => void — переводит базу ревизии n − 1 в ревизию n внутри одной транзакции.
// docs — { all(), put(key, id, data, seq), del(key, id) } из server/db.js. Пока реестр пуст.

const MIGRATIONS = {};

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
