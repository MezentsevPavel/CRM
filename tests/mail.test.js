'use strict';
// Почта (таск 05, ядро): папки поставщиков по правилам-адресам, «запомнить адрес», поиск, кто видит ящик,
// приход письма с уведомлением, ответ-имитация, демо-данные. Экранов здесь нет.
// Ожидаемые значения — из таска 05 и spec.md (истории 56–62), разобраны вручную; не из кода под тестом.

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.js');

// Маленькое состояние: люди всех нужных ролей, два ящика, два поставщика.
//   s1 — правило по точному адресу sales@alpha.example; s2 — правило по домену @beta.example.
function mini(app) {
  const L = (id, boxId, from, subject, body, folder = 'inbox') => ({ id, boxId, from, fromName: '', subject, body, at: new Date(2026, 9, 20, 10), read: false, folder });
  return {
    roles: app.Perms.defaultRoles(),
    people: [
      { id: 'dir', name: 'Директор', role: 'director' },
      { id: 'log', name: 'Логист', role: 'logist' },
      { id: 'mgb', name: 'Менеджер B2B', role: 'managerB2b' },
      { id: 'mgc', name: 'Менеджер B2C', role: 'managerB2c' },
      { id: 'wh', name: 'Кладовщик', role: 'warehouse' },
    ],
    prefs: { notify: {} }, notes: [],
    mail: {
      boxes: [
        { id: 'purchase', kind: 'purchase', title: 'Закупки', address: '', roles: ['logist', 'director'] },
        { id: 'clients', kind: 'clients', title: 'Клиенты', address: '', roles: ['managerB2b', 'managerB2c', 'director'] },
      ],
      suppliers: [
        { id: 's1', name: 'Поставщик-пример А', example: true, rules: ['sales@alpha.example'] },
        { id: 's2', name: 'Поставщик-пример Б', example: true, rules: ['@beta.example'] },
      ],
      letters: [
        L('m1', 'purchase', 'sales@alpha.example', 'Счёт на инверторы', 'Выставили счёт.', 's1'),
        L('m2', 'purchase', 'buh@alpha.example', 'Акт сверки', 'Просим подписать акт.'),
        L('m3', 'purchase', 'buh@alpha.example', 'Ещё раз про акт', 'Напоминаем про акт.'),
        L('m4', 'purchase', 'other@alpha.example', 'Прайс', 'Новый прайс-лист.'),
        L('m5', 'clients', 'buh@alpha.example', 'Письмо клиентского ящика', 'С того же адреса, но другой ящик.'),
        L('m6', 'purchase', 'x@gamma.example', 'Предложение', 'Предлагаем сотрудничество.'),
        L('m7', 'purchase', 'y@gamma.example', 'Каталог', 'Каталог во вложении.'),
        L('m8', 'purchase', 'z@delta.example', 'Реклама', 'Скидки на всё.'),
        L('m9', 'clients', 'client@mail.example', 'Срок поставки', 'Подскажите, когда привезёте ПАНЕЛИ? Нужен трек-номер.'),
      ],
    },
  };
}
// Date из node:vm — другого мира, instanceof не работает
const isDate = x => Object.prototype.toString.call(x) === '[object Date]';
const folderOfId = (st, id) => st.mail.letters.find(l => l.id === id).folder;

// ——— folderOf ———
test('folderOf: письмо с точного адреса из правила — в папку поставщика', () => {
  const app = load(), st = mini(app);
  assert.equal(app.Mail.folderOf(st, { boxId: 'purchase', from: 'sales@alpha.example' }), 's1');
  assert.equal(app.Mail.folderOf(st, { boxId: 'purchase', from: 'SALES@Alpha.Example' }), 's1', 'регистр адреса не важен');
  assert.equal(app.Mail.folderOf(st, { boxId: 'purchase', from: 'Отдел продаж <sales@alpha.example>' }), 's1', 'адрес в угловых скобках');
  // правило по адресу — не правило по домену: другой адрес той же фирмы не попадает в папку
  assert.equal(app.Mail.folderOf(st, { boxId: 'purchase', from: 'buh@alpha.example' }), 'inbox');
});

test('folderOf: с адреса того же домена при правиле по домену — тоже в папку поставщика', () => {
  const app = load(), st = mini(app);
  assert.equal(app.Mail.folderOf(st, { boxId: 'purchase', from: 'anyone@beta.example' }), 's2');
  assert.equal(app.Mail.folderOf(st, { boxId: 'purchase', from: 'second.person@BETA.example' }), 's2');
  // похожий домен — не тот же домен
  assert.equal(app.Mail.folderOf(st, { boxId: 'purchase', from: 'a@mybeta.example' }), 'inbox');
  assert.equal(app.Mail.folderOf(st, { boxId: 'purchase', from: 'a@beta.example.org' }), 'inbox');
  // точный адрес сильнее домена
  st.mail.suppliers[0].rules.push('vip@beta.example');
  assert.equal(app.Mail.folderOf(st, { boxId: 'purchase', from: 'vip@beta.example' }), 's1');
});

test('folderOf: незнакомый отправитель — в «Разобрать»; вне ящика закупок папок поставщиков нет', () => {
  const app = load(), st = mini(app);
  assert.equal(app.Mail.folderOf(st, { boxId: 'purchase', from: 'new@unknown.example' }), 'inbox');
  assert.equal(app.Mail.folderOf(st, { boxId: 'purchase', from: '' }), 'inbox');
  // письмо с адреса поставщика, но в ящике клиентов — во входящих
  assert.equal(app.Mail.folderOf(st, { boxId: 'clients', from: 'sales@alpha.example' }), 'inbox');
  assert.equal(app.Mail.folderOf(st, { boxId: 'no-such-box', from: 'sales@alpha.example' }), 'inbox');
});

