// Таблицы: сортировка по клику на название столбца и ширина столбцов, которую меняют перетаскиванием правого края заголовка.
// Слова директора 2026-11-12: «изменение ширины столбцов и нажатие на название столбца для сортировки, ещё кнопка-выпадающий список для сортировки».
// Первый экран с этим — «Товары» (53-stock.js); помощники общие, другим таблицам нужна только подстановка колонок.
// Ширина запоминается в браузере (localStorage, у каждого человека своя), на сервер не уходит. Сортировка — S.ui.sort ({col, dir}), личное, как фильтры.

const COLW_KEY='crm.colw.';
const COLW_MIN=60,COLW_MAX=900;
function colwLoad(id){
  try{const o=JSON.parse(localStorage.getItem(COLW_KEY+id)||'{}');return o&&typeof o==='object'&&!Array.isArray(o)?o:{}}catch(_){return {}}
}
function colwSave(id,o){try{localStorage.setItem(COLW_KEY+id,JSON.stringify(o))}catch(_){/* без хранилища ширина живёт до перезагрузки */}}
const colwClamp=w=>Math.min(COLW_MAX,Math.max(COLW_MIN,Math.round(Number(w)||0)));
// cols — [{key, w}] (w — ширина по умолчанию, px) → те же с сохранёнными ширинами
function colwOf(id,cols){
  const saved=colwLoad(id);
  return cols.map(c=>({...c,w:Object.prototype.hasOwnProperty.call(saved,c.key)&&saved[c.key]?colwClamp(saved[c.key]):c.w}));
}
// <colgroup> с ширинами и общая ширина таблицы: стиль table-layout:fixed берёт ширину столбцов отсюда
function colgroupHtml(id,cols){
  const ws=colwOf(id,cols);
  return {style:`width:${ws.reduce((s,c)=>s+c.w,0)}px`,html:`<colgroup>${ws.map(c=>`<col data-cw="${esc(c.key)}" style="width:${c.w}px">`).join('')}</colgroup>`};
}
// Заголовок столбца: название (по клику — сортировка, если столбец сортируемый), стрелка направления и ручка ширины
function thHtml(tid,c,sort){
  const on=!!sort&&sort.col===c.key,dir=on?sort.dir:'';
  const arrow=on?`<span class="srt-a" aria-hidden="true">${dir==='desc'?'▼':'▲'}</span>`:'';
  const attrs=c.sort?` data-act="tbl-sort" data-tbl="${esc(tid)}" data-cw="${esc(c.key)}" tabindex="0" aria-sort="${on?(dir==='desc'?'descending':'ascending'):'none'}" title="Нажмите, чтобы отсортировать"`:'';
  const rz=`<span class="rz" data-act="rz-noop" data-tbl="${esc(tid)}" data-cw="${esc(c.key)}" title="Потяните, чтобы изменить ширину; двойной щелчок — вернуть прежнюю"></span>`;
  return `<th class="${c.num?'num ':''}${c.sort?'srt':''}"${attrs}>${c.label}${arrow}${rz}</th>`;
}
// Сортировка списка: get(элемент, столбец) → число, строка или null («нет данных»); пустые всегда в конце, при равенстве — по названию (tie)
function sortRows(list,spec,get,tie){
  if(!spec||!spec.col) return list;
  const k=spec.dir==='desc'?-1:1,cmp=(a,b)=>typeof a==='string'||typeof b==='string'?String(a).localeCompare(String(b),'ru',{numeric:true,sensitivity:'base'}):a-b;
  return list.map((x,i)=>({x,i,v:get(x,spec.col)})).sort((a,b)=>{
    const an=a.v===null||a.v===undefined,bn=b.v===null||b.v===undefined;
    if(an||bn) return an&&bn?a.i-b.i:an?1:-1;
    return cmp(a.v,b.v)*k||cmp(tie(a.x),tie(b.x))||a.i-b.i;
  }).map(r=>r.x);
}
// Нажатие на название: тот же столбец — наоборот, другой — по возрастанию
function sortToggle(cur,col){return {col,dir:cur&&cur.col===col&&cur.dir==='asc'?'desc':'asc'}}

// ——— перетаскивание края заголовка ———
document.addEventListener('pointerdown',e=>{
  const h=e.target&&e.target.closest&&e.target.closest('.rz');
  if(!h||(e.button!==undefined&&e.button!==0)) return;
  const tbl=h.closest('table'),key=h.dataset.cw,id=h.dataset.tbl;
  const col=tbl&&[...tbl.querySelectorAll('col')].find(c=>c.dataset.cw===key);
  if(!col) return;
  e.preventDefault();e.stopPropagation();
  const x0=e.clientX,w0=col.getBoundingClientRect().width;
  const total=()=>[...tbl.querySelectorAll('col')].reduce((s,c)=>s+(parseFloat(c.style.width)||0),0);
  const move=ev=>{col.style.width=colwClamp(w0+ev.clientX-x0)+'px';tbl.style.width=total()+'px'};
  const up=()=>{
    document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',up);
    const o=colwLoad(id);o[key]=colwClamp(parseFloat(col.style.width));colwSave(id,o);
  };
  document.addEventListener('pointermove',move);document.addEventListener('pointerup',up);
});
// Двойной щелчок по ручке — вернуть ширину столбца по умолчанию
document.addEventListener('dblclick',e=>{
  const h=e.target&&e.target.closest&&e.target.closest('.rz');
  if(!h) return;
  const o=colwLoad(h.dataset.tbl);delete o[h.dataset.cw];colwSave(h.dataset.tbl,o);
  render();
});
// Клик по ручке (после перетаскивания) не должен сортировать: ручка стоит внутри названия столбца
A['rz-noop']=()=>{};
