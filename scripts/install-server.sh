#!/bin/bash
#
# Install Posnic on your own server.
#
#   curl -fsSL https://raw.githubusercontent.com/Posnic/POS/main/scripts/install-server.sh | bash
#
# or, having cloned the repository:
#
#   sudo ./scripts/install-server.sh
#
# WHAT THIS GIVES YOU
#
# One Posnic, reachable in a browser, on a machine you control. Staff sign in
# from any device on the network, the data is on your disk, and nothing leaves
# it. That is the whole local edition, running on a server instead of one
# shop computer.
#
# WHAT IT DOES NOT GIVE YOU
#
# Sync between separate tills or branches. That is Posnic Cloud, and it stays
# a paid service. A self-hosted Posnic is ONE database that several people use
# at once - which is what most single-shop setups actually want - not several
# databases kept in step.
#
# Read docs/SELF_HOSTING.md before running this on anything that matters. It
# says what it changes, and what you still have to do afterwards: a
# certificate, a firewall and backups.
#
# Tested on Ubuntu 24.04. It will refuse to guess on anything else.
#
set -euo pipefail

APP_USER="${POSNIC_USER:-$(id -un)}"
APP_DIR="${POSNIC_DIR:-/opt/posnic}"
PORT="${POSNIC_PORT:-3000}"
MONGO_PORT="${POSNIC_MONGO_PORT:-27017}"
DB_NAME="${POSNIC_DB:-Posnic}"
REPO="${POSNIC_REPO:-https://github.com/Posnic/POS.git}"
BRANCH="${POSNIC_BRANCH:-main}"

