// Ядро: поставки и маршрут. Чистые функции, без DOM; текущее время приходит аргументом now.
// Поставка из-за границы идёт по маршруту — списку точек route:[nodeId…] из пяти точек NODES.
// Положение pos:{i, t}: t = 0 — груз стоит в точке route[i]; 0 < t < 1 — идёт по перегону route[i] → route[i+1],
// прошёл долю t. Этап (stageId) и положение двигаются вместе: смена этапа переставляет груз на схеме.
// Этапы названы по id воронки поставок по умолчанию (32-pipes.js): ordered, shipped, toBorder, customs,
// transship, toStock, arrived (флаг arrived), inStock (флаг final). Директор может переименовать и убрать
// этапы без флага — тогда груз просто не встаёт на отсутствующий этап.
// Отметка в history: {at, by, text, source, auto?} — source говорит, кто двинул поставку: SRC.

const Ships = (() => {
  // ——— точки схемы: подпись и условные координаты (0–100 по обеим осям, слева направо по ходу груза) ———
  const NODES = [
    { id: 'cn', name: 'Китай', label: 'основной город-поставщик', x: 8, y: 50 },
    { id: 'chita', name: 'Чита', label: 'основной город-приёмщик · таможня и перевалка', x: 32, y: 50 },
    { id: 'irk', name: 'Иркутск', label: 'основной город-получатель', x: 58, y: 50 },
    { id: 'msk', name: 'Москва', label: 'город-получатель', x: 90, y: 24 },
    { id: 'krd', name: 'Краснодар', label: 'город-получатель', x: 90, y: 76 },
  ];
  const nodeOf = id => NODES.find(n => n.id === id) || null;
  const nodeName = id => (nodeOf(id) ? nodeOf(id).name : String(id));

  // Этапы воронки поставок по умолчанию (id).
  const ST = { ordered: 'ordered', shipped: 'shipped', toBorder: 'toBorder', customs: 'customs', transship: 'transship', toStock: 'toStock', arrived: 'arrived', inStock: 'inStock' };
  // Кто двинул поставку — подпись в истории.
  const SRC = {
    manual: 'вручную',
    carrier: 'автоматически: перевозчик',
    receipt: 'автоматически: приёмка',
    rule: label => 'правило: ' + label,
  };
  // Положение на перегоне, где груз «в пути» (середина), и доля по умолчанию.
  const LEG_T = 0.5;

  const shipOf = (st, id) => (st.shipments || []).find(s => s.id === id) || null;
  const sumBy = (a, f) => a.reduce((x, y) => x + f(y), 0);
  const units = s => sumBy(s.items || [], i => Number(i.qty) || 0);
  const hasRoute = s => Array.isArray(s.route) && s.route.length >= 2;
  const posOf = s => ({
    i: s.pos && Number.isInteger(s.pos.i) ? s.pos.i : 0,
    t: s.pos && Number.isFinite(s.pos.t) ? s.pos.t : 0,
  });
  const onLeg = p => p.t > 0 && p.t < 1;
  const routeText = route => (route || []).map(nodeName).join(' → ');
  const fold = x => String(x ?? '').toLowerCase().replace(/ё/g, 'е');

  // ——— где груз сейчас ———
  // → {at, text} — стоит в точке; {from, to, t, text} — идёт по перегону; {text} — маршрута нет.
  function where(s) {
    if (!hasRoute(s)) return { text: 'нет данных: маршрут' };
    const { i, t } = posOf(s);
    const last = s.route.length - 1;
    if (!onLeg({ t }) || i >= last) {
      const id = s.route[Math.min(Math.max(i, 0), last)];
      const note = id === 'chita' ? (s.stageId === ST.customs ? ', таможня' : s.stageId === ST.transship ? ', перевалка' : '') : '';
      return { at: id, text: nodeName(id) + note };
    }
    const from = s.route[i], to = s.route[i + 1];
    return { from, to, t, text: `в пути ${nodeName(from)} → ${nodeName(to)}, пройдено ${Math.round(t * 100)}%` };
  }

  // ——— путь груза по маршруту: последовательность состояний {i, t, stageId} ———
  // Китай: «Заказано» → «Отгружено»; перегон до Читы — «В пути до границы»; в Чите — «Таможня» → «Перевалка»;
  // дальше перегоны и промежуточные точки — «В пути до склада»; в последней точке — «Прибыло в город».
  // Состояния с этапом, которого нет в воронке, пропускаются.
  function plan(st, s) {
    const out = [];
    if (!hasRoute(s)) return out;
    const r = s.route, last = r.length - 1;
    const add = (i, t, stageId) => { if (Pipes.stage(st, s.pipeId, stageId)) out.push({ i, t, stageId }); };
    add(0, 0, ST.ordered);
    add(0, 0, ST.shipped);
    for (let k = 0; k < last; k++) {
      add(k, LEG_T, r[k + 1] === 'chita' ? ST.toBorder : ST.toStock);
      const n = k + 1;
      if (r[n] === 'chita') {
        add(n, 0, ST.customs);
        add(n, 0, ST.transship);
        if (n === last) add(n, 0, ST.arrived);
      } else {
        add(n, 0, n === last ? ST.arrived : ST.toStock);
      }
    }
    return out;
  }

  // Где в плане сейчас поставка: по этапу и положению, иначе — по одному из двух. -1 — не нашли.
  function cursor(pl, s) {
    const p = posOf(s);
    const same = e => e.i === p.i && onLeg(e) === onLeg(p);
    let k = pl.findIndex(e => same(e) && e.stageId === s.stageId);
    if (k < 0) k = pl.findIndex(e => e.stageId === s.stageId);
    if (k < 0) k = pl.findIndex(same);
    return k;
  }

  // Доля пути, 0–1, по плану (для сроков и демо): состояние k из L.
  const progress = (pl, k) => {
    if (pl.length < 2 || k < 0) return 0;
    const e = pl[k];
    return Math.min(1, Math.max(0, (k + (onLeg(e) ? e.t - 0.5 : 0)) / (pl.length - 1)));
  };

  // ——— «ждёт приёмки» и «опоздала» — единственные определения ———
  const awaits = (st, s) => s.dir === 'in' && !s.received && !!s.stageId && (Pipes.stage(st, s.pipeId, s.stageId) || {}).flag === 'arrived';
  // awaitingReceipt(st, s) — ждёт ли эта поставка приёмки (да/нет); awaitingReceipt(st) — все такие поставки.
  function awaitingReceipt(st, s) {
    if (s !== undefined) return awaits(st, s);
    return (st.shipments || []).filter(x => awaits(st, x));
  }

  // Опоздала: ещё не закрыта и день ожидаемого прихода раньше дня now. st нужен, чтобы знать, закрыт ли этап;
  // без st закрытой считается принятая (received).
  function isLate(s, now, st) {
    if (s.received) return false;
    if (st && Pipes.isFinal(st, s.pipeId, s.stageId)) return false;
    return !!s.eta && sod(s.eta) < sod(now);
  }

  // ——— счётчики для схемы ———
  // Фильтр — как у query (кроме node: схема и сама показывает точки). Считаются только едущие поставки к нам
  // с маршрутом и не принятые (этап без флага final).
  // → {nodes:{<nodeId>:{ships, units}, chita:{ships, units, customs:{ships, units}}}, legs:{'a>b':{ships, units}}}
  // legs: все перегоны маршрутов выбранных поставок, у пустых — нули.
  function mapCounts(st, filter) {
    const f = { ...(filter || {}), node: undefined, dir: 'in' };
    const names = productNames(st);
    const nodes = {}, legs = {};
    NODES.forEach(n => { nodes[n.id] = { ships: 0, units: 0 }; });
    nodes.chita.customs = { ships: 0, units: 0 };
    const add = (c, u) => { c.ships += 1; c.units += u; };
    for (const s of st.shipments || []) {
      if (!hasRoute(s) || Pipes.isFinal(st, s.pipeId, s.stageId) || !matches(st, s, f, names)) continue;
      for (let k = 0; k < s.route.length - 1; k++) {
        const key = s.route[k] + '>' + s.route[k + 1];
        legs[key] = legs[key] || { ships: 0, units: 0 };
      }
      const w = where(s), u = units(s);
      if (w.at) {
        add(nodes[w.at] || (nodes[w.at] = { ships: 0, units: 0 }), u);
        if (w.at === 'chita' && s.stageId === ST.customs) add(nodes.chita.customs, u);
      } else {
        add(legs[w.from + '>' + w.to], u);
      }
    }
    return { nodes, legs };
  }

  // ——— поиск, фильтры, сортировка, страницы ———
  const productNames = st => new Map((st.products || []).map(p => [p.id, Catalog.skuOf(p) ? `${p.name} ${Catalog.skuOf(p)} ${Catalog.skuKey(p.sku)}` : p.name]));
  const atNode = (s, key) => {
    const w = where(s);
    return String(key).includes('>') ? !!w.from && w.from + '>' + w.to === key : w.at === key;
  };
  function matches(st, s, f, names) {
    const dir = f.dir || 'in';
    if (dir !== 'all' && (s.dir || 'in') !== dir) return false;
    if (f.stage && s.stageId !== f.stage) return false;
    if (f.supplier && s.supplier !== f.supplier) return false;
    if (f.city && s.cityId !== f.city) return false;
    if (f.entity && s.entityId !== f.entity) return false;
    if (f.node && !atNode(s, f.node)) return false;
    const q = fold(f.q).trim();
    if (q) {
      const hay = fold([s.id, s.number, s.supplier, s.track, where(s).text, ...(s.items || []).map(i => names.get(i.productId) || '')].join(' '));
      if (!q.split(/\s+/).every(w => hay.includes(w))) return false;
    }
    return true;
  }
  // Ключ сортировки; '-ключ' — по убыванию. Равные — по номеру.
  const SORTS = {
    eta: s => s.eta, depart: s => s.depart, number: s => s.id, supplier: s => s.supplier,
    units: s => units(s), items: s => (s.items || []).length,
  };
  function query(st, f = {}) {
    const names = productNames(st);
    let rows = (st.shipments || []).filter(s => matches(st, s, f, names));
    const raw = String(f.sort || 'eta');
    const desc = raw.startsWith('-'), key = desc ? raw.slice(1) : raw;
    const stagePos = s => { const p = (st.pipelines || []).find(x => x.id === s.pipeId); return p ? p.stages.findIndex(x => x.id === s.stageId) : -1; };
    const val = key === 'stage' ? stagePos : (SORTS[key] || SORTS.eta);
    const num = v => (v instanceof Date || Object.prototype.toString.call(v) === '[object Date]' ? v.getTime() : v);
    const cmp = (a, b) => {
      const x = num(val(a)), y = num(val(b));
      const c = typeof x === 'string' ? String(x).localeCompare(String(y), 'ru') : (x ?? 0) - (y ?? 0);
      return (desc ? -c : c) || String(a.id).localeCompare(String(b.id), 'ru', { numeric: true });
    };
    rows = rows.slice().sort(cmp);
    const total = rows.length;
    const size = Math.max(1, Math.floor(f.size) || 50);
    const pages = Math.max(1, Math.ceil(total / size));
    const page = Math.min(Math.max(1, Math.floor(f.page) || 1), pages);
    return { rows: rows.slice((page - 1) * size, page * size), total, page, pages, size };
  }

  // ——— смена этапа ———
  // Первый этап плана с таким id, а если груз уже стоит на таком — он же (чтобы не прыгать зря).
  function syncPos(st, s, stageId) {
    if (!hasRoute(s)) return;
    const stage = Pipes.stage(st, s.pipeId, stageId);
    const last = s.route.length - 1;
    if (stage && stage.flag === 'final') { s.pos = { i: last, t: 0 }; return; }
    const hits = plan(st, s).filter(e => e.stageId === stageId);
    if (!hits.length) return;
    const p = posOf(s);
    const keep = hits.find(e => e.i === p.i && onLeg(e) === onLeg(p));
    const e = keep || hits[0];
    s.pos = { i: e.i, t: keep ? p.t : e.t };
  }

  // «Что» везём — для текста уведомления: первая позиция и «и ещё N».
  function brief(st, s) {
    const items = s.items || [];
    if (!items.length) return 'без позиций';
    const p = (st.products || []).find(x => x.id === items[0].productId);
    // длинное название укорачивается, артикул (если он есть) остаётся целиком
    let name = p ? p.name : 'нет данных: товар';
    if (name.length > 56) name = name.slice(0, 55) + '…';
    const first = p && Catalog.skuOf(p) ? `${name} (арт. ${Catalog.skuOf(p)})` : name;
    const more = items.length - 1;
    return more > 0 ? `${first} и ещё ${more} ${pl(more, 'позиция', 'позиции', 'позиций')}` : first;
  }

  // Записывает новый этап и положение, отметку в историю, уведомление. Приёмка шлёт свои уведомления сама.
  function put(st, s, stageId, by, now, source, pos) {
    const was = Pipes.stage(st, s.pipeId, s.stageId);
    const stage = Pipes.stage(st, s.pipeId, stageId);
    s.stageId = stageId;
    if (pos) s.pos = { i: pos.i, t: pos.t }; else syncPos(st, s, stageId);
    const where_ = where(s).text;
    const entry = { at: now, by: by || null, text: `Этап: «${was ? was.name : 'нет данных'}» → «${stage.name}». ${where_}.`, source };
    if (source !== SRC.manual) entry.auto = true;
    s.history = s.history || [];
    s.history.push(entry);
    let note = null;
    if (source !== SRC.receipt) {
      const when = s.dir === 'out' ? 'Доставка' : 'На складе ожидается';
      const here = hasRoute(s) ? ` Сейчас: ${where_}.` : '';
      note = Notify.push(st, 'ship', by || null, `${s.id}: ${brief(st, s)} — этап «${stage.name}».${here} ${when} ${s.eta ? fD(s.eta) : 'нет данных: дата'}.`, now, [], { t: 'ship', id: s.id });
    }
    return { ok: true, from: was, to: stage, note, text: entry.text };
  }

  // Ручная (или иная) смена этапа. → {ok, reason?, from, to, note}
  function setStage(st, shipId, stageId, by, now, source) {
    const s = shipOf(st, shipId);
    if (!s) return { ok: false, reason: 'Поставки нет.' };
    if (!Pipes.stage(st, s.pipeId, stageId)) return { ok: false, reason: 'Такого этапа в воронке нет.' };
    if (s.stageId === stageId) return { ok: false, reason: 'Поставка уже на этом этапе.' };
    return put(st, s, stageId, by, now, source || SRC.manual);
  }

  // ——— шаг по маршруту (трек перевозчика) ———
  // Груз делает следующий шаг плана: выехал → в пути → в точке → таможня → перевалка → … → «Прибыло в город».
  // Дальше (на склад) его двигает только приёмка. Шаг порождает события для правил директора.
  // → {ok, reason?, from, to, events:[…], applied:[ruleId…]}
  function advance(st, shipId, by, now, source) {
    const s = shipOf(st, shipId);
    if (!s) return { ok: false, reason: 'Поставки нет.' };
    if (!hasRoute(s)) return { ok: false, reason: 'У поставки нет маршрута.' };
    if (Pipes.isFinal(st, s.pipeId, s.stageId) || s.received) return { ok: false, reason: 'Поставка уже принята на складе.' };
    const pl = plan(st, s);
    const k = cursor(pl, s);
    const next = pl[k + 1];
    if (!next) return { ok: false, reason: 'Груз уже в городе назначения: дальше его принимает склад.' };
    const prevStage = s.stageId, prevPos = posOf(s);
    const src = source || SRC.carrier;
    const r = put(st, s, next.stageId, by, now, src, next);
    const events = [];
    // «груз в точке» — только когда груз пришёл в точку, а не когда в ней сменился этап (таможня → перевалка)
    if (!onLeg(next) && next.i > 0 && (onLeg(prevPos) || prevPos.i !== next.i)) events.push('carrier:' + s.route[next.i]);
    if (prevStage === ST.customs && next.stageId !== ST.customs) events.push('customs');
    const applied = [];
    for (const ev of events) applied.push(...applyRules(st, ev, shipId, by, now));
    return { ok: true, from: r.from, to: r.to, events, applied, note: r.note };
  }

  // ——— правила директора: «если событие — поставить этап» ———
  // st.shipRules:[{id, on, when, then}]: on — включено; when — 'received' (принято на складе), 'customs'
  // (таможня пройдена), 'carrier:<nodeId>' (перевозчик: груз в точке) или просто 'carrier' (в любой точке);
  // then — id этапа воронки поставки.
  const EVENTS = { received: 'принято на складе', customs: 'таможня пройдена' };
  function eventLabel(ev) {
    if (EVENTS[ev]) return EVENTS[ev];
    if (ev === 'carrier') return 'перевозчик: груз в любой точке';
    if (String(ev).startsWith('carrier:')) return 'перевозчик: груз в точке ' + nodeName(String(ev).slice(8));
    return String(ev);
  }
  const ruleHits = (rule, event) => rule.when === event || (rule.when === 'carrier' && String(event).startsWith('carrier:'));

  // Применяет включённые правила к событию по поставке. Правило срабатывает, только если меняет этап;
  // срабатывание пишется в историю (source «правило: …») и рассылается как смена этапа.
  // → id сработавших правил.
  function applyRules(st, event, shipId, by, now) {
    const s = shipOf(st, shipId);
    const fired = [];
    if (!s) return fired;
    for (const rule of st.shipRules || []) {
      if (rule.on !== true || !ruleHits(rule, event)) continue;
      const stage = Pipes.stage(st, s.pipeId, rule.then);
      // «На складе» и «Прибыло в город» правило ставит, только если оно «принято на складе»: иначе поставка закрылась бы без приёмки
      if (!stage || s.stageId === rule.then || !Pipes.ruleMayTo(rule, stage)) continue;
      put(st, s, rule.then, by, now, SRC.rule(`если ${eventLabel(rule.when)} — «${stage.name}»`));
      fired.push(rule.id);
    }
    return fired;
  }

  // Номер новой поставки к нам: «П-» и следующий после самого большого из входящих. Есть поставщик номеров
  // (Ids.use, серверный режим) — номер выдаёт он.
  function nextNumber(st) {
    return Ids.next('П-', () => 'П-' + (Math.max(0, ...(st.shipments || []).filter(s => s.dir === 'in')
      .map(s => parseInt(String(s.id).replace(/\D/g, ''), 10) || 0)) + 1));
  }

  return {
    NODES, ST, SRC, EVENTS, nodeOf, nodeName, routeText, units, brief,
    where, plan, progress, awaitingReceipt, isLate, mapCounts, query,
    advance, setStage, applyRules, eventLabel, nextNumber,
  };
})();

