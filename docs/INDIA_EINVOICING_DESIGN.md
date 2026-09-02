# India GST e-invoicing: feature design

How Posnic should add e-invoicing for Indian GST-registered shops as an
optional feature - one switch under Manage > Features, off by default, doing
nothing for every shop that does not turn it on - and in which order the work
should land.

This is the design slice of
[#29 India GST e-invoice support](https://github.com/Posnic/POS/issues/29)
(PR slices 1 and 7), and it answers
[#42 document the offline field contract](https://github.com/Posnic/POS/issues/42).
It names the fixtures for
[#43](https://github.com/Posnic/POS/issues/43) and
[#44](https://github.com/Posnic/POS/issues/44), and gives
[#100 the Invoice and GST app listing](https://github.com/Posnic/POS/issues/100)
something true to describe. It is a proposal for maintainers to accept, amend
or reject before any code PR; nothing in it is implemented.

Companions: [INDIA_EINVOICING_RESEARCH.md](INDIA_EINVOICING_RESEARCH.md) (the
regime, with sources) and
[INDIA_EINVOICING_READINESS.md](INDIA_EINVOICING_READINESS.md) (what the code
holds today, field by field). This document assumes both.

## The decision in one paragraph

Build it in two layers, and ship the first without the second. The **offline
layer** validates every B2B sale against the e-invoice schema, tells the
operator exactly what is missing and where to fix it, exports a deterministic
JSON that any IRP, GSP or the government's own offline tool will accept,
stores the IRN and signed QR that come back, and prints them on the invoice.
It needs no credentials, no network and no Posnic Cloud, so it belongs in the
community edition and behind an ordinary feature switch. The **online layer** -
sending the JSON to an IRP and receiving the IRN without a human in between -
is a connector question with three possible homes (a signed local sidecar, a
Posnic Cloud relay, or nothing but the manual export). It is designed here so
the offline layer leaves room for it, and it ships only after that design is
accepted separately, never inside the API process.

## Boundaries carried over from #29

- Billing, printing, reporting, backup and restore keep working with the
  network unplugged and the feature on.
- The desktop app stores no GST portal, IRP or GSP credential in the shop
  database. Phase A stores none anywhere. Phase B, if accepted, stores them
  only in a connector config encrypted the way
  [`src/credentials-store.js`](../src/credentials-store.js) already does, and
  never in a collection that syncs or is backed up.
- No persisted field is renamed. Every addition below is a new key with a
  default that reads as "not set", so a till that has not updated sees nothing
  it cannot handle ([DEVELOPMENT.md](DEVELOPMENT.md#what-not-to-rename)).
- Posnic prepares data for review. It does not claim compliance, and every
  screen and document says that the final responsibility sits with the
  business or its tax professional.
- Only synthetic data in tests, fixtures, screenshots and documentation.

## What the operator sees

1. **Manage > Features** gains a card, *GST e-invoicing (India)*, shown only
   when the branch resolves to the `IN` tax profile. Off by default. Its
   guide page says what it does (readiness checks, export, IRN record, QR
   print) and what it does not (send anything to the government by itself).
2. Turning it on adds **E-invoicing** to the Manage sidebar. The page has one
   job, in the tone of the existing GST 2.0 readiness page: a date range, the
   B2B invoices in it, and for each one either *ready*, *blocked* with the
   reasons in plain words and a link to the exact screen that fixes each, or
   *not applicable* (a walk-in customer, and it says why that is fine).
3. **Export** writes one JSON file of the ready invoices, plus a CSV of the
   blocked ones with their reasons, and records who exported what and when.
4. The operator uploads the JSON to their IRP or GSP - or to the government's
   own bulk tool - and gets a result file back. **Import result** attaches the
   IRN, acknowledgement number and date, and the signed QR to each sale.
5. **Print** from then on shows the IRN, Ack No, Ack Date and QR code on the
   A4 tax invoice. Thermal receipts follow later.
6. A cancellation done on the portal within its window is **recorded** in
   Posnic against the sale so the invoice prints as cancelled and the GSTR-1
   export knows.

Nothing in that list talks to the internet. When Phase B lands, step 4 becomes
automatic for shops that configure a connector, and everything else stays the
same.

## The feature switch

Key: `module_einvoice_enable`. Parse rule `onOnly` (absent means off), default
`false`. The registration checklist, in the order the code reads it:

| Where | What to add |
|---|---|
| [`api/src/services/settings-groups.js`](../api/src/services/settings-groups.js) `FEATURES` | the key, so it is stored in `branch_features` and repaired by `featureToggleRepairs` |
| [`api/src/models/setting.model.js`](../api/src/models/setting.model.js) `moduleToggleMap()` | `module_einvoice_enable: { parse: onOnly, dflt: false }`; also the legacy save path's `ifSent(...)` list and the `TOGGLES` map, which still exist |
| [`frontend/modules/settings_write.html`](../frontend/modules/settings_write.html) | a module card with the switch, inside the block that `.hide_indian_gst` already shows for India only |
| [`frontend/static/script/js/modules/js/settings.js`](../frontend/static/script/js/modules/js/settings.js) | the `INTRO` row (label and one-line consequence), a `featureInfo` entry (tagline, about, benefits, how - the copy test enforces minimum lengths), `FEATURE_HOME: ['einvoice', 'E-invoicing']`, the sidebar tab toggle beside `v-pills-taxmodule-tab`, and the three load/save maps that list every toggle |
| [`scripts/module-defaults-backfill.js`](../scripts/module-defaults-backfill.js) | "never used, other" rule applies: existing shops get an explicit `false`; there is no record type that could count as "in use" |
| [`tests/feature-detail-copy.test.js`](../tests/feature-detail-copy.test.js) | passes once the copy exists; add the key to the intro-list expectation if it is counted |
| `languages/*.json` | `lang_einvoice_*` keys in all thirteen files plus the glossary; the translations workflow checks coverage |
| `frontend/static/images/features/module_einvoice_enable-1.png` | optional screenshot, 8:5 |

The switch gates everything: the sidebar entry, the readiness and export
endpoints (which answer 403 when it is off, the way the GST readiness endpoint
answers without report permission), the IRN fields on the invoice print, and
in Phase B the connector lane. Off leaves stored IRNs in place - a shop that
switches off and on again loses nothing.

Two conditions are checked when the operator turns it on, and reported rather
than enforced: the branch's `indian_gst` is `gst_on`, and the `tax` group has
`india_turnover_above_5cr` ticked. A shop below the threshold may still want
the readiness checks (voluntary registration is possible, and the threshold has
only ever gone down), so the switch is not refused.

## Settings

All in the existing `tax` group (`branch_tax`), because they are decisions a
shop makes inside its regime, exactly like `india_gst_type`:

| Key | Type | Meaning |
|---|---|---|
| `india_einvoice_from` | date string | invoices dated before this are never flagged as missing an IRN. Set when the shop became liable. |
| `india_turnover_above_10cr` | boolean | the 30-day reporting window applies (research document, applicability section). Drives a *warning* on invoices approaching the window, never a block. |
| `india_einvoice_mode` | `manual` (default) or `connector` | Phase B only. `manual` is the whole of Phase A. |

No credential, URL or token belongs in any settings group. Phase B's connector
config lives where WhatsApp's does.

## Data model additions

Additive only. Names follow the `snake_case` majority of their neighbours.

### Branch (seller)

| Field | Type | Why |
|---|---|---|
| `legal_name` | string | `SellerDtls.LglNm`. The name on the GST registration; `branch_name` stays the trade name. |

`pincode` and `branch_gstin_number` are not changed; they are *validated* on
save when the feature is on (six digits; format plus checksum plus state code
equal to the branch state's code).

### Customer (buyer)

| Field | Type | Why |
|---|---|---|
| `legal_name` | string | `BuyerDtls.LglNm`. Optional; when blank the export uses `name` and the readiness list warns. |

`gst_number` gains a checksum check beside the existing regex, and `pincode`
the six-digit check, both only when `gst` is enabled.

### Unit (UQC)

| Field | Type | Why |
|---|---|---|
| `uqc` | string | the GST Unit Quantity Code (`PCS`, `KGS`, `NOS`, `LTR`, `MTR`, `BOX`, `SET`, ...) |

A new reference file `api/src/json/uqc_codes.json` carries the official list
with descriptions; the Units screen offers it as a picker. The seeded units
(`Pieces`, `Quantity`, `Kilogram`, `Litre`, ...) get a mapping in the seed so a
new shop is right from day one; existing shops see unmapped units listed on the
readiness page.

### Sale

| Field | Type | Why |
|---|---|---|
| `customer_pincode` | string | snapshot at sale time, like the other `customer_*` fields |
| `customer_legal_name` | string | snapshot |
| `supply_type` | string, default `B2B` | `TranDtls.SupTyp`. Only `B2B` is produced today; the field exists so an SEZ or export sale can be marked later without a migration. |
| `reverse_charge` | boolean, default `false` | `TranDtls.RegRev` |
| `items[].is_service` | boolean | snapshot of `item_kind === 'service'`, drives `IsServc` and the SAC rule |
| `items[].uqc` | string | snapshot of the unit's UQC at sale time |
| `einvoice` | sub-document | everything the IRP said, see below |
| `einvoice_credit_notes` | array of sub-documents | one per return event that was, or should be, reported as a `CRN` |

The `einvoice` sub-document:

```json
{
  "status": "ready | blocked | not_applicable | exported | generated | cancelled",
  "checked_at": "ISO date", "blockers": [ { "code": "EI-104", "field": "items[2].hsncode" } ],
  "exported_at": "ISO date", "export_id": "ObjectId of the einvoice_exports row",
  "irn": "64-hex", "ack_no": "string", "ack_dt": "ISO date",
  "signed_qr": "JWT as returned", "signed_invoice": "JWT as returned, optional",
  "qr_payload": "decoded JSON payload of the signed QR, for printing without re-verifying",
  "irp": "NIC | provider name", "generated_by": "manual-import | connector:<name>",
  "cancelled_at": "ISO date", "cancel_reason": "1-4", "cancel_remark": "string"
}
```

`status` is a cache of the last readiness check, recomputed on demand; the
source of truth is the sale itself. `irn` gets a sparse unique index per
licence - two sales can never claim one IRN. The signed JWTs are a few
kilobytes each; storing them is what lets the QR be verified and reprinted
offline, so they stay.

### Credit notes

The IRP wants a `CRN` document with its own number, date and a reference to
the invoice it credits. Posnic keeps returns *inside* the original sale
(`items_return[]`), which is load-bearing for reports, sync and the return
screens, so this design does not move them. Instead each return event that
touches a B2B sale gets an entry in `einvoice_credit_notes[]`:

```json
{ "doc_no": "R-SB1D1-000045", "doc_dt": "ISO date", "return_ref": "index or id of the items_return entry",
  "lines": [ ... restated as schema lines ... ], "totals": { ... }, "einvoice": { ...same shape as above... } }
```

The number comes from the `R-` path `buildDocNumber` already has. Two things
need a maintainer decision before this can be built, and are listed under open
questions: whether every return event already carries a stable timestamp and
identity, and whether a return that happens *before* the invoice has an IRN
should block the invoice or be reported separately.

### Audit

A new collection `einvoice_exports`: `{ license, branch_id, from, to,
count_ready, count_blocked, file_hash, app_version, user_id, user_name,
created_date }`. No payload, no GSTINs, no customer names - the file itself is
the operator's, the row only proves an export happened. It is not on the sync
list and does not need to be.

## The contract module

A pure, dependency-free module under `api/src/services/einvoice/`, testable
without a database, in the style of `tax-engine.js`:

| File | Job |
|---|---|
| `gstin.js` | format regex (from the `IN` profile), the mod-36 checksum, state code extraction, PAN extraction |
| `uqc.js` | the code list and a `unitToUqc(unitName, unitDoc)` lookup |
| `contract.js` | `restate(sale, branch, customer, decisions)` - one sale in, one schema-shaped object out, every amount recomputed from stored line values at two decimals, inclusive prices converted to pre-tax unit prices, header discounts and charges allocated or refused |
| `validate.js` | `check(restated, context)` returns findings; never throws |
| `export.js` | `serialize(invoices)` - stable key order, two-decimal numbers as numbers, dates as `DD/MM/YYYY`, an array of schema objects; `blockedCsv(findings)` |
| `qr.js` | decode a signed QR JWT's payload without verifying (printing), and verify against a supplied IRP public key when one is present |

`restate` is where the arithmetic decisions live, and they are written down so
a reviewer can disagree with one at a time:

- **Unit price.** For an `exclusive` line, `UnitPrice = unit_price`. For an
  `inclusive` line, `UnitPrice = unit_price x 100 / (100 + tax_rate)`, at four
  decimals, and `TotAmt = Qty x UnitPrice`. The schema allows more decimals on
  unit price than on totals; use them so the line reconciles.
- **Discount.** Line `discount` maps to `Discount`. A header `extra_discount`
  or coupon discount is allocated across lines in proportion to their
  `AssAmt` before tax, at two decimals, with the rounding remainder on the
  largest line - the same rule for every export, so it is reproducible. A shop
  that dislikes this can turn it off per export, in which case any header
  discount blocks the invoice.
- **Tax.** `IgstAmt`, `CgstAmt`, `SgstAmt` are recomputed as
  `AssAmt x GstRt / 100` (halved for the intra-state pair) at two decimals
  and compared to the stored `igst_tax` / `cgst_tax` / `sgst_tax`. A
  difference above the portal's tolerance (research document, validation
  section) is a blocker with both numbers shown.
- **Place of supply.** `Pos` and `BuyerDtls.Stcd` come from the buyer GSTIN's
  first two digits, `SellerDtls.Stcd` from the seller's. Inter-state is
  `Pos !== SellerDtls.Stcd`. If the stored split disagrees (IGST on an
  intra-state pair or the reverse), that is a blocker naming the customer's
  state field, because the sale was taxed from a state name that does not
  match the GSTIN.
- **Totals.** `ValDtls` are sums of the restated lines plus `RndOffAmt` from
  the sale; `TotInvVal` is compared to `sales_total` and a difference above
  tolerance is a blocker.
- **Dates and numbers.** `DocDtls.Dt` is the sale date in the branch time
  zone; `DocDtls.No` is `sales_id` unchanged.

### Findings

Every finding is `{ code, severity, field, message, fix }` where `severity`
is `block` (excluded from export), `warn` (exported, shown) or `info`
(explains a not-applicable row), and `fix` is `{ screen, id, label }` for the
readiness page's link. The first set:

| Code | Severity | Rule | Fix screen |
|---|---|---|---|
| EI-001 | info | buyer is a consumer or unregistered: not an e-invoice candidate | - |
| EI-002 | block | registered buyer has no GSTIN | customer |
| EI-003 | block | buyer GSTIN fails format or checksum | customer |
| EI-004 | block | buyer legal name missing and trade name blank | customer |
| EI-005 | block | buyer PIN not six digits | customer |
| EI-006 | warn | buyer legal name missing; trade name used | customer |
| EI-011 | block | seller GSTIN missing or fails format or checksum | branch |
| EI-012 | block | seller GSTIN state code differs from branch state | branch |
| EI-013 | block | seller legal name missing | branch |
| EI-014 | block | seller PIN not six digits | branch |
| EI-015 | block | seller address or city missing | branch |
| EI-021 | block | document number longer than 16, disallowed character, or leading `0` `/` `-` | branch (sales prefix) |
| EI-022 | warn | invoice dated more than the reporting window ago and still without IRN | - |
| EI-023 | block | supply type other than B2B, or reverse charge set (not yet exportable) | sale |
| EI-101 | block | line HSN missing or `0` | item |
| EI-102 | block | HSN not 4, 6 or 8 digits | item |
| EI-103 | block when `india_turnover_above_5cr`, else warn | HSN shorter than 6 digits. IRPs refuse 4-digit codes from taxpayers at or above 5 crore, which is everyone the mandate covers, so 6 digits is the effective minimum | item |
| EI-104 | block | service line without a 6-digit SAC in chapter 99 | item |
| EI-105 | block | unit has no UQC | units |
| EI-106 | block | rate not in the IRP rate master (read from the portal's master codes when the validation PR is written; 40 must be accepted) | item |
| EI-111 | warn | rate is a slab withdrawn by GST 2.0 (12%, or 28% outside tobacco and pan masala); the IRP still accepts it, the notification does not | item |
| EI-107 | block | line tax differs from `AssAmt x GstRt` beyond tolerance | sale |
| EI-108 | block | tax split disagrees with buyer state code | customer |
| EI-109 | block | header discount or custom charge could not be allocated | sale |
| EI-110 | block | more than 1000 lines | sale |
| EI-201 | block | `TotInvVal` differs from `sales_total` beyond tolerance | sale |
| EI-301 | block | sale has returns and credit-note export is not yet supported | - |
| EI-302 | warn | invoice already has an IRN; edits after generation are not reported to the IRP | - |

Codes are stable once published, because operators will search for them.

## Export

`POST /sales/einvoiceExport` with `{ branch, from, to, ids? }` and report
permission. The response is a JSON file - an array of schema version 1.1
invoice objects, which is the per-invoice shape every IRP and GSP API and the
NIC bulk tool consume - named
`einvoice-<branchcode>-<from>-<to>-<sha256 first 8>.json`, and a CSV of the
blocked rows. One `einvoice_exports` row is written. The `einvoice.status` of
each exported sale becomes `exported` with the export id, so the readiness
page can show "exported on ..., awaiting result".

The output is deterministic: sorted by `DocDtls.Dt` then `DocDtls.No`, stable
key order from the serializer, no timestamps inside the payload. The
deterministic-export test of #44 asserts the whole file, byte for byte,
against a checked-in fixture.

Whether the government's bulk tool wants that array wrapped in an envelope is
recorded in the research document as a point to confirm against the current
tool before the export PR; the serializer takes a `wrapper` option either way.

## Importing the result

`POST /sales/einvoiceResult` with the result file an IRP, GSP or the bulk tool
returns. The parser is provider-neutral where it can be (it looks for `Irn`,
`AckNo`, `AckDt`, `SignedQRCode`, `SignedInvoice`, matched to sales by
seller GSTIN + document number + date) and named per provider format where it
must be. Matching is exact; anything unmatched is listed, never guessed.

`POST /sales/:id/einvoice` accepts the same fields typed by hand for the shop
that generated one IRN on the portal directly. Both require sales write
permission and record `generated_by: manual-import`.

`POST /sales/:id/einvoice/cancel` records a cancellation the operator has
already performed on the portal (reason code 1 to 4 and remark), sets the
status, and does not itself cancel anything anywhere. The portal allows
cancellation only within 24 hours of generation and never while an e-way bill
is active; after that the correction is a credit note, which is why the
readiness page shows the generation time beside each IRN.

## Printing

The A4 tax invoice (the `salesPdf` path) gains, when the sale has an IRN: the
IRN, Ack No and Ack Date in the header block, and the QR image rendered from
`signed_qr` with the `qrcode` package the API already depends on. The QR
encodes the signed JWT string *as returned* - decoding it and printing the
fields would destroy the signature the GSTN verifier app checks. It should be
large enough to scan from paper (about 2 x 2 inches is the usual advice).
Without an IRN the invoice is unchanged. Whether a cancelled IRN prints a
"CANCELLED" band is a copy decision for the UI PR.

Thermal receipts are out of scope for the first release. The ESC/POS renderer
([`src/escpos-receipt.js`](../src/escpos-receipt.js)) has no QR command, and a
B2B invoice that needs an IRN is normally printed on A4 anyway. Adding the
`GS ( k` QR sequence is a self-contained later PR.

## Sync and several tills

The `einvoice` sub-document rides the `sales` collection on the existing sync
wire; no collection is added to the gateway's list, so the contract in
[ARCHITECTURE.md](ARCHITECTURE.md#sync) is untouched. Because an IRN is
generated exactly once, only one place may write it: in Phase A that is
whichever till imports the result file (imports are idempotent - the same IRN
for the same sale is a no-op, a *different* IRN for a sale that has one is
refused). In Phase B the connector runs on one designated device per licence,
recorded in its config.

## The online layer: where live submission could live

This is PR slice 7 of #29, presented as three options with a recommendation,
for maintainers to accept before any of it is coded.

| | A. Manual export and import | B. Signed local connector | C. Posnic Cloud relay |
|---|---|---|---|
| What runs | nothing new; the operator moves two files | a sidecar under [`src/connector-runtime.js`](../src/connector-runtime.js) holding provider credentials, draining an `einvoice_outbox` through `/connector/einvoice/claim`, `/result`, `/state` lanes modelled on the WhatsApp ones | Posnic Cloud holds the GSP relationship; the sync agent already ships sales; the cloud generates IRNs and syncs the `einvoice` sub-document back |
| Credentials | none in Posnic | in `userData/connector-runtime/einvoice.config.json`, encrypted with the safeStorage-wrapped key; never in MongoDB | in the cloud tenant; none on the till |
| Works in the community edition | yes | yes | no (paid) |
| Network from the till | none | yes, to the provider; must be listed in PRIVACY.md and SUBPROCESSORS.md as a feature the owner configures | only the existing sync |
| Fit with the IRP access model | fits any IRP or GSP, and the government's own tool | direct NIC API access needs static IP whitelisting and a turnover threshold, so in practice this means a GSP or IRP-provider API with per-shop credentials (research document, IRP landscape) | one integration, one whitelisted origin, one provider contract |
| Failure mode | a forgotten upload; the readiness page shows it | a dead sidecar; the outbox parks it as `dead` and the page shows it | a cloud incident; the till keeps selling and the page shows "awaiting" |
| Effort | the offline layer only | connector, outbox, lanes, provider client, retry and duplicate-IRN handling, a settings card, signing and distribution through the connector release channel | cloud-side work in the private repositories plus the sub-document sync path |

One fact from the research shapes B and C more than any other. The NIC IRP
issues its API `client_id` and `client_secret` to a GSP, an ERP vendor or a
large taxpayer, never to a small shop; the shop only creates a per-GSTIN API
user that names the route. If Posnic registered as an ERP, its client secret
would have to reach the IRP from somewhere Posnic controls - which is option C,
a relay - because shipping that secret inside a connector installed on every
till is publishing it. Option B therefore means each shop brings its *own* GSP
or IRP-provider credentials, and the connector is a thin client for whichever
provider API the shop has chosen.

**Recommendation.** Ship A with the offline layer; it is complete in itself
and is what most small B2B-selling shops do today with their GSP's portal.
Design B as the community path under
[#34 the connector platform](https://github.com/Posnic/POS/issues/34) once
that platform has its second connector, because the outbox, lane, token and
signing pieces already exist and the e-invoice connector would be a small
client around them. Treat C as a Posnic Cloud product decision to be made
outside this repository. Never call an IRP from the API process: a portal
outage must not be a till outage, and the trust chain the runtime enforces is
the reason the community edition can carry a network-facing integration at
all.

If B is accepted, the outbox state machine is
`ready -> queued -> claimed -> generated | failed -> (retry up to N) -> dead`,
with `generated -> cancel_requested -> cancelled` for cancellations inside the
portal's window. The idempotency key is the IRN's own input - seller GSTIN,
financial year, document type, document number - so a retry after a lost
response asks the provider for the existing IRN instead of creating a
duplicate. The IRP only answers "get IRN by document number" for three days
after generation, so the connector persists every response the moment it
arrives and treats a lost response as an emergency lookup, not a retry.
Everything the connector writes back goes through
`POST /connector/einvoice/result` with a token scoped to `sales: read, write`
and nothing else.

## Access control

| Action | Permission |
|---|---|
| see the readiness page and run a check | `report.read` (it is a report) |
| export | `report.read` and `sales.read` |
| import a result, type an IRN, record a cancellation | `sales.write` |
| change the settings above or the feature switch | the existing settings ACL |
| Phase B connector token | scoped `sales: read, write`, minted by an admin exactly like the WhatsApp connector's |

No new ACL module in Phase A; `ACL_MODULES` is a fixed list wired through the
Users screen and the scoped-token whitelist, and widening it is its own
change.

## Test plan and fixtures

Fixtures live in `api/tests/fixtures/einvoice/`, tests in
`api/tests/unit/services/einvoice-*.test.js`, deterministic, no database, no
network. Every identity below is synthetic. The GSTINs satisfy the format and
the mod-36 checksum so that the checksum test is real, and their PAN segments
are the obviously-fake `AAAAA0000A` pattern.

| Fixture | Value |
|---|---|
| Seller, Tamil Nadu | `Synthetic Traders Private Limited` (legal), trade name `Fixture Stores`, GSTIN `33AAAAA0000A1Z9`, 1 Test Street, Chennai, PIN `600001`, state code `33` |
| Buyer, same state | `Fixture Retail LLP`, GSTIN `33DDDDD3333D1Z0`, 2 Sample Road, Chennai, `600002` |
| Buyer, other state | `Placeholder Enterprises`, GSTIN `29BBBBB1111B1ZJ`, 3 Example Avenue, Bengaluru, `560001`, state code `29` |
| Buyer, consumer | `Walk-in`, no GSTIN, type `consumer` |
| Bad checksum | `33AAAAA0000A1Z0` (last character wrong) |
| Item A | `Fixture rice 5 kg`, HSN `100630`, 5%, unit `Kilogram` (UQC `KGS`), exclusive, 250.00 |
| Item B | `Fixture handset`, HSN `85171300`, 18%, unit `Pieces` (UQC `NOS`), exclusive, 10000.00 |
| Item C | `Fixture repair service`, `is_service`, SAC `998719`, 18%, unit `Others` (`OTH`) |
| Item D | `Fixture with no HSN`, HSN `0` |
| Item E | `Fixture inclusive`, HSN `210690`, 18%, inclusive, 118.00 |
| Bill numbers | `SB1D1-000045`, `SB1D1-000046`; the too-long `SUPERLONGPREFIX-000045` |
| Dates | fixed, `2026-08-14T10:30:00+05:30` |

HSN and SAC codes in fixtures are placeholders for testing, not classification
advice.

**Passing cases** (both must produce byte-stable exports):

1. *B2B intra-state.* Seller TN, buyer `33DDDDD3333D1Z0`, 2 x Item A, 1 x
   Item B. Expected lines: A `AssAmt 500.00, CgstAmt 12.50, SgstAmt 12.50,
   TotItemVal 525.00`; B `AssAmt 10000.00, CgstAmt 900.00, SgstAmt 900.00,
   TotItemVal 11800.00`. `ValDtls`: `AssVal 10500.00, CgstVal 912.50,
   SgstVal 912.50, IgstVal 0, TotInvVal 12325.00`. `Pos 33`.
2. *B2B inter-state.* Same lines, buyer `29BBBBB1111B1ZJ`. `IgstAmt 25.00`
   and `1800.00`; `IgstVal 1825.00`, `CgstVal 0`, `SgstVal 0`,
   `TotInvVal 12325.00`. `Pos 29`.

**Rejected or excluded cases** (each named for the operator's problem):

3. Consumer buyer: EI-001, `not_applicable`, not an error.
4. Registered buyer, blank GSTIN: EI-002.
5. GSTIN `33AAAAA0000A1Z0`: EI-003, message names the checksum.
6. Item D on the invoice: EI-101, fix link to the item.
7. Buyer with no GSTIN and no state: EI-002, and no `Pos` can be derived.
8. Intra-state buyer but the stored line carries `igst_tax`: EI-108, fix link
   to the customer's state.
9. Bill number `SUPERLONGPREFIX-000045`: EI-021, fix link to the sales
   prefix.
10. Unit `packet` with no UQC: EI-105.
11. Item E inclusive: passes with `UnitPrice 100.0000`, `AssAmt 100.00`,
    `CgstAmt 9.00`, `SgstAmt 9.00`, `TotItemVal 118.00` - and a variant whose
    stored `tax_amount` is 17.50 fails EI-107 with both figures in the
    message.
12. A sale with an `items_return` entry: EI-301 until credit notes ship.

**Contract tests** beyond the fixtures: checksum accepts the six synthetic
GSTINs and rejects each with one character changed; state code extraction;
UQC lookup by seeded unit names; serializer key order and number formatting;
`restate` on a sale with a header discount allocates to the cent and the sum
of allocations equals the discount.

## Delivery plan

One focused PR per row, each against `develop`, each small enough to read in
a sitting. Sizes use the issue labels.

| # | PR | Issue | Size | Depends on |
|---|---|---|---|---|
| 1 | This design and its two companions | #42, #29 slices 1 and 7 | small | - |
| 2 | `einvoice/gstin.js`, `uqc.js`, `uqc_codes.json`, `validate.js` with the rejected fixtures | #43 | medium | 1 |
| 3 | `contract.js` and `export.js` with the two passing fixtures and the byte-for-byte test | #44 | medium | 2 |
| 4 | Additive model fields: branch and customer `legal_name`, unit `uqc`, sale snapshots, `einvoice` sub-document, validation on save when the feature is on | #29 data model | medium | 2 |
| 5 | Feature switch across all registration points, readiness page and endpoint, export endpoint and audit row, fix links, strings in all languages | #29 UI | medium | 3, 4 |
| 6 | Result import, manual IRN entry, cancellation record, QR and IRN on the A4 invoice | #29 export/print | medium | 5 |
| 7 | Credit notes: the `einvoice_credit_notes` model and `CRN` export | #29 tests slice (returns) | medium | a maintainer decision on the open questions |
| 8 | Listing copy for the official Invoice and GST app | #100 | small | 5 shipped |
| 9 | Connector (option B): outbox, lanes, sidecar, provider client, settings card, privacy docs | separate accepted design under #34 | large | 6 and the platform |
| 10 | ESC/POS QR; e-way bill by IRN; B2C QR when the mandate arrives | later | - | 6 |

Rows 2 and 3 are pure functions and can be reviewed without running the app;
they are the "good first contributions" #29 asks for. Row 4 is the only one
that touches persisted documents, and it adds keys only.

## How this meets the #29 acceptance criteria

| #29 criterion | Where |
|---|---|
| seller profile stores the readiness fields | branch `legal_name`; the rest exist and gain validation |
| buyer profile stores registered-buyer fields without forcing them on walk-ins | customer `legal_name`; all checks are gated on `gst` enabled |
| every exported candidate has seller, buyer, document, item, tax, total, place of supply, invoice type | `contract.js` output is the schema object; nothing partial is exported |
| export blocked with field-level errors | findings EI-0xx to EI-3xx, `block` severity |
| readiness UI lists missing fields in operator language and links to the screen | the `fix` on every finding |
| existing invoices, receipts, returns, printing continue unchanged elsewhere | feature off by default; India-only card; print changes only when an IRN exists |
| tests use synthetic data only | the fixture table |
| deterministic export for one intra-state and one inter-state B2B sale | cases 1 and 2 |
| rejected export for unregistered buyer, missing HSN, mismatched totals, invalid GSTIN, missing place of supply | cases 3 to 8 |
| public docs explain supported flow, unsupported live flow, operator review, privacy boundary | this document and its companions; USER_GUIDE gets a section in PR 5 |
| no network, login, credential, QR signing, IRN generation or submission introduced | Phase A introduces none; Phase B is a separate accepted design |

## Open questions for maintainers

1. **Credit-note identity.** Does every `items_return` event carry a stable
   timestamp and index today, or does that need adding before
   `einvoice_credit_notes` can reference it? And should a return on an invoice
   that has no IRN yet block the invoice (EI-301) or be exported as a `CRN`
   against a not-yet-registered invoice (which the IRP would refuse)?
2. **Legal name placement.** Branch and customer as proposed, or a single
   `gst_profile` sub-document on each that also holds a cached state code?
3. **Header discount allocation.** Proportional-by-taxable-value as proposed,
   or refuse any header discount on a B2B invoice and make the till apply it
   per line?
4. **Inclusive pricing.** Convert at export as proposed, or require B2B sales
   to be rung up exclusive when the feature is on?
5. **Where the readiness page lives.** Manage sidebar as a feature home, or
   under Reports beside the GST reports?
6. **Phase B home.** Local connector, Cloud relay, both, or neither for now?
   This decides whether the `india_einvoice_mode` setting is added at all.
7. **The bulk tool envelope.** The research confirms the bulk tool consumes the
   same schema objects in an array; confirm whether the current tool wants any
   wrapper around that array before PR 3 fixes the serializer's `wrapper`
   option.
8. **Retention.** GST records must be kept for 72 months from the annual
   return's due date. Keep both signed JWTs with the sale for that long, or
   keep `signed_qr` (needed to reprint) and drop `signed_invoice` after a
   period?

## Non-goals

E-way bills, B2C dynamic QR codes for very large taxpayers, GSTR filing,
Invoice Management System (IMS) actions, portal scraping or browser
automation, storing OTPs or session cookies, multi-currency invoices, and any
statement that a Posnic invoice is compliant. Some of these become reasonable
follow-ups once the offline layer has shipped and been used; none belong in
it.
