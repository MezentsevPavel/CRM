// Ядро: заявки на отправку. Кому, куда, телефон, когда и что именно — их создаёт любой сотрудник, исполняют логист,
// кладовщик и водитель (право dispatch). Этап хранится по id этапа воронки отправок (вид dispatch), ход заявки пишется
// в общую ленту (Feed), уведомления — через Notify. Склад трогают только два действия:
//   • перемещение между складами (цель transfer): товар уходит из клетки «откуда» при «В пути» и приходит в клетку «куда»
//     при «Доставлена»; пока он в пути, Stock.incomingOf считает его приходом на склад-получатель (Dispatch.transit);
//   • списание проданного (Dispatch.sell → Stock.sell) — по праву sell, с отметкой на строке заявки.
// «Продажа» и «Другое» смена этапа склад не меняет.
// Чистые функции над состоянием st; время приходит параметром now (Date), кто делает — by (id сотрудника). Без DOM и S.
//
// Заявка st.dispatches[]: {id, number (оба — 'ОТ-NNN'), at, by, purpose:'sale'|'transfer'|'other', to:{name, phone}, address,
//   when:{date (Date, начало дня), from?, till? ('ЧЧ:ММ')}, items:[{productId?|text, qty, picked?, sold?:{at, by, entityId, cityId}}],
//   files:[{id, name, type, size, data|null, unsaved?}], note, driverId?, dealId?, pipeId, stageId, demo?,
//   у перемещения: from:{entityId, cityId}, toCell:{entityId, cityId}, moved? (списано из «откуда»), landed? (пришло в «куда»)}.
// Груз перемещения: moved && !landed — «в пути»; landed — лежит в «куда»; иначе лежит в «откуда».

