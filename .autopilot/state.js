window.STATE =
{
  "version": 2,
  "slug": "crm-server",
  "dir": "2026-11-01-crm-server--wip",
  "title": "Серверная CRM wind-solar с общей базой",
  "mode": "semi",
  "depth": "normal",
  "tier": "T2",
  "briefFile": "2026-11-01-brief.md",
  "memoryFile": "AGENTS.md",
  "memoryOwner": "autopilot",
  "skillDir": "C:/Users/Pavel/.agents/skills/autopilot",
  "baseCommit": null,
  "startedAt": "2026-11-01T22:19:48+08:00",
  "updatedAt": "2026-11-01T23:13:38+08:00",
  "finishedAt": null,
  "stages": [
    {
      "id": "preflight",
      "status": "done",
      "startedAt": "2026-11-01T22:19:48+08:00",
      "finishedAt": "2026-11-01T22:20:15+08:00"
    },
    {
      "id": "manifest",
      "status": "done",
      "startedAt": "2026-11-01T22:20:15+08:00",
      "finishedAt": "2026-11-01T22:21:00+08:00"
    },
    {
      "id": "briefing",
      "status": "done",
      "startedAt": "2026-11-01T22:21:00+08:00",
      "finishedAt": "2026-11-01T22:44:04+08:00"
    },
    {
      "id": "spec",
      "status": "done",
      "startedAt": "2026-11-01T22:44:04+08:00",
      "finishedAt": "2026-11-01T23:10:51+08:00"
    },
    {
      "id": "plan",
      "status": "active",
      "startedAt": "2026-11-01T23:10:51+08:00"
    },
    {
      "id": "build",
      "status": "pending"
    },
    {
      "id": "review",
      "status": "pending"
    },
    {
      "id": "final",
      "status": "pending"
    }
  ],
  "requirements": {
    "total": 30,
    "done": 0,
    "inTicket": 30,
    "inSpec": 0,
    "placeholder": 0,
    "deferred": 0,
    "dropped": 0
  },
  "tickets": [
    {
      "id": "01",
      "title": "Ядро общей базы: документы, номера, видимость, права записи",
      "requirements": [
        "R01",
        "R02",
        "R03",
        "R05",
        "R18i",
        "R20i",
        "G01",
        "R16"
      ],
      "blockedBy": [],
      "wave": 1,
      "zone": [
        "src/js/00-util.js",
        "src/js/20-model.js",
        "src/js/30-store.js",
        "src/js/31",
        "44",
        "src/js/45-sync.js",
        "src/js/46-visible.js",
        "src/js/47-guard.js",
        "src/js/41-feed.js",
        "src/js/70-clients.js",
        "Visible.*",
        "src/page.html",
        "<!--CRM-SERVER-->",
        "tests/sync-core.test.js",
        "tests/visible.test.js",
        "tests/guard.test.js"
      ],
      "review": "да — фундамент",
      "model": "сильная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "02",
      "title": "Сервер: база, вход, общая синхронизация, файлы, уведомления",
      "requirements": [
        "R01",
        "R03",
        "R04",
        "R05",
        "R06",
        "R07",
        "R17i",
        "R20i",
        "R22i",
        "R16"
      ],
      "blockedBy": [
        "01"
      ],
      "wave": 2,
      "zone": [
        "server/",
        "server/backup.js",
        "tools/vm-load.js",
        "tests/load.js",
        "tools/vm-load.js",
        "tests/server-*.test.js"
      ],
      "review": "да — вход, пароли, сеансы",
      "model": "сильная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "03",
      "title": "Браузер в серверном режиме: вход, живая работа вместе, файлы на сервере",
      "requirements": [
        "R01",
        "R02",
        "R03",
        "R04",
        "R06",
        "R07",
        "R15",
        "R17i",
        "R20i",
        "R22i",
        "R16"
      ],
      "blockedBy": [
        "02"
      ],
      "wave": 3,
      "zone": [
        "src/js/72-server.js",
        "src/css/72-server.css",
        "src/js/90-boot.js",
        "src/js/50-shell.js",
        "src/js/44-attach.js",
        "src/js/71-attach.js",
        "src/js/55-receiving.js",
        "src/js/54-ships.js",
        "src/js/58-team.js",
        "src/js/59-settings.js",
        "src/js/60-leads.js",
        "src/js/67-settings-leads.js",
        "src/js/63-settings-notify.js",
        "tests/client-server.test.js"
      ],
      "review": "нет",
      "model": "сильная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "04",
      "title": "Перенос остатков и клиентов, ежедневные копии базы",
      "requirements": [
        "R08",
        "R13",
        "R14",
        "R19i",
        "R23i",
        "R24i",
        "R16"
      ],
      "blockedBy": [
        "03"
      ],
      "wave": 4,
      "zone": [
        "src/js/48-import.js",
        "src/js/73-transfer.js",
        "src/js/74-backups.js",
        "src/css/73-transfer.css",
        "src/css/74-backups.css",
        "src/js/38-catalog.js",
        "stockSheet",
        "src/js/33-stock.js",
        "src/js/53-stock.js",
        "src/js/40-clients.js",
        "src/js/70-clients.js",
        "org",
        "bitrixId",
        "server/backup.js",
        "server/",
        "tests/import.test.js",
        "tests/backup.test.js"
      ],
      "review": "нет",
      "model": "обычная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    },
    {
      "id": "05",
      "title": "Шрифты без Google, пять багов прошлой сборки, установка на сервер",
      "requirements": [
        "R09",
        "R10",
        "R11",
        "R12",
        "R21i",
        "R25i",
        "G02",
        "G03",
        "G04",
        "G05",
        "R16"
      ],
      "blockedBy": [
        "02"
      ],
      "wave": 3,
      "zone": [
        "assets/fonts/",
        "src/page.html",
        "src/css/00-tokens.css",
        "tools/build.js",
        "src/js/33-stock.js",
        "src/js/39-dispatch.js",
        "src/js/42-deals.js",
        "src/js/53-stock.js",
        "src/js/56-deals.js",
        "src/js/69-dispatch.js",
        "deploy/",
        "docs/server-install.md",
        "tests/fixes.test.js",
        "tests/foundation.test.js"
      ],
      "review": "нет",
      "model": "обычная",
      "status": "pending",
      "retries": 0,
      "repairs": 0
    }
  ],
  "tests": null,
  "debt": {
    "placeholders": [],
    "assumptions": [
      "Срок резерва по умолчанию — 14 дней (так в двух местах из трёх), G02",
      "Часовой пояс сервера — Asia/Irkutsk (часы этой машины +08:00)"
    ],
    "emptyEnv": []
  },
  "additions": [],
  "coverage": {
    "found": 7,
    "fixed": 7,
    "deferred": 0,
    "items": []
  },
  "concerns": [],
  "blind": null,
  "beats": [
    "2026-11-01T22:19:48+08:00",
    "2026-11-01T22:20:15+08:00",
    "2026-11-01T22:20:59+08:00",
    "2026-11-01T22:21:00+08:00",
    "2026-11-01T22:22:24+08:00",
    "2026-11-01T22:43:40+08:00",
    "2026-11-01T22:44:04+08:00",
    "2026-11-01T23:10:49+08:00",
    "2026-11-01T23:10:50+08:00",
    "2026-11-01T23:10:51+08:00",
    "2026-11-01T23:13:36+08:00",
    "2026-11-01T23:13:37+08:00",
    "2026-11-01T23:13:38+08:00"
  ],
  "rev": 14,
  "waiting": null,
  "waits": [
    {
      "kind": "briefing",
      "from": "2026-11-01T22:22:24+08:00",
      "to": "2026-11-01T22:43:40+08:00"
    }
  ],
  "log": [
    {
      "t": "2026-11-01T22:19:48+08:00",
      "k": "init"
    },
    {
      "t": "2026-11-01T22:20:15+08:00",
      "k": "stage",
      "id": "manifest",
      "act": "start"
    },
    {
      "t": "2026-11-01T22:21:00+08:00",
      "k": "stage",
      "id": "briefing",
      "act": "start"
    },
    {
      "t": "2026-11-01T22:22:24+08:00",
      "k": "ask",
      "kind": "briefing",
      "note": "пять вопросов — сервер и домен, источник клиентов, резервы при переносе, где копии, что взять с прошлой сборки"
    },
    {
      "t": "2026-11-01T22:43:40+08:00",
      "k": "answered",
      "kind": "briefing"
    },
    {
      "t": "2026-11-01T22:44:04+08:00",
      "k": "gate",
      "g": "G1",
      "ok": false,
      "open": 30,
      "total": 30
    },
    {
      "t": "2026-11-01T22:44:04+08:00",
      "k": "stage",
      "id": "spec",
      "act": "start"
    },
    {
      "t": "2026-11-01T23:10:49+08:00",
      "k": "gate",
      "g": "G2",
      "ok": true,
      "found": 7,
      "fixed": 7,
      "deferred": 0
    },
    {
      "t": "2026-11-01T23:10:50+08:00",
      "k": "add",
      "key": "debt.assumptions",
      "n": 2
    },
    {
      "t": "2026-11-01T23:10:51+08:00",
      "k": "stage",
      "id": "plan",
      "act": "start"
    },
    {
      "t": "2026-11-01T23:13:36+08:00",
      "k": "tier",
      "v": "T2"
    },
    {
      "t": "2026-11-01T23:13:37+08:00",
      "k": "tickets",
      "n": 5
    },
    {
      "t": "2026-11-01T23:13:38+08:00",
      "k": "gate",
      "g": "G3",
      "ok": true,
      "problems": 0
    }
  ],
  "reqList": [
    {
      "id": "R01",
      "text": "«Серверная версия CRM wind-solar»",
      "status": "in-ticket"
    },
    {
      "id": "R02",
      "text": "«с общей базой, чтобы фирма в ней работала»",
      "status": "in-ticket"
    },
    {
      "id": "R03",
      "text": "«одна база на всех»",
      "status": "in-ticket"
    },
    {
      "id": "R04",
      "text": "«вход по логину и паролю»",
      "status": "in-ticket"
    },
    {
      "id": "R05",
      "text": "«права проверяет сервер»",
      "status": "in-ticket"
    },
    {
      "id": "R06",
      "text": "«файлы на сервере»",
      "status": "in-ticket"
    },
    {
      "id": "R07",
      "text": "«уведомления между компьютерами»",
      "status": "in-ticket"
    },
    {
      "id": "R08",
      "text": "«ежедневные копии базы»",
      "status": "in-ticket"
    },
    {
      "id": "R09",
      "text": "«https»",
      "status": "in-ticket"
    },
    {
      "id": "R10",
      "text": "«сервер в России (152-ФЗ)»",
      "status": "in-ticket"
    },
    {
      "id": "R11",
      "text": "«сервер … арендую сам»",
      "status": "in-ticket"
    },
    {
      "id": "R12",
      "text": "«домен арендую сам»",
      "status": "in-ticket"
    },
    {
      "id": "R13",
      "text": "«перенос настоящих остатков»",
      "status": "in-ticket"
    },
    {
      "id": "R14",
      "text": "«и клиентов»",
      "status": "in-ticket"
    },
    {
      "id": "R15",
      "text": "«Почта, Битрикс, Telegram и MAX — не в этом этапе»",
      "status": "in-ticket"
    },
    {
      "id": "R16",
      "text": "«Тариф Pro, лимитов мало: экономь — один агент за раз, без долгих ревьюеров»",
      "status": "in-ticket"
    },
    {
      "id": "R17i",
      "text": "(подразумевается) кто и как заводит логины и пароли сотрудников, первый вход директора",
      "status": "in-ticket"
    },
    {
      "id": "R18i",
      "text": "(подразумевается) в рабочей базе нет демо-данных прототипа",
      "status": "in-ticket"
    },
    {
      "id": "R19i",
      "text": "(подразумевается) из ежедневной копии можно восстановить базу",
      "status": "in-ticket"
    },
    {
      "id": "R20i",
      "text": "(подразумевается) два человека правят одну запись одновременно — правка не теряется молча",
      "status": "in-ticket"
    },
    {
      "id": "R21i",
      "text": "(подразумевается) сервер ставится на арендованную машину по инструкции, которую выполнит не программист",
      "status": "in-ticket"
    },
    {
      "id": "R22i",
      "text": "(подразумевается) забытый пароль, выход, чужой компьютер — сессия не висит вечно",
      "status": "in-ticket"
    },
    {
      "id": "R23i",
      "text": "(подразумевается) откуда брать настоящих клиентов: файл-источник и его колонки",
      "status": "in-ticket"
    },
    {
      "id": "R24i",
      "text": "(подразумевается) остатки на день переезда — свежая выгрузка, не снимок 31.10",
      "status": "in-ticket"
    },
    {
      "id": "R25i",
      "text": "(подразумевается) 152-ФЗ: страница не обращается к сервисам за рубежом (сейчас — Google Fonts)",
      "status": "in-ticket"
    },
    {
      "id": "G01",
      "text": "«ок» на: инженер может править клиентов",
      "status": "in-ticket"
    },
    {
      "id": "G02",
      "text": "«ок» на: срок резерва по умолчанию в двух местах (14 и 7 дней)",
      "status": "in-ticket"
    },
    {
      "id": "G03",
      "text": "«ок» на: «Свободно: 0» вместо «нет данных»",
      "status": "in-ticket"
    },
    {
      "id": "G04",
      "text": "«ок» на: журнал склада пишет перемещение как «Отгрузка» и «Приход»",
      "status": "in-ticket"
    },
    {
      "id": "G05",
      "text": "«ок» на: списать можно в отменённой или доставленной заявке",
      "status": "in-ticket"
    }
  ],
  "gates": {
    "G1": {
      "ok": false,
      "at": "2026-11-01T22:44:04+08:00",
      "open": 30,
      "total": 30
    },
    "G2": {
      "ok": true,
      "at": "2026-11-01T23:10:49+08:00",
      "found": 7,
      "fixed": 7,
      "deferred": 0
    },
    "G3": {
      "ok": true,
      "at": "2026-11-01T23:13:38+08:00",
      "problems": 0
    }
  },
  "result": null
}
