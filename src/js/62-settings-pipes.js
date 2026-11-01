// «Настройки → Воронки»: один редактор для всех воронок — доски задач, сделки B2B и B2C, лиды, поставки, отправки.
// Тот же редактор зовёт режим «Редактировать доску» в «Задачах» (52-tasks.js): разметку дают pipeNameCtl, pipeStageCtl и
// pipeEditor, действия — A['pipe-*'] и FORMS['pipe-*'] ниже. Данные правит только ядро Pipes (32-pipes.js):
// оно же не даёт потерять записи, правила поставок и этапы, на которых держится логика.
// Выбор воронки и группы — S.ui.pipeGroup, S.ui.pipeSel (не сохраняется).

// Группы выбора. add — можно заводить новые воронки группы (их умеют показывать «Задачи» и «Сделки»);
// у лидов, поставок и отправок разделы работают с первой воронкой, поэтому там правятся только этапы.
const PIPE_GROUPS=[
  {id:'tasks',label:'Доски задач',kind:'tasks',add:'доска',where:'Колонки досок в разделе «Задачи».'},
  {id:'b2b',label:'Сделки B2B',kind:'deals',scope:'b2b',add:'воронка',where:'Колонки канбана в разделе «Сделки», тип B2B.'},
  {id:'b2c',label:'Сделки B2C',kind:'deals',scope:'b2c',add:'воронка',where:'Колонки канбана в разделе «Сделки», тип B2C.'},
  {id:'leads',label:'Лиды',kind:'leads',where:'Этапы лидов в разделе «Лиды».'},
  {id:'ships',label:'Поставки',kind:'ships',where:'Этапы поставок: вид «Воронка» в разделе «Поставки и перевозки», правила в «Настройки → Поставки».'},
  {id:'dispatch',label:'Отправки',kind:'dispatch',where:'Этапы заявок в разделе «Отправки».'},
];
const PIPE_FLAG={final:'завершающий',arrived:'прибыло, ждёт приёмки'};

const pipeGroup=()=>PIPE_GROUPS.find(g=>g.id===S.ui.pipeGroup)||PIPE_GROUPS[0];
const groupPipes=g=>Pipes.of(S,g.kind,g.scope).filter(p=>!g.scope||p.scope===g.scope);
// Воронка, открытая в настройках: выбранная в группе, иначе первая
const pipeSel=()=>{const ps=groupPipes(pipeGroup());return ps.find(p=>p.id===S.ui.pipeSel)||ps[0]||null};
const pipeNoun=p=>p.kind==='tasks'?'доска':'воронка';
const pipeAcc=p=>p.kind==='tasks'?'доску':'воронку';

// ——— разметка редактора: её берут и настройки, и доска задач ———
const pipeNameCtl=p=>`<input class="inp pe-name" data-on="pipe-name" data-pipe="${esc(p.id)}" value="${esc(p.name)}" aria-label="Название: ${esc(pipeNoun(p))}" autocomplete="off">`;

// Один этап: имя правится на месте; вместо «×» у этапа, на котором держится логика, — замок. full — с пояснением словами.
function pipeStageCtl(p,s,full){
  const why=Pipes.why(S,p.id,s.id),attrs=`data-pipe="${esc(p.id)}" data-stage="${esc(s.id)}"`;
  const act=why
    ?`<button type="button" class="btn ghost icon sm pe-lock" data-act="pipe-lock" ${attrs} title="${esc(Pipes.lock(S,p.id,s.id))}" aria-label="Этап «${esc(s.name)}» защищён: ${esc(why)}">${ic('lock')}</button>`
    :`<button type="button" class="btn ghost icon sm" data-act="pipe-stage-del" ${attrs} title="Удалить этап" aria-label="Удалить этап «${esc(s.name)}»">${ic('x')}</button>`;
  return `<div class="pe-stage"><input class="inp sm pe-sname" data-on="pipe-stage-name" ${attrs} value="${esc(s.name)}" aria-label="Название этапа" autocomplete="off">${act}</div>`
    +(full&&why?`<small class="pe-why">${ic('lock')}Защищён: ${esc(why)}. Название менять можно, удалить нельзя.</small>`:'');
}

