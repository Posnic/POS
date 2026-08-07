# Architecture

How Posnic is put together, and why. If you are about to change something and
want to know what else it touches, start here.

## The shape of it

Posnic is a point of sale that keeps working when the internet does not. That
one requirement explains most of the design decisions below: the database is
local, the API is local, and the network is treated as a bonus rather than a
dependency.

```
┌─────────────────────────────────────────────────────────┐
│  Electron desktop app (one process tree, one machine)   │
│                                                          │
│   main.js ──── starts ────┬── MongoDB   (bundled)        │
│   (Electron main)         ├── API       (in-process)     │
│                           └── sync-agent (optional)      │
│                                                          │
│   BrowserWindow ── HTTP ──► API ── driver ──► MongoDB    │
│   (frontend/)                                            │
└──────────────────────────┬──────────────────────────────┘
                           │  only when the shop pays for Cloud
                           ▼
                    sync-gateway (cloud)
                           │
                           ▼
              per-tenant MongoDB (posnic_t_<name>)
```

Everything above the dashed line runs with no network at all. A shop can
unplug the router and keep selling.

## The desktop app

### Processes

The API is **not** a separate process. `main.js` calls `startServer()`, which
`require`s `server.js` and invokes it, so the Express app runs inside the
Electron main process and shares its lifetime. Killing the window kills the
API, which is what you want on a till.

MongoDB *is* a separate process, launched and supervised by
`mongodb-manager.js`. It is bundled with the installer rather than expected on
the machine, because a shopkeeper should not have to install a database.

### Ports are derived, not fixed

`local-ports.js` hashes the application name to pick a MongoDB port in
47000–47899 and an API port in 42000–42899, then persists the choice in
`.ports.json` under the user data directory.

This exists because the defaults collided. Two brands installed side by side
would fight over one port, and 27017 is often already taken by something else
on the machine. Stock Posnic lands on 47590/42590; a build branded "Sridhar"
lands on 47114/42114, and the two coexist.

> Any module that reads `process.env.POSNIC_MONGO_PORT` must read it **inside a
> function**, not at module scope. `main.js` sets these variables at runtime,
> and a `const` evaluated at require time captures the fallback instead. This
> has caused three separate production failures.

### Layout

| Path | What it is |
|---|---|
| `main.js` | Electron main: windows, lifecycle, IPC, starting everything else |
| `server.js` | Boots the API in-process and fixes up module resolution paths |
| `api/` | The REST API — see below |
| `frontend/` | The user interface, built with gulp |
| `mongodb-manager.js` | Starts, stops and health-checks the bundled database |
| `sync-agent-manager.js` | Runs the cloud sync agent when the shop has Cloud |
| `backup-manager.js` | Local backups |
| `hardware-*.js`, `kot-manager.js` | Printers, scales, drawers, kitchen tickets |
| `local-ports.js` | Per-installation port derivation |
| `scripts/` | Build, packaging and white-label tooling |
| `brands/` | White-label brand definitions (`brand.json` plus logos) |

## The API

Express, CommonJS throughout, 478 endpoints across 24 route groups. The full
reference is [API.md](API.md), generated from the routes by `npm run docs:api`.

### Layers

```
routes/  →  controllers/  →  services/  →  repositories/  →  models/
  ↑            ↑                ↑               ↑              ↑
 paths      HTTP in/out     business rules   data access   mongoose schemas
         middleware/  validation, auth, rate limiting
```

The rule worth knowing: **controllers should not talk to models directly.**
Plenty of existing code does, and that is drift rather than design.

### Naming

Singular in `models/`, `repositories/` and `services/`; plural in
`controllers/`, `routes/`, `constants/`, `helpers/` and `middleware/`. So
`sale.model.js` and `sale.repository.js`, but `sales.controller.js` and
`sales.routes.js`. Files are `thing.role.js`.

Persisted field names are a mix of `snake_case` and `camelCase` — around 230
and 166 respectively, with eight models using both. This is known and is being
addressed as a separate versioned migration, because those names cross the sync
wire to desktop apps already installed in the field. **Do not rename a
persisted field in a normal pull request.**

### Legacy paths

Several route groups are mounted twice — `/settings` and `/setting`,
`/stock-logs` and `/stocklogs`, `/customer-category` and `/customercategory`.
The second in each pair exists so installs of the older PHP application keep
working. Use the primary path in new work; do not remove the aliases.

## Sync

Optional, paid, and deliberately not required for the app to function.

`Gateway/apps/sync-gateway` is the server; `apps/sync-agent` ships inside the
desktop app. Nineteen collections sync, each with a scope:

- **`branch`** — documents carry `branch_id`; a device provisioned for specific
  branches receives only those. Documents *without* `branch_id` are treated as
  shared and always sync.
- **`global`** — tenant-wide data every device needs: logins, branch list,
  settings, taxes, units.

The gateway's collection list must stay in agreement with the agent's
`sync-config.json`. They are two halves of one contract, and a device in the
field cannot be force-updated, so changing either one is a compatibility
question rather than a refactor.

Devices authenticate with a token stored as a SHA-256 hash, migrated from
plaintext on first use.

## White label

Posnic Cloud customers can ship the app under their own name. That is a
commercial service, and the pipeline that produces those installers is not part
of this repository - it lives in a private one, which checks this repository out
at a tag and applies a brand on top.

What is here is only the receiving end, and it is two hooks in `main.js`:

- `seedBrandFromBuild()` reads `resources/brand-seed/brand.json` if an installer
  carries one, and copies the name and artwork into the user's data directory.
  A stock build has no seed, so this returns immediately and the app is Posnic.
- `refreshBrand()` asks the gateway for the current brand when a shop has
  connected to Posnic Cloud, so branding can change without reinstalling.

Everything else - how a brand pack is assembled, what gets rewritten, how a
customer build is triggered and published - is in the build repository. Stock
public releases never go near it.

## The cloud side

Not required to run Posnic, and not part of the open-source desktop app.

| Service | Role |
|---|---|
| `web-api` | Signup, subscriptions, tenant provisioning, invoices |
| `Gateway` | Device sync |
| `Intranet` | Staff console: tenants, pricing, builds, support |
| `web-frontend` | Marketing site, checkout, customer account |

Each paying shop gets its own database, `posnic_t_<subdomain>`; a control
database named `Web` holds the tenant registry.

## Testing

| Layer | Where | Scale |
|---|---|---|
| Unit | `api/tests/unit` | 7,744 tests, 64.8% statements |
| Functional | [Posnic/Automation](https://github.com/Posnic/Automation) | 244 Playwright tests |
| Desktop | `tests/` | 11 tests, Node's built-in runner |
| Packaging | `scripts/check-packaged-modules.js` | asserts every require is shipped |

CI runs the unit, desktop and packaging checks on every push and pull request.
The Playwright suite needs a running application and is not yet wired in; see
[DEVELOPMENT.md](DEVELOPMENT.md).

## Things that will bite you

- **Module-scope `process.env` reads.** Covered above. Three outages.
- **`path.sep` inside a glob.** Produces different layouts on Windows and Linux;
  the CI build shipped a directory tree the app was not wired for.
- **`build.files` in `package.json` is an allowlist.** A new top-level module
  that is required but not listed produces "Cannot find module" on a user's
  machine and nowhere else. `check-packaged-modules.js` now catches this.
- **Cache fingerprints must cover the recipe.** The API runtime archive is
  cached against a hash; when that hash covered only dependency manifests, a
  change to the compression settings never took effect.
