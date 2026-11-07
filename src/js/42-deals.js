// Ядро: сделки. Завести, править, двигать по воронке, закрыть («Успешно» или «Провалена» с причиной), строки
// товаров с ценой и скидкой, резерв строки со склада, колонки канбана. Сумму считает одна функция — total.
// Права — Perms, видимость сделок — Leads.dealsVisible, остатки и резервы — Stock, события — Feed, клиенты — Clients.
// Чистые функции над состоянием st; время приходит параметром now (Date), кто делает — by (id сотрудника).
// Каждое изменение пишет запись в ленту сделки. Экраны — 56-deals.js (канбан, карточка, КП).
// Стадии «Успешно»: сделка на этапе с флагом final, wonAt. «Провалена»: lostReason и lostAt, этап остаётся тем, где сорвалась.

const Deals = (() => {
  // Причины отказа по умолчанию; общие для лидов и сделок, правятся в «Настройки → Лиды и сделки» (st.lostReasons).
  const defaultReasons = () => ['Дорого', 'Выбрали другого', 'Не дозвонились', 'Передумали', 'Другое']
    .map((name, i) => ({ id: 'lr' + (i + 1), name }));

  const str = v => String(v == null ? '' : v).trim();
  const toNum = v => (v === null || v === undefined || str(v) === '' ? NaN : Number(str(v).replace(/\s/g, '').replace(',', '.')));
  const round2 = x => Math.round(x * 100) / 100;
  const personOf = (st, id) => (st.people || []).find(p => p.id === id) || null;
  const byId = (st, id) => (st.deals || []).find(d => d.id === id) || null;
  const productOf = (st, id) => (st.products || []).find(p => p.id === id) || null;
  const fail = (reason, extra) => Object.assign({ ok: false, reason }, extra);

  const reasons = st => (st.lostReasons || defaultReasons()).map(r => r.name);

  // ——— сумма: единственный расчёт ———
  // Строка: количество × цена × (1 − скидка/100), до копейки. Цены нет (price: null) — строка в сумму не входит:
  // это «нет данных: цена», не ноль; сколько таких строк — noPrice.
  const hasPrice = it => typeof it.price === 'number' && isFinite(it.price);
  const lineSum = it => (hasPrice(it) ? round2(it.qty * it.price * (100 - (it.disc || 0)) / 100) : 0);
  // Сумма сделки: есть строки — сумма строк; нет — вписанная amount.
  function total(deal) {
    const items = (deal && deal.items) || [];
    if (items.length) return round2(items.reduce((s, it) => s + lineSum(it), 0));
    const a = Number(deal && deal.amount);
    return isFinite(a) && a > 0 ? a : 0;
  }
  // Сумма по списку сделок — единственная: колонка доски, шапка «Сделок» и плитка главного экрана зовут её.
  const sumOf = deals => round2((deals || []).reduce((s, d) => s + total(d), 0));
  const noPrice = deal => ((deal && deal.items) || []).map((it, i) => (hasPrice(it) ? -1 : i)).filter(i => i >= 0);

  // ——— состояние ———
  const lostOf = d => !!(d && d.lostReason);
  // 'lost' — провалена; 'won' — на этапе «Успешно» (флаг final); иначе 'open'.
  const state = (st, d) => (lostOf(d) ? 'lost' : Pipes.isFinal(st, d.pipeId, d.stageId) ? 'won' : 'open');

  // ——— права ———
  // Видеть сделки — право clients (и Leads.dealsVisible); заводить, править, двигать по этапам, закрывать, резервировать — dealsEdit.
  // У инженеров по умолчанию только просмотр (R30).
  const canMake = (st, by) => !!personOf(st, by) && Perms.can(st, by, 'dealsEdit');
  const canEdit = (st, d, by) => !!d && canMake(st, by) && Leads.dealsVisible(st, by).includes(d);
  // Сделка, с которой человек может работать, или отказ.
  function open(st, id, by) {
    const d = byId(st, id);
    if (!d) return { err: fail('Такой сделки нет.') };
    if (!canEdit(st, d, by)) return { err: fail('У вас нет права править эту сделку.') };
    return { d };
  }

  const log = (st, d, kind, text, by, at, data) => Feed.add(st, { t: 'deal', id: d.id }, { kind, text, by, at, data });
  const stageName = (st, d, id) => (Pipes.stage(st, d.pipeId, id) || {}).name || 'нет данных: этап';

  // ——— строки товаров ———
  const itemName = (st, it) => (it.productId ? (productOf(st, it.productId) || {}).name || 'нет данных: товар' : it.text);
  // Строка с артикулом — для текста без разметки (лента, уведомления): «Название (арт. X)»; своя строка — как есть
  const itemLabel = (st, it) => (it.productId ? Catalog.label(productOf(st, it.productId)) : it.text);
  const priceText = it => (hasPrice(it) ? rub(it.price) : 'нет данных: цена');

  // Строка из введённого: товар из каталога (productId) или своя (text), количество, цена (по умолчанию цена сайта, а нет её —
  // null), скидка %. → {item} или {reason}.
  function cleanItem(st, raw) {
    const r = raw || {}, it = {};
    let prod = null;
    if (r.productId) {
      prod = productOf(st, r.productId);
      if (!prod) return { reason: 'Такого товара нет в каталоге.' };
      it.productId = prod.id;
    } else {
      if (!str(r.text)) return { reason: 'Выберите товар из каталога или напишите название своей строки.' };
      it.text = str(r.text);
    }
    const qty = r.qty === undefined ? 1 : toNum(r.qty);
    if (!(qty > 0) || !isFinite(qty)) return { reason: 'Количество — число больше нуля.' };
    it.qty = qty;
    if ('price' in r && r.price !== undefined) {
      const p = toNum(r.price);
      if (r.price !== null && str(r.price) !== '' && !(p >= 0 && isFinite(p))) return { reason: 'Цена — число не меньше нуля.' };
      it.price = isNaN(p) ? null : p;
    } else it.price = prod && typeof prod.price === 'number' ? prod.price : null;
    const disc = r.disc === undefined || str(r.disc) === '' ? 0 : toNum(r.disc);
    if (!(disc >= 0 && disc <= 100)) return { reason: 'Скидка — число от 0 до 100 %.' };
    it.disc = disc;
    return { item: it };
  }

  const itemLine = (st, it) => `${itemLabel(st, it)} — ${num(it.qty)} × ${priceText(it)}${it.disc ? ', скидка ' + num(it.disc) + ' %' : ''}`;

  // Сколько по сделке зарезервировано этого товара (все резервы сделки по нему).
  const reserved = (st, d, productId) => (st.reserves || []).filter(r => r.dealId === d.id && r.productId === productId).reduce((s, r) => s + r.qty, 0);
  // Сколько этого товара в строках сделки — сумма количеств всех строк с ним. Резерв по товару не бывает больше этой суммы:
  // резерв считается по товару, а не по строке, поэтому «можно ещё» = lined − reserved.
  const lined = (d, productId) => round2((d.items || []).filter(x => x.productId === productId).reduce((s, x) => s + x.qty, 0));
  // Проверка перед правкой или удалением строки: after — сколько товара останется в строках сделки. Резерв по нему больше —
  // текст отказа (what: 'remove' — удаление, иначе правка количества), иначе null. Один текст на правку и на удаление.
  const reserveBlock = (st, d, productId, after, what) => {
    const held = reserved(st, d, productId);
    if (!(held > after)) return null;
    const p = productOf(st, productId), name = Catalog.label(p), rows = (d.items || []).filter(x => x.productId === productId).length;
    return what === 'remove'
      ? `По товару «${name}» в резерве ${qtyOf(held, p)}, а после удаления в строках останется ${qtyOf(after, p)} — сначала снимите резерв.`
      : `По товару «${name}» в резерве ${qtyOf(held, p)} — сначала снимите резерв или оставьте не меньше ${num(held)}${rows > 1 ? ' в сумме по строкам этого товара' : ''}.`;
  };

  // ——— заведение ———
  const MISSING = { client: 'клиент', type: 'тип сделки' };

  // Новая сделка: {clientId, type, managerId?, contact?, phone?, email?, kind?, object?, channel?, items?, amount?, leadId?, demo?}.
  // Без клиента (существующего) или типа — {ok:false, missing:[…]}. Воронка — своего типа, этап — первый.
  // Менеджер: названный; иначе я, если я менеджер (у роли есть тип); иначе менеджер клиента.
  // → {ok, id, missing, reason}
  function create(st, data, by, now) {
    const d0 = data || {};
    if (!canMake(st, by)) return fail('У вашей роли нет права заводить сделки.', { id: null, missing: [] });
    const client = Clients.byId(st, d0.clientId), type = Leads.TYPE[d0.type] ? d0.type : null;
    const missing = [];
    if (!client) missing.push('client');
    if (!type) missing.push('type');
    if (missing.length) return fail(`Не заполнено: ${missing.map(k => MISSING[k]).join(', ')}.`, { id: null, missing });
    const pipe = dealPipe(type, st);
    if (!pipe) return fail('Нет воронки сделок этого типа.', { id: null, missing: [] });
    const items = [];
    for (const raw of d0.items || []) {
      const c = cleanItem(st, raw);
      if (c.reason) return fail(c.reason, { id: null, missing: [] });
      items.push(c.item);
    }
    const role = Perms.roleOf(st, by);
    const managerId = d0.managerId && personOf(st, d0.managerId) ? d0.managerId : (role && role.scope ? by : client.managerId || null);
    const amount = toNum(d0.amount);
    st.deals = st.deals || [];
    const d = {
      id: Leads.nextId(st.deals, 'Д', 300), clientId: client.id, client: client.name,
      contact: str(d0.contact) || (client.kind === 'person' ? client.name : 'нет данных: контакт'),
      kind: str(d0.kind) || (type === 'b2b' ? 'Компания' : 'Частный клиент'),
      object: str(d0.object) || 'нет данных: что продаём',
      type, pipeId: pipe.id, stageId: Leads.firstOf(pipe).id, managerId,
      channel: Object.hasOwn(CH, d0.channel) ? d0.channel : 'phone',
      amount: amount >= 0 && isFinite(amount) ? amount : 0,
      phone: str(d0.phone) || (client.phones || [])[0] || '', email: str(d0.email) || client.email || '',
      items, at: now, demo: !!d0.demo,
    };
    if (d0.leadId) d.leadId = d0.leadId;
    st.deals.push(d);
    log(st, d, 'create', d0.leadId ? `Сделка создана из лида ${d0.leadId}` : 'Сделка создана', by, now);
    return { ok: true, id: d.id, missing: [], reason: '' };
  }

  // ——— правка полей ———
  const LABEL = { clientId: 'Клиент', contact: 'Контакт', phone: 'Телефон', email: 'Почта', kind: 'Вид клиента', object: 'Что продаём',
    type: 'Тип', managerId: 'Менеджер', channel: 'Связь', amount: 'Сумма' };

  // Правка сделки: patch — любые из clientId, contact, phone, email, kind, object, type, managerId, channel, amount.
  // Сумму руками вписать нельзя, если в сделке есть строки товаров: она считается по строкам. Смена типа переводит сделку
  // в воронку нового типа (тот же этап, если он там есть). Всё проверяется до правки: либо всё, либо ничего.
  // → {ok, changed:[поле…], reason}
  function update(st, id, patch, by, now) {
    const { d, err } = open(st, id, by);
    if (err) return Object.assign(err, { changed: [] });
    const p = patch || {}, next = {};
    for (const f of Object.keys(LABEL)) {
      if (!(f in p)) continue;
      let v = p[f];
      if (f === 'clientId') {
        if (!Clients.byId(st, v)) return fail('Такого клиента нет.', { changed: [] });
      } else if (f === 'type') {
        if (!Leads.TYPE[v]) return fail('Тип сделки — B2B или B2C.', { changed: [] });
      } else if (f === 'managerId') {
        v = v || null;
        if (v && !personOf(st, v)) return fail('Такого сотрудника нет.', { changed: [] });
      } else if (f === 'channel') {
        if (!Object.hasOwn(CH, v)) return fail('Такого способа связи нет.', { changed: [] });
      } else if (f === 'amount') {
        if ((d.items || []).length) return fail('В сделке есть строки товаров — сумма считается по ним, вписать её руками нельзя.', { changed: [] });
        v = toNum(v);
        if (!(v >= 0) || !isFinite(v)) return fail('Сумма — число не меньше нуля.', { changed: [] });
      } else v = str(v);
      if (v !== (d[f] == null ? (f === 'managerId' ? null : '') : d[f])) next[f] = v;
    }
    const changed = Object.keys(next);
    if (!changed.length) return { ok: true, changed, reason: '' };
    const shown = (f, v) => {
      if (f === 'managerId') return (personOf(st, v) || {}).name || 'нет данных';
      if (f === 'channel') return CH[v] || 'нет данных';
      if (f === 'type') return Leads.TYPE[v] || 'нет данных';
      if (f === 'clientId') return (Clients.byId(st, v) || {}).name || 'нет данных';
      if (f === 'amount') return v ? rub(v) : 'не рассчитана';
      return str(v) || 'нет данных';
    };
    const lines = changed.map(f => `${LABEL[f]}: ${shown(f, d[f])} → ${shown(f, next[f])}`);
    const data = changed.map(f => ({ field: f, from: d[f] == null ? null : d[f], to: next[f] }));
    for (const f of changed) d[f] = next[f];
    if (next.clientId) d.client = Clients.byId(st, d.clientId).name;
    if (next.type) {
      const pipe = dealPipe(d.type, st);
      if (pipe) { d.pipeId = pipe.id; if (!Pipes.stage(st, pipe.id, d.stageId)) d.stageId = Leads.firstOf(pipe).id; }
    }
    log(st, d, 'field', lines.join('; '), by, now, { changes: data });
    return { ok: true, changed, reason: '' };
  }

  // ——— этапы ———
  // Двигает по воронке: на любой этап, кроме той же точки; на этап с флагом final — это «Успешно» (win).
  // Проваленную сделку не двигают, пока не вернут в работу (reopen). → {ok, reason}
  function move(st, id, stageId, by, now) {
    const { d, err } = open(st, id, by);
    if (err) return err;
    if (lostOf(d)) return fail('Сделка провалена — сначала верните её в работу.');
    const to = Pipes.stage(st, d.pipeId, stageId);
    if (!to) return fail('Такого этапа нет в воронке сделки.');
    if (to.id === d.stageId) return fail('Сделка уже на этом этапе.');
    if (to.flag === 'final') return win(st, id, by, now);
    const from = Pipes.stage(st, d.pipeId, d.stageId);
    d.stageId = to.id;
    delete d.wonAt;
    log(st, d, 'stage', `Этап: «${from ? from.name : 'нет данных: этап'}» → «${to.name}»`, by, now, { from: from ? from.id : null, to: to.id });
    return { ok: true, reason: '' };
  }

  // «Успешно»: сделка переходит на этап с флагом final, запоминается wonAt. Проваленная и уже успешная — отказ.
  function win(st, id, by, now) {
    const { d, err } = open(st, id, by);
    if (err) return err;
    if (lostOf(d)) return fail('Сделка провалена — сначала верните её в работу.');
    const pipe = (st.pipelines || []).find(p => p.id === d.pipeId), fin = pipe && pipe.stages.find(s => s.flag === 'final');
    if (!fin) return fail('В воронке нет этапа «Успешно».');
    if (d.stageId === fin.id) return fail('Сделка уже успешно закрыта.');
    const from = stageName(st, d, d.stageId);
    d.stageId = fin.id;
    d.wonAt = now;
    log(st, d, 'win', `Успешно: сделка закрыта («${from}» → «${fin.name}»)`, by, now);
    return { ok: true, reason: '' };
  }

  // «Провалена» с причиной: без причины — отказ. Этап остаётся, где сделка сорвалась. Успешно закрытую не проваливают.
  function lose(st, id, reason, by, now) {
    const why = str(reason);
    if (!why) return fail('Укажите причину отказа.');
    const { d, err } = open(st, id, by);
    if (err) return err;
    if (lostOf(d)) return fail('Сделка уже провалена.');
    if (state(st, d) === 'won') return fail('Сделка успешно закрыта — провалить её нельзя, сначала верните на другой этап.');
    // Решение директора: у проваленной сделки резервы снимаются, товар возвращается в свободный остаток. Тем же путём,
    // что и ручное снятие (drop), но право reserve не нужно: провалить сделку может и тот, у кого его нет.
    const held = reservesOf(st, d);
    d.lostReason = why;
    d.lostAt = now;
    log(st, d, 'lose', `Провалена: ${why}`, by, now, { reason: why, released: held.length });
    for (const r of held) drop(st, r, 'Сделка провалена.', by, now);
    if (held.length) d.lostReleased = held.length;
    return { ok: true, reason: '', released: held.length };
  }

  // Что сказать при возврате в работу, если при провале резервы были сняты: вернуть их ядро не возвращает.
  const RELEASED_NOTE = 'Резервы при провале были сняты, поставьте заново при необходимости.';

  // Вернуть проваленную сделку в работу (ошибка при отказе): причина снимается, этап прежний.
  function reopen(st, id, by, now) {
    const { d, err } = open(st, id, by);
    if (err) return err;
    if (!lostOf(d)) return fail('Сделка не провалена.');
    const was = d.lostReason, freed = d.lostReleased > 0;
    delete d.lostReason;
    delete d.lostAt;
    delete d.lostReleased;
    log(st, d, 'stage', `Возвращена в работу (была провалена: ${was}).${freed ? ' ' + RELEASED_NOTE : ''}`, by, now);
    return { ok: true, reason: '', released: freed };
  }

  // ——— строки товаров ———
  // Добавить строку: {productId | text, qty?, price?, disc?}. → {ok, idx, reason}
  function addItem(st, id, raw, by, now) {
    const { d, err } = open(st, id, by);
    if (err) return err;
    const c = cleanItem(st, raw);
    if (c.reason) return fail(c.reason);
    d.items = d.items || [];
    d.items.push(c.item);
    log(st, d, 'item', `Добавлена строка: ${itemLine(st, c.item)}`, by, now, { idx: d.items.length - 1 });
    return { ok: true, idx: d.items.length - 1, reason: '' };
  }

  const ITEM_LABEL = { text: 'Название', qty: 'Количество', price: 'Цена', disc: 'Скидка' };
  // Правка строки idx: patch — qty, price (null или пусто — «нет данных: цена»), disc, а у своей строки ещё text.
  function setItem(st, id, idx, patch, by, now) {
    const { d, err } = open(st, id, by);
    if (err) return err;
    const it = (d.items || [])[idx];
    if (!it) return fail('Такой строки нет.');
    const p = patch || {}, raw = { qty: it.qty, price: it.price, disc: it.disc };
    if (it.productId) raw.productId = it.productId; else raw.text = 'text' in p ? p.text : it.text;
    for (const f of ['qty', 'price', 'disc']) if (f in p) raw[f] = p[f];
    const c = cleanItem(st, raw);
    if (c.reason) return fail(c.reason);
    // Количество уменьшают: резерв по товару не должен оказаться больше суммы строк (правка цены и скидки резерва не касается).
    if (it.productId && c.item.qty < it.qty) {
      const why = reserveBlock(st, d, it.productId, round2(lined(d, it.productId) - it.qty + c.item.qty), 'set');
      if (why) return fail(why);
    }
    const lines = [];
    for (const f of ['text', 'qty', 'price', 'disc']) {
      if (it.productId && f === 'text') continue;
      if (c.item[f] !== it[f]) lines.push(`${ITEM_LABEL[f]}: ${f === 'price' ? priceText(it) : it[f]} → ${f === 'price' ? priceText(c.item) : c.item[f]}`);
    }
    if (!lines.length) return { ok: true, reason: '' };
    const name = itemLabel(st, it);
    Object.assign(it, c.item);
    log(st, d, 'item', `Строка «${name}»: ${lines.join('; ')}`, by, now, { idx });
    return { ok: true, reason: '' };
  }

  // Убрать строку. Если в оставшихся строках товара станет меньше, чем в резерве сделки, убрать нельзя: сначала снять резерв.
  // → {ok, reason}
  function removeItem(st, id, idx, by, now) {
    const { d, err } = open(st, id, by);
    if (err) return err;
    const it = (d.items || [])[idx];
    if (!it) return fail('Такой строки нет.');
    if (it.productId) {
      const why = reserveBlock(st, d, it.productId, round2(lined(d, it.productId) - it.qty), 'remove');
      if (why) return fail(why);
    }
    d.items.splice(idx, 1);
    log(st, d, 'item', `Убрана строка: ${itemLine(st, it)}`, by, now);
    return { ok: true, reason: '' };
  }

  // ——— резервы сделки ———
  // Уведомление о резерве: постоянные адресаты вида reserve (Notify.RECIPIENTS — склад и директор) и менеджер этой сделки.
  // Менеджеры другого типа его не получают: чужую сделку они не видят.
  const managerOf = d => (d && d.managerId ? [d.managerId] : []);
  // Уведомление о резерве сделки d: адресаты те же (Notify.RECIPIENTS и менеджер сделки), но номер сделки и клиента читают
  // только те, кому сделка видна (Stock.dealRef); остальным (склад) уходит текст без них. textOf(withDeal) → текст.
  const notifyReserve = (st, d, by, now, textOf) => Notify.pushFor(st, 'reserve', by, id => textOf(!!Stock.dealRef(st, d.id, id)), now, managerOf(d), { t: 'deal', id: d.id });
  // Сколько товара сделки ещё можно зарезервировать: «в строках − уже в резерве». Единственный расчёт: ядро и экран зовут его.
  const left = (st, d, productId) => round2(lined(d, productId) - reserved(st, d, productId));
  // Все резервы сделки (со склада и из поставки). Провал сделки снимает именно их; окно «Провалена» говорит, сколько их.
  const reservesOf = (st, d) => (st.reserves || []).filter(r => r.dealId === d.id);

  // Один путь резерва под сделку — из строки сделки (reserveItem) и из карточки товара.
  // o: {productId, qty?, src? ('stock' | id поставки), entityId?, cityId?, until?}. Нужно право править сделку (canEdit) и право
  // reserve; товар должен быть в строках сделки; не больше «в строках − уже в резерве» (left) и не больше свободного
  // (Stock.canReserve, его причина — наша). Количество по умолчанию — вся нерезервированная часть. Юрлицо и город не названы —
  // клетка, где свободного больше всего. Срок по умолчанию — Stock.RESERVE_DAYS дней от now. Запись в ленту сделки, уведомление — складу,
  // директору и менеджеру сделки. → {ok, reserve, reason, max}
  function reserve(st, id, opt, by, now) {
    const { d, err } = open(st, id, by);
    if (err) return err;
    if (!Perms.can(st, by, 'reserve')) return fail('У вашей роли нет права ставить резервы.');
    const o = opt || {}, pid = o.productId, p = productOf(st, pid);
    if (!p) return fail('Такого товара нет в каталоге.');
    const rows = (d.items || []).filter(x => x.productId === pid).length;
    if (!rows) return fail(`В сделке ${d.id} нет строки с товаром «${Catalog.label(p)}»: сначала добавьте его в сделку, потом ставьте резерв.`, { max: 0 });
    // Предел — по товару, а не по строке: две строки одного товара (10 и 5) дают 15, а не 10.
    const all = lined(d, pid), held = reserved(st, d, pid), rest = left(st, d, pid);
    if (!(rest > 0)) return fail(`Строка «${Catalog.label(p)}» уже зарезервирована целиком (${num(held)}).`, { max: 0 });
    const qty = o.qty === undefined || str(o.qty) === '' ? rest : toNum(o.qty);
    if (qty > rest) return fail(`${rows > 1 ? `В ${rows} строках этого товара ${num(all)}` : `В строке ${num(all)}`}, уже зарезервировано ${num(held)}: можно ещё ${num(rest)}.`, { max: rest });
    const src = o.src || 'stock';
    const cell = src !== 'stock' || (o.entityId === undefined && o.cityId === undefined) ? Stock.bestCell(st, pid) : { entityId: o.entityId, cityId: o.cityId };
    const until = o.until || new Date(new Date(now).getTime() + Stock.RESERVE_DAYS * 864e5);
    const ask = { productId: pid, qty, entityId: cell.entityId, cityId: cell.cityId, src };
    const chk = Stock.canReserve(st, ask);
    if (!chk.ok) return fail(chk.reason, { max: chk.max });
    const res = Stock.reserve(st, Object.assign(ask, { dealId: d.id, until, by, at: now }));
    if (!res.ok) return fail(res.reason, { max: res.max });
    res.reserve.at = now;
    res.reserve.by = by;
    log(st, d, 'reserve', Feed.reserveText(st, res.reserve), by, now, { reserveId: res.reserve.id, productId: pid, qty });
    notifyReserve(st, d, by, now, withDeal => Feed.reserveText(st, res.reserve, withDeal));
    return { ok: true, reserve: res.reserve, reason: '', max: res.max };
  }

  // Зарезервировать строку idx со склада под эту сделку: {entityId, cityId, qty?, until?} — тот же reserve по товару строки.
  function reserveItem(st, id, idx, opt, by, now) {
    const { d, err } = open(st, id, by);
    if (err) return err;
    if (!Perms.can(st, by, 'reserve')) return fail('У вашей роли нет права ставить резервы.');
    const it = (d.items || [])[idx];
    if (!it) return fail('Такой строки нет.');
    if (!it.productId) return fail('Своя строка: такого товара нет в каталоге, резервировать нечего.');
    return reserve(st, id, Object.assign({}, opt, { productId: it.productId, src: 'stock' }), by, now);
  }

  // Лента сделки помнит резерв. Пока у резерва нет своей записи в ленте, её подмешивает сам резерв (Feed.of) — и снятый
  // резерв пропал бы из ленты бесследно. keepTrail пишет эту запись — с прежним временем и автором — до того, как резерв
  // уменьшат или снимут. Зовут все, кто снимает или списывает резерв: сделка, приёмка, карточка товара, отправка.
  function keepTrail(st, r) {
    const d = r && byId(st, r.dealId);
    if (!d || (st.feed || []).some(e => e.ref.t === 'deal' && e.ref.id === d.id && e.data && e.data.reserveId === r.id)) return;
    const w = Feed.reserveWhen(st, r);
    log(st, d, 'reserve', Feed.reserveText(st, r), w.by, w.at, { reserveId: r.id, productId: r.productId, qty: r.qty });
  }
  // Из резерва r снято q (целиком или частью): запись «Снят резерв» в ленте сделки с причиной why и уведомление складу,
  // директору и менеджеру сделки. Зовётся до того, как резерв изменён. Один текст на снятие из сделки, из карточки товара
  // и при приёмке.
  function noteRelease(st, r, q, why, by, now) {
    const d = r && byId(st, r.dealId);
    if (!d) return;
    keepTrail(st, r);
    const name = low(Catalog.label(productOf(st, r.productId))), tail = why ? ' ' + why : '';
    log(st, d, 'reserve', `Снят резерв: ${name} — ${num(q)}${why ? '.' + tail : ''}`, by, now, { reserveId: r.id, productId: r.productId, qty: q, removed: true });
    notifyReserve(st, d, by, now, withDeal => `Снят резерв: ${name} — ${num(q)}${withDeal ? ` (${d.id}, ${d.client})` : ''}.${tail}`);
  }

  // Снять резерв сделки: товар возвращается в свободный остаток. Нужно право править сделку и право reserve. → {ok, reason}
  function unreserve(st, id, reserveId, by, now) {
    const { d, err } = open(st, id, by);
    if (err) return err;
    if (!Perms.can(st, by, 'reserve')) return fail('У вашей роли нет права снимать резервы.');
    const r = (st.reserves || []).find(x => x.id === reserveId && x.dealId === d.id);
    if (!r) return fail('Такого резерва в сделке нет.');
    const res = drop(st, r, '', by, now);
    if (!res.ok) return fail(res.reason);
    return { ok: true, reason: '' };
  }
  // Один путь снятия резерва целиком: запись «Снят резерв» в ленту, уведомление, возврат в свободный остаток.
  // Зовут ручное снятие (unreserve) и провал сделки (lose).
  function drop(st, r, why, by, now) {
    noteRelease(st, r, r.qty, why, by, now);
    return Stock.unreserve(st, r.id, by, now);
  }

  // ——— выборка и колонки канбана ———
  // Сделки, которые человек видит (Leads.dealsVisible), по условиям filter: pipeId, type, q (поиск по клиенту, контакту, номеру,
  // телефону, почте, объекту), mine (мои), managerId, lost (true — вместе с проваленными, 'only' — только они),
  // acts ('none' — без открытых дел, 'overdue' — дела просрочены на момент now).
  // Нет personId — все сделки. Один отбор на канбан и таблицу.
  function query(st, filter, personId) {
    const f = filter || {}, words = Catalog.norm(f.q).split(' ').filter(Boolean);
    return (personId ? Leads.dealsVisible(st, personId) : (st.deals || [])).filter(d =>
      (!f.pipeId || d.pipeId === f.pipeId) && (!f.type || d.type === f.type)
      && (!f.mine || d.managerId === personId) && (!f.managerId || d.managerId === f.managerId)
      && (f.lost === 'only' ? lostOf(d) : f.lost ? true : !lostOf(d))
      && (!f.acts || Acts.matches(st, { t: 'deal', id: d.id }, f.acts, f.now))
      && (!words.length || words.every(w => Catalog.norm([d.id, d.client, d.contact, d.phone, d.email, d.object].join(' ')).includes(w))));
  }

  // Колонки канбана воронки pipeId: [{stage, count, sum, deals}] по порядку этапов. sum — сумма total сделок колонки.
  // Только видимые человеку сделки; проваленные в колонки не входят (filter.lost — включить).
  function columns(st, pipeId, filter, personId) {
    const pipe = (st.pipelines || []).find(p => p.id === pipeId);
    if (!pipe) return [];
    const deals = query(st, Object.assign({}, filter, { pipeId }), personId);
    return pipe.stages.map(stage => {
      const ds = deals.filter(d => d.stageId === stage.id);
      return { stage, count: ds.length, sum: sumOf(ds), deals: ds };
    });
  }

  return {
    defaultReasons, reasons, lineSum, total, sumOf, noPrice, state, canEdit, itemName, itemLabel, reserved, lined, left, reservesOf, byId,
    create, update, move, win, lose, reopen, RELEASED_NOTE, addItem, setItem, removeItem, reserve, reserveItem, keepTrail, noteRelease, unreserve, query, columns,
  };
})();

