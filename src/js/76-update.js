// «Настройки → Обновление» (только директор и только на сервере): какая версия CRM стоит, есть ли новее на GitHub и кнопка «Обновить».
// Всё делает сервер (server/updater.js): копия базы, скачивание, проверка, замена кода, перезапуск; здесь только показ и две
// кнопки через /api/update. После установки страница ждёт, пока сервер поднимется заново, и перезагружается; остальные открытые
// вкладки перезагружаются сами (событие build в 72-server.js). Данные при обновлении не трогаются.

// Состояние этой вкладки, не общей базы: S его не касается
const up={info:null,check:null,err:'',loading:false,busy:false,waiting:false,manual:false,ph:null,phBusy:false};

async function upLoad(){
  if(up.loading||!SERVER||!can('admin')) return;
  up.loading=true;
  try{
    const r=await srvApi('GET','/api/update');
    if(r.status===200){up.info=r.body;up.err=''}
    else if(!srvStatus(r)) up.err=r.body.error||'нет данных: версия CRM';
  }catch(_){up.err='нет данных: версия CRM (нет связи с сервером)'}
  try{
    const p=await srvApi('GET','/api/photos/bundled');
    if(p.status===200) up.ph=p.body;
  }catch(_){/* блок про фото покажет «нет данных» */}
  up.loading=false;
  if(S&&S.view==='settings') render();
}
// Крутилка и «прошло N с»: пока сервер работает, на экране видно, что нажатие принято и всё идёт
const SPIN='<span class="spin" aria-hidden="true"></span>';
const upSecs=t0=>Math.max(0,Math.round((Date.now()-t0)/1000));
const upSha=s=>String(s||'').slice(0,7);
const upVer=v=>v?`${esc(v.message||v.title||'без названия')} <small class="muted">(от ${esc(v.at?fWhen(Date.parse(v.at)):'нет данных: дата')}, код ${esc(upSha(v.sha))})</small>`:'нет данных: версия не записана (папку с CRM скопировали вручную)';

function vUpdate(){
  if(!up.info&&!up.err) upLoad();
  const i=up.info,c=up.check;
  const cur=i?`<p class="m0">Установлена: <b>${upVer(i.current)}</b></p>`:`<p class="m0 muted">${esc(up.err||'загрузка…')}</p>`;
  let found='';
  if(c){
    const news=(c.news||[]).length?`<ul class="m0">${c.news.map(n=>`<li>${esc(n.title)}${n.at?` <small class="muted">${esc(fWhen(Date.parse(n.at)))}</small>`:''}</li>`).join('')}</ul>`:'<p class="m0 muted">Список изменений пуст.</p>';
    found=c.upToDate===true?'<p class="m0"><span class="pill sm ok">Это последняя версия</span></p>'
      :`<p class="m0"><span class="pill sm info">Есть новая версия</span> ${upVer(c.latest)}</p><p class="m0"><b>Что нового</b>${c.farBehind?' <small class="muted">(показаны последние изменения; ваша версия сильно отстаёт)</small>':c.upToDate===null?' <small class="muted">(версия на этом компьютере неизвестна — показаны последние изменения)</small>':''}</p>${news}`;
  }
  const show=!!c&&c.upToDate!==true&&!!i;
  const dev=i&&i.git?'<p class="hint">Папка подключена к git: обновление идёт командой git pull с ветки master. Если в папке есть несохранённые правки кода или она стоит на другой ветке, кнопка остановится и ничего не тронет.</p>':'';
  const manual=i&&!i.supervised?'<p class="hint">Сервер запущен без start.cmd (на Ubuntu — без службы): после установки он сам не перезапустится, и новую версию придётся запустить вручную. Запускайте CRM через start.cmd — тогда обновление проходит само.</p>':'';
  const wait=up.waiting?'<p class="m0"><b>Идёт перезапуск сервера…</b> Страница обновится сама, когда сервер поднимется.</p>':up.manual?'<p class="m0"><b>Новая версия установлена, но сервер сам не перезапустится.</b> Остановите его (Ctrl+C) и запустите заново, лучше через start.cmd.</p>':'';
  return `<section class="card"><div class="card-h"><h3>Обновить ПО</h3></div><div class="card-b stack-s">
    <p class="m0">Новые версии CRM берутся с GitHub (${esc(i?i.repo:'MezentsevPavel/CRM')}). Перед установкой сервер делает копию базы; данные, сотрудники и файлы не меняются. На время перезапуска (около минуты) CRM у всех не отвечает.</p>
    ${cur}${found}${wait}
    <div><button type="button" class="btn${show?'':' pri'}" data-act="upd-check"${up.busy||up.waiting||!i?' disabled':''}>${up.busy&&!c?SPIN+'Проверяю…':'Проверить обновления'}</button>
    ${show?`<button type="button" class="btn pri" data-act="upd-apply"${up.busy||up.waiting?' disabled':''}>${up.busy?SPIN+'Устанавливаю…':'Обновить ПО'}</button>`:''}</div>
    ${dev}${manual}
    <p class="hint">Если новая версия работает не так, прежний код лежит в папке data/update-backup рядом с базой, а копия базы до обновления — в списке «Настройки → Копии».</p>
  </div></section>${vReadyPhotos()}`;
}

