// Настройки → «Почта»: ящики (добавить, адрес, кто видит) и поставщики (добавить, переименовать, правила-адреса,
// удалить). Данные лежат в S.mail, раздел «Почта» читает их оттуда же, поэтому правка видна там сразу.
// Правило поставщика — точный адрес (sales@firma.ru) или весь домен (@firma.ru); письма раскладывает Mail.folderOf.

const mailSame=(a,b)=>String(a).trim().toLowerCase().replace(/ё/g,'е')===String(b).trim().toLowerCase().replace(/ё/g,'е');
const MAIL_ADDR=/^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// «sales@firma.ru, @firma.ru, firma.ru» → правила; bad — то, что на адрес или домен не похоже
function mailParseRules(text){
  const rules=[],bad=[];
  for(let r of String(text||'').toLowerCase().split(/[\s,;]+/).filter(Boolean)){
    if(!r.includes('@')&&/^[^\s.]+(\.[^\s.]+)+$/.test(r)) r='@'+r;           // «firma.ru» → весь домен
    if(/^@[^@\s]+\.[^@\s]+$/.test(r)||MAIL_ADDR.test(r)){if(!rules.includes(r)) rules.push(r)}else bad.push(r);
  }
  return {rules,bad};
}
// Правило уже у другого поставщика: у одного правила один хозяин
const mailRuleOwner=(rule,exceptId)=>mailData().suppliers.find(s=>s.id!==exceptId&&(s.rules||[]).some(r=>mailSame(r,rule)))||null;
// Разложить все письма заново по правилам; → сколько писем сменили папку
function mailRefile(){
  let moved=0;
  for(const l of mailData().letters){const f=Mail.folderOf(S,l);if(f!==l.folder){l.folder=f;moved++}}
  return moved;
}
// Удаление поставщика: его письма уходят в «Разобрать», правила уходят вместе с ним
function mailDeleteSupplier(supId){
  const m=mailData(),i=m.suppliers.findIndex(s=>s.id===supId);
  if(i<0) return {ok:false,moved:0,name:''};
  const [sup]=m.suppliers.splice(i,1);
  let moved=0;
  for(const l of m.letters) if(l.folder===supId){l.folder=Mail.INBOX;moved++}
  return {ok:true,moved,name:sup.name};
}
const mailRoleNames=b=>{
  const names=S.roles.filter(r=>r.all||(b.roles||[]).includes(r.id)).map(r=>r.name);
  return names.join(', ');
};

// ——— ящики ———
ON.change['mbox-title']=t=>{
  const b=mailData().boxes.find(x=>x.id===t.dataset.id);if(!b) return;
  const name=t.value.trim();
  if(!name||mailData().boxes.some(x=>x.id!==b.id&&mailSame(x.title,name))){
    t.value=b.title;toast(!name?'Название ящика не может быть пустым.':`Ящик «${name}» уже есть.`,'warn');return;
  }
  if(name===b.title) return;
  const old=b.title;b.title=name;render();toast(`Ящик «${old}» теперь называется «${name}».`);
};
ON.change['mbox-addr']=t=>{
  const b=mailData().boxes.find(x=>x.id===t.dataset.id);if(!b) return;
  const addr=t.value.trim();
  if(addr&&!MAIL_ADDR.test(addr)){t.value=b.address||'';toast('Адрес должен быть вида name@firma.ru.','warn');return}
  b.address=addr;render();
  toast(addr?`Адрес ящика «${b.title}» сохранён. Подключения пока нет — оно на следующем этапе.`:`Адрес ящика «${b.title}» очищен: нет данных.`);
};
ON.change['mbox-role']=t=>{
  const b=mailData().boxes.find(x=>x.id===t.dataset.id);if(!b) return;
  const roles=(b.roles||[]).filter(r=>r!==t.dataset.role);
  if(t.checked) roles.push(t.dataset.role);
  b.roles=roles;render();
  toast(`Ящик «${b.title}» видят: ${mailRoleNames(b)}.`);
};
FORMS['mbox-add']=()=>{
  const m=mailData(),title=byId('mbox-new-title').value.trim(),addr=byId('mbox-new-addr').value.trim();
  if(!title) return showErr('mbox-err','Напишите название ящика.');
  if(m.boxes.some(b=>mailSame(b.title,title))) return showErr('mbox-err',`Ящик «${title}» уже есть.`);
  if(addr&&!MAIL_ADDR.test(addr)) return showErr('mbox-err','Адрес должен быть вида name@firma.ru. Можно оставить пустым — будет «нет данных: адрес».');
  const roles=S.roles.filter(r=>!r.all&&byId('mbox-new-role-'+r.id)?.checked).map(r=>r.id);
  const box={id:Store.freeId(m.boxes,'box'),kind:'other',title,address:addr,roles,added:true};
  m.boxes.push(box);
  render();
  toast(`Ящик «${title}» добавлен. Видят: ${mailRoleNames(box)}. В «Почте» он с пометкой «${MAIL_LATER}».`);
};

