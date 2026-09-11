'use strict';
/*
 * A picture for a dish that nobody had to upload.
 *
 * WHY THIS EXISTS. A menu card with a photo is better than one without, and a
 * shop with three hundred items will photograph none of them. That is not
 * laziness: it is three hundred photographs, lit, cropped and uploaded, for a
 * list that changes every season. So the honest choice is not "photo or no
 * photo" - it is "something or nothing", and today it is nothing.
 *
 * An emoji is the something. It is already on every phone, in colour, at any
 * size, in both themes, with no download, no licence and no storage. It costs
 * one short string on the item and renders as text.
 *
 * AND NOBODY HAS TO CHOOSE IT EITHER. A shop that will not upload three
 * hundred photographs will not pick three hundred emoji. So the name is read:
 * "Chicken Biryani" is a rice dish, "Masala Dosa" is a dosa, "Cold Coffee" is
 * a coffee. The shop overrides the handful it disagrees with, which is a
 * morning's work rather than a project.
 *
 * That is the same shape the sale grid's tile already uses - a colour derived
 * from the name, visible in the form, changeable any time - except that a
 * hashed colour means nothing and a picture of a dosa means dosa.
 *
 * WHAT MATCHES FIRST, AND WHY IT IS NOT LONGEST-WINS.
 *
 * A dish name carries three kinds of word and they are not equally useful to
 * somebody scanning a menu:
 *
 *   the dish      biryani, dosa, pizza, burger. Unmistakable on a plate
 *   the thing     paneer, chicken, prawn, mushroom. What you are eating
 *   the method    tikka, tandoori, fry, masala, gravy. How it was cooked
 *
 * Read in that order, "Chicken Biryani" is a biryani rather than a chicken,
 * "Paneer Tikka" is paneer rather than a skewer, and "Chicken 65" - which
 * names no dish at all - is chicken. Longest-match would have made Paneer
 * Tikka a skewer and Chicken Biryani a chicken, both of which are worse.
 *
 * This is NOT a translation table and does not try to be complete. It is a
 * first guess a shopkeeper can overrule in one tap, and a wrong guess costs
 * that tap. A missing guess costs nothing at all: no icon is a perfectly good
 * answer, and better than a confident wrong one.
 */

/* Ligatures and skin tones are deliberately excluded by the guesses below;
   a shop may still paste one, and the cap counts CHARACTERS the way a person
   sees them rather than UTF-16 units, which would cut a surrogate pair in
   half and leave a broken glyph on every menu card. */
const MAX_ICON_LENGTH = 4;

/*
 * The dish, when the name says one outright.
 *
 * Ordered most specific first WITHIN the tier, because "ice cream" must beat
 * "cream" and "cold coffee" is still coffee.
 */
const DISHES = [
  [['biryani', 'biriyani', 'briyani', 'biriani', 'pulao', 'pulav', 'fried rice'], '🍛'],
  [['dosa', 'dosai', 'uttapam', 'uthappam', 'pancake', 'crepe'], '🥞'],
  [['idli', 'idly', 'appam', 'puttu'], '🍚'],
  [['vada', 'vadai', 'donut', 'doughnut'], '🍩'],
  [['pizza'], '🍕'],
  [['burger'], '🍔'],
  [['sandwich', 'toast', 'club'], '🥪'],
  [['pasta', 'spaghetti', 'macaroni', 'penne'], '🍝'],
  [['noodle', 'noodles', 'hakka', 'chowmein', 'chow mein', 'ramen'], '🍜'],
  [['momo', 'momos', 'dumpling', 'dimsum', 'dim sum'], '🥟'],
  [['roll', 'wrap', 'frankie', 'shawarma', 'burrito', 'kathi'], '🌯'],
  [['taco'], '🌮'],
  [['samosa', 'pakora', 'pakoda', 'bajji', 'bonda', 'fries', 'french fry'], '🍟'],
  [['soup', 'shorba', 'rasam', 'sambar', 'sambhar'], '🍲'],
  [['salad', 'kosambari'], '🥗'],
  [['ice cream', 'icecream', 'kulfi', 'sundae', 'falooda'], '🍨'],
  [['cake', 'pastry', 'brownie', 'muffin', 'cupcake'], '🍰'],
  [['cookie', 'biscuit'], '🍪'],
  [['chocolate', 'choco'], '🍫'],
  [['gulab jamun', 'jamun', 'halwa', 'kheer', 'payasam', 'rasmalai', 'rasgulla', 'pudding'], '🍮'],
  /* Named sweets only. "sweet" itself is an adjective before it is a dish -
     Sweet Lassi is a drink, Sweet Corn is corn, Sweet Lime is a lime - and
     letting it match turned all three into a boiled sweet. */
  [['laddu', 'ladoo', 'barfi', 'burfi', 'mysore pak', 'jalebi', 'peda'], '🍬'],
  [['popcorn'], '🍿'],
  [['honey'], '🍯'],
  [['coffee', 'cappuccino', 'latte', 'espresso', 'americano', 'mocha'], '☕'],
  [['tea', 'chai', 'green tea'], '🍵'],
  [['juice', 'mocktail'], '🧃'],
  [['lassi', 'milkshake', 'shake', 'smoothie', 'soda', 'cola', 'pepsi', 'coke', 'sprite'], '🥤'],
  [['milk', 'badam milk'], '🥛'],
  [['beer', 'lager'], '🍺'],
  [['wine'], '🍷'],
  [['cocktail'], '🍸'],
  [['water', 'mineral water'], '💧'],
  [
    [
      'naan',
      'roti',
      'chapati',
      'chapathi',
      'paratha',
      'parotta',
      'kulcha',
      'rumali',
      'poori',
      'puri',
    ],
    '🫓',
  ],
  [['bread', 'bun', 'pav', 'baguette'], '🍞'],
];

