'use strict';
// Дела (таск 10, ядро и вид ленты): поставить, выполнить, следующий шаг, счётчики, напоминания, метки на карточках, демо.
// Ожидаемые значения посчитаны вручную по таблице сроков в тестах, а не вызовом кода под тестом.
// Время — подмена NOW: пятница 31.10.2026, 12:00. at(31, 15) — 31 октября 15:00; at(32, 0) — 1 ноября 00:00 (дата сама переходит).

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.js');

const NOW = new Date(2026, 9, 31, 12, 0);
const at = (d, h = 0, m = 0) => new Date(2026, 9, d, h, m);

// Маленькое состояние: директор, менеджер B2B (b1), менеджер B2C (c1), кладовщик (wh — карточки клиентов не видит).
// Сделка Д-301 у b1 (B2B); лид Л-101 у c1 (B2C, телефон).
function mini(app) {
  const st = Object.assign({
    // кладовщик без права «клиенты»: эти тесты проверяют отказ без права (по умолчанию у кладовщика оно есть)
    roles: app.Perms.defaultRoles().map(r => r.id === 'warehouse' ? { ...r, perms: { ...r.perms, clients: false, dealsAll: false } } : r),
    people: [
      { id: 'dir', name: 'Директор', role: 'director' },
      { id: 'b1', name: 'Менеджер B2B', role: 'managerB2b' },
      { id: 'c1', name: 'Менеджер B2C', role: 'managerB2c' },
      { id: 'wh', name: 'Кладовщик', role: 'warehouse' },
    ],
    me: 'b1', prefs: { notify: {} }, notes: [], leads: [], deals: [], clients: [], feed: [], acts: [], msgs: [], reserves: [], moves: [],
    shipments: [], pipelines: app.Pipes.defaults(), products: [], stock: {}, aside: {},
  }, app.Stock.defaults());
  st.client = app.Clients.create(st, { name: 'ООО „Пример-Агро“', inn: '0000000001', phone: '+7 900 000-00-01' }, 'dir', NOW).client;
  st.d1 = app.Deals.create(st, { clientId: st.client.id, type: 'b2b', managerId: 'b1' }, 'dir', NOW).id;
  st.lead = app.Leads.create(st, { source: 'site', name: 'Клиент-пример', phone: '+7 900 000-00-05' }, NOW, { silent: true });
  return st;
}
const D = id => ({ t: 'deal', id });
const L = id => ({ t: 'lead', id });
const call = (due, extra) => Object.assign({ type: 'call', title: 'Перезвонить', due }, extra);

test('plan: без срока или вида — отказ и missing, дело не создаётся; название по умолчанию — вид, ответственный — я, напоминания нет', () => {
  const app = load(), { Acts } = app, st = mini(app);
  let r = Acts.plan(st, D(st.d1), { type: 'call', title: 'Позвонить' }, 'b1', NOW);
  assert.equal(r.ok, false);
  assert.deepEqual([...r.missing], ['due']);
  r = Acts.plan(st, D(st.d1), { type: 'call', due: 'не дата' }, 'b1', NOW);
  assert.deepEqual([...r.missing], ['due'], 'мусор вместо срока — тоже без срока');
  r = Acts.plan(st, D(st.d1), { due: at(31, 15) }, 'b1', NOW);
  assert.deepEqual([...r.missing], ['type']);
  assert.equal(st.acts.length, 0, 'отказ не оставил дела');
  r = Acts.plan(st, D(st.d1), { type: 'meet', due: at(31, 15) }, 'b1', NOW);
  assert.equal(r.ok, true);
  const a = Acts.byId(st, r.id);
  assert.equal(a.title, 'Встреча', 'без названия — название вида');
  assert.equal(a.ownerId, 'b1');
  assert.equal(a.remind, null);
  assert.equal(a.due.getTime(), at(31, 15).getTime());
  r = Acts.plan(st, D(st.d1), call(at(31, 16), { title: '  Согласовать замер  ', remind: 15 }), 'b1', NOW);
  assert.equal(Acts.byId(st, r.id).title, 'Согласовать замер');
  assert.equal(Acts.byId(st, r.id).remind, 15);
});

