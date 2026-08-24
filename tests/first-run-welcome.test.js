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

test('the database field is the ONLY gate - no browser-side memory', () => {
    const gate = block(settingsCode, 'maybeShowIntro:', 'renderIntro:');

    /*
     * Owner, after three rounds of this screen not appearing for him: "keep
     * on db field and make sure user know about it." Every browser-side
     * memory this gate ever had has burned it - the bare key, then the
     * per-shop key. first_run_decided lives on the SHOP, is written only by
     * the two decision paths, and can be read and reset with a one-line
     * database query when somebody asks why a welcome did or did not show.
     */
    assert.ok(!/local\.get\([^)]*intro[^)]*\)/i.test(gate),
        'the gate is reading browser storage again');
    assert.ok(!settingsCode.includes('_introSeenKey'),
        'the retired browser-key helper is back');
    assert.match(gate, /first_run_decided === true \|\| \w+\.first_run_decided === 'true'/);
});

test('an unloaded settings blob is not treated as a shop that has never been asked', () => {
    const gate = block(settingsCode, 'maybeShowIntro:', 'renderIntro:');
    /*
     * The failure this prevents: settings have not arrived yet, every key reads
     * absent, and a shop trading for a year is greeted with "your shop is
     * ready". Absent must mean "do not know", never "new".
     */
    /* return FALSE, not bare return: it is the one outcome that means "not
       loaded yet", and the poll below retries only on it. */
    assert.match(gate, /if \(!Object\.keys\(\w+\)\.length\) \{ return false; \}/);
});

test('the check polls until settings load, instead of firing once and giving up', () => {
    /*
     * On a brand-new shop's FIRST login the blob is still being written when
     * a fixed delay fires. A one-shot check loses that race on exactly the
     * login this screen exists for, and nothing looks wrong afterwards - the
     * shop simply appears to have no welcome.
     */
    const boot = settingsCode.slice(settingsCode.indexOf('var poll = function'));
    assert.match(boot, /maybeShowIntro\(\) === false && tries < \d+/);
    assert.match(boot, /setTimeout\(poll, \d+\)/);
});

test('the super admin is always asked - the ACL shape cannot refuse them', () => {
    /*
     * THE BUG THAT KEPT THE WELCOME FROM THE OWNER THREE TIMES. An
     * owner-class ACL does not reliably carry setting.write === true - full
     * access is often an EMPTY map middleware treats as allow-all - so the
     * old test refused exactly the person the screen is for. "mainly super
     * admin" was him reporting that.
     */
    const gate = block(settingsCode, 'maybeShowIntro:', 'renderIntro:');
    assert.match(gate, /usertype === 'super_admin' \|\| usertype === 'admin'/);
    assert.match(gate, /if \(!isAdmin\)/);
});

test('an unloaded ACL retries; only a real cashier is refused', () => {
    /*
     * The old gate returned undefined on a not-yet-loaded ACL, which ENDED
     * the poll - any login where the ACL arrived after the settings blob
     * silently lost the welcome for that session. Not-loaded must retry
     * (return false); only an explicit non-writer stops.
     */
    const gate = block(settingsCode, 'maybeShowIntro:', 'renderIntro:');
    assert.match(gate, /if \(!acl \|\| !acl\.setting\) \{ return false; \}/);
    assert.match(gate, /if \(acl\.setting\.write !== true\) \{ return; \}/);
});

test('only a DECISION ends the welcome - a casual dismissal brings it back', () => {
    /*
     * Owner, escalating: "until skip you keep showing the features as first
     * page." The first design marked any close as asked; he overruled it,
     * and he is right about who this screen is for - a brand-new user who
     * Escapes a dialog they did not read has not learned that features are
     * switchable, which is the entire point. Save and the explicit "Not now"
     * write the flags; Esc and a stray click write NOTHING, and the welcome
     * returns next login.
     */
    const gate = block(settingsCode, 'maybeShowIntro:', 'runningContext:');
    /* No dismiss handler at all now: an undecided close leaves NOTHING, and
       the DB flag written by Save / "Not now" is the entire record. */
    assert.ok(!/hidden\.bs\.modal/.test(gate),
        'a dismiss handler is writing browser state again');

    // The explicit Skip is the decision that writes both flags.
    const skip = block(settingsCode, "'#feature_intro_skip', function", "'#fi_module_demo_data_enable'");
    assert.match(skip, /_decided = true/);
    assert.match(skip, /settings\/group\/features/);
    assert.match(skip, /first_run_decided: 'true'/);
    // And a failed write un-decides, so the shop is asked again - correct
    // for a shop that was never recorded as asked.
    assert.match(skip, /_decided = false/);
});

