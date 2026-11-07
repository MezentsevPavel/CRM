// Фото товара: блок «Фото» в карточке товара (53-stock.js), маленькое главное фото в списке «Товары и остатки», просмотр крупно,
// подготовка файла перед загрузкой. Данные — product.photos (ядро Attach, 44-attach.js): те же файлы, что у задач и поставок;
// первое в списке — главное. Демо: файл лежит в браузере (data-URL, Store.dump выкидывает его, когда мало места); сервер: файл на
// диске сервера, в записи адрес /api/files/fl…. Менять фото может тот, у кого есть право «Добавлять товары» (catalog), видеть — «остатки».

// Крупные фото перед загрузкой уменьшаются: длинная сторона не больше PHOTO_SIDE, JPEG с качеством PHOTO_QUALITY.
const PHOTO_SIDE=1600,PHOTO_QUALITY=0.85;
const PHOTO_ACCEPT=Attach.PHOTO_TYPES.join(',');
const PHOTO_NO_SPACE='фото не поместилось в браузер';

// Откуда брать картинку на экран: адрес файла сервера или data-URL картинки; всё остальное — '' (в src чужой адрес не ставим)
const PHOTO_URL=/^\/api\/files\/fl[0-9a-f]{24}$/,PHOTO_DATA=/^data:image\/(?:jpeg|png|webp|gif);base64,/;
function photoSrc(f){
  if(!f) return '';
  if(typeof f.url==='string'&&PHOTO_URL.test(f.url)) return f.url;
  return typeof f.data==='string'&&PHOTO_DATA.test(f.data)?f.data:'';
}
const photoList=p=>Array.isArray(p&&p.photos)?p.photos.filter(f=>f&&typeof f==='object'):[];

// ——— список: маленькое главное фото рядом с названием ———
// Нет фото — ничего не рисуется (без заглушек). Картинка грузится лениво: список в сотни строк не тянет их все сразу.
function photoThumb(p){
  const f=photoList(p)[0],src=photoSrc(f);
  return src?`<img class="pthumb" src="${esc(src)}" alt="Фото: ${esc(p.name)}" width="40" height="40" loading="lazy" decoding="async">`:'';
}
const photoCell=(p,inner)=>{const t=photoThumb(p);return t?`<div class="pcell">${t}${inner}</div>`:inner};

// ——— карточка товара: блок «Фото» ———
const photoOf=(pid,fid)=>{const p=product(pid);return {p,f:p?photoList(p).find(x=>x.id===fid):undefined}};
function photoAddHtml(p){
  if(!can('catalog')) return '';
  if(photoList(p).length>=Attach.PHOTO_MAX) return `<small class="hint">Фото уже ${Attach.PHOTO_MAX} — больше не добавить.</small>`;
  const id=esc(p.id);
  return `<span class="pp-add"><label class="btn pp-pick" for="pp-add-in">${ic('plus')}Добавить фото<input id="pp-add-in" class="sr" type="file" multiple accept="${PHOTO_ACCEPT}" data-on="photo-add" data-pid="${id}"></label>`
    +`<label class="btn pp-cam" for="pp-cam-in">${ic('camera')}Снять на камеру<input id="pp-cam-in" class="sr" type="file" accept="image/*" capture="environment" data-on="photo-add" data-pid="${id}"></label></span>`;
}
function photoItem(p,f,i){
  const src=photoSrc(f),edit=can('catalog'),big=i===0,pid=esc(p.id),fid=esc(f.id);
  const img=src
    ?`<button type="button" class="pp-img" data-act="photo-view" data-pid="${pid}" data-fid="${fid}" aria-label="Открыть крупно: ${esc(f.name)}"><img src="${esc(src)}" alt="Фото ${i+1}: ${esc(p.name)}" loading="lazy" decoding="async">${big?'<span class="pill ok sm pp-main">Главное</span>':''}</button>`
    :`<div class="pp-img pp-lost">${ic('photo')}<small class="warn-t">${f.unsaved?PHOTO_NO_SPACE:'нет данных: файл'}</small>${big?'<span class="pill ok sm pp-main">Главное</span>':''}</div>`;
  const btns=edit?`<div class="pp-btns">${big?'':`<button type="button" class="btn sm ghost" data-act="photo-main" data-pid="${pid}" data-fid="${fid}">Сделать главным</button>`}`
    +`<label class="btn sm ghost" for="pp-r-${fid}">Заменить<input id="pp-r-${fid}" class="sr" type="file" accept="${PHOTO_ACCEPT}" data-on="photo-repl" data-pid="${pid}" data-fid="${fid}"></label>`
    +`<button type="button" class="btn sm ghost" data-act="photo-del" data-pid="${pid}" data-fid="${fid}" aria-label="Удалить фото ${i+1}">Удалить</button></div>`:'';
  return `<figure class="pp-it${big?' big':''}">${img}<figcaption class="sr">${esc(f.name)}</figcaption>${btns}</figure>`;
}
// Блок «Фото»: большое главное фото и ряд маленьких; без фото — рамка «Фото нет»
function photoBlock(p){
  const list=photoList(p),add=photoAddHtml(p);
  if(!list.length) return `<div class="pp"><h4 class="sh">Фото</h4><div class="pp-empty">${ic('photo')}<b>Фото нет</b>${add}</div></div>`;
  const rest=list.slice(1);
  return `<div class="pp"><h4 class="sh">Фото · ${list.length}</h4>${photoItem(p,list[0],0)}${rest.length?`<div class="pp-row">${rest.map((f,i)=>photoItem(p,f,i+1)).join('')}</div>`:''}${add?`<div class="pp-foot">${add}</div>`:''}</div>`;
}

