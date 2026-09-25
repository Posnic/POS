Accounting export boundaries: TallyPrime and Zoho Books

Related issues: #99 and parent #34

Purpose

This document defines a conservative first accounting-export path for Posnic.
It describes what accounting-relevant data can be prepared for export and how
that data differs between TallyPrime and Zoho Books.

This is a documentation contract, not a live connector. It does not claim that
Posnic currently synchronizes with either product, and it does not define an
API integration.

What Posnic currently has

The current Posnic sales model contains the core information needed for an
accounting handoff, including:

sale/invoice identity and date (sales_id, date)

customer identity and billing details, including GST fields

invoice line items with item name/SKU, quantity, unit price, discount and tax

item-level tax information, including CGST, SGST and IGST fields

sale totals, subtotal, discount, tax and return totals

payment information, including payment amount, date, method and reference

payment status, pending amount and balance information

sale-level returns and return tax/discount totals

item master information including SKU/item ID, selling price, tax and HSN code

branch information needed to identify the source outlet

The invoice module is intentionally not treated as a second accounting ledger:
the repository documents the sale as the accounting event, while an invoice
mirrors the sale's payment state after issue. Therefore an export should keep
the sale/invoice relationship intact instead of inventing a separate payment
ledger.

Minimum accounting export data

The first export contract should preserve the following categories.

Category

Export information

Posnic source/notes

Sales

document number, date, subtotal, discount, tax, total, round-off

Sale record contains these aggregates.

Tax split

tax rate, taxable value where available, CGST, SGST, IGST and total tax

Sale line items contain tax rate/amount and CGST/SGST/IGST fields; sale records also contain tax aggregates.

Invoices

invoice/document number, date, customer, line items, quantities, prices, discounts, taxes and total

Issued invoices are tied to the sale; keep the document identity and line-level detail together.

Customers

customer ID, name, company name, phone/email where appropriate, billing address, state/country, GST type and GST number where present

Customer and sale records contain these fields. Do not require optional fields to be populated.

Items

item ID/SKU, item name, unit, selling price, tax information and HSN code where present

Item and sale-line records contain these values.

Payments

payment amount, payment date, payment method and reference; preserve partial-payment state

Sale payments are stored as payment entries; the sale also carries payment status/pending/balance fields.

Returns / credit notes

original document reference, returned item/quantity, return date/value and tax adjustment where available

Posnic stores sale returns. A separate accounting credit-note number is not currently generated for these returns.

The export should preserve identifiers that let an accounting user trace a
payment or return back to its source sale. It should not silently turn a
return into a negative sale.

Recommended first export format

The safest first step is a reviewable export file, with CSV as the proposed
human-readable interchange format for the generic Posnic export.

A possible export bundle is:

accounting-export/
  customers.csv
  items.csv
  invoices.csv
  invoice-items.csv
  payments.csv
  returns.csv

These filenames describe a proposed Posnic export contract. They are not
claims that TallyPrime or Zoho Books will accept these exact files without
mapping.

A useful normalized field set is:

customers.csv

customer_id
customer_name
company_name
phone
email
billing_address
city
state
country
pincode
gst_type
gst_number

items.csv

item_id
sku
item_name
unit
selling_price
tax_rate
tax_name
hsn_code

invoices.csv

invoice_number
invoice_date
customer_id
subtotal
discount
taxable_amount
tax_amount
cgst
sgst
igst
round_off
total
payment_status
balance

invoice-items.csv

invoice_number
item_id
sku
item_name
quantity
unit_price
discount
tax_rate
tax_amount
cgst
sgst
igst
line_total

payments.csv

payment_id
invoice_number
payment_date
payment_method
amount
reference
notes

returns.csv

return_id
original_invoice_number
return_date
item_id
item_name
quantity
return_value
tax_amount
cgst
sgst
igst

The actual exporter should only populate fields that exist in Posnic. Empty or
unavailable fields should not be fabricated.

TallyPrime assumptions

TallyPrime's current official documentation says its Import Data feature can
bring masters and transactions from other ERP/accounting systems using Excel,
XML or JSON. It also documents importing masters before transactions when the
transactions depend on those masters.

Sources:

TallyHelp: Import Data into TallyPrime

TallyHelp: Import Data from JSON or XML into TallyPrime

Boundary for Posnic

