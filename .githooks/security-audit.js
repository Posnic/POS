#!/usr/bin/env node
'use strict';
/*
 * Pre-commit security audit.
 *
 * Scans exactly what is being committed - the staged diff, nothing else - and
 * refuses the commit when it finds the mistakes that have actually burned this
 * project: a hardcoded AWS key shipped in a config file and found by an
 * outside scanner first; env-var fallbacks that quietly become the live secret
 * the day the variable goes missing; credential files; and committed session
 * state (a WhatsApp .wwebjs_auth directory went into a repository once).
 *
 * For a line the audit is wrong about, append  audit:allow  in a comment on
 * that same line. To bypass the whole hook, commit with --no-verify. Both
 * choices stay visible in the diff, which is the point: overriding the audit
 * is allowed, doing it invisibly is not.
 *
 * Installed per clone with:  git config core.hooksPath .githooks
 */

const { execSync } = require('child_process');

function git(args) {
  return execSync(`git ${args}`, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/*
 * Whole files that must never be committed, whatever they contain. The .env
 * matcher deliberately lets .env.example through: the example file is the
 * documented interface, the real one is the live configuration.
 */
const BLOCKED_FILES = [
  /* Matches .env, .env.production and shop-style names like kiranastore.env -
     the per-tenant server files - while letting .env.example through. */
  [/(^|\/)(\.env(\.(?!example$)[A-Za-z0-9_.-]+)?|[^/]+\.env)$/, 'a .env file is live configuration, not source'],
  [/\.(pem|p12|pfx|keystore|jks)$/i, 'a key or certificate store belongs in a secret manager'],
  [/(^|\/)id_(rsa|ed25519|ecdsa|dsa)$/, 'an SSH private key must never be committed'],
  [/(^|\/)\.wwebjs_auth(\/|$)/, 'a WhatsApp session is a credential; it has been committed before'],
];

/*
 * Content rules, applied to added lines only - deleting a leaked secret must
 * never be blocked by the tool that exists to stop leaks.
 */
const RULES = [
  {
    name: 'AWS access key id',
    re: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    name: 'private key material',
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  },
  {
    name: 'connection string with a password in it',
    re: /\b(mongodb(\+srv)?|mysql|postgres(ql)?|redis|amqp):\/\/[^\s'"@/]+:[^\s'"@/]+@/,
  },
  {
    /*
     * The exact shape of the JWT_SECRET bug: a fallback for a secret-named
     * variable. Any non-empty default is wrong - when the env var goes
     * missing in production the fallback IS the secret, it is in the public
     * history, and everything looks healthy. Secrets throw at boot; they do
     * not default.
     */
    name: 'env fallback for a secret',
    re: /process\.env\.[A-Z0-9_]*(SECRET|TOKEN|KEY|PASS|PWD)[A-Z0-9_]*\s*\|\|\s*['"`][^'"`]+['"`]/,
  },
  {
    name: 'hardcoded credential assignment',
    re: /\b(api[_-]?key|secret|token|password|passwd|auth[_-]?key)\b\s*[:=]\s*['"`][A-Za-z0-9+/_.=-]{16,}['"`]/i,
    /* Test fixtures use fake secrets legitimately; the targeted rules above
       still apply to tests, only this broad one stands down. */
    skipTests: true,
    allowValue: /example|placeholder|changeme|your[-_]|dummy|fake|xxxx|\$\{|process\.env|<[a-z]/i,
  },
];

const SKIP_PATHS = /(^|\/)(vendor|node_modules)(\/|$)|\.min\.(js|css)$|(^|\/)package-lock\.json$/;
const TEST_PATHS = /(^|\/)(tests?|__tests__)(\/|$)|\.(test|spec)\.[a-z]+$/;

const findings = [];

/* --- rule 1: files that are wrong by name alone --------------------------- */
const staged = git('diff --cached --name-only --diff-filter=ACMR -z')
  .split('\0')
  .filter(Boolean);
for (const file of staged) {
  for (const [re, why] of BLOCKED_FILES) {
    if (re.test(file)) findings.push({ file, line: '-', name: 'blocked file', text: why });
  }
}

/* --- rule 2: what the added lines say ------------------------------------- */
let file = '';
let lineNo = 0;
for (const raw of git('diff --cached -U0 --no-color').split('\n')) {
  if (raw.startsWith('+++ b/')) { file = raw.slice(6); continue; }
  if (raw.startsWith('@@')) {
    const m = /\+(\d+)/.exec(raw);
    lineNo = m ? Number(m[1]) - 1 : 0;
    continue;
  }
  if (!raw.startsWith('+') || raw.startsWith('+++')) continue;
  lineNo++;
  const line = raw.slice(1);
  if (SKIP_PATHS.test(file)) continue;
  if (/audit:allow/.test(line)) continue;
  for (const rule of RULES) {
    if (rule.skipTests && TEST_PATHS.test(file)) continue;
    const m = rule.re.exec(line);
    if (!m) continue;
    if (rule.allowValue && rule.allowValue.test(line)) continue;
    findings.push({ file, line: lineNo, name: rule.name, text: line.trim().slice(0, 120) });
  }
}

if (findings.length) {
  console.error('\nSECURITY AUDIT: refusing this commit.\n');
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  [${f.name}]`);
    console.error(`    ${f.text}\n`);
  }
  console.error(
    'If a line is a false positive, append  audit:allow  in a comment on it.\n' +
      'If you are certain about the whole commit: git commit --no-verify\n'
  );
  process.exit(1);
}
process.exit(0);
