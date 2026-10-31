// Раздел «Товары и остатки»
// Перенесено из прототипа v2; этап поставки — по id, «закрыта» — флаг final.

// ——— товары и остатки ———
function vStock(){
  return `<div class="bar"><div class="search-in">${ic('search')}<input id="sq" class="inp" type="search" placeholder="Название или артикул" value="${esc(S.ui.sq)}" data-on="sq" aria-label="Поиск товара"></div>
  <label class="check"><input type="checkbox" id="deficit" data-on="deficit" ${S.ui.deficit?'checked':''}> Только где не хватает</label><span class="grow"></span>${can('catalog')?`<button class="btn" data-act="new-product">${ic('plus')}Новый товар</button>`:''}</div>
  <div class="chips">${['Все',...CATS].map(c=>`<button class="fchip ${S.ui.cat===c?'on':''}" data-act="cat" data-cat="${c}">${c}</button>`).join('')}</div>
  <section class="card clip"><div class="legend"><span><i class="lg f"></i>Свободно на складе</span><span><i class="lg r"></i>На складе в резерве</span><span><i class="lg w"></i>Едет к нам</span><span>«Будет свободно» = склад + в пути − все резервы</span></div><div id="stock-tbl">${stockTable()}</div></section>`;
}
function sbar(p,big){
  const fn=Math.max(0,freeNow(p)),rs=Math.min(p.stock,resStock(p.sku)),iq=incomingQty(p.sku),tot=Math.max(1,fn+rs+iq),w=x=>(x/tot*100).toFixed(1)+'%';
  return `<div class="sbar ${big?'big':''}" title="Свободно ${num(fn)}, в резерве ${num(rs)}, в пути ${num(iq)}"><i class="f" style="width:${w(fn)}"></i><i class="r" style="width:${w(rs)}"></i><i class="w" style="width:${w(iq)}"></i></div>`;
}
const priceTxt=p=>p.price==null?'<span class="muted">нет данных</span>':rub(p.price);
function stockTable(){
  const q=S.ui.sq.trim().toLowerCase();
  let list=S.products.filter(p=>(S.ui.cat==='Все'||p.cat===S.ui.cat)&&(!q||(p.name+' '+p.sku).toLowerCase().includes(q)));
  if(S.ui.deficit) list=list.filter(p=>freeAfter(p)<0||freeNow(p)<=0);
  if(!list.length) return '<p class="empty">Ничего не нашлось. Проверьте фильтр или строку поиска.</p>';
  const pr=can('prices');
  return `<div class="xs"><table class="tbl"><thead><tr><th>Товар</th><th class="num">На складе</th><th class="num">В резерве</th><th class="num">Свободно</th><th>Едет к нам</th><th class="num">Будет свободно</th>${pr?'<th class="num">Цена</th>':''}<th>Картина</th></tr></thead><tbody>${list.map(p=>{
    const ra=resAll(p.sku),rsh=ra-resStock(p.sku),fn=freeNow(p),inc=incomingOf(p.sku),iq=incomingQty(p.sku),fa=freeAfter(p);
    return `<tr class="click" data-act="open-product" data-sku="${p.sku}" tabindex="0"><td><div class="pname"><span>${esc(p.name)}</span><small class="mono">${esc(p.sku)}</small></div></td><td class="num">${num(p.stock)} <span class="u">${p.unit}</span></td><td class="num">${num(ra)}${rsh?`<small class="muted">${num(rsh)} под поставку</small>`:''}</td><td class="num"><b class="${fn<=0?'bad-t':''}">${num(fn)}</b></td><td>${iq?`<span class="in-t">${num(iq)} ${p.unit}</span><small class="muted">ближайшая ${fD(inc[0].ship.eta)}${inc.length>1?` · ${inc.length} поставки`:''}</small>`:'<span class="muted">не ждём</span>'}</td><td class="num">${fa<0?`<span class="pill bad sm">не хватает ${num(-fa)}</span>`:num(fa)}</td>${pr?`<td class="num">${priceTxt(p)}</td>`:''}<td>${sbar(p)}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}
