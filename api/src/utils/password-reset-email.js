'use strict';

const { brandFor, renderEmail, ctaButton, esc } = require('./email-layout');

// The caller supplies the shop URL through publicPageUrl's trusted-host checks.
module.exports = function passwordResetEmail({ name, url }) {
  const parsed = new URL(url);
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Invalid reset URL');
  const brand = brandFor(null);
  const subject = `Reset your ${brand.name} password`;
  const greeting = name ? `Hi ${String(name).trim()},` : 'Hello,';
  const intro =
    'We received a request to reset your password. Use the button below to choose a new password.';
  const expiry = 'This link expires in 10 minutes.';
  const ignore =
    'If you did not request this, you can ignore this email. Your password will stay unchanged.';
  const html = renderEmail({
    brand,
    title: 'Reset your password',
    preheader: 'Choose a new password. Your reset link expires in 10 minutes.',
    greeting,
    bodyHtml:
      `<p style="font-size:15px;line-height:1.6;color:#3a4459;margin:16px 0;">${intro}</p>` +
      ctaButton('Reset password', url) +
      `<p style="font-size:13px;color:#69758c;margin:12px 0 24px;">${expiry}</p>` +
      `<p style="font-size:14px;line-height:1.6;color:#3a4459;">${ignore}</p>` +
      '<div style="border-top:1px solid #e7ebf2;margin-top:24px;padding-top:18px;">' +
      '<p style="font-size:12px;color:#69758c;margin:0 0 8px;">Button not working? Copy and paste this link into your browser:</p>' +
      `<a href="${esc(url)}" style="font-size:12px;line-height:1.6;color:#2f6bde;word-break:break-all;overflow-wrap:anywhere;">${esc(url)}</a></div>`,
    footerNote: 'Keep this link private. Never share your password or recovery codes.',
  }).replace(
    'width="600" style="width:600px;max-width:94%;',
    'width="100%" style="width:94%;max-width:600px;table-layout:fixed;'
  );
  return {
    subject,
    htmlContent: html,
    textContent: `${greeting}\n\n${intro}\n\nReset password: ${url}\n\n${expiry}\n\n${ignore}`,
  };
};
