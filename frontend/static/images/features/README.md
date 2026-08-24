# Feature screenshots

Drop a PNG in here and it appears on that feature's page in Settings. No code
change, no list to update.

## Naming

```
<feature_key>-1.png     first screenshot
<feature_key>-2.png     second, and so on
```

The feature key is the toggle's id — the same string used in
`PosnicPro.settings.featureInfo`. The current ones:

| Feature | File to add |
|---|---|
| Quotes | `quotes_enable-1.png` |
| Shifts & clock-in | `staff_shifts_enable-1.png` |
| Tips | `staff_tips_enable-1.png` |
| Roster | `staff_roster_enable-1.png` |
| Till PIN lock | `till_lock_enable-1.png` |
| Cash register | `cash_register_enable-1.png` |
| Taxes | `module_tax_enable-1.png` |
| Customer credit | `module_credit_enable-1.png` |
| Marketing | `module_marketing_enable-1.png` |
| Messaging | `module_messaging_enable-1.png` |
| Sales channels | `module_channels_enable-1.png` |
| Cash book | `module_cashbook_enable-1.png` |
| Quick sale | `quick_sale_enable-1.png` |
| Recycle bin | `module_recyclebin_enable-1.png` |
| Themes | `module_themes_enable-1.png` |
| Restaurant / tables | `table_options-1.png` |
| Custom charges | `custom_charges_enable-1.png` |

## Size

**8:5, e.g. 1600×1000.** The frame is fixed at that ratio in CSS
(`.fd-shots img { aspect-ratio: 8/5 }`), so anything else is **cropped to fit,
not letterboxed** — a 16:9 screenshot loses its top and bottom.

Take them at normal browser zoom, from a shop with realistic data in it. An
empty demo shop photographs badly: a feature page selling Marketing with an
empty campaign list argues against itself.

## How it finds them

`-1` is requested when the page opens. If it loads, `-2` is requested, and so on
up to ten. So a feature with no screenshots costs exactly one failed request,
not one per slot guessed — and adding `-2.png` later needs no other change.

A file that is not there removes its own frame, and the strip disappears when
empty, so a missing screenshot shows nothing rather than a broken-image icon.

## Overriding the convention

Set `shots: ['some/other/path.png']` on the feature's `featureInfo` entry in
`frontend/static/script/js/modules/js/settings.js`. An explicit list wins and
the probing is skipped entirely.
