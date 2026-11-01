'use strict';
// Ядро общей базы (таск 01 серверной сборки): режим страницы SERVER, документы Docs (split, join, diff, merge),
// поставщик номеров Ids, чистая база seedBase(). Ожидаемые значения — из interfaces.md и notes.md (список 29 общих ключей,
// 242 позиции каталога, 9 ролей), из разобранных руками примеров слияния и из самого seed(), а не из кода под тестом.

const test = require('node:test');
const assert = require('node:assert/strict');
const { build } = require('../tools/build.js');
const { load } = require('./load.js');

const NOW = new Date(2026, 10, 1, 12, 0);
// JSON с ключами по алфавиту: состояния из node:vm сравниваем текстом, порядок полей объекта не важен
const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x));
const plain = x => JSON.parse(JSON.stringify(x));

// notes.md, раздел 2: 29 общих ключей данных фирмы
const SHARED = ['products', 'stock', 'aside', 'moves', 'reserves', 'shipments', 'shipRules', 'deals', 'leads', 'clients', 'feed', 'acts',
  'tasks', 'msgs', 'notes', 'dispatches', 'mail', 'pipelines', 'depts', 'entities', 'cities', 'roles', 'people', 'rules', 'lostReasons',
  'leadSource', 'leadWaitMin', 'tpl', 'address'];
const LOCAL = ['me', 'view', 'ui', 'rcv', 'v'];
const sharedOf = st => Object.fromEntries(Object.keys(st).filter(k => !LOCAL.includes(k)).map(k => [k, st[k]]));
const withoutLocalPrefs = st => { const o = sharedOf(st); o.prefs = { ...o.prefs }; delete o.prefs.theme; delete o.prefs.ship; return o; };

let APP = null;
const app = () => APP || (APP = load({ now: NOW }));

// ——— режим страницы ———
test('SERVER: load() — демо (false), load({globals:{CRM_SERVER:1}}) — серверный режим (true)', () => {
  assert.equal(load().SERVER, false);
  assert.equal(load({ globals: { CRM_SERVER: 1 } }).SERVER, true);
  assert.equal(load({ globals: { CRM_SERVER: 0 } }).SERVER, false);
});

test('page.html: метка <!--CRM-SERVER--> ровно одна, стоит перед основным скриптом; страница без неё ведёт себя как демо', () => {
  const html = build();
  assert.equal(html.split('<!--CRM-SERVER-->').length - 1, 1, 'метка должна быть ровно одна');
  const at = html.indexOf('<!--CRM-SERVER-->'), script = html.indexOf("<script>\n(()=>{\n'use strict';");
  assert.ok(at > 0 && script > at, 'метка не перед основным скриптом');
  assert.equal(html.slice(at, script).replace('<!--CRM-SERVER-->', '').trim(), '', 'между меткой и скриптом что-то есть');
});

// ——— классификация ключей ———
test('Docs.KEYS: каждый ключ seed() классифицирован ровно один раз; 29 общих ключей — ARRAY, MAP или WHOLE; личное — LOCAL', () => {
  const { Docs, seed } = app();
  const all = ['ARRAY', 'MAP', 'WHOLE', 'LOCAL'].flatMap(c => Array.from(Docs.KEYS[c]));
  assert.equal(new Set(all).size, all.length, 'ключ в двух классах сразу');
  for (const k of Object.keys(seed())) assert.ok(all.includes(k), `ключ seed() «${k}» не классифицирован`);
  for (const k of SHARED) assert.ok(['ARRAY', 'MAP', 'WHOLE'].includes(Docs.kind(k)), `общий ключ ${k}: ${Docs.kind(k)}`);
  for (const k of LOCAL) assert.equal(Docs.kind(k), 'LOCAL', k);
  assert.deepEqual(Array.from(Docs.KEYS.MAP).sort(), ['aside', 'stock']);
  assert.equal(Docs.kind('prefs'), 'WHOLE');
  assert.deepEqual(Array.from(Docs.KEYS.LOCAL_PREFS).sort(), ['ship', 'theme']);
  assert.equal(Docs.kind('нет-такого'), null);
});

