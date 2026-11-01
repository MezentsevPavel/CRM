# Границы и правила проекта

Читается каждым исполнителем первым. Код v2 описан в `notes.md`: имена, строки, слабые места. Спецификация — в `spec.md`.

## Правила проекта (от пользователя, не обсуждаются)

1. Всё по-русски: тексты интерфейса и комментарии в коде. Идентификаторы и ключи данных — английские, как в v2.
2. **Факты пользователя не выдумываются.** Нет данных — на экране видно «нет данных: <что именно>»: адрес, город, название поставщика, закупочная цена. Ни нуля, ни прочерка, ни правдоподобного числа. Демо-данные (люди, поставки, лиды, сделки, письма, поставщики) помечены «демо» или «пример».
3. Рядом с числом — откуда оно: «цена сайта, снимок 31.10.2026», «остаток из таблицы менеджеров, снимок 31.10.2026», «демо».
4. **Величина живёт в одном месте и берётся вызовом.** Ни одной второй копии формулы остатка, прав, получателей уведомлений, «ждёт приёмки», «просрочено».
5. Экран и карточка считают одним кодом и говорят одними словами.
6. Зависимостей не ставить. Только то, что есть: браузер, Node 24 с `node:test`. Внешние адреса в странице — только Google Fonts (как в v2).
7. Не трогать то, о чём не просили. Всё из v2 остаётся работать (R56i).
8. Ничего не отправляется наружу. Всё «внешнее» — имитация с подписью «имитация».

## Команды

| Команда | Что делает |
|---|---|
| `node tools/build.js` | собирает `crm-wind-solar.html` из `src/` и `assets/` |
| `node --test tests/` | тесты логики и видов |
| `node tools/build.js && node --test tests/` | полная проверка — её прогоняет каждый таск перед сдачей |
| `node tools/serve.js 5178` | отдаёт собранный файл на `http://localhost:5178` в скелете `<!doctype html>…` (так его оборачивает хостинг артефактов) |

`crm-wind-solar.html` — **результат сборки**, руками не правится после T01. Публикуется он (без doctype, html, body).

## Границы, решённые в спецификации

### Раскладка исходников

```
src/page.html          каркас страницы: <title>, шрифты, <style>{{CSS}}</style>, разметка-каркас, <script>{{JS}}</script>, {{LOGO}}
src/css/*.css          токены тем и стили, по файлу на раздел
src/js/00-util.js      esc, uid, форматтеры чисел и дат, IC/ic — как в v2
src/js/10-catalog-data.js   CATALOG — снимок таблицы PVCalc
src/js/11-stock-data.js     STOCK_SNAPSHOT — снимок листа «Остатки» таблицы менеджеров
src/js/20-model.js     справочники по умолчанию, seed(), детерминированный генератор демо
src/js/3x-*.js         ядро: чистая логика без DOM, по модулю на файл
src/js/5x-*.js         виды: функции state → HTML-строка
src/js/90-boot.js      A, FORMS, обработчики событий, render(), запуск
tools/build.js  tools/serve.js  tests/load.js  tests/*.test.js
```

`build.js` склеивает `src/js/*.js` **по имени файла, по возрастанию** в одну IIFE с `'use strict'`. `src/css/*.css` так же по имени склеивает в `{{CSS}}`, а `assets/windsolar-logo.png` — data-URI в `{{LOGO}}`. Пишет `crm-wind-solar.html`. Новые файлы встают в порядок своим номером, сборку не правят.

### Ядро — модули-пространства имён

Каждый файл ядра объявляет одну константу-объект: `const Stock = (() => { …; return { … }; })();`. Наружу — только то, что в `return`. Функции ядра **принимают состояние первым аргументом** (`st`) и не трогают DOM, `S`, `localStorage`, `Date.now()` напрямую. Текущее время приходит аргументом `now`, где оно нужно.