// Готовые фото, которые приходят вместе с программой (assets/photos): кнопка прикрепляет их товарам, у которых фото ещё нет
function vReadyPhotos(){
  const p=up.ph;
  const what=!p?'<p class="m0 muted">нет данных: готовые фото (сервер не ответил)</p>'
    :!p.total?'<p class="m0 muted">В этой версии программы готовых фото нет.</p>'
    :p.available?`<p class="m0">В программе есть готовые фото товаров (${num(p.total)} шт.). Сейчас их можно прикрепить к <b>${num(p.available)}</b> товарам, у которых фото ещё нет. Фото, которые вы добавили сами, не меняются.</p>`
    :!p.matched?`<p class="m0"><span class="pill sm warn">Прикреплять некуда</span> В вашей базе нет ни одного товара, для которого есть готовое фото (${num(p.total)} шт. в программе). Нет данных: каталог в этой базе не загружен или это другие товары.</p>`
    :`<p class="m0"><span class="pill sm ok">Нечего прикреплять</span> У ${num(p.withPhoto)} из ${num(p.matched)} подходящих товаров фото уже есть${p.total>p.matched?`; для ещё ${num(p.total-p.matched)} готовых фото в вашей базе нет товара`:''}.</p>`;
  return `<section class="card"><div class="card-h"><h3>Готовые фото товаров</h3></div><div class="card-b stack-s">${what}
    <div><button type="button" class="btn pri" data-act="photos-bundled"${!p||!p.available||up.phBusy?' disabled':''}>${up.phBusy?SPIN+'Загружаю…':'Загрузить готовые фото'}</button></div>
    <p class="hint">Новые готовые фото приходят вместе с обновлением («Обновить ПО» выше). Остальные фото добавляются в карточке товара.</p>
  </div></section>`;
}
A['photos-bundled']=async()=>{
  if(up.phBusy||!can('admin')) return;
  up.phBusy=true;render();
  try{
    const r=await srvApi('POST','/api/photos/bundled');
    if(r.status===200){up.ph=r.body;toast(r.body.attached?`Фото прикреплены: ${r.body.attached}.`:'Прикреплять было нечего.')}
    else if(!srvStatus(r)) toast(r.body.error||'Фото не загружены.','warn');
  }catch(_){toast('Нет связи с сервером — фото не загружены.','warn')}
  up.phBusy=false;render();
};

MODALS.updApply=()=>{
  const c=up.check;
  return `<form data-form="upd-apply" novalidate>${mHead('Обновить ПО')}<div class="modal-b">
    <p class="m0">Установить версию «${esc(c?c.latest.title:'')}» (код ${esc(c?upSha(c.latest.sha):'')})?</p>
    <p class="m0">Сервер сделает копию базы, скачает новую версию и ${up.info&&up.info.supervised?'перезапустится: <b>CRM у всех сотрудников не будет отвечать около минуты</b>, потом их страницы обновятся сами.':'установит её; после этого его нужно перезапустить вручную.'} Данные не пропадут.</p>
    <p class="err" id="upd-err" hidden></p></div>${mFoot('Обновить ПО')}</form>`;
};