// ——— демо-данные ———
// Шаг SEEDS: 126 поставок на фиксированную дату демо 31.10.2026 — после «Сбросить» те же самые (свой генератор
// псевдослучайных чисел с зерном, ничего от настоящей даты). Настоящих поставщиков и номеров нет: «Поставщик-пример N»,
// номера и треки с пометкой «демо». Позиции — настоящие товары каталога (берём из тех же снимков, что и шаг почты:
// шаг каталога (38) стоит позже). Пять якорных поставок (П-1038, П-1041…П-1044) и отгрузка О-207 остались от v2:
// на них ссылаются резервы, задачи и движения; их позиции названы артикулами v2 — на настоящие товары их переводит
// шаг каталога вместе с резервами, которые на них ссылаются.
SEEDS.push(st => {
  const DEMO = new Date(2026, 9, 31);
  const at = (back, h = 12, m = 0) => new Date(DEMO.getFullYear(), DEMO.getMonth(), DEMO.getDate() - back, h, m);
  // mulberry32: фиксированное зерно — фиксированный набор
  let seedNum = 31102026;
  const rnd = () => {
    seedNum = (seedNum + 0x6D2B79F5) | 0;
    let t = Math.imul(seedNum ^ (seedNum >>> 15), 1 | seedNum);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  const pickW = list => {
    let x = rnd() * list.reduce((s, e) => s + e[1], 0);
    for (const e of list) { x -= e[1]; if (x < 0) return e[0]; }
    return list[list.length - 1][0];
  };
  const shuffle = arr => {
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr;
  };

  const products = Catalog.build(CATALOG, STOCK_SNAPSHOT).products;
  const SUPPLIERS = [
    { n: 1, cats: ['Инверторы'] }, { n: 2, cats: ['Аккумуляторы'] }, { n: 3, cats: ['Панели'] },
    { n: 4, cats: ['Кабель', 'Защита и соединения'] }, { n: 5, cats: ['Контроллеры'] }, { n: 6, cats: ['Защита и соединения'] },
    { n: 7, cats: null }, // смешанный: любые товары
  ].map(s => ({ ...s, name: `Поставщик-пример ${s.n}`, pool: s.cats ? products.filter(p => s.cats.includes(p.cat)) : products }));
  const sup = n => SUPPLIERS[n - 1];
  const QTY = { 'Панели': [10, 120], 'Инверторы': [1, 10], 'Аккумуляторы': [2, 24], 'Контроллеры': [1, 12], 'Защита и соединения': [5, 100], 'Кабель': [100, 600] };
  const pickItems = (supplier, n) => {
    const pool = supplier.pool.slice();
    const out = [];
    for (let k = 0; k < Math.min(n, pool.length); k++) {
      const p = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
      const [lo, hi] = QTY[p.cat] || [1, 20];
      out.push({ productId: p.id, qty: int(lo, hi) });
    }
    return out;
  };

  // маршруты: все через Читу (там таможня и перевалка), места назначения разные
  const ROUTES = [
    [['cn', 'chita', 'irk'], 38], [['cn', 'chita', 'msk'], 22], [['cn', 'chita', 'krd'], 14],
    [['cn', 'chita', 'irk', 'msk'], 14], [['cn', 'chita', 'irk', 'krd'], 8], [['cn', 'chita', 'irk', 'msk', 'krd'], 4],
  ];
  const LEG_DAYS = { 'cn>chita': 6, 'chita>irk': 4, 'chita>msk': 8, 'chita>krd': 9, 'irk>msk': 5, 'irk>krd': 6, 'msk>krd': 3 };
  const totalDays = route => 2 + 6 + route.slice(1).reduce((s, n, k) => s + (LEG_DAYS[route[k] + '>' + n] || 5), 0);
  const LEG_TEXT = { toBorder: 'Груз в пути до границы', toStock: 'Груз в пути' };
  const stateText = (route, e) => {
    const here = Ships.nodeName(route[e.i]);
    if (e.stageId === 'ordered') return 'Заказ оформлен у поставщика';
    if (e.stageId === 'shipped') return 'Груз передан перевозчику';
    if (e.t > 0) return `${LEG_TEXT[e.stageId]}: ${here} → ${Ships.nodeName(route[e.i + 1])}`;
    if (e.stageId === 'customs') return 'Прибыл в Читу, таможенное оформление';
    if (e.stageId === 'transship') return 'Таможня пройдена, перевалка в Чите';
    if (e.stageId === 'arrived') return `Прибыл в город: ${here}, ждёт приёмки`;
    return `Груз в точке: ${here}`;
  };

  // отметки истории: состояния плана до k включительно (не больше четырёх), последняя — в момент last,
  // прежние раньше на step дней; часть отметок — от «перевозчика»
  const hist = (route, pl, k, last, step, over) => {
    const out = [];
    for (let j = Math.max(0, k - 3); j <= k; j++) {
      const back = (k - j) * step;
      const t = new Date(last.getFullYear(), last.getMonth(), last.getDate() - back, j === k ? last.getHours() : 9 + (j % 6), j === k ? last.getMinutes() : (j * 7) % 60);
      const e = { at: t, by: 'p6', text: j === k && over ? over : stateText(route, pl[j]), source: Ships.SRC.manual };
      if ((j + k) % 4 === 0) { e.source = Ships.SRC.carrier; e.auto = true; }
      out.push(e);
    }
    return out;
  };

  const base = (id, supplier, route, entityId, extra) => ({
    id, number: `${id} (демо)`, dir: 'in', supplier: supplier.name, to: 'Наш склад',
    carrier: pickW([[CARRIERS[0], 4], [CARRIERS[1], 2], [CARRIERS[3], 4]]),
    track: `ТРЕК-ПРИМЕР-${id.replace(/\D/g, '')} (демо)`, entityId, cityId: route[route.length - 1], route, pipeId: 'ships', demo: true, ...extra,
  });

  const shipments = [];

  // ——— якорные поставки v2: положение и сроки заданы руками ———
  const anchor = (id, supplier, stageId, pos, eta, depart, carrier, rows, lastAt, lastText, extra) => {
    const route = ['cn', 'chita', 'irk'];
    const s = base(id, supplier, route, 'ip', { carrier, stageId, pos, eta, depart, items: rows.map(([productId, qty]) => ({ productId, qty })), ...extra });
    const pl = Ships.plan(st, s), k = pl.findIndex(e => e.stageId === (stageId === 'inStock' ? 'arrived' : stageId));
    if (extra && extra.received) {
      s.history = hist(route, pl, k, new Date(lastAt.getTime() - 3600e3), 3);
      s.history.push({ at: lastAt, by: 'p5', text: lastText, source: Ships.SRC.receipt, auto: true });
    } else s.history = hist(route, pl, k, lastAt, 3, lastText);
    return s;
  };
  shipments.push(
    anchor('П-1038', sup(6), 'inStock', { i: 2, t: 0 }, at(2, 15), at(21, 12), CARRIERS[2], [['MNT-R4', 24]], at(2, 15, 30), 'Принято на складе',
      { received: { at: at(2, 15, 30), by: 'p5', photos: 3, urls: [], note: '' } }),
    anchor('П-1041', sup(1), 'toStock', { i: 1, t: 0.6 }, at(-3, 12), at(20, 12), CARRIERS[0], [['INV-H6', 10], ['BAT-LFP-100', 16]], at(0, 9, 40), 'Прошёл Читу, идёт в Иркутск'),
    anchor('П-1042', sup(7), 'toStock', { i: 1, t: 0.35 }, at(1, 12), at(22, 12), CARRIERS[1], [['WND-3K', 2], ['MTR-3F', 5]], at(1, 18, 5), 'Задерживается: груз стоит на перегоне Чита → Иркутск'),
    anchor('П-1043', sup(3), 'transship', { i: 1, t: 0 }, at(-6, 12), at(14, 12), CARRIERS[3], [['PV-550M', 120], ['MNT-R4', 30]], at(1, 7, 20), 'Перевалка в Чите'),
    anchor('П-1044', sup(4), 'arrived', { i: 2, t: 0 }, at(0, 14), at(12, 12), CARRIERS[0], [['CAB-6R', 500], ['CAB-6B', 500], ['MC4', 200], ['CTRL-60', 6], ['BOX-DC', 10]], at(0, 8, 15), 'Терминал транспортной компании в городе'),
  );
  shipments[0].items[0].got = 24;

  // ——— генерация: 120 поставок по квотам этапов ———
  const QUOTA = [['ordered', 8], ['shipped', 12], ['toBorder', 20], ['customs', 12], ['transship', 9], ['toStock', 24], ['arrived', 9], ['inStock', 26]];
  // сколько из поставок этапа опаздывают
  const LATE = { toBorder: 5, customs: 4, transship: 3, toStock: 7, arrived: 4 };
  const slots = [];
  for (const [stage, n] of QUOTA) for (let k = 0; k < n; k++) slots.push({ stage, late: k < (LATE[stage] || 0) });
  shuffle(slots);
  // несколько больших поставок — 50–150 позиций, у смешанного поставщика
  const BIG = new Map([[4, 52], [19, 64], [37, 75], [58, 96], [83, 120], [101, 150]]);
  const SIZES = [1, 1, 2, 2, 3, 3, 3, 4, 4, 5, 6, 7, 8, 10];

  slots.forEach((slot, idx) => {
    const id = `П-${1101 + idx}`;
    const big = BIG.get(idx);
    const supplier = big ? sup(7) : sup(pickW([[1, 4], [2, 3], [3, 5], [4, 3], [5, 2], [6, 2], [7, 2]]));
    const route = pickW(ROUTES);
    const entityId = pickW([['ip', 5], ['npp', 3], ['vs', 2]]);
    const s = base(id, supplier, route, entityId, {});
    s.items = pickItems(supplier, big || SIZES[int(0, SIZES.length - 1)]);
    s.stageId = slot.stage;
    const pl = Ships.plan(st, s);
    const hits = pl.map((e, k) => k).filter(k => pl[k].stageId === (slot.stage === 'inStock' ? 'arrived' : slot.stage));
    const k = hits[int(0, hits.length - 1)];
    const e = pl[k];
    s.pos = { i: e.i, t: e.t > 0 ? Math.round((0.15 + rnd() * 0.7) * 100) / 100 : 0 };
    const T = totalDays(route) + int(0, 4);
    const p = slot.stage === 'inStock' ? 1 : Ships.progress(pl, k);
    const step = Math.max(1, Math.floor(T / pl.length));
    if (slot.stage === 'inStock') {
      const back = int(2, 30);
      s.eta = at(back, 15); s.depart = at(back + T, 12);
      s.received = { at: at(back, int(9, 17), int(0, 59)), by: 'p5', photos: int(1, 3), urls: [], note: '' };
      s.items.forEach(i => { i.got = i.qty; });
      s.history = hist(route, pl, k, s.received.at, step);
      s.history.push({ at: s.received.at, by: 'p5', text: 'Принято на складе', source: Ships.SRC.receipt, auto: true });
    } else {
      if (slot.stage === 'ordered') { const d = int(1, 7); s.depart = at(-d, 12); s.eta = at(-(d + T), 12); }
      else if (slot.late) { const d = slot.stage === 'arrived' ? int(1, 6) : int(1, 9); s.eta = at(d, 12); s.depart = at(d + T, 12); }
      else { const left = slot.stage === 'arrived' ? 0 : Math.ceil((1 - p) * T); s.eta = at(-left, 12); s.depart = at(T - left, 12); }
      s.history = hist(route, pl, k, at(slot.late ? int(1, 3) : 0, int(7, 11), int(0, 59)), step);
    }
    shipments.push(s);
  });

  // отгрузка клиенту от v2 — единственная исходящая
  shipments.push({
    id: 'О-207', number: 'О-207 (демо)', dir: 'out', deal: 'Д-305', supplier: 'Наш склад', to: 'Объект Д-305 · Волкова Мария',
    carrier: 'Своя машина', track: 'Отгрузка О-207', pipeId: 'shipsOut', stageId: 'onWay', eta: at(0, 16),
    history: [{ at: at(0, 11, 0), by: 'p6', text: 'Выехали со склада', source: Ships.SRC.manual }],
    items: [{ productId: 'PV-550M', qty: 12 }, { productId: 'MNT-R4', qty: 3 }, { productId: 'CAB-6R', qty: 60 }], demo: true,
  });

  st.shipments = shipments;
});

// База: правила директора по умолчанию (Настройки → Поставки); третье выключено — пример выключенного. «Прибыло в город»
// и «На складе» ставит только «принято на складе» (Pipes.ruleMayTo): прибытие отмечает шаг перевозчика, склад — приёмка
BASES.push(st => {
  st.shipRules = [
    { id: 'sr1', on: true, when: 'received', then: 'inStock' },
    { id: 'sr2', on: true, when: 'customs', then: 'transship' },
    { id: 'sr3', on: false, when: 'customs', then: 'toStock' },
  ];
});
