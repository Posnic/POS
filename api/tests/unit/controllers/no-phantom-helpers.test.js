'use strict';

/*
 * Every this.<helper>() a controller calls must exist on BaseController.
 *
 * THE BUG THIS PINS. Three demo-data handlers called this.sendSuccess - a
 * method BaseController has never had (the success helper is success(); only
 * sendError exists as a legacy wrapper). Nothing failed at load, nothing
 * failed in review, and 9,500 unit tests stayed green because none of them
 * called those three handlers. The failure waited for the first REAL shop to
 * open its Demo Data page: the throw landed in the catch, the catch answered
 * 500, and the owner's report was a misbehaving screen on a brand-new shop.
 *
 * A phantom helper is a spelling mistake that type systems catch and this
 * codebase cannot, so the sweep below is the type check: every `this.x(`
 * inside every controller extending BaseController must resolve to a method
 * on the controller itself, its own class, or the base.
 */
const fs = require('fs');
const path = require('path');

const BaseController = require('../../../src/controllers/base.controller');
const dir = path.join(__dirname, '../../../src/controllers');

const CONTROLLERS = fs.readdirSync(dir).filter((f) => f.endsWith('.controller.js'));

describe('controllers only call helpers that exist', () => {
  /* Prototype methods AND everything the base assigns onto instances -
     constructor-assigned members and class fields never reach the prototype,
     and treating them as missing would fail every controller for helpers
     that genuinely exist. */
  const baseSrc = fs
    .readFileSync(path.join(dir, 'base.controller.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const baseMethods = new Set(Object.getOwnPropertyNames(BaseController.prototype));
  for (const m of baseSrc.matchAll(/this\.([A-Za-z_]\w*)\s*=/g)) baseMethods.add(m[1]);
  for (const m of baseSrc.matchAll(/^\s{2}([A-Za-z_]\w*)\s*=/gm)) baseMethods.add(m[1]);

  test.each(CONTROLLERS)('%s', (file) => {
    const src = fs
      .readFileSync(path.join(dir, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');

    /* Not every controller extends the base; those resolve this.* against
       themselves only. */
    const extendsBase = /extends\s+BaseController/.test(src);

    const own = new Set();
    // methods declared as `name(args) {` at class-body indentation, plus
    // `this.name = ` assignments in constructors
    for (const m of src.matchAll(/^\s{2}(?:async\s+)?([A-Za-z_]\w*)\s*\(/gm)) own.add(m[1]);
    // class fields: `bulkDelete = asyncHandler(...)` defines a method too
    for (const m of src.matchAll(/^\s{2}([A-Za-z_]\w*)\s*=/gm)) own.add(m[1]);
    for (const m of src.matchAll(/this\.([A-Za-z_]\w*)\s*=/g)) own.add(m[1]);

    const missing = [];
    for (const m of src.matchAll(/this\.([A-Za-z_]\w*)\s*\(/g)) {
      const name = m[1];
      if (own.has(name)) continue;
      if (extendsBase && baseMethods.has(name)) continue;
      /* Inherited-from-elsewhere and dynamic patterns would false-positive;
         a name that appears NOWHERE as a definition in the file or the base
         is the phantom this test exists for. Constructor-assigned service
         members (this.service.x()) do not match this pattern at all. */
      missing.push(name);
    }
    expect([...new Set(missing)]).toEqual([]);
  });
});
