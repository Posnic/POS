# Subprocessors

**Last updated:** 5 August 2026

Who else can touch your data, and why. A subprocessor is any third party we use
that may process customer data on our behalf.

---

## The distinction that matters most

**The local edition has no subprocessors at all.**

Posnic on your own computer does not send your sales, stock or customers
anywhere. There is no telemetry, no analytics, no crash reporting and no
licence check. The list below applies only where you have configured a feature
that reaches out, or where you subscribe to Posnic Cloud.

If you use the local edition and configure nothing, nothing on this page
applies to you.

---

## Features you configure yourself

These use **your own accounts and your own credentials**. We are not in the
path — your till talks to the provider directly. They are subprocessors of
yours, not of ours, and you choose whether they exist at all.

| Provider | Used for | What reaches it | Turn it off by |
|---|---|---|---|
| Your SMTP server | Emailing receipts, reports and invoices | Recipient address, document contents | Clearing the SMTP settings |
| Brevo | Transactional email, if chosen instead of SMTP | Recipient address, message contents | Clearing the Brevo settings |
| MSG91 | SMS to customers | Phone number, message text | Clearing the SMS settings |
| Way2SMS | SMS to customers | Phone number, message text | Clearing the SMS settings |
| WhatsApp | Sending receipts over WhatsApp | Phone number, document | Not connecting WhatsApp |
| Razorpay | Taking card and online payments | Transaction amount, order reference | Clearing the gateway settings |
| PhonePe | Taking UPI payments | Transaction amount, order reference | Clearing the gateway settings |
| Amazon S3 | Storing uploaded images, if configured | Item and branch images | Leaving S3 unconfigured |

**We never see the credentials for these.** They are held on your machine,
encrypted, and are marked cloud-only in the field policy so they are not synced
in plain form. See [SECURITY.md](../SECURITY.md).

---

## Posnic Cloud

Only if you subscribe. Everything here is in India unless stated otherwise, and
we give **30 days' notice** before adding or changing any of them.

| Provider | Used for | Location |
|---|---|---|
| Amazon Web Services | Running the sync gateway and the web dashboard | Mumbai (ap-south-1) |
| MongoDB Atlas | Storing synced shop data, one database per shop | Mumbai (ap-south-1) |
| Amazon S3 | Off-site backups and uploaded images | Mumbai (ap-south-1) |
| Cloudflare | DNS and TLS in front of the gateway | Global edge; no shop data is stored at the edge |
| Razorpay | Subscription billing | India |
| Brevo | Account, billing and support email | EU, for email delivery only |

**Data residency.** Shop records — sales, stock, customers, staff — stay in
India. Cloudflare terminates TLS and passes requests through without storing
them. Brevo receives only what an email contains: an address, and the message
being sent.

Provisioning is still being completed for the Cloud service, and this table is
updated as each account is finalised. Anything that changes gets the same 30
days' notice as a new subprocessor.

## What we require of a subprocessor

Before we add one:

- A written agreement with data protection terms no weaker than our own.
- A stated purpose. They may process data to provide their service to us and
  for nothing else.
- Security appropriate to the data — encryption in transit at minimum.
- Somewhere to report an incident, and an obligation to tell us promptly.
- A deletion route when we stop using them.

## Adding or changing one

We give **30 days' notice** before a new subprocessor starts processing
customer data, by email to account holders and by updating this page. If you
object on reasonable data protection grounds, write to info@posnic.com. If we
cannot resolve it, you may cancel and we will refund the unused part of your
period.

## Government and legal demands

We disclose data to an authority only where a valid legal demand compels it.
Where we are permitted to tell you, we will, and in time for you to challenge
it if you wish.

---

**Questions:** info@posnic.com
**Related:** [PRIVACY.md](../PRIVACY.md) ·
[DATA_PROCESSING_ADDENDUM.md](DATA_PROCESSING_ADDENDUM.md) ·
[TERMS_OF_USE.md](../TERMS_OF_USE.md)
