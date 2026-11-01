'use strict';
// Права на запись (таск 01 серверной сборки): Guard.check по таблице interfaces.md — на каждую строку «можно» и «нельзя».
// Пачка строится как у браузера: Docs.diff документов до и после настоящего действия ядра (Stock.move, Stock.sell, приёмка,
// перемещение отправки, Deals.lose, Leads.take …). Кто что может — права ролей по спецификации (R03, R27–R30, G01) и демо:
// p1 директор, p2 менеджер B2C (Д-311 — его), p3 менеджер B2B, p4 главный инженер, p5 кладовщик, p6 логист, p7 инженер.

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.js');

const NOW = new Date(2026, 10, 1, 12, 0);
const app = () => load({ now: NOW });

// Пачка настоящего действия: состояние сервера до (собрано из документов) и изменения, которые пришлёт браузер
function batch(a, fn, st = a.S) {
  const docs = a.Docs.split(st);
  const st0 = a.Docs.join(docs);
  fn(st);
  return { st0, changes: a.Docs.diff(docs, a.Docs.split(st)) };
}
const check = (a, b, pid) => a.Guard.check(b.st0, pid, b.changes, NOW);
const keys = b => [...new Set(b.changes.map(c => c.key))].sort();
function allowed(r, what) { assert.equal(r, null, `${what}: отказ «${r && r.text}»`); }
function denied(r, what, re) {
  assert.ok(r, `${what}: пропущено`);
  assert.match(r.text, /^Нет прав: \S/, `${what}: текст отказа «${r.text}»`);
  if (re) assert.match(r.text, re, `${what}: текст отказа «${r.text}»`);
}
// Клетка склада с товаром: [productId, entityId, cityId, сколько]
function cellWith(st, min = 5) {
  for (const p of Object.keys(st.stock)) for (const e of Object.keys(st.stock[p])) for (const c of Object.keys(st.stock[p][e])) {
    const n = st.stock[p][e][c];
    const held = st.reserves.filter(r => r.productId === p && r.src === 'stock').reduce((s, r) => s + r.qty, 0);
    if (typeof n === 'number' && n - held >= min) return [p, e, c, n];
  }
  throw new Error('нет клетки с остатком');
}

// ——— склад: остаток только движением ———
test('Guard склад: настоящий приход (Stock.move) — можно кладовщику; остаток без движения — нельзя даже директору', () => {
  const a = app();
  const [p, e, c] = cellWith(a.S);
  const b = batch(a, st => assert.equal(a.Stock.move(st, { kind: 'Приход', productId: p, qty: 3, entityId: e, cityId: c, doc: 'П-1', by: 'p5', at: NOW }).ok, true));
  assert.deepEqual(keys(b), ['moves', 'stock']);
  allowed(check(a, b, 'p5'), 'приход кладовщиком');
  denied(check(a, b, 'p6'), 'приход логистом (нет права «Принимать товар на склад»)');
  const aL = app();
  const bL = batch(aL, st => assert.equal(aL.Stock.move(st, { kind: 'Приход', productId: p, qty: 3, entityId: e, cityId: c, doc: 'П-1', by: 'p6', at: NOW }).ok, true));
  denied(check(aL, bL, 'p6'), 'приход от своего имени логистом', /Принимать товар/);
  // остаток без движения
  const a2 = app();
  const b2 = batch(a2, st => { st.stock[p][e][c] += 5; });
  denied(check(a2, b2, 'p1'), 'остаток без движения у директора', /движени/);
  // движение есть, а остаток не сходится с ним
  const a3 = app();
  const b3 = batch(a3, st => { a3.Stock.move(st, { kind: 'Приход', productId: p, qty: 3, entityId: e, cityId: c, doc: 'П-1', by: 'p5', at: NOW }); st.stock[p][e][c] += 1; });
  denied(check(a3, b3, 'p5'), 'остаток больше движения', /движени/);
  // движение есть, а остаток в пачке не пришёл
  const b4 = { st0: b.st0, changes: b.changes.filter(x => x.key !== 'stock') };
  denied(check(a, b4, 'p5'), 'движение без изменения остатка', /движени/);
});

test('Guard склад: продажа (Stock.sell по резерву) — можно менеджеру с правом sell; кладовщику без него — нельзя', () => {
  const a = app();
  const r = a.S.reserves.find(x => x.dealId === 'Д-311' && x.src === 'stock');
  const b = batch(a, st => {
    const res = a.Stock.sell(st, { productId: r.productId, qty: 1, reserveId: r.id, doc: 'Д-311' }, 'p2', NOW);
    assert.equal(res.ok, true, res.reason);
  });
  assert.deepEqual(keys(b), ['moves', 'reserves', 'stock']);
  allowed(check(a, b, 'p2'), 'продажа менеджером');
  denied(check(a, b, 'p5'), 'продажа кладовщиком');
});

