# Справка по crm-wind-solar.html для исполнителей

Снимок: 1388 строк, 137 939 байт, один файл. Номера строк — на момент чтения, после правок сдвинутся. Это факты по коду, не советы.
Все данные в `seed()` — выдуманные примеры для показа (так написано в баннере, стр. 447). Это не факты Павла.

## 1. Карта файла

- 1–5: `<title>CRM wind-solar</title>`, `<meta name="claude:viewport-fit-sides">`, preconnect и Google Fonts (Manrope 400–800, JetBrains Mono 400/500). Нет `<!doctype>`, `<html>`, `<body>`, `<meta viewport>`. Единственная внешняя зависимость — шрифты.
- 6–425: `<style>`.
  - 7–10: комментарий-шапка. Палитра взята из приложения PVCalc: один зелёный акцент, янтарь = резервы и «внимание», красный = нарушения. Синего и фиолетового нет: `--info` и `--violet` — нейтральный серый.
  - 11–16: `:root` — светлая тема, токены в одну длинную строку (стр. 12), плюс `--f-display`, `--f-body`, `--f-mono`.
  - 17–19: `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){…; color-scheme:dark}}` — тёмная по системе, если не задан `data-theme="light"`.
  - 20–22: `:root[data-theme="dark"]{…; color-scheme:dark}` — принудительная тёмная. Значения токенов в блоках 18 и 21 скопированы дословно, то есть два экземпляра одного набора.
  - Токены (одинаковый набор во всех трёх блоках): `--bg --surface --surface-2 --sunken --line --line-2 --ink --ink-2 --ink-3 --primary --primary-2 --primary-ink --primary-soft --primary-line --primary-deep --sun --on-sun --sun-soft --sun-ink --ok --ok-soft --warn --warn-soft --bad --bad-soft --info --info-soft --violet --violet-soft --seg-on --bezel --overlay --on-overlay --shadow-1 --shadow`.
  - Вне токенов остались два литерала: `rgba(0,0,0,.1)` (стр. 135, `.seg button.on`) и `rgba(0,0,0,.25)` (стр. 337, `.sw-t::after`). Других hex-цветов вне стр. 12/18/21 нет.
  - 24–42 сброс и утилиты (`.ic .mono .muted .sm .nowrap .grow .sr .xs .stack`); 44–89 каркас (`.app` сетка 252px + контент, `.side`, `.brand`, `.mark`, `.nav-i`, `.cnt`, `.me`, `.top`, `.search`, `.bell-w/.bn/.pop`, `.demo`, `.scroll`, `.view`); 91–151 элементы (`.btn .inp .field .pill .chip .fchip .seg .av .card`); 153–187 «Сегодня»; 189–201 уведомления; 203–217 канбан; 219–245 таблицы и остатки; 247–277 перевозки; 279–316 приёмка (телефон); 318–341 переписка, правила, переключатель `.sw`; 343–348 воронка клиентов; 350–353 матрица прав; 355–392 drawer, modal, toast, keyframes; 394–424 медиа-запросы (1100, 900, 560 px и `prefers-reduced-motion`).
  - Жёсткие числа в CSS: `.funnel` — `repeat(8,…)` и `min-width:780px` (стр. 344); `.kanban` — `repeat(4,…)`, `min-width:1036px` (204); `.stats` — `repeat(5,…)` (368). `.steps` и `.week` берут число колонок из `--n`.
- 427–455: разметка-каркас.
  - 428 `<aside id="side">` (наполняет `renderSide`); 429 `.side-scrim`; 431–444 `<header class="top">`: `#ttl`, поиск `#q` + `#q-res`, `<select id="role">` («Глазами:»), колокольчик `#bell` + `#bell-n` + `#pop`.
  - 445–449 баннер `.demo` с кнопкой `data-act="reset"`; 450 `#scroll > main#view`; 453 `#drawer-root`; 454 `#modal-root`; 455 `#toasts` (aria-live).
- 457–1388: `<script>`, одна IIFE с `'use strict'`. Подблоки:
  - 461–487 даты и форматы; 489–513 иконки; 515–556 справочники и `defaultPerms`; 558–672 `seed()`; 673 `defaultUi`; 675–678 состояние и localStorage; 680–689 доступ и поиск сущностей; 691–708 расчёты остатков; 710–716 помощники задач; 718–724 уведомления; 726–734 `fillTpl`, `chPill`; 736–749 `NAV`, `GROUPS`; 751–762 `renderSide`, `updBell`.
  - Виды: 764–829 Сегодня; 831–857 Задачи; 859–906 Товары и остатки; 908–943 Поставки; 945–1038 Приёмка (`addPhotos` 1030–1038); 1040–1069 Клиенты и сделки; 1071–1080 Сообщения; 1082–1093 Уведомления; 1095–1100 Сотрудники и права.
  - 1102–1147 модалки; 1149–1165 drawer; 1167–1173 тосты; 1175–1184 поиск; 1186–1207 `go/setNav/setRole/setTaskStatus`; 1209–1218 `VIEWS`, `render`; 1220–1270 `A`; 1272–1332 `FORMS`; 1334–1384 события; 1386 первый `render()`.

