// Ядро и вид: одна лента для всех карточек — сделка, лид, клиент, отправка. Комментарии и события, новые сверху.
// Лента хранит только свои записи (st.feed); остальное подмешивает of(): историю лида, резервы по сделке,
// сообщения клиенту, а у клиента — ленты его сделок и лидов; у сделки — ленты её отправок. Дела (T10) и отправки (T07) пишут сюда же.
// Чистые функции над состоянием st; время приходит параметром. Вид feedHtml не меняет состояние.

const Feed = (() => {
  // Виды записей и подписи. Модули дел и отправок добавляют свои виды сюда же: Feed.KINDS.act = 'Дело'.
  const KINDS = {
    comment: 'Комментарий', create: 'Создано', stage: 'Этап', field: 'Изменение', item: 'Товары',
    reserve: 'Резерв', win: 'Успешно', lose: 'Провалена', msg: 'Сообщение клиенту', history: 'История', act: 'Дело выполнено', actmove: 'Дела из лида',
    dispatch: 'Отправка',
  };
  // Что есть ссылка на карточку и как её назвать в ленте клиента.
  const REF = { deal: 'Сделка', lead: 'Лид', client: 'Клиент', dispatch: 'Отправка' };

  const same = (a, b) => !!a && !!b && a.t === b.t && a.id === b.id;
  const time = at => { const n = at == null ? NaN : new Date(at).getTime(); return isNaN(n) ? null : n; };
  const nameOf = (st, id) => ((st.products || []).find(p => p.id === id) || {}).name || 'нет данных: товар';

  // Запись в ленту ref = {t:'deal'|'lead'|'client'|'dispatch', id}: {kind, text, by, at, data?}.
  // Без ссылки, текста или времени записи не будет (null). Новая запись — в конец st.feed; порядок показа решает of().
  function add(st, ref, { kind, text, by, at, data } = {}) {
    const t = String(text == null ? '' : text).trim();
    if (!ref || !REF[ref.t] || !ref.id || !t || time(at) === null) return null;
    st.feed = st.feed || [];
    const e = { id: Store.freeId(st.feed, 'f'), ref: { t: ref.t, id: ref.id }, at, by: by || null, kind: kind || 'comment', text: t };
    if (data !== undefined) e.data = data;
    st.feed.push(e);
    return e;
  }

  // Где резерв и до какого числа: «со склада (ИП, Иркутск)» или «из поставки П-1043». Единственная фраза о резерве:
  // её читают лента сделки, уведомление складу и карточка. withDeal — добавить «для Д-311 (клиент)».
  function reserveText(st, r, withDeal) {
    const where = r.src === 'stock' || !r.src
      ? `со склада (${Stock.entityName(st, r.entityId || Stock.ANY) ?? r.entityId}, ${Stock.cityName(st, r.cityId || Stock.ANY) ?? r.cityId})`
      : `из поставки ${r.src}`;
    const d = withDeal ? (st.deals || []).find(x => x.id === r.dealId) : null;
    const forDeal = d ? ` для ${d.id} (${d.client})` : '';
    return `Резерв: ${low(nameOf(st, r.productId))} — ${num(r.qty)} ${where}${forDeal}${r.until ? ' до ' + fD(r.until) : ''}.`;
  }

  // Когда и кем поставлен резерв: своя отметка (at, by), иначе запись «Резерв» в журнале движений по той же сделке.
  function reserveWhen(st, r) {
    if (time(r.at) !== null) return { at: r.at, by: r.by || null };
    const m = (st.moves || []).find(x => x.kind === Stock.KINDS.reserve && x.doc === r.dealId && x.productId === r.productId && x.qty === r.qty);
    return m ? { at: m.at, by: m.by || null } : { at: null, by: null };
  }

  // Записи, которые лента подмешивает сама, по виду карточки. Каждая — как запись ленты со своей ссылкой ref.
  function synthetic(st, ref, own) {
    const out = [];
    if (ref.t === 'lead') {
      const l = (st.leads || []).find(x => x.id === ref.id);
      ((l && l.history) || []).forEach((h, i) => out.push({ id: `h:${ref.id}:${i}`, ref, at: h.at, by: h.by || null, kind: 'history', text: h.text }));
    }
    // выполненные дела карточки: серые записи, пишутся в момент выполнения (Acts.done), здесь только показываются
    for (const a of st.acts || []) {
      if (!a.doneAt || a.ref.t !== ref.t || a.ref.id !== ref.id) continue;
      out.push({ id: `a:${a.id}`, ref, at: a.doneAt, by: a.doneBy || null, kind: 'act', text: Acts.doneText(a), data: { actId: a.id, type: a.type, ownerId: a.ownerId } });
    }
    if (ref.t === 'deal') {
      const done = new Set(own.filter(e => e.data && e.data.reserveId).map(e => e.data.reserveId));
      for (const r of st.reserves || []) {
        if (r.dealId !== ref.id || done.has(r.id)) continue;
        const w = reserveWhen(st, r);
        out.push({ id: `r:${r.id}`, ref, at: w.at, by: w.by, kind: 'reserve', text: reserveText(st, r), data: { reserveId: r.id, productId: r.productId, qty: r.qty } });
      }
      for (const m of st.msgs || []) {
        if (m.deal !== ref.id) continue;
        out.push({ id: `m:${m.id}`, ref, at: m.at, by: m.by || null, kind: 'msg', text: m.text, data: { channel: m.channel, inbound: !!m.inbound, auto: !!m.auto } });
      }
    }
    return out;
  }

  // Лента карточки: записи по времени, новые сверху (при одинаковом времени — позже добавленные выше); без времени — в конце.
  // personId (необязательно) — у клиента подмешиваются только сделки и лиды, которые этот человек видит.
  function of(st, ref, personId) {
    const all = [];
    const take = (r, wrap) => {
      const own = (st.feed || []).filter(e => same(e.ref, r));
      own.forEach(e => all.push(wrap ? wrap(e) : e));
      synthetic(st, r, own).forEach(e => all.push(wrap ? wrap(e) : e));
    };
    take(ref);
    // у сделки — ещё ленты её отправок (заявки с этим dealId), с подписью «Отправка ОТ-NNN». Их записи идут видом 'dispatch'
    // (прежний вид — в data.was), чтобы этапы заявки не путались с этапами самой сделки.
    const asDispatch = e => ({ ...e, kind: 'dispatch', data: { ...(e.data || {}), was: e.kind } });
    if (ref.t === 'deal') (st.dispatches || []).filter(d => d.dealId === ref.id).forEach(d => take({ t: 'dispatch', id: d.id }, asDispatch));
    if (ref.t === 'client') {
      const rel = Clients.related(st, ref.id, personId);
      rel.deals.forEach(d => take({ t: 'deal', id: d.id }));
      rel.leads.forEach(l => take({ t: 'lead', id: l.id }));
    }
    return all.map((e, i) => ({ e, i, t: time(e.at) }))
      .sort((a, b) => (a.t === null) - (b.t === null) || (b.t - a.t) || (b.i - a.i))
      .map(x => ({ ...x.e }));
  }

  // Кто может писать в ленту карточки: сделка и клиент — право «клиенты» (сделку человек должен видеть), лид — «лиды»
  // (и видеть лид), отправка — Dispatch.canComment: любой сотрудник (раздел видят все).
  function canComment(st, personId, ref) {
    if (!ref || !(st.people || []).some(p => p.id === personId)) return false;
    if (ref.t === 'deal') return Leads.dealsVisible(st, personId).some(d => d.id === ref.id);
    if (ref.t === 'lead') return Leads.visible(st, personId).some(l => l.id === ref.id);
    if (ref.t === 'client') return Perms.can(st, personId, 'clients');
    if (ref.t === 'dispatch') return Dispatch.canComment(st, personId, Dispatch.byId(st, ref.id));
    return false;
  }

  // Комментарий в ленту: пустой текст и чужая карточка — отказ с причиной. → {ok, entry, reason}
  function comment(st, ref, text, by, now) {
    if (!String(text == null ? '' : text).trim()) return { ok: false, entry: null, reason: 'Напишите комментарий.' };
    if (!canComment(st, by, ref)) return { ok: false, entry: null, reason: 'У вас нет права писать в эту ленту.' };
    const entry = add(st, ref, { kind: 'comment', text, by, at: now });
    return entry ? { ok: true, entry, reason: '' } : { ok: false, entry: null, reason: 'Не удалось записать комментарий.' };
  }

  return { KINDS, REF, add, of, reserveText, reserveWhen, canComment, comment };
})();