// ——— split / join ———
test('Docs.split(seed()) → Docs.join: то же общее состояние без личного; товары снимка каталога в документы не идут', () => {
  const { Docs, seed } = app();
  const st = seed();
  const docs = Docs.split(st);
  const keys = Object.keys(docs);
  assert.ok(keys.every(k => k.includes('\u0001')), 'ключ документа без разделителя');
  for (const k of LOCAL) assert.ok(!keys.some(x => x.startsWith(k + '\u0001')), `личный ключ ${k} ушёл в документы`);
  assert.ok(!keys.some(k => k.startsWith('products\u0001')), 'нетронутые товары снимка попали в документы');
  assert.equal(keys.filter(k => k.startsWith('deals\u0001')).length, st.deals.length);
  assert.equal(keys.filter(k => k.startsWith('stock\u0001')).length, Object.keys(st.stock).length);
  assert.ok('tpl\u0001' in docs && 'prefs\u0001' in docs, 'целые ключи — документ с пустым id');
  assert.equal(docs['prefs\u0001'].theme, undefined, 'тема — личное, на сервер не идёт');
  // документы — чистый JSON: даты как {$date}
  assert.equal(canon(JSON.parse(JSON.stringify(docs))), canon(docs));
  const back = Docs.join(docs);
  assert.equal(canon(back), canon(withoutLocalPrefs(st)));
  assert.ok(Object.prototype.toString.call(back.deals[0].at) === '[object Date]', 'дата не вернулась датой');
});

test('Docs.split/join: свой товар и правленый товар снимка — документами, остальной снимок восстанавливается', () => {
  const { Docs, seed } = app();
  const st = seed();
  st.products.push({ id: 'u1', name: 'Свой товар (пример)', brand: null, cat: 'Кабель', unit: 'м', price: 10, avail: null, url: null, src: 'user', inCatalog: false });
  const edited = st.products.find(p => p.src === 'catalog');
  edited.price = 12345;
  const docs = Docs.split(st);
  assert.deepEqual(Object.keys(docs).filter(k => k.startsWith('products\u0001')).sort(), ['products\u0001' + edited.id, 'products\u0001u1'].sort());
  const back = Docs.join(docs);
  assert.equal(back.products.length, st.products.length);
  assert.equal(back.products.find(p => p.id === edited.id).price, 12345);
  assert.equal(canon(back.products), canon(st.products));
});

test('Docs.join(docs, into): общее заменяется, личное into (я, раздел, тема) остаётся', () => {
  const { Docs, seed } = app();
  const st = seed();
  const docs = Docs.split(st);
  const into = { me: 'p3', view: 'deals', ui: { x: 1 }, prefs: { theme: 'dark', ship: { size: 20 }, notify: { old: {} } }, deals: [] };
  const out = Docs.join(docs, into);
  assert.equal(out, into, 'join(docs, into) должен вернуть into');
  assert.equal(out.me, 'p3');
  assert.equal(out.view, 'deals');
  assert.equal(out.prefs.theme, 'dark');
  assert.deepEqual(plain(out.prefs.ship), { size: 20 });
  assert.equal(out.prefs.notify.old, undefined, 'общие настройки не заменились');
  assert.equal(out.deals.length, st.deals.length);
});

test('Docs.join: уведомления и журнал склада — новые сверху, в каком бы порядке ни пришли документы', () => {
  const { Docs, seed } = app();
  const st = seed();
  const docs = Docs.split(st);
  const shuffled = Object.fromEntries(Object.entries(docs).reverse());
  const back = Docs.join(shuffled);
  assert.deepEqual(back.notes.map(n => n.id), st.notes.map(n => n.id));
  assert.deepEqual(back.moves.map(m => m.id), st.moves.map(m => m.id));
});

