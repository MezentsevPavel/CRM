// Раздел «Поставки и перевозки»: таблица, воронка, шкала маршрута, позиции «3 + ещё N», карточка поставки.
// Считает ядро Ships (34-ships.js): поиск, фильтры, сортировка и страницы — Ships.query, «опоздала» — Ships.isLate,
// смена этапа — только Ships.setStage (через shipMark). Виды — функции state → HTML; состояние меняют A, ON, FORMS.
// Настройки вида — S.prefs.ship {view, cols, density, group, size}: сохраняются. Поиск, фильтры, сортировка,
// страница — S.ui.ships: не сохраняются.

// ——— настройки вида ———
// [ключ, подпись, ключ сортировки в Ships.query]
const SHIP_COLS=[
  ['number','Номер','number'],['supplier','Поставщик','supplier'],['stage','Этап','stage'],['where','Где сейчас',null],
  ['eta','Когда будет','eta'],['entity','Юрлицо и город',null],['items','Позиции','items'],['units','Штук','units'],
  ['carrier','Перевозчик',null],['depart','Отправлена','depart']
];
const SHIP_COLS_DEFAULT=['number','supplier','stage','where','eta','entity','items','units'];
const SHIP_GROUPS=[['','Без группировки'],['stage','По этапу'],['supplier','По поставщику'],['node','По точке'],['city','По городу']];
const SHIP_SIZES=[25,50,100];
const SHIP_VIEWS=[['table','Таблица'],['funnel','Воронка'],['map','Схема']];
const SHIP_ITEMS_SHOWN=3;

// Выбор вида с подстановкой умолчаний. Колонка «Номер» есть всегда.
function shipPrefs(){
  const p=(S.prefs&&S.prefs.ship)||{};
  const keys=SHIP_COLS.map(c=>c[0]);
  const cols=Array.isArray(p.cols)?keys.filter(k=>k==='number'||p.cols.includes(k)):SHIP_COLS_DEFAULT.slice();
  return {
    view:SHIP_VIEWS.some(v=>v[0]===p.view)?p.view:'table',
    cols,
    density:p.density==='dense'?'dense':'normal',
    group:SHIP_GROUPS.some(g=>g[0]===p.group)?p.group:'',
    size:SHIP_SIZES.includes(Number(p.size))?Number(p.size):SHIP_SIZES[0]
  };
}
function setShipPref(key,value){S.prefs.ship=Object.assign({},S.prefs.ship,{[key]:value})}

// Поиск, фильтры, сортировка, страница. stage 'open' — «не принятые»: Ships.query такого не знает, режем после него.
const SHIP_UI={q:'',stage:'open',supplier:'',node:'',city:'',entity:'',sort:'eta',page:1,settings:false};
const shipUi=()=>Object.assign({},SHIP_UI,S.ui.ships);
const setShipUi=patch=>{S.ui.ships=Object.assign(shipUi(),patch)};
const shipDir=()=>S.ui.logTab==='out'?'out':'in';
const shipNow=()=>new Date();
const SHIP_DAY=864e5;
const shipFold=x=>String(x??'').toLowerCase().replace(/ё/g,'е');

// Запрос к ядру: только фильтры, которые оно знает. Этап из чужой воронки (после смены «Едут / Отгрузки») не считается.
function shipFilter(u,dir){
  const pipe=shipPipe(dir);
  const stage=pipe&&pipe.stages.some(x=>x.id===u.stage)?u.stage:'';
  return {q:u.q,stage,supplier:u.supplier,node:u.node,city:u.city,entity:u.entity,dir,sort:u.sort};
}

// Группа строки: {key, label, order}; порядок групп — по order, равные — по подписи.
function shipGroupOf(s,mode){
  if(mode==='stage'){
    const st=(Pipes.of(S,'ships').find(p=>p.id===s.pipeId)||{stages:[]}).stages,i=st.findIndex(x=>x.id===s.stageId);
    return {key:'st:'+s.stageId,label:i<0?'нет данных: этап':st[i].name,order:i<0?999:i};
  }
  if(mode==='supplier') return {key:'su:'+s.supplier,label:s.supplier||'нет данных: поставщик',order:0};
  if(mode==='city') return {key:'ci:'+(s.cityId||''),label:s.cityId?(Stock.cityName(S,s.cityId)||s.cityId):'нет данных: город',order:s.cityId?0:999};
  const w=Ships.where(s);
  if(w.at) return {key:'no:'+w.at,label:Ships.nodeName(w.at),order:Math.max(0,Ships.NODES.findIndex(n=>n.id===w.at))};
  if(w.from) return {key:'no:'+w.from+'>'+w.to,label:`В пути ${Ships.nodeName(w.from)} → ${Ships.nodeName(w.to)}`,order:10+Math.max(0,Ships.NODES.findIndex(n=>n.id===w.from))};
  return {key:'no:',label:'нет данных: маршрут',order:999};
}

// Страница таблицы → {rows, total, page, pages, size, groups}. Без группировки и без «не принятых» — прямо Ships.query.
// Иначе берём у ядра все подходящие (оно же фильтрует и сортирует), режем и делим на страницы здесь.
function shipList(u,pr,dir){
  const f=shipFilter(u,dir),openOnly=u.stage==='open';
  if(!openOnly&&!pr.group) return Object.assign(Ships.query(S,Object.assign({},f,{page:u.page,size:pr.size})),{groups:null});
  let rows=Ships.query(S,Object.assign({},f,{page:1,size:1e9})).rows;
  if(openOnly) rows=rows.filter(s=>!isDone(s));
  let groups=null,keyOf=null;
  if(pr.group){
    groups=new Map();
    const g=new Map(rows.map(s=>[s,shipGroupOf(s,pr.group)]));
    rows.forEach(s=>{const x=g.get(s),e=groups.get(x.key);if(e) e.count++;else groups.set(x.key,{label:x.label,order:x.order,count:1})});
    rows=rows.slice().sort((a,b)=>{const x=g.get(a),y=g.get(b);return (x.order-y.order)||x.label.localeCompare(y.label,'ru',{numeric:true})||x.key.localeCompare(y.key)});
    keyOf=new Map(rows.map(s=>[s.id,g.get(s).key]));
  }
  const total=rows.length,size=pr.size,pages=Math.max(1,Math.ceil(total/size)),page=Math.min(Math.max(1,Math.floor(u.page)||1),pages);
  return {rows:rows.slice((page-1)*size,page*size),total,page,pages,size,groups,keyOf};
}

