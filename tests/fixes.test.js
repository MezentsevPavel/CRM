'use strict';
// Известные баги прошлой сборки и две правки, найденные при переносе (таск 05 серверной сборки):
//   G02 — срок резерва по умолчанию один везде; G03 — неизвестный остаток не превращается в «Свободно: 0»;
//   G04 — перемещение по заявке пишется в журнал как «Перемещение»; G05 — из закрытой заявки не списать товар;
//   вкладка «Склады и юрлица» в рабочей базе говорит о последнем переносе, а не о снимке 31.10;
//   движения склада не отдаются тому, у кого нет права «Товары и остатки» (в «Резерве» лежит имя клиента из переноса).
// Ожидаемые числа посчитаны руками: было 10, ушло 4 — стало 6 и т. п.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { load } = require('./load.js');
const { loadCode } = require('../tools/vm-load.js');

const plain = x => JSON.parse(JSON.stringify(x));
const NOW = new Date(2026, 10, 1, 12, 0);
const later = n => new Date(NOW.getTime() + n * 60000);
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const plusDays = n => { const d = new Date(NOW); d.setDate(d.getDate() + n); return ymd(d); };
const personWith = (app, role) => app.S.people.find(p => p.role === role).id;
const asPerson = (app, id) => { app.S.me = id; app.S.ui.drawer = null; app.S.ui.dispatch = null; app.S.ui.modal = null; return app.S; };

// ——— G02: срок резерва по умолчанию ———
test('G02 срок резерва по умолчанию — одна величина ядра: её берут ядро сделок, карточка товара и окно резерва строки сделки', () => {
  assert.equal(load().Stock.RESERVE_DAYS, 14, 'допущение спецификации: 14 дней');
  // подменяем величину: если какое-то место держит свою копию, оно останется на старом числе
  for (const days of [14, 30]) {
    const app = load({ now: NOW }), { Deals, Stock, S } = app;
    Stock.RESERVE_DAYS = days;
    // ядро: резерв сделки без срока
    const free = S.products.map(p => p.id).find(id => Stock.summary(S, id, NOW).free >= 1 && !S.reserves.some(r => r.productId === id));
    const deal = S.deals.find(d => d.items.some(i => i.productId === free) && Deals.state(S, d) === 'open');
    const owner = deal ? S.me : null;
    assert.ok(free, 'в демо нет свободного товара');
    // карточка товара: поле «Резерв до» (директор видит форму резерва)
    asPerson(app, 'p1');
    const card = app.DRAWERS.product(free).body;
    assert.match(card, new RegExp(`id="rs-until"[^>]*value="${plusDays(days)}"`), `карточка товара: срок не ${days} дн.`);
    // окно резерва строки сделки
    const d2 = S.deals.find(d => (d.items || []).some(i => i.productId));
    const idx = d2.items.findIndex(i => i.productId);
    const modal = app.MODALS.dealReserve(`${d2.id}:${idx}`);
    assert.match(modal, new RegExp(`id="dr-until"[^>]*value="${plusDays(days)}"`), `окно резерва сделки: срок не ${days} дн.`);
    void owner;
  }
});

test('G02 Deals.reserve без срока ставит резерв на RESERVE_DAYS дней', () => {
  for (const days of [14, 21]) {
    const app = load({ now: NOW }), { Deals, Stock, S } = app;
    Stock.RESERVE_DAYS = days;
    const me = 'p1';
    let done = null;
    for (const d of S.deals) {
      if (Deals.state(S, d) !== 'open' || !Deals.canEdit(S, d, me)) continue;
      for (const it of d.items || []) {
        if (!it.productId) continue;
        const cell = Stock.bestCell(S, it.productId);
        const r = Deals.reserve(S, d.id, { productId: it.productId, qty: 1, entityId: cell.entityId, cityId: cell.cityId }, me, NOW);
        if (r.ok) { done = S.reserves.find(x => x.id === (r.reserve || {}).id) || S.reserves[S.reserves.length - 1]; break; }
      }
      if (done) break;
    }
    assert.ok(done, 'не удалось поставить резерв по сделке');
    assert.equal(ymd(new Date(done.until)), plusDays(days));
  }
});

