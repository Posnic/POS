# Books accounting export (recovery implementation)

Status: selected-value serializer implemented; HTTP routing, scoped pagination and real API integration remain pending. No existing POS route or write behavior has changed.

The `posnic.sale-source.v1` snapshot carries a typed source identity, explicit customer-reference identities and selected stored values. JSON field order is fixed by the allowlist; SHA-256 covers the exact source JSON. A string that resembles an ObjectId remains a string. Unknown top-level and nested fields are excluded. Invalid or unsupported selected values fail explicitly. The serializer does not fill missing currency, invent payment IDs, recalculate money or describe mutable records as immutable events.

Books verifies this envelope before it archives a source. A source revision proves selected values match that snapshot; it does not prove that a receipt was accepted or that the sale may be posted. Ordinary payment arrays lack durable event evidence and remain held for review. Immutable sale/return/payment capture and subsequent accounting-posting support remain separate unfinished requirements.

## Data and synchronization

This component reads the authorized installation's existing sale document. It writes no business collection, field, command journal, sync checkpoint or file. Existing sales replication is unchanged; no new Gateway/agent lane is introduced by the serializer. The origin till, another till and web installation can each expose only their locally available synchronized sale state. Different revisions after offline edits/reconnect must trigger Books review rather than replaying payments. End-to-end sync convergence and the future endpoint's tenant/branch isolation have not yet been verified. No deployment or live-client readiness is claimed.

## Verification

`node --test api/tests/accounting-source.test.cjs`: four checks for value preservation, deterministic revisions, typed source/customer IDs, private-field exclusion, tenant mismatch and unsupported shapes. The Books checkout's opt-in `pos-export-contract.test.js`, run with `BOOKS_TEST_POS_CHECKOUT` pointing at this checkout, verifies exact totals, customer identity, revision changes and review holds for missing currency/ordinary payment history. No customer data or installed POS was used.
