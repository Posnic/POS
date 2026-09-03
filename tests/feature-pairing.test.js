'use strict';

/*
 * Quotes and Invoices are two halves of one job.
 *
 * Owner: "when invoice toggle on, suggest user to switch on quote also. its
 * useful. if he said yes then switch on that too."
 *
 * A shop that prices work before doing it also bills for it afterwards. The
 * quote is the promise, the invoice is the claim, and the same customer sees
 * both - but somebody who finds one switch has usually not thought about the
 * other, and discovers it months later or never.
 *
 * The risk in a suggestion is that it becomes nagging, and nagging is not
 * reported: people just close it more angrily each time. So the three rules
 * that keep it an offer are pinned here.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const settingsJs = fs.readFileSync(
  path.join(ROOT, 'frontend', 'static', 'script', 'js', 'modules', 'js', 'settings.js'), 'utf8');
const settingsHtml = fs.readFileSync(
  path.join(ROOT, 'frontend', 'modules', 'settings_write.html'), 'utf8');

const suggest = (() => {
  const at = settingsJs.indexOf('PosnicPro.settings.suggestPartner = function');
  assert.ok(at > -1, 'suggestPartner is missing');
  return settingsJs.slice(at, settingsJs.indexOf('\n};', at));
})();

test('both switches exist to be paired', () => {
  /* A pairing that names a switch which is not there does nothing, quietly. */
  assert.match(settingsHtml, /id="quotes_enable"/);
  assert.match(settingsHtml, /id="invoices_enable"/);
});

test('each switch offers the other, in both directions', () => {
  const pairs = settingsJs.slice(settingsJs.indexOf('PosnicPro.settings._partners = {'));
  assert.match(pairs, /quotes_enable: \{[\s\S]*?other: 'invoices_enable'/);
  assert.match(pairs, /invoices_enable: \{[\s\S]*?other: 'quotes_enable'/);
});

test('it only offers on the way ON', () => {
  /* Switching Invoices OFF says nothing about Quotes, and asking then would be
     a question about something the person did not do. */
  assert.match(suggest, /if \(!pair \|\| !checkbox\.checked\) return;/,
    'the suggestion is not limited to turning a switch on');
});

test('it only offers when the other is actually off', () => {
  assert.match(suggest, /\$other\.is\(':checked'\)\) return;/,
    'it would offer a switch that is already on');
  assert.match(suggest, /if \(!\$other\.length/,
    'a missing switch should be ignored rather than half-handled');
});

test('"Not now" is an answer, and is not asked again', () => {
  /*
   * The rule that separates a suggestion from nagging. Toggling a switch off
   * and on again must not re-open the question somebody already declined.
   */
  assert.match(suggest, /_partnerAsked\[checkbox\.id\]\) return;/,
    'declining is not remembered, so the question repeats');
  assert.match(suggest, /_partnerAsked\[checkbox\.id\] = true;/,
    'the asked flag is never set');
});

test('saying yes flips the other switch through the same path as a click', () => {
  /*
   * .trigger('change') rather than setting the property alone: the change
   * handler is what marks the form dirty and repaints the card. Setting the
   * box quietly would leave a switch that looks on and saves off.
   */
  assert.match(suggest, /\$other\.prop\('checked', true\)\.trigger\('change'\)/,
    'the partner switch is set without going through the change handler');
});

test('cancelling cannot become an unhandled rejection', () => {
  /* SweetAlert v6 REJECTS on cancel. Without a second handler, "Not now" is an
     unhandled rejection on a screen where nothing went wrong - the same trap
     confirmDemoOff documents a few lines below. */
  const then = suggest.slice(suggest.indexOf('}).then('));
  assert.match(then, /\}\)\.then\(function \(\) \{[\s\S]*?\}, function \(\) \{/,
    'the cancel path has no handler');
});

test('turning the partner on cannot start a loop', () => {
  /*
   * Yes -> partner.trigger('change') -> the handler calls suggestPartner for
   * the PARTNER, whose own partner is the switch just turned on. That returns
   * at the already-checked guard. Asserted because the guard order is what
   * makes it terminate, and reordering it would loop.
   */
  const checkedGuard = suggest.indexOf("$other.is(':checked')");
  const trigger = suggest.indexOf(".trigger('change')");
  assert.ok(checkedGuard > -1 && trigger > checkedGuard,
    'the already-on guard must come before the trigger, or the two switches ask each other forever');
});

test('the change handler actually calls it', () => {
  /* A suggestion nothing invokes is the shape of bug this repository keeps
     finding. */
  assert.match(settingsJs, /PosnicPro\.settings\.suggestPartner\(this\);/,
    'nothing calls suggestPartner, so no offer is ever made');
});
