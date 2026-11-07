'use strict';
// Просьба директора 2026-11-07: в каждой карточке товара всегда таблица «юрлицо × склады» (пусто — 0, остаток, резерв, свободно,
// итоги, справа внизу «Свободно всего»); и шаг назад в карточках справа (товар → резерв → сделка → «← Назад» → товар).
// Числа разобраны руками: товар tp — «ИП, Иркутск» 10, «НПП, Москва» 4; резерв сделки со склада ИП/Иркутск — 3; резерв «для кого»
// на «ВС, Краснодар» — 2 при остатке 0 (свободно −2); резерв под поставку П-9 — 5 (в таблицу не входит).
// Всего на складах 14, в резерве со склада 5, свободно 9.

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.js');

const plain = html => String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const N = '(-?\\d[\\d\\u00a0\\u202f ]*)', int = s => Number(s.replace(/[  \s]/g, ''));
const js = x => JSON.parse(JSON.stringify(x)); // объекты из vm-контекста — в обычные
const NOW = new Date(2026, 10, 7, 12, 0);
const until = new Date(2026, 10, 20);

function withProduct(app, id, stock, reserves = []) {
  const { S } = app;
  S.products.push({ id, name: 'Товар ' + id, brand: null, cat: 'Панели', unit: 'шт', price: null, avail: null, url: null, src: 'user', inCatalog: false });
  if (stock) S.stock[id] = stock;
  for (const r of reserves) S.reserves.push({ id: 'r-' + id + '-' + S.reserves.length, productId: id, src: 'stock', until, by: S.me, at: NOW, ...r });
  return S.products.at(-1);
}
const asDirector = app => { app.setMe(app.S.people.find(p => p.role === 'director').id); return app; };

// строки таблицы карточки: {название: [{have, held, free}]}, последняя ячейка строки — «Итого» по юрлицу
function parse(body) {
  const out = {};
  const tbl = body.match(/<table class="tbl mx">[\s\S]*?<\/table>/);
  assert.ok(tbl, 'в карточке нет таблицы «юрлицо × склады»');
  for (const tr of tbl[0].matchAll(/<tr><th scope="row">(.*?)<\/th>(.*?)<\/tr>/g)) {
    out[tr[1]] = [...tr[2].matchAll(/<td[^>]*>(.*?)<\/td>/g)].map(td => {
      const m = td[1].match(new RegExp(`<b[^>]*>${N}</b><small>резерв ${N}</small><small[^>]*>свободно ${N}</small>`));
      return m ? { have: int(m[1]), held: int(m[2]), free: int(m[3]) } : td[1];
    });
  }
  return { rows: out, head: [...tbl[0].matchAll(/<th class="num">(.*?)<\/th>/g)].map(m => m[1]), html: tbl[0] };
}

test('карточка товара без данных по остатку: таблица есть, везде 0, итого 0, подпись, что чисел в таблице остатков нет', () => {
  const app = asDirector(load());
  const p = withProduct(app, 'tp0', null);
  const body = app.DRAWERS.product(p.id).body;
  const t = parse(body);
  assert.deepEqual(t.head, ['Иркутск', 'Москва', 'Краснодар', 'Итого'], 'столбцы — склады из справочника и «Итого»');
  assert.deepEqual(Object.keys(t.rows), ['ИП', 'НПП', 'ВС', 'Итого'], 'строки — юрлица и «Итого»');
  for (const [name, cells] of Object.entries(t.rows)) {
    assert.equal(cells.length, 4, name);
    // у строки «Итого» последняя ячейка — «Свободно всего», она другая (проверена ниже)
    for (const c of name === 'Итого' ? cells.slice(0, -1) : cells) assert.deepEqual(c, { have: 0, held: 0, free: 0 }, `в строке «${name}» не нули`);
  }
  assert.match(plain(t.html), /Свободно всего 0 по факту на складах 0/);
  assert.ok(plain(body).includes('чисел нет'), 'не сказано, что нули стоят вместо «нет данных»');
});

