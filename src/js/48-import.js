// Ядро: перенос остатков и клиентов из CSV (Import). Без DOM и сети; st первым аргументом, время now аргументом.
// Разбор файла (кодировка, разделитель, кавычки) и превращение строк в товары, остатки, резервы и клиентов — здесь и только
// здесь: экран директора считает предпросмотр теми же функциями (preview), а сервер исполняет загрузку ими же (applyStock,
// applyClients) — второй копии разбора нет. Сам CSV никуда не сохраняется: дальше экрана идут только разобранные строки.

const Import = (() => {
  // Движение «Ввод остатков»: слово одно на всех — Stock.KINDS.input; по нему сервер пускает запись остатка (право admin).
  const INPUT = Stock.KINDS.input;
  const NO_SECTION = Catalog.NO_CAT;
  const ROWS_MAX = 50000;
  const str = v => String(v == null ? '' : v).trim();
  const isNum = v => typeof v === 'number' && isFinite(v);
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

  // ——— кодировка ———
  // Windows-1251: байты 0x80–0xBF — по таблице, 0xC0–0xFF — подряд «А…я». 0x98 у стандарта не занят — как у браузеров, U+0098.
  const CP1251_HIGH = 'ЂЃ‚ѓ„…†‡€‰Љ‹ЊЌЋЏ' + 'ђ‘’“”•–—\u0098™љ›њќћџ' + ' ЎўЈ¤Ґ¦§Ё©Є«¬­®Ї' + '°±Ііґµ¶·ё№є»јЅѕї';

  function fromCodes(codes) {
    const out = [];
    for (let i = 0; i < codes.length; i += 8192) out.push(String.fromCharCode.apply(null, codes.slice(i, i + 8192)));
    return out.join('');
  }
  // Строгий UTF-8: любая ошибка последовательности → null (тогда файл читается как Windows-1251)
  function utf8(b, from) {
    const codes = [];
    for (let i = from; i < b.length;) {
      const c = b[i];
      let n, cp;
      if (c < 0x80) { n = 1; cp = c; }
      else if (c >= 0xC2 && c <= 0xDF) { n = 2; cp = c & 0x1F; }
      else if (c >= 0xE0 && c <= 0xEF) { n = 3; cp = c & 0x0F; }
      else if (c >= 0xF0 && c <= 0xF4) { n = 4; cp = c & 0x07; }
      else return null;
      if (i + n > b.length) return null;
      for (let k = 1; k < n; k++) {
        const x = b[i + k];
        if ((x & 0xC0) !== 0x80) return null;
        cp = (cp << 6) | (x & 0x3F);
      }
      if ((n === 3 && cp < 0x800) || (n === 4 && (cp < 0x10000 || cp > 0x10FFFF)) || (cp >= 0xD800 && cp <= 0xDFFF)) return null;
      if (cp >= 0x10000) { cp -= 0x10000; codes.push(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF)); } else codes.push(cp);
      i += n;
    }
    return fromCodes(codes);
  }
  function cp1251(b, from) {
    const codes = [];
    for (let i = from; i < b.length; i++) {
      const c = b[i];
      codes.push(c < 0x80 ? c : c < 0xC0 ? CP1251_HIGH.charCodeAt(c - 0x80) : 0x410 + c - 0xC0);
    }
    return fromCodes(codes);
  }

  // UTF-16 («Юникод-текст» Excel): по BOM — FF FE это LE, FE FF это BE. Пары байт — это уже коды знаков (суррогаты склеит сама строка).
  // Лишний последний байт нечётной длины отбрасывается. Без BOM UTF-16 не угадывается.
  function utf16(b, le) {
    const codes = [];
    for (let i = 2; i + 1 < b.length; i += 2) codes.push(le ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]);
    return fromCodes(codes);
  }

  // Байты файла → текст: UTF-16 по BOM (LE и BE), иначе UTF-8 (с BOM и без), иначе Windows-1251. Чистый ASCII читается одинаково в обеих.
  function decode(bytes) {
    const b = bytes && typeof bytes.length === 'number' ? bytes : new Uint8Array(bytes || 0);
    if (b.length >= 2 && b[0] === 0xFF && b[1] === 0xFE) return utf16(b, true);
    if (b.length >= 2 && b[0] === 0xFE && b[1] === 0xFF) return utf16(b, false);
    const from = b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF ? 3 : 0;
    const text = utf8(b, from);
    return text !== null ? text : cp1251(b, from);
  }

  // ——— CSV ———
  // Разделитель — тот из «;», табуляции, «,», которого больше вне кавычек в первых тридцати строках (при равенстве — в этом порядке).
  function delimiter(t) {
    const count = { ';': 0, '\t': 0, ',': 0 };
    let q = false, lines = 0;
    for (let i = 0; i < t.length && lines < 30; i++) {
      const c = t[i];
      if (c === '"') q = !q;
      else if (!q) { if (c === ';' || c === '\t' || c === ',') count[c]++; else if (c === '\n') lines++; }
    }
    let best = ',', top = 0;
    for (const d of [';', '\t', ',']) if (count[d] > top) { best = d; top = count[d]; }
    return best;
  }

  // Текст CSV → строки таблицы (массивы строк). Кавычки, «""» внутри, перевод строки внутри кавычек; пустые строки пропущены.
  // forced — разделитель, если он известен заранее (вставка из Excel — табуляция); иначе угадывается (delimiter).
  function parseCsv(text, forced) {
    const t = String(text == null ? '' : text).replace(/^﻿/, '');
    const d = forced || delimiter(t), rows = [];
    let row = [], cell = '', q = false, blank = true;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (q) {
        if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
      } else if (c === '"' && cell === '') { q = true; blank = false; }
      else if (c === d) { row.push(cell); cell = ''; blank = false; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && t[i + 1] === '\n') i++;
        if (!blank) { row.push(cell); rows.push(row); }
        row = []; cell = ''; blank = true;
      } else { cell += c; blank = false; }
    }
    if (!blank) { row.push(cell); rows.push(row); }
    return rows;
  }

  // Название колонки для сравнения: без регистра, ё = е, только буквы и цифры («Склад ИП» → «складип», «E-mail» → «email»)
  const compact = s => str(s).toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/g, '');
  const rowEmpty = r => !r.some(c => str(c));
  const BINARY = /\u0000/;

  // ——— лист «Остатки» ———
  const MARKS = { ip: 'складип', npp: 'нпп', vs: 'вс', custody: 'ответхранение', transit: 'впути', damaged: 'бой', reserve: 'резерв' };
  const NUM_KEYS = ['ip', 'npp', 'vs', 'custody', 'transit', 'damaged'];
  const NAME_HEADS = ['наименование', 'номенклатура', 'товар', 'название', 'модель'];
  // колонка артикула в листе остатков и в списке прихода (compact: «Арт.» → «арт», «Артикул» → «артикул»)
  const SKU_HEADS = ['артикул', 'арт', 'артикултовара', 'sku'];
  const HEADER_ROWS = 10;

  // Клетка → {n: число} | {text} | null (пусто). Пробелы-разделители тысяч и запятая-десятичная понимаются.
  function cellNum(s) {
    const raw = str(s);
    if (!raw) return null;
    const x = raw.replace(/[\s ]/g, '').replace(/[−–]/, '-').replace(',', '.');
    return /^-?\d+(\.\d+)?$/.test(x) ? { n: Number(x) } : { text: raw };
  }

  // Таблица CSV листа «Остатки» → { rows, problems, skipped }. rows — формы STOCK_SNAPSHOT.rows плюс reserve (текст ячейки);
  // текст в числовой клетке даёт null и запись в row.junk. problems — почему файл нельзя загрузить (тогда rows пусто).
  function stockRows(table) {
    const t = Array.isArray(table) ? table : [];
    const fail = text => ({ rows: [], problems: [text], skipped: 0 });
    if (!t.some(r => !rowEmpty(r))) return fail('Файл пустой: в нём нет ни одной заполненной клетки.');
    if (t.some(r => r.some(c => BINARY.test(String(c))))) return fail('Это не CSV: в файле двоичные данные. Сохраните лист «Остатки» как «CSV (разделители — запятые)» и загрузите его.');
    let h = -1, cols = {};
    for (let i = 0; i < Math.min(HEADER_ROWS, t.length) && h < 0; i++) {
      const found = {};
      t[i].forEach((c, j) => { for (const k of Object.keys(MARKS)) if (MARKS[k] === compact(c) && found[k] === undefined) found[k] = j; });
      if (Object.keys(found).length >= 2) { h = i; cols = found; }
    }
    if (h < 0) return fail('Не найдена строка заголовков среди первых 10 строк: нужны хотя бы две колонки из «Склад ИП», «НПП», «ВС», «ответхранение», «В пути», «Бой», «Резерв». Похоже, это не лист «Остатки».');
    const head = t[h], data = t.slice(h + 1), marked = new Set(Object.values(cols));
    const skuCol = head.findIndex((c, j) => !marked.has(j) && SKU_HEADS.includes(compact(c)));
    let nameCol = head.findIndex((c, j) => !marked.has(j) && j !== skuCol && NAME_HEADS.includes(compact(c)));
    if (nameCol < 0) {
      const width = Math.max(head.length, ...data.map(r => r.length));
      for (let j = 0; j < width && nameCol < 0; j++) {
        if (!marked.has(j) && j !== skuCol && data.some(r => { const v = cellNum(r[j]); return v !== null && v.text !== undefined; })) nameCol = j;
      }
    }
    if (nameCol < 0) return fail('Нет колонки с названием товара: заголовок «Наименование», «Номенклатура», «Товар», «Название» или «Модель», либо любая колонка с текстом.');

    const rows = [];
    let root = '', sub = '', skipped = 0;
    for (const r of data) {
      if (rowEmpty(r)) continue;
      const name = str(r[nameCol]);
      const filled = Object.values(cols).some(j => str(r[j]));
      if (!name) { if (filled) skipped++; continue; }
      if (!filled) {
        // раздел: название без единой клетки справа. Известный корень (Catalog.CATS) начинает новый раздел, прочее — подраздел
        if (!root || Catalog.CATS.includes(Catalog.sectionCat(name))) { root = name; sub = ''; } else sub = name;
        continue;
      }
      const row = { name, cat: sub ? root + ' › ' + sub : root };
      const sku = skuCol >= 0 ? Catalog.skuClean(r[skuCol]) : '';
      if (sku) row.sku = sku;
      const junk = [];
      for (const k of NUM_KEYS) {
        const v = cols[k] === undefined ? null : cellNum(r[cols[k]]);
        row[k] = v && v.n !== undefined ? v.n : null;
        if (v && v.text !== undefined) junk.push({ column: str(head[cols[k]]), text: v.text });
      }
      row.reserve = cols.reserve === undefined || !str(r[cols.reserve]) ? null : str(r[cols.reserve]);
      if (junk.length) row.junk = junk;
      rows.push(row);
    }
    if (!rows.length) return fail(`В файле нет ни одного товара под строкой заголовков (строка ${h + 1}).`);
    return { rows, problems: [], skipped };
  }

  // ——— резервы из ячейки «Резерв» ———
  // «36шт автоношкин, 64 Алексей Н.» → [{36, «автоношкин»}, {64, «Алексей Н.»}]. Части — через запятую, «;» или перевод строки.
  // Часть без числа (или с нулём) в items не идёт — склеена в rest (null, если такой нет).
  const UNIT = '(?:(?:шт\\.?|штук[аи]?|ед\\.?)(?![а-яё]))?';
  const RE_LEAD = new RegExp('^(\\d+)\\s*' + UNIT + '\\s*[-–—:]?\\s*(.*)$', 'i');
  const RE_TAIL = new RegExp('^(.*?)[\\s\\-–—:]*(\\d+)\\s*' + UNIT + '$', 'i');
  function parseReserve(text) {
    const items = [], rest = [];
    for (const piece of String(text == null ? '' : text).split(/[,;\n]+/)) {
      const s = piece.trim();
      if (!s) continue;
      let m = RE_LEAD.exec(s), qty = 0, note = '';
      if (m) { qty = Number(m[1]); note = m[2].trim(); }
      else if ((m = RE_TAIL.exec(s)) && m[1].trim()) { qty = Number(m[2]); note = m[1].trim(); }
      if (qty >= 1) items.push({ qty, note }); else rest.push(s);
    }
    return { items, rest: rest.length ? rest.join(', ') : null };
  }

  // ——— запись остатков ———
  const NAME_MAX = 300;
  const ru = d => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;

  // Строки от клиента → чистые строки (число или null; reserve — строка или null). Нет списка или ни одной строки с названием —
  // исключение, и состояние остаётся нетронутым.
  function cleanStockRows(rows) {
    if (!Array.isArray(rows)) throw new Error('Перенос: нужен список строк таблицы остатков.');
    if (rows.length > ROWS_MAX) throw new Error(`Перенос: в таблице больше ${ROWS_MAX} строк.`);
    const out = [];
    for (const r of rows) {
      if (!isObj(r)) continue;
      const name = str(r.name).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, NAME_MAX).trim();
      if (!name) continue;
      const row = { name, cat: str(r.cat).slice(0, NAME_MAX) };
      if (Catalog.skuClean(r.sku)) row.sku = Catalog.skuClean(r.sku);
      for (const k of NUM_KEYS) row[k] = isNum(r[k]) ? r[k] : null;
      row.reserve = typeof r.reserve === 'string' && r.reserve.trim() ? r.reserve.trim().slice(0, 1000) : null;
      row.junk = (Array.isArray(r.junk) ? r.junk : []).filter(isObj).map(j => ({ column: str(j.column).slice(0, 100), text: str(j.text).slice(0, 200) })).filter(j => j.text);
      out.push(row);
    }
    if (!out.length) throw new Error('Перенос: в таблице нет ни одной строки с названием товара.');
    return out;
  }

  // Клетка склада с наибольшим остатком: туда встаёт резерв из ячейки «Резерв». Остатка нет — («_», «_»).
  function biggestCell(st, productId) {
    const g = Stock.grid(st, productId);
    let best = { entityId: Stock.ANY, cityId: Stock.ANY }, top = 0;
    for (const r of g.rows) for (const c of g.cols) { const n = g.cell(r.id, c.id); if (n > top) { top = n; best = { entityId: r.id, cityId: c.id }; } }
    return best;
  }
  // Запись журнала склада — новые сверху (как Stock.log)
  function logMove(st, rec) {
    if (!st.moves) st.moves = [];
    rec.id = Store.freeId(st.moves, 'mv');
    st.moves.unshift(rec);
  }

  // Сколько «листьев» (клеток) двух деревьев остатков различаются; нет клетки с одной стороны — это различие
  function leafDiff(a, b) {
    const deep = v => v !== null && typeof v === 'object';
    if (deep(a) || deep(b)) {
      const x = deep(a) ? a : {}, y = deep(b) ? b : {};
      let n = 0;
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) n += leafDiff(x[k], y[k]);
      return n;
    }
    return a === b ? 0 : 1;
  }

  // Заменить остатки фирмы строками листа. rows — из stockRows (или присланные клиентом: чистятся). Что происходит:
  // товар строки — позиция каталога (точное совпадение названия) или товар «нет в каталоге» с id по нормализованному названию
  // (повторный перенос попадает в те же товары); stock и aside заменяются целиком; движение «Ввод остатков» пишется на клетку
  // склада с остатком больше нуля, которая изменилась против прежнего остатка, и с остатком 0 — на клетку, где остаток был
  // больше нуля, а стал 0 или пропал из файла (тот же файл второй раз журнал не трогает);
  // резервы прошлого переноса (imported) сверяются с новыми: тот же (товар, клетка, количество, примечание) остаётся как есть,
  // остальные старые снимаются, недостающие ставятся — количество резервом, остальной текст примечанием, без сделки. Резервы из
  // CRM (со сделкой) остаются. st.stockSheet — разобранные строки без текста резервов (в нём имена клиентов, а stockSheet видят все).
  // → { products, matched, created, cells, changed, withStock, reserves, reservesChanged, moves, unparsed: [{name, column, text}] }
  // cells — клеток с числом в файле; changed — клеток (склад и «в пути/ответхранение/бой»), чьё значение стало другим, включая
  // пропавшие из файла; reservesChanged — резервов снято плюс поставлено.
  function applyStock(st, rows, by, now) {
    const list = cleanStockRows(rows);
    const at = new Date(now), who = by || null;
    const built = Catalog.build(CATALOG, { rows: list.map(r => ({ ...r, cat: r.cat || NO_SECTION })) }, { named: true });
    if (!st.products) st.products = [];
    if (!st.reserves) st.reserves = [];
    const have = new Set(st.products.map(p => p.id)), sheetIds = new Set(built.unmatched.map(u => u.productId));
    let created = 0;
    for (const p of built.products) {
      if (have.has(p.id)) continue;
      // товар листа — новый; позиция каталога — только если снята из списка, а остаток у неё есть
      if (sheetIds.has(p.id)) { st.products.push(p); created++; } else if (built.stock[p.id] || built.aside[p.id]) st.products.push(p);
    }
    Catalog.syncTree(st);   // раздел листа, которого ещё нет в дереве категорий, становится категорией
    // артикул строки листа — товару, у которого своего артикула ещё нет (поставленный руками не затирается)
    const byId = new Map(st.products.map(p => [p.id, p]));
    let skus = 0;
    list.forEach((row, i) => { const p = byId.get(built.ids[i]); if (row.sku && p && !Catalog.skuOf(p)) { p.sku = row.sku; skus++; } });
    const was = st.stock || {}, wasAside = st.aside || {};
    const changed = leafDiff(was, built.stock) + leafDiff(wasAside, built.aside);
    st.stock = built.stock;
    st.aside = built.aside;
    const wasCell = (pid, e) => ((was[pid] || {})[e] || {})[Stock.ANY];

    const doc = `перенос, ${ru(at)}`, unparsed = [], wanted = [];
    let cells = 0, withStock = 0, moves = 0;
    list.forEach((row, i) => {
      const pid = built.ids[i];
      let any = false;
      for (const e of ['ip', 'npp', 'vs']) {
        const n = isNum(row[e]) ? row[e] : null;
        if (n === null) continue;
        cells++;
        if (n > 0) {
          any = true;
          if (wasCell(pid, e) === n) continue;
          moves++;
          logMove(st, { at, productId: pid, kind: INPUT, qty: n, entityId: e, cityId: Stock.ANY, doc, by: who });
        }
      }
      if (any) withStock++;
      for (const j of row.junk) unparsed.push({ name: row.name, column: j.column, text: j.text });
      if (!row.reserve) return;
      const pr = parseReserve(row.reserve);
      for (const it of pr.items) {
        const cell = biggestCell(st, pid);
        wanted.push({ productId: pid, qty: it.qty, entityId: cell.entityId, cityId: cell.cityId, note: it.note });
      }
      if (pr.rest) unparsed.push({ name: row.name, column: 'Резерв', text: pr.rest });
    });

    // клетка, где остаток был больше нуля, а стал 0 или пропал из файла (пустая клетка, текст, товара в файле больше нет), —
    // тоже «Ввод остатков», с остатком 0; клетка, где и было нуль или пусто, журнал не трогает
    for (const pid of Object.keys(was)) {
      for (const e of ['ip', 'npp', 'vs']) {
        const before = wasCell(pid, e), after = (((built.stock[pid] || {})[e]) || {})[Stock.ANY];
        if (!(isNum(before) && before > 0) || !(after === undefined || after === null || after === 0)) continue;
        moves++;
        logMove(st, { at, productId: pid, kind: INPUT, qty: 0, entityId: e, cityId: Stock.ANY, doc, by: who });
      }
    }

    // резервы прошлого переноса: тот же резерв остаётся как есть, остальные снимаются, недостающие ставятся
    const sameReserve = (r, w) => r.productId === w.productId && r.qty === w.qty && (r.entityId || Stock.ANY) === w.entityId
      && (r.cityId || Stock.ANY) === w.cityId && (r.note || '') === w.note;
    const toAdd = wanted.slice();
    let removed = 0;
    for (let i = st.reserves.length - 1; i >= 0; i--) {
      const r = st.reserves[i];
      if (!r.imported) continue;
      const k = toAdd.findIndex(w => sameReserve(r, w));
      if (k >= 0) { toAdd.splice(k, 1); continue; }
      st.reserves.splice(i, 1);
      removed++;
      logMove(st, { at, productId: r.productId, kind: Stock.KINDS.unreserve, qty: r.qty, entityId: r.entityId || Stock.ANY, cityId: r.cityId || Stock.ANY, doc: 'перенос заменён', by: who, rid: r.id });
    }
    for (const w of toAdd) {
      const r = { id: Store.freeId(st.reserves, 'r'), productId: w.productId, qty: w.qty, entityId: w.entityId, cityId: w.cityId, src: 'stock', note: w.note, imported: true, at, by: who };
      st.reserves.push(r);
      logMove(st, { at, productId: r.productId, kind: Stock.KINDS.reserve, qty: r.qty, entityId: r.entityId, cityId: r.cityId, doc: w.note ? `перенос: ${w.note}` : 'перенос', by: who, rid: r.id });
    }
    st.stockSheet = { at, by: who, rows: list.map(({ name, cat, ip, npp, vs, custody, transit, damaged }) => ({ name, cat, ip, npp, vs, custody, transit, damaged })) };
    return { products: list.length, matched: list.length - built.unmatched.length, created, cells, changed, withStock, reserves: wanted.length, reservesChanged: removed + toAdd.length, skus, moves, unparsed };
  }

  // ——— клиенты из Битрикса ———
  const CLIENT_KNOWN = new Set(['id', 'имя', 'фамилия', 'отчество', 'адрес', 'фактическийадрес', 'юридическийадрес', 'компания', 'должность',
    'ответственный', 'названиекомпании', 'инн']);
  const isPhoneHead = h => h.includes('телефон');
  const isMailHead = h => h.includes('email') || h.includes('почта');

  // Таблица CSV контактов или компаний Битрикса → { rows, unknown, skipped, kind, problems }. Тип файла — по колонке
  // «Название компании». rows: { kind, name, phones, email, inn, address, org, managerName, bitrixId }; unknown — названия колонок,
  // которых перенос не знает; skipped — строки без имени; lines — номер каждой из rows в файле (запись таблицы, заголовок — первая). Колонки — spec.md, «Колонки переноса».
  function clientRows(table) {
    const t = Array.isArray(table) ? table : [];
    const fail = text => ({ rows: [], unknown: [], skipped: 0, kind: null, problems: [text] });
    const hi = t.findIndex(r => !rowEmpty(r));
    if (hi < 0) return fail('Файл пустой: в нём нет ни одной заполненной клетки.');
    if (t.some(r => r.some(c => BINARY.test(String(c))))) return fail('Это не CSV: в файле двоичные данные.');
    const head = t[hi], heads = head.map(compact);
    const at = (...names) => names.map(n => heads.indexOf(n)).filter(j => j >= 0);
    const company = heads.includes('названиекомпании');
    if (!company && !at('имя', 'фамилия', 'отчество').length) {
      return fail('Не найдены колонки «Имя», «Фамилия» или «Название компании»: это не выгрузка контактов или компаний Битрикса.');
    }
    const phoneCols = heads.map((h, j) => (isPhoneHead(h) ? j : -1)).filter(j => j >= 0);
    const mailCols = heads.map((h, j) => (isMailHead(h) ? j : -1)).filter(j => j >= 0);
    const unknown = [];
    head.forEach((c, j) => { const name = str(c); if (name && !CLIENT_KNOWN.has(heads[j]) && !isPhoneHead(heads[j]) && !isMailHead(heads[j]) && !unknown.includes(name)) unknown.push(name); });
    const cell = (r, names) => { const j = at(...names)[0]; return j === undefined ? '' : str(r[j]); };
    const first = (r, names) => { for (const j of at(...names)) if (str(r[j])) return str(r[j]); return ''; };
    const rows = [], lines = [];
    let skipped = 0;
    for (const [ti, r] of t.entries()) {
      if (ti <= hi || rowEmpty(r)) continue;
      const name = company ? cell(r, ['названиекомпании']) : [cell(r, ['фамилия']), cell(r, ['имя']), cell(r, ['отчество'])].filter(Boolean).join(' ');
      if (!name) { skipped++; continue; }
      const phones = [], seen = new Set();
      for (const j of phoneCols) {
        for (const p of str(r[j]).split(/[,;\n]+/)) {
          const s = p.trim(), k = Clients.phoneKey(s);
          if (k && !seen.has(k)) { seen.add(k); phones.push(s); }
        }
      }
      const mail = mailCols.map(j => str(r[j])).find(Boolean) || '';
      rows.push({
        kind: company ? 'company' : 'person', name, phones, email: mail.split(/[,;\s]+/)[0] || '', inn: cell(r, ['инн']),
        address: first(r, ['адрес', 'фактическийадрес', 'юридическийадрес']),
        org: company ? '' : [cell(r, ['компания']), cell(r, ['должность'])].filter(Boolean).join(', '),
        managerName: cell(r, ['ответственный']), bitrixId: cell(r, ['id']),
      });
      lines.push(ti + 1);
    }
    return { rows, unknown, skipped, kind: company ? 'company' : 'person', problems: [], lines };
  }

  // Присланная строка клиента → чистые поля; без имени — null
  function cleanClient(r) {
    if (!isObj(r)) return null;
    const name = str(r.name).slice(0, NAME_MAX);
    if (!name) return null;
    const list = v => (Array.isArray(v) ? v : []).map(x => str(x).slice(0, 60)).filter(Boolean);
    return {
      name, kind: r.kind === 'company' ? 'company' : 'person', phones: list(r.phones), email: str(r.email).slice(0, 200), inn: str(r.inn).slice(0, 30),
      address: str(r.address).slice(0, 500), org: str(r.org).slice(0, 500), bitrixId: str(r.bitrixId).slice(0, 60), managerName: str(r.managerName).slice(0, NAME_MAX),
      fresh: r.fresh === true, same: r.same === true,
    };
  }

  // Имя для сравнения: без регистра, без лишних пробелов, ё = е («  Иван   Пётр » и «иван петр» — одно имя)
  const nameKey = s => str(s).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
  // Клиент, которого перенос узнаёт сам: тот же ИНН, телефон или почта (Clients.find: ИНН > телефон > почта), а без них —
  // тот же ID Битрикса того же вида (свой или тот, что при объединении записан в bitrixAlso)
  function known(st, r) {
    const found = Clients.find(st, r)[0];
    return found || (r.bitrixId ? st.clients.find(c => c.kind === r.kind && (c.bitrixId === r.bitrixId || (c.bitrixAlso || []).includes(r.bitrixId))) : null) || null;
  }
  // Клиенты по имени: из них ищутся возможные двойники (ключ — nameKey)
  function byName(clients) {
    const m = new Map();
    for (const c of clients) { const k = nameKey(c.name); if (k) { if (!m.has(k)) m.set(k, []); m.get(k).push(c); } }
    return m;
  }
  // Одна ли это компания: сравнивается, только если она есть у обоих
  const sameOrg = (a, b) => !(a && b && nameKey(a) !== nameKey(b));
  // Возможный двойник строки среди клиентов index: то же имя; если компания (колонка «Компания» контакта) есть у обоих — и она та же.
  // → { c, clash } или null. clash: у обоих заполнен ID Битрикса, и они разные — Битрикс считает это двумя записями; такой двойник
  // берётся, только если нет другого, и по умолчанию строка с ним заводится новым клиентом (объединяет лишь явное same: true)
  function twinOf(index, r) {
    let clash = null;
    for (const c of index.get(nameKey(r.name)) || []) {
      if (!sameOrg(c.org, r.org)) continue;
      if (c.bitrixId && r.bitrixId && c.bitrixId !== r.bitrixId) { clash = clash || c; continue; }
      return { c, clash: false };
    }
    return clash ? { c: clash, clash: true } : null;
  }
  // Строка без телефона, почты, ИНН и ID Битрикса: узнать её не по чему, кроме имени
  const isBare = r => !r.phones.length && !r.email && !r.inn && !r.bitrixId;
  // Повторы внутри файла: для каждой из строк cl (очищенных, null — пустая) — номер более ранней такой же «голой» строки (то же имя и та же
  // компания, пустая — тоже «та же»: так повторы не цепляются друг за друга через строку без компании) или -1. Те, у кого контакты
  // есть, склеиваются сами и сюда не попадают.
  function repeats(cl) {
    const firsts = new Map();
    return cl.map((r, i) => {
      if (!r || !isBare(r)) return -1;
      const k = nameKey(r.name) + '|' + nameKey(r.org);
      if (!firsts.has(k)) { firsts.set(k, i); return -1; }
      return firsts.get(k);
    });
  }

  // Строки файла, про которые загрузка не уверена («Возможно, уже есть»), тремя путями:
  //  — строка без телефона, почты, ИНН и ID Битрикса совпала по имени с уже заведённым клиентом;
  //  — имя совпало с заведённым клиентом, но у обоих заполнены разные ID Битрикса (clash);
  //  — строка без всего этого повторена в файле под тем же именем (dup); если такая пара ещё и совпала с заведённым клиентом —
  //    это одна запись списка.
  // → [{ index, indexes, lines, name, clientId, clientName, clash: {had, got} | null, dup }]: index — первая строка в rows, indexes —
  // все строки записи, lines — их номера в файле (если передан lines из clientRows, иначе порядковые). По умолчанию (без fresh и same)
  // строка считается тем же клиентом, а при clash — новым. fresh: true заводит нового, same: true объединяет и при clash. st не меняется.
  function twins(st, rows, lines) {
    const out = [], list = Array.isArray(rows) ? rows : [];
    if (!list.length) return out;
    const cl = list.map(cleanClient), first = repeats(cl), index = byName(st.clients || []);
    const rest = new Map();
    first.forEach((j, i) => { if (j >= 0) { if (!rest.has(j)) rest.set(j, [j]); rest.get(j).push(i); } });
    cl.forEach((r, i) => {
      if (!r || first[i] >= 0) return;
      const group = rest.get(i) || [i];
      const t = known({ clients: st.clients || [] }, r) ? null : twinOf(index, r);
      if (!t && group.length < 2) return;
      out.push({
        index: i, indexes: group, lines: group.map(k => (lines && lines[k]) || k + 1), name: r.name,
        clientId: t ? t.c.id : '', clientName: t ? t.c.name : '', clash: t && t.clash ? { had: t.c.bitrixId, got: r.bitrixId } : null, dup: group.length > 1,
      });
    });
    return out;
  }

  // Завести клиентов из строк (clientRows). Тот же ИНН, телефон или почта (Clients.find: ИНН > телефон > почта), а без них —
  // тот же ID Битрикса того же вида: клиент не создаётся заново, недостающее дописывается. Строка с именем уже заведённого клиента
  // (twins) — тот же клиент, если в строке не стоит fresh: true («новый»); если у обоих разные ID Битрикса — наоборот, новый, пока
  // не стоит same: true (тогда дополняется найденный: его ID остаётся, ID из файла — в bitrixAlso, чтобы повтор файла узнал строку, и
  // строкой в ленту клиента). Повтор строки без контактов в самом файле (twins, dup) склеивается с первой такой строкой, если не fresh.
  // Двойник ищется среди клиентов, что были до загрузки, и среди повторов файла; строки с контактами друг с другом по имени не склеиваются.
  // «Ответственный» → менеджер клиента, если имя совпало с именем сотрудника точно и такой один. → { created, merged, skipped }
  function applyClients(st, rows, by, now) {
    if (!Array.isArray(rows)) throw new Error('Перенос: нужен список клиентов.');
    if (rows.length > ROWS_MAX) throw new Error(`Перенос: в файле больше ${ROWS_MAX} клиентов.`);
    const out = { created: 0, merged: 0, skipped: 0 };
    if (!st.clients) st.clients = [];
    const people = st.people || [];
    const index = byName(st.clients.slice());
    const cl = rows.map(cleanClient), first = repeats(cl), got = [];
    for (const [i, r] of cl.entries()) {
      if (!r) { out.skipped++; continue; }
      const same = r.managerName ? people.filter(p => str(p.name) === r.managerName) : [];
      const managerId = same.length === 1 ? same[0].id : '';
      let found = known(st, r), clash = false;
      if (!found && !r.fresh) {
        const t = twinOf(index, r);
        if (t && (!t.clash || r.same)) { found = t.c; clash = t.clash; }
        else if (!t && first[i] >= 0) found = got[first[i]] || null;
      }
      if (!found) {
        got[i] = Clients.make(st, { ...r, managerId: managerId || undefined }, by || null, now).client;
        out.created++;
        continue;
      }
      got[i] = found;
      Clients.fill(st, found, r, by || null, now, 'переноса');
      if (clash && !(found.bitrixAlso || []).includes(r.bitrixId)) {
        (found.bitrixAlso = found.bitrixAlso || []).push(r.bitrixId);
        Feed.add(st, { t: 'client', id: found.id }, { kind: 'field', text: `Из переноса объединено по выбору: в Битриксе это разные записи, ID ${found.bitrixId} (остаётся) и ID ${r.bitrixId} (из файла)`, by: by || null, at: now });
      }
      if (!found.managerId && managerId) {
        found.managerId = managerId;
        Feed.add(st, { t: 'client', id: found.id }, { kind: 'field', text: `Из переноса добавлено: менеджер ${people.find(p => p.id === managerId).name}`, by: by || null, at: now });
      }
      out.merged++;
    }
    return out;
  }

  // ——— приход без поставки: «Товары и остатки → Оприходовать товар» ———
  // Товар приехал не по заведённой поставке: список из Excel (название или ключ товара, количество, можно юрлицо и склад) разбирается
  // (receiptRows), сопоставляется с номенклатурой (receiptPlan — один расчёт и для экрана, и для проведения) и проводится одним
  // действием (applyReceipt): новые товары — Catalog.add, как форма «Новый товар»; на каждую клетку — Stock.move «Приход» с документом
  // «Оприходование <дата>». Приход, а не замена остатка (в отличие от «Переноса»). Ни разбор, ни сопоставление st не меняют.
  const RECEIPT_MAX = 2000;
  const RECEIPT_HEADS = {
    name: ['наименование', 'номенклатура', 'товар', 'название', 'модель', 'ключ', 'ключтовара', 'код'],
    sku: SKU_HEADS,
    qty: ['количество', 'колво', 'кол', 'количествошт', 'штук', 'шт'],
    entity: ['юрлицо', 'юридическоелицо', 'организация'],
    city: ['склад', 'город', 'складгород', 'городсклада'],
  };
  const clean = (v, max = NAME_MAX) => str(v).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max).trim();

  // Вставка из Excel (текст с табуляциями) или CSV (текст файла, или уже готовая таблица) → { rows, header, problems }.
  // Колонки по порядку: артикул, название или ключ товара (одна колонка), количество, юрлицо, склад (город); последние две можно не давать.
  // Если в заголовке есть «Артикул» (а колонка названия отдельная) — артикул идёт своей колонкой. Первая строка —
  // заголовок, если в ней узнаются названия колонок или в колонке количества стоит не число; header — её текст (экран показывает, что
  // строка принята за заголовок, а не за товар). rows: { line, name, qty, entity, city, pick: '' } — строки как написаны, line — номер строки списка.
  function receiptRows(input) {
    const fail = text => ({ rows: [], header: null, problems: [text] });
    const text = typeof input === 'string' ? input : null;
    const table = text !== null ? parseCsv(text, text.includes('\t') ? '\t' : undefined) : (Array.isArray(input) ? input : []);
    if (!table.some(r => !rowEmpty(r))) return fail('Список пустой: вставьте строки из Excel или выберите файл.');
    if (table.some(r => r.some(c => BINARY.test(String(c))))) return fail('Это не список: в файле двоичные данные. Сохраните таблицу как CSV или вставьте её текстом.');
    const at = { name: 0, qty: 1, entity: 2, city: 3, sku: -1 };
    const first = table.findIndex(r => !rowEmpty(r)), heads = table[first].map(compact);
    const known = {};
    for (const k of Object.keys(RECEIPT_HEADS)) { const j = heads.findIndex(h => RECEIPT_HEADS[k].includes(h)); if (j >= 0) known[k] = j; }
    const qcell = cellNum(table[first][at.qty]);
    const header = Object.keys(known).length > 0 || (qcell !== null && qcell.n === undefined);
    if (header) Object.assign(at, known);
    // в заголовке есть «Артикул», а колонки названия нет — товар опознаётся по одному артикулу (имя пустое)
    if (header && known.sku !== undefined && known.name === undefined) at.name = -1;
    const data = table.map((r, i) => [r, i]).filter(([r, i]) => i > first - (header ? 0 : 1) && !rowEmpty(r));
    if (data.length > RECEIPT_MAX) return fail(`В списке больше ${RECEIPT_MAX} строк: разделите его на части.`);
    if (!data.length) return fail('В списке нет ни одной строки с товаром под заголовком.');
    const rows = data.map(([r, i]) => ({ line: i + 1, name: at.name >= 0 ? clean(r[at.name]) : '', sku: at.sku >= 0 ? clean(r[at.sku], Catalog.SKU_MAX) : '', qty: clean(r[at.qty], 40), entity: clean(r[at.entity], 100), city: clean(r[at.city], 100), pick: '' }));
    return { rows, header: header ? table[first].map(str).filter(Boolean).join(' · ') : null, problems: [] };
  }

  // Ручной ввод («Оприходовать товар → Ввести вручную»): строки таблицы → те же строки списка, что даёт receiptRows, и дальше тот же разбор
  // (receiptPlan) и то же проведение (applyReceipt) — своей копии логики нет. Строка таблицы: { pid (выбранный товар), q (набранный поиск), isNew,
  // newName, sku (у нового товара), qty, entity, city (id или название; пусто — «всё это приходит на») }. Полностью пустые строки пропускаются.
  // Выбранный товар идёт строкой «название + артикул, это он» (pick); новый — pick 'new'; набранный текст без выбора — как строка из Excel
  // (опознаётся по артикулу, ключу, названию или ждёт выбора). line — номер строки в таблице на экране.
  // → { rows, problems }
  function manualRows(st, list) {
    const rows = [];
    (Array.isArray(list) ? list : []).forEach((m, i) => {
      if (!isObj(m)) return;
      const p = str(m.pid) ? (st.products || []).find(x => x.id === str(m.pid)) : null;
      const row = { line: i + 1, qty: clean(m.qty, 40), entity: clean(m.entity, 100), city: clean(m.city, 100) };
      if (p) Object.assign(row, { name: p.name, sku: Catalog.skuOf(p), pick: p.id });
      else if (m.isNew === true) Object.assign(row, { name: clean(m.newName), sku: clean(m.sku, Catalog.SKU_MAX), pick: 'new' });
      else Object.assign(row, { name: clean(m.q), sku: '', pick: '' });
      if (!p && !row.name && !row.sku && !row.qty && !row.entity && !row.city) return;
      rows.push(row);
    });
    if (rows.length > RECEIPT_MAX) return { rows: [], problems: [`В списке больше ${RECEIPT_MAX} строк: разделите его на части.`] };
    return rows.length ? { rows, problems: [] } : { rows: [], problems: ['Добавьте хотя бы одну строку: выберите товар и впишите количество.'] };
  }

  // Количество строки списка: целое больше нуля. «10», «1 200», «10 шт» — можно; «10,5», «0», «много» — нет (причина по-русски)
  function receiptQty(raw) {
    const s = str(raw).replace(/[\s ]/g, '').replace(/шт\.?$/i, '');
    if (!s) return { error: 'не указано количество' };
    const v = cellNum(s);
    if (v === null || v.n === undefined) return { error: `количество «${str(raw)}» — не число` };
    if (!Number.isInteger(v.n)) return { error: `количество ${str(raw)} — не целое число` };
    if (v.n < 1) return { error: 'количество должно быть больше нуля' };
    if (!Number.isSafeInteger(v.n)) return { error: 'количество слишком большое' };
    return { n: v.n };
  }

  // Слова названия для поиска похожих: без регистра, ё = е, кавычек и знаков; однобуквенные (кроме цифр) отброшены
  const nameWords = s => Catalog.norm(s).split(/[^a-zа-я0-9]+/).filter(w => w.length > 1 || /\d/.test(w));
  // Слово то же, или одно — начало другого («панел» и «панель»); числа сравниваются только точно («550» и «5500» — разные)
  const sameWord = (a, b) => a === b || (/\D/.test(a) && /\D/.test(b) && Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)));
  function wordScore(a, b) {
    if (!a.length || !b.length) return 0;
    const used = new Set();
    let m = 0;
    for (const w of a) { const j = b.findIndex((x, k) => !used.has(k) && sameWord(w, x)); if (j >= 0) { used.add(j); m++; } }
    return m === 0 ? 0 : 0.5 * (m / (a.length + b.length - m)) + 0.5 * (m / Math.min(a.length, b.length));
  }
  const SIMILAR_MIN = 0.4, SIMILAR_MAX = 3;

  // Сопоставить строки списка с номенклатурой st.products и справочником юрлиц и городов. Ничего не меняет.
  // rows — из receiptRows, правленные на экране; pick у строки: '' — решить само, <id товара> — «это тот же», 'new' — создать новый, 'skip' — пропустить.
  // opts: entityId, cityId — куда приходит то, у чего своих юрлица и склада нет; canCreate — можно ли создавать новые товары (право catalog);
  // cat — категория новых товаров, у которых своей нет (строка r.cat: путь «Электрика › Автоматы»; пусто — «Без раздела»); пути, которого нет в дереве, — ошибка строки.
  // Строка → товар: по артикулу (без регистра, пробелов и дефисов; им может быть и первая колонка), по ключу товара (id) или по названию без регистра, лишних пробелов, ё/е, кавычек и тире (Catalog.norm) — один такой товар =
  // «найден» сам; иначе до трёх похожих по общим словам, из них выбирают (status 'choose'), либо создают новый, либо пропускают.
  // Юрлицо и склад строки сопоставляются со справочником так же, без регистра; неизвестные — ошибка строки, а не «нет данных».
  // → { lines, groups, warnings, positions, created, units, skipped, errors, choose, ready }:
  //   lines[i] — { index, line, name, qty, entityId, cityId, status: 'found'|'picked'|'new'|'choose'|'skip'|'error', match (что вышло бы без ошибки
  //   в количестве или юрлице), productId, productName, candidates: [{id, name}], error };
  //   groups — что будет записано: один товар в одну клетку — одна запись, одинаковые строки сложены: { key, productId, name, isNew, cat и sku (у нового), entityId, cityId, qty, lines };
  //   warnings — тексты про сложенные одинаковые строки; ready — можно проводить (нет строк с ошибкой и «выберите», есть что провести).
  function receiptPlan(st, rows, opts = {}) {
    const list = Array.isArray(rows) ? rows : [], products = st.products || [];
    const byId = new Map(products.map(p => [String(p.id), p])), byKey = new Map(products.map(p => [String(p.id).toLowerCase(), p]));
    const byNorm = new Map();
    for (const p of products) { const k = Catalog.norm(p.name); if (!byNorm.has(k)) byNorm.set(k, []); byNorm.get(k).push(p); }
    let wordsOf = null;
    const similar = name => {
      if (!wordsOf) wordsOf = products.map(p => [p, nameWords(p.name)]);
      const w = nameWords(name);
      return wordsOf.map(([p, pw], i) => [p, wordScore(w, pw), i]).filter(x => x[1] >= SIMILAR_MIN)
        .sort((a, b) => b[1] - a[1] || a[2] - b[2]).slice(0, SIMILAR_MAX).map(x => x[0]);
    };
    const dir = (items, raw) => { const k = Catalog.norm(raw); const x = (items || []).find(i => Catalog.norm(i.name) === k || Catalog.norm(i.id) === k); return x ? x.id : ''; };
    const defE = dir(st.entities, opts.entityId || ''), defC = dir(st.cities, opts.cityId || '');
    const view = p => ({ id: p.id, name: p.name, sku: Catalog.skuOf(p) });

    const lines = list.map((r, i) => {
      const L = { index: i, line: r.line === undefined ? i + 1 : r.line, name: str(r.name), sku: Catalog.skuClean(r.sku), qty: null, entityId: '', cityId: '', status: '', match: '', productId: '', productName: '', productSku: '', candidates: [], cat: str(r.cat) || str(opts.cat), error: '' };
      const errs = [];
      const q = receiptQty(r.qty);
      if (q.error) errs.push(q.error); else L.qty = q.n;
      if (str(r.entity)) { L.entityId = dir(st.entities, r.entity); if (!L.entityId) errs.push(`юрлица «${str(r.entity)}» нет в справочнике`); }
      else if (defE) L.entityId = defE; else errs.push('не выбрано юрлицо');
      if (str(r.city)) { L.cityId = dir(st.cities, r.city); if (!L.cityId) errs.push(`склада (города) «${str(r.city)}» нет в справочнике`); }
      else if (defC) L.cityId = defC; else errs.push('не выбран склад (город)');
      if (r.pick === 'skip') { L.status = 'skip'; return L; }   // пропущенную строку не разбирают: ошибки в ней не в счёт
      if (!L.name && !L.sku) errs.push('нет названия или артикула товара');
      else {
        // сперва по артикулу (колонка «Артикул» или то, что написано в первой колонке), потом по ключу товара, потом по названию
        const bySku = Catalog.bySku(st, L.sku || L.name), hit = byKey.get((L.name || L.sku).toLowerCase());
        const exact = bySku.length ? bySku : (hit ? [hit] : (byNorm.get(Catalog.norm(L.name || L.sku)) || []));
        const chosen = r.pick && r.pick !== 'new' ? byId.get(String(r.pick)) : null;
        if (exact.length === 1) { L.match = 'found'; L.productId = exact[0].id; L.productName = exact[0].name; L.productSku = Catalog.skuOf(exact[0]); }
        else {
          L.candidates = (exact.length ? exact.slice(0, 5) : similar(L.name)).map(view);
          if (chosen) { L.match = 'picked'; L.productId = chosen.id; L.productName = chosen.name; L.productSku = Catalog.skuOf(chosen); if (!L.candidates.some(c => c.id === chosen.id)) L.candidates.push(view(chosen)); }
          else if (r.pick === 'new' && !exact.length) {
            L.match = 'new';
            if (opts.canCreate !== true) errs.push('нет права добавлять товары в номенклатуру: выберите товар из списка или пропустите строку');
            else if (!L.name) errs.push('для нового товара нужно название (в строке только артикул)');
            else if (!Catalog.hasPath(st, L.cat)) errs.push(`категории «${L.cat}» нет в списке категорий`);
          } else L.match = 'choose';
        }
      }
      L.status = errs.length ? 'error' : L.match;
      L.error = errs.join('; ');
      return L;
    });

    // что будет записано: один товар в одну клетку — одна запись; новый товар с тем же названием в двух строках — один товар
    const groups = [], at = new Map();
    for (const L of lines) {
      if (!['found', 'picked', 'new'].includes(L.status)) continue;
      const isNew = L.status === 'new', key = (isNew ? 'new:' + Catalog.norm(L.name) : L.productId) + '|' + L.entityId + '|' + L.cityId;
      let g = at.get(key);
      if (!g) { g = { key, productId: isNew ? '' : L.productId, name: isNew ? L.name : L.productName, isNew, cat: isNew ? L.cat : '', sku: isNew ? L.sku : '', entityId: L.entityId, cityId: L.cityId, qty: 0, lines: [] }; at.set(key, g); groups.push(g); }
      g.qty += L.qty;
      g.lines.push(L.line);
    }
    const join = ns => (ns.length === 2 ? ns.join(' и ') : ns.slice(0, -1).join(', ') + ' и ' + ns[ns.length - 1]);
    const warnings = groups.filter(g => g.lines.length > 1)
      .map(g => `«${g.name}» (${Stock.cellText(st, g.entityId, g.cityId)}) — строки ${join(g.lines)}: количества сложены, всего ${g.qty}.`);
    const count = s => lines.filter(l => l.status === s).length;
    const out = { lines, groups, warnings, positions: groups.length, created: new Set(groups.filter(g => g.isNew).map(g => g.key.split('|')[0])).size,
      units: groups.reduce((a, g) => a + g.qty, 0), skipped: count('skip'), errors: count('error'), choose: count('choose') };
    out.ready = lines.length > 0 && out.errors === 0 && out.choose === 0 && groups.length > 0;
    return out;
  }

  // Провести список: тем же расчётом, что на экране (receiptPlan). Право receive нужно всегда, право catalog — только если есть новые
  // товары. Сначала проверяется всё, потом пишется: отказ ничего не меняет. Новые товары — Catalog.add; на каждую запись плана — Stock.move
  // «Приход» (остаток растёт на количество) с документом «Оприходование <дата>», автором by и временем now; одно уведомление о приходе.
  // → { ok, positions, created, units, doc, products: [id новых товаров], moves } | { ok: false, reason, plan }
  function applyReceipt(st, rows, opts, by, now) {
    const o = opts || {}, at = new Date(now);
    if (!Perms.can(st, by, 'receive')) return { ok: false, reason: 'У вашей роли нет права принимать товар на склад.' };
    const plan = receiptPlan(st, rows, { entityId: o.entityId, cityId: o.cityId, cat: o.cat, canCreate: Perms.can(st, by, 'catalog') });
    if (!plan.lines.length) return { ok: false, reason: 'Список пустой.', plan };
    if (plan.errors || plan.choose) return { ok: false, reason: `Не все строки разобраны: с ошибкой ${plan.errors}, ждут выбора ${plan.choose}. Исправьте их или пропустите.`, plan };
    if (!plan.groups.length) return { ok: false, reason: 'Нечего оприходовать: все строки пропущены.', plan };
    const doc = `${Stock.RECEIPT_DOC} ${ru(at)}`, made = new Map(), products = [], moves = [];
    for (const g of plan.groups) {
      if (!g.isNew) continue;
      const k = g.key.split('|')[0];
      if (!made.has(k)) {
        const r = Catalog.add(st, { name: g.name, cat: g.cat, sku: g.sku });
        if (!r.ok) throw new Error(r.reason);
        made.set(k, r.product.id); products.push(r.product.id);
      }
    }
    for (const g of plan.groups) {
      const r = Stock.move(st, { kind: Stock.KINDS.receive, productId: g.isNew ? made.get(g.key.split('|')[0]) : g.productId, qty: g.qty, entityId: g.entityId, cityId: g.cityId, doc, by: by || null, at });
      if (!r.ok) throw new Error(r.reason);
      moves.push(r.move);
    }
    const cells = new Set(plan.groups.map(g => g.entityId + '|' + g.cityId));
    const where = cells.size === 1 ? ` на склад ${Stock.cellText(st, plan.groups[0].entityId, plan.groups[0].cityId)}` : '';
    const ref = plan.groups.length === 1 ? { t: 'product', id: moves[0].productId } : undefined;
    Notify.push(st, 'arrive', by || null, `Оприходован товар без поставки (${doc})${where}: ${plan.positions} ${pl(plan.positions, 'позиция', 'позиции', 'позиций')}${products.length ? `, из них новых товаров ${products.length}` : ''}.`, at, [], ref);
    return { ok: true, positions: plan.positions, created: products.length, units: plan.units, doc, products, moves };
  }

  // ——— предпросмотр ———
  // Что дала бы загрузка — тем же applyStock / applyClients, но на копии нужных частей состояния: st не меняется.
  // kind — 'stock' | 'clients'.
  function preview(kind, st, rows, by, now) {
    const take = keys => {
      const o = {};
      for (const k of keys) if (st[k] !== undefined) o[k] = JSON.parse(JSON.stringify(Store.plain(st[k])), Store.revive);
      return o;
    };
    if (kind === 'stock') return applyStock({ ...take(['products', 'stock', 'aside', 'reserves', 'entities', 'cities']), moves: [] }, rows, by, now);
    if (kind === 'clients') return applyClients({ ...take(['clients', 'people']), feed: [] }, rows, by, now);
    throw new Error('Перенос: неизвестный вид переноса.');
  }

  // ——— лист «Остатки» прямо из Google-таблицы ———
  // Ссылка на таблицу (как её копируют из адресной строки: …/spreadsheets/d/<id>/edit?gid=<лист>#gid=<лист>) → адрес выгрузки
  // листа в CSV. Берётся только id таблицы и номер листа: сервер ходит лишь на docs.google.com, что бы ни вставили. Лист не указан — первый.
  // Не ссылка на Google-таблицу — null. Выгрузка export, а не gviz: gviz по типу колонки выбрасывает текст в числовых клетках.
  function sheetCsvUrl(link) {
    const s = str(link), m = /^(?:https?:\/\/)?docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})(?:[/?#]|$)/.exec(s);
    if (!m) return null;
    const g = /[?#&]gid=(\d+)/.exec(s);
    return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${g ? g[1] : '0'}`;
  }

  return { INPUT, decode, parseCsv, stockRows, sheetCsvUrl, parseReserve, applyStock, clientRows, twins, applyClients, receiptRows, manualRows, receiptQty, receiptPlan, applyReceipt, preview };
})();
