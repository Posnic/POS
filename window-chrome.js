'use strict';
/*
 * What colour the window frame should be, for a given theme.
 *
 * The title bar is drawn by Windows, not by the page, so it cannot inherit
 * anything. Left alone it stays white while the till is dark - which does not
 * read as a dark application, it reads as a light one wearing a skin, and it is
 * the first thing anybody notices about a screen they sit in front of all day.
 *
 * The bar takes the app's own top bar colour so the two read as one surface.
 * The window controls are the interesting part: they are icons drawn by the
 * operating system on top of that colour, and a shop is free to choose a theme
 * where the obvious choice is unreadable. So the choice is checked rather than
 * assumed - see chromeFor.
 *
 * Its own file so the arithmetic can be tested. main.js cannot be required
 * outside Electron, and contrast is not something to eyeball.
 */

/* Used before a theme is known - first launch, or an unreadable saved value. */
const CHROME_FALLBACK = Object.freeze({
  color: '#ffffff',
  symbolColor: '#5b6b82',
  background: '#f5f6fa',
});

const HEX = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i;

function isHex(value) {
  return HEX.test(String(value || '').trim());
}

function normalise(value) {
  const v = String(value).trim();
  return v.startsWith('#') ? v.toLowerCase() : '#' + v.toLowerCase();
}

/*
 * Relative luminance, WCAG 2.1.
 *
 * Not the average of the channels and not HSL lightness: the eye is far more
 * sensitive to green than to blue, and a formula that ignores that calls
 * #0000ff light enough to put black text on.
 */
function luminance(hex) {
  const m = HEX.exec(String(hex || '').trim());
  if (!m) return null;
  const channel = (pair) => {
    const c = parseInt(pair, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(m[1]) + 0.7152 * channel(m[2]) + 0.0722 * channel(m[3]);
}

/* Contrast ratio between two colours: 1 (identical) to 21 (black on white). */
function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return 0;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/*
 * Minimise, maximise and close are icons rather than text, so WCAG 2.1's
 * non-text contrast minimum applies: 3:1 against what is behind them.
 */
const MIN_ICON_CONTRAST = 3;

/*
 * Colours for the frame, given the theme the page is wearing.
 *
 * The shop's own text colour is preferred for the controls, because matching
 * the application looks deliberate in a way that a generic grey does not. It is
 * only kept if it clears 3:1 against the bar; failing that the choice is
 * near-white or near-black by which the background can actually carry, and
 * failing even that - a mid-grey bar can defeat both - pure white or black,
 * which always clears it. Close is the one control nobody should have to hunt
 * for on a busy counter.
 */
function chromeFor(theme = {}) {
  const bar = isHex(theme.topbarBg) ? normalise(theme.topbarBg) : CHROME_FALLBACK.color;

  /*
   * Whichever of two candidates the background actually carries better.
   *
   * Not "is the bar dark, therefore white". A mid-grey bar is the case that
   * breaks that rule: #999999 has a luminance of 0.32, which any threshold
   * calls dark, and white on it reaches only 2.85:1 while black reaches 7.4:1.
   * Deciding by measurement instead of by a threshold costs one more
   * calculation and has no such gap.
   */
  const better = (a, b) => (contrast(bar, a) >= contrast(bar, b) ? a : b);

  const preferred = isHex(theme.textPrimary) ? normalise(theme.textPrimary) : null;
  let symbol = preferred;

  if (!symbol || contrast(bar, symbol) < MIN_ICON_CONTRAST) {
    // Softened greys first: pure black and white on a coloured bar look like
    // an unstyled window, which is the thing being fixed.
    symbol = better('#e8ecf5', '#3a4657');
  }
  if (contrast(bar, symbol) < MIN_ICON_CONTRAST) {
    // Pure black or white always clears 3:1 against any colour, because at
    // most one of them can be close to it.
    symbol = better('#ffffff', '#000000');
  }

  return {
    color: bar,
    symbolColor: symbol,
    /*
     * The window's own paint - the flash between Windows creating the window
     * and the page drawing into it. It matches the page background rather than
     * the bar, because that is the larger area and the one the eye settles on.
     */
    background: isHex(theme.bodyBg) ? normalise(theme.bodyBg) : bar,
  };
}

module.exports = { chromeFor, luminance, contrast, isHex, CHROME_FALLBACK, MIN_ICON_CONTRAST };
