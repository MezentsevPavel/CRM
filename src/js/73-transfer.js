// «Настройки → Перенос» (только директор и только на сервере): остатки из CSV листа «Остатки» и клиенты из CSV Битрикса.
// Файл выбирается, разбирается и считается здесь же — теми же функциями ядра (Import, 48-import.js), что потом исполняет сервер;
// на сервер уходят только разобранные строки (POST /api/import/stock и /api/import/clients), сам CSV нигде не сохраняется:
// ни на сервере, ни в localStorage (выбранное лежит в S.ui, а ui не сохраняется).

const TR_CHUNK=1000;   // клиентов за один запрос (запрос ограничен по размеру); повтор безопасен — клиенты не дублируются
const trUi=()=>S.ui.transfer||(S.ui.transfer={stock:null,clients:null});
const trRefresh=()=>{if(S&&S.view==='settings') render()};
const trNum=(n,text)=>`<li><b>${num(n)}</b> ${text}</li>`;
const trWhy=e=>(e&&e.message)||'Файл не разобран.';

// ——— остатки ———
// Байты файла → разбор и предпросмотр в S.ui.transfer.stock; ошибка файла — problems, ничего не меняется
function trStockRead(bytes){
  try{trStockText(Import.decode(bytes))}catch(e){trUi().stock={problems:[trWhy(e)]}}
}
// Текст CSV (из файла или из Google-таблицы) → разбор и предпросмотр
function trStockText(text){
  const t=trUi();
  t.links={};
  try{
    const r=Import.stockRows(Import.parseCsv(text));
    if(r.problems.length){t.stock={problems:r.problems};return}
    t.stock={rows:r.rows,skipped:r.skipped,pv:Import.preview('stock',S,r.rows,S.me,new Date(),t.links),busy:false,err:'',done:null};
  }catch(e){t.stock={problems:[trWhy(e)]}}
}
async function trStockSend(){
  const s=trUi().stock;
  if(!s||!s.rows||s.busy) return;
  s.busy=true;s.err='';trRefresh();
  try{
    const r=await srvApi('POST','/api/import/stock',{rows:s.rows,links:trUi().links});
    if(!srvStatus(r)){
      if(r.status===200){s.done=r.body;s.rows=null;s.pv=null;trUi().links={}}
      else s.err=(r.body&&r.body.error)||'Остатки не загружены.';
    }
  }catch(_){s.err='Нет связи с сервером — остатки не загружены, повторите.'}
  s.busy=false;trRefresh();
}
// ——— остатки по ссылке на Google-таблицу ———
// Ссылку запоминает этот браузер (удобство, не данные); таблицу забирает сервер (POST /api/import/sheet), CSV приходит сюда текстом
// и идёт тем же разбором и предпросмотром, что файл. Остатки меняются только по «Загрузить».
const TR_SHEET_KEY='crm-sheet-link';
const trSheetLink=()=>{const t=trUi();if(typeof t.sheetUrl==='string') return t.sheetUrl;try{return localStorage.getItem(TR_SHEET_KEY)||''}catch(_){return ''}};
async function trSheetFetch(){
  const t=trUi();
  if(t.sheetBusy) return;
  const el=byId('tr-sheet-url');
  t.sheetUrl=String(el&&el.value||'').trim();
  if(!t.sheetUrl){t.stock={problems:['Вставьте ссылку на Google-таблицу с листом «Остатки».']};trRefresh();return}
  t.sheetBusy=true;t.stock=null;trRefresh();
  try{
    const r=await srvApi('POST','/api/import/sheet',{url:t.sheetUrl});
    if(!srvStatus(r)){
      if(r.status===200&&r.body&&typeof r.body.csv==='string'){
        trStockText(r.body.csv);
        if(t.stock&&t.stock.rows) t.stock.from='sheet';
        try{localStorage.setItem(TR_SHEET_KEY,t.sheetUrl)}catch(_){}
      }else t.stock={problems:[(r.body&&r.body.error)||'Таблица не получена.']};
    }
  }catch(_){t.stock={problems:['Нет связи с сервером — таблица не получена, повторите.']}}
  t.sheetBusy=false;trRefresh();
}
// ——— что это за модель: строки таблицы, не нашедшие пару в каталоге ———
// Выбор директора лежит в S.ui.transfer.links {нормализованное название: id позиции | 'new'}; каждый выбор пересчитывает предпросмотр
// тем же Import.preview и уходит на сервер вместе со строками («Загрузить»), где его запоминает st.stockSheet.links.
const trCatalog=()=>S.products.filter(p=>p.inCatalog);
const trLinks=()=>Object.assign({},S.stockSheet&&S.stockSheet.links,trUi().links);
function trRecount(){
  const s=trUi().stock;
  if(s&&s.rows) s.pv=Import.preview('stock',S,s.rows,S.me,new Date(),trUi().links);
  trRefresh();
}
function trLinkSet(key,to){
  const t=trUi();
  (t.links||(t.links={}))[key]=to;
  trRecount();
}
const trProdName=id=>{const p=S.products.find(x=>x.id===id);return p?p.name:'нет данных: такой позиции в каталоге нет'};
function trLinksHtml(s){
  const pv=s.pv,list=pv.unlinked||[];
  const lk=trLinks(),done=Object.keys(lk).filter(k=>lk[k]&&s.rows.some(r=>Catalog.norm(r.name)===k));
  let h='';
  if(list.length){
    const cat=trCatalog(),sug=list.filter(u=>u.suggest);
    h+=`<div class="tr-lk"><p class="m0"><b>Не нашли пару в каталоге: ${num(list.length)}.</b> Укажите, что это за модель: принять подсказку, найти позицию в каталоге или завести как «Новая позиция». Что оставите как есть — станет товаром «нет в каталоге». Выбор запоминается.</p>
      ${sug.length?`<div><button type="button" class="btn sm" data-act="tr-sug-all">Принять все подсказки (${num(sug.length)})</button></div>`:''}
      <datalist id="tr-catlist">${cat.map(p=>`<option value="${esc(p.name)}"></option>`).join('')}</datalist>
      <ul class="tr-lk-l">${list.map(u=>{const k=Catalog.norm(u.name);return `<li><div class="tr-lk-n"><b>${esc(u.name)}</b>${u.suggest?`<small>Похоже на: ${esc(trProdName(u.suggest))}</small>`:'<small>Подсказки нет: похожей позиции в каталоге не нашлось</small>'}</div>
        <div class="tr-lk-a">${u.suggest?`<button type="button" class="btn sm" data-act="tr-sug" data-k="${esc(k)}" data-to="${esc(u.suggest)}">Это она</button>`:''}<input class="inp sm tr-lk-in" list="tr-catlist" placeholder="Найти в каталоге…" data-on="tr-pick" data-k="${esc(k)}" aria-label="Позиция каталога для «${esc(u.name)}»" autocomplete="off"><button type="button" class="btn sm ghost" data-act="tr-new" data-k="${esc(k)}">Новая позиция</button></div></li>`}).join('')}</ul></div>`;
  }
  if(done.length) h+=`<details class="tr-un"><summary>Указано вами (${num(done.length)})</summary><ul class="tr-lk-d">${done.map(k=>{const r=s.rows.find(x=>Catalog.norm(x.name)===k);return `<li><span><b>${esc(r.name)}</b> → ${lk[k]==='new'?'новая позиция':esc(trProdName(lk[k]))}</span><button type="button" class="btn sm ghost" data-act="tr-unlink" data-k="${esc(k)}">Отменить</button></li>`}).join('')}</ul></details>`;
  return h;
}
A['tr-sug']=el=>trLinkSet(el.dataset.k,el.dataset.to);
A['tr-new']=el=>trLinkSet(el.dataset.k,'new');
A['tr-unlink']=el=>trLinkSet(el.dataset.k,null);
A['tr-sug-all']=()=>{
  const s=trUi().stock;if(!s||!s.pv) return;
  const t=trUi();t.links=t.links||{};
  for(const u of s.pv.unlinked||[]) if(u.suggest) t.links[Catalog.norm(u.name)]=u.suggest;
  trRecount();
};
ON.change['tr-pick']=el=>{
  const v=String(el.value||'').trim();if(!v) return;
  const p=trCatalog().find(x=>x.name===v)||trCatalog().find(x=>Catalog.norm(x.name)===Catalog.norm(v));
  if(!p){toast('Такой позиции в каталоге нет: выберите из списка, который открывается в поле.','warn');return}
  trLinkSet(el.dataset.k,p.id);
};
// Неразобранное: текст, который перенос не понял, с названием товара и колонкой
const trUnparsed=list=>!list||!list.length?'':`<details class="tr-un"><summary>Что не разобралось (${num(list.length)})</summary><ul>${list.map(u=>`<li><b>${esc(u.name)}</b> · ${esc(u.column)}: «${esc(u.text)}»</li>`).join('')}</ul></details>`;
const trStockNums=p=>`<ul class="tr-n">${trNum(p.products,'товаров в файле')}${trNum(p.matched,'склеено с каталогом')}${trNum(p.created,'новых товаров «нет в каталоге»')}${trNum(p.withStock,`товаров с остатком (клеток склада: ${num(p.cells)})`)}<li>Изменилось клеток: <b>${num(p.changed)}</b> (остаток стал другим против нынешнего)</li>${p.linked?trNum(p.linked,'строк сопоставлено с каталогом вручную'):''}${p.asNew?trNum(p.asNew,'строк заведено как «новая позиция»'):''}${trNum(p.reserves,'резервов из колонки «Резерв»')}<li>Резервов поставлено или снято заново: <b>${num(p.reservesChanged)}</b></li>${trNum(p.unparsed.length,'неразобранных клеток и резервов')}</ul>`;

