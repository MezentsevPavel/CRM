// Оболочка: состояние S и его сохранение, тема, разделы NAV, боковая панель, «Кто я», уведомления, окна,
// карточка справа, поиск, переходы, render(), действия A, формы FORMS, обработчики событий.
// Права — Perms.can(S, S.me, …), этапы — по id и флагам Pipes, уведомления — только Notify.push.

// ——— состояние и сохранение в браузере ———
// S поднимает запуск (90-boot.js): startState(). До запуска — null.
let S=null;
// Чистое демо-состояние: seed() + то, что не сохраняется (ui).
const freshState=()=>Object.assign(seed(),{ui:defaultUi()});
// Сохранённое в браузере состояние или null (нет, битое, чужая версия схемы).
function savedState(){
  let raw=null;
  try{raw=localStorage.getItem(Store.KEY)}catch(_){return null}
  const st=Store.load(raw);
  if(!st) return null;
  // чего нет в сохранённом (раздел добавлен позже) — берём из демо
  const base=seed();
  for(const k of Object.keys(base)) if(!(k in st)) st[k]=base[k];
  if(!st.people.some(p=>p.id===st.me)) st.me=st.people[0]?.id||'';
  st.ui=defaultUi();
  return st;
}
// Раздел из адреса страницы (#team) или ''.
function hashView(){try{return /^#[a-z]+$/.test(location.hash)?location.hash.slice(1):''}catch(_){return ''}}
function startState(){
  const st=savedState()||freshState();
  const v=hashView();if(v) st.view=v;
  return st;
}
// Записать S в браузер. Не влезает — без фото и короткое сообщение; совсем не влезает — сообщение.
let _photoWarn=0,_saveT=0;
function save(){
  if(!S) return null;
  let r=Store.dump(S),ok=true;
  try{localStorage.setItem(Store.KEY,r.text)}catch(_){
    // браузер дал меньше места, чем рассчитывает Store, — сохраняем без фото
    r=Store.dump(S,0);
    try{localStorage.setItem(Store.KEY,r.text)}catch(_){ok=false}
  }
  if(!ok) toast('Изменения не сохранены — мало места в браузере','warn');
  else if(r.droppedPhotos&&r.droppedPhotos!==_photoWarn) toast('Фото не сохранены — мало места в браузере','warn');
  _photoWarn=r.droppedPhotos;
  return {ok,droppedPhotos:r.droppedPhotos,fits:r.fits&&ok};
}
// Для ввода с клавиатуры — не на каждую букву
const saveSoon=()=>{clearTimeout(_saveT);_saveT=setTimeout(save,400)};
// Сброс к демо: человек, раздел и тема остаются, данные — как в seed()
function resetData(){
  const m=S?.me,v=S?.view,th=S?.prefs?.theme;
  S=freshState();
  if(S.people.some(p=>p.id===m)) S.me=m;
  if(v) S.view=v;
  if(th) S.prefs.theme=th;
  closeModal();render();
  toast('Данные прототипа сброшены к исходным');
}

// ——— тема ———
// Выбор человека — S.prefs.theme: 'light', 'dark' или 'auto' (как в системе). На <html> ставится
// data-theme="light|dark": для «как в системе» — по prefers-color-scheme устройства. Цвета тем — 00-tokens.css.
const THEMES=[['light','Светлая','sun'],['dark','Тёмная','moon'],['auto','Как в системе','monitor']];
Object.assign(IC,{
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>',
  moon:'<path d="M19.5 14.6A7.8 7.8 0 0 1 9.4 4.5a7.8 7.8 0 1 0 10.1 10.1z"/>',
  monitor:'<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8.5 20h7M12 16.5V20"/>',
  sliders:'<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'
});
const themePref=()=>THEMES.some(t=>t[0]===S?.prefs?.theme)?S.prefs.theme:'auto';
const systemDark=()=>{try{return typeof matchMedia==='function'&&matchMedia('(prefers-color-scheme: dark)').matches}catch(_){return false}};
// Какая тема на экране при выборе pref: 'light' или 'dark'
const themeOf=pref=>pref==='dark'||(pref==='auto'&&systemDark())?'dark':'light';
function applyTheme(){document.documentElement.dataset.theme=themeOf(themePref())}
function setTheme(t){
  if(!THEMES.some(x=>x[0]===t)) return;
  S.prefs.theme=t;render();
}
// Переключатель темы — один для шапки (compact: только значки) и для «Настройки → Внешний вид»
const themeSwitch=compact=>`<div class="seg theme-seg${compact?' compact':''}" role="group" aria-label="Тема">${THEMES.map(([k,l,i])=>{const on=themePref()===k;return `<button type="button" class="${on?'on':''}" data-act="theme" data-theme="${k}" aria-pressed="${on}" title="${l}">${ic(i)}<span>${l}</span></button>`}).join('')}</div>`;

// ——— разделы ———
// Раздел: {id, label, icon, group, order, ok:()=>bool, badge?:()=>n}. Группа — одна из GROUPS (по порядку
// сверху вниз), внутри группы — по order. Следующие таски добавляют раздел в своём файле: NAV.push({…}).
const NAV=[
  {id:'home',label:'Сегодня',icon:'home',group:'Работа',order:10,ok:()=>true},
  {id:'tasks',label:'Задачи',icon:'tasks',group:'Работа',order:20,ok:()=>true,badge:()=>S.tasks.filter(t=>!isDone(t)&&taskMine(t)).length},
  {id:'notifications',label:'Уведомления',icon:'bell',group:'Работа',order:30,ok:()=>true,badge:()=>unread().length,hot:true},
  {id:'stock',label:'Товары и остатки',icon:'box',group:'Товар',order:10,ok:()=>can('stock')},
  {id:'logistics',label:'Поставки и перевозки',icon:'truck',group:'Товар',order:20,ok:()=>can('stock')||can('logistics'),badge:()=>S.shipments.filter(s=>!isDone(s)).length},
  {id:'receiving',label:'Приёмка на складе',icon:'camera',group:'Товар',order:30,ok:()=>can('receive'),badge:()=>S.shipments.filter(awaitsReceipt).length,hot:true},
  {id:'deals',label:'Сделки',icon:'users',group:'Продажи',order:10,ok:()=>can('clients')},
  {id:'messages',label:'Сообщения клиентам',icon:'chat',group:'Продажи',order:20,ok:()=>can('write')||can('auto')},
  {id:'team',label:'Сотрудники и права',icon:'shield',group:'Управление',order:10,ok:()=>can('admin')}
];
// Разделы, открытые текущему человеку: только они попадают в меню
const navItems=()=>NAV.filter(n=>n.ok());
const GROUPS=['Работа','Товар','Продажи','Управление','Настройки'];

function renderSide(){
  const vis=navItems(),m=me();
  let h='';
  for(const g of GROUPS){
    const items=vis.filter(n=>n.group===g).sort((a,b)=>(a.order||0)-(b.order||0));
    if(!items.length) continue;
    h+=`<div class="nav-g"><h4>${g}</h4>${items.map(n=>{const b=n.badge?n.badge():0;return `<button class="nav-i ${S.view===n.id?'on':''}" data-act="go" data-view="${n.id}">${ic(n.icon)}<span>${n.label}</span>${b?`<span class="cnt ${n.hot?'hot':''}">${b}</span>`:''}</button>`}).join('')}</div>`;
  }
  h+=`<div class="me">${av(m)}<div><b>${esc(m.name)}</b><small>${esc(roleName(m))}</small></div></div>`;
  byId('side').innerHTML=h;
}
function updBell(){const n=unread().length,b=byId('bell-n');b.hidden=!n;b.textContent=n>99?'99+':n}
// «Кто я»: каждый человек с ролью — «Имя — Роль»
const whoOptions=()=>S.people.map(p=>`<option value="${esc(p.id)}" ${p.id===S.me?'selected':''}>${esc(p.name)} — ${esc(roleName(p))}</option>`).join('');

// ——— уведомления ———
// Вид не меняет состояние: прочитанным раздел помечает render() после отрисовки.
function vNotes(){
  const firm=can('firm'),all=firm&&S.ui.noteScope==='all';
  let list=S.notes.filter(n=>all||n.to.includes(S.me));
  if(S.ui.noteK!=='all') list=list.filter(n=>n.kind===S.ui.noteK);
  const un=new Set(unread().map(n=>n.id));
  let h=`<div class="bar"><div class="seg">${[['all','Все'],...Object.entries(KIND).map(([k,v])=>[k,v.l])].map(([k,l])=>`<button class="${S.ui.noteK===k?'on':''}" data-act="note-k" data-k="${k}">${l}</button>`).join('')}</div>${firm?`<div class="seg">${[['mine','Мне'],['all','Вся фирма']].map(([k,l])=>`<button class="${S.ui.noteScope===k?'on':''}" data-act="note-scope" data-k="${k}">${l}</button>`).join('')}</div>`:''}</div>`;
  h+=`<p class="hint">Под каждым уведомлением — кто его получил. ${firm?'Директор видит поток всей фирмы, остальные — только своё.':''}</p>`;
  h+=`<section class="card">${list.length?`<ul class="notes">${list.map(n=>noteRow(n,un.has(n.id),true)).join('')}</ul>`:'<p class="empty">Под этот фильтр ничего нет.</p>'}</section>`;
  return h;
}

// ——— окна ———
const mHead=t=>`<div class="modal-h"><h3>${t}</h3><button type="button" class="btn ghost icon" data-act="close-modal" aria-label="Закрыть">${ic('x')}</button></div>`;
const mFoot=b=>`<div class="modal-f"><button type="button" class="btn" data-act="close-modal">Отмена</button><button type="submit" class="btn pri">${b}</button></div>`;
function mTask(){
  const m=me(),all=can('tasksAssign');
  const ppl=S.people.filter(p=>all||p.dept===m.dept),dps=S.depts.filter(d=>all||d.id===m.dept);
  return `<form data-form="task" novalidate>${mHead('Новая задача')}<div class="modal-b">
    <div class="field"><label for="t-title">Что нужно сделать</label><input id="t-title" class="inp" placeholder="Например: подготовить КП на СЭС 15 кВт" autocomplete="off"></div>
    <div class="field"><label for="t-to">Кому</label><select id="t-to" class="inp"><optgroup label="Отдел целиком">${dps.map(d=>`<option value="d:${esc(d.id)}">Отдел «${esc(d.name)}»</option>`).join('')}</optgroup><optgroup label="Сотрудник">${ppl.map(p=>`<option value="p:${esc(p.id)}">${esc(p.name)} — ${esc(roleName(p).toLowerCase())}</option>`).join('')}</optgroup></select></div>
    <div class="grid2"><div class="field"><label for="t-due">Срок</label><input id="t-due" type="date" class="inp" value="${iso(day(2))}"></div><div class="field"><label for="t-prio">Важность</label><select id="t-prio" class="inp"><option value="normal">Обычная</option><option value="high">Срочно</option></select></div></div>
    ${can('clients')?`<div class="field"><label for="t-deal">Сделка</label><select id="t-deal" class="inp"><option value="">Без сделки</option>${S.deals.map(d=>`<option value="${d.id}">${d.id} · ${esc(d.client)}</option>`).join('')}</select></div>`:''}
    <div class="field"><label for="t-desc">Подробности</label><textarea id="t-desc" class="inp" rows="3" placeholder="Что важно знать исполнителю"></textarea></div>
    ${all?'':'<p class="hint">У вашей роли нет права ставить задачи другим отделам — в списке только ваш отдел.</p>'}
    <p class="err" id="t-err" hidden></p></div>${mFoot('Поставить и уведомить')}</form>`;
}
function mStage(s){
  // входящую поставку на завершающий этап ставит склад при приёмке
  const stg=stagesFor(s),locked=x=>s.dir==='in'&&x.flag==='final';
  const def=stg.slice(stagePos(s)+1).find(x=>!locked(x))?.id||s.stageId;
  return `<form data-form="stage" data-id="${s.id}" novalidate>${mHead('Отметка по перевозке '+s.id)}<div class="modal-b">
    <div class="field"><label for="st-stage">Этап</label><select id="st-stage" class="inp">${stg.map(x=>`<option value="${esc(x.id)}" ${x.id===def?'selected':''} ${locked(x)?'disabled':''}>${esc(x.name)}${locked(x)?' — ставит склад при приёмке':''}</option>`).join('')}</select></div>
    <p class="hint">Сейчас: ${esc(shipWhere(s))}. Положение груза на маршруте поменяется само, вместе с этапом.</p>
    <div class="field"><label for="st-eta">${s.dir==='in'?'Ожидается на складе':'Доставка клиенту'}</label><input id="st-eta" type="date" class="inp" value="${iso(s.eta)}"></div>
    <div class="field"><label for="st-note">Комментарий</label><input id="st-note" class="inp" placeholder="Например: водитель звонил, будет к обеду"></div>
    <p class="hint">Отметка запишется в историю как «вручную», уведомление получат все сотрудники, кроме тех, кто выключил вид «Перевозки».</p>
  </div>${mFoot('Отметить и уведомить')}</form>`;
}
let _ir=0;
const irow=()=>{_ir++;return `<div class="irow"><select class="inp" id="ns-sku-${_ir}" aria-label="Товар">${S.products.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select><input class="inp" id="ns-qty-${_ir}" type="number" min="1" value="1" aria-label="Количество"></div>`};
function mShip(){
  // этап новой поставки — любой до «прибыло» (этапы с флагами ставит приёмка)
  const stg=shipPipe('in')?.stages||[],stop=stg.findIndex(x=>x.flag),open=stop<0?stg:stg.slice(0,stop);
  return `<form data-form="ship" novalidate>${mHead('Новая поставка')}<div class="modal-b">
    <div class="field"><label for="ns-from">Откуда</label><input id="ns-from" class="inp" placeholder="Поставщик и город"></div>
    <div class="grid2"><div class="field"><label for="ns-car">Как едет</label><select id="ns-car" class="inp">${CARRIERS.map(c=>`<option>${c}</option>`).join('')}</select></div><div class="field"><label for="ns-doc">Номер накладной</label><input id="ns-doc" class="inp" placeholder="Если уже известен"></div>
    <div class="field"><label for="ns-stage">Этап сейчас</label><select id="ns-stage" class="inp">${open.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select></div><div class="field"><label for="ns-eta">Ожидается на складе</label><input id="ns-eta" type="date" class="inp" value="${iso(day(7))}"></div></div>
    <div class="grid2"><div class="field"><label for="ns-city">Куда едет (город)</label><select id="ns-city" class="inp">${S.cities.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></div><div class="field"><label for="ns-ent">На какое юрлицо</label><select id="ns-ent" class="inp">${S.entities.map(e=>`<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('')}</select></div></div>
    <p class="hint">Маршрут: Китай → Чита (таможня и перевалка) → выбранный город.</p>
    <div class="field"><span class="lbl">Что едет</span><div id="ns-items" class="stack-s" style="gap:8px">${irow()}</div><div><button type="button" class="btn sm ghost" data-act="add-irow">${ic('plus')}Ещё позиция</button></div></div>
    <p class="err" id="ns-err" hidden></p></div>${mFoot('Создать и уведомить')}</form>`;
}
function mProduct(){
  return `<form data-form="product" novalidate>${mHead('Новый товар')}<div class="modal-b">
    <div class="grid2"><div class="field"><label for="np-name">Наименование</label><input id="np-name" class="inp" placeholder="Как товар называется в документах"></div><div class="field"><label for="np-unit">Единица</label><select id="np-unit" class="inp"><option>шт</option><option>м</option><option>пар</option><option>компл.</option></select></div></div>
    <div class="grid2"><div class="field"><label for="np-cat">Категория</label><select id="np-cat" class="inp">${Catalog.cats(S).map(c=>`<option>${esc(c)}</option>`).join('')}</select></div>${can('prices')?'<div class="field"><label for="np-price">Цена, ₽</label><input id="np-price" class="inp" type="number" min="0" placeholder="Пусто — «нет данных»"></div>':''}</div>
    <p class="err" id="np-err" hidden></p></div>${mFoot('Добавить')}</form>`;
}
const mReset=()=>`<form data-form="reset" novalidate>${mHead('Сбросить данные прототипа?')}<div class="modal-b">
    <p class="m0">Задачи, поставки, резервы, сделки, уведомления и остальные данные прототипа вернутся к исходным примерам. Всё, что вы меняли, пропадёт — отменить сброс нельзя.</p>
    <p class="hint">Останутся: кто вы в «Кто я», открытый раздел и тема.</p>
  </div>${mFoot('Сбросить')}</form>`;
const MODALS={task:()=>mTask(),stage:id=>mStage(ship(id)),ship:()=>mShip(),product:()=>mProduct(),reset:()=>mReset()};
function openModal(type,id){S.ui.modal={type,id};const r=byId('modal-root');r.innerHTML=`<div class="modal-wrap"><div class="modal" role="dialog" aria-modal="true">${MODALS[type](id)}</div></div>`;setTimeout(()=>r.querySelector('input:not([type=checkbox]),select')?.focus(),30)}
function closeModal(){if(S) S.ui.modal=null;byId('modal-root').innerHTML=''}
const showErr=(id,t)=>{const e=byId(id);e.textContent=t;e.hidden=false};

// ——— карточка справа ———
// Реестр карточек: DRAWERS.<type> = id => ({kind, title, sub, body}) или null (нет записи или нет права —
// карточка не открывается). Раздел кладёт свою карточку в своём файле: DRAWERS.product = id => …
const DRAWERS={};
function openDrawer(type,id){S.ui.drawer={type,id};renderDrawer()}
function closeDrawer(){S.ui.drawer=null;renderDrawer()}
function renderDrawer(){
  const root=byId('drawer-root'),d=S.ui.drawer;
  if(!d){root.innerHTML='';root.dataset.k='';return}
  const f=Object.hasOwn(DRAWERS,d.type)?DRAWERS[d.type]:null,c=f?f(d.id):null;
  if(!c){S.ui.drawer=null;root.innerHTML='';root.dataset.k='';return}
  const k=d.type+':'+d.id,same=root.dataset.k===k,sc=same?(root.querySelector('.drawer-b')?.scrollTop||0):0;
  root.classList.toggle('still',same);
  root.innerHTML=`<div class="scrim" data-act="close-drawer"></div><aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="dr-t"><div class="drawer-h"><div class="dh-t"><small>${esc(c.kind)}</small><h2 id="dr-t">${c.title}</h2>${c.sub?`<p>${c.sub}</p>`:''}</div><button class="btn ghost icon" data-act="close-drawer" aria-label="Закрыть">${ic('x')}</button></div><div class="drawer-b">${c.body}</div></aside>`;
  if(same){const b=root.querySelector('.drawer-b');if(b) b.scrollTop=sc}
  root.dataset.k=k;
}

// ——— всплывающие подсказки ———
function toast(msg,kind){
  const el=document.createElement('div');el.className='toast';
  el.innerHTML=`${ic(kind==='warn'?'alert':'check')}<span>${esc(msg)}</span>`;
  byId('toasts').appendChild(el);
  setTimeout(()=>{el.classList.add('out');setTimeout(()=>el.remove(),320)},4800);
}

// ——— поиск ———
function searchRes(q){
  q=q.trim().toLowerCase();if(q.length<2) return [];
  const r=[],has=s=>s.toLowerCase().includes(q);
  if(can('stock')) Catalog.query(S,{q}).slice(0,6).forEach(p=>{const k=stockOf(p.id);r.push({type:'Товар',label:p.name,sub:k.known?`свободно ${qtyOf(k.free,p)}`:'остаток: нет данных',act:`data-act="open-product" data-pid="${esc(p.id)}"`})});
  if(can('clients')) Leads.dealsVisible(S,S.me).forEach(d=>{if(has(d.client+' '+d.id+' '+d.object)) r.push({type:'Сделка',label:d.client,sub:`${d.id} · ${d.object}`,act:`data-act="open-deal" data-id="${d.id}"`})});
  if(can('stock')||can('logistics')) S.shipments.forEach(s=>{if(has(s.id+' '+s.supplier+' '+s.to+' '+s.track)) r.push({type:'Перевозка',label:`${s.id} · ${s.supplier}`,sub:`${stageName(s)} · ${fD(s.eta)}`,act:`data-act="open-ship" data-id="${esc(s.id)}"`})});
  S.tasks.filter(taskVisible).forEach(t=>{if(has(t.title)) r.push({type:'Задача',label:t.title,sub:`${targetName(t)} · ${fRel(t.due)}`,act:`data-act="open-task" data-id="${t.id}"`})});
  return r.slice(0,9);
}

// ——— переходы ———
function go(v,tab){
  const n=NAV.find(x=>x.id===v);
  if(!n||!n.ok()){toast('У вас нет доступа к этому разделу','warn');return}
  S.view=v;if(tab) S.ui.logTab=tab;
  setNav(false);render();byId('scroll').scrollTop=0;
}
function setNav(open){S.ui.navOpen=open;byId('app').classList.toggle('nav-open',open)}
// «Кто я»: смотреть CRM глазами этого человека — его права, задачи, уведомления
function setMe(pid){
  if(!person(pid)) return;
  S.me=pid;S.ui.drawer=null;S.ui.taskF='all';closeModal();
  const vis=navItems(),hidden=NAV.filter(n=>!vis.includes(n)).map(n=>n.label),m=me();
  if(!vis.some(n=>n.id===S.view)) S.view='home';
  render();
  toast(`Теперь вы — ${m.name} (${roleName(m)}). ${hidden.length?'Недоступно: '+hidden.join(', ')+'.':'Доступно всё.'}`);
}
function setTaskStatus(id,stageId){
  const t=S.tasks.find(x=>x.id===id);if(!t||t.stageId===stageId) return;
  const stg=Pipes.stage(S,t.boardId,stageId);if(!stg) return;
  const m=me();t.stageId=stageId;
  Notify.push(S,'task',m.id,`Задача «${t.title}» — теперь «${stg.name}». Отметка: ${m.name}.`,new Date(),[t.from,...targetPeople(t.to)]);
  render();toast(`Статус «${stg.name}». Уведомление ушло тому, кто поставил задачу.`);
}

// ——— прокрутка колонок воронок ———
// Одно поведение для всех досок: раздел только ставит data-hscroll на контейнер, который листается вбок
// (так отмечены задачи, поставки, лиды, сделки; отправки — тем же атрибутом). Оболочка заворачивает контейнер в
// .hs и кладёт у краёв две кнопки «Листать влево/вправо». Стрелка видна, только когда с её стороны есть что листать
// и мышь у края (или на ней); пока курсор на стрелке, колонки плавно едут; доехали до конца — стрелка пропала.
// Карточку тащат у края — колонки едут сами. Пересчёт: прокрутка, размер окна, render() и любая перерисовка
// куска раздела (поиск в поставках и лидах) — по наблюдателю за #view. Сенсорный экран: стрелок нет, листают пальцем.
const HS_EDGE=64;     // полоса у края, px: мышь в ней — стрелка видна; карточка в ней — колонки едут сами
const HS_SPEED=720;   // px/с под курсором на стрелке
const HS_DRAG=1100;   // px/с у самой кромки при перетаскивании карточки
const HS_STEP=0.8;    // доля ширины контейнера за одно нажатие стрелки с клавиатуры
const HS_JUMP=0.4;    // при «меньше движения»: доля ширины за один скачок вместо плавной прокрутки
const HS_JUMP_MS=450; // и пауза между скачками, пока курсор на стрелке
Object.assign(IC,{
  chevL:'<path d="M15 5l-7 7 7 7"/>',
  chevR:'<path d="M9 5l7 7-7 7"/>'
});
// Куда ещё можно листать. el — {scrollLeft, clientWidth, scrollWidth}; доля пикселя на дробном масштабе не в счёт.
function hscrollCan(el){
  return {left:el.scrollLeft>1,right:el.scrollWidth-el.clientWidth-el.scrollLeft>1};
}
// Скорость прокрутки в px/с (минус — влево) для курсора в x над контейнером [left, right]: в полосе edge от кромки
// растёт от нуля до max, чем ближе к кромке, тем быстрее.
function hscrollEdgeSpeed(x,left,right,edge,max){
  edge=Math.min(edge,(right-left)/3);
  if(!(edge>0)) return 0;
  const l=left+edge-x,r=x-(right-edge);
  if(l>0) return -max*Math.min(1,l/edge);
  if(r>0) return max*Math.min(1,r/edge);
  return 0;
}
const hsArrow=d=>`<div class="hs-a hs-${d}" hidden><button type="button" class="hs-b" data-hs="${d}" aria-label="Листать ${d==='l'?'влево':'вправо'}">${ic(d==='l'?'chevL':'chevR')}</button></div>`;
const hsBox=el=>{const w=el.parentElement;return w&&w.classList.contains('hs')?w:null};
// Завернуть контейнер в .hs со стрелками. true — завернули сейчас (прокрутка при этом сбрасывается).
function hscrollWrap(el){
  if(hsBox(el)) return false;
  const w=document.createElement('div');w.className='hs';
  el.parentNode.insertBefore(w,el);w.appendChild(el);
  w.insertAdjacentHTML('beforeend',hsArrow('l')+hsArrow('r'));
  return true;
}
// Показать стрелку только с той стороны, куда ещё есть что листать
function hscrollUpdate(el){
  const w=hsBox(el);if(!w) return;
  const c=hscrollCan(el),l=w.querySelector('.hs-l'),r=w.querySelector('.hs-r');
  if(l) l.hidden=!c.left;
  if(r) r.hidden=!c.right;
}
// Все помеченные контейнеры раздела: завернуть, вернуть прокрутку (keep — положения до перерисовки), пересчитать
function hscrollSync(keep){
  const list=[...byId('view').querySelectorAll('[data-hscroll]')];
  list.forEach((el,i)=>{
    const fresh=hscrollWrap(el);
    if(fresh&&keep&&keep[i]) el.scrollLeft=keep[i];
    hscrollUpdate(el);
  });
}
// Раздел, который сейчас нарисован, и положения его досок: после перерисовки того же раздела (бросили карточку,
// сменили фильтр) доска остаётся на месте, а не уезжает к первой колонке
let _hsView='';
const hscrollKeep=()=>_hsView===S.view?[...byId('view').querySelectorAll('[data-hscroll]')].map(el=>el.scrollLeft):[];

// Прокрутка по кадрам: под курсором на стрелке и у края при перетаскивании. Работа одна на всех.
let _hsJob=null,_hsRaf=0,_hsNear=null;
const reducedMotion=()=>{try{return typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches}catch(_){return false}};
// speed 0 или нет контейнера — остановить; until — когда перестать, если события перетаскивания пропали
function hscrollRun(el,speed,until){
  if(!el||!speed){_hsJob=null;return}
  if(_hsJob&&_hsJob.el===el){_hsJob.speed=speed;_hsJob.until=until||0}
  else _hsJob={el,speed,until:until||0,t:0,pos:el.scrollLeft,acc:HS_JUMP_MS};
  if(!_hsRaf&&typeof requestAnimationFrame==='function') _hsRaf=requestAnimationFrame(hscrollFrame);
}
function hscrollFrame(now){
  _hsRaf=0;
  const j=_hsJob;if(!j) return;
  if(j.until&&now>j.until){_hsJob=null;return}
  const el=j.el,dt=j.t?Math.min(now-j.t,50):16,can=hscrollCan(el);
  j.t=now;
  if(j.speed<0?!can.left:!can.right){_hsJob=null;return}   // доехали до конца
  if(reducedMotion()){
    // «меньше движения»: вместо плавной прокрутки — скачки через паузу
    j.acc+=dt;
    if(j.acc>=HS_JUMP_MS){j.acc=0;el.scrollLeft+=Math.sign(j.speed)*Math.round(el.clientWidth*HS_JUMP)}
  }else{
    // дробный путь копим отдельно: браузер округляет scrollLeft, и медленная прокрутка иначе встала бы
    if(Math.abs(el.scrollLeft-j.pos)>2) j.pos=el.scrollLeft;
    j.pos+=j.speed*dt/1000;el.scrollLeft=j.pos;
  }
  _hsRaf=requestAnimationFrame(hscrollFrame);
}
const hscrollEl=w=>w&&w.querySelector('[data-hscroll]');
// Мышь над .hs: у левого или правого края — просим CSS показать стрелку этой стороны (data-near)
function hscrollPoint(e){
  if(e.pointerType&&e.pointerType!=='mouse') return;
  const w=e.target.closest?.('.hs');
  if(_hsNear&&_hsNear!==w){delete _hsNear.dataset.near;_hsNear=null}
  const el=hscrollEl(w);if(!el) return;
  const r=el.getBoundingClientRect(),side=e.clientX-r.left<HS_EDGE?'l':r.right-e.clientX<HS_EDGE?'r':'';
  if(side){w.dataset.near=side;_hsNear=w}else delete w.dataset.near;
}
function hscrollClearNear(){if(_hsNear){delete _hsNear.dataset.near;_hsNear=null}}

// ——— главный вывод ———
const VIEWS={home:vHome,tasks:vTasks,notifications:vNotes,stock:vStock,logistics:vLogistics,receiving:vReceiving,messages:vMessages,team:vTeam};
// Прямой переход (адрес, сохранённый раздел) туда, где у человека нет права: в меню раздела нет, на экране — это.
const vNoAccess=n=>`<section class="card deny"><span class="deny-ic">${ic('lock')}</span><h2>Нет доступа к разделу</h2><p>«${esc(n.label)}» закрыт для роли «${esc(roleName(me()))}». Права ролей меняют в разделе «Сотрудники и права».</p><button type="button" class="btn pri" data-act="go" data-view="home">${ic('home')}На главный экран</button></section>`;
function render(){
  applyTheme();
  // неизвестный раздел — «Сегодня»; известный, но без права — экран «Нет доступа»
  if(!NAV.some(n=>n.id===S.view&&VIEWS[n.id])) S.view='home';
  const n=NAV.find(x=>x.id===S.view),ok=n.ok();
  if(ok&&S.view==='receiving') syncRcv();
  const keep=hscrollKeep();
  byId('view').innerHTML=ok?VIEWS[S.view]():vNoAccess(n);
  hscrollSync(keep);_hsView=S.view;
  // открыли по адресу (#…) — адрес следует за разделом, иначе перезагрузка вернёт старый
  try{const h=hashView();if(h&&h!==S.view) history.replaceState(null,'','#'+S.view)}catch(_){}
  // открыл раздел «Уведомления» — свои прочитаны (подсвечены один раз, при этой отрисовке)
  if(ok&&S.view==='notifications') Notify.markRead(S,S.me);
  Acts.notify(S,new Date());
  renderSide();
  byId('ttl').textContent=n.label;
  byId('role').innerHTML=whoOptions();
  byId('theme-sw').innerHTML=themeSwitch(true);
  updBell();renderDrawer();save();
}

// ——— реестры полей и имитаций ———
// Поля data-on: ON.input['<key>'] и ON.change['<key>'] = (el, e) => … — раздел регистрирует свои в своём файле.
const ON={input:{},change:{}};
// Имитации внешних событий для «Пульта проверки»: SIMS.push({id, label, run:()=>void}) — в файле раздела.
const SIMS=[];

// ——— действия по клику ———
const A={
  go:el=>go(el.dataset.view,el.dataset.tab),
  'nav-toggle':()=>setNav(!S.ui.navOpen),
  // сброс — только после подтверждения в окне (и из полосы «Прототип», и из «Настройки → Данные»)
  reset:()=>openModal('reset'),
  theme:el=>setTheme(el.dataset.theme),
  bell:()=>{
    const pop=byId('pop');if(!pop.hidden){pop.hidden=true;return}
    const m=me(),list=S.notes.filter(n=>n.to.includes(S.me)).slice(0,10),un=new Set(unread().map(n=>n.id));
    pop.innerHTML=`<div class="pop-h"><b>Уведомления · ${esc(m.name)}</b><span class="muted sm">${un.size?'новых: '+un.size:'новых нет'}</span></div><ul class="pop-l notes">${list.map(n=>noteRow(n,un.has(n.id))).join('')||'<li class="empty">Пока пусто</li>'}</ul><div class="pop-f"><button class="btn sm ghost" data-act="go" data-view="notifications">Все уведомления ${ic('arrow')}</button></div>`;
    pop.hidden=false;list.forEach(n=>Notify.markRead(S,S.me,n.id));updBell();renderSide();save();
  },
  'open-product':el=>openDrawer('product',el.dataset.pid),
  'open-deal':el=>openDrawer('deal',el.dataset.id),
  'open-task':el=>openDrawer('task',el.dataset.id),
  'close-drawer':()=>closeDrawer(),
  'close-modal':()=>closeModal(),
  'new-task':()=>openModal('task'),
  'new-ship':()=>openModal('ship'),
  'new-product':()=>openModal('product'),
  stage:el=>openModal('stage',el.dataset.id),
  'add-irow':()=>byId('ns-items').insertAdjacentHTML('beforeend',irow()),
  'task-f':el=>{S.ui.taskF=el.dataset.f;render()},
  'task-st':el=>setTaskStatus(el.dataset.id,el.dataset.st),
  cat:el=>{S.ui.cat=el.dataset.cat;render()},
  'log-tab':el=>{S.ui.logTab=el.dataset.tab;render()},
  'note-k':el=>{S.ui.noteK=el.dataset.k;render()},
  'note-scope':el=>{S.ui.noteScope=el.dataset.k;render()},
  'view-as':el=>setMe(el.dataset.id),
  unreserve:el=>{
    const m=me(),now=new Date(),res=Stock.unreserve(S,el.dataset.id,m.id,now);if(!res.ok) return;
    const r=res.reserve,p=product(r.productId),d=deal(r.dealId);
    Notify.push(S,'reserve',m.id,`Снят резерв: ${p.name} — ${qtyOf(r.qty,p)} (${r.dealId}, ${d?.client||''}).`,now);
    render();toast('Резерв снят, товар снова свободен.');
  },
  'rcv-start':el=>{initRcv(el.dataset.id);go('receiving')},
  'rcv-step':el=>{
    const pid=el.dataset.pid,inp=byId('rcv-q-'+pid),v=Math.max(0,(parseInt(inp.value,10)||0)+parseInt(el.dataset.d,10));
    inp.value=v;S.rcv.qty[pid]=v;byId('rcv-diff-'+pid).innerHTML=diffHtml(rcvItem(pid));updRcvPrev();saveSoon();
  },
  'rcv-photo-del':el=>{S.rcv.photos.splice(+el.dataset.i,1);byId('rcv-photos').innerHTML=photosHtml();saveSoon()},
  'rcv-confirm':()=>rcvConfirm(),
  'rcv-again':()=>{S.rcv=null;render()},
  'tpl-ch':el=>{S.ui.tplCh=el.dataset.ch;el.parentElement.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b===el));updTpl()},
  'ins-var':el=>{
    const ta=byId('tpl');if(!ta) return;
    const a=ta.selectionStart??ta.value.length,b=ta.selectionEnd??a;
    ta.value=ta.value.slice(0,a)+el.dataset.v+ta.value.slice(b);S.tpl=ta.value;ta.focus();ta.selectionStart=ta.selectionEnd=a+el.dataset.v.length;updTpl();saveSoon();
  }
};

// ——— формы ———
const FORMS={
  reset:()=>resetData(),
  reserve:f=>{
    const p=product(f.dataset.pid),did=byId('rs-deal').value,qty=parseInt(byId('rs-qty').value,10),src=byId('rs-src').value,until=byId('rs-until').value;
    if(!did) return showErr('rs-err','Нет открытых сделок, под которые можно поставить резерв.');
    if(!until||dd(fromIso(until))<0) return showErr('rs-err','Дата окончания резерва не может быть в прошлом.');
    const d=deal(did),m=me(),u=fromIso(until),now=new Date();
    const res=Stock.reserve(S,{productId:p.id,qty,entityId:byId('rs-ent').value,cityId:byId('rs-city').value,src,dealId:did,until:u,by:m.id,at:now});
    if(!res.ok) return showErr('rs-err',res.reason);
    Notify.push(S,'reserve',m.id,`Резерв: ${low(p.name)} — ${qtyOf(qty,p)} ${src==='stock'?'со склада':'из поставки '+src} для ${did} (${d.client}) до ${fD(u)}.`,now);
    render();toast(`Резерв поставлен: ${qtyOf(qty,p)} для ${did}. Склад и директор получили уведомление.`);
  },
  stage:f=>shipStageForm(f),
  task:()=>{
    const title=byId('t-title').value.trim();
    if(!title){showErr('t-err','Напишите, что нужно сделать.');byId('t-title').focus();return}
    const [tt,id]=byId('t-to').value.split(':'),due=byId('t-due').value,m=me(),now=new Date(),board=taskBoard();
    const t={id:Store.freeId(S.tasks,'t'),title,desc:byId('t-desc').value.trim(),to:{t:tt,id},from:m.id,due:due?fromIso(due,18):day(2,18),boardId:board.id,stageId:startStage(board.id).id,prio:byId('t-prio').value,deal:byId('t-deal')?.value||'',at:now};
    S.tasks.push(t);
    Notify.push(S,'task',m.id,`Новая задача: «${title}», срок ${fD(t.due)}.${t.deal?' Сделка '+t.deal+'.':''} От: ${m.name}.`,now,targetPeople(t.to));
    closeModal();render();toast(`Задача поставлена. ${targetName(t)} — уведомление отправлено.`);
  },
  ship:f=>shipCreate(f),
  product:()=>{
    const name=byId('np-name').value.trim(),pr=byId('np-price'),m=me();
    if(!name) return showErr('np-err','Нужно наименование.');
    if(S.products.some(p=>Catalog.norm(p.name)===Catalog.norm(name))) return showErr('np-err',`Товар «${name}» уже есть в номенклатуре.`);
    const price=pr&&pr.value!==''?Math.max(0,Number(pr.value)):null;
    S.products.push({id:Store.freeId(S.products,'u'),name,brand:null,cat:byId('np-cat').value,unit:byId('np-unit').value,price,avail:null,url:null,src:'user',inCatalog:false});
    Notify.push(S,'arrive',m.id,`В номенклатуру добавлен товар: ${name}.`,new Date());
    closeModal();S.ui.cat='Все';S.ui.sq='';render();toast('Товар добавлен. Остатка нет — он появится после первой приёмки.');
  },
  msg:f=>{
    const d=deal(f.dataset.id),ta=byId('msg-text'),txt=ta.value.trim();
    if(!txt){ta.focus();return}
    S.msgs.push({id:Store.freeId(S.msgs,'m'),at:new Date(),deal:d.id,channel:d.channel,by:me().id,text:txt});
    render();toast(`Сообщение записано в переписку. В прототипе в ${CH[d.channel]} оно не уходит.`);
  }
};

// ——— события ———
document.addEventListener('click',e=>{
  if(!e.target.closest('.bell-w')) byId('pop').hidden=true;
  const inSearch=e.target.closest('.search');
  if(!inSearch) byId('q-res').hidden=true;
  if(e.target.classList?.contains('modal-wrap')){closeModal();return}
  const el=e.target.closest('[data-act]');if(!el) return;
  const f=A[el.dataset.act];if(!f) return;
  if(el.closest('#q-res')){byId('q-res').hidden=true;byId('q').value=''}
  if(el.closest('#pop')) byId('pop').hidden=true;
  f(el,e);
});
document.addEventListener('submit',e=>{const f=e.target,k=f.dataset.form;if(!k||!FORMS[k]) return;e.preventDefault();FORMS[k](f)});
// Поле с data-on="<key>": обработчик ON.input[key] или ON.change[key], затем отложенное сохранение
function onField(kind,e){
  const t=e.target,k=t.dataset?.on;if(!k||!Object.hasOwn(ON[kind],k)) return;
  ON[kind][k](t,e);saveSoon();
}
document.addEventListener('input',e=>onField('input',e));
document.addEventListener('change',e=>onField('change',e));
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
    if(S.ui.modal) closeModal();else if(S.ui.drawer) closeDrawer();else{byId('pop').hidden=true;byId('q-res').hidden=true;if(S.ui.navOpen) setNav(false)}
    return;
  }
  if((e.key==='Enter'||e.key===' ')&&e.target.matches?.('[data-act]:not(button):not(input):not(select):not(textarea):not(label)')){e.preventDefault();e.target.click()}
});
document.addEventListener('dragstart',e=>{const c=e.target.closest?.('[data-drag]');if(!c) return;e.dataTransfer.setData('text/plain',c.dataset.drag);e.dataTransfer.effectAllowed='move';c.classList.add('dragging')});
document.addEventListener('dragend',()=>{document.querySelectorAll('.dragging,.col.drop').forEach(x=>x.classList.remove('dragging','drop'))});
document.addEventListener('dragover',e=>{const col=e.target.closest?.('[data-col]');if(!col) return;e.preventDefault();document.querySelectorAll('.col.drop').forEach(x=>{if(x!==col) x.classList.remove('drop')});col.classList.add('drop')});
document.addEventListener('drop',e=>{const col=e.target.closest?.('[data-col]');if(!col) return;e.preventDefault();const id=e.dataTransfer.getData('text/plain');col.classList.remove('drop');if(id) setTaskStatus(id,col.dataset.col)});
// Прокрутка колонок воронок (см. выше «прокрутка колонок воронок»)
document.addEventListener('scroll',e=>{const el=e.target;if(el&&el.hasAttribute&&el.hasAttribute('data-hscroll')) hscrollUpdate(el)},true);
document.addEventListener('pointermove',hscrollPoint);
document.addEventListener('mouseout',e=>{if(!e.relatedTarget) hscrollClearNear()});
document.addEventListener('pointerover',e=>{
  const b=e.target.closest?.('.hs-b');if(!b||(e.pointerType&&e.pointerType!=='mouse')) return;
  hscrollRun(hscrollEl(b.closest('.hs')),b.dataset.hs==='l'?-HS_SPEED:HS_SPEED);
});
document.addEventListener('pointerout',e=>{const b=e.target.closest?.('.hs-b');if(b&&!b.contains(e.relatedTarget)) hscrollRun(null)});
// с клавиатуры — шаг на ширину окна; мышью стрелка и так едет, пока курсор на ней (detail 0 — нажатие без мыши)
document.addEventListener('click',e=>{
  const b=e.target.closest?.('.hs-b');if(!b||e.detail) return;
  const el=hscrollEl(b.closest('.hs'));if(!el) return;
  el.scrollBy({left:(b.dataset.hs==='l'?-1:1)*Math.round(el.clientWidth*HS_STEP),behavior:reducedMotion()?'auto':'smooth'});
});
// карточку тащат у края контейнера — колонки едут сами; события пропали (увели, бросили) — стоп
document.addEventListener('dragstart',hscrollClearNear);
document.addEventListener('dragover',e=>{
  const el=hscrollEl(e.target.closest?.('.hs'));
  if(!el){if(_hsJob&&_hsJob.until) hscrollRun(null);return}
  const r=el.getBoundingClientRect();
  hscrollRun(el,hscrollEdgeSpeed(e.clientX,r.left,r.right,HS_EDGE,HS_DRAG),performance.now()+400);
});
document.addEventListener('dragend',()=>hscrollRun(null));
document.addEventListener('drop',()=>hscrollRun(null));
if(typeof window!=='undefined') window.addEventListener('resize',()=>hscrollSync());
// Часть раздела перерисовали без render() (поиск в поставках и лидах) — новым доскам тоже нужны стрелки
try{if(typeof MutationObserver==='function') new MutationObserver(()=>hscrollSync()).observe(byId('view'),{childList:true,subtree:true})}catch(_){}
byId('role').addEventListener('change',e=>setMe(e.target.value));
// напоминания о делах: раз в минуту (в тестах таймера нет)
if(typeof setInterval==='function') setInterval(actsTick,60000);
// адрес поменяли руками (#team) — показать этот раздел (или «Нет доступа»)
if(typeof window!=='undefined') window.addEventListener('hashchange',()=>{const v=hashView();if(v&&S&&v!==S.view){S.view=v;S.ui.drawer=null;render()}});
// «как в системе»: устройство переключило светлую/тёмную — тема следом
try{if(typeof matchMedia==='function') matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(S) applyTheme()})}catch(_){}
byId('q').addEventListener('input',e=>{
  const v=e.target.value,box=byId('q-res');
  if(!v.trim()){box.hidden=true;return}
  const r=searchRes(v);
  box.innerHTML=r.length?`<ul class="pop-l">${r.map(x=>`<li><button class="li" ${x.act}><span class="pill sm">${x.type}</span><span class="li-t">${esc(x.label)}<small>${esc(x.sub)}</small></span></button></li>`).join('')}</ul>`:'<p class="empty">Ничего не нашлось</p>';
  box.hidden=false;
});
