# Item languages

An item has one identity, price, barcode and stock balance. Its original name stays required. Translations are optional catalogue data, stored with the item and available offline; they are not part of downloadable interface language packs.

## Editing

Open Add/Edit Item, then **Translations** beside the item name. The globe is accompanied by a text label. Choose the original language if known, add a language, and switch between native-language chips without losing unsaved edits. The original text remains visible as a reference. Empty fields fall back to the original. The normal item Save saves the translations too.

Up to 60 translations per item are supported. Names are limited to 200 characters and menu descriptions to 2,000. Removing a translation does not remove the item. Existing clients that omit translation fields do not erase them.

## Display and printing

- Staff item names follow the POS/Captain interface language. Search accepts original and translated names.
- Customer menu names and descriptions follow the customer's selected language.
- Core Settings → Print has separate receipt and kitchen item-language choices, saved on the device, plus optional bilingual receipt names.
- Sale and KOT lines retain a snapshot of translated **names**, so later catalogue edits do not change old documents. Catalogue descriptions are excluded from those snapshots. Order-specific notes are unaffected.
- Existing sales without snapshots continue to show their saved original names.

Translations are entered by the shop; this does not automatically translate catalogue content. Regional locales fall back to their parent language, then the original. The printer's existing font/rendering capabilities still apply.

## UX references

Shopify's [Translate & Adapt](https://apps.shopify.com/translate-and-adapt) uses original text alongside translation editing. W3C's [internationalization guidance](https://www.w3.org/International/techniques/charset) supports recognizable language names rather than country flags. The design uses compact disclosure, native language names, keyboard-accessible controls and automatic text direction.
