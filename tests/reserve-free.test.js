'use strict';
// Резерв без сделки, его история и уведомления склада (просьба директора 2026-11-06): «мы заходим в номенклатуру, находим …
// панель или инвертор, и в нём есть кнопка типа „резерв“, мы на неё нажимаем и видим, кто что и когда зарезервировал. И …
// там должна быть возможность отмены этого резерва»; «нужна какая-то история. И уведомление, что есть или нету товара»;
// «продаётся товар, который уже в пути … Он может идти на Виндсолар, на ИП, на НПП».
// Числа разобраны руками: панель pv — «ИП, Иркутск» 10, «НПП, Москва» 4; резерв сделки r1 — 3 шт с «ИП, Иркутск»
// (свободно в клетке 7, всего 11). Поставки: П-1 (ВС) везёт 20 панелей, под неё резерв 15; П-2 (НПП) — 5, резервов нет.

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.js');
const kit = require('./server-kit.js');

const NOW = new Date(2026, 10, 6, 12, 0);
const later = n => new Date(NOW.getTime() + n * 60000);
const plain = x => JSON.parse(JSON.stringify(x));
const IP_IRK = { entityId: 'ip', cityId: 'irk' };

// Фирма: директор dir, менеджеры B2B mgr и mgr2, кладовщик wh, инженер eng (остатки видит, резервы ставить не может)
function world(app, over = {}) {
  const base = app.Stock.defaults();
  const people = [['dir', 'director', 'mgmt'], ['mgr', 'managerB2b', 'sales'], ['mgr2', 'managerB2b', 'sales'], ['wh', 'warehouse', 'stock'], ['eng', 'engineer', 'eng']]
    .map(([id, role, dept]) => ({ id, name: 'Сотрудник ' + id, role, dept, demo: true }));
  return Object.assign({
    v: 3, entities: base.entities, cities: base.cities, roles: app.Perms.defaultRoles(), people,
    depts: [{ id: 'mgmt', name: 'Руководство' }, { id: 'sales', name: 'Продажи' }, { id: 'stock', name: 'Склад' }, { id: 'eng', name: 'Инженерный' }],
    pipelines: app.Pipes.defaults(),
    products: [{ id: 'pv', name: 'Панель тестовая' }, { id: 'inv', name: 'Инвертор тестовый' }],
    stock: { pv: { ip: { irk: 10 }, npp: { msk: 4 } }, inv: { ip: { irk: 0 } } },
    reserves: [{ id: 'r1', productId: 'pv', qty: 3, entityId: 'ip', cityId: 'irk', src: 'stock', dealId: 'Д-1', until: later(60 * 24 * 5) }],
    aside: {}, moves: [], shipments: [], dispatches: [], feed: [], notes: [], deals: [], tasks: [], watches: [], prefs: { notify: {} },
  }, over);
}
const free = (app, st) => app.Stock.summary(st, 'pv', NOW).free;

// ——— 1. резерв без сделки в ядре ———
test('резерв без сделки: ставится с текстом «для кого», без текста и больше свободного — отказ; свободное уменьшается', () => {
  const app = load(), st = world(app), { Stock } = app;
  assert.equal(free(app, st), 11);
  // без текста — отказ, ничего не меняется
  let r = Stock.reserveFor(st, { productId: 'pv', qty: 2, ...IP_IRK, forWho: '  ' }, 'mgr', NOW);
  assert.equal(r.ok, false);
  assert.match(r.reason, /для кого/);
  // больше свободного в клетке (7) — отказ с числом
  r = Stock.reserveFor(st, { productId: 'pv', qty: 8, ...IP_IRK, forWho: 'под Иванова, монтаж в Шелехове' }, 'mgr', NOW);
  assert.equal(r.ok, false);
  assert.match(r.reason, /свободно только 7/);
  // без права «резервы» (инженер) — отказ
  r = Stock.reserveFor(st, { productId: 'pv', qty: 1, ...IP_IRK, forWho: 'тест' }, 'eng', NOW);
  assert.equal(r.ok, false);
  assert.equal(st.reserves.length, 1, 'отказ поставил резерв');
  assert.equal(free(app, st), 11);
  // верно — ставится, свободное 11 → 6, в резерве кто, когда и для кого; в журнале «Резерв» с id резерва
  r = Stock.reserveFor(st, { productId: 'pv', qty: 5, ...IP_IRK, forWho: 'под Иванова, монтаж в Шелехове' }, 'mgr', NOW);
  assert.equal(r.ok, true, r.reason);
  assert.equal(free(app, st), 6);
  const res = r.reserve;
  assert.deepEqual(plain({ qty: res.qty, by: res.by, forWho: res.forWho, dealId: res.dealId ?? null, at: res.at }),
    plain({ qty: 5, by: 'mgr', forWho: 'под Иванова, монтаж в Шелехове', dealId: null, at: NOW }));
  assert.equal(st.moves[0].kind, 'Резерв');
  assert.equal(st.moves[0].rid, res.id);
  assert.equal(st.moves[0].doc, 'для: под Иванова, монтаж в Шелехове');
  // складу и директору — уведомление с «для кого»
  const n = st.notes.find(x => x.kind === 'reserve');
  assert.ok(n && n.to.includes('wh') && n.to.includes('dir') && n.text.includes('под Иванова'), JSON.stringify(st.notes));
});