## 2. Архитектура JS

**Состояние** — `let S` (стр. 675) = `Object.assign({role:'director',view:'home',ui:defaultUi()}, seed())`. Ключи `S`: `role view ui perms people products shipments reserves deals tasks notes msgs moves rules tpl address rcv`.
- `S.ui` создаёт `defaultUi()` (673): `taskF:'all', taskDept:'all', cat:'Все', sq:'', deficit:false, logTab:'in', noteK:'all', noteScope:'all', tplCh:'telegram', drawer:null, modal:null, navOpen:false`.
- `seed()` (559–672) возвращает: `perms, people, products, shipments, reserves, deals, tasks, notes, msgs, moves, rules, tpl, address, rcv:null`. Внутри — конструкторы `N(kind,by,at,text,to)` (560) и `T(id,title,deal,to,from,due,status,prio,desc,at)` (561). Даты — `Date` от сегодняшнего дня: `day(n,h,m)`; `T0` фиксируется при загрузке (463).
- `defaultPerms()` (544–556): `director` — все 13 прав; `manager` — `tasksAssign stock prices reserve clients write`; `engineer` — `tasksAssign stock clients`; `warehouse` — `stock receive`; `logist` — `tasksAssign stock logistics`; `installer` — пусто.
- Хелперы-поиска (681–689): `can(p)`, `person(id)`, `product(sku)`, `deal(id)`, `ship(id)`, `rule(id)`, `me()`, `initials`, `av(p,cls)`.

**Разделы и права** — `NAV` (737–747), элементы `{id,label,icon,ok,badge?,hot?}`:
| id | label | ok() | badge |
|---|---|---|---|
| home | Сегодня | всегда | — |
| tasks | Задачи | всегда | открытые задачи «мне» |
| notifications | Уведомления | всегда | `unread().length`, hot |
| stock | Товары и остатки | `can('stock')` | — |
| logistics | Поставки и перевозки | `can('stock')\|\|can('logistics')` | незавершённые поставки |
| receiving | Приёмка на складе | `can('receive')` | поставки `stage===ST_IN.length-2`, hot |
| clients | Клиенты и сделки | `can('clients')` | — |
| messages | Сообщения клиентам | `can('write')\|\|can('auto')` | — |
| team | Сотрудники и права | `can('admin')` | — |

`navItems()` (748) = `NAV.filter(ok)`. `GROUPS` (749): Работа [home, tasks, notifications], Товар [stock, logistics, receiving], Продажи [clients, messages], Управление [team]. Пустая группа не рисуется (754–756).

**Виды** — `VIEWS` (1210): `home:vHome, tasks:vTasks, notifications:vNotes, stock:vStock, logistics:vLogistics, receiving:vReceiving, clients:vClients, messages:vMessages, team:vTeam`. Каждый возвращает HTML-строку.
- Вспомогательные фрагменты: `kpiHtml 777, weekHtml 790, attention() 801 + attnHtml 815, myTasksHtml 819, eventsHtml 824, tCard 847, stockTable 871, sbar 866, srcPill 882, shipCard 919, dealGoods 1041, noteRow 721, tplSample 1072`.

**Клики** — объект `A` (1221–1270), ключ = `data-act`: `go, nav-toggle, reset, bell, open-product, open-deal, open-task, close-drawer, close-modal, new-task, new-ship, new-product, stage, add-irow, task-f, task-st, cat, log-tab, note-k, note-scope, view-as, unreserve, rcv-start, rcv-step, rcv-photo-del, rcv-confirm, rcv-again, tpl-ch, ins-var` (29). Все значения `data-act` в разметке имеют обработчик.
- Обработчик клика на `document` (1335–1345): закрывает колокольчик и результаты поиска при клике снаружи; клик по `.modal-wrap` закрывает модалку; затем `A[el.dataset.act](el,e)`; клик внутри `#q-res` или `#pop` прячет их.

**Формы** — `FORMS` (1273–1332), ключ = `data-form`, вызов из `submit` (1346): `reserve, stage, task, ship, product, msg` (6). Формы: резерв (в drawer товара), отметка этапа, задача, поставка, товар, сообщение клиенту. Ошибки — `showErr(id,text)` (1147), поле `<p class="err" id="…-err">`.

**input/change по `data-on`** (1347–1365):
- `input`: `rcv-qty, rcv-note, sq, tpl, addr`.
- `change`: `rcv-ship, rcv-dmg, rcv-photo, task-dept, deficit, rule, perm, person-role`.
- Отдельно: `#role` change → `setRole` (1377); `#q` input → `searchRes` (1378).

