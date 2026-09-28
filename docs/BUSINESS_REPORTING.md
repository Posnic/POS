# Business reporting contract

The first live amount is **Sales after returns (including tax)**. It is not cash collected, profit or tax-exclusive net revenue. The app must show that definition beside its detail view. Metric definition version 2 is separate from the synthetic version-1 preview.

## Reconciliation

The canonical source is the sale writer's `sales_total`: it already includes line discounts, extra discount, coupon redemption, loyalty redemption and bill rounding. Tips are stored separately. Subtracting the discount again would understate sales. A partly paid issued bill still contributes its full billed amount; outstanding debt and tender collections require separate metrics.

Return blocks have a stable `returnObjId`, `returnDate`, and post-discount/rounding `itemsTotalAmount`. Deduct each return on its return business date, not again on the original sale date. Their sum must reconcile with `items_return_total`; a mismatch is unavailable/partial data, never an invented zero. Reject duplicates, unsupported precision, scope mismatches, unknown states and invalid dates. The pure mapper stores no customer information or item descriptions.

Paid restaurant bills may retain `sale_process: KOT`. Include Paid/Partialy Paid KOT bills; exclude unpaid open tables, holds, cancellations and training rows. Add/Edit/Partial/PartialReturn/FullReturn represent issued bills. Bill count is issued bills on the bill date, including a bill later returned; a return-only day can therefore have a negative amount and zero new bills. It must not produce an infinite average.

Use the branch's configured IANA timezone, ISO currency and minor-unit precision. Never add different currencies. The bill date is `date`, not the last sync timestamp. Return time comes from the return block. Captain payment time is a separate cash-collection concept and must not silently move a bill to another day.

Tests run the actual desktop sale calculation with controlled repository seams for coupon/loyalty/extra discount, part payment, tips, exclusive tax and rounding. Additional mapper tests cover return-date attribution, duplicate/mismatched returns, midnight/DST, branch/license scope and precision. They do not yet constitute end-to-end source completeness or return-writer qualification.

## Prepared data and source completeness

Phone reads must use indexed prepared summaries only. Opening Today must never scan sales, rebuild history or start a long aggregation. Preparation must have a bounded per-run work budget, durable replay and a visible failure state.

Production MongoDB is standalone, so a design depending on multi-document transactions is not compatible. A retry must replace a source contribution, not blindly increment a total. Edits, duplicate sync, returns, branch/date movement, cancellation and deletion need explicit replacement/removal semantics, crash recovery and concurrency tests before wiring live reads.

The existing gateway stamps ingestion time in `_syncMeta.at`; source `updated_date` alone cannot prove arrival order because offline devices can deliver older records. Neither timestamp proves that every till has uploaded its records. A current badge requires all expected source checkpoints. Until that exists, synchronized totals must be labelled partial/delayed with the last source time; refreshing an API cannot turn them current.

`prepareDesktopSummary` is a desktop-only baseline preparation primitive. It projects only required fields, scans at most 100,000 scoped source documents in batches of 100, yields between batches, and stops after a 30-second budget or cancellation. A source error fails preparation instead of publishing a truncated total. It never runs in a Cloud process. The desktop worker creates the `{license, branch_id, _id}` index, leases one requested job at a time and stages its result durably. It retries no more often than once per five minutes per date and stops with the API server. Index/startup failures cannot prevent checkout from opening. Large-history qualification, incremental preparation and a controlled rebuild path remain required before production rollout.

## Request and publication path

`GET /api/business/v1/overview` authenticates a separate Business session, resolves current ACL and branch membership, and accepts one calendar date from the last 32 days (with two days of timezone allowance). At most 100 unique permitted branches can be requested; mixed currencies are rejected. It writes short-lived preparation request metadata and performs bounded indexed reads of existing summaries. Missing, conflicting or in-progress summaries return 503, never zero. No sale aggregation runs in this API. Discovery advertises `bounded-summary-v2`.

The companion sync agent obtains up to four requested dates from the gateway only while the upgraded desktop worker advertises a live local runtime marker. The first eligible desktop claims a stable branch publisher assignment. Another till cannot silently take over when it goes offline. A local lease prevents concurrent preparation, and a changed assignment prevents old work from being staged. The agent saves the complete publication envelope before sending; retries preserve its sequence and content. The gateway stores a pending snapshot in the assignment document, then replaces the summary and clears the pending record. A crash between writes is recovered on retry without a multi-document transaction or double counting. Reads recheck the assignment generation around summary retrieval.

The four reporting collections are local-only for generic synchronization. Dedicated work/publication APIs move metadata and summaries; raw sale records and customer details are not part of this protocol. Business API requests do not consume selling-handset slots, but explicit device IP blocks and Business authentication still apply.

Local validation: 14 real-Mongo authentication/read/preparation/worker tests, nine gateway publication/agent integration tests, and 82 mapper/sale-writer tests. They cover lost acknowledgements, process restart, changed ownership, concurrent claims, duplicate publication, corrupt source data, old-bill refunds, branch isolation and cancellation. The mobile screen validates version 2 and clears displayed amounts on failed refresh or access loss.

Owners with explicit branch membership can manage a branch's reporting desktop through `GET/POST /reporting/publishers/:branchId`. The `reporting.manage` capability is owner-only. Gateway verifies candidate presence for three minutes. Replacement requires the observed assignment epoch and a live candidate, waits out pending publication, and increments the epoch. An audit event lives atomically with the changed assignment until it is copied idempotently into the audit collection. Competing replacements have one winner, and the old desktop cannot publish afterward. The mobile confirmation explains the temporary loss of totals and immediately reloads Today after a change.

The management addition passes two further real-Mongo tests for owner/branch authorization, concurrent replacement, live-candidate enforcement and interrupted audit recovery (16 POS integration tests total). Gateway now has ten reporting integration tests, including former-publisher rejection and replacement of a future-dated old summary.

Rollout remains gated on source completeness, large-history checkout performance, Community deployments without a gateway, actual return-writer qualification and deployed cross-service testing. Install tenant API, gateway and desktop/agent companions together in a controlled environment first. Current figures are always partial or delayed. Avoid copying the legacy dashboard calculation: some paths exclude paid KOT bills and subtract discounts already included by the sale writer.
