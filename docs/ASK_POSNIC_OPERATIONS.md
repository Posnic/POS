# Ask Posnic operations

Ask Posnic is mounted inside the normal POS at `#/askposnic`. It uses the
authenticated shop and branch context; callers cannot select another tenant in
their question or request body.

## Modes

- **Direct:** sales, profit, tax, payment mix, top/slow/unsold items, category performance,
  customer purchase segments, hourly/daily trends, comparison, receivable
  and low-stock answers use existing reports and do
  not call a model.
- **Own key:** the existing AI settings page stores the shop's provider key on
  the server. Published knowledge can then use a short cited model answer.
- **Managed:** a cloud deployment supplies the provider, model and an allowance.
  Bedrock uses `POSNIC_MANAGED_AI_PROVIDER=bedrock`,
  `POSNIC_MANAGED_AI_MODEL=global.amazon.nova-2-lite-v1:0` and
  `AWS_REGION=ap-south-1`. The SDK uses a workload role, or the dedicated host
  profile selected by `POSNIC_MANAGED_AI_AWS_PROFILE`. The developer can use
  AWS SSO locally. Bedrock needs no shop API key.
  Other managed providers use `POSNIC_MANAGED_AI_KEY` on the server.

`POSNIC_MANAGED_AI_MONTHLY_CAP` provisions a pilot allowance at the
start of each UTC month. It is denominated in the first branch's shop currency,
stored with the account's exchange rate for that month. It is **not a paid
subscription entitlement**. Leave the cap blank to prevent pilot model spending.
For paid Cloud packs, set `ASK_POSNIC_BILLING_URL` to the HTTPS web-api endpoint
`/api/managed-ai/entitlement` and configure the same `ASK_POSNIC_BILLING_TOKEN`
on both services. Paid mode never falls back to the pilot cap on a billing outage.
The account key follows the provider billing period; top-ups increase that
period's allowance without resetting spend. These allowances are USD cents.
The authenticated request derives the tenant from the current database. Responses
are bounded, reject redirects and expire from cache after 30 seconds.
No managed credential is returned to the browser. Managed image assistance is
disabled until its token-reservation policy is implemented; shop-owned providers
retain their existing image support.

The managed ledger reserves before network calls, records usage at sub-cent
precision, and rounds the cumulative display instead of rounding each tiny
call to zero. Reservations are bound to the shop and their original month.
The displayed cost is an estimate, not an AWS invoice reconciliation: the
existing price table and exchange rates apply, including a conservative
fallback for unlisted models. Balance changes and reservation holds share one
atomic account write. Audit projection failures are recovered on later reads
without charging twice. A provider timeout retains a reviewable hold; definite
provider rejections release it. Do not expire unknown outcomes blindly.

The selected Nova global profile in Mumbai now uses verified AWS Price List API
rates: USD 0.35 per million input tokens and USD 2.95 per million output tokens,
effective 1 September 2026 and checked 1 October. The snapshot includes AWS
SKUs in `api/infra/ask-posnic-bedrock-pricing.json`. Recheck with
`node api/scripts/verify-ask-posnic-pricing.js` using the AWS SSO profile.
Other regions retain the conservative fallback until independently verified.
Each new managed reservation snapshots its unit prices so deployment/configuration
changes cannot reprice an in-flight call. These are list-rate estimates;
provider invoice reconciliation and customer pack pricing remain separate gates.

The Cloud account has an **Ask Posnic AI** page for allowance status, purchase
review, top-ups and cancellation. Initial paid checkout supports Razorpay INR
monthly subscriptions and one-time top-ups; other provider lifecycles are not
enabled for AI yet. No prices or allowances are seeded. Intranet Payments can
create a `managed_ai` price with an explicit allowance, and monthly active prices
require a Razorpay plan mapping. Empty catalogs expose no purchase action.
Checkouts snapshot price/allowance, require Cloud ownership and use stable retry
IDs. A shop-level checkout claim prevents duplicate monthly subscriptions.
Signed renewals recover the original purchase; captured payments fund each
period once. Refunds remove their grant. AI purchases never grant or replace
Cloud entitlements. Owners can cancel renewal even after their Cloud plan lapses.
See the web-api repository's `docs/MANAGED_AI_BILLING.md` for rollout details.

`ASK_POSNIC_ACTION_SECRET` signs ten-minute, single-use action confirmations.
Set it independently in production. `SESSION_SECRET` is the local fallback.

## Knowledge workflow

Owners can add FAQ, Markdown and release-note text or upload PDF, Markdown and
text files from the Ask Posnic page. New material is a draft. Publishing makes customer-safe
chunks retrievable; retiring removes them from retrieval immediately. Each
answer carries document title and revision citations. Citation buttons open only
currently published customer-safe content from the same shop. Retired sources
return unavailable. Conversation history and deletion are scoped to the user,
shop and current outlet. Storage retains at most 100 messages per conversation.
History rechecks current feature and financial permissions; revoked access
redacts earlier protected answers. Direct report periods use the shop timezone,
including complete previous weeks (Sunday start), months and years.

POS and Intranet parse PDFs in a short-lived child process, with at most two
parsers per API process, a 30-second deadline, a 128 MB V8 old-space limit and
bounded output. This heap limit does not cap native allocations at the OS level.
The child receives no provider credentials or application configuration. Uploads
over 10 MB and extracted text over 200,000 characters are rejected; no instructions
are silently truncated. Busy uploads receive a retry message without entering an
unbounded queue. Scanned PDFs still require external OCR before upload. Keep both
copies of `knowledge-pdf-parser.js` and `knowledge-pdf-worker.js` synchronized.

Hourly/daily trends aggregate the same recorded sale totals and accepted statuses
as the dashboard, bounded to the authenticated shop/outlet and requested dates.
Financial-report permission is required. Hours use the shop timezone and combine
the same hour across the period; day results show the latest 31 active days with
full-period totals. Days with no sales are omitted. Neither tool calls a model.

Commerce insights also require financial-report permission. Slow-product queries
include zero-sale products with tracked stock, excluding inactive/draft/instant
items, untracked items and soft-deleted catalog rows (including legacy tombstone
representations). Sales and catalog rows are independently restricted to the shop/outlet.
Category reports use sale-line snapshots, with an explicit uncategorized bucket;
line totals can differ from bill totals after bill-level discounts or charges.
Customer segments group one-purchase and repeat-purchase customers within the
selected period. Walk-in, missing and invalid customer identities count as
unidentified transactions, never as a single repeat customer. These reports send
no records to a model. They show at most ten products/categories with full counts
and full category totals. An excluded session period returns an explicit refusal.

