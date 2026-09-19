# Receipt designer

Open **Core Settings → Receipt Print**. Each paper format has its own saved
layout: 58 mm thermal, 80 mm thermal, A4, A5 and US Letter. Switching the editor tab
does not change the default receipt format. Choose the default separately.

Add text, sale fields, QR codes, images, the branch logo, receipt barcodes or
dividers from the left. Select a block to edit its content and alignment.
Drag its handle to reorder it, or use Move up / Move down. Undo restores recent
edits. Items and totals are required, and totals must follow the items.

**Text size** changes the font, measured in CSS pixels. It does not change the
paper. Thermal designs have a printable width of 48 mm on a 58 mm roll and
72 mm on an 80 mm roll. Sheet designs have 12 mm margins and a wider item table.
Item names wrap instead of being cut off.

The preview uses clearly labelled sample sale data. Text entered in a QR block
is encoded exactly, including links or payment references. QR generation uses
the shop's API and never opens the supplied link. Images accept PNG, JPEG and
WebP files up to 5 MB and are resized before saving. The store logo comes from
Branches / Outlet. Dynamic fields with no value are omitted. Restaurant fields
are offered and printed only while Restaurant is enabled.

Save designs stores all five layouts for the current branch. The initial
layouts import the existing logo, customer settings, header, footer and QR.
Existing receipt templates remain active until the designs are first saved.
For an existing four-format design, A5 starts with a copy of the A4 content
and an 11 px font on a 148 × 210 mm sheet. Editing it does not change A4.
The saved designer applies to sale receipts and their pre-payment preview;
returns, purchase documents and queued floor bills retain their existing paths.

Printers are selected per computer in Hardware Manager. Match the printer's
paper to the chosen receipt format. Browser printing also requires selecting
the matching paper in the print dialog. Designed desktop receipts use the HTML
print path so block order, Unicode text and images remain consistent with the
preview. Thermal pages are fitted to their content in the updated desktop app.

Changes go through a pull request targeting `develop`, then verification on
[the development sandbox](https://develop.posnic.io). Promotion to `main` is a
separate step after that verification.
