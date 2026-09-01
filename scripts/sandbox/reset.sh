#!/bin/bash
#
# Put the sandbox back to a known state.
#
# The banner on every page promises this happens nightly, so it has to actually
# happen - a promise the software does not keep is worse than no promise, and
# somebody will decide the box is safe to keep real data on.
#
#   reset.sh              restore the seed, or empty the database if none
#   reset.sh --capture    make the CURRENT state the seed
#
# Capture exists because an empty database means every tester has to walk the
# setup wizard before they can test anything, and most will not. Set the shop
# up once, capture it, and every night returns to that.
#
set -uo pipefail

DB=PosnicDevelop
SEED=/home/ubuntu/posnic-develop/seed.gz
LOG=/home/ubuntu/posnic-develop/reset.log
APP=posnic-develop

say() { echo "[$(date -u +%FT%TZ)] $*" | tee -a "$LOG"; }

if [ "${1:-}" = "--capture" ]; then
  say "capturing the current state as the seed"
  if mongodump --db "$DB" --archive="$SEED.tmp" --gzip --quiet; then
    SZ=$(stat -c %s "$SEED.tmp")
    # A seed that restores to nothing is worse than no seed: it would quietly
    # wipe the sandbox every night and look like it was working.
    if [ "$SZ" -lt 2000 ]; then
      say "REFUSED: the dump is only ${SZ} bytes - set the shop up first"
      rm -f "$SEED.tmp"
      exit 1
    fi
    mv "$SEED.tmp" "$SEED"
    say "seed saved, $(du -h "$SEED" | cut -f1)"
  else
    say "FAILED: mongodump did not succeed"
    rm -f "$SEED.tmp"
    exit 1
  fi
  exit 0
fi

say "reset starting"

# Stopped first. Resetting underneath a running app leaves it holding handles
# to collections that no longer exist, and it serves errors until somebody
# notices.
pm2 stop "$APP" >/dev/null 2>&1 || say "note: $APP was not running"

if [ -f "$SEED" ]; then
  if mongorestore --drop --archive="$SEED" --gzip --quiet; then
    say "restored from seed"
  else
    say "FAILED to restore the seed - dropping instead, so the box is at least clean"
    mongosh "$DB" --quiet --eval 'db.dropDatabase()' >/dev/null 2>&1
  fi
else
  mongosh "$DB" --quiet --eval 'db.dropDatabase()' >/dev/null 2>&1
  say "no seed yet - database emptied (run reset.sh --capture after setting a shop up)"
fi

pm2 start "$APP" >/dev/null 2>&1 || pm2 restart "$APP" >/dev/null 2>&1
sleep 4

CODE=$(curl -s -o /dev/null -m 15 -w '%{http_code}' http://127.0.0.1:3000/public/login.html || echo 000)
say "reset done, app answering ${CODE}"
[ "$CODE" = "200" ] || say "WARNING: the app is not serving after the reset"

# The log is the only record that this ran. Unbounded, it eventually fills a
# 60GB disk with the word "reset".
tail -n 500 "$LOG" > "$LOG.trim" && mv "$LOG.trim" "$LOG"
