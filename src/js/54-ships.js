// Раздел «Поставки и перевозки»
// Перенесено из прототипа v2; этапы — воронка поставки (Pipes), «закрыта» — флаг final, «ждёт приёмки» — awaitsReceipt.

// ——— поставки и перевозки ———
function vLogistics(){
  const byEta=(a,b)=>a.eta-b.eta;
  const ins=S.shipments.filter(s=>s.dir==='in'&&!isDone(s)).sort(byEta),outs=S.shipments.filter(s=>s.dir==='out'&&!isDone(s)).sort(byEta);
  const done=S.shipments.filter(isDone).sort((a,b)=>shipLast(b).at-shipLast(a).at);
  const tab=S.ui.logTab,list=tab==='in'?ins:tab==='out'?outs:done;
  let h=`<div class="bar"><div class="seg">${[['in','Едут к нам',ins.length],['out','Отгрузки клиентам',outs.length],['done','Завершённые',done.length]].map(([k,l,c])=>`<button class="${tab===k?'on':''}" data-act="log-tab" data-tab="${k}">${l}<b>${c}</b></button>`).join('')}</div><span class="grow"></span>${can('logistics')?`<button class="btn pri" data-act="new-ship">${ic('plus')}Новая поставка</button>`:''}</div>`;
  if(!can('logistics')) h+=`<p class="hint">Этапы перевозки отмечает логист. Каждая отметка приходит вам уведомлением.</p>`;
  h+=list.length?`<div class="ships">${list.map(shipCard).join('')}</div>`:'<section class="card"><p class="empty">Здесь пока пусто.</p></section>';
  return h;
}
function shipCard(s){
  const stg=stagesFor(s),pos=stagePos(s),done=isDone(s),late=isLate(s),n=dd(s.eta),nm=esc(stageName(s)),L=shipLast(s);
  const pill=done?`<span class="pill ok">${nm}</span>`:late?'<span class="pill bad">Задерживается</span>':awaitsReceipt(s)?`<span class="pill sun">${nm}</span>`:`<span class="pill info">${nm}</span>`;
  const when=done?L.at:s.eta;
  const etaTxt=done?(s.received?'принято '+fT(s.received.at):'доставлено '+fT(L.at)):n>0?'через '+days(n):n===0?'сегодня'+(s.eta.getHours()?', к '+fT(s.eta):''):'опаздывает на '+days(-n);
  const waits=s.dir==='in'?[...byDeal(S.reserves.filter(r=>r.src===s.id)).keys()]:(s.deal?[s.deal]:[]);
  const items=s.items.map(it=>{const p=product(it.productId);const t=`${esc(p.name)} <b>× ${qtyOf(it.got??it.qty,p)}</b>`;return can('stock')?`<button class="chip" data-act="open-product" data-pid="${esc(it.productId)}">${t}</button>`:`<span class="chip">${t}</span>`}).join('');
  let w='';
  if(waits.length) w=`<div class="waits">${ic('users')}<span>${s.dir==='in'?'Ждут этот товар':'Для сделки'}: ${can('clients')?waits.map(id=>`<button class="link" data-act="open-deal" data-id="${id}">${id} · ${esc(deal(id)?.client||'')}</button>`).join(', '):waits.length+' '+pl(waits.length,'сделка','сделки','сделок')}</span></div>`;
  let ph='';
  if(s.received){const r=s.received;ph=`<div class="photos-row">${(r.urls.length?r.urls.map(u=>`<img src="${u}" alt="Фото приёмки">`):Array.from({length:r.photos},()=>`<span class="ph-ph">${ic('photo')}</span>`)).join('')}<small>${r.photos} фото · принял(а) ${esc(person(r.by)?.name||'')}${r.note?' · '+esc(r.note):''}</small></div>${unsavedNote(r)}`;}
  let f='';
  if(!done){
    const b=[];
    if(can('logistics')) b.push(`<button class="btn sm" data-act="stage" data-id="${s.id}">${ic('pin')}Отметить этап</button>`);
    if(can('receive')&&awaitsReceipt(s)) b.push(`<button class="btn sm pri" data-act="rcv-start" data-id="${s.id}">${ic('camera')}Принять на складе</button>`);
    if(b.length) f=`<div class="ship-f">${b.join('')}</div>`;
  }
  return `<article class="card ship ${late?'is-late':''}"><div class="ship-h"><div class="ship-id"><b class="mono">${s.id}</b>${pill}</div><div class="eta ${late?'bad-t':''}"><small>${done?'Закрыто':s.dir==='in'?'Ожидается на складе':'Доставка'}</small><b>${fD(when)}</b><span>${etaTxt}</span></div></div>
    <div class="route"><span>${esc(s.supplier)}</span>${ic('arrow')}<span>${esc(s.to)}</span></div>
    <div class="muted sm">${esc(s.carrier)} · <span class="mono">${esc(s.track)}</span></div>
    <ol class="steps" style="--n:${stg.length}">${stg.map((x,i)=>`<li class="${i<pos||done?'done':i===pos?'cur':''}"><span>${esc(x.name)}</span></li>`).join('')}</ol>
    <div class="lastm">${ic('pin')}<span>${esc(L.text)}<small>${fWhen(L.at)} · отметка: ${esc(person(L.by)?.name||'')}</small></span></div>
    <div class="items">${items}</div>${w}${ph}${f}</article>`;
}
