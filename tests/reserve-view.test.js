'use strict';
// Ремонт склада после ремонта F1: что человек видит в резерве. Правило одно на все места (Stock.reserveView):
//   · резерв видят все, у кого есть право «остатки»: сколько, где и до какого числа;
//   · номер сделки и клиента — только тот, кому сделка видна (Leads.dealsVisible); остальным «сделка скрыта».
// Места: карточка товара (резервы и журнал), журнал движений, карточка поставки, превью приёмки, текст уведомления.
// Числа считаются руками по демо-данным: резерв r1 — 22 шт панели для Д-311 (B2C, Иванов Сергей) со склада «ИП» без города,
// r2 — 36 шт для Д-314 (B2B, КФХ Петровых) оттуда же, r3 — 54 шт для Д-320 (B2B, ИП Кузнецов) из поставки П-1043.
// Люди: p1 директор, p2 менеджер B2C, p3 менеджер B2B, p5 кладовщик, p6 логист.
// По умолчанию кладовщик видит клиентов и сделки (слово директора 2026-11-01), поэтому «кладовщик без сделки и клиента» здесь —
// кладовщик, у которого директор в «Настройках → Роли» снял «клиенты» и «все типы» (hidden); без этого — отдельный тест внизу.

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.js');

const plain = x => JSON.parse(JSON.stringify(x));
const hidden = app => { Object.assign(app.S.roles.find(r => r.id === 'warehouse').perms, { clients: false, dealsAll: false }); return app; };

const NOW = new Date(2026, 10, 1, 12, 0);
const PANEL = 'sheet-004';
const HIDDEN = 'сделка скрыта';
const B2C_CLIENTS = ['Иванов Сергей', 'Смирнова Елена', 'Волкова Мария'];
const B2B_CLIENTS = ['КФХ Петровых', 'ИП Кузнецов'];

// кусок HTML между заголовком раздела и следующим заголовком
const section = (html, title) => {
  const i = html.indexOf(`<h4 class="sh">${title}</h4>`);
  assert.ok(i >= 0, `в карточке нет раздела «${title}»`);
  const rest = html.slice(i + 1);
  const j = rest.indexOf('<h4 class="sh">');
  return j < 0 ? rest : rest.slice(0, j);
};
const rowsOf = html => (html.split('<tbody>')[1] || '').split('</tbody>')[0].split('<tr').slice(1);
const count = (html, what) => html.split(what).length - 1;
const journalOf = app => { app.S.ui.mvPid = ''; app.S.ui.mvKind = ''; return app.movesTable(); };

// ——— 1. Кладовщик: резерв виден, сделка и клиент — нет ———
test('кладовщик в карточке товара видит количество, место и срок каждого резерва, но ни номера сделки, ни клиента, ни кнопок', () => {
  const app = hidden(load()), S = app.S;
  app.setMe('p5');
  assert.equal(app.can('clients'), false, 'у кладовщика появилось право «клиенты» — тест о другом');
  const body = app.DRAWERS.product(PANEL).body;
  const res = section(body, 'Резервы');
  const rows = rowsOf(res);
  assert.equal(rows.length, 3, 'строк резервов должно быть три: 22, 36 и 54');
  // сколько
  for (const q of [22, 36, 54]) assert.equal(count(res, `<td class="num">${q}</td>`), 1, `нет количества ${q}`);
  // где: со склада «юрлицо · город», под поставку — номер поставки
  assert.equal(count(res, 'ИП · нет данных: город'), 2, 'не названо, на каком складе лежат r1 и r2');
  assert.ok(res.includes('едет: П-1043'), 'не названа поставка, под которую стоит r3');
  // до какого числа
  for (const r of S.reserves.filter(x => x.productId === PANEL)) assert.ok(res.includes(app.fD(r.until)), `нет срока резерва ${r.id}`);
  // сделка и клиент скрыты везде в карточке — и в резервах, и в журнале движений
  for (const t of ['Д-311', 'Д-314', 'Д-320', ...B2C_CLIENTS, ...B2B_CLIENTS]) assert.ok(!body.includes(t), `карточка называет «${t}»`);
  assert.equal(count(res, HIDDEN), 3, 'вместо сделки в каждой строке должно быть «сделка скрыта»');
  for (const a of ['open-deal', 'unreserve', 'stock-sell']) assert.ok(!res.includes(`data-act="${a}"`), `у кладовщика кнопка ${a} по чужой сделке`);
  assert.ok(!body.includes('Ещё в резерве по сделкам, которых вы не видите'), 'осталась заглушка вместо строк резервов');
});

