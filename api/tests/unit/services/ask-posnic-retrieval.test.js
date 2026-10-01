'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {
  rank,
  chunks,
  contextForChunk,
  excerptAnswer,
} = require('../../../src/services/ask-posnic-retrieval');

describe('Ask Posnic source retrieval', () => {
  test('neighbouring context restores a split permission rule without changing the indexed anchor', () => {
    const lead = 'Discount change | Manager approval';
    const content =
      'x'.repeat(1200 - lead.length) +
      lead +
      ' only when the cashier lacks direct discount authority.\n\nEnd.';
    const doc = { content, chunks: chunks(content) };
    expect(doc.chunks[0].endsWith(lead)).toBe(true);
    expect(contextForChunk(doc, 0)).toBe(content);
    expect(contextForChunk(doc, 1)).toBe(content);
    expect(contextForChunk(doc, -1)).toBe('');
    expect(
      contextForChunk(
        { chunks: ['First independent sentence.', 'Second independent sentence.'] },
        0
      )
    ).toContain('[Adjacent source passage]');
  });
  const docs = [
    {
      _id: 'register',
      title: 'Opening the register',
      content:
        'Open Cash Register and enter your opening float. Only one open session is allowed per register.',
      kind: 'markdown',
    },
    {
      _id: 'export',
      title: 'Export catalog',
      content: 'Open Items and choose Export to download the catalog.',
      kind: 'faq',
    },
    {
      _id: 'refund',
      title: 'Refunds',
      content: 'Open Sales History and choose Return. A manager approval PIN may be required.',
      kind: 'markdown',
    },
  ];
  test('exact FAQ bypass keeps the complete answer and citation', () => {
    expect(rank(docs, 'EXPORT catalog!')[0]).toMatchObject({
      document_id: 'export',
      exact: true,
      text: docs[1].content,
    });
  });
  test('matches workflow phrasing, inflection and discriminating terms', () => {
    expect(rank(docs, 'How do I open registers?')[0].document_id).toBe('register');
    expect(rank(docs, 'Where do I download the catalog?')[0].document_id).toBe('export');
    expect(rank(docs, 'manager approval PIN')[0].document_id).toBe('refund');
  });
  test('a common term cannot answer an otherwise unsupported question', () => {
    expect(rank(docs, 'Does Posnic forecast quantum demand using satellite weather?')).toEqual([]);
    expect(rank(docs, 'register cryptocurrency staking rewards')).toEqual([]);
  });
  test('a small shop FAQ corpus can retrieve title context as well as answer text', () => {
    const sources = [
      {
        _id: 'export',
        title: 'Archival export format',
        content: 'Archival export uses CSV files. The export contains catalog entries.',
        kind: 'faq',
      },
    ];
    expect(rank(sources, 'Which archival export format is supported?')[0].text).toContain('CSV');
    expect(rank(sources, 'Does archival export perform cryptocurrency staking?')).toEqual([]);
  });
  test('supports Unicode FAQ and source terms', () => {
    const sources = [
      {
        _id: 'tamil',
        title: 'பொருட்களை ஏற்றுமதி செய்வது எப்படி',
        content: 'பொருட்கள் பக்கத்தில் ஏற்றுமதி பொத்தானை அழுத்தவும்.',
        kind: 'faq',
      },
    ];
    expect(rank(sources, sources[0].title)[0]).toMatchObject({ exact: true, document_id: 'tamil' });
  });
  test('fallback preserves secondary evidence and stable citation numbers without generating facts', () => {
    const matches = [
      { text: 'First approved passage.' },
      { text: 'Second approved passage answers the question.' },
    ];
    expect(excerptAnswer(matches)).toContain('[2] Second approved passage answers the question.');
    expect(excerptAnswer([])).toBe('');
    expect(excerptAnswer([{ exact: true, text: 'Exact answer.' }])).toBe('Exact answer.');
  });
  test('a named multiword control retrieves its table definition before repeated topical prose', () => {
    const sources = [
      {
        _id: 'settings',
        title: 'Receipt options',
        chunks: [
          'Print Customer | Adds customer details to the receipt.',
          'Print Customer is in Receipt options. Check the receipt options and Print Customer switch when reviewing receipt options.',
        ],
      },
    ];
    expect(rank(sources, 'What does Print Customer do?')[0].text).toContain(
      'Adds customer details'
    );
  });
  test('credential settings never stand in for actual private credentials', () => {
    const sources = [
      {
        _id: 'password',
        title: 'Owner password',
        content: 'Owners can change their password in settings.',
      },
    ];
    expect(rank(sources, "What is the owner's secret password?")).toEqual([]);
    expect(rank(sources, 'How do owners change their password?')).toHaveLength(1);
  });
  test('indexes the end of a chunk and preserves chunk citation offsets', () => {
    const content = 'generic '.repeat(145) + 'barcode scanner pairing';
    expect(
      rank(
        [{ _id: 'long', title: 'Devices', content, chunks: chunks(content) }],
        'barcode scanner pairing'
      )[0].text
    ).toContain('barcode scanner pairing');
  });
  test('Intranet preview uses the same deployed retrieval kernel when the workspace is present', () => {
    const intranet = path.resolve(__dirname, '../../../../../Intranet/ask-posnic-retrieval.js');
    if (fs.existsSync(intranet))
      expect(fs.readFileSync(intranet, 'utf8')).toBe(
        fs.readFileSync(require.resolve('../../../src/services/ask-posnic-retrieval'), 'utf8')
      );
  });
});
