// Ядро: лиды. Чистые функции над состоянием st, время приходит параметром now (Date).
// Тип лида и менеджер определяются автоматически (классификация и распределение), дальше
// менеджер ведёт лид: взять, «связались», закрыть, создать сделку; директор и РОП передают любой лид.
// Видимость: менеджер видит лиды своего типа (роль со scope); все лиды видит и раздаёт тот, у кого право
// «Распределять и передавать лиды» (leadsAssign): директор и РОП.
// Права — Perms, воронки — Pipes, уведомления — Notify; тут их только вызывают.
// Экраны — 60-leads.js (раздел «Лиды»), 56-deals.js (сделки), 67-settings-leads.js (настройки); они зовут только это ядро.

const Leads = (() => {
  // Откуда пришёл лид и как он подписан; «phone» и «mail» — вход из телефонии и почты (схема leads).
  const SOURCE = { site: 'сайт', bitrix: 'Битрикс24', phone: 'телефон', mail: 'почта' };
  const TYPE = { b2b: 'B2B', b2c: 'B2C' };
  // Откуда принимаем лиды — выбор в «Настройки → Лиды» (st.leadSource); подписи вариантов выбора.
  const SOURCES = { bitrix: 'Битрикс24', site: 'Сайт напрямую', both: 'Оба' };
  // Этапы воронки лидов, которых касаются действия, — по id (названия можно переименовать).
  const ST_CONTACTED = 'contacted', ST_QUALIFIED = 'qualified', ST_DEAL = 'deal', ST_LOST = 'lost';
  const STAGE = { contacted: ST_CONTACTED, qualified: ST_QUALIFIED, deal: ST_DEAL, lost: ST_LOST };

  const filled = v => String(v == null ? '' : v).trim() !== '';
  const personOf = (st, id) => (st.people || []).find(p => p.id === id) || null;
  const nameOf = (st, id) => (personOf(st, id) || {}).name || 'нет данных: сотрудник';
  const scopeOf = (st, id) => { const r = Perms.roleOf(st, id); return (r && r.scope) || null; };
  const isDirector = (st, id) => { const r = Perms.roleOf(st, id); return !!(r && r.all); };
  const byId = (st, leadId) => (st.leads || []).find(l => l.id === leadId) || null;
  const pipeOf = (st, lead) => Pipes.of(st, 'leads').find(p => p.id === lead.pipeId) || null;
  const stageIn = (pipe, id) => (pipe && pipe.stages.find(s => s.id === id)) || null;
  const isOpen = (st, lead) => !Pipes.isFinal(st, lead.pipeId, lead.stageId);
  // С чего запись начинает путь по воронке: первый этап без флага
  const firstOf = pipe => pipe.stages.find(s => !s.flag) || pipe.stages[0];

  // Следующий номер вида «Л-101»: после самого большого из занятых, но не меньше min + 1.
  function nextId(list, prefix, min) {
    const re = new RegExp('^' + prefix + '-(\\d+)$');
    let n = min;
    for (const x of list || []) { const m = re.exec(String(x.id)); if (m) n = Math.max(n, +m[1]); }
    return prefix + '-' + (n + 1);
  }

  const log = (lead, now, by, text) => { lead.history.push({ at: now, by: by || null, text }); };

  // Как называть лид в тексте: компания, имя, телефон, почта — что есть.
  const title = lead => lead.company || lead.name || lead.phone || lead.email || 'нет данных: имя и контакт';

  // Тип лида по заявке: компания или ИНН → b2b; иначе телефон или почта → b2c; иначе null.
  function classify(lead) {
    if (filled(lead.company) || filled(lead.inn)) return 'b2b';
    if (filled(lead.phone) || filled(lead.email)) return 'b2c';
    return null;
  }

  // Открытые лиды менеджера (этап не final); skipId — не считать этот лид (он как раз переезжает).
  const openCount = (st, managerId, skipId) =>
    (st.leads || []).filter(l => l.managerId === managerId && l.id !== skipId && isOpen(st, l)).length;

  // Менеджеры, которым достаются лиды: у роли есть тип (scope) и право «лиды»; type — только этого типа.
  const managers = (st, type) => (st.people || []).filter(p => {
    const scope = scopeOf(st, p.id);
    return !!scope && (!type || scope === type) && Perms.can(st, p.id, 'leads');
  });

  // Менеджер типа с наименьшим числом открытых лидов; при равенстве — первый в списке людей. Нет такого — null.
  function pick(st, type, skipId) {
    if (!TYPE[type]) return null;
    let best = null, bestN = Infinity;
    for (const p of managers(st, type)) {
      const n = openCount(st, p.id, skipId);
      if (n < bestN) { best = p.id; bestN = n; }
    }
    return best;
  }

  // Кому достаётся лид: по типу заявки. Тип не определён или менеджера такого типа нет — null («Нераспределённые»).
  const route = (st, lead) => pick(st, classify(lead));

  // Новый лид: тип, менеджер, первый этап воронки лидов, история. Уведомление вида «lead» — назначенному
  // менеджеру и директору; opts.silent — без уведомления (демо-данные).
  function create(st, data, now, opts) {
    const source = data.source;
    if (!SOURCE[source]) throw new Error(`Неизвестный источник лида: ${source}`);
    const pipe = Pipes.of(st, 'leads')[0];
    if (!pipe) throw new Error('Нет воронки лидов');
    st.leads = st.leads || [];
    const lead = {
      id: nextId(st.leads, 'Л', 100), at: now, source,
      name: String(data.name || '').trim(), phone: String(data.phone || '').trim(), email: String(data.email || '').trim(),
      company: String(data.company || '').trim(), inn: String(data.inn || '').trim(), text: String(data.text || '').trim(),
      type: null, managerId: null,
      pipeId: pipe.id, stageId: firstOf(pipe).id,
      history: [], demo: !!data.demo,
    };
    lead.type = classify(lead);
    lead.managerId = route(st, lead);
    log(lead, now, null, `Лид пришёл: ${SOURCE[source]}`);
    if (lead.managerId) log(lead, now, null, `Назначен автоматически: ${nameOf(st, lead.managerId)} (${TYPE[lead.type]})`);
    else log(lead, now, null, lead.type
      ? `Нераспределённый: нет менеджера ${TYPE[lead.type]}`
      : 'Нераспределённый: нет ни компании, ни ИНН, ни телефона, ни почты');
    st.leads.push(lead);
    if (!(opts && opts.silent)) {
      const who = lead.managerId ? `менеджер — ${nameOf(st, lead.managerId)}` : 'нераспределённый';
      Notify.push(st, 'lead', null, `Новый лид ${lead.id} (${SOURCE[source]}): ${title(lead)}${lead.type ? ', ' + TYPE[lead.type] : ''}, ${who}.`, now, lead.managerId ? [lead.managerId] : []);
    }
    return lead;
  }

  // Можно ли человеку взять лид себе: лид открыт и человек его видит (право «лиды», тип не чужой),
  // лид ничей или уже его.
  function canTake(st, lead, personId) {
    if (!lead || !personOf(st, personId) || !isOpen(st, lead) || !Perms.can(st, personId, 'leads')) return false;
    if (lead.managerId && lead.managerId !== personId) return false;
    const scope = scopeOf(st, personId);
    return !(scope && lead.type && scope !== lead.type) && visible(st, personId).includes(lead);
  }

  // Взять лид себе. Нельзя: закрытый лид, чужой лид, лид чужого типа, нет права «лиды». Возвращает лид или null.
  function take(st, leadId, personId, now) {
    const lead = byId(st, leadId);
    if (!canTake(st, lead, personId)) return null;
    const me = personOf(st, personId), scope = scopeOf(st, personId);
    lead.managerId = personId;
    if (!lead.type && scope) lead.type = scope;
    log(lead, now, personId, `Взял в работу: ${me.name}`);
    return lead;
  }

  // «Связались»: этап «Связались», если лид ещё не дальше него; запись в историю в любом случае.
  function contacted(st, leadId, by, now) {
    const lead = byId(st, leadId);
    if (!lead || !personOf(st, by) || !isOpen(st, lead)) return null;
    const pipe = pipeOf(st, lead), to = stageIn(pipe, ST_CONTACTED);
    if (to && pipe.stages.indexOf(to) > pipe.stages.findIndex(s => s.id === lead.stageId)) lead.stageId = to.id;
    log(lead, now, by, 'Связались с клиентом');
    return lead;
  }

  // Закрыть лид с причиной: этап «Отказ». Без причины — нельзя. Возвращает лид или null.
  function close(st, leadId, reason, by, now) {
    const lead = byId(st, leadId), why = String(reason || '').trim();
    if (!lead || !why || !personOf(st, by) || !isOpen(st, lead)) return null;
    const to = stageIn(pipeOf(st, lead), ST_LOST);
    if (!to) return null;
    lead.stageId = to.id;
    lead.reason = why;
    log(lead, now, by, `Закрыт: ${why}`);
    return lead;
  }

  // Единственный путь смены этапа из воронки (перетаскивание карточки). Сделка создана → toDeal; Отказ →
  // close, причина обязательна (reason; воронка спрашивает её окном); остальные этапы — смена и запись в историю.
  // Двигает менеджер, который лид ведёт, или тот, кто раздаёт лиды; закрытый лид не двигается; на тот же этап — нельзя.
  // Возвращает лид или null.
  function move(st, leadId, stageId, by, now, reason) {
    const lead = byId(st, leadId), pipe = lead && pipeOf(st, lead), to = stageIn(pipe, stageId);
    if (!lead || !to || to.id === lead.stageId || !canWork(st, lead, by)) return null;
    if (to.id === ST_DEAL) return toDeal(st, leadId, by, now) ? lead : null;
    if (to.id === ST_LOST) return close(st, leadId, reason, by, now);
    if (to.flag === 'final') return null;       // прочие финальные этапы (если их добавили в настройках) вручную не ставим
    lead.stageId = to.id;
    log(lead, now, by, to.id === ST_QUALIFIED ? 'Квалифицирован' : `Этап: «${to.name}»`);
    return lead;
  }

  // Вести лид (связаться, квалифицировать, закрыть, двигать по воронке, делать сделку): тот, кто раздаёт лиды
  // (директор, РОП), или менеджер, которому лид достался, пока лид открыт и человек его видит.
  const canWork = (st, lead, personId) => !!lead && !!personOf(st, personId) && isOpen(st, lead)
    && (canTransfer(st, personId) || lead.managerId === personId) && visible(st, personId).includes(lead);

  // Что человеку можно с лидом — одним вызовом, на нём стоят кнопки карточки: {take, work, deal, transfer}.
  function can(st, leadId, personId) {
    const lead = byId(st, leadId), work = canWork(st, lead, personId);
    return {
      take: !!lead && !lead.managerId && canTake(st, lead, personId),
      work,
      deal: work && !lead.dealId && !!lead.managerId && !!(lead.type || scopeOf(st, lead.managerId)),
      transfer: !!lead && isOpen(st, lead) && canTransfer(st, personId),
    };
  }

  // Новые лиды человека (число на пункте меню): открытые, на первом этапе воронки, которые ведёт он сам;
  // тому, кто раздаёт лиды (директор, РОП), — ещё и нераспределённые.
  function fresh(st, personId) {
    return visible(st, personId).filter(l => {
      const pipe = pipeOf(st, l);
      return !!pipe && isOpen(st, l) && l.stageId === firstOf(pipe).id
        && (l.managerId === personId || (!l.managerId && canTransfer(st, personId)));
    });
  }

  // Принимаем ли лиды из этого источника: сайт и Битрикс24 включаются в настройках; телефон и почта — всегда.
  function allows(st, source) {
    if (source !== 'site' && source !== 'bitrix') return true;
    const pick = st.leadSource || 'both';
    return pick === 'both' || pick === source;
  }
  // Выбрать источник лидов (настройки). Неизвестное значение — отказ.
  function setSource(st, value) {
    if (!SOURCES[value]) return false;
    st.leadSource = value;
    return true;
  }

  // Кто может передавать лиды и видит все — право «Распределять и передавать лиды»: директор и РОП.
  const canTransfer = (st, personId) => Perms.can(st, personId, 'leadsAssign');

  // Передать лид (директор): {managerId} — конкретному менеджеру, {type} — типу (тогда менеджер по меньшей
  // загрузке, а если такого нет — «Нераспределённые» этого типа). Тип лида становится типом менеджера/выбранным.
  // Новый менеджер получает уведомление. Возвращает лид или null.
  function transfer(st, leadId, target, by, now) {
    const lead = byId(st, leadId);
    if (!lead || !canTransfer(st, by) || !isOpen(st, lead) || !target) return null;
    let text;
    if (target.managerId) {
      const m = personOf(st, target.managerId);
      if (!m || !Perms.can(st, m.id, 'leads')) return null;
      lead.managerId = m.id;
      const scope = scopeOf(st, m.id);
      if (scope) lead.type = scope;
      text = `Передан менеджеру: ${m.name}`;
    } else if (TYPE[target.type]) {
      lead.type = target.type;
      lead.managerId = pick(st, target.type, lead.id);
      text = lead.managerId
        ? `Передан типу ${TYPE[target.type]}: ${nameOf(st, lead.managerId)}`
        : `Передан типу ${TYPE[target.type]}: менеджера нет, лид нераспределённый`;
    } else return null;
    log(lead, now, by, text);
    if (lead.managerId) {
      Notify.push(st, 'lead', by, `Вам передан лид ${lead.id} (${SOURCE[lead.source]}): ${title(lead)}.`, now, [lead.managerId]);
    }
    return lead;
  }

  // Создать сделку из лида: воронка своего типа, первый этап, тот же менеджер, контакт и текст заявки. Клиент сделки —
  // уже заведённый с тем же ИНН, телефоном или почтой, иначе новый (Clients.findOrCreate); лид и сделка ссылаются на него.
  // Лид уходит в «Сделка создана» и ссылается на сделку. Возвращает id сделки; null — если нельзя
  // (лид закрыт, сделка уже есть, нет менеджера или тип неизвестен).
  function toDeal(st, leadId, by, now) {
    const lead = byId(st, leadId);
    if (!lead || lead.dealId || !personOf(st, by) || !isOpen(st, lead) || !lead.managerId) return null;
    const type = lead.type || scopeOf(st, lead.managerId);
    const pipe = type ? dealPipe(type, st) : null, done = stageIn(pipeOf(st, lead), ST_DEAL);
    if (!pipe || !done) return null;
    st.deals = st.deals || [];
    // Клиент сделки: тот же ИНН, телефон или почта — уже заведённый клиент, иначе новый (Clients.findOrCreate)
    const { client } = Clients.findOrCreate(st, {
      name: lead.company || lead.name || 'нет данных: клиент', kind: lead.company || lead.inn ? 'company' : 'person',
      inn: lead.inn, phone: lead.phone, email: lead.email, managerId: lead.managerId, demo: lead.demo,
    }, by, now);
    const d = {
      id: nextId(st.deals, 'Д', 300),
      clientId: client.id, client: client.name,
      contact: lead.name || lead.company || 'нет данных: контакт',
      kind: type === 'b2b' ? 'Компания' : 'Частный клиент',
      object: lead.text || 'нет данных: текст заявки',
      type, pipeId: pipe.id, stageId: firstOf(pipe).id,
      managerId: lead.managerId,
      // мессенджер клиента из лида неизвестен — связь по телефону; телефон и почта едут в сделку как есть
      channel: 'phone', amount: 0, phone: lead.phone, email: lead.email,
      items: [], at: now, leadId: lead.id, demo: lead.demo,
    };
    st.deals.push(d);
    Feed.add(st, { t: 'deal', id: d.id }, { kind: 'create', text: `Сделка создана из лида ${lead.id}`, by, at: now });
    lead.type = type;
    lead.stageId = done.id;
    lead.dealId = d.id;
    lead.clientId = client.id;
    log(lead, now, by, `Создана сделка ${d.id}`);
    return d.id;
  }

  // Лиды, которые видит человек. Нет права «лиды» — никаких. Кто раздаёт лиды (директор, РОП) — все. Менеджер —
  // лиды своего типа и свои. Лид без типа и без менеджера («Нераспределённый» без данных) — только тем, кто раздаёт.
  function visible(st, personId) {
    if (!Perms.can(st, personId, 'leads')) return [];
    const all = st.leads || [];
    if (canTransfer(st, personId)) return all.slice();
    const scope = scopeOf(st, personId);
    return all.filter(l => l.managerId === personId || (!!scope && l.type === scope));
  }

  // Сделки, которые видит человек: нужно право «клиенты»; директор и право «все типы» — все;
  // менеджер — сделки своего типа и свои.
  function dealsVisible(st, personId) {
    if (!Perms.can(st, personId, 'clients')) return [];
    const all = st.deals || [];
    if (isDirector(st, personId) || Perms.can(st, personId, 'dealsAll')) return all.slice();
    const scope = scopeOf(st, personId);
    return all.filter(d => d.managerId === personId || (!!scope && d.type === scope));
  }

  return { SOURCE, SOURCES, TYPE, STAGE, nextId, firstOf, title, managers, classify, route, pick, openCount, create, canTake, take, contacted, close, move, canWork, can, fresh, allows, setSource, canTransfer, transfer, toDeal, visible, dealsVisible };
})();

