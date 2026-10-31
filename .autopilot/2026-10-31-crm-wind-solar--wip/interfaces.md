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
| `Catalog` (38) | каталог и снимок остатков | `Catalog.norm(name)`; `Catalog.build(CATALOG, STOCK_SNAPSHOT) → {products, stock, aside, unmatched}` — склейка снимка с каталогом только при точном совпадении нормализованных названий; `Catalog.query(st, {q, cat, brand, avail, inCatalog})` |

### Состояние `S` (схема v3)

```
v:3, me:<personId>, view, ui:{…не сохраняется…}, prefs:{theme, sound:{on, kind}, notify:{<personId>:{<kind>:bool}}, ship:{view, cols, density, group, size}}
roles:[{id, name, builtin, perms:{<perm>:bool}}]   depts:[{id, name}]   people:[{id, name, role, dept, demo}]
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
```

Воронки по умолчанию: поставки — Заказано → Отгружено поставщиком → В пути до границы → Таможня → Перевалка в Чите → В пути до склада → Прибыло в город (`arrived`) → На складе (`final`); сделки B2B и сделки B2C — Заявка → Расчёт → КП → Договор → Оплата → Поставка → Монтаж → Сдана (`final`); лиды — Новый → Связались → Квалифицирован → Сделка создана (`final`) → Отказ (`final`); доска задач «Общие» — Новые → В работе → На проверке → Готово (`final`). Точки схемы `Ships.NODES`: `cn` Китай «основной город-поставщик», `chita` Чита «основной город-приёмщик · таможня и перевалка», `irk` Иркутск «основной город-получатель», `msk` Москва и `krd` Краснодар «город-получатель». Получатели `Notify.RECIPIENTS.ship` — все сотрудники.

Этап хранится **по id этапа**, не по номеру: переименование, вставка и удаление этапа не ломают данные (слабое место 2 из `notes.md`). «Сделано/закрыто» — флаг `final` у этапа. «Прибыло, ждёт приёмки» — флаг `arrived`.

### Реестры — как раздел подключается, не трогая чужих файлов

Таск 01 объявляет в `20-model.js` и `50-ui-shell.js` пустые реестры. Каждый следующий таск регистрирует свой раздел **в своём файле**, чужие файлы не правит:

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
