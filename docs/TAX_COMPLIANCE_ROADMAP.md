# Tax & Compliance: replacement report and implementation roadmap

Status: proposed implementation specification, 14 October 2026. This document and its mockups do not represent a deployed tax engine or verified customer balances.

## Decision

Replace the fragmented legacy GST reporting screens with **Reports → Tax & Compliance**. Deliver a reliable accountant pack for Bharat Traders first. Build a shared transaction reporting engine with country-specific mappings; do not present a generic sales-minus-purchases calculation as a globally valid tax return.

The user has authorised replacing the existing reports. Retire their screens and calculations after the replacement passes reconciliation and release gates. Preserve original transactions, archived exports, audit history and filed-period evidence. Removing old report code must never delete financial records.

## 1. What exists and what needs to change

This is a source-code audit, not a reconciliation of Bharat Traders' books or a certification of portal acceptance. Paths refer to the repository inspected for this review; line numbers can move.

| Existing area | Evidence | Decision |
|---|---|---|
| GST Reports navigation | `frontend/layouts/sidebar.html` hides the parent menu with `display:none`; children include GSTR-1, 2A, 2B, 3B and 9 | Replace with one visible reporting workspace when the tax module is enabled |
| Generic tax reports | `frontend/static/script/js/core/PosnicPro.js` exposes Tax Report, Tax Summary, Tax Payable and GST Readiness routes | Consolidate their useful views into Overview, Registers and Exceptions |
| GSTR-1 JSON | `frontend/static/script/js/modules/js/report_gstrone.js` builds `gstin`, `fp`, `b2b`; `api/src/repositories/sale.repository.js::gstOneReportPageJson` provides B2B data | Partial export, not a complete GSTR-1 pack; implement supported sections explicitly and block unsupported transactions |
| GSTR-1 guidance | `frontend/modules/report_gstrone.html` still describes the older ₹2.5 lakh B2CL threshold | Replace hard-coded guidance with effective-dated rules and schema versions |
| GSTR-2A / 2B | `report_gstrtwob.js` calls `receivings/gstTwoReportTable` for locally recorded purchases | Rename local data to Purchase Register. Only label imported official statements GSTR-2B |
| GSTR-3B aggregation | `sale.repository.js::gstThreeReportPage` groups purchase records by tax amounts; sale groups include invoice-level subtotal after unwinding lines | Replace aggregation. Identical purchase tax amounts must not collapse; invoice subtotals must not repeat across line groups |
| Generic tax summary | `sales.controller.js::taxSummaryReportTable` uses sales `updated_date`; maps purchase tax directly to `input_tax_credit`; purchase-query failure can leave zero defaults | Use tax-period dates, separate recorded tax from eligible credit, and return an explicit incomplete/error state |
| Legacy period boundaries | GSTR-2A/2B/3B frontend code constructs a month end using day 31 | Replace with timezone-aware calendar periods and exclusive next-period boundaries |
| Annual / JSON exports | GSTR-9 and 2B frontend exporters derive local/table data and use a CSV data URL for JSON | Replace with typed server-generated files and schema validation; don't infer filing readiness from the filename |
| Existing tests | `api/tests/unit/repositories/gstr1-export.test.js`, `api/tests/unit/services/tax-summary.test.js` | Reuse useful fixtures, expand coverage to numerical and statutory boundaries |

Existing tax amounts, invoice lines, supplier/customer information and branch data are useful inputs. Reuse them where reliable, with explicit migration quality flags. Do not recalculate historical tax using today's product tax rate or silently invent missing HSN/place-of-supply information.

## 2. Customer workflow and navigation

**Choose registration and period → review totals → inspect exceptions → review purchase credits → prepare accountant pack → record review/finalisation.** Exporting is not filing.

Header: business, tax registration, period, applicable branches, accounting basis, data cut-off and completeness status. In a single-registration shop, preselect these rather than forcing repeated selections. Multiple registrations remain separate; a cross-registration management view must not resemble one statutory return.