test('таблица: клетка с остатком и резервом — остаток, резерв, свободно; итоги по строке, столбцу и «Свободно всего»; резерв под поставку не входит', () => {
  const app = asDirector(load());
  const deal = app.S.deals[0].id;
  const p = withProduct(app, 'tp1', { ip: { irk: 10 }, npp: { msk: 4 } }, [
    { qty: 3, entityId: 'ip', cityId: 'irk', dealId: deal },
    { qty: 2, entityId: 'vs', cityId: 'krd', forWho: 'под Иванова' },
    { qty: 5, entityId: null, cityId: null, src: 'П-9', dealId: deal },
  ]);
  const t = parse(app.DRAWERS.product(p.id).body).rows;
  const c = (have, held) => ({ have, held, free: have - held });
  assert.deepEqual(t['ИП'], [c(10, 3), c(0, 0), c(0, 0), c(10, 3)], 'ИП: Иркутск 10/3/7, итого строки 10/3/7');
  assert.deepEqual(t['НПП'], [c(0, 0), c(4, 0), c(0, 0), c(4, 0)]);
  assert.deepEqual(t['ВС'], [c(0, 0), c(0, 0), c(0, 2), c(0, 2)], 'резерв без остатка — свободно −2');
  assert.deepEqual(t['Итого'].slice(0, 3), [c(10, 3), c(4, 0), c(0, 2)], 'итоги по складам');
  assert.match(plain(parse(app.DRAWERS.product(p.id).body).html), /Свободно всего 9 по факту на складах 14 в резерве 5/);
  assert.ok(/<small class="bad-t">свободно -2<\/small>/.test(app.DRAWERS.product(p.id).body), 'отрицательное свободно не красное');
  // то же число отдаёт ядро: Stock.table, а свободное — как в Stock.summary
  const k = app.Stock.summary(app.S, p.id, NOW), tb = app.Stock.table(app.S, p.id);
  assert.equal(tb.all.free, k.free);
  assert.equal(tb.all.have, k.onHand);
  assert.equal(tb.all.held, k.reservedStock);
  assert.equal(k.reservedIncoming, 5, 'резерв под поставку считается отдельно');
});

test('таблица: резерв на склад, которого нет среди остатков («нет данных: город»), виден отдельным столбцом, и итоги сходятся с Stock.summary', () => {
  const app = asDirector(load());
  const p = withProduct(app, 'tp3', { ip: { irk: 10 } }, [{ qty: 2, entityId: 'ip', cityId: null }]);
  const t = parse(app.DRAWERS.product(p.id).body);
  assert.deepEqual(t.head, ['Иркутск', 'Москва', 'Краснодар', 'нет данных: город', 'Итого']);
  assert.deepEqual(t.rows['ИП'][3], { have: 0, held: 2, free: -2 });
  assert.match(plain(t.html), /Свободно всего 8 по факту на складах 10 в резерве 2/);
  assert.equal(app.Stock.summary(app.S, p.id, NOW).free, 8);
});

test('«Свободно всего» в таблице и «Свободно сейчас» в карточке — одно число (Stock.summary) у каждого товара с остатком', () => {
  const app = asDirector(load());
  let checked = 0, withRes = 0;
  for (const p of app.S.products) {
    const k = app.Stock.summary(app.S, p.id, NOW);
    if (!k.known) continue;
    const tb = app.Stock.table(app.S, p.id);
    assert.equal(tb.all.free, k.free, `${p.name}: свободно в таблице и в summary`);
    assert.equal(tb.all.have, k.onHand, `${p.name}: на складах`);
    const body = app.DRAWERS.product(p.id).body;
    assert.equal(int(plain(body).match(new RegExp('Свободно сейчас ' + N))[1]), k.free);
    assert.equal(int(plain(parse(body).html).match(new RegExp('Свободно всего ' + N))[1]), k.free, `${p.name}: карточка и таблица расходятся`);
    checked++; if (k.reservedStock) withRes++;
    if (checked >= 300 && withRes >= 3) break;
  }
  assert.ok(checked >= 20 && withRes >= 1, `проверка слабая: ${checked} товаров, ${withRes} с резервом`);
});

// ——— шаг назад в карточках справа ———
function probes(app) {
  const gone = new Set();
  for (const k of ['pa', 'pb', 'pc']) app.DRAWERS[k] = id => (gone.has(k) ? null : { kind: 'Проба', title: 'Карточка ' + k, sub: '', body: `<p>тело ${k}</p>` });
  return gone;
}
const stack = app => js((app.S.ui.drawerBack || []).map(x => x.type));
const html = app => app.byId('drawer-root').innerHTML;

