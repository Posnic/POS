#!/usr/bin/env node
/*
 * Look for secrets in every blob this repository has ever contained.
 *
 * A working-tree grep is not the check that matters before going public. Git
 * keeps every version of every file that was ever committed, so a password
 * added in one commit and removed in the next is still there, still readable by
 * anyone who clones - and making the repository public publishes the whole
 * history at once, irreversibly. People fork and mirror within minutes.
 *
 * This walks the object database rather than the history: `git rev-list
 * --objects --all` lists every blob reachable from any branch, tag or stash, so
 * a secret on a deleted branch or in an amended commit is still found.
 *
 * The patterns are deliberately high-signal. A scanner that reports fifty
 * maybes gets skimmed and then ignored, which is worse than no scanner. Each
 * one either matches a credential with a known shape, or matches an assignment
 * whose value looks like entropy rather than a placeholder.
 */

const { execFileSync } = require('child_process');

/* Placeholders that legitimately appear in examples and documentation. A hit
   whose value is one of these is noise, and noise is what makes people stop
   reading scanner output. */
const PLACEHOLDER =
  /^(?:x{3,}|y{3,}|\*{3,}|\.{3,}|<[^>]*>|\$\{[^}]*\}|change[_-]?me|your[_-]?\w+|example|placeholder|redacted|dummy|sample|test|password|secret|null|undefined|true|false|localhost|127\.0\.0\.1|admin|root|user|none|todo|tbd|n\/?a|\d+)$/i;

/* Values that announce themselves as fabricated. A test needs a string shaped
   like a credential; saying so in the string is the convention, and flagging it
   trains people to ignore the scanner. */
const SELF_DECLARED_FAKE =
  /\b(?:fake|mock|dummy|stub|sample|example|placeholder|not[_-]?a[_-]?real|notreal|test(?:ing)?[_-]|[_-]test(?:ing)?\b|ci[_-]only|invalid|bogus|xxx+)/i;

/* A bcrypt or argon hash. It is the output of hashing a password, not a
   password - publishing one is not a credential leak. */
const HASH_SHAPED = /^\$(?:2[aby]|argon2[id]{1,2}|6|5)\$/;

/* Where fabricated credentials are expected to live. A finding here is still
   reported, but separately, because these files are supposed to contain
   secret-shaped strings and burying the real list under them is how a genuine
   leak gets missed. */
const FIXTURE_PATH =
  /(^|\/)(tests?|__tests__|__mocks__|spec|fixtures?|mocks?|examples?)\/|\.(test|spec)\.[jt]sx?$|\.example($|\.)|\.sample($|\.)/i;

/* Rules that are never downgraded, wherever they are found. A real private key
   committed into a test directory is still a real private key. */
const ALWAYS_SERIOUS = new Set([
  'private key block',
  'AWS access key id',
  'GitHub token',
  'Slack token',
  'npm token',
  'Stripe secret key',
  'a file that holds secrets was committed',
]);

