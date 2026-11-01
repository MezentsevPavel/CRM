# Заметки: как устроен прототип (для серверной версии)

Снято с кода на 2026-11-01, ветка `claude/server-crm-wind-solar-20828b`, `Store.REV` = 15. Код не менялся. Пути — от корня репозитория; номера строк — на этот день.
Что посчитано машиной, а что прочитано глазами, помечено в тексте: «посчитано» — скриптом по живому коду (`tests/load.js`), «по чтению» — моя классификация.

## 1. Размеры

| Группа | Файлов | Строк |
|---|---|---|
| `src/js/*.js` всего | 42 | 9 410 |
| из них снимки данных `10-catalog-data.js` (251 стр., 87 КБ) и `11-stock-data.js` (216 стр., 49 КБ) | 2 | 467 |
| ядро `31`–`44` (вместе с демо-данными своего модуля) | 14 | 3 994 |
| виды `50`–`71` (+ `41-feed.js` вид внутри ядра) | 22 | 4 498 |
| `src/css/*.css` | 18 | 1 145 |
| `src/page.html` | 1 | 44 |
| `tests/*.js` (16 файлов `*.test.js` + `load.js` + `index.js`) | 18 | 10 883 |
| `crm-wind-solar.html` (результат сборки) | 1 | 1 058 021 байт |

По файлам `src/js`: 00-util 56 · 10-catalog-data 251 · 11-stock-data 216 · 20-model 230 · 30-store 161 · 31-perms 120 · 32-pipes 253 · 33-stock 326 · 34-ships 483 · 35-leads 432 · 36-mail 213 · 37-notify 137 · 38-catalog 179 · 39-dispatch 541 · 40-clients 212 · 41-feed 245 · 42-deals 573 · 43-acts 221 · 44-attach 59 · 50-shell 605 · 51-home 128 · 52-tasks 91 · 53-stock 271 · 54-ships 515 · 55-receiving 196 · 56-deals 493 · 57-messages 26 · 58-team 74 · 59-settings 33 · 60-leads 325 · 61-mail 186 · 62-settings-pipes 164 · 63-settings-notify 119 · 64-sims 66 · 65-settings-stock 68 · 66-settings-ships 86 · 67-settings-leads 155 · 68-settings-mail 172 · 69-dispatch 407 · 70-clients 211 · 71-attach 107 · 90-boot 4.
По файлам `src/css`: 00-tokens 22 · 10-base 19 · 41-feed 64 · 50-shell 232 · 51-home 60 · 52-tasks 24 · 53-stock 48 · 54-ships 183 · 55-receiving 51 · 56-deals 120 · 57-messages 31 · 58-team 4 · 60-leads 43 · 61-mail 79 · 62-settings 42 · 69-dispatch 71 · 70-clients 49 · 71-attach 3.

Тесты: 16 файлов `tests/*.test.js`, **417** вызовов `test(` (416 в начале строки + 1 вложенный в `shell.test.js`). По файлам: dispatch 50 · leads 42 · ships 42 · mail 35 · settings 35 · deals 32 · foundation 32 · stock 30 · home 23 · repair 21 · reserve-view 19 · acts 18 · clients 15 · attach 9 · notify-ref 9 · shell 5. Полный прогон — около 60 с (по `AGENTS.md`).

## 2. Поток изменения состояния

**Запуск.** `src/js/90-boot.js:3-4`: `S=startState(); render();`. `startState` (`50-shell.js:25-29`) = `savedState()` или `freshState()`, плюс раздел из `#адреса`. `savedState` (`:11-22`): `Store.load(localStorage['ws-crm-v3'])`; чего нет в сохранённом — берётся из `seed()` по ключам верхнего уровня; если `S.me` не найден — первый человек. `freshState` (`:9`) = `seed()` + `ui`.

**Клик/ввод → запись.** `document` слушает `click` (`50-shell.js:532-544` → `A[data-act]`), `submit` (`:545` → `FORMS[data-form]`), `input`/`change` (`:547-552` → `ON.input|change[data-on]`, затем `saveSoon()`); плюс 5 слушателей `drop` (перетаскивание карточек): `50-shell.js:563` (задачи → `setTaskStatus`), `54-ships.js:510` (→ `shipMark`), `56-deals.js:480` (→ `dealMoveTo`), `60-leads.js:276` (→ `leadMoveTo`), `69-dispatch.js:395` (→ `dspMove`); `byId('role')` change (`:592` → `setMe`); `hashchange` (`:596`); `setInterval(actsTick, 60000)` (`:594`, `41-feed.js:238`).

**`render()`** (`50-shell.js:398-417`) — не чистая отрисовка, она **меняет сохраняемое состояние**: `syncRcv()` (`:403`, пишет `S.rcv`), `S.view='home'` (`:401`), `Notify.markRead(S,S.me)` в разделе «Уведомления» (`:410`), `Acts.notify(S,new Date())` и `Leads.notifyWaiting(S,new Date())` (`:411`, порождают уведомления и ставят `a.remindedAt`, `l.waitNoted`), и в конце `save()` (`:416`). То есть каждая отрисовка может писать, а каждая — сохраняет всё состояние целиком.

**`save()`** (`:32-48`): `Store.dump(S)` → `localStorage.setItem`; не влезло — цикл предела `[.95,.9,.8,.65,.5,.3,0]` от длины, тост «не сохранено — мало места». **`saveSoon()`** (`:50`): `setTimeout(save,400)`, для ввода с клавиатуры. `resetData()` (`:52-60`) заменяет `S` целиком (остаются `me`, `view`, `prefs.theme`).

**Store** (`30-store.js`): `KEY='ws-crm-v3'` (:5), `VERSION=3`, **`REV=15`** (:22; список причин подъёма — комментарии :9-21), `LIMIT=4 500 000` символов (:24).
- `plain` (:34-48): копия для JSON, `ui` на верхнем уровне пропускается, функции/`undefined` пропускаются, **`Date` → `{$date: ISO}`** (`NaN` → `{$date:null}`).
- `dump(state, limit)` (:109-131): `Catalog.pack` убирает товары снимка (остаются правки `productEdits`, `productsRemoved`, своих товаров), добавляет `rev`; не влезло — выкидывает фото/файлы (раздел 7). → `{text, droppedPhotos, droppedFiles, fits}`.
- `load(raw)` (:135-150): `JSON.parse` с ревайвером `{$date}`→`Date` (:139-144); чужая `v` или `rev ≠ REV` → `null` (тогда `seed()`, всё накликанное пропадает молча); `Catalog.unpack`.
- `freeId(list,prefix)` (:153): `prefix + (длина+1)`, пропуская занятые.

