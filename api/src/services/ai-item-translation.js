'use strict';

const ai = require('./ai.service');
const { locale, normalize } = require('../utils/item-localization');

async function draft(input, context) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  const target = locale(input.target_language);
  const source = locale(input.source_language);
  if (!name || name.length > 200 || description.length > 2000 || !target || target === source) {
    return {
      status: false,
      message: 'Enter an item name and choose a different translation language.',
    };
  }
  const result = await ai.ask(
    {
      feature: 'item_translation',
      system: [
        'Translate catalogue text faithfully. Return only JSON with string fields name and description.',
        'Keep brands, dish identities, quantities and codes intact. Use familiar local spellings for dish names.',
        'Do not add ingredients, claims, prices or facts. An empty source description must stay empty.',
        'The name must be at most 200 characters; description at most 2000 characters.',
        `Target language: ${target}. Source language: ${source || 'detect from the supplied text'}.`,
        ai.DATA_GUARD,
      ].join('\n'),
      prompt: ai.fence(JSON.stringify({ name, description })),
    },
    context
  );
  if (!result.status) return result;
  try {
    const raw = String(result.data?.text || '')
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');
    const parsed = JSON.parse(raw);
    if (
      typeof parsed.name !== 'string' ||
      !parsed.name.trim() ||
      (description && typeof parsed.description !== 'string')
    )
      throw new Error('Invalid reply');
    const [translation] = normalize([
      { locale: target, name: parsed.name, description: description ? parsed.description : '' },
    ]);
    return { status: true, data: translation };
  } catch (_) {
    return {
      status: false,
      message: 'Could not read the translation. Your existing text is unchanged. Try again.',
    };
  }
}

module.exports = { draft };
