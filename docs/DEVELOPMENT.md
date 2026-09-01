# Developer guide

Everything you need to get Posnic running, change it, and get the change
merged. If something here is wrong or missing, that is a bug — please open an
issue.

If you are making your first contribution, start with
[CONTRIBUTOR_QUICKSTART.md](CONTRIBUTOR_QUICKSTART.md). This guide is the deeper
reference after the first setup works.

## Getting it running

**You need:** Node 22.12 or later, Git, and about 3 GB of disk. You do **not**
need to install MongoDB; the app brings its own.

The floor is Electron's, not ours. Electron 43 declares `node >= 22.12.0`, and
its installer pulls `@electron/get`, which is ESM-only and cannot be required
from Node 20 at all — so on 20 the dependency install fails outright rather than
degrading. `.nvmrc` records the version; Node 24 works too and is what most of
the development happens on.

```bash
git clone https://github.com/Posnic/POS.git
cd POS
npm install
cd api && npm install && cd ..
npm start
```

On first run the app downloads and unpacks the bundled MongoDB, which takes a
few minutes. After that it starts in seconds.

If it does not start, check the log first — it is almost always in there:

| OS | Log |
|---|---|
| Windows | `%APPDATA%\posnic\app.log` |
| macOS | `~/Library/Application Support/posnic/app.log` |
| Linux | `~/.config/posnic/app.log` |

### Ports

Posnic derives its ports from the app name rather than using fixed ones, so two
brands can be installed side by side and neither collides with anything already
on the machine. Stock Posnic uses **47590** for MongoDB and **42590** for the
API. The choice is recorded in `.ports.json` in the user data directory.

To connect a database tool: `mongodb://127.0.0.1:47590`.

## Running the tests

```bash
cd api
npm test              # 7,744 unit tests, about a minute
npm run test:unit     # same, explicitly
npm run test:coverage # with a coverage report
```

Current coverage, measured on the API unit suite:

| | |
|---|---|
| Statements | 64.8% |
| Branches | 48.8% |
| Functions | 67.0% |
| Lines | 65.5% |

Branch coverage is the weak one. A test that exercises an untested branch is a
welcome contribution on its own, without any accompanying fix.

```bash
npm run test:auth     # from the repo root: desktop startup tests
npm test              # all desktop tests
```

**`npm test` should pass on a clean checkout.** It runs everything except the
suites listed in `api/jest.known-failures.js`, which is what CI and the release
gate run too — so if it fails, your change broke something.

Twelve suites are quarantined there, holding 19 failing tests. They are known
drift rather than anyone's fault, and they are tracked as good first issues.
They are excluded rather than deleted or silenced, and the list is meant to be
looked at:

```bash
cd api
npm test                    # the curated suite: what CI runs, and it is green
npm run test:known-failures # only the quarantined 12, and where they stand
npm run test:all            # everything, quarantine included - expect 19 red
npm run test:local          # the whole suite against a real local MongoDB
```

If your change takes the quarantine from 19 to 20, that one is yours.

### Functional tests

