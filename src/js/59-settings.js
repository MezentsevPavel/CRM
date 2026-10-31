// Раздел «Настройки»: вкладки из реестра SETTINGS_TABS, по order слева направо.
// Вкладка — {id, label, order, ok:()=>bool, render:()=>html}; render — вид S → HTML, состояние не меняет.
// Следующий таск добавляет свою вкладку одной строкой в своём файле: SETTINGS_TABS.push({…}).
// Порядок вкладок по спецификации (R34): Внешний вид 10 · Уведомления · Воронки · Почта · Лиды ·
// Склады и юрлица · Поставки · Роли и права · Данные 90.
const SETTINGS_TABS=[];
// Вкладки, открытые текущему человеку
const settingsTabs=()=>SETTINGS_TABS.filter(t=>t.ok()).sort((a,b)=>a.order-b.order);
// Открытая вкладка: выбранная (S.ui.setTab), если её видно этому человеку, иначе первая видимая
const settingsTab=()=>{const vis=settingsTabs();return vis.find(t=>t.id===S.ui.setTab)||vis[0]||null};

function vSettings(){
  const vis=settingsTabs(),cur=settingsTab();
  const tabs=`<div class="seg set-tabs" role="tablist" aria-label="Вкладки настроек">${vis.map(t=>`<button type="button" role="tab" aria-selected="${t===cur}" class="${t===cur?'on':''}" data-act="set-tab" data-tab="${esc(t.id)}">${esc(t.label)}</button>`).join('')}</div>`;
  return `<div class="bar">${tabs}</div>${cur?cur.render():''}`;
}

SETTINGS_TABS.push(
  {id:'look',label:'Внешний вид',order:10,ok:()=>true,render:()=>`<section class="card"><div class="card-h"><h3>Тема</h3></div><div class="card-b stack-s">
    ${themeSwitch(false)}
    <p class="hint">«Как в системе» — светлая или тёмная, как настроено на этом устройстве, и меняется вместе с ним. Тот же переключатель — значками в шапке. Выбор запоминается в этом браузере.</p>
  </div></section>`},
  {id:'data',label:'Данные',order:90,ok:()=>can('settings'),render:()=>`<section class="card"><div class="card-h"><h3>Данные прототипа</h3></div><div class="card-b stack-s">
    <p class="m0"><b>Где хранятся:</b> в этом браузере, на этом компьютере. В другом браузере или на другом компьютере — свои данные, общего сервера у прототипа нет.</p>
    <p class="hint">Сброс вернёт задачи, поставки, резервы, сделки, уведомления и остальное к исходным примерам. Перед сбросом прототип переспросит.</p>
    <div><button type="button" class="btn" data-act="reset">Сбросить данные прототипа</button></div>
  </div></section>`}
);

NAV.push({id:'settings',label:'Настройки',icon:'sliders',group:'Настройки',order:10,ok:()=>settingsTabs().length>0});
VIEWS.settings=vSettings;
A['set-tab']=el=>{S.ui.setTab=el.dataset.tab;render()};
