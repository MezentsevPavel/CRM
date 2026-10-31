// Ядро: уведомления. Адресаты — люди (to:[personId]), прочитанность — у каждого своя (read:[personId]).
// Кому что приходит — только карта RECIPIENTS; человек может выключить вид у себя:
// prefs.notify[personId][kind] === false — этот вид ему не приходит.

const Notify = (() => {
  // Событие → кому: 'all' — все сотрудники, иначе id встроенных ролей (их нельзя удалить, id не меняются).
  // Адресатов конкретного события (исполнитель задачи, люди отдела, менеджер сделки или лида)
  // добавляет вызывающий через extraPersons.
  const RECIPIENTS = {
    ship: 'all',                                               // поставки: этап, точка, срок — все сотрудники (R10)
    arrive: ['director', 'managerB2b', 'managerB2c'],          // приёмка «товар на складе» — менеджеры и директор (R15)
    reserve: ['director', 'managerB2b', 'managerB2c', 'warehouse'], // резервы — как в v2
    warn: ['director', 'logist', 'managerB2b', 'managerB2c'],  // приёмка с замечаниями — как в v2
    task: [],                                                  // задачи — исполнитель, отдел и автор (extraPersons)
    msg: ['director'],                                         // сообщения клиентам — плюс менеджер сделки (extraPersons)
    lead: ['director', 'rop'],                                 // новый лид — директору и РОП, плюс менеджер, кому он ушёл (extraPersons)
    mail: [],                                                  // новое письмо — те, кто видит ящик (extraPersons)
    act: [],                                                   // напоминание о деле — ответственный (extraPersons)
  };

  const wants = (st, personId, kind) => {
    const p = st.prefs && st.prefs.notify && st.prefs.notify[personId];
    return !(p && p[kind] === false);
  };

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

  return { RECIPIENTS, recipients, push, unread, markRead };
})();
