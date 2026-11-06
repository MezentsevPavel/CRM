// Ядро: задачи — поручение человеку или отделу на доске задач. Единственное место, где задача заводится: форма «Поставить
// задачу» (50-shell.js), приёмка — «позвонить клиенту» (55-receiving.js), счёт между юрлицами по заявке (39-dispatch.js).
// Без DOM и S: состояние st первым аргументом, время now — аргументом.
//
// Задача st.tasks[]: {id, title, desc, to:{t:'p'|'d', id}, from, due, boardId, stageId, prio:'normal'|'high', deal, at,
//   files?, took?:{dept, at}, bill?:{dispatchId, owner, seller}, dropped?}. Этап — id этапа доски (Pipes, вид tasks):
//   «готово» — этап с флагом final. bill — запрос счёта по заявке (Dispatch.requestBill), dropped — почему запрос снят.

const Tasks = (() => {
  const boards = st => Pipes.of(st, 'tasks');
  const board = (st, boardId) => boards(st).find(b => b.id === boardId) || boards(st)[0] || null;
  // С чего задача начинает: первый этап доски без флага. Чем кончается: этап с флагом final.
  const startStage = (st, boardId) => { const b = board(st, boardId); return b ? b.stages.find(s => !s.flag) || b.stages[0] || null : null; };
  const endStage = (st, boardId) => { const b = board(st, boardId); return b ? b.stages.find(s => s.flag === 'final') || null : null; };
  const isDone = (st, t) => !!t && Pipes.isFinal(st, t.boardId, t.stageId);
  // Кому адресована задача — люди: исполнитель или весь отдел
  const people = (st, to) => (to && to.t === 'p' ? [to.id] : (st.people || []).filter(p => to && p.dept === to.id).map(p => p.id));
  const personName = (st, id) => ((st.people || []).find(p => p.id === id) || {}).name || 'нет данных: сотрудник';

  // Поставить задачу: data = {title, desc?, to:{t, id}, from, due, boardId? (нет — первая доска), prio?, deal?, files?, bill?}.
  // Встаёт на первый этап доски. Исполнителю (или отделу) — уведомление «Новая задача…»; opts.silent — без него,
  // opts.tail — добавка к тексту уведомления. → задача | null (нет доски задач)
  function add(st, data, now, opts) {
    const o = opts || {}, b = board(st, data.boardId), s = startStage(st, b && b.id);
    if (!b || !s) return null;
    st.tasks = st.tasks || [];
    const t = {
      id: Store.freeId(st.tasks, 't'), title: data.title, desc: data.desc || '', to: { t: data.to.t, id: data.to.id }, from: data.from,
      due: data.due, boardId: b.id, stageId: s.id, prio: data.prio || 'normal', deal: data.deal || '', at: now,
    };
    if (data.files) t.files = data.files;
    if (data.bill) t.bill = { dispatchId: data.bill.dispatchId, owner: data.bill.owner, seller: data.bill.seller };
    st.tasks.push(t);
    if (!o.silent) {
      Notify.push(st, 'task', t.from, `Новая задача: «${t.title}», срок ${fD(t.due)}.${t.deal ? ' Сделка ' + t.deal + '.' : ''}${o.tail || ''} От: ${personName(st, t.from)}.`,
        now, people(st, t.to), { t: 'task', id: t.id });
    }
    return t;
  }

  return { board, startStage, endStage, isDone, people, add };
})();
