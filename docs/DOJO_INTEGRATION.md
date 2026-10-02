# Dojo Pay at Counter integration

Status: implementation in progress, 2 October 2026. Shared Community Edition code; no merchant fees are included or changed. Not deployed, connected to checkout, or certified for live payments. The owner has no Dojo developer/partner access yet.

## Implemented foundation

`api/src/services/dojo-client.js` implements the Dojo 2026-02-27 transport for payment intents, terminal discovery, Sale terminal sessions, status retrieval, explicit signature decisions, cancellation requests and refund requests. It pins the HTTPS origin, rejects redirects, validates identifiers and GBP integer minor-unit amounts, enforces key/environment matching and strips provider errors of secret/body contents. It never automatically retries a mutation. The caller, not an extension frame, holds the key.

`dojo-payment-journal.js` durably binds one host payment to one merchant-configuration identity, environment, terminal, amount and currency. Atomic admission permits only one creator for each intent/session. An interrupted POST remains unresolved; calling start again cannot create a second charge. Polling validates both the terminal session and payment intent, including reference, terminal, amount, currency and capture mode. Only matching Captured results yield a captured journal state. Expired sessions need reconciliation. A stale pending poll cannot overwrite capture.

These are internal services. There is deliberately no arbitrary browser-supplied amount endpoint and no automatic stock/sale mutation. The journal collection `dojo_payment_operations` is host-owned payment integrity data: retain it across extension uninstall, include it in backup/restore, and never clear it to retry payment. Raw card data, provider response bodies and API credentials are not stored in this journal.

## Work required before checkout release

1. Add a dedicated payment-provider settings page with manager authorization, encrypted per-shop credentials and terminal selection. Posnic's assigned software-house ID is deployment configuration, not a merchant-editable field. Configuration identity must stay stable for old operations; do not reconcile against a different merchant account after a key change.
2. Bind the journal to a reserved, immutable host quote before issuing payment. Prevent competing manual Card confirmation, Cash conversion, cancellation, basket deletion or inventory release while a provider outcome is unresolved. Finish sale commit recovery without repricing an already captured charge or charging again.
3. Add checkout status, signature accept/reject, cancellation and recovery UI to normal sales and Basket Review through shared host capabilities. Poll once per second while active; stop UI polling on navigation without cancelling the payment. Manual external Card recording must remain visibly distinct from Dojo authorization.
4. Add reconciliation for lost intent/session creation responses using verified provider identities/history. Never assume an undocumented idempotency header or that zero search results proves a timed-out request was not accepted.
5. Add durable refund orchestration, authorization, local refund ledger linkage, unknown-outcome recovery and confirmation. The low-level refund transport is not a finished refund workflow and must not be exposed directly.
6. Run sandbox and provider go-live tests, then a separately authorized merchant/terminal acceptance session. Only then enable production use.

## Required access

Arrange Dojo developer/partner access, a private sandbox key, sandbox/virtual terminal access and the software-house/reseller identifiers. Dojo assigns production identifiers; do not ship documentation sample IDs as production credentials. For Bahadar, subsequently configure the authorized merchant key and terminal ID through a secure channel. No secret keys should be sent in ordinary chat or included in source archives.

Dojo's go-live checklist requires at least one supported refund method. It also covers signature handling, declined/cancelled/expired outcomes and terminal polling. Local simulations do not satisfy this external acceptance.

## Verification

`node --test api/tests/dojo-client.test.cjs api/tests/dojo-payment-journal.integration.cjs` — 8 passed using mocked provider responses and real temporary MongoDB. Cases include transport contract, environment validation, redacted errors, strict capture matching, 12 concurrent starts, cross-branch/configuration denial, lost creation responses and expiry. No Dojo API calls or real payments occurred.

## Official references reviewed

- [Dojo API, version 2026-02-27](https://docs.dojo.tech/api)
- [Pay at Counter flow](https://docs.dojo.tech/payments/accept-payments/in-person-payments/pay-at-counter/terminals/step-by-step-guide)
- [Go-live checklist](https://docs.dojo.tech/payments/accept-payments/in-person-payments/pay-at-counter/go-live-checklist-f2f)

The current reference does not document an idempotency guarantee for the creation calls used here. This implementation therefore retains an unresolved journal after uncertain submission instead of automatically retrying it. Future recovery behavior must be confirmed against the provider contract and sandbox.