// ——— слова: когда будет, где сейчас ———
const shipDays=(s,now)=>Math.round((sod(s.eta)-sod(now))/SHIP_DAY);
function shipEtaText(s,now){
  if(isDone(s)){const L=s.history&&s.history[s.history.length-1];return s.received?'принято '+fD(s.received.at):'закрыто '+(L?fD(L.at):'нет данных: дата')}
  if(!s.eta) return 'нет данных: срок';
  const n=shipDays(s,now);
  return n>0?'через '+days(n):n===0?'сегодня':'опаздывает на '+days(-n);
}
const shipLate=(s,now)=>Ships.isLate(s,now,S);
// Где груз — словами; у отгрузки клиенту маршрута нет, берём последнюю отметку
function shipWhere(s){
  if(Array.isArray(s.route)&&s.route.length>=2) return Ships.where(s).text;
  const L=s.history&&s.history[s.history.length-1];
  return L?L.text:'нет данных: где груз';
}
const shipPlace=s=>{
  const e=Stock.entityName(S,s.entityId),c=s.cityId?Stock.cityName(S,s.cityId):null;
  return {entity:s.entityId?(e||s.entityId):'нет данных: юрлицо',city:s.cityId?(c||s.cityId):'нет данных: город'};
};

// ——— шкала маршрута ———
// Точки маршрута; пройденные отмечены, где груз сейчас — кольцо (в точке) или бегунок (на перегоне); под шкалой —
// где груз и сколько дней до прибытия (красным — опаздывает). full: с подписями точек (карточка), иначе компактная (строка).
function shipScale(s,now,full){
  if(!Array.isArray(s.route)||s.route.length<2) return `<span class="muted sm">${esc(shipWhere(s))}</span>`;
  const r=s.route,last=r.length-1,w=Ships.where(s);
  const i=Math.max(0,r.indexOf(w.at||w.from)),onLeg=!w.at,pct=Math.min(100,(i+(onLeg?w.t:0))/last*100);
  const late=shipLate(s,now),cap=shipEtaText(s,now);
  const dots=r.map((id,k)=>`<i class="rs-dot${k<=i?' on':''}${!onLeg&&k===i?' cur':''}" style="left:${k/last*100}%"></i>`).join('');
  const names=full?`<div class="rs-names">${r.map((id,k)=>`<span class="${k<=i?'on':''}" style="left:${k/last*100}%">${esc(Ships.nodeName(id))}</span>`).join('')}</div>`:'';
  const label=`Маршрут: ${Ships.routeText(r)}. Сейчас: ${w.text}. ${cap}.`;
  return `<div class="rs${full?' full':''}${late?' late':''}" role="img" aria-label="${esc(label)}"><div class="rs-line"><i class="rs-fill" style="width:${pct}%"></i>${dots}${onLeg?`<i class="rs-mark" style="left:${pct}%"></i>`:''}</div>${names}<div class="rs-cap"><span class="rs-w" title="${esc(w.text)}">${esc(full||w.at?w.text:Ships.nodeName(w.from)+' → '+Ships.nodeName(w.to)+' · '+Math.round(w.t*100)+'%')}</span><b class="${late?'bad-t':''}">${esc(cap)}</b></div></div>`;
}

// ——— позиции «3 + ещё N» ———
// Одна функция на строку таблицы и на карточку: первые три позиции и кнопка «+N» — окно со всем списком.
function shipItems(s){
  const its=s.items||[],first=its.slice(0,SHIP_ITEMS_SHOWN),more=its.length-first.length;
  if(!its.length) return '<span class="muted sm">нет данных: позиции</span>';
  const line=it=>{const p=product(it.productId);return `<div class="s-it"><span>${esc(p?p.name:'нет данных: товар')}</span> <b>× ${esc(qtyOf(it.qty,p))}</b></div>`};
  return `<div class="s-items"><div class="s-itl">${first.map(line).join('')}</div>${more>0?`<button type="button" class="s-more" data-act="ship-items" data-id="${esc(s.id)}" aria-label="Показать все ${its.length} ${pl(its.length,'позицию','позиции','позиций')}">+${more}</button>`:''}</div>`;
}
// Список для окна: подходящие под поиск по названию позиции и итог штук. Пустой поиск — всё.
function shipItemsList(s,q){
  const its=s.items||[],names=new Map(),want=shipFold(q).trim().split(/\s+/).filter(Boolean);
  its.forEach(it=>{const p=product(it.productId);names.set(it,p?p.name:'нет данных: товар')});
  const shown=its.filter(it=>want.every(w=>shipFold(names.get(it)).includes(w)));
  const sum=a=>a.reduce((x,it)=>x+(Number(it.qty)||0),0);
  const all=sum(its),part=sum(shown);
  const head=shown.length===its.length?`${its.length} ${pl(its.length,'позиция','позиции','позиций')} · штук ${num(all)}`:`Найдено ${shown.length} из ${its.length} · штук ${num(part)} из ${num(all)}`;
  const rows=shown.map(it=>{
    const p=product(it.productId);
    return `<tr><td class="num muted">${its.indexOf(it)+1}</td><td>${esc(names.get(it))}</td><td class="num"><b>${esc(qtyOf(it.qty,p))}</b>${it.got!==undefined&&it.got!==it.qty?`<small class="muted"> принято ${esc(qtyOf(it.got,p))}</small>`:''}</td></tr>`;
  }).join('');
  return `<p class="si-sum" id="si-sum">${head}</p>${shown.length?`<div class="si-scroll"><table class="tbl"><thead><tr><th class="num">№</th><th>Название</th><th class="num">Кол-во</th></tr></thead><tbody>${rows}</tbody></table></div>`:'<p class="empty">Ничего не нашлось.</p>'}`;
}
function mShipItems(s){
  if(!s) return `<div>${mHead('Позиции')}<div class="modal-b"><p class="empty">Поставки нет.</p></div></div>`;
  return `<div>${mHead('Позиции поставки '+esc(s.id))}<div class="modal-b si">
    <div class="field"><label for="si-q">Поиск по названию</label><input id="si-q" class="inp" type="search" data-on="ship-items-q" data-id="${esc(s.id)}" placeholder="Например: панель" autocomplete="off"></div>
    <div id="si-body">${shipItemsList(s,'')}</div>
  </div><div class="modal-f"><button type="button" class="btn" data-act="close-modal">Закрыть</button></div></div>`;
}