// ——— remember ———
test('remember (адрес): адрес в правиле поставщика, письмо и прочие письма с этого адреса — в его папке', () => {
  const app = load(), st = mini(app);
  const res = app.Mail.remember(st, 'm2', 's1', 'address');
  assert.deepEqual([res.ok, res.rule, res.moved], [true, 'buh@alpha.example', 2]);
  assert.deepEqual(st.mail.suppliers[0].rules, ['sales@alpha.example', 'buh@alpha.example']);
  assert.equal(folderOfId(st, 'm2'), 's1');
  assert.equal(folderOfId(st, 'm3'), 's1', 'другое письмо с того же адреса переехало');
  assert.equal(folderOfId(st, 'm4'), 'inbox', 'другой адрес того же домена остался в «Разобрать»');
  assert.equal(folderOfId(st, 'm5'), 'inbox', 'тот же адрес в ящике клиентов не тронут');
  assert.equal(folderOfId(st, 'm8'), 'inbox');
  // повторно то же — правило не двоится, переезжать нечему
  const again = app.Mail.remember(st, 'm2', 's1', 'address');
  assert.deepEqual([again.ok, again.moved], [true, 0]);
  assert.equal(st.mail.suppliers[0].rules.length, 2);
});

test('remember (домен): в правило идёт весь домен, переезжают письма всех адресов домена', () => {
  const app = load(), st = mini(app);
  const res = app.Mail.remember(st, 'm6', 's2', 'domain');
  assert.deepEqual([res.ok, res.rule, res.moved], [true, '@gamma.example', 2]);
  assert.deepEqual(st.mail.suppliers[1].rules, ['@beta.example', '@gamma.example']);
  assert.equal(folderOfId(st, 'm6'), 's2');
  assert.equal(folderOfId(st, 'm7'), 's2', 'письмо с другого адреса того же домена тоже переехало');
  assert.equal(folderOfId(st, 'm8'), 'inbox', 'другой домен не тронут');
  // и новое письмо с этого домена теперь ложится в папку само
  assert.equal(app.Mail.folderOf(st, { boxId: 'purchase', from: 'third@gamma.example' }), 's2');
});

test('remember: правило живёт у одного поставщика; нельзя запомнить письмо клиентского ящика, неизвестного поставщика, чужой режим', () => {
  const app = load(), st = mini(app);
  app.Mail.remember(st, 'm2', 's1', 'address');
  app.Mail.remember(st, 'm2', 's2', 'address');   // потом решили, что это второй поставщик
  assert.ok(!st.mail.suppliers[0].rules.includes('buh@alpha.example'), 'у прежнего поставщика правило снято');
  assert.ok(st.mail.suppliers[1].rules.includes('buh@alpha.example'));
  assert.equal(folderOfId(st, 'm2'), 's2');
  assert.equal(folderOfId(st, 'm3'), 's2');

  const before = JSON.stringify(st.mail);
  for (const bad of [['m5', 's1', 'address'], ['m4', 'nope', 'address'], ['nope', 's1', 'address'], ['m4', 's1', 'all']]) {
    const r = app.Mail.remember(st, ...bad);
    assert.equal(r.ok, false, bad.join());
    assert.ok(r.reason, 'есть причина отказа');
  }
  assert.equal(JSON.stringify(st.mail), before, 'отказ ничего не меняет');
});

// ——— search ———
test('search: по отправителю, теме и тексту — без учёта регистра и ё/е; по ящику и по папке', () => {
  const app = load(), st = mini(app);
  const ids = q => app.Mail.search(st, q).map(l => l.id).sort();
  assert.deepEqual(ids({ boxId: 'purchase', q: 'GAMMA' }), ['m6', 'm7'], 'по адресу отправителя');
  assert.deepEqual(ids({ boxId: 'purchase', q: 'акт сверки' }), ['m2'], 'по теме');
  assert.deepEqual(ids({ boxId: 'purchase', q: 'прайс-лист' }), ['m4'], 'по тексту');
  assert.deepEqual(ids({ boxId: 'purchase', q: 'счет' }), ['m1'], 'е вместо ё: «Счёт»');
  assert.deepEqual(ids({ boxId: 'clients', q: 'ПАНЕЛИ' }), ['m9'], 'регистр, ящик клиентов');
  assert.deepEqual(ids({ boxId: 'clients', q: 'привезете' }), ['m9'], 'е вместо ё внутри слова: «привезёте»');
  assert.deepEqual(ids({ boxId: 'purchase', q: 'панели' }), [], 'письмо клиента в ящике закупок не ищется');
  assert.deepEqual(ids({ boxId: 'purchase', q: 'акт напоминаем' }), ['m3'], 'несколько слов — все должны найтись');
  // папка: тот же запрос, но только в «Разобрать» / только у поставщика
  assert.deepEqual(ids({ boxId: 'purchase', folder: 'inbox', q: 'alpha' }), ['m2', 'm3', 'm4']);
  assert.deepEqual(ids({ boxId: 'purchase', folder: 's1', q: 'alpha' }), ['m1']);
  // без запроса — всё в ящике или в папке
  assert.equal(ids({ boxId: 'purchase' }).length, 7);
  assert.deepEqual(ids({ boxId: 'purchase', folder: 's1' }), ['m1']);
});

test('search: новые письма сверху', () => {
  const app = load(), st = mini(app);
  st.mail.letters.find(l => l.id === 'm7').at = new Date(2026, 9, 25);
  st.mail.letters.find(l => l.id === 'm6').at = new Date(2026, 9, 22);
  assert.deepEqual(app.Mail.search(st, { boxId: 'purchase', q: 'gamma' }).map(l => l.id), ['m7', 'm6']);
});

// ——— boxesFor ———
test('boxesFor: логист — «Закупки», менеджер — «Клиенты», директор — оба, кладовщик — ни одного', () => {
  const app = load(), st = mini(app);
  const ids = p => [...app.Mail.boxesFor(st, p)].map(b => b.id);
  assert.deepEqual(ids('log'), ['purchase']);
  assert.deepEqual(ids('mgb'), ['clients']);
  assert.deepEqual(ids('mgc'), ['clients']);
  assert.deepEqual(ids('dir'), ['purchase', 'clients']);
  assert.deepEqual(ids('wh'), []);
  assert.deepEqual(ids('нет-такого'), []);
});