| Модуль | Владеет | Отдаёт (имена — договор) |
|---|---|---|
| `Store` (30) | сохранение | `Store.KEY` (`'ws-crm-v3'`), `Store.load(raw) → state\|null`, `Store.dump(state) → {text, droppedPhotos}`; даты сериализуются и оживляются; чужая версия схемы → `null` (берётся `seed()`); переполнение → без фото, `droppedPhotos:true` |
| `Perms` (31) | роли и права | `Perms.LIST` (ключи и подписи прав — продолжение `PERMS` из v2 плюс новые: `mail`, `leads`, `dealsAll` «Видеть сделки всех типов», `settings`), `Perms.can(st, personId, perm)`, `Perms.roleOf(st, personId)`, `Perms.addRole(st, name) → role`, `Perms.removeRole(st, roleId) → {ok, reason}` |
| `Pipes` (32) | воронки всех видов | `Pipes.KINDS` = `tasks deals leads ships`; `Pipes.of(st, kind, scope?)`, `Pipes.stage(st, pipeId, stageId)`, `Pipes.isFinal(st, pipeId, stageId)`, `Pipes.rename(st, pipeId, name)`, `Pipes.renameStage(…)`, `Pipes.addStage(st, pipeId, name, afterId?)`, `Pipes.removeStage(st, pipeId, stageId, moveToId) → {ok, moved, reason}`, `Pipes.addPipe(st, kind, name, scope?)`, `Pipes.removePipe(st, pipeId, moveToPipeId) → {ok, moved, reason}`, `Pipes.items(st, pipeId)` |
| `Stock` (33) | остатки и резервы | `Stock.grid(st, productId) → {rows:[entity…+'_'], cols:[city…+'_'], cell(e,c), totals}`; `Stock.summary(st, productId, now) → {onHand, damaged, custody, transitNoShip, incoming, reservedStock, reservedIncoming, free, freeAfter, nextEta}` — **единственный** расчёт; `Stock.incomingOf(st, productId) → [{shipId, qty, eta}]`; `Stock.canReserve(st, {productId, qty, entityId, cityId, src}) → {ok, max, reason}`; `Stock.move(st, {kind, productId, qty, entityId, cityId, doc, by, at})` пишет и остаток, и `moves` |
| `Ships` (34) | поставки и маршрут | `Ships.NODES` (5 точек схемы), `Ships.where(s) → {at:nodeId}\|{from, to, t}`; `Ships.awaitingReceipt(st, s)` — **единственное** «ждёт приёмки»; `Ships.isLate(s, now)`; `Ships.mapCounts(st, filter) → {nodes:{id:{ships, units}}, legs:{'a>b':{ships, units}}}`; `Ships.advance(st, shipId, by, now, auto)` — шаг по маршруту и этапу (трек перевозчика); `Ships.setStage(st, shipId, stageId, by, now, auto?)`; `Ships.applyRules(st, event, shipId, now)`; `Ships.query(st, {q, stage, supplier, node, city, entity, sort, page, size}) → {rows, total}` |
| `Leads` (35) | лиды | `Leads.classify(lead) → 'b2b'\|'b2c'\|null` (компания или ИНН → b2b; иначе телефон или почта → b2c; иначе null); `Leads.route(st, lead) → managerId\|null` (тип → менеджер этого типа с наименьшим числом открытых лидов); `Leads.toDeal(st, leadId, by, now) → dealId` |
| `Mail` (36) | ящики и письма | `Mail.boxesFor(st, personId)`; `Mail.folderOf(st, letter) → supplierId\|'sort'` по правилам-адресам; `Mail.remember(st, letterId, supplierId)` добавляет адрес в правило и раскладывает похожие; `Mail.search(st, boxId, folder, q)` |
| `Notify` (37) | уведомления | `Notify.RECIPIENTS` — **единственная** карта «событие → роли»; `Notify.push(st, kind, by, text, now, extraPersons?) → note`; получатели — люди; прочитанность — по людям; `Notify.unread(st, personId)`; учитывает `prefs.notify` человека |
| `Dispatch` (39) | заявки на отправку (T07) | `Dispatch.create(st, data, by, now) → {ok, id, missing:[поле…]}` — без получателя, адреса, телефона, даты или списка `ok:false` и `missing`; `Dispatch.canWork(st, personId)` — право `dispatch`; `Dispatch.canEdit(st, personId, d)` — с правом всегда, автор — пока этап первый; `Dispatch.canCancel(st, personId, d)` — с правом или автор до «В пути»; `Dispatch.setStage(st, id, stageId, by, now)`; `Dispatch.assign(st, id, driverId, by, now)`; `Dispatch.pick(st, id, lineIdx, done, by, now)` — отметка «собрано»; `Dispatch.comment(st, id, text, by, now)`; `Dispatch.query(st, {q, stage, mine, today, driver, personId, now})`; `Dispatch.picked(d) → {done, total}` |
| `Clients` (40) | клиенты (T09) | `create`, `update`, `find(st, {phone, email, inn})` (телефон — по цифрам), `findOrCreate`, `related(st, clientId) → {leads, deals, msgs, dispatches}` |
| `Feed` (41) | одна лента карточек (T09) | `Feed.add(st, ref, {kind, text, by, at, data?})`, `Feed.of(st, ref)` — свои записи + связанные события (история лида, резервы и сообщения по сделке, дела); вид `feedHtml(ref)` — один на все карточки |
| `Deals` (42) | сделки (T09) | `create → {ok, id, missing}`, `update`, `move`, `win`, `lose(…, reason, …)`, `total(deal)` — **единственная** сумма, `addItem/setItem/removeItem`, `reserveItem` через `Stock.reserve`, `columns(st, pipeId, filter, personId) → [{stage, count, sum, deals}]` |
| `Acts` (43) | дела (T10) | `plan → {ok, id, missing}`, `done(…, result, …)`, `open(st, ref)`, `next(st, ref)`, `counts(st, personId, now) → {today, overdue}`, `noNext(st, ref)`, `due(st, now)` |
| `Catalog` (38) | каталог и снимок остатков | `Catalog.norm(name)`; `Catalog.build(CATALOG, STOCK_SNAPSHOT) → {products, stock, aside, unmatched}` — склейка снимка с каталогом только при точном совпадении нормализованных названий; `Catalog.query(st, {q, cat, brand, avail, inCatalog})` |

### Состояние `S` (схема v3)

```
v:3, me:<personId>, view, ui:{…не сохраняется…}, prefs:{theme, sound:{<personId>:{on, kind}}, notify:{<personId>:{<kind>:bool}}, ship:{view, cols, density, group, size}}
roles:[{id, name, builtin, perms:{<perm>:bool}, all?:true (директор — все права), scope?:'b2b'|'b2c' (тип менеджера; на нём распределение лидов)}]   depts:[{id, name}]   people:[{id, name, role, dept, demo, specialty?:'designer'|'installer'}]
entities:[{id:'ip'|'npp'|'vs', name}]   cities:[{id:'irk'|'msk'|'krd', name, address:''}]
products:[{id, name, brand, cat, price|null, avail, url, src:'catalog'|'sheet'|'user', inCatalog}]
stock:{<productId>:{<entityId|'_'>:{<cityId|'_'>:qty}}}     '_' = «нет данных»
aside:{<productId>:{damaged, custody, transitNoShip}}
pipelines:[{id, kind, name, scope?:'b2b'|'b2c', stages:[{id, name, flag?:'arrived'|'final'}]}]
shipments:[{id, number, dir, supplier, carrier, track, entityId, cityId, route:[nodeId…], pos:{i, t}, depart, eta, pipeId, stageId, items:[{productId, qty, got?}], history:[{at, by, text, auto?}], received?, demo}]
reserves:[{id, productId, qty, entityId, cityId, src:'stock'|shipId, dealId, until}]
leads:[{id, at, source:'site'|'bitrix'|'phone'|'mail', name, phone, email, company, inn, text, type, managerId, pipeId, stageId, dealId?, history, demo}]
deals:[{id, client, contact, kind, object, type:'b2b'|'b2c', pipeId, stageId, managerId, channel, amount, leadId?, demo}]
tasks:[{id, title, deal, to:{t:'p'|'d', id}, from, due, boardId, stageId, prio, desc, at}]
notes:[{id, kind, by, at, text, to:[personId], read:[personId]}]
msgs, moves:[{at, productId, kind, qty, entityId, cityId, doc, by}], rules (авто-сообщения, как в v2), tpl
shipRules:[{id, on, when:'received'|'carrier'|<своё событие>, then:<stageId>}]
mail:{boxes:[{id, kind:'purchase'|'clients'|'other', title, address:'', roles:[roleId]}], suppliers:[{id, name, example, rules:['@domain'|'adr@x']}], letters:[{id, boxId, from, fromName, subject, body, at, read, folder}]}
leadSource:'bitrix'|'site'|'both'
dispatches:[{id, number:'ОТ-NNN', at, by, purpose:'sale'|'transfer'|'other', from?:{entityId, cityId}, toCell?:{entityId, cityId} (у перемещения), moved?:true, to:{name, phone}, address, when:{date, from?, till?}, items:[{productId?|text, qty, picked?, sold?:{at, by, entityId, cityId}}], files:[{id, name, type, size, data|null, unsaved?}], note, driverId?, dealId?, pipeId, stageId, demo}]   (T07; комментарии и история — в `Feed`)
clients:[{id, kind:'person'|'company', name, inn?, phones:[], email?, address?, managerId?, demo}]   (T09)
feed:[{id, ref:{t:'deal'|'lead'|'client'|'dispatch', id}, at, by, kind, text, data?}]   (T09)
deals[] + clientId, items:[{productId?|text, qty, price|null, disc}], wonAt?, lostReason?   (T09)   lostReasons:[{id, name}]   leadWaitMin:15 (T10)
acts:[{id, ref, type:'call'|'meet'|'mail'|'todo', title, due, ownerId, by, at, remind, doneAt?, result?, reminded?}]   (T10)
```

