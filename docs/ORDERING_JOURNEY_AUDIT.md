# The ordering journey, walked and photographed

Owner: _"first study the flow and take screenshot of how you done. i am not
satisfied with use jouerny form start to end of order. need to research and
evaluat and improve. also ux also needs to be evaluated."_

Everything judged about this bundle until now was judged by reading code and
asking him what he saw. That is the wrong way round for a question about a
**journey**: what is being judged is what a person meets, in order, on a phone,
and none of that is legible in a diff.

So the journey was driven and photographed. `scripts/dev/shoot.cjs` runs a real
headless Chrome against the real sandbox at 390x844 (an iPhone 14), taps what a
customer taps, and keeps every frame in `docs/journey/`. It needs nothing
installed: Chrome is already on the machine and Node has had a WebSocket of its
own since 22, so it speaks the DevTools Protocol directly.

The frames below are that run. Findings are ordered by what they cost a
customer, not by how hard they are to fix.

---

## 1. The dead end at the end of the journey

**Frame `17-payment-settled.png`. This is the worst thing in the bundle.**

> ⚠ **Order could not be completed**
> Checkout failed (404): Table 34 already has an open order. Add to it, or
> settle it first.
> **[ Retry order ]**

Three failures compounding:

- **The only button offered cannot ever work.** Retry posts the same order to
  the same table and fails identically, for ever. It is a loop with no exit.
- **A raw HTTP status is shown to a diner.** "404" means nothing to them.
- **The message says "Add to it" and gives no way to add to it.** The door that
  does exactly that was built on the _voice_ path and only there: ordering by
  talking added to the open order, ordering by tapping hit a wall.

That asymmetry is the real defect. The shop's one-order-per-table rule is
right - two tickets on one table is usually somebody picking the wrong table,
and the cost of finding out is a bill split in two - but a rule with no door
beside it is a wall.

**Fixed.** The door now lives in `performCheckout`, where every path to the
kitchen passes:

- if this phone holds the open order, the basket is merged into it (quantities
  read back from the shop first, because the change endpoint takes absolute
  numbers and only the shop knows what is on the ticket);
- if it does not, the order belongs to another diner and is not ours to touch:
  say so in words and offer **the menu**, because Retry would still be a button
  that cannot work.

---

## 2. The voice sheet offers the same thing three times

**Frames `12-talk-code.png` and `13-on-the-line.png`.**

On a code that says talk, the screen showed, stacked vertically:

1. a dashed circle captioned **"Tap to talk"**
2. a black button reading **"Tap to talk"**
3. a large button reading **"Hold to talk"**

and once the line was connecting, _also_ **"Talk to order"** and **"Type
instead"** underneath - five controls for one job, with roughly 800px of empty
space above them.

Two separate causes:

- **`start()` reopened the chooser beneath the call.** It calls `open()` on its
  way to the line, and `open()` offers talk-or-type. Worse, `start()` set
  `live.active = true` _after_ calling `open()`, so the guard that was supposed
  to prevent this was always told no call was running.
- **Tapping and holding are different moments** - tapping _opens_ the line,
  holding _speaks_ into it - and both were on screen at once, with the orb
  captioning the button beneath it for good measure.

**Fixed.** Holding appears when there is a line to hold. The orb stops
repeating the button under it. The chooser never surfaces under a call.

---

## 3. Half the first screen is furniture

**Frames `02-menu-as-it-lands.png`, `03-menu-clean.png`.**

Measured on the 390x844 frame, before a single product:

| band                                             | height                  |
| ------------------------------------------------ | ----------------------- |
| shop name, item count, table chip, language, bag | ~110px                  |
| search                                           | ~100px                  |
| sort ("Catalogue order", alone on its row)       | ~70px                   |
| category chips                                   | ~100px                  |
| section heading repeating the selected chip      | ~60px                   |
| **total before the first product**               | **~440px of 844 (52%)** |

Three items fit, the third half cut off. And the menu does not scroll the
window - it scrolls inside `MAIN.scrollable-products` - so the browser chrome
never retracts and that 440px is permanent.

Worth saying plainly: **the sort control and the repeated section heading are
the two least useful things on the screen and they are above the food.**

---

## 4. The first screen arrives covered in overlays

**Frame `02-menu-as-it-lands.png`.**

The assistant's first-run callout ("NEW - Ask me what's good, or just talk")
lands **on top of the search field** - the single most-used control on the
page. On develop a second red panel covers a product card, though that one is
injected by the sandbox and never reaches a real shop.

The callout is a good idea in the wrong place: it should not cover the control
a customer is most likely to reach for first.

---

## 5. The basket is mostly empty space

**Frame `08-basket.png`.**

- Content ends around 750px; **the lower half of the screen is blank.**
- The item name is **clipped mid-character with no ellipsis**, running under
  the stepper: "A5 Ruled Notebook 1 not‸".
- **"Clear the order"** is large, red, centred, and floating in that empty
  space - visually the second most prominent thing on the screen, and it is the
  destructive action.
- The total appears **twice**: once in a card, once in the bottom bar.
- **No way to add more items** except the back arrow - which matters most in a
  restaurant, where people order in rounds.
- **The table is not shown.** A customer cannot confirm where the food is going
  at the moment they commit.

---

## 6. The same fact is counted three times

**Frame `06-added-one.png`.** Adding one item produces: a badge on the bag, a
badge on the category chip (clipped by the chip's own corner), and "1 item" in
the bottom bar. The bottom bar is the right one; the other two are noise.

The stepper also sits **on top of the product photo**, covering half of it.

---

## 7. Product names truncate before they inform

**All menu frames.** "A5 Ruled Notebook 1 notebo…", "White Envelopes 25
envelop…". The unit is baked into the name, so the line is spent on "1
notebook" and then runs out. Meanwhile the description gets two full lines and
truncates mid-word.

The card gives more room to filler than to the name of the thing being sold.

---

## What has been fixed in this pass

| finding                                              | state                     |
| ---------------------------------------------------- | ------------------------- |
| 1. Retry-order dead end at the same table            | **fixed**, with two tests |
| 2. Voice sheet offering the same thing three times   | **fixed**, with two tests |
| `lift()` silently returning a signature with no body | **fixed**, now asserts    |

Findings 3 to 7 are layout and information-design work on the menu and basket.
They are real and they are what "half the screen is empty" and "reduce empty
spaces" have been pointing at, but each changes what a customer sees on the
busiest screen in the product, so they want deciding rather than assuming.

## How to re-run this

```
node scripts/dev/shoot.cjs                     # the sandbox, every step
node scripts/dev/shoot.cjs --at https://...     # somewhere else
```

Every frame lands in `docs/journey/`. A tap that finds nothing is reported as
`MISS` and the run carries on, because a missing control is itself a finding.
