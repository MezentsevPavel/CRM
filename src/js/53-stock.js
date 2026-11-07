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
function goodsPane(tabs){
  const u=S.ui,cur=u.cat||'Все';
  const chips=['Все',...Catalog.cats(S)].map(c=>`<button type="button" class="fchip ${cur===c?'on':''}" data-act="stock-cat" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
  const filters=[
    selField('f-brand','brand','Бренд',[['','Все бренды'],...Catalog.brands(S).map(b=>[b,b])],u.brand||''),
    selField('f-avail','avail','Наличие',[['','Любое наличие'],...[...new Set(S.products.map(p=>p.avail).filter(Boolean))].map(a=>[a,a])],u.avail||''),
    selField('f-catf','catf','Каталог',[['','В каталоге и нет'],['in','Только в каталоге'],['out','Только «нет в каталоге»']],u.catf||'')
  ].join('');
  return `<div class="bar">${tabs}<span class="grow"></span>${can('catalog')?`<button class="btn" data-act="new-product">${ic('plus')}Новый товар</button>`:''}</div>
  <div class="bar"><div class="search-in">${ic('search')}<input id="sq" class="inp" type="search" placeholder="Название, бренд или ключ каталога" value="${esc(u.sq)}" data-on="sq" aria-label="Поиск товара"></div>
  <label class="check"><input type="checkbox" id="deficit" data-on="deficit" ${u.deficit?'checked':''}> Только где не хватает</label></div>
  <div class="fgrid">${filters}</div>
  <div class="chips">${chips}</div>
  <section class="card clip"><div class="legend"><span><i class="lg f"></i>Свободно на складе</span><span><i class="lg r"></i>На складе в резерве</span><span><i class="lg w"></i>Едет к нам</span><span>«Свободно после прихода» = склад + в пути − все резервы</span></div><div id="stock-tbl">${stockTable()}</div></section>`;
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
  return u.deficit?list.filter(p=>{const k=stockOf(p.id);return k.freeAfter<0||(k.known&&k.free<=0)}):list;
}
// Переключатель страниц: span — сколько страниц подряд раскрыто с page («Показать ещё» +1, «Показать всё» — все)
function pagerHtml(page,pages,span){
  if(pages<2) return '';
  const last=page+span-1,end=last>=pages-1;
  const label=span>1?`Страницы <b>${page+1}–${last+1}</b> из <b>${pages}</b>`:`Страница <b>${page+1}</b> из <b>${pages}</b>`;
  return `<div class="pager"><button type="button" class="btn sm" data-act="stock-page" data-page="${page-1}" ${page<1?'disabled':''}>← Назад</button><span class="muted sm">${label}</span><button type="button" class="btn sm" data-act="stock-page" data-page="${last+1}" ${end?'disabled':''}>Вперёд →</button>${end?'':`<button type="button" class="btn sm ghost" data-act="stock-more">Показать ещё</button><button type="button" class="btn sm ghost" data-act="stock-all">Показать всё</button>`}</div>`;
}
// Бейдж «N резервов» в строке номенклатуры: кнопка открывает карточку товара сразу на списке резервов
const resBadge=p=>{const n=resOf(p.id).length;return n?`<button type="button" class="rbadge" data-act="product-reserves" data-id="${esc(p.id)}" title="Кто, что и когда зарезервировал">${ic('lock')}${n} ${pl(n,'резерв','резерва','резервов')}</button>`:''};
// «В пути: ВС 20 (продано 15) · НПП 5» — по юрлицам поставок (Stock.transitText); «продано» — резервы под эти поставки
const transitLine=pid=>{const t=Stock.transitText(S,pid);return t?'В пути: '+t:''};
function stockRow(p,pr){
  const k=stockOf(p.id),ra=k.reservedStock+k.reservedIncoming,inc=Stock.incomingOf(S,p.id),fa=k.freeAfter,unk=stockUnknown(k),nd='<span class="muted">нет данных</span>';
  const key=p.inCatalog?`<span class="mono">${esc(p.id)}</span>`:'<span class="pill sun sm">нет в каталоге</span>';
  const meta=[p.brand,p.cat].filter(Boolean).map(esc).join(' · ');
  return `<tr class="click" data-act="open-product" data-pid="${esc(p.id)}" tabindex="0"><td><div class="pname"><span>${esc(p.name)}</span><small>${key}${meta?' · '+meta:''}</small></div></td><td class="num">${k.known?qtyOf(k.onHand,p):nd}</td><td class="num">${num(ra)}${k.reservedIncoming?`<small class="muted">${num(k.reservedIncoming)} под поставку</small>`:''}${resBadge(p)}</td><td class="num free">${unk?nd:`<b class="${k.free<=0?'bad-t':''}">${num(k.free)}</b>`}</td><td>${k.incoming?`<span class="in-t">${qtyOf(k.incoming,p)}</span><small class="muted">${esc(transitLine(p.id))}</small><small class="muted">ближайшая ${fD(k.nextEta)}${inc.length>1?` · ${inc.length} поставки`:''}</small>`:'<span class="muted">не ждём</span>'}</td><td class="num">${unk?nd:fa<0?`<span class="pill bad sm">не хватает ${num(-fa)}</span>`:num(fa)}</td>${pr?`<td class="num">${priceTxt(p)}</td>`:''}<td>${sbar(p)}</td></tr>`;
}
// Содержимое #stock-tbl: «показано N из M», страница таблицы, переключатель страниц
function stockTable(){
  const rows=stockRows(),all=S.products.length,pages=Math.max(1,Math.ceil(rows.length/PAGE_SIZE));
  const page=Math.min(Math.max(0,parseInt(S.ui.page,10)||0),pages-1),span=Math.min(Math.max(1,Math.floor(Number(S.ui.span))||1),pages-page);
  const from=page*PAGE_SIZE,part=rows.slice(from,from+span*PAGE_SIZE);
  const head=`<div class="count"><span>Показано <b>${rows.length}</b> из <b>${all}</b> позиций</span>${rows.length>PAGE_SIZE?`<span class="muted">строки ${from+1}–${from+part.length}</span>`:''}</div>`;
  if(!rows.length) return head+emptyState('Ничего не нашлось. Проверьте фильтр или строку поиска.','Сбросить фильтры','stock-reset');
  const pr=can('prices'),pg=pagerHtml(page,pages,span);
  return `${head}<div class="xs"><table class="tbl"><thead><tr><th>Товар</th><th class="num">На складе</th><th class="num">В резерве</th><th class="num">Свободно сейчас</th><th>Едет к нам</th><th class="num">Свободно после прихода</th>${pr?'<th class="num">Цена</th>':''}<th>Картина</th></tr></thead><tbody>${part.map(p=>stockRow(p,pr)).join('')}</tbody></table></div>${pg}`;
}
const refreshStock=()=>{S.ui.page=0;S.ui.span=1;byId('stock-tbl').innerHTML=stockTable()};

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
  const prods=ids.map(id=>[id,product(id)?.name||id]).sort((a,b)=>a[1].localeCompare(b[1],'ru'));
  const filters=selField('mv-pid','mvpid','Товар',[['','Все товары'],...prods],u.mvPid||'')+selField('mv-kind','mvkind','Вид движения',[['','Все виды'],...Object.values(Stock.KINDS).map(k=>[k,k])],u.mvKind||'');
  return `<div class="bar">${tabs}</div><div class="fgrid">${filters}</div><section class="card clip"><div id="mv-tbl">${movesTable()}</div></section>`;
}
function movesTable(){
  const u=S.ui,list=S.moves.filter(m=>(!u.mvPid||m.productId===u.mvPid)&&(!u.mvKind||m.kind===u.mvKind)),part=list.slice(0,MV_LIMIT);
  const head=`<div class="count"><span>Показано <b>${list.length}</b> из <b>${S.moves.length}</b> движений</span>${list.length>MV_LIMIT?`<span class="muted">первые ${MV_LIMIT}: уточните фильтр</span>`:''}</div>`;
  if(!part.length) return head+emptyState('Движений по этому фильтру нет.','Показать все движения','stock-journal');
  return `${head}<div class="xs"><table class="tbl"><thead><tr><th>Когда</th><th>Кто</th><th>Вид</th><th>Товар</th><th class="num">Сколько</th><th>Откуда и куда</th><th>Документ</th></tr></thead><tbody>${part.map(m=>{
    const p=product(m.productId),who=whoName(m.by);
    return `<tr${p?` class="click" data-act="open-product" data-pid="${esc(p.id)}" tabindex="0"`:''}><td class="nowrap">${fWhen(m.at)}</td><td>${who?esc(who):noData('кто')}</td><td>${movePill(m)}</td><td>${p?`<button type="button" class="link" data-act="open-product" data-pid="${esc(p.id)}">${esc(p.name)}</button>`:noData('товар')}</td><td class="num">${moveSign(m)}${qtyOf(m.qty,p)}</td><td>${esc(moveWhere(m))}</td><td class="mono">${esc(moveDoc(m))}</td></tr>`;
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
// Сетка «юрлицо × город» с итогами; пустая клетка — пустая, не 0
function gridHtml(p){
  const g=Stock.grid(S,p.id);
  if(g.totals.all===null) return `<p class="m0">${noData('остаток по юрлицам и городам')}</p>`;
  const n=v=>v===null?'':num(v),cell=v=>v===null?'<td class="num e"></td>':`<td class="num">${num(v)}</td>`;
  return `<div class="xs"><table class="tbl mx"><thead><tr><th>Юрлицо / город</th>${g.cols.map(c=>`<th class="num">${esc(c.name)}</th>`).join('')}<th class="num">Итого</th></tr></thead><tbody>${g.rows.map(r=>`<tr><th scope="row">${esc(r.name)}</th>${g.cols.map(c=>cell(g.cell(r.id,c.id))).join('')}<td class="num tot">${n(g.totals.rows[r.id])}</td></tr>`).join('')}</tbody><tfoot><tr><th scope="row">Итого</th>${g.cols.map(c=>`<td class="num tot">${n(g.totals.cols[c.id])}</td>`).join('')}<td class="num tot">${n(g.totals.all)}</td></tr></tfoot></table></div>`;
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
// Строка «Едет к нам»: поставка (этап и срок из карточки поставки) или груз перемещения между складами — «в пути: N, ОТ-NNN»
// со ссылкой на заявку; у груза поставки нет, поэтому ни этапа поставки, ни резерва под него
function iRow(x,p){
  if(x.dispatchId) return `<li><span class="pill sm info">перемещение</span><span>в пути: ${qtyOf(x.qty,p)}, <button type="button" class="link" data-act="open-dispatch" data-id="${esc(x.dispatchId)}">${esc(x.shipId)}</button></span><small>на склад ${esc(cellText(x.entityId,x.cityId))} · ожидается ${fD(x.eta)}</small></li>`;
  const s=ship(x.shipId),late=isLate(s);
  return `<li><b class="mono">${esc(x.shipId)}</b><span>${qtyOf(x.qty,p)}</span><span class="pill sm ${late?'bad':'info'}">${late?'задерживается':esc(stageName(s).toLowerCase())}</span><small>ожидается ${fD(x.eta)}</small></li>`;
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
function dProduct(p){
  const k=stockOf(p.id),rs=resOf(p.id).map(r=>Stock.reserveView(S,r,S.me)).filter(Boolean);const inc=Stock.incomingOf(S,p.id),all=S.moves.filter(m=>m.productId===p.id),mv=all.slice(0,10),unk=stockUnknown(k);
  const st=(l,v,c='',note='')=>`<div class="st"><span>${l}</span><b class="${c}">${v}</b>${note?`<small>${note}</small>`:''}</div>`;
  const kv=(l,v)=>`<dt>${l}</dt><dd>${v}</dd>`;
  const aside=x=>x===null?'нет данных':qtyOf(x,p);
  const key=p.inCatalog?`<span class="mono">${esc(p.id)}</span>`:'<span class="pill sun sm">нет в каталоге</span>';
  const url=/^https?:\/\//.test(p.url||'')?`<a class="link" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">Открыть на сайте</a>`:'';
  const info=[
    kv('Ключ каталога',key),kv('Модель',esc(p.name)),kv('Бренд',p.brand?esc(p.brand):noData('бренд')),kv('Категория',esc(p.cat)),
    can('prices')?kv('Цена',p.price==null?noData('цена'):`<b>${rub(p.price)}</b><small>${p.src==='user'?'введена вручную':priceNote()}</small>`):'',
    kv('Наличие',p.avail?esc(p.avail):noData('наличие')),url?kv('Ссылка',url):''
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
  return {kind:p.cat,title:esc(p.name),sub:`${p.inCatalog?`<span class="mono">${esc(p.id)}</span>`:'нет в каталоге'}${p.brand?' · '+esc(p.brand):''}`,body:`
    <div><h4 class="sh">Карточка каталога</h4><dl class="kv">${info}</dl></div>
    <div class="pst">${st('На складе',k.known?qtyOf(k.onHand,p):'нет данных')}${st('В резерве',num(k.reservedStock+k.reservedIncoming),'',k.reservedIncoming?`со склада ${num(k.reservedStock)}, под поставки ${num(k.reservedIncoming)}`:'')}${st('Свободно сейчас',unk?'нет данных':num(k.free),unk?'':k.free<=0?'bad-t':'ok-t')}${st('Свободно после прихода',unk?'нет данных':num(k.freeAfter),k.freeAfter<0?'bad-t':'',k.incoming?`едет ${num(k.incoming)}`:'')}</div>
    ${sbar(p,true)}
    ${watchHtml(p,k)}
    <div><h4 class="sh">Склады: юрлицо × город</h4>${gridHtml(p)}<p class="hint">Источник: ${stockNote()}. Движения в CRM после снимка — в журнале ниже.</p></div>
    <div><h4 class="sh">Не входит в свободный остаток</h4><div class="pst">${st('Ответхранение',aside(k.custody),'','считать ли в свободном — нет данных')}${st('В пути (из таблицы)',aside(k.transitNoShip),'','без поставки в CRM')}${st('Бой',aside(k.damaged))}</div></div>
    ${reserveForm(p,k,inc)}
    <div id="p-reserves"><h4 class="sh">Резервы</h4>${rTbl}</div>
    ${removedHtml(p)}
    ${sellCells(p)}
    <div><h4 class="sh">Едет к нам</h4>${inc.length&&transitLine(p.id)?`<p class="m0">${esc(transitLine(p.id))}</p>`:''}${iList}</div>
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
  return `<form data-form="stock-sell" data-pid="${esc(o.pid)}" data-did="${esc(o.did||'')}" novalidate>${mHead('Списать при продаже: '+esc(p.name))}<div class="modal-b">
    <p class="m0">${o.did?`Сделка ${esc(o.did)}${d?' · '+esc(d.client):''}. `:''}Товар уходит со склада, в журнале движений появится «Отгрузка».</p>
    <div class="field"><label for="ps-src">Откуда</label><select id="ps-src" class="inp" data-on="sellsrc" data-pid="${esc(o.pid)}">${optionsHtml(src,cur)}</select></div>
    <div class="grid2"><div class="field"><label for="ps-qty">Сколько${p.unit?', '+esc(p.unit):''}</label><input id="ps-qty" class="inp" type="number" min="1" step="1" value="${esc(qty)}" inputmode="numeric"></div>
      <div class="field"><label for="ps-doc">Документ</label><input id="ps-doc" class="inp" value="${esc(doc)}" placeholder="Номер сделки или накладной" autocomplete="off"></div></div>
    <p class="hint" id="ps-max">${esc(sellMaxText(o.pid,cur))}</p>
    <p class="err" id="ps-err" hidden></p></div>${mFoot('Списать')}</form>`;
};

// ——— регистрация в реестрах оболочки ———
SEARCH.push({kind:'product',label:'Товар',order:10,find:q=>!can('stock')?[]:Catalog.query(S,{q}).slice(0,6).map(p=>{const k=stockOf(p.id);return {title:p.name,sub:k.known?`свободно ${qtyOf(k.free,p)}`:'остаток: нет данных',open:`data-act="open-product" data-pid="${esc(p.id)}"`}})});
DRAWERS.product=id=>{const p=can('stock')?product(id):null;return p?dProduct(p):null};
regRef('product','товар',id=>!!product(id),'open-product','pid');
ON.input.sq=t=>{S.ui.sq=t.value;refreshStock()};
ON.change.deficit=t=>{S.ui.deficit=t.checked;refreshStock()};
ON.change.brand=t=>{S.ui.brand=t.value;refreshStock()};
ON.change.avail=t=>{S.ui.avail=t.value;refreshStock()};
ON.change.catf=t=>{S.ui.catf=t.value;refreshStock()};
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
  const p=product(pid),m=r.move,what=`${low(p.name)} — ${qtyOf(m.qty,p)} со склада ${cellText(m.entityId,m.cityId)}`;
  // из сделки или по резерву сделки: в её ленте остаётся запись о списании
  if(did) Feed.add(S,{t:'deal',id:did},{kind:'item',text:`Списано при продаже: ${what}${r.reserve?' (по резерву)':''}.`,by:S.me,at:now,data:r.reserve?{reserveId:r.reserve.id,sold:true}:undefined});
  closeModal();render();
  toast(`Списано при продаже: ${what}. Запись в журнале есть.`);
};
// Бейдж «N резервов» в номенклатуре — карточка товара сразу на списке резервов
A['product-reserves']=el=>{openDrawer('product',el.dataset.id);const t=byId('p-reserves');if(t&&t.scrollIntoView) t.scrollIntoView({block:'start'})};
ON.change.rskind=t=>{const free=t.value==='free',a=byId('rs-deal-f'),b=byId('rs-for-f');if(a) a.hidden=free;if(b) b.hidden=!free};
A['stock-watch']=el=>{const r=Stock.watch(S,el.dataset.pid,S.me,new Date());if(!r.ok) return toast(r.reason,'warn');render();toast('Сообщу, когда товар появится: уведомление придёт один раз.')};
A['stock-unwatch']=el=>{Stock.unwatch(S,el.dataset.pid,S.me);render();toast('Не сообщаю об этом товаре.')};
// «Срок» у резерва: окно с датой; Stock.extend пишет смену в историю резерва
A['reserve-until']=el=>openModal('reserveUntil',el.dataset.id);
MODALS.reserveUntil=id=>{
  const r=S.reserves.find(x=>x.id===id),p=r&&product(r.productId);
  if(!r) return `${mHead('Срок резерва')}<div class="modal-b"><p class="m0">Резерва уже нет.</p></div>`;
  return `<form data-form="reserve-until" data-id="${esc(id)}" novalidate>${mHead('Срок резерва: '+esc(p?p.name:'нет данных: товар'))}<div class="modal-b">
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
A['stock-cat']=el=>{S.ui.cat=el.dataset.cat;S.ui.page=0;S.ui.span=1;render()};
A['stock-page']=el=>{S.ui.page=parseInt(el.dataset.page,10)||0;S.ui.span=1;byId('stock-tbl').innerHTML=stockTable();byId('scroll').scrollTop=0};
// «Показать ещё» — дописать следующую страницу под видимыми (прокрутка остаётся), «Показать всё» — весь список с начала
A['stock-more']=()=>{S.ui.span=(Number(S.ui.span)||1)+1;byId('stock-tbl').innerHTML=stockTable()};
A['stock-all']=()=>{S.ui.page=0;S.ui.span=Infinity;byId('stock-tbl').innerHTML=stockTable()};
// Пустой список остатков: сбросить категорию, бренд, наличие, каталог, поиск и «только где не хватает»
A['stock-reset']=()=>{Object.assign(S.ui,{cat:'Все',sq:'',brand:'',avail:'',catf:'',deficit:false,page:0,span:1});render()};
// Из карточки товара — в журнал движений по этому товару
A['stock-journal']=el=>{S.ui.stockTab='moves';S.ui.mvPid=el.dataset.pid||'';S.ui.mvKind='';S.ui.drawer=null;go('stock')};
