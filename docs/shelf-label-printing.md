# Shelf-label desktop printing

The shelf-label wizard now selects a local printer before submission. A missing selection is an error; it never borrows the receipt or kitchen printer. Printer choices are remembered separately for A4 and roll paper on this computer.

- Initial batch: 5 labels. A single test always submits one label. The 2,000-label maximum remains available only when entered by the operator.
- A4: render the same label HTML to an A4 PDF, then submit at actual size to the selected printer. Do not open the browser print dialog on desktop.
- 80 mm receipt printers: explicitly choose the ESC/POS method. Labels may be up to 72 mm wide, matching the 576-dot printable area. Each label uses the existing raster renderer and durable raw queue, with one cut per label. A batch stops on the first failed/uncertain submission and reports the number previously sent.
- Other label printers: driver printing receives explicit micron dimensions, no margins, 100% scale and no additional landscape rotation. Exact-size jobs never retry using a driver's default paper size.
- Browser-only installations retain the system print dialog because they do not have the desktop printer bridge.

## Local data and synchronization

Product names, prices and barcodes still come from the existing tenant-scoped Items API, including label pricing. This change does not modify business data or its sync lanes. Printer names, print methods and layout preferences remain local to this installation/browser profile: another till may have different hardware. Print jobs are never synchronized or replayed on another till. No Gateway or sync-agent rollout is required.

## Validation (18 October 2026)

37 targeted shelf-label and desktop-PDF tests passed. Real POS-80C output was submitted using the existing raw queue; the operator confirmed correct horizontal orientation and improved readability on the larger sample. The dotted cutting guide was then removed for the thermal sample. Barcode scanning has not yet been physically verified.

The operator subsequently confirmed Brother DCP-T710W output with a photograph of all five sample labels, arranged in three columns. The test was configured for A4 with 63 x 33 mm labels, 5 mm sheet margins and 2 mm gaps, allowing 24 positions (three columns by eight rows). Only five positions were requested. The photograph confirms readable output and cutting guides, but does not establish measured dimensions or barcode scan reliability. Both an Electron HTML job and an actual-size PDF job had been submitted, so the photograph alone does not identify which submission produced this sheet. A separate direct GDI connection-test page was not specifically confirmed.

The frontend production build also passed, with existing Sass deprecation warnings. The installed application and final packaged installer still require verification with these source changes.

These are source changes, not yet installed on the client's machine or included in a released handover.

## Follow-up design and receipt modes

The full 24-label A4 sheet was physically confirmed by the operator. Product names and prices are larger; roll content starts 1 mm from the label top instead of being vertically centred. The thermal preview shows the 80 mm paper around the 72 mm print head. Feed/cutter margins depend on the printer and are not promised as an exact screen match. Existing saved design preferences are preserved.

The three existing receipt modes remain available under Settings > Printers & paper: Exact design (raster), Fast receipt (text with Exact fallback for unsupported content), and Windows driver. Explicit physical tests were submitted using the actual receipt designer and HardwareManager. Exact and Fast returned success; Windows driver reported no matching spooler job and was not retried. The operator subsequently confirmed all three physical samples. The driver spooler check was a false negative; no duplicate was submitted.

126 targeted tests passed, including receipt modes, printer settings, receipt designer, shelf labels and PDF printing.

## Size presets

The layout step offers A4 63 x 33 mm (24 positions), 80 mm receipt roll
(72 x 33 mm printable, ESC/POS), 58 mm receipt roll (48 x 33 mm printable,
driver), and 40 x 30, 50 x 30 and 60 x 40 mm sticker-label layouts (driver).
These are editable starting points, not detection or certification of printer
stock. Custom dimensions and existing designs are preserved. The 58 mm driver
preset has not been physically tested; direct ESC/POS remains 80 mm only.

Selecting a preset is explicit opt-in and saves only the existing local layout
and print-method preferences. It does not change business data or sync lanes.
Regression tests cover dimensions, method switching, copies, custom edits and
reopening. 24 focused label and international-language tests passed.

## Paper cards and print plan

Paper and size choices are visible buttons with selected states. New layouts
start with the 80 mm roll preset (72 x 33 mm printable); existing saved layouts
remain unchanged. A4 sizes offer 24, 40 and 14 positions plus custom dimensions,
with live column/row/capacity calculations. Roll sizes are hidden for A4 and vice
versa. This default change was explicitly requested by the user.

The print step lists selected products with editable label copies, a one-each
shortcut, and the actual batch count/range and sheets or individual roll labels.
Copies do not multiply the entire sheet. These controls still use existing
local layout preferences and transient product selection, with no sync changes.