// ——— поставщики ———
ON.change['msup-name']=t=>{
  const s=mailData().suppliers.find(x=>x.id===t.dataset.id);if(!s) return;
  const name=t.value.trim();
  if(!name||mailData().suppliers.some(x=>x.id!==s.id&&mailSame(x.name,name))){
    t.value=s.name;toast(!name?'Название поставщика не может быть пустым.':`Поставщик «${name}» уже есть.`,'warn');return;
  }
  if(name===s.name) return;
  const old=s.name;s.name=name;s.example=false;           // своё название — уже не пример
  render();toast(`Поставщик «${old}» теперь называется «${name}».`);
};
ON.change['msup-rules']=t=>{
  const s=mailData().suppliers.find(x=>x.id===t.dataset.id);if(!s) return;
  const {rules,bad}=mailParseRules(t.value);
  const back=()=>{t.value=(s.rules||[]).join(', ')};
  if(bad.length){back();toast(`Не похоже на адрес или домен: ${bad.join(', ')}. Пишите sales@firma.ru или @firma.ru.`,'warn');return}
  const dup=rules.map(r=>[r,mailRuleOwner(r,s.id)]).find(x=>x[1]);
  if(dup){back();toast(`Правило ${dup[0]} уже у поставщика «${dup[1].name}».`,'warn');return}
  s.rules=rules;
  const moved=mailRefile();
  render();
  toast(`Правила «${s.name}» сохранены.${moved?` Письма переложены по папкам: ${moved}.`:''}${rules.length?'':' Правил нет — письма этого поставщика не будут раскладываться.'}`);
};
FORMS['msup-add']=()=>{
  const m=mailData(),name=byId('msup-new-name').value.trim();
  if(!name) return showErr('msup-err','Напишите название поставщика.');
  if(m.suppliers.some(s=>mailSame(s.name,name))) return showErr('msup-err',`Поставщик «${name}» уже есть.`);
  const {rules,bad}=mailParseRules(byId('msup-new-rules').value);
  if(bad.length) return showErr('msup-err',`Не похоже на адрес или домен: ${bad.join(', ')}. Пишите sales@firma.ru или @firma.ru.`);
  const dup=rules.map(r=>[r,mailRuleOwner(r)]).find(x=>x[1]);
  if(dup) return showErr('msup-err',`Правило ${dup[0]} уже у поставщика «${dup[1].name}».`);
  m.suppliers.push({id:Store.freeId(m.suppliers,'sup'),name,example:false,rules});
  const moved=mailRefile();
  render();
  toast(`Поставщик «${name}» добавлен.${moved?` В его папку переехало писем: ${moved}.`:''}`);
};
A['msup-del']=el=>openModal('msup-del',el.dataset.id);
MODALS['msup-del']=id=>{
  const s=mailData().suppliers.find(x=>x.id===id);
  if(!s) return `<form data-form="msup-del" novalidate>${mHead('Поставщик не найден')}<div class="modal-b"><p class="m0">Такого поставщика уже нет.</p></div></form>`;
  const n=mailData().letters.filter(l=>l.folder===id).length;
  return `<form data-form="msup-del" data-id="${esc(id)}" novalidate>${mHead('Удалить поставщика?')}<div class="modal-b">
    <p class="m0">«${esc(s.name)}» и его правила-адреса будут удалены.</p>
    <p class="hint">${n?`Писем в его папке: ${n}. Они не пропадут — перейдут в «Разобрать».`:'В его папке писем нет.'}</p>
  </div>${mFoot('Удалить')}</form>`;
};
FORMS['msup-del']=f=>{
  const res=mailDeleteSupplier(f.dataset.id);
  closeModal();render();
  if(res.ok) toast(`Поставщик «${res.name}» удалён.${res.moved?` Писем перенесено в «Разобрать»: ${res.moved}.`:''}`);
};

