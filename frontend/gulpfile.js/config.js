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
    { code: 'en', englishName: 'English', name: 'English', flag: 'us', reviewed: true },
    { code: 'ta', englishName: 'Tamil', name: 'தமிழ்', flag: 'in', reviewed: true },

    /* Complete packs, drafted from the glossary and finished by machine
       translation on 2026-09-02. Speakers wanted - see docs/TRANSLATING.md. */
    { code: 'hi', englishName: 'Hindi', name: 'हिन्दी', flag: 'in', reviewed: false },
    { code: 'ml', englishName: 'Malayalam', name: 'മലയാളം', flag: 'in', reviewed: false },
    { code: 'kn', englishName: 'Kannada', name: 'ಕನ್ನಡ', flag: 'in', reviewed: false },
    { code: 'te', englishName: 'Telugu', name: 'తెలుగు', flag: 'in', reviewed: false },
    { code: 'si', englishName: 'Sinhala', name: 'සිංහල', flag: 'lk', reviewed: false },
    { code: 'ne', englishName: 'Nepali', name: 'नेपाली', flag: 'np', reviewed: false },
    { code: 'ar', englishName: 'Arabic', name: 'العربية', flag: 'sa', dir: 'rtl', reviewed: false },
    { code: 'fr', englishName: 'French', name: 'Français', flag: 'fr', reviewed: false },
    { code: 'es', englishName: 'Spanish', name: 'Español', flag: 'es', reviewed: false },
    { code: 'pt', englishName: 'Portuguese', name: 'Português', flag: 'pt', reviewed: false },
    { code: 'id', englishName: 'Indonesian', name: 'Bahasa Indonesia', flag: 'id', reviewed: false },
    { code: 'th', englishName: 'Thai', name: 'ไทย', flag: 'th', reviewed: false },

    /* Existing European and East African packs. */
    { code: 'de', englishName: 'German', name: 'Deutsch', flag: 'de', reviewed: false },
    { code: 'sw', englishName: 'Swahili', name: 'Kiswahili', flag: 'tz', reviewed: false },
    { code: 'nl', englishName: 'Dutch Netherlands Nederlands', name: 'Nederlands', flag: 'nl', reviewed: false },
    { code: 'it', englishName: 'Italian', name: 'Italiano', flag: 'it', reviewed: false },
    // Initial core labels; untranslated messages retain their English fallback.
    { code: 'bg', name: 'Български', englishName: 'Bulgarian', flag: 'bg', reviewed: false, stage: 'starter' },
    { code: 'cs', name: 'Čeština', englishName: 'Czech', flag: 'cz', reviewed: false, stage: 'starter' },
    { code: 'da', name: 'Dansk', englishName: 'Danish', flag: 'dk', reviewed: false, stage: 'starter' },
    { code: 'et', name: 'Eesti', englishName: 'Estonian', flag: 'ee', reviewed: false, stage: 'starter' },
    { code: 'el', name: 'Ελληνικά', englishName: 'Greek', flag: 'gr', reviewed: false, stage: 'starter' },
    { code: 'ga', name: 'Gaeilge', englishName: 'Irish', flag: 'ie', reviewed: false, stage: 'starter' },
    { code: 'hr', name: 'Hrvatski', englishName: 'Croatian', flag: 'hr', reviewed: false, stage: 'starter' },
    { code: 'lv', name: 'Latviešu', englishName: 'Latvian', flag: 'lv', reviewed: false, stage: 'starter' },
    { code: 'lt', name: 'Lietuvių', englishName: 'Lithuanian', flag: 'lt', reviewed: false, stage: 'starter' },
    { code: 'hu', name: 'Magyar', englishName: 'Hungarian', flag: 'hu', reviewed: false, stage: 'starter' },
    { code: 'mt', name: 'Malti', englishName: 'Maltese', flag: 'mt', reviewed: false, stage: 'starter' },
    { code: 'pl', name: 'Polski', englishName: 'Polish', flag: 'pl', reviewed: false, stage: 'starter' },
    { code: 'ro', name: 'Română', englishName: 'Romanian', flag: 'ro', reviewed: false, stage: 'starter' },
    { code: 'sk', name: 'Slovenčina', englishName: 'Slovak', flag: 'sk', reviewed: false, stage: 'starter' },
    { code: 'sl', name: 'Slovenščina', englishName: 'Slovenian', flag: 'si', reviewed: false, stage: 'starter' },
    { code: 'fi', name: 'Suomi', englishName: 'Finnish', flag: 'fi', reviewed: false, stage: 'starter' },
    { code: 'sv', name: 'Svenska', englishName: 'Swedish', flag: 'se', reviewed: false, stage: 'starter' },
    { code: 'nb', name: 'Norsk bokmål', englishName: 'Norwegian Bokmål', flag: 'no', reviewed: false, stage: 'starter' },
    { code: 'is', name: 'Íslenska', englishName: 'Icelandic', flag: 'is', reviewed: false, stage: 'starter' },
    { code: 'sq', name: 'Shqip', englishName: 'Albanian', flag: 'al', reviewed: false, stage: 'starter' },
    { code: 'bs', name: 'Bosanski', englishName: 'Bosnian', flag: 'ba', reviewed: false, stage: 'starter' },
    { code: 'mk', name: 'Македонски', englishName: 'Macedonian', flag: 'mk', reviewed: false, stage: 'starter' },
    { code: 'sr', name: 'Српски', englishName: 'Serbian', flag: 'rs', reviewed: false, stage: 'starter' },
    { code: 'uk', name: 'Українська', englishName: 'Ukrainian', flag: 'ua', reviewed: false, stage: 'starter' },
    { code: 'ru', name: 'Русский', englishName: 'Russian', flag: 'ru', reviewed: false, stage: 'starter' },
    { code: 'tr', name: 'Türkçe', englishName: 'Turkish', flag: 'tr', reviewed: false, stage: 'starter' },
    { code: 'zh-CN', name: '简体中文', englishName: 'Chinese Simplified', flag: 'cn', reviewed: false, stage: 'starter' },
    { code: 'zh-TW', name: '繁體中文', englishName: 'Chinese Traditional', flag: 'tw', reviewed: false, stage: 'starter' },
    { code: 'ja', name: '日本語', englishName: 'Japanese', flag: 'jp', reviewed: false, stage: 'starter' },
    { code: 'ko', name: '한국어', englishName: 'Korean', flag: 'kr', reviewed: false, stage: 'starter' },
    { code: 'vi', name: 'Tiếng Việt', englishName: 'Vietnamese', flag: 'vn', reviewed: false, stage: 'starter' },
    { code: 'bn', name: 'বাংলা', englishName: 'Bengali', flag: 'bd', reviewed: false, stage: 'starter' },
    { code: 'ur', name: 'اردو', englishName: 'Urdu', flag: 'pk', reviewed: false, stage: 'starter', dir: 'rtl' },
    { code: 'fa', name: 'فارسی', englishName: 'Persian', flag: 'ir', reviewed: false, stage: 'starter', dir: 'rtl' },
    { code: 'he', name: 'עברית', englishName: 'Hebrew', flag: 'il', reviewed: false, stage: 'starter', dir: 'rtl' },
    { code: 'mr', name: 'मराठी', englishName: 'Marathi', flag: 'in', reviewed: false, stage: 'starter' },
    { code: 'gu', name: 'ગુજરાતી', englishName: 'Gujarati', flag: 'in', reviewed: false, stage: 'starter' },
    { code: 'pa', name: 'ਪੰਜਾਬੀ', englishName: 'Punjabi Gurmukhi', flag: 'in', reviewed: false, stage: 'starter' },
    { code: 'ms', name: 'Bahasa Melayu', englishName: 'Malay', flag: 'my', reviewed: false, stage: 'starter' },
    { code: 'tl', name: 'Filipino', englishName: 'Filipino Tagalog', flag: 'ph', reviewed: false, stage: 'starter' },

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
