'use strict';

// Deployment copy also lives in Intranet/ask-posnic-retrieval.js. Keep the two
// files byte-identical: draft previews and customer retrieval must rank alike.
const STOP_WORDS = new Set('a an and are as at be by can could do does for from how i in is it me my of on or our please posnic should tell the this to we what when where which with would you your why many has have if then than after before another using happens need needs supported long much shown marked immediately'.split(' '));
const clean = (value, max = 200000) => String(value || '').replace(/\0/g, '').trim().slice(0, max);
const pageMap = require('./knowledge-page-map');
const normalizeQuestion = (value) => clean(value, 1000).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function words(value) {
  return (clean(value).normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [])
    .filter((word) => !STOP_WORDS.has(word))
    .map((word) => {
      if (!/^[a-z]+$/.test(word)) return word;
      if (word === 'held') word = 'hold';
      if (word.length > 5 && word.endsWith('ies')) word = word.slice(0, -3) + 'y';
      if (word.length > 6 && word.endsWith('ity')) word = word.slice(0, -3);
      if (/^[a-z]{5,}s$/.test(word) && !/(ss|us|is)$/.test(word)) word = word.slice(0, -1);
      if (word.length > 5 && /(?:ing|ed)$/.test(word)) word = word.replace(/(?:ing|ed)$/, '');
      return word.length >= 4 && word.endsWith('e') ? word.slice(0, -1) : word;
    });
}
function chunks(content, size = 1200, overlap = 180) {
  const text = clean(content), parts = [];
  for (let start = 0; start < text.length; start += size - overlap) {
    parts.push(text.slice(start, start + size));
    if (start + size >= text.length) break;
  }
  return parts;
}

// Keep the indexed chunk identity stable while restoring rules cut at its edge.
// Existing embeddings need no rebuild. Separate non-overlapping custom chunks
// explicitly instead of accidentally joining their words into a new sentence.
function contextForChunk(doc, index) {
  const parts = doc.chunks || chunks(doc.content);
  if (!Number.isInteger(index) || index < 0 || index >= parts.length) return '';
  let text = '';
  for (const part of parts.slice(Math.max(0, index - 1), index + 2)) {
    if (typeof part !== 'string' || part.length > 1200) return '';
    if (!text) { text = part; continue; }
    let overlap = Math.min(180, text.length, part.length);
    while (overlap && text.slice(-overlap) !== part.slice(0, overlap)) overlap--;
    text += overlap >= 20 ? part.slice(overlap) : '\n\n[Adjacent source passage]\n\n' + part;
  }
  return text;
}

