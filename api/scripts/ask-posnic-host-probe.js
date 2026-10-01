'use strict';

// Run beside bedrock-provider.js in an isolated validation directory on the host.
// One synthetic paid request; no shop database, customer data or message delivery.
const assert = require('node:assert/strict');
const { ask } = require('./bedrock-provider');

async function main() {
  const result = await ask({ system: 'Reply with the requested exact phrase only.', prompt: 'Say exactly: Posnic runtime ready.', maxOutputTokens: 64 });
  assert.match(result.text, /Posnic runtime ready\./);
  assert.ok(result.tokensIn > 0 && result.tokensOut > 0);
  console.log(JSON.stringify({ result: 'PASS', model: result.model, text: result.text, tokens_in: result.tokensIn, tokens_out: result.tokensOut }));
}
main().catch((error) => { console.error(JSON.stringify({ result: 'FAIL', error: error.name || 'ProviderError' })); process.exitCode = 1; });