// ——— таблица ———
// Выпадающий список этапов: ручная смена (в строке и в карточке). На склад входящую ставит только приёмка.
function shipStageSelect(s,cls){
  const stg=stagesFor(s),locked=x=>s.dir==='in'&&x.flag==='final';
  return `<select class="${cls}" data-on="ship-stage" data-id="${esc(s.id)}" aria-label="Этап поставки ${esc(s.id)}">${stg.map(x=>`<option value="${esc(x.id)}" ${x.id===s.stageId?'selected':''} ${locked(x)?'disabled':''}>${esc(x.name)}${locked(x)?' — ставит склад':''}</option>`).join('')}</select>`;
}
function shipStageCell(s,now){
  if(can('logistics')&&!isDone(s)) return shipStageSelect(s,'inp sm s-stsel');
  const tone=isDone(s)?'ok':shipLate(s,now)?'bad':awaitsReceipt(s)?'sun':'info';
  return `<span class="pill ${tone}">${esc(stageName(s))}</span>`;
}
const SHIP_CELLS={
  number:s=>`<td><button type="button" class="link mono s-id" data-act="open-ship" data-id="${esc(s.id)}">${esc(s.id)}</button>${s.demo?'<small class="muted">демо</small>':''}</td>`,
  supplier:s=>`<td><span class="s-ell" title="${esc(s.supplier)}">${esc(s.supplier)}</span></td>`,
  stage:(s,now)=>`<td>${shipStageCell(s,now)}</td>`,
  where:(s,now)=>`<td class="s-where">${shipScale(s,now,false)}</td>`,
  eta:(s,now)=>`<td class="s-eta"><b>${s.eta?fD(s.eta):'нет данных'}</b>${shipLate(s,now)?'<small class="bad-t">опаздывает</small>':isDone(s)?`<small class="muted">${esc(shipEtaText(s,now))}</small>`:''}</td>`,
  entity:s=>{const p=shipPlace(s);return `<td><span class="s-ell" title="${esc(p.entity+' · '+p.city)}">${esc(p.entity)}<small class="muted">${esc(p.city)}</small></span></td>`},
  items:s=>`<td class="s-itc">${shipItems(s)}</td>`,
  units:s=>`<td class="num"><b>${num(Ships.units(s))}</b></td>`,
  carrier:s=>`<td><span class="s-ell" title="${esc(s.carrier)}">${esc(s.carrier)}</span></td>`,
  depart:s=>`<td>${s.depart?fD(s.depart):'<span class="muted sm">нет данных</span>'}</td>`
};
function shipRow(s,pr,now){
  return `<tr class="srow click${shipLate(s,now)?' is-late':''}${isDone(s)?' is-done':''}" data-ship="${esc(s.id)}" data-act="open-ship" data-id="${esc(s.id)}" tabindex="0">${pr.cols.map(k=>SHIP_CELLS[k](s,now)).join('')}</tr>`;
}
function shipHead(pr,u){
  const raw=u.sort,desc=raw.startsWith('-'),key=desc?raw.slice(1):raw;
  return `<tr>${pr.cols.map(k=>{
    const c=SHIP_COLS.find(x=>x[0]===k);
    if(!c[2]) return `<th class="${k==='where'?'s-where':''}">${c[1]}</th>`;
    const on=key===c[2];
    return `<th class="${k==='units'?'num':''}" aria-sort="${on?(desc?'descending':'ascending'):'none'}"><button type="button" class="s-sort${on?' on':''}" data-act="ship-sort" data-k="${c[2]}">${c[1]}<span aria-hidden="true">${on?(desc?' ▼':' ▲'):''}</span></button></th>`;
  }).join('')}</tr>`;
}
function shipPager(r){
  if(r.pages<2) return '';
  return `<div class="s-pager"><button type="button" class="btn sm" data-act="ship-page" data-p="${r.page-1}" ${r.page<2?'disabled':''}>← Назад</button><span class="muted sm">Страница ${r.page} из ${r.pages}</span><button type="button" class="btn sm" data-act="ship-page" data-p="${r.page+1}" ${r.page>=r.pages?'disabled':''}>Дальше →</button></div>`;
}
// Счётчик «Показано N из M»: N — строк на этой странице, M — всех подходящих под фильтры.
const shipCounter=(n,m)=>`<p class="s-count" id="ship-count">Показано ${n} из ${m}</p>`;
function shipTable(u,pr,dir,now){
  const r=shipList(u,pr,dir);
  let body='',cur=null;
  r.rows.forEach(s=>{
    if(r.groups){const k=r.keyOf.get(s.id);if(k!==cur){cur=k;const g=r.groups.get(k);body+=`<tr class="sgrp"><td colspan="${pr.cols.length}"><b>${esc(g.label)}</b> <span class="muted">· ${g.count}</span></td></tr>`}}
    body+=shipRow(s,pr,now);
  });
  const tbl=r.rows.length?`<section class="card clip"><div class="xs"><table class="tbl stbl ${pr.density}"><thead>${shipHead(pr,u)}</thead><tbody>${body}</tbody></table></div></section>`:`<section class="card">${emptyState('Под такие фильтры поставок нет. Поставку заводит логист кнопкой «Новая поставка».','Сбросить фильтры','ship-reset')}</section>`;
  return shipCounter(r.rows.length,r.total)+tbl+shipPager(r);
}

// ——— воронка ———
function shipCardMini(s,now){
  const late=shipLate(s,now),drag=can('logistics')&&!isDone(s);
  return `<article class="scard${late?' is-late':''}${isDone(s)?' is-done':''}" ${drag?`draggable="true" data-drag="${esc(s.id)}"`:''}>
    <div class="sc-h"><button type="button" class="link mono" data-act="open-ship" data-id="${esc(s.id)}">${esc(s.id)}</button>${late?'<span class="pill bad sm">опаздывает</span>':''}</div>
    <div class="sc-s" title="${esc(s.supplier)}">${esc(s.supplier)}</div>
    <div class="sc-m"><span><b>${num(Ships.units(s))}</b> шт.</span><span class="${late?'bad-t':''}">${s.eta?fD(s.eta):'нет данных'} · ${esc(shipEtaText(s,now))}</span></div></article>`;
}
function shipFunnel(u,pr,dir,now){
  const pipe=shipPipe(dir);
  if(!pipe) return '<section class="card"><p class="empty">нет данных: воронка поставок.</p></section>';
  const f=Object.assign(shipFilter(u,dir),{stage:'',sort:'eta',page:1,size:1e9});
  const rows=Ships.query(S,f).rows;
  const cols=pipe.stages.map(st=>{
    const list=rows.filter(s=>s.stageId===st.id),un=list.reduce((x,s)=>x+Ships.units(s),0);
    return `<section class="col scol" data-scol="${esc(st.id)}" aria-label="${esc(st.name)}"><div class="col-h"><span>${esc(st.name)}</span><span class="cnt-s">${list.length} · ${num(un)} шт.</span></div><div class="scol-b">${list.map(s=>shipCardMini(s,now)).join('')||'<p class="col-empty">Пусто</p>'}</div></section>`;
  }).join('');
  return `${shipCounter(rows.length,rows.length)}${can('logistics')?'<p class="hint">Перетащите карточку в другую колонку — этап сменится, сотрудникам придёт уведомление. На склад входящую поставку ставит приёмка.</p>':''}<div class="xs" data-hscroll><div class="sfun" style="--n:${pipe.stages.length}">${cols}</div></div>`;
}