**Модалки** (1102–1147): `MODALS={task,stage,ship,product}` (1144) → `mTask(), mStage(ship), mShip(), mProduct()`; общие `mHead(title)`, `mFoot(label)`. `openModal(type,id)` пишет `S.ui.modal={type,id}` и HTML в `#modal-root` (`.modal-wrap > .modal`), фокус на первое поле; `closeModal()`. `render()` модалку не перерисовывает.

**Боковая панель (drawer)** (1149–1165): `S.ui.drawer={type,id}`, типы `product|deal|task`. `openDrawer`, `closeDrawer`, `renderDrawer`. Содержимое строят `dProduct(p)`, `dDeal(d)`, `dTask(t)` → `{kind,title,sub,body}`. Права проверяются в `renderDrawer`: товар — `can('stock')`, сделка — `can('clients')`, задача — `taskVisible`. `root.dataset.k` = `тип:id` — по нему панель понимает, что открыта та же, и сохраняет прокрутку, добавляя класс `.still` (без анимации). `render()` вызывает `renderDrawer()`.

**Тосты** (1167–1173): `toast(msg,kind)`, `kind==='warn'` → иконка alert, иначе check; в `#toasts`, убираются через 4800 мс + 320 мс.

**Перерисовка**: `render()` (1211–1218) — если текущий вид недоступен, `S.view='home'`; `#view.innerHTML = VIEWS[S.view]()`; `renderSide()`; заголовок `#ttl`; `<select id="role">` (опции `ROLE_ORDER`, подпись «Роль — имя первого человека с этой ролью»); `updBell()`; `renderDrawer()`; `save()`. Перерисовка полная; чтобы не терять фокус при вводе, есть точечные обновления: `stock-tbl` (`stockTable()`), `#rcv-prev` (`updRcvPrev`), `#rcv-photos` (`photosHtml`), `#tpl-prev` и `#tpl-h` (`updTpl`), `#rcv-diff-<sku>`.

**localStorage** (676–678): ключ `ws-crm-ui`, сохраняется только `{role,view}`; чтение и запись обёрнуты в `try{…}catch(_){}`; при чтении проверяется `ROLES[v.role]`. Всё остальное (задачи, резервы, остатки, поставки, права, шаблон, адрес, фото) живёт в памяти и сбрасывается при перезагрузке. `save()` вызывается из `render()`. Хэш `#view` (`/^#[a-z]+$/`, стр. 677) задаёт `S.view` при загрузке; обратно хэш не пишется.

**Прочее**: клавиатура (1366–1372): Escape закрывает по очереди модалку → drawer → колокольчик/поиск/меню; Enter и Space на не-кнопочных `[data-act]` (`tr.click`, `.tcard`) вызывают `click()`. Drag-and-drop карточек задач (1373–1376): `[data-drag]` → колонка `[data-col]` → `setTaskStatus`. Поиск `searchRes(q)` (1176): от 2 символов, до 9 результатов, типы «Товар / Сделка / Перевозка / Задача», с учётом `can()`. Мобильное меню: `setNav(open)`, `S.ui.navOpen`, класс `.nav-open` на `#app`.

## 3. Сущности и поля (как в коде)

**Справочники** (515–542):
- `ROLES` = `{director:{name:'Директор'}, manager:{name:'Менеджер продаж'}, engineer:{name:'Проектировщик'}, warehouse:{name:'Кладовщик'}, logist:{name:'Логист'}, installer:{name:'Монтажник'}}`; `ROLE_ORDER` = `['director','manager','engineer','warehouse','logist','installer']`.
- `DEPTS` = `{mgmt:'Руководство', sales:'Продажи', design:'Проектирование', stock:'Склад', logistics:'Логистика', install:'Монтаж'}`.
- `PERMS` — массив пар `[ключ, подпись]` (13): `firm` Видеть сводку по всей фирме; `tasksAll` Видеть задачи всех отделов; `tasksAssign` Ставить задачи другим отделам; `stock` Видеть остатки, резервы и поставки; `prices` Видеть цены и суммы; `reserve` Ставить и снимать резервы; `catalog` Добавлять товары в номенклатуру; `logistics` Отмечать этапы перевозки; `receive` Принимать товар на склад; `clients` Видеть клиентов и сделки; `write` Писать клиентам в Telegram и MAX; `auto` Настраивать авто-сообщения; `admin` Управлять сотрудниками и правами. Хранение: `S.perms[роль][ключ]=bool`.
- `ST_IN` = `['Заказано','Отгружено поставщиком','В пути','Прибыло в город','На складе']`; `ST_OUT` = `['Собрано','Отгружено','В пути','Доставлено']`; `stagesOf(s)` (692) выбирает по `s.dir`.
- `DEAL_ST` = `['Заявка','Расчёт','КП','Договор','Оплата','Поставка','Монтаж','Сдана']`.
- `TASK_ST` = `[['new','Новые'],['work','В работе'],['review','На проверке'],['done','Готово']]`.
- `CH` = `{telegram:'Telegram', max:'MAX', phone:'Телефон'}`.
- `CATS` = Панели, Инверторы, Аккумуляторы, Контроллеры, Кабель и разъёмы, Крепёж, Защита и учёт, Ветрогенераторы.
- `CARRIERS` = `['Сборный груз, транспортная компания','Отдельная машина','Своя машина','Контейнер: море + железная дорога']`.
- `VARS` = `['{имя}','{товар}','{сделка}','{менеджер}','{адрес_склада}']`.
- `KIND` (542) — виды уведомлений `{l,ic,c}`: `ship` Перевозки, `arrive` Склад, `task` Задачи, `reserve` Резервы, `msg` Клиентам, `warn` Предупреждения.

