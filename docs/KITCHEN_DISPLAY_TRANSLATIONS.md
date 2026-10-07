# Kitchen display translations

The public catalog is `api/src/kitchen-board/locales/en.json`. Keys are complete
English interface phrases; `{name}` and other placeholders contain runtime data.
Order data, dish names, staff names and notes are never sent for translation.

On 2026-10-07, `scripts/translate-kitchen-display.py` used AWS Translate
`TranslateDocument` in ap-south-1 to generate 197 phrases for 56 languages.
Tamil display-setting phrases were edited after visual review found incomplete
machine output. These packs still need native-speaker review; AWS generation is
not a claim of reviewed translation quality. Nepali is unsupported by AWS and
falls back to English. `nb` maps to AWS `no`, `zh-CN` to `zh`.

To translate newly added phrases, install boto3 in your development Python
environment, configure an authorized AWS profile, and run:

    python scripts/translate-kitchen-display.py --profile YOUR_PROFILE --region ap-south-1

The command reuses existing translations, preserves manual corrections, checks
placeholder integrity, and writes only public static catalogs. It is not part of
app startup or CI and makes no runtime translation calls. The shared runtime and
packs are also explicitly included in the desktop package.

Language uses an explicit `?lang=ta` URL first, then the display's saved language,
the POS language preference when available on the same origin, then the browser
language. Change it in display settings. The interactive display's language
switch does not reset input values. RTL languages set page direction. The service
worker caches only public UI files and locale packs, never order/API responses.

Verify with:

    node --test tests/kitchen-display-i18n.test.js tests/kitchen-board.test.js
