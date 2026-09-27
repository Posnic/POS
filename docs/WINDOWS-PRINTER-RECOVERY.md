# Windows thermal printer recovery

Windows accepting a RAW job is not evidence that paper came out. Previously
`sendRawToPrinter` returned success as soon as `EndDocPrinter` succeeded. An
offline USB printer could retain that job and print it much later. Resending
after a timeout could add another copy.

The Windows ESC/POS path now uses `windows-print-queue.js` around the existing
resident `raw-print-service.js` writer. Receipts, kitchen tickets, roll reports
and queued floor bills keep their current byte renderers and cut commands.
Linux/macOS CUPS printing and sheet/PDF rendering are unchanged.

## Configuration and diagnosis

Hardware Manager → Receipt Printer → **Windows printer health & recovery**
shows both receipt and kitchen queues, current Windows/PnP status, and recent
job states. Configure the exact Windows queue name, expected port, and,
optionally, its physical USB/USBPRINT instance ID. Nothing depends on a
particular computer name, driver name, or USB port number.

Absent an explicit binding, the queue's current port and physical instance
are recorded on first observation. Existing jobs keep their original binding
when settings change. A mismatched port/device stops that job for review;
the application does not move, rename, or substitute printers. Printer
pooling is refused because it can route a ticket to another device.

USB presence is checked with Windows PnP, mapping USBPRINT's device-specific
`PortName` to the configured queue. A persistent SWD PrintQueue instance, or
another printer with the same driver, does not prove physical presence.
Only currently present matches are eligible. Unknown mappings and enumeration failures wait safely for another check; ambiguous or stale bindings remain distinct and never choose another device automatically.

The helper attempts to clear `WorkOffline` only when the matching device is
present. It uses the current user's permissions. If Windows refuses this
change, the app reports the refusal; it does not request elevation, change
security settings, or restart the spooler.

## Job lifecycle

- **Waiting:** saved locally, waiting for an earlier job or initialization.
- **Printer offline:** device disconnected, Windows offline/error, or a failed
  spooler job blocking the queue.
- **Queued:** submitted to Windows, still being monitored.
- **Sent to printer:** Windows released an accepted job without a known error.
  This is not confirmation of physical paper output.
- **Failed:** retry budget exhausted, configuration/permission problem, or an
  uncertain outcome requiring a person to check the paper.

Every copy has an immutable local ID and unique Windows document name. The
KOT delivery key/copy index and floor bill request ID are reused on retries.
Receipt callers may supply `options.jobId`; otherwise the receipt content
identifies the request. An intentional additional receipt requires a new
request ID. A repeated request cannot change the original destination.

Only one job per printer is processed at a time. Before sending, Windows
queue status and existing failed jobs are checked. `ESC @` (1B 40), with no
feed or cut, initializes the printer; readiness is checked again after a
brief wait. The initialization has its own non-printing spooler document.
The unchanged receipt bytes follow only after that document has left the
queue. Initialization can be disabled for a non-ESC/POS device.

Transient offline/error checks back off for 2, 5 and 10 seconds. Exhausted,
unsubmitted jobs remain saved and can resume when readiness returns. A job
already submitted is never submitted again automatically, even if its helper
times out. The original Windows job is located by its unique document name
and spooler ID and continues being monitored.

After an application restart, an existing spooler job is followed. If a job
vanished during the restart, or disappeared after an observed error, its
outcome is uncertain. It is marked Failed for review, not printed again.
This deliberately favors preventing duplicate KOTs over guessing whether an
unobserved job reached paper. Unrelated Windows jobs are never deleted.

## Persistence and logs

State and pending payloads live in `userData/windows-print-queue`, outside the
installation directory. Job state is flushed and atomically replaced before
submission. Successful jobs retain their deduplication record; their receipt
payload is removed. Corrupt state fails closed instead of resetting history.

Health checks run every two seconds while jobs are active, or every fifteen
seconds when idle. Reading Windows status alone does not contact the USB
printer; the resident helper's own ping only checks its process. Neither
previous check kept an idle USB printer active.

Idle keep-alive is enabled by default for configured USB ESC/POS queues,
and can be disabled in Hardware Manager. After at least 30 seconds quiet,
the same RAW writer sends only `ESC @` (1B 40), without feed, text, or cut.
It requires verified USB presence, matching port/device, an empty Windows
queue, and primary printer status explicitly Idle. Extended Idle (3) or Unknown (2)
is accepted for drivers such as POS-80C; unknown primary or busy status
is not permission to reset a printer's buffer. Initialization disabled also
disables keep-alive. This is not a bidirectional status acknowledgement.

Idle commands and receipts share one per-printer lock. A durable record in
`keep-alive.json` tracks each idle command before submission; an existing
or uncertain command prevents another, including after restart. An unknown
submission blocks new receipts for review rather than risk a delayed reset
in the middle of a receipt. Reconnected devices are rechecked and WorkOffline
is cleared using normal user permissions before sending anything. Hardware
Manager shows the last keep-alive attempt/status. The existing Electron
system-sleep blocker stays in place; display blanking is allowed. No global
USB power policy is changed.

Status changes log the timestamp, queue,
port, physical instance/presence, Windows status, spooler IDs and retry count.
`health.log` rotates at 1 MiB with three archived files. It contains metadata,
not receipt content. Pending payloads are retained for restart recovery.

## Verification

`node --test tests/windows-print-queue.test.js` exercises online, sleeping,
disconnected and reconnecting devices, retries/exhaustion, restart ambiguity,
concurrent duplicates, existing errored jobs, initialization, and routing
isolation. Existing KOT, receipt formatting, IPC and raw-helper tests cover
the integration. Idle tests also cover interval limits, disabled settings,
busy/unrelated jobs, receipt arrival during a pulse, lost helper responses,
restart, reconnect and destination isolation. No test needs to send paper
to a physical printer.

