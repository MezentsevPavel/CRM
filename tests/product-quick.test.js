'use strict';
// Слова директора: «Мне часто нужен товар, которого нет в номенклатуре; приходится вручную создавать. Когда подбираешь станцию и
// добавляешь товар в сделку — вот тогда нужен». Здесь: кнопка «Создать „…“ в каталоге и добавить в сделку» (сделка, новая поставка,
// заявка на отправку), общее окно создания товара с обратным вызовом (pqOpen), создание и строка одним действием — одним save(),
// откат, если строку добавить нельзя, и сервер: пачка «товар + строка сделки» одним запросом. Данные искусственные.

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.js');
const kit = require('./server-kit.js');

const NOW = new Date(2026, 10, 7, 12, 0, 0);
const asDirector = app => { app.setMe(app.S.people.find(p => p.role === 'director').id); return app; };
const NAME = 'Тестовый разъём ЩМП-9 (нет в номенклатуре)';

function counted(app) {
  const saves = [];
  Object.defineProperty(app.storage, app.Store.KEY, { set: v => saves.push(v), get: () => saves[saves.length - 1], configurable: true, enumerable: true });
  return saves;
}
// сделка, в которую директор может добавлять строки
function dealOf(app) { return app.S.deals.find(d => d.items && d.items.length) || app.S.deals[0]; }

test('сделка: поиск без результата и просто поиск — ссылка «Создать „…“ в каталоге и добавить в сделку»; без запроса её нет', () => {
  const a = asDirector(load({ now: NOW })), d = dealOf(a);
  assert.ok(!a.dealFound(d, '').includes('pq-open'), 'без запроса ссылки нет');
  assert.ok(!a.dealFound(d, 'а').includes('pq-open'), 'одна буква — ещё не поиск');
  const none = a.dealFound(d, NAME);
  assert.ok(none.includes('В каталоге такого нет'));
  assert.ok(none.includes('data-act="pq-open"') && none.includes('data-kind="deal"') && none.includes(`data-id="${d.id}"`));
  assert.ok(none.includes(`Создать «${NAME}» в каталоге и добавить в сделку`));
  // под найденным она тоже есть
  const found = a.dealFound(d, 'инвертор');
  assert.ok(found.includes('class="dpr"') && found.includes('data-act="pq-open"'), 'под результатами — мелкой ссылкой');
  // набранное экранируется
  const xss = a.dealFound(d, '<b>x"y');
  assert.ok(!xss.includes('<b>x"y') && xss.includes('data-name="&lt;b&gt;x&quot;y"'), xss.slice(-300));
});

test('окно создания: название подставлено, есть артикул, категория (с «Без раздела») и единица; «Создать» — товар и строка сделки одним сохранением', () => {
  const a = asDirector(load({ now: NOW })), d = dealOf(a);
  const before = a.S.products.length, items = d.items.length;
  a.A['pq-open']({ dataset: { kind: 'deal', id: d.id, name: NAME } });
  const html = a.byId('pq-root').innerHTML;
  assert.ok(html.includes('data-form="pq"') && html.includes(`value="${NAME}"`), 'название не подставлено');
  for (const id of ['pq-sku', 'pq-cat', 'pq-unit']) assert.ok(html.includes(`id="${id}"`), `нет поля ${id}`);
  assert.ok(html.includes('Без раздела') && html.includes('Электрика › Автоматы') || html.includes('Электрика'), 'в выборе нет дерева категорий');
  assert.equal(a.S.products.length, before, 'до «Создать» ничего не создано');
  const saves = counted(a);
  a.byId('pq-name').value = NAME; a.byId('pq-sku').value = 'ЩМП-9'; a.byId('pq-cat').value = 'Без раздела'; a.byId('pq-unit').value = 'шт';
  a.FORMS.pq();
  assert.equal(saves.length, 1, 'создание товара и строка в сделку — одно сохранение');
  assert.equal(a.S.products.length, before + 1);
  const p = a.S.products.at(-1);
  assert.deepEqual([p.name, p.sku, p.cat, p.unit, p.price, p.src], [NAME, 'ЩМП-9', 'Без раздела', 'шт', null, 'user']);
  const dd = a.S.deals.find(x => x.id === d.id);
  assert.equal(dd.items.length, items + 1);
  const line = dd.items.at(-1);
  assert.equal(line.productId, p.id);
  assert.ok(typeof line.price !== 'number', 'цена строки — «нет данных», не 0');
  assert.equal(a.byId('pq-root').innerHTML, '', 'окно закрыто');
  // сделка показывает строку; остаток — «нет данных»; поиск находит новый товар
  const card = a.dealItems(dd, true);
  assert.ok(card.includes(NAME) && card.includes('ЩМП-9'));
  assert.ok(a.dealFound(dd, 'ЩМП-9').includes(`data-pid="${p.id}"`), 'поиск не находит созданный товар');
  assert.ok(a.dealFound(dd, NAME).includes('остаток: нет данных'));
});