test('логист (тоже без права «клиенты») видит в карточке товара те же строки резервов, что кладовщик', () => {
  const app = load();
  app.setMe('p6');
  const res = section(app.DRAWERS.product(PANEL).body, 'Резервы');
  assert.equal(rowsOf(res).length, 3);
  assert.equal(count(res, HIDDEN), 3);
  assert.ok(!res.includes('Д-311') && !res.includes('Иванов'));
});

// ——— 2. Менеджер B2B: чужую (B2C) сделку не видит, количество видит ———
test('менеджер B2B: в карточке товара резерв сделки B2C — количество и место без номера и клиента; свои сделки названы', () => {
  const app = load();
  app.setMe('p3');
  const body = app.DRAWERS.product(PANEL).body;
  const res = section(body, 'Резервы');
  assert.equal(rowsOf(res).length, 3);
  assert.equal(count(res, `<td class="num">22</td>`), 1, 'количество резерва сделки B2C пропало');
  assert.equal(count(res, HIDDEN), 1, 'ровно одна чужая сделка (Д-311)');
  // чужое — нигде в карточке (резервы + журнал движений)
  for (const t of ['Д-311', ...B2C_CLIENTS]) assert.ok(!body.includes(t), `менеджер B2B видит «${t}»`);
  // свои — названы, со ссылкой и кнопками
  for (const t of ['Д-314', 'КФХ Петровых', 'Д-320', 'ИП Кузнецов']) assert.ok(res.includes(t), `своя сделка пропала: ${t}`);
  assert.ok(res.includes('data-act="open-deal" data-id="Д-314"'));
  assert.ok(res.includes('data-act="unreserve" data-id="r2"') && !res.includes('data-id="r1"') && !res.includes('data-rid="r1"'), 'кнопки: чужому нельзя, своему можно');
  // журнал движений в карточке: запись «Резерв» по Д-311 есть (количество), документ — «сделка скрыта»
  const jr = section(body, 'Журнал движений');
  assert.ok(jr.includes(HIDDEN), 'в журнале карточки у чужой сделки нет «сделка скрыта»');
});

test('менеджер B2B: вкладка «Журнал движений» не называет сделки B2C, но строки движений остаются', () => {
  const app = load(), S = app.S;
  const b2c = S.deals.filter(d => d.type === 'b2c').map(d => d.id);
  assert.ok(b2c.includes('Д-311'));
  app.setMe('p1');
  const all = journalOf(app);
  assert.ok(all.includes('Д-311'), 'директор не видит Д-311 в журнале: проверка пуста');
  app.setMe('p3');
  const mine = journalOf(app);
  for (const id of b2c) assert.ok(!mine.includes(id), `журнал менеджера B2B называет ${id}`);
  assert.ok(mine.includes(HIDDEN));
  assert.equal(count(mine, '<tr'), count(all, '<tr'), 'строк журнала стало меньше — должны скрываться только номера');
  assert.ok(mine.includes('Д-314'), 'своя сделка пропала из журнала');
});

test('кладовщик: в журнале движений нет ни одного номера сделки', () => {
  const app = hidden(load()), S = app.S;
  app.setMe('p5');
  const html = journalOf(app);
  for (const d of S.deals) assert.ok(!html.includes(d.id), `журнал кладовщика называет ${d.id}`);
  assert.ok(html.includes(HIDDEN));
});

test('менеджер B2B: в карточке поставки «Ждут этот товар» чужая сделка B2C — без номера и клиента, но с количеством', () => {
  const app = load(), S = app.S;
  // П-1042: резерв r13 (Д-305, B2C, Волкова Мария, 1 шт) и r14 (Д-314, B2B, КФХ Петровых, 2 шт)
  const ship = S.shipments.find(s => s.id === 'П-1042');
  assert.ok(ship && S.reserves.some(r => r.src === 'П-1042' && r.dealId === 'Д-305'));
  const wind = app.product('1763407769');
  app.setMe('p3');
  const body = app.DRAWERS.ship('П-1042').body;
  const waits = body.split('class="waits"')[1].split('</div>')[0];
  assert.ok(!waits.includes('Д-305') && !waits.includes('Волкова'), 'карточка поставки называет сделку B2C');
  assert.ok(!body.includes('Д-305') && !body.includes('Волкова Мария'), 'сделка B2C названа где-то ещё в карточке поставки');
  assert.ok(waits.includes(HIDDEN), 'нет «сделка скрыта»');
  assert.ok(waits.includes(`${app.low(wind.name)} — 1`), 'не видно, сколько ждёт скрытая сделка');
  assert.ok(waits.includes('Д-314 · КФХ Петровых'), 'своя сделка B2B пропала');
  assert.ok(waits.includes('data-act="open-deal" data-id="Д-314"') && !waits.includes('data-id="Д-305"'));
});