function trStockHtml(){
  const s=trUi().stock;
  let body='';
  if(s&&s.problems) body=s.problems.map(p=>`<p class="err">${esc(p)}</p>`).join('');
  else if(s&&s.done) body=`<p class="ok-t m0"><b>Загружено.</b> Остатки склада заменены; в журнале склада «Ввод остатков» — только по клеткам, где остаток изменился (записей: ${num(s.done.moves)}).</p>${trStockNums(s.done)}${trUnparsed(s.done.unparsed)}`;
  else if(s&&s.rows) body=`<p class="m0">${s.from==='sheet'?'В таблице':'В файле'} найдено:</p>${trStockNums(s.pv)}${s.skipped?`<p class="hint">Строк с цифрами, но без названия: ${num(s.skipped)} — они пропущены.</p>`:''}${trUnparsed(s.pv.unparsed)}${trLinksHtml(s)}
    <form class="tr-go" data-form="tr-stock" novalidate><button type="submit" class="btn pri"${s.busy?' disabled':''}>${s.busy?'Загружаю…':'Загрузить'}</button><span class="hint">Остатки склада будут заменены этими.</span></form>${s.err?`<p class="err">${esc(s.err)}</p>`:''}`;
  return `<section class="card"><div class="card-h"><h3>Остатки склада</h3></div><div class="card-b stack-s">
    <p class="m0">Лист «Остатки» таблицы менеджеров, сохранённый как CSV (UTF-8 или Windows-1251, разделитель — запятая или точка с запятой).
      Загрузка <b>заменяет</b> остатки склада и пишет в журнал склада «Ввод остатков» по каждой клетке, где остаток изменился. Повторная загрузка того же файла остатки не удваивает и журнал не дополняет.</p>
    <p class="hint">Колонка «Резерв»: количество становится резервом, имя клиента — примечанием к нему, без привязки к сделке. До первой загрузки у товаров остаток — «нет данных».</p>
    <form class="tr-sheet" data-form="tr-sheet" novalidate><label for="tr-sheet-url">Ссылка на Google-таблицу (открыт лист «Остатки»)</label>
      <div class="tr-sheet-row"><input id="tr-sheet-url" class="inp" type="url" inputmode="url" placeholder="https://docs.google.com/spreadsheets/d/…" value="${esc(trSheetLink())}" autocomplete="off"><button type="submit" class="btn pri"${trUi().sheetBusy?' disabled':''}>${trUi().sheetBusy?'Беру из таблицы…':'Взять из таблицы'}</button></div>
      <p class="hint">Таблица должна быть открыта по ссылке на просмотр. Сначала покажется, что изменится; остатки и резервы заменятся только по кнопке «Загрузить». Повторяйте, когда таблица обновится.</p></form>
    <p class="hint m0">Или файлом CSV:</p>
    <div><label class="btn" for="tr-stock-file">${ic('plus')}Выбрать файл CSV</label><input id="tr-stock-file" class="sr" type="file" accept=".csv,.txt,text/csv,text/plain" data-on="tr-stock-file"></div>
    ${body}
  </div></section>`;
}