**Откуда `now`.** Ядро (`31`–`44` без вида в `41-feed.js`) `new Date()` не зовёт: время — аргумент `now` (проверено: 0 вхождений в ядре). Виды зовут `new Date()` на месте: 70 вхождений в `41-feed.js` и `50`–`71` (41-feed 8 · 5x 38 · 6x 20 · 7x 4) и 2 в `20-model.js` (`isLate` :186, `stockOf` :191). `T0` (`00-util.js:6`) — полночь в момент загрузки страницы, на нём держатся `day(n)`, `dd(d)` (`00-util.js:7,13`), демо `20-model.js` и сроки; для долго открытой вкладки «сегодня» не двигается. Демо поставок/писем/лидов привязано к фиксированной дате 31.10.2026 (`34-ships.js:321`, `36-mail.js:138`). Все функции дат — по **местному** часовому поясу (`sod`, `fD`, `fT`, `fromIso(s,h=12)`): на сервере нужен явный `TZ`, иначе тексты уведомлений (`fD`, `fWhen` вшиваются в `n.text` при создании) и «последний день резерва» (`Stock.expired`, `33-stock.js:223`) поедут.

**Идентификаторы.** Все выдаются на клиенте по локальному списку: `Store.freeId` (задачи `t`, сообщения `m`, уведомления `n`, резервы `r`, товары `u`, юрлица `e`, города `c`, правила `sr`, лента `f`, дела `a`, файлы `fl`, роли `role`, ящики/поставщики), `Leads.nextId` (`35-leads.js:33`: `Л-`, `Д-`, `К-`), `Dispatch.nextNumber` (`39-dispatch.js:235`: `ОТ-NNN`), поставка `П-` — прямо в виде (`54-ships.js:375`). У нескольких пользователей это гонка.

**Верхний уровень `S`** (посчитано, 35 ключей; размер JSON в демо, символов):
- *Данные фирмы, общие* (29): `products` 116 110 (434 шт.) · `stock` 4 554 · `aside` 1 232 · `moves` 1 100 · `reserves` 2 754 · `shipments` 142 245 (126) · `shipRules` · `deals` 16 284 (32) · `leads` 15 986 (24) · `clients` 4 214 (31) · `feed` 65 421 (360) · `acts` 10 509 (48) · `tasks` 2 655 (10) · `msgs` · `notes` 2 607 · `dispatches` 10 954 (20) · `mail` 12 818 (`{boxes,suppliers,letters}`, 2/6/33) · `pipelines` 2 126 (7) · `depts` · `entities` · `cities` · `roles` 3 534 (9) · `people` 1 162 (14) · `rules` (5 авто-правил сообщений) · `lostReasons` · `leadSource` · `leadWaitMin` · `tpl` · `address`.
- *Личное/сеансовое, но лежит в сохраняемом `S`* (5): `me` (кто сейчас), `view` (раздел), `prefs` (`theme` — одно на всех, `sound[personId]`, `notify[personId]`, `ship` — настройки таблицы поставок, одно на всех), `rcv` (черновик приёмки с фото в виде data-URL), `v` (версия схемы).
- *Не сохраняется*: `ui` (по умолчанию 12 ключей `20-model.js:142`; на практике ещё `ships`, `deals`, `leads`, `dispatch`, `clients`, `dspDraft`, `attDraft`, `sims`, `dealTab`, `leadTab`, `setTab`, `pipeSel`…).
- Размер `Store.dump(seed())` = 318 036 символов (порог теста `340000`: `tests/stock.test.js:527`).

## 3. Обработчики, меняющие данные (главный раздел)

**Что считалось.** Живые реестры в рантайме (`tests/load.js`): `A` 136 · `FORMS` 36 · `ON.input` 20 · `ON.change` 57 = **249 обработчиков** (посчитано). Для каждого прочитан код, включая помощники вида (`shipMark`, `receiveShip`, `taskTake`, `leadAct`, `dealRun`, `lostReason*`, `mailDeleteSupplier`…). Классы (по чтению):
- **только ядро** — всё сохраняемое меняют функции модулей `31`–`44` (в т.ч. `Notify.*`, `Feed.add`);
- **ядро + прямая** — зовёт ядро, но ещё сам присваивает поля/пушит в массивы `S.*`;
- **прямая** — правит сохраняемое `S` без ядра (поля записей, `push`/`splice`, `S.prefs`, `S.me`, `S.rcv`, `S.tpl`);
- **только ui** — меняет лишь `S.ui`/DOM/окна/тосты.

| Файл | Всего | только ядро | ядро + прямая | прямая | только ui |
|---|---|---|---|---|---|
| 41-feed (дела) | 4 | 2 | 0 | 0 | 2 |
| 50-shell | 37 | 4 | 6 | 9 | 18 |
| 51-home | 1 | 0 | 0 | 0 | 1 |
| 52-tasks | 4 | 0 | 1 | 0 | 3 |
| 53-stock | 16 | 1 | 0 | 0 | 15 |
| 54-ships | 17 | 1 | 1 | 5 | 10 |
| 55-receiving | 7 | 0 | 0 | 7 | 0 |
| 56-deals (+ `feed-comment`) | 35 | 13 | 0 | 0 | 22 |
| 57-messages | 5 | 0 | 0 | 3 | 2 |
| 58-team | 6 | 2 | 0 | 3 | 1 |
| 59-settings | 1 | 0 | 0 | 0 | 1 |
| 60-leads | 22 | 7 | 1 | 0 | 14 |
| 61-mail | 11 | 2 | 1 | 1 | 7 |
| 62-settings-pipes | 11 | 7 | 0 | 0 | 4 |
| 63-settings-notify | 4 | 3 | 0 | 0 | 1 |
| 64-sims | 2 | 0 | 1 | 0 | 1 |
| 65-settings-stock | 5 | 0 | 0 | 5 | 0 |
| 66-settings-ships | 5 | 0 | 0 | 5 | 0 |
| 67-settings-leads | 5 | 2 | 0 | 3 | 0 |
| 68-settings-mail | 9 | 0 | 0 | 8 | 1 |
| 69-dispatch | 28 | 6 | 0 | 0 | 22 |
| 70-clients | 9 | 2 | 0 | 0 | 7 |
| 71-attach | 5 | 2 | 0 | 0 | 3 |
| **Итого** | **249** | **54** | **11** | **49** | **135** |

По реестрам: `A` 136 = 20 ядро · 6 ядро+прямая · 12 прямая · 98 ui; `FORMS` 36 = 23 · 4 · 9 · 0 (все формы что-то меняют); `ON.input` 20 = 0 · 0 · 4 · 16; `ON.change` 57 = 11 · 1 · 24 · 21.

**Итог:** данные меняют **114 из 249**. Из них только через ядро — **54 (47 %)**, с прямой записью — **60 (53 %)**: 49 чисто прямых + 11 смешанных. UI-только — 135.