const Dispatch = (() => {
  const PIPE = 'dispatch';
  // Id этапов воронки отправок по умолчанию. Логика ходит по этим id и по порядку этапов, не по названиям.
  const ST = { new: 'new', picking: 'picking', ready: 'ready', onWay: 'onWay', delivered: 'delivered', cancelled: 'cancelled' };
  const PURPOSE = { sale: 'Продажа', transfer: 'Перемещение между складами', other: 'Другое' };
  // Что не заполнено: ключ в missing → как назвать на экране.
  const MISSING = { name: 'получатель', address: 'адрес', phone: 'телефон', date: 'дата', items: 'список (хотя бы одна строка)', from: 'склад «откуда»', toCell: 'склад «куда»' };
  const NO_ADDRESS = 'нет данных: адрес';
  // Вид уведомления о ходе заявки (этап, водитель): получатель задан при отправке, постоянных адресатов нет.
  const STEP_KIND = 'dispatchStep';

  const str = v => String(v == null ? '' : v).trim();
  const fail = (reason, extra) => Object.assign({ ok: false, reason }, extra);
  const personOf = (st, id) => (st.people || []).find(p => p.id === id) || null;
  const personName = (st, id) => (personOf(st, id) || {}).name || 'нет данных: сотрудник';
  const byId = (st, id) => (st.dispatches || []).find(d => d.id === id) || null;
  const productOf = (st, id) => (st.products || []).find(p => p.id === id) || null;
  const lineName = (st, it) => (it.productId ? (productOf(st, it.productId) || {}).name || 'нет данных: товар' : it.text);
  const ref = d => ({ t: 'dispatch', id: d.id });
  const dateKey = v => { const n = new Date(v); return isNaN(n.getTime()) ? '' : n.getFullYear() + '-' + (n.getMonth() + 1) + '-' + n.getDate(); };
  const sum = (list, f) => list.reduce((a, x) => a + f(x), 0);

  // ——— воронка ———
  const pipeOf = (st, d) => (st.pipelines || []).find(p => p.id === d.pipeId) || null;
  const stagesOf = (st, d) => (pipeOf(st, d) || { stages: [] }).stages;
  const posOf = (st, d, stageId) => stagesOf(st, d).findIndex(s => s.id === stageId);
  const stageName = (st, d, stageId) => (Pipes.stage(st, d.pipeId, stageId) || {}).name || 'нет данных: этап';
  // С чего заявка начинает: первый этап воронки («Новая»).
  const firstStage = (st, d) => (stagesOf(st, d)[0] || {}).id;
  // Номер этапа, с которого груз «в пути»: «В пути»; нет такого этапа (директор удалил) — «Доставлена».
  function wayPos(st, d) {
    const w = posOf(st, d, ST.onWay);
    return w >= 0 ? w : (posOf(st, d, ST.delivered) >= 0 ? posOf(st, d, ST.delivered) : stagesOf(st, d).length);
  }
  const isFinal = (st, d) => Pipes.isFinal(st, d.pipeId, d.stageId);

  // ——— права ———
  // Вести отправки: двигать этапы, назначать водителя, отмечать «собрано». Только по праву dispatch.
  const canWork = (st, personId) => !!personOf(st, personId) && Perms.can(st, personId, 'dispatch');
  const isAuthor = (d, personId) => !!d && !!personId && d.by === personId;
  // Править заявку: с правом — всегда, автор без права — пока этап первый («Новая»).
  const canEdit = (st, personId, d) => !!d && (canWork(st, personId) || (isAuthor(d, personId) && d.stageId === firstStage(st, d)));
  // Отменить: с правом — пока не отменена, автор без права — до «В пути».
  const canCancel = (st, personId, d) => !!d && d.stageId !== ST.cancelled
    && (canWork(st, personId) || (isAuthor(d, personId) && !isFinal(st, d) && posOf(st, d, d.stageId) < wayPos(st, d)));
  // Писать в ленту заявки: любой сотрудник — раздел видят все, значит и обсуждать заявку может каждый, кто её видит.
  const canComment = (st, personId, d) => !!d && !!personOf(st, personId);
  const canSell = (st, personId) => !!personOf(st, personId) && Perms.can(st, personId, 'sell');

  // ——— перемещение: где груз ———
  const isTransfer = d => d.purpose === 'transfer';
  // Груз перемещения уже ушёл из «откуда» и ещё не пришёл в «куда».
  const inTransit = d => isTransfer(d) && d.moved === true && d.landed !== true;
  // Единственное определение «в пути» для остатков: Stock.incomingOf берёт отсюда.
  // → [{dispatchId, number, qty, eta (дата отправки заявки), entityId, cityId (склад-получатель)}], по одной записи на заявку.
  function transit(st, productId) {
    const out = [];
    for (const d of st.dispatches || []) {
      if (!inTransit(d) || !d.toCell) continue;
      const qty = sum((d.items || []).filter(i => i.productId === productId), i => i.qty);
      if (qty > 0) out.push({ dispatchId: d.id, number: d.number, qty, eta: d.when && d.when.date, entityId: d.toCell.entityId, cityId: d.toCell.cityId });
    }
    return out;
  }
  const cellText = (st, c) => `«${Stock.entityName(st, c.entityId) ?? c.entityId}, ${Stock.cityName(st, c.cityId) ?? c.cityId}»`;
  // Строки каталога, по продуктам (две строки одного товара складываются).
  function needs(d) {
    const m = new Map();
    for (const it of d.items || []) if (it.productId) m.set(it.productId, (m.get(it.productId) || 0) + it.qty);
    return m;
  }
  // Адрес склада-получателя: адрес города, а нет его — «нет данных: адрес».
  function warehouseAddress(st, cell) {
    const c = (st.cities || []).find(x => x.id === (cell && cell.cityId));
    return (c && str(c.address)) || NO_ADDRESS;
  }

  // Движение товара перемещения. Все три — через Stock.move; журнал пишет doc = номер заявки.
  // Уйти из «откуда»: сначала проверка по всем товарам, потом списание — отказ ничего не меняет.
  // Зарезервированное под клиента перемещение не забирает: берёт не больше Stock.sellMax — «остаток клетки − резервы на неё».
  function withdraw(st, d, by, now) {
    const short = [];
    for (const [productId, need] of needs(d)) {
      const lies = Stock.grid(st, productId).cell(d.from.entityId, d.from.cityId) ?? 0;
      const have = Stock.sellMax(st, { productId, entityId: d.from.entityId, cityId: d.from.cityId });
      if (need > have) short.push({ productId, name: (productOf(st, productId) || {}).name || 'нет данных: товар', need, have, held: lies - have });
    }
    if (short.length) {
      const list = short.map(x => (x.held > 0
        ? `${x.name} — нужно ${x.need}, свободно ${x.have} (лежит ${x.have + x.held}, под резервом ${x.held})`
        : `${x.name} — нужно ${x.need}, есть ${x.have}`)).join('; ');
      short.forEach(x => { if (!x.held) delete x.held; });
      return fail(`Не хватает на складе ${cellText(st, d.from)}: ${list}. Этап не изменён.`, { short });
    }
    for (const it of d.items) {
      if (!it.productId) continue;
      Stock.move(st, { kind: Stock.KINDS.ship, productId: it.productId, qty: it.qty, entityId: d.from.entityId, cityId: d.from.cityId, doc: d.number, by, at: now });
    }
    d.moved = true;
    return { ok: true };
  }
  // Положить груз в клетку: «куда» (пришёл) или «откуда» (вернули).
  function putBack(st, d, cell, by, now) {
    for (const it of d.items) {
      if (!it.productId) continue;
      Stock.move(st, { kind: Stock.KINDS.receive, productId: it.productId, qty: it.qty, entityId: cell.entityId, cityId: cell.cityId, doc: d.number, by, at: now });
    }
  }

  // Что должно стать с грузом перемещения при переходе на этап: 'cell' (в «откуда»), 'way' (в пути), 'dest' (в «куда»).
  const placeNow = d => (d.landed ? 'dest' : d.moved ? 'way' : 'cell');
  function placeFor(st, d, stageId) {
    if (stageId === ST.cancelled) return placeNow(d) === 'dest' ? 'dest' : 'cell';
    if (stageId === ST.delivered) return 'dest';
    return posOf(st, d, stageId) >= wayPos(st, d) ? 'way' : 'cell';
  }

  // Применить этап к грузу перемещения. → {ok, note?} | {ok:false, reason, short?}. Заявку не трогает, кроме moved/landed.
  function moveGoods(st, d, stageId, by, now) {
    if (!isTransfer(d)) return { ok: true };
    const from = placeNow(d), to = placeFor(st, d, stageId);
    const after = !!d.landed && stageId === ST.cancelled;
    if (from === 'dest' && to !== 'dest') {
      return fail(`Товар уже доставлен на склад ${cellText(st, d.toCell)}: вернуть его можно только обратной заявкой.`);
    }
    if (from === to) return { ok: true, note: after ? 'Товар уже на складе: движение не откатывается — нужна обратная заявка.' : '' };
    if (from === 'cell') {
      const w = withdraw(st, d, by, now);
      if (!w.ok) return w;
    }
    if (to === 'dest') { putBack(st, d, d.toCell, by, now); d.landed = true; return { ok: true, note: `Товар пришёл на склад ${cellText(st, d.toCell)}.` }; }
    if (to === 'cell') { putBack(st, d, d.from, by, now); d.moved = false; return { ok: true, note: `Товар вернулся на склад ${cellText(st, d.from)}.` }; }
    return { ok: true, note: `Товар ушёл со склада ${cellText(st, d.from)} и числится в пути на склад ${cellText(st, d.toCell)}.` };
  }

  // ——— разбор введённых данных ———
  const toDate = v => {
    if (v == null || v === '') return null;
    const m = typeof v === 'string' && v.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    const n = new Date(v);
    return isNaN(n.getTime()) ? null : new Date(n.getFullYear(), n.getMonth(), n.getDate());
  };
  const hhmm = v => (/^([01]\d|2[0-3]):[0-5]\d$/.test(str(v)) ? str(v) : '');
  // Клетка склада из введённого. «Откуда» может быть клеткой с «нет данных» ('_' — юрлицо или город в таблице остатков не указаны):
  // в таблице менеджеров города у остатков нет. «Куда» — всегда настоящие юрлицо и город из справочника.
  const cellOf = (st, c, anyOk) => {
    const e = str(c && c.entityId), k = str(c && c.cityId);
    const okE = (st.entities || []).some(x => x.id === e) || (anyOk && e === Stock.ANY);
    const okK = (st.cities || []).some(x => x.id === k) || (anyOk && k === Stock.ANY);
    return okE && okK ? { entityId: e, cityId: k } : null;
  };

  // Строки списка: товар каталога (productId) или свой текст (text), у каждой целое количество ≥ 1.
  // Пустая строка формы (ни товара, ни текста) пропускается; строка с товаром без количества — ошибка всего списка.
  function cleanItems(st, list) {
    const items = [];
    let bad = false;
    for (const it of Array.isArray(list) ? list : []) {
      const pid = str(it && it.productId), text = str(it && it.text);
      if (!pid && !text) continue;
      const qty = Number(it.qty);
      if (!Number.isInteger(qty) || qty < 1 || (pid && !productOf(st, pid))) { bad = true; continue; }
      const row = pid ? { productId: pid, qty } : { text, qty };
      if (it.picked === true) row.picked = true;
      // отметку «списано» с данными не принимаем: её ставит только sell, а update переносит со старой строки
      items.push(row);
    }
    return { items, bad };
  }
  function cleanFiles(st, list, existing) {
    const used = [...(existing || [])];
    const out = [];
    for (const f of Array.isArray(list) ? list : []) {
      if (!f || !str(f.name)) continue;
      const file = { id: f.id || Store.freeId(used, 'fl'), name: str(f.name), type: str(f.type), size: Number(f.size) || 0, data: typeof f.data === 'string' && f.data ? f.data : null };
      if (f.unsaved) file.unsaved = true;
      used.push(file);
      out.push(file);
    }
    return out;
  }

  // Введённое → запись заявки без служебных полей. → {rec} | {missing:[ключ…], reason}
  function normalize(st, data, current) {
    const d = data || {};
    const purpose = d.purpose == null || d.purpose === '' ? 'sale' : d.purpose;
    if (!PURPOSE[purpose]) return { missing: [], reason: 'Неизвестная цель отправки.' };
    const missing = [];
    const name = str(d.to && d.to.name), phone = str(d.to && d.to.phone);
    if (!name) missing.push('name');
    let address = str(d.address);
    const date = toDate(d.when && d.when.date);
    const it = cleanItems(st, d.items);
    let from = null, toCell = null, reason = '';
    if (purpose === 'transfer') {
      from = cellOf(st, d.from, true); toCell = cellOf(st, d.toCell, false);
      if (!from) missing.push('from');
      if (!toCell) missing.push('toCell');
      if (from && toCell && from.entityId === toCell.entityId && from.cityId === toCell.cityId) {
        missing.push('toCell'); reason = 'Склад «откуда» и склад «куда» совпадают.';
      }
      // адрес перемещения — адрес склада-получателя; без него — «нет данных: адрес»
      if (!address && toCell) address = warehouseAddress(st, toCell);
      if (!address) address = NO_ADDRESS;
    } else if (!address) missing.push('address');
    if (phone.replace(/\D/g, '').length < 5) missing.push('phone');
    if (!date) missing.push('date');
    if (!it.items.length || it.bad) { missing.push('items'); if (it.bad) reason = reason || 'В списке есть строка без количества или с неизвестным товаром.'; }
    let dealId = str(d.dealId);
    if (dealId && !(st.deals || []).some(x => x.id === dealId)) return { missing: [], reason: `Сделки ${dealId} нет.` };
    // новый файл с данными больше предела (Store.FILE_MAX) — отказ; уже сохранённые файлы заявки и файлы без данных
    // (не поместились в браузер) места не занимают и не проверяются
    const had = new Set(((current && current.files) || []).map(f => f.id));
    const big = (Array.isArray(d.files) ? d.files : []).filter(f => f && !had.has(f.id) && typeof f.data === 'string' && f.data).map(Store.fileTooBig).find(Boolean);
    if (big) return { missing: [], reason: big };
    if (missing.length) {
      return { missing, reason: reason || `Не заполнено: ${missing.map(k => MISSING[k]).join(', ')}.` };
    }
    const when = { date };
    if (hhmm(d.when && d.when.from)) when.from = hhmm(d.when.from);
    if (hhmm(d.when && d.when.till)) when.till = hhmm(d.when.till);
    const rec = {
      purpose, to: { name, phone }, address, when, items: it.items,
      files: cleanFiles(st, d.files, current && current.files), note: str(d.note),
    };
    if (purpose === 'transfer') { rec.from = from; rec.toCell = toCell; }
    if (dealId) rec.dealId = dealId;
    return { rec };
  }

  // ——— заявки ———
  // Следующий номер: больше всех выданных (удалять заявки нельзя, но номер от длины списка не берём).
  function nextNumber(st) {
    const used = (st.dispatches || []).map(d => Number(String(d.number).replace(/\D/g, '')) || 0);
    return 'ОТ-' + String(Math.max(0, ...used) + 1).padStart(3, '0');
  }
  function firstPipe(st) {
    const p = Pipes.of(st, PIPE)[0];
    return p ? { pipe: p, stage: p.stages.find(s => !s.flag) || p.stages[0] } : null;
  }

  // Создать заявку. Любой сотрудник может создать. data: {purpose, to:{name, phone}, address, when:{date, from?, till?},
  // items:[{productId?|text, qty}], files?, note?, from?, toCell? (перемещение), dealId?, demo?}.
  // Нет получателя, адреса, телефона, даты или списка — {ok:false, missing:[name|address|phone|date|items…]} и ничего не сохраняется.
  // opts.silent — без уведомлений (демо-данные). → {ok, id, missing, reason}
  function create(st, data, by, now, opts) {
    if (!personOf(st, by)) return fail('Нет такого сотрудника.', { id: null, missing: [] });
    const n = normalize(st, data, null);
    if (!n.rec) return fail(n.reason, { id: null, missing: n.missing });
    const start = firstPipe(st);
    if (!start) return fail('Нет воронки отправок.', { id: null, missing: [] });
    const number = nextNumber(st);
    const d = Object.assign({ id: number, number, at: now, by }, n.rec, { pipeId: start.pipe.id, stageId: start.stage.id });
    if (data && data.demo) d.demo = true;
    st.dispatches = st.dispatches || [];
    st.dispatches.push(d);
    const what = `${PURPOSE[d.purpose]}, кому: ${d.to.name}, на ${fD(d.when.date)}, ${d.items.length} ${pl(d.items.length, 'позиция', 'позиции', 'позиций')}`;
    Feed.add(st, ref(d), { kind: 'create', text: `Заявка создана: ${what}.`, by, at: now });
    if (!(opts && opts.silent)) Notify.push(st, 'dispatch', by, `Новая заявка на отправку ${d.number}: ${what}. Создал: ${personName(st, by)}.`, now, [], { t: 'dispatch', id: d.id });
    return { ok: true, id: d.id, missing: [], reason: '' };
  }

  // Заявка → данные в форме create (для правки и для проверки того, что менять нельзя).
  const snapshot = d => ({
    purpose: d.purpose, to: { ...d.to }, address: d.address, when: { ...d.when }, items: d.items.map(i => ({ ...i })),
    files: d.files.map(f => ({ ...f })), note: d.note, from: d.from, toCell: d.toCell, dealId: d.dealId,
  });

  // Править заявку: data сливается с тем, что уже есть, и проверяется как при создании. Нужно canEdit.
  // Пока товар перемещения не вернулся на склад «откуда» (он в пути или доставлен), цель, склады и товары менять нельзя.
  // → {ok, missing, reason}
  function update(st, id, data, by, now) {
    const d = byId(st, id);
    if (!d) return fail('Такой заявки нет.', { missing: [] });
    if (!canEdit(st, by, d)) return fail('Править заявку нельзя: она уже в работе, а у вас нет права вести отправки.', { missing: [] });
    const merged = Object.assign(snapshot(d), data || {});
    const n = normalize(st, merged, d);
    if (!n.rec) return fail(n.reason, { missing: n.missing });
    if (d.moved && (n.rec.purpose !== d.purpose || JSON.stringify(n.rec.items.map(i => [i.productId, i.text, i.qty])) !== JSON.stringify(d.items.map(i => [i.productId, i.text, i.qty]))
      || JSON.stringify(n.rec.from) !== JSON.stringify(d.from) || JSON.stringify(n.rec.toCell) !== JSON.stringify(d.toCell))) {
      return fail('Товар перемещения уже списан со склада: цель, склады и список менять нельзя. Верните заявку на этап до «В пути» или отмените её.', { missing: [] });
    }
    // списанная при продаже строка остаётся как была: товар, текст и количество не меняются, удалить её нельзя
    // (иначе в заявке «списано 50», а в журнале склада «Отгрузка 2»); строки выше и ниже править можно
    const taken = new Set();
    for (const old of d.items.filter(i => i.sold)) {
      const k = n.rec.items.findIndex((row, i) => !taken.has(i) && !row.sold && row.productId === old.productId && row.text === old.text && row.qty === old.qty);
      if (k < 0) return fail(`Строка «${lineName(st, old)}» уже списана при продаже (${num(old.qty)}): изменить или удалить её нельзя. Нужно больше — добавьте новую строку.`, { missing: [] });
      taken.add(k);
      n.rec.items[k].sold = old.sold;
      if (old.picked) n.rec.items[k].picked = true;
    }
    // отметка «собрано» остаётся у тех строк, что не менялись
    n.rec.items.forEach((row, i) => {
      const old = d.items[i];
      if (!taken.has(i) && old && !old.sold && old.productId === row.productId && old.text === row.text && old.picked) row.picked = true;
    });
    Object.assign(d, n.rec);
    if (d.purpose !== 'transfer') { delete d.from; delete d.toCell; }
    if (!n.rec.dealId) delete d.dealId;
    Feed.add(st, ref(d), { kind: 'field', text: `Заявка изменена: ${personName(st, by)}.`, by, at: now });
    return { ok: true, missing: [], reason: '' };
  }

  // ——— ход заявки ———
  // Перевести заявку на этап. Двигать этапы можно с правом dispatch; отменить — ещё и автору до «В пути».
  // У перемещения склад меняется вместе с этапом (см. шапку); не хватает товара в «откуда» — этап не меняется,
  // в ответе short:[{productId, name, need, have}]. → {ok, from, to, note} | {ok:false, reason, short?}
  // opts.silent — без уведомлений (демо-данные).
  function setStage(st, id, stageId, by, now, opts) {
    const d = byId(st, id);
    if (!d) return fail('Такой заявки нет.');
    if (!Pipes.stage(st, d.pipeId, stageId)) return fail('Такого этапа в воронке нет.');
    if (d.stageId === stageId) return fail('Заявка уже на этом этапе.');
    if (stageId === ST.cancelled ? !canCancel(st, by, d) : !canWork(st, by)) {
      return fail(stageId === ST.cancelled ? 'Отменить заявку может автор до «В пути» или тот, кто ведёт отправки.' : 'Двигать этапы могут только те, кто ведёт отправки.');
    }
    const g = moveGoods(st, d, stageId, by, now);
    if (!g.ok) return g;
    const from = d.stageId;
    d.stageId = stageId;
    const text = `Этап: «${stageName(st, d, from)}» → «${stageName(st, d, stageId)}».${g.note ? ' ' + g.note : ''}`;
    Feed.add(st, ref(d), { kind: 'stage', text, by, at: now, data: { from, to: stageId } });
    if (!(opts && opts.silent)) {
      // автору — каждая смена этапа его заявки, кроме тех, что он сделал сам. Вид STEP_KIND без постоянных адресатов
      // (Notify.RECIPIENTS): логист и кладовщик новую заявку получают, а ход каждой — нет. Некому слать — записи нет.
      const extra = d.by && d.by !== by ? [d.by] : [];
      if (extra.length) Notify.push(st, STEP_KIND, by, `${d.number} (${d.to.name}): ${personName(st, by)} перевёл заявку на этап «${stageName(st, d, stageId)}».${g.note ? ' ' + g.note : ''}`, now, extra, { t: 'dispatch', id: d.id });
    }
    return { ok: true, from, to: stageId, note: g.note || '' };
  }

  // Назначить водителя (driverId пустой — снять). Водитель — любой сотрудник с правом dispatch. Нужно canWork.
  // Водителю приходит уведомление. → {ok, reason}
  function assign(st, id, driverId, by, now, opts) {
    const d = byId(st, id);
    if (!d) return fail('Такой заявки нет.');
    if (!canWork(st, by)) return fail('Назначать водителя могут только те, кто ведёт отправки.');
    const to = str(driverId);
    if (to && !canWork(st, to)) return fail('Водителем можно назначить только сотрудника, который ведёт отправки.');
    if ((d.driverId || '') === to) return fail(to ? 'Этот водитель уже назначен.' : 'Водитель и так не назначен.');
    if (to) d.driverId = to; else delete d.driverId;
    Feed.add(st, ref(d), { kind: 'field', text: to ? `Водитель: ${personName(st, to)}.` : 'Водитель снят.', by, at: now });
    if (to && !(opts && opts.silent)) {
      Notify.push(st, STEP_KIND, by, `Вам назначена отправка ${d.number}: ${d.to.name}, ${d.address}, на ${fD(d.when.date)}.`, now, [to], { t: 'dispatch', id: d.id });
    }
    return { ok: true, reason: '' };
  }

  // Водители: сотрудники с ролью «Водитель» (роль встроенная). Для списка выбора и фильтра.
  const drivers = st => (st.people || []).filter(p => p.role === 'driver');

  // Отметить строку собранной (done=true) или снять отметку. Нужно canWork; закрытую заявку не трогаем.
  function pick(st, id, lineIdx, done, by, now) {
    const d = byId(st, id);
    if (!d) return fail('Такой заявки нет.');
    if (!canWork(st, by)) return fail('Отмечать «собрано» могут только те, кто ведёт отправки.');
    const it = d.items[lineIdx];
    if (!it) return fail('Такой строки нет.');
    if (isFinal(st, d)) return fail('Заявка закрыта: отметки менять нельзя.');
    if (!!it.picked === !!done) return { ok: true, reason: '' };
    if (done) it.picked = true; else delete it.picked;
    const p = picked(d);
    Feed.add(st, ref(d), { kind: 'item', text: `${done ? 'Собрано' : 'Снята отметка'}: ${lineName(st, it)} — ${num(it.qty)}. Собрано ${p.done} из ${p.total}.`, by, at: now });
    return { ok: true, reason: '' };
  }
  // «Собрано N из M»: строк с отметкой и всего строк. Единственный счёт для карточки и таблицы.
  const picked = d => ({ done: (d.items || []).filter(i => i.picked).length, total: (d.items || []).length });

  // Комментарий в ленту заявки: любой сотрудник. → {ok, entry, reason}
  function comment(st, id, text, by, now) {
    const d = byId(st, id);
    if (!d) return fail('Такой заявки нет.', { entry: null });
    if (!str(text)) return fail('Напишите комментарий.', { entry: null });
    if (!canComment(st, by, d)) return fail('Писать в ленту могут только сотрудники.', { entry: null });
    const entry = Feed.add(st, ref(d), { kind: 'comment', text, by, at: now });
    return entry ? { ok: true, entry, reason: '' } : fail('Не удалось записать комментарий.', { entry: null });
  }

  // Списать при продаже строку заявки «Продажа»: Stock.sell из клетки {entityId, cityId} (или по резерву reserveId),
  // на строке — отметка «списано: кто, когда, откуда». Нужно право sell. → то же, что Stock.sell
  function sell(st, id, lineIdx, opt, by, now) {
    const d = byId(st, id);
    if (!d) return fail('Такой заявки нет.');
    if (d.purpose !== 'sale') return fail('Списывать при продаже можно только в заявке с целью «Продажа».');
    const it = d.items[lineIdx];
    if (!it) return fail('Такой строки нет.');
    if (!it.productId) return fail('Строка своим текстом склад не трогает: списывать нечего.');
    if (it.sold) return fail('Эта строка уже списана.');
    const o = opt || {};
    // по резерву: лента сделки помнит резерв, даже когда списание снимет его целиком
    if (o.reserveId) Deals.keepTrail(st, (st.reserves || []).find(x => x.id === o.reserveId));
    const r = Stock.sell(st, { productId: it.productId, qty: it.qty, entityId: o.entityId, cityId: o.cityId, reserveId: o.reserveId, doc: d.number }, by, now);
    if (!r.ok) return r;
    it.sold = { at: now, by, entityId: r.move.entityId, cityId: r.move.cityId };
    Feed.add(st, ref(d), { kind: 'item', text: `Списано при продаже: ${lineName(st, it)} — ${num(it.qty)} со склада ${cellText(st, it.sold)}.`, by, at: now });
    return r;
  }
  // «списано: кто, когда, откуда» — одна фраза для карточки и таблицы
  const soldText = (st, it) => (it.sold ? `списано: ${personName(st, it.sold.by)}, ${fWhen(it.sold.at)}, ${cellText(st, it.sold)}` : '');

  // ——— отбор для списка и воронки ———
  // filter: {q (номер, получатель, адрес), stage (id), mine (автор или водитель personId), today (на сегодня по now), driver (id), personId, now}.
  // Сначала открытые — по дате отправки, ближайшие первыми; затем закрытые — свежие первыми.
  function query(st, filter) {
    const f = filter || {};
    const words = Catalog.norm(f.q).split(' ').filter(Boolean);
    const rows = (st.dispatches || []).filter(d =>
      (!f.stage || d.stageId === f.stage)
      && (!f.mine || d.by === f.personId || d.driverId === f.personId)
      && (!f.today || (f.now && dateKey(d.when.date) === dateKey(f.now)))
      && (!f.driver || d.driverId === f.driver)
      && (!words.length || words.every(w => Catalog.norm([d.number, d.to.name, d.address].join(' ')).includes(w))));
    const t = d => new Date(d.when.date).getTime();
    return rows.map(d => ({ d, fin: isFinal(st, d) }))
      .sort((a, b) => (a.fin - b.fin) || (a.fin ? t(b.d) - t(a.d) : t(a.d) - t(b.d)) || (a.d.number < b.d.number ? -1 : 1))
      .map(x => x.d);
  }

  return {
    PIPE, ST, STEP_KIND, PURPOSE, MISSING, NO_ADDRESS, byId, create, update, canWork, canEdit, canCancel, canComment, canSell,
    setStage, assign, drivers, pick, picked, comment, sell, soldText, query, transit, inTransit, warehouseAddress, lineName,
  };
})();

