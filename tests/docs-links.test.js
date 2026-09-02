'use strict';

/*
 * Every relative link in every markdown file must point at something.
 *
 * WHAT HAPPENED, so this is not removed as tidiness.
 *
 * Somebody who wanted to contribute - atomnoid, discussion #25 - read the docs,
 * clicked through to the developer guide, and got a 404. They took the trouble
 * to open a discussion about it rather than simply leaving, which is more than
 * anyone is owed.
 *
 * The cause was that docs/GOVERNANCE.md linked to `docs/DEVELOPMENT.md` from
 * inside docs/, so it resolved to docs/docs/DEVELOPMENT.md. The file was there
 * the whole time. A scan then found the same mistake in 30 places across six
 * files: every target existed, and not one of the links reached it.
 *
 * It survived because a relative link is correct in the editor, correct in most
 * previewers, and only wrong on GitHub, where the reader is - and because
 * nothing checked. A broken link in the first documents a stranger reads costs
 * more than the page it fails to open: it is the cheapest possible evidence
 * that nobody is looking after the place.
 *
 * Links are resolved from the directory of the file they appear in, which is
 * the whole point - that is what GitHub does, and what the old checks did not.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

function trackedFiles() {
  return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean);
}

test('every relative link in the docs points at a file that exists', () => {
  const tracked = trackedFiles();
  const markdown = tracked.filter((f) => f.endsWith('.md'));
  assert.ok(markdown.length > 5, 'no markdown found - has the layout changed?');

  const broken = [];
  for (const file of markdown) {
    const dir = path.dirname(path.join(ROOT, file));
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');

    /* Skip absolute URLs, mailto:, same-page anchors and autolinks. */
    for (const m of text.matchAll(/\]\((?!https?:|mailto:|#|<)([^)\s]+)\)/g)) {
      const target = m[1].split('#')[0];
      if (!target) continue;
      if (fs.existsSync(path.resolve(dir, target))) continue;
      const line = text.slice(0, m.index).split('\n').length;
      broken.push(`${file}:${line} -> ${target}`);
    }
  }

  assert.deepEqual(broken, [],
    'these links 404 for anybody reading on GitHub:\n  ' + broken.join('\n  ')
    + '\n\nLinks resolve from the directory of the file they are in. A link to '
    + '"docs/X.md" written inside docs/ means docs/docs/X.md.');
});

test('a doc in docs/ does not link to itself through docs/', () => {
  /*
   * The specific shape of the bug above, called out by name. The generic check
   * would catch it too, but only once the file is missing; this one explains
   * what is wrong the moment somebody writes it, which is the difference
   * between a fix and a puzzle.
   */
  const offenders = [];
  for (const file of trackedFiles().filter((f) => f.startsWith('docs/') && f.endsWith('.md'))) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const m of text.matchAll(/\]\(docs\/([^)\s]+)\)/g)) {
      const line = text.slice(0, m.index).split('\n').length;
      offenders.push(`${file}:${line} -> docs/${m[1]}  (drop the "docs/")`);
    }
  }
  assert.deepEqual(offenders, [],
    'these are already inside docs/, so "docs/" is one level too many:\n  '
    + offenders.join('\n  '));
});
