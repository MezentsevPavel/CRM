// Ядро: сохранение состояния в браузере. Чистые функции, без DOM и localStorage —
// строку для localStorage отдаёт dump(), разбирает load(); писать и читать будет запуск.

const Store = (() => {
  const KEY = 'ws-crm-v3';
  const VERSION = 3;
  // Ревизия формы данных внутри схемы v3: пишется в сохранение (dump), при несовпадении load даёт null и запуск берёт seed().
  // Меняется, когда форма записей меняется так, что сохранённое прежней формы читать нельзя.
  // 2 — товары каталога (id вместо sku), остатки по юрлицам и городам, юрлица и города в состоянии. Сохранения без rev — ревизия 1.
  // 3 — почта: st.mail (ящики, поставщики, письма). Старое сохранение без неё уходит в пользу демо.
  // 4 — поставки: маршрут route, положение pos, depart, number, carrier, юрлицо/город; st.shipRules. Прежнее сохранение уходит в пользу демо.
  // 5 — лиды: st.leads, st.leadSource; у сделок из лидов leadId, phone, email. Прежнее сохранение уходит в пользу демо.
  // 6 — роль РОП и право leadsAssign (таск 04): сохранение без них уходит в пользу демо.
  // 7 — клиенты и лента (таск 09): st.clients, st.feed, st.lostReasons; у сделок clientId, items, at, wonAt, lostReason; у лидов clientId.
  // 8 — дела (таск 10): st.acts; лента подмешивает выполненные дела.
  // 9 — лиды заводятся руками, время реакции (таск 10).
  // 10 — отправки (таск 07): st.dispatches, права dispatch и sell, роль «Водитель», вид воронки dispatch.
  // 12 — звук уведомлений у каждого свой (таск 06): prefs.sound = {personId: {on, kind}} вместо одного {on, kind}.
  // 13 — ремонт F1: право dealsEdit, резервы только по строкам сделки, демо-перемещения не увозят товар, правило поставок sr3.
  const REV = 13;
  // Браузер даёт сайту около 5 млн символов на всё; берём с запасом.
  const LIMIT = 4500000;
  const NO_SPACE = 'не сохранено — мало места в браузере';
  // Фото в состоянии — строки data:image/… (снимки с телефона при приёмке).
  const PHOTO = /^data:image\//;

  // Date из любого «мира» (страница, node:vm в тестах) — не через instanceof.
  const isDate = v => Object.prototype.toString.call(v) === '[object Date]';
  const isPhoto = v => typeof v === 'string' && PHOTO.test(v);

  // Копия состояния, пригодная для JSON: даты → {$date: ISO}, ui не сохраняется.
  function plain(v, top) {
    if (isDate(v)) return { $date: isNaN(v.getTime()) ? null : v.toISOString() };
    if (Array.isArray(v)) return v.map(x => plain(x, false));
    if (v && typeof v === 'object') {
      const o = {};
      for (const k of Object.keys(v)) {
        if (top && k === 'ui') continue;
        const x = v[k];
        if (x === undefined || typeof x === 'function') continue;
        o[k] = plain(x, false);
      }
      return o;
    }
    return v;
  }

  // Предел одного файла заявки — 2 МБ: больше — отказ ещё при прикреплении. Браузер даёт на всё около 5 млн символов,
  // а файл в сохранении занимает примерно на треть больше своего размера: два-три таких файла — и места нет.
  const FILE_MAX = 2 * 1024 * 1024;
  const mb = n => String(Math.round(n / 1048576 * 10) / 10).replace('.', ',');
  // Файл больше предела → причина отказа (её показывают и форма, и ядро заявки), иначе null.
  function fileTooBig(f) {
    const size = Number(f && f.size) || 0;
    return size > FILE_MAX ? `Файл «${f.name}» — ${mb(size)} МБ, больше предела ${mb(FILE_MAX)} МБ. Сожмите его или разбейте на части до ${mb(FILE_MAX)} МБ.` : null;
  }

  // Время записи для порядка выкидывания: ближайшее поле at по пути к фото или файлу. Времени нет (черновик приёмки) —
  // запись считается самой новой: она ещё не сохранена как принятая.
  const NEWEST = Number.MAX_SAFE_INTEGER;
  const atOf = v => (v && v.at && v.at.$date && Date.parse(v.at.$date)) || 0;
  const GONE = Symbol('выкинуто');

  // Что можно выкинуть из копии: фото приёмки (строки data:image/… вне заявок) и данные файлов заявок на отправку.
  // Картинка, приложенная к заявке, — файл заявки, а не фото приёмки.
  function heavy(copy) {
    const out = [];
    const walk = (v, at) => {
      if (Array.isArray(v)) { v.forEach(x => walk(x, at)); return; }
      if (!v || typeof v !== 'object') return;
      const here = atOf(v) || at;
      for (const k of Object.keys(v)) {
        if (v === copy && k === 'dispatches') continue;
        const x = v[k];
        if (isPhoto(x)) out.push({ photo: true, holder: v, key: k, size: x.length, at: here });
        else if (Array.isArray(x)) x.forEach((y, i) => isPhoto(y) ? out.push({ photo: true, holder: v, key: k, index: i, size: y.length, at: here }) : walk(y, here));
        else walk(x, here);
      }
    };
    walk(copy, NEWEST);
    for (const d of copy.dispatches || []) {
      for (const f of (d && d.files) || []) {
        if (f && typeof f.data === 'string' && f.data) out.push({ file: f, size: f.data.length, at: atOf(f) || atOf(d) || NEWEST });
      }
    }
    return out;
  }

  // Выкинуть одно: у файла data → null и unsaved:true; у фото запись, где оно было, получает unsaved:{photos, text}.
  function drop(c) {
    if (c.file) { c.file.data = null; c.file.unsaved = true; return; }
    if (c.index === undefined) c.holder[c.key] = null; else c.holder[c.key][c.index] = GONE;
    const prev = c.holder.unsaved && c.holder.unsaved.photos || 0;
    c.holder.unsaved = { photos: prev + 1, text: NO_SPACE };
  }
  // Выкинутые из списка фото в текст не идут
  const text = copy => JSON.stringify(copy, (k, v) => Array.isArray(v) && v.includes(GONE) ? v.filter(y => y !== GONE) : v);

  // Состояние → {text, droppedPhotos, droppedFiles, fits}. Не влезает в limit — выкидывается только то, что не помещается:
  // по одному фото приёмки или файлу заявки, сначала самые новые, при равном времени — самые крупные, пока текст не влезет.
  // Прежние фото и файлы сохраняются. Выкинутое помечается «не сохранено — мало места в браузере»: у фото —
  // запись unsaved:{photos, text}, у файла unsaved:true; droppedPhotos и droppedFiles — сколько выкинуто.
  // Само состояние не меняется.
  function dump(state, limit = LIMIT) {
    const copy = plain(state, true);
    // товары снимка каталога в браузер не идут: они константы файла (Catalog.pack), пишется только изменяемое
    const packed = Catalog.pack(copy.products);
    if (packed) Object.assign(copy, packed);
    copy.rev = REV;
    let out = JSON.stringify(copy);
    let droppedPhotos = 0, droppedFiles = 0;
    if (out.length > limit) {
      const list = heavy(copy).sort((a, b) => b.at - a.at || b.size - a.size);
      // длину после выкидывания сначала прикидываем, точную считаем, когда прикидка влезла
      let est = out.length;
      for (const c of list) {
        if (est <= limit) break;
        drop(c);
        if (c.photo) droppedPhotos++; else droppedFiles++;
        est -= c.size;
        if (est <= limit) { out = text(copy); est = out.length; }
      }
      if (droppedPhotos || droppedFiles) out = text(copy);
    }
    return { text: out, droppedPhotos, droppedFiles, fits: out.length <= limit };
  }

  // Строка из localStorage → состояние с живыми датами; пусто, мусор или чужая версия схемы → null
  // (тогда запуск берёт seed()).
  function load(raw) {
    if (typeof raw !== 'string' || !raw) return null;
    let st;
    try {
      st = JSON.parse(raw, (k, v) => {
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          const keys = Object.keys(v);
          if (keys.length === 1 && keys[0] === '$date') return new Date(v.$date === null ? NaN : v.$date);
        }
        return v;
      });
    } catch (_) { return null; }
    if (!st || typeof st !== 'object' || Array.isArray(st) || st.v !== VERSION || st.rev !== REV) return null;
    delete st.rev;
    return Catalog.unpack(st);
  }

  // Свободный id для новой записи списка: не совпадёт ни с одним сохранённым (общий для ядра).
  function freeId(list, prefix) {
    const used = new Set((list || []).map(x => x && x.id));
    let n = (list || []).length + 1;
    while (used.has(prefix + n)) n++;
    return prefix + n;
  }

  return { KEY, VERSION, REV, LIMIT, NO_SPACE, FILE_MAX, fileTooBig, load, dump, freeId };
})();
