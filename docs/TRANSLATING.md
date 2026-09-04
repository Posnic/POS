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
> falls back to English. You can correct ten strings, open a pull request,
> and it is a real improvement. Nobody is waiting for you to do all of them.

---

## Which languages, and how far along

| Language | Code | Keys answered | Read by a speaker? |
|---|---|---|---|
| English | en | in the app itself | yes |
| தமிழ் Tamil | ta | all | **yes** |
| हिन्दी Hindi | hi | all | not yet - marked *beta* |
| മലയാളം Malayalam | ml | all | not yet - marked *beta* |
| ಕನ್ನಡ Kannada | kn | all | not yet - marked *beta* |
| తెలుగు Telugu | te | all | not yet - marked *beta* |
| සිංහල Sinhala | si | all | not yet - marked *beta* |
| नेपाली Nepali | ne | all | not yet - marked *beta* |
| العربية Arabic | ar | all | not yet - marked *beta*, right-to-left |
| Français French | fr | all | not yet - marked *beta* |
| Español Spanish | es | all | not yet - marked *beta* |
| Português Portuguese | pt | all | not yet - marked *beta* |
| Bahasa Indonesia | id | all | not yet - marked *beta* |
| ไทย Thai | th | all | not yet - marked *beta* |
| Deutsch German | de | all | not yet - marked *beta* |
| Kiswahili | sw | all | not yet - marked *beta* |
| Nederlands Dutch | nl | all | not yet - marked *beta* |
| Italiano Italian | it | all | not yet - marked *beta* |

### Which language is added next, and why

The queue is not a list of the world's biggest languages. It is the countries
that have actually sent Posnic a signup and had nothing here to read the till
in, most signups first:

| Next | Code | Signups waiting on it |
|---|---|---|
| Filipino | tl | Philippines |
| Български | bg | Bulgaria |
| Bosanski | bs | Bosnia and Herzegovina |
| ភាសាខ្មែរ | km | Cambodia |
| Čeština | cs | Czechia |
| Azərbaycan | az | Azerbaijan |
| Kinyarwanda | rw | Rwanda |

Swahili came off the top of that list first: Kenya, Tanzania, Uganda and DR
Congo had all sent a signup with nothing here to read. Dutch and Italian
followed for Belgium, Switzerland and Malta.

### Adding one

1. Add a column to `languages/_glossary.json` - the 147 shared terms.
2. Add `{ code, name, flag, reviewed: false }` to
   `frontend/gulpfile.js/config.js`.
3. `node tests/tools/seed-from-glossary.js --write` - fills about 200 of the
   662 keys from the glossary alone.
4. `node tests/tools/i18n-coverage.js --worksheet <code>` - writes the other
   463 to `<code>-to-translate.json`.
5. Fill the blanks, then
   `node tests/tools/i18n-coverage.js --merge <code> --out <code>-to-translate.json`.
6. `node tests/tools/check-translations.js` and `npm test`.

Step 4 is the real work, and it is where a language earns its place: those 463
are the terms of art - opening float, input tax credit, KOT, PAX, parked sale,
split payment - plus 26 strings carrying HTML that has to survive intact. A
pack has to answer 95% of the keys before it may ship (`tests/i18n.test.js`),
which is what stops a half-English screen reaching a real till.

**Every language ships in every build.** Pick it from the menu in the header of
any Posnic and the switch is instant. A language nobody who speaks it has read
yet is marked *beta* beside its name, and hovering shows how many of the app's
strings it answers. That mark is the whole review process made visible: it
comes off when a speaker has been through the common screens.

### Where the words came from

The glossary was written first: one settled word per POS term, every language
side by side. The packs were seeded from it, then completed by machine
translation on 2026-09-02 against the glossary and the screen each string sits
on. So they are consistent - Save is the same word on every screen - and they
are complete, but **they have not been read by a person who speaks the
language**, which is the thing that matters most and the thing we cannot do
ourselves.