test('plan: чужую карточку, закрытую карточку и сотрудника, который карточку не видит, дело не принимает', () => {
  const app = load(), { Acts, Deals } = app, st = mini(app);
  assert.equal(Acts.plan(st, D(st.d1), call(at(31, 15)), 'wh', NOW).ok, false, 'кладовщик не видит сделок');
  assert.equal(Acts.plan(st, D(st.d1), call(at(31, 15), { ownerId: 'wh' }), 'b1', NOW).ok, false, 'ответственный не видит карточку');
  assert.equal(Acts.plan(st, D(st.d1), call(at(31, 15), { ownerId: 'нет такого' }), 'b1', NOW).ok, false);
  assert.equal(Acts.plan(st, D('Д-999'), call(at(31, 15)), 'dir', NOW).ok, false, 'такой сделки нет');
  assert.equal(Acts.plan(st, D(st.d1), call(at(31, 15), { remind: -5 }), 'b1', NOW).ok, false, 'напоминание — минуты не меньше нуля');
  assert.equal(Deals.lose(st, st.d1, 'Дорого', 'b1', NOW).ok, true);
  assert.equal(Acts.plan(st, D(st.d1), call(at(31, 15)), 'b1', NOW).ok, false, 'провалена — дела ставить некуда');
  assert.equal(st.acts.length, 0);
});

test('counts: сегодня и просрочено считаются на момент now; выполненные, чужие и дела закрытых карточек не в счёте', () => {
  const app = load(), { Acts, Deals } = app, st = mini(app);
  const mk = (ref, due, owner, extra) => Acts.plan(st, ref, call(due, Object.assign({ ownerId: owner }, extra)), owner, NOW).id;
  mk(D(st.d1), at(30, 18), 'b1');          // вчера вечером — просрочено
  mk(D(st.d1), at(31, 11), 'b1');          // сегодня, час назад — просрочено
  mk(D(st.d1), at(31, 12), 'b1');          // ровно сейчас — сегодня
  mk(D(st.d1), at(31, 23, 30), 'b1');      // сегодня вечером — сегодня
  mk(D(st.d1), at(32, 0), 'b1');           // 1 ноября 00:00 — уже завтра
  const done = mk(D(st.d1), at(31, 15), 'b1');
  assert.equal(Acts.done(st, done, 'Дозвонились', 'b1', NOW).ok, true);
  mk(L(st.lead.id), at(31, 15), 'c1');     // чужое дело, лид
  // второе: дело закрытой карточки — просроченное, но сделка успешно закрыта
  const d2 = Deals.create(st, { clientId: st.client.id, type: 'b2b', managerId: 'b1' }, 'dir', NOW).id;
  mk(D(d2), at(29, 10), 'b1');
  assert.equal(Deals.win(st, d2, 'b1', NOW).ok, true);

  assert.deepEqual({ ...Acts.counts(st, 'b1', NOW) }, { today: 2, overdue: 2 });
  assert.deepEqual({ ...Acts.counts(st, 'b1', NOW, 'deal') }, { today: 2, overdue: 2 });
  assert.deepEqual({ ...Acts.counts(st, 'b1', NOW, 'lead') }, { today: 0, overdue: 0 });
  assert.deepEqual({ ...Acts.counts(st, 'c1', NOW) }, { today: 1, overdue: 0 });
  assert.deepEqual({ ...Acts.counts(st, 'c1', NOW, 'lead') }, { today: 1, overdue: 0 });
  assert.deepEqual({ ...Acts.counts(st, 'dir', NOW) }, { today: 0, overdue: 0 });
  // вечером срок 23:30 прошёл; 1 ноября 00:00 ещё впереди, но уже «сегодня» не бывает: следующие сутки
  assert.deepEqual({ ...Acts.counts(st, 'b1', at(31, 23, 45)) }, { today: 0, overdue: 4 });
  // в полночь дело на 00:00 — сегодняшнее
  assert.deepEqual({ ...Acts.counts(st, 'b1', at(32, 0)) }, { today: 1, overdue: 4 });
});