Coupon promotion performance reads the current outlet's non-voided redemption
ledger. It ranks code/currency groups by uses and shows discounts and bill
snapshots recorded at redemption. Full totals include codes beyond the top ten.
Currencies remain separate, including legacy records without a currency. Customer
identities are not returned. This reports recorded coupon activity, not causal
sales lift, campaign attribution, marketing ROI, manual discounts or loyalty.
Financial permission and report-date/session restrictions apply; no model runs.

Reorder planning uses 30 complete local days by default and suggests coverage for
the next 7 days. Questions can specify `last 60 days` and `next 14 days`, or clients
can provide `planning.lookback_days` (7–90) and `planning.coverage_days` (1–90).
The target is the larger of average daily recorded sales × coverage days and the
item's configured reorder point (zero when unset). It subtracts current stock and
remaining quantities on ordered/partially received purchase orders. Draft,
cancelled and closed orders are excluded. All three sources independently enforce
the same shop/outlet scope. Only active, non-deleted, inventory-tracked items are
eligible. Quantities round upward to 0.001 inventory units.

This is an advisory average-rate calculation, not a seasonal forecast. The answer
states the observation window and asks the user to check supplier lead times,
pack sizes and stockouts. Unsynced remote records are outside its data scope.
It shows ten suggestions and can prepare up to 100 items, grouped by supplier,
with missing suppliers identified explicitly. Preparation derives quantities on
the server and ignores client-supplied order lines. Confirmation rechecks sales,
stock, item details and incoming orders against the reviewed planning window;
changes require a new review. Completed confirmation saves ordinary PO drafts
and does not change stock. Insights/financial permissions apply in addition to
purchase-order action permissions; session-restricted users cannot access the
complete-day planning window. Incoming-source failures cannot become zero stock.

Outlet comparison loads the user's current persisted branch assignments, including
for owners, and intersects them with this shop's available branch records. Client
outlet lists cannot widen it. It supports up to 100 assigned outlets, requires
financial access without a single-session restriction, uses one explicit timezone
and period, and shows each outlet's configured currency separately. It never adds
different currencies together. Zero-record outlets remain visible. The answer
states that unsynced remote sales are unavailable; it does not imply real-time
fleet coverage. Saved comparisons are hidden when any included outlet or the
required permissions are revoked. These queries make no model calls.

The Intranet Ask Posnic page maintains immutable revisions through draft,
review, published and retired states. Its published JSON bundle can be imported
on the shop's Ask Posnic page. Import is idempotent per central series and
revision, and retires an older published revision. Internal documents never
enter the bundle. Customer retrieval reads published customer material only.

Intranet also accepts PDF/Markdown/text uploads into the editor for review.
Its **Test customer questions** panel tests up to ten questions against published
sources, optionally including the unsaved editor. A revised source replaces its
published series only within this preview. The admin-only endpoint rejects
internal sources, makes no writes or model calls, and returns exact FAQ answers
or source excerpts. It is a retrieval check, not a generated-answer quality score.
The POS and Intranet deploy byte-identical `ask-posnic-retrieval.js` kernels;
keep these copies synchronized when changing retrieval. Ranking uses term
frequency, inverse document frequency, modest title weighting and weighted query
coverage. Paragraph windows preserve the cited chunk identity. Definition
questions naming a multiword field prefer its table definition. The fallback
shows up to three verbatim passages with matching citation numbers, preserving
evidence from secondary matches instead of truncating to the first source.
Optional managed hybrid retrieval now combines these results with Titan V2/S3
Vectors using reciprocal-rank fusion. Exact FAQs still bypass both embeddings
and generation. Intranet's draft preview remains a lexical preview; it does not
index unsaved material or charge an embedding call.

### Managed semantic retrieval

The dedicated private vector bucket `posnic-ask-<aws-account-id>` and cosine index
`knowledge-v1` were created in `ap-south-1`, with 256-dimensional float vectors
and SSE-S3 encryption. `UsePosnicSemanticKnowledge` grants the dedicated host
identity only Titan V2 invocation and put/get/query/delete on that exact index.
The policy admits the verified Lightsail IPv4 and IPv6 addresses. Both are
checked by `api/scripts/provision-ask-posnic-semantic.js --apply`; the S3 Vectors
dual-stack endpoint used IPv6 during the host probe. No application environment
or process was changed by provisioning.

At managed rollout, set `ASK_POSNIC_VECTOR_BUCKET=posnic-ask-<aws-account-id>`,
`ASK_POSNIC_VECTOR_INDEX=knowledge-v1` and a stable
`ASK_POSNIC_VECTOR_NAMESPACE=posnic-cloud` alongside the dedicated AWS profile.
The namespace, Mongo database name and authenticated license form the filtered
search scope. Every result is rechecked against current Mongo publication,
visibility, generation, document ID and chunk identity before using its text.
Source retirement prevents retrieval immediately; a subsequent indexing sweep
removes retired vectors. Do not change namespaces or indexes without cleaning up
the old index, since the runtime intentionally accesses only its configured index.

A separate worker handles at most eight chunks of one source per tick. It cannot
delay the scheduled-report worker. Completed chunks are checkpointed; identical
chunks in a changed revision reuse their prior embeddings, and obsolete vectors
are deleted after the replacement finishes. Only a complete generation becomes
eligible for semantic retrieval. FAQ/keyword help stays available during indexing
and AWS failures. The module's document list shows queued, processing, ready and
operator-review states. An uncertain paid call or abandoned processing claim is
not retried on elapsed time alone. The operator recovery command below now handles
records with a verifiable worker identity; legacy records remain a manual review.

Embedding calls use the managed allowance reservation/settlement ledger with
zero output tokens and conservative UTF-8 input bounds. Mumbai's verified Titan
V2 price is $0.024 per million input tokens (`api/infra/ask-posnic-embedding-pricing.json`).
`verify-ask-posnic-pricing.js` checks generation and embedding prices. S3 storage
and request fees are additional infrastructure costs, not included in the token
meter. Community installations can now opt into local semantic retrieval with
their OpenAI key, as described below. Other own-key providers retain FAQ/keyword
RAG. No Posnic AWS credential is distributed to Community installations.

