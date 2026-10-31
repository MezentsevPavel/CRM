'use strict';
// Основа: сборка из src/ и загрузка кода для тестов. Ожидаемые значения — из описания v2
// (.autopilot/…/notes.md: таблица разделов NAV и число демо-записей в seed), а не из кода под тестом.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { build, ROOT, OUT_NAME } = require('../tools/build.js');
const { load, bootPage } = require('./load.js');

// Разделы v2 — как в notes.md, п. 2 «Разделы и права».
const V2_SECTIONS = [
  ['home', 'Сегодня'],
  ['tasks', 'Задачи'],
  ['notifications', 'Уведомления'],
  ['stock', 'Товары и остатки'],
  ['logistics', 'Поставки и перевозки'],
  ['receiving', 'Приёмка на складе'],
  ['clients', 'Клиенты и сделки'],
  ['messages', 'Сообщения клиентам'],
  ['team', 'Сотрудники и права'],
];

test('сборка: страница склеена из src/ по порядку имён, без пустых мест, с логотипом', () => {
  const html = build();
  assert.match(html.split('\n')[0], /собрано из src\/, руками не править/);
  for (const key of ['CSS', 'JS', 'LOGO']) assert.ok(!html.includes(`{{${key}}}`), `осталось место {{${key}}}`);
  assert.ok(html.includes('data:image/png;base64,'), 'нет логотипа data URI');
  assert.match(html, /<script>\n\(\(\)=>\{\n'use strict';/);
  // каждый файл src/ попал в страницу, и порядок — по имени файла (список строим здесь, не берём из сборки)
  for (const [dir, ext] of [['css', '.css'], ['js', '.js']]) {
    const folder = path.join(ROOT, 'src', dir);
    const files = fs.readdirSync(folder).filter(f => f.endsWith(ext)).sort().map(f => path.join(folder, f));
    assert.ok(files.length > 5, `в src/${dir} мало файлов`);
    let at = -1;
    for (const f of files) {
      const body = fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n').trim();
      const i = html.indexOf(body);
      assert.ok(i > at, `${path.basename(f)} не на своём месте в сборке`);
      at = i;
    }
  }
});

test('сборка: собранная страница запускается и показывает в меню каждый раздел v2', () => {
  const { byId } = bootPage(build());
  const side = byId('side').innerHTML;
  for (const [id, label] of V2_SECTIONS) {
    assert.ok(side.includes(`data-view="${id}"`), `в меню нет раздела ${id}`);
    assert.ok(side.includes(`<span>${label}</span>`), `в меню нет «${label}»`);
  }
  assert.equal(byId('ttl').textContent, 'Сегодня');
  assert.ok(byId('view').innerHTML.length > 1000, 'экран «Сегодня» пустой');
});

test('сборка: crm-wind-solar.html совпадает со сборкой из src/ (руками не правлен)', () => {
  const onDisk = fs.readFileSync(path.join(ROOT, OUT_NAME), 'utf8');
  assert.ok(onDisk === build(), 'файл отличается от сборки — запустите node tools/build.js');
});

test('load.js: код загружается, NAV — девять разделов v2 по порядку, у каждого есть вид', () => {
  const app = load();
  // Array.from — чтобы массив был из этого «мира», а не из node:vm (иначе deepEqual строго сравнит прототипы).
  // Разделы v3 («Настройки» и следующие) добавляются в NAV своими тасками — здесь только v2.
  const v2 = new Set(V2_SECTIONS.map(([id]) => id));
  assert.deepEqual(Array.from(app.NAV, n => [n.id, n.label]).filter(([id]) => v2.has(id)), V2_SECTIONS);
  assert.equal(app.Perms.roleOf(app.S, app.S.me).id, 'director', 'по умолчанию «я» — директор');
  for (const [id] of V2_SECTIONS) {
    assert.equal(typeof app.VIEWS[id], 'function', `нет вида ${id}`);
    const html = app.VIEWS[id]();
    assert.ok(typeof html === 'string' && html.length > 200, `вид ${id} пустой`);
  }
  assert.equal(app.esc('<a href="x">'), '&lt;a href=&quot;x&quot;&gt;');
  assert.equal(typeof app.render, 'function');
});

// Демо-записи разделов кладут шаги SEEDS (T02, T03, T06 заменяют свои) — поэтому здесь не число и не id
// записей, а то, что обязано держаться при любых демо: разделы v2 не пусты (notes.md, п. 3 «Записи»)
// и ссылки между записями ведут на существующие записи.
const V2_RECORDS = ['products', 'shipments', 'reserves', 'deals', 'tasks', 'notes', 'msgs', 'moves', 'rules'];

test('seed(): демо-записи v2 на месте — товары, поставки, задачи и остальное; ссылки целы', () => {
  const app = load();
  const st = app.seed();
  for (const k of V2_RECORDS) {
    assert.ok(Array.isArray(st[k]) && st[k].length > 0, `seed().${k} пуст`);
    assert.equal(app.S[k].length, st[k].length, `состояние S.${k} собрано не из seed()`);
  }
  assert.equal(app.S.view, 'home');
  const has = (list, id) => list.some(x => x.id === id);
  const isProduct = id => !!app.product(id);
  for (const r of st.reserves) {
    assert.ok(isProduct(r.productId), `резерв ${r.id}: товара ${r.productId} нет`);
    assert.ok(has(st.deals, r.dealId), `резерв ${r.id}: сделки ${r.dealId} нет`);
    assert.ok(r.src === 'stock' || has(st.shipments, r.src), `резерв ${r.id}: источника ${r.src} нет`);
  }
  for (const s of st.shipments) for (const it of s.items) assert.ok(isProduct(it.productId), `${s.id}: товара ${it.productId} нет`);
  for (const m of st.moves) assert.ok(isProduct(m.productId), `движение ${m.doc}: товара ${m.productId} нет`);
});

// Ключи записей — схема v3 из interfaces.md, «Состояние S»: товар и сделка — productId и dealId,
// у поставки — supplier, track, history[{at, by, text}] вместо from, doc, last v2.
test('seed(): резервы, движения и поставки — ключами схемы v3; поиск в шапке и главный экран читают их', () => {
  const app = load();
  const st = app.seed();
  const without = (x, keys, what) => keys.forEach(k => assert.ok(!(k in x), `${what}: осталось поле v2 «${k}»`));
  for (const r of st.reserves) {
    assert.ok(r.productId && r.dealId, `резерв ${r.id}: нет productId или dealId`);
    without(r, ['sku', 'deal'], `резерв ${r.id}`);
  }
  for (const m of st.moves) { assert.ok(m.productId, 'движение без productId'); without(m, ['sku'], `движение ${m.doc}`); }
  for (const s of st.shipments) {
    for (const it of s.items) { assert.ok(it.productId, `${s.id}: позиция без productId`); without(it, ['sku'], `${s.id}: позиция`); }
    without(s, ['from', 'doc', 'last'], s.id);
    assert.ok(typeof s.supplier === 'string' && s.supplier, `${s.id}: нет supplier`);
    assert.ok(typeof s.track === 'string' && s.track, `${s.id}: нет track`);
    assert.ok(Array.isArray(s.history) && s.history.length, `${s.id}: нет history`);
    for (const h of s.history) {
      assert.ok(Object.prototype.toString.call(h.at) === '[object Date]' && h.by && h.text, `${s.id}: отметка истории не {at, by, text}`);
    }
  }
  // поиск в шапке находит поставку по поставщику и по номеру документа (track) — значения из состояния
  const s = app.S.shipments[0];
  for (const q of [s.track, s.supplier]) {
    assert.ok(app.searchRes(q).some(x => x.type === 'Перевозка' && x.label.includes(s.id)), `поиск «${q}» не нашёл ${s.id}`);
  }
  // главный экран директора: открытая поставка опоздала — в «Требует внимания» текст последней отметки истории
  const late = app.S.shipments.find(x => !app.Pipes.isFinal(app.S, x.pipeId, x.stageId));
  late.eta = app.day(-3);
  const mark = late.history[late.history.length - 1].text;
  assert.ok(app.VIEWS.home().includes(app.esc(`Последняя отметка: ${mark}`)), 'на главном нет последней отметки задержанной поставки');
});

// Роли и их названия — spec.md, истории R03, R27–R30 (ожидание не берётся из Perms).
const SPEC_ROLES = {
  director: 'Директор', managerB2b: 'Менеджер B2B', managerB2c: 'Менеджер B2C', logist: 'Логист',
  warehouse: 'Кладовщик', chiefEngineer: 'Главный инженер', engineer: 'Инженер',
};

test('seed(): схема v3 — семь ролей в демо-команде, этапы записей — по id существующих этапов', () => {
  const { seed, SEEDS, Pipes, Perms } = load();
  const st = seed();
  assert.equal(st.v, 3);
  assert.ok(SEEDS.length >= 2 && SEEDS.every(f => typeof f === 'function'), 'SEEDS — шаги-функции');
  assert.deepEqual([...st.roles.map(r => r.id)].sort(), Object.keys(SPEC_ROLES).sort());
  const count = role => st.people.filter(p => p.role === role).length;
  for (const role of Object.keys(SPEC_ROLES)) assert.ok(count(role) >= 1, `в демо-команде нет роли ${role}`);
  assert.ok(count('managerB2b') >= 2, 'менеджеров B2B меньше двух');
  assert.ok(count('managerB2c') >= 2, 'менеджеров B2C меньше двух');
  for (const p of st.people.filter(p => p.role === 'engineer' || p.role === 'chiefEngineer')) {
    assert.ok(['designer', 'installer'].includes(p.specialty), `${p.name}: нет специализации`);
  }
  assert.ok(st.people.every(p => p.demo === true), 'демо-люди не помечены');
  assert.ok(st.people.some(p => p.id === st.me), 'me — не человек из команды');
  assert.ok(st.prefs && st.prefs.notify && typeof st.prefs.notify === 'object');
  // этап — id этапа своей воронки, номера нет
  const onStage = (x, pipeId) => assert.ok(pipeId && x.stageId && Pipes.stage(st, pipeId, x.stageId), `${x.id}: этапа ${pipeId}/${x.stageId} нет`);
  st.tasks.forEach(t => onStage(t, t.boardId));
  st.deals.forEach(d => onStage(d, d.pipeId));
  st.shipments.forEach(s => onStage(s, s.pipeId));
  for (const x of [...st.tasks, ...st.deals, ...st.shipments]) assert.ok(!('stage' in x) && !('status' in x), `${x.id}: осталось поле номера этапа`);
  // сделка ведётся менеджером своего типа
  for (const d of st.deals) assert.equal(Perms.roleOf(st, d.managerId)?.scope, d.type, `${d.id}: менеджер другого типа`);
  // уведомления адресованы людям, прочитанность — тоже по людям
  const ids = new Set(st.people.map(p => p.id));
  for (const n of st.notes) {
    assert.ok(n.to.length && n.to.every(id => ids.has(id)), `${n.id}: адресаты не люди`);
    assert.ok(n.read.every(id => n.to.includes(id)), `${n.id}: прочитал не адресат`);
  }
});

// ——— Ядро: Store, Perms, Pipes, Notify ———
// Ожидаемые значения — из interfaces.md (схема v3, воронки по умолчанию, RECIPIENTS) и из spec.md
// («Решения по реализации»: права по умолчанию; истории R02–R03, R27–R30, R10, R15), а не из кода.

// Значение из node:vm → обычный объект этого «мира» (иначе deepEqual сравнит чужие прототипы).
const plain = x => JSON.parse(JSON.stringify(x));
const isDate = v => Object.prototype.toString.call(v) === '[object Date]';

test('Store: даты переживают dump → load; ui не сохраняется; чужая версия и мусор → null', () => {
  const { Store } = load();
  assert.equal(Store.KEY, 'ws-crm-v3');
  const at = new Date('2026-10-31T09:15:00Z'), eta = new Date('2026-11-12T00:00:00Z');
  const st = {
    v: 3, me: 'p1', ui: { drawer: 'x' },
    notes: [{ id: 'n1', at, text: 'Поставка в Чите', to: ['p1'], read: [] }],
    shipments: [{ id: 's1', eta, history: [{ at, by: 'p1', text: 'Таможня' }] }],
  };
  const back = Store.load(Store.dump(st).text);
  assert.ok(isDate(back.notes[0].at), 'дата уведомления не ожила');
  assert.equal(back.notes[0].at.getTime(), at.getTime());
  assert.equal(back.shipments[0].eta.getTime(), eta.getTime());
  assert.equal(back.shipments[0].history[0].at.getTime(), at.getTime());
  assert.equal(back.ui, undefined, 'ui попал в сохранение');
  assert.equal(back.me, 'p1');
  assert.equal(Store.load(JSON.stringify({ v: 2, people: [] })), null, 'старая версия схемы');
  assert.equal(Store.load('{не json'), null);
  assert.equal(Store.load(null), null);
});

test('Store: не влезает в лимит — фото выкинуты и посчитаны, записи помечены, остальное цело', () => {
  const { Store } = load();
  const photo = 'data:image/jpeg;base64,' + 'A'.repeat(4000);
  const st = {
    v: 3,
    shipments: [
      { id: 's1', received: { photos: 2, urls: [photo, photo], note: 'коробка мятая' } },
      { id: 's2', received: { photos: 1, urls: [photo], note: '' } },
      { id: 's3', received: { photos: 0, urls: [], note: '' } },
    ],
  };
  const roomy = Store.dump(st, 100000);
  assert.equal(roomy.droppedPhotos, 0, 'места хватает — фото не трогаются');
  assert.equal(Store.load(roomy.text).shipments[0].received.urls.length, 2);

  const tight = Store.dump(st, 3000);
  assert.equal(tight.droppedPhotos, 3);
  assert.ok(tight.text.length <= 3000, 'без фото должно влезть');
  const back = Store.load(tight.text);
  const [r1, r2, r3] = back.shipments.map(s => s.received);
  assert.deepEqual(plain(r1.urls), []);
  assert.equal(r1.unsaved.photos, 2);
  assert.equal(r2.unsaved.photos, 1);
  assert.match(r1.unsaved.text, /не сохранено — мало места в браузере/);
  assert.equal(r3.unsaved, undefined, 'запись без фото помечена зря');
  assert.equal(r1.note, 'коробка мятая');
  assert.equal(st.shipments[0].received.urls.length, 2, 'dump испортил само состояние');
});

// Права по умолчанию — spec.md, «Решения по реализации» и истории R28–R30.
const ROLE_NAMES = ['Директор', 'Менеджер B2B', 'Менеджер B2C', 'Логист', 'Кладовщик', 'Главный инженер', 'Инженер'];
const MANAGER = ['stock', 'prices', 'reserve', 'leads', 'clients', 'write', 'mail'];
const DEFAULT_ON = {
  'Менеджер B2B': MANAGER,
  'Менеджер B2C': MANAGER,
  'Логист': ['stock', 'logistics', 'mail', 'tasksAssign'],
  'Кладовщик': ['stock', 'receive'],
  'Главный инженер': ['tasksAssign', 'stock', 'clients', 'dealsAll'],
  'Инженер': ['tasksAssign', 'stock', 'clients', 'dealsAll'],
};
const V2_PERMS = ['firm', 'tasksAll', 'tasksAssign', 'stock', 'prices', 'reserve', 'catalog', 'logistics', 'receive', 'clients', 'write', 'auto', 'admin'];

// Маленькая команда: по человеку на роль, у менеджера B2B двое.
function team(Perms) {
  const roles = Perms.defaultRoles();
  const id = name => roles.find(r => r.name === name).id;
  const people = [
    ['p1', 'Директор'], ['p2', 'Менеджер B2B'], ['p3', 'Менеджер B2B'], ['p4', 'Менеджер B2C'],
    ['p5', 'Логист'], ['p6', 'Кладовщик'], ['p7', 'Главный инженер'], ['p8', 'Инженер'],
  ].map(([pid, r]) => ({ id: pid, name: 'Сотрудник ' + pid, role: id(r), demo: true }));
  return { v: 3, roles, people, notes: [], prefs: { notify: {} } };
}

test('Perms: список прав — v2 и новые; семь встроенных ролей с правами по спецификации', () => {
  const { Perms } = load();
  const keys = Array.from(Perms.LIST, p => p[0]);
  assert.deepEqual(keys, [...V2_PERMS, 'mail', 'leads', 'dealsAll', 'settings']);
  assert.equal(Perms.LIST.find(p => p[0] === 'dealsAll')[1], 'Видеть сделки всех типов');
  const roles = Perms.defaultRoles();
  assert.deepEqual(Array.from(roles, r => r.name), ROLE_NAMES);
  assert.ok(roles.every(r => r.builtin === true));
  for (const r of roles.slice(1)) {
    const on = keys.filter(k => r.perms[k] === true).sort();
    assert.deepEqual(on, [...DEFAULT_ON[r.name]].sort(), `права роли «${r.name}»`);
  }
  const [chief, eng] = roles.slice(5);
  assert.deepEqual(plain(chief.perms), plain(eng.perms), 'у главного инженера и инженера разные матрицы');
});

test('Perms.can: право — по роли человека; у директора всё, и снять нельзя', () => {
  const { Perms } = load();
  const st = team(Perms);
  for (const [k] of Perms.LIST) assert.equal(Perms.can(st, 'p1', k), true, `директор: ${k}`);
  const dir = Perms.roleOf(st, 'p1');
  for (const k of Object.keys(dir.perms)) dir.perms[k] = false;
  assert.equal(Perms.can(st, 'p1', 'admin'), true, 'у директора сняли право');
  assert.equal(Perms.can(st, 'p2', 'reserve'), true);
  assert.equal(Perms.can(st, 'p2', 'dealsAll'), false, 'менеджер видит только свой тип');
  assert.equal(Perms.can(st, 'p5', 'logistics'), true);
  assert.equal(Perms.can(st, 'p6', 'receive'), true);
  assert.equal(Perms.can(st, 'p6', 'prices'), false);
  assert.equal(Perms.can(st, 'p8', 'admin'), false);
  // снятая галочка действует сразу
  Perms.roleOf(st, 'p6').perms.receive = false;
  assert.equal(Perms.can(st, 'p6', 'receive'), false);
  assert.equal(Perms.can(st, 'нет-такого', 'stock'), false);
  assert.equal(Perms.can(st, 'p1', 'опечатка'), false);
  assert.equal(Perms.roleOf(st, 'p4').name, 'Менеджер B2C');
});

test('Perms: своя роль добавляется; встроенная и роль с людьми не удаляются', () => {
  const { Perms } = load();
  const st = team(Perms);
  const acc = Perms.addRole(st, 'Бухгалтер', ['prices', 'firm']);
  assert.equal(acc.builtin, false);
  assert.equal(st.roles.length, 8);
  assert.equal(Perms.addRole(st, '  ', []), null, 'роль без имени');
  st.people.push({ id: 'p9', role: acc.id }, { id: 'p10', role: acc.id });
  assert.equal(Perms.can(st, 'p9', 'prices'), true);
  assert.equal(Perms.can(st, 'p9', 'stock'), false);

  const busy = Perms.removeRole(st, acc.id);
  assert.equal(busy.ok, false);
  assert.match(busy.reason, /2 сотрудника/);
  const builtin = Perms.removeRole(st, Perms.roleOf(st, 'p8').id);
  assert.equal(builtin.ok, false);
  assert.match(builtin.reason, /встроенн/);
  assert.equal(st.roles.length, 8, 'роль удалилась вопреки отказу');

  st.people = st.people.filter(p => p.role !== acc.id);
  assert.equal(Perms.removeRole(st, acc.id).ok, true);
  assert.equal(st.roles.length, 7);
});

// Воронки по умолчанию — interfaces.md, «Воронки по умолчанию».
const DEFAULT_PIPES = {
  ships: [['Заказано', 'Отгружено поставщиком', 'В пути до границы', 'Таможня', 'Перевалка в Чите', 'В пути до склада', 'Прибыло в город', 'На складе']],
  deals: [
    ['Заявка', 'Расчёт', 'КП', 'Договор', 'Оплата', 'Поставка', 'Монтаж', 'Сдана'],
    ['Заявка', 'Расчёт', 'КП', 'Договор', 'Оплата', 'Поставка', 'Монтаж', 'Сдана'],
  ],
  leads: [['Новый', 'Связались', 'Квалифицирован', 'Сделка создана', 'Отказ']],
  tasks: [['Новые', 'В работе', 'На проверке', 'Готово']],
};
const flagged = (p, flag) => p.stages.filter(s => s.flag === flag).map(s => s.name);

test('Pipes: воронки по умолчанию — как в interfaces.md, с флагами arrived и final', () => {
  const { Pipes } = load();
  assert.deepEqual(Array.from(Pipes.KINDS), ['tasks', 'deals', 'leads', 'ships']);
  const st = { pipelines: Pipes.defaults() };
  for (const [kind, lists] of Object.entries(DEFAULT_PIPES)) {
    assert.deepEqual(plain(Pipes.of(st, kind).map(p => p.stages.map(s => s.name))), lists, `этапы: ${kind}`);
  }
  const [ships] = Pipes.of(st, 'ships');
  assert.deepEqual(plain(flagged(ships, 'arrived')), ['Прибыло в город']);
  assert.deepEqual(plain(flagged(ships, 'final')), ['На складе']);
  assert.deepEqual(plain(flagged(Pipes.of(st, 'leads')[0], 'final')), ['Сделка создана', 'Отказ']);
  assert.deepEqual(plain(flagged(Pipes.of(st, 'tasks')[0], 'final')), ['Готово']);
  assert.deepEqual(plain(Pipes.of(st, 'tasks').map(p => p.name)), ['Общие']);
  assert.deepEqual(plain(Pipes.of(st, 'deals', 'b2b').map(p => p.name)), ['Сделки B2B']);
  assert.deepEqual(plain(Pipes.of(st, 'deals', 'b2c').map(p => p.name)), ['Сделки B2C']);
  const ids = ships.stages.map(s => s.id);
  assert.equal(new Set(ids).size, ids.length, 'id этапов повторяются');
  assert.equal(Pipes.isFinal(st, ships.id, ships.stages[7].id), true);
  assert.equal(Pipes.isFinal(st, ships.id, ships.stages[6].id), false);
});

test('Pipes: переименование и новый этап не ломают записи — этап хранится по id', () => {
  const { Pipes } = load();
  const st = { pipelines: Pipes.defaults(), tasks: [] };
  const board = Pipes.of(st, 'tasks')[0];
  const work = board.stages[1];
  st.tasks.push({ id: 't1', boardId: board.id, stageId: work.id });
  assert.equal(Pipes.renameStage(st, board.id, work.id, 'Делаем').ok, true);
  assert.equal(Pipes.renameStage(st, board.id, work.id, ' ').ok, false);
  assert.equal(Pipes.rename(st, board.id, 'Монтажный отдел').ok, true);
  const added = Pipes.addStage(st, board.id, 'Ждёт материалов', board.stages[0].id);
  assert.deepEqual(plain(board.stages.map(s => s.name)), ['Новые', 'Ждёт материалов', 'Делаем', 'На проверке', 'Готово']);
  assert.equal(Pipes.stage(st, board.id, added.id).name, 'Ждёт материалов');
  assert.equal(Pipes.stage(st, board.id, st.tasks[0].stageId).name, 'Делаем');
  assert.equal(Pipes.of(st, 'tasks')[0].name, 'Монтажный отдел');
  assert.equal(Pipes.items(st, board.id).length, 1);
});

test('Pipes.removeStage: записи этапа переезжают на выбранный, ни одна не теряется', () => {
  const { Pipes } = load();
  const st = { pipelines: Pipes.defaults(), shipments: [] };
  const ships = Pipes.of(st, 'ships')[0];
  const at = name => ships.stages.find(s => s.name === name).id;
  for (let i = 1; i <= 3; i++) st.shipments.push({ id: 'Т' + i, pipeId: ships.id, stageId: at('Таможня') });
  st.shipments.push({ id: 'Т4', pipeId: ships.id, stageId: at('Заказано') });
  const customs = at('Таможня'), transship = at('Перевалка в Чите');

  const refused = Pipes.removeStage(st, ships.id, customs);
  assert.equal(refused.ok, false, 'удалён этап с записями без выбора, куда их деть');
  assert.match(refused.reason, /3/);
  assert.equal(Pipes.removeStage(st, ships.id, at('На складе'), transship).ok, false, 'единственный завершающий этап');

  const r = Pipes.removeStage(st, ships.id, customs, transship);
  assert.equal(r.ok, true);
  assert.equal(r.moved, 3);
  assert.equal(ships.stages.length, 7);
  assert.equal(Pipes.stage(st, ships.id, customs), null);
  assert.equal(Pipes.items(st, ships.id).length, 4, 'запись потерялась');
  assert.deepEqual(st.shipments.map(s => Pipes.stage(st, ships.id, s.stageId).name),
    ['Перевалка в Чите', 'Перевалка в Чите', 'Перевалка в Чите', 'Заказано']);
});

test('Pipes: последнюю воронку вида не удалить; при удалении воронки сделки переезжают', () => {
  const { Pipes } = load();
  const st = { pipelines: Pipes.defaults(), deals: [], shipments: [] };
  const [ships] = Pipes.of(st, 'ships');
  const last = Pipes.removePipe(st, ships.id, null);
  assert.equal(last.ok, false);
  assert.match(last.reason, /последняя/);
  assert.equal(Pipes.of(st, 'ships').length, 1);

  const opt = Pipes.addPipe(st, 'deals', 'Оптовые', 'b2b');
  assert.deepEqual(plain(Pipes.of(st, 'deals', 'b2b').map(p => p.name)), ['Сделки B2B', 'Оптовые']);
  const contract = opt.stages.find(s => s.name === 'Договор').id;
  const done = opt.stages.find(s => s.name === 'Сдана').id;
  st.deals.push({ id: 'Д1', pipeId: opt.id, stageId: contract }, { id: 'Д2', pipeId: opt.id, stageId: done });
  const [b2b] = Pipes.of(st, 'deals', 'b2b');

  assert.equal(Pipes.removePipe(st, opt.id, ships.id).ok, false, 'сделки уехали в воронку поставок');
  const r = Pipes.removePipe(st, opt.id, b2b.id);
  assert.equal(r.ok, true);
  assert.equal(r.moved, 2);
  assert.equal(Pipes.items(st, b2b.id).length, 2, 'сделка потерялась');
  assert.deepEqual(st.deals.map(d => Pipes.stage(st, d.pipeId, d.stageId).name), ['Договор', 'Сдана']);
  assert.equal(Pipes.of(st, 'deals').length, 2);
});

test('Notify: поставки — всем сотрудникам, «товар на складе» — менеджерам и директору', () => {
  const { Perms, Notify } = load();
  const st = team(Perms);
  const now = new Date('2026-10-31T10:00:00Z');
  const ship = Notify.push(st, 'ship', 'p5', 'П-1: таможня в Чите, на складе 12.11', now);
  assert.deepEqual([...ship.to].sort(), ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']);
  assert.deepEqual([...ship.read], ['p5'], 'автор отметки своё уже видел');
  assert.equal(ship.at, now);
  const arrive = Notify.push(st, 'arrive', 'p6', 'П-1 принята на склад', now, ['p8']);
  assert.deepEqual([...arrive.to].sort(), ['p1', 'p2', 'p3', 'p4', 'p8']);
  assert.equal(st.notes[0], arrive, 'новое — в начале');
  assert.notEqual(ship.id, arrive.id);
  assert.throws(() => Notify.push(st, 'нет-такого', 'p1', '…', now));
});

test('Notify: два менеджера читают уведомления независимо', () => {
  const { Perms, Notify } = load();
  const st = team(Perms);
  const now = new Date('2026-10-31T10:00:00Z');
  Notify.push(st, 'arrive', 'p6', 'П-1 принята на склад', now);
  const second = Notify.push(st, 'arrive', 'p6', 'П-2 принята на склад', now);
  assert.equal(Notify.unread(st, 'p2').length, 2);
  assert.equal(Notify.unread(st, 'p3').length, 2);
  assert.equal(Notify.markRead(st, 'p2', second.id), 1);
  assert.equal(Notify.unread(st, 'p2').length, 1);
  assert.equal(Notify.markRead(st, 'p2'), 1);
  assert.equal(Notify.unread(st, 'p2').length, 0);
  assert.equal(Notify.unread(st, 'p3').length, 2, 'прочитал один — пропало у другого');
  assert.equal(Notify.unread(st, 'p6').length, 0, 'кладовщику «товар на складе» не адресовано');
});

test('Notify: выключенный у себя вид не приходит этому человеку, остальным приходит', () => {
  const { Perms, Notify } = load();
  const st = team(Perms);
  const now = new Date('2026-10-31T10:00:00Z');
  st.prefs.notify.p7 = { ship: false, arrive: true };
  st.prefs.notify.p2 = { ship: false };
  const n = Notify.push(st, 'ship', 'p5', 'П-3 отгружена поставщиком', now, ['p2']);
  assert.ok(!n.to.includes('p7'), 'выключил «Поставки», а уведомление пришло');
  assert.ok(!n.to.includes('p2'), 'выключенный вид пришёл через extraPersons');
  assert.equal(n.to.length, 6);
  assert.equal(Notify.unread(st, 'p7').length, 0);
  assert.equal(Notify.unread(st, 'p8').length, 1);
  assert.deepEqual([...Notify.recipients(st, 'arrive')].sort(), ['p1', 'p2', 'p3', 'p4']);
});

// ——— Разделы на ядре: этапы, приёмка, сохранение, «Кто я» ———
// Ожидания — из spec.md (R01, R15, R16, R59i) и из состояния до действия: демо-записи заменяют шаги SEEDS
// следующих тасков, поэтому ни числа, ни id демо здесь не зашиты.

test('этапы: в разделах и модели нет обращения к этапу по номеру', () => {
  const dir = path.join(ROOT, 'src', 'js');
  const files = fs.readdirSync(dir).filter(f => /^(20|5\d)-.*\.js$/.test(f));
  assert.ok(files.length >= 9, 'мало файлов разделов');
  // Только два признака номера этапа: сравнение этапа с числом и индекс stages[N]. Поле или фильтр
  // с именем stage (el.dataset.stage, {stage} в Ships.query) — законны и сюда не попадают.
  const bad = [
    /\bstages?\s*(===|!==|==|!=|>=|<=|>|<)\s*\d/,          // s.stage===3, d.stage>=6
    /\bstages?\[\s*\d+\s*\]/,                               // stages[0]
  ];
  for (const f of files) {
    fs.readFileSync(path.join(dir, f), 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*\/\//.test(line)) return;
      for (const re of bad) assert.ok(!re.test(line), `${f}:${i + 1}: ${line.trim().slice(0, 90)}`);
    });
  }
});

test('приёмка кладовщиком: остаток вырос на принятое, резервы переведены, уведомления и сообщения клиентам', () => {
  const app = load();
  // поставка, ждущая приёмки (этап с флагом arrived), под которую стоят резервы сделок — берётся из демо,
  // ожидаемое — из состояния до приёмки, а не из чисел демо (их заменяют шаги SEEDS следующих тасков)
  const flag = x => app.Pipes.stage(app.S, x.pipeId, x.stageId)?.flag;
  const resOn = s => app.S.reserves.filter(r => r.src === s.id);
  const dealOf = id => app.S.deals.find(d => d.id === id);
  const s = app.S.shipments.find(x => x.dir === 'in' && flag(x) === 'arrived' && resOn(x).some(r => dealOf(r.dealId)?.channel !== 'phone'));
  assert.ok(s, 'в демо нет поставки на этапе «прибыло» с резервом под сделку с мессенджером');
  const onHand = pid => app.product(pid).stock;
  const want = new Map();
  for (const it of s.items) want.set(it.productId, (want.get(it.productId) ?? onHand(it.productId)) + it.qty);
  const resIds = resOn(s).map(r => r.id);
  const waitDeals = [...new Set(resOn(s).map(r => r.dealId))].map(dealOf);
  app.S.rules.find(r => r.id === 'arrive').on = true; // авто-сообщения клиентам включены (R16)

  app.setMe('p5'); // Игорь К., кладовщик
  app.A['rcv-start']({ dataset: { id: s.id } });
  assert.equal(app.S.view, 'receiving');
  app.S.rcv.photos.push('data:image/jpeg;base64,AAAA');
  const notesBefore = app.S.notes.length, msgsBefore = app.S.msgs.length;
  app.A['rcv-confirm']();
  // принято столько, сколько ехало (количество в приёмке не меняли): остаток до + принято
  for (const [pid, n] of want) assert.equal(onHand(pid), n, `${pid}: остаток не вырос на принятое`);
  for (const id of resIds) assert.equal(app.S.reserves.find(r => r.id === id).src, 'stock', `${id} не переведён на склад`);
  assert.ok(app.Pipes.isFinal(app.S, s.pipeId, s.stageId), 'поставка не на завершающем этапе');
  assert.equal(s.received.photos, 1);
  // уведомления (R15): «товар на складе» — все менеджеры и директор; менеджеру сделки — отдельно
  const fresh = app.S.notes.slice(0, app.S.notes.length - notesBefore);
  const roleOf = id => app.S.people.find(p => p.id === id).role;
  const arrive = fresh.find(n => n.kind === 'arrive');
  assert.ok(arrive, 'нет уведомления «товар на складе»');
  assert.deepEqual([...new Set(arrive.to.map(roleOf))].sort(), ['director', 'managerB2b', 'managerB2c']);
  const managers = app.S.people.filter(p => /^manager/.test(p.role)).map(p => p.id);
  assert.ok(managers.length >= 4 && managers.every(id => arrive.to.includes(id)), 'не все менеджеры получили «товар на складе»');
  const perDeal = fresh.filter(n => n.text.startsWith('Уведомите клиента'));
  assert.equal(perDeal.length, waitDeals.length, '«уведомите клиента» — не по одному на сделку, ждавшую товар');
  for (const d of waitDeals) {
    const n = perDeal.find(x => x.text.includes(`(${d.id})`));
    assert.ok(n, `нет «уведомите клиента» по ${d.id}`);
    assert.ok(n.to.includes(d.managerId), `${d.id}: менеджер сделки не получил «уведомите клиента»`);
    assert.ok(!n.to.some(id => id !== d.managerId && managers.includes(id)), `${d.id}: «уведомите клиента» ушло чужому менеджеру`);
  }
  // сообщения клиентам (R16): по шаблону, в канал своей сделки, имитация; клиенту «только по телефону» не пишем
  const msgs = app.S.msgs.slice(msgsBefore);
  const chat = waitDeals.filter(d => d.channel !== 'phone');
  assert.deepEqual([...msgs.map(m => m.deal)].sort(), chat.map(d => d.id).sort());
  for (const d of chat) {
    const m = msgs.find(x => x.deal === d.id);
    assert.equal(m.channel, d.channel, `${d.id}: сообщение не в канал сделки`);
    assert.ok(m.auto && m.text.includes('пришёл на склад'), `${d.id}: сообщение не по шаблону`);
  }
});

test('сохранение: созданная задача переживает перезагрузку, даты — Date; сброс возвращает демо', () => {
  const app = load();
  const KEY = app.Store.KEY;
  assert.equal(app.storage[KEY], undefined);
  const demo = app.S.tasks.length; // задач в демо — до действия
  const set = (id, v) => { app.byId(id).value = v; };
  set('t-title', 'Проверить сохранение'); set('t-to', 'p:p6'); set('t-due', '2026-11-05'); set('t-prio', 'high');
  app.FORMS.task();
  assert.ok(app.storage[KEY], 'после действия состояние не записано в браузер');
  const again = load({ storage: app.storage }); // перезагрузка страницы
  const t = again.S.tasks.find(x => x.title === 'Проверить сохранение');
  assert.ok(t, 'задача пропала после перезагрузки');
  assert.ok(isDate(t.due) && isDate(t.at), 'даты задачи после загрузки — не Date');
  assert.equal(t.due.getDate(), 5);
  assert.equal(again.S.tasks.length, demo + 1, 'после перезагрузки задач не «демо + 1»');
  again.resetData();
  assert.equal(again.S.tasks.length, demo);
  assert.ok(!again.S.tasks.some(x => x.title === 'Проверить сохранение'));
  assert.equal(load({ storage: again.storage }).S.tasks.length, demo, 'сброс не записан в браузер');
  assert.equal(load({ storage: { [KEY]: '{битое' } }).S.tasks.length, demo, 'битое сохранение — не демо');
});

test('«Кто я»: в шапке каждый человек с ролью; задачи и прочитанность — этого человека', () => {
  const app = load();
  app.render();
  const opts = app.byId('role').innerHTML;
  for (const p of app.S.people) assert.ok(opts.includes(`>${p.name} — ${SPEC_ROLES[p.role]}</option>`), `нет «${p.name} — ${SPEC_ROLES[p.role]}»`);
  assert.equal((opts.match(/<option /g) || []).length, app.S.people.length);
  // «Мои задачи» второго менеджера B2B — его, а не первого (в v2 «я» = первый с ролью)
  const t3 = 'Обзвонить клиентов с резервом под контейнер П-1043'; // задача Максиму Л. (p3)
  app.setMe('p3');
  assert.ok(app.VIEWS.home().includes(t3));
  app.setMe('p9');
  assert.ok(!app.VIEWS.home().includes(t3), 'второй менеджер B2B видит чужую задачу как свою');
  // «товар на складе» — обоим менеджерам B2C; один открыл уведомления — у второго не прочитано
  const n = app.Notify.push(app.S, 'arrive', 'p5', 'П-9 принята на склад', new Date());
  app.setMe('p2');
  app.go('notifications');
  assert.ok(!app.Notify.unread(app.S, 'p2').some(x => x.id === n.id), 'открыл раздел — не прочитано');
  assert.ok(app.Notify.unread(app.S, 'p10').some(x => x.id === n.id), 'прочитал один менеджер — пропало у второго');
  app.go('home'); // на «Уведомлениях» смена человека сразу покажет и прочитает его список
  app.setMe('p10');
  assert.equal(Number(app.byId('bell-n').textContent), app.Notify.unread(app.S, 'p10').length);
  assert.ok(Number(app.byId('bell-n').textContent) >= 1);
});

// ——— шапка, тема, права в меню, «Настройки» (spec.md: R32 логотип, R33 тема, R34 настройки) ———

test('сборка: логотип wind-solar — data:image/png ровно один раз, в шапке меню; .mark и <template> нет; подпись «Кто я»', () => {
  const html = build();
  assert.equal(html.split('data:image/png;base64,').length - 1, 1, 'логотип встроен не один раз');
  const png = fs.readFileSync(path.join(ROOT, 'assets', 'windsolar-logo.png')).toString('base64');
  assert.ok(html.includes(`<div class="brand"><span class="logo"><img src="data:image/png;base64,${png}"`), 'логотип не в шапке меню');
  assert.ok(!/\.mark\{|class="mark"/.test(html), 'старый значок .mark остался');
  assert.ok(!html.includes('<template'), 'инертный <template> остался');
  assert.ok(html.includes('<span>Кто я</span><select id="role"'), 'подпись переключателя людей — не «Кто я»');
  assert.ok(!html.includes('Глазами'), 'осталась старая подпись «Глазами»');
});

test('тема: выбор ставит data-theme на <html>, «как в системе» — по prefers-color-scheme, переживает перезагрузку', () => {
  const app = load();
  app.render();
  const root = app.document.documentElement;
  const sw = app.byId('theme-sw').innerHTML;
  for (const k of ['light', 'dark', 'auto']) assert.ok(sw.includes(`data-act="theme" data-theme="${k}"`), `в шапке нет варианта ${k}`);
  for (const l of ['Светлая', 'Тёмная', 'Как в системе']) assert.ok(sw.includes(`title="${l}"`), `в шапке нет «${l}»`);
  app.A.theme({ dataset: { theme: 'dark' } });
  assert.equal(root.dataset.theme, 'dark');
  assert.ok(app.byId('theme-sw').innerHTML.includes('class="on" data-act="theme" data-theme="dark"'), 'в шапке не отмечена тёмная');
  app.A.theme({ dataset: { theme: 'light' } });
  assert.equal(root.dataset.theme, 'light');
  app.A.theme({ dataset: { theme: 'dark' } });
  assert.equal(app.S.prefs.theme, 'dark');
  assert.equal(app.Store.load(app.Store.dump(app.S).text).prefs.theme, 'dark', 'тема не пережила dump → load');
  // перезагрузка собранной страницы в том же браузере — сразу тёмная, до любого клика
  const page = bootPage(build(), { storage: app.storage });
  assert.equal(page.document.documentElement.dataset.theme, 'dark', 'после перезагрузки тема не та');
  // «как в системе»: устройство тёмное — dark, светлое — light
  for (const [dark, want] of [[true, 'dark'], [false, 'light']]) {
    const a = load({ dark });
    a.A.theme({ dataset: { theme: 'auto' } });
    assert.equal(a.S.prefs.theme, 'auto');
    assert.equal(a.document.documentElement.dataset.theme, want, `устройство ${dark ? 'тёмное' : 'светлое'}`);
  }
});

test('меню: раздела без права у текущего человека нет; «Настройки» — внизу и у всех', () => {
  const app = load();
  app.render();
  assert.ok(app.byId('side').innerHTML.includes('data-view="team"'), 'директор не видит «Сотрудники и права»');
  app.setMe('p5'); // Игорь К., кладовщик: права «stock» и «receive»
  const side = app.byId('side').innerHTML;
  for (const id of ['team', 'clients', 'messages']) assert.ok(!side.includes(`data-view="${id}"`), `кладовщику в меню виден раздел ${id}`);
  for (const id of ['home', 'stock', 'receiving', 'settings']) assert.ok(side.includes(`data-view="${id}"`), `кладовщику в меню не виден раздел ${id}`);
  const views = [...side.matchAll(/data-view="(\w+)"/g)].map(m => m[1]);
  assert.equal(views.at(-1), 'settings', '«Настройки» — не последняя в меню');
  assert.ok(side.includes('<h4>Настройки</h4>'), 'нет группы «Настройки»');
});

test('прямой переход в раздел без права (S.view, адрес): «Нет доступа к разделу» и «На главный экран»', () => {
  const app = load();
  app.setMe('p5');
  app.S.view = 'team';
  app.render();
  let v = app.byId('view').innerHTML;
  assert.ok(v.includes('Нет доступа к разделу'), 'нет экрана «Нет доступа»');
  assert.match(v, /data-act="go" data-view="home">.*На главный экран<\/button>/);
  assert.ok(!v.includes('data-on="perm"'), 'под «Нет доступа» видны права ролей');
  app.A.go({ dataset: { view: 'home' } });
  assert.equal(app.S.view, 'home');
  assert.ok(!app.byId('view').innerHTML.includes('Нет доступа'));
  // через адрес: тот же браузер (кладовщик сохранён), страница открыта с #team
  const again = load({ storage: app.storage, hash: '#team' });
  assert.equal(again.S.me, 'p5');
  again.render();
  v = again.byId('view').innerHTML;
  assert.ok(v.includes('Нет доступа к разделу') && v.includes('На главный экран'), 'адрес #team открыл раздел без права');
  // у директора тот же адрес открывает раздел
  const boss = load({ hash: '#team' });
  boss.render();
  assert.ok(!boss.byId('view').innerHTML.includes('Нет доступа'), 'директору закрыт раздел «Сотрудники и права»');
});

test('настройки: вкладки из SETTINGS_TABS — «Внешний вид» у всех, «Данные» только с правом settings', () => {
  const app = load();
  const tabs = Object.fromEntries(Array.from(app.SETTINGS_TABS, t => [t.id, t]));
  assert.equal(tabs.look?.label, 'Внешний вид');
  assert.equal(tabs.data?.label, 'Данные');
  for (const t of app.SETTINGS_TABS) {
    assert.equal(typeof t.order, 'number', `${t.id}: нет order`);
    assert.equal(typeof t.ok, 'function', `${t.id}: нет ok`);
    assert.equal(typeof t.render, 'function', `${t.id}: нет render`);
  }
  app.render();
  // «Внешний вид» — тот же переключатель темы, что в шапке
  const look = tabs.look.render();
  for (const k of ['light', 'dark', 'auto']) assert.ok(look.includes(`data-act="theme" data-theme="${k}"`), `во «Внешнем виде» нет темы ${k}`);
  // директор: обе вкладки, во «Данных» — сброс и где хранятся данные
  app.go('settings');
  let v = app.byId('view').innerHTML;
  assert.ok(v.includes('>Внешний вид</button>') && v.includes('>Данные</button>'), 'директор не видит обе вкладки');
  app.A['set-tab']({ dataset: { tab: 'data' } });
  v = app.byId('view').innerHTML;
  assert.ok(v.includes('в этом браузере, на этом компьютере'), 'не сказано, где хранятся данные');
  assert.match(v, /data-act="reset">Сбросить данные прототипа<\/button>/);
  // кладовщик без права settings: вкладки «Данные» нет — ни в списке, ни открытой
  app.setMe('p5');
  assert.equal(app.Perms.can(app.S, 'p5', 'settings'), false);
  assert.equal(app.S.view, 'settings', '«Настройки» закрыты кладовщику');
  v = app.byId('view').innerHTML;
  assert.ok(v.includes('>Внешний вид</button>'), 'кладовщик не видит «Внешний вид»');
  assert.ok(!v.includes('>Данные</button>'), 'кладовщик видит вкладку «Данные»');
  assert.ok(!v.includes('Сбросить данные прототипа'), 'кладовщику открыта вкладка «Данные»');
});

test('сброс данных: сначала подтверждение, после него — всё как в исходном; тема и «Кто я» остаются', () => {
  const app = load();
  app.render();
  const KEY = app.Store.KEY;
  const first = app.S.products[0].name, tasks = app.S.tasks.length;
  app.S.products[0].name = 'Испорчено';
  app.S.tasks.pop();
  app.setMe('p6');
  app.A.theme({ dataset: { theme: 'dark' } });
  app.A.reset({ dataset: {} });
  assert.match(app.byId('modal-root').innerHTML, /data-form="reset"/, 'нет окна подтверждения');
  assert.equal(app.S.tasks.length, tasks - 1, 'сброс прошёл без подтверждения');
  app.FORMS.reset();
  assert.equal(app.byId('modal-root').innerHTML, '', 'окно подтверждения не закрылось');
  assert.equal(app.S.products[0].name, first);
  assert.equal(app.S.tasks.length, tasks);
  assert.equal(JSON.stringify(app.S.products), JSON.stringify(app.seed().products), 'товары не вернулись к исходным');
  assert.equal(app.S.me, 'p6');
  assert.equal(app.S.prefs.theme, 'dark');
  assert.equal(app.Store.load(app.storage[KEY]).tasks.length, tasks, 'сброс не записан в браузер');
});

// ——— Реестры (interfaces.md, «Реестры»): раздел подключается в своём файле, оболочку не правят ———

test('реестры ON, DRAWERS, SIMS: поля data-on и карточки справа идут через них, v2 перенесён на них', () => {
  const app = load();
  app.render();
  assert.deepEqual(Object.keys(app.ON).sort(), ['change', 'input']);
  assert.ok(Array.isArray(app.SIMS), 'SIMS — не список');
  for (const s of app.SIMS) assert.ok(s.id && s.label && typeof s.run === 'function', 'SIMS: запись не {id, label, run}');
  const fire = (type, target) => app.document.dispatchEvent({ type, target });
  // новый раздел регистрирует свой обработчик — оболочка зовёт его на input и change
  const got = [];
  app.ON.input.probe = el => got.push('input:' + el.value);
  app.ON.change.probe = el => got.push('change:' + el.value);
  fire('input', { dataset: { on: 'probe' }, value: 'а' });
  fire('change', { dataset: { on: 'probe' }, value: 'б' });
  fire('input', { dataset: { on: 'нет-такого' }, value: 'в' });
  assert.deepEqual(got, ['input:а', 'change:б']);
  // поля v2 работают через реестр: адрес склада (input) и правило авто-сообщений (change)
  fire('input', { dataset: { on: 'addr' }, value: 'Проверочная, 1' });
  assert.equal(app.S.address, 'Проверочная, 1');
  const rule = app.S.rules[0], was = rule.on;
  fire('change', { dataset: { on: 'rule', id: rule.id }, checked: !was });
  assert.equal(rule.on, !was, 'правило не переключилось');
  // карточка справа — из DRAWERS: новый тип показывается, null — карточки нет
  const root = app.byId('drawer-root');
  app.DRAWERS.probe = id => (id === 'x1' ? { kind: 'Проба', title: 'Карточка ' + id, sub: '', body: '<p>тело пробы</p>' } : null);
  app.openDrawer('probe', 'x1');
  assert.ok(root.innerHTML.includes('Карточка x1') && root.innerHTML.includes('тело пробы'), 'карточка нового типа не показана');
  app.openDrawer('probe', 'нет');
  assert.equal(root.innerHTML, '');
  assert.equal(app.S.ui.drawer, null);
  // карточки v2 — тоже записи DRAWERS, с правами внутри: сделка открыта директору, закрыта кладовщику
  for (const k of ['product', 'deal', 'task']) assert.equal(typeof app.DRAWERS[k], 'function', `нет DRAWERS.${k}`);
  const d = app.S.deals[0];
  app.openDrawer('deal', d.id);
  assert.ok(root.innerHTML.includes(app.esc(d.client)), 'директору не открылась карточка сделки');
  app.setMe('p5'); // кладовщик: права «Клиенты и сделки» нет
  app.openDrawer('deal', d.id);
  assert.equal(root.innerHTML, '', 'кладовщику открылась карточка сделки');
});

// Фото, которые не влезли в браузер (Store.dump с малым лимитом), после перезагрузки — не значки,
// а «не сохранено — мало места в браузере» (interfaces.md: Store помечает запись unsaved).
const NO_SPACE = 'не сохранено — мало места в браузере';
const PHOTO = 'data:image/jpeg;base64,' + 'A'.repeat(2000);
// Перезагрузка после сохранения, где места не хватило ровно на фото
function reloadTight(app) {
  const full = app.Store.dump(app.S).text.length;
  const r = app.Store.dump(app.S, full - 1);
  assert.ok(r.droppedPhotos >= 2, 'малый лимит не выкинул фото');
  return load({ storage: { [app.Store.KEY]: r.text } });
}
const arrivedShip = app => {
  const s = app.S.shipments.find(x => x.dir === 'in' && app.Pipes.stage(app.S, x.pipeId, x.stageId)?.flag === 'arrived');
  assert.ok(s, 'в демо нет поставки, ждущей приёмки');
  return s;
};

test('мало места: после перезагрузки карточка принятой поставки говорит «не сохранено — мало места в браузере»', () => {
  const app = load();
  const s = arrivedShip(app);
  app.setMe('p5');
  app.A['rcv-start']({ dataset: { id: s.id } });
  app.S.rcv.photos.push(PHOTO, PHOTO);
  app.A['rcv-confirm']();
  const card = a => { a.S.ui.logTab = 'done'; return a.VIEWS.logistics().split('<article').find(c => c.includes(`>${s.id}</b>`)) || ''; };
  assert.ok(card(app).includes('<img'), 'до перезагрузки фото не видны');
  assert.ok(!card(app).includes(NO_SPACE), 'фото в памяти, а карточка говорит «не сохранено»');
  const again = reloadTight(app);
  const c = card(again);
  assert.ok(c, `после перезагрузки нет карточки ${s.id}`);
  assert.ok(c.includes(`2 фото: ${NO_SPACE}`), 'карточка не говорит, что фото не сохранены');
});

test('мало места: после перезагрузки черновик приёмки говорит «не сохранено — мало места в браузере»', () => {
  const app = load();
  const s = arrivedShip(app);
  app.setMe('p5');
  app.A['rcv-start']({ dataset: { id: s.id } });
  app.S.rcv.photos.push(PHOTO, PHOTO);
  assert.ok(!app.VIEWS.receiving().includes(NO_SPACE), 'фото в памяти, а черновик говорит «не сохранено»');
  const again = reloadTight(app);
  assert.equal(again.S.rcv.shipId, s.id, 'черновик приёмки не пережил перезагрузку');
  assert.ok(again.VIEWS.receiving().includes(`2 фото: ${NO_SPACE}`), 'черновик не говорит, что фото не сохранены');
});