test('noNext: истинно у живой карточки без открытых дел, ложно с делом; выполнил — снова истинно; закрытая карточка «следующего шага» не требует', () => {
  const app = load(), { Acts, Leads } = app, st = mini(app);
  const ref = D(st.d1);
  assert.equal(Acts.noNext(st, ref), true);
  assert.equal(Acts.noNext(st, L(st.lead.id)), true);
  const id = Acts.plan(st, ref, call(at(31, 15)), 'b1', NOW).id;
  assert.equal(Acts.noNext(st, ref), false);
  assert.equal(Acts.noNext(st, L(st.lead.id)), true, 'дело сделки лид не закрывает');
  assert.equal(Acts.done(st, id, 'Готово', 'b1', NOW).ok, true);
  assert.equal(Acts.noNext(st, ref), true, 'дел не осталось');
  assert.equal(Acts.noNext(st, D('Д-999')), false, 'карточки нет');
  Leads.close(st, st.lead.id, 'Не вышли на связь', 'c1', NOW);
  assert.equal(Acts.noNext(st, L(st.lead.id)), false, 'лид закрыт');
});

test('open и next: ближайшее первым, выполненное не входит; у клиента — ещё дела его сделок', () => {
  const app = load(), { Acts } = app, st = mini(app);
  const ref = D(st.d1);
  const late = Acts.plan(st, ref, call(at(33, 10), { title: 'Позже' }), 'b1', NOW).id;
  const soon = Acts.plan(st, ref, call(at(31, 14), { title: 'Скоро' }), 'b1', NOW).id;
  const mid = Acts.plan(st, ref, call(at(32, 10), { title: 'Завтра' }), 'b1', NOW).id;
  assert.deepEqual(Array.from(Acts.open(st, ref), a => a.id), [soon, mid, late]);
  assert.equal(Acts.next(st, ref).id, soon);
  Acts.done(st, soon, 'Сделано', 'b1', NOW);
  assert.equal(Acts.next(st, ref).id, mid);
  // карточка клиента: его сделка видна директору — и её дела в списке клиента
  assert.deepEqual(Array.from(Acts.open(st, { t: 'client', id: st.client.id }, 'dir'), a => a.id), [mid, late]);
});

test('done: закрывает дело, пишет результат в ленту (Feed.of) серой записью; без результата, чужому и повторно — отказ', () => {
  const app = load(), { Acts, Feed } = app, st = mini(app);
  const ref = D(st.d1), T1 = at(31, 13);
  const id = Acts.plan(st, ref, call(at(31, 12, 30), { title: 'Перезвонить по КП' }), 'b1', NOW).id;
  assert.equal(Feed.of(st, ref, 'b1').filter(e => e.kind === 'act').length, 0, 'открытое дело в ленту не пишется');
  assert.equal(Acts.done(st, id, '   ', 'b1', T1).ok, false, 'без результата дело не выполняют');
  assert.equal(Acts.done(st, id, 'Договорились о замере', 'wh', T1).ok, false, 'кладовщик карточку не видит');
  assert.equal(Acts.open(st, ref).length, 1, 'отказы дело не закрыли');
  const r = Acts.done(st, id, '  Договорились о замере  ', 'b1', T1);
  assert.equal(r.ok, true);
  const a = Acts.byId(st, id);
  assert.equal(a.doneAt.getTime(), T1.getTime());
  assert.equal(a.doneBy, 'b1');
  assert.equal(a.result, 'Договорились о замере');
  assert.equal(Acts.open(st, ref).length, 0);
  const rec = Feed.of(st, ref, 'b1').filter(e => e.kind === 'act');
  assert.equal(rec.length, 1);
  assert.equal(rec[0].by, 'b1');
  assert.equal(rec[0].at.getTime(), T1.getTime());
  assert.ok(rec[0].text.includes('Перезвонить по КП') && rec[0].text.includes('Договорились о замере'), rec[0].text);
  // то же дело видно и в ленте клиента (там подмешаны ленты его сделок)
  assert.equal(Feed.of(st, { t: 'client', id: st.client.id }, 'dir').filter(e => e.kind === 'act').length, 1);
  assert.equal(Acts.done(st, id, 'Ещё раз', 'b1', T1).ok, false, 'второй раз дело не выполняют');
  assert.equal(Acts.byId(st, id).result, 'Договорились о замере', 'результат выполненного дела не правится');
});

