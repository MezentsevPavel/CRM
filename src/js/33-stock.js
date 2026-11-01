// Ядро: остатки, резервы и журнал движений. Чистая логика, без DOM и текущего времени —
// время приходит аргументом. Свободный остаток считает summary() — единственное место формулы.
//
// Данные состояния (схема v3):
//   stock[productId][entityId|'_'][cityId|'_'] = количество; '_' — «нет данных» (в таблице менеджеров города нет);
//   aside[productId] = {damaged, custody, transitNoShip} — «Бой», ответхранение, «В пути» без поставки;
//   reserves[{id, productId, qty, entityId, cityId, src:'stock'|shipId, dealId, until}];
//   moves[{at, productId, kind, qty, entityId, cityId, doc, by}] — новые записи сверху.
// Пустая клетка — null или нет ключа, не ноль: «0» в таблице и «не заполнено» — разные вещи.

const Stock = (() => {
  // «Нет данных»: юрлицо или город в источнике не указаны.
  const ANY = '_';
  // Виды движений — подписи как на экране и в журнале.
  const KINDS = { receive: 'Приход', ship: 'Отгрузка', reserve: 'Резерв', unreserve: 'Снят резерв', transfer: 'Перемещение', damage: 'Списание в бой' };
  const NO_ENTITY = 'нет данных: юрлицо';
  const NO_CITY = 'нет данных: город';

  // Юрлица и города по умолчанию — свежая копия на каждый вызов (для seed()). Адрес склада пуст: «нет данных: адрес».
  function defaults() {
    return {
      entities: [{ id: 'ip', name: 'ИП' }, { id: 'npp', name: 'НПП' }, { id: 'vs', name: 'ВС' }],
      cities: [{ id: 'irk', name: 'Иркутск', address: '' }, { id: 'msk', name: 'Москва', address: '' }, { id: 'krd', name: 'Краснодар', address: '' }],
    };
  }

  const isNum = v => typeof v === 'number' && isFinite(v);
  const sum = (list, f) => list.reduce((a, x) => a + f(x), 0);
  const total = vals => { const n = vals.filter(isNum); return n.length ? sum(n, x => x) : null; };

  // Подпись юрлица или города; неизвестный id (не из справочника) → null.
  const nameIn = (list, id, none) => (id === ANY ? none : (list || []).find(x => x.id === id)?.name ?? null);
  const entityName = (st, id) => nameIn(st.entities, id, NO_ENTITY);
  const cityName = (st, id) => nameIn(st.cities, id, NO_CITY);

  // ——— таблица «юрлицо × город» ———
  // rows — юрлица из справочника, затем '_' (если есть данные без юрлица); cols — то же для городов.
  // cell(e, c) — число или null (пусто). totals: rows[e], cols[c], all — суммы по непустым клеткам, null — если все пусты.
  function grid(st, productId) {
    const data = (st.stock && st.stock[productId]) || {};
    const entKeys = Object.keys(data);
    const cityKeys = [...new Set(entKeys.flatMap(e => Object.keys(data[e] || {})))];
    const order = (known, keys) => {
      const ids = known.map(x => x.id);
      return [...ids, ...keys.filter(k => k !== ANY && !ids.includes(k)), ...(keys.includes(ANY) ? [ANY] : [])];
    };
    const rows = order(st.entities || [], entKeys).map(id => ({ id, name: entityName(st, id) ?? id }));
    const cols = order(st.cities || [], cityKeys).map(id => ({ id, name: cityName(st, id) ?? id }));
    const cell = (e, c) => (data[e] && isNum(data[e][c]) ? data[e][c] : null);
    const totals = {
      rows: Object.fromEntries(rows.map(r => [r.id, total(cols.map(c => cell(r.id, c.id)))])),
      cols: Object.fromEntries(cols.map(c => [c.id, total(rows.map(r => cell(r.id, c.id)))])),
      all: total(rows.flatMap(r => cols.map(c => cell(r.id, c.id)))),
    };
    return { rows, cols, cell, totals };
  }

  // ——— поставки в пути ———
  // Приход, который ещё не лёг на склад: входящая поставка, не принятая на склад (этап без флага final), и перемещение
  // между складами, уже ушедшее из клетки «откуда» (Dispatch.transit — единственное определение «в пути»).
  // По возрастанию ожидаемой даты. У перемещения shipId — номер заявки (ОТ-NNN), плюс dispatchId и клетка-получатель
  // entityId/cityId: это не поставка, под неё резерв не ставится (freeIn даёт 0).
  function incomingOf(st, productId) {
    const ships = (st.shipments || [])
      .filter(s => s.dir === 'in' && !Pipes.isFinal(st, s.pipeId, s.stageId))
      .flatMap(s => (s.items || []).filter(i => i.productId === productId).map(i => ({ shipId: s.id, qty: i.qty, eta: s.eta })));
    const moves = Dispatch.transit(st, productId)
      .map(t => ({ shipId: t.number, dispatchId: t.dispatchId, qty: t.qty, eta: t.eta, entityId: t.entityId, cityId: t.cityId }));
    return [...ships, ...moves].sort((a, b) => a.eta - b.eta);
  }

  // Сколько в поставке ещё не отдано под резервы (для резерва «из поставки»).
  function freeIn(st, shipId, productId) {
    const s = (st.shipments || []).find(x => x.id === shipId);
    const q = s ? sum((s.items || []).filter(i => i.productId === productId), i => i.qty) : 0;
    return q - sum((st.reserves || []).filter(r => r.src === shipId && r.productId === productId), r => r.qty);
  }

  // ——— свободный остаток: единственный расчёт ———
  // onHand — годный остаток на складах по всем юрлицам и городам. «Бой», ответхранение и «В пути» (без поставки)
  // лежат отдельно (damaged, custody, transitNoShip; null — в таблице пусто) и в свободный остаток не входят.
  // free = onHand − резервы со склада.
  // freeAfter = free + incoming (поставки в пути) − reservedIncoming (резервы под эти поставки).
  // known — в таблице остатков по товару есть хоть одно число (иначе остаток «нет данных»).
  // now принимается по договору интерфейса: резервы с истёкшим сроком пока остаются в силе, пока их не сняли.
  function summary(st, productId, now) {
    void now;
    const g = grid(st, productId);
    const a = (st.aside && st.aside[productId]) || {};
    const inc = incomingOf(st, productId);
    const rs = (st.reserves || []).filter(r => r.productId === productId);
    const onHand = g.totals.all ?? 0;
    const reservedStock = sum(rs.filter(r => r.src === 'stock'), r => r.qty);
    const reservedIncoming = sum(rs.filter(r => r.src !== 'stock'), r => r.qty);
    const incoming = sum(inc, x => x.qty);
    const free = onHand - reservedStock;
    return {
      known: g.totals.all !== null,
      onHand,
      damaged: isNum(a.damaged) ? a.damaged : null,
      custody: isNum(a.custody) ? a.custody : null,
      transitNoShip: isNum(a.transitNoShip) ? a.transitNoShip : null,
      incoming, reservedStock, reservedIncoming,
      free,
      freeAfter: free + incoming - reservedIncoming,
      nextEta: inc.length ? inc[0].eta : null,
    };
  }

  // ——— резервы ———
  // Где лежит резерв со склада: юрлицо и город ('_' — не указаны).
  const cellKey = r => (r.entityId || ANY) + '|' + (r.cityId || ANY);

  // Можно ли поставить резерв {productId, qty, entityId, cityId, src}: src — 'stock' (по умолчанию) или id поставки.
  // Со склада: не больше свободного в клетке «юрлицо × город» и не больше свободного по товару в целом.
  // → {ok, max, reason}: max — сколько можно поставить, reason — по-русски, с этим числом.
  function canReserve(st, { productId, qty, entityId, cityId, src } = {}) {
    const source = src || 'stock';
    const e = entityId || ANY, c = cityId || ANY;
    let max = 0, where = '';
    if (source === 'stock') {
      const en = entityName(st, e), cn = cityName(st, c);
      if (en === null) return { ok: false, max: 0, reason: 'Такого юрлица нет в справочнике.' };
      if (cn === null) return { ok: false, max: 0, reason: 'Такого города нет в справочнике.' };
      const have = grid(st, productId).cell(e, c) ?? 0;
      const held = sum((st.reserves || []).filter(r => r.productId === productId && r.src === 'stock' && cellKey(r) === e + '|' + c), r => r.qty);
      max = Math.max(0, Math.min(have - held, summary(st, productId).free));
      where = `Со склада (${en}, ${cn}) свободно только ${max}.`;
    } else {
      const s = (st.shipments || []).find(x => x.id === source);
      if (!s || Pipes.isFinal(st, s.pipeId, s.stageId)) return { ok: false, max: 0, reason: `Поставки ${source} нет среди ожидаемых.` };
      max = Math.max(0, freeIn(st, source, productId));
      where = `В поставке ${source} свободно только ${max}.`;
    }
    const q = Number(qty);
    if (!Number.isInteger(q) || q < 1) return { ok: false, max, reason: 'Укажите количество — целое число больше нуля.' };
    if (q > max) return { ok: false, max, reason: `${where} Уменьшите количество или выберите другой склад.` };
    return { ok: true, max, reason: '' };
  }

  // Клетка склада, откуда лучше всего резервировать: где больше всего свободного. Нет остатка → ('_', '_').
  function bestCell(st, productId) {
    const g = grid(st, productId);
    let best = { entityId: ANY, cityId: ANY }, top = 0;
    for (const r of g.rows) for (const c of g.cols) {
      const held = sum((st.reserves || []).filter(x => x.productId === productId && x.src === 'stock' && cellKey(x) === r.id + '|' + c.id), x => x.qty);
      const free = (g.cell(r.id, c.id) ?? 0) - held;
      if (free > top) { top = free; best = { entityId: r.id, cityId: c.id }; }
    }
    return best;
  }

  // ——— журнал движений ———
  // У каждой записи журнала свой id (mv…): запись — документ общей базы, её не правят и не удаляют.
  function log(st, rec) {
    if (!st.moves) st.moves = [];
    if (!rec.id) rec.id = Store.freeId(st.moves, 'mv');
    st.moves.unshift(rec);
    return rec;
  }
  function addTo(st, productId, e, c, delta) {
    if (!st.stock) st.stock = {};
    const byE = st.stock[productId] || (st.stock[productId] = {});
    const byC = byE[e] || (byE[e] = {});
    byC[c] = (isNum(byC[c]) ? byC[c] : 0) + delta;
  }

  // Движение товара, меняющее остаток: Приход, Отгрузка, Списание в бой, Перемещение
  // ({kind, productId, qty, entityId, cityId, toEntityId?, toCityId?, doc, by, at}). Остаток и журнал — вместе.
  // Резерв и его снятие — через reserve() и unreserve(): им нужна запись резерва.
  // → {ok, move} или {ok:false, reason}; при отказе ничего не меняется.
  function move(st, { kind, productId, qty, entityId, cityId, toEntityId, toCityId, doc, by, at } = {}) {
    const q = Number(qty), e = entityId || ANY, c = cityId || ANY;
    if (![KINDS.receive, KINDS.ship, KINDS.damage, KINDS.transfer].includes(kind)) {
      return { ok: false, reason: `Движение «${kind}» не меняет остаток: резервы ставит и снимает reserve / unreserve.` };
    }
    if (!Number.isInteger(q) || q < 1) return { ok: false, reason: 'Укажите количество — целое число больше нуля.' };
    const rec = { at, productId, kind, qty: q, entityId: e, cityId: c, doc, by };
    if (kind !== KINDS.receive) {
      const have = grid(st, productId).cell(e, c) ?? 0;
      if (q > have) return { ok: false, reason: `В клетке «${entityName(st, e) ?? e}, ${cityName(st, c) ?? c}» только ${have}, а нужно ${q}.` };
      addTo(st, productId, e, c, -q);
    }
    if (kind === KINDS.receive) addTo(st, productId, e, c, q);
    if (kind === KINDS.transfer) {
      rec.toEntityId = toEntityId || ANY; rec.toCityId = toCityId || ANY;
      addTo(st, productId, rec.toEntityId, rec.toCityId, q);
    }
    if (kind === KINDS.damage) {
      if (!st.aside) st.aside = {};
      const a = st.aside[productId] || (st.aside[productId] = { damaged: null, custody: null, transitNoShip: null });
      a.damaged = (isNum(a.damaged) ? a.damaged : 0) + q;
    }
    return { ok: true, move: log(st, rec) };
  }

  // Поставить резерв {productId, qty, entityId, cityId, src, dealId, until, by, at}. Сначала canReserve.
  // → {ok, reserve, max} или {ok:false, max, reason}. Запись в журнале — «Резерв».
  function reserve(st, p = {}) {
    const chk = canReserve(st, p);
    if (!chk.ok) return { ok: false, max: chk.max, reason: chk.reason };
    const src = p.src || 'stock';
    const ship = src === 'stock' ? null : st.shipments.find(x => x.id === src);
    const r = {
      id: Store.freeId(st.reserves, 'r'), productId: p.productId, qty: Number(p.qty),
      entityId: ship ? (ship.entityId || ANY) : (p.entityId || ANY), cityId: ship ? (ship.cityId || ANY) : (p.cityId || ANY),
      src, dealId: p.dealId, until: p.until,
    };
    st.reserves.push(r);
    log(st, { at: p.at, productId: r.productId, kind: KINDS.reserve, qty: r.qty, entityId: r.entityId, cityId: r.cityId, doc: r.dealId, by: p.by });
    return { ok: true, reserve: r, max: chk.max - r.qty };
  }

  // Снять резерв: товар возвращается в свободный остаток, в журнале — «Снят резерв». → {ok, reserve} | {ok:false, reason}
  function unreserve(st, reserveId, by, at) {
    const i = (st.reserves || []).findIndex(r => r.id === reserveId);
    if (i < 0) return { ok: false, reason: 'Такого резерва нет.' };
    const r = st.reserves.splice(i, 1)[0];
    log(st, { at, productId: r.productId, kind: KINDS.unreserve, qty: r.qty, entityId: r.entityId || ANY, cityId: r.cityId || ANY, doc: r.dealId, by });
    return { ok: true, reserve: r };
  }

  // Резервы с истёкшим сроком: день «до» раньше дня now. В последний день срока резерв ещё действует. Единственное определение
  // «срок резерва вышел»: плитка главного экрана и «Требует внимания» зовут его, а не считают сами.
  function expired(st, now) {
    const today = sod(now);
    return (st.reserves || []).filter(r => r.until && sod(r.until) < today);
  }

  // Снять с резерва q штук: весь резерв — unreserve(), часть — резерв уменьшается, в журнале «Снят резерв» на q.
  // r — запись резерва или его id. → {ok, reserve} | {ok:false, reason}
  function release(st, r, q, by, at) {
    if (typeof r === 'string') r = (st.reserves || []).find(x => x.id === r);
    if (!r) return { ok: false, reason: 'Такого резерва нет.' };
    if (!Number.isInteger(Number(q)) || q < 1) return { ok: false, reason: 'Укажите количество — целое число больше нуля.' };
    if (q >= r.qty) return unreserve(st, r.id, by, at);
    r.qty -= q;
    log(st, { at, productId: r.productId, kind: KINDS.unreserve, qty: q, entityId: r.entityId || ANY, cityId: r.cityId || ANY, doc: r.dealId, by });
    return { ok: true, reserve: r };
  }

  // Сколько можно списать при продаже. По резерву (reserveId) — сколько в нём осталось и лежит в его клетке; без резерва —
  // остаток клетки минус резервы со склада на эту клетку (зарезервированное под другого клиента списывать нельзя).
  // Резерв «под поставку» клетку не занимает: на складе этого товара ещё нет. Единственное место правила: Stock.sell и экран.
  function sellMax(st, { productId, entityId, cityId, reserveId } = {}) {
    if (reserveId) {
      const r = (st.reserves || []).find(x => x.id === reserveId);
      if (!r || r.productId !== productId || r.src !== 'stock') return 0;
      return Math.max(0, Math.min(r.qty, grid(st, productId).cell(r.entityId || ANY, r.cityId || ANY) ?? 0));
    }
    const e = entityId || ANY, c = cityId || ANY;
    const held = sum((st.reserves || []).filter(r => r.productId === productId && r.src === 'stock' && cellKey(r) === e + '|' + c), r => r.qty);
    return Math.max(0, (grid(st, productId).cell(e, c) ?? 0) - held);
  }

  // Списать проданное: {productId, qty, entityId, cityId, reserveId?, doc} → «Отгрузка» из клетки (через move) и,
  // если есть reserveId, снятие этого количества с резерва — одним действием, поэтому свободный остаток
  // (годный остаток − резервы) не меняется. Клетка по резерву — та, где он стоит. Нужно право sell.
  // Без reserveId — не больше sellMax: остаток клетки минус резервы на неё; с reserveId — в пределах своего резерва.
  // → {ok, move, reserve} | {ok:false, reason}; при отказе ничего не меняется.
  function sell(st, { productId, qty, entityId, cityId, reserveId, doc } = {}, by, now) {
    if (!Perms.can(st, by, 'sell')) return { ok: false, reason: 'У вас нет права списывать товар при продаже.' };
    const q = Number(qty);
    if (!Number.isInteger(q) || q < 1) return { ok: false, reason: 'Укажите количество — целое число больше нуля.' };
    let e = entityId || ANY, c = cityId || ANY, r = null;
    if (reserveId) {
      r = (st.reserves || []).find(x => x.id === reserveId) || null;
      if (!r) return { ok: false, reason: 'Такого резерва нет.' };
      if (r.productId !== productId) return { ok: false, reason: 'Этот резерв поставлен на другой товар.' };
      if (r.src !== 'stock') return { ok: false, reason: `Резерв стоит под поставку ${r.src}: на складе этого товара ещё нет.` };
      if (q > r.qty) return { ok: false, reason: `В резерве только ${r.qty}, а списать нужно ${q}.` };
      const re = r.entityId || ANY, rc = r.cityId || ANY;
      if ((entityId || cityId) && (e !== re || c !== rc)) {
        return { ok: false, reason: `Резерв лежит в клетке «${entityName(st, re) ?? re}, ${cityName(st, rc) ?? rc}» — списать можно только оттуда.` };
      }
      e = re; c = rc;
    } else {
      // лежит достаточно, но часть занята чужим резервом — отказ с числом; если не лежит вовсе, скажет move
      const have = grid(st, productId).cell(e, c) ?? 0, free = sellMax(st, { productId, entityId: e, cityId: c });
      if (q <= have && q > free) {
        return { ok: false, reason: `В клетке «${entityName(st, e) ?? e}, ${cityName(st, c) ?? c}» лежит ${have}, из них под резервом ${have - free}: без резерва можно списать только ${free}, а нужно ${q}. Зарезервированное списывают по его резерву.` };
      }
    }
    const m = move(st, { kind: KINDS.ship, productId, qty: q, entityId: e, cityId: c, doc, by, at: now });
    if (!m.ok) return { ok: false, reason: m.reason + ' Списать больше, чем лежит в клетке, нельзя.' };
    if (r) release(st, r, q, by, now);
    return { ok: true, move: m.move, reserve: r };
  }

  // ——— что человек видит в резерве: единственное место правила ———
  // Резерв видят все, у кого есть право stock: сколько, где (юрлицо · город или «в пути» с номером поставки) и до какого числа.
  // Номер сделки и клиента — только тому, кому сделка видна (Leads.dealsVisible, ADR 0005); остальным вместо них —
  // HIDDEN_DEAL, без ссылки и без кнопок «Снять» и «Списать». Карточка товара, журнал, карточка поставки, превью приёмки
  // и текст уведомления зовут эти функции, своих проверок не заводят.
  const HIDDEN_DEAL = 'сделка скрыта';
  // Номер сделки, которую человек не видит, в его копии состояния (Visible.of): резерв и движение остаются, номера нет.
  const HIDDEN_ID = 'hidden';

  // «Юрлицо · город» клетки склада; неизвестный id показывается как есть.
  const cellText = (st, e, c) => `${entityName(st, e || ANY) ?? e} · ${cityName(st, c || ANY) ?? c}`;

  // Сделка глазами человека: {id, client}, если она есть среди Leads.dealsVisible(st, personId); иначе null.
  function dealRef(st, dealId, personId) {
    const d = dealId ? Leads.dealsVisible(st, personId).find(x => x.id === dealId) : null;
    return d ? { id: d.id, client: d.client } : null;
  }

  // Резерв глазами человека: {id, productId, qty, src, inTransit, where, until, note, deal, hasDeal}. note — примечание резерва
  // (перенос остатков кладёт в него текст ячейки «Резерв» с именем клиента; у резерва из сделки его нет).
  // where — «ИП · Иркутск» или «в пути: П-1043»; deal — {id, client} или null (скрыта); hasDeal — резерв вообще привязан к
  // сделке из состояния (нет — на экране «нет данных: сделка», а не «скрыта»). Нет права stock → null: резерва человек не видит.
  function reserveView(st, r, personId) {
    if (!r || !Perms.can(st, personId, 'stock')) return null;
    const src = r.src || 'stock', inTransit = src !== 'stock';
    return {
      id: r.id, productId: r.productId, qty: r.qty, src, inTransit,
      where: inTransit ? `в пути: ${src}` : cellText(st, r.entityId, r.cityId),
      until: r.until || null,
      note: r.note || null,
      deal: dealRef(st, r.dealId, personId),
      hasDeal: r.dealId === HIDDEN_ID || (st.deals || []).some(d => d.id === r.dealId),
    };
  }

  // Документ движения глазами человека: номер своей сделки как есть, чужой — HIDDEN_DEAL; поставка, накладная — как есть.
  function docView(st, doc, personId) {
    if (doc === HIDDEN_ID) return HIDDEN_DEAL;
    if (!doc || !(st.deals || []).some(d => d.id === doc)) return doc || '';
    return dealRef(st, doc, personId) ? doc : HIDDEN_DEAL;
  }

  return { ANY, KINDS, NO_ENTITY, NO_CITY, HIDDEN_DEAL, HIDDEN_ID, defaults, entityName, cityName, grid, incomingOf, freeIn, summary, canReserve, bestCell, move, reserve, unreserve, release, expired, sellMax, sell, cellText, dealRef, reserveView, docView };
})();