Воронки по умолчанию: поставки — Заказано → Отгружено поставщиком → В пути до границы → Таможня → Перевалка в Чите → В пути до склада → Прибыло в город (`arrived`) → На складе (`final`); сделки B2B и сделки B2C — Заявка → Расчёт → КП → Договор → Оплата → Поставка → Монтаж → Сдана (`final`); лиды — Новый → Связались → Квалифицирован → Сделка создана (`final`) → Отказ (`final`); доска задач «Общие» — Новые → В работе → На проверке → Готово (`final`); отправки (T07, вид `dispatch`) — Новая → Собирается → Готова к отправке → В пути → Доставлена (`final`) → Отменена (`final`). Роль `driver` «Водитель», права `dispatch` «Вести отправки» и `sell` «Списывать при продаже», `Stock.sell` — T07. Роль `rop` «РОП (руководитель отдела продаж)» и право `leadsAssign` «Распределять и передавать лиды» — T04. Точки схемы `Ships.NODES`: `cn` Китай «основной город-поставщик», `chita` Чита «основной город-приёмщик · таможня и перевалка», `irk` Иркутск «основной город-получатель», `msk` Москва и `krd` Краснодар «город-получатель». Получатели `Notify.RECIPIENTS.ship` — все сотрудники.

Этап хранится **по id этапа**, не по номеру: переименование, вставка и удаление этапа не ломают данные (слабое место 2 из `notes.md`). «Сделано/закрыто» — флаг `final` у этапа. «Прибыло, ждёт приёмки» — флаг `arrived`.

### Реестры — как раздел подключается, не трогая чужих файлов

Таск 01 объявляет в `20-model.js` и `50-shell.js` пустые реестры (`A`, `FORMS`, обработчики `ON` и модалки фактически живут в `50-shell.js`, не в `90-boot.js`). Каждый следующий таск регистрирует свой раздел **в своём файле**, чужие файлы не правит:

| Реестр | Что кладётся |
|---|---|
| `SEEDS` | `SEEDS.push(st => { … })` — демо-данные своего раздела; `seed()` = базовое состояние + все `SEEDS` по порядку |
| `NAV` | `{id, label, icon, group, order, ok:() => bool, badge?:() => n}` |
| `VIEWS` | `VIEWS.<id> = () => html` |
| `SETTINGS_TABS` | `{id, label, order, ok:() => bool, render:() => html}` — вкладки «Настроек» |
| `A`, `FORMS` | `A['<act>'] = (el, e) => …`, `FORMS['<form>'] = (form, data) => …` |
| `ON` | `ON.input['<key>']`, `ON.change['<key>']` — обработчики `data-on` |
| `DRAWERS`, `MODALS` | `DRAWERS.<type> = id => ({kind, title, sub, body})`, `MODALS.<type> = id => html` |
| `SIMS` | `{id, label, run:() => void}` — кнопки «Имитация: …» для «Пульта проверки» |

### Зоны тасков

CSS лежит так же, по файлам: `src/css/*.css` склеиваются по имени в `{{CSS}}` (вместо одного `styles.css`). Имена файлов ниже — договор: таск 01 переносит виды v2 **ровно в эти файлы**, следующие таски переделывают свои.

