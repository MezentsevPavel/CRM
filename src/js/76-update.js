// «Настройки → Обновление» (только директор и только на сервере): какая версия CRM стоит, есть ли новее на GitHub и кнопка «Обновить».
// Всё делает сервер (server/updater.js): копия базы, скачивание, проверка, замена кода, перезапуск; здесь только показ и две
// кнопки через /api/update. После установки страница ждёт, пока сервер поднимется заново, и перезагружается; остальные открытые
// вкладки перезагружаются сами (событие build в 72-server.js). Данные при обновлении не трогаются.

// Состояние этой вкладки, не общей базы: S его не касается
const up={info:null,check:null,err:'',loading:false,busy:false,waiting:false,manual:false};

async function upLoad(){
  if(up.loading||!SERVER||!can('admin')) return;
  up.loading=true;
  try{
    const r=await srvApi('GET','/api/update');
    if(r.status===200){up.info=r.body;up.err=''}
    else if(!srvStatus(r)) up.err=r.body.error||'нет данных: версия CRM';
  }catch(_){up.err='нет данных: версия CRM (нет связи с сервером)'}
  up.loading=false;
  if(S&&S.view==='settings') render();
}
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
  const show=!!c&&c.upToDate!==true&&!!i&&!i.devCopy;
  const dev=i&&i.devCopy?'<p class="hint">Это рабочая копия для разработки (рядом есть папка .git): здесь код обновляют через git, а не кнопкой.</p>':'';
  const manual=i&&!i.devCopy&&!i.supervised?'<p class="hint">Сервер запущен без start.cmd (на Ubuntu — без службы): после установки он сам не перезапустится, и новую версию придётся запустить вручную. Запускайте CRM через start.cmd — тогда обновление проходит само.</p>':'';
  const wait=up.waiting?'<p class="m0"><b>Идёт перезапуск сервера…</b> Страница обновится сама, когда сервер поднимется.</p>':up.manual?'<p class="m0"><b>Новая версия установлена, но сервер сам не перезапустится.</b> Остановите его (Ctrl+C) и запустите заново, лучше через start.cmd.</p>':'';
  return `<section class="card"><div class="card-h"><h3>Обновить ПО</h3></div><div class="card-b stack-s">
    <p class="m0">Новые версии CRM берутся с GitHub (${esc(i?i.repo:'MezentsevPavel/CRM')}). Перед установкой сервер делает копию базы; данные, сотрудники и файлы не меняются. На время перезапуска (около минуты) CRM у всех не отвечает.</p>
    ${cur}${found}${wait}
    <div><button type="button" class="btn${show?'':' pri'}" data-act="upd-check"${up.busy||up.waiting||!i?' disabled':''}>${up.busy&&!c?'Проверяю…':'Проверить обновления'}</button>
    ${show?`<button type="button" class="btn pri" data-act="upd-apply"${up.busy||up.waiting?' disabled':''}>${up.busy?'Устанавливаю…':'Обновить ПО'}</button>`:''}</div>
    ${dev}${manual}
    <p class="hint">Если новая версия работает не так, прежний код лежит в папке data/update-backup рядом с базой, а копия базы до обновления — в списке «Настройки → Копии».</p>
  </div></section>`;
}

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
FORMS['upd-apply']=async()=>{
  if(up.busy) return;
  up.busy=true;
  try{
    const r=await srvApi('POST','/api/update/apply');
    if(srvStatus(r)){up.busy=false;return}
    if(r.status!==200){up.busy=false;return showErr('upd-err',r.body.error||'Обновление не установлено.')}
    closeModal();up.busy=false;up.check=null;
    if(!r.body.restarting){up.manual=true;toast('Новая версия установлена. Перезапустите сервер, чтобы она заработала.');render();return}
    up.waiting=true;render();
    upWaitRestart(r.body.to);
  }catch(_){up.busy=false;showErr('upd-err','Нет связи с сервером — повторите, когда связь вернётся.')}
};
// Ждёт, пока сервер поднимется с новой версией, и перезагружает страницу. Запросы идут мимо srvApi, чтобы обрыв связи не поднимал плашку «нет связи».
async function upWaitRestart(sha){
  const end=Date.now()+180000;
  await new Promise(ok=>setTimeout(ok,2500));
  while(Date.now()<end){
    try{
      const res=await fetch('/api/update',{credentials:'same-origin',cache:'no-store'});
      if(res.ok){const b=await res.json();if(b.current&&b.current.sha===sha){srvReload();return}}
    }catch(_){/* сервер ещё перезапускается */}
    await new Promise(ok=>setTimeout(ok,2000));
  }
  up.waiting=false;
  toast('Сервер не поднялся за три минуты. Проверьте окно, где он запущен.','warn');
  if(S&&S.view==='settings') render();
}

if(SERVER) SETTINGS_TABS.push({id:'update',label:'Обновить ПО',order:89,ok:()=>SERVER&&can('admin'),render:vUpdate});
