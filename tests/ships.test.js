'use strict';
// Поставки (таск 03, ядро): точки и маршрут, где груз, счётчики схемы, опоздание, смена этапа и уведомления,
// правила директора, шаги перевозчика, «ждёт приёмки» одним числом, поиск и фильтры, демо-набор на 120+ поставок.
// Ожидаемое — из спецификации (истории 29–47, 41а), из воронки поставок по умолчанию и из рук собранных
// маленьких наборов: числа тут посчитаны вручную, а не взяты из кода под тестом.

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.js');

const DEMO_NOW = new Date(2026, 9, 31, 12);
const DEMO_DAY = new Date(2026, 9, 31);
const plain = x => JSON.parse(JSON.stringify(x));

// ——— маленький набор, собранный руками ———
// Воронка поставок по умолчанию; четыре человека, у p3 вид «Поставки» выключен.
// Товары: pa, pb, pc. Поставки (route cn>chita>irk, если не сказано иное):
//   A ordered, в Китае, 10+5 = 15 шт          B toBorder, на перегоне cn>chita, 20 шт
//   C customs, в Чите, маршрут cn>chita>msk, 7 шт   D transship, в Чите, маршрут cn>chita>msk, 3 шт
//   E toStock, на перегоне chita>irk, 4 шт    F arrived, в Иркутске, 9 шт
//   G inStock, принята, 100 шт (на схеме не считается)   H отгрузка клиенту, маршрута нет
function mini(app, over = {}) {
  const ship = (id, stageId, route, pos, items, extra = {}) => ({
    id, number: id, dir: 'in', supplier: 'Поставщик-пример 1', track: 'T-' + id, entityId: 'ip', cityId: route[route.length - 1],
    route, pos, depart: new Date(2026, 9, 1), eta: new Date(2026, 10, 10, 12), pipeId: 'ships', stageId,
    items: items.map(([productId, qty]) => ({ productId, qty })), history: [{ at: new Date(2026, 9, 1), by: 'p6', text: 'Заказ' }], ...extra,
  });
  const irk = ['cn', 'chita', 'irk'], msk = ['cn', 'chita', 'msk'];
  const base = app.Stock.defaults();
  return Object.assign({
    entities: base.entities, cities: base.cities,
    pipelines: app.Pipes.defaults(),
    people: [
      { id: 'p1', name: 'Директор', role: 'director' }, { id: 'p2', name: 'Менеджер', role: 'managerB2b' },
      { id: 'p3', name: 'Выключивший', role: 'warehouse' }, { id: 'p6', name: 'Логист', role: 'logist' },
    ],
    prefs: { notify: { p3: { ship: false } } },
    products: [{ id: 'pa', name: 'Панель А' }, { id: 'pb', name: 'Инвертор Б' }, { id: 'pc', name: 'Кабель В' }],
    stock: {}, aside: {}, reserves: [], moves: [], notes: [],
    shipRules: [],
    shipments: [
      ship('A', 'ordered', irk, { i: 0, t: 0 }, [['pa', 10], ['pb', 5]]),
      ship('B', 'toBorder', irk, { i: 0, t: 0.4 }, [['pa', 20]]),
      ship('C', 'customs', msk, { i: 1, t: 0 }, [['pc', 7]], { supplier: 'Поставщик-пример 2', entityId: 'npp' }),
      ship('D', 'transship', msk, { i: 1, t: 0 }, [['pb', 3]], { supplier: 'Поставщик-пример 2', entityId: 'npp' }),
      ship('E', 'toStock', irk, { i: 1, t: 0.5 }, [['pa', 4]]),
      ship('F', 'arrived', irk, { i: 2, t: 0 }, [['pc', 9]]),
      ship('G', 'inStock', irk, { i: 2, t: 0 }, [['pa', 100]], { received: { at: new Date(2026, 9, 20), by: 'p5', photos: 1, urls: [], note: '' } }),
      { id: 'H', dir: 'out', supplier: 'Наш склад', pipeId: 'shipsOut', stageId: 'sent', eta: new Date(2026, 10, 10), history: [], items: [{ productId: 'pa', qty: 1 }] },
    ],
  }, over);
}
const withOut = st => { st.pipelines.push({ id: 'shipsOut', kind: 'ships', dir: 'out', name: 'Отгрузки', stages: [{ id: 'sent', name: 'Отгружено' }, { id: 'delivered', name: 'Доставлено', flag: 'final' }] }); return st; };
const ids = rows => Array.from(rows, s => s.id);

// ——— точки ———
test('Ships.NODES: пять точек с подписями из спецификации и координатами', () => {
  const { Ships } = load();
  assert.deepEqual(plain(Ships.NODES.map(n => [n.id, n.name, n.label])), [
    ['cn', 'Китай', 'основной город-поставщик'],
    ['chita', 'Чита', 'основной город-приёмщик · таможня и перевалка'],
    ['irk', 'Иркутск', 'основной город-получатель'],
    ['msk', 'Москва', 'город-получатель'],
    ['krd', 'Краснодар', 'город-получатель'],
  ]);
  for (const n of Ships.NODES) assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y), `у точки ${n.id} нет координат`);
});

// ——— где груз ———
test('Ships.where: стоит в точке или идёт по перегону — словами; у Читы на таможне и перевалке подпись', () => {
  const app = load();
  const st = mini(app);
  const w = id => app.Ships.where(st.shipments.find(s => s.id === id));
  assert.equal(w('A').at, 'cn');
  assert.equal(w('A').text, 'Китай');
  assert.deepEqual(plain([w('B').from, w('B').to, w('B').t]), ['cn', 'chita', 0.4]);
  assert.equal(w('B').text, 'в пути Китай → Чита, пройдено 40%');
  assert.equal(w('C').text, 'Чита, таможня');
  assert.equal(w('D').text, 'Чита, перевалка');
  assert.equal(w('E').text, 'в пути Чита → Иркутск, пройдено 50%');
  assert.equal(w('F').text, 'Иркутск');
  assert.equal(w('H').text, 'нет данных: маршрут', 'у отгрузки клиенту маршрута нет — пусто, не выдуманная точка');
});

// ——— счётчики схемы ———
test('Ships.mapCounts: поставок и штук по точкам и перегонам; у Читы отдельно «на таможне»; принятые и отгрузки не считаются', () => {
  const app = load();
  const st = withOut(mini(app));
  const m = app.Ships.mapCounts(st);
  const c = x => [x.ships, x.units];
  assert.deepEqual(c(m.nodes.cn), [1, 15], 'A: в Китае, 10 + 5');
  assert.deepEqual(c(m.legs['cn>chita']), [1, 20], 'B на перегоне Китай → Чита');
  assert.deepEqual(c(m.nodes.chita), [2, 10], 'C и D в Чите: 7 + 3');
  assert.deepEqual(c(m.nodes.chita.customs), [1, 7], 'на таможне только C');
  assert.deepEqual(c(m.legs['chita>irk']), [1, 4], 'E на перегоне Чита → Иркутск');
  assert.deepEqual(c(m.nodes.irk), [1, 9], 'F ждёт приёмки в Иркутске; G принята и не считается');
  assert.deepEqual(c(m.nodes.msk), [0, 0]);
  assert.deepEqual(c(m.nodes.krd), [0, 0]);
  assert.deepEqual(c(m.legs['chita>msk']), [0, 0], 'перегон есть в маршрутах C и D, груза на нём сейчас нет');
  assert.equal(m.legs['chita>krd'], undefined, 'по Краснодару маршрутов нет — перегона нет');
  // фильтр по городу оставляет C и D
  const msk = app.Ships.mapCounts(st, { city: 'msk' });
  assert.deepEqual(c(msk.nodes.chita), [2, 10]);
  assert.deepEqual(c(msk.nodes.cn), [0, 0]);
  assert.deepEqual(c(msk.nodes.irk), [0, 0]);
});

// ——— опоздание ———
test('Ships.isLate: опаздывает открытая поставка с прошедшим днём прихода; сегодняшняя, принятая и закрытая — нет', () => {
  const app = load();
  const st = mini(app);
  const now = new Date(2026, 10, 10, 18);
  const s = st.shipments.find(x => x.id === 'E');
  s.eta = new Date(2026, 10, 9, 12);
  assert.equal(app.Ships.isLate(s, now, st), true, 'вчерашний день прихода');
  s.eta = new Date(2026, 10, 10, 9);
  assert.equal(app.Ships.isLate(s, now, st), false, 'приход сегодня — ещё не опоздала, даже если час прошёл');
  s.eta = new Date(2026, 10, 11, 12);
  assert.equal(app.Ships.isLate(s, now, st), false, 'приход завтра');
  s.eta = new Date(2026, 9, 1);
  s.stageId = 'inStock';
  assert.equal(app.Ships.isLate(s, now, st), false, 'закрытая (final) не опаздывает');
  s.stageId = 'toStock';
  s.received = { at: new Date(2026, 9, 2), by: 'p5', photos: 0, urls: [], note: '' };
  assert.equal(app.Ships.isLate(s, now, st), false, 'принятая не опаздывает');
  delete s.received;
  assert.equal(app.Ships.isLate(s, now), true, 'без состояния этап не проверить — открытая с прошедшим сроком опаздывает');
});

// ——— смена этапа ———
test('Ships.setStage: пишет историю с источником, двигает груз по маршруту и шлёт «Перевозки» всем, кроме выключивших вид', () => {
  const app = load();
  const st = mini(app);
  const now = new Date(2026, 9, 31, 11, 5);
  const r = app.Ships.setStage(st, 'B', 'customs', 'p6', now);
  assert.equal(r.ok, true);
  const b = st.shipments.find(s => s.id === 'B');
  assert.equal(b.stageId, 'customs');
  assert.deepEqual(plain(b.pos), { i: 1, t: 0 }, 'таможня — груз встал в Чите');
  const last = b.history[b.history.length - 1];
  assert.equal(last.source, 'вручную');
  assert.equal(last.by, 'p6');
  assert.equal(last.at.getTime(), now.getTime());
  assert.ok(last.text.includes('Таможня') && last.text.includes('Чита'), `в отметке нет этапа и места: ${last.text}`);
  assert.equal(b.history.length, 2);
  // уведомление
  assert.equal(st.notes.length, 1);
  const n = st.notes[0];
  assert.equal(n.kind, 'ship');
  assert.deepEqual(plain(n.to.slice().sort()), ['p1', 'p2', 'p6'], 'p3 выключил вид «Перевозки» — ему не приходит');
  assert.ok(n.text.includes('B') && n.text.includes('Панель А') && n.text.includes('Таможня') && n.text.includes('Чита'), `что-где: ${n.text}`);
  assert.ok(n.text.includes('10 ноя'), `когда будет: ${n.text}`);
  // тот же этап — ничего не пишется
  const again = app.Ships.setStage(st, 'B', 'customs', 'p6', now);
  assert.equal(again.ok, false);
  assert.equal(b.history.length, 2);
  assert.equal(st.notes.length, 1);
  // нет такого этапа — отказ
  assert.equal(app.Ships.setStage(st, 'B', 'нет-такого', 'p6', now).ok, false);
});

