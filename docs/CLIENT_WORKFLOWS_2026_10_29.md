# Client workflows - 31 October 2026

## Current status
Local implementation and unsigned test EXE only. Cloud deployment and production release review remain pending.

- Price updates: compact branch picker beside heading; all authorized branches selected by default, with saved user preference. Price matching uses SKU and detects missing products, collisions and stale prices. Missing products require Apply to branches. Existing stock is preserved.
- Catalogue sharing: explicit distribution to authorized branches plus an optional default-off automatic policy. New branch products begin at zero stock. Desktop cross-branch changes remain disabled where other branches are not present.
- Categories: independently editable per branch, optional sharing, sort number. POS and price exports order by category sort then numeric SKU.
- Stock adjustment: compact branch/search/category controls, online grid, printable worksheet, Excel import/export, reasons and reviewed stock changes. No Weight/Amount controls on this screen.
- Sale weighing: Weight/Amount and Scale/Manual buttons, Scale default, three-decimal quantities, actual measured price with mismatch confirmation. Physical hardware verification remains pending.
- Checkout: configured redirect timing and focus on product search after sale completion.
- Permission toast: startup low-stock requests respect item-read permission. The client's exact toast still needs account/error details to reproduce.

## Simplified spoilage - current user-approved direction
New entry, products, quantities, reasons/remarks, then Save & update stock. Saving immediately deducts stock for users with inventory write permission. There is no approver setup, draft button, submission or approval step in the interface.

Undo stock deduction asks for a reason and immediately restores stock. Linked history is retained. Duplicate retries cannot apply stock twice. Conflict retries apply only outstanding lines. Excel and daily reports retain quantities, reasons, costs (unknown where missing), actors and timestamps. Daily grouping uses the recorded entry date.

Legacy approval APIs/journal states remain compatible with existing entries. The new UI uses record/apply/undo endpoints. Internal journals remain local; branch-scoped snapshots synchronize read-only. Corrections to a synced record must happen on the originating installation.

## Verification
The previous full-approval build passed 149 local and 11 gateway/agent tests, package/source comparison, native runtime checks and clean-folder startup (31.58 seconds, healthy database/API/setup).

After simplifying spoilage, 13 focused tests passed including actual frontend/backend direct save, repeat save/undo, permission denial, branch isolation, validation and reports. This is not a claim that all 160 were rerun after simplification.

An isolated gateway/cloud-worker/agent replacement test preserved destination stock and metadata without duplicate products. Live two-device synchronization is not certified by this test.

## Release requirements
Deploy matching cloud API and gateway scope changes before new desktop sync lanes. Review and installer acceptance testing remain required before production release. Physical scale tests and the unidentified permission toast remain pending. Test EXEs are unsigned (Windows may show Unknown publisher).

## Verification against the original client DOCX - 31 October

Source: POS System_issues_29_Oct_2026.docx. The file repeats Issue 4 (sorting and stock upload). Later user instructions override its separate approval workflow and product-specific Allow amount toggle.

| Requirement | Local verification |
| --- | --- |
| 1. Selected weight and price | Scale/cart and actual SweetAlert popup tests: three decimals, price calculation, focus-independent capture, no stale replacement-row writes. |
| 2. Return to product entry | Checkout return, print-return timing and search-focus tests. |
| 3. Consolidated branch prices | Actual MongoDB price-sheet/schedule/sharing tests: authorized branches, SKU fan-out, stale price rejection, missing/colliding items, zero prices, duplicate requests, stock unchanged. UI tests exercise grid and file review; test fixture updated for expansion endpoint. |
| 4. Category/SKU order | Configurable category sort, numeric SKU and name ordering; foreign category isolation and category sharing tests. Exact customer order requires saved category sort numbers, not hardcoded client names. |
| 4. Bulk stock | Workbook download/edit/upload, zero counts, precision, branch/revision/formula checks, per-line reasons, review, idempotent confirmation and result workbook. |
| 5. Spoilage | Multi-item entry, permission/scope checks, invalid/over-stock/duplicate prevention, direct Save and Undo, immutable audit records, daily/Excel reporting. Later user instruction removes approval from the UI. |
| 6. Weight/Amount | Scale/manual controls, scale default, amount target, actual measured billing and mismatch confirmation; parser/protocol safety tests. Actual physical model remains unverified. |

