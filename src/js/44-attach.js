// Ядро: файлы, приложенные к записи — к задаче, поставке, заявке на отправку. Чистые функции, без DOM.
// Файл: {id, name, type, size, data|null, by?, at?, unsaved?}. data — data-URL; null — файл не поместился в браузер
// (тогда unsaved:true, это ставит Store.dump). Запись держит файлы в поле files. Предел одного файла — Store.FILE_MAX;
// сколько файлов влезет в браузер всего, решает Store.dump: выкидывает новые и крупные, остальное остаётся.
// Серверный режим: файл лежит на сервере — {id, name, type, size, url, by, at}, data: null; id — номер файла сервера.

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

  // Приложить файлы к готовой записи. → {ok:true, added:[файл…]} | {ok:false, reason}. Либо все, либо ни одного.
  function add(rec, list, by, now) {
    const has = f => (typeof f.data === 'string' && f.data) || (typeof f.url === 'string' && f.url);
    const fresh = (Array.isArray(list) ? list : []).filter(f => f && str(f.name) && has(f));
    if (!fresh.length) return { ok: false, reason: 'Нет файла, который можно приложить.' };
    const files = Array.isArray(rec.files) ? rec.files : (rec.files = []);
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
  function remove(rec, fileId, by, any) {
    const files = (rec && rec.files) || [];
    const i = files.findIndex(f => f.id === fileId);
    if (i < 0) return { ok: false, reason: 'Такого файла нет.' };
    if (!canRemove(files[i], by, any)) return { ok: false, reason: 'Убрать файл может тот, кто его приложил.' };
    return { ok: true, file: files.splice(i, 1)[0] };
  }

  return { clean, tooBig, add, canRemove, remove };
})();
