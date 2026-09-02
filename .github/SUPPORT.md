# Getting help

Where to ask, what to include, and what happens after you post.

## Where to go

| I want to… | Go to |
|---|---|
| Report something broken | [New issue → Bug report](https://github.com/Posnic/POS/issues/new?template=bug_report.md) |
| Suggest a feature | [New issue → Feature request](https://github.com/Posnic/POS/issues/new?template=feature_request.md) |
| Ask how to do something | [Discussions → Q&A](https://github.com/Posnic/POS/discussions) |
| Report a security problem | [SECURITY.md](SECURITY.md) — **privately, never a public issue** |
| Ask about Cloud, billing or a paid licence | info@posnic.com |

**Questions belong in Discussions, not Issues.** An issue is a piece of work
with an end; a question is a conversation. Posting a question as an issue is not
a problem — it will be moved.

## Before you open an issue

Two minutes here saves a round trip:

1. **Search existing issues**, including closed ones. Someone may already have
   hit it.
2. **Check you are on the latest release.**
3. **Read the log.** It usually names the problem outright:

   | System | Log |
   |---|---|
   | Windows | `%APPDATA%\posnic\app.log` |
   | macOS | `~/Library/Application Support/posnic/app.log` |
   | Linux | `~/.config/posnic/app.log` |

## What makes a report we can act on

The difference between a bug fixed this week and one that sits for a month is
almost always whether we can reproduce it.

- **What you did**, step by step, from opening the app
- **What you expected**
- **What happened instead** — the exact message, or a screenshot
- **Posnic version** (*Help → About*) and your operating system
- **The log**, attached
- For hardware: the **make and model**, and how it is connected

Please redact customer names and phone numbers from screenshots and logs before
attaching them. Issues are public.

## What happens next

**Within a few days** someone reads it and adds labels. That is a person, not a
bot, and the project is small — see [GOVERNANCE.md](../docs/GOVERNANCE.md) for who.

Every issue ends up in one of these:

| Label | Meaning |
|---|---|
| `bug` | Confirmed and reproducible |
| `needs-info` | We cannot reproduce it yet — usually the log is missing |
| `good first issue` | Small, self-contained, a fine place to start |
| `help wanted` | Real and wanted, nobody is on it |
| `enhancement` | Accepted feature work |
| `discussion` | Worth doing, shape not agreed yet |
| `wontfix` | Explained and closed, with the reason written down |
| `duplicate` | Linked to the original |

### Priority

We do not pretend to a support SLA — this is free software. What we do commit
to is an honest ordering:

1. **Data loss or corruption.** Dropped everything.
2. **Cannot sell.** A till that will not take a payment is a shop losing money.
3. **Security.** Handled privately, see [SECURITY.md](SECURITY.md).
4. **Broken feature with no workaround.**
5. **Broken feature with a workaround.**
6. **Everything else.**

**Paid Posnic Cloud customers get a guaranteed response time**; that is part of
what the subscription buys. Everyone else gets the same queue, ordered by the
list above. A clear report with a log jumps ahead of a vague one every time,
because it can actually be worked on.

### Stale issues

`needs-info` issues with no reply are closed after 30 days. They are not
rejected — comment and they reopen. It keeps the list to things someone could
actually pick up.

## Feature requests

**Describe the problem, not the solution.** "I have to type each item twice
when a customer returns half an order" tells us more than "add a split-return
button", and often has a better answer than the one you had in mind.

What we ask:

- **Who else needs this?** A feature for one shop is a fork or a custom build;
  a feature for many shops is a feature.
- **What do you do today?** The workaround tells us how much it hurts.
- **Does it need internet?** The local edition must work fully offline.
  Anything requiring a connection belongs in Cloud, not here.

Requests are read and labelled, not silently dropped. If we say no, we say why,
in the issue. A `wontfix` with no explanation is a failure on our part.

There is no roadmap promise. Accepted requests are labelled `enhancement`,
and anyone — including you — can pick one up.

## Commercial support

Guaranteed response times, custom features, integrations, data migration,
self-hosted deployments, priority fixes and commercial licences:
**info@posnic.com**.

That is also how this work gets funded. Buying support is a direct way to keep
the free edition healthy.
