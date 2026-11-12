// Раздел «Резервы»: всё, что сейчас в резерве, и постановка резерва сразу на много товаров — подобрать их в окне-каталоге
// («Подбор товаров», 79-picker.js: как подбор в 1С), поправить количество и нажать одну кнопку. Слова директора 2026-11-12: «отдельно пункт Резервы, где можно просто выбрать из списка всё,
// что нужно поставить в резерв».
// Ставит то же ядро, что карточка товара: под сделку — Deals.reserve (не больше, чем осталось по строкам сделки), без сделки —
// Stock.reserveFor (с текстом «для кого»). Берётся со склада; не хватает в одной клетке «юрлицо × город» — количество
// набирается из нескольких (rsvSplit), по резерву на клетку. Резерв под поставку в пути — по-прежнему в карточке товара.
// Выбор (что и сколько) — S.ui.rsv, личное, как фильтры: на сервер не уходит.

const rsvU=()=>{
  const u=S.ui.rsv||(S.ui.rsv={kind:'free',deal:'',forWho:'',until:'',q:'',lq:'',lf:'all',more:0,pick:{}});
  if(!u.pick||typeof u.pick!=='object'||Array.isArray(u.pick)) u.pick={};
  return u;
};
// Ошибки по строкам последней попытки: {productId: текст}; живут до правки строки или до успеха
let rsvErrs={};

// Сколько товара можно взять со склада под резерв: свободное по клеткам (Stock.cells), но не больше свободного по товару
function rsvFree(st,pid){
  const k=Stock.summary(st,pid);
  if(k.free===null) return 0;
  return Math.max(0,Math.min(k.free,Stock.cells(st,pid).reduce((s,c)=>s+c.free,0)));
}
// Как разложить qty по клеткам склада: сначала там, где свободного больше. → [{entityId, cityId, qty}] или null — не хватает
function rsvSplit(st,pid,qty){
  if(qty>rsvFree(st,pid)) return null;
  const out=[];let left=qty;
  for(const c of Stock.cells(st,pid)){
    if(left<=0) break;
    const q=Math.min(left,c.free);out.push({entityId:c.entityId,cityId:c.cityId,qty:q});left-=q;
  }
  return left>0?null:out;
}
// Сделки, под которые человек может ставить резерв: видимые, открытые, он вправе их править, и в строках есть товар,
// который ещё не весь зарезервирован
const rsvDealItems=d=>[...new Set((d.items||[]).map(i=>i.productId).filter(Boolean))].filter(pid=>Deals.left(S,d,pid)>0);
const rsvDeals=()=>Leads.dealsVisible(S,S.me).filter(d=>Deals.state(S,d)==='open'&&Deals.canEdit(S,d,S.me)&&rsvDealItems(d).length>0);

