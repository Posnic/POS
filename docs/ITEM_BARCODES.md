# Item barcodes

A non-empty barcode identifies one sellable item within a shop branch. Each
variant needs its own code. Primary and alternate barcodes share this rule;
the same item may have several codes. Blank barcodes remain valid for products
that are selected by name. Separate branches may use the same code.

Creating or editing an item reports the conflicting barcode and existing item.
An edit excludes its own record while checking other items. Deleted records do
not reserve codes. Branch membership comes from `branch_access`, with the legacy
`branch_id` used when there is no membership array.

Item imports validate all accepted rows before writing any items or related
supplier, category, tax or unit records. Conflicts within the file or with the
branch's catalogue reject the import. The import dialog retains the affected
row numbers, names and explanations so the file can be corrected. A re-import
matched by name and item ID may keep its own barcode and alternate codes.

The API serializes item saves and imports for a license within its process.
Independent offline tills, external database writes or multiple API processes
can still produce conflicts; these checks are not a distributed unique index.
The startup health scan reports existing conflicts without modifying products,
stock or sales. It checks primary and alternate codes, excludes deleted items,
respects branch membership, and names the affected products and variants.

Example warning: `Barcode "6223014652308" is shared by 2 items. Items: "Milk
(Small)", "Milk (Large)". Review this barcode in Items. Each item or variant
needs a different barcode within a branch.`
