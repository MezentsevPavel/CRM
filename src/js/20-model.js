// Справочники, демо-данные seed() по схеме v3, реестр SEEDS и расчёты над состоянием S.
// Права — Perms (31), воронки и этапы — Pipes (32), уведомления — Notify (37): здесь их только вызывают.
// Состояние S объявлено в оболочке (50), поднимает его запуск (90): из браузера или seed().

// ——— справочники ———
const CH={telegram:'Telegram',max:'MAX',phone:'Телефон'};
const CARRIERS=['Сборный груз, транспортная компания','Отдельная машина','Своя машина','Контейнер: море + железная дорога'];
const VARS=['{имя}','{товар}','{сделка}','{менеджер}','{адрес_склада}'];
const KIND={ship:{l:'Перевозки',ic:'truck',c:'info'},arrive:{l:'Склад',ic:'box',c:'ok'},task:{l:'Задачи',ic:'tasks',c:'pri'},reserve:{l:'Резервы',ic:'lock',c:'sun'},msg:{l:'Клиентам',ic:'chat',c:'violet'},warn:{l:'Предупреждения',ic:'alert',c:'bad'},lead:{l:'Лиды',ic:'users',c:'pri'},mail:{l:'Почта',ic:'mail',c:'info'}};
// Специализация инженера — главного инженера и инженера (R30)
const SPECIALTY={designer:'проектировщик',installer:'монтажник'};

// ——— демо-данные (примеры, не данные фирмы) ———
// seed() = базовое состояние + шаги SEEDS по порядку. Шаг — функция st => {…}, дописывает в st свой раздел.
// Следующие таски кладут свой шаг в своём файле: SEEDS.push(st => { … }).
const SEEDS=[];
function seed(){
  const st={
    v:3,me:'p1',view:'home',
    prefs:{theme:'auto',sound:{on:false,kind:'bell'},notify:{},ship:{}},
    roles:Perms.defaultRoles(),
    depts:[{id:'mgmt',name:'Руководство'},{id:'sales',name:'Продажи'},{id:'eng',name:'Инженерный'},{id:'stock',name:'Склад'},{id:'logistics',name:'Логистика'}],
    // демо-команда: все семь ролей, по два менеджера B2B и B2C; имена — примеры
    people:[
      {id:'p1',name:'Павел М.',role:'director',dept:'mgmt',demo:true},
      {id:'p2',name:'Анна С.',role:'managerB2c',dept:'sales',demo:true},
      {id:'p3',name:'Максим Л.',role:'managerB2b',dept:'sales',demo:true},
      {id:'p4',name:'Дмитрий В.',role:'chiefEngineer',dept:'eng',specialty:'designer',demo:true},
      {id:'p5',name:'Игорь К.',role:'warehouse',dept:'stock',demo:true},
      {id:'p6',name:'Ольга Д.',role:'logist',dept:'logistics',demo:true},
      {id:'p7',name:'Сергей Т.',role:'engineer',dept:'eng',specialty:'installer',demo:true},
      {id:'p8',name:'Артём Б.',role:'engineer',dept:'eng',specialty:'installer',demo:true},
      {id:'p9',name:'Ирина П.',role:'managerB2b',dept:'sales',demo:true},
      {id:'p10',name:'Олег Н.',role:'managerB2c',dept:'sales',demo:true},
      {id:'p11',name:'Наталья Р.',role:'engineer',dept:'eng',specialty:'designer',demo:true}
    ],
    pipelines:Pipes.defaults()
  };
  for(const step of SEEDS) step(st);
  return st;
}