| View | What the user sees | Primary action |
|---|---|---|
| Overview | Net sales, output tax, recorded purchase tax, reviewed credits, adjustments, completeness | Prepare accountant pack |
| Sales | Invoice register, B2B/B2C, tax-rate summaries, HSN/UQC summary, document drill-down | Open invoice / export register |
| Purchases | Supplier invoices, tax components, recorded vs reviewed credits | Review purchase |
| Adjustments | Credit/debit notes, original invoice links, reversals, round-off | Inspect adjustment |
| Reconciliation | Books vs imported statement, matched/unmatched/mismatched records | Review match |
| Exceptions | Missing or invalid information, affected value, source document and resolution | Open source / record decision |
| Exports | Accountant packs, preparation status, versions and export history | Prepare / download |

Use existing Posnic typography and blue accent, readable selected controls, left-aligned page content, touch-sized actions, responsive tables and clear empty/error states. Default page size 25 with 50/100 options. Search and date/branch filters apply to the entire result, not only the visible page. Export covers all filtered records and states the scope.

Configuration belongs under **Settings → Tax → Registrations & Reporting**: registration identifiers, scheme, period frequency, accounting basis, branches, jurisdiction and effective dates. Do not add configuration controls to Features cards. Preserve existing opt-ins; new optional reconciliation/filing workflows default off.

## 3. Bharat Traders: first release

Provide one **Prepare accountant pack** action. The pack contains an Excel workbook and a printable PDF summary, with a data-completeness statement. CSV registers are a fallback for large datasets or other accounting software.

| Workbook sheet | Required content |
|---|---|
| Read me & coverage | Business/GSTIN, period, timezone, registration, branches, basis, snapshot ID, report/rule version, preparation time, review status, missing sources |
| Summary | Gross sales, discounts, credit notes, net taxable value, CGST/SGST/IGST/cess, exempt/zero-rated/out-of-scope totals, purchases, adjustments and round-off separately |
| Sales invoices | Invoice ID/number, document date, tax point, customer, GSTIN, supply state, classification, net/tax/gross, status |
| Sales lines | Invoice link, product, HSN/SAC, quantity, unit/UQC mapping, rate, discount, taxable value and each tax component |
| B2B / B2C | Classification and totals by required reporting dimensions; not merely presence/absence of a customer name |
| HSN summary | HSN/SAC, description, UQC, quantity, taxable value, rate and components, with applicable B2B/B2C separation |
| Purchases | Supplier GSTIN, original supplier invoice number/date, recorded date, taxable value, components, credit-review status |
| Credit & debit notes | Original invoice reference, reason, signed taxable/tax adjustments and reporting period |
| Credit review | Recorded tax, statement match, reviewed eligible, blocked/deferred amounts, reversals, reviewer and reason |
| Exceptions | Severity, affected document, issue, amount, resolution state and reviewer notes |
| Reconciliation | Source totals vs report totals vs export totals, differences, excluded records and reasons |

Hardware units such as kg, metre and feet must retain fractional quantities. Maintain a reviewed mapping from the shop's unit names to official UQC values; do not infer conversions or HSN classifications from a product name alone.

An incomplete draft pack can be downloaded for the accountant with its exceptions clearly included. A reviewed/finalised pack must not be available when blocking errors or source failures remain. External purchases, expenses, imports and other tax adjustments may not be in Posnic: show their coverage explicitly rather than claiming the business's entire liability is known.

### Illustrative report, not Bharat's actual accounts

All values below are synthetic INR. Rates illustrate calculation coverage, not recommended rates for hardware products.

| Entry | Taxable value | CGST | SGST | IGST | Total |
|---|---:|---:|---:|---:|---:|
| Sale DEMO-001, local 18% | 50,000.00 | 4,500.00 | 4,500.00 | 0.00 | 59,000.00 |
| Sale DEMO-002, local 12% | 30,000.00 | 1,800.00 | 1,800.00 | 0.00 | 33,600.00 |
| Sale DEMO-003, interstate 18% | 20,000.00 | 0.00 | 0.00 | 3,600.00 | 23,600.00 |
| Credit CN-DEMO-001 against DEMO-001 | -5,000.00 | -450.00 | -450.00 | 0.00 | -5,900.00 |
| Net | **95,000.00** | **5,850.00** | **5,850.00** | **3,600.00** | **110,300.00** |

