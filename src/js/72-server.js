// Серверный режим в браузере (SERVER — страница, отданная сервером): вход и смена пароля, «Выйти», работа на общей базе.
// В демо (страница без метки) отсюда работает только то, что под if(SERVER), то есть ничего.
//
// Синхронизация документами. srv.confirmed — документы (Docs.split), которые сервер подтвердил этой вкладке.
// Действие — всё, что изменилось в S от прошлого save() до этого: save() → serverSave() режет его в пачку
// Docs.diff(srv.local, Docs.split(S)) и ставит в очередь srv.queue (srv.local — документы на момент прошлого среза).
// Пачки уходят POST /api/changes строго по одной, по порядку (srvKick); сервер проводит пачку целиком или не проводит.
// Отказ (409 — правки разошлись, 403 — нет прав) снимает только эту пачку: S собирается заново — подтверждённое сервером
// плюс оставшиеся в очереди пачки плюс несохранённое (srvReject); правки других действий остаются и уходят дальше.
// Пришли документы с сервера (ответ на пачку или /api/sync по событию seq): своей правки в документе нет — берётся
// серверный; есть — трёхстороннее слияние (Docs.merge); не сошлось — своя правка остаётся, а сервер ответит на неё 409
// с именем того, кто правил (тост и свежая версия). Обрыв связи — плашка и повтор той же пачки; повтор не задваивает:
// документ, который на сервере уже такой же, сервер пропускает.

const SRV_RETRY=[2,4,8,16,30];                  // повтор при обрыве связи, секунды
const SRV_NIGHT_HOUR=4;                         // вкладка, открытая с прошлых суток, перезагружается после 04:00
const SRV_NUMBERED=['Д-','Л-','К-','П-','ОТ-'];  // номера, которые выдаёт сервер (запас из /api/state и /api/ids)
const SRV_POOL_LOW=3,SRV_POOL_ADD=5;            // запас номеров пополняется в фоне, когда в нём меньше трёх
const SRV_LOCAL='ws-crm-srv:';                  // личное в localStorage: раздел, тема, вид поставок, черновик приёмки
const SRV_PASS_MIN=8;                           // пароль — не короче (как у сервера)
// Страница, отданная тому, кто не вошёл (сервер ставит CRM_LITE): в ней нет каталога, остатков и демо-записей, только вход.
// Как только вход состоялся, её надо перезагрузить — сервер отдаст полную.
const SRV_LITE=typeof CRM_LITE!=='undefined'&&!!CRM_LITE;
const SRV_OFF_TEXT='Нет связи с сервером — изменения сохранятся, когда связь вернётся';
const SRV_GONE_TEXT='Запись уже удалена или недоступна';
// Что в рабочей версии не показывается: почта, сообщения клиентам, пульт имитаций; вкладки «Почта» и «Данные» прототипа
const SRV_HIDE={nav:['mail','messages','sims'],tabs:['mail','data']};

const srv={
  confirmed:{},local:{},queue:[],view:'',seq:0,pools:{},refill:{},tag:'',tab:'',n:0,person:null,
  busy:false,wantPush:false,wantPull:false,gate:false,offline:false,retry:0,retryT:0,
  es:null,build:'',waiters:[],openedAt:null,timer:0,users:null,usersBusy:false,usersErr:'',shown:null
};

if(SERVER){
  for(const id of SRV_HIDE.nav){const i=NAV.findIndex(n=>n.id===id);if(i>=0) NAV.splice(i,1)}
  for(const id of SRV_HIDE.tabs){const i=SETTINGS_TABS.findIndex(t=>t.id===id);if(i>=0) SETTINGS_TABS.splice(i,1)}
  try{document.documentElement.dataset.mode='server'}catch(_){}
}

