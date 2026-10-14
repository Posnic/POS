'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const puppeteer = require('../../api/node_modules/puppeteer');
const root = path.resolve(__dirname, '../..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage(); const errors = [];
    const out = path.join(root, 'output/cashbook-attachments'); fs.mkdirSync(out, { recursive: true });
    const downloads = fs.mkdtempSync(path.join(out, 'download-'));
    await (await page.createCDPSession()).send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
    page.on('pageerror', error => errors.push(error.message));
    const form = read('frontend/modals/expense.html');
    const styles = ['bootstrap.min.css', 'style.css', 'theme-variables.css'].map(name => '<style>' + read('frontend/static/style/css/' + name) + '</style>').join('');
    await page.setContent(styles + form);
    await page.addScriptTag({ path: path.join(root, 'frontend/static/script/js/jquery.min.js') });
    await page.evaluate(() => {
      window.PosnicPro = { i18n: { t: (key, fallback) => fallback }, commonDate() {}, alert() {}, getFormData: () => ({ amount: 150, type: 'debit' }) };
      window.hasher = { setHash() {} };
      document.querySelector('#infobar-settings-sidebar-expense').classList.add('sidebarshow');
      document.querySelector('#expenses_date').value = '2026/10/14';
      document.querySelector('#expenses_amount').value = '150';
      document.querySelector('#expenses_type').value = 'debit';
      document.querySelector('#expenses_category').value = 'Transport';
      document.querySelector('#expenses_expensesnote').value = 'Delivery expense';
    });
    await page.addScriptTag({ path: path.join(root, 'frontend/static/script/js/modules/js/expenses.js') });
    const checks = await page.evaluate(async () => {
      const files = PosnicPro.expenseFiles; const result = {};
      const stream = 'BT /F1 16 Tf 30 100 Td (Receipt reference) Tj ET';
      const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 150] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream'];
      let pdf = '%PDF-1.4\n'; const offsets = [0];
      objects.forEach((object, i) => { offsets.push(pdf.length); pdf += (i + 1) + ' 0 obj\n' + object + '\nendobj\n'; });
      const xref = pdf.length;
      pdf += 'xref\n0 6\n0000000000 65535 f \n' + offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('') + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';
      const a = new File([pdf], 'Supplier receipt.pdf', { type: 'application/pdf' });
      window.proofPdf = a;
      const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='), c => c.charCodeAt(0));
      const b = new File([png], 'Delivery receipt.png', { type: 'image/png' });
      files.choose([a, b]); result.selected = files.pending.length;
      await files.open('', { pending: 1, name: b.name }, false, true);
      await new Promise(resolve => setTimeout(resolve, 30));
      result.previewWidth = document.querySelector('#expenses_files_preview img').naturalWidth;
      $('#expenses_files_preview').empty();
      await files.open('', { pending: 0, name: a.name }, true, true);
      let uploadCount = 0, expenseWrites = [], saved = [];
      PosnicPro.request = (params, success, failure) => {
        if (params.url === 'expenses' || params.method === 'PUT') {
          expenseWrites.push(params.method); return success({ type: 'success', data: { id: '012345678901234567890123' }, message: 'Saved' });
        }
        uploadCount++;
        if (uploadCount === 2) return failure({ responseJSON: { message: 'Connection interrupted' } });
        const meta = { id: 'file-' + uploadCount, name: params.data.get('file').name, size: 20, type: params.data.get('file').type };
        saved.push(meta); success({ type: 'success', data: meta });
      };
      PosnicPro.expenses.expensesTable = () => {};
      PosnicPro.expenses.expenses();
      await new Promise(resolve => setTimeout(resolve, 20));
      result.afterFailure = { id: $('#expenses_id').val(), pending: files.pending.length, existing: files.existing.length, saving: files.saving, message: $('#expenses_files_status').text() };
      PosnicPro.expenses.expenses();
      await new Promise(resolve => setTimeout(resolve, 20));
      result.methods = expenseWrites; result.uploads = uploadCount; result.pendingAfterRetry = files.pending.length;
      // Saving with no files makes no upload request.
      $('#expenses_amount').val('150');
      PosnicPro.expenses.expenses(); await new Promise(resolve => setTimeout(resolve, 20));
      result.uploadsWithoutFile = uploadCount;
      files.choose([new File(['not image'], 'bad.exe', { type: 'application/octet-stream' })]);
      result.invalidRejected = files.pending.length === 0;
      files.reset(); files.existing = saved;
      files.render('#expenses_files_list', saved, '012345678901234567890123', true);
      // Removal remains staged until Save, not an immediate server mutation.
      $('#expenses_files_list button').filter(function () { return this.textContent === 'Remove'; }).first().click();
      result.stagedRemoval = files.removed.length; result.uploadsAfterRemove = uploadCount;
      files.removed = []; files.render('#expenses_files_list', saved, '012345678901234567890123', true);
      return result;
    });
    assert.equal(checks.selected, 2);
    assert.equal(checks.previewWidth, 1);
    assert.equal(checks.afterFailure.id, '012345678901234567890123');
    assert.equal(checks.afterFailure.pending, 1); assert.equal(checks.afterFailure.existing, 1);
    assert.equal(checks.afterFailure.saving, false); assert.match(checks.afterFailure.message, /Entry saved/);
    assert.deepEqual(checks.methods.slice(0, 2), ['POST', 'PUT']);
    assert.equal(checks.pendingAfterRetry, 0); assert.equal(checks.uploads, 3);
    assert.equal(checks.uploadsWithoutFile, 3); assert.equal(checks.invalidRejected, true);
    assert.equal(checks.stagedRemoval, 1); assert.equal(checks.uploadsAfterRemove, 3);
    for (let attempt = 0; attempt < 30 && !fs.existsSync(path.join(downloads, 'Supplier receipt.pdf')); attempt++) await new Promise(resolve => setTimeout(resolve, 100));
    assert.match(fs.readFileSync(path.join(downloads, 'Supplier receipt.pdf'), 'utf8'), /^%PDF-1\.4/);
    await page.evaluate(() => {
      $('#infobar-settings-sidebar-expense').addClass('sidebarshow');
      $('#expenses_date').val('2026/10/14'); $('#expenses_amount').val('150');
      $('#expenses_type').val('debit'); $('#expenses_category').val('Transport');
      $('#expenses_expensesnote').val('Delivery expense');
    });
    await page.evaluate(async () => {
      PosnicPro.expenseFiles.pending = [window.proofPdf];
      await PosnicPro.expenseFiles.open('', { pending: 0, name: 'Supplier receipt.pdf' }, false, true);
      PosnicPro.expenseFiles.pending = [];
    });
    await page.waitForSelector('#expenses_files_preview iframe');
    await new Promise(resolve => setTimeout(resolve, 700));
    await page.$('#expenses_files_preview').then(element => element.screenshot({path:path.join(out,'pdf-preview.png')}));
    await page.evaluate(() => $('#expenses_files_preview').empty());
    for (const theme of ['light', 'dark']) for (const width of [1000, 390]) {
      await page.setViewport({ width, height: 1100 });
      await page.evaluate(theme => { document.documentElement.setAttribute('data-theme', theme); }, theme);
      await page.waitForFunction(() => document.querySelector('#expenses_choose_files').getBoundingClientRect().left >= 0 && document.querySelector('#expenses_choose_files').getBoundingClientRect().left < innerWidth);
      await page.screenshot({ path: path.join(out, theme + '-' + width + '.png'), fullPage: true });
      if (width === 1000) await page.$('.expense-supporting-files').then(element => element.screenshot({ path: path.join(out, theme + '-attachments.png') }));
    }
    assert.deepEqual(errors, []);
    console.log('PASS: optional save, two files, partial failure, retry without duplicate expense, rejected type, staged removal, light/dark desktop/mobile screenshots.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
