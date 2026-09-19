'use strict';

/*
 * THE PICTURE UNDER THE TOTAL.
 *
 * Owner: "instead of saying visit website user can upload qr code image,
 * asking customer to scan for online store... we take the url example and
 * https://campoalpinialmenno.it/merch.html, we convert as image. not
 * everytime but until its get changed."
 *
 * So a shop types a web address and gets a QR, rather than being asked to go
 * and make one. It is generated HERE, once, when the address changes, and
 * stored on the branch as a data URL - the same field an uploaded image lands
 * in, so everything downstream has one thing to print and does not care which
 * way it arrived.
 *
 * NOT ON EVERY SAVE. A settings page is saved for a hundred unrelated reasons
 * and re-encoding a QR each time would be work nobody asked for, on a record
 * every till reads. The stored address is compared with the new one and the
 * picture is left alone when they match.
 */

const QR_SIZE = 384;
const MAX_STORED = 400000;

/*
 * 384 dots is 48mm at 203dpi, and the receipt caps a footer image at exactly
 * that, so the QR prints ONE DOT PER PIXEL with no resampling. That is the
 * whole reason to fix the size here rather than let the printer scale: a QR
 * shrunk by a fraction has modules that land between dots, and a scanner
 * reading a smeared module is a customer who tries twice and gives up.
 *
 * Margin 2 is the quiet zone. Below 2 some readers refuse to see the code at
 * all, and it costs 2mm of paper.
 */
const OPTIONS = {
  width: QR_SIZE,
  margin: 2,
  errorCorrectionLevel: 'M',
  color: { dark: '#000000ff', light: '#ffffffff' },
};

const isDataUrl = (v) => typeof v === 'string' && v.startsWith('data:image/');

/**
 * What to write for the footer picture, or null to leave it exactly as it is.
 *
 * Returning null rather than the current value matters: this runs inside a
 * settings save that touches fifty other fields, and a save that did not
 * mention the picture must not rewrite it.
 */
async function resolveFooterImage(data = {}, current = {}) {
  const mentioned = data.footer_qr_url !== undefined || data.footer_image !== undefined;
  if (!mentioned) return null;

  const wanted = String(data.footer_qr_url || '').trim();
  const had = String(current.footer_qr_url || '').trim();

  /*
   * An uploaded picture wins and clears the address. A shop that has drawn its
   * own poster does not want it replaced by a QR on the next save, and keeping
   * both would mean deciding which one prints - a question with no good
   * answer.
   */
  if (!wanted && isDataUrl(data.footer_image)) {
    return { footer_image: data.footer_image.slice(0, MAX_STORED), footer_qr_url: '' };
  }

  /* The settings form omits an unchanged image to avoid uploading it again.
     An empty address alone must not erase that saved picture. Only an
     explicitly empty image is the clear button. */
  if (!wanted && data.footer_image !== undefined && !data.footer_image) {
    return { footer_image: '', footer_qr_url: '' };
  }

  if (!wanted) return null;

  /* THE CACHE. Same address, and a picture already made from it. */
  if (wanted === had && isDataUrl(current.footer_image)) return null;

  try {
    const QRCode = require('qrcode');
    const png = await QRCode.toDataURL(wanted, OPTIONS);
    return { footer_image: String(png).slice(0, MAX_STORED), footer_qr_url: wanted };
  } catch (error) {
    /*
     * An address too long to encode, or a QR library that failed. The shop
     * keeps whatever it had rather than losing its picture over a typo, and
     * the address is not stored so the next save tries again.
     */
    console.warn('[settings] could not make a QR for that address:', error.message);
    return null;
  }
}

module.exports = { resolveFooterImage, QR_SIZE, OPTIONS };
