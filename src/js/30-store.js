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
  const REV = 8;
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

  // Выкидывает фото из копии; запись, где они были, помечается. Возвращает, сколько фото выкинуто.
  function dropPhotos(node) {
    let total = 0;
    const walk = (v, owner) => {
      if (Array.isArray(v)) { v.forEach(x => walk(x, owner)); return; }
      if (!v || typeof v !== 'object') return;
      let here = 0;
      for (const k of Object.keys(v)) {
        const x = v[k];
        if (isPhoto(x)) { v[k] = null; here++; continue; }
        if (Array.isArray(x)) {
          const keep = x.filter(y => !isPhoto(y));
          here += x.length - keep.length;
          v[k] = keep;
          keep.forEach(y => walk(y, v));
          continue;
        }
        walk(x, v);
      }
      if (here) {
        const prev = v.unsaved && v.unsaved.photos || 0;
        v.unsaved = { photos: prev + here, text: NO_SPACE };
        total += here;
      }
    };
    walk(node, null);
    return total;
  }

  // Состояние → {text, droppedPhotos, fits}. Не влезает в limit — фото выкидываются
  // (droppedPhotos — сколько), их записи помечаются «не сохранено — мало места в браузере».
  // Само состояние не меняется.
  function dump(state, limit = LIMIT) {
    const copy = plain(state, true);
    // товары снимка каталога в браузер не идут: они константы файла (Catalog.pack), пишется только изменяемое
    const packed = Catalog.pack(copy.products);
    if (packed) Object.assign(copy, packed);
    copy.rev = REV;
    let text = JSON.stringify(copy);
    let droppedPhotos = 0;
    if (text.length > limit) {
      droppedPhotos = dropPhotos(copy);
      if (droppedPhotos) text = JSON.stringify(copy);
    }
    return { text, droppedPhotos, fits: text.length <= limit };
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

  return { KEY, VERSION, REV, LIMIT, NO_SPACE, load, dump, freeId };
})();
