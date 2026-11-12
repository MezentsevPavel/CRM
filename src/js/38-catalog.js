// Ядро: каталог товаров и склейка снимка остатков с каталогом. Чистая логика, без DOM.
// Источники — снимки CATALOG (10-catalog-data.js, таблица PVCalc) и STOCK_SNAPSHOT (11-stock-data.js, таблица менеджеров).
// Здесь же шаг SEEDS: настоящие товары и остатки вместо выдуманных товаров прототипа v2.

const Catalog = (() => {
  // Название для сравнения: без регистра, ё = е, без кавычек, любые тире = «-» без пробелов вокруг, один пробел.
  const norm = name => String(name ?? '').toLowerCase().replace(/ё/g, 'е')
    .replace(/[«»“”„"'`´]/g, '')
    .replace(/\s*[-‐‑‒–—−]\s*/g, '-')
    .replace(/\s+/g, ' ').trim();

  // Категории товаров: подписи на экране. Вид позиции каталога (колонка «Вид») и раздел таблицы менеджеров сводятся к ним.
  const CATS = ['Панели', 'Инверторы', 'ИБП', 'Аккумуляторы', 'Контроллеры', 'Защита и соединения', 'Кабель'];
  const KIND_CAT = { 'панель': 'Панели', 'инвертор': 'Инверторы', 'АКБ': 'Аккумуляторы', 'защита и соединения': 'Защита и соединения', 'кабель': 'Кабель' };
  const SECTION_CAT = {
    'солнечные панели': 'Панели',
    'инверторы / ибп / конвертеры': 'Инверторы',
    'контроллеры заряда': 'Контроллеры',
    'аккумуляторные батареи': 'Аккумуляторы',
    'соединительное и защитное оборудование': 'Защита и соединения',
  };
  // Раздел листа остатков («Корень › Подраздел») → категория. Крепёж лежит в разделе панелей, но в каталоге
  // сайта он — «защита и соединения». Незнакомый раздел остаётся как в таблице: ничего не теряется.
  // Верхняя категория по виду позиции каталога («инвертор») или по уже записанному пути («Инверторы › Гибридные»)
  const topOf = c => KIND_CAT[c] || String(c ?? '').split(' › ')[0];
  function sectionCat(section) {
    const [root, ...sub] = String(section ?? '').split(' › ');
    if (sub.some(s => norm(s).includes('крепеж'))) return 'Защита и соединения';
    return SECTION_CAT[norm(root)] || String(root).trim();
  }

  const isNum = v => typeof v === 'number' && isFinite(v);

  // ——— вид внутри категории (слова директора 2026-11-08) ———
  // Инверторы → Сетевые / Гибридные / Автономные; ИБП — отдельная категория; Аккумуляторы → по химии и конструкции; Контроллеры → MPPT / PWM (ШИМ);
  // Защита и соединения → по назначению; Панели — без видов. Вид определяется по данным позиции в таком порядке: столбцы таблицы каталога
  // (spec: «Гибрид (с АКБ)» да/нет, «Химия»), потом ссылка на сайте (его раздел), потом слова в названии. Нигде не сказано — «Без подкатегории»,
  // ничего не выдумывается. Это чистая функция: её берут и tools/catalog-snapshot.js (путь пишется в снимок), и Catalog.build/merge.
  const SUB_NONE = 'Без подкатегории';
  const SUBS = {
    'Инверторы': ['Сетевые', 'Гибридные', 'Автономные'],
    'Аккумуляторы': ['Литий-железофосфат (LiFePO4)', 'АГМ', 'Гель', 'АГМ+Гель', 'Гель-карбон', 'АГМ-карбон'],
    'Контроллеры': ['MPPT', 'PWM (ШИМ)'],
    'Защита и соединения': ['Автоматические выключатели', 'Предохранители', 'УЗИП', 'Контакторы', 'Коннекторы MC4', 'Наконечники', 'Кабель и провода',
      'Щиты, корпуса и боксы', 'Крепёж и монтаж', 'Измерительные приборы'],
  };
  // Узлы, которые есть в дереве всегда (даже пустые): верхний уровень в привычном порядке, у каждого — виды. «Без подкатегории» сюда не входит:
  // он появляется, когда в него попадает товар.
  const STRUCT = CATS.filter(c => c !== 'Кабель').map(c => [c, SUBS[c] || []]);
  const STRUCT_PATHS = STRUCT.flatMap(([top, subs]) => [top, ...subs.map(s => top + ' › ' + s)]);
  const has = (t, re) => re.test(t);
  // слово целиком (в JS \b для кириллицы не работает)
  const word = w => new RegExp('(^|[^a-zа-я0-9])(' + w + ')($|[^a-zа-я0-9])');
  const UPS = word('ибп|ups|источник бесперебойного питания');
  const first = (t, rules) => { for (const [re, sub] of rules) if (re.test(t)) return sub; return null; };
  const inverterSub = (t, url, spec) => {
    const h = norm(spec.hybrid);
    if (/автоном/.test(t)) return 'Автономные';
    if (h === 'да') return 'Гибридные';
    if (h === 'нет') return 'Сетевые';
    if (/hybrid/i.test(url)) return 'Гибридные';
    if (/on-grid/i.test(url)) return 'Сетевые';
    return first(t, [[/гибрид|hybrid/, 'Гибридные'], [/сетев|микроинвертор/, 'Сетевые']]);
  };
  const BAT_NOT = /зарядн|charger|балансир|equalizer|развязк|(^|[^а-я])ура($|[^а-я])/;
  const batteryText = t => first(t, [
    [/agm\s*[+\-\/]?\s*carbon|агм\s*[+\-\/]?\s*карбон/, 'АГМ-карбон'],
    [/gel\s*[+\-\/]?\s*carbon|гель\s*[+\-\/]?\s*карбон/, 'Гель-карбон'],
    [/agm\s*[+\/]\s*gel|gel\s*[+\/]\s*agm|агм\s*[+\/]\s*гель|гель\s*[+\/]\s*агм/, 'АГМ+Гель'],
    [word('agm|агм'), 'АГМ'],
    [word('gel|гель'), 'Гель'],
    [/lifepo4|lfp|литий-?железо/, 'Литий-железофосфат (LiFePO4)'],
  ]);
  const batterySub = (t, url, spec) => {
    if (BAT_NOT.test(t)) return null;
    return batteryText(norm(spec.chem)) || batteryText(String(url).toLowerCase()) || batteryText(t);
  };
  // Вид — по названию, а если в названии не сказано (DY1024DU, Epsolar LS 2024E) — по разделу сайта в ссылке (…/pwm-kontrollery-zaryada-2/…, …/mppt-…)
  const controllerKind = t => {
    const m = /mppt/.test(t), p = /pwm|(^|[^а-я])шим($|[^а-я])/.test(t);
    return m === p ? null : (m ? 'MPPT' : 'PWM (ШИМ)');
  };
  const controllerSub = (t, url) => controllerKind(t) || controllerKind(String(url || '').toLowerCase());
  const protectionSub = t => first(t, [
    [/крепл|кронштейн|зажим(?! для провод)|рейлинг|профиль|профтруб|опора|опоры|стыков|уголки|стоек|монтаж|clamp|держатель под кабель/, 'Крепёж и монтаж'],
    [/предохранител|fuse|муляж/, 'Предохранители'],
    [/узип|перенапряжен|устройство защиты|(^|[^a-z])spd($|[^a-z])|surge/, 'УЗИП'],
    [/авт(оматический)?\.? ?выключател|дифференциальный автомат|(^|[^а-я])автомат($|[^а-я])/, 'Автоматические выключатели'],
    [/контактор/, 'Контакторы'],
    [/диод/, null],
    [/коннектор|mc-?4|разъем|разъём/, 'Коннекторы MC4'],
    [/наконечник/, 'Наконечники'],
    [/кабель|провод|solar cable/, 'Кабель и провода'],
    [/корпус|щрн|бокс|щит|блок распределительный/, 'Щиты, корпуса и боксы'],
    [/измеритель|токоизмерительн|счетчик|счётчик/, 'Измерительные приборы'],
  ]);
  const SUB_FN = { 'Инверторы': inverterSub, 'Аккумуляторы': batterySub, 'Контроллеры': controllerSub, 'Защита и соединения': (t) => protectionSub(t) };
  // top — верхняя категория позиции (Инверторы, Аккумуляторы…); o = {name, url?, spec?: {hybrid: 'да'|'нет', chem}}.
  // → путь категории: «Инверторы › Гибридные», «ИБП», «Аккумуляторы › АГМ», «Панели» (у категории нет видов) или «Инверторы › Без подкатегории».
  function classify(top, o = {}) {
    const t = norm(o.name), fn = SUB_FN[top];
    if (!fn) return top;
    if (top === 'Инверторы' && has(t, UPS)) return 'ИБП';
    const sub = fn(t, o.url || '', o.spec || {});
    return top + SEP + (sub || SUB_NONE);
  }
  // Название без регистра, пробелов и знаков: для поиска кода модели внутри другого названия
  const codeKey = s => norm(s).replace(/[^a-zа-я0-9]+/g, '');
  const hasLetterAndDigit = k => /[a-zа-я]/.test(k) && /\d/.test(k);
  // Позиция листа остатков без пары в каталоге: вид по её названию (classify); если он не назван — пара «по коду модели»: код модели позиции
  // каталога (артикул) целиком внутри названия листа или название листа целиком внутри названия каталога (не короче 6 знаков, буквы и цифры),
  // и все такие позиции каталога в одном виде. Не нашлось или виды разные — «Без подкатегории». pool — позиции каталога (inCatalog).
  function classifyLoose(top, name, pool) {
    const own = classify(top, { name });
    if (own !== top && !own.endsWith(SEP + SUB_NONE)) return own;
    if (!SUB_FN[top]) return own;
    const k = codeKey(name);
    if (k.length < 6 || !hasLetterAndDigit(k)) return own;
    const kinds = new Set();
    for (const c of pool) {
      if (c.cat !== top && !String(c.cat).startsWith(top + SEP)) continue;
      const m = codeKey(c.name), s = codeKey(c.sku);
      if ((m.length >= 6 && m.includes(k)) || (s.length >= 6 && hasLetterAndDigit(s) && k.includes(s))) kinds.add(c.cat);
    }
    const [one] = kinds;
    return kinds.size === 1 && !one.endsWith(SEP + SUB_NONE) ? one : own;
  }

  // Снимки → {products, stock, aside, unmatched}.
  // products: все позиции каталога (id = ключ каталога, inCatalog:true), затем строки остатков, не нашедшие пару
  //   (id 'sheet-NNN' по номеру строки, inCatalog:false — на экране «нет в каталоге»).
  // Строка остатков склеивается с позицией, только когда norm(название) совпал с norm(модель) ровно у одной позиции
  //   и ровно у одной строки остатков. Похожее, но не совпавшее, и неоднозначное не склеивается.
  // stock[productId][entityId]['_'] — остаток по юрлицу; города в таблице нет → ключ '_'. Пусто остаётся пусто, не 0.
  // aside[productId] = {damaged, custody, transitNoShip} — «Бой», ответхранение, «В пути»; есть, если заполнено хоть что-то.
  // unmatched: [{productId, name}] — строки остатков без пары в каталоге; ids[i] — товар i-й строки остатков.
  // opts.named (перенос из CSV, Import.applyStock): id товара без пары — 'sheet:' + нормализованное название (у второй строки
  //   с тем же названием — «#2»), а не по номеру строки: повторный перенос попадает в те же товары.
  function build(catalog, snapshot, opts = {}) {
    const products = catalog.rows.map(r => {
      const p = {
        id: String(r.key), name: r.model, brand: r.brand ?? null, cat: KIND_CAT[r.cat] || r.cat,
        price: isNum(r.price) ? r.price : null, avail: r.avail ?? null, url: r.url ?? null,
        src: 'catalog', inCatalog: true, sheet: r.sheet,
      };
      // артикул, единица и «цена поставщика» (лист «Электрика»): поле есть, только когда в таблице оно заполнено — иначе «нет данных»
      if (r.sku) p.sku = r.sku;
      if (r.unit) p.unit = r.unit;
      if (r.supplier) p.supplier = r.supplier;
      if (isNum(r.supplierPrice)) p.supplierPrice = r.supplierPrice;
      if (r.priceDate) p.priceDate = r.priceDate;
      return p;
    });
    const pool = products.slice();   // позиции каталога: по ним ищется вид у позиций листа остатков без пары
    const byName = new Map();
    for (const p of products) { const k = norm(p.name); byName.set(k, [...(byName.get(k) || []), p.id]); }
    const rowsPerName = new Map();
    for (const r of snapshot.rows) { const k = norm(r.name); rowsPerName.set(k, (rowsPerName.get(k) || 0) + 1); }

    const stock = {}, aside = {}, unmatched = [], ids = [], used = new Set(products.map(p => p.id));
    snapshot.rows.forEach((r, i) => {
      const k = norm(r.name), same = byName.get(k);
      let id;
      if (same && same.length === 1 && rowsPerName.get(k) === 1) id = same[0];
      else {
        id = opts.named ? namedId(k, used) : 'sheet-' + String(i + 1).padStart(3, '0');
        products.push({ id, name: r.name, brand: null, cat: classifyLoose(sectionCat(r.cat), r.name, pool), price: null, avail: null, url: null, src: 'sheet', inCatalog: false });
        unmatched.push({ productId: id, name: r.name });
      }
      ids.push(id);
      for (const e of ['ip', 'npp', 'vs']) if (isNum(r[e])) (stock[id] || (stock[id] = {}))[e] = { _: r[e] };
      const a = { damaged: isNum(r.damaged) ? r.damaged : null, custody: isNum(r.custody) ? r.custody : null, transitNoShip: isNum(r.transit) ? r.transit : null };
      if (Object.values(a).some(v => v !== null)) aside[id] = a;
    });
    return { products, stock, aside, unmatched, ids };
  }
  // id товара листа по нормализованному названию; одинаковые названия различаются номером
  const NAMED_MAX = 120;
  function namedId(normName, used) {
    const key = 'sheet:' + normName.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, NAMED_MAX).trim();
    let id = key, n = 1;
    while (used.has(id)) id = key + '#' + (++n);
    used.add(id);
    return id;
  }

  // Товар, заведённый руками: единственное место, где он создаётся — форма «Новый товар» и «Оприходовать товар» (Import.applyReceipt).
  // o: {name, cat?, unit?, price?, sku?}. Категория не названа — NO_CAT (так же подписан товар листа остатков без раздела), единица и цена
  // не названы — пусто («нет данных»), не ноль. Название, уже стоящее в номенклатуре (Catalog.norm), — отказ: второй такой не заводится.
  // → {ok, product} | {ok:false, reason}; при отказе st не меняется.
  const NO_CAT = 'Без раздела';
  function add(st, o = {}) {
    const name = String(o.name ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    if (!name) return { ok: false, reason: 'Нужно наименование.' };
    if (st.products.some(p => norm(p.name) === norm(name))) return { ok: false, reason: `Товар «${name}» уже есть в номенклатуре.` };
    // категория — путь «Электрика › Автоматы»; такой категории в дереве нет — она заводится (ensure), чтобы товар не висел вне дерева
    const product = { id: Store.freeId(st.products, 'u'), name, brand: null, cat: ensure(st, o.cat), price: isNum(o.price) ? o.price : null, avail: null, url: null, src: 'user', inCatalog: false };
    if (o.unit) product.unit = o.unit;
    if (skuClean(o.sku)) product.sku = skuClean(o.sku);
    st.products.push(product);
    return { ok: true, product };
  }

  const blank = v => v === undefined || v === null || v === '';
  // Товар поставщика (лист «Электрика»): у него есть цена поставщика, а цена продажи может быть пуста
  const isSupplier = p => !!p && (p.sheet === 'Электрика' || !blank(p.supplier) || !blank(p.supplierPrice));

  // Довести номенклатуру до снимка, ничего не стирая (шаг MIGRATIONS[21] рабочей базы и кнопка «Обновить каталог из снимка»):
  // товара снимка с таким id нет — добавляется; есть — в него ставятся sku, supplier, supplierPrice, priceDate, url только там, где у товара
  // они пусты. Введённое вручную, название, цена продажи и категория не меняются. Путь товара снимка, которого нет в дереве категорий,
  // заводится в дерево. Товары снимка и так приходят в каждую базу из кода (Docs.join), документом лежит только правленый товар, поэтому
  // «добавлено» бывает редко, а «допишет» — у правленых; дерево — документы базы, само не растёт.
  // Вид внутри категории (шаг 22): товар, чья категория — прежняя верхняя («Инверторы», не правленная руками), получает вид из снимка
  // («Инверторы › Гибридные»; ИБП из «Инверторов» уходят в «ИБП»). Товар, которому директор поставил другую категорию, не меняется.
  // Позиции листа остатков (не из снимка) получают вид по названию — recat.
  // skip — id, которые не возвращать (снятые из списка). → {added: [id], filled: [id], recat: [id], skuSet, categories: [id новых узлов дерева]};
  // filled включает и перекатегоризованные. st меняется на месте, записать надо перечисленное.
  function merge(st, snapshot, skip = []) {
    if (!Array.isArray(st.products)) st.products = [];
    const had = new Set(nodes(st).map(c => c.id)), byId = new Map(st.products.map(p => [p.id, p]));
    const out = { added: [], filled: [], recat: [], skuSet: 0, categories: [] };
    ensureStruct(st);
    for (const b of build(snapshot, { rows: [] }).products) {
      let p = byId.get(b.id);
      if (!p && skip.includes(b.id)) continue;
      if (!p) {
        p = { ...b, cat: ensure(st, b.cat) };
        st.products.push(p); byId.set(p.id, p); out.added.push(p.id);
        continue;
      }
      let got = false;
      for (const f of ['sku', 'supplier', 'supplierPrice', 'priceDate', 'url']) {
        if ((f === 'sku' ? skuOf(p) === '' : blank(p[f])) && !blank(b[f])) {
          p[f] = b[f]; got = true;
          if (f === 'sku') out.skuSet++;
        }
      }
      if (plainTop(p.cat, b.cat)) { p.cat = ensure(st, b.cat); out.recat.push(p.id); got = true; }
      if (got) out.filled.push(p.id);
      if (!hasPath(st, p.cat)) ensure(st, p.cat);
    }
    for (const id of recat(st)) { out.recat.push(id); if (!out.filled.includes(id)) out.filled.push(id); }
    out.categories = nodes(st).filter(c => !had.has(c.id)).map(c => c.id);
    return out;
  }

  // Категория, которая до видов была верхней (теперь у неё есть подкатегории)
  const LEGACY_TOPS = ['Инверторы', 'Аккумуляторы', 'Контроллеры', 'Защита и соединения'];
  // old — категория товара сейчас, now — категория по снимку: old была прежней верхней, а now — её вид (или ИБП из «Инверторов»)
  const plainTop = (old, now) => LEGACY_TOPS.includes(old) && old !== now && (String(now).startsWith(old + ' › ') || (old === 'Инверторы' && now === 'ИБП'));
  // Позиции листа остатков (src 'sheet', не из снимка) с прежней верхней категорией получают вид по названию (classifyLoose; пара по коду
  // модели ищется среди позиций каталога). → id изменённых; дерево дополняется.
  function recat(st) {
    const pool = (st.products || []).filter(p => p.inCatalog), out = [];
    for (const p of st.products || []) {
      if (p.inCatalog || p.src !== 'sheet' || !LEGACY_TOPS.includes(p.cat)) continue;
      const now = classifyLoose(p.cat, p.name, pool);
      if (now !== p.cat) { p.cat = ensure(st, now); out.push(p.id); }
    }
    return out;
  }

  // ——— категории деревом ———
  // st.categories — узлы {id, name, parentId|null}: дерево ведёт сам пользователь («Электрика» → «Автоматы» → «АВР»). У товара
  // по-прежнему одна строка product.cat — путь «Электрика › Автоматы» (так подписаны и товары листа остатков), поэтому остальной код,
  // снимки и отчёты не меняются; путь строится из дерева только здесь (pathOf). «Без раздела» (NO_CAT) — не узел, а подпись товара без
  // категории: она есть всегда, её нельзя ни переименовать, ни удалить.
  const SEP = ' › ';
  const CAT_MAX = 100;
  const cname = s => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  const isNoCat = c => !String(c ?? '').trim() || c === NO_CAT;
  const nodes = st => (Array.isArray(st.categories) ? st.categories : []);
  const kidsOf = (st, parentId) => nodes(st).filter(c => (c.parentId || null) === (parentId || null));
  // Путь узла; узла нет или цепочка зациклена — ''
  function pathOf(st, id) {
    const by = new Map(nodes(st).map(c => [c.id, c])), names = [];
    let c = by.get(id), n = 0;
    while (c && n++ < 64) { names.unshift(c.name); c = c.parentId ? by.get(c.parentId) : null; }
    return n <= 64 ? names.join(SEP) : '';
  }
  // Узел по пути (без учёта регистра и лишних пробелов, как norm); нет такого — null
  function nodeOf(st, path) {
    let parent = null, node = null;
    for (const seg of String(path ?? '').split(SEP)) {
      const k = norm(seg);
      if (!k) return null;
      node = kidsOf(st, parent).find(c => norm(c.name) === k);
      if (!node) return null;
      parent = node.id;
    }
    return node;
  }
  // Годится ли строка как категория товара: «Без раздела» (или пусто) либо путь, который есть в дереве
  const hasPath = (st, path) => isNoCat(path) || !!nodeOf(st, path);
  // Путь заведён в дерево (недостающие узлы создаются) → путь так, как он записан в дереве; пустой путь — NO_CAT.
  // Знак «›» в названии уровня заменяется на «-»: им разделяются уровни.
  function ensure(st, path) {
    if (isNoCat(path)) return NO_CAT;
    if (!Array.isArray(st.categories)) st.categories = [];
    let parent = null;
    const names = [];
    for (const raw of String(path).split(SEP)) {
      const name = cname(raw).replace(/›/g, '-').slice(0, CAT_MAX);
      if (!name) continue;
      let node = kidsOf(st, parent).find(c => norm(c.name) === norm(name));
      if (!node) { node = { id: Store.freeId(st.categories, 'c'), name, parentId: parent }; st.categories.push(node); }
      parent = node.id;
      names.push(node.name);
    }
    return names.length ? names.join(SEP) : NO_CAT;
  }
  // Дерево по товарам: верхний уровень — привычный порядок CATS, потом по алфавиту; внутри — по алфавиту. Для базы, демо и миграции.
  function treeFrom(products) {
    const st = { categories: [] };
    ensureStruct(st);
    const top = c => String(c).split(SEP)[0], rank = c => { const i = CATS.indexOf(top(c)); return i < 0 ? CATS.length : i; };
    const paths = [...new Set((products || []).map(p => p.cat).filter(c => !isNoCat(c)))]
      .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'ru'));
    for (const p of paths) ensure(st, p);
    return st.categories;
  }
  // Постоянные узлы дерева (STRUCT): верхний уровень в привычном порядке и виды внутри; недостающие заводятся, лишнего не трогаем
  function ensureStruct(st) { for (const path of STRUCT_PATHS) ensure(st, path); }
  // Привести дерево в порядок после того, как товары пришли снаружи (перенос остатков): недостающие узлы заводятся, путь товара
  // становится таким, как в дереве
  function syncTree(st) {
    for (const p of st.products || []) if (!isNoCat(p.cat)) { const c = ensure(st, p.cat); if (c !== p.cat) p.cat = c; }
  }
  const under = (cat, path) => cat === path || String(cat).startsWith(path + SEP);
  // Сколько товаров лежит в категории (с подкатегориями) и сколько в ней прямых подкатегорий
  function busy(st, id) {
    const path = pathOf(st, id);
    return { path, products: path ? (st.products || []).filter(p => under(p.cat, path)).length : 0, children: kidsOf(st, id).length };
  }
  // Название и место узла годятся? → текст отказа | null. selfId — узел, который правят (сам себе не двойник)
  function nameProblem(st, name, parentId, selfId) {
    if (!name) return 'Нужно название категории.';
    if (name.length > CAT_MAX) return `Название категории — не длиннее ${CAT_MAX} знаков.`;
    if (name.includes('›')) return 'В названии категории нельзя знак «›»: им разделяются уровни.';
    if (!parentId && norm(name) === norm(NO_CAT)) return `«${NO_CAT}» — подпись товаров без категории, назовите иначе.`;
    if (parentId && !nodes(st).some(c => c.id === parentId)) return 'Родительской категории нет.';
    if (kidsOf(st, parentId).some(c => c.id !== selfId && norm(c.name) === norm(name))) {
      return parentId ? `В «${pathOf(st, parentId)}» уже есть «${name}».` : `Категория «${name}» уже есть на верхнем уровне.`;
    }
    return null;
  }
  // Новая категория: o = {name, parentId?} (parentId пусто — верхний уровень). → {ok, node, path} | {ok: false, reason}
  function catAdd(st, o = {}) {
    const name = cname(o.name), parentId = o.parentId || null, bad = nameProblem(st, name, parentId, null);
    if (bad) return { ok: false, reason: bad };
    if (!Array.isArray(st.categories)) st.categories = [];
    const node = { id: Store.freeId(st.categories, 'c'), name, parentId };
    st.categories.push(node);
    return { ok: true, node, path: pathOf(st, node.id) };
  }
  // Заменить начало пути у товаров: «Электрика › Автоматы» → «Электрика › Автоматика» у самой категории и всех подкатегорий
  function rewrite(st, was, now) {
    let n = 0;
    for (const p of st.products || []) {
      if (p.cat === was) { p.cat = now; n++; } else if (String(p.cat).startsWith(was + SEP)) { p.cat = now + p.cat.slice(was.length); n++; }
    }
    return n;
  }
  // Узел id лежит внутри узла ancestorId (или это он сам)
  function isInside(st, id, ancestorId) {
    const by = new Map(nodes(st).map(c => [c.id, c]));
    for (let c = by.get(id), n = 0; c && n++ < 64; c = c.parentId ? by.get(c.parentId) : null) if (c.id === ancestorId) return true;
    return false;
  }
  // Переименовать и/или перенести под другого родителя: o = {name?, parentId?} (parentId '' — на верхний уровень). Пути товаров
  // обновляются здесь же — вызывающий сохраняет всё одним save(). → {ok, node, was, now, moved: сколько товаров сменили путь}
  function catEdit(st, id, o = {}) {
    const node = nodes(st).find(c => c.id === id);
    if (!node) return { ok: false, reason: 'Такой категории нет.' };
    const name = o.name === undefined ? node.name : cname(o.name), parentId = o.parentId === undefined ? (node.parentId || null) : (o.parentId || null);
    if (parentId && isInside(st, parentId, id)) return { ok: false, reason: 'Нельзя перенести категорию внутрь себя или своей подкатегории.' };
    const bad = nameProblem(st, name, parentId, id);
    if (bad) return { ok: false, reason: bad };
    const was = pathOf(st, id);
    node.name = name; node.parentId = parentId;
    const now = pathOf(st, id);
    return { ok: true, node, was, now, moved: was === now ? 0 : rewrite(st, was, now) };
  }
  // Удалить пустую категорию (ни товаров, ни подкатегорий); иначе отказ с тем, что мешает
  function catDelete(st, id) {
    const node = nodes(st).find(c => c.id === id);
    if (!node) return { ok: false, reason: 'Такой категории нет.' };
    const b = busy(st, id), why = [];
    if (b.children) why.push(`${b.children} ${pl(b.children, 'подкатегория', 'подкатегории', 'подкатегорий')}`);
    if (b.products) why.push(`${b.products} ${pl(b.products, 'товар', 'товара', 'товаров')}`);
    if (why.length) return { ok: false, reason: `Удалить «${b.path}» нельзя: в ней ${why.join(' и ')}. Сначала перенесите или удалите их.` };
    st.categories.splice(st.categories.indexOf(node), 1);
    return { ok: true, path: b.path };
  }
  // Сменить категорию товара на путь из дерева (или NO_CAT). → {ok, product} | {ok: false, reason}
  function setCat(st, productId, path) {
    const p = (st.products || []).find(x => x.id === productId);
    if (!p) return { ok: false, reason: 'Такого товара нет.' };
    if (!hasPath(st, path)) return { ok: false, reason: `Категории «${path}» нет в списке категорий.` };
    const node = nodeOf(st, path);
    p.cat = node ? pathOf(st, node.id) : NO_CAT;
    return { ok: true, product: p };
  }
  // Для экрана: категории в порядке дерева, {path, name, depth, id, total, own, virtual}. total — товаров в категории с подкатегориями.
  // Путь, который есть у товаров, но которого нет в дереве (старые данные), показывается узлом без id (virtual): товары не теряются.
  function rows(st) {
    const own = new Map();
    for (const p of st.products || []) if (!isNoCat(p.cat)) own.set(p.cat, (own.get(p.cat) || 0) + 1);
    const root = { path: '', kids: [] }, by = new Map();
    const walk = (parentId, parent) => {
      for (const c of kidsOf(st, parentId)) {
        const path = parent.path ? parent.path + SEP + c.name : c.name, n = { path, name: c.name, id: c.id, kids: [] };
        parent.kids.push(n); by.set(path, n); walk(c.id, n);
      }
    };
    walk(null, root);
    for (const full of [...own.keys()].sort((a, b) => a.localeCompare(b, 'ru'))) {
      let parent = root;
      full.split(SEP).forEach((seg, i, all) => {
        const path = all.slice(0, i + 1).join(SEP);
        let n = by.get(path);
        if (!n) { n = { path, name: seg, id: '', virtual: true, kids: [] }; parent.kids.push(n); by.set(path, n); }
        parent = n;
      });
    }
    const out = [];
    const flat = (list, depth) => {
      for (const n of list) {
        const row = { path: n.path, name: n.name, depth, id: n.id, virtual: !!n.virtual, own: own.get(n.path) || 0, total: 0 };
        out.push(row);
        const at = out.length;
        flat(n.kids, depth + 1);
        row.total = row.own + out.slice(at).filter(r => r.depth === depth + 1).reduce((a, r) => a + r.total, 0);
      }
    };
    flat(root.kids, 0);
    return out;
  }

  // Категории, которые есть у товаров: сначала привычный порядок CATS, потом остальные по алфавиту.
  function cats(st) {
    const have = new Set(st.products.map(p => p.cat));
    return [...CATS.filter(c => have.has(c)), ...[...have].filter(c => !CATS.includes(c)).sort((a, b) => a.localeCompare(b, 'ru'))];
  }
  // Бренды товаров категории cat вместе с подкатегориями (слова директора: выбрал инверторы — в брендах бренды инверторов, не панелей);
  // cat пусто или «Все» — все бренды; NO_CAT — бренды товаров без категории.
  function brands(st, cat) {
    const all = !cat || cat === 'Все';
    const list = all ? st.products : st.products.filter(p => (cat === NO_CAT ? isNoCat(p.cat) : under(p.cat, cat)));
    return [...new Set(list.map(p => p.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
  }
  // Бренды категории (с подкатегориями) с числом товаров: [{brand, n}] по алфавиту; товары без бренда — «Без бренда» в конце, но только когда
  // у других товаров бренд есть (если брендов нет совсем, уровня «фирма» нет). Один источник для узлов дерева и списка «Бренд» — они согласованы.
  const NO_BRAND = 'Без бренда';
  function brandRows(st, cat) {
    const all = !cat || cat === 'Все';
    const list = all ? st.products : st.products.filter(p => (cat === NO_CAT ? isNoCat(p.cat) : under(p.cat, cat)));
    const count = new Map();
    let none = 0;
    for (const p of list) { if (p.brand) count.set(p.brand, (count.get(p.brand) || 0) + 1); else none++; }
    const out = [...count].sort((a, b) => a[0].localeCompare(b[0], 'ru')).map(([brand, n]) => ({ brand, n }));
    if (out.length && none) out.push({ brand: NO_BRAND, n: none });
    return out;
  }

  // ——— артикул ———
  // Артикул (product.sku) — строка, необязательная: у товара без артикула поля нет или оно пусто («Артикул: нет данных»). Не ключ каталога
  // (product.id) и из него не берётся. Правит право catalog. Один и тот же артикул у двух товаров не запрещён — на экране предупреждение.
  const SKU_MAX = 60;
  const skuClean = s => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, SKU_MAX).trim();
  const skuOf = p => skuClean(p && p.sku);
  // Артикул для сравнения и поиска: без регистра, ё = е, без пробелов, дефисов, точек, подчёркиваний и косых («ABC-123» = «abc 123» = «ABC123»)
  const skuKey = s => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[\s\-‐‑‒–—−_./\\]+/g, '');
  // Товары с этим артикулом (по skuKey, целиком); пустой артикул не ищется. except — id товара, который не считается
  const bySku = (st, sku, except) => {
    const k = skuKey(sku);
    return k ? (st.products || []).filter(p => p.id !== except && skuKey(p.sku) === k) : [];
  };
  // Подпись товара для текста без разметки (уведомления, журнал, тосты): «Название (арт. X)»; нет артикула — одно название
  const label = p => (p ? String(p.name ?? '') + (skuOf(p) ? ` (арт. ${skuOf(p)})` : '') : 'нет данных: товар');
  // Поставить или убрать артикул: → {ok, product, same: [товары с таким же артикулом], was}; пусто — убрать. Дубль — не отказ, а same
  function setSku(st, productId, sku) {
    const p = (st.products || []).find(x => x.id === productId);
    if (!p) return { ok: false, reason: 'Такого товара нет.' };
    const v = skuClean(sku), was = skuOf(p);
    if (String(sku ?? '').trim().length > SKU_MAX) return { ok: false, reason: `Артикул — не длиннее ${SKU_MAX} знаков.` };
    if (v) p.sku = v; else delete p.sku;
    return { ok: true, product: p, was, same: v ? bySku(st, v, p.id) : [] };
  }

  // Поиск и фильтры: q — слова через пробел, каждое должно встретиться в названии, бренде, ключе или артикуле (артикул — без регистра,
  // пробелов и дефисов, и целиком, и частью; точное совпадение артикула — в начале списка);
  // brand, avail ('в наличии' | 'предзаказ') — точное совпадение; cat — путь категории: берутся товары и самой категории, и всех её
  // подкатегорий (NO_CAT — товары без категории); inCatalog — true | false. Пустое не фильтрует.
  // Слово запроса — в названии, бренде, ключе или артикуле; артикул сравнивается по skuKey (без пробелов и дефисов), целиком или частью.
  // Вся строка запроса целиком тоже может быть артикулом («ABC 123» ищет «ABC-123»).
  function matchText(p, words, qKey) {
    const hay = norm(p.name + ' ' + (p.brand || '') + ' ' + p.id), sk = skuKey(p.sku);
    if (qKey && sk && sk.includes(qKey)) return true;
    return words.every(w => hay.includes(w) || (sk && skuKey(w) && sk.includes(skuKey(w))));
  }
  function query(st, { q, cat, brand, avail, inCatalog } = {}) {
    const words = norm(q).split(' ').filter(Boolean), qKey = skuKey(q);
    const out = st.products.filter(p =>
      (!cat || (cat === NO_CAT ? isNoCat(p.cat) : under(p.cat, cat))) && (!brand || (brand === NO_BRAND ? !p.brand : p.brand === brand)) && (!avail || p.avail === avail) &&
      (inCatalog === undefined || inCatalog === null || p.inCatalog === inCatalog) &&
      (!words.length || matchText(p, words, qKey)));
    // точное совпадение артикула — первым (порядок остальных не меняется)
    return qKey ? [...out.filter(p => skuKey(p.sku) === qKey), ...out.filter(p => skuKey(p.sku) !== qKey)] : out;
  }

  // ——— снимок не живёт в сохранении браузера ———
  // Товары снимка (src 'catalog' и 'sheet') — константы файла: в сохранение они не пишутся, при загрузке встают из build().
  // В сохранении только изменяемое: товары, добавленные руками, правки полей товаров снимка и id снятых из списка.
  // Метка catalogSnapshot в записи говорит «товары снимка здесь не лежат»; без неё список товаров читается как есть.
  let baseCache = null;
  const base = () => {
    if (!baseCache) {
      // Рабочая база (SERVER): снимка остатков 31.10 в ней нет — остатки появляются только переносом (Import.applyStock)
      const built = build(CATALOG, SERVER ? { rows: [] } : STOCK_SNAPSHOT);
      baseCache = { ...built, byId: new Map(built.products.map(p => [p.id, p])) };
    }
    return baseCache;
  };
  const isSnap = p => p && (p.src === 'catalog' || p.src === 'sheet') && base().byId.has(p.id);
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

  // Список товаров состояния → поля для записи в сохранение; null — в списке нет товаров снимка (пишется как есть).
  function pack(products) {
    if (!Array.isArray(products) || !products.some(isSnap)) return null;
    const own = [], edits = {}, seen = new Set();
    for (const p of products) {
      if (!isSnap(p)) { own.push(p); continue; }
      seen.add(p.id);
      const ref = base().byId.get(p.id), diff = {};
      for (const k of new Set([...Object.keys(p), ...Object.keys(ref)])) if (!same(p[k], ref[k])) diff[k] = p[k] ?? null;
      if (Object.keys(diff).length) edits[p.id] = diff;
    }
    const removed = [...base().byId.keys()].filter(id => !seen.has(id));
    const out = { products: own, catalogSnapshot: CATALOG.snapshot };
    if (Object.keys(edits).length) out.productEdits = edits;
    if (removed.length) out.productsRemoved = removed;
    return out;
  }

  // Прочитанное состояние: товары снимка возвращаются на место (сначала снимок, затем добавленные руками). Меняет st.
  // В SERVER товары листа «Остатки» берутся из st.stockSheet (что загрузил перенос), а не из STOCK_SNAPSHOT; переноса не было —
  // в списке только позиции каталога, и остатка у них «нет данных».
  function unpack(st) {
    if (!st || !st.catalogSnapshot) return st;
    const edits = st.productEdits || {}, removed = new Set(st.productsRemoved || []);
    const sheet = SERVER ? build(CATALOG, { rows: (st.stockSheet && st.stockSheet.rows) || [] }, { named: true }).products.filter(p => !p.inCatalog) : [];
    const snap = [...base().products, ...sheet].filter(p => !removed.has(p.id)).map(p => ({ ...p, ...(edits[p.id] || {}) }));
    const have = new Set(snap.map(p => p.id));
    st.products = [...snap, ...(Array.isArray(st.products) ? st.products : []).filter(p => !have.has(p.id))];
    delete st.catalogSnapshot; delete st.productEdits; delete st.productsRemoved;
    return st;
  }

  return { norm, CATS, NO_CAT, SEP, SUB_NONE, topOf, STRUCT, STRUCT_PATHS, classify, classifyLoose, recat, NO_BRAND, brandRows, build, merge, isSupplier, add, cats, brands, query, sectionCat, base, pack, unpack,
    SKU_MAX, skuClean, skuOf, skuKey, bySku, label, setSku, pathOf, nodeOf, hasPath, ensure, treeFrom, syncTree, busy, catAdd, catEdit, catDelete, setCat, rows, nameProblem };
})();

// Шаг SEEDS: товары и остатки — настоящие, из снимков. Демо-записи прототипа v2 (резервы, позиции поставок,
// движения) ссылались на 12 выдуманных товаров по артикулу; их переводит этот шаг на настоящие позиции того же
// вида: панель — на панель, инвертор — на инвертор, АКБ — на аккумулятор. Позиция выбрана по смыслу записи:
// где v2 резервировал со склада — позиция, у которой в таблице менеджеров есть остаток; где товар только едет
// (АКБ) — позиция из каталога сайта. Ветрогенераторов в каталоге нет: запись ведёт на инвертор.
// Позиция названа точно, как в источнике; нет такой — берётся первая того же вида, ссылки остаются целыми.
const DEMO_LINKS = {
  'PV-550M': { cat: 'Панели', name: 'Солнечная панель HAVEL 340' },
  'INV-H6': { cat: 'Инверторы', name: 'Гибридный инвертор GD6248SMH' },
  'INV-G10': { cat: 'Инверторы', name: 'Сетевой SMARTWATT GRID G2, 6 кВт' },
  'BAT-LFP-100': { cat: 'Аккумуляторы', name: 'Аккумуляторная батарея WINDSOLAR LFP Smart BLOCK 12V 100AH (100AH / 12.8V / 1280WH / BMS)' },
  'CTRL-60': { cat: 'Контроллеры', name: 'Контроллер КЭС DOMINATOR MPPT 200/100' },
  'CAB-6R': { cat: 'Защита и соединения', name: 'Кабель для СЭС PV-1F 2х4 мм2' },
  'CAB-6B': { cat: 'Защита и соединения', name: 'Провод ПуГВнг(А)-LS 1х25 бел Кабэкс ГОСТ' },
  'MC4': { cat: 'Защита и соединения', name: 'Коннектор MC4 AB (комплект из двух разъемов)' },
  'MNT-R4': { cat: 'Защита и соединения', name: 'Комплект крепления MAX для четырех панелей изменением угла наклона 0.5 метр' },
  'BOX-DC': { cat: 'Защита и соединения', name: 'Бокс HT8WAY' },
  'MTR-3F': { cat: 'Защита и соединения', name: 'Токоизмерительные клещи SPLIT CORE CTSA016 на 100 А / 50 mA' },
  'WND-3K': { cat: 'Инверторы', name: 'Гибридный инвертор ASTERION INV ECO II 1.5 кВт (1500W / 12V / PV 900W 30-160V / MPPT 60A)' },
};
// База: юрлица и города по умолчанию, товары — каталог сайта без снимка остатков; остатков и отложенного нет.
BASES.push(st => {
  const products = Catalog.build(CATALOG, { rows: [] }).products;
  Object.assign(st, Stock.defaults(), { products, categories: Catalog.treeFrom(products), stock: {}, aside: {} });
});
SEEDS.push(st => {
  const built = Catalog.build(CATALOG, STOCK_SNAPSHOT);
  Object.assign(st, { products: built.products, categories: Catalog.treeFrom(built.products), stock: built.stock, aside: built.aside });
  const inCat = (p, cat) => p.cat === cat || String(p.cat).startsWith(cat + Catalog.SEP);   // вид внутри категории (Инверторы › Гибридные) — та же категория
  const pick = ({ cat, name }) => st.products.find(p => inCat(p, cat) && Catalog.norm(p.name) === Catalog.norm(name))
    || st.products.find(p => inCat(p, cat));
  const link = Object.fromEntries(Object.entries(DEMO_LINKS).map(([sku, rule]) => [sku, pick(rule).id]));
  const fix = id => link[id] || id;
  // поставки: юрлицо и город (демо), позиции — настоящие товары
  for (const s of st.shipments) {
    s.entityId = s.entityId || 'ip'; s.cityId = s.cityId || 'irk';
    for (const it of s.items) it.productId = fix(it.productId);
  }
  // резервы: со склада — из клетки, где больше свободного; под поставку — юрлицо и город поставки
  for (const r of st.reserves) r.productId = fix(r.productId);
  const cells = st.reserves.map(r => (r.src === 'stock' ? Stock.bestCell(st, r.productId) : null));
  st.reserves.forEach((r, i) => {
    const ship = r.src === 'stock' ? null : st.shipments.find(s => s.id === r.src);
    r.entityId = cells[i] ? cells[i].entityId : (ship ? ship.entityId : Stock.ANY);
    r.cityId = cells[i] ? cells[i].cityId : (ship ? ship.cityId : Stock.ANY);
  });
  // движения: товар и клетка склада
  for (const m of st.moves) {
    m.productId = fix(m.productId);
    const cell = Stock.bestCell(st, m.productId);
    m.entityId = cell.entityId; m.cityId = cell.cityId;
  }
});