test('шаг назад: товар → сделка → «← Назад» → снова товар; крестик закрывает всё и очищает стек', () => {
  const app = asDirector(load());
  const deal = app.S.deals[0];
  const p = withProduct(app, 'tp2', { ip: { irk: 10 } }, [{ qty: 3, entityId: 'ip', cityId: 'irk', dealId: deal.id }]);
  app.A['open-product']({ dataset: { pid: p.id } });
  assert.ok(!html(app).includes('data-act="drawer-back"'), 'на первой карточке есть «Назад»');
  app.A['open-deal']({ dataset: { id: deal.id } });
  assert.deepEqual(js(app.S.ui.drawer), { type: 'deal', id: deal.id });
  assert.deepEqual(stack(app), ['product']);
  assert.ok(html(app).includes('data-act="drawer-back"') && html(app).includes('← Назад'), 'нет кнопки «← Назад»');
  // нажатие на кнопку идёт тем же обработчиком кликов страницы
  const btn = { tagName: 'BUTTON', dataset: { act: 'drawer-back' }, classList: { contains: () => false } };
  btn.closest = sel => (sel === '[data-act]' ? btn : null);
  app.document.dispatchEvent({ type: 'click', target: btn });
  assert.deepEqual(js(app.S.ui.drawer), { type: 'product', id: p.id }, 'назад не вернул товар');
  assert.ok(html(app).includes(app.esc(p.name)) && !html(app).includes('data-act="drawer-back"'));
  assert.deepEqual(stack(app), []);
  // товар → сделка → крестик: закрыто всё, стек пуст
  app.A['open-deal']({ dataset: { id: deal.id } });
  assert.deepEqual(stack(app), ['product']);
  app.A['close-drawer']();
  assert.equal(app.S.ui.drawer, null);
  assert.equal(html(app), '');
  assert.deepEqual(stack(app), [], 'после крестика стек остался');
});

test('шаг назад: цепочка из трёх карточек идёт по одной; открытие из списка (с закрытого экрана) начинает стек заново', () => {
  const app = asDirector(load());
  probes(app);
  app.openDrawer('pa', '1'); app.openDrawer('pb', '1'); app.openDrawer('pc', '1');
  assert.deepEqual(stack(app), ['pa', 'pb']);
  app.A['drawer-back']();
  assert.deepEqual([app.S.ui.drawer.type, stack(app)], ['pb', ['pa']]);
  app.A['drawer-back']();
  assert.deepEqual([app.S.ui.drawer.type, stack(app)], ['pa', []]);
  assert.ok(!html(app).includes('drawer-back'));
  // та же карточка ещё раз — стек не растёт
  app.openDrawer('pa', '1'); app.openDrawer('pb', '1'); app.openDrawer('pb', '1');
  assert.deepEqual(stack(app), ['pa']);
  // из списка: экран закрыт (карточки нет) — прежний стек не тянется
  app.S.ui.drawer = null;
  app.openDrawer('pc', '2');
  assert.deepEqual(stack(app), [], 'из списка стек начался не заново');
  assert.ok(!html(app).includes('drawer-back'));
  // и после закрытия крестиком открытие снова с чистого стека
  app.openDrawer('pa', '1'); app.openDrawer('pb', '1'); app.A['close-drawer'](); app.openDrawer('pc', '1');
  assert.deepEqual(stack(app), []);
});

test('шаг назад: пропавшая карточка в стеке пропускается; нет ни одной живой — остаёмся на текущей без кнопки', () => {
  const app = asDirector(load());
  const gone = probes(app);
  app.openDrawer('pa', '1'); app.openDrawer('pb', '1'); app.openDrawer('pc', '1');
  gone.add('pb');
  app.A['drawer-back']();
  assert.equal(app.S.ui.drawer.type, 'pa', 'пропавшая карточка не пропущена');
  assert.deepEqual(stack(app), []);
  app.openDrawer('pb', '1'); app.openDrawer('pc', '1');
  gone.add('pa'); gone.add('pb');
  app.A['drawer-back']();
  assert.equal(app.S.ui.drawer.type, 'pc', 'пропала вся история — карточка должна остаться');
  assert.ok(!html(app).includes('drawer-back'), 'кнопка осталась без карточки, куда вернуться');
});

test('шаг назад: открыто то, что закрыто правами, — всё закрывается, как раньше; Esc закрывает всё', () => {
  const app = asDirector(load());
  probes(app);
  app.openDrawer('pa', '1'); app.openDrawer('pb', '1');
  app.document.dispatchEvent({ type: 'keydown', key: 'Escape', target: { matches: () => false } });
  assert.equal(app.S.ui.drawer, null);
  assert.deepEqual(stack(app), []);
  app.openDrawer('pa', '1');
  app.openDrawer('нет-такого', '1');
  assert.equal(app.S.ui.drawer, null);
  assert.equal(html(app), '');
});