// ——— запросы ———
// → {status, body}; нет связи — исключение (его ловит вызывающий)
async function srvApi(method,url,body){
  const opt={method,headers:{},credentials:'same-origin'};
  if(method==='POST'){
    opt.headers['X-CRM']='1';
    if(body!==undefined){opt.headers['Content-Type']='application/json';opt.body=JSON.stringify(body)}
  }
  const r=await fetch(url,opt);
  let data=null;
  try{data=await r.json()}catch(_){data=null}
  return {status:r.status,body:data||{}};
}
// Ответ не про данные: 401 — окно входа, 403 с mustChange — смена пароля, 5xx — как нет связи. → true, если разобран
function srvStatus(r){
  if(r.status===401){srvGate(true);return true}
  if(r.status===403&&r.body&&r.body.mustChange){srvPassGate(true);return true}
  if(r.status>=500) throw new Error('сервер не отвечает');
  return false;
}

// ——— запуск ———
// Зовётся из 90-boot.js вместо S=startState(); render(). Без сеанса — окно входа; mustChange — сначала смена пароля.
async function serverBoot(){
  srv.tab=Math.random().toString(36).slice(2,6);
  Ids.use(srvId);
  try{byId('view').innerHTML='<p class="empty">Войдите, чтобы открыть CRM.</p>'}catch(_){}
  if(typeof window!=='undefined'&&window.addEventListener){
    window.addEventListener('beforeunload',e=>{if(srvPending()){e.preventDefault();e.returnValue='';return ''}});
  }
  return srvStart();
}
async function srvStart(){
  let r;
  try{r=await srvApi('GET','/api/me')}catch(_){srvOffline(srvStart);return 'offline'}
  if(r.status===401){srvGate(false);return 'gate'}
  if(r.status!==200){srvOffline(srvStart);return 'offline'}
  if(SRV_LITE){srvReload();return 'reload'}
  srv.person=r.body.person;srv.tag=r.body.tag||'k';
  if(r.body.mustChange){srvPassGate(true);return 'password'}
  return srvLoad();
}
// Состояние фирмы глазами этого человека (/api/state) → S; личное — из localStorage этого браузера
async function srvLoad(){
  let r;
  try{r=await srvApi('GET','/api/state')}catch(_){srvOffline(srvStart);return 'offline'}
  if(r.status!==200){if(!srvStatus(r)) srvOffline(srvStart);return 'gate'}
  srvOnline();
  const pid=srv.person.id,b=r.body,loc=srvReadLocal(pid);
  srv.view=b.view||'';srv.seq=b.seq||0;srv.pools={};
  for(const p of SRV_NUMBERED) srv.pools[p]=((b.ids||{})[p]||[]).slice();
  srv.confirmed=Docs.split(JSON.parse(JSON.stringify(b.state||{}),Store.revive));
  const prefs={};
  if(loc.theme) prefs.theme=loc.theme;
  if(loc.ship) prefs.ship=loc.ship;
  S=Docs.join(srv.confirmed,{me:pid,view:loc.view||'home',ui:defaultUi(),rcv:loc.rcv||null,v:3,prefs});
  srv.local=Docs.split(S);srv.queue=[];
  const h=hashView();if(h) S.view=h;
  srv.openedAt=new Date();srv.gate=false;srvClose();
  render();
  srvEvents();
  if(!srv.timer&&typeof setInterval==='function') srv.timer=setInterval(srvMinute,60000);
  return 'ready';
}

// ——— личное в этом браузере ———
function srvReadLocal(pid){
  try{const raw=localStorage.getItem(SRV_LOCAL+pid);return raw?JSON.parse(raw,Store.revive)||{}:{}}catch(_){return {}}
}
function srvSaveLocal(){
  if(!S||!S.me) return;
  try{localStorage.setItem(SRV_LOCAL+S.me,JSON.stringify(Store.plain({view:S.view,theme:S.prefs&&S.prefs.theme,ship:S.prefs&&S.prefs.ship,rcv:S.rcv})))}catch(_){}
}
// save() в серверном режиме: личное — в браузер, общее — пачкой этого действия в очередь на сервер
function serverSave(){
  srvSaveLocal();
  // запись без id Docs.split не режет: срез не делается, правки ждут следующего save() (закрыть вкладку — предупредит)
  try{srvCut()}catch(_){}
  srv.wantPush=true;srvKick();
  return {ok:true,droppedPhotos:0,fits:true};
}
// Срез действия: всё, чем S отличается от прошлого среза, — одна пачка в очередь
function srvCut(){
  if(!S) return;
  const cur=Docs.split(S),changes=Docs.diff(srv.local,cur);
  if(changes.length) srv.queue.push({changes});
  srv.local=cur;
}