// Шаг SEEDS: роль РОП и демо-человек с этой ролью. РОП распределяет лиды (право leadsAssign) и сам лидов не получает:
// у роли нет типа (scope), поэтому Leads.route и Leads.pick его не выбирают. Шаг стоит до лидов — чтобы человек уже был в команде.
SEEDS.push(st => {
  const on = ['leads', 'leadsAssign', 'dealsAll', 'clients', 'stock', 'prices', 'reserve', 'write', 'mail'];
  st.roles.push({ id: 'rop', name: 'РОП (руководитель отдела продаж)', builtin: true, perms: Object.fromEntries(Perms.LIST.map(([k]) => [k, on.includes(k)])) });
  st.people.push({ id: Store.freeId(st.people, 'p'), name: 'Елена Г.', role: 'rop', dept: 'sales', demo: true });
});

// Шаг SEEDS: источник лидов и 24 демо-лида. Всё помечено «пример» (demo:true и слово в имени/компании),
// телефоны вида +7 900 000-00-NN, почта на example.com — настоящих людей и компаний тут нет.
// Лиды заводятся теми же функциями, что и в работе (create, contacted, close, toDeal), но без уведомлений:
// менеджера выбирает route, поэтому «Нераспределённые» — лиды без компании и контакта.
SEEDS.push(st => {
  st.leadSource = 'both';
  st.leads = [];
  const pad = (n, w) => String(n).padStart(w, '0');
  const COMPANIES = ['ООО „Пример-Строй“', 'ИП Пример-Агро', 'КФХ „Пример“', 'ООО „Пример-Сервис“', 'АО „Пример-Энерго“', 'ООО „Пример-Склад“', 'ООО „Пример-Дом“', 'ООО „Пример-Транс“'];
  const TEXTS = {
    b2b: ['Пример заявки: нужна станция для объекта компании, просим рассчитать и прислать КП.', 'Пример заявки: интересует сетевая станция на кровлю, просим связаться по телефону.', 'Пример заявки: нужен расчёт по резервному питанию для склада.'],
    b2c: ['Пример заявки: интересует станция для дома, просьба перезвонить.', 'Пример заявки: хочу узнать, что нужно для автономного питания на даче.', 'Пример заявки: нужен расчёт ветро-солнечной станции для участка.'],
    none: ['Пример заявки: клиент не оставил ни телефона, ни почты, назвал только имя.'],
  };
  const REASONS = ['Пример причины: клиент выбрал другого поставщика', 'Пример причины: не вышли на связь', 'Пример причины: передумал покупать'];
  // [дней назад, час, источник, что указал клиент, где лид сейчас]
  // что указал: B — компания и телефон, BI — компания, ИНН и почта, I — только ИНН, P — телефон, E — почта,
  // PE — телефон и почта, N — ничего
  const ROWS = [
    [14, 10, 'site', 'B', 'lost'], [13, 11, 'bitrix', 'P', 'lost'], [12, 9, 'site', 'I', 'contacted'], [12, 14, 'bitrix', 'PE', 'deal'],
    [11, 10, 'site', 'E', 'contacted'], [10, 12, 'bitrix', 'B', 'qualified'], [9, 9, 'site', 'P', 'qualified'], [9, 15, 'bitrix', 'BI', 'deal'],
    [8, 11, 'site', 'P', 'lost'], [7, 10, 'bitrix', 'E', 'contacted'], [7, 13, 'site', 'N', 'new'], [6, 12, 'bitrix', 'P', 'qualified'],
    [5, 9, 'site', 'B', 'contacted'], [5, 16, 'bitrix', 'PE', 'new'], [4, 10, 'site', 'I', 'new'], [4, 14, 'bitrix', 'N', 'new'],
    [3, 9, 'site', 'P', 'deal'], [3, 13, 'bitrix', 'B', 'lost'], [2, 11, 'site', 'E', 'new'], [2, 15, 'bitrix', 'P', 'new'],
    [1, 10, 'site', 'BI', 'qualified'], [1, 14, 'bitrix', 'N', 'new'], [0, 7, 'site', 'P', 'new'], [0, 8, 'bitrix', 'N', 'new'],
  ];
  ROWS.forEach(([back, h, source, kind, stage], i) => {
    const k = i + 1, at = day(-back, h, 0), later = n => day(-back, h + n, 0);
    const data = { source, demo: true, name: `Клиент-пример ${k}` };
    if (kind === 'B' || kind === 'BI') { data.company = COMPANIES[k % COMPANIES.length]; data.name = `Контакт-пример ${k}`; }
    if (kind === 'B' || kind === 'P' || kind === 'PE') data.phone = `+7 900 000-00-${pad(k, 2)}`;
    if (kind === 'BI' || kind === 'E' || kind === 'PE') data.email = `primer${k}@example.com`;
    if (kind === 'BI' || kind === 'I') data.inn = `0000000${pad(k, 3)}`;
    const group = kind === 'N' ? 'none' : kind[0] === 'B' || kind === 'I' ? 'b2b' : 'b2c';
    data.text = TEXTS[group][k % TEXTS[group].length];
    const lead = Leads.create(st, data, at, { silent: true });
    const m = lead.managerId;
    if (stage !== 'new') Leads.contacted(st, lead.id, m, later(1));
    if (stage === 'qualified' || stage === 'deal') Leads.move(st, lead.id, 'qualified', m, later(2));
    if (stage === 'deal') Leads.toDeal(st, lead.id, m, later(3));
    if (stage === 'lost') Leads.close(st, lead.id, REASONS[k % REASONS.length], m, later(2));
  });
});