**Записи** (в демо: people 8, products 12, shipments 6, reserves 15, deals 6, tasks 10, notes 10, msgs 4, moves 8, rules 5):
- `S.people[]`: `{id:'p2', name:'Анна С.', role:'manager', dept:'sales'}`. id `p1…p8`; по два менеджера и два монтажника.
- `S.products[]`: `{sku:'INV-H6', name:'Гибридный инвертор 6 кВт', cat:'Инверторы', unit:'шт', price:96000, stock:4}`. `price` — число или `null`; `stock` — число (физический остаток на складе, изменяется только приёмкой). Единицы в демо: `шт, м, пар, компл.`.
- `S.shipments[]` (входящие и исходящие в одном массиве): `{id:'П-1041', dir:'in', from, to:'Наш склад', carrier, doc:'ТТН 41-008352', stage:2, eta:Date, last:{place, at:Date, by:'p6'}, items:[{sku,qty}]}`. У исходящих: `dir:'out'`, id `О-207`, плюс `deal:'Д-305'`. После приёмки: у позиции `got`, у поставки `received:{at:Date, by:'p5', photos:3, urls:[dataURL…], note:''}`. `stage` — индекс в `ST_IN`/`ST_OUT`.
- Позиция поставки: `{sku:'CAB-6R', qty:500}` (+ `got` после приёмки).
- `S.reserves[]`: `{id:'r3', sku:'PV-550M', deal:'Д-320', qty:54, src:'П-1043', until:Date}`. `src` — `'stock'` или id поставки.
- `S.deals[]`: `{id:'Д-311', client:'Иванов Сергей', contact:'Сергей', kind:'Частный дом', object:'…', stage:5, manager:'p2', channel:'telegram', amount:1180000}`. `stage` — индекс в `DEAL_ST`; `amount:0` = «не рассчитана».
- `S.tasks[]`: `{id:'t1', title, deal:'Д-320'|'', to:{t:'p'|'d', id:'p4'|'logistics'}, from:'p3', due:Date, status:'new'|'work'|'review'|'done', prio:'high'|'normal', desc, at:Date}`.
- `S.notes[]` (уведомления): `{id:'n101', kind:'ship', by:'p6'|null, at:Date, text, to:['director','manager'], read:['director',…]}`. `to` и `read` — ключи ролей, не люди.
- `S.msgs[]` (сообщения клиентам): `{id:'m3', at:Date, deal:'Д-305', channel:'max', text, by?:'p2', inbound?:true, auto?:true}`. Исходящие от человека — `by`; входящий ответ — `inbound:true`; автоматические — `auto:true`.
- `S.moves[]` (движения товара, без id): `{at:Date, sku:'PV-550M', kind:'Приход', qty:60, doc:'П-1035', by:'p5'}`. Виды: `Приход`, `Отгрузка`, `Резерв`, `Снят резерв`. Записи вида `Отгрузка` создаёт только seed; в коде действий их нет.
- `S.rules[]` (правила автоотправки): `{id:'arrive', on:true, when:'…', then:'…'}`; id: `arrive late shipped resexp overdue`.
- `S.tpl` — строка шаблона; `S.address` — строка (в seed `''`).
- `S.rcv` — `null` или `{shipId, qty:{sku:число|строка}, dmg:{sku:bool}, note:'', photos:[dataURL], done:null|{shipId, noteIds, msgIds, notified, issues}}`.

## 4. Расчёт остатков (691–708)