test('Guard склад: приёмка поставки (receiveShip) — можно кладовщику: приход, резервы на склад, снятый излишек, лента сделки; логисту — нельзя', () => {
  const a = app(), S = a.S;
  S.rules.find(x => x.id === 'arrive').on = false;   // в серверной CRM авто-сообщений клиентам нет
  a.setMe('p5');
  a.initRcv('П-1044');
  // одна позиция не пришла: её резерв снимается — «Снят резерв», запись в ленте сделки, уведомление
  const short = S.shipments.find(s => s.id === 'П-1044').items.find(it => S.reserves.some(r => r.src === 'П-1044' && r.productId === it.productId));
  a.ON.input['rcv-qty']({ dataset: { pid: short.productId }, value: '0' });
  const b = batch(a, () => { const r = a.receiveShip('p5', NOW); assert.equal(r.ok, true, r.reason); });
  for (const k of ['moves', 'stock', 'reserves', 'shipments', 'notes', 'feed']) assert.ok(keys(b).includes(k), `в пачке приёмки нет ${k}`);
  assert.ok(b.changes.some(c => c.key === 'reserves' && c.deleted), 'резерв не снят');
  allowed(check(a, b, 'p5'), 'приёмка кладовщиком');
  denied(check(a, b, 'p6'), 'приёмка логистом');
  denied(check(a, b, 'p2'), 'приёмка менеджером');
  // перевести резерв «под поставку» на склад без приёмки — нельзя
  const a2 = app();
  const b2 = batch(a2, st => { const x = st.reserves.find(r => r.src === 'П-1044'); x.src = 'stock'; });
  denied(check(a2, b2, 'p5'), 'резерв на склад без приёмки');
});

test('Guard склад: перемещение по заявке (этап «В пути») — можно тому, кто ведёт отправки; менеджеру — нельзя', () => {
  const a = app(), S = a.S;
  const [p, e, c] = cellWith(S, 2);
  let id;
  const prep = a.Dispatch.create(S, { purpose: 'transfer', to: { name: 'Склад Москва', phone: '+7 900 000-00-95' }, from: { entityId: e, cityId: c }, toCell: { entityId: 'ip', cityId: 'msk' }, when: { date: NOW }, items: [{ productId: p, qty: 2 }] }, 'p6', NOW, { silent: true });
  assert.equal(prep.ok, true, prep.reason || JSON.stringify(prep.missing));
  id = prep.id || prep.dispatch.id;
  const b = batch(a, st => { const r = a.Dispatch.setStage(st, id, 'onWay', 'p6', NOW, { silent: true }); assert.equal(r.ok, true, r.reason); });
  for (const k of ['moves', 'stock', 'dispatches']) assert.ok(keys(b).includes(k), `в пачке перемещения нет ${k}`);
  allowed(check(a, b, 'p6'), 'перемещение логистом');
  denied(check(a, b, 'p2'), 'перемещение менеджером');
});

test('Guard склад: бой и перемещение между клетками — по праву; «Ввод остатков» — только директору', () => {
  const a = app();
  const [p, e, c] = cellWith(a.S, 2);
  const dmg = batch(a, st => assert.equal(a.Stock.move(st, { kind: 'Списание в бой', productId: p, qty: 1, entityId: e, cityId: c, doc: 'акт', by: 'p5', at: NOW }).ok, true));
  assert.deepEqual(keys(dmg), ['aside', 'moves', 'stock']);
  allowed(check(a, dmg, 'p5'), 'бой кладовщиком (право остатков)');
  denied(check(a, dmg, a.S.people.find(p => p.role === 'driver').id), 'бой водителем (нет права остатков)');
  const a2 = app();
  const tr = batch(a2, st => assert.equal(a2.Stock.move(st, { kind: 'Перемещение', productId: p, qty: 1, entityId: e, cityId: c, toEntityId: 'npp', toCityId: 'msk', doc: 'пример', by: 'p6', at: NOW }).ok, true));
  allowed(check(a2, tr, 'p6'), 'перемещение логистом');
  denied(check(a2, tr, 'p2'), 'перемещение менеджером');
  // отложенное (бой) без движения — нельзя
  const a3 = app();
  const ap = Object.keys(a3.S.aside)[0];
  const b3 = batch(a3, st => { st.aside[ap].damaged = (st.aside[ap].damaged || 0) + 1; });
  denied(check(a3, b3, 'p1'), 'бой без движения', /движени/);
  // «Ввод остатков»: директору можно, кладовщику — нельзя
  const a4 = app();
  const inp = batch(a4, st => {
    st.moves.unshift({ id: a4.Store.freeId(st.moves, 'mv'), at: NOW, productId: p, kind: 'Ввод остатков', qty: 7, entityId: e, cityId: c, doc: 'перенос', by: 'p1' });
    st.stock[p][e][c] = 7;
  });
  allowed(check(a4, inp, 'p1'), 'ввод остатков директором');
  const a5 = app();
  const inp5 = batch(a5, st => {
    st.moves.unshift({ id: a5.Store.freeId(st.moves, 'mv'), at: NOW, productId: p, kind: 'Ввод остатков', qty: 7, entityId: e, cityId: c, doc: 'перенос', by: 'p5' });
    st.stock[p][e][c] = 7;
  });
  denied(check(a5, inp5, 'p5'), 'ввод остатков кладовщиком');
});

test('Guard журнал: старую запись moves не правят и не удаляют; движение от чужого имени — нельзя', () => {
  const a = app();
  const edit = batch(a, st => { st.moves[0].qty += 1; });
  denied(check(a, edit, 'p1'), 'правка записи журнала', /журнал/);
  const a2 = app();
  const del = batch(a2, st => { st.moves.splice(0, 1); });
  denied(check(a2, del, 'p1'), 'удаление записи журнала', /журнал/);
  const aE = app();
  const author = aE.S.moves[0].by;
  const ed = batch(aE, st => { st.moves[0].note = 'переписано'; });
  denied(check(aE, ed, author), 'правка своей записи журнала её автором', /не правят/);
  const a3 = app();
  const [p, e, c] = cellWith(a3.S);
  const other = batch(a3, st => a3.Stock.move(st, { kind: 'Приход', productId: p, qty: 1, entityId: e, cityId: c, doc: 'П-1', by: 'p1', at: NOW }));
  denied(check(a3, other, 'p5'), 'движение от имени директора');
});

