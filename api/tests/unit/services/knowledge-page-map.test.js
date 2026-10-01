'use strict';
const pageMap = require('../../../src/services/knowledge-page-map');
const { chunks, rank } = require('../../../src/services/ask-posnic-retrieval');

test('page offsets preserve physical numbering, Unicode and repeated passages across blank pages', () => {
  const mapped = pageMap.fromPages(
    [
      { num: 1, text: '  First\r\npage  ' },
      { num: 2, text: '' },
      { num: 3, text: 'தமிழ் 😀\n\nRepeated text' },
      { num: 4, text: 'Repeated text' },
    ],
    4
  );
  expect(mapped.page_map.spans.map((span) => span.page)).toEqual([1, 3, 4]);
  expect(mapped.page_map.spans.map((span) => mapped.content.slice(span.start, span.end))).toEqual([
    'First\npage',
    'தமிழ் 😀\n\nRepeated text',
    'Repeated text',
  ]);
  expect(pageMap.forChunk({ ...mapped, kind: 'pdf', chunks: chunks(mapped.content) }, 0)).toEqual([
    1, 3, 4,
  ]);
});

test('page mapping covers the retrieved anchor and adjacent evidence but excludes distant pages', () => {
  const mapped = pageMap.fromPages(
    [
      { num: 1, text: 'a'.repeat(3500) },
      { num: 2, text: 'Receipt printer setup '.repeat(130) },
      { num: 3, text: 'z'.repeat(3500) },
    ],
    3
  );
  const doc = {
    _id: 'pdf',
    title: 'Manual',
    revision: '1',
    kind: 'pdf',
    ...mapped,
    chunks: chunks(mapped.content),
  };
  expect(pageMap.forChunk(doc, 0)).toEqual([1]);
  const found = rank([doc], 'Receipt printer setup');
  expect(found.length).toBeGreaterThan(0);
  expect(found[0].pages).toContain(2);
  expect(pageMap.forChunk(doc, 1000)).toEqual([]);
  expect(pageMap.forChunk({ ...doc, chunks: ['custom text'] }, 0)).toEqual([]);
});

test('stale hashes, malformed page numbers and non-covering offsets cannot become citations', () => {
  const mapped = pageMap.fromPages([{ num: 1, text: 'Approved text' }], 1);
  expect(() => pageMap.validate('Altered text', mapped.page_map)).toThrow(/no longer matches/);
  for (const span of [
    { page: 0, start: 0, end: 13 },
    { page: 2, start: 0, end: 13 },
    { page: 1, start: -1, end: 13 },
    { page: 1, start: 0, end: 999 },
    { page: 1, start: 1, end: 13 },
  ])
    expect(() => pageMap.validate(mapped.content, { ...mapped.page_map, spans: [span] })).toThrow(
      /no longer matches/
    );
  expect(pageMap.forChunk({ kind: 'pdf', content: 'legacy PDF' }, 0)).toEqual([]);
  expect(
    pageMap.forChunk({ kind: 'pdf', content: 'Altered text', page_map: mapped.page_map }, 0)
  ).toEqual([]);
});