// Шаг 1: демо-записи v2 — товары, поставки, резервы, сделки, задачи, переписка, движения, правила.
// Этап записи — id этапа её воронки (pipeId/boardId + stageId), не номер.
SEEDS.push(st=>{
  // отгрузки клиентам (исходящие) — своя воронка, как ST_OUT в v2
  st.pipelines.push({id:'shipsOut',kind:'ships',dir:'out',name:'Отгрузки клиентам',stages:[{id:'packed',name:'Собрано'},{id:'sent',name:'Отгружено'},{id:'onWay',name:'В пути'},{id:'delivered',name:'Доставлено',flag:'final'}]});
  const T=(id,title,deal,to,from,due,stageId,prio,desc,at)=>({id,title,deal,to,from,due,boardId:'tasksCommon',stageId,prio,desc,at});
  const D=(id,client,contact,kind,object,type,stageId,managerId,channel,amount)=>({id,client,contact,kind,object,type,pipeId:type==='b2b'?'dealsB2b':'dealsB2c',stageId,managerId,channel,amount,demo:true});
  Object.assign(st,{
    // товары и остатки кладёт шаг каталога (38-catalog.js) из снимков; ниже записи v2 ссылаются на товары по старым артикулам,
    // шаг каталога переводит их на настоящие позиции
    products:[],
    shipments:[
      {id:'П-1044',dir:'in',supplier:'Склад дистрибьютора, Москва',to:'Наш склад',carrier:'Сборный груз, транспортная компания',track:'ТТН 44-552018',pipeId:'ships',stageId:'arrived',eta:day(0,14),history:[{at:day(0,8,15),by:'p6',text:'Терминал транспортной компании в городе'}],items:[{productId:'CAB-6R',qty:500},{productId:'CAB-6B',qty:500},{productId:'MC4',qty:200},{productId:'CTRL-60',qty:6},{productId:'BOX-DC',qty:10}],demo:true},
      {id:'П-1041',dir:'in',supplier:'Поставщик инверторов, Москва',to:'Наш склад',carrier:'Сборный груз, транспортная компания',track:'ТТН 41-008352',pipeId:'ships',stageId:'toStock',eta:day(3,12),history:[{at:day(0,9,40),by:'p6',text:'Трасса М-7, Владимир'}],items:[{productId:'INV-H6',qty:10},{productId:'BAT-LFP-100',qty:16}],demo:true},
      {id:'П-1042',dir:'in',supplier:'Поставщик ветрогенераторов, Екатеринбург',to:'Наш склад',carrier:'Отдельная машина',track:'ТТН 42-110907',pipeId:'ships',stageId:'toStock',eta:day(-1,12),history:[{at:day(-1,18,5),by:'p6',text:'Казань, стоянка'}],items:[{productId:'WND-3K',qty:2},{productId:'MTR-3F',qty:5}],demo:true},
      {id:'П-1043',dir:'in',supplier:'Завод панелей, Китай',to:'Наш склад',carrier:'Контейнер: море + железная дорога',track:'Контейнер TGHU 482117 3',pipeId:'ships',stageId:'toStock',eta:day(6,12),history:[{at:day(-1,7,20),by:'p6',text:'Ж/д станция, Новосибирск'}],items:[{productId:'PV-550M',qty:120},{productId:'MNT-R4',qty:30}],demo:true},
      {id:'О-207',dir:'out',deal:'Д-305',supplier:'Наш склад',to:'Объект Д-305 · Волкова Мария',carrier:'Своя машина',track:'Отгрузка О-207',pipeId:'shipsOut',stageId:'onWay',eta:day(0,16),history:[{at:day(0,11,0),by:'p6',text:'Выехали со склада'}],items:[{productId:'PV-550M',qty:12},{productId:'MNT-R4',qty:3},{productId:'CAB-6R',qty:60}],demo:true},
      {id:'П-1038',dir:'in',supplier:'Производитель крепежа',to:'Наш склад',carrier:'Своя машина',track:'УПД 1038',pipeId:'ships',stageId:'inStock',eta:day(-2,15),history:[{at:day(-2,15,30),by:'p5',text:'Наш склад'}],items:[{productId:'MNT-R4',qty:24,got:24}],received:{at:day(-2,15,30),by:'p5',photos:3,urls:[],note:''},demo:true}
    ],
    reserves:[
      {id:'r1',productId:'PV-550M',dealId:'Д-311',qty:22,src:'stock',until:day(9)},
      {id:'r2',productId:'PV-550M',dealId:'Д-314',qty:36,src:'stock',until:day(5)},
      {id:'r3',productId:'PV-550M',dealId:'Д-320',qty:54,src:'П-1043',until:day(20)},
      {id:'r4',productId:'INV-H6',dealId:'Д-311',qty:2,src:'stock',until:day(9)},
      {id:'r5',productId:'INV-H6',dealId:'Д-318',qty:1,src:'stock',until:day(1)},
      {id:'r6',productId:'INV-H6',dealId:'Д-305',qty:1,src:'stock',until:day(4)},
      {id:'r7',productId:'BAT-LFP-100',dealId:'Д-311',qty:3,src:'П-1041',until:day(14)},
      {id:'r8',productId:'BAT-LFP-100',dealId:'Д-318',qty:2,src:'П-1041',until:day(14)},
      {id:'r9',productId:'INV-G10',dealId:'Д-314',qty:2,src:'stock',until:day(7)},
      {id:'r10',productId:'CTRL-60',dealId:'Д-318',qty:1,src:'П-1044',until:day(10)},
      {id:'r11',productId:'CAB-6R',dealId:'Д-311',qty:80,src:'stock',until:day(9)},
      {id:'r12',productId:'MC4',dealId:'Д-311',qty:20,src:'stock',until:day(9)},
      {id:'r13',productId:'WND-3K',dealId:'Д-305',qty:1,src:'П-1042',until:day(10)},
      {id:'r14',productId:'WND-3K',dealId:'Д-314',qty:2,src:'П-1042',until:day(12)},
      {id:'r15',productId:'BOX-DC',dealId:'Д-311',qty:1,src:'П-1044',until:day(10)}
    ],
    deals:[
      D('Д-311','Иванов Сергей','Сергей','Частный дом','Гибридная СЭС 12 кВт, АКБ 15 кВт·ч','b2c','delivery','p2','telegram',1180000),
      D('Д-314','КФХ Петровых','Николай','Фермерское хозяйство','Сетевая СЭС 20 кВт и два ветрогенератора по 3 кВт','b2b','payment','p3','max',2350000),
      D('Д-318','Смирнова Елена','Елена','Дача','Автономная СЭС 5 кВт','b2c','delivery','p2','max',640000),
      D('Д-320','ИП Кузнецов, автосервис','Андрей','Бизнес','Сетевая СЭС 30 кВт на кровле','b2b','offer','p3','telegram',2900000),
      D('Д-305','Волкова Мария','Мария','Частный дом','Ветро-солнечная станция 6 кВт','b2c','install','p2','max',910000),
      D('Д-322','Орлов Пётр','Пётр','Частный дом','СЭС около 15 кВт, нужен замер','b2c','calc','p10','phone',0)
    ],
    tasks:[
      T('t1','Подготовить КП на СЭС 30 кВт','Д-320',{t:'p',id:'p4'},'p3',day(2,18),'work','high','Кровля около 420 м², счётчик трёхфазный. Нужны два варианта по панелям.',day(-1,11,20)),
      T('t2','Однолинейная схема для автономной СЭС','Д-318',{t:'p',id:'p4'},'p2',day(4,18),'new','normal','',day(-1,9,0)),
      T('t3','Обзвонить клиентов с резервом под контейнер П-1043','',{t:'p',id:'p3'},'p1',day(-1,18),'work','high','Предупредить о сроках прихода панелей.',day(-3,10,0)),
      T('t4','Заказать доставку АКБ на объект после прихода П-1041','Д-311',{t:'d',id:'logistics'},'p2',day(4,18),'new','normal','',day(-1,15,0)),
      T('t5','Проверить комплектность крепежа из П-1038','',{t:'d',id:'stock'},'p6',day(0,18),'review','normal','',day(-2,16,0)),
      T('t6','Согласовать с клиентом дату пуска станции','Д-305',{t:'d',id:'eng'},'p2',day(1,18),'work','normal','',day(-1,16,0)),
      T('t7','Фото щита и инвертора после монтажа','Д-305',{t:'p',id:'p7'},'p2',day(2,18),'new','normal','Фото нужны для отчёта клиенту и в архив сделки.',day(-1,16,5)),
      T('t8','Выяснить у поставщика, когда будет третий ветрогенератор','Д-314',{t:'p',id:'p6'},'p1',day(0,18),'new','high','',day(-1,12,10)),
      T('t9','Выставить счёт на вторую часть оплаты','Д-314',{t:'p',id:'p3'},'p1',day(-3,18),'done','normal','',day(-5,10,0)),
      T('t10','Выезд на замер кровли','Д-322',{t:'d',id:'eng'},'p10',day(3,18),'new','normal','Клиент на связи только по телефону.',day(0,9,15))
    ],
    msgs:[
      {id:'m1',at:day(-4,12,10),deal:'Д-311',channel:'telegram',by:'p2',text:`Сергей, добрый день! Панели и инверторы зарезервировали за вами. Аккумуляторы едут, ориентир — ${fD(day(3))}.`},
      {id:'m2',at:day(-4,13,2),deal:'Д-311',channel:'telegram',inbound:true,text:'Спасибо, жду. Сообщите, когда можно будет забрать.'},
      {id:'m4',at:day(-3,17,45),deal:'Д-318',channel:'max',by:'p2',text:'Елена, контроллер и аккумуляторы уже в пути. Как придут на склад — напишем сюда же.'},
      {id:'m3',at:day(-2,15,32),deal:'Д-305',channel:'max',auto:true,text:'Мария, здравствуйте! Крепёж для вашей станции пришёл на склад. Отгрузку на объект согласуем с вами отдельно. Ваш менеджер — Анна С.'}
    ],
    moves:[
      {at:day(0,11,0),productId:'PV-550M',kind:'Отгрузка',qty:12,doc:'О-207',by:'p5'},
      {at:day(0,11,0),productId:'MNT-R4',kind:'Отгрузка',qty:3,doc:'О-207',by:'p5'},
      {at:day(0,11,0),productId:'CAB-6R',kind:'Отгрузка',qty:60,doc:'О-207',by:'p5'},
      {at:day(-1,10,5),productId:'PV-550M',kind:'Резерв',qty:22,doc:'Д-311',by:'p2'},
      {at:day(-2,15,30),productId:'MNT-R4',kind:'Приход',qty:24,doc:'П-1038',by:'p5'},
      {at:day(-3,12,40),productId:'PV-550M',kind:'Резерв',qty:36,doc:'Д-314',by:'p3'},
      {at:day(-5,9,30),productId:'INV-H6',kind:'Приход',qty:6,doc:'П-1035',by:'p5'},
      {at:day(-5,9,30),productId:'PV-550M',kind:'Приход',qty:60,doc:'П-1035',by:'p5'}
    ],
    rules:[
      {id:'arrive',on:true,when:'Товар клиента принят на склад',then:'Пишем клиенту в его мессенджер по шаблону ниже, менеджеру — уведомление'},
      {id:'late',on:true,when:'Поставка опаздывает больше чем на 1 день',then:'Уведомляем менеджеров сделок, которые ждут товар, и директора'},
      {id:'shipped',on:false,when:'Товар отгружен на объект клиента',then:'Пишем клиенту номер отгрузки и дату доставки'},
      {id:'resexp',on:true,when:'Резерв истекает через 2 дня',then:'Напоминаем менеджеру продлить или снять резерв'},
      {id:'overdue',on:true,when:'Задача просрочена',then:'Уведомляем исполнителя и того, кто поставил задачу'}
    ],
    tpl:'{имя}, здравствуйте! Ваш заказ пришёл на склад: {товар}. Можно забирать или договоримся о доставке. Адрес склада: {адрес_склада}. Ваш менеджер — {менеджер}, сделка {сделка}.',
    address:'',
    rcv:null
  });
});

