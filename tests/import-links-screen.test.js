'use strict';
// Экран «Настройки → Перенос»: список строк без пары в каталоге — «Это она», поиск по каталогу, «Новая позиция», «Отменить».

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.js');
const { start, director, state } = require('./server-kit.js');

const plain = v => JSON.parse(JSON.stringify(v));
const CSV = ['Товар,Склад ИП,НПП,ВС,ответхранение,В пути,Резерв,Бой', 'Инверторы,,,,,,,',
  'Гибридный инвертор GD3024EMH [3000W],7,,,,,,', 'Сетевой инвертор DEYE SUN-30K-G04,2,,,,,,', 'Неведомая штука-1,5,,,,,,'].join('\n');

async function openPage(srv, who) {
  const jar = { cookie: '' };
  const bfetch = async (url, opt = {}) => {
    const headers = { ...(opt.headers || {}) };
    if (jar.cookie) headers.cookie = jar.cookie;
    const res = await fetch(srv.url + url, { ...opt, headers });
    const set = res.headers.get('set-cookie');
    if (set) jar.cookie = /Max-Age=0/i.test(set) ? '' : set.split(';')[0];
    return res;
  };
  const app = load({ globals: { CRM_SERVER: 1, fetch: bfetch, window: { addEventListener() {}, focus() {} }, location: { hash: '', reload() {} }, atob, Blob } });
  assert.equal(await app.serverBoot(), 'gate');
  assert.equal(await app.serverLogin(who.login, who.password), 'ready');
  return app;
}

test('экран «Перенос»: без пары → подсказка, «Это она», поиск по каталогу, «Новая позиция», «Отменить»; выбор уходит на сервер и остаётся в базе', async () => {
  const srv = await start();
  try {
    const boss = await director(srv);
    const app = await openPage(srv, boss);
    const tab = app.SETTINGS_TABS.find(t => t.id === 'transfer');
    app.trStockRead(new TextEncoder().encode(CSV));
    let h = tab.render();
    assert.match(h, /Не нашли пару в каталоге: 3/);
    assert.match(h, /Похоже на: [^<]*GD3024EMH/);
    assert.match(h, /Подсказки нет/);
    assert.match(h, /<datalist id="tr-catlist">/, 'весь каталог для поиска в поле');
    const N = n => app.Catalog.norm(n);
    const gd = N('Гибридный инвертор GD3024EMH [3000W]'), deye = N('Сетевой инвертор DEYE SUN-30K-G04'), odd = N('Неведомая штука-1');
    const to = /data-act="tr-sug" data-k="[^"]*GD3024EMH[^"]*" data-to="([^"]+)"/i.exec(h);
    assert.ok(to, 'нет кнопки «Это она»');
    app.A['tr-sug']({ dataset: { k: gd, to: to[1] } });
    assert.match(tab.render(), /Не нашли пару в каталоге: 2/);
    assert.match(tab.render(), /Указано вами \(1\)/);
    const target = app.S.products.find(p => p.inCatalog && /SUN-30K-G04/.test(p.name));
    app.ON.change['tr-pick']({ value: target.name, dataset: { k: deye } });
    app.ON.change['tr-pick']({ value: 'Такого нет в каталоге', dataset: { k: odd } });
    assert.match(tab.render(), /Не нашли пару в каталоге: 1/, 'чужое название не принято');
    app.A['tr-new']({ dataset: { k: odd } });
    h = tab.render();
    assert.doesNotMatch(h, /Не нашли пару в каталоге/);
    assert.match(h, /Указано вами \(3\)/);
    app.A['tr-unlink']({ dataset: { k: odd } });
    assert.match(tab.render(), /Не нашли пару в каталоге: 1/);
    app.A['tr-new']({ dataset: { k: odd } });
    await app.FORMS['tr-stock']();
    const st = await state(srv, boss.cookie);
    assert.equal(st.stock[to[1]].ip._, 7, 'остаток лёг на позицию каталога, а не на новый товар');
    assert.equal(st.stock[target.id].ip._, 2);
    assert.equal(Object.keys(plain(st.stockSheet.links)).length, 3);
    assert.equal(st.products.filter(p => p.src === 'sheet').length, 1);
    // «Принять все подсказки»: одной кнопкой те, где подсказка есть
    app.trStockRead(new TextEncoder().encode(CSV));
    app.S.stockSheet = { ...app.S.stockSheet, links: {} };
    app.trStockRead(new TextEncoder().encode(CSV));
    app.A['tr-sug-all']();
    assert.match(tab.render(), /Не нашли пару в каталоге: 1/, 'у «Неведомой штуки» подсказки нет — она осталась в списке');
  } finally { await srv.stop(); }
});