The generic Posnic CSV described above is a reviewable source export, not a
claim of direct TallyPrime compatibility.

A future Tally-specific adapter would need to map Posnic data to the destination
TallyPrime company's masters, ledgers, voucher types, tax configuration and
other company-specific requirements. This issue does not define or implement
that adapter.

For a future Tally export path, the relevant source data includes:

customer/account master information

item/master information where required

invoice/sales transaction data

tax split and applicable tax information

payment/receipt information

return/adjustment information where the target accounting workflow supports
it

The destination company's configuration must be treated as an input to any
future Tally-specific mapping. The generic export must not invent ledger names
or voucher configuration.

Zoho Books assumptions

Zoho Books officially supports spreadsheet-style imports for several relevant
sales/accounting records:

Customers/vendors can be imported from CSV, TSV or XLS, with field mapping.

Invoices can be imported from CSV, TSV or XLS, with field mapping.

Credit notes can be imported from CSV, TSV or XLS, with field mapping.

Sources:

Zoho Books: Customers & Vendors

Zoho Books: Invoices

Zoho Books: Credit Notes

Zoho's migration documentation also treats invoices and payments received as
separate sales transactions when migrating from Tally, which reinforces the
need to preserve invoices and payments as distinct export records.

Source:

Zoho Books: Migrate from Tally to Zoho Books

Boundary for Posnic

The proposed CSV export is compatible with the general kind of file-based
workflow Zoho Books documents, but it must still be mapped to the import fields
required by the target Zoho Books organization. This issue does not promise
that Posnic's proposed headers are a drop-in Zoho Books import template.

Zoho Books also exposes APIs for invoices, customer payments and credit notes.
Those APIs are deliberately out of scope for this issue.

Source:

Zoho Books API: Customer Payments

Zoho Books API: OAuth scopes

Payments and partial payments

Payments should remain separate from invoice totals in the export.

Posnic supports payment entries containing an amount, date, method, reference
and notes, and its sale/invoice flow also tracks payment status, pending amount
and balance. A future export should therefore be able to represent:

invoice total
        |
        +-- payment 1
        +-- payment 2
        +-- ...
        |
        +-- remaining balance

This is preferable to replacing the invoice total with the amount paid.

Zoho Books' official customer-payment API likewise models payments separately
and associates them with invoices. This is background evidence only; no API
integration is proposed here.

Returns and credit notes

Posnic currently records sale returns and return totals/taxes. Its e-invoice
validation also explicitly notes that a sale with a return requires a credit
note with its own number for filing, and that Posnic does not currently produce
that accounting credit-note number.

Therefore the first export should:

preserve the original invoice/sale reference;

export the returned item/quantity/value and tax adjustment where available;

avoid pretending that a Posnic return is already a finalized accounting
credit note; and

leave creation/mapping of the target accounting system's credit note to a
future workflow.

Zoho Books supports importing credit notes from CSV, TSV or XLS, so a future
Zoho-specific export can map the Posnic return information to a credit-note
workflow once the required Posnic credit-note identity and accounting rules are
agreed.

Source:

Zoho Books: Credit Notes

Privacy and safety boundaries

Development and documentation must use synthetic data only.

Do not commit or publish:

real customer names, phone numbers, email addresses or addresses;

real GSTINs or other tax identifiers;

real invoices, sales or payment records;

API keys, OAuth tokens, passwords or cookies;

production database files or unredacted logs; or

production accounting payloads.

The export design must remain useful for the local/community edition and must
not require Posnic Cloud.

Out of scope

This issue does not implement or promise:

live TallyPrime synchronization;

live Zoho Books synchronization;

TallyPrime or Zoho Books API clients;

OAuth or API-key handling;

automatic ledger/account creation;

automatic reconciliation;

automatic GST return filing; or

automatic tax-return filing.

Those are separate future design/implementation work.

Suggested future boundary

If a future connector is proposed, keep the layers separate:

Posnic sales/invoice data
          |
          v
reviewable normalized export
          |
     +----+----+
     |         |
     v         v
 Tally map  Zoho map
     |         |
     v         v
TallyPrime  Zoho Books

The offline POS should continue to work when no accounting connector is
configured or available.

Validation

For this documentation-only change:

git diff --check
npm run check:attribution

No live accounting service, company account, API credential or production data
is required for validation.