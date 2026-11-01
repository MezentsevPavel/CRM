// «Настройки → Копии» (только директор и только на сервере): список копий базы (дата, размер), «Скачать», «Сделать копию сейчас»
// и «Восстановить» с подтверждением. Копии делает и хранит сервер (server/backup.js): каждую ночь, 30 последних; здесь только
// показ и три действия через /api/backups. Восстановление сперва снимает копию текущей базы («перед восстановлением»), потом
// заменяет базу; всем открытым вкладкам сервер шлёт «перезагрузись».

const BK_KIND={nightly:'ночная','manual':'вручную','before-restore':'перед восстановлением'};
// Список копий — состояние этой вкладки, не общей базы: S его не касается
const bk={list:null,keep:30,hour:3,err:'',loading:false,busy:false};

async function bkLoad(){
  if(bk.loading||!SERVER||!can('admin')) return;
  bk.loading=true;
  try{
    const r=await srvApi('GET','/api/backups');
    if(r.status===200){bk.list=r.body.backups||[];bk.keep=r.body.keep||bk.keep;bk.hour=r.body.hour;bk.err=''}
    else if(!srvStatus(r)) bk.err=r.body.error||'нет данных: список копий';
  }catch(_){bk.err='нет данных: список копий (нет связи с сервером)'}
  bk.loading=false;
  if(S&&S.view==='settings') render();
}
const bkSize=n=>n<1048576?Math.max(1,Math.round(n/1024))+' КБ':(n/1048576).toFixed(1).replace('.',',')+' МБ';
// Что показать человеку в строке: у ночной копии дата, у остальных дата и время
const bkWhen=b=>b.kind==='nightly'?`${fRel(b.at)}, ночная копия`:fWhen(b.at);

function vBackups(){
  if(!bk.list&&!bk.err) bkLoad();
  const rows=!bk.list?`<tr><td colspan="4" class="muted">${esc(bk.err||'загрузка…')}</td></tr>`
    :!bk.list.length?'<tr><td colspan="4" class="muted">Копий пока нет.</td></tr>'
    :bk.list.map(b=>`<tr><td class="nowrap"><b>${esc(bkWhen(b))}</b><small class="muted bk-name">${esc(b.name)}</small></td><td><span class="pill sm${b.kind==='nightly'?' ok':b.kind==='manual'?' info':''}">${esc(BK_KIND[b.kind]||b.kind)}</span></td><td class="num nowrap">${bkSize(b.size)}</td>
      <td class="num nowrap"><a class="btn sm" href="/api/backups/${encodeURIComponent(b.name)}" download="${esc(b.name)}">Скачать</a> <button type="button" class="btn sm ghost" data-act="bk-restore" data-name="${esc(b.name)}">Восстановить</button></td></tr>`).join('');
  return `<section class="card"><div class="card-h"><h3>Копии базы</h3></div><div class="card-b stack-s">
    <p class="m0">Сервер сам делает копию всей базы каждую ночь в ${String(bk.hour).padStart(2,'0')}:00 по своему времени и хранит ${num(bk.keep)} последних; старые удаляются. Копии лежат на том же сервере, что и сама база: для надёжности включите ещё и резервное копирование у хостера.</p>
    <div><button type="button" class="btn pri" data-act="bk-make"${bk.busy?' disabled':''}>${ic('plus')}${bk.busy?'Делаю копию…':'Сделать копию сейчас'}</button></div>
    <div class="xs"><table class="tbl"><thead><tr><th>Копия</th><th>Вид</th><th class="num">Размер</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="hint">«Восстановить» заменяет базу выбранной копией для всех сотрудников; перед этим сервер сохраняет копию текущей базы («перед восстановлением»). Файлы (фото, документы) в копию базы не входят: они хранятся на сервере отдельно.</p>
  </div></section>`;
}

MODALS.bkRestore=name=>{
  const b=(bk.list||[]).find(x=>x.name===name);
  return `<form data-form="bk-restore" data-name="${esc(name)}" novalidate>${mHead('Восстановить базу из копии')}<div class="modal-b">
    <p class="m0">Восстановить базу из копии «${esc(name)}»${b?` (${esc(bkWhen(b))})`:''}?</p>
    <p class="m0"><b>Всё, что записано в CRM после этой копии, пропадёт — у всех сотрудников.</b> Перед заменой сервер сохранит копию текущей базы («перед восстановлением»), её можно будет восстановить так же. Все открытые вкладки перезагрузятся.</p>
    <p class="err" id="bk-err" hidden></p></div>${mFoot('Восстановить')}</form>`;
};

A['bk-restore']=el=>{if(can('admin')) openModal('bkRestore',el.dataset.name)};
A['bk-make']=async()=>{
  if(bk.busy||!can('admin')) return;
  bk.busy=true;render();
  try{
    const r=await srvApi('POST','/api/backups');
    if(r.status===200){toast(`Копия сделана: ${r.body.backup.name}.`);bk.list=null;bk.err=''}
    else if(!srvStatus(r)) toast(r.body.error||'Копия не сделана.','warn');
  }catch(_){toast('Нет связи с сервером — копия не сделана.','warn')}
  bk.busy=false;render();
};
FORMS['bk-restore']=async f=>{
  const name=f.dataset.name;
  try{
    const r=await srvApi('POST',`/api/backups/${encodeURIComponent(name)}/restore`);
    if(srvStatus(r)) return;
    if(r.status!==200) return showErr('bk-err',r.body.error||'База не восстановлена.');
    closeModal();bk.list=null;bk.err='';
    toast(`База восстановлена из «${name}». Копия прежней базы: ${r.body.before}. Страница перезагрузится.`);
    srvReloadSoon();
  }catch(_){showErr('bk-err','Нет связи с сервером — база не тронута, повторите.')}
};

if(SERVER) SETTINGS_TABS.push({id:'backups',label:'Копии',order:88,ok:()=>SERVER&&can('admin'),render:vBackups});
