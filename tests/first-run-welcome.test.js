/*
 * The welcome a new shop sees once.
 *
 * Owner ask: "First time when user logs in to system, show verynicely wellcome
 * message, tell him we enabled default feature, if he wants enable features,
 * later also enable."
 *
 * WHAT THESE TESTS ARE PROTECTING
 *
 * Everything here fails SILENTLY when it breaks. A welcome that never shows
 * looks exactly like a product with no welcome. A welcome that shows twice
 * looks like a bug nobody reports because they just close it. A flag dropped
 * from the settings blob brings it back for somebody who dismissed it a month
 * ago. None of that produces an error anywhere.
 *
 * So the assertions are about the GUARDS, not the appearance - and each one
 * was checked by mutating the guard away and confirming the test goes red.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const settingsJs = fs.readFileSync(
    path.join(root, 'frontend/static/script/js/modules/js/settings.js'), 'utf8');
const modalHtml = fs.readFileSync(
    path.join(root, 'frontend/modals/feature_intro.html'), 'utf8');
const customCss = fs.readFileSync(
    path.join(root, 'frontend/static/style/css/custom.css'), 'utf8');
const settingModel = fs.readFileSync(
    path.join(root, 'api/src/models/setting.model.js'), 'utf8');
const settingsGroups = fs.readFileSync(
    path.join(root, 'api/src/services/settings-groups.js'), 'utf8');

/*
 * Prose that names a guard reads exactly like the guard. Two tests in this repo
 * have passed against their own explanatory comment while the code they claimed
 * to check had been deleted, so every assertion below runs on stripped source.
 */
function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^[ \t]*\/\/.*$/gm, '')
        .replace(/<!--[\s\S]*?-->/g, '');
}

const settingsCode = stripComments(settingsJs);
const modalCode = stripComments(modalHtml);
const cssCode = stripComments(customCss);
const modelCode = stripComments(settingModel);
const groupsCode = stripComments(settingsGroups);

/* The block that decides whether the welcome opens at all. Bounded by name
   rather than by brace-matching: the object holds arrow defaults and
   destructured parameters, and a naive brace count returns a few characters. */
function block(source, name, until) {
    const start = source.indexOf(name);
    assert.ok(start > -1, name + ' not found');
    const end = source.indexOf(until, start);
    assert.ok(end > start, until + ' not found after ' + name);
    return source.slice(start, end);
}

test('the welcome is gated on the shop, not only on the browser', () => {
    const gate = block(settingsCode, 'maybeShowIntro:', 'renderIntro:');

    // Per browser: what shops running today already carry.
    assert.match(gate, /features_intro_seen/);
    // Per shop: survives a second till, a new browser and a reinstall.
    assert.match(gate, /first_run_done === true \|\| \w+\.first_run_done === 'true'/);
    assert.match(gate, /return;/);
});

test('an unloaded settings blob is not treated as a shop that has never been asked', () => {
    const gate = block(settingsCode, 'maybeShowIntro:', 'renderIntro:');
    /*
     * The failure this prevents: settings have not arrived yet, every key reads
     * absent, and a shop trading for a year is greeted with "your shop is
     * ready". Absent must mean "do not know", never "new".
     */
    assert.match(gate, /if \(!Object\.keys\(\w+\)\.length\) \{ return; \}/);
});

test('a cashier is never shown switches they cannot save', () => {
    const gate = block(settingsCode, 'maybeShowIntro:', 'renderIntro:');
    assert.match(gate, /acl\.setting\.write === true/);
});

test('dismissing counts as being asked, on the shop as well as the browser', () => {
    const gate = block(settingsCode, 'maybeShowIntro:', 'renderIntro:');
    // Otherwise the next till in the same shop asks again.
    assert.match(gate, /hidden\.bs\.modal/);
    assert.match(gate, /local\.set\('features_intro_seen', 'true'\)/);
    assert.match(gate, /settings\/group\/features/);
    assert.match(gate, /first_run_done: 'true'/);
});

test('saving writes the flag in the same request as the switches', () => {
    const save = block(settingsCode, 'saveIntro:', '$(document).on(');
    /*
     * A separate call could succeed while the toggles failed, and the shop
     * would then never again be offered switches it did not manage to save.
     */
    assert.match(save, /payload\.first_run_done = 'true';/);
    assert.match(save, /url: 'settings\/group\/features'/);
});

test('the flag survives every rebuild of the settings blob', () => {
    /*
     * general_settings is rebuilt from scratch in several places and those
     * literals do not merge - a key left out is LOST, and losing this one
     * shows the welcome again to somebody who dismissed it a month ago.
     *
     * Written as a sweep over every writer rather than as a count, so a blob
     * rebuild added next year fails here instead of silently dropping it.
     */
    const writers = [];
    const re = /local\.set\('general_settings'/g;
    let m;
    while ((m = re.exec(settingsCode)) !== null) { writers.push(m.index); }
    assert.ok(writers.length >= 4, 'expected several blob writers, found ' + writers.length);

    for (const at of writers) {
        // The object being stringified is built immediately above the write.
        const preceding = settingsCode.slice(Math.max(0, at - 2500), at);
        assert.match(preceding, /first_run_done/,
            'a general_settings write at offset ' + at + ' does not carry first_run_done');
    }
});

test('an API that does not send the flag cannot erase a known one', () => {
    const keep = block(settingsCode, 'keepFirstRunFlag:', 'maybeShowIntro:');
    // Explicit values win; undefined falls back to what we already knew.
    assert.match(keep, /=== true \|\| \w+\.first_run_done === 'true'\) \{ return true; \}/);
    assert.match(keep, /=== false \|\| \w+\.first_run_done === 'false'\) \{ return false; \}/);
    assert.match(keep, /return PosnicPro\.features\._blob\(\)\.first_run_done === true;/);
});