test('due и notify: дело с напоминанием отдаётся, когда срок минус «за сколько» наступил; уведомление уходит ответственному один раз', () => {
  const app = load(), { Acts, Notify, Deals } = app, st = mini(app);
  const ref = D(st.d1);
  const a1 = Acts.plan(st, ref, call(at(31, 12, 30), { title: 'С напоминанием', remind: 15 }), 'b1', NOW).id;
  const a2 = Acts.plan(st, ref, call(at(30, 9), { title: 'Без напоминания' }), 'b1', NOW).id;           // просрочено, но напоминать не просили
  const a3 = Acts.plan(st, ref, call(at(31, 13), { title: 'Уже выполнено', remind: 0 }), 'b1', NOW).id;
  Acts.done(st, a3, 'Готово', 'b1', NOW);
  const ids = now => Array.from(Acts.due(st, now), a => a.id);
  assert.deepEqual(ids(at(31, 12, 14)), [], 'за 16 минут до срока рано');
  assert.deepEqual(ids(at(31, 12, 15)), [a1], 'ровно за 15 минут пора');
  assert.deepEqual(ids(at(40, 0)), [a1], 'без напоминания и выполненное не отдаются никогда');
  assert.equal(st.notes.length, 0, 'due ничего не рассылает');

  const made = Acts.notify(st, at(31, 12, 15));
  assert.equal(made.length, 1);
  assert.equal(st.notes.length, 1);
  assert.equal(st.notes[0].kind, 'act');
  assert.deepEqual([...st.notes[0].to], ['b1'], 'уведомление — только ответственному, не директору');
  assert.ok(st.notes[0].text.includes('С напоминанием') && st.notes[0].text.includes(st.d1), st.notes[0].text);
  assert.deepEqual(ids(at(31, 12, 20)), [], 'после напоминания дело больше не отдаётся');
  assert.equal(Acts.notify(st, at(31, 12, 20)).length, 0);
  assert.equal(st.notes.length, 1, 'одно уведомление на дело');
  assert.deepEqual(Array.from(Notify.unread(st, 'b1'), n => n.id), [st.notes[0].id]);
  assert.equal(Notify.unread(st, 'dir').length, 0);
  void a2;
  // закрытая карточка не напоминает
  const a4 = Acts.plan(st, ref, call(at(31, 18), { remind: 0 }), 'b1', NOW).id;
  Deals.lose(st, st.d1, 'Дорого', 'b1', NOW);
  assert.deepEqual(ids(at(31, 19)), [], 'сделка провалена — напоминаний нет');
  void a4;
});

test('quick: «сегодня» — 18:00 (или через час, но не позже конца дня), «завтра» и «через неделю» — 10:00', () => {
  const { Acts } = load();
  assert.equal(Acts.quick('today', NOW).getTime(), at(31, 18).getTime());
  assert.equal(Acts.quick('today', at(31, 17, 50)).getTime(), at(31, 18, 50).getTime(), 'до 18:00 меньше 15 минут — через час');
  assert.equal(Acts.quick('today', at(31, 23, 30)).getTime(), at(31, 23, 59).getTime(), 'час вперёд перешёл бы в завтра — конец дня');
  assert.equal(Acts.quick('tomorrow', NOW).getTime(), at(32, 10).getTime());
  assert.equal(Acts.quick('week', NOW).getTime(), at(38, 10).getTime());
});

test('Deals.query: фильтры «без дел» и «просрочены дела» берут Acts.matches', () => {
  const app = load(), { Acts, Deals } = app, st = mini(app);
  const d2 = Deals.create(st, { clientId: st.client.id, type: 'b2b', managerId: 'b1' }, 'dir', NOW).id;
  const d3 = Deals.create(st, { clientId: st.client.id, type: 'b2b', managerId: 'b1' }, 'dir', NOW).id;
  Acts.plan(st, D(st.d1), call(at(30, 10)), 'b1', NOW);     // просрочено
  Acts.plan(st, D(d2), call(at(33, 10)), 'b1', NOW);        // впереди
  const q = acts => Deals.query(st, { acts, now: NOW }, 'dir').map(d => d.id).sort();
  assert.deepEqual(q('none'), [d3]);
  assert.deepEqual(q('overdue'), [st.d1]);
  assert.deepEqual(q(undefined), [st.d1, d2, d3].sort());
});

// ——— вид: лента, метки ———

