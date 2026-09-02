# Running Posnic on your own server

Posnic normally runs as a desktop application on the shop computer. It can also
run on a server, so staff use it from a browser on any till, tablet or phone on
the network.

Both are the same free software under AGPL-3.0. Nothing here is a trial and
nothing expires.

---

## Which one do you want?

| | Desktop | Your own server |
|---|---|---|
| Install | Download and run | One command on Ubuntu |
| Where the data lives | That computer | Your server |
| Works with no internet | Yes | On your own network, yes |
| Several people at once | One computer | Any device that can reach the server |
| Somebody must maintain it | No | **You** — updates, backups, certificate |
| Sync between separate shops | Posnic Cloud | Posnic Cloud |

**Be honest with yourself about the last two rows.** A server is not a better
desktop; it is a machine somebody has to look after. If one person rings up
sales on one computer, the desktop edition is the right answer and always will
be.

### What self-hosting does not include

**Sync between tills or branches is not part of this.** That is
[Posnic Cloud](https://posnic.com/pricing.html), and it is a paid service.

A self-hosted Posnic is **one database that several people use at once**, which
is what most single-shop setups actually want. It is not several databases kept
in step with each other. If you need two shops to see each other's stock, you
need Cloud.

Off-site backups, the remote dashboard and installers under your own brand are
also Cloud.

---

## What you need

- **Ubuntu 24.04.** The installer refuses to guess on anything else. Other
  systems are possible by hand — see [By hand](#by-hand).
- **2 GB of memory.** A fresh install uses about 600 MB with MongoDB running,
  so 1 GB leaves nothing for a busy day or an upgrade.
- **8 GB of disk**, more if you keep years of sales.
- A domain name, if the server is reachable from the internet.

A 2 GB virtual machine from any provider is enough for a single shop. That is
around $10–12 a month at the time of writing.

---

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/Posnic/POS/develop/scripts/install-server.sh -o install-server.sh
less install-server.sh          # read it first - you are about to run it as root
sudo bash install-server.sh
```

It installs Node.js 22, MongoDB 8, and Posnic into `/opt/posnic`, generates
this machine's own secrets, and runs it under systemd so it comes back after a
reboot.

When it finishes it prints the address to open. The setup wizard creates your
shop and your first user.

Re-running it updates Posnic to the latest release and **leaves your secrets
and your data alone**.

### What it changes

Worth knowing before you run something as root:

| | |
|---|---|
| Installs | `nodejs`, `mongodb-org`, `git`, `curl`, `gnupg` |
| Adds apt sources | NodeSource, MongoDB |
| Creates | `/opt/posnic`, `/etc/systemd/system/posnic.service` |
| Starts | `mongod` and `posnic`, both enabled at boot |
| Never touches | an existing `api/.env`, or your database |

---

## Three things to do afterwards

The installer says this too, because none of them are optional on a shop that
takes real money.

### 1. A certificate

Straight after install, Posnic answers plain HTTP on port 3000. **Passwords
cross the network in the clear.** On a private LAN that is a risk you might
accept; on the internet it is not.

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
```

`/etc/nginx/sites-available/posnic`:

```nginx
server {
    listen 80;
    server_name pos.example.com;

    location / {
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
```

```bash
sudo ln -s /etc/nginx/sites-available/posnic /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d pos.example.com
```

certbot installs the certificate, redirects HTTP to HTTPS, and renews it on a
timer.

### 2. A firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

**Port 27017 must never be open to the internet.** An exposed MongoDB is found
by scanners within hours, and Posnic only needs it on `127.0.0.1`.

### 3. Backups

Your shop's records are in MongoDB on that one disk. A server does not back
itself up, and a snapshot of the whole machine taken once a month is not a
backup of yesterday's takings.

`/etc/cron.d/posnic-backup`:

```cron
0 2 * * * root mongodump --db Posnic --archive=/var/backups/posnic-$(date +\%F).gz --gzip && find /var/backups -name 'posnic-*.gz' -mtime +14 -delete
```

Then **copy them somewhere else**. A backup on the same disk as the database
survives a mistake but not a dead machine.

And restore one, once, before you need to:

```bash
mongorestore --drop --archive=/var/backups/posnic-2026-09-02.gz --gzip
```

A backup nobody has restored is a file, not a backup.

---

## Running it

```bash
systemctl status posnic          # is it up
journalctl -u posnic -f          # what it is doing
sudo systemctl restart posnic    # after changing api/.env
sudo bash install-server.sh      # update to the latest release
```

Posnic lives in `/opt/posnic`, its settings in `/opt/posnic/api/.env`, and its
data in MongoDB under the database named in `MONGODB_URI`.

### If it will not start

```bash
journalctl -u posnic -n 50 --no-pager
```

The two usual causes:

- **`refusing to start; these are not set`** — `api/.env` is missing or
  incomplete. Delete it and re-run the installer to regenerate it. Note this
  signs everybody out.
- **MongoDB is not running** — `systemctl status mongod`.

---

## By hand

On a system the installer will not touch, the shape is:

1. Node.js 22 and MongoDB 8, both running.
2. `git clone https://github.com/Posnic/POS.git`
3. `npm --prefix api install --omit=dev`
4. `cd frontend && npm install && npx gulp build`
5. Write `api/.env` with `JWT_SECRET`, `SESSION_SECRET`, `ENCRYPTION_KEY`
   (16 random bytes as hex), `ENCRYPTION_IV` (8 bytes as hex), `POSNIC_KEY`,
   `POSNIC_SECRET`, `MONGODB_URI` and `PORT`.
6. Run `node api/server.js` under whatever supervises processes on your system.

The API serves the built frontend itself, so there is no second web server to
configure — only the reverse proxy that terminates TLS.

`scripts/install-server.sh` is the readable version of all of this.

---

## If you are locked out

Nobody can reset your password for you. There is no console for a server you
own, our reset email does not know where your shop lives, and support cannot
reach a machine on your network. That is the trade you made for holding your
own data, and it is fine as long as there is a way back in.

Run this **on the server itself**:

```bash
cd /opt/posnic
npm run recover
```

It lists everyone who can sign in, and — usefully when somebody says *"it
worked yesterday"* — when each password was last changed.

To set one:

```bash
npm run recover -- owner@yourshop.example 'a new password'
```

Three things worth knowing:

- It hashes the password the way this application expects. Editing the database
  by hand almost always gets this wrong, and the symptom is nasty: sign-in
  works, and manager approvals quietly stop accepting the same password weeks
  later.
- **Every use is written to your own audit log**, with the operating-system
  account that ran it. You can see it happened.
- It only opens the database this installation already uses. There is no flag
  to point it somewhere else.

This is not a back door. Anybody who can run it can already read your database
directly — they are sitting on your server. What it does is make recovery
documented and recorded, instead of a technique somebody has to know.

---

## Questions people ask

**Can I move from desktop to server later?** Yes. Both use the same database
format; `mongodump` on one and `mongorestore` on the other.

**Can two shops share one server?** They can each have a database on it, but
they will not see each other's stock or customers, and Posnic will not keep
them in step. That is what Cloud sync is for.

**Do I have to publish my changes?** Posnic is AGPL-3.0. If you modify it and
let other people use it over a network, you must offer them your modified
source. Running it unmodified for your own shop asks nothing of you.

**Can I call my install "Posnic"?** For your own use, yes. Offering it to
others under that name needs permission — the name and logo are trademarks and
are not covered by the AGPL. See [GOVERNANCE.md](GOVERNANCE.md#trademark-and-reserved-rights).

**Is this supported?** The software is free and comes with no warranty. Ask in
[issues](https://github.com/Posnic/POS/issues) and somebody may help. Paid
support is part of Cloud.
