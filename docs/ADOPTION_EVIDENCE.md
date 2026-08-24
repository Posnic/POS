# Adoption evidence

Public claims about real use need more care than a star count, download count, or
private compliment. This policy explains how Posnic accepts deployment reports,
what they can establish, and when any part may be cited outside its GitHub issue.

## Submit a report

Use the
[real deployment evidence form](https://github.com/Posnic/POS/issues/new?template=deployment_evidence.yml)
for a live deployment, pilot, installation attempt, former deployment, or
production-like evaluation. Reports that identify failures, stopped trials,
workarounds, or reasons Posnic was not selected are welcome.

Use other channels for different purposes:

- software defects belong in the bug report form;
- reproducible synthetic transaction results belong in the POS acceptance form;
- exact physical-device observations belong in the hardware evidence form;
- questions belong in Discussions; and
- vulnerabilities must be reported privately under `SECURITY.md`.

## Required record

A useful deployment report names:

- the reporter's relationship to the deployment and any material connection to
  Posnic;
- exact release, source commit, package identity, and hash when available;
- whether the system was live, piloted, evaluated, stopped, or retired;
- a bounded observation window;
- country, business type, approximate deployment size, OS, and relevant hardware;
- workflows actually observed;
- expected and observed behavior, including failures and workarounds;
- the method or evidence behind any number; and
- untested paths and limitations.

An issue author may choose that the report remain a public issue only. That
choice must be respected. A GitHub issue never grants permission to use a
business name, logo, quotation, private evidence, or personal details.

## Review states

| State | Meaning | What may be said |
|---|---|---|
| Submitted | A public report exists and has not been reviewed | Only that a report was submitted |
| Clarification requested | Identity, scope, evidence, or privacy needs work | No product or outcome claim |
| Bounded public observation | Version, relationship, scope, result, and limits are sufficiently clear | Link to the issue using the permission selected by its author |
| Case-study eligible | The author separately approved exact wording and every named asset or metric has a retained source | Publish only the approved statement with date and limitations |
| Disputed or withdrawn | A material contradiction, correction request, or withdrawal exists | Retain the correction trail; stop promotional reuse |

Maintainer review does not certify the deployment, verify every statement, or
make the result representative of another business. Reports must preserve
unfavorable details and later corrections.

## Privacy and data minimisation

GitHub issues are public and permanent enough to treat as publication. Never
attach:

- customer, cardholder, bank, employee, or supplier records;
- phone numbers, email addresses, home or exact shop addresses, tax identifiers,
  credentials, tokens, or licence keys;
- production databases, unrestricted backups, private logs, or documents that
  reveal transaction-level business data; or
- a person's photo, quote, business name, or logo without authority to publish
  it.

Prefer fictional transactions, aggregate ranges, redacted screenshots, and
links to existing public issues. Security findings never belong in this form.

## No bought proof

Posnic does not buy favorable deployment reports, exchange discounts for
positive wording, suppress a report because it is unfavorable, or convert
downloads and GitHub stars into customer counts. Any free service, discount,
referral, employment, contract, investment, or other material connection must
be disclosed beside the report.

The purpose is to learn what happens in real use and make product claims more
accurate. Marketing reuse is optional and secondary.

## Corrections and withdrawal

The issue author can add a correction or change citation permission by
commenting on the issue. Posnic must update or remove any external summary that
no longer matches the source. The original public discussion may remain in
GitHub's history, so private information should never be posted in the first
place.