Recorded purchase tax: ₹10,800; reviewed credit: ₹9,000; deferred/unreviewed: ₹1,800. Output tax is ₹15,300. The arithmetic difference of ₹6,300 is **not a certified cash payable amount**: tax-head utilisation rules, balances, reverse charge and other adjustments still matter. In the initial overview show output and credit figures separately rather than a misleading single “GST payable” tile. Round-off is a separate amount, not tax. Settlement time may appear on receipts, but must not replace the tax point indiscriminately.

### Cash Book expenses: include existing records, extend tax evidence

Follow-up source audit confirms **Cash Book** exists. `api/src/models/expense.model.js` and `api/src/repositories/expense.repository.js` persist amount, type, category, recipient, approver, description, date and branch. Their inspected create/update paths do not persist structured supplier tax ID, invoice reference, taxable value or tax components. `api/src/models/dashboard.model.js::getProfitSummaryModel` already includes Cash Book amounts in profit calculations subject to `pl_include_cashbook`.

Keep **Money → Cash Book** as the entry point. Reuse its records in **Tax & Compliance → Expenses** and an **Expenses** workbook sheet; do not require entering the same expense again in the reporting workspace. The existing mockup predates this extension and does not yet include the Expenses tab.

- First pack release: export existing expenses by date, branch and category with amount, recipient, description and source ID. Label legacy tax information **Not recorded**, not tax-free or zero-rated. They remain useful to the accountant without being added automatically to input credit.
- Extend expense entry with optional **Tax invoice details**: supplier and tax registration, invoice number/date, document attachment, tax-inclusive/exclusive amounts, taxable base, jurisdiction/components, and credit-review state. Keep basic name/category/amount entry simple.
- Distinguish operating expense, capital purchase, transfer/owner movement and settlement of an existing purchase. New classification must be reviewed for legacy entries; category text alone is insufficient evidence.
- Link a payment for an already-recorded purchase to that purchase ID. Count the tax document once; do not add both a Receiving and its Cash Book settlement to the expense/tax base. Flag probable duplicates for review instead of silently dropping similar rows.
- Invoice-backed expenses can feed the same purchase-credit review pipeline as stock purchases. Recorded tax, matched tax and eligible credit remain separate; capital and reverse-charge cases need their applicable adapter rules.
- Keep report inclusion separate from the Profit & Loss preference. Turning off Cash Book in P&L must not erase expense evidence from the accountant pack or establish tax eligibility.

Add this work to Phase C (expense register/coverage), Phase B (source identity and duplicate protection), and Phase D (expense tax evidence and credit review). Test a plain legacy expense, a tax-bearing expense, a capital purchase, a transfer, a Cash Book payment linked to a Receiving, and mixed taxable/non-taxable expense lines. Never infer a tax split from an old lump-sum amount.

## 4. International approach

Build a common tax ledger and accountant pack, then versioned country adapters. A country label alone must never imply that its return is supported. Each adapter has a visible maturity level: generic records, accountant-reviewed mappings, validated export, or filing integration.

| Region | Planned reporting extension | Boundary |
|---|---|---|
| India | GST components, supply classification, HSN/UQC, GSTR-1 sections, GSTR-3B working paper, official 2B reconciliation | E-invoicing, annual returns, composition and direct filing require distinct scope and validation |
| UK | VAT account, output/input adjustments, return-box mapping and scheme-aware tax points | MTD API submission is a separate integration; a workbook is not a complete MTD solution |
| EU | Country VAT codes and return mapping, cross-border classifications | Each country's return and OSS/IOSS need separate adapters |
| Australia | GST/BAS mappings including G1, 1A and 1B where appropriate | Other BAS obligations are outside a GST-only report |
| Canada | GST/HST sales, input tax credits and adjustments | Provincial taxes and different schemes need their own mappings |
| United States | State/local jurisdiction, taxable/exempt sales, collected tax, exemption evidence | Do not use the GST purchase-credit model; sales/use tax filing varies by jurisdiction |
| UAE | VAT return mapping and emirate-related dimensions | Validate local return rules before advertising filing export |
| Singapore | GST F5 working paper and input/output adjustments | Direct submission requires its own API and authorisation work |

Prioritise India for Bharat first. Select the next country from actual customer demand. Unsupported countries still receive clearly labelled transaction registers, without invented return boxes or a “ready to file” badge.

## 5. Technical implementation

### Canonical records

