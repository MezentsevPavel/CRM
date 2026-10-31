// Настройки → «Лиды и сделки»: откуда приходят лиды — Битрикс24, сайт напрямую или оба. Выбор лежит в S.leadSource и
// запоминается вместе с остальными данными. Рядом — что ещё живёт в Битриксе и что нужно, чтобы от него отказаться,
// и список причин отказа (S.lostReasons): его предлагает окно «Провалена» у сделки.
// Подключения в прототипе нет: лиды появляются кнопками «Имитация» (они есть и здесь, и в разделе «Лиды»).

// Что сейчас держит Битрикс24 (слова директора из брифа) и есть ли это в CRM уже сейчас.
// «Есть в CRM» — про прототип: раздел, который уже можно открыть; настоящих подключений ни у одного пункта нет.
const LEAD_BITRIX=[
  {what:'Почта, задачи',crm:'В CRM есть разделы «Почта» (ящики закупок и клиентов) и «Задачи». Почта работает как имитация: настоящий ящик не подключён.'},
  {what:'Лиды с сайта',crm:'В CRM есть раздел «Лиды». Настоящего приёма заявок с сайта в прототипе нет — заявки появляются кнопкой «Имитация».'},
  {what:'Лиды и сделки',crm:'В CRM есть «Лиды» и «Сделки»: лид сам уходит менеджеру своего типа, из него создаётся сделка в воронке B2B или B2C.'},
  {what:'Телефония или чаты',crm:'В CRM этого нет: телефонии нет, а сообщения клиентам в Telegram и MAX — имитация, наружу ничего не уходит.'},
];

function leadSettingsCounts(){
  const all=S.leads||[],by=k=>all.filter(l=>l.source===k).length;
  return {all:all.length,site:by('site'),bitrix:by('bitrix')};
}

// ——— причины отказа ———
// Список — S.lostReasons = [{id, name}]. Сделка и лид хранят сам текст причины (lostReason, reason), а не ссылку на список:
// удалить или переименовать причину можно, уже проваленные записи от этого не меняются.
const lostReasonList=st=>st.lostReasons||Deals.defaultReasons();
const lostReasonKey=s=>String(s==null?'':s).trim().toLowerCase();
// Сколько раз причина записана в проваленных сделках и закрытых лидах (по тексту)
const lostReasonUsed=(st,name)=>(st.deals||[]).filter(d=>d.lostReason===name).length+(st.leads||[]).filter(l=>l.reason===name).length;
// Проверка имени: не пустое и не повторяет другую причину (без учёта регистра). → текст ошибки или ''
function lostReasonCheck(st,name,selfId){
  const n=String(name==null?'':name).trim();
  if(!n) return 'Напишите причину отказа.';
  if(lostReasonList(st).some(r=>r.id!==selfId&&lostReasonKey(r.name)===lostReasonKey(n))) return `Причина «${n}» уже есть в списке.`;
  return '';
}
// Добавить причину. → {ok, id, reason}
function lostReasonAdd(st,name){
  const bad=lostReasonCheck(st,name);
  if(bad) return {ok:false,id:null,reason:bad};
  st.lostReasons=lostReasonList(st);
  const r={id:Store.freeId(st.lostReasons,'lr'),name:String(name).trim()};
  st.lostReasons.push(r);
  return {ok:true,id:r.id,reason:''};
}
// Переименовать причину. Тот же текст — ничего не менялось (changed:false). → {ok, changed, reason}
function lostReasonRename(st,id,name){
  const r=lostReasonList(st).find(x=>x.id===id);
  if(!r) return {ok:false,changed:false,reason:'Такой причины нет.'};
  const bad=lostReasonCheck(st,name,id);
  if(bad) return {ok:false,changed:false,reason:bad};
  const n=String(name).trim();
  if(n===r.name) return {ok:true,changed:false,reason:''};
  st.lostReasons=lostReasonList(st);
  st.lostReasons.find(x=>x.id===id).name=n;
  return {ok:true,changed:true,reason:''};
}
// Убрать причину из списка. Проваленные записи с этим текстом остаются как были. → {ok, name, reason}
function lostReasonRemove(st,id){
  const r=lostReasonList(st).find(x=>x.id===id);
  if(!r) return {ok:false,name:'',reason:'Такой причины нет.'};
  st.lostReasons=lostReasonList(st).filter(x=>x.id!==id);
  return {ok:true,name:r.name,reason:''};
}

function lostReasonsCard(){
  const list=lostReasonList(S);
  const rows=list.map(r=>{
    const n=lostReasonUsed(S,r.name);
    return `<li class="lreason"><input class="inp" value="${esc(r.name)}" data-on="reason-name" data-id="${esc(r.id)}" aria-label="Причина отказа: ${esc(r.name)}" autocomplete="off"><small class="muted">${n?`записана: ${n}`:'пока не использована'}</small><button type="button" class="btn ghost icon sm" data-act="reason-del" data-id="${esc(r.id)}" aria-label="Удалить причину «${esc(r.name)}»">${ic('x')}</button></li>`;
  }).join('');
  return `<section class="card"><div class="card-h"><h3>Причины отказа</h3></div><div class="card-b stack-s">
    <p class="m0">Этот список предлагает окно «Провалена» у сделки. Причин сейчас: <b>${list.length}</b>.</p>
    ${list.length?`<ul class="lreasons">${rows}</ul>`:'<p class="hint">Список пуст: при «Провалена» причину придётся писать своими словами.</p>'}
    <form class="rform" data-form="reason-add" novalidate><p class="sh">Новая причина</p><div class="lreason-new"><input id="lr-new" class="inp" placeholder="Например: не устроил срок поставки" aria-label="Новая причина отказа" autocomplete="off"><button type="submit" class="btn">${ic('plus')}Добавить</button></div><p class="err" id="lr-err" hidden></p></form>
    <p class="hint">Удалить или переименовать причину можно в любой момент: у уже проваленных сделок остаётся тот текст, который был записан.</p>
  </div></section>`;
}

