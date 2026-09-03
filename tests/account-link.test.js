'use strict';

/*
 * The link to a shop's Posnic account, and who is allowed to see it.
 *
 * Two mistakes are easy here and both are silent.
 *
 * SHOWING IT TO THE WRONG SHOP. A community install has no account. Sending
 * its owner to posnic.com/account to be told "no account found" is worse than
 * never offering the link, and it is the sort of thing nobody reports - they
 * just decide the software is confused.
 *
 * HIDING IT FROM THE RIGHT ONE. resolveMode() answers 'desktop' before it looks
 * at anything else, so a till PAIRED TO CLOUD - a paying customer, standing at
 * their own counter - reports edition 'community'. A frontend test on edition
 * would hide the link from precisely the people it exists for. That is why the
 * decision is a server-side flag and not a string comparison in the browser.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { buildRuntimeInfo, hasAccount } = require(
  path.join(ROOT, 'api', 'src', 'utils', 'runtime-info'));

const features = (env) => buildRuntimeInfo(env).features;

test('a provisioned cloud shop is offered its account', () => {
  assert.equal(features({ POSNIC_KEY: 'shop-key' }).account, true);
  assert.equal(features({ POSNIC_CLOUD: '1' }).account, true);
});

test('a till paired to cloud is offered it, even though its mode says desktop', () => {
  /* The case the whole flag exists for. */
  const info = buildRuntimeInfo({ POSNIC_DESKTOP: '1', POSNIC_SYNC_PAIRED: '1' });
  assert.equal(info.mode, 'desktop', 'a paired till still runs in desktop mode');
  assert.equal(info.edition, 'community', 'and still reports the community edition');
  assert.equal(info.features.account, true,
    'but it belongs to a paying customer, and the link is for them');
});

test('a community install is never sent to an account page', () => {
  assert.equal(features({ POSNIC_DESKTOP: '1' }).account, false, 'unpaired desktop');
  assert.equal(features({}).account, false, 'self-hosted server');
  assert.equal(features({ POSNIC_SYNC_PAIRED: '0' }).account, false, 'explicitly not paired');
});

test('a white-labelled build never mentions Posnic', () => {
  /*
   * That shop was sold something with somebody else's name on it. Sending its
   * owner to posnic.com would undo the rebrand they paid for.
   */
  assert.equal(features({ POSNIC_KEY: 'k', WHITE_LABEL_NAME: 'Acme POS' }).account, false);
  assert.equal(features({ POSNIC_DESKTOP: '1', POSNIC_SYNC_PAIRED: '1', WHITE_LABEL_NAME: 'Acme POS' }).account, false);
  /* An empty or whitespace value is not a white label. */
  assert.equal(features({ POSNIC_KEY: 'k', WHITE_LABEL_NAME: '   ' }).account, true);
});

test('the flag is readable without knowing it exists', () => {
  /* features has always shipped as an object so clients can read it
     unconditionally; a missing flag must read as false, not throw. */
  const info = buildRuntimeInfo({});
  assert.equal(typeof info.features, 'object');
  assert.ok(!info.features.somethingWeHaveNotBuiltYet);
});

test('hasAccount is pure and takes its environment', () => {
  /* So it can be reasoned about and tested without a process. */
  assert.equal(hasAccount({}, 'cloud'), true);
  assert.equal(hasAccount({}, 'desktop'), false);
  assert.equal(hasAccount({ POSNIC_SYNC_PAIRED: '1' }, 'desktop'), true);
});

/* ------------------------------------------------------------ the shell --- */

test('the desktop shell tells the API when the till is paired', () => {
  /*
   * The API cannot work this out alone - only the shell reads the cloud config
   * file. Without this, features.account is false on every desktop till,
   * including every paying one.
   */
  const main = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
  assert.match(main, /process\.env\.POSNIC_SYNC_PAIRED = '1'/,
    'main.js never sets POSNIC_SYNC_PAIRED, so no paired till will show the link');
  assert.match(main, /cloud\.gatewayUrl && cloud\.deviceToken/,
    'the flag is set without checking that the till is actually enrolled');

  /* Before the API is required, or the API reads an env that is not set yet. */
  const flagAt = main.indexOf("process.env.POSNIC_SYNC_PAIRED");
  const desktopAt = main.indexOf("process.env.POSNIC_DESKTOP = '1'");
  assert.ok(desktopAt > 0 && flagAt > desktopAt,
    'the pairing flag should be set alongside the other runtime identity');
});

/* --------------------------------------------------------- the frontend --- */

test('the menu item ships hidden and links out safely', () => {
  const header = fs.readFileSync(
    path.join(ROOT, 'frontend', 'layouts', 'header.html'), 'utf8');
  const item = /<li[^>]*id="posnic_account_item"[\s\S]*?<\/li>/.exec(header);
  assert.ok(item, 'the account item is not in the header');

  assert.match(item[0], /style="display:none;"/,
    'the item ships visible, so a community shop would see it before any check runs');
  assert.match(item[0], /href="https:\/\/posnic\.com\/account"/, 'it does not link to the account page');
  assert.match(item[0], /target="_blank"/, 'it should open in a new tab, not replace the till');
  assert.match(item[0], /rel="noopener noreferrer"/,
    'a target=_blank link without noopener hands the opener to the other page');
  assert.match(item[0], /lang class="lang_posnic_account_title"/,
    'the label is not translatable');
});

test('only a super_admin is shown it, and only when the server agrees', () => {
  const dash = fs.readFileSync(
    path.join(ROOT, 'frontend', 'static', 'script', 'js', 'modules', 'js', 'dashboard.js'), 'utf8');
  const fn = /\(function showAccountLink\(\)[\s\S]*?\}\(\)\);/.exec(dash);
  assert.ok(fn, 'showAccountLink is missing');

  assert.match(fn[0], /usertype'\) !== 'super_admin'/,
    'a cashier would be shown the subscription and the bill');
  assert.match(fn[0], /info\.features && info\.features\.account/,
    'the browser decides on its own instead of asking the server');
  assert.match(fn[0], /\.catch\(/,
    'a failed request must leave the item hidden, not throw');

  /*
   * The path bug that would make this ship dead: the page is served from
   * /public, so a relative 'api/runtime-info' resolves to
   * /public/api/runtime-info, 404s, lands in the catch, and hides the link
   * forever without anybody noticing.
   */
  assert.match(fn[0], /base \+ 'api\/runtime-info'/,
    'the fetch does not use API_URL, so it will 404 from /public and fail silently');
});
