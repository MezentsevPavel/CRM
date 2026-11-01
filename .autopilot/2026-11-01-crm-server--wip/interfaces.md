# Границы и правила проекта

Читается каждым исполнителем первым. Код прототипа описан в `notes.md` (имена, строки, числа); спецификация — `spec.md`; устройство прототипа — `docs/architecture.md`; слова — `CONTEXT.md`.

## Правила проекта (от пользователя, не обсуждаются)

1. Всё по-русски: тексты интерфейса, комментарии в коде, сообщения об ошибках. Идентификаторы, ключи данных и пути API — английские.
2. **Факты пользователя не выдумываются.** Нет данных — на экране «нет данных: <что>», не 0, не прочерк, не правдоподобное число. Домен, IP, люди, пароли — не придумываются.
3. **Величина живёт в одном месте и берётся вызовом.** Экран, сервер и тест считают одной функцией ядра; вторую копию формулы не заводить.
4. **Зависимости не ставить.** Только Node 24 и его встроенные модули (`node:http`, `node:sqlite`, `node:crypto`, `node:vm`, `node:fs`, `node:path`, `node:os`, `node:test`). `package.json` не появляется.
5. Не трогать то, о чём таск не просит. Чужой файл правится только там, где таск это называет.
6. Секреты не пишутся никуда: ни паролей, ни хешей в состоянии `S`, в логах, в тестах (тестовые пароли — сгенерированные в самом тесте).
7. Подводные камни из `AGENTS.md` действуют: `crm-wind-solar.html` — результат сборки, после правки `src/` или `assets/` — `node tools/build.js`; `src/js` склеиваются в одну функцию по имени (повтор `const` верхнего уровня роняет страницу; код верхнего уровня видит только файлы с меньшим номером); в `90-boot.js` логики нет; `10-catalog-data.js`, `11-stock-data.js` целиком не читать; кириллицу не править через PowerShell `Get-Content`/`Set-Content`.
8. Демо-прототип (страница без серверной метки) ведёт себя как до сборки: 417 тестов прототипа остаются зелёными без ослабления. Тест, который ломается из-за правки, чинится так, чтобы проверять то же самое.
9. Проверка перед сдачей таска: `node tools/build.js && node --test tests/`.

## Стек и команды

- Node 24.19 (проверено: `node:sqlite` работает без флага). Python и прочее проекту не нужны. Linux, WSL и Docker на этой машине нет — `deploy/*.sh` проверяется только `bash -n` (Git Bash есть).
- Сборка: `node tools/build.js`. Все тесты: `node --test tests/` (около 60 с, растёт). Один файл: `node --test tests/<файл>.test.js`.
- Демо-страница для своих проверок: `node tools/serve.js 5179`. Сервер для своих проверок: `CRM_PORT=5180 CRM_DATA=<временная папка> node server/main.js` (порт 5178 — показ пользователю, не занимать).
- Папка данных сервера `data/` в git не попадает (`.gitignore`).
- **Проверка перед сдачей таска — одна команда:** `node tools/build.js && node --test tests/`.

## Договорились — не пересматривать

Из прошлой сборки (дословно из `carried.md`):

- Прототип кликабельный: почта, Битрикс, Телеграм и МАКС показаны как настоящие, но наружу ничего не уходит (бриф, раунд 1).
- Каталог — «Пока отдельная копия для CRM, потом надо будет вообще переделать» (раунд 1).
- Главный инженер и инженер — «Права одинаковые» (R30).
- Лиды распределяются автоматически по типу. Нераспределённые раздаёт «не директор, а РОП» (G04).
- Роли директор создаёт сам галочками (раунд 4).
- Склад меняют только списание при продаже и перемещение между складами (G05).
- При перемещении товар уходит со склада в момент «В пути» — «говорю».
- Автор заявки на отправку получает уведомления обо всех её этапах (G03).
- Остатки — снимок листа «Остатки» на 31.10.2026. Имена клиентов из колонки «Резерв» не переносятся. **В рабочей (серверной) базе заменено словом пользователя 2026-11-01**: резервы из «Резерва» переносятся — количество резервом, текст ячейки с именем клиента примечанием, без сделки. В демо — как было.
- Резервы проваленной сделки снимаются — «Да, снимать» (2026-11-01).
- «Вернуть в работу» у проваленной сделки — «оставь» (2026-11-01).
- Менеджерам и РОП право ставить задачи другим отделам — «давать» (2026-11-01).
- «Лид ждёт» без РОП получают «менеджеры. Но абсолютно всё может видеть директор» (2026-11-01).
- Счётчик у «Лидов» — «счётчик на необработанные лиды» (2026-11-01).
- Уведомления — «надо сделать уведомления кликабельными» (2026-11-01).
- Стрелки прокрутки досок — «в браузере работает, проверил» (2026-11-01).
- Кладовщику по умолчанию — клиенты и сделки всех типов: «Отметь сам по умолчанию» (2026-11-01).
- Файлы — «Прикрепить надо добавить во все возможные поля ввода или просто добавить рядом поле под прикрепление» (выбрано второе, 2026-11-01).

