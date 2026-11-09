# Staff order price and guest recovery

## Reported failures

Azure Tech reported two separate blocked Captain orders on 9 November 2026:
Fresh Fruit Juice was rejected by the selling-channel price comparison, and
an order without guests could only be retried without supplying the missing
count. The screenshots do not establish the phone's submitted juice price.

## Price authority

For authenticated staff orders, fixed-price new lines use server catalogue,
channel and modifier pricing. A stale client quote is not a reason to reject
the order. Existing staff order lines retain their stored agreed price when
edited, increased or billed. The trusted staff context and stored tableside
channel select this policy; a request-body flag cannot select it.

Public checkout still validates submitted prices. Variable and quick items
still require their entered prices. Taxes, discounts and modifiers remain
server calculated. This change does not enable counter price overrides.

## Guest recovery

The companion Captain change allows staff to enter the required guest count
on an attention order, persist the corrected body, and retry the same durable
order identifier. Failed local storage must prevent sending. A network failure
retains the corrected order for another retry. It does not disable the branch's
guest requirement or invent a guest count.

## Synchronization and rollout

No collection, field or sync transport is introduced. Existing branch settings
and item prices are authoritative on the installation accepting the order;
sales persist the agreed pricing snapshot and person_count. POS declares sales
and items branch scoped and branches shared. The separately delivered Gateway
and agent already include all three collections (sales realtime; items and
branches batch). No Gateway or agent source is included in this change.

The phone queue remains local until the selected authorized server accepts the
order. Its ownership, idempotency key and retry checks remain intact. Accepted
sales continue on the existing sales lane; no print or payment command is
replayed by this change. The same API fix is needed on cloud and local tills.
Install the API correction first, then the companion Captain build. An APK
alone cannot change an old till's price rejection.

Local regression coverage checks catalogue authority, tax-inclusive and
exclusive prices, modifiers, discounts, stored prices, public rejection and
guest correction using the same idempotency key without duplicate sales.
Physical phone/till operation and cross-installation sync delivery must still
be checked on the target installation; matching manifests are not live delivery
verification.