// Поставить резервы списком. items [{productId, qty}], o {dealId?, forWho?, until}. Сначала проверяется всё: право, сделка,
// «для кого», срок, по каждой строке — количество, остаток по сделке и свободное на складах. Хоть одна строка не проходит —
// не ставится ничего: {ok:false, reason, errs:{productId: текст}}. Иначе — по резерву на каждую клетку склада.
// → {ok, made:[резервы], errs, reason}
function rsvPlace(st,items,o,by,now){
  const errs={},plan=[],fail=reason=>({ok:false,reason,errs,made:[]});
  if(!Perms.can(st,by,'reserve')) return fail('У вашей роли нет права ставить резервы.');
  const d=o.dealId?(st.deals||[]).find(x=>x.id===o.dealId):null;
  if(o.dealId&&!d) return fail('Такой сделки нет.');
  const forWho=String(o.forWho||'').trim();
  if(!d&&!forWho) return fail('Напишите, для кого резерв: например, «под Иванова, монтаж в Шелехове».');
  const day0=x=>{const t=new Date(x);t.setHours(0,0,0,0);return +t};
  if(!o.until||day0(o.until)<day0(now)) return fail('Дата окончания резерва не может быть в прошлом.');
  const list=(items||[]).filter(x=>x&&x.productId);
  if(!list.length) return fail('Ничего не выбрано: нажмите «Подобрать товары» и выберите нужное.');
  for(const it of list){
    const p=(st.products||[]).find(x=>x.id===it.productId),q=Number(it.qty);
    if(!p){errs[it.productId]='Такого товара нет в каталоге.';continue}
    if(!Number.isInteger(q)||q<1){errs[p.id]='Количество — целое число больше нуля.';continue}
    if(d){
      const rest=Deals.left(st,d,p.id);
      if(!(rest>0)){errs[p.id]=`В сделке ${d.id} этого товара нет или он уже весь в резерве.`;continue}
      if(q>rest){errs[p.id]=`По сделке можно ещё ${num(rest)}.`;continue}
    }
    const parts=rsvSplit(st,p.id,q),free=rsvFree(st,p.id);
    if(!parts){errs[p.id]=free>0?`Свободно на складах только ${num(free)}.`:'Свободного на складах нет.';continue}
    plan.push({p,parts});
  }
  if(Object.keys(errs).length) return fail('Не все строки можно зарезервировать, поэтому не поставлено ничего. Поправьте отмеченные.');
  const made=[];
  for(const {p,parts} of plan) for(const c of parts){
    const a={productId:p.id,qty:c.qty,src:'stock',entityId:c.entityId,cityId:c.cityId,until:o.until};
    const res=d?Deals.reserve(st,d.id,a,by,now):Stock.reserveFor(st,Object.assign(a,{forWho}),by,now);
    if(!res.ok){errs[p.id]=res.reason;continue}
    made.push(res.reserve);
  }
  const bad=Object.keys(errs).length>0;
  return {ok:!bad,made,errs,reason:bad?'Часть резервов не поставлена — причина у строк.':''};
}

