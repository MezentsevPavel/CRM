// Ядро: остатки, резервы и журнал движений. Чистая логика, без DOM и текущего времени —
// время приходит аргументом. Свободный остаток считает summary() — единственное место формулы.
//
// Данные состояния (схема v3):
//   stock[productId][entityId|'_'][cityId|'_'] = количество; '_' — «нет данных» (в таблице менеджеров города нет);
//   aside[productId] = {damaged, custody, transitNoShip} — «Бой», ответхранение, «В пути» без поставки;
//   reserves[{id, productId, qty, entityId, cityId, src:'stock'|shipId, dealId, until, by, at, forWho?, note?, imported?, hist?, warned?}]:
//     by/at — кто и когда поставил (у старых резервов их может не быть — «нет данных»); forWho — «для кого» у резерва без сделки
//     (reserveFor); note — примечание переноса остатков; hist — смены срока [{at, by, until, was}] (extend); warned — срок «до»
//     (число, мс), о котором автору уже напомнили (remindExpiring);
//   moves[{at, productId, kind, qty, entityId, cityId, doc, by, rid?, src?, sold?}] — новые записи сверху. У «Резерв» и «Снят резерв»
//     rid — id резерва (по нему собираются история резерва и «Снятые резервы»), src — поставка резерва «под приход»,
//     sold — снят продажей (sell), а не руками;
//   watches[{id, productId, personId, at}] — «Сообщить, когда появится» (watch, notifyAppeared).
// Пустая клетка — null или нет ключа, не ноль: «0» в таблице и «не заполнено» — разные вещи.