// ——— номера и id ———
// Поставщик для Ids.use: Д-, Л-, К-, П-, ОТ- — из запаса, выданного сервером; прочее — уникальное с меткой сеанса и вкладки
function srvId(prefix){
  if(SRV_NUMBERED.includes(prefix)){
    const pool=srv.pools[prefix]||(srv.pools[prefix]=[]),id=pool.shift();
    if(pool.length<SRV_POOL_LOW) srvRefill(prefix);
    if(id) return id;
  }
  srv.n++;
  return prefix+srv.tag+srv.tab+srv.n;
}
async function srvRefill(prefix){
  if(srv.refill[prefix]||typeof fetch==='undefined') return;
  srv.refill[prefix]=true;
  try{
    const r=await srvApi('POST','/api/ids',{prefix,n:SRV_POOL_ADD});
    if(r.status===200&&Array.isArray(r.body.ids)) (srv.pools[prefix]||(srv.pools[prefix]=[])).push(...r.body.ids);
  }catch(_){}finally{srv.refill[prefix]=false}
}

// ——— очередь запросов ———
// Есть ли неотправленное: запрос в пути, пачки в очереди или правки после прошлого среза
function srvPending(){
  if(!S) return false;
  return srv.busy||srv.queue.length>0||Docs.diff(srv.local,Docs.split(S)).length>0;
}
// Когда всё отправлено и получено (или связь пропала, или нужен вход) — для «Выйти», заведения сотрудника и тестов
function serverIdle(){
  // ждать нечего: запрос не в пути и отправлять нечего или некуда (нужен вход, нет связи)
  if(!srv.busy&&(srv.gate||srv.offline||!S||(!srv.wantPush&&!srv.wantPull))) return Promise.resolve();
  return new Promise(ok=>srv.waiters.push(ok));
}
function srvSettle(){const w=srv.waiters;srv.waiters=[];w.forEach(f=>f())}
function srvKick(){
  if(srv.busy) return;
  if(srv.gate||srv.offline||!S||(!srv.wantPush&&!srv.wantPull)){srvSettle();return}
  srv.busy=true;
  (async()=>{
    let lost=false;
    try{
      while(!srv.gate&&(srv.wantPush||srv.wantPull)){
        if(srv.wantPush){srv.wantPush=false;try{await srvPush()}catch(e){srv.wantPush=true;throw e}}
        else{srv.wantPull=false;try{await srvPull()}catch(e){srv.wantPull=true;throw e}}
      }
    }catch(_){lost=true}
    srv.busy=false;
    if(lost) srvOffline(srvKick);
    else{srvOnline();if(srv.wantPush||srv.wantPull) return srvKick()}
    srvSettle();
  })();
}

