// Ядро: что человек видит (права на чтение). Без DOM; st первым аргументом.
// Visible.of — копия общего состояния для человека: сервер отдаёт браузеру только её. Правила видимости карточек живут
// здесь и в Leads (лиды, сделки); экраны зовут Visible.client и Visible.task, своих копий условий не держат.

const Visible = (() => {
  const can = (st, pid, right) => Perms.can(st, pid, right);
  const personOf = (st, pid) => (st.people || []).find(p => p.id === pid) || null;
  // Глубокая копия с живыми датами: исходное состояние не меняется
  const copy = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(Store.plain(v)), Store.revive));
  // Цена в тексте ленты («80 × 300 ₽», «Сумма: 1 180 000 ₽») — для человека без права «цены»
  const PRICE_RE = /\d[\d   ]*₽/g;
  const HIDDEN_PRICE = 'цена скрыта';

  // Клиент виден человеку с правом «клиенты»: клиент называет сделку, поэтому отбор — через видимые сделки и лиды
  // (Clients.related с personId: Leads.dealsVisible и Leads.visible). Виден, если у него есть видимая сделка или лид,
  // если человек — его менеджер, или если у клиента ещё нет ни сделок, ни лидов (только что заведён).
  function client(st, c, pid) {
    if (!c || !can(st, pid, 'clients')) return false;
    if (c.managerId && c.managerId === pid) return true;
    const mine = Clients.related(st, c.id, pid);
    if (mine.deals.length || mine.leads.length) return true;
    const all = Clients.related(st, c.id);
    return !all.deals.length && !all.leads.length;
  }

  // Задача «моя»: поставлена мне или моему отделу
  function taskMine(st, t, pid) {
    if (!t || !t.to) return false;
    const p = personOf(st, pid);
    return (t.to.t === 'p' && t.to.id === pid) || (t.to.t === 'd' && !!p && t.to.id === p.dept);
  }
  // Задача видна: право «все задачи», моя (мне или моему отделу) или поставлена мной. Это и доска задач, и право двигать задачу.
  const task = (st, t, pid) => !!t && (can(st, pid, 'tasksAll') || taskMine(st, t, pid) || t.from === pid);
  // Задача приходит человеку в данных и открывается по ссылке: видна (task) или это запрос счёта по заявке (bill), а заявки
  // видят все — правка заявки обновляет её задачи (Dispatch.syncBills), карточка заявки показывает, запрошен ли счёт и выставлен ли.
  const taskSeen = (st, t, pid) => task(st, t, pid)
    || (!!t && !!t.bill && !!personOf(st, pid) && (st.dispatches || []).some(d => d.id === t.bill.dispatchId));

  // Видимые карточки, на которые ссылаются лента и дела: {deal, lead, client} — множества id
  function seen(st, pid) {
    return {
      deal: new Set(Leads.dealsVisible(st, pid).map(d => d.id)),
      lead: new Set(Leads.visible(st, pid).map(l => l.id)),
      client: new Set((st.clients || []).filter(c => client(st, c, pid)).map(c => c.id)),
    };
  }
  // Карточка по ссылке ref = {t, id} видна: сделка, лид, клиент — по своим правилам, отправку видят все сотрудники
  function refSeen(st, pid, ref, s) {
    if (!ref) return false;
    if (ref.t === 'dispatch') return !!personOf(st, pid) && (st.dispatches || []).some(d => d.id === ref.id);
    return !!(s[ref.t] && s[ref.t].has(ref.id));
  }
  const shipsSeen = (st, pid) => can(st, pid, 'stock') || can(st, pid, 'logistics') || can(st, pid, 'receive');
  const notesAll = (st, pid) => can(st, pid, 'firm');

  // Видит ли человек запись key/id (скачивание файла, ссылка уведомления). Нет записи — false.
  function canSee(st, pid, key, id) {
    if (!personOf(st, pid)) return false;
    const rec = Array.isArray(st[key]) ? st[key].find(x => x && x.id === id) : undefined;
    switch (key) {
      case 'deals': return !!rec && Leads.dealsVisible(st, pid).some(d => d.id === id);
      case 'leads': return !!rec && Leads.visible(st, pid).some(l => l.id === id);
      case 'clients': return client(st, rec, pid);
      case 'tasks': return taskSeen(st, rec, pid);
      case 'feed': case 'acts': return !!rec && refSeen(st, pid, rec.ref, seen(st, pid));
      case 'notes': return !!rec && (notesAll(st, pid) || (rec.to || []).includes(pid));
      case 'shipments': return !!rec && shipsSeen(st, pid);
      case 'reserves': return !!rec && (can(st, pid, 'stock') || Leads.dealsVisible(st, pid).some(d => d.id === rec.dealId));
      case 'dispatches': return !!rec;
      // «Сообщить, когда появится» — каждый видит только свои подписки
      case 'watches': return !!rec && rec.personId === pid;
      case 'mail': case 'msgs': return false;
      default: {
        const k = Docs.kind(key);
        if (k === 'ARRAY') return !!rec;
        if (k === 'MAP') return !!(st[key] && st[key][id] !== undefined);
        return k === 'WHOLE';
      }
    }
  }

  // Копия общего состояния для человека (без личного: me, view, ui, rcv, v). Сделки — Leads.dealsVisible, лиды — Leads.visible,
  // клиенты — client, задачи — task, лента и дела — по видимости карточки; резерв и движение невидимой сделки остаются,
  // но вместо номера сделки — Stock.HIDDEN_ID; уведомления — свои (с правом «вся фирма» — все); без права «цены» — без цен
  // (товары, суммы и строки сделок, цены в тексте ленты); почта и переписка — пустые; prefs — только свои строки;
  // поставки — с правом остатков, перевозок или приёмки; в заявке на отправку номер невидимой сделки — Stock.HIDDEN_ID.
  // Исходное состояние не меняется.
  function of(st, pid) {
    const s = seen(st, pid), out = {};
    const exists = new Set((st.deals || []).map(d => d.id));
    const hideDeal = id => (id && exists.has(id) && !s.deal.has(id) ? Stock.HIDDEN_ID : id);
    const stockRight = can(st, pid, 'stock'), prices = can(st, pid, 'prices');
    for (const key of Object.keys(st)) {
      if (Docs.kind(key) === 'LOCAL') continue;
      const v = st[key];
      switch (key) {
        case 'deals': out.deals = (v || []).filter(d => s.deal.has(d.id)).map(copy); break;
        case 'leads': out.leads = (v || []).filter(l => s.lead.has(l.id)).map(copy); break;
        case 'clients': out.clients = (v || []).filter(c => s.client.has(c.id)).map(copy); break;
        case 'tasks': out.tasks = (v || []).filter(t => taskSeen(st, t, pid)).map(copy); break;
        case 'feed': case 'acts': out[key] = (v || []).filter(e => refSeen(st, pid, e.ref, s)).map(copy); break;
        case 'notes': out.notes = (v || []).filter(n => notesAll(st, pid) || (n.to || []).includes(pid)).map(copy); break;
        case 'shipments': out.shipments = shipsSeen(st, pid) ? copy(v) : []; break;
        case 'reserves':
          out.reserves = (v || []).filter(r => stockRight || s.deal.has(r.dealId)).map(r => {
            const c = copy(r);
            if (c.dealId) c.dealId = hideDeal(c.dealId);
            return c;
          });
          break;
        // движения видят все (журнал нужен и продаже, и перевозке), но у «Резерв» / «Снят резерв» в doc при переносе остатков
        // лежит заметка с именем клиента («перенос: …») — без права «остатки» её не отдаём; номер сделки — как у резервов
        case 'moves':
          out.moves = (v || []).map(m => {
            const c = copy(m);
            if (c.doc) c.doc = hideDeal(c.doc);
            if (!stockRight && (c.kind === Stock.KINDS.reserve || c.kind === Stock.KINDS.unreserve) && c.doc && c.doc !== Stock.HIDDEN_ID && !exists.has(c.doc)) delete c.doc;
            return c;
          });
          break;
        // заявки на отправку видят все, но номер невидимой сделки в заявке скрыт
        case 'dispatches':
          out.dispatches = (v || []).map(d => { const c = copy(d); if (c.dealId) c.dealId = hideDeal(c.dealId); return c; });
          break;
        case 'watches': out.watches = (v || []).filter(w => w && w.personId === pid).map(copy); break;
        case 'mail': out.mail = { boxes: [], suppliers: [], letters: [] }; break;
        case 'msgs': out.msgs = []; break;
        case 'prefs': {
          const p = v || {}, o = {};
          for (const f of ['notify', 'sound']) o[f] = p[f] && p[f][pid] !== undefined ? { [pid]: copy(p[f][pid]) } : {};
          out.prefs = o;
          break;
        }
        default: out[key] = copy(v);
      }
    }
    if (!prices) {
      for (const p of out.products || []) delete p.price;
      for (const d of out.deals || []) { delete d.amount; for (const it of d.items || []) delete it.price; }
      for (const e of out.feed || []) if (typeof e.text === 'string') e.text = e.text.replace(PRICE_RE, HIDDEN_PRICE);
    }
    return out;
  }

  return { HIDDEN_PRICE, client, task, taskSeen, taskMine, canSee, of };
})();