test('журнал склада: у каждого движения есть свой id — запись журнала становится документом', () => {
  const { Docs, Stock, seed } = app();
  const st = seed();
  assert.ok(st.moves.length > 0);
  assert.equal(new Set(st.moves.map(m => m.id)).size, st.moves.length, 'id движений не уникальны');
  assert.ok(st.moves.every(m => typeof m.id === 'string' && m.id), 'движение без id');
  const pid = Object.keys(st.stock)[0];
  const r = Stock.move(st, { kind: Stock.KINDS.receive, productId: pid, qty: 3, entityId: 'ip', cityId: 'irk', doc: 'П-1', by: 'p5', at: NOW });
  assert.equal(r.ok, true);
  assert.ok(r.move.id && !st.moves.slice(1).some(m => m.id === r.move.id), 'новое движение без своего id');
  assert.equal(Object.keys(Docs.split(st)).filter(k => k.startsWith('moves\u0001')).length, st.moves.length);
});

// ——— diff ———
test('Docs.diff: находит новые, изменённые и удалённые документы и ничего лишнего', () => {
  const { Docs, seed } = app();
  const st = seed();
  const before = Docs.split(st);
  st.deals[0].object = 'Новое описание (пример)';
  st.tasks.push({ id: 't99', title: 'Новая задача (пример)', to: { t: 'p', id: 'p2' }, from: 'p1', due: NOW, boardId: 'tasksCommon', stageId: 'new', prio: 'normal', deal: '', at: NOW });
  const gone = st.reserves.splice(0, 1)[0];
  const pid = Object.keys(st.stock)[0];
  const cellE = Object.keys(st.stock[pid])[0];
  st.stock[pid][cellE]._ = 777;
  st.leadWaitMin = 30;
  const changes = Docs.diff(before, Docs.split(st));
  const by = Object.fromEntries(changes.map(c => [c.key + ':' + c.id, c]));
  assert.equal(changes.length, 5, changes.map(c => c.key + ':' + c.id).join(', '));
  const d = by['deals:' + st.deals[0].id];
  assert.equal(d.data.object, 'Новое описание (пример)');
  assert.notEqual(d.base.object, 'Новое описание (пример)');
  assert.equal(by['tasks:t99'].base, null, 'у новой записи base = null');
  assert.equal(by['tasks:t99'].data.title, 'Новая задача (пример)');
  assert.equal(by['reserves:' + gone.id].deleted, true);
  assert.equal(by['reserves:' + gone.id].base.id, gone.id);
  assert.equal(by['stock:' + pid].data[cellE]._, 777);
  assert.equal(by['leadWaitMin:'].data, 30);
  assert.deepEqual(plain(Docs.diff(before, before)), []);
});

// ——— merge ———
test('Docs.merge: разные поля одной записи — обе правки; одно поле по-разному — конфликт с путём', () => {
  const { Docs } = app();
  const base = { id: 'Д-1', stageId: 'calc', object: 'СЭС', managerId: 'p2' };
  const r = Docs.merge(base, { ...base, stageId: 'offer' }, { ...base, object: 'СЭС 15 кВт' });
  assert.equal(r.ok, true);
  assert.deepEqual(plain(r.value), { id: 'Д-1', stageId: 'offer', object: 'СЭС 15 кВт', managerId: 'p2' });
  const c = Docs.merge(base, { ...base, stageId: 'offer' }, { ...base, stageId: 'contract' });
  assert.equal(c.ok, false);
  assert.equal(c.path, 'stageId');
  // одна и та же правка с обеих сторон — не конфликт
  assert.deepEqual(plain(Docs.merge(base, { ...base, stageId: 'offer' }, { ...base, stageId: 'offer' }).value), { ...base, stageId: 'offer' });
  // вложенное поле
  const n = Docs.merge({ to: { name: 'А', phone: '1' } }, { to: { name: 'Б', phone: '1' } }, { to: { name: 'А', phone: '2' } });
  assert.deepEqual(plain(n.value), { to: { name: 'Б', phone: '2' } });
  assert.equal(Docs.merge({ to: { name: 'А' } }, { to: { name: 'Б' } }, { to: { name: 'В' } }).path, 'to.name');
});

