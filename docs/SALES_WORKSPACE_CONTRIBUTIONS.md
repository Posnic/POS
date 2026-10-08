# Sales workspace contributions v1

This is a generic host capability, `sales.workspace-contributions.v1`, implemented in the compatible development host. It is not yet included in every standard Posnic release. Basket Review rc15 requires it and must reject an older host before activation.

A verified extension may declare `contributes.salesWorkspace`:

```json
{
  "version": 1,
  "controls": [
    {"id":"quote","label":"Request quote","action":"request-quote","placements":["sale","payment"],"tone":"primary"},
    {"id":"drafts","label":"My drafts","page":"drafts","placements":["header"]}
  ],
  "events": {"submit":"request-quote","hold":"request-quote"},
  "policies": {"useDefaultOpenPrice":true},
  "clearCartOn": ["quote.create"]
}
```

`clearCartOn` names commands declared by that extension. The host clears its captured cart only after a successful durable response to one of those commands and only if that cart has not changed. It clears once. Recovery without a matching command identity does not implicitly clear a cart.

Controls have bounded plain-text labels, an opaque action or page identifier, allowed placement and tone enums, and unique IDs. No HTML, JavaScript, selectors or URLs are accepted as targets. The server normalizes declarations from verified packages; existing user/branch access and enabled-state checks still apply.

The bootstrap payload includes version, action/page, cart lines, customer label and selected tender. The extension interprets actions and decides which allowed command to submit. The host retains price, stock, payment, receipt and permission authority. This does not give the extension direct database access or payment settlement authority.

Only one enabled workspace owner is supported. Conflicting owners show an error and receive no controls. Disable removes controls and restores native checkout/price behavior; it does not erase extension transactions. New Sale only: edited sales, payment-only and KOT submissions retain their native path.

The generic host contains no Basket Review button labels, folder destinations or cash/card workflow mapping. Those now live in Basket Review's signed manifest and page script. Core changes are limited to reusable rendering, cart handoff, lifecycle and submit/policy hooks.

Future standard Posnic builds must retain this versioned capability and pass its contract tests. This removes customer-specific Sales patches, not the need for compatibility testing or a one-time compatible host installation. The existing rc14 EXE and cloud deployment are unchanged by this source refactor.

### Compact action presentation

`policies.compactCheckout: true` opts the installed provider into a compact dialog
for action controls. It defaults to false. Folder (`page`) controls keep the full
workspace. The bootstrap workspace includes `presentation: "compact"` or
`"workspace"`; compact frames receive the `compact-checkout` body class before
rendering. Providers should omit their catalogue and navigation in compact mode.

An embedded compact provider can request `closeWorkspace` after its durable
operation finishes. The host rejects this request for standalone/full workspace
frames or while a command has an unresolved outcome, and restores the Sales
barcode focus on close. Do not close merely because a payment was prepared;
retain confirmation and receipt controls until the cashier finishes.
