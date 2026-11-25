# Browser-managed cloud owner passwords

Cloud-linked owners manage passwords at https://www.posnic.com/account.html#password.
The shop password dialog shows that link instead of local password fields.
The API rejects alternate password/reset writes; the UI is not the security boundary.

Cloud owner identity is an explicit tenant ownerIdentity mapping, not an email
match. Hosted shard and configured standalone servers read the website credential
and session revision. Missing authority fails closed for a bound owner. Community
accounts without a cloud link keep local login and recovery. Staff stay separate.

Gateway must deploy its owner-write/tombstone guard and authoritative users pull
before enabling bindings. The private sync agent is distributed through its
existing signed cloud delivery mechanism; it must not be bundled from private
source into a public POS installer. Recovery builds must refuse cloud-linked
shops even after expiry. An offline till retains its last cached login until
reconnection; this is not immediate offline credential revocation.

Existing account mappings require a reviewed migration. No customer password or
shop data was changed during implementation. Run fresh owner login, stale password
and session rejection, browser password change/reset, staff login, Community reset
and undo, and connected/offline sync checks before production rollout. Native
release acceptance and signing are separate from source regression checks.
