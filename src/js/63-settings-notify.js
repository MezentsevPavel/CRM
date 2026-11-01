// «Настройки → Уведомления»: каждый сотрудник сам выбирает, о чём ему сообщать, и какой звук играть.
// Вкладка есть у всех, права не нужны: настройки личные (S.prefs.notify[человек], S.prefs.sound[человек]).
// Что кому приходит и когда играть звук — ядро Notify (37-notify.js): setWanted, setSound, soundFor.
// Здесь — подписи видов, синтез звуков в браузере (WebAudio, файлов нет) и проверка «пришло ли новое» при отрисовке.

// ——— виды уведомлений по-русски, по группам ———
// Каждый вид из Notify.RECIPIENTS должен быть здесь ровно один раз (это проверяет тест): иначе его нельзя было бы выключить.
const NOTIFY_GROUPS=[
  {title:'Работа',kinds:[
    ['task','Задачи','Поставили задачу, сменили её этап, взяли задачу отдела.'],
    ['act','Дела','Подошёл срок дела по сделке или лиду.'],
  ]},
  {title:'Продажи',kinds:[
    ['lead','Лиды','Пришёл новый лид или лид передали вам.'],
    ['leadWait','Лид долго без действий','Новый лид ждёт дольше заданного времени. Приходит РОП, а если РОП нет — менеджерам типа лида; директору — всегда.'],
    ['msg','Сообщения клиентам','Пора сообщить клиенту, что его товар на складе.'],
    ['mail','Почта','Пришло новое письмо в ящик, который вы видите.'],
  ]},
  {title:'Склад и поставки',kinds:[
    ['ship','Поставки','Поставка сменила этап, точку на маршруте или срок.'],
    ['arrive','Приёмка: товар на складе','Груз принят на склад или в номенклатуру добавили товар.'],
    ['warn','Приёмка с замечаниями','При приёмке нашли расхождения или повреждения.'],
    ['reserve','Резервы','Товар зарезервировали или резерв сняли.'],
  ]},
  {title:'Отправки',kinds:[
    ['dispatch','Отправки: новые заявки','Создана заявка на отправку. Приходит логисту и кладовщику.'],
    ['dispatchStep','Отправки: ход заявки','Ваша заявка сменила этап или вам назначили отправку.'],
  ]},
];
const NOTIFY_KINDS=NOTIFY_GROUPS.flatMap(g=>g.kinds.map(([id,name,what])=>({id,name,what,group:g.title})));
const soundName=id=>(Notify.SOUNDS.find(s=>s[0]===id)||[])[1]||'нет данных: звук';

// ——— звуки: ноты ———
// Нота: f — частота, Гц (f2 — до какой частоты скользит), at — когда начать, с, dur — длина, с,
// vol — громкость 0…1, type — форма волны. Список звуков и подписи — Notify.SOUNDS.
const SOUND_NOTES={
  bell:[{f:880,at:0,dur:1.1,vol:.28,type:'sine'},{f:1760,at:0,dur:.7,vol:.12,type:'sine'},{f:2637,at:0,dur:.4,vol:.05,type:'sine'}],
  drop:[{f:1100,f2:380,at:0,dur:.28,vol:.3,type:'sine'}],
  double:[{f:740,at:0,dur:.14,vol:.2,type:'triangle'},{f:740,at:.2,dur:.14,vol:.2,type:'triangle'}],
  soft:[{f:523,at:0,dur:.5,vol:.22,type:'triangle'},{f:659,at:.16,dur:.7,vol:.2,type:'triangle'}],
};
// Один звуковой контекст на страницу (браузер не любит их десятки); Ctx — конструктор, по умолчанию из браузера.
let audio={C:null,ctx:null};
// Сыграть звук. Без WebAudio (в тестах, в старом браузере) или если браузер не дал — тишина и false, ошибки нет.
function playSound(kind,Ctx){
  const notes=SOUND_NOTES[kind];
  const C=Ctx||(typeof AudioContext!=='undefined'?AudioContext:typeof webkitAudioContext!=='undefined'?webkitAudioContext:null);
  if(!notes||!C) return false;
  try{
    if(audio.C!==C) audio={C,ctx:new C()};
    const ctx=audio.ctx,t0=ctx.currentTime;
    if(ctx.state==='suspended'&&ctx.resume) ctx.resume();
    for(const n of notes){
      const osc=ctx.createOscillator(),g=ctx.createGain(),a=t0+n.at,b=a+n.dur;
      osc.type=n.type;
      osc.frequency.setValueAtTime(n.f,a);
      if(n.f2) osc.frequency.exponentialRampToValueAtTime(n.f2,b);
      g.gain.setValueAtTime(.0001,a);
      g.gain.exponentialRampToValueAtTime(n.vol,a+.015);
      g.gain.exponentialRampToValueAtTime(.0001,b);
      osc.connect(g);g.connect(ctx.destination);
      osc.start(a);osc.stop(b+.05);
    }
    return true;
  }catch(_){return false}
}

// ——— звук при новом уведомлении ———
// render() зовёт после каждой отрисовки. Помним, какие уведомления были непрочитанными в прошлый раз;
// появилось новое и звук включён — играем. Первая отрисовка и смена «кто я» звука не дают: это не новое.
let chimeSeen=null;
let chimeLast=null;   // какой звук играл последним
let chimes=0;         // сколько раз играл
function chimeCheck(){
  const ids=Notify.unreadIds(S,S.me),before=chimeSeen&&chimeSeen.me===S.me?chimeSeen.ids:null;
  chimeSeen={me:S.me,ids};
  const kind=Notify.soundFor(S,S.me,before,ids);
  if(kind){chimeLast=kind;chimes++;playSound(kind)}
  return kind;
}