Introduce a reporting service independent of frontend tables. Each tax document/line snapshot needs tenant, registration, branch, source ID/revision, document type/number, original-document link, document date, tax point, settlement date, currency/exchange information, counterparty tax identity, supply jurisdiction, product classification, quantity/unit, taxable base, rate/components, exemption status and provenance.

Use decimal arithmetic or currency-scaled integers with explicit rounding policy. Store tax components at source precision. Do not multiply floating-point display values or round every report row independently. A tax period uses a timezone-aware inclusive start and exclusive next-period start.

Maintain signed adjustment records. A cancellation, return and deletion must not each reverse the same transaction. Editing a finalised period creates a traceable amendment; it must not silently rewrite an exported snapshot. Historical documents missing required attributes become exceptions with evidence, not guessed values.

### Service boundaries and candidate endpoints

Names below are proposed, to be fitted to repository conventions during implementation.

- `tax-reporting/ledger`: normalise sales, purchases, returns and adjustments.
- `tax-reporting/adapters/{country}`: effective-dated classification, validation and return mappings.
- `POST /tax-reports/runs`: validate scope, create a stable report snapshot and record source cut-off.
- `GET /tax-reports/runs/:id`: completeness, totals, exceptions and versions.
- `GET /tax-reports/runs/:id/documents?cursor=...`: consistent register pagination.
- `POST /tax-reports/runs/:id/exports`: idempotent background export job.
- `POST /tax-reports/imports`: staged official-statement upload, validation and preview before acceptance.
- `POST /tax-reports/runs/:id/review`: authorised decision, reviewer, timestamp and reasons.

Every request enforces tenant, registration and branch permissions server-side. Separate view, export, credit-review, finalise and settings rights. Sanitize spreadsheet cells against formula injection. No credentials or unnecessary customer data in export logs.

### Large records and recovery

Use server-side jobs, indexed period queries, cursor pagination and streamed output. Browser local storage may remember filters; it must not become the authoritative tax ledger or the only copy of an export job. A closed browser or desktop restart must not lose preparation progress.

Freeze a run's source cut-off, use idempotency keys, show progress, support safe retry and expire signed download URLs. Break oversized workbooks into documented parts or CSV files before Excel limits. Store manifests, row counts, totals, hashes and schema versions. An export failure must never offer a partial file as complete.

Include offline-till sync status and source watermarks. If a source is unavailable or unsynced, mark the run incomplete. Do not silently substitute zero. Late records require a new run/version and review.

### State model

Draft → Needs attention → Ready for review → Reviewed/finalised. Export jobs have separate Queued → Preparing → Ready / Failed states. Downloading does not change the review status. “Filed” requires external acknowledgement or explicitly recorded filing evidence, never a successful download.

## 6. Delivery roadmap and release gates

| Phase | Deliverable | Release gate |
|---|---|---|
| A: inventory and contracts | Legacy route/API inventory, fixtures, source coverage, registration model, report schema | Known numerical defects reproduced; source/report/export totals contract agreed |
| B: trustworthy core | Canonical ledger, stable dates, signed adjustments, exact arithmetic, tenant checks | Regression cases pass; no hidden partial-source success |
| C: Bharat accountant pack | Overview/registers/exceptions, Excel + PDF, background exports, draft/review states | An accountant reconciles a representative period to invoices and purchase records; no unexplained difference |
| D: purchase-credit reconciliation | Import official GSTR-2B, duplicate checks, match review, eligibility decisions | Missing/mismatched/duplicate cases handled; a match alone never grants credit |
| E: India statutory exports | Supported GSTR-1 sections and validated schemas; GSTR-3B working paper | Effective-date rules, official-tool validation and accountant review; unsupported cases block final return export |
| F: country adapters | Next demanded jurisdiction, then additional countries | Local source documentation, fixtures and local accountant approval per adapter |
| G: optional filing | Authorised government/API integration, acknowledgements and retry handling | End-to-end certification/requirements met; explicit customer opt-in |

Phases A–C are the first useful release. D–G are separate increments. Do not hold Bharat's usable accountant pack until every jurisdiction is implemented. Delivery dates should be estimated after A; this is a dependency roadmap, not a promised calendar.

## 7. Acceptance tests

