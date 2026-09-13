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
HOME_DIR=/home/ubuntu/posnic-develop
SEED=$HOME_DIR/seed.gz
LOG=$HOME_DIR/reset.log
APP=posnic-develop
# What survives the night. On the box only, never in the repository: it holds
# real API keys.
KEEP=$HOME_DIR/keep

say() { echo "[$(date -u +%FT%TZ)] $*" | tee -a "$LOG"; }

# ---------------------------------------------------------------------------
# WHAT A RESET MUST NOT TAKE WITH IT
#
# The nightly wipe exists to clear what testers did: orders, customers,
# half-finished experiments. It does not exist to make somebody type their
# OpenAI key in again every morning, or their UPI id, or switch the assistant
# back on. A credential is typed once and then trusted to stay.
#
# Three things are carried across. The two settings collections hold what a
# person configured, and the group rows win over the older copy on the branch
# document, so restoring them is enough for the values to be in force. The
# branches carry the ordering configuration - the UPI payee, the store
# address - and only that one field is copied back, by keep-branches.js.
#
# Everything else is wiped exactly as before.
# ---------------------------------------------------------------------------
keep_save() {
  mkdir -p "$KEEP"
  rm -f "$KEEP"/*.gz

  for c in branch_secrets branch_preferences branches; do
    if mongodump --db "$DB" --collection "$c" --archive="$KEEP/$c.gz" --gzip --quiet 2>/dev/null; then
      say "keeping $c"
    else
      rm -f "$KEEP/$c.gz"
      say "note: nothing to keep from $c"
    fi
  done
}

keep_restore() {
  for c in branch_secrets branch_preferences; do
    [ -f "$KEEP/$c.gz" ] || continue
    if mongorestore --archive="$KEEP/$c.gz" --gzip --drop --quiet 2>/dev/null; then
      say "put $c back"
    else
      say "WARNING: $c could not be put back - the keys will need typing again"
    fi
  done

  # The branches are put back BESIDE the restored ones rather than over them,
  # so a reset that rebuilt the shop keeps the shop it rebuilt and takes only
  # the configuration from the old one.
  if [ -f "$KEEP/branches.gz" ]; then
    RESTORE_KEPT="mongorestore --archive=$KEEP/branches.gz --gzip --drop --quiet"
    if $RESTORE_KEPT --nsFrom "$DB.branches" --nsTo "$DB.kept_branches" 2>/dev/null; then
      mongosh "$DB" --quiet "$HOME_DIR/keep-branches.js" 2>&1 | sed 's/^/    /' | tee -a "$LOG"
    else
      say "note: the kept branches would not restore"
    fi
  fi
}

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

# Saved BEFORE anything is dropped, and while the app is still up: a dump of
# three collections reads cleanly from a running database.
keep_save

# Stopped first. Resetting underneath a running app leaves it holding handles
# to collections that no longer exist, and it serves errors until somebody
# notices.
pm2 stop "$APP" >/dev/null 2>&1 || say "note: $APP was not running"

if [ -f "$SEED" ]; then
  # A captured snapshot wins: somebody took it deliberately, and it may hold
  # a state the seeder cannot rebuild.
  if mongorestore --drop --archive="$SEED" --gzip --quiet; then
    say "restored from the captured seed"
    RESEED=no
  else
    say "the captured seed would not restore - falling back to seeding"
    mongosh "$DB" --quiet --eval 'db.dropDatabase()' >/dev/null 2>&1
    RESEED=yes
  fi
else
  mongosh "$DB" --quiet --eval 'db.dropDatabase()' >/dev/null 2>&1
  RESEED=yes
fi

pm2 start "$APP" >/dev/null 2>&1 || pm2 restart "$APP" >/dev/null 2>&1
sleep 4

# Rebuilt rather than left blank. An empty sandbox every morning is the exact
# problem the seeder exists to solve: whoever arrives has to walk the setup
# wizard before they can look at the thing they came to look at.
if [ "$RESEED" = "yes" ]; then
  if node /home/ubuntu/posnic-develop/seed.js 2>&1 | sed 's/^/    /' | tee -a "$LOG"; then
    say "reseeded"
  else
    say "WARNING: seeding failed - the sandbox is empty"
  fi
fi

# The keys go back last, over whatever the restore or the seeder wrote, and
# the app is restarted so nothing serves a moment of the state without them.
keep_restore
pm2 restart "$APP" >/dev/null 2>&1 || say "note: could not restart $APP"
sleep 4

CODE=$(curl -s -o /dev/null -m 15 -w '%{http_code}' http://127.0.0.1:3000/public/login.html || echo 000)
say "reset done, app answering ${CODE}"
[ "$CODE" = "200" ] || say "WARNING: the app is not serving after the reset"

# The log is the only record that this ran. Unbounded, it eventually fills a
# 60GB disk with the word "reset".
tail -n 500 "$LOG" > "$LOG.trim" && mv "$LOG.trim" "$LOG"
