# Business discount decision ledger

Status: disabled unless `POSNIC_BUSINESS_DECISIONS=1`. The ledger, authenticated mobile review, till/controller and Cloud/Community device transport are implemented; see [current device integration evidence](BUSINESS_DEVICE_DECISIONS.md). This document also preserves earlier design-stage integration notes below. Those notes are not the current completion checklist. Deployed checkout qualification and the [unresolved-execution operator procedure](BUSINESS_APPROVAL_OPERATIONS.md) remain release gates. Existing local manager PIN approval remains unchanged.

## Authenticated review

`GET /api/business/v1/decisions`, `GET /decisions/:id` and `POST /decisions/:id` use the dedicated Business session. Every call reads current account state, branch access and permission. Owner/admin accounts qualify; other staff require both dashboard financial read permissions and the explicit `access.pos.discount_approve_remote` bit. Ordinary till discount permission and a manager role name do not grant remote approval. Staff discount ceilings still apply. The permission appears on the existing role/user permission pages.

Lists use an ObjectId cursor, at most 50 records, current license/branches, and a bounded database query. History includes expired requests; applying records remain open until receipt reconciliation. DTOs expose requester/approver display names, exact summary amounts, state and timeline, not source device identifiers, session IDs, execution IDs or revision hashes. Approvals cannot create a request or claim execution through these routes.

A decision needs password verification less than five minutes old, from the same account and business. Normal Cloud browser consent is not evidence of a fresh password. Cloud step-up asks for a password with a separate account attempt limit; its original verification timestamp crosses the authenticated Gateway control channel. Community records the actual password-verification time. Neither exchanging nor rotating a token refreshes this time. A step-up session expires after ten minutes.

The phone may send a temporary same-account `confirmationToken` alongside its original session. The token is never persisted in the ledger. A successful decision records the original phone session and verified password time, and promotes that same time on the phone session. The temporary confirmation session can then be revoked. Accepted identical retries remain idempotent. A new execution claim rechecks the original approver session, branch and ceiling; removing access or revoking that session prevents application. Reconciliation of an already-started execution remains possible after revocation and never grants a second execution.

## Authority and binding

`api/src/services/business-decision-ledger.js` stores one immutable request per license, originating device, operation and bill revision. `revisionHash` canonically hashes the complete authoritative sale intent. Callers must remove transport credentials, then include every price-, item-, quantity-, customer-, tender-, register- and policy-relevant field. Hashing only the proposed discount or the client-displayed total is insufficient.

The source identity comes from an authenticated till and its current branch/license/cashier scope. It must never be copied from a mobile request body. The preview must be derived by the same pricing authority that will save the sale. The current summary contract describes the total before and after the manual discount in exact minor units; support only a pricing case that can prove that reconciliation. Other discount cases stay unavailable until their calculation contract is verified.

Requests live for five minutes. Approve and decline use a revision check and a unique decision ID. A repeated accepted decision returns its actual state without appending another event; a changed replay fails. The ledger rejects self-approval and missing branch/discount capability. Production callers must re-read current identity, ACL, limits and step-up proof before supplying the context. The ledger does not authenticate an arbitrary context object.

## Application and recovery

States progress from pending to approved or declined, then approved to applying to applied. Pending/approved requests can be cancelled. Expiry prevents a new decision or application claim. Approval alone never means a discount reached checkout.

Only the originating source may claim. It must recompute the complete bill revision immediately before claiming. A fresh successful claim returns `executionPermit: start`. A retry of the same execution returns `reconcile`, or `complete` after a stored receipt. Reconcile permits a lookup of a durable sale receipt only: it is not permission to run the sale writer again. A different execution cannot claim the same decision. There is deliberately no timed lease that releases an uncertain execution for a second attempt.

The internal `beforeCommit` hook now persists a typed, immutable receipt with the authoritative sale. It includes the decision/revision/execution IDs, source, approver, currency and approved/applied amounts. The hook receives the prices actually used by that write, so it must bind with `discountIntentFromPricing` rather than run another pricing query that could observe a different product revision. Denied commit checks restore stock reservations. Only the server hook can populate the receipt; the normal sale payload is not copied into it.

`acknowledge` verifies the persisted receipt against the complete ledger scope, operation, revision, execution, approver and exact amounts. A bare sale ID or a mismatched amount cannot mark the decision applied. If the process dies after saving the sale, a reconciliation worker can complete the ledger from that receipt. If the result is unknown, display waiting for till confirmation and preserve the record; do not guess applied or automatically reissue execution. Database integration tests exercise the actual Mongo/Mongoose write and a lost-response recovery, including protection against nested receipt updates.

The state change and bounded audit timeline are in one Mongo document, so standalone Community databases do not need replica-set transactions for this ledger. No TTL removes decision audit history. A retention/export policy is still required before production enablement. Generic collection synchronization excludes `business_decisions`.

## Remaining integration gates

- `sale.service.previewSale` reuses the checkout line/tax engine and extracted `sale-header` calculation, stopping before numbering, sale, stock, payment and kitchen writes. Its register check does not acquire a legacy device lock. `prepareDiscountIntent` binds this preview and the complete request. The first supported contract is a paid new sale, at most 100 lines, bill-level discount, two-decimal currency, without coupon/loyalty/tip/partial-payment or manual line-discount combinations. Summary amounts include an explicit rounding adjustment. Other currency precisions and combinations require their own reconciliation fixtures before enablement.
- Wire the cashier/controller to the authenticated request and commit hook and add automatic recovery lookup. Audit update/held-sale paths separately; do not expose them through the first create-sale-only remote operation.
- Bind desktop request upload and decision download to the authenticated device, branch, tenant and cashier, with a durable local outbox. Community uses its authoritative local API; Cloud uses a purpose-built Gateway protocol, not generic sales sync.
- The authenticated facade now re-reads approver status, branch membership, discount ceiling and recent step-up evidence; the till bridge must call that facade for a new execution claim. Existing stateless local manager tokens are not remote decision proof.
- Connect the companion mobile review/confirmation screens, add safe notification targeting and cashier fallback, and verify expiry/cancellation/conflict handling across the device transport.
- Verify two devices/approvers, a changed bill, dropped acceptance response, crash after sale insert, failure before insert, revoked ACL, replay, disconnected till, duplicate billing transaction and eventual applied acknowledgement against actual checkout.

Local ledger and authenticated-route tests use real Mongo, actual Business sessions, branch/permission changes and password verification. Actual sale-writer tests cover pricing and immutable receipts. They do not yet prove the complete cashier-to-phone-to-till transport or production deployment.
