'use strict';
// Страница рабочей версии (F2, R05, R15, R18i): кто не вошёл, видит только форму входа — без каталога с ценами, остатков и
// демо-записей даже в коде страницы; в Настройках и в таблице прав нет почты, Telegram и MAX (в демо — есть).
// Ожидаемые строки берутся из самих таблиц данных (снимки, демо-seed), а не из кода отдачи страницы.

const test = require('node:test');
const assert = require('node:assert/strict');
const { load, bootPage } = require('./load.js');
const kit = require('./server-kit.js');

// Три строки, по которым узнаётся закрытое: товар каталога с ценой, строка снимка остатков, демо-запись из SEEDS
function secrets() {
  const app = load();
  const priced = app.CATALOG.rows.find(r => r.price && r.price > 1000 && r.model.length > 25);
  const stock = app.STOCK_SNAPSHOT.rows.find(r => r.ip > 0 && r.name.length > 25);
  const demo = app.seed();
  const client = demo.clients.find(c => c.name && c.name.length > 5);
  assert.ok(priced && stock && client, 'в данных нет подходящих строк для проверки');
  return {
    catalog: `model:'${priced.model}',brand:${JSON.stringify(priced.brand).replace(/"/g, "'")},price:${priced.price}`,
    stock: `name:'${stock.name}',cat:'${stock.cat}',ip:${stock.ip}`,
    demoClient: client.name,
    demoPerson: 'Павел М.',
  };
}

const getPage = async (srv, cookie) => (await kit.call(srv, 'GET', '/', { cookie })).body.toString('utf8');

test('GET / без сеанса: ни каталога с ценой, ни остатков, ни демо-записей; с сеансом — всё это есть', async () => {
  const srv = await kit.start();
  try {
    const want = secrets();
    const boss = await kit.director(srv);
    const full = await getPage(srv, boss.cookie);
    for (const [what, s] of Object.entries(want)) assert.ok(full.includes(s), `в полной странице нет: ${what}`);

    const anon = await getPage(srv, undefined);
    for (const [what, s] of Object.entries(want)) assert.ok(!anon.includes(s), `страница без входа выдаёт: ${what}`);
    assert.ok(anon.includes('window.CRM_SERVER=1'), 'страница без входа — не серверная');
    assert.ok(full.length - anon.length > 100000, `страница без входа почти не короче полной: ${anon.length} и ${full.length}`);
    assert.ok(!anon.includes('CRM-GATE'), 'метки сборки остались в странице');
    // сеанс, которого нет, — тоже «не вошёл»
    assert.ok(!(await getPage(srv, 'crm_sid=' + 'x'.repeat(43))).includes(want.catalog), 'чужой cookie открыл каталог');
  } finally { await srv.stop(); }
});

test('после входа через API следующий GET / отдаёт полную страницу; после выхода — снова только вход', async () => {
  const srv = await kit.start();
  try {
    const want = secrets();
    const password = kit.secret();
    await srv.app.admin.createDirector('boss', password, 'Директор (тест)');
    assert.ok(!(await getPage(srv)).includes(want.catalog));
    const r = await kit.login(srv, 'boss', password);
    assert.equal(r.status, 200);
    const page = await getPage(srv, r.cookie);
    assert.ok(page.includes(want.catalog) && page.includes(want.stock));
    await kit.call(srv, 'POST', '/api/logout', { cookie: r.cookie });
    assert.ok(!(await getPage(srv, r.cookie)).includes(want.stock), 'после выхода страница осталась полной');
  } finally { await srv.stop(); }
});

