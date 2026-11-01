// Раздел «Лиды»: список и воронка, карточка лида справа, действия «Взять», «Связались», «Квалифицирован»,
// «Создать сделку», «Закрыть» (с причиной) и «Передать» (тот, у кого право leadsAssign: директор, РОП), имитация «пришёл лид».
// Всё решает ядро Leads (35-leads.js): кто что может — Leads.can, смена этапа — Leads.move, видимость — Leads.visible.
// Здесь — только экран. Выбор на экране (вид, поиск, фильтры) лежит в S.ui.leads и не сохраняется;
// вид читает его через leadSel() и ничего не меняет.

Object.assign(IC,{funnel:'<path d="M3.5 5h17l-6.5 7.5V19l-4 1.5v-8z"/>'});

const LEAD_DEF={view:'list',q:'',stage:'',type:'',source:'',manager:'',acts:''};
const leadU=()=>S.ui.leads||(S.ui.leads=Object.assign({},LEAD_DEF));
const leadSel=()=>Object.assign({},LEAD_DEF,S.ui.leads||{});
const leadById=id=>(S.leads||[]).find(l=>l.id===id)||null;
const leadPipe=()=>Pipes.of(S,'leads')[0]||null;
const leadWho=id=>person(id)?.name||'нет данных: сотрудник';
const leadNoData=t=>`<span class="muted">нет данных: ${t}</span>`;

// ——— отбор: одни условия на список, воронку и счётчики ———
// Стадию как условие берёт только список: в воронке этапы — это сами столбцы.
function leadFilter(list,u,withStage){
  const q=u.q.trim().toLowerCase(),now=new Date();
  return list.filter(l=>
    (!withStage||!u.stage||l.stageId===u.stage)
    &&(!u.type||(u.type==='none'?!l.type:l.type===u.type))
    &&(!u.source||l.source===u.source)
    &&(!u.acts||Acts.matches(S,{t:'lead',id:l.id},u.acts,now))
    &&(!u.manager||(u.manager==='none'?!l.managerId&&!isDone(l):l.managerId===u.manager))
    &&(!q||[l.id,l.name,l.company,l.inn,l.phone,l.email,l.text].join(' ').toLowerCase().includes(q))
  ).sort((a,b)=>b.at-a.at);
}
// «Нераспределённые»: открытые лиды без менеджера — единственное определение для фильтра и счётчика
const leadFreeCount=all=>all.filter(l=>!l.managerId&&!isDone(l)).length;

// ——— метки ———
const leadSrcPill=l=>`<span class="pill sm ${l.source==='site'?'info':l.source==='bitrix'?'violet':''}">${esc(Leads.SOURCE[l.source]||l.source)}</span>`;
const leadTypePill=l=>l.type?`<span class="pill sm">${Leads.TYPE[l.type]}</span>`:'<span class="pill sm warn">тип не определён</span>';
const leadTone=l=>l.stageId===Leads.STAGE.lost?'bad':l.stageId===Leads.STAGE.deal?'ok':stagePos(l)>0?'info':'';
const leadStagePill=l=>`<span class="pill sm ${leadTone(l)}">${esc(stageName(l))}</span>`;
const leadMgrCell=l=>l.managerId?esc(leadWho(l.managerId)):'<span class="pill sm warn">Нераспределённый</span>';
const leadDemoPill=l=>l.demo?' <span class="pill sm">пример</span>':'';
// «ждёт N мин»: лид на первом этапе, с которым никто не работал дольше порога. Считает Leads.waiting; now — подмена в тестах
function leadWaitHtml(l,now=new Date(),st=S){
  const m=Leads.waiting(st,l,now);
  return m===null?'':`<span class="pill sm bad lead-wait" title="С лидом никто не работал дольше ${Leads.waitMin(st)} мин">${ic('clock')}ждёт ${esc(Leads.waitText(m))}</span>`;
}

