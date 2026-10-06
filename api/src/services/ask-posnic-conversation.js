'use strict';

const assistant = require('./ask-posnic.service');
// Only read-only reports can inherit context. Never repeat a write/action.
const REPORTS = new Set([
  'sales',
  'profit',
  'tax',
  'payment_mix',
  'top_items',
  'slow_items',
  'no_sale_items',
  'category_performance',
  'customer_segments',
  'promotion_performance',
  'outlet_comparison',
  'comparison',
  'hourly_sales',
  'daily_sales',
  'receivables',
  'low_stock',
]);
const periodOnly =
  /^(?:(?:and|what about|how about|show me|show|for|in)\s+)*(?:today|yesterday|(?:(?:this|last|previous)\s+)?(?:week|month|year))[?.!]*$/i;
const feedbackOnly =
  /^(?:(?:please|can you)\s+)?(?:explain(?: that)?(?: better| more| again)?|(?:tell me|give me) more(?: details)?|be more specific|that(?:'s| is) (?:wrong|not helpful)|(?:you(?:'re| are) )?(?:repeating|same answer)|try again)[?.!]*$/i;

function needsContext(question) {
  return periodOnly.test(question.trim()) || feedbackOnly.test(question.trim());
}

function resolve(question, previous) {
  if (periodOnly.test(question.trim())) {
    if (previous && REPORTS.has(previous.intent)) {
      // These reports have no period filter; don't relabel current balances/stock.
      if (['receivables', 'low_stock'].includes(previous.intent))
        return {
          clarification:
            'That report shows the current position, so changing the date would be misleading. Would you like sales or profit for that period instead?',
          suggestions: [
            'Show sales ' + question.replace(/^(and|what about|how about)\s+/i, ''),
            'Show sales today',
          ],
        };
      // Comparison also needs its original metric, which a bare intent does not retain.
      if (previous.intent === 'comparison')
        return {
          clarification: 'Which figure would you like to compare for that period: sales or profit?',
          suggestions: ['Compare sales this month', 'Compare profit this month'],
        };
      return { intent: previous.intent, period: assistant.periodFrom(question) };
    }
    return {
      clarification:
        'Which report would you like for that period? Include sales, profit or stock in your question so I can use the right data.',
      suggestions: ['Show sales yesterday', 'Show profit this month', 'Show low stock'],
    };
  }
  if (feedbackOnly.test(question.trim())) {
    return {
      clarification:
        previous?.mode === 'rag' || previous?.intent === 'help'
          ? 'I have not established any additional detail beyond the sources already shown. Which step is unclear, and what screen or error do you see? I can search for that specific issue.'
          : 'Which part should I explain or check: the figure, the date range, or the underlying records? Tell me the specific issue so I can check the right report.',
      suggestions:
        previous && REPORTS.has(previous.intent)
          ? ['Show sales by day this month', 'Show payment mix today']
          : ['What can you do?', 'How do I return a sale?'],
    };
  }
  return {};
}

function fallback(question, reason) {
  if (/^\s*(?:hi|hello|hey|good morning|good evening)[!.?\s]*$/i.test(question))
    return {
      answer:
        'Hello! I can check your shop reports, help with Posnic, and prepare supported actions for you to review. What would you like to do?',
      suggestions: ['Show sales today', 'Show low stock', 'What can you do?'],
    };
  if (/\b(?:delete|remove|cancel|refund|pay|send|email|export|change|update)\b/i.test(question))
    return {
      answer:
        'I have not changed or sent anything. Tell me which record or workflow you mean. I can explain the steps or show the supported actions for you to review.',
      suggestions: ['What can you do?', 'How do I return a sale?'],
    };
  if (/\b(?:stock|product|item|inventory)\b/i.test(question))
    return {
      answer:
        'Do you want low-stock items, best-selling products, or help changing an item? Choose one, or include the product name and what you want to check.',
      suggestions: [
        'Show low stock',
        'Show top products this month',
        'Show unsold items this month',
      ],
    };
  if (/\b(?:sale|sales|report|profit|payment)\b/i.test(question))
    return {
      answer:
        'Which figure should I check, and for which period? I can show sales, profit, payment mix and product performance from your shop reports.',
      suggestions: ['Show sales today', 'Show profit this month', 'Show payment mix today'],
    };
  return {
    answer:
      reason === 'unsupported'
        ? 'The sources I found do not answer this specific question. Tell me the Posnic screen, the step you are trying, and any error message so I can narrow the search.'
        : 'I could not find a matching answer in this shop’s published help. Tell me the Posnic screen or task and what happened. An owner can also add the missing guidance in Ask Posnic settings → Knowledge.',
    suggestions: ['What can you do?', 'How do I return a sale?', 'Show sales today'],
  };
}

module.exports = { needsContext, resolve, fallback };