const RULES = [
  {
    name: 'private key block',
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/,
  },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', re: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/ },
  { name: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Stripe secret key', re: /\bsk_live_[0-9A-Za-z]{16,}\b/ },
  { name: 'Razorpay live key', re: /\brzp_live_[0-9A-Za-z]{10,}\b/ },
  { name: 'npm token', re: /\bnpm_[A-Za-z0-9]{36}\b/ },
  {
    /* The one this project would actually leak. A URI with credentials in it -
       mongodb://user:password@host - is a working login wherever that host is
       reachable. */
    name: 'connection string with credentials',
    re: /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqp):\/\/[^\s:/@"']+:([^\s@"'<>{}]+)@/,
    valueGroup: 1,
  },
  {
    name: 'JSON web token',
    re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  },
  {
    /* An assignment whose value has the length and character mix of a real
       secret. Short values and dictionary words are left alone. */
    name: 'secret-shaped assignment',
    re: /\b(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|auth[_-]?token|access[_-]?key|private[_-]?key|client[_-]?secret|encryption[_-]?key)\b["']?\s*[:=]\s*["']([^"'\s]{12,})["']/i,
    valueGroup: 1,
  },
];

/* Files that are supposed to hold secrets. Their presence in history is the
   finding, whatever is inside them. */
const FORBIDDEN_PATHS =
  /(^|\/)(\.env(\.local|\.production|\.development)?|\.mongodb-credentials\.json|\.credential-key\.json|update-credentials\.json|id_rsa|id_ed25519|.*\.pfx|.*\.p12|.*\.pem|.*\.key)$/i;

/* Never flag inside these: minified bundles and lockfiles produce long
   high-entropy strings by construction, and a hash is not a secret. */
const SKIP_PATHS =
  /(^|\/)(node_modules|dist|build|coverage|\.git)\/|(\.min\.(js|css)|package-lock\.json|yarn\.lock|\.map|\.png|\.jpg|\.jpeg|\.gif|\.ico|\.woff2?|\.ttf|\.eot|\.pdf|\.zip|\.exe|\.dll|\.node)$/i;

function git(args, encoding = 'utf8') {
  return execFileSync('git', args, { encoding, maxBuffer: 1024 * 1024 * 512 });
}

function main() {
  /*
   * Every object in the database, with its type.
   *
   * --batch-all-objects rather than the reachable set: a secret committed and
   * then amended away leaves a dangling blob that no ref points at, and that
   * blob is still in the pack that a clone receives.
   *
   * The type has to come from git. `rev-list --objects` gives a path for trees
   * as well as blobs, so treating "line has a path" as "line is a blob" asks
   * git to read directories as files.
   */
  const types = git(['cat-file', '--batch-all-objects', '--batch-check=%(objectname) %(objecttype)']);
  const blobShas = new Set();
  for (const line of types.split('\n')) {
    const [sha, type] = line.split(' ');
    if (type === 'blob') blobShas.add(sha);
  }

  /* The names those blobs were stored under, for reporting. A dangling blob has
     no path; it is still scanned. */
  const listing = git(['rev-list', '--objects', '--all']);
  const blobs = new Map(); // sha -> set of paths it was ever stored at
  for (const sha of blobShas) blobs.set(sha, new Set());
  for (const line of listing.split('\n')) {
    const space = line.indexOf(' ');
    if (space === -1) continue;
    const sha = line.slice(0, space);
    if (blobs.has(sha)) blobs.get(sha).add(line.slice(space + 1));
  }

  console.log(`Scanning ${blobs.size} blobs across ${git(['rev-list', '--count', '--all']).trim()} commits.`);

  const findings = [];
  let scanned = 0;
  let skipped = 0;

  for (const [sha, paths] of blobs) {
    /* A dangling blob - left by an amend or a reset - has no name. It is the
       most interesting kind to scan, so it is not skipped for lacking one. */
    const pathList = paths.size ? [...paths] : ['(unreferenced blob)'];

    for (const p of pathList) {
      if (FORBIDDEN_PATHS.test(p)) {
        /* serious regardless of where it sits: the file's purpose is the
           finding. Without this flag it lands in the "expected fixtures"
           bucket, which is precisely how a committed .env gets overlooked. */
        findings.push({
          rule: 'a file that holds secrets was committed',
          sha,
          path: p,
          value: '',
          serious: true,
        });
      }
    }

    if (pathList.every((p) => SKIP_PATHS.test(p))) {
      skipped += 1;
      continue;
    }

    let content;
    try {
      const raw = git(['cat-file', 'blob', sha], 'buffer');
      /* A NUL byte in the first kilobyte means binary; there is nothing to
         match and decoding it wastes time. */
      if (raw.slice(0, 1024).includes(0)) {
        skipped += 1;
        continue;
      }
      content = raw.toString('utf8');
    } catch {
      skipped += 1;
      continue;
    }
    scanned += 1;

    for (const rule of RULES) {
      const m = content.match(rule.re);
      if (!m) continue;

      const value = rule.valueGroup ? m[rule.valueGroup] : '';
      if (value && (PLACEHOLDER.test(value) || HASH_SHAPED.test(value))) continue;

      /* The line it sits on, so a fake declared in the surrounding text -
         'not-a-real-key' assigned to apiKey - is recognised as one. */
      const line = content.slice(0, m.index).split('\n').length;
      const context = content.split('\n')[line - 1] || '';
      const declaredFake = SELF_DECLARED_FAKE.test(value) || SELF_DECLARED_FAKE.test(context);

      const serious =
        ALWAYS_SERIOUS.has(rule.name) ||
        (!declaredFake && !pathList.some((p) => FIXTURE_PATH.test(p)));

      findings.push({
        rule: rule.name,
        sha,
        path: pathList[0],
        line,
        serious,
        /* Show enough to recognise it, never enough to use it. */
        value: value ? `${value.slice(0, 4)}…${value.slice(-2)} (${value.length} chars)` : '',
      });
    }
  }

  console.log(`Read ${scanned} text blobs; skipped ${skipped} binary, vendored or generated.`);
  console.log('');

  const serious = findings.filter((f) => f.serious);
  const fixtures = findings.filter((f) => !f.serious);

  if (fixtures.length) {
    /* Listed, not hidden - but by file and count, because the detail on a
       fabricated value is what pushes the real list off the screen. */
    console.log(
      `${fixtures.length} secret-shaped string(s) in test fixtures and examples, which is expected:`
    );
    const byPath = new Map();
    for (const f of fixtures) byPath.set(f.path, (byPath.get(f.path) || 0) + 1);
    for (const [p, n] of [...byPath].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(n).padStart(3)}  ${p}`);
    }
    console.log('');
  }

  if (!serious.length) {
    console.log('No credentials found in any blob this repository has ever contained.');
    return 0;
  }

  console.log(`${serious.length} finding(s) that need a decision:`);
  console.log('');
  for (const f of serious) {
    console.log(`  ${f.rule}`);
    console.log(`    path : ${f.path}${f.line ? `:${f.line}` : ''}`);
    console.log(`    blob : ${f.sha}`);
    if (f.value) console.log(`    value: ${f.value}`);
    /* Which commits carried it, so the decision to rotate or rewrite can be
       made with the dates in front of you. */
    try {
      const commits = git(['log', '--all', '--format=%h %ad %s', '--date=short', '--', f.path])
        .trim()
        .split('\n')
        .slice(0, 3);
      if (commits[0]) console.log(`    seen : ${commits.join('\n           ')}`);
    } catch {
      /* the path may not exist on any current ref */
    }
    console.log('');
  }

  console.log('Every one of these must be rotated, not merely deleted. Making the');
  console.log('repository public publishes the whole history, and it cannot be recalled.');
  return 1;
}

process.exit(main());
