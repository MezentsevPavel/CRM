'use strict';
// Ремонт после ревью ветки (таск F1): десять находок — товар, резервы, права, сохранение. Каждая находка
// воспроизведена здесь тем же путём, каким её нашёл ревьюер, и закрыта условием из таска. Ожидаемые числа
// считаются руками (лежит 10, под резервом 3 — свободно 7), а не вызовом кода под тестом.

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.js');

const plain = x => JSON.parse(JSON.stringify(x));
const NOW = new Date(2026, 10, 1, 12, 0);
const later = n => new Date(NOW.getTime() + n * 60000);

const DISPATCH_PIPE = () => ({ id: 'dispatch', kind: 'dispatch', name: 'Отправки', stages: [
  { id: 'new', name: 'Новая' }, { id: 'picking', name: 'Собирается' }, { id: 'ready', name: 'Готова к отправке' },
  { id: 'onWay', name: 'В пути' }, { id: 'delivered', name: 'Доставлена', flag: 'final' }, { id: 'cancelled', name: 'Отменена', flag: 'final' },
] });

// Маленькое состояние: директор, менеджеры B2B и B2C, логист, кладовщик, инженер. Товар pv — в клетке «ИП, Иркутск» 10.
function world(app, over = {}) {
  const base = app.Stock.defaults();
  const roles = app.Perms.defaultRoles();
  const people = [['dir', 'director'], ['mgr', 'managerB2b'], ['mgrC', 'managerB2c'], ['log', 'logist'], ['wh', 'warehouse'], ['eng', 'engineer']]
    .map(([id, role]) => ({ id, name: 'Сотрудник ' + id, role, demo: true }));
  return Object.assign({
    v: 3, entities: base.entities, cities: base.cities, roles, people,
    pipelines: [...app.Pipes.defaults(), DISPATCH_PIPE()],
    products: [{ id: 'pv', name: 'Панель тестовая' }, { id: 'inv', name: 'Инвертор тестовый' }],
    stock: { pv: { ip: { irk: 10 } }, inv: { ip: { irk: 3 } } },
    aside: {}, reserves: [], moves: [], shipments: [], dispatches: [], feed: [], notes: [], deals: [], clients: [], msgs: [], shipRules: [],
    prefs: { notify: {} },
  }, over);
}
const IRK = { entityId: 'ip', cityId: 'irk' }, MSK = { entityId: 'ip', cityId: 'msk' };
const transfer = (over = {}) => ({
  purpose: 'transfer', to: { name: 'Склад: ИП, Москва', phone: '+7 900 000-00-01' }, address: '', from: IRK, toCell: MSK,
  when: { date: '2026-11-05' }, items: [{ productId: 'pv', qty: 4 }], ...over,
});
const cell = (app, st, pid, c) => app.Stock.grid(st, pid).cell(c.entityId, c.cityId);

// ——— 1. Перемещение и резерв ———
test('F1·1 перемещение: «В пути» берёт не больше «клетка − резервы на неё»; больше — отказ с числом, этап и склад не меняются', () => {
  const app = load(), { Dispatch, Stock } = app;
  const st = world(app, { reserves: [{ id: 'r1', productId: 'pv', qty: 3, entityId: 'ip', cityId: 'irk', src: 'stock', dealId: 'Д-1' }] });
  // лежит 10, под резервом 3 — перемещению свободно 7, а нужно 8
  const id = Dispatch.create(st, transfer({ items: [{ productId: 'pv', qty: 8 }] }), 'log', NOW).id;
  const r = Dispatch.setStage(st, id, 'onWay', 'log', later(1));
  assert.equal(r.ok, false, 'перемещение забрало зарезервированный товар');
  assert.match(r.reason, /нужно 8, свободно 7/);
  assert.match(r.reason, /под резервом 3/);
  assert.equal(Dispatch.byId(st, id).stageId, 'new', 'этап сменился несмотря на отказ');
  assert.equal(cell(app, st, 'pv', IRK), 10);
  assert.equal(Stock.sellMax(st, { productId: 'pv', reserveId: 'r1' }), 3);
  // ровно свободное — можно; резерв по-прежнему лежит в клетке целиком
  const ok = Dispatch.create(st, transfer({ items: [{ productId: 'pv', qty: 7 }] }), 'log', NOW).id;
  assert.equal(Dispatch.setStage(st, ok, 'onWay', 'log', later(2)).ok, true);
  assert.equal(cell(app, st, 'pv', IRK), 3);
  assert.equal(Stock.sellMax(st, { productId: 'pv', reserveId: 'r1' }), 3, 'резерв остался без товара в клетке');
});

