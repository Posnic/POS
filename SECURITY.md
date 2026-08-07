# Security Policy

Posnic handles business-critical sales data. We take security reports
seriously and appreciate responsible disclosure.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Email **security@posnic.com** with:

- A description of the issue and its impact
- Steps to reproduce (proof of concept if possible)
- The Posnic version affected

We aim to acknowledge reports within 72 hours and to ship fixes for confirmed
vulnerabilities in the next release. We'll credit you in the release notes
unless you prefer otherwise.

## The security model, stated plainly

Posnic runs a database on a shop's own computer and must start selling after a
power cut with nobody present. That single requirement decides most of what
follows, so it is worth being explicit rather than leaving people to discover it.

**What is protected**

| | |
|---|---|
| The network | MongoDB binds to `127.0.0.1`. Nothing on the LAN or the internet can reach it. |
| Other Windows accounts | The database requires a password, generated per install and stored in the shop's own user profile. No shared secret between shops. |
| A stolen or resold disk | With device encryption enabled — see the [user guide](docs/USER_GUIDE.md#keeping-your-till-secure). Without it, the disk is readable. |
| The till while unattended | PIN lock, and close-to-tray locks the screen. |

**What is not protected, and cannot be**

*Anyone with administrator rights on that machine.* An administrator can stop
the database and start it again with authentication disabled, or read the data
files directly. No application can prevent this, and one that claimed to would
be lying.

*Malware running as the user the till runs as.* It can read the same files the
application reads. Encrypting credentials raises the effort — it stops casual
reading and generic credential stealers — but anything written specifically to
attack Posnic will get there, and once this repository is public, how to do so
is public too.

**Why it cannot be fixed by hiding things better**

A machine that must boot and take payments with nobody present has to be able to
reach its own credentials unaided. Any secret it can obtain alone can be
obtained by someone who controls it. The alternative — requiring a human to
enter something before the till can sell — trades an outage every morning for a
threat that physical control of the machine already defeats.

We would rather write this down than imply protection that is not there. If you
are assessing Posnic for a business where the till is not physically controlled,
these are the properties to weigh.

**What to do about it**

Run the till on a standard, non-administrator Windows account, keep a separate
administrator account with a real password, and turn on device encryption.
Those three steps do more than anything in this codebase can. The
[user guide](docs/USER_GUIDE.md#keeping-your-till-secure) walks through them.

## Scope

- This repository (desktop app, API, web UI)
- The Posnic Cloud service (please report cloud issues to the same address)

## Out of scope

- Issues requiring OS administrator rights or physical access to the shop
  machine. Not because they do not matter, but because they are outside what any
  application on that machine can defend — see the security model above.
- Reading the local credential file, or the MongoDB data files, as the same
  Windows user the till runs as. Same reason.
- Vulnerabilities in third-party dependencies without a demonstrated Posnic
  impact (but do tell us so we can update)

Everything else is in scope, including anything reachable over the network, by a
different Windows user, from a renderer page, or through the update and backup
paths.

## Review schedule

Security work that happens on a calendar rather than only when something
prompts it. If a row falls overdue, that is recorded in the readiness report
rather than left quiet.

| What | How often |
|---|---|
| Dependency advisories, production | Every CI run — `scripts/check-advisories.js` gates it |
| Dependency advisories, development | Monthly review; Dependabot raises them continuously |
| Accepted-advisory exceptions re-checked | On their recorded review date, enforced by the same script |
| Secret scan of the full git history | Every CI run — `scripts/scan-git-history.js` |
| Electron and Node major versions | Quarterly, and within 30 days of a security release |
| Review of IPC surface, permissions and navigation guards | Every release that adds an IPC channel |
| Backup restore drill on a clean machine | Every release — see [docs/DISASTER_RECOVERY.md](docs/DISASTER_RECOVERY.md) |
| Incident response walk-through | Annually — see [docs/INCIDENT_RESPONSE.md](docs/INCIDENT_RESPONSE.md) |
| Third-party licence and notice review | Annually, and whenever a bundled asset changes |

An independent security audit has **not** been commissioned. When one is, the
result will be published here whatever it says.
