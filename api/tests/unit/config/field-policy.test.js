/*
 * Nothing sensitive leaves this machine without somebody having decided.
 *
 * There was no list of what may be synced, so every field a model stored was
 * implicitly eligible to go to Posnic Cloud in plain text - including a shop's
 * Razorpay secret, its SMTP password and its SMS provider password. Those are
 * not business records; they let the holder take payments and send messages as
 * the merchant.
 *
 * The important test here is the last one. It reads the branch schema and fails
 * if a field that looks like a credential has no declared policy, so the next
 * secret somebody adds cannot quietly default to "sync it".
 */

const path = require('path');
const fs = require('fs');
const policy = require('../../../src/config/field-policy');
const secretField = require('../../../src/utils/secret-field');

describe('field policy', () => {
  test('the four credential fields are cloud-only and encrypted', () => {
    /* Cloud-only because they are used solely for operations that already need
       the internet - an online payment, an email, an SMS - so holding them
       server-side costs no offline capability, and a secret key does not belong
       in a client application. */
    for (const field of [
      'payment_gateway',
      'phonepe_payment_gateway',
      'smtp_password',
      'way2sms_password',
    ]) {
      expect(policy.policyFor('branches', field)).toBe(policy.POLICY.CLOUD_ONLY);
      expect(policy.shouldEncrypt('branches', field)).toBe(true);
    }
  });

  test('cloud-only fields do not travel from the till', () => {
    const d = policy.syncDisposition('branches', 'payment_gateway');
    expect(d.belongsInCloudOnly).toBe(true);
    expect(d.mayLeaveMachine).toBe(false);
  });

  test('a WhatsApp session never leaves the machine at all', () => {
    /* It is bound to this device. Syncing it would be meaningless and would put
       a live messaging session somewhere it was not meant to be. */
    const d = policy.syncDisposition('settings', 'whatsapp_session');
    expect(d.policy).toBe(policy.POLICY.LOCAL_ONLY);
    expect(d.mayLeaveMachine).toBe(false);
  });

  test('an API key syncs only as ciphertext', () => {
    const d = policy.syncDisposition('users', 'api_key');
    expect(d.mayLeaveMachine).toBe(true);
    expect(d.mustBeCiphertext).toBe(true);
  });

  test('a bcrypt hash is not treated as a recoverable secret', () => {
    /* Encrypting a hash adds nothing - it is already one-way - and pretending
       otherwise would mean decrypting on every login for no benefit. */
    expect(policy.shouldEncrypt('users', 'password')).toBe(false);
  });

  test('ordinary business data defaults to plain sync', () => {
    const d = policy.syncDisposition('items', 'name');
    expect(d.policy).toBe(policy.POLICY.SYNC_PLAIN);
    expect(d.mayLeaveMachine).toBe(true);
  });

  test('every declared field says why', () => {
    /* A policy without a reason is a policy nobody can review. */
    for (const field of policy.declaredFields()) {
      expect(typeof field.why).toBe('string');
      expect(field.why.length).toBeGreaterThan(20);
      expect(Object.values(policy.POLICY)).toContain(field.policy);
    }
  });

  test('a new credential field in the branch schema must be declared', () => {
    /*
     * The guard that matters. This reads branch.model.js and looks for fields
     * whose names say they hold a credential. Anything found without a policy
     * is a secret about to be synced in plain text because nobody was asked.
     *
     * If this fails: add the field to field-policy.js with a reason. If it is
     * genuinely not a secret - a "password_required" flag, say - the name is
     * misleading and worth changing.
     */
    const schema = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'src', 'models', 'branch.model.js'),
      'utf8'
    );

    const SECRET_LOOKING = /^(\w*(?:password|secret|_key|apikey|api_key|token|credential)\w*)$/i;
    const NOT_ACTUALLY_SECRET = new Set([
      'password_required',
      'secret_question',
      'api_key_enabled',
    ]);

    const found = new Set();
    for (const match of schema.matchAll(/^\s{4}(\w+):\s*\{\s*type:/gm)) {
      const name = match[1];
      if (SECRET_LOOKING.test(name) && !NOT_ACTUALLY_SECRET.has(name)) found.add(name);
    }
    /* Objects and arrays holding credentials do not match the "type:" shape. */
    for (const name of ['payment_gateway', 'phonepe_payment_gateway']) {
      if (schema.includes(`${name}:`)) found.add(name);
    }

    const undeclared = [...found].filter((name) => !policy.FIELDS.branches[name]);

    expect(undeclared).toEqual([]);
  });
});

