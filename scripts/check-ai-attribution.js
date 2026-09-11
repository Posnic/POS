#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const AI_IDENTITY = String.raw`(?:claude|anthropic|chatgpt|openai|codex|(?:github\s+)?copilot|(?:ai|llm)[ -]?(?:assistant|agent|bot|model|tool))`;
const RULES = [
  {
    name: 'AI identity in a contribution trailer',
    pattern: new RegExp(
      String.raw`^\s*(?:co-authored-by|signed-off-by|authored-by|committed-by|reviewed-by|acked-by|credit(?:s)?)[^\n]*${AI_IDENTITY}`,
      'i'
    ),
  },
  {
    name: 'AI identity in contributor metadata',
    pattern: new RegExp(
      String.raw`^\s*(?:author|contributor|co-author|reviewer|maintainer|credit)\s*[:=-][^\n]*${AI_IDENTITY}`,
      'i'
    ),
  },
  {
    name: 'AI-generated attribution footer',
    pattern: new RegExp(
      String.raw`^\s*(?:generated|created|written|authored|implemented|coded|made)\s+(?:with|by)\s+[^\n]*${AI_IDENTITY}`,
      'i'
    ),
  },
  {
    name: 'AI tool attribution link',
    pattern: /(?:claude\.ai\/code|anthropic\.com\/claude|chatgpt\.com|openai\.com\/chatgpt)/i,
  },
];

const SKIPPED_PATHS = [
  /(^|\/)node_modules\//,
  /(^|\/)(?:dist|coverage|vendor)\//,
  /(^|\/)package-lock\.json$/,
  /\.min\.(?:js|css)$/,
];

function runGit(args, options = {}) {
  return execFileSync('git', args, {
    cwd: options.cwd || process.cwd(),
    encoding: options.encoding === null ? null : 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function shouldSkipPath(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  return SKIPPED_PATHS.some((pattern) => pattern.test(normalized));
}

function scanText(text, source) {
  const findings = [];
  String(text).split(/\r?\n/).forEach((line, index) => {
    for (const rule of RULES) {
      if (rule.pattern.test(line)) {
        findings.push({ source, line: index + 1, rule: rule.name, text: line.trim() });
        break;
      }
    }
  });
  return findings;
}

function scanBuffer(buffer, source) {
  if (!buffer || buffer.length > 2 * 1024 * 1024 || buffer.includes(0)) return [];
  return scanText(buffer.toString('utf8'), source);
}

function scanTrackedFiles() {
  const files = runGit(['ls-files', '-z'], { encoding: null })
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
  return files.flatMap((file) => {
    if (shouldSkipPath(file)) return [];
    try {
      return scanBuffer(fs.readFileSync(path.resolve(file)), file);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  });
}

function scanStagedFiles() {
  const files = runGit(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], { encoding: null })
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
  return files.flatMap((file) => {
    if (shouldSkipPath(file)) return [];
    try {
      return scanBuffer(runGit(['show', `:${file}`], { encoding: null }), file);
    } catch (_error) {
      return [];
    }
  });
}

function commitRange() {
  if (process.env.GITHUB_BASE_REF) return [`origin/${process.env.GITHUB_BASE_REF}..HEAD`];
  const before = process.env.GITHUB_EVENT_BEFORE;
  if (before && !/^0+$/.test(before)) return [`${before}..HEAD`];
  try {
    const upstream = runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']).trim();
    return [`${upstream}..HEAD`];
  } catch (_error) {
    return ['HEAD'];
  }
}

function scanCommitMessages() {
  const output = runGit(['log', ...commitRange(), '--format=%H%x1f%B%x1e']);
  return output.split('\x1e').flatMap((entry) => {
    if (!entry.trim()) return [];
    const [hash, ...message] = entry.split('\x1f');
    return scanText(message.join('\x1f'), `commit ${hash.trim()}`);
  });
}

function report(findings) {
  if (!findings.length) return;
  console.error('\nAI ATTRIBUTION GUARD: refusing this change.');
  console.error('Posnic credits the human contributor, not software tools. Remove tool attribution and signatures.\n');
  findings.forEach((finding) => {
    console.error(`${finding.source}:${finding.line}: ${finding.rule}`);
    console.error(`  ${finding.text.slice(0, 240)}`);
  });
  console.error('');
}

function main(argv) {
  const findings = [];
  const messageIndex = argv.indexOf('--message-file');
  if (messageIndex !== -1) {
    const messageFile = argv[messageIndex + 1];
    if (!messageFile) throw new Error('--message-file requires a path');
    findings.push(...scanText(fs.readFileSync(messageFile, 'utf8'), 'commit message'));
  }
  if (argv.includes('--staged')) findings.push(...scanStagedFiles());
  if (argv.includes('--all')) findings.push(...scanTrackedFiles());
  if (argv.includes('--commits')) findings.push(...scanCommitMessages());
  if (!argv.length) findings.push(...scanStagedFiles());

  report(findings);
  process.exitCode = findings.length ? 1 : 0;
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { scanText, scanBuffer, shouldSkipPath };
