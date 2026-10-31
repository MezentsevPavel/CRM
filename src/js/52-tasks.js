// Раздел «Задачи»
// Перенесено из прототипа v2; колонки — этапы доски задач (Pipes), «готово» — флаг final.

// ——— задачи ———
function vTasks(){
  const m=me(),F=S.ui.taskF,board=taskBoard(),cols=board?.stages||[];
  let list=S.tasks.filter(t=>taskVisible(t)&&t.boardId===board?.id);
  if(F==='mine') list=list.filter(taskMine);
  else if(F==='byme') list=list.filter(t=>t.from===m.id);
  else if(F==='over') list=list.filter(taskOverdue);
  if(can('tasksAll')&&S.ui.taskDept!=='all') list=list.filter(t=>tDept(t)===S.ui.taskDept);
  const seg=[['all',can('tasksAll')?'Все':'Мои и отдела'],['mine','Мне'],['byme','Поставил я'],['over','Просроченные']];
  let h=`<div class="bar"><div class="seg">${seg.map(([k,l])=>`<button class="${F===k?'on':''}" data-act="task-f" data-f="${k}">${l}</button>`).join('')}</div>`;
  if(can('tasksAll')) h+=`<select class="inp sm w-auto" id="task-dept" data-on="task-dept" aria-label="Отдел"><option value="all">Все отделы</option>${S.depts.map(d=>`<option value="${esc(d.id)}" ${S.ui.taskDept===d.id?'selected':''}>${esc(d.name)}</option>`).join('')}</select>`;
  h+=`<span class="grow"></span><button class="btn pri" data-act="new-task">${ic('plus')}Поставить задачу</button></div>`;
  h+=`<p class="hint">Перетаскивайте карточки между колонками или откройте задачу и смените статус. Тот, кто поставил задачу, получит уведомление.</p>`;
  h+=`<div class="xs" data-hscroll><div class="kanban" style="grid-template-columns:repeat(${cols.length},minmax(250px,1fr))">${cols.map(st=>{const c=list.filter(t=>t.stageId===st.id).sort((a,b)=>a.due-b.due);return `<div class="col" data-col="${esc(st.id)}"><div class="col-h"><span>${esc(st.name)}</span><span class="cnt-s">${c.length}</span></div>${c.map(tCard).join('')||'<p class="col-empty">Пусто</p>'}</div>`}).join('')}</div></div>`;
  return h;
}
function tCard(t){
  const over=taskOverdue(t);
  return `<article class="tcard ${isDone(t)?'done':''}" draggable="true" data-drag="${t.id}" data-act="open-task" data-id="${t.id}" tabindex="0"><div class="tc-top">${t.prio==='high'?'<span class="pill bad sm">Срочно</span>':''}${t.deal?`<span class="chip mono">${t.deal}</span>`:''}</div><p class="tc-t">${esc(t.title)}</p><div class="tc-m"><span class="who">${t.to.t==='p'?av(person(t.to.id),'xs'):`<span class="av xs">${ic('users')}</span>`}${esc(targetName(t))}</span><span class="due ${over?'bad':''}">${over?'просрочена · ':''}${fRel(t.due)}</span></div></article>`;
}
function dTask(t){
  const from=person(t.from),d=t.deal?deal(t.deal):null,over=taskOverdue(t);
  return {kind:'Задача',title:esc(t.title),sub:`Поставил(а): ${esc(from?.name||'')} · ${fWhen(t.at)}`,body:`
    <div class="seg wide">${stagesFor(t).map(st=>`<button class="${t.stageId===st.id?'on':''}" data-act="task-st" data-id="${t.id}" data-st="${esc(st.id)}">${esc(st.name)}</button>`).join('')}</div>
    <dl class="kv"><dt>Кому</dt><dd>${esc(targetName(t))}</dd><dt>Срок</dt><dd class="${over?'bad-t':''}">${fD(t.due)}, ${WD[new Date(t.due).getDay()]}${over?' · просрочена':''}</dd><dt>Важность</dt><dd>${t.prio==='high'?'Срочно':'Обычная'}</dd>${d?`<dt>Сделка</dt><dd>${can('clients')?`<button class="link" data-act="open-deal" data-id="${d.id}">${d.id} · ${esc(d.client)}</button>`:d.id}</dd>`:''}</dl>
    ${t.desc?`<div><h4 class="sh">Подробности</h4><p class="prose">${esc(t.desc)}</p></div>`:''}`};
}

// ——— регистрация в реестрах оболочки ———
DRAWERS.task=id=>{const t=S.tasks.find(x=>x.id===id);return t&&taskVisible(t)?dTask(t):null};
ON.change['task-dept']=t=>{S.ui.taskDept=t.value;render()};
