var fs = require('fs');
var path = require('path')
var minify = require('html-minifier').minify;
const { publicDir, languages, langDir, s, isDir} = require('./config');
const dir = process.cwd();
const langContent = [];
let html = [];
let taskCount = 0;
let skipLang = false;
let pages = {};
let htmls = [];
/* Keys a language file lacks, collected across the build and reported once. */
const missingKeys = new Set();

function readLangJSON() {
    languages.forEach(lang => {
       if  (lang === 'en') {
           return;
       }
       langContent[lang] = JSON.parse(fs.readFileSync(`${langDir}${s}${lang}.json`, 'utf8'));
    });
}

function readPagesAndHtmls() {
    const json = JSON.parse(fs.readFileSync(`pages_html_map.json`, 'utf8'));
    pages = json.pages;
    htmls = json.files;
}

function loadAllHtml() {
    for (const [page, file] of Object.entries(pages)) {
        taskCount = skipLang ? taskCount + 1 : taskCount + languages.length;
        langReplace(file, file, file);
    }

    htmls.forEach(item => {
        const split = item.split('/');
        const dir = split[0];
        const file = split[1];
        const subItemUrl = item;
        taskCount = skipLang ? taskCount + 1 : taskCount + languages.length;
        langReplace(subItemUrl, dir, file);
    });
}

function langReplace(url, dir, file) {
    for (let lang of languages) {
        // If Lang Skip We will not replace content
        if (skipLang && lang !=='en') {
            continue;
        }
        fs.readFile(url, 'utf8', function (err, data) {
            let find = /<lang class="(.*?)">(.*?)<\/lang>/g;
            if (lang === 'en') {
                data = data.replace(find, '$2');
            } else {
                data = data.replace(find, (match, key, english) => {
                    const translated = langContent[lang][key];
                    // A missing key used to interpolate as the literal string
                    // "undefined" - shipped to customers, in the UI, for
                    // months. The English the tag already carries is always a
                    // better answer; the build lists what needs translating.
                    if (translated === undefined) {
                        missingKeys.add(`${lang}: ${key}`);
                        return english;
                    }
                    return translated;
                });
            }
            html[lang] = html[lang] ? html[lang] : [];
            if (dir === file) {
                html[lang][file] = data;
            } else {
                html[lang][dir] = html[lang][dir] ? html[lang][dir] : [];
                html[lang][dir][file] = data;
            }
            taskCount--;
        });
    }
}

function getLinkContent(data, lang) {
    data = data.replace(/<link type='(.*?)' href='(.*?)' \/>/g, function (match, type, value) {
        let dir = value.split('/');
        let content = ''
        if (type === 'directory') {
            if (dir[1] && dir[1].length > 0) {
                content = mergeDirectory(html[lang][dir[0]][dir[1]]);
            } else {
                content = mergeDirectory(html[lang][dir[0]]);
            }
        }
        if (type === 'file') {
            if (dir[2] && dir[2].length > 0 && dir[1] && dir[1].length > 0) {
                content = html[lang][dir[0]][dir[1]][dir[2]];
            } else if (dir[1] && dir[1].length > 0) {
                content = html[lang][dir[0]][dir[1]];
            } else {
                content = html[lang][dir[0]];
            }
        }
        return content;
    });
    return data;
}


function buildAllHtml(cb, skip) {
    skipLang = skip;
    if (!skipLang) {
        readLangJSON(); // Loading All Language pairs into Memory
    }
    readPagesAndHtmls();
    loadAllHtml(); // Loading All Html's into Memory and language replace
    setInterval(function () {
        // Disabled HTML minification for human readable output
        let minifyOptions = {
            minifyCSS: false,
            minifyJS: false,
            collapseWhitespace: false,
            removeComments: false,
            removeAttributeQuotes: false,
            removeTagWhitespace: false
        };
        if (taskCount === 0) {
            for (let lang of languages) {
                if (skipLang && lang !=='en') {
                    continue;
                }
                for (let item in html[lang]) {
                    if (html[lang].hasOwnProperty(item) && typeof html[lang][item] === 'string') {
                        let content = getLinkContent(html[lang][item], lang);
                        // Keep HTML human readable - skip minification
                        // content = minify(content, minifyOptions);
                        if (!fs.existsSync(publicDir)) {
                            fs.mkdirSync(publicDir, {recursive: true});
                        }
                        let fileName = lang === 'en' ? item : `${lang}_${item}`;
                        fs.writeFileSync(`${publicDir}${s}${fileName}`, content, {encoding: 'utf8'})
                    }
                }

            }
            if (missingKeys.size) {
                console.warn(
                    `[i18n] ${missingKeys.size} untranslated key(s) fell back to English:\n  ` +
                    [...missingKeys].sort().join('\n  ')
                );
            }
            cb();
            clearInterval(this);
        }
    }, 500);
}

function mergeDirectory(dir) {
    // Key order here is fs.readFile completion order - a race that made every
    // build byte-different (modules inlined in a different order each run).
    // Sort so identical sources produce identical pages: the service worker's
    // build hash and the asset channel both key off content, and a hash that
    // moves when nothing changed forces cache flushes and phantom updates.
    let content = '';
    for (const file of Object.keys(dir).sort()) {
        content += dir[file];
    }
    return content;
}

exports.buildAllHtml = buildAllHtml;