// ——— схема маршрута ———
// Встроенная схема без внешних карт: условные контуры Китая и России, пять точек Ships.NODES, перегоны.
// Числа — только Ships.mapCounts, те же поставки, что покажет таблица после нажатия. Нажатие на точку, на «на таможне»
// или на перегон включает фильтр таблицы и переключает вид на «Таблицу». Грузы бегут по перегонам, где есть поставки.
// Где подпись точки относительно самой точки: bl — снизу слева, tl — сверху слева, r — справа, tr / br — справа сверху / снизу.
const SMAP_PLACE={cn:'bl',chita:'tl',irk:'r',msk:'tr',krd:'br'};
// Где на перегоне стоит число (доля пути): у сходящихся линий разные, чтобы числа не наползали друг на друга
const SMAP_LEG_AT={'cn>chita':.5,'chita>irk':.5,'chita>msk':.45,'chita>krd':.45,'irk>msk':.75,'irk>krd':.75,'msk>krd':.2};
// Контуры условные, не по масштабу: Китай слева, Россия справа (чтобы груз шёл слева направо, как в Ships.NODES)
const SMAP_CN='M0,24 C5,18 12,20 16,26 C20,30 24,34 23,42 C22,48 25,52 24,58 C23,66 18,72 14,78 C10,84 5,88 0,90 Z';
const SMAP_RU='M27,12 C34,6 46,8 56,6 C68,4 80,6 92,4 L100,5 L100,95 L90,96 C80,94 72,90 62,92 C52,94 46,86 42,78 C38,72 30,70 28,62 C26,56 28,52 27,46 C25,40 28,36 26,30 C24,22 25,16 27,12 Z';
const smapPct=v=>Math.round(v*100)/100+'%';
const smapShips=n=>`${n} ${pl(n,'поставка','поставки','поставок')}`;
// Какие поставки на схеме: те же поиск, поставщик, город и юрлицо, что в панели над таблицей (этап и точку схема считает сама)
const smapFilter=u=>({q:u.q,supplier:u.supplier,city:u.city,entity:u.entity});
const smapOrder=key=>key.split('>').map(id=>Math.max(0,Ships.NODES.findIndex(n=>n.id===id)));
function smapLegName(key){const [a,b]=key.split('>');return Ships.nodeName(a)+' → '+Ships.nodeName(b)}
// Подпись точки: роль («основной город-приёмщик») и то, что там делают («таможня и перевалка») — из Ships.NODES.label
function smapLabel(n){
  const parts=String(n.label||'').split(' · '),key=parts.length>1?parts[parts.length-1]:'',role=parts.length>1?parts.slice(0,-1).join(' · '):parts[0];
  return `<span class="sm-lbl">${role?`<span class="sm-role">${esc(role)}</span>`:''}${role&&key?'<span class="sm-sep"> · </span>':''}${key?`<span class="sm-key">${esc(key)}</span>`:''}</span>`;
}
// Число поставок и штук: видимый текст и атрибуты берут одно и то же
const smapCnt=c=>`<span class="sm-cnt"><span><b>${num(c.ships)}</b> ${pl(c.ships,'поставка','поставки','поставок')}</span><span><b>${num(c.units)}</b> шт</span></span>`;
function shipMap(u,dir){
  if(dir==='out') return '<section class="card"><p class="empty">Схема показывает поставки, которые едут к нам: у отгрузок клиентам маршрута из пяти точек нет. Переключитесь на «Едут к нам».</p></section>';
  const c=Ships.mapCounts(S,smapFilter(u)),N=Ships.NODES;
  const at=id=>N.find(n=>n.id===id),legKeys=Object.keys(c.legs).sort((a,b)=>{const x=smapOrder(a),y=smapOrder(b);return (x[0]-y[0])||(x[1]-y[1])});
  const totShips=N.reduce((s,n)=>s+c.nodes[n.id].ships,0)+legKeys.reduce((s,k)=>s+c.legs[k].ships,0);
  const totUnits=N.reduce((s,n)=>s+c.nodes[n.id].units,0)+legKeys.reduce((s,k)=>s+c.legs[k].units,0);
  const line=k=>{const [a,b]=k.split('>').map(at);return `<line class="sm-line${c.legs[k].ships?' on':''}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" vector-effect="non-scaling-stroke"/>`};
  const dots=legKeys.filter(k=>c.legs[k].ships>0).map(k=>{
    const [a,b]=k.split('>').map(at),n=Math.min(4,Math.ceil(c.legs[k].ships/5)),dur=Math.round((4+Math.hypot(b.x-a.x,b.y-a.y)/12)*10)/10;
    return Array.from({length:n},(_,i)=>`<i class="sm-dot" style="--x1:${smapPct(a.x)};--y1:${smapPct(a.y)};--x2:${smapPct(b.x)};--y2:${smapPct(b.y)};--xm:${smapPct(a.x+(b.x-a.x)*(i+1)/(n+1))};--ym:${smapPct(a.y+(b.y-a.y)*(i+1)/(n+1))};--dur:${dur}s;--dl:-${Math.round(dur*i/n*10)/10}s"></i>`).join('');
  }).join('');
  const legBtn=k=>{
    const [a,b]=k.split('>').map(at),t=SMAP_LEG_AT[k]??.5,g=c.legs[k];
    return `<button type="button" class="sm-leg${g.ships?' on':''}" style="left:${smapPct(a.x+(b.x-a.x)*t)};top:${smapPct(a.y+(b.y-a.y)*t)}" data-act="ship-map" data-k="${esc(k)}" data-leg="${esc(k)}" data-ships="${g.ships}" data-units="${g.units}" aria-label="Перегон ${esc(smapLegName(k))}: ${smapShips(g.ships)}, ${num(g.units)} шт. Показать в таблице"><b>${num(g.ships)}</b>${g.ships?`<span class="sm-u">· ${num(g.units)} шт</span>`:''}</button>`;
  };
  const nodeBox=n=>{
    const g=c.nodes[n.id],cu=g.customs,place=SMAP_PLACE[n.id]||'r';
    const chip=`<button type="button" class="sm-chip${g.ships?' has':''}" data-act="ship-map" data-k="${esc(n.id)}" data-node="${esc(n.id)}" data-ships="${g.ships}" data-units="${g.units}" aria-label="${esc(n.name)}, ${esc(n.label)}: ${smapShips(g.ships)}, ${num(g.units)} шт. Показать в таблице"><span class="sm-nm">${esc(n.name)}</span>${smapLabel(n)}${smapCnt(g)}</button>`;
    const cust=cu?`<button type="button" class="sm-cust${cu.ships?' has':''}" data-act="ship-map" data-k="${esc(n.id)}" data-stage="customs" data-customs-ships="${cu.ships}" data-customs-units="${cu.units}" aria-label="${esc(n.name)}, на таможне: ${smapShips(cu.ships)}, ${num(cu.units)} шт. Показать в таблице">на таможне: <b>${num(cu.ships)}</b><span class="sm-u">· <b>${num(cu.units)}</b> шт</span></button>`:'';
    return `<i class="sm-pt${g.ships?' has':''}" style="left:${smapPct(n.x)};top:${smapPct(n.y)}" aria-hidden="true"></i><div class="sm-node ${place}" style="--x:${smapPct(n.x)};--y:${smapPct(n.y)}">${chip}${cust}</div>`;
  };
  const rows=legKeys.map(k=>{const g=c.legs[k];return `<li><button type="button" class="link" data-act="ship-map" data-k="${esc(k)}" data-row-leg="${esc(k)}">${esc(smapLegName(k))}</button><span class="${g.ships?'':'muted'}">${g.ships?`${smapShips(g.ships)} · ${num(g.units)} шт`:'сейчас на перегоне никого'}</span></li>`}).join('');
  return `<p class="s-count" id="ship-count">На схеме ${smapShips(totShips)}, ${num(totUnits)} шт. Нажмите на точку или перегон — таблица покажет эти поставки.</p>
    <section class="card"><div class="smap" role="group" aria-label="Схема маршрута: ${esc(N.map(n=>n.name).join(', '))}">
      <svg class="smap-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path class="sm-land cn" d="${SMAP_CN}"/><path class="sm-land ru" d="${SMAP_RU}"/>${legKeys.map(line).join('')}</svg>
      <span class="sm-country cn" aria-hidden="true">Китай</span><span class="sm-country ru" aria-hidden="true">Россия</span>
      <div class="sm-dots" aria-hidden="true">${dots}</div>
      ${legKeys.map(legBtn).join('')}${N.map(nodeBox).join('')}
    </div><p class="hint sm-note">Схема условная: контуры и расстояния не по масштабу. Бегущие точки — грузы в пути. Числа — не принятые поставки, в точке или на перегоне; поставки из демо-набора.</p></section>
    <section class="card"><div class="card-h"><h3>Перегоны</h3></div><ul class="sm-list">${rows||'<li class="muted">Поставок с маршрутом нет.</li>'}</ul></section>`;
}

