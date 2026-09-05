const { parallel, series, src, dest, pipe, gulp, watch } = require('gulp');
const { publicDir, languages, s } = require('./config');
var css = require('./css');
var js = require('./js');
var html = require('./html');
var sw = require('./sw');
var fingerprint = require('./fingerprint');

function buildCss(cb) {
    css.buildAllCss(cb);
}

function buildJs(cb) {
    js.buildAllJs(cb);
}

/*
 * --skipLang used to halve the build by not emitting the per-language pages.
 * There are none any more, so it has nothing to skip and buildAllHtml ignores
 * it. The whole of yargs was here to parse that one dead flag, and yargs 18
 * dropped `require('yargs').argv` - which broke the build on the dependabot
 * bump. Removing the flag was the smaller change and one dependency lighter
 * than porting it.
 */
function buildHtml(cb) {
    html.buildAllHtml(cb, false);
}

/*
 * Copy the assets: fonts, icons, images, the JSON reference data and the
 * print stylesheets.
 *
 * This used to call cb() straight after starting the copies. src().pipe()
 * is asynchronous, so the task reported success before the files were
 * written and whatever lost the race was silently missing: a build would
 * emit static/pages but no fonts, no images and no json, with a clean exit
 * code. That is why a second, narrower copy of static/pages was bolted on
 * here - it was small enough to finish in time - and why the app ended up
 * with mounts pointing at an older tree that still happened to have the
 * files.
 *
 * Returning the stream makes gulp wait, so the task finishes when the copy
 * has actually finished. The explicit pages copy is gone: static/pages is
 * already inside this glob, and it only ever existed to paper over the race.
 */
function copyStatic() {
    // Forward slashes, not path.sep. A glob is not a filesystem path: it uses
    // "/" on every platform. Built with path.sep this pattern became
    // "static\**\*" on Windows, where there is no recognised magic, so the
    // base fell back to the working directory and every file landed one level
    // deeper - public/static/static/... on Windows against public/static/...
    // on Linux. The same source tree produced two different layouts depending
    // on who ran the build, the app was wired for the Windows one, and CI has
    // been quietly shipping the other.
    // encoding:false, because gulp 5 decodes streams as UTF-8 by default and
    // silently corrupts every binary - fonts, icons, images all shipped
    // mangled on the first gulp-5 build until the checksums caught it.
    // Bytes in, bytes out is the only correct mode for a copy.
    return src(['static/**/*', '!static/script/**', '!static/style/**'], { encoding: false })
        .pipe(dest(`${publicDir}/static`));
}

/*
 * Root discovery files are served from frontend/public in production and by
 * Cloudflare-style static hosts. Keeping the source copies beside index.html
 * is convenient for maintainers, but the build output must contain them or a
 * request for /robots.txt, /sitemap.xml or /llms.txt falls through to the app
 * shell instead.
 */
function copyRootPublicFiles() {
    return src(['robots.txt', 'sitemap.xml', 'llms.txt', '_headers'], { encoding: false })
        .pipe(dest(publicDir));
}

function copyVendorScripts() {
    return src('static/script/vendor/**/*', { base: 'static/script/vendor', encoding: false })
        .pipe(dest(`${publicDir}/script/vendor`));
}

/*
 * Libraries that load on first use instead of riding every page bundle
 * (S1 feel-fast; PosnicPro.lazy owns the client half). Copied under STABLE
 * names on purpose: they are versioned by the service worker's build-hash
 * cache, not by filename, and the desktop asset channel ships them like any
 * other public file. fingerprint.js does not descend into lazy/, so these
 * names never change between deploys.
 */
function copyLazyScripts(cb) {
    const fsx = require('fs');
    const pathx = require('path');
    const LAZY = [
        ['static/script/js/jspdf.umd.min.js', 'jspdf2.js'],
        ['static/script/js/html2canvas.min.js', 'html2canvas.js'],
        ['static/script/js/sortable.min.js', 'sortable.js'],
        ['static/script/js/plugins/summernote/summernote-bs4.js', 'summernote.js'],
        ['static/style/plugins/colorpicker/bootstrap-colorpicker.js', 'colorpicker.js'],
    ];
    const outDir = pathx.join(process.cwd(), publicDir, 'script', 'lazy');
    fsx.mkdirSync(outDir, { recursive: true });
    for (const [from, to] of LAZY) {
        if (!fsx.existsSync(from)) { cb(new Error(`lazy lib missing: ${from}`)); return; }
        fsx.copyFileSync(from, pathx.join(outDir, to));
    }
    cb();
}

