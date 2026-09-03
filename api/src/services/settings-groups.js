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
  'module_demo_data_enable',
  'quick_sale_enable',
  /* Not a feature: a record that the welcome screen has been shown. Lives
     with the switches because it is written at the same moment. */
  'first_run_done',
  /* The DECISION flag, and the only one the welcome's gate reads now.
     first_run_done was written by a build that counted ANY close as an
     answer - Esc, a stray click - so for every shop touched in that window
     the flag says "asked" about a person who never was. The value cannot be
     trusted and cannot be un-written per shop, so the gate moved to a key
     that only the two decision paths (Save, and the explicit "Not now")
     have ever written. first_run_done is still written for compatibility;
     nothing reads it to decide. */
  'first_run_decided',
  'quotes_enable',
  'invoices_enable',
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
  /* Invoices (INVOICING_MODULE_DESIGN): the document number prefix and the
     credit days a new invoice's due date is counted from. invoice_terms, the
     document's wording, sits with the other document text below. */
  'invoice_prefix',
  'invoice_due_days',
  'notification_range',
  'discount_percentage',
  'discount_amount',
  'indian_gst',
  'branch_gstin_number',
  /* Google Analytics, the shop's own (owner: "make it as feature. on / off
     with entering GA value"). Off by default; the CSP only opens the Google
     domains while this is on - see services/analytics-config.js. */
  'analytics_enable',
  'analytics_ga_id',
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
 * 'false' is not false, and the day that mattered it switched a shop ON.
 *
 * The legacy save path always parsed its toggles ('true'/'false' arrive as
 * strings from a checkbox map), but the group endpoint stored what it was
 * sent, verbatim. So the first-run welcome - which sends strings - wrote
 * quotes_enable:"false" style values into BOTH stores, and every reader that
 * gates with `value !== false` read the string as enabled. The owner saved
 * "everything off" and watched every feature light up.
 *
 * One rule, used by the write path (so it cannot recur), the resolver and
 * the branch read (so rows already poisoned still read true): a literal
 * 'true'/'false' string on a features key IS the boolean. Only the two
 * literals convert - numbers, names and real booleans pass untouched, which
 * is what keeps this safe for till_lock_idle_minutes and friends.
 */
const coerceFeatureToggle = (value) => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

/* The doc-level sweep: the features keys of `doc` that are string booleans,
   as a ready-to-$set repair object. Empty means the doc is clean. */
const featureToggleRepairs = (doc) => {
  const fix = {};
  if (!doc || typeof doc !== 'object') return fix;
  for (const key of FEATURES) {
    if (doc[key] === 'true' || doc[key] === 'false') fix[key] = doc[key] === 'true';
  }
  return fix;
};

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

/*
 * Who sees whose records (owner ask #85).
 *
 * Its own group rather than a preference, because it is the only group where a
 * wrong value changes what data a person can READ. Separating it means an ACL
 * can be put on the switch itself without also gating printer settings.
 */
const SHARING = ['share_customers', 'share_suppliers'];

/*
 * The tax regime and its per-country decisions (PURCHASE_TAX_PLAN G6).
 * Written by the installer from the shop's country, edited on the Tax
 * Configuration page, read at read-time by every tax surface.
 */
const TAX = [
  /* Presentation and structure stay in the tax-profile registry (T0);
     this group stores only what a SHOP decides inside its regime. */
  'tax_regime', // override only: vat_credit | sales_tax | none
  'india_gst_type', // regular | composition | unregistered
  'india_turnover_above_5cr', // >=5cr: 6-digit HSN + e-invoice readiness
  'india_qrmp', // quarterly filing scheme below 5cr
  'us_resale_certificate', // the shop's own resale certificate number
];

const GROUPS = {
  features: FEATURES,
  preferences: PREFERENCES,
  documents: DOCUMENTS,
  secrets: SECRETS,
  sharing: SHARING,
  tax: TAX,
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
  const out = {
    features: {},
    preferences: {},
    documents: {},
    secrets: {},
    sharing: {},
    tax: {},
    unknown: {},
  };
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
  SHARING,
  BRANCH_CREDENTIALS,
  CLEAR_SECRET,
  coerceFeatureToggle,
  featureToggleRepairs,
  secretUpdate,
  redactBranchSecrets,
  stripBranchSecrets,
};