// ——— правила директора ———
test('Ships.applyRules: включённое правило ставит этап и пишется в историю; выключенное и чужое событие — нет', () => {
  const app = load();
  const st = mini(app);
  const now = new Date(2026, 9, 31, 11, 5);
  st.shipRules = [
    { id: 'r-off', on: false, when: 'carrier:chita', then: 'transship' },
    { id: 'r-on', on: true, when: 'carrier:chita', then: 'customs' },
    { id: 'r-other', on: true, when: 'received', then: 'inStock' },
  ];
  const b = st.shipments.find(s => s.id === 'B');
  const fired = app.Ships.applyRules(st, 'carrier:chita', 'B', 'p6', now);
  assert.deepEqual(plain(fired), ['r-on'], 'сработало только включённое правило этого события');
  assert.equal(b.stageId, 'customs', 'выключенное правило (transship) не перебило включённое');
  const last = b.history[b.history.length - 1];
  assert.ok(last.source.startsWith('правило:'), `источник: ${last.source}`);
  assert.ok(last.source.includes('Чита') && last.source.includes('Таможня'), `правило названо: ${last.source}`);
  assert.equal(last.auto, true);
  assert.equal(st.notes.length, 1, 'смена этапа по правилу тоже рассылается');
  // событие, которого правила не ждут, и повтор того же — ничего не меняют
  assert.deepEqual(plain(app.Ships.applyRules(st, 'customs', 'B', 'p6', now)), []);
  assert.deepEqual(plain(app.Ships.applyRules(st, 'carrier:chita', 'B', 'p6', now)), [], 'этап уже тот — не срабатывает второй раз');
  assert.equal(b.history.length, 2);
  // переключили: включили одно, выключили другое — сработало включённое
  st.shipRules[0].on = true;
  st.shipRules[1].on = false;
  assert.deepEqual(plain(app.Ships.applyRules(st, 'carrier:chita', 'B', 'p6', now)), ['r-off']);
  assert.equal(b.stageId, 'transship');
  // два включённых на одно событие идут по порядку списка; первое уже ничего не меняет (этап уже transship), второе меняет
  st.shipRules[1].on = true;
  assert.deepEqual(plain(app.Ships.applyRules(st, 'carrier:chita', 'B', 'p6', now)), ['r-on']);
  assert.equal(b.stageId, 'customs');
  // «перевозчик в любой точке»
  st.shipRules = [{ id: 'any', on: true, when: 'carrier', then: 'toStock' }];
  assert.deepEqual(plain(app.Ships.applyRules(st, 'carrier:msk', 'B', 'p6', now)), ['any']);
  // этапа правила нет в воронке — правило не ломает
  st.shipRules = [{ id: 'gone', on: true, when: 'received', then: 'удалён' }];
  assert.deepEqual(plain(app.Ships.applyRules(st, 'received', 'B', 'p6', now)), []);
});

// ——— шаги перевозчика ———
test('Ships.advance: груз идёт по плану маршрута до «Прибыло в город», событие точки запускает правило, на склад двигает только приёмка', () => {
  const app = load();
  const st = mini(app);
  const a = st.shipments.find(s => s.id === 'A');
  st.shipRules = [{ id: 'cust', on: true, when: 'carrier:chita', then: 'customs' }];
  const seen = [];
  for (let k = 0; k < 20; k++) {
    const r = app.Ships.advance(st, 'A', 'p6', new Date(2026, 9, 31, 8, k));
    if (!r.ok) { seen.push('стоп: ' + r.reason); break; }
    seen.push(a.stageId + '@' + a.route[a.pos.i] + (a.pos.t > 0 ? '~' : ''));
  }
  assert.deepEqual(plain(seen), [
    'shipped@cn', 'toBorder@cn~', 'customs@chita', 'transship@chita', 'toStock@chita~', 'arrived@irk',
    'стоп: Груз уже в городе назначения: дальше его принимает склад.',
  ]);
  const hist = a.history.slice(1);
  assert.equal(hist.length, 6);
  assert.ok(hist.every(h => h.source === 'автоматически: перевозчик' && h.auto === true), 'каждый шаг помечен перевозчиком');
  // правило точки: груз пришёл в Читу (customs) — правило хотело «Таможня», уже так; значит не писало второй раз
  assert.ok(!hist.some(h => h.source.startsWith('правило:')));
  // правило, которое отличается от встроенного этапа, срабатывает после шага
  const b = st.shipments.find(s => s.id === 'B');
  st.shipRules = [{ id: 'skip', on: true, when: 'carrier:chita', then: 'transship' }];
  const r = app.Ships.advance(st, 'B', 'p6', new Date(2026, 9, 31, 9));
  assert.deepEqual(plain(r.events), ['carrier:chita']);
  assert.deepEqual(plain(r.applied), ['skip']);
  assert.equal(b.stageId, 'transship', 'правило директора перебило встроенный этап «Таможня»');
  assert.ok(b.history[b.history.length - 1].source.startsWith('правило:'));
  // принятую и отгрузку клиенту не двигаем
  assert.equal(app.Ships.advance(st, 'G', 'p6', DEMO_NOW).ok, false);
  assert.equal(app.Ships.advance(st, 'H', 'p6', DEMO_NOW).ok, false);
  assert.equal(app.Ships.advance(st, 'нет', 'p6', DEMO_NOW).ok, false);
});

// ——— «ждёт приёмки» ———
test('Ships.awaitingReceipt: единственное число — бейдж меню, список приёмки и модель дают одно и то же', () => {
  const app = load();
  const st = mini(app);
  assert.deepEqual(ids(app.Ships.awaitingReceipt(st)), ['F']);
  assert.equal(app.Ships.awaitingReceipt(st, st.shipments.find(s => s.id === 'F')), true);
  assert.equal(app.Ships.awaitingReceipt(st, st.shipments.find(s => s.id === 'E')), false, 'в пути — ещё не ждёт');
  st.shipments.find(s => s.id === 'F').received = { at: DEMO_DAY, by: 'p5', photos: 0, urls: [], note: '' };
  assert.deepEqual(ids(app.Ships.awaitingReceipt(st)), [], 'принятая больше не ждёт');
  // демо: бейдж, список приёмки и модель
  const S = app.S;
  const want = S.shipments.filter(s => s.dir === 'in' && !s.received && app.Pipes.stage(S, s.pipeId, s.stageId).flag === 'arrived');
  assert.ok(want.length >= 5, `в демо ждут приёмки: ${want.length}`);
  const badge = app.NAV.find(n => n.id === 'receiving').badge();
  assert.equal(badge, want.length, 'бейдж меню');
  assert.equal(app.pendingRcv().length, want.length, 'список приёмки');
  assert.equal(app.Ships.awaitingReceipt(S).length, want.length, 'ядро');
  assert.deepEqual(ids(S.shipments.filter(app.awaitsReceipt)).sort(), ids(want).sort(), 'модель awaitsReceipt — то же определение');
  // после приёмки одной поставки число падает везде разом
  const s0 = want[0];
  app.setMe('p5');
  app.A['rcv-start']({ dataset: { id: s0.id } });
  app.A['rcv-confirm']();
  assert.equal(app.NAV.find(n => n.id === 'receiving').badge(), want.length - 1);
  assert.equal(app.pendingRcv().length, want.length - 1);
});

// ——— поиск и фильтры ———
test('Ships.query: фильтры по этапу, точке, перегону, городу, юрлицу, поставщику и поиск; total считает все страницы; сортировка и страницы', () => {
  const app = load();
  const st = withOut(mini(app));
  const q = f => app.Ships.query(st, f);
  assert.equal(q({}).total, 7, 'без фильтра — поставки к нам, отгрузка клиенту не входит');
  assert.equal(q({ dir: 'all' }).total, 8);
  assert.deepEqual(ids(q({ stage: 'customs' }).rows), ['C']);
  assert.deepEqual(ids(q({ node: 'chita' }).rows).sort(), ['C', 'D'], 'в точке Чита');
  assert.deepEqual(ids(q({ node: 'chita', stage: 'customs' }).rows), ['C'], 'Чита и таможня — нажатие на «на таможне»');
  assert.deepEqual(ids(q({ node: 'cn>chita' }).rows), ['B'], 'на перегоне Китай → Чита');
  assert.deepEqual(ids(q({ node: 'chita>irk' }).rows), ['E']);
  assert.deepEqual(ids(q({ city: 'msk' }).rows).sort(), ['C', 'D']);
  assert.deepEqual(ids(q({ city: 'irk' }).rows).sort(), ['A', 'B', 'E', 'F', 'G']);
  assert.deepEqual(ids(q({ entity: 'npp' }).rows).sort(), ['C', 'D']);
  assert.deepEqual(ids(q({ supplier: 'Поставщик-пример 2' }).rows).sort(), ['C', 'D']);
  assert.deepEqual(ids(q({ q: 'инвертор' }).rows).sort(), ['A', 'D'], 'поиск по названию товара в позициях');
  assert.deepEqual(ids(q({ q: 'T-F' }).rows), ['F'], 'поиск по треку');
  assert.deepEqual(ids(q({ q: 'чита таможня' }).rows), ['C'], 'поиск по месту: оба слова');
  assert.deepEqual(ids(q({ q: 'ИНВЕРТОР', city: 'msk' }).rows), ['D'], 'поиск и фильтр вместе, регистр не важен');
  assert.equal(q({ q: 'нет такого' }).total, 0);
  // сортировка и страницы
  st.shipments.find(s => s.id === 'A').eta = new Date(2026, 10, 1);
  st.shipments.find(s => s.id === 'B').eta = new Date(2026, 10, 3);
  st.shipments.find(s => s.id === 'C').eta = new Date(2026, 10, 2);
  const byEta = q({ sort: 'eta', size: 3 });
  assert.deepEqual(ids(byEta.rows), ['A', 'C', 'B']);
  assert.equal(byEta.total, 7, 'total — все подходящие, не одна страница');
  assert.equal(byEta.pages, 3);
  assert.equal(q({ sort: 'eta', size: 3, page: 3 }).rows.length, 1);
  assert.deepEqual(ids(q({ sort: '-units', size: 2 }).rows), ['G', 'B'], 'по убыванию штук: 100, 20');
  assert.deepEqual(ids(q({ sort: 'stage', size: 2 }).rows), ['A', 'B'], 'по порядку этапов воронки');
  assert.equal(q({ page: 99 }).page, 1, 'страница за пределом — последняя');
});

