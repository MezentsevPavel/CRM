'use strict';
// Директор 2026-11-13: «если товар не распознаётся, надо выдать список или вообще весь каталог для указания, что это за модель;
// либо кнопка «Новая позиция»». Строки листа остатков без пары в каталоге: подсказка «похоже на…», выбор из каталога,
// «новая позиция»; выбор запоминается (st.stockSheet.links). Числа разобраны руками в самих тестах.

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.js');
const { start, call, director, state } = require('./server-kit.js');

const plain = v => JSON.parse(JSON.stringify(v));

test('Catalog.suggest: по коду модели; русская «В» в коде — латинская B; цифры и единицы кодом не считаются', () => {
  const { Catalog, CATALOG } = load();
  const pool = Catalog.build(CATALOG, { rows: [] }).products;
  const name = id => (pool.find(p => p.id === id) || {}).name;
  assert.match(name(Catalog.suggest('Гибридный инвертор GD3024EMH [3000W / 24V / PV 3000W 30-500V/ MPPT]', pool)), /GD3024EMH/);
  assert.match(name(Catalog.suggest('Гибридный инвертор GD6248SMHВG [6200W]', pool)), /GD6248SMHBG/);
  assert.match(name(Catalog.suggest('Сетевой инвертор DEYE SUN-30K-G04', pool)), /SUN-30K-G04/);
  // «VEKTOR 12-100»: одни цифры и «100Ah» — не код; раньше предлагалась чужая батарея «…51,2-100M»
  assert.equal(Catalog.suggest('Аккумуляторная батарея VEKTOR ENERGY GPL 12-100 [100Ah / 12V / AGM]', pool), null);
  assert.deepEqual(plain(Catalog.modelCodes('Кабель 1500Вт IP40 100Ah LiFePO4 12-100')), []);
  assert.equal(Catalog.suggest('Что-то без модели', pool), null);
});

test('сопоставление: указанная позиция принимает остаток, две строки на одну складываются; «новая позиция» — товар «нет в каталоге»; сопоставление запоминается и снимается', () => {
  const app = load(), { Catalog, Import, S } = app;
  const cat = Catalog.build(app.CATALOG, { rows: [] }).products;
  const target = cat.find(p => /GD3024EMH/.test(p.name));
  const row = (name, ip, npp, damaged, reserve) => ({ name, cat: 'Инверторы', ip, npp, vs: null, custody: null, transit: null, damaged, reserve: reserve || null, junk: [] });
  const rows = [row('Гибридный инвертор GD3024EMH [3000W]', 2, null, 1), row('GD3024EMH (с Авито)', 3, 4, 2), row('Неведомая штука-1', 5, null, null, '2шт Иванов')];
  const key = n => Catalog.norm(n);
  const fresh = () => ({ products: [], stock: {}, aside: {}, reserves: [], entities: S.entities, cities: S.cities, moves: [] });
  const before = Import.preview('stock', { ...fresh() }, rows, null, new Date());
  assert.equal(before.matched, 0);
  assert.equal(before.unlinked.length, 3, 'без указаний все три без пары');
  assert.equal(before.unlinked[0].suggest, target.id);
  assert.equal(before.unlinked[2].suggest, null);
  const links = { [key(rows[0].name)]: target.id, [key(rows[1].name)]: target.id, [key(rows[2].name)]: Catalog.LINK_NEW };
  const st = fresh();
  const out = Import.applyStock(st, rows, null, new Date(), links);
  assert.deepEqual([out.linked, out.asNew, out.unlinked.length], [2, 1, 0]);
  assert.deepEqual(plain(st.stock[target.id]), { ip: { irk: 5 }, npp: { irk: 4 } }, 'остаток двух строк сложился: ИП 2+3, НПП 4');
  assert.deepEqual(plain(st.aside[target.id]), { damaged: 3, custody: null, transitNoShip: null }, 'бой сложился: 1+2');
  assert.equal(st.products.filter(p => !p.inCatalog).length, 1, 'товаром «нет в каталоге» стала только «новая позиция»');
  assert.equal(st.reserves.length, 1);
  assert.deepEqual(plain(st.stockSheet.links), links, 'сопоставление записано вместе с таблицей');
  // повтор без указаний: прежнее действует; null снимает
  const again = Import.applyStock(st, rows, null, new Date(), undefined);
  assert.deepEqual([again.linked, again.unlinked.length], [2, 0]);
  const reset = Import.applyStock(st, rows, null, new Date(), { [key(rows[0].name)]: null });
  assert.deepEqual([reset.linked, reset.unlinked.length], [1, 1]);
  // чужое не принимается: несуществующая позиция и не строка — строки остаются без пары
  const junk = Import.applyStock(fresh(), rows, null, new Date(), { [key(rows[0].name)]: 'нет-такого', [key(rows[1].name)]: 5 });
  assert.equal(junk.unlinked.length, 3);
});

test('сервер: сопоставление приходит вместе со строками и остаётся в базе; «Это она» кладёт остаток на позицию каталога', async () => {
  const srv = await start();
  try {
    const boss = await director(srv);
    const app = load(), { Catalog } = app;
    const target = Catalog.build(app.CATALOG, { rows: [] }).products.find(p => /GD3024EMH/.test(p.name));
    const csv = ['Товар,Склад ИП,НПП,ВС,ответхранение,В пути,Резерв,Бой', 'Инверторы,,,,,,,', 'Гибридный инвертор GD3024EMH [3000W],7,,,,,,', 'Неведомая штука-1,5,,,,,,'].join('\n');
    const rows = plain(app.Import.stockRows(app.Import.parseCsv(csv)).rows);
    const links = { [Catalog.norm(rows[0].name)]: target.id, [Catalog.norm(rows[1].name)]: Catalog.LINK_NEW };
    const r = await call(srv, 'POST', '/api/import/stock', { cookie: boss.cookie, body: { rows, links } });
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.linked, r.body.asNew, r.body.unlinked.length], [1, 1, 0]);
    const st = await state(srv, boss.cookie);
    assert.equal(st.stock[target.id].ip.irk, 7, 'остаток лёг на позицию каталога');
    assert.equal(st.products.filter(p => p.src === 'sheet').length, 1);
    assert.deepEqual(plain(st.stockSheet.links), links);
  } finally { await srv.stop(); }
});
