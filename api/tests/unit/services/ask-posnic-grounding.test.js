'use strict';
const grounding = require('../../../src/services/ask-posnic-grounding.service');
const source = {
  title: 'Returns',
  text: 'Returns are allowed only within 30 days. A manager must approve each return.',
};
const valid = () => ({
  cannot_answer: false,
  statements: [
    {
      text: 'A return requires manager approval and must be within 30 days.',
      evidence: [{ source: 1, quote: source.text }],
    },
  ],
});
const response = (value) => ({ status: true, data: { text: JSON.stringify(value) } });

test('constructs citation markers from validated evidence and meters a separate full-context claim check', async () => {
  const ask = jest
    .fn()
    .mockResolvedValueOnce(response(valid()))
    .mockResolvedValueOnce(
      response({
        verdicts: [
          {
            statement: 1,
            supported: true,
            relevant: true,
            conditions_preserved: true,
            modality_preserved: true,
          },
        ],
      })
    );
  const answer = await grounding.answer(
    'Can I return a purchase?',
    [source],
    { response_language: 'en' },
    { licenseId: 'shop' },
    { ask }
  );
  expect(answer).toMatchObject({ mode: 'rag', reason: 'checked_claims' });
  expect(answer.text).toContain('[1]');
  expect(ask).toHaveBeenCalledTimes(2);
  expect(ask.mock.calls[1][0].feature).toBe('ask_posnic_grounding_check');
  expect(JSON.parse(ask.mock.calls[1][0].prompt).full_sources[0].passage).toBe(source.text);
});

test.each([
  [
    'invented quote',
    (draft) => {
      draft.statements[0].evidence[0].quote = 'No approval is ever required.';
    },
  ],
  [
    'invented source',
    (draft) => {
      draft.statements[0].evidence[0].source = 99;
    },
  ],
  [
    'inline model citation',
    (draft) => {
      draft.statements[0].text += ' [99]';
    },
  ],
  [
    'missing evidence',
    (draft) => {
      draft.statements[0].evidence = [];
    },
  ],
  [
    'blank statement',
    (draft) => {
      draft.statements[0].text = '';
    },
  ],
  [
    'excessive statements',
    (draft) => {
      draft.statements = Array(7).fill(draft.statements[0]);
    },
  ],
  [
    'contradictory refusal',
    (draft) => {
      draft.cannot_answer = true;
    },
  ],
])('rejects %s without paying for verification', async (_name, corrupt) => {
  const draft = valid();
  corrupt(draft);
  const ask = jest.fn().mockResolvedValue(response(draft));
  expect((await grounding.answer('Question', [source], {}, {}, { ask })).reason).toBe(
    'invalid_evidence'
  );
  expect(ask).toHaveBeenCalledTimes(1);
});

test.each([
  { verdicts: [] },
  { verdicts: [{ statement: 1, supported: false }] },
  { verdicts: [{ statement: 1, supported: 'true' }] },
  { verdicts: [{ statement: 2, supported: true }] },
  {
    verdicts: [
      { statement: 1, supported: true },
      { statement: 1, supported: true },
    ],
  },
])('incomplete or negative claim checks fail closed: %j', async (verdict) => {
  const ask = jest
    .fn()
    .mockResolvedValueOnce(response(valid()))
    .mockResolvedValueOnce(response(verdict));
  expect(await grounding.answer('Question', [source], {}, {}, { ask })).toMatchObject({
    text: null,
    reason: 'claim_check_failed',
  });
});

test('a matching quote does not bypass the check for omitted conditions or wrong question context', async () => {
  const draft = {
    cannot_answer: false,
    statements: [
      {
        text: 'A manager must approve each return.',
        evidence: [{ source: 1, quote: 'A manager must approve each return.' }],
      },
    ],
  };
  const ask = jest
    .fn()
    .mockResolvedValueOnce(response(draft))
    .mockResolvedValueOnce(response({ verdicts: [{ statement: 1, supported: false }] }));
  expect(
    (
      await grounding.answer(
        'Can a manager approve a return after 90 days?',
        [source],
        {},
        {},
        { ask }
      )
    ).text
  ).toBeNull();
  expect(JSON.parse(ask.mock.calls[1][0].prompt).full_sources[0].passage).toContain('30 days');
});

test('unavailable claim verification never releases the unverified draft', async () => {
  const ask = jest
    .fn()
    .mockResolvedValueOnce(response(valid()))
    .mockResolvedValueOnce({ status: false });
  expect((await grounding.answer('Question', [source], {}, {}, { ask })).text).toBeNull();
});