Что внутри 49 «прямых»: настройки и справочники — 24 (роли/люди 3 `58-team`, юрлица/города 5 `65`, правила поставок 5 `66`, причины отказа 3 `67`, ящики и поставщики почты 8 `68`); черновик приёмки `S.rcv` — 11 (7 в `55-receiving` + `rcv-start`, `rcv-step`, `rcv-photo-del`, `rcv-again` в `50-shell`); сообщения клиентам — 5 (`FORMS.msg`, `ins-var`, `tpl`, `addr`, `rule`); личное/сеанс — 8 (`theme`, `view-as`→`S.me`, `reset` на весь `S`, 5 настроек таблицы поставок в `S.prefs.ship`); почта — 1 (`mail-open` ставит `l.read=true`).
11 «смешанных»: `FORMS.task`, `FORMS.ship`, `FORMS.product`, `FORMS.stage`, `A['task-st']` (+ drop на доске задач), `A['task-take']`, `A['rcv-confirm']` (приёмка), `ON.change['ship-stage']` (+ drop на доске поставок), `A['lead-sim']`, `A['mail-sim']`, `A['sim-run']` (в трёх последних ядро делает запись, вид потом ставит `.sim=true`).

**Модулей ядра нет вовсе для:** задач (создание, смена этапа, «Взять» — всё в виде), приёмки (`receiveShip`, `55-receiving.js:114-153`), создания поставки и товара, сообщений клиентам `S.msgs`, справочников юрлиц/городов, ящиков/поставщиков почты, правил поставок `S.shipRules`, причин отказа (`lostReasonAdd/Rename/Remove` — функции `(st,…)`, но лежат во view `67-settings-leads.js:36-58`), прав роли и роли человека, личных настроек.

**Характерные прямые правки** (`файл:строка`):
1. `50-shell.js:508` — `S.tasks.push(t)` в `FORMS.task`; права (`tasksAssign` — только свой отдел) проверяет лишь список в форме `:143-144`, сам обработчик — нет.
2. `50-shell.js:287` — `t.stageId=stageId` в `setTaskStatus` (и drop `:563`); кто может двигать — не проверяется вовсе.
3. `52-tasks.js:78` — `t.to={t:'p',id:m.id};t.took={dept,at:now}` в `taskTake`.
4. `50-shell.js:519` — `S.products.push({... src:'user'})` в `FORMS.product`; право `catalog` — только кнопка `53-stock.js:36`.
5. `50-shell.js:526` — `S.msgs.push(...)` в `FORMS.msg`.
6. `54-ships.js:382` — `S.shipments.push(s)` в `shipCreate`; `:375` — номер `П-` считается в виде; `:356,366` — `s.history.push(...)`; `:358,363` — `s.eta=ne` в `shipStageForm`.
7. `54-ships.js:343` — `S.msgs.push(...)` авто-сообщение клиенту внутри `shipMark`.
8. `55-receiving.js:120,124,127,134` — `it.got=q`, `s.entityId/cityId=…`, `x.src='stock'` у резервов, `s.received={at,by,urls,…}`; `:132` `s.history.push`; `:140` `S.tasks.push`; `:141` `S.msgs.push` — внутри `receiveShip`, вокруг вызовов `Stock.move`, `Deals.noteRelease`, `Stock.release`, `Ships.setStage`, `Ships.applyRules`, `Notify.push`. Права `receive` в самой функции нет, только `NAV.ok`.
9. `58-team.js:40` — `r.perms[t.dataset.perm]=t.checked` (право роли; проверка `can('settings')||can('admin')` в обработчике, но вкладка «Роли» открыта только с `settings`); `:44` `p.role=t.value`; `:45` `p.specialty=`.
10. `65-settings-stock.js:18,25,33,41` — `item.name=`, `c.address=`, `S.entities.push`, `S.cities.push`.
11. `66-settings-ships.js:54,61,68,73,82` — `r.on/when/then=`, `S.shipRules.splice/push`.
12. `68-settings-mail.js:29,47,53,60,70,83,93,106` — `m.suppliers.splice`, `b.title/address/roles=`, `m.boxes.push`, `s.name/rules=`, `m.suppliers.push`.
13. `57-messages.js:21,22,26` — `S.tpl=`, `S.address=`, `r.on=`; `50-shell.js:483` — `S.tpl=` (кнопка вставки переменной).
14. `61-mail.js:118` — `l.read=true` при открытии письма (запись при чтении).
15. `54-ships.js:33` — `S.prefs.ship=Object.assign(...)` (`setShipPref`); `50-shell.js:79` — `S.prefs.theme=t`; `:278` — `S.me=pid`.

Всего по grep (приблизительно, по чтению): около 20 присваиваний ключей верхнего уровня `S` (не `ui`) в `50-shell`, `54`, `55`, `57`, `66`; 19 строк `push/splice` в массивы `S.*` и вложенные (`50`:4, `54`:4, `55`:4, `65`:2, `66`:2, `68`:3); около 28 присваиваний полей записей. Итого порядка 65 мест прямой записи в 12 файлах.

**Составные команды в виде** (несколько вызовов ядра подряд без общей транзакции): `FORMS['stock-sell']` (`53-stock.js:252`: `Deals.keepTrail` + `Stock.sell` + `Feed.add`); `FORMS['deal-new']` (`56-deals.js:423`: `Clients.create` + `Deals.create` + `Deals.move`, клиент остаётся, если сделка не создалась); `FORMS['deal-lose']` (`:448`: `Deals.lose` + `Feed.comment`); `FORMS.dispatch` (`69-dispatch.js:347`); `shipStageForm` (`54-ships.js:351`); `receiveShip`.

**Права в обработчиках.** В ядре права проверяют не все функции (раздел 4); в видах остальные проверки делает код вида (`shipMark` `54-ships.js:331` — `logistics`; `leadAct` `60-leads.js:190` — `Leads.can`; `ON.change['lead-wait']` `67:123` — `settings`; `A['stock-sell']` `53:245` — `sell`), а многие — только скрытием кнопки/пункта меню (задачи, товар, приёмка, юрлица, правила, ящики, сообщения клиентам, цены).

## 4. Ядро

Все модули — `const Имя=(()=>{…})()`, первым аргументом `st`, время `now`, автор `by`. Модуль 38 (`Catalog`) и 37 (`Notify`) — без прав по своей природе. «Проверяет сам» = внутри функции есть `Perms.can` или видимость; «вызывающий» = проверку делает вид. Подсчёт по чтению: 68 публичных функций, меняющих `st`; из них проверяют себя 31 (Stock 1, Leads 4, Mail 1, Dispatch 7, Clients 2, Feed 1, Deals 12, Acts 2, Attach 1), 37 — нет (часть из них внутренние/системные).

