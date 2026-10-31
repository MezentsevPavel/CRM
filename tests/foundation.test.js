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

test('seed(): демо-записи v2 на месте — товары, поставки, задачи и остальное', () => {
  const app = load();
  const st = app.seed();
  // число демо-записей — notes.md, п. 3 «Записи» (люди — отдельный тест: команда v3 больше)
  const expected = { products: 12, shipments: 6, reserves: 15, deals: 6, tasks: 10, notes: 10, msgs: 4, moves: 8, rules: 5 };
  for (const [k, n] of Object.entries(expected)) assert.equal(st[k]?.length, n, `seed().${k}`);
  assert.ok(st.products.some(p => p.sku === 'INV-H6' && p.name === 'Гибридный инвертор 6 кВт'));
  assert.equal(app.S.products.length, 12, 'состояние S собрано из seed()');
  assert.equal(app.S.view, 'home');
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
// Ожидания — из seed v2 (notes.md, п. 3 и 7: остатки, резервы П-1044, каналы сделок) и spec.md (R01, R15, R16, R59i).

test('этапы: в разделах и модели нет обращения к этапу по номеру', () => {
  const dir = path.join(ROOT, 'src', 'js');
  const files = fs.readdirSync(dir).filter(f => /^(20|5\d)-.*\.js$/.test(f));
  assert.ok(files.length >= 9, 'мало файлов разделов');
  const bad = [
    /\bstages?\s*(===|!==|==|!=|>=|<=|>|<)\s*\d/,          // s.stage===3, d.stage>=6
    /\bstages?\[\s*\d+\s*\]/,                               // stages[0]
    /stagePos\([^)]*\)\s*(===|!==|==|!=|>=|<=|>|<)\s*\d/,    // stagePos(s)>=2
    /\.stage(?![\w(])/,                                      // старое поле «номер этапа»
    /\b(ST_IN|ST_OUT|DEAL_ST|TASK_ST)\b/,                    // массивы этапов v2
  ];
  for (const f of files) {
    fs.readFileSync(path.join(dir, f), 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*\/\//.test(line)) return;
      for (const re of bad) assert.ok(!re.test(line), `${f}:${i + 1}: ${line.trim().slice(0, 90)}`);
    });
  }
});

test('приёмка П-1044 кладовщиком: остаток вырос, резервы переведены, уведомления и сообщения клиентам', () => {
  const app = load();
  app.setMe('p5'); // Игорь К., кладовщик
  app.A['rcv-start']({ dataset: { id: 'П-1044' } });
  assert.equal(app.S.view, 'receiving');
  app.S.rcv.photos.push('data:image/jpeg;base64,AAAA');
  const notesBefore = app.S.notes.length, msgsBefore = app.S.msgs.length;
  app.A['rcv-confirm']();
  const stock = sku => app.S.products.find(p => p.sku === sku).stock;
  // остатки v2 + количества П-1044 (notes.md: CTRL-60 1, BOX-DC 3, CAB-6R 1140; в поставке 6, 10, 500)
  assert.equal(stock('CTRL-60'), 7);
  assert.equal(stock('BOX-DC'), 13);
  assert.equal(stock('CAB-6R'), 1640);
  for (const id of ['r10', 'r15']) assert.equal(app.S.reserves.find(r => r.id === id).src, 'stock', `${id} не переведён на склад`);
  const s = app.S.shipments.find(x => x.id === 'П-1044');
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
  // Д-311 и Д-318 ждали товар из П-1044; обе ведёт Анна С. (p2)
  const perDeal = fresh.filter(n => n.text.startsWith('Уведомите клиента'));
  assert.equal(perDeal.length, 2);
  for (const n of perDeal) {
    assert.ok(n.to.includes('p2'), 'менеджер сделки не получил «уведомите клиента»');
    assert.ok(!n.to.some(id => id !== 'p2' && managers.includes(id)), '«уведомите клиента» ушло чужому менеджеру');
  }
  // сообщения клиентам (R16): по шаблону, в канал сделки, имитация
  const msgs = app.S.msgs.slice(msgsBefore);
  assert.deepEqual([...msgs.map(m => m.deal)].sort(), ['Д-311', 'Д-318']);
  assert.ok(msgs.every(m => m.auto && m.text.includes('пришёл на склад')));
  assert.equal(msgs.find(m => m.deal === 'Д-318').channel, 'max');
  assert.equal(msgs.find(m => m.deal === 'Д-311').channel, 'telegram');
});

test('сохранение: созданная задача переживает перезагрузку, даты — Date; сброс возвращает демо', () => {
  const app = load();
  const KEY = app.Store.KEY;
  assert.equal(app.storage[KEY], undefined);
  const set = (id, v) => { app.byId(id).value = v; };
  set('t-title', 'Проверить сохранение'); set('t-to', 'p:p6'); set('t-due', '2026-11-05'); set('t-prio', 'high');
  app.FORMS.task();
  assert.ok(app.storage[KEY], 'после действия состояние не записано в браузер');
  const again = load({ storage: app.storage }); // перезагрузка страницы
  const t = again.S.tasks.find(x => x.title === 'Проверить сохранение');
  assert.ok(t, 'задача пропала после перезагрузки');
  assert.ok(isDate(t.due) && isDate(t.at), 'даты задачи после загрузки — не Date');
  assert.equal(t.due.getDate(), 5);
  assert.equal(again.S.tasks.length, 11);
  again.resetData();
  assert.equal(again.S.tasks.length, 10);
  assert.ok(!again.S.tasks.some(x => x.title === 'Проверить сохранение'));
  assert.equal(load({ storage: again.storage }).S.tasks.length, 10, 'сброс не записан в браузер');
  assert.equal(load({ storage: { [KEY]: '{битое' } }).S.tasks.length, 10, 'битое сохранение — не демо');
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
