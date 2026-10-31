// Раздел «Отправки»: таблица и воронка заявок, форма «Новая отправка», карточка заявки справа.
// Всё решает ядро Dispatch (39-dispatch.js): кто что может — canWork, canEdit, canCancel, смена этапа — setStage,
// «собрано» — pick, отбор — query, склад-получатель — warehouseAddress. Свободный остаток — Stock.summary (stockOf).
// Здесь — только экран: виды — чистые функции состояния, состояние меняют обработчики внизу файла.
// Выбор на экране (вид, поиск, фильтры) лежит в S.ui.dispatch, черновик формы — в S.ui.dspDraft; оба не сохраняются.
// Снаружи (кнопка «Создать отправку» в сделке): openDispatchNew(данные как у Dispatch.create) и openDrawer('dispatch', id).

Object.assign(IC,{
  copy:'<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>',
  file:'<path d="M7 3.5h6.5L18 8v12.5H7z"/><path d="M13.5 3.5V8H18"/>'
});

const DSP_DEF={view:'list',q:'',mine:false,today:false,stage:'',driver:''};
const dspU=()=>S.ui.dispatch||(S.ui.dispatch=Object.assign({},DSP_DEF));
const dspSel=()=>Object.assign({},DSP_DEF,S.ui.dispatch||{});
const dspWho=id=>person(id)?.name||'нет данных: сотрудник';
const dspNoData=t=>`<span class="muted">нет данных: ${t}</span>`;
const dspPipe=()=>Pipes.of(S,Dispatch.PIPE)[0]||null;
const dspStages=d=>(Pipes.of(S,Dispatch.PIPE).find(p=>p.id===d.pipeId)||{stages:[]}).stages;
const dspStageName=d=>(Pipes.stage(S,d.pipeId,d.stageId)||{}).name||'нет данных: этап';
const dspIsOpen=(st,d)=>!Pipes.isFinal(st,d.pipeId,d.stageId);
const dspTone=d=>d.stageId===Dispatch.ST.cancelled?'bad':d.stageId===Dispatch.ST.delivered?'ok':d.stageId===Dispatch.ST.onWay?'info':d.stageId===Dispatch.ST.new?'':'sun';
const dspStagePill=d=>`<span class="pill sm ${dspTone(d)}">${esc(dspStageName(d))}</span>`;
// «сегодня, 10:00–14:00»: дата и окно, если оно задано
const dspWhen=d=>{const w=d.when||{};return fRel(w.date)+(w.from?', '+w.from+(w.till?'–'+w.till:''):'')};
const dspTel=p=>String(p||'').replace(/[^\d+]/g,'');
const dspSize=n=>n<1024?n+' Б':n<1048576?Math.round(n/1024)+' КБ':(n/1048576).toFixed(1).replace('.',',')+' МБ';
const dspCell=c=>`${Stock.entityName(S,c.entityId)??c.entityId}, ${Stock.cityName(S,c.cityId)??c.cityId}`;
const dspPicked=d=>{const p=Dispatch.picked(d);return `собрано ${p.done} из ${p.total}`};
// Подсказка «свободно N» у товара из каталога: число берёт Stock.summary (stockOf), своего расчёта нет
function dspFreeText(productId){
  const p=product(productId),k=stockOf(productId);
  return k.known?`свободно ${qtyOf(k.free,p)}`:'остаток: нет данных';
}
// Число на пункте меню: открытые заявки, назначенные мне, и — у тех, кто ведёт отправки — открытые на сегодня
function dspBadge(st=S,personId=S.me,now=new Date()){
  const ids=new Set(Dispatch.query(st,{driver:personId}).filter(d=>dspIsOpen(st,d)).map(d=>d.id));
  if(Dispatch.canWork(st,personId)) Dispatch.query(st,{today:true,now}).filter(d=>dspIsOpen(st,d)).forEach(d=>ids.add(d.id));
  return ids.size;
}

// ——— файлы ———
const dspIsImage=f=>/^image\//.test(f.type||'')&&typeof f.data==='string'&&f.data.startsWith('data:image/');
// Файл заявки в карточке: картинка — миниатюра, открывается крупно; остальное — название, размер, «скачать».
// Не поместился в браузер (unsaved) — пометка вместо файла.
function dspFileHtml(d,f){
  const size=dspSize(f.size||0);
  if(f.unsaved||!f.data) return `<div class="dsp-fl bad">${ic('file')}<span>${esc(f.name)}<small>${size}</small><small class="warn-t">${f.unsaved?'не сохранено — мало места в браузере':'нет данных: файл'}</small></span></div>`;
  if(dspIsImage(f)) return `<button type="button" class="dsp-th" data-act="dsp-file" data-key="${esc(d.id+'|'+f.id)}" aria-label="Открыть: ${esc(f.name)}"><img src="${esc(f.data)}" alt="${esc(f.name)}"><small>${esc(f.name)}</small></button>`;
  return `<a class="dsp-fl" href="${esc(f.data)}" download="${esc(f.name)}">${ic('file')}<span>${esc(f.name)}<small>${size} · скачать</small></span></a>`;
}

// ——— отбор: одни условия на список, воронку и блок «Назначены мне» ———
function dspList(u,funnel){
  return Dispatch.query(S,{q:u.q,stage:funnel?'':u.stage,mine:u.mine,personId:S.me,today:u.today,now:new Date(),driver:u.driver});
}

