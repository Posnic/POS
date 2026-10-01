'use strict';

const { PDFParse } = require('pdf-parse');

const MAX_EXTRACTED_CHARS = 200000;

function normalize(text) {
  return String(text || '').replace(/\0/g, '').replace(/\r\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim().slice(0, MAX_EXTRACTED_CHARS);
}

async function extract(file) {
  if (!file?.buffer?.length) throw new Error('Choose a document to upload.');
  const mime = String(file.mimetype || '').toLowerCase();
  if (mime === 'application/pdf') {
    if (file.buffer.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('The uploaded file is not a valid PDF.');
    const parser = new PDFParse({ data: file.buffer });
    try {
      const result = await parser.getText();
      const content = normalize(result.text);
      if (!content) throw new Error('No text could be extracted from this PDF. Scanned PDFs need OCR before publishing.');
      return { content, kind: 'pdf', pages: Number(result.total || 0) };
    } finally {
      await parser.destroy();
    }
  }
  if (['text/plain', 'text/markdown', 'text/x-markdown', 'application/octet-stream'].includes(mime)) {
    const content = normalize(file.buffer.toString('utf8'));
    if (!content) throw new Error('The uploaded document is empty.');
    return { content, kind: /markdown|\.md$/i.test(`${mime} ${file.originalname || ''}`) ? 'markdown' : 'faq', pages: null };
  }
  throw new Error('Only PDF, Markdown, and text files are supported.');
}

module.exports = { extract, normalize, MAX_EXTRACTED_CHARS };
