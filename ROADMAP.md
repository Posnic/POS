# Posnic public roadmap

This roadmap names the product work and evidence still needed before Posnic can
make stronger reliability, hardware, security, and deployment claims. It is not
a promise of dates or a list of marketing features. Priorities can change when
a reproducible failure, security issue, or shop-blocking problem is reported.

Last reviewed: 2026-08-22

Current public release baseline: [v1.3.0](https://github.com/Posnic/POS/releases/tag/v1.3.0)

## Status vocabulary

- **Released**: present in a tagged public package.
- **Reproduced**: observed with a named version, method, input, and limitation.
- **In validation**: implemented or documented, but the required acceptance
  evidence is incomplete.
- **Planned**: accepted direction with no release commitment.
- **Evidence needed**: a claim cannot be made until someone records the missing
  test or operating result.

An issue, pull request, source test, physical-device test, and customer result
are different evidence levels. Passing one does not silently stand in for the
others.

## Current priorities

### P0: counter reliability and recovery evidence

Status: **in validation**

- Run the public transaction fixture on each supported platform and record all
  sale, decline, void, return, replay, stock, tender, and close results.
- Extend the bounded local Windows sale observation to an operating-system
  disconnect, a complete shift, a restart during work, and power-loss recovery.
- Repeat backup and restore checks across supported platforms, larger synthetic
  datasets, and deliberately damaged or incomplete backup inputs.
- Keep payment-provider authorization and settlement outside an offline claim.

Start with the
[vendor-neutral POS acceptance fixture](https://posnic.com/open-source-pos-benchmark#vendor-neutral-pos-acceptance-fixture)
and submit a
[POS acceptance run](https://github.com/Posnic/POS/issues/new?template=pos_acceptance_run.yml).

### P0: named hardware evidence

Status: **evidence needed**

- Record exact printer, scanner, cash-drawer, scale, display, operating-system,
  driver, cable, and connection details.
- Test success, disconnect, retry, malformed input, restart, and recovery paths
  where the device permits them.
- Separate source/protocol support from emulator results and physical-device
  observations.
- Publish a named compatibility result only after the evidence can be reviewed
  and reproduced. A report is not an automatic certification.

Review the [hardware matrix](docs/HARDWARE_MATRIX.md) and submit a
[hardware evidence report](https://github.com/Posnic/POS/issues/new?template=hardware_evidence.yml).

### P0: release and security trust

Status: **in validation**

- Keep release packages, checksums, source tags, build instructions, dependency
  notices, and rollback steps aligned.
- Remove the current unsigned or incompletely notarized package limitations when
  verifiable signing is available for every supported platform.
- Commission an independent security review before making an audited-security
  claim.
- Keep private vulnerability reports out of public issues; follow
  [SECURITY.md](SECURITY.md).

### P1: operator workflow coverage

Status: **planned**

- Add reproducible full-shift acceptance for retail and restaurant workflows.
- Cover cash differences, partial returns, failed prints, stock adjustments,
  held transactions, end-of-day close, and restore into a clean environment.
- Validate tax and fiscal behavior by deployment country. Source fields and
  reports are not a compliance certificate.
- Publish approved customer evidence only with written consent, metric source,
  time window, and limitations.

### P1: contributor and maintainer capacity

Status: **in validation**

- Keep small bugs, documentation gaps, translations, and reproducible hardware
  reports easy to contribute.
- Turn confirmed fixture failures into focused issues and tests.
- Add reviewers after sustained, useful participation under
  [GOVERNANCE.md](GOVERNANCE.md); the project currently has one effective
  maintainer.
- Report actual response behavior without inventing a service-level agreement.

### P2: integrations and multi-till scope

Status: **planned**

- Document versioned public contracts before presenting any connector as
  generally supported.
- Test identity, ordering, stock authority, duplicate delivery, returns,
  payments, reconciliation, outage, replay, and data exit for each integration.
- Keep optional Posnic Cloud behavior separate from the local AGPL application.

## What is already public

| Area | Public evidence | Important boundary |
|---|---|---|
| Source and licence | AGPL-3.0-only source, versioned releases, governance, contribution and security policies | Bundled dependencies retain their own licences; trademarks are separate |
| Local sale | One synthetic Windows v1.3.0 cash sale was completed and reopened under bounded external-host isolation | Not an OS-wide outage, full shift, physical-device, payment-terminal, or power-loss test |
| Source tests | Versioned test results and focused workflow tests are linked from the product evidence page | Not a customer acceptance run, independent audit, or hardware certification |
| Backup and restore | One synthetic restore record with stated counts and limits | Not every dataset, failed disk, platform, or production recovery condition |
| Hardware | Protocol and source-test evidence plus a versioned matrix | No named device is automatically certified |

The maintained evidence index is
[Posnic product facts](https://posnic.com/posnic-facts). The comparison and test
method is the
[open-source POS benchmark](https://posnic.com/open-source-pos-benchmark).

## How roadmap work is accepted

1. Open an issue that describes the operator problem or missing evidence.
2. Name the exact release, source commit, platform, input, and environment.
3. Record expected and observed behavior, including failures and limitations.
4. Attach only synthetic or fully redacted evidence.
5. Add a focused test or reproduction when code changes.
6. Let CI and a maintainer review the result before it changes a public claim.

Evidence reports can disprove a claim or identify a gap. They do not become
testimonials, certifications, compatibility guarantees, or customer outcomes by
being submitted.

## Privacy and safety

GitHub issues are public. Never attach customer names, phone numbers, email
addresses, addresses, tax identifiers, credentials, API keys, card data, bank
details, production database files, or unredacted logs. Use fictional records
for transaction tests. Report security vulnerabilities privately through
[SECURITY.md](SECURITY.md).

## Explicit non-goals

- No telemetry about a shop's business in the local edition.
- No account, seat, item, transaction, or branch limit added to the free local
  edition.
- No feature moved from the free application into a paid service.
- No universal hardware, tax, payment, offline, uptime, security, or compliance
  claim without the matching evidence.
- No feature added only to satisfy a keyword or comparison table.

## Maintenance

The maintainer reviews this file when a stable release changes a listed boundary
or when accepted evidence changes a status. Roadmap discussion belongs in a
public issue or [GitHub Discussions](https://github.com/Posnic/POS/discussions).
Commercial commitments require a separate written agreement and are not created
by this roadmap.
