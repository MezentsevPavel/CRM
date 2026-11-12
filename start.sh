#!/usr/bin/env bash
# Запуск CRM. Если директор нажал «Обновить» в Настройках, сервер ставит новую версию и выходит с кодом 75 — тогда он запускается снова.
cd "$(dirname "$0")" || exit 1
export CRM_SUPERVISED=1
while true; do
  node server/main.js
  [ $? -eq 75 ] || break
  echo "Обновление установлено, запускаю CRM заново..."
done
