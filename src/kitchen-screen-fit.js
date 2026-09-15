'use strict';

/*
 * HOW BIG THE TEXT HAS TO BE, AND THEREFORE HOW MUCH FITS.
 *
 * A kitchen screen is read at a distance, by somebody moving, often glancing
 * sideways, through steam, with a knife in hand. Below a certain size the text
 * is not small, it is ABSENT - and a screen showing twenty orders nobody can
 * read is worse than one showing six, because it looks like it is working.
 *
 * WHY THIS IS A MODULE AND NOT A STYLESHEET
 *
 * Owner: "around 5 meter." The doc this came from was worked out at 2.5m, and
 * five metres is not "a bit further away", it is a different machine:
 *
 *     distance    font      fits on a 43" 1080p
 *     2.5 m       ~45 px    about 12 orders
 *     5.0 m       ~84 px    about 2
 *
 * Legibility depends on how large a letter is ON THE EYE, so doubling the
 * distance doubles the letter height - and that costs area in BOTH directions.
 * Double the distance, quarter the orders. That is the single most surprising
 * thing about these screens and the reason this is computed rather than
 * guessed at by whoever writes the CSS.
 *
 * So the shop tells us the distance and the screen size, and this says what
 * actually fits. If the answer is two orders, it says two orders - before
 * anybody mounts a television.
 *
 * Owner: "make everthing configurable pleaes... dont make everthing fixed."
 * Every number below has a default and every default can be overridden.
 *
 * THE OPTICS, in one place so they can be argued with
 *
 * Comfortable reading is around 16 minutes of arc; glanceable text across a
 * room wants 20 to 30. This is the same basis as ISO 9241-303 for electronic
 * visual displays and the signage rule of roughly one inch of letter height per
 * twenty feet of viewing distance.
 *
 *     cap height = 2 x distance x tan(angle / 2)
 *
 * Cap height, not font size: font size includes ascenders and descenders that
 * nobody reads a table number by. Sizing to the em box is how the first
 * strikethrough attempt came out two thirds too small.
 */

/* 20 arcmin: glanceable, not merely readable. Configurable - a shop with older
   staff or a steamier kitchen can raise it, at the cost of fitting less. */
const DEFAULT_TARGET_ARCMIN = 20;

/* Cap height as a fraction of font size. True for the humanist sans faces a
   screen like this should use; varies by a few percent between families. */
const CAP_RATIO = 0.7;

/* Line height as a multiple of font size. Tight, because vertical space is the
   scarce resource and these are short lines, not prose. */
const LINE_HEIGHT = 1.25;

/* Average advance width as a fraction of font size, for a mixed-case name.
   Used to decide how wide a card must be. */
const CHAR_WIDTH = 0.52;

/* Televisions crop 2 to 5 percent of every edge by default, so a card at the
   edge loses its border and the bottom row loses its last line. */
const DEFAULT_SAFE_AREA = 0.03;

/* The longest dish name that must fit on one line before wrapping. */
const DEFAULT_NAME_CHARS = 16;

/* Lines in a full card: table number, up to three dishes, age. */
const DEFAULT_CARD_LINES = 6;
/* And in a compact one: table number and item count. */
const COMPACT_CARD_LINES = 2;

const MM_PER_INCH = 25.4;

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * The physical height of a screen, from its diagonal and its pixel aspect.
 *
 * Electron reports a display's size in DIPs and its scale factor. It does NOT
 * report physical size - nothing does, reliably - so the diagonal is asked for
 * rather than detected. Aspect comes from the real resolution, so an ultrawide
 * or a rotated portrait panel is measured correctly instead of being assumed
 * to be 16:9.
 */
function panelMm({ diagonalInches, widthPx, heightPx }) {
  const diag = num(diagonalInches, 43);
  const w = num(widthPx, 1920);
  const h = num(heightPx, 1080);
  const ratio = Math.sqrt(w * w + h * h);
  return {
    widthMm: (diag * MM_PER_INCH * w) / ratio,
    heightMm: (diag * MM_PER_INCH * h) / ratio,
  };
}

/**
 * What fits, given a screen and a distance.
 *
 * Everything is returned rather than only the answer, because the setup screen
 * shows the working: a shop that is told "2 orders" will ask why, and "your
 * text has to be 29mm tall at 5 metres" is an answer somebody can act on.
 */
