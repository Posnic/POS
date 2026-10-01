'use strict';

// The CLI may still hold valid temporary role credentials after its source SSO
// token expires. Use its supported process-format export only in memory for the
// isolated smoke child. Never print credentials or write a credential file.
const { execFileSync, spawnSync } = require('node:child_process');
const path = require('node:path');
try {
  const profile = process.env.AWS_PROFILE || 'posnic-admin';
  const identity = JSON.parse(execFileSync('aws', ['sts', 'get-caller-identity', '--profile', profile, '--output', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }));
  if (identity.Account !== '719443252592') throw new Error('Wrong account');
  const credentials = JSON.parse(execFileSync('aws', ['configure', 'export-credentials', '--profile', profile, '--format', 'process'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }));
  if (!credentials.AccessKeyId || !credentials.SecretAccessKey || !credentials.SessionToken || new Date(credentials.Expiration) <= new Date()) throw new Error('Temporary credentials are unavailable');
  const env = { ...process.env, AWS_ACCESS_KEY_ID: credentials.AccessKeyId, AWS_SECRET_ACCESS_KEY: credentials.SecretAccessKey, AWS_SESSION_TOKEN: credentials.SessionToken, POSNIC_MANAGED_AI_AWS_PROFILE: '' };
  delete env.AWS_PROFILE;
  const conditions = process.argv.includes('--conditions');
  const answers = process.argv.includes('--answers') || conditions;
  const result = spawnSync(process.execPath, [path.join(__dirname, answers ? 'evaluate-ask-posnic-answers.js' : 'ask-posnic-smoke.js'), '--live', ...(conditions ? ['--conditions'] : []), ...(!answers && process.argv.includes('--semantic') ? ['--semantic'] : [])], { env, stdio: 'inherit', timeout: answers ? 3600000 : 180000 });
  delete env.AWS_ACCESS_KEY_ID; delete env.AWS_SECRET_ACCESS_KEY; delete env.AWS_SESSION_TOKEN;
  for (const key of Object.keys(credentials)) delete credentials[key];
  process.exitCode = result.status ?? 1;
} catch (_error) {
  console.error('Valid temporary posnic-admin role credentials are required. Refresh AWS SSO if the CLI session has expired.');
  process.exitCode = 1;
}
