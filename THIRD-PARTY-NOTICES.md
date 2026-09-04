# Third-party notices

Posnic's own source is distributed under GNU AGPL-3.0-only (see
[LICENSE](LICENSE)). Windows, macOS and Linux release packages also carry
software written by other people under their own licences. Those components
and known package notices are listed here. The root Posnic licence does not
replace a bundled component's licence.

This covers what ships **inside the installer**. Node packages pulled in at build
time carry their own licences in `node_modules`; `npm ls --omit=dev` will list
them for a given build.

---

## MongoDB Community Server

**Shipped as:** `resources/mongodb/bin/mongod.exe` on Windows and
`resources/mongodb/bin/mongod` on macOS and Linux
**Version:** 7.0.14 (exact bundled release matching installer build pin)
**Copyright:** © MongoDB, Inc.
**Licence:** Server Side Public License, Version 1 (SSPL-1.0)
**Source:** <https://github.com/mongodb/mongo>
**Official licensing information:**
<https://www.mongodb.com/legal/licensing/community-edition>

Posnic keeps a shop's data in a MongoDB instance running on the shop's own
computer. The server binary is redistributed unmodified.

MongoDB states that SSPL is not an OSI-approved open-source licence. Posnic's
own source and the MongoDB binary are recorded as separately licensed
components. Review the exact licences, package contents and intended use or
distribution rather than assigning one licence to the complete bundle. This
notice records technical provenance and is not legal advice.

If you would rather not receive it, the installer can be built without a bundled
MongoDB and pointed at one you already run; see `download-mongodb.bat`  and
`MONGODB_URI`.

## Node.js

**Shipped as:** the Node runtime inside Electron; and, in development trees only,
`nodejs/node.exe`
**Copyright:** © Node.js contributors. All rights reserved.
**Licence:** MIT, together with the licences of its own dependencies (OpenSSL,
ICU, zlib, libuv, V8 and others)
**Full text:** <https://github.com/nodejs/node/blob/main/LICENSE>

> Permission is hereby granted, free of charge, to any person obtaining a copy of
> this software and associated documentation files (the "Software"), to deal in
> the Software without restriction, including without limitation the rights to
> use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
> the Software, and to permit persons to whom the Software is furnished to do so,
> subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
> FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
> COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
> IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
> CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Electron

**Shipped as:** the application shell
**Copyright:** © Electron contributors; © 2013–2020 GitHub Inc.
**Licence:** MIT (Chromium and its own dependencies carry their own licences,
listed in `LICENSES.chromium.html` beside the installed application)
**Full text:** <https://github.com/electron/electron/blob/main/LICENSE>

## Microsoft Visual C++ Runtime

**Shipped as:** `resources/mongodb/bin/msvcp140.dll`,
`vcruntime140.dll`, `vcruntime140_1.dll` (Windows package only)
**Copyright:** © Microsoft Corporation
**Licence:** Redistributed under the Microsoft Visual Studio redistributable
terms, as files MongoDB requires to run.

These are Microsoft's redistributable runtime, included because `mongod.exe`
will not start without them on a machine that has never had a Visual C++
runtime installed.

## amCharts 4

**Shipped as:** `frontend/static/script/js/plugins/amcharts/`
**Copyright:** © amCharts
**Licence:** amCharts 4 is commercially licensed; the bundled build displays
its own attribution unless a licence key is configured.
**Terms:** <https://www.amcharts.com/online-store/licenses-explained/>

## Print.js

**Shipped as:** `frontend/static/script/vendor/print-js/`, copied by the
frontend build into `frontend/public/script/vendor/print-js/`
**Version:** 1.6.0
**Copyright:** © Rodrigo Vieira
**Licence:** MIT — full text in `LICENSE` beside the files
**Upstream:** <https://github.com/crabbly/print.js>

Used for barcode label printing. It was previously loaded from
cdnjs.cloudflare.com at run time, which meant the main application window
executed a third party's script on every launch with no integrity check, and
barcode printing did not work offline. It is vendored now, with its notice.

## Icon sets

**Shipped as:** `frontend/static/style/icons/`

Ten sets are bundled, after one unused copy was removed (below). None ships a
licence file, so the terms below were read from each project's published
package rather than from the vendored copy. Several are governed by more than
one licence — typically one for the code and another for the glyphs.

