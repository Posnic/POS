# Billing outlets and daily handover

A branch is a property. Its billing outlets can be Restaurant, Bar and Room
Service. They use the branch's catalogue, inventory and existing printer routing.
Sales channels (counter, captain, online) remain independent.

## Operation

From New Sale, open **Billing outlets**. The same page is available through the
command palette. **Outlet settings** requires branch-write permission. Configure
the name, percentage price adjustment, exact item prices, service-charge rate,
tax on that charge, and permitted billing staff. Empty staff selection means all
staff who already have branch access. Outlet membership restricts billing; it
does not replace the branch's existing record-view/report permissions.

Open each outlet in its own window. Electron titles identify the outlet and
branch. Selecting an already-open outlet restores and focuses that window,
including when minimized; it does not reload its cart. Windows may group these
under Posnic on the taskbar, with separately named window previews.

The outlet window pins its branch, scopes billing preferences and IndexedDB
state, and starts without copying another window's selected cash register.
Normal register ownership checks still apply. Logout remains shared through the
existing authentication system. The browser version uses named windows/tabs.

Exact item prices override the outlet percentage. Outlet pricing takes priority
over customer-category pricing. Open-price and quick-sale amounts are retained.
Modifiers are added after outlet pricing. Service charges apply to the discounted
pre-tax amount; their configured tax is separate. The server recalculates the
payable amount. Existing bills retain their outlet rules and line prices;
switching an existing bill to another outlet is rejected. If configuration
changes while an unsaved cart is open, saving is refused until prices are
reviewed; the cart is not silently repriced.

Room/reference is optional preparation information. It is not a hotel room
account, guest verification, or PMS settlement. KOT and kitchen displays carry
the outlet and reference. No hotel-account payment integration is introduced.

## Daily summary

Choose a date to combine all outlets in the current authorized branch, including
older unassigned sales. The report uses the branch's currency and time zone.
It includes outlet and branch sales totals, bill counts, refunds on their own
dates, outstanding balances, and the recorded payment-method breakdown against
that day's bills. Drafts, cancellations and unsettled kitchen orders are excluded.
Unreconciled payment breakdowns are explicitly listed instead of being classified
as cash. These settlement figures are not a payment-event ledger: receipts
against older bills and cash movements belong to register closing.

The same printable report includes recorded register closings on the selected
date, combining saved expected and counted cash. Missing counts are marked
incomplete. Open registers are not closed by generating or printing this report.
This is a reprintable summary; it does not replay payments or reset totals.

Separate branches must be selected separately; currencies are never summed
across branches. No real orders, printer settings or production data are changed
by the regression tests.
