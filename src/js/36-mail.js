// Ядро: почта — ящики, папки поставщиков, правила по адресам. Чистая логика, без DOM.
// Это имитация: наружу ничего не уходит, ответ только ложится в ветку письма с пометкой.
// Папка письма — id поставщика или INBOX. В ящике закупок INBOX — это «Разобрать»; в остальных ящиках
// все письма лежат в INBOX. Правило поставщика — строка: точный адрес 'adr@x' или домен '@x'.
// Данные (st.mail): boxes, suppliers, letters — схема в interfaces.md; у письма ещё replies — ветка ответов, поле появляется с первым ответом.

const Mail = (() => {
  const INBOX = 'inbox';
  const SIM_NOTE = 'имитация, не отправлено';
  const NOTE_KIND = 'mail';

  // Чтение терпит состояние без st.mail (старое сохранение): тогда просто нет ящиков и писем.
  const data = st => st.mail || { boxes: [], suppliers: [], letters: [] };
  const boxOf = (st, boxId) => data(st).boxes.find(b => b.id === boxId) || null;

  const fold = s => String(s ?? '').toLowerCase().replace(/ё/g, 'е');
  // Адрес отправителя без регистра; «Имя <adr@x>» → adr@x.
  const addrOf = from => {
    const s = String(from ?? '');
    const m = s.match(/<([^>]*)>/);
    return (m ? m[1] : s).trim().toLowerCase();
  };
  const domainOf = addr => { const i = addr.lastIndexOf('@'); return i >= 0 ? addr.slice(i + 1) : ''; };
  const ruleKey = r => String(r ?? '').trim().toLowerCase();
  // Подходит ли адрес под правило: '@домен' — любой адрес этого домена, иначе — ровно этот адрес.
  const matches = (rule, addr) => {
    if (!rule || !addr) return false;
    if (rule.startsWith('@')) return rule.length > 1 && domainOf(addr) === rule.slice(1);
    return rule === addr;
  };

  // Ящики, которые видит человек. Без права mail — никаких; директор — все; остальные — по ролям ящика.
  function boxesFor(st, personId) {
    if (!Perms.can(st, personId, 'mail')) return [];
    const role = Perms.roleOf(st, personId);
    const all = !!(role && role.all === true);
    return data(st).boxes.filter(b => all || (b.roles || []).includes(role.id));
  }

  // Папка письма. Только ящик закупок раскладывает по поставщикам: точный адрес сильнее домена.
  function folderOf(st, letter) {
    const box = boxOf(st, letter.boxId);
    if (!box || box.kind !== 'purchase') return INBOX;
    const addr = addrOf(letter.from);
    const sups = data(st).suppliers;
    const rulesOf = s => (s.rules || []).map(ruleKey);
    const exact = sups.find(s => rulesOf(s).some(r => !r.startsWith('@') && matches(r, addr)));
    if (exact) return exact.id;
    const byDomain = sups.find(s => rulesOf(s).some(r => r.startsWith('@') && matches(r, addr)));
    return byDomain ? byDomain.id : INBOX;
  }

  // «Это поставщик X, запомнить адрес»: правило (адрес или весь домен) — поставщику; письма этого ящика,
  // которые теперь по правилам лежат у него, переезжают в его папку. Правило живёт у одного поставщика.
  // → {ok, reason, rule, moved}
  function remember(st, letterId, supplierId, mode) {
    const fail = reason => ({ ok: false, reason, rule: '', moved: 0 });
    const m = data(st);
    const letter = m.letters.find(l => l.id === letterId);
    if (!letter) return fail('Письмо не найдено');
    const sup = m.suppliers.find(s => s.id === supplierId);
    if (!sup) return fail('Поставщик не найден');
    const box = boxOf(st, letter.boxId);
    if (!box || box.kind !== 'purchase') return fail('Папки поставщиков есть только в ящике закупок');
    if (mode !== 'address' && mode !== 'domain') return fail('Правило: адрес или домен');
    const addr = addrOf(letter.from), dom = domainOf(addr);
    if (!addr || !dom) return fail('У письма нет адреса отправителя');
    const rule = mode === 'domain' ? '@' + dom : addr;
    for (const s of m.suppliers) if (s !== sup) s.rules = (s.rules || []).filter(r => ruleKey(r) !== rule);
    sup.rules = sup.rules || [];
    if (!sup.rules.some(r => ruleKey(r) === rule)) sup.rules.push(rule);
    let moved = 0;
    for (const l of m.letters) {
      if (l.boxId !== letter.boxId || !matches(rule, addrOf(l.from))) continue;
      if (folderOf(st, l) === sup.id && l.folder !== sup.id) { l.folder = sup.id; moved++; }
    }
    return { ok: true, reason: '', rule, moved };
  }

  // Поиск в ящике (и в папке, если задана) по отправителю, теме и тексту; без регистра и ё/е;
  // несколько слов — все должны найтись. Новые письма сверху.
  function search(st, { boxId, folder, q } = {}) {
    const words = fold(q).split(/\s+/).filter(Boolean);
    return data(st).letters
      .filter(l => l.boxId === boxId && (!folder || l.folder === folder))
      .filter(l => {
        const hay = fold([l.fromName, l.from, l.subject, l.body].join('\n'));
        return words.every(w => hay.includes(w));
      })
      .sort((a, b) => new Date(b.at) - new Date(a.at));
  }

  // Новое письмо в ящик: папка по правилам, уведомление тем, кто видит ящик. Нет такого ящика → null.
  // letter: {boxId, from, fromName?, subject, body, demo?}; id, дата, «не прочитано» и папку ставит эта функция.
  function deliver(st, letter, now) {
    const box = boxOf(st, letter.boxId);
    if (!box) return null;
    const m = data(st);
    const l = {
      id: Store.freeId(m.letters, 'ml'), boxId: box.id, from: letter.from, fromName: letter.fromName || '',
      subject: letter.subject || '', body: letter.body || '', at: now, read: false, folder: INBOX,
    };
    if (letter.demo) l.demo = true;
    l.folder = folderOf(st, l);
    m.letters.push(l);
    // Вид «mail» в Notify.RECIPIENTS пустой: адресаты — те, кто видит ящик, они идут через extra.
    const viewers = (st.people || []).filter(p => boxesFor(st, p.id).some(b => b.id === box.id)).map(p => p.id);
    const sup = m.suppliers.find(s => s.id === l.folder);
    const where = sup ? `папка «${sup.name}»` : box.kind === 'purchase' ? 'папка «Разобрать»' : 'входящие';
    Notify.push(st, NOTE_KIND, null, `Новое письмо в ящике «${box.title}» (${where}): ${l.subject} — от ${l.fromName || l.from}.`, now, viewers, { t: 'mail', id: l.id });
    return l;
  }

  // Ответ на письмо — в ветку письма, с пометкой «имитация, не отправлено». Ответить может тот, кто видит ящик.
  // Нет письма, пустой текст или нет доступа → null.
  function reply(st, letterId, text, by, now) {
    const letter = data(st).letters.find(l => l.id === letterId);
    const body = String(text ?? '').trim();
    if (!letter || !body) return null;
    if (!boxesFor(st, by).some(b => b.id === letter.boxId)) return null;
    letter.replies = letter.replies || [];
    const r = { id: Store.freeId(letter.replies, 'r'), by, at: now, text: body, sim: true, note: SIM_NOTE };
    letter.replies.push(r);
    letter.read = true;
    return r;
  }

  return { INBOX, SIM_NOTE, NOTE_KIND, boxesFor, folderOf, remember, search, deliver, reply };
})();