| Таск | Владеет файлами (`src/js/…`, `src/css/…`, `tests/…`) |
|---|---|
| 01 | `src/page.html`, `src/css/00-tokens.css`, `src/css/10-base.css`, `src/css/50-shell.css`, `src/js/00-util.js`, `20-model.js`, `30-store.js`, `31-perms.js`, `32-pipes.js`, `37-notify.js`, `50-shell.js`, `57-messages.js`, `59-settings.js`, `90-boot.js`, `tools/`, `tests/load.js`, `tests/foundation.test.js`; переносит v2 в `51-home.js`, `52-tasks.js`, `53-stock.js`, `54-ships.js`, `55-receiving.js`, `56-deals.js`, `58-team.js` и их CSS с теми же номерами |
| 02 | `10-catalog-data.js`, `11-stock-data.js`, `33-stock.js`, `38-catalog.js`, `53-stock.js`, `65-settings-stock.js`, `src/css/53-stock.css`, `tests/stock.test.js` |
| 03 | `34-ships.js`, `54-ships.js`, `55-receiving.js`, `66-settings-ships.js`, `src/css/54-ships.css`, `src/css/55-receiving.css`, `tests/ships.test.js` |
| 04 | `35-leads.js`, `56-deals.js`, `60-leads.js`, `67-settings-leads.js`, `src/css/56-deals.css`, `src/css/60-leads.css`, `tests/leads.test.js` |
| 05 | `36-mail.js`, `61-mail.js`, `68-settings-mail.js`, `src/css/61-mail.css`, `tests/mail.test.js` |
| 07 | `39-dispatch.js`, `69-dispatch.js`, `src/css/69-dispatch.css`, `tests/dispatch.test.js`, `33-stock.js` (`Stock.sell`), `53-stock.js` и `src/css/53-stock.css` («Списать при продаже» в карточке товара); по одной строке в чужих: `30-store.js` (REV), `31-perms.js` (права `dispatch`, `sell`), `32-pipes.js` (вид `dispatch` в `KINDS`), `37-notify.js` (событие `dispatch`) |
| 08 | `src/css/50-shell.css`, `src/js/50-shell.js`, `tests/shell.test.js`; по одной строке `data-hscroll` в `52-tasks.js`, `54-ships.js`, `56-deals.js`, `60-leads.js`; `30-store.js` (REV) |
| 09 | `40-clients.js`, `41-feed.js`, `42-deals.js`, `56-deals.js`, `70-clients.js`, `67-settings-leads.js`, `35-leads.js`, `src/css/41-feed.css`, `src/css/56-deals.css`, `src/css/70-clients.css`, `tests/deals.test.js`, `tests/clients.test.js`; `30-store.js` (REV) |
| 10 | `43-acts.js`, `41-feed.js`, `35-leads.js`, `60-leads.js`, `67-settings-leads.js`, `src/css/41-feed.css`, `src/css/60-leads.css`, `tests/acts.test.js`, `tests/leads.test.js`; по строке в `30-store.js`, `37-notify.js`, `56-deals.js`, `70-clients.js` |
| 06 | `51-home.js`, `52-tasks.js`, `58-team.js`, `62-settings-pipes.js`, `63-settings-notify.js`, `64-sims.js`, `src/css/51-home.css`, `src/css/52-tasks.css`, `src/css/62-settings.css`, `tests/settings.test.js` |

Чужой файл правится, только если иначе не сделать: одна строка, и в отчёте таска — какая и зачем.

### Виды — чистые функции

Все `v*`, `d*`, `m*` и `*Html` — функции `S → HTML-строка`. Они **не меняют состояние** (слабое место 14) и не трогают `document`: так их можно вызвать в тесте. Состояние меняют только `A`, `FORMS`, обработчики `data-on` и функции ядра. Текст из данных экранируется `esc()`.

## Швы для тестов

1. `tests/load.js` читает `src/js/*.js` без `90-boot.js`, исполняет в `node:vm` и отдаёт `{Store, Perms, Pipes, Stock, Ships, Leads, Mail, Notify, Catalog, seed, VIEWS, …}`. Других швов не заводить.
2. Ядро тестируется на маленьком состоянии из теста. Виды тестируются вызовом на `seed()`: строка содержит то, что обещает приёмка (число строк, «+N», «нет данных: …»).
3. Каждый тест должен уметь покраснеть. Исполнитель проверяет это сам: портит число в новом коде, прогоняет, возвращает.

## Что построили закрытые таски

*(дописывается после каждого таска: что появилось, какие имена, что следующему знать)*

### T01 — фундамент

