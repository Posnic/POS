/*
 * This repository is public, and carries no customer's brand.
 *
 * White-label builds are produced in the private build repository: it checks
 * this one out at a tag, applies a brand on top and publishes the installer.
 * The pipeline that does it - brand-build.js, the brands/ packs, the
 * build-desktop workflow - lives there, so a public repository does not also
 * document how customer installers are made.
 *
 * Two things follow, and this file holds both of them.
 *
 * No customer artwork or name may be committed here. A branded seed was
 * committed once already, by a `git add -A` after a client build, and then a
 * stock installer shipped showing that client's logo on its sign-in screen. It
 * was found by the person who installed it.
 *
 * And the runtime hooks stay. A brand reaches a shop either as a seed the build
 * repo drops into resources/brand-seed, or from the gateway through
 * refreshBrand(). Deleting either would quietly break white-labelling for
 * shops that already pay for it, and it would break at their counter rather
 * than here.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

function tracked() {
  return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean);
}

test('the brand build pipeline is not in this repository', () => {
  const gone = [
    'scripts/brand-build.js',
    'scripts/sync-brand-assets.js',
    'scripts/make-brand-icon.js',
    '.github/workflows/build-desktop.yml',
  ];

  for (const f of gone) {
    assert.ok(!fs.existsSync(path.join(ROOT, f)),
      `${f} is back. It describes how customer installers are produced and ` +
      `belongs in the private build repository.`);
  }
});

test('no brand pack is tracked', () => {
  const packs = tracked().filter((f) => f.startsWith('brands/'));
  assert.deepStrictEqual(packs, [],
    `brands/ is tracked again: ${packs.join(', ')}`);
});

test('no customer brand sits in the seed directory', () => {
  /* Reads the disk, not the configuration. The seed is what a build copies, so
     this is the check that would have caught the installer that shipped. */
  const seed = path.join(ROOT, 'builds', 'brand-seed');
  if (!fs.existsSync(seed)) return;

  const leftovers = fs.readdirSync(seed).filter((f) => f !== '.gitkeep');
  assert.deepStrictEqual(leftovers, [],
    `builds/brand-seed holds ${leftovers.join(', ')}. A build from here would ` +
    `ship that brand. Empty it before building.`);
});

test('no customer name appears in tracked source', () => {
  /*
   * The names are stored as hashes, because this file is published too.
   *
   * The first version of this test listed them in plain text - so a check
   * written to keep customers out of a public repository became the one file
   * in it that named them. It also matched itself and had to be told to skip
   * its own path, which was the clue.
   *
   * Truncated SHA-256 of the lowercased name. Enough to recognise a name that
   * is already known; useless for learning one that is not.
   */
  const KNOWN = new Set([
    'e61153cce60e4098',
    'eadca98bf0b54d62',
    'cf30703f3308a650',
    '7bd6f240b1404974',
  ]);

  const digest = (s) => crypto.createHash('sha256')
    .update(s.toLowerCase()).digest('hex').slice(0, 16);

  const searchable = tracked().filter((f) =>
    /\.(js|json|md|html|css|scss|yml|yaml|bat)$/.test(f)
    && !f.startsWith('frontend/static/style/icons/')
    && !f.startsWith('frontend/static/json/')
    && !/\.min\.(js|css)$/.test(f));

  const hits = [];
  for (const f of searchable) {
    let text;
    try { text = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { continue; }

    /*
     * Runs of capitalised words, which is the shape a company name takes, and
     * every 1-to-4-word phrase within each run. Hashing every n-gram in every
     * file would be correct and far too slow; proper nouns are where a customer
     * name can hide, and there are few of them.
     */
    for (const run of text.match(/\b[A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]*){0,3}\b/g) || []) {
      const words = run.split(/\s+/);
      for (let start = 0; start < words.length; start += 1) {
        for (let len = 1; len <= 4 && start + len <= words.length; len += 1) {
          const phrase = words.slice(start, start + len).join(' ');
          if (KNOWN.has(digest(phrase))) hits.push(`${f}  (${phrase})`);
        }
      }
    }
  }

  assert.deepStrictEqual([...new Set(hits)], [],
    'a customer name appears in tracked source:\n  ' + hits.join('\n  '));
});

test('the runtime brand hooks are still there', () => {
  /* Removing these would break white-labelling for shops that already have it,
     and it would break on their counter rather than here. */
  const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');

  assert.match(main, /function seedBrandFromBuild/,
    'the build-time seed is no longer read, so an installer the build repo '
    + 'brands would come out stock');
  assert.match(main, /async function refreshBrand/,
    'the gateway brand fetch is gone, so cloud white-labelling stops working');
});

test('a branded seed still reaches the installer when one exists', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const entry = (pkg.build.extraResources || []).find((r) => r.from === 'builds/brand-seed');

  assert.ok(entry,
    'builds/brand-seed is no longer packaged, so the build repo has nowhere to '
    + 'put a brand');
  assert.strictEqual(entry.to, 'brand-seed');
});
