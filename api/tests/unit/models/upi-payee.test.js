'use strict';
/*
 * The UPI payee a shop configures.
 *
 * A wrong address sends a customer's money to a stranger or nowhere, and
 * neither shows up until somebody complains - so it is checked when it is
 * typed, not when it is used.
 */
const fs = require('fs');
const path = require('path');

const SOURCE = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'src', 'models', 'setting.model.js'),
  'utf8'
);

/** The address check as the model runs it, lifted out of the source. */
function upiPattern() {
  const found = SOURCE.match(/!(\/\^\[A-Za-z0-9[^\n]*?\/)\.test\(upi\)/);
  expect(found).not.toBeNull();
   
  return eval(found[1]);
}

describe('the UPI payee a shop configures', () => {
  test('an address that looks like one is kept; anything else is refused', () => {
    const re = upiPattern();
    for (const good of ['azure@okaxis', '9843012345@okbizaxis', 'a.shop-name_1@ybl', 'x1@upi']) {
      expect(re.test(good)).toBe(true);
    }
    for (const bad of [
      'azure',
      '@okaxis',
      'azure@',
      'azure@@okaxis',
      'true',
      'azure okaxis@ybl',
      'azure@ok axis',
      'azure@1bank',
      'a'.repeat(70) + '@ybl',
    ]) {
      expect(re.test(bad)).toBe(false);
    }
  });

  test('the payee is written as text, never through the switch loop', () => {
    /* Boolean('name@bank') is true, so a text field going through the
       checkbox loop would store "true" in the field a customer pays into. */
    const at = SOURCE.indexOf("const allowedFields = ['payment_cod'");
    const upiAt = SOURCE.indexOf('payment_upi_id !== undefined');
    expect(at).toBeGreaterThan(-1);
    expect(upiAt).toBeGreaterThan(at);
    expect(SOURCE).toContain("updateData['online_ordering.payment_upi_id'] = upi;");
    expect(SOURCE).not.toMatch(/allowedFields = \[[^\]]*payment_upi_id/);
  });

  test('a shop that never set one still has the field, so sync cannot delete it', () => {
    const config = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'src', 'utils', 'online-ordering.js'),
      'utf8'
    );
    expect(config).toContain("payment_upi_id: ''");
    expect(config).toContain("payment_upi_name: ''");
  });
});