// ——— список ———
function dspTable(list){
  const rows=list.map(d=>`<tr class="click" data-act="open-dispatch" data-id="${esc(d.id)}" tabindex="0"><td><div class="pname"><span>${esc(d.to.name)}${d.demo?' <span class="pill sm">пример</span>':''}</span><small class="mono">${esc(d.number)} · ${esc(Dispatch.PURPOSE[d.purpose])}</small><small class="dsp-show-s">${esc(d.address)}</small></div></td><td class="dsp-hide-s">${esc(d.address)}</td><td class="nowrap">${esc(dspWhen(d))}</td><td>${dspStagePill(d)}</td><td class="dsp-hide-s nowrap">${esc(dspPicked(d))}</td><td class="dsp-hide-s">${d.driverId?esc(dspWho(d.driverId)):'<span class="muted">не назначен</span>'}</td></tr>`).join('');
  return `<section class="card clip"><div class="xs"><table class="tbl"><thead><tr><th>Заявка</th><th class="dsp-hide-s">Куда</th><th>Когда</th><th>Этап</th><th class="dsp-hide-s">Список</th><th class="dsp-hide-s">Водитель</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

// ——— воронка ———
function dspCard(d){
  const drv=d.driverId?`<span class="who">${av(person(d.driverId),'xs')}${esc(dspWho(d.driverId))}</span>`:'<span class="muted">водитель не назначен</span>';
  return `<article class="tcard dspcard${dspIsOpen(S,d)?'':' done'}" draggable="true" data-drag="${esc(d.id)}" data-act="open-dispatch" data-id="${esc(d.id)}" tabindex="0"><div class="tc-top"><span class="pill sm">${esc(Dispatch.PURPOSE[d.purpose])}</span>${d.demo?'<span class="pill sm">пример</span>':''}</div><p class="tc-t">${esc(d.to.name)}<small class="mono">${esc(d.number)}</small></p><p class="dsp-ad">${esc(d.address)}</p><div class="tc-m"><span class="due">${esc(dspWhen(d))}</span><span class="due">${esc(dspPicked(d))}</span></div><div class="tc-m">${drv}</div></article>`;
}
function dspFunnel(list){
  const pipe=dspPipe();
  if(!pipe) return '<section class="card"><p class="empty">Воронки отправок нет — её заводят в «Настройки → Воронки».</p></section>';
  return `<div class="xs" data-hscroll><div class="dspkan" style="--n:${pipe.stages.length}">${pipe.stages.map(s=>{
    const c=list.filter(d=>d.pipeId===pipe.id&&d.stageId===s.id);
    return `<div class="col" data-dspcol="${esc(s.id)}"><div class="col-h"><span>${esc(s.name)}</span><span class="cnt-s">${c.length}</span></div>${c.map(dspCard).join('')||'<p class="col-empty">Пусто</p>'}</div>`;
  }).join('')}</div></div>`;
}

// ——— блок «Назначены мне» (у водителя всегда, у остальных — когда им что-то назначено) ———
function dspMineHtml(){
  const open=Dispatch.query(S,{driver:S.me}).filter(d=>dspIsOpen(S,d));
  if(me().role!=='driver'&&!open.length) return '';
  const item=d=>`<div class="dsp-mi" role="button" tabindex="0" data-act="open-dispatch" data-id="${esc(d.id)}"><b>${esc(d.to.name)}</b><span class="mono">${esc(d.number)}</span><span>${esc(d.address)}</span><span class="due">${esc(dspWhen(d))}</span>${dspStagePill(d)}</div>`;
  return `<section class="card dsp-mine"><div class="card-h"><h3>Назначены мне</h3><span class="cnt-s">${open.length}</span></div><div class="card-b dsp-mine-l">${open.length?open.map(item).join(''):'<p class="muted m0">Пока вам ничего не назначено.</p>'}</div></section>`;
}

// ——— тело раздела: счёт + список или воронка (его же перерисовывает поиск) ———
function dspBody(){
  const u=dspSel(),all=S.dispatches||[],funnel=u.view==='funnel',list=dspList(u,funnel);
  const head=`<p class="count"><span>Заявок: <b>${list.length}</b>${list.length!==all.length?` из ${all.length}`:''}</span></p>`;
  if(!all.length) return `${head}<section class="card"><p class="empty">Заявок на отправку пока нет. Любой сотрудник заводит её кнопкой «Новая отправка».</p></section>`;
  if(!list.length) return `${head}<section class="card"><p class="empty">По этим условиям заявок нет. <button type="button" class="link" data-act="dsp-reset">Сбросить поиск и фильтры</button></p></section>`;
  return head+(funnel?`<p class="hint">Перетащите карточку на другой этап или откройте заявку и нажмите кнопку. Двигать этапы могут логист, кладовщик и водитель; автор может отменить свою заявку до «В пути».</p>${dspFunnel(list)}`:dspTable(list));
}

function vDispatch(){
  const u=dspSel(),funnel=u.view==='funnel',pipe=dspPipe();
  const opt=(v,l,cur)=>`<option value="${esc(v)}"${cur===v?' selected':''}>${esc(l)}</option>`;
  const sel=(k,label,opts)=>`<select class="inp sm w-auto" data-on="dsp-f" data-k="${k}" aria-label="${label}">${opts}</select>`;
  // водители в фильтре: сотрудники с ролью «Водитель» и все, кому заявки уже назначены
  const drv=[...Dispatch.drivers(S),...(S.dispatches||[]).map(d=>person(d.driverId)).filter(Boolean)].filter((p,i,a)=>a.findIndex(x=>x.id===p.id)===i);
  const filters=(funnel?'':sel('stage','Этап',opt('','Все этапы',u.stage)+(pipe?pipe.stages.map(s=>opt(s.id,s.name,u.stage)).join(''):'')))
    +sel('driver','Водитель',opt('','Все водители',u.driver)+drv.map(p=>opt(p.id,p.name,u.driver)).join(''));
  const dirty=u.q.trim()||u.mine||u.today||u.stage||u.driver;
  const nowD=new Date(),count=f=>Dispatch.query(S,{...f,personId:S.me,now:nowD}).length;
  return `${dspMineHtml()}
  <p class="hint">Заявка на отправку: кому, куда, телефон, когда и что везти. Завести её может любой сотрудник, исполняют логист, кладовщик и водитель.</p>
  <div class="bar dspbar"><div class="seg" role="group" aria-label="Вид">${[['list','Список'],['funnel','Воронка']].map(([k,l])=>`<button type="button" class="${u.view===k?'on':''}" aria-pressed="${u.view===k}" data-act="dsp-view" data-v="${k}">${l}</button>`).join('')}</div>
    <div class="search-in">${ic('search')}<input id="dsp-q" class="inp" type="search" placeholder="Поиск: номер, получатель, адрес" value="${esc(u.q)}" data-on="dsp-q" autocomplete="off" aria-label="Поиск по заявкам"></div><button type="button" class="btn pri" data-act="dsp-new">${ic('plus')}Новая отправка</button></div>
  <div class="bar dspfilt"><button type="button" class="fchip${u.mine?' on':''}" aria-pressed="${u.mine}" data-act="dsp-mine">Мои · ${count({mine:true})}</button><button type="button" class="fchip${u.today?' on':''}" aria-pressed="${u.today}" data-act="dsp-today">На сегодня · ${count({today:true})}</button>${filters}${dirty?'<button type="button" class="btn ghost sm" data-act="dsp-reset">Сбросить</button>':''}</div>
  <div id="dsp-body" class="stack-s">${dspBody()}</div>`;
}

// ——— карточка заявки ———
function dDispatch(d){
  const work=Dispatch.canWork(S,S.me),stages=dspStages(d),pos=stages.findIndex(s=>s.id===d.stageId);
  const flow=stages.filter(s=>s.id!==Dispatch.ST.cancelled),fpos=flow.findIndex(s=>s.id===d.stageId);
  const cancelled=d.stageId===Dispatch.ST.cancelled;
  const steps=cancelled?`<p class="lock">${ic('lock')}Заявка отменена.</p>`
    :`<ol class="steps" style="--n:${flow.length}">${flow.map((s,i)=>`<li class="${i<fpos?'done':s.id===d.stageId?'cur':''}"><span>${esc(s.name)}</span></li>`).join('')}</ol>`;
  // кнопки этапов — крупные, во всю ширину; ближайший этап — главная
  const nextId=(stages.slice(pos+1).find(s=>s.id!==Dispatch.ST.cancelled)||{}).id;
  const stageBtn=s=>{const back=stages.findIndex(x=>x.id===s.id)<pos;return `<button type="button" class="btn big dsp-stg${s.id===nextId?' pri':''}" data-act="dsp-stage" data-id="${esc(d.id)}" data-stage="${esc(s.id)}">${s.id===nextId?ic('arrow'):''}${back?'Вернуть на':'Перевести на'} «${esc(s.name)}»</button>`};
  const canCancel=Dispatch.canCancel(S,S.me,d);
  const moves=(work?stages.filter(s=>s.id!==d.stageId&&s.id!==Dispatch.ST.cancelled).map(stageBtn).join(''):'')
    +(canCancel?`<button type="button" class="btn big dsp-stg dsp-cancel" data-act="dsp-cancel-ask" data-id="${esc(d.id)}">${ic('x')}Отменить заявку</button>`:'');
  const lock=!work&&!canCancel?`<p class="lock">${ic('lock')}Двигать этапы могут те, кто ведёт отправки: логист, кладовщик и водитель. Автор заявки может отменить её до «В пути».</p>`:'';
  // водитель: назначает тот, кто ведёт отправки
  const people=S.people.filter(p=>Dispatch.canWork(S,p.id)),isDrv=p=>p.role==='driver';
  const popt=p=>`<option value="${esc(p.id)}"${p.id===d.driverId?' selected':''}>${esc(p.name)}</option>`;
  const assign=work?`<form class="dsp-assign" data-form="dsp-assign" data-id="${esc(d.id)}" novalidate><label class="sr" for="dsp-drv">Водитель</label><select id="dsp-drv" class="inp"><option value="">Не назначен</option><optgroup label="Водители">${people.filter(isDrv).map(popt).join('')}</optgroup><optgroup label="Другие, кто ведёт отправки">${people.filter(p=>!isDrv(p)).map(popt).join('')}</optgroup></select><button type="submit" class="btn">Назначить</button></form>`:'';
  const tel=dspTel(d.to.phone);
  const hasAddr=d.address&&d.address!==Dispatch.NO_ADDRESS;
  const quick=`<div class="dsp-quick">${tel?`<a class="btn big pri dsp-call" href="tel:${esc(tel)}">${ic('phone')}Позвонить · ${esc(d.to.phone)}</a>`:''}${hasAddr?`<button type="button" class="btn big" data-act="dsp-copy" data-id="${esc(d.id)}">${ic('copy')}Скопировать адрес</button>`:''}</div>`;
  const route=d.purpose==='transfer'&&d.from&&d.toCell?`<div class="dsp-route"><p class="m0"><b>${esc(dspCell(d.from))}</b> ${ic('arrow')} <b>${esc(dspCell(d.toCell))}</b></p><p class="hint">${Dispatch.inTransit(d)?`Товар ушёл со склада «${esc(dspCell(d.from))}» и числится в пути на склад «${esc(dspCell(d.toCell))}».`:d.landed?`Товар пришёл на склад «${esc(dspCell(d.toCell))}».`:`Товар пока лежит на складе «${esc(dspCell(d.from))}»: со склада он уйдёт на этапе «В пути».`}</p></div>`:'';
  const p=Dispatch.picked(d),canPick=work&&dspIsOpen(S,d);
  // «Списать при продаже»: право sell, цель «Продажа», товар из каталога, ещё не списан; списанной строке — «списано: кто, когда, откуда»
  const canSell=Dispatch.canSell(S,S.me)&&d.purpose==='sale';
  const lines=d.items.map((it,i)=>{
    const pr=it.productId?product(it.productId):null,sold=Dispatch.soldText(S,it);
    const sellBtn=canSell&&it.productId&&!it.sold?`<button type="button" class="btn sm dsp-sell" data-act="dsp-sell" data-id="${esc(d.id)}" data-i="${i}">Списать при продаже</button>`:'';
    return `<li><label class="dsp-line"><input type="checkbox"${it.picked?' checked':''}${canPick?'':' disabled'} data-on="dsp-pick" data-id="${esc(d.id)}" data-i="${i}"><span><b>${esc(Dispatch.lineName(S,it))}</b> — ${esc(qtyOf(it.qty,pr))}${it.productId?'':' <small class="muted">своя строка</small>'}${sold?`<small class="dsp-sold">${esc(sold)}</small>`:''}</span></label>${sellBtn}</li>`;
  }).join('');
  const files=d.files.length?`<div class="dsp-files">${d.files.map(f=>dspFileHtml(d,f)).join('')}</div>`:'<p class="muted m0">Файлов нет.</p>';
  const deal=d.dealId?(S.deals||[]).find(x=>x.id===d.dealId):null;
  const edit=Dispatch.canEdit(S,S.me,d)?`<div><button type="button" class="btn" data-act="dsp-edit" data-id="${esc(d.id)}">Изменить заявку</button></div>`:'';
  return {kind:'Отправка '+d.number,title:esc(d.to.name),sub:`${esc(Dispatch.PURPOSE[d.purpose])} · ${esc(dspWhen(d))}${d.demo?' · пример':''}`,body:`
    ${steps}<div class="dsp-stages">${moves}</div>${lock}
    <dl class="kv"><dt>Этап</dt><dd>${dspStagePill(d)}</dd><dt>Получатель</dt><dd>${esc(d.to.name)}</dd><dt>Телефон</dt><dd>${esc(d.to.phone)}</dd><dt>Адрес</dt><dd>${hasAddr?esc(d.address):dspNoData('адрес')}</dd><dt>Когда</dt><dd>${esc(dspWhen(d))}</dd>${deal?`<dt>Сделка</dt><dd><button type="button" class="link" data-act="open-deal" data-id="${esc(deal.id)}">${esc(deal.id)} · ${esc(deal.client)}</button></dd>`:d.dealId?`<dt>Сделка</dt><dd>${esc(d.dealId)}</dd>`:''}<dt>Создал</dt><dd>${esc(dspWho(d.by))}, ${esc(fWhen(d.at))}</dd></dl>
    ${quick}${route}
    <div><h4 class="sh">Водитель</h4>${d.driverId?`<p class="m0"><span class="who">${av(person(d.driverId),'xs')}${esc(dspWho(d.driverId))}</span></p>`:'<p class="muted m0">Не назначен.</p>'}${assign}</div>
    <div><h4 class="sh">Список · ${esc(dspPicked(d))}</h4><ul class="dsp-lines">${lines}</ul>${canPick?'':work?'':'<p class="hint">Отмечают «собрано» кладовщик, логист и водитель.</p>'}</div>
    <div><h4 class="sh">Файлы</h4>${files}</div>
    <div><h4 class="sh">Примечание</h4>${d.note?`<p class="prose">${esc(d.note)}</p>`:'<p class="muted m0">Примечания нет.</p>'}</div>
    ${edit}
    <div><h4 class="sh">Лента</h4>${feedHtml({t:'dispatch',id:d.id})}</div>`};
}

// ——— форма «Новая отправка» / правка заявки ———
// Черновик лежит в S.ui.dspDraft: поля пишут в него по мере ввода (data-on="dsp-f"), при отправке значения ещё раз берутся из полей.
const dspDraft=()=>S.ui.dspDraft||null;
function dspDraftFrom(pre,editId){
  const p=pre||{},w=p.when||{},cell=(c,e,k)=>({e:(c&&c.entityId)||e,k:(c&&c.cityId)||k});
  const f=cell(p.from,(S.entities[0]||{}).id||'',(S.cities[0]||{}).id||''),t=cell(p.toCell,(S.entities[0]||{}).id||'',(S.cities[1]||S.cities[0]||{}).id||'');
  return {editId:editId||'',purpose:p.purpose||'sale',name:(p.to&&p.to.name)||'',phone:(p.to&&p.to.phone)||'',
    address:p.address&&p.address!==Dispatch.NO_ADDRESS&&p.purpose!=='transfer'?p.address:'',
    date:w.date?iso(w.date):'',from:w.from||'',till:w.till||'',note:p.note||'',dealId:p.dealId||'',
    fromE:f.e,fromC:f.k,toE:t.e,toC:t.k,
    items:(p.items||[]).map(i=>i.productId?{productId:i.productId,qty:i.qty}:{text:i.text,qty:i.qty}),
    files:(p.files||[]).map(x=>({...x}))};
}
// Открыть форму новой заявки. pre — те же поля, что у Dispatch.create: purpose, to, address, when, items, files, note, dealId.
function openDispatchNew(pre){S.ui.dspDraft=dspDraftFrom(pre,'');openModal('dispatchForm')}
function openDispatchEdit(id){
  const d=Dispatch.byId(S,id);if(!d) return;
  if(!Dispatch.canEdit(S,S.me,d)){toast('Править заявку нельзя: она уже в работе, а у вас нет права вести отправки.','warn');return}
  S.ui.dspDraft=dspDraftFrom(d,id);openModal('dispatchForm');
}

const dspOpts=(list,cur,extra)=>list.map(x=>`<option value="${esc(x.id)}"${x.id===cur?' selected':''}>${esc(x.name)}</option>`).join('')+(extra||'');
// Склад «откуда»: юрлицо и город могут быть «не указано» — так лежит часть остатков; «куда» — только настоящие
function dspCellSel(key,label,e,c,anyOk){
  const any=(id,cur,name)=>anyOk?`<option value="${Stock.ANY}"${cur===Stock.ANY?' selected':''}>${esc(name)}</option>`:'';
  return `<div class="field"><span class="lbl">${label}</span><div class="grid2"><select id="dsp-${key}-e" class="inp" data-on="dsp-f" data-k="${key}E" aria-label="${label}: юрлицо">${dspOpts(S.entities,e,any('',e,Stock.entityName(S,Stock.ANY)))}</select><select id="dsp-${key}-c" class="inp" data-on="dsp-f" data-k="${key}C" aria-label="${label}: город">${dspOpts(S.cities,c,any('',c,Stock.cityName(S,Stock.ANY)))}</select></div></div>`;
}
// Подсказка про адрес перемещения: адрес склада-получателя из справочника городов или честное «нет данных»
function dspAddrHint(x){
  const a=Dispatch.warehouseAddress(S,{entityId:x.toE,cityId:x.toC});
  return a===Dispatch.NO_ADDRESS?'Адрес склада-получателя в справочнике городов не заполнен: в заявке будет «'+a+'».':'Адрес склада-получателя подставится сам: '+a+'.';
}
// Блок формы под цель: у перемещения — склады и адрес склада-получателя, у остальных — поле «Адрес»
function dspTransferHtml(x){
  if(x.purpose!=='transfer') return `<div class="field"><label for="dsp-address">Адрес</label><input id="dsp-address" class="inp" value="${esc(x.address)}" data-on="dsp-f" data-k="address" autocomplete="off" placeholder="Город, улица, дом"></div>`;
  return `${dspCellSel('from','Склад «откуда»',x.fromE,x.fromC,true)}${dspCellSel('to','Склад «куда»',x.toE,x.toC,false)}<p class="hint" id="dsp-ad-hint">${esc(dspAddrHint(x))}</p>`;
}
function dspItemsHtml(x){
  if(!x.items.length) return '<p class="muted m0">Список пуст: найдите товар в каталоге или добавьте свою строку.</p>';
  return `<ul class="dsp-its">${x.items.map((it,i)=>{
    const name=it.productId?(product(it.productId)||{}).name||'нет данных: товар':it.text;
    return `<li class="dsp-it"><div class="dsp-it-n"><b>${esc(name)}</b><small>${it.productId?esc(dspFreeText(it.productId)):'своя строка — склад не трогает'}</small></div><input class="inp dsp-q" type="number" min="1" step="1" inputmode="numeric" value="${esc(it.qty)}" data-on="dsp-qty" data-i="${i}" aria-label="Количество: ${esc(name)}"><button type="button" class="btn ghost icon" data-act="dsp-line-del" data-i="${i}" aria-label="Убрать строку: ${esc(name)}">${ic('x')}</button></li>`;
  }).join('')}</ul>`;
}
// Результаты поиска по каталогу: название и «свободно N» из Stock.summary
function dspPresHtml(q){
  if(Catalog.norm(q).length<2) return '';
  const hits=Catalog.query(S,{q}).slice(0,6);
  if(!hits.length) return '<p class="hint">В каталоге такого нет — добавьте свою строку.</p>';
  return `<ul class="dsp-pres">${hits.map(p=>`<li><button type="button" class="dpr" data-act="dsp-add" data-pid="${esc(p.id)}"><span class="dpr-n">${esc(p.name)}</span><small>${esc(dspFreeText(p.id))}</small>${ic('plus')}</button></li>`).join('')}</ul>`;
}
function dspFilesEditHtml(x){
  if(!x.files.length) return '<p class="muted m0">Файлов нет.</p>';
  return x.files.map((f,i)=>{
    const rm=`<button type="button" class="btn ghost icon dsp-rm" data-act="dsp-file-del" data-i="${i}" aria-label="Убрать файл: ${esc(f.name)}">${ic('x')}</button>`;
    return dspIsImage(f)?`<figure class="dsp-th"><img src="${esc(f.data)}" alt="${esc(f.name)}"><small>${esc(f.name)}</small>${rm}</figure>`
      :`<div class="dsp-fl">${ic('file')}<span>${esc(f.name)}<small>${dspSize(f.size||0)}${f.unsaved?' · не сохранено — мало места в браузере':''}</small></span>${rm}</div>`;
  }).join('');
}
MODALS.dispatchForm=()=>{
  const x=dspDraft()||dspDraftFrom({},'');
  const f=(id,label,html,cls)=>`<div class="field${cls?' '+cls:''}"><label for="dsp-${id}">${label}</label>${html}</div>`;
  const inp=(id,k,val,type,extra)=>`<input id="dsp-${id}" class="inp" type="${type||'text'}" value="${esc(val)}" data-on="dsp-f" data-k="${k}" autocomplete="off"${extra||''}>`;
  return `<form data-form="dispatch" novalidate>${mHead(x.editId?'Заявка '+esc(x.editId):'Новая отправка')}<div class="modal-b dsp-form">
    ${f('purpose','Цель',`<select id="dsp-purpose" class="inp" data-on="dsp-purpose">${Object.entries(Dispatch.PURPOSE).map(([k,l])=>`<option value="${k}"${x.purpose===k?' selected':''}>${esc(l)}</option>`).join('')}</select>`)}
    <div class="grid2">${f('name','Получатель',inp('name','name',x.name,'text',' placeholder="Кому везём"'))}${f('phone','Телефон',inp('phone','phone',x.phone,'tel',' inputmode="tel" placeholder="+7 …"'))}</div>
    <div id="dsp-tr" class="stack-s">${dspTransferHtml(x)}</div>
    <div class="grid2">${f('date','Дата',inp('date','date',x.date,'date'))}<div class="field"><span class="lbl">Время (по желанию)</span><div class="grid2"><input id="dsp-from" class="inp" type="time" value="${esc(x.from)}" data-on="dsp-f" data-k="from" aria-label="Время с"><input id="dsp-till" class="inp" type="time" value="${esc(x.till)}" data-on="dsp-f" data-k="till" aria-label="Время до"></div></div></div>
    <div class="field"><span class="lbl">Что отправляем</span><div id="dsp-items">${dspItemsHtml(x)}</div>
      <input id="dsp-pq" class="inp" type="search" placeholder="Найти товар в каталоге" data-on="dsp-pq" autocomplete="off" aria-label="Поиск товара в каталоге"><div id="dsp-pres">${dspPresHtml('')}</div>
      <div class="dsp-own"><input id="dsp-own" class="inp" placeholder="Или своя строка: например, образцы и документы" autocomplete="off" aria-label="Своя строка"><button type="button" class="btn" data-act="dsp-own-add">Добавить</button></div></div>
    <div class="field"><span class="lbl">Файлы</span><div id="dsp-files" class="dsp-files">${dspFilesEditHtml(x)}</div><label class="btn dsp-addfile" for="dsp-file">${ic('plus')}Прикрепить файлы<input id="dsp-file" class="sr" type="file" multiple data-on="dsp-file"></label><small class="hint">Фото и документы любого типа. Большие файлы могут не поместиться в браузер: тогда у них будет пометка.</small></div>
    ${f('note','Примечание',`<textarea id="dsp-note" class="inp" rows="3" data-on="dsp-f" data-k="note" placeholder="Например: позвонить за час до приезда">${esc(x.note)}</textarea>`)}
    <p class="err" id="dsp-err" hidden></p></div>${mFoot(x.editId?'Сохранить':'Создать заявку')}</form>`;
};
MODALS.dspCancel=id=>{
  const d=Dispatch.byId(S,id);
  return `<form data-form="dsp-cancel" data-id="${esc(id)}" novalidate>${mHead('Отменить заявку '+esc(d?d.number:id))}<div class="modal-b">
    <p class="m0">${d?esc(d.to.name):''}</p>
    <p class="hint">Заявка уйдёт на этап «Отменена», в ленте останется, кто её отменил.${d&&d.purpose==='transfer'&&d.moved&&!d.landed?' Товар, который уже ушёл в путь, вернётся на склад «откуда».':''}</p>
  </div>${mFoot('Отменить заявку')}</form>`;
};
// Окно «Списать при продаже» для строки заявки. Откуда — те же варианты, что в окне карточки товара (sellSources из 53-stock.js):
// резерв сделки заявки (он первый и выбран) и клетки «юрлицо × город» с остатком. Количество — из строки, не вводится.
// «Можно списать N» — sellMaxText → Stock.sellMax; само списание и все отказы — Dispatch.sell → Stock.sell.
MODALS.dspSell=o=>{
  const d=Dispatch.byId(S,o.id),it=d&&d.items[o.i],p=it&&it.productId?product(it.productId):null;
  const head=mHead('Списать при продаже');
  if(!p) return `${head}<div class="modal-b"><p class="m0">Такой строки в заявке нет.</p></div>`;
  const src=sellSources({pid:p.id,did:d.dealId});
  if(!src.length) return `${head}<div class="modal-b"><p class="m0">Списать нечего: на складе этого товара нет остатка и резерва со склада.</p></div>`;
  const dealRs=src.find(x=>x[0][0]==='r'),best=Stock.bestCell(S,p.id);
  const want=dealRs?dealRs[0]:`c:${best.entityId}|${best.cityId}`,cur=src.some(x=>x[0]===want)?want:src[0][0];
  return `<form data-form="dsp-sell" data-id="${esc(d.id)}" data-i="${esc(o.i)}" novalidate>${mHead('Списать при продаже: '+esc(p.name))}<div class="modal-b">
    <p class="m0">Заявка ${esc(d.number)}, ${esc(d.to.name)}. Списывается вся строка: ${esc(qtyOf(it.qty,p))}.${d.dealId?` Сделка ${esc(d.dealId)}.`:''} В журнале движений появится «Отгрузка».</p>
    <div class="field"><label for="ps-src">Откуда</label><select id="ps-src" class="inp" data-on="sellsrc" data-pid="${esc(p.id)}">${optionsHtml(src,cur)}</select></div>
    <p class="hint" id="ps-max">${esc(sellMaxText(p.id,cur))}</p>
    <p class="err" id="ps-err" hidden></p></div>${mFoot('Списать')}</form>`;
};
MODALS.dspFile=key=>{
  const [id,fid]=String(key).split('|'),d=Dispatch.byId(S,id),f=d&&d.files.find(x=>x.id===fid);
  if(!f) return `<div>${mHead('Файл')}<div class="modal-b"><p class="m0">Файла нет.</p></div></div>`;
  return `<div>${mHead(esc(f.name))}<div class="modal-b">${dspIsImage(f)?`<img class="dsp-big" src="${esc(f.data)}" alt="${esc(f.name)}">`:''}<a class="btn" href="${esc(f.data)}" download="${esc(f.name)}">${ic('file')}Скачать · ${esc(dspSize(f.size||0))}</a></div></div>`;
};

// ——— действия ———
// Перевести заявку на этап: из воронки (перетаскивание) и из кнопок карточки. Всё — через Dispatch.setStage
function dspMove(id,stageId){
  const d=Dispatch.byId(S,id);
  if(!d||d.stageId===stageId) return null;
  const r=Dispatch.setStage(S,id,stageId,S.me,new Date());
  if(!r.ok){toast(r.reason,'warn');return null}
  render();
  toast(`${d.number}: этап «${dspStageName(d)}». Запись в ленте есть.${r.note?' '+r.note:''}`);
  return r;
}
// Адрес в буфер: современный способ, а где его нет — через временное поле
function dspCopy(text,done){
  const fail=()=>toast('Не получилось скопировать: выделите адрес и скопируйте вручную.','warn');
  const old=()=>{try{const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();const ok=document.execCommand('copy');ta.remove();ok?done():fail()}catch(_){fail()}};
  try{if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(done,old);return}}catch(_){}
  old();
}

A['open-dispatch']=el=>openDrawer('dispatch',el.dataset.id);
A['dsp-new']=()=>openDispatchNew();
A['dsp-edit']=el=>openDispatchEdit(el.dataset.id);
A['dsp-view']=el=>{dspU().view=el.dataset.v==='funnel'?'funnel':'list';render()};
A['dsp-mine']=()=>{const u=dspU();u.mine=!u.mine;render()};
A['dsp-today']=()=>{const u=dspU();u.today=!u.today;render()};
A['dsp-reset']=()=>{S.ui.dispatch=Object.assign({},DSP_DEF,{view:dspSel().view});render()};
A['dsp-stage']=el=>dspMove(el.dataset.id,el.dataset.stage);
A['dsp-cancel-ask']=el=>openModal('dspCancel',el.dataset.id);
A['dsp-copy']=el=>{const d=Dispatch.byId(S,el.dataset.id);if(d) dspCopy(d.address,()=>toast(`Адрес скопирован: ${d.address}`))};
A['dsp-file']=el=>openModal('dspFile',el.dataset.key);
A['dsp-sell']=el=>{
  if(!Dispatch.canSell(S,S.me)){toast('У вашей роли нет права списывать товар при продаже.','warn');return}
  openModal('dspSell',{id:el.dataset.id,i:+el.dataset.i});
};
// форма
A['dsp-add']=el=>{
  const x=dspDraft();if(!x) return;
  const row=x.items.find(i=>i.productId===el.dataset.pid);
  if(row) row.qty=(Number(row.qty)||0)+1;else x.items.push({productId:el.dataset.pid,qty:1});
  byId('dsp-items').innerHTML=dspItemsHtml(x);
};
A['dsp-own-add']=()=>{
  const x=dspDraft(),inp=byId('dsp-own'),text=inp.value.trim();
  if(!x||!text){if(inp.focus) inp.focus();return}
  x.items.push({text,qty:1});inp.value='';byId('dsp-items').innerHTML=dspItemsHtml(x);
};
A['dsp-line-del']=el=>{const x=dspDraft();if(!x) return;x.items.splice(+el.dataset.i,1);byId('dsp-items').innerHTML=dspItemsHtml(x)};
A['dsp-file-del']=el=>{const x=dspDraft();if(!x) return;x.files.splice(+el.dataset.i,1);byId('dsp-files').innerHTML=dspFilesEditHtml(x)};

ON.input['dsp-q']=t=>{dspU().q=t.value;const box=byId('dsp-body');if(box) box.innerHTML=dspBody()};
ON.change['dsp-f']=t=>{
  const k=t.dataset.k;
  if(Object.hasOwn(DSP_DEF,k)&&k!=='view'&&k!=='q'){dspU()[k]=t.value;render();return}
  dspField(t);
};
// Поле формы → черновик. Смена склада «куда» обновляет подсказку про адрес.
function dspField(t){
  const x=dspDraft(),k=t.dataset.k;if(!x||!Object.hasOwn(x,k)) return;
  x[k]=t.value;
  if(k==='toE'||k==='toC'){const h=byId('dsp-ad-hint');if(h) h.textContent=dspAddrHint(x)}
}
ON.input['dsp-f']=t=>{if(!(t.dataset.k in DSP_DEF)) dspField(t)};
ON.change['dsp-purpose']=t=>{
  const x=dspDraft();if(!x) return;
  x.purpose=t.value;byId('dsp-tr').innerHTML=dspTransferHtml(x);
  // у перемещения получатель — склад: подставим, если поле пустое
  if(x.purpose==='transfer'&&!x.name.trim()){x.name=`Склад: ${dspCell({entityId:x.toE,cityId:x.toC})}`;const n=byId('dsp-name');if(n) n.value=x.name}
};
ON.input['dsp-qty']=t=>{const x=dspDraft();if(x&&x.items[+t.dataset.i]) x.items[+t.dataset.i].qty=t.value};
ON.input['dsp-pq']=t=>{const box=byId('dsp-pres');if(box) box.innerHTML=dspPresHtml(t.value)};
ON.change['dsp-file']=t=>{dspReadFiles(t.files);t.value=''};
// Выбранные файлы читаются в data-URL и встают в черновик; в сохранение они попадают вместе с заявкой (Store.dump)
function dspReadFiles(files){
  const x=dspDraft();if(!x||typeof FileReader==='undefined') return;
  [...files].forEach(f=>{
    const fr=new FileReader();
    fr.onload=()=>{
      if(dspDraft()!==x) return;
      x.files.push({name:f.name,type:f.type||'',size:f.size,data:String(fr.result)});
      const box=byId('dsp-files');if(box) box.innerHTML=dspFilesEditHtml(x);
    };
    fr.onerror=()=>toast(`Файл «${f.name}» не прочитался.`,'warn');
    fr.readAsDataURL(f);
  });
}
// «Собрано»: галочка строки → Dispatch.pick; не вышло — вернуть галочку и сказать почему
ON.change['dsp-pick']=t=>{
  const r=Dispatch.pick(S,t.dataset.id,+t.dataset.i,t.checked,S.me,new Date());
  if(!r.ok) toast(r.reason,'warn');
  render();
};

// Поля, которые не назвали: подсветить в форме
const DSP_MISS_ID={name:'dsp-name',address:'dsp-address',phone:'dsp-phone',date:'dsp-date',items:'dsp-pq',from:'dsp-from-e',toCell:'dsp-to-e'};
function dspMark(missing){
  Object.values(DSP_MISS_ID).forEach(id=>{const e=byId(id);if(e&&e.removeAttribute) e.removeAttribute('aria-invalid')});
  (missing||[]).forEach(k=>{const e=byId(DSP_MISS_ID[k]);if(e&&e.setAttribute) e.setAttribute('aria-invalid','true')});
}
FORMS.dispatch=()=>{
  const x=dspDraft();
  if(!x) return closeModal();
  // значения полей — из формы (автозаполнение браузера события ввода не шлёт)
  const v=(id,k)=>{const e=byId(id);if(e&&typeof e.value==='string') x[k]=e.value};
  v('dsp-name','name');v('dsp-phone','phone');v('dsp-date','date');v('dsp-from','from');v('dsp-till','till');v('dsp-note','note');
  if(x.purpose!=='transfer') v('dsp-address','address');
  const data={purpose:x.purpose,to:{name:x.name,phone:x.phone},address:x.purpose==='transfer'?'':x.address,when:{date:x.date,from:x.from,till:x.till},items:x.items,files:x.files,note:x.note,dealId:x.dealId||undefined};
  if(x.purpose==='transfer'){data.from={entityId:x.fromE,cityId:x.fromC};data.toCell={entityId:x.toE,cityId:x.toC}}
  const now=new Date(),r=x.editId?Dispatch.update(S,x.editId,data,S.me,now):Dispatch.create(S,data,S.me,now);
  if(!r.ok){dspMark(r.missing);showErr('dsp-err',r.reason);return}
  const id=x.editId||r.id,got=!x.editId&&S.notes[0]&&S.notes[0].kind==='dispatch'?S.notes[0].to.length:0;
  S.ui.dspDraft=null;closeModal();render();openDrawer('dispatch',id);
  toast(x.editId?`Заявка ${id} изменена. Запись в ленте есть.`:`Заявка ${id} создана. Уведомление получили: ${got}.`);
};
FORMS['dsp-assign']=f=>{
  const id=f.dataset.id,to=byId('dsp-drv').value,r=Dispatch.assign(S,id,to,S.me,new Date());
  if(!r.ok){toast(r.reason,'warn');return}
  render();toast(to?`Водитель ${dspWho(to)} назначен, ему ушло уведомление.`:'Водитель снят.');
};
// Списание строки: «откуда» из окна → Dispatch.sell; отказ ядра (нет права, не хватает, чужой резерв) — причиной в окне
FORMS['dsp-sell']=f=>{
  const id=f.dataset.id,i=+f.dataset.i,d=Dispatch.byId(S,id),it=d&&d.items[i];
  if(!it||!it.productId) return showErr('ps-err','Такой строки в заявке нет.');
  const r=Dispatch.sell(S,id,i,sellArg(it.productId,byId('ps-src').value),S.me,new Date());
  if(!r.ok) return showErr('ps-err',r.reason);
  closeModal();render();
  toast(`${d.number}: ${Dispatch.soldText(S,it)}. Запись в журнале склада и в ленте есть.`);
};
FORMS['dsp-cancel']=f=>{
  const id=f.dataset.id;
  closeModal();
  dspMove(id,Dispatch.ST.cancelled);
};

// Enter в строке поиска товара и в своей строке не отправляет форму: в своей строке он добавляет строку
document.addEventListener('keydown',e=>{
  const id=e.key==='Enter'&&e.target&&e.target.id;
  if(id==='dsp-own'){e.preventDefault();A['dsp-own-add']()}
  else if(id==='dsp-pq') e.preventDefault();
});

// драг и дроп: столбцы воронки отправок — data-dspcol
document.addEventListener('dragover',e=>{
  const col=e.target.closest?.('[data-dspcol]');if(!col) return;
  e.preventDefault();
  document.querySelectorAll('.col.drop').forEach(x=>{if(x!==col) x.classList.remove('drop')});col.classList.add('drop');
});
document.addEventListener('drop',e=>{
  const col=e.target.closest?.('[data-dspcol]');if(!col) return;
  e.preventDefault();col.classList.remove('drop');
  const id=e.dataTransfer.getData('text/plain');
  if(id&&Dispatch.byId(S,id)) dspMove(id,col.dataset.dspcol);
});

// ——— регистрация в реестрах оболочки ———
NAV.push({id:'dispatch',label:'Отправки',icon:'truck',group:'Товар',order:40,ok:()=>true,badge:()=>dspBadge(),hot:true});
VIEWS.dispatch=vDispatch;
DRAWERS.dispatch=id=>{const d=Dispatch.byId(S,id);return d?dDispatch(d):null};