// ——— клиенты ———
function trClientsRead(bytes){
  const t=trUi();
  try{
    const r=Import.clientRows(Import.parseCsv(Import.decode(bytes)));
    if(r.problems.length){t.clients={problems:r.problems};return}
    t.clients={rows:r.rows,kind:r.kind,unknown:r.unknown,skipped:r.skipped,twins:Import.twins(S,r.rows,r.lines),pv:Import.preview('clients',S,r.rows,S.me,new Date()),busy:false,err:'',done:null,at:0,sum:null};
  }catch(e){t.clients={problems:[trWhy(e)]}}
}
async function trClientsSend(){
  const s=trUi().clients;
  if(!s||!s.rows||s.busy) return;
  s.busy=true;s.err='';trRefresh();
  // порции уже принятые сервером не шлются заново: иначе строки с выбором «новый» завелись бы второй раз
  const sum=s.sum||(s.sum={created:0,merged:0,skipped:s.skipped||0});
  try{
    for(;s.at<s.rows.length;s.at+=TR_CHUNK){
      const r=await srvApi('POST','/api/import/clients',{rows:s.rows.slice(s.at,s.at+TR_CHUNK)});
      if(srvStatus(r)) throw new Error('нужен вход');
      if(r.status!==200) throw new Error((r.body&&r.body.error)||'Клиенты не загружены.');
      sum.created+=r.body.created;sum.merged+=r.body.merged;sum.skipped+=r.body.skipped;
    }
    s.done=sum;s.rows=null;s.pv=null;
  }catch(e){
    // часть порций могла дойти: повторная загрузка того же файла дописывает недостающее и дублей не плодит
    s.err=(e instanceof TypeError?'Нет связи с сервером':e.message)+(sum.created+sum.merged?` Уже обработано клиентов: ${num(sum.created+sum.merged)}; повторите загрузку — принятое не шлётся заново.`:' Повторите загрузку.');
  }
  s.busy=false;trRefresh();
}
const trClientNums=(p,file)=>`<ul class="tr-n">${trNum(p.created,'новых клиентов')}${trNum(p.merged,'объединено с уже заведёнными (недостающее дописано)')}${trNum(p.skipped+(file||0),'пропущено без имени')}</ul>`;

