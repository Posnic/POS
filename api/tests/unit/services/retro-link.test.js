'use strict';

/**
 * Retro-link proposal logic (VARIANT_SYSTEM_RESEARCH V1e).
 *
 * What must hold: only unlinked "<Parent> / <Value>" items group; grouping
 * respects category AND branch (two shops' "Shirt / S" never merge); a
 * lone member is not a family; duplicate values make a group ambiguous and
 * it is dropped rather than guessed at; already-linked items are left
 * alone. "Fish / Chips" alone stays a fish dish.
 */

const { proposeFamilies } = require('../../../scripts/retro-link-variants');

const it = (name, extra = {}) => ({
  _id: name,
  name,
  category_id: 'C1',
  branch_id: 'B1',
  ...extra,
});

describe('proposeFamilies', () => {
  test('groups by parent prefix within category and branch', () => {
    const out = proposeFamilies([
      it('Shirt / Small'),
      it('Shirt / Medium'),
      it('Shirt / Large'),
      it('Jeans / 32'),
      it('Jeans / 34'),
    ]);
    expect(out.map((g) => [g.parent, g.members.length])).toEqual([
      ['Jeans', 2],
      ['Shirt', 3],
    ]);
    expect(out[1].members.map((m) => m.value)).toEqual(['Small', 'Medium', 'Large']);
  });

  test('a lone "Fish / Chips" is a dish, not a family', () => {
    expect(proposeFamilies([it('Fish / Chips'), it('Plain Rice')])).toEqual([]);
  });

  test('different category or branch never merges', () => {
    const out = proposeFamilies([
      it('Shirt / Small', { category_id: 'C1' }),
      it('Shirt / Medium', { category_id: 'C2' }),
      it('Shirt / Large', { branch_id: 'B2' }),
    ]);
    expect(out).toEqual([]);
  });

  test('duplicate values make the group ambiguous - dropped, never guessed', () => {
    const out = proposeFamilies([
      it('Shirt / Small'),
      { _id: 'dup', name: 'Shirt / small', category_id: 'C1', branch_id: 'B1' },
    ]);
    expect(out).toEqual([]);
  });

  test('already-linked items are left alone', () => {
    const out = proposeFamilies([
      it('Shirt / Small', { variant_group_id: 'G1' }),
      it('Shirt / Medium', { variant_group_id: 'G1' }),
    ]);
    expect(out).toEqual([]);
  });

  test('malformed separators never propose', () => {
    const out = proposeFamilies([
      it(' / Small'),
      it('Shirt / '),
      it('Shirt/Medium'),
      it('Shirt /Large'),
    ]);
    expect(out).toEqual([]);
  });
});