// Шаг SEEDS: демо-сделки. Список причин отказа; прежние сделки v2 получают историю (воронка проходится теми же move, что и в работе),
// строки товаров по своим резервам и отметку времени у резервов; к ним добавлено ещё 23 сделки — всего 32 обоих типов на всех
// этапах воронки, четыре из них провалены с причиной. Строки — из настоящего каталога (товар, цена сайта на снимок 31.10.2026);
// где цены сайта у товара нет, в строке «нет данных: цена». Новых резервов шаг не ставит: остатки и свободное прежние.
// Всё помечено «пример» (demo:true и слово в названиях клиентов), телефоны вида +7 900 000-00-NN.
// База: причины отказа по умолчанию; РОП (роль заводит база лидов, 35-leads.js) заводит и правит сделки, как менеджеры.
BASES.push(st => {
  st.lostReasons = Deals.defaultReasons();
  const rop = st.roles.find(r => r.id === 'rop');
  if (rop) rop.perms.dealsEdit = true;
});
SEEDS.push(st => {
  const DAY = 864e5, STAGES = ['request', 'calc', 'offer', 'contract', 'payment', 'delivery', 'install', 'done'];
  const pad = (n, w) => String(n).padStart(w, '0');
  const mgrs = type => Leads.managers(st, type).map(p => p.id);
  const rot = { b2b: 0, b2c: 0 };
  const nextMgr = type => { const m = mgrs(type); return m[rot[type]++ % m.length]; };
  const priced = p => p.inCatalog && typeof p.price === 'number';
  // позиция каталога: по куску названия, а если такой нет — первая с ценой сайта в категории
  const pick = (like, cat) => st.products.find(p => priced(p) && p.name.includes(like)) || st.products.find(p => priced(p) && p.cat === cat);

  // Пройти сделку по воронке до этапа stage теми же move/win: шаг по времени равномерный, последнее событие — до сегодняшней полуночи.
  const walk = (d, stage, ago) => {
    const path = STAGES.slice(1, STAGES.indexOf(stage) + 1);
    const start = day(-ago, 9, 0), step = Math.min(2 * DAY, Math.floor((ago * DAY - 9 * 36e5) / (path.length + 1)));
    d.stageId = STAGES[0];
    path.forEach((s, i) => Deals.move(st, d.id, s, d.managerId, new Date(start.getTime() + (i + 1) * step)));
    return { start, step, end: new Date(start.getTime() + path.length * step) };
  };
  const COMMENTS = ['Пример: клиент просит рассрочку, уточняем условия.', 'Пример: ждём замер кровли, согласовали выезд.', 'Пример: отправили расчёт на почту, клиент думает.',
    'Пример: клиент сравнивает с другим предложением.', 'Пример: договорились созвониться после выходных.', 'Пример: клиент уточнил сроки поставки.'];
  const say = (d, k, at) => Feed.comment(st, { t: 'deal', id: d.id }, COMMENTS[k % COMMENTS.length], d.managerId, at);

  // 1. Прежние сделки v2: история, строки по резервам, отметки резервов
  const OLD = { 'Д-311': 10, 'Д-314': 16, 'Д-318': 9, 'Д-320': 6, 'Д-305': 25, 'Д-322': 2 };
  st.deals.filter(d => OLD[d.id]).forEach((d, k) => {
    const stage = d.stageId, ago = OLD[d.id], start = day(-ago, 9, 0);
    // «Сделка создана» — до движения по воронке
    Feed.add(st, { t: 'deal', id: d.id }, { kind: 'create', text: 'Сделка создана', by: d.managerId, at: start });
    d.at = start;
    d.items = d.items || [];
    const mine = st.reserves.filter(r => r.dealId === d.id);
    for (const pid of [...new Set(mine.map(r => r.productId))]) {
      const qty = mine.filter(r => r.productId === pid).reduce((s, r) => s + r.qty, 0);
      Deals.addItem(st, d.id, { productId: pid, qty }, d.managerId, new Date(start.getTime() + 36e5));
    }
    if (mine.length && ['Д-311', 'Д-305'].includes(d.id)) Deals.addItem(st, d.id, { text: 'Монтаж и пусконаладка (пример)', qty: 1, price: null }, d.managerId, new Date(start.getTime() + 72e5));
    const t = walk(d, stage, ago);
    say(d, k, new Date(start.getTime() + 2 * t.step));
    mine.forEach((r, i) => {
      const w = Feed.reserveWhen(st, r);
      r.at = w.at || new Date(start.getTime() + DAY + (i + 1) * 72e5);
      r.by = w.by || d.managerId;
    });
  });

  // 2. Новые сделки: [тип, этап, дней назад, причина отказа, связь, что продаём, строки, ключ клиента]
  // строка: L([кусок названия, категория], количество, скидка %) или L(['текст своей строки'], количество)
  const PAN = ['DAS Solar WH144PA-550W', 'Панели'], PAN150 = ['DELTA PV TOP 150-32', 'Панели'];
  const INV10 = ['DEYE SUN-10K-SG04LP3', 'Инверторы'], INV12 = ['SUN-12K-SG04LP3-EU (12kW', 'Инверторы'], INV1 = ['ASTERION INV ECO II 1.5', 'Инверторы'];
  const BAT = ['Dyness DL5.0C', 'Аккумуляторы'], BAT2 = ['DEYE SE-F5 (51,2В 100Ач) 5,12 кВтч', 'Аккумуляторы'];
  const CAB = ['PV-1F', 'Защита и соединения'], MC4 = ['Коннектор MC4 AB [универсальный', 'Защита и соединения'], MNT = ['Комплект крепления MAX для четырех панелей', 'Защита и соединения'];
  const WORK = ['Монтаж и пусконаладка (пример)'];
  const L = (spec, qty, disc = 0) => (spec.length === 1 ? { text: spec[0], qty } : { spec, qty, disc });
  const ROWS = [
    ['b2b', 'calc', 6, null, 'phone', 'Сетевая станция 20 кВт на кровлю склада', [L(PAN, 36), L(INV10, 1)], 'a'],
    ['b2b', 'contract', 14, null, 'telegram', 'Станция с накопителем для фермы', [L(PAN, 40, 5), L(INV12, 1), L(BAT, 4), L(CAB, 200), L(MC4, 40)], 'b'],
    ['b2b', 'delivery', 22, null, 'max', 'Резервное питание для котельной', [L(PAN, 24), L(INV10, 1), L(BAT2, 3), L(MNT, 6)], 'c'],
    ['b2b', 'install', 30, null, 'phone', 'Станция на кровлю производственной базы', [L(PAN, 60, 7), L(INV12, 2), L(CAB, 300), L(WORK, 1)], 'd'],
    ['b2b', 'done', 40, null, 'telegram', 'Станция для автомойки', [L(PAN, 18), L(INV10, 1), L(BAT, 2)], 'e'],
    ['b2b', 'done', 34, null, 'phone', 'Освещение и насос на удалённом участке', [L(PAN150, 12), L(INV1, 1)], 'f'],
    ['b2b', 'contract', 12, null, 'telegram', 'Расширение станции: ещё накопители', [L(BAT, 6, 3), L(CAB, 100)], 'b'],
    ['b2b', 'offer', 8, null, 'max', 'Станция для гостевого дома', [L(PAN, 16), L(INV10, 1), L(BAT2, 2)], 'g'],
    ['b2b', 'payment', 18, null, 'phone', 'Станция для лесного участка', [L(PAN, 30, 4), L(INV12, 1), L(MC4, 30)], 'h'],
    ['b2b', 'request', 2, null, 'phone', 'Нужен расчёт по резервному питанию склада', [], 'i'],
    ['b2b', 'offer', 20, 'Дорого', 'telegram', 'Станция для мастерской', [L(PAN, 22), L(INV10, 1)], 'j'],
    ['b2b', 'contract', 26, 'Выбрали другого', 'max', 'Станция для овощехранилища', [L(PAN, 28, 5), L(INV12, 1), L(BAT, 3)], 'k'],
    ['b2c', 'offer', 7, null, 'telegram', 'Станция для дома, 8 кВт', [L(PAN, 14), L(INV10, 1), L(BAT2, 2)], 'l'],
    ['b2c', 'contract', 11, null, 'max', 'Автономная станция для дачи', [L(PAN150, 10), L(INV1, 1), L(BAT2, 1), L(CAB, 60)], 'm'],
    ['b2c', 'payment', 15, null, 'phone', 'Станция для загородного дома с накопителем', [L(PAN, 12), L(INV12, 1), L(BAT, 3), L(WORK, 1)], 'n'],
    ['b2c', 'done', 33, null, 'telegram', 'Станция на крышу гаража', [L(PAN, 8, 3), L(INV1, 1), L(MC4, 16)], 'o'],
    ['b2c', 'done', 28, null, 'max', 'Резервное питание на случай отключений', [L(INV1, 1), L(BAT2, 1)], 'p'],
    ['b2c', 'request', 1, null, 'phone', 'Хочу узнать, что нужно для станции', [], 'q'],
    ['b2c', 'calc', 3, null, 'telegram', 'Станция для бани и участка', [L(PAN150, 6)], 'r'],
    ['b2c', 'payment', 9, null, 'max', 'Станция для дачи с накопителем', [L(PAN, 10), L(INV10, 1), L(BAT, 2)], 's'],
    ['b2c', 'install', 19, null, 'telegram', 'Станция для дома на склоне', [L(PAN, 16, 5), L(INV12, 1), L(BAT2, 3), L(CAB, 120), L(MNT, 4)], 't'],
    ['b2c', 'calc', 10, 'Не дозвонились', 'phone', 'Станция для дачи, расчёт', [L(PAN150, 8)], 'u'],
    ['b2c', 'offer', 16, 'Передумали', 'max', 'Станция для коттеджа', [L(PAN, 18), L(INV10, 1), L(BAT, 2)], 'v'],
  ];
  const clients = {};
  let phoneNo = 40, innNo = 110, n = 25;
  const COMPANY = ['ООО „Пример-Лес“', 'ИП Пример-Ферма', 'КФХ „Пример-Поле“', 'ООО „Пример-Тепло“', 'АО „Пример-Свет“', 'ООО „Пример-Мост“',
    'ООО „Пример-Горы“', 'ИП Пример-Гараж', 'ООО „Пример-Река“', 'ООО „Пример-Север“', 'ООО „Пример-Юг“', 'ООО „Пример-Склон“'];
  ROWS.forEach(([type, stage, ago, lostWhy, channel, object, lines, key], k) => {
    const mgr = nextMgr(type), start = day(-ago, 9, 0);
    if (!clients[key]) {
      const company = type === 'b2b', no = phoneNo++, i = n++;
      const data = { name: company ? COMPANY[(i - 25) % COMPANY.length] : `Клиент-пример ${i}`, kind: company ? 'company' : 'person',
        phone: `+7 900 000-00-${pad(no, 2)}`, managerId: mgr, demo: true };
      if (company) data.inn = `0000000${pad(innNo++, 3)}`;
      if (k % 3 === 0) data.email = `primer${no}@example.com`;
      clients[key] = Clients.create(st, data, null, start).client;
    }
    const made = Deals.create(st, { clientId: clients[key].id, type, managerId: mgr, channel, object, demo: true,
      contact: type === 'b2b' ? `Контакт-пример ${k + 1}` : undefined }, mgr, start);
    const d = Deals.byId(st, made.id);
    for (const ln of lines) {
      const raw = ln.spec ? { productId: pick(...ln.spec).id, qty: ln.qty, disc: ln.disc } : { text: ln.text, qty: ln.qty, price: null };
      Deals.addItem(st, d.id, raw, mgr, new Date(start.getTime() + 36e5));
    }
    const t = walk(d, stage, ago);
    if (k % 2 === 0) say(d, k, new Date(start.getTime() + Math.floor(1.5 * t.step)));
    if (lostWhy) Deals.lose(st, d.id, lostWhy, mgr, new Date(t.end.getTime() + 36e5));
  });
});