const Stock = (() => {
  // «Нет данных»: юрлицо или город в источнике не указаны.
  const ANY = '_';
  // Виды движений — подписи как на экране и в журнале.
  // Срок резерва по умолчанию, дней: единственная величина — её берут Deals.reserve, карточка товара и окно резерва строки сделки.
  // Допущение спецификации: 14 дней (так стояло в двух местах из трёх); меняется здесь одной цифрой.
  const RESERVE_DAYS = 14;
  const KINDS = { receive: 'Приход', ship: 'Отгрузка', reserve: 'Резерв', unreserve: 'Снят резерв', transfer: 'Перемещение', damage: 'Списание в бой', input: 'Ввод остатков' };
  // input — запись журнала от переноса таблицы остатков (Import.applyStock), в qty — остаток клетки, а не прибавка. Stock.move его не
  // принимает (список видов, меняющих остаток, ниже явный); сервер пускает такое движение по праву admin (Guard).
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
    // Груз перемещения в пути уже записан в клетку «куда» (одно движение «Перемещение» откуда → куда пишется при выходе
    // со склада), но на складе его ещё нет: пока заявка не «Доставлена», клетка «куда» показывает остаток без него.
    const way = {};
    for (const t of Dispatch.transit(st, productId)) { const k = t.entityId + '\u0001' + t.cityId; way[k] = (way[k] || 0) + t.qty; }
    const cell = (e, c) => {
      const n = data[e] && isNum(data[e][c]) ? data[e][c] : null, w = way[e + '\u0001' + c];
      return w ? (n || 0) - w : n;
    };
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
      .flatMap(s => (s.items || []).filter(i => i.productId === productId).map(i => ({ shipId: s.id, qty: i.qty, eta: s.eta, entityId: s.entityId || ANY })));
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
  // known — в таблице остатков по товару есть хоть одно число (иначе остаток «нет данных», а free и freeAfter — null).
  // now принимается по договору интерфейса: резервы с истёкшим сроком пока остаются в силе, пока их не сняли.
  function summary(st, productId, now) {
    void now;
    const g = grid(st, productId);
    const a = (st.aside && st.aside[productId]) || {};
    const inc = incomingOf(st, productId);
    const rs = (st.reserves || []).filter(r => r.productId === productId);
    const known = g.totals.all !== null, onHand = g.totals.all ?? 0;
    const reservedStock = sum(rs.filter(r => r.src === 'stock'), r => r.qty);
    const reservedIncoming = sum(rs.filter(r => r.src !== 'stock'), r => r.qty);
    const incoming = sum(inc, x => x.qty);
    // Нет числа в таблице — свободное неизвестно (null), а не «лежит 0, значит свободно 0 или минус резервы»
    const free = known ? onHand - reservedStock : null;
    return {
      known,
      onHand,
      damaged: isNum(a.damaged) ? a.damaged : null,
      custody: isNum(a.custody) ? a.custody : null,
      transitNoShip: isNum(a.transitNoShip) ? a.transitNoShip : null,
      incoming, reservedStock, reservedIncoming,
      free,
      freeAfter: known ? free + incoming - reservedIncoming : null,
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

  // Клетка склада, откуда лучше всего резервировать: где больше всего свободного (первая из cells). Нет остатка → ('_', '_').
  function bestCell(st, productId) {
    const c = cells(st, productId)[0];
    return c ? { entityId: c.entityId, cityId: c.cityId } : { entityId: ANY, cityId: ANY };
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

  // Поставить резерв {productId, qty, entityId, cityId, src, dealId, forWho?, until, by, at}. Сначала canReserve.
  // Кто и когда поставил — в самом резерве (by, at) и в журнале («Резерв» с rid). → {ok, reserve, max} или {ok:false, max, reason}.
  function reserve(st, p = {}) {
    const chk = canReserve(st, p);
    if (!chk.ok) return { ok: false, max: chk.max, reason: chk.reason };
    const src = p.src || 'stock';
    const ship = src === 'stock' ? null : st.shipments.find(x => x.id === src);
    if (!st.reserves) st.reserves = [];
    const r = {
      id: Store.freeId(st.reserves, 'r'), productId: p.productId, qty: Number(p.qty),
      entityId: ship ? (ship.entityId || ANY) : (p.entityId || ANY), cityId: ship ? (ship.cityId || ANY) : (p.cityId || ANY),
      src, dealId: p.dealId, until: p.until, by: p.by || null, at: p.at,
    };
    if (!p.dealId && p.forWho) r.forWho = p.forWho;
    st.reserves.push(r);
    log(st, moveOf(r, KINDS.reserve, r.qty, p.by, p.at));
    return { ok: true, reserve: r, max: chk.max - r.qty };
  }
  // Документ записи журнала о резерве: номер сделки, «для: …» у резерва без сделки, иначе пусто
  const forDoc = r => r.dealId || (r.forWho ? 'для: ' + r.forWho : undefined);
  // Запись журнала «Резерв» / «Снят резерв» по резерву r: с его id (rid) и поставкой (src), если он «под приход»
  function moveOf(r, kind, qty, by, at, sold) {
    const m = { at, productId: r.productId, kind, qty, entityId: r.entityId || ANY, cityId: r.cityId || ANY, doc: forDoc(r), by, rid: r.id };
    if (r.src && r.src !== 'stock') m.src = r.src;
    if (sold) m.sold = true;
    return m;
  }

  // Для кого резерв — глазами человека personId: «Д-311, Иванов» (сделка ему видна), «сделка скрыта», текст «для кого»,
  // примечание переноса или «нет данных: для кого». Одна фраза на уведомления и экран.
  function forText(st, r, personId) {
    if (r.dealId) {
      const d = dealRef(st, r.dealId, personId);
      if (d) return `${d.id}, ${d.client}`;
      if (r.dealId === HIDDEN_ID || (st.deals || []).some(x => x.id === r.dealId)) return HIDDEN_DEAL;
    }
    return r.forWho || r.note || 'нет данных: для кого';
  }
  // Куда ведёт уведомление о резерве человеку personId: сделка, если она ему видна, иначе карточка товара
  const refFor = (st, r, personId) => (r.dealId && dealRef(st, r.dealId, personId) ? { t: 'deal', id: r.dealId } : { t: 'product', id: r.productId });
  const prodName = (st, id) => low(((st.products || []).find(p => p.id === id) || {}).name || 'нет данных: товар');
  const personName = (st, id) => ((st.people || []).find(p => p.id === id) || {}).name || 'нет данных: кто';
  // Автор резерва: кто поставил (by); у старых — по журналу (Feed.reserveWhen); нет — менеджер сделки
  function authorOf(st, r) {
    if (r.by) return r.by;
    const w = Feed.reserveWhen(st, r);
    if (w.by) return w.by;
    const d = r.dealId && (st.deals || []).find(x => x.id === r.dealId);
    return (d && d.managerId) || null;
  }

  // Снять резерв: товар возвращается в свободный остаток, в журнале — «Снят резерв» (rid, sold — снят продажей).
  // Снял не автор — автору уведомление «Ваш резерв … снял …». → {ok, reserve} | {ok:false, reason}
  function unreserve(st, reserveId, by, at, sold) {
    const i = (st.reserves || []).findIndex(r => r.id === reserveId);
    if (i < 0) return { ok: false, reason: 'Такого резерва нет.' };
    const r = st.reserves.splice(i, 1)[0];
    log(st, moveOf(r, KINDS.unreserve, r.qty, by, at, sold));
    const author = authorOf(st, r);
    if (by && author && author !== by) {
      const what = `Ваш резерв ${prodName(st, r.productId)} × ${num(r.qty)} (${forText(st, r, author)})`;
      const who = personName(st, by).replace(/\.$/, '');   // имя с инициалом уже кончается точкой — вторую не ставим
      Notify.to(st, 'reserve', by, sold ? `${what} списан при продаже: ${who}.` : `${what} снял ${who}.`, at, [author], refFor(st, r, author));
    }
    return { ok: true, reserve: r };
  }

  // Резерв без сделки: «для кого» текстом (обязательно), источник — клетка склада или поставка в пути, срок «до», право reserve.
  // Те же проверки свободного, что у резерва сделки (canReserve). o: {productId, qty, src?, entityId?, cityId?, until?, forWho}.
  // Уведомление — складу и директору (Notify.RECIPIENTS.reserve). → {ok, reserve, max} | {ok:false, reason, max}
  function reserveFor(st, o = {}, by, now) {
    const fail = (reason, max = 0) => ({ ok: false, reason, max });
    if (!Perms.can(st, by, 'reserve')) return fail('У вашей роли нет права ставить резервы.');
    const forWho = String(o.forWho || '').trim().slice(0, 200);
    if (!forWho) return fail('Напишите, для кого резерв: например, «под Иванова, монтаж в Шелехове».');
    if (!(st.products || []).some(p => p.id === o.productId)) return fail('Такого товара нет в каталоге.');
    const until = o.until || new Date(new Date(now).getTime() + RESERVE_DAYS * 864e5);
    if (sod(until) < sod(now)) return fail('Дата окончания резерва не может быть в прошлом.');
    const src = o.src || 'stock';
    const res = reserve(st, { productId: o.productId, qty: o.qty, src, entityId: o.entityId, cityId: o.cityId, until, forWho, by, at: now });
    if (!res.ok) return fail(res.reason, res.max);
    const r = res.reserve, where = src === 'stock' ? `со склада ${cellText(st, r.entityId, r.cityId)}` : `в пути: ${src}`;
    Notify.push(st, 'reserve', by, `Резерв без сделки: ${prodName(st, r.productId)} — ${num(r.qty)} ${where} для «${forWho}» до ${fD(until)}.`, now, [], { t: 'product', id: r.productId });
    return res;
  }

  // Сменить срок резерва: право reserve, у резерва сделки — ещё и право править сделку. Смена пишется в историю резерва (hist),
  // напоминание о сроке взводится заново. → {ok, reserve} | {ok:false, reason}
  function extend(st, reserveId, until, by, now) {
    const r = (st.reserves || []).find(x => x.id === reserveId);
    if (!r) return { ok: false, reason: 'Такого резерва нет.' };
    if (!Perms.can(st, by, 'reserve')) return { ok: false, reason: 'У вашей роли нет права менять резервы.' };
    const d = r.dealId && (st.deals || []).find(x => x.id === r.dealId);
    if (r.dealId && (!d || !Deals.canEdit(st, d, by))) return { ok: false, reason: 'Срок резерва сделки меняет тот, кто может править сделку.' };
    if (!until || isNaN(new Date(until).getTime())) return { ok: false, reason: 'Укажите дату.' };
    if (sod(until) < sod(now)) return { ok: false, reason: 'Дата окончания резерва не может быть в прошлом.' };
    if (r.until && +sod(r.until) === +sod(until)) return { ok: false, reason: 'Срок не изменился.' };
    r.hist = [...(r.hist || []), { at: now, by, until, was: r.until || null }];
    r.until = until;
    delete r.warned;
    return { ok: true, reserve: r };
  }

  // Когда и кем поставлен резерв: своя отметка, иначе по журналу. → {at, by} (null — нет данных)
  function placed(st, r) {
    if (r.at) return { at: r.at, by: r.by || null };
    const m = (st.moves || []).find(x => x.rid === r.id && x.kind === KINDS.reserve);
    return m ? { at: m.at, by: m.by || null } : Feed.reserveWhen(st, r);
  }

  // История резерва r по времени: [{at, by, text}] — поставлен, срок изменён, снято / списано при продаже, срок вышел.
  // Источник — журнал движений (rid) и смены срока в резерве (hist); «срок вышел» — по until и now, без кого.
  function history(st, r, now) {
    const out = [], p = placed(st, r), mine = (st.moves || []).filter(m => m.rid === r.id);
    const first = mine.filter(m => m.kind === KINDS.reserve).pop();
    out.push({ at: p.at || null, by: p.by || null, text: `Поставлен: ${num(first ? first.qty : r.qty)}` });
    for (const h of r.hist || []) out.push({ at: h.at, by: h.by || null, text: `Срок: ${h.was ? 'до ' + fD(h.was) : 'не был задан'} → до ${fD(h.until)}` });
    for (const m of mine.filter(x => x.kind === KINDS.unreserve)) out.push({ at: m.at, by: m.by || null, text: `${m.sold ? 'Списано при продаже' : 'Снято'}: ${num(m.qty)}` });
    if (r.until && now && sod(r.until) < sod(now)) out.push({ at: new Date(+sod(r.until) + 864e5), by: null, text: `Срок вышел (был до ${fD(r.until)})` });
    const t = x => (x.at ? new Date(x.at).getTime() : 0);
    return out.sort((a, b) => t(a) - t(b));
  }

  // Снятые резервы товара — по журналу: резерв, у которого есть «Резерв» с rid, а самого резерва уже нет. Последние limit
  // по времени снятия: [{rid, qty, doc, entityId, cityId, src, at, by, removedAt, removedBy, sold}]. Старые записи журнала
  // без rid сюда не попадают.
  function removed(st, productId, limit = 20) {
    const live = new Set((st.reserves || []).map(r => r.id)), by = new Map();
    for (const m of st.moves || []) {
      if (m.productId !== productId || !m.rid || live.has(m.rid)) continue;
      const x = by.get(m.rid) || { rid: m.rid, put: null, off: null };
      if (m.kind === KINDS.reserve && !x.put) x.put = m;
      if (m.kind === KINDS.unreserve && !x.off) x.off = m;   // журнал — новые сверху: первое снятие и есть последнее
      by.set(m.rid, x);
    }
    const t = v => (v ? new Date(v).getTime() : 0);
    return [...by.values()].filter(x => x.put && x.off)
      .map(x => ({ rid: x.rid, qty: x.put.qty, doc: x.put.doc, entityId: x.put.entityId, cityId: x.put.cityId, src: x.put.src || 'stock',
        at: x.put.at, by: x.put.by || null, removedAt: x.off.at, removedBy: x.off.by || null, sold: !!x.off.sold }))
      .sort((a, b) => t(b.removedAt) - t(a.removedAt)).slice(0, limit);
  }

  // Резервы с истёкшим сроком: день «до» раньше дня now. В последний день срока резерв ещё действует. Единственное определение
  // «срок резерва вышел»: плитка главного экрана и «Требует внимания» зовут его, а не считают сами.
  function expired(st, now) {
    const today = sod(now);
    return (st.reserves || []).filter(r => r.until && sod(r.until) < today);
  }

  // Снять с резерва q штук: весь резерв — unreserve(), часть — резерв уменьшается, в журнале «Снят резерв» на q.
  // r — запись резерва или его id. → {ok, reserve} | {ok:false, reason}
  function release(st, r, q, by, at, sold) {
    if (typeof r === 'string') r = (st.reserves || []).find(x => x.id === r);
    if (!r) return { ok: false, reason: 'Такого резерва нет.' };
    if (!Number.isInteger(Number(q)) || q < 1) return { ok: false, reason: 'Укажите количество — целое число больше нуля.' };
    if (q >= r.qty) return unreserve(st, r.id, by, at, sold);
    r.qty -= q;
    log(st, moveOf(r, KINDS.unreserve, q, by, at, sold));
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
    return cellFree(st, grid(st, productId), productId, entityId || ANY, cityId || ANY);
  }
  // Свободно в клетке без резерва: остаток клетки минус резервы со склада на неё (g — Stock.grid товара). Единственная формула.
  function cellFree(st, g, productId, e, c) {
    const held = sum((st.reserves || []).filter(r => r.productId === productId && r.src === 'stock' && cellKey(r) === e + '|' + c), r => r.qty);
    return Math.max(0, (g.cell(e, c) ?? 0) - held);
  }
  // Клетки «юрлицо × город», где товар можно взять без чужого резерва: [{entityId, cityId, free}], free = sellMax > 0.
  // Больше свободного — выше, при равенстве — по порядку таблицы. Клетки с нулём не попадают. Нужна bestCell и форме заявки
  // (видно, на каком юрлице и в каком городе лежит товар).
  function cells(st, productId) {
    const g = grid(st, productId), out = [];
    for (const r of g.rows) for (const c of g.cols) {
      const free = cellFree(st, g, productId, r.id, c.id);
      if (free > 0) out.push({ entityId: r.id, cityId: c.id, free });
    }
    return out.map((x, i) => [x, i]).sort((a, b) => b[0].free - a[0].free || a[1] - b[1]).map(x => x[0]);
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
    if (r) release(st, r, q, by, now, true);
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
  // forWho — «для кого» резерва без сделки; by, at — кто и когда поставил (placed; null — нет данных).
  function reserveView(st, r, personId) {
    if (!r || !Perms.can(st, personId, 'stock')) return null;
    const src = r.src || 'stock', inTransit = src !== 'stock';
    const ship = inTransit ? (st.shipments || []).find(s => s.id === src) : null;
    const p = placed(st, r);
    return {
      id: r.id, productId: r.productId, qty: r.qty, src, inTransit,
      where: inTransit ? `в пути: ${src}, ${entityName(st, (ship && ship.entityId) || r.entityId || ANY) ?? r.entityId}` : cellText(st, r.entityId, r.cityId),
      until: r.until || null,
      note: r.note || null,
      forWho: r.dealId ? null : (r.forWho || null),
      by: p.by || null, at: p.at || null,
      deal: dealRef(st, r.dealId, personId),
      hasDeal: r.dealId === HIDDEN_ID || (st.deals || []).some(d => d.id === r.dealId),
    };
  }

  // ——— в пути по юрлицам ———
  // Что едет к нам (incomingOf), по юрлицу поставки (у перемещения — юрлицо склада-получателя): [{entityId, name, qty, sold}],
  // sold — резервы под эти поставки («продано» из того, что в пути). Порядок — справочник юрлиц, затем прочие.
  function transitBy(st, productId) {
    const acc = new Map();
    for (const x of incomingOf(st, productId)) {
      const e = x.entityId || ANY, a = acc.get(e) || { entityId: e, qty: 0, sold: 0, ships: new Set() };
      a.qty += x.qty;
      if (!x.dispatchId) a.ships.add(x.shipId);
      acc.set(e, a);
    }
    for (const r of st.reserves || []) {
      if (r.productId !== productId || !r.src || r.src === 'stock') continue;
      for (const a of acc.values()) if (a.ships.has(r.src)) a.sold += r.qty;
    }
    const order = (st.entities || []).map(x => x.id);
    const rank = id => { const i = order.indexOf(id); return i < 0 ? order.length + (id === ANY ? 1 : 0) : i; };
    return [...acc.values()].sort((a, b) => rank(a.entityId) - rank(b.entityId))
      .map(a => ({ entityId: a.entityId, name: entityName(st, a.entityId) ?? a.entityId, qty: a.qty, sold: a.sold }));
  }
  // «ВС 20 (продано 15) · НПП 5» — одна подпись на таблицу номенклатуры и карточку товара; ничего не едет — ''
  const transitText = (st, productId) => transitBy(st, productId).map(a => `${a.name} ${num(a.qty)}${a.sold ? ` (продано ${num(a.sold)})` : ''}`).join(' · ');

  // ——— «Сообщить, когда появится» ———
  const watchOf = (st, productId, personId) => (st.watches || []).find(w => w.productId === productId && w.personId === personId) || null;
  // Подписаться: право stock. Уже подписан — та же подписка. → {ok, watch} | {ok:false, reason}
  function watch(st, productId, personId, now) {
    if (!Perms.can(st, personId, 'stock')) return { ok: false, reason: 'У вашей роли нет права смотреть остатки.' };
    if (!(st.products || []).some(p => p.id === productId)) return { ok: false, reason: 'Такого товара нет в каталоге.' };
    const had = watchOf(st, productId, personId);
    if (had) return { ok: true, watch: had };
    if (!st.watches) st.watches = [];
    const w = { id: Store.freeId(st.watches, 'w'), productId, personId, at: now };
    st.watches.push(w);
    return { ok: true, watch: w };
  }
  function unwatch(st, productId, personId) {
    const w = watchOf(st, productId, personId);
    if (!w) return false;
    st.watches.splice(st.watches.indexOf(w), 1);
    return true;
  }
  // Подписки, которым пора: свободный остаток товара больше нуля. Подписавшимся — уведомление «… появился: свободно N (где)»,
  // подписка снимается — уведомление приходит один раз. → [уведомление…]
  function notifyAppeared(st, now) {
    const out = [], ready = new Map();
    for (const w of st.watches || []) {
      const k = summary(st, w.productId);
      if (k.free !== null && k.free > 0) ready.set(w.productId, [...(ready.get(w.productId) || []), w]);
    }
    for (const [pid, ws] of ready) {
      const k = summary(st, pid), cs = cells(st, pid);
      const where = cs.length === 1 ? cellText(st, cs[0].entityId, cs[0].cityId) : cs.map(c => `${cellText(st, c.entityId, c.cityId)} ${num(c.free)}`).join(', ');
      const name = ((st.products || []).find(p => p.id === pid) || {}).name || 'нет данных: товар';
      const n = Notify.to(st, 'arrive', null, `${name} появился: свободно ${num(k.free)}${where ? ` (${where})` : ''}.`, now, ws.map(w => w.personId), { t: 'product', id: pid });
      if (n) out.push(n);
      st.watches = st.watches.filter(w => !ws.includes(w));
    }
    return out;
  }
  // Резервы, срок которых кончается завтра (последний день «до» — завтра), о которых автору ещё не напоминали
  function expiring(st, now) {
    const tomorrow = +sod(new Date(+sod(now) + 36 * 3600e3));
    return (st.reserves || []).filter(r => r.until && +sod(r.until) === tomorrow && r.warned !== +sod(r.until));
  }
  // Напомнить автору резерва (authorOf) — со сделкой и без: «Резерв … истекает завтра». Один раз на срок (warned). → [уведомление…]
  function remindExpiring(st, now) {
    const out = [];
    for (const r of expiring(st, now)) {
      r.warned = +sod(r.until);
      const author = authorOf(st, r);
      if (!author) continue;
      const n = Notify.to(st, 'reserve', null, `Резерв ${prodName(st, r.productId)} × ${num(r.qty)} (${forText(st, r, author)}) истекает завтра, ${fD(r.until)}: продлите или снимите.`, now, [author], refFor(st, r, author));
      if (n) out.push(n);
    }
    return out;
  }
  // Есть ли что разослать по времени — дёшево, для задач сервера
  const due = (st, now) => expiring(st, now).length > 0 || (st.watches || []).some(w => { const k = summary(st, w.productId); return k.free !== null && k.free > 0; });
  // Уведомления склада по времени (сервер — раз в минуту, демо — при отрисовке): срок резерва завтра, товар появился
  const tick = (st, now) => [...remindExpiring(st, now), ...notifyAppeared(st, now)];

  // Документ движения глазами человека: номер своей сделки как есть, чужой — HIDDEN_DEAL; поставка, накладная — как есть.
  function docView(st, doc, personId) {
    if (doc === HIDDEN_ID) return HIDDEN_DEAL;
    if (!doc || !(st.deals || []).some(d => d.id === doc)) return doc || '';
    return dealRef(st, doc, personId) ? doc : HIDDEN_DEAL;
  }

  return {
    ANY, RESERVE_DAYS, KINDS, NO_ENTITY, NO_CITY, HIDDEN_DEAL, HIDDEN_ID, defaults, entityName, cityName, grid, incomingOf, freeIn, summary, canReserve, bestCell, cells, move, reserve, unreserve, release, expired, sellMax, sell, cellText, dealRef, reserveView, docView,
    reserveFor, extend, forText, placed, history, removed, transitBy, transitText, watchOf, watch, unwatch, notifyAppeared, remindExpiring, due, tick };
})();

// Пустая база: подписок «Сообщить, когда появится» нет
BASES.push(st => { st.watches = []; });