// ——— 3. Менеджер B2C: свои сделки названы ———
test('менеджер B2C видит номер и клиента своей сделки в карточке товара, в журнале и в карточке поставки', () => {
  const app = load();
  app.setMe('p2');
  const body = app.DRAWERS.product(PANEL).body;
  const res = section(body, 'Резервы');
  assert.ok(res.includes('Д-311') && res.includes('Иванов Сергей'), 'своя сделка не названа');
  assert.ok(res.includes('data-act="open-deal" data-id="Д-311"'));
  assert.ok(res.includes('data-act="unreserve" data-id="r1"'), 'у своего резерва нет «Снять»');
  // чужие (B2B) — количество есть, имён нет
  for (const t of ['Д-314', 'Д-320', ...B2B_CLIENTS]) assert.ok(!body.includes(t), `менеджер B2C видит «${t}»`);
  assert.equal(count(res, HIDDEN), 2);
  assert.equal(count(res, '<td class="num">36</td>'), 1);
  assert.ok(section(body, 'Журнал движений').includes('Д-311'), 'в журнале карточки своя сделка без номера');
  assert.ok(journalOf(app).includes('Д-311'));
  // П-1042: своя Д-305 названа, чужая Д-314 — нет
  const waits = app.DRAWERS.ship('П-1042').body.split('class="waits"')[1].split('</div>')[0];
  assert.ok(waits.includes('Д-305 · Волкова Мария'));
  assert.ok(!waits.includes('Д-314') && !waits.includes('КФХ Петровых') && waits.includes(HIDDEN));
});

test('директор видит все сделки и клиентов резервов', () => {
  const app = load();
  app.setMe('p1');
  const res = section(app.DRAWERS.product(PANEL).body, 'Резервы');
  for (const t of ['Д-311', 'Иванов Сергей', 'Д-314', 'КФХ Петровых', 'Д-320', 'ИП Кузнецов']) assert.ok(res.includes(t), `директор не видит «${t}»`);
  assert.ok(!res.includes(HIDDEN));
});

// ——— 4. Превью приёмки ———
// П-1044 «ждёт приёмки»: под неё резервы r10 (Д-318, B2C, Смирнова Елена, 1 шт) и r15 (Д-311, B2C, Иванов Сергей, 1 шт)
test('превью приёмки у кладовщика: клиентов и сделок нет, сколько ждут — есть', () => {
  const app = hidden(load()), S = app.S;
  assert.ok(app.Ships.awaitingReceipt(S).some(s => s.id === 'П-1044'));
  const waiting = S.reserves.filter(r => r.src === 'П-1044');
  assert.equal(waiting.length, 2);
  app.setMe('p5');
  app.initRcv('П-1044');
  const html = app.rcvPreview();
  const waits = section(html, 'Клиенты, которые ждут этот товар');
  for (const t of ['Смирнова', 'Иванов', 'Д-318', 'Д-311', 'менеджер Анна']) assert.ok(!html.includes(t), `превью называет «${t}»`);
  assert.ok(!waits.includes('bub out'), 'кладовщик видит текст сообщения клиенту');
  assert.equal(count(waits, HIDDEN), 2, 'каждая ожидающая сделка — одна строка «сделка скрыта»');
  for (const r of waiting) {
    const p = app.product(r.productId);
    assert.ok(waits.includes(`Ждёт: ${app.low(p.name)} — ${r.qty}`), `не видно, сколько ждёт ${r.id}`);
  }
});

