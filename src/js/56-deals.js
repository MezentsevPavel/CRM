// Раздел «Клиенты и сделки»
// Перенесено из прототипа v2; этапы — воронки сделок B2B и B2C (Pipes), «сдана» — флаг final.

// ——— клиенты и сделки ———
function dealGoods(d){
  const rs=S.reserves.filter(r=>r.dealId===d.id);
  if(!rs.length) return {lvl:'',text:'не зарезервирован'};
  const wait=rs.filter(r=>r.src!=='stock');
  if(wait.some(r=>freeAfter(product(r.productId))<0)) return {lvl:'bad',text:'не хватает товара'};
  if(!wait.length) return {lvl:'ok',text:'всё на складе'};
  const ss=[...new Set(wait.map(r=>r.src))].map(ship).filter(Boolean);
  const last=ss.reduce((a,s)=>s.eta>a?s.eta:a,ss[0].eta);
  return {lvl:'info',text:`едет ${ss.map(s=>s.id).join(', ')} · до ${fD(last)}`};
}
function vClients(){
  const pr=can('prices');
  // воронка на каждую воронку сделок, в которой есть сделки или которая единственная
  const pipes=Pipes.of(S,'deals'),fun=pipes.filter(p=>pipes.length<2||Pipes.items(S,p.id).length).map(p=>{const ds=Pipes.items(S,p.id);return `${pipes.length>1?`<h4 class="sh">${esc(p.name)}</h4>`:''}<div class="xs"><div class="funnel" style="grid-template-columns:repeat(${p.stages.length},minmax(92px,1fr))">${p.stages.map(st=>{const c=ds.filter(d=>d.stageId===st.id).length;return `<div class="fn ${c?'':'zero'}"><b>${c}</b><span>${esc(st.name)}</span></div>`}).join('')}</div></div>`}).join('');
  const rows=S.deals.slice().sort((a,b)=>stagePos(b)-stagePos(a)).map(d=>{const g=dealGoods(d);return `<tr class="click" data-act="open-deal" data-id="${d.id}" tabindex="0"><td><div class="pname"><span>${esc(d.client)}</span><small class="mono">${d.id} · ${esc(d.kind)}</small></div></td><td>${esc(d.object)}</td><td><span class="pill ${stageTone(d)}">${esc(stageName(d))}</span></td><td><span class="pill sm ${g.lvl}">${esc(g.text)}</span></td><td class="nowrap">${esc(person(d.managerId)?.name||'нет данных: менеджер')}</td><td>${chPill(d.channel)}</td>${pr?`<td class="num">${d.amount?rub(d.amount):'<span class="muted">не рассчитана</span>'}</td>`:''}</tr>`}).join('');
  return `${fun}<section class="card clip"><div class="xs"><table class="tbl"><thead><tr><th>Клиент</th><th>Объект</th><th>Этап</th><th>Товар</th><th>Менеджер</th><th>Связь</th>${pr?'<th class="num">Сумма</th>':''}</tr></thead><tbody>${rows}</tbody></table></div></section>`;
}
function dDeal(d){
  const rs=S.reserves.filter(r=>r.dealId===d.id),ts=S.tasks.filter(t=>t.deal===d.id&&taskVisible(t)),ms=S.msgs.filter(x=>x.deal===d.id).slice().sort((a,b)=>a.at-b.at);
  const goods=rs.length?`<div class="xs"><table class="tbl"><thead><tr><th>Товар</th><th class="num">Кол-во</th><th>Где</th></tr></thead><tbody>${rs.map(r=>{const p=product(r.productId);return `<tr ${can('stock')?`class="click" data-act="open-product" data-sku="${p.sku}"`:''}><td>${esc(p.name)}</td><td class="num">${num(r.qty)} ${p.unit}</td><td>${srcPill(r)}</td></tr>`}).join('')}</tbody></table></div>`:'<p class="muted m0">Под сделку ничего не зарезервировано.</p>';
  const tasks=ts.length?`<ul class="list" style="padding:0">${ts.map(t=>`<li><button class="li" data-act="open-task" data-id="${t.id}"><span class="tdot ${esc(t.stageId)}"></span><span class="li-t">${esc(t.title)}<small>${esc(targetName(t))} · ${esc(stageName(t))}</small></span><span class="due ${taskOverdue(t)?'bad':''}">${fRel(t.due)}</span></button></li>`).join('')}</ul>`:'<p class="muted m0">Задач по сделке нет.</p>';
  const chat=ms.length?`<div class="chat">${ms.map(x=>`<div class="bub ${x.inbound?'':'out'}">${esc(x.text)}<small>${x.inbound?esc(d.contact):x.auto?'Авто-сообщение':esc(person(x.by)?.name||'')} · ${CH[x.channel]} · ${fWhen(x.at)}</small></div>`).join('')}</div>`:'<p class="muted m0">Переписки пока нет.</p>';
  const compose=d.channel==='phone'?'<p class="lock">Клиент на связи только по телефону.</p>':can('write')?`<form class="compose" data-form="msg" data-id="${d.id}"><textarea id="msg-text" class="inp" rows="3" placeholder="Сообщение клиенту в ${CH[d.channel]}" aria-label="Сообщение клиенту"></textarea><button class="btn pri" type="submit">${ic('send')}Отправить в ${CH[d.channel]}</button></form>`:`<p class="lock">${ic('lock')}У вашей роли нет права писать клиентам.</p>`;
  return {kind:'Сделка '+d.id,title:esc(d.client),sub:esc(d.kind+' · '+d.object),body:`
    <ol class="steps" style="--n:${stagesFor(d).length}">${stagesFor(d).map((x,i)=>`<li class="${i<stagePos(d)?'done':x.id===d.stageId?'cur':''}"><span>${esc(x.name)}</span></li>`).join('')}</ol>
    <dl class="kv"><dt>Объект</dt><dd>${esc(d.object)}</dd><dt>Менеджер</dt><dd>${esc(person(d.managerId)?.name||'нет данных: менеджер')}</dd><dt>Связь</dt><dd>${CH[d.channel]}</dd>${can('prices')?`<dt>Сумма</dt><dd>${d.amount?rub(d.amount):'не рассчитана'}</dd>`:''}</dl>
    <div><h4 class="sh">Товар под сделку</h4>${goods}</div>
    <div><h4 class="sh">Задачи</h4>${tasks}</div>
    <div class="stack-s"><h4 class="sh" style="margin:0">Переписка</h4>${chat}${compose}</div>`};
}

// ——— регистрация в реестрах оболочки ———
DRAWERS.deal=id=>{const d=can('clients')?deal(id):null;return d?dDeal(d):null};
