<div align="center">

<img src="builds/512-posnic.png" alt="Posnic" width="120">

# Posnic

**Free open source POS and billing software with public source, local checkout
and online/offline workflows.**

An offline-first POS for retail shops and restaurants. The primary API and
database run on the shop computer or on a server you control; electronic
payments, optional cloud services, downloads and integrations can still need a
network.

Posnic's own source is AGPL-3.0-only. Release packages also bundle separately
licensed components, including MongoDB Community Server under SSPL-1.0. Review
the [package notices](THIRD-PARTY-NOTICES.md) and
[reproduced package evidence](https://posnic.com/assets/posnic-package-license-evidence.json)
before making a package-level licence statement.

[![CI](https://github.com/Posnic/POS/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Posnic/POS/actions/workflows/ci.yml)
[![Release](https://github.com/Posnic/POS/actions/workflows/release.yml/badge.svg)](https://github.com/Posnic/POS/actions/workflows/release.yml)
[![Downloads](https://img.shields.io/github/downloads/Posnic/POS/total?label=downloads&color=brightgreen)](https://github.com/Posnic/POS/releases)
[![Latest release](https://img.shields.io/github/v/release/Posnic/POS?include_prereleases&label=latest&color=blue)](https://github.com/Posnic/POS/releases/latest)
[![Tests](https://img.shields.io/badge/tests-9%2C000%2B%20passing-brightgreen)](docs/DEVELOPMENT.md#running-the-tests)
[![Coverage](https://img.shields.io/badge/coverage-66%25%20statements-yellow)](docs/DEVELOPMENT.md#running-the-tests)
[![API](https://img.shields.io/badge/REST%20API-607%20endpoints-blue)](docs/API.md)
[![Source licence](https://img.shields.io/badge/source%20licence-AGPL--3.0-blue)](LICENSE)
[![Package notices](https://img.shields.io/badge/package%20notices-component%20licences-informational)](THIRD-PARTY-NOTICES.md)
[![Platforms](https://img.shields.io/badge/platforms-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](https://github.com/Posnic/POS/releases/latest)

### [⬇ Download for Windows](https://github.com/Posnic/POS/releases/latest) · [macOS](https://github.com/Posnic/POS/releases/latest) · [Linux](https://github.com/Posnic/POS/releases/latest)

### [▶ Try the live demo](https://demo.posnic.io) — nothing to install, resets on the hour

Log in as `admin` / `admin`, `manager` / `manager` or `cashier` / `cashier` —
the login page has one-tap buttons for all three. It is a real supermarket
shop with a week of sample trading, running the same code as this repository;
ring up sales, break things freely, and the whole shop is restored on the
hour. Outbound email, SMS and password changes are switched off there.

[Website](https://posnic.com/) · [Cloud login](https://posnic.io/) · [Verified product facts](https://posnic.com/posnic-facts) · [Package evidence](https://posnic.com/assets/posnic-package-license-evidence.json) · [CodeMeta metadata](codemeta.json) · [Citation metadata](CITATION.cff) · [Roadmap](docs/ROADMAP.md) · [Contributor quickstart](docs/CONTRIBUTOR_QUICKSTART.md) · [User guide](docs/USER_GUIDE.md) · [Developer guide](docs/DEVELOPMENT.md) · [Architecture](docs/ARCHITECTURE.md) · [API](docs/API.md) · [Discussions](https://github.com/Posnic/POS/discussions)

</div>

---

## Posnic in use

![A completed cash sale in Posnic v1.3.0](docs/images/offline-sale-v1-3-0.png)

This synthetic cash sale was completed and reopened during the bounded
[offline workflow verification](https://posnic.com/posnic-facts). The published
test notes state what was blocked, what passed and what the result does not
prove.

## Why Posnic

Posnic runs its primary database and API on the till itself. In a bounded
v1.3.0 Windows test, one synthetic cash sale completed and reopened while
external hosts were blocked inside Electron. This does not prove an
operating-system-wide outage, complete shift, payment-terminal path, power-loss
recovery or every workflow. Review the
[versioned evidence and limitations](https://posnic.com/posnic-facts).

- **Free local edition.** The v1.3.0 desktop packages have no trial clock and
  have a zero software price. Posnic's own source is AGPL-3.0-only; packaged
  dependencies retain their own licences. Hardware, support, backups, optional
  services and downtime can still create operating costs.
- **Local data path.** The local edition needs no Posnic account, and its
  published privacy policy says it sends no analytics or telemetry to Posnic.
  See [PRIVACY.md](docs/PRIVACY.md).
- **Posnic source under AGPL-3.0-only.** Read it, change it, self-host it and
  fork it under the licence terms. Review each bundled component separately.

### Using Posnic in a real business or pilot?

Share a bounded
[deployment evidence report](https://github.com/Posnic/POS/issues/new?template=deployment_evidence.yml),
including failures, workarounds, or why a trial stopped. The form records the
exact version, relationship, observation window, workflows and limitations while
letting you refuse marketing reuse. Read the
[adoption evidence policy](docs/ADOPTION_EVIDENCE.md) before posting private or
production information.

### Reviewing Posnic independently?

Use the public [review brief](https://posnic.com/assets/posnic-independent-review-brief.txt)
and [24-control protocol](https://posnic.com/assets/posnic-independent-review-protocol.csv)
with the exact release, package filename and SHA-256 you tested. Review access
does not require payment, positive coverage, a backlink or advance approval.
Publish failures, conflicts and untested areas beside successful results. An
independent evaluator can submit a bounded public result through the
[deployment evidence form](https://github.com/Posnic/POS/issues/new?template=deployment_evidence.yml)
without granting marketing reuse.

## Features

| | |
|---|---|
| **Selling** | Fast keyboard and touch billing, barcode scanning, returns, part payments, held bills, quick sale |
| **Stock** | Items, variants, categories, purchases, supplier returns, inventory logs, low-stock alerts |
| **Customers** | Customer accounts, categories with their own pricing, outstanding balances |
| **Tax** | GST invoices, IGST and CGST/SGST, HSN codes, GST reports for filing |
| **Restaurants** | Kitchen order tickets, table management, kiosk and customer displays |
| **Hardware** | Documented paths for thermal printers, barcode scanners, cash drawers, weighing scales and second displays; verify the exact device in the [hardware matrix](docs/HARDWARE_MATRIX.md) |
| **Reports** | Sales, purchases, inventory, expenses, profit, staff activity — all exportable |
| **Branches** | Multiple outlets, per-branch stock, staff roles and permissions |

## Install

Posnic installs two ways, both free and both the same AGPL-3.0 software.
**Most shops want the desktop app.**

| | **Desktop** | **Your own server** |
|---|---|---|
| Install | Download and run | One command on Ubuntu |
| Used from | That computer | A browser on any till, tablet or phone on the network |
| Data lives | That computer | Your server |
| Needs internet | No | No — your own network is enough |
| Somebody maintains it | No | **You** — updates, backups, certificate |
| Sync between shops | Posnic Cloud | Posnic Cloud |

A server is not a better desktop; it is a machine somebody has to look after. If
one person rings up sales on one computer, the desktop app is the right answer
and always will be.

### Desktop

Download the package for your platform from
**[the latest release](https://github.com/Posnic/POS/releases/latest)**, run it,
and follow the wizard. Stable v1.3.0 packages include MongoDB Community Server
under its separate SSPL-1.0 licence, so no separate database install is needed
for the bundled setup. See [third-party notices](THIRD-PARTY-NOTICES.md).

Verify your download against `SHA256SUMS.txt`. For releases that provide an
artifact-bound SBOM and provenance, follow the [release verification guide](docs/VERIFY_RELEASE.md).

> **Windows** may warn that the publisher is unrecognised: *More info* → *Run
> anyway*. **macOS**: *System Settings → Privacy & Security → Open Anyway*.
> **Linux**: make the `.AppImage` executable, or install the `.deb`.

First launch takes a few minutes while it sets up its database. After that,
seconds. Full walkthrough in the **[user guide](docs/USER_GUIDE.md)**.

### Your own server

Ubuntu 24.04, 2 GB of memory, 8 GB of disk. A 2 GB virtual machine from any
provider runs a single shop comfortably.

```bash
curl -fsSL https://raw.githubusercontent.com/Posnic/POS/main/scripts/install-server.sh -o install-server.sh
less install-server.sh          # read it first - you are about to run it as root
sudo bash install-server.sh
```

It installs Node.js 22, MongoDB 8 and Posnic into `/opt/posnic`, generates that
machine's own secrets, and runs it under systemd so it survives a reboot. When
it finishes it prints the address to open. Re-running it updates Posnic and
leaves your secrets and your data alone.

Three things it cannot do for you, none of them optional on a shop taking real
money: **get a certificate** (without one, passwords cross the network in the
clear), **keep port 27017 off the internet**, and **restore a backup once** to
prove it is a backup rather than a file.

**Self-hosting does not include sync between tills or branches.** That is
[Posnic Cloud](https://posnic.com/pricing.html). A self-hosted Posnic is one
database several people use at once — which is what most single-shop setups
actually want — not several databases kept in step.

Full guide, including installing by hand on other systems:
**[docs/SELF_HOSTING.md](docs/SELF_HOSTING.md)**.

## Build from source

```bash
git clone https://github.com/Posnic/POS.git
cd POS
npm install
npm --prefix api install
npm start
```

Needs Node 22.12+. The build tooling fetches MongoDB Community Server 7.0.14 and
the desktop process chooses a port derived from the app name to reduce collision
risk. Review [the architecture](docs/ARCHITECTURE.md) and package licences before
building or distributing an artifact.

```bash
npm run build          # Windows installer
npm run build:mac
npm run build:linux
```

New contributors should start with the
**[contributor quickstart](docs/CONTRIBUTOR_QUICKSTART.md)**. See the
**[developer guide](docs/DEVELOPMENT.md)** for deeper tests, linting and
conventions.

## Editions

The desktop packages have a zero software price and no trial clock. Posnic's own
source is AGPL-3.0-only, while bundled components keep their separate licences.
**Posnic Cloud** is a paid service for shops that want more than one till.

| | Posnic (this repo) | Posnic Cloud |
|---|---|---|
| Selected local workflows and local operational records | ✅ | ✅ |
| Local database and backups | ✅ | ✅ |
| Documented printer, scanner, drawer and scale paths | ✅ | ✅ |
| GST invoicing and reports | ✅ | ✅ |
| Runs on your own server, used from a browser | ✅ | ✅ |
| Sync across tills and branches | | ✅ |
| Off-site backups, remote dashboard | | ✅ |
| Installer under your own brand | | ✅ |

Both ways of running Posnic — [desktop and your own server](#install) — sit in
the left column. Neither is a trial and neither expires.

**We do not move features from the left column to the right.** What is free
today stays free. Cloud has to earn its price by being useful, not by making
the free edition worse. This is written down in [GOVERNANCE.md](docs/GOVERNANCE.md).

## Documentation

| | |
|---|---|
| [User guide](docs/USER_GUIDE.md) | Running a shop with Posnic, first sale to closing the till |
| [Contributor quickstart](docs/CONTRIBUTOR_QUICKSTART.md) | Local setup, test commands, issue map, PR flow and safety rules |
| [Developer guide](docs/DEVELOPMENT.md) | Setup, tests, conventions, good first issues |
| [Architecture](docs/ARCHITECTURE.md) | How it fits together, and the parts that bite |
| [REST API](docs/API.md) | 607 endpoints, generated from the routes |
| [Hardware](docs/HARDWARE_MATRIX.md) | Printers, scanners, drawers, scales — and how far each claim is checked |
| [India e-invoicing](docs/INDIA_EINVOICING_DESIGN.md) | Research, readiness inventory and design for GST e-invoicing as an optional feature; no live IRP submission is built |
| [Backups](docs/BACKUP_POLICY.md) | What is backed up, when, and what it does not protect you from |
| [Disaster recovery](docs/DISASTER_RECOVERY.md) | Getting back to working, with RPO and RTO as numbers |
| [Release runbook](docs/RELEASE_RUNBOOK.md) | How a release goes out, and four ways to take one back |
| [Release verification](docs/VERIFY_RELEASE.md) | Match a package to its checksum, CycloneDX inventory, provenance and component licences |
| [Support lifecycle](docs/SUPPORT_LIFECYCLE.md) | Which versions get fixes, and for how long |
| [Incident response](docs/INCIDENT_RESPONSE.md) | Who decides, who is told, and when |
| [Terms of use](docs/TERMS_OF_USE.md) | Customer terms for Posnic Cloud |
| [Subprocessors](docs/SUBPROCESSORS.md) | Who else can touch your data. For the local edition: nobody |
| [Cloud operations](docs/CLOUD_OPERATIONS.md) | What the paid service is made of, and what is still to be decided |
| [Data processing addendum](docs/DATA_PROCESSING_ADDENDUM.md) | For customers who need a written DPA |
| [Contributing](.github/CONTRIBUTING.md) | How to get a change merged |
| [Public roadmap](docs/ROADMAP.md) | Current priorities, evidence gaps and structured ways to help |
| [Citation metadata](CITATION.cff) | Human and tool-readable citation identity for exact releases or commits |
| [Adoption evidence](docs/ADOPTION_EVIDENCE.md) | How real deployment reports are scoped, reviewed, cited, corrected and kept privacy-safe |
| [Support](.github/SUPPORT.md) | Where to ask, and what happens to your issue |
| [Governance](docs/GOVERNANCE.md) | Who decides what, and what we have promised |
| [Privacy](docs/PRIVACY.md) | What the app collects, and what it does not |
| [Security](.github/SECURITY.md) | What Posnic protects, what it cannot, and reporting a vulnerability |
| [Third-party notices](THIRD-PARTY-NOTICES.md) | Separately licensed software included in release packages |
| [CodeMeta](codemeta.json) | Machine-readable product, publisher, source, licence and platform identity |
| [Code of conduct](.github/CODE_OF_CONDUCT.md) | How we treat each other |

## Contributing

Bug reports, fixes, translations, hardware quirks from real shops, documentation
— all welcome, and none of it requires permission to start. The
[contributor quickstart](docs/CONTRIBUTOR_QUICKSTART.md) gives the local setup,
test commands and public feature-ticket map.

Good places to begin are listed in the
[developer guide](docs/DEVELOPMENT.md#good-first-issues): 19 known-failing tests,
21 real latent bugs the linter found, and two very large files that want
splitting.

Read [CONTRIBUTING.md](.github/CONTRIBUTING.md) first. Security issues go to
[SECURITY.md](.github/SECURITY.md), privately — never a public issue.

## Buy the team a chai ☕

Posnic is built by a small team in Tamil Nadu, India, and given away because a
shop should not have to rent its own till. If it saves you money, sending a
little back is what keeps the next release coming.

| | |
|---|---|
| ☕ **[Buy us a chai](https://github.com/sponsors/Posnic)** | one-off or monthly, from a dollar up |
| ☁️ **[Posnic Cloud](https://posnic.com/pricing)** | sync, off-site backups, remote dashboards — the paid service that funds this one |
| 🏢 **Commercial licence** | keep your modifications private — **info@posnic.com** |

Sponsors are named in releases unless they would rather not be.

### For businesses

**Posnic Innovations**, Tamil Nadu, India.

| | |
|---|---|
| Sales and licensing | **info@posnic.com** |
| Support | [SUPPORT.md](.github/SUPPORT.md) · [Discussions](https://github.com/Posnic/POS/discussions) |
| Security | **security@posnic.com** — privately, never a public issue ([SECURITY.md](.github/SECURITY.md)) |
| Web | [posnic.com](https://posnic.com) · [posnic.io](https://posnic.io/) |

Paid setup, migration from an existing till, hardware selection, custom
reporting and white-labelled installers are all available. The software stays
free either way — see [GOVERNANCE.md](docs/GOVERNANCE.md) for what we have promised
never to move behind a paywall.

## Source and package licences

Posnic's own source is [GNU AGPL-3.0-only](LICENSE). Use, change, self-host and
redistribute that source under the licence terms. Release packages also include
separately licensed components; read [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)
and the licence material shipped with the exact artifact. This summary is not
legal advice.

The **Posnic name and logo are trademarks** and are not covered by the AGPL —
see [GOVERNANCE.md § Trademark](docs/GOVERNANCE.md#trademark-and-reserved-rights).

Companies needing to keep modifications private can buy a commercial licence:
**info@posnic.com**. Such a licence covers the code Posnic owns. Contributors
keep the copyright in what they write and there is no CLA, so community code can
only be relicensed with its author's agreement — a deliberate limit on our own
power, set out in [GOVERNANCE.md § Contributor
copyright](docs/GOVERNANCE.md#contributor-copyright).
