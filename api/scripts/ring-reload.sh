#!/usr/bin/env bash
#
# Ring-ordered tenant reload with a smoke gate between rings (U3.2).
#
# Runs ON the tenant instance, invoked by deploy-api.yml after rsync and
# npm ci. The code on disk is already new everywhere; what this orders is
# WHICH PROCESSES LOAD IT, so a bad build is discovered by the canary ring
# while every later ring keeps answering with the previous build. A halt
# here is recoverable by pushing a fix or re-running the previous deploy;
# a bad build loaded by all twenty shops at once is a support fire.
#
# Rings come from a file the operator owns on the server - nothing in the
# repo decides which shop is a canary:
#
#   ~/apps/admin/provisioning/rings.json
#   {
#     "rings": [
#       { "name": "canary", "match": ["posnic-shard-1"] },
#       { "name": "beta",   "match": ["posnic-tenant-a*"] }
#     ]
#   }
#
# match entries are glob-ish (* wildcards). Online processes not claimed
# by any ring form the final "ga" ring automatically. No rings file means
# ONE ring holding everything - exactly the single-pass deploy this
# replaces, so an instance without the file behaves as before.
#
# Inherited rules, learned the hard way (see deploy-api.yml history):
#   - No pm2 --update-env: it would overwrite each tenant's cached PORT
#     and MONGODB_URI with this SSH session's environment.
#   - Reload one process per pm2 call: `pm2 reload a b c` acts on the
#     first name only and exits 0.
#   - Only processes currently ONLINE: `pm2 reload` on a stopped process
#     STARTS it, and stopped per-shop processes are the rollback for
#     shops consolidated onto the shard.
#   - THIS LOG IS PUBLIC (open-source repo, Actions logs world-readable).
#     Print counts and ring names, never tenant process names - except on
#     a failure, where the name is the actionable fact.
set -eu

APP_DIR="$HOME/apps/tenants/app/api"
ADMIN_DIR="$HOME/apps/admin"
# Where this script (and its helpers) live - captured before any cd.
API_DIR="$(pwd)"
RINGS_FILE="$ADMIN_DIR/provisioning/rings.json"

# A planned reload is not an outage. The watchdog honors ~/maintenance and
# stays quiet while it exists - without this, every deploy mailed the owner
# an ALERT + recovered pair the moment its blip crossed a watchdog tick.
# The trap clears it on ANY exit: after a FAILED deploy the processes are
# genuinely down and the very next tick should alert as loudly as ever.
MAINTENANCE_FLAG="$HOME/maintenance"
touch "$MAINTENANCE_FLAG"
trap 'rm -f "$MAINTENANCE_FLAG"' EXIT

cd "$APP_DIR"

online_names() {
  pm2 jlist | node -e '
    let d = "";
    process.stdin.on("data", (c) => (d += c));
    process.stdin.on("end", () => {
      const list = JSON.parse(d)
        .filter((p) => /^posnic-(tenant|shard)-/.test(p.name) && p.pm2_env.status === "online")
        .map((p) => p.name);
      console.log(list.join("\n"));
    });'
}

# Emits "ring<TAB>name" lines in deploy order. A malformed rings file
# fails the deploy loudly - silently deploying everything at once is the
# one thing an operator who wrote a rings file asked us not to do.
plan() {
  online_names | node -e '
    const fs = require("fs");
    let d = "";
    process.stdin.on("data", (c) => (d += c));
    process.stdin.on("end", () => {
      const names = d.split("\n").filter(Boolean);
      const file = process.argv[1];
      let rings = [];
      if (file && fs.existsSync(file)) {
        try {
          rings = JSON.parse(fs.readFileSync(file, "utf8")).rings || [];
        } catch (e) {
          console.error("rings file unreadable: " + e.message);
          process.exit(1);
        }
      }
      const claimed = new Set();
      const out = [];
      for (const ring of rings) {
        const pats = (ring.match || []).map(
          (p) =>
            new RegExp(
              "^" +
                p
                  .split("*")
                  .map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
                  .join(".*") +
                "$"
            )
        );
        for (const n of names) {
          if (claimed.has(n)) continue;
          if (pats.some((re) => re.test(n))) {
            claimed.add(n);
            out.push((ring.name || "ring") + "\t" + n);
          }
        }
      }
      for (const n of names) if (!claimed.has(n)) out.push("ga\t" + n);
      console.log(out.join("\n"));
    });' "$RINGS_FILE"
}