test('окно создания: такое название уже есть — отказ с текстом, ничего не создано и не добавлено, окно остаётся', () => {
  const a = asDirector(load({ now: NOW })), d = dealOf(a);
  const p0 = a.S.products[0], before = a.S.products.length, items = d.items.length;
  a.A['pq-open']({ dataset: { kind: 'deal', id: d.id, name: p0.name } });
  a.byId('pq-name').value = p0.name; a.byId('pq-sku').value = ''; a.byId('pq-cat').value = 'Без раздела'; a.byId('pq-unit').value = 'шт';
  a.FORMS.pq();
  assert.equal(a.S.products.length, before);
  assert.equal(d.items.length, items);
  assert.match(a.byId('pq-err').textContent, /уже есть/);
  assert.ok(a.byId('pq-root').innerHTML.includes('data-form="pq"'), 'окно закрылось');
});

test('окно создания: строку в сделку добавить нельзя (сделки нет) — товар не остаётся, дерево категорий тоже', () => {
  const a = asDirector(load({ now: NOW }));
  const before = a.S.products.length, cats = a.S.categories.length;
  a.A['pq-open']({ dataset: { kind: 'deal', id: 'Д-нет-такой', name: NAME } });
  a.byId('pq-name').value = NAME; a.byId('pq-cat').value = 'Без раздела'; a.byId('pq-unit').value = 'шт'; a.byId('pq-sku').value = '';
  const saves = counted(a);
  a.FORMS.pq();
  assert.equal(a.S.products.length, before, 'товар остался без строки');
  assert.equal(a.S.categories.length, cats);
  assert.equal(saves.length, 0, 'при отказе сохранения нет');
  assert.ok(a.byId('pq-err').textContent.length > 0 && !a.byId('pq-err').hidden);
});

test('окно создания: без права «Добавлять товары» кнопка отказывает, окно не открывается', () => {
  const a = load({ now: NOW });
  const mgr = a.S.people.find(p => p.role === 'managerB2b' || /manager/i.test(p.role));
  a.setMe(mgr.id);
  a.S.roles.find(r => r.id === mgr.role).perms.catalog = false;
  const d = a.S.deals.find(x => a.Leads.dealsVisible(a.S, mgr.id).some(v => v.id === x.id));
  assert.equal(a.can('catalog'), false);
  assert.ok(!a.dealFound(d, NAME).includes('pq-open'), 'ссылка не показывается без права');
  a.A['pq-open']({ dataset: { kind: 'deal', id: d.id, name: NAME } });
  assert.equal(a.byId('pq-root').innerHTML, '');
});

test('поставка и заявка на отправку: то же окно (одна функция pqOpen); созданный товар попадает в форму', () => {
  const a = asDirector(load({ now: NOW }));
  // новая поставка: рядом с «Ещё позиция» есть кнопка того же действия
  assert.ok(a.MODALS.ship().includes('data-act="pq-open"') && a.MODALS.ship().includes('data-kind="ship"'));
  let rows = 0;
  a.byId('ns-items').insertAdjacentHTML = (where, html) => { rows += (html.match(/class="irow"/g) || []).length; assert.ok(html.includes(NAME), 'в новой строке нет созданного товара'); };
  a.A['pq-open']({ dataset: { kind: 'ship', name: NAME } });
  assert.ok(a.byId('pq-root').innerHTML.includes('data-form="pq"'));
  a.byId('pq-name').value = NAME; a.byId('pq-cat').value = 'Без раздела'; a.byId('pq-unit').value = 'шт'; a.byId('pq-sku').value = '';
  a.FORMS.pq();
  assert.ok(a.S.products.some(p => p.name === NAME));
  assert.equal(rows, 1, 'в форму поставки добавлена строка с новым товаром');
  // заявка на отправку: поиск без результата — та же ссылка; созданный товар встаёт в черновик
  a.A['dispatch-new'] ? a.A['dispatch-new']({ dataset: {} }) : a.openDispatchNew({});
  const draft = a.dspDraft();
  assert.ok(draft, 'черновик заявки не открыт');
  assert.ok(a.dspPresHtml('zzzzzz-нет').includes('data-act="pq-open"') && a.dspPresHtml('zzzzzz-нет').includes('data-kind="dsp"'));
  const n = draft.items.length;
  a.A['pq-open']({ dataset: { kind: 'dsp', name: 'Другой тестовый товар для заявки' } });
  a.byId('pq-name').value = 'Другой тестовый товар для заявки'; a.byId('pq-cat').value = 'Без раздела'; a.byId('pq-unit').value = 'шт'; a.byId('pq-sku').value = '';
  a.FORMS.pq();
  const made = a.S.products.find(p => p.name === 'Другой тестовый товар для заявки');
  assert.ok(made && draft.items.length === n + 1 && draft.items.at(-1).productId === made.id, 'товар не встал в заявку');
});

