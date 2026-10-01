'use strict';
const fs = require('node:fs');
const path = require('node:path');
const corpus = require('../tests/fixtures/ask-posnic-knowledge-sources.json');
const { rank } = require('../src/services/ask-posnic-retrieval');

// Controlled semantic tests, not assertions about actual product behaviour.
// Paired valid/invalid statements detect both unsafe acceptance and over-refusal.
const scenarios = [
  ['possibility', 'Does write access always require manager approval?', 'A cashier can have write access but still need manager approval.', 'A cashier with write access always needs manager approval.', 'A cashier with write access may still need manager approval.'],
  ['recommendation', 'Is manager approval mandatory for all refunds?', 'Recommended default: cashiers should obtain manager approval for refunds. Shops may grant direct refund authority.', 'All refunds require manager approval.', 'Manager approval is a recommended default; shops may grant direct refund authority.'],
  ['alternative', 'Is manager approval the only way to refund?', 'A refund requires either direct refund authority or manager approval.', 'A refund requires manager approval.', 'A refund requires either direct refund authority or manager approval.'],
  ['condition', 'Are coupon discounts always available?', 'Coupons apply only when the sale meets the minimum spend.', 'Coupons apply to every sale.', 'Coupons apply only when the sale meets the minimum spend.'],
  ['scope', 'Can all employees export reports?', 'Only managers with report access can export reports.', 'All employees can export reports.', 'Only managers with report access can export reports.'],
  ['negation', 'Does deleting a customer delete historical sales?', 'Deleting a customer does not delete historical sales.', 'Deleting a customer deletes historical sales.', 'Deleting a customer does not delete historical sales.'],
  ['exception', 'Can every completed sale be returned immediately?', 'Completed sales can be returned, except credit sales with an outstanding balance.', 'Every completed sale can be returned immediately.', 'Credit sales with an outstanding balance are an exception to returning completed sales.'],
  ['limit', 'Can I return an unlimited quantity?', 'The return quantity cannot exceed the remaining sold quantity.', 'Any quantity can be returned.', 'The return quantity cannot exceed the remaining sold quantity.'],
  ['workflow', 'Can a pending credit sale be returned?', 'At checkout, walk-in sales must be paid immediately unless the shop allows credit. For returns, pending credit balances must be settled first.', 'Pending credit sales can be returned when the shop allows credit.', 'For returns, pending credit balances must be settled first.'],
  ['incomplete', 'Are all discount changes subject to manager approval?', 'Discount change | Manager approval', 'All discount changes require manager approval.', null],
  ['tamil', 'எல்லா விற்பனைக்கும் கூப்பன் தள்ளுபடி கிடைக்குமா?', 'Coupons apply only when the sale meets the minimum spend.', 'எல்லா விற்பனைக்கும் கூப்பன் தள்ளுபடி கிடைக்கும்.', 'குறைந்தபட்ச கொள்முதல் தொகையை எட்டும் விற்பனைக்கு மட்டுமே கூப்பன் தள்ளுபடி பொருந்தும்.'],
];
const cases = [];
for (const [id, question, passage, bad, good] of scenarios) {
  for (const [accepted, answer] of [[false, bad], [true, good]]) {
    if (!answer) continue;
    cases.push({ id: `${id}-${accepted ? 'valid' : 'invalid'}`, question, expected_accept: accepted, matches: [{ title: 'Controlled condition fixture', text: passage }], draft: { cannot_answer: false, statements: [{ text: answer, evidence: [{ source: 1, quote: passage }] }] } });
  }
}
const question = 'Does Sales write permission mean a cashier never needs manager approval?';
const matches = rank(corpus.documents, question);
const quote = 'A cashier can have Sales write permission but still need manager approval for refunds, price overrides or register close.';
const original = matches.findIndex((row) => (row.context || row.text).includes(quote)) + 1;
if (!original) throw new Error('Recorded permission regression source was not retrieved.');
for (const accepted of [false, true]) cases.push({ id: `recorded-role-${accepted ? 'valid' : 'invalid'}`, question, expected_accept: accepted, matches, draft: { cannot_answer: false, statements: [{ text: accepted ? 'Sales write permission alone does not guarantee that a cashier can perform every action without manager approval.' : 'A cashier with Sales write permission still needs manager approval for certain actions such as refunds, price overrides, or register close.', evidence: [{ source: original, quote }] }] } });
fs.writeFileSync(path.resolve(__dirname, '../tests/fixtures/ask-posnic-condition-cases.json'), JSON.stringify({ scope: 'Controlled condition/modality verifier probes plus the recorded public-manual permission regression; not customer answer accuracy.', cases }, null, 2) + '\n');
console.log(`${cases.length} condition-check cases written.`);
