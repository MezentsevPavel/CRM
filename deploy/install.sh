#!/usr/bin/env bash
# Установка CRM wind-solar на чистый сервер Ubuntu 24.04. Запуск от root, из распакованной папки проекта:
#     bash deploy/install.sh <домен>
# Ставит Node 24 (официальный архив nodejs.org), Caddy (официальный репозиторий; сам получает https-сертификат),
# заводит пользователя crm, службу crm.service, кладёт код в /opt/crm, данные — в /var/lib/crm, открывает порты 22/80/443,
# собирает страницу и спрашивает логин и пароль директора. Повторный запуск ничего не ломает: готовое пропускается,
# базу и пароль директора не трогает. Обновление версии — deploy/update.sh.
set -euo pipefail

DOMAIN="${1:-}"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR=/opt/crm
DATA_DIR=/var/lib/crm
NODE_BIN=/usr/local/bin/node
UNIT=/etc/systemd/system/crm.service
CADDYFILE=/etc/caddy/Caddyfile
PORT=3000

say() { printf '\n== %s\n' "$*"; }
die() { printf '\nОШИБКА: %s\n' "$*" >&2; exit 1; }

# ——— проверки до того, как что-то тронуто ———
[ "$(id -u)" -eq 0 ] || die "Запускайте от root: войдите на сервер как root (ssh root@<IP-сервера>) и повторите."
[ -n "$DOMAIN" ] || die "Не указан домен. Пример: bash deploy/install.sh crm.example.ru (подставьте свой домен)."
# домен — буквы, цифры, точки и дефисы, хотя бы одна точка; без http:// и без слэшей
printf '%s' "$DOMAIN" | grep -Eq '^([A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$' \
  || die "«$DOMAIN» не похоже на домен. Нужен только адрес, например crm.example.ru — без https:// и без слэшей."
[ -f "$SRC/server/main.js" ] && [ -f "$SRC/tools/build.js" ] && [ -f "$SRC/deploy/update.sh" ] \
  || die "Рядом со скриптом нет файлов проекта (server, tools). Распакуйте архив целиком и запускайте deploy/install.sh из него."
if [ -r /etc/os-release ]; then
  . /etc/os-release
  if [ "${ID:-}" != "ubuntu" ] || [ "${VERSION_ID:-}" != "24.04" ]; then
    printf 'Внимание: скрипт рассчитан на Ubuntu 24.04, а здесь %s %s. Продолжить на свой риск? (да/нет) ' "${ID:-?}" "${VERSION_ID:-?}"
    read -r answer </dev/tty || answer=нет
    [ "$answer" = "да" ] || die "Остановлено."
  fi
fi

export DEBIAN_FRONTEND=noninteractive

# ——— домен должен вести на этот сервер, иначе Caddy не получит сертификат ———
say "Проверяю, что $DOMAIN указывает на этот сервер"
resolved="$(getent ahostsv4 "$DOMAIN" | awk '{print $1; exit}' || true)"
mine="$(ip -4 -o addr show scope global | awk '{sub(/\/.*/, "", $4); print $4}' | tr '\n' ' ')"
if [ -z "$resolved" ]; then
  printf 'Домен %s пока никуда не указывает (A-запись не создана или ещё не разошлась по интернету).\n' "$DOMAIN"
elif ! printf '%s' " $mine" | grep -q " $resolved "; then
  printf 'Домен %s указывает на %s, а адреса этого сервера: %s\n' "$DOMAIN" "$resolved" "$mine"
else
  printf 'Домен указывает на этот сервер (%s). Хорошо.\n' "$resolved"
  resolved_ok=1
fi
if [ "${resolved_ok:-0}" != "1" ]; then
  printf 'Сертификат https не выдастся, пока домен не указывает на сервер. Можно продолжить: Caddy будет повторять попытки сам.\nПродолжить установку? (да/нет) '
  read -r answer </dev/tty || answer=нет
  [ "$answer" = "да" ] || die "Остановлено. Создайте A-запись домена на IP сервера (см. docs/server-install.md) и запустите скрипт снова."
fi

# ——— пакеты ———
say "Ставлю нужные пакеты"
apt-get update -y
apt-get install -y ca-certificates curl gpg xz-utils tar ufw debian-keyring debian-archive-keyring apt-transport-https

# ——— Node 24 из официального архива ———
say "Node 24"
if command -v node >/dev/null 2>&1 && node -v | grep -q '^v24\.'; then
  echo "Node $(node -v) уже стоит — пропускаю."
else
  case "$(uname -m)" in
    x86_64) arch=x64 ;;
    aarch64) arch=arm64 ;;
    *) die "Процессор $(uname -m) не поддержан этим скриптом (нужен x86_64 или aarch64)." ;;
  esac
  base=https://nodejs.org/dist/latest-v24.x
  sums="$(curl -fsSL "$base/SHASUMS256.txt")" || die "Не удалось скачать список версий Node с nodejs.org."
  line="$(printf '%s\n' "$sums" | awk -v suf="linux-$arch.tar.xz" '{n=length($2); if (substr($2, n-length(suf)+1)==suf) {print; exit}}')"
  [ -n "$line" ] || die "В списке версий Node нет архива для linux-$arch."
  want_hash="${line%% *}"
  file="${line##* }"
  tmp="$(mktemp -d)"
  curl -fsSL "$base/$file" -o "$tmp/$file" || die "Не удалось скачать $file с nodejs.org."
  echo "$want_hash  $tmp/$file" | sha256sum -c - || die "Контрольная сумма архива Node не сошлась — архив повреждён, повторите установку."
  ver="${file%.tar.xz}"
  mkdir -p /usr/local/lib/nodejs
  tar -xJf "$tmp/$file" -C /usr/local/lib/nodejs
  ln -sfn "/usr/local/lib/nodejs/$ver/bin/node" "$NODE_BIN"
  rm -rf "$tmp"
  echo "Поставлен Node $("$NODE_BIN" -v)."
