# Getting Posnic registered with India's GST system

Which government programmes exist, what each one actually gives you, what it
demands in return, and when to apply. Written so that a decision about time and
money can be made from evidence rather than from what a competitor's marketing
page implies.

Research date: **4 September 2026**. Every claim below carries a source.
Facts from a provider's own documentation rather than from GSTN, NIC or CBIC
are marked **[secondary]**. Twelve points that could not be confirmed are
listed at the end. Re-check anything here before acting on it; these programmes
change.

Companions: [INDIA_EINVOICING_RESEARCH.md](INDIA_EINVOICING_RESEARCH.md) for
the e-invoice regime itself, and
[INDIA_GST_RETURNS_GAPS.md](INDIA_GST_RETURNS_GAPS.md) for what the reports
would need before any of this matters.

## The answer in three lines

1. **Register on the NIC e-invoice sandbox today.** It is free, self-service
   and instant. No email, no application, no approval. Nothing about Posnic
   needs to be finished first.
2. **Email the government for production credentials only when you can attach
   a test report of roughly 390 logged operations**, have up to four static
   Indian IP addresses, and have at least one real customer who must
   e-invoice. Turnaround is four to five working days.
3. **Filing returns automatically is not available on this route.** The GST
   return APIs are open only to empanelled GST Suvidha Providers, and that
   application window is closed.

## First, a correction worth having early

The goal of appearing on a government list of *recommended* billing software
cannot be met, because no such list exists. This is worth stating plainly
before any effort is spent chasing it.

The government's own free-software programme carries an explicit
non-endorsement clause. From the GST portal's own FAQ:

> GSTN makes no representations or warranty whatsoever about the Account &
> Billing Software … GSTN does not endorse or accept any responsibility [for]
> the use/misuse by such Software.

