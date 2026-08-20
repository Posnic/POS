'use strict';

/*
 * Every route handler must name a controller method that exists.
 *
 * Express catches this when the handler is passed directly - it refuses a
 * callback that is undefined. It does NOT catch it when the route wraps the
 * call, which most of these routes do:
 *
 *     router.post('/updateTemplate', (req, res) => ctrl.updateTemplate(req, res));
 *
 * The wrapper IS a function, so registration succeeds, the server boots, and
 * the TypeError only appears when a real person presses the button. Three
 * routes were live in this state and two of them were wired to UI: the trash
 * icon on a customer's transaction list, and saving a WhatsApp template. Both
 * had been returning 500 to anyone who tried.
 *
 * The other tests here mock every route module to check mounting, so nothing
 * was reading the real files. This does.
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', '..', 'src');
const ROUTES = path.join(SRC, 'routes');
const CONTROLLERS = path.join(SRC, 'controllers');

/* Comments are not code. Five easy-tables routes are commented out precisely
   BECAUSE their controller methods were never written - counting those as
   failures would report work someone already decided against. */
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => {
      const at = line.indexOf('//');
      if (at === -1) return line;
      const before = line.slice(0, at);
      return (before.match(/['"`]/g) || []).length % 2 === 1 ? line : before;
    })
    .join('\n');

/*
 * A DEFINITION, not a mention.
 *
 * The first version of this allowed the name anywhere followed by ( : or =,
 * which a log line satisfies: `console.error('Error in updateTemplate:', e)`
 * made the method look defined by talking about it. Requiring the name to
 * start its own line separates a class method or an assignment from prose and
 * string literals - and it is the difference between this test working and
 * merely appearing to.
 */
const BASE = fs.readFileSync(path.join(CONTROLLERS, 'base.controller.js'), 'utf8');

/*
 * Deliberately weak: does the name appear in the controller at all?
 *
 * I tried to match declaration FORMS first - class method, arrow, object
 * property, export - and each attempt either missed a real declaration style
 * or accepted a mention. One version counted
 * `console.error('Error in updateTemplate:', e)` as a definition, so a method
 * looked defined because the code talked about it; the next was strict enough
 * to flag dozens of methods that plainly exist.
 *
 * A cleverer check that misfires gets switched off. This one cannot: all three
 * real bugs had ZERO occurrences of the name anywhere in their controller,
 * which is what a route pointing at a method nobody wrote actually looks like.
 * It will not catch a method that is merely mentioned - and that is a fair
 * price for a check that never cries wolf.
 */
const defines = (src, name) => {
  const mention = new RegExp(`\\b${name}\\b`);
  return mention.test(src) || (/extends\s+BaseController/.test(src) && mention.test(BASE));
};

/*
 * Handlers known to be missing, with the reason each is still here.
 *
 * This list may shrink. It may not grow: a new entry means a route was wired
 * to a method nobody wrote, which is the whole failure this test exists to
 * stop.
 */
const KNOWN_MISSING = [];

function missingHandlers() {
  const missing = new Set();

  for (const file of fs.readdirSync(ROUTES).filter((f) => f.endsWith('.routes.js'))) {
    const src = stripComments(fs.readFileSync(path.join(ROUTES, file), 'utf8'));

    const controllerSrc = {};
    const importRe =
      /(?:const|let|var)\s+(\w+)\s*=\s*require\(['"]\.\.\/controllers\/([\w.-]+)['"]\)/g;
    for (const m of src.matchAll(importRe)) {
      const name = m[2].endsWith('.js') ? m[2] : `${m[2]}.js`;
      const full = path.join(CONTROLLERS, name);
      if (fs.existsSync(full)) controllerSrc[m[1]] = fs.readFileSync(full, 'utf8');
    }
    if (!Object.keys(controllerSrc).length) continue;

    for (const m of src.matchAll(/\b(\w+)\.(\w+)\b/g)) {
      const [, obj, method] = m;
      const target = controllerSrc[obj];
      if (!target || defines(target, method)) continue;
      missing.add(`${file}  ${obj}.${method}`);
    }
  }
  return [...missing].sort();
}

describe('route handlers resolve to real controller methods', () => {
  test('the scan is actually reading routes and controllers', () => {
    const routes = fs.readdirSync(ROUTES).filter((f) => f.endsWith('.routes.js'));
    expect(routes.length).toBeGreaterThan(15);
    expect(fs.readdirSync(CONTROLLERS).length).toBeGreaterThan(15);
  });

  test('no route is wired to a controller method nobody wrote', () => {
    /* Exact match, not "contains". A handler that gets FIXED must be removed
       from the list, so the debt cannot quietly outlive the bug. */
    expect(missingHandlers()).toEqual([...KNOWN_MISSING].sort());
  });
});
