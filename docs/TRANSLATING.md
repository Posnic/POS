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
  ta.json      Tamil
  <code>.json  one file per language
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
