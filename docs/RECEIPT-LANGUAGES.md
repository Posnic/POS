# Receipt text in different languages

Desktop receipts and queued bills automatically use printer graphics when
their text contains non-ASCII characters. Chromium shapes and wraps the text
before POSNIC sends ESC/POS raster strips through the usual printer queue.
The preview reads those same bytes. ASCII receipts retain the existing fast
text path, including the downloadable euro symbol.

The installer includes offline fonts for every language currently offered in
`frontend/gulpfile.js/config.js`: English, Tamil, Hindi, Malayalam, Kannada,
Telugu, Sinhala, Nepali, Arabic, French, Spanish, Portuguese, Indonesian,
Thai, German, Swahili, Dutch and Italian. Font selection follows the characters
in the receipt, so product names can mix languages independently of the UI.

Unicode text is never flattened to ASCII on the graphics path. Languages
outside this bundled coverage use Chromium's system font fallback; their
fonts must be present on the computer. This is not a claim that every Unicode
script is bundled. Kitchen tickets and roll reports have separate renderers.

## Validation

- `node --test tests/escpos-unicode.test.js tests/receipt-fonts.test.js`
- `electron tests/tools/arabic-receipt-proof.js` checks the original regression,
  long receipts, edge-to-edge graphics and repeatable output.
- `electron tests/tools/multilingual-receipt-proof.js` renders all language
  samples on 58mm and 80mm rolls, checks font use through Chromium, and writes
  previews when `POSNIC_PRINT_TEST_DIR` is set. Neither proof sends print jobs.

Font coverage and test samples are checked against the language catalogue. To
add another language, add its sample in `tests/fixtures/receipt-languages.json`
and, if needed, its unmodified Noto font and original OFL licence in
`src/fonts/`. Include both in `package.json`'s `build.files`, update the notices,
and regenerate `manifest.json` with `scripts/build-receipt-font-manifest.py`.
The manifest contains Unicode cmap ranges, source URLs and checksums; no font
parsing dependency is needed at runtime.