| Set | Upstream |
| --- | --- |
| Dripicons | <https://github.com/amitjakhu/dripicons> |
| Feather | <https://github.com/feathericons/feather> |
| Font Awesome | <https://github.com/FortAwesome/Font-Awesome> |
| Ionicons | <https://github.com/ionic-team/ionicons> |
| Line Awesome | <https://github.com/icons8/line-awesome> |
| Material Design Icons | <https://github.com/Templarian/MaterialDesign> |
| Simple Line Icons | <https://github.com/thesabbir/simple-line-icons> |
| Socicon | <https://www.socicon.com/> |
| Themify Icons | <https://github.com/lykmapipo/themify-icons> |
| Typicons | <https://github.com/stephenhutchings/typicons.font> |

### Licences

Taken from the published package for each project on 5 August 2026, using
`npm view <package> license`, and for the two share-alike sets by unpacking the
package and reading the licence file it carries. Not written from memory.

| Set | Licence | Source |
| --- | --- | --- |
| Dripicons | **CC BY-SA 4.0** | `dripicons` |
| Feather | MIT | `feather-icons` |
| Font Awesome | OFL-1.1 (fonts) AND MIT (code) | `font-awesome`, and the header in the shipped CSS |
| Ionicons | MIT | `ionicons` |
| Line Awesome | OFL-1.1 (fonts) AND MIT (code) | `line-awesome`, and the header in the shipped CSS |
| Material Design Icons | Apache-2.0 | `@mdi/font` |
| Simple Line Icons | MIT | `simple-line-icons` |
| Socicon | MIT | `socicon` |
| Themify Icons | ISC | `themify-icons` |
| Typicons | SIL OFL 1.1 (fonts) and CC BY-SA (artwork) | `typicons.font` |

**What this does and does not establish.** These are the terms the upstream
projects publish today. The copies bundled here were vendored at some earlier
point and their versions have not been matched against those releases, so a set
whose licence changed between versions would not show up in this table. For
eight of the ten that is a small risk — MIT, ISC and Apache-2.0 do not become
more restrictive — and for the two below it is worth checking properly.

### Two of these require attribution

**Dripicons is CC BY-SA 4.0** and **Typicons' artwork is CC BY-SA**. Both
require that the author be credited wherever the work appears, and share-alike
terms attach to adaptations. Naming them in this file is a reasonable reading of
that obligation for icons used unmodified; a lawyer may want it more visible
than a file in the repository.

**Material Design Icons is Apache-2.0**, which requires that any `NOTICE` file
travel with a redistribution.

These three are the reason this section is worth finishing rather than
deferring. The MIT and ISC sets need their notice carried, which this file does.

### The cheapest way to close this

Every one of these obligations disappears for a set that is not shipped. Ten are
bundled and it is worth checking how many are actually loaded — `icons.css`,
which declares the font-faces for Feather, Typicons, Dripicons and Simple Line
Icons, is not referenced by any page, and the only icon stylesheets a shipped
page loads are Font Awesome's.

If that holds up under a proper check, most of these sets can be deleted
outright and the question goes away rather than being answered.

### Flag icons

**Shipped as:** `frontend/static/images/flags/1x1/` and `4x3/` - one SVG per
language the app offers (in, us, lk, np, sa, fr, es, pt, id, th, de, tz, nl,
it), and nothing else. The 238 other countries the stylesheet knows are not
bundled.

| Set | Licence | Source |
| --- | --- | --- |
| flag-icons (formerly flag-icon-css) | MIT | `flag-icons` 7.5.0, `npm view flag-icons license`, 2 September 2026 |

The eight added on 2 September 2026 and the four on 4 September (de, tz, nl,
it) were copied unmodified from that package for the language menu; `in.svg` and `us.svg` were already here from the
same project's earlier name. MIT needs its notice carried, which this file does.

### What has been removed

`flag-icon-css-master` — 528 files — is gone. Nothing referenced that path, and
the flags that the interface actually uses come from
`frontend/static/style/css/flag-icon.min.css`, which stays. Removing an unused
copy is the cheapest way to shrink a licensing question: a set that is not
distributed needs no notice.

`icons/css/` is also unreferenced, but it holds the only copy of
`dripicons.css` and `themify-icons.css`, so it stays until someone confirms
those two are genuinely dead. `materialdesignicons.css` in that folder is
byte-identical to the copy under `material-design/css/` and is a plain
duplicate.

Any set that turns out to carry terms Posnic cannot meet needs replacing rather
than simply deleting, since ten of them are in use.

---

## Reporting an omission

If something is distributed here without its notice, that is a mistake and it
will be fixed. Open an issue, or write to security@posnic.com if you would rather
not do so publicly.
