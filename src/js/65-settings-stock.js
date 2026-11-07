// Настройки → «Склады и юрлица»: справочники юрлиц и городов (добавить, переименовать, адрес склада)
// и откуда взят каталог. Справочники лежат в S.entities и S.cities: сетка остатков, форма резерва и журнал
// берут названия оттуда же, поэтому переименование видно везде сразу.
// Здесь же продажа между юрлицами (S.billing): кто выставляет счета между юрлицами (billerId, не выбран — директор) и от какого
// юрлица продаёт менеджер по типу (seller) — их берут Dispatch.billPlan и Dispatch.defaultSeller.

// Название уже занято другим элементом справочника (сравнение как у товаров: регистр и пробелы не в счёт)
const nameTaken=(list,name,exceptId)=>list.some(x=>x.id!==exceptId&&Catalog.norm(x.name)===Catalog.norm(name));

// Переименование из поля data-on: пустое и занятое название не принимаются, поле возвращается к прежнему
function renameInDict(list,t,what){
  const item=list.find(x=>x.id===t.dataset.id);if(!item) return;
  const name=String(t.value).trim();
  if(!name||nameTaken(list,name,item.id)){
    t.value=item.name;
    toast(!name?'Название не может быть пустым.':`${what} «${name}» уже есть в справочнике.`,'warn');
    return;
  }
  if(name===item.name) return;
  const old=item.name;item.name=name;
  render();toast(`${what} «${old}» теперь называется «${name}».`);
}
ON.change['ent-name']=t=>renameInDict(S.entities,t,'Юрлицо');
ON.change['city-name']=t=>renameInDict(S.cities,t,'Город');
// Новая копия S.billing (документ общей базы меняется целиком)
const billingCopy=()=>{const b=S.billing||{};return Object.assign({},b,{seller:Object.assign({},b.seller)})};
// «Счета между юрлицами выставляет»: кому уходит задача «Выставить счёт»; не выбран — директору
ON.change['biller']=t=>{
  const p=person(t.value),b=billingCopy();
  if(p) b.billerId=p.id;else delete b.billerId;
  S.billing=b;render();
  toast(`Счета между юрлицами выставляет: ${p?p.name:'не выбран — запросы уходят директору'}. Новые запросы счёта пойдут ${p?'ему':'директору'}.`);
};
// «Менеджер B2B продаёт от»: продавец по умолчанию в новой заявке на продажу; пусто — менеджер выбирает сам
ON.change['seller-by']=t=>{
  const k=t.dataset.scope,e=S.entities.find(x=>x.id===t.value),b=billingCopy();
  if(e) b.seller[k]=e.id;else delete b.seller[k];
  S.billing=b;
  toast(`Менеджер ${k.toUpperCase()} по умолчанию продаёт от: ${e?e.name:'не задано — выбирает в заявке'}.`);
};
ON.change['city-addr']=t=>{
  const c=S.cities.find(x=>x.id===t.dataset.id);if(!c) return;
  c.address=String(t.value).trim();
  toast(c.address?`Адрес склада «${c.name}» сохранён.`:`Адрес склада «${c.name}» очищен: нет данных.`);
};

// «Обновить каталог из снимка»: Catalog.merge (то же, что делает шаг MIGRATIONS[21] у рабочей базы) — одно действие, один save() в render()
A['catalog-merge']=()=>{
  if(!can('catalog')){toast('У вашей роли нет права менять каталог.','warn');return}
  const r=Catalog.merge(S,CATALOG),n=r.added.length;
  render();
  toast(`Каталог обновлён: добавлено ${n} ${pl(n,'товар','товара','товаров')}, артикулов проставлено ${r.skuSet}.`);
};
FORMS['entity-add']=()=>{
  const name=byId('ent-new').value.trim();
  if(!name) return showErr('ent-err','Напишите название юрлица.');
  if(nameTaken(S.entities,name)) return showErr('ent-err',`Юрлицо «${name}» уже есть в справочнике.`);
  S.entities.push({id:Store.freeId(S.entities,'e'),name});
  byId('ent-new').value='';render();
  toast(`Юрлицо «${name}» добавлено: оно уже есть в таблице остатков и в форме резерва.`);
};
FORMS['city-add']=()=>{
  const name=byId('city-new').value.trim(),address=byId('city-new-addr').value.trim();
  if(!name) return showErr('city-err','Напишите название города.');
  if(nameTaken(S.cities,name)) return showErr('city-err',`Город «${name}» уже есть в справочнике.`);
  S.cities.push({id:Store.freeId(S.cities,'c'),name,address});
  byId('city-new').value='';byId('city-new-addr').value='';render();
  toast(`Город «${name}» добавлен: он уже есть в таблице остатков и в форме резерва.`);
};

