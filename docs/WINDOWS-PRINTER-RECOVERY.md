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
Unknown mappings stop safely and ask for an explicit physical instance ID.

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
queue, and both printer statuses explicitly Idle. Busy or unknown status
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