// ——— резервы ———
test('Guard резервы: поставить резерв своей сделке — менеджеру с правом; чужой невидимой сделке или без права — нельзя', () => {
  const a = app();
  const [p, e, c] = cellWith(a.S, 3);
  const b = batch(a, st => {
    const r = a.Stock.reserve(st, { productId: p, qty: 1, entityId: e, cityId: c, src: 'stock', dealId: 'Д-311', until: NOW, by: 'p2', at: NOW });
    assert.equal(r.ok, true, r.reason);
  });
  assert.deepEqual(keys(b), ['moves', 'reserves']);
  allowed(check(a, b, 'p2'), 'резерв своей сделке');
  const a3 = app();
  const b3 = batch(a3, st => { const r = a3.Stock.reserve(st, { productId: p, qty: 1, entityId: e, cityId: c, src: 'stock', dealId: 'Д-311', until: NOW, by: 'p3', at: NOW }); assert.equal(r.ok, true, r.reason); });
  denied(check(a3, b3, 'p3'), 'резерв невидимой сделке от своего имени (менеджер B2B, Д-311 — B2C)', /резерв/);
  denied(check(a, b, 'p5'), 'резерв без права «Ставить и снимать резервы»');
});

test('Guard резервы: провал своей видимой сделки снимает её резервы — можно и без права reserve; без провала — нельзя', () => {
  const a = app();
  a.S.roles.find(r => r.id === 'managerB2c').perms.reserve = false;
  const b = batch(a, st => { const r = a.Deals.lose(st, 'Д-311', 'Пример причины', 'p2', NOW); assert.equal(r.ok, true, r.reason); });
  assert.ok(b.changes.some(c => c.key === 'reserves' && c.deleted), 'резервы не сняты');
  allowed(check(a, b, 'p2'), 'провал сделки с резервами');
  denied(check(a, b, 'p3'), 'провал чужой сделки');
  const a2 = app();
  a2.S.roles.find(r => r.id === 'managerB2c').perms.reserve = false;
  const b2 = batch(a2, st => { st.reserves.splice(st.reserves.findIndex(r => r.dealId === 'Д-311'), 1); });
  denied(check(a2, b2, 'p2'), 'снять резерв без провала и без права reserve');
});

// ——— поставки ———
test('Guard поставки: этап — логисту; кладовщику — только приёмка и свои файлы', () => {
  const a = app();
  const s = a.S.shipments.find(x => x.dir === 'in' && !a.Pipes.isFinal(a.S, x.pipeId, x.stageId) && x.stageId !== 'customs');
  const to = a.S.pipelines.find(p => p.id === s.pipeId).stages.find(st => st.id !== s.stageId && !st.flag);
  const b = batch(a, st => { const r = a.Ships.setStage(st, s.id, to.id, 'p6', NOW, a.Ships.SRC.manual); assert.equal(r.ok, true, r.reason); });
  allowed(check(a, b, 'p6'), 'этап поставки логистом');
  denied(check(a, b, 'p5'), 'этап поставки кладовщиком без приёмки');
  const aS = app();
  const bS = batch(aS, st => { const r = aS.Ships.setStage(st, s.id, to.id, 'p5', NOW, aS.Ships.SRC.manual); assert.equal(r.ok, true, r.reason); });
  denied(check(aS, bS, 'p5'), 'этап поставки кладовщиком от своего имени без приёмки', /менять поставки/);
  const a2 = app();
  const f = batch(a2, st => { const r = a2.Attach.add(st.shipments.find(x => x.id === s.id), [{ name: 'накладная.pdf', type: 'application/pdf', size: 3, data: 'data:application/pdf;base64,AAA' }], 'p5', NOW); assert.equal(r.ok, true); });
  allowed(check(a2, f, 'p5'), 'свой файл к поставке кладовщиком');
  denied(check(a2, f, 'p7'), 'файл к поставке инженером');
  const a3 = app();
  const sh = a3.S.shipments.find(x => x.id === s.id);
  sh.files = [{ id: 'fl1', name: 'чужое.pdf', type: '', size: 1, data: null, by: 'p6', at: NOW }];
  const rm = batch(a3, st => { a3.Attach.remove(st.shipments.find(x => x.id === s.id), 'fl1', 'p5', true); });
  denied(check(a3, rm, 'p5'), 'чужой файл поставки кладовщиком');
  allowed(check(a3, rm, 'p6'), 'чужой файл поставки логистом');
});

// ——— сделки ———
test('Guard сделки: dealsEdit и сделка видна до и после; невидимая или без права — нельзя', () => {
  const a = app();
  const b = batch(a, st => { const r = a.Deals.update(st, 'Д-311', { object: 'СЭС 12 кВт (пример)' }, 'p2', NOW); assert.equal(r.ok, true, r.reason); });
  allowed(check(a, b, 'p2'), 'правка своей сделки');
  denied(check(a, b, 'p3'), 'правка невидимой сделки');
  denied(check(a, b, 'p4'), 'правка сделки главным инженером (без dealsEdit)');
  // после правки сделка ушла из видимости правящего
  const a2 = app();
  const b2 = batch(a2, st => { const d = st.deals.find(x => x.id === 'Д-311'); d.type = 'b2b'; d.pipeId = 'dealsB2b'; d.managerId = 'p3'; });
  denied(check(a2, b2, 'p2'), 'сделка не видна после правки');
});

