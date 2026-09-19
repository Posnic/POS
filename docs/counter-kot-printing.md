# KOT printing at the counter

Restaurant orders offer **Print Bill** and **Print KOT** separately. Print KOT
prints pending kitchen changes, including additions and cancellations. A ticket
already reported as printed offers **Reprint a copy**, clearly labelled so the
kitchen does not prepare the order again. Copies from the order screen and
Electron's KOT log are headed **DUPLICATE KOT** with **Do not prepare again**.
A log reprint keeps its original KOT number and ticket type, including
cancellation markings. First prints and genuinely additional or cancelled
items retain their usual headings.

In **Settings → Restaurant → KOT printing**, enable **Automatically print KOTs
after saving an order** to print orders and item changes saved on this counter.
It is off initially and saved separately for each branch in this browser or
desktop installation. Incoming orders from other devices remain the responsibility
of the existing kitchen poller.

Desktop uses the kitchen printers configured in Hardware Manager, including its
ESC/POS path for supported thermal printers. It does not redirect a failed kitchen
job to the receipt or system default printer. If no kitchen printer is configured,
or printing from a browser, the print dialog opens. Select 58 mm or 80 mm in the
KOT printing settings to match the roll used by that dialog.

After a browser print dialog closes, confirm **Printed** only if the ticket came
out. Closing or cancelling that dialog does not acknowledge the ticket. **Print
again** retries the reserved ticket; **Return to kitchen queue** releases it for
the desktop poller. A failure after partial printing needs the cashier to check
the kitchen before retrying, especially when several kitchen printers are used.

## Queue coordination

The authenticated `POST /sales/:id/kotPrint` endpoint reserves only the current
branch's restaurant order. The button and poller take pending changes through
the same atomic claim. The counter renews a ten-minute reservation while its tab
is open. Confirmation acknowledges only the change index originally reserved;
dishes added while a print dialog is open remain pending.

Browser reservations are restored from session storage after refresh. A closed
or suspended tab eventually releases work through lease expiry. As with existing
kitchen polling, a crash after paper is sent but before acknowledgement can leave
an uncertain result; the cashier should check before retrying. Physical printer
output cannot be proved by a browser dialog or spooler acknowledgement.

The kitchen payload excludes prices, payments and customer contact details.
Tests cover simultaneous claims against MongoDB, branch/tenant scoping, lease
expiry, changes during printing, cancellation, explicit copies, the browser
confirmation, and dedicated desktop printer routing without sending real paper.