Все принимают `sku`, кроме `freeNow/freeAfter` — они принимают **объект товара** `p`.
- `resOf(sku)` = резервы с этим sku (696).
- `resStock(sku)` = Σ `qty` резервов sku с `src==='stock'` (698).
- `resAll(sku)` = Σ `qty` всех резервов sku (699).
- `openIn()` = входящие поставки (`dir==='in'`), не завершённые (`!isDone`) (700).
- `incomingOf(sku)` = `[{ship,qty}]` по позициям открытых входящих поставок с этим sku, по возрастанию `eta` (701).
- `incomingQty(sku)` = Σ `qty` из `incomingOf` (702).
- `freeNow(p)` = `p.stock − resStock(p.sku)` (703).
- `freeAfter(p)` = `p.stock + incomingQty(p.sku) − resAll(p.sku)` (704) — это «Будет свободно».
- `shipFree(sid,sku)` = количество sku в поставке `sid` − Σ резервов с `src===sid` (705).
- Статус поставки: `isDone(s)` = `s.stage>=lastSt(s)`; `isLate(s)` = не завершена и `dd(s.eta)<0` (693–695).
- Вызывают: `resStock` — 703, 867, 878; `resAll` — 704, 878, 901; `incomingOf` — 878, 888 (drawer: форма резерва 893, список 897); `incomingQty` — 704, 809, 867, 878, 901; `freeNow` — 809, 867, 874, 878, 888, 1179 (поиск), 1278 (проверка формы резерва); `freeAfter` — 807, 874, 878, 884, 888, 1045; `shipFree` — 893 (подпись источника), 1278; `openIn` — 701, 779 (KPI).
- Срок резерва (`until`) в расчётах не участвует: просроченный резерв продолжает считаться.
- Исходящие поставки на `p.stock` и резервы не влияют (в коде нет списания). `p.stock` растёт только в `rcvConfirm` (993).

## 5. Уведомления

- `pushNote(kind,by,text,to)` (719): создаёт `{id:uid('n'), kind, by, at:new Date(), text, to:[...new Set(to)], read:[S.role]}`, кладёт в начало `S.notes` (`unshift`), возвращает запись. Получатели — массив ключей ролей.
- Прочитанность: `n.read` — массив ролей. `unread()` (720) = уведомления, где `n.to` содержит текущую `S.role` и `n.read` её не содержит. Автор помечается прочитавшим сразу (`read:[S.role]`). В seed (560) `read` = все роли, если запись старше сегодняшнего дня, иначе `[]`.
- Помечаются прочитанными: при отрисовке `vNotes` (1091, после построения списка, поэтому новые подсвечены один раз) и при открытии колокольчика (1229, только первые 10 своей роли).
- Где показано: колокольчик `#bell-n` в шапке (`updBell` 762, скрыт при 0, `99+` при >99); значок раздела «Уведомления» в боковой панели (NAV, `hot`); карточка «События по фирме / Мои уведомления» на «Сегодня» (`eventsHtml` 824, 7 штук); список в `#pop` (`A.bell` 1225–1230); раздел `vNotes` (1083) с фильтрами `S.ui.noteK` (вид) и `S.ui.noteScope` (`mine|all`; «вся фирма» только при `can('firm')`).
- Строка: `noteRow(n,hl,showTo)` (721); иконка и цвет из `KIND`; автор «Система», если `by` пуст.
- Кто создаёт уведомления: `rcvConfirm` (1004, 1005, 1012), `setTaskStatus` (1205), `unreserve` (1253), `FORMS.reserve` (1285), `FORMS.stage` (1294), `FORMS.task` (1304), `FORMS.ship` (1314), `FORMS.product` (1323; вид `arrive`). Правила `late`, `resexp`, `overdue` уведомлений не создают (см. п. 11). Вид `msg` («Клиентам») есть только в seed; `pushNote` с ним нигде не вызывается, а `FORMS.msg` уведомление не пишет.

## 6. Шаблон сообщения клиенту

- `fillTpl(d,items,html)` (727–733): `d` — сделка, `items` — готовая строка товаров (`itemsText(list)` 707: «название строчными — кол-во ед.», через `; `), `html` — булево.
- Подстановки: `{имя}`→`d.contact`; `{товар}`→`items`; `{сделка}`→`d.id`; `{менеджер}`→`person(d.manager)?.name||''`; `{адрес_склада}`→`S.address.trim()`. Подстановка идёт цепочкой `split/join`; для адреса сначала ставится маркер `\u0001`.
- Пустой адрес: при `html=false` в текст подставляется `[адрес склада не заполнен]`; при `html=true` текст экранируется и вместо адреса идёт `<mark>адрес склада не заполнен</mark>`. Плейсхолдер поля адреса: «Нет данных — впишите адрес склада» (1076).
- Вызывают: `rcvPreview` (979, `html=true`), `rcvConfirm` (1010, `html=false`, текст уходит в `S.msgs`), `tplSample` (1072, `html=true`, пример всегда по сделке `Д-318`).
- Шаблон один (`S.tpl`, стр. 668), канал `S.ui.tplCh` меняет только подпись предпросмотра. Сообщения не отправляются нигде — только пишутся в `S.msgs`.
- Второй текст сообщения клиенту — «Ваш заказ отгружен…» — зашит прямо в `FORMS.stage` (1295), в шаблон не вынесен.