// ——— лиды ———
test('Guard лиды: право «лиды» и лид виден до и после; смена ведущего — только передачей или «взять»', () => {
  const a = app();
  const lead = a.Leads.visible(a.S, 'p2').find(l => l.managerId === 'p2' && !a.Pipes.isFinal(a.S, l.pipeId, l.stageId));
  const b = batch(a, st => assert.ok(a.Leads.contacted(st, lead.id, 'p2', NOW)));
  allowed(check(a, b, 'p2'), 'свой лид');
  denied(check(a, b, 'p3'), 'чужой лид невидим');
  denied(check(a, b, 'p5'), 'лид без права «лиды»');
  // самовольно сменить ведущего — нельзя; РОП передаёт — можно
  const a2 = app();
  const b2 = batch(a2, st => { st.leads.find(l => l.id === lead.id).managerId = 'p10'; });
  denied(check(a2, b2, 'p2'), 'смена ведущего без права передавать');
  const rop = a2.S.people.find(p => p.role === 'rop').id;
  const a3 = app();
  const b3 = batch(a3, st => assert.ok(a3.Leads.transfer(st, lead.id, { managerId: 'p10' }, rop, NOW)));
  allowed(check(a3, b3, rop), 'передача лида РОП');
  // взять нераспределённый лид своего типа: открытый лид B2C остался без менеджера
  const a4 = app();
  const free = a4.S.leads.find(l => l.type === 'b2c' && l.managerId && l.managerId !== 'p2' && !a4.Pipes.isFinal(a4.S, l.pipeId, l.stageId));
  delete free.managerId;
  assert.ok(a4.Leads.canTake(a4.S, free, 'p2'), 'лид B2C без менеджера нельзя взять');
  const b4 = batch(a4, st => assert.ok(a4.Leads.take(st, free.id, 'p2', NOW)));
  allowed(check(a4, b4, 'p2'), 'взять лид');
  // взять лид, у которого уже есть менеджер, — передача, а не «взять»
  const a5 = app();
  const busy = a5.S.leads.find(l => l.type === 'b2c' && l.managerId && l.managerId !== 'p2' && !a5.Pipes.isFinal(a5.S, l.pipeId, l.stageId));
  denied(check(a5, batch(a5, st => { st.leads.find(l => l.id === busy.id).managerId = 'p2'; }), 'p2'), 'забрать чужой лид');
});

// ——— клиенты, лента, дела (G01) ———
test('Guard клиенты: клиенты + dealsEdit и клиент виден (G01) — менеджеру можно, инженерам нельзя', () => {
  const a = app();
  const cl = a.S.clients.find(c => a.Clients.related(a.S, c.id).deals.some(d => d.id === 'Д-311'));
  const b = batch(a, st => { const r = a.Clients.update(st, cl.id, { email: 'primer-new@example.com' }, 'p2', NOW); assert.equal(r.ok, true, r.reason); });
  allowed(check(a, b, 'p2'), 'правка клиента менеджером');
  denied(check(a, b, 'p4'), 'правка клиента главным инженером');
  denied(check(a, b, 'p7'), 'правка клиента инженером');
  denied(check(a, b, 'p3'), 'правка невидимого клиента');
  const a2 = app();
  const nb = batch(a2, st => { const r = a2.Clients.create(st, { name: 'Клиент-пример новый', phone: '+7 900 000-00-98' }, 'p2', NOW); assert.equal(r.ok, true, r.reason); });
  allowed(check(a2, nb, 'p2'), 'новый клиент менеджером');
  denied(check(a2, nb, 'p7'), 'новый клиент инженером');
});

test('Guard лента и дела: новая запись — кто может писать в карточку или меняет её в той же пачке; старые не меняются', () => {
  const a = app();
  const b = batch(a, st => { const r = a.Feed.comment(st, { t: 'deal', id: 'Д-311' }, 'Комментарий-пример', 'p2', NOW); assert.equal(r.ok, true, r.reason); });
  allowed(check(a, b, 'p2'), 'комментарий в свою сделку');
  denied(check(a, b, 'p4'), 'комментарий в сделку главным инженером (G01)');
  denied(check(a, b, 'p3'), 'комментарий в невидимую сделку');
  // старую запись ленты не правят и не удаляют
  const a2 = app();
  const e = batch(a2, st => { st.feed[0].text = 'переписано'; });
  denied(check(a2, e, 'p1'), 'правка записи ленты');
  denied(check(a2, e, a2.S.feed[0].by || 'p1'), 'правка своей записи ленты её автором', /не правят/);
  const a3 = app();
  const d = batch(a3, st => { st.feed.splice(0, 1); });
  denied(check(a3, d, 'p1'), 'удаление записи ленты');
  // отправка: писать в ленту может любой сотрудник
  const a4 = app();
  const dsp = a4.S.dispatches[0];
  const c4 = batch(a4, st => { const r = a4.Dispatch.comment(st, dsp.id, 'Комментарий-пример', 'p7', NOW); assert.equal(r.ok, true, r.reason); });
  allowed(check(a4, c4, 'p7'), 'комментарий к заявке инженером');
  // дела: поставить и выполнить — кто пишет в ленту сделки; правка дела сверх отметки «сделано» — нельзя
  const a5 = app();
  const p5 = batch(a5, st => { const r = a5.Acts.plan(st, { t: 'deal', id: 'Д-311' }, { type: 'call', due: NOW }, 'p2', NOW); assert.equal(r.ok, true, r.reason); });
  allowed(check(a5, p5, 'p2'), 'дело в свою сделку');
  denied(check(a5, p5, 'p7'), 'дело в сделку инженером (G01)');
  const a6 = app();
  const act = a6.S.acts.find(x => !x.doneAt && x.ref.t === 'deal' && x.ref.id === 'Д-311') || a6.Acts.plan(a6.S, { t: 'deal', id: 'Д-311' }, { type: 'call', due: NOW }, 'p2', NOW).act;
  const dn = batch(a6, st => { const r = a6.Acts.done(st, act.id, 'Созвонились (пример)', 'p2', NOW); assert.equal(r.ok, true, r.reason); });
  allowed(check(a6, dn, 'p2'), 'дело выполнено менеджером');
  denied(check(a6, dn, 'p4'), 'дело выполнено главным инженером (G01)');
  const a7 = app();
  const act7 = a7.S.acts[0];
  const ed = batch(a7, st => { st.acts.find(x => x.id === act7.id).title = 'переписано'; });
  denied(check(a7, ed, 'p1'), 'правка дела');
  // провал сделки: запись в ленте — вместе с правкой самой сделки
  const a8 = app();
  const lose = batch(a8, st => a8.Deals.lose(st, 'Д-318', 'Пример причины', 'p2', NOW));
  assert.ok(lose.changes.some(c => c.key === 'feed' && c.base === null));
  allowed(check(a8, lose, 'p2'), 'провал сделки с записью в ленте');
});

