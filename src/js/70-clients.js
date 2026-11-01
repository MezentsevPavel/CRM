// Раздел «Клиенты»: список с поиском по имени, телефону и ИНН, карточка клиента справа (данные правятся на месте,
// связанные сделки, лиды и сообщения, лента), окно «Новый клиент» и подсказка «Похоже, это …» против дублей.
// Всё решает ядро: Clients (40-clients.js) — поиск, дубли, заведение, правка, связанное; Feed — лента; Leads — видимость.
// Здесь — только экран: виды — чистые функции состояния, состояние меняют обработчики внизу файла.
// Выбор на экране (вид, поиск) лежит в S.ui.clients и не сохраняется. Сделки и лиды в карточке — только видимые
// текущему человеку (Clients.related с S.me): сделки чужого типа без права «Видеть сделки всех типов» не показываются.

Object.assign(IC,{person:'<circle cx="12" cy="8" r="3.6"/><path d="M5 20c.7-3.8 3.4-6 7-6s6.3 2.2 7 6"/>'});

// ——— выбор на экране ———
const CLIENTS_DEF={q:'',kind:''};
const clientsU=()=>S.ui.clients||(S.ui.clients=Object.assign({},CLIENTS_DEF));
const clientsSel=()=>Object.assign({},CLIENTS_DEF,S.ui.clients||{});
const clientNoData=t=>`<span class="muted">нет данных: ${t}</span>`;
const clientWho=id=>person(id)?.name||'нет данных: менеджер';
const clientKindPill=c=>`<span class="pill sm${c.kind==='company'?' info':''}">${esc(Clients.KIND[c.kind]||'нет данных: вид')}</span>`;
// Виден ли клиент человеку: клиент называет сделку, поэтому отбор — через видимые сделки и лиды (Clients.related с personId:
// Leads.dealsVisible и Leads.visible). Виден, если у него есть видимая сделка или лид, если человек — его менеджер, или если
// у клиента ещё нет ни сделок, ни лидов (только что заведён). Один отбор на список, поиск, карточку и подсказку о дублях.
function clientVisible(c,pid=S.me){
  if(!c) return false;
  if(c.managerId&&c.managerId===pid) return true;
  const mine=Clients.related(S,c.id,pid);
  if(mine.deals.length||mine.leads.length) return true;
  const all=Clients.related(S,c.id);
  return !all.deals.length&&!all.leads.length;
}
const clientsSeen=list=>list.filter(c=>clientVisible(c));
// Заводить и править клиентов — тем, кто заводит и правит сделки (право dealsEdit); право clients — только смотреть (R30)
const clientCanEdit=()=>can('clients')&&can('dealsEdit');
const CLIENT_NO_EDIT='Заводить и править клиентов могут те, у кого есть право «Заводить и править сделки».';
// Телефоны из одной строки: через запятую, точку с запятой или с новой строки
const clientPhonesOf=s=>String(s||'').split(/[,;\n]+/).map(x=>x.trim()).filter(Boolean);

// ——— подсказка «Похоже, это …» ———
// Совпадения с заведёнными клиентами по тому, что ввели в форме: q = {phone | phones, email, inn}. Нет совпадений — пустая строка.
// Показывает, по чему совпало; кнопка «Выбрать его» — dup-pick, ссылка на имя — dup-open. Дубль всё равно можно сохранить.
function clientDupHtml(q){
  const found=clientsSeen(Clients.find(S,q||{})).slice(0,3);
  if(!found.length) return '';
  const ids=x=>new Set(Clients.find(S,x).map(c=>c.id));
  const by=[['ИНН',ids({inn:(q||{}).inn})],['телефон',ids({phone:(q||{}).phone,phones:(q||{}).phones})],['почта',ids({email:(q||{}).email})]];
  const why=c=>by.filter(x=>x[1].has(c.id)).map(x=>x[0]).join(', ');
  return `<div class="dup" role="status"><ul class="dup-l">${found.map(c=>`<li><span class="dup-t">${ic('alert')}<span>Похоже, это <button type="button" class="link" data-act="dup-open" data-id="${esc(c.id)}">${esc(c.name)}</button><small>${esc(c.id)} · совпало: ${esc(why(c))}${c.demo?' · пример':''}</small></span></span><button type="button" class="btn sm" data-act="dup-pick" data-id="${esc(c.id)}">Выбрать его</button></li>`).join('')}</ul><p class="hint">Если это другой человек или другая компания — просто сохраните: дубль завести можно.</p></div>`;
}

