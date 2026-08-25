'use strict';

/*
 * One layout for every email the product sends.
 *
 * Owner: "Every email we send need common header and footer with company
 * details standard logo and etc. if white label we need white label's company
 * name... need proper design and proper email template to send quotes or
 * bills or other stuff. not just unprofessional few text."
 *
 * The rules this file enforces:
 *  - HEADER: the brand (white-label name when configured, else Posnic) and
 *    the shop's own name. The logo renders only when the shop has a real
 *    https image - mail clients block most images anyway, so the design
 *    stands WITHOUT them and the logo is an upgrade, never a dependency.
 *  - FOOTER: the shop's company details (address, phone, email) and the
 *    sending brand. "Powered by Posnic" appears only when NOT white-labelled.
 *  - BODY: table-based, 600px, inline styles only - the dialect every mail
 *    client from Outlook down actually renders. No external CSS, no fonts,
 *    no scripts.
 *  - Every dynamic value is HTML-escaped HERE, so no caller can forget.
 */

const esc = (v) =>
  String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/*
 * Who this mail is FROM, in the eyes of the reader.
 *
 * White-label resolution order: the branch's own configuration first, the
 * instance environment second, Posnic last. A white-labelled send never
 * mentions Posnic anywhere in the mail.
 */
const brandFor = (branch) => {
  const b = branch || {};
  const whiteLabelName = String(b.white_label_name || process.env.WHITE_LABEL_NAME || '').trim();
  const logoCandidate = String(b.branch_image_url || b.branch_image || '');
  return {
    name: whiteLabelName || 'Posnic',
    whiteLabel: !!whiteLabelName,
    shopName: String(b.branch_name || '').trim(),
    logoUrl: /^https:\/\//i.test(logoCandidate) ? logoCandidate : '',
    address: String(b.store_address || b.address || '').trim(),
    phone: String(b.store_telephone || '').trim(),
    email: String(b.store_email || '').trim(),
  };
};

/* label/value rows for the summary block of a document mail. */
const kvRows = (pairs) =>
  (pairs || [])
    .filter((p) => p && String(p[1] == null ? '' : p[1]).trim() !== '')
    .map(
      (p) =>
        '<tr>' +
        `<td style="padding:6px 14px 6px 0;color:#69758c;font-size:13px;white-space:nowrap;vertical-align:top;">${esc(p[0])}</td>` +
        `<td style="padding:6px 0;color:#1b2740;font-size:13px;font-weight:600;">${esc(p[1])}</td>` +
        '</tr>'
    )
    .join('');