// ——— экран ———
const rsvProd=pid=>S.products.find(p=>p.id===pid);
// Что выбрано под резерв: таблица с количеством у каждой строки и причиной, если строка не прошла. Товары добавляются окном
// «Подбор товаров» (79-picker.js) — как подбор в 1С; под сделку в окне только её товары, ещё не весь зарезервированные.
function rsvPickHtml(u){
  const d=u.kind==='deal'?deal(u.deal):null;
  if(u.kind==='deal'&&!d) return '<p class="muted m0">Выберите сделку — тогда можно будет подобрать её товары.</p>';
  // «нет свободного» и «остатки не загружены» — разные вещи: во втором случае чисел нет ни у одного товара
  const noStock=!S.products.some(p=>Stock.summary(S,p.id).known);
  const warn=noStock?'<p class="hint warn-t m0">Нет данных: остатки на складах. Пока их нет, резерв со склада не поставится — их загружают в «Настройки → Перенос» (таблица остатков) или «Товары и остатки → Оприходовать товар».</p>':'';
  const ids=Object.keys(u.pick).filter(pid=>rsvProd(pid));
  const btns=`<div class="rsv-btns"><button type="button" class="btn${ids.length?'':' pri'}" data-act="rsv-picker">${ic('plus')}Подобрать товары</button>${d?'<button type="button" class="btn" data-act="rsv-all">Взять всё по сделке</button>':''}${ids.length?'<button type="button" class="btn ghost" data-act="rsv-clear">Очистить</button>':''}</div>`;
  if(!ids.length) return `${warn}<p class="muted m0">Пока ничего не выбрано. Нажмите «Подобрать товары» — откроется каталог: нажимайте на нужные товары, справа укажите количество и нажмите «Готово».</p>${btns}`;
  const total=ids.reduce((s,pid)=>s+(Number(u.pick[pid])||0),0);
  const row=pid=>{
    const p=rsvProd(pid),free=rsvFree(S,pid),known=Stock.summary(S,pid).known,rest=d?Deals.left(S,d,pid):null,err=rsvErrs[pid],v=u.pick[pid];
    return `<tr><td><button type="button" class="link" data-act="open-product" data-pid="${esc(pid)}">${esc(p.name)}</button><small class="muted">${esc(skuText(p))}</small>${err?`<small class="bad-t">${esc(err)}</small>`:''}</td>${d?`<td class="num">${num(rest)}</td>`:''}<td class="num">${known?num(free):'<span class="muted">нет данных</span>'}</td><td class="num"><input class="inp sm rsv-n" type="number" min="0" step="1" inputmode="numeric" value="${esc(v)}" data-on="rsv-n" data-pid="${esc(pid)}" aria-label="Сколько зарезервировать: ${esc(p.name)}"></td><td class="num"><button type="button" class="rsv-x" data-act="rsv-unpick" data-pid="${esc(pid)}" aria-label="Убрать «${esc(p.name)}»" title="Убрать">×</button></td></tr>`;
  };
  return `${warn}<div class="xs"><table class="tbl rsv-tbl"><thead><tr><th>Товар</th>${d?'<th class="num">Можно ещё по сделке</th>':''}<th class="num">Свободно на складах</th><th class="num">Сколько</th><th></th></tr></thead><tbody>${ids.map(row).join('')}</tbody></table></div><p class="m0" id="rsv-sum"><b>Выбрано: ${num(ids.length)} ${pl(ids.length,'товар','товара','товаров')}, всего ${num(total)} шт.</b></p>${btns}`;
}
function rsvFormHtml(u){
  if(!can('reserve')) return `<section class="card"><div class="card-b rsv-pad"><p class="lock m0">${ic('lock')}Ставить резервы может менеджер или директор. Ниже — всё, что сейчас в резерве.</p></div></section>`;
  const deals=rsvDeals();
  if(u.kind==='deal'&&!deals.some(d=>d.id===u.deal)) u.deal=deals[0]?deals[0].id:'';
  const until=u.until||iso(day(Stock.RESERVE_DAYS));
  const seg=`<div class="seg" role="group" aria-label="Под что резерв">${[['free','Без сделки — для кого'],['deal','На сделку']].map(([k,l])=>`<button type="button" class="${u.kind===k?'on':''}" aria-pressed="${u.kind===k}" data-act="rsv-kind" data-k="${k}">${l}</button>`).join('')}</div>`;
  const who=u.kind==='deal'
    ?`<div class="field"><label for="rsv-deal">Сделка</label>${deals.length?`<select id="rsv-deal" class="inp" data-on="rsv-deal">${deals.map(d=>`<option value="${esc(d.id)}"${d.id===u.deal?' selected':''}>${esc(d.id)} · ${esc(d.client||'')}</option>`).join('')}</select>`:'<p class="muted m0">Нет ваших открытых сделок, где есть товар без резерва. Добавьте товар в сделку или выберите «Без сделки — для кого».</p>'}</div>`
    :`<div class="field"><label for="rsv-for">Для кого</label><input id="rsv-for" class="inp" maxlength="200" value="${esc(u.forWho||'')}" placeholder="под Иванова, монтаж в Шелехове" data-on="rsv-for" autocomplete="off"></div>`;
  return `<section class="card rsv-new"><div class="card-h"><h3>Поставить резерв</h3></div><form class="card-b" data-form="rsv" novalidate>
    ${seg}
    <div class="grid2">${who}<div class="field"><label for="rsv-until">Резерв до</label><input id="rsv-until" class="inp" type="date" value="${esc(until)}" data-on="rsv-until"></div></div>
    <div id="rsv-pick" class="stack-s">${rsvPickHtml(u)}</div>
    <p class="err" id="rsv-err" hidden></p>
    <div class="rsv-go"><button class="btn pri" type="submit">${ic('lock')}Зарезервировать выбранное</button><small class="muted">Со склада, где свободного больше. Резерв под поставку в пути — в карточке товара.</small></div>
  </form></section>`;
}
// Все резервы: что, для кого, сколько, где, до какого числа, кто и когда поставил; сначала те, у кого срок ближе
const RSV_LF=[['all','Все'],['mine','Мои'],['soon','Срок 2 дня и меньше']];
function rsvRows(u){
  const q=Catalog.norm(u.lq||'');
  const list=(S.reserves||[]).map(r=>Stock.reserveView(S,r,S.me)).filter(Boolean).filter(v=>{
    if(u.lf==='mine'&&v.by!==S.me) return false;
    if(u.lf==='soon'&&!(v.until&&dd(v.until)<=2)) return false;
    if(!q) return true;
    const p=rsvProd(v.productId);
    return Catalog.norm([p&&p.name,p&&Catalog.skuOf(p),v.forWho,v.note,v.deal&&v.deal.id,v.deal&&v.deal.client].filter(Boolean).join(' ')).includes(q);
  });
  return sortRows(list,{col:'until',dir:'asc'},v=>v.until?+new Date(v.until):null,v=>{const p=rsvProd(v.productId);return p?p.name:''});
}
function rsvTableHtml(u){
  const list=rsvRows(u),acts=resActs();
  if(!list.length) return `<p class="muted m0">${(S.reserves||[]).length?'Под этот отбор резервов нет.':'Резервов пока нет.'}</p>`;
  const name=pid=>{const p=rsvProd(pid);return p?`<button type="button" class="link" data-act="open-product" data-pid="${esc(pid)}">${esc(p.name)}</button>`:noData('товар')};
  return `<div class="xs"><table class="tbl"><thead><tr><th>Товар</th><th>Для кого</th><th class="num">Кол-во</th><th>Где товар</th><th>До</th><th>Кто поставил</th><th>Когда</th>${acts?'<th></th>':''}</tr></thead><tbody>${list.map(v=>`<tr><td>${name(v.productId)}</td><td>${resDealCell(v)}</td>${resCells(v)}${acts?`<td class="num">${resBtns(v)}</td>`:''}</tr>`).join('')}</tbody></table></div><p class="hint">Показано ${num(list.length)} ${pl(list.length,'резерв','резерва','резервов')}.</p>`;
}
function rsvListHtml(u){
  const seg=`<div class="seg" role="group" aria-label="Какие резервы">${RSV_LF.map(([k,l])=>`<button type="button" class="${u.lf===k?'on':''}" aria-pressed="${u.lf===k}" data-act="rsv-lf" data-k="${k}">${l}</button>`).join('')}</div>`;
  return `<section class="card"><div class="card-h"><h3>Сейчас в резерве</h3></div><div class="card-b"><div class="rsv-flt">${seg}<input class="inp" type="search" value="${esc(u.lq||'')}" placeholder="Найти: товар, для кого, сделка" data-on="rsv-lq" autocomplete="off" aria-label="Поиск по резервам"></div><div id="rsv-list">${rsvTableHtml(u)}</div></div></section>`;
}
function vReserves(){const u=rsvU();return `<div class="rsv stack">${rsvFormHtml(u)}${rsvListHtml(u)}</div>`}

