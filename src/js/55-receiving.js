// Раздел «Приёмка на складе»
// Перенесено из прототипа v2. Что ждёт приёмки — Ships.awaitingReceipt (флаг arrived), единственное «ждёт приёмки»;
// кому уведомления — Notify; этап ставит только ядро (Ships.setStage, Ships.applyRules); товар кладёт Stock.move.
// Предпросмотр и подтверждение считают по одному плану rcvPlan(): справа на экране то же самое, что сделает receiveShip.

// ——— приёмка ———
// Юрлицо и город склада по умолчанию — те, что записаны в поставке; нет данных — кладовщик выбирает сам
const newRcv=id=>{const s=ship(id);return {shipId:id,qty:Object.fromEntries(s.items.map(i=>[i.productId,i.qty])),dmg:{},note:'',photos:[],entityId:s.entityId||'',cityId:s.cityId||'',done:null}};
function initRcv(id){S.rcv=newRcv(id)}
const pendingRcv=()=>Ships.awaitingReceipt(S).sort((a,b)=>(a.eta?a.eta.getTime():Infinity)-(b.eta?b.eta.getTime():Infinity));
// Куда ляжет товар: выбранные юрлицо и город (у черновика из старого сохранения их нет — берём из поставки)
function rcvCell(r=S.rcv){
  const s=ship(r.shipId)||{},entityId=r.entityId!==undefined?r.entityId:(s.entityId||''),cityId=r.cityId!==undefined?r.cityId:(s.cityId||'');
  const en=entityId?Stock.entityName(S,entityId):null,cn=cityId?Stock.cityName(S,cityId):null;
  return {entityId,cityId,entityName:en||'нет данных: юрлицо',cityName:cn||'нет данных: город',ok:!!en&&!!cn};
}
// Текущая приёмка: начатая или первая из ждущих (без записи в S — вид не меняет состояние)
function curRcv(){
  if(S.rcv&&S.rcv.done) return S.rcv;
  const pend=pendingRcv();
  if(S.rcv&&pend.some(s=>s.id===S.rcv.shipId)) return S.rcv;
  return pend.length?newRcv(pend[0].id):null;
}
// Перед отрисовкой раздела: начатая приёмка или первая из ждущих становится текущей
function syncRcv(){const r=curRcv();if(r!==S.rcv) S.rcv=r}
const qv=(pid,r=S.rcv)=>Math.max(0,parseInt(r.qty[pid],10)||0);
function diffHtml(it,r=S.rcv){const d=qv(it.productId,r)-it.qty;return d<0?`<span class="pill bad sm">недостача ${num(-d)}</span>`:d>0?`<span class="pill warn sm">излишек ${num(d)}</span>`:'<span class="pill ok sm">сходится</span>'}
// План приёмки — один на предпросмотр и подтверждение: что ляжет на склад и куда, на какой этап встанет поставка,
// расхождения, сделки-ждуны и что с каждой, кому уведомления. receiveShip делает ровно это и ничего сверх.
function rcvPlan(r=S.rcv){
  const s=ship(r.shipId),auto=rule('arrive').on,issues=[],dmg=[];
  s.items.forEach(it=>{
    const p=product(it.productId),q=qv(it.productId,r);
    if(q<it.qty) issues.push(`${p.name}: принято ${num(q)} из ${qtyOf(it.qty,p)}`);
    else if(q>it.qty) issues.push(`${p.name}: принято ${num(q)} вместо ${qtyOf(it.qty,p)}`);
    if(r.dmg[it.productId]) dmg.push(p.name);
  });
  const cell=rcvCell(r),fin=finalStage(s);
  // что ляжет на склад: принятое по каждой позиции, в порядке позиций поставки (ноль — ничего не кладём)
  const adds=s.items.map(it=>({productId:it.productId,qty:qv(it.productId,r)}));
  // правила «принято на складе»: поставка к тому времени уже на этапе «на складе», срабатывают те, что ставят другой этап
  const rules=(S.shipRules||[]).filter(x=>x.on===true&&x.when==='received'&&fin&&x.then!==fin.id&&Pipes.stage(S,s.pipeId,x.then));
  // резервы «из поставки» становятся резервами со склада, но не больше принятого: принятое делится между резервами по порядку
  // постановки (раньше поставлен — раньше получает); кому не хватило — резерв уменьшается или снимается (cuts)
  const all=S.reserves.filter(x=>x.src===s.id),cuts=[],res=[],rest={};
  all.forEach(x=>{
    if(!(x.productId in rest)) rest[x.productId]=qv(x.productId,r);
    const keep=Math.min(x.qty,rest[x.productId]);rest[x.productId]-=keep;
    if(keep>0) res.push(x);
    if(keep<x.qty) cuts.push({r:x,keep,drop:x.qty-keep,d:deal(x.dealId)});
  });
  // как сообщить клиенту: телефон → задача менеджеру; иначе авто-сообщение, если правило включено; иначе напоминание
  const waits=[...byDeal(res)].map(([did,list])=>{const d=deal(did);return {d,list,items:itemsText(list.map(x=>{const c=cuts.find(k=>k.r===x);return c?{...x,qty:c.keep}:x})),how:d.channel==='phone'?'call':auto?'auto':'remind'}});
  const ids=new Set([...Notify.recipients(S,'arrive'),...waits.flatMap(w=>Notify.recipients(S,'msg',[w.d.managerId])),...(issues.length||dmg.length?Notify.recipients(S,'warn'):[]),...(rules.length?Notify.recipients(S,'ship'):[]),...cuts.flatMap(c=>Notify.recipients(S,'reserve',c.d&&c.d.managerId?[c.d.managerId]:[]))]);
  const block=!fin?'В воронке поставок нет этапа «на складе» (с флагом «закрыто»): приёмке некуда перевести поставку.':!cell.ok?'Выберите юрлицо и город, куда класть товар.':'';
  return {s,issues,dmg,res,cuts,waits,warnTo:Notify.recipients(S,'warn'),to:[...ids],adds,cell,final:fin,rules,block};
}
// Почему снят резерв при приёмке — одна фраза для ленты сделки, уведомления и предпросмотра
const rcvCutWhy=(s,c)=>`При приёмке ${s.id} принято меньше, чем ждали: на склад перешло ${num(c.keep)} из ${num(c.r.qty)}.`;
function vReceiving(){
  const r=curRcv();
  if(r&&r.done) return rcvLayout(rcvDoneHtml(r),rcvAfterHtml(r));
  if(!r) return `<section class="card">${emptyState('Сейчас нечего принимать: нет поставок на этапе «прибыло, ждёт приёмки». Как только логист отметит прибытие, поставка появится здесь.',can('stock')||can('logistics')?'Открыть поставки':'','go','data-view="logistics"')}</section>`;
  return rcvLayout(rcvPhoneHtml(r,pendingRcv()),`<div id="rcv-prev">${rcvPreview(r)}</div>`);
}
function rcvLayout(phone,side){
  return `<p class="hint">Так приёмку видит кладовщик с телефона: выбрал поставку, пересчитал, сфотографировал — и все, кого это касается, сразу получили уведомления. Справа видно, что произойдёт.</p><div class="rcv"><section class="phone" aria-label="Экран кладовщика"><div class="phone-in"><div class="ph-bar"><b>Приёмка</b><span>${esc(me().name)} · ${fT(new Date())}</span></div>${phone}</div></section><div class="stack">${side}</div></div>`;
}
function photosHtml(r=S.rcv){
  return r.photos.map((u,i)=>`<figure class="ph"><img src="${u}" alt="Фото ${i+1}"><button class="ph-x" data-act="rcv-photo-del" data-i="${i}" aria-label="Удалить фото">${ic('x')}</button></figure>`).join('')+`<label class="ph add" for="rcv-file">${ic('camera')}<span>Снять или добавить фото</span><input id="rcv-file" class="sr" type="file" accept="image/*" capture="environment" multiple data-on="rcv-photo"></label>`;
}
// Куда ляжет товар: по умолчанию юрлицо и город из поставки; нет данных — выбрать нужно, иначе приёмка не пройдёт
function rcvCellHtml(r){
  const c=rcvCell(r),opt=(list,cur)=>(cur&&list.some(x=>x.id===cur)?'':`<option value="" selected>нет данных: выберите</option>`)+list.map(x=>`<option value="${esc(x.id)}" ${x.id===cur?'selected':''}>${esc(x.name)}</option>`).join('');
  return `<div class="rcv-cell"><div class="field"><label for="rcv-ent">Юрлицо</label><select id="rcv-ent" class="inp" data-on="rcv-entity">${opt(S.entities,c.entityId)}</select></div><div class="field"><label for="rcv-city">Город склада</label><select id="rcv-city" class="inp" data-on="rcv-city">${opt(S.cities,c.cityId)}</select></div></div>${c.ok?'':'<p class="warn-t sm m0">Юрлицо или город не выбраны — без них товар на склад не лечь.</p>'}`;
}
function rcvPhoneHtml(r,pend){
  const s=ship(r.shipId);
  const opts=pend.map(x=>{const on=x.id===s.id;return `<label class="opt ${on?'on':''}"><input type="radio" name="rcv-ship" id="rcv-s-${x.id}" value="${x.id}" ${on?'checked':''} data-on="rcv-ship"><span><b class="mono">${x.id}</b> · ${esc(x.supplier)}<small>${isLate(x)?'задерживается':esc(stageName(x).toLowerCase())} · ${x.items.length} ${pl(x.items.length,'позиция','позиции','позиций')} · ожидается ${fRel(x.eta)}</small></span></label>`}).join('');
  const rows=s.items.map(it=>{const p=product(it.productId);return `<div class="cnt-row"><div class="cnt-name">${esc(p.name)}<small>Ожидалось: ${qtyOf(it.qty,p)}</small></div><div class="qty"><button type="button" data-act="rcv-step" data-pid="${it.productId}" data-d="-1" aria-label="Меньше">−</button><input id="rcv-q-${it.productId}" type="number" inputmode="numeric" min="0" value="${esc(r.qty[it.productId])}" data-on="rcv-qty" data-pid="${it.productId}" aria-label="Принято"><button type="button" data-act="rcv-step" data-pid="${it.productId}" data-d="1" aria-label="Больше">+</button></div><div class="cnt-x"><label class="check"><input type="checkbox" id="rcv-d-${it.productId}" data-on="rcv-dmg" data-pid="${it.productId}" ${r.dmg[it.productId]?'checked':''}> Есть повреждения</label><span id="rcv-diff-${it.productId}">${diffHtml(it,r)}</span></div></div>`}).join('');
  return `<div class="ph-sec"><span class="ph-step">Шаг 1</span><h3>Какая поставка пришла</h3>${opts}</div>
    <div class="ph-sec"><span class="ph-step">Шаг 2</span><h3>Пересчитайте товар</h3>${rows}</div>
    <div class="ph-sec"><span class="ph-step">Шаг 3</span><h3>На какое юрлицо и в какой город</h3>${rcvCellHtml(r)}</div>
    <div class="ph-sec"><span class="ph-step">Шаг 4</span><h3>Фото груза и накладной</h3><div class="photos" id="rcv-photos">${photosHtml(r)}</div>${unsavedNote(r)}<div class="field"><label for="rcv-note">Комментарий</label><textarea id="rcv-note" class="inp" rows="2" data-on="rcv-note" placeholder="Например: одна коробка надорвана, содержимое целое">${esc(r.note)}</textarea></div></div>
    <div class="ph-foot"><button class="btn pri big" data-act="rcv-confirm">${ic('check')}Принять на склад и уведомить</button></div>`;
}
function rcvPreview(r=S.rcv){
  const P=rcvPlan(r),s=P.s,m=me();
  const ppl=P.to.filter(id=>id!==m.id).map(person).filter(Boolean);
  const add=s.items.map((it,i)=>{const p=product(it.productId);return `<li><span>${esc(p.name)}</span><b class="num">+${qtyOf(P.adds[i].qty,p)}</b></li>`}).join('');
  const rules=P.rules.map(x=>`<li class="sm">Правило «если ${esc(Ships.eventLabel(x.when))}» — этап «${esc(Pipes.stage(S,s.pipeId,x.then).name)}»</li>`).join('');
  const warnNames=P.warnTo.map(id=>person(id)?.name).filter(Boolean).map(esc).join(', ');
  const waits=P.waits.map(({d,items,how})=>{
    const mg=person(d.managerId);
    const msg=how==='call'?'<p class="muted sm m0">Клиент на связи по телефону — менеджеру придёт задача позвонить.</p>':how==='auto'?`<div class="chat"><div class="bub out">${fillTpl(d,items,true)}<small>${CH[d.channel]} · уйдёт автоматически сразу после приёмки</small></div></div>`:`<p class="muted sm m0">Авто-сообщения выключены — ${esc(mg?.name||'менеджер')} получит напоминание написать клиенту.</p>`;
    return `<div class="wait"><div class="wait-h"><b>${esc(d.client)}</b><span class="mono muted">${d.id}</span>${chPill(d.channel)}<span class="muted sm">менеджер ${esc(mg?.name||'нет данных')}</span></div><p class="sm m0">Ждёт: ${esc(items)}</p>${msg}</div>`;
  }).join('');
  return `<section class="card"><div class="card-h"><h3>Что произойдёт после приёмки ${s.id}</h3></div><div class="card-b stack-s">
    <div><h4 class="sh">Добавится на склад: ${esc(P.cell.entityName)}, ${esc(P.cell.cityName)}</h4><ul class="plain">${add}</ul></div>
    <div><h4 class="sh">Поставка ${esc(s.id)}</h4><p class="sm m0">${P.final?`Перейдёт на этап «${esc(P.final.name)}» (автоматически: приёмка).`:'нет данных: этап «на складе» в воронке'}</p>${rules?`<ul class="plain">${rules}</ul>`:''}${P.block?`<p class="warn-t sm" style="margin:6px 0 0">${esc(P.block)}</p>`:''}</div>
    <div><h4 class="sh">Уведомление получат</h4><div class="who-list">${ppl.map(p=>`<span class="chip">${av(p,'xs')}${esc(p.name)} · ${esc(roleName(p).toLowerCase())}</span>`).join('')}</div>${P.issues.length||P.dmg.length?`<p class="warn-t sm" style="margin:8px 0 0">Есть расхождение или повреждение — отдельное предупреждение получат: ${warnNames}.</p>`:''}</div>
    <div><h4 class="sh">Клиенты, которые ждут этот товар</h4><div class="stack-s">${waits||'<p class="muted sm m0">Резервов под эту поставку нет — весь товар станет свободным для продажи.</p>'}</div>${P.cuts.length?`<ul class="plain">${P.cuts.map(c=>`<li class="sm warn-t">Резерв ${esc(c.r.dealId||'')}${c.d?' ('+esc(c.d.client)+')':''}: ${esc(low(product(c.r.productId)?.name||'нет данных: товар'))} — ${c.keep?`останется ${num(c.keep)}, снимется ${num(c.drop)}`:`снимется весь (${num(c.drop)})`}.</li>`).join('')}</ul>`:''}</div>
  </div></section>`;
}
function updRcvPrev(){const b=byId('rcv-prev');if(b) b.innerHTML=rcvPreview()}
// Принять поставку S.rcv по плану rcvPlan: товар ложится на выбранные юрлицо и город (Stock.move, запись в журнал),
// резервы «из поставки» становятся резервами со склада, поставка встаёт на этап «на складе» через ядро
// (Ships.setStage с пометкой «автоматически: приёмка» и Ships.applyRules на «принято на складе»), уведомления — Notify,
// клиентам — сообщение в канал сделки (имитация) или задача менеджеру позвонить.
// → итог приёмки (он же S.rcv.done) или {ok:false, reason}, если принять нельзя; тогда ничего не меняется.
function receiveShip(by,now){
  const r=S.rcv,P=rcvPlan(r),s=P.s,who=person(by);
  if(P.block) return {ok:false,reason:P.block};
  const stock=[];
  s.items.forEach((it,i)=>{
    const q=P.adds[i].qty;
    it.got=q;
    // приход: остаток растёт в клетке «юрлицо × город», запись попадает в журнал движений
    if(q&&Stock.move(S,{kind:Stock.KINDS.receive,productId:it.productId,qty:q,entityId:P.cell.entityId,cityId:P.cell.cityId,doc:s.id,by,at:now}).ok) stock.push({productId:it.productId,qty:q});
  });
  s.entityId=P.cell.entityId;s.cityId=P.cell.cityId;
  // излишек резерва над принятым снимается: «Снят резерв» в журнале, запись в ленте сделки и уведомление её менеджеру
  P.cuts.forEach(c=>{Deals.noteRelease(S,c.r,c.drop,rcvCutWhy(s,c),by,now)});
  [...P.res,...P.cuts.map(c=>c.r)].forEach(x=>{x.src='stock';x.entityId=P.cell.entityId;x.cityId=P.cell.cityId});
  P.cuts.forEach(c=>Stock.release(S,c.r.id,c.drop,by,now));
  // этап и положение груза — только через ядро; правила директора на «принято на складе» — после этапа
  const before=S.notes.length;
  Ships.setStage(S,s.id,P.final.id,by,now,Ships.SRC.receipt);
  s.history.push({at:now,by,text:`Принято на склад: ${P.cell.entityName}, ${P.cell.cityName}. Фото: ${r.photos.length}.${r.note.trim()?' Комментарий: '+r.note.trim():''}`,source:Ships.SRC.receipt,auto:true});
  const fired=Ships.applyRules(S,'received',s.id,by,now);
  s.received={at:now,by,photos:r.photos.length,urls:r.photos.slice(),note:r.note.trim()};
  const notes=S.notes.slice(0,S.notes.length-before),msgIds=[],taskIds=[];
  notes.push(Notify.push(S,'arrive',by,`${s.id} принята на склад (${P.cell.entityName}, ${P.cell.cityName}): ${s.items.map(it=>`${low(product(it.productId).name)} ${qtyOf(it.got,product(it.productId))}`).join(', ')}. Фото: ${r.photos.length}.${s.received.note?' Комментарий: '+s.received.note:''}`,now));
  if(P.issues.length||P.dmg.length) notes.push(Notify.push(S,'warn',by,`Приёмка ${s.id} с замечаниями. ${[P.issues.join('; '),P.dmg.length?'Повреждено: '+P.dmg.join(', '):''].filter(Boolean).join('. ')}. Фото в карточке поставки.`,now));
  P.waits.forEach(({d,items,how})=>{
    const mg=person(d.managerId);let tail;
    if(how==='call'){const board=taskBoard();const t={id:Store.freeId(S.tasks,'t'),title:`Позвонить клиенту: товар по ${d.id} на складе`,desc:items,to:{t:'p',id:d.managerId},from:by,due:day(0,18),boardId:board.id,stageId:startStage(board.id).id,prio:'high',deal:d.id,at:now};S.tasks.push(t);taskIds.push(t.id);tail='Менеджеру поставлена задача позвонить клиенту.'}
    else if(how==='auto'){const x={id:Store.freeId(S.msgs,'m'),at:now,deal:d.id,channel:d.channel,auto:true,sim:true,text:fillTpl(d,items,false)};S.msgs.push(x);msgIds.push(x.id);tail=`Клиенту ушло авто-сообщение в ${CH[d.channel]} (имитация, не отправлено).`}
    else tail='Авто-сообщения выключены — напишите клиенту.';
    // менеджеру сделки — отдельно: уведомите клиента (R15)
    notes.push(Notify.push(S,'msg',null,`Уведомите клиента: ${d.client} (${d.id}) — товар на складе: ${items}. ${tail} Менеджер: ${mg?.name||'нет данных'}.`,now,[d.managerId]));
  });
  const notified=new Set(notes.flatMap(n=>n.to).filter(id=>id!==by)).size;
  r.done={ok:true,shipId:s.id,noteIds:notes.map(n=>n.id),msgIds,taskIds,stock,cell:{entityId:P.cell.entityId,cityId:P.cell.cityId,entityName:P.cell.entityName,cityName:P.cell.cityName},stage:P.final.name,fired,notified,issues:P.issues.length+P.dmg.length,by:who?.id||by};
  return r.done;
}
function rcvConfirm(){
  const r=receiveShip(me().id,new Date());
  if(r.ok===false){toast(r.reason,'warn');return}
  render();byId('scroll').scrollTop=0;
  toast(`${r.shipId} принята. Уведомления получили ${r.notified} ${pl(r.notified,'сотрудник','сотрудника','сотрудников')}${r.msgIds.length?`, клиентам подготовлено ${r.msgIds.length} ${pl(r.msgIds.length,'сообщение','сообщения','сообщений')}`:''}.`);
}
function rcvDoneHtml(rc=S.rcv){
  const r=rc.done,s=ship(r.shipId);
  return `<div class="done-box"><span class="done-ic">${ic('check')}</span><h3 class="m0">${s.id} на складе</h3><p class="m0 muted">Остатки обновлены (${esc(r.cell.entityName)}, ${esc(r.cell.cityName)}), поставка на этапе «${esc(r.stage)}», резервы под неё стали резервами со склада. Уведомили ${r.notified} ${pl(r.notified,'сотрудника','сотрудников','сотрудников')}.${r.msgIds.length?` Клиентам подготовлено сообщений: ${r.msgIds.length} — имитация, не отправлено.`:''}${r.taskIds&&r.taskIds.length?` Менеджерам поставлено задач позвонить клиенту: ${r.taskIds.length}.`:''}</p>${r.issues?'<p class="m0 warn-t">Расхождения и повреждения отправлены отдельным предупреждением.</p>':''}<div class="bar"><button class="btn pri" data-act="rcv-again">Принять другую поставку</button><button class="btn" data-act="go" data-view="notifications">Уведомления</button></div></div>`;
}
function rcvAfterHtml(rc=S.rcv){
  const r=rc.done,notes=S.notes.filter(n=>r.noteIds.includes(n.id)),msgs=S.msgs.filter(x=>r.msgIds.includes(x.id));
  let h=`<section class="card"><div class="card-h"><h3>Кому что ушло</h3></div><ul class="notes">${notes.map(n=>noteRow(n,false,true)).join('')}</ul></section>`;
  if(msgs.length) h+=`<section class="card"><div class="card-h"><h3>Сообщения клиентам</h3><span class="pill sun sm">имитация: не отправлены</span></div><div class="card-b stack-s">${msgs.map(x=>{const d=deal(x.deal);return `<div class="stack-s" style="gap:6px"><p class="sm m0"><b>${esc(d.client)}</b> · ${CH[x.channel]}</p><div class="chat"><div class="bub out">${esc(x.text)}<small>${fT(x.at)} · авто · имитация, не отправлено</small></div></div></div>`}).join('')}</div></section>`;
  return h;
}
function addPhotos(files){
  const push=u=>{if(!S.rcv||S.rcv.done) return;S.rcv.photos.push(u);const b=byId('rcv-photos');if(b) b.innerHTML=photosHtml();saveSoon()};
  [...files].slice(0,9).forEach(f=>{
    if(!/^image\//.test(f.type)) return;
    const fr=new FileReader();
    fr.onload=()=>{const img=new Image();img.onload=()=>{const k=Math.min(1,720/Math.max(img.width,img.height)),c=document.createElement('canvas');c.width=Math.round(img.width*k);c.height=Math.round(img.height*k);c.getContext('2d').drawImage(img,0,0,c.width,c.height);let u;try{u=c.toDataURL('image/jpeg',.82)}catch(_){u=fr.result}push(u)};img.onerror=()=>push(fr.result);img.src=fr.result};
    fr.readAsDataURL(f);
  });
}

// ——— поля приёмки (реестр ON оболочки) ———
const rcvItem=pid=>ship(S.rcv.shipId).items.find(i=>i.productId===pid);
ON.input['rcv-qty']=t=>{const pid=t.dataset.pid;S.rcv.qty[pid]=t.value;byId('rcv-diff-'+pid).innerHTML=diffHtml(rcvItem(pid));updRcvPrev()};
ON.input['rcv-note']=t=>{S.rcv.note=t.value};
ON.change['rcv-ship']=t=>{initRcv(t.value);render()};
ON.change['rcv-entity']=t=>{S.rcv.entityId=t.value;render()};
ON.change['rcv-city']=t=>{S.rcv.cityId=t.value;render()};
ON.change['rcv-dmg']=t=>{S.rcv.dmg[t.dataset.pid]=t.checked;updRcvPrev()};
ON.change['rcv-photo']=t=>{addPhotos(t.files);t.value=''};
