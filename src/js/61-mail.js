// Раздел «Почта»: слева ящики и папки поставщиков со счётчиками непрочитанных, в середине список писем с поиском,
// справа письмо. Это имитация: ответ только ложится в ветку письма с пометкой, наружу ничего не уходит.
// Всё считает ядро Mail (ящики, папки, поиск, «запомнить», ответ, приход письма); здесь — только экран.
// Выбор на экране (ящик, папка, письмо, поиск) лежит в S.ui.mail и не сохраняется; вид его читает через mailSel()
// и ничего не меняет. На телефоне показывается один столбец (S.ui.mail.pane: nav · list · letter) с кнопкой «назад».

Object.assign(IC,{
  mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 7.5l8.5 6 8.5-6"/>',
  back:'<path d="M15 5l-7 7 7 7"/>'
});

const MAIL_LATER='подключение — на следующем этапе';
const MAIL_NO_ADDR='нет данных: адрес';

const mailData=()=>S.mail||{boxes:[],suppliers:[],letters:[]};
const mailU=()=>S.ui.mail||(S.ui.mail={});

// Что выбрано сейчас: ящик из видимых этому человеку, папка (только в ящике закупок), письмо, поиск, столбец на телефоне.
function mailSel(){
  const m=mailData(),u=S.ui.mail||{},boxes=Mail.boxesFor(S,S.me);
  const box=boxes.find(b=>b.id===u.box)||boxes[0]||null;
  const purchase=!!box&&box.kind==='purchase';
  const folder=purchase&&(u.folder===Mail.INBOX||m.suppliers.some(s=>s.id===u.folder))?u.folder:'all';
  const letter=box&&u.letter?m.letters.find(l=>l.id===u.letter&&l.boxId===box.id)||null:null;
  const pane=letter&&u.pane==='letter'?'letter':u.pane==='nav'?'nav':'list';
  return {boxes,box,purchase,folder,q:String(u.q||''),letter,pane,reply:!!letter&&u.reply===letter.id};
}
// Письма выбранного ящика и папки с учётом поиска — одним поиском ядра
const mailList=sel=>sel.box?Mail.search(S,{boxId:sel.box.id,folder:sel.folder==='all'?'':sel.folder,q:sel.q}):[];
// Непрочитанные в ящике или в его папке — единственный счёт для счётчиков в папках, ящиках и меню
const mailUnread=(boxId,folder)=>Mail.search(S,{boxId,folder:folder&&folder!=='all'?folder:''}).filter(l=>!l.read).length;
const mailUnreadAll=()=>Mail.boxesFor(S,S.me).reduce((n,b)=>n+mailUnread(b.id),0);
const mailFolderName=(box,l)=>{const s=mailData().suppliers.find(x=>x.id===l.folder);return s?s.name:box&&box.kind==='purchase'?'Разобрать':'Входящие'};
const mailCnt=n=>n?`<span class="cnt hot">${n}</span>`:'';

function mailNav(sel){
  const m=mailData();
  const boxes=sel.boxes.map(b=>{
    const on=b.id===sel.box?.id,n=mailUnread(b.id);
    let h=`<button type="button" class="mail-box${on?' on':''}" data-act="mail-box" data-id="${esc(b.id)}"><span class="mail-box-t"><b>${esc(b.title)}</b>${mailCnt(n)}</span><small class="${b.address?'':'muted'}">${b.address?esc(b.address):MAIL_NO_ADDR}</small>${b.added?`<span class="pill sun sm">${MAIL_LATER}</span>`:''}</button>`;
    if(on&&b.kind==='purchase'){
      const f=(id,label,example)=>`<button type="button" class="mail-fold${sel.folder===id?' on':''}" data-act="mail-folder" data-folder="${esc(id)}"><span>${esc(label)}${example?' <span class="pill sm">пример</span>':''}</span>${mailCnt(mailUnread(b.id,id))}</button>`;
      h+=`<div class="mail-folds">${f('all','Все письма')}${f(Mail.INBOX,'Разобрать')}${m.suppliers.map(s=>f(s.id,s.name,s.example)).join('')}</div>`;
    }
    return h;
  }).join('');
  return `<aside class="mail-nav card"><div class="card-h"><h3>Ящики</h3></div><div class="mail-nav-b">${boxes}</div></aside>`;
}

