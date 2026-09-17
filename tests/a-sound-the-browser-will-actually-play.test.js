'use strict';

/*
 * A SOUND THE BROWSER WILL ACTUALLY PLAY.
 *
 * Every noise this product makes - the new order alarm, the kitchen's ting -
 * is a WAV synthesised in the main process and handed to the page as a data:
 * URL. Nothing is shipped as a sound file, nothing is read off disk and
 * nothing is fetched, which is the right design for a till that has to work
 * with the internet unplugged.
 *
 * helmet's default directives do not name media-src. Without one declared,
 * media falls back to default-src 'self', and 'self' does not include data: -
 * so the browser refuses every one of those tones.
 *
 * THIS IS THE FAILURE THAT LOOKS EXACTLY LIKE SUCCESS. The only evidence is a
 * console warning nobody reads, and the symptom is silence in a room where
 * silence is what you expect anyway. It was found by reading a customer
 * machine's log, not by anybody noticing:
 *
 *   Loading media from 'data:audio/wav;base64,...' violates the following
 *   Content Security Policy directive: "default-src 'self'". Note that
 *   'media-src' was not explicitly set, so 'default-src' is used as a
 *   fallback. The action has been blocked.
 *
 * Which is why it is pinned here rather than left to be noticed again.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

test('THE LINE IS LOAD-BEARING: helmet does not give us media-src for free', () => {
  /*
   * The whole reason app.js has to declare this. If a future helmet starts
   * shipping a media-src default, this test turning red is the signal to read
   * what that default actually permits rather than to delete anything.
   */
  const helmet = require('../api/node_modules/helmet');
  const defaults = helmet.contentSecurityPolicy.getDefaultDirectives();

  assert.ok(
    !Object.prototype.hasOwnProperty.call(defaults, 'media-src'),
    'helmet now sets media-src itself - check whether it allows data:, because ' +
      'every sound this product makes is a data: URL',
  );
});

test('THE CSP LETS A data: SOUND PLAY', () => {
  const app = read('api', 'app.js');

  const start = app.indexOf("'media-src'");
  assert.ok(
    start > -1,
    'the CSP no longer declares media-src, so it falls back to default-src ' +
      "'self' and every alarm and kitchen ting is blocked before it is heard",
  );

  const mediaSrc = app.slice(start, app.indexOf('],', start));

  assert.match(
    mediaSrc,
    /'data:'/,
    'media-src does not allow data:. The tones are generated, not shipped as ' +
      'files, so this is the only thing that lets any of them play.',
  );
});

test('and it does not quietly become a hole', () => {
  /*
   * media-src is the one directive where a wildcard would be tempting and
   * pointless: nothing here loads audio from anywhere but this process. A
   * data: URL cannot reach the network and cannot execute - the worst a bad
   * one does is make a noise - but a remote origin in this list would be a
   * real one, so it is worth the line of test.
   */
  const app = read('api', 'app.js');
  const start = app.indexOf("'media-src'");
  const mediaSrc = app.slice(start, app.indexOf('],', start));

  const remote = [...mediaSrc.matchAll(/https?:\/\/(?!localhost|127\.0\.0\.1)[a-z0-9.-]+/gi)].map(
    (m) => m[0],
  );

  assert.deepStrictEqual(remote, [], `media-src allows ${remote.join(', ')}`);
  assert.ok(!mediaSrc.includes('*'), 'no wildcard: the sounds come from this process only');
});
