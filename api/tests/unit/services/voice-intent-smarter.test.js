'use strict';

/*
 * The smart half of a voice order, kept honest.
 *
 * The phone hears; the shop's own AI understands. Understanding used to stop
 * at "which dish, how many". Now the answer also carries the note said for a
 * dish ("no onion"), the dishes that might have been meant when nothing
 * matched, up to two things that go with the order, and one sentence the
 * waiter can read back. Every one of those is a place a model can invent, so
 * every one is checked against the menu before it leaves, and this is where.
 */

const ai = require('../../../src/services/ai.service');
const service = require('../../../src/services/voice-intent.service');

const context = { branchId: 'b', licenseId: 'l' };
const MENU = [
  { id: '1', name: 'Masala Dosa' },
  { id: '2', name: 'Filter Coffee' },
  { id: '3', name: 'Rava Dosa' },
  { id: '4', name: 'Sambar Vada' },
];

afterEach(() => jest.restoreAllMocks());

const modelAnswers = (obj) => {
  jest.spyOn(ai, 'available').mockResolvedValue(true);
  return jest.spyOn(ai, 'ask').mockResolvedValue({ status: true, data: { text: JSON.stringify(obj) } });
};

test('the note said for a dish rides with the dish, and is capped', async () => {
  modelAnswers({
    commands: [{ verb: 'add', quantity: 2, item_id: '1', said: 'masala dosa', note: '  no onion, extra spicy  ' }],
  });
  const result = await service.resolve({ text: 'two masala dosa no onion extra spicy', items: MENU }, context);
  expect(result.data.commands[0].note).toBe('no onion, extra spicy');

  modelAnswers({ commands: [{ verb: 'add', quantity: 1, item_id: '1', note: 'x'.repeat(500) }] });
  const long = await service.resolve({ text: 'dosa', items: MENU }, context);
  expect(long.data.commands[0].note).toHaveLength(80);
});

test('candidates are offered only for a dish that did not match, and only from the menu', async () => {
  modelAnswers({
    commands: [
      { verb: 'add', quantity: 1, item_id: null, said: 'dosa', candidates: ['3', '999', '1', '3', '4', '2'] },
      { verb: 'add', quantity: 1, item_id: '2', said: 'coffee', candidates: ['1'] },
    ],
  });
  const result = await service.resolve({ text: 'dosa and coffee', items: MENU }, context);
  const [unmatched, matched] = result.data.commands;
  expect(unmatched.item_id).toBe(null);
  expect(unmatched.candidates).toEqual(['3', '1', '4']);
  /* a matched dish carries no candidates, whatever the model sent */
  expect(matched.candidates).toEqual([]);
});

test('a suggestion is never a dish the shop lacks, nor one just ordered, and there are at most two', async () => {
  modelAnswers({
    commands: [{ verb: 'add', quantity: 1, item_id: '1', said: 'masala dosa' }],
    suggestions: [
      { item_id: '1', why: 'already ordered' },
      { item_id: '999', why: 'not on the menu' },
      { item_id: '2', why: 'goes with dosa' },
      { item_id: '2', why: 'said twice' },
      { item_id: '4', why: 'a side' },
      { item_id: '3', why: 'a third one' },
    ],
  });
  const result = await service.resolve({ text: 'masala dosa', items: MENU }, context);
  expect(result.data.suggestions).toEqual([
    { item_id: '2', why: 'goes with dosa' },
    { item_id: '4', why: 'a side' },
  ]);
});

test('the summary is one capped sentence, and the table is short or nothing', async () => {
  modelAnswers({
    commands: [{ verb: 'add', quantity: 1, item_id: '1' }],
    summary: 'S'.repeat(400),
    table: '  Table 5  ',
  });
  const result = await service.resolve({ text: 'table five one dosa', items: MENU }, context);
  expect(result.data.summary).toHaveLength(160);
  expect(result.data.table).toBe('Table 5');

  modelAnswers({ commands: [{ verb: 'add', quantity: 1, item_id: '1' }], table: '   ' });
  const none = await service.resolve({ text: 'one dosa', items: MENU }, context);
  expect(none.data.table).toBe(null);
  expect(none.data.summary).toBe('');
  expect(none.data.suggestions).toEqual([]);
});

test('the model is told about every new field, in the shape the app reads', () => {
  /* The prompt is the contract; a field the model is not asked for never
     arrives, and the app would silently show less than it could. */
  expect(service.SYSTEM).toMatch(/"note":"<kitchen note/);
  expect(service.SYSTEM).toMatch(/"candidates":\[/);
  expect(service.SYSTEM).toMatch(/"suggestions":\[\{"item_id"/);
  expect(service.SYSTEM).toMatch(/"summary":"<one short sentence/);
  expect(service.SYSTEM).toMatch(/"table":"<the table or room/);
  expect(service.SYSTEM).toMatch(/never one already in the commands/);
});

test('extras() on a bare answer is empty, never undefined', () => {
  expect(service.extras({ commands: [] }, MENU, [])).toEqual({ table: null, suggestions: [], summary: '' });
  expect(service.extras(null, MENU, [])).toEqual({ table: null, suggestions: [], summary: '' });
});
