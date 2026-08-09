'use strict';
/*
 * Every route must be bound to a handler that exists.
 *
 * The route files bind controller methods by reference:
 *
 *     router.get('/search', bindController(itemsController.search));
 *
 * If that method does not exist, `bindController` does not throw. It returns a
 * stub answering 501 "Handler not implemented", so the route mounts, the app
 * boots, every test passes, and the endpoint is dead.
 *
 * That is not hypothetical. `/api/items/search` - the cashier's search box, the
 * first thing anybody does at a till - has been answering 501 in production,
 * and the access logs show real users hitting it. Nothing reported it, because
 * from the outside a 501 is a perfectly well-formed response and from the
 * inside there is no error at all.
 *
 * The failure is silent by construction, so a static check is the only thing
 * that finds it before a customer does.
 */

const fs = require('fs');
const path = require('path');

const ROUTES = path.join(__dirname, '..', '..', '..', 'src', 'routes');

/*
 * Routes already answering 501 when this check was written.
 *
 * Recorded rather than fixed, because implementing six handlers correctly is
 * feature work and guessing at what they should return would be worse than
 * leaving them. The point of listing them is that the check can go green and
 * start guarding against the NEXT one, instead of being disabled for being
 * noisy.
 *
 * Each entry is a debt, not an exemption. The first is being paid by a
 * customer today.
 */
const KNOWN_UNIMPLEMENTED = new Set([
  /* The cashier's search box. Access logs show real users hitting this and
     receiving 501 - a till with 4,000 products and no working search cannot
     sell at counter speed. This one should be fixed first. */
  'items.routes.js:search',
  /* Change feed for the desktop sync agent. */
  'items.routes.js:getDataChanges',
  'receivings.routes.js:getDataChanges',
  /* Stock-in screens. No evidence in the access logs that anything calls
     these, which is the likeliest reason nobody has noticed. */
  'receivings.routes.js:getSummary',
  'receivings.routes.js:pendingReceivingProductDetails',
  'receivings.routes.js:updateStatus',
]);

/** `const xController = require('../controllers/…')` → the module it names. */
function controllersOf(source, file) {
  const found = new Map();
  const re = /const\s+(\w+)\s*=\s*require\(['"]([^'"]+)['"]\)/g;
  let m;
  while ((m = re.exec(source))) {
    const [, name, spec] = m;
    if (!/controller/i.test(spec)) continue;
    try {
      found.set(name, require(path.resolve(path.dirname(file), spec)));
    } catch (e) {
      /* A controller that cannot be loaded is a different failure, and the
         suites for that module will say so far more clearly than this one. */
    }
  }
  return found;
}

describe('every route is bound to a handler that exists', () => {
  const files = fs.readdirSync(ROUTES).filter((f) => f.endsWith('.routes.js'));

  test('no route is silently answering 501', () => {
    const dead = [];

    for (const file of files) {
      const full = path.join(ROUTES, file);
      const source = fs.readFileSync(full, 'utf8');
      const controllers = controllersOf(source, full);
      if (!controllers.size) continue;

      const lines = source.split('\n');
      lines.forEach((line, i) => {
        /* bindController(xController.method) — the shape that degrades to 501 */
        const m = line.match(/bindController\(\s*(\w+)\s*\.\s*(\w+)\s*[),]/);
        if (!m) return;
        const [, objName, method] = m;
        const controller = controllers.get(objName);
        if (!controller) return; // not a controller we could resolve

        if (typeof controller[method] !== 'function') {
          const id = `${file}:${method}`;
          if (!KNOWN_UNIMPLEMENTED.has(id)) {
            dead.push(`${file}:${i + 1}  ${objName}.${method} does not exist`);
          }
        }
      });
    }

    if (dead.length) {
      throw new Error(
        'These routes are bound to controller methods that do not exist. They mount ' +
          'cleanly and answer 501 "Handler not implemented" to every caller:\n\n' +
          dead.join('\n') +
          '\n\nEither implement the method, remove the route, or add it to ' +
          'KNOWN_UNIMPLEMENTED with a reason.'
      );
    }
    expect(dead).toEqual([]);
  });

  test('the allowlist only names routes that still exist', () => {
    /* An entry left behind after a method is implemented would hide the next
       one that breaks the same way. */
    for (const id of KNOWN_UNIMPLEMENTED) {
      const [file] = id.split(':');
      expect(fs.existsSync(path.join(ROUTES, file))).toBe(true);
    }
  });

  test('the allowlist does not name handlers that now exist', () => {
    /*
     * The half of an allowlist everybody forgets. Once `items.search` is
     * implemented, its entry here would go on excusing the next method that
     * disappears under the same name - so implementing a handler must force
     * its line to be deleted.
     */
    const stale = [];
    for (const id of KNOWN_UNIMPLEMENTED) {
      const [file, method] = id.split(':');
      const full = path.join(ROUTES, file);
      if (!fs.existsSync(full)) continue;
      const source = fs.readFileSync(full, 'utf8');
      for (const controller of controllersOf(source, full).values()) {
        if (typeof controller[method] === 'function') {
          stale.push(`${id} — implemented now; remove it from KNOWN_UNIMPLEMENTED`);
        }
      }
    }
    expect(stale).toEqual([]);
  });
});
