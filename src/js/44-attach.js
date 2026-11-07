// Ядро: файлы, приложенные к записи — к задаче, поставке, заявке на отправку. Чистые функции, без DOM.
// Файл: {id, name, type, size, data|null, by?, at?, unsaved?}. data — data-URL; null — файл не поместился в браузер
// (тогда unsaved:true, это ставит Store.dump). Запись держит файлы в поле files. Предел одного файла — Store.FILE_MAX;
// сколько файлов влезет в браузер всего, решает Store.dump: выкидывает новые и крупные, остальное остаётся.
// Серверный режим: файл лежит на сервере — {id, name, type, size, url, by, at}, data: null; id — номер файла сервера.
// Фото товара — те же файлы, но в поле photos (не files): первое в списке — главное; только JPEG, PNG, WebP, GIF; не больше PHOTO_MAX.
// add и remove берут имя поля (field), фото — обёртки addPhotos, replacePhoto, removePhoto, mainPhoto.

const Attach = (() => {
  const str = v => (v == null ? '' : String(v).trim());

  // Список от формы → чистые файлы. Без названия — выкидывается; свой id остаётся, нет — выдаётся новый (existing — занятые).
  function clean(list, existing) {
    const all = Array.isArray(list) ? list : [];
    // новые id не совпадают ни с занятыми, ни со своими id файлов дальше по списку
    const used = [...(existing || []), ...all.filter(f => f && f.id).map(f => ({ id: f.id }))];
    const out = [];
    for (const f of all) {
      if (!f || !str(f.name)) continue;
      const file = { id: f.id || Store.freeId(used, 'fl'), name: str(f.name), type: str(f.type), size: Number(f.size) || 0, data: typeof f.data === 'string' && f.data ? f.data : null };
      if (typeof f.url === 'string' && f.url) file.url = f.url;
      if (f.by) file.by = str(f.by);
      if (f.at) file.at = f.at;
      if (f.unsaved) file.unsaved = true;
      used.push(file);
      out.push(file);
    }
    return out;
  }

  // Новый файл с данными больше предела (Store.FILE_MAX) → причина отказа, иначе null. Уже сохранённые файлы записи
  // (existing) и файлы без данных (не поместились в браузер) места не занимают и не проверяются.
  function tooBig(list, existing) {
    const had = new Set((existing || []).map(f => f.id));
    return (Array.isArray(list) ? list : []).filter(f => f && !had.has(f.id) && typeof f.data === 'string' && f.data).map(Store.fileTooBig).find(Boolean) || null;
  }

  // ——— фото товара ———
  const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const PHOTO_MAX = 20;
  const PHOTO_ONLY = 'можно только фото: JPEG, PNG, WebP или GIF';
  // Тип файла: заявленный (type) и, у файла из браузера, записанный в начале data-URL (после «data:» до «;»).
  // Фото — когда все названные из списка и хоть один назван; SVG и всё прочее — нет.
  function photoProblem(f) {
    const declared = str(f && f.type).toLowerCase();
    const m = f && typeof f.data === 'string' ? /^data:([^;,]*)/i.exec(f.data) : null;
    const seen = [declared, m ? m[1].trim().toLowerCase() : ''].filter(Boolean);
    return seen.length && seen.every(t => PHOTO_TYPES.includes(t)) ? null : `Файл «${str(f && f.name) || 'без названия'}» не принят: ${PHOTO_ONLY}.`;
  }

  // Приложить файлы к готовой записи. → {ok:true, added:[файл…]} | {ok:false, reason}. Либо все, либо ни одного.
  // opt: {field — поле записи со списком (по умолчанию files), accept — файл → причина отказа или null, max — сколько файлов в списке всего}.
  function add(rec, list, by, now, opt = {}) {
    const field = opt.field || 'files';
    const has = f => (typeof f.data === 'string' && f.data) || (typeof f.url === 'string' && f.url);
    const fresh = (Array.isArray(list) ? list : []).filter(f => f && str(f.name) && has(f));
    if (!fresh.length) return { ok: false, reason: field === 'files' ? 'Нет файла, который можно приложить.' : 'Нет файла, который можно добавить.' };
    const files = Array.isArray(rec[field]) ? rec[field] : (rec[field] = []);
    const refused = opt.accept && fresh.map(opt.accept).find(Boolean);
    if (refused) return { ok: false, reason: refused };
    if (opt.max && files.length + fresh.length > opt.max) return { ok: false, reason: `Не больше ${opt.max} в списке: сейчас ${files.length}, добавляете ${fresh.length}.` };
    const big = tooBig(fresh, files);
    if (big) return { ok: false, reason: big };
    // файл на сервере сохраняет свой номер; файл из браузера получает новый
    const added = clean(fresh.map(f => ({ ...f, id: f.url && f.id ? f.id : '', by, at: now })), files);
    files.push(...added);
    return { ok: true, added };
  }

  // Может ли by убрать файл f: свой — тот, кто приложил; чужой — только если any (право решает вызывающий).
  const canRemove = (f, by, any) => !!f && (!!any || (!!f.by && f.by === by));

  // Убрать файл из записи. → {ok:true, file} | {ok:false, reason}
  function remove(rec, fileId, by, any, field = 'files') {
    const files = (rec && rec[field]) || [];
    const i = files.findIndex(f => f.id === fileId);
    if (i < 0) return { ok: false, reason: 'Такого файла нет.' };
    if (!canRemove(files[i], by, any)) return { ok: false, reason: 'Убрать файл может тот, кто его приложил.' };
    return { ok: true, file: files.splice(i, 1)[0] };
  }

  // Фото товара: список rec.photos; менять и убирать может любой, кому разрешено править товар (право catalog проверяет вызывающий).
  const PHOTOS = { field: 'photos', accept: photoProblem, max: PHOTO_MAX };
  const addPhotos = (rec, list, by, now) => add(rec, list, by, now, PHOTOS);
  const removePhoto = (rec, id) => remove(rec, id, '', true, 'photos');
  // Заменить фото другим файлом на том же месте списка (главное остаётся главным). Не вышло — список как был.
  // → {ok:true, file, old} | {ok:false, reason}
  function replacePhoto(rec, id, file, by, now) {
    const list = (rec && rec.photos) || [];
    const i = list.findIndex(f => f.id === id);
    if (i < 0) return { ok: false, reason: 'Такого фото нет.' };
    const old = list.splice(i, 1)[0];
    const r = add(rec, [file], by, now, { field: 'photos', accept: photoProblem });   // новое встало в конец
    if (!r.ok) { list.splice(i, 0, old); return r; }
    list.splice(i, 0, list.pop());
    return { ok: true, file: list[i], old };
  }
  // Сделать фото главным: оно встаёт первым, порядок остальных не меняется.
  function mainPhoto(rec, id) {
    const list = (rec && rec.photos) || [];
    const i = list.findIndex(f => f.id === id);
    if (i < 0) return { ok: false, reason: 'Такого фото нет.' };
    list.unshift(...list.splice(i, 1));
    return { ok: true, file: list[0] };
  }

  return { clean, tooBig, add, canRemove, remove, PHOTO_TYPES, PHOTO_MAX, PHOTO_ONLY, photoProblem, addPhotos, removePhoto, replacePhoto, mainPhoto };
})();