Final rerun: 191 application tests passed, 11 gateway/agent tests passed, zero failures. Isolated gateway/cloud-worker/agent replacement exercise also passed. These are local tests, not certification of live cloud/till networking, physical printers/scales or every installed-window layout.

New reporting checks cover opening stock, received quantities, sales, other increases/decreases and closing stock for products with spoilage. Reversals subtract loss valuation instead of adding it. Incomplete historical ledgers produce Unavailable, never current-stock guesses. Totals describe the selected period and repeat on multiple entries for the same item; they are not additive across those repeated rows.

Cloud rollout is still pending. The unidentified client permission toast still needs the account/error details. No live production records were modified in this verification pass.

## Installed desktop verification - 31 October (manual hardware substitute)

Installed the test EXE into the normal branded-desktop program directory and used an isolated local test profile (`outputs/branded-desktop-installed-manual-2026-10-31`). Cloud sync was disabled before sales/stock testing. A cloud activation had occurred during initial setup; this run is not a live cloud verification.

Native desktop tests passed:
- Weighed tile opens the compact popup before adding a line. Scale is selected initially; Manual accepts 0.605 kg at 50/kg and shows 30.25.
- Requested amount 30 with actual 0.605 kg requires explicit confirmation of 30.25; confirmation adds one cart row.
- Local cash sale saved at quantity 0.605 and total 30.25. Stock changed from 100 to 99.395. Automatic New Sale return worked; typing without clicking entered product search.
- Online stock grid: 99.395 -> 99 with a reason, review and confirmation; installed API confirms stock 99.
- Spoilage direct save: 0.125 deducted, stock 98.875; actor, time, remarks and cost retained.
- Installed HTTP XLSX flow: downloaded filtered sheet, edited New stock/reason, uploaded, and received prepared review. Stock remained unchanged before confirmation.
- Installed day-end API: opening 100, sold 0.605, other out 0.395, spoilage 0.125, closing 98.875; sale amount 30.25 and quantity 0.605 persisted.

Defects found and corrected during actual desktop testing:
- Tile and cart By amount paths did not use the new popup. Both now share Scale/Manual and Weight/Amount.
- Electron does not support window.prompt; spoilage Undo now uses the bundled app dialog with required reason.
- Empty overview panels pushed active stock/spoilage forms below the viewport. These panels are hidden while an editor is active.

Focused regression reruns passed: 16 checkout/search/unit tests (including the new tile test), and 13 spoilage/inventory tests (including a UI-to-service undo with window.prompt deliberately unavailable). Package verification passed. This supplements, rather than replaces, the earlier 191+11 test run.

Not certified by this local run: physical scale/printer, live multi-branch cloud synchronization, unidentified client permission toast. Additional unrelated observations to track separately: modern /api/users/login returned an undefined HTTP status while the actual desktop legacy login worked; sample product images disappeared after an installer update. These observations mean this is not a claim that every application function is defect-free.

Final native retest: Undo displayed the app dialog, accepted the reason, restored stock from 98.875 to 99, and retained original plus reversal records. The final installed layout hides the overview panels when editing. Final installer SHA256: 0DC667DB47671DE68B306EFC86CF85DED36DEFF7156FB0A35A1E5A57CA71AA33. The installer in Downloads matches this final build. Local test profile is left open; cloud sync remains disabled for it.

## Remaining fixes completed - final retention/login build

