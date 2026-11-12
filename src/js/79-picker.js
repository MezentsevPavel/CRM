// «Подбор товаров» — окно как подбор в 1С: слева категории, в середине каталог с поиском (нажатие на строку добавляет 1 шт.,
// ещё нажатие — ещё одну), справа «Выбрано» с количеством; «Готово» отдаёт выбор тому, кто открыл окно.
// Слова директора 2026-11-12: «нажимаю добавить резерв, и сразу выпадает каталог, где я могу выбрать, как в 1С, справа кучу
// товара, количество, всё, готово. Примерно то же самое должно быть в сделках».
// Открывают: «Резервы» (78-reserves.js) и товары сделки (56-deals.js). Окно ничего не записывает само — только отдаёт выбор.
// Состояние окна — этой вкладки (PK), в S не попадает.

const PK_PAGE=60;
const PK={title:'',cat:'',q:'',more:0,sel:{},order:[],only:null,inStock:false,stockToggle:false,done:'Готово',note:'',onDone:null};
// o: {title, sel:{productId: кол-во}, only:[productId] — показывать только эти, stockToggle — флажок «Только в наличии»,
//     done — надпись кнопки, note — подсказка под заголовком, onDone(sel) — что сделать с выбором}
function pickerOpen(o){
  const sel={};for(const [pid,n] of Object.entries(o.sel||{})) if(Number(n)>0&&product(pid)) sel[pid]=Number(n);
  // флажок «Только в наличии» включён, если остатки вообще загружены (иначе список был бы пуст)
  const known=!!o.stockToggle&&S.products.some(p=>stockOf(p.id).known);
  Object.assign(PK,{title:o.title||'Подбор товаров',cat:'',q:'',more:0,sel,order:Object.keys(sel),only:o.only?new Set(o.only):null,
    inStock:known,stockToggle:!!o.stockToggle,done:o.done||'Готово',note:o.note||'',onDone:o.onDone||null});
  openModal('picker');
}
// Свободно сейчас по товару: число или null — «нет данных»
const pkFree=pid=>{const k=stockOf(pid);return k.known?Math.max(0,k.free):null};
function pkRows(){
  let list=Catalog.query(S,{q:PK.q,cat:PK.cat||''});
  if(PK.only) list=list.filter(p=>PK.only.has(p.id));
  if(PK.inStock) list=list.filter(p=>(pkFree(p.id)||0)>0);
  return list;
}
// Категории для левой колонки: дерево каталога с отступами; только те, где есть товары (с учётом «только эти»)
function pkCats(){
  const has=PK.only?[...PK.only].map(product).filter(Boolean):null;
  return Catalog.rows(S).filter(r=>r.total>0&&(!has||has.some(p=>p.cat===r.path||String(p.cat||'').startsWith(r.path+Catalog.SEP))));
}
function pkTreeHtml(){
  const item=(path,name,depth)=>`<li><button type="button" class="pk-cat${PK.cat===path?' on':''}" style="--d:${depth}" data-act="pk-cat" data-cat="${esc(path)}"${PK.cat===path?' aria-current="true"':''}>${esc(name)}</button></li>`;
  return `<ul class="pk-tree">${item('','Все товары',0)}${pkCats().map(r=>item(r.path,r.name,r.depth)).join('')}</ul>`;
}
function pkListHtml(){
  const all=pkRows(),list=all.slice(0,PK_PAGE*(PK.more+1)),pr=can('prices');
  if(!all.length) return `<p class="muted pk-empty">${PK.inStock?'В наличии ничего не нашлось. Снимите флажок «Только в наличии», чтобы видеть весь каталог.':'Ничего не нашлось. Попробуйте другое слово или выберите «Все товары».'}</p>`;
  const rows=list.map(p=>{
    const f=pkFree(p.id),n=PK.sel[p.id]||0;
    return `<tr class="pk-row${n?' on':''}" data-act="pk-add" data-pid="${esc(p.id)}" title="Нажмите, чтобы добавить 1 шт."><td><span class="pk-n">${esc(p.name)}</span><small class="muted">${esc(skuText(p))}${p.brand?' · '+esc(p.brand):''}</small></td><td class="num">${f===null?'<span class="muted">нет данных</span>':num(f)}</td>${pr?`<td class="num nowrap">${typeof p.price==='number'?rub(p.price):'<span class="muted">нет данных</span>'}</td>`:''}<td class="num pk-in">${n?`<b>${num(n)}</b>`:ic('plus')}</td></tr>`;
  }).join('');
  const more=all.length>list.length?`<p class="pk-more"><button type="button" class="btn sm" data-act="pk-more">Показать ещё (найдено ${num(all.length)})</button></p>`:'';
  return `<table class="tbl pk-tbl"><thead><tr><th>Товар</th><th class="num">Свободно</th>${pr?'<th class="num">Цена</th>':''}<th class="num">Выбрано</th></tr></thead><tbody>${rows}</tbody></table>${more}`;
}
function pkSelHtml(){
  const ids=PK.order.filter(pid=>PK.sel[pid]>0&&product(pid));
  if(!ids.length) return '<p class="muted m0">Пока пусто. Нажимайте на товары слева — они появятся здесь.</p>';
  const total=ids.reduce((s,pid)=>s+PK.sel[pid],0);
  return `<ul class="pk-sel">${ids.map(pid=>{const p=product(pid),f=pkFree(pid),over=f!==null&&PK.sel[pid]>f;
    return `<li><div class="pk-sn"><span>${esc(p.name)}</span><small class="${over?'bad-t':'muted'}">${f===null?'остаток: нет данных':'свободно '+num(f)}</small></div><input class="inp sm pk-q" type="number" min="0" step="1" inputmode="numeric" value="${PK.sel[pid]}" data-on="pk-n" data-pid="${esc(pid)}" aria-label="Количество: ${esc(p.name)}"><button type="button" class="pk-x" data-act="pk-del" data-pid="${esc(pid)}" aria-label="Убрать «${esc(p.name)}»" title="Убрать">×</button></li>`}).join('')}</ul><p class="m0 pk-sum">Позиций: <b>${num(ids.length)}</b>, всего <b>${num(total)}</b> шт.</p>`;
}
const pkCount=()=>PK.order.filter(pid=>PK.sel[pid]>0).length;
MODALS.picker=()=>{
  const cats=pkCats();
  return `<div class="pk-wrap">${mHead(esc(PK.title))}<div class="pk">
    <aside class="pk-side"><select class="inp pk-catsel" data-on="pk-catsel" aria-label="Категория"><option value="">Все товары</option>${cats.map(r=>`<option value="${esc(r.path)}"${PK.cat===r.path?' selected':''}>${'— '.repeat(r.depth)}${esc(r.name)}</option>`).join('')}</select><div id="pk-tree">${pkTreeHtml()}</div></aside>
    <section class="pk-main"><div class="pk-bar"><input id="pk-q" class="inp" type="search" value="${esc(PK.q)}" placeholder="Найти: название, бренд или артикул" data-on="pk-q" autocomplete="off" aria-label="Поиск товара">${PK.stockToggle?`<label class="pk-chk"><input type="checkbox" data-on="pk-stock"${PK.inStock?' checked':''}> Только в наличии</label>`:''}</div>${PK.note?`<p class="hint m0">${esc(PK.note)}</p>`:''}<div id="pk-list" class="pk-list">${pkListHtml()}</div></section>
    <aside class="pk-right"><h4 class="sh">Выбрано</h4><div id="pk-sel">${pkSelHtml()}</div></aside>
  </div><div class="modal-f"><button type="button" class="btn ghost" data-act="close-modal">Отмена</button><button type="button" class="btn pri" data-act="pk-done" id="pk-done">${esc(PK.done)}${pkCount()?` (${num(pkCount())})`:''}</button></div></div>`;
};
// Перерисовать части окна, не трогая поле поиска (фокус и курсор остаются)
function pkRefresh(parts){
  const set=(id,h)=>{const e=byId(id);if(e) e.innerHTML=h};
  if(parts.includes('list')) set('pk-list',pkListHtml());
  if(parts.includes('tree')) set('pk-tree',pkTreeHtml());
  if(parts.includes('sel')) set('pk-sel',pkSelHtml());
  const b=byId('pk-done');if(b) b.textContent=PK.done+(pkCount()?` (${num(pkCount())})`:'');
}
function pkSet(pid,n){
  n=Math.max(0,Math.floor(Number(n)||0));
  if(n>0){if(!PK.order.includes(pid)) PK.order.push(pid);PK.sel[pid]=n}
  else{delete PK.sel[pid];PK.order=PK.order.filter(x=>x!==pid)}
}
A['pk-add']=el=>{const pid=el.dataset.pid;if(!product(pid)) return;pkSet(pid,(PK.sel[pid]||0)+1);pkRefresh(['list','sel'])};
A['pk-del']=el=>{pkSet(el.dataset.pid,0);pkRefresh(['list','sel'])};
A['pk-cat']=el=>{PK.cat=el.dataset.cat||'';PK.more=0;const s=document.querySelector&&document.querySelector('.pk-catsel');if(s) s.value=PK.cat;pkRefresh(['list','tree'])};
A['pk-more']=()=>{PK.more++;pkRefresh(['list'])};
A['pk-done']=()=>{
  const sel={};for(const pid of PK.order) if(PK.sel[pid]>0) sel[pid]=PK.sel[pid];
  const cb=PK.onDone;closeModal();
  if(cb) cb(sel);
};
ON.input['pk-q']=t=>{PK.q=t.value;PK.more=0;pkRefresh(['list'])};
ON.change['pk-catsel']=t=>{PK.cat=t.value;PK.more=0;pkRefresh(['list','tree'])};
ON.change['pk-stock']=t=>{PK.inStock=!!t.checked;PK.more=0;pkRefresh(['list'])};
// Количество в «Выбрано»: 0 или пусто — товар убран (строка исчезнет при следующей перерисовке, чтобы не мешать вводу)
ON.input['pk-n']=t=>{const pid=t.dataset.pid,n=parseInt(t.value,10);if(n>0){PK.sel[pid]=n}else delete PK.sel[pid];pkRefresh(['list']);const b=byId('pk-done');if(b) b.textContent=PK.done+(pkCount()?` (${num(pkCount())})`:'')};
ON.change['pk-n']=()=>{PK.order=PK.order.filter(pid=>PK.sel[pid]>0);pkRefresh(['sel'])};
