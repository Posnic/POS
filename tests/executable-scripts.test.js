'use strict';

/*
 * Every shell script cron runs must be committed executable.
 *
 * WHAT HAPPENED, so nobody removes this as pedantry.
 *
 * On 1 September 2026 a deploy overwrote ops/backup/backup.sh with the copy
 * from git, which was mode 100644. cron could no longer run it, and wrote
 * "Permission denied" into a log nobody reads. Backups for the machine holding
 * every real customer shop stopped for THIRTY-NINE HOURS - six missed runs -
 * and the only reason anyone found out is that the watchdog built the week
 * before sent an email.
 *
 * The cause is that these files are authored on Windows, where git's
 * core.fileMode is false: the executable bit is not tracked, so a script
 * created there is committed 644 no matter how it looks locally. chmod +x on
 * the server fixes it until the next deploy overwrites it again.
 *
 * A test rather than a convention, because the failure is silent on the
 * machine that matters and invisible in review.
 */

const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const path = require('path');

const REPO = path.join(__dirname, '..');

function tracked(pattern) {
  const out = execFileSync('git', ['ls-files', '-s', pattern], {
    cwd: REPO, encoding: 'utf8',
  });
  return out.split('\n').filter(Boolean).map((line) => {
    const [mode, , , file] = line.split(/\s+/);
    return { mode, file };
  });
}

test('every committed shell script is executable', () => {
  const scripts = tracked('*.sh');
  assert.ok(scripts.length > 0, 'no shell scripts found - has the layout changed?');

  const notExecutable = scripts.filter((s) => s.mode !== '100755').map((s) => s.file);
  assert.deepEqual(notExecutable, [],
    'these are committed 100644 and will fail the moment cron or a deploy runs them:\n  '
    + notExecutable.join('\n  ')
    + '\n\nFix with:  git update-index --chmod=+x <file>');
});

test('scripts with a shebang are executable too', () => {
  /*
   * Not every runnable script ends in .sh. A Node script cron invokes directly
   * needs the same bit, and the extension will not tell you.
   */
  const fs = require('fs');
  const all = execFileSync('git', ['ls-files', '-s'], { cwd: REPO, encoding: 'utf8' })
    .split('\n').filter(Boolean)
    .map((line) => { const [mode, , , file] = line.split(/\s+/); return { mode, file }; });

  const offenders = [];
  for (const { mode, file } of all) {
    if (mode !== '100644') continue;
    if (/node_modules|\.min\./.test(file)) continue;
    let head = '';
    try {
      head = fs.readFileSync(path.join(REPO, file), 'utf8').slice(0, 40);
    } catch (e) { continue; }
    /* A shebang is a statement that this file is meant to be executed. */
    if (head.startsWith('#!')) offenders.push(file);
  }

  assert.deepEqual(offenders, [],
    'these declare a shebang but are committed non-executable:\n  ' + offenders.join('\n  '));
});
