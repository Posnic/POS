'use strict';

/*
 * A receipt never comes out in the kitchen.
 *
 * Owner, on a two-printer restaurant: "receipt only send to Reception right.
 * kitchen should receive only kot print."
 *
 * On the test machine the receipt printer had never been SAVED - ticking the
 * box in Hardware Manager is not enough, there is a Save that writes it - so
 * preferences.json held only { "kot.enabled": true }. With nothing chosen, the
 * print path falls back to whatever Windows calls its default, and on that
 * machine the Windows default was "Posnic Kitchen". A settled table's receipt,
 * ₹1018.50, came out on the kitchen roll, and nothing on screen said so.
 *
 * A printer this till already sends kitchen tickets to is, by definition, not
 * the counter. Only the GUESS is refused: a shop that deliberately chose that
 * printer for receipts is obeyed, because that is its decision to make.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SHELL = fs.readFileSync(path.join(ROOT, 'frontend', 'static', 'script', 'js', 'core', 'PosnicPro.js'), 'utf8');
const BILL = fs.readFileSync(path.join(ROOT, 'src', 'bill-manager.js'), 'utf8');
const PREFS = fs.readFileSync(path.join(ROOT, 'src', 'device-preferences.js'), 'utf8');

test('the till knows which printers the kitchen uses', () => {
  assert.match(SHELL, /window\.electronAPI\.kot\.getConfig\(\)/, 'nothing reads the kitchen list');
  assert.match(SHELL, /PosnicPro\._kitchenPrinters = kitchen/, 'the list is never kept');
  /* Both shapes the kitchen config has used. */
  assert.match(SHELL, /Array\.isArray\(kot\.printerNames\)/);
  assert.match(SHELL, /Array\.isArray\(kot\.printers\)/);
  /* Lower-cased once, because the comparison runs with a customer waiting. */
  assert.match(SHELL, /\.trim\(\)\.toLowerCase\(\); \}\)\s*\.filter\(Boolean\);/);
});

test('a guessed printer that is the kitchen roll is refused, with a message that says what to do', () => {
  const guard = SHELL.slice(SHELL.indexOf('var usedTheDefault = false;'), SHELL.indexOf('Auto-open the cash drawer'));
  assert.match(guard, /usedTheDefault = true;/, 'nothing records that the printer was a guess');
  assert.match(guard, /if \(usedTheDefault && PosnicPro\._kitchenPrinters/, 'the guess is not checked');
  assert.match(guard, /Choose one in Hardware Manager, Receipt Printer\./, 'the refusal does not say how to fix it');
});

test('a printer the shop CHOSE is obeyed, even if the kitchen also uses it', () => {
  /* One-printer shops exist, and a shop that deliberately points receipts at
     the same roll is making a decision this code has no business overruling. */
  const guard = SHELL.slice(SHELL.indexOf('var usedTheDefault = false;'), SHELL.indexOf('Auto-open the cash drawer'));
  assert.ok(/usedTheDefault &&/.test(guard), 'the check is not limited to the fallback');
  assert.ok(!/_kitchenPrinters\.indexOf\(String\(printerName\)[\s\S]{0,80}\)\s*!== -1\) \{\s*throw[\s\S]{0,40}\}\s*\}/.test(
    guard.replace(/usedTheDefault && /, '')
  ), 'placeholder');
});

test('the floor bill refuses the kitchen roll the same way', () => {
  const fn = BILL.slice(BILL.indexOf('async _receiptPrinterName()'), BILL.indexOf('async _printOne('));
  assert.match(fn, /devicePrefs\.isKitchenPrinter\(fallback\)/, 'the bill still guesses onto the kitchen');
  assert.match(fn, /the bill is not printed/, 'it prints anyway and only warns');
  assert.match(fn, /return '';/, 'nothing stops the print');
  /* And a chosen printer is still used without any of this getting in the way. */
  assert.ok(fn.indexOf('this.findReceiptPrinter') < fn.indexOf('isKitchenPrinter'),
    'the chosen printer is checked after the guess, which would break a deliberate choice');
});

test('the preferences module can answer which printers are the kitchen', () => {
  assert.match(PREFS, /function kotPrinterNames\(\)/);
  assert.match(PREFS, /function isKitchenPrinter\(name\)/);
  assert.match(PREFS, /kot-config\.json/, 'it looks in the wrong file');
  assert.match(PREFS, /\.toLowerCase\(\) === wanted/, 'the names are matched exactly, so case defeats it');
  assert.match(PREFS, /return \[\];/, 'a shop with no kitchen config would throw');
  assert.match(PREFS, /module\.exports = \{[^}]*isKitchenPrinter/);
});
