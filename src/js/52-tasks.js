// Раздел «Задачи»
// Перенесено из прототипа v2; колонки — этапы доски задач (Pipes), «готово» — флаг final.
// Задача ставится человеку или целому отделу: задачу отдела видят все в отделе, «Взять» делает взявшего исполнителем.
// Досок несколько; в режиме «Редактировать доску» имя доски и колонок правятся на месте тем же редактором,
// что и «Настройки → Воронки» (разметка и действия — в 62-settings-pipes.js, данные правит ядро Pipes).

// Доска, открытая сейчас: выбранная в переключателе, иначе первая. Новая задача встаёт на неё.
function curBoard(){
  const boards=Pipes.of(S,'tasks');
  return boards.find(b=>b.id===S.ui.taskBoard)||boards[0]||null;
}
// Режим «Редактировать доску»: только у того, кому можно менять настройки фирмы
const boardEditing=()=>!!S.ui.boardEdit&&can('settings')&&!!curBoard();
// Цвет точки задачи — по флагу и месту этапа в воронке (stageTone), а не по номеру или id этапа: этапы можно переименовать и добавить
const taskDot=t=>stageTone(t);
// Мои задачи сегодня и просроченные: {today — срок сегодня, overdue — taskOverdue}. Открытые, мои или моего отдела (taskMine).
// Единственный счёт для плитки главного экрана; «просрочена» — taskOverdue, второго определения нет.
const taskCounts=()=>{
  const mine=S.tasks.filter(t=>taskMine(t)&&!isDone(t));
  return {today:mine.filter(t=>dd(t.due)===0).length,overdue:mine.filter(taskOverdue).length};
};
// Задача отдела, которую может взять человек из этого отдела
const taskTakable=t=>t.to.t==='d'&&t.to.id===me().dept&&!isDone(t);

