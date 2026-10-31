// Ядро: воронки всех видов — доски задач, сделки B2B и B2C, лиды, поставки.
// Одна модель «воронка с этапами»; запись хранит id этапа, не номер, поэтому
// переименование, вставка и удаление этапа данные не ломают.
// «Сделано/закрыто» — флаг final у этапа, «прибыло, ждёт приёмки» — флаг arrived.

const Pipes = (() => {
  const KINDS = ['tasks', 'deals', 'leads', 'ships'];
  // Где лежат записи вида и в каком поле id воронки.
  const STORE = {
    tasks: { list: 'tasks', field: 'boardId' },
    deals: { list: 'deals', field: 'pipeId' },
    leads: { list: 'leads', field: 'pipeId' },
    ships: { list: 'shipments', field: 'pipeId' },
  };

  const S_ = (id, name, flag) => (flag ? { id, name, flag } : { id, name });
  const DEAL_STAGES = () => [
    S_('request', 'Заявка'), S_('calc', 'Расчёт'), S_('offer', 'КП'), S_('contract', 'Договор'),
    S_('payment', 'Оплата'), S_('delivery', 'Поставка'), S_('install', 'Монтаж'), S_('done', 'Сдана', 'final'),
  ];
  // Воронки по умолчанию — ровно как в interfaces.md. Новая копия на каждый вызов (для seed()).
  function defaults() {
    return [
      { id: 'tasksCommon', kind: 'tasks', name: 'Общие', stages: [
        S_('new', 'Новые'), S_('work', 'В работе'), S_('review', 'На проверке'), S_('done', 'Готово', 'final'),
      ] },
      { id: 'dealsB2b', kind: 'deals', name: 'Сделки B2B', scope: 'b2b', stages: DEAL_STAGES() },
      { id: 'dealsB2c', kind: 'deals', name: 'Сделки B2C', scope: 'b2c', stages: DEAL_STAGES() },
      { id: 'leads', kind: 'leads', name: 'Лиды', stages: [
        S_('new', 'Новый'), S_('contacted', 'Связались'), S_('qualified', 'Квалифицирован'),
        S_('deal', 'Сделка создана', 'final'), S_('lost', 'Отказ', 'final'),
      ] },
      { id: 'ships', kind: 'ships', name: 'Поставки', stages: [
        S_('ordered', 'Заказано'), S_('shipped', 'Отгружено поставщиком'), S_('toBorder', 'В пути до границы'),
        S_('customs', 'Таможня'), S_('transship', 'Перевалка в Чите'), S_('toStock', 'В пути до склада'),
        S_('arrived', 'Прибыло в город', 'arrived'), S_('inStock', 'На складе', 'final'),
      ] },
    ];
  }

  const pipes = st => st.pipelines || [];
  const pipe = (st, pipeId) => pipes(st).find(p => p.id === pipeId) || null;
  const clean = name => String(name || '').trim();

  // Воронки вида; со scope — этого типа и общие (без scope).
  function of(st, kind, scope) {
    return pipes(st).filter(p => p.kind === kind && (!scope || !p.scope || p.scope === scope));
  }

  function stage(st, pipeId, stageId) {
    const p = pipe(st, pipeId);
    return (p && p.stages.find(s => s.id === stageId)) || null;
  }

  function isFinal(st, pipeId, stageId) {
    const s = stage(st, pipeId, stageId);
    return !!s && s.flag === 'final';
  }

  // Записи воронки (задачи доски, сделки, лиды, поставки).
  function items(st, pipeId) {
    const p = pipe(st, pipeId);
    if (!p) return [];
    const { list, field } = STORE[p.kind];
    return (st[list] || []).filter(x => x[field] === pipeId);
  }

  function rename(st, pipeId, name) {
    const p = pipe(st, pipeId), n = clean(name);
    if (!p) return { ok: false, reason: 'Воронка не найдена' };
    if (!n) return { ok: false, reason: 'Название не может быть пустым' };
    p.name = n;
    return { ok: true, reason: '' };
  }

  function renameStage(st, pipeId, stageId, name) {
    const s = stage(st, pipeId, stageId), n = clean(name);
    if (!s) return { ok: false, reason: 'Этап не найден' };
    if (!n) return { ok: false, reason: 'Название не может быть пустым' };
    s.name = n;
    return { ok: true, reason: '' };
  }

  // Новый этап после afterId, без него — в конец. Возвращает этап или null.
  function addStage(st, pipeId, name, afterId) {
    const p = pipe(st, pipeId), n = clean(name);
    if (!p || !n) return null;
    const s = { id: Store.freeId(p.stages, 's'), name: n };
    const i = afterId ? p.stages.findIndex(x => x.id === afterId) : -1;
    if (i < 0) p.stages.push(s); else p.stages.splice(i + 1, 0, s);
    return s;
  }

  const FLAG = { final: 'завершающий', arrived: '«прибыло, ждёт приёмки»' };

  // Удалить этап: его записи переезжают на этап moveToId той же воронки, ни одна не теряется.
  function removeStage(st, pipeId, stageId, moveToId) {
    const p = pipe(st, pipeId);
    if (!p) return { ok: false, moved: 0, reason: 'Воронка не найдена' };
    const s = p.stages.find(x => x.id === stageId);
    if (!s) return { ok: false, moved: 0, reason: 'Этап не найден' };
    if (p.stages.length < 2) return { ok: false, moved: 0, reason: 'Последний этап воронки удалить нельзя' };
    if (s.flag && !p.stages.some(x => x !== s && x.flag === s.flag)) {
      return { ok: false, moved: 0, reason: `Этап «${s.name}» — единственный ${FLAG[s.flag] || s.flag} в воронке «${p.name}»` };
    }
    const here = items(st, pipeId).filter(x => x.stageId === stageId);
    const to = p.stages.find(x => x.id === moveToId && x.id !== stageId);
    if (here.length && !to) return { ok: false, moved: 0, reason: `На этапе «${s.name}» ${here.length} зап. — выберите, куда их перенести` };
    here.forEach(x => { x.stageId = to.id; });
    p.stages = p.stages.filter(x => x !== s);
    return { ok: true, moved: here.length, reason: '' };
  }

  // Новая воронка вида: этапы — копия воронки по умолчанию этого вида.
  function addPipe(st, kind, name, scope) {
    const n = clean(name);
    if (!KINDS.includes(kind) || !n) return null;
    const base = defaults().find(p => p.kind === kind);
    st.pipelines = pipes(st);
    const p = { id: Store.freeId(st.pipelines, kind), kind, name: n, stages: base.stages };
    if (scope) p.scope = scope;
    st.pipelines.push(p);
    return p;
  }

  // Этап в другой воронке для переезжающей записи: тот же id → то же название → тот же флаг → первый.
  function matchStage(from, to, stageId) {
    const s = from.stages.find(x => x.id === stageId);
    return to.stages.find(x => x.id === stageId)
      || (s && to.stages.find(x => x.name === s.name))
      || (s && s.flag && to.stages.find(x => x.flag === s.flag))
      || to.stages[0];
  }

  // Удалить воронку: последнюю своего вида нельзя; записи переезжают в moveToPipeId того же вида.
  function removePipe(st, pipeId, moveToPipeId) {
    const p = pipe(st, pipeId);
    if (!p) return { ok: false, moved: 0, reason: 'Воронка не найдена' };
    if (of(st, p.kind).length < 2) return { ok: false, moved: 0, reason: `«${p.name}» — последняя воронка этого вида, её нельзя удалить` };
    const here = items(st, pipeId);
    const to = moveToPipeId !== pipeId ? pipe(st, moveToPipeId) : null;
    if (here.length && (!to || to.kind !== p.kind)) {
      return { ok: false, moved: 0, reason: `В воронке «${p.name}» ${here.length} зап. — выберите воронку того же вида, куда их перенести` };
    }
    const { field } = STORE[p.kind];
    here.forEach(x => { x.stageId = matchStage(p, to, x.stageId).id; x[field] = to.id; });
    st.pipelines = pipes(st).filter(x => x !== p);
    return { ok: true, moved: here.length, reason: '' };
  }

  return { KINDS, defaults, of, stage, isFinal, items, rename, renameStage, addStage, removeStage, addPipe, removePipe };
})();