// Отправить первую пачку очереди. Принята — подтверждена; отвергнута — снимается только она (srvReject), остальные
// ждут своей очереди; 401 и смена пароля — пачка остаётся первой и уйдёт после входа
async function srvPush(){
  const act=srv.queue[0];
  if(!act) return;
  const r=await srvApi('POST','/api/changes',{changes:act.changes,view:srv.view});
  if(r.status!==200&&srvStatus(r)){srv.wantPush=true;return}
  srv.queue.shift();
  if(srv.queue.length) srv.wantPush=true;
  if(r.status===200){
    for(const c of act.changes){const d=Docs.docId(c.key,c.id);if(c.deleted) delete srv.confirmed[d];else srv.confirmed[d]=c.data}
    srvTake(r.body);
    return;
  }
  const b=r.body||{};
  let text;
  if(r.status===409) text=`Пока ты правил, «${srvLabel(b.key,b.id)}» изменил(а) ${b.by||'нет данных: кто'} — показана свежая версия, повтори`;
  else{const err=String(b.error||'Сервер не принял изменения');text=/^Нет прав: править эту запись/.test(err)?SRV_GONE_TEXT:err}
  srvReject(act,b);
  toast(text,'warn');
  srv.wantPull=true;
}
async function srvPull(){
  const r=await srvApi('GET','/api/sync?view='+encodeURIComponent(srv.view));
  if(r.status===200){srvTake(r.body);return}
  srvStatus(r);
}
// Отказ пачки act: снимается только она. Свежие документы из ответа (409) — в подтверждённую копию; srv.local —
// подтверждённое плюс пачки, что остались в очереди; S — srv.local плюс несохранённое после прошлого среза.
function srvReject(act,body){
  const unsaved=Docs.diff(srv.local,Docs.split(S));
  for(const [d,theirs] of srvIncoming(body)){if(theirs===undefined) delete srv.confirmed[d];else srv.confirmed[d]=theirs}
  srv.local=srvReplay(srv.confirmed,srv.queue.flatMap(a=>a.changes));
  S=Docs.join(srvReplay(srv.local,unsaved),S);
  if(!S.people.some(p=>p.id===S.me)&&srv.person) S.people.push({...srv.person});
  const n=srv.queue.length,sig=JSON.stringify(act.changes);
  render();
  // отрисовка сама повторила отвергнутую правку (запись при отрисовке) — второй раз её не шлём, иначе отказ по кругу
  srv.queue=srv.queue.filter((a,i)=>i<n||JSON.stringify(a.changes)!==sig);
}
// Товар снимка каталога: его запись снимка (документа о нём нет, пока его не правили) или null
function srvSnap(key,id){
  if(key!=='products') return null;
  const p=Catalog.base().byId.get(id);
  return p?Store.plain(p):null;
}
// Наложить правки (формы Docs.diff) на документы трёхсторонним слиянием: base → data поверх того, что есть.
// Не сошлось (правка опиралась на отвергнутую) — остаётся то, что есть; сама пачка уйдёт, и сервер ответит на неё.
function srvReplay(docs,changes){
  const out={...docs};
  for(const c of changes){
    const d=Docs.docId(c.key,c.id),snap=srvSnap(c.key,c.id),cur=d in out?out[d]:snap;
    const m=Docs.merge(c.base===undefined?null:c.base,c.deleted?null:c.data,cur===undefined?null:cur);
    if(!m.ok) continue;
    const v=m.value===undefined?null:m.value;
    if(snap?Docs.same(v,snap):v===null) delete out[d];else out[d]=v;
  }
  return out;
}
// Ответ сервера → Map документов (data или undefined — исчез); номер правки и вкладка запоминаются
function srvIncoming(body){
  const inc=new Map();
  if(!body) return inc;
  if(typeof body.seq==='number'&&body.seq>srv.seq) srv.seq=body.seq;
  if(body.view) srv.view=body.view;
  for(const x of body.docs||[]) inc.set(Docs.docId(x.key,x.id),x.data);
  for(const x of body.gone||[]) inc.set(Docs.docId(x.key,x.id),undefined);
  if(body.full) for(const d of Object.keys(srv.confirmed)) if(!inc.has(d)) inc.set(d,undefined);
  return inc;
}

