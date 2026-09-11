'use strict';

/*
 * What the description writer is allowed to put in a shop's catalogue.
 *
 * The risk here is not a clumsy sentence. It is a claim. "Organic", "sugar
 * free" and "homemade" are regulated words in most of the markets this product
 * sells into, and a shopkeeper who publishes one because a button offered it
 * is the person who answers for it, not us. So the instruction is explicit,
 * the payload is narrow, and the output is a draft in a form field that a
 * person edits before anything is saved.
 */

const description = require('../../../src/services/ai-item-description');
const ai = require('../../../src/services/ai.service');

const CONTEXT = { branchId: 'b1', licenseId: 'l1' };

describe('what it may say', () => {
  test('the model is told not to invent claims', () => {
    /* The one instruction standing between this feature and a false
       advertising complaint on somebody's shelf. */
    expect(description.SYSTEM).toMatch(/never invent/i);
    expect(description.SYSTEM).toMatch(/organic/i);
    expect(description.SYSTEM).toMatch(/unless that exact word appears/i);
  });
});

describe('what reaches the model', () => {
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

    expect(payload).toMatch(/Mysore Sandal Soap/);
    expect(payload).toMatch(/veg/);
    expect(payload.includes('Ramesh Traders')).toBe(false);
    expect(payload.includes('9876543210')).toBe(false);
    expect(payload.includes('42')).toBe(false);
  });

  test('empty fields are dropped rather than sent as blanks', () => {
    /* "brand:" with nothing after it invites the model to fill the gap, which
       is exactly the inventing this feature must not do. */
    const payload = description.payloadFor({ name: 'Rice', brand: '', unit: null, tags: [] });
    expect(payload).toBe('name: Rice');
  });

  test('the shop language and the fence both reach the call', async () => {
    /*
     * A Tamil storefront does not want English copy, and translating it
     * afterwards is a second job nobody does. The item name is fenced because
     * it can be typed by the public through the online ordering page.
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
    expect(seen).not.toBeNull();
    expect(seen.system).toMatch(/language is: ta/);
    expect(seen.prompt).toMatch(/Idli/);
    expect(seen.prompt).toMatch(/SHOP_DATA/);
  });
});

describe('what comes back', () => {
  test('no name is refused before any call is made', async () => {
    /* The shop pays per call. Asking a model to describe nothing costs real
       money and returns nothing useful. */
    const out = await description.draft({ name: '   ' }, CONTEXT);
    expect(out.status).toBe(false);
    expect(out.reason).toBe('no_name');
  });

  test('output longer than the form allows is trimmed, not rejected', async () => {
    /*
     * The field is maxlength=1000. A model that ignores the brief would
     * otherwise produce text the form's own validation refuses, which reads to
     * the shopkeeper as the button being broken rather than the model wordy.
     */
    const original = ai.ask;
    ai.ask = async () => ({ status: true, data: { text: 'x'.repeat(4000), cost_minor: 1 } });
    try {
      const out = await description.draft({ name: 'Rice' }, CONTEXT);
      expect(out.status).toBe(true);
      expect(out.data.description.length).toBeLessThanOrEqual(1000);
    } finally {
      ai.ask = original;
    }
  });

  test('a refusal is passed through with its reason intact', async () => {
    /* A shop with no key must learn that from the message, not be told the
       description could not be written for some unexplained reason. */
    const original = ai.ask;
    ai.ask = async () => ({
      status: false,
      message: 'No API key is saved for the AI provider',
      data: null,
    });
    try {
      const out = await description.draft({ name: 'Rice' }, CONTEXT);
      expect(out.status).toBe(false);
      expect(out.message).toMatch(/No API key/);
    } finally {
      ai.ask = original;
    }
  });
});
