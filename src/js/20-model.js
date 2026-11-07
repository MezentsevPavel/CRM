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

// ——— чистая база и демо-данные (примеры, не данные фирмы) ———
// seedBase() — новая база фирмы без демо: роли, отделы, воронки, юрлица, города, причины отказа, настройки, каталог.
// Людей и записей (сделок, лидов, клиентов, задач, поставок, отправок, уведомлений, ленты) в ней нет.
// seedBase() = ядро ниже + шаги BASES по порядку; шаг — функция st => {…}, кладёт свою часть структуры в своём файле.
// seed() = seedBase() + демо-команда + шаги SEEDS по порядку: шаг дописывает в st свои демо-записи.
const BASES=[];
const SEEDS=[];
function seedBase(){
  const st={
    v:3,me:null,view:'home',
    prefs:{theme:'auto',sound:{},notify:{},ship:{}},
    roles:Perms.defaultRoles(),
    depts:[{id:'mgmt',name:'Руководство'},{id:'sales',name:'Продажи'},{id:'eng',name:'Инженерный'},{id:'stock',name:'Склад'},{id:'logistics',name:'Логистика'}],
    people:[],
    pipelines:Pipes.defaults()
  };
  for(const step of BASES) step(st);
  return st;
}
function seed(){
  const st=seedBase();
  st.me='p1';
  // демо-команда: все семь ролей, по два менеджера B2B и B2C; имена — примеры
  st.people.push(
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
  );
  for(const step of SEEDS) step(st);
  return st;
}

// База, шаг 1: воронка отгрузок клиентам, правила автоматизации, шаблон сообщения клиенту, пустые списки записей.
BASES.push(st=>{
  // отгрузки клиентам (исходящие) — своя воронка, как ST_OUT в v2
  st.pipelines.push({id:'shipsOut',kind:'ships',dir:'out',name:'Отгрузки клиентам',stages:[{id:'packed',name:'Собрано'},{id:'sent',name:'Отгружено'},{id:'onWay',name:'В пути'},{id:'delivered',name:'Доставлено',flag:'final'}]});
  Object.assign(st,{
    products:[],shipments:[],reserves:[],deals:[],tasks:[],msgs:[],moves:[],
    rules:[
      {id:'arrive',on:true,when:'Товар клиента принят на склад',then:'Пишем клиенту в его мессенджер по шаблону ниже, менеджеру — уведомление'},
      {id:'late',on:true,when:'Поставка опаздывает больше чем на 1 день',then:'Уведомляем менеджеров сделок, которые ждут товар, и директора'},
      {id:'shipped',on:false,when:'Товар отгружен на объект клиента',then:'Пишем клиенту номер отгрузки и дату доставки'},
      {id:'resexp',on:true,when:'Резерв истекает через 2 дня',then:'Напоминаем менеджеру продлить или снять резерв'},
      {id:'overdue',on:true,when:'Задача просрочена',then:'Уведомляем исполнителя и того, кто поставил задачу'}
    ],
    tpl:'{имя}, здравствуйте! Ваш заказ пришёл на склад: {товар}. Можно забирать или договоримся о доставке. Адрес склада: {адрес_склада}. Ваш менеджер — {менеджер}, сделка {сделка}.',
    address:'',
    rcv:null,
    notes:[],
    feed:[]
  });
});

// Шаг 1: демо-записи v2 — товары, поставки, резервы, сделки, задачи, переписка, движения.
// Этап записи — id этапа её воронки (pipeId/boardId + stageId), не номер.
SEEDS.push(st=>{
  const T=(id,title,deal,to,from,due,stageId,prio,desc,at)=>({id,title,deal,to,from,due,boardId:'tasksCommon',stageId,prio,desc,at});
  const D=(id,client,contact,kind,object,type,stageId,managerId,channel,amount)=>({id,client,contact,kind,object,type,pipeId:type==='b2b'?'dealsB2b':'dealsB2c',stageId,managerId,channel,amount,demo:true});
  Object.assign(st,{
    // товары и остатки кладёт шаг каталога (38-catalog.js) из снимков; ниже записи v2 ссылаются на товары по старым артикулам,
    // шаг каталога переводит их на настоящие позиции
    products:[],
    // поставки и отгрузка клиенту (120+ демо-поставок по маршрутам) кладёт шаг поставок (34-ships.js);
    // на якорные П-1038, П-1041…П-1044 и О-207 ссылаются резервы, задачи и движения ниже
    shipments:[],
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
    // журнал склада: новые сверху, у самого нового — самый большой номер
    moves:[
      {id:'mv8',at:day(0,11,0),productId:'PV-550M',kind:'Отгрузка',qty:12,doc:'О-207',by:'p5'},
      {id:'mv7',at:day(0,11,0),productId:'MNT-R4',kind:'Отгрузка',qty:3,doc:'О-207',by:'p5'},
      {id:'mv6',at:day(0,11,0),productId:'CAB-6R',kind:'Отгрузка',qty:60,doc:'О-207',by:'p5'},
      {id:'mv5',at:day(-1,10,5),productId:'PV-550M',kind:'Резерв',qty:22,doc:'Д-311',by:'p2'},
      {id:'mv4',at:day(-2,15,30),productId:'MNT-R4',kind:'Приход',qty:24,doc:'П-1038',by:'p5'},
      {id:'mv3',at:day(-3,12,40),productId:'PV-550M',kind:'Резерв',qty:36,doc:'Д-314',by:'p3'},
      {id:'mv2',at:day(-5,9,30),productId:'INV-H6',kind:'Приход',qty:6,doc:'П-1035',by:'p5'},
      {id:'mv1',at:day(-5,9,30),productId:'PV-550M',kind:'Приход',qty:60,doc:'П-1035',by:'p5'}
    ]
  });
});

