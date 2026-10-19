# Required dine-in details

Restaurant > Tables contains Require a table and Require guest count (pax).
Table requirement preserves the existing captain_allow_unassigned setting; guest count
uses restaurant_require_guests, false when absent. Enable both for Azure only.
New staff dine-in orders require a whole guest count from 1 to 1000 when enabled.
Takeaway, pickup, delivery and room workflows retain their existing rules.

The scoped table-settings endpoint saves only supplied preferences. Saving these
requirements never changes cleaning settings. Captain floor responses expose both
requirements. Desktop reads them before new-order entry; Captain caches them by shop
and branch from floor responses. The server validates submission even for older apps.

Both settings live on the existing branches document and advance updated_date.
They use the existing branches synchronization lane, not a separate collection.
Offline clients use their last synchronized preferences; a server validates against
its local branch copy. Cloud and tills need the API update, desktop needs the updated
frontend, and Captain needs the updated web/native assets. Force sync transfers the
settings, not application code. End-to-end live device propagation is not yet verified.
