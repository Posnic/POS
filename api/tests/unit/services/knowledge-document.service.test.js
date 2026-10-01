'use strict';

const PDFDocument = require('pdfkit');
const { spawnSync } = require('child_process');
const service = require('../../../src/services/knowledge-document.service');

function pdfBuffer(text) {
  return new Promise((resolve) => {
    const doc = new PDFDocument();
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    (Array.isArray(text) ? text : [text]).forEach((page, index) => { if (index) doc.addPage(); if (page) doc.text(page); });
    doc.end();
  });
}

describe('knowledge document extraction', () => {
  test('extracts Markdown as bounded UTF-8 text', async () => {
    const result = await service.extract({ buffer: Buffer.from('# Returns\nOpen Sales History.'), mimetype: 'text/markdown', originalname: 'returns.md' });
    expect(result.kind).toBe('markdown');
    expect(result.content).toContain('Sales History');
  });

  test('extracts text from a real PDF', async () => {
    const buffer = await pdfBuffer(['Connect the receipt printer from Print settings.', '', 'தமிழ் is a source label. Review returns on the third page.']);
    const script = "const s=require('./src/services/knowledge-document.service');s.extract({buffer:Buffer.from(process.argv[1],'base64'),mimetype:'application/pdf',originalname:'printer.pdf'}).then(r=>process.stdout.write(JSON.stringify(r))).catch(e=>{console.error(e);process.exit(1)})";
    const run = spawnSync(process.execPath, ['-e', script, buffer.toString('base64')], { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 1024 * 1024 });
    expect(run.status).toBe(0);
    const result = JSON.parse(run.stdout);
    expect(result.kind).toBe('pdf');
    expect(result.content).toContain('receipt printer');
    expect(result.pages).toBe(3);
    expect(result.page_map.spans.map(span => span.page)).toEqual([1, 3]);
    const third = result.page_map.spans[1];
    expect(result.content.slice(third.start, third.end)).toContain('returns on the third page');
  });

  test('rejects a forged PDF MIME type', async () => {
    await expect(service.extract({ buffer: Buffer.from('not a pdf'), mimetype: 'application/pdf' })).rejects.toThrow(/valid PDF/);
  });

  test('rejects oversized text without silently removing later instructions', async () => {
    await expect(service.extract({ buffer: Buffer.from('x'.repeat(200001)), mimetype: 'text/markdown' })).rejects.toThrow(/200,000/);
    expect(service.normalize('x'.repeat(200000))).toHaveLength(200000);
  });
});
