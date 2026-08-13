<div align="center">

<img src="512-posnic.png" alt="Posnic" width="120">

# Posnic

**Point of sale that never goes down.**

A complete, offline-first POS for shops, restaurants and pharmacies.
Your data lives on your own computer. No internet required, ever.

[![CI](https://github.com/Posnic/POS/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Posnic/POS/actions/workflows/ci.yml)
[![Release](https://github.com/Posnic/POS/actions/workflows/release.yml/badge.svg)](https://github.com/Posnic/POS/actions/workflows/release.yml)
[![Downloads](https://img.shields.io/github/downloads/Posnic/POS/total?label=downloads&color=brightgreen)](https://github.com/Posnic/POS/releases)
[![Latest release](https://img.shields.io/github/v/release/Posnic/POS?include_prereleases&label=latest&color=blue)](https://github.com/Posnic/POS/releases/latest)
[![Tests](https://img.shields.io/badge/tests-8%2C000%2B%20passing-brightgreen)](docs/DEVELOPMENT.md#running-the-tests)
[![Coverage](https://img.shields.io/badge/coverage-62%25%20statements-yellow)](docs/DEVELOPMENT.md#running-the-tests)
[![API](https://img.shields.io/badge/REST%20API-484%20endpoints-blue)](docs/API.md)
[![Licence](https://img.shields.io/badge/licence-AGPL--3.0-blue)](LICENSE)
[![Platforms](https://img.shields.io/badge/platforms-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](https://github.com/Posnic/POS/releases/latest)

### [⬇ Download for Windows](https://github.com/Posnic/POS/releases/latest) · [macOS](https://github.com/Posnic/POS/releases/latest) · [Linux](https://github.com/Posnic/POS/releases/latest)

[User guide](docs/USER_GUIDE.md) · [Developer guide](docs/DEVELOPMENT.md) · [Architecture](docs/ARCHITECTURE.md) · [API](docs/API.md) · [Discussions](https://github.com/Posnic/POS/discussions)

</div>

---

## Why Posnic

Most point-of-sale software stops working when the internet does. Posnic runs
its database and its API on the till itself, so a dropped connection is not an
outage — it is nothing at all. A shop can unplug the router and keep selling.

- **Free forever, and complete.** Not a trial, not a crippled edition. A shop
  can run its entire business on it without paying anyone.
- **Your data stays yours.** It is on your machine. No account, no signup, no
  telemetry. See [PRIVACY.md](PRIVACY.md).
- **Open source under AGPL-3.0-only.** Read it, change it, self-host it, fork it.

## Features

| | |
|---|---|
| **Selling** | Fast keyboard and touch billing, barcode scanning, returns, part payments, held bills, quick sale |
| **Stock** | Items, variants, categories, purchases, supplier returns, inventory logs, low-stock alerts |
| **Customers** | Customer accounts, categories with their own pricing, outstanding balances |
| **Tax** | GST invoices, IGST and CGST/SGST, HSN codes, GST reports for filing |
| **Restaurants** | Kitchen order tickets, table management, kiosk and customer displays |
| **Hardware** | Thermal printers, barcode scanners, cash drawers, weighing scales, second displays |
| **Reports** | Sales, purchases, inventory, expenses, profit, staff activity — all exportable |
| **Branches** | Multiple outlets, per-branch stock, staff roles and permissions |

## Install

Download the installer for your platform from
**[the latest release](https://github.com/Posnic/POS/releases/latest)**, run it,
and follow the wizard. Nothing else to install — the database ships inside.

Verify your download against `SHA256SUMS.txt` in the release.

> **Windows** may warn that the publisher is unrecognised: *More info* → *Run
> anyway*. **macOS**: *System Settings → Privacy & Security → Open Anyway*.
> **Linux**: make the `.AppImage` executable, or install the `.deb`.

First launch takes a few minutes while it sets up its database. After that,
seconds. Full walkthrough in the **[user guide](docs/USER_GUIDE.md)**.

## Build from source

```bash
git clone https://github.com/Posnic/POS.git
cd POS
npm install
npm --prefix api install
npm start
```

Needs Node 22.12+. You do **not** need to install MongoDB — Posnic brings its own
and picks a port derived from the app name so it never collides with a database
you already run.

```bash
npm run build          # Windows installer
npm run build:mac
npm run build:linux
```

See the **[developer guide](docs/DEVELOPMENT.md)** for tests, linting and
conventions.

## Editions

The desktop application is free and open source. **Posnic Cloud** is a paid
service for shops that want more than one till.

| | Posnic (this repo) | Posnic Cloud |
|---|---|---|
| Full POS, offline, unlimited items and sales | ✅ | ✅ |
| Local database and backups | ✅ | ✅ |
| Hardware: printers, scanners, drawers, scales | ✅ | ✅ |
| GST invoicing and reports | ✅ | ✅ |
| Sync across tills and branches | | ✅ |
| Off-site backups, remote dashboard | | ✅ |
| Installer under your own brand | | ✅ |

**We do not move features from the left column to the right.** What is free
today stays free. Cloud has to earn its price by being useful, not by making
the free edition worse. This is written down in [GOVERNANCE.md](GOVERNANCE.md).

## Documentation

| | |
|---|---|
| [User guide](docs/USER_GUIDE.md) | Running a shop with Posnic, first sale to closing the till |
| [Developer guide](docs/DEVELOPMENT.md) | Setup, tests, conventions, good first issues |
| [Architecture](docs/ARCHITECTURE.md) | How it fits together, and the parts that bite |
| [REST API](docs/API.md) | 484 endpoints, generated from the routes |
| [Hardware](docs/HARDWARE_MATRIX.md) | Printers, scanners, drawers, scales — and how far each claim is checked |
| [Backups](docs/BACKUP_POLICY.md) | What is backed up, when, and what it does not protect you from |
| [Disaster recovery](docs/DISASTER_RECOVERY.md) | Getting back to working, with RPO and RTO as numbers |
| [Release runbook](docs/RELEASE_RUNBOOK.md) | How a release goes out, and four ways to take one back |
| [Support lifecycle](docs/SUPPORT_LIFECYCLE.md) | Which versions get fixes, and for how long |
| [Incident response](docs/INCIDENT_RESPONSE.md) | Who decides, who is told, and when |
| [Terms of use](TERMS_OF_USE.md) | Customer terms for Posnic Cloud |
| [Subprocessors](docs/SUBPROCESSORS.md) | Who else can touch your data. For the local edition: nobody |
| [Cloud operations](docs/CLOUD_OPERATIONS.md) | What the paid service is made of, and what is still to be decided |
| [Data processing addendum](docs/DATA_PROCESSING_ADDENDUM.md) | For customers who need a written DPA |
| [Contributing](CONTRIBUTING.md) | How to get a change merged |
| [Support](SUPPORT.md) | Where to ask, and what happens to your issue |
| [Governance](GOVERNANCE.md) | Who decides what, and what we have promised |
| [Privacy](PRIVACY.md) | What the app collects, and what it does not |
| [Security](SECURITY.md) | What Posnic protects, what it cannot, and reporting a vulnerability |
| [Third-party notices](THIRD-PARTY-NOTICES.md) | Other people's software that ships inside the installer |
| [Code of conduct](CODE_OF_CONDUCT.md) | How we treat each other |

## Contributing

Bug reports, fixes, translations, hardware quirks from real shops, documentation
— all welcome, and none of it requires permission to start.

Good places to begin are listed in the
[developer guide](docs/DEVELOPMENT.md#good-first-issues): 19 known-failing tests,
21 real latent bugs the linter found, and two very large files that want
splitting.

Read [CONTRIBUTING.md](CONTRIBUTING.md) first. Security issues go to
[SECURITY.md](SECURITY.md), privately — never a public issue.

## Buy the team a chai ☕

Posnic is built by a small team in Tamil Nadu, India, and given away because a
shop should not have to rent its own till. If it saves you money, sending a
little back is what keeps the next release coming.

| | |
|---|---|
| ☕ **[Buy us a chai](https://github.com/sponsors/Posnic)** | one-off or monthly, from a dollar up |
| ☁️ **[Posnic Cloud](https://posnic.com/pricing.html)** | sync, off-site backups, remote dashboards — the paid service that funds this one |
| 🏢 **Commercial licence** | keep your modifications private — **info@posnic.com** |

Sponsors are named in releases unless they would rather not be.

### For businesses

**Posnic Innovations**, Tamil Nadu, India.

| | |
|---|---|
| Sales and licensing | **info@posnic.com** |
| Support | [SUPPORT.md](SUPPORT.md) · [Discussions](https://github.com/Posnic/POS/discussions) |
| Security | **security@posnic.com** — privately, never a public issue ([SECURITY.md](SECURITY.md)) |
| Web | [posnic.com](https://posnic.com) |

Paid setup, migration from an existing till, hardware selection, custom
reporting and white-labelled installers are all available. The software stays
free either way — see [GOVERNANCE.md](GOVERNANCE.md) for what we have promised
never to move behind a paywall.

## Licence

[GNU AGPL-3.0-only](LICENSE). Use it, change it, self-host it, including for clients.
If you run a modified version as a hosted service, the AGPL requires you to
publish your modifications.

The **Posnic name and logo are trademarks** and are not covered by the AGPL —
see [GOVERNANCE.md § Trademark](GOVERNANCE.md#trademark-and-reserved-rights).

Companies needing to keep modifications private can buy a commercial licence:
**info@posnic.com**. Such a licence covers the code Posnic owns. Contributors
keep the copyright in what they write and there is no CLA, so community code can
only be relicensed with its author's agreement — a deliberate limit on our own
power, set out in [GOVERNANCE.md § Contributor
copyright](GOVERNANCE.md#contributor-copyright).