// «Возможно, уже есть»: строки без телефона, почты, ИНН и ID Битрикса с именем заведённого клиента; строки, где имя то же, а ID
// Битрикса у обоих разные; строки, повторённые в самом файле. У каждой записи выбор: «тот же» (данные из файла дополнят клиента или
// первую строку, нового не будет) или «новый» (fresh: true — заведётся ещё один). Для записи с разными ID Битрикса по умолчанию «новый»,
// «тот же» — same: true. Выбор ложится на все строки записи (Import.twins: indexes).
function trTwinText(w){
  const n=w.lines.length,list=n===2?w.lines.join(' и '):w.lines.slice(0,-1).join(', ')+' и '+w.lines[n-1];
  const twice=n>1?`в файле ${n===2?'дважды':num(n)+' раз'} (строки ${list})`:'';
  if(!w.clientId) return `<b>${esc(w.name)}</b> — ${twice}`;
  return `Возможно, уже есть: <b>${esc(w.name)}</b> → ${esc(w.clientName)} (${esc(w.clientId)})`
    +(twice?` — ${twice}`:'')+(w.clash?` — в Битриксе это разные записи: ID ${esc(w.clash.had)} и ${esc(w.clash.got)}`:'');
}
function trTwinsHtml(s){
  if(!s.twins||!s.twins.length) return '';
  const lock=s.busy||s.at>0?' disabled':'';
  const row=w=>{
    const r=s.rows[w.index]||{},cur=w.clash?(r.same&&!r.fresh?'same':'new'):(r.fresh?'new':'same');
    return `<li><span>${trTwinText(w)}</span><select class="inp" aria-label="Это тот же клиент? ${esc(w.name)}" data-on="tr-twin" data-i="${w.index}"${lock}><option value="same"${w.clash&&cur==='same'?' selected':''}>тот же</option><option value="new"${cur==='new'?' selected':''}>новый</option></select></li>`;
  };
  return `<div class="tr-tw"><p class="warn-t m0">Строк, про которые не ясно, один ли это клиент: <b>${num(s.twins.length)}</b>. Совпало только имя: нет ни телефона, ни почты, ни ИНН, ни ID Битрикса, или ID в Битриксе разные, или строка повторена в файле. «Тот же» — данные из файла дополнят клиента, нового не будет (у найденного ID Битрикса остаётся прежний, ID из файла запишется в его ленту); «новый» — заведётся ещё один.</p>
    <ul>${s.twins.map(row).join('')}</ul></div>`;
}
ON.change['tr-twin']=el=>{
  const s=trUi().clients,i=Number(el.dataset.i),w=s&&s.twins&&s.twins.find(x=>x.index===i);
  if(!s||!s.rows||s.busy||s.at||!s.rows[i]) return;
  for(const k of w?w.indexes:[i]){
    const r=s.rows[k];
    if(!r) continue;
    if(el.value==='new'){r.fresh=true;delete r.same}else{delete r.fresh;r.same=true}
  }
  s.pv=Import.preview('clients',S,s.rows,S.me,new Date());
  trRefresh();
};

