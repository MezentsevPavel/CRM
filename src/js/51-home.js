// Раздел «Сегодня»: «что сделать сегодня» — свой у каждой роли.
// Сверху плитки дня (homeTiles): каждое число — вызов ядра, своих копий расчёта здесь нет — Ships.awaitingReceipt,
// Leads.fresh, Stock.expired, Dispatch.query, Acts.counts и Acts.noNext, Deals.sumOf, taskCounts (52-tasks.js).
// Плитку роли, которой она не нужна, не показываем; нулевая плитка спокойная. Нажатие открывает список с нужным фильтром.
// Ниже — сводка по фирме (директор), неделя, «Требует внимания», мои задачи и события.

// ——— «Сегодня» ———
// ——— плитки дня ———
// Реестр плиток: {id, label, show, calc → {value, sub, tone, …}, open}. tone '' · 'bad' (просрочено) · 'warn' (нужно действие).
const homeOpenDeals=()=>Leads.dealsVisible(S,S.me).filter(d=>Deals.state(S,d)==='open');
// Резервы с истёкшим сроком (Stock.expired) по сделкам, которые видит человек
const homeExpired=()=>{const vis=new Set(Leads.dealsVisible(S,S.me).map(d=>d.id));return Stock.expired(S,new Date()).filter(r=>vis.has(r.dealId))};
// Сделки без следующего шага: открытые видимые сделки, у которых Acts.noNext
const homeNoNext=()=>homeOpenDeals().filter(d=>Acts.noNext(S,{t:'deal',id:d.id}));
const homeIsDriver=()=>Dispatch.drivers(S).some(p=>p.id===S.me);
// Отправки на сегодня: открытые заявки с датой «сегодня»; водителю — только назначенные ему
const homeDispatch=()=>Dispatch.query(S,{today:true,now:new Date(),driver:homeIsDriver()?S.me:''}).filter(d=>!Pipes.isFinal(S,d.pipeId,d.stageId));
const homeTone=(n,tone)=>n>0?tone:'';
const HOME_TILES=[
  {id:'tasks',label:'Мои задачи на сегодня',show:()=>true,
    calc:()=>{const c=taskCounts(),v=c.today+c.overdue;return {value:v,today:c.today,overdue:c.overdue,sub:c.overdue?`просрочено: ${c.overdue}`:v?'просроченных нет':'на сегодня задач нет',tone:homeTone(c.overdue,'bad')}},
    open:()=>{const c=taskCounts();S.ui.taskF=c.overdue&&!c.today?'over':'mine';go('tasks')}},
  {id:'leads',label:'Новые лиды',show:()=>can('leads'),
    calc:()=>{const n=Leads.fresh(S,S.me).length;return {value:n,sub:n?'ждут первого шага':'новых лидов нет',tone:homeTone(n,'warn')}},
    open:()=>{const p=leadPipe();S.ui.leads=Object.assign({},LEAD_DEF,{view:'list',stage:p?Leads.firstOf(p).id:''});go('leads')}},
  {id:'receipt',label:'Поставки к приёмке',show:()=>can('receive')||can('logistics'),
    calc:()=>{const n=Ships.awaitingReceipt(S).length;return {value:n,sub:n?'приехали и ждут приёмки':'ничего не ждёт приёмки',tone:homeTone(n,'warn')}},
    open:()=>{
      if(can('receive')) return go('receiving');
      const p=shipPipe('in'),st=p&&p.stages.find(x=>x.flag==='arrived');
      S.ui.logTab='in';setShipUi({stage:st?st.id:'open',page:1});go('logistics');
    }},
  {id:'reserves',label:'Резервы с истёкшим сроком',show:()=>can('reserve'),
    calc:()=>{const n=homeExpired().length;return {value:n,sub:n?'снимите или продлите':'просроченных резервов нет',tone:homeTone(n,'bad')}},
    open:()=>go('stock')},
  {id:'dispatch',label:'Отправки на сегодня',show:()=>Dispatch.canWork(S,S.me),
    calc:()=>{const n=homeDispatch().length;return {value:n,sub:n?(homeIsDriver()?'назначены вам':'собираем и везём'):'на сегодня отправок нет',tone:''}},
    open:()=>{S.ui.dispatch=Object.assign({},DSP_DEF,{view:dspSel().view,today:true,driver:homeIsDriver()?S.me:''});go('dispatch')}},
  {id:'acts',label:'Мои дела на сегодня',show:()=>can('clients')||can('leads')||Dispatch.canWork(S,S.me),
    calc:()=>{const c=Acts.counts(S,S.me,new Date()),v=c.today+c.overdue;return {value:v,today:c.today,overdue:c.overdue,sub:c.overdue?`просрочено: ${c.overdue}`:v?'просроченных нет':'на сегодня дел нет',tone:homeTone(c.overdue,'bad')}},
    open:()=>{
      if(!can('clients')) return go(can('leads')?'leads':'dispatch');
      const c=Acts.counts(S,S.me,new Date());
      S.ui.deals=Object.assign({},DEALS_DEF,{view:dealsSel().view,acts:c.overdue?'overdue':''});go('deals');
    }},
  {id:'nonext',label:'Сделки без следующего шага',show:()=>can('leads')||can('firm'),
    calc:()=>{const n=homeNoNext().length;return {value:n,sub:n?'запланируйте дело':'у всех сделок есть следующий шаг',tone:homeTone(n,'warn')}},
    open:()=>{S.ui.deals=Object.assign({},DEALS_DEF,{view:dealsSel().view,acts:'none'});go('deals')}}
];
// Плитки, нужные этой роли: [{id, label, value, sub, tone, …}] в порядке реестра
const homeTiles=()=>HOME_TILES.filter(t=>t.show()).map(t=>Object.assign({id:t.id,label:t.label},t.calc()));
function todayHtml(){
  const list=homeTiles();
  return `<section class="today" aria-label="Что сделать сегодня"><h3 class="today-h">Что сделать сегодня</h3><div class="tiles">${list.map(t=>`<button type="button" class="ttile${t.value?'':' calm'}${t.tone?' '+t.tone:''}" data-act="home-tile" data-tile="${esc(t.id)}"><span class="k-l">${esc(t.label)}</span><b class="k-v">${t.value}</b><span class="k-s">${esc(t.sub)}</span></button>`).join('')}</div></section>`;
}
A['home-tile']=el=>{const t=HOME_TILES.find(x=>x.id===el.dataset.tile);if(t&&t.show()) t.open()};