1. Two purchases with identical tax amounts both contribute to totals.
2. A multi-line, multi-rate invoice counts its gross value once; line tax totals reconcile.
3. February, leap years, month-end and timezone boundaries include each document once.
4. Editing a customer/product today does not move an old invoice into today's tax period.
5. Returns in a later period, partial returns, credit/debit notes, cancellations and deletions reverse once with original references.
6. Current product tax changes do not rewrite historical tax snapshots.
7. Registered/unregistered sales, interstate/local supply, zero-rated/exempt/out-of-scope and missing classification remain distinguishable.
8. Applicable B2CL thresholds and HSN rules switch by effective date; test below, at and above thresholds.
9. Fractional kg/metre/feet quantities retain precision and explicit UQC mappings.
10. Recorded purchase tax differs correctly from eligible, blocked, deferred and reversed credit.
11. Missing purchase source, offline till and late sync yield incomplete status, never a false zero.
12. Overview, full register, every export part and snapshot manifest reconcile exactly.
13. Large exports survive browser closure, retry and interrupted workers without duplicate rows; target test dataset at least 100,000 lines and a separate workbook-limit case.
14. Cross-tenant and unauthorised branch access fail for run IDs, uploads and downloads.
15. Spreadsheet formula-like product/customer names remain text; malformed imports are quarantined with row-level errors.
16. Dark/light themes, keyboard use and narrow screens preserve readable text and usable controls.

## 8. Retiring legacy reports

Inventory consumers before deleting routes. Keep old exports read-only and identifiable as legacy. Run the replacement alongside source-level fixtures and representative periods; differences from known-bad legacy totals should be explained, not forced to match. Redirect legacy navigation to the new workspace only once equivalent useful coverage exists. Replace misleading 2A/2B purchase screens with accurately labelled registers/reconciliation. Remove unused frontend/repository code and tests only after dependencies are covered by replacement tests. Preserve backups and a rollback route for the release.

Ship through the user's required sequence: feature branch → develop → main. Run relevant local tests and repository checks first. No additional CI workflows are needed for this roadmap. Deployment and live accountant reconciliation are distinct from merging.

## 9. Research references and maintenance

Rules must be rechecked during implementation and each statutory export release. This specification is a software design, not a complete statement of every country's tax law.

- [GSTN GSTR-1 creation guide](https://tutorial.gst.gov.in/userguide/returns/Creation_of_Outward_Supplies_Return_in_GSTR-1.htm): current classifications and effective-date guidance; legacy ₹2.5 lakh wording must not drive current B2CL classification.
- [GSTN HSN Table 12 advisory](https://tutorial.gst.gov.in/downloads/news/updated_advisory_hsn_table12_25042025.pdf): May 2025 B2B/B2C HSN changes.
- [GSTN GSTR-2B FAQ](https://tutorial.gst.gov.in/userguide/returns/FAQ_gstr2b.htm): official statement derives from supplier/other portal data; it is not the shop's local purchase register and does not alone establish every eligibility condition.
- [HMRC VAT digital records](https://www.gov.uk/charge-reclaim-record-vat/keeping-vat-records) and [MTD service guide](https://developer.service.hmrc.gov.uk/guides/vat-mtd-end-to-end-service-guide/): preserve tax-point evidence and separate reporting from submission integration.
- [European Commission VAT returns](https://taxation-customs.ec.europa.eu/taxation/vat/vat-directive/vat-returns_en): national return obligations and special schemes require distinct mappings.
- [ATO Simpler BAS](https://softwaredevelopers.ato.gov.au/SimplerBAS): G1, 1A and 1B reporting dimensions.
- [CRA GST/HST return instructions](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/calculate-prepare-report/instructions-preparing-return.html): Canadian return mapping reference.
- [California sales/use tax programmes](https://www.cdtfa.ca.gov/taxes-and-fees/sutprograms.htm): example of jurisdiction-specific US requirements, not a nationwide return specification.
- [UAE VAT return guide](https://tax.gov.ae/-/media/Files/EN/PDF/Guides/VAT-Returns-User-Guide.pdf) and [IRAS completing GST returns](https://www.iras.gov.sg/taxes/goods-services-tax-%28gst%29/filing-gst/completing-gst-returns): adapter research starting points.

Assign an owner for country rules, record source/review dates, version rules by effective date, and test historical periods against the rule version that applies. Never change historical exports silently when a rule adapter is upgraded.
