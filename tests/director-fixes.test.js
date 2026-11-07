'use strict';
// Поправки директора 2026-11-07 к каталогу:
// 1. «Ключ каталога — это же не нужно здесь»: числовой id товара нигде не показывается на экране (поиск по нему остаётся).
// 2. «„нет данных: артикул“ надо писать наоборот: „Артикул: нет данных“. Если артикул есть — то сам артикул».
// 3. «Если в каталоге выбираю инверторы и иду в бренды, в списке должны быть бренды именно инверторов, а не DaSolar — это панели.
//     Все бренды — только когда в дереве выбрано „Все“».

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./load.js');

const text = html => String(html).replace(/<[^>]+>/g, ' ').replace(/&nbsp;| /g, ' ').replace(/\s+/g, ' ').trim();
const asDirector = app => { app.setMe(app.S.people.find(p => p.role === 'director').id); return app; };
const fire = (app, type, key, value, extra = {}) => app.document.dispatchEvent({ type, target: { dataset: { on: key, ...extra }, value, checked: value } });
const region = (app, id) => app.document.getElementById(id).innerHTML;

// ——— 1. ключ каталога не показывается ———
test('ключ каталога (числовой id) нигде не виден: ни в строке списка, ни в заголовке и теле карточки; строки «Ключ каталога» нет', () => {
  const a = asDirector(load());
  const keys = a.CATALOG.rows.map(r => String(r.key)).filter(k => /^\d{6,}$/.test(k));
  const withKey = (name, html) => { const t = text(html); const hit = keys.find(k => t.includes(k)); assert.equal(hit, undefined, `${name}: на экране ключ каталога ${hit}`); };
  const p = a.S.products.find(x => x.inCatalog && /^\d{6,}$/.test(x.id) && x.sku);
  // строка списка и вся таблица первой страницы
  a.S.view = 'stock'; a.render();
  withKey('список', a.stockTable());
  assert.ok(!/class="mono">\d{6,}</.test(a.stockTable()), 'под названием в списке остался моноширинный id');
  // карточка
  const d = a.DRAWERS.product(p.id);
  withKey('заголовок карточки', d.title + ' ' + d.sub);
  withKey('тело карточки', d.body);
  assert.ok(!text(d.body).includes('Ключ каталога'), 'в карточке осталась строка «Ключ каталога»');
  assert.ok(text(d.sub).length >= 0);
  // позиция не из каталога по-прежнему помечена
  const out = a.S.products.find(x => !x.inCatalog);
  assert.ok(text(a.DRAWERS.product(out.id).sub + a.DRAWERS.product(out.id).body).includes('нет в каталоге'));
  // поиск по ключу работает, но показывает товар без ключа
  const found = a.Catalog.query(a.S, { q: p.id });
  assert.ok(found.some(x => x.id === p.id), 'поиск по ключу перестал работать');
  const u = a.S.ui; u.sq = p.id; u.page = 0;
  withKey('результат поиска по ключу', a.stockTable());
  assert.ok(!a.vStock().includes('ключ каталога'), 'в подсказке поиска остался «ключ каталога»');
  u.sq = '';
  // остальные экраны: поставка, приёмка, отправка, сделка, журнал
  const ship = a.S.shipments.find(s => (s.items || []).some(it => /^\d{6,}$/.test(it.productId)));
  if (ship) withKey('карточка поставки', a.DRAWERS.ship(ship.id).body);
  const deal = a.S.deals.find(x => (x.items || []).some(it => /^\d{6,}$/.test(it.productId || '')));
  if (deal) withKey('позиции сделки', a.dealItems(deal, true));
  a.S.ui.stockTab = 'moves'; a.S.view = 'stock'; a.render();
  withKey('журнал движений', region(a, 'view'));
  for (const v of ['logistics', 'receiving', 'dispatch', 'deals', 'home']) {
    if (!a.NAV.some(n => n.id === v && n.ok())) continue;
    a.S.view = v; a.render();
    withKey('экран ' + v, region(a, 'view'));
  }
});

// ——— 2. «Артикул: нет данных» ———
test('пустой артикул везде пишется «Артикул: нет данных», а есть — сам артикул (в списках без слов «арт.»)', () => {
  const a = asDirector(load());
  const have = a.S.products.find(p => a.Catalog.skuOf(p)), bare = a.S.products.find(p => !a.Catalog.skuOf(p));
  assert.ok(have && bare);
  assert.equal(a.skuText(bare), 'Артикул: нет данных');
  assert.equal(a.skuText(have), a.Catalog.skuOf(have), 'в списках — просто артикул, без «арт.»');
  assert.match(a.skuTag(bare), /<small class="sku muted">Артикул: нет данных<\/small>/);
  assert.ok(a.skuTag(have).includes(`>${a.Catalog.skuOf(have).replace(/&/g, '&amp;')}</small>`) || a.skuTag(have).includes(a.Catalog.skuOf(have).slice(0, 5)));
  assert.ok(!a.skuTag(have).includes('арт.'));
  // тексты уведомлений и ленты: при пустом артикуле ничего не дописывается, при заполненном — как решено
  assert.equal(a.Catalog.label(bare), bare.name);
  assert.equal(a.Catalog.label(have), `${have.name} (арт. ${a.Catalog.skuOf(have)})`);
  // карточка: строка «Артикул» — значение или «Артикул: нет данных» и кнопка
  assert.match(a.dProduct(bare).body, /Артикул: нет данных<\/span> <button[^>]*data-act="product-sku"[^>]*>Указать/);
  assert.match(a.dProduct(have).body, new RegExp(`<dt>Артикул</dt><dd><b class="mono">${a.Catalog.skuOf(have).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/&/g, '&amp;')}</b>`));
  // подсказки и тосты формы
  assert.ok(a.mProduct().includes('Пусто — «Артикул: нет данных»'));
  // в коде страницы старой подписи не осталось нигде
  const dir = path.join(__dirname, '..', 'src', 'js');
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.js'))) {
    assert.ok(!fs.readFileSync(path.join(dir, f), 'utf8').includes('нет данных: артикул'), `в ${f} осталась подпись «нет данных: артикул»`);
  }
});