function vHome(){
  const m=me(),hr=new Date().getHours();
  const g=hr<5?'Доброй ночи':hr<12?'Доброе утро':hr<18?'Добрый день':'Добрый вечер';
  let h=`<div class="hello"><h2>${g}, ${esc(m.name.split(' ')[0])}</h2><p>${cap(WDF[T0.getDay()])}, ${T0.getDate()} ${MONF[T0.getMonth()]} · ${esc(roleName(m))}</p></div>`;
  h+=todayHtml();
  if(can('firm')) h+=kpiHtml();
  if(can('stock')) h+=weekHtml();
  const L=[];
  if(can('stock')||can('firm')) L.push(attnHtml());
  L.push(myTasksHtml());
  h+=`<div class="home-grid"><div class="stack">${L.join('')}</div><div class="stack">${eventsHtml()}</div></div>`;
  return h;
}
function kpiHtml(){
  const open=S.tasks.filter(t=>!isDone(t)),over=open.filter(taskOverdue);
  const inT=openIn(),late=S.shipments.filter(isLate);
  const rd=new Set(S.reserves.map(r=>r.dealId));
  const act=S.deals.filter(d=>Deals.state(S,d)==='open'),total=Deals.sumOf(act);
  const tile=(l,v,s,c,view)=>`<button class="kpi" data-act="go" data-view="${view}"><span class="k-l">${l}</span><b class="k-v">${v}</b><span class="k-s ${c}">${s}</span></button>`;
  return `<div class="kpis">${[
    tile('Задачи в работе',open.length,over.length?`${over.length} ${pl(over.length,'просрочена','просрочены','просрочено')}`:'просроченных нет',over.length?'bad':'ok','tasks'),
    tile('Поставок в пути',inT.length,late.length?`${late.length} ${pl(late.length,'задерживается','задерживаются','задерживаются')}`:'все по графику',late.length?'warn':'ok','logistics'),
    tile('Позиций в резерве',S.reserves.length,`по ${rd.size} ${pl(rd.size,'сделке','сделкам','сделкам')}`,'','stock'),
    tile('Сделок в работе',act.length,can('prices')?`на ${mln(total)}`:'суммы скрыты для роли','','deals')
  ].join('')}</div>`;
}
function weekHtml(){
  const act=S.shipments.filter(s=>!isDone(s)),late=act.filter(isLate);
  const chip=s=>`<button class="wchip ${s.dir} ${isLate(s)?'late':''}" data-act="open-ship" data-id="${esc(s.id)}"><b class="mono">${s.id}</b><span>${s.dir==='in'?'приход':'отгрузка'} · ${esc(shortItems(s))}</span></button>`;
  let cols='';
  if(late.length) cols+=`<div class="wd late"><div class="wd-h">Опаздывают<b>${late.length} ${pl(late.length,'поставка','поставки','поставок')}</b></div>${late.map(chip).join('')}</div>`;
  for(let i=0;i<7;i++){
    const d=day(i),list=act.filter(s=>!isLate(s)&&dd(s.eta)===i);
    cols+=`<div class="wd ${i===0?'today':''}"><div class="wd-h">${i===0?'Сегодня':i===1?'Завтра':WDF[d.getDay()]}<b>${d.getDate()} ${MON[d.getMonth()]}</b></div>${list.map(chip).join('')}</div>`;
  }
  return `<section class="card"><div class="card-h"><h3>Неделя: что приходит и что уезжает</h3><button class="btn sm ghost" data-act="go" data-view="logistics">Все перевозки ${ic('arrow')}</button></div><div class="card-b"><div class="xs"><div class="week" style="--n:${late.length?8:7}">${cols}</div></div></div></section>`;
}
function attention(){
  const a=[];
  S.tasks.filter(t=>taskOverdue(t)&&taskVisible(t)).forEach(t=>a.push({lvl:'bad',icon:'tasks',text:`Просрочена задача «${t.title}»`,sub:`${targetName(t)} · срок был ${fD(t.due)}`,act:`data-act="open-task" data-id="${t.id}"`}));
  if(can('stock')){
    S.shipments.filter(isLate).forEach(s=>a.push({lvl:'warn',icon:'truck',text:`${s.id} задерживается на ${days(-dd(s.eta))}`,sub:`Последняя отметка: ${shipLast(s).text}`,act:`data-act="open-ship" data-id="${esc(s.id)}"`}));
    S.products.forEach(p=>{
      const k=stockOf(p.id);
      if(k.freeAfter<0) a.push({lvl:'bad',icon:'box',text:`${p.name}: под резервы не хватает ${qtyOf(-k.freeAfter,p)}`,sub:'Даже с учётом всех поставок в пути',act:`data-act="open-product" data-pid="${esc(p.id)}"`});
      else if(k.onHand>0&&k.free<=0&&!k.incoming) a.push({lvl:'warn',icon:'box',text:`${p.name}: свободный остаток закончился`,sub:'Всё, что на складе, в резерве. Поставок нет',act:`data-act="open-product" data-pid="${esc(p.id)}"`});
    });
    Stock.expired(S,new Date()).forEach(r=>{const p=product(r.productId),d=deal(r.dealId);a.push({lvl:'bad',icon:'clock',text:`Срок резерва вышел: ${p?p.name:'нет данных: товар'} — ${qtyOf(r.qty,p)}`,sub:`${r.dealId} · ${d?.client||''} · был до ${fD(r.until)}`,act:`data-act="open-product" data-pid="${esc(r.productId)}"`})});
    S.reserves.filter(r=>{const n=dd(r.until);return n>=0&&n<=2}).forEach(r=>{const p=product(r.productId),d=deal(r.dealId);a.push({lvl:'info',icon:'clock',text:`Резерв истекает ${fRel(r.until)}: ${p.name} — ${qtyOf(r.qty,p)}`,sub:`${r.dealId} · ${d?.client||''}`,act:`data-act="open-product" data-pid="${esc(p.id)}"`})});
  }
  return a;
}
function attnHtml(){
  const a=attention();
  return `<section class="card"><div class="card-h"><h3>Требует внимания</h3>${a.length?`<span class="pill bad">${a.length}</span>`:''}</div>${a.length?`<ul class="list">${a.map(x=>`<li><button class="li ${x.lvl}" ${x.act}><span class="li-ic">${ic(x.icon)}</span><span class="li-t">${esc(x.text)}<small>${esc(x.sub)}</small></span></button></li>`).join('')}</ul>`:'<p class="empty">Всё спокойно: просрочек, задержек и нехватки товара нет.</p>'}</section>`;
}
function myTasksHtml(){
  const m=me();
  const list=S.tasks.filter(t=>!isDone(t)&&(taskMine(t)||t.from===m.id)).sort((a,b)=>a.due-b.due).slice(0,7);
  return `<section class="card"><div class="card-h"><h3>Мои задачи</h3><button class="btn sm" data-act="new-task">${ic('plus')}Поставить задачу</button></div>${list.length?`<ul class="list">${list.map(t=>`<li><button class="li" data-act="open-task" data-id="${t.id}"><span class="tdot ${taskDot(t)}"></span><span class="li-t">${esc(t.title)}<small>${taskMine(t)?'Мне':'От меня → '+esc(targetName(t))} · ${esc(stageName(t))}</small></span><span class="due ${dd(t.due)<0?'bad':''}">${fRel(t.due)}</span></button></li>`).join('')}</ul>`:emptyState('Открытых задач нет. Поставьте первую — кнопка «Поставить задачу».','Поставить задачу','new-task')}</section>`;
}
function eventsHtml(){
  const all=can('firm');
  const list=S.notes.filter(n=>all||n.to.includes(S.me)).slice(0,7);
  const un=new Set(unread().map(n=>n.id));
  return `<section class="card"><div class="card-h"><h3>${all?'События по фирме':'Мои уведомления'}</h3><button class="btn sm ghost" data-act="go" data-view="notifications">Все ${ic('arrow')}</button></div>${list.length?`<ul class="notes">${list.map(n=>noteRow(n,un.has(n.id))).join('')}</ul>`:'<p class="empty">Пока ничего нет.</p>'}</section>`;
}