test('boxesFor: без права mail ящика нет, даже если роль указана; директор видит и ящик без ролей', () => {
  const app = load(), st = mini(app);
  st.mail.boxes.push({ id: 'extra', kind: 'other', title: 'Новый', address: '', roles: ['warehouse'] });
  assert.equal(app.Mail.boxesFor(st, 'wh').length, 0, 'у кладовщика нет права mail');
  assert.ok(app.Mail.boxesFor(st, 'dir').some(b => b.id === 'extra'), 'директор видит все ящики');
  st.mail.boxes.push({ id: 'empty', kind: 'other', title: 'Без ролей', address: '', roles: [] });
  assert.ok(app.Mail.boxesFor(st, 'dir').some(b => b.id === 'empty'));
  assert.ok(!app.Mail.boxesFor(st, 'log').some(b => b.id === 'empty'));
  // право mail снято у роли — ящики пропадают
  st.roles.find(r => r.id === 'logist').perms.mail = false;
  assert.equal(app.Mail.boxesFor(st, 'log').length, 0);
});

// ——— deliver ———
test('deliver: письмо от известного поставщика — в его папку; уведомление тем, кто видит ящик, не кладовщику', () => {
  const app = load(), st = mini(app), now = new Date(2026, 9, 31, 9, 15);
  const l = app.Mail.deliver(st, { boxId: 'purchase', from: 'sales@alpha.example', fromName: 'Продажи', subject: 'Отгрузка', body: 'Отгрузили.' }, now);
  assert.equal(l.folder, 's1');
  assert.equal(l.read, false);
  assert.deepEqual([l.at, l.boxId], [now, 'purchase']);
  assert.ok(st.mail.letters.includes(l), 'письмо лежит в ящике');
  assert.equal(new Set(st.mail.letters.map(x => x.id)).size, st.mail.letters.length, 'id не повторяются');
  assert.equal(st.notes.length, 1);
  const n = st.notes[0];
  assert.equal(n.kind, 'mail');
  assert.deepEqual([...n.to].sort(), ['dir', 'log']);
  assert.ok(!n.to.includes('wh'), 'кладовщику не приходит');
  assert.ok(!n.to.includes('mgb') && !n.to.includes('mgc'), 'менеджерам письмо закупок не приходит');
  assert.ok(n.text.includes('Закупки') && n.text.includes('Отгрузка'), 'в тексте ящик и тема');
});

test('deliver: незнакомый отправитель — в «Разобрать»; ящик клиентов — менеджерам и директору; выключенный вид не приходит', () => {
  const app = load(), st = mini(app), now = new Date(2026, 9, 31, 9, 15);
  const a = app.Mail.deliver(st, { boxId: 'purchase', from: 'stranger@unknown.example', subject: 'Предложение', body: 'Здравствуйте.' }, now);
  assert.equal(a.folder, 'inbox');
  const b = app.Mail.deliver(st, { boxId: 'clients', from: 'sales@alpha.example', subject: 'Вопрос', body: 'Когда монтаж?' }, now);
  assert.equal(b.folder, 'inbox', 'в ящике клиентов папок поставщиков нет');
  assert.deepEqual([...st.notes[0].to].sort(), ['dir', 'mgb', 'mgc']);
  // логист отключил вид «почта» — ему уведомление закупок уже не приходит, директору приходит
  st.prefs.notify.log = { mail: false };
  app.Mail.deliver(st, { boxId: 'purchase', from: 'sales@alpha.example', subject: 'Ещё', body: '.' }, now);
  assert.deepEqual([...st.notes[0].to], ['dir']);
  // нет такого ящика — письма нет, уведомления нет
  const count = st.mail.letters.length, notes = st.notes.length;
  assert.equal(app.Mail.deliver(st, { boxId: 'no-such', from: 'a@b.example', subject: 's', body: 'b' }, now), null);
  assert.deepEqual([st.mail.letters.length, st.notes.length], [count, notes]);
});

// ——— reply ———
test('reply: ответ ложится в ветку письма с пометкой «имитация, не отправлено»', () => {
  const app = load(), st = mini(app), now = new Date(2026, 9, 31, 11, 0);
  const r = app.Mail.reply(st, 'm1', '  Спасибо, счёт получили.  ', 'log', now);
  assert.equal(r.text, 'Спасибо, счёт получили.');
  assert.equal(r.sim, true);
  assert.equal(r.note, 'имитация, не отправлено');
  assert.equal(app.Mail.SIM_NOTE, 'имитация, не отправлено');
  assert.deepEqual([r.by, r.at], ['log', now]);
  const letter = st.mail.letters.find(l => l.id === 'm1');
  assert.equal(letter.replies.length, 1);
  assert.equal(letter.replies[0], r, 'ответ — в ветке самого письма');
  assert.equal(letter.read, true, 'письмо с ответом прочитано');
  assert.equal(st.mail.letters.length, 9, 'новых писем в ящике не появилось');
  const r2 = app.Mail.reply(st, 'm1', 'Второй ответ', 'dir', now);
  assert.notEqual(r2.id, r.id);
  assert.equal(letter.replies.length, 2);
});

test('reply: пустой текст, нет письма, нет доступа к ящику — ответа нет', () => {
  const app = load(), st = mini(app), now = new Date(2026, 9, 31, 11, 0);
  assert.equal(app.Mail.reply(st, 'm1', '   ', 'log', now), null);
  assert.equal(app.Mail.reply(st, 'нет', 'Текст', 'log', now), null);
  assert.equal(app.Mail.reply(st, 'm1', 'Текст', 'wh', now), null, 'кладовщик не видит ящик');
  assert.equal(app.Mail.reply(st, 'm9', 'Текст', 'log', now), null, 'логист не видит ящик клиентов');
  assert.ok(st.mail.letters.every(l => !(l.replies || []).length), 'ветки ответов пусты');
});

// ——— демо-данные ———
test('демо: два ящика без адресов, видят их те, кому положено', () => {
  const app = load(), st = app.seed();
  assert.deepEqual(JSON.parse(JSON.stringify(st.mail.boxes.map(b => [b.id, b.title, b.address]))), [['purchase', 'Закупки', ''], ['clients', 'Клиенты', '']],
    'адрес ящика — «нет данных»: в данных пусто, не выдуманный адрес');
  const who = Object.fromEntries(st.people.map(p => [p.role, p.id]));
  const ids = p => [...app.Mail.boxesFor(st, p)].map(b => b.id);
  assert.deepEqual(ids(who.logist), ['purchase']);
  assert.deepEqual(ids(who.managerB2b), ['clients']);
  assert.deepEqual(ids(who.managerB2c), ['clients']);
  assert.deepEqual(ids(who.director), ['purchase', 'clients']);
  assert.deepEqual(ids(who.warehouse), []);
  assert.deepEqual(ids(who.engineer), []);
});