- Modern login now supports the installed http-status package export format. Actual installed API checks returned 400 for missing fields, 401 for wrong credentials and 200 for valid credentials; legacy desktop login also passed.
- Desktop uploads now live under the retained user-data folder. Cloud keeps its existing API uploads location unless POSNIC_UPLOADS_DIR is explicitly configured. API readers/writers and the desktop sync agent resolve the same directory.
- The installer migrates legacy uploads before invoking the previous uninstaller. Runtime migration also supports existing/portable layouts. Both merge without overwriting newer retained files. Fresh-shop recovery includes images; uninstall Keep business data retains them with the database.
- Restored the test profile's demo photographs from the official INR retail dataset without recreating products or changing stock. An actual upgrade preserved all 37 file hashes, and the image endpoint returned HTTP 200. Already deleted customer-specific originals cannot be reconstructed without a backup or a cloud copy.
- Installed testing caught a missing migration-helper package resource; package configuration and package verification now explicitly include it.
- Focused reruns passed: 32 checkout/price/report/retention tests, 63 API/scale/demo tests, 11 gateway/agent tests, plus the four fresh-setup recovery tests. The isolated catalogue propagation exercise also passed. These runs overlap the earlier full test suite; they are not additional unique feature counts.

Production cloud rollout and live two-device network verification are still pending. The synthetic local test profile stays disconnected from cloud. The client's unspecified permission toast still needs the actual account or error to reproduce; the known unnecessary startup request is fixed and tested. Physical scale/printer verification is not substituted by manual entry or parser tests.

Final packaged installer reinstalled without manual resource changes and reopened the native desktop dashboard successfully. Repeated installed checks passed: modern login 400/401/200, legacy login, 37 retained image hashes and image HTTP 200, QA Onion stock 99 kg, spoilage history accessible. The test profile remains cloud-disconnected.

Final EXE: Downloads/branded-desktop-Test-2026-10-31\branded-desktop-1.9.2-verified-fixes-2026-10-31.exe
SHA256: 3F900359EF1896A5FA6C427ECC05F3C2193E0F3A1C4BF5878F3B225027A1A110
This supersedes the earlier hash above. Unsigned local test build; not a production cloud deployment.

## Installed native verification — 1 November 2026

Installed and exercised manual weighing (0.605 kg), amount mismatch confirmation, saved-sale immediate redirect and search focus, price grid and Excel upload, stock grid and Excel upload with required reasons, spoilage save/undo, category sorting, contact updates and day-end reports. Native screenshots and a standalone HTML evidence report are in outputs/desktop-proof-2026-11-01.

Fixed receipt total quantity rounding to two decimals (line and total now preserve 0.605), category sort/description label spacing, and the misleading logo-only Update label (now Save logo). Real reinstall also exposed missing runtime dependencies caused by the build dependency junction; rebuilding with materialized dependencies and explicit package assertions resolved it. The final installed application starts successfully.

135 focused automated checks passed (81 frontend/checkout/report, 42 API price/spoilage/day-end, 12 audit/sharing), plus attribution and package checks. Installed checks confirmed 37 retained image hashes, expected login 400/401/200 responses, stock 97.270 kg, price restored to 50, saved branch/receipt contacts and redirect zero seconds. Two synthetic sales were saved; production was untouched.

Final installer: Downloads/branded-desktop-Test-2026-11-01\branded-desktop-1.9.2-tested-2026-11-01.exe
SHA256: 34B478DF324F82C430B3ADD3F0EC3D8F9A69F28ED328642B5E5955C0E55979CE
This supersedes previous test installers. Physical scale/printer, live cloud deployment/two-device sync, and the exact unidentified client permission toast remain unverified. Multi-branch sharing passed local integration checks, not a live multi-device desktop test.

## Conflict recovery actions — 1 November 2026

Conflict reviews now offer Recount unresolved items and Cancel remaining changes. Recount filters to unapplied products, loads fresh stock revisions, and leaves new counts blank. Cancellation requires a reason for a conflict, permits the author or an administrator with branch/item-write access, refuses processing/completed operations, and preserves applied effects and stocklogs. No blind force overwrite is introduced. Both overview review and the audit review have recovery actions.

