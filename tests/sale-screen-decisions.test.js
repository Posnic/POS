'use strict';

/*
 * One afternoon of sale-screen reports, pinned so none of them regress:
 *
 *  - "why categories first row box size and second row size is different?"
 *    The category grid split itself every fourth tile into a PLAIN Bootstrap
 *    row, dropping those tiles out of the CSS grid that sizes the first four.
 *  - "item list name looks bold. same used for all data table. remove it."
 *  - "after sales when mouse move you are cancelling auto close. make that
 *    as mouse click... dont ignore close button close."
 *  - "sales auto close stuff also only first time only" - the movement
 *    threshold held the card forever on every sale where the hand was still
 *    travelling back from the Complete button.
 *  - "send test notification works but second time not working" - same-tag
 *    notifications replace each other SILENTLY without renotify.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', 'frontend', rel), 'utf8');
const sales = read('static/script/js/modules/js/sales.js');
const css = read('static/style/css/custom.css');
const sw = read('sw-template.js');

test('sale tiles live in ONE self-wrapping grid - no manual row breaks', () => {
    /* The %4 split was a Bootstrap relic: every row it opened lacked
       sale-tile-grid, so tiles 5+ fell back to full-size columns and the
       first row looked like a different product. */
    assert.ok(!/% 4 === 0/.test(sales), 'a fourth-tile row break is back');
    /* all three tile surfaces open the same grid: items tab, category tab,
       and a category\'s own items */
    const grids = sales.match(/class=["']row (mb-3 )?sale-tile-grid/g) || [];
    assert.ok(grids.length >= 3, 'a tile surface lost the sale-tile-grid class: ' + grids.length);
});

test('data-table name links are links, not headlines', () => {
    const rule = css.slice(css.indexOf('.table_model_item{'), css.indexOf('}', css.indexOf('.table_model_item{')));
    assert.match(rule, /font-weight: normal/);
    assert.ok(!/font-weight: *(900|bold|700)/.test(rule), 'the bold came back');
});

test('only a CLICK holds the sale-done card open - movement is not intent', () => {
    /* Two prior definitions each broke a different way: hover-anywhere
       cancelled on the frame the card appeared; movement-over-12px held it
       forever on every sale after the first. */
    assert.ok(!/mousemove.*#newsalespage/.test(sales), 'the movement hold is back');
    assert.match(sales, /\$\(document\)\.on\('mousedown touchstart', '#newsalespage'/);
    /* the two action buttons stay out of the hold - in BOTH hold handlers
       (pointer and keyboard), or one path quietly swallows the close X */
    const exclusions = sales.match(/closest\('\.sale-done-primary, \.infobar-tender-close'\)\.length\) \{ return; \}/g) || [];
    assert.strictEqual(exclusions.length, 2, 'a hold handler lost its action-button exclusion');
});

test('the close X on the done card CLOSES into a new sale, never just hides', () => {
    const closer = sales.slice(sales.indexOf("$(document).on('click', '.infobar-tender-close'"));
    assert.match(closer, /#newsalespage'\)\.is\(':visible'\)/);
    assert.match(closer, /saleDoneTimer\.stop\(\)/);
    assert.match(closer, /\.sale-done-primary'\)\.get\(0\)/);
    /* the primary is excluded or it would click itself */
    assert.match(closer, /hasClass\('sale-done-primary'\)\) \{ return; \}/);
});

test('a second sale gets a fresh countdown - the held state does not leak', () => {
    const start = sales.slice(sales.indexOf('start: function ()'), sales.indexOf('hold: function ()'));
    assert.match(start, /removeClass\('is-held is-closing'\)/);
    /* and the class round-trip restarts the CSS animation for back-to-back
       sales - the reflow read is the restart */
    assert.match(start, /offsetWidth/);
});

test('a repeated notification announces itself - same-tag replacement is silent', () => {
    const push = sw.slice(sw.indexOf("addEventListener('push'"));
    assert.match(push, /renotify: true/);
    assert.match(push, /tag: data\.tag \|\| 'posnic'/);
});
