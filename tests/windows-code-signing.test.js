const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

/*
 * Authenticode signing for the Windows build.
 *
 * The shape that needs guarding is unusual: signing is OPT-IN, because the
 * certificate lives on a card that GitHub-hosted runners have no reader for.
 * A build without the card must still succeed - otherwise turning signing on
 * turns CI off.
 *
 * That choice has a cost, and it is what most of these tests are about: a
 * forgotten environment variable produces a perfectly normal-looking release
 * that says "Unknown publisher" on every customer's machine, and nothing else
 * in the pipeline would mention it.
 */

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const hook = fs.readFileSync(path.join(ROOT, 'scripts', 'sign-windows.js'), 'utf8');
const win = pkg.build.win;

test('the build is wired to the signing hook', () => {
  const opts = win.signtoolOptions || {};
  assert.strictEqual(
    opts.sign,
    'scripts/sign-windows.js',
    'nothing signs the Windows build',
  );
  assert.ok(
    fs.existsSync(path.join(ROOT, opts.sign)),
    'signtoolOptions.sign points at a file that does not exist - the build fails at pack time',
  );
});

test('signing is opt-in, so a machine without the card still builds', () => {
  /* This is the whole reason for a custom hook. A certificate named in
     package.json makes the build FAIL on a runner with no card reader; reading
     it from the environment makes that build produce the unsigned installer it
     produces today. */
  assert.ok(
    !('certificateSubjectName' in (win.signtoolOptions || {})),
    'a certificate named in config makes every cardless build fail, CI included',
  );
  assert.ok(
    !('certificateSha1' in (win.signtoolOptions || {})),
    'a certificate named in config makes every cardless build fail, CI included',
  );
  assert.ok(
    !pkg.build.forceCodeSigning,
    'forceCodeSigning turns the graceful skip back into a hard failure',
  );
  assert.match(hook, /POSNIC_SIGN_SHA1/, 'the hook reads no thumbprint from the environment');
  assert.match(hook, /POSNIC_SIGN_SUBJECT/, 'no subject-name fallback');
});

test('an unsigned build says so, loudly', () => {
  /* The failure mode this guards: a release that looks fine locally and shows
     "Unknown publisher" to every customer. */
  const at = hook.indexOf('if (!how)');
  assert.notStrictEqual(at, -1, 'the not-configured branch is gone');
  const body = hook.slice(at, hook.indexOf('return true;', at));
  assert.match(body, /UNSIGNED/, 'skipping signing is silent');
  assert.match(body, /Unknown publisher/, 'it does not say what the user will actually see');
});

test('every signature is timestamped', () => {
  /* Without a timestamp the signature dies with the certificate - and this one
     expires 2027-08-21, so every installer already sitting in a shop would
     start warning on the same day. */
  assert.match(hook, /'\/tr'/, 'no RFC-3161 timestamp flag');
  assert.match(hook, /'\/td', 'sha256'/, 'the timestamp is not SHA-256');
  assert.match(hook, /time\.certum\.pl/, 'no timestamping authority');
  assert.match(hook, /'\/fd', 'sha256'/, 'the file digest is not SHA-256');
});

test('a flaky timestamp server does not throw away the build', () => {
  /* Public TSAs hiccup. An unretried failure costs a ten-minute build. */
  assert.match(hook, /TIMESTAMP_ATTEMPTS\s*=\s*[2-9]/, 'timestamping is not retried');
  /* But only the timestamp is worth retrying - a wrong thumbprint fails the
     same way every time and just asks for the PIN again. */
  assert.match(
    hook,
    /attempt === TIMESTAMP_ATTEMPTS/,
    'the retry loop never gives up',
  );
});

test('a second signature appends instead of replacing the first', () => {
  /* electron-builder asks twice when dual-signing. Without /as the second call
     REPLACES the first, and the file ends up with one signature where two were
     intended - which looks correct until something checks for both. */
  assert.match(hook, /isNest/, 'the nested-signature case is not handled');
  assert.match(hook, /'\/as'/, "a second signature would overwrite the first");
});

