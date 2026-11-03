# Daily bill numbering and catalogue exports

The existing bill-number reset setting accepts `daily`, in addition to off,
financial year and calendar year. It remains off for an unset branch. Daily
numbers use the existing branch/till identity, YYMMDD and a four-digit counter
(for example `SB5D422611040001`). The date is calculated in the branch time zone.
Cloud servers and unpaired tills use the branch code plus their stable local till tag (for example `B51JQR2611040001`). Existing invoices are not renamed. Daily numbering supports up to 9,999 bills
per branch on each installation per day; an identity longer than six characters
cannot fit this format. Neither identity nor date is silently truncated.

Counters are local execution state and are not synchronized. Daily counter keys
include the full date, so concurrent requests from either side of midnight do
not reset each other's counter. Recovery reads only the day's issued numbers.
The existing unique invoice index and duplicate-number retry remain in force.
Branch settings use the existing global `branches` sync lane. Category sort
numbers use the existing branch-scoped `categories` lane. API, Gateway and agent
manifests already include both. No new collection or agent change is required.
Upgrade tills before relying on the daily choice: older versions do not know it.
Physical till reconnection and separately delivered agent behavior still require
live-device verification; database tests do not establish that delivery.

Item exports now share the category sort-order / numeric-SKU ordering used by
sales and pricing. Stock-count and spoilage worksheets include a visible Category
column while keeping record identifiers hidden. Older worksheets without this
extra column still import, with the existing review and stock-conflict checks.

Validation includes real MongoDB tests for midnight rollover, concurrent daily
allocation and reseeding, settings read/write coverage, item export unit tests,
and stock/spoilage worksheet round trips including previous column headings.
