# Country-specific settings correction

UPI receiving-account setup and the receipt HSN/SAC option start hidden and appear only for an Indian branch. Branch editing uses the country of the branch being edited, including changes to the country selection, rather than the previously selected value or the signed-in branch. An unknown country leaves these controls hidden. Saved values are retained.

The legacy item editor refreshes its HSN gate when branch settings arrive. The current editor refreshes its existing India-only HSN capability after asynchronous country updates, preserving the draft and leaving ordinary tax fields available.

For branches without an initialized payment-method list, runtime payment availability now uses the same country defaults as initial setup. Hong Kong and UK defaults are Cash and Card. Explicitly configured payment rows, disabled rows and deliberately empty initialized lists retain their existing behavior. The existing international acceptance-market defaults are unchanged; these differ from configuring an Indian UPI receiving address.

## Verification and rollout

Local checks: 77 API tests, 26 UI tests and 57 language tests passed. The frontend asset build and attribution check passed. No production requests or writes were used for these checks. This evidence does not establish deployment to a client installation.

## Synchronization

No fields, collections, write paths, migrations or stored defaults are added. Country and payment choices remain owned by their existing branch/settings interfaces. The fix reads `branches.country` (cached as `country_setting` in the browser) and existing `payment_method` rows. Branch changes refresh the browser capability when the authoritative settings response arrives.

The POS manifest, Gateway collection map and agent configuration already include `branches` with global scope and `payment_method` with branch scope. No new transport lane or Gateway/agent change is needed. Each installation must receive the updated API and web assets to apply the read-time fallback and UI gates. An offline till uses its last synchronized branch country and payment rows until reconnecting; physical till reconnection and delivery were not tested here.