// Документы с сервера → S и srv.local. body — {seq, view, docs, gone, full}. Своя правка в документе (в очереди или ещё
// не сохранённая) — слияние; не сошлось — своя остаётся вместе со своей основой, и сервер ответит на неё 409.
// → Set документов, пришедших в ответе
function srvTake(body){
  const inc=srvIncoming(body);
  if(!inc.size) return new Set();
  const before=new Set(Notify.unreadIds(S,S.me)),cur=Docs.split(S);
  let clash=false;
  // своё docs[d] (правка поверх base) и серверное theirs: слияние; не сошлось — docs[d] не трогается, → false
  const put=(docs,d,base,theirs)=>{
    const mine=docs[d];
    let v=theirs;
    if(!Docs.same(base,mine)&&!Docs.same(mine,theirs)){
      const m=Docs.merge(base,mine,theirs);
      if(!m.ok) return false;
      v=m.value;
    }
    if(v===undefined) delete docs[d];else docs[d]=v;
    return true;
  };
  for(const [d,theirs] of inc){
    const base=srv.confirmed[d];
    // не сошлось с несохранённым — и основа среза (srv.local) остаётся прежней: иначе своя правка ушла бы поверх чужой молча
    if(!put(cur,d,base,theirs)||!put(srv.local,d,base,theirs)) clash=true;
    if(theirs===undefined) delete srv.confirmed[d];else srv.confirmed[d]=theirs;
  }
  S=Docs.join(cur,S);
  if(!S.people.some(p=>p.id===S.me)&&srv.person) S.people.push({...srv.person});
  if(clash) srv.wantPush=true;
  render();
  srvPopups(before);
  return new Set(inc.keys());
}
// Как назвать запись в тосте: название, клиент или номер
function srvLabel(key,id){
  const list=Array.isArray(S&&S[key])?S[key]:[],r=list.find(x=>x&&String(x.id)===String(id));
  const t=r&&(r.title||r.name||(r.client?`${r.id} · ${r.client}`:'')||r.number);
  return t?String(t):String(id||key);
}

// ——— живые обновления ———
function srvEvents(){
  if(typeof EventSource==='undefined') return;
  if(srv.es){try{srv.es.close()}catch(_){}}
  const es=new EventSource('/api/events');
  srv.es=es;
  es.addEventListener('seq',e=>{
    let n=0;try{n=Number(JSON.parse(e.data))}catch(_){}
    if(n>srv.seq||srv.offline){srv.wantPull=true;if(srv.offline) srvRetryNow();else srvKick()}
  });
  es.addEventListener('reload',()=>srvReloadSoon());
  // Версия страницы на сервере сменилась (код обновили) — эта вкладка устарела, перезагрузить
  es.addEventListener('build',e=>{let b='';try{b=JSON.parse(e.data)}catch(_){}if(srv.build&&b&&srv.build!==b) srvReloadSoon();if(b) srv.build=b});
  es.addEventListener('bye',()=>{try{es.close()}catch(_){}if(srv.es===es) srv.es=null;srvGate(true)});
  es.onerror=()=>{
    // поток закрыт насовсем (401, сеанс кончился) — проверить вход; обрыв сети поток переподключает сам
    if(es.readyState===2&&srv.es===es){srv.es=null;srvCheck()}
  };
}
async function srvCheck(){
  let r;
  try{r=await srvApi('GET','/api/me')}catch(_){srvOffline(srvCheck);return}
  if(r.status===401) return srvGate(true);
  if(r.status===200&&!srv.es&&!srv.gate) srvEvents();
}

// ——— нет связи ———
function srvOffline(again){
  srv.offline=true;
  const bar=srvEl('srv-off');
  if(bar){bar.innerHTML=`${ic('alert')}<span>${esc(SRV_OFF_TEXT)}</span>`;bar.hidden=false}
  clearTimeout(srv.retryT);
  const sec=SRV_RETRY[Math.min(srv.retry,SRV_RETRY.length-1)];
  srv.retry++;
  srv.retryAgain=again||srvKick;
  srv.retryT=setTimeout(srvRetryNow,sec*1000);
  srvSettle();
}
function srvRetryNow(){
  clearTimeout(srv.retryT);
  const f=srv.retryAgain||srvKick;
  srv.offline=false;srv.retryAgain=null;
  f();
}
function srvOnline(){
  if(!srv.offline&&!srv.retry) return;
  srv.offline=false;srv.retry=0;clearTimeout(srv.retryT);
  const bar=srvEl('srv-off');if(bar){bar.hidden=true;bar.innerHTML=''}
  if(S&&!srv.es) srvEvents();
}

