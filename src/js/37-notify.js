// Ядро: уведомления. Адресаты — люди (to:[personId]), прочитанность — у каждого своя (read:[personId]).
// Кому что приходит — только карта RECIPIENTS; человек может выключить вид у себя:
// prefs.notify[personId][kind] === false — этот вид ему не приходит.
// Звук нового уведомления — у каждого свой: prefs.sound[personId] = {on, kind}; когда играть, решает soundFor.

const Notify = (() => {
  // Событие → кому: 'all' — все сотрудники, иначе id встроенных ролей (их нельзя удалить, id не меняются).
  // Адресатов конкретного события (исполнитель задачи, люди отдела, менеджер сделки или лида)
  // добавляет вызывающий через extraPersons.
  const RECIPIENTS = {
    ship: 'all',                                               // поставки: этап, точка, срок — все сотрудники (R10)
    arrive: ['director', 'managerB2b', 'managerB2c'],          // приёмка «товар на складе» — менеджеры и директор (R15)
    reserve: ['director', 'warehouse'],                        // резервы — склад и директор, плюс менеджер сделки (extraPersons):
                                                               // менеджер другого типа чужую сделку не видит и о ней не узнаёт
    warn: ['director', 'logist', 'managerB2b', 'managerB2c'],  // приёмка с замечаниями — как в v2
    task: [],                                                  // задачи — исполнитель, отдел и автор (extraPersons)
    msg: ['director'],                                         // сообщения клиентам — плюс менеджер сделки (extraPersons)
    lead: ['director', 'rop'],                                 // новый лид — директору и РОП, плюс менеджер, кому он ушёл (extraPersons)
    mail: [],                                                  // новое письмо — те, кто видит ящик (extraPersons)
    act: [],                                                   // напоминание о деле — ответственный (extraPersons)
    dispatch: ['logist', 'warehouse'],                         // новая заявка на отправку — логист и кладовщик
    dispatchStep: [],                                          // этап и водитель заявки — автор или водитель (extraPersons), исполнителям не рассылаем
    leadWait: ['rop'],                                         // новый лид долго без действий — РОП
  };

  const wants = (st, personId, kind) => {
    const p = st.prefs && st.prefs.notify && st.prefs.notify[personId];
    return !(p && p[kind] === false);
  };

  // Включить или выключить вид этому человеку. Включённый — это отсутствие записи (по умолчанию приходят все виды).
  // Возвращает false, если такого вида или человека нет.
  function setWanted(st, personId, kind, on) {
    if (!Object.hasOwn(RECIPIENTS, kind) || !(st.people || []).some(p => p.id === personId)) return false;
    st.prefs = st.prefs || {};
    st.prefs.notify = st.prefs.notify || {};
    const mine = st.prefs.notify[personId] = st.prefs.notify[personId] || {};
    if (on) delete mine[kind]; else mine[kind] = false;
    return true;
  }

  // Звуки на выбор: id и подпись. Как они звучат — в 63-settings-notify.js (синтез в браузере, файлов нет).
  const SOUNDS = [['bell', 'Колокольчик'], ['drop', 'Капля'], ['double', 'Двойной сигнал'], ['soft', 'Мягкий']];

  // Звук этого человека: {on, kind}. По умолчанию выключен; неизвестный звук заменяется первым из списка.
  function soundPref(st, personId) {
    const p = st.prefs && st.prefs.sound && st.prefs.sound[personId];
    return { on: !!(p && p.on), kind: p && SOUNDS.some(s => s[0] === p.kind) ? p.kind : SOUNDS[0][0] };
  }

  // Изменить звук человека: patch = {on?, kind?}. Возвращает новые настройки или null (нет такого человека или звука).
  function setSound(st, personId, patch) {
    if (!(st.people || []).some(p => p.id === personId)) return null;
    if (patch.kind !== undefined && !SOUNDS.some(s => s[0] === patch.kind)) return null;
    const next = Object.assign(soundPref(st, personId), patch.on === undefined ? {} : { on: !!patch.on }, patch.kind === undefined ? {} : { kind: patch.kind });
    st.prefs = st.prefs || {};
    st.prefs.sound = Object.assign({}, st.prefs.sound);
    st.prefs.sound[personId] = next;
    return Object.assign({}, next);
  }

  // Кому придёт уведомление этого вида: по карте, плюс extraPersons, без тех, кто выключил вид.
  function recipients(st, kind, extraPersons) {
    const rule = RECIPIENTS[kind];
    if (rule === undefined) throw new Error(`Неизвестный вид уведомления: ${kind}`);
    const people = st.people || [];
    const byRule = rule === 'all' ? people : people.filter(p => rule.includes(p.role));
    const ids = [...byRule.map(p => p.id), ...(extraPersons || [])];
    const known = new Set(people.map(p => p.id));
    return [...new Set(ids)].filter(id => known.has(id) && wants(st, id, kind));
  }

  // Новое уведомление — в начало списка. Автор, если он среди адресатов, своё уже прочитал.
  function push(st, kind, by, text, now, extraPersons) {
    const to = recipients(st, kind, extraPersons);
    st.notes = st.notes || [];
    const note = { id: Store.freeId(st.notes, 'n'), kind, by: by || null, at: now, text, to, read: by && to.includes(by) ? [by] : [] };
    st.notes.unshift(note);
    return note;
  }

  // Непрочитанные этим человеком.
  function unread(st, personId) {
    return (st.notes || []).filter(n => n.to.includes(personId) && !n.read.includes(personId));
  }

  // Отметить прочитанным для этого человека: одно уведомление или все его. Возвращает, сколько отмечено.
  function markRead(st, personId, noteId) {
    const list = unread(st, personId).filter(n => !noteId || n.id === noteId);
    list.forEach(n => n.read.push(personId));
    return list.length;
  }

  // Номера непрочитанных этим человеком — по ним видно, пришло ли что-то новое между двумя отрисовками.
  function unreadIds(st, personId) {
    return unread(st, personId).map(n => n.id);
  }

  // Какой звук сыграть человеку: before и after — unreadIds до и после. Звук есть, только если он включён
  // и среди after появился номер, которого не было в before. before = null («смотрим впервые») — тишина,
  // иначе при каждом запуске страницы звенели бы старые уведомления. Возвращает id звука или null.
  function soundFor(st, personId, before, after) {
    const pref = soundPref(st, personId);
    if (!pref.on || !before) return null;
    const had = new Set(before);
    return (after || []).some(id => !had.has(id)) ? pref.kind : null;
  }

  return { RECIPIENTS, SOUNDS, wants, setWanted, soundPref, setSound, soundFor, recipients, push, unread, unreadIds, markRead };
})();