test('the shop is greeted by name, and never by the string null', () => {
    const render = block(settingsCode, 'renderIntro:', 'saveIntro:');
    /* localStorage.getItem hands back the STRING "null" for a key written as
       null, which is how a header once read "null null". */
    assert.match(render, /=== 'null' \|\| \w+ === 'undefined'/);
    assert.match(render, /feature_intro_sub/);
});

test('the lead sentence is true for a shop with everything already on', () => {
    const render = block(settingsCode, 'renderIntro:', 'saveIntro:');
    /*
     * A shop created before the new defaults has every feature enabled.
     * Telling it "everything else is off" while it looks at a full menu is
     * plainly false, so the sentence is chosen from the switches themselves.
     */
    assert.match(render, /anyOff/);
    assert.match(render, /=== false \|\| \w+\[f\[0\]\] === 'false'/);
    assert.match(render, /feature_intro_lead/);
});

test('the welcome panel takes its colours from the theme, not from Bootstrap', () => {
    /*
     * Bootstrap paints .modal-content white from its own stylesheet. Without an
     * explicit token background, the first thing a shop on a dark preset sees
     * is a white flashbang with unreadable text - which is the exact complaint
     * the sale grid had.
     */
    const panel = block(cssCode, '.modal-content.first-run', '.first-run-head');
    assert.match(panel, /background: var\(--theme-card-bg/);
    assert.match(panel, /color: var\(--theme-text-primary/);

    const firstRunCss = cssCode.slice(cssCode.indexOf('.modal-content.first-run'));
    const hardCoded = firstRunCss.match(/(?:background|color|border-color):\s*#[0-9a-fA-F]{3,8}/g) || [];
    assert.deepStrictEqual(hardCoded, [],
        'the welcome must not hard-code colours: ' + hardCoded.join(', '));
});

test('the feature list scrolls so the buttons stay reachable', () => {
    /* Eleven features on a 768px-tall till push Save off the bottom of the
       screen, and a Save nobody can reach is the same as no Save. */
    const list = block(cssCode, '.first-run-list', '.first-run-row {');
    assert.match(list, /max-height/);
    assert.match(list, /overflow-y: auto/);
});

test('a long description cannot push the switch off the edge', () => {
    const rowText = block(cssCode, '.first-run-row-text {', '.first-run-row-text b');
    // A flex item defaults to min-width:auto and refuses to shrink below its
    // longest word.
    assert.match(rowText, /min-width: 0/);
    const sw = block(cssCode, '.first-run-switch', '.first-run-foot');
    assert.match(sw, /flex: 0 0 auto/);
});

test('the modal markup carries what the code paints into', () => {
    for (const id of ['feature_intro_modal', 'feature_intro_sub', 'feature_intro_lead',
        'feature_intro_list', 'feature_intro_save', 'feature_intro_skip']) {
        assert.ok(modalCode.includes('id="' + id + '"'), 'missing #' + id);
    }
    assert.match(modalCode, /class="modal-content first-run"/);
});

test('every icon the welcome asks for exists in the shipped font', () => {
    /* A glyph this build does not carry renders as an empty box, and nothing
       reports it. mdi-storefront is one of those; mdi-store is not. */
    const icons = fs.readFileSync(
        path.join(root, 'frontend/static/style/icons/material-design/css/materialdesignicons.css'), 'utf8');
    const asked = modalCode.match(/mdi-[a-z0-9-]+/g) || [];
    assert.ok(asked.length, 'expected the welcome to use at least one icon');
    for (const name of asked) {
        assert.ok(icons.includes('.' + name + ':before'),
            name + ' is not in the shipped icon font');
    }
});

test('the server accepts and stores the flag through the features group', () => {
    // Written by the same endpoint as the switches, or the save 400s.
    assert.match(groupsCode, /'first_run_done'/);
    assert.match(modelCode, /first_run_done/);
});

test('a shop that has never been asked defaults to not-yet-welcomed', () => {
    /*
     * onOnly, so absent parses FALSE. The opposite default - absent means seen
     * - would mean nobody ever gets this, and there would be nothing to notice.
     */
    assert.match(modelCode, /first_run_done: onOnly,/);
});

test('the flag is not treated as a module switch', () => {
    /*
     * It went into moduleToggleMap first, and the repo's own module-key guard
     * caught it: everything in that map is expected to have a control on the
     * settings form, a slot in the save payload and an entry in
     * _moduleToggleIds, because a module switch that misses one of those is
     * silently reset on the next save. This is not a switch - it is a record
     * that somebody has been welcomed - so it belongs in none of them, and the
     * Modules tab's branch selector must not offer it as a feature.
     */
    const map = block(modelCode, 'static moduleToggleMap()', 'updateBranchModules');
    assert.ok(!map.includes('first_run_done'),
        'first_run_done is not a module switch and must stay out of moduleToggleMap');

    // Presence-gated: a settings save that does not mention it cannot move it.
    const toggles = block(modelCode, 'const TOGGLES = {', 'till_lock_idle_minutes');
    assert.match(toggles, /first_run_done: onOnly,/);
    assert.match(toggles, /if \(data\[key\] !== undefined\)/);
});

test('the welcome is one dialog, not two', () => {
    /* An earlier pass built a second welcome in core/first-run.js. Two dialogs
       fighting over the same first sign-in is worse than either alone, and the
       one that survived is the one with the ACL guard. */
    assert.ok(!fs.existsSync(path.join(root, 'frontend/static/script/js/core/first-run.js')),
        'core/first-run.js is superseded by the feature intro modal');
});