// ——— окна: вход, смена пароля ———
// Свой корень поверх всего (окно входа и плашка): в странице его нет — заводится
function srvEl(id){
  if(typeof document==='undefined') return null;
  let el=document.getElementById(id);
  if(!el&&document.body){el=document.createElement('div');el.id=id;document.body.appendChild(el)}
  if(el&&id==='srv-off'&&!el.className){el.className='srv-off';el.setAttribute&&el.setAttribute('role','status')}
  return el;
}
function srvClose(){const r=srvEl('srv-root');if(r) r.innerHTML=''}
const srvBrand='<div class="srv-brand"><b>wind-solar</b><small>CRM</small></div>';
// Окно входа. mid — сеанс кончился посреди работы: CRM остаётся под окном, неотправленное ждёт входа
function srvGate(mid){
  srv.gate=true;
  const r=srvEl('srv-root');if(!r) return;
  r.innerHTML=`<div class="srv-gate${mid&&S?' over':''}"><form class="srv-box" data-form="srv-login" novalidate aria-labelledby="srv-g-t">${srvBrand}
    <h2 id="srv-g-t">Вход в CRM</h2>
    ${mid&&S?'<p class="hint m0">Сеанс закончился — войдите снова. Несохранённые изменения отправятся сразу после входа.</p>':''}
    <div class="field"><label for="srv-login">Логин</label><input id="srv-login" class="inp" autocomplete="username" autocapitalize="none" spellcheck="false"></div>
    <div class="field"><label for="srv-pass">Пароль</label><input id="srv-pass" class="inp" type="password" autocomplete="current-password"></div>
    <label class="check"><input type="checkbox" id="srv-foreign"><span class="check-t">Чужой компьютер<small class="muted">Вход до закрытия браузера, не дольше 12 часов</small></span></label>
    <p class="err" id="srv-err" hidden></p>
    <button type="submit" class="btn pri big">Войти</button>
  </form></div>`;
  setTimeout(()=>{try{byId('srv-login').focus()}catch(_){}},30);
  srvSettle();
}
// Смена пароля. force — без неё дальше нельзя (первый вход, пароль выдан директором)
function srvPassGate(force){
  srv.gate=!!force||srv.gate;
  const r=srvEl('srv-root');if(!r) return;
  r.innerHTML=`<div class="srv-gate${force&&!S?'':' over'}"><form class="srv-box" data-form="srv-pass" data-force="${force?1:''}" novalidate aria-labelledby="srv-p-t">${srvBrand}
    <h2 id="srv-p-t">${force?'Придумайте свой пароль':'Сменить пароль'}</h2>
    ${force?'<p class="hint m0">Пароль, который выдал директор, — временный. Задайте свой: дальше вход будет только с ним.</p>':''}
    <div class="field"><label for="srv-old">${force?'Временный пароль':'Нынешний пароль'}</label><input id="srv-old" class="inp" type="password" autocomplete="current-password"></div>
    <div class="field"><label for="srv-new">Новый пароль</label><input id="srv-new" class="inp" type="password" autocomplete="new-password"><small class="hint">Не короче ${SRV_PASS_MIN} символов.</small></div>
    <div class="field"><label for="srv-rep">Новый пароль ещё раз</label><input id="srv-rep" class="inp" type="password" autocomplete="new-password"></div>
    <p class="err" id="srv-err" hidden></p>
    <div class="bar">${force?'':'<button type="button" class="btn" data-act="srv-pass-cancel">Отмена</button>'}<button type="submit" class="btn pri">Сохранить пароль</button></div>
  </form></div>`;
  setTimeout(()=>{try{byId('srv-old').focus()}catch(_){}},30);
  srvSettle();
}
function srvGateErr(t){showErr('srv-err',t);return 'error'}