The initial cosine-distance cutoff is 0.6, a retrieval filter rather than a
confidence score. A live export paraphrase returned distance 0.512; three unrelated
queries returned 0.787–0.835 and were rejected. This small probe does not establish
broader language/answer quality. The authenticated `--live --semantic` smoke
passed real indexing, paraphrase retrieval, cited generation and sub-cent
embedding reconciliation using synthetic data. The restricted Lightsail identity
also passed the real vector probe. Synthetic vectors were deleted after testing.

The subsequent live smoke also imported a second immutable Intranet revision
with unchanged content and verified that its embedding reservation count did
not increase. Its cached S3 vector was copied into the new publication generation.
If the JavaScript SDK's SSO token expires while AWS CLI still holds valid temporary
role credentials, `node api/scripts/run-ask-posnic-live.js --semantic` uses the
CLI's supported credential export in memory for the isolated smoke child. It
verifies the AWS account and writes no credentials to disk or logs. A fully
expired role still requires a normal SSO login; the production host uses its
separate dedicated profile.

The implementation follows the [Titan V2 request contract](https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-titan-embed-text.html)
and the [S3 Vectors regional endpoint documentation](https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors-regions-quotas.html).
The semantic checkpoint passed 35 real MongoDB cases, 22 focused retrieval/provider
tests, the authenticated live AWS smoke, host probe and desktop/mobile checks.
The full API run passed 431 suites/11,444 tests plus nine native tests (two
suites/13 tests remain skipped). Incremental-vector reuse and an additional price
test were verified afterward by the database suite and focused tests. Frontend
build: `cf5e40e6cc067b12`. The host probe uses the isolated validation runtime;
it does not deploy the application. Its Node 20 runtime is currently supported
but needs review before SDK releases that require Node 22 from January 2027.

The reproducible knowledge evaluation uses 237 manual chapter snapshots in
`api/tests/fixtures/ask-posnic-knowledge-sources.json`. These are evaluation
evidence, not automatically published knowledge; dated manual limitations still
need editorial review before publication. Each snapshot has a checked content
hash. Twenty supported questions record literal evidence and source IDs; three
also accept inspected equivalent passages from other chapters. Four unsupported
probes cover absent capabilities, an unsupported business guarantee and private
credentials. Run `node api/scripts/evaluate-ask-posnic-knowledge.js --assert` from
the POS root. Refresh snapshots deliberately with
`node api/scripts/build-ask-posnic-evaluation-corpus.js` when the sibling manual
changes, then review the evidence rather than updating expectations blindly.

On 1 October, all 20 cases retained accepted evidence in retrieval and the
fallback, and all four unsupported probes returned no match. The original
primary-quote recall was 85%; accepted alternatives account for the difference.
The initial implementation retained only 65% of primary quotes in retrieval,
45% in the first-source fallback and rejected two of four unsupported probes.
The checked-in Jest evaluation enforces at least 90% accepted-evidence coverage
and rejection of every unsupported probe. This small, development-used set is a
regression gate, not an independent general-accuracy estimate. It does not grade
model-generated factual correctness, semantic paraphrases or multilingual answer
quality; a broader held-out pilot remains required.

For automatic distribution, configure the same random
`ASK_POSNIC_KNOWLEDGE_TOKEN` on Intranet and the POS cloud host, and set
`ASK_POSNIC_KNOWLEDGE_URL` on POS to the HTTPS Intranet
`/api/ask-posnic/published-bundle` endpoint. The POS host must be able to reach
that endpoint. Unknown help questions refresh the snapshot at most once every
15 minutes per shop. Distribution refuses redirects, oversized responses and
invalid snapshots; existing knowledge remains available on fetch failure.
Authoritative snapshots retire removed central sources while preserving local
shop documents. Retirement at the source therefore takes effect after the next
successful refresh, not instantly across disconnected installations.

Workflow questions such as "How do I create a purchase order?" go to product
guidance, not action preparation. Published knowledge takes priority over built-in
receipt, refund and offline guidance. An FAQ whose title exactly matches the normalized question returns directly,
without a model call. Other documents use lexical retrieval and optional cited
generation. Retrieval supports Unicode words and excludes common English stop
words. Retrieved text is fenced as untrusted content. Generated answers with
missing or invalid numbered citations fall back to the approved excerpt. Owner
style and terminology directions live on the Ask Posnic settings page.

## Confirmed actions

Actions prepare real purchase-order drafts, stock-count worksheets and customer
campaign drafts. The user reviews the complete payload and explicitly confirms
it. The signed token is bound to the user, shop, branch, payload, nonce and
expiry, and replay is rejected. Purchase orders remain drafts, stock counts do
not adjust inventory, and campaigns do not send until the normal campaign
workflow is used. The review modal shows all proposed lines, quantities and
costs. Inventory, names, supplier assignments and costs are checked again on
confirmation. If they changed, the user must prepare and review a new draft.

Low-stock purchase orders top up at most 100 tracked active items to 10 units,
subtracting unreceived quantities on ordered/partially received POs. Draft,
cancelled and closed POs do not count as incoming. Items already at the target
do not generate a one-unit order. The review states this rule. Confirmation and
partial-batch recovery recheck incoming quantities; old drafts without that
snapshot require fresh preparation. Malformed incoming quantities fail the
action instead of becoming zero. Stock-count drafts include at most 1,000
tracked active items. Both exclude soft-deleted items, and confirmation also
checks unit/barcode changes. Sales drafts exclude soft-deleted catalog items at
preparation and confirmation while still permitting legitimate untracked sales.

Confirmed writes carry deterministic record identities derived from the durable
action and step. Lost insert acknowledgements cannot create a second record.
`GET /api/ask-posnic/actions/:id` is scoped to the initiating user, shop and
outlet. It reports saved records after interrupted execution, repairs completion
and its audit projection when all records exist, and shows partial purchase-order
batches without replaying them. A failed partial purchase-order batch offers
**Review remaining orders**. The server rechecks inventory for the unsaved orders,
rotates the single-use confirmation and preserves the original action/step IDs.
Nothing is saved by opening the recovery review. Confirmation rechecks which
orders already exist and executes only the reviewed remainder. Concurrent reviews
and confirmations cannot duplicate orders. An action still marked `executing`
cannot be resumed just because time elapsed: a worker may still be writing. Such
an interrupted process requires operator verification before releasing its state.

**Sales drafts** use the existing quotation workflow. Enter up to 30 lines as
`quantity x exact name`, barcode or SKU. Ambiguous matches are refused. The server
loads the outlet's catalog price and tax, combines repeated items and calculates
totals through the normal document arithmetic. The review modal shows all lines,
prices, tax and total. Confirmation rechecks catalog details and creates one
`draft` quotation through `QuoteRepository`, with the same durable identity and
recovery rules as other actions. No stock, payment or completed sale is created.
Open Quotations to review, edit or convert through the normal checkout. Fractional
quantities are preserved by the shared document-to-cart loader. Existing shops
with an explicit action allowlist must enable this action in Ask Posnic settings.

