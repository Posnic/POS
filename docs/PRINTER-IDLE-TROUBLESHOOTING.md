# Printer stops after being idle

In the desktop app, open **Desktop → Hardware diagnostics → Receipt Printer →
Printer readiness & idle troubleshooting**. This section is open by default.
It checks this computer without changing settings or producing paper. Results
refresh while the page is open; system checks can be up to one minute old.

- **Detected** is an observation, not a guarantee of paper output.
- **Review** identifies something worth checking; it is not proof of the cause.
- **Could not verify** means a tool, permission or hardware-specific check is
  unavailable. Follow the manual steps instead.

Keep Posnic running and kitchen printing enabled during service. Posnic requests
system-sleep prevention while KOT is active. Screen locking is allowed. Closing
a laptop lid, forced sleep, signing out or shutting down can interrupt service.
Check that the readiness section says sleep prevention is active when expected.

## Windows

1. Open Control Panel → Power Options → Change plan settings → Change advanced
   power settings. Check Sleep and Hibernate for the active plan.
2. Under USB settings → USB selective suspend, record the current value.
   Desktops may show only **Setting**, while laptops show **Plugged in** and
   **On battery**. If idle disconnects occur, temporarily test **Disabled** for
   the power source in use. Restore the original value if it makes no difference.
3. If USB settings is absent, check the affected USB hub in Device Manager →
   Properties → Power Management, if available. Do not change every hub.
4. Open Windows Settings → Printers & scanners → the correct printer's queue.
   Check offline/paused status and existing jobs before trying again.

Microsoft recommends keeping selective suspend enabled normally. This is a
controlled diagnostic test, not a recommendation to disable it on every till.
[Microsoft USB power guidance](https://learn.microsoft.com/en-us/windows-hardware/drivers/usbcon/usb-selective-suspend)

## macOS

1. Connect the Mac to power and keep a laptop's lid open while serving.
2. In System Settings → Battery → Options (laptops), or Energy (desktops), look
   for **Prevent automatic sleeping when the display is off**. Wording and
   availability vary with the Mac and macOS version.
3. Open System Settings → Printers & Scanners → your printer → Printer Queue.
   If paused, check paper, cover and connection before resuming.
4. macOS has no universal USB selective-suspend switch. Check the printer manual
   for sleep/auto-off settings. Test a short direct USB connection when needed.

Posnic reads the reported sleep policy and CUPS queue state. These do not prove
that a physical USB printer is connected or that a queued page reached paper.
[Apple sleep settings](https://support.apple.com/guide/mac-help/set-sleep-and-wake-settings-mchle41a6ccd/mac)

## Linux

1. Open your desktop's Power settings and check Automatic Suspend while plugged
   in. GNOME, KDE and other desktops have different controls. Posnic can read
   GNOME settings where available; other policies require manual review.
2. Open Printers settings or the CUPS queue. Check paused queues and whether the
   queue accepts jobs. Resume after resolving the physical problem.
3. Where accessible, Posnic reads USB printer-class interfaces in sysfs. It
   displays the exact device path, `power/control` and `runtime_status`.
   `auto` permits autosuspend; it does not prove it caused the failure.
4. Ask an administrator to test `power/control=on` for the identified printer
   device only, retaining the original value to restore afterward. Device paths
   can change after reconnect. Do not copy another computer's path or apply a
   global USB change. TLP or other power tools may override temporary settings.

Network printers, vendor-specific USB interfaces and some adapters cannot be
identified this way. Missing USB results are not proof of a disconnected printer.
[CUPS queue checks](https://www.cups.org/doc/man-lpstat.html) ·
[Linux USB power management](https://docs.kernel.org/driver-api/usb/power-management.html)

## Test one change at a time

Outside service hours, send one test ticket, wait through the usual idle period,
then send one new test ticket. Repeat under the same conditions after changing
one setting. Keep the original settings and restore any change that does not
help. If USB still disappears, compare with a short direct cable, bypassing the
extender. Also check printer power, paper, cover and its firmware sleep settings.

**Do not repeatedly press Print while a ticket remains queued.** Existing jobs
can print after reconnecting or resuming a queue. Do not clear unrelated jobs.
A wake command cannot repair an unplugged cable or a failing extender.

The readiness checks are available on all three desktop OSes. Windows-specific
USB recovery and spooler retry controls remain Windows-only; these diagnostics
do not add automatic CUPS retries or automatic OS power-setting changes.
