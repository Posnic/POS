'use strict';

/**
 * The production deploy must never write over an instance's .env.
 *
 * THE FUSE THIS EXISTS FOR.
 *
 * `deploy-api.yml` has a "Write storage env" step that pipes the S3 and mail
 * keys into the instance. It used to end in:
 *
 *     cat > ~/apps/tenants/app/api/.env
 *
 * which replaces the whole file. The instance keeps MONGODB_URI, JWT_SECRET,
 * SESSION_SECRET, ENCRYPTION_KEY, KIOSK_API_KEY and about a hundred more in
 * that same file, and none of them live in this repo - so there would be
 * nothing to restore from. Every shop would come back up with no database URI.
 *
 * It never fired, for one reason: the step's own guard exits early because the
 * S3 secrets are not set in this repository, and prints
 *
 *     S3 secrets not set in this repo; skipping env write - uploads will keep
 *     falling back to local disk
 *
 * on every single production deploy. That warning reads like a note about
 * image uploads, so nobody ever read the branch underneath it. The first
 * person to switch uploads on by setting AWS_S3_BUCKET would have taken the
 * estate down with a green deploy.
 *
 * That is the shape worth pinning: not "this line was wrong" but "a step that
 * is harmless only while it is disabled". The static check below forbids the
 * truncating redirect coming back; the behavioural one runs the real step
 * against a fake instance and proves unrelated keys survive it.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const WORKFLOWS = path.join(ROOT, '.github', 'workflows');

const workflowFiles = () =>
  fs
    .readdirSync(WORKFLOWS)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => ({ name: f, body: fs.readFileSync(path.join(WORKFLOWS, f), 'utf8') }));

/** The `run:` body of a named step, without needing a YAML parser as a dep. */
function stepRun(workflow, stepName) {
  const body = fs.readFileSync(path.join(WORKFLOWS, workflow), 'utf8');
  const start = body.indexOf(`- name: ${stepName}`);
  assert.notStrictEqual(start, -1, `${workflow} has no step named "${stepName}"`);

  /* From `run: |` to the next line indented no further than the step itself,
     which is where the next step or the next key begins. */
  const after = body.slice(start);
  const run = after.match(/\n\s*run: \|\n([\s\S]*?)(?=\n {0,6}[-\w]|\n*$)/);
  assert.ok(run, `${workflow} step "${stepName}" has no block run:`);
  return run[1];
}

test('no deploy truncates an instance .env', () => {
  /*
   * A single `>` into a path ending in .env, anywhere in any workflow.
   *
   * Appending is fine, and so is redirecting into a temp file that merely has
   * `.env` early in its name - the merge below writes `.env.incoming.XXXXXX`.
   * What is banned is the one form that destroys configuration this repo
   * cannot regenerate.
   */
  const offenders = [];
  for (const { name, body } of workflowFiles()) {
    for (const line of body.split('\n')) {
      if (/(^|[^>])>\s*("?[^\s"]*\.env"?)(\s|$)/.test(line) && !/>>/.test(line)) {
        offenders.push(`${name}: ${line.trim()}`);
      }
    }
  }

  assert.deepStrictEqual(
    offenders,
    [],
    'a workflow replaces a .env instead of merging into it; the keys it drops ' +
      `are not in this repo to restore:\n  ${offenders.join('\n  ')}`
  );
});

test('the storage step merges rather than replaces', () => {
  const run = stepRun('deploy-api.yml', 'Write storage env');

  /* Named parts, so a rewrite that loses one of them reads as itself. */
  assert.match(run, /cp -p "\$env" "\$env\.bak"/, 'no backup is taken before the write');
  assert.match(run, /sed -i "\/\^\$k=\/d" "\$merged"/, 'the incoming keys are not de-duplicated');
  assert.match(run, /mv "\$merged" "\$env"/, 'the merged file is not moved into place in one step');
  assert.match(run, /chmod 600 "\$env"/, 'the .env is left readable by other users');
});

test('the step still refuses to run without the secrets', () => {
  /*
   * The guard is what has kept this dormant, and it stays. A deploy with no S3
   * secrets should touch nothing at all rather than write a partial file.
   */
  const run = stepRun('deploy-api.yml', 'Write storage env');
  assert.match(run, /if \[ -z "\$AWS_ACCESS_KEY_ID" \]/, 'the secrets guard is gone');
  assert.match(run, /exit 0/, 'the guard no longer exits before writing');
});