function mailItems(sel){
  const list=mailList(sel),un=list.filter(l=>!l.read).length;
  const head=`<p class="count"><span>${sel.q.trim()?'Найдено':'Писем'}: <b>${list.length}</b></span><span>непрочитанных: <b>${un}</b></span></p>`;
  if(!list.length) return head+`<p class="empty">${sel.q.trim()?'По этому запросу писем нет.':sel.box&&sel.box.added?`В новом ящике писем пока нет — ${MAIL_LATER}.`:'В этой папке писем нет.'}</p>`;
  return head+`<ul class="mail-items">${list.map(l=>{
    const sn=l.body.replace(/\s+/g,' ').slice(0,90);
    return `<li><button type="button" class="mail-li${l.read?'':' unread'}${l.id===sel.letter?.id?' on':''}" data-act="mail-open" data-id="${esc(l.id)}"><span class="mail-li-top"><b>${esc(l.fromName||l.from)}</b><small>${esc(fWhen(l.at))}</small></span><span class="mail-li-sub">${esc(l.subject)}</span><span class="mail-li-sn">${esc(sn)}</span><span class="mail-li-tags">${l.demo?'<span class="pill sm">пример</span>':''}${sel.purchase&&sel.folder==='all'?`<span class="pill sm info">${esc(mailFolderName(sel.box,l))}</span>`:''}${(l.replies||[]).length?'<span class="pill sm sun">есть ответ</span>':''}</span></button></li>`;
  }).join('')}</ul>`;
}

function mailListPane(sel){
  const m=mailData();
  const fname=!sel.purchase||sel.folder==='all'?'':sel.folder===Mail.INBOX?'Разобрать':(m.suppliers.find(s=>s.id===sel.folder)?.name||'');
  return `<section class="mail-list card"><div class="mail-bar">
    <button type="button" class="btn ghost sm mail-back" data-act="mail-back">${ic('back')}Ящики и папки</button>
    <div class="mail-title"><b>${esc(sel.box.title)}</b>${fname?`<small>${esc(fname)}</small>`:''}</div>
    <div class="search-in">${ic('search')}<input id="mail-q" class="inp" type="search" placeholder="Поиск: отправитель, тема, текст" value="${esc(sel.q)}" data-on="mail-q" autocomplete="off" aria-label="Поиск по письмам"></div>
    <button type="button" class="btn sm" data-act="mail-sim" data-box="${esc(sel.box.id)}">${ic('plus')}Имитация: пришло письмо</button>
  </div><div id="mail-items">${mailItems(sel)}</div></section>`;
}

function mailRememberBox(sel,l){
  const m=mailData();
  if(!sel.purchase||l.folder!==Mail.INBOX) return '';
  if(!m.suppliers.length) return `<div class="mail-rem"><p class="hint">Это письмо лежит в «Разобрать». Поставщиков пока нет — добавьте их в «Настройки → Почта», и письма будут раскладываться по папкам.</p></div>`;
  const addr=(String(l.from).match(/<([^>]*)>/)?.[1]||l.from).trim().toLowerCase(),dom=addr.includes('@')?addr.slice(addr.lastIndexOf('@')):'';
  return `<form class="mail-rem" data-form="mail-remember" data-id="${esc(l.id)}" novalidate>
    <b>Это поставщик?</b>
    <div class="mail-rem-f">
      <div class="field"><label for="mail-sup">Это поставщик</label><select id="mail-sup" class="inp"><option value="">— выберите —</option>${m.suppliers.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="mail-mode">Запомнить</label><select id="mail-mode" class="inp"><option value="address">этот адрес — ${esc(addr)}</option>${dom?`<option value="domain">весь домен — ${esc(dom)}</option>`:''}</select></div>
      <button type="submit" class="btn pri">Запомнить адрес</button>
    </div>
    <p class="hint">Письма с этого адреса (или домена) перейдут в папку поставщика, новые будут ложиться туда сами.</p>
    <p class="err" id="mail-err" hidden></p></form>`;
}

