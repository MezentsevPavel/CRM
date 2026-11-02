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
  const t=trUi();
  try{
    const r=Import.stockRows(Import.parseCsv(Import.decode(bytes)));
    if(r.problems.length){t.stock={problems:r.problems};return}
    t.stock={rows:r.rows,skipped:r.skipped,pv:Import.preview('stock',S,r.rows,S.me,new Date()),busy:false,err:'',done:null};
  }catch(e){t.stock={problems:[trWhy(e)]}}
}
async function trStockSend(){
  const s=trUi().stock;
  if(!s||!s.rows||s.busy) return;
  s.busy=true;s.err='';trRefresh();
  try{
    const r=await srvApi('POST','/api/import/stock',{rows:s.rows});
    if(!srvStatus(r)){
      if(r.status===200){s.done=r.body;s.rows=null;s.pv=null}
      else s.err=(r.body&&r.body.error)||'Остатки не загружены.';
    }
  }catch(_){s.err='Нет связи с сервером — остатки не загружены, повторите.'}
  s.busy=false;trRefresh();
}
// Неразобранное: текст, который перенос не понял, с названием товара и колонкой
const trUnparsed=list=>!list||!list.length?'':`<details class="tr-un"><summary>Что не разобралось (${num(list.length)})</summary><ul>${list.map(u=>`<li><b>${esc(u.name)}</b> · ${esc(u.column)}: «${esc(u.text)}»</li>`).join('')}</ul></details>`;
const trStockNums=p=>`<ul class="tr-n">${trNum(p.products,'товаров в файле')}${trNum(p.matched,'склеено с каталогом')}${trNum(p.created,'новых товаров «нет в каталоге»')}${trNum(p.withStock,`товаров с остатком (клеток склада: ${num(p.cells)})`)}<li>Изменилось клеток: <b>${num(p.changed)}</b> (остаток стал другим против нынешнего)</li>${trNum(p.reserves,'резервов из колонки «Резерв»')}<li>Резервов поставлено или снято заново: <b>${num(p.reservesChanged)}</b></li>${trNum(p.unparsed.length,'неразобранных клеток и резервов')}</ul>`;

function trStockHtml(){
  const s=trUi().stock;
  let body='';
  if(s&&s.problems) body=s.problems.map(p=>`<p class="err">${esc(p)}</p>`).join('');
  else if(s&&s.done) body=`<p class="ok-t m0"><b>Загружено.</b> Остатки склада заменены; в журнале склада «Ввод остатков» — только по клеткам, где остаток изменился (записей: ${num(s.done.moves)}).</p>${trStockNums(s.done)}${trUnparsed(s.done.unparsed)}`;
  else if(s&&s.rows) body=`<p class="m0">В файле найдено:</p>${trStockNums(s.pv)}${s.skipped?`<p class="hint">Строк с цифрами, но без названия: ${num(s.skipped)} — они пропущены.</p>`:''}${trUnparsed(s.pv.unparsed)}
    <form class="tr-go" data-form="tr-stock" novalidate><button type="submit" class="btn pri"${s.busy?' disabled':''}>${s.busy?'Загружаю…':'Загрузить'}</button><span class="hint">Остатки склада будут заменены этими.</span></form>${s.err?`<p class="err">${esc(s.err)}</p>`:''}`;
  return `<section class="card"><div class="card-h"><h3>Остатки склада</h3></div><div class="card-b stack-s">
    <p class="m0">Лист «Остатки» таблицы менеджеров, сохранённый как CSV (UTF-8 или Windows-1251, разделитель — запятая или точка с запятой).
      Загрузка <b>заменяет</b> остатки склада и пишет в журнал склада «Ввод остатков» по каждой клетке, где остаток изменился. Повторная загрузка того же файла остатки не удваивает и журнал не дополняет.</p>
    <p class="hint">Колонка «Резерв»: количество становится резервом, имя клиента — примечанием к нему, без привязки к сделке. До первой загрузки у товаров остаток — «нет данных».</p>
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
    t.clients={rows:r.rows,kind:r.kind,unknown:r.unknown,skipped:r.skipped,twins:Import.twins(S,r.rows),pv:Import.preview('clients',S,r.rows,S.me,new Date()),busy:false,err:'',done:null,at:0,sum:null};
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

// «Возможно, уже есть»: строки без телефона, почты, ИНН и ID Битрикса, но с именем заведённого клиента. У каждой выбор: «тот же»
// (по умолчанию — данные из файла дополнят клиента) или «новый» (строка получает fresh: true и заведёт второго клиента).
function trTwinsHtml(s){
  if(!s.twins||!s.twins.length) return '';
  const lock=s.busy||s.at>0?' disabled':'';
  return `<div class="tr-tw"><p class="warn-t m0">Строк, похожих на уже заведённых клиентов: <b>${num(s.twins.length)}</b>. У них нет ни телефона, ни почты, ни ИНН, ни ID Битрикса, совпало только имя. «Тот же» — данные из файла дополнят клиента, нового не будет; «новый» — заведётся ещё один.</p>
    <ul>${s.twins.map(w=>`<li><span>Возможно, уже есть: <b>${esc(w.name)}</b> → ${esc(w.clientName)} (${esc(w.clientId)})</span><select class="inp" aria-label="Это тот же клиент? ${esc(w.name)}" data-on="tr-twin" data-i="${w.index}"${lock}><option value="same">тот же</option><option value="new"${s.rows[w.index]&&s.rows[w.index].fresh?' selected':''}>новый</option></select></li>`).join('')}</ul></div>`;
}
ON.change['tr-twin']=el=>{
  const s=trUi().clients,r=s&&s.rows&&!s.busy&&!s.at?s.rows[Number(el.dataset.i)]:null;
  if(!r) return;
  if(el.value==='new') r.fresh=true;else delete r.fresh;
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
    <p class="hint">Клиент с тем же ИНН, телефоном или почтой дополняется, а не дублируется; у кого их нет — «Возможно, уже есть» по имени, и вы решаете, тот же это клиент или новый. «Ответственный» становится менеджером клиента, если имя совпало с именем сотрудника. Сам файл на сервер не отправляется и нигде не хранится.</p>
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
FORMS['tr-clients']=()=>trClientsSend();

if(SERVER) SETTINGS_TABS.push({id:'transfer',label:'Перенос',order:85,ok:()=>SERVER&&can('admin'),render:()=>trStockHtml()+trClientsHtml()});