// ——— 2. Приёмка и резерв ———
// Демо П-1044 (ждёт приёмки): позиция sheet-107 — 6 шт, под неё резерв r10 на 1 (Д-318); sheet-207 — 10 шт, резерв r15 на 1 (Д-311).
// Оба — сделки менеджера p2. Добавляем резерв на 4 шт sheet-107 для Д-311: всего ждут 5 из 6.
test('F1·2 приёмка: на склад переходит резерв не больше принятого; излишек — «Снят резерв» в журнале, в ленте сделки и менеджеру', () => {
  const app = load(), S = app.S;
  app.setMe('p5');
  const sh = S.shipments.find(s => s.id === 'П-1044');
  S.reserves.push({ id: 'rA', productId: 'sheet-107', dealId: 'Д-311', qty: 4, src: sh.id, until: new Date(2026, 10, 20), entityId: 'ip', cityId: 'irk', at: new Date(2026, 9, 30, 10), by: 'p2' });
  app.initRcv(sh.id);
  // sheet-107: принято 2 из 6 — r10 (поставлен раньше) получает 1, rA — оставшийся 1, снять 3; sheet-207: принято 0 — r15 снимается весь
  app.ON.input['rcv-qty']({ dataset: { pid: 'sheet-107' }, value: '2' });
  app.ON.input['rcv-qty']({ dataset: { pid: 'sheet-207' }, value: '0' });
  const before = app.Stock.summary(S, 'sheet-107').free;
  const notesBefore = S.notes.length;
  const r = app.receiveShip('p5', new Date(2026, 9, 31, 15));
  assert.equal(r.ok, true, r.reason);
  const r10 = S.reserves.find(x => x.id === 'r10'), rA = S.reserves.find(x => x.id === 'rA');
  assert.deepEqual(plain([r10.src, r10.qty]), ['stock', 1]);
  assert.deepEqual([rA && rA.src, rA && rA.qty], ['stock', 1], 'резерв со склада больше принятого');
  assert.equal(S.reserves.find(x => x.id === 'r15'), undefined, 'на пустую клетку перешёл резерв');
  // на складе по sheet-107 прибавилось 2 и резервов со склада 2: свободное не упало
  assert.equal(app.Stock.summary(S, 'sheet-107').free, before);
  // журнал: «Снят резерв» на 3 (Д-311, sheet-107) и на 1 (Д-311, sheet-207)
  const cut = S.moves.filter(m => m.kind === 'Снят резерв' && m.doc === 'Д-311');
  assert.deepEqual(plain(cut.map(m => [m.productId, m.qty]).sort()), [['sheet-107', 3], ['sheet-207', 1]]);
  // лента сделки: снятие с причиной, и прежняя запись о резерве r15 не пропала
  const feed = app.Feed.of(S, { t: 'deal', id: 'Д-311' });
  const gone = feed.filter(e => e.kind === 'reserve' && e.text.startsWith('Снят резерв') && e.text.includes('П-1044'));
  assert.equal(gone.length, 2, 'в ленте сделки нет «Снят резерв» после приёмки');
  assert.ok(feed.some(e => e.kind === 'reserve' && e.text.startsWith('Резерв:') && e.data && e.data.reserveId === 'r15'), 'запись о резерве r15 пропала из ленты');
  // уведомление — менеджеру сделки (p2)
  const told = S.notes.slice(0, S.notes.length - notesBefore).filter(n => n.kind === 'reserve' && n.text.includes('Снят резерв') && n.text.includes('Д-311'));
  assert.ok(told.length >= 1 && told.every(n => n.to.includes('p2')), 'менеджер сделки не узнал о снятом резерве');
});

// ——— 3. Этапы final и arrived: запись попадает туда только своим путём ———
const shipRec = (id, stageId) => ({ id, number: id, dir: 'in', pipeId: 'ships', stageId, items: [], history: [], route: [], pos: { i: 0, t: 0 } });
test('F1·3 Pipes.removeStage: записи и правила (кроме «принято на складе») не переезжают на этапы final и arrived', () => {
  const app = load(), { Pipes } = app;
  const st = world(app, {
    shipments: [shipRec('A', 'toStock'), shipRec('B', 'arrived')],
    deals: [{ id: 'Д-1', type: 'b2b', pipeId: 'dealsB2b', stageId: 'install', managerId: 'mgr', client: 'Клиент-пример' }],
  });
  const d1 = app.Dispatch.create(st, transfer(), 'log', NOW).id;
  app.Dispatch.setStage(st, d1, 'picking', 'log', later(1));
  app.Dispatch.setStage(st, d1, 'ready', 'log', later(2));
  // поставки: «В пути до склада» → «На складе» или «Прибыло в город» — отказ, поставка на месте
  for (const to of ['inStock', 'arrived']) {
    const r = Pipes.removeStage(st, 'ships', 'toStock', to);
    assert.equal(r.ok, false, `поставка переехала на «${to}» без приёмки`);
    assert.ok(r.reason.length > 10);
    assert.equal(st.shipments[0].stageId, 'toStock');
    assert.ok(Pipes.stage(st, 'ships', 'toStock'), 'этап удалён несмотря на отказ');
  }
  // сделка «Монтаж» → «Сдана» мимо Deals.win — отказ; отправка «Готова» → «Доставлена» мимо Dispatch.setStage — отказ
  assert.equal(Pipes.removeStage(st, 'dealsB2b', 'install', 'done').ok, false);
  assert.equal(st.deals[0].stageId, 'install');
  assert.equal(Pipes.removeStage(st, 'dispatch', 'ready', 'delivered').ok, false);
  assert.equal(app.Dispatch.byId(st, d1).stageId, 'ready');
  // правило «перевозчик: груз в Иркутске» с этапа удаляется только на обычный этап; «принято на складе» — можно и на «На складе»
  st.shipments = [];
  st.shipRules = [{ id: 'c', on: true, when: 'carrier:irk', then: 'toStock' }];
  assert.equal(Pipes.removeStage(st, 'ships', 'toStock', 'inStock').ok, false, 'правило перевозчика переехало на «На складе»');
  st.shipRules = [{ id: 'rc', on: true, when: 'received', then: 'toStock' }];
  assert.equal(Pipes.removeStage(st, 'ships', 'toStock', 'inStock').ok, true);
  assert.equal(st.shipRules[0].then, 'inStock');
  // обычный этап — как раньше
  assert.equal(Pipes.removeStage(st, 'dealsB2b', 'install', 'delivery').ok, true);
  assert.equal(st.deals[0].stageId, 'delivery');
});