// Этапы воронки отправок, на которые опирается логика по id: Pipes.removeStage их не удаляет, их можно только переименовать.
Pipes.guard(Dispatch.PIPE, pipe => {
  const g = {
    [Dispatch.ST.onWay]: 'с него товар перемещения уходит со склада, и от него отмена уже не простая',
    [Dispatch.ST.delivered]: 'на нём товар перемещения приходит на склад',
    [Dispatch.ST.cancelled]: 'на нём заявку отменяют, а товар возвращается на склад',
  };
  g[(pipe.stages.find(s => !s.flag) || pipe.stages[0]).id] = 'сюда встаёт каждая новая заявка';
  g[pipe.stages[0].id] = 'с него начинается каждая заявка, и автор правит её, пока она здесь';
  return g;
});

// ——— демо-данные ———
// Подпись и значок вида уведомлений «Отправки» (KIND объявлен в 20-model.js).
KIND.dispatch = { l: 'Отправки', ic: 'truck', c: 'info' };
KIND.dispatchStep = { l: 'Ход отправок', ic: 'truck', c: 'info' };

// Шаг SEEDS: встроенная роль «Водитель» (право dispatch; цен, сделок и остатков ей не положено), два демо-водителя,
// воронка отправок и 20 демо-заявок «пример» на разных этапах и с разными целями. Получатели, адреса и телефоны явно
// выдуманные («Клиент-пример 3», «(пример)», +7 900 000-00-NN). Строки — настоящие товары каталога.
// Демо-перемещения не доходят дальше «Готова к отправке»: «В пути» увозит товар из клетки, а демо не должно менять
// настоящий снимок остатков — сразу после «Сбросить» остатки равны Catalog.build(снимок).
// Заявки заводятся теми же функциями, что и в работе, но без уведомлений (silent).
SEEDS.push(st => {
  const perms = on => Object.fromEntries(Perms.LIST.map(([k]) => [k, on.includes(k)]));
  st.roles.push({ id: 'driver', name: 'Водитель', builtin: true, perms: perms(['dispatch']) });
  // РОП (роль заводит шаг лидов, 35-leads.js) списывает при продаже, как менеджеры
  const rop = st.roles.find(r => r.id === 'rop');
  if (rop) rop.perms.sell = true;
  const driverIds = ['Роман Е.', 'Василий Т.'].map(name => {
    const p = { id: Store.freeId(st.people, 'p'), name, role: 'driver', dept: 'logistics', demo: true };
    st.people.push(p);
    return p.id;
  });
  st.pipelines.push({ id: Dispatch.PIPE, kind: 'dispatch', name: 'Отправки', stages: [
    { id: 'new', name: 'Новая' }, { id: 'picking', name: 'Собирается' }, { id: 'ready', name: 'Готова к отправке' },
    { id: 'onWay', name: 'В пути' }, { id: 'delivered', name: 'Доставлена', flag: 'final' }, { id: 'cancelled', name: 'Отменена', flag: 'final' },
  ] });
  st.dispatches = [];

  const pad = (n, w) => String(n).padStart(w, '0');
  const catalog = st.products.filter(p => p.inCatalog);
  // клетка для перемещений: «ИП, город не указан» (так лежит большинство остатков в таблице менеджеров);
  // берём товары, у которых там не меньше 6, сначала товары каталога, потом позиции таблицы менеджеров
  const FROM = { entityId: 'ip', cityId: Stock.ANY };
  const have = p => Stock.grid(st, p.id).cell(FROM.entityId, FROM.cityId) ?? 0;
  // позиции с небольшим остатком (от 6): большие партии из таблицы менеджеров демо-перемещения не трогают
  const movable = [...catalog, ...st.products.filter(p => !p.inCatalog)].filter(p => have(p) >= 6 && have(p) <= 30).sort((x, y) => have(x) - have(y));
  let used = 0;
  const TO = [{ entityId: 'ip', cityId: 'msk' }, { entityId: 'ip', cityId: 'krd' }, { entityId: 'npp', cityId: 'irk' }, { entityId: 'ip', cityId: 'irk' }];
  const TOWNS = ['г. Иркутск', 'г. Москва', 'г. Краснодар'];
  const NOTES = ['Пример примечания: позвонить за час до приезда.', 'Пример примечания: хрупкое, не кантовать.', 'Пример примечания: нужна машина с бортом.', ''];
  const DOC = text => ({ id: 'fl1', name: 'накладная-пример.txt', type: 'text/plain', size: text.length, data: 'data:text/plain;charset=utf-8,' + encodeURIComponent(text) });
  const path = ['new', 'picking', 'ready', 'onWay', 'delivered'];

  // [цель, автор, создана дней назад, этап, отправка через дней (0 — сегодня), водитель (номер в driverIds или -1), окно]
  const ROWS = [
    ['sale', 'p2', 6, 'delivered', -4, 0, ['10:00', '14:00']], ['sale', 'p3', 5, 'delivered', -3, 1, null],
    ['sale', 'p9', 4, 'cancelled', -2, -1, null], ['sale', 'p10', 3, 'onWay', 0, 0, ['09:00', '12:00']],
    ['sale', 'p2', 3, 'onWay', 0, 1, null], ['sale', 'p3', 2, 'ready', 0, 0, ['14:00', '18:00']],
    ['sale', 'p9', 2, 'picking', 0, -1, null], ['sale', 'p10', 1, 'picking', 1, -1, null],
    ['sale', 'p2', 1, 'new', 0, -1, ['11:00', '13:00']], ['sale', 'p3', 0, 'new', 2, -1, null],
    ['transfer', 'p6', 4, 'ready', 0, 0, null], ['transfer', 'p6', 3, 'ready', 1, 0, null],
    ['transfer', 'p5', 2, 'picking', 1, 1, null], ['transfer', 'p6', 2, 'ready', 1, -1, null],
    ['transfer', 'p5', 1, 'new', 3, -1, null], ['transfer', 'p6', 1, 'cancelled', -1, 0, null],
    ['other', 'p4', 3, 'delivered', -1, 1, null], ['other', 'p7', 1, 'ready', 0, 0, null],
    ['other', 'p1', 0, 'new', 1, -1, null], ['sale', 'p2', 0, 'picking', 0, -1, null],
  ];
  ROWS.forEach(([purpose, author, back, stage, off, drv, win], i) => {
    const k = i + 1, n = pad(k, 2);
    const at = day(-back, 9 + (k % 5), (k * 7) % 60);
    const later = j => new Date(at.getTime() + j * 7200000);
    const data = {
      purpose, demo: true,
      to: { name: `Клиент-пример ${k}`, phone: `+7 900 000-00-${n}` },
      address: `${TOWNS[k % TOWNS.length]}, ул. Примерная, ${k} (пример)`,
      when: { date: day(off, 0, 0) },
      items: [], note: NOTES[k % NOTES.length], files: k % 6 === 0 ? [DOC(`Накладная-пример к заявке ${k}. Демонстрационный файл.`)] : [],
    };
    if (win) { data.when.from = win[0]; data.when.till = win[1]; }
    if (purpose === 'transfer') {
      const to = TO[k % TO.length];
      data.from = FROM; data.toCell = to;
      data.to = { name: `Склад: ${Stock.entityName(st, to.entityId)}, ${Stock.cityName(st, to.cityId)}`, phone: `+7 900 000-00-${n}` };
      data.address = '';
      for (let j = 0; j < 2 && movable.length; j++) {
        const p = movable[used++ % movable.length];
        data.items.push({ productId: p.id, qty: Math.max(1, Math.min(2 + ((k + j) % 4), Math.floor(have(p) / 2))) });
      }
    } else if (purpose === 'other') {
      data.items.push({ text: `Образцы и документы (пример ${k})`, qty: 1 }, { text: 'Упаковка (пример)', qty: 2 });
    } else {
      const lines = 1 + (k % 3);
      for (let j = 0; j < lines; j++) data.items.push({ productId: catalog[(k * 17 + j * 29) % catalog.length].id, qty: [1, 2, 3, 4, 6, 10][(k + j) % 6] });
      // две заявки на продажу — из сделок: Clients.related показывает отправки клиента
      if (k === 4) data.dealId = 'Д-311';
      if (k === 5) data.dealId = 'Д-305';
    }
    const made = Dispatch.create(st, data, author, at, { silent: true });
    if (!made.ok) return;
    const driver = drv >= 0 ? driverIds[drv] : null;
    if (driver) Dispatch.assign(st, made.id, driver, 'p6', later(1), { silent: true });
    const d = Dispatch.byId(st, made.id);
    // отменённая заявка не дошла дальше «Собирается»
    const steps = stage === 'cancelled' ? 1 : path.indexOf(stage);
    for (let j = 1; j <= steps; j++) {
      if (j === 2) d.items.forEach((_, idx) => Dispatch.pick(st, d.id, idx, true, 'p5', later(j)));
      if (!Dispatch.setStage(st, d.id, path[j], j <= 2 ? 'p5' : (driver || 'p6'), later(j + 1), { silent: true }).ok) break;
      // кладовщик начал собирать: отмечена половина строк
      if (j === 1) d.items.slice(0, Math.floor(d.items.length / 2)).forEach((_, idx) => Dispatch.pick(st, d.id, idx, true, 'p5', later(j + 1)));
    }
    if (stage === 'cancelled') Dispatch.setStage(st, d.id, 'cancelled', purpose === 'transfer' ? 'p6' : author, later(6), { silent: true });
  });
});
