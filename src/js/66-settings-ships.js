// Настройки → «Поставки»: правила директора «если <событие> — поставить этап <этап>».
// Правила лежат в S.shipRules [{id, on, when, then}]; событие и срабатывание считает ядро Ships (applyRules):
// приёмка зовёт его на «принято на складе», шаг перевозчика — на «перевозчик: груз в точке …» и «таможня пройдена».
// Срабатывание видно в истории поставки с пометкой «правило: …».

// События для выбора: подписи — Ships.eventLabel, одно место. Китай — начало маршрута: груз туда не «приходит».
const SHIP_RULE_EVENTS=()=>[
  'received',
  ...Ships.NODES.filter(n=>n.id!=='cn').map(n=>'carrier:'+n.id),
  'carrier',
  'customs'
];
// Этапы воронки поставок «едут к нам»: на них правило ставит поставку
const shipRuleStages=()=>(shipPipe('in')||{stages:[]}).stages;
const shipRules=()=>S.shipRules||[];

function shipRuleEventSel(r,attrs){
  const evs=SHIP_RULE_EVENTS();
  if(!evs.includes(r.when)) evs.push(r.when);
  return `<select ${attrs} class="inp sm">${evs.map(ev=>`<option value="${esc(ev)}" ${ev===r.when?'selected':''}>${esc(Ships.eventLabel(ev))}</option>`).join('')}</select>`;
}
function shipRuleStageSel(r,attrs){
  const st=shipRuleStages(),known=st.some(x=>x.id===r.then);
  return `<select ${attrs} class="inp sm">${known?'':`<option value="" selected>нет данных: этап</option>`}${st.map(x=>`<option value="${esc(x.id)}" ${x.id===r.then?'selected':''}>${esc(x.name)}${x.flag==='final'?' (на складе)':''}</option>`).join('')}</select>`;
}
function vShipSettings(){
  const rules=shipRules();
  const rows=rules.map(r=>`<li class="rule srule" data-rule="${esc(r.id)}">
    <label class="sw"><input type="checkbox" id="sr-on-${esc(r.id)}" data-on="ship-rule-on" data-id="${esc(r.id)}" ${r.on?'checked':''} aria-label="Правило включено"><span class="sw-t" aria-hidden="true"></span></label>
    <div class="sr-body"><div class="field"><label for="sr-when-${esc(r.id)}">Если</label>${shipRuleEventSel(r,`id="sr-when-${esc(r.id)}" data-on="ship-rule-when" data-id="${esc(r.id)}"`)}</div>
    <div class="field"><label for="sr-then-${esc(r.id)}">Поставить этап</label>${shipRuleStageSel(r,`id="sr-then-${esc(r.id)}" data-on="ship-rule-then" data-id="${esc(r.id)}"`)}</div></div>
    <button type="button" class="btn sm ghost" data-act="ship-rule-del" data-id="${esc(r.id)}" aria-label="Удалить правило">${ic('x')}Удалить</button>
  </li>`).join('');
  const add=`<form class="srule-add" data-form="ship-rule-add" novalidate>
    <div class="field"><label for="sr-new-when">Если</label>${shipRuleEventSel({when:'received'},'id="sr-new-when"')}</div>
    <div class="field"><label for="sr-new-then">Поставить этап</label>${shipRuleStageSel({then:(shipRuleStages().find(x=>x.flag==='final')||{}).id},'id="sr-new-then"')}</div>
    <button class="btn" type="submit">${ic('plus')}Добавить правило</button></form><p class="err" id="sr-err" hidden></p>`;
  return `<section class="card"><div class="card-h"><h3>Правила смены этапа поставки</h3></div><div class="card-b stack-s">
    <p class="hint">Правило «если событие — поставить этап» срабатывает само: когда склад принял поставку, когда перевозчик сообщил, что груз в точке, или когда пройдена таможня. Срабатывание видно в истории поставки с пометкой «правило». Выключенное правило ничего не делает. Правило срабатывает, только если этап поставки меняется.</p>
    <ul class="rules">${rows||'<li class="muted">Правил пока нет: добавьте первое ниже.</li>'}</ul>
    ${add}
  </div></section>`;
}

// ——— обработчики ———
const shipRuleOf=id=>shipRules().find(r=>r.id===id);
ON.change['ship-rule-on']=t=>{
  const r=shipRuleOf(t.dataset.id);if(!r) return;
  r.on=!!t.checked;
  toast(`Правило «если ${Ships.eventLabel(r.when)}» ${r.on?'включено':'выключено'}.`);
};
ON.change['ship-rule-when']=t=>{
  const r=shipRuleOf(t.dataset.id);if(!r) return;
  r.when=t.value;render();
  toast(`Правило теперь срабатывает на событие «${Ships.eventLabel(r.when)}».`);
};
ON.change['ship-rule-then']=t=>{
  const r=shipRuleOf(t.dataset.id),st=shipRuleStages().find(x=>x.id===t.value);if(!r||!st) return;
  r.then=st.id;render();
  toast(`Правило «если ${Ships.eventLabel(r.when)}» ставит этап «${st.name}».`);
};
A['ship-rule-del']=el=>{
  const i=shipRules().findIndex(r=>r.id===el.dataset.id);if(i<0) return;
  const [r]=S.shipRules.splice(i,1);
  render();toast(`Правило «если ${Ships.eventLabel(r.when)}» удалено.`);
};
FORMS['ship-rule-add']=()=>{
  const when=byId('sr-new-when').value,then=byId('sr-new-then').value,st=shipRuleStages().find(x=>x.id===then);
  if(!when||!st) return showErr('sr-err','Выберите событие и этап.');
  if(shipRules().some(r=>r.when===when&&r.then===then)) return showErr('sr-err','Такое правило уже есть.');
  if(!S.shipRules) S.shipRules=[];
  S.shipRules.push({id:Store.freeId(S.shipRules,'sr'),on:true,when,then});
  render();toast(`Правило добавлено: если ${Ships.eventLabel(when)} — «${st.name}». Оно включено.`);
};

SETTINGS_TABS.push({id:'ships',label:'Поставки',order:70,ok:()=>can('settings'),render:vShipSettings});