const kvBlock = (pairs) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${kvRows(pairs)}</table>`;

/*
 * A line-items table for quotes, bills and purchase orders.
 * lines: [{ name, qty, price, total }], amounts already formatted upstream
 * or numeric (formatted here with the currency when numeric).
 */
const itemsTable = (lines, currency) => {
  const cur = esc(currency || '');
  const money = (v) =>
    typeof v === 'number' ? `${cur} ${v.toFixed(2)}` : esc(v == null ? '' : v);
  const rows = (lines || [])
    .map(
      (l) =>
        '<tr>' +
        `<td style="padding:8px 10px;border-bottom:1px solid #edf0f5;font-size:13px;color:#1b2740;">${esc(l.name)}</td>` +
        `<td style="padding:8px 10px;border-bottom:1px solid #edf0f5;font-size:13px;color:#1b2740;text-align:center;">${esc(l.qty)}</td>` +
        `<td style="padding:8px 10px;border-bottom:1px solid #edf0f5;font-size:13px;color:#1b2740;text-align:right;">${money(l.price)}</td>` +
        `<td style="padding:8px 10px;border-bottom:1px solid #edf0f5;font-size:13px;color:#1b2740;text-align:right;font-weight:600;">${money(l.total)}</td>` +
        '</tr>'
    )
    .join('');
  const th = (label, align) =>
    `<th style="padding:8px 10px;background:#f4f6fb;font-size:11.5px;letter-spacing:.4px;text-transform:uppercase;color:#69758c;text-align:${align};border-bottom:1px solid #e2e7f0;">${label}</th>`;
  return (
    '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin:6px 0 2px;">' +
    `<tr>${th('Item', 'left')}${th('Qty', 'center')}${th('Price', 'right')}${th('Amount', 'right')}</tr>` +
    rows +
    '</table>'
  );
};

/* The one line under the items: what is owed. */
const totalRow = (label, value, currency) => {
  const cur = esc(currency || '');
  const v = typeof value === 'number' ? `${cur} ${value.toFixed(2)}` : esc(value);
  return (
    '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">' +
    '<tr>' +
    `<td style="padding:10px;text-align:right;font-size:13px;color:#69758c;">${esc(label)}</td>` +
    `<td style="padding:10px 10px 10px 0;text-align:right;font-size:16px;font-weight:700;color:#1b2740;white-space:nowrap;">${v}</td>` +
    '</tr></table>'
  );
};

/*
 * The frame. `bodyHtml` is trusted layout built by the helpers above (or by
 * the caller from escaped pieces); every scalar option is escaped here.
 */
const renderEmail = ({ brand, title, preheader, greeting, bodyHtml, footerNote }) => {
  const b = brand || brandFor(null);
  const headerName = b.shopName || b.name;
  const logo = b.logoUrl
    ? `<img src="${esc(b.logoUrl)}" alt="${esc(headerName)}" height="34" style="height:34px;max-width:160px;border:0;display:block;" />`
    : `<div style="font-size:19px;font-weight:700;color:#ffffff;letter-spacing:.2px;">${esc(headerName)}</div>`;
  const contactBits = [b.address, b.phone, b.email].filter(Boolean).map(esc).join(' &nbsp;·&nbsp; ');
  const powered = b.whiteLabel
    ? `Sent by ${esc(b.name)}`
    : `Sent by ${esc(b.shopName || 'your shop')} &nbsp;·&nbsp; Powered by Posnic`;

  return (
    '<!doctype html><html><body style="margin:0;padding:0;background:#eef1f6;">' +
    (preheader
      ? `<div style="display:none;max-height:0;overflow:hidden;">${esc(preheader)}</div>`
      : '') +
    '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#eef1f6;padding:24px 0;"><tr><td align="center">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" width="600" style="width:600px;max-width:94%;border-collapse:collapse;">' +
    // header
    '<tr><td style="background:#2f4172;border-radius:10px 10px 0 0;padding:18px 24px;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>' +
    `<td>${logo}</td>` +
    (b.logoUrl && b.shopName
      ? `<td align="right" style="color:#c9d4ef;font-size:13px;">${esc(b.shopName)}</td>`
      : '') +
    '</tr></table></td></tr>' +
    // body card
    '<tr><td style="background:#ffffff;padding:26px 24px;font-family:Arial,Helvetica,sans-serif;">' +
    (title
      ? `<div style="font-size:17px;font-weight:700;color:#1b2740;margin:0 0 4px;">${esc(title)}</div>`
      : '') +
    (greeting
      ? `<p style="margin:0 0 14px;font-size:13.5px;color:#3a4459;">${esc(greeting)}</p>`
      : '') +
    (bodyHtml || '') +
    '</td></tr>' +
    // footer
    '<tr><td style="background:#f7f8fb;border-radius:0 0 10px 10px;padding:16px 24px;font-family:Arial,Helvetica,sans-serif;border-top:1px solid #e7ebf2;">' +
    (contactBits
      ? `<div style="font-size:12px;color:#69758c;line-height:1.6;">${contactBits}</div>`
      : '') +
    (footerNote
      ? `<div style="font-size:12px;color:#69758c;margin-top:6px;">${esc(footerNote)}</div>`
      : '') +
    `<div style="font-size:11.5px;color:#9aa4b8;margin-top:8px;">${powered}</div>` +
    '</td></tr>' +
    '</table></td></tr></table></body></html>'
  );
};

/* The one call-to-action a mail carries: a bulletproof button (a link that
   still works when button styling is stripped). */
const ctaButton = (label, url) =>
  '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0 6px;"><tr>' +
  `<td style="background:#2f6bde;border-radius:8px;">` +
  `<a href="${esc(url)}" style="display:inline-block;padding:11px 22px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;">${esc(label)}</a>` +
  '</td></tr></table>';

module.exports = { brandFor, renderEmail, kvBlock, itemsTable, totalRow, ctaButton, esc };
