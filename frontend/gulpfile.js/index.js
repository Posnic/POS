const { parallel, series, src, dest, pipe, gulp, watch } = require('gulp');
var argv = require('yargs').argv;
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

function buildHtml(cb) {
    let skipLang = !!argv.skipLang;
    html.buildAllHtml(cb, skipLang);
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
    return src(['static/**/*', '!static/script/**', '!static/style/**'])
        .pipe(dest(`${publicDir}/static`));
}

function copyVendorScripts() {
    return src('static/script/vendor/**/*', { base: 'static/script/vendor' })
        .pipe(dest(`${publicDir}/script/vendor`));
}

exports.default = function() {
    exports.build();
    // Every watcher that rewrites a bundle or a page must re-fingerprint:
    // a fresh dashboard.js under its canonical name is invisible to pages
    // that reference the hashed one, and the dev would be running stale code.
    watch(['**/*.html', '!static/**', '!public/**'], series(buildHtml, fingerprintAssets, buildServiceWorker));
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
exports.build = series(parallel(copyStatic, copyVendorScripts, buildCss, buildJs, buildHtml), fingerprintAssets, buildServiceWorker);