| Модуль | Меняют `st` | Проверяют сами | Проверяет вызывающий вид / не проверяет |
|---|---|---|---|
| 31 Perms | `addRole`, `removeRole` (`removeBlock` — защита встроенных/занятых) | — | всё через вид (`58-team`); переключение права роли — прямо в виде |
| 32 Pipes | `rename`, `renameStage`, `addStage`, `removeStage`, `addPipe`, `removePipe` | — (защита этапов `guard`) | вкладка `ok:can('settings')` |
| 33 Stock | `move`, `reserve`, `unreserve`, `release`, `sell` | `sell` → `Perms.can(by,'sell')` (:260) | `move/reserve/unreserve/release` — нет; резерв проверяет `Deals.reserve` (`reserve`+`dealsEdit`); читающие `reserveView/dealRef/docView` проверяют `stock`/видимость |
| 34 Ships | `setStage`, `advance`, `applyRules` | — | `logistics` — в `shipMark`; `advance` из «имитации перевозчика» — нет |
| 35 Leads | `create`, `add`, `take`, `contacted`, `close`, `move`, `transfer`, `toDeal`, `setWaitMin`, `setSource`, `notifyWaiting` | `add` (`leads`), `take` (`canTake`), `move` (`canWork`), `transfer` (`leadsAssign`) | `contacted`, `close`, `toDeal` — только «человек существует»; `setWaitMin`, `setSource` — нет (вид: `settings`); `create`/`notifyWaiting` — система |
| 36 Mail | `deliver`, `remember`, `reply` | `reply` (`boxesFor` = право `mail` + роль ящика) | `remember` — нет; `deliver` — система |
| 37 Notify | `push`, `pushFor`, `markRead`, `setWanted`, `setSound` | — | личное: `personId` передаёт вызывающий (`S.me`) |
| 38 Catalog | `unpack` (при загрузке) | — | добавление товара — прямо в виде |
| 39 Dispatch | `create`, `update`, `setStage`, `assign`, `pick`, `comment`, `sell` | все семь: `create` (человек есть), `update` (`canEdit`: `dispatch` или автор на первом этапе), `setStage` (`canWork`/`canCancel`), `assign`/`pick` (`canWork`), `comment` (любой сотрудник), `sell` (через `Stock.sell`) | `sell` не смотрит на этап/отмену (баг д) |
| 40 Clients | `create`, `update`, `findOrCreate` | `create`/`update` → `canEdit` = право `clients` **или пустой `by`** (:68) | `findOrCreate` — нет (внутреннее); вид режет `dealsEdit` (`70-clients.js:30`) — ядро нет (баг а) |
| 41 Feed | `add`, `comment` | `comment` → `canComment` (сделка — видима, лид — видим, клиент — `clients`, отправка — любой) | `add` — внутренний |
| 42 Deals | `create`, `update`, `move`, `win`, `lose`, `reopen`, `addItem`, `setItem`, `removeItem`, `reserve`, `reserveItem`, `unreserve`, `keepTrail`, `noteRelease` | 12: `dealsEdit` + видимость (`open`/`canEdit`) + `reserve` для резервов | `keepTrail`, `noteRelease` — внутренние |
| 43 Acts | `plan`, `done`, `moveOpen`, `notify` | `plan`/`done` → `Feed.canComment` | `moveOpen`, `notify` — внутренние/системные |
| 44 Attach | `add`, `remove` (`clean`, `tooBig` — чистые) | `remove` — автор или `any` | `add` — нет (вид: `ATT[kind].see`); берут `rec`, а не `st` |

Зависимости ядра от глобальных помощников: `00-util` (`num`, `pl`, `fD`, `fWhen`, `sod`, `low`, `rub`), `20-model` (`CH`, `dealPipe`, `qtyOf`), `Store.freeId`; DOM, `localStorage` и `S` ядро не трогает (проверено grep). Код ядра можно грузить в Node тем же приёмом, что `tests/load.js`.

## 5. Права и видимость

- **Права** (`31-perms.js:6-28`), 21 штука: `firm`, `tasksAll`, `tasksAssign`, `stock`, `prices`, `reserve`, `catalog`, `logistics`, `receive`, `clients`, `write`, `auto`, `admin`, `mail`, `leads`, `leadsAssign`, `dealsAll`, `dealsEdit`, `settings`, `dispatch`, `sell`. Неизвестное право — «нет» у всех (`:74-80`).
- **Роли — данные** `S.roles[]` = `{id, name, builtin, perms:{право:bool}, all?, scope?}`. Встроенные по умолчанию 7 (`DEFAULTS` `:35-45`): `director` (`all`), `managerB2b`/`managerB2c` (`scope:'b2b'|'b2c'`), `logist`, `warehouse`, `chiefEngineer`, `engineer`. В демо 9: ещё `rop` (добавляет шаг `35-leads.js:382-386`; право `dealsEdit` дописывает шаг `42-deals.js:470`, `sell` — шаг `39-dispatch.js:451-453`) и `driver` (шаг `39-dispatch.js:448-450`, только `dispatch`). Для сервера: роли `rop`/`driver` и их доборы живут в **сидах**, не в `Perms.defaultRoles()`.
- **Люди** `S.people[]` = `{id, name, role, dept, demo?, specialty?}` (`20-model.js:24-36`); **полей логина, пароля, почты, телефона нет**. Отделы `S.depts` (5).
- **Текущий пользователь**: `S.me` (в сохраняемом `S`). Выбирает его кто угодно: список «Кто я» в шапке (`src/page.html:25`, `<select id="role">`; варианты `whoOptions()` `50-shell.js:124`; слушатель `:592`), `setMe` (`:276-283`), кнопка `view-as` в таблице сотрудников (`58-team.js:10`). `can(p)` = `Perms.can(S,S.me,p)` (`20-model.js:146`), `me()` (`:148`).
- **Видимость, в ядре**:
  - `Leads.visible(st,pid)` (`35:346`): нужно `leads`; `leadsAssign` (директор, РОП) — все; менеджер — свои + своего типа.
  - `Leads.dealsVisible(st,pid)` (`35:356`): нужно `clients`; директор или `dealsAll` — все; иначе свои + своего `scope`. Единственный источник видимости сделок (ADR 0005).
  - `Stock.reserveView(st,r,pid)` (`33:307`): нужно `stock`; номер сделки/клиент — только если сделка видна, иначе «сделка скрыта»; `dealRef` (:299), `docView` (:320).
  - `Mail.boxesFor(st,pid)` (`36:33`): нужно `mail`; директор — все ящики, остальные — по `box.roles`.
  - `Feed.canComment` (`41:103`), `Clients.related(st,id,pid)` (`40:143`), `Acts.open/counts` по `personId`.
