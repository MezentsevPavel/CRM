// Ядро: дела — следующий шаг по лиду, сделке и клиенту. Звонок, встреча, письмо или просто дело со сроком, ответственным
// и напоминанием; выполняют его с результатом. Лента (Feed.of) подмешивает выполненные дела сама, открытые дела показывает
// feedHtml над лентой, метки «нет следующего шага» и счётчики меню берутся отсюда же.
// Чистые функции над состоянием st; время приходит параметром now (Date), кто делает — by (id сотрудника).
// Дело: {id, ref:{t,id}, type, title, due, ownerId, by, at, remind (минут до срока или null), remindedAt?, doneAt?, doneBy?, result?}.
// Дело считается «живым», пока жива его карточка: лид не закрыт, сделка не провалена и не закрыта успешно. Дела закрытых
// карточек не попадают ни в счётчики, ни в «нет следующего шага», ни в напоминания: гасить их по одному никто не обязан.

const Acts = (() => {
  const TYPES = { call: 'Звонок', meet: 'Встреча', mail: 'Письмо', todo: 'Дело' };
  // За сколько минут до срока напомнить: [минуты, подпись]; null — не напоминать.
  const REMINDS = [[null, 'Не напоминать'], [0, 'В срок'], [15, 'За 15 минут'], [60, 'За час'], [1440, 'За день']];
  // Быстрые сроки в форме
  const QUICK = { today: 'Сегодня', tomorrow: 'Завтра', week: 'Через неделю' };
  // Карточки, к которым ставят дела
  const REFS = ['deal', 'lead', 'client'];
  const MISSING = { type: 'вид дела', due: 'срок' };

  const str = v => String(v == null ? '' : v).trim();
  const time = v => { const n = v == null || v === '' ? NaN : new Date(v).getTime(); return isNaN(n) ? null : n; };
  const same = (a, b) => !!a && !!b && a.t === b.t && a.id === b.id;
  const fail = (reason, extra) => Object.assign({ ok: false, reason }, extra);
  const personOf = (st, id) => (st.people || []).find(p => p.id === id) || null;
  const all = st => st.acts || [];
  const byId = (st, id) => all(st).find(a => a.id === id) || null;

  // ——— карточка, к которой привязано дело ———
  // Живая ли карточка: лид не в финале, сделка открыта, клиент есть. Нет карточки — не жива.
  function alive(st, ref) {
    if (!ref) return false;
    if (ref.t === 'deal') { const d = (st.deals || []).find(x => x.id === ref.id); return !!d && Deals.state(st, d) === 'open'; }
    if (ref.t === 'lead') { const l = (st.leads || []).find(x => x.id === ref.id); return !!l && !Pipes.isFinal(st, l.pipeId, l.stageId); }
    if (ref.t === 'client') return !!Clients.byId(st, ref.id);
    return false;
  }
  // Как назвать карточку в тексте: «Сделка Д-311 (ООО …)».
  function refTitle(st, ref) {
    let name = '';
    if (ref.t === 'deal') name = ((st.deals || []).find(x => x.id === ref.id) || {}).client;
    else if (ref.t === 'lead') { const l = (st.leads || []).find(x => x.id === ref.id); name = l ? Leads.title(l) : ''; }
    else if (ref.t === 'client') name = (Clients.byId(st, ref.id) || {}).name;
    return `${Feed.REF[ref.t] || 'Карточка'} ${ref.id}${name ? ` (${name})` : ''}`;
  }
  // Карточки, чьи дела видны в этой: у клиента — ещё его сделки и лиды (те, что видит personId), как в его ленте.
  function refs(st, ref, personId) {
    const out = [ref];
    if (ref.t === 'client') {
      const rel = Clients.related(st, ref.id, personId);
      rel.deals.forEach(d => out.push({ t: 'deal', id: d.id }));
      rel.leads.forEach(l => out.push({ t: 'lead', id: l.id }));
    }
    return out;
  }

  // ——— срок и напоминание ———
  const label = a => `${TYPES[a.type].toLowerCase()} · ${fWhen(a.due)}`;
  // Быстрые сроки от now: «сегодня» — 18:00 (а если до него меньше 15 минут — через час, но не позже конца дня),
  // «завтра» и «через неделю» — в 10:00.
  function quick(kind, now) {
    const n = new Date(now);
    const at = (add, h, m = 0) => { const d = new Date(n); d.setDate(d.getDate() + add); d.setHours(h, m, 0, 0); return d; };
    if (kind === 'tomorrow') return at(1, 10);
    if (kind === 'week') return at(7, 10);
    let d = at(0, 18);
    if (d.getTime() < n.getTime() + 15 * 6e4) { d = new Date(n.getTime() + 60 * 6e4); d.setSeconds(0, 0); }
    if (d.getDate() !== n.getDate()) d = at(0, 23, 59);
    return d;
  }

  // ——— поставить и выполнить ———
  // Новое дело: {type, title?, due, ownerId?, remind?}. Без вида или срока — {ok:false, missing:[…]}. Без названия — название
  // вида («Звонок»). Ответственный по умолчанию — тот, кто ставит; и он, и тот, кто ставит, должны видеть карточку (Feed.canComment).
  // remind — за сколько минут до срока напомнить; пусто — не напоминать. → {ok, id, act, missing, reason}
  function plan(st, ref, data, by, now) {
    const d = data || {}, missing = [];
    if (!TYPES[d.type]) missing.push('type');
    const due = time(d.due);
    if (due === null) missing.push('due');
    if (missing.length) return fail(`Не заполнено: ${missing.map(k => MISSING[k]).join(', ')}.`, { id: null, act: null, missing });
    const none = { id: null, act: null, missing: [] };
    if (!ref || !REFS.includes(ref.t) || !alive(st, ref)) return fail('Такой карточки нет или она закрыта — дело поставить некуда.', none);
    if (!Feed.canComment(st, by, ref)) return fail('У вас нет права ставить дела в эту карточку.', none);
    const ownerId = d.ownerId || by;
    if (!personOf(st, ownerId)) return fail('Такого сотрудника нет.', none);
    if (!Feed.canComment(st, ownerId, ref)) return fail('Этот сотрудник не видит карточку — поставить ему дело нельзя.', none);
    let remind = null;
    if (d.remind !== undefined && d.remind !== null && d.remind !== '' && d.remind !== false) {
      remind = d.remind === true ? 0 : Math.round(Number(d.remind));
      if (!(remind >= 0) || !isFinite(remind)) return fail('Напоминание — число минут до срока.', none);
    }
    st.acts = st.acts || [];
    const a = {
      id: Store.freeId(st.acts, 'a'), ref: { t: ref.t, id: ref.id }, type: d.type, title: str(d.title) || TYPES[d.type],
      due: new Date(due), ownerId, by: by || null, at: now, remind,
    };
    st.acts.push(a);
    return { ok: true, id: a.id, act: a, missing: [], reason: '' };
  }

  // Выполнить дело с результатом: без результата — отказ (дело выполняют с результатом). Выполненное не правится и не
  // выполняется второй раз. Запись появляется в ленте карточки (Feed.of). → {ok, act, reason}
  function done(st, id, result, by, now) {
    const a = byId(st, id);
    if (!a) return fail('Такого дела нет.', { act: null });
    if (a.doneAt) return fail('Дело уже выполнено.', { act: a });
    const res = str(result);
    if (!res) return fail('Напишите результат: что получилось.', { act: a });
    if (!Feed.canComment(st, by, a.ref)) return fail('У вас нет права закрывать дела этой карточки.', { act: a });
    a.doneAt = now;
    a.doneBy = by || null;
    a.result = res;
    return { ok: true, act: a, reason: '' };
  }
  // Фраза о выполненном деле — одна на ленту и на что угодно ещё.
  const doneText = a => `${TYPES[a.type]} «${a.title}», срок ${fWhen(a.due)}. Результат: ${a.result}`;

  // ——— выборки ———
  const byDue = (a, b) => time(a.due) - time(b.due);
  // Открытые дела карточки, ближайшее первым. У клиента — и дела его сделок и лидов (personId — чьими глазами).
  function open(st, ref, personId) {
    const rs = refs(st, ref, personId);
    return all(st).filter(a => !a.doneAt && rs.some(r => same(r, a.ref))).sort(byDue);
  }
  // Перенести открытые дела с одной карточки на другую (лид стал сделкой): меняется ref, в ленту новой карточки — одна запись
  // со списком. Выполненные дела остаются где были. → [перенесённые дела, ближайшее первым]
  function moveOpen(st, from, to, by, now) {
    const moved = all(st).filter(a => !a.doneAt && same(a.ref, from)).sort(byDue);
    if (!moved.length) return [];
    moved.forEach(a => { a.ref = { t: to.t, id: to.id }; });
    Feed.add(st, to, { kind: 'actmove', by, at: now, text: `Из ${(Feed.REF[from.t] || 'карточки').toLowerCase()} ${from.id} перенесены открытые дела (${moved.length}): ${moved.map(a => `${label(a)} «${a.title}»`).join('; ')}.` });
    return moved;
  }
  // Ближайшее открытое дело или null.
  const next = (st, ref, personId) => open(st, ref, personId)[0] || null;
  // «Нет следующего шага»: карточка жива, а открытых дел у неё нет.
  const noNext = (st, ref) => alive(st, ref) && open(st, ref).length === 0;
  // Есть ли у живой карточки просроченное открытое дело.
  const overdue = (st, ref, now) => {
    const t = time(now);
    return alive(st, ref) && t !== null && open(st, ref).some(a => time(a.due) < t);
  };
  // Подходит ли карточка под фильтр экрана: 'none' — без дел, 'overdue' — просрочены дела.
  const matches = (st, ref, mode, now) => (mode === 'none' ? noNext(st, ref) : mode === 'overdue' ? overdue(st, ref, now) : true);

  // Мои дела: сколько на сегодня (срок ещё впереди, но сегодня) и сколько просрочено (срок прошёл, now — сейчас).
  // Только открытые дела живых карточек, где человек — ответственный. type ('deal' | 'lead' | 'client') — только дела таких карточек.
  function counts(st, personId, now, type) {
    const t = time(now), out = { today: 0, overdue: 0 };
    if (t === null) return out;
    const end = new Date(t); end.setHours(24, 0, 0, 0);
    for (const a of all(st)) {
      if (a.doneAt || a.ownerId !== personId || (type && a.ref.t !== type) || !alive(st, a.ref)) continue;
      const d = time(a.due);
      if (d < t) out.overdue++; else if (d < end.getTime()) out.today++;
    }
    return out;
  }

  // ——— напоминания ———
  // Дела, которым пора напомнить: открытые, живой карточки, с напоминанием, срок минус remind уже наступил, а напоминание
  // ещё не уходило (remindedAt нет).
  function due(st, now) {
    const t = time(now);
    if (t === null) return [];
    return all(st).filter(a => !a.doneAt && !a.remindedAt && a.remind !== null && a.remind !== undefined
      && time(a.due) - a.remind * 6e4 <= t && alive(st, a.ref));
  }
  // Разослать напоминания: каждому делу — одно уведомление «act» его ответственному, дело помечается remindedAt.
  // Вторая проверка в ту же минуту ничего не шлёт. → [уведомление…]
  function notify(st, now) {
    return due(st, now).map(a => {
      a.remindedAt = now;
      return Notify.push(st, 'act', null, `Пора: ${label(a)} — «${a.title}». ${refTitle(st, a.ref)}.`, now, [a.ownerId]);
    });
  }

  return { TYPES, REMINDS, QUICK, REFS, byId, alive, refTitle, label, quick, plan, done, doneText, moveOpen, open, next, noNext, overdue, matches, counts, due, notify };
})();