test('feedHtml: «Запланировать» сверху, открытые дела по срокам с красным у просроченных, выполненное серым в ленте; без права формы нет', () => {
  const app = load(), { Acts } = app, st = mini(app);
  const ref = D(st.d1);
  Acts.plan(st, ref, call(at(33, 10), { title: 'Дело-позже' }), 'b1', NOW);
  Acts.plan(st, ref, call(at(30, 10), { title: 'Дело-просроченное' }), 'b1', NOW);
  Acts.plan(st, ref, call(at(31, 15), { title: 'Дело-сегодня' }), 'b1', NOW);
  const gone = Acts.plan(st, ref, { type: 'mail', title: 'Дело-выполнено', due: at(31, 13) }, 'b1', NOW).id;
  Acts.done(st, gone, 'Письмо ушло клиенту', 'b1', at(31, 11, 30));
  const html = app.feedHtml(ref, st, NOW);

  assert.ok(html.includes('data-form="act-plan"'), 'нет формы «Запланировать»');
  assert.ok(html.indexOf('act-plan') < html.indexOf('act-list') && html.indexOf('act-list') < html.indexOf('feed-add'), 'порядок: форма дела, открытые дела, комментарий');
  assert.ok(html.indexOf('<details class="act-plan"') < html.indexOf('data-form="feed-comment"'));
  assert.match(html, /<option value="b1" selected>Менеджер B2B \(я\)<\/option>/, 'ответственный по умолчанию — я');
  for (const k of ['today', 'tomorrow', 'week']) assert.ok(html.includes(`data-q="${k}"`), 'нет быстрого срока ' + k);

  const open = html.slice(html.indexOf('<ul class="act-list"'), html.indexOf('</ul>', html.indexOf('<ul class="act-list"')));
  const order = ['Дело-просроченное', 'Дело-сегодня', 'Дело-позже'].map(t => open.indexOf(t));
  assert.ok(order.every(i => i > 0) && order[0] < order[1] && order[1] < order[2], 'открытые дела не по порядку сроков: ' + order);
  assert.ok(!open.includes('Дело-выполнено'), 'выполненное дело осталось среди открытых');
  assert.match(open, /<li class="act-i k-call over">[^]*?Дело-просроченное/, 'просроченное не красное');
  assert.doesNotMatch(open.slice(open.indexOf('Дело-сегодня') - 200, open.indexOf('Дело-сегодня')), /act-i k-call over/, 'будущее дело покрашено красным');
  assert.ok(open.includes('просрочено'), 'красное без слова');
  assert.equal((open.match(/data-act="act-done"/g) || []).length, 3, 'у каждого открытого дела — «Выполнено»');

  const list = html.slice(html.indexOf('<ol class="feed-list">'));
  assert.match(list, /feed-i k-act[^]*?Дело выполнено[^]*?Письмо ушло клиенту/, 'выполненное дело не в ленте серой записью');

  // кладовщик: ни формы дела, ни кнопок, лента закрыта
  st.me = 'wh';
  const lock = app.feedHtml(ref, st, NOW);
  assert.ok(!lock.includes('act-plan') && !lock.includes('act-done'));
});

test('feedHtml: у карточки без дел — «Нет следующего шага»; у закрытой — нет ни формы, ни этой фразы', () => {
  const app = load(), { Deals } = app, st = mini(app);
  assert.ok(app.feedHtml(D(st.d1), st, NOW).includes('Нет следующего шага'));
  Deals.lose(st, st.d1, 'Дорого', 'b1', NOW);
  const html = app.feedHtml(D(st.d1), st, NOW);
  assert.ok(!html.includes('Нет следующего шага') && !html.includes('data-form="act-plan"'));
});

test('actNextHtml: ближайшее дело или «нет следующего шага»; просроченное красным; у закрытой карточки метки нет', () => {
  const app = load(), { Acts, Leads } = app, st = mini(app);
  const ref = D(st.d1);
  assert.match(app.actNextHtml(ref, st, NOW), /нет следующего шага/);
  Acts.plan(st, ref, call(at(33, 10), { title: 'Позже' }), 'b1', NOW);
  Acts.plan(st, ref, { type: 'meet', title: 'Раньше', due: at(32, 10) }, 'b1', NOW);
  const h = app.actNextHtml(ref, st, NOW);
  assert.ok(h.includes('встреча') && !h.includes('нет следующего шага') && !h.includes('act-nx over'), h);
  Acts.plan(st, ref, call(at(30, 10), { title: 'Просрочено' }), 'b1', NOW);
  const late = app.actNextHtml(ref, st, NOW);
  assert.ok(late.includes('звонок') && late.includes('act-nx over') && late.includes('просрочено'), late);
  Leads.close(st, st.lead.id, 'Не вышли на связь', 'c1', NOW);
  assert.equal(app.actNextHtml(L(st.lead.id), st, NOW), '');
});

