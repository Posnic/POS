# Email validation audit — 16 November 2026

Reviewed the shared frontend validator and form extension, reset, customer,
supplier, branch, staff/install/settings middleware, model validators, imports,
report recipients and help/feedback. This is a source audit with local regression
tests, not a completed browser walkthrough of every form.

## Corrected

- Frontend aliases and long domain suffixes; malformed local dots, domain labels,
  multiple recipients and excessive lengths are rejected.
- Form `emailExt` and daily-report sending use the shared frontend validator.
- Blank customer/supplier email remains optional; reset email remains required.
- Reset trims pasted surrounding whitespace before form validation and submission.
- Customer/supplier legacy patterns no longer impose a two/three-letter suffix or
  reject `+` aliases. Their API middleware still applies validator.isEmail.
- Customer/user models, helper validation, report recipients, password-reset and
  help/feedback server checks use the existing validator library instead of loose
  or outdated regular expressions.
- User create/update and reusable request normalization retain dots and subaddress
  tags. Existing lowercase behavior is retained, without provider-specific mailbox
  rewriting.

## Evidence and limits

13 API suites / 737 tests passed; 17 frontend/recovery tests passed; 6 import
tests passed. The import suite was initially invoked with Node's test runner,
which cannot load Jest globals; its rerun under Jest passed.

The earlier deployed alias hotfix is separate from this broader local change.
No existing email identities were migrated. No schema, collection or sync lane is
added: email remains part of its existing customer/supplier/user record. Identical
validation changes must ship in both cloud API and desktop API before behavior can
be considered consistent across installations. Reconnection/data round-trip and
actual reset-email delivery remain unverified.

Existing module-specific maximum lengths remain (some are below 254); widening
persisted field limits is not part of this patch. Quoted local parts and raw Unicode
domain inputs are not claimed as supported by the browser forms. Punycode domains
can be used. Syntax validation does not verify mailbox ownership or deliverability.