- **Видимость, только в видах** (на сервер переносить придётся): клиенты — `clientVisible` (`70-clients.js:20-27`: свой менеджер, либо у человека есть видимая сделка/лид, либо у клиента вообще нет сделок и лидов); задачи — `taskMine`/`taskVisible` (`20-model.js:199-200`: `tasksAll` или мои/моего отдела/поставил я); отправки — видят все (`NAV ok:()=>true`, `69-dispatch.js:403`); файлы — `ATT[kind].see` (`71-attach.js:9-12`); уведомления — `n.to.includes(S.me)`, директор с `firm` ещё «вся фирма» (`50-shell.js:129-130`); поиск — `SEARCH.find` каждого раздела; карточки — `DRAWERS.*`.
- **Цены**: право `prices` скрывает суммы только в видах (`56-deals.js:49,57,67,77,152`, `53-stock.js:70,164`, `51-home.js:85`); сами цены лежат в `S.products[].price`, `deals[].items[].price`, `deals[].amount` и уходят клиенту целиком.
- **Меню `NAV`** (15 пунктов, `ok()`): `home` (все), `tasks` (все), `notifications` (все), `stock` (`stock`), `logistics` (`stock`|`logistics`), `receiving` (`receive`), `dispatch` (все), `deals` (`clients`), `clients` (`clients`), `leads` (`leads`), `messages` (`write`|`auto`), `mail` (`mail` + есть ящики), `team` (`admin`), `sims` (`admin`), `settings` (есть хоть одна вкладка).

## 6. Уведомления

- **Форма записи** `S.notes[]` (`37-notify.js:85-90`): `{id:'nN', kind, by:personId|null, at:Date, text, to:[personId], read:[personId], ref:{t,id}|null}`; новое — в начало (`unshift`). Хранится в сохраняемом `S.notes`, без чистки и без предела. Прочитанность — у каждого своя (`read[]`); автор, если он в `to`, уже прочитал.
- **API**: `Notify.push(st,kind,by,text,now,extraPersons,ref)` (`:92`) → адресаты = `RECIPIENTS[kind]` ∪ `extraPersons`, минус те, кто выключил вид; `pushFor(st,kind,by,textFor,now,extra,ref)` (:99) — разный текст разным читателям; `unread`, `unreadIds`, `markRead(st,pid,noteId?)` (:110-123), `wants`/`setWanted` (:27-41), `soundPref`/`setSound`/`soundFor` (:44-134).
- **`RECIPIENTS`** (`:10-25`), 12 видов: `ship` — все; `arrive` — директор, менеджеры B2B/B2C; `reserve` — директор, кладовщик (+менеджер сделки); `warn` — директор, логист, менеджеры; `task` — никто (исполнитель/отдел/автор через `extra`); `msg` — директор; `lead` — директор, РОП; `mail` — никто (кто видит ящик); `act` — никто (ответственный); `dispatch` — логист, кладовщик; `dispatchStep` — никто (автор/водитель); `leadWait` — директор (+ `Leads.waitRecipients`: РОП, а без РОП — менеджеры типа лида, `35:159`).
- **Личные настройки**: `S.prefs.notify[pid][kind]===false` (вид выключен), `S.prefs.sound[pid]={on,kind}` — экран «Настройки → Уведомления» (`63-settings-notify.js`).
- **Звук**: 4 звука (`Notify.SOUNDS` `:44`), синтез в браузере через WebAudio (`playSound` `63:45`), файлов нет. `chimeCheck()` (`63:74-81`, зовётся из `render()` `:416`) сравнивает `unreadIds` с прошлой отрисовкой в переменной страницы `chimeSeen` (не сохраняется): первая отрисовка и смена «кто я» — тишина.
- **Вызовы**: `Notify.push|pushFor` — 13 строк в видах и 10 в ядре (`34`:1, `35`:3, `36`:1, `39`:3, `42`:1, `43`:1).
- **Время/системные источники**: `Acts.notify` (напоминание о деле, `43:172`) и `Leads.notifyWaiting` (`35:164`) — по таймеру 60 с (`41-feed.js:238`) и при каждом `render()`; одно уведомление на дело/лид (`a.remindedAt`, `l.waitNoted`).
- **`ref` и `A['note-open']`**: `ref={t,id}`, `t` ∈ `Notify.REF_KINDS` = `task, deal, lead, client, ship, dispatch, mail, product` (`:77`); `cleanRef` (:78-82) бросает ошибку на неизвестный вид. Строка с `ref` кликабельна: `noteRow` (`20-model.js:210-217`) ставит `data-act="note-open"`. `A['note-open']` (`50-shell.js:440-445`): `Notify.markRead` (всегда) → `openRef(n.ref)` → `render()`. Реестр `REFS` (`:219`): `{label, exists, see, open}`; `regRef` (:221); `refState` (:223-230) даёт `none|ok|gone|denied` (сообщения «Запись удалена», «Нет доступа» — без номера объекта); `openRef` (:232-237). Регистрации: `task` `52-tasks.js:86`, `product` `53:231`, `ship` `54:471`, `deal` `56:493`, `lead` `60:325`, `dispatch` `69:407`, `client` `70:211`, `mail` `61:123` (все 8 видов).
- Колокол (`A.bell`, `50-shell.js:433-438`): открытие поповера помечает прочитанными первые 10.

## 7. Файлы

- **Файл**: `{id:'flN', name, type, size, data:'data:…;base64,…'|null, by, at, unsaved?}` (`44-attach.js:1-4`). Лежит в поле `files` записи: `S.tasks[].files`, `S.shipments[].files`, `S.dispatches[].files` (отправки с `39-dispatch.js:226`: `Attach.clean`, `tooBig`). Данные — **data-URL внутри `S`** (и в сохранении).
- **Операции**: `Attach.add(rec,list,by,now)` (:35-44, всё или ничего), `Attach.remove(rec,fileId,by,any)` (:50-56; свой — тот, кто приложил; чужой — по флагу `any`: у задачи — автор, у поставки — `logistics`), `clean`, `tooBig`. Вид — `71-attach.js`: чтение через `FileReader` (`attReadFiles` :40-49), блок «Файлы» в карточках задачи и поставки, поле в формах «Новая задача»/«Новая поставка» (черновик `S.ui.attDraft`, не сохраняется). Отправки — свой черновик `S.ui.dspDraft.files`, чтение тем же `attReadFiles`.
- **Фото приёмки**: `addPhotos` (`55-receiving.js:178-186`): только `image/*`, не больше 9 за раз, сжатие через `<canvas>` до 720 px по длинной стороне, JPEG 0,82; кладутся в `S.rcv.photos[]` (строки `data:image/jpeg…`, черновик **сохраняется**), после приёмки копируются в `shipment.received.urls[]` и считаются в `received.photos`.
- **Лимиты**: файл ≤ `Store.FILE_MAX` = 2 МБ (`30-store.js:52`; отказ до чтения `fileTooBig` :55-58 и в ядре `Attach.tooBig`); число файлов не ограничено; всё состояние ≤ `LIMIT` = 4 500 000 символов (`:24`).
- **Что выкидывается при нехватке места** (`Store.dump`, `30-store.js:66-131`): `heavy(copy)` собирает фото приёмки (любые строки `data:image/…` вне ключей `files`) и данные файлов у `dispatches`, `tasks`, `shipments`; сортировка — самые новые первыми, при равном времени — самые крупные (`b.at-a.at || b.size-a.size`); выкидывается по одному, пока не влезет: у файла `data=null, unsaved=true`, у записи с фото `unsaved={photos,text}`; результат `{droppedPhotos, droppedFiles}`; сам `S` не меняется. Дальше `save()` (`50-shell.js:32-48`) ужимает предел по шагам и тостит «Фото/Файлы не сохранены — мало места в браузере». Показ пометки: `unsavedNote` (`20-model.js:229`), `attFileHtml` (`71:21`).