A['upd-check']=async()=>{
  if(up.busy||!can('admin')) return;
  up.busy=true;up.check=null;render();
  try{
    const r=await srvApi('POST','/api/update/check');
    if(r.status===200){up.check=r.body;up.info=r.body}
    else if(!srvStatus(r)) toast(r.body.error||'Проверить обновления не получилось.','warn');
  }catch(_){toast('Нет связи с сервером — проверить не получилось.','warn')}
  up.busy=false;render();
};
A['upd-apply']=()=>{if(can('admin')&&up.check) openModal('updApply')};
FORMS['upd-apply']=async f=>{
  if(up.busy) return;
  up.busy=true;
  // сразу после нажатия: кнопки заблокированы, на месте «Обновить ПО» — крутилка, под текстом — что происходит и сколько прошло
  const t0=Date.now(),btns=[...f.querySelectorAll('button')],ok=f.querySelector('button[type=submit]'),box=f.querySelector('.modal-b');
  btns.forEach(x=>{x.disabled=true});
  if(ok) ok.innerHTML=SPIN+'Устанавливаю…';
  const prog=document.createElement('p');prog.className='upd-prog';prog.setAttribute('role','status');
  const tick=()=>{prog.textContent='Делаю копию базы, скачиваю новую версию и заменяю файлы. Это занимает до минуты — не закрывайте страницу. Прошло '+upSecs(t0)+' с.'};
  tick();if(box) box.appendChild(prog);
  const timer=setInterval(tick,1000);
  const undo=()=>{clearInterval(timer);prog.remove();btns.forEach(x=>{x.disabled=false});if(ok) ok.textContent='Обновить ПО'};
  try{
    const r=await srvApi('POST','/api/update/apply');
    if(srvStatus(r)){up.busy=false;undo();return}
    if(r.status!==200){up.busy=false;undo();return showErr('upd-err',r.body.error||'Обновление не установлено.')}
    clearInterval(timer);closeModal();up.busy=false;up.check=null;
    if(!r.body.restarting){up.manual=true;upOverlay(null);toast('Новая версия установлена. Перезапустите сервер, чтобы она заработала.');render();return}
    up.waiting=true;render();
    upWaitRestart(r.body.to);
  }catch(_){up.busy=false;undo();showErr('upd-err','Нет связи с сервером — повторите, когда связь вернётся.')}
};
// Во весь экран: обновление установлено, сервер перезапускается — крутилка и секунды, чтобы не казалось, что всё зависло. null — убрать
function upOverlay(text,onClose){
  let el=document.getElementById('upd-ov');
  if(text===null){if(el) el.remove();return}
  if(!el){el=document.createElement('div');el.id='upd-ov';el.className='upd-ov';el.setAttribute('role','status');el.setAttribute('aria-live','polite');document.body.appendChild(el)}
  el.innerHTML='<div class="upd-ov-box">'+(onClose?'':SPIN)+'<p class="upd-ov-t"></p>'+(onClose?'<button type="button" class="btn" id="upd-ov-x">Закрыть</button>':'')+'</div>';
  el.querySelector('.upd-ov-t').textContent=text;
  if(onClose) el.querySelector('#upd-ov-x').onclick=onClose;
}
// Ждёт, пока сервер поднимется с новой версией, и перезагружает страницу. Запросы идут мимо srvApi, чтобы обрыв связи не поднимал плашку «нет связи».
async function upWaitRestart(sha){
  const t0=Date.now(),end=t0+180000;
  const say=()=>upOverlay('Обновление установлено, сервер перезапускается. Страница обновится сама, обычно за полминуты. Прошло '+upSecs(t0)+' с.');
  say();
  const timer=setInterval(say,1000);
  await new Promise(ok=>setTimeout(ok,2500));
  while(Date.now()<end){
    try{
      const res=await fetch('/api/update',{credentials:'same-origin',cache:'no-store'});
      if(res.ok){const b=await res.json();if(b.current&&b.current.sha===sha){clearInterval(timer);upOverlay('Готово, открываю новую версию…');srvReload();return}}
    }catch(_){/* сервер ещё перезапускается */}
    await new Promise(ok=>setTimeout(ok,2000));
  }
  clearInterval(timer);
  up.waiting=false;
  upOverlay('Сервер не поднялся за три минуты. Посмотрите окно, где он запущен (start.cmd): там написана причина. Новая версия установлена, прежний код лежит в data/update-backup.',()=>{upOverlay(null);if(S&&S.view==='settings') render()});
}

if(SERVER) SETTINGS_TABS.push({id:'update',label:'Обновить ПО',order:89,ok:()=>SERVER&&can('admin'),render:vUpdate});
