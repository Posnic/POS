'use strict';

/**
 * Controllers call methods that actually exist on the services they hold.
 *
 * THE BUG THIS FILE IS FOR.
 *
 * `services/item.service.js` exports a CLASS. `services/sale.service.js` next
 * door exports a ready-made object. Requiring the first one the way you require
 * the second gives you the constructor, so every method is `undefined` and
 * every call is a TypeError the moment a real request arrives:
 *
 *     itemService.defaultStoreId is not a function
 *
 * That shipped. The online ordering storefront, the public menu and the
 * default-branch lookup were all dead on the deployed API while every unit test
 * passed, because the controller tests mock the service and a mock has whatever
 * methods the test gives it. The shape only exists in production.
 *
 * So this asserts the real thing: the real service, the real methods, no mocks.
 * It is deliberately not a test of behaviour - behaviour is covered elsewhere -
 * it is a test that the wiring is the shape the caller assumed.
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', '..', 'src');

/*
 * Comments out first.
 *
 * The comment above this controller explains the bug by writing
 * `salesService.foo()`, and a scan that cannot tell prose from code reads that
 * as a call to a method named foo and fails on it. A check that is confused by
 * its own documentation is a check people delete.
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, '');
}

/** Which service methods a controller's source actually calls. */
function methodsCalledOn(controllerFile, variableName) {
  const src = stripComments(fs.readFileSync(path.join(SRC, 'controllers', controllerFile), 'utf8'));
  const called = new Set();
  for (const m of src.matchAll(new RegExp(`\\b${variableName}\\.(\\w+)\\s*\\(`, 'g'))) {
    called.add(m[1]);
  }
  return [...called].sort();
}

describe('the online ordering controller and the services it holds', () => {
  test('every itemService method it calls exists on a real instance', () => {
    const ItemService = require('../../../src/services/item.service');
    /* A class, so it has to be constructed. If somebody "simplifies" the
       controller back to a bare require, this is the test that says so. */
    expect(typeof ItemService).toBe('function');

    const service = new ItemService();
    const missing = methodsCalledOn('online-ordering.controller.js', 'itemService').filter(
      (name) => typeof service[name] !== 'function'
    );
    expect(missing).toEqual([]);
  });

  test('every salesService method it calls exists on the module it exports', () => {
    /* sale.service.js exports an object rather than a class, which is the
       inconsistency that caused the mistake. Both shapes are checked here so
       the difference is written down somewhere a reader will find it. */
    const salesService = require('../../../src/services/sale.service');
    const missing = methodsCalledOn('online-ordering.controller.js', 'salesService').filter(
      (name) => typeof salesService[name] !== 'function'
    );
    expect(missing).toEqual([]);
  });

  test('the controller constructs the item service rather than using the class', () => {
    const src = fs.readFileSync(
      path.join(SRC, 'controllers', 'online-ordering.controller.js'),
      'utf8'
    );
    expect(src).toMatch(/new ItemService\(\)/);
  });

  test('the approval queue methods the sales controller calls exist', () => {
    /* Same class of failure, different door: these were added at the same time
       and are reached from a screen nobody had opened yet. */
    const salesService = require('../../../src/services/sale.service');
    for (const name of ['pendingOnlineOrders', 'decideOnOrder', 'commissionReport']) {
      expect(typeof salesService[name]).toBe('function');
    }
  });
});
