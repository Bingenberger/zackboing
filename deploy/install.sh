#!/usr/bin/env bash
# Wird AUF DEM SERVER als root ausgeführt (deploy.sh macht das automatisch).
# Richtet Systemnutzer, /opt/zackboing, /var/lib/zackboing und den systemd-Dienst ein.
set -euo pipefail

SRC="${1:-/tmp/zackboing-upload}"   # frisch hochgeladener Quellcode
APP=/opt/zackboing
DATA=/var/lib/zackboing

# Node.js >= 18 samt npm sicherstellen (Ubuntu/Debian liefern per apt nur uraltes Node ohne npm)
node_ok() { command -v node >/dev/null && command -v npm >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 18 ]; }
if ! node_ok; then
  echo "→ Node.js >= 18 fehlt – installiere Node 22 über NodeSource"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg build-essential python3 rsync
  apt-get remove -y -qq nodejs libnode-dev libnode72 npm 2>/dev/null || true
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
  hash -r
  node_ok || { echo "Node-Installation fehlgeschlagen"; exit 1; }
fi
NODE_BIN="$(command -v node)"
echo "Node: $NODE_BIN ($(node -v), npm $(npm -v))"

id -u zackboing >/dev/null 2>&1 || useradd --system --home-dir "$APP" --shell /usr/sbin/nologin zackboing

mkdir -p "$APP" "$DATA"
rsync -a --delete --exclude node_modules --exclude data --exclude .claude "$SRC"/ "$APP"/
cd "$APP"
npm ci --omit=dev --no-audit --no-fund   # better-sqlite3 wird hier für die Server-Architektur gebaut
chown -R root:zackboing "$APP"
chown -R zackboing:zackboing "$DATA"
chmod 750 "$DATA"

sed "s#__NODE__#$NODE_BIN#" "$APP/deploy/zackboing.service" > /etc/systemd/system/zackboing.service
systemctl daemon-reload
systemctl enable zackboing
systemctl restart zackboing   # auch bei Updates: laufenden Prozess durch neuen Code ersetzen
sleep 2
systemctl --no-pager --lines=5 status zackboing || true
curl -fsS -o /dev/null -w "Lokaler Check: HTTP %{http_code} auf 127.0.0.1:3100\n" http://127.0.0.1:3100/

echo
echo "Reverse-Proxy: siehe $APP/deploy/nginx-zackboing.conf bzw. Caddyfile-snippet"
