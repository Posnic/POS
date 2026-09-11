'use strict';

/*
 * What the description writer is allowed to put in a shop's catalogue.
 *
 * The risk here is not a clumsy sentence. It is a claim. "Organic", "sugar
 * free" and "homemade" are regulated words in most of the markets this
 * product sells into, and a shopkeeper who publishes one because a button
 * offered it is the person who answers for it, not us. So the instruction is
 * explicit, the payload is narrow, and the output is a draft in a form field
 * that a person edits before anything is saved.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const SERVICES = path.join(__dirname, '..', '..', '..', 'src', 'services');
const description = require(path.join(SERVICES, 'ai-item-description'));
const ai = require(path.join(SERVICES, 'ai.service'));

const CONTEXT = { branchId: 'b1', licenseId: 'l1' };

test('the model is told not to invent claims', () => {
  /* The one instruction that stands between this feature and a false
     advertising complaint on a customer's shelf. */
  assert.match(description.SYSTEM, /never invent/i, 'the no-invention rule is gone');
  assert.match(description.SYSTEM, /organic/i,
    'the regulated words are no longer named, so the model must guess which they are');
  assert.match(description.SYSTEM, /unless that exact word appears/i,
    'the model may now use a claim the shop never made');
});

test('only describable fields are sent, and no person is', () => {
  /*
   * A supplier is a company and a name on a contract; neither belongs in a
   * prompt, and neither improves a description of a bar of soap.
   */
  const payload = description.payloadFor({
    name: 'Mysore Sandal Soap',
    category_name: 'Bath',
    brand: 'Mysore',
    unit: 'piece',
    diet: 'veg',
    tags: ['soap', 'bath'],
    supplier_name: 'Ramesh Traders',
    cost_price: 42,
    selling_price: 60,
    customer_phone: '9876543210',
  });

  assert.match(payload, /Mysore Sandal Soap/);
  assert.match(payload, /veg/);
  assert.ok(!payload.includes('Ramesh Traders'), 'a supplier name was sent to the model');
  assert.ok(!payload.includes('9876543210'), 'a phone number was sent to the model');
  assert.ok(!payload.includes('42'), 'the cost price was sent to the model');
});

test('empty fields are dropped rather than sent as blanks', () => {
  /* "brand:" with nothing after it invites the model to fill the gap, which
     is exactly the inventing this feature must not do. */
  const payload = description.payloadFor({ name: 'Rice', brand: '', unit: null, tags: [] });
  assert.equal(payload, 'name: Rice');
});

test('no name is refused before any call is made', async () => {
  /* The shop pays per call. Asking a model to describe nothing costs real
     money and returns nothing useful. */
  const out = await description.draft({ name: '   ' }, CONTEXT);
  assert.equal(out.status, false);
  assert.equal(out.reason, 'no_name');
});

test('the requested language reaches the instruction', async () => {
  /*
   * A Tamil storefront does not want English copy, and translating it
   * afterwards is a second job nobody does. Checked by capturing what ask()
   * was handed rather than by calling a provider.
   */
  const original = ai.ask;
  let seen = null;
  ai.ask = async (args) => {
    seen = args;
    return { status: true, data: { text: 'ok', cost_minor: 1 } };
  };
  try {
    await description.draft({ name: 'Idli', language: 'ta' }, CONTEXT);
  } finally {
    ai.ask = original;
  }
  assert.ok(seen, 'ask was never called');
  assert.match(seen.system, /language is: ta/, 'the shop language never reached the model');
  assert.match(seen.prompt, /Idli/, 'the item never reached the model');
  assert.match(seen.prompt, /SHOP_DATA/, 'the item name was sent unfenced');
});

test('output longer than the form allows is trimmed, not rejected', async () => {
  /*
   * The field is maxlength=1000. A model that ignores the brief would
   * otherwise produce text the form's own validation refuses, which reads to
   * the shopkeeper as the button being broken rather than the model being
   * wordy.
   */
  const original = ai.ask;
  ai.ask = async () => ({ status: true, data: { text: 'x'.repeat(4000), cost_minor: 1 } });
  try {
    const out = await description.draft({ name: 'Rice' }, CONTEXT);
    assert.equal(out.status, true);
    assert.ok(out.data.description.length <= 1000, 'text too long for the field was returned');
  } finally {
    ai.ask = original;
  }
});

test('a refusal from the seam is passed through, not swallowed', async () => {
  /* A shop with no key must learn that from the message, not be told the
     description could not be written for some unexplained reason. */
  const original = ai.ask;
  ai.ask = async () => ({ status: false, message: 'No API key is saved for the AI provider', data: null });
  try {
    const out = await description.draft({ name: 'Rice' }, CONTEXT);
    assert.equal(out.status, false);
    assert.match(out.message, /No API key/, 'the reason a shop cannot use it was swallowed');
  } finally {
    ai.ask = original;
  }
});
