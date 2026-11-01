// Файлы у записи: разметка и чтение файлов с диска. Ядро — Attach (44-attach.js); общие помощники (размер, миниатюра,
// чтение) берут и отправки (69-dispatch.js), здесь же — поле «Файлы» в формах новой задачи и поставки и блок «Файлы»
// в карточках задачи и поставки. Черновик формы лежит в S.ui.attDraft ({kind, files}) и не сохраняется.

const ATT_MAX_HINT='Фото и документы любого типа, каждый до 2 МБ. Большие файлы могут не поместиться в браузер: тогда у них будет пометка.';

// Чьи файлы и кто что может: kind → запись, видна ли она человеку и может ли он убирать чужие файлы.
// Видна — так же, как открывается её карточка (taskVisible, право на остатки или перевозки).
const ATT={
  task:{rec:id=>S.tasks.find(t=>t.id===id),see:t=>taskVisible(t),any:t=>t.from===S.me},
  ship:{rec:id=>ship(id),see:()=>can('stock')||can('logistics'),any:()=>can('logistics')}
};

function attSize(n){return n<1024?n+' Б':n<1048576?Math.round(n/1024)+' КБ':(n/1048576).toFixed(1).replace('.',',')+' МБ'}
function attIsImage(f){return /^image\//.test(f.type||'')&&typeof f.data==='string'&&f.data.startsWith('data:image/')}

// Файл в карточке: картинка — миниатюра, она открывается крупно (act, key); остальное — название, размер, «скачать».
// Не поместился в браузер (unsaved) — пометка вместо файла. who — подпись «кто приложил», если известна.
function attFileHtml(f,act,key,who){
  const size=attSize(f.size||0);
  if(f.unsaved||!f.data) return `<div class="dsp-fl bad">${ic('file')}<span>${esc(f.name)}<small>${size}</small><small class="warn-t">${f.unsaved?'не сохранено — мало места в браузере':'нет данных: файл'}</small></span></div>`;
  if(attIsImage(f)) return `<button type="button" class="dsp-th" data-act="${act}" data-key="${esc(key)}" aria-label="Открыть: ${esc(f.name)}"><img src="${esc(f.data)}" alt="${esc(f.name)}"><small>${esc(f.name)}</small></button>`;
  return `<a class="dsp-fl" href="${esc(f.data)}" download="${esc(f.name)}">${ic('file')}<span>${esc(f.name)}<small>${size} · скачать${who?' · '+esc(who):''}</small></span></a>`;
}
// Список файлов в форме: у каждого крестик (act убирает файл по номеру data-i).
function attEditHtml(files,delAct){
  if(!files.length) return '<p class="muted m0">Файлов нет.</p>';
  return files.map((f,i)=>{
    const rm=`<button type="button" class="btn ghost icon dsp-rm" data-act="${delAct}" data-i="${i}" aria-label="Убрать файл: ${esc(f.name)}">${ic('x')}</button>`;
    return attIsImage(f)?`<figure class="dsp-th"><img src="${esc(f.data)}" alt="${esc(f.name)}"><small>${esc(f.name)}</small>${rm}</figure>`
      :`<div class="dsp-fl">${ic('file')}<span>${esc(f.name)}<small>${attSize(f.size||0)}${f.unsaved?' · не сохранено — мало места в браузере':''}</small></span>${rm}</div>`;
  }).join('');
}
// Крупно: картинка и кнопка «Скачать» — тело окна файла.
function attBigHtml(f){
  return `${attIsImage(f)?`<img class="dsp-big" src="${esc(f.data)}" alt="${esc(f.name)}">`:''}<a class="btn" href="${esc(f.data)}" download="${esc(f.name)}">${ic('file')}Скачать · ${esc(attSize(f.size||0))}</a>`;
}
// Выбранные на диске файлы читаются в data-URL; каждый готовый уходит в onAdd({name, type, size, data}).
// Файл больше Store.FILE_MAX (2 МБ) не читается: сразу отказ, те же слова, что у ядра.
function attReadFiles(files,onAdd){
  if(typeof FileReader==='undefined') return;
  [...files].forEach(f=>{
    const big=Store.fileTooBig(f);if(big){toast(big,'warn');return}
    const fr=new FileReader();
    fr.onload=()=>onAdd({name:f.name,type:f.type||'',size:f.size,data:String(fr.result)});
    fr.onerror=()=>toast(`Файл «${f.name}» не прочитался.`,'warn');
    fr.readAsDataURL(f);
  });
}

// ——— форма новой записи: поле «Файлы» ———
const attDraft=()=>S.ui.attDraft||null;
function attFormHtml(){
  const d=attDraft();
  return `<div class="field"><span class="lbl">Файлы</span><div id="att-files" class="dsp-files">${attEditHtml(d?d.files:[],'att-draft-del')}</div><label class="btn att-add" for="att-add-draft">${ic('plus')}Прикрепить файлы<input id="att-add-draft" class="sr" type="file" multiple data-on="att-draft"></label><small class="hint">${ATT_MAX_HINT}</small></div>`;
}
// Файлы черновика → чистые файлы для новой записи; пусто — undefined (поля files у записи тогда нет).
function attDraftFiles(){
  const d=attDraft(),files=d?Attach.clean(d.files,[]):[];
  return files.length?files:undefined;
}
ON.change['att-draft']=t=>{
  const d=attDraft();if(!d) return;
  attReadFiles(t.files,file=>{
    if(attDraft()!==d) return;
    d.files.push({...file,by:S.me,at:new Date()});
    const box=byId('att-files');if(box) box.innerHTML=attEditHtml(d.files,'att-draft-del');
  });
  t.value='';
};
A['att-draft-del']=el=>{const d=attDraft();if(!d) return;d.files.splice(+el.dataset.i,1);byId('att-files').innerHTML=attEditHtml(d.files,'att-draft-del')};

// ——— карточка готовой записи: блок «Файлы» ———
// Прикрепляются сразу, без «Сохранить». Убрать свой файл может тот, кто его приложил; чужой — тот, кому ATT[kind].any разрешает.
function attCardHtml(kind,rec){
  const o=ATT[kind],files=rec.files||[];
  const list=files.length?files.map(f=>{
    const who=f.by?(person(f.by)?.name||'')+(f.at?', '+fWhen(f.at):''):'';
    const rm=Attach.canRemove(f,S.me,o.any(rec))?`<button type="button" class="btn sm ghost" data-act="att-del" data-kind="${kind}" data-id="${esc(rec.id)}" data-fid="${esc(f.id)}" aria-label="Убрать файл: ${esc(f.name)}">Убрать</button>`:'';
    return `<div class="att-item">${attFileHtml(f,'att-file',kind+'|'+rec.id+'|'+f.id,who)}${rm}</div>`;
  }).join(''):'<p class="muted m0">Файлов нет.</p>';
  return `<div><h4 class="sh">Файлы</h4><div class="dsp-files">${list}</div><label class="btn att-add" for="att-add-${kind}">${ic('plus')}Прикрепить файлы<input id="att-add-${kind}" class="sr" type="file" multiple data-on="att-add" data-kind="${kind}" data-id="${esc(rec.id)}"></label><small class="hint">${ATT_MAX_HINT}</small></div>`;
}
ON.change['att-add']=t=>{
  const {kind,id}=t.dataset,o=ATT[kind],rec=o&&o.rec(id);
  if(!rec||!o.see(rec)){toast('Сюда файлы прикрепить нельзя.','warn');t.value='';return}
  attReadFiles(t.files,file=>{
    const cur=o.rec(id);if(!cur||!o.see(cur)) return;
    const r=Attach.add(cur,[file],S.me,new Date());
    if(!r.ok){toast(r.reason,'warn');return}
    render();toast(`Файл «${file.name}» приложен.`);
  });
  t.value='';
};
A['att-del']=el=>{
  const {kind,id,fid}=el.dataset,o=ATT[kind],rec=o&&o.rec(id);
  if(!rec||!o.see(rec)) return;
  const r=Attach.remove(rec,fid,S.me,o.any(rec));
  if(!r.ok){toast(r.reason,'warn');return}
  render();toast(`Файл «${r.file.name}» убран.`);
};
A['att-file']=el=>openModal('attFile',el.dataset.key);
MODALS.attFile=key=>{
  const [kind,id,fid]=String(key).split('|'),o=ATT[kind],rec=o&&o.rec(id),f=rec&&o.see(rec)&&(rec.files||[]).find(x=>x.id===fid);
  if(!f) return `<div>${mHead('Файл')}<div class="modal-b"><p class="m0">Файла нет.</p></div></div>`;
  return `<div>${mHead(esc(f.name))}<div class="modal-b">${attBigHtml(f)}</div></div>`;
};
