const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const puppeteer = require(path.join(root, 'api/node_modules/puppeteer'));
(async () => {
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setContent('<div id="panel"></div><div id="kot_add_item_modal" class="modal fade" tabindex="-1"><div class="modal-dialog"><div class="modal-content p-3"><input id="kot_item_search" class="form-control"><div id="kot_item_search_results"></div></div></div></div>');
    for (const file of ['frontend/static/script/js/jquery.min.js', 'frontend/static/script/js/jQuery-Autocomplete.min.js', 'frontend/static/script/js/bootstrap.min.js', 'api/src/helpers/billing-search.js']) await page.addScriptTag({ path: path.join(root, file) });
    await page.addStyleTag({ path: path.join(root, 'frontend/static/style/css/bootstrap.min.css') });
    await page.addStyleTag({ path: path.join(root, 'frontend/static/style/css/custom.css') });
    await page.evaluate(() => {
      const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="orange"/></svg>');
      const catalogue = [{ item_id: 'tea', item_name: 'Tea', image, selling_price: 50, tax: 5, tax_type: 'exclusive', track_inventory: false, short_code: 'TE', item_code: '001' },
        { item_id: 'cb', item_name: 'Chicken Biryani', image, selling_price: 200, track_inventory: false, short_code: 'CB' }];
      window.requests = []; window.savedItems = []; window.pendingLookups = [];
      window.PosnicPro = { kot: {}, sales: { _billingCatalogue: catalogue, _catalogueAt: Date.now() },
        local: { get: key => key === 'currencySign' ? '₹' : null }, i18n: { t: (_key, text) => text }, alert() {},
        escapeHtml: value => $('<i>').text(value).html(), resolveTile: () => ({ color: '#888' }),
        get(params, done, failed) {
          if (typeof params === 'string') return done({ type: 'success', data: { _id: 'order', items: window.savedItems } });
          if (typeof params.data === 'string' && params.data.includes('type=id')) {
            if (window.failItem) return failed();
            const id = new URLSearchParams(params.data).get('query');
            return done({ suggestions: catalogue.filter(row => row.item_id === id) });
          }
          window.pendingLookups.push({ done, query: params.data.query });
        },
        put(params, done) {
          const request = JSON.parse(params.data); window.requests.push(request);
          window.savedItems = request.items.map(item => ({ item_id: item.product_id, item_quantity: item.quantity, item_price: item.price }));
          done({ type: 'success' });
        }
      };
    });
    const sales = fs.readFileSync(path.join(root, 'frontend/static/script/js/modules/js/sales.js'), 'utf8');
    await page.addScriptTag({ content: sales.slice(sales.indexOf('PosnicPro.sugRow ='), sales.indexOf('PosnicPro.sugActionRow =')) });
    const kot = fs.readFileSync(path.join(root, 'frontend/static/script/js/modules/js/kot.js'), 'utf8');
    await page.addScriptTag({ content: kot.slice(0, kot.indexOf('\n};') + 3) });
    await page.evaluate(() => {
      $('#panel').html(PosnicPro.kot.buildTableDetailsPanel('4', [{ _id: 'order', items: [{ item_id: 'bread', item_name: 'Bread', item_quantity: 1, item_price: 20 }] }], 1));
      PosnicPro.kot.updateTotalDisplay = () => {};
      PosnicPro.kot.initModifyUpdateHandlers();
      $('.kot-modify-btn').trigger('click');
      $('#kot_add_item_modal').data('sale-id', 'order');
      PosnicPro.kot.initItemSearch();
    });
    async function choose(selector, query) {
      await page.focus(selector); await page.type(selector, query);
      await page.waitForFunction(() => $('.autocomplete-suggestions:visible .autocomplete-suggestion').length > 0);
      assert.ok(await page.$('.autocomplete-suggestion .sug-thumb'));
      const bounds = await page.evaluate(selector => {
        const input = document.querySelector(selector).getBoundingClientRect();
        const results = $('.autocomplete-suggestions:visible')[0].getBoundingClientRect();
        return { left: Math.abs(results.left - input.left), top: Math.abs(results.top - input.bottom) };
      }, selector);
      assert.ok(bounds.left < 2 && bounds.top < 2, 'Results must align directly below their search input');
      if (process.env.POSNIC_PICKER_PROOF_DIR) { fs.mkdirSync(process.env.POSNIC_PICKER_PROOF_DIR, {recursive:true}); await page.screenshot({path:path.join(process.env.POSNIC_PICKER_PROOF_DIR, selector === '#kot_item_search' ? 'add-search.png' : 'modify-search.png')}); }
      await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.activeElement.closest('.kot-search-quantity'));
    }
    await choose('.kot-product-search', 'Tea');
    await page.keyboard.type('2.5'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement.classList.contains('kot-product-search'));
    assert.equal(await page.$eval('[data-item-id=tea] .qty-input', input => input.value), '2.5');
    await choose('.kot-product-search', 'TE'); await page.keyboard.type('1.5'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement.classList.contains('kot-product-search'));
    assert.equal(await page.$eval('[data-item-id=tea] .qty-input', input => input.value), '4');
    await choose('.kot-product-search', 'CB'); await page.keyboard.press('Escape');
    assert.equal(await page.$$eval('.kot-item-qty-controls', rows => rows.length), 2);
    await page.evaluate(() => { window.orderSaves = 0; PosnicPro.kot.saveQuantityChanges = () => { window.orderSaves++; }; });
    await page.focus('.kot-product-search'); await page.keyboard.down('Control'); await page.keyboard.press('Enter'); await page.keyboard.up('Control');
    assert.equal(await page.evaluate(() => orderSaves), 1);
    await page.evaluate(() => new Promise(resolve => $('#kot_add_item_modal').one('shown.bs.modal', resolve).modal('show')));
    await choose('#kot_item_search', 'CB'); await page.keyboard.type('3'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement.id === 'kot_item_search');
    assert.equal(await page.evaluate(() => requests[0].items[0].quantity), 3);
    await choose('#kot_item_search', 'Tea'); await page.evaluate(() => { window.failItem = true; });
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement.closest('.kot-search-quantity') && !document.activeElement.disabled);
    assert.equal(await page.evaluate(() => requests.length), 1);
    await page.evaluate(() => { window.failItem = false; }); await page.keyboard.type('2'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement.id === 'kot_item_search');
    assert.deepEqual(await page.evaluate(() => requests[1].items.map(item => [item.product_id, item.quantity])), [['cb', 3], ['tea', 2]]);
    // Late responses must not replace the more recent query's results.
    await page.evaluate(() => { PosnicPro.sales._billingCatalogue = null; });
    await page.type('#kot_item_search', 'old'); await page.waitForFunction(() => pendingLookups.length > 0);
    await page.$eval('#kot_item_search', input => { input.value = 'new'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForFunction(() => pendingLookups.some(row => row.query === 'new'));
    await page.evaluate(() => {
      pendingLookups.find(row => row.query === 'new').done({ suggestions: [{ item_id: 'new', item_name: 'New result', image: 'item.svg' }] });
      pendingLookups.filter(row => row.query !== 'new').forEach(row => row.done({ suggestions: [{ item_id: 'old', item_name: 'Old result' }] }));
    });
    assert.equal(await page.$eval('.autocomplete-suggestions:not([style*="display: none"])', node => node.textContent.includes('Old result')), false);
    assert.deepEqual(errors, []);
    console.log('PASS: images, shared result rows, arrows/Enter, decimal quantities, repeat items, Escape, modal additions, failed-save retry and stale-response rejection.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