// ——— задачи ———
test('Guard задачи: новая — своему отделу без права, другому — с tasksAssign; правка — автор, исполнитель, отдел, tasksAll', () => {
  const a = app();
  const mk = (st, to, from) => st.tasks.push({ id: a.Store.freeId(st.tasks, 't'), title: 'Задача-пример', deal: '', to, from, due: NOW, boardId: 'tasksCommon', stageId: 'new', prio: 'normal', desc: '', at: NOW });
  allowed(check(a, batch(a, st => mk(st, { t: 'd', id: 'stock' }, 'p5')), 'p5'), 'кладовщик — своему отделу');
  const a2 = app();
  denied(check(a2, batch(a2, st => mk(st, { t: 'p', id: 'p2' }, 'p5')), 'p5'), 'кладовщик — менеджеру (нет tasksAssign)');
  const a3 = app();
  allowed(check(a3, batch(a3, st => mk(st, { t: 'd', id: 'eng' }, 'p2')), 'p2'), 'менеджер — инженерам (tasksAssign)');
  const a4 = app();
  denied(check(a4, batch(a4, st => mk(st, { t: 'd', id: 'stock' }, 'p1')), 'p5'), 'задача от имени директора');
  // правка: t5 — отделу «Склад»
  const a5 = app();
  const b5 = batch(a5, st => { st.tasks.find(t => t.id === 't5').stageId = 'done'; });
  allowed(check(a5, b5, 'p5'), 'член отдела-исполнителя');
  allowed(check(a5, b5, 'p6'), 'автор');
  allowed(check(a5, b5, 'p1'), 'директор (tasksAll)');
  denied(check(a5, b5, 'p7'), 'инженер — чужая задача');
});

// ——— отправки ———
test('Guard отправки: новая — любой от своего имени; правка — автор на первом этапе или dispatch; этап — dispatch; продажа — sell', () => {
  const a = app();
  let id;
  const nb = batch(a, st => {
    const r = a.Dispatch.create(st, { purpose: 'sale', to: { name: 'Клиент-пример 9', phone: '+7 900 000-00-97' }, address: 'Адрес-пример', when: { date: NOW }, items: [{ text: 'Строка-пример', qty: 1 }] }, 'p7', NOW, { silent: true });
    assert.equal(r.ok, true, r.reason || JSON.stringify(r.missing));
    id = r.id || r.dispatch.id;
  });
  allowed(check(a, nb, 'p7'), 'новая заявка инженером');
  denied(check(a, nb, 'p2'), 'заявка от чужого имени');
  const ed = batch(a, st => { const r = a.Dispatch.update(st, id, { note: 'Примечание-пример' }, 'p7', NOW); assert.equal(r.ok, true, r.reason); });
  allowed(check(a, ed, 'p7'), 'автор правит на первом этапе');
  const ed6 = batch(a, st => { const r = a.Dispatch.update(st, id, { note: 'Примечание логиста-пример' }, 'p6', NOW); assert.equal(r.ok, true, r.reason); });
  allowed(check(a, ed6, 'p6'), 'логист с dispatch');
  // правка и этап в обход ядра — на копии, чтобы не сдвинуть заявку
  const copy = () => a.Docs.join(a.Docs.split(a.S));
  const raw = batch(a, st => { st.dispatches.find(x => x.id === id).note = 'чужая правка'; }, copy());
  denied(check(a, raw, 'p2'), 'не автор и без dispatch', /заявк/);
  const rawStage = batch(a, st => { st.dispatches.find(x => x.id === id).stageId = 'picking'; }, copy());
  denied(check(a, rawStage, 'p7'), 'этап — автор без права dispatch', /этап/);
  const st2 = batch(a, st => { const r = a.Dispatch.setStage(st, id, 'picking', 'p6', NOW, { silent: true }); assert.equal(r.ok, true, r.reason); });
  allowed(check(a, st2, 'p6'), 'этап — тот, кто ведёт отправки');
  // автор после начала сборки уже не правит
  const late = batch(a, st => { st.dispatches.find(x => x.id === id).note = 'поздняя правка'; }, copy());
  denied(check(a, late, 'p7'), 'автор после «Новая»', /заявк/);
  // продажа строки заявки: sell
  const a2 = app();
  const [p, e, c] = cellWith(a2.S, 2);
  const mk = a2.Dispatch.create(a2.S, { purpose: 'sale', to: { name: 'Клиент-пример 8', phone: '+7 900 000-00-96' }, address: 'Адрес-пример', when: { date: NOW }, items: [{ productId: p, qty: 1 }] }, 'p2', NOW, { silent: true });
  const did = mk.id || mk.dispatch.id;
  const sell = batch(a2, st => { const r = a2.Dispatch.sell(st, did, 0, { entityId: e, cityId: c }, 'p2', NOW); assert.equal(r.ok, true, r.reason); });
  allowed(check(a2, sell, 'p2'), 'продажа менеджером');
  denied(check(a2, sell, 'p7'), 'продажа инженером');
});

