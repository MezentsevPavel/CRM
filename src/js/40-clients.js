// Ядро: клиенты. Клиент — отдельная карточка: человек или компания (ИНН), телефоны, почта, адрес, менеджер.
// Дубли ищет find: тот же ИНН, телефон (по цифрам) или почта. Лиды и сделки ссылаются на клиента (clientId),
// related собирает всё, что к нему относится. Права — Perms, видимость сделок и лидов — Leads, события — Feed.
// Чистые функции над состоянием st; время приходит параметром now (Date). Экран — 70-clients.js.

const Clients = (() => {
  const KIND = { person: 'человек', company: 'компания' };
  const str = v => String(v == null ? '' : v).trim();
  const digits = v => str(v).replace(/\D/g, '');

  // Телефон для сравнения: только цифры; «+7» и «8» в начале одиннадцатизначного номера — одно и то же.
  function phoneKey(v) {
    const d = digits(v);
    return d.length === 11 && (d[0] === '7' || d[0] === '8') ? d.slice(1) : d;
  }
  const emailKey = v => str(v).toLowerCase();
  const innKey = digits;

  // Телефоны из данных: список phones и/или одиночный phone; без пустых и без повторов (по цифрам).
  function phonesOf(data) {
    const seen = new Set(), out = [];
    for (const v of [...(Array.isArray(data.phones) ? data.phones : []), data.phone]) {
      const s = str(v), k = phoneKey(s);
      if (k && !seen.has(k)) { seen.add(k); out.push(s); }
    }
    return out;
  }

  const byId = (st, id) => (st.clients || []).find(c => c.id === id) || null;
  const personOf = (st, id) => (st.people || []).find(p => p.id === id) || null;

  // Насколько запись q совпала с клиентом: ИНН — 3, телефон — 2, почта — 1; 0 — не совпала.
  // q — {phone, phones, email, inn}: клиент, лид, сделка или то, что ввели в форме.
  function score(c, q) {
    const ik = innKey(q.inn), ek = emailKey(q.email), pk = phonesOf(q).map(phoneKey);
    let s = 0;
    if (ik && innKey(c.inn) === ik) s = 3;
    else if (pk.length && (c.phones || []).some(p => pk.includes(phoneKey(p)))) s = 2;
    else if (ek && emailKey(c.email) === ek) s = 1;
    return s;
  }

  // Найденные клиенты с тем же ИНН, телефоном или почтой: сначала совпавшие по ИНН, затем по телефону, затем по почте.
  function find(st, q = {}) {
    return (st.clients || []).map(c => ({ c, s: score(c, q) })).filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s).map(x => x.c);
  }

  // Вид по данным: есть ИНН или сказано «компания» — компания; иначе человек.
  const kindOf = data => (KIND[data.kind] ? data.kind : (innKey(data.inn) ? 'company' : 'person'));

  // Завести клиента без проверки прав (его зовут и сами записи: лид → сделка, демо). Без названия — нельзя.
  function make(st, data, by, now) {
    const name = str(data.name);
    if (!name) return { ok: false, id: null, client: null, missing: ['name'], reason: 'Не заполнено: название клиента.' };
    st.clients = st.clients || [];
    const c = { id: Leads.nextId(st.clients, 'К', 0), kind: kindOf(data), name, phones: phonesOf(data), demo: !!data.demo };
    if (innKey(data.inn)) c.inn = str(data.inn);
    if (str(data.email)) c.email = str(data.email);
    if (str(data.address)) c.address = str(data.address);
    if (data.managerId && personOf(st, data.managerId)) c.managerId = data.managerId;
    // org — «Компания, должность» из выгрузки Битрикса; bitrixId — ID там же (для будущей связи). Оба из переноса, оба необязательные
    if (str(data.org)) c.org = str(data.org);
    if (str(data.bitrixId)) c.bitrixId = str(data.bitrixId);
    st.clients.push(c);
    Feed.add(st, { t: 'client', id: c.id }, { kind: 'create', text: `Клиент заведён: ${c.name}`, by, at: now });
    return { ok: true, id: c.id, client: c, missing: [], reason: '' };
  }

  // Может ли человек заводить и править клиентов: право «клиенты» и право «Заводить и править сделки» (G01: инженер клиентов
  // видит, но не правит). by пустой — это система (демо, импорт). Единственное место правила: экран и Guard зовут его.
  const canEdit = (st, by) => !by || (!!personOf(st, by) && Perms.can(st, by, 'clients') && Perms.can(st, by, 'dealsEdit'));
  const NO_RIGHT = { ok: false, id: null, client: null, missing: [], reason: 'У вашей роли нет права заводить и править клиентов.' };

  // Новый клиент: {name, kind?, inn?, phone | phones?, email?, address?, managerId?, demo?}.
  // Без названия — {ok:false, missing:['name']}. Дубли здесь не проверяются: «Похоже, это…» показывает форма по find.
  function create(st, data, by, now) {
    if (!canEdit(st, by)) return NO_RIGHT;
    return make(st, data || {}, by, now);
  }

  // Поля клиента, которые правятся, и их подписи в ленте.
  const LABEL = { name: 'Название', kind: 'Вид', inn: 'ИНН', phones: 'Телефоны', email: 'Почта', address: 'Адрес', managerId: 'Менеджер', org: 'Компания', bitrixId: 'ID в Битриксе' };
  const show = (st, f, v) => {
    if (f === 'kind') return KIND[v] || 'нет данных';
    if (f === 'phones') return (v || []).join(', ') || 'нет данных';
    if (f === 'managerId') return (personOf(st, v) || {}).name || 'нет данных';
    return str(v) || 'нет данных';
  };

  // Правка клиента: patch — любые из name, kind, inn, phones (список целиком, заменяет), email, address, managerId.
  // Пустое название нельзя. Изменение — запись в ленту клиента; новое название едет в сделки клиента (deal.client).
  // → {ok, changed:[поле…], reason}
  function update(st, id, patch, by, now) {
    const c = byId(st, id), p = patch || {};
    if (!c) return { ok: false, changed: [], reason: 'Такого клиента нет.' };
    if (!canEdit(st, by)) return { ok: false, changed: [], reason: NO_RIGHT.reason };
    const next = {};
    for (const f of Object.keys(LABEL)) {
      if (!(f in p)) continue;
      let v = p[f];
      if (f === 'name') { v = str(v); if (!v) return { ok: false, changed: [], reason: 'Название клиента не может быть пустым.' }; }
      else if (f === 'kind') { if (!KIND[v]) return { ok: false, changed: [], reason: 'Вид клиента — человек или компания.' }; }
      else if (f === 'phones') v = phonesOf({ phones: v });
      else if (f === 'managerId') { v = v || null; if (v && !personOf(st, v)) return { ok: false, changed: [], reason: 'Такого сотрудника нет.' }; }
      else v = str(v);
      const same = f === 'phones' ? v.join('|') === (c.phones || []).join('|') : (c[f] == null ? '' : c[f]) === (v == null ? '' : v);
      if (!same) next[f] = v;
    }
    const changed = Object.keys(next), lines = [], data = [];
    for (const f of changed) {
      lines.push(`${LABEL[f]}: ${show(st, f, c[f])} → ${show(st, f, next[f])}`);
      data.push({ field: f, from: c[f] == null ? null : c[f], to: next[f] });
      if (next[f] === '' || next[f] === null) delete c[f]; else c[f] = next[f];
    }
    if (changed.includes('name')) for (const d of st.deals || []) if (d.clientId === c.id) d.client = c.name;
    if (changed.length) Feed.add(st, { t: 'client', id: c.id }, { kind: 'field', text: lines.join('; '), by, at: now, data: { changes: data } });
    return { ok: true, changed, reason: '' };
  }

  // Найти клиента по ИНН, телефону или почте (первый — самый надёжный по find) или завести нового. → {client, created}.
  // У найденного дописываются то, чего не хватало: новые телефоны, почта, ИНН, адрес (занятое не затирается).
  // Без совпадений и без названия клиента не будет: {client:null, created:false}.
  function findOrCreate(st, data, by, now) {
    const d = data || {}, found = find(st, d)[0];
    if (!found) {
      const r = make(st, d, by, now);
      return { client: r.client, created: r.ok };
    }
    fill(st, found, d, by, now);
    return { client: found, created: false };
  }

  // Дописать найденному клиенту то, чего у него не было (занятое не затирается): телефоны, почта, ИНН, адрес, а из переноса —
  // компания и ID Битрикса. source — откуда данные, для записи в ленте («заявки», «переноса»). → список дописанного (пусто — ничего).
  function fill(st, found, d, by, now, source = 'заявки') {
    const add = gather(found, d);
    if (add.length) Feed.add(st, { t: 'client', id: found.id }, { kind: 'field', text: `Из ${source} добавлено: ${add.join(', ')}`, by, at: now });
    return add;
  }
  // Само дописывание (без записи в ленту) — им же объединение двух клиентов. → список дописанного
  function gather(found, d) {
    const add = [];
    const have = new Set((found.phones || []).map(phoneKey));
    for (const ph of phonesOf(d)) if (!have.has(phoneKey(ph))) { (found.phones = found.phones || []).push(ph); have.add(phoneKey(ph)); add.push(`телефон ${ph}`); }
    for (const [f, label] of [['email', 'почта'], ['inn', 'ИНН'], ['address', 'адрес'], ['org', 'компания'], ['bitrixId', 'ID в Битриксе']]) {
      if (!str(found[f]) && str(d[f]) && (f !== 'inn' || innKey(d.inn))) { found[f] = str(d[f]); add.push(`${label} ${found[f]}`); }
    }
    return add;
  }

  // Принадлежит ли лид клиенту: привязан явно (clientId) или, пока не привязан, совпал телефоном, почтой или ИНН.
  const leadBelongs = (c, l) => (l.clientId ? l.clientId === c.id : score(c, l) > 0);

  // Всё, что относится к клиенту: {leads, deals, msgs, dispatches}. personId — только то, что этому человеку видно:
  // лиды по Leads.visible, сделки по Leads.dealsVisible (сделки чужого типа не видны), сообщения — по этим сделкам.
  // Отправки — по этим сделкам и те заявки, где телефон получателя совпал с телефоном клиента (phoneKey; раздел видят все,
  // поэтому совпавшие по телефону показываются без проверки видимости), каждая один раз. Без personId — всё.
  function related(st, clientId, personId) {
    const c = byId(st, clientId), none = { leads: [], deals: [], msgs: [], dispatches: [] };
    if (!c) return none;
    const deals = (personId ? Leads.dealsVisible(st, personId) : (st.deals || [])).filter(d => d.clientId === c.id);
    const leads = (personId ? Leads.visible(st, personId) : (st.leads || [])).filter(l => leadBelongs(c, l));
    const ids = new Set(deals.map(d => d.id));
    const phones = new Set((c.phones || []).map(phoneKey).filter(Boolean));
    return {
      leads, deals,
      msgs: (st.msgs || []).filter(m => ids.has(m.deal)),
      dispatches: (st.dispatches || []).filter(x => ids.has(x.dealId) || phones.has(phoneKey(x.to && x.to.phone))),
    };
  }

  // Клиенты по строке поиска: название, телефон (по цифрам), ИНН, почта. Пустая строка — все. Для списка «Клиенты».
  function search(st, q) {
    const s = str(q).toLowerCase(), pk = phoneKey(q), ik = innKey(q);
    if (!s) return (st.clients || []).slice();
    return (st.clients || []).filter(c =>
      c.name.toLowerCase().includes(s) || emailKey(c.email).includes(s)
      || (pk.length >= 3 && (c.phones || []).some(p => phoneKey(p).includes(pk)))
      || (ik.length >= 3 && innKey(c.inn).includes(ik)));
  }

  // ——— объединение двух клиентов ———
  // Что ссылается на клиента id и переедет к другому: сделки (clientId), лиды (привязанные к нему и ещё не привязанные, но
  // совпавшие с ним по контактам — Clients.related), записи ленты и дела его карточки, уведомления на неё.
  // Отправки и резервы клиента не называют: они идут за его сделками.
  function refsTo(st, id) {
    const on = r => !!r && r.t === 'client' && r.id === id;
    return {
      deals: (st.deals || []).filter(d => d.clientId === id),
      leads: byId(st, id) ? related(st, id).leads : [],
      feed: (st.feed || []).filter(e => on(e.ref)),
      acts: (st.acts || []).filter(a => on(a.ref)),
      notes: (st.notes || []).filter(n => on(n.ref)),
    };
  }
  // Можно ли by объединить клиентов: keepId остаётся, dropId удаляется. → текст отказа или null.
  // by пустой — система (проверка прав не нужна). Человеку нужно право править клиентов, оба клиента ему видны, а всё, что
  // переезжает (сделки второго, его лиды), он видит и может править: иначе часть данных осталась бы без него. Ту же проверку делает сервер (Guard).
  function mergeBlock(st, keepId, dropId, by) {
    const keep = byId(st, keepId), drop = byId(st, dropId);
    if (!keep || !drop) return 'Такого клиента нет.';
    if (keep.id === drop.id) return 'Клиента нельзя объединить с ним самим.';
    if (!by) return null;
    if (!canEdit(st, by)) return NO_RIGHT.reason;
    if (!Visible.client(st, keep, by) || !Visible.client(st, drop, by)) return 'Один из клиентов вам не виден, поэтому объединить их нельзя.';
    const refs = refsTo(st, drop.id), seenLeads = new Set(Leads.visible(st, by).map(l => l.id));
    const hidden = refs.deals.filter(d => !Deals.canEdit(st, d, by)).length + refs.leads.filter(l => !seenLeads.has(l.id)).length;
    if (hidden) return `У клиента «${drop.name}» есть сделки или лиды (${hidden}), которые вам не видны или которые вам нельзя править, поэтому объединить нельзя. Объединить может тот, кто видит и ведёт их все.`;
    return null;
  }
  // Слить клиента dropId в keepId: всё, что ссылалось на второго (refsTo), переходит к первому; телефоны, почта, ИНН, адрес,
  // компания, ID Битрикса и менеджер второго дополняют первого (занятое у первого не затирается); второй удаляется; в ленту первого
  // — запись «объединён с …». Название первого остаётся, в его сделках название клиента то же. → {ok, reason, moved, added, kept}
  function merge(st, keepId, dropId, by, now) {
    const block = mergeBlock(st, keepId, dropId, by);
    if (block) return { ok: false, reason: block, moved: null, added: [], kept: [] };
    const keep = byId(st, keepId), drop = byId(st, dropId), refs = refsTo(st, dropId);
    const ref = { t: 'client', id: keep.id };
    const added = gather(keep, drop);
    if (!keep.managerId && drop.managerId) { keep.managerId = drop.managerId; added.push(`менеджер ${(personOf(st, drop.managerId) || {}).name || drop.managerId}`); }
    // чужое при занятом поле у первого не переносится — в ленте остаётся, чтобы не потерять
    const kept = [];
    for (const [f, label] of [['email', 'почта'], ['inn', 'ИНН'], ['address', 'адрес'], ['org', 'компания'], ['bitrixId', 'ID в Битриксе']]) {
      if (str(drop[f]) && str(keep[f]) && (f === 'email' ? emailKey(drop[f]) !== emailKey(keep[f]) : str(drop[f]) !== str(keep[f]))) kept.push(`${label} ${str(drop[f])}`);
    }
    for (const d of refs.deals) { d.clientId = keep.id; d.client = keep.name; }
    for (const l of refs.leads) l.clientId = keep.id;
    for (const x of [...refs.feed, ...refs.acts, ...refs.notes]) x.ref = { t: ref.t, id: ref.id };
    st.clients.splice(st.clients.indexOf(drop), 1);
    const moved = { deals: refs.deals.length, leads: refs.leads.length, feed: refs.feed.length, acts: refs.acts.length, notes: refs.notes.length };
    const parts = [['сделок', moved.deals], ['лидов', moved.leads], ['дел', moved.acts], ['записей ленты', moved.feed], ['уведомлений', moved.notes]].filter(x => x[1]).map(x => `${x[0]} ${x[1]}`);
    const text = `Объединён с ${drop.id} «${drop.name}», тот удалён. Перешло: ${parts.join(', ') || 'ничего (связанных записей не было)'}.`
      + (added.length ? ` Добавлено: ${added.join(', ')}.` : '') + (kept.length ? ` Не перенесено, у этого клиента уже другое: ${kept.join(', ')}.` : '');
    Feed.add(st, ref, { kind: 'merge', text, by: by || null, at: now, data: { dropId: drop.id, dropName: drop.name, moved } });
    return { ok: true, reason: '', moved, added, kept };
  }

  return { KIND, phoneKey, byId, find, canEdit, create, make, update, findOrCreate, fill, related, search, refsTo, mergeBlock, merge };
})();