// Вход. Посреди работы (S уже есть): тот же человек — неотправленное уходит; другой — страница перезагружается.
async function serverLogin(login,password,foreign){
  let r;
  try{r=await srvApi('POST','/api/login',{login:String(login||'').trim(),password:String(password||''),foreign:!!foreign})}
  catch(_){return srvGateErr('Нет связи с сервером — попробуйте ещё раз.')}
  if(r.status!==200) return srvGateErr(r.body.error||'Не удалось войти.');
  if(!S) return srvStart();
  let me;
  try{me=await srvApi('GET','/api/me')}catch(_){return srvGateErr('Нет связи с сервером — попробуйте ещё раз.')}
  if(me.status!==200) return srvGateErr(me.body.error||'Не удалось войти.');
  if(!srv.person||me.body.person.id!==srv.person.id){srvReload();return 'reload'}
  srv.tag=me.body.tag||srv.tag;
  if(me.body.mustChange){srvPassGate(true);return 'password'}
  srv.gate=false;srvClose();
  srvEvents();
  srv.wantPush=true;srv.wantPull=true;srvKick();
  return 'resumed';
}
// Смена пароля: старый и новый (не короче 8). После вынужденной смены — CRM открывается
async function serverPassword(old,pass,rep,force){
  if([...String(pass||'')].length<SRV_PASS_MIN) return srvGateErr(`Новый пароль — не короче ${SRV_PASS_MIN} символов.`);
  if(rep!==undefined&&rep!==pass) return srvGateErr('Пароли не совпадают — введите новый пароль ещё раз.');
  let r;
  try{r=await srvApi('POST','/api/password',{old:String(old||''),password:String(pass)})}
  catch(_){return srvGateErr('Нет связи с сервером — попробуйте ещё раз.')}
  if(r.status===401){srvGate(!!S);return 'gate'}
  if(r.status!==200) return srvGateErr(r.body.error||'Пароль не изменён.');
  if(force&&!S){srv.gate=false;return srvLoad()}
  srv.gate=false;srvClose();
  toast('Пароль изменён.');
  if(force){srv.wantPush=true;srv.wantPull=true;srvKick()}
  return 'changed';
}
async function serverLogout(){
  await serverIdle();
  if(srvPending()) return toast('Есть неотправленные изменения, а связи с сервером нет. Выйти можно, когда связь вернётся.','warn');
  try{await srvApi('POST','/api/logout',{})}catch(_){}
  srvReload();
}
function srvReload(){try{location.reload()}catch(_){}}
function srvReloadSoon(){serverIdle().then(()=>{if(!srvPending()) srvReload()})}

// ——— раз в минуту: ночная перезагрузка, запас номеров ———
// Вкладка открыта в прошлые сутки, а сейчас уже 04:00 или позже — «сегодня» у неё устарело
function serverNightDue(openedAt,now){
  return !!openedAt&&sod(now)>sod(openedAt)&&new Date(now).getHours()>=SRV_NIGHT_HOUR;
}
function srvMinute(now=new Date()){
  if(!S) return;
  if(serverNightDue(srv.openedAt,now)&&!srvPending()&&!S.ui.modal) return srvReload();
  for(const p of SRV_NUMBERED) if((srv.pools[p]||[]).length<SRV_POOL_LOW) srvRefill(p);
}

// ——— системные уведомления ———
// Новое непрочитанное, а вкладка свёрнута — системное окно; щелчок открывает запись. Без разрешения — только звук и колокол.
function srvPopups(before){
  if(typeof Notification==='undefined'||Notification.permission!=='granted'||typeof document==='undefined'||!document.hidden) return 0;
  const fresh=Notify.unreadIds(S,S.me).filter(id=>!before.has(id));
  for(const id of fresh.slice(0,3)){
    const n=S.notes.find(x=>x.id===id);if(!n) continue;
    try{
      const p=new Notification('CRM wind-solar',{body:n.text,tag:n.id});
      p.onclick=()=>{
        try{window.focus()}catch(_){}
        Notify.markRead(S,S.me,n.id);
        if(n.ref) openRef(n.ref);
        render();
        try{p.close()}catch(_){}
      };
    }catch(_){}
  }
  return fresh.length;
}
// Состояние разрешения: 'granted' | 'denied' | 'default' | 'none' (браузер не умеет)
const srvNotifyState=()=>typeof Notification==='undefined'?'none':Notification.permission;

