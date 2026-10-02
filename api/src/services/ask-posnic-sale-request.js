'use strict';

// This parser only extracts a requested basket. Catalog lookup, pricing,
// permissions and payment remain in the existing POS workflows.
function linesFromQuestion(question) {
  const text = String(question || '').trim();
  const match =
    text.match(
      /^(?:please\s+)?(?:create|make|prepare|start)\s+(?:(?:a|one|new)\s+)?sale\s+(?:with|for|of)\s+(.+)$/i
    ) || text.match(/^(?:please\s+)?sell\s+(.+)$/i);
  if (!match) return null;
  const basket = match[1]
    .replace(/\s+(?:and\s+)?print(?:\s+(?:the\s+)?receipt)?[.!]?$/i, '')
    .replace(/[.!]$/, '');
  const parts = basket.split(/\s*(?:,|;|\band\b)\s*(?=\d+(?:\.\d+)?\s)/i);
  if (!parts.length || parts.length > 30) return null;
  const lines = parts.map((part) => {
    const row = part.trim().match(/^(\d+(?:\.\d{1,3})?)\s*(?:[x×]\s*)?\s+(.{1,200})$/i);
    return row && Number(row[1]) > 0 ? row[1] + ' x ' + row[2].trim() : null;
  });
  return lines.every(Boolean) ? lines.join('\n') : null;
}

module.exports = { linesFromQuestion };