// Вид уведомления «Дела» в «Уведомления»: подпись и значок (список видов — KIND в 20-model.js)
KIND.act = { l: 'Дела', ic: 'clock', c: 'sun' };

// Шаг SEEDS: демо-дела. У открытых сделок и лидов — открытые дела: часть просрочена, часть на сегодня, часть на завтра и
// дальше, у части — ни одного («нет следующего шага»); у части сделок есть и выполненные дела с результатом. Ответственный —
// менеджер карточки, а каждое четвёртое дело — тот, кто сейчас в системе (st.me), чтобы счётчики не были пустыми.
// Всё помечено «пример». Напоминаний у демо-дел нет: при первом запуске в уведомления ничего не сыплется.
SEEDS.push(st => {
  st.acts = [];
  const TITLES = {
    call: ['Перезвонить по расчёту', 'Уточнить сроки по поставке', 'Согласовать время замера'],
    meet: ['Встреча на объекте', 'Показать КП в офисе'],
    mail: ['Отправить КП на почту', 'Выслать схему подключения'],
    todo: ['Подготовить договор', 'Собрать данные для расчёта'],
  };
  // шаблоны по кругу: [вид, срок: дней от сегодня, час, ещё одно дело: вид, дни, час]
  const PAT = [
    [['call', -1, 11]],
    [['meet', 0, 17]],
    [['mail', 1, 10]],
    [],
    [['todo', 5, 12], ['call', 0, 18]],
    [['meet', -3, 14], ['call', 1, 15]],
  ];
  const pick = (kind, k) => `${TITLES[kind][k % TITLES[kind].length]} (пример)`;
  const seedFor = (ref, managerId, created, k) => {
    for (const [j, [kind, add, hour]] of PAT[k % PAT.length].entries()) {
      const owner = (k + j) % 4 === 0 ? st.me : managerId;
      if (!owner) continue;
      Acts.plan(st, ref, { type: kind, title: pick(kind, k + j), due: day(add, hour, 0), ownerId: owner }, owner, created);
    }
    // выполненное дело: каждой третьей карточке, не там, где дел нет совсем
    if (k % 3 === 0 && managerId && PAT[k % PAT.length].length) {
      const r = Acts.plan(st, ref, { type: 'call', title: 'Первый звонок клиенту (пример)', due: day(-2, 11, 0), ownerId: managerId }, managerId, created);
      if (r.ok) Acts.done(st, r.id, 'Пример: дозвонились, клиент ждёт расчёт.', managerId, day(-2, 12, 0));
    }
  };
  st.deals.filter(d => Deals.state(st, d) === 'open').forEach((d, k) => seedFor({ t: 'deal', id: d.id }, d.managerId, d.at || day(-3, 9, 0), k));
  st.leads.filter(l => !Pipes.isFinal(st, l.pipeId, l.stageId)).forEach((l, k) => seedFor({ t: 'lead', id: l.id }, l.managerId, l.at || day(-3, 9, 0), k));
});