// ——— демо, сохранение, оболочка ———

test('демо: открытые дела просрочены, на сегодня, на потом; есть карточки без дел и выполненные дела; всё — «пример»', () => {
  const app = load(), { S, Acts } = app, now = new Date();
  const open = S.acts.filter(a => !a.doneAt), done = S.acts.filter(a => a.doneAt);
  assert.ok(open.some(a => new Date(a.due) < now), 'нет просроченных');
  assert.ok(open.some(a => new Date(a.due) > now), 'нет будущих');
  assert.ok(done.length >= 3, 'мало выполненных');
  assert.ok(done.every(a => a.result && a.doneBy), 'у выполненного нет результата');
  assert.ok(S.acts.every(a => /пример/i.test(a.title)), 'демо-дело без пометки «пример»');
  assert.ok(S.acts.every(a => a.remind === null), 'у демо-дел нет напоминаний: при запуске уведомления не сыплются');
  const noNextDeals = S.deals.filter(d => Acts.noNext(S, { t: 'deal', id: d.id }));
  const noNextLeads = S.leads.filter(l => Acts.noNext(S, { t: 'lead', id: l.id }));
  assert.ok(noNextDeals.length > 0 && noNextLeads.length > 0, 'и у сделок, и у лидов должны быть карточки без дел');
  assert.ok(S.deals.some(d => !Acts.noNext(S, { t: 'deal', id: d.id }) && Acts.alive(S, { t: 'deal', id: d.id })), 'нет сделок с делами');
  // дела пережили сохранение: срок вернулся датой
  const back = app.Store.load(app.Store.dump(S).text);
  assert.equal(back.acts.length, S.acts.length);
  assert.equal(back.acts[0].due.getTime(), S.acts[0].due.getTime(), 'срок не вернулся датой');
});

test('бейджи меню: «Сделки» — мои дела на сегодня и просроченные из Acts.counts; «Лиды» — только необработанные лиды', () => {
  // «сейчас» закреплено на полдень: демо-дела «на сегодня» стоят на 17:00 и 18:00, вечером настоящих часов их уже не остаётся
  const noon = new Date(); noon.setHours(12, 0, 0, 0);
  const app = load({ now: noon }), { S, Acts, NAV } = app;
  // человек, у которого по сделкам есть и дела на сегодня, и просроченные, а по лидам — хоть что-то: в бейдж должны попасть оба числа
  const sum = (id, t) => { const c = Acts.counts(S, id, noon, t); return c.today + c.overdue; };
  const both = id => { const c = Acts.counts(S, id, noon, 'deal'); return c.today > 0 && c.overdue > 0; };
  const p = S.people.find(x => both(x.id) && sum(x.id, 'lead') > 0);
  assert.ok(p, 'в демо нет человека с делами на сегодня и просроченными по сделкам и с делами по лидам');
  app.setMe(p.id);
  const deals = NAV.find(n => n.id === 'deals').badge(), want = sum(p.id, 'deal');
  assert.equal(deals, want, 'бейдж «Сделки» не равен Acts.counts');
  assert.ok(want > 0);
  const side = app.document.getElementById('side').innerHTML;
  const shown = side.match(/data-view="deals"><svg.*?<\/svg><span>Сделки<\/span><span class="cnt hot">(\d+)</);
  assert.ok(shown, 'на пункте «Сделки» нет числа');
  assert.equal(Number(shown[1]), want);
  // «Лиды»: только необработанные лиды (Leads.fresh); дела по лидам в число не входят (решение директора)
  assert.ok(sum(p.id, 'lead') > 0, 'у человека нет дел по лидам — проверка пустая');
  assert.equal(NAV.find(n => n.id === 'leads').badge(), app.Leads.fresh(S, p.id).length);
});