// «Откуда данные» об остатках. Демо: снимок 31.10 и сколько его строк склеено с каталогом. Рабочая база снимка не держит:
// говорит о последнем переносе листа «Остатки» (дата, кто, сколько строк) или честно — что переноса ещё не было.
function stockSources(){
  if(!SERVER){
    const total=STOCK_SNAPSHOT.rows.length,glued=total-Catalog.base().unmatched.length;
    return `<p class="m0"><b>Остатки:</b> ${stockNote()}. Дальше остатки меняются движениями в CRM.</p>
    <p class="m0">Склеено по названию ${glued} из ${total} строк таблицы менеджеров; остальные — «нет в каталоге».</p>`;
  }
  const sh=S.stockSheet;
  if(!sh||!sh.at) return `<p class="m0"><b>Остатки:</b> Остатки ещё не перенесены. Директор загружает лист «Остатки» в Настройки → Перенос.</p>`;
  const who=sh.by?(whoName(sh.by)||esc(sh.by)):'нет данных: кто';
  return `<p class="m0"><b>Остатки:</b> последний перенос листа «Остатки» — ${snapRu(iso(sh.at))}, ${esc(who)}; строк в листе: ${(sh.rows||[]).length}. Дальше остатки меняются движениями в CRM.</p>`;
}
function vWarehouses(){
  const popt=(cur,none)=>`<option value="">${esc(none)}</option>`+S.people.map(p=>`<option value="${esc(p.id)}"${p.id===cur?' selected':''}>${esc(p.name)}</option>`).join('');
  const eopt=(cur,none)=>`<option value="">${esc(none)}</option>`+S.entities.map(e=>`<option value="${esc(e.id)}"${e.id===cur?' selected':''}>${esc(e.name)}</option>`).join('');
  const ents=S.entities.map(e=>`<div class="wh-row"><div class="field"><label for="ent-name-${esc(e.id)}">Название юрлица</label><input id="ent-name-${esc(e.id)}" class="inp" value="${esc(e.name)}" data-on="ent-name" data-id="${esc(e.id)}" autocomplete="off"></div></div>`).join('');
  const bl=S.billing||{},billerSet=!!(bl.billerId&&person(bl.billerId));
  // типы менеджеров — роли со scope (b2b, b2c)
  const scopes=[...new Set(S.roles.filter(r=>r.scope).map(r=>r.scope))];
  const sellers=scopes.map(k=>`<div class="field"><label for="seller-by-${esc(k)}">Менеджер ${esc(k.toUpperCase())} продаёт от</label><select id="seller-by-${esc(k)}" class="inp" data-on="seller-by" data-scope="${esc(k)}">${eopt((bl.seller||{})[k],'не задано — выбирает в заявке')}</select></div>`).join('');
  const cities=S.cities.map(c=>`<div class="wh-row city"><div class="field"><label for="city-name-${esc(c.id)}">Город</label><input id="city-name-${esc(c.id)}" class="inp" value="${esc(c.name)}" data-on="city-name" data-id="${esc(c.id)}" autocomplete="off"></div><div class="field"><label for="city-addr-${esc(c.id)}">Адрес склада</label><input id="city-addr-${esc(c.id)}" class="inp" value="${esc(c.address||'')}"${c.address?'':' placeholder="нет данных: адрес"'} data-on="city-addr" data-id="${esc(c.id)}" autocomplete="off"></div></div>`).join('');
  return `<section class="card"><div class="card-h"><h3>Юрлица</h3></div><div class="card-b stack-s">
    <p class="hint">Юрлицо — строка в таблице остатков (ИП, НПП, ВС). Переименование меняет название везде, остатки остаются на месте.</p>
    ${ents}
    <form class="wh-add" data-form="entity-add" novalidate><div class="field"><label for="ent-new">Новое юрлицо</label><input id="ent-new" class="inp" placeholder="Название" autocomplete="off"></div><button class="btn" type="submit">${ic('plus')}Добавить</button></form>
    <p class="err" id="ent-err" hidden></p>
  </div></section>
  <section class="card"><div class="card-h"><h3>Продажа между юрлицами</h3></div><div class="card-b stack-s">
    <p class="hint">В заявке на продажу менеджер видит, на каком юрлице лежит товар, и выбирает, от какого юрлица продаёт. Есть товар чужого юрлица — после сохранения CRM спрашивает «Запросить счёт?», и по «Запросить» ставит задачу «Выставить счёт» сотруднику ниже.</p>
    <div class="field"><label for="biller">Счета между юрлицами выставляет</label><select id="biller" class="inp" data-on="biller">${popt(billerSet?bl.billerId:'','не выбран')}</select>${billerSet?'':'<small class="hint">нет данных: кто выставляет счета (сейчас — директор)</small>'}</div>
    <div class="grid2">${sellers||'<p class="muted m0">Ролей с типом B2B или B2C нет.</p>'}</div>
  </div></section>
  <section class="card"><div class="card-h"><h3>Города и склады</h3></div><div class="card-b stack-s">
    <p class="hint">Город — где физически лежит товар (Иркутск, Москва, Краснодар). В таблице менеджеров города нет, поэтому остатки из неё стоят в колонке «нет данных: город».</p>
    ${cities}
    <form class="wh-add" data-form="city-add" novalidate><div class="field"><label for="city-new">Новый город</label><input id="city-new" class="inp" placeholder="Название" autocomplete="off"></div><div class="field"><label for="city-new-addr">Адрес склада</label><input id="city-new-addr" class="inp" placeholder="Можно заполнить позже" autocomplete="off"></div><button class="btn" type="submit">${ic('plus')}Добавить</button></form>
    <p class="err" id="city-err" hidden></p>
  </div></section>
  <section class="card"><div class="card-h"><h3>Откуда данные</h3></div><div class="card-b stack-s">
    <p class="m0"><b>Источник каталога:</b> копия таблицы для CRM — нет данных: ссылка; сейчас — снимок таблицы PVCalc на ${snapRu(CATALOG.snapshot)}.</p>
    ${SERVER&&can('catalog')?`<p class="m0"><button type="button" class="btn sm" data-act="catalog-merge">${ic('box')}Обновить каталог из снимка</button> <small class="hint">Добавит товары снимка, которых ещё нет в номенклатуре, и допишет артикулы и данные поставщика там, где они пусты. Введённое вручную, названия и цены не меняются.</small></p>`:''}
    ${stockSources()}
  </div></section>`;
}
SETTINGS_TABS.push({id:'stock',label:'Склады и юрлица',order:60,ok:()=>can('settings'),render:vWarehouses});