// Шаг 2: демо-уведомления. Кому — решает Notify (карта RECIPIENTS + адресаты события).
// От старых к новым: push кладёт новое в начало. Вчерашнее и раньше — уже прочитано всеми адресатами.
SEEDS.push(st=>{
  st.notes=[];
  const N=(kind,by,at,text,extra)=>{const n=Notify.push(st,kind,by,text,at,extra);if(dd(at)<0) n.read=n.to.slice()};
  const dept=id=>st.people.filter(p=>p.dept===id).map(p=>p.id);
  N('arrive','p5',day(-2,15,30),'П-1038 принята на склад: крепёж на скатную кровлю, 24 компл. Фото: 3.');
  N('msg',null,day(-2,15,32),'Авто-сообщение в MAX: Волкова Мария (Д-305) — крепёж пришёл на склад.',['p2']);
  N('reserve','p2',day(-1,10,5),`Резерв: солнечная панель 550 Вт — 22 шт со склада для Д-311 (Иванов Сергей) до ${fD(day(9))}.`);
  N('task','p3',day(-1,11,20),`Новая задача: «Подготовить КП на СЭС 30 кВт» (Д-320), срок ${fD(day(2))}. От: Максим Л.`,['p4']);
  N('warn','p6',day(-1,12,0),'Поставщик сократил П-1042: ветрогенераторов 2 шт вместо 3. Под резервы не хватает 1 шт.');
  N('task','p2',day(-1,16,0),'Новая задача отделу «Инженерный»: согласовать с клиентом дату пуска станции (Д-305). От: Анна С.',dept('eng'));
  N('warn',null,day(-1,18,5),'П-1042 задерживается: машина стоит в Казани. Ветрогенераторы ждут сделки Д-305 и Д-314.');
  N('ship','p6',day(0,8,15),'П-1044 прибыла на терминал транспортной компании в городе: кабель, разъёмы MC4, контроллеры, щиты DC. На склад — сегодня.');
  N('ship','p6',day(0,9,40),`П-1041 (инверторы, АКБ) прошла Владимир. На складе ожидается ${fD(day(3))}.`);
  N('ship','p6',day(0,11,0),'Отгрузка О-207 выехала на объект Д-305 (Волкова Мария). Привезём к 16:00.');
});

