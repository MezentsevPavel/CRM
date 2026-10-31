// Раздел «Приёмка на складе»
// Перенесено из прототипа v2. Что ждёт приёмки — awaitsReceipt (флаг arrived); кому уведомления — Notify;
// предпросмотр и подтверждение считают по одному плану rcvPlan().

// ——— приёмка ———
const newRcv=id=>{const s=ship(id);return {shipId:id,qty:Object.fromEntries(s.items.map(i=>[i.sku,i.qty])),dmg:{},note:'',photos:[],done:null}};
function initRcv(id){S.rcv=newRcv(id)}
const pendingRcv=()=>S.shipments.filter(awaitsReceipt).sort((a,b)=>a.eta-b.eta);
// Текущая приёмка: начатая или первая из ждущих (без записи в S — вид не меняет состояние)
function curRcv(){
  if(S.rcv&&S.rcv.done) return S.rcv;
  const pend=pendingRcv();
  if(S.rcv&&pend.some(s=>s.id===S.rcv.shipId)) return S.rcv;
  return pend.length?newRcv(pend[0].id):null;
}
// Перед отрисовкой раздела: начатая приёмка или первая из ждущих становится текущей
function syncRcv(){const r=curRcv();if(r!==S.rcv) S.rcv=r}
const qv=(sku,r=S.rcv)=>Math.max(0,parseInt(r.qty[sku],10)||0);
function diffHtml(it,r=S.rcv){const d=qv(it.sku,r)-it.qty;return d<0?`<span class="pill bad sm">недостача ${num(-d)}</span>`:d>0?`<span class="pill warn sm">излишек ${num(d)}</span>`:'<span class="pill ok sm">сходится</span>'}
// План приёмки — один на предпросмотр и подтверждение: расхождения, сделки-ждуны и что с каждой, кому уведомления
function rcvPlan(r=S.rcv){
  const s=ship(r.shipId),auto=rule('arrive').on,issues=[],dmg=[];
  s.items.forEach(it=>{
    const p=product(it.sku),q=qv(it.sku,r);
    if(q<it.qty) issues.push(`${p.name}: принято ${num(q)} из ${num(it.qty)} ${p.unit}`);
    else if(q>it.qty) issues.push(`${p.name}: принято ${num(q)} вместо ${num(it.qty)} ${p.unit}`);
    if(r.dmg[it.sku]) dmg.push(p.name);
  });
  const res=S.reserves.filter(x=>x.src===s.id);
  // как сообщить клиенту: телефон → задача менеджеру; иначе авто-сообщение, если правило включено; иначе напоминание
  const waits=[...byDeal(res)].map(([did,list])=>{const d=deal(did);return {d,list,items:itemsText(list),how:d.channel==='phone'?'call':auto?'auto':'remind'}});
  const ids=new Set([...Notify.recipients(S,'arrive'),...waits.flatMap(w=>Notify.recipients(S,'msg',[w.d.managerId])),...(issues.length||dmg.length?Notify.recipients(S,'warn'):[])]);
  return {s,issues,dmg,res,waits,warnTo:Notify.recipients(S,'warn'),to:[...ids]};
}
function vReceiving(){
  const r=curRcv();
  if(r&&r.done) return rcvLayout(rcvDoneHtml(r),rcvAfterHtml(r));
  if(!r) return '<section class="card"><p class="empty">Сейчас нечего принимать: нет поставок на этапе «прибыло, ждёт приёмки». Как только логист отметит прибытие, поставка появится здесь.</p></section>';
  return rcvLayout(rcvPhoneHtml(r,pendingRcv()),`<div id="rcv-prev">${rcvPreview(r)}</div>`);
}
function rcvLayout(phone,side){
  return `<p class="hint">Так приёмку видит кладовщик с телефона: выбрал поставку, пересчитал, сфотографировал — и все, кого это касается, сразу получили уведомления. Справа видно, что произойдёт.</p><div class="rcv"><section class="phone" aria-label="Экран кладовщика"><div class="phone-in"><div class="ph-bar"><b>Приёмка</b><span>${esc(me().name)} · ${fT(new Date())}</span></div>${phone}</div></section><div class="stack">${side}</div></div>`;
}
function photosHtml(r=S.rcv){
  return r.photos.map((u,i)=>`<figure class="ph"><img src="${u}" alt="Фото ${i+1}"><button class="ph-x" data-act="rcv-photo-del" data-i="${i}" aria-label="Удалить фото">${ic('x')}</button></figure>`).join('')+`<label class="ph add" for="rcv-file">${ic('camera')}<span>Снять или добавить фото</span><input id="rcv-file" class="sr" type="file" accept="image/*" capture="environment" multiple data-on="rcv-photo"></label>`;
}
function rcvPhoneHtml(r,pend){
  const s=ship(r.shipId);
  const opts=pend.map(x=>{const on=x.id===s.id;return `<label class="opt ${on?'on':''}"><input type="radio" name="rcv-ship" id="rcv-s-${x.id}" value="${x.id}" ${on?'checked':''} data-on="rcv-ship"><span><b class="mono">${x.id}</b> · ${esc(x.from)}<small>${isLate(x)?'задерживается':esc(stageName(x).toLowerCase())} · ${x.items.length} ${pl(x.items.length,'позиция','позиции','позиций')} · ожидается ${fRel(x.eta)}</small></span></label>`}).join('');
  const rows=s.items.map(it=>{const p=product(it.sku);return `<div class="cnt-row"><div class="cnt-name">${esc(p.name)}<small>Ожидалось: ${num(it.qty)} ${p.unit}</small></div><div class="qty"><button type="button" data-act="rcv-step" data-sku="${it.sku}" data-d="-1" aria-label="Меньше">−</button><input id="rcv-q-${it.sku}" type="number" inputmode="numeric" min="0" value="${esc(r.qty[it.sku])}" data-on="rcv-qty" data-sku="${it.sku}" aria-label="Принято, ${p.unit}"><button type="button" data-act="rcv-step" data-sku="${it.sku}" data-d="1" aria-label="Больше">+</button></div><div class="cnt-x"><label class="check"><input type="checkbox" id="rcv-d-${it.sku}" data-on="rcv-dmg" data-sku="${it.sku}" ${r.dmg[it.sku]?'checked':''}> Есть повреждения</label><span id="rcv-diff-${it.sku}">${diffHtml(it,r)}</span></div></div>`}).join('');
  return `<div class="ph-sec"><span class="ph-step">Шаг 1</span><h3>Какая поставка пришла</h3>${opts}</div>
    <div class="ph-sec"><span class="ph-step">Шаг 2</span><h3>Пересчитайте товар</h3>${rows}</div>
    <div class="ph-sec"><span class="ph-step">Шаг 3</span><h3>Фото груза и накладной</h3><div class="photos" id="rcv-photos">${photosHtml(r)}</div><div class="field"><label for="rcv-note">Комментарий</label><textarea id="rcv-note" class="inp" rows="2" data-on="rcv-note" placeholder="Например: одна коробка надорвана, содержимое целое">${esc(r.note)}</textarea></div></div>
    <div class="ph-foot"><button class="btn pri big" data-act="rcv-confirm">${ic('check')}Принять на склад и уведомить</button></div>`;
}
function rcvPreview(r=S.rcv){
  const P=rcvPlan(r),s=P.s,m=me();
  const ppl=P.to.filter(id=>id!==m.id).map(person).filter(Boolean);
  const add=s.items.map(it=>{const p=product(it.sku);return `<li><span>${esc(p.name)}</span><b class="num">+${num(qv(it.sku,r))} ${p.unit}</b></li>`}).join('');
  const warnNames=P.warnTo.map(id=>person(id)?.name).filter(Boolean).map(esc).join(', ');
  const waits=P.waits.map(({d,items,how})=>{
    const mg=person(d.managerId);
    const msg=how==='call'?'<p class="muted sm m0">Клиент на связи по телефону — менеджеру придёт задача позвонить.</p>':how==='auto'?`<div class="chat"><div class="bub out">${fillTpl(d,items,true)}<small>${CH[d.channel]} · уйдёт автоматически сразу после приёмки</small></div></div>`:`<p class="muted sm m0">Авто-сообщения выключены — ${esc(mg?.name||'менеджер')} получит напоминание написать клиенту.</p>`;
    return `<div class="wait"><div class="wait-h"><b>${esc(d.client)}</b><span class="mono muted">${d.id}</span>${chPill(d.channel)}<span class="muted sm">менеджер ${esc(mg?.name||'нет данных')}</span></div><p class="sm m0">Ждёт: ${esc(items)}</p>${msg}</div>`;
  }).join('');
  return `<section class="card"><div class="card-h"><h3>Что произойдёт после приёмки ${s.id}</h3></div><div class="card-b stack-s">
    <div><h4 class="sh">Добавится на склад</h4><ul class="plain">${add}</ul></div>
    <div><h4 class="sh">Уведомление получат</h4><div class="who-list">${ppl.map(p=>`<span class="chip">${av(p,'xs')}${esc(p.name)} · ${esc(roleName(p).toLowerCase())}</span>`).join('')}</div>${P.issues.length||P.dmg.length?`<p class="warn-t sm" style="margin:8px 0 0">Есть расхождение или повреждение — отдельное предупреждение получат: ${warnNames}.</p>`:''}</div>
    <div><h4 class="sh">Клиенты, которые ждут этот товар</h4><div class="stack-s">${waits||'<p class="muted sm m0">Резервов под эту поставку нет — весь товар станет свободным для продажи.</p>'}</div></div>
  </div></section>`;
}
function updRcvPrev(){const b=byId('rcv-prev');if(b) b.innerHTML=rcvPreview()}
// Принять поставку S.rcv: остаток растёт, резервы «из поставки» становятся резервами со склада,
// поставка — на завершающий этап, уведомления через Notify, клиентам — сообщение или задача менеджеру.
function receiveShip(by,now){
  const r=S.rcv,P=rcvPlan(r),s=P.s,who=person(by);
  s.items.forEach(it=>{
    const p=product(it.sku),q=qv(it.sku,r);
    p.stock+=q;it.got=q;
    if(q) S.moves.unshift({at:now,sku:it.sku,kind:'Приход',qty:q,doc:s.id,by});
  });
  P.res.forEach(x=>{x.src='stock'});
  s.stageId=finalStage(s)?.id||s.stageId;s.last={place:'Наш склад',at:now,by};
  s.received={at:now,by,photos:r.photos.length,urls:r.photos.slice(),note:r.note.trim()};
  const notes=[],msgIds=[];
  notes.push(Notify.push(S,'arrive',by,`${s.id} принята на склад: ${s.items.map(it=>`${low(product(it.sku).name)} ${num(it.got)} ${product(it.sku).unit}`).join(', ')}. Фото: ${r.photos.length}.${s.received.note?' Комментарий: '+s.received.note:''}`,now));
  if(P.issues.length||P.dmg.length) notes.push(Notify.push(S,'warn',by,`Приёмка ${s.id} с замечаниями. ${[P.issues.join('; '),P.dmg.length?'Повреждено: '+P.dmg.join(', '):''].filter(Boolean).join('. ')}. Фото в карточке поставки.`,now));
  P.waits.forEach(({d,items,how})=>{
    const mg=person(d.managerId);let tail;
    if(how==='call'){const board=taskBoard();S.tasks.push({id:Store.freeId(S.tasks,'t'),title:`Позвонить клиенту: товар по ${d.id} на складе`,desc:items,to:{t:'p',id:d.managerId},from:by,due:day(0,18),boardId:board.id,stageId:startStage(board.id).id,prio:'high',deal:d.id,at:now});tail='Менеджеру поставлена задача позвонить клиенту.'}
    else if(how==='auto'){const x={id:Store.freeId(S.msgs,'m'),at:now,deal:d.id,channel:d.channel,auto:true,text:fillTpl(d,items,false)};S.msgs.push(x);msgIds.push(x.id);tail=`Клиенту ушло авто-сообщение в ${CH[d.channel]} (имитация, не отправлено).`}
    else tail='Авто-сообщения выключены — напишите клиенту.';
    // менеджеру сделки — отдельно: уведомите клиента (R15)
    notes.push(Notify.push(S,'msg',null,`Уведомите клиента: ${d.client} (${d.id}) — товар на складе: ${items}. ${tail} Менеджер: ${mg?.name||'нет данных'}.`,now,[d.managerId]));
  });
  const notified=new Set(notes.flatMap(n=>n.to).filter(id=>id!==by)).size;
  r.done={shipId:s.id,noteIds:notes.map(n=>n.id),msgIds,notified,issues:P.issues.length+P.dmg.length,by:who?.id||by};
  return r.done;
}
function rcvConfirm(){
  const r=receiveShip(me().id,new Date());
  render();byId('scroll').scrollTop=0;
  toast(`${r.shipId} принята. Уведомления получили ${r.notified} ${pl(r.notified,'сотрудник','сотрудника','сотрудников')}${r.msgIds.length?`, клиентам подготовлено ${r.msgIds.length} ${pl(r.msgIds.length,'сообщение','сообщения','сообщений')}`:''}.`);
}
function rcvDoneHtml(rc=S.rcv){
  const r=rc.done,s=ship(r.shipId);
  return `<div class="done-box"><span class="done-ic">${ic('check')}</span><h3 class="m0">${s.id} на складе</h3><p class="m0 muted">Остатки обновлены, резервы под эту поставку стали резервами со склада. Уведомили ${r.notified} ${pl(r.notified,'сотрудника','сотрудников','сотрудников')}.${r.msgIds.length?` Клиентам подготовлено сообщений: ${r.msgIds.length} — в прототипе они не уходят.`:''}</p>${r.issues?'<p class="m0 warn-t">Расхождения и повреждения отправлены отдельным предупреждением.</p>':''}<div class="bar"><button class="btn pri" data-act="rcv-again">Принять другую поставку</button><button class="btn" data-act="go" data-view="notifications">Уведомления</button></div></div>`;
}
function rcvAfterHtml(rc=S.rcv){
  const r=rc.done,notes=S.notes.filter(n=>r.noteIds.includes(n.id)),msgs=S.msgs.filter(x=>r.msgIds.includes(x.id));
  let h=`<section class="card"><div class="card-h"><h3>Кому что ушло</h3></div><ul class="notes">${notes.map(n=>noteRow(n,false,true)).join('')}</ul></section>`;
  if(msgs.length) h+=`<section class="card"><div class="card-h"><h3>Сообщения клиентам</h3><span class="pill sun sm">имитация: не отправлены</span></div><div class="card-b stack-s">${msgs.map(x=>{const d=deal(x.deal);return `<div class="stack-s" style="gap:6px"><p class="sm m0"><b>${esc(d.client)}</b> · ${CH[x.channel]}</p><div class="chat"><div class="bub out">${esc(x.text)}<small>${fT(x.at)} · авто</small></div></div></div>`}).join('')}</div></section>`;
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