test('превью приёмки у кладовщика: сокращённый резерв называется без сделки и клиента, но с числами', () => {
  const app = hidden(load()), S = app.S;
  app.setMe('p5');
  app.initRcv('П-1044');
  const r15 = S.reserves.find(r => r.id === 'r15');
  S.rcv.qty[r15.productId] = '0';   // принято 0 из 1 — резерв снимется целиком
  const html = app.rcvPreview();
  assert.ok(!html.includes('Д-311') && !html.includes('Иванов Сергей'), 'сокращённый резерв называет сделку');
  assert.ok(html.includes('снимется весь (1)'), 'нет числа, сколько снимется');
});

test('превью приёмки у директора и у менеджера своего типа называет клиентов; у менеджера другого типа — нет', () => {
  const app = load();
  app.initRcv('П-1044');
  app.setMe('p1');
  const dir = section(app.rcvPreview(), 'Клиенты, которые ждут этот товар');
  assert.ok(dir.includes('Смирнова Елена') && dir.includes('Иванов Сергей') && dir.includes('Д-318') && !dir.includes(HIDDEN));
  app.setMe('p2');
  assert.ok(section(app.rcvPreview(), 'Клиенты, которые ждут этот товар').includes('Иванов Сергей'));
  app.setMe('p3');
  const b2b = section(app.rcvPreview(), 'Клиенты, которые ждут этот товар');
  assert.ok(!b2b.includes('Иванов') && !b2b.includes('Смирнова') && count(b2b, HIDDEN) === 2);
});

// ——— 4а. Экран после приёмки ———
// «Кому что ушло» и «Сообщения клиентам»: клиента и номер сделки называет только тот, кому сделка видна; количество видно всем.
const received = (who = 'p5') => {
  const app = hidden(load()), S = app.S;
  S.rules.find(r => r.id === 'arrive').on = true;       // авто-сообщения клиентам включены
  app.setMe(who);
  app.initRcv('П-1044');
  S.rcv.photos.push('data:image/jpeg;base64,AAAA');
  const done = app.receiveShip(who, NOW);
  assert.equal(done.ok, true, done.reason);
  return app;
};
test('экран после приёмки у кладовщика: ни клиентов, ни номеров сделок, но что и сколько ушло — видно', () => {
  const app = received('p5');
  const html = app.rcvAfterHtml();
  for (const t of ['Смирнова', 'Иванов', 'Д-318', 'Д-311', 'Менеджер: ', 'здравствуйте']) assert.ok(!html.includes(t), `экран после приёмки называет «${t}»`);
  assert.ok(html.includes('Кому что ушло') && html.includes('Сообщения клиентам'), 'блоков нет');
  assert.ok(count(html, HIDDEN) >= 4, `«сделка скрыта» должна стоять у каждой ожидавшей сделки и в блоке сообщений: ${count(html, HIDDEN)}`);
  // количество и товар остались: в «Уведомите клиента» назван товар и число
  const asks = (html.match(/Уведомите клиента \(сделка скрыта\) — товар на складе: [^<]*/g) || []);
  assert.equal(asks.length, 2, 'не по одной строке «Уведомите клиента» на ожидавшую сделку');
  assert.ok(asks.every(t => /\d/.test(t)), 'в строке нет количества');
});

test('экран после приёмки у директора: клиенты, сделки и тексты сообщений на месте; у менеджера B2B (сделки B2C ему не видны) — как у кладовщика', () => {
  const dir = received('p5');          // приняла кладовщик, смотрит директор
  dir.setMe('p1');
  const html = dir.rcvAfterHtml();
  assert.ok(html.includes('Иванов Сергей') && html.includes('Д-311') && html.includes('Смирнова Елена') && html.includes('Д-318'), 'директор не видит клиентов');
  assert.ok(html.includes('Уведомите клиента: ') && html.includes('bub out') && !html.includes(HIDDEN));
  dir.setMe('p2');                     // менеджер B2C: сделки Д-311 и Д-318 его типа
  assert.ok(dir.rcvAfterHtml().includes('Иванов Сергей'));
  dir.setMe('p3');                     // менеджер B2B: сделки B2C не видит
  const b2b = dir.rcvAfterHtml();
  assert.ok(!b2b.includes('Иванов') && !b2b.includes('Смирнова') && !b2b.includes('Д-311') && b2b.includes(HIDDEN));
});