**Supplier-message drafts** use an existing purchase-order number in the current
outlet. Draft orders produce an availability request; ordered/partially received
orders produce a delivery follow-up for remaining quantities. Closed/cancelled,
ambiguous, empty or oversized orders are refused. Optional notes are plain text.
The complete source-derived message is reviewed and the purchase order is checked
again at confirmation. A changed order requires a fresh review.

Confirmation saves one durable `supplier_message_drafts` record with stable action
identity. It does not contact a provider or change the purchase order. **My
supplier-message drafts** lists up to 50 recent drafts for this user/shop/outlet,
with a copy button and a reminder to check the current order before sending.
Receiving write permission (or owner access), the Actions policy and the action
allowlist apply to preparation, confirmation and reading saved drafts. Existing
explicit allowlists require enabling Supplier-message drafts. These private drafts
stay on their originating installation; the sync manifest marks them local-only.

## Schedules

Owners can schedule daily or weekly sales, profit and low-stock summaries by
email or WhatsApp. WhatsApp uses the branch's configured messaging provider;
email uses shop SMTP or the existing platform transport. Console-only mail
transport is rejected as a delivery configuration.

Both `api/server.js` and `api/shard.js` start a one-minute runner. The shared
server opens an explicit tenant context for each active database and skips
suspended tenants. Each run checks the persisted owner's active status,
role, outlet membership and Insights policy. Daily summaries cover yesterday;
weekly summaries cover the previous seven complete days in the selected timezone.
They use direct reports and spend no model tokens.

A due row is claimed atomically, preventing concurrent duplicate sends. Report
preparation failures retry after 15 minutes. Ambiguous deliveries or abandoned
claims are paused as `needs_review` rather than automatically sent again.
The UI shows status and delivery errors. Check the provider before replacing a
paused schedule. `POST /api/ask-posnic/schedules/run-due` remains available for
an authenticated owner's manual run.

## Release evidence

`api/tests/fixtures/ask-posnic-evaluation.json` contains 100 supported and
adversarial questions. The evaluation test requires at least 90 percent correct
tool/refusal routing. Focused service tests cover action-token scope and replay,
managed-credit reservation, knowledge extraction, schedules, permissions and
inventory-count drafts. The routing evaluation is **not** proof of 90 percent
correct sourced answers. That quality gate still needs a reviewed content set.

Validation on 1 October 2026:

- After coupon reporting and supplier-message drafts, the full `npm test --
  --runInBand` rerun passed 428 Jest suites (11,431 tests) and 9 native tests;
  2 existing suites/13 tests remain skipped. This run includes the current Ask
  Posnic database fixture, whose 30 native MongoDB cases pass independently.
  The run still reports pre-existing late Mongo connection diagnostics for the
  unavailable local test port 47017 and exits successfully. Evidence:
  `output/ask-posnic-api-validation-20261001.log`.

- The latest focused run passed 73 tests across 14 suites, covering routing,
  retrieval, credits, provider access, extraction, schedules and pricing.
  The real temporary MongoDB fixture now passes 32 concurrency,
  isolation, publication, delivery and credit checks, including paid period
  rollover, refunds, lost action acknowledgements, interrupted batch recovery
  outlet-timezone trend totals, commerce report isolation and sales-draft catalog
  validation. After these additions, 68 focused routing/quote/policy tests passed,
  plus 8 browser-logic tests for quotation pricing and fractional cart quantities.
- `npm run test:ask-posnic:smoke` passed with real authentication, routes,
  settings, knowledge retrieval, permission refusal, stock-count persistence,
  replay rejection, stale-inventory rejection and history permission revocation.
  It also checks scoped action recovery, a persisted campaign draft with no
  delivery, hourly sales totals, cashier financial refusal and exact-FAQ workflow
  guidance instead of unintended actions.
  It now also verifies all four commerce report routes and a real draft quotation
  with no stock or payment changes. Browser checks cover sales-draft review before
  confirmation, escaped item names and the Quotations handoff on desktop/mobile.
  The latest additions verify outlet assignments, mixed-currency isolation,
  revoked-outlet history redaction and recovery of a real two-supplier batch after
  an injected failure. The 26 database checks cover competing recovery reviews,
  concurrent confirmations and refusal while a worker may still be executing.
  A further 25 routing/policy/purchase-order tests passed.
  Desktop/mobile checks verify escaped outlet names, separate currency cards and
  recovery review before confirmation. Reopening review waits for the preceding
  modal and backdrop to close, including immediate recovery responses.
  Promotion and supplier-message additions passed 30 real MongoDB checks and 16
  focused routing/policy tests. The authenticated smoke covers the coupon-report
  permission gate and a real supplier-message save, replay refusal, creator-only
  listing and revoked access. Browser checks exercise the supplier form, review,
  confirmation, saved-message listing, copy action and escaped source text on
  desktop and mobile. The frontend build passed.
  The subsequent reorder addition passed 32 MongoDB checks, 16 routing/policy
  tests and the authenticated smoke, including changed-incoming-order refusal,
  server-derived quantities, a real PO draft, unchanged stock and session-access
  revocation. The routing fixture now matches all 100 questions; this remains a
  routing check, not a sourced-answer quality evaluation. The full-suite run above
  predates this reorder addition.
  The frontend build and desktop/mobile reorder review passed, including forwarding
  the selected planning days and requiring a separate confirmation before saving.
- `npm run test:ask-posnic:live` made a real Bedrock call through the authenticated
  Ask Posnic route using synthetic data and reconciled the managed reservation.
  This was rerun successfully after the retrieval and selected-model price changes.
- The frontend build passed; desktop and 390px mobile layouts were rendered
  using the shipped styles without horizontal page overflow.
- Intranet upload and AI pricing tests (6) and server syntax checks passed.
- Intranet preview route tests passed authentication, source visibility, limits
  and revision replacement. Browser checks exercised the real preview endpoint,
  editor/published isolation, unsupported questions, escaped text and desktop/
  390px mobile layouts without horizontal overflow or writes.
- The web-api suite passed all 507 tests, including actual signed renewal and
  refund events against a temporary MongoDB. No payment-provider charge occurred.
- Billing UI checks passed review-before-checkout, retry identity, confirmation
  before renewal cancellation, empty-catalog behavior and desktop/mobile layouts.