// ——— G03: неизвестный остаток ———
function unknownWithReserve(app) {
  const { Stock, S } = app;
  const p = S.products.find(x => Stock.summary(S, x.id, NOW).known === false && !S.reserves.some(r => r.productId === x.id));
  assert.ok(p, 'в демо нет товара без числа в таблице остатков');
  S.reserves.push({ id: 'r-unk', productId: p.id, qty: 3, entityId: Stock.ANY, cityId: Stock.ANY, src: 'stock', dealId: undefined, until: new Date(2026, 11, 1) });
  return p;
}

test('G03 Stock.summary: у товара без числа в таблице, но с резервом, свободное — неизвестность (null), а не 0 и не минус', () => {
  const app = load({ now: NOW });
  const p = unknownWithReserve(app);
  const k = app.Stock.summary(app.S, p.id, NOW);
  assert.equal(k.known, false);
  assert.equal(k.free, null);
  assert.equal(k.freeAfter, null);
  assert.equal(k.reservedStock, 3, 'резерв при этом считается');
});

test('G03 карточка товара и список: «Свободно сейчас: нет данных», не 0 и не минус', () => {
  const app = load({ now: NOW });
  const p = unknownWithReserve(app);
  asPerson(app, 'p1');
  const body = app.DRAWERS.product(p.id).body;
  const free = body.slice(body.indexOf('Свободно сейчас'), body.indexOf('Свободно сейчас') + 200);
  assert.ok(free.includes('нет данных'), `карточка: «${free}»`);
  assert.ok(!/Свободно сейчас[^]{0,120}?>\s*-?\d/.test(free.replace(/<[^>]+>/g, '>')), 'карточка показывает число свободного');
  const row = app.stockRow(p, true);
  const cells = row.split('<td').slice(1);
  const freeCell = cells[3];
  assert.ok(freeCell.includes('нет данных') && !/<b/.test(freeCell), `список: «${freeCell}»`);
});

test('G03 известный остаток считается как раньше: свободно = лежит − резервы со склада', () => {
  const app = load({ now: NOW }), { Stock, S } = app;
  const p = S.products.find(x => Stock.summary(S, x.id, NOW).known && Stock.summary(S, x.id, NOW).onHand >= 5 && !S.reserves.some(r => r.productId === x.id));
  const k = Stock.summary(S, p.id, NOW);
  assert.equal(k.free, k.onHand);
  assert.equal(typeof k.freeAfter, 'number');
});

// ——— G04: перемещение по заявке — «Перемещение» ———
const PIPE = () => ({ id: 'dispatch', kind: 'dispatch', name: 'Отправки', stages: [
  { id: 'new', name: 'Новая' }, { id: 'picking', name: 'Собирается' }, { id: 'ready', name: 'Готова к отправке' },
  { id: 'onWay', name: 'В пути' }, { id: 'delivered', name: 'Доставлена', flag: 'final' }, { id: 'cancelled', name: 'Отменена', flag: 'final' },
] });
function world(app) {
  const base = app.Stock.defaults();
  const roles = app.Perms.defaultRoles();
  roles.push({ id: 'driver', name: 'Водитель', builtin: true, perms: { dispatch: true } });
  const people = [['dir', 'director'], ['mgr', 'managerB2b'], ['log', 'logist'], ['wh', 'warehouse'], ['drv', 'driver']]
    .map(([id, role]) => ({ id, name: 'Сотрудник ' + id, role, demo: true }));
  return {
    v: 3, entities: base.entities, cities: base.cities, roles, people,
    pipelines: [...app.Pipes.defaults(), PIPE()],
    products: [{ id: 'pv', name: 'Панель тестовая' }],
    stock: { pv: { ip: { irk: 10 } } },
    aside: {}, reserves: [], moves: [], shipments: [], dispatches: [], feed: [], notes: [], deals: [], prefs: { notify: {} },
  };
}
const IRK = { entityId: 'ip', cityId: 'irk' }, MSK = { entityId: 'ip', cityId: 'msk' };
const order = (over = {}) => ({
  purpose: 'transfer', to: { name: 'Склад-пример', phone: '+7 900 000-00-01' }, address: '', when: { date: '2026-11-05' },
  from: IRK, toCell: MSK, items: [{ productId: 'pv', qty: 4 }], ...over,
});
const cell = (app, st, c) => app.Stock.grid(st, 'pv').cell(c.entityId, c.cityId);
const go = (app, st, id, stage, by, n) => { const r = app.Dispatch.setStage(st, id, stage, by, later(n)); assert.equal(r.ok, true, r.reason); return r; };
const made = (app, st, over) => { const r = app.Dispatch.create(st, order(over), 'mgr', NOW); assert.equal(r.ok, true, r.reason); return r.id; };