test('running the real step keeps every key it did not set', (t) => {
  /*
   * The behavioural half: the step's own text, with `ssh` replaced by a local
   * `bash -c` so the script runs here exactly as it would on the instance.
   *
   * Skipped where bash is unavailable. CI is ubuntu, so this runs on every
   * pull request; a Windows checkout without Git Bash still gets the static
   * checks above.
   */
  const probe = spawnSync('bash', ['-c', 'exit 0']);
  if (probe.error) {
    t.skip('bash is not available to run the deploy step');
    return;
  }

  const run = stepRun('deploy-api.yml', 'Write storage env')
    /* GitHub substitutes these before bash ever sees them. */
    .replace(/\$\{\{[^}]*\}\}/g, 'placeholder')
    /* The only change to the script: run the remote half here. */
    .replace(/ssh -i [^\n]*\\\n\s*/, 'bash -c ');

  assert.match(run, /bash -c 'set -eu/, 'the ssh invocation was not the shape this test expects');

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-env-'));
  const apiDir = path.join(home, 'apps', 'tenants', 'app', 'api');
  fs.mkdirSync(apiDir, { recursive: true });

  /* A stand-in for what a real instance carries: the keys that cannot be
     rebuilt from this repository, plus one the step is about to overwrite. */
  const existing = [
    'MONGODB_URI=mongodb://real:secret@10.0.0.5/posnic',
    'JWT_SECRET=supersecret',
    'SESSION_SECRET=sess',
    'ENCRYPTION_KEY=abc123',
    'ENCRYPTION_IV=iv123',
    'KIOSK_API_KEY=kiosk',
    'PORT=3000',
    'STORAGE_TYPE=local',
  ];
  const envFile = path.join(apiDir, '.env');
  fs.writeFileSync(envFile, existing.join('\n') + '\n');

  const result = spawnSync('bash', ['-c', run], {
    env: {
      ...process.env,
      HOME: home,
      STORAGE_TYPE: 's3',
      AWS_S3_BUCKET: 'posnic-media',
      AWS_REGION: 'ap-south-1',
      AWS_ACCESS_KEY_ID: 'AKIAFAKE',
      AWS_SECRET_ACCESS_KEY: 'secretfake',
      BREVO_API_KEY: 'brevo',
      EMAIL_FROM: 'no-reply@posnic.com',
    },
    encoding: 'utf8',
  });

  assert.strictEqual(
    result.status,
    0,
    `the step failed: ${result.stderr || result.stdout}`
  );

  const after = fs.readFileSync(envFile, 'utf8');
  const keys = (text) =>
    text
      .split('\n')
      .map((l) => l.split('=')[0])
      .filter(Boolean);

  /* Every key that was there before is still there, once. */
  const lost = existing
    .map((l) => l.split('=')[0])
    .filter((k) => keys(after).filter((x) => x === k).length !== 1);
  assert.deepStrictEqual(lost, [], `keys lost or duplicated by the deploy: ${lost.join(', ')}`);

  /* The values that had nothing to do with storage are untouched. */
  assert.match(after, /^MONGODB_URI=mongodb:\/\/real:secret@10\.0\.0\.5\/posnic$/m);
  assert.match(after, /^JWT_SECRET=supersecret$/m);

  /* The one key the step does own was updated, not appended beside the old. */
  assert.match(after, /^STORAGE_TYPE=s3$/m);
  assert.doesNotMatch(after, /^STORAGE_TYPE=local$/m);

  /* And the new keys arrived. */
  assert.match(after, /^AWS_S3_BUCKET=posnic-media$/m);
  assert.match(after, /^EMAIL_FROM=no-reply@posnic\.com$/m);

  /* Nothing is left lying around next to the file it was built from. */
  const strays = fs.readdirSync(apiDir).filter((f) => f.includes('incoming') || f.includes('merged'));
  assert.deepStrictEqual(strays, [], `temp files left in the api directory: ${strays.join(', ')}`);

  fs.rmSync(home, { recursive: true, force: true });
});