// ——— 2. снятие не автором — уведомление автору ———
test('снял не автор — автору «Ваш резерв … снял …»; снял сам автор — уведомления ему нет', () => {
  const app = load(), st = world(app), { Stock } = app;
  const a = Stock.reserveFor(st, { productId: 'pv', qty: 2, ...IP_IRK, forWho: 'под Петрова' }, 'mgr', NOW).reserve;
  const b = Stock.reserveFor(st, { productId: 'pv', qty: 1, ...IP_IRK, forWho: 'под Сидорова' }, 'mgr', NOW).reserve;
  const mine = () => st.notes.filter(n => n.to.includes('mgr') && n.text.startsWith('Ваш резерв'));
  assert.equal(Stock.unreserve(st, a.id, 'mgr2', later(5)).ok, true);
  assert.equal(mine().length, 1);
  assert.equal(mine()[0].text, 'Ваш резерв панель тестовая × 2 (под Петрова) снял Сотрудник mgr2.');
  assert.deepEqual(plain(mine()[0].to), ['mgr']);
  assert.equal(Stock.unreserve(st, b.id, 'mgr', later(6)).ok, true);
  assert.equal(mine().length, 1, 'автору пришло уведомление о его же снятии');
  // «Снятые резервы» — по журналу: кто поставил и кто снял
  const gone = Stock.removed(st, 'pv');
  assert.deepEqual(plain(gone.map(x => [x.rid, x.qty, x.by, x.removedBy])), [[b.id, 1, 'mgr', 'mgr'], [a.id, 2, 'mgr', 'mgr2']]);
});

// ——— 3. история резерва ———
test('история резерва: поставлен, срок изменён, списано при продаже, срок вышел — кем и когда', () => {
  const app = load(), st = world(app), { Stock } = app;
  const r = Stock.reserveFor(st, { productId: 'pv', qty: 4, ...IP_IRK, forWho: 'под Иванова', until: later(60 * 24) }, 'mgr', NOW).reserve;
  const nu = new Date(2026, 10, 10, 12);
  assert.equal(Stock.extend(st, r.id, nu, 'mgr2', later(10)).ok, true);
  assert.equal(Stock.sell(st, { productId: 'pv', qty: 1, reserveId: r.id, doc: 'накладная 1' }, 'mgr', later(20)).ok, true);
  const h = Stock.history(st, r, new Date(2026, 10, 12, 9));
  assert.deepEqual(plain(h.map(e => [e.text.split(':')[0], e.by])), [['Поставлен', 'mgr'], ['Срок', 'mgr2'], ['Списано при продаже', 'mgr'], ['Срок вышел (был до 10 ноя)', null]]);
  assert.equal(h[0].text, 'Поставлен: 4');
  assert.equal(h[2].text, 'Списано при продаже: 1');
  // без права «резервы» срок не меняется
  assert.equal(Stock.extend(st, r.id, new Date(2026, 10, 20), 'eng', later(30)).ok, false);
});