// ——— 3. бренды выбранной категории ———
test('Catalog.brands: у выбранной категории — бренды её товаров вместе с подкатегориями; «Все» — все бренды', () => {
  const a = load(), { Catalog, S } = a;
  const of = cat => Catalog.brands(S, cat);
  const all = of('');
  const inv = of('Инверторы'), pan = of('Панели');
  const brandsOf = cat => new Set(S.products.filter(p => p.cat === cat && p.brand).map(p => p.brand));
  assert.deepEqual([...inv].sort(), [...brandsOf('Инверторы')].sort());
  assert.deepEqual([...pan].sort(), [...brandsOf('Панели')].sort());
  const onlyPanel = [...pan].find(b => !inv.includes(b)), onlyInv = [...inv].find(b => !pan.includes(b));
  assert.ok(onlyPanel && onlyInv, 'в демо должны быть бренд только панелей и бренд только инверторов');
  assert.ok(!inv.includes(onlyPanel) && inv.includes(onlyInv));
  assert.ok(all.includes(onlyPanel) && all.includes(onlyInv) && all.length >= inv.length + 1);
  assert.deepEqual(of(undefined), all);
  assert.deepEqual(of('Все'), all, '«Все» — все бренды');
  // подкатегории входят: «Электрика» без своих товаров, но с подкатегориями
  const parent = 'Электрика', sub = S.products.find(p => p.cat.startsWith(parent + ' › '));
  S.products.push({ ...sub, id: 'x-b', cat: parent + ' › Автоматы', brand: 'Бренд Подкатегории (тест)' });
  assert.ok(of(parent).includes('Бренд Подкатегории (тест)'), 'бренд подкатегории не виден у родителя');
  assert.ok(!of('Инверторы').includes('Бренд Подкатегории (тест)'));
  assert.ok(!of(parent + ' › Кабель').includes('Бренд Подкатегории (тест)'));
});

test('«Товары и остатки»: список брендов следует за выбранной категорией; смена категории сбрасывает чужой бренд; «Все» возвращает все', () => {
  const a = asDirector(load());
  const options = () => [...region(a, 'view').matchAll(/<select id="f-brand"[^>]*>([\s\S]*?)<\/select>/g)][0][1].match(/<option value="([^"]*)"/g).map(o => o.slice(15, -1)).filter(Boolean);
  const dec = s => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'");
  a.S.view = 'stock'; a.render();
  const everything = options().map(dec);
  assert.deepEqual(everything.sort(), [...a.Catalog.brands(a.S)].sort(), '«Все» — все бренды');
  const inv = a.Catalog.brands(a.S, 'Инверторы'), pan = a.Catalog.brands(a.S, 'Панели');
  const onlyPanel = pan.find(b => !inv.includes(b)), onlyInv = inv.find(b => !pan.includes(b));
  a.A['stock-cat']({ dataset: { cat: 'Инверторы' } });
  const got = options().map(dec);
  assert.deepEqual(got.sort(), [...inv].sort(), 'у инверторов — бренды инверторов');
  assert.ok(!got.includes(onlyPanel) && got.includes(onlyInv));
  // выбран бренд панелей → ушли в инверторы → бренд сброшен, список не пуст
  a.A['stock-cat']({ dataset: { cat: 'Панели' } });
  fire(a, 'change', 'brand', onlyPanel);
  assert.equal(a.S.ui.brand, onlyPanel);
  a.A['stock-cat']({ dataset: { cat: 'Инверторы' } });
  assert.equal(a.S.ui.brand, '', 'чужой бренд остался выбранным');
  const shown = () => text(a.stockTable());
  assert.match(shown(), /Показано \d+ из \d+/);
  assert.ok(!/Показано 0 из/.test(shown()), 'после сброса список инверторов пуст');
  // бренд, который есть и в новой категории, остаётся
  const both = inv.find(b => pan.includes(b));
  if (both) { fire(a, 'change', 'brand', both); a.A['stock-cat']({ dataset: { cat: 'Панели' } }); assert.equal(a.S.ui.brand, both); }
  // «Все» — снова все бренды
  a.A['stock-cat']({ dataset: { cat: 'Все' } });
  assert.deepEqual(options().map(dec).sort(), [...a.Catalog.brands(a.S)].sort());
  // счётчики и поиск не менялись: бренд выбран — число строк по нему как раньше
  fire(a, 'change', 'brand', onlyInv);
  assert.equal(a.stockRows().length, a.S.products.filter(p => p.brand === onlyInv).length);
});
