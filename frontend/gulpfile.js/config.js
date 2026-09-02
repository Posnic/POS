var path = require('path')
var fs = require('fs');
const dir = process.cwd();
/*
 * Language files live at the REPOSITORY ROOT, not under frontend/.
 *
 * They are a contribution surface before they are a build input: somebody who
 * speaks Kannada and has never opened this project should find them by looking
 * at the repository, not by knowing that the web build reads them. gulp runs
 * with frontend/ as its working directory, hence the step up.
 */
const langDir = path.resolve(dir, '..', 'languages');
const publicDir = `public`;
const s = path.sep; // Separator short form to reduce line
/*
 * The languages this build ships.
 *
 * Adding one is this list plus languages/<code>.json, and nothing else: no
 * per-language pages, no branches in the modules, no markup to edit. The
 * switcher in the header is rendered from this at runtime, which is what
 * stops a new language needing a hand-written <a> tag the way Tamil did.
 *
 * `name` is written in the language itself - a Tamil speaker looking for their
 * language is looking for "தமிழ்", not for "Tamil". `flag` is the icon suffix
 * the header already uses. `dir: 'rtl'` marks a right-to-left script; the
 * runtime also derives direction from the code, so this is for the menu and
 * for anything that reads index.json without the runtime.
 *
 * `reviewed` says whether somebody who speaks the language has read the pack
 * on a real screen. EVERY language ships either way - owner's call,
 * 2026-09-02: a shopkeeper who can read their screen in their own language,
 * even imperfectly, is better off than one reading none of it; every missing
 * key still shows English; and a language nobody can see is a language nobody
 * will ever correct. What the flag changes is honesty, not availability: an
 * unreviewed language is marked "beta" in the menu, its coverage is published
 * beside it, and docs/TRANSLATING.md asks speakers to review exactly those
 * first. Flip it to true when a speaker has been through the common screens.
 *
 * POSNIC_REVIEWED_LANGUAGES_ONLY=1 builds with just the reviewed ones, for an
 * installer that wants the older, narrower menu.
 */
const LANGUAGES = [
    { code: 'en', name: 'English', flag: 'us', reviewed: true },
    { code: 'ta', name: 'தமிழ்', flag: 'in', reviewed: true },

    /* Complete packs, drafted from the glossary and finished by machine
       translation on 2026-09-02. Speakers wanted - see docs/TRANSLATING.md. */
    { code: 'hi', name: 'हिन्दी', flag: 'in', reviewed: false },
    { code: 'ml', name: 'മലയാളം', flag: 'in', reviewed: false },
    { code: 'kn', name: 'ಕನ್ನಡ', flag: 'in', reviewed: false },
    { code: 'te', name: 'తెలుగు', flag: 'in', reviewed: false },
    { code: 'si', name: 'සිංහල', flag: 'lk', reviewed: false },
    { code: 'ne', name: 'नेपाली', flag: 'np', reviewed: false },
    { code: 'ar', name: 'العربية', flag: 'sa', dir: 'rtl', reviewed: false },
    { code: 'fr', name: 'Français', flag: 'fr', reviewed: false },
    { code: 'es', name: 'Español', flag: 'es', reviewed: false },
    { code: 'pt', name: 'Português', flag: 'pt', reviewed: false },
    { code: 'id', name: 'Bahasa Indonesia', flag: 'id', reviewed: false },
    { code: 'th', name: 'ไทย', flag: 'th', reviewed: false },
];

/* Whether this build restricts the menu to reviewed languages. Off unless
   asked for: the default build offers everything, honestly labelled. */
const reviewedOnly = process.env.POSNIC_REVIEWED_LANGUAGES_ONLY === '1';

/* What this build actually offers. */
const shippedLanguages = LANGUAGES.filter((l) => !reviewedOnly || l.reviewed);

/* Just the codes this build ships, for everything that only needs the list. */
const languages = shippedLanguages.map((l) => l.code);

const env = process.env.NODE_ENV ? process.env.NODE_ENV : 'prod';

function isDir(url) {
    return fs.lstatSync(url).isDirectory();
}

module.exports = {
    languages,
    LANGUAGES,
    shippedLanguages,
    reviewedOnly,
    langDir,
    publicDir,
    s,
    isDir,
    env,
};