/* What it is made of, when the name did not say what the dish is. */
const THINGS = [
  [['paneer', 'cheese', 'butter masala'], '🧀'],
  [['chicken', 'murg', 'poultry'], '🍗'],
  [['mutton', 'lamb', 'beef', 'pork', 'keema', 'meat'], '🍖'],
  [['prawn', 'shrimp', 'lobster'], '🍤'],
  [['crab'], '🦀'],
  [['fish', 'meen', 'pomfret', 'surmai', 'tuna'], '🐟'],
  [['egg', 'omelette', 'omelet', 'anda', 'bhurji'], '🥚'],
  [['mushroom'], '🍄'],
  [['corn', 'makai'], '🌽'],
  [['potato', 'aloo', 'alu'], '🥔'],
  [['tomato'], '🍅'],
  [['onion'], '🧅'],
  [['mango', 'aam'], '🥭'],
  [['banana'], '🍌'],
  [['apple'], '🍎'],
  [['orange', 'mosambi'], '🍊'],
  [['grape'], '🍇'],
  [['lemon', 'lime', 'nimbu'], '🍋'],
  [['coconut', 'tender coconut'], '🥥'],
  [['watermelon'], '🍉'],
  [['pineapple'], '🍍'],
  [['strawberry'], '🍓'],
  [['peanut', 'cashew', 'almond', 'badam', 'nut'], '🥜'],
  [['curd', 'yoghurt', 'yogurt', 'raita', 'dahi'], '🥣'],
  [['dal', 'dhal', 'daal', 'lentil', 'rajma', 'chana', 'chole'], '🫘'],
  [['rice', 'anna'], '🍚'],
  [['veg', 'vegetable', 'sabzi', 'subzi', 'palak', 'spinach'], '🥬'],
];

/* How it was cooked, which is the weakest signal and the last one read. */
const METHODS = [
  [['curry', 'masala', 'gravy', 'kurma', 'korma', 'kadai', 'kadhai', 'handi'], '🍛'],
  [['fry', 'fried', 'crispy', '65', 'manchurian', 'chilli', 'chili'], '🍟'],
  /* Skewers and the tandoor are a METHOD, not a dish: "Paneer Tikka" is
     paneer, and a picture of a skewer says less about it than a picture of
     cheese does. Only when the name says nothing else does the method get
     to speak. */
  [['tikka', 'kebab', 'kabab', 'tandoori', 'seekh', 'satay', 'skewer'], '🍢'],
  [['grill', 'grilled', 'roast', 'roasted', 'barbecue', 'bbq'], '🍢'],
  [['thali', 'meals', 'combo', 'platter'], '🍽️'],
];

/*
 * Things a shop sells that are not food at all.
 *
 * POS is not only restaurants, and a kirana with an unguessed soap is exactly
 * the shop that would benefit most - it has two thousand items and will never
 * photograph one of them.
 */
const GOODS = [
  [['soap', 'detergent', 'surf', 'washing powder'], '🧼'],
  [['shampoo', 'lotion', 'oil bottle', 'sanitizer', 'sanitiser'], '🧴'],
  [['toothpaste', 'brush'], '🪥'],
  [['paper', 'tissue', 'napkin'], '🧻'],
  [['battery', 'cell'], '🔋'],
  [['bulb', 'light', 'lamp'], '💡'],
  [['pen', 'pencil'], '🖊️'],
  [['notebook', 'book', 'register'], '📒'],
  [['bag', 'cover'], '🛍️'],
  [['cigarette', 'tobacco'], '🚬'],
  [['matches', 'matchbox', 'lighter'], '🔥'],
  [['salt', 'sugar', 'spice', 'powder'], '🧂'],
  [['flour', 'atta', 'maida', 'rava', 'sooji', 'wheat'], '🌾'],
  [['oil', 'ghee'], '🫒'],
  [['medicine', 'tablet', 'syrup'], '💊'],
];

