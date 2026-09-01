var fs = require('fs');
var path = require('path')
/* html-minifier was required here for YEARS while its one call sat commented
   out below - meanwhile it was the frontend's only unfixable high-severity
   audit finding. The pages ship readable on purpose; the dependency is gone. */
const { publicDir, languages, langDir, s, isDir} = require('./config');
const dir = process.cwd();
let html = [];
let taskCount = 0;
let skipLang = false;
let pages = {};
let htmls = [];
/*
 * Coverage is no longer the build's business. It used to notice missing keys
 * as a side effect of substituting them; nothing substitutes now, so the
 * question is answered properly instead - tests/tools/i18n-coverage.js reads
 * both the HTML and the JS t() calls and reports per language.
 */

function readPagesAndHtmls() {
    const json = JSON.parse(fs.readFileSync(`pages_html_map.json`, 'utf8'));
    pages = json.pages;
    htmls = json.files;
}

function loadAllHtml() {
    for (const [page, file] of Object.entries(pages)) {
        taskCount += 1;
        langReplace(file, file, file);
    }

    htmls.forEach(item => {
        const split = item.split('/');
        const dir = split[0];
        const file = split[1];
        const subItemUrl = item;
        taskCount += 1;
        langReplace(subItemUrl, dir, file);
    });
}

/*
 * Leave the words where the running app can reach them.
 *
 * This used to substitute the translation here and write a COMPLETE SECOND
 * COPY of every page per language - 2.3MB of duplicated markup to deliver
 * 43KB of Tamil, and the reason a tenth language would have cost 23MB before
 * anyone typed a word of the eleventh.
 *
 * Now there is one tree. The tag stays in the page carrying its key and its
 * English, and PosnicPro.i18n swaps the text in at load. English is therefore
 * not "the default language" but the text physically present - it renders with
 * no dictionary, offline, on first run, and if every fetch fails.
 *
 * TWO PLACES THE TAG CANNOT SURVIVE. Inside <title> and <option> the parser
 * does not build an element for it: a title would show the customer literal
 * angle brackets in their tab. There the key is hoisted onto the parent as
 * data-t, which the same runtime pass understands.
 */
function markTranslatable(data) {
    data = data.replace(
        /<(title|option)([^>]*)>\s*<lang class="([^"]+)">([\s\S]*?)<\/lang>\s*<\/\1>/gi,
        (match, tag, attrs, key, english) =>
            `<${tag}${attrs} data-t="${key}">${english.trim()}</${tag}>`);
    return data;
}

function langReplace(url, dir, file) {
    fs.readFile(url, 'utf8', function (err, data) {
        data = markTranslatable(data);
        if (dir === file) {
            html[file] = data;
        } else {
            html[dir] = html[dir] ? html[dir] : [];
            html[dir][file] = data;
        }
        taskCount--;
    });
}

function getLinkContent(data) {
    data = data.replace(/<link type='(.*?)' href='(.*?)' \/>/g, function (match, type, value) {
        let dir = value.split('/');
        let content = ''
        if (type === 'directory') {
            if (dir[1] && dir[1].length > 0) {
                content = mergeDirectory(html[dir[0]][dir[1]], dir[0]);
            } else {
                content = mergeDirectory(html[dir[0]], dir[0]);
            }
        }
        if (type === 'file') {
            if (dir[2] && dir[2].length > 0 && dir[1] && dir[1].length > 0) {
                content = html[dir[0]][dir[1]][dir[2]];
            } else if (dir[1] && dir[1].length > 0) {
                content = html[dir[0]][dir[1]];
            } else {
                content = html[dir[0]];
            }
        }
        return content;
    });
    return data;
}


function buildAllHtml(cb, skip) {
    /*
     * --skipLang used to halve the build by not emitting the Tamil copies.
     * There are no per-language copies any more, so it has nothing to skip.
     * Accepted and ignored rather than removed, because it is in scripts and
     * in people's fingers.
     */
    skipLang = skip;
    readPagesAndHtmls();
    loadAllHtml();
    setInterval(function () {
        if (taskCount === 0) {
            let written = 0;
            for (let item in html) {
                if (html.hasOwnProperty(item) && typeof html[item] === 'string') {
                    let content = getLinkContent(html[item]);
                    if (!fs.existsSync(publicDir)) {
                        fs.mkdirSync(publicDir, {recursive: true});
                    }
                    fs.writeFileSync(`${publicDir}${s}${item}`, content, {encoding: 'utf8'});
                    written += 1;
                }
            }
            /*
             * Sweep the per-language pages a previous build left behind.
             * Leaving them would keep 2.3MB of stale Tamil in the output, and
             * a stale page is worse than a missing one: it still loads, still
             * looks right, and is frozen at whatever the app said the day the
             * old build ran.
             */
            let removed = 0;
            for (const stale of fs.readdirSync(publicDir)) {
                if (/^[a-z]{2}_.+\.html$/.test(stale)) {
                    fs.unlinkSync(`${publicDir}${s}${stale}`);
                    removed += 1;
                }
            }
            console.log(`[i18n] ${written} page(s), one tree`
                + (removed ? `, removed ${removed} stale per-language page(s)` : ''));
            cb();
            clearInterval(this);
        }
    }, 500);
}

/*
 * Panes a phone can live without until asked (PAGE_SPLIT_ANALYSIS Option A,
 * first slice). Each of these is a report screen: big, self-contained, its
 * JS in the lazy `reports` chunk - so nothing in the boot bundle touches its
 * markup, and the owner's own ruling stands ("no one sees that report in
 * mobile"). Wrapped in <template> they are parsed but never rendered: no
 * render tree, no style matching, no standing nodes. Desktop inflates them
 * all immediately at boot (byte-identical behaviour); a phone inflates them
 * the first time the reports chunk is asked for. Every pane here was checked
 * script-free - adopting template content executes any <script> it holds.
 */
const PHONE_DEFER = new Set([
    'categoryReport.html', 'customersReport.html', 'dailyReport.html',
    'expensesReport.html', 'itemReport.html', 'kioskReport.html',
    'kotReport.html', 'paymentReport.html', 'pendingReport.html',
    'priceSettings.html', 'registerReport.html', 'receivingsReport.html',
    'returnReport.html', 'returnreceivingReport.html', 'salesReport.html',
    'supplierReport.html', 'taxdiscountReport.html', 'userReport.html',
    'report_gstrone.html', 'report_gstrtwo.html', 'report_gstrtwob.html',
    'report_gstrthree.html', 'report_gstrnine.html',
]);

function mergeDirectory(dir, dirName) {
    // Key order here is fs.readFile completion order - a race that made every
    // build byte-different (modules inlined in a different order each run).
    // Sort so identical sources produce identical pages: the service worker's
    // build hash and the asset channel both key off content, and a hash that
    // moves when nothing changed forces cache flushes and phantom updates.
    let content = '';
    for (const file of Object.keys(dir).sort()) {
        let piece = dir[file];
        if (dirName === 'modules' && PHONE_DEFER.has(file)) {
            piece = '<template class="pane-defer" data-pane="' + file + '">' + piece + '</template>';
        }
        content += piece;
    }
    return content;
}

exports.buildAllHtml = buildAllHtml;