// ——— файлы на сервере ———
// Загрузить файл (File или Blob) в /api/files. kind 'photo' — фото товара: сервер принимает только JPEG, PNG, WebP, GIF по содержимому.
// → {id, name, type, size, url} или null (отказ уже показан)
async function serverUpload(file,name,kind){
  const nm=String(name||file.name||'файл');
  if((Number(file.size)||0)>ATT_SERVER_MAX_MB*1048576){toast(`Файл больше ${ATT_SERVER_MAX_MB} МБ — не загружен: «${nm}».`,'warn');return null}
  let r;
  try{
    const res=await fetch('/api/files',{method:'POST',headers:{'X-CRM':'1','X-File-Name':encodeURIComponent(nm),'Content-Type':file.type||'application/octet-stream',...(kind==='photo'?{'X-File-Kind':'photo'}:{})},body:file,credentials:'same-origin'});
    let b={};try{b=await res.json()}catch(_){}
    r={status:res.status,body:b||{}};
  }catch(_){toast(`Файл «${nm}» не загружен — нет связи с сервером. Повторите, когда связь вернётся.`,'warn');return null}
  if(r.status===200) return r.body;
  if(r.status===401){srvGate(true);return null}
  toast(r.body.error||`Файл «${nm}» не загружен.`,'warn');
  return null;
}
// data-URL (фото после сжатия) → Blob для загрузки
function srvBlob(dataUrl){
  const [head,b64]=String(dataUrl).split(','),type=(/data:([^;]+)/.exec(head)||[])[1]||'application/octet-stream';
  const bin=atob(b64||''),bytes=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
  return new Blob([bytes],{type});
}

// ——— сотрудники: логины, пароли, сеансы (только директор) ———
async function srvUsersLoad(){
  if(srv.usersBusy||!can('admin')) return;
  srv.usersBusy=true;
  try{
    const r=await srvApi('GET','/api/users');
    if(r.status===200){srv.users=new Map((r.body.users||[]).map(u=>[u.personId,u]));srv.usersErr=''}
    else if(!srvStatus(r)) srv.usersErr=r.body.error||'нет данных: логины';
  }catch(_){srv.usersErr='нет данных: логины (нет связи с сервером)'}
  srv.usersBusy=false;
  if(S&&S.view==='team') render();
}
// Действие с входом сотрудника: what — login | password | disable | logout. → {status, body}
async function srvUserAct(pid,what,body){
  try{return await srvApi('POST',`/api/users/${encodeURIComponent(pid)}/${what}`,body||{})}
  catch(_){return {status:0,body:{error:'Нет связи с сервером — попробуйте ещё раз.'}}}
}

// ——— действия ———
A['srv-logout']=()=>serverLogout();
A['srv-password']=()=>srvPassGate(false);
A['srv-pass-cancel']=()=>{srvClose();if(!S) srvGate(false)};
A['srv-notify-perm']=()=>{
  if(typeof Notification==='undefined') return toast('Этот браузер не умеет всплывающие уведомления.','warn');
  Promise.resolve(Notification.requestPermission()).then(p=>{
    render();
    toast(p==='granted'?'Всплывающие уведомления разрешены: они появятся, когда вкладка CRM свёрнута.':'Браузер не разрешил всплывающие уведомления — остаются звук и колокол.',p==='granted'?'':'warn');
  });
};
FORMS['srv-login']=()=>serverLogin(byId('srv-login').value,byId('srv-pass').value,byId('srv-foreign').checked);
FORMS['srv-pass']=f=>serverPassword(byId('srv-old').value,byId('srv-new').value,byId('srv-rep').value,!!f.dataset.force);

// Кнопки «Сменить пароль» и «Выйти» под именем в панели разделов
const serverMeHtml=()=>`<div class="srv-me"><button type="button" class="btn sm ghost" data-act="srv-password">${ic('lock')}Сменить пароль</button><button type="button" class="btn sm ghost" data-act="srv-logout">${ic('arrow')}Выйти</button></div>`;
