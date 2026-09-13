'use strict';

/*
 * The workflow that keeps develop level with main stops failing on a setting.
 *
 * Every release leaves main one commit ahead of develop: the merge the release
 * itself creates. sync-main-to-develop exists to carry that back, and it has
 * failed on every release it has ever seen - #644, #651, #665 - on the same
 * line every time:
 *
 *   pull request create failed: GraphQL: GitHub Actions is not permitted to
 *   create or approve pull requests (createPullRequest)
 *
 * That is a repository setting, not a bug in the script, and no amount of
 * retrying will change it. release-promote.yml is blocked by the same one.
 *
 * THE COST WAS NOT THE RED MARK. The branch it pushes is correct and ready
 * every time; only the last step fails. But because the run went red and
 * nobody opened the pull request, develop stayed behind main after every
 * release - so the NEXT release opened "This branch is out-of-date with the
 * base branch" and somebody had to work out why from a workflow log nobody
 * reads. That happened again on #682, which is what prompted this.
 *
 * So the workflow stops asking for a permission it will never be given. It
 * still tries, in case the setting is ever turned on, but a refusal no longer
 * fails the run - and the link the owner actually needs goes in the run
 * summary, where they are already looking while a release is in progress.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const WF = fs.readFileSync(
  path.join(ROOT, '.github', 'workflows', 'sync-main-to-develop.yml'), 'utf8'
);

test('a refusal to open the pull request no longer fails the run', () => {
  /* Without this the run goes red on something no retry can fix, and a red
     run that is always red is a run nobody reads. */
  assert.match(WF, /gh pr create[\s\S]{0,200}\|\|/,
    'gh pr create can still take the whole workflow down');
});

test('it still tries, so the day the setting changes it just starts working', () => {
  assert.match(WF, /gh pr create --base develop --head "\$BRANCH"/,
    'the workflow gave up on opening the pull request entirely');
});

test('the branch is pushed before any of that, because that part always worked', () => {
  const step = WF.slice(WF.indexOf('Open or update the sync pull request'));
  const push = step.indexOf('git push -f origin "$BRANCH"');
  const create = step.indexOf('gh pr create');
  assert.ok(push > -1, 'the branch is no longer pushed');
  assert.ok(push < create, 'the branch is pushed after the step that can fail');
});

test('the owner is handed a link, in the place they are already looking', () => {
  assert.match(WF, /GITHUB_STEP_SUMMARY/,
    'nothing reaches the run summary, so a failure is only in the log');
  assert.match(WF, /compare\/develop\.\.\.\$BRANCH\?expand=1/,
    'the summary has no link that opens the pull request');
  assert.match(WF, /develop is \$\{\{ steps\.check\.outputs\.behind \}\} commit\(s\) behind main/,
    'the summary does not say how far behind develop is');
});

test('the summary is written whether the pull request opened or not', () => {
  /*
   * The whole point. If this sat inside the success branch it would print
   * exactly when it is not needed and stay silent when it is.
   */
  const step = WF.slice(WF.indexOf('OPEN=$(gh pr list'));
  const fi = step.indexOf('\n          fi');
  const summary = step.indexOf('GITHUB_STEP_SUMMARY');
  assert.ok(fi > -1 && summary > fi,
    'the summary is written inside the if, so it is skipped on the path that needs it');
});

test('it still does nothing at all when develop is level with main', () => {
  /* The normal case after a release that was merged rather than squashed. */
  assert.match(WF, /if: steps\.check\.outputs\.behind != '0'/,
    'the workflow would push a branch and write a summary on every push to main');
});

test('a merge is still a merge, never a reset', () => {
  /* develop carries work main has never seen. Resetting it to main would
     delete that silently, which is why this is worth a test of its own. */
  assert.match(WF, /git merge --no-edit origin\/main/);
  assert.ok(!/git reset --hard origin\/main/.test(WF),
    'the sync would throw away work that only exists on develop');
});
