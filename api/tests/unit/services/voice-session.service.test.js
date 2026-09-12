'use strict';
/*
 * The live line: who may open it, what brief the model is handed, and what
 * it is allowed to do.
 */
const voice = require('../../../src/services/voice-session.service');
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
      { id: 'b1', name: 'Masala Dosa', price: 120, diet: 'veg', available: false },
    ],
  },
];
const OFFER = 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
const context = { branchId: 'b1', licenseId: 'lic' };

describe('voice-session.service', () => {
  afterEach(() => jest.restoreAllMocks());

  test('the brief carries how to speak, the fenced menu and the house notes, and the four tools', () => {
    const menu = assistant.menuFor(MENU);
    const brief = voice.instructionsFor(
      { store: { name: 'Azure Sea Foods', currency: '₹' } },
      menu,
      {
        instructions: "Today's special is the prawn biryani.",
      }
    );
    expect(brief.startsWith(voice.VOICE_SYSTEM)).toBe(true);
    expect(brief).toContain('<<<SHOP_DATA');
    expect(brief).toContain('"Chicken Biryani"');
    expect(brief).toContain('"available":false');
    expect(brief).toContain("Today's special is the prawn biryani.");
    expect(brief).not.toMatch(/Reply with JSON/);
    expect(voice.tools().map((t) => t.name)).toEqual([
      'add_to_order',
      'remove_from_order',
      'set_quantity',
      'show_order',
    ]);
    for (const tool of voice.tools()) expect(tool.type).toBe('function');
  });

  test('the doors, in order: a bad offer, no assistant, no live voice', async () => {
    const settings = jest
      .spyOn(assistant, 'settingsFor')
      .mockResolvedValue({ on: false, liveVoice: false, instructions: '', greeting: '' });
    const answer = jest.spyOn(ai, 'realtimeAnswer');
    expect(await voice.session({ sdp: 'hello' }, { categories: MENU }, context)).toMatchObject({
      status: false,
      message: 'Nothing to connect',
    });
    expect(await voice.session({ sdp: OFFER }, { categories: MENU }, context)).toEqual({
      status: false,
      message: 'no_assistant',
      data: null,
    });
    settings.mockResolvedValue({ on: true, liveVoice: false, instructions: '', greeting: '' });
    expect(await voice.session({ sdp: OFFER }, { categories: MENU }, context)).toEqual({
      status: false,
      message: 'no_live_voice',
      data: null,
    });
    settings.mockResolvedValue({ on: true, liveVoice: true, instructions: '', greeting: '' });
    expect(await voice.session({ sdp: OFFER }, { products: [] }, context)).toMatchObject({
      status: false,
      message: 'This shop has nothing on its menu yet',
    });
    expect(answer).not.toHaveBeenCalled();
  });

  test('with the doors open the offer goes to the provider with the brief and the tools, and the answer comes back', async () => {
    jest
      .spyOn(assistant, 'settingsFor')
      .mockResolvedValue({
        on: true,
        liveVoice: true,
        instructions: 'Always offer a drink.',
        greeting: '',
      });
    const answer = jest
      .spyOn(ai, 'realtimeAnswer')
      .mockResolvedValue({ status: true, data: { sdp: 'v=0\r\nanswer', model: 'gpt-realtime' } });
    const out = await voice.session(
      { sdp: OFFER },
      { categories: MENU, store: { name: 'Azure' } },
      context
    );
    expect(out).toEqual({ status: true, data: { sdp: 'v=0\r\nanswer', model: 'gpt-realtime' } });
    const [request, ctx] = answer.mock.calls[0];
    expect(ctx).toBe(context);
    expect(request.feature).toBe('voice_order_live');
    expect(request.sdp).toBe(OFFER);
    expect(request.instructions).toContain('Always offer a drink.');
    expect(request.instructions).toContain('"Chicken Biryani"');
    expect(request.tools.map((t) => t.name)).toContain('add_to_order');
  });

  test('a refusal from the AI service passes through untouched', async () => {
    jest
      .spyOn(assistant, 'settingsFor')
      .mockResolvedValue({ on: true, liveVoice: true, instructions: '', greeting: '' });
    jest
      .spyOn(ai, 'realtimeAnswer')
      .mockResolvedValue({ status: false, message: 'Live voice needs an OpenAI key', data: null });
    expect(await voice.session({ sdp: OFFER }, { categories: MENU }, context)).toEqual({
      status: false,
      message: 'Live voice needs an OpenAI key',
      data: null,
    });
  });
});