// ——— 5. Текст уведомления о резерве ———
test('уведомление о резерве: склад получает текст без сделки и клиента, директор и менеджер сделки — с ними', () => {
  const app = hidden(load()), S = app.S;
  const before = S.notes.length;
  const d = S.deals.find(x => x.id === 'Д-346');
  const idx = d.items.findIndex(it => it.productId === '342718442');
  const r = app.Deals.reserveItem(S, 'Д-346', idx, { qty: 1 }, 'p2', NOW);
  assert.equal(r.ok, true, r.reason);
  const fresh = S.notes.slice(0, S.notes.length - before).filter(n => n.kind === 'reserve');
  const textFor = id => { const n = fresh.filter(x => x.to.includes(id)); assert.equal(n.length, 1, `${id}: уведомлений о резерве ${n.length}, а нужно одно`); return n[0].text; };
  const wh = textFor('p5'), mgr = textFor('p2'), dir = textFor('p1');
  assert.ok(!wh.includes('Д-346') && !wh.includes(d.client), `кладовщику ушло: ${wh}`);
  assert.ok(/^Резерв: .+ — 1 .*до \d+ [а-я]+\.$/.test(wh), `у текста для склада потерялись товар, количество, место или срок: ${wh}`);
  assert.ok(mgr.includes(`Д-346 (${d.client})`), `менеджеру сделки ушло: ${mgr}`);
  assert.equal(dir, mgr, 'директору и менеджеру сделки — один текст');
  // получатели прежние: директора (в демо их двое: второй — «Исполнительный директор (пример)»), кладовщик, менеджер сделки;
  // ни у кого второго уведомления
  const dirs = S.people.filter(p => p.role === 'director').map(p => p.id);
  assert.deepEqual(plain([...new Set(fresh.flatMap(n => n.to))].sort()), [...dirs, 'p2', 'p5'].sort());
  assert.equal(fresh.reduce((n, x) => n + x.to.length, 0), 2 + dirs.length);
  // текст склада отличается от текста с клиентом только хвостом «для Д-346 (клиент)»
  assert.equal(mgr.replace(` для Д-346 (${d.client})`, ''), wh);
});

test('уведомление «Снят резерв»: кладовщику — без сделки и клиента, менеджеру сделки — с ними', () => {
  const app = hidden(load()), S = app.S;
  const d = S.deals.find(x => x.id === 'Д-346');
  const idx = d.items.findIndex(it => it.productId === '342718442');
  const r = app.Deals.reserveItem(S, 'Д-346', idx, { qty: 1 }, 'p2', NOW);
  const n0 = S.notes.length;
  assert.equal(app.Deals.unreserve(S, 'Д-346', r.reserve.id, 'p2', new Date(NOW.getTime() + 60000)).ok, true);
  const fresh = S.notes.slice(0, S.notes.length - n0).filter(n => n.kind === 'reserve');
  const textFor = id => fresh.find(x => x.to.includes(id)).text;
  assert.ok(!textFor('p5').includes('Д-346') && !textFor('p5').includes(d.client) && textFor('p5').startsWith('Снят резерв:'), textFor('p5'));
  assert.ok(textFor('p2').includes(`(Д-346, ${d.client})`), textFor('p2'));
});

test('уведомление о резерве сделки B2B: менеджеру B2B — с клиентом, кладовщику — без', () => {
  const app = hidden(load()), S = app.S;
  // строка, под которую можно поставить резерв: товар есть в сделке и на складе
  const can = (x, it) => it.productId && app.Deals.left(S, x, it.productId) > 0
    && app.Stock.canReserve(S, Object.assign({ productId: it.productId, qty: 1 }, app.Stock.bestCell(S, it.productId))).ok;
  const d = S.deals.find(x => x.type === 'b2b' && app.Deals.state(S, x) === 'open' && (x.items || []).some(it => can(x, it)));
  assert.ok(d, 'в демо нет открытой сделки B2B со строкой для резерва');
  const idx = d.items.findIndex(it => can(d, it));
  const before = S.notes.length;
  const r = app.Deals.reserveItem(S, d.id, idx, { qty: 1 }, d.managerId, NOW);
  assert.equal(r.ok, true, r.reason);
  const fresh = S.notes.slice(0, S.notes.length - before).filter(n => n.kind === 'reserve');
  const textFor = id => fresh.find(x => x.to.includes(id)).text;
  assert.ok(textFor(d.managerId).includes(`${d.id} (${d.client})`));
  assert.ok(!textFor('p5').includes(d.id) && !textFor('p5').includes(d.client));
});