test('render: при каждой перерисовке дела, которым пора, напоминают ответственному один раз', () => {
  const app = load(), { S, Acts } = app;
  const d = S.deals.find(x => Acts.alive(S, { t: 'deal', id: x.id }));
  const r = Acts.plan(S, { t: 'deal', id: d.id }, { type: 'call', title: 'Напомнить при render', due: new Date(Date.now() - 6e4), remind: 0, ownerId: S.me }, S.me, new Date());
  assert.equal(r.ok, true, r.reason);
  const before = S.notes.length;
  app.render();
  assert.equal(S.notes.length, before + 1);
  assert.equal(S.notes[0].kind, 'act');
  assert.ok(S.notes[0].to.includes(S.me));
  assert.ok(Acts.byId(S, r.id).remindedAt, 'дело не помечено');
  app.render();
  assert.equal(S.notes.length, before + 1, 'вторая перерисовка напомнила второй раз');
});

test('экраны: метка «нет следующего шага» на карточках сделок и лидов, фильтры «Без дел» и «Просрочены дела» с числами', () => {
  const app = load(), { S, Acts, Deals } = app, now = new Date();
  const count = (html, re) => (html.match(re) || []).length;
  // сделки: директор видит все; смотрим B2B
  S.ui.dealType = 'b2b';
  const deals = Deals.query(S, { type: 'b2b' }, S.me);
  const none = deals.filter(d => Acts.noNext(S, { t: 'deal', id: d.id }));
  const late = deals.filter(d => Acts.overdue(S, { t: 'deal', id: d.id }, now));
  assert.ok(none.length > 0 && late.length > 0 && none.length < deals.length, 'в демо нет сделок без дел или с просрочкой');
  const page = app.vDeals();
  assert.ok(page.includes(`Без дел · ${none.length}<`), 'число на «Без дел»');
  assert.ok(page.includes(`Просрочены дела · ${late.length}<`), 'число на «Просрочены дела»');
  assert.equal(count(page, /act-nx none/g), none.length, 'метка «нет следующего шага» не на тех карточках');
  S.ui.deals = Object.assign({}, app.DEALS_DEF, { acts: 'none' });
  let body = app.dealsBody();
  assert.equal(count(body, /data-act="open-deal"/g), none.length);
  assert.equal(count(body, /act-nx none/g), none.length);
  S.ui.deals = Object.assign({}, app.DEALS_DEF, { acts: 'overdue' });
  assert.equal(count(app.dealsBody(), /data-act="open-deal"/g), late.length);
  // лиды (список)
  S.ui.deals = null;
  const leads = S.leads, lnone = leads.filter(l => Acts.noNext(S, { t: 'lead', id: l.id })), llate = leads.filter(l => Acts.overdue(S, { t: 'lead', id: l.id }, now));
  assert.ok(lnone.length > 0 && llate.length > 0, 'в демо нет лидов без дел или с просрочкой');
  S.ui.leads = Object.assign({}, app.LEAD_DEF, { acts: 'none' });
  body = app.leadBody();
  assert.equal(count(body, /data-act="open-lead"/g), lnone.length);
  assert.ok(app.vLeads().includes(`Без дел · ${lnone.length}<`));
  S.ui.leads = Object.assign({}, app.LEAD_DEF, { acts: 'overdue' });
  assert.equal(count(app.leadBody(), /data-act="open-lead"/g), llate.length);
  assert.ok(app.vLeads().includes(`Просрочены дела · ${llate.length}<`));
  // воронка лидов: метка и на карточке
  S.ui.leads = Object.assign({}, app.LEAD_DEF, { view: 'funnel' });
  assert.equal(count(app.leadBody(), /act-nx none/g), lnone.length);
});

// ——— карточка лида: те же «Детали» и «Лента» с делами, что у сделки ———

