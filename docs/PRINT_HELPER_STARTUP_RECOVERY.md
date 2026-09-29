# Print helper startup recovery — 1.8.4 incident

## Confirmed cause and limits

Both Reception (USB004) and Kitchen_New (192.168.1.201:9100) depended on the same app-owned raw-print helper. The old eight-second startup timeout rejected `ready` but did not clear it or retire its live child. `_ensure()` then returned that rejected promise for subsequent calls. Separate error/exit handlers also lacked child-generation checks. Initialization discarded the underlying failure and displayed a Windows-queue error.

This explains the persistent software outage and why restarting only the helper restored submissions. It does **not** establish why the initial startup deadline was missed. No hardware, network, USB-sleep or Windows-spooler cause is claimed.

## Changes

- Explicit stopped, starting, ready and backoff lifecycle; one promise per startup attempt.
- On timeout/error/early exit, settle callers, clear startup timer/promise, retire that generation and back off. Wait for its exit before replacement. Late output/error/exit events cannot affect another generation.
- Startup deadline is now 20 seconds for cold PowerShell/Add-Type work, with bounded restart delays (250 ms to 30 seconds). A longer deadline is not the repair: cleanup and fresh attempts remove the rejected-promise trap. Repeated callers cannot bypass backoff.
- Resolve Windows PowerShell from SystemRoot/System32 (Sysnative for a 32-bit process on 64-bit Windows), not PATH. Capture phase, executable, PID, generation, elapsed time, deadline, bounded stderr and failure reason. A normal shutdown is not logged as a helper failure.
- Heartbeat is JSON ping only, opening no printer and sending no printer bytes. Skip heartbeat while receipts are pending. A ping timing out after a receipt arrives must not kill that receipt.
- Before stdin write, failure is `not-submitted`. After write is attempted, timeout, pipe failure, exit and partial/ERR replies are `uncertain`. The helper can explicitly report `NOTSENT` for failures before spooler acceptance. An OK reply supplies a spooler ID, not physical-print evidence.
- Queue retries verified pre-submission failures using its existing three delays, then stops for operator recovery. Failed initialization preserves the helper's actual diagnostic instead of blaming the Windows queue.
- Optional wake/idle jobs have a 30-second receipt-blocking window. Actual Windows queue errors still block printing. An ambiguous idle pulse is suppressed, not replayed. Failed outstanding receipt jobs suppress additional idle traffic.
- Hardware Manager shows helper state/diagnostics and a per-job **Retry verified unsubmitted receipt** control. It reuses the original ID, bytes and frozen printer binding. Accepted, observed, uncertain and successful receipt deliveries are ineligible. Legacy exact initialization/unavailable failures require persisted `submitted:false`, no acceptance/observation/spooler ID, and an existing payload; queue emptiness alone is never evidence.
- Printer names, IP addresses, ports, bindings and spooler configuration are not changed.

## Verification

107 tests passed across raw-print-lifecycle, windows-print-queue, raw-print-helper-stays-warm, the-printer-helper-never-sleeps, kot-multi-printer-recovery and windows-printer-discovery. Coverage includes deadline races, never READY, synchronous/asynchronous spawn failure, early exit, concurrent cold USB/LAN requests, stale child events, delayed child exit, bounded restarts, stdin failure, idle/active heartbeat failure, shutdown, uncertain outcomes, persisted recovery and preservation of successful Reception copies.

Lifecycle failures and the two-printer submission sequence use injected child processes/transport; they do not send real orders. Existing Windows smoke tests use a separate test helper, paperless ping and a nonexistent printer. A separate real-helper smoke check reached READY in 350 ms and answered a no-print ping. All local packaged requires are included (69 modules checked).

The original customer's cold-start timing and physical output on Reception/Kitchen_New are not verified by these tests. No production app was closed, installed archive patched, real order replayed or Windows spooler reset.

## Deployment and controlled recovery

1. Review/merge this source change and build a new test installer; it is not in the previously supplied main EXE. Retain a backup of the app's printer recovery records and payloads. Do not delete the queue ledger or overwrite frozen destinations.
2. Arrange an approved maintenance window for a normal app quit and installation. Do not force-close an app with active print jobs. Keep Reception/USB004 and Kitchen_New/192.168.1.201:9100 unchanged.
3. Open Hardware Manager → Windows printer health & recovery. Verify the helper reaches ready and inspect startup diagnostics if it does not. A failed heartbeat/startup alone is not a reason to reset Windows queues.
4. For each failed receipt, check the persisted job status. Use **Retry verified unsubmitted receipt** only when the control is offered. It retries that delivery only; successful Reception deliveries remain protected. Do not recreate a sale or use a bulk reprint to fix its Kitchen delivery.
5. For accepted, partially written or uncertain deliveries, stop and reconcile with the person at the physical printer. An empty Windows queue does not authorize replay. These jobs are excluded from the new recovery control.
6. With approval, perform a uniquely labelled test receipt on each printer after cold app startup, verify exactly one copy at each destination, then test an idle interval. Record software/spooler acceptance separately from the user's confirmation of paper output.

A new installer and production rollout remain separate actions. No installed application was modified by this source change.