test('signtool is found by version, not hardcoded', () => {
  /* A pinned Windows Kit version is a build that breaks on the next SDK update,
     on a machine nobody is looking at. */
  assert.ok(
    !/10\.0\.\d{5}\.\d/.test(hook),
    'a specific Windows Kit version is hardcoded - the next SDK update breaks the build',
  );
  assert.match(hook, /readdirSync/, 'the SDK directory is not searched');
});

test('the stated publisher matches the certificate', () => {
  /* Windows shows the CERTIFICATE's subject as the verified publisher, whatever
     this says. Where it matters is electron-updater: with
     verifyUpdateCodeSignature on, a mismatch rejects every update. Keeping them
     equal means that flag can be turned on without breaking auto-update. */
  assert.strictEqual(
    (win.signtoolOptions || {}).publisherName,
    'BillMax',
    'publisherName no longer matches the signing certificate CN (BillMax)',
  );
});

test('the helper scripts exist and are wired', () => {
  for (const [name, file] of [
    ['sign:cert', 'scripts/find-signing-cert.js'],
    ['sign:verify', 'scripts/verify-signature.js'],
  ]) {
    assert.strictEqual(pkg.scripts[name], `node ${file}`, `${name} is not wired`);
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} is missing`);
  }
});

test('the verifier checks the timestamp, not just the signature', () => {
  /* An unsigned file is obvious the first time somebody runs it. A signed file
     with no timestamp looks perfect until the certificate expires. */
  const v = fs.readFileSync(path.join(ROOT, 'scripts', 'verify-signature.js'), 'utf8');
  assert.match(v, /timestamp/i, 'the verifier ignores timestamping');
  assert.match(v, /'\/pa'/, "verification does not use the Authenticode policy Windows itself applies");
  assert.match(v, /process\.exit\(1\)/, 'the verifier cannot fail a release');
});
test('a card error is not retried, because retrying can lock the card', () => {
  /* Found by running the hook against a deliberately wrong thumbprint: it tried
     three times. On a real card that is three PIN prompts for an answer that
     cannot change, and repeated attempts are how a card gets LOCKED. Only a
     timestamp failure is worth another go. */
  assert.match(hook, /function isTimestampFailure/, 'nothing classifies the failure');
  const at = hook.indexOf('function isTimestampFailure');
  const fn = hook.slice(at, hook.indexOf('}', hook.indexOf('return', at)));
  assert.match(fn, /No certificates were found/, 'a missing certificate counts as retryable');

  /* Anchored on the throw, not on `const output =` - that also appears inside
     signOnce, ABOVE the loop, so slicing to it produced an empty string and
     the assertion passed against nothing. */
  const from = hook.indexOf('for (let attempt');
  const loop = hook.slice(from, hook.indexOf('throw new Error', from));
  assert.ok(loop.length > 100, 'the retry loop could not be located');
  assert.match(
    loop,
    /if \(!isTimestampFailure\([\s\S]{0,40}\)\)/,
    'the loop retries every failure, not just timestamping',
  );
  assert.match(loop, /break;/, 'a non-timestamp failure never stops the loop');
});

test('the failure says which of the two things went wrong', () => {
  /* "Command failed: <300 characters of signtool command line>" tells somebody
     nothing about whether to plug the card in or just build again. */
  /* Scoped to the HINT block. A bare search for `npm run sign:cert` also finds
     it in the not-configured warning far above, so deleting it from the error
     left this passing on the strength of an unrelated message. */
  const hintAt = hook.indexOf('let hint =');
  assert.notStrictEqual(hintAt, -1, 'the hint block is gone');
  /* Search for the throw AFTER the hint: an earlier one handles the missing
     SDK, and slicing to that produced an empty string - twice now, in two
     different tests. A backwards slice always "passes". */
  const hints = hook.slice(hintAt, hook.indexOf('throw new Error', hintAt));
  assert.ok(hints.length > 80, 'the hint block could not be located');
  assert.match(hints, /npm run sign:cert/, 'a certificate failure does not point anywhere useful');
  assert.match(hints, /do NOT ship an untimestamped build/, 'a timestamp failure invites the wrong workaround');
});
test('an empty store is diagnosed, not just reported', () => {
  /* "Insert the card and try again" is useless to somebody whose card IS
     inserted and whose CardManager is showing them the certificate - which is
     exactly what happened. The cause was two layers down: Windows publishes a
     smart card's certificates only once a MINIDRIVER claims the card model, and
     none claimed this one, so it showed as "Unknown Smart Card" while the card
     worked perfectly inside CardManager. */
  const finder = fs.readFileSync(path.join(ROOT, 'scripts', 'find-signing-cert.js'), 'utf8');
  assert.match(finder, /function diagnose\(/, 'the empty case gives no diagnosis');
  assert.match(finder, /Unknown Smart Card/, 'the no-driver case is not distinguished');
  assert.match(finder, /Get-PnpDevice -Class SmartCard/, 'it never checks whether a card is present');
  assert.match(finder, /Calais/, 'it never checks which minidrivers are registered');

  /* The registry path must not carry single backslashes: in a JS string
     '\SOFTWARE' collapses to 'SOFTWARE' and the query silently returns
     nothing, which read as "no Certum drivers installed" when four were. */
  const line = finder.split(String.fromCharCode(10)).find((l) => l.includes('Calais'));
  assert.ok(line, 'the minidriver query is gone');
  assert.ok(
    !line.includes(String.fromCharCode(92)),
    'the registry path uses unescaped backslashes - the query returns nothing and lies',
  );
});
test('there is a way to sign before the card driver catches up', () => {
  /* The minidriver for this card model does not exist yet, so Windows publishes
     nothing from the card. But the Certum CSP reaches the same key today -
     certutil enumerates its containers - so the certificate can be imported by
     hand and repaired onto that key. Without this, signing waits on a vendor
     driver release. */
  const link = fs.readFileSync(path.join(ROOT, 'scripts', 'link-signing-cert.js'), 'utf8');
  assert.strictEqual(pkg.scripts['sign:link'], 'node scripts/link-signing-cert.js');
  assert.match(link, /-addstore/, 'the certificate is never imported');
  assert.match(link, /-repairstore/, 'nothing links the certificate to the key on the card');

  /* Importing without repairing leaves a certificate with no usable private
     key - signtool refuses it, and the build looks broken for a reason that is
     nowhere on screen. So the link step must be verified, not assumed. */
  assert.match(link, /HasPrivateKey/, 'the private key link is never verified');
  const tail = link.slice(link.indexOf('HasPrivateKey'));
  assert.match(tail, /process\.exit\(1\)/, 'a certificate with no key is reported as success');
  assert.match(tail, /Do not ship a build believing it signed/, 'the consequence is not stated');
});

test('re-running the link is safe', () => {
  /* The interesting step is the repair, and somebody will run this twice while
     working out why the card is not answering. An "already exists" on the
     import must not stop it before it gets there. */
  const link = fs.readFileSync(path.join(ROOT, 'scripts', 'link-signing-cert.js'), 'utf8');
  assert.match(link, /already exists/i, 'a second run fails on the import and never repairs');
});

test('the empty-store message offers the workaround', () => {
  /* Telling somebody to wait for a driver, when a working path exists today, is
     an answer that is technically true and practically useless. */
  const finder = fs.readFileSync(path.join(ROOT, 'scripts', 'find-signing-cert.js'), 'utf8');
  assert.match(finder, /sign:link/, 'the diagnosis names no way forward');
});
