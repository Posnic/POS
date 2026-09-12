'use strict';
/*
 * The customer's assistant on the ordering page.
 *
 * What matters here is not what the model says but what is allowed to reach
 * the page: only dishes from this shop's menu, only whole quantities, only
 * when the shop has opened the door, and nothing at all when the shop has
 * configured nothing.
 */
const assistant = require('../../../src/services/ordering-assistant.service');
const ai = require('../../../src/services/ai.service');

const MENU = [
  {
    category_name: 'Mains',
    items: [
      {
        id: 'm1',
        name: 'Chicken Biryani',
        price: 320,
        diet: 'non_veg',
        description: 'Dum cooked, with raita',
      },
      { id: 'm2', name: 'Paneer Butter Masala', price: 300, diet: 'veg' },
      {
        id: 'b1',
        name: 'Masala Dosa',
        price: 120,
        diet: 'veg',
        available: false,
        served_in: ['Breakfast'],
      },
    ],
  },
  {
    category_name: 'Drinks',
    items: [{ id: 'd1', name: 'Fresh Lime Soda', price: 80, diet: 'veg' }],
  },
];
const context = { branchId: 'b1', licenseId: 'lic' };

describe('ordering-assistant.service', () => {
  afterEach(() => jest.restoreAllMocks());

  describe('what may reach the page', () => {
    const menu = assistant.menuFor(MENU);

    test('an id the model invented is dropped; a real one comes back with its name', () => {
      const out = assistant.tidy(
        {
          reply: 'Two biryanis and a unicorn.',
          actions: [
            { verb: 'add', item_id: 'm1', quantity: 2 },
            { verb: 'add', item_id: 'unicorn', quantity: 1 },
          ],
        },
        menu
      );
      expect(out.actions).toEqual([
        { verb: 'add', item_id: 'm1', name: 'Chicken Biryani', quantity: 2 },
      ]);
      expect(out.reply).toBe('Two biryanis and a unicorn.');
    });

    test('quantities are whole and bounded, unknown verbs are dropped, notes are cut', () => {
      const out = assistant.tidy(
        {
          actions: [
            { verb: 'add', item_id: 'm2', quantity: 99, note: ' extra   gravy ' },
            { verb: 'set', item_id: 'd1', quantity: 0.4 },
            { verb: 'remove', item_id: 'm1', quantity: 7 },
            { verb: 'pay', item_id: 'm1' },
            { verb: 'add', item_id: 'm1', quantity: 1, note: 'x'.repeat(500) },
          ],
        },
        menu
      );
      expect(out.actions[0]).toEqual({
        verb: 'add',
        item_id: 'm2',
        name: 'Paneer Butter Masala',
        quantity: 20,
        note: 'extra gravy',
      });
      expect(out.actions[1]).toEqual({
        verb: 'set',
        item_id: 'd1',
        name: 'Fresh Lime Soda',
        quantity: 1,
      });
      expect(out.actions[2]).toEqual({
        verb: 'remove',
        item_id: 'm1',
        name: 'Chicken Biryani',
        quantity: 0,
      });
      expect(out.actions.map((a) => a.verb)).not.toContain('pay');
      expect(out.actions[3].note).toHaveLength(120);
    });

    test('a dish that is off right now cannot be added, only removed', () => {
      const out = assistant.tidy(
        {
          actions: [
            { verb: 'add', item_id: 'b1', quantity: 1 },
            { verb: 'remove', item_id: 'b1' },
          ],
        },
        menu
      );
      expect(out.actions).toEqual([
        { verb: 'remove', item_id: 'b1', name: 'Masala Dosa', quantity: 0 },
      ]);
    });

    test('the menu the model sees carries what it needs and nothing about people', () => {
      expect(menu[0]).toEqual({
        id: 'm1',
        name: 'Chicken Biryani',
        category: 'Mains',
        price: 320,
        diet: 'non_veg',
        about: 'Dum cooked, with raita',
      });
      expect(menu[2]).toMatchObject({ id: 'b1', available: false, served: ['Breakfast'] });
    });

    test('the cart is reduced to ids the menu knows', () => {
      const known = new Set(menu.map((i) => i.id));
      expect(
        assistant.cartFor(
          [
            { id: 'm1', quantity: 2, note: 'less spicy' },
            { id: 'ghost', quantity: 1 },
            { id: 'd1', quantity: 0 },
          ],
          known
        )
      ).toEqual([{ item_id: 'm1', quantity: 2, note: 'less spicy' }]);
    });

    test('only the last turns travel, each cut to size', () => {
      const turns = assistant.turnsFor(
        Array.from({ length: 20 }, (_, i) => ({
          role: i % 2 ? 'assistant' : 'user',
          text: 'turn ' + i + ' ' + 'y'.repeat(600),
        }))
      );
      expect(turns).toHaveLength(12);
      expect(turns[0].text.startsWith('turn 8')).toBe(true);
      expect(turns[0].text.length).toBeLessThanOrEqual(500);
      expect(turns[11].role).toBe('assistant');
    });
  });

  describe('the door', () => {
    test('closed when the shop has no usable AI, whatever the ordering switch says', async () => {
      jest.spyOn(ai, 'available').mockResolvedValue(false);
      const resolveGroup = jest
        .spyOn(assistant._repo(), 'resolveGroup')
        .mockResolvedValue({ status: true, data: { values: { ai_ordering_assistant: 'true' } } });
      expect(await assistant.available(context)).toBe(false);
      expect(resolveGroup).not.toHaveBeenCalled();
    });

    test('closed until the shop says yes for the ordering page in particular', async () => {
      jest.spyOn(ai, 'available').mockResolvedValue(true);
      /* The same seam ai.service.test.js uses: the instance the service holds. */
      const resolveGroup = jest
        .spyOn(assistant._repo(), 'resolveGroup')
        .mockResolvedValue({ status: true, data: { values: {} } });
      expect(await assistant.available(context)).toBe(false);
      resolveGroup.mockResolvedValue({
        status: true,
        data: { values: { ai_ordering_assistant: 'true' } },
      });
      expect(await assistant.available(context)).toBe(true);
      resolveGroup.mockResolvedValue({
        status: true,
        data: { values: { ai_ordering_assistant: true } },
      });
      expect(await assistant.available(context)).toBe(true);
      expect(resolveGroup).toHaveBeenCalledWith('preferences', context);
    });

    test('a shop that switched nothing on answers "no_assistant", not an error', async () => {
      jest.spyOn(ai, 'available').mockResolvedValue(false);
      const ask = jest.spyOn(ai, 'ask');
      const out = await assistant.reply(
        { messages: [{ role: 'user', text: 'hi' }] },
        { categories: MENU },
        context
      );
      expect(out).toEqual({ status: false, message: 'no_assistant', data: null });
      expect(ask).not.toHaveBeenCalled();
    });

    test('the door is checked before the menu: a closed shop with an empty menu is still "no_assistant"', async () => {
      /* On the sandbox the first answer was 503 "nothing on its menu": the
         menu was read under the wrong key and the door came second, so a
         shop with no AI at all was told about its menu instead. */
      jest.spyOn(ai, 'available').mockResolvedValue(false);
      const out = await assistant.reply(
        { messages: [{ role: 'user', text: 'hi' }] },
        { products: [] },
        context
      );
      expect(out).toEqual({ status: false, message: 'no_assistant', data: null });
    });
  });

  describe('the storefront, whichever shape it arrived in', () => {
    test('the repository answer: products, category under _id', () => {
      const raw = {
        products: [
          {
            _id: { category_id: 'c1', category_name: 'Mains' },
            items: [{ id: 'm1', name: 'Chicken Biryani', price: 320, diet: 'non_veg' }],
          },
        ],
      };
      expect(assistant.menuFor(assistant.categoriesOf(raw))).toEqual([
        { id: 'm1', name: 'Chicken Biryani', category: 'Mains', price: 320, diet: 'non_veg' },
      ]);
    });

    test('the presented answer: menu.categories with the name beside the items', () => {
      const presented = {
        menu: {
          categories: [
            {
              category_id: 'c1',
              category_name: 'Drinks',
              items: [{ id: 'd1', name: 'Lime Soda', price: 80 }],
            },
          ],
        },
      };
      expect(assistant.menuFor(assistant.categoriesOf(presented))).toEqual([
        { id: 'd1', name: 'Lime Soda', category: 'Drinks', price: 80 },
      ]);
      expect(assistant.categoriesOf(null)).toEqual([]);
      expect(assistant.categoriesOf({ store: {} })).toEqual([]);
    });
  });

  describe('a turn', () => {
    beforeEach(() => {
      jest.spyOn(ai, 'available').mockResolvedValue(true);
      jest
        .spyOn(assistant._repo(), 'resolveGroup')
        .mockResolvedValue({ status: true, data: { values: { ai_ordering_assistant: 'true' } } });
    });

    test('nothing asked is nothing sent', async () => {
      const ask = jest.spyOn(ai, 'ask');
      expect(await assistant.reply({ messages: [] }, { categories: MENU }, context)).toMatchObject({
        status: false,
      });
      expect(
        await assistant.reply(
          { messages: [{ role: 'assistant', text: 'Hello' }] },
          { categories: MENU },
          context
        )
      ).toMatchObject({ status: false });
      expect(ask).not.toHaveBeenCalled();
    });

    test('the model is given the fenced menu, cart and conversation, and its actions come back tidied', async () => {
      const ask = jest.spyOn(ai, 'ask').mockResolvedValue({
        status: true,
        data: {
          text: '{"reply":"Adding two Chicken Biryani, less spicy.","actions":[{"verb":"add","item_id":"m1","quantity":2,"note":"less spicy"},{"verb":"add","item_id":"nope","quantity":1}]}',
        },
      });
      const out = await assistant.reply(
        {
          messages: [
            { role: 'user', text: 'What is good?' },
            { role: 'assistant', text: 'The biryani.' },
            { role: 'user', text: 'Two of those, less spicy' },
          ],
          cart: [{ id: 'd1', quantity: 1 }],
        },
        { categories: MENU, store: { name: 'Azure Sea Foods', currency: '₹' } },
        context
      );
      expect(out.status).toBe(true);
      expect(out.data).toEqual({
        reply: 'Adding two Chicken Biryani, less spicy.',
        actions: [
          { verb: 'add', item_id: 'm1', name: 'Chicken Biryani', quantity: 2, note: 'less spicy' },
        ],
      });
      const [request, ctx] = ask.mock.calls[0];
      expect(ctx).toBe(context);
      expect(request.feature).toBe('ordering_assistant');
      expect(request.system).toBe(assistant.SYSTEM);
      expect(request.prompt).toContain('<<<SHOP_DATA');
      expect(request.prompt).toContain('"Chicken Biryani"');
      expect(request.prompt).toContain('"item_id":"d1"');
      expect(request.prompt).toContain('Two of those, less spicy');
      /* The fence is the only place the customer's words appear. */
      expect(request.system).not.toContain('Two of those');
      expect(request.prompt.indexOf('Two of those')).toBeGreaterThan(
        request.prompt.indexOf('<<<SHOP_DATA')
      );
    });

    test('prose from a model that ignored the shape is still an answer, with no actions', async () => {
      jest
        .spyOn(ai, 'ask')
        .mockResolvedValue({ status: true, data: { text: 'The biryani is lovely tonight.' } });
      const out = await assistant.reply(
        { messages: [{ role: 'user', text: 'Recommend' }] },
        { categories: MENU },
        context
      );
      expect(out).toEqual({
        status: true,
        data: { reply: 'The biryani is lovely tonight.', actions: [] },
      });
    });

    test('a refusal from the AI service passes through untouched', async () => {
      jest.spyOn(ai, 'ask').mockResolvedValue({
        status: false,
        message: 'AI assistance has reached its monthly limit',
        data: null,
      });
      const out = await assistant.reply(
        { messages: [{ role: 'user', text: 'Recommend' }] },
        { categories: MENU },
        context
      );
      expect(out).toEqual({
        status: false,
        message: 'AI assistance has reached its monthly limit',
        data: null,
      });
    });
  });
});