// ——— список ———
function leadTable(list){
  const rows=list.map(l=>`<tr class="click" data-act="open-lead" data-id="${esc(l.id)}" tabindex="0"><td><div class="pname"><span>${esc(Leads.title(l))}${leadDemoPill(l)}</span><small class="mono">${esc(l.id)}<span class="l-show-s"> · ${esc(Leads.SOURCE[l.source]||l.source)}${l.type?' · '+Leads.TYPE[l.type]:''}</span></small></div></td><td class="l-hide-s">${leadSrcPill(l)}</td><td class="l-hide-s">${leadTypePill(l)}</td><td>${leadStagePill(l)}${leadWaitHtml(l)}${actNextHtml({t:'lead',id:l.id})}</td><td>${leadMgrCell(l)}</td><td class="l-hide-s nowrap">${esc(fWhen(l.at))}</td></tr>`).join('');
  return `<section class="card clip"><div class="xs"><table class="tbl"><thead><tr><th>Лид</th><th class="l-hide-s">Источник</th><th class="l-hide-s">Тип</th><th>Этап</th><th>Менеджер</th><th class="l-hide-s">Пришёл</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

// ——— воронка ———
function leadCard(l){
  const mgr=l.managerId?`<span class="who">${av(person(l.managerId),'xs')}${esc(leadWho(l.managerId))}</span>`:'<span class="pill sm warn">Нераспределённый</span>';
  return `<article class="tcard lcard${isDone(l)?' done':''}" draggable="true" data-drag="${esc(l.id)}" data-act="open-lead" data-id="${esc(l.id)}" tabindex="0"><div class="tc-top">${leadSrcPill(l)}${leadTypePill(l)}${l.demo?'<span class="pill sm">пример</span>':''}</div><p class="tc-t">${esc(Leads.title(l))}<small class="mono lc-id">${esc(l.id)}</small></p>${l.text?`<p class="lc-x">${esc(l.text)}</p>`:''}${leadWaitHtml(l)}${actNextHtml({t:'lead',id:l.id})}<div class="tc-m">${mgr}<span class="due">${esc(fRel(l.at))}</span></div></article>`;
}
function leadFunnel(list){
  const pipe=leadPipe();
  if(!pipe) return '<section class="card"><p class="empty">Воронки лидов нет — её заводят в «Настройки → Воронки».</p></section>';
  return `<div class="xs" data-hscroll><div class="lkan" style="--n:${pipe.stages.length}">${pipe.stages.map(s=>{
    const c=list.filter(l=>l.pipeId===pipe.id&&l.stageId===s.id);
    return `<div class="col" data-lcol="${esc(s.id)}"><div class="col-h"><span>${esc(s.name)}</span><span class="cnt-s">${c.length}</span></div>${c.map(leadCard).join('')||'<p class="col-empty">Пусто</p>'}</div>`;
  }).join('')}</div></div>`;
}

// ——— тело раздела: счёт + список или воронка (его же перерисовывает поиск) ———
function leadBody(){
  const u=leadSel(),all=Leads.visible(S,S.me),funnel=u.view==='funnel';
  const list=leadFilter(all,u,!funnel);
  const head=`<p class="count"><span>Лидов: <b>${list.length}</b>${list.length!==all.length?` из ${all.length}`:''}</span><span>без менеджера: <b>${leadFreeCount(all)}</b></span></p>`;
  if(!all.length) return `${head}<section class="card">${emptyState(SERVER?'Лидов пока нет. Заведите лид кнопкой «Новый лид»: подключения сайта и Битрикса24 пока нет.':`Лидов пока нет. Они приходят с сайта и из Битрикса24 — откуда именно, выбирают в «Настройки → Лиды и сделки». Лид можно завести и руками.${can('settings')?' Проверить приход можно кнопками «Имитация» выше или в «Пульте проверки».':''}`,'Новый лид','lead-new')}</section>`;
  if(!list.length) return `${head}<section class="card">${emptyState('По этим условиям лидов нет.','Сбросить поиск и фильтры','lead-reset')}</section>`;
  return head+(funnel?`<p class="hint">Перетащите карточку на другой этап или откройте лид и нажмите кнопку. «Сделка создана» заводит сделку, «Отказ» спрашивает причину. Двигать лид может менеджер, который его ведёт, и тот, кто раздаёт лиды (директор, РОП).</p>${leadFunnel(list)}`:leadTable(list));
}

function vLeads(){
  const u=leadSel(),all=Leads.visible(S,S.me),pipe=leadPipe(),funnel=u.view==='funnel';
  const free=leadFreeCount(all);
  const opt=(v,l,cur)=>`<option value="${esc(v)}"${cur===v?' selected':''}>${esc(l)}</option>`;
  const sel=(k,label,opts)=>`<select class="inp sm w-auto" data-on="lead-f" data-k="${k}" aria-label="${label}">${opts}</select>`;
  const filters=(funnel?'':sel('stage','Этап',opt('','Все этапы',u.stage)+(pipe?pipe.stages.map(s=>opt(s.id,s.name,u.stage)).join(''):'')))
    +sel('type','Тип',opt('','Все типы',u.type)+opt('b2b','B2B',u.type)+opt('b2c','B2C',u.type)+opt('none','Тип не определён',u.type))
    +sel('source','Источник',opt('','Все источники',u.source)+Object.entries(Leads.SOURCE).map(([k,v])=>opt(k,v,u.source)).join(''))
    +sel('manager','Менеджер',opt('','Все менеджеры',u.manager)+opt('none','Нераспределённые',u.manager)+Leads.managers(S).map(m=>opt(m.id,m.name,u.manager)).join(''));
  const dirty=u.q.trim()||u.stage||u.type||u.source||u.manager||u.acts;
  const noActN=leadFilter(all,{...u,acts:'none'},!funnel).length,lateN=leadFilter(all,{...u,acts:'overdue'},!funnel).length;
  // имитации прихода лида — только в демо; в рабочей версии подключений к сайту и Битриксу нет (следующий этап)
  const sims=!SERVER&&can('settings')?`<span class="grow"></span><button type="button" class="btn sm" data-act="lead-sim" data-source="site">${ic('plus')}Имитация: пришёл лид с сайта</button><button type="button" class="btn sm" data-act="lead-sim" data-source="bitrix">${ic('plus')}Имитация: пришёл лид из Битрикса24</button>`:'';
  return `<p class="hint">Лиды — заявки, которые ещё не стали сделками. Новый лид сам уходит менеджеру своего типа: компания или ИНН — B2B, иначе телефон или почта — B2C; кому менеджера не нашлось, тот лежит в «Нераспределённых» — их раздаёт РОП или директор.${SERVER?' Лиды заводят кнопкой «Новый лид»: подключения сайта и Битрикса24 пока нет.':' Заявки здесь пока примерные: настоящего подключения сайта и Битрикса24 нет.'}</p>
  <div class="bar lbar"><div class="seg" role="group" aria-label="Вид">${[['list','Список'],['funnel','Воронка']].map(([k,l])=>`<button type="button" class="${u.view===k?'on':''}" aria-pressed="${u.view===k}" data-act="lead-view" data-v="${k}">${l}</button>`).join('')}</div>
    <div class="search-in">${ic('search')}<input id="lead-q" class="inp" type="search" placeholder="Поиск: имя, компания, ИНН, телефон, почта, текст" value="${esc(u.q)}" data-on="lead-q" autocomplete="off" aria-label="Поиск по лидам"></div><button type="button" class="btn pri" data-act="lead-new">${ic('plus')}Новый лид</button>${sims}</div>
  <div class="bar lfilt">${filters}<button type="button" class="fchip${u.manager==='none'?' on':''}" aria-pressed="${u.manager==='none'}" data-act="lead-free">Нераспределённые · ${free}</button><button type="button" class="fchip${u.acts==='none'?' on':''}" aria-pressed="${u.acts==='none'}" data-act="lead-acts" data-k="none">Без дел · ${noActN}</button><button type="button" class="fchip${u.acts==='overdue'?' on':''}" aria-pressed="${u.acts==='overdue'}" data-act="lead-acts" data-k="overdue">Просрочены дела · ${lateN}</button>${dirty?'<button type="button" class="btn ghost sm" data-act="lead-reset">Сбросить</button>':''}</div>
  <div id="lead-body" class="stack-s">${leadBody()}</div>`;
}

// ——— почему нельзя: один текст на экран, окно и тост ———
function leadWhy(l,need){
  if(isDone(l)) return `Лид ${l.id} закрыт — менять его уже нельзя.`;
  if(need==='transfer') return 'Передавать лиды могут директор и РОП — тот, у кого есть право «Распределять и передавать лиды».';
  if(need==='take') return l.managerId===S.me?`Лид ${l.id} уже у вас.`:l.managerId?`Лид ${l.id} уже ведёт ${leadWho(l.managerId)}.`:`Лид ${l.id} другого типа — взять его может менеджер ${Leads.TYPE[l.type]||'нужного типа'}.`;
  if(need==='deal'&&l.dealId) return `Сделка по лиду ${l.id} уже создана: ${l.dealId}.`;
  if(!l.managerId) return `У лида ${l.id} пока нет менеджера — сначала нажмите «Взять» или попросите РОП или директора передать лид.`;
  if(need==='deal'&&Leads.can(S,l.id,S.me).work) return `Сделку из лида ${l.id} не создать: не определён тип лида — передайте его менеджеру B2B или B2C.`;
  return `Лид ${l.id} ведёт ${leadWho(l.managerId)} — менять его могут он и тот, кто раздаёт лиды (директор, РОП).`;
}

// ——— карточка лида ———
// «Детали» и «Лента» — как у сделки; в «Ленте» дела («Запланировать», открытые дела) и комментарии (feedHtml)
const LEAD_TABS=[['details','Детали'],['feed','Лента']];
function dLead(l){
  const c=Leads.can(S,l.id,S.me),open=!isDone(l);
  const deal=l.dealId?Leads.dealsVisible(S,S.me).find(d=>d.id===l.dealId):null;
  const stg=stagesFor(l).filter(s=>s.id!==Leads.STAGE.lost);
  const steps=l.stageId===Leads.STAGE.lost
    ?`<p class="lock">${ic('lock')}Лид закрыт. Причина: ${esc(l.reason||'нет данных: причина')}</p>`
    :`<ol class="steps" style="--n:${stg.length}">${stg.map((x,i)=>`<li class="${i<stagePos(l)?'done':x.id===l.stageId?'cur':''}"><span>${esc(x.name)}</span></li>`).join('')}</ol>`;
  const b=(act,label,cls)=>`<button type="button" class="btn${cls?' '+cls:''}" data-act="${act}" data-id="${esc(l.id)}">${label}</button>`;
  let acts='';
  if(c.take) acts+=b('lead-take','Взять','pri');
  if(c.work){
    acts+=b('lead-contacted','Связались');
    if(l.stageId!==Leads.STAGE.qualified) acts+=b('lead-qualify','Квалифицирован');
    if(c.deal) acts+=b('lead-deal',ic('plus')+'Создать сделку','pri');
    acts+=b('lead-close',ic('x')+'Закрыть');
  }
  if(deal) acts+=`<button type="button" class="btn" data-act="open-deal" data-id="${esc(deal.id)}">Открыть сделку ${esc(deal.id)}</button>`;
  const lock=open&&!c.take&&!c.work?`<p class="lock">${ic('lock')}${esc(leadWhy(l,'work'))}</p>`:'';
  const tr=c.transfer?`<form class="rform" data-form="lead-transfer" data-id="${esc(l.id)}" novalidate><p class="sh">Передать</p><div class="field"><label for="lead-tr">Кому</label><select id="lead-tr" class="inp"><optgroup label="Менеджеру">${Leads.managers(S).map(m=>`<option value="m:${esc(m.id)}"${m.id===l.managerId?' selected':''}>${esc(m.name)} — ${Leads.TYPE[Perms.roleOf(S,m.id).scope]}, открытых лидов: ${Leads.openCount(S,m.id)}</option>`).join('')}</optgroup><optgroup label="Типу — менеджеру с меньшей загрузкой"><option value="t:b2b">Тип B2B</option><option value="t:b2c">Тип B2C</option></optgroup></select></div><p class="hint">Новый менеджер получит уведомление, в истории лида останется, кто и кому передал.</p><div><button type="submit" class="btn">Передать</button></div></form>`:'';
  const hist=l.history.slice().reverse().map(h=>`<li><span>${esc(h.text)}</span><small>${esc(h.by?leadWho(h.by):'Система')} · ${esc(fWhen(h.at))}</small></li>`).join('');
  const tab=LEAD_TABS.some(t=>t[0]===S.ui.leadTab)?S.ui.leadTab:'details',nOpen=Acts.open(S,{t:'lead',id:l.id}).length;
  const tabs=`<div class="dtabs" role="tablist" aria-label="Разделы карточки">${LEAD_TABS.map(([k,v])=>`<button type="button" role="tab" class="dtab${tab===k?' on':''}" aria-selected="${tab===k}" data-act="lead-tab" data-tab="${k}">${v}${k==='feed'&&nOpen?`<b>${nOpen}</b>`:''}</button>`).join('')}</div>`;
  const wait=Leads.waiting(S,l,new Date()),waitNote=wait===null?'':`<p class="lead-waitnote">${leadWaitHtml(l)}<span>С лидом никто не работал дольше ${Leads.waitMin(S)} мин: нажмите «Взять» или запланируйте звонок во вкладке «Лента».</span></p>`;
  const details=`
    <dl class="kv"><dt>Источник</dt><dd>${leadSrcPill(l)}${leadDemoPill(l)}</dd><dt>Пришёл</dt><dd>${esc(fWhen(l.at))}</dd><dt>Тип</dt><dd>${leadTypePill(l)}</dd><dt>Менеджер</dt><dd>${leadMgrCell(l)}</dd>
      <dt>Контакт</dt><dd>${l.name?esc(l.name):leadNoData('имя')}</dd><dt>Телефон</dt><dd>${l.phone?esc(l.phone):leadNoData('телефон')}</dd><dt>Почта</dt><dd>${l.email?esc(l.email):leadNoData('почта')}</dd>
      ${l.company?`<dt>Компания</dt><dd>${esc(l.company)}</dd>`:''}${l.inn?`<dt>ИНН</dt><dd>${esc(l.inn)}</dd>`:''}${l.reason?`<dt>Причина отказа</dt><dd>${esc(l.reason)}</dd>`:''}${l.dealId?`<dt>Сделка</dt><dd>${esc(l.dealId)}</dd>`:''}</dl>
    <div><h4 class="sh">Текст заявки</h4><p class="prose">${l.text?esc(l.text):leadNoData('текст заявки')}</p></div>
    ${tr}
    <div><h4 class="sh">История</h4><ul class="mv">${hist}</ul></div>`;
  return {kind:'Лид '+l.id,title:esc(Leads.title(l)),sub:`${esc(Leads.SOURCE[l.source]||l.source)} · ${esc(fWhen(l.at))}`,body:`
    ${steps}
    ${acts?`<div class="lead-act">${acts}</div>`:''}${lock}${waitNote}${tabs}<div class="dpane">${tab==='feed'?feedHtml({t:'lead',id:l.id}):details}</div>`};
}

// ——— окно «Закрыть лид» ———
// Причина — из общего списка (Deals.reasons, «Настройки → Лиды и сделки»). Вариант «Другое» открывает поле для своих слов:
// если такой причины в списке нет, окно добавляет её последней строкой. Список пуст — сразу поле для своих слов.
const LEAD_OTHER='__other';
const leadOtherName=list=>list.find(r=>r.trim().toLowerCase()==='другое')||null;
const leadIsOther=v=>v===LEAD_OTHER||v.trim().toLowerCase()==='другое';
MODALS.leadLost=id=>{
  const l=leadById(id),why=Deals.reasons(S);
  const opts=why.map(r=>`<option value="${esc(r)}">${esc(r)}</option>`).join('')+(leadOtherName(why)?'':`<option value="${LEAD_OTHER}">Другое — своими словами</option>`);
  return `<form data-form="lead-lost" data-id="${esc(id)}" novalidate>${mHead('Закрыть лид '+esc(id))}<div class="modal-b">
    <p class="m0">${l?esc(Leads.title(l)):''}</p>
    <div class="field"><label for="ll-reason">Причина отказа</label><select id="ll-reason" class="inp" data-on="lead-reason">${opts}</select></div>
    <div class="field" id="ll-other-f"${leadIsOther(why[0]||LEAD_OTHER)?'':' hidden'}><label for="ll-other">Своими словами</label><textarea id="ll-other" class="inp" rows="3" placeholder="Например: выбрал другого поставщика"></textarea></div>
    <p class="hint">Лид уйдёт на этап «Отказ», причина запишется в его историю. Вернуть закрытый лид нельзя. Список причин правят в «Настройки → Лиды и сделки».</p>
    <p class="err" id="ll-err" hidden></p></div>${mFoot('Закрыть лид')}</form>`;
};
// Причина из окна: выбранная из списка, а у «Другое» — то, что написано своими словами
function leadReasonOf(){
  const v=byId('ll-reason').value.trim();
  return leadIsOther(v)?byId('ll-other').value.trim():v;
}

// ——— окно «Новый лид» ———
// Тип лида и менеджера ставит ядро (Leads.add → classify, route); до сохранения — подсказка «Похоже, это клиент …»
// (clientDupHtml из «Клиентов»), и лид можно привязать к найденному. Выбранный клиент хранится в S.ui.leadClient (не сохраняется).
MODALS.leadNew=()=>{
  const f=(id,label,html,cls)=>`<div class="field${cls?' '+cls:''}"><label for="ln-${id}">${label}</label>${html}</div>`;
  const inp=(id,type,dup,mode)=>`<input id="ln-${id}" class="inp" type="${type}"${mode?` inputmode="${mode}"`:''}${dup?' data-on="lead-dup"':''} autocomplete="off">`;
  return `<form data-form="lead-new" novalidate>${mHead('Новый лид')}<div class="modal-b">
    <div class="grid2">${f('source','Откуда пришёл',`<select id="ln-source" class="inp">${Object.entries(Leads.SOURCE).map(([k,v])=>`<option value="${k}">${esc(v)}</option>`).join('')}</select>`)}
      ${f('name','Имя',inp('name','text'))}${f('phone','Телефон',inp('phone','tel',1))}${f('email','Почта',inp('email','email',1))}
      ${f('company','Компания',inp('company','text'))}${f('inn','ИНН',inp('inn','text',1,'numeric'))}
      ${f('text','Текст заявки','<textarea id="ln-text" class="inp" rows="3" placeholder="Что просит клиент"></textarea>','span2')}</div>
    <div id="ln-dup" aria-live="polite">${leadDupHtml()}</div>
    <p class="hint">Тип лида (B2B или B2C) определится сам: компания или ИНН — B2B, иначе телефон или почта — B2C. Менеджера выберет система. Нужно хотя бы имя, телефон, почта или компания.</p>
    <p class="err" id="ln-err" hidden></p></div>${mFoot('Завести лид')}</form>`;
};
// Подсказка о похожем клиенте по тому, что уже введено; «Выбрать его» из «Клиентов» здесь превращается в «Привязать лид»
function leadDupHtml(){
  const v=id=>(byId(id)||{}).value||'',c=S.ui.leadClient&&Clients.byId(S,S.ui.leadClient);
  if(c) return `<div class="dup" role="status"><p class="dup-t m0">${ic('check')}<span>Лид будет привязан к клиенту <b>${esc(c.name)}</b><small>${esc(c.id)}${c.demo?' · пример':''}</small></span></p><div><button type="button" class="btn sm" data-act="lead-unlink">Не привязывать</button></div></div>`;
  return clientDupHtml({phone:v('ln-phone'),email:v('ln-email'),inn:v('ln-inn')}).replace(/data-act="dup-pick"([^>]*)>Выбрать его</g,'data-act="lead-link"$1>Привязать лид<');
}

// ——— действия: каждое — запись в историю (ядро) и короткое подтверждение ———
// need — что требуется от человека по Leads.can: take, work, deal, transfer
function leadAct(id,need,run,done){
  const l=leadById(id);if(!l) return null;
  if(!Leads.can(S,id,S.me)[need]){toast(leadWhy(l,need),'warn');return null}
  const r=run(new Date());
  if(!r){toast(`Лид ${id}: не получилось.`,'warn');return null}
  render();toast(done(r));return r;
}
// Перевести лид на этап: из воронки (перетаскивание) и из кнопок карточки. Всё — через Leads.move
function leadMoveTo(id,stageId){
  const l=leadById(id),to=l&&Pipes.stage(S,l.pipeId,stageId);
  if(!l||!to||to.id===l.stageId) return null;
  const c=Leads.can(S,id,S.me);
  if(!c.work){toast(leadWhy(l,'work'),'warn');return null}
  if(stageId===Leads.STAGE.lost){openModal('leadLost',id);return null}
  if(stageId===Leads.STAGE.deal&&!c.deal){toast(leadWhy(l,'deal'),'warn');return null}
  const r=Leads.move(S,id,stageId,S.me,new Date());
  if(!r){toast(`Лид ${id} на этап «${to.name}» не переносится.`,'warn');return null}
  render();
  if(stageId===Leads.STAGE.deal){
    const d=S.deals.find(x=>x.id===r.dealId);
    toast(`Сделка ${d.id} создана из лида ${id}: контакт и текст заявки перенесены. Воронка «${pipeById(d.pipeId).name}», менеджер — ${leadWho(d.managerId)}.`);
  }else toast(`Лид ${id} теперь на этапе «${to.name}». Запись в истории есть.`);
  return r;
}

A['open-lead']=el=>{S.ui.leadTab='details';openDrawer('lead',el.dataset.id)};
A['lead-tab']=el=>{S.ui.leadTab=el.dataset.tab;render()};
A['lead-new']=()=>{S.ui.leadClient=null;openModal('leadNew')};
A['lead-link']=el=>{
  const c=Clients.byId(S,el.dataset.id);if(!c) return;
  S.ui.leadClient=c.id;const box=byId('ln-dup');if(box) box.innerHTML=leadDupHtml();
  toast(`Лид будет привязан к существующему клиенту ${c.id}: ${c.name}. Новый клиент не заводится.`);
};
A['lead-unlink']=()=>{S.ui.leadClient=null;const box=byId('ln-dup');if(box) box.innerHTML=leadDupHtml()};
A['lead-view']=el=>{leadU().view=el.dataset.v==='funnel'?'funnel':'list';render()};
A['lead-free']=()=>{const u=leadU();u.manager=u.manager==='none'?'':'none';render()};
A['lead-acts']=el=>{const u=leadU();u.acts=u.acts===el.dataset.k?'':el.dataset.k;render()};
A['lead-reset']=()=>{S.ui.leads=Object.assign({},LEAD_DEF,{view:leadSel().view});render()};
A['lead-take']=el=>leadAct(el.dataset.id,'take',now=>Leads.take(S,el.dataset.id,S.me,now),l=>`Лид ${l.id} теперь у вас: ${Leads.title(l)}.`);
A['lead-contacted']=el=>leadAct(el.dataset.id,'work',now=>Leads.contacted(S,el.dataset.id,S.me,now),l=>`Записали: связались по лиду ${l.id}. Этап — «${stageName(l)}».`);
A['lead-qualify']=el=>leadMoveTo(el.dataset.id,Leads.STAGE.qualified);
A['lead-deal']=el=>leadMoveTo(el.dataset.id,Leads.STAGE.deal);
A['lead-close']=el=>leadMoveTo(el.dataset.id,Leads.STAGE.lost);
A['lead-sim']=el=>leadSimulate(el.dataset.source);

ON.input['lead-q']=t=>{
  leadU().q=t.value;
  const box=byId('lead-body');if(box) box.innerHTML=leadBody();
};
ON.input['lead-dup']=()=>{const box=byId('ln-dup');if(box) box.innerHTML=leadDupHtml()};
ON.change['lead-reason']=t=>{const f=byId('ll-other-f');if(f){f.hidden=!leadIsOther(t.value);if(!f.hidden) byId('ll-other').focus()}};
ON.change['lead-f']=t=>{
  const k=t.dataset.k;if(!Object.hasOwn(LEAD_DEF,k)||k==='view'||k==='q') return;
  leadU()[k]=t.value;render();
};

FORMS['lead-lost']=f=>{
  const id=f.dataset.id,reason=leadReasonOf(),l=leadById(id);
  if(!l) return closeModal();
  if(!reason) return showErr('ll-err','Напишите причину отказа.');
  if(!Leads.can(S,id,S.me).work) return showErr('ll-err',leadWhy(l,'work'));
  if(!Leads.move(S,id,Leads.STAGE.lost,S.me,new Date(),reason)) return showErr('ll-err','Лид не закрылся.');
  closeModal();render();
  toast(`Лид ${id} закрыт. Причина записана в историю: ${reason}.`);
};
FORMS['lead-new']=()=>{
  const v=id=>byId(id).value.trim();
  const r=Leads.add(S,{source:v('ln-source'),name:v('ln-name'),phone:v('ln-phone'),email:v('ln-email'),company:v('ln-company'),inn:v('ln-inn'),text:v('ln-text'),clientId:S.ui.leadClient||undefined},S.me,new Date());
  if(!r.ok) return showErr('ln-err',r.reason);
  const l=r.lead,mine=Leads.visible(S,S.me).some(x=>x.id===l.id);
  S.ui.leadClient=null;closeModal();render();
  if(mine){S.ui.leadTab='details';openDrawer('lead',l.id)}
  toast(`Лид ${l.id} заведён (${Leads.SOURCE[l.source]}).${l.clientId?` Привязан к клиенту ${l.clientId}.`:''}${mine?'':' Он у другого менеджера, поэтому вам не виден.'} ${l.managerId?`Тип: ${Leads.TYPE[l.type]}. Менеджер: ${leadWho(l.managerId)}`:'Менеджера нет — лид нераспределённый.'}`);
};
FORMS['lead-transfer']=f=>{
  const id=f.dataset.id,[kind,val]=byId('lead-tr').value.split(':');
  const target=kind==='m'?{managerId:val}:{type:val};
  leadAct(id,'transfer',now=>Leads.transfer(S,id,target,S.me,now),l=>`Лид ${l.id} передан. ${l.history[l.history.length-1].text}.`);
};

// драг и дроп: столбцы воронки лидов — data-lcol (задачи в оболочке — data-col, они не пересекаются)
document.addEventListener('dragover',e=>{
  const col=e.target.closest?.('[data-lcol]');if(!col) return;
  e.preventDefault();
  document.querySelectorAll('.col.drop').forEach(x=>{if(x!==col) x.classList.remove('drop')});col.classList.add('drop');
});
document.addEventListener('drop',e=>{
  const col=e.target.closest?.('[data-lcol]');if(!col) return;
  e.preventDefault();col.classList.remove('drop');
  const id=e.dataTransfer.getData('text/plain');
  if(id&&leadById(id)) leadMoveTo(id,col.dataset.lcol);
});

// ——— имитация: пришёл лид ———
// Заявки по кругу: компания, телефон, только ИНН, только почта — чтобы видно было и B2B, и B2C.
// Всё явно ненастоящее: имена «пример», телефоны +7 900 000-01-NN, почта на example.com.
const LEAD_SIM=[
  {company:'ООО „Пример-Имитация“',phone:'+7 900 000-01-',text:'Пример заявки (имитация): нужна станция для объекта компании, просим прислать КП.'},
  {phone:'+7 900 000-01-',text:'Пример заявки (имитация): интересует станция для дома, просьба перезвонить.'},
  {inn:'0000001',text:'Пример заявки (имитация): нужен расчёт резервного питания для склада.'},
  {email:'sim-primer@example.com',text:'Пример заявки (имитация): написал на почту, хочет узнать про ветро-солнечную станцию для дачи.'},
];
function leadSimulate(source){
  if(!Object.hasOwn(Leads.SOURCE,source)) return null;
  if(!Leads.allows(S,source)){
    toast(`Источник «${Leads.SOURCE[source]}» сейчас не используется: в «Настройки → Лиды и сделки» выбрано «${Leads.SOURCES[S.leadSource]||Leads.SOURCES.both}». Лид не создан.`,'warn');
    return null;
  }
  const n=(S.leads||[]).filter(l=>l.sim).length+1,k=LEAD_SIM[(n-1)%LEAD_SIM.length],nn=String(n%100).padStart(2,'0');
  const data={source,demo:true,name:`Клиент-пример (имитация ${n})`,text:k.text};
  if(k.company){data.company=k.company;data.name=`Контакт-пример (имитация ${n})`}
  if(k.phone) data.phone=k.phone+nn;
  if(k.inn) data.inn=k.inn+String(n%1000).padStart(3,'0');
  if(k.email) data.email=k.email;
  const lead=Leads.create(S,data,new Date());
  lead.sim=true;
  const note=S.notes[0],got=note&&note.kind==='lead'?note.to.length:0;
  render();
  toast(`Пришёл лид ${lead.id} (${Leads.SOURCE[source]}, «пример»). ${lead.managerId?`Тип ${Leads.TYPE[lead.type]}, менеджер — ${leadWho(lead.managerId)}.`:'Менеджера нет — лид нераспределённый.'} Уведомление получили: ${got}.`);
  return lead;
}
// Результат имитации для «Пульта проверки»: {text — что произошло, view — где смотреть, id — карточка}
const leadSimResult=(source)=>{
  const l=leadSimulate(source);
  if(!l) return {text:`Лид не создан: источник «${Leads.SOURCE[source]}» сейчас не используется. Источник выбирают в «Настройки → Лиды и сделки».`,view:'settings'};
  return {text:`Пришёл лид ${l.id} (${Leads.SOURCE[source]}, «пример»). ${l.managerId?`Тип ${Leads.TYPE[l.type]}, менеджер: ${leadWho(l.managerId)}`:'Менеджера нет — лид нераспределённый'}`,view:'leads',id:l.id};
};
SIMS.push({id:'lead-site',label:'Имитация: пришёл лид с сайта',run:()=>leadSimResult('site')});
SIMS.push({id:'lead-bitrix',label:'Имитация: пришёл лид из Битрикса24',run:()=>leadSimResult('bitrix')});

// ——— регистрация в реестрах оболочки ———
NAV.push({id:'leads',label:'Лиды',icon:'funnel',group:'Продажи',order:5,hint:'Заявки, которые ещё не стали сделками. Возьмите лид, свяжитесь с человеком и сделайте из него сделку.',ok:()=>can('leads'),badge:()=>Leads.fresh(S,S.me).length,hot:true});
VIEWS.leads=vLeads;
SEARCH.push({kind:'lead',label:'Лид',order:30,find:q=>!can('leads')?[]:Leads.visible(S,S.me).filter(l=>searchHas(q,l.id,l.name,l.company,l.phone,l.email,l.inn,l.text)).map(l=>({title:Leads.title(l),sub:`${l.id} · ${stageName(l)}`,open:`data-act="open-lead" data-id="${esc(l.id)}"`}))});
DRAWERS.lead=id=>{const l=Leads.visible(S,S.me).find(x=>x.id===id);return l?dLead(l):null};
regRef('lead','лид',id=>S.leads.some(l=>l.id===id),'open-lead');
