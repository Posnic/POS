const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID } = require('node:crypto');
const requests = new AsyncLocalStorage();

// Keep the request reference: authentication populates it after this middleware.
// Never retain bodies, cookies, tokens, query strings or full user agents.
function middleware(req, res, next) {
  requests.run({ req, id: randomUUID() }, next);
}

// For authenticated webhook adapters/background jobs: call only from server
// code after verification. Never pass a request-body source into this API.
function withSource(source, callback) {
  if (!['webhook', 'scheduled_job', 'system'].includes(source)) {
    throw new Error('Unsupported item creation source');
  }
  return requests.run({ ...requests.getStore(), source, id: requests.getStore()?.id || randomUUID() }, callback);
}

function record(operation, context = {}, at = new Date()) {
  const current = requests.getStore();
  const req = current?.req;
  const user = req?.user || context.user || {};
  const ua = String(req?.get?.('user-agent') || '');
  const client = /Electron\//i.test(ua) ? 'desktop'
    : req?.captainSession ? 'captain_app'
      : /Mozilla\//i.test(ua) ? 'browser' : 'unknown';
  return {
    version: 1,
    operation,
    source: current?.source || (req?.isApiKey || req?.isScopedApiToken ? 'api' : req ? 'application' : 'internal'),
    recorded_at: at,
    actor_id: String(user._id || user.userId || context.loggedUserId || context.userId || ''),
    actor_name: user.username || user.email || user.name || context.loggedUserName || context.userName || 'System',
    authentication: req?.isApiKey ? 'api_key' : req?.isScopedApiToken ? 'integration_token' : req?.user ? 'authenticated' : 'internal',
    // Client software is a reported hint, not a security identity.
    client,
    client_evidence: req ? 'request_metadata' : 'not_available',
    endpoint: req ? String(req.originalUrl || req.path || '').split('?')[0].slice(0, 200) : '',
    request_id: current?.id || context.creationBatchId || randomUUID(),
    branch_id: String(context.branchId || ''),
  };
}

module.exports = { middleware, record, withSource, currentRequest: () => requests.getStore()?.req };