## 7. Приёмка на складе

- Экран: `vReceiving` (950) → `rcvLayout(phone,side)` (957): подсказка + сетка `.rcv` (телефон ≤410px и правая колонка). Рамка — `section.phone` > `.phone-in` > `.ph-bar` («Приёмка», имя и время) + секции. Если `S.rcv` нет, берётся первая из `pendingRcv()` (947: `dir==='in'`, `stage>=2`, не завершена; сортировка по `stage` по убыванию, затем `eta`); нет поставок — пустая карточка.
- Телефон (`rcvPhoneHtml` 963): шаг 1 — радио выбора поставки (`data-on="rcv-ship"`); шаг 2 — строки пересчёта: кнопки −/+ (`A['rcv-step']`), поле `rcv-q-<sku>`, чекбокс «Есть повреждения», метка расхождения `diffHtml` («сходится / недостача N / излишек N»); шаг 3 — сетка фото `#rcv-photos` + комментарий; кнопка `rcv-confirm`.
- Справа `rcvPreview` (972): что добавится на склад, кто получит уведомление (роли `director manager logist engineer`, кроме текущего человека), клиенты, ждущие товар (с предпросмотром сообщения или пометкой «по телефону — задача» / «авто выключены»). Обновляется `updRcvPrev()` при вводе.
- Фото (`addPhotos` 1030–1038): `<input type="file" accept="image/*" capture="environment" multiple data-on="rcv-photo">` внутри `label.ph.add`. До 9 файлов за выбор (`slice(0,9)`), только `image/*`. `FileReader.readAsDataURL` → `Image` → canvas: масштаб `k=min(1, 720/max(w,h))`, `toDataURL('image/jpeg',.82)`; при ошибке canvas или загрузки берётся исходный dataURL (try/catch и `img.onerror`). Результат — в `S.rcv.photos`; общего лимита нет; порядок добавления зависит от окончания загрузки. Удаление — `A['rcv-photo-del']`.
- Подтверждение `rcvConfirm` (989–1019):
  1. По каждой позиции: `p.stock += q`, `it.got = q`; при `q>0` запись `S.moves.unshift({kind:'Приход', doc:s.id,…})`; расхождения и повреждения собираются в `issues`/`dmg`.
  2. Резервы с `src===s.id` переводятся в `src='stock'` (движение при этом не пишется).
  3. `s.stage=lastSt(s)`, `s.last={place:'Наш склад',…}`, `s.received={at,by,photos,urls,note}`.
  4. `pushNote('arrive',…, ['director','manager','logist','engineer'])`; при расхождении или повреждении — `pushNote('warn',…, ['director','logist','manager'])`.
  5. По каждой сделке-ждуне: канал `phone` → задача менеджеру («Позвонить клиенту…», срок сегодня 18:00, `prio:'high'`); иначе если `rule('arrive').on` → сообщение `{auto:true,text:fillTpl(d,items,false)}` в `S.msgs`; иначе — текст «Авто-сообщения выключены»; затем `pushNote('reserve', null, …, ['manager','director'])`.
  6. `S.rcv.done={shipId,noteIds,msgIds,notified,issues}`; `render()`, прокрутка вверх, тост. После этого экран показывает `rcvDoneHtml` и `rcvAfterHtml`; `A['rcv-again']` обнуляет `S.rcv`.
- Входы в приёмку: пункт меню (`can('receive')`) и кнопка «Принять на складе» в `shipCard` (934: `can('receive')`, `dir==='in'`, `stage>=2`) → `A['rcv-start']` → `initRcv(id)` (946) + `go('receiving')`.

## 8. Кто «я», роли и скрытие разделов

- Роль — `S.role`. Переключение: `<select id="role">` (change → `setRole(r)`, 1194) и кнопки «Глазами роли» в `vTeam` (`A['view-as']`).
- `setRole`: `S.role=r`, закрывает drawer и модалку, `S.ui.taskF='all'`; считает недоступные разделы; если текущий вид недоступен — `S.view='home'`; `render()`; тост с перечнем недоступного.
- «Я» — `me()` (687) = **первый** человек в `S.people` с этой ролью, иначе заглушка `{id:'x',…}`. Менеджер всегда «Анна С.» (`p2`), монтажник — «Сергей Т.» (`p7`); `p3`, `p8` через переключатель не выбираются.
- Разделы без права: убираются из `renderSide` (через `navItems`), `go()` показывает тост «У этой роли нет доступа к разделу» (1189), `render()` отбрасывает на `home`, `renderDrawer` не открывает карточки без права. Внутри видов права скрывают колонки и кнопки (цены `prices`, резервы `reserve`, новый товар `catalog`, этапы `logistics`, сводка `firm` и т. д.).
- Права правятся в матрице `vTeam` (1098, `data-on="perm"`); колонка директора `disabled`. Обработчик (1363) пишет в `S.perms` и показывает тост, `render()` не вызывает. Роль человека меняется `data-on="person-role"` (1364); `director` в списке ролей не предлагается. Проверки прав стоят только в интерфейсе; в `FORMS` и `A` права не проверяются.

