'use strict';

// Shared with Intranet. Offsets bind to normalized text; page numbers are
// physical PDF pages, not the document's printed page labels.
const crypto = require('node:crypto');
const digest = (text) => crypto.createHash('sha256').update(text).digest('hex');
function validate(content, value) {
  if (value == null) return null;
  const invalid = () => {
    throw new Error(
      'PDF page information no longer matches the document. Re-upload the PDF or remove its page information.'
    );
  };
  if (
    !value ||
    typeof value !== 'object' ||
    value.content_sha256 !== digest(content) ||
    !Number.isSafeInteger(value.total) ||
    value.total < 1 ||
    value.total > 10000 ||
    !Array.isArray(value.spans) ||
    value.spans.length > value.total
  )
    return invalid();
  let previousPage = 0,
    previousEnd = 0;
  const spans = value.spans.map((span, index) => {
    if (
      !span ||
      !Number.isSafeInteger(span.page) ||
      span.page <= previousPage ||
      span.page > value.total ||
      !Number.isSafeInteger(span.start) ||
      !Number.isSafeInteger(span.end) ||
      span.start !== previousEnd + (index ? 2 : 0) ||
      span.end <= span.start ||
      span.end > content.length ||
      (index && content.slice(previousEnd, span.start) !== '\n\n')
    )
      return invalid();
    previousPage = span.page;
    previousEnd = span.end;
    return { page: span.page, start: span.start, end: span.end };
  });
  if (previousEnd !== content.length) return invalid();
  return { content_sha256: value.content_sha256, total: value.total, spans };
}
function fromPages(pages, total) {
  let content = '';
  const spans = [];
  for (const page of pages) {
    const text = String(page.text || '')
      .replace(/\0/g, '')
      .replace(/\r\n/g, '\n')
      .replace(/\n{4,}/g, '\n\n\n')
      .trim();
    if (!text) continue;
    if (content) content += '\n\n';
    const start = content.length;
    content += text;
    spans.push({ page: page.num, start, end: content.length });
  }
  return {
    content,
    page_map: validate(content, { content_sha256: digest(content), total, spans }),
  };
}
function forChunk(doc, index) {
  if (doc.kind !== 'pdf' || !Number.isInteger(index) || index < 0) return [];
  try {
    const map = validate(doc.content, doc.page_map);
    const lastChunk = Math.max(0, Math.ceil((doc.content.length - 1200) / 1020));
    if (!map || index > lastChunk) return [];
    const first = Math.max(0, index - 1),
      last = Math.min(index + 1, lastChunk);
    for (let i = first; i <= last; i++)
      if (doc.chunks && doc.chunks[i] !== doc.content.slice(i * 1020, i * 1020 + 1200)) return [];
    const start = first * 1020,
      end = Math.min(doc.content.length, last * 1020 + 1200);
    return map.spans
      .filter((span) => span.start < end && span.end > start)
      .map((span) => span.page);
  } catch (_error) {
    return [];
  }
}
module.exports = { validate, fromPages, forChunk };
