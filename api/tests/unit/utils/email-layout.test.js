'use strict';

/*
 * One layout for every mail (owner: "Every email we send need common header
 * and footer with company details standard logo and etc. if white label we
 * need white label's company name... not just unprofessional few text").
 */
const {
  brandFor,
  renderEmail,
  kvBlock,
  itemsTable,
  totalRow,
  ctaButton,
} = require('../../../src/utils/email-layout');

const BRANCH = {
  branch_name: 'Hi Hi Business',
  store_address: '12 Bazaar St, Chennai',
  store_telephone: '9445000000',
  store_email: 'shop@hihi.example',
};

describe('the frame every mail wears', () => {
  const html = renderEmail({
    brand: brandFor(BRANCH),
    title: 'Your receipt',
    preheader: 'Receipt S-1 - thank you',
    greeting: 'Dear Meera,',
    bodyHtml: kvBlock([['Receipt #', 'S-1']]),
    footerNote: 'Thank you for your business.',
  });

  test('header carries the shop, footer carries the company details', () => {
    expect(html).toContain('Hi Hi Business');
    expect(html).toContain('12 Bazaar St, Chennai');
    expect(html).toContain('9445000000');
    expect(html).toContain('shop@hihi.example');
  });

  test('a non-white-label mail says Powered by Posnic; a white-label one never mentions it', () => {
    expect(html).toContain('Powered by Posnic');

    const wl = renderEmail({
      brand: brandFor({ ...BRANCH, white_label_name: 'AcmePOS' }),
      title: 'x',
      bodyHtml: '<p>y</p>',
    });
    expect(wl).toContain('AcmePOS');
    expect(wl).not.toContain('Posnic');
  });

  test('every scalar is escaped - a crafted customer name cannot inject markup', () => {
    const evil = renderEmail({
      brand: brandFor({ branch_name: '<script>x</script>Shop' }),
      title: '<img onerror=1>',
      greeting: 'Dear <b>Bob</b>,',
      bodyHtml: '<p>safe</p>',
    });
    expect(evil).not.toContain('<script>');
    expect(evil).not.toContain('<img onerror');
    expect(evil).not.toContain('<b>Bob</b>');
  });

  test('the logo is an upgrade, never a dependency - and only ever https', () => {
    expect(brandFor({ branch_image: 'store.png' }).logoUrl).toBe('');
    expect(brandFor({ branch_image: 'http://plain.example/x.png' }).logoUrl).toBe('');
    expect(brandFor({ branch_image: 'https://cdn.example/x.png' }).logoUrl).toBe(
      'https://cdn.example/x.png'
    );
  });

  test('email-client dialect: tables and inline styles, no external anything', () => {
    expect(html).toContain('role="presentation"');
    expect(html).not.toMatch(/<link|<style|<script/);
  });
});

describe('the document pieces', () => {
  test('items render with amounts formatted in the shop currency', () => {
    const t = itemsTable([{ name: 'Cola 750ml', qty: 2, price: 39.9, total: 79.8 }], '₹');
    expect(t).toContain('Cola 750ml');
    expect(t).toContain('₹ 39.90');
    expect(t).toContain('₹ 79.80');
  });

  test('the total row and the CTA button carry their values escaped', () => {
    expect(totalRow('Total', 98.75, '₹')).toContain('₹ 98.75');
    const btn = ctaButton('Reset <b>now</b>', 'https://x.example/r?t=1&u=2');
    expect(btn).not.toContain('<b>now</b>');
    expect(btn).toContain('https://x.example/r?t=1&amp;u=2');
  });
});

describe('every sender wears the frame - the CI check', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (p) =>
    fs.readFileSync(path.join(__dirname, '../../../src', p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  test('receipt, invoice, purchase order, report and auth mails all render through the layout', () => {
    for (const [file, marker] of [
      ['controllers/sales.controller.js', 'renderEmail'],
      ['controllers/receivings.controller.js', 'renderEmail'],
      ['models/sale.model.js', 'renderEmail'],
      ['utils/email.js', 'renderEmail'],
    ]) {
      expect(read(file)).toContain(marker);
    }
    /* the bare-text bodies must not return */
    expect(read('controllers/sales.controller.js')).not.toContain('<h2>Sale Receipt</h2>');
    expect(read('controllers/sales.controller.js')).not.toContain('<h2>Invoice</h2>');
  });

  test('white-label from-address is honoured on the platform paths', () => {
    const email = read('utils/email.js');
    expect(email).toContain('white_label_from');
    expect(email).toContain('WHITE_LABEL_FROM');
  });
});
