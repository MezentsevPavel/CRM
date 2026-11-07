// Раздел «Сделки»: канбан своей воронки и таблица, быстрая форма «Новая сделка», карточка сделки (полоса этапов,
// «Успешно», «Провалена» с причиной, вкладки «Детали», «Товары», «Лента»), коммерческое предложение для печати.
// Всё решает ядро: Deals (42-deals.js) — этапы, сумма, строки, резервы, колонки; Clients — клиенты; Feed — лента;
// Leads.dealsVisible — какие сделки человеку видны. Здесь — только экран: виды — чистые функции состояния,
// состояние меняют обработчики внизу файла. Выбор на экране (вид, поиск, фильтры) лежит в S.ui.deals и не сохраняется.

Object.assign(IC,{print:'<path d="M7 9V4h10v5"/><rect x="4" y="9" width="16" height="8" rx="2"/><path d="M7 14h10v6H7z"/>'});

// ——— выбор на экране ———
const DEALS_DEF={view:'board',q:'',mine:false,lost:false,acts:''};
const dealsU=()=>S.ui.deals||(S.ui.deals=Object.assign({},DEALS_DEF));
const dealsSel=()=>Object.assign({},DEALS_DEF,S.ui.deals||{});
const dealNoData=t=>`<span class="muted">нет данных: ${t}</span>`;
// «нет данных: …» в поле ввода — не значение, а подсказка: поле остаётся пустым
const dealVal=v=>(/^нет данных/.test(v||'')?'':(v||''));

function dealGoods(d){
  const rs=S.reserves.filter(r=>r.dealId===d.id);
  if(!rs.length) return {lvl:'',text:'не зарезервирован'};
  const wait=rs.filter(r=>r.src!=='stock');
  if(wait.some(r=>stockOf(r.productId).freeAfter<0)) return {lvl:'bad',text:'не хватает товара'};
  if(!wait.length) return {lvl:'ok',text:'всё на складе'};
  const ss=[...new Set(wait.map(r=>r.src))].map(ship).filter(Boolean);
  const last=ss.reduce((a,s)=>s.eta>a?s.eta:a,ss[0].eta);
  return {lvl:'info',text:`едет ${ss.map(s=>s.id).join(', ')} · до ${fD(last)}`};
}
// Типы, между которыми человек переключает сделки: директор и те, у кого есть право «Видеть сделки всех типов»,
// — оба; остальные — свой тип (и тот, в котором у них есть сделки). Нет ни того, ни другого — оба.
function dealTypes(vis){
  if(can('dealsAll')) return ['b2b','b2c'];
  const own=Perms.roleOf(S,S.me)?.scope,t=['b2b','b2c'].filter(x=>x===own||vis.some(d=>d.type===x));
  return t.length?t:['b2b','b2c'];
}
// Что видит человек сейчас: сделки по праву, доступные ему типы, выбранный тип и воронка этого типа
// (воронок типа может быть несколько — выбор в S.ui.dealPipe)
function dealsScope(){
  const vis=Leads.dealsVisible(S,S.me),types=dealTypes(vis),cur=types.includes(S.ui.dealType)?S.ui.dealType:types[0];
  const pipes=Pipes.of(S,'deals',cur),pipe=pipes.find(p=>p.id===S.ui.dealPipe)||pipes[0]||null;
  return {vis,types,cur,pipes,pipe};
}
// Один отбор на канбан, таблицу и счётчики: тип, поиск, «Мои», «Провалены»
const dealsFilter=(u,cur)=>({type:cur,q:u.q,mine:u.mine,lost:u.lost?'only':undefined,acts:u.acts||undefined,now:new Date()});
// Сумма сделки: только Deals.total; у кого нет права «цены» — не показывается совсем
const dealSumText=d=>{const s=Deals.total(d);return s?rub(s):'не рассчитана'};
const dealWho=id=>person(id)?.name||'нет данных: менеджер';

// ——— карточка в колонке ———
function dealCardHtml(d){
  const lost=!!d.lostReason,pr=can('prices'),np=Deals.noPrice(d).length;
  const mgr=d.managerId?`<span class="who">${av(person(d.managerId),'xs')}${esc(dealWho(d.managerId))}</span>`:'<span class="pill sm warn">нет менеджера</span>';
  const top=[lost?'<span class="pill sm bad">Провалена</span>':'',d.demo?'<span class="pill sm">пример</span>':'',np?`<span class="pill sm warn">без цены: ${np}</span>`:''].join('');
  return `<article class="tcard dcard${lost?' lost':''}${Deals.state(S,d)==='won'?' won':''}"${lost||!Deals.canEdit(S,d,S.me)?'':` draggable="true" data-drag="${esc(d.id)}"`} data-act="open-deal" data-id="${esc(d.id)}" tabindex="0"><div class="tc-top">${top}</div><p class="tc-t">${esc(d.client)}<small class="mono lc-id">${esc(d.id)} · ${esc(d.object)}</small></p>${pr?`<p class="dc-sum">${esc(dealSumText(d))}</p>`:''}${lost?`<p class="dc-lost">Причина: ${esc(d.lostReason)}</p>`:''}${actNextHtml({t:'deal',id:d.id})}<div class="tc-m">${mgr}<span class="due">${d.at?esc(fRel(d.at)):''}</span></div></article>`;
}

// ——— канбан: колонки — этапы воронки, в шапке число сделок и сумма (Deals.columns) ———
function dealsBoard(pipe,cur,u){
  const cols=Deals.columns(S,pipe.id,dealsFilter(u,cur),S.me),pr=can('prices');
  return `<div class="xs" data-hscroll><div class="dkan" style="--n:${cols.length}">${cols.map(c=>{
    const unknown=c.deals.filter(d=>!Deals.total(d)).length;
    const plus=c.stage.flag==='final'||!can('dealsEdit')?'':`<button type="button" class="btn ghost icon dplus" data-act="deal-new" data-stage="${esc(c.stage.id)}" aria-label="Новая сделка на этапе «${esc(c.stage.name)}»">${ic('plus')}</button>`;
    return `<div class="col dcol" data-dcol="${esc(c.stage.id)}"><div class="col-h"><span>${esc(c.stage.name)}</span>${plus}</div><p class="dcol-s"><span class="dcnt">${c.count} ${pl(c.count,'сделка','сделки','сделок')}</span>${pr?` · <b class="dsum" data-sum="${c.sum}">${rub(c.sum)}</b>`:''}${pr&&unknown?`<small>без суммы: ${unknown}</small>`:''}</p>${c.deals.map(dealCardHtml).join('')||'<p class="col-empty">Пусто</p>'}</div>`;
  }).join('')}</div></div>`;
}

