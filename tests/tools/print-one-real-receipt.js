'use strict';

/*
 * ONE RECEIPT, ON REAL PAPER.
 *
 * Everything else about this fix is decoded bytes and asserted columns. This
 * is the only test that a printer performs, and it runs the whole chain the
 * till runs: the shop's real branch document, the real seeded thermal
 * template, a real browser canvas rasterising the real logo, the real
 * receipt-data.js extractor, the real escpos-receipt.js renderer, and the real
 * hardware-manager spooling raw bytes through winspool.
 *
 * Nothing here is a copy of the app's code. If this prints correctly, the till
 * prints correctly, because it is the same code.
 *
 *   npm run dev                       (in another terminal - it serves the page)
 *   npx electron tests/tools/print-one-real-receipt.js --printer "POS-80C"
 *
 * --dry-run builds the bytes and writes them to a file without printing.
 */

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..', '..');
const SERVER = process.env.POSNIC_DEV_URL || 'http://localhost:3000';
const MONGO = process.env.POSNIC_MONGO_URI || 'mongodb://127.0.0.1:47017/PosnicPro';

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const at = argv.indexOf('--' + name);
  return at > -1 && argv[at + 1] ? argv[at + 1] : fallback;
};
const DRY = argv.includes('--dry-run');
const PRINTER = argOf('printer', 'POS-80C');

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

/**
 * The receipt, built in a real page exactly as printSale builds it.
 *
 * The template is the shop's own stored one, the classes filled here are the
 * classes sales_view.js fills, and the extractor reading them back is the
 * extractor the till uses.
 */
function pageScript(receiptData, template, branch, logoUrl) {
  return `(async () => {
    const branch = ${JSON.stringify(branch)};
    window.PosnicPro = {
      BRAND_URL: 'https://www.posnic.com',
      local: { get: (k) => (k === 'print_url' ? String(branch.print_url) : '') },
    };
    ${receiptData}

    const modal = document.createElement('div');
    modal.className = 'modal-body print-modal-body';
    modal.innerHTML = ${JSON.stringify(template)};
    document.body.appendChild(modal);

    const $ = window.jQuery;

    /* sales_view.js:1454 - the footer block and the logo block both ship
       display:none and are shown for a sale. */
    $('.hide-receiving-print').show();
    $('.branch_image').css('display', 'block');
    $('#printlogoimage img').attr('src', ${JSON.stringify(logoUrl)});

    /* settings.js, on every page load. */
    $('.footer-content').text(branch.footer_print || '');
    $('.print_store_name').text(branch.branch_name || '');
    $('.print_store_address').text(branch.store_address || '');
    $('.print_store_email').text(branch.store_email || '');

    /* sales_view.js, for this sale. */
    $('.print-custom-title').text('SALES RECEIPT');
    $('.print_view_id').text('#S-TEST-000001');
    $('.print_date').text(new Date().toLocaleString('en-GB'));
    $('.print-invoice-table-content').html(
      '<div class="row receipt-row-item-holder">' +
        '<div class="invoice-content-heading">Cartolina Campo Scuola</div>' +
        '<div class="item-qty">1 qty</div>' +
        '<div class="item-total">' + branch.currency + ' 8.00</div>' +
        '</div>' +
      '<div class="row receipt-row-item-holder">' +
        '<div class="invoice-content-heading">Spilla ricordo</div>' +
        '<div class="item-qty">2 qty</div>' +
        '<div class="item-total">' + branch.currency + ' 5.00</div>' +
        '</div>'
    );
    $('.print-subtotal').html(branch.currency + '&nbsp;<span class="number">13.00</span>');
    $('.total-noof-item').html('<span class="number">3.00</span>');

    const img = document.querySelector('.branch_image img');
    await new Promise((ok) => {
      if (img.complete && img.naturalWidth) return ok();
      img.onload = ok;
      img.onerror = ok;   /* no logo is not a reason to fail a receipt */
    });

    const sale = window.PosnicPro.receiptData($('.print-modal-body').html());
    sale.total = 13;
    sale.logo = window.PosnicPro.receiptLogo('80');
    return sale;
  })()`;
}

app.whenReady().then(async () => {
  /* ------------------------------------------------- the shop, as it is set up */
  const { MongoClient } = require(path.join(ROOT, 'api', 'node_modules', 'mongodb'));
  const client = await MongoClient.connect(MONGO);
  const branch = await client.db().collection('branches').findOne({});
  await client.close();
  if (!branch) {
    console.error('no branch in ' + MONGO);
    app.exit(1);
    return;
  }

  console.log('\nONE RECEIPT, ON REAL PAPER\n');
  console.log('  shop     : ' + branch.branch_name);
  console.log('  paper    : ' + (branch.print_width || '80') + 'mm, ' + branch.print_type);
  console.log('  currency : ' + branch.currency);
  console.log('  logo     : ' + branch.print_logoimg + '   brand URL: ' + branch.print_url);

  /* ------------------------------------------------------- built in a real page */
  const win = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, nodeIntegration: false, contextIsolation: true },
  });

  let sale;
  try {
    await win.loadURL(SERVER + '/login.html');
    /* jQuery, then the extractor, then the page work. */
    await win.webContents.executeJavaScript(
      read('node_modules', 'jquery', 'dist', 'jquery.js') +
        '; window.jQuery = window.$ = jQuery; "jquery ready";'
    );
    sale = await win.webContents.executeJavaScript(
      pageScript(
        read('frontend', 'static', 'script', 'js', 'core', 'receipt-data.js'),
        read('api', 'src', 'json', 'print_standard_html.txt'),
        branch,
        '/static/images/default/store.png'
      )
    );
  } catch (e) {
    console.error('\n  could not build the receipt: ' + e.message);
    console.error('  is the dev server up?  npm run dev\n');
    app.exit(1);
    return;
  }

  console.log('\n  read back out of the markup:');
  console.log('    currency : ' + JSON.stringify(sale.currency));
  console.log('    items    : ' + sale.items.length);
  console.log('    footer   : ' + JSON.stringify(sale.footer));
  console.log('    logo     : ' + (sale.logo && sale.logo.data
    ? sale.logo.width + ' x ' + sale.logo.height + ' dots'
    : JSON.stringify(sale.logo)));

  /* ------------------------------------------------------------- the real bytes */
  const { renderSale } = require(path.join(ROOT, 'src', 'escpos-receipt'));
  const bytes = renderSale(sale, {
    paperWidth: String(branch.print_width || '80'),
    cut: true,
  });
  console.log('\n  ' + bytes.length + ' bytes of ESC/POS');

  const out = path.join(ROOT, 'receipt-printed.bin');
  fs.writeFileSync(out, bytes);
  console.log('  written to ' + out);

  if (DRY) {
    console.log('\n  --dry-run: nothing sent to a printer\n');
    app.exit(0);
    return;
  }

  /* ------------------------------------------- through the app's own spooler */
  const { HardwareManager } = require(path.join(ROOT, 'src', 'hardware-manager'));
  const hardware = new HardwareManager();
  console.log('\n  sending to "' + PRINTER + '" ...');
  const said = await hardware.sendRawToPrinter(PRINTER, bytes, 'Posnic test receipt');

  console.log('  ' + JSON.stringify(said));
  console.log(said.success ? '\n  SENT - look at the paper\n' : '\n  NOT SENT\n');
  app.exit(said.success ? 0 : 1);
});