// ——— действия ———
const rsvRefresh=()=>{const a=byId('rsv-pick');if(a) a.innerHTML=rsvPickHtml(rsvU())};
// Сменили «под что» или сделку — выбор начинается заново: товары и пределы у сделки свои
const rsvReset=u=>{u.pick={};u.more=0;rsvErrs={}};
A['rsv-kind']=el=>{const u=rsvU();if(u.kind===el.dataset.k) return;u.kind=el.dataset.k;rsvReset(u);render()};
A['rsv-lf']=el=>{rsvU().lf=el.dataset.k;render()};
A['rsv-clear']=()=>{rsvReset(rsvU());rsvRefresh()};
A['rsv-unpick']=el=>{delete rsvU().pick[el.dataset.pid];delete rsvErrs[el.dataset.pid];rsvRefresh()};
A['rsv-all']=()=>{
  const u=rsvU(),d=deal(u.deal);if(!d) return;
  for(const pid of rsvDealItems(d)){const n=Math.min(Deals.left(S,d,pid),rsvFree(S,pid));if(n>0) u.pick[pid]=n}
  rsvErrs={};rsvRefresh();
};
ON.change['rsv-deal']=t=>{const u=rsvU();u.deal=t.value;rsvReset(u);render()};
ON.input['rsv-for']=t=>{rsvU().forWho=t.value};
ON.change['rsv-until']=t=>{rsvU().until=t.value};
ON.input['rsv-lq']=t=>{const u=rsvU();u.lq=t.value;const a=byId('rsv-list');if(a) a.innerHTML=rsvTableHtml(u)};
// Количество у строки: больше нуля — товар в «Выбрано», пусто или 0 — убран
ON.input['rsv-n']=t=>{
  const u=rsvU(),pid=t.dataset.pid,n=parseInt(t.value,10);
  if(n>0) u.pick[pid]=n;else delete u.pick[pid];
  delete rsvErrs[pid];
  // строка не перерисовывается, чтобы не сбить ввод; пересчитывается только «Выбрано: …»; 0 — строка уйдёт при следующей перерисовке
  const ids=Object.keys(u.pick).filter(pid=>rsvProd(pid)),sum=byId('rsv-sum');
  if(sum) sum.innerHTML=`<b>Выбрано: ${num(ids.length)} ${pl(ids.length,'товар','товара','товаров')}, всего ${num(ids.reduce((s,x)=>s+u.pick[x],0))} шт.</b>`;
};
ON.change['rsv-n']=()=>rsvRefresh();
// «Подобрать товары»: окно-каталог (79-picker.js) с тем, что уже выбрано; «Готово» заменяет выбор. Под сделку — только её товары
A['rsv-picker']=()=>{
  const u=rsvU(),d=u.kind==='deal'?deal(u.deal):null;
  if(u.kind==='deal'&&!d) return toast('Сначала выберите сделку.','warn');
  pickerOpen({title:d?'Подбор товаров под резерв: '+d.id:'Подбор товаров под резерв',sel:u.pick,only:d?rsvDealItems(d):null,stockToggle:!d,done:'Готово',
    note:d?'Здесь только товары этой сделки, которые ещё не весь в резерве.':'Нажимайте на товары — справа появится выбранное, там же меняется количество.',
    onDone:sel=>{u.pick=sel;rsvErrs={};rsvRefresh()}});
};
FORMS.rsv=()=>{
  const u=rsvU(),until=byId('rsv-until').value||u.until||iso(day(Stock.RESERVE_DAYS));
  if(u.kind==='deal'&&!u.deal) return showErr('rsv-err','Выберите сделку.');
  const items=Object.keys(u.pick).map(pid=>({productId:pid,qty:u.pick[pid]}));
  const res=rsvPlace(S,items,{dealId:u.kind==='deal'?u.deal:'',forWho:u.kind==='deal'?'':(byId('rsv-for').value||u.forWho),until:fromIso(until)},S.me,new Date());
  rsvErrs=res.errs||{};
  if(!res.made.length){rsvRefresh();return showErr('rsv-err',res.reason)}
  // поставленное убирается из выбора; не поставленное остаётся с причиной
  for(const r of res.made) if(!rsvErrs[r.productId]) delete u.pick[r.productId];
  const n=new Set(res.made.map(r=>r.productId)).size,whom=u.kind==='deal'?`для ${u.deal}`:`для «${String(u.forWho||'').trim()}»`;
  render();
  toast(res.ok?`Зарезервировано ${num(n)} ${pl(n,'товар','товара','товаров')} ${whom} до ${fD(fromIso(until))}. Склад и директор получили уведомление.`:res.reason,res.ok?undefined:'warn');
};

NAV.push({id:'reserves',label:'Резервы',icon:'lock',group:'Товар',order:15,hint:'Что сейчас в резерве и для кого. Чтобы поставить резерв, нажмите «Подобрать товары», выберите нужное в каталоге и нажмите «Зарезервировать выбранное».',ok:()=>can('stock')});
VIEWS.reserves=vReserves;
