# India GST returns: what the reports do today, and what is missing

An inventory of Posnic's existing GST reporting, measured against what GSTR-1,
GSTR-3B and GSTR-9 actually require. Written from the code on `develop`.

This answers
[#45 GST returns: document current report gaps](https://github.com/Posnic/POS/issues/45),
the gap-analysis slice of
[#30 India GST return preparation](https://github.com/Posnic/POS/issues/30).
It changes no behaviour and no calculation. Its companion for the e-invoice
side is [INDIA_EINVOICING_READINESS.md](INDIA_EINVOICING_READINESS.md).

Nothing here is tax advice. It is a description of code.

## The short version

Posnic has **one filing-capable artefact and one correct tax position**, and a
lot of screens around them that look more finished than they are.

| | |
|---|---|
| **Genuinely filing-shaped** | The GSTR-1 **B2B** JSON export. Correct grain, correct field names, correct place-of-supply derivation, and it has tests. |
| **Genuinely correct** | The tax-payable report's per-head netting, which applies the statutory IGST then CGST then SGST order and never lets CGST pay SGST. |
| **Screens over weak aggregations** | GSTR-1's on-screen table, GSTR-2, GSTR-2B, GSTR-3 and GSTR-9. Their groupings lose rows, and four of them export "JSON" that no filing tool can read. |
| **Absent** | Ten of the thirteen GSTR-1 tables, every exemption classification, cess, advances, the document series, and any GSTR-2B reconciliation. |

Three structural gaps cut across everything, and none is cosmetic:

1. **No supply-nature classification.** Nothing anywhere records that a line is
   exempt, nil-rated, non-GST, zero-rated, an export, or under reverse charge.
   Tables 4B, 6 and 8 of GSTR-1 cannot be derived from stored data at all,
   because the data does not exist.
2. **Credit notes are filed in the wrong month, and only for registered
   buyers.** The returns aggregation reuses the invoice's date filter and the
   invoice's buyer-type filter.
3. **No cess field anywhere.** The GSTR-1 JSON hardcodes `csamt: 0`, which is
   correct only while no shop sells a cess good.

## What is already right

Two pieces are worth protecting when the rest is changed.

### The GSTR-1 B2B JSON

`gstOneReportPageJson` in
[`api/src/repositories/sale.repository.js`](../api/src/repositories/sale.repository.js)
(around line 6599), reached from `GET /sales/gstOneReportTableJson`. It groups
by `{ sales_id, ctin, rate }`, which is exactly the grain of a GSTR-1 `itms`
line, with real `$sum` accumulators. It emits the offline tool's own shape:

```json
{ "ctin": "...", "inv": [ { "inum": "...", "idt": "DD-MM-YYYY", "val": 0,
  "pos": "33", "rchrg": "N", "inv_typ": "R",
  "itms": [ { "num": 1, "itm_det": { "rt": 5, "txval": 0,
              "iamt": 0, "camt": 0, "samt": 0, "csamt": 0 } } ] } ] }
```

Place of supply comes from `gstStateCode`, which takes the buyer GSTIN's first
two digits and falls back to a state-name table. It is covered by
`api/tests/unit/repositories/gstr1-export.test.js`.

Three values are hardcoded and each is a real limitation: `rchrg` is always
`N`, `inv_typ` is always `R` (regular, so SEZ and deemed-export invoice types
cannot be expressed), and `csamt` is always `0`.

### The tax-payable netting

`taxPayablePage` (same file, around line 6106) with
[`api/src/utils/tax-netting.js`](../api/src/utils/tax-netting.js). Output tax
comes from sales, input credit from receivings filtered on `itc_eligible` and
excluding cancelled ones, grouped by calendar month, then netted head by head
in the statutory order. This is the only place in the codebase that treats
IGST, CGST and SGST as separate ledgers rather than one pot, and it is tested.

## Report by report

| Report | Where | What it actually does |
|---|---|---|
| GSTR-1 screen | `gstOneReportPage`, sale repository | Four aggregations. The sales one groups by a ten-field tuple with **no accumulators**, so it is a `DISTINCT`: two lines on one invoice with the same rate and the same line total collapse into one row and the second is lost. |
| GSTR-1 JSON | `gstOneReportPageJson` | Correct. See above. |
| GSTR-2 | inline in `receivings.controller.js` | Aggregation written directly in the controller rather than a repository. Products grouped by item name. |
| GSTR-2B | same endpoint as GSTR-2 | A GSTR-2B-labelled skin over GSTR-2 data. Its "ITC available", "ITC not available" and "ITC reversal" sections are static headings that nothing fills. |
| GSTR-3 | `gstThreeReportPage` | Six aggregations. The taxed-sales group carries the document-level `items_subtotal` in its `_id`, so an invoice with two rates counts its subtotal twice. |
| GSTR-9 | `gstNineReportPage`, on the receiving model | Five aggregations, four of which query `sales`. Takes the branch from the session with no fallback, unlike its sibling reports. |
| Tax summary | `taxSummaryReportTable` | Filters on `updated_date`, not `date`, so editing an old sale moves it into the current period. Its GST position is single-bucket output minus input, with no per-head separation, and it ignores `itc_eligible`. |
| Tax payable | `taxPayablePage` | Correct, per head, monthly. |
| Tax report | `taxSalesReportPage` | Returns raw unwound line documents; all tax arithmetic happens in the browser. |

## GSTR-1, table by table

The GSTR-1 page renders the whole statutory form as static HTML. Four table
bodies are ever populated; the rest are literal zeros or empty.

| Table | Status |
|---|---|
| 4A B2B | **Partial.** Screen table loses duplicate lines; the JSON export is correct. |
| 4B reverse charge | **Absent.** No reverse-charge field exists; `rchrg` is hardcoded. |
| 4C e-commerce | **Absent.** No operator GSTIN on a sale. |
| 5 B2CL, inter-state above the value threshold | **Absent.** No invoice-value test anywhere. |
| 6A exports, 6B SEZ, 6C deemed export | **Absent.** No export flag, shipping bill, port code or LUT. |
| 7 B2CS | **Half.** Only the inter-state part is produced, and not consolidated rate-wise. Intra-state is never filled. |
| 8 nil-rated, exempt, non-GST | **Absent.** Four rows of literal zero. |
| 9B CDNR, registered credit notes | **Partial and mis-filed.** See below. |
| 9B CDNUR, unregistered | **Absent.** Filtered out by the buyer-type condition. |
| 11 advances | **Absent.** No advance concept in the data model. |
| 12 HSN summary | **Present in name.** Grouped by item **name**, and the HSN column is a tax-name string that is blank whenever the line used a tax group. No unit-code column, no rate column. |
| 13 documents issued | **Absent.** Empty table body; no series or cancelled-count aggregation. |

## Returns and credit notes

A return is stored inside the original sale, as `items_return[]` entries with
`return_tax` and `items_return_total` rollups. Only **one** GST report reads
them at all, and it has two defects that both matter at filing time.

- **The credit note is filed in the invoice's month.** The returns aggregation
  reuses the same `filters` object as the sales aggregation, and that object
  filters on the sale's `date`. A credit note raised in October against an
  August invoice appears in **August's** GSTR-1 and is invisible in October's.
- **Unregistered credit notes are dropped.** The same shared filter carries
  `customer_gst_type: { $in: ['regular', 'composite'] }`, so a credit note to a
  walk-in customer never reaches any report. That is table 9B CDNUR, and it is
  simply missing.

Every other GST report ignores returns entirely. GSTR-3, GSTR-9, tax payable
and the tax summary all report output tax **gross of credit notes**. The tax
summary additionally includes `PartialReturn` sales at their full original line
tax with no offset.

The receivings side has a mirror of the same aggregation in which
`return_date` and `return_receiving_date` are populated from each other's
source.

## Purchases and input credit

`taxPayablePage` and `taxPayableRegisterPage` are the good path: `itc_eligible`
gating, a declared-total mismatch flag, a document-present flag, and per-head
netting. Two cruder duplicates of the same idea exist in the tax summary
controller and in the GSTR-3 aggregation, and the tax summary one ignores
`itc_eligible` entirely.

What does not exist:

- **No HSN on purchases at all.** Neither the receiving model nor its
  controller mentions one.
- **No GSTR-2B reconciliation of any kind.** No upload of the portal's 2B
  file, no matched/unmatched/missing classification, no supplier filing status.
  Searches for reconciliation, `gstr2b` and matching terms return nothing
  relevant.
- The receiving repository contains no tax logic whatsoever; it all sits in the
  model and inline in the controller.

## Exemption, reverse charge and cess

**None of these exist as data.** There is no `is_exempt` on an item, no
nil-rated flag, no non-GST marker, no zero-rated or LUT field, no reverse-charge
flag, and no cess rate or amount anywhere in any model.

The consequence is that a shop cannot distinguish a nil-rated good from a good
taxed at zero per cent: the tax summary lumps both into one bucket labelled
"0% / untaxed". GSTR-3B's exempt-inward-supplies row is filled by a **proxy** -
purchases from suppliers whose registration type is consumer or composite -
which is a statement about the supplier, not about the goods.

Cess appears only as column headings in five report pages, literal `0.00`
values written into every cess cell, and the hardcoded `csamt: 0` in the JSON
export, whose comment already says cess stays zero until a product records one.

## Export formats

Only the GSTR-1 JSON is built properly, as a `Blob` with an
`application/json` type and a real filing structure.

GSTR-2, GSTR-2B, GSTR-3 and GSTR-9 all use the same broken pattern: read the
rendered table's column headings as object keys and the formatted cell text as
values, then emit them as a `data:text/csv` URI with a `.json` file extension,
passed through `escape()`. The keys are English column headings, the values are
formatted currency strings, the MIME type contradicts the extension, and
non-ASCII characters are mangled. No filing tool can consume any of it. The
GSTR-1 export was fixed; these four were not.

There is no server-side export for any GST report.

## Tests

| Covered | Not covered |
|---|---|
| `gstOneReportPageJson` (7 tests), tax netting (7), tax engine (11), tax profiles, tax regime, GST 2.0 readiness scan, country tax seeding | `gstOneReportPage` (the screen table), `gstThreeReportPage`, `gstNineReportPage`, `gstTwoReportTable`, `taxPayablePage`, `taxPayableRegisterPage`, `taxSalesReportPage` |

Every aggregation with a known defect above is in the untested column.

## One correction to an earlier document

An automated sweep of this repository reported that HSN codes are never
persisted on a sale line, on the grounds that `sale.model.js` does not declare
the field. That is half true and the conclusion is wrong. The line schema is
declared `strict: false`, and `sale.service.js` (around line 592) does write
`hsncode` and `hsndescription` onto each line from the item master at sale
time. So new sales **do** carry an HSN; sales written before that line existed
do not, which is why the read paths back-fill from the item master for display.

The practical effect for GSTR-1 table 12 is unchanged: the HSN summary does not
use the field. It groups by item name and reports a tax-name string in the HSN
column.

## What "GST ready" would take

In dependency order. Each is a reviewable PR; sizes follow the issue labels.

| # | Work | Unblocks | Size |
|---|---|---|---|
| 1 | A supply-nature field on the item master and a snapshot on the sale line: taxable, exempt, nil-rated, non-GST, zero-rated | GSTR-1 table 8, GSTR-3B's exempt rows, honest zero-rate reporting | medium |
| 2 | A reverse-charge flag on the sale, and an e-commerce operator GSTIN | table 4B, 4C, `rchrg` stops being hardcoded | small |
| 3 | Cess rate and amount on item, sale line and receiving | `csamt` stops being hardcoded; tobacco and similar shops become servable | medium |
| 4 | Move the credit-note aggregation onto the **return's** date and drop the buyer-type filter | table 9B files in the right month; CDNUR appears | small, high value |
| 5 | Rewrite the GSTR-1 screen aggregation to group with accumulators instead of a distinct tuple | duplicate lines stop vanishing | small |
| 6 | HSN summary keyed on the HSN code with quantity, unit code and rate | table 12 becomes real; needs the unit-code work from the e-invoice design | medium |
| 7 | B2CS consolidation and a B2CL value threshold | tables 5 and 7 | medium |
| 8 | A document-issued series aggregation | table 13 | small |
| 9 | Replace the four DOM-scraping exports with server-built JSON in the GSTR-1 export's style | GSTR-2, 3 and 9 exports become usable | medium |
| 10 | Returns accounted for in GSTR-3, GSTR-9, tax payable and the tax summary | output tax stops being overstated | medium |
| 11 | Tests for every aggregation listed as untested above | the defects above stop coming back | medium |
| 12 | GSTR-2B reconciliation: import the portal file, classify matched, unmatched and missing | input credit can be checked rather than assumed | large |

Items 4 and 5 are the best value for their size: both are small, both fix
wrong numbers rather than missing ones, and wrong numbers are worse.

## On filing returns automatically

Preparing a return and submitting one are different problems with different
constraints. Submission is not a matter of writing the client: access to the
GST return APIs is granted through a specific programme with its own
eligibility, and that pathway is documented separately in
[INDIA_GOVERNMENT_INTEGRATION.md](INDIA_GOVERNMENT_INTEGRATION.md). Nothing in
the list above depends on it. A shop that can produce a correct, complete
GSTR-1 JSON and upload it to the portal is filing; the difference is one file
transfer.

The work above should be finished first regardless of which submission route is
chosen, because every route sends the same data.