## 8. Остатки

- **Снимок** `STOCK_SNAPSHOT` (`src/js/11-stock-data.js`, первые строки): шапка-комментарий (:1-6), затем `const STOCK_SNAPSHOT = {source:'Google-таблица «Выгрузка с корса общая», лист «Остатки»', snapshot:'2026-10-31', rows:[ {name, cat, ip, npp, vs, custody, transit, damaged}, … ]}`. 208 строк. Пустая клетка таблицы — `null`, ноль — `0`, текст в числовой клетке — `null`. `cat` — раздел таблицы со вложенностью «Раздел › Подраздел» (13 различных значений).
- **Колонки листа «Остатки», что отражено**: «Склад ИП» → `ip` (128 строк с числом), «НПП» → `npp` (32), «ВС» → `vs` (7), «ответхранение» → `custody` (12), «В пути» → `transit` (7), «Бой» → `damaged` (6). **Колонка «Резерв» сознательно не перенесена**: в ней имена клиентов (`11-stock-data.js:5`; `reference.md` прошлой сборки: свободный текст вроде «36шт автоношкин, 64 Алексей Н.»). Колонки «город» в источнике нет — все остатки лежат в клетке «юрлицо × город "_"».
- **Каталог** `CATALOG` (`10-catalog-data.js`): 242 позиции `{key, model, brand, price, avail, url, from, cat, sheet}`, таблица «PVCalc — параметры оборудования».
- **Склейка** `Catalog.build(catalog, snapshot)` (`38-catalog.js:40-66`): позиция каталога = товар (`id`=ключ, `inCatalog:true`); строка остатков склеивается только при точном совпадении `norm(name)` с моделью, когда и название, и строка уникальны. Из 208 строк склеились **16**, остальные **192** стали товарами `sheet-NNN` (`inCatalog:false`, «нет в каталоге»); всего товаров 434. Результат: `stock[productId][entityId]['_']=число`, `aside[productId]={damaged, custody, transitNoShip}` (есть только если что-то заполнено; 160 товаров с остатком, 20 с `aside`). Категории разделов приводятся `Catalog.sectionCat` (:24-28; крепёж из панелей → «Защита и соединения»).
- **В состояние** снимок попадает шагом `SEEDS` (`38-catalog.js:153-179`): `Object.assign(st, Stock.defaults(), {products, stock, aside})`; затем демо-ссылки старых SKU переводятся на реальные позиции (`DEMO_LINKS` :139-152). В сохранение товары снимка не пишутся (`Catalog.pack` :103-118, `unpack` :121-128; метка `catalogSnapshot`).
- **Юрлица и города**: `Stock.defaults()` (`33-stock.js:20-25`) → `entities`: `ip` «ИП», `npp` «НПП», `vs` «ВС»; `cities`: `irk` Иркутск, `msk` Москва, `krd` Краснодар (у города `address`, пустой = «нет данных: адрес»). Правятся в «Настройки → Склады и юрлица» (`65`). Таблица остатков товара — `Stock.grid` (:39-56).
- **Резервы**: `S.reserves[]` = `{id, productId, qty, entityId, cityId, src:'stock'|shipId, dealId, until, at?, by?}`; `Stock.summary` (:86-108) считает `onHand` (только юрлица×города), `free = onHand − резервы со склада`, `freeAfter`; «Бой», ответхранение, «В пути» без поставки в `free` не входят. Поля «примечание» у резерва нет; резерв без сделки показывается как `hasDeal:false` («нет данных: сделка», `33:315`), снимается через `A.unreserve` (`50-shell.js:465`) по праву `reserve`.
- **Исходного CSV и скрипта получения снимка в репозитории нет**: `tools/` содержит только `build.js` и `serve.js`; снимки вставлены коммитом `74d5b41` (T02) готовыми. Источник — Google-таблица, id и gid листа записаны в `.autopilot/2026-10-31-crm-wind-solar/reference.md:6` (`1rj5Tk5sJqLe1lonS1-EyJL7F4MSYMqxCHpQe6VnCuYM`, gid `302343963`).

## 9. Клиенты

- **Запись** `S.clients[]` (`40-clients.js:57-62`): `{id:'К-N' (Leads.nextId, min 0), kind:'person'|'company', name, phones:[строки], demo, inn?, email?, address?, managerId?}`. Событие «Клиент заведён» пишется в ленту `Feed.add(…{t:'client'})`.
- **Создание**: `Clients.create(st,data,by,now)` (:73-76; название обязательно, дубли не проверяются) → `make`; `Clients.findOrCreate` (:120-134; ищет `find(...)[0]`, у найденного дописывает недостающие телефоны/почту/ИНН/адрес, пишет в ленту «Из заявки добавлено»); из лида `Leads.toDeal` (`35:316`: привязанный `lead.clientId` или `findOrCreate`); форма «Новый клиент» `FORMS['client-new']` (`70-clients.js:196`); из формы «Новая сделка» (`56-deals.js:423`, два шага `Clients.create` + `Deals.create`).
- **Дедупликация**: `Clients.find(st,q)` (:44-47) → совпадения по `score` (:34-41): ИНН 3 > телефон 2 (`phoneKey`: только цифры, «+7»/«8» в начале 11 цифр = одно и то же) > почта 1 (без регистра), сначала сильнейшие. Подсказка «Похоже, это …» в формах (`clientDupHtml` `70-clients.js:38`, `dup-pick`/`dup-open`); **дубль всё равно можно сохранить**. Автоматического слияния нет.
- **Правка**: `Clients.update(st,id,patch,by,now)` (:90-115): `name, kind, inn, phones (список целиком), email, address, managerId`; изменение — запись в ленту клиента; новое название копируется в `deals[].client`.
- **Связи**: сделка — `deal.clientId` + копия названия `deal.client` (текст, его читают уведомления); лид — `lead.clientId` (явная привязка при заведении) или совпадение телефона/почты/ИНН (`leadBelongs` :137); отправки — по `dealId` или по телефону получателя (`related` :143-155). `Clients.related(st,id,pid)` собирает лиды, сделки, сообщения, отправки (с учётом видимости человека); лента клиента подмешивает ленты его сделок и лидов (`Feed.of`).
- **Права**: ядро — право `clients` (или пустой `by` = система, `:68`); вид — `clientCanEdit()=can('clients')&&can('dealsEdit')` (`70-clients.js:30`).
- Поиск `Clients.search` (:158-165): название, почта, телефон по цифрам, ИНН.

