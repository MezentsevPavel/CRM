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
  // Входящая поставка, ещё не принятая на склад (этап без флага final), по возрастанию ожидаемой даты.
  function incomingOf(st, productId) {
    return (st.shipments || [])
      .filter(s => s.dir === 'in' && !Pipes.isFinal(st, s.pipeId, s.stageId))
      .flatMap(s => (s.items || []).filter(i => i.productId === productId).map(i => ({ shipId: s.id, qty: i.qty, eta: s.eta })))
      .sort((a, b) => a.eta - b.eta);
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
  function log(st, rec) {
    if (!st.moves) st.moves = [];
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

  return { ANY, KINDS, NO_ENTITY, NO_CITY, defaults, entityName, cityName, grid, incomingOf, freeIn, summary, canReserve, bestCell, move, reserve, unreserve };
})();
