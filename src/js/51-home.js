// Раздел «Сегодня»
// Перенесено из прототипа v2; «я» — человек S.me, «готово/закрыто» — флаг final этапа.

// ——— «Сегодня» ———
function vHome(){
  const m=me(),hr=new Date().getHours();
  const g=hr<5?'Доброй ночи':hr<12?'Доброе утро':hr<18?'Добрый день':'Добрый вечер';
  let h=`<div class="hello"><h2>${g}, ${esc(m.name.split(' ')[0])}</h2><p>${cap(WDF[T0.getDay()])}, ${T0.getDate()} ${MONF[T0.getMonth()]} · ${esc(roleName(m))}</p></div>`;
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
  const act=S.deals.filter(d=>!isDone(d)),total=sum(act,d=>d.amount||0);
  const tile=(l,v,s,c,view)=>`<button class="kpi" data-act="go" data-view="${view}"><span class="k-l">${l}</span><b class="k-v">${v}</b><span class="k-s ${c}">${s}</span></button>`;
  return `<div class="kpis">${[
    tile('Задачи в работе',open.length,over.length?`${over.length} ${pl(over.length,'просрочена','просрочены','просрочено')}`:'просроченных нет',over.length?'bad':'ok','tasks'),
    tile('Поставок в пути',inT.length,late.length?`${late.length} ${pl(late.length,'задерживается','задерживаются','задерживаются')}`:'все по графику',late.length?'warn':'ok','logistics'),
    tile('Позиций в резерве',S.reserves.length,`по ${rd.size} ${pl(rd.size,'сделке','сделкам','сделкам')}`,'','stock'),
    tile('Сделок в работе',act.length,can('prices')?`на ${mln(total)}`:'суммы скрыты для роли','','clients')
  ].join('')}</div>`;
}
function weekHtml(){
  const act=S.shipments.filter(s=>!isDone(s)),late=act.filter(isLate);
  const chip=s=>`<button class="wchip ${s.dir} ${isLate(s)?'late':''}" data-act="go" data-view="logistics" data-tab="${s.dir}"><b class="mono">${s.id}</b><span>${s.dir==='in'?'приход':'отгрузка'} · ${esc(shortItems(s))}</span></button>`;
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
    S.shipments.filter(isLate).forEach(s=>a.push({lvl:'warn',icon:'truck',text:`${s.id} задерживается на ${days(-dd(s.eta))}`,sub:`Последняя отметка: ${shipLast(s).text}`,act:'data-act="go" data-view="logistics"'}));
    S.products.forEach(p=>{
      const fa=freeAfter(p);
      if(fa<0) a.push({lvl:'bad',icon:'box',text:`${p.name}: под резервы не хватает ${num(-fa)} ${p.unit}`,sub:'Даже с учётом всех поставок в пути',act:`data-act="open-product" data-sku="${p.sku}"`});
      else if(p.stock>0&&freeNow(p)<=0&&!incomingQty(p.sku)) a.push({lvl:'warn',icon:'box',text:`${p.name}: свободный остаток закончился`,sub:'Всё, что на складе, в резерве. Поставок нет',act:`data-act="open-product" data-sku="${p.sku}"`});
    });
    S.reserves.filter(r=>{const n=dd(r.until);return n>=0&&n<=2}).forEach(r=>{const p=product(r.productId),d=deal(r.dealId);a.push({lvl:'info',icon:'clock',text:`Резерв истекает ${fRel(r.until)}: ${p.name} — ${num(r.qty)} ${p.unit}`,sub:`${r.dealId} · ${d?.client||''}`,act:`data-act="open-product" data-sku="${p.sku}"`})});
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
  return `<section class="card"><div class="card-h"><h3>Мои задачи</h3><button class="btn sm" data-act="new-task">${ic('plus')}Поставить задачу</button></div>${list.length?`<ul class="list">${list.map(t=>`<li><button class="li" data-act="open-task" data-id="${t.id}"><span class="tdot ${esc(t.stageId)}"></span><span class="li-t">${esc(t.title)}<small>${taskMine(t)?'Мне':'От меня → '+esc(targetName(t))} · ${esc(stageName(t))}</small></span><span class="due ${dd(t.due)<0?'bad':''}">${fRel(t.due)}</span></button></li>`).join('')}</ul>`:'<p class="empty">Открытых задач нет.</p>'}</section>`;
}
function eventsHtml(){
  const all=can('firm');
  const list=S.notes.filter(n=>all||n.to.includes(S.me)).slice(0,7);
  const un=new Set(unread().map(n=>n.id));
  return `<section class="card"><div class="card-h"><h3>${all?'События по фирме':'Мои уведомления'}</h3><button class="btn sm ghost" data-act="go" data-view="notifications">Все ${ic('arrow')}</button></div>${list.length?`<ul class="notes">${list.map(n=>noteRow(n,un.has(n.id))).join('')}</ul>`:'<p class="empty">Пока ничего нет.</p>'}</section>`;
}
