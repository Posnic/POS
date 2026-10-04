# Desktop restaurant order workspace

The desktop table screen uses the same seating, kitchen-service and payment services as Captain. The order gets three quarters of the desktop workspace; table selection and guest selection use compact controls.

## Available actions

| Action | Behavior |
| --- | --- |
| Add / modify items | Existing keyboard search and quantity entry; preserves saved pricing and preparation metadata. An unmatched product lookup cannot borrow another product's price. |
| Discount | Preserves the saved guest count. Discount permission, limit and reason checks remain enforced. |
| Order details | Edit overall kitchen note, individual item notes, seat, course, allergy note and hold status. Existing modifiers and allergy flags survive these edits. |
| Kitchen progress | Groups additions by recorded KOT time. Displays served quantity for each exact KOT line. |
| Mark served / Serve all | Updates kitchen service without taking payment. Held dishes must first be sent to the kitchen. |
| Send to kitchen | Releases a held line through the shared idempotent course service. |
| Move table | Uses server seating reservation and completion, including capacity and conflict checks. A pending move retains its request locally for retry. |
| Merge tables | Uses the shared merge reservation service and retains the move identity for retry. Requires merge permission. |
| Transfer items | Select quantities, including any served quantity, then review the two bill totals before committing. The durable server transfer preserves stock, money and kitchen provenance. Requires merge permission. |
| Number of guests | Uses the shared guest-change service; does not overwrite the table through a generic item edit. |
| Hand over order | Uses the existing authorized staff list and assignment audit. |
| Split payment | Equal shares or assignment of complete item lines to guests, including equal sharing of a line. Uses the server bill revision and the existing payment review and recovery flow. |
| Print bill / Print KOT / Take payment | Retains the existing desktop printing and cashier paths. |

## Defaults and boundaries

- No module or payment setting is enabled by this change. Split and shared collection controls appear only when the existing payment options allow them.
- Staff permissions remain enforced server-side. Quantity corrections no longer require a modification reason, but still require the existing reduction permission. Cancelling the order and applying discounts still require their reasons and permissions.
- The mockup uses sample data only and never contacts a shop, printer or payment provider.
- Manager approval continues through the existing shared desktop request handler. Existing modifier choices and allergy flags are preserved; the notes dialog does not replace the sale screen's modifier picker.

## Regression checks

Local automated coverage exercises missing guest fields, combined seating capacity, cancellation permissions, item pricing and metadata retention, repeated dishes, individual service, held courses, disabled payment collection, error recovery and retrying a table move with the same request identity.

Before production rollout, verify with a test restaurant and permitted/restricted staff accounts: add a KOT, add a second round, change quantities, apply a discount, serve one line, serve all, move the table, change covers, hand over, and collect guest payments. Use a test printer to check both bill and KOT output.
