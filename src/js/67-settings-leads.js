// Настройки → «Лиды»: откуда приходят лиды — Битрикс24, сайт напрямую или оба. Выбор лежит в S.leadSource и
// запоминается вместе с остальными данными. Рядом — что ещё живёт в Битриксе и что нужно, чтобы от него отказаться.
// Подключения в прототипе нет: лиды появляются кнопками «Имитация» (они есть и здесь, и в разделе «Лиды»).

// Что сейчас держит Битрикс24 (слова директора из брифа) и есть ли это в CRM уже сейчас.
// «Есть в CRM» — про прототип: раздел, который уже можно открыть; настоящих подключений ни у одного пункта нет.
const LEAD_BITRIX=[
  {what:'Почта, задачи',crm:'В CRM есть разделы «Почта» (ящики закупок и клиентов) и «Задачи». Почта работает как имитация: настоящий ящик не подключён.'},
  {what:'Лиды с сайта',crm:'В CRM есть раздел «Лиды». Настоящего приёма заявок с сайта в прототипе нет — заявки появляются кнопкой «Имитация».'},
  {what:'Лиды и сделки',crm:'В CRM есть «Лиды» и «Клиенты и сделки»: лид сам уходит менеджеру своего типа, из него создаётся сделка в воронке B2B или B2C.'},
  {what:'Телефония или чаты',crm:'В CRM этого нет: телефонии нет, а сообщения клиентам в Telegram и MAX — имитация, наружу ничего не уходит.'},
];

function leadSettingsCounts(){
  const all=S.leads||[],by=k=>all.filter(l=>l.source===k).length;
  return {all:all.length,site:by('site'),bitrix:by('bitrix')};
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

SETTINGS_TABS.push({id:'leads',label:'Лиды',order:50,ok:()=>can('settings'),render:vLeadSettings});