test('Docs.merge: массив записей с id — добавления с обеих сторон сохраняются, правки разных записей сливаются', () => {
  const { Docs } = app();
  const base = { files: [{ id: 'fl1', name: 'а.txt' }, { id: 'fl2', name: 'б.txt' }] };
  const mine = { files: [{ id: 'fl1', name: 'а-новое.txt' }, { id: 'fl2', name: 'б.txt' }, { id: 'fl3', name: 'мой.txt' }] };
  const theirs = { files: [{ id: 'fl1', name: 'а.txt' }, { id: 'fl4', name: 'их.txt' }] };
  const r = Docs.merge(base, mine, theirs);
  assert.equal(r.ok, true);
  const got = plain(r.value.files);
  assert.deepEqual(got.map(f => f.id).sort(), ['fl1', 'fl3', 'fl4'], 'fl2 удалили они, fl3 и fl4 добавили обе стороны');
  assert.equal(got.find(f => f.id === 'fl1').name, 'а-новое.txt');
  // удалили у себя то, что они правили, — конфликт
  const c = Docs.merge(base, { files: [base.files[1]] }, { files: [{ id: 'fl1', name: 'их.txt' }, base.files[1]] });
  assert.equal(c.ok, false);
  assert.match(c.path, /^files/);
});

test('Docs.merge: история без id, дописанная с обеих сторон, — обе записи; удаление против правки — конфликт', () => {
  const { Docs } = app();
  const h0 = { at: 1, text: 'создана' };
  const r = Docs.merge({ history: [h0] }, { history: [h0, { at: 2, text: 'моё' }] }, { history: [h0, { at: 3, text: 'их' }] });
  assert.equal(r.ok, true);
  assert.deepEqual(plain(r.value.history).map(h => h.text), ['создана', 'моё', 'их']);
  // прочитанность уведомления: каждый дописал себя
  assert.deepEqual(plain(Docs.merge({ read: ['p1'] }, { read: ['p1', 'p2'] }, { read: ['p1', 'p3'] }).value.read), ['p1', 'p2', 'p3']);
  // запись удалили у себя, а они её правили
  const del = Docs.merge({ id: 'r1', qty: 2 }, null, { id: 'r1', qty: 5 });
  assert.equal(del.ok, false);
  // удалили, а они не трогали — удаление
  assert.deepEqual(plain(Docs.merge({ id: 'r1', qty: 2 }, null, { id: 'r1', qty: 2 })), { ok: true, value: null });
});

// ——— номера ———
test('Ids.use(fn): Store.freeId, Leads.nextId, Dispatch.nextNumber и номер поставки П- берут номер у поставщика; Ids.use(null) — как раньше', () => {
  const a = load({ now: NOW });
  const { Ids, Store, Leads, Dispatch, Ships, seed } = a;
  const st = seed();
  const asked = [];
  Ids.use(prefix => { asked.push(prefix); return prefix + '900'; });
  try {
    assert.equal(Store.freeId(st.tasks, 't'), 't900');
    assert.equal(Leads.nextId(st.deals, 'Д', 300), 'Д-900');
    assert.equal(Leads.nextId(st.leads, 'Л', 100), 'Л-900');
    assert.equal(Dispatch.nextNumber(st), 'ОТ-900');
    assert.equal(Ships.nextNumber(st), 'П-900');
    const lead = Leads.create(st, { source: 'phone', name: 'Клиент-пример', phone: '+7 900 000-00-99' }, NOW, { silent: true });
    assert.equal(lead.id, 'Л-900');
    assert.ok(['t', 'Д-', 'Л-', 'ОТ-', 'П-'].every(p => asked.includes(p)), asked.join(','));
  } finally { Ids.use(null); }
  // без поставщика — прежние правила: после самого большого номера
  assert.equal(Store.freeId([{ id: 't1' }, { id: 't2' }], 't'), 't3');
  assert.equal(Leads.nextId([{ id: 'Д-305' }, { id: 'Д-322' }], 'Д', 300), 'Д-323');
  assert.equal(Dispatch.nextNumber({ dispatches: [{ number: 'ОТ-007' }, { number: 'ОТ-020' }] }), 'ОТ-021');
  assert.equal(Ships.nextNumber({ shipments: [{ id: 'П-1038', dir: 'in' }, { id: 'П-1250', dir: 'in' }, { id: 'О-207', dir: 'out' }] }), 'П-1251');
  assert.equal(Ships.nextNumber({ shipments: [] }), 'П-1');
});

