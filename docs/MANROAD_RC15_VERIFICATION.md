# Sales / Basket Review rc15 delivery — 8 October 2026

Scope: Sales only. Basket Review declares its buttons, destinations, submit/hold actions and successful commands that clear the native cart. Core validates and renders generic contributions. No item/customer/purchase/settings hooks added.

Desktop host b56cc4a; cloud host ae90b71; private extension 151b7bad9dd5 / 0.1.1-rc.15. Capability sales.workspace-contributions.v1 is required, with incompatible hosts rejected. Future core releases must preserve this contract; this is not a claim that any existing standard installer already supports it.

Cloud: https://manroad.posnic.io/dashboard.html#/sales/new
Release: /home/ubuntu/apps/releases/manroad-workflow-20261008-rc15
Database backup: /home/ubuntu/apps/backups/manroad-rc15-1791433439330/manroad.archive.gz

Verification: 32 workflow/browser/host tests passed; generic manifest validation tests passed; signed installation, activation/rollback and Mongo integration passed. Live Sales controls rendered; Adjust Basket opened within Sales; a £1 native cart transferred into card preparation with correct totals and held NO. Preparation cancelled without payment. Held basket resumed, labelled rc15 deployment verification — unpaid test, adjusted YES and returned to stock. Audit retained. No real payment taken.

Windows 1.9.3-manroad.15 built. Packaged generic services and receipt helper equal source; native runtime check passed for 29 binaries. Installer SHA512 matches latest.yml. EXE has no Authenticode signature; extension ZIP is signed. Install both together following INSTALLATION.txt. Physical till installation, printer output and on-device sync acceptance remain pending.

## Additional live verification

8 October 2026: server current pointer confirmed 0.1.1-rc.15 and dashboard HTTP 200. Built-in browser verified daily/monthly reports, completed receipt list, common-price item entry, sale-only price override and tax recalculation, native payment drawer contribution controls, Confirm Sale using selected cash method, cancellation without recording payment, resume, adjustment and return. Labelled test quantity restored; native cart cleared. Monthly payments remained GBP58.22 and unpaid adjustments GBP6.54 before/after.

Additional receipt rendering/assets/page-layout suite: 51 tests passed (rc15-print-verification.log). Paid receipt printing reached the native browser print flow, but the embedded dialog blocked automation and the extension showed a response timeout. The tab was recovered. This is NOT an end-to-end print pass; browser dialog completion and physical printer acceptance remain unverified. No claim of fully completed printer verification.
