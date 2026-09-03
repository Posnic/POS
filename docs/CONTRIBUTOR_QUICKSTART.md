# Contributor quickstart

This guide is the shortest path from "I want to help Posnic" to a pull request
that a maintainer can review. It is written for contributors who may be new to
the codebase, not necessarily new to programming.

If anything here fails on a clean machine, open an issue. That is a useful
contribution too.

## Pick a task

Start with one small, reviewable change.

| I want to help with | Good first place |
|---|---|
| A small bug or test | Issues labelled [`good first issue`](https://github.com/Posnic/POS/labels/good%20first%20issue) |
| Translation work | [#32 Language pack contributions](https://github.com/Posnic/POS/issues/32) |
| Translation tooling | [#31 Localization framework](https://github.com/Posnic/POS/issues/31) |
| India e-invoicing | [#29 India GST e-invoice support](https://github.com/Posnic/POS/issues/29) |
| GST reports and exports | [#30 India GST return preparation](https://github.com/Posnic/POS/issues/30) |
| In-app help or AI assistant | [#33 In-app helper and AI assistant](https://github.com/Posnic/POS/issues/33) |
| External integrations | [#34 Optional connector framework](https://github.com/Posnic/POS/issues/34) |
| Hardware testing | [#12 Hardware evidence](https://github.com/Posnic/POS/issues/12) |
| Bigger roadmap work | [#35 Contributor roadmap](https://github.com/Posnic/POS/issues/35) |

For anything non-trivial, comment on the issue before opening a large PR. A
small design note saves everybody time.

## Before you code

Read the issue's acceptance criteria and pick one small checkbox or PR slice.
If the issue does not say exactly what "done" means, make the first PR or issue
comment add that checklist before changing behavior.

A useful acceptance criterion is specific and testable:

- It names the user-visible result.
- It says what must keep working.
- It names the test, fixture, screenshot, or evidence needed for review.
- It names what is out of scope when the risky part needs a separate design.

## What you need

- Git
- Node.js 22.12 or newer
- npm
- About 3 GB of free disk space

You do not need to install MongoDB. Posnic downloads and runs its own local
MongoDB for development. The first launch can take a few minutes while it
unpacks.

Check your tools:

```bash
node --version
npm --version
git --version
```

Node 20 is not enough for the desktop app. If dependency install fails before
the app starts, check the Node version first.

## Get the code running

```bash
git clone https://github.com/Posnic/POS.git
cd POS
npm install
npm --prefix api install
npm start
```

The app opens as an Electron desktop app. On first run it prepares a local
database and walks you through setup.

### Or run it in a browser

```bash
npm run dev
```

Then open **http://localhost:3000/public/login.html**.

Same application, same API, same database - it is the desktop app's own server
with a browser in front of it instead of an Electron window. Useful when you
are changing a screen and want to hit refresh, and necessary if you are
reviewing a translation, because you need to see the words in place.

The first run generates development secrets into `api/.env` (kept out of git,
and not what a real installation uses), builds the frontend if it has not been
built, and starts the bundled MongoDB. Ctrl+C stops all of it.

Development defaults:

| Service | Default |
|---|---|
| Local API | `http://127.0.0.1:42590` |
| Local MongoDB | `mongodb://127.0.0.1:47590` |
| Windows log | `%APPDATA%\posnic\app.log` |
| macOS log | `~/Library/Application Support/posnic/app.log` |
| Linux log | `~/.config/posnic/app.log` |

If the app does not open, read the log before changing code. It usually names
the failing file, port, or dependency.

## Where code lives

| Area | Path |
|---|---|
| Desktop shell, startup, packaging | `src/` |
| App screens and browser UI | `frontend/` |
| Local API | `api/src/` |
| API tests | `api/tests/` |
| Desktop/source tests | `tests/` |
| Release and packaging scripts | `scripts/` |
| Documentation | `docs/` and `.github/` |

The usual backend shape is:

```text
routes -> controllers -> services -> repositories -> models
```

Do not rename persisted database fields, collection names, legacy route aliases,
or sync-facing values in a normal PR. Those values may already exist on shop
machines that cannot be force-updated.

## Test the right thing

Run the smallest useful test while developing, then run the broader gate before
opening the PR.

| Change type | Useful checks |
|---|---|
| API behavior | `cd api && npm test -- tests/unit/path/to/test.js` |
| Full API gate | `cd api && npm test` |
| Desktop or frontend behavior | `npm test` from repo root |
| Startup/auth behavior | `npm run test:auth` |
| Translation work | `node --test tests/i18n.test.js` |
| Packaging allowlist changes | `npm run check:modules` |
| API route/docs changes | `cd api && npm run docs:check` |
| API lint | `cd api && npm run lint` |
| Installer/package changes | `npm run build:fast` |

Current test policy:

- `cd api && npm test` is the curated API suite used by CI.
- `npm test` at the repo root runs desktop/source tests.
- `cd api && npm run test:known-failures` runs quarantined tests that are known
  to fail on a clean checkout.
- `cd api && npm run test:all` includes the quarantine. Expect known red tests
  unless the issue says otherwise.

If a clean checkout already has a known failure, do not hide it. If your branch
adds a new failure, fix that before asking for review.

## Common contribution paths

### Translation PR

1. Check [#32](https://github.com/Posnic/POS/issues/32) and say which language
   you want to take.
2. Keep the PR to one language or one translation-tooling improvement.
3. Preserve placeholders such as names, amounts, dates, counts, invoice numbers,
   tax labels, and branch names.
4. Run:

   ```bash
   node --test tests/i18n.test.js
   npm test
   ```

5. Include screenshots or notes for login, new sale, checkout, reports,
   settings, and receipt/invoice print if you changed visible strings.

### Tax, GST, or e-invoice PR

1. Start from [#29](https://github.com/Posnic/POS/issues/29) or
   [#30](https://github.com/Posnic/POS/issues/30). For e-invoicing, read the
   [research](INDIA_EINVOICING_RESEARCH.md), the
   [readiness inventory](INDIA_EINVOICING_READINESS.md) and the
   [design](INDIA_EINVOICING_DESIGN.md) first; the design names the fixtures
   and the order of PRs.
2. Use synthetic records only. Do not post real GSTINs, invoices, customer data,
   portal credentials, logs, or database files.
3. Keep offline preparation separate from online portal submission.
4. Add or update focused tests in `api/tests/unit/services/` or the matching
   controller/repository test folder.
5. Run:

   ```bash
   cd api
   npm test -- tests/unit/services/tax-engine.test.js tests/unit/services/tax-profiles.test.js tests/unit/services/tax-regime.test.js
   npm test
   ```

### UI or workflow PR

1. Keep the change to one workflow.
2. Do not make the sale screen slower or more crowded.
3. Check small laptop widths and keyboard use when the changed control is part
   of billing.
4. Run the closest root test plus:

   ```bash
   npm test
   ```

### Hardware evidence PR or issue

1. Use the hardware evidence issue template.
2. Name the exact printer, scanner, cash drawer, scale, display, operating
   system, driver, cable, and connection type.
3. Include what passed, what failed, and what was not tested.
4. Do not call a device certified unless the maintainer accepts the evidence.

### Connector or AI PR

Before proposing an external app or connector, read the
[app review checklist](APP_REVIEW_CHECKLIST.md). It shows the required review information and synthetic examples of a submission that passes or fails.

1. Start with design in [#33](https://github.com/Posnic/POS/issues/33) or
   [#34](https://github.com/Posnic/POS/issues/34).
2. The default local app must send no shop data outside the machine.
3. Any internet, credential, external API, AI model, or cloud behavior must be
   optional, explicit, and reviewed before implementation.
4. Add tests for disabled/offline/failure behavior.

## Pull request checklist

Before opening a PR:

1. Branch from **`develop`**, and open the pull request against `develop`.

   `develop` is where contributions land and get tested; `main` is released
   code. If you opened against `main` by mistake, change the base branch with
   the "Edit" button next to the PR title - the work is fine, only the target
   is wrong.

   ```bash
   git fetch origin develop
   git checkout -b my-change origin/develop
   ```
2. Keep one concern per PR.
3. Link the issue and state which acceptance criteria or PR slice is covered.
4. Add or update a focused test when code behavior changes.
5. Run the checks that match your change type.
6. Sign off commits:

   ```bash
   git commit -s -m "Explain why this change exists"
   ```

7. Fill in the pull request template with what changed and how you tested it.

## After it is merged

Your change lands on `develop` and is labelled `ready for QA`, and a comment
says where to try it. Anyone can test it - including you, and including people
without write access.

### About develop.posnic.io

`develop` is deployed to **https://develop.posnic.io** on every merge, so you
can try a change without checking anything out.

It is a **public sandbox**, and worth being blunt about what that means:

- It runs code that has been merged but not released, including changes nobody
  has tested yet. It will sometimes be broken. That is what it is for.
- It holds **demo data only** and is wiped. Do not put anything real into it -
  not a customer, not a phone number, not a price you care about.
- Assume anything you type there can be read by anyone.

It shares nothing with the production estate: its own database, its own
secrets, and no route to anything a real shop uses. If it ever misbehaves the
answer is to delete it and make another, which is only a comfortable answer
because nothing on it matters.

If you have a few minutes, testing somebody else's change is genuinely useful
and needs no permissions - [`docs/QA_PROCESS.md`](QA_PROCESS.md) is the whole
thing on one page. Filter issues by `ready for QA`, try the thing, and
say what happened. Reporting that something is broken is as valuable as fixing
it, and much better found there than by a shopkeeper.

The maintainer promotes tested work from `develop` into a release.

For a focused fix, a good PR title looks like:

```text
Fix receipt tax rounding for inclusive discount lines
```

For larger work, open the design or fixture PR first. The implementation can
come after the behavior is agreed.

## Safety rules

Never post these in public issues, PRs, logs, screenshots, or fixtures:

- Customer names, phone numbers, email addresses, addresses, or photos
- Tax identifiers from a real business
- API keys, passwords, tokens, cookies, or database credentials
- Card, bank, UPI, payment-provider, or settlement data
- Production database files or unredacted logs

Use fictional shops and synthetic transactions. Security vulnerabilities go
through [SECURITY.md](../.github/SECURITY.md), not public issues.

## When you are stuck

- Setup problem: open a bug with your OS, Node version, command, and log.
- "How do I do this in Posnic?": ask in
  [Discussions](https://github.com/Posnic/POS/discussions).
- Unsure whether a change belongs in the offline app or Cloud: comment on the
  linked feature issue first.
- No reply after a week: comment once on the issue. That is welcome.