The Playwright suite lives in a separate repository,
[Posnic/Automation](https://github.com/Posnic/Automation) — 244 tests across 20
specs. It currently requires a hosted environment and is not yet runnable in
CI. Making it runnable against a disposable local stack is one of the most
useful contributions available right now.

## Linting and formatting

```bash
cd api
npm run lint          # report
npm run lint:fix      # fix what can be fixed automatically
npm run format        # prettier
```

**Lint gates CI.** Errors are at zero, so a new one fails the build on the pull
request that introduced it — which is the only moment it is cheap to fix.

Around 1,600 warnings remain, almost all `no-console`. Those do not fail
anything; the reasoning is written in `api/eslint.config.js`, next to the rules
themselves.

Do **not** run `npm run format` across the whole codebase in a pull request. A
diff of 400 reformatted files cannot be reviewed. Format what you touched.

## Making a change

### Where things live

Read [ARCHITECTURE.md](ARCHITECTURE.md) first. The short version:

```
routes/ → controllers/ → services/ → repositories/ → models/
```

A new endpoint usually means touching the route file, the controller, and
whichever service owns the behaviour. Controllers should not reach into models
directly; existing code that does is drift, not a pattern to copy.

### Naming

- Files are `thing.role.js` — `sale.repository.js`, `sales.controller.js`.
- **Singular** in `models/`, `repositories/`, `services/`.
- **Plural** in `controllers/`, `routes/`, `constants/`, `helpers/`, `middleware/`.

### What not to rename

**Do not rename a persisted field or a collection in an ordinary pull request.**

Field names cross the sync wire to desktop apps that are already installed and
cannot be force-updated. An old install will keep sending `branch_id` for as
long as it exists. Renaming these requires a versioned migration with dual-read
compatibility, and that work is planned separately.

The same applies to the legacy route aliases (`/setting`, `/stocklogs`,
`/customercategory`). They exist for installs of the older PHP application.
Leave them.

### Environment variables

If you read `process.env` for anything `main.js` sets at runtime — including
`POSNIC_MONGO_PORT`, `PORT` and `POSNIC_BRAND_DIR` — **read it inside a
function**. A `const` at module scope is evaluated when the file is first
required, which is before `main.js` has set anything, so it silently captures
the fallback. This has caused three separate production failures.

```js
// wrong — evaluated at require time
const MONGO_PORT = Number(process.env.POSNIC_MONGO_PORT) || 47017;

// right
function mongoPort() {
  return Number(process.env.POSNIC_MONGO_PORT) || 47017;
}
```

### Adding a top-level module

`build.files` in `package.json` is an **allowlist**. A new top-level file that
is required but not listed will work perfectly in development and produce
"Cannot find module" on a user's machine. `npm run check:modules` catches this,
and CI runs it.

## Submitting

1. Branch from `main`.
2. Make the change. Keep it focused — one concern per pull request.
3. Run the tests. `cd api && npm test`.
4. Sign your commits off (DCO):
   ```bash
   git commit -s -m "your message"
   ```
5. Open a pull request. Describe what changed and why, and how you tested it.

Commit messages: explain **why**, not what. The diff already says what.

### What gets a fast review

- A failing test that now passes.
- A bug report with reproduction steps, even without a fix.
- Small, focused changes.
- Documentation fixes — including to this file.

### What takes longer

- Large refactors with no accompanying issue discussion.
- Changes to sync, the build pipeline, or white-label behaviour. These have
  sharp edges and affect people who cannot update easily.
- New dependencies. Every one is weight in an installer that a shop downloads
  over a slow connection.

## What the version number decides

The number is not decoration. The updater reads it to choose whether a release
installs itself or waits to be asked, so getting it wrong changes what happens
on 17 shop counters.

| Change | Bump | What a shop sees |
|---|---|---|
| Our pages, API, styling, a bug fix | **patch** `1.0.x` | Downloads quietly, applied when the till is next closed |
| A new feature, still our own code | **minor** `1.x.0` | Same: quiet download, applied on next close |
| Electron, Node, a native module rebuild | **major** `x.0.0` | Waits on the Updates screen until the shop starts it |

**Reserve the major version for the platform.** Not for "this feels like a big
release" — for the cases where the thing the application runs on has changed.
Those carry a longer restart and a bigger download, and a shop should choose
when to take one rather than have it land mid-queue.

An unreadable version is treated as a core update, so a mistake asks rather
than installing on its own.

Practically: bumping `electron`, `@serialport/bindings-cpp`, or the bundled
MongoDB or Node is a major. Everything else almost certainly is not.

## Building an installer

```bash
npm run build          # Windows, x64
npm run build:linux
npm run build:mac
npm run build:fast     # unpacked, for quick local testing
```

Public releases are cut from a version tag and built for all three platforms by
CI:

```bash
git tag v1.4.0
git push origin v1.4.0
```

That produces a **draft** release with installers and `SHA256SUMS.txt`. A human
publishes it.

## Regenerating the API reference

```bash
cd api && npm run docs:api
```

`docs/API.md` is generated from the route table. Edit the routes, not the
document.

## Good first issues

- Fix one of the 19 failing unit tests. Each is self-contained.
- Fix a `no-undef` eslint error. These are real latent bugs.
- Split `sale.repository.js` (9,356 lines) or `sales.controller.js` (7,501)
  along an existing seam.
- Make the Playwright suite runnable against a local stack.
- Improve these docs.