// Имя воронки и «удалить»: для последней воронки своего рода кнопка выключена и объясняет почему
function pipeBoardHead(p){
  const last=Pipes.siblings(S,p.id).length<2,n=pipeNoun(p),acc=pipeAcc(p);
  return `<div class="pe-head">${pipeNameCtl(p)}<button type="button" class="btn sm" data-act="pipe-del" data-pipe="${esc(p.id)}" ${last?'disabled':''} title="${last?`Последнюю ${acc} удалить нельзя`:''}">Удалить ${acc}</button></div>`
    +(last?`<p class="hint">Последнюю ${acc} удалить нельзя: записям некуда переехать.</p>`:'');
}

// Весь редактор воронки (для настроек): имя, этапы строками с числом записей, «+ этап»
function pipeEditor(p,g){
  const rows=p.stages.map((s,i)=>{
    const n=Pipes.usage(S,p.id,s.id).items;
    return `<li class="pe-row"><span class="pe-n">${i+1}</span><div class="pe-main">${pipeStageCtl(p,s,true)}</div>${s.flag?`<span class="pill sm">${esc(PIPE_FLAG[s.flag]||s.flag)}</span>`:''}<span class="muted sm pe-cnt">${n?`${n} ${pl(n,'запись','записи','записей')}`:'пусто'}</span></li>`;
  }).join('');
  const lastName=p.stages[p.stages.length-1]?.name||'';
  return `<section class="card"><div class="card-h"><h3 data-pipe-title="${esc(p.id)}">${esc(p.name)}</h3><span class="muted sm">${p.stages.length} ${pl(p.stages.length,'этап','этапа','этапов')} · ${esc(g.where)}</span></div><div class="card-b stack-s">
    ${g.add?pipeBoardHead(p):`<div class="pe-head">${pipeNameCtl(p)}</div>`}
    <ol class="pe-list">${rows}</ol>
    <div class="pe-foot"><button type="button" class="btn" data-act="pipe-stage-add" data-pipe="${esc(p.id)}">${ic('plus')}этап</button><span class="hint">Новый этап встаёт перед завершающими: «${esc(lastName)}» остаётся последним. Переименование видно в разделе сразу.</span></div>
  </div></section>`;
}

function vPipes(){
  const g=pipeGroup(),ps=groupPipes(g),p=pipeSel();
  const groups=`<div class="seg" role="group" aria-label="Что настраиваем">${PIPE_GROUPS.map(x=>`<button type="button" class="${x===g?'on':''}" data-act="pipe-group" data-g="${x.id}">${x.label}</button>`).join('')}</div>`;
  const picks=(ps.length>1||g.add)?`<div class="bar">${ps.length>1?`<div class="seg" role="group" aria-label="Какая воронка">${ps.map(x=>`<button type="button" class="${p&&x.id===p.id?'on':''}" data-act="pipe-pick" data-id="${esc(x.id)}">${esc(x.name)}</button>`).join('')}</div>`:''}${g.add?`<button type="button" class="btn sm" data-act="pipe-add" data-g="${g.id}">${ic('plus')}${g.add}</button>`:''}</div>`:'';
  return `<div class="bar">${groups}</div>${picks}<p class="hint">Воронка — цепочка этапов, по которой идёт запись. Здесь меняют названия этапов, добавляют и удаляют их; записи с удаляемого этапа CRM переносит туда, куда вы скажете. Этапы с замком — на них держится логика CRM, их можно только переименовать.</p>${p?pipeEditor(p,g):'<p class="empty">Воронок этого вида нет.</p>'}`;
}

SETTINGS_TABS.push({id:'pipes',label:'Воронки',order:30,ok:()=>can('settings'),render:vPipes});