// ——— просмотр крупно ———
// Слой поверх карточки: картинка закрывает окно нажатием, Esc закрывает (оболочка), стрелки — к соседнему фото.
MODALS.photoView=key=>{
  const [pid,fid]=String(key).split('|'),{p,f}=photoOf(pid,fid),src=photoSrc(f);
  if(!p||!f||!src||!can('stock')) return `<div>${mHead('Фото')}<div class="modal-b"><p class="m0">Фото нет.</p></div></div>`;
  const list=photoList(p),i=list.indexOf(f);
  const go=(to,sym,lbl)=>to?`<button type="button" class="btn icon ghost" data-act="photo-view" data-pid="${esc(pid)}" data-fid="${esc(to.id)}" aria-label="${lbl}">${sym}</button>`:'<span></span>';
  return `<div>${mHead(esc(p.name))}<div class="modal-b pp-view"><button type="button" class="pp-zoom" data-act="close-modal" aria-label="Закрыть просмотр"><img class="dsp-big" src="${esc(src)}" alt="Фото ${i+1} из ${list.length}: ${esc(p.name)}"></button>`
    +`<div class="pp-nav">${go(list[i-1]&&photoSrc(list[i-1])?list[i-1]:null,'←','Предыдущее фото')}<small class="muted">${i+1} из ${list.length} · ${esc(f.name)}</small>${go(list[i+1]&&photoSrc(list[i+1])?list[i+1]:null,'→','Следующее фото')}</div></div></div>`;
};
A['photo-view']=el=>{const {f}=photoOf(el.dataset.pid,el.dataset.fid);if(f&&photoSrc(f)) openModal('photoView',el.dataset.pid+'|'+el.dataset.fid)};

// ——— подготовка файла: уменьшение ———
// Размер после уменьшения: длинная сторона не больше side, пропорции сохраняются; меньше — без изменений (k = 1).
function photoFit(w,h,side=PHOTO_SIDE){
  const k=Math.min(1,side/Math.max(w,h,1));
  return {k,w:Math.max(1,Math.round(w*k)),h:Math.max(1,Math.round(h*k))};
}
// Что нужно подготовке от браузера: декодер картинки и холст. Нет холста (или не вышло) — файл уходит как есть.
function photoIO(){
  if(typeof document==='undefined'||typeof document.createElement!=='function') return null;
  return {
    async decode(file){
      if(typeof createImageBitmap==='function'){const b=await createImageBitmap(file);return {w:b.width,h:b.height,src:b,done:()=>{if(b.close) b.close()}}}
      if(typeof Image!=='function'||typeof URL==='undefined'||!URL.createObjectURL) throw new Error('нет декодера');
      const url=URL.createObjectURL(file),img=new Image();
      await new Promise((ok,bad)=>{img.onload=ok;img.onerror=bad;img.src=url});
      return {w:img.naturalWidth,h:img.naturalHeight,src:img,done:()=>URL.revokeObjectURL(url)};
    },
    canvas(w,h){
      const c=document.createElement('canvas');c.width=w;c.height=h;
      const ctx=c.getContext&&c.getContext('2d');
      if(!ctx||typeof c.toBlob!=='function') return null;
      return {
        draw:src=>ctx.drawImage(src,0,0,w,h),
        alpha:()=>{const d=ctx.getImageData(0,0,w,h).data;for(let i=3;i<d.length;i+=4) if(d[i]<255) return true;return false},
        blob:(type,q)=>new Promise(ok=>c.toBlob(ok,type,q))
      };
    }
  };
}
const photoFile=(blob,name,type)=>typeof File==='function'?new File([blob],name,{type}):Object.assign(blob,{name,type});
// Файл → файл для загрузки. GIF (может быть анимацией) и фото не больше PHOTO_SIDE уходят как есть; крупное уменьшается до PHOTO_SIDE
// по длинной стороне и сохраняется JPEG с качеством PHOTO_QUALITY; PNG и WebP с прозрачностью остаются PNG. Ошибка или нет холста — как есть.
async function photoPrepare(file,io){
  io=io===undefined?photoIO():io;
  if(!io||file.type==='image/gif') return file;
  let img=null;
  try{
    img=await io.decode(file);
    const fit=photoFit(img.w,img.h);
    if(fit.k>=1) return file;
    const cv=io.canvas(fit.w,fit.h);
    if(!cv) return file;
    cv.draw(img.src);
    const png=file.type!=='image/jpeg'&&cv.alpha(),type=png?'image/png':'image/jpeg';
    const blob=await cv.blob(type,png?undefined:PHOTO_QUALITY);
    if(!blob||!(blob.size<file.size)) return file;
    return photoFile(blob,String(file.name||'фото').replace(/\.[^.]*$/,'')+(png?'.png':'.jpg'),type);
  }catch(_){return file}
  finally{if(img&&img.done) img.done()}
}

