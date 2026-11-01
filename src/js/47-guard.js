// Ядро: может ли человек провести пачку изменений (права на запись). Без DOM; st первым аргументом, время now аргументом.
// st — состояние сервера до пачки, changes — пачка после слияния (формы Docs.diff: {key, id, base, data} | {key, id, base,
// deleted}). Прежнее значение берётся из st (Docs.get), а не из change.base: прислать можно что угодно.
// Остаток склада меняется только движением: изменение stock/aside должно сойтись с суммой новых записей moves той же пачки
// (как их считает Stock.move). Правила по ключам — Guard.RULES[key](ctx, change) → null | текст «Нет прав: …».

const Guard = (() => {
  const isNum = v => typeof v === 'number' && isFinite(v);
  const no = text => 'Нет прав: ' + text;
  const label = right => ((Perms.LIST.find(([k]) => k === right) || [])[1]) || right;
  const needs = (what, ...rights) => no(`${what} — нужно право «${rights.map(label).join('» или «')}»`);
  const same = (a, b) => Docs.same(a === undefined ? null : a, b === undefined ? null : b);
  const SEP = '\u0001';
  // Движение «Ввод остатков» пишет перенос таблицы остатков (Import.applyStock): остаток товара заменяется целиком
  const INPUT = 'Ввод остатков';
  const STOCK_TEXT = no('остаток склада меняется только движением в журнале склада и ровно на его количество');

  // Поля, которые изменились между двумя записями
  const changedFields = (b, a) => [...new Set([...Object.keys(b || {}), ...Object.keys(a || {})])].filter(f => !same((b || {})[f], (a || {})[f]));
  const recOf = (st, key, id) => (Array.isArray(st[key]) ? st[key].find(x => x && String(x.id) === String(id)) : undefined);
  const personOf = (st, pid) => (st.people || []).find(p => p.id === pid);

  // ——— склад ———
  // Чего ждать от новых движений пачки: {stock: {productId: {'e\u0001c': Δ}}, damaged: {productId: Δ}, input: Set(productId)}
  function expected(moves) {
    const K = Stock.KINDS, ANY = Stock.ANY, exp = { stock: {}, damaged: {}, input: new Set() };
    for (const m of moves) {
      const q = Number(m.qty), p = m.productId;
      const add = (e, c, d) => { const cell = exp.stock[p] || (exp.stock[p] = {}), k = (e || ANY) + SEP + (c || ANY); cell[k] = (cell[k] || 0) + d; };
      if (m.kind === K.receive) add(m.entityId, m.cityId, q);
      else if (m.kind === K.ship) add(m.entityId, m.cityId, -q);
      else if (m.kind === K.damage) { add(m.entityId, m.cityId, -q); exp.damaged[p] = (exp.damaged[p] || 0) + q; }
      else if (m.kind === K.transfer) { add(m.entityId, m.cityId, -q); add(m.toEntityId, m.toCityId, q); }
      else if (m.kind === INPUT) exp.input.add(p);
    }
    return exp;
  }
  // Строка остатков товара {e: {c: n}} → Map('e\u0001c' → n)
  function cells(doc) {
    const out = new Map();
    for (const e of Object.keys(doc || {})) for (const c of Object.keys(doc[e] || {})) out.set(e + SEP + c, doc[e][c]);
    return out;
  }
  function stockRule(ctx, c) {
    if (ctx.exp.input.has(c.id)) return ctx.can('admin') ? null : needs('перенос остатков', 'admin');
    const b = cells(ctx.before(c)), a = cells(ctx.data(c)), exp = ctx.exp.stock[c.id] || {};
    for (const k of new Set([...b.keys(), ...a.keys(), ...Object.keys(exp)])) {
      const was = b.get(k), now = a.get(k);
      if (k in exp) { if (!isNum(now) || (isNum(was) ? was : 0) + exp[k] !== now) return STOCK_TEXT; }
      else if (!same(was, now)) return STOCK_TEXT;
    }
    return null;
  }
  function asideRule(ctx, c) {
    if (ctx.exp.input.has(c.id)) return ctx.can('admin') ? null : needs('перенос остатков', 'admin');
    const b = ctx.before(c) || {}, a = ctx.data(c) || {}, dq = ctx.exp.damaged[c.id] || 0;
    for (const f of new Set([...Object.keys(b), ...Object.keys(a), ...(dq ? ['damaged'] : [])])) {
      if (f === 'damaged' && dq) { if (!isNum(a.damaged) || (isNum(b.damaged) ? b.damaged : 0) + dq !== a.damaged) return STOCK_TEXT; }
      else if (!same(b[f], a[f])) return STOCK_TEXT;
    }
    return null;
  }
  // Каждое движение пачки должно найти свой остаток: товар с ненулевым Δ без изменения stock (aside) в пачке — отказ
  function stockCovered(ctx) {
    const has = (key, id) => ctx.list.some(x => x.key === key && String(x.id) === String(id));
    for (const p of Object.keys(ctx.exp.stock)) {
      if (Object.values(ctx.exp.stock[p]).some(d => d !== 0) && !has('stock', p)) return { key: 'stock', id: p, text: STOCK_TEXT };
    }
    for (const p of Object.keys(ctx.exp.damaged)) if (ctx.exp.damaged[p] && !has('aside', p)) return { key: 'aside', id: p, text: STOCK_TEXT };
    return null;
  }

  // Какое право нужно на вид движения — то, с которым этот вид создаётся в интерфейсе
  function moveRights(ctx, m) {
    const K = Stock.KINDS;
    const transfer = (ctx.after.dispatches || []).some(d => d.purpose === 'transfer' && d.number === m.doc);
    if (m.kind === K.receive) return transfer ? ['dispatch', 'logistics'] : ['receive'];
    if (m.kind === K.ship) return transfer ? ['dispatch', 'logistics'] : ['sell'];
    if (m.kind === K.transfer) return ['logistics', 'dispatch'];
    if (m.kind === K.damage) return ['stock'];
    if (m.kind === K.reserve) return ['reserve'];
    if (m.kind === K.unreserve) return ['reserve', 'dealsEdit', 'sell', 'receive'];
    return ['admin'];
  }
  function movesRule(ctx, c) {
    if (ctx.before(c) !== undefined || c.deleted) return no('записи журнала склада не правят и не удаляют');
    const m = c.data || {};
    if (m.by !== ctx.pid) return no('движение в журнале склада — только от своего имени');
    const need = moveRights(ctx, m);
    return need.some(ctx.can) ? null : needs(`движение «${m.kind || 'нет данных: вид'}»`, ...need);
  }

  // ——— резервы ———
  // Сделку можно править (Deals.canEdit): по состоянию до пачки, а новую сделку пачки — по состоянию после
  function dealEditable(ctx, id) {
    if (!id) return true;
    const d = recOf(ctx.st, 'deals', id);
    if (d) return Deals.canEdit(ctx.st, d, ctx.pid);
    const n = recOf(ctx.after, 'deals', id);
    return !!n && Deals.canEdit(ctx.after, n, ctx.pid);
  }
  const changeOf = (ctx, key, id) => ctx.list.find(x => x.key === key && String(x.id) === String(id));
  // Сделка проваливается в этой пачке
  function dealLost(ctx, id) {
    const c = changeOf(ctx, 'deals', id), b = recOf(ctx.st, 'deals', id);
    return !!c && !c.deleted && !!c.data && !!c.data.lostReason && !(b && b.lostReason);
  }
  // Поставка принимается в этой пачке: received появилось
  function received(ctx, id) {
    const c = changeOf(ctx, 'shipments', id), b = recOf(ctx.st, 'shipments', id);
    return !!c && !c.deleted && !!c.data && !!c.data.received && !(b && b.received);
  }
  const shrinks = (b, a) => !a || (changedFields(b, a).every(f => f === 'qty') && a.qty < b.qty);
  function reservesRule(ctx, c) {
    const b = ctx.before(c), a = ctx.data(c);
    if (ctx.can('reserve') && [b && b.dealId, a && a.dealId].every(id => dealEditable(ctx, id))) return null;
    if (b) {
      // провал своей видимой сделки снимает её резервы
      if (b.dealId && dealLost(ctx, b.dealId) && dealEditable(ctx, b.dealId) && shrinks(b, a)) return null;
      // продажа по резерву: резерв уменьшается вместе с «Отгрузкой» этого товара в той же пачке
      if (ctx.can('sell') && shrinks(b, a) && ctx.moves.some(m => m.kind === Stock.KINDS.ship && m.productId === b.productId)) return null;
      // приёмка: резерв «под поставку» становится резервом со склада (излишек над принятым снимается)
      if (ctx.can('receive') && b.src && b.src !== 'stock' && received(ctx, b.src)
        && (!a || (a.src === 'stock' && a.qty <= b.qty && changedFields(b, a).every(f => ['src', 'entityId', 'cityId', 'qty'].includes(f))))) return null;
    }
    return no('ставить и снимать резервы — нужно право «Ставить и снимать резервы» и право править сделку резерва');
  }

  // ——— поставки ———
  const RECEIVE_FIELDS = ['received', 'items', 'entityId', 'cityId', 'history', 'stageId', 'pos'];
  const onlyIn = (b, a, fields) => Array.isArray(b) && Array.isArray(a) && b.length === a.length
    && b.every((x, i) => changedFields(x, a[i]).every(f => fields.includes(f)));
  // Файлы записи: добавить и убрать можно свои; чужие убирает тот, кому разрешено (any)
  function filesOk(bf, af, pid, any) {
    const B = new Map((bf || []).map(f => [f.id, f])), A = new Map((af || []).map(f => [f.id, f]));
    for (const [id, f] of B) if (!A.has(id) ? !(any || f.by === pid) : !same(f, A.get(id))) return false;
    for (const [id, f] of A) if (!B.has(id) && f.by !== pid) return false;
    return true;
  }
  function shipmentsRule(ctx, c) {
    if (ctx.can('logistics')) return null;
    const b = ctx.before(c), a = ctx.data(c);
    if (b && a) {
      const ch = changedFields(b, a);
      if (ctx.can('receive') && !b.received && a.received && ch.every(f => RECEIVE_FIELDS.includes(f)) && onlyIn(b.items, a.items, ['got'])) return null;
      if (ctx.can('stock') && ch.length && ch.every(f => f === 'files') && filesOk(b.files, a.files, ctx.pid, false)) return null;
    }
    return needs('менять поставки', 'logistics');
  }

  // ——— сделки, лиды, клиенты ———
  const sees = (list, id) => list.some(x => String(x.id) === String(id));
  function dealsRule(ctx, c) {
    if (!ctx.can('dealsEdit')) return needs('заводить и править сделки', 'dealsEdit');
    if (ctx.before(c) !== undefined && !sees(Leads.dealsVisible(ctx.st, ctx.pid), c.id)) return no('править эту сделку');
    if (!c.deleted && !sees(Leads.dealsVisible(ctx.after, ctx.pid), c.id)) return no('после правки сделка не была бы вам видна');
    return null;
  }
  function leadsRule(ctx, c) {
    if (!ctx.can('leads')) return needs('вести лиды', 'leads');
    const b = ctx.before(c), a = ctx.data(c);
    if (!b) return null;
    if (!sees(Leads.visible(ctx.st, ctx.pid), c.id)) return no('править этот лид');
    if (!a) return Leads.canTransfer(ctx.st, ctx.pid) ? null : needs('удалять лиды', 'leadsAssign');
    if (!sees(Leads.visible(ctx.after, ctx.pid), c.id)) return no('после правки лид не был бы вам виден');
    if ((b.managerId || null) !== (a.managerId || null)) {
      const take = !b.managerId && a.managerId === ctx.pid && Leads.canTake(ctx.st, recOf(ctx.st, 'leads', c.id), ctx.pid);
      if (!take && !Leads.canTransfer(ctx.st, ctx.pid)) return needs('передать лид другому менеджеру', 'leadsAssign');
    }
    return null;
  }
  function clientsRule(ctx, c) {
    if (!Clients.canEdit(ctx.st, ctx.pid)) return no('заводить и править клиентов — нужны права «Видеть клиентов и сделки» и «Заводить и править сделки»');
    const b = recOf(ctx.st, 'clients', c.id);
    if (b && !Visible.client(ctx.st, b, ctx.pid)) return no('править этого клиента');
    return null;
  }

  // ——— лента и дела ———
  const REF_KEY = { deal: 'deals', lead: 'leads', client: 'clients', dispatch: 'dispatches' };
  // Писать в карточку: может комментировать её (Feed.canComment, G01) или меняет её в той же пачке (её правило проверено
  // отдельно); в ленту сделки пишет и тот, кто в этой пачке меняет её резерв (приёмка, продажа)
  function parentOk(ctx, ref) {
    if (!ref || !REF_KEY[ref.t]) return false;
    if (Feed.canComment(ctx.st, ctx.pid, ref) || Feed.canComment(ctx.after, ctx.pid, ref)) return true;
    if (changeOf(ctx, REF_KEY[ref.t], ref.id)) return true;
    return ref.t === 'deal' && ctx.list.some(x => x.key === 'reserves'
      && [(ctx.before(x) || {}).dealId, ((x.deleted ? null : x.data) || {}).dealId].includes(ref.id));
  }
  function feedRule(ctx, c) {
    if (ctx.before(c) !== undefined || c.deleted) return no('записи ленты не правят и не удаляют');
    const e = c.data || {};
    // запись о резерве (Deals.keepTrail) хранит того, кто его ставил
    if (e.by && e.by !== ctx.pid && e.kind !== 'reserve') return no('запись в ленте — только от своего имени');
    return parentOk(ctx, e.ref) ? null : no('писать в эту ленту');
  }
  function actsRule(ctx, c) {
    const b = ctx.before(c), a = ctx.data(c);
    if (!b) {
      if (!a) return null;
      if (a.by && a.by !== ctx.pid) return no('дело — только от своего имени');
      return parentOk(ctx, a.ref) ? null : no('ставить дела в эту карточку');
    }
    if (!a) return no('дела не удаляют');
    const ch = changedFields(b, a);
    // лид стал сделкой: открытые дела переезжают на неё вместе с лидом той же пачки
    if (ch.length === 1 && ch[0] === 'ref' && b.ref && b.ref.t === 'lead' && a.ref && a.ref.t === 'deal') {
      const lc = changeOf(ctx, 'leads', b.ref.id);
      if (lc && !lc.deleted && lc.data && lc.data.dealId === a.ref.id) return null;
    }
    // отметка «сделано» — кто может закрывать дела карточки (Acts.done: Feed.canComment)
    if (!b.doneAt && a.doneAt && a.doneBy === ctx.pid && ch.every(f => ['doneAt', 'doneBy', 'result'].includes(f))
      && Feed.canComment(ctx.st, ctx.pid, b.ref)) return null;
    return no('дело можно только отметить выполненным');
  }

  // ——— задачи, отправки, уведомления ———
  function targetOk(ctx, t) {
    const to = t.to || {}, me = personOf(ctx.st, ctx.pid);
    const p = to.t === 'p' ? personOf(ctx.st, to.id) : null;
    if (to.t === 'p' ? !p : !(to.t === 'd' && (ctx.st.depts || []).some(d => d.id === to.id))) return false;
    if (ctx.can('tasksAssign')) return true;
    if (to.t === 'd' ? to.id === me.dept : p.dept === me.dept) return true;
    // приёмка ставит менеджеру сделки задачу позвонить клиенту
    const d = t.deal ? recOf(ctx.st, 'deals', t.deal) : null;
    return !!d && to.t === 'p' && d.managerId === to.id && ctx.list.some(x => x.key === 'shipments' && received(ctx, x.id));
  }
  function tasksRule(ctx, c) {
    const b = ctx.before(c), a = ctx.data(c);
    const TO_TEXT = needs('ставить задачи другому отделу', 'tasksAssign');
    if (!b) {
      if (!a) return null;
      if (a.from !== ctx.pid) return no('задача — только от своего имени');
      return targetOk(ctx, a) ? null : TO_TEXT;
    }
    if (!Visible.task(ctx.st, recOf(ctx.st, 'tasks', c.id), ctx.pid)) return no('править эту задачу');
    if (!a) return b.from === ctx.pid || ctx.can('tasksAll') ? null : no('удалить задачу может её автор');
    if (a.from !== b.from) return no('автора задачи не меняют');
    return same(a.to, b.to) || targetOk(ctx, a) ? null : TO_TEXT;
  }
  function dispatchesRule(ctx, c) {
    const b = ctx.before(c), a = ctx.data(c);
    if (!b) return !a || a.by === ctx.pid ? null : no('заявка — только от своего имени');
    if (!a) return no('заявки на отправку не удаляют');
    const d = recOf(ctx.st, 'dispatches', c.id), ch = changedFields(b, a);
    if (ch.includes('stageId')) {
      const ok = a.stageId === Dispatch.ST.cancelled ? Dispatch.canCancel(ctx.st, ctx.pid, d) : Dispatch.canWork(ctx.st, ctx.pid);
      return ok ? null : needs('двигать этапы заявки', 'dispatch');
    }
    if (Dispatch.canEdit(ctx.st, ctx.pid, d)) return null;
    // продажа строки заявки: только отметка «списано» у строк
    if (ch.length === 1 && ch[0] === 'items' && Dispatch.canSell(ctx.st, ctx.pid) && onlyIn(b.items, a.items, ['sold'])) return null;
    return no('править эту заявку — автору до начала сборки или тому, кто ведёт отправки');
  }
  function notesRule(ctx, c) {
    const b = ctx.before(c), a = ctx.data(c);
    if (!b) {
      if (!a) return null;
      if (a.by && a.by !== ctx.pid) return no('уведомление — только от своего имени');
      return (a.to || []).every(id => personOf(ctx.st, id)) ? null : no('уведомление несуществующему сотруднику');
    }
    if (!a) return no('уведомления не удаляют');
    const ch = changedFields(b, a), was = new Set(b.read || []), now = new Set(a.read || []);
    const added = [...now].filter(id => !was.has(id));
    if (ch.length === 1 && ch[0] === 'read' && [...was].every(id => now.has(id)) && added.length === 1 && added[0] === ctx.pid
      && (b.to || []).includes(ctx.pid)) return null;
    return no('в уведомлении можно только отметить своё прочтение');
  }
  function prefsRule(ctx, c) {
    const b = ctx.before(c) || {}, a = ctx.data(c) || {};
    for (const f of new Set([...Object.keys(b), ...Object.keys(a)])) {
      if (f === 'notify' || f === 'sound') {
        const bf = b[f] || {}, af = a[f] || {};
        for (const k of new Set([...Object.keys(bf), ...Object.keys(af)])) if (k !== ctx.pid && !same(bf[k], af[k])) return no('менять чужие настройки уведомлений и звука');
      } else if (!same(b[f], a[f])) return no('в общих настройках можно менять только свои уведомления и звук');
    }
    return null;
  }

  const right = (r, what) => ctx => (ctx.can(r) ? null : needs(what, r));
  const SETTINGS = right('settings', 'менять настройки фирмы');
  const ADMIN = right('admin', 'менять эти данные');
  const RULES = {
    products: right('catalog', 'менять товары и каталог'),
    stock: stockRule, aside: asideRule, moves: movesRule, reserves: reservesRule, shipments: shipmentsRule,
    deals: dealsRule, leads: leadsRule, clients: clientsRule, feed: feedRule, acts: actsRule,
    tasks: tasksRule, dispatches: dispatchesRule, notes: notesRule,
    pipelines: SETTINGS, depts: SETTINGS, entities: SETTINGS, cities: SETTINGS, lostReasons: SETTINGS, shipRules: SETTINGS,
    leadSource: SETTINGS, leadWaitMin: SETTINGS,
    roles: right('admin', 'управлять ролями и правами'), people: right('admin', 'управлять сотрудниками'),
    prefs: prefsRule,
    mail: ADMIN, msgs: ADMIN, tpl: ADMIN, address: ADMIN, rules: ADMIN, stockSheet: ADMIN,
  };
  const LOCAL_TEXT = no('личное (кто я, раздел, тема) в общую базу не пишется');

  // Пачка целиком: первая запрещённая правка → {key, id, text}; всё можно → null
  function check(st, pid, changes, now) {
    const list = Array.isArray(changes) ? changes : [];
    if (!list.length) return null;
    if (!personOf(st, pid)) return { key: list[0].key, id: list[0].id, text: no('такого сотрудника нет') };
    const after = Docs.apply(st, list);
    const moves = list.filter(x => x.key === 'moves' && !x.deleted && x.data && Docs.get(st, 'moves', x.id) === undefined).map(x => x.data);
    const ctx = {
      st, after, pid, now, list, moves, exp: expected(moves),
      can: r => Perms.can(st, pid, r),
      before: x => Docs.get(st, x.key, x.id),
      data: x => (x.deleted ? null : x.data),
    };
    for (const x of list) {
      const rule = Object.hasOwn(RULES, x.key) ? RULES[x.key] : (Docs.kind(x.key) === 'LOCAL' ? () => LOCAL_TEXT : ADMIN);
      const text = rule(ctx, x);
      if (text) return { key: x.key, id: x.id, text };
    }
    return stockCovered(ctx);
  }

  return { RULES, check };
})();
