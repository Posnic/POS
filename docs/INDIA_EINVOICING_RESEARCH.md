# India GST e-invoicing: what the regime requires

What the law, the Invoice Registration Portals (IRPs) and their APIs actually
demand of an invoice, gathered so that Posnic's design can cite a source for
each rule instead of a memory of one. Research date: **2 September 2026**.

Primary sources are the NIC developer portal
([einv-apisandbox.nic.in](https://einv-apisandbox.nic.in/)), the IRP portals
(einvoice1, einvoice2, einvoice6), CBIC notifications and GSTN advisories.
Where only a secondary source (a GSP's documentation, a tax publisher) was
available the fact is marked **[secondary]**. Anything that could not be
confirmed is marked **UNCONFIRMED** and listed again at the end. Rules change;
before an implementation PR relies on a number here, re-check the linked
source.

Companions: [INDIA_EINVOICING_READINESS.md](INDIA_EINVOICING_READINESS.md)
(what the code has) and [INDIA_EINVOICING_DESIGN.md](INDIA_EINVOICING_DESIGN.md)
(what to build). Parent issue:
[#29](https://github.com/Posnic/POS/issues/29). This is not tax advice.

## 1. Who must e-invoice, and for which documents

**Legal basis.** Rule 48(4) of the CGST Rules with Notification 13/2020-Central
Tax as amended. A notified person's invoice that was not registered on an IRP
"shall not be treated as an invoice" (Rule 48(5))
([overview](https://taxguru.in/goods-and-service-tax/overview-e-invoicing-gst.html),
[Rule 48(4) on einvoice6](https://einvoice6.gst.gov.in/content/e-invoice-under-gst-as-per-rule-484-of-cgst-rules-2017/)).

**Threshold.** Aggregate annual turnover (AATO) in *any* financial year since
2017-18:

| From | AATO above | Notification |
|---|---|---|
| 1 Oct 2020 | 500 crore | 13/2020-CT as amended by 61/2020-CT |
| 1 Jan 2021 | 100 crore | 88/2020-CT |
| 1 Apr 2021 | 50 crore | 05/2021-CT |
| 1 Apr 2022 | 20 crore | 01/2022-CT |
| 1 Oct 2022 | 10 crore | 17/2022-CT |
| **1 Aug 2023** | **5 crore** | **10/2023-CT** |

([Tally on the 5 crore step](https://tallysolutions.com/gst/e-invoice-from-august-2023/),
[taxreply](https://taxreply.com/gst/E-invoice_limit_reduced_to_Rs__5_Crores_w_e_f__01st_August_2023-1223.html);
the sandbox enablement timeline on the
[NIC portal home](https://einv-apisandbox.nic.in/) corroborates the phases.)
No notification lowering it further was found as of the research date; 2026
secondary sources say 5 crore still applies for 2026-27 **[secondary]**.
Posnic's `india_turnover_above_5cr` setting is therefore the right gate.

**Exempt suppliers** (the exemption follows the *seller*, never the buyer):
insurers, banks, financial institutions including NBFCs, goods transport
agencies, passenger transport, multiplex cinema admissions (13/2020-CT); SEZ
*units*, not developers (61/2020-CT); government departments and local
authorities (23/2021-CT); OIDAR registrants
([FAQ mirror](https://taxguru.in/goods-and-service-tax/faqs-e-invoice-irn-system-gst.html)).
NIC enforces this technically: the supplier GSTIN must be taxpayer type REG or
SED ([generate IRN validations](https://einv-apisandbox.nic.in/version1.03/generate-irn.html)).
Casual taxable persons were enabled on 16 Dec 2025
([release notes](https://einv-apisandbox.nic.in/release-notes.html)).

**Documents in scope:** tax invoices (`INV`), credit notes (`CRN`) and debit
notes (`DBN`) for B2B, SEZ, export and deemed-export supplies. **Out of
scope:** B2C invoices, bills of supply, ISD invoices, wholly exempt or
nil-rated supplies, imports. The NIC IRP rejects a B2C payload outright.

**B2C.** The 54th GST Council (9 Sep 2024) recommended a voluntary pilot in
selected sectors and states
([PIB](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2053233)). As of the
research date no CBIC notification, GSTN advisory or IRP release note announces
the pilot's go-live, its participants or a B2C schema. **UNCONFIRMED** launch;
treat B2C IRN generation as unavailable and design so it can be switched on
later.

**The 30-day reporting window.** An IRP refuses a document whose date is more
than 30 days before it is reported (error 2305). It applies to AATO of 100
crore and above since 1 Nov 2023 and to **10 crore and above since 1 Apr
2025**; below 10 crore there is no limit "at this time"
([GSTN advisory, einvoice2 PDF](https://einvoice2.gst.gov.in/Documents/advisory270325.pdf),
[einvoice6](https://einvoice6.gst.gov.in/content/revised-time-limit-for-e-invoice-reporting-for-businesses-with-aato-of-%E2%82%B910-crores-above/)).
This is the reason for the design's `india_turnover_above_10cr` setting.

**Dynamic QR on B2C invoices** (AATO above 500 crore, Notification 14/2020-CT
as amended, Circular 146/02/2021) is a self-generated *payment* QR carrying
payee UPI or bank details, invoice number and totals. It is unrelated to the
IRP's signed QR and out of scope for Posnic's target shops
([Circular 146](https://cbic-gst.gov.in/pdf/Circular_Refund_146.pdf)).

## 2. Where invoices are registered: the IRP landscape

Six portals, five operators, all free at the basic level; a taxpayer may use
any, and an IRN is unique across all of them
([GSTN master portal](https://einvoice.gst.gov.in/einvoice/dashboard)):

| Portal | Operator |
|---|---|
| einvoice1.gst.gov.in, einvoice2.gst.gov.in | NIC (IRP1, IRP2) |
| [einvoice3.gst.gov.in](https://einvoice3.gst.gov.in/) | Cygnet Infotech |
| einvoice4.gst.gov.in / [clearirp.in](https://clearirp.in/) | Clear (Defmacro) |
| einvoice5.gst.gov.in | EY |
| [einvoice6.gst.gov.in](https://einvoice6.gst.gov.in/content/) | IRIS Business Services |

Zoho, GSTZen, Masters India and similar are GST Suvidha Providers (GSPs) or
application providers that route to an IRP, not IRPs themselves.

### Access models on the NIC IRP

Two credential sets are always involved
([API credentials](https://einv-apisandbox.nic.in/apicredentials.html),
[API FAQ](https://einv-apisandbox.nic.in/FaqsonAPI.html)):

- `client_id` / `client_secret`, issued to a GSP, an ERP vendor, an e-commerce
  operator, or directly to a notified taxpayer. Reusable across all GSTINs of
  one PAN.
- A per-GSTIN API `username` / `password`, created by the taxpayer on the
  production portal (API Registration, Create API User), selecting "direct",
  "through GSP" or the named ERP. The taxpayer may freeze it at any time and is
  told not to share it with a provider.

| Route | Who gets the client credentials | What the shop must do | Notes |
|---|---|---|---|
| Direct | the taxpayer | whitelist up to four static Indian IPs (4-5 days), submit a test summary report | the [onboarding page](https://einv-apisandbox.nic.in/onboarding.html) still carries stale "above 500 crore" wording; sources disagree on the current floor (10 crore per [ClearTax](https://cleartax.in/s/e-invoicing-api-integration-modes), 100 crore per Zoho) **[secondary, UNCONFIRMED]** |
| Through a GSP | the GSP | create an API user "through GSP" | any taxpayer; the shop pays the GSP |
| Through an ERP | the ERP vendor, after onboarding | create an API user naming the ERP | the natural route for a software vendor; the vendor's client secret must then reach the IRP from somewhere the vendor controls |
| E-commerce operator | the operator | - | generates on behalf of suppliers with `EcmGstin` |

A desktop till cannot realistically satisfy static-IP whitelisting, which is
why the design treats direct NIC access as impractical for the local edition
and reasons about GSP-per-shop credentials or a vendor-controlled relay.

### Session and cryptography (NIC v1.04)

([authentication](https://einv-apisandbox.nic.in/version1.04/authentication.html))

- The client generates a random 32-byte `AppKey`. `{UserName, Password,
  AppKey (Base64), ForceRefreshAccessToken}` is Base64-encoded and RSA
  encrypted (PKCS#1 padding) with the IRP public key.
- The response carries `AuthToken`, `Sek` (an AES-256 session key, itself
  encrypted with the `AppKey`) and `TokenExpiry`.
- Every later request and response payload is AES-256 encrypted with the
  session key and Base64-encoded.
- Tokens live **360 minutes in production, 60 in the sandbox**; re-authenticate
  near expiry, never per transaction.
- `SignedInvoice` and `SignedQRCode` are JWTs (SHA256 RSA) verifiable with the
  same public key.

### Sandbox

[einv-apisandbox.nic.in](https://einv-apisandbox.nic.in/): register as a
taxpayer, GSP, ERP or ECO with PAN/GSTIN and OTP; credentials arrive by SMS;
**no IP whitelisting in the sandbox**. Published test GSTINs include
`33GSPTN1882G1Z3`, `27GSPMH1881G1ZH`, `27GSPMH1882G1ZG`, `33GSPTN3381G1Z5`,
`33GSPTN3382G1Z4`, `27GSPMH3381G1ZI`; more can be added. The sandbox currently
accepts document dates from 1 Apr 2025 only. Production onboarding wants a
test summary report; "50 success and 50 failed cases per API" is the figure
GSPs quote **[secondary]**.

## 3. The schema: FORM GST INV-01, version 1.1

Notified by Notification 60/2020-CT (30 Jul 2020)
([taxguru](https://taxguru.in/goods-and-service-tax/cbic-notifies-revised-format-schema-e-invoice-gst.html)).
About 132 attributes, of which 28 are mandatory and 18 conditional
([GSTN count via nasscom](https://community.nasscom.in/communities/policy-advocacy/gst-update-cbic-notifies-revised-e-invoice-schema-and-applicability-of-e-invoicing.html)).
The authoritative attribute list is NIC's
[Generate IRN specification](https://einv-apisandbox.nic.in/version1.03/generate-irn.html);
the regex patterns below are mirrored in
[ClearTax's schema page](https://docs.cleartax.in/cleartax-docs/e-invoicing-api/e-invoicing-api-reference/resources-and-master/e-invoice-object)
**[secondary]**. Dates are `DD/MM/YYYY`. Strings must not contain `"` or
`\`. Payload limit 2 MB. M = mandatory, C = conditional, O = optional.

| Section, attribute | Req | Constraint |
|---|---|---|
| `Version` | M | `"1.1"` |
| `TranDtls.TaxSch` | M | `"GST"` |
| `TranDtls.SupTyp` | M | `B2B`, `SEZWP`, `SEZWOP`, `EXPWP`, `EXPWOP`, `DEXP` |
| `TranDtls.RegRev` | O | `Y` / `N`, reverse charge |
| `TranDtls.EcmGstin` | C | e-commerce operator's GSTIN |
| `TranDtls.IgstOnIntra` | O | `Y` / `N`; needs `RegRev = Y` |
| `DocDtls.Typ` | M | `INV`, `CRN`, `DBN` |
| `DocDtls.No` | M | 1-16 chars, `^([a-zA-Z1-9]{1}[a-zA-Z0-9/-]{0,15})$`; unique per financial year; cannot start with `0`, `/`, `-` |
| `DocDtls.Dt` | M | `DD/MM/YYYY`, not in the future |
| `SellerDtls.Gstin` | M | 15 chars; first two digits equal `Stcd` |
| `SellerDtls.LglNm` | M | 3-100; `TrdNm` O 3-100 |
| `SellerDtls.Addr1` | M | 1-100; `Addr2` O 3-100 |
| `SellerDtls.Loc` | M | 3-50 |
| `SellerDtls.Pin` | M | 100000-999999, must map to `Stcd` |
| `SellerDtls.Stcd` | M | state code `01`-`38`, `97` |
| `SellerDtls.Ph`, `Em` | O | 6-12 digits; 6-100 |
| `BuyerDtls.Gstin` | M | 15 chars; `URP` only for exports |
| `BuyerDtls.LglNm` | M | 3-100; `TrdNm` O |
| `BuyerDtls.Pos` | M | place-of-supply state code; `96` for export |
| `BuyerDtls.Addr1`, `Loc`, `Pin`, `Stcd` | M | as seller; `Addr2`, `Ph`, `Em` O |
| `DispDtls`, `ShipDtls` | O blocks | dispatch-from and ship-to; each with name, address, `Loc`, `Pin`, `Stcd` |
| `ItemList[]` | M | 1-1000 items |
| `ItemList[].SlNo` | M | numeric string 1-6, unique |
| `ItemList[].PrdDesc` | O | 3-300 |
| `ItemList[].IsServc` | M | `Y` / `N` |
| `ItemList[].HsnCd` | M | 4, 6 or 8 digits, `^(?!0+$)([0-9]{4}\|[0-9]{6}\|[0-9]{8})$`, valid in the GST master; services in chapter 99 |
| `ItemList[].Barcde` | O | 3-30 |
| `ItemList[].Qty`, `Unit` | C | mandatory for goods; `Unit` is a UQC code 3-8 chars; `Qty` up to three decimals |
| `ItemList[].FreeQty` | O | |
| `ItemList[].UnitPrice` | M | up to three decimals |
| `ItemList[].TotAmt` | M | `Qty x UnitPrice` |
| `ItemList[].Discount`, `PreTaxVal` | O | |
| `ItemList[].AssAmt` | M | `TotAmt - Discount` |
| `ItemList[].GstRt` | M | must be in the IRP rate master |
| `ItemList[].IgstAmt`, `CgstAmt`, `SgstAmt` | M | pass `0` where not applicable |
| `ItemList[].CesRt`, `CesAmt`, `CesNonAdvlAmt`, `StateCesRt`, `StateCesAmt`, `StateCesNonAdvlAmt`, `OthChrg` | O | |
| `ItemList[].TotItemVal` | M | `AssAmt` + all taxes and cess + `OthChrg` |
| `ItemList[].OrdLineRef`, `OrgCntry`, `PrdSlNo`, `BchDtls`, `AttribDtls[]` | O | |
| `ValDtls.AssVal` | M | sum of `AssAmt` |
| `ValDtls.CgstVal`, `SgstVal`, `IgstVal`, `CesVal`, `StCesVal` | M | `0` where not applicable |
| `ValDtls.Discount`, `OthChrg` | O | invoice level |
| `ValDtls.RndOffAmt` | O | -99.99 to +99.99 |
| `ValDtls.TotInvVal` | M | sum of `TotItemVal` - `Discount` + `OthChrg` + `RndOffAmt` |
| `ValDtls.TotInvValFc` | O | foreign currency total |
| `PayDtls` | O | payee name, account, mode, terms, `PaidAmt`, `PaymtDue` |
| `RefDtls.PrecDocDtls[]` | O | `InvNo` 1-16, `InvDt`, `OthRefNo` - how a `CRN` names the invoice it credits |
| `RefDtls.InvRm`, `DocPerdDtls`, `ContrDtls[]` | O | |
| `AddlDocDtls[]` | O | URL, Base64 document, info |
| `ExpDtls` | O | shipping bill, port, currency, country |
| `EwbDtls` | O | transporter, mode, `Distance` (mandatory when present), vehicle |

## 4. Validation rules that will reject a POS invoice

From the NIC [Generate IRN validations](https://einv-apisandbox.nic.in/version1.03/generate-irn.html)
unless noted.

- **Duplicate.** Same supplier GSTIN, financial year, `Typ` and `No` gives
  error 2150. A cancelled IRN cannot be regenerated and its document number
  cannot be reused in that year. Never send identical payloads concurrently
  ([Note on top errors](https://einv-apisandbox.nic.in/NoteonTopErrors.html)).
- **Financial year** is derived from `Dt` (1 April to 31 March).
- **Dates.** No future date (2163). Not older than 30 days for AATO of 10 crore
  and above (2305). Production has historically enforced an earliest-date
  floor as well; the current floor for taxpayers below the 30-day rule is
  **UNCONFIRMED**.
- **GSTIN and state.** The first two digits of seller and buyer GSTIN must
  equal their `Stcd` (exports excepted). The buyer GSTIN must be active or
  suspended on the document date. The supplier must be active.
- **PIN and state.** Exact match against the state-PIN master, with a fallback
  on the first three digits (3038, 3039).
- **HSN.** The schema allows 4, 6 or 8 digits, but taxpayers with AATO of 5
  crore and above must report **at least 6 digits**, and IRPs have blocked
  4-digit codes from them since 15 Dec 2023
  ([taxscan](https://www.taxscan.in/important-update-gst-taxpayers-exceeding-5-crores-aato-must-include-6-digit-hsn-in-e-invoices-from-dec-15-2023/349822),
  [einvoice6](https://einvoice6.gst.gov.in/content/gst-hsn-code-reporting-in-e-invoicing-on-irp-portals/)).
  Since the mandate itself starts at 5 crore, **6 digits is the effective
  minimum** for anyone e-invoicing. Use a real 8-digit code rather than a
  fabricated 6-digit one. Services use a 6-digit SAC in chapter 99.
- **Rates.** Only rates in the IRP master are accepted (2240). `GstRt` on an
  intra-state line is the combined CGST + SGST rate. 40% was added to the
  master on 21 Sep 2025 ([IRIS release notes](https://einvoice6.gst.gov.in/content/release-notes/));
  withdrawn slabs such as 12% remain in the master for legacy-dated documents.
  The exact current list is **UNCONFIRMED** in this document; fetch it from
  the portal's [Master Codes](https://einvoice1.gst.gov.in/Others/MasterCodes)
  when the validation PR is written. Posnic's own `gst_rates_2025.json` says
  which slabs are live under GST 2.0.
- **Arithmetic.** `AssAmt = TotAmt - Discount`. Intra-state:
  `CgstAmt = SgstAmt = AssAmt x GstRt / 2 / 100`. Inter-state:
  `IgstAmt = AssAmt x GstRt / 100`. `TotItemVal = AssAmt + taxes + cess +
  OthChrg`. `TotInvVal = sum of TotItemVal - Discount + OthChrg + RndOffAmt`.
- **Tolerance.** A passed amount is accepted between the integer part of the
  calculated value minus one and the calculated value rounded up plus one:
  calculated 2345.04 accepts 2344.00 to 2347.00; an invoice total of 10241.61
  accepts 10240.00 to 10243.00 (errors 2182-2189, 2194, 2234, 2235).
- **Split versus place.** IGST on an intra-state supply is 2172; CGST/SGST on
  an inter-state supply is 2174; CGST not equal to SGST is 2227.
- **Credit and debit notes.** Item tax amounts are *not* validated against
  rate times taxable value on `CRN` and `DBN`.
- **Items.** 1 to 1000 (2173); `Qty` and `Unit` mandatory for goods; UQC
  must be in the master (2177).
- **Exports.** `BuyerDtls.Gstin = URP`, `Stcd = 96`, `Pin = 999999`,
  `Pos = 96`; always IGST.
- **SEZ.** `SEZWP` / `SEZWOP` only when the recipient is an SEZ unit or
  developer; IGST applies.
- **Tobacco valued on retail sale price** (Notification 20/2025-CT, from 1 Feb
  2026): IRPs suppress the item-total checks 2194, 2234 and 2235 for the
  notified HSNs ([NIC release notes](https://einv-apisandbox.nic.in/release-notes.html)).

## 5. The IRN, the response, the QR, cancellation

**IRN.** SHA-256 of the *plain concatenation* of supplier GSTIN, financial
year as `YYYY-YY`, document type and document number, with **no separator**:
the example on NIC's page is `01AAAAA9999A19N2019-20INVABC01234`
([irn.html](https://einv-apisandbox.nic.in/irn.html)). 64 hexadecimal
characters, unique across the country. An invoice dated 3 Jan 2020 is in
`2019-20`.

**Response** to Generate IRN or Get IRN: `AckNo` (15 digits), `AckDt`
(`yyyy-MM-dd HH:mm:ss`), `Irn`, `SignedInvoice` (JWT), `SignedQRCode` (JWT),
`Status` (`ACT` / `CNL`), optional `EwbNo`, `EwbDt`, `EwbValidTill`, and
`InfoDtls` warnings. Failures return `ErrorDetails[] { ErrorCode,
ErrorMessage }`.

**Signed QR payload:** `SellerGstin`, `BuyerGstin`, `DocNo`, `DocTyp`,
`DocDt`, `TotInvVal`, `ItemCnt`, `MainHsnCode`, `Irn`, `IrnDt`
([QR verifier FAQ](https://tutorial.gst.gov.in/userguide/returns/FAQs_e_Invoice_QR_Code_Verifier.htm)).
**The QR printed on the invoice must encode the JWT string itself**; decoding
it and printing the fields destroys the signature. Verification uses the IRP
public key; 2256 is an invalid signature.

**Printing** ([FAQ mirror](https://taxguru.in/goods-and-service-tax/faqs-e-invoice-irn-system-gst.html)):
the QR is a mandatory particular of the invoice under Rule 46; size and
position are free but it must scan (about 2 x 2 inches is the usual advice).
Printing the IRN text is optional since it is inside the QR; `AckNo` and
`AckDt` are customary, not mandated. No duplicate or triplicate copies are
required (Rule 48(6)).

**Cancellation** ([cancel IRN](https://einv-apisandbox.nic.in/version1.03/cancel-irn.html)):
`Irn`, `CnlRsn` in {1 duplicate, 2 data entry mistake, 3 order cancelled,
4 others}, `CnlRem` up to 100 chars. **Only within 24 hours** of generation;
refused while an active e-way bill exists (2230); no partial cancellation; the
document number is burnt. After 24 hours the correction is a credit or debit
note. There is **no amendment** on an IRP; amendments happen in GSTR-1.

**Retrieval.** Get IRN by IRN at any time; Get IRN by document type, number
and date only within **3 days** of generation
([by doc details](https://einv-apisandbox.nic.in/version1.03/Get_IRNdetailsbyDocDetails.html)).
Persist the full response the moment it arrives.

**E-way bill.** May be requested in the same call through `EwbDtls` or later by
IRN; goods only, `Distance` mandatory, 180-day document-date limit since 1 Jan
2025 ([EWB by IRN](https://einv-apisandbox.nic.in/version1.03/ewaybill-generation-irn.html)).

## 6. Doing it without an API

- **Bulk Generation Tool** (NIC, free): Excel templates validated offline into
  a JSON, uploaded under E-Invoice > Bulk Upload on the portal, signed results
  downloaded as a JSON zip
  ([bulk tools](https://einvoice1.gst.gov.in/Others/BulkGenerationTools)).
  The bulk JSON is the same INV-01 schema as the API, one object per document
  in an array. A POS that emits that JSON has a complete no-API path. Confirm
  the current envelope against the tool before fixing a serializer.
- **GePP-Off** (Excel with macros, prints an e-invoice with QR) and **GePP-On**
  (web, OTP login) exist for small taxpayers
  ([taxguru](https://taxguru.in/goods-and-service-tax/gepp_on-free-web-based-e-invoice-generation-tool-small-tax-payers.html))
  **[secondary]**; whether they were updated for the 40% rate is
  **UNCONFIRMED**.
- **e-Invoice QR Code Verifier** (GSTN app) verifies a printed QR offline and
  shows the ten fields and the issuing IRP; the portals also offer "Verify
  Signed Invoice".

## 7. What this means for a retail POS

- **Only bills to a GSTIN-registered buyer** (and SEZ, export, deemed export)
  are candidates. A walk-in sale is not an error; it is out of scope. `URP` is
  not a way to e-invoice a consumer.
- **A government department or PSU buyer with a GSTIN is ordinary B2B.** The
  government exemption covers government as *seller*.
- **Place of supply** `Pos` is the buyer's state code for B2B, which decides
  IGST against CGST/SGST. Derive it from the GSTIN, not from a typed state.
- **Bill-to and ship-to.** `BuyerDtls` is bill-to; `ShipDtls` is optional
  ship-to. A GSTN change making the ship-to GSTIN mandatory when a ship-to is
  given (1 Aug 2026) was **put on hold by NIC on 30 Jul 2026**
  ([announcements](https://einv-apisandbox.nic.in/announcements.html),
  [taxo](https://taxo.online/latest-news/gstn-system-enhancements-new-e-invoice-and-e-way-bill-api-changes-effective-1-august-2026/)).
  Support the field; do not enforce it yet.
- **Returns** to a B2B buyer are a `CRN` with its own IRN and a
  `PrecDocDtls` reference to the invoice. A mistake caught within 24 hours can
  be an IRN cancellation instead, if no e-way bill is active.
- **Mixed B2C and B2B retailers above 5 crore** either generate the IRN at
  bill close whenever a GSTIN is captured or upload B2B bills in a daily batch,
  respecting the 30-day window (10 crore and above) and the 24-hour cancel
  window. Keep the 6-digit HSN master, the UQC master and the PIN-to-state
  master local.
- **Buyer GSTIN lookup.** `GET /Master/gstin/{gstin}` returns status (`ACT`,
  `CNL`, `INA`, `PRO`), taxpayer type, blocking status, address, PIN and state;
  `syncgstin` refreshes it after a 3028 or 3029
  ([get GSTIN details](https://einv-apisandbox.nic.in/version1.04/get-gstin-details.html)).
  An offline app cannot do this at sale time; it can do it at export time
  through a connector.
- **Invoice Management System (IMS)**, live since Oct 2024, lets buyers accept
  or reject supplier invoices, with partial ITC reversal on credit notes from
  Oct 2025 ([ClearTax](https://cleartax.in/s/invoice-management-system-ims-under-gst))
  **[secondary]**. A wrong e-invoice is now visible to the buyer immediately.

## 8. Penalties and retention

- Section 122(1): 10,000 rupees or 100% of the tax, whichever is higher, per
  invoice not generated; 25,000 rupees per incorrect e-invoice. An invoice
  without an IRN is not an invoice, so the buyer's input tax credit is denied
  and goods in transit can be detained
  ([ClearTax](https://cleartax.in/s/consequences-non-generation-irn))
  **[secondary]**.
- Section 36: records kept for **72 months** from the due date of the annual
  return, longer under appeal or investigation
  ([CBIC](https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/acts/2017_CGST_act/active/chapter8/section36_v1.00.html)).
  Keep the signed JSON and JWTs, not only a PDF.
- Two-factor authentication is mandatory for *portal* login for all taxpayers
  since 1 Apr 2025; API access uses credentials plus `AppKey`, not an OTP
  ([einvoice6](https://einvoice6.gst.gov.in/content/2-factor-authentication-for-e-invoice-e-way-bill-system-now-mandatory-for-atto-rs-20-cr-above/))
  **[secondary]**.

## 9. Sandbox reference

Headers: `client_id`, `client_secret`, `Gstin`, `user_name`, `AuthToken`
(plus `sup_gstin` for operators). The API version is in the path; the schema
`Version` in the body is `"1.1"`.

| API | Method | Path |
|---|---|---|
| Authenticate | POST | `/eivital/v1.04/auth` |
| Generate IRN | POST | `/eicore/v1.03/Invoice` |
| Cancel IRN | POST | `/eicore/v1.03/Invoice/Cancel` |
| Get IRN details | GET | `/eicore/v1.03/Invoice/irn/{irn}` |
| Get IRN by document | GET | `/eicore/v1.03/Invoice/irnbydocdetails?doctype=&docnum=&docdate=` |
| Get rejected IRNs | GET | `/eicore/v1.03/Invoice/rejectedirn` |
| Get GSTIN details | GET | `/eivital/v1.04/Master/gstin/{gstin}` |
| Sync GSTIN from common portal | GET | `/eivital/v1.03/Master/syncgstin/{gstin}` |
| Generate e-way bill by IRN | POST | `/eiewb/v1.03/ewayapi` |
| Get e-way bill by IRN | GET | `/eiewb/v1.03/ewayapi/irn/{irn}` |
| Health | GET | `/eivital/v1.03/health` |

The `eicore` / `eivital` / `eiewb` prefixes are confirmed for the GSTIN
endpoints and follow NIC's convention elsewhere; verify after sandbox login.
No numeric rate limit is published; a "100 calls per minute per GSTIN" figure
circulates in secondary sources and is **UNCONFIRMED**. Design for retry with
backoff and for recovering an IRN after a lost response (on 2150, call Get IRN
by document).

Error codes worth handling by name (NIC's list is rendered client-side at
[api-error-codes-list](https://einv-apisandbox.nic.in/api-error-codes-list.html);
mirrored by [ClearTax](https://docs.cleartax.in/cleartax-docs/e-invoicing-api/e-invoicing-api-reference/resources-and-master/error-codes)
and [IRIS](https://einvoice6.gst.gov.in/content/kb/troubleshooting-common-errors/)
**[secondary]**):

| Code | Meaning |
|---|---|
| 1005 | invalid token |
| 2150 | duplicate IRN |
| 2163 | future document date |
| 2172 / 2174 | IGST on intra-state / CGST-SGST on inter-state |
| 2173 | more than 1000 items |
| 2176 / 2177 | invalid HSN / invalid UQC |
| 2182-2189, 2194, 2234, 2235 | amount mismatches beyond tolerance |
| 2227 | CGST not equal to SGST |
| 2230 | cancel blocked by an active e-way bill |
| 2240 | invalid GST rate |
| 2243 | invalid place of supply |
| 2256 | invalid signature |
| 2271 / 2272 | invalid state / PIN |
| 2278 | IRN already cancelled |
| 2284 | document date before the accepted floor |
| 2295 | IRN already registered (duplicate request) |
| 2300 | supplier not REG or SED |
| 2305 | outside the 30-day window |
| 3026 | e-invoice not enabled for this GSTIN |
| 3028 / 3029 | buyer GSTIN inactive or unknown; call sync |
| 3038 / 3039 | PIN does not match state |

## 10. Open-source references, and their licences

Consulted for shape and behaviour. Posnic is AGPL-3.0-only; code from these
projects is not to be vendored into it without a licence review.

| Project | Licence | What it shows |
|---|---|---|
| [resilient-tech/india-compliance](https://github.com/resilient-tech/india-compliance) (ERPNext) | GPL-3.0 | complete INV-01 JSON builder, IRN generate and cancel, e-way bill, QR print formats, GSTIN validation; connects through its own paid API service rather than NIC crypto |
| [Odoo `l10n_in_edi`](https://github.com/odoo/odoo/blob/17.0/addons/l10n_in_edi/__manifest__.py) | LGPL-3 | JSON field mapping and rounding, PDF with IRN, Ack and QR; routes through Odoo's GSP |
| [Mittal-Analytics/gst-e-invoicing](https://github.com/Mittal-Analytics/gst-e-invoicing) (Python) | GPL-3.0 | the NIC handshake end to end: RSA credential encryption, AppKey/SEK AES-256, token session, generate IRN, QR helper; supports direct sandbox and GSP base URLs |
| [tk120404/gst](https://github.com/tk120404/gst) | **UNCONFIRMED** | GSTIN regex and the mod-36 check digit in several languages |

## 11. Provider pricing, indicative

All **[secondary]** and subject to change.

| Provider | Model | Indicative |
|---|---|---|
| NIC IRP1 / IRP2 | direct or through GSP or ERP | free; the cost is integration and static IPs |
| GSTZen (GSP) | per invoice | about 0.18 to 0.50 rupees per e-invoice with annual minimums ([GSTZen](https://gstzen.in/e-invoicing-api-integration-pricing)) |
| IRIS IRP6 | portal and API | basic free; API in a value-added tier ([IRIS](https://einvoice6.gst.gov.in/content/pricing-plan/)) |
| Cygnet IRP3 | portal and API | advertised free for corporates, SMEs, ERPs and GSPs ([einvoice3](https://einvoice3.gst.gov.in/)) |
| ClearTax (IRP4 and GSP) | subscription | not public; tens of thousands of rupees per year for SME bundles |
| Zoho (GSP) | included in Zoho Books plans | 899 to 9,999 rupees per organisation per month |
| Masters India, MasterGST, Adaequare | per invoice | contact sales; free sandboxes |

For a software vendor the practical band is a fraction of a rupee per IRN
through a GSP at volume, or near-zero marginal cost after onboarding as an ERP
on NIC, Cygnet or IRIS and carrying the integration.

## 12. Changes since 2025, and what is pending

| Date | Change | Effect on Posnic |
|---|---|---|
| Jan to Apr 2025 | portal 2FA mandatory for all taxpayers | portal only; no API effect |
| 1 Jan 2025 | e-way bill not generated more than 180 days after the document date | only if e-way bills are ever added |
| Feb 2025 return period | GSTR-1 Table 12 HSN phase 3: dropdown-only HSN, B2B/B2C split, 6 digits above 5 crore | Posnic's HSN values must match GSTN's list; the stale `hsn.json` matters |
| 1 Apr 2025 | 30-day IRP window extended to AATO of 10 crore and above | the `india_turnover_above_10cr` warning |
| Oct 2024, Oct 2025 | IMS live; partial ITC reversal on credit notes | credit-note accuracy is visible to buyers |
| 22 Sep 2025 | GST 2.0: 5% / 18% / 40% slabs; 12% and 28% withdrawn except tobacco and pan masala; special rates 0.25%, 1.5%, 3% kept; compensation cess ended except tobacco | already reflected in `gst_rates_2025.json` and the readiness scan; the rate check must accept 40 |
| 21 Sep 2025 | 40% added to the IRP rate master | as above |
| 16 Dec 2025 | casual taxable persons may generate IRNs | supplier type check only |
| 1 Feb 2026 | retail-sale-price valuation for tobacco and pan masala; IRPs relax item-total checks for those HSNs | out of scope; such shops are blocked honestly |
| 1 Aug 2026, on hold | ship-to GSTIN mandatory when ship-to given; `ExpShipDtls`; e-way bill voluntary closure | support `ShipDtls` as optional; enforce nothing |
| pending | B2C e-invoicing pilot | design B2C as a later switch; **UNCONFIRMED** launch |
| pending | a new health-security cess replacing compensation cess on pan masala | cess fields may change meaning; out of scope |

## 13. Unconfirmed, in one place

1. Go-live, participants and schema of the B2C e-invoicing pilot.
2. The current production turnover floor for direct NIC API credentials.
3. The exact current `GstRt` master list; read it from the portal at build
   time.
4. Any numeric NIC API rate limit.
5. The production earliest-document-date floor for taxpayers below the 30-day
   rule.
6. Whether the GePP tools were updated for the 40% rate.
7. The licence of the `tk120404/gst` repository.
