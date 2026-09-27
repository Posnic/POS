# Printable menu

Open **Settings → Restaurant → Printable menu**. The editor uses the current
branch's items and selling prices, grouped by category. Hidden, deleted and
instant items are excluded. A temporary stock-out does not remove a dish from
the printed menu, and a public ordering address is not required.

Choose A4, A5 or Letter paper, one or two columns, text size, type style and
accent color. Choose one of twelve thumbnail swatches or upload a PNG, JPEG or WebP background.
Background strength controls its visibility; the pattern remains visible behind the text. Use a low strength for
readability. Selecting a pattern replaces an uploaded image. Images are resized before saving. Titles, footer notes, dietary
marks, descriptions and category selection can also be customized.

**Save design** saves only this branch's menu design, without changing item
records or other settings. **Reload menu** reads current prices and the saved
design. **Download PDF** and **Print** use the same paginated layout as the
preview. Long names wrap, items stay together, and category headings repeat
when a section continues in another column or page.

PDF pages are rendered at 288 dpi to preserve the browser's fonts, currency
symbols and scripts. The resulting text is rasterized rather than selectable.
The desktop app uses its existing PDF print dialog; in a browser, allow the
PDF pop-up or download the file. A PDF over the desktop bridge's 25 MB limit
is downloaded for printing from a PDF viewer.

Implementation: authenticated `GET /items/printable-menu` returns a branch-
and license-scoped snapshot. `printable_menu_design` belongs to the documents
settings group and is validated with the same contract used by the editor.
Only embedded raster images are accepted as saved backgrounds.