// The caller supplies only sources the reader may see. Query coverage avoids
// presenting a match based solely on one common word in a longer question.
function privateCredentialQuestion(question) {
  return /\b(?:what is|show|reveal|give|tell me)\b.{0,60}\b(?:secret password|current password|password for|owner'?s? (?:password|secret)|api key value)\b/i.test(question);
}
function rank(documents, question, limit = 3) {
  // Product guidance cannot reveal a user's actual credentials. A source that
  // mentions password settings is not evidence of somebody's secret password.
  if (privateCredentialQuestion(question)) return [];
  const query = [...new Set(words(question))];
  const querySequence = words(question);
  const pairs = querySequence.slice(1).map((term, index) => [querySequence[index], term]);
  const normalized = ` ${normalizeQuestion(question)} `;
  if (!query.length) return [];
  const entries = documents.flatMap((doc) => (doc.chunks || chunks(doc.content)).flatMap((sourceText, chunk) => {
    // Rank answer-bearing passages, preserving their original chunk identity.
    // An excerpt starts at a paragraph boundary instead of always truncating
    // the start of a long chunk and losing its relevant final paragraph.
    const paragraphs = [...sourceText.matchAll(/\S[\s\S]*?(?=\n\s*\n|$)/g)];
    const passages = paragraphs.length > 1 ? paragraphs.map((part, index) => {
      let end = part.index + part[0].length;
      for (let next = index + 1; next < paragraphs.length && paragraphs[next].index + paragraphs[next][0].length - part.index <= 700; next++) end = paragraphs[next].index + paragraphs[next][0].length;
      return sourceText.slice(part.index, end);
    }) : [sourceText];
    return passages.map((text) => {
    const terms = words(text), counts = new Map();
    terms.forEach((word) => counts.set(word, (counts.get(word) || 0) + 1));
    // Manuals often define multiword controls in the first cell of a table.
    // Prefer that definition when the question names the complete control,
    // instead of a long troubleshooting passage repeating the same terms.
    const field = text.split('\n', 1)[0].split('|')[0].trim();
    const fieldTerms = [...new Set(words(field))];
    const definesField = /^\s*what (?:does|is|are)\b/i.test(question) && text.split('\n', 1)[0].includes('|') && fieldTerms.length >= 2 && fieldTerms.length <= 6 && normalized.includes(` ${normalizeQuestion(field)} `);
    return { doc, text, sourceText, chunk, counts, sequence: ` ${terms.join(' ')} `, length: terms.length, title: new Set(words(doc.title)), definition: definesField ? fieldTerms : [] };
    });
  }));
  const mean = entries.reduce((sum, entry) => sum + entry.length, 0) / (entries.length || 1) || 1;
  const frequency = new Map(query.map((term) => [term, entries.filter((entry) => entry.counts.has(term) || entry.title.has(term)).length]));
  const idfs = new Map(query.map((term) => [term, Math.log(1 + (entries.length - frequency.get(term) + 0.5) / (frequency.get(term) + 0.5))]));
  const queryWeight = query.reduce((sum, term) => sum + idfs.get(term), 0);
  const matches = [];
  for (const entry of entries) {
    const { doc, chunk, text, counts, length, title } = entry;
    const exact = doc.kind === 'faq' && normalizeQuestion(doc.title) === normalizeQuestion(question);
    if (exact && chunk !== 0) continue;
    const covered = query.filter((term) => counts.has(term) || title.has(term));
    const weightedCoverage = covered.reduce((sum, term) => sum + idfs.get(term), 0) / queryWeight;
    if (!exact && (!query.some((term) => counts.has(term)) || covered.length < Math.ceil(query.length * 0.5) || weightedCoverage < 0.55)) continue;
    let score = exact ? 1000 : 0;
    for (const term of covered) {
      const tf = counts.get(term) || 0.25;
      const idf = idfs.get(term);
      score += idf * (tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * length / mean))) * (title.has(term) ? 1.15 : 1);
    }
    score += entry.definition.reduce((sum, term) => sum + (idfs.get(term) || 0) * 2, 0);
    // Related words scattered across a checkout guide must not outrank a
    // restriction containing the actual subject (for example credit sale and
    // pending balance). Reward adjacent query terms in the same passage.
    score += pairs.reduce((sum, pair) => sum + (entry.sequence.includes(` ${pair.join(' ')} `) ? (idfs.get(pair[0]) + idfs.get(pair[1])) * 0.5 : 0), 0);
    // Rank the focused paragraph, but return its full stored chunk. Neighbouring
    // restrictions and qualifying table rows are part of the answer evidence.
    if (score) matches.push({ score, exact, coverage: covered.length / query.length, title: doc.title, revision: String(doc.revision || doc.version || 1), document_id: String(doc._id), chunk, text: exact ? doc.content : entry.sourceText });
  }
  const seen = new Set();
  return matches.sort((a, b) => b.score - a.score || a.document_id.localeCompare(b.document_id) || a.chunk - b.chunk).filter((match) => {
    const key = `${match.document_id}:${match.chunk}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, Math.max(1, Math.min(10, limit))).map((match) => {
    const doc = documents.find((source) => String(source._id) === match.document_id);
    const pages = pageMap.forChunk(doc, match.chunk);
    return { ...match, ...(!match.exact ? { context: contextForChunk(doc, match.chunk) } : {}), ...(pages.length ? { pages } : {}) };
  });
}

// Keep every citation number aligned with the retrieval list. Several sources
// may supply different parts of the answer; selecting only the first can hide
// the supporting passage entirely. Excerpts remain verbatim approved text.
function excerptAnswer(matches) {
  if (!matches.length) return '';
  if (matches[0].exact) return matches[0].text.slice(0, 2000);
  return 'Relevant passages from the approved sources:\n\n' + matches.slice(0, 3)
    .map((match, index) => `[${index + 1}] ${match.text.slice(0, 1200)}`)
    .join('\n\n');
}

module.exports = { chunks, contextForChunk, normalizeQuestion, rank, excerptAnswer, privateCredentialQuestion };
