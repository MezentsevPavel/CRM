// Раздел «Товары и остатки»: список всех позиций, карточка товара, резерв, журнал движений.
// Товары — Catalog (38-catalog.js), остатки и свободное — Stock.summary (33-stock.js): здесь только показ,
// ни одной своей формулы остатка. Подписи источников берутся из дат снимков (CATALOG, STOCK_SNAPSHOT).

// ——— общие подписи ———
const PAGE_SIZE=50;   // строк списка на странице: 434 строки сразу — это долгая отрисовка и длинная прокрутка
const MV_LIMIT=200;   // строк журнала на экране
const snapRu=s=>String(s).split('-').reverse().join('.');   // '2026-10-31' → '31.10.2026'
const noData=what=>`<span class="muted">нет данных: ${what}</span>`;
const priceNote=()=>`цена сайта, снимок ${snapRu(CATALOG.snapshot)}`;
// Рабочая база не берёт снимок 31.10: источник — перенос листа «Остатки» (Настройки → Перенос), а до него остатка нет
const stockNote=()=>SERVER?(S.stockSheet&&S.stockSheet.at?`таблица менеджеров, перенос ${snapRu(iso(S.stockSheet.at))}`:'нет данных: остатки ещё не перенесены'):`таблица менеджеров, снимок ${snapRu(STOCK_SNAPSHOT.snapshot)}`;
const priceTxt=p=>p.price==null?noData('цена'):rub(p.price);
// В таблице менеджеров числа по товару нет — свободное неизвестно (Stock.summary: free = null), а не нулевое и не отрицательное
const stockUnknown=k=>k.free===null;
// Столбцы таблицы товаров: ключ, название, ширина по умолчанию (px), число ли, сортируется ли; «Цена» — только у кого есть право prices
const stockCols=pr=>[
  {key:'name',label:'Товар',w:380,sort:true},{key:'onHand',label:'На складе',w:110,num:1,sort:true},{key:'reserved',label:'В резерве',w:130,num:1,sort:true},
  {key:'free',label:'Свободно сейчас',w:130,num:1,sort:true},{key:'transit',label:'В пути',w:220,sort:true},{key:'freeAfter',label:'Свободно после прихода',w:150,num:1,sort:true},
  ...(pr?[{key:'price',label:'Цена',w:110,num:1,sort:true}]:[]),{key:'pic',label:'Картина',w:130}
];
// Значение для сортировки по столбцу; null — «нет данных», такие строки всегда внизу
function stockSortVal(p,col){
  const k=stockOf(p.id);
  switch(col){
    case 'name': return p.name;
    case 'onHand': return k.known?k.onHand:null;
    case 'reserved': return k.reservedStock+k.reservedIncoming;
    case 'free': return stockUnknown(k)?null:k.free;
    case 'transit': return k.incoming;
    case 'freeAfter': return stockUnknown(k)?null:k.freeAfter;
    case 'price': return typeof p.price==='number'&&isFinite(p.price)?p.price:null;
  }
  return null;
}
// Пункты выпадающего списка «Сортировка»: «столбец:направление»; пусто — порядок каталога
const STOCK_SORTS=pr=>[['','Как в каталоге'],['name:asc','Название: А → Я'],['name:desc','Название: Я → А'],['onHand:desc','На складе: больше'],['onHand:asc','На складе: меньше'],
  ['reserved:desc','В резерве: больше'],['reserved:asc','В резерве: меньше'],['free:desc','Свободно сейчас: больше'],['free:asc','Свободно сейчас: меньше'],
  ['transit:desc','В пути: больше'],['transit:asc','В пути: меньше'],['freeAfter:desc','Свободно после прихода: больше'],['freeAfter:asc','Свободно после прихода: меньше'],
  ...(pr?[['price:asc','Цена: дешевле'],['price:desc','Цена: дороже']]:[])];
const sortKey=s=>s&&s.col?s.col+':'+s.dir:'';
// Юрлицо и город в одну подпись; неизвестный id показывается как есть
const cellText=(e,c)=>Stock.cellText(S,e,c);
const optionsHtml=(list,cur)=>list.map(([v,t])=>`<option value="${esc(v)}"${v===cur?' selected':''}>${esc(t)}</option>`).join('');
const selField=(id,on,label,list,cur)=>`<div class="field"><label for="${id}">${label}</label><select id="${id}" class="inp" data-on="${on}">${optionsHtml(list,cur)}</select></div>`;

// ——— раздел: две вкладки, «Товары» и «Журнал движений» ———
function vStock(){
  const tab=S.ui.stockTab==='moves'?'moves':'goods';
  const tabs=`<div class="seg" role="tablist" aria-label="Раздел склада">${[['goods','Товары'],['moves','Журнал движений']].map(([k,l])=>`<button type="button" role="tab" aria-selected="${tab===k}" class="${tab===k?'on':''}" data-act="stock-tab" data-tab="${k}">${l}</button>`).join('')}</div>`;
  return tab==='moves'?movesPane(tabs):goodsPane(tabs);
}

// ——— вкладка «Товары» ———
// Выбранный бренд, которого нет среди брендов выбранной категории (ушли в другую), сбрасывается
const brandNames=cat=>Catalog.brandRows(S,cat).map(b=>b.brand);
function fixBrand(){
  const u=S.ui;
  if(u.brand&&!brandNames(u.cat).includes(u.brand)) u.brand='';
}
function goodsPane(tabs){
  const u=S.ui;
  fixBrand();
  const filters=[
    selField('f-brand','brand','Бренд',[['','Все бренды'],...brandNames(u.cat).map(b=>[b,b])],u.brand||''),
    selField('f-avail','avail','Наличие',[['','Любое наличие'],...[...new Set(S.products.map(p=>p.avail).filter(Boolean))].map(a=>[a,a])],u.avail||''),
    selField('f-sort','sort','Сортировка',STOCK_SORTS(can('prices')),sortKey(u.sort)),
    selField('f-catf','catf','Каталог',[['','В каталоге и нет'],['in','Только в каталоге'],['out','Только «нет в каталоге»']],u.catf||'')
  ].join('');
  return `<div class="bar">${tabs}<span class="grow"></span>${can('receive')?`<button class="btn" data-act="rcpt-open">${ic('plus')}Оприходовать товар</button>`:''}${can('catalog')?`<button class="btn" data-act="cat-manage">${ic('box')}Категории</button><button class="btn" data-act="new-product">${ic('plus')}Новый товар</button>`:''}</div>
  <div class="bar"><div class="search-in">${ic('search')}<input id="sq" class="inp" type="search" placeholder="Название, артикул или бренд" value="${esc(u.sq)}" data-on="sq" aria-label="Поиск товара по названию, артикулу, бренду или ключу"></div>
  <label class="check"><input type="checkbox" id="deficit" data-on="deficit" ${u.deficit?'checked':''}> Только где не хватает</label></div>
  <div class="stock-lay">${catTree()}<div class="stock-main"><div class="fgrid">${filters}</div>
  <section class="card clip"><div class="legend"><span><i class="lg f"></i>Свободно на складе</span><span><i class="lg r"></i>На складе в резерве</span><span><i class="lg w"></i>В пути</span><span>«Свободно после прихода» = склад + в пути − все резервы</span></div><div id="stock-tbl">${stockTable()}</div></section></div></div>`;
}
// ——— дерево категорий слева от списка ———
// Строки — Catalog.rows (порядок дерева, число товаров с подкатегориями). Выбранная категория показывает и свои товары, и товары всех
// подкатегорий (Catalog.query). Стрелка слева раскрывает и сворачивает подкатегории, название выбирает категорию. Под каждой категорией,
// в которой товары лежат сами (нет подкатегорий), дописаны бренды её товаров — уровень «фирма», производный: он берётся из поля «Бренд»
// (Catalog.brandRows) и нигде не хранится; выбор бренда = категория + бренд, тот же фильтр, что список «Бренд». Раскрытое запоминается
// в S.ui.catOpen (личное, на сервер не уходит; нет записи — раскрыта ветка выбранной категории). На узком экране дерево — под кнопкой.
const CAT_ALL='Все';
const catParent=path=>path.includes(Catalog.SEP)?path.slice(0,path.lastIndexOf(Catalog.SEP)):'';
const catAncestors=path=>{const out=[];for(let p=catParent(path);p;p=catParent(p)) out.push(p);return out};
// Раскрыт ли узел: выбор человека, а без выбора — раскрыты выбранная категория и её предки
function catIsOpen(path){
  const o=(S.ui.catOpen||{})[path];
  if(o!==undefined) return !!o;
  const cur=S.ui.cat||CAT_ALL;
  return cur===path||cur.startsWith(path+Catalog.SEP);
}
// Выбрали категорию: её ветка раскрыта (без записи — по умолчанию раскрыта выбранная ветка), прежние ручные «свернуть» этой ветки сняты
function catOpenBranch(path){
  const o=S.ui.catOpen;
  if(!o||path===CAT_ALL) return;
  delete o[path];for(const a of catAncestors(path)) delete o[a];
}
function catTree(){
  const cur=S.ui.cat||CAT_ALL,curBrand=S.ui.brand||'',rows=Catalog.rows(S),parents=new Set(rows.map(r=>catParent(r.path)).filter(Boolean));
  const noCat=S.products.filter(p=>!p.cat||p.cat===Catalog.NO_CAT).length;
  const chev=(path,name,kids)=>kids?`<button type="button" class="ct-tg" data-act="cat-toggle" data-cat="${esc(path)}" aria-expanded="${catIsOpen(path)}" aria-label="${catIsOpen(path)?'Свернуть':'Раскрыть'} «${esc(name)}»">${ic('chevR')}</button>`:'<span class="ct-tg"></span>';
  const item=(path,name,n,depth,kids)=>`<li class="ct-row${cur===path&&!curBrand?' on':''}" style="--d:${depth}">${chev(path,name,kids)}<button type="button" class="ct-name" data-act="stock-cat" data-cat="${esc(path)}"${cur===path&&!curBrand?' aria-current="true"':''}><span>${esc(name)}</span><small>${num(n)}</small></button></li>`;
  const brandItem=(path,b,depth)=>{const on=cur===path&&curBrand===b.brand;return `<li class="ct-row ct-brand${on?' on':''}" style="--d:${depth}"><span class="ct-tg"></span><button type="button" class="ct-name" data-act="stock-brand" data-cat="${esc(path)}" data-brand="${esc(b.brand)}"${on?' aria-current="true"':''}><span>${esc(b.brand)}</span><small>${num(b.n)}</small></button></li>`};
  const list=rows.filter(r=>catAncestors(r.path).every(catIsOpen)).map(r=>{
    const leaf=!parents.has(r.path),brands=leaf?Catalog.brandRows(S,r.path):[];
    return item(r.path,r.name,r.total,r.depth,!leaf||brands.length>0)+(brands.length&&catIsOpen(r.path)?brands.map(b=>brandItem(r.path,b,r.depth+1)).join(''):'');
  }).join('');
  const label=(cur===CAT_ALL?'все товары':cur)+(curBrand?' · '+curBrand:'');
  return `<aside class="ct-box card${S.ui.catPane?' open':''}" aria-label="Категории товаров"><button type="button" class="btn ct-show" data-act="cat-pane" aria-expanded="${!!S.ui.catPane}">Категория: ${esc(label)} <span aria-hidden="true">▾</span></button>
    <div class="ct-body"><ul class="ct-list">${item(CAT_ALL,'Все',S.products.length,0,false)}${list}${noCat?item(Catalog.NO_CAT,Catalog.NO_CAT,noCat,0,false):''}</ul>${can('catalog')?'<button type="button" class="btn sm ghost ct-mng" data-act="cat-manage">Добавить и изменить категории</button>':''}</div></aside>`;
}
function sbar(p,big){
  const k=stockOf(p.id),fn=Math.max(0,k.free),rs=Math.min(k.onHand,k.reservedStock),iq=k.incoming,tot=Math.max(1,fn+rs+iq),w=x=>(x/tot*100).toFixed(1)+'%';
  return `<div class="sbar ${big?'big':''}" title="Свободно ${num(fn)}, в резерве ${num(rs)}, в пути ${num(iq)}"><i class="f" style="width:${w(fn)}"></i><i class="r" style="width:${w(rs)}"></i><i class="w" style="width:${w(iq)}"></i></div>`;
}
// Позиции под поиском и фильтрами экрана (Catalog.query), затем «не хватает» — по Stock.summary
function stockRows(){
  const u=S.ui;
  const list=Catalog.query(S,{q:u.sq,cat:u.cat==='Все'?'':u.cat,brand:u.brand||'',avail:u.avail||'',inCatalog:u.catf==='in'?true:u.catf==='out'?false:undefined});
  // «не хватает»: с учётом поставок меньше нуля, либо остаток известен и свободного нет; без данных об остатке — не дефицит
  const shown=u.deficit?list.filter(p=>{const k=stockOf(p.id);return k.freeAfter<0||(k.known&&k.free<=0)}):list;
  return sortRows(shown,u.sort,stockSortVal,p=>p.name);
}
// Переключатель страниц: span — сколько страниц подряд раскрыто с page («Показать ещё» +1, «Показать всё» — все)
function pagerHtml(page,pages,span){
  if(pages<2) return '';
  const last=page+span-1,end=last>=pages-1;
  // «Страница [N] из M»: N — поле ввода (первая из раскрытых страниц), M — текст; кнопки одного вида и размера
  const label=`Страница <input class="inp pgi" type="number" min="1" max="${pages}" value="${page+1}" inputmode="numeric" data-on="stock-goto" aria-label="Номер страницы"> из <b>${pages}</b>${span>1?` <span class="muted">(раскрыто до ${last+1})</span>`:''}`;
  return `<div class="pager"><button type="button" class="btn sm" data-act="stock-page" data-page="${page-1}" ${page<1?'disabled':''}>← Назад</button><span class="pgl muted sm">${label}</span><button type="button" class="btn sm" data-act="stock-page" data-page="${last+1}" ${end?'disabled':''}>Вперёд →</button>${end?'':`<span class="pgm"><button type="button" class="btn sm" data-act="stock-more">Показать ещё</button><button type="button" class="btn sm" data-act="stock-all">Показать всё</button></span>`}</div>`;
}
// Бейдж «N резервов» в строке номенклатуры: кнопка открывает карточку товара сразу на списке резервов
const resBadge=p=>{const n=resOf(p.id).length;return n?`<button type="button" class="rbadge" data-act="product-reserves" data-id="${esc(p.id)}" title="Кто, что и когда зарезервировал">${ic('lock')}${n} ${pl(n,'резерв','резерва','резервов')}</button>`:''};
// «В пути: ВС 20 (продано 15) · НПП 5» — по юрлицам поставок (Stock.transitText); «продано» — резервы под эти поставки
const transitLine=pid=>{const t=Stock.transitText(S,pid);return t?'В пути: '+t:''};
function stockRow(p,pr){
  const k=stockOf(p.id),ra=k.reservedStock+k.reservedIncoming,inc=Stock.incomingOf(S,p.id),fa=k.freeAfter,unk=stockUnknown(k),nd='<span class="muted">нет данных</span>';
  // ключ каталога на экране не показывается (слово директора: «это же не нужно здесь»); помечается только товар, которого в каталоге нет
  const key=p.inCatalog?'':'<span class="pill sun sm">нет в каталоге</span>';
  const meta=[key,...[p.brand,p.cat].filter(Boolean).map(esc)].filter(Boolean).join(' · ');
  return `<tr class="click" data-act="open-product" data-pid="${esc(p.id)}" tabindex="0"><td>${photoCell(p,`<div class="pname"><span>${esc(p.name)}</span>${skuTag(p)}<small>${meta}</small></div>`)}</td><td class="num">${k.known?qtyOf(k.onHand,p):nd}</td><td class="num">${num(ra)}${k.reservedIncoming?`<small class="muted">${num(k.reservedIncoming)} под поставку</small>`:''}${resBadge(p)}</td><td class="num free">${unk?nd:`<b class="${k.free<=0?'bad-t':''}">${num(k.free)}</b>`}</td><td>${k.incoming?`<span class="in-t">${qtyOf(k.incoming,p)}</span><small class="muted">${esc(transitLine(p.id))}</small><small class="muted">ближайшая ${fD(k.nextEta)}${inc.length>1?` · ${inc.length} поставки`:''}</small>`:'<span class="muted">не ждём</span>'}</td><td class="num">${unk?nd:fa<0?`<span class="pill bad sm">не хватает ${num(-fa)}</span>`:num(fa)}</td>${pr?`<td class="num">${priceTxt(p)}</td>`:''}<td>${sbar(p)}</td></tr>`;
}
// Содержимое #stock-tbl: «показано N из M», страница таблицы, переключатель страниц
function stockTable(){
  const rows=stockRows(),all=S.products.length,pages=Math.max(1,Math.ceil(rows.length/PAGE_SIZE));
  const page=Math.min(Math.max(0,parseInt(S.ui.page,10)||0),pages-1),span=Math.min(Math.max(1,Math.floor(Number(S.ui.span))||1),pages-page);
  const from=page*PAGE_SIZE,part=rows.slice(from,from+span*PAGE_SIZE);
  const head=`<div class="count"><span>Показано <b>${rows.length}</b> из <b>${all}</b> позиций</span>${rows.length>PAGE_SIZE?`<span class="muted">строки ${from+1}–${from+part.length}</span>`:''}</div>`;
  if(!rows.length) return head+emptyState('Ничего не нашлось. Проверьте фильтр или строку поиска.','Сбросить фильтры','stock-reset');
  const pr=can('prices'),pg=pagerHtml(page,pages,span);
  const cols=stockCols(pr),cg=colgroupHtml('goods',cols);
  return `${head}<div class="xs"><table class="tbl rsz" style="${cg.style}">${cg.html}<thead><tr>${cols.map(c=>thHtml('goods',c,S.ui.sort)).join('')}</tr></thead><tbody>${part.map(p=>stockRow(p,pr)).join('')}</tbody></table></div>${pg}`;
}
const refreshStock=()=>{S.ui.page=0;S.ui.span=1;byId('stock-tbl').innerHTML=stockTable()};
// Выпадающий список категорий: путь — значение, отступ — глубина. opts: top — первая строка «ничего» (значение ''), noCat — строка «Без раздела»,
// skipId — не показывать эту категорию и всё, что в ней (куда переносить саму её). Строки, которых нет в дереве, в выбор не попадают.
function catOptions(cur,opts={}){
  const skip=opts.skipId?Catalog.pathOf(S,opts.skipId):'',pad=n=>'   '.repeat(n);
  const one=(v,t,d)=>`<option value="${esc(v)}"${v===cur?' selected':''}>${pad(d)}${esc(t)}</option>`;
  return (opts.top?one('',opts.top,0):'')+(opts.noCat?one(Catalog.NO_CAT,Catalog.NO_CAT,0):'')
    +Catalog.rows(S).filter(r=>!r.virtual&&!(skip&&(r.path===skip||r.path.startsWith(skip+Catalog.SEP)))).map(r=>one(r.path,r.name,r.depth)).join('');
}