- The final full API command passed 428 Jest suites and 11,431 tests plus 9 native
  Node tests. Native `.test.cjs` files now run under Node instead of Jest, including
  in CI. Two existing suites and 13 tests remain skipped. This run includes the
  retrieval, trend and pricing changes before the later commerce/sales-draft
  additions, whose focused and database checks are listed above.
  Existing tests still attempt a missing local MongoDB on port 47017 after tests.
- Attribution validation passed.

Reproducible checks: `api/scripts/ask-posnic-smoke.js`,
`api/tests/fixtures/ask-posnic-database.cjs` and
`api/scripts/ask-posnic-ui-check.js`. The live smoke uses a temporary database
and performs one paid model request; it does not send messages or change shop
data. Set `AWS_PROFILE=posnic-admin` in the calling shell for the local live test.

AWS SSO profile `posnic-admin` was verified on 1 October 2026 against account
`<aws-account-id>` in `ap-south-1`. A controlled Bedrock Converse call through the
active `global.amazon.nova-2-lite-v1:0` inference profile returned the exact
expected response using 57 input tokens and 10 output tokens, with 937 ms
reported model latency. The base model ID does not support on-demand throughput
in this region; deployments must use the inference-profile ID.

The subsequent Lightsail runtime setup **did change AWS and the host**:

