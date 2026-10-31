// Ядро и вид: одна лента для всех карточек — сделка, лид, клиент, отправка. Комментарии и события, новые сверху.
// Лента хранит только свои записи (st.feed); остальное подмешивает of(): историю лида, резервы по сделке,
// сообщения клиенту, а у клиента — ленты его сделок и лидов. Дела (T10) и отправки (T07) пишут сюда же.
// Чистые функции над состоянием st; время приходит параметром. Вид feedHtml не меняет состояние.

const Feed = (() => {
  // Виды записей и подписи. Модули дел и отправок добавляют свои виды сюда же: Feed.KINDS.act = 'Дело'.
  const KINDS = {
    comment: 'Комментарий', create: 'Создано', stage: 'Этап', field: 'Изменение', item: 'Товары',
    reserve: 'Резерв', win: 'Успешно', lose: 'Провалена', msg: 'Сообщение клиенту', history: 'История',
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
    const take = r => {
      const own = (st.feed || []).filter(e => same(e.ref, r));
      own.forEach(e => all.push(e));
      synthetic(st, r, own).forEach(e => all.push(e));
    };
    take(ref);
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
  // (и видеть лид), отправка — «вести отправки». Неизвестного права нет ни у кого (Perms.can), так что до отправок — никто.
  function canComment(st, personId, ref) {
    if (!ref || !(st.people || []).some(p => p.id === personId)) return false;
    if (ref.t === 'deal') return Leads.dealsVisible(st, personId).some(d => d.id === ref.id);
    if (ref.t === 'lead') return Leads.visible(st, personId).some(l => l.id === ref.id);
    if (ref.t === 'client') return Perms.can(st, personId, 'clients');
    if (ref.t === 'dispatch') return Perms.can(st, personId, 'dispatch');
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
// Лента карточки и поле «Комментарий»: один вид для лида, сделки, клиента и отправки. Не меняет состояние.
// st по умолчанию — S; видит человек st.me. Класс feed-add / data-form="feed-comment" — форма комментария (feedCommentForm).
function feedHtml(ref, st = S) {
  const me = st.me, who = id => (st.people || []).find(p => p.id === id);
  const kindLabel = e => e.kind === 'msg' && e.data && e.data.inbound ? 'Сообщение от клиента' : (Feed.KINDS[e.kind] || 'Событие');
  const rows = Feed.of(st, ref, me).map(e => {
    const by = e.by ? (who(e.by) ? who(e.by).name : 'нет данных: сотрудник') : (e.kind === 'msg' && e.data && e.data.inbound ? 'Клиент' : 'Система');
    // запись из другой карточки (в ленте клиента — сделка или лид) подписана, откуда она
    const from = e.ref.t !== ref.t || e.ref.id !== ref.id ? `<span class="pill sm">${esc((Feed.REF[e.ref.t] || '') + ' ' + e.ref.id)}</span>` : '';
    const when = e.at ? fWhen(e.at) : 'нет данных: время';
    return `<li class="feed-i k-${esc(e.kind)}"><div class="feed-h"><b>${esc(kindLabel(e))}</b>${from}<small>${esc(by)} · ${esc(when)}</small></div><p class="feed-t">${esc(e.text)}</p></li>`;
  }).join('');
  const form = Feed.canComment(st, me, ref)
    ? `<form class="feed-add" data-form="feed-comment" data-t="${esc(ref.t)}" data-id="${esc(ref.id)}" novalidate><textarea id="feed-text" class="inp" rows="3" placeholder="Комментарий" aria-label="Комментарий"></textarea><p class="err" id="feed-err" hidden></p><button class="btn pri" type="submit">${ic('chat')}Добавить комментарий</button></form>`
    : `<p class="lock">${ic('lock')}У вашей роли нет права писать в эту ленту.</p>`;
  return `<div class="feed" data-ref-t="${esc(ref.t)}" data-ref-id="${esc(ref.id)}">${form}${rows ? `<ol class="feed-list">${rows}</ol>` : '<p class="muted m0">В ленте пока пусто.</p>'}</div>`;
}

// Отправка формы комментария (data-form="feed-comment"): пишет в ленту от имени S.me. Регистрируется в FORMS экраном
// раздела: FORMS['feed-comment'] = feedCommentForm (реестр FORMS объявлен в 50-shell, а этот файл читается раньше).
function feedCommentForm(f) {
  const ta = byId('feed-text'), txt = ta.value.trim();
  if (!txt) { ta.focus(); return; }
  const r = Feed.comment(S, { t: f.dataset.t, id: f.dataset.id }, txt, S.me, new Date());
  if (!r.ok) { showErr('feed-err', r.reason); return; }
  ta.value = '';
  render();
  toast('Комментарий записан в ленту.');
}