- **Сборка и тесты.** `node tools/build.js` склеивает `src/css/*.css` и `src/js/*.js` по имени; `{{LOGO}}` — ровно одно место (второе роняет сборку). Тест сверяет `crm-wind-solar.html` со сборкой — руками не править. `tests/index.js` подключает все `tests/*.test.js` (Node 24 сам папку не обходит) — новый файл `tests/<имя>.test.js` подхватится сам. `tests/load.js`: `load({storage, hash}?)` → геттеры всех имён верхнего уровня + `.storage`, после кода делает `S = startState()`; `bootPage(html, opts?)` → запуск собранной страницы на заглушке DOM; заглушки `matchMedia` (параметр `dark`), таймеры.
- **Store** `{KEY, VERSION, LIMIT, NO_SPACE, load(raw)→st|null, dump(st, limit?)→{text, droppedPhotos, fits}, freeId(list, prefix)}`; выкинутое фото помечается в записи `unsaved:{photos, text}`.
- **Perms** `{LIST:[[key,label]], defaultRoles(), roleOf, can(st,pid,perm), addRole(st,name,perms[])→role|null, removeRole(st,roleId)→{ok,reason}}`; id ролей: `director, managerB2b, managerB2c, logist, warehouse, chiefEngineer, engineer`. Инженеры смотрят сделки через `dealsAll`. Право ставить задачи другим отделам (`tasksAssign`) с таска 06 есть у менеджеров B2B, B2C и РОП — как в прошлой версии прототипа; вопрос пользователю.
- **Pipes** `{KINDS, defaults(), of(st,kind,scope?), stage, isFinal, items, rename, renameStage→{ok,reason}, addStage(st,pipeId,name,afterId?)→stage|null, removeStage(st,pipeId,stageId,moveToId)→{ok,moved,reason}, addPipe(st,kind,name,scope?)→pipe|null, removePipe(st,pipeId,moveToPipeId)→{ok,moved,reason}}`. Единственный этап с флагом `final`/`arrived` не удаляется. `shipRules.then` при удалении этапа не переносятся — это дело `Ships` (T03).
- **Notify** `{RECIPIENTS (ship, arrive, reserve, warn, task, msg, lead), recipients(st,kind,extra?), push(st,kind,by,text,now,extra?)→note, unread(st,pid)→[note], markRead(st,pid,noteId?)→число}`; `msg` и `lead` по умолчанию — директору, остальных адресатов передаёт создающий через `extra`.
- **Данные.** `seed()` = база `{v:3, me:'p1', view, prefs{theme,sound,notify,ship}, roles, depts (5, «Инженерный» = eng), people (11, demo:true, specialty designer|installer у инженеров), pipelines}` + шаги `SEEDS` по порядку (1 — записи v2 и воронка «Отгрузки клиентам» `shipsOut`, `dir:'out'`; 2 — уведомления через `Notify.push`). Задачи: `boardId+stageId`; сделки: `type, pipeId, stageId, managerId, demo`; поставки: `pipeId+stageId, demo`. Товары и остатки — ещё в форме v2 (`sku`, `stock`): их переводит T02.
- **Помощники модели** (`20-model.js`): `can(p)`, `me()`, `roleName`, `deptName`, `stageName/stagePos/stagesFor`, `isDone` (флаг `final`), `awaitsReceipt` (флаг `arrived` — пока единственное определение; T03 заменяет его на `Ships.awaitingReceipt`), `taskOverdue`, `targetPeople`, `shipPipe(dir)`, `dealPipe(type)`, `taskBoard()`, `startStage`.
- **Оболочка** (`50-shell.js`): `let S`; `freshState()`, `savedState()`, `startState()`, `save()`, `saveSoon()`, `resetData()` (сохраняет «Кто я», раздел и тему), `setMe(pid)`; сброс — `A.reset` → `MODALS.reset` → `FORMS.reset`. `A`, `FORMS`, обработчики, модалки и ящики живут в `50-shell.js` (не в `90-boot.js`). `NAV` `{id,label,icon,group,order,ok,badge?}` — новый раздел `NAV.push`; группы `GROUPS`: Работа, Товар, Продажи, Управление, Настройки. Закрытый раздел — `vNoAccess(n)`. Тема: `S.prefs.theme` `'light'|'dark'|'auto'`, `setTheme`, `A.theme`, `applyTheme()` в каждом `render()`, один переключатель `themeSwitch(compact)`.
- **Настройки** (`59-settings.js`): `SETTINGS_TABS` `{id,label,order,ok,render}`; есть `look` (10, все) и `data` (90, право `settings`); новая вкладка — `SETTINGS_TABS.push`.
- **Приёмка** (`55-receiving.js`): `rcvPlan()` — один план на предпросмотр и подтверждение, `receiveShip(by, now)`. Принять можно только поставку на этапе с флагом `arrived` (в демо одна — П-1044); T03 даёт их больше.
- **Стили.** Элементы (`.btn .inp .pill .card .tbl`) — в `50-shell.css`, порядок важен; медиа-запросы — в файлах разделов; есть `57-messages.css`; `.list/.li` в `51-home.css` использует и поиск оболочки. Логотип — только в шапке бокового меню.
- **Не сделано здесь, за следующими:** фильтр сделок по типу менеджера — T04.
- **После ремонта по ревью (`234e33b`).** Реестры в `50-shell.js`:
  - `ON={input:{},change:{}}` — регистрация `ON.input['<key>']=(el,e)=>…` / `ON.change['<key>']=…`; оболочка зовёт обработчик по `data-on`, потом `saveSoon()`.
  - `DRAWERS={}` — `DRAWERS.<type>=id=>({kind,title,sub,body})` или `null`, права проверяются внутри; открывает `openDrawer(type,id)`; уже есть `product` (53), `deal` (56), `task` (52).
  - `SIMS=[]` — `SIMS.push({id,label,run})`.
  
  Поля v3: `reserves {productId, dealId}`, `moves.productId`, `shipments.items[].productId`, у поставки `supplier`, `track`, `history[{at,by,text}]` (новая отметка — `history.push`); у отгрузки клиенту остались `to` и `deal`, `supplier` = «Наш склад». Значения `productId` — пока артикулы v2; **товары ещё в форме v2: `product(id)` ищет по `p.sku`, `p.sku` читают 20, 50, 51, 53 — T02 переводит их и вправе править эти места.** Помощники: `shipLast(s)`, `unsavedNote(x)` (20-model), `rcvItem(pid)` (55); в разметке приёмки `data-pid`. `tests/load.js`: заглушка `document` запоминает слушатели и умеет `dispatchEvent({type,target})`. Тест «Кто я» ещё держит демо-задачу v2 и людей p3/p9.

### T02 — каталог и остатки (`74d5b41`)

- **Снимки** `CATALOG` (10, 242 позиции с 6 листов) и `STOCK_SNAPSHOT` (11, 208 строк, без колонки «Резерв», пустое = `null`). Не править руками.
- **Товар** `{id, name, brand, cat, price|null, avail, url, src, inCatalog, sheet?}`; `id` — ключ каталога, `'sheet-NNN'` (строка таблицы менеджеров) или `'uN'` (добавлен руками). `cat` — подписи: Панели, Инверторы, Аккумуляторы, Контроллеры, Защита и соединения, Кабель. Всего 434: 242 из каталога + 192 «нет в каталоге» (склеено по точному названию 16).
- **Catalog** `{norm, CATS, build(CATALOG,STOCK_SNAPSHOT)→{products,stock,aside,unmatched}, cats(st), brands(st), query(st,{q,cat,brand,avail,inCatalog}), sectionCat, base(), pack(products), unpack(st)}`. `Store.dump/load` зовут `pack/unpack`: товары снимка в браузер не пишутся (сохранение ~26 КБ).
- **Stock** `{ANY:'_', KINDS, defaults(), entityName, cityName, grid(st,pid)→{rows,cols,cell,totals}, incomingOf(st,pid)→[{shipId,qty,eta}], freeIn(st,shipId,pid), summary(st,pid,now), canReserve→{ok,max,reason}, bestCell, move(st,{productId,kind,qty,entityId,cityId,doc,by,at}) (приход, отгрузка, бой, перемещение), reserve, unreserve}`. **Приход товара при приёмке (T03) — только через `Stock.move`** с юрлицом и городом; резерв и снятие — только `Stock.reserve/unreserve`. `Store.REV = 2`.
- **Модель** (20): `product(id)` по `id`, `stockOf(pid)` = `Stock.summary`, `qtyOf(n,p)`. Юрлица `entities` ip/npp/vs, города `cities` irk/msk/krd с `address:''`. Шаг `SEEDS` — в `38-catalog.js` (таблица `DEMO_LINKS`: артикул v2 → настоящая позиция того же вида). Демо-поставки — ИП, Иркутск.
- **Экраны** (53): `S.ui.stockTab` `'goods'|'moves'`, страницы по 50, `DRAWERS.product`, действия `A['stock-tab'|'stock-cat'|'stock-page'|'stock-journal']`. Форма резерва `FORMS.reserve` — в `50-shell.js`, числа из `Stock.canReserve`. Вкладка `SETTINGS_TABS` `'stock'` (order 60, право `settings`), `FORMS['entity-add'|'city-add']` (65).
- **Осталось:** демо-тексты уведомлений и сделок ещё называют выдуманные товары v2 — каждый следующий таск переписывает свои.

