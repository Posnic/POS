# Connecting Desktop to Posnic Cloud

The setup screen recommends a 14-day cloud trial. **Start cloud trial** opens
signup in the system browser. Existing customers choose **Sign in to an existing
cloud account**. Both paths show the account, shop and computer before asking the
owner to authorize the computer. A shop owner's pairing code remains an
alternative. Community Edition stays available through **Set up offline**.

## First connection and everyday login

Internet is required to authorize the computer and download its shop for the
first time. Desktop waits for the initial download and checks that staff users
are available before opening the local login screen.

Afterward, staff sign in against the local database. Closing the browser,
signing out of the cloud website or losing internet does not require another
browser authorization. Sales continue locally and the existing sync agent
retries when connectivity returns. Cloud passwords never enter Desktop when
using browser authorization. Cloud authorization grants this computer sync
access; it does not sign a staff member into the till.

An offline computer cannot immediately receive cloud password changes, staff
access changes or device revocation. It uses its last synchronized local staff
records until it reconnects. Cloud subscription checks remain in the sync
service and are not added to local staff login.

## Shop identity

Enrollment verifies the cloud tenant and branch IDs before writing cloud
configuration or starting synchronization. A saved tenant binding survives
disconnect. Existing local branches must belong to the approved cloud shop;
unlinked local business data cannot be combined with a different cloud shop.
Community-to-cloud migration needs a deliberate migration workflow with a
backup; creating a new trial does not import an existing local shop.

## Authorization and rollout

The main process generates PKCE S256 proof and state, opens an IPv4 loopback
listener on a random port, and opens the approved Posnic website URL. Browser
approval requires a signed-in owner, CSRF validation and explicit consent.
Requests expire after 15 minutes; approval codes expire after one minute and
can be consumed once. Only token hashes are stored on the cloud service.
Desktop keeps the verifier and device token out of its renderer.

Deploy the web-api desktop authorization endpoints, the gateway device identity
endpoint and website signup-return support before distributing Desktop with this change. The new identity check
also protects pairing and advanced password connection. Normal startup and
daily local login do not call these enrollment endpoints.