describe('secret fields at rest', () => {
  const KEY = 'a'.repeat(32);
  let previous;

  beforeEach(() => {
    previous = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = KEY;
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = previous;
  });

  test('a secret round trips and is unreadable in between', () => {
    const secret = 'rzp_live_9aBcDeFgHiJkLm';
    const sealed = secretField.encryptField(secret);

    expect(sealed).not.toContain(secret);
    expect(sealed).not.toContain('rzp_live');
    expect(secretField.decryptField(sealed)).toBe(secret);
  });

  test('the same secret encrypts differently each time', () => {
    /* The existing Encryption class uses a fixed IV for PHP receipt-link
       compatibility. That is why this does not reuse it: with a fixed IV, two
       shops with the same SMTP password produce identical ciphertext. */
    const a = secretField.encryptField('same-value');
    const b = secretField.encryptField('same-value');
    expect(a).not.toBe(b);
    expect(secretField.decryptField(a)).toBe('same-value');
    expect(secretField.decryptField(b)).toBe('same-value');
  });

  test('tampering is detected rather than silently accepted', () => {
    const sealed = secretField.encryptField('rzp_live_secret');
    const parts = sealed.slice(secretField.PREFIX.length).split(':');
    const ct = Buffer.from(parts[2], 'base64');
    ct[0] ^= 0xff;
    const tampered = `${secretField.PREFIX}${parts[0]}:${parts[1]}:${ct.toString('base64')}`;

    expect(() => secretField.decryptField(tampered)).toThrow();
  });

  test('a value written before encryption is returned unchanged', () => {
    /* This is what lets an existing shop keep working. Reading tolerates both;
       the next save encrypts. */
    expect(secretField.decryptField('rzp_live_plain')).toBe('rzp_live_plain');
    expect(secretField.isEncrypted('rzp_live_plain')).toBe(false);
  });

  test('empty means not configured, and stays that way', () => {
    /* Encrypting an empty string would turn "no gateway set up" into something
       that looks set up. */
    expect(secretField.encryptField('')).toBe('');
    expect(secretField.encryptField(null)).toBe(null);
    expect(secretField.encryptField(undefined)).toBe(undefined);
  });

  test('encrypting twice does not double-wrap', () => {
    const once = secretField.encryptField('secret');
    expect(secretField.encryptField(once)).toBe(once);
  });

  test('a credential object keeps its readable parts readable', () => {
    /* A settings page has to show which provider is configured and whether it
       is on, without holding the key. */
    const sealed = secretField.encryptCredentialObject({
      key: 'rzp_live_abc',
      secret: 'super-secret',
      name: 'razorpay',
      status: 'true',
    });

    expect(sealed.name).toBe('razorpay');
    expect(sealed.status).toBe('true');
    expect(sealed.key).not.toBe('rzp_live_abc');
    expect(sealed.secret).not.toBe('super-secret');

    const opened = secretField.decryptCredentialObject(sealed);
    expect(opened.key).toBe('rzp_live_abc');
    expect(opened.secret).toBe('super-secret');
  });

  test('without a key it refuses rather than storing plain text', () => {
    delete process.env.ENCRYPTION_KEY;
    expect(() => secretField.encryptField('secret')).toThrow(/ENCRYPTION_KEY/);
  });
});