### T05 — почта (`b719e5c`)

- **Mail** (36) `{INBOX:'inbox' («Разобрать»; не 'sort'), SIM_NOTE, NOTE_KIND:'mail', boxesFor(st,pid), folderOf(st,letter), remember(st,letterId,supplierId,'address'|'domain')→{ok,reason,rule,moved}, search(st,{boxId,folder?,q}), deliver(st,{boxId,from,fromName?,subject,body,demo?},now)→letter|null, reply(st,letterId,text,by,now)}`. Письмо `{id:'mlN',boxId,from,fromName,subject,body,at,read,folder,demo?,sim?,replies?}`; поставщик `{id:'supN',name,example,rules}`; ящик `{id,kind,title,address:'',roles,added?}`. Шаг `SEEDS` в 36: 2 ящика, 6 поставщиков-примеров, 33 письма (7 в «Разобрать»).
- **Notify**: вид `mail:[]` (адресаты через `extra`); `KIND.mail` «Почта» в 20-model. **`Store.REV = 3`** — каждый таск, меняющий форму данных, поднимает ревизию.
- **Экран** (61): `NAV` «Почта» (Работа, order 40, badge — непрочитанные), `VIEWS.mail`, `S.ui.mail` (не сохраняется), `mailSimulate(boxId?)`, `SIMS` «mail»; вкладка `SETTINGS_TABS` «mail» (order 40, право `settings`) в 68.
- **Тест размера сохранения** (`tests/stock.test.js`) проверяет суть — товаров снимка в сохранении нет; порог 150 000 символов.

### T03 — поставки (`19fa106`)

- **Ships** (34) `{NODES [{id,name,label,x,y}], ST, SRC {manual, carrier, receipt, rule(label)}, EVENTS, eventLabel, nodeOf, nodeName, routeText, units(s), brief(st,s), where(s), plan(st,s), progress, awaitingReceipt(st,s?) (без s — массив; единственное «ждёт приёмки»), isLate(s,now,st), mapCounts(st,filter?), query(st,{q,stage,supplier,node,city,entity,dir,sort,page,size})→{rows,total,page,pages,size}, setStage(st,shipId,stageId,by,now,source?), advance(st,shipId,by,now,source?), applyRules(st,event,shipId,by,now)}`. Поставка `{id,number,dir,supplier,carrier,track,to,entityId,cityId,route[],pos{i,t},depart,eta,pipeId,stageId,items[{productId,qty,got?}],history[{at,by,text,source,auto?}],received?,demo}`. Правила `st.shipRules [{id,on,when:'received'|'customs'|'carrier:<nodeId>'|'carrier',then}]`. Шаг `SEEDS` в 34: 126 поставок, дата демо 31.10.2026. `20-model`: `awaitsReceipt` и `isLate` зовут `Ships`. **`Store.REV = 4`.** Порог размера сохранения в `tests/stock.test.js` — 230 000.
- **Экран** (54): виды `SHIP_VIEWS` table / funnel / map; `vLogistics`, `DRAWERS.ship`, `MODALS.shipItems`; `shipMark(shipId,stageId)` — единственный ручной путь смены этапа; `shipScale`, `shipItems`, `shipMap`, `shipCarrier`; `S.ui.ships` (не сохраняется), настройки вида — `S.prefs.ship`; `SIMS` «carrier»; вкладка `SETTINGS_TABS` «ships» (order 70, право `settings`) в 66.
- **Приёмка** (55): `rcvPlan(r)` — один план на предпросмотр и итог; `receiveShip(by,now)` → `{ok, stock, cell, stage, fired, msgIds, taskIds, notified}`; `S.rcv.entityId/cityId`; сообщение клиенту в `S.msgs` с `sim:true`; канал «телефон» → задача менеджеру.
- **Сервер на 5179** — исполнители проверяют страницу в браузере на 5179; 5178 — для показа пользователю.

### T04 — лиды и сделки (`128dbce`)

- **Leads** (35) `{SOURCE, SOURCES, TYPE, STAGE, title, classify(lead), route(st,lead), pick(st,type,skipId?), openCount(st,managerId,skipId?), managers(st,type?), create(st,data,now,{silent}?)→lead, take, contacted, close(st,id,reason,by,now), move(st,id,stageId,by,now,reason?) — единственный путь смены этапа из воронки («Сделка создана» → toDeal, «Отказ» → close), transfer(st,id,{managerId}|{type},by,now), toDeal(st,id,by,now)→dealId, can(st,id,personId)→{take,work,deal,transfer}, canTake, canWork, canTransfer (= право leadsAssign), visible(st,pid), dealsVisible(st,pid), fresh(st,pid), allows(st,source), setSource(st,value)}`. Лид `{id 'Л-N', at, source, name, phone, email, company, inn, text, type, managerId|null, pipeId, stageId, history, demo, dealId?, reason?}`. Сделка из лида: схема `deals` + `phone, email, channel:'phone', amount:0, leadId`. `dealPipe(type, st=S)` в 20-model.
- **Роль `rop`** «РОП (руководитель отдела продаж)», без `scope`, демо «Елена Г.» (p12) — шаг `SEEDS` в 35. **Право `leadsAssign`** «Распределять и передавать лиды» (31): с ним видны все лиды, «Нераспределённые», передача любого лида. `Notify.RECIPIENTS.lead` = директор и РОП + менеджер через `extra`. **`Store.REV = 5`.**
- **Экран** (60): NAV `leads` (Продажи, order 5, бейдж `Leads.fresh`), `VIEWS.leads`, `DRAWERS.lead`, `MODALS.leadLost`, FORMS `lead-lost`, `lead-transfer`, A `open-lead`, `lead-*`, `deal-type`, ON `lead-q`, `lead-f`, `lead-source`; `SIMS` `lead-site`, `lead-bitrix`; вкладка настроек `leads` (order 50, файл 67). Сделки (56): воронки B2B/B2C, переключатель типа — у директора и `dealsAll`. Общий поиск (50-shell) показывает только `Leads.dealsVisible`.