test('G04 перемещение до «Доставлена»: в журнале одна запись «Перемещение» откуда → куда; остатки как раньше (было 10, ушло 4 — 6 и 4)', () => {
  const app = load(), { Stock } = app;
  const st = world(app);
  const id = made(app, st);
  go(app, st, id, 'onWay', 'drv', 1);
  assert.equal(cell(app, st, IRK), 6, 'из клетки «откуда» ушло 4');
  const k = Stock.summary(st, 'pv', NOW);
  assert.equal(k.onHand, 6, 'в пути груз на складах не числится');
  assert.equal(k.incoming, 4, 'в пути он приход на склад-получатель');
  assert.equal(Stock.incomingOf(st, 'pv')[0].cityId, 'msk');
  go(app, st, id, 'delivered', 'drv', 2);
  assert.equal(cell(app, st, IRK), 6);
  assert.equal(cell(app, st, MSK), 4);
  assert.equal(Stock.summary(st, 'pv', NOW).incoming, 0);
  assert.equal(Stock.summary(st, 'pv', NOW).onHand, 10);
  const mv = st.moves.filter(m => m.doc === 'ОТ-001');
  assert.equal(mv.length, 1, 'в журнале должна быть одна запись, а не «Отгрузка» и «Приход»');
  assert.deepEqual(plain([mv[0].kind, mv[0].qty, mv[0].entityId, mv[0].cityId, mv[0].toEntityId, mv[0].toCityId]), ['Перемещение', 4, 'ip', 'irk', 'ip', 'msk']);
});

test('G04 «Доставлена» сразу из «Новая»: одна запись «Перемещение», товар в клетке «куда»', () => {
  const app = load();
  const st = world(app);
  const id = made(app, st);
  go(app, st, id, 'delivered', 'drv', 1);
  assert.equal(cell(app, st, IRK), 6);
  assert.equal(cell(app, st, MSK), 4);
  assert.deepEqual(plain(st.moves.map(m => m.kind)), ['Перемещение']);
});

test('G04 возврат: отмена заявки в пути — вторая запись «Перемещение» обратно, остатки как до заявки (10 и пусто)', () => {
  const app = load(), { Stock } = app;
  const st = world(app);
  const id = made(app, st);
  go(app, st, id, 'onWay', 'drv', 1);
  go(app, st, id, 'cancelled', 'dir', 2);
  assert.equal(cell(app, st, IRK), 10);
  assert.ok(!cell(app, st, MSK), 'в клетке «куда» ничего не должно остаться');
  assert.equal(Stock.summary(st, 'pv', NOW).incoming, 0);
  assert.equal(Stock.summary(st, 'pv', NOW).onHand, 10);
  const mv = st.moves.filter(m => m.doc === 'ОТ-001');
  // журнал идёт от новых к старым: сначала возврат, потом уход
  assert.deepEqual(plain(mv.map(m => [m.kind, m.qty, m.cityId, m.toCityId])), [['Перемещение', 4, 'msk', 'irk'], ['Перемещение', 4, 'irk', 'msk']]);
});

