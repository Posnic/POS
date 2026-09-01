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
const LANGUAGES = [
    { code: 'en', name: 'English', flag: 'us' },
    { code: 'ta', name: 'தமிழ்', flag: 'in' },
];

/* Just the codes, for everything that only needs to know which exist. */
const languages = LANGUAGES.map((l) => l.code);

const env = process.env.NODE_ENV ? process.env.NODE_ENV : 'prod';

function isDir(url) {
    return fs.lstatSync(url).isDirectory();
}

module.exports = {
    languages,
    LANGUAGES,
    langDir,
    publicDir,
    s,
    isDir,
    env,
};