### Общие стрелки прокрутки досок (T08)

- Контейнер колонок любой воронки помечается атрибутом `data-hscroll` — и получает стрелки у краёв из `50-shell`. Своих копий прокрутки в разделах нет.

### T09 — сделки и клиенты (`65672bb`)

- **Clients** (40) `{create(st,data,by,now)→{ok,id,client,missing,reason}, update(st,id,patch,by,now)→{ok,changed,reason}, find(st,{phone,phones,email,inn})→[клиент] (ИНН, телефон по цифрам, почта), findOrCreate(st,data,by,now)→{client,created}, related(st,clientId,personId?)→{leads,deals,msgs,dispatches}, search(st,q), byId, phoneKey(v)}`. Лид и сделка несут `clientId`; `Leads.toDeal` берёт клиента через `findOrCreate`.
- **Feed** (41) `{add(st,ref,{kind,text,by,at,data?}), of(st,ref,personId?) (подмешивает историю лида, резервы и сообщения по сделке; лента клиента — ленты его сделок и лидов), comment(st,ref,text,by,now)→{ok,entry,reason}, canComment, KINDS, REF}`; вид `feedHtml(ref, st=S)` — форма `data-form="feed-comment"` (`FORMS['feed-comment']` в 56), классы `feed-*` в `src/css/41-feed.css`. **Дела (T10) встраиваются сюда, а не в карточки.**
- **Deals** (42) `{create→{ok,id,missing,reason}, update, move, win, lose(st,id,reason,by,now), reopen, total(deal) — единственная сумма, lineSum, noPrice, state(st,deal)→'open'|'won'|'lost', addItem, setItem, removeItem, reserveItem(st,id,idx,{entityId,cityId,qty,until},by,now)→{ok,reserve,reason,max}, unreserve, reserved, query, columns(st,pipeId,filter,personId)→[{stage,count,sum,deals}], reasons(st), defaultReasons, canEdit, itemName, byId}`. «Провалена» — не этап: `lostReason/lostAt`. Поля сделки: `clientId, items[{productId|text,qty,price|null,disc}], at, wonAt, lostReason, lostAt`; `st.clients`, `st.feed`, `st.lostReasons [{id,name}]` (общие для лидов и сделок; функции `lostReasonAdd/Rename/Remove` в 67). **`Store.REV = 7`.** Порог размера сохранения в `tests/stock.test.js` — 340 000.
- **Экран «Сделки»** (56): NAV `deals` (бывший `clients`), `VIEWS.deals`, `DRAWERS.deal(id)` (`openDrawer('deal', id)` или `data-act="open-deal"`), MODALS `dealNew(stageId)`, `dealLose`, `dealReserve('Д-301:0')`, `dealKp`; колонки `data-dcol`, контейнер `data-hscroll`; `S.ui.deals/dealType/dealPipe/dealTab`. Главный экран (51) суммирует через `Deals.total`.
- **Экран «Клиенты»** (70): NAV `clients` (Продажи, order 15, право `clients`), `VIEWS.clients`, `DRAWERS.client(id)` (только видимое `S.me`), `MODALS.clientNew`; `clientDupHtml({phone|phones,email,inn})` — подсказка «Похоже, это …», её же зовёт быстрая форма сделки. Вкладка настроек `leads` называется «Лиды и сделки».

### T10 — дела и лиды (`6826b54`, `2822864`)

- **Acts** (43) `{TYPES, REMINDS, QUICK, byId, alive, label, quick(kind,now), plan(st,ref,{type,title?,due,ownerId?,remind?},by,now)→{ok,id,act,missing,reason}, done(st,id,result,by,now) (результат обязателен), open(st,ref,personId?), next, noNext, overdue(st,ref,now), matches(st,ref,'none'|'overdue',now), counts(st,pid,now,type?)→{today,overdue}, due(st,now), notify(st,now), moveOpen(st,from,to,by,now)}`; `st.acts`. Дела закрытых лидов и сделок не считаются. `Notify.RECIPIENTS.act` (ответственный через extra), `leadWait=['rop']`.
- **Feed** (41): `feedHtml(ref, st=S, now)` — «Запланировать», открытые дела, «нет следующего шага», выполненные дела серые; `actNextHtml(ref)`, `actsBadge(type)`, `actsTick()` раз в минуту (дела и ждущие лиды); оболочка зовёт `Acts.notify` и `Leads.notifyWaiting` в `render()`. `Deals.query` фильтр `{acts, now}`.
- **Leads** (35): `add(st,data,by,now)→{ok,lead,reason}` (ручной лид, `clientId`), `SOURCE` phone «звонок», mail, site, bitrix, other; `waitMin(st)`, `setWaitMin`, `waiting(st,lead,now)→мин|null`, `notifyWaiting(st,now)`; `st.leadWaitMin`; `lead.waitNoted`, `lead.clientId`. Экран (60): `MODALS.leadNew`, вкладки карточки лида «Детали / Лента». **`Store.REV = 9`.**

### T07 — отправки (dd0d78d)

- **Dispatch** (39) `{PIPE, ST, STEP_KIND, PURPOSE, MISSING, byId, create(st,data,by,now,opts?)→{ok,id,missing,reason}, update, canWork, canEdit, canCancel, canComment (любой сотрудник), canSell, setStage(st,id,stageId,by,now)→{ok,from,to,note}|{ok:false,reason}, assign, drivers, pick, picked(d)→{done,total}, comment, sell(st,id,lineIdx,{entityId,cityId,reserveId?},by,now), soldText, query(st,{q,stage,mine,today,driver,personId,now}), transit, inTransit, warehouseAddress, lineName}`. Этапы воронки `dispatch`: new, picking, ready, onWay, delivered (final), cancelled (final). Уведомления: `dispatch` — новая (логист, кладовщик), `dispatchStep` — этап и водитель (получатели через extra). Роль `driver`, права `dispatch`, `sell`. Лента — `Feed`, дела — `Acts` (REFS + dispatch).
- **Stock** (33): `sell(st,{productId,qty,entityId,cityId,reserveId?,doc},by,now)`, `sellMax(...)` — без резерва не больше «клетка − резервы на неё»; `incomingOf` отдаёт и перемещения в пути (`dispatchId`). `Store.dump → {text, droppedPhotos, droppedFiles, fits}`. **`Store.REV = 10`.**
- **Экран** (69): NAV `dispatch` (всем), `VIEWS.dispatch`, `DRAWERS.dispatch`, `openDispatchNew({...})`, `openDispatchEdit(id)`, `MODALS.dispatchForm`. Карточка товара (53): «в пути: N, ОТ-NNN», «Списать при продаже» (`MODALS.stockSell`). Сделка (56): «Создать отправку», «Списать при продаже» у строки. `Clients.related().dispatches` — по сделкам и телефону получателя.