function vLeadSettings(){
  const cur=Leads.SOURCES[S.leadSource]?S.leadSource:'both',n=leadSettingsCounts();
  const hint={
    bitrix:'Лиды приходят только из Битрикса24. Лиды «с сайта» принимать не будем.',
    site:'Лиды приходят только напрямую с сайта. Битрикс24 не используем.',
    both:'Лиды приходят и из Битрикса24, и напрямую с сайта.'
  };
  const radios=Object.entries(Leads.SOURCES).map(([k,l])=>`<label class="check lset-opt${cur===k?' on':''}"><input type="radio" name="lead-source" value="${k}" ${cur===k?'checked':''} data-on="lead-source"> <span><b>${esc(l)}</b><small>${esc(hint[k])}</small></span></label>`).join('');
  const rows=LEAD_BITRIX.map(r=>`<li><b>${esc(r.what)}</b><span>${esc(r.crm)}</span></li>`).join('');
  return `<section class="card"><div class="card-h"><h3>Откуда приходят лиды</h3></div><div class="card-b stack-s">
    <div class="lset-opts" role="radiogroup" aria-label="Источник лидов">${radios}</div>
    <p class="hint">Сейчас выбрано: <b>${esc(Leads.SOURCES[cur])}</b>. В CRM лидов: ${n.all} (с сайта — ${n.site}, из Битрикса24 — ${n.bitrix}); у каждого лида в карточке стоит метка, откуда он пришёл. Выбор запоминается.</p>
    <div class="bar"><button type="button" class="btn sm" data-act="lead-sim" data-source="site">${ic('plus')}Имитация: пришёл лид с сайта</button><button type="button" class="btn sm" data-act="lead-sim" data-source="bitrix">${ic('plus')}Имитация: пришёл лид из Битрикса24</button></div>
    <p class="hint">Если источник выключен, его кнопка лид не создаёт и сообщает, что источник сейчас не используется.</p>
  </div></section>
  ${lostReasonsCard()}
  <section class="card"><div class="card-h"><h3>Что ещё живёт в Битриксе24</h3></div><div class="card-b stack-s">
    <p class="m0">Сейчас в Битриксе24: «почта, задачи», лиды с сайта, лиды и сделки, телефония или чаты.</p>
    <ul class="lset-list">${rows}</ul>
    <p class="m0"><b>Чтобы отказаться от Битрикса24, CRM должна взять на себя всё это.</b> Почта, задачи, лиды и сделки в прототипе уже есть как экраны; телефонии и чатов нет.</p>
    <p class="warn-t m0">В прототипе никакого подключения к Битриксу24 и к сайту нет — это имитация: лиды создаются кнопками, наружу ничего не уходит.</p>
  </div></section>`;
}

ON.change['lead-source']=t=>{
  if(!t.checked&&t.checked!==undefined) return;
  const was=S.leadSource;
  if(!Leads.setSource(S,t.value)){toast('Такого источника лидов нет.','warn');return}
  render();
  toast(was===S.leadSource?`Источник лидов: «${Leads.SOURCES[S.leadSource]}».`:`Источник лидов теперь «${Leads.SOURCES[S.leadSource]}». Выбор сохранён.`);
};

// Причины отказа: добавить, переименовать, убрать. Каждое действие — короткое подтверждение; права — как у вкладки («Настройки»)
FORMS['reason-add']=()=>{
  if(!can('settings')){toast('Менять список причин могут те, у кого есть право на «Настройки».','warn');return}
  const inp=byId('lr-new'),r=lostReasonAdd(S,inp.value);
  if(!r.ok) return showErr('lr-err',r.reason);
  const name=lostReasonList(S).find(x=>x.id===r.id).name;
  render();
  toast(`Причина «${name}» добавлена: теперь она есть в окне «Провалена».`);
};
ON.change['reason-name']=t=>{
  if(!can('settings')){toast('Менять список причин могут те, у кого есть право на «Настройки».','warn');render();return}
  const was=(lostReasonList(S).find(x=>x.id===t.dataset.id)||{}).name,r=lostReasonRename(S,t.dataset.id,t.value);
  if(!r.ok){toast(r.reason,'warn');render();return}
  if(!r.changed) return;
  render();
  toast(`Причина «${was}» теперь называется «${t.value.trim()}». Уже проваленные сделки сохраняют прежний текст.`);
};
A['reason-del']=el=>{
  if(!can('settings')){toast('Менять список причин могут те, у кого есть право на «Настройки».','warn');return}
  const r=lostReasonRemove(S,el.dataset.id);
  if(!r.ok){toast(r.reason,'warn');return}
  render();
  toast(`Причина «${r.name}» убрана из списка. У уже проваленных сделок её текст остаётся.`);
};

SETTINGS_TABS.push({id:'leads',label:'Лиды и сделки',order:50,ok:()=>can('settings'),render:vLeadSettings});
