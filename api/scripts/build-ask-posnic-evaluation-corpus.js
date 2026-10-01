'use strict';

// Read the sibling manual's exported chapter data. This writes test evidence
// only; it never publishes knowledge or modifies the manual/Intranet database.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const source = path.resolve(__dirname, '../../../web-frontend/tools/generate-posnic-manual.js');
const destination = path.resolve(__dirname, '../tests/fixtures/ask-posnic-knowledge-sources.json');
const { chapters } = require(source);
const lines = (value) => !value ? [] : (Array.isArray(value) ? value : [value]).map((row) => typeof row === 'string' ? row : [row.title, row.copy].filter(Boolean).join(': '));
const documents = chapters.map((chapter) => {
  const content = [chapter.title, `Menu path: ${chapter.menuPath || 'See the instructions below.'}`, chapter.summary,
    ...(chapter.sections || []).flatMap((section) => [
      `## ${section.heading}`, ...lines(section.body), ...lines(section.steps), ...lines(section.bullets),
      ...(section.table ? [section.table.headers.join(' | '), ...section.table.rows.map((row) => row.join(' | '))] : []),
    ]),
  ].filter(Boolean).join('\n\n');
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  return { _id: chapter.slug, title: chapter.title, kind: 'markdown', revision: hash.slice(0, 16), content, source_url: `https://www.posnic.com/guides/posnic-pos-complete-user-guide/${chapter.slug}/`, sha256: hash };
});
if (!documents.length || new Set(documents.map((doc) => doc._id)).size !== documents.length) throw new Error('The manual contains missing or duplicate chapter IDs.');
fs.writeFileSync(destination, JSON.stringify({ purpose: 'Evaluation snapshot; not published knowledge', source: 'web-frontend/tools/generate-posnic-manual.js', documents }, null, 2) + '\n');
console.log(`Saved ${documents.length} manual chapters to ${destination}`);
