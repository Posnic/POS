'use strict';

/*
 * The shadow sign-in page must hand over a WHOLE identity.
 *
 * It stored token + email and nothing else, and every missing field failed
 * as its own separate mystery: usertype's absence made the first-run
 * welcome's admin bypass never fire, username's absence made the ajax layer
 * bounce any failed call to login.html, and the missing branch identity
 * blanked the header. Shadow sessions are also how the OWNER opens shops
 * from My Account - so "it works for normal login" was tested by everybody
 * except the person reporting it.
 */
const fs = require('fs');
const path = require('path');

const src = fs
  .readFileSync(path.join(__dirname, '../../../src/controllers/shadow-login.controller.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

describe('the shadow page stores what a normal sign-in stores', () => {
  test('the payload carries the identity fields, not just the token', () => {
    for (const field of ['username:', 'usertype:', 'branch_id:', 'branch_name:']) {
      expect(src).toContain(field);
    }
  });

  test('the page script writes each into localStorage', () => {
    for (const key of ['username', 'usertype', 'branch_id_set', 'branchname']) {
      expect(src).toContain(`localStorage.setItem('${key}'`);
    }
  });

  test('branch identity survives users whose branch lives in branch_access', () => {
    expect(src).toMatch(/branch_access\[0\]/);
  });
});

describe('owner shadow sign-in counts as opening the shop', () => {
  test('the owner path is classified separately from support shadow access', () => {
    expect(src).toMatch(/owner sign-in from posnic\.com/);
    expect(src).toMatch(/actor: shadowActor/);
    expect(src).toMatch(/shadowActor === 'owner'/);
  });

  test('owner shadow sign-in writes the same staff activity row as normal login', () => {
    expect(src).toMatch(/BaseModel\.changeUserLog\(/);
    expect(src).toMatch(/user\.branch_id \|\| firstBranch\.branch_id/);
    expect(src).toMatch(/user\.license \|\| user\.license_id/);
    expect(src).toMatch(/clientIp\(req\)/);
  });
});

describe('the next route (the rig lands on any page in one launch)', () => {
  /*
   * A page that only breaks on #/variants cannot be captured by a run that
   * always lands on the dashboard - and a second browser launch loses the
   * first one's storage when the harness kills Chrome before the profile
   * flushes. So the sign-in page honours ?next=<route>. The property that
   * MUST hold: next is a bare hash route, never a URL and never markup -
   * this page's body is a working credential, and an open redirect or
   * script injection here is a credential-stealing primitive.
   */
  test('next is allow-listed to route characters and length-capped', () => {
    expect(src).toMatch(/\^\[a-zA-Z0-9\/_-\]\{1,80\}\$/);
    /* the fallback for anything that fails the test is EMPTY, not the raw input */
    expect(src).toMatch(/\.test\(nextRaw\) \? nextRaw : ''/);
  });

  test('the sanitised value travels through the JSON payload, never string-glued', () => {
    /* JSON.stringify is the escaping; interpolating the raw query into the
       script body would undo the whole allow-list. */
    expect(src).toMatch(/next: nextRoute,/);
    expect(src).not.toMatch(/\$\{nextRaw\}/);
    expect(src).not.toMatch(/\$\{nextRoute\}/);
  });

  test('the redirect goes to the app shell with the hash, or home without one', () => {
    expect(src).toMatch(/d\.next \? '\/dashboard\.html#\/' \+ d\.next : '\/'/);
  });
});
