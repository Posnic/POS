#!/bin/bash
# Prepare the develop sandbox.
#
# This box runs unreviewed contributor code, so it gets NOTHING that touches
# anything real: its own database, its own secrets generated here and nowhere
# else, and no credential that production also uses.
set -euo pipefail

say() { echo ""; echo "=== $* ==="; }

say "system"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq gnupg curl nginx ca-certificates >/dev/null
echo "  nginx $(nginx -v 2>&1 | grep -o '[0-9.]*$')"

say "node 22"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - >/dev/null 2>&1
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs >/dev/null
fi
echo "  node $(node --version), npm $(npm --version)"

say "mongodb"
if ! command -v mongod >/dev/null 2>&1; then
  curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc \
    | sudo gpg -o /usr/share/keyrings/mongodb-server-8.0.gpg --dearmor
  echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.0 multiverse" \
    | sudo tee /etc/apt/sources.list.d/mongodb-org-8.0.list >/dev/null
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq mongodb-org >/dev/null
fi
sudo systemctl enable --now mongod >/dev/null 2>&1 || true
sleep 3
echo "  $(mongod --version | head -1)"
echo "  mongod: $(systemctl is-active mongod)"

say "pm2"
sudo npm install -g pm2@7.0.4 --silent >/dev/null 2>&1 || sudo npm install -g pm2@7.0.4 >/dev/null
echo "  pm2 $(pm2 --version)"

say "app directory and its own secrets"
mkdir -p ~/posnic-develop/api ~/posnic-develop/frontend/public ~/posnic-develop/languages
if [ -f ~/posnic-develop/api/.env ]; then
  echo "  .env already exists - left alone (regenerating signs out every tester)"
else
  node -e '
    const c = require("crypto");
    const hex = (n) => c.randomBytes(n).toString("hex");
    // Same shapes the desktop app generates per installation. AES-256-CBC
    // wants a 32-byte key and a 16-byte IV, which is 16 and 8 bytes of hex.
    console.log([
      "# Generated on this machine, for this machine. Shares nothing with",
      "# production - this box runs unreviewed code and must not be able to",
      "# reach anything real.",
      "JWT_SECRET=" + hex(48),
      "SESSION_SECRET=" + hex(48),
      "ENCRYPTION_KEY=" + hex(16),
      "ENCRYPTION_IV=" + hex(8),
      "KIOSK_API_KEY=" + hex(32),
      "POSNIC_KEY=" + hex(24),
      "POSNIC_SECRET=" + hex(24),
      "MONGODB_URI=mongodb://127.0.0.1:27017/PosnicDevelop",
      "PORT=3000",
      "NODE_ENV=development",
      "",
    ].join("\n"));
  ' > ~/posnic-develop/api/.env
  chmod 600 ~/posnic-develop/api/.env
  echo "  generated ~/posnic-develop/api/.env"
fi

say "nginx"
sudo tee /etc/nginx/sites-available/develop >/dev/null <<'NGINX'
# The develop sandbox. Public, disposable, and running code nobody has
# reviewed - so it is rate limited and proxies to the app on 3000.
limit_req_zone $binary_remote_addr zone=develop:10m rate=20r/s;

server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name develop.posnic.io _;

    client_max_body_size 25m;

    # Say what this is, to anything that asks. It is the cheapest way to stop
    # a search engine treating a sandbox as the product.
    add_header X-Robots-Tag "noindex, nofollow" always;

    location / {
        limit_req zone=develop burst=40 nodelay;
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
    }
}
NGINX
sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sf /etc/nginx/sites-available/develop /etc/nginx/sites-enabled/develop
sudo nginx -t && sudo systemctl reload nginx
echo "  nginx: $(systemctl is-active nginx), proxying :80 -> :3000"

say "ready"
echo "  the app is not deployed yet - that is the GitHub workflow's job."
echo "  robots.txt and a banner come with the first deploy."