test('демо: 5–6 поставщиков, все помечены «пример», правила на домене .example', () => {
  const st = load().seed();
  assert.ok(st.mail.suppliers.length >= 5 && st.mail.suppliers.length <= 6, `поставщиков ${st.mail.suppliers.length}`);
  for (const s of st.mail.suppliers) {
    assert.equal(s.example, true, `${s.name}: нет пометки example`);
    assert.ok(/пример/i.test(s.name), `${s.name}: в названии нет слова «пример»`);
    assert.ok(s.rules.length >= 1, `${s.name}: нет правила`);
    for (const r of s.rules) assert.ok(r.endsWith('.example'), `${s.name}: правило ${r} не на зарезервированном .example`);
  }
  assert.equal(new Set(st.mail.suppliers.map(s => s.id)).size, st.mail.suppliers.length);
  assert.ok(st.mail.suppliers.some(s => s.rules.some(r => r.startsWith('@'))), 'есть правило по домену');
  assert.ok(st.mail.suppliers.some(s => s.rules.some(r => !r.startsWith('@'))), 'есть правило по адресу');
});

test('демо: 30+ писем в обоих ящиках, часть — в «Разобрать», папки сходятся с правилами, письма помечены демо', () => {
  const app = load(), st = app.seed();
  const letters = st.mail.letters;
  assert.ok(letters.length >= 30, `писем ${letters.length}`);
  assert.equal(new Set(letters.map(l => l.id)).size, letters.length, 'id писем повторяются');
  const inBox = id => letters.filter(l => l.boxId === id);
  assert.ok(inBox('purchase').length >= 15 && inBox('clients').length >= 10, 'письма есть в обоих ящиках');
  const sorted = inBox('purchase').filter(l => l.folder === 'inbox');
  assert.ok(sorted.length >= 3 && sorted.length < inBox('purchase').length, `в «Разобрать» ${sorted.length}`);
  // каждый поставщик получил письма в свою папку; клиентские письма все во входящих
  for (const s of st.mail.suppliers) assert.ok(inBox('purchase').some(l => l.folder === s.id), `папка ${s.name} пуста`);
  assert.ok(inBox('clients').every(l => l.folder === 'inbox'));
  // папка каждого письма — ровно то, что дают правила
  for (const l of letters) assert.equal(l.folder, app.Mail.folderOf(st, l), `${l.id}: папка не по правилам`);
  for (const l of letters) {
    assert.equal(l.demo, true, `${l.id}: нет пометки demo`);
    assert.ok(l.from.endsWith('.example'), `${l.id}: адрес ${l.from} не на .example`);
    assert.ok(l.subject && l.body && l.fromName, `${l.id}: пустое поле`);
  }
  // и непрочитанные есть, и прочитанные
  assert.ok(letters.some(l => !l.read) && letters.some(l => l.read));
  // «Разобрать» среди прочих: письма незнакомых адресов, но и «хвост» известного поставщика, чьё правило — один адрес
  assert.ok(sorted.some(l => l.from.endsWith('@akb-2.example')), 'есть письмо с другого адреса уже известной фирмы');
});

test('демо: даты — последние две недели до 31.10.2026, не позже', () => {
  const st = load().seed();
  const from = new Date(2026, 9, 17), to = new Date(2026, 9, 31, 23, 59, 59);
  for (const l of st.mail.letters) {
    assert.ok(isDate(l.at) && l.at >= from && l.at <= to, `${l.id}: дата ${l.at}`);
  }
  assert.ok(st.mail.letters.some(l => l.at < new Date(2026, 9, 20)), 'есть письма двухнедельной давности');
  assert.ok(st.mail.letters.some(l => l.at >= new Date(2026, 9, 31)), 'есть письма «сегодня» демо');
});

test('демо: в письмах названы настоящие позиции каталога, не выдуманные товары', () => {
  const st = load().seed();
  const named = st.mail.letters.filter(l => st.products.some(p => p.inCatalog && l.body.includes(p.name)));
  assert.ok(named.length >= 15, `писем с настоящими позициями: ${named.length}`);
  // у каждого вида товара — хотя бы одно письмо
  for (const cat of ['Инверторы', 'Аккумуляторы', 'Панели']) {
    // слово директора 2026-11-08: у категории есть виды («Инверторы › Гибридные») — товары видов тоже её
    assert.ok(named.some(l => st.products.some(p => (p.cat === cat || p.cat.startsWith(cat + ' › ')) && l.body.includes(p.name))), `нет письма про «${cat}»`);
  }
  // выдуманные товары прототипа v2 не просочились
  for (const bad of ['PV-550M', 'INV-H6', 'BAT-LFP-100', 'WND-3K']) {
    assert.ok(!st.mail.letters.some(l => (l.subject + l.body).includes(bad)), `письмо называет выдуманный ${bad}`);
  }
});

test('демо: поиск по папке поставщика и «запомнить» работают на демо-письмах', () => {
  const app = load(), st = app.seed();
  const letter = st.mail.letters.find(l => l.from === 'logistics@akb-2.example');
  assert.equal(letter.folder, 'inbox');
  const res = app.Mail.remember(st, letter.id, 'sup2', 'address');
  assert.deepEqual([res.ok, res.rule, res.moved], [true, 'logistics@akb-2.example', 1]);
  assert.equal(letter.folder, 'sup2');
  const found = [...app.Mail.search(st, { boxId: 'purchase', folder: 'sup2', q: 'трек-номер' })].map(l => l.id);
  assert.ok(found.includes(letter.id), 'после «запомнить» письмо ищется в папке поставщика');
  // а письмо с другого адреса того же домена правило по адресу не тронуло
  assert.equal(st.mail.letters.find(l => l.from === 'manager@akb-2.example').folder, 'inbox');
});

test('демо: письма переживают сохранение — даты остаются датами, ветка ответов цела', () => {
  const app = load(), st = app.seed();
  const dump = app.Store.dump(st);
  assert.equal(dump.droppedPhotos, 0);
  assert.equal(dump.fits, true, 'письма помещаются в сохранение');
  const back = app.Store.load(dump.text);
  assert.equal(back.mail.letters.length, st.mail.letters.length);
  assert.ok(back.mail.letters.every(l => isDate(l.at) && !isNaN(l.at)), 'даты писем ожили');
  const replied = back.mail.letters.filter(l => (l.replies || []).length);
  assert.ok(replied.length >= 1 && replied[0].replies[0].sim === true, 'есть демо-ответ с пометкой имитации');
  assert.deepEqual([...back.mail.suppliers.map(s => s.id)], [...st.mail.suppliers.map(s => s.id)]);
});

