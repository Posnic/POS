'use strict';

const { parsePdf, MAX_FILE_BYTES } = require('./knowledge-pdf-parser');

const MAX_EXTRACTED_CHARS = 200000;

function normalize(text) {
  const content = String(text || '').replace(/\0/g, '').replace(/\r\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
  if (content.length > MAX_EXTRACTED_CHARS) throw new Error('Split this document into smaller sources (maximum 200,000 characters).');
  return content;
}

async function extract(file) {
  if (!file?.buffer?.length) throw new Error('Choose a document to upload.');
  if (file.buffer.length > MAX_FILE_BYTES) throw new Error('Choose a document smaller than 10 MB.');
  const mime = String(file.mimetype || '').toLowerCase();
  if (mime === 'application/pdf') {
    if (file.buffer.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('The uploaded file is not a valid PDF.');
    const result = await parsePdf(file.buffer);
    const content = normalize(result.text);
    if (!content) throw new Error('No text could be extracted from this PDF. Scanned PDFs need OCR before publishing.');
    return { content, kind: 'pdf', pages: result.pages, page_map: require('./knowledge-page-map').validate(content, result.page_map) };
  }
  if (['text/plain', 'text/markdown', 'text/x-markdown', 'application/octet-stream'].includes(mime)) {
    const content = normalize(file.buffer.toString('utf8'));
    if (!content) throw new Error('The uploaded document is empty.');
    return { content, kind: /markdown|\.md$/i.test(`${mime} ${file.originalname || ''}`) ? 'markdown' : 'faq', pages: null };
  }
  throw new Error('Only PDF, Markdown, and text files are supported.');
}

module.exports = { extract, normalize, MAX_EXTRACTED_CHARS };
