# Data Processing Addendum

**Version 1.0 — 5 August 2026**

For customers who need a written data processing agreement covering Posnic
Cloud. Forms part of [TERMS_OF_USE.md](../TERMS_OF_USE.md).

---

## 1. Roles

For personal data in Posnic Cloud:

- **You are the controller** (under the GDPR) and the **Data Fiduciary** (under
  India's Digital Personal Data Protection Act 2023). You decide what is
  collected and why. Your shop's customers are the data principals.
- **We are the processor** (GDPR) and **Data Processor** (DPDP Act). We act on
  your instructions.

You determine the lawful basis for collecting your customers' data. We do not,
and cannot, do that for you.

## 2. Subject matter and duration

| | |
|---|---|
| **Subject matter** | Providing Posnic Cloud: sync, off-site backup, dashboard |
| **Duration** | For as long as your subscription runs, plus 30 days for export |
| **Nature and purpose** | Storage, transmission, backup and retrieval of shop records |
| **Types of personal data** | Customer names, phone numbers, email and postal addresses, purchase history; staff names, logins and activity records |
| **Categories of data subject** | Your customers, and your staff |
| **Special category data** | None expected. Posnic has no field for health, biometric or similar data. Do not put it in a free-text field. |

## 3. Our obligations

We will:

1. **Process only on your documented instructions**, which these terms and your
   use of the service constitute. If we believe an instruction breaks the law,
   we will tell you rather than carry it out.
2. **Keep it confidential.** Anyone with access is bound by confidentiality.
3. **Keep appropriate security** — Section 5.
4. **Use subprocessors only as described** in
   [SUBPROCESSORS.md](SUBPROCESSORS.md), with 30 days' notice before adding one,
   and remain responsible to you for what they do.
5. **Help you answer data subject requests** — access, correction, erasure,
   portability — using the export and deletion tools, and by hand where those
   are not enough.
6. **Help you** with impact assessments and with regulator consultation, so far
   as is reasonable given what we know.
7. **Tell you about a personal data breach without undue delay** and in any case
   within **48 hours** of becoming aware — Section 6.
8. **Delete or return** the data on termination, per Clause 6 of the Terms.
9. **Assist you in keeping processing secure**, including with the measures in
   Section 5, and in responding to an incident.
10. **Make available what you need** to verify this, and allow an audit —
    Section 7.
11. **Tell you if we are ever required by law to process your data in a way your
    instructions do not cover**, before doing so, unless that law forbids us
    from telling you.

## 4. Your obligations

You will:

1. Collect and use personal data lawfully, with a valid basis and any notice or
   consent your customers are owed.
2. Give lawful instructions.
3. Configure Posnic appropriately — including who on your staff has access, and
   which integrations in `SUBPROCESSORS.md` you switch on.
4. Not put special category data into free-text fields.
5. Keep your own credentials secure.

**Where you use your own SMTP, SMS, WhatsApp, payment or S3 accounts, those are
your subprocessors, not ours.** Your till talks to them directly with your
credentials, and we are not in the path.

## 5. Security

Measures in place:

- **Encryption in transit** for all data between a till and the service.
- **Encryption at rest** for stored cloud data.
- **Device authentication by token**, stored as a SHA-256 hash, never in clear.
- **Credential fields encrypted at field level** with AES-256-GCM, and marked
  cloud-only so they are not synced in plain form.
- **Access control** — access to production limited to those who need it.
- **Audit logging** of access and administrative action.
- **Backups**, tested by restore.
- **Segregation** of one customer's data from another's.

We may change these as technology moves, provided security is not reduced. The
current position, including its limits, is described honestly in
[SECURITY.md](../SECURITY.md).

## 6. Personal data breach

On becoming aware of a breach affecting your data we will, without undue delay
and within **48 hours**, tell you:

- what happened and when we learned of it
- the categories and approximate number of records and people affected
- the likely consequences
- what we have done and propose to do
- a contact for more detail

We will keep you updated as we learn more, and give you what you reasonably need
to meet your own notification duties — **72 hours** to a supervisory authority
under the GDPR, and the timelines the DPDP Act sets for the Data Protection
Board and for affected principals.

The operational side is in [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md).

## 7. Audit

We will provide the information reasonably needed to show we are meeting this
addendum.

You may audit once in any twelve months, on 30 days' notice, at your cost,
during business hours, without unreasonable disruption, and under
confidentiality. Where an independent report or certification covers your
question, we may offer that instead. If an audit finds a material failure, we
fix it at our cost.

## 8. International transfer

Posnic Cloud data is intended to be stored **in India**. If we ever transfer it
outside India we will do so only with a lawful transfer mechanism — standard
contractual clauses or an adequacy finding — and update
[SUBPROCESSORS.md](SUBPROCESSORS.md) with 30 days' notice first.

Under the DPDP Act, transfers are subject to any restriction the Central
Government notifies, and we will comply with those as they are made.

## 9. Erasure

**The choice is yours: return, or deletion, or both.** On termination, tell us
which you want. By default we make the data available for export for 30 days and
then delete it.

Whichever you choose, deletion completes within **30 days** of your instruction
and we confirm when it is done — except where a law requires us to keep
something (tax records, for example), in which case we keep only that, for only
as long as required, and it stays protected by this addendum.

If you ask for a return, we provide it in the same documented export format the
product uses, so it is readable without our software.

**Backups.** Deleted data can persist in backups until they rotate out. Those
backups are encrypted, not used for anything else, and expire within **90 days**.

## 10. Order of precedence

Where this addendum conflicts with [TERMS_OF_USE.md](../TERMS_OF_USE.md), this
addendum wins on data protection. Where it conflicts with mandatory law, the law
wins.

## 11. Signing

If you need this executed, write to **info@posnic.com** with your organisation's
details. We will confirm the version, sign it, and note the execution date.

---

**Posnic Innovations**, Tamil Nadu, India
**Data protection contact:** info@posnic.com
**Security:** security@posnic.com
