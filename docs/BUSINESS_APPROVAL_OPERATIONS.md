# Unresolved Business approval — operator procedure

Status: reviewable pilot procedure. It has not been exercised against a deployed
Cloud/Community environment or a physical till. Remote approval remains disabled
until the operator rehearsal and the other release gates pass.

## Cashier response

When the till displays **Checking the sale receipt**, leave that bill pending.
Use **Check status** and inspect saved sales for that bill. Do not charge again,
create a replacement sale, obtain a second approval, or use a manager PIN to
bypass the unresolved execution. Approval on the phone confirms the owner's
decision; it does not confirm that the till saved the sale.

If the till offers **Recover saved bill**, it has verified a matching local
receipt. Use that action to recover the original operation. A locally saved sale
can still be waiting for Cloud confirmation. Do not collect payment again merely
because the phone still says applying.

If no receipt is confirmed, ask the owner/support operator to investigate the
original till, branch, cashier, approximate time and bill amount. Keep these
business details in the controlled support channel. Do not send passwords,
session tokens or an unrestricted database export. On the originating till, open the owner-approval dialog and choose **Earlier
checkout attempts** to review durable execution references for the signed-in
cashier and current branch. This works without the old browser session. The
review shows the request reference and a sale ID only when locally verified;
it does not offer another save or cancel action. Keep the original POS session
available when possible. With request recovery supported, the list also finds
unexpired pending/approved Community requests and Cloud create commands retained
for seven days. A Cloud row without an acknowledged request ID keeps its original
operation reference and an unknown outcome; Check status does not resend it.
Older servers still list claims only. This is not a cross-cashier support queue.

## Owner/support investigation

Use authorized read-only access on the originating desktop and, for Cloud mode,
the matching tenant. Scope every lookup by business and branch; do not infer a
match from amount or time alone. Locate the original `business_decisions` record
and the desktop `business_decision_local` claim command. Record the request ID,
operation ID and observed state in the incident. Inspect execution identifiers
only in the restricted investigation, not in ordinary mobile messages.

The authoritative receipt is `sales.business_decision_receipt`, version 1. A
candidate sale must match the license, branch, billing transaction, decision,
execution, revision, originating device, requester and approver, plus currency,
precision and approved/applied amounts. The full acceptance predicate lives in
`business-decision-ledger.js` under `acknowledge`; a sale ID alone is insufficient.
Do not write a receipt, edit the ledger state or clear a consumed claim by hand.

| Evidence                                                          | Interpretation and next action                                                                                                                              |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Matching local receipt; Cloud receipt or acknowledgement absent   | Sale is locally saved. Restore the existing sync/transport path and let receipt-only recovery retry. Preserve the original sale and operation.              |
| Matching receipt and ledger applied                               | Refresh the cashier dialog and recover the original saved bill. Verify the ordinary receipt/payment display before closing the incident.                    |
| Claim consumed or ledger applying; no matching local receipt      | Outcome remains unknown. Preserve the claim and collect crash/storage/sync evidence. Escalate; missing evidence does not prove no financial write occurred. |
| Conflicting receipt, scope or amounts; multiple candidate records | Stop automated conclusions for the incident and escalate the discrepancy. Do not choose the closest amount or overwrite evidence.                           |
| Pending/approved, checkout not started, no consumed claim         | Normal dialog decision/cancellation controls apply after a fresh authenticated status read. This is distinct from an already-started execution.             |

Recovery examines at most four due commands per pass and retries on its existing
schedule. `receipt_not_found`, `waiting_for_sync` and `confirmed` are local
recovery observations, not interchangeable sale outcomes. A transport error is
not permission to restart checkout. The recovery worker only looks up receipts
and acknowledges them; it cannot create a sale or issue a second execution claim.

## Pilot rehearsal and completion evidence

Run both Community and Cloud rehearsals with controlled accounts and payments.
Capture the original request/operation, initial and final ledger state, immutable
receipt identity, and cashier/phone observations for each scenario:

1. Lose the checkout response after the sale is persisted. Recovery must find the
   same sale; sales/payment counts and amounts must not increase on retry.
2. Delay Cloud sales sync after local persistence. The till must distinguish
   saved locally from confirmed remotely; eventual acknowledgement must refer to
   that exact receipt.
3. Interrupt execution after permit consumption but before any verified receipt.
   The UI must withhold another save and the incident must remain unresolved.
4. Remove approver access after execution starts. Receipt reconciliation remains
   possible without granting new execution authority.
5. Close/reopen the dialog, restart the app and change cashier. Verify scoped
   recovery visibility, including durable execution references, unexpired Community
   requests and retained Cloud commands before acknowledgement. An unknown
   operation must remain read-only and must never create a replacement sale.

The first two scenarios have local integration coverage. This document does not
replace deployed fault injection or physical acceptance. No supported operator
command currently proves a missing receipt means a failed sale, releases an
uncertain execution, or safely authorizes a replacement. A cross-cashier incident
queue, explicit escalation ownership and a reviewed resolution policy for that
case remain production gates. Do not mark an incident resolved solely because a
request expired or a timeout elapsed.

## Implementation references

- [Cashier state and verified local receipt](../api/src/services/business-checkout-decisions.js)
- [Receipt-only recovery](../api/src/services/business-decision-recovery.js)
- [Authoritative acknowledgement](../api/src/services/business-decision-ledger.js)
- [Cashier dialog](../frontend/static/script/js/modules/js/business-approval.js)
- [Checkout and transport qualification](BUSINESS_DEVICE_DECISIONS.md)
