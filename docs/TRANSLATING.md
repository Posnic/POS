# Translating Posnic

Posnic is used by shopkeepers who do not necessarily read English. If you speak
another language, this is the most useful thing you can contribute, and it is
the one task here that needs **no knowledge of the codebase at all**.

You need Node.js and a text editor. You do not need to run the app, install a
database, or understand JavaScript.

Tracking issue: [#32 Language pack contributions](https://github.com/Posnic/POS/issues/32).

---

## Where the words live

```
languages/
  _glossary.json   the shared vocabulary: one row per term, every language
  ta.json          Tamil
  <code>.json      one file per language
```

Each file maps a key to the words a shopkeeper reads:

```json
{
  "lang_save_title": "சேமி",
  "lang_new_title": "புதிய"
}
```

The English is **not** in these files. It lives in the app itself, and it is
what shows when a translation is missing. That is the most important thing to
understand here:

> **A half-translated language is not broken.** Every key you have not done
> falls back to English. You can translate ten strings, open a pull request,
> and it is a real improvement. Nobody is waiting for you to do all of them.

---

## The fastest way to help: review a draft

Thirteen languages have a **draft** pack already. Every word in them was seeded
from the glossary, and **not one has been read by somebody who speaks the
language.** That is why drafts are not offered to shopkeepers: a draft is a
starting point for you to correct, never a finished translation.

| | |
|---|---|
| Drafts | Hindi, Malayalam, Kannada, Telugu, Sinhala, Nepali, Arabic, French, Spanish, Portuguese, Bahasa Indonesia, Thai |
| Reviewed | English, Tamil |

**Reviewing is more valuable than translating more keys.** About 200 keys per
language are filled in; the other 450 show English, which is readable. A wrong
word is not: it looks exactly like a right one until something goes wrong at
the counter.

See your language on a real screen at **https://develop.posnic.io** - the
sandbox is the one place drafts are switched on. Pick your language from the
menu in the header, then walk through a sale.

When you find something wrong, fix `languages/<code>.json` and open a pull
request. Ten corrections are a real contribution. Say in the PR that you speak
the language - that is the thing we cannot check ourselves.

### Getting a draft promoted

A language stops being a draft when somebody who speaks it has been through the
common screens: login, dashboard, new sale, payment, sales history, items,
customers, reports. Say so in your PR and remove `draft: true` from its line in
`frontend/gulpfile.js/config.js`. That one line is what puts it in front of
shopkeepers.

---

## The glossary

`languages/_glossary.json` holds the words that appear everywhere - Save, Item,
Customer, Total - with every language on one line:

```json
"Save": {"ta": "சேமி", "hi": "सहेजें", "fr": "Enregistrer", "es": "Guardar"}
```

Tamil is the cautionary tale for why this exists. Translated key by key over
several years, it ended up with `Apply` and `Search` sharing a word, `Item
position` labelled with the words for `branch access`, and every Edit button
reading as `Edited`, past tense. Nobody made a mistake. It is what happens when
the same English word is translated seven times by people who cannot see each
other's work.

Fixing a glossary row fixes every screen that uses the word at once:

```bash
# edit languages/_glossary.json, then
node tests/tools/seed-from-glossary.js            # what would change
node tests/tools/seed-from-glossary.js --write    # do it
```

The seeder **never overwrites a translation somebody has already written.** If
you have translated a key, your word wins over the glossary, always - you have
seen the screen it appears on and the glossary has not.

A blank in the glossary is deliberate, not a gap to fill with a guess. It means
nobody has confidently settled that term, and English shows instead.

### Words that must never be translated

`GST`, `CGST`, `SGST`, `IGST`, `HSN`, `SKU`, `GTIN`, `EAN`, `UPI`, `MRP` and the
rest of the `doNotTranslate` list stay in Latin script exactly as they are. A
shopkeeper matches them against a government form, character for character.

---

## Improving a language that already exists

Tamil is 89% done. Find out what is missing:

```bash
node tests/tools/i18n-coverage.js
node tests/tools/i18n-coverage.js --missing ta
```

Get a worksheet with the English and the screen beside each blank:

```bash
node tests/tools/i18n-coverage.js --worksheet ta
```

That writes `ta-to-translate.json`:

```json
"lang_conversion_factor_title": {
  "english": "Units per pack",
  "screen": "items_write.html",
  "ta": ""
}
```

Fill in the `ta` field on the ones you know. Leave the rest blank. Then:

```bash
node tests/tools/i18n-coverage.js --merge ta --out ta-to-translate.json
```

Blank entries are skipped, so you can do this as many times as you like.

---

## Starting a language nobody has done yet

```bash
node tests/tools/i18n-coverage.js --new hi
```

Fill in what you can, then merge — this is what creates `languages/hi.json`:

```bash
node tests/tools/i18n-coverage.js --merge hi --out hi-to-translate.json
```

One more step, and the tool reminds you: add the language to `LANGUAGES` in
`frontend/gulpfile.js/config.js`, or the app will not offer it in the menu.

```js
{ code: 'hi', name: 'हिन्दी', flag: 'in' },
```

Write `name` **in the language itself**. Somebody looking for Hindi is looking
for हिन्दी, not for "Hindi".

---

## Before you open the pull request

```bash
node tests/tools/i18n-coverage.js
node --test tests/i18n.test.js
```

### Save as UTF-8. This one matters more than it sounds.

Nine Tamil strings once shipped to the sale screen as `à®ªà¯à®¤à®¿à®¯` where
they meant `புதிய` — the text had been saved in the wrong encoding somewhere
along the way. It was live for months, because it is invisible in code review
to anyone who does not read the language.

The tools now refuse a file that has it, and so does the build. If your editor
offers "ANSI", "Windows-1252" or "Western", do not use it.

### What not to change

- Do not rename keys. A key is how the app finds the words.
- Do not touch anything outside `languages/` and the one line in `config.js`.
- Do not translate a key you cannot see in context if you are unsure — leaving
  it English is better than guessing wrong.

---

## Seeing your work

You do not need this to contribute, but it is the fastest way to catch a word
that is right in the dictionary and wrong on the button.

```bash
npm run dev
```

Open http://localhost:3000/public/login.html, sign in, and pick your language
from the menu in the top bar. The switch is instant - the page does not reload.

A string that overflows its button or wraps badly is worth reporting even if
the translation itself is correct. Screens were laid out around English, and
some languages simply need more room.

## Words that are hard to translate

A POS has terms of art. Machine translation gets these wrong in ways a
shopkeeper notices immediately:

| Term | What it means here |
|---|---|
| Sale | One completed transaction with a customer |
| Return | Goods coming back from a customer |
| Receiving | Goods arriving from a supplier |
| Register | The physical till and its cash session |
| Shift | One person's period of working the till |
| Tender | The money handed over, and how (cash, card) |
| Void | Cancelling a line or a sale before it completes |
| Customer credit | Goods taken now, paid later |
| Stock | Quantity on hand |
| Branch / outlet | One shop location |

If your language has a word shopkeepers actually use, prefer it over the
literal translation. The person reading this screen is standing behind a
counter, not reading a manual.

Please note anything you had to make a judgement call on in the PR description.
That is the part a reviewer cannot check for themselves.

---

## Checking your own work

Two things go wrong that a reviewer cannot see, and the tool finds both:

```bash
node tests/tools/i18n-coverage.js --review ta
```

- **The same English translated two different ways** — the app calling one
  thing by two names on different screens.
- **The same translation used for two different English words** — which means
  at least one of them is wrong.

The second is how we found that every Edit button in Tamil said "Edited".

---

## Reviewing somebody else's language

You do not have to speak a language to check that a pull request is safe:

- Only `languages/` and at most one line of `config.js` changed.
- No keys renamed or removed — `--missing` should not grow.
- CI is green.

Whether the words are *good* needs a speaker. Say which you checked.
