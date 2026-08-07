# Support lifecycle

Which versions get fixes, for how long, and what to expect from whom.

Posnic is free software published under AGPL-3.0-only. Nobody is obliged to
answer a question, and this document does not create an obligation. It says what
we intend to do, so a shop deciding whether to run this can decide with the real
picture rather than an optimistic one.

---

## Versions

| Line | Support |
|---|---|
| **Latest release** | Fixes, security fixes, and answers to questions |
| **Previous minor** | Security fixes only, until the next minor ships |
| **Anything older** | Nothing. Upgrade. |

There is one supported line at a time. That is what a project this size can
honestly maintain, and a longer list that nobody backports to would be a
decoration.

**Security fixes go to the latest release and ship immediately** — not held for
the next planned version.

Because updates install themselves when the till closes (unless a shop has
turned that off), most installations are on the latest release within a day or
two of it being published. That is the intended state, and the reason the
supported window can be short without leaving people stranded.

---

## What counts as what

**A security issue** is anything that lets someone reach a shop's data or
machine when they should not. Report it privately — see
[SECURITY.md](../SECURITY.md), not a public issue. Acknowledged within 3
working days, with an assessment of severity and an intended fix date.

**A data-loss bug** — anything that loses, corrupts or miscounts sales, stock or
money — is the highest non-security priority. Report it with the log
(`%APPDATA%\posnic\app.log`) and, if you can, a backup taken before it happened.

**Everything else** goes in [issues](https://github.com/Posnic/POS/issues) and
is worked on in whatever order makes sense. No timescale is promised.

---

## Platforms

| Platform | State |
|---|---|
| Windows 10 and 11, 64-bit | Supported and tested |
| macOS, Linux | Built and published; tested far less |
| Windows 8.1 and earlier, 32-bit | Not supported |

Electron and the bundled MongoDB set the floor. When either drops a platform,
so does Posnic, and that lands in a major release.

---

## Ending support for a version

When a release stops being supported, it does not stop working. Posnic runs on
the shop's own machine, the database is on that machine, and nothing we do
switches it off. An unsupported version simply stops receiving fixes.

There is no kill switch, no licence check that expires, and no server that has
to be reachable for the till to open. That is a property of the local edition
worth stating explicitly, because it is unusual in point-of-sale software and it
is the reason some shops choose it.

---

## Posnic Cloud

The paid service is separate, and its terms are separate. Sync, off-site
backups and remote dashboards depend on our servers being up; the till does not.
A shop whose Cloud subscription lapses keeps a working local till with all its
data — it loses sync, not trade.

Commercial terms, privacy and data processing arrangements for Cloud are
published: [TERMS_OF_USE.md](../TERMS_OF_USE.md),
[SUBPROCESSORS.md](SUBPROCESSORS.md) and
[DATA_PROCESSING_ADDENDUM.md](DATA_PROCESSING_ADDENDUM.md).

Nothing here is a service level agreement. Support is answered — see below —
but no uptime percentage or repair time is promised.

---

## Support hours

| | |
|---|---|
| **Business hours** | Monday to Saturday, 10:00–19:00 IST |
| **Monitoring** | During business hours |
| **Urgent support** | **On call, 24 hours a day, every day** |

**Urgent means the shop cannot trade** — the till will not open, sales cannot be
recorded, or data looks wrong. Call or send a WhatsApp message on
**+91 94941 11161** and you will reach a person, whatever the hour. A shop that
cannot bill is not a next-working-day problem, and a point of sale that only
answers between ten and seven is not much use to a business that trades in the
evening.

Everything else — questions, feature requests, configuration help — is answered
during business hours.

**Automated monitoring runs during business hours.** Outside them, we find out
because someone tells us, which is the reason the number above is answered
around the clock rather than left to a queue.

## Getting help

- **Security problem:** [SECURITY.md](../SECURITY.md) — privately, not an issue
- **Something is broken:** [open an issue](https://github.com/Posnic/POS/issues)
  with what you did, what happened, and the log attached
- **A question:** [Discussions](https://github.com/Posnic/POS/discussions)
- **Paid support or Cloud:** info@posnic.com

A clear report with a log attached gets answered fastest. That is not a policy,
just what actually happens.