Sync decision: inventory_operations remains the existing issuing-server-only effect journal (collections.json exclusion). Cancellation metadata is local to that journal and changes no item balances; recount creates a new normal reviewed adjustment whose item balance and stocklogs use existing sync lanes. No Gateway/agent lane changes or production deployment occurred. Live-device delivery remains outside this local verification.

Verification: 23 mobile inventory integration tests passed, including conflict cancellation, idempotency, processing rejection, another writer denial, and partially applied stock preservation. JavaScript syntax checks passed. These changes require rebuilding/deploying the frontend and API together; the previously shared installer and local running API have not been updated with these conflict actions yet.

## Integrated stock workspace — 1 November 2026

Inventory Logs and Low Stock are now views inside Stock Counts; duplicate sidebar links are removed. Their existing routes remain compatible and activate the corresponding Stock Counts tab. Spoilage entry uses a server-filtered name/SKU/barcode search, category filter, 25-result pages and explicit Add actions instead of a catalogue dropdown. Selected rows are reviewed separately.

Spoilage Excel download and XLSX/CSV upload preview validate branch identifiers, quantities, reasons, duplicate items and available stock before populating the editor. Preview does not write stock; saving uses the existing spoilage record flow. Maximum 200 affected products per entry, 10 MB upload. No new synced collection or schema was introduced; catalogue and preview are read-only, and saved effects retain existing inventory sync lanes.

36 focused API/DOM integration checks plus the workspace navigation check passed. After the final spacing/stale-response changes, all 13 affected spoilage/navigation tests passed again. Installed UI checks covered both embedded tabs, product search/Add, Excel upload and review without saving; the installed API confirmed unchanged stock 97.270 kg. These changes and the conflict-recovery actions above are now packaged together, superseding the earlier note that the installed API lacked them.

Installer: Downloads/branded-desktop-Test-2026-11-01\branded-desktop-1.9.2-stock-workspace-2026-11-01.exe
SHA256: 3F1B79267CCB67BD791A76972CE90C1845B9C99B63DF491296E544EABBCCAFFA
Production cloud was not deployed in this task.

## Pagination and optional spoilage remarks — 1 November 2026

Stock Adjustment now displays 25 rows by default with Previous/Next and 25/50/100 page sizes. Search and category changes reset to page one. Per-item quantity/reason edits remain in the existing in-memory draft across pages, filters and page-size changes; review includes all edits, not just visible rows. Export and print still use the complete filtered selection. Branch changes retain their explicit discard confirmation.

Spoilage line remarks are optional for online entry and Excel/CSV preview; the selected reason remains mandatory. Omitted/null/blank remarks normalize to the existing empty-string field; non-string or over-500-character remarks are rejected. Existing stock logs use the selected reason without an empty trailing colon. Undo/rejection reasons remain required. Existing branch-scoped spoilage_entries and stocklogs synchronization lanes already carry this string field; no schema, new collection or replay behavior changed. Cloud API requires the same code update before blank remarks work there; no cloud deployment is claimed.

15 focused tests passed, including page boundary/size/filter behavior, edit retention, optional-remarks preview and direct stock deduction, and existing spoilage save/undo validation. Physical multi-device sync is not retested by this UI/validation change.

Installed verification: page one showed 1–25 of 31 products and page two 26–31, with Next correctly disabled on the last page. The installed Excel-preview endpoint accepted blank remarks and retained stock 97.270. Screenshot: outputs/desktop-proof-2026-11-01/41-stock-pagination.png.
Updated installer: Downloads/branded-desktop-Test-2026-11-01\branded-desktop-1.9.2-pagination-2026-11-01.exe
SHA256: 1396AB4D653ECA05BF8F1F5B39693764B65CE6E78751F132BC7F3A6A08A90F3D

## Inventory log toolbar — 1 November 2026

