# Privacy

What Posnic does with your data, in plain terms. This covers the desktop
application in this repository. Posnic Cloud is a separate paid service and has
its own section at the end.

**Last updated:** 4 August 2026

## The short version

Installed and left alone, the desktop application stores everything on your own
computer and sends nothing anywhere. There is no account, no signup, no
analytics and no telemetry. We cannot see your sales, your customers or your
stock, because they never reach us.

Posnic also ships integrations you can switch on — emailing a receipt, sending
an SMS, taking an online payment. Those exist because shops asked for them, and
each one sends data to a provider **you** choose and configure. None is on by
default; none involves us. [What you can switch
on](#what-you-can-switch-on-and-what-it-sends) lists every one of them and what
it sends where.

## What the application stores, and where

Everything lives in a database on your own computer, in your user profile:

| System | Location |
|---|---|
| Windows | `%APPDATA%\Posnic\` |
| macOS | `~/Library/Application Support/Posnic/` |
| Linux | `~/.config/Posnic/` |

That includes your items, sales, customers, suppliers, staff accounts, settings
and logs. Nobody else has a copy unless you make one.

**This cuts both ways.** If that computer dies and you have no backup, the data
is gone — we cannot recover it for you, because we never had it. Copy your
backups somewhere else. See the
[user guide](USER_GUIDE.md#backups).

## What leaves your computer on its own

Three things, on a stock install where you have configured nothing:

**Update checks.** The app asks GitHub whether a newer release exists. That
request necessarily reveals your IP address and the version you are running, the
same as visiting a web page. It carries no shop data and no identifier we
assign. Disable it in *Config → Settings*.

**The bundled database, on first run.** A one-time download of MongoDB from
`mongodb.com` if the installer did not include it.

**Posnic Cloud, only if you subscribe and sign in.** Covered below.

**Nothing else runs by itself.** No analytics library, no crash reporter, no
usage statistics, no "anonymous" beacons. This is verifiable rather than a
promise: the project has no analytics dependency, does not enable Electron's
crash reporter, and its Content-Security-Policy does not allow a script from any
analytics or error-reporting host — so one could not load even if something
tried. If you find otherwise, that is a bug — please [report it](../.github/SECURITY.md).

## What you can switch on, and what it sends

Everything below is **off until you configure it**, and each sends data to a
provider you pick and hold the account with. We are not in the path and we never
see it. Configuring one makes that provider your processor, not ours — their
terms and their privacy policy apply to what they receive. That includes
analytics: if you switch Google Analytics on, you are the controller of what
it collects about your visitors, and until you do, the page's own security
policy refuses Google's domains outright.

| Feature | Off by default | What it sends | To whom | Turn it off by |
|---|---|---|---|---|
| Email receipts and reports | Yes | Customer email, invoice PDF, sale total, payment mode | The SMTP server you configure | Clearing the SMTP settings |
| SMS receipts and alerts | Yes | Customer phone number, message text, delivery status | Brevo, or the SMS provider you configure | Clearing the SMS settings |
| WhatsApp receipts | Yes | Phone number and message content; the session lives on your machine | WhatsApp / Meta | Disconnecting WhatsApp |
| Online payments | Yes | Payment amount, order reference, payment status | Razorpay, using your own merchant keys | Removing the gateway keys |
| Google Analytics | Yes | Page views and usage events from this shop's pages, under Google's own collection | Google, into the Analytics account whose measurement id you enter | Switching the toggle off (Settings → Integrations → Analytics) |
| S3 file storage | Yes | Item and user images you upload | The S3 bucket you own | Leaving storage set to local |
| Posnic Cloud sync | Yes | Your shop data, as described below | Us | Not subscribing, or disconnecting |

If none of these is configured — which is how the app installs — then apart from
the three checks above, nothing your shop does reaches the network at all. Pull
the cable and keep selling; that is the design.

**Your customers did not choose these providers, you did.** If you switch one
on, telling your customers about it is your job, not ours. See [your customers'
data](#your-customers-data).

## What we will never add

- Telemetry that reports on your business — what you sell, how much, or how often
- Anything that requires an account to use the free application
- Advertising, or sharing data with advertisers
- Any feature that stops the app working when it cannot reach us

These are commitments, not current defaults. They are part of
[GOVERNANCE.md](GOVERNANCE.md#things-that-are-not-up-for-debate) and changing
them would need the same public process as any other decision.

## Your customers' data

If you record customer names, phone numbers or addresses, that data is yours and
your responsibility. Posnic is the tool; you are the one holding the
information.

Depending on where you trade you may have obligations to those customers — in
India, the Digital Personal Data Protection Act; in the EU, the GDPR. The app
gives you what you need to meet them:

- Every customer record can be edited or deleted outright
- Reports and customer data can be exported
- Nothing is transmitted to us, so there is no third party to account for

We are not your data processor for the offline application, because we never
receive the data.

One thing that does change this: if you switch on any of the integrations in
[what you can switch on](#what-you-can-switch-on-and-what-it-sends), that
provider becomes a third party you are accountable for. Sending a receipt by
SMS gives your customer's phone number to an SMS company. That may be entirely
proper — it is usually why the customer gave it to you — but it is your
disclosure to make, and the provider's terms are between you and them.

## Posnic Cloud

Optional, paid, and not part of this repository.

If you subscribe and connect a till, your shop's data is synced to servers we
operate in order to provide the service. In that arrangement:

- **You own the data.** We store and transmit it to do the job you are paying for.
- **We do not sell it, mine it or share it** with anyone, other than the
  infrastructure providers needed to run the service.
- **Devices authenticate with a token**, stored as a SHA-256 hash rather than in
  the clear.
- **You can stop.** Disconnect a device, cancel the subscription, or ask us to
  delete your cloud data at **info@posnic.com**. Your local copy keeps working
  either way — that is the point of the design.

Account details you give us when subscribing — name, business name, email,
phone, and billing information — are used to run your account, send invoices and
provide support. Payments are handled by Razorpay; we never see your card
number.

### Our role, and yours

For your shop's own records, **you are the controller** — the Data Fiduciary
under India's Digital Personal Data Protection Act 2023 — and **we are the
processor**. You decide what is collected about your customers and why. We hold
it to provide the service and act on your instructions.

That distinction matters, because the duty to tell your customers what you
collect, and to have a lawful basis for it, is yours. We cannot discharge it for
you, and we do not pretend to.

### What we hold, and for how long

| | |
|---|---|
| **Shop records** | Sales, items, stock, customers, staff activity — for as long as you subscribe |
| **Account and billing** | Name, business name, email, phone, invoices — kept while you are a customer, then as long as tax law requires |
| **Backups** | Encrypted, kept **90 days**, then expire |
| **Server logs** | Connection and error records, **30 days** |

**Deletion.** Ask at info@posnic.com and we delete your cloud data within
**30 days**, keeping only what a law requires us to. Deleted data can persist in
backups until they rotate out, within 90 days. Your local copy is unaffected —
that is the point of the design.

### Where it is

Posnic Cloud data is intended to be held **in India**. If that ever changes we
will use a lawful transfer mechanism and update
[docs/SUBPROCESSORS.md](SUBPROCESSORS.md) with 30 days' notice first.

### Security, and its limits

Encrypted in transit and at rest. Devices authenticate with a token stored as a
SHA-256 hash. Credential fields are separately encrypted with AES-256-GCM and
marked cloud-only so they are not synced in plain form. Access to production is
limited and logged.

We would rather state the limit than imply there is none: **no cloud service is
immune to compromise.** If your data is exposed we will tell you within
**48 hours** of becoming aware — see
[docs/INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md).

### Your rights

Under the DPDP Act, and the GDPR where it applies, you and your customers can
ask for access, correction, erasure, and a portable copy. Export is built into
the product; anything the tools do not cover, write to info@posnic.com and we
will do it by hand. We answer within **30 days**.

If you need a signed data processing agreement, see
[docs/DATA_PROCESSING_ADDENDUM.md](DATA_PROCESSING_ADDENDUM.md).

## Questions

- **Privacy questions or a deletion request:** info@posnic.com
- **A security problem:** [SECURITY.md](../.github/SECURITY.md), privately
- **Anything else:** [Discussions](https://github.com/Posnic/POS/discussions)

## Changes

Material changes to this document are announced in release notes, and the
history is in this repository — you can read exactly what changed and when.