// ——— чистая база ———
test('seedBase(): 9 ролей с доборами РОП и водителя, воронки, отделы, юрлица, города, причины, настройки, каталог — и ни одной записи демо', () => {
  const { seedBase, Docs } = app();
  const st = seedBase();
  for (const k of Object.keys(st)) assert.ok(Docs.kind(k), `ключ ${k} не классифицирован`);
  for (const k of SHARED) assert.ok(k in st, `в чистой базе нет ключа ${k}`);
  assert.deepEqual(plain(st.roles.map(r => r.id)), ['director', 'managerB2b', 'managerB2c', 'logist', 'warehouse', 'chiefEngineer', 'engineer', 'rop', 'driver']);
  const role = id => st.roles.find(r => r.id === id);
  assert.equal(role('rop').perms.dealsEdit, true, 'РОП заводит сделки');
  assert.equal(role('rop').perms.sell, true, 'РОП списывает при продаже');
  assert.equal(role('rop').perms.leadsAssign, true);
  assert.deepEqual(plain(Object.keys(role('driver').perms).filter(k => role('driver').perms[k])), ['dispatch']);
  assert.ok(st.pipelines.some(p => p.id === 'dispatch') && st.pipelines.some(p => p.id === 'shipsOut'), 'нет воронок отправок и отгрузок');
  assert.ok(['deals', 'leads', 'tasks', 'ships'].every(k => st.pipelines.some(p => p.kind === k)), 'нет воронок по умолчанию');
  assert.equal(st.depts.length, 5);
  assert.deepEqual(plain(st.entities.map(e => e.id)), ['ip', 'npp', 'vs']);
  assert.deepEqual(plain(st.cities.map(c => c.id)), ['irk', 'msk', 'krd']);
  assert.equal(st.lostReasons.length, 5);
  assert.equal(st.leadSource, 'both');
  assert.equal(st.leadWaitMin, 15);
  assert.equal(st.shipRules.length, 3);
  // каталог: 242 позиции каталога сайта (notes.md, раздел 8), снимка остатков 31.10 нет
  assert.equal(st.products.length, 242);
  assert.ok(st.products.every(p => p.inCatalog && p.src === 'catalog'), 'в чистой базе товары листа остатков');
  assert.deepEqual(plain(st.stock), {});
  assert.deepEqual(plain(st.aside), {});
  for (const k of ['people', 'deals', 'leads', 'clients', 'tasks', 'shipments', 'dispatches', 'notes', 'feed', 'acts', 'reserves', 'moves', 'msgs']) {
    assert.equal(st[k].length, 0, `в чистой базе есть ${k}`);
  }
  assert.equal(st.mail.letters.length + st.mail.boxes.length + st.mail.suppliers.length, 0);
  // ни одной пометки demo и ни одного «пример» в данных
  const text = JSON.stringify(st);
  assert.ok(!/"demo":true/.test(text), 'запись demo в чистой базе');
  assert.ok(!/пример/i.test(text), 'слово «пример» в чистой базе');
});

test('seed() = seedBase() + демо: структура та же, демо-записи на месте', () => {
  const { seedBase, seed } = app();
  const base = seedBase(), st = seed();
  for (const k of ['roles', 'pipelines', 'depts', 'entities', 'cities', 'lostReasons', 'shipRules']) {
    assert.equal(canon(st[k]), canon(base[k]), `${k}: структура демо отличается от чистой базы`);
  }
  assert.ok(st.people.length >= 14 && st.deals.length > 0 && st.leads.length > 0 && st.shipments.length > 0);
  assert.ok(base.products.every(p => st.products.some(q => q.id === p.id)), 'товары каталога пропали из демо');
});