// ——— вкладка ———
function vNotifySettings(){
  const m=me(),pref=Notify.soundPref(S,S.me);
  const sw=(id,on,attrs,label)=>`<label class="sw"><input type="checkbox" id="${id}" ${attrs} ${on?'checked':''} aria-label="${esc(label)}"><span class="sw-t" aria-hidden="true"></span></label>`;
  const groups=NOTIFY_GROUPS.map(g=>`<h4 class="nset-g">${esc(g.title)}</h4><ul class="nset-list">${g.kinds.map(([id,name,what])=>`<li class="nset-row">${sw('nk-'+id,Notify.wants(S,S.me,id),`data-on="note-kind" data-kind="${id}"`,name)}<div class="nset-t"><b>${esc(name)}</b><span>${esc(what)}</span></div></li>`).join('')}</ul>`).join('');
  const sounds=`<div class="seg" role="radiogroup" aria-label="Звук уведомления">${Notify.SOUNDS.map(([id,name])=>`<button type="button" role="radio" aria-checked="${id===pref.kind}" class="${id===pref.kind?'on':''}" data-act="sound-pick" data-kind="${id}">${esc(name)}</button>`).join('')}</div>`;
  return `<section class="card"><div class="card-h"><h3>О чём вам сообщать</h3><span class="muted sm">${esc(m.name)}</span></div><div class="card-b">
    <p class="hint">Это ваши личные настройки. Выключенный вид вам не приходит, остальным сотрудникам приходит как раньше. По умолчанию включено всё.</p>${groups}
  </div></section>
  <section class="card"><div class="card-h"><h3>Звук</h3><span class="muted sm">${esc(m.name)}</span></div><div class="card-b stack-s">
    <div class="nset-row">${sw('snd-on',pref.on,'data-on="sound-on"','Звук нового уведомления')}<div class="nset-t"><b>Играть звук, когда приходит новое уведомление</b><span>Звук синтезируется в браузере, ничего не скачивается. Играет, пока CRM открыта.</span></div></div>
    <div class="field"><span class="lbl">Какой звук</span>${sounds}</div>
    <div class="nset-test"><button type="button" class="btn" data-act="sound-test">${ic('bell')}Проверить</button><span class="hint">Сыграет выбранный звук. Если тихо — проверьте громкость устройства: браузер молчит, пока на странице не было ни одного нажатия.</span></div>
  </div></section>${SERVER?notifyPopupCard():''}`;
}
// Серверный режим: всплывающие системные уведомления, когда вкладка CRM свёрнута (разрешение даёт браузер)
function notifyPopupCard(){
  const st=srvNotifyState();
  const text={granted:'Разрешены в этом браузере: новое уведомление всплывёт, когда вкладка CRM свёрнута. Щелчок по нему открывает запись.',denied:'Браузер запретил всплывающие уведомления для CRM. Разрешить можно в настройках сайта в браузере (значок слева от адреса). Пока — звук и колокол.',default:'Пока не разрешены: приходят звук и колокол. Разрешите — и новое уведомление всплывёт, даже когда вкладка CRM свёрнута.',none:'Этот браузер не умеет всплывающие уведомления: приходят звук и колокол.'}[st];
  return `<section class="card"><div class="card-h"><h3>Всплывающие уведомления</h3></div><div class="card-b stack-s">
    <p class="m0">${esc(text)}</p>
    ${st==='default'?`<div><button type="button" class="btn pri" data-act="srv-notify-perm">${ic('bell')}Разрешить всплывающие уведомления</button></div>`:''}
  </div></section>`;
}

SETTINGS_TABS.push({id:'notify',label:'Уведомления',order:20,ok:()=>true,render:vNotifySettings});

ON.change['note-kind']=t=>{
  const k=NOTIFY_KINDS.find(x=>x.id===t.dataset.kind);
  if(!k||!Notify.setWanted(S,S.me,k.id,t.checked)) return;
  toast(t.checked?`Вид «${k.name}» включён: такие уведомления будут приходить вам.`:`Вид «${k.name}» выключен: вам такие уведомления не приходят, остальным — как раньше.`);
};
ON.change['sound-on']=t=>{
  const r=Notify.setSound(S,S.me,{on:t.checked});
  if(r) toast(t.checked?`Звук включён: «${soundName(r.kind)}». Он сыграет, когда придёт новое уведомление.`:'Звук выключен: новые уведомления приходят без звука.');
};
A['sound-pick']=el=>{
  const r=Notify.setSound(S,S.me,{kind:el.dataset.kind});
  if(!r) return;
  render();
  toast(`Звук: «${soundName(r.kind)}».${r.on?'':' Он выключен — включите переключатель выше. Послушать можно кнопкой «Проверить».'}`);
};
A['sound-test']=()=>{
  const p=Notify.soundPref(S,S.me);
  if(!playSound(p.kind)) return toast('Не удалось сыграть: браузер не даёт включить звук. Нажмите «Проверить» ещё раз или проверьте громкость.','warn');
  toast(`Играет «${soundName(p.kind)}».${p.on?'':' Звук уведомлений сейчас выключен.'}`);
};