// ——— 4. «Сообщить, когда появится» ———
test('«Сообщить, когда появится»: уведомление один раз, когда свободный остаток стал больше нуля; подписка снимается', () => {
  const app = load(), st = world(app), { Stock } = app;
  // инвертор: лежит 0 — свободного нет
  assert.equal(Stock.summary(st, 'inv').free, 0);
  assert.equal(Stock.watch(st, 'inv', 'mgr', NOW).ok, true);
  assert.equal(Stock.watch(st, 'inv', 'mgr', NOW).ok, true);
  assert.equal(st.watches.length, 1, 'вторая подписка того же человека');
  assert.equal(Stock.tick(st, later(1)).length, 0, 'свободного нет — сообщать рано');
  // приход 3 на «НПП, Москва»
  assert.equal(Stock.move(st, { kind: 'Приход', productId: 'inv', qty: 3, entityId: 'npp', cityId: 'msk', doc: 'П-9', by: 'wh', at: later(2) }).ok, true);
  const made = Stock.tick(st, later(3));
  assert.equal(made.length, 1);
  assert.deepEqual(plain(made[0].to), ['mgr']);
  assert.equal(made[0].text, 'Инвертор тестовый появился: свободно 3 (НПП · Москва).');
  assert.equal(st.watches.length, 0, 'подписка не снялась');
  assert.equal(Stock.tick(st, later(4)).length, 0, 'второй раз не сообщает');
});

// ——— 5. срок резерва завтра — напоминание автору, и без сделки ———
test('резерв без сделки истекает завтра — автору напоминание один раз; продление взводит его заново', () => {
  const app = load(), st = world(app), { Stock } = app;
  const r = Stock.reserveFor(st, { productId: 'pv', qty: 2, ...IP_IRK, forWho: 'под Орлова', until: new Date(2026, 10, 7, 12) }, 'mgr', NOW).reserve;
  const made = Stock.remindExpiring(st, later(1));
  const mine = made.filter(n => n.to.includes('mgr'));
  assert.equal(mine.length, 1);
  assert.match(mine[0].text, /^Резерв панель тестовая × 2 \(под Орлова\) истекает завтра/);
  assert.equal(Stock.remindExpiring(st, later(2)).filter(n => n.to.includes('mgr')).length, 0, 'напомнил дважды');
  assert.equal(Stock.extend(st, r.id, new Date(2026, 10, 9, 12), 'mgr', later(3)).ok, true);
  assert.equal(Stock.remindExpiring(st, new Date(2026, 10, 8, 9)).filter(n => n.to.includes('mgr')).length, 1);
});

// ——— 6. в пути по юрлицам ———
test('«В пути» по юрлицам поставок: «ВС 20 (продано 15) · НПП 5»', () => {
  const app = load(), { Stock } = app;
  const ship = (id, entityId, qty) => ({ id, dir: 'in', pipeId: 'ships', stageId: 'ordered', entityId, cityId: 'irk', eta: later(60 * 24 * 10), items: [{ productId: 'pv', qty }] });
  const st = world(app, { shipments: [ship('П-1', 'vs', 20), ship('П-2', 'npp', 5)] });
  const r = Stock.reserveFor(st, { productId: 'pv', qty: 15, src: 'П-1', forWho: 'под Иванова (в пути)' }, 'mgr', NOW);
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(plain(Stock.transitBy(st, 'pv')), [{ entityId: 'npp', name: 'НПП', qty: 5, sold: 0 }, { entityId: 'vs', name: 'ВС', qty: 20, sold: 15 }]);
  assert.equal(Stock.transitText(st, 'pv'), 'НПП 5 · ВС 20 (продано 15)');
  // больше, чем осталось в поставке (5), — отказ
  assert.equal(Stock.reserveFor(st, { productId: 'pv', qty: 6, src: 'П-1', forWho: 'ещё' }, 'mgr', NOW).ok, false);
});

