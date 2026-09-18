'use strict';

/*
 * A QR THE CUSTOMER CAN SCAN.
 *
 * Owner: "instead of saying visit website user can upload qr code image,
 * asking customer to scan for online store... we take the url example and
 * https://campoalpinialmenno.it/merch.html, we convert as image. not everytime
 * but until its get changed."
 *
 * So the shop types a web address and gets a code, rather than being sent away
 * to make one. Three things have to be true and none of them is obvious:
 *
 *   it is made from the address, once
 *   a save that does not mention it leaves it alone - a settings page is saved
 *     for fifty unrelated reasons and this lives on a record every till reads
 *   an uploaded picture and an address cannot both win
 */

const { resolveFooterImage, QR_SIZE, OPTIONS } = require('../../src/helpers/footer-qr');

/*
 * Encoding a QR is real CPU work, and this suite runs 405 files in parallel.
 * At the 5s default one of these went red under load and green on its own,
 * which is the worst kind of test: nobody trusts the next failure either.
 */
jest.setTimeout(30000);

const URL_A = 'https://campoalpinialmenno.it/merch.html';
const URL_B = 'https://example.com/shop';

const isPng = (v) => typeof v === 'string' && v.startsWith('data:image/png;base64,');

describe('making one from an address', () => {
  it('turns the address into a picture', async () => {
    const made = await resolveFooterImage({ footer_qr_url: URL_A }, {});
    expect(isPng(made.footer_image)).toBe(true);
    expect(made.footer_qr_url).toBe(URL_A);
  });

  it('and remembers which address it was made from', async () => {
    /* Without this there is nothing to compare on the next save, and the only
       way to know whether to re-encode is to re-encode. */
    const made = await resolveFooterImage({ footer_qr_url: URL_A }, {});
    expect(made.footer_qr_url).toBe(URL_A);
  });

  it('trims what somebody pasted', async () => {
    const made = await resolveFooterImage({ footer_qr_url: '  ' + URL_A + '  ' }, {});
    expect(made.footer_qr_url).toBe(URL_A);
  });

  it('encodes different addresses differently, which is the whole point', async () => {
    const a = await resolveFooterImage({ footer_qr_url: URL_A }, {});
    const b = await resolveFooterImage({ footer_qr_url: URL_B }, {});
    expect(a.footer_image).not.toBe(b.footer_image);
  });
});

describe('NOT ON EVERY SAVE', () => {
  it('leaves the picture alone when the address has not changed', async () => {
    const made = await resolveFooterImage({ footer_qr_url: URL_A }, {});
    const again = await resolveFooterImage(
      { footer_qr_url: URL_A },
      { footer_qr_url: URL_A, footer_image: made.footer_image }
    );
    expect(again).toBeNull();
  });

  it('but does remake it when the address changes', async () => {
    const made = await resolveFooterImage({ footer_qr_url: URL_A }, {});
    const changed = await resolveFooterImage(
      { footer_qr_url: URL_B },
      { footer_qr_url: URL_A, footer_image: made.footer_image }
    );
    expect(changed).not.toBeNull();
    expect(changed.footer_qr_url).toBe(URL_B);
    expect(changed.footer_image).not.toBe(made.footer_image);
  });

  it('and remakes it if the address is stored but the picture is gone', async () => {
    /* A half-written record, or one restored from a backup that dropped the
       big field. The address is the source of truth, so it is rebuilt. */
    const healed = await resolveFooterImage({ footer_qr_url: URL_A }, { footer_qr_url: URL_A });
    expect(isPng(healed.footer_image)).toBe(true);
  });

  it('A SAVE THAT NEVER MENTIONS IT CHANGES NOTHING', async () => {
    /* The one that would be a customer-visible bug: every other settings save
       must not touch this. */
    const untouched = await resolveFooterImage(
      { branch_name: 'Something else' },
      {
        footer_qr_url: URL_A,
        footer_image: 'data:image/png;base64,AAAA',
      }
    );
    expect(untouched).toBeNull();
  });
});

describe('an uploaded picture', () => {
  it('is kept as it is', async () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    const made = await resolveFooterImage({ footer_image: png, footer_qr_url: '' }, {});
    expect(made.footer_image).toBe(png);
  });

  it('and clears the address, so only one of them can win', async () => {
    /* Keeping both would mean deciding which prints, and that question has no
       good answer a shop would guess correctly. */
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    const made = await resolveFooterImage(
      { footer_image: png, footer_qr_url: '' },
      { footer_qr_url: URL_A }
    );
    expect(made.footer_qr_url).toBe('');
  });

  it('and an address beats a picture that was not just chosen', async () => {
    const made = await resolveFooterImage(
      { footer_qr_url: URL_A, footer_image: '' },
      { footer_image: 'data:image/png;base64,AAAA' }
    );
    expect(made.footer_qr_url).toBe(URL_A);
    expect(isPng(made.footer_image)).toBe(true);
  });
});

describe('clearing it', () => {
  it('empties both, which is what the remove button sends', async () => {
    const cleared = await resolveFooterImage(
      { footer_qr_url: '', footer_image: '' },
      { footer_qr_url: URL_A, footer_image: 'data:image/png;base64,AAAA' }
    );
    expect(cleared).toEqual({ footer_image: '', footer_qr_url: '' });
  });
});

describe('what it refuses to break over', () => {
  it('an address too long to encode keeps the old picture', async () => {
    /* A QR has a capacity, and the shop losing the code it already had over a
       paste accident is worse than the paste being ignored. */
    const monstrous = 'https://example.com/' + 'x'.repeat(5000);
    const said = await resolveFooterImage(
      { footer_qr_url: monstrous },
      {
        footer_qr_url: URL_A,
        footer_image: 'data:image/png;base64,AAAA',
      }
    );
    expect(said).toBeNull();
  });

  it('and nothing here throws', async () => {
    for (const data of [
      {},
      { footer_qr_url: null },
      { footer_image: null },
      { footer_qr_url: {} },
    ]) {
      /* `.not.toThrow` without the parentheses is a property read, not an
         assertion - it passes on anything at all. Awaiting the promise and
         checking what came back is the version that can fail. */
      // eslint-disable-next-line no-await-in-loop
      const said = await resolveFooterImage(data, {});
      expect(said === null || typeof said === 'object').toBe(true);
    }
  });
});

describe('the size it is made at', () => {
  it('is the size it prints at, so nothing resamples it', () => {
    /*
     * 384 dots is 48mm at 203dpi and the receipt caps a footer picture at
     * exactly that, so the code prints one dot per pixel. A QR shrunk by a
     * fraction has modules landing between dots, and a scanner reading a
     * smeared module is a customer who tries twice and gives up.
     */
    expect(QR_SIZE).toBe(384);
    expect(OPTIONS.width).toBe(384);
  });

  it('and keeps a quiet zone, which some readers will not work without', () => {
    expect(OPTIONS.margin).toBeGreaterThanOrEqual(2);
  });
});