// ═══════════════ экраны и настройки (таск 05, второй кусок) ═══════════════
// Идём через публичные входы страницы: setMe/go, A[…], FORMS[…], поля data-on, SIMS. Ожидаемые значения — из таска 05
// и независимого подсчёта по данным (не через Mail.search); демо-письма — из шага SEEDS в 36-mail.js.
const roleId = (app, role) => app.S.people.find(p => p.role === role).id;
const asRole = (app, role) => { app.setMe(roleId(app, role)); return app; };
const viewHtml = app => app.document.getElementById('view').innerHTML;
const openMail = (app, role) => { asRole(app, role); app.go('mail'); return viewHtml(app); };
const el = (app, id) => app.document.getElementById(id);
const byFrom = (app, from) => app.S.mail.letters.find(l => l.from === from);
const fireOn = (app, type, key, value, extra = {}) => app.document.dispatchEvent({ type, target: { dataset: { on: key, ...extra }, value, checked: value } });
const boxButtons = html => (html.match(/data-act="mail-box"/g) || []).length;
const folderBtn = (html, f) => (html.match(new RegExp(`data-act="mail-folder" data-folder="${f}">(.*?)</button>`)) || [])[1];
const cntOf = btn => (btn && btn.match(/cnt hot">(\d+)</) ? Number(btn.match(/cnt hot">(\d+)</)[1]) : 0);

test('меню: «Почта» есть у логиста, менеджеров и директора, у кладовщика и инженера её нет', () => {
  const app = load();
  for (const role of ['logist', 'managerB2b', 'managerB2c', 'director']) {
    asRole(app, role);
    assert.ok(app.navItems().some(n => n.id === 'mail'), `${role}: нет пункта «Почта»`);
    assert.ok(el(app, 'side').innerHTML.includes('data-view="mail"'), `${role}: пункта нет на боковой панели`);
  }
  for (const role of ['warehouse', 'engineer']) {
    asRole(app, role);
    assert.ok(!app.navItems().some(n => n.id === 'mail'), `${role}: пункт «Почта» есть`);
    assert.ok(!el(app, 'side').innerHTML.includes('data-view="mail"'));
    app.S.view = 'mail'; app.render();   // прямой переход по адресу
    assert.ok(viewHtml(app).includes('Нет доступа'), `${role}: письма открылись без права`);
    assert.ok(!viewHtml(app).includes('mail-li'));
  }
});

test('раздел: логист видит только «Закупки», менеджер — только «Клиенты», директор — оба', () => {
  const app = load();
  let html = openMail(app, 'logist');
  assert.equal(boxButtons(html), 1);
  assert.ok(html.includes('data-act="mail-box" data-id="purchase"') && !html.includes('data-id="clients"'));
  assert.ok(html.includes('data-act="mail-folder"'), 'в «Закупках» есть папки поставщиков');
  html = openMail(app, 'managerB2c');
  assert.equal(boxButtons(html), 1);
  assert.ok(html.includes('data-id="clients"') && !html.includes('data-id="purchase"'));
  assert.ok(!html.includes('data-act="mail-folder"'), 'в ящике клиентов папок поставщиков нет');
  assert.ok(!html.includes('akb-2.example'), 'письма закупок менеджеру не показываются');
  html = openMail(app, 'director');
  assert.equal(boxButtons(html), 2);
});

test('раздел: адреса ящиков — «нет данных: адрес»; поставщики и письма помечены «пример»', () => {
  const app = load();
  const html = openMail(app, 'director');
  assert.equal((html.match(/нет данных: адрес/g) || []).length, 2, 'у обоих ящиков адреса нет');
  const nav = html.slice(html.indexOf('mail-nav'), html.indexOf('mail-list'));
  assert.equal((nav.match(/Поставщик-пример \d/g) || []).length, 6);
  assert.equal((nav.match(/<span class="pill sm">пример<\/span>/g) || []).length, 6, 'у каждого из шести поставщиков пометка «пример»');
  const items = html.slice(html.indexOf('id="mail-items"'));
  assert.ok(/<span class="pill sm">пример<\/span>/.test(items), 'у демо-писем пометка «пример»');
});

test('счётчики: у папки, ящика и пункта меню — столько, сколько непрочитанных писем лежит в ней', () => {
  const app = load();
  const html = openMail(app, 'director');
  const raw = (box, f) => app.S.mail.letters.filter(l => l.boxId === box && (f === 'all' || l.folder === f) && !l.read).length;
  const folders = ['all', 'inbox', ...app.S.mail.suppliers.map(s => s.id)];
  assert.ok(raw('purchase', 'all') > 0 && raw('purchase', 'inbox') > 0, 'в демо есть непрочитанные, в том числе в «Разобрать»');
  for (const f of folders) {
    const n = raw('purchase', f), btn = folderBtn(html, f);
    assert.ok(btn, `нет кнопки папки ${f}`);
    assert.equal(app.mailUnread('purchase', f), n, `папка ${f}`);
    assert.equal(cntOf(btn), n, `счётчик на экране, папка ${f}`);
  }
  assert.equal(app.mailUnread('clients'), raw('clients', 'all'));
  // пункт меню директора: сумма по обоим ящикам
  const item = el(app, 'side').innerHTML.match(/data-view="mail">.*?<\/button>/)[0];
  assert.equal(cntOf(item), raw('purchase', 'all') + raw('clients', 'all'));
  // открыли непрочитанное письмо из «Разобрать» — оно прочитано, счётчик папки на единицу меньше
  const before = raw('purchase', 'inbox'), l = app.S.mail.letters.find(x => x.boxId === 'purchase' && x.folder === 'inbox' && !x.read);
  app.A['mail-open']({ dataset: { id: l.id } });
  assert.equal(l.read, true);
  assert.equal(raw('purchase', 'inbox'), before - 1);
  assert.equal(app.mailUnread('purchase', 'inbox'), before - 1);
  assert.equal(cntOf(folderBtn(viewHtml(app), 'inbox')), before - 1, 'на экране счётчик тоже уменьшился');
});