// ——— вид ———
// Лента карточки: «Запланировать» сверху, открытые дела над лентой (ближайшее первым, просроченные красным),
// поле «Комментарий» и сама лента, новые записи сверху. Один вид для лида, сделки, клиента и отправки. Не меняет состояние.
// st по умолчанию — S; видит человек st.me; now — для «просрочено» (по умолчанию сейчас).
// Класс feed-add / data-form="feed-comment" — форма комментария (feedCommentForm), data-form="act-plan" — форма дела (feedWire).

Object.assign(IC,{phone:'<path d="M6.5 3.5h3l1.5 4-2 1.3a10 10 0 0 0 5.2 5.2l1.3-2 4 1.5v3a2 2 0 0 1-2.2 2A15.5 15.5 0 0 1 4.5 5.7 2 2 0 0 1 6.5 3.5z"/>'});
// Значок вида дела
const ACT_IC = { call: 'phone', meet: 'users', mail: 'mail', todo: 'tasks' };
// Дата и время для поля datetime-local: «2026-11-02T10:00»
const actInput = d => iso(d) + 'T' + fT(d);
// Число на пункте меню: мои дела на сегодня и просроченные по карточкам этого вида ('deal' | 'lead'); считает Acts.counts
const actsBadge = type => { const c = Acts.counts(S, S.me, new Date(), type); return c.today + c.overdue; };
const actWho = (st, id) => ((st.people || []).find(p => p.id === id) || {}).name || 'нет данных: сотрудник';

