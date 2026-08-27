const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PinLock, isTooObvious, MAX_FAILURES } = require('../src/pin-lock');

/*
 * The property that matters is not "a wrong PIN is rejected" - it is that a
 * wrong PIN cannot produce the session at all. There is no stored hash to
 * compare, so there is no comparison to bypass: the wrong PIN derives the
 * wrong key and the ciphertext stays ciphertext.
 */
function tempLock(installSecret = 'install-secret-for-this-machine') {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pinlock-')), 'pin-lock.json');
  return { lock: new PinLock({ file, installSecret }), file };
}

const SESSION = { token: 'jwt-token-value', userId: 'abc123', branch: 'Main' };

test('the right PIN returns the session', () => {
  const { lock } = tempLock();
  lock.enroll({ username: 'Sridhar', displayName: 'Sridhar B', pin: '4829', session: SESSION });

  const result = lock.unlock({ username: 'sridhar', pin: '4829' });
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(result.session, SESSION);
});

test('a wrong PIN yields no session and counts down', () => {
  const { lock } = tempLock();
  lock.enroll({ username: 'sridhar', pin: '4829', session: SESSION });

  const result = lock.unlock({ username: 'sridhar', pin: '4830' });
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.reason, 'wrong-pin');
  assert.strictEqual(result.attemptsLeft, MAX_FAILURES - 1);
  assert.strictEqual(result.session, undefined, 'a failed unlock must carry no session');
});

test('the token is never on disk in the clear', () => {
  // If it were, the PIN would be decoration.
  const { lock, file } = tempLock();
  lock.enroll({ username: 'sridhar', pin: '4829', session: SESSION });

  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(!raw.includes('jwt-token-value'), 'the token is readable on disk');
  // Stored-in-the-clear means the PIN appears as a JSON VALUE. A bare
  // substring check flaked here: the file is hex/base64 ciphertext and
  // salts, and the digit run 4829 eventually showed up inside random
  // encoded bytes (~1% of runs - it passed on the same commit's other run).
  assert.ok(!raw.includes('"4829"'), 'the PIN itself is on disk as a string');
  assert.ok(!/:\s*4829\s*[,}]/.test(raw), 'the PIN itself is on disk as a number');
});

test('five wrong tries wipe it, and the password becomes the only way in', () => {
  const { lock } = tempLock();
  lock.enroll({ username: 'sridhar', pin: '4829', session: SESSION });

  for (let i = 1; i < MAX_FAILURES; i++) {
    const result = lock.unlock({ username: 'sridhar', pin: '0000' });
    assert.strictEqual(result.reason, 'wrong-pin');
    assert.strictEqual(result.attemptsLeft, MAX_FAILURES - i);
  }

  const last = lock.unlock({ username: 'sridhar', pin: '0000' });
  assert.strictEqual(last.reason, 'locked-out');
  assert.strictEqual(lock.isEnrolled('sridhar'), false, 'the blob should be gone');

  // And the correct PIN no longer helps, because there is nothing left to
  // decrypt.
  assert.strictEqual(lock.unlock({ username: 'sridhar', pin: '4829' }).reason, 'not-enrolled');
});

test('a correct PIN clears the failure count', () => {
  // Otherwise two mistypes on Monday and three on Friday would wipe a till
  // that nobody was attacking.
  const { lock } = tempLock();
  lock.enroll({ username: 'sridhar', pin: '4829', session: SESSION });

  lock.unlock({ username: 'sridhar', pin: '1111' });
  lock.unlock({ username: 'sridhar', pin: '2222' });
  assert.strictEqual(lock.unlock({ username: 'sridhar', pin: '4829' }).success, true);
  assert.strictEqual(
    lock.unlock({ username: 'sridhar', pin: '3333' }).attemptsLeft, MAX_FAILURES - 1);
});

test('the file is useless on another machine', () => {
  // The install secret is mixed into the salt, so a copied blob decrypts to
  // nothing even with the right PIN.
  const { lock, file } = tempLock('machine-one');
  lock.enroll({ username: 'sridhar', pin: '4829', session: SESSION });

  const elsewhere = new PinLock({ file, installSecret: 'machine-two' });
  const result = elsewhere.unlock({ username: 'sridhar', pin: '4829' });
  assert.strictEqual(result.success, false);
});

test('a deliberate logout forgets the user', () => {
  const { lock } = tempLock();
  lock.enroll({ username: 'sridhar', pin: '4829', session: SESSION });
  lock.forget('Sridhar');

  assert.strictEqual(lock.isEnrolled('sridhar'), false);
  assert.strictEqual(lock.unlock({ username: 'sridhar', pin: '4829' }).reason, 'not-enrolled');
});

test('several people share one till', () => {
  const { lock } = tempLock();
  lock.enroll({ username: 'sridhar', displayName: 'Sridhar', pin: '4829', session: SESSION });
  lock.enroll({ username: 'meena', displayName: 'Meena', pin: '7361',
    session: { token: 'meena-token' } });

  assert.deepStrictEqual(lock.list().map((u) => u.displayName).sort(), ['Meena', 'Sridhar']);
  assert.strictEqual(lock.unlock({ username: 'meena', pin: '7361' }).session.token, 'meena-token');
  // One person's PIN must not open another person's session.
  assert.strictEqual(lock.unlock({ username: 'meena', pin: '4829' }).success, false);
});

test('guessable PINs are refused at setup', () => {
  const { lock } = tempLock();
  for (const pin of ['0000', '1111', '1234', '4321', '2580', '123456']) {
    assert.ok(isTooObvious(pin), pin + ' should be rejected');
    assert.throws(() => lock.enroll({ username: 'x', pin, session: SESSION }),
      /too easy/, 'enrol allowed ' + pin);
  }
  assert.ok(!isTooObvious('4829'));
  assert.ok(!isTooObvious('730194'));
});

test('a PIN must be four to six digits', () => {
  const { lock } = tempLock();
  for (const pin of ['123', '12345678', 'abcd', '', '12a4']) {
    assert.throws(() => lock.enroll({ username: 'x', pin, session: SESSION }),
      /four to six digits/, 'enrol allowed ' + JSON.stringify(pin));
  }
});

test('an unlock is quick enough to feel instant, and slow enough to matter', () => {
  // Both directions are the point: a cashier must not wait, and ten thousand
  // guesses must not be free.
  const { lock } = tempLock();
  lock.enroll({ username: 'sridhar', pin: '4829', session: SESSION });

  const started = process.hrtime.bigint();
  lock.unlock({ username: 'sridhar', pin: '4829' });
  const ms = Number(process.hrtime.bigint() - started) / 1e6;

  assert.ok(ms < 1500, 'an unlock took ' + Math.round(ms) + 'ms, which a cashier would feel');
  assert.ok(ms > 15, 'an unlock took only ' + Math.round(ms) + 'ms - guessing would be free');
});
