# Windows KOT delivery confirmation

## Acknowledgement boundary

A KOT is acknowledged to `markKitchenPrinted` only after every configured
printer and copy has confirmed spooler acceptance. This confirms that Windows
created a print job; it does **not** prove that paper physically emerged.

Each logical KOT retains its existing immutable `kotJobKey` / `kotFallbackKey`.
Its delivery plan freezes the configured printers and copy counts. Each copy
uses a deterministic document name derived from that key and its copy index.
Successful copies are retained in the local ledger and are not resent when
another printer fails. An attempt is saved before sending the copy.

## Submission and recovery

- Preflight checks the exact Windows printer name, WorkOffline/status and,
  for a USB port, registered port and available PnP device information.
  Missing/offline destinations remain pending with a retry delay starting at
  30 seconds and increasing to five minutes. No default-printer fallback is
  allowed for a named destination.
- RAW printing returns the positive job ID from `StartDocPrinter`. This is
  direct evidence of creation even when a fast job disappears from the queue.
- Electron callback success alone does not acknowledge a KOT. The verifier
  checks the exact printer queue for the deterministic document name for up
  to five seconds after submission. Individual Windows inspections have a
  five-second process timeout, so total wall time can exceed five seconds.
- A matching existing job is reused; another copy is not submitted. An
  existing blocked/error job remains pending for printer intervention.
- If a submission's outcome is uncertain, it stays pending and automatic
  resubmission is suppressed. Subsequent polls can reconcile a matching queue
  job. A fast Electron job can disappear before a snapshot observes it; this
  deliberately produces an uncertain result rather than a false success or
  a duplicate. Check the printer queue and actual ticket before manually
  requesting another copy.
- Spooler inspection failures before submission are retryable. Exceptions or
  timeouts after submission are uncertain. A callback failure is not proof
  that Windows created no job.

Results carry `printerName`, `jobId`, `state`, `submitted`, `error`, and
`retryable`, alongside the existing `success`/`status` compatibility fields.
`submitted` distinguishes the submission acknowledgement from verified
spooler creation; only a verified successful result has state `spooled`.
Legacy already-completed ledger entries are preserved and may have no job ID.

## Temporary PDFs

Generated Posnic PDFs are retained for at least five minutes after submission
returns, including error cases. Cleanup runs on startup and retention timers.
It removes only aged regular files matching the Posnic print PDF prefixes in
the selected temporary directory. It does not recurse or follow symlinks.
Files Windows still holds are left for a later cleanup. This avoids deleting
the PDF immediately while the print service may still need to open it.

## Scope and limitations

Windows printer connectivity information depends on the installed driver.
Preflight rejects offline/disconnected states Windows reports; it cannot
guarantee physical connectivity when a driver reports stale online status.
Spooler confirmation likewise cannot guarantee ink, paper, cutter operation,
or delivery after Windows accepts the job. A printer disconnected *after*
acceptance may retain its job in the Windows queue.

The interactive invoice/report PDF chooser is separate from the automatic
KOT delivery ledger. Closing that chooser is not used to acknowledge a KOT.
macOS/Linux retain their existing printing paths; this change does not add
Windows job IDs to those platforms.

## Automated and hardware verification

`tests/windows-spooler-confirmation.test.js` covers missing/offline printers,
absent USB ports/devices, callback success without a matching job, direct RAW
job IDs, concurrent/repeated requests, blocked jobs, reconnect printing one
copy, PDF retention, packaging, and no server acknowledgement for uncertain
KOTs. Existing KOT tests cover multiple printers/copies, restart recovery,
failed cancellations, and prohibiting fallback to the default printer.

Before releasing to the hotel, verify on its Windows till:

1. Configure Kitchen_Printer and Reception_Printer, with reception as Windows
   default. Submit one test KOT and verify its recorded kitchen spooler job ID.
2. Disconnect kitchen USB or set Work Offline. Submit a new KOT. Confirm it
   remains pending, no kitchen acknowledgement is sent, and reception is silent.
3. Reconnect, wait for the retry interval, and confirm exactly the configured
   number of copies. Restart the till and confirm no extra copy appears.
4. With two kitchen destinations, fail one and verify that only the outstanding
   destination/copy is retried. Repeat with the API acknowledgement unavailable.
5. Exercise the Electron path with non-RAW content. Check the matching document
   name/job ID; a missing observation must remain pending, never report success.
6. Exercise PDF printing and inspect the temporary file before and after five
   minutes. Check PrintService events for recurrence of event 372 / Win32 error 2.

Automated tests use controlled queues and do not establish physical-printer
compatibility. These hardware checks are still required.