process_status() {
  pm2 jlist | node -e '
    let d = "";
    process.stdin.on("data", (c) => (d += c));
    process.stdin.on("end", () => {
      const p = JSON.parse(d).find((x) => x.name === process.argv[1]);
      console.log(p ? p.pm2_env.status : "missing");
    });' "$1"
}

# The product check: sign in for real, read data, for every shop. pm2
# "online" is not "listening", so poll a shop first (a fixed sleep is
# either too short or wasted). Quiet mode, because this log is public
# and the full output names customers beside their business numbers.
smoke() {
  (
    set -a
    # shellcheck disable=SC1091
    . "$ADMIN_DIR/.env"
    set +a
    cd "$ADMIN_DIR"
    if [ ! -f provisioning/smoke.js ]; then
      echo "::warning::smoke.js not present - ring gate cannot verify, continuing"
      exit 0
    fi
    host=$(grep -oP "^[a-z0-9-]+\.posnic\.io" /etc/nginx/tenants.map | head -1)
    ready=""
    for i in $(seq 1 60); do
      code=$(curl -s -o /dev/null -m 5 -w "%{http_code}" -H "Host: $host" http://127.0.0.1/ 2>/dev/null || true)
      if [ "$code" = "200" ]; then ready=yes; break; fi
      sleep 2
    done
    if [ -z "$ready" ]; then
      echo "::error::no shop answered within 120s of the reload"
      exit 1
    fi
    # Self-healing fixture (2026-08-18): the smoke SELLS a real unit every
    # deploy, and a heavy shipping day drained the fixture to zero - every
    # deploy then failed its own gate for a reason unrelated to the code.
    # Top the fixture back up before proving the ring. Never a gate itself.
    if [ -f "$API_DIR/scripts/smoke-restock.js" ]; then
      node "$API_DIR/scripts/smoke-restock.js" || true
    fi
    SMOKE_QUIET=true SMOKE_WRITE_TENANT="${SMOKE_WRITE_TENANT:-tech}" \
      node provisioning/smoke.js --quiet
  )
}

plan_lines=$(plan)
if [ -z "$plan_lines" ]; then
  echo "no online tenant processes; nothing to reload"
  exit 0
fi

if [ -f "$RINGS_FILE" ]; then
  echo "rings file present; deploying ring by ring"
else
  echo "no rings file at ~/apps/admin/provisioning/rings.json; single ring"
fi

rings_order=$(printf '%s\n' "$plan_lines" | cut -f1 | awk '!seen[$0]++')
total_all=$(printf '%s\n' "$plan_lines" | wc -l)
done_count=0

for ring in $rings_order; do
  members=$(printf '%s\n' "$plan_lines" | awk -F'\t' -v r="$ring" '$1==r{print $2}')
  n=0
  ok=0
  for name in $members; do
    n=$((n + 1))
    if pm2 reload "$name" --silent >/dev/null 2>&1; then
      ok=$((ok + 1))
    else
      echo "::warning::reload failed for $name"
    fi
  done
  echo "ring $ring: reloaded $ok of $n"
  test "$ok" -eq "$n"

  # A shard reloaded but not answering is a whole machine down, so it is
  # checked here rather than discovered by a shopkeeper.
  for name in $members; do
    case "$name" in
      posnic-shard-*)
        sleep 2
        st=$(process_status "$name")
        if [ "$st" != "online" ]; then
          echo "::error::$name is $st after reload"
          exit 1
        fi
        echo "$name online"
        ;;
    esac
  done

  if ! smoke; then
    echo "::error::smoke failed after ring $ring - later rings still run the previous build"
    exit 1
  fi
  done_count=$((done_count + n))
  echo "ring $ring verified ($done_count of $total_all processes on the new build)"
done

pm2 save
echo "all rings deployed: $done_count of $total_all processes"
