'use strict';

/*
 * A picture for a dish nobody photographed.
 *
 * The feature only earns its place if it needs NO WORK from the shop. A shop
 * with three hundred items will not upload three hundred photographs and will
 * not pick three hundred emoji either, so what is pinned hardest here is that
 * an ordinary Indian menu comes out decorated with nobody touching it.
 *
 * The second thing pinned is that a wrong guess is worse than none. The
 * matching is deliberately narrow: word boundaries, so "chapati" is not a
 * chai, and no guess at all for a name that says nothing.
 */

const {
  guess,
  iconFor,
  clean,
  fold,
  PALETTE,
  MAX_ICON_LENGTH,
} = require('../../../src/utils/dish-icons');

describe('an ordinary menu decorates itself', () => {
  /* Read as a menu, not as a table: these are the names shops actually use. */
  const MENU = {
    'Chicken Biryani': '🍛',
    'Mutton Biryani': '🍛',
    'Veg Fried Rice': '🍛',
    'Masala Dosa': '🥞',
    'Rava Dosa': '🥞',
    'Idli Sambar': '🍚',
    'Medu Vada': '🍩',
    'Butter Naan': '🫓',
    'Tandoori Roti': '🫓',
    'Paneer Tikka': '🧀',
    'Paneer Butter Masala': '🧀',
    'Chicken 65': '🍗',
    'Chicken Tikka': '🍗',
    'Mutton Curry': '🍖',
    'Prawn Fry': '🍤',
    'Fish Fry': '🐟',
    'Egg Bhurji': '🥚',
    'Hakka Noodles': '🍜',
    'Veg Momos': '🥟',
    'Chicken Roll': '🌯',
    'Gulab Jamun': '🍮',
    'Ice Cream': '🍨',
    'Filter Coffee': '☕',
    'Masala Chai': '🍵',
    'Sweet Lassi': '🥤',
    'Mineral Water': '💧',
  };

  for (const [name, icon] of Object.entries(MENU)) {
    test(`${name} -> ${icon}`, () => expect(guess(name)).toBe(icon));
  }

  test('almost none of a real menu comes back empty', () => {
    const guessed = Object.keys(MENU).filter((name) => guess(name));
    expect(guessed.length).toBe(Object.keys(MENU).length);
  });
});

describe('which word in a name wins', () => {
  /*
   * Not longest-match. A name carries the DISH, the THING and the METHOD, and
   * they are not equally useful to somebody scanning a menu.
   */
  test('the dish beats the thing: a Chicken Biryani is a biryani', () => {
    expect(guess('Chicken Biryani')).toBe('🍛');
    expect(guess('Chicken Biryani')).not.toBe(guess('Chicken 65'));
  });

  test('the thing beats the method: a Paneer Tikka is paneer, not a skewer', () => {
    expect(guess('Paneer Tikka')).toBe('🧀');
    expect(guess('Mushroom Tikka')).toBe('🍄');
    /* And a name with nothing but the method still gets something. */
    expect(guess('Seekh Kebab')).toBe('🍢');
  });

  test('a name that says nothing gets nothing, and that is the right answer', () => {
    /* A confident wrong picture on a menu card is worse than a blank one. */
    for (const name of ['Item 4', 'Special', 'ABC 123', 'Lays 50g', '', null, undefined, 'x']) {
      expect(guess(name)).toBe('');
    }
  });
});

describe('matching is on words, not substrings', () => {
  /* The failure this prevents: "chapati" contains "chai", "scone" contains
     "cone", and a menu full of confidently wrong pictures is worse than a
     plain one. */
  test('chapati is bread, not tea', () => {
    expect(guess('Chapati')).toBe('🫓');
    expect(guess('Masala Chai')).toBe('🍵');
  });

  test('a keyword inside a longer word does not count', () => {
    expect(guess('Teapot Stand')).toBe('');
    expect(guess('Rolling Pin')).toBe('');
  });

  test('an adjective does not outrank the thing it describes', () => {
    /* "sweet" in the sweets list turned Sweet Lassi into a boiled sweet, and
       Sweet Corn and Sweet Lime with it. Named sweets only. */
    expect(guess('Sweet Lassi')).toBe('\u{1F964}');
    expect(guess('Sweet Corn')).toBe('\u{1F33D}');
    expect(guess('Sweet Lime')).toBe('\u{1F34B}');
    expect(guess('Jalebi')).toBe('\u{1F36C}');
  });

  test('a plural still lands', () => {
    expect(guess('Momos')).toBe(guess('Momo'));
    expect(guess('Idlis')).toBe(guess('Idli'));
  });

  test('case, accents and punctuation do not matter', () => {
    expect(guess('CHICKEN BIRYANI')).toBe('🍛');
    expect(guess('chicken-biryani')).toBe('🍛');
    expect(guess('Café Coffee')).toBe('☕');
  });

  test('the same name always gives the same answer', () => {
    /* Server, form and menu all call this. A shopkeeper must never be shown
       one picture while their customers are shown another. */
    expect(guess('Masala Dosa')).toBe(guess('masala   dosa'));
  });
});

