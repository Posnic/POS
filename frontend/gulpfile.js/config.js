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
 * Adding one is now this list plus languages/<code>.json, and nothing else:
 * no per-language pages, no branches in the modules, no markup to edit. The
 * switcher in the header is rendered from this at runtime, which is what
 * stops a new language needing a hand-written <a> tag the way Tamil did.
 *
 * `name` is written in the language itself - a Tamil speaker looking for their
 * language is looking for "தமிழ்", not for "Tamil". `flag` is the icon suffix
 * the header already uses.
 */
/*
 * `draft: true` means "seeded from the glossary, not yet checked by somebody who
 * speaks it". A draft is NOT offered to shopkeepers.
 *
 * That distinction is the whole reason this flag exists. A shopkeeper who picks
 * Hindi and gets a screen of confidently wrong Hindi is worse off than one
 * reading English: English is at least honestly foreign, and the wrong word is
 * indistinguishable from the right one until something goes wrong at the
 * counter. Issue #32 says machine translation without human review is out of
 * scope, and this is how that is kept true rather than merely stated.
 *
 * A draft is visible where it needs to be - build with POSNIC_DRAFT_LANGUAGES=1
 * and the sandbox at develop.posnic.io does exactly that - so contributors can
 * read their language in place and fix it. When a native speaker has been
 * through it, drop the flag in one line and it ships.
 */
const LANGUAGES = [
    { code: 'en', name: 'English', flag: 'us' },
    { code: 'ta', name: 'தமிழ்', flag: 'in' },

    /* Seeded drafts. Reviewers wanted - see docs/TRANSLATING.md. */
    { code: 'hi', name: 'हिन्दी', flag: 'in', draft: true },
    { code: 'ml', name: 'മലയാളം', flag: 'in', draft: true },
    { code: 'kn', name: 'ಕನ್ನಡ', flag: 'in', draft: true },
    { code: 'te', name: 'తెలుగు', flag: 'in', draft: true },
    { code: 'si', name: 'සිංහල', flag: 'lk', draft: true },
    { code: 'ne', name: 'नेपाली', flag: 'np', draft: true },
    { code: 'ar', name: 'العربية', flag: 'sa', draft: true },
    { code: 'fr', name: 'Français', flag: 'fr', draft: true },
    { code: 'es', name: 'Español', flag: 'es', draft: true },
    { code: 'pt', name: 'Português', flag: 'pt', draft: true },
    { code: 'id', name: 'Bahasa Indonesia', flag: 'id', draft: true },
    { code: 'th', name: 'ไทย', flag: 'th', draft: true },
];

/*
 * Whether this build ships the drafts. Off unless asked for, so the default
 * build - the one that becomes an installer - carries only reviewed languages.
 */
const draftLanguages = process.env.POSNIC_DRAFT_LANGUAGES === '1';

/* What this build actually offers: every language, or only the reviewed ones. */
const shippedLanguages = LANGUAGES.filter((l) => draftLanguages || !l.draft);

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
    draftLanguages,
    langDir,
    publicDir,
    s,
    isDir,
    env,
};