test('F1·3 Pipes.removeStage: перенести некуда, кроме завершающих, — отказ с причиной; окно «куда перенести» их не предлагает', () => {
  const app = load(), { Pipes } = app;
  const st = world(app, { tasks: [{ id: 't1', title: 'Задача-пример', boardId: 'b', stageId: 'a' }] });
  st.pipelines.push({ id: 'b', kind: 'tasks', name: 'Доска-пример', stages: [{ id: 'a', name: 'Новые' }, { id: 'z', name: 'Готово', flag: 'final' }] });
  const r = Pipes.removeStage(st, 'b', 'a', 'z');
  assert.equal(r.ok, false);
  assert.match(r.reason, /некуда/);
  assert.equal(st.tasks[0].stageId, 'a');
  // окно в настройках: у поставок в «куда перенести» нет «Прибыло в город» и «На складе»
  const page = load();
  page.setMe('p1');
  const html = page.MODALS.pipeStageDel('ships|transship');
  const opts = [...html.matchAll(/<option value="([^"]+)"/g)].map(m => m[1]);
  assert.ok(opts.length > 0 && opts.includes('toStock'), 'в окне нет обычных этапов');
  assert.ok(!opts.includes('inStock') && !opts.includes('arrived'), `окно предлагает завершающие этапы: ${opts.join(', ')}`);
});

test('F1·3 Pipes.removePipe: запись с обычного этапа не попадает на завершающий, даже если имя совпало', () => {
  const app = load(), { Pipes } = app;
  const st = world(app, { deals: [{ id: 'Д-2', type: 'b2b', pipeId: 'x', stageId: 's1', managerId: 'mgr', client: 'Клиент-пример' }] });
  st.pipelines.push({ id: 'x', kind: 'deals', name: 'B2B-пример', scope: 'b2b', stages: [{ id: 's1', name: 'Сдана' }, { id: 'fin', name: 'Закрыта', flag: 'final' }] });
  const r = Pipes.removePipe(st, 'x', 'dealsB2b');
  assert.equal(r.ok, true, r.reason);
  assert.equal(st.deals[0].pipeId, 'dealsB2b');
  assert.equal(Pipes.isFinal(st, 'dealsB2b', st.deals[0].stageId), false, 'сделка стала «Сдана» без wonAt');
});