test('поиск в разделе: по ящику и по папке, находит по отправителю, теме и тексту', () => {
  const app = load();
  openMail(app, 'director');
  const hits = () => (el(app, 'mail-items').innerHTML.match(/data-act="mail-open"/g) || []).length;
  fireOn(app, 'input', 'mail-q', 'ТРЕК-НОМЕР');
  assert.ok(el(app, 'mail-items').innerHTML.includes('Трек-номер для отслеживания'), 'нашлось по теме и тексту');
  assert.ok(el(app, 'mail-items').innerHTML.includes('Найдено: <b>'));
  fireOn(app, 'input', 'mail-q', 'logistics@akb-2');
  assert.equal(hits(), 1, 'по адресу отправителя — одно письмо');
  // в папке «Разобрать» это письмо есть, в папке другого поставщика — нет
  app.A['mail-folder']({ dataset: { folder: 'sup1' } });
  fireOn(app, 'input', 'mail-q', 'logistics@akb-2');
  assert.equal(hits(), 0, 'в папке sup1 письма с akb-2 нет');
  assert.ok(el(app, 'mail-items').innerHTML.includes('По этому запросу писем нет'));
  app.A['mail-folder']({ dataset: { folder: 'inbox' } });
  fireOn(app, 'input', 'mail-q', 'logistics@akb-2');
  assert.equal(hits(), 1);
  // менеджер: письма закупок в его ящике не ищутся
  openMail(app, 'managerB2b');
  fireOn(app, 'input', 'mail-q', 'logistics@akb-2');
  assert.equal(hits(), 0);
});

test('телефон: один столбец — список, письмо, «назад»; открытое письмо прочитано', () => {
  const app = load();
  assert.ok(openMail(app, 'logist').includes('data-pane="list"'));
  const l = app.S.mail.letters.find(x => x.boxId === 'purchase' && !x.read);
  app.A['mail-open']({ dataset: { id: l.id } });
  assert.ok(viewHtml(app).includes('data-pane="letter"'));
  assert.ok(viewHtml(app).includes(l.subject) && viewHtml(app).includes('data-act="mail-back"'));
  assert.equal(l.read, true);
  app.A['mail-back']();
  assert.ok(viewHtml(app).includes('data-pane="list"'));
  app.A['mail-back']();
  assert.ok(viewHtml(app).includes('data-pane="nav"'));
  // в стилях — правило одного столбца на узком экране
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'css', '61-mail.css'), 'utf8');
  assert.ok(/@media \(max-width:900px\)[\s\S]*\.mail\[data-pane="letter"\]/.test(css));
});

test('ответ: форма, текст ложится в ветку письма с пометкой «имитация, не отправлено»', () => {
  const app = load();
  openMail(app, 'logist');
  const l = byFrom(app, 'sales@invertor-1.example');
  app.A['mail-open']({ dataset: { id: l.id } });
  app.A['mail-reply']({ dataset: {} });
  assert.ok(viewHtml(app).includes('data-form="mail-reply"'), 'форма ответа открылась');
  el(app, 'mail-reply-text').value = '   ';
  app.FORMS['mail-reply']({ dataset: { id: l.id } });
  assert.equal(el(app, 'mail-reply-err').hidden, false, 'пустой ответ — ошибка');
  assert.ok(!(l.replies || []).length);
  el(app, 'mail-reply-text').value = 'Спасибо, счёт получили, оплатим в срок.';
  app.FORMS['mail-reply']({ dataset: { id: l.id } });
  assert.equal(l.replies.length, 1);
  assert.equal(l.replies[0].text, 'Спасибо, счёт получили, оплатим в срок.');
  const html = viewHtml(app);
  assert.ok(html.includes('Спасибо, счёт получили, оплатим в срок.'), 'ответ виден в ветке');
  assert.ok(html.includes('имитация, не отправлено'), 'с пометкой имитации');
  assert.ok(!html.includes('data-form="mail-reply"'), 'форма закрылась');
  // менеджеру ответ на письмо закупок не записать
  openMail(app, 'managerB2b');
  assert.equal(app.Mail.reply(app.S, l.id, 'Чужое', app.S.me, new Date()), null);
});

test('«запомнить адрес» из письма: письмо и другие письма этого адреса переезжают в папку поставщика', () => {
  const app = load();
  openMail(app, 'logist');
  const now = new Date(2026, 9, 31, 12);
  const a = app.Mail.deliver(app.S, { boxId: 'purchase', from: 'zed@newco.example', subject: 'Первое', body: 'Здравствуйте.' }, now);
  const b = app.Mail.deliver(app.S, { boxId: 'purchase', from: 'ZED@newco.example', subject: 'Второе', body: 'Ещё раз.' }, now);
  const c = app.Mail.deliver(app.S, { boxId: 'purchase', from: 'other@newco.example', subject: 'Третье', body: 'Другой адрес.' }, now);
  assert.deepEqual([a.folder, b.folder, c.folder], ['inbox', 'inbox', 'inbox']);
  app.A['mail-open']({ dataset: { id: a.id } });
  let html = viewHtml(app);
  assert.ok(html.includes('data-form="mail-remember"') && html.includes('Запомнить адрес'));
  assert.ok(html.includes('этот адрес — zed@newco.example') && html.includes('весь домен — @newco.example'));
  // не выбран поставщик — отказ, ничего не меняется
  el(app, 'mail-sup').value = ''; el(app, 'mail-mode').value = 'address';
  app.FORMS['mail-remember']({ dataset: { id: a.id } });
  assert.equal(el(app, 'mail-err').hidden, false);
  assert.equal(a.folder, 'inbox');
  // выбрали поставщика и «этот адрес»
  el(app, 'mail-sup').value = 'sup3';
  app.FORMS['mail-remember']({ dataset: { id: a.id } });
  assert.deepEqual([a.folder, b.folder, c.folder], ['sup3', 'sup3', 'inbox'], 'переехали два письма с этого адреса, третье с другого осталось');
  assert.ok(app.S.mail.suppliers.find(s => s.id === 'sup3').rules.includes('zed@newco.example'));
  html = viewHtml(app);
  assert.ok(!html.includes('data-form="mail-remember"'), 'письмо уже в папке поставщика — запоминать нечего');
  assert.ok(html.includes('Поставщик-пример 3'), 'в письме названа папка поставщика');
  // весь домен: оставшееся письмо тоже переезжает
  app.A['mail-open']({ dataset: { id: c.id } });
  el(app, 'mail-sup').value = 'sup3'; el(app, 'mail-mode').value = 'domain';
  app.FORMS['mail-remember']({ dataset: { id: c.id } });
  assert.equal(c.folder, 'sup3');
  assert.ok(app.S.mail.suppliers.find(s => s.id === 'sup3').rules.includes('@newco.example'));
  // в ящике клиентов блока «запомнить» нет
  openMail(app, 'managerB2b');
  app.A['mail-open']({ dataset: { id: app.S.mail.letters.find(l => l.boxId === 'clients').id } });
  assert.ok(!viewHtml(app).includes('data-form="mail-remember"'));
});

