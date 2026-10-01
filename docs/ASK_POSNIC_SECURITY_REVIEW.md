# Ask Posnic PR security review — 1 October 2026

Reviewed the ten open CodeQL findings associated with PR #1055, including their
SARIF data-flow paths. Six findings receive code changes. Four concern
deterministic identifiers and are classified as false positives after tracing
the actual hash inputs. No scanning rule, workflow, security gate or repository
protection is disabled.

| Finding | Evidence and disposition |
| --- | --- |
| [1032: polynomial regex](https://github.com/Posnic/POS/security/code-scanning/1032) | Schedule destinations now require a string of at most 254 characters before normalization; email validation uses the existing validator library. Adversarial repeated-dot input, header injection and object input are rejected before database access. |
| [1033: stored XSS](https://github.com/Posnic/POS/security/code-scanning/1033) and [1034: missing rate limiting](https://github.com/Posnic/POS/security/code-scanning/1034) | Both point to the local browser-validation harness, which interpolated repository HTML in an HTTP handler. That handler now returns only a fixed blank page. The controlled Puppeteer client loads the test markup directly; HTTP requests no longer trigger that file read or dynamic HTML response. The harness remains loopback-only. |
| [1038: database query](https://github.com/Posnic/POS/security/code-scanning/1038) | Action confirmations already required a valid HMAC. The signed claims now additionally require a bounded canonical token shape, scalar hexadecimal nonce, supported action type and integer expiry. MongoDB uses explicit equality for nonce/type and checks the saved draft expiry. Execution uses the claimed database row's type and payload. Invalid claims, even signed ones, cannot reach the database. |
| [1039: file race](https://github.com/Posnic/POS/security/code-scanning/1039) | Recovery evidence is opened once, inspected with `fstat` and read from the same descriptor. Reads stop at 16,001 bytes and reject anything over 16,000, including growth after inspection. The descriptor closes on success, parse failure and size rejection. |
| [1040: regex anchoring](https://github.com/Posnic/POS/security/code-scanning/1040) | Markdown detection now compares exact MIME types or a final `.md`/`.markdown` filename extension. An incidental `markdown` substring or `.md.exe` does not select Markdown. |

## Identifier hashes, not password storage

The four password-hashing reports share the same source:
`api-key.js` calls `findUserByApiKey`, which returns a user record. CodeQL treats
that entire return value as password data. In each reported path, the value that
actually reaches SHA-256 is the record's **license ID**, not `apikey` or
`password`. The user schema types license as ObjectId and excludes password from
normal queries. The API-key lookup explicitly selects the API key, license and
branch access for authentication; none of the flagged hash functions reads that
API key.

| Finding | Actual hash purpose and inputs |
| --- | --- |
| [1035](https://github.com/Posnic/POS/security/code-scanning/1035) | Own-key embedding reservation ledger ID: license ID, branch ID, UTC month and currency. |
| [1036](https://github.com/Posnic/POS/security/code-scanning/1036) | Local semantic chunk cache key: license ID, embedding model/dimensions, source title and source text. The related source hash covers document content/revision. |
| [1037](https://github.com/Posnic/POS/security/code-scanning/1037) | Managed semantic namespace: configured vector namespace, database name and license ID. Related hashes identify source revisions/chunks and index configuration. |
| [1044](https://github.com/Posnic/POS/security/code-scanning/1044) | Daily telemetry document ID: license ID, UTC day, counter kind, currency and payer. |

These hashes do not authenticate a password or store a credential verifier.
SHA-256 remains appropriate for their stable identifier/content-fingerprint
purpose. Replacing them with salted password hashes would break deterministic
reservation and cache identity. Their classification is therefore false positive,
not accepted password-storage risk. Scope tests explicitly verify that synthetic
API-key/password fields do not enter the identifier context. The existing
reservation, tenant separation and replay tests still pass.

The relevant upstream rule identifies sensitive sources and non-password-hashing
sinks through [CodeQL's password hash data-flow model](https://github.com/github/codeql/blob/main/javascript/ql/lib/semmle/javascript/security/dataflow/InsufficientPasswordHashCustomizations.qll).
This explains the shared source classification; it does not replace inspection
of this application's four data flows. Only these individually reviewed alerts
are eligible for a false-positive dismissal. No blanket suppression is added.

## Verification and formatting

- Eight targeted API suites passed all 28 tests, including the malicious signed
  claims and file-growth cases, real-MongoDB action/recovery fixtures and existing
  own-key/metrics checks. The recovery token-size follow-up also runs through the
  native recovery fixture before release.
- Authenticated Ask Posnic application smoke and desktop/mobile browser checks
  pass. The harness still checks escaped customer/source content after moving
  trusted test markup out of the HTTP handler.
- The failed CI formatting step reported 73 files. The repository's existing
  formatter was applied; AST comparison verified unchanged program syntax in
  67 files that received only formatting. Intentional behavioral/test edits are
  reviewed separately. No formatter or lint rule was weakened.
- The four shared extraction/retrieval files were kept byte-identical in the
  Intranet companion. Its full suite passed 516 tests with seven existing skips.

The GitHub CodeQL result on the pushed commit is the final remote check for the
six changed findings; local tests alone do not prove those alerts are closed.
The four identifier findings have a separate documented false-positive disposition.
