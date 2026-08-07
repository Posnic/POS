# Cloud operations

What Posnic Cloud is made of, what each part needs, and what is left to do
before the first paying customer.

The stack is chosen and recorded in [SUBPROCESSORS.md](SUBPROCESSORS.md). What
remains is provisioning, one measurement, and a legal review — none of which
blocks marketing the service or signing up interest.

---

## The shape of it

Posnic Cloud is a sync service, not a hosted point of sale. The till is
complete on the shop's own machine; the service moves data between tills and
holds an off-site copy.

```
Shop machine                          Our infrastructure
  Posnic desktop app
    local MongoDB                       Gateway API
    in-process Express API   <-------->   authenticates a device
    sync agent                            accepts pushes, serves pulls
      pushes changes                      resolves conflicts
      pulls changes                     Tenant database
      queues when offline                 one shop's data, isolated
                                        Object storage
                                          off-site backups, uploaded images
                                        Web dashboard
                                          read-mostly, browser
```

The desktop side is in this repository. The gateway and dashboard are a
separate codebase.

### What the till actually sends

The sync agent is configured with three things, held in
`%APPDATA%\posnic\posnic-cloud.json`:

| Field | What it is |
|---|---|
| `gatewayUrl` | Where the service lives |
| `deviceToken` | This device's credential. Stored server-side as a SHA-256 hash, never in clear |
| `deviceId` | Which till this is |

It pushes changed records and pulls the ones it has not seen, logging
`pushed N, pulled M`. **When it cannot reach the gateway it queues and carries
on** — that is the property the whole design exists to protect, and no hosting
choice may compromise it.

---

## What each component needs

Stated as requirements rather than as a product, so they can be met by more
than one provider.

### Gateway API

| | |
|---|---|
| Runtime | Node.js 22 |
| Shape | Stateless HTTP. Scale by adding instances |
| Needs | TLS terminated in front of it; a route to the database; object storage credentials |
| Availability | Two instances minimum, so a deploy is not an outage |
| Does not need | Sticky sessions, a filesystem that survives restart, or a fixed IP |

### Tenant database

| | |
|---|---|
| Engine | MongoDB 7.0 or later |
| Isolation | One database per shop. Not one shared database with a tenant column |
| Needs | Encryption at rest; automated backup; point-in-time recovery |
| Access | From the gateway only. Never exposed to the internet |
| Growth | A single till generates roughly 5–50 MB of records a year |

Per-tenant isolation is a deliberate cost. A query that forgets its tenant
filter returns nothing instead of another shop's sales, and a restore for one
customer does not touch another's data.

### Object storage

| | |
|---|---|
| Holds | Off-site backups, uploaded item and branch images |
| Needs | Server-side encryption; versioning; a lifecycle rule matching the retention in [BACKUP_POLICY.md](BACKUP_POLICY.md) |
| Access | Private. Signed URLs with a short expiry, never public buckets |

### Web dashboard

Static assets plus the gateway API. No separate backend.

---

## Decisions

### 1. Where it is hosted — decided

**AWS Mumbai (ap-south-1)**, with MongoDB Atlas and S3 in the same region.

Data residency drove this. `PRIVACY.md` and the DPA both say Cloud data is held
**in India**, and under the DPDP Act 2023 the Central Government may restrict
transfers to particular countries. Keeping it in India avoids the question
entirely and is the simpler position for Indian retail customers, several of
whom will ask before signing.

### 2. Managed database — decided

**MongoDB Atlas**, managed, in Mumbai. Backup, patching and failover come with
it, which is worth more to a team this size than the cost saved by running it
ourselves.

**One thing still to check:** the per-tenant database limit on the chosen tier.
One database per shop is a deliberate design choice — a query that forgets its
tenant filter returns nothing instead of another shop's sales — but some Atlas
tiers cap the number of databases per cluster, and that cap is a ceiling on
customer count. Far cheaper to discover now than at customer three hundred.

### 3. Backup retention and its cost

[BACKUP_POLICY.md](BACKUP_POLICY.md) states 90 days for cloud backups and the
DPA repeats it. That number is currently a claim with no invoice behind it.
Confirm it is affordable at ten, a hundred and a thousand shops, or change the
number in both documents before anyone relies on it.

### 4. On-call — decided

**Automated monitoring runs during business hours; the support line is answered
24/7 for a shop that cannot trade.** A till is not a website, and a shop that
cannot bill on a Sunday evening cannot wait until Monday.

What this means operationally: we will not always be the first to know, so the
detection path is a phone call rather than an alert. That is an honest position
for a team this size, and it is stated as such in
[SUPPORT_LIFECYCLE.md](SUPPORT_LIFECYCLE.md),
[INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md) and the terms.

Out-of-hours automated alerting is worth adding when volume justifies paying
someone to be woken by it. Until then, an alert nobody is rostered to answer is
a pager pointed at an empty room.

---

## Before the first paying customer

Ordered so that each step is possible once the one above it is done.

- [x] Choose hosting and region - AWS Mumbai (ap-south-1), recorded in `SUBPROCESSORS.md`
- [x] Choose managed or self-run database - MongoDB Atlas, Mumbai
- [ ] Confirm the per-tenant database limit on the chosen Atlas tier
- [ ] Confirm backup retention is affordable; fix the number everywhere it appears
- [ ] Stand up staging, and point a real till at it
- [ ] Prove a tenant restore end to end, and **replace the target numbers in
      `DISASTER_RECOVERY.md` with measured ones**
- [x] Complete the subprocessor list, with no "to be confirmed" rows
- [ ] Legal review of terms, privacy and the DPA
- [ ] Confirm the data residency claim matches where the data actually sits
- [ ] Decide pricing, and whether there is a free tier
- [ ] Test the billing and cancellation path with a real payment

Only the last four are commercial. The rest is engineering, and none of it
needs a lawyer to start.

---

## What must remain true whatever is chosen

Non-negotiable, because they are what the product promises and what the desktop
side is built around.

1. **A till trades with the service down.** Sync queues; billing does not stop.
2. **A till trades with the subscription cancelled.** No licence check, no
   expiry, no kill switch. Stated contractually in
   [TERMS_OF_USE.md](../TERMS_OF_USE.md), and it is a design property first.
3. **One shop's data is never in another's database.**
4. **A device token is stored hashed**, never in clear.
5. **Nothing is exposed to the internet except the gateway** and the dashboard.
6. **The shop can export everything, at any time, without asking us.**

A hosting arrangement that breaks any of these is the wrong arrangement, however
cheap it is.
