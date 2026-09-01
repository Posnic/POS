# Contributing to Posnic

Thanks for helping make Posnic better! Contributions of every kind are
welcome: bug reports, fixes, features, translations, docs, and reports of
hardware quirks from real shops.

## Getting started

If this is your first Posnic contribution, start with the
[contributor quickstart](../docs/CONTRIBUTOR_QUICKSTART.md). It has the local
setup commands, common test commands, and task map for translations, GST,
e-invoicing, AI helper work, integrations and hardware evidence.

```bash
git clone https://github.com/Posnic/POS.git
cd POS
npm install
npm --prefix api install
npm start
```

You do **not** need to install MongoDB. Posnic bundles its own and picks a port
derived from the application name, so it never collides with a database you
already run. The first launch takes a few minutes while it unpacks.

- [Contributor quickstart](../docs/CONTRIBUTOR_QUICKSTART.md) — first setup,
  task map and test matrix
- [docs/DEVELOPMENT.md](../docs/DEVELOPMENT.md) — full developer guide: tests,
  linting, conventions, and what not to rename
- [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) — how the pieces fit together
- [docs/API.md](../docs/API.md) — REST reference
- [docs/BUILD_INSTRUCTIONS.md](../docs/BUILD_INSTRUCTIONS.md) — installer builds

## How to contribute

1. **Open an issue first** for anything non-trivial — a bug report or a short
   proposal for a feature. It avoids wasted work on both sides.
2. Pick a task from the
   [contributor roadmap](https://github.com/Posnic/POS/issues/35) or the
   [`good first issue`](https://github.com/Posnic/POS/labels/good%20first%20issue)
   label.
3. Fork, create a branch (`fix/receipt-rounding`, `feat/tamil-translation`).
4. Keep pull requests focused — one change per PR.
5. Match the style of the surrounding code; avoid drive-by reformatting.
6. Run the tests: `cd api && npm test` (7,744 unit tests, about a minute), plus
   `npm test` at the repo root for the desktop side (294 more). Both should pass on a
   clean checkout — if they do not, that is worth an issue on its own.

   `npm test` skips twelve quarantined suites listed in
   `api/jest.known-failures.js`; `npm run test:known-failures` shows exactly
   where those stand, and they are good first issues.

Nineteen unit tests fail on a clean checkout. That is known drift, tracked as
good first issues — not something you broke. If your branch makes it twenty,
that one is yours.

**Do not rename a persisted field or collection in a pull request.** Those names
travel over the sync wire to desktop installations that cannot be force-updated,
so renaming them needs a versioned migration. See
[docs/DEVELOPMENT.md](../docs/DEVELOPMENT.md#what-not-to-rename).

## What happens to your pull request

So you know what you are waiting for.

1. **CI runs** — unit tests, the desktop tests, lint, the packaging check and
   the API docs check. All of them gate: if CI is red, the pull request waits.
2. **A maintainer reads it.** Usually within a week. The project is small; see
   [GOVERNANCE.md](../docs/GOVERNANCE.md).
3. **You may get comments.** Comments are not rejection. A pull request with
   twenty comments is one someone is taking seriously.
4. **It merges**, or it does not — and if it does not, the reason is written in
   the thread. A silent close is a failure on our part; say so if it happens.

### What gets merged quickly

- A failing test that now passes
- A fix with a test proving it
- Documentation, including fixes to this file
- Small, focused changes with a clear description

### What takes longer, and why

- **Changes to sync**, the build pipeline, or white-label behaviour. These reach
  machines that cannot be force-updated; getting them wrong breaks shops that
  cannot roll back.
- **New dependencies.** Every one is weight in an installer downloaded over a
  slow connection, and something to keep patched for years.
- **Large refactors with no prior issue.** Not unwelcome — but talk first, so
  nobody spends a weekend on a direction we will not take.
- **Anything requiring an internet connection** in the local edition. It must
  work fully offline. That belongs in Cloud.

### If nobody replies

Comment on the thread after a week. That is not nagging, it is a useful nudge —
notifications get missed. If it is still quiet after two weeks, say so in
[Discussions](https://github.com/Posnic/POS/discussions).

## Reporting bugs and requesting features

Both live in [SUPPORT.md](SUPPORT.md), including what a report needs to be
actionable, how issues are labelled and prioritised, and what happens to a
feature request after you file it.

Two things worth repeating here:

- **Security problems are never a public issue.** See [SECURITY.md](SECURITY.md).
- **Feature requests should describe the problem, not the solution.** What you
  are trying to do tells us more than the button you imagined, and often has a
  better answer.

## Contribute evidence without changing code

Reproducible observations are useful contributions. They help turn a broad
feature statement into a versioned result with an exact input, environment and
limitation.

- If you are reviewing Posnic independently, start with the public
  [review brief](https://posnic.com/assets/posnic-independent-review-brief.txt)
  and [24-control protocol](https://posnic.com/assets/posnic-independent-review-protocol.csv).
  Review access does not require payment, positive coverage, a backlink or
  advance approval. Publish failures, conflicts and untested areas as well as
  successful results.
- Run the public
  [vendor-neutral POS acceptance fixture](https://posnic.com/open-source-pos-benchmark#vendor-neutral-pos-acceptance-fixture)
  and submit the structured
  [acceptance result form](https://github.com/Posnic/POS/issues/new?template=pos_acceptance_run.yml).
- Test an exact printer, scanner, cash drawer, scale or display against the
  [hardware matrix](../docs/HARDWARE_MATRIX.md), then submit the structured
  [hardware evidence form](https://github.com/Posnic/POS/issues/new?template=hardware_evidence.yml).
- If you operate, piloted, installed, evaluated or stopped using Posnic, read
  the [adoption evidence policy](../docs/ADOPTION_EVIDENCE.md) and submit a
  structured
  [deployment evidence report](https://github.com/Posnic/POS/issues/new?template=deployment_evidence.yml).
  Failures, workarounds and reasons not to adopt are useful evidence.
- Read [ROADMAP.md](../docs/ROADMAP.md) for the current evidence gaps and the boundary
  between released, reproduced, in-validation and planned work.

An evidence issue is public and is not a certification or testimonial. Use
fictional transactions and remove customer data, payment data, credentials,
tokens, production logs and database files before attaching anything. Security
problems still go through [SECURITY.md](SECURITY.md), never a public issue.

## Sign your commits (DCO)

We use the [Developer Certificate of Origin](https://developercertificate.org/).
Sign each commit with `git commit -s`, which adds:

```
Signed-off-by: Your Name <you@example.com>
```

By signing off you certify you have the right to submit the code under the
project licence (AGPL-3.0-only).

## What makes a great bug report

- Posnic version (Help → About) and your operating system
- Steps to reproduce, what you expected, what happened
- The log file:
  - Windows `%APPDATA%\posnic\app.log`
  - macOS `~/Library/Application Support/posnic/app.log`
  - Linux `~/.config/posnic/app.log`
- For hardware issues: printer/scanner model and connection type

## Scope notes

- The **local edition must always work fully offline** — features that require
  internet access will not be accepted into the core.
- Cloud-side services (sync gateway, subscriptions) are proprietary and live in
  a private repository; the open app only ever talks to them through the
  documented sync agent interface.

## Questions

Open a [GitHub Discussion](https://github.com/Posnic/POS/discussions) or an
issue. For security problems, **do not open a public issue** — see
[SECURITY.md](SECURITY.md).