fi

# ——— Caddy из официального репозитория ———
say "Caddy"
if command -v caddy >/dev/null 2>&1; then
  echo "Caddy $(caddy version | awk '{print $1}') уже стоит — пропускаю."
else
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' -o /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

# ——— пользователь и папки ———
say "Пользователь crm и папки"
if id crm >/dev/null 2>&1; then
  echo "Пользователь crm уже есть."
else
  useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin crm
fi
mkdir -p "$DATA_DIR"
chown crm:crm "$DATA_DIR"
chmod 750 "$DATA_DIR"

# ——— служба ———
say "Служба crm"
if [ -f "$UNIT" ]; then
  echo "$UNIT уже есть — не трогаю (часовой пояс и порт, если вы их меняли, остаются)."
else
  cat > "$UNIT" <<UNITEOF
[Unit]
Description=CRM wind-solar
After=network.target

[Service]
Type=simple
User=crm
Group=crm
WorkingDirectory=$APP_DIR
# Часовой пояс сервера: по нему идут ночные копии базы (в 03:00) и тексты сроков. Поменять — и systemctl restart crm.
Environment=TZ=Asia/Irkutsk
Environment=CRM_SECURE_COOKIE=1
Environment=CRM_HOST=127.0.0.1
Environment=CRM_PORT=$PORT
Environment=CRM_DATA=$DATA_DIR
ExecStart=$NODE_BIN $APP_DIR/server/main.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
UNITEOF
fi
systemctl daemon-reload
systemctl enable crm >/dev/null

# команда crm-admin: сброс пароля, список копий, восстановление (от имени пользователя crm, с теми же настройками, что у службы)
cat > /usr/local/bin/crm-admin <<ADMINEOF
#!/usr/bin/env bash
# Команды директора: crm-admin create-director | reset-password <логин> | backups | restore <имя копии>
exec runuser -u crm -- env CRM_DATA=$DATA_DIR TZ="\$(sed -n 's/^Environment=TZ=//p' $UNIT | head -1)" $NODE_BIN $APP_DIR/server/admin.js "\$@"
ADMINEOF
chmod 755 /usr/local/bin/crm-admin

# ——— код, сборка страницы, запуск ———
say "Код, сборка страницы и запуск"
bash "$SRC/deploy/update.sh"

# ——— Caddy: домен → CRM, http → https ———
say "Caddy: $DOMAIN → https"
new_caddy="$(mktemp)"
cat > "$new_caddy" <<CADDYEOF
# CRM wind-solar. Файл пишет deploy/install.sh. Caddy сам получает и продлевает сертификат и переводит http на https.
$DOMAIN {
	# сжатие страницы; поток уведомлений (/api/events) не сжимается и не копится в буфере
	@packable not path /api/events
	encode @packable zstd gzip
	reverse_proxy 127.0.0.1:$PORT {
		flush_interval -1
	}
}
CADDYEOF
if [ -f "$CADDYFILE" ] && ! cmp -s "$new_caddy" "$CADDYFILE"; then
  cp "$CADDYFILE" "$CADDYFILE.bak-$(date +%Y%m%d-%H%M%S)"
  echo "Прежний Caddyfile сохранён рядом с суффиксом .bak-…"
fi
install -m 644 "$new_caddy" "$CADDYFILE"
rm -f "$new_caddy"
caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null || die "Caddy не принял настройку домена."
systemctl enable caddy >/dev/null
systemctl restart caddy

# ——— брандмауэр: ssh, http, https ———
say "Брандмауэр: 22, 80, 443"
ssh_port="$(sshd -T 2>/dev/null | awk '/^port /{print $2; exit}')"
ufw allow "${ssh_port:-22}/tcp" >/dev/null
ufw allow 22/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
echo "Открыты порты: ssh (${ssh_port:-22}), 80, 443. Остальное закрыто."

# ——— директор ———
say "Директор"
marker="$DATA_DIR/.director-created"
if [ -f "$marker" ]; then
  echo "Директор уже заведён — пропускаю. Новый пароль сотруднику: crm-admin reset-password <логин>."
else
  echo "Сейчас нужно придумать логин и пароль директора (пароль при вводе не виден, не короче 8 символов)."
  tries=0
  until crm-admin create-director; do
    tries=$((tries + 1))
    [ "$tries" -lt 3 ] || die "Директор не заведён. Запустите: crm-admin create-director"
    echo "Попробуйте ещё раз."
  done
  : > "$marker"
  chown crm:crm "$marker"
fi

say "Готово"
echo "CRM открывается по адресу: https://$DOMAIN"
echo "Если страница ещё не открывается — подождите минуту-две: Caddy получает сертификат (домен должен указывать на этот сервер)."
echo "Проверить службу: systemctl status crm      Журнал: journalctl -u crm -n 50"