test('the welcome opens OVER the features page', () => {
    /* "first the first time login or until skip you keep showing the
       features as first page" - whichever way the dialog closes, the person
       is standing in front of the switches it was talking about. */
    const gate = block(settingsCode, 'maybeShowIntro:', 'runningContext:');
    assert.match(gate, /hasher\.setHash\('settings\/modules'\)/);
});

test('saving writes the flag in the same request as the switches', () => {
    const save = block(settingsCode, 'saveIntro:', '$(document).on(');
    /*
     * A separate call could succeed while the toggles failed, and the shop
     * would then never again be offered switches it did not manage to save.
     */
    assert.match(save, /payload\.first_run_done = 'true';/);
    assert.match(save, /payload\.first_run_decided = 'true';/);
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
    // Generalised to a key argument so first_run_decided rides the same rule.
    assert.match(keep, /d\[k\] === true \|\| d\[k\] === 'true'\) \{ return true; \}/);
    assert.match(keep, /d\[k\] === false \|\| d\[k\] === 'false'\) \{ return false; \}/);
    assert.match(keep, /return PosnicPro\.features\._blob\(\)\[k\] === true;/);

    // And every blob rebuild carries BOTH flags - losing decided re-shows the
    // welcome to somebody who genuinely decided.
    const carried = settingsCode.match(/first_run_decided: PosnicPro\.features\.keepFirstRunFlag\(/g) || [];
    assert.ok(carried.length >= 3, 'expected the decided flag in every blob rebuild, found ' + carried.length);
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

/*
 * The welcome now says what KIND of Posnic this is.
 *
 * Owner: "when user logins first time we show features and ours is both web
 * and desktop those info shared or not ? how we can convey ?" - and earlier,
 * twice: "user is not clear about this system software desktop application
 * plus web based... when first visit he dont know."
 *
 * The website explains it now; the first sign-in did not, and the first
 * sign-in is the one screen a new shop is certain to read.
 */
const accessCode = block(settingsCode, 'runningContext:', 'renderIntro:');

test('the welcome carries the desktop-and-web strip', () => {
    assert.ok(modalCode.includes('id="feature_intro_access"'),
        'the welcome has nowhere to say what kind of till this is');
    assert.match(settingsCode, /\$\('#feature_intro_access'\)\.html\(PosnicPro\.features\.accessNote\(\)\)/);
});

test('the sentence is picked from where this is actually running', () => {
    /*
     * Never the generic "we have both an app and a website" - that tells
     * somebody nothing about the one they are looking at. Desktop is the
     * Electron userAgent; web is a public hostname; and localhost or a
     * private address is the shop's own network, where claiming the address
     * "opens on any phone" would be false the moment they left the building.
     */
    assert.match(accessCode, /Electron/);
    assert.match(accessCode, /'desktop'/);
    assert.match(accessCode, /192\\.168\\./);
    assert.match(accessCode, /'lan' : 'web'/);
});

test('the web variant states the address it is certain of', () => {
    /* In a browser the shop's address IS the address bar - no lookup, and no
       way for it to be stale. It is the one dynamic value, and it is escaped. */
    assert.match(accessCode, /esc\(window\.location\.hostname\)/);
});

test('the desktop variant does not invent a web address', () => {
    /*
     * The app does not reliably know its shop's cloud address, and a guessed
     * URL that 404s teaches a brand-new user that the product lies. The
     * welcome email and My Account genuinely carry it, so that is where the
     * sentence points.
     */
    const desktop = block(accessCode, "ctx === 'desktop'", "ctx === 'web'");
    assert.match(desktop, /welcome email/);
    assert.match(desktop, /My Account/);
    assert.ok(!desktop.includes('window.location'),
        'the desktop sentence must not present the local address as a web address');
});

test('every variant names both halves of the product', () => {
    /* Whichever one somebody is in, the sentence must tell them the other
       exists - that is the entire question being answered. */
    for (const marker of ["ctx === 'desktop'", "ctx === 'web'"]) {
        assert.ok(accessCode.includes(marker), marker + ' variant is missing');
    }
    /* accessCode ends before renderIntro, so the web variant runs to its end. */
    const web = accessCode.slice(accessCode.indexOf("ctx === 'web'"));
    assert.match(web, /desktop app/);
    const desktop = block(accessCode, "ctx === 'desktop'", "ctx === 'web'");
    assert.match(desktop, /browser/);
});

test('the strip is styled from theme tokens like the rest of the welcome', () => {
    const strip = block(cssCode, '.first-run-access {', '.first-run-foot {');
    assert.match(strip, /var\(--theme-border-color/);
    assert.match(strip, /var\(--theme-text-muted/);
    const hard = strip.match(/(?:color|background):\s*#[0-9a-fA-F]{3,8}\s*;/g) || [];
    assert.deepStrictEqual(hard, [], 'the strip hard-codes colours: ' + hard.join(', '));
});