function fit(options = {}) {
  const {
    diagonalInches = 43,
    widthPx = 1920,
    heightPx = 1080,
    distanceM = 2.5,
    targetArcmin = DEFAULT_TARGET_ARCMIN,
    safeArea = DEFAULT_SAFE_AREA,
    nameChars = DEFAULT_NAME_CHARS,
    cardLines = DEFAULT_CARD_LINES,
    compact = false,
  } = options;

  const distanceMm = num(distanceM, 2.5) * 1000;
  const arcmin = num(targetArcmin, DEFAULT_TARGET_ARCMIN);
  const lines = compact ? COMPACT_CARD_LINES : num(cardLines, DEFAULT_CARD_LINES);

  /* Half the visual angle, in radians. */
  const halfAngle = (arcmin / 2 / 60) * (Math.PI / 180);
  const capHeightMm = 2 * distanceMm * Math.tan(halfAngle);

  const panel = panelMm({ diagonalInches, widthPx, heightPx });
  const pixelPitchMm = panel.heightMm / num(heightPx, 1080);

  const capHeightPx = capHeightMm / pixelPitchMm;
  const fontPx = Math.round(capHeightPx / CAP_RATIO);
  const lineHeightPx = Math.round(fontPx * LINE_HEIGHT);

  /* The safe area is taken off both edges of both axes. */
  const usableW = num(widthPx, 1920) * (1 - 2 * num(safeArea, DEFAULT_SAFE_AREA));
  const usableH = num(heightPx, 1080) * (1 - 2 * num(safeArea, DEFAULT_SAFE_AREA));

  const cardW = Math.round(fontPx * CHAR_WIDTH * num(nameChars, DEFAULT_NAME_CHARS));
  const cardH = lineHeightPx * lines;

  const columns = Math.max(0, Math.floor(usableW / cardW));
  const rows = Math.max(0, Math.floor(usableH / cardH));
  const cards = columns * rows;

  return {
    capHeightMm: Math.round(capHeightMm * 10) / 10,
    fontPx,
    lineHeightPx,
    cardWidthPx: cardW,
    cardHeightPx: cardH,
    columns,
    rows,
    cards,
    verdict: verdictFor(cards),
  };
}

/*
 * Plain words for a number of cards.
 *
 * The thresholds are a judgement, not physics: a restaurant service rarely has
 * more than eight or ten tickets live at once, and below four the screen stops
 * being something a cook can work from and becomes a thing they walk to.
 */
function verdictFor(cards) {
  if (cards >= 8) return 'comfortable';
  if (cards >= 4) return 'tight';
  if (cards >= 1) return 'unusable';
  return 'impossible';
}

/**
 * What to do about a bad answer, in the order worth trying.
 *
 * Deliberately concrete. "Increase the font size" is not advice; "a 75 inch
 * screen at this distance, or move it to 3.1 metres" is something a shop can
 * act on this afternoon.
 */
function advice(options = {}) {
  const now = fit(options);
  if (now.verdict === 'comfortable') return [];

  const out = [];
  const target = 8;

  /*
   * Cards scale with (screen size / distance) squared, so the linear factor
   * needed is the square root of the shortfall. That is the whole reason a
   * small step closer helps so much more than people expect.
   */
  const factor = Math.sqrt(target / Math.max(1, now.cards));

  const closerM = Math.round((num(options.distanceM, 2.5) / factor) * 10) / 10;
  if (closerM >= 1.5) {
    out.push({
      kind: 'move-closer',
      distanceM: closerM,
      text: `Move the screen to about ${closerM} m and this screen shows ${target} orders.`,
    });
  }

  const biggerIn = Math.ceil(num(options.diagonalInches, 43) * factor);
  out.push({
    kind: 'bigger-screen',
    diagonalInches: biggerIn,
    text: `At this distance a ${biggerIn} inch screen shows ${target} orders.`,
  });

  const compact = fit({ ...options, compact: true });
  if (compact.cards > now.cards) {
    out.push({
      kind: 'compact-cards',
      cards: compact.cards,
      text:
        `Compact cards - table and item count only, same text size - show ` +
        `${compact.cards} instead of ${now.cards}. The cook walks over for the dishes.`,
    });
  }

  /*
   * Said because people reach for it first and it does nothing. A 4K panel of
   * the same physical size has the same letter height; the pixels are smaller,
   * and so is every letter drawn in them.
   */
  out.push({
    kind: 'not-resolution',
    text: 'A sharper screen does not help. Only physical size and distance change what fits.',
  });

  return out;
}

module.exports = {
  fit,
  advice,
  panelMm,
  verdictFor,
  DEFAULT_TARGET_ARCMIN,
  DEFAULT_SAFE_AREA,
  DEFAULT_NAME_CHARS,
  DEFAULT_CARD_LINES,
  COMPACT_CARD_LINES,
  CAP_RATIO,
  LINE_HEIGHT,
};
