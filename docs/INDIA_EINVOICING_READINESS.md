# India GST e-invoicing: how ready the code is today

An honest inventory of what Posnic already holds for an Indian e-invoice, what
it does not, and where the current data would be rejected by an Invoice
Registration Portal (IRP). Written from the code on `develop`, not from the
feature list.

This is the first deliverable of
[#42 GST e-invoice: document the offline field contract](https://github.com/Posnic/POS/issues/42),
a slice of the parent
[#29 India GST e-invoice support](https://github.com/Posnic/POS/issues/29).
It changes no behaviour. Read it with:

- [INDIA_EINVOICING_RESEARCH.md](INDIA_EINVOICING_RESEARCH.md) - what the
  regime and the portals actually require, with sources.
- [INDIA_EINVOICING_DESIGN.md](INDIA_EINVOICING_DESIGN.md) - how the feature
  should be built, as an optional switch, and in which order.

Nothing here is tax advice, and nothing here claims compliance. It says which
fields exist.

## The short version

Posnic is closer than a POS usually is, because the GST work already done
(country tax profiles, the CGST/SGST/IGST split, HSN on items and sale lines,
GSTIN validation on customers, a GSTR-1 JSON export with the right grain) gives
the e-invoice most of its numbers. What it does not have is the *document*
layer the IRP wants around those numbers:

| Area | Today | Verdict |
|---|---|---|
| Seller identity | GSTIN, address, city, pincode, state name, phone, email on the branch | **Partial** - no legal name, no validated 6-digit PIN, state held as a name |
| Buyer identity | GSTIN with format check, type (consumer / regular / composite / unregistered), address, city, state, pincode | **Partial** - no legal name, pincode not copied onto the sale |
| Document | Unique bill number per licence, date, one type (a sale) | **Partial** - no credit-note document; returns live inside the original sale |
| Lines | HSN, rate, quantity, unit price, discount, CGST/SGST/IGST amounts per line | **Partial** - unit is free text (no UQC), no cess, HSN length unchecked, inclusive prices need conversion |
| Totals | Subtotal, tax, discount, round-off, grand total | **Ready with rules** - header tax is a single figure; per-component totals must be summed from lines |
| Place of supply | Derived by comparing state *names*; a GSTIN-to-state-code helper exists | **Partial** - the derivation must move to the GSTIN prefix |
| Supply type / reverse charge / export / SEZ | None | **Missing** - only plain B2B is representable |
| IRN, acknowledgement, signed QR storage | None | **Missing** |
| QR on the printed invoice | `qrcode` library in the API; nothing on receipts; no QR command in the ESC/POS renderer | **Missing** |
| Export payload | GSTR-1 B2B JSON exists (`ctin` / `inv` / `itms`), deterministic in shape | **Precedent exists**, e-invoice JSON does not |
| Readiness UI | GST 2.0 readiness page and endpoint (read-only scan, CSV) | **Precedent exists** |
| Feature switch | Manage > Features cards, `moduleToggleMap`, first-run intro, copy tests, backfill script | **Ready** - one more key |
| Live submission boundary | Signed connector runtime, scoped API tokens, an outbox/claim/result lane (WhatsApp) | **Precedent exists** - nothing e-invoice specific |
| Tests | Jest suites for tax engine, profiles, regime, readiness scan; synthetic demo data | **Ready to extend** |

The offline half of #29 - validate, show what is missing, export a reviewable
JSON - can be built on what is here with additive fields only. Live IRP
submission cannot be built without first deciding where credentials live; see
the design document.

## What exists, file by file

### Country profile and regime

[`api/src/json/tax_profiles.json`](../api/src/json/tax_profiles.json) carries
the `IN` profile: label `GST`, registration label `GSTIN` with the format regex
`^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$`, components `split_equal`
(intra: CGST + SGST, inter: IGST, place of supply by state), inclusive display,
invoice-level half-up rounding, receipt wording `Tax Invoice`, item code `HSN`,
report pack `gstr`, and the counterparty types `consumer`, `regular`,
`composite`, `unregistered`.

[`api/src/services/tax-profiles.js`](../api/src/services/tax-profiles.js)
resolves the profile from `branch.sortname` (with `tax_profile_override`),
validates a registration number against the regex, and dresses one computed
tax amount as components. It never computes tax.

[`api/src/services/tax-regime.js`](../api/src/services/tax-regime.js) and the
`tax` settings group in
[`api/src/services/settings-groups.js`](../api/src/services/settings-groups.js)
hold the per-shop decisions, stored in the `branch_tax` collection:
`india_gst_type` (regular / composition / unregistered),
`india_turnover_above_5cr` (already annotated "6-digit HSN + e-invoice
readiness"), and `india_qrmp`. The Tax Configuration card in
[`frontend/modules/settings_write.html`](../frontend/modules/settings_write.html)
edits them, and the note under the turnover box already says "B2B e-invoicing
is mandatory and items must carry 6-digit HSN codes" when it is ticked. Nothing
reads that flag yet beyond the note.

### Seller: the branch document

[`api/src/models/branch.model.js`](../api/src/models/branch.model.js):
`branch_name`, `store_address` / `address`, `city`, `state` (a name),
`pincode` (free text), `country`, `sortname`, `store_telephone`,
`store_email`, `branch_gstin_number`, `indian_gst` (`gst_on` / `gst_off`),
`sales_prefix`. There is no legal-name field; `branch_name` is what prints,
which is the *trade* name in IRP terms.

### Buyer: the customer document

[`api/src/models/customer.model.js`](../api/src/models/customer.model.js):
`name`, `address`, `city`, `state` (name), `country` (default `India`),
`pincode`, `phone`, `email`, `gst` (`enabled` / `disable`), `gst_type`
(enum above), `gst_number` (regex-checked when `gst` is enabled). No legal
name, no separate trade name, no ship-to address.

At sale time [`api/src/services/sale.service.js`](../api/src/services/sale.service.js)
snapshots `customer_name`, `customer_address`, `customer_city`,
`customer_state`, `customer_phone`, `customer_email`, `customer_gst_type`,
`customer_gst_number` and `country_sort` onto the sale. It does **not**
snapshot the pincode, so a buyer PIN for an old invoice has to come from the
customer master as it is *now*.

### Items

[`api/src/models/item.model.js`](../api/src/models/item.model.js): `hsncode`,
`hsndescription`, `tax` (rate), `tax_type` (inclusive / exclusive),
`tax_name`, `tax_fields`, `unit` and `unit_id` (free text such as `pcs`,
`litre`, `set`, joined to the `unit` collection), `barcode_id`, `item_kind`
(`service` marks the no-stock kind) and `service_unit`. There is no cess field
and no Unit Quantity Code (UQC); the seeded unit labels in
[`api/src/services/install.service.js`](../api/src/services/install.service.js)
are human words, not the `PCS` / `KGS` / `NOS` codes the schema wants.

The HSN picker on the item screen reads
[`api/src/json/hsn.json`](../api/src/json/hsn.json) through
`getHsnCodes()` in the item service. That file predates GST 2.0 and still
carries 12% rates; the readiness scan below deliberately ignores it in favour
of [`api/src/json/gst_rates_2025.json`](../api/src/json/gst_rates_2025.json),
built from Notification 9/2025-Integrated Tax (Rate).

### The sale document

[`api/src/models/sale.model.js`](../api/src/models/sale.model.js). Header:
`sales_id` (the bill number), `date`, `sale_process` (`Add`, `Edit`, `Hold`,
`PartialReturn`, `Return`, `KOT`), the customer snapshot above,
`sales_sub_total`, `tax`, `discount`, `extra_discount`, `round_off` /
`sales_round_off`, `sales_total`, `items_total`, the return figures
(`items_return`, `items_return_total`, `return_tax`, `return_round_off`),
`payment_mode`, `multi_payment`, `invoice_key` (the public PDF link).

Each line (`saleItemSchema`, declared `strict: false`, so extra keys persist):
`name`, `quantity` (minimum 0.001), `unit_price`, `tax_rate`, `tax_amount`,
`discount`, `total`, `item_unit`, `barcode`, `hsncode`, `hsndescription`,
`igst_tax`, `cgst_tax`, `sgst_tax`, `tax_components`, `tax_name`,
`tax_fields`, `item_status`, `return`.

Two things about how those numbers are made matter for an IRP:

- The inter-state decision is `customer_state !== branchState`, a comparison
  of two free-text state names
  ([`sale.service.js`](../api/src/services/sale.service.js), the `interPlace`
  line). A typo, "Pondicherry" against "Puducherry", or a blank customer state
  silently picks the wrong split. The IRP checks the split against the buyer
  GSTIN's state code and rejects a mismatch.
- [`api/src/services/tax-engine.js`](../api/src/services/tax-engine.js) rounds
  each line's tax to two decimals while the header sum keeps full precision,
  and inclusive pricing back-computes the taxable value from a tax-inclusive
  unit price. Both are fine for a receipt; an e-invoice needs every stated
  amount to reconcile with the others within the portal's tolerance, so the
  export must restate the arithmetic from the stored line values rather than
  trust the header.

### Bill numbers

[`api/src/repositories/sale.repository.js`](../api/src/repositories/sale.repository.js):
numbers come from an atomic per-branch counter and are built as
`S<branch><device>-000045` (returns `R-S<branch><device>-000045`), falling
back to `<sales_prefix><n>` on a till that has no gateway device code yet. A
unique index `{license, sales_id}` makes duplicates impossible. The scheme
fits the IRP's document-number rule (alphanumeric plus `/` and `-`, at most
16 characters, not starting with `0`, `/` or `-`) - **except** that
`sales_prefix` is operator-entered free text, so a shop can configure a prefix
that breaks it. That needs a check, not a rename.

### Returns

A return does not create a document. `returnSalesOrder` writes
`items_return[]` entries (with `returnArray[].returnValue[]`), `return_tax`,
`items_return_total` and flips `sale_process` on the *original* sale. The IRP
wants a credit note (`CRN`) with its own number and date referring back to the
invoice. There is an `R-` numbering path in `buildDocNumber`, but no
persisted return document that carries it.

### GST reports that already exist

- **GSTR-1 B2B JSON**: `gstOneReportPageJson` in the sale repository selects
  sales whose `customer_gst_type` is `regular` or `composite` and whose header
  `gst` is `enable`, groups one row per (invoice, rate) - the grain of a
  GSTR-1 `itms` line - and emits `{ ctin, inv: [{ inum, idt, val, pos,
  itms: [{ num, itm_det: { rt, txval, iamt, camt, samt } }] }] }`. This is
  the closest thing in the codebase to an e-invoice export and the right
  place to borrow structure from.
- **`gstStateCode(gstin, stateName)`** at the top of the same file takes the
  first two digits of a GSTIN as the state code and falls back to
  [`api/src/json/gst_state_code.json`](../api/src/json/gst_state_code.json)
  (38 rows) by state name. It is exactly the derivation an e-invoice needs for
  `Pos` and `Stcd`.
- **Tax summary** (`taxSummaryReportTable`) is GSTR-3B shaped.
- **GST 2.0 readiness scan**
  ([`api/src/services/gst-readiness.js`](../api/src/services/gst-readiness.js),
  `GET /items/gstReadiness`,
  [`frontend/modules/gstReadiness.html`](../frontend/modules/gstReadiness.html)):
  a read-only list of items on a withdrawn slab or disagreeing with the
  notification, with CSV export and a notice that nothing changes a rate by
  itself. That is the pattern - and the tone - an e-invoice readiness panel
  should copy.

### Feature switches

Features are keys in the `features` settings group (`branch_features`),
declared once in `moduleToggleMap()` in
[`api/src/models/setting.model.js`](../api/src/models/setting.model.js) with
a parse rule and a default, listed in `FEATURES` in
[`settings-groups.js`](../api/src/services/settings-groups.js), rendered as
cards under Manage > Features, offered once on the first-run welcome
([`frontend/modals/feature_intro.html`](../frontend/modals/feature_intro.html)),
described in `PosnicPro.settings.featureInfo` and routed to their settings
pane by `FEATURE_HOME` in
[`frontend/static/script/js/modules/js/settings.js`](../frontend/static/script/js/modules/js/settings.js).
[`tests/feature-detail-copy.test.js`](../tests/feature-detail-copy.test.js)
fails the build if a feature lacks usable copy, and
[`scripts/module-defaults-backfill.js`](../scripts/module-defaults-backfill.js)
decides what existing shops get when a key is new. The owner's rule for
integrations - "make it as feature, on / off" - is already applied to
Analytics in
[`api/src/services/analytics-config.js`](../api/src/services/analytics-config.js),
including the detail that a network destination is only allowed while the
switch is on.

### The integration boundary that exists

- [`src/connector-runtime.js`](../src/connector-runtime.js): connectors run as
  Ed25519-signed sidecar processes, supervised, crash-loop parked, speaking
  only to the local API with a scoped token. Configs live in
  `userData/connector-runtime/<name>.config.json` with `enabled`, `token`,
  `settings`.
- [`api/src/utils/api-tokens.js`](../api/src/utils/api-tokens.js): `posnic_`
  tokens minted with an explicit ACL matrix over eleven modules; `setting`
  and till actions can never be granted; stored as SHA-256.
- [`api/src/services/whatsapp-outbox.js`](../api/src/services/whatsapp-outbox.js)
  plus the `/connector/whatsapp/claim`, `/result`, `/state` lanes in
  [`api/app.js`](../api/app.js): a durable outbox with claims that expire,
  retries up to a cap, then a visible `dead` state. This is the shape a
  "submit to IRP" queue should take.
- [`src/local-crypto.js`](../src/local-crypto.js) and
  [`src/credentials-store.js`](../src/credentials-store.js): AES-256-GCM with
  a per-install key wrapped by the OS keystore, and a written account of what
  that does and does not protect. The `secrets` settings group is write-only
  over the API.
- [PRIVACY.md](PRIVACY.md) and [SUBPROCESSORS.md](SUBPROCESSORS.md) promise
  that the local edition reaches no network unless the owner switches an
  integration on, and list each such integration. An IRP or GSP connector
  would have to appear there.

### Sync

The gateway replicates `sales`, `customers`, `branches`, `items`, `grouptax`,
`unit`, `settings` and others ([architecture](ARCHITECTURE.md#sync)). Any
e-invoice field added to those documents crosses the wire to installed tills,
which is why every addition below is additive and nothing is renamed. The
`counters` collection does not sync, so bill numbers stay per-till.

## Field-by-field contract

Status words: **Existing** (stored today, right meaning), **Derivable**
(computable from stored data with a rule that must be written), **Unclear**
(stored, but meaning or quality is not reliable), **Missing** (nowhere),
**Not supported** (out of scope for a retail POS for now, exported as
unsupported rather than guessed). Field names are the e-invoice schema
version 1.1 attribute names; see the research document for the full schema.

### Transaction and document

| Schema field | Required | Posnic source today | Status | Note |
|---|---|---|---|---|
| `Version` | yes | constant `1.1` | Derivable | |
| `TranDtls.TaxSch` | yes | constant `GST` | Derivable | |
| `TranDtls.SupTyp` | yes | `customer_gst_type` in {regular, composite} with a GSTIN, so `B2B` | Derivable | SEZ, export, deemed export cannot be expressed; block, do not guess |
| `TranDtls.RegRev` | yes | none | Missing | reverse charge flag; default `N`, needs a field for the rare shop |
| `TranDtls.EcmGstin` | no | none | Not supported | e-commerce operator sales |
| `TranDtls.IgstOnIntra` | no | none | Missing | default `N` |
| `DocDtls.Typ` | yes | a sale is `INV` | Derivable | `CRN` for returns has no document to hang on (see returns) |
| `DocDtls.No` | yes | `sales_id` | Existing | validate length (16 max), charset, first character; custom `sales_prefix` can break it |
| `DocDtls.Dt` | yes | `date` | Existing | render `DD/MM/YYYY` in the shop time zone |

### Seller

| Schema field | Required | Posnic source | Status | Note |
|---|---|---|---|---|
| `SellerDtls.Gstin` | yes | `branch_gstin_number` | Existing | validate format and checksum; first two digits must equal `Stcd` |
| `SellerDtls.LglNm` | yes | none | **Missing** | legal name as registered; `branch_name` is the trade name |
| `SellerDtls.TrdNm` | no | `branch_name` | Existing | |
| `SellerDtls.Addr1` | yes | `store_address` / `address` | Existing | length-limited; a multi-line address must be split or the operator told |
| `SellerDtls.Addr2` | no | none | Missing | optional |
| `SellerDtls.Loc` | yes | `city` | Existing | |
| `SellerDtls.Pin` | yes | `pincode` | Unclear | free text; must be six digits |
| `SellerDtls.Stcd` | yes | GSTIN prefix, else `state` name via `gst_state_code.json` | Derivable | helper already exists in the sale repository |
| `SellerDtls.Ph`, `Em` | no | `store_telephone`, `store_email` | Existing | |

### Buyer

| Schema field | Required | Posnic source | Status | Note |
|---|---|---|---|---|
| `BuyerDtls.Gstin` | yes for B2B | `customer_gst_number` (snapshot) / `customer.gst_number` | Existing | regex exists; checksum does not |
| `BuyerDtls.LglNm` | yes | none | **Missing** | `customer_name` is whatever the cashier typed |
| `BuyerDtls.TrdNm` | no | `customer_name` | Existing | |
| `BuyerDtls.Pos` | yes | GSTIN prefix (`gstStateCode`) | Derivable | authoritative; today's split uses the state *name* instead |
| `BuyerDtls.Addr1` | yes | `customer_address` | Existing | |
| `BuyerDtls.Loc` | yes | `customer_city` | Existing | |
| `BuyerDtls.Pin` | yes | `customer.pincode` only; not on the sale | **Missing on sale** | add a snapshot field |
| `BuyerDtls.Stcd` | yes | as `Pos` | Derivable | |
| `BuyerDtls.Ph`, `Em` | no | `customer_phone`, `customer_email` | Existing | |
| `DispDtls.*`, `ShipDtls.*` | no | none | Not supported | no dispatch-from or ship-to on a sale |

### Lines

| Schema field | Required | Posnic source | Status | Note |
|---|---|---|---|---|
| `SlNo` | yes | array index + 1 | Derivable | |
| `PrdDesc` | no | `name` | Existing | |
| `IsServc` | yes | `item_kind === 'service'` on the master | Unclear | not on the sale line; snapshot it, and require a 6-digit SAC when `Y` |
| `HsnCd` | yes | `hsncode` on the line | Existing | often `''` or `'0'`; enforce 4/6/8 digits, 6 when `india_turnover_above_5cr` |
| `Barcde` | no | `barcode` | Existing | |
| `Qty` | yes for goods | `quantity` | Existing | three decimals allowed |
| `FreeQty` | no | none | Not supported | |
| `Unit` | yes for goods | `item_unit` free text | **Missing** | needs a unit to UQC mapping; an unmapped unit blocks the line |
| `UnitPrice` | yes | `unit_price` | Unclear | for inclusive-tax items this is tax-inclusive; the schema wants pre-tax |
| `TotAmt` | yes | `Qty x UnitPrice` (pre-tax) | Derivable | |
| `Discount` | no | `discount` on the line | Existing | header `extra_discount` and coupon discounts are not allocated to lines |
| `PreTaxVal`, `AssAmt` | yes | `TotAmt - Discount` | Derivable | |
| `GstRt` | yes | `tax_rate` | Existing | must be in the IRP rate master; under GST 2.0 the live slabs are 0, 0.25, 1.5, 3, 5, 18, 28 (tobacco only) and 40, and the portal still accepts withdrawn rates on legacy-dated documents |
| `IgstAmt`, `CgstAmt`, `SgstAmt` | yes | `igst_tax`, `cgst_tax`, `sgst_tax` | Existing | two-decimal per line; recompute from `AssAmt x GstRt` and compare |
| `CesRt`, `CesAmt`, `CesNonAdvlAmt`, `StateCesRt`, `StateCesAmt` | no | none | Not supported | shops selling cess goods cannot be served yet |
| `OthChrg` | no | custom charges (`custom_charges_enable`) | Unclear | sale-level, not per line |
| `TotItemVal` | yes | `AssAmt + taxes + cess + OthChrg` | Derivable | |

### Totals and the rest

| Schema field | Required | Posnic source | Status | Note |
|---|---|---|---|---|
| `ValDtls.AssVal` | yes | sum of line `AssAmt` | Derivable | not the header `sales_sub_total`, which may be inclusive |
| `ValDtls.CgstVal`, `SgstVal`, `IgstVal` | yes | sum of lines | Derivable | header `tax` is one figure |
| `ValDtls.CesVal`, `StCesVal` | no | 0 | Derivable | |
| `ValDtls.Discount` | no | `extra_discount` + coupon | Unclear | only discounts *not* already on lines |
| `ValDtls.OthChrg` | no | custom charges | Unclear | |
| `ValDtls.RndOffAmt` | no | `round_off` / `sales_round_off` | Existing | |
| `ValDtls.TotInvVal` | yes | `sales_total` | Existing | must equal the recomputed sum within tolerance |
| `PayDtls.*` | no | `payment_mode`, `paid_amount` | Existing | optional; omit in the first export |
| `RefDtls.PrecDocDtls` | no | none | Missing | needed on a `CRN` to name the invoice it credits |
| `ExpDtls.*`, `EwbDtls.*`, `AddlDocDtls.*` | no | none | Not supported | |
| IRP response: `Irn`, `AckNo`, `AckDt`, `SignedInvoice`, `SignedQRCode`, status, cancellation | - | none | **Missing** | nowhere to store what comes back |

## Cases the code cannot express today

Each must be reported to the operator as blocked, with the field that blocks
it, and left out of the export.

1. **Unregistered or consumer buyer.** `customer_gst_type` is `consumer` or
   `unregistered`, or `gst` is not `enabled`. Correctly *not* e-invoiced
   today (B2C is outside the mandate); the readiness list must say so rather
   than flag an error.
2. **Registered buyer without a usable GSTIN.** Type `regular` or
   `composite`, `gst_number` empty or failing format or checksum.
3. **Buyer GSTIN state disagrees with the tax split.** IGST charged to a
   same-state GSTIN or CGST/SGST to another state - the consequence of the
   state-name comparison.
4. **Line without a valid HSN or SAC**, including the `'0'` placeholder the
   installer seeds.
5. **Unit that maps to no UQC.**
6. **Inclusive-priced line whose restated arithmetic does not reconcile** to
   the stored `total` within the portal's tolerance.
7. **Header discount or custom charge** that no line carries.
8. **Bill number** longer than 16 characters or with a disallowed character,
   from a custom `sales_prefix`.
9. **Rate not on a live slab** - an item still at 12%, which the GST 2.0
   readiness scan already lists.
10. **Returns and partial returns.** No credit-note document, no reference to
    the original invoice. Until that exists, returns are reported as
    unsupported, not silently skipped.
11. **Cess goods**, exports, SEZ supplies, deemed exports, reverse-charge
    supplies, e-commerce operator sales, foreign currency invoices.
12. **Seller profile incomplete**: missing legal name, non-six-digit PIN,
    GSTIN whose state code differs from the branch state.

## Data quality observed in the shipped data

- [`api/src/json/state_101.json`](../api/src/json/state_101.json), the India
  state list offered to shops, contains `Kenmore`, `Narora`, `Natwar`,
  `Vaishali` and `Paschim Medinipur`, which are not states, and spells
  Puducherry as `Pondicherry`. Free-text state names are how place of supply
  is decided today.
- [`gst_state_code.json`](../api/src/json/gst_state_code.json) maps both
  `Dadra and Nagar Haveli` and `Daman and Diu` to `26` (correct since their
  2020 merger) and keeps `28` for the pre-2014 Andhra Pradesh code beside
  `37`. Fine for a fallback, wrong as a source of truth - which is one more
  reason the GSTIN prefix must win.
- `hsn.json` still carries 12% rates, and the item HSN picker offers them.
- The installer seeds items with `hsncode: '0'`.
- `pincode` is a free-text string on both branch and customer.
- Persisted flags are strings (`gst: 'enable'`, `indian_gst: 'gst_on'`);
  read them as the code does, do not "fix" them.

## Verdict by area, and the smallest next step

| Area | Verdict | Smallest next step |
|---|---|---|
| Seller profile | Partial | add `legal_name` to the branch; validate PIN and GSTIN checksum on save |
| Buyer profile | Partial | add `legal_name` to the customer; snapshot `customer_pincode` and `customer_legal_name` on the sale |
| Document identity | Partial | validate `sales_id` against the IRP rule; decide the credit-note model |
| Lines | Partial | UQC mapping on units; snapshot `is_service`; enforce HSN length by turnover flag |
| Tax and totals | Ready with rules | a pure function that restates one sale as schema amounts and checks reconciliation |
| Place of supply | Partial | derive from GSTIN prefix in the export; report name/GSTIN disagreements |
| Supply type, reverse charge | Missing | additive sale fields with defaults `B2B` / `N`; anything else blocked |
| Export payload | Missing | deterministic JSON, synthetic fixture, byte-for-byte test (#44) |
| Readiness UI | Missing | copy the GST 2.0 readiness page: list, reasons, fix links, CSV |
| IRN / QR storage and print | Missing | an `einvoice` sub-document on the sale; QR image on the A4 invoice first, ESC/POS later |
| Live submission | Missing | connector design accepted first (design doc, options A/B/C) |
| Feature switch | Ready | one key, `module_einvoice_enable`, off by default |
| Tests | Ready to extend | `api/tests/unit/services/einvoice-*.test.js` with the fixtures named in the design |

## What this document does not do

It does not change a schema, a report or a receipt. It does not decide who
runs the connector or which GSP a shop should buy. It does not say Posnic is,
or will be, compliant: it says which fields the code can already fill, and
which it cannot.