const defaultUi=()=>({taskF:'all',taskDept:'all',cat:'Все',sq:'',deficit:false,logTab:'in',noteK:'all',noteScope:'all',tplCh:'telegram',drawer:null,modal:null,navOpen:false});

// ——— доступ и связи ———
// «Я» — человек S.me; права — только через Perms.can.
const can=p=>Perms.can(S,S.me,p);
const person=id=>S.people.find(p=>p.id===id);
const me=()=>person(S.me)||S.people[0]||{id:'',name:'нет данных: сотрудник',role:'',dept:''};
const roleName=p=>(p&&Perms.roleOf(S,p.id)?.name)||'нет данных: роль';
const deptName=id=>S.depts.find(d=>d.id===id)?.name||'нет данных: отдел';
// Товар по productId: ключ каталога, 'sheet-NNN' (строка остатков без пары в каталоге) или 'uN' (добавлен вручную)
const product=id=>S.products.find(p=>p.id===id);
const deal=id=>S.deals.find(d=>d.id===id);
const ship=id=>S.shipments.find(s=>s.id===id);
const rule=id=>S.rules.find(r=>r.id===id);
const initials=n=>n.split(/\s+/).map(w=>w[0]||'').join('').slice(0,2).toUpperCase();
const av=(p,c='')=>`<span class="av ${c}" aria-hidden="true">${esc(initials(p?.name||'?'))}</span>`;

