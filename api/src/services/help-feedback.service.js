const pkg = require('../../package.json');
const demoMode = require('../config/demo-mode');

// Support is an explicit user submission, never a replicated business record.
// Keep the destination fixed: callers cannot supply a mail recipient or URL.
const SUPPORT_URL = 'https://www.posnic.com/api/support';
const CATEGORIES = new Set(['help', 'feedback', 'complaint', 'suggestion', 'other']);
const clean = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

function context(req) {
  const user = req.user || {};
  const tenant = req.tenantContext || {};
  return {
    name: clean(user.name || user.username, 120),
    email: clean(user.email, 254),
    branch: clean(tenant.branchName, 160),
    account: clean(String(tenant.licenseId || ''), 100),
    version: pkg.version,
    demo: demoMode.isDemoMode(),
  };
}

function payload(req) {
  const body = req.body || {};
  if (body.website) throw new Error('Could not send your message.');
  const email = clean(body.email, 255);
  const comment = clean(body.comment, 7001);
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Enter a valid reply email address.');
  }
  if (!CATEGORIES.has(body.category)) throw new Error('Choose a type.');
  if (!comment || comment.length > 7000)
    throw new Error('Enter a comment of up to 7,000 characters.');
  const details = context(req);
  return {
    name: clean(body.name, 120),
    email,
    kind: body.category,
    subject: `Posnic ${body.category}: ${comment.replace(/[\r\n]+/g, ' ').slice(0, 100)}`,
    // The existing central mailer prints detail and app version. Include the
    // shop context here as well so it reaches the inbox, not only storage.
    detail: [
      details.branch ? `Shop / branch: ${details.branch}` : '',
      details.account ? `Account: ${details.account}` : '',
      `Version: ${details.version}`,
      '',
      comment,
    ]
      .filter((line) => line !== '')
      .join('\n'),
    system: {
      app: details.version,
      branch: details.branch,
      account: details.account,
    },
  };
}

async function submit(req, fetchImpl = fetch) {
  if (demoMode.isDemoMode()) {
    return { status: 403, message: demoMode.DEMO_BLOCKED_MESSAGE };
  }
  const data = payload(req);
  const response = await fetchImpl(SUPPORT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(20000),
    redirect: 'error',
  });
  const result = await response.json().catch(() => ({}));
  if (response.status === 429) {
    return { status: 429, message: 'Please wait a minute before sending another message.' };
  }
  if (!response.ok || result.ok !== true || !/^[A-Z0-9-]{1,32}$/i.test(result.reference || '')) {
    return {
      status: 502,
      message: 'Could not send your message. Your comment is kept; please retry.',
    };
  }
  // A reference proves central storage, not delivery to an email inbox.
  return { status: 200, reference: result.reference };
}

module.exports = { context, payload, submit, SUPPORT_URL };
