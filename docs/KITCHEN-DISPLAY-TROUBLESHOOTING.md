# Kitchen display troubleshooting

In the desktop app, open **Hardware Manager > Kitchen Screen**. Select the
external monitor and enable **Use as kitchen screen**. The board fills that
monitor without moving the till or taking keyboard focus.

**Orders from branch** is independent of kitchen printing. Automatic uses the
saved kitchen printer branch, or the only local branch. If there are several
branches and none is selected, choose the branch here and Save. No printer is
required. After changing it, allow up to five seconds for orders to load.

The board shows a connection message when orders cannot be loaded. During an
outage, existing tickets remain visible with an out-of-date warning. Once the
local service responds, the board updates automatically. Preview contains
sample orders; enable the display for live service.

For a physical display showing lines or flickering, test a short cable at the
same resolution and refresh rate. This software change does not repair an
unstable HDMI connection.

## Local verification

Run the kitchen display regression, kitchen screen, and IPC hardening tests
with Node's test runner. `tests/tools/kitchen-display-proof.cjs` is an optional
Electron smoke test: launch it with the repository's Electron executable. It
briefly displays a test ticket on the secondary monitor (primary if no secondary
is connected), verifies the sandboxed preload/IPC handshake, rendered ticket,
and exact monitor bounds, then closes. It never reads shop data or prints.