// ——— 6. Числа не поменялись ———
test('свободный остаток и сумма резервов на демо прежние; количество резерва видят все с правом «остатки»', () => {
  const app = load(), S = app.S;
  const free = pid => app.Stock.summary(S, pid, NOW).free;
  // свободно по товарам с резервами — как до починки (считано на коде до неё); у двух товаров нет числа в таблице остатков
  // (резерв стоит только под поставку), там свободное неизвестно — null, а не «0» (G03)
  const expected = { 'sheet-004': 40, 'sheet-065': 16, '472925258': null, 'sheet-072': 0, 'sheet-107': 6, '342718442': 1520, 'sheet-164': 1572, '1763407769': null, 'sheet-207': 4 };
  for (const [pid, n] of Object.entries(expected)) assert.equal(free(pid), n, `свободно по ${pid}`);
  assert.equal(S.products.reduce((a, p) => a + free(p.id), 0), 28631, 'сумма свободного по всем 434 позициям');
  // сумма резервов: 22+36+54+2+1+1+3+2+2+1+80+20+1+2+1
  const total = S.products.reduce((a, p) => { const k = app.Stock.summary(S, p.id, NOW); return a + k.reservedStock + k.reservedIncoming; }, 0);
  assert.equal(total, 228);
  // у каждого, кто видит остатки, строки резервов дают те же 228 штук: скрывается сделка, а не количество
  let seen = 0;
  for (const p of S.people) {
    if (!app.Perms.can(S, p.id, 'stock')) { assert.equal(app.Stock.reserveView(S, S.reserves[0], p.id), null, `${p.id} без права на остатки видит резерв`); continue; }
    seen++;
    assert.equal(S.reserves.reduce((a, r) => a + app.Stock.reserveView(S, r, p.id).qty, 0), 228, `${p.id}: сумма резервов в его глазах`);
  }
  assert.ok(seen >= 5);
  // само чтение резервов и тексты остатка не меняют
  assert.equal(S.products.reduce((a, p) => a + free(p.id), 0), 28631);
});

test('Stock.reserveView: сколько, где, до какого числа; сделка — только видимая; HIDDEN в docView', () => {
  const app = hidden(load()), S = app.S, { Stock } = app;
  const r1 = S.reserves.find(r => r.id === 'r1'), r3 = S.reserves.find(r => r.id === 'r3');
  const wh = Stock.reserveView(S, r1, 'p5');
  assert.deepEqual(plain({ qty: wh.qty, where: wh.where, deal: wh.deal, inTransit: wh.inTransit }), { qty: 22, where: 'ИП · нет данных: город', deal: null, inTransit: false });
  assert.equal(wh.until, r1.until);
  assert.equal(Stock.reserveView(S, r3, 'p5').where, 'в пути: П-1043');
  assert.deepEqual(plain(Stock.reserveView(S, r1, 'p2').deal), { id: 'Д-311', client: 'Иванов Сергей' });
  assert.equal(Stock.reserveView(S, r1, 'p3').deal, null);
  assert.equal(Stock.reserveView(S, r1, 'p1').deal.id, 'Д-311');
  assert.equal(Stock.docView(S, 'Д-311', 'p3'), 'сделка скрыта');
  assert.equal(Stock.docView(S, 'Д-311', 'p2'), 'Д-311');
  assert.equal(Stock.docView(S, 'П-1043', 'p5'), 'П-1043', 'поставка — не сделка, её номер не прячется');
  assert.equal(Stock.docView(S, '', 'p5'), '');
});

// ——— Кладовщик по умолчанию: клиенты и сделки видны ———
test('кладовщик по умолчанию видит в резервах номер сделки и клиента: права «клиенты» и «все типы» у него включены', () => {
  const app = load(), S = app.S, { Stock } = app;
  app.setMe('p5');
  assert.equal(app.can('clients'), true);
  const r1 = S.reserves.find(r => r.productId === PANEL && r.dealId === 'Д-311');
  assert.ok(r1, 'в демо нет резерва по Д-311');
  assert.equal(Stock.reserveView(S, r1, 'p5').deal.id, 'Д-311');
  const body = app.DRAWERS.product(PANEL).body;
  for (const t of ['Д-311', 'Иванов Сергей']) assert.ok(body.includes(t), `кладовщик не видит «${t}»`);
  assert.ok(!section(body, 'Резервы').includes(HIDDEN), 'остались «сделка скрыта»');
});
