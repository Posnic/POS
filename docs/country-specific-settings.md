# Country-specific settings audit

## Corrections

- India-only receiving-account setup, HSN/SAC settings, FSSAI setup and customer GST advice start hidden. Country gates survive later restaurant visibility updates. The edited branch determines its own controls; an unknown country does not enable them.
- Legacy and current item editors refresh country-dependent HSN controls after asynchronous branch settings arrive. Ordinary tax fields remain available and drafts/saved settings are retained.
- Current country takes precedence over stale `country_id` or `sortname` metadata. Names, codes and supported legacy aliases resolve consistently for payment defaults, branch creation and tax profiles. An explicit tax-profile override still wins for tax policy.
- Hong Kong and UK payment defaults contain Cash and Card. Stored UPI rows remain in the database but are unavailable outside the existing acceptance-market list. Configuring an Indian receiving address is a separate capability: non-Indian/unknown branches cannot expose it through Captain, Mobile POS or branch-payment setup, and its setup endpoint rejects writes before changing stored preferences.
- Foreign country changes retain the branch tax-registration number. Country profiles provide its label and validation. Receipts use the configured tax-profile presentation labels, including VAT No., ABN, TRN and GST/HST No., rather than guessing GSTIN for every located branch.
- A stale Indian GST setting cannot activate Indian GST report menus for a foreign branch. Direct GSTR routes redirect to the general tax summary. GST Readiness is restricted in report tabs, its page and its scoped API. US resale settings require the US, rather than any sales-tax regime.
- Known foreign receipts suppress copied HSN layout flags and do not invent CGST/SGST splits from a stale setting. Saved tax components are retained for historical reprints. Unlocated historical documents retain their existing behavior.
- Unknown-country regional creation cannot silently select INR. Country aliases select their actual reference currency; otherwise an explicit valid currency is required. No tax rates or tax formulas were changed.
- Shared payment examples, quote/invoice bank placeholders and postal-code labels use country-neutral wording. Split-payment help was translated with the existing service; new bank/postal labels have Dutch/Tamil translations and use the existing English fallback elsewhere after the AWS session expired. No new human-review claim is made for language packs.

## Verification and rollout

Local verification: 542 API/tax/payment/model tests and 178 UI/language tests passed. Mobile integration: 25 passed and five optional browser/device checks skipped. The frontend asset build, API lint/formatting and generated API-doc checks passed; lint retains existing warnings with zero errors. Attribution is checked before the update is pushed. The mobile integration suite uses a temporary MongoDB and local HTTP server. No production requests or writes were used. This does not establish deployment to a client or operation on a physical till.

## Synchronization and ownership

The existing branch/settings interfaces remain authoritative. No fields, collections, migrations or transport lanes are added. The audit reads existing country, country ID, ISO code, profile override, payment rows and receiving-account preferences. Branch creation derives the existing ISO metadata through the same country resolver. Receiving-account writes have an additional country guard; preferences are not deleted or migrated by a read.

The POS manifest, Gateway map and agent configuration already include `branches` with global scope and `payment_method` with branch scope. Existing country, currency, profile override and payment preferences use these lanes. `upiAvailable` is a derived response capability and is not persisted. New API and web assets are needed on each installation; no Gateway or agent change is required.

An offline till uses its last synchronized branch country and payment rows. A fresh settings response refreshes browser capabilities after reconnecting. Existing issued offline grants and historical sale/payment records are not rewritten. Physical cloud-to-till delivery, another till's refresh and reconnection were not tested in this audit.
