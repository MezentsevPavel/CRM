// Ядро: воронки всех видов — доски задач, сделки B2B и B2C, лиды, поставки.
// Одна модель «воронка с этапами»; запись хранит id этапа, не номер, поэтому
// переименование, вставка и удаление этапа данные не ломают.
// «Сделано/закрыто» — флаг final у этапа, «прибыло, ждёт приёмки» — флаг arrived.
// Правка воронок данных не теряет: удаление этапа или воронки переносит ВСЕ записи этого вида (Pipes.items знает пять видов)
// и правила поставок (shipRules.then); этапы, на которые опирается логика по id, удалить нельзя — только переименовать.

const Pipes = (() => {
  const KINDS = ['tasks', 'deals', 'leads', 'ships', 'dispatch'];
  // Где лежат записи вида и в каком поле id воронки.
  const STORE = {
    tasks: { list: 'tasks', field: 'boardId' },
    deals: { list: 'deals', field: 'pipeId' },
    leads: { list: 'leads', field: 'pipeId' },
    ships: { list: 'shipments', field: 'pipeId' },
    dispatch: { list: 'dispatches', field: 'pipeId' },
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

  // Что значит флаг этапа — для объяснения, почему этап не удалить.
  const FLAG_WHY = {
    final: 'он завершающий: по нему CRM считает запись закрытой',
    arrived: 'он отмечает «прибыло, ждёт приёмки»: по нему склад видит, что принимать',
  };

  // Этапы, на которые опирается логика по id, объявляет сам модуль вида: Pipes.guard('leads', pipe => ({ <id этапа>: 'зачем он нужен' })).
  // Так список лежит там, где живёт логика (35-leads.js, 39-dispatch.js), а не копией здесь.
  const guards = {};
  function guard(kind, fn) { guards[kind] = fn; }

  // Зачем этап нужен логике: '' — свободный. Этап с флагом и этап из списка модуля вида — только переименовывать.
  function why(st, pipeId, stageId) {
    const p = pipe(st, pipeId), s = p && p.stages.find(x => x.id === stageId);
    if (!s) return '';
    if (s.flag) return FLAG_WHY[s.flag] || 'у него есть флаг, на который опирается CRM';
    return (guards[p.kind] ? guards[p.kind](p) : {})[stageId] || '';
  }

  // Почему этап нельзя удалить, целой фразой: '' — можно.
  function lock(st, pipeId, stageId) {
    const w = why(st, pipeId, stageId), s = stage(st, pipeId, stageId);
    return w ? `Этап «${s.name}» нельзя удалить: ${w}. Его можно только переименовать.` : '';
  }

  // Правила поставок «если событие — поставить этап»: они ссылаются на этапы воронки поставок «едут к нам» (как в «Настройки → Поставки»).
  const ruleHolds = p => p.kind === 'ships' && (p.dir || 'in') === 'in';
  const rulesAt = (st, p, stageId) => (ruleHolds(p) ? (st.shipRules || []).filter(r => r.then === stageId) : []);

  // Что висит на этапе: записей и правил. Нужно, чтобы спросить «куда перенести», только когда есть что переносить.
  function usage(st, pipeId, stageId) {
    const p = pipe(st, pipeId);
    if (!p) return { items: 0, rules: 0 };
    return { items: items(st, pipeId).filter(x => x.stageId === stageId).length, rules: rulesAt(st, p, stageId).length };
  }

  // После какого этапа вставлять новый, чтобы завершающие этапы остались в конце: перед первым этапом с флагом.
  // Без флагов — undefined (в конец).
  function beforeEnd(st, pipeId) {
    const p = pipe(st, pipeId);
    const i = p ? p.stages.findIndex(s => s.flag) : -1;
    return i > 0 ? p.stages[i - 1].id : undefined;
  }

  // Удалить этап: его записи и правила поставок переезжают на этап moveToId той же воронки, ничего не теряется.
  // Этап с флагом и этап, на который опирается логика (lock), не удаляется.
  function removeStage(st, pipeId, stageId, moveToId) {
    const p = pipe(st, pipeId);
    if (!p) return { ok: false, moved: 0, reason: 'Воронка не найдена' };
    const s = p.stages.find(x => x.id === stageId);
    if (!s) return { ok: false, moved: 0, reason: 'Этап не найден' };
    if (p.stages.length < 2) return { ok: false, moved: 0, reason: 'Последний этап воронки удалить нельзя' };
    const why = lock(st, pipeId, stageId);
    if (why) return { ok: false, moved: 0, reason: why };
    const here = items(st, pipeId).filter(x => x.stageId === stageId), rules = rulesAt(st, p, stageId);
    const to = p.stages.find(x => x.id === moveToId && x.id !== stageId);
    if ((here.length || rules.length) && !to) {
      const what = [];
      if (here.length) what.push(`${here.length} зап.`);
      if (rules.length) what.push(`${rules.length} ${pl(rules.length, 'правило', 'правила', 'правил')} поставок`);
      return { ok: false, moved: 0, reason: `На этапе «${s.name}» ${what.join(' и ')} — выберите, куда их перенести` };
    }
    here.forEach(x => { x.stageId = to.id; });
    rules.forEach(r => { r.then = to.id; });
    p.stages = p.stages.filter(x => x !== s);
    return { ok: true, moved: here.length, rules: rules.length, reason: '' };
  }

  // Новая воронка вида: этапы — копия воронки по умолчанию этого вида.
  function addPipe(st, kind, name, scope) {
    const n = clean(name);
    if (!KINDS.includes(kind) || !n) return null;
    // воронки отправок по умолчанию в defaults() нет (её кладёт шаг SEEDS в 39-dispatch.js): берём этапы первой такой воронки
    const base = defaults().find(p => p.kind === kind) || pipes(st).find(p => p.kind === kind);
    if (!base) return null;
    st.pipelines = pipes(st);
    const p = { id: Store.freeId(st.pipelines, kind), kind, name: n, stages: base.stages.map(s => ({ ...s })) };
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

  // Воронки «того же рода», что эта: вид, тип сделок (scope) и направление поставок (dir) совпадают.
  // Записи переезжают только между такими: сделка B2B не должна оказаться в воронке B2C.
  const alike = (a, b) => a.kind === b.kind && (a.scope || '') === (b.scope || '') && (a.dir || '') === (b.dir || '');
  const siblings = (st, pipeId) => { const p = pipe(st, pipeId); return p ? pipes(st).filter(x => alike(x, p)) : []; };

  // Удалить воронку: последнюю своего рода нельзя; записи и правила поставок переезжают в moveToPipeId того же рода.
  function removePipe(st, pipeId, moveToPipeId) {
    const p = pipe(st, pipeId);
    if (!p) return { ok: false, moved: 0, reason: 'Воронка не найдена' };
    if (siblings(st, pipeId).length < 2) return { ok: false, moved: 0, reason: `«${p.name}» — последняя воронка этого вида, её нельзя удалить` };
    const here = items(st, pipeId);
    const to = moveToPipeId !== pipeId ? pipe(st, moveToPipeId) : null;
    const rules = ruleHolds(p) ? (st.shipRules || []).filter(r => p.stages.some(x => x.id === r.then)) : [];
    if ((here.length || rules.length) && (!to || !alike(to, p))) {
      return { ok: false, moved: 0, reason: `В воронке «${p.name}» ${here.length} зап. — выберите воронку того же вида, куда их перенести` };
    }
    const { field } = STORE[p.kind];
    here.forEach(x => { x.stageId = matchStage(p, to, x.stageId).id; x[field] = to.id; });
    rules.forEach(r => { r.then = matchStage(p, to, r.then).id; });
    st.pipelines = pipes(st).filter(x => x !== p);
    return { ok: true, moved: here.length, reason: '' };
  }

  return { KINDS, defaults, of, stage, isFinal, items, usage, why, lock, guard, beforeEnd, siblings, rename, renameStage, addStage, removeStage, addPipe, removePipe };
})();