Из этой сборки (раунд 1, «ок»):

- Уведомления — живые, пока вкладка CRM открыта (звук, всплывающее окно); при закрытом браузере — нет.
- В рабочей версии почты, Битрикса, Telegram и MAX не видно; демо одним файлом остаётся для показа.
- Копии — на том же сервере, 30 последних; копия вне сервера отложена.
- Клиенты — CSV из Битрикса, остатки — CSV листа «Остатки»; загружает директор в CRM, файлы не проходят через сборку и git.

## Границы, решённые в спецификации

### Режим страницы

- `const SERVER` в `src/js/00-util.js`: `typeof CRM_SERVER !== 'undefined' && !!CRM_SERVER`. Сервер вставляет `<script>window.CRM_SERVER=1</script>` перед основным скриптом отдаваемой страницы (место — метка `<!--CRM-SERVER-->` в `src/page.html`). Тесты включают режим через `load({ globals: { CRM_SERVER: 1, … } })`.
- Всё серверное в видах — под `if (SERVER)`; демо-ветка не меняет поведения.
- В `SERVER`: `NAV` прячет `mail`, `messages`, `sims`; `SETTINGS_TABS` прячет `mail`, `data`; в «Лиды и сделки» нет имитаций Битрикса и перечня `LEAD_BITRIX`; нет «Кто я» (`#role`), полосы «Прототип» и «Сбросить», кнопки `view-as`; авто-сообщения клиентам (`S.msgs.push` в `shipMark`, `receiveShip`) не создаются; `Acts.notify`/`Leads.notifyWaiting` в `render()` и `actsTick` не зовутся.

### Ядро — новые модули (без DOM, `st` первым аргументом, время `now` аргументом)

**`src/js/45-sync.js` — `Docs` и `Ids`**

- `Docs.KEYS` — классификация ключей верхнего уровня `S`: `ARRAY` (массивы записей с `id`: `products`, `moves`, `reserves`, `shipments`, `shipRules`, `deals`, `leads`, `clients`, `feed`, `acts`, `tasks`, `msgs`, `notes`, `dispatches`, `pipelines`, `depts`, `entities`, `cities`, `roles`, `people`, `rules`, `lostReasons` — исполнитель сверяет с кодом), `MAP` (`stock`, `aside` — по ключу товара), `WHOLE` (остальные общие ключи целиком: `mail`, `leadSource`, `leadWaitMin`, `tpl`, `address`, `prefs`, `stockSheet`…), `LOCAL` (никогда не уходят на сервер: `me`, `view`, `ui`, `rcv`, `v`, а у `prefs` — поля `theme` и `ship`).
- `Docs.split(st) → { 'key\u0001id': value }` — документы общего состояния (без `LOCAL`; товары снимка каталога — как в `Catalog.pack`); `Docs.join(docs, into?) → st`.
- `Docs.diff(baseDocs, curDocs) → [{ key, id, base, data } | { key, id, base, deleted: true }]` — `base` = прежнее значение или `null` для новой записи.
- `Docs.merge(base, mine, theirs) → { ok: true, value } | { ok: false, path }` — трёхстороннее слияние: объекты — по полям; массивы объектов с `id` — по `id` (добавленные, удалённые, изменённые); прочее — если изменили оба и по-разному, конфликт.
- `Ids.use(fn | null)` — поставщик номеров; `Ids.next(prefix, fallback)` — если поставщик есть, его номер, иначе `fallback()`. Через `Ids.next` идут `Store.freeId`, `Leads.nextId`, `Dispatch.nextNumber` и номер поставки `П-` (из вида — в функцию). Демо: поставщика нет, номера как были.