## 10. Демо и внешнее

- **Что в интерфейсе изображает внешнее** (наружу ничего не уходит):
  - *Telegram, MAX*: справочник `CH` (`20-model.js:6`); `deal.channel`; раздел «Сообщения клиентам» (`NAV.messages`, `57-messages.js`, право `write`|`auto`) с журналом `S.msgs`, шаблоном `S.tpl`, адресом склада `S.address`, правилами `S.rules`; `FORMS.msg` (`50-shell.js:523`, «в прототипе … не уходит»); авто-сообщения при отгрузке (`54-ships.js:343`) и приёмке (`55-receiving.js:141`, `sim:true`).
  - *Битрикс24*: `Leads.SOURCE.bitrix` (`35:12`), `Leads.SOURCES` / `S.leadSource` (`both|bitrix|site`), вкладка «Лиды и сделки» с кнопками «Имитация: пришёл лид …» (`67-settings-leads.js:101`) и перечнем «что ещё живёт в Битриксе» `LEAD_BITRIX` (`67:9`); у лида метка источника; кнопки имитации в «Лидах» при `settings` (`60-leads.js:87`).
  - *Почта*: раздел `mail` (`61-mail.js`), вкладка «Почта» в настройках (`68`, ящики, поставщики, правила адресов), ядро `Mail`; `Mail.SIM_NOTE='имитация, не отправлено'`; ответ `Mail.reply` пишет в ветку письма с `sim:true`.
  - *Пульт проверки*: `NAV.sims` (`64-sims.js:65`, право `admin`), реестр `SIMS` (`50-shell.js:424`), 5 имитаций: `lead-site` (`60-leads.js:317`), `lead-bitrix` (:318), `mail` (`61:181`), `carrier` (`54:425`), `arrival` (`54:429`); кнопки `sim-run`, `sim-open`.
- **Пометки «демо»/«пример»**: полоса «Прототип. Товары, цены, клиенты и сотрудники — примеры…» с кнопкой «Сбросить» (`src/page.html:31-35`); `demo:true` у людей, сделок, лидов, клиентов, писем, заявок; слова «пример»/«(пример)» в названиях; «демо: примеры, не ваши сотрудники» (`58-team.js:10`); вкладка «Данные» (`59-settings.js:24`, «Данные прототипа», сброс); текст «в этом браузере … общего сервера нет» (там же).
- **Переключатель пользователя**: «Кто я» (раздел 5).
- **Вкладки настроек** (`SETTINGS_TABS`, `ok()`): `look` «Внешний вид» (10, все), `notify` «Уведомления» (20, все), `pipes` «Воронки» (30, `settings`), `mail` «Почта» (40), `leads` «Лиды и сделки» (50), `stock` «Склады и юрлица» (60), `ships` «Поставки» (70), `roles` «Роли и права» (80), `data` «Данные» (90) — остальные с `settings`.
- **Google Fonts**: единственный внешний адрес страницы — `src/page.html:3-5` (`preconnect` к `fonts.googleapis.com` и `fonts.gstatic.com`, `<link>` на `css2?family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500`); шрифты названы в `src/css/00-tokens.css:10-12` (`--f-display`, `--f-body` — Manrope, `--f-mono` — JetBrains Mono). Ссылки `url` у товаров каталога (195 строк с `http` в `10-catalog-data.js`, сайт wind-solar.ru) — просто текст/ссылки, страница их не загружает. Внешних скриптов нет.

## 11. Сборка и тесты

- **`tools/build.js`**: `build(root)` склеивает `src/page.html` (места `{{CSS}}`, `{{JS}}`, `{{LOGO}}`), `src/css/*.css` по имени, `src/js/*.js` по имени внутри одной `(()=>{'use strict'; … })();`, логотип `assets/windsolar-logo.png` → data-URI (место ровно одно); пишет `crm-wind-solar.html` с шапкой «собрано из src/». Экспорт `{build, cssFiles, jsFiles, ROOT, OUT_NAME, HEAD}`.
- **`tools/serve.js`**: `node tools/serve.js <порт>`; HTTP на `127.0.0.1`, отдаёт только `GET /` и `/index.html`, оборачивает файл в `<!doctype html>…`, читает файл заново на каждый запрос, сам не собирает.
- **`tests/load.js`**: `load(opts)` — исполняет `src/js/*.js` кроме `90-boot.js` в `node:vm` с заглушками `document`/`localStorage`/`location`, поднимает `S=startState()`, отдаёт все объявленные на верхнем уровне имена геттерами (`api.S`, `api.A`, `api.Notify`…), плюс `storage`, `document` (с `dispatchEvent` для слушателей страницы). Параметры: `storage`, `hash`, `dark`, `now` (подмена `Date`), `globals` (например, поддельный `FileReader`). `bootPage(html)` — исполняет `<script>` собранной страницы целиком, возвращает `byId`, `storage`, `document`. `tests/index.js` подхватывает каждый `tests/*.test.js` по имени.
- **`tests/foundation.test.js`** (32 теста): страница склеена из `src/` по порядку имён (:25); собранная страница запускается и рисует все разделы (:46); **`crm-wind-solar.html` совпадает со сборкой из `src/`** (:57); `load.js` и `NAV` (:62); целостность `seed()` (ссылки целы, этапы по id существующих этапов, 9 ролей) (:83-142); `Store` dump/load, даты, `ui` не сохраняется, чужая версия → `null` (:182), нехватка места (:203); `Perms`, `Pipes`, `Notify` (:258-450); запрет обращения к этапу по номеру (:469); приёмка кладовщиком (:487); сохранение/сброс (:541, :696); «Кто я» (:563); тема (:600); меню по правам и «Нет доступа» (:627, :640); вкладки настроек (:664); реестры `ON`, `DRAWERS`, `SIMS` (:720); «мало места» (:777, :793).
- Остальные: `stock.test.js:527` — порог `text.length < 340000` после `seed()` (сейчас 318 036); `tests/index.js`; прогон — `node tools/build.js && node --test tests/`.

## 12. Пять известных багов