// ——— список ———
function clientsList(u){
  return clientsSeen(Clients.search(S,u.q)).filter(c=>!u.kind||c.kind===u.kind).sort((a,b)=>a.name.localeCompare(b.name,'ru'));
}
function clientsTable(list){
  const rows=list.map(c=>{
    const n=Clients.related(S,c.id,S.me).deals.length,ph=c.phones||[];
    return `<tr class="click" data-act="open-client" data-id="${esc(c.id)}" tabindex="0"><td><div class="pname"><span>${esc(c.name)}${c.demo?' <span class="pill sm">пример</span>':''}</span><small class="mono">${esc(c.id)}${c.inn?' · ИНН '+esc(c.inn):''}<span class="c-show-s"> · ${esc(Clients.KIND[c.kind]||'')}${c.managerId?' · '+esc(clientWho(c.managerId)):''}</span></small></div></td><td class="c-hide-s">${clientKindPill(c)}</td><td class="c-hide-s nowrap">${ph[0]?esc(ph[0])+(ph.length>1?` <span class="muted">+${ph.length-1}</span>`:''):clientNoData('телефон')}</td><td class="c-hide-s nowrap">${c.managerId?esc(clientWho(c.managerId)):'<span class="pill sm warn">нет менеджера</span>'}</td><td class="num">${n}</td></tr>`;
  }).join('');
  return `<section class="card clip"><div class="xs"><table class="tbl"><thead><tr><th>Клиент</th><th class="c-hide-s">Вид</th><th class="c-hide-s">Телефон</th><th class="c-hide-s">Менеджер</th><th class="num">Сделок</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}
// Тело раздела: счёт и таблица (его же перерисовывает поиск)
function clientsBody(){
  const u=clientsSel(),all=clientsSeen(S.clients||[]),list=clientsList(u),dirty=u.q.trim()||u.kind;
  if(!all.length) return `<section class="card">${emptyState('Клиентов пока нет. Они появляются, когда из лида создают сделку. Клиента можно завести и руками.',clientCanEdit()?'Новый клиент':'','client-new')}</section>`;
  const comp=list.filter(c=>c.kind==='company').length;
  const head=`<p class="count"><span>Клиентов: <b>${list.length}</b>${list.length!==all.length?` из ${all.length}`:''}</span><span>компаний: <b>${comp}</b> · людей: <b>${list.length-comp}</b></span></p>`;
  if(!list.length) return `${head}<section class="card">${emptyState('По этим условиям клиентов нет.',dirty?'Сбросить поиск и фильтры':'','client-reset')}</section>`;
  return head+clientsTable(list);
}
function vClients(){
  const u=clientsSel(),dirty=u.q.trim()||u.kind;
  const kinds=[['','Все'],['person','Люди'],['company','Компании']];
  return `<p class="hint">Клиент — одна карточка на человека или компанию: в ней все его сделки, лиды, сообщения и лента. Ищите по имени, телефону или ИНН. В столбце «Сделок» и в карточке — только те сделки, которые видны вам.</p>
  <div class="bar cbar"><div class="seg" role="group" aria-label="Вид клиента">${kinds.map(([k,l])=>`<button type="button" class="${u.kind===k?'on':''}" aria-pressed="${u.kind===k}" data-act="client-kind" data-k="${k}">${l}</button>`).join('')}</div>
    <div class="search-in">${ic('search')}<input id="client-q" class="inp" type="search" placeholder="Поиск: имя, телефон, ИНН, почта" value="${esc(u.q)}" data-on="client-q" autocomplete="off" aria-label="Поиск по клиентам"></div>
    ${dirty?'<button type="button" class="btn ghost sm" data-act="client-reset">Сбросить</button>':''}<span class="grow"></span>${clientCanEdit()?`<button type="button" class="btn pri" data-act="client-new">${ic('plus')}Новый клиент</button>`:''}</div>
  <div id="client-body" class="stack-s">${clientsBody()}</div>`;
}

// ——— окно «Новый клиент» ———
// Менеджеры в списке: менеджеры типов; текущий выбор остаётся, даже если он уже не менеджер
function clientManagers(cur){
  const list=Leads.managers(S).map(p=>[p.id,p.name]);
  if(cur&&!list.some(m=>m[0]===cur)) list.unshift([cur,clientWho(cur)]);
  return [['','Не назначен'],...list].map(([v,l])=>`<option value="${esc(v)}"${v===(cur||'')?' selected':''}>${esc(l)}</option>`).join('');
}
MODALS.clientNew=()=>{
  const m=Leads.managers(S).some(p=>p.id===S.me)?S.me:'';
  return `<form data-form="client-new" novalidate>${mHead('Новый клиент')}<div class="modal-b">
    <div class="grid2"><div class="field"><label for="cn-kind">Вид</label><select id="cn-kind" class="inp">${Object.entries(Clients.KIND).map(([k,l])=>`<option value="${k}">${esc(l)}</option>`).join('')}</select></div>
      <div class="field"><label for="cn-name">Имя или название компании</label><input id="cn-name" class="inp" autocomplete="off"></div>
      <div class="field"><label for="cn-inn">ИНН (если компания)</label><input id="cn-inn" class="inp" inputmode="numeric" data-on="client-dup" autocomplete="off"></div>
      <div class="field"><label for="cn-phones">Телефоны</label><input id="cn-phones" class="inp" type="tel" placeholder="Несколько — через запятую" data-on="client-dup" autocomplete="off"></div>
      <div class="field"><label for="cn-email">Почта</label><input id="cn-email" class="inp" type="email" data-on="client-dup" autocomplete="off"></div>
      <div class="field"><label for="cn-mgr">Менеджер</label><select id="cn-mgr" class="inp">${clientManagers(m)}</select></div>
      <div class="field span2"><label for="cn-addr">Адрес</label><input id="cn-addr" class="inp" autocomplete="off"></div></div>
    <div id="cn-dup" aria-live="polite"></div>
    <p class="hint">Если указан ИНН, клиент станет компанией. Телефон, почту и ИНН мы сверим с уже заведёнными клиентами.</p>
    <p class="err" id="cn-err" hidden></p></div>${mFoot('Завести клиента')}</form>`;
};

// ——— карточка клиента ———
const CLIENT_FIELD={name:'Название',kind:'Вид',inn:'ИНН',phones:'Телефоны',email:'Почта',address:'Адрес',managerId:'Менеджер'};

function clientFields(c,edit){
  const id=esc(c.id);
  const field=(f,label,html,cls)=>`<div class="field${cls?' '+cls:''}"><label for="cf-${f}">${label}</label>${html}</div>`;
  const text=(f,val,type,ph)=>edit?`<input id="cf-${f}" class="inp" type="${type||'text'}" data-on="client-f" data-id="${id}" data-f="${f}" value="${esc(val||'')}" placeholder="нет данных: ${ph}" autocomplete="off">`:(val?`<span>${esc(val)}</span>`:clientNoData(ph));
  const sel=(f,opts,cur)=>edit?`<select id="cf-${f}" class="inp" data-on="client-f" data-id="${id}" data-f="${f}">${opts}</select>`:esc((cur&&f==='kind'?Clients.KIND[cur]:cur&&person(cur)?.name)||'нет данных');
  const kinds=Object.entries(Clients.KIND).map(([k,l])=>`<option value="${k}"${k===c.kind?' selected':''}>${esc(l)}</option>`).join('');
  return `<div class="cform">${field('name','Имя или название компании',text('name',c.name,'text','название'),'span2')}
    ${field('kind','Вид',sel('kind',kinds,c.kind))}${field('inn','ИНН',text('inn',c.inn,'text','ИНН'))}
    ${field('phones','Телефоны',text('phones',(c.phones||[]).join(', '),'tel','телефон')+(edit?'<small class="muted">Несколько — через запятую</small>':''))}${field('email','Почта',text('email',c.email,'email','почта'))}
    ${field('managerId','Менеджер',sel('managerId',clientManagers(c.managerId||''),c.managerId))}${field('address','Адрес',text('address',c.address,'text','адрес'))}</div>`;
}
// Строка связанной записи: кнопка, по которой открывается её карточка
const clientRow=(act,id,title,sub,side)=>`<li><button type="button" class="crow" data-act="${act}" data-id="${esc(id)}"><span class="crow-t">${title}<small>${sub}</small></span>${side?`<span class="crow-s">${side}</span>`:''}</button></li>`;
function clientDeals(list){
  if(!list.length) return '<p class="muted m0">Сделок, которые вам видны, у этого клиента нет.</p>';
  const pr=can('prices');
  return `<ul class="crel">${list.slice().sort((a,b)=>String(b.id).localeCompare(String(a.id))).map(d=>clientRow('open-deal',d.id,`<span><b>${esc(d.id)}</b> ${esc(d.object||'нет данных: что продаём')}</span>`,
    `${d.lostReason?'Провалена: '+esc(d.lostReason):esc(stageName(d))} · ${esc(Leads.TYPE[d.type]||'нет данных: тип')} · ${esc(clientWho(d.managerId))}`,pr?esc(dealSumText(d)):'')).join('')}</ul>`;
}
function clientLeads(list){
  if(!list.length) return '<p class="muted m0">Лидов, которые вам видны, у этого клиента нет.</p>';
  return `<ul class="crel">${list.slice().sort((a,b)=>b.at-a.at).map(l=>clientRow('open-lead',l.id,`<span><b>${esc(l.id)}</b> ${esc(Leads.title(l))}</span>`,
    `${esc(stageName(l))} · ${esc(Leads.SOURCE[l.source]||l.source)} · ${esc(fWhen(l.at))}`,'')).join('')}</ul>`;
}
// Отправки клиента (Clients.related): по его сделкам и по телефону получателя; строка открывает карточку заявки
function clientDispatches(list){
  if(!list.length) return '<p class="muted m0">Отправок у этого клиента нет.</p>';
  return `<ul class="crel">${list.slice().sort((a,b)=>String(b.id).localeCompare(String(a.id))).map(d=>clientRow('open-dispatch',d.id,`<span><b>${esc(d.number)}</b> ${esc(d.to.name)}</span>`,
    `${esc(stageName(d))} · ${esc(Dispatch.PURPOSE[d.purpose]||'нет данных: цель')} · ${esc(fD(d.when.date))}`,'')).join('')}</ul>`;
}
const CLIENT_MSGS=5;
function clientMsgs(list){
  if(!list.length) return '<p class="muted m0">Сообщений клиенту по видимым вам сделкам пока нет.</p>';
  const sorted=list.slice().sort((a,b)=>new Date(b.at)-new Date(a.at)),more=sorted.length-CLIENT_MSGS;
  return `<ul class="crel">${sorted.slice(0,CLIENT_MSGS).map(m=>`<li><div class="crow cmsg"><span class="crow-t"><span><b>${esc(CH[m.channel]||'нет данных: канал')}</b> · ${esc(m.deal)}${m.auto?' · автоматическое':''}${m.sim?' · имитация':''}</span><small>${esc(fWhen(m.at))}</small><span class="cmsg-t">${esc(m.text)}</span></span></div></li>`).join('')}</ul>${more>0?`<p class="hint">и ещё ${more} — все они в ленте ниже.</p>`:''}`;
}
function dClient(c){
  const edit=clientCanEdit(),rel=Clients.related(S,c.id,S.me);
  const sec=(t,n,html)=>`<div><h4 class="sh">${t}${n===null?'':' · '+n}</h4>${html}</div>`;
  const locked=edit?'':`<p class="lock">${ic('lock')}${CLIENT_NO_EDIT} Вам карточка открыта на просмотр.</p>`;
  return {kind:'Клиент '+c.id,title:esc(c.name),sub:`${esc(Clients.KIND[c.kind]||'нет данных: вид')}${c.demo?' · пример':''}`,body:`${locked}${clientFields(c,edit)}
    ${sec('Сделки',rel.deals.length,clientDeals(rel.deals))}${sec('Лиды',rel.leads.length,clientLeads(rel.leads))}${sec('Сообщения',rel.msgs.length,clientMsgs(rel.msgs))}
    ${sec('Отправки',rel.dispatches.length,clientDispatches(rel.dispatches))}
    ${sec('Лента',null,feedHtml({t:'client',id:c.id}))}`};
}

// ——— действия ———
function clientsRefresh(){const box=byId('client-body');if(box&&S.view==='clients') box.innerHTML=clientsBody()}
A['client-new']=()=>{if(!clientCanEdit()) return toast(CLIENT_NO_EDIT,'warn');openModal('clientNew')};
A['client-kind']=el=>{clientsU().kind=Clients.KIND[el.dataset.k]?el.dataset.k:'';render()};
A['client-reset']=()=>{S.ui.clients=Object.assign({},CLIENTS_DEF);render()};
// «Похоже, это …»: имя — открыть карточку найденного (окно закрывается: оно лежит поверх карточки)
A['dup-open']=el=>{
  if(!Clients.byId(S,el.dataset.id)) return;
  closeModal();openDrawer('client',el.dataset.id);
};
// «Выбрать его»: в быстрой форме сделки — клиент выбирается в списке, в окне «Новый клиент» — открывается его карточка
A['dup-pick']=el=>{
  const c=Clients.byId(S,el.dataset.id);if(!c) return;
  if(S.ui.modal&&S.ui.modal.type==='dealNew'){
    const q=byId('dn-cq'),box=byId('dn-cres');
    if(q) q.value=c.name;
    if(box){box.innerHTML=dealClientOpts(c.name,c.id);dealPickSync()}
    toast(`Выбран существующий клиент ${c.id}: ${c.name}. Новый не заводится.`);
    return;
  }
  closeModal();openDrawer('client',c.id);
  toast(`Открыт существующий клиент ${c.id}: ${c.name}. Новый не заводится.`);
};

// ——— поля ———
ON.input['client-q']=t=>{clientsU().q=t.value;clientsRefresh()};
ON.input['client-dup']=()=>{
  const box=byId('cn-dup');
  if(box) box.innerHTML=clientDupHtml({phones:clientPhonesOf(byId('cn-phones').value),email:byId('cn-email').value,inn:byId('cn-inn').value});
};
// Поле карточки: одно поле — одна правка Clients.update. Выбор из списка перерисовывает всё,
// текст — только название в шапке, ленту и список за карточкой, чтобы не сбить ввод в соседнем поле.
ON.change['client-f']=t=>{
  if(!clientCanEdit()){toast(CLIENT_NO_EDIT,'warn');render();return}
  const id=t.dataset.id,f=t.dataset.f,r=Clients.update(S,id,{[f]:f==='phones'?clientPhonesOf(t.value):t.value},S.me,new Date());
  if(!r.ok){toast(r.reason,'warn');render();return}
  if(!r.changed.length) return;
  if(t.tagName==='SELECT') render();
  else{
    const c=Clients.byId(S,id),ttl=document.getElementById('dr-t'),fd=document.querySelector('#drawer-root .feed');
    if(ttl&&c) ttl.textContent=c.name;
    if(fd) fd.outerHTML=feedHtml({t:'client',id});
    clientsRefresh();
  }
  toast(`Клиент ${id}: «${CLIENT_FIELD[f]||f}» сохранено. Запись в ленте есть.`);
};

// ——— формы ———
FORMS['client-new']=()=>{
  if(!clientCanEdit()) return showErr('cn-err',CLIENT_NO_EDIT);
  const name=byId('cn-name').value.trim(),inn=byId('cn-inn').value.trim();
  if(!name) return showErr('cn-err','Напишите имя клиента или название компании.');
  const r=Clients.create(S,{name,kind:inn?'company':byId('cn-kind').value,inn,phones:clientPhonesOf(byId('cn-phones').value),email:byId('cn-email').value,address:byId('cn-addr').value,managerId:byId('cn-mgr').value||undefined},S.me,new Date());
  if(!r.ok) return showErr('cn-err',r.reason);
  closeModal();render();openDrawer('client',r.id);
  toast(`Клиент ${r.id} заведён: ${r.client.name}. Запись в ленте есть.`);
};

// ——— регистрация в реестрах оболочки ———
NAV.push({id:'clients',label:'Клиенты',icon:'person',group:'Продажи',order:15,hint:'Картотека клиентов: у каждого свои сделки, лиды, сообщения и лента событий.',ok:()=>can('clients')});
VIEWS.clients=vClients;
SEARCH.push({kind:'client',label:'Клиент',order:40,find:q=>!can('clients')?[]:clientsSeen(Clients.search(S,q)).map(c=>({title:c.name,sub:`${c.id}${c.inn?' · ИНН '+c.inn:''}`,open:`data-act="open-client" data-id="${esc(c.id)}"`}))});
DRAWERS.client=id=>{const c=can('clients')?Clients.byId(S,id):null;return c&&clientVisible(c)?dClient(c):null};
regRef('client','клиент',id=>!!Clients.byId(S,id),'open-client');