test('F1·3 Ships.applyRules: правило события перевозчика не ставит «На складе» и «Прибыло»; «принято на складе» — может', () => {
  const app = load(), { Ships } = app;
  const st = world(app, { shipments: [shipRec('A', 'toStock')] });
  st.shipRules = [{ id: 'c1', on: true, when: 'carrier:irk', then: 'inStock' }, { id: 'c2', on: true, when: 'carrier', then: 'arrived' }];
  assert.deepEqual(plain(Ships.applyRules(st, 'carrier:irk', 'A', 'log', NOW)), []);
  assert.equal(st.shipments[0].stageId, 'toStock', 'правило перевозчика закрыло поставку без приёмки');
  // в «Настройки → Поставки» у правила перевозчика такие этапы не предлагаются, у «принято на складе» — да
  const page = load();
  page.setMe('p1');
  const html = page.SETTINGS_TABS.find(t => t.id === 'ships').render();
  const optsOf = id => { const sel = html.split(`id="${id}"`)[1].split('</select>')[0]; return [...sel.matchAll(/<option value="([^"]*)"/g)].map(m => m[1]); };
  assert.ok(!optsOf('sr-then-sr2').includes('inStock') && !optsOf('sr-then-sr2').includes('arrived'), 'правилу «таможня пройдена» предложен завершающий этап');
  assert.ok(optsOf('sr-then-sr1').includes('inStock'), 'правилу «принято на складе» не предложено «На складе»');
  // новое правило по умолчанию не ставит «На складе»
  const add = html.split('id="sr-new-then"')[1].split('</select>')[0];
  assert.ok(!/value="inStock"[^>]*selected/.test(add) && !add.includes('value="arrived"'), 'новое правило по умолчанию ставит «На складе»');
});

// ——— 4. Видимость: сделку и её клиента называет только то, что отобрано через Leads.dealsVisible ———
// Демо: p2 — менеджер B2C, p3 — менеджер B2B. Товар sheet-004: резервы r1 (Д-311, B2C, Иванов Сергей), r2 (Д-314, B2B,
// КФХ Петровых), r3 (Д-320, B2B, ИП Кузнецов). Сообщения клиентам — по сделкам B2C Д-311, Д-318, Д-305.
test('F1·4 карточка товара у менеджера B2C: в форме резерва только его сделки; чужие резервы — без номера, клиента и кнопок', () => {
  const app = load();
  app.setMe('p2');
  const S = app.S, mine = new Set(S.deals.filter(d => d.type === 'b2c').map(d => d.id));
  const body = app.DRAWERS.product('sheet-004').body;
  const form = body.split('id="rs-deal"')[1].split('</select>')[0];
  const offered = [...form.matchAll(/<option value="([^"]+)"/g)].map(m => m[1]);
  assert.ok(offered.every(id => mine.has(id)), `в форме резерва чужие сделки: ${offered.filter(id => !mine.has(id)).join(', ')}`);
  for (const t of ['Д-314', 'Д-320', 'КФХ Петровых', 'ИП Кузнецов']) assert.ok(!body.includes(t), `карточка товара называет чужое: ${t}`);
  assert.ok(!body.includes('data-id="r2"') && !body.includes('data-rid="r2"'), 'кнопки «Снять»/«Списать» по чужому резерву');
  assert.ok(body.includes('Д-311'), 'свой резерв пропал');
  // под невидимую сделку резерв не ставится и из формы
  const el = id => app.document.getElementById(id);
  el('rs-deal').value = 'Д-314'; el('rs-qty').value = '1'; el('rs-src').value = 'stock'; el('rs-ent').value = 'ip'; el('rs-city').value = '_';
  el('rs-until').value = app.iso(app.day(5)); el('rs-err').hidden = true;
  const n = S.reserves.length;
  app.FORMS.reserve({ dataset: { pid: 'sheet-004' } });
  assert.equal(S.reserves.length, n, 'резерв поставлен под чужую сделку');
  assert.equal(el('rs-err').hidden, false);
});

test('F1·4 «Сообщения клиентам» и «Клиенты»: менеджер B2B не видит сообщений и клиентов сделок B2C', () => {
  const app = load();
  app.setMe('p3');
  const S = app.S, b2c = S.deals.filter(d => d.type === 'b2c');
  const html = app.VIEWS.messages();
  for (const id of ['Д-311', 'Д-318', 'Д-305']) assert.ok(!html.includes(id), `журнал сообщений показывает ${id}`);
  for (const d of b2c) assert.ok(!html.includes(d.client), `сообщения называют клиента B2C: ${d.client}`);
  // клиенты: тот, у кого только сделки B2C (К-4 Иванов Сергей), в списке и поиске менеджера B2B не виден, карточка не открывается
  const list = app.VIEWS.clients();
  assert.ok(!list.includes('data-id="К-4"'), 'клиент сделки B2C в списке менеджера B2B');
  assert.ok(list.includes('data-id="К-5"'), 'свой клиент пропал из списка');
  assert.equal(app.DRAWERS.client('К-4'), null, 'карточка чужого клиента открылась');
  const found = app.SEARCH.find(s => s.kind === 'client').find('Иванов');
  assert.ok(!found.some(x => x.open.includes('"К-4"')), 'поиск нашёл клиента чужой сделки');
});

test('F1·4 «Требует внимания» и плитка «Резервы с истёкшим сроком» — одно число и только видимые сделки', () => {
  const app = load();
  app.setMe('p3');
  const S = app.S, past = new Date(2026, 0, 1);
  S.reserves.forEach(r => { r.until = past; });
  // руками: у менеджера B2B видны только сделки B2B — резервы r2, r3, r9, r14
  const hand = S.reserves.filter(r => (S.deals.find(d => d.id === r.dealId) || {}).type === 'b2b').length;
  assert.equal(hand, 4);
  const tile = app.homeTiles().find(t => t.id === 'reserves');
  assert.equal(tile.value, hand);
  const list = app.attention().filter(x => x.text.startsWith('Срок резерва вышел'));
  assert.equal(list.length, tile.value, 'список и плитка считают по-разному');
  assert.ok(!list.some(x => /Д-311|Д-318|Д-305|Иванов|Смирнова|Волкова/.test(x.sub)), 'в списке чужие сделки');
});

test('F1·4 уведомление о резерве: складу, директору и менеджеру сделки — не всем менеджерам обоих типов', () => {
  const app = load();
  const S = app.S;
  const before = S.notes.length;
  // p2 (B2C) резервирует строку своей сделки Д-346 (панель 342718442: в строке 120, свободно на складе больше)
  const d = S.deals.find(x => x.id === 'Д-346');
  const idx = d.items.findIndex(it => it.productId === '342718442');
  assert.ok(idx >= 0, 'в демо-сделке нет строки, которую можно зарезервировать');
  const r = app.Deals.reserveItem(S, 'Д-346', idx, { qty: 1 }, 'p2', NOW);
  assert.equal(r.ok, true, r.reason);
  const note = S.notes.slice(0, S.notes.length - before).find(n => n.kind === 'reserve');
  assert.ok(note, 'уведомления о резерве нет');
  for (const p of ['p3', 'p9']) assert.ok(!note.to.includes(p), `менеджер B2B ${p} получил резерв сделки B2C`);
  assert.ok(note.to.includes('p5') && note.to.includes('p1'), 'склад и директор не получили');
  // снятие — так же
  const n2 = S.notes.length;
  assert.equal(app.Deals.unreserve(S, 'Д-346', r.reserve.id, 'p2', later(1)).ok, true);
  const off = S.notes.slice(0, S.notes.length - n2).find(n => n.kind === 'reserve');
  assert.ok(off && !off.to.includes('p3') && !off.to.includes('p9'));
});

// ——— 8. Резерв и снятие из карточки товара — тот же путь, что в сделке ———
test('F1·8 карточка товара: «Снять» и «Списать» по резерву пишут в ленту сделки, прежняя запись о резерве не пропадает', () => {
  const app = load(), S = app.S;
  app.setMe('p2');
  const feed = () => app.Feed.of(S, { t: 'deal', id: 'Д-311' });
  const has = (r, re) => feed().some(e => e.kind === 'reserve' && e.data && e.data.reserveId === r && re.test(e.text));
  // r11 — резерв Д-311 со склада. Снять из карточки товара
  const before = feed().length;
  app.A.unreserve({ dataset: { id: 'r11' } });
  assert.equal(S.reserves.find(r => r.id === 'r11'), undefined, 'резерв не снят');
  assert.ok(has('r11', /^Снят резерв/), 'в ленте сделки нет «Снят резерв»');
  assert.ok(has('r11', /^Резерв:/), 'прежняя запись о резерве пропала из ленты');
  assert.equal(feed().length, before + 1);
  // r12 — списать по резерву из карточки товара (документ — номер сделки)
  const r12 = S.reserves.find(r => r.id === 'r12');
  const el = id => app.document.getElementById(id);
  app.A['stock-sell']({ dataset: { pid: r12.productId, rid: 'r12' } });
  el('ps-src').value = 'r:r12'; el('ps-qty').value = '1'; el('ps-doc').value = 'Д-311'; el('ps-err').hidden = true;
  app.FORMS['stock-sell']({ dataset: { pid: r12.productId, did: '' } });
  assert.equal(el('ps-err').hidden, true, el('ps-err').textContent);
  assert.ok(feed().some(e => e.text.startsWith('Списано при продаже') && e.text.includes('по резерву')), 'списание по резерву не попало в ленту сделки');
  assert.ok(has('r12', /^Резерв:/), 'запись о резерве r12 пропала');
});

test('F1·8 карточка товара: резерв — по праву reserve, не больше строк сделки, с записью в ленте сделки', () => {
  const app = load(), S = app.S;
  const el = id => app.document.getElementById(id);
  // Д-346 (p2): панель 342718442 — в строке 120, уже в резерве 0
  const best = app.Stock.bestCell(S, '342718442');
  const fill = (qty) => { el('rs-deal').value = 'Д-346'; el('rs-qty').value = String(qty); el('rs-src').value = 'stock'; el('rs-ent').value = best.entityId; el('rs-city').value = best.cityId; el('rs-until').value = app.iso(app.day(5)); el('rs-err').hidden = true; };
  const d = S.deals.find(x => x.id === 'Д-346'), line = app.Deals.lined(d, '342718442');
  assert.equal(line, 120);
  app.setMe('p2');
  const n = S.reserves.length;
  fill(line + 1);
  app.FORMS.reserve({ dataset: { pid: '342718442' } });
  assert.equal(S.reserves.length, n, 'резерв больше строк сделки поставлен');
  assert.match(el('rs-err').textContent, /можно ещё 120/);
  fill(2);
  app.FORMS.reserve({ dataset: { pid: '342718442' } });
  assert.equal(S.reserves.length, n + 1, el('rs-err').textContent);
  const r = S.reserves[S.reserves.length - 1];
  assert.ok(S.feed.some(e => e.ref.id === 'Д-346' && e.kind === 'reserve' && e.data && e.data.reserveId === r.id), 'резерв из карточки товара не записан в ленту сделки');
  // инженер (права reserve нет) резерв не ставит, даже если форму прислали
  app.setMe('p7');
  fill(1);
  app.FORMS.reserve({ dataset: { pid: '342718442' } });
  assert.equal(S.reserves.length, n + 1, 'инженер поставил резерв');
});

// ——— 5. Сделки у инженера — на просмотр (R30): правка, этапы и заведение — отдельное право ———
test('F1·5 право «Заводить и править сделки»: у менеджеров, РОП и директора есть, у инженеров нет; ядро Deals отказывает инженеру', () => {
  const app = load(), { Perms, Deals } = app, S = app.S;
  const perm = Perms.LIST.find(p => p[0] === 'dealsEdit');
  assert.ok(perm, 'нет права dealsEdit');
  assert.equal(perm[1], 'Заводить и править сделки');
  const byRole = role => S.people.find(p => p.role === role).id;
  for (const r of ['director', 'managerB2b', 'managerB2c', 'rop']) assert.equal(Perms.can(S, byRole(r), 'dealsEdit'), true, `у роли ${r} нет права`);
  for (const r of ['engineer', 'chiefEngineer', 'logist', 'warehouse']) assert.equal(Perms.can(S, byRole(r), 'dealsEdit'), false, `у роли ${r} лишнее право`);
  // инженер p7 видит сделки (clients + dealsAll), но не двигает, не проваливает и не заводит
  const d = S.deals.find(x => Deals.state(S, x) === 'open');
  const was = d.stageId, other = S.pipelines.find(p => p.id === d.pipeId).stages.find(s => s.id !== d.stageId && !s.flag).id;
  assert.ok(app.Leads.dealsVisible(S, 'p7').includes(d), 'инженер не видит сделку');
  assert.equal(Deals.move(S, d.id, other, 'p7', NOW).ok, false, 'инженер сдвинул сделку');
  assert.equal(Deals.lose(S, d.id, 'Дорого', 'p7', NOW).ok, false, 'инженер провалил сделку');
  assert.equal(Deals.win(S, d.id, 'p7', NOW).ok, false);
  assert.equal(Deals.update(S, d.id, { object: 'правка инженера' }, 'p7', NOW).ok, false);
  assert.equal(d.stageId, was);
  const n = S.deals.length;
  assert.equal(Deals.create(S, { clientId: d.clientId, type: d.type }, 'p7', NOW).ok, false, 'инженер завёл сделку');
  assert.equal(S.deals.length, n);
  // менеджер своего типа — может
  assert.equal(Deals.move(S, d.id, other, d.managerId, NOW).ok, true);
});

test('F1·5 вид: у инженера карточка сделки без полосы этапов и полей правки, без «Новая сделка»; у менеджера — есть', () => {
  const app = load(), S = app.S;
  const d = S.deals.find(x => x.type === 'b2c' && app.Deals.state(S, x) === 'open');
  app.setMe('p7');
  const card = app.DRAWERS.deal(d.id).body;
  assert.ok(!card.includes('data-act="deal-stage"'), 'у инженера полоса этапов');
  assert.ok(!card.includes('data-on="deal-f"'), 'у инженера поля правки');
  assert.ok(!card.includes('data-act="deal-win"') && !card.includes('data-act="deal-lose"'));
  assert.ok(card.includes('Заводить и править сделки'), 'не сказано, какого права не хватает');
  S.ui.dealType = 'b2c';
  const page = app.VIEWS.deals();
  assert.ok(!page.includes('data-act="deal-new"'), 'у инженера кнопка «Новая сделка»');
  assert.ok(!page.includes('draggable="true"'), 'у инженера карточки перетаскиваются');
  app.setMe(d.managerId);
  assert.ok(app.DRAWERS.deal(d.id).body.includes('data-act="deal-stage"'));
  assert.ok(app.VIEWS.deals().includes('data-act="deal-new"'));
});

// ——— 6. Переполнение: выкидывается только то, что не влезло — сначала самое новое и крупное ———
test('F1·6 Store.dump: не влезло — выкинут только новый крупный файл; прежние файлы и фото приёмки сохранены', () => {
  const app = load(), { Store } = app;
  const D = (y, m, d) => new Date(y, m, d, 12);
  const blob = (kind, n, ch) => `data:${kind};base64,` + ch.repeat(n);
  const photo = blob('image/jpeg', 3000, 'A');
  const st = {
    v: 3,
    shipments: [{ id: 's1', received: { at: D(2026, 9, 20), photos: 1, urls: [photo], note: 'коробка мятая' } }],
    dispatches: [
      { id: 'ОТ-001', at: D(2026, 9, 25), to: { name: 'Клиент-пример 1' }, items: [], files: [
        { id: 'fl1', name: 'накладная-пример.txt', type: 'text/plain', size: 2000, data: blob('text/plain', 2000, 'B') },
        { id: 'fl2', name: 'схема-пример.png', type: 'image/png', size: 2000, data: blob('image/png', 2000, 'C') },
      ] },
      { id: 'ОТ-002', at: D(2026, 9, 26), to: { name: 'Клиент-пример 2' }, items: [], files: [
        { id: 'fl1', name: 'акт-пример.txt', type: 'text/plain', size: 2000, data: blob('text/plain', 2000, 'D') },
      ] },
      // самый новый и самый крупный — он и не влезает
      { id: 'ОТ-003', at: D(2026, 10, 1), to: { name: 'Клиент-пример 3' }, items: [], files: [
        { id: 'fl1', name: 'счёт.pdf', type: 'application/pdf', size: 20000, data: blob('application/pdf', 20000, 'E') },
      ] },
    ],
  };
  const full = Store.dump(st, 1e9).text.length;
  // места хватает на всё, кроме нового PDF (20 000 знаков)
  const r = Store.dump(st, full - 15000);
  assert.ok(r.fits, 'не влезло');
  assert.equal(r.droppedFiles, 1, 'выкинуто больше, чем не влезло');
  assert.equal(r.droppedPhotos, 0, 'прежнее фото приёмки выкинуто');
  const back = Store.load(r.text);
  assert.equal(back.dispatches[3 - 1].files[0].data, null);
  assert.equal(back.dispatches[2].files[0].unsaved, true);
  for (const d of back.dispatches.slice(0, 2)) for (const f of d.files) assert.ok(f.data && !f.unsaved, `прежний файл ${d.id}/${f.name} выкинут`);
  assert.equal(back.shipments[0].received.urls[0], photo, 'прежнее фото приёмки пропало');
  // при равном времени первым уходит крупный: два новых файла, места — на один маленький
  const st2 = { v: 3, dispatches: [{ id: 'ОТ-009', at: D(2026, 10, 1), to: { name: 'Клиент-пример' }, items: [], files: [
    { id: 'fl1', name: 'мал.txt', type: 'text/plain', size: 1000, data: blob('text/plain', 1000, 'm') },
    { id: 'fl2', name: 'бол.txt', type: 'text/plain', size: 5000, data: blob('text/plain', 5000, 'b') },
  ] }] };
  const r2 = Store.load(Store.dump(st2, Store.dump(st2, 1e9).text.length - 3000).text).dispatches[0].files;
  assert.ok(r2[0].data && r2[1].data === null, 'выкинут не крупный файл');
});

test('F1·6 файл заявки больше предела — отказ с понятным сообщением ещё при прикреплении', () => {
  const app = load(), { Dispatch, Store } = app;
  assert.equal(Store.FILE_MAX, 2 * 1024 * 1024, 'предел файла — 2 МБ');
  const st = world(app);
  const big = { name: 'скан.pdf', type: 'application/pdf', size: 5 * 1024 * 1024, data: 'data:application/pdf;base64,' + 'A'.repeat(100) };
  const data = { purpose: 'sale', to: { name: 'Клиент-пример', phone: '+7 900 000-00-01' }, address: 'г. Иркутск (пример)', when: { date: '2026-11-05' }, items: [{ productId: 'pv', qty: 1 }], files: [big] };
  const r = Dispatch.create(st, data, 'mgr', NOW);
  assert.equal(r.ok, false, 'заявка с файлом 5 МБ сохранена');
  assert.match(r.reason, /скан\.pdf/);
  assert.match(r.reason, /2 МБ/);
  assert.equal(st.dispatches.length, 0);
  // в пределах — можно
  assert.equal(Dispatch.create(st, { ...data, files: [{ ...big, size: 1024 * 1024 }] }, 'mgr', NOW).ok, true);
});

test('F1·6 браузер дал меньше места, чем рассчитано, — при сохранении выкидывается только лишнее, а не все файлы', () => {
  // хранилище, где места меньше, чем Store.LIMIT: запись длиннее quota браузер не принимает
  let quota = Infinity;
  const box = {};
  const storage = new Proxy(box, { set(t, k, v) { if (String(v).length > quota) throw new Error('QuotaExceededError'); t[k] = v; return true; } });
  const app = load({ storage }), { Dispatch, Store } = app;
  const S = app.S;
  const by = S.people.find(p => p.role === 'logist').id;
  const blob = k => 'data:text/plain;base64,' + String(k).repeat(300000);
  const r = Dispatch.create(S, { purpose: 'other', to: { name: 'Клиент-пример 82', phone: '+7 900 000-00-82' }, address: 'г. Иркутск, ул. Примерная, 82 (пример)', when: { date: new Date(2026, 10, 5) }, items: [{ text: 'Документы', qty: 1 }], files: [1, 2, 3].map(k => ({ name: `файл-${k}.txt`, type: 'text/plain', size: 300000, data: blob(k) })) }, by, new Date(2026, 10, 1));
  assert.equal(r.ok, true, r.reason);
  const full = Store.dump(S).text.length;
  assert.ok(full < Store.LIMIT, 'пример должен влезать в расчётный предел');
  quota = full - 200000;           // браузер не принимает только одного файла
  assert.equal(app.save().ok, true);
  const files = JSON.parse(box[Store.KEY]).dispatches.find(d => d.id === r.id).files;
  assert.equal(files.filter(f => f.data === null && f.unsaved === true).length, 1, 'выкинуто больше, чем не влезло');
  assert.equal(files.filter(f => typeof f.data === 'string').length, 2);
});

// ——— 7. Демо не трогает настоящий снимок остатков ———
test('F1·7 сразу после «Сбросить» остатки равны Catalog.build(снимок): демо-перемещения не двигают настоящий товар', () => {
  const app = load(), { Catalog, CATALOG, STOCK_SNAPSHOT } = app;
  const st = app.seed();
  const want = plain(Catalog.build(CATALOG, STOCK_SNAPSHOT).stock);
  const got = plain(st.stock);
  const diff = [...new Set([...Object.keys(want), ...Object.keys(got)])].filter(id => JSON.stringify(want[id]) !== JSON.stringify(got[id]));
  assert.deepEqual(diff, [], `остатки демо отличаются от снимка: ${diff.slice(0, 8).map(id => `${id}: ${JSON.stringify(got[id])} вместо ${JSON.stringify(want[id])}`).join('; ')}`);
  // демо-перемещения есть, но ни одно не ушло со склада
  const tr = st.dispatches.filter(d => d.purpose === 'transfer');
  assert.ok(tr.length >= 3, 'в демо нет перемещений');
  assert.ok(tr.every(d => !d.moved), 'демо-перемещение увезло товар со склада');
  // и сброс в работе делает то же: resetData берёт seed()
  app.resetData();
  assert.deepEqual(plain(app.S.stock), want);
});

// ——— 9. Списанная строка заявки не меняется ———
test('F1·9 Dispatch.update: списанную при продаже строку нельзя изменить или удалить — отказ с причиной; прочие строки править можно', () => {
  const app = load(), { Dispatch } = app;
  const st = world(app);
  const data = { purpose: 'sale', to: { name: 'Клиент-пример', phone: '+7 900 000-00-01' }, address: 'г. Иркутск (пример)', when: { date: '2026-11-05' },
    items: [{ text: 'Шнур (пример)', qty: 1 }, { productId: 'pv', qty: 2 }, { productId: 'inv', qty: 1 }] };
  const made = Dispatch.create(st, data, 'mgr', NOW);
  assert.equal(made.ok, true, made.reason);
  const sold = Dispatch.sell(st, made.id, 1, IRK, 'mgr', later(1));
  assert.equal(sold.ok, true, sold.reason);
  const d = Dispatch.byId(st, made.id);
  const keep = plain(d.items);
  const row = (k, q) => ({ productId: k, qty: q });
  // продали 2, исправили на 50 — отказ, в заявке по-прежнему 2 и «списано»
  const r1 = Dispatch.update(st, made.id, { items: [{ text: 'Шнур (пример)', qty: 1 }, row('pv', 50), row('inv', 1)] }, 'log', later(2));
  assert.equal(r1.ok, false, 'списанной строке сменили количество');
  assert.match(r1.reason, /списан/);
  assert.match(r1.reason, /Панель тестовая/);
  assert.deepEqual(plain(d.items), keep);
  // удалить списанную строку — отказ
  const r2 = Dispatch.update(st, made.id, { items: [{ text: 'Шнур (пример)', qty: 1 }, row('inv', 1)] }, 'log', later(2));
  assert.equal(r2.ok, false, 'списанную строку удалили');
  assert.deepEqual(plain(d.items), keep);
  // заменить товар списанной строки — отказ
  assert.equal(Dispatch.update(st, made.id, { items: [{ text: 'Шнур (пример)', qty: 1 }, row('inv', 2), row('inv', 1)] }, 'log', later(2)).ok, false);
  // убрать строку выше и поменять другую — можно, «списано» остаётся у той же строки
  const r3 = Dispatch.update(st, made.id, { items: [row('pv', 2), row('inv', 3)] }, 'log', later(3));
  assert.equal(r3.ok, true, r3.reason);
  assert.equal(d.items[0].productId, 'pv');
  assert.deepEqual(plain(d.items[0].sold), keep[1].sold);
  assert.equal(d.items[1].sold, undefined, '«списано» перешло на чужую строку');
  // отметку «списано» нельзя принести с данными: её ставит только «Списать при продаже»
  const fake = Dispatch.create(st, { ...data, items: [{ productId: 'inv', qty: 1, sold: { at: NOW, by: 'mgr', entityId: 'ip', cityId: 'irk' } }] }, 'mgr', NOW);
  assert.equal(fake.ok, true, fake.reason);
  assert.equal(Dispatch.byId(st, fake.id).items[0].sold, undefined, 'строка «списана» без списания');
});

test('F1·9 форма правки заявки: списанная строка без поля количества и без кнопки «Убрать»', () => {
  const app = load(), { Dispatch } = app;
  const S = app.S;
  const mgr = S.people.find(p => p.role === 'managerB2c').id;
  S.me = mgr;
  const pid = S.products.find(p => p.inCatalog && app.Stock.summary(S, p.id, new Date()).free >= 3).id;
  const made = Dispatch.create(S, { purpose: 'sale', to: { name: 'Клиент-пример', phone: '+7 900 000-00-01' }, address: 'г. Иркутск (пример)', when: { date: '2026-11-05' }, items: [{ productId: pid, qty: 2 }, { text: 'Шнур (пример)', qty: 1 }] }, mgr, new Date());
  assert.equal(made.ok, true, made.reason);
  const cellOf = app.Stock.bestCell ? app.Stock.bestCell(S, pid) : null;
  const r = Dispatch.sell(S, made.id, 0, cellOf, mgr, new Date());
  assert.equal(r.ok, true, r.reason);
  S.ui.dspDraft = app.dspDraftFrom(Dispatch.byId(S, made.id), made.id);
  const html = app.dspItemsHtml(S.ui.dspDraft);
  const li = html.split('<li').filter(Boolean);
  assert.match(li[1], /списано при продаже/);
  assert.ok(!/data-act="dsp-line-del" data-i="0"/.test(html), 'у списанной строки есть «Убрать»');
  assert.ok(/disabled/.test(li[1]) && !/data-on="dsp-qty" data-i="0"/.test(html), 'у списанной строки можно править количество');
  assert.ok(/data-act="dsp-line-del" data-i="1"/.test(html), 'у обычной строки нет «Убрать»');
  // «Сохранить» с формы проходит: строка не изменена
  const back = Dispatch.update(S, made.id, { items: S.ui.dspDraft.items }, mgr, new Date());
  assert.equal(back.ok, true, back.reason);
  assert.ok(Dispatch.byId(S, made.id).items[0].sold, '«списано» потеряно при сохранении формы');
});

// ——— 10. «Можно ещё зарезервировать» — одна функция Deals.left ———
test('F1·10 экран сделки берёт «можно ещё зарезервировать» из Deals.left, своей копии формулы нет', () => {
  const app = load(), { Deals } = app;
  const S = app.S;
  S.me = 'p1';
  const d = S.deals.find(x => Deals.state(S, x) === 'open' && (x.items || []).some(it => it.productId));
  assert.ok(d, 'в демо нет открытой сделки со строкой товара');
  const i = d.items.findIndex(it => it.productId);
  const real = Deals.left(S, d, d.items[i].productId);
  const orig = Deals.left;
  try {
    Deals.left = () => 4321;
    assert.match(app.MODALS.dealReserve(`${d.id}:${i}`), /id="dr-qty"[^>]*value="4321"/, 'окно резерва считает остаток своей формулой');
    assert.ok(/осталось 4[\s ]?321/.test(app.MODALS.dealReserve(`${d.id}:${i}`)), 'текст окна считает остаток своей формулой');
    Deals.left = () => 0;
    assert.ok(!app.dealLine(d, d.items[i], i, true, null).includes('data-act="deal-res"'), 'кнопка «Зарезервировать» считает остаток своей формулой');
  } finally { Deals.left = orig; }
  if (real > 0) assert.ok(app.dealLine(d, d.items[i], i, true, null).includes('data-act="deal-res"'));
});
