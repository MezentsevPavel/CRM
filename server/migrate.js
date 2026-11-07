'use strict';
// Миграции формы записей серверной базы. В браузере смена Store.REV стирает сохранённое; на сервере — никогда:
// база ревизии N доводится до Store.REV шагами из MIGRATIONS, а если шага нет — сервер не запускается и говорит почему.
// Шаг: MIGRATIONS[n] = ({ db, docs }) => void — переводит базу ревизии n − 1 в ревизию n внутри одной транзакции.
// docs — { all(), put(key, id, data, seq), del(key, id) } из server/db.js; core — ядро страницы (server/runtime.js), если шагу нужны
// его расчёты (Docs, Catalog): шаг считает ими, а не копирует правила.

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
  // 20: категории товаров деревом и право «Добавлять товары в номенклатуру» (catalog) всем ролям — слова директора 2026-11-07
  // («Новые товары — пусть все могут создавать пока»; список номенклатуры иерархией). Дерево (документы categories) собирается из
  // категорий существующих товаров тем же Catalog.treeFrom, что у новой базы и демо; уже есть дерево — не трогаем. Артикул (sku) у товара
  // необязателен, переводить нечего.
  20: ({ db, docs, core }) => {
    const seq = Number((db.prepare("SELECT v FROM meta WHERE k = 'seq'").get() || {}).v) || 0;
    const rows = docs.all();
    for (const r of rows) {
      if (r.key !== 'roles') continue;
      const role = JSON.parse(r.data);
      if (!role.perms || role.perms.catalog === true) continue;
      role.perms.catalog = true;
      docs.put('roles', r.id, JSON.stringify(role), seq);
    }
    if (rows.some(r => r.key === 'categories')) return;
    const all = {};
    for (const r of rows) all[core.Docs.docId(r.key, r.id)] = JSON.parse(r.data);
    const st = core.Docs.join(all);
    for (const node of core.Catalog.treeFrom(st.products)) docs.put('categories', node.id, JSON.stringify(node), seq);
  },
  // 21: каталог из таблицы PVCalc: артикулы у товаров сайта и лист «Электрика» (товары поставщиков, цена продажи у них пуста). Нетронутые
  // товары снимка приходят в базу из кода сами (Docs.join), поэтому шаг доводит то, что само не приходит: у товаров, правленых раньше
  // (их документы — полные записи), заполняется только пустое (артикул, данные поставщика), в дерево категорий заводятся пути «Электрика ›
  // Автоматы» и другие новые. Считает Catalog.merge тем же снимком, что у новой базы; введённое вручную, названия и цены продажи не меняются,
  // снятые из списка товары не возвращаются. Это же делает кнопка «Обновить каталог из снимка».
  21: mergeCatalog,
  // 22: виды внутри категорий (слова директора 2026-11-08): «Инверторы › Гибридные», «ИБП», «Аккумуляторы › АГМ», «Контроллеры › MPPT», виды
  // «Защиты и соединений». Нетронутые товары снимка приходят в базу из кода сами (Docs.join) уже с новым путём, поэтому шаг доводит то, что само
  // не приходит: постоянные узлы дерева (Catalog.STRUCT) и товары, у которых в базе есть документ: товар каталога с прежней верхней категорией
  // получает вид из снимка, позиция листа остатков — вид по названию. Товар, которому категорию меняли руками (в документе другая категория),
  // не меняется; то же делает Catalog.merge, он же — кнопка «Обновить каталог из снимка». Повторный запуск ничего не меняет.
  22: mergeCatalog,
};
function mergeCatalog({ db, docs, core }) {
  const seq = Number((db.prepare("SELECT v FROM meta WHERE k = 'seq'").get() || {}).v) || 0;
  const all = {}, removed = [];
  for (const r of docs.all()) {
    all[core.Docs.docId(r.key, r.id)] = JSON.parse(r.data);
    if (r.key === 'products' && all[core.Docs.docId(r.key, r.id)] === null) removed.push(r.id);
  }
  const st = core.Docs.join(all);
  const done = core.Catalog.merge(st, core.api.CATALOG, removed);
  for (const id of [...done.added, ...done.filled]) docs.put('products', id, JSON.stringify(st.products.find(p => p.id === id)), seq);
  for (const id of done.categories) docs.put('categories', id, JSON.stringify(st.categories.find(c => c.id === id)), seq);
}

// → null, если всё в порядке; иначе текст отказа запуска. Данные при отказе не меняются.
function migrate(store, rev, target, registry = MIGRATIONS, core = null) {
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
    for (let n = rev + 1; n <= target; n++) registry[n]({ db: store.db, docs: store.docs, core });
    store.meta.set('rev', target);
  });
  return null;
}

module.exports = { MIGRATIONS, migrate };
