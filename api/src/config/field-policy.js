/*
 * What may leave this machine, and in what form.
 *
 * There was no such list. Every field a model stored was implicitly eligible to
 * be synced in plain text, which is how a shop's Razorpay secret key ends up
 * somewhere nobody decided to put it. The database already holds, in the clear:
 *
 *   branch.payment_gateway          Razorpay key and secret
 *   branch.phonepe_payment_gateway  PhonePe merchant credentials
 *   branch.smtp_password            the shop's email password
 *   branch.way2sms_password         the shop's SMS provider password
 *
 * Those are not business records. They are credentials that let somebody take
 * payments and send messages as the merchant, and they are worth more to a
 * thief than the sales history sitting beside them.
 *
 * Four policies. The distinction that matters is the last one: it is
 * conditional, not fixed.
 *
 *   LOCAL_ONLY      never leaves this machine, in any edition
 *   SYNC_PLAIN      ordinary business data - items, sales, customers
 *   SYNC_ENCRYPTED  synced as ciphertext; Cloud stores it and cannot read it
 *   CLOUD_ONLY      belongs in Cloud when there is one, and is never written to
 *                   the till; falls back to encrypted-local when there is not
 *
 * CLOUD_ONLY is the right answer for the four fields above once Cloud exists.
 * They are used only for operations that already require the internet - an
 * online payment, an email, an SMS - so moving them server-side costs no
 * offline capability, and it matches what payment providers require: a secret
 * key must not live in a client application, and a till is a client
 * application.
 *
 * Until Cloud carries them, they are encrypted locally. This file is what makes
 * that a decision rather than an oversight, and field-policy.test.js fails if a
 * field that looks like a secret is added without one.
 */

const POLICY = Object.freeze({
  LOCAL_ONLY: 'local-only',
  SYNC_PLAIN: 'sync-plain',
  SYNC_ENCRYPTED: 'sync-encrypted',
  CLOUD_ONLY: 'cloud-only',
});

/*
 * Declared per collection, then per field. Only fields that are not SYNC_PLAIN
 * need an entry - listing every ordinary column would be noise nobody
 * maintains, and the test below catches anything secret-looking that is
 * missing.
 */
const FIELDS = Object.freeze({
  branches: Object.freeze({
    payment_gateway: {
      policy: POLICY.CLOUD_ONLY,
      encrypt: true,
      why: 'Razorpay key and secret. Lets the holder take and refund payments as the merchant.',
    },
    phonepe_payment_gateway: {
      policy: POLICY.CLOUD_ONLY,
      encrypt: true,
      why: 'PhonePe merchant credentials.',
    },
    smtp_password: {
      policy: POLICY.CLOUD_ONLY,
      encrypt: true,
      why: "The shop's email account password. Lets the holder send mail as the shop.",
    },
    way2sms_password: {
      policy: POLICY.CLOUD_ONLY,
      encrypt: true,
      why: 'SMS provider password.',
    },
  }),

  users: Object.freeze({
    password: {
      policy: POLICY.SYNC_PLAIN,
      encrypt: false,
      why: 'Already a bcrypt hash, not a recoverable secret. Encrypting a hash adds nothing.',
    },
    api_key: {
      policy: POLICY.SYNC_ENCRYPTED,
      encrypt: true,
      why: 'Grants API access as this user. Cloud has no reason to read it.',
    },
  }),

  settings: Object.freeze({
    whatsapp_session: {
      policy: POLICY.LOCAL_ONLY,
      encrypt: true,
      why: 'A WhatsApp session is bound to this device. Syncing it would be meaningless and dangerous.',
    },
  }),
});

/** The policy for a field, or SYNC_PLAIN if it was never called out. */
function policyFor(collection, field) {
  const declared = FIELDS[collection] && FIELDS[collection][field];
  return declared ? declared.policy : POLICY.SYNC_PLAIN;
}

/** Should this field be encrypted at rest in the local database? */
function shouldEncrypt(collection, field) {
  const declared = FIELDS[collection] && FIELDS[collection][field];
  return Boolean(declared && declared.encrypt);
}

/** May this field be sent to Posnic Cloud, and how? */
function syncDisposition(collection, field) {
  const policy = policyFor(collection, field);
  return {
    policy,
    mayLeaveMachine: policy === POLICY.SYNC_PLAIN || policy === POLICY.SYNC_ENCRYPTED,
    mustBeCiphertext: policy === POLICY.SYNC_ENCRYPTED,
    /* CLOUD_ONLY does not travel from the till - it originates in Cloud and the
       till never holds it. Uploading one would be the transition case, which is
       a deliberate one-off, not ordinary sync. */
    belongsInCloudOnly: policy === POLICY.CLOUD_ONLY,
  };
}

/** Every field with a policy other than the default, for tests and audits. */
function declaredFields() {
  const out = [];
  for (const [collection, fields] of Object.entries(FIELDS)) {
    for (const [field, meta] of Object.entries(fields)) {
      out.push({ collection, field, ...meta });
    }
  }
  return out;
}

module.exports = { POLICY, FIELDS, policyFor, shouldEncrypt, syncDisposition, declaredFields };