([GST portal FAQ, accounting software](https://tutorial.gst.gov.in/userguide/taxpayersdashboard/FAQs_Accountingsoftware.htm))

Every government list in this space is one of three things: a contractual
licence to consume APIs, a record that a vendor completed technical onboarding,
or GSTN's own procurement panel. None is a quality mark. There is no "GST
compliant software" certification or logo anywhere in the CBIC, GSTN or NIC
estate.

**What is achievable, and is worth having**, is the second kind: completing NIC's
e-invoice ERP onboarding. A registered ERP's name appears inside the
government's own portal, in the dropdown a taxpayer picks from when creating
their API user
([NIC API credentials](https://einv-apisandbox.nic.in/apicredentials.html)).
That is a real, defensible statement: Posnic is integrated with the NIC
e-invoice system. It is not an endorsement, and it should never be described as
one.

## What lists exist

| List | Published by | What it means |
|---|---|---|
| [Empanelled GSPs](https://gstn.org.in/empanelled-gsps), 62 entities | GSTN | A contractual licence to consume the GST System APIs, including return filing |
| [GSP / ERP list](https://einvoice1.gst.gov.in/Others/GSPSLIST), 42 entries | NIC | Who has completed e-invoice API onboarding |
| [Empanelled IRPs](https://gstn.org.in/empanelled-irps), 6 | GSTN | Authorised to *operate* an Invoice Registration Portal. **Registration closed.** |
| [Accounting and billing software](https://gstn.org.in/empaneled-companies), 6 products | GSTN | A dormant 2019 scheme, described below |
| [Empanelled SDAs](https://gstn.org.in/empanelled-sdas), 21 | GSTN | GSTN's own software-development vendor panel. Not a product listing. |
| ASP list | nobody | **Does not exist.** GSTN's e-invoice FAQ says so: "There is no empanelment for ASP." |
| E-way bill ERP list | nobody | **Does not exist.** That programme recognises only GSPs, taxpayers and transporters. |
| "GST compliant software" certification | nobody | **Does not exist.** |

Two things commonly mistaken for government listings: the Institute of
Chartered Accountants of India runs member-discount arrangements with software
vendors, which is a commercial tie-up with a professional body; and private IRP
operators describe themselves as "GSTN authorised", which is true of them as
portal operators and says nothing about billing software.

## Route A: the NIC e-invoice sandbox. Do this now

Free, self-service, and gated only by an OTP to your own GST-registered mobile
number. Registration at
[einv-apisandbox.nic.in](https://einv-apisandbox.nic.in/) asks you to choose a
category, and **ERP is one of the four choices** alongside taxpayer, GSP and
e-commerce operator. Enter your PAN or GSTIN, verify the OTP, and the system
issues a client id and client secret by SMS.

No IP whitelisting is needed for the sandbox
([NIC API FAQ](https://einv-apisandbox.nic.in/FaqsonAPI.html)). Development can
start the day you register.

What you need in place:

- A registered Indian entity with its own GSTIN and PAN.
- A mobile number and email **as registered on the GST Common Portal**. If they
  do not match, the one-time password never arrives.
- An HTTPS client on TLS 1.2 or better.
- The cryptography the API expects: RSA with PKCS#1 padding for the credential
  envelope, AES-256 for the session, a 32-byte application key, and JSON Web
  Signature verification for the signed responses.

Cost: nothing. Approval: none.

One thing that may bite: it is **unconfirmed** whether NIC applies a turnover
test to ERP-category registration, as it historically did to the taxpayer
category. If registration is refused, that is not the route closing. Raise a
ticket at [selfservice.gstsystem.in](https://selfservice.gstsystem.in) under
E-Invoice, or write to the onboarding address below.

## Route B: production ERP credentials. The one to aim for

This is the email the question was about, and the answer is **not yet, and here
is exactly what has to be true first.**

From NIC's [onboarding page](https://einv-apisandbox.nic.in/onboarding.html),
in its own words:

- Test every API in pre-production with successful and failure cases.
- Testing must be done "by interfacing the APIs with the tax payer's
  ERP/Accounting application and not through the NIC online testing tool". A
  report generated by clicking around NIC's own tester is not acceptable.
- The report must be submitted by the ERP itself, not by a third party.
- ERPs send it to **support.einv.api@gov.in**.
- "It may take 4-5 days for verification of report and whitelisting of the IP
  addresses."
- A maximum of **four Indian public static IPs** may be whitelisted.
- Applications must support TLS 1.2 as a minimum.

### The test report is the real gate

The [test summary template](https://einv-apisandbox.nic.in/downloads/EInvoiceAPITestSummary1.03.xlsx)
sets minimum volumes per API:

| API | Success cases | Failure cases |
|---|---|---|
| Generate IRN | 100 | 50 |
| Cancel IRN | 40 | 20 |
| Generate e-way bill by IRN | 40 | 20 |
| Get IRN details | 30 | 10 |
| Get GSTIN details | 30 | 10 |
| Authentication | 30 | 10 |

That is roughly **390 logged operations**, run through Posnic itself. An older
NIC FAQ states a smaller figure of fifty successes and fifty failures per API;
build to the larger of the two. The report also wants a named project manager
and technical point of contact, the GSTINs and user ids used, and a date range,
submitted as a PDF.

### Checklist before sending that email

- [ ] Sandbox integration complete and stable, including cancellation and the
      signed-QR verification.
- [ ] Roughly 390 operations run and logged through Posnic, not through NIC's
      tester.
- [ ] The completed test summary template as a PDF.
- [ ] A named project manager and technical contact.
- [ ] Up to four Indian public static IP addresses, being the egress addresses
      of whatever will actually call the API. NIC warns that changing a
      whitelisted address later is slow, so do not spend the slots on a
      development machine.
- [ ] At least one real customer above the five crore threshold who needs this.
- [ ] An answer to how the connector reaches the API at all, which for an
      offline desktop POS is the open question in
      [INDIA_EINVOICING_DESIGN.md](INDIA_EINVOICING_DESIGN.md).

### Why the ERP category exists, and why it is Posnic's market

NIC's own access matrix
([API client page](https://einv-apisandbox.nic.in/einvapiclient/)) sets it out:
taxpayers above one hundred crore turnover may get direct API access with their
own IPs whitelisted. Taxpayers **between five and one hundred crore** cannot,
and must connect through a GSP, through an ERP, or through a company that holds
direct access.

That band is precisely the set of shops that must e-invoice and cannot do it
themselves. It is the gap the ERP category exists to fill.

One caution: NIC's pages disagree with each other about whether the direct
threshold is one hundred crore or five hundred crore. Treat the number as
unsettled and confirm at the time.

### There is no equivalent for e-way bills

The [e-way bill onboarding process](https://docs.ewaybillgst.gov.in/apidocs/on-boarding-process.html)
recognises only GSPs, taxpayers and transporters. There is no ERP category, and
its prerequisites are much harsher, including around ten thousand transactions
per month per GSTIN.

The documented way around this: e-invoice and e-way bill are interoperable, and
the e-invoice API set includes generating an e-way bill from an IRN. An ERP
with e-invoice credentials can therefore produce e-way bills without any
separate onboarding.

## Route C: GSP. Closed, and probably not the right target anyway

This matters because **automatic GST return filing is only available here.**

GSTN's own developer documentation says that to get sandbox credentials for the
GST System APIs you must "contact any of the GSPs"
([How to start developing](https://developer.gst.gov.in/pages/apiportal/data/gsp/How%20To%20Start%20Developing%20Application%20Using%20GST%20System%20API_v1.2.docx)).
There is no self-service route, unlike e-invoicing. The APIs themselves are
live and maintained: the released API list is dated 26 June 2026 and includes
GSTR-1, GSTR-3B, GSTR-2B and the Invoice Management System. Only the access
path is gated.

The current status of the programme is **closed**. The fifth batch's
registration ended on 25 July 2024, thirteen more providers were selected,
bringing the total to sixty-two, and no sixth batch has been announced
([GSP ecosystem](https://gstn.org.in/gsp-ecosystem)). Historic cadence has been
roughly every two to three years, so another window in 2026 or 2027 is
plausible but unannounced.

### The financial bar is low. The infrastructure bar is not

The fifth batch asked for **fifty lakh average turnover** over three financial
years, with no paid-up capital requirement and an explicit relaxation for MSME
firms
([batch 5 eligibility](https://www.gstn.org.in/assets/mainDashboard/Pdf/eligibility-batch-5.pdf)).
That is a bar a small vendor could clear.

What actually makes this unrealistic for a small team is everything else:

- **Production APIs are not on the internet.** GSTN states that "the production
  API end points can only be consumed via MPLS lines". A GSP must buy MPLS
  connectivity to **both** GSTN data centres, in Delhi and Bengaluru, and
  provide highly-available routers at its own cost. GSTN pays for none of it.
- **An ISO 27001 security audit by a CERT-In empanelled auditor** before
  service begins and **every year afterwards**, under a five-year agreement
  ([standard GSP agreement](https://gstn.org.in/assets/mainDashboard/Pdf/Faq/Agreement_GSP_legal_standard_draft.pdf)).
- A **hundred-mark technical evaluation** needing at least sixty per cent in
  each of eleven sections and seventy per cent overall. It scores GSTR-1
  filing, GSTR-2A reconciliation against a purchase register, draft GSTR-3B,
  digital signature integration, multi-GSTIN and multi-role handling, a mobile
  interface, and capacity for a hundred thousand transactions a month. Posnic
  today would score badly on most of those, and the
  [returns gap analysis](INDIA_GST_RETURNS_GAPS.md) says why.

No application fee, licence fee or security deposit is published anywhere, and
GSTN's charges to GSPs after a two-year moratorium have never been publicly
notified.

### The sensible version of this route

**Partner with one of the sixty-two existing GSPs rather than becoming one.**
Their contact details are published on the empanelled list. This is exactly the
application-provider model GSTN describes, and it is how most billing software
offers return filing.

## What Posnic can offer today with no government relationship at all

This is worth being clear about, because it is sellable now.

The GST portal serves **Returns Offline Tool version 3.2.4** for GSTR-1 and
GSTR-2, alongside offline tools for GSTR-3B, GSTR-9 and others
([returns downloads](https://www.gst.gov.in/download/returns)). The e-invoice
portal serves its bulk generation tools, last updated 1 February 2026. Both
consume files.

So a shop can file today if Posnic produces a correct file and they upload it.
No registration, no credentials, no email to anybody. The difference between
that and "automatic filing" is one file transfer, and the work that makes it
possible is entirely in
[INDIA_GST_RETURNS_GAPS.md](INDIA_GST_RETURNS_GAPS.md), not here.

One limitation to know: the offline tools do not run on Linux or macOS and need
Microsoft Excel.

## Other credibility signals, ranked

For a vendor of this size, in order of value for effort.

1. **NIC e-invoice ERP registration.** Free, no committee, about a week of NIC
   turnaround once the test report exists. Best ratio by a distance.
2. **Startup India / DPIIT recognition**
   ([scheme page](https://www.startupindia.gov.in/content/sih/en/startup-scheme.html)).
   Needs a private limited company, LLP, registered partnership or cooperative,
   within ten years of incorporation and under two hundred crore turnover. No
   fee. Gives self-certification on labour and environment rules, an eighty per
   cent patent fee rebate, a three-year income tax exemption under section
   80-IAC, and public procurement relaxations. Cheap and genuinely useful.
3. **Government e-Marketplace seller listing** ([gem.gov.in](https://gem.gov.in)).
   The route to actually selling to government buyers, which is a stronger
   signal than any badge. Fees and caution-money rules are contested across
   secondary sources; verify on the site before relying on a figure.
4. **A GSP partnership**, as above, for returns filing.
5. **ISO 27001 with a CERT-In empanelled auditor.** Not required for the ERP
   route, but it is the artifact a GSP application demands and a real trust
   signal to mid-market buyers.

STQC certification, MeitY empanelment and ONDC confer no GST-specific
credential and are not required for anything above.

## The sequence

| When | Do | Blocked by |
|---|---|---|
| Now | Register on the NIC sandbox as an ERP | nothing |
| Now, in parallel | Build the offline file paths: e-invoice JSON, bulk-tool compatibility, GSTR-1 offline-tool output | the returns gap work |
| Now, in parallel | Startup India recognition if the entity qualifies | entity type and age |
| After the connector works end to end | Run and log about 390 operations against the sandbox | the connector decision in the design document |
| Then | Email **support.einv.api@gov.in** with the test report and up to four static IPs | the above, plus a real customer |
| Watch | [GSP ecosystem](https://gstn.org.in/gsp-ecosystem) and [tenders](https://gstn.org.in/tenders-rfps) for a sixth batch | nothing; keep audited accounts and MSME registration current |
| Never | The IRP route | closed, and it means running national infrastructure |

## Unconfirmed

1. Whether an ERP, as opposed to a GSP, is ever published on NIC's public
   list. All forty-two current entries are also empanelled GSPs.
2. Whether NIC applies a turnover test to ERP-category sandbox registration.
3. Whether any fee applies to sandbox or production ERP onboarding. None is
   stated and no payment step exists, but no page says "free" either.
4. Whether GSTN ever notified charges to GSPs after the moratorium.
5. How long a GSP application takes from submission to signed agreement.
6. Whether a sixth GSP batch is planned.
7. The direct-access turnover threshold: NIC pages say both one hundred crore
   and five hundred crore.
8. The test-case counts: the template implies about 390 operations, an older
   FAQ says fifty successes and fifty failures per API.
9. Whether any non-GSP path exists for GSTR-1 or GSTR-3B filing. None was
   found, but this is a negative and cannot be proven from public pages.
10. How the eight original accounting-software vendors were selected in 2019.
11. Whether the post-login accounting-software page still works for eligible
    taxpayers; the manual describes it, the public menu no longer lists it.
12. Current Government e-Marketplace fee and caution-money rules, and the
    detail of the STQC, MeitY and ONDC programmes.