// ——— действия ———
// Не фото — отказ с понятным текстом до чтения; остальные подготавливаются (уменьшаются) и читаются/загружаются по порядку выбора.
// → список файлов для Attach.addPhotos
async function photoIntake(files){
  const got=[];
  for(const f of files){
    const bad=Attach.photoProblem({name:f.name,type:f.type});
    if(bad){toast(bad,'warn');continue}
    await attReadFiles([await photoPrepare(f)],x=>got.push(x),'photo');
  }
  return got;
}
// Работы с фото идут в фоне (чтение, загрузка); photoIdle() ждёт, пока все закончатся
const PHOTO_JOBS=[];
const photoIdle=()=>Promise.all(PHOTO_JOBS.splice(0));
function photoJob(run){
  const job=run().catch(()=>toast('Фото не добавлено — что-то пошло не так, повторите.','warn'));
  PHOTO_JOBS.push(job);
  // выбор файла — поле data-on: оболочка после обработчика ставит отложенное сохранение, а настоящее идёт из render() по готовности
  Promise.resolve().then(()=>clearTimeout(_saveT));
  return job;
}
// Одно действие — одна запись: все выбранные фото добавляются вместе и одним render() (он и сохраняет)
ON.change['photo-add']=t=>{
  const files=[...t.files],pid=t.dataset.pid;
  t.value='';
  if(!files.length) return;
  if(!can('catalog')){toast('У вашей роли нет права менять фото товара.','warn');return}
  photoJob(async()=>{
    const got=await photoIntake(files),p=product(pid);
    if(!got.length||!p||!can('catalog')) return;
    const r=Attach.addPhotos(p,got,S.me,new Date());
    if(!r.ok){toast(r.reason,'warn');return}
    render();toast(r.added.length===1?`Фото «${r.added[0].name}» добавлено.`:`Добавлено фото: ${r.added.length}.`);
  });
};
ON.change['photo-repl']=t=>{
  const files=[...t.files].slice(0,1),{pid,fid}=t.dataset;
  t.value='';
  if(!files.length) return;
  if(!can('catalog')){toast('У вашей роли нет права менять фото товара.','warn');return}
  photoJob(async()=>{
    const got=await photoIntake(files),p=product(pid);
    if(!got.length||!p||!can('catalog')) return;
    const r=Attach.replacePhoto(p,fid,got[0],S.me,new Date());
    if(!r.ok){toast(r.reason,'warn');return}
    render();toast(`Фото заменено на «${r.file.name}».`);
  });
};
A['photo-main']=el=>{
  const {p}=photoOf(el.dataset.pid,el.dataset.fid);
  if(!p) return;
  if(!can('catalog')) return toast('У вашей роли нет права менять фото товара.','warn');
  const r=Attach.mainPhoto(p,el.dataset.fid);
  if(!r.ok) return toast(r.reason,'warn');
  render();toast('Это фото теперь главное.');
};
A['photo-del']=el=>{
  if(!can('catalog')) return toast('У вашей роли нет права менять фото товара.','warn');
  if(photoOf(el.dataset.pid,el.dataset.fid).f) openModal('photoDel',el.dataset.pid+'|'+el.dataset.fid);
};
// Удалить — после подтверждения: фото из списка убирается, на сервере файл помечается к уборке (через 30 дней)
MODALS.photoDel=key=>{
  const [pid,fid]=String(key).split('|'),{p,f}=photoOf(pid,fid);
  if(!p||!f) return `<div>${mHead('Удалить фото?')}<div class="modal-b"><p class="m0">Такого фото уже нет.</p></div></div>`;
  const src=photoSrc(f);
  return `<form data-form="photo-del" data-key="${esc(key)}" novalidate>${mHead('Удалить фото?')}<div class="modal-b">${src?`<img class="dsp-big" src="${esc(src)}" alt="${esc(f.name)}">`:''}`
    +`<p class="m0">Фото «${esc(f.name)}» пропадёт из карточки «${esc(p.name)}». Вернуть его нельзя — придётся загрузить заново.</p></div>${mFoot('Удалить')}</form>`;
};
FORMS['photo-del']=f=>{
  const [pid,fid]=String(f.dataset.key).split('|'),{p,f:ph}=photoOf(pid,fid);
  if(!can('catalog')){closeModal();return toast('У вашей роли нет права менять фото товара.','warn')}
  if(!p||!ph){closeModal();return}
  const r=Attach.removePhoto(p,fid);
  closeModal();
  if(!r.ok) return toast(r.reason,'warn');
  render();toast(`Фото «${r.file.name}» удалено.`);
};