test('unsupported questions return a refusal without a second model call', async () => {
  const ask = jest.fn().mockResolvedValue(response({ cannot_answer: true, statements: [] }));
  expect(
    await grounding.answer('What is tomorrow’s weather?', [source], {}, {}, { ask })
  ).toMatchObject({ mode: 'refusal', text: grounding.refusal });
  expect(ask).toHaveBeenCalledTimes(1);
});

test('owner instructions and unrecognized language strings cannot become system instructions', async () => {
  const ask = jest.fn().mockResolvedValue(response({ cannot_answer: true, statements: [] }));
  await grounding.answer(
    'Question',
    [source],
    { help_instructions: 'UNTRUSTED-STYLE', response_language: 'UNTRUSTED-LANGUAGE' },
    {},
    { ask }
  );
  expect(ask.mock.calls[0][0].system).not.toMatch(/UNTRUSTED/);
  expect(JSON.parse(ask.mock.calls[0][0].prompt).style_preferences).toBe('UNTRUSTED-STYLE');
});

test('oversized source context is rejected before any provider call', async () => {
  const ask = jest.fn();
  expect(
    (
      await grounding.answer(
        'Question',
        [{ text: 'x'.repeat(20000) }, { text: 'x'.repeat(20000) }],
        {},
        {},
        { ask }
      )
    ).reason
  ).toBe('source_context_limit');
  expect(ask).not.toHaveBeenCalled();
});

test.each(['supported', 'relevant', 'conditions_preserved', 'modality_preserved'])(
  'a negative %s verdict cannot pass on factual support alone',
  async (key) => {
    const verdict = {
      statement: 1,
      supported: true,
      relevant: true,
      conditions_preserved: true,
      modality_preserved: true,
      [key]: false,
    };
    const ask = jest
      .fn()
      .mockResolvedValueOnce(response(valid()))
      .mockResolvedValueOnce(response({ verdicts: [verdict] }));
    expect((await grounding.answer('Question', [source], {}, {}, { ask })).reason).toBe(
      'claim_check_failed'
    );
  }
);

test('both model stages and quote validation see a condition across the indexed chunk boundary', async () => {
  const context =
    'Discount change | Manager approval is required only when the operator lacks discount authority.';
  const boundary = { title: 'Editing', text: 'Discount change | Manager approval', context };
  const draft = {
    cannot_answer: false,
    statements: [
      {
        text: 'Approval is required only when the operator lacks discount authority.',
        evidence: [{ source: 1, quote: context }],
      },
    ],
  };
  const ask = jest
    .fn()
    .mockResolvedValueOnce(response(draft))
    .mockResolvedValueOnce(
      response({
        verdicts: [
          {
            statement: 1,
            supported: true,
            relevant: true,
            conditions_preserved: true,
            modality_preserved: true,
          },
        ],
      })
    );
  expect(
    (await grounding.answer('Is approval always required?', [boundary], {}, {}, { ask })).mode
  ).toBe('rag');
  expect(JSON.parse(ask.mock.calls[0][0].prompt).sources[0].passage).toBe(context);
  expect(JSON.parse(ask.mock.calls[1][0].prompt).full_sources[0].passage).toBe(context);
});

test.each([
  [
    'A cashier can have write permission but still need approval.',
    'A cashier with write permission needs approval.',
  ],
  [
    'Manager approval may be required for discounts.',
    'Manager approval is required for discounts.',
  ],
  ['Recommended default: cashiers should obtain approval.', 'All cashiers must obtain approval.'],
  ['Discount change | Manager approval', 'All discount changes require manager approval.'],
])(
  'tentative evidence cannot become an unconditional English requirement even if the model would accept it',
  async (quote, text) => {
    const draft = {
      cannot_answer: false,
      statements: [{ text, evidence: [{ source: 1, quote }] }],
    };
    const ask = jest.fn().mockResolvedValue(response(draft));
    expect(
      (await grounding.answer('Is approval always required?', [{ text: quote }], {}, {}, { ask }))
        .reason
    ).toBe('qualifier_mismatch');
    expect(ask).toHaveBeenCalledTimes(1);
  }
);

test.each([
  'A cashier may still need approval.',
  'Approval is required if the cashier lacks direct authority.',
  'Write permission does not guarantee approval is unnecessary.',
  'Sales write permission alone does not guarantee that a cashier can perform every action without manager approval.',
])('qualified permission wording proceeds to semantic verification: %s', (text) => {
  expect(
    grounding.losesEnglishQualifier({
      text,
      evidence: [{ quote: 'A cashier can have write permission but still need approval.' }],
    })
  ).toBe(false);
});

test('an explicitly universal source can support universal wording', () => {
  expect(
    grounding.losesEnglishQualifier({
      text: 'Every export requires report access.',
      evidence: [{ quote: 'Each export requires report access.' }],
    })
  ).toBe(false);
});