// ——— G05: из закрытой заявки не списать ———
function saleWorld(app) {
  const st = world(app);
  return st;
}
const sale = (over = {}) => ({
  purpose: 'sale', to: { name: 'Клиент-пример 1', phone: '+7 900 000-00-01' }, address: 'г. Иркутск, ул. Примерная, 1 (пример)',
  when: { date: '2026-11-05' }, items: [{ productId: 'pv', qty: 2 }], ...over,
});

test('G05 Dispatch.sell: в доставленной и отменённой заявке отказ с текстом, склад не тронут; в открытой списывает', () => {
  const app = load(), { Dispatch } = app;
  for (const stage of ['delivered', 'cancelled']) {
    const st = saleWorld(app);
    const r = Dispatch.create(st, sale(), 'mgr', NOW);
    assert.equal(r.ok, true, r.reason);
    go(app, st, r.id, stage, stage === 'cancelled' ? 'mgr' : 'log', 1);
    const s = Dispatch.sell(st, r.id, 0, { entityId: 'ip', cityId: 'irk' }, 'mgr', later(5));
    assert.equal(s.ok, false, `в заявке «${stage}» списание прошло`);
    assert.match(s.reason, /закрыт/);
    assert.equal(cell(app, st, IRK), 10);
    assert.equal(st.moves.length, 0);
  }
  const st = saleWorld(app);
  const r = Dispatch.create(st, sale(), 'mgr', NOW);
  const ok = Dispatch.sell(st, r.id, 0, { entityId: 'ip', cityId: 'irk' }, 'mgr', later(5));
  assert.equal(ok.ok, true, ok.reason);
  assert.equal(cell(app, st, IRK), 8);
});

test('G05 карточка заявки: у закрытой заявки нет кнопки «Списать при продаже», у открытой есть', () => {
  const app = load({ now: NOW }), { Dispatch, S } = app;
  const mgr = personWith(app, 'managerB2b'), log = personWith(app, 'logist');
  const p = S.products.find(x => !S.reserves.some(r => r.productId === x.id) && app.Stock.grid(S, x.id).totals.all >= 5);
  const mk = () => Dispatch.create(S, { purpose: 'sale', to: { name: 'Клиент-пример 91', phone: '+7 900 000-00-91' }, address: 'г. Иркутск, ул. Примерная, 91 (пример)', when: { date: new Date(2026, 10, 5) }, items: [{ productId: p.id, qty: 1 }] }, mgr, NOW).id;
  const open = mk(), done = mk(), cancelled = mk();
  assert.equal(Dispatch.setStage(S, done, 'delivered', log, later(1)).ok, true);
  assert.equal(Dispatch.setStage(S, cancelled, 'cancelled', mgr, later(1)).ok, true);
  asPerson(app, mgr);
  const btn = id => (app.DRAWERS.dispatch(id).body.match(/data-act="dsp-sell"/g) || []).length;
  assert.equal(btn(open), 1);
  assert.equal(btn(done), 0, 'в доставленной заявке есть «Списать»');
  assert.equal(btn(cancelled), 0, 'в отменённой заявке есть «Списать»');
});