// ——— 7. экран: бейдж, список, кто и когда ———
test('номенклатура: бейдж с числом резервов; карточка — для кого, кто поставил, когда, история; «Снять» по резерву без сделки', () => {
  const app = load({ now: NOW }), S = app.S, { Stock } = app;
  app.setMe('p2');
  const p = S.products.find(x => { const k = Stock.summary(S, x.id); return k.known && k.free >= 3 && !S.reserves.some(r => r.productId === x.id); });
  assert.ok(p, 'в демо нет товара со свободным остатком без резервов');
  assert.ok(!app.stockRow(p, true).includes('rbadge'), 'бейдж у товара без резервов');
  const cell = Stock.cells(S, p.id)[0];
  const at = new Date();
  const r = Stock.reserveFor(S, { productId: p.id, qty: 2, entityId: cell.entityId, cityId: cell.cityId, forWho: 'под Иванова, монтаж в Шелехове' }, 'p2', at);
  assert.equal(r.ok, true, r.reason);
  const row = app.stockRow(p, true);
  assert.match(row, /class="rbadge" data-act="product-reserves" data-id="[^"]+"[^>]*>.*1 резерв<\/button>/);
  const body = app.DRAWERS.product(p.id).body;
  const res = body.slice(body.indexOf('id="p-reserves"'), body.indexOf('Едет к нам'));
  for (const t of ['<th>Для кого</th>', '<th>Кто поставил</th>', '<th>Когда</th>', 'под Иванова, монтаж в Шелехове', app.person('p2').name, app.fWhen(at), 'История', 'Поставлен: 2', 'data-act="unreserve"', 'data-act="reserve-until"']) {
    assert.ok(res.includes(app.esc(t)) || res.includes(t), `в списке резервов нет «${t}»`);
  }
  // колонки строки: для кого, кол-во, где, до, кто поставил, когда — кто и когда стоят в своих клетках, а не только в истории
  const tr = res.split('<tr>').find(x => x.includes('под Иванова'));
  const cells = tr.split('<td').slice(1);
  assert.ok(cells[4].includes(app.esc(app.person('p2').name)), `«Кто поставил»: ${cells[4]}`);
  assert.ok(cells[5].includes(app.fWhen(at)), `«Когда»: ${cells[5]}`);
  // старый резерв без отметки и без записи в журнале — «нет данных: кто/когда»
  const old = S.reserves.find(x => x.dealId);
  delete old.at; delete old.by;
  S.moves = S.moves.filter(m => !(m.kind === 'Резерв' && m.doc === old.dealId));
  app.setMe('p1');
  const ob = app.DRAWERS.product(old.productId).body;
  assert.ok(ob.includes('нет данных: кто') && ob.includes('нет данных: когда'), 'у старого резерва нет пометки «нет данных»');
});

// ——— 8. сервер ———
test('сервер: менеджер ставит резерв без сделки; без права «резервы», с чужим by и больше свободного — 403', async () => {
  const srv = await kit.start(), core = load({ globals: { CRM_SERVER: 1 } });
  const live = st => { const x = JSON.parse(JSON.stringify(st), core.Store.revive); delete x.seq; delete x.view; return x; };
  const send = async (cookie, fn) => {
    const st = live(await kit.state(srv, cookie));
    const docs = core.Docs.split(st);
    fn(st);
    return kit.changes(srv, cookie, core.Docs.diff(docs, core.Docs.split(st)));
  };
  const T = new Date(kit.T0);
  try {
    const boss = await kit.director(srv);
    const max = await kit.employee(srv, boss, { id: 'p3', name: 'Максим (тест)', role: 'managerB2b', dept: 'sales' });
    const eng = await kit.employee(srv, boss, { id: 'p4', name: 'Инженер (тест)', role: 'engineer', dept: 'eng' });
    const pid = (await kit.state(srv, boss.cookie)).products[0].id;
    let r = await send(boss.cookie, st => assert.equal(core.Stock.move(st, { kind: 'Приход', productId: pid, qty: 10, entityId: 'ip', cityId: 'irk', doc: 'П-1', by: boss.pid, at: T }).ok, true));
    assert.equal(r.status, 200, r.text);
    // менеджер — 200, резерв в базе с его by и текстом
    r = await send(max.cookie, st => assert.equal(core.Stock.reserveFor(st, { productId: pid, qty: 4, ...IP_IRK, forWho: 'под Иванова (тест)' }, 'p3', T).ok, true));
    assert.equal(r.status, 200, r.text);
    const got = (await kit.state(srv, boss.cookie)).reserves;
    assert.equal(got.length, 1);
    assert.deepEqual([got[0].by, got[0].forWho, got[0].qty], ['p3', 'под Иванова (тест)', 4]);
    // руками собранная пачка: резерв без сделки + его «Резерв» в журнале
    const pack = (id, by, qty, forWho = 'под Петрова (тест)') => [
      { key: 'reserves', id, base: null, data: { id, productId: pid, qty, entityId: 'ip', cityId: 'irk', src: 'stock', until: kit.dateDoc(kit.T0 + 864e5 * 5), by, at: kit.dateDoc(kit.T0), forWho } },
      { key: 'moves', id: 'mv-' + id, base: null, data: { id: 'mv-' + id, at: kit.dateDoc(kit.T0), productId: pid, kind: 'Резерв', qty, entityId: 'ip', cityId: 'irk', doc: 'для: ' + forWho, by, rid: id } },
    ];
    // инженер (остатки видит, права «резервы» нет) — 403
    // (только запись резерва: «Резерв» в журнале без права отказал бы и сам — проверяем правило резервов)
    r = await kit.changes(srv, eng.cookie, pack('rx1', 'p4', 1).slice(0, 1));
    assert.equal(r.status, 403, r.text);
    // менеджер от имени директора — 403
    r = await kit.changes(srv, max.cookie, pack('rx2', 'p1', 1).slice(0, 1));
    assert.equal(r.status, 403, r.text);
    assert.match(r.text, /от своего имени/);
    // больше свободного (свободно 6) — 403
    r = await kit.changes(srv, max.cookie, pack('rx3', 'p3', 7));
    assert.equal(r.status, 403, r.text);
    assert.match(r.text, /больше свободного/);
    // без «для кого» — 403
    r = await kit.changes(srv, max.cookie, pack('rx4', 'p3', 1, ''));
    assert.equal(r.status, 403, r.text);
    // ровно свободное (6) — 200
    r = await kit.changes(srv, max.cookie, pack('rx5', 'p3', 6));
    assert.equal(r.status, 200, r.text);
    assert.equal((await kit.state(srv, boss.cookie)).reserves.length, 2);
  } finally { await srv.stop(); }
});

