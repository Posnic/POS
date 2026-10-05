# Restaurant workspace v2

Open `public/dashboard.html#/kot_v2` with Restaurant enabled. The existing
`#/kot` route remains available; v2 does not replace it during testing.

Animations default off. In Restaurant settings, open **Order feedback**, enable
the effects, and save. This is a branch setting. Reduced-motion preferences
disable decorative effects even when the setting is on. Effects never block
input and send/payment effects only run after a successful response.

## Test on develop

1. Open Active, Available and All. Check that unpaid and partially paid orders
   remain active. Refresh reloads the floor and selected order.
2. Start a table order using a table tile or custom table number, then choose
   guests. Check touch targets and keyboard focus. F2 opens item search;
   Ctrl+Enter sends the reviewed round.
3. Search a name, barcode, SKU or quick code. Add a zero/open-price item and
   enter its price. Add an item not on the menu; its default tax is shown.
4. Add several items, including an off-menu item. Nothing should reach the
   kitchen until **Send to kitchen**. Reload before sending to restore the draft.
5. Add again to a saved dish. It must create an additional round without
   changing the original round quantity. Test a failed send and retry: the
   request and line identities are retained to prevent duplication.
6. Serve a single dish without confirmation. For quantity greater than one,
   serve one portion at a time. Serve all leaves held dishes unsent.
7. Choose an existing customer by name or phone, enter guest details without
   creating a customer, and return to Walk-in customer by clearing both fields.
8. Exercise discount, dish notes, kitchen notes, covers, handover, move,
   merge, transfer, split payment, bill printing and KOT printing.
9. Take partial payment, then settle the balance. The table should remain
   active until settled and then become available for a new order.
10. With effects enabled, check the heart/bubbles on adding, reduction feedback,
    transparent arrow into the kitchen vessel on send, and gold coins on payment.
    Repeat with effects off and reduced motion enabled: no decorative animation.

Legacy orders may share one bill line across several kitchen rounds. Their
quantity reduction removes the newest round first; v2 explains this if an older
round is selected. New v2 additions each have their own stable line identity.

Local verification includes draft/idempotency contracts, scoped customer updates,
animation gates, and browser layout checks at 1440, 1024 and 768 pixels. Physical
printer output still requires a test on the target desktop/printer.
