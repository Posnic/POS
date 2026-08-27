/*
 * The owner's common-sense stock contract, sales side (2026-08-27):
 * "user editing received item 4 to 10 the 6 should be added ... if product
 * line item is returned we need to increase stock back with stock log."
 *
 * The purchases side learned this the hard way (the update path re-added
 * full quantities on every save - see receiving.model.test.js). The sales
 * side was already delta-based; these pins make sure it STAYS that way.
 * The full behaviour matrix is proven live by the browser audit
 * (sales-stock-audit.js): -2 on sale, -3 on 2->5, +4 on 5->1, nothing on an
 * unchanged re-save, full give-back on a removed line, +1 on a return.
 */
const fs = require('fs');
const path = require('path');

const serviceSrc = fs.readFileSync(
  path.join(__dirname, '../../../src/services/sale.service.js'),
  'utf8'
);
const repoSrc = fs.readFileSync(
  path.join(__dirname, '../../../src/repositories/sale.repository.js'),
  'utf8'
);

describe('sales stock moves on transitions (source contract)', () => {
  test('an edit compares against the stored quantities, not the payload alone', () => {
    expect(serviceSrc).toMatch(/oldQty = oldItemsData\[itemIdStr\]\.quantity/);
    expect(serviceSrc).toMatch(/itemQuantity > oldQty/);
    expect(serviceSrc).toMatch(/itemQuantity < oldQty/);
  });

  test('a line removed from the sale gives its whole stock back', () => {
    const block = serviceSrc.slice(
      serviceSrc.indexOf('// Cancelled Items (Remaining in oldItemsData)')
    );
    expect(block.slice(0, 700)).toMatch(/process: 'cancel'/);
  });

  test('the edit applies signed deltas to stock, both directions logged', () => {
    const editBlock = serviceSrc.slice(
      serviceSrc.indexOf('for (const change of changes_items)'),
      serviceSrc.indexOf("process: 'Edit Sale'")
    );
    /* more sold -> stock down; fewer sold -> stock back */
    expect(editBlock).toMatch(/updateStock\(doc\._id, -qtyChange\)/);
    expect(editBlock).toMatch(/updateStock\(doc\._id, qtyChange\)/);
    /* and the movement is written to the register with its sign */
    expect(serviceSrc).toMatch(/process: 'Edit Sale'/);
    expect(editBlock).toMatch(/count = `-\$\{qtyChange\}`/);
    expect(editBlock).toMatch(/count = `\+\$\{qtyChange\}`/);
  });

  test('a return increases stock and leaves a Return Sale log', () => {
    const ret = repoSrc.slice(repoSrc.indexOf("process: 'Return Sale'") - 2000);
    expect(ret).toMatch(/closingBalance = openingBalance \+ itemQty/);
    expect(ret.slice(0, 4000)).toMatch(/process: 'Return Sale'/);
    expect(ret.slice(0, 4000)).toMatch(/action: 'Add'/);
    /* only tracked items move, same gate as every other door */
    expect(ret).toMatch(/track_inventory === true \|\| itemDoc\.track_inventory === 'true'/);
  });

  test('quantities move even when detailed logging is off - only the LOG is optional', () => {
    /* the branch stock_management flag gates createStockLog, never updateStock */
    const addBlock = serviceSrc.slice(
      serviceSrc.indexOf('// Update Stock & Logs'),
      serviceSrc.indexOf("process: 'Add Sale'")
    );
    expect(addBlock).toMatch(
      /if \(!reservation\) await itemRepository\.updateStock\(doc\._id, -qty\)/
    );
    expect(addBlock).toMatch(/if \(context\.stockManagement\)/);
  });
});
