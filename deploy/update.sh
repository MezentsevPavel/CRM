#!/usr/bin/env bash
# Обновление CRM wind-solar до новой версии. Запуск от root, из распакованной НОВОЙ версии проекта:
#     bash deploy/update.sh
# Новый код собирается в стороне; старая версия подменяется, только если сборка прошла. Служба перезапускается;
# если новая версия не запустилась, возвращается прежняя. Папка данных /var/lib/crm (база, файлы, копии) не трогается.
# Этот же скрипт вызывает deploy/install.sh при первой установке.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR=/opt/crm
NEW_DIR=/opt/crm.new
PREV_DIR=/opt/crm.prev
NODE_BIN=/usr/local/bin/node
UNIT=/etc/systemd/system/crm.service
PORT=3000

say() { printf '\n== %s\n' "$*"; }
die() { printf '\nОШИБКА: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Запускайте от root."
[ -f "$UNIT" ] || die "Служба crm ещё не установлена. Сначала: bash deploy/install.sh <домен>."
[ -x "$NODE_BIN" ] || die "Не найден Node ($NODE_BIN). Сначала: bash deploy/install.sh <домен>."
[ -f "$SRC/server/main.js" ] && [ -f "$SRC/tools/build.js" ] || die "Рядом со скриптом нет файлов проекта. Запускайте deploy/update.sh из распакованной новой версии."
[ "$SRC" != "$APP_DIR" ] || die "Запускать нужно из распакованного архива новой версии, а не из $APP_DIR."

say "Собираю новую версию в стороне"
rm -rf "$NEW_DIR"
mkdir "$NEW_DIR"
for d in server src assets tools deploy; do
  [ -d "$SRC/$d" ] || die "В новой версии нет папки $d."
  cp -a "$SRC/$d" "$NEW_DIR/$d"
done
( cd "$NEW_DIR" && "$NODE_BIN" tools/build.js ) || { rm -rf "$NEW_DIR"; die "Сборка страницы не удалась. Старая версия не тронута."; }
chmod -R go+rX "$NEW_DIR"

say "Подменяю версию"
rm -rf "$PREV_DIR"
[ -d "$APP_DIR" ] && mv "$APP_DIR" "$PREV_DIR"
mv "$NEW_DIR" "$APP_DIR"

say "Перезапускаю службу"
systemctl restart crm
ok=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  sleep 1
  if systemctl is-active --quiet crm && curl -fsS -o /dev/null "http://127.0.0.1:$PORT/"; then ok=1; break; fi
done
if [ "$ok" != "1" ]; then
  printf '\nНовая версия не запустилась. Последние строки журнала:\n' >&2
  journalctl -u crm -n 15 --no-pager >&2 || true
  if [ -d "$PREV_DIR" ]; then
    rm -rf "$APP_DIR"
    mv "$PREV_DIR" "$APP_DIR"
    systemctl restart crm
    die "Вернул прежнюю версию, данные не тронуты. Пришлите строки журнала выше тому, кто делал CRM."
  fi
  die "Служба не запустилась (первая установка). Журнал: journalctl -u crm -n 50"
fi

echo "Готово: CRM запущена, данные ($(basename /var/lib/crm)) не тронуты."
[ -d "$PREV_DIR" ] && echo "Прежняя версия лежит в $PREV_DIR на случай отката (можно удалить: rm -rf $PREV_DIR)."
exit 0
