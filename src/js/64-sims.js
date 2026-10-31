// Раздел «Пульт проверки»: все имитации внешних событий в одном месте (директор и тот, у кого есть право «admin»).
// Имитации регистрируют сами разделы: SIMS.push({id, label, run}) — лид с сайта и из Битрикса (60), письмо (61), статус от
// перевозчика и прибытие груза (54). run() делает событие и возвращает {text — что произошло одной строкой, view — раздел,
// где это смотреть, id? — карточка в этом разделе}. Здесь — только экран: что запустили, что вышло и ссылка «посмотреть».
// Последний результат каждой имитации лежит в S.ui.sims (не сохраняется).

Object.assign(IC,{play:'<path d="M7 4.5l12 7.5-12 7.5z"/>'});

// Пульт открыт директору и тому, кому дали право «Управлять сотрудниками и правами»
const simsOpen=()=>can('admin');
// «Имитация: пришёл лид с сайта» → «Пришёл лид с сайта»: слово «имитация» показывает метка рядом
const simTitle=s=>{const t=String(s.label||'').replace(/^Имитация:\s*/i,'');return t.charAt(0).toUpperCase()+t.slice(1)};
// Порядок карточек: как их называют в задаче — лид с сайта, лид из Битрикса, письмо, статус перевозчика, прибытие груза;
// имитации, о которых пульт не знает, идут следом в порядке регистрации
const SIM_ORDER=['lead-site','lead-bitrix','mail','carrier','arrival'];
const simList=()=>{const k=s=>{const i=SIM_ORDER.indexOf(s.id);return i<0?SIM_ORDER.length:i};return SIMS.map((s,i)=>({s,i})).sort((a,b)=>k(a.s)-k(b.s)||a.i-b.i).map(x=>x.s)};
const simLast=id=>(S.ui.sims||{})[id]||null;
const simViewName=v=>(NAV.find(n=>n.id===v)||{}).label||'';

// Ссылка «где смотреть»: есть, если раздел открыт этому человеку; нет — подпись без кнопки
function simLink(s,r){
  const n=NAV.find(x=>x.id===r.view);
  if(!n) return '';
  if(!n.ok()) return `<p class="muted sm m0">Смотреть: раздел «${esc(n.label)}» вам недоступен.</p>`;
  return `<button type="button" class="btn sm" data-act="sim-open" data-id="${esc(s.id)}">${ic('arrow')}Посмотреть: ${esc(n.label)}</button>`;
}
function simCard(s){
  const r=simLast(s.id);
  const out=r?`<div class="sim-out" role="status"><p class="m0"><b>Что произошло:</b> ${esc(r.text)}</p><small class="muted">${esc(fWhen(r.at))}</small>${simLink(s,r)}</div>`
    :'<p class="muted sm m0">Пока не запускали.</p>';
  return `<section class="card sim"><div class="card-h"><h3>${esc(simTitle(s))}</h3><span class="pill sm">имитация</span></div><div class="card-b stack-s"><div><button type="button" class="btn pri" data-act="sim-run" data-id="${esc(s.id)}">${ic('play')}Запустить</button></div>${out}</div></section>`;
}
function vSims(){
  if(!SIMS.length) return `<section class="card">${emptyState('Имитаций нет.')}</section>`;
  return `<p class="hint">Настоящих подключений к сайту, Битриксу, почте и перевозчикам в прототипе нет. Каждая кнопка ниже изображает такое событие: в CRM появляется настоящая запись и уведомление, а под кнопкой — что вышло и куда посмотреть.</p>
  <div class="sims">${simList().map(simCard).join('')}</div>`;
}

// Куда вести ссылку, если у результата есть id: открыть карточку или выбрать письмо
const SIM_OPEN={
  leads:id=>openDrawer('lead',id),
  logistics:id=>openDrawer('ship',id),
  dispatch:id=>openDrawer('dispatch',id),
  deals:id=>openDrawer('deal',id),
  mail:id=>{
    const l=mailData().letters.find(x=>x.id===id);if(!l) return;
    Object.assign(mailU(),{box:l.boxId,folder:'all',q:''});
    A['mail-open']({dataset:{id}});
  }
};

A['sim-run']=el=>{
  const s=SIMS.find(x=>x.id===el.dataset.id);
  if(!s||!simsOpen()) return;
  const r=s.run()||{text:'Имитация ничего не вернула.',view:'sims'};
  (S.ui.sims||(S.ui.sims={}))[s.id]={text:r.text,view:r.view,id:r.id,at:new Date()};
  render();
};
A['sim-open']=el=>{
  const r=simLast(el.dataset.id);if(!r) return;
  go(r.view);
  if(r.id&&SIM_OPEN[r.view]) SIM_OPEN[r.view](r.id);
};

NAV.push({id:'sims',label:'Пульт проверки',icon:'play',group:'Управление',order:20,ok:simsOpen,hint:'Здесь запускают то, что в жизни приходит снаружи: лид, письмо, статус перевозчика, прибытие груза.'});
VIEWS.sims=vSims;
