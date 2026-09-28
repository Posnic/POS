# Business close-triggered summaries

Status: source audit and bounded close-fact reader implemented locally. No close-trigger setting or
delivery is enabled by this branch yet. Fixed-time daily summaries continue to
use their existing contract.

## Verified source

`RegisterRepository.registercloseUpdate` atomically changes a scoped
`cashregister` document from `Opened` to `Closed` and writes
`register_closedate`. It requires branch/license membership and the session
owner/device, with the existing manager override. The same update stores the
closing operator and available cash variance. A repeated close cannot change a
closed document through that path. Opening a new session creates a new document;
`register_id` names the physical register while `_id` identifies the session.

`cashregister` is already branch-scoped sync data in POS and Gateway and is in the
agent's critical push order. Register-close facts therefore have a durable
source without a notification network call in checkout. A cloud copy can still
be delayed or incomplete. Audit logs are supplementary, not the delivery source:
the close controller deliberately tolerates failure to record an audit entry.

There is no separate restaurant-wide operating-session close record in the
audited API. Closing one register does not prove that the restaurant closed.
The first supported trigger must explicitly say **After a register session
closes**, identify that register, and avoid a restaurant-wide closure claim.
Automatic branch closure inferred from an empty open-register query would be
unsafe when another till has not synced.

## Contract and delivery plan

- Preserve the session document ID, physical register ID/name, opening and closing
  instants, branch scope and source revision identity. A reopened or changed
  source invalidates queued delivery. Unknown or malformed close facts are not
  inferred from inactivity, the wall clock or an empty sale list.
- Wait ten minutes after the confirmed source close before attempting a digest.
  This is a synchronization grace period, not proof of completeness. Respect the
  branch timezone and configured quiet hours; bound late delivery so historical
  imports do not flood the owner.
- Keep a separate versioned schedule preference and negotiate its response shape.
  Existing daily clients must not receive unknown fields or accidentally reset a
  newer schedule. Settings belong on the branch notification page.
- Prepare financial data on the assigned desktop and read only bounded prepared
  results on the server. Existing version-2 summaries are branch/calendar-day
  totals; they are not register-session totals, particularly across midnight.
  Do not relabel them as session revenue. Session totals require reconciled sale
  and return attribution before publication; otherwise show an explicit
  unavailable summary.
- Bind event identity to recipient, schedule revision, branch, session and close
  revision. Persist Inbox before advancing the source cursor. Re-read the source
  close, current ACL and current preference at delivery; repeat eligibility for
  every push retry. Never send cash variance or sales amounts on the lock screen.
- Keep fixed-time delivery and close delivery as explicit modes. A combined
  fixed-time fallback remains a later single-rule design, not two independent
  alerts that can duplicate the same digest.

Required verification includes the actual close writer and normal sync path,
multiple registers, overnight sessions, reopen/change, delayed import,
concurrent workers, quiet hours/DST, permission removal, missing prepared data,
repeated delivery and native notification behavior. None of these source
findings alone establishes production delivery readiness.

The local `business-register-close` service validates exact session/register and
tenant/branch scope, Date-valued source bounds, current closed state and local
close date. A deterministic fingerprint changes with revised source bounds. Its
primary-key reader projects eight metadata fields with a 250 ms query limit and
requires current overview/notification-management capabilities. It reads no sale
arrays or cash variance. Three unit tests and two real-Mongo tests pass, including
the actual register open/close repository, refused wrong-device close, duplicate
close, another session on the same register, lost access and changed/deleted
source. Worker scheduling, prepared totals and mobile settings remain next.