// ——— таблица: второй вид тех же сделок ———
function dealsTable(cur,u){
  const pr=can('prices'),list=Deals.query(S,dealsFilter(u,cur),S.me).sort((a,b)=>stagePos(b)-stagePos(a)||String(b.id).localeCompare(String(a.id)));
  const rows=list.map(d=>{
    const g=dealGoods(d),lost=!!d.lostReason;
    return `<tr class="click" data-act="open-deal" data-id="${esc(d.id)}" tabindex="0"><td><div class="pname"><span>${esc(d.client)}${d.demo?' <span class="pill sm">пример</span>':''}</span><small class="mono">${esc(d.id)} · ${esc(d.object)}</small></div></td><td>${lost?`<span class="pill bad">Провалена: ${esc(d.lostReason)}</span>`:`<span class="pill ${stageTone(d)}">${esc(stageName(d))}</span>`}${actNextHtml({t:'deal',id:d.id})}</td><td class="d-hide-s"><span class="pill sm ${g.lvl}">${esc(g.text)}</span></td><td class="nowrap">${esc(dealWho(d.managerId))}</td><td class="d-hide-s">${chPill(d.channel)}</td>${pr?`<td class="num">${esc(dealSumText(d))}</td>`:''}</tr>`;
  }).join('');
  return `<section class="card clip"><div class="xs"><table class="tbl"><thead><tr><th>Клиент</th><th>Этап</th><th class="d-hide-s">Товар</th><th>Менеджер</th><th class="d-hide-s">Связь</th>${pr?'<th class="num">Сумма</th>':''}</tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

// ——— тело раздела: счёт + доска или таблица (его же перерисовывают поиск и правка в карточке) ———
function dealsBody(){
  const u=dealsSel(),{vis,cur,pipe}=dealsScope(),pr=can('prices');
  if(!vis.length) return `<section class="card">${emptyState('Сделок пока нет. Заведите первую или создайте её из лида в разделе «Лиды».',can('dealsEdit')?'Новая сделка':'','deal-new')}</section>`;
  if(!pipe) return '<section class="card"><p class="empty">Воронки сделок этого типа нет — её заводят в «Настройки → Воронки».</p></section>';
  const list=Deals.query(S,dealsFilter(u,cur),S.me),sum=Deals.sumOf(list);
  const head=`<p class="count"><span>Сделок: <b>${list.length}</b></span>${pr?`<span>на сумму: <b>${rub(sum)}</b></span>`:''}<span>${esc(pipe.name)}</span></p>`;
  if(!list.length){
    const dirty=u.q.trim()||u.mine||u.lost||u.acts;
    return `${head}<section class="card">${dirty?emptyState('По этим условиям сделок нет.','Сбросить поиск и фильтры','deal-reset'):emptyState(`Сделок типа ${Leads.TYPE[cur]} пока нет. Заведите первую или создайте её из лида.`,can('dealsEdit')?'Новая сделка':'','deal-new')}</section>`;
  }
  return head+(u.view==='table'?dealsTable(cur,u):dealsBoard(pipe,cur,u));
}

function vDeals(){
  const u=dealsSel(),{vis,types,cur,pipes,pipe}=dealsScope();
  const lostN=Deals.query(S,{type:cur,q:u.q,mine:u.mine,lost:'only'},S.me).length;
  const seg=(act,items,on,aria)=>`<div class="seg" role="group" aria-label="${aria}">${items.map(([k,l,n])=>`<button type="button" class="${on===k?'on':''}" aria-pressed="${on===k}" data-act="${act}" data-${act==='deal-type'?'type':'v'}="${k}">${l}${n===undefined?'':`<b>${n}</b>`}</button>`).join('')}</div>`;
  const typeSw=types.length>1?seg('deal-type',types.map(t=>[t,Leads.TYPE[t],vis.filter(d=>d.type===t).length]),cur,'Тип клиентов'):'';
  const pipeSel=pipes.length>1?`<select class="inp sm w-auto" data-on="deal-pipe" aria-label="Воронка">${pipes.map(p=>`<option value="${esc(p.id)}"${pipe&&p.id===pipe.id?' selected':''}>${esc(p.name)}</option>`).join('')}</select>`:'';
  const dirty=u.q.trim()||u.mine||u.lost||u.acts,fq={type:cur,q:u.q,mine:u.mine,now:new Date()};
  const noActN=Deals.query(S,{...fq,acts:'none'},S.me).length,lateN=Deals.query(S,{...fq,acts:'overdue'},S.me).length;
  return `<p class="hint">Перетащите карточку на другой этап или откройте сделку. «Успешно», «Провалена» и коммерческое предложение — в карточке. ${types.length>1?'Переключатель показывает сделки выбранного типа.':`Вам видны сделки типа ${Leads.TYPE[cur]}.`}</p>
  <div class="bar dbar">${typeSw}${seg('deal-view',[['board','Доска'],['table','Таблица']],u.view,'Вид')}${pipeSel}<div class="search-in">${ic('search')}<input id="deal-q" class="inp" type="search" placeholder="Поиск: клиент, номер, телефон, объект" value="${esc(u.q)}" data-on="deal-q" autocomplete="off" aria-label="Поиск по сделкам"></div><span class="grow"></span>${can('dealsEdit')?`<button type="button" class="btn pri" data-act="deal-new">${ic('plus')}Новая сделка</button>`:''}</div>
  <div class="bar dfilt"><button type="button" class="fchip${u.mine?' on':''}" aria-pressed="${u.mine}" data-act="deal-mine">Мои</button><button type="button" class="fchip${u.lost?' on':''}" aria-pressed="${u.lost}" data-act="deal-lostf">Провалены · ${lostN}</button><button type="button" class="fchip${u.acts==='none'?' on':''}" aria-pressed="${u.acts==='none'}" data-act="deal-acts" data-k="none">Без дел · ${noActN}</button><button type="button" class="fchip${u.acts==='overdue'?' on':''}" aria-pressed="${u.acts==='overdue'}" data-act="deal-acts" data-k="overdue">Просрочены дела · ${lateN}</button>${dirty?'<button type="button" class="btn ghost sm" data-act="deal-reset">Сбросить</button>':''}</div>
  <div id="deal-body" class="stack-s">${dealsBody()}</div>`;
}

// ——— быстрая форма «Новая сделка» ———
// Клиент: найти среди существующих (Clients.search) или завести нового тут же; остальное — контакт, телефон, тип, менеджер.
function dealClientOpts(q,sel){
  const hits=q.trim()?clientsSeen(Clients.search(S,q)).slice(0,6):[],pick=sel&&clientVisible(Clients.byId(S,sel))&&Clients.byId(S,sel);
  // выбранный клиент («Выбрать его» в подсказке о дубле) остаётся в списке, даже если поиск по имени его не вернул
  if(pick&&!hits.some(c=>c.id===sel)) hits.unshift(pick);
  const cur=sel&&hits.some(c=>c.id===sel)?sel:(hits[0]?hits[0].id:'new');
  const one=(v,html)=>`<label class="dpick"><input type="radio" name="dn-c" value="${esc(v)}" data-on="deal-cs"${cur===v?' checked':''}><span>${html}</span></label>`;
  return one('new','Новый клиент — заполните ниже')+hits.map(c=>one(c.id,`${esc(c.name)}<small>${esc(c.id)}${(c.phones||[])[0]?' · '+esc(c.phones[0]):''}${c.inn?' · ИНН '+esc(c.inn):''}${c.demo?' · пример':''}</small>`)).join('')
    +(q.trim()&&!hits.length?'<p class="hint">Такого клиента нет — заведём нового.</p>':'');
}
// Менеджеры в форме: я (по умолчанию) и менеджеры типов
function dealManagers(){
  const m=me(),list=[m,...Leads.managers(S).filter(p=>p.id!==m.id)];
  return list.map(p=>`<option value="${esc(p.id)}"${p.id===m.id?' selected':''}>${esc(p.name)}${p.id===m.id?' (я)':''}</option>`).join('');
}
MODALS.dealNew=stageId=>{
  const {types,cur,pipe}=dealsScope(),role=Perms.roleOf(S,S.me),def=types.includes(role&&role.scope)?role.scope:cur;
  const stg=stageId&&pipe?Pipes.stage(S,pipe.id,stageId):null;
  return `<form data-form="deal-new" data-stage="${esc(stageId||'')}" novalidate>${mHead('Новая сделка')}<div class="modal-b">
    <div class="field"><label for="dn-cq">Клиент</label><input id="dn-cq" class="inp" type="search" placeholder="Название, телефон или ИНН — найдём среди клиентов" data-on="deal-cq" autocomplete="off"><div id="dn-cres" class="dpicks">${dealClientOpts('','')}</div></div>
    <div id="dn-new" class="stack-s"><div class="field"><label for="dn-cname">Имя клиента или название компании</label><input id="dn-cname" class="inp" autocomplete="off"></div>
      <div class="grid2"><div class="field"><label for="dn-email">Почта</label><input id="dn-email" class="inp" type="email" data-on="deal-dup" autocomplete="off"></div><div class="field"><label for="dn-inn">ИНН (если компания)</label><input id="dn-inn" class="inp" inputmode="numeric" data-on="deal-dup" autocomplete="off"></div></div></div>
    <div class="grid2"><div class="field"><label for="dn-contact">Контакт</label><input id="dn-contact" class="inp" placeholder="С кем говорим" autocomplete="off"></div><div class="field"><label for="dn-phone">Телефон</label><input id="dn-phone" class="inp" type="tel" data-on="deal-dup" autocomplete="off"></div>
      <div class="field"><label for="dn-type">Тип</label><select id="dn-type" class="inp">${types.map(t=>`<option value="${t}"${t===def?' selected':''}>${Leads.TYPE[t]}</option>`).join('')}</select></div><div class="field"><label for="dn-mgr">Менеджер</label><select id="dn-mgr" class="inp">${dealManagers()}</select></div>
      <div class="field"><label for="dn-obj">Что продаём</label><input id="dn-obj" class="inp" placeholder="Например: станция 8 кВт для дома" autocomplete="off"></div><div class="field"><label for="dn-ch">Связь</label><select id="dn-ch" class="inp">${Object.entries(CH).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></div></div>
    <div id="dn-dup" aria-live="polite"></div>
    ${stg?`<p class="hint">Сделка встанет на этап «${esc(stg.name)}».</p>`:''}
    <p class="err" id="dn-err" hidden></p></div>${mFoot('Завести сделку')}</form>`;
};

// ——— карточка сделки ———
const DEAL_TABS=[['details','Детали'],['items','Товары'],['feed','Лента']];
const DEAL_FIELD={contact:'Контакт',phone:'Телефон',email:'Почта',object:'Что продаём',type:'Тип',managerId:'Менеджер',channel:'Связь',amount:'Сумма'};

// Полоса этапов: клик по этапу переводит сделку (Deals.move); последний этап — «Успешно»
function dealSteps(d,edit){
  const stg=stagesFor(d),pos=stagePos(d),lost=!!d.lostReason;
  return `<div class="dsteps" role="group" aria-label="Этапы сделки">${stg.map((x,i)=>{
    const cls=i<pos?'done':x.id===d.stageId?(lost?'lost':'cur'):'';
    return `<button type="button" class="dstep ${cls}" data-act="deal-stage" data-id="${esc(d.id)}" data-st="${esc(x.id)}"${x.id===d.stageId||!edit||lost?' disabled':''}${x.id===d.stageId?' aria-current="step"':''}><span>${esc(x.name)}</span></button>`;
  }).join('')}</div>`;
}
// Кнопки действий над сделкой: зависят от состояния (Deals.state) и права
function dealActions(d,edit){
  const st=Deals.state(S,d),id=esc(d.id),b=(act,label,cls)=>`<button type="button" class="btn${cls?' '+cls:''}" data-act="${act}" data-id="${id}">${label}</button>`;
  let h='';
  if(edit&&st==='open') h+=b('deal-win',ic('check')+'Успешно','pri')+b('deal-lose',ic('x')+'Провалена');
  if(edit&&st==='lost') h+=b('deal-reopen','Вернуть в работу','pri');
  if(can('prices')) h+=b('deal-kp',ic('print')+'КП');
  if(st!=='lost') h+=b('deal-dispatch',ic('truck')+'Создать отправку');
  const note=st==='lost'?`<p class="lock bad-t">${ic('alert')}Провалена: ${esc(d.lostReason)}${d.lostAt?' · '+esc(fWhen(d.lostAt)):''}. Этап не меняется, пока сделку не вернут в работу.</p>`
    :st==='won'?`<p class="lock ok-t">${ic('check')}Успешно закрыта${d.wonAt?' · '+esc(fWhen(d.wonAt)):''}. Чтобы вернуть в работу, выберите другой этап.</p>`:'';
  return `${h?`<div class="dact">${h}</div>`:''}${note}${edit?'':`<p class="lock">${ic('lock')}Сделка открыта на просмотр: двигать по этапам и править её могут те, у кого есть право «Заводить и править сделки».</p>`}`;
}
// Ссылка на клиента: на карточку клиента (DRAWERS.client — раздел «Клиенты»), пока её нет — просто имя
function dealClientLink(d){
  const c=Clients.byId(S,d.clientId);
  if(!c) return esc(d.client);
  return Object.hasOwn(DRAWERS,'client')?`<button type="button" class="link" data-act="open-client" data-id="${esc(c.id)}">${esc(c.name)}</button> <small class="muted mono">${esc(c.id)}</small>`:`${esc(c.name)} <small class="muted mono">${esc(c.id)}</small>`;
}
function dealDetails(d,edit){
  const id=esc(d.id);
  const field=(f,label,html)=>`<div class="field"><label for="df-${f}">${label}</label>${html}</div>`;
  const text=(f,val,kind,ph)=>edit?`<input id="df-${f}" class="inp" type="${kind||'text'}" data-on="deal-f" data-id="${id}" data-f="${f}" value="${esc(dealVal(val))}" placeholder="нет данных: ${ph}" autocomplete="off">`:(dealVal(val)?`<span>${esc(val)}</span>`:dealNoData(ph));
  const sel=(f,opts,cur)=>edit?`<select id="df-${f}" class="inp" data-on="deal-f" data-id="${id}" data-f="${f}">${opts.map(([v,l])=>`<option value="${esc(v)}"${v===cur?' selected':''}>${esc(l)}</option>`).join('')}</select>`:esc((opts.find(o=>o[0]===cur)||[0,'нет данных'])[1]);
  const mgrs=Leads.managers(S).map(p=>[p.id,p.name]);
  if(d.managerId&&!mgrs.some(m=>m[0]===d.managerId)) mgrs.unshift([d.managerId,dealWho(d.managerId)]);
  const noItems=!(d.items||[]).length,pr=can('prices');
  const sum=!pr?'':noItems?field('amount','Сумма, ₽',edit?`<input id="df-amount" class="inp" type="number" min="0" step="any" inputmode="decimal" data-on="deal-f" data-id="${id}" data-f="amount" value="${d.amount?esc(d.amount):''}" placeholder="не рассчитана"><small class="muted">Строк товаров нет — сумма вписана руками. Добавите строки — она посчитается по ним.</small>`:esc(dealSumText(d))):field('sum','Сумма',`<b>${rub(Deals.total(d))}</b><small class="muted">считается по товарам (вкладка «Товары»)</small>`);
  const lead=d.leadId?`<dt>Лид</dt><dd>${Leads.visible(S,S.me).some(l=>l.id===d.leadId)?`<button type="button" class="link" data-act="open-lead" data-id="${esc(d.leadId)}">${esc(d.leadId)}</button>`:esc(d.leadId)}</dd>`:'';
  return `<div class="dform"><div class="field span2"><span class="lbl">Клиент</span><span>${dealClientLink(d)}</span></div>
    ${field('contact','Контакт',text('contact',d.contact,'text','контакт'))}${field('phone','Телефон',text('phone',d.phone,'tel','телефон'))}
    ${field('email','Почта',text('email',d.email,'email','почта'))}${field('object','Что продаём',text('object',d.object,'text','что продаём'))}
    ${field('type','Тип',sel('type',Object.entries(Leads.TYPE),d.type))}${field('managerId','Менеджер',sel('managerId',[['','Не назначен'],...mgrs],d.managerId||''))}
    ${field('channel','Связь',sel('channel',Object.entries(CH),d.channel))}${sum}</div>
    <dl class="kv"><dt>Воронка</dt><dd>${esc(pipeById(d.pipeId)?.name||'нет данных: воронка')}</dd><dt>Этап</dt><dd>${esc(stageName(d))}</dd><dt>Создана</dt><dd>${d.at?esc(fWhen(d.at)):'нет данных: дата'}${d.demo?' <span class="pill sm">пример</span>':''}</dd>${lead}</dl>`;
}
function dealCard(d){
  const edit=Deals.canEdit(S,d,S.me),tab=DEAL_TABS.some(t=>t[0]===S.ui.dealTab)?S.ui.dealTab:'details';
  const tabs=`<div class="dtabs" role="tablist" aria-label="Разделы карточки">${DEAL_TABS.map(([k,l])=>`<button type="button" role="tab" class="dtab${tab===k?' on':''}" aria-selected="${tab===k}" data-act="deal-tab" data-tab="${k}">${l}${k==='items'&&(d.items||[]).length?`<b>${d.items.length}</b>`:''}</button>`).join('')}</div>`;
  const body=tab==='items'?dealItems(d,edit):tab==='feed'?feedHtml({t:'deal',id:d.id}):dealDetails(d,edit);
  return {kind:'Сделка '+d.id,title:esc(d.client),sub:`${esc(Leads.TYPE[d.type]||'нет данных: тип')} · ${esc(d.object)}`,body:`${edit?dealSteps(d,edit):''}${dealActions(d,edit)}${tabs}<div class="dpane">${body}</div>`};
}

// ——— вкладка «Товары» ———
// Откуда цена строки: цена сайта (как в каталоге), вписана руками или нет данных
function dealPriceSrc(it){
  if(!(typeof it.price==='number')) return '<span class="pill sm warn">нет данных: цена</span>';
  const p=it.productId?product(it.productId):null;
  return p&&p.price===it.price?`<span class="pill sm" title="${esc(priceNote())}">цена сайта</span>`:'<span class="pill sm">вписана руками</span>';
}
const dealLineSum=it=>(typeof it.price==='number'?rub(Deals.lineSum(it)):'не входит в итог');
const dealTotalText=d=>{
  const np=Deals.noPrice(d).length;
  return np?`В итог не вошли строки без цены: ${np}. Впишите цену — и они посчитаются.`:((d.items||[]).length?'':(Deals.total(d)?'Строк нет: показана сумма, вписанная в «Деталях».':'Строк нет — добавьте товары.'));
};
// Сколько товара сделки ещё можно зарезервировать — только Deals.left (строки сделки с этим товаром минус уже в резерве);
// тем же числом ядро ограничивает резерв, своей копии формулы у экрана нет.
function dealLine(d,it,i,edit,pr){
  const id=esc(d.id),p=it.productId?product(it.productId):null,name=Deals.itemName(S,it);
  let info,res='',btn='';
  if(p){
    const k=stockOf(p.id),held=Deals.reserved(S,d,p.id),left=Deals.left(S,d,p.id);
    info=`<small class="dl-st">${k.known?`свободно ${qtyOf(Math.max(0,k.free),p)}`:'остаток: нет данных'}${held?` · в резерве по сделке: ${qtyOf(held,p)}`:''}</small>`;
    res=S.reserves.filter(r=>r.dealId===d.id&&r.productId===p.id).map(r=>`<span class="chip dl-r">${srcPill(r)}<span>${qtyOf(r.qty,p)}${r.src==='stock'?' · '+esc(cellText(r.entityId,r.cityId)):''}${r.until?' · до '+fD(r.until):''}</span>${edit&&can('reserve')?`<button type="button" class="btn sm ghost" data-act="deal-unres" data-id="${id}" data-rid="${esc(r.id)}">Снять</button>`:''}</span>`).join('');
    if(edit&&can('reserve')&&left>0) btn=`<button type="button" class="btn sm" data-act="deal-res" data-id="${id}" data-i="${i}">${ic('lock')}Зарезервировать</button>`;
    // списание — окно склада (53-stock.js): сначала резерв этой сделки, если он есть; право sell
    if(can('sell')) btn+=`<button type="button" class="btn sm" data-act="stock-sell" data-pid="${esc(p.id)}" data-did="${id}">Списать при продаже</button>`;
  }else info='<small class="dl-st">своя строка — не из каталога, резерва нет</small>';
  const numf=(f,label,val,ph)=>edit?`<div class="field"><label for="di-${f}-${i}">${label}</label><input id="di-${f}-${i}" class="inp sm" type="number" min="0" step="any" inputmode="decimal" data-on="deal-i" data-id="${id}" data-i="${i}" data-f="${f}" value="${val===null||val===undefined?'':esc(val)}"${ph?` placeholder="${ph}"`:''}></div>`:`<div class="field"><span class="lbl">${label}</span><span>${val===null||val===undefined||val===''?dealNoData('цена'):esc(val)}</span></div>`;
  return `<li class="dline"><div class="dl-h"><div class="dl-n"><b>${esc(name)}</b>${p?skuTag(p):''}${info}</div>${edit?`<button type="button" class="btn ghost icon sm" data-act="deal-del-i" data-id="${id}" data-i="${i}" aria-label="Убрать строку «${esc(name)}»">${ic('x')}</button>`:''}</div>
    <div class="dl-in">${numf('qty','Кол-во',it.qty)}${pr?`${numf('price','Цена, ₽',typeof it.price==='number'?it.price:null,'нет данных: цена')}${numf('disc','Скидка, %',it.disc||0)}<div class="field"><span class="lbl">Сумма</span><output class="dl-sum" id="di-sum-${i}">${esc(dealLineSum(it))}</output></div>`:''}</div>
    <div class="dl-f">${pr?`<span id="di-src-${i}">${dealPriceSrc(it)}</span>`:''}${res}${btn}</div></li>`;
}
// Результаты поиска по каталогу: сначала то, что есть в каталоге; цена и свободный остаток видны сразу
function dealFound(d,q){
  const query=String(q||'').trim();
  if(query.length<2) return '<p class="hint">Введите хотя бы две буквы названия, бренда или артикула.</p>';
  const list=Catalog.query(S,{q:query}).sort((a,b)=>(b.inCatalog?1:0)-(a.inCatalog?1:0)).slice(0,8);
  const make=pqLink('deal',`Создать «${query}» в каталоге и добавить в сделку`,{id:d.id,name:query});
  if(!list.length) return `<p class="hint">В каталоге такого нет. Можно создать товар или добавить свою строку ниже.</p>${make}`;
  const pr=can('prices');
  return list.map(p=>{const k=stockOf(p.id);return `<button type="button" class="dpr" data-act="deal-add-p" data-id="${esc(d.id)}" data-pid="${esc(p.id)}"><span class="dpr-n">${esc(p.name)}</span><small>${esc(skuText(p))} · ${pr?(typeof p.price==='number'?rub(p.price):'нет данных: цена')+' · ':''}${k.known?'свободно '+qtyOf(Math.max(0,k.free),p):'остаток: нет данных'}${p.inCatalog?'':' · нет в каталоге'}</small>${ic('plus')}</button>`}).join('')+make;
}
function dealItems(d,edit){
  const pr=can('prices'),items=d.items||[],id=esc(d.id);
  const add=edit?`<div class="stack-s"><div class="field"><label for="deal-ps">Добавить товар из каталога</label><input id="deal-ps" class="inp" type="search" placeholder="Название, бренд или артикул" data-on="deal-ps" data-id="${id}" autocomplete="off"></div><div id="deal-pres" class="dpres">${dealFound(d,'')}</div>
    <form class="rform" data-form="deal-own" data-id="${id}" novalidate><p class="sh">Своя строка — не из каталога</p><div class="grid2"><div class="field span2"><label for="do-name">Название</label><input id="do-name" class="inp" placeholder="Например: монтаж и пусконаладка" autocomplete="off"></div><div class="field"><label for="do-qty">Кол-во</label><input id="do-qty" class="inp" type="number" min="0" step="any" value="1" inputmode="decimal"></div>${pr?'<div class="field"><label for="do-price">Цена, ₽</label><input id="do-price" class="inp" type="number" min="0" step="any" placeholder="нет данных: цена" inputmode="decimal"></div>':''}</div><p class="err" id="do-err" hidden></p><div><button type="submit" class="btn">${ic('plus')}Добавить строку</button></div></form></div>`:'';
  const total=pr?`<div class="dtot"><span>Итого</span><b id="di-total">${rub(Deals.total(d))}</b></div><p class="hint" id="di-warn">${esc(dealTotalText(d))}</p>`:`<p class="lock">${ic('lock')}Цены и суммы скрыты для вашей роли.</p>`;
  return `<div class="stack-s">${items.length?`<ul class="dlines">${items.map((it,i)=>dealLine(d,it,i,edit,pr)).join('')}</ul>`:'<p class="muted m0">Товаров в сделке пока нет.</p>'}${total}${add}
    <p class="hint">Свободно — остаток за вычетом резервов, ${esc(stockNote())}. Цена по умолчанию — ${esc(priceNote())}; скидка считается от цены строки.</p></div>`;
}

// ——— коммерческое предложение ———
// Страница для печати. Реквизитов фирмы и срока действия в системе нет: на месте — «нет данных: …».
// Логотип подставляет обработчик кнопки «КП» (вид не трогает документ).
function dealKp(d){
  const items=d.items||[],mgr=person(d.managerId),c=Clients.byId(S,d.clientId),now=new Date();
  const when=`${now.getDate()} ${MONF[now.getMonth()]} ${now.getFullYear()} г.`;
  const rows=items.map((it,i)=>`<tr><td>${i+1}</td><td>${esc(Deals.itemName(S,it))}${it.productId&&product(it.productId)?skuTag(product(it.productId)):''}</td><td class="num">${num(it.qty)}</td><td class="num">${typeof it.price==='number'?rub(it.price):'нет данных: цена'}</td><td class="num">${it.disc?num(it.disc)+' %':'0 %'}</td><td class="num">${esc(dealLineSum(it))}</td></tr>`).join('');
  const np=Deals.noPrice(d).length;
  return `<div class="kp" id="kp">
    <div class="kp-top"><span class="logo" id="kp-logo"></span><div class="kp-t"><h2>Коммерческое предложение</h2><p>№ ${esc(d.id)} · ${esc(when)}</p></div></div>
    <dl class="kp-kv"><dt>Исполнитель</dt><dd>нет данных: реквизиты фирмы (название, ИНН, адрес, банк)</dd>
      <dt>Заказчик</dt><dd>${esc(d.client)}${c&&c.inn?', ИНН '+esc(c.inn):''}</dd>
      <dt>Контакт</dt><dd>${dealVal(d.contact)?esc(d.contact):'нет данных: контакт'}${d.phone?', '+esc(d.phone):''}${d.email?', '+esc(d.email):''}</dd>
      ${dealVal(d.object)?`<dt>Предмет</dt><dd>${esc(d.object)}</dd>`:''}</dl>
    ${items.length?`<div class="xs"><table class="tbl kp-tbl"><thead><tr><th>№</th><th>Наименование</th><th class="num">Кол-во</th><th class="num">Цена</th><th class="num">Скидка</th><th class="num">Сумма</th></tr></thead><tbody>${rows}</tbody></table></div>`:'<p class="muted">В сделке нет товаров: добавьте строки на вкладке «Товары».</p>'}
    <p class="kp-tot"><span>Итого</span><b>${rub(Deals.total(d))}</b></p>
    ${np?`<p class="hint">В итог не вошли строки без цены: ${np}.</p>`:''}
    <dl class="kp-kv"><dt>Срок действия</dt><dd>нет данных: срок действия предложения</dd><dt>Менеджер</dt><dd>${mgr?esc(mgr.name)+', '+esc(roleName(mgr)):'нет данных: менеджер'}</dd><dt>Дата</dt><dd>${esc(when)}</dd></dl>
  </div>`;
}
MODALS.dealKp=id=>{
  const d=Leads.dealsVisible(S,S.me).find(x=>x.id===id);
  return `${mHead('Коммерческое предложение '+esc(id))}<div class="modal-b">${d&&can('prices')?dealKp(d):'<p class="m0">Коммерческое предложение недоступно: нужна сделка, которую вы видите, и право видеть цены.</p>'}</div>
    <div class="modal-f no-print"><button type="button" class="btn" data-act="close-modal">Закрыть</button><button type="button" class="btn pri" data-act="deal-print">${ic('print')}Печать</button></div>`;
};

// ——— окна «Провалена» и «Зарезервировать» ———
MODALS.dealLose=id=>{
  const d=Deals.byId(S,id),why=Deals.reasons(S),held=d?Deals.reservesOf(S,d).length:0;
  return `<form data-form="deal-lose" data-id="${esc(id)}" novalidate>${mHead('Провалена: сделка '+esc(id))}<div class="modal-b">
    <p class="m0">${d?esc(d.client):''}</p>
    <div class="field"><label for="dl-reason">Причина отказа</label>${why.length?`<select id="dl-reason" class="inp">${why.map(r=>`<option value="${esc(r)}">${esc(r)}</option>`).join('')}</select>`:'<input id="dl-reason" class="inp" placeholder="Напишите причину" autocomplete="off">'}</div>
    <div class="field"><label for="dl-note">Комментарий (необязательно)</label><textarea id="dl-note" class="inp" rows="3" placeholder="Что именно сказал клиент"></textarea></div>
    <p class="hint">Сделка уйдёт из колонок в фильтр «Провалены», этап останется тем, где она сорвалась. Причина и комментарий запишутся в ленту; сделку можно вернуть в работу.</p>
    ${held?`<p class="hint">Резервы сделки (${held}) будут сняты, товар вернётся в свободный остаток. При возврате в работу резервы придётся поставить заново.</p>`:''}
    <p class="err" id="dl-err" hidden></p></div>${mFoot('Провалена')}</form>`;
};
// Ключ строки в окне резерва: «Д-301:0»
MODALS.dealReserve=key=>{
  const [did,i]=String(key).split(':'),d=Deals.byId(S,did),it=d&&(d.items||[])[+i],p=it&&it.productId?product(it.productId):null;
  if(!d||!it||!p) return `${mHead('Резерв')}<div class="modal-b"><p class="m0">Строка не найдена или это своя строка — резервировать нечего.</p></div>`;
  const held=Deals.reserved(S,d,p.id),all=Deals.lined(d,p.id),left=Deals.left(S,d,p.id),cell=Stock.bestCell(S,p.id),k=stockOf(p.id);
  const opt=(list,none,cur)=>[...list.map(x=>[x.id,x.name]),[Stock.ANY,none]].map(([v,n])=>`<option value="${esc(v)}"${v===cur?' selected':''}>${esc(n)}</option>`).join('');
  return `<form data-form="deal-reserve" data-id="${esc(did)}" data-i="${+i}" novalidate>${mHead('Зарезервировать: '+esc(Catalog.label(p)))}<div class="modal-b">
    <p class="m0">Сделка ${esc(did)} · ${esc(d.client)}. ${all!==it.qty?`В сделке по этому товару ${qtyOf(all,p)} (в этой строке ${num(it.qty)})`:`В строке ${qtyOf(it.qty,p)}`}, уже в резерве ${num(held)}, осталось ${qtyOf(left,p)}. Свободно на складе: ${k.known?qtyOf(Math.max(0,k.free),p):'нет данных'} (${esc(stockNote())}).</p>
    <div class="grid2"><div class="field"><label for="dr-ent">Юрлицо</label><select id="dr-ent" class="inp" data-on="deal-rs" data-pid="${esc(p.id)}">${opt(S.entities,Stock.NO_ENTITY,cell.entityId)}</select></div><div class="field"><label for="dr-city">Город</label><select id="dr-city" class="inp" data-on="deal-rs" data-pid="${esc(p.id)}">${opt(S.cities,Stock.NO_CITY,cell.cityId)}</select></div>
      <div class="field"><label for="dr-qty">Сколько</label><input id="dr-qty" class="inp" type="number" min="1" step="any" value="${esc(left)}" inputmode="decimal"></div><div class="field"><label for="dr-until">Резерв до</label><input id="dr-until" class="inp" type="date" value="${iso(day(Stock.RESERVE_DAYS))}"></div></div>
    <p class="hint" id="dr-max">${esc(maxText(p.id,'stock',cell.entityId,cell.cityId))}</p>
    <p class="err" id="dr-err" hidden></p></div>${mFoot('Зарезервировать')}</form>`;
};

// ——— действия: каждое — запись в ленту (ядро) и короткое подтверждение ———
const dealById=id=>Deals.byId(S,id);
// Перерисовать только тело раздела (счёт и доску) — правка в карточке не сбрасывает фокус в её полях
function dealsRefresh(){const box=byId('deal-body');if(box) box.innerHTML=dealsBody()}
// Выполнить действие ядра: отказ — понятная причина, успех — перерисовка и подтверждение
function dealRun(r,done){
  if(!r.ok){toast(r.reason,'warn');return null}
  render();toast(done);return r;
}
// Перевести сделку на этап: из доски (перетаскивание) и из полосы этапов. Последний этап — «Успешно» (решает Deals.move)
function dealMoveTo(id,stageId){
  const d=dealById(id),to=d&&Pipes.stage(S,d.pipeId,stageId);
  if(!d||!to||to.id===d.stageId) return null;
  const r=Deals.move(S,id,stageId,S.me,new Date());
  return dealRun(r,to.flag==='final'?`Сделка ${id} закрыта успешно: этап «${to.name}». Запись в ленте есть.`:`Сделка ${id} теперь на этапе «${to.name}». Запись в ленте есть.`);
}

A['open-deal']=el=>{S.ui.dealTab='details';openDrawer('deal',el.dataset.id)};
A['open-client']=el=>openDrawer('client',el.dataset.id);
A['deal-type']=el=>{S.ui.dealType=el.dataset.type==='b2c'?'b2c':'b2b';render()};
A['deal-view']=el=>{dealsU().view=el.dataset.v==='table'?'table':'board';render()};
A['deal-mine']=()=>{const u=dealsU();u.mine=!u.mine;render()};
A['deal-lostf']=()=>{const u=dealsU();u.lost=!u.lost;render()};
A['deal-acts']=el=>{const u=dealsU();u.acts=u.acts===el.dataset.k?'':el.dataset.k;render()};
A['deal-reset']=()=>{S.ui.deals=Object.assign({},DEALS_DEF,{view:dealsSel().view});render()};
A['deal-new']=el=>{if(!can('dealsEdit')) return toast('Заводить сделки могут те, у кого есть право «Заводить и править сделки».','warn');openModal('dealNew',el.dataset.stage||'')};
A['deal-tab']=el=>{S.ui.dealTab=el.dataset.tab;render()};
A['deal-stage']=el=>dealMoveTo(el.dataset.id,el.dataset.st);
A['deal-win']=el=>dealRun(Deals.win(S,el.dataset.id,S.me,new Date()),`Сделка ${el.dataset.id} закрыта успешно. Запись в ленте есть.`);
A['deal-lose']=el=>{
  const d=dealById(el.dataset.id);if(!d) return;
  if(!Deals.canEdit(S,d,S.me)){toast('У вас нет права править эту сделку.','warn');return}
  if(Deals.state(S,d)==='won'){toast('Сделка успешно закрыта — провалить её нельзя, сначала верните на другой этап.','warn');return}
  openModal('dealLose',d.id);
};
A['deal-reopen']=el=>{
  const r=Deals.reopen(S,el.dataset.id,S.me,new Date());
  dealRun(r,`Сделка ${el.dataset.id} возвращена в работу. Запись в ленте есть.${r.released?' '+Deals.RELEASED_NOTE:''}`);
};
A['deal-kp']=el=>{
  openModal('dealKp',el.dataset.id);
  // логотип — тот же, что в боковом меню (картинка в странице одна)
  const box=byId('kp-logo'),src=document.querySelector('.brand .logo img');
  if(box&&src) box.innerHTML=`<img src="${esc(src.getAttribute('src'))}" alt="wind-solar" width="1393" height="384">`;
};
// «Создать отправку»: форма заявки (openDispatchNew, 69-dispatch.js) с данными сделки — клиент, телефон, адрес клиента
// (нет в карточке клиента — пусто, не выдумываем), товары сделки и dealId. Телефон — сделки, а нет его — первый у клиента.
function dealDispatchPre(d){
  const c=Clients.byId(S,d.clientId);
  return {purpose:'sale',dealId:d.id,to:{name:c?c.name:d.client,phone:dealVal(d.phone)||(c&&(c.phones||[])[0])||''},address:(c&&c.address)||'',
    items:(d.items||[]).map(it=>it.productId?{productId:it.productId,qty:it.qty}:{text:it.text,qty:it.qty})};
}
A['deal-dispatch']=el=>{const d=dealById(el.dataset.id);if(d) openDispatchNew(dealDispatchPre(d))};
A['deal-print']=()=>{if(typeof window!=='undefined'&&typeof window.print==='function') window.print()};
A['deal-add-p']=el=>{
  const id=el.dataset.id,r=Deals.addItem(S,id,{productId:el.dataset.pid},S.me,new Date());
  if(!r.ok){toast(r.reason,'warn');return}
  render();toast(`В сделку ${id} добавлено: ${Deals.itemLabel(S,dealById(id).items[r.idx])}. Количество и цену можно поправить в строке.`);
};
A['deal-del-i']=el=>{
  const id=el.dataset.id,d=dealById(id),it=d&&(d.items||[])[+el.dataset.i];
  if(!it){toast('Такой строки нет.','warn');return}
  const name=Deals.itemLabel(S,it);
  dealRun(Deals.removeItem(S,id,+el.dataset.i,S.me,new Date()),`Строка «${name}» убрана из сделки ${id}.`);
};
A['deal-res']=el=>{
  if(!can('reserve')){toast('У вашей роли нет права ставить резервы.','warn');return}
  openModal('dealReserve',el.dataset.id+':'+el.dataset.i);
};
A['deal-unres']=el=>{
  const id=el.dataset.id,rs=S.reserves.find(r=>r.id===el.dataset.rid),p=rs&&product(rs.productId);
  dealRun(Deals.unreserve(S,id,el.dataset.rid,S.me,new Date()),`Резерв снят${p?`: ${low(Catalog.label(p))} — ${qtyOf(rs.qty,p)}`:''}. Товар снова свободен.`);
};

// ——— поля ———
ON.input['deal-q']=t=>{dealsU().q=t.value;dealsRefresh()};
ON.change['deal-pipe']=t=>{S.ui.dealPipe=t.value;render()};
// Поле «Деталей»: одно поле — одна правка Deals.update. Выбор из списка перерисовывает всё (сделка могла сменить воронку),
// текст — только доску за карточкой, чтобы не сбить ввод в соседнем поле.
ON.change['deal-f']=t=>{
  const id=t.dataset.id,f=t.dataset.f,r=Deals.update(S,id,{[f]:t.value},S.me,new Date());
  if(!r.ok){toast(r.reason,'warn');render();return}
  if(!r.changed.length) return;
  if(t.tagName==='SELECT') render();else dealsRefresh();
  toast(`Сделка ${id}: «${DEAL_FIELD[f]||f}» сохранено. Запись в ленте есть.`);
};
// Количество, цена, скидка строки: после правки обновляются сумма строки и итог на месте
function dealItemSync(d){
  (d.items||[]).forEach((it,i)=>{
    const s=byId('di-sum-'+i),src=byId('di-src-'+i);
    if(s) s.textContent=dealLineSum(it);
    if(src) src.innerHTML=dealPriceSrc(it);
  });
  const tot=byId('di-total'),w=byId('di-warn');
  if(tot) tot.textContent=rub(Deals.total(d));
  if(w) w.textContent=dealTotalText(d);
}
ON.change['deal-i']=t=>{
  const id=t.dataset.id,i=+t.dataset.i,f=t.dataset.f,d=dealById(id),it=d&&(d.items||[])[i];
  const r=Deals.setItem(S,id,i,{[f]:t.value},S.me,new Date());
  if(!r.ok){toast(r.reason,'warn');if(it) t.value=it[f]===null||it[f]===undefined?'':it[f];return}
  dealItemSync(d);dealsRefresh();
  toast(`Строка ${i+1} сделки ${id} сохранена.${can('prices')?` Итого: ${rub(Deals.total(d))}.`:''}`);
};
ON.input['deal-ps']=t=>{const d=dealById(t.dataset.id),box=byId('deal-pres');if(d&&box) box.innerHTML=dealFound(d,t.value)};
// Окно «Новая сделка»: выбранный клиент подставляет телефон, контакт и тип; для нового клиента открыты его поля
// Подсказка «Похоже, это …» (clientDupHtml, 70-clients.js) — только для нового клиента: у выбранного из списка телефон его собственный
function dealDupSync(){
  const box=byId('dn-dup');if(!box) return;
  const r=document.querySelector('#dn-cres input[name="dn-c"]:checked'),isNew=!r||r.value==='new';
  box.innerHTML=isNew?clientDupHtml({phone:byId('dn-phone').value,email:byId('dn-email').value,inn:byId('dn-inn').value}):'';
}
function dealPickSync(){
  dealDupSync();
  const r=document.querySelector('#dn-cres input[name="dn-c"]:checked'),nw=byId('dn-new');
  if(!r||!nw) return;
  const c=r.value==='new'?null:Clients.byId(S,r.value);
  nw.hidden=!!c;
  if(!c) return;
  const put=(id,v)=>{const el=byId(id);if(el&&(!el.value||el.value===el.dataset.auto)){el.value=v;el.dataset.auto=v}};
  put('dn-phone',(c.phones||[])[0]||'');
  put('dn-contact',c.kind==='person'?c.name:'');
  const tp=byId('dn-type'),want=c.kind==='company'?'b2b':'b2c';
  if(tp&&[...tp.options].some(o=>o.value===want)) tp.value=want;
}
ON.input['deal-cq']=t=>{const box=byId('dn-cres');if(!box) return;box.innerHTML=dealClientOpts(t.value,'');dealPickSync()};
ON.change['deal-cs']=()=>dealPickSync();
ON.input['deal-dup']=()=>dealDupSync();
ON.change['deal-rs']=t=>{
  const out=byId('dr-max');
  if(out) out.textContent=maxText(t.dataset.pid,'stock',byId('dr-ent').value,byId('dr-city').value);
};

// ——— формы ———
FORMS['feed-comment']=feedCommentForm;
feedWire();
FORMS['deal-new']=f=>{
  const {types}=dealsScope(),type=byId('dn-type').value,now=new Date();
  const radio=document.querySelector('#dn-cres input[name="dn-c"]:checked'),cid=radio?radio.value:'new';
  if(!types.includes(type)) return showErr('dn-err','Выберите тип сделки.');
  if(!dealPipe(type,S)) return showErr('dn-err','Для этого типа нет воронки сделок.');
  let client=cid==='new'?null:Clients.byId(S,cid);
  if(cid!=='new'&&!client) return showErr('dn-err','Такого клиента нет — выберите другого.');
  if(!client){
    const name=byId('dn-cname').value.trim();
    if(!name) return showErr('dn-err','Напишите имя клиента или название компании — или выберите клиента из списка.');
    const inn=byId('dn-inn').value.trim();
    const cr=Clients.create(S,{name,kind:inn||type==='b2b'?'company':'person',phone:byId('dn-phone').value,email:byId('dn-email').value,inn,managerId:byId('dn-mgr').value||undefined},S.me,now);
    if(!cr.ok) return showErr('dn-err',cr.reason);
    client=cr.client;
  }
  const r=Deals.create(S,{clientId:client.id,type,managerId:byId('dn-mgr').value||undefined,contact:byId('dn-contact').value,phone:byId('dn-phone').value,object:byId('dn-obj').value,channel:byId('dn-ch').value},S.me,now);
  if(!r.ok) return showErr('dn-err',r.reason);
  // «+» в шапке колонки: сделка встаёт на этот этап (того же типа; иначе остаётся на первом)
  const to=f.dataset.stage,d=dealById(r.id);
  if(to&&d.stageId!==to&&Pipes.stage(S,d.pipeId,to)) Deals.move(S,r.id,to,S.me,now);
  closeModal();
  S.ui.dealType=type;S.ui.dealPipe=d.pipeId;S.ui.dealTab='details';
  render();openDrawer('deal',r.id);
  toast(`Сделка ${r.id} заведена: ${client.name}, этап «${stageName(d)}». Запись в ленте есть.`);
};
FORMS['deal-lose']=f=>{
  const id=f.dataset.id,why=byId('dl-reason').value.trim(),note=byId('dl-note').value.trim(),now=new Date();
  if(!why) return showErr('dl-err','Выберите или напишите причину отказа.');
  const r=Deals.lose(S,id,why,S.me,now);
  if(!r.ok) return showErr('dl-err',r.reason);
  if(note) Feed.comment(S,{t:'deal',id},note,S.me,now);
  closeModal();render();
  toast(`Сделка ${id} провалена: ${why}. Причина записана в ленту.${r.released?` Снято резервов: ${r.released}, товар вернулся в свободный остаток.`:''}`);
};
FORMS['deal-reserve']=f=>{
  const id=f.dataset.id,i=+f.dataset.i,until=byId('dr-until').value;
  if(!until||dd(fromIso(until))<0) return showErr('dr-err','Дата окончания резерва не может быть в прошлом.');
  const r=Deals.reserveItem(S,id,i,{entityId:byId('dr-ent').value,cityId:byId('dr-city').value,qty:byId('dr-qty').value,until:fromIso(until)},S.me,new Date());
  if(!r.ok) return showErr('dr-err',r.reason);
  const p=product(r.reserve.productId);
  closeModal();render();
  toast(`Резерв поставлен: ${low(Catalog.label(p))} — ${qtyOf(r.reserve.qty,p)} для ${id}. Склад и директор получили уведомление.`);
};
FORMS['deal-own']=f=>{
  const id=f.dataset.id,price=byId('do-price'),raw={text:byId('do-name').value,qty:byId('do-qty').value};
  if(price) raw.price=price.value;
  const r=Deals.addItem(S,id,raw,S.me,new Date());
  if(!r.ok) return showErr('do-err',r.reason);
  render();toast(`В сделку ${id} добавлена своя строка: ${raw.text.trim()}.`);
};

// драг и дроп: колонки доски сделок — data-dcol (задачи в оболочке — data-col, лиды — data-lcol, они не пересекаются)
document.addEventListener('dragover',e=>{
  const col=e.target.closest?.('[data-dcol]');if(!col) return;
  e.preventDefault();
  document.querySelectorAll('.col.drop').forEach(x=>{if(x!==col) x.classList.remove('drop')});col.classList.add('drop');
});
document.addEventListener('drop',e=>{
  const col=e.target.closest?.('[data-dcol]');if(!col) return;
  e.preventDefault();col.classList.remove('drop');
  const id=e.dataTransfer.getData('text/plain');
  if(id&&dealById(id)) dealMoveTo(id,col.dataset.dcol);
});

// ——— регистрация в реестрах оболочки ———
VIEWS.deals=vDeals;
// счётчик в меню: мои дела по сделкам на сегодня и просроченные (Acts.counts)
Object.assign(NAV.find(n=>n.id==='deals'),{badge:()=>actsBadge('deal'),hot:true});
SEARCH.push({kind:'deal',label:'Сделка',order:20,find:q=>!can('clients')?[]:Leads.dealsVisible(S,S.me).filter(d=>searchHas(q,d.client,d.id,d.object)).map(d=>({title:d.client,sub:`${d.id} · ${d.object}`,open:`data-act="open-deal" data-id="${esc(d.id)}"`}))});
DRAWERS.deal=id=>{const d=Leads.dealsVisible(S,S.me).find(x=>x.id===id);return d?dealCard(d):null};
regRef('deal','сделка',id=>!!deal(id),'open-deal');