The USB extender/cable can still disconnect the device electrically; software
cannot repair that. Validate the affected installation after an idle period,
through a disconnect/reconnect and an application restart. One KOT should
arrive once; the queue's “Sent to printer” remains a Windows observation.

Windows references: [Win32_Printer properties](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-printer)
and [Get-PnpDevice](https://learn.microsoft.com/en-us/powershell/module/pnpdevice/get-pnpdevice).

## Discovery correction and old job recovery

The health probe reads the configured queue and matches its port to currently present physical USBPRINT devices. Historical registry entries are not evidence of presence. A single present match is usable; multiple present matches, enumeration failures and missing mappings remain distinct. A saved physical instance ID never silently changes to another device. Expected ports remain frozen per job.

The queue retries temporary discovery failures with its existing 2/5/10-second delays, then waits for recovery. Startup, background polling and repeated enqueue can migrate only the exact old USB identification failure when the durable record explicitly says it was never submitted and has no accepted, observed or spooler-ID evidence. The original ID and bytes are retained. Submitted or uncertain jobs are never replayed because an empty spooler does not prove non-delivery.

## What the shopkeeper sees

Open **Hardware Manager → Receipt Printer → Windows printer health & recovery**. Check the printer queue, expected port, physical identity, current discovery result and job status. A stale binding needs the physical printer and port checked before saving a new binding; existing pending jobs retain their original destination.

The same section audits the current Windows power plan, read-only, at most once per minute. Enabled or unavailable settings display instructions:

- For a dedicated counter, keep mains power connected. In **Control Panel → Power Options → Change plan settings**, set **Put the computer to sleep** to **Never** while serving.
- Under **Change advanced power settings → Sleep**, check **Hibernate after**. Battery settings have a battery-life tradeoff.
- For USB disconnections after idle, temporarily test **USB settings → USB selective suspend → Disabled**. Restore the setting if it does not improve the fault. Microsoft normally recommends selective suspend remain enabled; this is an isolation step, not a universal requirement.
- If necessary, inspect the printer's USB hub in **Device Manager → Properties → Power Management**. Where available, temporarily clear **Allow the computer to turn off this device to save power**, and restore it if ineffective. The app cannot verify every hub/firmware setting or organizational policy.

No power plan, driver, port, Windows security setting or spooler service is changed by this audit. Screen lock is different from system sleep. The app's existing power blocker does not prove USB hardware stays connected.

## Remove the diagnostic helper before testing

The separate `posnic-printer-keepalive.ps1` in the diagnostic handoff is not part of the product. Stop that helper and remove its shortcut from the Windows Startup folder (`shell:startup`) on the affected computer. Do not stop all PowerShell processes or delete unrelated shortcuts. Hardware Manager warns when the helper is detected, and optional app idle commands are suppressed while it is running or the audit is unavailable. This patch does not remotely remove diagnostic scripts.

Idle ESC/POS initialization is serialized with the app's print jobs, requires a quiet interval and an empty Windows queue, and accepts the observed POS-80C combination of primary Idle (3) and extended Unknown (2). Unknown primary status still blocks it. ESC @ resets printer state; it is not a documented universal wake command and an empty spooler does not establish that every external writer or physical buffer is idle. Disable idle initialization if unsupported. No paper feed/cut is used for initialization.

## Verification on the affected counter

Do not replay diagnostic job metadata or actual orders. Keep a record of the selected reception/kitchen queues and their existing ports. After removing the separate helper, use a clearly labelled test ticket:

1. Print once to each destination and verify the physical destination and formatting/cut.
2. Leave the counter idle for its usual failure interval. Record discovery status and power settings, then print a fresh test ticket.
3. Disconnect/reconnect the kitchen USB connection with one new test job pending. Verify one physical copy after reconnect and no reception reroute.
4. Repeat the same idle interval with the kitchen printer on a short direct USB cable, then compare with the extender. Record USB arrival/removal times, power and cable/extender model. A repeated physical disappearance despite the software fixes needs this controlled hardware test.

“Sent to printer” means Windows accepted/released the job, not proof of paper output. If the outcome is uncertain, inspect the paper and queue before explicitly requesting a duplicate.

Automated tests use synthetic jobs and mock transports; Windows-only tests execute the actual PowerShell resolver with synthetic device records. They cannot establish that an extender or printer remains physically connected indefinitely.

References: [Microsoft powercfg options](https://learn.microsoft.com/en-us/windows-hardware/design/device-experiences/powercfg-command-line-options), [USB selective suspend](https://learn.microsoft.com/en-us/windows-hardware/drivers/usbcon/usb-selective-suspend).

### Keeping the KOT computer awake and retaining settings

While kitchen printing is running, Posnic holds an Electron system-sleep
blocker. Pausing kitchen printing or quitting Posnic releases it. It does not
move the mouse, prevent screen locking, or send paper to keep Windows awake.
Forced sleep, signing out, shutdown and physical USB loss are not prevented.

For a test upgrade, install the EXE over the existing installation. A manual
uninstall also preserves configuration when **Keep my data** is selected.
Use the same Windows account and application identity. Choosing permanent
**Delete everything** removes settings too; that choice is intentionally
respected. Settings are not stored beside the EXE.

Printer preferences and KOT configuration are now saved by writing and flushing
a temporary file before replacing the existing file. Failed saves report an
error instead of silently claiming success. This protects against interrupted
writes; it cannot recover settings that were already deleted by an old uninstall.
