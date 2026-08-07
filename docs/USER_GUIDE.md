# Posnic user guide

For the people who run the shop, not the people who write the code.

Posnic is a point of sale that works without internet. Your data lives on your
own computer. If the connection drops mid-sale, nothing stops.

---

## Contents

1. [Installing](#installing)
2. [First run: setting up your shop](#first-run-setting-up-your-shop)
3. [Tutorial: your first sale in five minutes](#tutorial-your-first-sale-in-five-minutes)
4. [Day-to-day](#day-to-day)
5. [Stock](#stock)
6. [Customers](#customers)
7. [Reports](#reports)
8. [Hardware](#hardware)
9. [Restaurants and cafés](#restaurants-and-cafés)
10. [Backups](#backups)
11. [Backups when Posnic is closed](#backups-when-posnic-is-closed)
12. [Keeping your till secure](#keeping-your-till-secure)
13. [More than one till](#more-than-one-till)
14. [When something goes wrong](#when-something-goes-wrong)

---

## Installing

Download the installer for your system from the
[releases page](https://github.com/Posnic/POS/releases), run it, and follow the
prompts.

**Windows** may warn that the publisher is unrecognised. Choose *More info* →
*Run anyway*. **macOS** may need *System Settings → Privacy & Security → Open
Anyway* on first launch. **Linux** users can make the `.AppImage` executable and
run it, or install the `.deb`.

The first launch takes a few minutes — Posnic is setting up its own database.
Later launches take seconds.

You do not need to install a database, a web server, or anything else. It is
all in the one installer.

---

## First run: setting up your shop

A setup wizard runs the first time. You will be asked for:

- **Your shop's name and address** — these appear on receipts.
- **An administrator login** — the account that can do everything. Keep the
  password somewhere safe; there is no one to email for a reset, because your
  data is on your machine and nobody else has it.
- **Currency and tax settings** — including your GSTIN if you are in India.
- **Your first branch** — if you only have one shop, this is just its name.

You can change all of it later under **Config → Settings**.

---

## Tutorial: your first sale in five minutes

### 1. Add a category

**Item → Category → Category List → Add.** Give it a name — "Beverages",
"Groceries", whatever fits. Categories are how you find things quickly later.

### 2. Add an item

**Item → Add New Item.** The fields that matter:

| Field | What it is |
|---|---|
| Name | What appears on the receipt |
| Category | The one you just made |
| Cost price | What you pay |
| Selling price | What the customer pays |
| Quantity | How many you have now |
| Barcode | Optional — scan it here and the scanner will find it at the till |
| Tax | The rate that applies |

Save.

### 3. Open the register

**Register → Cash Register.** Enter how much cash is in the drawer to start.
This is what lets Posnic tell you at closing whether the drawer balances.

### 4. Make the sale

**Sale → New Sale.** Type the item's name, or scan its barcode. It appears in
the basket. Change the quantity if you need to.

Choose **Payment**, pick cash or card, enter what the customer gave you, and
Posnic shows the change. Confirm, and the receipt prints.

That is a sale. Stock has come down by one, and the takings are recorded.

### 5. Close the register

At the end of the day: **Register → Cash Register → Close**. Count the drawer,
enter the total, and Posnic shows any difference between what you counted and
what it expected.

---

## Day-to-day

**New Sale** is the full till: search, scan, discounts, multiple payment
methods, part payments.

**Quick Sale** is stripped down for speed when there is a queue.

**Return Sale** reverses a sale. Find the original, choose what is coming back,
and stock goes up again.

**Partially Paid** lists sales where the customer still owes you. Useful for
regulars with an account.

**Sales History** is every sale, searchable by date, customer, branch or staff
member.

---

## Stock

**Item List** — everything you sell. Search, edit, deactivate.

**Variants** — one item in several forms. A shirt in four sizes is one item with
four variants, not four items.

**New Purchase** — record stock arriving from a supplier. This puts quantities
up and records what you paid.

**Purchase History** and **Return Purchase** — what you bought, and sending it
back.

**Inventory Logs** — every movement of every item, and why. When a count is
wrong, this is where you find out what happened.

**Low Stock List** — items at or below their reorder level. Check it before you
order.

---

## Customers

**Customer List** — the people who buy from you. Name, phone, email, address,
and everything they have ever bought.

**Customer Category** — group them: wholesale, retail, staff. Categories can
carry their own pricing.

**Outstanding customers** — who owes you money and how much.

You do not have to record a customer to make a sale. Walk-ins are normal.

---

## Reports

Under **Reports**:

- **Sales** — by day, item, category, branch or staff member
- **Purchases** — what you bought and from whom
- **Inventory** — what you hold and what it is worth
- **Expenses** — what you spent outside stock
- **GST Reports** — tax summaries formatted for Indian filing
- **Profit** — sales less cost of goods

Every report can be exported.

---

## Hardware

**Config → Device Setup.**

Posnic works with ordinary retail hardware:

- **Receipt printers** — thermal printers over USB or network
- **Barcode scanners** — anything that behaves as a keyboard, which is nearly all
- **Cash drawers** — usually opened by the receipt printer
- **Weighing scales** — for shops selling by weight
- **Customer displays** — a second screen showing the customer their total
- **Catalog Display / Kiosk** — a customer-facing browsing screen

Test each device from the setup screen before trusting it in a queue.

---

## Restaurants and cafés

**KOT** (Kitchen Order Ticket) sends orders to a kitchen printer as they are
taken, so the kitchen starts cooking before the bill is settled.

**Easy Table** tracks which table has which order, so a bill can stay open while
people keep ordering.

---

## Backups

**Your data is on your computer. If that computer dies and you have no backup,
the data is gone.** Nobody else has a copy unless you pay for Posnic Cloud.

Posnic takes local backups automatically. Copy them somewhere else — a USB
drive, another machine, cloud storage. A backup on the same disk as the original
is not a backup.

Posnic Cloud does this off-site automatically. It is a paid service and entirely
optional.

---

## Backups when Posnic is closed

Posnic takes its scheduled backups **while it is running**. If the till is shut
down every evening, the overnight backup does not happen — and the morning that
matters is the one where the disk does not come back.

Two ways to fix that.

### Posnic Cloud does it for you

Backups run on our servers, on their own schedule, whether or not any till is
switched on. Nothing to set up, and the copy is already off your premises. If
you are on Cloud, skip the rest of this section.

### On the local edition, ask Windows to do it

Windows has a built-in Task Scheduler. One command tells it to run Posnic's
backup every night, whether or not anyone has opened the app.

**Posnic writes the exact command for you**, with the real paths already filled
in — *Backup Manager → Settings → Backups when Posnic is closed → Show me the
command*. It looks like this:

```
schtasks /Create /TN "Posnic Backup" /SC DAILY /ST 22:00 ^
  /TR "\"C:\Program Files\Posnic\Posnic.exe\" --scheduled-task=backup" /F
```

Copy it from the Backup Manager rather than typing it from here — the path to
Posnic depends on where you installed it, and the command must match your
machine.

1. Right-click **Command Prompt** → *Run as administrator*
2. Paste the command and press Enter
3. Check it was created:
   ```
   schtasks /Query /TN "Posnic Backup"
   ```
4. Run it once now, so you find out today rather than in six months:
   ```
   schtasks /Run /TN "Posnic Backup"
   ```
5. Confirm it worked — `Last Result` should be `0`:
   ```
   schtasks /Query /TN "Posnic Backup" /FO LIST /V | findstr /C:"Last Result"
   ```

Then open Posnic and look at *Backup Manager → History*. A new backup should be
listed.

**A few things worth knowing:**

- The task starts the database, takes the backup, and stops again. Posnic does
  not need to be open, and it will not open a window.
- It must run **as the same Windows user Posnic normally runs as**. The database
  password is tied to that account, so a task set to run as anyone else will
  fail.
- A failed run reports an error to Windows, so `Last Result` will not be `0`.
  It never reports success for a backup that did not happen.
- To change the time, run the same command again with a different `/ST`. To stop
  it: `schtasks /Delete /TN "Posnic Backup" /F`.

You do **not** need to install Node.js or anything else. The command points at
Posnic itself.

**And this still does not put the backup anywhere safe.** It is on the same
computer as the original. Copy it to a USB drive or another machine — see
[Backups](#backups) above.

---

## Keeping your till secure

Your shop's sales, customers and payment settings live on this computer. Four
things protect them far more than anything inside Posnic can, and all four are
free.

**1. Run the till on a standard account, not an administrator one.**

This is the single most useful step. Windows lets you create an account that can
use programs but cannot install software, change system settings or stop
services. Run Posnic on one of those.

If something harmful does reach the machine — through a browser, a USB stick, an
email attachment — an administrator account lets it do whatever it likes. A
standard account does not.

*Settings → Accounts → Other users → Add account.* Make the everyday one
**Standard**, and keep a separate **Administrator** account for installing
updates.

**2. Give the administrator account a real password.**

A password that only exists on paper next to the till is not a password. This is
the account that can bypass everything else, so it is the one worth protecting.

**3. Turn on device encryption.**

Without it, anyone who takes the computer — or just the hard drive out of it —
can read every sale, every customer and every stored password, without knowing
any password at all. It does not matter that Posnic locks its own database; the
files are simply readable.

*Settings → Privacy & security → Device encryption*, or search for **BitLocker**.
It runs in the background, does not slow the machine noticeably and does not make
any file larger.

> **Save the recovery key.** Windows will offer to save it to your Microsoft
> account or print it. **Do both.** If the computer's firmware is updated or the
> motherboard replaced, Windows will ask for that key before it will start. No
> key means no data — not for you, not for us, not for Microsoft. This is the one
> way turning on encryption can cost you your shop's records, and it is entirely
> avoidable.

Some cheaper computers running Windows Home do not offer device encryption at
all. If yours does not, treat the machine itself as valuable and keep it
somewhere it cannot be walked off with.

**4. Do not use the till for anything else.**

No web browsing, no email, no downloads, no games. A till is a cash register.
Almost everything that goes wrong on a shop computer arrives through a browser.

### What this does and does not cover

Posnic keeps its database closed to the network and locked with a password
unique to your installation. What it cannot do is defend against somebody who
already has administrator rights on the machine, because at that point they can
simply switch the lock off. That is true of every program on the computer, not
just this one.

Which is why the four steps above are worth more than anything we could add to
the software. The
[security policy](../SECURITY.md) sets out the reasoning in full if you want it.

---

## More than one till

Two tills in the same shop each keep their own database. They do not
automatically share stock or sales.

**Posnic Cloud** is the paid service that syncs them: sales, stock, customers
and settings stay consistent across every till and branch, and you get a
dashboard you can check from anywhere.

Without Cloud, each till is complete and independent. With it, they are one
business. Details at [posnic.com](https://posnic.com).

---

## When something goes wrong

**Posnic will not start.** Restart the computer first — it clears a stuck
database process more often than anything else. If it persists, the log will say
why:

| System | Log |
|---|---|
| Windows | `%APPDATA%\posnic\app.log` |
| macOS | `~/Library/Application Support/posnic/app.log` |
| Linux | `~/.config/posnic/app.log` |

**"MongoDB service not running."** Posnic's database did not start. Restart the
application; if it happens again, restart the machine and check the log.

**The printer does nothing.** Check it is on and has paper, then test it from
**Config → Device Setup**. Most printer problems are the driver, not Posnic.

**Stock numbers look wrong.** Check **Inventory Logs** — every change is
recorded with a reason and a time.

**I forgot the admin password.** Another user with administrator rights can
reset it. If nobody can log in, the data is still there but you will need help
recovering access — the security that protects your data from strangers protects
it from you too.

### Getting help

- **Something is broken:** [open an issue](https://github.com/Posnic/POS/issues)
  — say what you did, what happened, and attach the log
- **A question:** [Discussions](https://github.com/Posnic/POS/discussions)
- **A security problem:** see [SECURITY.md](../SECURITY.md), not a public issue
- **Paid support or Cloud:** info@posnic.com

Posnic is free software. Nobody is obliged to answer, but people usually do —
and a clear report with a log attached gets answered fastest.