// Шаг SEEDS: демо-клиенты. Каждая сделка получает клиента (clientId) из своего названия, контакта и телефона: сделки из лидов
// уже получили его при создании, прежние сделки v2 — здесь. Всё помечено «пример» (demo:true и слово в названии),
// телефоны вида +7 900 000-00-NN, ИНН и почта — условные: настоящих людей и компаний тут нет.
// У прежних сделок v2 текст deal.client остаётся как был (его читают уведомления приёмки), «(пример)» — в названии клиента.
// Лиды с тем же телефоном или ИНН привязываются к тому же клиенту: два открытых лида повторно обращаются под данными
// клиентов Д-311 и Д-314 — это и есть образец «Похоже, это …».
// База: клиентов нет.
BASES.push(st => { st.clients = []; });
SEEDS.push(st => {
  st.clients = st.clients || [];
  const when = day(-12, 9, 0);
  // условные данные для прежних сделок v2 (в самих сделках телефонов нет)
  const CONTACT = {
    'Д-311': { phone: '+7 900 000-00-31', email: 'primer31@example.com' },
    'Д-314': { phone: '+7 900 000-00-32', inn: '0000000101' },
    'Д-318': { phone: '+7 900 000-00-33' },
    'Д-320': { phone: '+7 900 000-00-34', inn: '0000000102', email: 'primer34@example.com' },
    'Д-305': { phone: '+7 900 000-00-35' },
    'Д-322': { phone: '+7 900 000-00-36' },
  };
  for (const d of st.deals.filter(x => !x.clientId)) {
    const c = CONTACT[d.id] || {};
    const { client } = Clients.findOrCreate(st, {
      name: `${d.client} (пример)`, kind: d.type === 'b2b' ? 'company' : 'person',
      phone: d.phone || c.phone, email: d.email || c.email, inn: c.inn, managerId: d.managerId, demo: true,
    }, null, when);
    d.clientId = client.id;
    if (!d.phone && client.phones[0]) d.phone = client.phones[0];
    if (!d.email && client.email) d.email = client.email;
  }
  // два открытых лида повторно пришли под данными клиентов: B2C — под телефоном Д-311, B2B — под ИНН Д-314
  const open = l => !Pipes.isFinal(st, l.pipeId, l.stageId);
  const again = (type, key, from) => {
    const lead = st.leads.find(l => open(l) && l.type === type && !l.dealId && l[key]);
    const src = Clients.byId(st, st.deals.find(x => x.id === from).clientId);
    if (!lead || !src) return;
    if (key === 'phone') lead.phone = src.phones[0]; else lead[key] = src[key];
  };
  again('b2c', 'phone', 'Д-311');
  again('b2b', 'inn', 'Д-314');
  for (const l of st.leads) {
    const c = Clients.find(st, l)[0];
    if (c && !l.clientId) l.clientId = c.id;
  }
});
