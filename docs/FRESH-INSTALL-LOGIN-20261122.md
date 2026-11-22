# Fresh Community setup login investigation — 22 November 2026

Status: core fix reproduced and verified in native packages; expanded entry-point
audit changes tested locally, final combined CI and signed release pending.

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
  No new CI jobs or platforms were added.

## Verification

- 45 focused desktop/authentication/setup/packaging tests passed.
- 370 API controller/service/repository/validation tests passed.
- API lint: zero errors; 49 existing warnings.
- Syntax, diff whitespace and attribution checks passed.
- Real signed 1.9.4 API: fresh setup and login returned success and a token.
- Native signed 1.9.4 Windows UI: created a fresh fictional shop using a
  29-character password. Typing the same password into login retained only 20
  characters and produced the invalid-credentials error. This is an actual
  desktop reproduction, not just a service test.
- Native package run 44947400386 at 1b2d9c48: Windows installer/portable and
  Linux AppImage/DEB/Snap passed fresh setup through authenticated dashboard
  using a long password with surrounding spaces. Both macOS architectures
  stalled after saving the database connection configuration, before recovery
  confirmation. Diagnostic rerun 44948650269 captured a macOS "Keychain Not
  Found" modal and SecItemAdd waiting in the main thread. The harness had
  overridden HOME with an empty directory, hiding the runner's login Keychain.
  The harness now retains macOS HOME while POSNIC_USER_DATA still isolates the
  app/shop profile. Encryption remains enabled. Run 44949576446 at 22167125
  passed all nine formats on Windows, Linux, Intel Mac and ARM Mac, including
  wrong-password rejection and login after logout.
- Local Windows candidate: real native signup blocked mismatched confirmation,
  accepted the corrected long password with surrounding spaces, and typing the
  exact password into login reached the authenticated dashboard. Fictional
  profile: fresh-login-fixed-ui-20261122. Firewall dismissal no longer blocks it.
- Restart/login, remaining native acceptance and signed release are pending.
  Passing unit tests is not release acceptance.

## Expanded entry-point audit

Normal offline signup already had a required confirmation and exact match check
in setup-region.js. Advanced setup lacked owner confirmation; it is now required
before advancing and again before submission. Both send confirmation to the API,
which validates it when supplied without breaking older provisioners. Setup's
server minimum now matches the wizard's eight characters. UTF-8 byte limits are
checked without truncating or trimming passwords.

Mobile, kiosk and admin verification had stale hash/trim paths; they now share
the existing dual-format verifier, retaining role, activation, branch and tenant
checks. Existing-password checks allow long credentials and preserve spaces.
Change-password middleware no longer trims any of the three password fields.
Legacy base64-before-bcrypt write paths reject more than 54 UTF-8 bytes, since
base64 expands those bytes to bcrypt's 72-byte boundary. Their existing character
limits remain; the forgot-password UI now agrees with its controller's eight-
character minimum. New staff creation cannot omit a password or accept fewer
than five characters (login's existing minimum); empty password on edit still
means no password change. New owner emails are stored lowercase, matching the
user model's email lookup contract; no existing records are migrated.

The broader changes require a new native matrix run. A CodeQL alert on the
test harness readiness condition is also being checked after separating read-
only readiness observation from archive verification and onboarding execution;
no security check was disabled or alert dismissed.

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

For an account created by 1.9.4 with more than 20 characters, the stored hash
already covers the accepted password; fixing login input should allow that
existing account to sign in. Verify this using the isolated old-version shop.
For an account created with surrounding spaces, 1.9.4 has already discarded
those spaces before hashing. The new installation fix cannot reconstruct them
or change that stored password. Such an existing account still uses the
previously stored trimmed password; do not introduce a global login-trimming
fallback or silently rewrite existing hashes.

Do not overwrite 1.9.4 or move its tag. Before releasing a new version, complete
native setup/login, logout/login and restart/login on the actual package; verify
wrong-password rejection, prior-account login and the complete signed platform
matrix under AGENTS.md. Confirm the customer's condition separately before
claiming their case resolved.