// ——— этапы: по id и флагам воронки, без номеров ———
const pipeIdOf=x=>x.boardId||x.pipeId;
const pipeById=id=>S.pipelines.find(p=>p.id===id)||null;
const stagesFor=x=>pipeById(pipeIdOf(x))?.stages||[];
const stageOf=x=>Pipes.stage(S,pipeIdOf(x),x.stageId);
const stageName=x=>stageOf(x)?.name||'нет данных: этап';
const stagePos=x=>stagesFor(x).findIndex(s=>s.id===x.stageId);
// «Готово / закрыто / на складе» — этап с флагом final. Единственное определение.
const isDone=x=>Pipes.isFinal(S,pipeIdOf(x),x.stageId);
// С чего запись начинает путь: первый этап воронки без флага
const startStage=pipeId=>(pipeById(pipeId)?.stages||[]).find(s=>!s.flag)||null;
const finalStage=x=>stagesFor(x).find(s=>s.flag==='final')||null;
// Цвет метки этапа: закрыт — ok, прошёл заметную часть пути — info
const stageTone=x=>{if(isDone(x)) return 'ok';const n=stagesFor(x).length,i=stagePos(x);return n>1&&i/(n-1)>=.4?'info':''};
// «Прибыло, ждёт приёмки» — единственное определение: входящая поставка на этапе с флагом arrived
const awaitsReceipt=s=>s.dir==='in'&&stageOf(s)?.flag==='arrived';
// Отгрузка клиенту ушла со склада — сошла с начального этапа своей воронки
const leftStart=s=>s.stageId!==startStage(s.pipeId)?.id;
// Последняя отметка поставки — последняя запись истории {at, by, text}; новая отметка — history.push
const shipLast=s=>s.history[s.history.length-1];
// Воронки по виду: поставки к нам / отгрузки клиентам, сделки по типу, доска задач
const shipPipe=dir=>Pipes.of(S,'ships').find(p=>(p.dir||'in')===dir)||null;
const dealPipe=type=>Pipes.of(S,'deals',type).find(p=>p.scope===type)||Pipes.of(S,'deals')[0]||null;
const taskBoard=()=>Pipes.of(S,'tasks')[0]||null;

