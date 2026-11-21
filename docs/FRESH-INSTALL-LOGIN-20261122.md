# Fresh Community setup login investigation — 22 November 2026

Status: fixes prepared; native desktop acceptance and release are not complete.

## Evidence and root causes

The signed public 1.9.4 portable package contains a login password input and
jQuery validation limited to 20 characters. Its setup wizard permits longer
passwords. A 29-character setup password hashes and verifies correctly, but
cannot be entered intact in the login form.

The shipped installation service also hashes `register_userpassword.trim()`.
Login verifies the supplied password without trimming. A password with a
leading or trailing space therefore fails immediately after creation when the
same characters are entered.

The new regression test failed on both cases before the changes, while an
ordinary 13-character password passed. The exact shipped API also successfully
created and authenticated an ordinary test account in an isolated profile.
This is not a universal API authentication failure.

Neither credential condition has yet been confirmed for the reporting customer.
Their message confirms fresh setup followed by invalid credentials; no exact
reproduction details or application error screenshot have been obtained.
Never request their password.

## Changes

- Login accepts the API's existing 200-character limit instead of truncating at
  20. Existing stored credentials and authentication comparisons are unchanged.
- New installation hashes the exact password, including surrounding spaces.
- New plaintext setup passwords exceeding bcrypt's 72 UTF-8-byte boundary are
  rejected explicitly instead of silently losing their suffix. Login retains
  compatibility with existing stored hashes. Cloud pre-hashed signup is unchanged.
- The existing native package smoke path now requires offline shop creation,
  recovery-code acknowledgement and a login through the rendered form reaching
  the authenticated dashboard. It uses a disposable profile and refuses an
  existing one. Input uses Chromium's text editing path to catch truncation.
  No new CI jobs or platforms were added. This extended gate is not yet executed.

## Verification

- 38 focused desktop/authentication/setup/packaging tests passed.
- 60 installation-service tests passed.
- API lint: zero errors; 49 existing warnings.
- Syntax, diff whitespace and attribution checks passed.
- Real signed 1.9.4 API: fresh setup and login returned success and a token.
- Native UI test: blocked at the Windows firewall permission dialog; the user
  must dismiss it. Do not bypass or automate Windows security controls.
- New packaged build, native onboarding gate, restart/login and signed release:
  pending. Passing unit tests is not release acceptance.

The isolated API test profile is
`C:/Users/Kayal/Documents/Codex/fresh-login-repro-194-20261122`.
It now contains a fictional test shop. Do not reuse it as a fresh profile or
confuse it with the normal shop. No customer data or credentials were modified.

## Sync and rollout

This changes credential input and new-account hashing, not business data or
replication. It does not reset existing owners, copy credentials to another
shop, or change cloud authority. Existing cloud hash provisioning and login
refresh behavior remain intact. The shared login page needs the matching web
deployment as well as rebuilt desktop packages.

Do not overwrite 1.9.4 or move its tag. Before releasing a new version, complete
native setup/login, logout/login and restart/login on the actual package; verify
wrong-password rejection, prior-account login and the complete signed platform
matrix under AGENTS.md. Confirm the customer's condition separately before
claiming their case resolved.