test('«Настройки → Почта»: вкладка есть при праве settings и нет без него', () => {
  const app = load();
  asRole(app, 'director');
  assert.ok(app.settingsTabs().some(t => t.id === 'mail'));
  app.S.view = 'settings'; app.S.ui.setTab = 'mail'; app.render();
  assert.ok(viewHtml(app).includes('Добавить ящик') && viewHtml(app).includes('Поставщики и их папки'));
  asRole(app, 'logist');
  assert.ok(!app.settingsTabs().some(t => t.id === 'mail'), 'у логиста вкладки нет');
  // право дали — вкладка появилась, забрали — исчезла
  app.S.roles.find(r => r.id === 'logist').perms.settings = true;
  assert.ok(app.settingsTabs().some(t => t.id === 'mail'));
  app.S.roles.find(r => r.id === 'logist').perms.settings = false;
  assert.ok(!app.settingsTabs().some(t => t.id === 'mail'));
});

test('добавить ящик: появляется в «Почте» у тех, кого отметили, с пометкой «подключение — на следующем этапе»', () => {
  const app = load();
  asRole(app, 'director');
  const count = app.S.mail.boxes.length;
  // без названия и с кривым адресом — отказ
  el(app, 'mbox-new-title').value = '  ';
  app.FORMS['mbox-add']();
  assert.equal(el(app, 'mbox-err').hidden, false);
  el(app, 'mbox-new-title').value = 'Рекламации'; el(app, 'mbox-new-addr').value = 'не-адрес';
  app.FORMS['mbox-add']();
  assert.equal(app.S.mail.boxes.length, count, 'отказ ничего не добавил');
  // правильно: адрес пустой — «нет данных: адрес»; видят менеджеры B2B
  el(app, 'mbox-new-addr').value = '';
  el(app, 'mbox-new-role-managerB2b').checked = true;
  app.FORMS['mbox-add']();
  assert.equal(app.S.mail.boxes.length, count + 1);
  const box = app.S.mail.boxes[count];
  assert.deepEqual([box.title, box.address, [...box.roles]], ['Рекламации', '', ['managerB2b']]);
  // повтор названия — отказ
  el(app, 'mbox-new-title').value = 'рекламации';
  app.FORMS['mbox-add']();
  assert.equal(app.S.mail.boxes.length, count + 1);
  // у менеджера B2B ящик в «Почте» с пометкой, у менеджера B2C и логиста — нет, у директора — есть
  let html = openMail(app, 'managerB2b');
  assert.equal(boxButtons(html), 2);
  assert.ok(html.includes('Рекламации') && html.includes('подключение — на следующем этапе'));
  assert.ok(!openMail(app, 'managerB2c').includes('Рекламации'));
  assert.ok(!openMail(app, 'logist').includes('Рекламации'));
  assert.equal(boxButtons(openMail(app, 'director')), 3);
  // пустой ящик показывает, что писем нет и почему; в него можно доставить письмо
  app.A['mail-box']({ dataset: { id: box.id } });
  assert.ok(viewHtml(app).includes('писем пока нет'));
  app.A['mail-sim']({ dataset: { box: box.id } });
  assert.equal(app.S.mail.letters.filter(l => l.boxId === box.id).length, 1);
});

test('поставщики в настройках: добавить, переименовать, поправить правило; письма раскладываются заново', () => {
  const app = load();
  asRole(app, 'director');
  const folderOf = from => byFrom(app, from).folder;
  const rulesOf = id => [...app.S.mail.suppliers.find(s => s.id === id).rules];
  // правило по адресу заменили правилом по домену: два письма akb-2 из «Разобрать» переехали в папку sup2
  assert.deepEqual([folderOf('manager@akb-2.example'), folderOf('logistics@akb-2.example')], ['inbox', 'inbox']);
  fireOn(app, 'change', 'msup-rules', '@akb-2.example', { id: 'sup2' });
  assert.deepEqual(rulesOf('sup2'), ['@akb-2.example']);
  assert.deepEqual([folderOf('manager@akb-2.example'), folderOf('logistics@akb-2.example')], ['sup2', 'sup2']);
  // «firma.ru» без @ — тоже весь домен; два правила через запятую
  fireOn(app, 'change', 'msup-rules', 'hello@ctrl-5.example, ctrl-5-b.example', { id: 'sup5' });
  assert.deepEqual(rulesOf('sup5'), ['hello@ctrl-5.example', '@ctrl-5-b.example']);
  // мусор и чужое правило не принимаются, правила остаются прежними
  fireOn(app, 'change', 'msup-rules', 'это не адрес', { id: 'sup1' });
  assert.deepEqual(rulesOf('sup1'), ['@invertor-1.example']);
  fireOn(app, 'change', 'msup-rules', '@invertor-1.example, @panel-3.example', { id: 'sup1' });
  assert.deepEqual(rulesOf('sup1'), ['@invertor-1.example'], 'домен panel-3 уже у sup3');
  // переименование: своё название — уже не пример
  fireOn(app, 'change', 'msup-name', 'Инверторы Восток', { id: 'sup1' });
  const s1 = app.S.mail.suppliers.find(s => s.id === 'sup1');
  assert.deepEqual([s1.name, s1.example], ['Инверторы Восток', false]);
  assert.ok(openMail(app, 'director').includes('Инверторы Восток'), 'в «Почте» новое название');
  fireOn(app, 'change', 'msup-name', 'инверторы восток', { id: 'sup2' });
  assert.notEqual(app.S.mail.suppliers.find(s => s.id === 'sup2').name, 'инверторы восток', 'занятое название не принято');
  // новый поставщик: письмо незнакомого адреса из «Разобрать» переехало в его папку
  assert.equal(folderOf('offers@newsupplier-7.example'), 'inbox');
  el(app, 'msup-new-name').value = 'Кабельный завод'; el(app, 'msup-new-rules').value = 'offers@newsupplier-7.example';
  app.FORMS['msup-add']();
  const added = app.S.mail.suppliers[app.S.mail.suppliers.length - 1];
  assert.deepEqual([added.name, added.example, [...added.rules]], ['Кабельный завод', false, ['offers@newsupplier-7.example']]);
  assert.equal(folderOf('offers@newsupplier-7.example'), added.id);
  el(app, 'msup-new-name').value = ''; app.FORMS['msup-add']();
  assert.equal(el(app, 'msup-err').hidden, false);
});

