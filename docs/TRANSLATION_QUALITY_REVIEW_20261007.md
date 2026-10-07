# Translation quality review - 2026-10-07

## Result

AWS Translate is useful for clear source sentences, but raw output is not a
quality upgrade for short POS labels. Existing good wording must win over a
new machine suggestion. No language was promoted to native-speaker reviewed.

The review checked all 57 main POS packs for structural problems, protected
labels and long untranslated English sentences. It compared 98 payment,
restaurant, inventory and sales labels in each of the 56 AWS-supported
languages (5,488 existing entries), using AWS forward suggestions and reverse
translations as evidence. Reverse translation is not a quality score: it also
misread correct Tamil accounting terms. This was a focused semantic review,
not native-speaker certification of every sentence or screen layout.

## Changes

- 22 Tamil corrections, including Total Sales incorrectly saying a returns
  count, Item Position saying branch access, Apply saying Search, opening cash
  saying an unlocked amount, and translated CGST/SGST/IGST/SKU abbreviations.
- 461 contextual corrections in 45 other language packs. The affected concepts
  include cash returned to a customer, a cash register, opening cash balance,
  price quotations, food served, goods received and invoice items.
- The Tamil glossary now distinguishes Apply from Search and uses the same Cash
  term as the payment screen.
- `languages/_translation-context.json` supplies explicit business meanings for
  ambiguous keys to the missing-only AWS translation script. Runtime English
  labels remain unchanged. Context must preserve all markup and placeholders.
- Existing accurate French, German, Italian, Spanish and other wording is kept
  where a literal AWS proposal would make it worse.

## Examples from the comparison

| Source | Problem found | Decision |
| --- | --- | --- |
| Mark served | Raw AWS treated Mark as a person's name, such as Italian “Mark ha servito”. | Keep correct existing wording; use explicit food-serving context for selected corrections. |
| Quotes | Raw AWS offered French “Citations”, meaning quoted speech. | Preserve “Devis”; specify price quotations for draft packs. |
| Change to return | Raw AWS offered German “Zur Rückgabe ändern”, meaning change something for return. | Preserve “Rückgeld”; specify money returned to the customer for draft packs. |
| Total Sales | Existing Tamil described a reimbursement count. | Correct to “மொத்த விற்பனை”. |
| Choose Register | Several draft translations referred to signing up or registration. | Specify a cash register. |
| Receivings | Some draft translations referred to receivables, revenue or invitations. | Specify goods received. |

## Suggestions withheld

40 contextual AWS suggestions remained ambiguous and were not applied. Existing
values remain for native review; their presence does not imply approval. The
keys below identify the outstanding proposals from this focused review.

| Language | Keys requiring review |
| --- | --- |
| bn | `lang_quotes`, `lang_quotes_title`, `lang_quotes_enable`, `lang_demo_kind_quotes`, `lang_kot_workspace_serve` |
| fa | `lang_quotes`, `lang_quotes_title`, `lang_quotes_enable`, `lang_demo_kind_quotes`, `lang_kot_workspace_serve` |
| fi | `lang_kot_workspace_serve` |
| ga | `lang_captain_change_to_return`, `lang_openamount_title`, `lang_opening_float`, `lang_choose_register`, `lang_chooseregistr_title` |
| gu | `lang_choose_register`, `lang_chooseregistr_title`, `lang_kot_workspace_serve` |
| hu | `lang_kot_workspace_serve` |
| ko | `lang_kot_workspace_serve` |
| lt | `lang_quotes`, `lang_quotes_title`, `lang_quotes_enable`, `lang_demo_kind_quotes` |
| mr | `lang_choose_register`, `lang_chooseregistr_title`, `lang_kot_workspace_serve` |
| mt | `lang_openamount_title`, `lang_opening_float` |
| pa | `lang_openamount_title`, `lang_opening_float` |
| sq | `lang_openamount_title`, `lang_opening_float` |
| ur | `lang_quotes`, `lang_quotes_title`, `lang_quotes_enable`, `lang_demo_kind_quotes` |
| zh-CN | `lang_kot_workspace_serve` |
| zh-TW | `lang_kot_workspace_serve` |

The Kannada `lang_search_calls_pending_settlement_or_review` remains English.
Its screen refers to metered search API calls, not telephone calls. The tested
AWS suggestions did not reliably convey that meaning, so no speculative phone
wording was substituted. Nepali was not submitted to AWS because it is not a
supported translation language.

## Verification

Translation JSON, runtime placeholders, protected abbreviations, glossary
consistency, existing language/runtime tests and the built language-pack output
are checked. No customer, payment, order or staff records were sent to AWS;
only checked-in public UI labels were submitted.