// ——— уведомления ———
test('Guard уведомления: прочитать своё — можно; отметить чужое, переписать, удалить, адресовать несуществующему — нельзя', () => {
  const a = app();
  const b = batch(a, st => a.Notify.markRead(st, 'p2'));
  assert.ok(b.changes.length > 0 && b.changes.every(c => c.key === 'notes'));
  allowed(check(a, b, 'p2'), 'прочитать свои');
  denied(check(a, b, 'p3'), 'прочитать за другого');
  const a2 = app();
  const n = a2.S.notes.find(x => x.to.includes('p2'));
  denied(check(a2, batch(a2, st => { st.notes.find(x => x.id === n.id).text = 'переписано'; }), 'p2'), 'переписать уведомление');
  const a3 = app();
  denied(check(a3, batch(a3, st => { st.notes.splice(0, 1); }), 'p1'), 'удалить уведомление');
  const a4 = app();
  const nw = batch(a4, st => a4.Notify.push(st, 'task', 'p2', 'Уведомление-пример', NOW, ['p3'], { t: 'task', id: 't1' }));
  allowed(check(a4, nw, 'p2'), 'новое уведомление от себя');
  denied(check(a4, nw, 'p3'), 'уведомление от чужого имени');
  const a5 = app();
  const ghost = batch(a5, st => st.notes.unshift({ id: a5.Store.freeId(st.notes, 'n'), kind: 'task', by: 'p2', at: NOW, text: 'пример', to: ['p99'], read: [] }));
  denied(check(a5, ghost, 'p2'), 'уведомление несуществующему сотруднику');
});

// ——— настройки, роли, личное, только директор ———
test('Guard настройки фирмы — право settings; роли и люди — admin; prefs — только свои строки', () => {
  const a = app();
  const pp = batch(a, st => { st.pipelines[0].stages[0].name = 'Этап-пример'; });
  allowed(check(a, pp, 'p1'), 'воронка директором');
  denied(check(a, pp, 'p2'), 'воронка менеджером', /настройк/);
  for (const [key, fn] of [['leadWaitMin', st => { st.leadWaitMin = 30; }], ['lostReasons', st => { st.lostReasons[0].name = 'Причина-пример'; }], ['cities', st => { st.cities[0].address = 'Адрес-пример'; }], ['shipRules', st => { st.shipRules[0].on = !st.shipRules[0].on; }]]) {
    const ak = app();
    const bk = batch(ak, fn);
    assert.deepEqual(keys(bk), [key]);
    allowed(check(ak, bk, 'p1'), `${key} директором`);
    denied(check(ak, bk, 'p5'), `${key} кладовщиком`);
  }
  const a2 = app();
  const role = batch(a2, st => a2.Perms.addRole(st, 'Роль-пример'));
  allowed(check(a2, role, 'p1'), 'роль директором');
  denied(check(a2, role, 'p2'), 'роль менеджером');
  const a3 = app();
  const ppl = batch(a3, st => { st.people.find(p => p.id === 'p7').specialty = 'designer'; });
  denied(check(a3, ppl, 'p4'), 'сотрудник главным инженером');
  const a4 = app();
  const own = batch(a4, st => { st.prefs.notify.p2 = { ship: false }; });
  allowed(check(a4, own, 'p2'), 'свои уведомления');
  denied(check(a4, own, 'p3'), 'чужие уведомления');
  const a5 = app();
  denied(check(a5, batch(a5, st => { st.prefs.sound.p3 = { on: false }; }), 'p2'), 'чужой звук');
});

test('Guard товары: добавить товар в номенклатуру — с правом «Добавлять товары в номенклатуру»; без него — нельзя', () => {
  const a = app();
  const b = batch(a, st => { st.products.push({ ...st.products[0], id: 'tov-primer', src: 'manual', name: 'Товар-пример' }); });
  assert.deepEqual(keys(b), ['products']);
  assert.equal(a.Perms.can(a.S, 'p2', 'catalog'), false, 'у менеджера B2C в демо есть право catalog — тест ничего не проверит');
  allowed(check(a, b, 'p1'), 'товар директором');
  denied(check(a, b, 'p2'), 'товар менеджером', /товары/);
});

test('Guard только директор: шаблон, адрес склада, правила, почта, переписка, перенос остатков и неизвестный ключ', () => {
  const cases = [
    ['tpl', st => { st.tpl = 'Шаблон-пример {имя}'; }],
    ['address', st => { st.address = 'Адрес-пример'; }],
    ['rules', st => { st.rules[0].on = !st.rules[0].on; }],
    ['mail', st => { st.mail.letters[0].read = !st.mail.letters[0].read; }],
    ['msgs', st => { st.msgs[0].text = 'пример'; }],
    ['stockSheet', st => { st.stockSheet = { rows: [] }; }],
    ['нет-такого', st => { st['нет-такого'] = 1; }],
  ];
  for (const [key, fn] of cases) {
    const a = app();
    const b = batch(a, fn);
    assert.deepEqual(keys(b), [key]);
    allowed(check(a, b, 'p1'), `${key} директором`);
    denied(check(a, b, 'p2'), `${key} менеджером`);
  }
  // личное в общую базу не пишется
  const a = app();
  denied(a.Guard.check(a.Docs.join(a.Docs.split(a.S)), 'p1', [{ key: 'me', id: '', base: null, data: 'p2' }], NOW), 'личный ключ');
  // человека нет — нельзя ничего
  const a2 = app();
  const b2 = batch(a2, st => { st.tpl = 'пример'; });
  denied(check(a2, b2, 'p99'), 'неизвестный человек');
  assert.ok(a2.Guard.RULES && typeof a2.Guard.RULES.deals === 'function' && typeof a2.Guard.RULES.stock === 'function', 'Guard.RULES[key]');
});