test('удаление поставщика: его письма не пропадают, а переходят в «Разобрать»', () => {
  const app = load();
  asRole(app, 'director');
  const total = app.S.mail.letters.length;
  const mine = app.S.mail.letters.filter(l => l.folder === 'sup1').map(l => l.id);
  const others = app.S.mail.letters.filter(l => l.folder !== 'sup1').map(l => [l.id, l.folder]);
  assert.ok(mine.length >= 3, 'в папке sup1 есть письма');
  assert.ok(app.MODALS['msup-del']('sup1').includes(`Писем в его папке: ${mine.length}`), 'окно называет, сколько писем перейдёт');
  // смотрим эту папку в «Почте», потом удаляем — экран не ломается
  app.go('mail'); app.A['mail-folder']({ dataset: { folder: 'sup1' } });
  app.FORMS['msup-del']({ dataset: { id: 'sup1' } });
  assert.ok(!app.S.mail.suppliers.some(s => s.id === 'sup1'));
  assert.equal(app.S.mail.letters.length, total, 'письма не удалены');
  for (const id of mine) assert.equal(app.S.mail.letters.find(l => l.id === id).folder, 'inbox', `${id} не в «Разобрать»`);
  for (const [id, f] of others) assert.equal(app.S.mail.letters.find(l => l.id === id).folder, f, `${id}: чужое письмо сдвинулось`);
  assert.ok(!viewHtml(app).includes('data-folder="sup1"'), 'папки удалённого поставщика на экране нет');
  assert.equal(app.mailSel().folder, 'all', 'выбранная папка удалённого поставщика сброшена');
  // новое письмо с адреса удалённого поставщика теперь тоже в «Разобрать»
  const l = app.Mail.deliver(app.S, { boxId: 'purchase', from: 'sales@invertor-1.example', subject: 'Ещё', body: '.' }, new Date(2026, 9, 31, 13));
  assert.equal(l.folder, 'inbox');
});

test('имитация «пришло письмо»: поочерёдно от известного поставщика и от незнакомого, уведомление тем, кто видит ящик', () => {
  const app = load();
  asRole(app, 'director');
  const sim = app.SIMS.find(s => s.id === 'mail');
  assert.equal(sim.label, 'Имитация: пришло письмо');
  const n0 = app.S.mail.letters.length, notes0 = app.S.notes.length;
  sim.run();
  const first = app.S.mail.letters[app.S.mail.letters.length - 1];
  assert.equal(app.S.mail.letters.length, n0 + 1);
  assert.equal(first.boxId, 'purchase');
  assert.ok(app.S.mail.suppliers.some(s => s.id === first.folder), 'первое — от известного поставщика, лежит в его папке');
  assert.equal(first.read, false);
  assert.equal(first.demo, true, 'письмо помечено «пример»');
  assert.equal(app.S.notes.length, notes0 + 1);
  assert.equal(app.S.notes[0].kind, 'mail');
  const ofRoles = roles => [...app.S.people.filter(p => roles.includes(p.role)).map(p => p.id)].sort();
  assert.deepEqual([...app.S.notes[0].to].sort(), ofRoles(['director', 'logist']), 'видят ящик закупок: директор и логисты');
  sim.run();
  assert.equal(app.S.mail.letters[app.S.mail.letters.length - 1].folder, 'inbox', 'второе — от незнакомого адреса, в «Разобрать»');
  assert.equal(app.S.notes.length, notes0 + 2);
  // кнопка в разделе — то же действие, но в выбранный ящик (клиенты → менеджерам и директору)
  app.A['mail-sim']({ dataset: { box: 'clients' } });
  assert.equal(app.S.mail.letters[app.S.mail.letters.length - 1].boxId, 'clients');
  assert.deepEqual([...app.S.notes[0].to].sort(), ofRoles(['managerB2b', 'managerB2c', 'director']), 'ящик клиентов: все менеджеры и директор');
  assert.ok(!app.S.notes[0].to.some(id => ofRoles(['warehouse', 'logist', 'engineer']).includes(id)), 'кладовщику, логисту и инженерам письма клиентов не приходят');
  // уведомление называется «Почта», а не «Предупреждения»
  assert.equal(app.KIND.mail.l, 'Почта');
  app.go('notifications');
  assert.ok(viewHtml(app).includes('data-k="mail"'), 'в уведомлениях есть фильтр «Почта»');
});

test('сохранение со старой ревизией (до почты) уходит в пользу демо', () => {
  const app = load();
  assert.ok(app.Store.REV >= 3, 'ревизия не ниже той, что принесла почта');
  const old = JSON.parse(app.Store.dump(app.S).text);
  old.rev = 2; delete old.mail;
  assert.equal(app.Store.load(JSON.stringify(old)), null, 'ревизия 2 не читается');
  const boot = load({ storage: { [app.Store.KEY]: JSON.stringify(old) } });
  assert.ok(boot.S.mail.letters.length >= 30, 'вместо старого — демо с почтой');
  assert.equal(boot.S.mail.boxes.length, 2);
  // а сохранение текущей ревизии читается и письма в нём целы
  const cur = load({ storage: { [app.Store.KEY]: app.Store.dump(app.S).text } });
  assert.equal(cur.S.mail.letters.length, app.S.mail.letters.length);
});