## 9. Соглашения кода

- Стиль: IIFE, `'use strict'`, 2 пробела, точки с запятой, очень короткие имена (`S, A, T0, N, T, me, dd, fD, esc, ic, av`), стрелочные функции, много однострочников и цепочек через запятую.
- Префиксы: `v*` — экран; `d*` — содержимое drawer; `m*` — модалка; `*Html` — фрагмент; `upd*` — точечное обновление DOM; `f*` — форматтеры дат. Идентификаторы и ключи данных — английские; значения справочников и тексты интерфейса — русские.
- Комментарии: русские; только разделители вида `// ——— раздел ———` (и такие же в CSS), внутри кода комментариев почти нет (редкие: стр. 558, 691). Заголовок CSS (7–10) объясняет палитру.
- HTML строится шаблонными строками (`` `…${x}…` ``), результат кладётся через `innerHTML`; фреймворка нет. Экранирование — `esc(s)` (482: `& < > " '`, `null/undefined` → `''`). Не экранируются значения из констант и id (`s.id`, `d.id`, `p.unit`, `ROLES[..].name`, `DEPTS[..]`, `CH[..]`); `drawer`-строители `title` и `sub` экранируют сами.
- Числа и деньги: `num(n)` (477, `toLocaleString('ru-RU')`), `rub(n)` («1 180 000 ₽»), `mln(n)` («2,35 млн ₽» от 1 млн), `pl(n,a,b,c)` — склонение, `days(n)` — «N дней».
- Даты: `day(n,h,m)` — Date относительно сегодня; `dd(d)` — целых дней от `T0`; `fD` — «5 ноя»; `fRel` — сегодня/завтра/вчера/`fD`; `fT` — «14:05»; `fWhen` — `fRel, fT`; `iso` / `fromIso` — для `<input type=date>`; `sod`, `cap`, `low`, `uid(prefix)`, `$`, `byId`.
- Иконки: словарь `IC` (490–512, внутренности svg: `home tasks box truck camera users chat bell shield search x plus photo check alert arrow pin lock send eye clock`); `ic(name,cls)` (513) возвращает `<svg class="ic …">`.
- Пустые значения: `priceTxt` (870) — «нет данных» при `price==null`; сумма сделки 0 → «не рассчитана»; номер накладной пустой → строка «нет данных: номер накладной» (1313); адрес склада — см. п. 6.
- Выбор оформления: цвета только через `var(--токен)`; классы короткие (`.btn .pri .ghost .sm`, `.pill .ok/.bad/.warn/.info/.sun/.violet`).

## 10. Что есть и чего нет

- Переключатель темы: **кнопки нет**. Тёмная тема включается только по системной настройке или атрибутом `data-theme` на `<html>`; JS (`documentElement`, `matchMedia`) его не трогает — в коде `data-theme` встречается только в CSS (17, 20).
- Раздел настроек: **нет**. Адрес склада и шаблон правятся внутри «Сообщения клиентам»; других настроек нет.
- Почта: **нет** (ни раздела, ни поля, ни слова в файле). Каналы клиентов — только `telegram`, `max`, `phone`.
- Лиды: **нет** как сущности. Этап 0 «Заявка» есть в `DEAL_ST`, но ни у одной демо-сделки он не стоит; ближе всех `Д-322` (`stage:1` «Расчёт», `amount:0`, `channel:'phone'`). Формы создания и редактирования сделки нет; смены этапа сделки тоже нет.
- Редактор воронок: **нет**. Воронка — константа `DEAL_ST` (8 этапов), в `vClients` рисуется счётчиками `.funnel` и в drawer сделки полосой `.steps`.
- Карта поставок: **нет**. Есть календарь недели `weekHtml` (на «Сегодня») и маршрут текстом `from → to` в `shipCard`.
- Вид-таблица поставок: **нет**. `vLogistics` рисует только карточки `.ships > article.ship` по вкладкам `in / out / done` (`S.ui.logTab`).
- Логотип: картинки в шапке нет. Вместо неё `<span class="mark" aria-hidden="true">` (стр. 753) рядом с `<b>wind-solar</b><small>CRM · прототип</small>`. CSS `.mark` (50): 30×30, радиус 9px, градиент `--primary → --primary-2` с двумя 2-пиксельными линиями цвета `--surface` (крест). В папке проекта лежит `assets/windsolar-logo.png`; из `crm-wind-solar.html` на него ссылок нет (`<img>` в файле только для фото приёмки, стр. 929, 961).
- Создаются из интерфейса: задачи, резервы, снятие резервов, входящие поставки, товары, сообщения клиенту, отметки этапов, приёмка. Нет форм: создание исходящей отгрузки (все `О-…` — только seed), редактирование или удаление товара, поставки, сделки, задачи; ручная правка остатка; создание сотрудника.

