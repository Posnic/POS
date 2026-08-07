# Disaster recovery

How a shop, and how we, get back to working. With targets stated as numbers,
because a recovery objective expressed as "quickly" cannot be tested.

---

## The property that makes this document short

**A shop's till does not depend on us.** The database is on the shop's own
computer, the API runs in-process, and there is no licence check and no server
that has to be reachable to make a sale.

So the disasters split cleanly:

| What fails | Can the shop trade? | Whose recovery |
|---|---|---|
| Our servers | **Yes** | Ours, and it does not block trade |
| The shop's internet | **Yes** | None needed |
| The shop's computer | No | Theirs, from backup |
| The shop's disk | No | Theirs, from backup |

Only two rows stop a shop trading, and both are local. That is the design, and
it is why the numbers below are as good as they are.

---

## Targets

**RPO** — recovery point objective — how much data you can lose.
**RTO** — recovery time objective — how long until you are working again.

### The shop's own data, local edition

| Scenario | RPO | RTO | Depends on |
|---|---|---|---|
| Bad data change, restore from backup | Up to 24 h (default daily) | 15–30 min | A backup existing |
| Computer fails, spare available | Up to 24 h | 1–2 h | An off-machine backup |
| Computer fails, no spare | Up to 24 h | Hours to days | Buying hardware |
| Disk fails, backups on the same disk | **Total loss** | — | Nothing to recover from |

**That last row is the one that matters**, and it is the common case. The
default backup folder is `Documents\Posnic-Backups` — the same disk as the data.
It protects against mistakes, not against hardware.

Improving your own RPO is a setting: hourly backups instead of daily takes the
first row from 24 hours to 1. Improving RTO is a spare machine. Both are the
shop's decisions, and they are the only ones that change these numbers.

### Posnic Cloud

| Scenario | RPO | RTO | Status |
|---|---|---|---|
| Service outage, no data loss | 0 | Target 4 h | **Not yet measured** |
| Data loss in the hosted database | Target 1 h | Target 8 h | **Not yet measured** |
| Complete loss of the hosting region | Target 24 h | Target 48 h | **Not yet measured** |

**These are intentions, not commitments.** They have not been measured by a
real restore drill, hosting is not final, and there is no SLA — see
[TERMS_OF_USE.md](../TERMS_OF_USE.md). They are written here so that when the
drill happens there is a number to check against, rather than a feeling.

**Cloud being down does not stop a shop trading.** Sync catches up afterwards.

---

## Recovering a shop

### From a backup, same machine

1. Open **Backup Manager → History**
2. Pick the backup from before the problem — check the date, twice
3. **Restore**

Everything recorded after that backup is gone. Restoring last night's backup at
four in the afternoon discards a day of sales. The confirmation says so; it is
worth reading rather than clicking through.

### Onto a new machine

1. Install Posnic and complete the setup wizard, so a database exists
2. Copy the backup folder onto the new machine
3. **Backup Manager → Restore**, and point it at the folder
4. Reconfigure printers and hardware — device settings are per-machine
5. Re-enter payment, SMTP and SMS credentials — those are deliberately not in
   backups, and deliberately tied to the machine that created them

The backup carries data, not credentials. That is a security property, and this
is the moment it costs you fifteen minutes.

### After a bad update

Restoring data is the **last** option, not the first. Work down
[RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md): asset revert takes seconds and
discards nothing; reinstalling the previous version keeps the data. Only restore
if the data itself is wrong.

Every update takes a forced backup first and **cancels the update if that backup
fails**, so there is always a copy from immediately before the version that
caused the problem.

### When Posnic will not start at all

1. Restart the computer. It clears a stuck database process more often than
   anything else.
2. Read the log: `%APPDATA%\posnic\app.log`
3. The data is in `%APPDATA%\posnic\mongodb` — if the application is broken but
   that folder is intact, a reinstall over the top keeps it
4. If the folder is damaged, restore from backup

**Do not uninstall first.** Installing over the top preserves data; uninstalling
is what puts it at risk, and it is the step people improvise under pressure.

---

## Recovering the service

For Posnic Cloud, in order:

1. **Confirm the blast radius** — one customer, or everyone
2. **Say so publicly** before anyone has to ask
3. **Restore from the most recent good backup**
4. **Verify before reopening** — restore into a scratch environment and check
   record counts and recent writes, then cut over
5. **Let tills catch up.** They queue while disconnected and sync afterwards;
   this is the normal path, not an exception
6. **Reconcile** — find and fix anything that fell in the gap
7. **Write it up** — [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md)

---

## Drills

An untested recovery plan is a wish.

| Drill | How often | Last done |
|---|---|---|
| Restore a shop backup onto a clean machine | Every release | **Never** |
| Restore a Cloud backup into a scratch environment | Quarterly | **Never** |
| Walk a total-machine-loss recovery end to end | Annually | **Never** |

**Every row says never.** That is the honest state, and it is why the Cloud
numbers above are targets rather than measurements. The first drill is the
highest-value piece of work on this page — it is also the one that most often
reveals that backups were never as restorable as everyone assumed.

---

## For shops: the five minutes that decide this

1. Leave automatic backups on
2. Set up the Windows scheduled task, so backups happen when the till is off —
   *Backup Manager → Settings → Backups when Posnic is closed*
3. Get one copy **off the machine** — USB drive, another computer, or a synced
   folder
4. **Restore one backup onto another computer once**, so you have done it before
   the day you need it
5. Turn on device encryption, and keep the recovery key somewhere else

Steps 2 and 4 are the ones usually skipped, and they are the two that decide
whether a bad day is an inconvenience or the end of your records.

Full detail: [BACKUP_POLICY.md](BACKUP_POLICY.md).