/*
 * The reports chunk (bundle-split slice 2): every report page's module,
 * concatenated and minified into ONE lazy file the router loads on the
 * first report navigation. The list lives in pages_css_js_map.json under
 * lazy_reports, so moving a module between boot and lazy is a map edit.
 */
async function buildLazyReports(cb) {
    const fsx = require('fs');
    const pathx = require('path');
    const { minify } = require('terser');
    try {
        const map = JSON.parse(fsx.readFileSync('pages_css_js_map.json', 'utf8'));
        const files = map.lazy_reports || [];
        let out = '';
        for (const rel of files) {
            const src = fsx.readFileSync(rel.replace(/^\//, ''), 'utf8');
            out += '\n;/* ' + pathx.basename(rel) + ' */\n' + src;
        }
        if (process.env.POSNIC_MINIFY !== '0') {
            const m = await minify(out, { compress: true, mangle: true });
            if (m && m.code) out = m.code;
        }
        const outDir = pathx.join(process.cwd(), publicDir, 'script', 'lazy');
        fsx.mkdirSync(outDir, { recursive: true });
        fsx.writeFileSync(pathx.join(outDir, 'reports.js'), out);
        cb();
    } catch (e) { cb(e); }
}

exports.default = function() {
    exports.build();
    // Every watcher that rewrites a bundle or a page must re-fingerprint:
    // a fresh dashboard.js under its canonical name is invisible to pages
    // that reference the hashed one, and the dev would be running stale code.
    watch(['**/*.html', '!static/**', '!public/**'], series(buildHtml, fingerprintAssets, buildServiceWorker));
    watch(['robots.txt', 'sitemap.xml', 'llms.txt', '_headers'], copyRootPublicFiles);
    watch('static/style/**/*.css', series(buildCss, fingerprintAssets, buildServiceWorker));
    watch('static/style/**/*.scss', series(buildCss, fingerprintAssets, buildServiceWorker));
    watch('static/script/**/*.js', series(buildJs, fingerprintAssets, buildServiceWorker));
    watch('static/script/vendor/**/*', copyVendorScripts);
    watch('pages_css_js_map.json', series(parallel(buildCss, buildJs), fingerprintAssets, buildServiceWorker));
};
exports.js = buildJs
exports.css = buildCss
exports.html = buildHtml
exports.static = copyStatic
exports.rootPublicFiles = copyRootPublicFiles
exports.vendorScripts = copyVendorScripts
/* The service worker hashes the built bundles, so it must run after them. */
function buildServiceWorker(cb) {
    sw.buildServiceWorker(cb);
}
exports.sw = buildServiceWorker;
/* Bundle names carry a content hash (immutable caching) and the service
   worker precaches those names, so both must follow the builds, in order. */
function fingerprintAssets(cb) {
    fingerprint.fingerprintAssets(cb);
}
exports.fingerprint = fingerprintAssets;
/*
 * The language packs the running app fetches.
 *
 * Words JavaScript writes after load cannot be translated by the HTML build,
 * so PosnicPro.i18n reads languages/<code>.json at runtime. This puts those
 * files where the page can ask for them.
 *
 * English is deliberately NOT emitted: it lives in the markup and in every
 * t(key, english) call, so an English shop fetches nothing and has nothing
 * that can fail.
 *
 * Validated rather than copied. Nine Tamil strings in sales.js had been
 * corrupted to mojibake and shipped to the sale screen for who knows how long,
 * because nothing ever looked. A pack that is not valid JSON, or that carries
 * Latin-1 wreckage where Tamil should be, fails the build here instead.
 */
function buildLangPacks(cb) {
    /* Required here, not at module scope: that is the shape the other tasks in
       this file use, and a name that only exists inside a sibling function is
       exactly the kind of thing node --check cannot see. */
    const fsx = require('fs');
    const pathx = require('path');
    try {
        const outDir = pathx.join(process.cwd(), publicDir, 'languages');
        fsx.mkdirSync(outDir, { recursive: true });
        const problems = [];
        /* A run of Latin-1 supplement characters is what UTF-8 read as
           Latin-1 looks like. Real translations never contain one. */
        const MOJIBAKE = /[\u0080-\u00FF]{3,}/;
        const packs = {};
        for (const lang of languages) {
            if (lang === 'en') continue;
            const source = pathx.join(process.cwd(), '..', 'languages', `${lang}.json`);
            const raw = fsx.readFileSync(source, 'utf8');
            let dict;
            try {
                dict = JSON.parse(raw);
            } catch (e) {
                problems.push(`${lang}.json is not valid JSON: ${e.message}`);
                continue;
            }
            packs[lang] = dict;
            for (const [key, value] of Object.entries(dict)) {
                /* A run of Latin-1 supplement characters is what UTF-8 read as
                   Latin-1 looks like. Real translations never contain one. */
                if (/[\u0080-\u00FF]{3,}/.test(String(value))) {
                    problems.push(`${lang}.${key} looks like mojibake: ${String(value).slice(0, 40)}`);
                }
            }
            fsx.writeFileSync(pathx.join(outDir, `${lang}.json`), JSON.stringify(dict), 'utf8');
        }
        /*
         * The words the SERVER writes, keyed by the English itself.
         *
         * They ship as their own file per language because they answer a
         * different source. The API is deployed separately and can be a
         * release behind the till, so a message this pack has never heard
         * of still has to print. A missing file, a missing entry and an
         * unknown sentence all fall through to the English the server
         * sent - see PosnicPro.i18n.say().
         */
        const serverDir = pathx.join(process.cwd(), '..', 'languages', 'server');
        if (fsx.existsSync(serverDir)) {
            for (const file of fsx.readdirSync(serverDir)) {
                if (!/^[a-z]{2}[.]json$/.test(file)) continue;
                const lang = file.slice(0, 2);
                let says;
                try {
                    says = JSON.parse(fsx.readFileSync(pathx.join(serverDir, file), 'utf8'));
                } catch (e) {
                    problems.push(`server/${file} is not valid JSON: ${e.message}`);
                    continue;
                }
                const clean = {};
                for (const [english, said] of Object.entries(says)) {
                    if (typeof said !== 'string' || !said.trim()) continue;
                    if (MOJIBAKE.test(said)) {
                        problems.push(`server/${lang}: "${english.slice(0, 30)}" looks like mojibake`);
                        continue;
                    }
                    clean[english] = said;
                }
                fsx.writeFileSync(pathx.join(outDir, `msg-${lang}.json`), JSON.stringify(clean), 'utf8');
            }
        }
        if (problems.length) {
            return cb(new Error('language packs:\n  ' + problems.join('\n  ')));
        }
        /*
         * What the language menu offers.
         *
         * The header used to carry one hand-written <a> per language, so a new
         * language meant editing markup as well as adding a file - the last
         * place adding a language was still a code change. The menu is built
         * from this at runtime instead.
         *
         * Each entry carries `reviewed` and `coverage`: whether a speaker has
         * read the pack, and how many of the keys the UI uses it answers. The
         * menu shows an unreviewed language as beta with the number beside
         * it - a shopkeeper picking Thai deserves to know it was drafted by a
         * machine and read by nobody, and a translator deserves to see the
         * number move. The key list comes from the same tool the coverage
         * report and the translations CI use, so the build cannot disagree
         * with them; a build without tests/ beside it simply carries no
         * number.
         */
        const { shippedLanguages } = require('./config');
        let used = null;
        try {
            used = require(pathx.join(process.cwd(), '..', 'tests', 'tools', 'i18n-coverage.js')).keysUsed().used;
        } catch (e) { /* no coverage number, not a failed build */ }
        const list = shippedLanguages.map((l) => {
            const entry = { code: l.code, name: l.name, flag: l.flag, reviewed: !!l.reviewed };
            if (l.dir) entry.dir = l.dir;
            if (l.code === 'en') { entry.coverage = 100; return entry; }
            if (used) {
                const dict = packs[l.code] || {};
                const answered = [...used]
                    .filter((k) => typeof dict[k] === 'string' && dict[k].trim() !== '').length;
                entry.coverage = used.size ? Math.round((answered / used.size) * 100) : 0;
            }
            return entry;
        });
        fsx.writeFileSync(pathx.join(outDir, 'index.json'), JSON.stringify(list), 'utf8');
        cb();
    } catch (e) { cb(e); }
}
exports.langPacks = buildLangPacks;

exports.build = series(parallel(copyRootPublicFiles, copyStatic, copyVendorScripts, copyLazyScripts, buildLazyReports, buildLangPacks, buildCss, buildJs, buildHtml), fingerprintAssets, buildServiceWorker);