describe('shops that are not restaurants', () => {
  /* A kirana has two thousand items and will never photograph one. */
  test('household goods are guessed too', () => {
    expect(guess('Lifebuoy Soap')).toBe('🧼');
    expect(guess('Wheat Flour 1kg')).toBe('🌾');
    expect(guess('AA Battery')).toBe('🔋');
    expect(guess('LED Bulb 9W')).toBe('💡');
  });
});

describe('what actually gets drawn', () => {
  test('a photograph beats all of it, because drawing both is clutter', () => {
    expect(iconFor({ image: '/uploads/biryani.jpg', name: 'Chicken Biryani' })).toBe('');
    expect(iconFor({ image: '/uploads/x.jpg', icon: '🍛', name: 'Chicken Biryani' })).toBe('');
  });

  test('what the shop chose beats what the name suggests', () => {
    expect(iconFor({ icon: '🔥', name: 'Chicken Biryani' })).toBe('🔥');
  });

  test('and the name is read when the shop chose nothing', () => {
    expect(iconFor({ name: 'Chicken Biryani' })).toBe('🍛');
    expect(iconFor({ icon: '', name: 'Masala Dosa' })).toBe('🥞');
  });

  test('nothing at all is a legitimate answer', () => {
    expect(iconFor({ name: 'Item 4' })).toBe('');
    expect(iconFor(null)).toBe('');
    expect(iconFor({})).toBe('');
  });
});

describe('what a shop is allowed to paste into the field', () => {
  test('an emoji survives whole', () => {
    /* Every emoji worth having is a surrogate pair. A cap counted in UTF-16
       units cuts one in half and leaves a broken glyph on every card that
       dish appears on. */
    expect(clean('🍛')).toBe('🍛');
    expect(Array.from(clean('🍛')).length).toBe(1);
  });

  test('letters and digits are refused, so this cannot become a second name', () => {
    expect(clean('Biryani')).toBe('');
    expect(clean('65')).toBe('');
    expect(clean('🍛 Biryani')).toBe('');
  });

  test('a pasted essay is capped by CHARACTER, not by code unit', () => {
    const long = '🍛🍚🍜🍲🥘🍝';
    const capped = clean(long);
    expect(Array.from(capped).length).toBe(MAX_ICON_LENGTH);
    /* The tell-tale of a half-cut pair: a lone surrogate. */
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(capped)).toBe(false);
  });

  test('empty, null and whitespace all mean no icon', () => {
    for (const value of ['', '   ', null, undefined]) expect(clean(value)).toBe('');
  });
});

describe('the picker', () => {
  test('offers a short, food-first grid rather than every emoji there is', () => {
    expect(PALETTE.length).toBeGreaterThan(40);
    expect(PALETTE.length).toBeLessThan(120);
  });

  test('every offered icon is one this field would accept back', () => {
    for (const icon of PALETTE) expect(clean(icon)).toBe(icon);
  });

  test('nothing is offered twice', () => {
    expect(new Set(PALETTE).size).toBe(PALETTE.length);
  });
});

describe('fold', () => {
  test('pads, so a keyword can be matched on word boundaries', () => {
    expect(fold('Chicken Biryani')).toBe(' chicken biryani ');
  });
  test('collapses anything that is not a letter or a digit', () => {
    expect(fold('Chicken--65 (spicy)')).toBe(' chicken 65 spicy ');
  });
});