// ——— экран ———
function vMailSettings(){
  const m=mailData(),roles=S.roles.filter(r=>!r.all);
  const roleBoxes=(b)=>roles.map(r=>`<label class="check"><input type="checkbox" ${(b.roles||[]).includes(r.id)?'checked':''} data-on="mbox-role" data-id="${esc(b.id)}" data-role="${esc(r.id)}"> ${esc(r.name)}</label>`).join('');
  const boxes=m.boxes.map(b=>`<div class="mset-box">
    <div class="stack-s">
      <div class="field"><label for="mbox-t-${esc(b.id)}">Название ящика</label><input id="mbox-t-${esc(b.id)}" class="inp" value="${esc(b.title)}" data-on="mbox-title" data-id="${esc(b.id)}" autocomplete="off"></div>
      <div class="field"><label for="mbox-a-${esc(b.id)}">Адрес ящика</label><input id="mbox-a-${esc(b.id)}" class="inp" value="${esc(b.address||'')}"${b.address?'':` placeholder="${MAIL_NO_ADDR}"`} data-on="mbox-addr" data-id="${esc(b.id)}" autocomplete="off"></div>
      ${b.added?`<span class="pill sun sm">${MAIL_LATER}</span>`:''}
    </div>
    <div class="field"><span class="lbl">Кто видит (директор — всегда)</span><div class="mset-roles">${roleBoxes(b)||'<span class="muted sm">Других ролей нет</span>'}</div></div>
  </div>`).join('');
  const sups=m.suppliers.map(s=>`<div class="mset-row">
    <div class="field"><label for="msup-n-${esc(s.id)}">Название</label><input id="msup-n-${esc(s.id)}" class="inp" value="${esc(s.name)}" data-on="msup-name" data-id="${esc(s.id)}" autocomplete="off">${s.example?'<span class="pill sm">пример</span>':''}</div>
    <div class="field"><label for="msup-r-${esc(s.id)}">Адреса и домены правила</label><input id="msup-r-${esc(s.id)}" class="inp" value="${esc((s.rules||[]).join(', '))}"${(s.rules||[]).length?'':' placeholder="нет данных: адрес или домен"'} data-on="msup-rules" data-id="${esc(s.id)}" autocomplete="off"></div>
    <button type="button" class="btn sm" data-act="msup-del" data-id="${esc(s.id)}">Удалить</button>
  </div>`).join('');
  return `<section class="card"><div class="card-h"><h3>Ящики</h3></div><div class="card-b stack-s">
    <p class="hint">Ящик видят директор и роли, отмеченные галочками. Настоящее подключение к почте — на следующем этапе: сейчас ящики работают как имитация.</p>
    ${boxes||'<p class="empty">Ящиков нет.</p>'}
    <form class="stack-s" data-form="mbox-add" novalidate>
      <b>Добавить ящик</b>
      <div class="mset-add">
        <div class="field"><label for="mbox-new-title">Название</label><input id="mbox-new-title" class="inp" placeholder="Например: Гарантия" autocomplete="off"></div>
        <div class="field"><label for="mbox-new-addr">Адрес</label><input id="mbox-new-addr" class="inp" placeholder="Можно заполнить позже" autocomplete="off"></div>
        <div class="field wide"><span class="lbl">Кто видит</span><div class="mset-roles">${roles.map(r=>`<label class="check"><input type="checkbox" id="mbox-new-role-${esc(r.id)}"> ${esc(r.name)}</label>`).join('')}</div></div>
      </div>
      <p class="err" id="mbox-err" hidden></p>
      <div><button type="submit" class="btn pri">${ic('plus')}Добавить ящик</button></div>
    </form>
  </div></section>
  <section class="card"><div class="card-h"><h3>Поставщики и их папки</h3></div><div class="card-b stack-s">
    <p class="hint">Правило — точный адрес (sales@firma.ru) или весь домен (@firma.ru), через запятую. Письмо с такого адреса в ящике «Закупки» ложится в папку поставщика, остальные — в «Разобрать». Точный адрес сильнее домена. Названия и адреса в демо — примеры.</p>
    <div>${sups||'<p class="empty">Поставщиков нет.</p>'}</div>
    <form class="stack-s" data-form="msup-add" novalidate>
      <b>Добавить поставщика</b>
      <div class="mset-add">
        <div class="field"><label for="msup-new-name">Название</label><input id="msup-new-name" class="inp" placeholder="Как поставщик называется" autocomplete="off"></div>
        <div class="field"><label for="msup-new-rules">Адреса и домены правила</label><input id="msup-new-rules" class="inp" placeholder="Можно заполнить позже" autocomplete="off"></div>
      </div>
      <p class="err" id="msup-err" hidden></p>
      <div><button type="submit" class="btn pri">${ic('plus')}Добавить поставщика</button></div>
    </form>
  </div></section>`;
}
SETTINGS_TABS.push({id:'mail',label:'Почта',order:40,ok:()=>can('settings'),render:vMailSettings});