// Шаг 2: демо-уведомления. Кому — решает Notify (карта RECIPIENTS + адресаты события).
// От старых к новым: push кладёт новое в начало. Вчерашнее и раньше — уже прочитано всеми адресатами.
SEEDS.push(st=>{
  st.notes=[];
  // ref — объект, который открывает уведомление: Notify.push требует его у каждого вызова
  const N=(kind,by,at,text,extra,ref)=>{const n=Notify.push(st,kind,by,text,at,extra,ref);if(dd(at)<0) n.read=n.to.slice()};
  const dept=id=>st.people.filter(p=>p.dept===id).map(p=>p.id);
  N('arrive','p5',day(-2,15,30),'П-1038 принята на склад: крепёж на скатную кровлю, 24 компл. Фото: 3.',[],{t:'ship',id:'П-1038'});
  N('msg',null,day(-2,15,32),'Авто-сообщение в MAX: Волкова Мария (Д-305) — крепёж пришёл на склад.',['p2'],{t:'deal',id:'Д-305'});
  N('reserve','p2',day(-1,10,5),`Резерв: солнечная панель 550 Вт — 22 шт со склада для Д-311 (Иванов Сергей) до ${fD(day(9))}.`,[],{t:'deal',id:'Д-311'});
  N('task','p3',day(-1,11,20),`Новая задача: «Подготовить КП на СЭС 30 кВт» (Д-320), срок ${fD(day(2))}. От: Максим Л.`,['p4'],{t:'task',id:'t1'});
  N('warn','p6',day(-1,12,0),'Поставщик-пример 7 сократил П-1042: ветрогенераторов 2 шт вместо 3. Под резервы не хватает 1 шт.',[],{t:'ship',id:'П-1042'});
  N('task','p2',day(-1,16,0),'Новая задача отделу «Инженерный»: согласовать с клиентом дату пуска станции (Д-305). От: Анна С.',dept('eng'),{t:'task',id:'t6'});
  N('warn',null,day(-1,18,5),'П-1042 задерживается: груз стоит на перегоне Чита → Иркутск. Ветрогенераторы ждут сделки Д-305 и Д-314.',[],{t:'ship',id:'П-1042'});
  N('ship','p6',day(0,8,15),'П-1044 прибыла в Иркутск, на терминал транспортной компании: кабель, разъёмы MC4, контроллеры, щиты DC. Ждёт приёмки, на склад — сегодня.',[],{t:'ship',id:'П-1044'});
  N('ship','p6',day(0,9,40),`П-1041 (инверторы, АКБ) прошла Читу и идёт в Иркутск. На складе ожидается ${fD(day(3))}.`,[],{t:'ship',id:'П-1041'});
  N('ship','p6',day(0,11,0),'Отгрузка О-207 выехала на объект Д-305 (Волкова Мария). Привезём к 16:00.',[],{t:'ship',id:'О-207'});
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
// Артикул рядом с названием товара (слово директора 2026-11-07: «везде нужен артикул»): мелко сам артикул, без слов «арт.»; нет артикула —
// «Артикул: нет данных» (слова директора: «надо писать наоборот»). Читает его только Catalog.skuOf, а в строках без разметки (уведомления,
// тосты, журнал) название с артикулом даёт Catalog.label — при пустом артикуле она ничего не дописывает.
const SKU_NONE='Артикул: нет данных';
const skuText=p=>Catalog.skuOf(p)||SKU_NONE;
const skuTag=p=>`<small class="sku${Catalog.skuOf(p)?'':' muted'}">${esc(skuText(p))}</small>`;
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
// «Прибыло, ждёт приёмки» — единственное определение живёт в Ships.awaitingReceipt (34-ships.js)
const awaitsReceipt=s=>Ships.awaitingReceipt(S,s);
// Отгрузка клиенту ушла со склада — сошла с начального этапа своей воронки
const leftStart=s=>s.stageId!==startStage(s.pipeId)?.id;
// Последняя отметка поставки — последняя запись истории {at, by, text}; новая отметка — history.push
const shipLast=s=>s.history[s.history.length-1];
// Воронки по виду: поставки к нам / отгрузки клиентам, сделки по типу, доска задач
const shipPipe=dir=>Pipes.of(S,'ships').find(p=>(p.dir||'in')===dir)||null;
const dealPipe=(type,st=S)=>Pipes.of(st,'deals',type).find(p=>p.scope===type)||Pipes.of(st,'deals')[0]||null;
const taskBoard=()=>Pipes.of(S,'tasks')[0]||null;

// ——— остатки: считает Stock (33-stock.js), здесь — только вызов и подписи ———
// «Опоздала» — единственное определение живёт в Ships.isLate (34-ships.js)
const isLate=s=>Ships.isLate(s,new Date(),S);
const resOf=pid=>S.reserves.filter(r=>r.productId===pid);
const sum=(a,f)=>a.reduce((x,y)=>x+f(y),0);
const openIn=()=>S.shipments.filter(s=>s.dir==='in'&&!isDone(s));
// Остаток товара: onHand, free, freeAfter, incoming… — Stock.summary, единственный расчёт
const stockOf=pid=>Stock.summary(S,pid,new Date());
// Единицы измерения в таблицах нет: у настоящих товаров их не показываем, у добавленных вручную — как ввели
const qtyOf=(n,p)=>num(n)+(p&&p.unit?' '+p.unit:'');
const byDeal=rs=>{const m=new Map();rs.forEach(r=>{if(!m.has(r.dealId)) m.set(r.dealId,[]);m.get(r.dealId).push(r)});return m};
const itemsText=list=>list.map(r=>{const p=product(r.productId);return `${low(p.name)} — ${qtyOf(r.qty,p)}`}).join('; ');
function shortItems(s){const c=[...new Set(s.items.map(i=>product(i.productId)?.cat).filter(Boolean).map(c=>Catalog.topOf(c)))].map(low);return c.length>2?c.slice(0,2).join(', ')+` и ещё ${c.length-2}`:c.join(', ')}

// ——— задачи ———
// «Моя» и «видна» — правила Visible.taskMine и Visible.task (46-visible.js), здесь — для текущего человека
const taskMine=t=>Visible.taskMine(S,t,me().id);
const taskVisible=t=>Visible.task(S,t,me().id);
// «Просрочена» — единственное определение
const taskOverdue=t=>!isDone(t)&&dd(t.due)<0;
const targetName=t=>t.to.t==='p'?(person(t.to.id)?.name||'нет данных: сотрудник'):`Отдел «${deptName(t.to.id)}»`;
const tDept=t=>t.to.t==='d'?t.to.id:person(t.to.id)?.dept;
// Кому адресована задача — люди: исполнитель или весь отдел
const targetPeople=to=>Tasks.people(S,to);

// ——— уведомления: создаёт только Notify.push ———
const unread=()=>Notify.unread(S,S.me);
function noteRow(n,hl,showTo){
  const k=KIND[n.kind]||KIND.warn,by=n.by?person(n.by):null;
  const everyone=n.to.length>1&&n.to.length>=S.people.length;
  const to=showTo?`<div class="to">${everyone?'<span class="pill sm">все сотрудники</span>':n.to.map(id=>`<span class="pill sm">${esc(person(id)?.name||'нет данных: сотрудник')}</span>`).join('')}</div>`:'';
  // есть ссылка на объект (n.ref) — строка нажимается: 'note-open' прочитает уведомление и откроет карточку (50-shell.js, REFS)
  const open=n.ref?` data-act="note-open" data-id="${esc(n.id)}" tabindex="0" role="button" title="Открыть карточку"`:'';
  return `<li class="note ${hl?'unread':''}${n.ref?' click':''}"${open}><span class="nic ${k.c}">${ic(k.ic)}</span><div class="nt"><p>${esc(n.text)}</p><small>${by?esc(by.name):'Система'} · ${fWhen(n.at)}${hl?' · <b class="new-b">новое</b>':''}</small>${to}</div></li>`;
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