// ——— верх раздела: переключатели, фильтры, настройка вида ———
function shipFilterBar(u,pr,dir){
  const pipe=shipPipe(dir);
  const sups=[...new Set(S.shipments.filter(s=>(s.dir||'in')===dir).map(s=>s.supplier).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru',{numeric:true}));
  const legs=Object.keys(Ships.mapCounts(S,{}).legs);
  const opt=(v,l,cur)=>`<option value="${esc(v)}" ${v===cur?'selected':''}>${esc(l)}</option>`;
  const sel=(k,label,opts)=>`<div class="field"><label for="sf-${k}">${label}</label><select id="sf-${k}" class="inp sm" data-on="ship-f" data-k="${k}">${opts}</select></div>`;
  const stageSel=pr.view!=='table'?'':sel('stage','Этап',opt('open',dir==='out'?'Не закрытые':'Не принятые',u.stage)+opt('','Все этапы',u.stage)+(pipe?pipe.stages.map(x=>opt(x.id,x.name,u.stage)).join(''):''));
  const nodeOpts=opt('','Везде',u.node)+Ships.NODES.map(n=>opt(n.id,n.name,u.node)).join('')+legs.map(k=>{const [a,b]=k.split('>');return opt(k,`В пути ${Ships.nodeName(a)} → ${Ships.nodeName(b)}`,u.node)}).join('');
  const dirty=u.q||u.supplier||u.node||u.city||u.entity||(pr.view==='table'&&u.stage!=='open');
  return `<section class="card sfilters"><div class="sf-row">
    <div class="field sf-q"><label for="sf-q">Поиск</label><input id="sf-q" class="inp sm" type="search" value="${esc(u.q)}" data-on="ship-q" placeholder="Номер, поставщик, трек, товар, где груз" autocomplete="off"></div>
    ${stageSel}
    ${sel('supplier','Поставщик',opt('','Все',u.supplier)+sups.map(x=>opt(x,x,u.supplier)).join(''))}
    ${sel('node','Точка',nodeOpts)}
    ${sel('city','Город',opt('','Все',u.city)+S.cities.map(c=>opt(c.id,c.name,u.city)).join(''))}
    ${sel('entity','Юрлицо',opt('','Все',u.entity)+S.entities.map(e=>opt(e.id,e.name,u.entity)).join(''))}
    ${dirty?`<button type="button" class="btn sm ghost" data-act="ship-reset">Сбросить</button>`:''}
  </div></section>`;
}
function shipSettings(pr,u){
  if(!u.settings) return '';
  return `<section class="card sset"><div class="card-h"><h3>Настройка вида</h3><span class="hint">Запоминается: при следующем заходе вид будет таким же.</span></div><div class="card-b ss-grid">
    <fieldset class="ss-f"><legend>Колонки таблицы</legend>${SHIP_COLS.map(c=>`<label class="check"><input type="checkbox" data-on="ship-col" data-k="${c[0]}" ${pr.cols.includes(c[0])?'checked':''} ${c[0]==='number'?'disabled':''}> ${c[1]}</label>`).join('')}</fieldset>
    <div class="ss-f"><span class="lbl">Плотность строк</span><div class="seg" role="group" aria-label="Плотность строк">${[['normal','Обычная'],['dense','Плотная']].map(([k,l])=>`<button type="button" class="${pr.density===k?'on':''}" aria-pressed="${pr.density===k}" data-act="ship-density" data-d="${k}">${l}</button>`).join('')}</div></div>
    <div class="field ss-f"><label for="ss-group">Группировка таблицы</label><select id="ss-group" class="inp sm" data-on="ship-group">${SHIP_GROUPS.map(([k,l])=>`<option value="${k}" ${pr.group===k?'selected':''}>${l}</option>`).join('')}</select></div>
    <div class="field ss-f"><label for="ss-size">Строк на странице</label><select id="ss-size" class="inp sm" data-on="ship-size">${SHIP_SIZES.map(n=>`<option value="${n}" ${pr.size===n?'selected':''}>${n}</option>`).join('')}</select></div>
  </div></section>`;
}
// Содержимое под фильтрами: таблица или воронка. Его же перерисовывает поиск, чтобы не терять курсор в поле.
function shipBody(now){
  const u=shipUi(),pr=shipPrefs(),dir=shipDir();
  if(pr.view==='map') return shipMap(u,dir);
  return pr.view==='funnel'?shipFunnel(u,pr,dir,now||shipNow()):shipTable(u,pr,dir,now||shipNow());
}
function vLogistics(){
  const u=shipUi(),pr=shipPrefs(),dir=shipDir(),now=shipNow();
  const open=d=>S.shipments.filter(s=>(s.dir||'in')===d&&!isDone(s)).length;
  let h=`<div class="bar"><div class="seg" role="group" aria-label="Что показать">${[['in','Едут к нам'],['out','Отгрузки клиентам']].map(([k,l])=>`<button type="button" class="${dir===k?'on':''}" aria-pressed="${dir===k}" data-act="log-tab" data-tab="${k}">${l}<b>${open(k)}</b></button>`).join('')}</div>
    <div class="seg" role="group" aria-label="Вид">${SHIP_VIEWS.map(([k,l])=>`<button type="button" class="${pr.view===k?'on':''}" aria-pressed="${pr.view===k}" data-act="ship-view" data-v="${k}">${l}</button>`).join('')}</div>
    <span class="grow"></span>
    <button type="button" class="btn sm${u.settings?' pri':''}" data-act="ship-settings" aria-expanded="${u.settings}">${ic('sliders')}Настройка вида</button>
    ${can('logistics')?`<button type="button" class="btn pri" data-act="new-ship">${ic('plus')}Новая поставка</button>`:''}</div>`;
  if(!can('logistics')) h+=`<p class="hint">Этапы перевозки отмечает логист. Каждая отметка приходит вам уведомлением.</p>`;
  h+=shipSettings(pr,u)+shipFilterBar(u,pr,dir)+`<div id="ship-body" class="stack-s">${shipBody(now)}</div>`;
  return h;
}

// ——— смена этапа: единственный путь ———
// Ручная отметка из строки, карточки, воронки и формы. Этап пишет только Ships.setStage (история с источником
// «вручную», уведомление всем, у кого включён вид «Поставки»); здесь — права, закрытые поставки и сообщение клиенту.
function shipMark(shipId,stageId){
  const s=ship(shipId),m=me(),now=new Date();
  if(!s) return {ok:false,reason:'Поставки нет.'};
  const fail=(msg,quiet)=>{if(!quiet) toast(msg,'warn');return {ok:false,reason:msg}};
  if(!can('logistics')) return fail('Этапы перевозки отмечает логист.');
  const stg=Pipes.stage(S,s.pipeId,stageId);
  if(!stg) return fail('Такого этапа в воронке нет.');
  if(s.stageId===stageId) return fail('Поставка уже на этом этапе.',true);
  if(isDone(s)) return fail('Поставка уже закрыта: этап не меняется.');
  if(s.dir==='in'&&stg.flag==='final') return fail('На склад входящую поставку ставит приёмка: она кладёт товар на юрлицо и город.');
  const wasOut=s.dir==='out'&&leftStart(s);
  const r=Ships.setStage(S,s.id,stageId,m.id,now,Ships.SRC.manual);
  if(!r.ok) return fail(r.reason);
  // отгрузка клиенту ушла со склада — автосообщение клиенту, как в v2 (в рабочей версии сообщений клиентам нет)
  if(!SERVER&&s.dir==='out'&&!wasOut&&leftStart(s)&&rule('shipped')?.on&&s.deal){
    const d=deal(s.deal);
    if(d&&d.channel!=='phone') S.msgs.push({id:Store.freeId(S.msgs,'m'),at:now,deal:d.id,channel:d.channel,auto:true,text:`${d.contact}, здравствуйте! Ваш заказ отгружен: ${s.track}. Привезём ${fD(s.eta)}. Ваш менеджер — ${person(d.managerId)?.name||''}.`});
  }
  const got=r.note?r.note.to.filter(id=>id!==m.id).length:0;
  render();
  toast(`${s.id}: «${stg.name}». Уведомление получили ${got} ${pl(got,'сотрудник','сотрудника','сотрудников')}.`);
  return r;
}
// Форма «Отметить этап»: этап — через shipMark, срок и комментарий — отдельными отметками в историю.
function shipStageForm(f){
  const s=ship(f.dataset.id),m=me(),now=new Date();
  if(!s){closeModal();return}
  const stageId=byId('st-stage').value,eta=byId('st-eta').value,note=byId('st-note').value.trim();
  const ne=eta?fromIso(eta,s.eta?s.eta.getHours()||12:12):s.eta,old=s.eta,moved=!!old&&!!ne&&dd(ne)!==dd(old);
  const termNote=()=>s.history.push({at:now,by:m.id,text:`Срок прихода: было ${fD(old)}, стало ${fD(ne)}.`,source:Ships.SRC.manual});
  if(stageId!==s.stageId){
    if(moved) s.eta=ne;               // срок ставим до отметки: в уведомлении уже новая дата
    const r=shipMark(s.id,stageId);
    if(!r.ok){s.eta=old;return}
    if(moved) termNote();
  }else if(moved){
    s.eta=ne;termNote();
    Notify.push(S,'ship',m.id,`${s.id}: срок прихода — ${fD(ne)} (было ${fD(old)}). Сейчас: ${shipWhere(s)}.`,now,[],{t:'ship',id:s.id});
  }
  if(note) s.history.push({at:now,by:m.id,text:'Комментарий: '+note,source:Ships.SRC.manual});
  closeModal();render();
}
// Форма «Новая поставка»: маршрут Китай → Чита → город назначения, положение и этап — через ядро.
function shipCreate(f){
  const from=byId('ns-from').value.trim(),m=me(),now=new Date(),items=[],pipe=shipPipe('in');
  f.querySelectorAll('.irow').forEach(r=>{const sku=r.querySelector('select').value,q=parseInt(r.querySelector('input').value,10)||0;if(q<1) return;const e=items.find(i=>i.productId===sku);if(e) e.qty+=q;else items.push({productId:sku,qty:q})});
  if(!from||!items.length) return showErr('ns-err','Укажите, откуда едет груз, и хотя бы одну позицию с количеством.');
  const city=byId('ns-city').value,route=['cn','chita',city];
  const id=Ships.nextNumber(S);
  const eta=byId('ns-eta').value?fromIso(byId('ns-eta').value):day(7,12);
  const start=startStage(pipe.id),wanted=Pipes.stage(S,pipe.id,byId('ns-stage').value);
  const s={id,number:id,dir:'in',supplier:from,to:'Наш склад',carrier:byId('ns-car').value,track:byId('ns-doc').value.trim()||'нет данных: номер накладной',
    entityId:byId('ns-ent').value,cityId:city,route,pos:{i:0,t:0},eta,pipeId:pipe.id,stageId:start.id,
    items,history:[{at:now,by:m.id,text:`Поставка создана. Маршрут: ${Ships.routeText(route)}.`,source:Ships.SRC.manual}]};
  const files=attDraftFiles();if(files) s.files=files;
  S.shipments.push(s);
  // сразу на нужный этап — тоже через ядро: оно расставит груз на маршруте, запишет историю и разошлёт уведомление
  if(wanted&&wanted.id!==start.id) Ships.setStage(S,id,wanted.id,m.id,now,Ships.SRC.manual);
  else Notify.push(S,'ship',m.id,`Новая поставка ${id} из «${from}»: ${Ships.brief(S,s)}. Маршрут: ${Ships.routeText(route)}. На складе ожидается ${fD(eta)}.`,now,[],{t:'ship',id:id});
  closeModal();S.ui.logTab='in';render();toast(`Поставка ${id} создана. Менеджеры уже видят её в остатках как «едет к нам».`);
}

// ——— имитация: статус от перевозчика ———
// Перевозчик (настоящего трека пока нет) сообщает, что груз сдвинулся: один шаг по маршруту через Ships.advance с
// источником «автоматически: перевозчик». Правила директора, которые этот шаг запускает, видны в истории поставки.
// Можно ли двигать: едет к нам, есть маршрут, ещё в пути (не ждёт приёмки, не принята), есть следующий шаг в плане.
function shipCarrierCan(s){
  if(!s||s.dir!=='in'||s.received||isDone(s)||awaitsReceipt(s)||!Array.isArray(s.route)||s.route.length<2) return false;
  if(s.stageId===Ships.ST.ordered) return false;
  const pl_=Ships.plan(S,s),i=pl_.findIndex(e=>e.stageId===s.stageId);
  return i>=0&&i<pl_.length-1;
}
// Одна поставка в пути: с самым ранним ожидаемым приходом (то, что уже опаздывает, — первым)
const shipCarrierPick=()=>S.shipments.filter(shipCarrierCan).sort((a,b)=>(a.eta?a.eta.getTime():Infinity)-(b.eta?b.eta.getTime():Infinity)||String(a.id).localeCompare(String(b.id),'ru',{numeric:true}))[0]||null;
function shipCarrier(shipId){
  const s=shipId?ship(shipId):shipCarrierPick(),now=new Date();
  if(!s){toast('Нет поставки в пути, которую можно сдвинуть.','warn');return {ok:false,reason:'Нет поставки в пути.'}}
  const r=Ships.advance(S,s.id,null,now,Ships.SRC.carrier);
  if(!r.ok){toast(r.reason,'warn');return r}
  const got=r.note?r.note.to.length:0,rules=(r.applied||[]).length;
  render();
  toast(`Перевозчик сообщил по ${s.id}: «${r.to.name}». Сейчас: ${Ships.where(s).text}. Уведомление получили ${got} ${pl(got,'сотрудник','сотрудника','сотрудников')}.${rules?` Сработало ${rules} ${pl(rules,'правило','правила','правил')} директора.`:''}`);
  return Object.assign({shipId:s.id},r);
}
// Имитация «груз прибыл»: поверх того же выбора поставки (shipCarrierPick) — перевозчик сообщает, что груз приехал в город
// назначения; поставка встаёт на этап с флагом «прибыло» через Ships.setStage и ждёт приёмки.
function shipArrive(){
  const s=shipCarrierPick(),now=new Date();
  if(!s){toast('Нет поставки в пути, которая могла бы прибыть.','warn');return {ok:false,reason:'Нет поставки в пути, которая могла бы прибыть.'}}
  const stage=stagesFor(s).find(x=>x.flag==='arrived');
  if(!stage){toast('В воронке поставок нет этапа «прибыло».','warn');return {ok:false,reason:'В воронке поставок нет этапа «прибыло».'}}
  const r=Ships.setStage(S,s.id,stage.id,null,now,Ships.SRC.carrier);
  if(!r.ok){toast(r.reason,'warn');return r}
  render();
  toast(`Перевозчик сообщил: ${s.id} прибыла в город назначения и ждёт приёмки на складе.`);
  return Object.assign({shipId:s.id},r);
}
// Результат имитации для «Пульта проверки»: {text — что произошло, view — где смотреть, id — карточка}
SIMS.push({id:'carrier',label:'Имитация: пришёл статус от перевозчика',run:()=>{
  const r=shipCarrier();
  return r.ok===false?{text:r.reason,view:'logistics'}:{text:`Перевозчик сообщил по ${r.shipId}: «${r.to.name}». Сейчас: ${Ships.where(ship(r.shipId)).text}.`,view:'logistics',id:r.shipId};
}});
SIMS.push({id:'arrival',label:'Имитация: груз прибыл в город',run:()=>{
  const r=shipArrive();
  return r.ok===false?{text:r.reason,view:'logistics'}:{text:`Груз ${r.shipId} прибыл в город назначения и ждёт приёмки на складе.`,view:'logistics',id:r.shipId};
}});

// ——— карточка поставки ———
function dShip(s){
  const now=shipNow(),late=shipLate(s,now),done=isDone(s),place=shipPlace(s);
  // кто ждёт товар: резервы под поставку глазами человека (Stock.reserveView) — количество видно всем, у кого есть право на
  // остатки, а сделку и клиента называют только тому, кому сделка видна; остальным — «сделка скрыта» (отгрузка: Stock.dealRef)
  const dealLink=ref=>`<button type="button" class="link" data-act="open-deal" data-id="${esc(ref.id)}">${esc(ref.id)} · ${esc(ref.client||'')}</button>`;
  const waits=s.dir==='in'?S.reserves.filter(r=>r.src===s.id).map(r=>Stock.reserveView(S,r,S.me)).filter(Boolean)
    .map(v=>{const p=product(v.productId);return (v.deal?dealLink(v.deal):v.hasDeal?`<span class="muted">${Stock.HIDDEN_DEAL}</span>`:noData('сделка'))+` <small class="muted">${esc(low(p?.name||'нет данных: товар'))} — ${qtyOf(v.qty,p)}</small>`})
    :(s.deal?[Stock.dealRef(S,s.deal,S.me)?dealLink(Stock.dealRef(S,s.deal,S.me)):`<span class="muted">${Stock.HIDDEN_DEAL}</span>`]:[]);
  const hist=(s.history||[]).slice().reverse().map(h=>{
    const src=h.source||(h.auto?'автоматически':'вручную'),who=h.by?person(h.by)?.name:null;
    return `<li><div class="sh-t">${esc(h.text)}</div><small>${fWhen(h.at)}${who?' · '+esc(who):''} · <span class="pill sm${h.auto?' info':''}">${esc(src)}</span></small></li>`;
  }).join('');
  const photos=s.received?(()=>{const r=s.received;return `<div class="photos-row">${(r.urls.length?r.urls.map(u=>`<img src="${esc(u)}" alt="Фото приёмки">`):Array.from({length:r.photos},()=>`<span class="ph-ph">${ic('photo')}</span>`)).join('')}<small>${r.photos} фото · принял(а) ${esc(person(r.by)?.name||'')}${r.note?' · '+esc(r.note):''}</small></div>${unsavedNote(r)}`})():'';
  const acts=[];
  if(can('logistics')&&!done) acts.push(`<button type="button" class="btn sm" data-act="stage" data-id="${esc(s.id)}">${ic('pin')}Отметить этап…</button>`);
  if(can('logistics')&&shipCarrierCan(s)) acts.push(`<button type="button" class="btn sm" data-act="ship-carrier" data-id="${esc(s.id)}">${ic('truck')}Имитация: статус от перевозчика</button>`);
  if(can('receive')&&awaitsReceipt(s)) acts.push(`<button type="button" class="btn sm pri" data-act="rcv-start" data-id="${esc(s.id)}">${ic('camera')}Принять на складе</button>`);
  const stageNow=done||!can('logistics')?`<span class="pill ${done?'ok':late?'bad':awaitsReceipt(s)?'sun':'info'}">${esc(stageName(s))}</span>`:shipStageSelect(s,'inp sm');
  return {kind:(s.dir==='out'?'Отгрузка ':'Поставка ')+s.id,title:esc(s.supplier)+(s.demo?' <span class="pill sm">пример</span>':''),sub:esc(shipWhere(s)),body:`
    <div class="d-stage"><div class="field"><label>Этап</label>${stageNow}</div>${late?'<span class="pill bad">Опаздывает</span>':''}</div>
    ${shipScale(s,now,true)}
    <dl class="kv"><dt>Ожидается</dt><dd>${s.eta?fD(s.eta):'нет данных'} · ${esc(shipEtaText(s,now))}</dd>
      <dt>Отправлена</dt><dd>${s.depart?fD(s.depart):'нет данных: дата отправки'}</dd>
      <dt>Перевозчик</dt><dd>${esc(s.carrier||'нет данных')}</dd><dt>Трек</dt><dd><span class="mono">${esc(s.track||'нет данных')}</span></dd>
      ${s.dir==='in'?`<dt>Юрлицо</dt><dd>${esc(place.entity)}</dd><dt>Город</dt><dd>${esc(place.city)}</dd>`:`<dt>Куда</dt><dd>${esc(s.to||'нет данных')}</dd>`}
      ${Array.isArray(s.route)&&s.route.length>1?`<dt>Маршрут</dt><dd>${esc(Ships.routeText(s.route))}</dd>`:''}</dl>
    <div><h4 class="sh">Позиции · штук ${num(Ships.units(s))}</h4>${shipItems(s)}</div>
    ${waits.length?`<div class="waits">${ic('users')}<span>${s.dir==='in'?'Ждут этот товар':'Для сделки'}: ${waits.join(', ')}</span></div>`:''}
    ${attCardHtml('ship',s)}
    ${photos}${acts.length?`<div class="ship-f">${acts.join('')}</div>`:''}
    <div><h4 class="sh">История отметок</h4><ul class="shist">${hist||'<li class="muted">Отметок пока нет.</li>'}</ul></div>`};
}

// ——— регистрация в реестрах оболочки ———
SEARCH.push({kind:'ship',label:'Перевозка',order:60,find:q=>!(can('stock')||can('logistics'))?[]:S.shipments.filter(s=>searchHas(q,s.id,s.supplier,s.to,s.track)).map(s=>({title:`${s.id} · ${s.supplier}`,sub:`${stageName(s)} · ${fD(s.eta)}`,open:`data-act="open-ship" data-id="${esc(s.id)}"`}))});
DRAWERS.ship=id=>{const s=(can('stock')||can('logistics'))?ship(id):null;return s?dShip(s):null};
regRef('ship','поставка',id=>!!ship(id),'open-ship');
MODALS.shipItems=id=>mShipItems(ship(id));

Object.assign(A,{
  'open-ship':el=>openDrawer('ship',el.dataset.id),
  'ship-items':el=>openModal('shipItems',el.dataset.id),
  'ship-view':el=>{setShipPref('view',el.dataset.v);render()},
  'ship-settings':()=>{setShipUi({settings:!shipUi().settings});render()},
  'ship-density':el=>{setShipPref('density',el.dataset.d);render()},
  'ship-sort':el=>{const u=shipUi(),k=el.dataset.k;setShipUi({sort:u.sort===k?'-'+k:k,page:1});render()},
  'ship-page':el=>{setShipUi({page:Number(el.dataset.p)||1});render()},
  'ship-reset':()=>{setShipUi({q:'',stage:'open',supplier:'',node:'',city:'',entity:'',page:1});render()},
  // нажатие на точку, «на таможне» или перегон схемы: фильтр таблицы (точка или перегон; для таможни — ещё этап) и сама «Таблица»
  'ship-map':el=>{setShipPref('view','table');setShipUi({node:el.dataset.k,stage:el.dataset.stage||'open',page:1});render()},
  'ship-carrier':el=>{shipCarrier(el.dataset.id)}
});
Object.assign(ON.input,{
  // поиск перерисовывает только таблицу — курсор в поле остаётся
  'ship-q':el=>{setShipUi({q:el.value,page:1});byId('ship-body').innerHTML=shipBody()},
  'ship-items-q':el=>{const s=ship(el.dataset.id);if(s) byId('si-body').innerHTML=shipItemsList(s,el.value)}
});
Object.assign(ON.change,{
  'ship-f':el=>{setShipUi({[el.dataset.k]:el.value,page:1});render()},
  'ship-col':el=>{
    const on=new Set(shipPrefs().cols);
    if(el.checked) on.add(el.dataset.k);else on.delete(el.dataset.k);
    setShipPref('cols',SHIP_COLS.map(c=>c[0]).filter(k=>k==='number'||on.has(k)));render();
  },
  'ship-group':el=>{setShipPref('group',el.value);setShipUi({page:1});render()},
  'ship-size':el=>{setShipPref('size',Number(el.value));setShipUi({page:1});render()},
  'ship-stage':el=>{if(!shipMark(el.dataset.id,el.value).ok) render()}
});

// ——— перетаскивание карточек воронки между колонками ———
// Свои колонки (data-scol) и свой drop: общий обработчик оболочки смотрит только на data-col (задачи).
document.addEventListener('dragover',e=>{
  const col=e.target.closest?.('[data-scol]');if(!col) return;
  e.preventDefault();document.querySelectorAll('.col.drop').forEach(x=>{if(x!==col) x.classList.remove('drop')});col.classList.add('drop');
});
document.addEventListener('drop',e=>{
  const col=e.target.closest?.('[data-scol]');if(!col) return;
  e.preventDefault();col.classList.remove('drop');
  const id=e.dataTransfer&&e.dataTransfer.getData('text/plain');
  if(id) shipMark(id,col.dataset.scol);
});
