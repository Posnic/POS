# Clean machine test

The one test that cannot be automated from here, written so it is a checklist
rather than an improvisation.

**Why it exists:** every test in this repository runs on a machine that already
has MongoDB extracted, credentials generated, ports resolved and printers
installed. The first run on a machine that has none of that is the only run
every single customer performs, and it is where installers fail.

**You need:** a Windows 10 or 11 machine, 64-bit, that has never had Posnic on
it. A fresh virtual machine is fine and is easier to reset between attempts —
take a snapshot before you start so you can run this more than once.

Record the result in the release checklist or release issue when done.

---

## Before you start

- [ ] Snapshot the machine, so a failed run can be repeated cleanly
- [ ] Note the build under test: version, and whether it is signed
- [ ] Have a thermal printer connected if you have one — several steps need it

---

## 1. Install

- [ ] Copy the installer over and run it
- [ ] **Note exactly what Windows says.** Unsigned builds show *Windows
      protected your PC* — record whether *More info → Run anyway* is needed
- [ ] Install completes without an error dialog
- [ ] A desktop shortcut and Start menu entry appear

## 2. First launch

This is the step that most often breaks, because it does work no later launch
repeats — extracting the database, deriving ports, generating credentials.

- [ ] Application starts
- [ ] The loading screen shows progress rather than hanging
- [ ] It reaches the setup wizard **without needing a restart**
- [ ] Time it. Record how long. Anything over five minutes needs investigating
- [ ] Check `%APPDATA%\posnic\app.log` for errors even if it looked fine

## 3. Setup

- [ ] The edition choice screen renders correctly at this screen resolution
- [ ] Choose **Community Edition**
- [ ] Complete the wizard: shop name, admin account, currency, first branch
- [ ] It finishes and lands on the login page, not an error
- [ ] Log in with the admin account just created

## 4. A real sale

- [ ] Add a category
- [ ] Add an item with a price and a quantity
- [ ] Open the cash register with a float
- [ ] Make a sale, take cash, confirm change is right
- [ ] Stock went down by the quantity sold
- [ ] Close the register and check the expected total matches

## 5. Printing

The path that changed most recently — the print document is now served from the
local API rather than embedded in the page, so this is worth doing carefully.

- [ ] Print a receipt. It prints, and is legible
- [ ] **The shop logo appears** if one is configured
- [ ] **The layout is styled**, not plain unformatted text
- [ ] Print an A4 invoice or report; check the same two things
- [ ] Check `app.log` for `local print route` or `inline document` — either
      prints, but note which was used
- [ ] If you have a kitchen printer, print a KOT ticket

> Unstyled output or a missing logo means the print route fell back and the
> fallback is also failing. Capture `app.log` and stop — this is exactly what
> this step exists to catch.

## 6. Backup and restore

- [ ] **Backup Manager → Backup Now.** It completes and the folder appears
- [ ] Make another sale, so there is something to lose
- [ ] Restore the backup. The second sale is gone, the first is there
- [ ] Set up the scheduled task: *Settings → Backups when Posnic is closed →
      Show me the command*
- [ ] Close Posnic entirely
- [ ] Run the task: `schtasks /Run /TN "Posnic Backup"`
- [ ] `schtasks /Query /TN "Posnic Backup" /FO LIST /V | findstr "Last Result"`
      shows `0`, and a new backup folder exists — **with the app closed**

## 7. Offline

- [ ] Disconnect the network entirely
- [ ] Close and reopen Posnic. It starts normally
- [ ] Make a sale and print a receipt
- [ ] Reconnect

Nothing here should depend on the network. If anything hangs waiting for it,
that is a finding.

## 8. Update

Needs a published release newer than the installed build. If there is not one,
say so and leave this section unticked rather than skipping it silently.

- [ ] *Updates* shows the current version
- [ ] **Check Now** finds the newer release
- [ ] The release notes are shown, and readable
- [ ] Turn *Check for updates automatically* off; reopen the window; confirm it
      does **not** check on its own
- [ ] Turn it back on
- [ ] Let the update download
- [ ] **Close Posnic.** The update installs on close
- [ ] Reopen. The version is the new one, and the shop's data is intact
- [ ] A backup was taken immediately before the update — check the history

## 9. Rollback

- [ ] Turn automatic updates **off** first, or it will update straight back
- [ ] *Updates → Going back to an earlier release → Open the releases page*
- [ ] Download the previous installer and run it **over the top** — do not
      uninstall first
- [ ] It installs, opens, and the data is still there
- [ ] The version shown is the older one

## 10. Reinstall and uninstall

- [ ] Reinstall the current version over the top. Data survives
- [ ] Uninstall, choosing to **keep** data. Confirm these still exist:
      - `%APPDATA%\posnic\mongodb`
      - `%APPDATA%\posnic\.mongodb-credentials.json`
      - `Documents\Posnic-Backups`
- [ ] Reinstall. The existing shop and its sales come back
- [ ] Uninstall again, this time choosing to **delete** data. Confirm those
      paths are gone

---

## What to record

For each section: pass, fail, or not tested — and for anything that is not a
clean pass, the log excerpt. "Mostly worked" is not a result.

Attach:

- `%APPDATA%\posnic\app.log` from the whole run
- The Windows version and build number
- Whether the installer was signed
- Timings for first launch and for the update

## If something fails

Stop and record it before fixing anything. A failure that is fixed before it is
written down is a failure that will be rediscovered by a customer, because
nobody will remember it was ever conditional.

Then reset to the snapshot and start again from Section 1 — a machine that has
had a half-installed Posnic on it is no longer a clean machine, and the second
run would prove nothing.
