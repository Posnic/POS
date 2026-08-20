'use strict';

/*
 * Which settings group each key belongs to.
 *
 * This file is the whole point of SETTINGS_AND_BRANCH_SCOPE_DESIGN: today one
 * document and one endpoint carry feature toggles, printing preferences, SMTP
 * passwords and document defaults together, and that single fact produced
 * three separate production bugs on 2026-08-20 (5c84111 twice, 69bc0cd).
 * Splitting them by lifetime and blast radius is what makes those bugs
 * inexpressible rather than merely fixed.
 *
 * Nothing here writes or reads a database. It is a map, deliberately, so the
 * grouping can be reviewed and tested on its own before any data moves.
 *
 * SECRETS is the group that matters most for safety: an SMTP password
 * currently sits in the same document as roundOff and goes out to any client
 * that reads settings. Once it lives apart it can be write-only over the API.
 */

const FEATURES = [
  // module on/off - the list setting.model calls TOGGLES
  'staff_shifts_enable',
  'staff_tips_enable',
  'staff_roster_enable',
  'cash_register_enable',
  'till_lock_enable',
  'module_tax_enable',
  'module_credit_enable',
  'module_marketing_enable',
  'module_messaging_enable',
  'module_channels_enable',
  'module_channels_kiosk_enable',
  'module_recyclebin_enable',
  'module_themes_enable',
  'module_cashbook_enable',
  'quick_sale_enable',
  'quotes_enable',
  'pl_include_cashbook',
  // sale-screen capabilities that behave the same way
  'custom_charges_enable',
  'sale_quick_edit_enable',
  'table_options',
  'hardware_weight_machine_enable',
  'enable_multi_payment',
  'till_lock_idle_minutes',
];

const PREFERENCES = [
  // printing and receipts - shop- and device-shaped, rarely copied
  'print_type',
  'printing_size',
  'print_width',
  'print_character',
  'header_print',
  'footer_print',
  'printall',
  'print_url',
  'print_logoimg',
  'print_sale_notes',
  'receipt_barcode',
  'customer_print',
  'roundOff',
  'keyboard_view',
  'whatsapp_receipt',
  'sales_sms',
  'auto_sms',
  'sales_mail',
  'balance_view',
  'customer_checkbox',
  'supplier_checkbox',
  'tax_checkbox',
  'sale_inline_editor',
  // business defaults
  'default_customer',
  'default_supplier',
  'default_tax',
  'sales_prefix',
  'receiving_prefix',
  'notification_range',
  'discount_percentage',
  'discount_amount',
  'indian_gst',
  'branch_gstin_number',
  // reminders
  'enable_notification_reminders',
  'enable_email_reminders',
  'enable_sms_reminders',
  'enable_sms_auto_send',
  'sms_auto_send_time',
  'sms_retry_period',
  'sms_max_retries',
];

const DOCUMENTS = [
  // what a printed or emailed document says - usually IS copied to a new branch
  'quote_default_payment_method',
  'quote_default_bank_details',
  'quote_default_terms',
  'quote_default_signature',
  'invoice_terms',
];

const SECRETS = [
  // different ACL, never copied between branches, never sent to a client
  'email_smtp_host',
  'email_smtp_port',
  'email_smtp_secure',
  'email_smtp_username',
  'email_smtp_password',
  'email_smtp_from',
];

/* Now that an empty value means "leave the saved credential alone", clearing
   one has to be sayable. This sentinel is that word - deliberate, and
   impossible to send by accident from an empty input. */
const CLEAR_SECRET = '__posnic_clear__';

/*
 * S4. Every credential that lives on the legacy `branches` document.
 *
 * SECRETS above is the new per-group store; this is the older reality the
 * shop is running on right now. GET /branches/getOneStore returns the whole
 * branch document, and the settings screen reads its email and SMS cards
 * from it - so today an SMTP password, an SMS gateway password and two API
 * keys are handed to the browser of anyone who can open Settings, and sit in
 * that response's cache. They are write-only from here on.
 *
 * Usernames, hosts, ports and sender IDs deliberately stay visible: they are
 * not credentials, and blanking them would leave the card unreadable.
 */
const BRANCH_CREDENTIALS = [
  'email_smtp_password',
  'smtp_password',
  'way2sms_password',
  'way2sms_api',
  'textlocal_api',
];

/* A branch document with its credentials removed, plus a map saying which
   ones exist. The UI needs to show "configured" without ever holding the
   value, and an empty string must read as absent, not as a set password. */
const redactBranchSecrets = (doc) => {
  if (!doc || typeof doc !== 'object') return doc;
  const isPlain = doc.toObject ? doc.toObject() : doc;
  const out = { ...isPlain };
  const configured = {};
  for (const key of BRANCH_CREDENTIALS) {
    const v = out[key];
    configured[key] = v !== undefined && v !== null && String(v) !== '';
    delete out[key];
  }
  out.secrets_configured = configured;
  return out;
};

/* The same removal without the configured map, for the endpoints that return
   branch documents for other reasons - the branch LIST, and the echo after a
   create or update. The list is the worse of the two: unstripped it hands out
   every branch's credentials in a single response. Accepts a document or an
   array of them. */
const stripBranchSecrets = (docOrList) => {
  if (Array.isArray(docOrList)) return docOrList.map(stripBranchSecrets);
  if (!docOrList || typeof docOrList !== 'object') return docOrList;
  const plain = docOrList.toObject ? docOrList.toObject() : docOrList;
  const out = { ...plain };
  for (const key of BRANCH_CREDENTIALS) delete out[key];
  return out;
};

/*
 * The partial $set for one credential the caller sent.
 *
 * Absent or empty means LEAVE IT ALONE. That rule is the other half of the
 * redaction above: once a password stops being sent to the browser, the form
 * loads with the field empty, and writing that emptiness through would blank
 * the shop's mail the first time anyone saved an unrelated setting. Clearing
 * is still possible, but it has to be said out loud with CLEAR_SECRET.
 *
 * The value itself is never trimmed - a password may legitimately begin or
 * end with a space, and silently trimming one produces a login that fails
 * with no visible reason.
 */
const secretUpdate = (key, raw) => {
  if (raw === undefined || raw === null) return {};
  const v = String(raw);
  if (v === '') return {};
  return { [key]: v === CLEAR_SECRET ? '' : v };
};

const GROUPS = {
  features: FEATURES,
  preferences: PREFERENCES,
  documents: DOCUMENTS,
  secrets: SECRETS,
};

/* key -> group, built once so lookups are not a scan per key */
const GROUP_OF = new Map();
for (const [group, keys] of Object.entries(GROUPS)) {
  for (const key of keys) {
    GROUP_OF.set(key, group);
  }
}

const groupOf = (key) => GROUP_OF.get(String(key)) || null;

/* Split an incoming payload into per-group objects. Keys we do not recognise
   are returned under `unknown` rather than dropped, so a caller can decide -
   silently discarding a setting is how a save appears to work and does not. */
const splitByGroup = (payload = {}) => {
  const out = { features: {}, preferences: {}, documents: {}, secrets: {}, unknown: {} };
  for (const [key, value] of Object.entries(payload || {})) {
    const group = groupOf(key);
    out[group || 'unknown'][key] = value;
  }
  return out;
};

module.exports = {
  GROUPS,
  groupOf,
  splitByGroup,
  FEATURES,
  PREFERENCES,
  DOCUMENTS,
  SECRETS,
  BRANCH_CREDENTIALS,
  CLEAR_SECRET,
  secretUpdate,
  redactBranchSecrets,
  stripBranchSecrets,
};
