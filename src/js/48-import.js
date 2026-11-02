// Ядро: перенос остатков и клиентов из CSV (Import). Без DOM и сети; st первым аргументом, время now аргументом.
// Разбор файла (кодировка, разделитель, кавычки) и превращение строк в товары, остатки, резервы и клиентов — здесь и только
// здесь: экран директора считает предпросмотр теми же функциями (preview), а сервер исполняет загрузку ими же (applyStock,
// applyClients) — второй копии разбора нет. Сам CSV никуда не сохраняется: дальше экрана идут только разобранные строки.

const Import = (() => {
  // Движение «Ввод остатков»: слово одно на всех — Stock.KINDS.input; по нему сервер пускает запись остатка (право admin).
  const INPUT = Stock.KINDS.input;
  const NO_SECTION = 'Без раздела';
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
  function parseCsv(text) {
    const t = String(text == null ? '' : text).replace(/^﻿/, '');
    const d = delimiter(t), rows = [];
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
    let nameCol = head.findIndex((c, j) => !marked.has(j) && NAME_HEADS.includes(compact(c)));
    if (nameCol < 0) {
      const width = Math.max(head.length, ...data.map(r => r.length));
      for (let j = 0; j < width && nameCol < 0; j++) {
        if (!marked.has(j) && data.some(r => { const v = cellNum(r[j]); return v !== null && v.text !== undefined; })) nameCol = j;
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

  // Заменить остатки фирмы строками листа. rows — из stockRows (или присланные клиентом: чистятся). Что происходит:
  // товар строки — позиция каталога (точное совпадение названия) или товар «нет в каталоге» с id по нормализованному названию
  // (повторный перенос попадает в те же товары); stock и aside заменяются целиком; на каждую клетку склада с остатком больше
  // нуля — движение «Ввод остатков»; резервы прошлого переноса (imported) снимаются, из ячейки «Резерв» ставятся новые: количество —
  // резервом, остальной текст — примечанием, без сделки. Резервы из CRM (со сделкой) остаются. st.stockSheet — разобранные строки
  // без текста резервов (в нём имена клиентов, а stockSheet видят все).
  // → { products, matched, created, cells, withStock, reserves, moves, unparsed: [{name, column, text}] }
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
    st.stock = built.stock;
    st.aside = built.aside;

    // резервы прошлого переноса снимаются
    for (let i = st.reserves.length - 1; i >= 0; i--) {
      const r = st.reserves[i];
      if (!r.imported) continue;
      st.reserves.splice(i, 1);
      logMove(st, { at, productId: r.productId, kind: Stock.KINDS.unreserve, qty: r.qty, entityId: r.entityId || Stock.ANY, cityId: r.cityId || Stock.ANY, doc: 'перенос заменён', by: who });
    }

    const doc = `перенос, ${ru(at)}`, unparsed = [];
    let cells = 0, withStock = 0, moves = 0, reserves = 0;
    list.forEach((row, i) => {
      const pid = built.ids[i];
      let any = false;
      for (const e of ['ip', 'npp', 'vs']) {
        const n = isNum(row[e]) ? row[e] : null;
        if (n === null) continue;
        cells++;
        if (n > 0) {
          any = true; moves++;
          logMove(st, { at, productId: pid, kind: INPUT, qty: n, entityId: e, cityId: Stock.ANY, doc, by: who });
        }
      }
      if (any) withStock++;
      for (const j of row.junk) unparsed.push({ name: row.name, column: j.column, text: j.text });
      if (!row.reserve) return;
      const pr = parseReserve(row.reserve);
      for (const it of pr.items) {
        const cell = biggestCell(st, pid);
        const r = { id: Store.freeId(st.reserves, 'r'), productId: pid, qty: it.qty, entityId: cell.entityId, cityId: cell.cityId, src: 'stock', note: it.note, imported: true, at, by: who };
        st.reserves.push(r);
        reserves++;
        logMove(st, { at, productId: pid, kind: Stock.KINDS.reserve, qty: r.qty, entityId: r.entityId, cityId: r.cityId, doc: it.note ? `перенос: ${it.note}` : 'перенос', by: who });
      }
      if (pr.rest) unparsed.push({ name: row.name, column: 'Резерв', text: pr.rest });
    });
    st.stockSheet = { at, by: who, rows: list.map(({ name, cat, ip, npp, vs, custody, transit, damaged }) => ({ name, cat, ip, npp, vs, custody, transit, damaged })) };
    return { products: list.length, matched: list.length - built.unmatched.length, created, cells, withStock, reserves, moves, unparsed };
  }

  // ——— клиенты из Битрикса ———
  const CLIENT_KNOWN = new Set(['id', 'имя', 'фамилия', 'отчество', 'адрес', 'фактическийадрес', 'юридическийадрес', 'компания', 'должность',
    'ответственный', 'названиекомпании', 'инн']);
  const isPhoneHead = h => h.includes('телефон');
  const isMailHead = h => h.includes('email') || h.includes('почта');

  // Таблица CSV контактов или компаний Битрикса → { rows, unknown, skipped, kind, problems }. Тип файла — по колонке
  // «Название компании». rows: { kind, name, phones, email, inn, address, org, managerName, bitrixId }; unknown — названия колонок,
  // которых перенос не знает; skipped — строки без имени. Колонки — spec.md, «Колонки переноса».
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
    const rows = [];
    let skipped = 0;
    for (const r of t.slice(hi + 1)) {
      if (rowEmpty(r)) continue;
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
    }
    return { rows, unknown, skipped, kind: company ? 'company' : 'person', problems: [] };
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
    };
  }

  // Завести клиентов из строк (clientRows). Тот же ИНН, телефон или почта (Clients.find: ИНН > телефон > почта), а без них —
  // тот же ID Битрикса того же вида: клиент не создаётся заново, недостающее дописывается. «Ответственный» → менеджер клиента,
  // если имя совпало с именем сотрудника точно и такой один. → { created, merged, skipped }
  function applyClients(st, rows, by, now) {
    if (!Array.isArray(rows)) throw new Error('Перенос: нужен список клиентов.');
    if (rows.length > ROWS_MAX) throw new Error(`Перенос: в файле больше ${ROWS_MAX} клиентов.`);
    const out = { created: 0, merged: 0, skipped: 0 };
    if (!st.clients) st.clients = [];
    const people = st.people || [];
    for (const raw of rows) {
      const r = cleanClient(raw);
      if (!r) { out.skipped++; continue; }
      const same = r.managerName ? people.filter(p => str(p.name) === r.managerName) : [];
      const managerId = same.length === 1 ? same[0].id : '';
      let found = Clients.find(st, r)[0];
      if (!found && r.bitrixId) found = st.clients.find(c => c.bitrixId === r.bitrixId && c.kind === r.kind);
      if (!found) {
        Clients.make(st, { ...r, managerId: managerId || undefined }, by || null, now);
        out.created++;
        continue;
      }
      Clients.fill(st, found, r, by || null, now, 'переноса');
      if (!found.managerId && managerId) {
        found.managerId = managerId;
        Feed.add(st, { t: 'client', id: found.id }, { kind: 'field', text: `Из переноса добавлено: менеджер ${people.find(p => p.id === managerId).name}`, by: by || null, at: now });
      }
      out.merged++;
    }
    return out;
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

  return { INPUT, decode, parseCsv, stockRows, parseReserve, applyStock, clientRows, applyClients, preview };
})();