// Форма «Запланировать»: вид, название, срок (быстрые кнопки и поле даты со временем), ответственный (по умолчанию я), напоминание
function actPlanHtml(ref, st, now) {
  const me = st.me, people = (st.people || []).filter(p => Feed.canComment(st, p.id, ref));
  return `<details class="act-plan"><summary class="btn">${ic('plus')}Запланировать дело</summary>
    <form class="act-form" data-form="act-plan" data-t="${esc(ref.t)}" data-id="${esc(ref.id)}" novalidate>
      <div class="field"><label for="act-type">Что</label><select id="act-type" class="inp">${Object.entries(Acts.TYPES).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></div>
      <div class="field"><label for="act-title">Название</label><input id="act-title" class="inp" placeholder="Например: перезвонить по расчёту" autocomplete="off"></div>
      <div class="field"><label for="act-due">Срок</label><input id="act-due" class="inp" type="datetime-local" value="${esc(actInput(Acts.quick('tomorrow', now)))}"><div class="act-q">${Object.entries(Acts.QUICK).map(([k, l]) => `<button type="button" class="fchip" data-act="act-quick" data-q="${k}">${esc(l)}</button>`).join('')}</div></div>
      <div class="field"><label for="act-owner">Ответственный</label><select id="act-owner" class="inp">${people.map(p => `<option value="${esc(p.id)}"${p.id === me ? ' selected' : ''}>${esc(p.name)}${p.id === me ? ' (я)' : ''}</option>`).join('')}</select></div>
      <div class="field"><label for="act-remind">Напомнить</label><select id="act-remind" class="inp">${Acts.REMINDS.map(([v, l]) => `<option value="${v === null ? '' : v}"${v === 0 ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      <p class="err" id="act-err" hidden></p>
      <button class="btn pri" type="submit">${ic('check')}Запланировать</button>
    </form></details>`;
}

// Открытые дела: ближайшее первым; просроченное — красным и словом «просрочено»; дел нет — «Нет следующего шага»
function actListHtml(ref, st, now) {
  const list = Acts.open(st, ref, st.me), t = now.getTime();
  if (!list.length) return Acts.noNext(st, ref) ? `<p class="act-empty">${ic('alert')}Нет следующего шага. Запланируйте звонок, встречу или дело.</p>` : '';
  return `<ul class="act-list" aria-label="Открытые дела">${list.map(a => {
    const over = new Date(a.due).getTime() < t;
    const from = a.ref.t !== ref.t || a.ref.id !== ref.id ? `<span class="pill sm">${esc((Feed.REF[a.ref.t] || '') + ' ' + a.ref.id)}</span>` : '';
    return `<li class="act-i k-${esc(a.type)}${over ? ' over' : ''}"><span class="act-ic">${ic(ACT_IC[a.type] || 'tasks')}</span><div class="act-b"><b class="act-t">${esc(a.title)}</b><small>${esc(Acts.TYPES[a.type] || 'Дело')} · ${over ? '<span class="act-late">просрочено</span> · ' : ''}${esc(fWhen(a.due))} · ${esc(actWho(st, a.ownerId))}</small>${from}</div>${Feed.canComment(st, st.me, a.ref) ? `<button type="button" class="btn sm" data-act="act-done" data-id="${esc(a.id)}">${ic('check')}Выполнено</button>` : ''}</li>`;
  }).join('')}</ul>`;
}

// Метка на карточке канбана и в списке: ближайшее дело («звонок · завтра, 10:00») или «нет следующего шага».
// У закрытой карточки метки нет. Просроченное — красным и словом «просрочено».
function actNextHtml(ref, st = S, now = new Date()) {
  if (!Acts.alive(st, ref)) return '';
  const a = Acts.next(st, ref);
  if (!a) return `<span class="pill sm warn act-nx none">${ic('alert')}нет следующего шага</span>`;
  const over = new Date(a.due).getTime() < now.getTime();
  return `<span class="act-nx${over ? ' over' : ''}" title="${esc(a.title)}">${ic(ACT_IC[a.type] || 'tasks')}<span>${esc(Acts.label(a))}${over ? ' · просрочено' : ''}</span></span>`;
}

function feedHtml(ref, st = S, now = new Date()) {
  const me = st.me, who = id => (st.people || []).find(p => p.id === id);
  const kindLabel = e => e.kind === 'msg' && e.data && e.data.inbound ? 'Сообщение от клиента' : (Feed.KINDS[e.kind === 'dispatch' && e.data && e.data.was ? e.data.was : e.kind] || 'Событие');
  const rows = Feed.of(st, ref, me).map(e => {
    const by = e.by ? (who(e.by) ? who(e.by).name : 'нет данных: сотрудник') : (e.kind === 'msg' && e.data && e.data.inbound ? 'Клиент' : 'Система');
    // запись из другой карточки (в ленте клиента — сделка или лид) подписана, откуда она
    const from = e.ref.t !== ref.t || e.ref.id !== ref.id ? `<span class="pill sm">${esc((Feed.REF[e.ref.t] || '') + ' ' + e.ref.id)}</span>` : '';
    const when = e.at ? fWhen(e.at) : 'нет данных: время';
    return `<li class="feed-i k-${esc(e.kind)}"><div class="feed-h"><b>${esc(kindLabel(e))}</b>${from}<small>${esc(by)} · ${esc(when)}</small></div><p class="feed-t">${esc(e.text)}</p></li>`;
  }).join('');
  const can = Feed.canComment(st, me, ref);
  const plan = can && Acts.REFS.includes(ref.t) && Acts.alive(st, ref) ? actPlanHtml(ref, st, now) : '';
  const acts = Acts.REFS.includes(ref.t) ? actListHtml(ref, st, now) : '';
  const form = can
    ? `<form class="feed-add" data-form="feed-comment" data-t="${esc(ref.t)}" data-id="${esc(ref.id)}" novalidate><textarea id="feed-text" class="inp" rows="3" placeholder="Комментарий" aria-label="Комментарий"></textarea><p class="err" id="feed-err" hidden></p><button class="btn pri" type="submit">${ic('chat')}Добавить комментарий</button></form>`
    : `<p class="lock">${ic('lock')}У вашей роли нет права писать в эту ленту.</p>`;
  return `<div class="feed" data-ref-t="${esc(ref.t)}" data-ref-id="${esc(ref.id)}">${plan}${acts}${form}${rows ? `<ol class="feed-list">${rows}</ol>` : '<p class="muted m0">В ленте пока пусто.</p>'}</div>`;
}

// Отправка формы комментария (data-form="feed-comment"): пишет в ленту от имени S.me. Регистрируется в FORMS
// экраном раздела: FORMS['feed-comment'] = feedCommentForm (реестр FORMS объявлен в 50-shell, а этот файл читается раньше).
function feedCommentForm(f) {
  const ta = byId('feed-text'), txt = ta.value.trim();
  if (!txt) { ta.focus(); return; }
  const r = Feed.comment(S, { t: f.dataset.t, id: f.dataset.id }, txt, S.me, new Date());
  if (!r.ok) { showErr('feed-err', r.reason); return; }
  ta.value = '';
  render();
  toast('Комментарий записан в ленту.');
}

// Дела в ленте: окно «Выполнено», форма «Запланировать», быстрые сроки. Реестры A, FORMS, MODALS объявлены в 50-shell,
// а этот файл читается раньше — поэтому регистрация одной функцией, которую зовёт раздел (56-deals.js), как у feedCommentForm.
function feedWire() {
  A['act-quick'] = el => { const inp = byId('act-due'); if (inp) inp.value = actInput(Acts.quick(el.dataset.q, new Date())); };
  A['act-done'] = el => { if (Acts.byId(S, el.dataset.id)) { openModal('actDone', el.dataset.id); const ta = byId('ad-result'); if (ta) ta.focus(); } };
  MODALS.actDone = id => {
    const a = Acts.byId(S, id);
    return `<form data-form="act-done" data-id="${esc(id)}" novalidate>${mHead('Дело выполнено')}<div class="modal-b">
      <p class="m0">${a ? `<b>${esc(a.title)}</b><br><small class="muted">${esc(Acts.label(a))} · ${esc(Acts.refTitle(S, a.ref))}</small>` : ''}</p>
      <div class="field"><label for="ad-result">Результат</label><textarea id="ad-result" class="inp" rows="3" placeholder="Что получилось, о чём договорились"></textarea></div>
      <p class="hint">Дело станет серым и останется в ленте вместе с результатом; править его уже нельзя.</p>
      <p class="err" id="ad-err" hidden></p></div>${mFoot('Выполнено')}</form>`;
  };
  FORMS['act-done'] = f => {
    const r = Acts.done(S, f.dataset.id, byId('ad-result').value, S.me, new Date());
    if (!r.ok) return showErr('ad-err', r.reason);
    closeModal(); render();
    toast(`Дело выполнено: «${r.act.title}». Результат записан в ленту.`);
  };
  FORMS['act-plan'] = f => {
    const due = byId('act-due').value, rem = byId('act-remind').value;
    const r = Acts.plan(S, { t: f.dataset.t, id: f.dataset.id }, {
      type: byId('act-type').value, title: byId('act-title').value, due: due ? new Date(due) : null,
      ownerId: byId('act-owner').value, remind: rem === '' ? null : Number(rem),
    }, S.me, new Date());
    if (!r.ok) return showErr('act-err', r.missing && r.missing.includes('due') ? 'Укажите срок: нажмите «Сегодня», «Завтра» или выберите дату и время.' : r.reason);
    render();
    toast(`Дело запланировано: ${Acts.label(r.act)}. Ответственный: ${actWho(S, r.act.ownerId)}`);
  };
}

// Раз в минуту (и при каждой перерисовке — в render()): напоминания, которым пора, и лиды, которые ждут дольше положенного
// (РОП). Перерисовывает только колокол и меню, чтобы не сбить ввод в открытой форме.
function actsTick() {
  if (!S) return;
  const now = new Date(), made = [...Acts.notify(S, now), ...Leads.notifyWaiting(S, now)];
  if (!made.length) return;
  updBell(); renderSide(); save();
  const mine = made.filter(n => n.to.includes(S.me));
  if (mine.length) toast(mine[0].text + (mine.length > 1 ? ` И ещё напоминаний: ${mine.length - 1}.` : ''));
}
