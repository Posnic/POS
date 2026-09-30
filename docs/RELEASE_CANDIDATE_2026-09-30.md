# Next release preparation — 30 September 2026

Status: local Windows verification build; not approved for public release.

Test installer: `D:/Posnic-builds/release-test-2026-09-30/Posnic-1.8.4-release-test-20260930-windows-x64-installer.exe`.
Its application version remains 1.8.4. The filename distinguishes it from older
test installers. No tag, public release, or automatic update was published.

## Draft customer-facing notes

- Kitchen screens show per-item quantities still cooking, ready to collect,
  and picked up. Served quantities leave the screen without hiding other food
  on the same order. Ready tickets no longer flash as overdue.
- Cancelled quantities appear crossed out with a clear cancellation notice.
  Choose how long to keep them visible (1–300 seconds, default 30), and whether
  the border pulses. Refreshing does not restart the notice timer.
- Choose automatic, one-column or two-column portrait layouts, item font size,
  optional soft text glow, oldest/newest order sorting and page rotation timing.
  Oldest first remains the default.
- Captain-entered preparation amounts, such as fish for 500, now reach automatic
  kitchen tickets, existing-order additions and the kitchen display. Browser KOT
  printing also shows these amounts. Regular catalogue prices stay hidden.
- Refresh buttons match the active theme. Captain device approval and management
  actions have consistent spacing on narrow and wide screens.
- Includes the earlier local security hardening for tenant access, query filters,
  and backup controls. Detailed vulnerability information stays in the private
  review process until release coordination is complete.

## Build contents and evidence

The build uses the security-reviewed source snapshot at
`D:/Posnic-builds/security-review-2026-09-30/source`, updated with the kitchen and
toolbar changes from `codex/captain-toolbar-polish`. Existing outlet/room
identification is preserved. This combined snapshot is not a single clean
release commit yet.

- Frontend asset compilation passed.
- 83 desktop tests passed against the assembled snapshot, including kitchen
  display, touch board, print amount and backup security checks.
- 157 API tests passed across five suites covering kitchen service, readiness,
  new and amended orders, and preparation amounts.
- Packaging, runtime, file hashes and installer signature results are recorded
  beside the installer in `build-verification.json` after the build completes.
- No physical print, production installation, real order replay, database reset,
  or production app termination was performed during this build.

## Owner verification

1. Back up the test shop and install this specific EXE. Verify startup, login,
   existing sales and customer records. Open Hardware Manager and its log controls.
2. From Captain on the local network, create a new fish order with an entered
   amount of 500. Verify the amount on the automatic physical kitchen ticket and
   wall display. Add another custom-priced item to the same order and check the
   additional ticket. Check a regular-price item does not gain a price label.
3. On the touch board, mark one of several portions ready. Verify Cooking and
   Ready quantities on the wall. Collect with Captain, verify Picked up, then
   serve. Only the served quantities should disappear. Ready food must remain
   until collected/served. The optional three-second Served confirmation is
   not included; serving removes the quantity immediately.
4. Cancel part of an order, then a whole order. Confirm the crossed-out notice,
   timer and pulse option. A normal served item must never appear cancelled.
5. Check portrait one/two columns and landscape, long item names, font sizes,
   glow, oldest/newest sorting and 3/20-second page rotation with enough orders
   for multiple pages. Test connection loss/recovery without replaying prints.
6. Test a new receipt and KOT on both USB and LAN printers after cold startup
   and idle time. Record physical output separately from software/spooler status.

## Before public release

- [ ] Owner confirms the above tests and records the exact installer checksum.
- [ ] Consolidate the security, outlet and kitchen changes into reviewed source;
      ensure the release branch reproduces this combined build. Do not publish
      directly from an uncommitted staging directory.
- [ ] Promote the reviewed changes to main through the normal process; all
      required checks and code-scanning findings must be resolved.
- [ ] Assign the release version under RELEASE_RUNBOOK.md. These added features
      suggest a minor release (1.9.0 if the platform dependencies are unchanged).
      Check the final main dependency diff before deciding. Make the version bump
      its own commit; no final release version has been assigned by this build.
- [ ] Rebuild the exact release commit and require a valid Windows signing
      certificate. An unsigned local test installer is not a signed release.
- [ ] Produce the release SBOMs, SHA256SUMS and provenance attestations, and
      verify they describe the exact packages. Local test hashes are not provenance.
- [ ] Review the draft notes, all supported platform artifacts, update manifests,
      and the download-page changes before publishing.

Follow [RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md) and
[VERIFY_RELEASE.md](VERIFY_RELEASE.md) for publication and rollback procedures.
