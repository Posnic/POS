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

  describe('what the shop says about itself', () => {
    test('the facts: where, when, how to get it, how to pay, where the customer sits', () => {
      const facts = assistant.shopFacts({
        store: {
          name: 'Azure Sea Foods',
          kind: 'restaurant',
          currency: '₹',
          currency_code: 'INR',
          address: '12 Beach Road, Chennai, 600001',
          phone: '044 1234 / 98400 00000',
          website: 'azure.example',
        },
        channel: {
          accepting: false,
          message: 'Opens at 11:00.',
          opens_at: '2026-09-13T05:30:00.000Z',
          hours: {
            mon: [{ open: 660, close: 1380 }],
            tue: [],
            sun: [
              { open: 660, close: 900 },
              { open: 1080, close: 1380 },
            ],
          },
          fulfilment: ['dine_in', 'delivery', 'drone'],
          time_zone: 'Asia/Kolkata',
        },
        charges: { delivery: { fee: 30, free_above: 500, min_order: 200 } },
        payment: { cash: true, upi: 'true', phonepe_merchant_id: 'M123', online: false },
        service_point: { label: 'Table 5', venue: null },
      });
      expect(facts).toMatchObject({
        name: 'Azure Sea Foods',
        kind: 'restaurant',
        currency: 'INR',
        address: '12 Beach Road, Chennai, 600001',
        phone: '044 1234 / 98400 00000',
        website: 'azure.example',
        taking_orders_now: false,
        status: 'Opens at 11:00.',
        time_zone: 'Asia/Kolkata',
        payment: ['cash', 'upi'],
        customer_is_at: 'Table 5',
      });
      expect(facts.hours).toBe(
        'Mon 11:00-23:00; Tue closed; Wed closed; Thu closed; Fri closed; Sat closed; Sun 11:00-15:00, 18:00-23:00'
      );
      expect(facts.ways_to_get_it).toEqual([
        { way: 'dine_in', means: 'eat here (at the table)' },
        { way: 'delivery', means: 'delivery', fee: 30, fee_waived_from: 500, minimum_order: 200 },
      ]);
      expect(JSON.stringify(facts)).not.toContain('M123');
      /* What time it is where the SHOP is, so a four o'clock order can be
         offered a cold drink and a late one cannot. Owner: "if user order
         something in after noon ... inform we have cool drinks, fresh juice
         and mojito like that." */
      expect(facts.part_of_day).toMatch(/morning|afternoon|evening|late night/);
      expect(facts.now).toMatch(/^\w+ \d{2}:\d{2}$/);

      const room = assistant.shopFacts({
        store: {},
        channel: { accepting: true },
        service_point: { venue: { name: 'Royal Club', unit_label: 'Room', unit: '123' } },
      });
      expect(room).toMatchObject({
        name: 'this shop',
        taking_orders_now: true,
        hours: 'no fixed hours',
        customer_is_at: 'Royal Club, Room 123',
      });
      expect(room.status).toBeUndefined();
    });

    test("the clock is the shop's own, and the parts of the day are named", () => {
      /* Midday UTC is half past five in the evening in Kolkata and half past
         seven in the morning in New York: the kitchen's afternoon, not the
         server's. */
      const noonUtc = new Date('2026-09-12T12:00:00.000Z');
      expect(assistant.clockAt('Asia/Kolkata', noonUtc)).toEqual({
        day: 'Saturday',
        time: '17:30',
        part: 'evening',
      });
      expect(assistant.clockAt('America/New_York', noonUtc)).toMatchObject({
        time: '08:00',
        part: 'morning',
      });
      /* A time zone nobody recognises still answers with a part of the day. */
      expect(assistant.clockAt('Mars/Olympus', noonUtc).part).toMatch(
        /morning|afternoon|evening|late night/
      );
      expect([10, 13, 18, 23].map(assistant.partOfDay)).toEqual([
        'morning',
        'afternoon',
        'evening',
        'late night',
      ]);
    });

    test('the menu splits into what can be ordered and the names of what cannot', () => {
      const { open, off } = assistant.splitMenu(assistant.menuFor(MENU));
      expect(open.map((i) => i.id)).not.toContain('b1');
      expect(open.every((i) => i.available === undefined)).toBe(true);
      expect(off).toEqual(['Masala Dosa']);
    });

    test('a model that cannot see is not sent pictures, and prose is capped', () => {
      /*
       * Owner: "actually charging for this conversation from openai too much.
       * few conversatin goes up to 1usd."
       *
       * On the live voice line this menu is re-billed as context every time
       * the assistant opens its mouth, and it was carrying image URLs and a
       * photos array - 3,464 characters of them on the 31-dish sandbox menu -
       * to something that cannot see and will never say a URL.
       *
       * What earns its place stays: the description answers "what is in it?"
       * and goes_with is where the cross-selling suggestion comes from.
       */
      const source = {
        id: 'd1',
        name: 'Masala Dosa',
        price: 120,
        available: true,
        image: '/uploads/demo/dosa.jpg',
        photos: ['/uploads/a.jpg', '/uploads/b.jpg'],
        icon: '🥞',
        description: 'x'.repeat(400),
        goes_with: ['d2'],
        category_name: 'Breakfast',
      };
      const { open } = assistant.splitMenu([source]);
      const dish = open[0];
      for (const blind of ['image', 'photos', 'icon']) {
        expect(dish[blind]).toBeUndefined();
      }
      expect(dish.description).toHaveLength(120);
      expect(dish.goes_with).toEqual(['d2']);
      expect(dish).toMatchObject({ id: 'd1', name: 'Masala Dosa', price: 120 });
      /* And the CALLER's object is untouched. The storefront hands these same
         objects to the page, which very much does want the pictures; trimming
         them in place would strip the images off the customer's menu. */
      expect(source.image).toBe('/uploads/demo/dosa.jpg');
      expect(source.photos).toHaveLength(2);
      expect(source.description).toHaveLength(400);
    });

    test('the typed brief carries the two lists and the facts, and the rules name them', async () => {
      jest.spyOn(ai, 'available').mockResolvedValue(true);
      jest.spyOn(assistant._repo(), 'resolveGroup').mockResolvedValue({
        status: true,
        data: { values: { ai_ordering_assistant: 'true' } },
      });
      const ask = jest
        .spyOn(ai, 'ask')
        .mockResolvedValue({ status: true, data: { text: '{"reply":"ok","actions":[]}' } });
      await assistant.reply(
        { messages: [{ role: 'user', text: 'where are you?' }] },
        {
          categories: MENU,
          store: { name: 'Azure', address: '12 Beach Road' },
          channel: { accepting: true },
        },
        context
      );
      const [request] = ask.mock.calls[0];
      expect(request.prompt).toMatch(/MENU \(JSON; what can be ordered right now/);
      expect(request.prompt).not.toContain('"available":false');
      expect(request.prompt).toMatch(/NOT TODAY[\s\S]*"Masala Dosa"/);
      expect(request.prompt).toMatch(/ABOUT THE SHOP[\s\S]*"address":"12 Beach Road"/);
      expect(assistant.SYSTEM).toContain('ABOUT THE SHOP');
      expect(assistant.SYSTEM).toContain('NOT TODAY');
    });
  });

  describe('what the shop wrote', () => {
    test('house notes ride with the rules, after them; the greeting reaches the storefront; both are cut to size', async () => {
      jest.spyOn(ai, 'available').mockResolvedValue(true);
      jest.spyOn(assistant._repo(), 'resolveGroup').mockResolvedValue({
        status: true,
        data: {
          values: {
            ai_ordering_assistant: 'true',
            ai_assistant_instructions:
              "Today's special is the prawn biryani.\u0007 Always offer a drink. " +
              'x'.repeat(2000),
            ai_assistant_greeting: '  Vanakkam! What can I get you?  ',
          },
        },
      });
      const ask = jest
        .spyOn(ai, 'ask')
        .mockResolvedValue({ status: true, data: { text: '{"reply":"ok","actions":[]}' } });
      await assistant.reply(
        { messages: [{ role: 'user', text: 'hi' }] },
        { categories: MENU },
        context
      );
      const [request] = ask.mock.calls[0];
      expect(request.system.startsWith(assistant.SYSTEM)).toBe(true);
      expect(request.system).toContain('House notes from the shop');
      expect(request.system).toContain(
        "Today's special is the prawn biryani. Always offer a drink."
      );
      expect(request.system).not.toContain('\u0007');
      expect(request.system.length).toBeLessThan(assistant.SYSTEM.length + 1700);
      expect(await assistant.storefrontFeatures(context)).toEqual({
        assistant: true,
        voice: 'turns',
        assistant_greeting: 'Vanakkam! What can I get you?',
      });
    });

    test('nothing written means the plain rules and no greeting field; a closed door sends nothing at all', async () => {
      jest.spyOn(ai, 'available').mockResolvedValue(true);
      const resolveGroup = jest
        .spyOn(assistant._repo(), 'resolveGroup')
        .mockResolvedValue({ status: true, data: { values: { ai_ordering_assistant: 'true' } } });
      const ask = jest
        .spyOn(ai, 'ask')
        .mockResolvedValue({ status: true, data: { text: '{"reply":"ok","actions":[]}' } });
      await assistant.reply(
        { messages: [{ role: 'user', text: 'hi' }] },
        { categories: MENU },
        context
      );
      expect(ask.mock.calls[0][0].system).toBe(assistant.SYSTEM);
      expect(await assistant.storefrontFeatures(context)).toEqual({
        assistant: true,
        voice: 'turns',
      });
      resolveGroup.mockResolvedValue({
        status: true,
        data: { values: { ai_assistant_greeting: 'Hello' } },
      });
      expect(await assistant.storefrontFeatures(context)).toEqual({
        assistant: false,
        voice: false,
      });
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