// ——— окна: куда перенести записи ———
const pipeOpt=(x,sel)=>`<option value="${esc(x.id)}" ${sel?'selected':''}>${esc(x.name)}</option>`;
// Ключ окна «pipeId|stageId»
MODALS.pipeStageDel=key=>{
  const [pid,sid]=String(key).split('|'),p=pipeById(pid),s=p&&Pipes.stage(S,pid,sid);
  if(!s) return '';
  // куда переносить — решает ядро (Pipes.moveTargets): завершающие этапы («На складе», «Сдана», «Доставлена»…) запись получает
  // только своим действием, поэтому здесь их нет; по умолчанию — ближайший следующий из разрешённых
  const u=Pipes.usage(S,pid,sid),i=p.stages.indexOf(s),rest=Pipes.moveTargets(S,pid,sid);
  const next=p.stages.slice(i+1).find(x=>rest.includes(x))||[...p.stages.slice(0,i)].reverse().find(x=>rest.includes(x));
  const what=[u.items?`${u.items} ${pl(u.items,'запись','записи','записей')}`:'',u.rules?`${u.rules} ${pl(u.rules,'правило','правила','правил')} поставок`:''].filter(Boolean).join(' и ');
  if(!rest.length) return `${mHead('Удалить этап «'+esc(s.name)+'»?')}<div class="modal-b"><p class="m0">${esc(Pipes.stuck(S,pid,sid))}</p></div>`;
  return `<form data-form="pipe-stage-del" data-pipe="${esc(pid)}" data-stage="${esc(sid)}" novalidate>${mHead('Удалить этап «'+esc(s.name)+'»?')}<div class="modal-b">
    <p class="m0">На этапе: ${what}. Ничего не пропадёт — всё переедет на этап, который вы выберете. Завершающих этапов в списке нет: туда запись попадает только своим действием.</p>
    <div class="field"><label for="pm-to">Куда перенести</label><select id="pm-to" class="inp">${rest.map(x=>pipeOpt(x,x===next)).join('')}</select></div>
    <p class="err" id="pm-err" hidden></p></div>${mFoot('Перенести и удалить')}</form>`;
};
MODALS.pipeDel=pid=>{
  const p=pipeById(pid);
  if(!p) return '';
  const n=pipeAcc(p),cnt=Pipes.items(S,pid).length,rest=Pipes.siblings(S,pid).filter(x=>x.id!==pid);
  return `<form data-form="pipe-del" data-pipe="${esc(pid)}" novalidate>${mHead('Удалить '+n+' «'+esc(p.name)+'»?')}<div class="modal-b">
    ${cnt?`<p class="m0">В ней ${cnt} ${pl(cnt,'запись','записи','записей')}. Ничего не пропадёт — всё переедет на ${n}, которую вы выберете.</p>
    <div class="field"><label for="pd-to">Куда перенести</label><select id="pd-to" class="inp">${rest.map((x,i)=>pipeOpt(x,i===0)).join('')}</select></div>`:`<p class="m0">В ней нет записей, переносить нечего.</p>`}
    <p class="err" id="pd-err" hidden></p></div>${mFoot('Удалить')}</form>`;
};

// ——— действия: те же и в настройках, и на доске ———
const focusPipeStage=(pid,sid)=>setTimeout(()=>{const el=document.querySelector(`[data-on="pipe-stage-name"][data-pipe="${pid}"][data-stage="${sid}"]`);if(el){el.focus();el.select&&el.select()}},40);

A['pipe-group']=el=>{S.ui.pipeGroup=el.dataset.g;S.ui.pipeSel=null;render()};
A['pipe-pick']=el=>{S.ui.pipeSel=el.dataset.id;render()};
A['pipe-lock']=el=>toast(Pipes.lock(S,el.dataset.pipe,el.dataset.stage),'warn');