The owner's decision was to ship them anyway, honestly labelled, rather than
hold them back: a shopkeeper who can read most of their screen is better off
than one reading none of it, every wrong word can be fixed by anybody who
notices it, and a language nobody can see is a language nobody will ever
correct.

---

## The most useful thing you can do: review a beta language

**Reviewing is worth more than translating.** Every key already has words in
it. What no tool can tell us is whether they are the right words - whether
"Register" came out as the cash drawer or as signing up, whether "Return" reads
as a refund on the sale screen.

1. Open Posnic (any build, or https://develop.posnic.io), pick your language
   from the menu in the header.
2. Walk through a sale: login, dashboard, new sale, payment, sales history,
   items, customers, reports.
3. Every wrong or awkward word: fix it in `languages/<code>.json` and open a
   pull request. Ten corrections are a real contribution.

Run the mechanical review first - it finds the two mistakes a non-speaker can
find, and hands you a short list rather than 650 strings:

```bash
node tests/tools/i18n-coverage.js --review hi
```

- **The same English translated two different ways** - the app calling one
  thing by two names on different screens.
- **The same translation used for two different English words** - which means
  at least one of them is wrong.

The second is how we found that every Edit button in Tamil said "Edited".

Say in the PR that you speak the language - that is the thing we cannot check.

### Taking the beta mark off

A language stops being *beta* when somebody who speaks it has been through the
common screens above and says so in a PR. Flip `reviewed: false` to
`reviewed: true` on its line in `frontend/gulpfile.js/config.js`. That one
line is the difference.

An installer that wants only reviewed languages in its menu can be built with
`POSNIC_REVIEWED_LANGUAGES_ONLY=1`. The default build does not.

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
seen the screen it appears on and the glossary has not. To push a corrected
glossary word through to a key that already had a translation, change the key
in the pack as well.

### Words that must never be translated

`GST`, `CGST`, `SGST`, `IGST`, `HSN`, `SKU`, `GTIN`, `EAN`, `UPI`, `MRP` and the
rest of the `doNotTranslate` list stay in Latin script exactly as they are. A
shopkeeper matches them against a government form, character for character.

### Strings that carry markup

A few strings carry an icon or a `<span>` the app rewrites later, for example
`<i class="feather icon-download mr-2"></i>Download`. Keep every tag exactly
where it is and translate only the words. If you leave the tag out, the app
keeps the page's icon and swaps the words, so nothing breaks - but a `<span>`
the code writes into later must survive, or that write lands nowhere.

---

## Keeping a language up to date

When a screen gains a new string, every pack is behind by one key until
somebody fills it. A test holds every pack at or above the point it last
reached (`tests/i18n-coverage-baseline.json`, refreshed with
`--write-baseline` after a merge), so a language can only move up. Find what
is missing:

```bash
node tests/tools/i18n-coverage.js
node tests/tools/i18n-coverage.js --missing hi
```

Get a worksheet with the English and the screen beside each blank:

```bash
node tests/tools/i18n-coverage.js --worksheet hi
```

That writes `hi-to-translate.json`:

```json
"lang_conversion_factor_title": {
  "english": "Units per pack",
  "screen": "items_write.html",
  "hi": ""
}
```

Fill in the `hi` field on the ones you know. Leave the rest blank. Then:

```bash
node tests/tools/i18n-coverage.js --merge hi --out hi-to-translate.json
```

Blank entries are skipped, so you can do this as many times as you like.

---

## Starting a language nobody has done yet

```bash
node tests/tools/i18n-coverage.js --new de
```

Fill in what you can, then merge - this is what creates `languages/de.json`:

```bash
node tests/tools/i18n-coverage.js --merge de --out de-to-translate.json
```

One more step, and the tool reminds you: add the language to `LANGUAGES` in
`frontend/gulpfile.js/config.js`, or the app will not offer it in the menu.

```js
{ code: 'de', name: 'Deutsch', flag: 'de', reviewed: false },
```

Write `name` **in the language itself**. Somebody looking for German is looking
for Deutsch, not for "German". Add `dir: 'rtl'` for a right-to-left script.
Add the code to `languages` in `_glossary.json` too, and fill the glossary
column first - it is the fastest way to a consistent pack.

---

## Adding text to the app (for developers)

Every word a person reads has to be reachable by a key, or it is English in
every language. Three shapes, one runtime:

| Where the words are | Write | Translated by |
|---|---|---|
| Template text | `<lang class="lang_key">English</lang>` | `PosnicPro.i18n.apply()` at load |
| Inside `<title>` or `<option>` | the same tag - the build hoists it to `data-t="lang_key"` | apply() |
| `placeholder`, `title`, `aria-label` | `placeholder="English" data-t-placeholder="lang_key"` | apply() |
| Markup JavaScript renders (table headers, pills, modal bodies) | `'<th><lang class="lang_key">Bill #</lang></th>'` | `PosnicPro.i18n.watch()` as it lands |
| Text JavaScript sets (`.text()`, toasts, labels, ternaries) | `PosnicPro.i18n.t('lang_key', 'English')` | at the call |

The English is the fallback, physically present in every case, so a missing
key never shows anything worse than English.

**One thing to watch:** `t()` evaluated when a module *loads* runs before any
pack has arrived, so a top-level object literal must carry `<lang>` markup
instead of `t()` (see `PosnicPro.dashboard.SETUP_CARDS`). Calls inside
functions are fine.

You do not have to do this by hand. After adding a screen:

```bash
node tests/tools/i18n-tag.js --write        # templates: text nodes and attributes
node tests/tools/i18n-tag-js.js --write     # JavaScript: markup literals and t() calls
node tests/tools/i18n-gaps.js               # what is still bare, per template
node tests/tools/i18n-coverage.js           # which packs now have gaps
```

Keys are minted from the English (`lang_add_to_bill`), and the same English on
two screens shares one key. Then hand the new keys to translators with
`--worksheet <code>`. Two tests hold this: bare English in the templates must
stay near zero, and no pack may slip below the coverage it last reached.

---

## Right-to-left languages

Arabic switches the whole app to right-to-left: the sidebar moves to the
right, tables and text mirror, numbers and codes stay left-to-right inside the
sentence. That is a first pass, done from the layout rules rather than from
every screen. If a screen looks wrong in Arabic - something overlapping, a
button on the wrong side - report it against issue #32 with the screen name.
The rules live in `frontend/static/style/css/rtl.css`, scoped under
`[dir="rtl"]`, and a fix is usually one line there.

---

## Before you open the pull request

```bash
node tests/tools/i18n-coverage.js
node --test tests/i18n.test.js
```

### Save as UTF-8. This one matters more than it sounds.

Nine Tamil strings once shipped to the sale screen as `à®ªà¯à®¤à®¿à®¯` where
they meant `புதிய` - the text had been saved in the wrong encoding somewhere
along the way. It was live for months, because it is invisible in code review
to anyone who does not read the language.

The tools now refuse a file that has it, and so does the build. If your editor
offers "ANSI", "Windows-1252" or "Western", do not use it.

### What not to change

- Do not rename keys. A key is how the app finds the words.
- Do not touch anything outside `languages/` and the one line in `config.js`.
- Do not translate a key you cannot see in context if you are unsure - leaving
  it as it is and saying so in the PR is better than guessing wrong.

---

## Seeing your work

You do not need this to contribute, but it is the fastest way to catch a word
that is right in the dictionary and wrong on the button.

```bash
npm run dev
```

Open http://localhost:3000/public/login.html, sign in, and pick your language
from the menu in the top bar. The switch is instant - the page does not reload.

On a machine where nobody has chosen a language yet, Posnic starts in the
browser's language if it ships it (BCP 47 lookup: `pt-BR` first, then `pt`),
else English. A choice, once made, is never second-guessed.

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

## Reviewing somebody else's language

You do not have to speak a language to check that a pull request is safe:

- Only `languages/` and at most one line of `config.js` changed.
- No keys renamed or removed - `--missing` should not grow.
- CI is green.

Whether the words are *good* needs a speaker. Say which you checked.