// ——— журнал движений: слова и строки общие для вкладки и карточки товара ———
// «Ввод остатков» — знак «=»: в qty лежит остаток клетки после переноса, а не прибавка («+» был бы неправдой)
const moveSign=m=>m.kind===Stock.KINDS.receive?'+':(m.kind===Stock.KINDS.ship||m.kind===Stock.KINDS.damage)?'−':m.kind===Stock.KINDS.input?'=':'';
const movePill=m=>`<span class="pill sm ${m.kind===Stock.KINDS.receive?'ok':m.kind===Stock.KINDS.ship?'info':m.kind===Stock.KINDS.damage?'bad':'sun'}">${esc(m.kind)}</span>`;
// Откуда и куда: клетка склада — «юрлицо · город»
function moveWhere(m){
  const K=Stock.KINDS,from=cellText(m.entityId,m.cityId);
  switch(m.kind){
    case K.receive: return `на склад: ${from}`;
    case K.ship: return `со склада: ${from}`;
    case K.damage: return `со склада в «Бой»: ${from}`;
    case K.transfer: return `${from} → ${cellText(m.toEntityId,m.toCityId)}`;
    case K.reserve: return `резерв: ${from}`;
    case K.unreserve: return `снят резерв: ${from}`;
    case K.input: return `остаток клетки: ${from}`;
    default: return from;
  }
}
const whoName=id=>person(id)?.name||'';
function movesPane(tabs){
  const u=S.ui,ids=[...new Set(S.moves.map(m=>m.productId))];
  if(u.mvPid&&!ids.includes(u.mvPid)) ids.push(u.mvPid);
  const prods=ids.map(id=>[id,product(id)?Catalog.label(product(id)):id]).sort((a,b)=>a[1].localeCompare(b[1],'ru'));
  const filters=selField('mv-pid','mvpid','Товар',[['','Все товары'],...prods],u.mvPid||'')+selField('mv-kind','mvkind','Вид движения',[['','Все виды'],...Object.values(Stock.KINDS).map(k=>[k,k])],u.mvKind||'');
  return `<div class="bar">${tabs}</div><div class="fgrid">${filters}</div><section class="card clip"><div id="mv-tbl">${movesTable()}</div></section>`;
}
function movesTable(){
  const u=S.ui,list=S.moves.filter(m=>(!u.mvPid||m.productId===u.mvPid)&&(!u.mvKind||m.kind===u.mvKind)),part=list.slice(0,MV_LIMIT);
  const head=`<div class="count"><span>Показано <b>${list.length}</b> из <b>${S.moves.length}</b> движений</span>${list.length>MV_LIMIT?`<span class="muted">первые ${MV_LIMIT}: уточните фильтр</span>`:''}</div>`;
  if(!part.length) return head+emptyState('Движений по этому фильтру нет.','Показать все движения','stock-journal');
  return `${head}<div class="xs"><table class="tbl"><thead><tr><th>Когда</th><th>Кто</th><th>Вид</th><th>Товар</th><th class="num">Сколько</th><th>Откуда и куда</th><th>Документ</th></tr></thead><tbody>${part.map(m=>{
    const p=product(m.productId),who=whoName(m.by);
    return `<tr${p?` class="click" data-act="open-product" data-pid="${esc(p.id)}" tabindex="0"`:''}><td class="nowrap">${fWhen(m.at)}</td><td>${who?esc(who):noData('кто')}</td><td>${movePill(m)}</td><td>${p?`<button type="button" class="link" data-act="open-product" data-pid="${esc(p.id)}">${esc(p.name)}</button>${skuTag(p)}`:noData('товар')}</td><td class="num">${moveSign(m)}${qtyOf(m.qty,p)}</td><td>${esc(moveWhere(m))}</td><td class="mono">${esc(moveDoc(m))}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

// Документ движения: номер сделки показываем, только если сделка видна человеку; чужая — «сделка скрыта» (Stock.docView)
const moveDoc=m=>Stock.docView(S,m.doc,S.me);
// ——— карточка товара ———
function srcPill(r){
  if(r.src==='stock') return '<span class="pill ok sm">на складе</span>';
  const s=ship(r.src),bad=stockOf(r.productId).freeAfter<0;
  return `<span class="pill ${bad?'bad':'info'} sm">едет: ${s?.id||r.src}${s?' · '+fD(s.eta):''}${bad?' · не хватает':''}</span>`;
}
// Таблица «юрлицо × склад» (Stock.table) — в каждой карточке товара, всегда. Клетка: остаток крупно, под ним «резерв N» и
// «свободно M»; пусто — 0 (слово директора). Справа и снизу «Итого» по тем же трём числам, в правом нижнем углу — «Свободно всего».
// Всё считает Stock.table; здесь только показ.
function gridHtml(p){
  const t=Stock.table(S,p.id);
  const cell=(v,cls='')=>`<td class="num${cls}"><b>${num(v.have)}</b><small>${v.held>0?`<button type="button" class="rlink" data-act="reserves-jump" title="Показать список резервов">резерв ${num(v.held)}</button>`:`резерв ${num(v.held)}`}</small><small class="${v.free<0?'bad-t':''}">свободно ${num(v.free)}</small></td>`;
  const all=t.all,tcell=(v,cls='',e='')=>`<td class="num in${cls}"><b>${num(v.qty)}</b><small>${v.sold>0?`<button type="button" class="rlink" data-act="transit-jump" data-e="${esc(e)}" title="Кто купил, какой менеджер, когда продано">продано ${num(v.sold)}</button>`:`продано ${num(v.sold)}`}</small><small>${v.free>0?`<button type="button" class="rlink" data-act="transit-jump" data-e="${esc(e)}" title="Какие поставки едут и когда ждём">ждёт покупателя ${num(v.free)}</button>`:`ждёт покупателя ${num(v.free)}`}</small></td>`;
  return `<div class="xs"><table class="tbl mx"><thead><tr><th>Юрлицо / склад</th>${t.cols.map(c=>`<th class="num">${esc(c.name)}</th>`).join('')}<th class="num">В пути</th><th class="num">Итого</th></tr></thead><tbody>${t.rows.map(r=>`<tr><th scope="row">${esc(r.name)}</th>${t.cols.map(c=>cell(t.cell(r.id,c.id))).join('')}${tcell(t.transit(r.id),'',r.id)}${cell(t.row(r.id),' tot')}</tr>`).join('')}</tbody><tfoot><tr><th scope="row">Итого</th>${t.cols.map(c=>cell(t.col(c.id),' tot')).join('')}${tcell(t.transitAll,' tot')}<td class="num tot all"><span>Свободно всего</span><b class="${all.free<0?'bad-t':''}">${num(all.free)}</b><small>по факту на складах ${num(all.have)}</small><small>в резерве ${num(all.held)}</small></td></tr></tfoot></table></div>`;
}
// Блок «Списать при продаже»: каждая клетка «юрлицо × город» с остатком — строка с кнопкой (право sell). Сколько можно списать
// без резерва — Stock.sellMax; зарезервированное списывают по резерву (кнопка в таблице «Резервы»).
function sellCells(p){
  if(!can('sell')) return '';
  const g=Stock.grid(S,p.id),rows=g.rows.flatMap(r=>g.cols.map(c=>({r,c,n:g.cell(r.id,c.id)}))).filter(x=>x.n>0);
  if(!rows.length) return '';
  return `<div><h4 class="sh">Списать при продаже</h4><ul class="mv sell-l">${rows.map(({r,c,n})=>{
    const free=Stock.sellMax(S,{productId:p.id,entityId:r.id,cityId:c.id});
    return `<li><span>${esc(cellText(r.id,c.id))}</span><b>${qtyOf(n,p)}</b><small>без резерва можно ${num(free)}</small><button type="button" class="btn sm" data-act="stock-sell" data-pid="${esc(p.id)}" data-e="${esc(r.id)}" data-c="${esc(c.id)}">Списать</button></li>`;
  }).join('')}</ul></div>`;
}
// «Можно поставить» — тем же Stock.canReserve, что проверяет сама постановка
const maxText=(pid,src,ent,city)=>`Можно поставить: ${num(Stock.canReserve(S,{productId:pid,qty:1,entityId:ent,cityId:city,src}).max)}`;
// Сделки, под которые человек может поставить резерв этого товара: видимые ему (Leads.dealsVisible), открытые, он вправе их
// править (Deals.canEdit), товар есть в строках и ещё не весь зарезервирован (Deals.left). Резерв ставит тот же Deals.reserve.
const reserveDeals=pid=>Leads.dealsVisible(S,S.me).filter(d=>Deals.state(S,d)==='open'&&Deals.canEdit(S,d,S.me)&&Deals.left(S,d,pid)>0);
function reserveForm(p,k,inc){
  if(!can('reserve')) return `<p class="lock">${ic('lock')}Резервы ставит менеджер или директор. Вам придёт уведомление, когда резерв появится.</p>`;
  const deals=reserveDeals(p.id),kind=deals.length?'deal':'free';
  const src=[`<option value="stock">Со склада — свободно ${k.free===null?'нет данных':qtyOf(Math.max(0,k.free),p)}</option>`,...inc.filter(x=>!x.dispatchId).map(x=>`<option value="${esc(x.shipId)}">Из поставки ${esc(x.shipId)}, ${fD(x.eta)} — свободно ${qtyOf(Math.max(0,Stock.freeIn(S,x.shipId,p.id)),p)}</option>`)].join('');
  // откуда на складе: юрлицо и город; по умолчанию — клетка, где свободного больше всего
  const cell=Stock.bestCell(S,p.id),opt=(list,none,cur)=>[...list.map(x=>[x.id,x.name]),[Stock.ANY,none]].map(([id,n])=>`<option value="${esc(id)}"${id===cur?' selected':''}>${esc(n)}</option>`).join('');
  return `<form class="rform" data-form="reserve" data-pid="${esc(p.id)}" novalidate><h4 class="sh">Поставить резерв</h4><div class="grid2"><div class="field span2"><label for="rs-kind">Под что</label><select id="rs-kind" class="inp" data-on="rskind">${optionsHtml([['deal','На сделку'],['free','Без сделки — для кого']],kind)}</select></div><div class="field" id="rs-deal-f"${kind==='free'?' hidden':''}><label for="rs-deal">Сделка</label><select id="rs-deal" class="inp">${deals.map(d=>`<option value="${d.id}">${d.id} · ${esc(d.client)} · можно ещё ${num(Deals.left(S,d,p.id))}</option>`).join('')}</select>${deals.length?'':'<small class="muted">Нет ваших открытых сделок с этим товаром в строках: добавьте товар в сделку или выберите «Без сделки — для кого».</small>'}</div><div class="field" id="rs-for-f"${kind==='free'?'':' hidden'}><label for="rs-for">Для кого</label><input id="rs-for" class="inp" maxlength="200" placeholder="под Иванова, монтаж в Шелехове" autocomplete="off"></div><div class="field"><label for="rs-qty">Количество${p.unit?', '+esc(p.unit):''}</label><input id="rs-qty" class="inp" type="number" min="1" value="1" inputmode="numeric"></div><div class="field span2"><label for="rs-src">Откуда</label><select id="rs-src" class="inp" data-on="rsmax">${src}</select></div><div class="field"><label for="rs-ent">Юрлицо (со склада)</label><select id="rs-ent" class="inp" data-on="rsmax">${opt(S.entities,Stock.NO_ENTITY,cell.entityId)}</select></div><div class="field"><label for="rs-city">Город (со склада)</label><select id="rs-city" class="inp" data-on="rsmax">${opt(S.cities,Stock.NO_CITY,cell.cityId)}</select></div><div class="field"><label for="rs-until">Резерв до</label><input id="rs-until" class="inp" type="date" value="${iso(day(Stock.RESERVE_DAYS))}"></div><div class="field end"><button class="btn pri" type="submit">${ic('lock')}Зарезервировать</button></div></div><p class="hint" id="rs-max">${maxText(p.id,'stock',cell.entityId,cell.cityId)}</p><p class="err" id="rs-err" hidden></p></form>`;
}
// Строка «В пути»: поставка (этап и срок из карточки поставки) или груз перемещения между складами — «в пути: N, ОТ-NNN»
// со ссылкой на заявку; у груза поставки нет, поэтому ни этапа поставки, ни резерва под него
function iRow(x,p){
  if(x.dispatchId) return `<li><span class="pill sm info">перемещение</span><span>в пути: ${qtyOf(x.qty,p)}, <button type="button" class="link" data-act="open-dispatch" data-id="${esc(x.dispatchId)}">${esc(x.shipId)}</button></span><small>на склад ${esc(cellText(x.entityId,x.cityId))} · ожидается ${fD(x.eta)}</small></li>`;
  const s=ship(x.shipId),late=isLate(s);
  return `<li><b class="mono">${esc(x.shipId)}</b><span>${qtyOf(x.qty,p)}</span><span class="pill sm ${late?'bad':'info'}">${late?'задерживается':esc(stageName(s).toLowerCase())}</span><small>ожидается ${fD(x.eta)}</small></li>`;
}
// «В пути»: по юрлицам — какие поставки едут и когда ждём, кому из них продано (сделка и клиент, менеджер, когда продано,
// до какого числа держим резерв) и сколько ещё ждёт покупателя. Считает Stock.transitDetail; здесь только показ.
function transitBuyer(b,p){
  const who=b.deal?`${can('clients')?`<button class="link" data-act="open-deal" data-id="${esc(b.deal.id)}">${esc(b.deal.id)}</button>`:esc(b.deal.id)} <span class="muted">${esc(b.deal.client||'')}</span>`:b.hasDeal?`<span class="muted">${Stock.HIDDEN_DEAL}</span>`:b.forWho?esc(b.forWho):b.note?esc(b.note):noData('для кого');
  const mgr=b.managerId?esc(whoName(b.managerId)):b.by?esc(whoName(b.by))+' <span class="muted">(поставил резерв)</span>':noData('менеджер');
  return `<li class="tbuy"><span>${who}</span><b>${qtyOf(b.qty,p)}</b><small>менеджер ${mgr} · продано ${b.at?fWhen(b.at):noData('когда')}${b.until?` · резерв до ${fD(b.until)}`:''}</small></li>`;
}
function transitShip(sh,p){
  if(sh.dispatchId) return iRow({shipId:sh.shipId,dispatchId:sh.dispatchId,qty:sh.qty,eta:sh.eta,entityId:sh.entityId,cityId:sh.cityId},p);
  const buyers=sh.buyers.map(b=>transitBuyer(b,p)).join('');
  const unseen=sh.sold-sh.buyers.reduce((n,b)=>n+b.qty,0);
  const hidden=unseen>0?`<li class="tbuy"><span class="muted">продано ${num(unseen)} — детали скрыты</span></li>`:'';
  const wait=sh.free>0?`<li class="tfree"><span>ждёт покупателя</span><b>${qtyOf(sh.free,p)}</b><small>приедет ${fD(sh.eta)}</small></li>`:'';
  return iRow({shipId:sh.shipId,qty:sh.qty,eta:sh.eta},p)+buyers+hidden+wait;
}
function transitHtml(p){
  const groups=Stock.transitDetail(S,p.id,S.me);
  if(!groups.length) return '<p class="muted m0">Поставок с этим товаром нет.</p>';
  return groups.map(g=>`<div class="tgrp" id="p-transit-${esc(g.entityId)}"><h5 class="tg-h">${esc(g.name)}<small class="muted">едет ${num(g.qty)} · продано ${num(g.sold)} · ждёт покупателя ${num(g.free)}</small></h5><ul class="mv">${g.ships.map(sh=>transitShip(sh,p)).join('')}</ul></div>`).join('');
}
// История резерва (Stock.history): поставлен, срок, снято / списано, срок вышел — кем и когда; раскрывается по нажатию
function histHtml(v){
  const r=S.reserves.find(x=>x.id===v.id),h=r?Stock.history(S,r,new Date()):[];
  if(!h.length) return '';
  return `<details class="rhist"><summary>История</summary><ol>${h.map(e=>`<li><span>${esc(e.text)}</span><small>${e.at?fWhen(e.at):'нет данных: когда'}${e.text.startsWith('Срок вышел')?'':' · '+esc(whoName(e.by)||'нет данных: кто')}</small></li>`).join('')}</ol></details>`;
}
// «Снятые резервы» — последние 20 по журналу (Stock.removed): для кого, сколько, где, кто поставил и кто снял
function removedHtml(p){
  const list=Stock.removed(S,p.id,20);
  if(!list.length) return '';
  const who=(id,at)=>`${id?esc(whoName(id)||'нет данных: кто'):noData('кто')}<small class="muted">${at?fWhen(at):'нет данных: когда'}</small>`;
  return `<div><h4 class="sh">Снятые резервы</h4><div class="xs"><table class="tbl"><thead><tr><th>Для кого</th><th class="num">Кол-во</th><th>Где</th><th>Поставил</th><th>Снял</th></tr></thead><tbody>${list.map(x=>`<tr><td>${x.doc?esc(Stock.docView(S,x.doc,S.me).replace(/^для: /,'')):noData('для кого')}</td><td class="num">${num(x.qty)}</td><td>${esc(x.src!=='stock'?'в пути: '+x.src:cellText(x.entityId,x.cityId))}</td><td>${who(x.by,x.at)}</td><td>${who(x.removedBy,x.removedAt)}${x.sold?'<small class="muted">списан при продаже</small>':''}</td></tr>`).join('')}</tbody></table></div><p class="hint">Последние 20 по журналу движений.</p></div>`;
}
// «Сообщить, когда появится»: кнопка, пока свободного нет; уведомление придёт один раз (Stock.notifyAppeared)
function watchHtml(p,k){
  if(k.free!==null&&k.free>0) return '';
  return Stock.watchOf(S,p.id,S.me)
    ?`<p class="hint m0">${ic('bell')}Сообщу, когда появится свободный. <button type="button" class="link" data-act="stock-unwatch" data-pid="${esc(p.id)}">Не сообщать</button></p>`
    :`<p class="m0"><button type="button" class="btn sm" data-act="stock-watch" data-pid="${esc(p.id)}">${ic('bell')}Сообщить, когда появится</button></p>`;
}
// «Артикул» в карточке: сам артикул или «Артикул: нет данных» и кнопка «Изменить» (право catalog)
const skuRow=p=>{const k=Catalog.skuOf(p);return (k?`<b class="mono">${esc(k)}</b>`:`<span class="muted">${SKU_NONE}</span>`)+(can('catalog')?` <button type="button" class="link" data-act="product-sku" data-pid="${esc(p.id)}">${k?'Изменить':'Указать'}</button>`:'')};
// «Цена поставщика (Сибэлком): 467 ₽ на 07.09.2026» — это не наша цена продажи (она отдельной строкой «Цена»). Чего нет в таблице — «нет данных»
const supplierPriceHtml=p=>(p.supplierPrice==null?noData('цена поставщика'):`<b>${rub(p.supplierPrice)}</b> ${p.priceDate?'на '+snapRu(p.priceDate):'<span class="muted">дата цены: нет данных</span>'}`)+(p.supplier?'':' <span class="muted">поставщик: нет данных</span>');
function dProduct(p){
  const k=stockOf(p.id),rs=resOf(p.id).map(r=>Stock.reserveView(S,r,S.me)).filter(Boolean);const inc=Stock.incomingOf(S,p.id),all=S.moves.filter(m=>m.productId===p.id),mv=all.slice(0,10),unk=stockUnknown(k);
  const st=(l,v,c='',note='')=>`<div class="st"><span>${l}</span><b class="${c}">${v}</b>${note?`<small>${note}</small>`:''}</div>`;
  const kv=(l,v)=>`<dt>${l}</dt><dd>${v}</dd>`;
  const aside=x=>x===null?'нет данных':qtyOf(x,p);
  const url=/^https?:\/\//.test(p.url||'')?`<a class="link" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${Catalog.isSupplier(p)?'Карточка у поставщика':'Открыть на сайте'}</a>`:'';
  const info=[
    kv('Артикул',skuRow(p)),kv('Модель',esc(p.name)),kv('Бренд',p.brand?esc(p.brand):noData('бренд')),kv('Категория',esc(p.cat)+(can('catalog')?` <button type="button" class="link" data-act="product-cat" data-pid="${esc(p.id)}">Сменить категорию</button>`:'')),
    can('prices')?kv('Цена',p.price==null?noData('цена'):`<b>${rub(p.price)}</b><small>${p.src==='user'?'введена вручную':priceNote()}</small>`):'',
    can('prices')&&Catalog.isSupplier(p)?kv(p.supplier?`Цена поставщика (${esc(p.supplier)})`:'Цена поставщика',supplierPriceHtml(p)):'',
    kv('Наличие',p.avail?esc(p.avail):noData('наличие')),url?kv(Catalog.isSupplier(p)?'Карточка поставщика':'Ссылка',url):''
  ].join('');
  // резерв видит каждый, у кого есть право на остатки: сколько, где и до какого числа. Сделку и клиента называет
  // Stock.reserveView только тому, кому сделка видна; остальным — «сделка скрыта», без ссылки и без кнопок «Снять» и «Списать»
  const acts=can('reserve')||can('sell');
  const dealCell=v=>v.forWho&&!v.hasDeal?`${esc(v.forWho)}<small class="muted">без сделки</small>`:v.deal?`${can('clients')?`<button class="link" data-act="open-deal" data-id="${esc(v.deal.id)}">${esc(v.deal.id)}</button>`:esc(v.deal.id)}<small class="muted">${esc(v.deal.client||'')}</small>`:v.hasDeal?`<span class="muted">${Stock.HIDDEN_DEAL}</span>`:noData('сделка')+(v.note?`<small class="muted">${esc(v.note)}</small>`:'');
  // кнопки — не у резерва скрытой сделки; резерв без сделки (из переноса остатков) можно снять и списать
  const rBtns=v=>v.hasDeal&&!v.deal?'':`<div class="rbtns">${can('reserve')?`<button type="button" class="btn sm ghost" data-act="reserve-until" data-id="${esc(v.id)}">Срок</button>`:''}${!v.inTransit&&can('sell')?`<button type="button" class="btn sm" data-act="stock-sell" data-pid="${esc(v.productId)}" data-rid="${esc(v.id)}">Списать</button>`:''}${can('reserve')?`<button class="btn sm ghost" data-act="unreserve" data-id="${esc(v.id)}">Снять</button>`:''}</div>`;
  const rTbl=rs.length?`<div class="xs"><table class="tbl"><thead><tr><th>Для кого</th><th class="num">Кол-во</th><th>Где товар</th><th>До</th><th>Кто поставил</th><th>Когда</th>${acts?'<th></th>':''}</tr></thead><tbody>${rs.map(v=>{const n=v.until?dd(v.until):null;return `<tr><td>${dealCell(v)}${histHtml(v)}</td><td class="num">${num(v.qty)}</td><td>${srcPill(v)}<small class="muted">${esc(v.where)}</small></td><td class="nowrap ${n!==null&&n<=2?'warn-t':''}">${v.until?fD(v.until):noData('срок')}</td><td>${v.by?esc(whoName(v.by)||'нет данных: кто'):noData('кто')}</td><td class="nowrap">${v.at?fWhen(v.at):noData('когда')}</td>${acts?`<td class="num">${rBtns(v)}</td>`:''}</tr>`}).join('')}</tbody></table></div>`:'<p class="muted m0">Резервов нет.</p>';
  const iList=inc.length?`<ul class="mv">${inc.map(x=>iRow(x,p)).join('')}</ul>`:'<p class="muted m0">Поставок с этим товаром нет.</p>';
  const mList=mv.length?`<ul class="mv">${mv.map(m=>`<li>${movePill(m)}<b>${moveSign(m)}${qtyOf(m.qty,p)}</b><span>${esc(moveWhere(m))}</span><span class="mono muted">${esc(moveDoc(m))}</span><small>${fWhen(m.at)} · ${esc(whoName(m.by)||'нет данных: кто')}</small></li>`).join('')}</ul><p class="m0"><button type="button" class="btn sm" data-act="stock-journal" data-pid="${esc(p.id)}">Весь журнал по товару${all.length>mv.length?` (${all.length})`:''}</button></p>`:'<p class="muted m0">Движений пока нет.</p>';
  return {kind:p.cat,title:esc(p.name),sub:[p.inCatalog?'':'нет в каталоге',p.brand?esc(p.brand):''].filter(Boolean).join(' · '),body:`
    ${photoBlock(p)}
    <div><h4 class="sh">Карточка каталога</h4><dl class="kv">${info}</dl></div>
    <div class="pst">${st('На складе',k.known?qtyOf(k.onHand,p):'нет данных')}${st('В резерве',num(k.reservedStock+k.reservedIncoming),'',k.reservedIncoming?`со склада ${num(k.reservedStock)}, под поставки ${num(k.reservedIncoming)}`:'')}${st('Свободно сейчас',unk?'нет данных':num(k.free),unk?'':k.free<=0?'bad-t':'ok-t')}${st('Свободно после прихода',unk?'нет данных':num(k.freeAfter),k.freeAfter<0?'bad-t':'',k.incoming?`едет ${num(k.incoming)}`:'')}</div>
    ${sbar(p,true)}
    ${watchHtml(p,k)}
    <div><h4 class="sh">Склады: юрлицо × город</h4>${gridHtml(p)}${k.known?'':'<p class="hint">По этому товару в таблице остатков чисел нет: в клетках стоят нули вместо «нет данных».</p>'}<p class="hint">Источник: ${stockNote()}. Резерв под поставку сюда не входит: товара на складе ещё нет. Движения в CRM после снимка — в журнале ниже.</p></div>
    <div><h4 class="sh">Не входит в свободный остаток</h4><div class="pst">${st('Ответхранение',aside(k.custody),'','считать ли в свободном — нет данных')}${st('В пути (из таблицы)',aside(k.transitNoShip),'','без поставки в CRM')}${st('Бой',aside(k.damaged))}</div></div>
    ${reserveForm(p,k,inc)}
    <div id="p-reserves"><h4 class="sh">Резервы</h4>${rTbl}</div>
    ${removedHtml(p)}
    ${sellCells(p)}
    <div id="p-transit"><h4 class="sh">В пути</h4>${transitHtml(p)}</div>
    <div><h4 class="sh">Журнал движений</h4>${mList}</div>`};
}

// ——— «Списать при продаже» ———
// Из карточки товара (клетка или резерв) и из строки товара в сделке. o: {pid, e?, c? (клетка), rid? (резерв), did? (сделка)}.
// Всё решает Stock.sell: право sell, остаток клетки за вычетом чужих резервов, резерв; здесь — окно и подсказка.
// Откуда списывать: резерв (его клетка) или клетка «юрлицо × город» с остатком. Значение выбора: 'r:<резерв>' или 'c:<юрлицо>|<город>'.
function sellSources(o){
  const out=[],rs=S.reserves.filter(r=>r.productId===o.pid&&r.src==='stock'&&(o.rid?r.id===o.rid:!!o.did&&r.dealId===o.did));
  rs.forEach(r=>out.push(['r:'+r.id,`Резерв ${r.dealId||r.id}: ${num(r.qty)} · ${cellText(r.entityId,r.cityId)}`]));
  if(!o.rid){const g=Stock.grid(S,o.pid);g.rows.forEach(r=>g.cols.forEach(c=>{const n=g.cell(r.id,c.id);if(n>0) out.push(['c:'+r.id+'|'+c.id,`Из клетки ${r.name} · ${c.name}: лежит ${num(n)}`])}))}
  return out;
}
function sellArg(pid,v){
  const s=String(v||''),i=s.indexOf(':'),k=s.slice(0,i),x=s.slice(i+1);
  if(k==='r') return {productId:pid,reserveId:x};
  const [e,c]=x.split('|');
  return {productId:pid,entityId:e,cityId:c};
}
function sellMaxText(pid,v){
  const a=sellArg(pid,v),max=Stock.sellMax(S,a);
  if(a.reserveId) return `Можно списать: ${num(max)} — столько осталось в резерве.`;
  const have=Stock.grid(S,pid).cell(a.entityId||Stock.ANY,a.cityId||Stock.ANY)??0;
  return `Можно списать: ${num(max)}${have>max?` — ещё ${num(have-max)} в клетке занято резервами, их списывают по резерву`:''}.`;
}
MODALS.stockSell=o=>{
  const p=product(o.pid),src=p?sellSources(o):[];
  if(!p||!src.length) return `${mHead('Списать при продаже')}<div class="modal-b"><p class="m0">${p?'Списать нечего: на складе этого товара нет остатка и резерва со склада.':'Такого товара нет.'}</p></div>`;
  const dealRs=o.did?src.find(x=>x[0][0]==='r'):null;
  const want=o.rid?'r:'+o.rid:dealRs?dealRs[0]:o.e!==undefined?`c:${o.e}|${o.c}`:'c:'+Stock.bestCell(S,o.pid).entityId+'|'+Stock.bestCell(S,o.pid).cityId;
  const cur=src.some(x=>x[0]===want)?want:src[0][0],a=sellArg(o.pid,cur),r=a.reserveId?S.reserves.find(x=>x.id===a.reserveId):null;
  const d=o.did?Deals.byId(S,o.did):null,max=Stock.sellMax(S,a);
  const qty=Math.max(1,Math.min(max,r?r.qty:d?Deals.lined(d,o.pid):1));
  const doc=r?(r.dealId||''):(o.did||'');
  return `<form data-form="stock-sell" data-pid="${esc(o.pid)}" data-did="${esc(o.did||'')}" novalidate>${mHead('Списать при продаже: '+esc(Catalog.label(p)))}<div class="modal-b">
    <p class="m0">${o.did?`Сделка ${esc(o.did)}${d?' · '+esc(d.client):''}. `:''}Товар уходит со склада, в журнале движений появится «Отгрузка».</p>
    <div class="field"><label for="ps-src">Откуда</label><select id="ps-src" class="inp" data-on="sellsrc" data-pid="${esc(o.pid)}">${optionsHtml(src,cur)}</select></div>
    <div class="grid2"><div class="field"><label for="ps-qty">Сколько${p.unit?', '+esc(p.unit):''}</label><input id="ps-qty" class="inp" type="number" min="1" step="1" value="${esc(qty)}" inputmode="numeric"></div>
      <div class="field"><label for="ps-doc">Документ</label><input id="ps-doc" class="inp" value="${esc(doc)}" placeholder="Номер сделки или накладной" autocomplete="off"></div></div>
    <p class="hint" id="ps-max">${esc(sellMaxText(o.pid,cur))}</p>
    <p class="err" id="ps-err" hidden></p></div>${mFoot('Списать')}</form>`;
};

// ——— «Оприходовать товар»: приход без поставки списком из Excel ———
// Три шага в одном окне: вставили список → проверили, что решено по каждой строке → провели. Разбор, сопоставление и проведение —
// Import.receiptRows / receiptPlan / applyReceipt (48-import.js): здесь только показ. Список живёт в RCPT (не в S: не сохраняется).
// Склад один на город; юрлица — из справочника. Новые товары создаёт только тот, у кого есть право catalog.
let RCPT=null;
const rcptNew=()=>({stage:'input',tab:'paste',text:'',rows:[],header:null,entityId:'',cityId:'',cat:'',done:null,manual:[{pid:'',q:'',isNew:false,newName:'',sku:'',qty:'',entity:'',city:''}]});
const rcptPlan=()=>Import.receiptPlan(S,RCPT.rows,{entityId:RCPT.entityId,cityId:RCPT.cityId,cat:RCPT.cat,canCreate:can('catalog')});
const rcptOpts=(list,cur)=>`<option value="">выберите</option>`+list.map(x=>`<option value="${esc(x.id)}"${x.id===cur?' selected':''}>${esc(x.name)}</option>`).join('');
// «Всё это приходит на»: подставляется строкам списка, у которых нет своих юрлица и склада
const rcptTo=()=>`<div class="grid2 rc-to"><div class="field"><label for="rc-ent">Всё это приходит на: юрлицо</label><select id="rc-ent" class="inp" data-on="rcpt-def" data-f="entityId">${rcptOpts(S.entities,RCPT.entityId)}</select></div><div class="field"><label for="rc-city">Склад (город)</label><select id="rc-city" class="inp" data-on="rcpt-def" data-f="cityId">${rcptOpts(S.cities,RCPT.cityId)}</select></div></div>`;
const RC_PLACEHOLDER='Например (артикул или название, количество, юрлицо и склад — по желанию):&#10;Солнечная панель 550 Вт\t20\tИП\tИркутск&#10;Кабель PV 4 мм2\t100';
// Пример для инструкции: три строки на настоящих названиях из номенклатуры (покороче, чтобы читались); вторая — по артикулу, если он у товара есть
function rcptExample(){
  const all=S.products.filter(p=>p.name),short=all.filter(p=>p.name.length<=60),ps=(short.length>=3?short:all).slice(0,3);
  // юрлицо и склад — в каждой строке, чтобы пример разобрался сам, без выбора «всё это приходит на»; первая и вторая строки — на одно юрлицо и город, третья — на другие
  const e=S.entities[0],c=S.cities[0],e2=S.entities[1]||e,c2=S.cities[1]||c,qty=[10,5,20];
  return ps.map((p,i)=>({id:i===1&&Catalog.skuOf(p)?Catalog.skuOf(p):p.name,qty:qty[i],entity:(i<2?e:e2)?.name||'',city:(i<2?c:c2)?.name||''}));
}
const rcptExampleText=()=>rcptExample().map(r=>[r.id,r.qty,r.entity,r.city].join('\t').replace(/\t+$/,'')).join('\n');
const RCPT_TABS=[['paste','Вставить список'],['manual','Ввести вручную']];
const rcptTabs=()=>'<div class="chips" role="tablist">'+RCPT_TABS.map(([k,t])=>'<button type="button" role="tab" class="fchip'+(RCPT.tab===k?' on':'')+'" aria-selected="'+(RCPT.tab===k)+'" data-act="rcpt-tab" data-tab="'+k+'">'+t+'</button>').join('')+'</div>';
function rcptPasteTab(){
  const ex=rcptExample();
  const exTbl=ex.length?'<div class="xs"><table class="tbl rc-ex"><thead><tr><th>Артикул или название</th><th class="num">Количество</th><th>Юрлицо</th><th>Склад</th></tr></thead><tbody>'+ex.map(r=>'<tr><td>'+esc(r.id)+'</td><td class="num">'+r.qty+'</td><td>'+esc(r.entity)+'</td><td>'+esc(r.city)+'</td></tr>').join('')+'</tbody></table></div><div><button type="button" class="btn sm" data-act="rcpt-example">Вставить пример</button></div>':'';
  return '<div class="rc-help"><p class="m0"><b>Колонки: Артикул или Название — Количество — Юрлицо — Склад</b> (юрлицо и склад можно не писать: тогда берётся то, что выбрано выше).</p>'
    +'<p class="hint m0">Столбцы можно копировать прямо из Excel: выделите их вместе со строками, нажмите Ctrl+C и вставьте сюда (Ctrl+V). Первая строка может быть заголовком. Товар ищется сперва по артикулу, потом по ключу, потом по названию. Остаток вырастет только после «Оприходовать» на следующем шаге.</p>'
    +exTbl+'</div>'
    +'<div class="field"><label for="rc-text">Вставьте список из Excel</label><textarea id="rc-text" class="inp rc-text" rows="8" placeholder="'+RC_PLACEHOLDER+'" spellcheck="false">'+esc(RCPT.text)+'</textarea></div>'
    +'<div><label class="btn" for="rc-file">'+ic('plus')+'Или выбрать файл CSV / TXT</label><input id="rc-file" class="sr" type="file" accept=".csv,.txt,text/csv,text/plain" data-on="rcpt-file"></div>';
}
// ——— вкладка «Ввести вручную»: строки таблицы, товар ищется по названию и артикулу ———
// Строки живут в RCPT.manual; «Проверить» превращает их в те же строки списка (Import.manualRows) и ведёт на тот же шаг проверки и ту же applyReceipt.
const rcmRow=()=>({pid:'',q:'',isNew:false,newName:'',sku:'',qty:'',entity:'',city:''});
const rcmSel=(list,cur,i,f,label)=>'<select class="inp" aria-label="'+label+', строка '+(i+1)+'" data-on="rcm-f" data-f="'+f+'" data-i="'+i+'"><option value="">как выше</option>'+list.map(x=>'<option value="'+esc(x.id)+'"'+(x.id===cur?' selected':'')+'>'+esc(x.name)+'</option>').join('')+'</select>';
// Результаты поиска под полем: до шести товаров (название, артикул, свободно) и «Новый товар», если есть право catalog
function rcmFound(r,i){
  const q=String(r.q||'').trim();
  if(q.length<2) return '';
  const hits=Catalog.query(S,{q}).slice(0,6);
  const list=hits.map(p=>'<button type="button" class="dpr" data-act="rcm-pick" data-i="'+i+'" data-pid="'+esc(p.id)+'"><span class="dpr-n">'+esc(p.name)+'</span><small>'+esc(skuText(p))+' · '+esc(dspFreeText(p.id))+'</small></button>').join('');
  const add=can('catalog')?'<button type="button" class="dpr" data-act="rcm-new" data-i="'+i+'"><span class="dpr-n">Новый товар «'+esc(q)+'»</span><small>завести в номенклатуре</small></button>':'';
  return list+add||'<p class="hint m0">В номенклатуре такого нет.</p>';
}
function rcmProduct(r,i){
  const p=r.pid?product(r.pid):null;
  if(p) return '<div class="rcm-pick"><span><b>'+esc(p.name)+'</b> '+skuTag(p)+'</span><button type="button" class="link" data-act="rcm-clear" data-i="'+i+'">Сменить</button></div>';
  if(r.isNew) return '<div class="rcm-new"><input class="inp" aria-label="Название нового товара, строка '+(i+1)+'" placeholder="Название нового товара" value="'+esc(r.newName)+'" data-on="rcm-f" data-f="newName" data-i="'+i+'" autocomplete="off">'
    +'<input class="inp" aria-label="Артикул нового товара, строка '+(i+1)+'" placeholder="Артикул (необязательно)" maxlength="'+Catalog.SKU_MAX+'" value="'+esc(r.sku)+'" data-on="rcm-f" data-f="sku" data-i="'+i+'" autocomplete="off">'
    +'<button type="button" class="link" data-act="rcm-clear" data-i="'+i+'">Выбрать из номенклатуры</button></div>';
  return '<div class="rcm-find"><input class="inp" type="search" aria-label="Товар, строка '+(i+1)+': название или артикул" placeholder="Название или артикул" value="'+esc(r.q)+'" data-on="rcm-q" data-i="'+i+'" autocomplete="off"><div class="dpres rcm-res" id="rcm-res-'+i+'">'+rcmFound(r,i)+'</div></div>';
}
const rcmTr=(r,i)=>'<tr id="rcm-r-'+i+'"><td class="num muted">'+(i+1)+'</td><td class="rcm-pc">'+rcmProduct(r,i)+'</td>'
  +'<td class="num"><input class="inp rc-q" inputmode="numeric" aria-label="Количество, строка '+(i+1)+'" value="'+esc(r.qty)+'" data-on="rcm-f" data-f="qty" data-i="'+i+'" autocomplete="off"></td>'
  +'<td class="rc-to-c">'+rcmSel(S.entities,r.entity,i,'entity','Юрлицо')+rcmSel(S.cities,r.city,i,'city','Склад (город)')+'</td>'
  +'<td><button type="button" class="btn ghost icon sm" data-act="rcm-del" data-i="'+i+'" aria-label="Убрать строку '+(i+1)+'">'+ic('x')+'</button></td></tr>';
function rcptManualTab(){
  return '<p class="m0">Выберите товар (поиск по названию и артикулу), впишите количество. Юрлицо и склад можно не выбирать: тогда берётся то, что выбрано выше. Нет такого товара — «Новый товар».</p>'
    +'<div class="xs"><table class="tbl rc-t"><thead><tr><th class="num">№</th><th>Товар</th><th class="num">Количество</th><th>Юрлицо и склад</th><th></th></tr></thead><tbody id="rcm-body">'+RCPT.manual.map(rcmTr).join('')+'</tbody></table></div>'
    +'<div><button type="button" class="btn sm" data-act="rcm-add">'+ic('plus')+'Добавить строку</button></div>';
}
function rcptInput(){
  const manual=RCPT.tab==='manual';
  return '<form data-form="'+(manual?'rcpt-manual':'rcpt-parse')+'" novalidate>'+mHead('Оприходовать товар')+'<div class="modal-b rcpt">'
    +'<p class="m0">Товар приехал без поставки? Внесите его списком из Excel или вручную. Остаток вырастет только после «Оприходовать» на следующем шаге.</p>'
    +rcptTabs()+rcptTo()+(manual?rcptManualTab():rcptPasteTab())
    +'<p class="err" id="rc-err" hidden></p></div>'+mFoot(manual?'Проверить':'Разобрать список')+'</form>';
}
// Одна строка предпросмотра: решение по товару — подпись и выбор («это тот же: …», «создать новый», «пропустить»)
function rcptDecision(L,r){
  const pill={found:'<span class="pill ok sm">найден</span>',picked:'<span class="pill ok sm">выбран</span>',new:'<span class="pill info sm">новый товар</span>',choose:'<span class="pill warn sm">выберите</span>',skip:'<span class="pill sm">пропущено</span>',error:'<span class="pill bad sm">ошибка</span>'}[L.status];
  const o=(v,t,sel)=>`<option value="${esc(v)}"${sel?' selected':''}>${esc(t)}</option>`;
  // что выбрано сейчас: пропуск, новый товар, один из похожих; найденный сам — пустое значение
  const sel=r.pick==='skip'?'skip':L.match==='found'?'':L.match==='new'?'new':L.match==='picked'?L.productId:'',opts=[];
  const withSku=(n,k)=>k?n+' (арт. '+k+')':n;
  opts.push(o('',L.match==='found'?'найден: '+withSku(L.productName,L.productSku):'— выберите —',sel===''));
  if(L.match!=='found'){
    for(const c of L.candidates) opts.push(o(c.id,'это тот же: '+withSku(c.name,c.sku),sel===c.id));
    if(can('catalog')) opts.push(o('new','создать новый товар',sel==='new'));
  }
  opts.push(o('skip','пропустить',sel==='skip'));
  const note=L.status==='error'?`<small class="bad-t">${esc(L.error)}</small>`:L.status==='found'||L.status==='picked'?`<small class="muted">${esc(withSku(L.productName,L.productSku))}</small>`:L.status==='new'?'<small class="muted">категория, цена и прочее — нет данных</small>':L.status==='choose'&&!L.candidates.length?'<small class="muted">похожих в номенклатуре нет</small>':'';
  // новый товар: в какую категорию его заводить (из дерева, «Без раздела» — по умолчанию или как выбрано выше для всех новых)
  const cat=L.status==='new'?`<select class="inp" aria-label="Категория нового товара, строка ${L.line}" data-on="rcpt-cat" data-i="${L.index}">${catOptions(L.cat||Catalog.NO_CAT,{noCat:true})}</select>`:'';
  return `${pill}${note}<select class="inp" aria-label="Что делать со строкой ${L.line}" data-on="rcpt-pick" data-i="${L.index}">${opts.join('')}</select>${cat}`;
}
function rcptRow(L,r){
  const cell=(list,raw,res,f)=>`<select class="inp" aria-label="${f==='entity'?'Юрлицо':'Склад (город)'}, строка ${L.line}" data-on="rcpt-f" data-f="${f}" data-i="${L.index}"><option value="">как выше</option>${list.map(x=>`<option value="${esc(x.id)}"${raw&&res===x.id?' selected':''}>${esc(x.name)}</option>`).join('')}${raw&&!res?`<option value="${esc(raw)}" selected>«${esc(raw)}» — нет в справочнике</option>`:''}</select>`;
  return `<tr id="rc-r-${L.index}" class="${L.status==='skip'?'rc-skip':''}"><td class="num muted">${L.line}</td>
    <td><input class="inp" aria-label="Название, строка ${L.line}" placeholder="Название" value="${esc(r.name)}" data-on="rcpt-f" data-f="name" data-i="${L.index}" autocomplete="off"><input class="inp rc-sku" aria-label="Артикул, строка ${L.line}" placeholder="Артикул" maxlength="${Catalog.SKU_MAX}" value="${esc(r.sku||'')}" data-on="rcpt-f" data-f="sku" data-i="${L.index}" autocomplete="off"></td>
    <td><div class="rc-dec" id="rc-st-${L.index}">${rcptDecision(L,r)}</div></td>
    <td class="num"><input class="inp rc-q" inputmode="numeric" aria-label="Количество, строка ${L.line}" value="${esc(r.qty)}" data-on="rcpt-f" data-f="qty" data-i="${L.index}" autocomplete="off"></td>
    <td class="rc-to-c">${cell(S.entities,str0(r.entity),L.entityId,'entity')}${cell(S.cities,str0(r.city),L.cityId,'city')}</td></tr>`;
}
const str0=v=>String(v==null?'':v).trim();
// Итог под таблицей: что будет оприходовано и что мешает
function rcptSum(P){
  const bits=[`Будет оприходовано: <b>${num(P.positions)}</b> ${pl(P.positions,'позиция','позиции','позиций')}, всего ${num(P.units)}, новых товаров: <b>${num(P.created)}</b>.`];
  if(P.skipped) bits.push(`Пропущено строк: ${num(P.skipped)}.`);
  const todo=P.errors+P.choose;
  const bad=todo?`<p class="warn-t m0">Не разобрано строк: <b>${num(todo)}</b>${P.errors?` (с ошибкой ${num(P.errors)})`:''}${P.choose?` (ждут выбора ${num(P.choose)})`:''}. Выберите товар, создайте новый, исправьте строку или пропустите её — тогда «Оприходовать» включится.</p>`:'';
  const warn=P.warnings.length?`<ul class="plain warn-t">${P.warnings.map(w=>`<li class="sm">Одинаковые строки: ${esc(w)}</li>`).join('')}</ul>`:'';
  const bulk=can('catalog')&&RCPT.rows.some((r,i)=>P.lines[i].status==='choose'&&!P.lines[i].candidates.length)?`<div><button type="button" class="btn sm" data-act="rcpt-all-new">Создать новыми все незнакомые, где похожих нет</button></div>`:'';
  return `<p class="m0">${bits.join(' ')}</p>${bad}${warn}${bulk}`;
}
function rcptCheck(){
  const P=rcptPlan(),h=RCPT.header;
  const newCat=can('catalog')&&P.lines.some(L=>L.match==='new')?`<div class="field rc-cat"><label for="rc-cat">Новые товары — в категорию</label><select id="rc-cat" class="inp" data-on="rcpt-def" data-f="cat">${catOptions(RCPT.cat||Catalog.NO_CAT,{noCat:true})}</select></div>`:'';
  return `<form data-form="rcpt-go" novalidate>${mHead('Оприходовать товар: проверьте список')}<div class="modal-b rcpt">
    ${rcptTo()}${newCat}
    ${h?`<p class="hint m0">Первая строка принята за заголовок и не оприходуется: «${esc(h)}».</p>`:''}
    <div class="xs"><table class="tbl rc-t"><thead><tr><th class="num">№</th><th>Из списка</th><th>Что решено</th><th class="num">Количество</th><th>Куда (юрлицо, склад)</th></tr></thead><tbody id="rc-body">${P.lines.map(L=>rcptRow(L,RCPT.rows[L.index])).join('')}</tbody></table></div>
    <div class="stack-s" id="rc-sum">${rcptSum(P)}</div>
    <p class="err" id="rc-err" hidden></p></div>
    <div class="modal-f"><button type="button" class="btn" data-act="rcpt-back">Назад к списку</button><button type="button" class="btn" data-act="close-modal">Отмена</button><button type="submit" class="btn pri" id="rc-go"${P.ready?'':' disabled'}>Оприходовать</button></div></form>`;
}
function rcptDone(){
  const d=RCPT.done;
  return `${mHead('Оприходовано')}<div class="modal-b rcpt"><div class="done-box"><span class="done-ic">${ic('check')}</span>
    <h3 class="m0">Оприходовано ${num(d.positions)} ${pl(d.positions,'позиция','позиции','позиций')}, создано ${num(d.created)} ${pl(d.created,'новый товар','новых товара','новых товаров')}</h3>
    <p class="m0 muted">Остатки обновлены, в журнале движений — «${esc(Stock.KINDS.receive)}», документ «${esc(d.doc)}».</p>
    <div class="bar"><button type="button" class="btn pri" data-act="rcpt-journal">Открыть журнал движений</button><button type="button" class="btn" data-act="rcpt-again">Оприходовать ещё</button></div></div></div>
    <div class="modal-f"><button type="button" class="btn" data-act="close-modal">Закрыть</button></div>`;
}
MODALS.receipt=()=>{
  if(!RCPT) RCPT=rcptNew();
  return RCPT.stage==='done'?rcptDone():RCPT.stage==='check'?rcptCheck():rcptInput();
};
// Перерисовать окно целиком, не сбрасывая прокрутку
function rcptDraw(){
  const m=byId('modal-root').querySelector('.modal');
  if(!m||!S.ui.modal||S.ui.modal.type!=='receipt') return;
  const sc=m.scrollTop;m.innerHTML=MODALS.receipt();m.scrollTop=sc;
  const t=byId('rc-text');if(t&&RCPT.stage==='input') t.focus();
}
// Одна строка изменилась: пересчитать план, обновить её решение и итог. Поля строк не пересоздаются — фокус и ввод остаются.
function rcptRefresh(i){
  const P=rcptPlan(),L=P.lines[i],tr=byId('rc-r-'+i);
  if(L&&tr){tr.className=L.status==='skip'?'rc-skip':'';byId('rc-st-'+i).innerHTML=rcptDecision(L,RCPT.rows[i])}
  const s=byId('rc-sum');if(s) s.innerHTML=rcptSum(P);
  const g=byId('rc-go');if(g) g.disabled=!P.ready;
}
function rcptParse(){
  const t=byId('rc-text');if(t) RCPT.text=t.value;
  const r=Import.receiptRows(RCPT.text);
  if(r.problems.length) return showErr('rc-err',r.problems[0]);
  Object.assign(RCPT,{rows:r.rows,header:r.header,stage:'check'});rcptDraw();
}
A['rcpt-open']=()=>{
  if(!can('receive')){toast('У вашей роли нет права принимать товар на склад.','warn');return}
  RCPT=rcptNew();openModal('receipt');
};
A['rcpt-back']=()=>{RCPT.stage='input';rcptDraw()};
A['rcpt-tab']=el=>{const t=el.dataset.tab;if(!RCPT||!RCPT_TABS.some(x=>x[0]===t)) return;const x=RCPT.tab==='paste'&&RCPT.stage==='input'?byId('rc-text'):null;if(x) RCPT.text=x.value;RCPT.tab=t;rcptDraw()};
A['rcpt-example']=()=>{RCPT.text=rcptExampleText();rcptDraw()};
// Ручной ввод: строки в RCPT.manual, правка полей — без перерисовки (фокус остаётся), выбор товара и «+ строка» — перерисовка таблицы
const rcmDraw=()=>{const b=byId('rcm-body');if(b) b.innerHTML=RCPT.manual.map(rcmTr).join('')};
A['rcm-add']=()=>{RCPT.manual.push(rcmRow());rcmDraw()};
A['rcm-del']=el=>{const i=Number(el.dataset.i);RCPT.manual.splice(i,1);if(!RCPT.manual.length) RCPT.manual.push(rcmRow());rcmDraw()};
A['rcm-pick']=el=>{const r=RCPT.manual[Number(el.dataset.i)];if(!r) return;r.pid=el.dataset.pid;r.q='';r.isNew=false;rcmDraw()};
A['rcm-new']=el=>{const r=RCPT.manual[Number(el.dataset.i)];if(!r||!can('catalog')) return;r.isNew=true;r.pid='';r.newName=String(r.q||'').trim();r.q='';rcmDraw()};
A['rcm-clear']=el=>{const r=RCPT.manual[Number(el.dataset.i)];if(!r) return;r.pid='';r.isNew=false;r.q='';rcmDraw()};
ON.input['rcm-q']=t=>{const i=Number(t.dataset.i),r=RCPT.manual[i];if(!r) return;r.q=t.value;const o=byId('rcm-res-'+i);if(o) o.innerHTML=rcmFound(r,i)};
ON.input['rcm-f']=ON.change['rcm-f']=t=>{const r=RCPT.manual[Number(t.dataset.i)];if(r&&['newName','sku','qty','entity','city'].includes(t.dataset.f)) r[t.dataset.f]=t.value};
// «Проверить»: строки таблицы → строки списка (Import.manualRows) → тот же шаг проверки, что у вставки
FORMS['rcpt-manual']=()=>{
  const r=Import.manualRows(S,RCPT.manual);
  if(r.problems.length) return showErr('rc-err',r.problems[0]);
  Object.assign(RCPT,{rows:r.rows,header:null,stage:'check'});rcptDraw();
};
A['rcpt-again']=()=>{RCPT=rcptNew();rcptDraw()};
A['rcpt-all-new']=()=>{
  const P=rcptPlan();
  P.lines.forEach(L=>{if(L.status==='choose'&&!L.candidates.length) RCPT.rows[L.index].pick='new'});
  rcptDraw();
};
A['rcpt-journal']=()=>{
  closeModal();S.ui.stockTab='moves';S.ui.mvPid='';S.ui.mvKind=Stock.KINDS.receive;S.ui.drawer=null;go('stock');
};
FORMS['rcpt-parse']=()=>rcptParse();
// «Оприходовать»: Import.applyReceipt по тому же плану, что на экране; render() сохраняет изменения одним save()
FORMS['rcpt-go']=()=>{
  const r=Import.applyReceipt(S,RCPT.rows,{entityId:RCPT.entityId,cityId:RCPT.cityId,cat:RCPT.cat},S.me,new Date());
  if(!r.ok) return showErr('rc-err',r.reason);
  RCPT.done=r;RCPT.stage='done';
  render();rcptDraw();
  toast(`Оприходовано ${num(r.positions)} ${pl(r.positions,'позиция','позиции','позиций')}${r.created?`, новых товаров ${num(r.created)}`:''}.`);
};
ON.change['rcpt-def']=t=>{RCPT[t.dataset.f]=t.value;if(RCPT.stage==='check') rcptDraw()};
ON.change['rcpt-f']=t=>{
  const i=Number(t.dataset.i),r=RCPT.rows[i];if(!r) return;
  r[t.dataset.f]=t.value;
  // другое название или артикул — прежнее решение («это тот же», «новый») к ним уже не относится
  if(t.dataset.f==='name'||t.dataset.f==='sku') r.pick='';
  rcptRefresh(i);
};
ON.change['rcpt-pick']=t=>{const i=Number(t.dataset.i);if(RCPT.rows[i]){RCPT.rows[i].pick=t.value;rcptRefresh(i)}};
ON.change['rcpt-cat']=t=>{const i=Number(t.dataset.i);if(RCPT.rows[i]){RCPT.rows[i].cat=t.value;rcptRefresh(i)}};
// Файл CSV / TXT: тот же разбор кодировки, что у «Переноса» (Import.decode); текст ложится в поле и сразу разбирается
ON.change['rcpt-file']=async t=>{
  const f=t.files&&t.files[0];
  try{t.value=''}catch(_){}
  if(!f||!RCPT) return;
  try{RCPT.text=Import.decode(new Uint8Array(await f.arrayBuffer()));const a=byId('rc-text');if(a) a.value=RCPT.text;rcptParse()}
  catch(_){showErr('rc-err','Файл не прочитан.')}
};

// ——— регистрация в реестрах оболочки ———
SEARCH.push({kind:'product',label:'Товар',order:10,find:q=>!can('stock')?[]:Catalog.query(S,{q}).slice(0,6).map(p=>{const k=stockOf(p.id);return {title:p.name,sub:skuText(p)+' · '+(k.known?`свободно ${qtyOf(k.free,p)}`:'остаток: нет данных'),open:`data-act="open-product" data-pid="${esc(p.id)}"`}})});
DRAWERS.product=id=>{const p=can('stock')?product(id):null;return p?dProduct(p):null};
regRef('product','товар',id=>!!product(id),'open-product','pid');
ON.input.sq=t=>{S.ui.sq=t.value;refreshStock()};
ON.change.deficit=t=>{S.ui.deficit=t.checked;refreshStock()};
ON.change.brand=t=>{S.ui.brand=t.value;refreshStock()};
ON.change.avail=t=>{S.ui.avail=t.value;refreshStock()};
ON.change.catf=t=>{S.ui.catf=t.value;refreshStock()};
// Выпадающий список «Сортировка» и нажатие на название столбца меняют одно и то же — S.ui.sort
ON.change.sort=t=>{const [col,dir]=String(t.value).split(':');S.ui.sort=col?{col,dir:dir==='desc'?'desc':'asc'}:null;S.ui.page=0;S.ui.span=1;refreshStock()};
A['tbl-sort']=el=>{
  if(el.dataset.tbl!=='goods') return;
  S.ui.sort=sortToggle(S.ui.sort,el.dataset.cw);S.ui.page=0;S.ui.span=1;refreshStock();
  const sel=byId('f-sort');if(sel) sel.value=sortKey(S.ui.sort);
};
ON.change.mvpid=t=>{S.ui.mvPid=t.value;byId('mv-tbl').innerHTML=movesTable()};
ON.change.mvkind=t=>{S.ui.mvKind=t.value;byId('mv-tbl').innerHTML=movesTable()};
// Выбрали другую клетку или поставку в форме резерва — подсказка «можно поставить» пересчитывается
ON.change.rsmax=()=>{
  const d=S.ui.drawer,out=byId('rs-max');
  if(!d||d.type!=='product'||!out) return;
  out.textContent=maxText(d.id,byId('rs-src').value,byId('rs-ent').value,byId('rs-city').value);
};
A['stock-sell']=el=>{
  if(!can('sell')){toast('У вашей роли нет права списывать товар при продаже.','warn');return}
  const d=el.dataset;
  openModal('stockSell',{pid:d.pid,e:d.e,c:d.c,rid:d.rid,did:d.did});
};
// Выбрали другую клетку или резерв в окне списания — подсказка «можно списать» пересчитывается
ON.change.sellsrc=t=>{const out=byId('ps-max');if(out) out.textContent=sellMaxText(t.dataset.pid,t.value)};
FORMS['stock-sell']=f=>{
  const pid=f.dataset.pid,now=new Date(),arg=sellArg(pid,byId('ps-src').value);
  // по резерву: лента его сделки помнит резерв (Deals.keepTrail) — даже когда списание снимет его целиком
  const rs=arg.reserveId?S.reserves.find(x=>x.id===arg.reserveId):null,did=f.dataset.did||(rs&&rs.dealId)||'';
  if(rs) Deals.keepTrail(S,rs);
  const r=Stock.sell(S,{...arg,qty:byId('ps-qty').value,doc:byId('ps-doc').value.trim()},S.me,now);
  if(!r.ok) return showErr('ps-err',r.reason);
  const p=product(pid),m=r.move,what=`${low(Catalog.label(p))} — ${qtyOf(m.qty,p)} со склада ${cellText(m.entityId,m.cityId)}`;
  // из сделки или по резерву сделки: в её ленте остаётся запись о списании
  if(did) Feed.add(S,{t:'deal',id:did},{kind:'item',text:`Списано при продаже: ${what}${r.reserve?' (по резерву)':''}.`,by:S.me,at:now,data:r.reserve?{reserveId:r.reserve.id,sold:true}:undefined});
  closeModal();render();
  toast(`Списано при продаже: ${what}. Запись в журнале есть.`);
};
// Бейдж «N резервов» в номенклатуре — карточка товара сразу на списке резервов
// Клик по «резерв N» в таблице карточки: прокрутить эту же карточку к списку резервов (карточку заново не открываем)
// «Ждёт покупателя N» в таблице: прокрутить карточку к списку поставок в пути (какая едет, когда ждём)
A['transit-jump']=el=>{const e=el&&el.dataset?el.dataset.e:'',t=(e&&byId('p-transit-'+e))||byId('p-transit');if(t&&t.scrollIntoView) t.scrollIntoView({block:'start',behavior:'smooth'})};
A['reserves-jump']=()=>{const t=byId('p-reserves');if(t&&t.scrollIntoView) t.scrollIntoView({block:'start',behavior:'smooth'})};
A['product-reserves']=el=>{openDrawer('product',el.dataset.id);const t=byId('p-reserves');if(t&&t.scrollIntoView) t.scrollIntoView({block:'start'})};
ON.change.rskind=t=>{const free=t.value==='free',a=byId('rs-deal-f'),b=byId('rs-for-f');if(a) a.hidden=free;if(b) b.hidden=!free};
A['stock-watch']=el=>{const r=Stock.watch(S,el.dataset.pid,S.me,new Date());if(!r.ok) return toast(r.reason,'warn');render();toast('Сообщу, когда товар появится: уведомление придёт один раз.')};
A['stock-unwatch']=el=>{Stock.unwatch(S,el.dataset.pid,S.me);render();toast('Не сообщаю об этом товаре.')};
// «Срок» у резерва: окно с датой; Stock.extend пишет смену в историю резерва
A['reserve-until']=el=>openModal('reserveUntil',el.dataset.id);
MODALS.reserveUntil=id=>{
  const r=S.reserves.find(x=>x.id===id),p=r&&product(r.productId);
  if(!r) return `${mHead('Срок резерва')}<div class="modal-b"><p class="m0">Резерва уже нет.</p></div>`;
  return `<form data-form="reserve-until" data-id="${esc(id)}" novalidate>${mHead('Срок резерва: '+esc(Catalog.label(p)))}<div class="modal-b">
    <p class="m0">${num(r.qty)} · ${esc(Stock.forText(S,r,S.me))}. Сейчас — ${r.until?'до '+fD(r.until):'нет данных: срок'}.</p>
    <div class="field"><label for="ru-until">Резерв до</label><input id="ru-until" class="inp" type="date" value="${esc(iso(r.until||day(Stock.RESERVE_DAYS)))}"></div>
    <p class="err" id="ru-err" hidden></p></div>${mFoot('Сохранить')}</form>`;
};
FORMS['reserve-until']=f=>{
  const v=byId('ru-until').value,r=Stock.extend(S,f.dataset.id,v?fromIso(v):null,S.me,new Date());
  if(!r.ok) return showErr('ru-err',r.reason);
  closeModal();render();toast(`Срок резерва — до ${fD(r.reserve.until)}. В истории резерва есть запись.`);
};
A['stock-tab']=el=>{S.ui.stockTab=el.dataset.tab;render()};
// Выбрали категорию: она раскрывается вместе с родителями, на узком экране дерево сворачивается обратно под кнопку
// Выбор категории в дереве — вся категория, бренд сбрасывается (бренд узла выбирается своей строкой: stock-brand)
A['stock-cat']=el=>{
  const c=el.dataset.cat;
  S.ui.cat=c;S.ui.brand='';S.ui.page=0;S.ui.span=1;S.ui.catPane=false;
  catOpenBranch(c);
  render();
};
// Узел-бренд: категория + бренд — то же, что выбрать их в списке «Бренд»
A['stock-brand']=el=>{
  const c=el.dataset.cat;
  S.ui.cat=c;S.ui.brand=el.dataset.brand;S.ui.page=0;S.ui.span=1;S.ui.catPane=false;fixBrand();
  catOpenBranch(c);
  render();
};
A['cat-toggle']=el=>{const o=S.ui.catOpen||(S.ui.catOpen={}),c=el.dataset.cat;o[c]=!catIsOpen(c);render()};
A['cat-pane']=()=>{S.ui.catPane=!S.ui.catPane;render()};

// ——— «Категории»: добавить, переименовать, перенести, удалить пустую ———
// Дерево ведёт Catalog (catAdd / catEdit / catDelete): он же обновляет пути товаров, здесь только окна. Одно действие — один save() (render).
const catCount=(n,one,few,many)=>`${num(n)} ${pl(n,one,few,many)}`;
const catNodeId=path=>{const n=path?Catalog.nodeOf(S,path):null;return n?n.id:''};
MODALS.categories=()=>{
  const rows=Catalog.rows(S).filter(r=>!r.virtual);
  return `<form data-form="cat-add" novalidate>${mHead('Категории товаров')}<div class="modal-b">
    <p class="m0">Список «Товары и остатки» строится по этим категориям. Например: «Электрика» → «Автоматы» → «АВР». Категория бывает верхнего уровня или внутри другой.</p>
    <div class="grid2"><div class="field"><label for="ct-name">Название новой категории</label><input id="ct-name" class="inp" maxlength="100" autocomplete="off" placeholder="Например: Автоматы"></div>
      <div class="field"><label for="ct-parent">Куда добавить</label><select id="ct-parent" class="inp">${catOptions(S.ui.catPick||'',{top:'Верхний уровень'})}</select></div></div>
    <p class="err" id="ct-err" hidden></p>
    <h4 class="sh">Все категории</h4>
    ${rows.length?`<ul class="ct-mlist">${rows.map(r=>`<li style="--d:${r.depth}"><span class="ct-mn">${esc(r.name)}</span><small class="muted">${catCount(r.total,'товар','товара','товаров')}</small><button type="button" class="btn sm ghost" data-act="cat-edit" data-id="${esc(r.id)}">Изменить</button></li>`).join('')}</ul>`:'<p class="muted m0">Категорий пока нет.</p>'}</div>
    <div class="modal-f"><button type="button" class="btn" data-act="close-modal">Закрыть</button><button type="submit" class="btn pri">${ic('plus')}Добавить категорию</button></div></form>`;
};
// Перерисовать окно, не закрывая его (после добавления, правки, удаления)
function catDraw(){
  const m=byId('modal-root').querySelector('.modal'),t=S.ui.modal&&S.ui.modal.type;
  if(!m||(t!=='categories'&&t!=='catEdit')) return;
  m.innerHTML=MODALS[t](S.ui.modal.id);
}
A['cat-manage']=()=>{if(!can('catalog')){toast('У вашей роли нет права менять категории.','warn');return}openModal('categories')};
FORMS['cat-add']=()=>{
  const parent=byId('ct-parent').value,r=Catalog.catAdd(S,{name:byId('ct-name').value,parentId:catNodeId(parent)});
  if(!r.ok) return showErr('ct-err',r.reason);
  S.ui.catPick=parent;
  const o=S.ui.catOpen||(S.ui.catOpen={});for(const a of catAncestors(r.path)) o[a]=true;
  render();catDraw();
  const n=byId('ct-name');if(n) n.focus();
  toast(`Категория «${r.path}» добавлена.`);
};
MODALS.catEdit=id=>{
  const n=(S.categories||[]).find(c=>c.id===id);
  if(!n) return `${mHead('Категория')}<div class="modal-b"><p class="m0">Такой категории уже нет.</p></div><div class="modal-f"><button type="button" class="btn" data-act="cat-back">К списку категорий</button></div>`;
  const b=Catalog.busy(S,id),busy=b.products||b.children;
  return `<form data-form="cat-edit" data-id="${esc(id)}" novalidate>${mHead('Категория «'+esc(n.name)+'»')}<div class="modal-b">
    <p class="m0 muted">Сейчас: ${esc(b.path)} · ${catCount(b.products,'товар','товара','товаров')}, ${catCount(b.children,'подкатегория','подкатегории','подкатегорий')}.</p>
    <div class="grid2"><div class="field"><label for="ce-name">Название</label><input id="ce-name" class="inp" maxlength="100" value="${esc(n.name)}" autocomplete="off"></div>
      <div class="field"><label for="ce-parent">Внутри</label><select id="ce-parent" class="inp">${catOptions(catParent(b.path),{top:'Верхний уровень',skipId:id})}</select></div></div>
    <p class="hint">Новое название и новое место сразу меняют категорию у всех товаров внутри.</p>
    <p class="hint">${busy?'Удалить можно только пустую категорию: сначала перенесите или удалите товары и подкатегории.':'Категория пустая — её можно удалить.'}</p>
    <p class="err" id="ce-err" hidden></p></div>
    <div class="modal-f"><button type="button" class="btn ghost" data-act="cat-del" data-id="${esc(id)}"${busy?' disabled':''}>Удалить</button><span class="ct-sp"></span><button type="button" class="btn" data-act="cat-back">К списку</button><button type="submit" class="btn pri">Сохранить</button></div></form>`;
};
A['cat-edit']=el=>openModal('catEdit',el.dataset.id);
A['cat-back']=()=>openModal('categories');
FORMS['cat-edit']=f=>{
  const id=f.dataset.id,before=S.ui.cat,was=Catalog.pathOf(S,id);
  const r=Catalog.catEdit(S,id,{name:byId('ce-name').value,parentId:catNodeId(byId('ce-parent').value)});
  if(!r.ok) return showErr('ce-err',r.reason);
  // выбранная в списке категория поехала вместе с переименованной — выбор остаётся на ней
  if(before===was||String(before).startsWith(was+Catalog.SEP)) S.ui.cat=r.now+String(before).slice(was.length);
  const o=S.ui.catOpen||{},moved={};
  for(const k of Object.keys(o)) moved[k===was||k.startsWith(was+Catalog.SEP)?r.now+k.slice(was.length):k]=o[k];
  S.ui.catOpen=moved;
  render();openModal('categories');
  toast(r.moved?`Категория: «${r.now}». Пути у товаров обновлены: ${num(r.moved)}.`:`Категория: «${r.now}».`);
};
A['cat-del']=el=>{
  const r=Catalog.catDelete(S,el.dataset.id);
  if(!r.ok){const e=byId('ce-err');if(e){e.textContent=r.reason;e.hidden=false}return}
  if(S.ui.cat===r.path) S.ui.cat=CAT_ALL;
  render();openModal('categories');
  toast(`Категория «${r.path}» удалена.`);
};
// «Сменить категорию» в карточке товара
MODALS.productCat=pid=>{
  const p=product(pid);
  if(!p) return `${mHead('Категория товара')}<div class="modal-b"><p class="m0">Такого товара нет.</p></div>`;
  return `<form data-form="product-cat" data-pid="${esc(pid)}" novalidate>${mHead('Категория товара')}<div class="modal-b">
    <p class="m0">${esc(Catalog.label(p))}</p>
    <div class="field"><label for="pc-cat">Категория</label><select id="pc-cat" class="inp">${catOptions(p.cat,{noCat:true})}</select></div>
    <p class="err" id="pc-err" hidden></p></div>${mFoot('Сохранить')}</form>`;
};
A['product-cat']=el=>{if(!can('catalog')){toast('У вашей роли нет права менять категорию товара.','warn');return}openModal('productCat',el.dataset.pid)};
FORMS['product-cat']=f=>{
  const r=Catalog.setCat(S,f.dataset.pid,byId('pc-cat').value);
  if(!r.ok) return showErr('pc-err',r.reason);
  closeModal();render();toast(`Категория товара: «${r.product.cat}».`);
};
// ——— артикул товара: «Изменить» в карточке ———
// Такой же артикул у другого товара — предупреждение, не запрет (слово директора: артикул — поле, а не ключ). Текст общий с формой «Новый товар».
const skuDupText=(sku,exceptId)=>{
  const same=Catalog.bySku(S,sku,exceptId);
  return same.length?'Внимание: такой артикул уже есть у '+same.slice(0,3).map(x=>'«'+x.name+'»').join(', ')+(same.length>3?' и ещё '+(same.length-3):'')+'. Сохранить можно.':'';
};
MODALS.productSku=pid=>{
  const p=product(pid);
  if(!p) return `${mHead('Артикул товара')}<div class="modal-b"><p class="m0">Такого товара нет.</p></div>`;
  return `<form data-form="product-sku" data-pid="${esc(pid)}" novalidate>${mHead('Артикул товара')}<div class="modal-b">
    <p class="m0">${esc(p.name)}</p>
    <div class="field"><label for="ps-sku">Артикул</label><input id="ps-sku" class="inp" maxlength="${Catalog.SKU_MAX}" value="${esc(Catalog.skuOf(p))}" data-on="sku-dup" data-pid="${esc(pid)}" data-hint="ps-dup" autocomplete="off" placeholder="Пусто — «${SKU_NONE}»"></div>
    <p class="hint warn-t" id="ps-dup" aria-live="polite" hidden></p>
    <p class="err" id="ps-err" hidden></p></div>${mFoot('Сохранить')}</form>`;
};
// ——— «Создать товар» там, где его не нашли: сделка, новая поставка, заявка на отправку ———
// Слова директора: товара, которого нет в номенклатуре, приходится заводить вручную, а нужен он, когда подбираешь станцию. Окно одно на три места:
// pqOpen(название, then). Оно лежит в своём слое #pq-root поверх открытой формы (форма поставки и заявки не теряет введённого).
// «Создать» — Catalog.add (как форма «Новый товар», право catalog) и then(товар) — строка в сделку / в поставку / в заявку — одним действием:
// render() один раз сохраняет всё. then не смог (сделки нет, нет прав) — товар и новые узлы дерева откатываются, окно остаётся с ошибкой.
// then(товар) → {ok, msg?} | {ok:false, reason}.
let PQ=null;
const pqClose=()=>{PQ=null;byId('pq-root').innerHTML=''};
function pqHtml(name){
  return `<form data-form="pq" novalidate><div class="modal-h"><h3>Новый товар</h3><button type="button" class="btn ghost icon" data-act="pq-close" aria-label="Закрыть">${ic('x')}</button></div><div class="modal-b">
    <p class="hint m0">Товар попадёт в номенклатуру. Цена и остаток у него — «нет данных»: их можно указать позже.</p>
    <div class="field"><label for="pq-name">Наименование</label><input id="pq-name" class="inp" value="${esc(name)}" autocomplete="off"></div>
    <div class="grid2"><div class="field"><label for="pq-sku">Артикул</label><input id="pq-sku" class="inp" maxlength="${Catalog.SKU_MAX}" data-on="sku-dup" data-hint="pq-dup" autocomplete="off" placeholder="Необязательно"></div><div class="field"><label for="pq-unit">Единица</label><select id="pq-unit" class="inp"><option>шт</option><option>м</option><option>пар</option><option>компл.</option></select></div></div>
    <p class="hint warn-t" id="pq-dup" aria-live="polite" hidden></p>
    <div class="field"><label for="pq-cat">Категория</label><select id="pq-cat" class="inp">${catOptions(Catalog.NO_CAT,{noCat:true})}</select></div>
    <p class="err" id="pq-err" hidden></p></div><div class="modal-f"><button type="button" class="btn" data-act="pq-close">Отмена</button><button type="submit" class="btn pri">Создать и добавить</button></div></form>`;
}
function pqOpen(name,then){
  PQ={then};
  byId('pq-root').innerHTML=`<div class="modal-wrap pq-wrap"><div class="modal" role="dialog" aria-modal="true">${pqHtml(String(name||''))}</div></div>`;
  setTimeout(()=>{const n=byId('pq-name');if(n&&n.focus) n.focus()},30);
}
// Мелкая ссылка «Создать „…“ в каталоге …» под результатами поиска; без права catalog её нет
const pqLink=(kind,label,o={})=>can('catalog')?`<button type="button" class="link sm pq-link" data-act="pq-open" data-kind="${kind}"${o.id?` data-id="${esc(o.id)}"`:''} data-name="${esc(o.name||'')}">${esc(label)}</button>`:'';
A['pq-open']=el=>{
  if(!can('catalog')){toast('У вашей роли нет права добавлять товары.','warn');return}
  const d=el.dataset;
  const then={
    deal:p=>{const r=Deals.addItem(S,d.id,{productId:p.id},S.me,new Date());return r.ok?{ok:true,msg:`Товар «${p.name}» создан и добавлен в сделку ${d.id}. Цены у строки нет — укажите её в строке.`}:r},
    ship:p=>{
      A['add-irow']();
      const box=byId('ns-items'),row=box&&box.lastElementChild,sel=row&&row.querySelector&&row.querySelector('select');
      if(sel) sel.value=p.id;
      return {ok:true,msg:`Товар «${p.name}» создан и добавлен строкой в поставку. Количество укажите в строке.`};
    },
    dsp:p=>{A['dsp-add']({dataset:{pid:p.id}});return {ok:true,msg:`Товар «${p.name}» создан и добавлен в заявку.`}},
  }[d.kind];
  if(!then) return;
  pqOpen(d.name||'',then);
};
A['pq-close']=()=>pqClose();
FORMS.pq=()=>{
  if(!PQ) return;
  if(!can('catalog')) return showErr('pq-err','У вашей роли нет права добавлять товары.');
  const prods=S.products.slice(),cats=(S.categories||[]).slice();
  const made=Catalog.add(S,{name:byId('pq-name').value,cat:byId('pq-cat').value,unit:byId('pq-unit').value,sku:byId('pq-sku').value});
  if(!made.ok) return showErr('pq-err',made.reason);
  const r=PQ.then(made.product)||{ok:true};
  if(!r.ok){S.products=prods;S.categories=cats;return showErr('pq-err',r.reason||'Не удалось добавить строку.')}
  pqClose();render();
  toast(r.msg||`Товар «${made.product.name}» создан.`);
};
A['product-sku']=el=>{if(!can('catalog')){toast('У вашей роли нет права менять артикул.','warn');return}openModal('productSku',el.dataset.pid)};
ON.input['sku-dup']=t=>{const h=byId(t.dataset.hint);if(!h) return;const x=skuDupText(t.value,t.dataset.pid||'');h.textContent=x;h.hidden=!x};
FORMS['product-sku']=f=>{
  const r=Catalog.setSku(S,f.dataset.pid,byId('ps-sku').value);
  if(!r.ok) return showErr('ps-err',r.reason);
  closeModal();render();
  toast(r.product.sku?`Артикул: ${r.product.sku}.${r.same.length?' '+skuDupText(r.product.sku,r.product.id):''}`:`Артикул убран: «${SKU_NONE}».`);
};
A['stock-page']=el=>{S.ui.page=parseInt(el.dataset.page,10)||0;S.ui.span=1;byId('stock-tbl').innerHTML=stockTable();byId('scroll').scrollTop=0};
// «Показать ещё» — дописать следующую страницу под видимыми (прокрутка остаётся), «Показать всё» — весь список с начала
// Номер страницы, введённый вручную: за пределами 1…pages — ближайшая крайняя
ON.change['stock-goto']=t=>{const rows=stockRows(),pages=Math.max(1,Math.ceil(rows.length/PAGE_SIZE)),n=Math.min(pages,Math.max(1,parseInt(t.value,10)||1));S.ui.page=n-1;S.ui.span=1;byId('stock-tbl').innerHTML=stockTable();byId('scroll').scrollTop=0};
A['stock-more']=()=>{S.ui.span=(Number(S.ui.span)||1)+1;byId('stock-tbl').innerHTML=stockTable()};
A['stock-all']=()=>{S.ui.page=0;S.ui.span=Infinity;byId('stock-tbl').innerHTML=stockTable()};
// Пустой список остатков: сбросить категорию, бренд, наличие, каталог, поиск и «только где не хватает»
A['stock-reset']=()=>{Object.assign(S.ui,{cat:'Все',sq:'',brand:'',avail:'',catf:'',deficit:false,page:0,span:1});render()};
// Из карточки товара — в журнал движений по этому товару
A['stock-journal']=el=>{S.ui.stockTab='moves';S.ui.mvPid=el.dataset.pid||'';S.ui.mvKind='';S.ui.drawer=null;go('stock')};