**(а) Инженер может править клиентов, комментировать и планировать дела в ленте сделки.** Причина: у `engineer`/`chiefEngineer` есть `clients` и `dealsAll` (`31-perms.js:34`, «смотрят, но не правят — R30»), а ядро проверяет не `dealsEdit`. `Clients.canEdit` = право `clients` или пустой `by` (`40-clients.js:68`, используется `create` :73-75 и `update` :93); `Feed.canComment` для сделки = «сделка видна» (`41-feed.js:105`) → `Feed.comment` (:113), `Acts.plan` (`43-acts.js:84,87`), `Acts.done` (`:110`); вид клиентов режет по `dealsEdit` сам (`70-clients.js:30`), лента — нет (`41-feed.js:184-189`).

**(б) Срок резерва по умолчанию — в нескольких местах, и значения разные.** 7 дней: форма резерва из карточки товара `53-stock.js:146` (`value="${iso(day(7))}"`). 14 дней: окно «Резерв» строки сделки `56-deals.js:282` (`iso(day(14))`) и значение по умолчанию в ядре `42-deals.js:365` (`14 * 864e5`, срабатывает, только если `until` не передан — из экрана не бывает).

**(в) «На складе: нет данных» рядом со «Свободно сейчас: 0».** `Stock.summary` не переносит неизвестность в `free`: `onHand = g.totals.all ?? 0` (`33-stock.js:92`) и `free = onHand − резервы со склада` (:96) — для товара без числа в таблице, но с резервом, `free` = 0 или минус. Вид прячет `free` только если нет ни резервов, ни прихода: `stockUnknown` (`53-stock.js:14`); иначе карточка показывает `k.known ? … : 'нет данных'` для «На складе» (:177) и `num(k.free)` для «Свободно сейчас» (:177, в списке :62).

**(г) Журнал склада пишет перемещение как «Отгрузка» и «Приход».** `Dispatch.withdraw` вызывает `Stock.move` с `Stock.KINDS.ship` (`39-dispatch.js:112`), `putBack` — с `Stock.KINDS.receive` (`:121`), хотя вид `Stock.KINDS.transfer = 'Перемещение'` есть (`33-stock.js:15`) и `Stock.move` его понимает (:183-186, пишет `toEntityId/toCityId` одним движением); `Dispatch` двигает товар двумя вызовами.

**(д) Списать можно в отменённой или доставленной заявке.** `Dispatch.sell` (`39-dispatch.js:384-400`) проверяет цель «Продажа», строку, `sold`, но не этап; кнопка в карточке тоже (`69-dispatch.js:132-135`: `canSell && it.productId && !it.sold`). Для сравнения `Dispatch.pick` закрытую заявку отвергает (`39:362`, `isFinal`).

## 13. Изменено после прошлой сборки

Четыре коммита после `ad35f71 Autopilot: сборка сдана`: `e390af0`, `80cbc6f`, `81f2a1c`, `365bc8b`.

- **`Stock.reserveView`** (`33-stock.js:288-323`, коммит `e390af0`): резерв глазами человека `{id, productId, qty, src, inTransit, where, until, deal, hasDeal}`. Нужно право `stock` (иначе `null`). `where` — «юрлицо · город» или «в пути: П-NNNN»; `deal` — `{id, client}` только если сделка есть в `Leads.dealsVisible`, иначе `null` (на экране `Stock.HIDDEN_DEAL = 'сделка скрыта'`, без кнопок «Снять»/«Списать»); `hasDeal` — резерв привязан к существующей сделке. Рядом `dealRef` (:299) и `docView` (:320). Потребители: карточка товара и журнал (`53-stock.js`), «Ждут этот товар» в карточке поставки (`54-ships.js`), превью приёмки (`55-receiving.js:96,105`), текст уведомления о резерве (`Deals.notifyReserve` через `Notify.pushFor`, `42-deals.js:338`).
- **Провал сделки снимает резервы** (`80cbc6f`; `42-deals.js:240-256`): `Deals.lose` берёт `reservesOf(st,d)` (:342), пишет в ленту «Провалена» с `data.released`, для каждого резерва зовёт `drop` (:423-426: `noteRelease` — запись в ленту + уведомление — и `Stock.unreserve`), ставит `d.lostReleased=число`; право `reserve` не нужно. `reopen` (:262-272) резервы не возвращает, пишет `RELEASED_NOTE` (:259) и убирает `lostReleased`. Вид: `FORMS['deal-lose']` `56-deals.js:448` говорит «Снято резервов: N».
- **`Leads.fresh`** (`35-leads.js:250-256`, `80cbc6f`): новые лиды человека — открытые, на первом этапе воронки, которые ведёт он (или нераспределённые — тому, кто раздаёт, `leadsAssign`); берутся из `visible`. Счётчик у «Лидов» (`60-leads.js:321` `badge:()=>Leads.fresh(S,S.me).length`) и плитка главного экрана (`51-home.js:28`) считают только необработанные лиды, дела не входят. Рядом решение по «лид ждёт»: `Leads.waitRecipients` (:159-162) — РОП, а без РОП — менеджеры типа лида; директор получает всегда (`Notify.RECIPIENTS.leadWait`, `37-notify.js:23`) и может выключить вид.
- **`ref` у уведомлений и `A['note-open']`** (`80cbc6f`): описано в разделе 6 — поле `ref`, `Notify.REF_KINDS`/`cleanRef` (`37-notify.js:74-82`), реестр `REFS`/`regRef`/`refState`/`openRef` (`50-shell.js:215-237`), `A['note-open']` (:440-445), 8 регистраций по разделам, `noteRow` с `data-act="note-open"` (`20-model.js:210-217`), демо-уведомления проставлены заново (подъём `REV` 14).
- **Права кладовщика по умолчанию и `REV` 15** (`81f2a1c`): `warehouse` = `stock, receive, dispatch, clients, dealsAll` (`31-perms.js:40-41`, слова директора 2026-11-01 «Отметь сам по умолчанию»); `REV=15` (`30-store.js:21-22`) — прежнее накликанное в браузере сбрасывается к демо. Следствие: кладовщик видит все сделки и клиентов, а экран после приёмки скрывает клиента через `Stock.dealRef` (`55-receiving.js:166-177`, `80cbc6f`).
- **Модуль `Attach` (44) и вид (71), отправки на нём, `Store.dump` при нехватке места** (`365bc8b`): `44-attach.js` (раздел 7), `71-attach.js` (блок «Файлы» в карточках задачи и поставки, поле в формах), `Dispatch` переведён на `Attach.clean/tooBig` (`39-dispatch.js:216,226`), общие помощники (`attReadFiles`, `attSize`) использует и `69-dispatch.js`; `Store.FILE_MAX`/`fileTooBig` и обобщённая `heavy`/`drop` в `30-store.js:50-131` выкидывают файлы `dispatches`, `tasks`, `shipments` наряду с фото приёмки; `REV` не поднят (старые сохранения читаются как есть); тест `tests/attach.test.js` (9).
