# Governance

How decisions get made, who makes them, and how that changes as more people
show up. This document is deliberately honest about the current state rather
than describing a community that does not exist yet.

## Where the project is today

Posnic is maintained by Posnic Innovations Private Limited. Right now there is
effectively one maintainer. Pretending otherwise would waste your time, so:
**decisions are currently made by the maintainer**, in the open, on issues and
pull requests.

The point of writing this down is that it should stop being true. The sections
below describe how that transition happens and what earns a say.

## Open core, stated plainly

The desktop application is free software under **AGPL-3.0-only**. It is complete. It
is not a demo, a trial, or a crippled edition — a shop can run its entire
business on it, forever, without paying anyone.

**Posnic Cloud** is a paid service: device sync, backups, remote dashboards,
white-label builds. It is a separate product and lives in separate,
closed repositories.

The line between them:

| | Open source (AGPL-3.0-only) | Paid service |
|---|---|---|
| Desktop app, API, UI | ✅ this repository | |
| Local database, offline operation | ✅ | |
| Hardware: printers, scales, drawers | ✅ | |
| Multi-device sync | | Cloud |
| Cloud backups, remote dashboard | | Cloud |
| White-label builds | | Cloud |

We will not move a feature from the left column to the right. If something is
free today it stays free. The commercial argument for Cloud has to be that it
is genuinely useful, not that the free version was made worse.

## Will it stay free?

The question everyone sensibly asks of an open-core project, answered directly.

**Yes, and here is what that means concretely.**

The desktop application is licensed under AGPL-3.0-only. That licence cannot be
revoked for code already released: every version published stays free software
for ever, and anyone may fork it. Even if this company disappeared tomorrow, the
software you are running does not.

What we additionally promise, which the licence alone does not:

- **No feature moves from free to paid.** If it works today without paying, it
  works tomorrow without paying.
- **No user, item, sale or branch limits** are added to the free edition.
- **No account required** to install or run it.
- **No advertising, and no telemetry** about your business.

**What is genuinely paid**, and always has been: Posnic Cloud — syncing several
tills, off-site backups, remote dashboards, and installers under your own brand.
Those need servers we pay for every month, so they cost money. That is the whole
model: the software is free, the service is not.

**What we will not do** is the bait-and-switch this industry is known for —
releasing something free, waiting for people to depend on it, then adding a seat
limit. If that ever appeared in a pull request it would contradict this
document, and this document is public and versioned.

If a future change to the licence is ever proposed, it happens as a public issue
with reasons, not in a release note.

## Trademark and reserved rights

The code is AGPL-3.0-only. The **name and the logo are not** — they are trademarks of
Posnic Innovations Private Limited, and trademarks are how people know whether
what they installed came from us.

**You may**, without asking:

- Use, modify, self-host and redistribute the software under the AGPL
- Run it for clients, including commercially
- Fork it and publish your fork
- Say your product is *"based on Posnic"* or *"a fork of Posnic"*

**You may not**, without written permission:

- Call your modified version "Posnic", or a name close enough to be confused
  with it
- Use the Posnic logo as the icon of a product you distribute
- Present a fork as official, endorsed by us, or as *"Posnic"* unqualified
- Use the name in a domain or app-store listing for a competing product

This is the ordinary open-source arrangement — Firefox, WordPress and Ansible
all work this way. Change what you like; do not confuse people about who wrote
it.

**White-label builds** are the sanctioned way to ship Posnic under your own
name: a paid Cloud feature that rebrands the app end to end and is licensed for
exactly that.

### What Posnic Innovations reserves

- The **trademarks**: the Posnic name, logo and product names
- The right to offer the software under a **commercial licence** to companies
  that cannot comply with the AGPL, since we hold the copyright
- The **release signing keys** and the official distribution channels
- Final say on the **licence** and on what stays free — recorded here, in public

### What Posnic Innovations does not reserve

- Any claim over your data. It is on your machine.
- Any claim over your fork or your modifications, beyond the AGPL's own terms.
- Any ability to switch off software you have already installed. There is no
  licence server and no kill switch in the free edition.

### Contributor copyright

**You keep the copyright in what you write.** There is no copyright assignment
and no CLA. By signing off under the
[DCO](https://developercertificate.org/) you confirm you have the right to
submit it under AGPL-3.0-only, and nothing more.

One consequence worth stating plainly: because contributors keep their
copyright, we cannot relicense contributed code without asking those
contributors. That is a deliberate limit on our own power, and it is a promise
to you.

## Roles

**Contributor** — anyone who opens an issue or a pull request. No commitment
expected, no process to join.

**Reviewer** — a contributor with a track record who is asked to review in an
area they know. Reviewers do not need commit access to be useful; a careful
review is worth more than a merge button.

**Maintainer** — commit access, can merge, can cut a release. Maintainers are
invited after sustained, good-quality involvement — roughly a handful of merged
pull requests plus visible judgement in review. There is no application form
and no fixed number.

**Steward** — currently Posnic Innovations. Holds the trademark, the release
signing keys, and final say on the licence and on what stays free.

## How decisions are made

Most things need no process. Open a pull request; if it is sound, it is merged.

Anything that changes behaviour people depend on gets an **issue first**, so
disagreement happens before someone has spent a weekend on it:

- Changes to sync, or to any persisted field or collection name
- New dependencies
- Anything affecting the white-label pipeline
- Changes to release or packaging
- Removing anything

Discussion happens in the issue. If there is no consensus after a reasonable
attempt, the maintainer decides and **writes down why** in the issue. A decision
without a stated reason is not a decision, it is an assertion.

### Things that are not up for debate

- The licence stays AGPL-3.0-only.
- Features that are free stay free.
- The project will not add telemetry that reports on a shop's business.

## Getting involved

**Report a bug.** The most useful contribution, and the most undervalued. What
you did, what happened, what you expected, and the log — see
[DEVELOPMENT.md](docs/DEVELOPMENT.md) for where the log lives.

**Fix something small.** [DEVELOPMENT.md](docs/DEVELOPMENT.md) lists current
good first issues: 19 failing tests, 21 real `no-undef` bugs, two enormous files
that want splitting.

**Improve the documentation.** If you got stuck, that is a documentation bug.
Fixing it while it is fresh is worth more than any of us guessing later.

**Translate.** Posnic is used by shops that do not work in English.

**Help someone else.** Answering a question in an issue is a contribution.

### Recognition

Contributors are credited in release notes. Sustained contributors are invited
to review, then to maintain. We do not use a bot to hand out badges.

## Communication

| For | Use |
|---|---|
| Bugs, features, design discussion | GitHub Issues |
| Questions, ideas, showing what you built | GitHub Discussions |
| Security problems | See [SECURITY.md](SECURITY.md) — **not** a public issue |
| Commercial and Cloud enquiries | info@posnic.com |

Everything technical happens in public. If a decision gets made in a private
conversation, it gets written back into the issue, otherwise the project
develops a shadow history that newcomers cannot read.

## Releases

Versioned with [semantic versioning](https://semver.org). Releases are cut from
a git tag and built for Windows, macOS and Linux by CI, published as a draft
with checksums, and released by a maintainer.

Breaking changes are called out in release notes with a migration note. A
release that breaks a running shop without warning is a failure regardless of
what the version number says.

## Code of conduct

[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) applies everywhere the project
operates. Report problems to info@posnic.com.

## Changing this document

Open a pull request. Governance that cannot be revised in public is not
governance.