// База: почта пустая — ни ящиков, ни поставщиков, ни писем (в серверной CRM раздела «Почта» нет).
BASES.push(st => { st.mail = { boxes: [], suppliers: [], letters: [] }; });

// ——— демо-данные ———
// Шаг SEEDS: два ящика, шесть поставщиков-примеров и письма за две недели до фиксированной даты демо.
// Настоящих названий поставщиков и адресов нет — названия «Поставщик-пример N», адреса на зарезервированном
// домене .example, письма с пометкой demo. Адреса самих ящиков — «нет данных» (address:''), подключения нет.
// Товары в текстах — настоящие позиции каталога. Шаг стоит в файле раньше шага каталога (38), поэтому берёт
// позиции из тех же снимков сам: Catalog.build — чистая функция, на состояние не влияет.
SEEDS.push(st => {
  const DAY = new Date(2026, 9, 31); // фиксированная дата демо — день снимков каталога и остатков
  const at = (back, h, m) => new Date(DAY.getFullYear(), DAY.getMonth(), DAY.getDate() - back, h, m);
  const products = Catalog.build(CATALOG, STOCK_SNAPSHOT).products;
  // вид внутри категории («Инверторы › Гибридные») — та же категория
  const pick = (cat, i) => { const list = products.filter(p => Catalog.topOf(p.cat) === cat); return list[i % list.length] || products[0]; };
  const short = p => p.name.split(/\s[\[(]/)[0];
  const inv = [0, 1, 2].map(i => pick('Инверторы', i));
  const akb = [0, 1, 2].map(i => pick('Аккумуляторы', i));
  const pan = [0, 1].map(i => pick('Панели', i));
  const ctl = [0, 1].map(i => pick('Контроллеры', i));
  const prot = [0, 1].map(i => pick('Защита и соединения', i));
  const cab = pick('Кабель', 0);

  st.mail = {
    boxes: [
      { id: 'purchase', kind: 'purchase', title: 'Закупки', address: '', roles: ['logist', 'director'] },
      { id: 'clients', kind: 'clients', title: 'Клиенты', address: '', roles: ['managerB2b', 'managerB2c', 'director'] },
    ],
    suppliers: [
      { id: 'sup1', name: 'Поставщик-пример 1 (инверторы)', example: true, rules: ['@invertor-1.example'] },
      { id: 'sup2', name: 'Поставщик-пример 2 (аккумуляторы)', example: true, rules: ['sales@akb-2.example'] },
      { id: 'sup3', name: 'Поставщик-пример 3 (солнечные панели)', example: true, rules: ['@panel-3.example'] },
      { id: 'sup4', name: 'Поставщик-пример 4 (кабель и защита)', example: true, rules: ['orders@kabel-4.example', 'docs@kabel-4.example'] },
      { id: 'sup5', name: 'Поставщик-пример 5 (контроллеры)', example: true, rules: ['@ctrl-5.example'] },
      { id: 'sup6', name: 'Поставщик-пример 6 (крепёж)', example: true, rules: ['@krepezh-6.example'] },
    ],
    letters: [],
  };

  // [ящик, дней назад, час, минута, адрес, от кого, тема, текст]
  const rows = [
    // ——— Закупки ———
    ['purchase', 13, 15, 30, 'offers@newsupplier-7.example', 'Новый поставщик-пример', 'Коммерческое предложение на кабель', `Здравствуйте! Предлагаем поставки кабеля и коннекторов, в том числе ${cab.name}. Пришлём прайс по запросу.`],
    ['purchase', 12, 16, 20, 'info@panel-3.example', 'Поставщик-пример 3', `Подтверждение заказа: ${short(pan[1])}`, `Подтверждаем заказ: ${pan[1].name}, 40 шт. Отгрузка со склада поставщика на следующей неделе.`],
    ['purchase', 11, 11, 0, 'sales@akb-2.example', 'Поставщик-пример 2', `Отгрузка: ${short(akb[2])}`, `Заказ отгружен транспортной компанией: ${akb[2].name}, 6 шт. Трек-номер пришлём отдельным письмом.`],
    ['purchase', 10, 9, 30, 'orders@kabel-4.example', 'Поставщик-пример 4', 'Задержка отгрузки', `Здравствуйте! Отгрузка по вашему заказу (${prot[1].name}) задерживается на два дня: ждём поступления на склад.`],
    ['purchase', 10, 14, 45, 'hello@ctrl-5.example', 'Поставщик-пример 5', `Счёт на ${short(ctl[1])}`, `Выставили счёт на заказ: ${ctl[1].name}, 4 шт. Оплатить просим в течение пяти банковских дней.`],
    ['purchase', 9, 13, 10, 'sales@invertor-1.example', 'Поставщик-пример 1', 'Гарантийные условия', `Направляем условия гарантии на инверторы, в том числе на ${inv[1].name}. Срок гарантии и порядок обращения — в письме поставщика.`],
    ['purchase', 8, 10, 15, 'sales@akb-2.example', 'Поставщик-пример 2', `Счёт на ${short(akb[1])}`, `Выставили счёт: ${akb[1].name}, 8 шт. Просим оплатить и прислать подтверждение.`],
    ['purchase', 7, 12, 40, 'promo@expo-1.example', 'Организаторы выставки (пример)', 'Приглашение на выставку солнечной энергетики', 'Приглашаем принять участие в выставке. Подробности и условия участия — на сайте организаторов.'],
    ['purchase', 7, 16, 5, 'ivan@mail-5.example', 'Иван, частное лицо (пример)', 'Оптовые цены на панели', `Здравствуйте! Хотим закупать ${pan[0].name} оптом. Какие условия?`],
    ['purchase', 6, 11, 25, 'sales@invertor-1.example', 'Поставщик-пример 1', 'Прайс-лист обновлён', `Обновили прайс-лист. Изменились позиции по инверторам, в том числе ${inv[2].name}.`],
    ['purchase', 6, 16, 0, 'info@krepezh-6.example', 'Поставщик-пример 6', `Счёт на ${short(prot[0])}`, `Выставили счёт: ${prot[0].name}, 20 шт. Реквизиты в карточке заказа поставщика.`],
    ['purchase', 5, 10, 30, 'noreply@carrier-1.example', 'Транспортная компания (пример)', 'Груз прибыл на терминал в Чите', 'Ваш груз прибыл на терминал в Чите. Перевалка и дальнейшая отправка — по графику перевозчика.'],
    ['purchase', 5, 14, 0, 'manager@akb-2.example', 'Поставщик-пример 2', 'Вопрос по комплектации', `Уточните, пожалуйста, нужна ли отдельная упаковка для ${akb[0].name}?`],
    ['purchase', 4, 12, 0, 'hello@ctrl-5.example', 'Поставщик-пример 5', `Наличие: ${short(ctl[0])}`, `Позиция ${ctl[0].name} есть на складе поставщика. Резерв держим до конца недели.`],
    ['purchase', 4, 17, 10, 'docs@kabel-4.example', 'Поставщик-пример 4', 'Счёт-фактура по отгрузке', 'Направляем счёт-фактуру по последней отгрузке. Оригинал придёт вместе с грузом.'],
    ['purchase', 3, 15, 45, 'buh@kabel-4.example', 'Бухгалтерия, поставщик-пример 4', 'Акт сверки за октябрь', 'Просим подписать акт сверки взаиморасчётов за октябрь и вернуть скан.'],
    ['purchase', 2, 10, 0, 'info@panel-3.example', 'Поставщик-пример 3', `Счёт и отгрузка: ${short(pan[0])}`, `Выставили счёт на ${pan[0].name}, 30 шт. Машина выйдет сразу после оплаты.`],
    ['purchase', 2, 13, 20, 'office@panel-3.example', 'Поставщик-пример 3', 'Срок поставки сдвигается', `Срок поставки по ${pan[1].name} сдвигается на три дня: задержка на заводе.`],
    ['purchase', 1, 14, 5, 'sales@akb-2.example', 'Поставщик-пример 2', `Подтверждение заказа: ${short(akb[0])}`, `Подтверждаем заказ: ${akb[0].name}, 12 шт. Готовность — в течение пяти дней.`],
    ['purchase', 1, 16, 30, 'logistics@akb-2.example', 'Логистика, поставщик-пример 2', 'Трек-номер для отслеживания', 'Груз отправлен. Трек-номер: ТРЕК-ПРИМЕР-001 (демо). Отслеживать можно на сайте перевозчика.'],
    ['purchase', 0, 9, 40, 'sales@invertor-1.example', 'Поставщик-пример 1', `Счёт на ${short(inv[0])}`, `Выставили счёт на ${inv[0].name}, 10 шт. Просим оплатить в течение трёх банковских дней.`],
    ['purchase', 0, 11, 15, 'manager@invertor-1.example', 'Поставщик-пример 1', `Отгрузка заказа: ${short(inv[1])}`, `Заказ отгружен: ${inv[1].name}, 5 шт. Трек-номер: ТРЕК-ПРИМЕР-002 (демо).`],
    // ——— Клиенты ———
    ['clients', 12, 12, 25, 'client11@clients.example', 'Клиент-пример 11', `Заявка с сайта: ${short(ctl[0])}`, `Здравствуйте! Интересует ${ctl[0].name}. Есть ли в наличии и сколько стоит доставка?`],
    ['clients', 8, 10, 50, 'client10@clients.example', 'Клиент-пример 10', 'Не пришло уведомление о доставке', 'Здравствуйте! Заказ должен был прийти, но уведомления о доставке нет. Подскажите, где он сейчас?'],
    ['clients', 5, 9, 20, 'client8@clients.example', 'Клиент-пример 8', 'Когда монтаж?', 'Здравствуйте! Оплату провели на прошлой неделе. Когда приедет бригада на монтаж?'],
    ['clients', 4, 16, 45, 'client7@clients.example', 'Клиент-пример 7', `Гарантия на ${short(pan[1])}`, `Подскажите, какая гарантия на ${pan[1].name} и как обращаться по гарантии?`],
    ['clients', 3, 10, 10, 'client1@clients.example', 'Клиент-пример 1', `Re: Срок поставки ${short(inv[0])}`, `Добрый день! Напоминаю про вопрос: когда сможете поставить ${inv[0].name}? Нужно 2 штуки.`],
    ['clients', 3, 14, 30, 'client6@clients.example', 'Клиент-пример 6', 'Самовывоз со склада', 'Когда можно забрать заказ со склада? Адрес склада подскажите, пожалуйста.'],
    ['clients', 2, 11, 40, 'client5@clients.example', 'Клиент-пример 5', `Вопрос по аккумулятору ${short(akb[0])}`, `Подойдёт ли ${akb[0].name} к инвертору ${inv[1].name}?`],
    ['clients', 1, 9, 30, 'client3@clients.example', 'Клиент-пример 3', `Коммерческое предложение на ${short(pan[0])}`, `Добрый день! Пришлите, пожалуйста, коммерческое предложение на ${pan[0].name}, 30 шт.`],
    ['clients', 1, 15, 10, 'client4@clients.example', 'Клиент-пример 4', 'Оплата заказа', 'Оплату провели сегодня, подтвердите, пожалуйста, что получили.'],
    ['clients', 0, 10, 20, 'client1@clients.example', 'Клиент-пример 1', `Срок поставки ${short(inv[0])}`, `Здравствуйте! Подскажите, когда сможете поставить ${inv[0].name}? Нужно 2 штуки.`],
    ['clients', 0, 12, 50, 'client12@clients.example', 'Клиент-пример 12', 'Нужен расчёт станции для дома', 'Здравствуйте! Хотим солнечную станцию для загородного дома. Подскажите, с чего начать и что вам нужно от нас.'],
  ];
  rows.forEach(([boxId, back, h, m, from, fromName, subject, body], i) => {
    const l = { id: 'ml' + (i + 1), boxId, from, fromName, subject, body, at: at(back, h, m), read: back >= 3, folder: Mail.INBOX, demo: true };
    l.folder = Mail.folderOf(st, l);
    st.mail.letters.push(l);
  });
  // в одной ветке есть ответ-имитация: так видно, как выглядит пометка (отвечает менеджер B2C из демо-команды)
  const paid = st.mail.letters.find(l => l.boxId === 'clients' && l.subject === 'Оплата заказа');
  const r = Mail.reply(st, paid.id, 'Спасибо, оплату видим. Заказ передан в отгрузку, о сроках напишем отдельно.', 'p2', at(1, 16, 0));
  if (r) r.demo = true;
});