## 11. Слабые места для переделки

1. «Ждёт приёмки» задано тремя разными условиями: бейдж меню `stage===ST_IN.length-2` (только «Прибыло в город», стр. 743), список `pendingRcv` — `stage>=2` (947), кнопка в карточке — `stage>=2` (934). В демо бейдж показывает 1, список — 4.
2. Жёсткие номера этапов вместо имён: `d.stage>=6`, `d.stage>=3` (1054, цвет метки), `s.stage>=2` (934, 947), `s.stage>=1` и `st>=1` (1291, 1295), `ST_IN.slice(0,3)` (1133), `L-1` для входящих (921, 1118), `DEAL_ST.length-1` как «закрыта» (781, 892), `repeat(8,…)` в CSS воронки. `stage` у сделок и поставок — индекс в массиве: смена порядка или длины `DEAL_ST/ST_IN/ST_OUT` ломает данные.
3. Одни и те же пять чисел остатка (склад, в резерве, свободно, едет, будет свободно) собираются в трёх местах: строка таблицы (878), статистика drawer (901), `sbar` (867, с обрезками `max/min`). «Под поставку» = `resAll − resStock` считается только в таблице (878).
4. «Дефицит» определён по-разному: фильтр «Только где не хватает» — `freeAfter<0 || freeNow<=0` (874); блок «Требует внимания» — `freeAfter<0` или `stock>0 && freeNow<=0 && нет поставок` (807–809).
5. `freeNow/freeAfter` принимают объект товара, остальные — `sku`; `srcPill` (884) судит о каждом резерве по `freeAfter` товара целиком, а не по своей поставке.
6. Списки получателей по ролям захардкожены в ≥9 местах (635–643, 975, 1004–1005, 1012, 1253, 1285, 1293–1294, 1314, 1323). Предпросмотр приёмки (975, 984) и фактическая рассылка (1004–1005) — две копии логики; текст предпросмотра говорит «логист и директор», фактически предупреждение получают ещё и менеджеры.
7. Ветвление «телефон → задача / авто-сообщение / напоминание» записано дважды: в `rcvPreview` (979) и в `rcvConfirm` (1009–1011).
8. `S.rules` читаются только как `arrive` (973, 1006) и `shipped` (1295). Флаги `late`, `resexp`, `overdue` нигде не используются; «опаздывает» (`isLate`) считается при любом отрезке в прошлом, а не «больше чем на 1 день»; блок «резерв истекает ≤2 дня» (811) от флага не зависит.
9. Шаблон: `VARS` (541) и подстановки в `fillTpl` (729) перечислены отдельно — новая переменная правится в обоих местах; текст «отгружен» не в шаблоне; предпросмотр привязан к сделке `Д-318` (1072); в хранимом тексте при пустом адресе остаётся `[адрес склада не заполнен]`.
10. `stLabel` (716) дублирует `TASK_ST` (537) отдельным словарём. Признак «просрочена»: `t.status!=='done'&&dd(t.due)<0` повторён в 778, 803, 837, 848, 852, 1060.
11. В состоянии лежат `Date`-объекты (`eta, at, due, until, last.at, received.at`). В localStorage пишется только `{role,view}`; сохранение остального потребует сериализации дат. `T0` фиксируется при загрузке.
12. `render()` пересобирает весь вид; поэтому часть экранов собрана дважды — в шаблоне вида и в точечном обновлении (`stockTable`, `rcvPreview`, `photosHtml`, `tplSample`).
13. `me()` = первый человек с ролью; `read` хранится по роли, а не по человеку, поэтому двое с одной ролью делят прочитанность и задачи «мне» второго менеджера недоступны через переключатель.
14. Побочные эффекты внутри функции-вида: `vNotes` (1091) и `vReceiving` (953, `initRcv` при рендере) меняют состояние.
15. Вид `arrive` используется и для «добавлен товар» (1323); «Резервы» в KPI — число записей (`S.reserves.length`), а не штук; заголовок KPI «Задачи в работе» считает все не `done`, включая `new`.
16. Номер новой поставки в `FORMS.ship` (1311): новый номер = `max(parseInt(id.slice(2)))+1` по входящим — зависит от двухсимвольного префикса. `uid()` (485) — общий счётчик на все префиксы, при «Сбросить» не обнуляется. В `moves` есть ссылка на несуществующую поставку `П-1035`.
17. Права проверяются только при отрисовке; сами действия (`A`, `FORMS`, `rcvConfirm`) их не проверяют. `render()` модалку не обновляет — смена роли закрывает её явно (1195).