say()  { echo ""; echo "==> $*"; }
info() { echo "    $*"; }
die()  { echo ""; echo "  STOPPED: $*" >&2; [ -n "${2:-}" ] && echo "  -> $2" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "run this with sudo" "sudo ./scripts/install-server.sh"

# --------------------------------------------------------------- the machine

say "Checking the machine"

. /etc/os-release 2>/dev/null || die "cannot read /etc/os-release"
if [ "${ID:-}" != "ubuntu" ]; then
  die "this installs on Ubuntu; found ${PRETTY_NAME:-unknown}" \
      "docs/SELF_HOSTING.md lists what to install by hand on other systems"
fi
info "$PRETTY_NAME"

RAM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
info "${RAM_MB} MB of memory"
if [ "$RAM_MB" -lt 1700 ]; then
  # MongoDB, the API and a build do not fit comfortably below this. Saying so
  # now is kinder than an out-of-memory kill during the first busy hour.
  die "Posnic needs about 2 GB; this machine has ${RAM_MB} MB" \
      "A 2 GB instance is enough for a single shop."
fi

DISK_GB=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
info "${DISK_GB} GB free"
[ "$DISK_GB" -ge 8 ] || die "at least 8 GB of free disk is needed, found ${DISK_GB} GB"

# ------------------------------------------------------------------ packages

say "Installing what Posnic needs"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl gnupg git ca-certificates >/dev/null

if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  info "Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs >/dev/null
fi
info "node $(node --version)"

if ! command -v mongod >/dev/null 2>&1; then
  info "MongoDB 8.0"
  curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc \
    | gpg -o /usr/share/keyrings/mongodb-server-8.0.gpg --dearmor
  echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu ${UBUNTU_CODENAME:-noble}/mongodb-org/8.0 multiverse" \
    > /etc/apt/sources.list.d/mongodb-org-8.0.list
  apt-get update -qq
  apt-get install -y -qq mongodb-org >/dev/null
fi
systemctl enable --now mongod >/dev/null 2>&1 || true
sleep 3
systemctl is-active --quiet mongod || die "MongoDB did not start" "journalctl -u mongod -n 50"
info "mongod is running"

# ---------------------------------------------------------------------- code

say "Fetching Posnic"

if [ -d "$APP_DIR/.git" ]; then
  info "already at $APP_DIR - updating"
  git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
  git -C "$APP_DIR" checkout --quiet "$BRANCH"
  git -C "$APP_DIR" reset --hard --quiet "origin/$BRANCH"
else
  git clone --quiet --branch "$BRANCH" --depth 1 "$REPO" "$APP_DIR"
  info "cloned into $APP_DIR"
fi
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

say "Building"
info "this takes a few minutes on a small machine"
sudo -u "$APP_USER" bash -lc "cd '$APP_DIR' && npm --prefix api install --omit=dev --no-audit --no-fund" >/dev/null
sudo -u "$APP_USER" bash -lc "cd '$APP_DIR/frontend' && npm install --no-audit --no-fund && npx gulp build" >/dev/null
[ -f "$APP_DIR/frontend/public/login.html" ] || die "the frontend build produced nothing" \
  "cd $APP_DIR/frontend && npx gulp build"
info "built"

# ------------------------------------------------------------------- secrets

say "Secrets"

ENV_FILE="$APP_DIR/api/.env"
if [ -f "$ENV_FILE" ]; then
  info "api/.env already exists - left alone"
else
  # Generated here, on this machine. Posnic refuses to start with placeholders
  # on purpose: every installation once shared one signing key, and anybody who
  # read the source could mint a session for any till.
  sudo -u "$APP_USER" node -e '
    const c = require("crypto");
    const hex = (n) => c.randomBytes(n).toString("hex");
    console.log([
      "# Generated on this machine at install. Keep it, and keep it private:",
      "# losing it signs everyone out; leaking it lets somebody forge a login.",
      "JWT_SECRET=" + hex(48),
      "SESSION_SECRET=" + hex(48),
      "ENCRYPTION_KEY=" + hex(16),
      "ENCRYPTION_IV=" + hex(8),
      "KIOSK_API_KEY=" + hex(32),
      "POSNIC_KEY=" + hex(24),
      "POSNIC_SECRET=" + hex(24),
      "MONGODB_URI=mongodb://127.0.0.1:'"$MONGO_PORT"'/'"$DB_NAME"'",
      "PORT='"$PORT"'",
      "NODE_ENV=production",
      "",
    ].join("\n"));' > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  chown "$APP_USER":"$APP_USER" "$ENV_FILE"
  info "generated api/.env"
fi

# ------------------------------------------------------------------- service

say "Running it as a service"

# systemd rather than a process manager: it is already on the machine, it
# restarts on boot without another daemon to remember, and journalctl is where
# a Linux administrator will look first.
cat > /etc/systemd/system/posnic.service <<UNIT
[Unit]
Description=Posnic point of sale
After=network.target mongod.service
Requires=mongod.service

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}/api
ExecStart=$(command -v node) server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

# It serves a web application and needs nothing else on the disk.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=read-only
ReadWritePaths=${APP_DIR}

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now posnic >/dev/null 2>&1
sleep 5

if ! systemctl is-active --quiet posnic; then
  die "Posnic did not start" "journalctl -u posnic -n 50 --no-pager"
fi

CODE=$(curl -s -o /dev/null -m 15 -w '%{http_code}' "http://127.0.0.1:${PORT}/public/login.html" || echo 000)
[ "$CODE" = "200" ] || die "the service is up but not serving (HTTP ${CODE})" \
  "journalctl -u posnic -n 50 --no-pager"

IP=$(hostname -I 2>/dev/null | awk '{print $1}')

cat <<DONE

  ─────────────────────────────────────────────────────────────
   Posnic is running.

     on this machine   http://127.0.0.1:${PORT}/public/login.html
     on your network   http://${IP:-<this server>}:${PORT}/public/login.html

   Open it and the setup wizard will create your shop.
  ─────────────────────────────────────────────────────────────

  THREE THINGS STILL TO DO. None of them are optional on a real shop:

    1. A certificate. Right now this is plain HTTP and passwords cross the
       network in the clear. docs/SELF_HOSTING.md has nginx and Let's Encrypt.

    2. A firewall. Do not leave ${PORT} and 27017 open to the internet:
         ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw enable

    3. Backups. Your shop's records are in MongoDB on this disk and nowhere
       else. The guide has a mongodump job worth copying.

  Service:  systemctl status posnic   |   journalctl -u posnic -f
  Update:   sudo $0

DONE