/* Read in this order. See the header for why it is not longest-match. */
const TIERS = [DISHES, THINGS, METHODS, GOODS];

/**
 * A name reduced to something a keyword can be found in.
 *
 * Case and accents folded, punctuation spaced out rather than deleted, and
 * the whole thing padded, so a keyword can be matched on WORD BOUNDARIES.
 * Matching bare substrings would make "chapati" a chai and "scone" a cone.
 */
function fold(name) {
  return ` ${String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;
}

/**
 * The emoji this name suggests, or '' when nothing does.
 *
 * Deterministic: the same name always gives the same answer, on the server
 * and in the form and on the menu, so a shopkeeper is never shown one icon
 * while a customer is shown another.
 *
 * @param {string} name a dish or product name
 * @returns {string} one emoji, or '' for "no guess"
 */
function guess(name) {
  const text = fold(name);
  if (text.trim().length < 2) return '';

  for (const tier of TIERS) {
    for (const [words, icon] of tier) {
      for (const word of words) {
        if (text.includes(` ${word} `)) return icon;
        /* Plurals, so "two dosas" and a menu line reading "Momos" both land.
           Only a trailing s: English plural rules beyond that are not worth
           being wrong about in a dozen languages. */
        if (text.includes(` ${word}s `)) return icon;
      }
    }
  }
  return '';
}

/**
 * What to actually draw for an item.
 *
 * The order is the one the sale grid already uses, extended: a photograph
 * beats everything, then what the shop chose, then what the name suggests.
 * Nothing is not a failure - it is the honest answer for "Item 4".
 *
 * @param {{image?: string, icon?: string, name?: string}} item
 * @returns {string} an emoji, or '' when a photo will be shown or nothing fits
 */
function iconFor(item) {
  if (!item) return '';
  /* A photograph is better than any of this, and drawing both is clutter. */
  if (item.image) return '';
  const chosen = clean(item.icon);
  if (chosen) return chosen;
  return guess(item.name);
}

/**
 * A value somebody typed or pasted, made safe to store and to render.
 *
 * Length-capped by CHARACTER rather than by UTF-16 unit: every emoji worth
 * having is a surrogate pair, and slicing one in half leaves a broken glyph
 * on every card that dish appears on. Letters and digits are refused outright
 * so this field cannot quietly become a second name.
 */
function clean(value) {
  const text = String(value == null ? '' : value).trim();
  if (!text) return '';
  if (/[a-zA-Z0-9]/.test(text)) return '';
  return Array.from(text).slice(0, MAX_ICON_LENGTH).join('');
}

/**
 * A palette for the picker, so a shop is not asked to find an emoji keyboard.
 *
 * The shop's own guesses are the first thing offered elsewhere; this is the
 * fallback grid, and it is deliberately food-first and short. A thousand-emoji
 * picker is a worse experience than twelve good ones plus the phone's own
 * keyboard for the rest.
 */
const PALETTE = [
  '🍛',
  '🍚',
  '🍜',
  '🍲',
  '🥘',
  '🍝',
  '🍕',
  '🍔',
  '🌯',
  '🥪',
  '🌮',
  '🥙',
  '🍗',
  '🍖',
  '🥩',
  '🍤',
  '🐟',
  '🦀',
  '🥚',
  '🧀',
  '🍄',
  '🥔',
  '🌽',
  '🥬',
  '🥞',
  '🫓',
  '🍞',
  '🥐',
  '🍟',
  '🍢',
  '🥟',
  '🍩',
  '🥗',
  '🫘',
  '🥣',
  '🍽️',
  '☕',
  '🍵',
  '🥤',
  '🧃',
  '🥛',
  '🧋',
  '💧',
  '🍺',
  '🍷',
  '🍸',
  '🧉',
  '🍹',
  '🍨',
  '🍰',
  '🍪',
  '🍫',
  '🍬',
  '🍮',
  '🍿',
  '🍯',
  '🧁',
  '🥧',
  '🍓',
  '🥭',
  '🧼',
  '🧴',
  '🧻',
  '🪥',
  '🔋',
  '💡',
  '🖊️',
  '📒',
  '🛍️',
  '🧂',
  '🌾',
  '💊',
];

module.exports = { guess, iconFor, clean, fold, PALETTE, MAX_ICON_LENGTH, TIERS };