**`src/js/46-visible.js` — `Visible`** (чтение)

- `Visible.of(st, personId) → копия состояния для человека` (глубокая, исходник не меняется). Сделки — `Leads.dealsVisible`; лиды — `Leads.visible`; клиенты — `Visible.client`; задачи — `Visible.task`; лента `feed` и дела `acts` — по видимости родителя (`Feed.canSee` или равное); резервы — у невидимой сделки `dealId: 'hidden'` (и `Stock.reserveView` показывает «сделка скрыта»); уведомления — где человек в `to`, с правом `firm` — все; без права `prices` — вырезаны цены (`products[].price` из правок, `deals[].amount`, `deals[].items[].price` — исполнитель находит все места `can('prices')`); `mail`, `msgs` — пустые; `prefs` — только `notify[personId]`, `sound[personId]`; поставки — с правом `stock`, `logistics` или `receive`.
- `Visible.client(st, client, personId)`, `Visible.task(st, task, personId)` — перенос `clientVisible` (`70-clients.js:20`) и `taskVisible` (`20-model.js:199`); виды зовут их.
- `Visible.canSee(st, personId, key, id) → bool` — для скачивания файлов и уведомлений.

**`src/js/47-guard.js` — `Guard`** (запись)

- `Guard.check(st, personId, changes, now) → null | { key, id, text }` — `st` — состояние сервера до пачки, `changes` — пачка после слияния. `text` — «Нет прав: <что>» по-русски.
- Правила (`Guard.RULES[key]`), по `Perms.can` и видимости:

| Ключ | Кто может менять |
|---|---|
| `products` (и правки каталога) | `catalog` |
| `stock`, `aside` | никто напрямую: изменение должно сойтись с суммой новых записей `moves` той же пачки |
| `moves` | только добавление; вид движения — по праву, с которым этот вид создаётся в интерфейсе сейчас (приход — `receive`, продажа — `sell`, перемещение — `logistics` или `dispatch`, бой — `stock`); «Ввод остатков» — `admin` |
| `reserves` | `reserve`; у резерва со сделкой — сделка видна и `dealsEdit`; снять резервы своей видимой сделки при провале — `dealsEdit`; `src` поставки → `'stock'` при приёмке — `receive` |
| `shipments` | `logistics`; приёмка (`received`, `got`, `entityId`, `cityId`, история, этап) — `receive` |
| `deals` | `dealsEdit` и сделка видна до и после |
| `leads` | `leads` и лид виден до и после; смена ведущего — `Leads.transfer`/`take` по их правилам |
| `clients` | `clients` **и** `dealsEdit` (G01), клиент виден |
| `feed`, `acts` | новая запись — кто может комментировать родителя (`Feed.canComment` с G01: у сделки — `dealsEdit`) или в той же пачке разрешённо меняет родителя; старые записи не меняются (кроме отметки «сделано» у дела — ответственный или автор) |
| `tasks` | новая — любой (в чужой отдел — `tasksAssign` или как в форме сейчас); правка — автор, исполнитель, член отдела-исполнителя, `tasksAll` |
| `dispatches` | новая — любой; правка — автор на первом этапе или `dispatch`; комментарий — любой |
| `notes` | новая — любой (адресаты — существующие люди); правка — только добавить себя в `read` |
| `pipelines`, `depts`, `entities`, `cities`, `lostReasons`, `shipRules`, `leadSource`, `leadWaitMin` | `settings` |
| `roles`, `people` | `admin` |
| `prefs` | только свои `notify[personId]`, `sound[personId]` |
| `mail`, `msgs`, `tpl`, `address`, `rules`, `stockSheet`, неизвестный ключ | только `admin` |

**`src/js/48-import.js` — `Import`**

