// Настройки → «Склады и юрлица»: справочники юрлиц и городов (добавить, переименовать, адрес склада)
// и откуда взят каталог. Справочники лежат в S.entities и S.cities: сетка остатков, форма резерва и журнал
// берут названия оттуда же, поэтому переименование видно везде сразу.

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
ON.change['city-addr']=t=>{
  const c=S.cities.find(x=>x.id===t.dataset.id);if(!c) return;
  c.address=String(t.value).trim();
  toast(c.address?`Адрес склада «${c.name}» сохранён.`:`Адрес склада «${c.name}» очищен: нет данных.`);
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

function vWarehouses(){
  const total=STOCK_SNAPSHOT.rows.length,glued=total-Catalog.base().unmatched.length;
  const ents=S.entities.map(e=>`<div class="wh-row"><div class="field"><label for="ent-name-${esc(e.id)}">Название юрлица</label><input id="ent-name-${esc(e.id)}" class="inp" value="${esc(e.name)}" data-on="ent-name" data-id="${esc(e.id)}" autocomplete="off"></div></div>`).join('');
  const cities=S.cities.map(c=>`<div class="wh-row city"><div class="field"><label for="city-name-${esc(c.id)}">Город</label><input id="city-name-${esc(c.id)}" class="inp" value="${esc(c.name)}" data-on="city-name" data-id="${esc(c.id)}" autocomplete="off"></div><div class="field"><label for="city-addr-${esc(c.id)}">Адрес склада</label><input id="city-addr-${esc(c.id)}" class="inp" value="${esc(c.address||'')}"${c.address?'':' placeholder="нет данных: адрес"'} data-on="city-addr" data-id="${esc(c.id)}" autocomplete="off"></div></div>`).join('');
  return `<section class="card"><div class="card-h"><h3>Юрлица</h3></div><div class="card-b stack-s">
    <p class="hint">Юрлицо — строка в таблице остатков (ИП, НПП, ВС). Переименование меняет название везде, остатки остаются на месте.</p>
    ${ents}
    <form class="wh-add" data-form="entity-add" novalidate><div class="field"><label for="ent-new">Новое юрлицо</label><input id="ent-new" class="inp" placeholder="Название" autocomplete="off"></div><button class="btn" type="submit">${ic('plus')}Добавить</button></form>
    <p class="err" id="ent-err" hidden></p>
  </div></section>
  <section class="card"><div class="card-h"><h3>Города и склады</h3></div><div class="card-b stack-s">
    <p class="hint">Город — где физически лежит товар (Иркутск, Москва, Краснодар). В таблице менеджеров города нет, поэтому остатки из неё стоят в колонке «нет данных: город».</p>
    ${cities}
    <form class="wh-add" data-form="city-add" novalidate><div class="field"><label for="city-new">Новый город</label><input id="city-new" class="inp" placeholder="Название" autocomplete="off"></div><div class="field"><label for="city-new-addr">Адрес склада</label><input id="city-new-addr" class="inp" placeholder="Можно заполнить позже" autocomplete="off"></div><button class="btn" type="submit">${ic('plus')}Добавить</button></form>
    <p class="err" id="city-err" hidden></p>
  </div></section>
  <section class="card"><div class="card-h"><h3>Откуда данные</h3></div><div class="card-b stack-s">
    <p class="m0"><b>Источник каталога:</b> копия таблицы для CRM — нет данных: ссылка; сейчас — снимок таблицы PVCalc на ${snapRu(CATALOG.snapshot)}.</p>
    <p class="m0"><b>Остатки:</b> ${stockNote()}. Дальше остатки меняются движениями в CRM.</p>
    <p class="m0">Склеено по названию ${glued} из ${total} строк таблицы менеджеров; остальные — «нет в каталоге».</p>
  </div></section>`;
}
SETTINGS_TABS.push({id:'stock',label:'Склады и юрлица',order:60,ok:()=>can('settings'),render:vWarehouses});
