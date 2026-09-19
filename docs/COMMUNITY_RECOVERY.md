# Offline account recovery

Local Community installations can reset the owner's password without email or
internet. The local database must still be available. Cloud accounts and tills
paired to Cloud use their Cloud account recovery process.

## During installation

After creating the local shop, both the quick and advanced installers display
eight recovery codes for the owner. Save the text file or write the codes down,
then confirm you have stored them safely before continuing to sign in.

Keep a copy separate from the till, such as in a password manager, on an external
drive kept securely, or on paper in a safe. The download may initially land in
your Downloads folder: move it to the safe location you chose. Anyone with a
code and your account name can reset your password. Do not send codes to support
or put them in screenshots, tickets or shared shop documents.

Each code works once. The codes are displayed only when issued; Posnic stores
their digests and cannot show the original codes again.

## An existing installation

An owner who has no codes sees a setup reminder after signing in. Open
**Profile → Account recovery → Manage recovery codes**, enter your current
password, and save the new set. Generating replacements immediately invalidates
every previous code, including unused ones. Updating the app does not generate
codes silently or change your password.

If installation closes before you save its codes, sign in with the password
you just chose and generate replacements here.

## When email does not work

1. On the sign-in page, choose **Recover with an offline code**.
2. Enter the owner's email or username exactly as used for this shop.
3. Enter one unused code and enter the new password twice.
4. Sign in with the new password. Mark that recovery code as used.

The code is consumed when the password changes. The account's previous sessions,
sign-in tokens and pending email reset links become invalid. Products, sales,
permissions and other shop data remain unchanged. The shop's audit log records
the reset without storing the password or recovery code.

Ten failed recovery attempts from one address pause attempts for fifteen minutes.
Email reset requests have a separate allowance. Codes remain valid until used
or replaced; they do not silently expire while stored for an emergency.

## No saved codes and no owner can sign in

Another authorized administrator may be able to reset the account through user
management. Otherwise, recovery requires the computer/server administrator's
access to the local installation. There is no public reset button that bypasses
proof of ownership, and support cannot retrieve your old password or codes.

For a server run from this repository, see the documented
[local recovery command](SELF_HOSTING.md#if-you-are-locked-out). Packaged desktop
installations without saved codes still require assisted local recovery; this
release does not add a native operating-system administrator recovery wizard.
Back up the shop data before assisted recovery. Reinstalling is not a password
reset and must not replace an existing shop.

## Implementation notes

Recovery is enforced by the API only for an unpaired local Community installation
and an active `super_admin` account. Codes contain 128 cryptographically random
bits each. Only domain-separated SHA-256 digests are persisted. High-entropy
random recovery codes do not need the slow password hashing used for memorable
passwords. Passwords retain the till's bcrypt format and existing length policy.

Code consumption and password replacement are one conditional MongoDB write.
An authentication generation counter revokes sessions and JWTs even if issuance
and reset occur in the same second. Code generation requires a signed-in owner
and the current password, and cookie-backed requests require CSRF protection.
Recovery records and authentication generations are excluded from Cloud sync.

This follows the relevant principles of the
[OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html):
unpredictable recovery secrets, secure storage, single use, limited attempts,
and signing in again after recovery.