function srcPill(r){
  if(r.src==='stock') return '<span class="pill ok sm">на складе</span>';
  const s=ship(r.src),bad=freeAfter(product(r.productId))<0;
  return `<span class="pill ${bad?'bad':'info'} sm">едет: ${s?.id||r.src}${s?' · '+fD(s.eta):''}${bad?' · не хватает':''}</span>`;
}
function dProduct(p){
  const rs=resOf(p.sku),inc=incomingOf(p.sku),mv=S.moves.filter(m=>m.productId===p.sku).slice(0,8),fn=freeNow(p),fa=freeAfter(p);
  const st=(l,v,c='')=>`<div class="st"><span>${l}</span><b class="${c}">${v}</b></div>`;
  let form='';
  if(can('reserve')){
    const deals=S.deals.filter(d=>!isDone(d));
    const src=[`<option value="stock">Со склада — свободно ${num(Math.max(0,fn))} ${p.unit}</option>`,...inc.map(x=>`<option value="${x.ship.id}">Из поставки ${x.ship.id}, ${fD(x.ship.eta)} — свободно ${num(Math.max(0,shipFree(x.ship.id,p.sku)))} ${p.unit}</option>`)].join('');
    form=`<form class="rform" data-form="reserve" data-sku="${esc(p.sku)}" novalidate><h4 class="sh">Поставить резерв</h4><div class="grid2"><div class="field"><label for="rs-deal">Сделка</label><select id="rs-deal" class="inp">${deals.map(d=>`<option value="${d.id}">${d.id} · ${esc(d.client)}</option>`).join('')}</select></div><div class="field"><label for="rs-qty">Количество, ${p.unit}</label><input id="rs-qty" class="inp" type="number" min="1" value="1" inputmode="numeric"></div><div class="field span2"><label for="rs-src">Откуда</label><select id="rs-src" class="inp">${src}</select></div><div class="field"><label for="rs-until">Резерв до</label><input id="rs-until" class="inp" type="date" value="${iso(day(7))}"></div><div class="field end"><button class="btn pri" type="submit">${ic('lock')}Зарезервировать</button></div></div><p class="err" id="rs-err" hidden></p></form>`;
  } else form=`<p class="lock">${ic('lock')}Резервы ставит менеджер или директор. Вам придёт уведомление, когда резерв появится.</p>`;
  const rTbl=rs.length?`<div class="xs"><table class="tbl"><thead><tr><th>Сделка</th><th class="num">Кол-во</th><th>Где товар</th><th>До</th>${can('reserve')?'<th></th>':''}</tr></thead><tbody>${rs.map(r=>{const d=deal(r.dealId),n=dd(r.until);return `<tr><td>${can('clients')?`<button class="link" data-act="open-deal" data-id="${r.dealId}">${r.dealId}</button>`:r.dealId}<small class="muted">${esc(d?.client||'')}</small></td><td class="num">${num(r.qty)}</td><td>${srcPill(r)}</td><td class="nowrap ${n<=2?'warn-t':''}">${fD(r.until)}</td>${can('reserve')?`<td class="num"><button class="btn sm ghost" data-act="unreserve" data-id="${r.id}">Снять</button></td>`:''}</tr>`}).join('')}</tbody></table></div>`:'<p class="muted m0">Резервов нет.</p>';
  const iList=inc.length?`<ul class="mv">${inc.map(x=>`<li><b class="mono">${x.ship.id}</b><span>${num(x.qty)} ${p.unit}</span><span class="pill sm ${isLate(x.ship)?'bad':'info'}">${isLate(x.ship)?'задерживается':esc(stageName(x.ship).toLowerCase())}</span><small>ожидается ${fD(x.ship.eta)}</small></li>`).join('')}</ul>`:'<p class="muted m0">Поставок с этим товаром нет.</p>';
  const sign=m=>m.kind==='Приход'?'+':m.kind==='Отгрузка'?'−':'';
  const mList=mv.length?`<ul class="mv">${mv.map(m=>`<li><span class="pill sm ${m.kind==='Приход'?'ok':m.kind==='Отгрузка'?'info':'sun'}">${m.kind}</span><b>${sign(m)}${num(m.qty)} ${p.unit}</b><span class="mono muted">${esc(m.doc)}</span><small>${fWhen(m.at)} · ${esc(person(m.by)?.name||'')}</small></li>`).join('')}</ul>`:'<p class="muted m0">Движений пока нет.</p>';
  return {kind:p.cat,title:esc(p.name),sub:`<span class="mono">${esc(p.sku)}</span>${can('prices')?' · цена '+priceTxt(p)+' за '+p.unit:''}`,body:`
    <div class="stats">${st('На складе',num(p.stock)+' '+p.unit)}${st('В резерве',num(resAll(p.sku)))}${st('Свободно сейчас',num(fn),fn<=0?'bad-t':'ok-t')}${st('Едет к нам',num(incomingQty(p.sku)))}${st('Будет свободно',num(fa),fa<0?'bad-t':'')}</div>
    ${sbar(p,true)}${form}
    <div><h4 class="sh">Резервы</h4>${rTbl}</div>
    <div><h4 class="sh">Едет к нам</h4>${iList}</div>
    <div><h4 class="sh">Движение товара</h4>${mList}</div>`};
}

// ——— регистрация в реестрах оболочки ———
DRAWERS.product=id=>{const p=can('stock')?product(id):null;return p?dProduct(p):null};
ON.input.sq=t=>{S.ui.sq=t.value;byId('stock-tbl').innerHTML=stockTable()};
ON.change.deficit=t=>{S.ui.deficit=t.checked;byId('stock-tbl').innerHTML=stockTable()};
