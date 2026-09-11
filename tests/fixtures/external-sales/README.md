# External Sale Fixtures & Idempotency Guide

Parent: #34 | Issue: #399

This directory contains synthetic fixtures demonstrating stable idempotency key generation, duplicate retry handling, and conflict detection for external ecommerce order imports (Shopify, WooCommerce, Magento, custom carts).

## Fixtures

- `first-import.json`: Standard initial external sale payload (`SYNTH-ORD-8801`).
- `duplicate-retry.json`: Exact duplicate retry after a transient network failure or timeout. Uses the same logical order and payload with `attempt: 2`.
- `changed-payload.json`: Same external order ID (`SYNTH-ORD-8801`) where the customer modified quantities or discounts on the ecommerce store without bumping the logical order version.
- `unrelated-order.json`: Different synthetic order (`SYNTH-ORD-9902`) demonstrating identity isolation.

## Connector Guidelines for Conflict and Manual Review

When importing sales into Posnic, connectors MUST follow these rules:

1. **Exact Duplicate Retries (`DUPLICATE_RETRY`):**
   - The POS API responds with the existing recorded sale identifier without creating a duplicate record or adjusting inventory a second time.
   - The connector should mark its local outbox delivery as succeeded (`ok: true`).

2. **Payload Mutated Conflicts (`PAYLOAD_MUTATED_CONFLICT`):**
   - Occurs when an incoming request presents the same `(provider, store, externalOrderId, version)` but the payload checksum does not match the stored sale.
   - **Connector Action:**
     - **DO NOT** silently overwrite the existing POS sale. Overwriting could corrupt billing numbers, cash drawer reconciliations, or completed tax filings.
     - **DO NOT** continuously retry without modifications; this will fail predictably.
     - Place the import into a `NEEDS_MANUAL_REVIEW` / `CONFLICT` queue.
     - If the remote ecommerce platform supports order revisions, emit a new versioned request (e.g. `version: 2`), which generates a distinct versioned key (`...:v2`) for the amended transaction or adjustment.

3. **Synthetic Order IDs:**
   - All fixtures and connector integration tests must use synthetic identifiers (`SYNTH-ORD-*`, `SYNTH-SKU-*`). Live production credentials and actual customer data must never be committed.