// ——— G01: инженер не правит клиентов и не пишет в ленту сделки ———
test('G01: инженер и главный инженер — Clients.create/update, Feed.comment к сделке, Acts.plan/done по сделке отказывают; менеджер может', () => {
  const a = app(), S = a.S;
  const cl = S.clients.find(c => a.Clients.related(S, c.id).deals.some(d => d.id === 'Д-311'));
  const act = a.Acts.plan(S, { t: 'deal', id: 'Д-311' }, { type: 'call', due: NOW }, 'p2', NOW).act;
  for (const pid of ['p4', 'p7']) {
    assert.equal(a.Clients.create(S, { name: 'Клиент-пример инженера' }, pid, NOW).ok, false, `${pid}: завёл клиента`);
    assert.equal(a.Clients.update(S, cl.id, { email: 'x@example.com' }, pid, NOW).ok, false, `${pid}: правит клиента`);
    assert.equal(a.Feed.comment(S, { t: 'deal', id: 'Д-311' }, 'пример', pid, NOW).ok, false, `${pid}: пишет в ленту сделки`);
    assert.equal(a.Acts.plan(S, { t: 'deal', id: 'Д-311' }, { type: 'call', due: NOW }, pid, NOW).ok, false, `${pid}: ставит дело`);
    assert.equal(a.Acts.done(S, act.id, 'пример', pid, NOW).ok, false, `${pid}: закрывает дело`);
    assert.equal(a.Feed.canComment(S, pid, { t: 'deal', id: 'Д-311' }), false);
    assert.equal(a.Clients.canEdit(S, pid), false);
  }
  assert.equal(a.Clients.update(S, cl.id, { email: 'primer-ok@example.com' }, 'p2', NOW).ok, true);
  assert.equal(a.Feed.comment(S, { t: 'deal', id: 'Д-311' }, 'пример', 'p2', NOW).ok, true);
  assert.equal(a.Acts.done(S, act.id, 'пример', 'p2', NOW).ok, true);
  // интерфейс: у инженеров нет «Новый клиент», правки клиента, поля комментария и «Запланировать» в ленте сделки
  for (const [pid, can] of [['p4', false], ['p7', false], ['p2', true]]) {
    const page = app();
    page.setMe(pid);
    page.S.view = 'clients'; page.render();
    assert.equal(page.byId('view').innerHTML.includes('data-act="client-new"'), can, `${pid}: кнопка «Новый клиент»`);
    const card = page.DRAWERS.client(cl.id).body;
    assert.equal(card.includes(page.CLIENT_NO_EDIT), !can, `${pid}: карточка клиента ${can ? 'закрыта' : 'открыта'} на правку`);
    const feed = page.feedHtml({ t: 'deal', id: 'Д-311' });
    assert.equal(feed.includes('data-form="feed-comment"'), can, `${pid}: поле комментария в ленте сделки`);
    assert.equal(feed.includes('Запланировать'), can, `${pid}: «Запланировать» в ленте сделки`);
  }
});

// ——— дыры, найденные ревью: количество движения, парный приход перемещения, id документа ———
test('Guard журнал: количество движения — конечное число больше нуля; отрицательная «Отгрузка» с прибавкой к остатку — нельзя', () => {
  const a = app();
  const [p, e, c] = cellWith(a.S);
  const forge = qty => batch(a, st => {
    st.moves.unshift({ id: a.Store.freeId(st.moves, 'mv'), at: NOW, productId: p, kind: 'Отгрузка', qty, entityId: e, cityId: c, doc: 'Д-311', by: 'p2' });
    st.stock[p][e][c] -= qty;
  }, a.Docs.join(a.Docs.split(a.S)));
  assert.equal(a.Perms.can(a.S, 'p2', 'sell'), true, 'у менеджера нет права sell — тест ничего не проверит');
  denied(check(a, forge(-1000), 'p2'), 'отгрузка на −1000 с прибавкой к остатку', /количеств/);
  denied(check(a, forge(0), 'p2'), 'отгрузка на 0', /количеств/);
  denied(check(a, forge(Infinity), 'p2'), 'отгрузка на бесконечность', /количеств/);
  allowed(check(a, forge(2), 'p2'), 'обычная отгрузка на 2');
});