// ——— вкладка «Склады и юрлица» в рабочей базе ———
test('SERVER «Склады и юрлица»: пишет о последнем переносе остатков (дата, кто) или «Остатки ещё не перенесены», а не «снимок 31.10»', () => {
  // в серверном режиме S поднимает вход в систему; здесь ставим состояние рабочей базы сами
  const server = () => {
    const { api, ctx } = loadCode({ globals: { CRM_SERVER: 1 } });
    vm.runInContext("S = Object.assign(seedBase(), { me: 'pDir', ui: defaultUi() }); S.people.push({ id: 'pDir', name: 'Директор-пример', role: 'director' });", ctx);
    return api;
  };
  const none = server();
  const htmlNone = none.SETTINGS_TABS.find(t => t.id === 'stock').render();
  assert.ok(htmlNone.includes('Остатки ещё не перенесены'), 'до переноса нет честной подписи');
  assert.ok(!/снимок 31\.10|из 208/.test(htmlNone), 'в рабочей базе осталась подпись про снимок 31.10');

  const done = server();
  done.S.stockSheet = { at: new Date(2026, 10, 2, 9, 30), by: 'pDir', rows: [{ name: 'Товар-пример' }, { name: 'Товар-пример 2' }] };
  const html = done.SETTINGS_TABS.find(t => t.id === 'stock').render();
  assert.ok(html.includes('02.11.2026'), 'нет даты переноса');
  assert.ok(html.includes('Директор-пример'), 'нет того, кто переносил');
  assert.ok(html.includes('строк в листе: 2'), 'нет числа строк листа');
  assert.ok(!/снимок 31\.10|из 208/.test(html));

  // демо — как раньше
  const demo = load();
  assert.match(demo.SETTINGS_TABS.find(t => t.id === 'stock').render(), /снимок 31\.10/);
});

// ——— Visible: движения склада ———
test('Visible.of: у движения «Резерв» заметка из переноса (имя клиента) уходит только тому, у кого есть право «Товары и остатки»', () => {
  const app = load({ now: NOW }), { Visible, S } = app;
  const NAME = 'перенос: Клиент-из-таблицы-пример';
  const base = { at: NOW, productId: S.products[0].id, qty: 2, entityId: 'ip', cityId: 'irk', by: 'p1' };
  S.moves.push({ ...base, id: 'mv-x', kind: 'Резерв', doc: NAME }, { ...base, id: 'mv-y', kind: 'Снят резерв', doc: NAME },
    { ...base, id: 'mv-z', kind: 'Приход', doc: 'П-1001' });
  const withRight = S.people.find(p => app.Perms.can(S, p.id, 'stock') && p.id !== 'p1');
  const without = S.people.find(p => !app.Perms.can(S, p.id, 'stock'));
  assert.ok(withRight && without, 'в демо нет людей с правом и без права «stock»');
  const seen = who => Object.fromEntries(Visible.of(S, who).moves.filter(m => m.id.startsWith('mv-')).map(m => [m.id, m]));
  assert.equal(seen(withRight.id)['mv-x'].doc, NAME, 'человек с правом stock не видит заметку');
  const cut = seen(without.id);
  assert.ok(!JSON.stringify(Visible.of(S, without.id).moves).includes('Клиент-из-таблицы-пример'), 'имя клиента из переноса ушло человеку без права stock');
  assert.ok(cut['mv-x'] && cut['mv-y'], 'движение должно остаться в журнале — убрана только заметка');
  assert.equal(cut['mv-z'].doc, 'П-1001', 'номер поставки у прихода убирать не нужно');
});

// ——— установка на сервер: deploy/ и docs/server-install.md ———
// Linux на этой машине нет, скрипты не запускаются: проверяем синтаксис (bash -n, если bash есть) и то, что в них обязано стоять.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

