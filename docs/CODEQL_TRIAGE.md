# CodeQL triage

617 open alerts, 382 of them in code we wrote. This records what was checked,
what was found, and — for the large classes — what to look for, so the next
person does not start from 617 again.

The split that matters is not by severity. CodeQL's severity is about the rule,
not about this codebase: a `high` in a vendored library nobody calls is worth
less attention than a `medium` on a route a shop can reach unauthenticated.

## What "our code" means here

```
api/src/**        the API
*.js (repo root)  main.js, mongodb-manager.js, update-service.js and friends
```

Everything else — `frontend/`, `builds/`, `node_modules` — is vendored or
generated. 235 of the 617 are there and are not ours to fix; upgrading the
dependency is the only real answer, and `npm run check:advisories` already
tracks the ones with published advisories.

## Fixed

### `js/type-confusion-through-parameter-tampering` — critical — FIXED

`api/src/services/branch.service.js`

```js
if (!query || query.length < 2) { ...reject... }
// then, in the repository:
{ branch_name: { $regex: query, $options: 'i' } }
```

`query.length < 2` reads as a length check and is really a type check that
anything can pass. Express parses `?query[]=a&query[]=b` into an array — length
2, so it passes — and `?query[$ne]=x` into an object, whose `.length` is
`undefined`, and `undefined < 2` is false. Either way it reached `$regex`,
where a Mongo operator is not a pattern.

Now coerced to a string, trimmed, length-checked, and regex-escaped. The escape
matters independently: without it a shop's own search box accepts an arbitrary
regular expression, which is both a way to read more than intended and a way to
hang the database on `(a+)+$`.

**The shape to look for elsewhere:** a request value used with `.length`,
`.trim()`, `.toLowerCase()` or similar *without* a `typeof` check, then placed
in a query. The guard looks present and is not.

## Judged, not fixed

### `js/insufficient-password-hash` ×2 — `api/src/middleware/api-key.js` — not a defect

`sameKey()` hashes both sides with SHA-256 so `timingSafeEqual` gets two buffers
of equal length. It is a constant-time comparison of an API key, not password
storage — there is no stored hash and nothing to brute-force offline. A slow KDF
here would make every authenticated request slower and protect nothing.

### `js/insufficient-password-hash` ×2 — `user.service.js`, `users.controller.js` — misleading, not exploitable

SSO token generation builds something JWT-shaped and signs it with
`createHmac('sha256', email)` — the user's own email as the secret, which is
public.

That would be serious if the signature were trusted. It is not: `ssoAuth`
validates by looking the token up in the database (`{ token, status: 'active' }`
plus expiry), so a forged signature gets an attacker nothing. The token's
strength is its 48 random bytes, which is adequate.

So: not a vulnerability, but the code invites a future reader to trust a
signature that is decorative. Worth removing or giving a real secret the next
time that file is opened — as tidiness, not as a fix.

## The large classes

### `js/sql-injection` ×184 — "this query object depends on a user-provided value"

The NoSQL taint rule, not string-concatenated SQL. Almost all are ordinary
filtered queries where a request value becomes a *value* in a Mongo filter,
which is safe — the driver sends it as data.

**The dangerous minority is where a user value reaches an operator position:**
the whole filter object, a key name, `$where`, `$regex`, or anything spread into
a query with `...req.body`. That is the branch.service bug above, and it is the
only one of this class confirmed so far.

Triaging the rest one by one is low-yield. The higher-yield version is to search
for the shape:

```
grep -rn '\$where\|\$regex' api/src/
grep -rn '\.\.\.req\.\(body\|query\|params\)' api/src/
```

### `js/missing-rate-limiting` ×64

Real, and mostly not urgent: the API is reachable from the till and the LAN, not
the open internet. The ones worth rate limiting first are the routes an
unauthenticated caller can reach — login, install, password reset — rather than
all 64.

### `js/log-injection` ×46

A request value reaching `console.log` without stripping newlines, so a crafted
input can forge a log line. The logs are local files read by us during support,
so the consequence is a confusing support session rather than a breach. Worth a
single sanitising helper at the logger rather than 46 individual edits.

### `js/redos` and `js/polynomial-redos` ×13

Regular expressions that can be made to run for a very long time on a crafted
input. Worth checking the ones whose pattern comes from a request — the
branch.service escape above removed one route to this.

## How to re-run this

```
gh api --paginate "repos/Posnic/POS/code-scanning/alerts?state=open&per_page=100"
```

Split by `most_recent_instance.location.path` against the two patterns at the
top of this file. Anything outside them is vendored.

## Captcha: what is configured, and how to change it

The default is arithmetic: a sum, signed with an HMAC, verified server side.
It needs no account, no third-party script and no cookie, and it works on a
till in a shop with a bad connection. It stops the broad automated flood,
which is what public forms actually receive.

It will not stop somebody writing a script for this site specifically. If that
starts happening, set two environment variables on the API and every form
switches over with no code change:

```
TURNSTILE_SITE_KEY=...
TURNSTILE_SECRET=...
```

Cloudflare Turnstile rather than Google reCAPTCHA, deliberately: it sets no
cookie and does not profile the visitor, which matters for a site carrying a
cookie banner and a privacy policy that promises exactly that. The DNS is
already on Cloudflare.

`/api/captcha` reports which provider is active and the page renders that one -
the server decides, because the server is the side that verifies. Both paths
are checked server side; a captcha validated only in the browser is decoration.

The desktop support form has no captcha at all. It is called by an installed
application rather than a browser, and a shop whose till is broken must not be
asked to solve arithmetic first; a twenty second per-IP wait guards it instead.