test('Guard журнал: «Приход» по номеру перемещения — только в паре с отгрузкой из другой клетки; без пары нужно «receive»', () => {
  const a = app(), S = a.S;
  const [p, e, c] = cellWith(S, 2);
  const driver = S.people.find(x => x.role === 'driver').id;
  assert.equal(a.Perms.can(S, driver, 'dispatch'), true);
  assert.equal(a.Perms.can(S, driver, 'receive'), false, 'у водителя есть receive — тест ничего не проверит');
  const prep = a.Dispatch.create(S, { purpose: 'transfer', to: { name: 'Склад Москва', phone: '+7 900 000-00-95' }, from: { entityId: e, cityId: c }, toCell: { entityId: 'ip', cityId: 'msk' }, when: { date: NOW }, items: [{ productId: p, qty: 2 }] }, 'p6', NOW, { silent: true });
  assert.equal(prep.ok, true, prep.reason || JSON.stringify(prep.missing));
  const id = prep.id || prep.dispatch.id, num = S.dispatches.find(x => x.id === id).number;
  const copy = () => a.Docs.join(a.Docs.split(S));
  const mv = (st, kind, q, cell) => st.moves.unshift({ id: a.Store.freeId(st.moves, 'mv'), at: NOW, productId: p, kind, qty: q, entityId: cell[0], cityId: cell[1], doc: num, by: driver });
  // водитель сам себе «принимает» 500 штук по номеру перемещения — без отгрузки
  const lone = batch(a, st => { mv(st, 'Приход', 500, [e, c]); st.stock[p][e][c] += 500; }, copy());
  denied(check(a, lone, driver), 'приход по номеру перемещения без пары', /Принимать товар/);
  // пара «отгрузка + приход» на одну и ту же клетку остатка не двигает, но и перемещением не является
  const same = batch(a, st => { mv(st, 'Отгрузка', 2, [e, c]); mv(st, 'Приход', 2, [e, c]); }, copy());
  denied(check(a, same, driver), 'приход в ту же клетку, откуда отгрузка', /Принимать товар/);
  // пара с другим количеством
  const odd = batch(a, st => { mv(st, 'Отгрузка', 1, [e, c]); mv(st, 'Приход', 2, ['ip', 'msk']); st.stock[p][e][c] -= 1; st.stock[p].ip = st.stock[p].ip || {}; st.stock[p].ip.msk = (st.stock[p].ip.msk || 0) + 2; }, copy());
  denied(check(a, odd, driver), 'приход на другое количество, чем отгрузка', /Принимать товар/);
  // настоящее перемещение по заявке: отгрузка на этапе «В пути», приход на «Доставлено»
  const way = batch(a, st => { const r = a.Dispatch.setStage(st, id, 'onWay', driver, NOW, { silent: true }); assert.equal(r.ok, true, r.reason); });
  allowed(check(a, way, driver), 'отгрузка перемещения водителем');
  const done = batch(a, st => { const r = a.Dispatch.setStage(st, id, 'delivered', driver, NOW, { silent: true }); assert.equal(r.ok, true, r.reason); });
  assert.ok(!done.changes.some(x => x.key === 'moves' || x.key === 'stock'), 'при доставке склад не двигается: груз записан «Перемещением» при выходе (G04)');
  assert.ok(way.changes.some(x => x.key === 'moves' && x.data.kind === 'Перемещение'), 'выход со склада — одна запись «Перемещение»');
  allowed(check(a, done, driver), 'доставка перемещения водителем');
  // пара «отгрузка + приход» одной пачкой, на другую клетку и на то же количество — настоящее перемещение
  const pair = batch(a, st => {
    mv(st, 'Отгрузка', 2, [e, c]); mv(st, 'Приход', 2, ['ip', 'msk']);
    st.stock[p][e][c] -= 2; st.stock[p].ip = st.stock[p].ip || {}; st.stock[p].ip.msk = (st.stock[p].ip.msk || 0) + 2;
  }, copy());
  allowed(check(a, pair, driver), 'пара «отгрузка + приход» в одной пачке');
});

test('Guard id: у записи массива id документа и data.id совпадают — иначе можно подменить чужую запись через свой ключ', () => {
  const a = app();
  const tamper = (b, key, id, realId) => { const c = b.changes.find(x => x.key === key && x.id === id); assert.ok(c, `нет изменения ${key}/${id}`); c.data.id = realId; return b; };
  // задача: p5 заводит «tNEW», а в data.id пишет существующую t5
  const t = batch(a, st => st.tasks.push({ id: 'tNEW', title: 'Задача-пример', deal: '', to: { t: 'd', id: 'stock' }, from: 'p5', due: NOW, boardId: 'tasksCommon', stageId: 'new', prio: 'normal', desc: '', at: NOW }));
  allowed(check(a, t, 'p5'), 'честная новая задача');
  denied(check(a, tamper(t, 'tasks', 'tNEW', 't5'), 'p5'), 'задача tNEW с id существующей t5', /Нет прав/);
  // клиент: p2 заводит «Knew» с id клиента, которого не видит
  const other = a.S.clients.find(cl => !a.Visible.client(a.S, cl, 'p2'));
  assert.ok(other, 'нет клиента, невидимого p2');
  const cl = batch(a, st => { const r = a.Clients.create(st, { name: 'Клиент-пример новый', phone: '+7 900 000-00-98' }, 'p2', NOW); assert.equal(r.ok, true, r.reason); });
  const cc = cl.changes.find(x => x.key === 'clients');
  allowed(check(a, cl, 'p2'), 'честный новый клиент');
  denied(check(a, tamper(cl, 'clients', cc.id, other.id), 'p2'), 'клиент с id чужого невидимого', /Нет прав/);
  // уведомление
  const n = batch(a, st => st.notes.push({ id: 'nNEW', to: ['p2'], by: 'p5', text: 'Пример', at: NOW, read: [] }));
  allowed(check(a, n, 'p5'), 'честное уведомление');
  denied(check(a, tamper(n, 'notes', 'nNEW', a.S.notes[0].id), 'p5'), 'уведомление с id существующего', /Нет прав/);
  // товар
  const pr = batch(a, st => { st.products.push({ ...st.products[0], id: 'tov-primer', src: 'manual', name: 'Товар-пример' }); });
  allowed(check(a, pr, 'p1'), 'честный товар');
  denied(check(a, tamper(pr, 'products', 'tov-primer', a.S.products[0].id), 'p1'), 'товар с id существующего', /Нет прав/);
});
