# Backup and restore policy

What Posnic backs up, when, where it goes, and what it does not protect you
from. Written so a shop can check its own arrangements against it, and so
support has one description to work from rather than several.

Everything here describes the **local edition**, where the data is on the
shop's own computer. Posnic Cloud is noted where it differs.

---

## What is backed up

A full logical export of the shop's database: sales, returns, items, stock
movements, customers, suppliers, purchases, expenses, users, branches, settings
and configuration — every collection, compressed per collection, with a
manifest recording the collection count, document counts, total size and a
SHA-256 of the set.

**What is not in a backup:**

| Not included | Why, and what to do about it |
|---|---|
| The database password | Tied to the Windows account that installed Posnic. A backup restored on a different machine is restored into that machine's own database. |
| Receipt and report PDFs | Regenerated from the data. |
| The application itself | Reinstall from the releases page; the data is separate. |

---

## When backups run

| Trigger | Default | Notes |
|---|---|---|
| Scheduled | Daily at 22:00 | Configurable to hourly, daily or weekly in *Backup Manager → Settings* |
| Before an update | Always | Forced, and **not optional**. If it fails, the update is cancelled rather than applied. |
| On demand | — | *Backup Manager → Backup Now* |
| While Posnic is closed | Off by default | Needs a Windows scheduled task. See below. |

### The gap that catches people

The scheduled backup is a timer **inside the application**. A shop that shuts
the till down every evening at nine gets no overnight backup, and the morning
that matters is the one where the disk does not come back.

Two fixes:

- **Posnic Cloud** runs backups on our servers regardless of whether any till is
  switched on.
- **On the local edition**, ask Windows to do it. Posnic writes the exact
  command with the real paths already filled in: *Backup Manager → Settings →
  Backups when Posnic is closed → Show me the command*. It starts the database,
  takes the backup, stops the database, and reports a non-zero exit code if
  anything failed — so Task Scheduler never shows success for a backup that did
  not happen. Node.js is not required.

---

## Where backups go

`Documents\Posnic-Backups` by default, one folder per backup, named by date and
time. Changeable in *Backup Manager → Settings*.

**A backup on the same disk as the original is not a backup.** It survives a
mistake — a bad import, a deletion, a failed update. It does not survive the
thing most likely to end a shop's records: the disk failing, the machine being
stolen, or ransomware encrypting everything it can reach.

The default location is deliberately inside `Documents`, because that folder is
what OneDrive, Google Drive and every consumer backup tool already syncs. If
none of those is set up, copy the folder to a USB drive on a schedule somebody
actually keeps.

---

## Retention

30 days by default, configurable from 1 to 365. Older backups are deleted
automatically when a new one succeeds — never before, so a failed backup cannot
leave a shop with fewer copies than it had.

---

## Restoring

*Backup Manager → History* → choose a backup → **Restore**.

Restoring replaces the current contents of the database with the contents of
the backup. Anything recorded after that backup was taken is gone. The
confirmation says so, and it is worth reading rather than clicking through:
restoring last night's backup at four in the afternoon discards a day of sales.

### After an update went wrong

Every update takes a forced backup immediately before the installer runs, and
cancels the update if that backup fails. So there is always a copy from
immediately before the version that caused the problem. See
[RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md) for the full rollback order — restoring
data is the last resort, not the first, because the earlier options do not
discard anything.

### Onto a different machine

Install Posnic, complete the setup wizard so a database exists, then restore.
The new installation uses its own database credentials; the backup carries data,
not credentials.

---

## What this does not protect against

Stated plainly, because a backup policy that implies more than it delivers is
worse than none.

- **A backup nobody has ever restored.** Untested backups fail at the moment you
  need them. Restore one onto a spare machine at least once, and again after any
  change to where they are stored.
- **Ransomware that reaches the backup folder.** If the folder is on the same
  machine and writable by the same account, it encrypts with everything else.
  An off-machine copy is the only answer.
- **A disk that fails between backups.** The window is however long since the
  last one ran — up to 24 hours on the default schedule.
- **Someone with administrator rights on the machine.** They can delete backups
  as easily as data. See [SECURITY.md](../.github/SECURITY.md).
- **Theft of the computer.** Backups on the same disk leave with it. Device
  encryption protects the contents; it does not give you a copy.

---

## Recommended minimum

For a shop with one till and no IT support:

1. Leave automatic backups on, daily.
2. Set up the Windows scheduled task so backups happen when the till is off.
3. Point the backup folder at a location that syncs off the machine, or copy it
   to a USB drive weekly.
4. **Restore one backup onto another computer once**, so you know it works and
   you have done it before the day you need it.
5. Turn on device encryption and keep the recovery key somewhere other than the
   till.

Steps 2 and 4 are the ones usually skipped, and the ones that decide whether a
bad day is an inconvenience or the end of the records.