- `Import.decode(bytes: Uint8Array) → text` (UTF-8, иначе Windows-1251; BOM снимается); `Import.parseCsv(text) → string[][]` (разделитель `;`/`,`/таб — сам, кавычки, переводы строк в кавычках).
- `Import.stockRows(table) → { rows: [{ name, cat, ip, npp, vs, custody, transit, damaged, reserve }], problems: [текст] }` — та же форма строк, что `STOCK_SNAPSHOT.rows`, плюс `reserve` (текст ячейки).
- `Import.parseReserve(text) → { items: [{ qty, note }], rest: текст|null }`.
- `Import.applyStock(st, rows, by, now) → { products, matched, cells, reserves, unparsed }` — заменяет `stockSheet`, остатки, `aside`, резервы прошлого переноса (`imported: true`); пишет движения «Ввод остатков»; товары без пары в каталоге — id по нормализованному названию (`Catalog.norm`).
- `Import.clientRows(table) → { rows: [{ kind, name, phones, email, inn, address, org, managerName, bitrixId }], unknown: [колонки], skipped }` (колонки — `spec.md`, «Колонки переноса»; `org` и `bitrixId` — новые необязательные поля клиента, `Clients.update` их понимает, карточка клиента показывает «Компания: …»); `Import.applyClients(st, rows, by, now) → { created, merged, skipped }` — слияние через `Clients.find` (ИНН > телефон > почта), недостающее дописывается.
- В `SERVER` `Catalog.unpack` берёт строки из `st.stockSheet`, а не `STOCK_SNAPSHOT`; без переноса — товары каталога без остатка («нет данных: остаток»).

### Виды — новые файлы (номер = файл CSS)

- `src/js/72-server.js` — серверный режим в браузере: `serverBoot()` (зовётся из `90-boot.js` вместо `S=startState(); render();`, когда `SERVER`), экран входа, смена пароля, «Выйти», цикл синхронизации (после `save()` — `Docs.diff` → `POST /api/changes`; `EventSource('/api/events')` → `GET /api/sync`), плашка «Нет связи», тосты конфликта и отказа, `beforeunload`, окно входа при 401, ночная перезагрузка, системные уведомления (`Notification`), поставщик номеров `Ids.use`, загрузка файлов на сервер. `save()` в `SERVER` пишет локальное (`view`, `prefs.theme`, `prefs.ship`, `rcv`) в `localStorage` и зовёт синхронизацию.
- `src/js/73-transfer.js` — вкладка «Настройки → Перенос» (`admin`, только `SERVER`).
- `src/js/74-backups.js` — вкладка «Настройки → Копии» (`admin`, только `SERVER`).
- «Сотрудники» (`58-team.js`) в `SERVER`: колонка «Логин», «Выдать пароль», «Отключить», «Завершить сеансы» — через API.
- Файлы (`44-attach.js`, `71-attach.js`, приёмка `55-receiving.js`): запись файла в `SERVER` — `{ id, name, type, size, url, by, at }`, `data: null`; ссылка скачивания — `url`; фото приёмки — строки `url` вместо data-URL.

### Сервер — `server/`

- `server/main.js` — запуск: `node server/main.js` (переменные `CRM_PORT`=3000, `CRM_HOST`=127.0.0.1, `CRM_DATA`=`./data`, `CRM_SECURE_COOKIE`=0/1, `CRM_FILE_MAX_MB`=20, `CRM_BACKUP_HOUR`=3, `CRM_BACKUP_KEEP`=30, `TZ`).
- `server/app.js` — `createApp({ dataDir, port, host, secureCookie, now? }) → Promise<{ url, close(), admin }>`; `admin` — `createDirector(login, password)`, `resetPassword(personId) → password`, `restore(file)` — шов тестов сервера.
- `server/runtime.js` — грузит `src/js/*.js` (без `90-boot.js`) в `node:vm`; приём общий с `tests/load.js` (вынести в `tools/vm-load.js`, `tests/load.js` им пользуется — его API не меняется).
- `server/db.js` — `node:sqlite`; таблицы: `docs(key, id, data, ver, seq)`, `meta(k, v)` (`seq`, `rev`, счётчики номеров), `users(personId, login, hash, salt, mustChange, disabled)`, `sessions(tokenHash, personId, tag, createdAt, lastSeen, expiresAt, foreign)`, `files(id, name, type, size, by, at, deletedAt)`, `file_refs(fileId, key, docId)`, `log(seq, at, personId, key, docId, op)`, `attempts(login, ip, at)`.
- `server/auth.js`, `server/sync.js`, `server/files.js`, `server/backup.js`, `server/jobs.js` — по названию; `server/admin.js` — командная строка: `create-director`, `reset-password <login>`, `restore <файл>`, `backups`.
- Новая база = `seedBase()` из `20-model.js`: структура без демо — роли (все 9, с доборами прав РОП и водителя), воронки, отделы, юрлица, города, причины отказа, настройки, каталог; люди — пусто (директора заводит `create-director`).
- Ревизия формы записей в серверной базе данные не стирает: `meta.rev` < `Store.REV` → миграции из `server/migrate.js` (пока пусто) или отказ запуска с текстом.