function mailLetterPane(sel){
  const l=sel.letter;
  if(!l) return `<article class="mail-letter card mail-empty"><p class="empty">Выберите письмо в списке.</p></article>`;
  const replies=(l.replies||[]).map(r=>`<div class="mail-reply"><div class="mail-reply-h"><b>Ответ: ${esc(person(r.by)?.name||'нет данных: сотрудник')}</b><small>${esc(fWhen(r.at))}</small><span class="pill sun sm">${esc(r.note||Mail.SIM_NOTE)}</span>${r.demo?'<span class="pill sm">пример</span>':''}</div><p>${esc(r.text)}</p></div>`).join('');
  const form=sel.reply
    ?`<form class="mail-reply-f" data-form="mail-reply" data-id="${esc(l.id)}" novalidate><div class="field"><label for="mail-reply-text">Ваш ответ</label><textarea id="mail-reply-text" class="inp" rows="4" placeholder="Текст ответа"></textarea></div><p class="hint">${Mail.SIM_NOTE}: ответ ляжет в ветку письма, наружу ничего не уйдёт.</p><p class="err" id="mail-reply-err" hidden></p><div class="mail-reply-btns"><button type="button" class="btn" data-act="mail-reply-cancel">Отмена</button><button type="submit" class="btn pri">Записать ответ</button></div></form>`
    :`<div><button type="button" class="btn" data-act="mail-reply">${ic('send')}Ответить</button></div>`;
  return `<article class="mail-letter card"><div class="mail-lh">
    <button type="button" class="btn ghost sm mail-back" data-act="mail-back">${ic('back')}К списку</button>
    <h2>${esc(l.subject)}</h2>
    <p class="mail-meta"><span>От: <b>${esc(l.fromName||l.from)}</b>${l.fromName?` &lt;${esc(l.from)}&gt;`:''}</span><span>${esc(fWhen(l.at))}</span><span>Ящик «${esc(sel.box.title)}» · ${esc(mailFolderName(sel.box,l))}</span>${l.demo?'<span class="pill sm">пример</span>':''}</p>
  </div><div class="mail-body">${esc(l.body)}</div>
  ${replies?`<div class="mail-replies"><h4>Ответы</h4>${replies}</div>`:''}
  <div class="mail-act">${form}${mailRememberBox(sel,l)}</div></article>`;
}

function vMail(){
  const sel=mailSel();
  if(!sel.box) return `<section class="card"><p class="empty">Для вашей роли нет ни одного ящика. Ящики и кто их видит — в «Настройки → Почта».</p></section>`;
  return `<p class="hint mail-hint">Почта — имитация: письма примерные, настоящий ящик не подключён, ответы наружу не уходят.</p>
  <div class="mail" data-pane="${sel.pane}">${mailNav(sel)}${mailListPane(sel)}${mailLetterPane(sel)}</div>`;
}

NAV.push({id:'mail',label:'Почта',icon:'mail',group:'Работа',order:40,ok:()=>can('mail')&&Mail.boxesFor(S,S.me).length>0,badge:mailUnreadAll,hot:true});
VIEWS.mail=vMail;