// Переименование перерисовку не запускает: иначе нажатие на соседнюю кнопку сразу после ввода пропало бы (поле теряет фокус
// и страница перерисовывается раньше, чем придёт щелчок). Подписи в переключателях и заголовке меняются на месте.
// Отказ (пустое имя) возвращает прежнее имя перерисовкой.
ON.change['pipe-name']=t=>{
  const r=Pipes.rename(S,t.dataset.pipe,t.value);
  if(!r.ok){render();return toast(r.reason,'warn')}
  const name=t.value.trim(),sel=`[data-id="${t.dataset.pipe}"]`;
  document.querySelectorAll(`[data-act="task-board"]${sel},[data-act="pipe-pick"]${sel},[data-pipe-title="${t.dataset.pipe}"]`).forEach(el=>{el.textContent=name});
  toast(`Название сохранено: «${name}».`);
};
ON.change['pipe-stage-name']=t=>{
  const r=Pipes.renameStage(S,t.dataset.pipe,t.dataset.stage,t.value);
  if(!r.ok){render();return toast(r.reason,'warn')}
  toast(`Этап переименован: «${t.value.trim()}». В разделе он уже под новым именем.`);
};

A['pipe-stage-add']=el=>{
  const pid=el.dataset.pipe,s=Pipes.addStage(S,pid,'Новый этап',Pipes.beforeEnd(S,pid));
  if(!s) return;
  render();toast('Этап добавлен — впишите название.');focusPipeStage(pid,s.id);
};
A['pipe-stage-del']=el=>{
  const pid=el.dataset.pipe,sid=el.dataset.stage,s=Pipes.stage(S,pid,sid),u=Pipes.usage(S,pid,sid),why=Pipes.lock(S,pid,sid);
  if(!s) return;
  if(why) return toast(why,'warn');
  if(u.items||u.rules) return openModal('pipeStageDel',pid+'|'+sid);
  const r=Pipes.removeStage(S,pid,sid);
  render();toast(r.ok?`Этап «${s.name}» удалён.`:r.reason,r.ok?undefined:'warn');
};
FORMS['pipe-stage-del']=f=>{
  const pid=f.dataset.pipe,sid=f.dataset.stage,s=Pipes.stage(S,pid,sid),to=byId('pm-to').value;
  const r=Pipes.removeStage(S,pid,sid,to);
  if(!r.ok) return showErr('pm-err',r.reason);
  const dest=Pipes.stage(S,pid,to);
  closeModal();render();
  toast(`Этап «${s.name}» удалён.${r.moved?` ${r.moved} ${pl(r.moved,'запись','записи','записей')} переехали на «${dest.name}».`:''}${r.rules?` ${r.rules} ${pl(r.rules,'правило','правила','правил')} поставок теперь ведут на «${dest.name}».`:''}`);
};

A['pipe-add']=el=>{
  const g=PIPE_GROUPS.find(x=>x.id===el.dataset.g)||pipeGroup();
  const p=Pipes.addPipe(S,g.kind,g.add==='доска'?'Новая доска':'Новая воронка',g.scope);
  if(!p) return toast('Не удалось добавить: нет образца этапов.','warn');
  S.ui.pipeGroup=g.id;S.ui.pipeSel=p.id;
  if(g.kind==='tasks') S.ui.taskBoard=p.id;
  render();toast(`Добавлена ${g.add} «${p.name}» с этапами по умолчанию. Назовите её и поправьте этапы.`);
};
A['pipe-del']=el=>{
  const p=pipeById(el.dataset.pipe);
  if(!p) return;
  if(Pipes.siblings(S,p.id).length<2) return toast(`Последнюю ${pipeAcc(p)} удалить нельзя.`,'warn');
  openModal('pipeDel',p.id);
};
FORMS['pipe-del']=f=>{
  const id=f.dataset.pipe,p=pipeById(id),to=byId('pd-to')?.value||'';
  const r=Pipes.removePipe(S,id,to);
  if(!r.ok) return showErr('pd-err',r.reason);
  if(S.ui.taskBoard===id) S.ui.taskBoard=to||null;
  if(S.ui.pipeSel===id) S.ui.pipeSel=to||null;
  if(S.ui.dealPipe===id) S.ui.dealPipe=to||null;
  closeModal();render();
  toast(`Удалена: «${p.name}».${r.moved?` ${r.moved} ${pl(r.moved,'запись','записи','записей')} переехали на «${pipeById(to).name}».`:''}`);
};