// ——— остатки: считает Stock (33-stock.js), здесь — только вызов и подписи ———
const isLate=s=>!isDone(s)&&dd(s.eta)<0;
const resOf=pid=>S.reserves.filter(r=>r.productId===pid);
const sum=(a,f)=>a.reduce((x,y)=>x+f(y),0);
const openIn=()=>S.shipments.filter(s=>s.dir==='in'&&!isDone(s));
// Остаток товара: onHand, free, freeAfter, incoming… — Stock.summary, единственный расчёт
const stockOf=pid=>Stock.summary(S,pid,new Date());
// Единицы измерения в таблицах нет: у настоящих товаров их не показываем, у добавленных вручную — как ввели
const qtyOf=(n,p)=>num(n)+(p&&p.unit?' '+p.unit:'');
const byDeal=rs=>{const m=new Map();rs.forEach(r=>{if(!m.has(r.dealId)) m.set(r.dealId,[]);m.get(r.dealId).push(r)});return m};
const itemsText=list=>list.map(r=>{const p=product(r.productId);return `${low(p.name)} — ${qtyOf(r.qty,p)}`}).join('; ');
function shortItems(s){const c=[...new Set(s.items.map(i=>product(i.productId)?.cat).filter(Boolean))].map(low);return c.length>2?c.slice(0,2).join(', ')+` и ещё ${c.length-2}`:c.join(', ')}

// ——— задачи ———
const taskMine=t=>{const m=me();return (t.to.t==='p'&&t.to.id===m.id)||(t.to.t==='d'&&t.to.id===m.dept)};
const taskVisible=t=>can('tasksAll')||taskMine(t)||t.from===me().id;
// «Просрочена» — единственное определение
const taskOverdue=t=>!isDone(t)&&dd(t.due)<0;
const targetName=t=>t.to.t==='p'?(person(t.to.id)?.name||'нет данных: сотрудник'):`Отдел «${deptName(t.to.id)}»`;
const tDept=t=>t.to.t==='d'?t.to.id:person(t.to.id)?.dept;
// Кому адресована задача — люди: исполнитель или весь отдел
const targetPeople=to=>to.t==='p'?[to.id]:S.people.filter(p=>p.dept===to.id).map(p=>p.id);

// ——— уведомления: создаёт только Notify.push ———
const unread=()=>Notify.unread(S,S.me);
function noteRow(n,hl,showTo){
  const k=KIND[n.kind]||KIND.warn,by=n.by?person(n.by):null;
  const everyone=n.to.length>1&&n.to.length>=S.people.length;
  const to=showTo?`<div class="to">${everyone?'<span class="pill sm">все сотрудники</span>':n.to.map(id=>`<span class="pill sm">${esc(person(id)?.name||'нет данных: сотрудник')}</span>`).join('')}</div>`:'';
  return `<li class="note ${hl?'unread':''}"><span class="nic ${k.c}">${ic(k.ic)}</span><div class="nt"><p>${esc(n.text)}</p><small>${by?esc(by.name):'Система'} · ${fWhen(n.at)}${hl?' · <b class="new-b">новое</b>':''}</small>${to}</div></li>`;
}

// ——— шаблон сообщения клиенту ———
function fillTpl(d,items,html){
  const A='\u0001';
  const t=S.tpl.split('{имя}').join(d.contact).split('{товар}').join(items).split('{сделка}').join(d.id).split('{менеджер}').join(person(d.managerId)?.name||'').split('{адрес_склада}').join(A);
  const addr=S.address.trim();
  if(!html) return t.split(A).join(addr||'[адрес склада не заполнен]');
  return esc(t).split(A).join(addr?esc(addr):'<mark>адрес склада не заполнен</mark>');
}
// Фото записи, которые не влезли в браузер (Store.dump пометил запись unsaved) — одна строка для карточки
// поставки и черновика приёмки: «2 фото: не сохранено — мало места в браузере»
const unsavedNote=x=>x&&x.unsaved?`<p class="warn-t sm m0">${num(x.unsaved.photos||0)} фото: ${esc(x.unsaved.text||Store.NO_SPACE)}</p>`:'';
const chPill=c=>`<span class="pill sm ${c==='max'?'violet':c==='telegram'?'info':''}">${CH[c]}</span>`;
