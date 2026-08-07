# Hardware support

What Posnic works with, and — as importantly — how far each claim has actually
been checked.

**Read the "Verified" column before buying anything.** Most retail hardware
follows a common standard and works without configuration, but "should work by
standard" and "we plugged one in" are different claims and are marked
differently here.

| Mark | Meaning |
|---|---|
| **Tested** | Exercised on real hardware, and covered by automated tests |
| **Code-tested** | The protocol is covered by automated tests; no device on a desk yet |
| **By standard** | Follows a standard Posnic implements, but this model has not been tried |

---

## Computer

| | Minimum | Recommended |
|---|---|---|
| Operating system | Windows 10 64-bit, version 1809 | Windows 11 64-bit |
| Processor | Dual core, 2 GHz | Quad core |
| Memory | 4 GB | 8 GB |
| Free disk | 5 GB | 20 GB, SSD |
| Display | 1366 × 768 | 1920 × 1080, or a touchscreen |

**32-bit Windows is not supported**, and neither is Windows 8.1 or earlier —
the bundled MongoDB and Electron both require 64-bit and a current Windows.

An SSD matters more than the processor. The database and the application both
sit on it, and it is the difference between a two-second and a ten-second
launch.

macOS and Linux builds are published and the application runs on both. They are
tested far less than Windows, and no retail hardware has been tried on either.

---

## Receipt printers

| Connection | Verified | Notes |
|---|---|---|
| USB thermal, 80 mm | **Code-tested** | The common case. Install the vendor driver first, then pick it in Device Setup |
| USB thermal, 58 mm | **Code-tested** | Set the paper width in Device Setup or receipts print wrong |
| Network (LAN/Wi-Fi) thermal | **By standard** | Needs a fixed IP on the printer |
| Bluetooth thermal | **By standard** | Pair in Windows first |
| A4 / Letter laser or inkjet | **Code-tested** | For invoices and reports rather than receipts |

Receipts are sent as **ESC/POS** — a byte stream straight to the printer, with
no page rendering, no scaling and no driver layout. That is why they come out
identical on different printers and why they are fast. Column widths, wrapping
and totals alignment are covered by `escpos-receipt.test.js`,
`escpos-columns.test.js` and `escpos-report.test.js`.

If a printer will not take ESC/POS, Posnic falls back to rendering a page and
printing it through the Windows driver. That path works with anything Windows
can print to, and is slower.

**Any printer Windows can see should work.** If Notepad can print to it, Posnic
can.

---

## Barcode scanners

| Type | Verified | Notes |
|---|---|---|
| USB keyboard-wedge (HID) | **By standard** | Nearly all of them. No configuration at all |
| Bluetooth keyboard-wedge | **By standard** | Pair in Windows; behaves as a keyboard |
| 2D / QR imagers | **By standard** | Work if set to keyboard-wedge mode |

A keyboard-wedge scanner types the barcode and presses Enter. Posnic needs no
driver and no setting for it — put the cursor in the search box and scan.

Scanners set to **serial (COM port) mode** are not supported. Switch the device
to keyboard-wedge; every scanner that offers serial also offers HID.

---

## Cash drawers

| Connection | Verified | Notes |
|---|---|---|
| Driven by the receipt printer (RJ11/RJ12) | **By standard** | The usual arrangement. Opens on print |
| USB drawer | **By standard** | Needs its own driver |

Almost all drawers plug into the printer, not the computer, and open when a
receipt prints. If yours does not open, the printer is usually the thing to
check.

---

## Weighing scales

| Protocol | Verified | Notes |
|---|---|---|
| Essae DS-series continuous output | **Code-tested** | DS-0 through DS-7 frame formats are parsed and tested |
| T-Scale continuous output | **Code-tested** | Covered by `scale-parser.test.js` |
| Generic continuous ASCII over serial | **Code-tested** | Anything that streams a weight and a stability flag |

Connection is **serial over USB**, 9600 baud by default, configurable in Device
Setup.

The parser handles partial frames, stability flags and unit suffixes, and is the
most thoroughly tested hardware code in the project — because a scale that
misreads by a decimal place overcharges a customer, and nobody notices for
weeks.

A scale in **print mode** rather than continuous mode will not work; it only
sends on a button press. Set it to continuous output.

---

## Customer displays and kiosks

| Type | Verified | Notes |
|---|---|---|
| Second monitor as customer display | **By standard** | Shows the running total to the customer |
| Touchscreen kiosk / catalog display | **By standard** | A customer-facing browsing screen |
| Pole display (serial VFD) | **Not supported** | No driver. Use a second monitor |

Any second screen Windows recognises can be a customer display — there is no
special hardware.

---

## What is not supported

Stated so nobody buys one expecting it to work.

- **Serial-mode barcode scanners** — switch to keyboard-wedge
- **Serial pole/VFD displays** — no driver
- **Integrated card terminals** — payments go through Razorpay or PhonePe, or
  are recorded as taken on a separate machine. Posnic does not drive a PIN pad
- **RFID and NFC readers**
- **Scales in print-on-demand mode**
- **Label printers** — item labels are not implemented

---

## Before you buy

1. **Prefer USB** over Bluetooth and network for a till. Fewer things to fail
   at nine in the morning.
2. **Check the printer speaks ESC/POS.** Nearly every 80 mm thermal printer
   does; it is usually on the box.
3. **Check the scale can do continuous output**, not print-on-demand.
4. **Buy one and test it before buying ten.** Especially if it is not in the
   tables above.
5. **Test every device from Device Setup before trusting it in a queue** —
   there is a test button for each, and that is the moment to find a problem.

---

## Something not listed here

If you have hardware that works, tell us and it goes in the table with the
right mark — that is how "by standard" becomes "tested". If you have hardware
that does not, open an issue with the make, model, connection and what happened.

[Issues](https://github.com/Posnic/POS/issues) ·
[Discussions](https://github.com/Posnic/POS/discussions)