### T06, кусок 1 — доски задач и редактор воронок (`e332e16`)
- **Общий редактор** — `62-settings-pipes.js`: `pipeNameCtl(p)`, `pipeStageCtl(p,s,full)`, `pipeBoardHead(p)`, `pipeEditor(p,g)`; действия `A['pipe-group|pick|lock|stage-add|stage-del|add|del']`, `ON.change['pipe-name'|'pipe-stage-name']`; окна `MODALS.pipeStageDel('pipeId|stageId')`, `MODALS.pipeDel(id)`; вкладка `SETTINGS_TABS.pipes` (order 30, право `settings`); `S.ui.pipeGroup`, `S.ui.pipeSel`. Доска задач зовёт те же функции.
- **Доска задач** — `curBoard()`, `S.ui.taskBoard`, `S.ui.boardEdit`, `A['board-edit'|'task-board'|'task-take']`, `taskTake(id)`, `taskTakable(t)`, `taskDot(t)` (цвет по флагу и месту этапа); у задачи после «Взять» поле `took:{dept,at}`.
- **Pipes** — `usage(st,pipeId,stageId)→{items,rules}`, `why`/`lock` (причина запрета, пусто — можно), `guard(kind, pipe=>{stageId:зачем})`, `beforeEnd(st,pipeId)`, `siblings(st,pipeId)`. `removeStage` переносит записи всех видов и `shipRules.then`, возвращает `{ok,moved,rules,reason}`; этапы с флагами и защищённые не удаляет. `removePipe` переносит только между воронками того же вида, типа и направления.
- **Защищены** — лиды: первый, «Связались», «Квалифицирован», «Сделка создана», «Отказ»; отправки: первый, «В пути», «Доставлена», «Отменена»; любые этапы с `final` и `arrived`.
- Лиды, поставки и отправки — только правка этапов: разделы показывают одну воронку. Перестановки этапов нет.

### T06, кусок 2 — уведомления, звук, роли (`c0eaa1d`)
- **Notify** — `SOUNDS`, `wants`, `setWanted(st,id,kind,on)`, `soundPref(st,id)→{on,kind}`, `setSound(st,id,{on?,kind?})`, `unreadIds`, `soundFor(st,id,before,after)` → id звука или `null`. Звук личный, по умолчанию выключен.
- **Perms** — `addBlock`, `removeBlock` (причина отказа или пусто).
- **Вид** — `63-settings-notify.js`: `NOTIFY_GROUPS`, `NOTIFY_KINDS`, `SOUND_NOTES`, `playSound(kind, Ctx?)`, `chimeCheck()` (зовётся в `render()`), `roleMatrix(withDel)` — одна матрица на «Сотрудники и права» и в настройках, `vRoles()`.
- **Вкладки** — `notify` (order 20, всем), `roles` (order 80, право `settings`). Галочку в матрице меняет только `settings` или `admin`.

### T06, кусок 3 — главный экран, понятность, пульт (`0f4015a`)
- **Оболочка** — `NAV.hint` (строка «что здесь и зачем», до 160 знаков, кладётся под заголовок в `render()`); `emptyState(text, btnLabel, action, attrs?)`; `MAX_GROUP=6`.
- **Поиск** — реестр `SEARCH.push({kind, label, find:q→[{title, sub, open}], order?})`, у источника до 4 записей, всего 12; сделки через `Leads.dealsVisible`.
- **Пульт** — `64-sims.js`, NAV «Пульт проверки» (группа «Управление», право `admin`); `SIMS.push({id, label, run})`, `run → {text, view, id?}`; имитации: лид с сайта, лид из Битрикса, письмо, статус перевозчика, прибытие груза (`arrival`, 54).
- **Главный экран** — `homeTiles() → [{id,label,value,sub,tone}]`, `A['home-tile']`; числа из `Deals.sumOf`, `Stock.expired(st,now)`, `Acts.counts`, `Acts.noNext`, `Dispatch.query`, `Ships.awaitingReceipt`, `taskCounts()`.
- **Сумма сделок** — одна функция `Deals.sumOf(deals)` поверх `Deals.total`: шапка колонки, сводка директора.

### F1 — ремонт после ревью ветки (`443fa06`)
- **Право** `dealsEdit` «Заводить и править сделки» — у менеджеров B2B и B2C, РОП и директора; `clients` теперь только видеть. `Deals.canMake` смотрит на `dealsEdit`.
- **Deals** — `left` (сколько ещё можно зарезервировать, одна функция для экрана и ядра), `reserve`, `keepTrail`, `noteRelease`, `managerOf`.
- **Pipes** — `closing`, `ruleMayTo`, `moveTargets`, `stuck`: на этапы `final` и `arrived` записи попадают только своим путём (приёмка, `Dispatch.setStage`, `Deals.win`).
- **Stock** — `release` принимает id резерва; перемещение при «В пути» берёт не больше `Stock.sellMax`.
- **Store** — `FILE_MAX` (2 МБ), `fileTooBig`; `dump` выкидывает вложения по одному, сначала новые и крупные.
- **Вид** — `clientVisible`, `clientsSeen`, `clientCanEdit`, `homeExpired`, `homeSoon`, `msgDeals`, `reserveDeals`: всё, что называет сделку, — через `Leads.dealsVisible`.
- **Dispatch.update** отказывает в правке и удалении списанной строки. Демо-перемещения не доходят дальше «Готова к отправке».
