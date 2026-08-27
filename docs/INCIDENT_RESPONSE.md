# Incident response

What happens when something goes wrong: who decides, who is told, and when.

Written before it is needed, because the one thing nobody does well at 2am is
invent a process. Deliberately short — a procedure nobody can hold in their head
is a procedure nobody follows.

---

## What counts as an incident

| Severity | What it looks like | First response |
|---|---|---|
| **SEV1** | Customer data exposed to someone who should not have it; a compromised release or update; shops unable to trade | Immediately, any hour |
| **SEV2** | Posnic Cloud down or badly degraded; sync stopped for many shops; a bug corrupting data | Within 4 hours, working day or not |
| **SEV3** | One shop badly affected; a security bug with no evidence of exploitation | Next working day |
| **SEV4** | Everything else | Normal issue triage |

**When in doubt, call it higher.** Downgrading later costs nothing. Starting too
low costs the hours that mattered.

A **personal data breach** is any SEV1 or SEV2 involving unauthorised access to,
disclosure of, or loss of customer data. It starts the clocks in Section 4.

---

## Who does what

We are a small team, so these are roles for the duration of an incident, not job
titles.

- **Incident lead** — the first person to pick it up, until they hand over
  explicitly. Decides severity, decides what gets said, and decides when it is
  over. One person, always, so there is never a question of who is deciding.
- **Everyone else** — investigates or communicates as the lead asks, and does
  not talk to customers or the public independently.

If nobody has picked it up within the response time above, it escalates to the
owner of Posnic Innovations.

---

## The steps

### 1. Record it

Open an incident note the moment it is suspected. Time, what was seen, who is
leading. Everything after this gets appended to it with timestamps.

Write it as you go, not afterwards. Reconstructed timelines are wrong in exactly
the places that later matter.

### 2. Contain

Stop it getting worse before working out why it happened.

- Revoke tokens or keys that may be exposed
- Take a compromised component out of service
- **Unpublish a bad release** — see [RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md)
- Block an abusing account

**Preserve evidence while you do.** Copy logs before rotating them; snapshot
before rebuilding. Containment that destroys the record leaves you unable to
say what was reached, which is exactly what you will be asked.

### 3. Assess

- What data, whose, how much?
- Was it accessed, or only reachable?
- Is it still happening?
- Which customers are affected?

Say **what is known and what is not**, separately. "We do not yet know whether
records were read" is a legitimate finding. A guess presented as a finding is
not.

### 4. Notify

Clocks start when we become **aware**, not when we finish investigating.

| Who | When | Where |
|---|---|---|
| Affected customers | Without undue delay, within **48 hours** for a data breach | Email to account holders |
| A customer's supervisory authority (GDPR) | We give them what they need within **48 hours** so they can meet **72** | Via the customer |
| Data Protection Board of India (DPDP Act) | As the Act requires, where we are the fiduciary | Direct |
| Affected data principals | As the DPDP Act requires | Via the customer, or direct if we are the fiduciary |
| Publicly | Once contained, if the incident affected the software rather than one account | Release notes and a GitHub advisory |

The customer notice says: what happened, when, what data, what we have done,
what they should do, and who to ask. **Send it before it is complete.** A short,
honest notice at hour six beats a polished one at hour sixty.

### 5. Fix

Fix the immediate cause, then the reason it was possible.

Before closing, **add the test that would have caught it**. An incident with no
test is one that can recur, and the moment it is understood is the cheapest
moment to write that test.

### 6. Review

Within five working days, write up: timeline, what happened, why, why it was not
caught sooner, what changed. Blameless — systems that let one mistake become an
incident are the finding, not the person.

If it affected the software, the review goes in the repository. A project asking
to be trusted with a shop's takings should be readable about its failures.

---

## Reporting one to us

**Security vulnerabilities:** [SECURITY.md](../.github/SECURITY.md) — privately, never a
public issue. Acknowledged within 3 working days.

**Suspected breach of your data:** security@posnic.com, marked urgent.

**Service problems:** info@posnic.com.

We will not pursue anyone who reports a genuine security issue responsibly and
gives us reasonable time to fix it.

---

## What we cannot do

Stated plainly, because a response plan that implies more capability than exists
is worse than none.

- **We do not monitor 24/7 — we answer 24/7.** Automated monitoring runs during
  business hours, so a SEV1 overnight is usually found because a shop tells us.
  The number in `SUPPORT_LIFECYCLE.md` is answered at any hour for a shop that
  cannot trade. The distinction is real and worth stating: we will not always
  notice first, but you will always reach a person.
- **We cannot recover data we never had.** Local-edition data is on your
  machine; if it is lost and unbacked-up, we cannot help. See
  [BACKUP_POLICY.md](BACKUP_POLICY.md).
- **We cannot investigate a shop's own machine** unless the shop gives us logs.
- **There is no SLA.** See [SUPPORT_LIFECYCLE.md](SUPPORT_LIFECYCLE.md).

---

## Practising

An untested plan is a document. Once a year, at minimum:

- Restore a Cloud backup into a scratch environment and confirm it works
- Walk a simulated breach through Sections 1–4 and time it
- Check the contact addresses here still reach a person

Record the date and what was learned. If a drill has not happened in over a
year, say so in the readiness report rather than letting the omission be silent.