// ——— действия ———
A['mail-box']=el=>{Object.assign(mailU(),{box:el.dataset.id,folder:'all',letter:null,q:'',pane:'list',reply:null});render()};
A['mail-folder']=el=>{Object.assign(mailU(),{folder:el.dataset.folder,letter:null,pane:'list',reply:null});render()};
A['mail-open']=el=>{
  const l=mailData().letters.find(x=>x.id===el.dataset.id);if(!l) return;
  l.read=true;                       // открытое письмо — прочитано
  Object.assign(mailU(),{letter:l.id,pane:'letter',reply:null});render();
};
A['mail-back']=()=>{const u=mailU();u.pane=u.pane==='letter'?'list':'nav';render()};
A['mail-reply']=()=>{const sel=mailSel();if(!sel.letter) return;mailU().reply=sel.letter.id;render();setTimeout(()=>byId('mail-reply-text')?.focus(),0)};
A['mail-reply-cancel']=()=>{mailU().reply=null;render()};
A['mail-sim']=el=>mailSimulate(el.dataset.box);

ON.input['mail-q']=t=>{
  mailU().q=t.value;
  const box=byId('mail-items');if(box) box.innerHTML=mailItems(mailSel());
};

FORMS['mail-reply']=f=>{
  const r=Mail.reply(S,f.dataset.id,byId('mail-reply-text').value,S.me,new Date());
  if(!r) return showErr('mail-reply-err','Напишите текст ответа.');
  mailU().reply=null;render();
  toast(`Ответ записан в ветку письма — ${Mail.SIM_NOTE}.`);
};
FORMS['mail-remember']=f=>{
  const supId=byId('mail-sup').value;
  if(!supId) return showErr('mail-err','Выберите поставщика.');
  const res=Mail.remember(S,f.dataset.id,supId,byId('mail-mode').value);
  if(!res.ok) return showErr('mail-err',res.reason);
  const sup=mailData().suppliers.find(s=>s.id===supId);
  render();
  toast(`Запомнили ${res.rule} за «${sup.name}». В его папку переехало ${res.moved} ${pl(res.moved,'письмо','письма','писем')}.`);
};

// ——— имитация: пришло письмо ———
// Поочерёдно: письмо от известного поставщика (ляжет в его папку) и от незнакомого адреса (в «Разобрать»).
// В ящике без папок поставщиков — письмо клиента. Кладёт Mail.deliver: он же рассылает уведомление тем, кто видит ящик.
function mailSimulate(boxId){
  const m=mailData();
  const box=m.boxes.find(b=>b.id===boxId)||m.boxes.find(b=>b.kind==='purchase')||m.boxes[0];
  if(!box){toast('Ящиков нет — письму некуда прийти.','warn');return null}
  const n=m.letters.filter(l=>l.sim).length+1;
  let from,fromName,subject;
  const known=m.suppliers.filter(s=>(s.rules||[]).length);
  if(box.kind==='purchase'&&n%2===1&&known.length){
    const s=known[((n-1)/2)%known.length],r=s.rules[0];
    from=r.startsWith('@')?'sim'+r:r;fromName=s.name;subject='Пример: письмо от поставщика';
  }else if(box.kind==='purchase'){
    from=`new-${n}@unknown-${n}.example`;fromName='Незнакомый отправитель (пример)';subject='Пример: письмо от незнакомого адреса';
  }else{
    from=`client-sim-${n}@clients.example`;fromName='Клиент-пример';subject='Пример: вопрос от клиента';
  }
  const l=Mail.deliver(S,{boxId:box.id,from,fromName,subject,body:'Это пример входящего письма для проверки. Настоящая почта не подключена: письмо создано кнопкой «Имитация».',demo:true},new Date());
  if(!l) return null;
  l.sim=true;
  const to=(S.notes[0]&&S.notes[0].kind===Mail.NOTE_KIND?S.notes[0].to:[]).length;
  render();
  toast(`Пришло письмо в ящик «${box.title}», папка «${mailFolderName(box,l)}». Уведомление получили: ${to}.`);
  return l;
}
SIMS.push({id:'mail',label:'Имитация: пришло письмо',run:()=>{mailSimulate()}});