- Created dedicated IAM user `posnic-ask-bedrock` in account `<aws-account-id>` and
  inline policy `InvokeSelectedPosnicModel`. Its selected-model policy is in
  `api/infra/ask-posnic-bedrock-policy.json` and follows the
  [AWS global inference policy requirements](https://docs.aws.amazon.com/bedrock/latest/userguide/global-cross-region-inference.html).
- Installed one credential profile named `posnic-ask-bedrock` in the existing
  mode-600 credential file for `ubuntu` on `posnic-core-8gb` (`<posnic-egress-ip>`).
  The provisioning script passes the key over SSH input without displaying it
  or writing it locally, preserves existing profiles and refuses duplicate keys.
- The profile can invoke only the selected Nova inference profile from that
  host's IP. Policy simulation denied another source IP, another model and S3.
  A host IP change requires a reviewed policy update. Rotate the dedicated key
  through IAM and the host credential file; do not put it in tenant settings.
- The real adapter made successful synthetic Bedrock calls from that host:
  62 input tokens and 8 output tokens per probe. Validation dependencies live
  separately in `/home/ubuntu/.local/share/posnic-ai-validation`.

At application rollout set `POSNIC_MANAGED_AI_AWS_PROFILE=posnic-ask-bedrock`
on the POS service only. Do not set process-wide `AWS_PROFILE`: the dedicated
identity has no S3 permissions and must not replace credentials used by other
integrations. The Bedrock adapter applies this profile only to its own client.
The host's default Lightsail identity belongs to an AWS service account and was
not used for customer-account Bedrock access.

The application adapter and authenticated route have since also passed live
Bedrock tests. This does not mean the feature is deployed on production hosts.
Host Bedrock IAM access is verified. Approved prices and gateway test-mode acceptance,
managed allowance configuration, reachable Intranet
distribution and delivery settings still need rollout verification. No production
email/WhatsApp was sent as part of the tests.

Remaining roadmap implementation includes a broader held-out sourced-answer evaluation
and production rollout. Recovery for records without worker identity remains a
manual maintenance task. Promotion analysis currently covers recorded coupon
activity; other promotion types and attribution require suitable source data. Existing routing
tests are not a substitute for those features or for production acceptance.

## API

- `GET /api/ask-posnic/status`
- `POST /api/ask-posnic/ask`
- `GET|POST /api/ask-posnic/documents`
- `PATCH /api/ask-posnic/documents/:id/status`
- `POST /api/ask-posnic/documents/import-bundle`
- `GET|DELETE /api/ask-posnic/history`
- `POST /api/ask-posnic/feedback`
- `GET /api/ask-posnic/audit` (owner only)
- `POST /api/ask-posnic/actions/draft`
- `POST /api/ask-posnic/actions/confirm`
- `GET /api/ask-posnic/actions/:id`
- `POST /api/ask-posnic/actions/:id/resume`
- `GET /api/ask-posnic/supplier-messages`
- `GET|PUT /api/ask-posnic/preferences`
- `GET|POST /api/ask-posnic/schedules`
- `DELETE /api/ask-posnic/schedules/:id`
- `POST /api/ask-posnic/schedules/run-due`

Before release, run the focused Ask Posnic tests, the frontend build, the full
API suite, and `npm run check:attribution`.

The knowledge/inventory update passed 33 real MongoDB cases, authenticated API
smoke, four Intranet preview/upload checks, and desktop/mobile checks. The
frontend build is `5cb52b6d0d9429cb`. The full API rerun passed 429 suites and
11,436 tests plus nine native tests (two suites/13 tests remain skipped); its
existing late Mongo connection/open-handle diagnostics still appear despite
exit zero. The final table-definition ranking adjustment was checked afterward
in 11 focused retrieval/evidence tests and the Intranet preview test. Attribution
and whitespace checks passed. No production application was deployed by this
checkpoint.

The final retrieval/inventory implementation also passed the authenticated
`--live` smoke using AWS SSO profile `posnic-admin`: real Bedrock generation,
valid source citations and managed-credit reconciliation succeeded against an
isolated synthetic database. No customer data or external messaging was used.

## Community own-key semantic retrieval — implementation checkpoint

Open **Ask Posnic → Knowledge and controls**, enable **Search by meaning with my
OpenAI key**, and save a monthly search budget per outlet. The existing AI settings
page holds the OpenAI key; this page does not duplicate that secret. The option is
off by default and requires the existing AI feature and Ask Posnic Help to be on.
The configured budget applies separately in each outlet's currency. Indexing is
charged to the outlet that published the source; queries to the requesting outlet.
The owner status shows remaining estimated search budget and unsettled calls.

The adapter uses `text-embedding-3-small`, 256 float dimensions, and the fixed
OpenAI embeddings endpoint, with a 30-second timeout and no automatic retry or
redirect. Published source passages and help queries go to that provider. Vectors
stay in local MongoDB, so this needs neither an AWS account nor a hosted vector
database. The published input rate is $0.02 per million tokens; see the
[official model documentation](https://developers.openai.com/api/docs/models/text-embedding-3-small)
and [embeddings guide](https://developers.openai.com/api/docs/guides/embeddings).
Answer generation is separately billed by the selected text model.

`ask_posnic_embedding_budget` atomically reserves estimated spend before each
request and settles reported tokens afterward. Concurrent requests cannot exceed
this separate embedding allowance at the configured rate. A conservative 8192-token
reservation may prevent a call when only a very small balance remains. Timeouts,
unknown responses and interrupted calls keep their holds; elapsed time never
authorizes repayment or another embedding attempt. Known rejected requests release
their holds. At most 100 unsettled requests can accumulate per outlet/month.
The existing overall AI cap is also checked, but its check is not an atomic shared
reservation across text, voice and embeddings; concurrent use can exceed that
overall estimate. Provider invoices remain authoritative. Display metering now
retains sub-minor-unit fractions instead of rounding each tiny charge to zero,
and background metering uses the explicit license context.

The worker processes at most eight passages per tick. Content hashes reuse
unchanged embeddings across immutable document revisions, within the same shop
and database. Unreferenced completed vectors become eligible for bounded cleanup
after seven days; processing and uncertain records remain for operator review.
Only currently published customer-safe documents of the matching generation are
eligible. Private-credential questions bypass retrieval; tenant checks and final
publication checks prevent cross-shop or retired-source matches. Exact FAQ answers
continue to bypass paid retrieval.

Local cosine search is limited to 5,000 published passages and keeps ten candidates
before existing hybrid ranking. Above the limit, Help falls back to keyword search
without a query embedding charge. The initial distance cutoff of 0.6 needs broader
quality calibration; synthetic vectors verify behavior, not model quality. Settings
for other embedding providers and larger indexes are not implemented.

Validation on 2026-10-01: 18 real MongoDB tests cover concurrency, holds, cache reuse,
source changes, privacy, scope, capacity and metering. The 5,000-passage synthetic
scan took approximately 160–182 ms on the development machine; this excludes network
and embedding latency. The authenticated app smoke passes preference authorization,
indexing, query routing, cited generation and owner usage with synthetic OpenAI
responses. A real customer-key/provider acceptance call has not been made.
The full API run passed 433 suites / 11,446 tests plus nine native tests, with
two suites / 13 tests skipped and the existing late Mongo/open-handle diagnostics.
The final currency-scope, cache-cleanup and authenticated smoke checks passed afterward.
Frontend build `baffdb6dbc0f8add` and desktop/mobile checks passed, including saving
the new controls. Production application rollout, broader sourced/multilingual
evaluation and paid-plan activation remain open. The recovery update below
supersedes the earlier recovery-tooling gap for new records.

## Interrupted work and operator recovery

The Ask Posnic owner page now has **Processing and review**, summarizing active
or interrupted indexing, action drafts, scheduled reports and AI reservations.
It exposes neither process identities nor another user's draft payload. An
original action author can reopen its status and review remaining work. Recovery
keeps the original deterministic business-record IDs for every action type,
including an interrupted action that saved no records. Confirmation still checks
current permissions and inventory/catalog state; opening review writes no business
record. A late Mongo acknowledgement cannot create a second record under a new ID.

New executions record host, PID, process namespace and a per-process identity.
The recovery utility must run on that worker's host and, on Linux, in its PID
namespace. Hosts must have distinct hostnames. The operator must stop the recorded
worker first; the tool checks process absence with signal 0 and treats access
errors, live/reused PIDs, foreign namespaces and missing identity as unverified.
It does not kill processes. A timeout, old timestamp, PID file or elapsed lease
is not accepted as proof. Older records lacking the identity cannot be unlocked
by this utility; inspect them during controlled maintenance instead.

From the repository root, with the existing approved `MONGODB_URI` in the operator
environment, inspect one explicit database/shop/outlet:

```text
node api/scripts/recover-ask-posnic.js inspect --database SHOP_DB --license LICENSE_ID --branch BRANCH_ID
node api/scripts/recover-ask-posnic.js action --database SHOP_DB --license LICENSE_ID --branch BRANCH_ID --id ACTION_ID --operator "Human maintainer"
```

Inspection and previews are read-only. Add `--apply` only after checking the
preview. Action recovery reads stored outputs, marks an entirely saved action
completed, or makes its remaining work available for a new user review. The CLI
does not execute a sale, purchase order, campaign, count or supplier message.

An uncertain provider call remains reserved until a human operator verifies its
outcome against provider records. Create an evidence JSON file with `outcome`
(`completed` or `not_accepted`), `provider_reference`, `verified_at` (ISO time), and,
for completed model calls, integer `tokens_in` and `tokens_out`. Use the actual
provider reference and counts; absence of a response is not evidence of rejection.
The tool records the human operator, reference, time and evidence hash. It validates
the supplied evidence's format; it cannot independently prove the provider's
statement or infer charges from an aggregate invoice. Unknown outcomes stay held.

```text
node api/scripts/recover-ask-posnic.js hold --database SHOP_DB --license LICENSE_ID --branch BRANCH_ID --engine managed --id RESERVATION_ID --operator "Human maintainer" --evidence provider-review.json
```

Use `--engine own_key` for local embedding reservations. Settlement uses the held
price/currency snapshot, updates cost and evidence in the same atomic ledger write,
and projects the recovered charge into the usage display with a deterministic ID.
Repeated projection cannot double-count. If the result says
`usage_projection_pending: true`, repair that display independently:

```text
node api/scripts/recover-ask-posnic.js project-usage --database SHOP_DB --license LICENSE_ID --branch BRANCH_ID --engine managed --id RESERVATION_ID --operator "Human maintainer" --apply
```

Restart indexing only after its associated provider reservations have been
resolved. The preview reports that missing embeddings may incur a new charge.
Applying requires `--rebuild-missing` as well as `--apply`; existing saved vectors
are still reused. The tool refuses cache claims owned by another live worker.

```text
node api/scripts/recover-ask-posnic.js index --database SHOP_DB --license LICENSE_ID --branch BRANCH_ID --engine own_key --id DOCUMENT_ID --operator "Human maintainer"
```

Scheduled delivery now retains expired execution claims while pausing the schedule.
The worker checks its claim and enabled state immediately before sending, and
its final writes cannot overwrite a replacement claim. Ambiguous schedules cannot
be edited, deleted or re-enabled until reviewed. For a caught terminal failure,
no worker remains in progress; an abandoned running claim still requires verified
process termination. Use the same evidence fields to record provider acceptance
or rejection with the `schedule` command, which keeps the schedule paused and
advances past the interrupted slot without sending anything:

```text
node api/scripts/recover-ask-posnic.js schedule --database SHOP_DB --license LICENSE_ID --branch BRANCH_ID --id SCHEDULE_ID --operator "Human maintainer" --evidence delivery-review.json
```

After applying that review, the owner can choose **Resume future deliveries** on
Ask Posnic. This schedules the next future occurrence; it does not resend the
ambiguous delivery. Recovery is also recorded on the durable source record, so a
separate audit-display failure cannot erase it.

Validation on 2026-10-01: 15 real MongoDB/process/CLI recovery tests passed, covering
live-worker refusal, an actually exited child process, concurrent settlement,
idempotent usage projection, scoped actions, zero-output action recovery, paused
delivery and protection of unresolved delivery evidence. The full API run passed
434 suites / 11,447 tests plus nine native tests, with two suites / 13 tests skipped;
the final process-namespace and schedule-edit protections were checked afterward.
Existing late Mongo/open-handle diagnostics remain. Authenticated app smoke passed
owner-only recovery summaries, reservation metadata redaction, and reviewed-only
schedule resumption into a future slot. Frontend build `11a5c8a1970118fc` and
desktop/mobile recovery controls passed. A live `posnic-admin` SSO smoke also passed
Bedrock generation, Titan embeddings, S3 vector retrieval and managed-credit
reconciliation; the index contained zero test vectors after cleanup. No production
worker was stopped, no live customer reservation was adjusted, and no external
recipient received a message during this validation.

## Grounded answers and development evaluation

Generated help now carries structured statements with exact quotations from
numbered retrieved passages. The server rejects invented quotations, invalid
source numbers and model-supplied citation markers. A second model request checks
every statement against the full retrieved passages, including quoted statements
whose wording might omit an important condition. Only accepted statements receive
server-built citations. Generation and checking each use the existing provider,
budget and usage meter; the owner usage screen identifies both charges separately.
Exact FAQ answers and direct reports still bypass these model calls.

A failed check falls back to labelled source passages. Unsupported questions can
receive a refusal. The controller rechecks source publication, revision and content
after generation; a retired or changed source invalidates the generated answer.
The same retrieval kernel is deployed in Intranet preview and POS. It ranks focused
passages, retains the full stored chunk for contextual restrictions, and rewards
adjacent question terms so a matching restriction can outrank scattered terms in
another workflow.

These checks reduce errors; they do not prove factual correctness. A baseline live
answer incorrectly transferred a walk-in checkout exception to a credit-sale
return, and the model checker accepted it. Retrieval now places the actual credit
return restriction first, with a source-corpus regression assertion. Prompts also
require the same operation and subject and reject transferred exceptions. Keep
independent source review and the customer pilot as release requirements.

`api/tests/fixtures/ask-posnic-answer-cases.json` is a separate 100-question
development benchmark: 80 supported cases and 20 unsupported/adversarial cases,
drawn from the hash-checked 237-chapter manual snapshot. Expected quotations must
exist in their recorded source. It includes public product guidance only, never
shop records or customer credentials. Run from the repository root:

```text
node api/scripts/evaluate-ask-posnic-answers.js
node api/scripts/run-ask-posnic-live.js --answers
```

The live command uses the authenticated AWS CLI profile (default `posnic-admin`),
checks the expected account, and passes temporary credentials only in memory. It
uses isolated MongoDB, synthetic tenant/outlet IDs, a USD 2 managed allowance and
no billing endpoint. Results, full public-source model traces, code/fixture hashes,
fallbacks and reconciled estimated usage are written under `output/`. Three
consecutive provider/allowance failures stop the run without retrying paid calls.
The benchmark exercises lexical retrieval and generation, not semantic retrieval,
multilingual quality or independent human acceptance. Expected-evidence recall
measures exact quotation retrieval; generated-answer count is not a correctness
score. Do not relabel either metric as answer accuracy.

Final checkpoint on 2026-10-01: expected source-quotation recall was 73/80 (91.25%).
The live Nova 2 Lite run produced 73 checked generated answers for the 80 supported
questions; the other seven used fallback handling. None of the 20 unsupported
questions produced generated claims. The credit-return question returned the exact
restriction that its transaction must be completed first. Estimated managed usage
was USD 0.09828407 across 158 reconciled provider calls, with zero outstanding
reserved credits. This is token-based estimated cost, not an AWS invoice. Reports:
`output/ask-posnic-answers-live.json` and `output/ask-posnic-answers-offline.json`.
Earlier baseline reports are retained separately for comparison. Source review
still found unnecessary adjacent advice and a permission qualifier error: the role
answer changed "can ... still need manager approval" into an unconditional
requirement. The model checker accepted that generalization. The independent
correctness and relevance release gate remains open, including this regression;
these generated answers are not ready to be declared production quality.

The full API suite passed 435 suites / 11,466 tests plus nine native checks, with
two suites / 13 tests skipped and existing late Mongo/open-handle diagnostics.
The final phrase-ranking/prompt changes then passed 30 focused tests and the
authenticated application smoke, including retiring a source during verification.
The live AWS semantic application test passed Bedrock generation, Titan embeddings,
vector retrieval, authorization, confirmed actions and credit reconciliation. The
S3 vector index contained zero test vectors after cleanup. Frontend build
`b8918b8c6973de64`, desktop/mobile controls, Intranet preview, attribution and whitespace
checks passed. Production application rollout, real own-key acceptance, delivery
acceptance, billing activation and independent multilingual/customer evaluation
remain separate outstanding work.

### Conditional permissions and neighbouring context follow-up

The recorded role-permission generalization is now rejected before a second paid
call. An English wording guard rejects tentative/recommended evidence strengthened
into unconditional requirements and explicit universal claims unsupported by quoted
universal wording. Negated guarantees and qualified permission wording remain
eligible for verification. This deliberately conservative guard can reject valid
paraphrases, and it is not a parser or a multilingual truth test. Rejected answers
use the existing source-excerpt fallback; the product must not claim guaranteed
factual correctness.

Lexical, managed semantic and own-key semantic retrieval now supply the preceding
and following stored chunks as bounded context. Overlapping chunks are joined
without repeating text; independent custom chunks are separated explicitly. The
indexed anchor, embedding keys and publication generation remain unchanged, so
this requires no embedding rebuild. Both model stages and quote validation use
the expanded context. After generation, the controller rechecks this neighbouring
text as well as the anchor: an adjacent edit invalidates the response even when
the cited chunk itself is unchanged. Citation buttons still open the full approved
document. This fixes the observed mid-row cutoff at "Discount change | Manager
approval" without pretending that three chunks always include an entire document.

The model verdict now requires four actual boolean approvals: factual support,
question relevance, preserved conditions, and preserved modality. Missing fields,
string booleans, duplicate entries or any negative result reject the draft.

Validation on 2026-10-01:

- All 23 controlled live condition checks passed: 12 invalid candidates rejected
  and 11 valid candidates accepted, including the recorded permission regression
  and a Tamil pair. These are fixed candidate answers, with real Bedrock checking;
  they are not an end-to-end generation accuracy score. Sixteen paid checks cost
  an estimated USD 0.00566345, with no unresolved reservation.
- The 100-question live generation run retrieved the expected quotation in the
  anchor for 73/80 cases and in expanded context for 75/80. It produced 70 accepted
  generated answers and no generated claims for the 20 unsupported cases, at an
  estimated USD 0.16120701 across 157 reconciled provider calls. Its code hash
  predates the final universal-wording guard. Replaying those exact recorded
  provider responses through the final validation retained 68 generated answers;
  two additional answers fell back. Replay made no provider calls and is labelled
  separately in `output/ask-posnic-answers-replay.json`. The permission regression
  fell back instead of returning the unconditional rule. Correctly sourced answers
  can still fall back when a model alters a verbatim table quotation.
- The full API run passed 435 suites / 11,478 tests plus nine native checks, with
  two suites / 13 tests skipped and the existing Mongo/open-handle diagnostics.
  The final guard then passed 32 focused unit tests. Database/own-key regression
  checks, the neighbour-edit race test, authenticated synthetic-provider smoke,
  Intranet preview and live AWS semantic/application smoke passed. No frontend
  assets changed in this follow-up.

Reproduce the targeted check and offline replay from the repository root:

```text
node api/scripts/build-ask-posnic-condition-cases.js
node api/scripts/run-ask-posnic-live.js --conditions
node api/scripts/replay-ask-posnic-answers.js
```

Reports record fixture/code hashes. Replay requires matching retrieval and question
fixtures and refuses unrecorded provider calls; it is not a new live benchmark.
The broader customer/multilingual pilot, production rollout and paid-plan/delivery
acceptance remain open. The specific role-permission regression above is covered;
the result does not establish that every possible qualifier error is solved.

## Current-main integration checkpoint

The initial candidate was subsequently rebased onto main commit
`813fd1996d8f542588b641bf3c51ea25972b688c`. The current validated code commit is
`099c4accfd933b5a605ebaa10df2ce73ba8d6686` on
`codex/ask-posnic-release-20261001`. This supersedes the earlier base candidate
for release integration. The newer business-notification worker and local-only
sync entries were preserved, and main's archive builder was retained.

Fresh dependency installation and the full API suite passed: 463 suites and
11,691 tests, with two suites and 13 tests skipped. Lint on the 87 changed API
JavaScript files reported zero errors and 90 warnings. Frontend build
`47eb95ba97f7c4f1`, desktop/mobile checks, fractional sale-draft handling,
authenticated synthetic-provider smoke, attribution and whitespace checks passed.

The updated archive `output/ask-posnic-main-candidate-validation-20261001.tgz`
has SHA-256
`5117912e500bd2332c361e95e5e810a8477551acbf3cb041283ab9c48ddbf040`.
It was verified and installed separately at
`/home/ubuntu/.local/share/posnic-ai-validation/releases/ask-posnic-5117912e`.
Its authenticated live AWS smoke passed generation, semantic indexing/retrieval,
confirmed actions, permission checks and credit reconciliation with synthetic data.
This is host validation, not production activation. The POS candidate is ready
for coordinated review; Intranet, billing API, Cloud account UI, production
configuration, payment/delivery acceptance and customer quality acceptance remain.

## Develop release integration and language support

The release branch now targets `develop` at `d9893f32703ced6489c99752c014cdfa20fc519f`.
The full API suite passed 463 suites / 11,694 tests (13 skipped). Generated API
documentation describes all 799 routes. New Ask Posnic and stock-count screens
use Posnic translation keys; 148 new strings were added to 17 established packs.
Existing translations and coverage requirements were preserved. Translation drafts
were prepared through AWS services and checked for structure and application behavior;
these checks do not constitute independent linguistic review.

The shipped translation runtime is exercised with Tamil, Dutch and Arabic on a
mobile viewport, including question routing, unchanged form values, restoration to
English and safe rendering of translated table headings. Longer translated settings
headings now wrap without making the screen scroll horizontally. The document-preview
browser check accepts an explicit Intranet checkout path for validating its release
candidate. Production account identifiers in this guide use placeholders; deployment
operators obtain actual values from the private configuration and validation records.

The Intranet candidate has a database-tested publication workflow: review before
publishing, immutable source revisions, atomic revision numbering, a unique published
revision per series, explicit export fields and conflict responses for concurrent
changes. The full Intranet suite passed 501 tests with seven environment-dependent
checks skipped, plus the real preview endpoint and desktop/mobile browser checks.
A publication interrupted between retirement and replacement can leave a series
unpublished; the administrator must inspect and publish the intended revision.

These are release candidates. Production activation, approved pricing,
payment/delivery acceptance and independent answer-quality acceptance remain open.

Final local release checks passed after the translation/layout changes: 3,655 root
tests (five skipped), frontend build `848f64f8731f0e29`, 32 grounding tests,
translated desktop/mobile interaction checks, Intranet preview checks, generated API
docs, attribution and whitespace checks. Changed API scripts/services have zero lint
errors (five existing console warnings). The root suite ran after the build completed;
its signed-asset rollback drill passed against the final generated frontend.

The coordinated billing API and Cloud account UI candidates now pass 610 billing
tests, the public account build and desktop/mobile interactions. Owners select
their shop explicitly; payment retry identities remain separate per shop. Inactive
Cloud shops allow renewal cancellation while blocking new purchases.

Run the cross-service check with `POSNIC_INTRANET_ROOT` and `POSNIC_WEB_API_ROOT`
pointing to the matching release checkouts:

```text
node api/scripts/ask-posnic-cloud-contract-check.js
```

It mounts the actual Intranet and billing modules on loopback with temporary
databases. The check verifies reviewed publication, POS retrieval and withdrawal,
captured-payment grants, usage settlement and refund revocation. Unreviewed and
internal material stays out of the shop. It rejects external requests and makes
no model or payment-provider calls. This establishes the application contracts;
production TLS, gateway test-mode lifecycle and live tenant acceptance remain
separate deployment checks.