test('сервер: «Сообщить, когда появится» — подписка только своя; появился товар — сервер сообщает один раз и снимает подписку', async () => {
  const srv = await kit.start(), core = load({ globals: { CRM_SERVER: 1 } });
  const live = st => { const x = JSON.parse(JSON.stringify(st), core.Store.revive); delete x.seq; delete x.view; return x; };
  const send = async (cookie, fn) => {
    const st = live(await kit.state(srv, cookie));
    const docs = core.Docs.split(st);
    fn(st);
    return kit.changes(srv, cookie, core.Docs.diff(docs, core.Docs.split(st)));
  };
  const T = new Date(kit.T0);
  try {
    const boss = await kit.director(srv);
    const max = await kit.employee(srv, boss, { id: 'p3', name: 'Максим (тест)', role: 'managerB2b', dept: 'sales' });
    const pid = (await kit.state(srv, boss.cookie)).products[0].id;
    // чужая подписка — 403; своя — 200; видит только свою
    let r = await kit.changes(srv, max.cookie, [{ key: 'watches', id: 'wx', base: null, data: { id: 'wx', productId: pid, personId: 'p1', at: kit.dateDoc(kit.T0) } }]);
    assert.equal(r.status, 403, r.text);
    r = await send(max.cookie, st => assert.equal(core.Stock.watch(st, pid, 'p3', T).ok, true));
    assert.equal(r.status, 200, r.text);
    assert.equal((await kit.state(srv, boss.cookie)).watches.length, 0, 'директор видит чужую подписку');
    assert.equal(srv.app.tick(), 0, 'товара нет — рано');
    r = await send(boss.cookie, st => assert.equal(core.Stock.move(st, { kind: 'Приход', productId: pid, qty: 2, entityId: 'vs', cityId: 'irk', doc: 'П-1', by: boss.pid, at: T }).ok, true));
    assert.equal(r.status, 200, r.text);
    assert.equal(srv.app.tick(), 1);
    assert.equal(srv.app.tick(), 0, 'второй раз не сообщает');
    const st = await kit.state(srv, max.cookie);
    assert.equal(st.watches.length, 0);
    const n = st.notes.filter(x => x.to.includes('p3') && /появился: свободно 2 \(ВС · Иркутск\)/.test(x.text));
    assert.equal(n.length, 1, JSON.stringify(st.notes));
  } finally { await srv.stop(); }
});