// ——— демо ———
test('демо: 120+ поставок, после повторного seed() те же; маршруты на Москву и Краснодар, большие составы, ждущие приёмки и просроченные', () => {
  const app = load();
  const a = app.seed(), b = app.seed();
  const fp = st => st.shipments.map(s => [s.id, s.stageId, s.items.length, s.supplier, s.route && s.route.join('>'), s.eta.getTime(), JSON.stringify(s.pos)].join('|'));
  assert.ok(a.shipments.length >= 120, `поставок: ${a.shipments.length}`);
  assert.deepEqual(fp(a), fp(b), 'после повторного seed() набор другой');
  assert.deepEqual(a.shipments.map(s => s.id), b.shipments.map(s => s.id));
  assert.equal(new Set(a.shipments.map(s => s.id)).size, a.shipments.length, 'номера поставок повторяются');
  const inc = a.shipments.filter(s => s.dir === 'in');
  const routeSet = new Set(inc.map(s => s.route.join('>')));
  assert.ok(routeSet.size >= 5, `разных маршрутов: ${routeSet.size}`);
  assert.ok(inc.some(s => s.route[s.route.length - 1] === 'msk'), 'нет маршрута на Москву');
  assert.ok(inc.some(s => s.route[s.route.length - 1] === 'krd'), 'нет маршрута на Краснодар');
  assert.ok(inc.some(s => s.route[s.route.length - 1] === 'irk'), 'нет маршрута на Иркутск');
  const known = new Set(['cn', 'chita', 'irk', 'msk', 'krd']);
  for (const s of inc) {
    assert.ok(s.route.every(n => known.has(n)), `${s.id}: точка вне пяти`);
    assert.ok(s.route[0] === 'cn' && s.cityId === s.route[s.route.length - 1], `${s.id}: город назначения не последняя точка маршрута`);
  }
  assert.ok(new Set(inc.map(s => s.entityId)).size === 3, 'юрлица: ИП, НПП и ВС');
  assert.ok(new Set(inc.map(s => s.cityId)).size === 3, 'города: Иркутск, Москва, Краснодар');
  const stages = new Set(inc.map(s => s.stageId));
  for (const id of ['ordered', 'shipped', 'toBorder', 'customs', 'transship', 'toStock', 'arrived', 'inStock']) assert.ok(stages.has(id), `нет поставок на этапе ${id}`);
  const big = inc.filter(s => s.items.length >= 50);
  assert.ok(big.length >= 4 && big.every(s => s.items.length <= 150), `больших поставок: ${big.length}`);
  assert.ok(Math.max(...big.map(s => s.items.length)) >= 120, 'нет состава на 120+ позиций');
  assert.ok(inc.filter(s => s.items.length <= 10).length >= inc.length * 0.8, 'у большинства 1–10 позиций');
  // демо помечено: поставщики-примеры, номера и треки с «демо»
  for (const s of inc) {
    assert.match(s.supplier, /^Поставщик-пример \d+$/, `${s.id}: поставщик не пример`);
    assert.ok(s.number.includes('демо') && s.track.includes('демо') && s.demo === true, `${s.id}: нет пометки «демо»`);
  }
});

test('демо: ждущие приёмки и просроченные есть; позиции — настоящие товары; этап, положение и история согласованы; резервы ведут на поставки с этим товаром', () => {
  const app = load();
  const S = app.S;
  const inc = S.shipments.filter(s => s.dir === 'in');
  const isFinal = s => app.Pipes.isFinal(S, s.pipeId, s.stageId);
  // независимый счёт просроченных: не закрыта и срок раньше начала дня 31.10.2026
  const lateWant = S.shipments.filter(s => !isFinal(s) && s.eta < DEMO_DAY);
  assert.ok(lateWant.length >= 10, `просроченных: ${lateWant.length}`);
  assert.deepEqual(ids(S.shipments.filter(s => app.Ships.isLate(s, DEMO_NOW, S))).sort(), ids(lateWant).sort());
  const waiting = app.Ships.awaitingReceipt(S);
  assert.ok(waiting.length >= 5 && waiting.some(s => app.Ships.isLate(s, DEMO_NOW, S)), 'ждут приёмки, часть — просрочена');
  assert.ok(waiting.some(s => !app.Ships.isLate(s, DEMO_NOW, S)));
  // позиции — товары из S.products
  const prod = new Set(S.products.map(p => p.id));
  for (const s of S.shipments) for (const it of s.items) {
    assert.ok(prod.has(it.productId), `${s.id}: товара ${it.productId} нет`);
    assert.ok(it.qty > 0);
  }
  for (const s of inc) assert.equal(new Set(s.items.map(i => i.productId)).size, s.items.length, `${s.id}: товар в составе повторяется`);
  // этап и положение согласованы
  const last = s => s.route.length - 1;
  for (const s of inc) {
    const w = app.Ships.where(s);
    if (s.stageId === 'ordered' || s.stageId === 'shipped') assert.equal(w.at, 'cn', s.id);
    if (s.stageId === 'toBorder') assert.deepEqual(plain([w.from, w.to]), ['cn', 'chita'], s.id);
    if (s.stageId === 'customs' || s.stageId === 'transship') assert.equal(w.at, 'chita', s.id);
    if (s.stageId === 'toStock') assert.ok(w.from ? s.route.indexOf(w.from) >= 1 : w.at !== 'cn' && w.at !== 'chita' && w.at !== s.route[last(s)], `${s.id}: ${w.text}`);
    if (s.stageId === 'arrived' || s.stageId === 'inStock') assert.equal(w.at, s.route[last(s)], s.id);
    // история: даты не позже дня демо и идут по возрастанию, у каждой есть кто, что и источник
    assert.ok(s.history.length >= 1, s.id);
    s.history.forEach((h, i) => {
      assert.ok(h.by && h.text && h.source, `${s.id}: неполная отметка`);
      assert.ok(h.at <= DEMO_NOW, `${s.id}: отметка из будущего`);
      if (i) assert.ok(h.at >= s.history[i - 1].at, `${s.id}: отметки не по порядку`);
    });
    if (isFinal(s)) { assert.ok(s.received && s.received.at <= DEMO_NOW, `${s.id}: принята без received`); assert.ok(s.items.every(i => i.got === i.qty)); }
    else assert.ok(!s.received, `${s.id}: не закрыта, но принята`);
  }
  // резервы под поставку ведут на существующую поставку, где есть этот товар в нужном количестве
  const under = S.reserves.filter(r => r.src !== 'stock');
  assert.ok(under.length >= 5);
  for (const r of under) {
    const s = S.shipments.find(x => x.id === r.src);
    assert.ok(s, `резерв ${r.id}: поставки ${r.src} нет`);
    assert.ok(s.items.some(i => i.productId === r.productId), `резерв ${r.id}: в ${r.src} нет товара`);
    // единственная нехватка — из демо v2 и из его уведомления: «Поставщик сократил П-1042 … Под резервы не хватает 1 шт.»
    const free = app.Stock.freeIn(S, s.id, r.productId);
    if (s.id === 'П-1042') assert.equal(free, -1, 'П-1042: резервов на 3 шт, едет 2'); else assert.ok(free >= 0, `резерв ${r.id}: больше, чем едет в ${s.id}`);
  }
  // модель и ядро говорят одно: «ждёт приёмки», «опоздала»
  for (const s of S.shipments) {
    assert.equal(app.awaitsReceipt(s), app.Ships.awaitingReceipt(S, s));
    assert.equal(app.isLate(s), app.Ships.isLate(s, new Date(), S));
  }
});

test('демо: схема видит все пять точек и перегоны, у Читы есть груз на таможне; сумма по схеме равна непринятым поставкам', () => {
  const app = load();
  const S = app.S;
  const m = app.Ships.mapCounts(S);
  for (const n of app.Ships.NODES) assert.ok(m.nodes[n.id], `нет счётчика ${n.id}`);
  assert.ok(m.nodes.chita.customs.ships >= 3, 'на таможне в Чите есть поставки');
  assert.equal(m.nodes.chita.customs.ships, S.shipments.filter(s => s.stageId === 'customs').length);
  const open = S.shipments.filter(s => s.dir === 'in' && !app.Pipes.isFinal(S, s.pipeId, s.stageId));
  const total = Object.values(m.nodes).reduce((a, x) => a + x.ships, 0) + Object.values(m.legs).reduce((a, x) => a + x.ships, 0);
  assert.equal(total, open.length, 'каждая непринятая поставка — ровно в одном месте схемы');
  const units = Object.values(m.nodes).reduce((a, x) => a + x.units, 0) + Object.values(m.legs).reduce((a, x) => a + x.units, 0);
  assert.equal(units, open.reduce((a, s) => a + s.items.reduce((b, i) => b + i.qty, 0), 0));
  assert.ok(Object.keys(m.legs).length >= 4, 'перегонов на схеме мало');
});