test('страница без входа запускается и рисует форму входа; вход на ней перезагружает страницу, не открывая CRM из пустой копии', async () => {
  const srv = await kit.start();
  try {
    const password = kit.secret();
    await srv.app.admin.createDirector('boss', password, 'Директор (тест)');
    const anon = await getPage(srv);
    const jar = { cookie: '' }, reloads = [];
    const bfetch = async (url, opt = {}) => {
      const headers = { ...(opt.headers || {}) };
      if (jar.cookie) headers.cookie = jar.cookie;
      const res = await fetch(srv.url + url, { ...opt, headers });
      const set = res.headers.get('set-cookie');
      if (set) jar.cookie = /Max-Age=0/i.test(set) ? '' : set.split(';')[0];
      return res;
    };
    class ES { addEventListener() {} close() {} }
    const globals = { fetch: bfetch, EventSource: ES, location: { hash: '', reload: () => reloads.push(1) } };

    // сама отдаваемая страница (с вырезанными кусками) исполняется и показывает форму входа
    const booted = bootPage(anon, { globals });   // window страницы — глобальный объект, как в браузере
    const t0 = Date.now();
    while (!booted.byId('srv-root').innerHTML.includes('Вход в CRM')) {
      if (Date.now() - t0 > 5000) throw new Error('форма входа не нарисована');
      await new Promise(r => setTimeout(r, 20));
    }

    // тот же код входа на странице с меткой CRM_LITE: верный пароль → перезагрузка, а не работа без каталога
    const app = load({ globals: { ...globals, window: { addEventListener() {}, focus() {} }, CRM_SERVER: 1, CRM_LITE: 1 } });
    assert.equal(await app.serverBoot(), 'gate');
    assert.equal(await app.serverLogin('boss', 'не тот пароль'), 'error');
    assert.equal(reloads.length, 0, 'неверный пароль перезагрузил страницу');
    assert.equal(await app.serverLogin('boss', password), 'reload');
    assert.equal(reloads.length, 1, 'после входа страница не перезагрузилась');
    assert.equal(app.S, null, 'пустая копия открыла CRM без данных');
  } finally { await srv.stop(); }
});

// ——— почта, Telegram и MAX в рабочей версии ———
const HIDDEN = /почт|telegram|max/i;

// Страница в рабочей версии: директор вошёл, состояние — пустая база фирмы
async function serverApp() {
  const base = load({ globals: { CRM_SERVER: 1 } });
  const st = JSON.parse(JSON.stringify(base.seedBase()));
  st.people.push({ id: 'p1', name: 'Директор (тест)', role: 'director', dept: 'mgmt' });
  const json = (status, body) => ({ status, json: async () => body });
  const fetch = async url => (url === '/api/me' ? json(200, { person: { id: 'p1', name: 'Директор (тест)', role: 'director' }, mustChange: false, tag: 'k' })
    : String(url).startsWith('/api/state') ? json(200, { seq: 1, view: 'v', state: st, ids: {} }) : json(404, {}));
  class ES { addEventListener() {} close() {} }
  const app = load({ globals: { CRM_SERVER: 1, fetch, EventSource: ES, window: { addEventListener() {}, focus() {} }, location: { hash: '' } } });
  assert.equal(await app.serverBoot(), 'ready');
  return app;
}
// Всё, что человек видит про вкладки настроек и права: названия вкладок, их содержимое, таблица прав, форма роли, подсказка пункта меню
function visibleText(app) {
  const tabs = app.settingsTabs();
  const strip = h => String(h).replace(/<[^>]+>/g, ' ');
  return {
    labels: tabs.map(t => t.label).join(' | '),
    matrix: strip(app.roleMatrix(true)),
    roleForm: strip(app.vRoles()),
    notify: strip(app.vNotifySettings()),
    hint: app.navItems().find(n => n.id === 'settings').hint,
    perms: app.Perms.shown().map(p => p[1]).join(' | '),
  };
}

test('рабочая версия: в вкладках настроек, таблице прав, форме роли и уведомлениях нет почты, Telegram и MAX', async () => {
  const text = visibleText(await serverApp());
  for (const [where, s] of Object.entries(text)) assert.doesNotMatch(s, HIDDEN, `в рабочей версии (${where}) осталось про почту/Telegram/MAX`);
  assert.ok(text.matrix.includes('Видеть цены и суммы'), 'таблица прав пустая');
  assert.ok(text.notify.includes('Задачи'), 'уведомления пустые');
});

test('демо: почта, Telegram и MAX на месте — в вкладках, таблице прав и уведомлениях', () => {
  const text = visibleText(load());
  assert.match(text.labels, /Почта/);
  assert.match(text.matrix, /Telegram и MAX/);
  assert.match(text.matrix, /почтой/);
  assert.match(text.roleForm, /Telegram и MAX/);
  assert.match(text.notify, /Почта/);
  assert.match(text.hint, /почт/);
  assert.equal(text.perms.split(' | ').length, load().Perms.LIST.length, 'в демо спрятаны права');
});

test('рабочая версия: права «писать клиентам» и «почта» остаются в ролях — спрятан только показ', async () => {
  const app = await serverApp();
  const keys = app.Perms.LIST.map(p => p[0]);
  assert.ok(keys.includes('write') && keys.includes('mail'));
  assert.ok(!app.Perms.shown().some(p => p[0] === 'write' || p[0] === 'mail'));
  const manager = app.S.roles.find(r => r.id === 'managerB2c');
  assert.equal(manager.perms.write, true, 'у менеджера пропало право писать клиентам');
  assert.equal(manager.perms.mail, true, 'у менеджера пропало право на почту');
});