Moved the existing Movement dropdown out of the table card into the header alongside search/date filters, Export, Refresh and Filter. Added explicit Export text, consistent spacing and a responsive second row for search fields below 1400px. Verified in the local desktop at 1920px and 1200px; Sales movement filtering still returns the three test sales. Two workspace/navigation tests passed. This is presentation-only: no data, API, branch scope or sync changes. The installed frontend uses the same generated dashboard as this installer build.

### Stock Counts popup and navigation polish — 1 November 2026

Review, stock-adjustment preview and damage View now use a bounded Bootstrap popup. Closing restores the originating list. Product selection has its own popup, leaving selected quantities in the entry form. Native confirm dialogs in this workspace were replaced with application confirmations. Tabs explicitly dispatch their views, fixing the unchanged-route Damage → Inventory Logs failure. Damage history uses a 25-row cursor page with Previous/Next controls and table columns; the API supports bounded page sizes.

Validation: 18 focused tests passed (workspace navigation, popup restoration/discard cancellation, audit edit retention, spoilage operations and a 27-record pagination case). Native installed-app checks covered View/Review popup open/close, product selection, cancel/discard, and Damage → Logs. Test profile only; no production records changed. UI and read pagination changes do not add sync collections or alter inventory write/reversal semantics.

Artifact: branded-desktop-1.9.2-stock-popups-2026-11-01.exe; SHA256 65BF4597BE1707F5A0DE09B0CB0982BA68E8FD46347BB4C9FFE02A97B8015C75.

Final CSS-only table-width polish was copied from the packaged dashboard to the installed application after installer verification. Dashboard SHA256 matches package: 25B16D52A4F4E4BD54C3B440460FD2F9F4105CE728C380B9C25B759DCF2A06EA. Final native screenshot 47 confirms fully visible View actions at 1200px window width.

### Nested reason-input focus correction — 1 November 2026

Bootstrap's active review modal was redirecting focus away from SweetAlert reason inputs. Inventory confirmation dialogs now temporarily suspend that modal's focus handler and restore it after the child dialog settles (including dismissal or failure). Covers cancellation in both operation review paths and spoilage Undo. Five workspace regression tests passed, including nested input focus and restoration. Native desktop verification typed a cancellation reason, submitted an empty reason to exercise validation, retyped successfully, and dismissed without altering the operation. Screenshot: 48-reason-input-working.png.

### Catalogue action context — 2026-11-01
Removed the standalone Apply to branches toolbar button. Copy catalogue to other branches is now under Tools, shown only on cloud accounts with another accessible branch. Local tills hide it without making a policy request. The dialog identifies source, scope and destination branches and explains stock preservation. Five eligibility scenarios passed; installed packaged frontend visually verified with Tools open (50-item-toolbar-context.png). Dashboard and bundle hashes match packaged build. EXE: branded-desktop-1.9.2-catalogue-context-2026-11-01.exe. No cloud deployment or catalogue data changes performed.


### Availability dialog context — 2026-11-01
Explains show/hide sales availability, provides initial and empty-search guidance, and shows Review availability changes only for actual checkbox edits. Changing a checkbox invalidates an earlier confirmation preview. No availability API, persisted fields or sync write paths changed. Local UI checked with empty search, matching product, toggle and revert; no product changes saved. Tests: availability-context.test.js and catalogue-action-context.test.js passed. Packaged dashboard/script match installed files. Screenshots 51 and 52. Installer: branded-desktop-1.9.2-availability-context-2026-11-01.exe.

### Final release verification — 1 November 2026

The final installer includes the popup, cancellation-focus, pagination, contextual catalogue controls and three-decimal ledger fixes described above. It was installed and started against the isolated demonstration profile. Installed checks passed for retained stock and prices, branch/receipt contact details, zero-second sale redirection, day-end report access, and an Excel preview with blank optional remarks. The native desktop also confirmed damage-to-ledger navigation and rounded ledger quantities. The updated user guide includes the final installed ledger screenshot.