// ——— задачи ———
function vTasks(){
  const m=me(),F=S.ui.taskF,boards=Pipes.of(S,'tasks'),board=curBoard(),cols=board?.stages||[],edit=boardEditing();
  let list=S.tasks.filter(t=>taskVisible(t)&&t.boardId===board?.id);
  const onBoard=list.length;
  if(F==='mine') list=list.filter(taskMine);
  else if(F==='byme') list=list.filter(t=>t.from===m.id);
  else if(F==='over') list=list.filter(taskOverdue);
  if(can('tasksAll')&&S.ui.taskDept!=='all') list=list.filter(t=>tDept(t)===S.ui.taskDept);
  const seg=[['all',can('tasksAll')?'Все':'Мои и отдела'],['mine','Мне'],['byme','Поставил я'],['over','Просроченные']];
  let h='<div class="bar">';
  if(!edit){
    h+=`<div class="seg">${seg.map(([k,l])=>`<button class="${F===k?'on':''}" data-act="task-f" data-f="${k}">${l}</button>`).join('')}</div>`;
    if(can('tasksAll')) h+=`<select class="inp sm w-auto" id="task-dept" data-on="task-dept" aria-label="Отдел"><option value="all">Все отделы</option>${S.depts.map(d=>`<option value="${esc(d.id)}" ${S.ui.taskDept===d.id?'selected':''}>${esc(d.name)}</option>`).join('')}</select>`;
  }
  if(boards.length>1||edit) h+=`<div class="seg" role="group" aria-label="Доска">${boards.map(b=>`<button class="${b.id===board?.id?'on':''}" data-act="task-board" data-id="${esc(b.id)}">${esc(b.name)}</button>`).join('')}</div>`;
  if(edit) h+=`<button class="btn sm" data-act="pipe-add" data-g="tasks">${ic('plus')}доска</button>`;
  h+='<span class="grow"></span>';
  if(can('settings')&&board) h+=`<button class="btn ${edit?'pri':''}" data-act="board-edit" aria-pressed="${edit}">${edit?ic('check')+'Готово':'Редактировать доску'}</button>`;
  if(!edit) h+=`<button class="btn pri" data-act="new-task">${ic('plus')}Поставить задачу</button>`;
  h+='</div>';
  if(edit) h+=pipeBoardHead(board);
  else h+=`<p class="hint">Перетаскивайте карточки между колонками или откройте задачу и смените статус. Тот, кто поставил задачу, получит уведомление. Задачу отдела видят все в отделе: нажмите «Взять», и она станет вашей.</p>`;
  if(!edit&&!list.length) h+=onBoard?emptyState('Под этот фильтр задач нет.','Показать все','task-f','data-f="all"'):emptyState('Задач нет. Поставьте первую — кнопка «Поставить задачу».','Поставить задачу','new-task');
  const colHead=st=>edit?pipeStageCtl(board,st,false):`<span>${esc(st.name)}</span>`;
  const colHtml=st=>{
    const c=list.filter(t=>t.stageId===st.id).sort((a,b)=>a.due-b.due);
    return `<div class="col ${edit?'col-edit':''}" ${edit?'':`data-col="${esc(st.id)}"`}><div class="col-h">${colHead(st)}<span class="cnt-s">${c.length}</span></div>${c.map(t=>tCard(t,edit)).join('')||'<p class="col-empty">Пусто</p>'}</div>`;
  };
  const addCol=edit?`<div class="col col-add"><button type="button" class="btn" data-act="pipe-stage-add" data-pipe="${esc(board.id)}">${ic('plus')}этап</button><p class="hint">Новый этап встанет перед завершающим: «${esc(cols[cols.length-1]?.name||'')}» останется последним.</p></div>`:'';
  h+=`<div class="xs" data-hscroll><div class="kanban" style="grid-template-columns:repeat(${cols.length+(edit?1:0)},minmax(250px,1fr))">${cols.map(colHtml).join('')}${addCol}</div></div>`;
  return h;
}
function tCard(t,edit){
  const over=taskOverdue(t),dept=t.to.t==='d';
  return `<article class="tcard ${isDone(t)?'done':''}" ${edit?'':`draggable="true" data-drag="${t.id}"`} data-act="open-task" data-id="${t.id}" tabindex="0"><div class="tc-top"><span class="tdot ${taskDot(t)}" aria-hidden="true"></span>${dept?'<span class="pill info sm">отделу</span>':''}${t.prio==='high'?'<span class="pill bad sm">Срочно</span>':''}${t.deal?`<span class="chip mono">${t.deal}</span>`:''}${t.bill?`<span class="chip mono">${esc(t.bill.dispatchId)}</span>`:''}</div><p class="tc-t">${esc(t.title)}</p><div class="tc-m"><span class="who">${t.to.t==='p'?av(person(t.to.id),'xs'):`<span class="av xs">${ic('users')}</span>`}${esc(targetName(t))}</span><span class="due ${over?'bad':''}">${over?'просрочена · ':''}${fRel(t.due)}</span></div>${taskTakable(t)&&!edit?`<button type="button" class="btn sm tc-take" data-act="task-take" data-id="${t.id}">Взять</button>`:''}</article>`;
}
// Задачу двигает тот, кто видит её на доске (taskVisible); запрос счёта по заявке открывают все — без кнопок этапов.
function dTask(t){
  const from=person(t.from),d=t.deal?deal(t.deal):null,over=taskOverdue(t),dept=t.to.t==='d',move=taskVisible(t);
  const dsp=t.bill?Dispatch.byId(S,t.bill.dispatchId):null;
  return {kind:'Задача',title:esc(t.title),sub:`Поставил(а): ${esc(from?.name||'')} · ${fWhen(t.at)}`,body:`
    ${move?`<div class="seg wide">${stagesFor(t).map(st=>`<button class="${t.stageId===st.id?'on':''}" data-act="task-st" data-id="${t.id}" data-st="${esc(st.id)}">${esc(st.name)}</button>`).join('')}</div>`:`<p class="lock">${ic('lock')}Этап «${esc(stagesFor(t).find(s=>s.id===t.stageId)?.name||'нет данных: этап')}». Двигает задачу исполнитель.</p>`}
    ${taskTakable(t)?`<div class="tk-box"><p class="m0">Задача поставлена отделу. Нажмите «Взять» — вы станете исполнителем, у остальных в отделе она пропадёт из «Моих задач».</p><button type="button" class="btn pri" data-act="task-take" data-id="${t.id}">Взять задачу</button></div>`:''}
    <dl class="kv"><dt>Кому</dt><dd>${esc(targetName(t))}${dept?' <span class="pill info sm">отделу</span>':''}</dd>${t.took?`<dt>Взял(а)</dt><dd>${esc(person(t.to.id)?.name||'нет данных: сотрудник')} из отдела «${esc(deptName(t.took.dept))}», ${fWhen(t.took.at)}</dd>`:''}<dt>Срок</dt><dd class="${over?'bad-t':''}">${fD(t.due)}, ${WD[new Date(t.due).getDay()]}${over?' · просрочена':''}</dd><dt>Важность</dt><dd>${t.prio==='high'?'Срочно':'Обычная'}</dd>${t.bill?`<dt>Заявка</dt><dd>${dsp?`<button class="link" data-act="open-dispatch" data-id="${esc(dsp.id)}">${esc(dsp.number)} · ${esc(dsp.to.name)}</button>`:`нет данных: заявка ${esc(t.bill.dispatchId)}`}</dd>`:''}${t.dropped?`<dt>Снята</dt><dd>${esc(t.dropped)}</dd>`:''}${d?`<dt>Сделка</dt><dd>${can('clients')?`<button class="link" data-act="open-deal" data-id="${d.id}">${d.id} · ${esc(d.client)}</button>`:d.id}</dd>`:''}</dl>
    ${t.desc?`<div><h4 class="sh">Подробности</h4><p class="prose">${esc(t.desc)}</p></div>`:''}
    ${attCardHtml('task',t)}`};
}

