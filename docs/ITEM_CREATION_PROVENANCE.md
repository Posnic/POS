# Item creation provenance

Items created through Add Item (including variants), Quick Item and file import
now store `creation_origin` atomically with the new document. Existing creator
and creation-date fields remain intact. Updates and re-imports never replace
the creation origin. No historical source is fabricated for older items.

The record contains authenticated actor ID/name, server time, operation,
authentication class, source, branch, endpoint without query parameters, and
server-generated request/batch ID. Import rows share the batch ID. API keys and
scoped integration tokens are identified by successful server authentication.
Desktop/browser/captain classification is request metadata, explicitly labelled
as reported; it is not proof of device identity. Unknown clients stay unknown.
No passwords, tokens, raw headers, request bodies or file contents are retained.

Verified webhook adapters and background jobs can wrap item repository calls in
`withSource('webhook', callback)` or `withSource('scheduled_job', callback)`.
This is a server-only API, never a client-supplied property. There is no new
inbound webhook endpoint. Direct database scripts and other services that bypass
these item creation paths must explicitly stamp their own truthful origin; this
change cannot intercept arbitrary MongoDB writes.

## Sync and rollout

Origin is part of the existing branch-scoped `items` document. POS collections,
Gateway collections and the agent sync config already carry items. The agent's
public-document transform removes local execution receipts, not creation origin.
No new collection or execution job is replicated. Remote updates must retain the
original origin, rather than stamp the downloading user as creator.

Deploy API and frontend together; rebuild desktop for offline creation. Old
installations can still create records without this field until upgraded. The
item details panel explicitly says “Not recorded” for them. Local unit and
isolated-Mongo tests cover attribution, batch isolation, spoofed body metadata,
re-import preservation and quick-item persistence. Live cross-device delivery
and installer verification remain required before claiming deployed coverage.