Validation on the feature branch: 13,247 API tests passed (13 existing skips); 4,584 desktop tests passed (6 existing skips). Subsequent targeted ledger and upload-controller checks passed. Required GitHub API, database, desktop, packaging, documentation and secret checks passed. Release reconciliation preserves main's stock-location fields alongside category/SKU ordering; its 464 model/repository tests, 25 mobile inventory integration tests and 18 translation/ledger tests passed.

Sync rollout: Gateway PR 48 is deployed, including the branch-scoped spoilage view lane. The installer bundles that agent. Effect journals remain local to their issuing server; balances, ledger records and the read-only spoilage view use the reviewed business-data lanes. The isolated multi-database delivery check passed; physical hardware and live two-till delivery remain site acceptance checks. The unidentified client permission toast cannot be certified without its user/branch or exact error.

The installer is unsigned because the signing certificate is unavailable. The test artifact SHA256 is BC459AD961A5DEDCD8C931A2BAE49A920CE65F3FEBD0B5B8463C48C701A4BCBF. Earlier artifact hashes in this document are historical and are superseded.
### Spoilage detail tabs — 1 November 2026

Details opens by default; audit history has a separate tab and is fetched only on first selection. Switching tabs reuses the response within that popup; reopening fetches fresh history. The audit-only read retains tenant/branch authorization, supports synced read-only records and does not publish or modify stock. The existing detail API remains compatible; the new UI requests view=details to omit history. No persisted fields, sync lanes or write semantics change.

Validation: 21 targeted workspace/spoilage checks passed, covering lazy requests, tab switching, reopening, history omission and audit-only reads. Frontend build completed. The installed test app was updated separately; the previously downloaded EXE does not yet include this follow-up.

Saved spoilage details now explain that stock is updated and no approval remains. Done returns to history; Add another entry starts an empty form. Undo remains a secondary correction action. Reversals explicitly say stock restored; unresolved entries do not display success. This is presentation/navigation only: no changes to stock writes, tenant/branch scope or sync lanes. Seven workspace regression checks pass, including fresh-entry navigation with no stock mutation.

Overview now separates Needs attention, Completed, Cancelled and Saved worksheets. Completed/cancelled actions read View; unfinished operations read Review. Worksheet drafts are separate reference snapshots, not automatically created by saving spoilage. Status filtering occurs server-side before existing pagination, preserving tenant and branch constraints. This is a read-only presentation/query change: inventory operation journals remain local to their authoritative installation; existing stock and stock-log sync is unchanged. 33 targeted inventory API/workspace tests pass, including status pagination and branch isolation.

Stock audit Review changes now highlights and focuses the first invalid quantity or missing reason, returning to its page and clearing filters if needed. Inline validation and an error toast replace the easy-to-miss footer-only message. Correcting the field clears its error; valid input opens the existing review popup without confirming stock. Nine workspace checks pass, including invalid off-page rows and corrected submission. No API, stock-write or sync semantics changed.

Completed stock audits now show an explicit success state with Continue counting and Back to overview. Applied form edits are cleared, closing the result refreshes stock and retains the current page, and replayed completed responses no longer claim stock has not changed. Nine workspace tests pass, including confirmation, cleared edits and subsequent pagination. Presentation and local form-state change only; inventory write and sync semantics are unchanged.

Overview now defaults to All activity so completed spoilage remains visible. Installed API comparison confirmed all six spoilage/reversal entries have matching inventory operations. Spoilage and restoration operations use explicit labels; the spoilage history/detail status identifies stock deducted, restored or undone and history includes the next step. These are read-only labels and filtering changes, with no stock or sync mutations. Nine workspace checks passed.

Spoilage history sorts by created_date descending, then ID for a stable tie-break. Cursor lookup is branch-scoped and paging uses both fields, rather than treating hashed IDs as timestamps. Fifteen spoilage checks passed, including deliberately shuffled creation times across pages. Read-only change; shared spoilage timestamps and existing sync remain unchanged.