// «Взять»: первый взявший из отдела становится исполнителем. Задача уходит из «Моих задач» остальных,
// автору и отделу приходит уведомление (кто взял).
function taskTake(id){
  const t=S.tasks.find(x=>x.id===id),m=me();
  if(!t||!taskTakable(t)){toast('Эту задачу взять нельзя: она уже у кого-то или закрыта.','warn');return false}
  const dept=t.to.id,now=new Date();
  t.to={t:'p',id:m.id};t.took={dept,at:now};
  Notify.push(S,'task',m.id,`${m.name} взял(а) задачу «${t.title}» отдела «${deptName(dept)}».`,now,[t.from,...S.people.filter(p=>p.dept===dept).map(p=>p.id)],{t:'task',id:t.id});
  render();toast(`Задача «${t.title}» теперь ваша. Автору и отделу ушло уведомление.`);
  return true;
}

// ——— регистрация в реестрах оболочки ———
DRAWERS.task=id=>{const t=S.tasks.find(x=>x.id===id);return t&&Visible.taskSeen(S,t,me().id)?dTask(t):null};
regRef('task','задача',id=>S.tasks.some(t=>t.id===id),'open-task');
SEARCH.push({kind:'task',label:'Задача',order:70,find:q=>S.tasks.filter(t=>taskVisible(t)&&searchHas(q,t.title)).map(t=>({title:t.title,sub:`${targetName(t)} · ${fRel(t.due)}`,open:`data-act="open-task" data-id="${esc(t.id)}"`}))});
ON.change['task-dept']=t=>{S.ui.taskDept=t.value;render()};
A['task-take']=el=>taskTake(el.dataset.id);
A['task-board']=el=>{S.ui.taskBoard=el.dataset.id;render()};
A['board-edit']=()=>{S.ui.boardEdit=!S.ui.boardEdit;render()};