### HTTP API (всё JSON, кроме файлов и SSE; запись — с заголовком `X-CRM: 1`, иначе 403)

| Метод и путь | Ответ |
|---|---|
| `GET /` | страница с меткой `CRM_SERVER` |
| `GET /api/me` | `{ person: { id, name, role }, mustChange, tag }` или 401 |
| `POST /api/login` `{ login, password, foreign }` | 200 + cookie `crm_sid`; 401 `{ error }`; 429 `{ error, retryMin }` |
| `POST /api/logout` · `POST /api/password` `{ old, password }` | 200 · 200 / 400 `{ error }` |
| `GET /api/state` | `{ seq, state: Visible.of(...), ids: { 'Д-': [..], … } }` |
| `GET /api/sync?since=N` | `{ seq, docs: [{ key, id, data }], gone: [{ key, id }] }` |
| `POST /api/changes` `{ changes }` | 200 `{ seq, docs }`; 409 `{ error, key, id, by, docs }`; 403 `{ error, key, id }` |
| `POST /api/ids` `{ prefix, n }` | `{ ids }` |
| `GET /api/events` | SSE: `seq`, `reload`, `bye` |
| `POST /api/files` (тело — файл, `X-File-Name` в `encodeURIComponent`) · `GET /api/files/:id` | `{ id, name, type, size, url }` / 413 · файл / 403 / 404 |
| `GET /api/users` · `POST /api/users/:personId/{login,password,disable,logout}` | только `admin` |
| `POST /api/import/stock` `{ rows }` · `POST /api/import/clients` `{ rows }` | только `admin`; итог `Import.apply*` |
| `GET /api/backups` · `POST /api/backups` · `GET /api/backups/:name` · `POST /api/backups/:name/restore` | только `admin` |

### Установка — `deploy/`

- `deploy/install.sh <домен>` (Ubuntu 24.04, от root): Node 24 (официальный архив nodejs.org), Caddy (официальный репозиторий), пользователь `crm`, код в `/opt/crm`, данные в `/var/lib/crm`, служба `crm.service` (`TZ=Asia/Irkutsk`, `CRM_SECURE_COOKIE=1`), `Caddyfile` (домен → `127.0.0.1:3000`), брандмауэр 22/80/443, сборка страницы, `create-director` (логин и пароль вводит директор).
- `deploy/update.sh` — новый код, сборка, перезапуск; `data` не трогается.
- `docs/server-install.md` — инструкция по-русски для не программиста.
- `tools/pack.js` не нужен: архив — `tar` (есть в Windows).

### Швы тестов

- Ядро (`Docs`, `Visible`, `Guard`, `Import`, баги G01–G05) — `load()` из `tests/load.js`.
- Сервер — `createApp({ dataDir: временная папка, port: 0 })` и `fetch` из Node 24; тестовые пароли генерируются в тесте.
- Браузер в серверном режиме — `load({ globals: { CRM_SERVER: 1, fetch, EventSource } })` с поддельными `fetch`/`EventSource`.
- Новые тесты — `tests/<тема>.test.js` (подхватываются сами).

## Что построили завершённые таски

<!-- дописывает оркестратор после каждого таска: имена, которые реально появились -->