test('карточка лида: вкладки «Детали» и «Лента»; в ленте «Запланировать», открытые дела и комментарий; дело ставится и закрывается результатом прямо из лида', () => {
  const app = load(), { S, Acts } = app;
  const el = id => app.document.getElementById(id);
  app.setMe(S.people.find(p => p.role === 'director').id);
  const lead = S.leads.find(l => l.managerId && Acts.alive(S, L(l.id)));
  const ref = L(lead.id);
  app.A['open-lead']({ dataset: { id: lead.id } });
  // «Детали» по умолчанию: данные заявки и история, ленты с делами ещё нет
  let body = app.DRAWERS.lead(lead.id).body;
  assert.ok(body.includes('data-act="lead-tab" data-tab="details"') && body.includes('data-act="lead-tab" data-tab="feed"'), 'нет вкладок');
  assert.ok(body.includes('Текст заявки') && !body.includes('data-form="act-plan"'), 'в «Деталях» оказалась лента');
  // «Лента»: форма дела, открытые дела (если есть), комментарий
  app.A['lead-tab']({ dataset: { tab: 'feed' } });
  body = app.DRAWERS.lead(lead.id).body;
  assert.ok(body.includes('data-form="act-plan"') && body.includes('Запланировать'), 'в ленте лида нет «Запланировать»');
  assert.ok(body.includes('data-form="feed-comment"') && body.includes('data-ref-t="lead"') && body.includes(`data-ref-id="${lead.id}"`));
  assert.ok(!body.includes('Текст заявки'), 'в ленте остались «Детали»');
  // поставить дело формой, как в карточке сделки
  const before = Acts.open(S, ref).length;
  el('act-type').value = 'meet'; el('act-title').value = 'Встреча по лиду'; el('act-due').value = '2030-01-01T10:00';
  el('act-owner').value = S.me; el('act-remind').value = '';
  app.FORMS['act-plan']({ dataset: { t: 'lead', id: lead.id } });
  const open = Acts.open(S, ref);
  assert.equal(open.length, before + 1, 'дело не поставлено: ' + el('act-err').textContent);
  const made = open.find(a => a.title === 'Встреча по лиду');
  assert.ok(made && made.type === 'meet' && made.ownerId === S.me);
  body = app.DRAWERS.lead(lead.id).body;
  assert.ok(body.includes('Встреча по лиду') && body.includes(`data-act="act-done" data-id="${made.id}"`), 'открытого дела нет в ленте лида');
  assert.ok(body.includes(`<b>${open.length}</b>`), 'на вкладке «Лента» нет числа открытых дел');
  // выполнить с результатом — дело серое, в ленте
  el('ad-result').value = 'Встретились, ждёт КП';
  app.FORMS['act-done']({ dataset: { id: made.id } });
  assert.ok(Acts.byId(S, made.id).doneAt, 'дело не выполнено');
  body = app.DRAWERS.lead(lead.id).body;
  assert.ok(body.includes('Встретились, ждёт КП') && !body.includes(`data-act="act-done" data-id="${made.id}"`));
  // закрытый лид: ни формы дела, ни кнопок
  const closed = S.leads.find(l => l.stageId === 'lost');
  assert.ok(!app.DRAWERS.lead(closed.id).body.includes('data-form="act-plan"'));
  app.A['lead-tab']({ dataset: { tab: 'feed' } });
  const cb = app.DRAWERS.lead(closed.id).body;
  assert.ok(!cb.includes('data-form="act-plan"') && !cb.includes('Нет следующего шага'), 'у закрытого лида форма дела или «нет следующего шага»');
  // открытие другой карточки возвращает «Детали»
  app.A['open-lead']({ dataset: { id: lead.id } });
  assert.equal(S.ui.leadTab, 'details');
});

test('«Создать сделку» из лида: открытые дела едут в сделку, и сделка показывает их в своей ленте', () => {
  const app = load(), { S, Acts } = app;
  const lead = S.leads.find(l => l.managerId && l.type && !l.dealId && Acts.alive(S, L(l.id)) && Acts.open(S, L(l.id)).length > 0);
  assert.ok(lead, 'в демо нет открытого лида с делами');
  const mgr = lead.managerId, ids = Acts.open(S, L(lead.id)).map(a => a.id);
  app.setMe(mgr);
  app.A['lead-deal']({ dataset: { id: lead.id } });
  assert.ok(lead.dealId, 'сделка не создана');
  assert.equal(Acts.open(S, L(lead.id)).length, 0);
  assert.deepEqual([...Acts.open(S, D(lead.dealId)).map(a => a.id)].sort(), [...ids].sort());
  const feed = app.feedHtml(D(lead.dealId), S, NOW);
  assert.ok(feed.includes('перенесены открытые дела') && feed.includes('Дела из лида'), 'в ленте сделки нет записи о переносе');
  for (const id of ids) assert.ok(feed.includes(`data-act="act-done" data-id="${id}"`), 'перенесённое дело не видно среди открытых дел сделки');
});
