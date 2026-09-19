# Receipt designer

Open **Core Settings → Receipt Print**. Each paper format has its own saved
layout: 58 mm thermal, 80 mm thermal, A4, A5 and US Letter. Switching the editor tab
does not change the default receipt format. Each format card has **Set as default**.
The blue outline marks the format being edited; a green check and **Default**
label mark the default for receipts. Choose the default, then **Save designs**
to apply the change. Undo restores the previous choice before saving.

Add text, sale fields, QR codes, images, the branch logo, receipt barcodes or
dividers from the left. Select a block to edit its content and alignment.
Drag its handle to reorder it, or use Move up / Move down. Undo restores recent
edits. Items and totals are required, and totals must follow the items.

**Default text size** sets the base font for the paper format being edited,
measured in CSS pixels. Select any text-bearing block (including sale fields,
store details, items and totals) to choose its **Block text size** and **Bold text**.
**Use default** follows the format's default size. Headings and totals retain
their built-in emphasis. Other blocks and other paper formats are unaffected.
These controls change text, not the paper.

Select a divider to choose solid, dashed or dotted lines, 1–4 px thickness,
15–100% of the printable width, and left, centre or right alignment. Existing
dividers keep their full-width, 1 px dashed appearance until edited.

Thermal designs have a printable width of 48 mm on a 58 mm roll and
72 mm on an 80 mm roll. Sheet designs have 12 mm margins and a wider item table.
Item names wrap instead of being cut off.

A4, A5 and US Letter use an invoice composition: adjacent logo, store and receipt
details form a header with the invoice number and date on the right. Adjacent
customer fields form a Bill to section. The full-width table has separate item,
quantity, unit price and amount columns. Totals sit on the right, with following
text, sale fields and small QR/image blocks beside them on the left. Images wider
than 40% of the page and dividers remain full-width blocks. Image percentages
still refer to the printable paper width. Terms and the signature share a footer.
A5 uses smaller header spacing, logo limits and table padding to fit its page.
Thermal formats retain their compact, stacked receipt layout.

The renderer groups adjacent blocks without changing their saved order or
content. Moving a divider or another block between sections breaks that grouping.
Existing saved sheet designs gain this presentation without a settings reset.

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
