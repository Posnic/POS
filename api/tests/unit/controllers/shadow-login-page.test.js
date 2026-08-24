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