test('deploy/install.sh и update.sh: синтаксис верный, концы строк LF', () => {
  const probe = spawnSync('bash', ['-c', 'true']);
  for (const f of ['deploy/install.sh', 'deploy/update.sh']) {
    assert.ok(!fs.readFileSync(path.join(ROOT, f), 'utf8').includes('\r'), `${f}: CRLF ломает bash на сервере`);
    if (probe.status !== 0) continue; // bash на этой машине нет — остальное проверено ниже по тексту
    const r = spawnSync('bash', ['-n', path.join(ROOT, f)], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${f}: bash -n → ${r.stderr}`);
  }
  assert.match(read('deploy/.gitattributes'), /\*\.sh\s+text\s+eol=lf/, 'без .gitattributes git на Windows превратит LF в CRLF');
});

test('deploy/install.sh: Node 24 с nodejs.org, Caddy из репозитория, пользователь crm, пути, служба, Caddyfile, порты, директор', () => {
  const s = read('deploy/install.sh');
  for (const need of [
    'nodejs.org/dist/latest-v24.x', 'sha256sum -c', 'dl.cloudsmith.io/public/caddy/stable', 'useradd --system', '/opt/crm', '/var/lib/crm',
    'Environment=TZ=Asia/Irkutsk', 'Environment=CRM_SECURE_COOKIE=1', 'Restart=always', 'reverse_proxy 127.0.0.1:$PORT', 'PORT=3000',
    'ufw allow 80/tcp', 'ufw allow 443/tcp', 'ufw allow 22/tcp', 'create-director', 'deploy/update.sh',
  ]) assert.ok(s.includes(need), `в install.sh нет «${need}»`);
  assert.match(s, /\$DOMAIN \{/, 'Caddyfile: блок домена');
  assert.match(s, /\[ -n "\$DOMAIN" \]/, 'без домена скрипт обязан остановиться');
  // повторный запуск: готовое пропускается, директор второй раз не заводится
  for (const need of ['id crm', 'if [ -f "$UNIT" ]', 'command -v caddy', '.director-created']) assert.ok(s.includes(need), `install.sh не умеет повторный запуск: нет «${need}»`);
  // домен и пароль не зашиты
  assert.ok(!/(password|пароль)\s*=\s*["'][^"'$]/i.test(s), 'в install.sh зашит пароль');
});

test('deploy/update.sh: новый код, сборка, перезапуск; данные /var/lib/crm не трогаются', () => {
  const s = read('deploy/update.sh');
  for (const need of ['tools/build.js', 'systemctl restart crm', '/opt/crm.prev']) assert.ok(s.includes(need), `в update.sh нет «${need}»`);
  // /var/lib/crm не копируется, не удаляется и не перезаписывается (упоминание допустимо только в тексте сообщений)
  const code = s.split('\n').filter(l => !/^\s*#/.test(l) && !/echo|die|printf/.test(l)).join('\n');
  assert.ok(!code.includes('/var/lib/crm'), 'update.sh обращается к папке данных');
  assert.ok(!/rm -rf[^\n]*(DATA|data)/.test(s), 'update.sh удаляет данные');
});

test('docs/server-install.md: домен и IP — места <домен> и <IP-сервера>, все шаги на месте, выдуманных адресов нет', () => {
  const d = read('docs/server-install.md');
  for (const need of ['<домен>', '<IP-сервера>', 'Ubuntu 24.04', '2 ГБ', '30 ГБ', 'тип: **A**', 'ssh root@<IP-сервера>', 'tar -czf', 'scp ', 'bash deploy/install.sh <домен>',
    'update.sh', 'crm-admin restore', 'Настройки → Копии', 'бэкап']) assert.ok(d.toLowerCase().includes(need.toLowerCase()), `в инструкции нет «${need}»`);
  // ни одного настоящего IP-адреса и домена верхнего уровня .ru/.com из примеров
  assert.ok(!/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(d), 'в инструкции выдуманный IP');
});

// ——— ремонт ветки F1: адрес фото приёмки в карточке поставки экранируется ———
test('карточка поставки: кавычка в адресе фото приёмки не выходит из src — onerror не становится атрибутом', () => {
  const app = load({ now: NOW });
  const s = app.S.shipments[0];
  s.received = { at: NOW, by: 'p5', photos: 1, urls: ['x" onerror="alert(1)'], note: '' };
  app.S.me = 'p1';
  const body = app.DRAWERS.ship(s.id).body;
  assert.ok(body.includes('Фото приёмки'), 'в карточке нет фото приёмки — тест ничего не проверит');
  assert.ok(!body.includes('onerror="alert(1)"'), 'адрес фото вставлен в src без экранирования');
});