// ——— сохранение ———
test('демо-поставки переживают сохранение: маршрут, положение, правила и даты; прежняя ревизия сохранения уходит в пользу демо', () => {
  const app = load();
  const back = app.Store.load(app.Store.dump(app.S).text);
  assert.ok(back, 'сохранение не прочиталось');
  assert.equal(back.shipments.length, app.S.shipments.length);
  const x = back.shipments.find(s => s.route), y = app.S.shipments.find(s => s.id === x.id);
  assert.deepEqual(plain(x.route), plain(y.route));
  assert.deepEqual(plain(x.pos), plain(y.pos));
  assert.equal(x.eta.getTime(), y.eta.getTime());
  assert.equal(x.history[0].at.getTime(), y.history[0].at.getTime());
  assert.equal(back.shipRules.length, 3);
  const prev = JSON.parse(app.Store.dump(app.S).text);
  prev.rev = 3;
  assert.equal(app.Store.load(JSON.stringify(prev)), null, 'сохранение с поставками прежней формы (ревизия 3) прочиталось');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Раздел «Поставки и перевозки» на большом объёме (таск 03, часть 2): таблица, воронка, позиции «3 + N»,
// шкала маршрута, ручная смена этапа. Виды зовутся на демо-наборе (125 едущих к нам поставок, 27 из них приняты).
// Ожидаемое — из состояния и спецификации, а не из кода вида: «принята» = есть received.
// ═══════════════════════════════════════════════════════════════════════════════
const shipIds = html => Array.from(html.matchAll(/data-ship="([^"]+)"/g), m => m[1]);
const counter = html => { const m = html.match(/Показано (\d+) из (\d+)/); return m ? [Number(m[1]), Number(m[2])] : null; };
const incoming = app => app.S.shipments.filter(s => s.dir === 'in');
const openIncoming = app => incoming(app).filter(s => !s.received);
const unitsOf = s => s.items.reduce((a, i) => a + i.qty, 0);
const ru = n => Number(n).toLocaleString('ru-RU');
const selectEl = (value, k) => ({ value, dataset: { k } });

test('таблица: «Показано N из M», страница не больше size строк; M — все не принятые, страницы листаются', () => {
  const app = load();
  const total = openIncoming(app).length;
  assert.ok(total > 90, 'в демо должно быть много едущих поставок');
  const h = app.VIEWS.logistics();
  const size = 25;
  assert.deepEqual(counter(h), [size, total]);
  assert.equal(shipIds(h).length, size, 'строк на странице — ровно size');
  assert.ok(shipIds(h).every(id => openIncoming(app).some(s => s.id === id)), 'в таблице по умолчанию только не принятые');
  // вторая страница — другие поставки
  app.A['ship-page']({ dataset: { p: '2' } });
  const h2 = app.VIEWS.logistics();
  assert.equal(shipIds(h2).length, size);
  assert.ok(!shipIds(h2).some(id => shipIds(h).includes(id)), 'вторая страница повторила первую');
  assert.ok(h2.includes('Страница 2 из ' + Math.ceil(total / size)));
  // последняя страница — остаток
  app.A['ship-page']({ dataset: { p: '99' } });
  assert.equal(counter(app.VIEWS.logistics())[0], total - size * (Math.ceil(total / size) - 1));
  // размер страницы из настройки вида
  app.ON.change['ship-size']({ value: '50' });
  assert.deepEqual(counter(app.VIEWS.logistics()), [50, total]);
  assert.equal(shipIds(app.VIEWS.logistics()).length, 50);
});

test('таблица: фильтры по этапу, городу и поиск сужают список и пересчитывают M', () => {
  const app = load();
  const all = incoming(app);
  // этап «Таможня» (среди всех, включая принятые)
  app.ON.change['ship-f'](selectEl('customs', 'stage'));
  const custom = all.filter(s => s.stageId === 'customs');
  let h = app.VIEWS.logistics();
  assert.equal(counter(h)[1], custom.length);
  assert.ok(shipIds(h).length > 0 && shipIds(h).every(id => custom.some(s => s.id === id)), 'в таблице чужой этап');
  // плюс город: пересечение
  app.ON.change['ship-f'](selectEl('msk', 'city'));
  const both = custom.filter(s => s.cityId === 'msk');
  assert.ok(both.length > 0 && both.length < custom.length, 'нужен набор, где город действительно сужает');
  h = app.VIEWS.logistics();
  assert.equal(counter(h)[1], both.length);
  assert.deepEqual(shipIds(h).sort(), plain(both.map(s => s.id)).sort());
  // сбросили этап на «все» — берутся все поставки города, в том числе принятые
  app.ON.change['ship-f'](selectEl('', 'stage'));
  assert.equal(counter(app.VIEWS.logistics())[1], all.filter(s => s.cityId === 'msk').length);
  // поиск по номеру
  app.ON.change['ship-f'](selectEl('', 'city'));
  app.ON.input['ship-q']({ value: all[10].id });
  const found = shipIds(app.byId('ship-body').innerHTML);
  assert.ok(found.includes(all[10].id) && found.length < 5, `по номеру нашлось ${found.length}`);
});

test('таблица: сортировка по колонке «Штук» — по возрастанию, второй щелчок — по убыванию', () => {
  const app = load();
  app.A['ship-sort']({ dataset: { k: 'units' } });
  const up = shipIds(app.VIEWS.logistics()).map(id => unitsOf(app.S.shipments.find(s => s.id === id)));
  assert.ok(up.length > 10 && up.every((x, i) => i === 0 || up[i - 1] <= x), `по возрастанию: ${up}`);
  assert.equal(up[0], Math.min(...openIncoming(app).map(unitsOf)), 'сверху — самая маленькая поставка');
  app.A['ship-sort']({ dataset: { k: 'units' } });
  const down = shipIds(app.VIEWS.logistics()).map(id => unitsOf(app.S.shipments.find(s => s.id === id)));
  assert.ok(down.every((x, i) => i === 0 || down[i - 1] >= x), `по убыванию: ${down}`);
  assert.equal(down[0], Math.max(...openIncoming(app).map(unitsOf)), 'сверху — самая большая поставка');
});

test('настройка вида: колонки, плотность, группировка и размер страницы переживают сохранение и перезагрузку', () => {
  const app = load();
  assert.ok(app.VIEWS.logistics().includes('>Штук<') && app.VIEWS.logistics().includes('Юрлицо и город'));
  app.ON.change['ship-col']({ dataset: { k: 'units' }, checked: false });
  app.ON.change['ship-col']({ dataset: { k: 'entity' }, checked: false });
  app.ON.change['ship-col']({ dataset: { k: 'carrier' }, checked: true });
  app.A['ship-density']({ dataset: { d: 'dense' } });
  app.ON.change['ship-group']({ value: 'city' });
  app.ON.change['ship-size']({ value: '50' });
  const before = app.VIEWS.logistics();
  assert.ok(!before.includes('>Штук<') && !before.includes('Юрлицо и город'), 'скрытые колонки остались');
  assert.ok(before.includes('Перевозчик') && before.includes('stbl dense'), 'новая колонка или плотность не применились');
  // перезагрузка страницы: то, что записано в браузер, читает новый запуск
  const again = load({ storage: { [app.Store.KEY]: app.Store.dump(app.S).text } });
  const pr = plain(again.S.prefs.ship);
  assert.deepEqual([pr.density, pr.group, pr.size], ['dense', 'city', 50]);
  assert.ok(pr.cols.includes('carrier') && !pr.cols.includes('units') && !pr.cols.includes('entity') && pr.cols.includes('number'));
  const after = again.VIEWS.logistics();
  assert.ok(!after.includes('>Штук<') && after.includes('Перевозчик') && after.includes('stbl dense'));
  assert.ok(after.includes('class="sgrp"'), 'группировка по городам пропала после перезагрузки');
  assert.equal(counter(after)[1], openIncoming(again).length);
});

test('группировка: заголовки групп с числом поставок; на странице не больше size строк; M не меняется', () => {
  const app = load();
  const total = openIncoming(app).length;
  app.ON.change['ship-group']({ value: 'stage' });
  const h = app.VIEWS.logistics();
  assert.deepEqual(counter(h), [25, total]);
  const heads = Array.from(h.matchAll(/class="sgrp"><td[^>]*><b>([^<]+)<\/b> <span class="muted">· (\d+)/g), m => [m[1], Number(m[2])]);
  assert.ok(heads.length >= 2, 'нет заголовков групп');
  // порядок групп — как этапы воронки; число — всех поставок этапа, не только на странице
  assert.equal(heads[0][0], 'Заказано');
  assert.equal(heads[0][1], openIncoming(app).filter(s => s.stageId === 'ordered').length);
  // по городу: подряд идут поставки одного города
  app.ON.change['ship-group']({ value: 'city' });
  const rows = shipIds(app.VIEWS.logistics()).map(id => app.S.shipments.find(s => s.id === id).cityId);
  const changes = rows.filter((c, i) => i && c !== rows[i - 1]).length;
  assert.equal(changes, new Set(rows).size - 1, 'города перемешаны внутри страницы');
});

test('позиции «3 + ещё N»: в строке ровно три позиции и «+N» при N>0, при N=0 кнопки нет', () => {
  const app = load();
  const pr = app.shipPrefs(), now = new Date();
  const big = app.S.shipments.find(s => s.items.length === 150);
  assert.ok(big, 'в демо нет поставки со 150 позициями');
  const row = app.shipRow(big, pr, now);
  assert.equal((row.match(/class="s-it"/g) || []).length, 3);
  assert.ok(row.includes('>+147<'), 'нет «+147»');
  assert.ok(row.includes(`data-act="ship-items" data-id="${big.id}"`));
  const sized = n => app.S.shipments.find(s => s.dir === 'in' && s.items.length === n);
  const three = sized(3), two = sized(2), four = sized(4);
  assert.equal((app.shipRow(three, pr, now).match(/class="s-it"/g) || []).length, 3);
  assert.ok(!app.shipRow(three, pr, now).includes('s-more'), 'у трёх позиций «+N» лишний');
  assert.equal((app.shipRow(two, pr, now).match(/class="s-it"/g) || []).length, 2);
  assert.ok(!app.shipRow(two, pr, now).includes('s-more'));
  assert.ok(app.shipRow(four, pr, now).includes('>+1<'));
  // и в карточке справа — тем же кодом
  const card = app.DRAWERS.ship(big.id).body;
  assert.equal((card.match(/class="s-it"/g) || []).length, 3);
  assert.ok(card.includes('>+147<'));
});

test('окно позиций: все 150 позиций и итог штук; поиск по названию сужает список и итог; список прокручивается внутри окна', () => {
  const app = load();
  const big = app.S.shipments.find(s => s.items.length === 150);
  const html = app.MODALS.shipItems(big.id);
  assert.equal((html.match(/<tr><td class="num muted">/g) || []).length, 150, 'в окне не все позиции');
  assert.ok(html.includes(`150 позиций · штук ${ru(unitsOf(big))}`), `итог штук: ${html.match(/si-sum[^<]*/)}`);
  assert.ok(html.includes('class="si-scroll"'), 'список не в прокручиваемом блоке');
  // поиск
  const name = id => app.S.products.find(p => p.id === id).name.toLowerCase();
  const hit = big.items.filter(i => name(i.productId).includes('панел'));
  assert.ok(hit.length > 0 && hit.length < 150);
  app.ON.input['ship-items-q']({ value: 'Панел', dataset: { id: big.id } });
  const part = app.byId('si-body').innerHTML;
  assert.equal((part.match(/<tr><td class="num muted">/g) || []).length, hit.length);
  assert.ok(part.includes(`Найдено ${hit.length} из 150 · штук ${ru(hit.reduce((a, i) => a + i.qty, 0))} из ${ru(unitsOf(big))}`));
  // ничего не найдено
  app.ON.input['ship-items-q']({ value: 'нет-такого-товара', dataset: { id: big.id } });
  assert.ok(app.byId('si-body').innerHTML.includes('Ничего не нашлось'));
});

test('шкала маршрута: пройденные точки и «где сейчас» отмечены, дни до прибытия; опоздание видно', () => {
  const app = load();
  const s = app.S.shipments.find(x => x.dir === 'in' && !x.received && x.route.length === 3 && x.pos.i === 1 && x.pos.t === 0);
  assert.ok(s, 'нужна поставка, стоящая в Чите, маршрут из трёх точек');
  const now = new Date(2026, 9, 31, 12);
  s.eta = new Date(2026, 10, 4, 12);  // через 4 дня
  let h = app.shipScale(s, now, true);
  assert.equal((h.match(/class="rs-dot on/g) || []).length, 2, 'пройдены Китай и Чита');
  assert.equal((h.match(/rs-dot on cur/g) || []).length, 1, 'ровно одна точка «здесь»');
  assert.ok(h.includes('через 4 дня') && !h.includes('rs late'), 'до прибытия 4 дня, не опаздывает');
  assert.ok(['Китай', 'Чита', 'Иркутск'].every(n => h.includes(`>${n}</span>`)), 'в карточке подписаны точки маршрута');
  s.eta = new Date(2026, 9, 28, 12);  // три дня назад
  h = app.shipScale(s, now, false);
  assert.ok(h.includes('rs late') && h.includes('опаздывает на 3 дня'), h);
  // на перегоне — бегунок между точками
  const leg = app.S.shipments.find(x => x.dir === 'in' && !x.received && x.pos.t > 0);
  assert.ok(app.shipScale(leg, now, false).includes('rs-mark'));
  // у отгрузки клиенту маршрута нет — последняя отметка вместо выдуманной шкалы
  const out = app.S.shipments.find(x => x.dir === 'out');
  assert.ok(!app.shipScale(out, now, false).includes('rs-line'));
});

test('воронка: колонки — этапы воронки поставок, включая «Таможню» и «Перевалку в Чите»; карточки с номером, штуками, сроком и опозданием', () => {
  const app = load();
  app.A['ship-view']({ dataset: { v: 'funnel' } });
  const h = app.VIEWS.logistics();
  const stages = app.Pipes.of(app.S, 'ships').find(p => p.id === 'ships').stages;
  assert.equal((h.match(/data-scol="/g) || []).length, stages.length);
  for (const name of ['Таможня', 'Перевалка в Чите']) assert.ok(h.includes(`<span>${name}</span>`), `нет колонки «${name}»`);
  assert.equal((h.match(/class="scard/g) || []).length, incoming(app).length, 'на карточках — все едущие поставки');
  const col = id => h.split(`data-scol="${id}"`)[1].split('</section>')[0];
  assert.ok(col('customs').includes(`${incoming(app).filter(s => s.stageId === 'customs').length} · `), 'в заголовке колонки число поставок');
  assert.ok(h.includes('draggable="true"') && h.includes('data-drag="'), 'карточки открытых поставок тащатся');
  assert.ok(h.includes('опаздывает'), 'опоздание на карточке видно');
  assert.ok(h.includes('class="scol-b"'), 'колонка прокручивается внутри себя');
  assert.ok(!col('inStock').includes('draggable'), 'принятые поставки не двигаются руками');
});

// перетаскивание: событие drop на документе, как в браузере
function dropOn(app, shipId, stageId) {
  const col = { dataset: { scol: stageId }, classList: { remove() {}, add() {} } };
  let prevented = false;
  app.document.dispatchEvent({
    type: 'drop', target: { closest: sel => (sel === '[data-scol]' ? col : null) },
    dataTransfer: { getData: () => shipId }, preventDefault() { prevented = true; },
  });
  return prevented;
}

test('воронка: перетаскивание в другую колонку меняет этап через Ships.setStage — история с источником «вручную» и уведомление «Перевозки»', () => {
  const app = load();
  const s = app.S.shipments.find(x => x.dir === 'in' && x.stageId === 'shipped');
  const notes = app.S.notes.length, hist = s.history.length;
  assert.equal(dropOn(app, s.id, 'customs'), true);
  assert.equal(s.stageId, 'customs');
  assert.deepEqual(plain(s.pos), { i: 1, t: 0 }, 'груз встал в Чите: положение двигается вместе с этапом');
  assert.equal(s.history.length, hist + 1);
  const h = s.history[s.history.length - 1];
  assert.equal(h.source, 'вручную');
  assert.equal(h.by, app.S.me);
  assert.ok(h.text.includes('Таможня') && h.text.includes('Чита'), h.text);
  assert.equal(app.S.notes.length, notes + 1);
  const n = app.S.notes[0];
  assert.equal(n.kind, 'ship');
  assert.ok(n.text.includes(s.id) && n.text.includes('Таможня') && n.text.includes('Чита'), `что-где: ${n.text}`);
  assert.ok(n.to.length >= 5, 'уведомление — всем сотрудникам');
  // в ту же колонку — ничего; в «На склад» входящую руками не ставят; чужой этап — ничего
  dropOn(app, s.id, 'customs'); dropOn(app, s.id, 'inStock'); dropOn(app, s.id, 'нет-такого');
  assert.equal(s.stageId, 'customs');
  assert.equal(s.history.length, hist + 1);
  assert.equal(app.S.notes.length, notes + 1);
});

test('смена этапа выпадающим списком в строке и в карточке — тоже через ядро; закрытая поставка не меняется', () => {
  const app = load();
  const s = app.S.shipments.find(x => x.dir === 'in' && x.stageId === 'ordered');
  const row = app.shipRow(s, app.shipPrefs(), new Date());
  assert.ok(row.includes(`data-on="ship-stage" data-id="${s.id}"`), 'в строке нет списка этапов');
  assert.ok(row.includes('disabled>На складе — ставит склад'), 'на склад входящую руками не ставят');
  assert.ok(app.DRAWERS.ship(s.id).body.includes('data-on="ship-stage"'), 'в карточке нет списка этапов');
  const hist = s.history.length;
  app.ON.change['ship-stage']({ dataset: { id: s.id }, value: 'transship' });
  assert.equal(s.stageId, 'transship');
  assert.equal(s.history[hist].source, 'вручную');
  assert.equal(app.S.notes[0].kind, 'ship');
  const done = app.S.shipments.find(x => x.dir === 'in' && x.received);
  assert.ok(!app.shipRow(done, app.shipPrefs(), new Date()).includes('data-on="ship-stage"'), 'у принятой поставки списка этапов нет');
  const was = done.stageId, n = app.S.notes.length;
  app.ON.change['ship-stage']({ dataset: { id: done.id }, value: 'ordered' });
  assert.equal(done.stageId, was);
  assert.equal(app.S.notes.length, n);
});

test('форма «Отметить этап» идёт через Ships.setStage: этап, положение на маршруте, история с источником, уведомление; срок и комментарий — отдельными отметками', () => {
  const app = load();
  const s = app.S.shipments.find(x => x.dir === 'in' && x.stageId === 'toBorder');
  const set = (id, v) => { app.byId(id).value = v; };
  const notes = app.S.notes.length, hist = s.history.length;
  set('st-stage', 'customs'); set('st-eta', app.iso(s.eta)); set('st-note', '');
  app.FORMS.stage({ dataset: { id: s.id } });
  assert.equal(s.stageId, 'customs');
  assert.deepEqual(plain(s.pos), { i: 1, t: 0 });
  assert.equal(s.history.length, hist + 1, 'ровно одна отметка: этап');
  assert.equal(s.history[hist].source, 'вручную');
  assert.ok(s.history[hist].text.startsWith('Этап: «В пути до границы» → «Таможня»'), s.history[hist].text);
  assert.equal(app.S.notes.length, notes + 1);
  assert.equal(app.S.notes[0].kind, 'ship');
  // срок и комментарий
  const newEta = new Date(s.eta.getFullYear(), s.eta.getMonth(), s.eta.getDate() + 5);
  set('st-stage', 'transship'); set('st-eta', app.iso(newEta)); set('st-note', 'Водитель звонил');
  app.FORMS.stage({ dataset: { id: s.id } });
  assert.equal(s.stageId, 'transship');
  assert.equal(app.iso(s.eta), app.iso(newEta));
  const tail = s.history.slice(-3).map(h => h.text);
  assert.ok(tail[0].startsWith('Этап:') && tail[1].startsWith('Срок прихода: было') && tail[2] === 'Комментарий: Водитель звонил', tail.join(' | '));
  assert.ok(app.S.notes[0].text.includes(app.fD(newEta)), 'в уведомлении уже новая дата');
  assert.ok(s.history.slice(-3).every(h => h.source === 'вручную'));
  // на склад форма не ставит
  set('st-stage', 'inStock'); set('st-eta', app.iso(s.eta)); set('st-note', '');
  const len = s.history.length;
  app.FORMS.stage({ dataset: { id: s.id } });
  assert.equal(s.stageId, 'transship');
  assert.equal(s.history.length, len);
});

test('форма «Новая поставка»: маршрут Китай → Чита → город, положение, юрлицо; этап — через Ships.setStage', () => {
  const app = load();
  const set = (id, v) => { app.byId(id).value = v; };
  const pid = app.S.products[0].id;
  const form = { querySelectorAll: () => [{ querySelector: sel => (sel === 'select' ? { value: pid } : { value: '7' }) }] };
  set('ns-from', 'Поставщик-пример 9'); set('ns-city', 'msk'); set('ns-ent', 'npp'); set('ns-car', 'Отдельная машина');
  set('ns-doc', ''); set('ns-stage', 'customs'); set('ns-eta', '2026-12-01');
  const n = app.S.shipments.length, notes = app.S.notes.length;
  app.FORMS.ship(form);
  assert.equal(app.S.shipments.length, n + 1);
  const s = app.S.shipments[n];
  assert.deepEqual(plain(s.route), ['cn', 'chita', 'msk']);
  assert.equal(s.stageId, 'customs');
  assert.deepEqual(plain(s.pos), { i: 1, t: 0 }, 'на таможне груз стоит в Чите');
  assert.equal(s.entityId, 'npp'); assert.equal(s.cityId, 'msk');
  assert.equal(s.track, 'нет данных: номер накладной');
  assert.deepEqual(plain(s.items), [{ productId: pid, qty: 7 }]);
  assert.equal(s.history[0].source, 'вручную'); assert.equal(s.history[s.history.length - 1].source, 'вручную');
  assert.ok(s.history[s.history.length - 1].text.includes('Таможня'), 'этап записан ядром');
  assert.equal(app.S.notes.length, notes + 1, 'одно уведомление: о поставке на этом этапе');
  // с первого этапа — уведомление о новой поставке
  set('ns-stage', 'ordered');
  app.FORMS.ship(form);
  const t = app.S.shipments[n + 1];
  assert.equal(t.stageId, 'ordered');
  assert.ok(app.S.notes[0].text.startsWith(`Новая поставка ${t.id}`), app.S.notes[0].text);
});

test('карточка поставки: номер, поставщик с пометкой «пример», перевозчик и трек, юрлицо и город, шкала, история с источниками', () => {
  const app = load();
  const s = app.S.shipments.find(x => x.dir === 'in' && x.history.some(h => h.source === 'вручную') && x.history.some(h => h.source === 'автоматически: перевозчик'));
  assert.ok(s, 'в демо нет поставки с отметками вручную и от перевозчика');
  const d = app.DRAWERS.ship(s.id);
  assert.ok(d.kind.includes(s.id));
  assert.ok(d.title.includes(s.supplier) && d.title.includes('пример'), d.title);
  for (const part of [s.carrier, s.track, 'class="rs full', 'История отметок', 'вручную', 'автоматически: перевозчик']) {
    assert.ok(d.body.includes(part), `в карточке нет «${part}»`);
  }
  const e = app.Stock.entityName(app.S, s.entityId), c = app.Stock.cityName(app.S, s.cityId);
  assert.ok(d.body.includes(`<dd>${e}</dd>`) && d.body.includes(`<dd>${c}</dd>`), 'юрлицо и город поставки');
  // принятая — «автоматически: приёмка»
  const rec = app.S.shipments.find(x => x.received && x.history.some(h => h.source === 'автоматически: приёмка'));
  assert.ok(app.DRAWERS.ship(rec.id).body.includes('автоматически: приёмка'));
  // нет поставки — карточка не открывается
  assert.equal(app.DRAWERS.ship('нет-такой'), null);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Таск 03, кусок 3: схема маршрута, имитация перевозчика, «Настройки → Поставки», приёмка.
// Ожидаемое — из состояния до действия и посчитанное руками по этапам воронки поставок по умолчанию:
// «Заказано» и «Отгружено» — в Китае; «В пути до границы» — перегон Китай → Чита; «Таможня» и «Перевалка» — в Чите.
// ═══════════════════════════════════════════════════════════════════════════════
const textOf = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const digits = s => Number(String(s).replace(/\D/g, ''));
const mapView = (app, v = 'map') => { app.A['ship-view']({ dataset: { v } }); return app.VIEWS.logistics(); };
// кнопки точек: {id, ships, units, inner}; кнопки перегонов: {key, ships, units}
const mapChips = html => Array.from(html.matchAll(/<button[^>]*data-node="([^"]+)" data-ships="(\d+)" data-units="(\d+)"[^>]*>([\s\S]*?)<\/button>/g), m => ({ id: m[1], ships: Number(m[2]), units: Number(m[3]), inner: m[4] }));
const mapLegs = html => Array.from(html.matchAll(/<button[^>]*data-leg="([^"]+)" data-ships="(\d+)" data-units="(\d+)"[^>]*>([\s\S]*?)<\/button>/g), m => ({ key: m[1].replace(/&gt;/g, '>'), ships: Number(m[2]), units: Number(m[3]), inner: m[4] }));
const stageCount = (app, ...stages) => app.S.shipments.filter(s => s.dir === 'in' && !s.received && stages.includes(s.stageId));
const sumUnits = list => list.reduce((a, s) => a + s.items.reduce((b, i) => b + i.qty, 0), 0);

test('схема: пять точек с подписями из Ships.NODES, у Читы — «таможня и перевалка»; в переключателе третий вид «Схема»', () => {
  const app = load();
  const html = mapView(app);
  assert.ok(html.includes('data-v="map"') && html.includes('>Схема<'), 'в переключателе вида нет «Схемы»');
  assert.equal(app.shipPrefs().view, 'map');
  const chips = mapChips(html);
  assert.deepEqual(chips.map(c => c.id), ['cn', 'chita', 'irk', 'msk', 'krd']);
  for (const n of app.Ships.NODES) {
    const t = textOf(chips.find(c => c.id === n.id).inner);
    assert.ok(t.includes(n.name), `у точки нет названия «${n.name}»`);
    assert.ok(t.includes(n.label), `у точки «${n.name}» нет подписи «${n.label}»`);
  }
  assert.ok(textOf(chips.find(c => c.id === 'chita').inner).includes('таможня и перевалка'));
  assert.ok(!textOf(chips.find(c => c.id === 'irk').inner).includes('таможня'), 'таможня только у Читы');
  assert.ok(/<svg[^>]*viewBox="0 0 100 100"/.test(html), 'схема — встроенный SVG');
  assert.ok(!/(src|href)="https?:/.test(html.slice(html.indexOf('class="smap"'))), 'схема не должна тянуть внешние карты');
});

test('схема: числа у точек, перегонов и «на таможне» — те же, что в Ships.mapCounts, и сходятся с поставками, посчитанными руками', () => {
  const app = load();
  const html = mapView(app);
  const chips = mapChips(html), legs = mapLegs(html), want = app.Ships.mapCounts(app.S, {});
  // 1) значения на экране — из mapCounts: и в атрибутах, и в видимом тексте
  for (const c of chips) {
    assert.deepEqual([c.ships, c.units], [want.nodes[c.id].ships, want.nodes[c.id].units], `число у точки ${c.id}`);
    const b = Array.from(c.inner.matchAll(/<b>([^<]+)<\/b>/g), m => digits(m[1]));
    assert.deepEqual(b, [c.ships, c.units], `видимые числа у точки ${c.id}`);
  }
  assert.deepEqual(legs.map(l => l.key).sort(), Object.keys(want.legs).sort());
  for (const l of legs) assert.deepEqual([l.ships, l.units], [want.legs[l.key].ships, want.legs[l.key].units], `число на перегоне ${l.key}`);
  // 2) и они верны: независимый подсчёт по этапам
  const at = id => chips.find(c => c.id === id);
  const cn = stageCount(app, 'ordered', 'shipped'), border = stageCount(app, 'toBorder'), cust = stageCount(app, 'customs'), chita = stageCount(app, 'customs', 'transship');
  assert.ok(cn.length > 0 && border.length > 0 && cust.length > 0, 'в демо нет поставок для проверки');
  assert.deepEqual([at('cn').ships, at('cn').units], [cn.length, sumUnits(cn)]);
  const leg = legs.find(l => l.key === 'cn>chita');
  assert.deepEqual([leg.ships, leg.units], [border.length, sumUnits(border)]);
  assert.deepEqual([at('chita').ships, at('chita').units], [chita.length, sumUnits(chita)]);
  // всё, что едет и не принято, стоит ровно в одном месте: сумма по схеме = все не принятые
  const open = stageCount(app, 'ordered', 'shipped', 'toBorder', 'customs', 'transship', 'toStock', 'arrived');
  assert.equal(open.length, app.S.shipments.filter(s => s.dir === 'in' && !s.received).length, 'в демо есть этап вне списка');
  assert.equal(chips.reduce((a, c) => a + c.ships, 0) + legs.reduce((a, l) => a + l.ships, 0), open.length);
  assert.equal(chips.reduce((a, c) => a + c.units, 0) + legs.reduce((a, l) => a + l.units, 0), sumUnits(open));
  // у Читы отдельно — сколько на таможне
  const cu = html.match(/data-customs-ships="(\d+)" data-customs-units="(\d+)"/);
  assert.deepEqual([Number(cu[1]), Number(cu[2])], [cust.length, sumUnits(cust)]);
  assert.ok(textOf(html).includes(`на таможне: ${cust.length}`));
  assert.ok(textOf(html).includes(`На схеме ${open.length} `), 'общий счётчик схемы');
});

test('схема: фильтры панели (поставщик) сужают числа; для отгрузок клиентам схемы нет', () => {
  const app = load();
  mapView(app);
  const sup = 'Поставщик-пример 3';
  app.ON.change['ship-f']({ dataset: { k: 'supplier' }, value: sup });
  const html = app.VIEWS.logistics(), chips = mapChips(html), legs = mapLegs(html);
  const mine = app.S.shipments.filter(s => s.dir === 'in' && !s.received && s.supplier === sup);
  assert.ok(mine.length > 3 && mine.length < incoming(app).length / 2, 'для проверки нужен поставщик с частью поставок');
  assert.equal(chips.reduce((a, c) => a + c.ships, 0) + legs.reduce((a, l) => a + l.ships, 0), mine.length);
  assert.equal(chips.reduce((a, c) => a + c.units, 0) + legs.reduce((a, l) => a + l.units, 0), sumUnits(mine));
  app.A['log-tab']({ dataset: { tab: 'out' } });
  const out = app.VIEWS.logistics();
  assert.ok(!out.includes('data-node='), 'у отгрузок клиентам точек быть не должно');
  assert.ok(out.includes('Схема показывает поставки, которые едут к нам'));
});

test('схема: нажатие на точку, на перегон и на «на таможне» включает фильтр и открывает таблицу с тем же числом', () => {
  const app = load();
  const html = mapView(app), chips = mapChips(html), legs = mapLegs(html);
  const click = (k, stage) => app.A['ship-map']({ dataset: { k, ...(stage ? { stage } : {}) } });
  // точка
  const irk = chips.find(c => c.id === 'irk');
  assert.ok(irk.ships > 0);
  click('irk');
  assert.equal(app.S.ui.ships.node, 'irk', 'фильтр «Точка» не включился');
  assert.equal(app.shipPrefs().view, 'table', 'вид не переключился на таблицу');
  let h = app.VIEWS.logistics();
  assert.equal(counter(h)[1], irk.ships, 'в таблице не то число, что на схеме');
  assert.ok(h.includes('<option value="irk" selected>'), 'в панели фильтров не отмечена точка');
  // перегон
  mapView(app);
  const leg = legs.find(l => l.key === 'cn>chita');
  click(leg.key);
  assert.equal(app.S.ui.ships.node, 'cn>chita');
  h = app.VIEWS.logistics();
  assert.equal(counter(h)[1], leg.ships);
  assert.ok(shipIds(h).every(id => app.S.shipments.find(s => s.id === id).stageId === 'toBorder'), 'на перегоне Китай → Чита — только «В пути до границы»');
  // таможня в Чите: точка + этап
  mapView(app);
  click('chita', 'customs');
  h = app.VIEWS.logistics();
  assert.equal(counter(h)[1], stageCount(app, 'customs').length);
  assert.ok(shipIds(h).every(id => app.S.shipments.find(s => s.id === id).stageId === 'customs'));
  // фильтр сбрасывается обычной кнопкой «Сбросить»
  app.A['ship-reset']();
  assert.equal(counter(app.VIEWS.logistics())[1], openIncoming(app).length);
});

test('схема: грузы движутся по перегонам, где есть поставки; при «меньше движения» точки стоят, а числа остаются', () => {
  const app = load();
  const html = mapView(app), legs = mapLegs(html);
  const dots = html.match(/class="sm-dot"/g) || [];
  assert.ok(dots.length > 0, 'грузов на схеме нет');
  assert.equal(dots.length, legs.filter(l => l.ships > 0).reduce((a, l) => a + Math.min(4, Math.ceil(l.ships / 5)), 0), 'число грузов — по поставкам на перегоне');
  // у каждого груза есть и начало, и конец пути, и точка покоя
  assert.ok(Array.from(html.matchAll(/<i class="sm-dot" style="([^"]+)"/g)).every(m => ['--x1', '--y1', '--x2', '--y2', '--xm', '--ym', '--dur', '--dl'].every(v => m[1].includes(v + ':'))));
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'css', '54-ships.css'), 'utf8');
  assert.ok(/@keyframes sm-run/.test(css) && /animation:sm-run/.test(css), 'движение задано анимацией');
  assert.ok(/@media \(prefers-reduced-motion:reduce\)\{\.sm-dot\{animation:none/.test(css), 'при «меньше движения» анимации нет');
  // счётчики не зависят от движения: они в тексте и в атрибутах
  assert.ok(mapChips(html).every(c => textOf(c.inner).includes(String(c.ships))));
});

test('имитация перевозчика: «Имитация: пришёл статус от перевозчика» двигает ровно одну поставку в пути, история — «автоматически: перевозчик», уведомление всем', () => {
  const app = load();
  const sim = app.SIMS.find(s => s.id === 'carrier');
  assert.ok(sim, 'в SIMS нет имитации перевозчика');
  assert.equal(sim.label, 'Имитация: пришёл статус от перевозчика');
  const snap = () => app.S.shipments.map(s => [s.id, s.stageId, s.pos && s.pos.i, s.pos && s.pos.t, s.history.length].join('|'));
  const before = snap(), notes = app.S.notes.length;
  sim.run();
  const after = snap();
  const changed = after.map((x, i) => (x !== before[i] ? i : -1)).filter(i => i >= 0);
  assert.equal(changed.length, 1, 'сдвинуться должна ровно одна поставка');
  const s = app.S.shipments[changed[0]], was = before[changed[0]].split('|')[1];
  assert.equal(s.dir, 'in');
  assert.ok(['shipped', 'toBorder', 'customs', 'transship', 'toStock'].includes(was), `двигается поставка в пути, а не «${was}»`);
  const h = s.history[s.history.length - 1];
  assert.equal(h.source, 'автоматически: перевозчик');
  assert.equal(h.auto, true);
  assert.equal(h.by, null, 'перевозчик — не сотрудник');
  assert.ok(h.text.includes(app.Pipes.stage(app.S, s.pipeId, s.stageId).name), h.text);
  assert.equal(app.S.notes.length, notes + 1);
  assert.equal(app.S.notes[0].kind, 'ship');
  assert.ok(app.S.notes[0].text.includes(s.id));
  // карточка поставки: кнопка и пометка в истории
  const d = app.DRAWERS.ship(s.id).body;
  assert.ok(d.includes('data-act="ship-carrier"') && d.includes('Имитация: статус от перевозчика'));
  assert.ok(d.includes('автоматически: перевозчик'));
  // у принятой и у ждущей приёмки кнопки нет
  const rec = app.S.shipments.find(x => x.received), arr = app.S.shipments.find(x => x.dir === 'in' && x.stageId === 'arrived');
  assert.ok(!app.DRAWERS.ship(rec.id).body.includes('data-act="ship-carrier"'));
  assert.ok(!app.DRAWERS.ship(arr.id).body.includes('data-act="ship-carrier"'));
});

test('имитация перевозчика из карточки: груз встаёт на следующий этап плана (В пути до границы → Таможня); «Заказано» кнопки не получает', () => {
  const app = load();
  const s = app.S.shipments.find(x => x.dir === 'in' && x.stageId === 'toBorder');
  const o = app.S.shipments.find(x => x.dir === 'in' && x.stageId === 'ordered');
  const hist = s.history.length;
  app.A['ship-carrier']({ dataset: { id: s.id } });
  assert.equal(s.stageId, 'customs');
  assert.deepEqual(plain(s.pos), { i: 1, t: 0 }, 'груз прибыл в Читу');
  assert.equal(s.history.length, hist + 1);
  assert.equal(s.history[hist].source, 'автоматически: перевозчик');
  assert.ok(s.history[hist].text.includes('Таможня') && s.history[hist].text.includes('Чита'), s.history[hist].text);
  assert.ok(!app.DRAWERS.ship(o.id).body.includes('data-act="ship-carrier"'), 'до отгрузки перевозчик ничего не сообщает');
});

test('«Настройки → Поставки»: вкладка есть при праве settings и нет без него; правила показаны словами событий', () => {
  const app = load();
  assert.ok(app.settingsTabs().some(t => t.id === 'ships' && t.label === 'Поставки'), 'у директора нет вкладки «Поставки»');
  const html = app.SETTINGS_TABS.find(t => t.id === 'ships').render();
  const rules = app.S.shipRules;
  assert.ok(rules.length >= 3);
  for (const r of rules) assert.ok(html.includes(`data-rule="${r.id}"`), `нет правила ${r.id}`);
  for (const w of ['принято на складе', 'таможня пройдена', 'перевозчик: груз в точке Иркутск']) assert.ok(html.includes(`>${w}</option>`), `нет события «${w}»`);
  // третье правило демо выключено: переключатель без «checked»
  const row = id => html.split('<li ').find(x => x.includes(`data-rule="${id}"`));
  assert.ok(row('sr1').includes('checked') && !row('sr3').includes('checked'));
  for (const p of ['p2', 'p3', 'p4', 'p5', 'p6', 'p7']) {
    app.setMe(p);
    assert.ok(!app.settingsTabs().some(t => t.id === 'ships'), `у ${p} не должно быть вкладки «Поставки»`);
  }
});

test('«Настройки → Поставки»: правила добавляются, включаются и выключаются, удаляются; перевозчик запускает правило, выключенное не срабатывает', () => {
  const app = load();
  const S = app.S, el = id => app.document.getElementById(id);
  const n0 = S.shipRules.length;
  // добавить: «перевозчик: груз в точке Чита» → «Перевалка в Чите»
  el('sr-new-when').value = 'carrier:chita'; el('sr-new-then').value = 'transship';
  app.FORMS['ship-rule-add']({});
  assert.equal(S.shipRules.length, n0 + 1);
  const rule = S.shipRules[n0];
  assert.deepEqual(plain({ on: rule.on, when: rule.when, then: rule.then }), { on: true, when: 'carrier:chita', then: 'transship' });
  assert.equal(new Set(S.shipRules.map(r => r.id)).size, n0 + 1, 'id правил не повторяются');
  el('sr-new-when').value = 'carrier:chita'; el('sr-new-then').value = 'transship';
  app.FORMS['ship-rule-add']({});
  assert.equal(S.shipRules.length, n0 + 1, 'то же правило добавилось второй раз');
  // срабатывание: поставка «В пути до границы» приходит в Читу
  const a = S.shipments.find(x => x.dir === 'in' && x.stageId === 'toBorder');
  const notes = S.notes.length;
  app.A['ship-carrier']({ dataset: { id: a.id } });
  assert.equal(a.stageId, 'transship', 'правило не поставило этап');
  const h = a.history.slice(-2);
  assert.equal(h[0].source, 'автоматически: перевозчик');
  assert.ok(h[0].text.includes('Таможня'));
  assert.ok(h[1].source.startsWith('правило: ') && h[1].source.includes('перевозчик: груз в точке Чита') && h[1].source.includes('Перевалка в Чите'), h[1].source);
  assert.equal(h[1].auto, true);
  assert.equal(S.notes.length, notes + 2, 'шаг перевозчика и правило — по уведомлению «Перевозки»');
  // выключить — второй груз встаёт на «Таможню» и остаётся там
  app.ON.change['ship-rule-on']({ dataset: { id: rule.id }, checked: false });
  assert.equal(rule.on, false);
  const b = S.shipments.find(x => x.dir === 'in' && x.stageId === 'toBorder');
  app.A['ship-carrier']({ dataset: { id: b.id } });
  assert.equal(b.stageId, 'customs', 'выключенное правило сработало');
  assert.ok(!b.history.some(x => String(x.source).startsWith('правило')));
  // смена этапа и события в списке
  app.ON.change['ship-rule-then']({ dataset: { id: rule.id }, value: 'toStock' });
  app.ON.change['ship-rule-when']({ dataset: { id: rule.id }, value: 'customs' });
  assert.deepEqual(plain({ when: rule.when, then: rule.then }), { when: 'customs', then: 'toStock' });
  // удалить
  app.A['ship-rule-del']({ dataset: { id: rule.id } });
  assert.equal(S.shipRules.length, n0);
  assert.ok(!S.shipRules.some(r => r.id === rule.id));
  // правила переживают сохранение
  assert.equal(app.Store.load(app.Store.dump(S).text).shipRules.length, n0);
});

// ——— приёмка ———
// Якорная поставка П-1044 из демо: ждёт приёмки в Иркутске, пять позиций (500, 500, 200, 6, 10 шт),
// юрлицо ИП, город Иркутск. Под неё резервы: Д-318 (Смирнова Елена, MAX, менеджер p2) и Д-311 (Иванов Сергей, Telegram, менеджер p2).
// Менеджеры и директор в демо-команде: p1, p2, p3, p9, p10; логист p6; кладовщик p5 принимает.
const rcvCell_ = (app, pid, e, c) => app.Stock.grid(app.S, pid).cell(e, c) ?? 0;
const badgeOf = (app, id) => app.NAV.find(n => n.id === id).badge();

test('приёмка: «ждёт приёмки» — одно число: бейдж меню, список приёмки и Ships.awaitingReceipt сходятся с поставками на этапе «Прибыло»', () => {
  const app = load();
  app.setMe('p5');
  // независимо: входящие, не принятые, на этапе «Прибыло в город»
  const hand = app.S.shipments.filter(s => s.dir === 'in' && !s.received && s.stageId === 'arrived').map(s => s.id).sort();
  assert.ok(hand.length > 5);
  assert.deepEqual(app.Ships.awaitingReceipt(app.S).map(s => s.id).sort(), hand);
  assert.deepEqual(app.pendingRcv().map(s => s.id).sort(), hand, 'список приёмки не из Ships.awaitingReceipt');
  assert.equal(badgeOf(app, 'receiving'), hand.length);
  const html = app.VIEWS.receiving();
  assert.equal((html.match(/name="rcv-ship"/g) || []).length, hand.length, 'в списке приёмки не столько же поставок');
  // выбор поставки из списка
  app.ON.change['rcv-ship']({ value: 'П-1041' });
  assert.equal(app.S.rcv.shipId, 'П-1041', 'выбрать можно любую из ждущих');
});

test('приёмка: товар ложится на выбранные юрлицо и город, поставка встаёт на «На складе» через ядро, все менеджеры и директор получают уведомление', () => {
  const app = load(), S = app.S;
  app.setMe('p5');
  const sh = S.shipments.find(s => s.id === 'П-1044');
  const [i0, i1, i2, i3, i4] = sh.items;
  const waiting = badgeOf(app, 'receiving');
  app.initRcv(sh.id);
  // юрлицо и город — не те, что записаны в поставке (ИП, Иркутск)
  app.ON.change['rcv-entity']({ value: 'npp' });
  app.ON.change['rcv-city']({ value: 'msk' });
  // пересчёт: по двум позициям принято меньше, чем ждали
  app.ON.input['rcv-qty']({ dataset: { pid: i0.productId }, value: '480' });
  app.ON.input['rcv-qty']({ dataset: { pid: i3.productId }, value: '5' });
  const got = [480, 500, 200, 5, 10];
  // ожидаемое — из состояния до действия
  const was = sh.items.map(i => rcvCell_(app, i.productId, 'npp', 'msk'));
  const wasOther = rcvCell_(app, i1.productId, 'ip', 'irk');
  const movesBefore = S.moves.length, msgsBefore = S.msgs.length;
  // предпросмотр: то же число, что потом ляжет на склад
  const prev = app.rcvPreview(S.rcv);
  const plus = Array.from(prev.matchAll(/<b class="num">\+([^<]+)<\/b>/g), m => digits(m[1]));
  assert.deepEqual(plus, got, 'предпросмотр показывает не то, что принято');
  assert.ok(textOf(prev).includes('Добавится на склад: НПП, Москва'), 'в предпросмотре нет юрлица и города');
  assert.ok(textOf(prev).includes('Перейдёт на этап «На складе» (автоматически: приёмка)'));
  const chips = (prev.match(/class="chip">/g) || []).length;
  // подтверждение
  const at = new Date(2026, 9, 31, 15);
  const r = app.receiveShip('p5', at);
  assert.equal(r.ok, true);
  sh.items.forEach((it, k) => assert.equal(rcvCell_(app, it.productId, 'npp', 'msk'), was[k] + got[k], `остаток «${it.productId}» на НПП в Москве`));
  assert.equal(rcvCell_(app, i1.productId, 'ip', 'irk'), wasOther, 'товар лёг в клетку поставки, а не в выбранную');
  const mv = S.moves.slice(0, S.moves.length - movesBefore);
  assert.equal(mv.length, 5);
  assert.ok(mv.every(m => m.kind === 'Приход' && m.doc === sh.id && m.entityId === 'npp' && m.cityId === 'msk' && m.by === 'p5'));
  sh.items.forEach((it, k) => assert.equal(mv.find(m => m.productId === it.productId).qty, plus[k], 'итог не равен предпросмотру'));
  assert.equal(chips, r.notified, 'предпросмотр и итог насчитали разное число получателей');
  // этап — через ядро, с пометкой приёмки
  const fin = S.pipelines.find(p => p.id === sh.pipeId).stages.find(x => x.flag === 'final');
  assert.equal(sh.stageId, fin.id);
  assert.ok(app.isDone(sh));
  const entries = sh.history.filter(h => h.source === 'автоматически: приёмка');
  assert.ok(entries.length >= 2 && entries.every(h => h.auto === true));
  assert.ok(entries.some(h => h.text.includes(`«${fin.name}»`)), 'в истории нет перехода на «На складе»');
  assert.ok(entries.some(h => h.text.includes('НПП, Москва')), 'в истории нет, куда принято');
  assert.ok(sh.received && sh.received.by === 'p5' && +sh.received.at === +at);
  assert.deepEqual(plain(sh.pos), { i: 2, t: 0 }, 'груз стоит в конечной точке');
  assert.equal(app.Ships.where(sh).at, 'irk');
  assert.deepEqual([sh.entityId, sh.cityId], ['npp', 'msk'], 'в поставке остались старые юрлицо и город');
  assert.deepEqual(plain(r.fired), [], 'демо-правило «принято → На складе» ничего не меняет: этап уже тот');
  // резервы из поставки стали резервами со склада — в той же клетке, куда лёг товар
  for (const id of ['r10', 'r15']) { const x = S.reserves.find(q => q.id === id); assert.deepEqual([x.src, x.entityId, x.cityId], ['stock', 'npp', 'msk']); }
  // бейдж: ждущих стало на одну меньше
  assert.equal(badgeOf(app, 'receiving'), waiting - 1);
  assert.ok(!app.Ships.awaitingReceipt(S).some(s => s.id === sh.id));
  // «товар на складе» — всем менеджерам и директору (по ролям из команды)
  const heads = S.people.filter(p => ['director', 'managerB2b', 'managerB2c'].includes(p.role)).map(p => p.id).sort();
  const arrive = S.notes.find(n => n.kind === 'arrive' && n.text.startsWith(sh.id));
  assert.deepEqual(plain(arrive.to).sort(), plain(heads));
  assert.ok(arrive.text.includes('принята на склад') && arrive.text.includes('НПП, Москва'), arrive.text);
  // принято с расхождением — отдельное предупреждение
  assert.ok(S.notes.some(n => n.kind === 'warn' && n.text.startsWith('Приёмка П-1044 с замечаниями')));
  // «уведомите клиента» — менеджеру каждой сделки с резервом
  const ask = S.notes.filter(n => n.kind === 'msg' && n.text.startsWith('Уведомите клиента'));
  assert.equal(ask.length, 2);
  for (const [client, deal] of [['Смирнова Елена', 'Д-318'], ['Иванов Сергей', 'Д-311']]) {
    const n = ask.find(x => x.text.startsWith(`Уведомите клиента: ${client} (${deal})`));
    assert.ok(n, `нет «Уведомите клиента: ${client}»`);
    assert.ok(n.to.includes('p2') && n.to.includes('p1'), 'менеджер сделки и директор');
    assert.ok(!n.to.includes('p3'), 'чужой менеджер не получает');
  }
  assert.equal(r.notified, 6, 'директор, четыре менеджера и логист (замечание)');
  // сообщения клиентам по шаблону — в канал сделки, с пометкой «имитация»
  const sent = S.msgs.slice(msgsBefore);
  assert.equal(sent.length, 2);
  const m318 = sent.find(m => m.deal === 'Д-318'), m311 = sent.find(m => m.deal === 'Д-311');
  assert.deepEqual([m318.channel, m311.channel], ['max', 'telegram']);
  assert.ok(sent.every(m => m.sim === true && m.auto === true));
  assert.ok(m318.text.startsWith('Елена, здравствуйте!') && m318.text.includes('сделка Д-318'), m318.text);
  assert.ok(m311.text.startsWith('Сергей, здравствуйте!') && m311.text.includes('сделка Д-311'), m311.text);
  assert.ok(ask.every(n => n.text.includes('имитация, не отправлено')));
  assert.ok(app.rcvAfterHtml(S.rcv).includes('имитация, не отправлено'));
  // и итог сохраняется в состоянии
  assert.equal(S.rcv.done.shipId, sh.id);
  assert.deepEqual([S.rcv.done.cell.entityName, S.rcv.done.cell.cityName], ['НПП', 'Москва']);
});

test('приёмка: у клиента с каналом «телефон» вместо сообщения — задача менеджеру «позвонить клиенту»', () => {
  const app = load(), S = app.S;
  app.setMe('p5');
  const sh = S.shipments.find(s => s.id === 'П-1044');
  S.reserves.push({ id: 'rT', productId: sh.items[3].productId, dealId: 'Д-322', qty: 1, src: sh.id, until: new Date(2026, 10, 10), entityId: 'ip', cityId: 'irk' });
  app.initRcv(sh.id);
  const tasks = S.tasks.length, msgs = S.msgs.length;
  const r = app.receiveShip('p5', new Date(2026, 9, 31, 15));
  assert.equal(r.ok, true);
  const t = S.tasks.slice(tasks);
  assert.equal(t.length, 1, 'одна задача — на единственного клиента по телефону');
  assert.ok(t[0].title.startsWith('Позвонить клиенту') && t[0].title.includes('Д-322'), t[0].title);
  assert.deepEqual([t[0].to.t, t[0].to.id, t[0].deal, t[0].from], ['p', 'p10', 'Д-322', 'p5']);
  assert.deepEqual(plain(r.taskIds), [t[0].id]);
  // в канал «телефон» сообщение не пишется, остальные два клиента получили своё
  const sent = S.msgs.slice(msgs);
  assert.equal(sent.length, 2);
  assert.ok(!sent.some(m => m.deal === 'Д-322' || m.channel === 'phone'));
  // менеджер Олег Н. получил «уведомите клиента» с пометкой о задаче
  const ask = S.notes.find(n => n.kind === 'msg' && n.text.startsWith('Уведомите клиента: Орлов Пётр (Д-322)'));
  assert.ok(ask && ask.to.includes('p10') && ask.text.includes('поставлена задача позвонить'), ask && ask.text);
});

test('приёмка: без юрлица и города товар не ложится; поставка и остаток не меняются, пока их не выбрали', () => {
  const app = load(), S = app.S;
  app.setMe('p5');
  const sh = S.shipments.find(s => s.id === 'П-1044');
  app.initRcv(sh.id);
  app.ON.change['rcv-entity']({ value: '' });
  const moves = S.moves.length, hist = sh.history.length, waiting = badgeOf(app, 'receiving');
  const phone = app.rcvPhoneHtml(S.rcv, app.pendingRcv());
  assert.ok(phone.includes('нет данных: выберите') && phone.includes('без них товар на склад не лечь'), 'кладовщику не сказали выбрать');
  assert.ok(textOf(app.rcvPreview(S.rcv)).includes('нет данных: юрлицо'));
  const r = app.receiveShip('p5', new Date(2026, 9, 31, 15));
  assert.equal(r.ok, false);
  assert.ok(r.reason.includes('юрлицо'), r.reason);
  assert.equal(S.moves.length, moves);
  assert.equal(sh.history.length, hist);
  assert.equal(sh.stageId, 'arrived');
  assert.ok(!sh.received);
  assert.equal(badgeOf(app, 'receiving'), waiting);
  assert.ok(!S.rcv.done, 'приёмка не должна считаться законченной');
  // выбрали — приняли
  app.ON.change['rcv-entity']({ value: 'vs' });
  assert.equal(app.receiveShip('p5', new Date(2026, 9, 31, 15)).ok, true);
  assert.equal(rcvCell_(app, sh.items[1].productId, 'vs', 'irk'), 500, 'город остался из поставки, юрлицо выбрано');
});

test('приёмка: правило «принято на складе» из настроек срабатывает после перехода на «На складе» и видно в истории; выключенное — нет', () => {
  const run = on => {
    const app = load(), S = app.S;
    app.setMe('p5');
    S.shipRules.push({ id: 'srX', on, when: 'received', then: 'toStock' });
    const sh = S.shipments.find(s => s.id === 'П-1044');
    app.initRcv(sh.id);
    const prev = textOf(app.rcvPreview(S.rcv));
    const r = app.receiveShip('p5', new Date(2026, 9, 31, 15));
    return { app, sh, r, prev };
  };
  const a = run(true);
  assert.deepEqual(plain(a.r.fired), ['srX']);
  assert.equal(a.sh.stageId, 'toStock', 'правило не поставило этап');
  const last = a.sh.history[a.sh.history.length - 1];
  assert.ok(last.source.startsWith('правило: если принято на складе'), last.source);
  assert.ok(a.sh.history.some(h => h.source === 'автоматически: приёмка'), 'сначала приёмка, потом правило');
  assert.ok(a.sh.received, 'принята, даже если правило сдвинуло этап');
  assert.ok(a.prev.includes('Правило «если принято на складе»'), 'предпросмотр не предупредил о правиле');
  const b = run(false);
  assert.deepEqual(plain(b.r.fired), []);
  assert.equal(b.sh.stageId, 'inStock', 'выключенное правило сработало');
  assert.ok(!b.sh.history.some(h => String(h.source).startsWith('правило')));
  assert.ok(!b.prev.includes('Правило «если принято'), 'выключенное правило попало в предпросмотр');
});

test('приёмка: этап ставит только ядро — в коде приёмки нет прямой записи stageId', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'js', '55-receiving.js'), 'utf8');
  assert.ok(!/\.stageId\s*=[^=]/.test(src), 'приёмка пишет stageId мимо Ships.setStage');
  assert.ok(src.includes('Ships.setStage(') && src.includes('Ships.applyRules('));
});