function trClientsHtml(){
  const s=trUi().clients;
  let body='';
  if(s&&s.problems) body=s.problems.map(p=>`<p class="err">${esc(p)}</p>`).join('');
  else if(s&&s.done) body=`<p class="ok-t m0"><b>Загружено.</b></p><ul class="tr-n">${trNum(s.done.created,'новых клиентов')}${trNum(s.done.merged,'объединено с уже заведёнными')}${trNum(s.done.skipped,'пропущено без имени')}</ul>`;
  else if(s&&s.rows) body=`<p class="m0">Это файл ${s.kind==='company'?'компаний':'контактов'} Битрикса, строк с именем: <b>${num(s.rows.length)}</b>. Загрузка даст:</p>${trClientNums(s.pv,s.skipped)}${trTwinsHtml(s)}
    <p class="${s.unknown.length?'warn-t':'hint'} m0">${s.unknown.length?`Нераспознанные колонки (не переносятся): ${s.unknown.map(esc).join(', ')}.`:'Все колонки файла распознаны.'}</p>
    <form class="tr-go" data-form="tr-clients" novalidate><button type="submit" class="btn pri"${s.busy?' disabled':''}>${s.busy?'Загружаю…':'Загрузить'}</button><span class="hint">Клиенты добавятся к уже заведённым.</span></form>${s.err?`<p class="err">${esc(s.err)}</p>`:''}`;
  return `<section class="card"><div class="card-h"><h3>Клиенты из Битрикса</h3></div><div class="card-b stack-s">
    <p class="m0">Выгрузка контактов или компаний Битрикса в CSV, как она есть (UTF-8 или Windows-1251, разделитель — точка с запятой или запятая). Два файла — по очереди, тем же экраном: тип файла узнаётся по колонке «Название компании».</p>
    <p class="hint">Клиент с тем же ИНН, телефоном или почтой дополняется, а не дублируется; у кого их нет, у кого ID Битрикса разные или кто повторён в файле — «Возможно, уже есть» по имени, и вы решаете, тот же это клиент или новый. «Ответственный» становится менеджером клиента, если имя совпало с именем сотрудника. Сам файл на сервер не отправляется и нигде не хранится.</p>
    <div><label class="btn" for="tr-clients-file">${ic('plus')}Выбрать файл CSV</label><input id="tr-clients-file" class="sr" type="file" accept=".csv,.txt,text/csv,text/plain" data-on="tr-clients-file"></div>
    ${body}
  </div></section>`;
}

// Выбран файл: прочитать байты, разобрать, перерисовать. Поле очищается — тот же файл можно выбрать ещё раз.
async function trPick(el,read){
  const f=el.files&&el.files[0];
  try{el.value=''}catch(_){}
  if(!f) return;
  try{read(new Uint8Array(await f.arrayBuffer()))}
  catch(e){const t=trUi();const key=read===trStockRead?'stock':'clients';t[key]={problems:[`Файл «${f.name}» не прочитался.`]}}
  trRefresh();
}
ON.change['tr-stock-file']=el=>trPick(el,trStockRead);
ON.change['tr-clients-file']=el=>trPick(el,trClientsRead);
FORMS['tr-stock']=()=>trStockSend();
FORMS['tr-sheet']=()=>trSheetFetch();
FORMS['tr-clients']=()=>trClientsSend();

if(SERVER) SETTINGS_TABS.push({id:'transfer',label:'Перенос',order:85,ok:()=>SERVER&&can('admin'),render:()=>trStockHtml()+trClientsHtml()});