// ——— сервер ———
async function world(srv) {
  const boss = await kit.director(srv);
  const mgr = await kit.employee(srv, boss, { id: 'p3', name: 'Менеджер (тест)', role: 'managerB2b', dept: 'sales' });
  const eng = await kit.employee(srv, boss, { id: 'p4', name: 'Инженер (тест)', role: 'engineer', dept: 'eng' });
  // сделка менеджера: берём устройство сделки из демо, в базе директор заводит её на менеджера
  const a = load({ now: NOW });
  const deal = JSON.parse(JSON.stringify(a.S.deals.find(d => d.type === 'b2b')));
  Object.assign(deal, { id: 'Д-900', managerId: 'p3', items: [], clientId: null, client: 'Клиент (тест)' });
  const r = await kit.changes(srv, boss.cookie, [{ key: 'deals', id: deal.id, base: null, data: deal }]);
  assert.equal(r.status, 200, r.text);
  return { boss, mgr, eng, deal, a };
}
const product = (a, id) => ({ id, name: 'Серверный тестовый товар ' + id, brand: null, cat: 'Без раздела', price: null, avail: null, url: null, src: 'user', inCatalog: false, unit: 'шт', sku: 'СТ-1' });

test('сервер: менеджер присылает «новый товар + строка сделки» одной пачкой — принято, товар и строка на месте', async () => {
  const srv = await kit.start();
  try {
    const { mgr, deal, a } = await world(srv);
    const st = await kit.state(srv, mgr.cookie);
    const cur = st.deals.find(d => d.id === deal.id);
    assert.ok(cur, 'менеджер не видит свою сделку');
    const p = product(a, 'u-s1');
    const next = JSON.parse(JSON.stringify(cur));
    next.items = [{ id: 'i1', productId: p.id, qty: 1, price: null, disc: 0 }];
    const r = await kit.changes(srv, mgr.cookie, [
      { key: 'products', id: p.id, base: null, data: p },
      { key: 'deals', id: deal.id, base: deal, data: next },
    ]);
    assert.equal(r.status, 200, r.text);
    const after = await kit.state(srv, mgr.cookie);
    assert.ok(after.products.some(x => x.id === p.id && x.sku === 'СТ-1'));
    assert.equal(after.deals.find(d => d.id === deal.id).items[0].productId, p.id);
  } finally { await srv.stop(); }
});

test('сервер: без права на сделку (инженер) пачка «новый товар + строка сделки» отклоняется целиком — товара тоже нет', async () => {
  const srv = await kit.start();
  try {
    const { boss, eng, deal, a } = await world(srv);
    const st = await kit.state(srv, boss.cookie);
    const cur = st.deals.find(d => d.id === deal.id);
    const p = product(a, 'u-s2');
    const next = JSON.parse(JSON.stringify(cur));
    next.items = [{ id: 'i1', productId: p.id, qty: 1, price: null, disc: 0 }];
    const r = await kit.changes(srv, eng.cookie, [
      { key: 'products', id: p.id, base: null, data: p },
      { key: 'deals', id: deal.id, base: deal, data: next },
    ]);
    assert.equal(r.status, 403, r.text);
    const after = await kit.state(srv, boss.cookie);
    assert.ok(!after.products.some(x => x.id === p.id), 'товар создался, хотя пачка отклонена');
    assert.equal(after.deals.find(d => d.id === deal.id).items.length, 0);
    // а сам товар без строки инженер создать может (право catalog у всех ролей)
    const ok = await kit.changes(srv, eng.cookie, [{ key: 'products', id: p.id, base: null, data: p }]);
    assert.equal(ok.status, 200, ok.text);
  } finally { await srv.stop(); }
});
