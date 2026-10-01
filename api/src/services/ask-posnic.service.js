'use strict';

const moment = require('moment-timezone');
const PERIODS = new Set([
  'today',
  'yesterday',
  'week',
  'month',
  'year',
  'last_week',
  'last_month',
  'last_year',
]);

function periodFrom(question, requested, fallback = 'today') {
  if (PERIODS.has(requested)) return requested;
  const text = String(question || '').toLowerCase();
  const match = text.match(
    /\b(today|yesterday|(?:(this|last|previous)\s+)?(week|month|year)(?:ly)?)\b/
  );
  if (match)
    return match[3]
      ? (['last', 'previous'].includes(match[2]) ? 'last_' : '') + match[3]
      : match[1];
  return PERIODS.has(fallback) ? fallback : 'today';
}

function dateRange(period, timezone = 'UTC', at = new Date()) {
  const now = moment(at).tz(moment.tz.zone(timezone) ? timezone : 'UTC');
  const previous = period.startsWith('last_');
  const unit = period.replace('last_', '');
  let start, end;
  if (period === 'yesterday') {
    start = now.clone().subtract(1, 'day').startOf('day');
    end = start.clone().endOf('day');
  } else if (['week', 'month', 'year'].includes(unit)) {
    const currentStart =
      unit === 'week' ? now.clone().day(0).startOf('day') : now.clone().startOf(unit);
    start = previous ? currentStart.clone().subtract(1, unit) : currentStart;
    end = previous ? currentStart.clone().subtract(1, 'millisecond') : now;
  } else {
    start = now.clone().startOf('day');
    end = now.clone().endOf('day');
  }
  return { start_date: start.toDate(), end_date: end.toDate() };
}

function intentFrom(question) {
  const text = String(question || '').toLowerCase();
  if (/how (?:do|can|to)|help (?:me|with)/.test(text) && /return|refund/.test(text))
    return 'refund_help';
  // Workflow questions belong to approved product guidance even when their
  // wording mentions a report metric or a supported write action.
  if (
    /\bhow (?:do|can|to|should)|\bhelp (?:me|with)|\bwhere (?:do|can|is)|\bexplain\b/.test(text)
  ) {
    if (/receipt|printer/.test(text)) return 'receipt_help';
    if (/offline|internet/.test(text)) return 'offline_help';
    return 'unknown';
  }
  if (/prepare|create|make|start/.test(text) && /stock count|stocktake|inventory count/.test(text))
    return 'stock_count_action';
  if (
    /prepare|create|make|draft/.test(text) &&
    /supplier (?:message|email)|message (?:to|for) (?:the |a |my )?supplier/.test(text)
  )
    return 'supplier_message_action';
  if (/prepare|create|make/.test(text) && /purchase order|reorder|\bpo\b/.test(text))
    return 'purchase_order_action';
  if (/prepare|create|make/.test(text) && /campaign|promotion message|marketing message/.test(text))
    return 'campaign_action';
  if (
    /prepare|create|make/.test(text) &&
    /\bsale\b|sales draft|draft sales|quotation|sales quote/.test(text) &&
    !/report|summary|trend/.test(text)
  )
    return 'sale_draft_action';
  if (
    /promotion performance|promotion report|coupon.*(?:performance|report|usage|uses|discount|sales)|(?:performance|report|usage) of (?:my )?coupons/.test(
      text
    )
  )
    return 'promotion_performance';
  if (/outlets?|branches/.test(text) && /compare|comparison|sales?|revenue|takings/.test(text))
    return 'outlet_comparison';
  if (
    (/hourly|by hour/.test(text) && /sales?|revenue|takings/.test(text)) ||
    /busiest hour|peak hour/.test(text)
  )
    return 'hourly_sales';
  if (/daily sales|sales by day|day.by.day|sales trend/.test(text)) return 'daily_sales';
  if (/no.sale items|unsold|not sold|haven.t sold|dead stock/.test(text)) return 'no_sale_items';
  if (/slow.moving|slow.sell|slowest.sell|least sold/.test(text)) return 'slow_items';
  if (/category performance|category sales|sales by categor|top categor/.test(text))
    return 'category_performance';
  if (/customer segment|repeat customer|customer purchase frequency/.test(text))
    return 'customer_segments';
  if (
    /reorder (?:suggestions?|plan)|demand (?:forecast|plan|estimate)|stock cover|days of stock|should (?:i|we) (?:reorder|restock)|how much.*reorder/.test(
      text
    )
  )
    return 'reorder_suggestions';
  if (
    /compare|comparison|versus|vs\.?|change from|previous period/.test(text) &&
    /sales?|revenue|profit/.test(text)
  )
    return 'comparison';
  if (
    /payment mix|payment method|cash vs|upi|card payment|customers paid|cash payment percentage/.test(
      text
    )
  )
    return 'payment_mix';
  if (/best sell|top item|top product|most sold|sold most|most popular products/.test(text))
    return 'top_items';
  if (
    /receivable|overdue|unpaid invoice|money owed|amount owed|outstanding invoices|owes money/.test(
      text
    )
  )
    return 'receivables';
  if (/tax summary|tax collected|gst(?: was)? collected|sales tax/.test(text)) return 'tax';
  if (/low stock|low inventory|running low|reorder|restock|stock alert/.test(text))
    return 'low_stock';
  if (/profit|margin|cost|expense/.test(text)) return 'profit';
  if (/sales?|revenue|takings|sold|what did we sell|best sell|top item/.test(text)) return 'sales';
  if (/receipt|printer/.test(text)) return 'receipt_help';
  if (/offline|internet/.test(text)) return 'offline_help';
  if (/return|refund/.test(text)) return 'refund_help';
  return 'unknown';
}

function money(value) {
  return Number(value || 0).toFixed(2);
}

function answerHelp(intent) {
  const answers = {
    receipt_help: {
      answer:
        'Open Manage, then Receipt Designer to change the receipt layout. Printer and paper settings are available from Print settings.',
      link: '#/receiptdesigner',
      source: 'Posnic settings',
    },
    offline_help: {
      answer:
        'The desktop POS can keep the local shop running without internet. Cloud sync and online services resume when the connection returns.',
      link: '#/settings',
      source: 'Posnic product guidance',
    },
    refund_help: {
      answer:
        'Open Sales History, select the sale, and choose Return. Posnic will request manager approval when the cashier does not have refund permission.',
      link: '#/sales',
      source: 'Sales workflow',
    },
  };
  return answers[intent];
}

function answerOverview(intent, overview, period) {
  period = String(period).replace(/_/g, ' ');
  const totals = overview?.totals || {};
  const profit = overview?.profit || {};
  const lowStockSummary = overview?.lowStock || {};
  const lowStock = Array.isArray(lowStockSummary.items) ? lowStockSummary.items : [];
  const topItems = Array.isArray(overview?.topItems) ? overview.topItems : [];

  if (intent === 'low_stock') {
    const preview = lowStock.slice(0, 5).map((item) => ({
      label: item.name || item.item_name || 'Item',
      value: item.qty ?? item.available_quantity ?? item.quantity ?? 0,
    }));
    const count = Number(lowStockSummary.count ?? lowStock.length);
    return {
      answer: count
        ? `${count} item${count === 1 ? '' : 's'} need attention. The lowest-stock items are shown below.`
        : 'No low-stock items need attention.',
      metrics: preview,
      link: '#/lowstockitems',
      source: 'Live inventory',
    };
  }

  if (intent === 'profit') {
    if (!overview?.financials) {
      return {
        answer: 'Your role does not have permission to view profit and cost figures.',
        metrics: [],
        source: 'Dashboard permissions',
      };
    }
    const value = profit.net_profit ?? profit.profit ?? profit.amount ?? 0;
    return {
      answer: `Net profit for ${period} is ${money(value)}.`,
      metrics: [{ label: 'Net profit', value: money(value) }],
      link: '#/dashboard',
      source: 'Dashboard profit summary',
    };
  }

  if (intent === 'tax') {
    if (overview?.financials === false)
      return {
        answer: 'Your role does not have permission to view tax totals.',
        metrics: [],
        source: 'Permission policy',
      };
    const value = overview?.kpis?.total_tax ?? 0;
    return {
      answer: `Tax collected for ${period} is ${money(value)}.`,
      metrics: [{ label: 'Tax collected', value: money(value) }],
      link: '#/taxreport',
      source: 'Dashboard tax summary',
    };
  }

  if (intent === 'payment_mix') {
    const rows = (overview?.paymentMix || [])
      .slice(0, 8)
      .map((item) => ({ label: item.mode || 'Other', value: `${money(item.pct)}%` }));
    return {
      answer: rows.length
        ? `Payment mix for ${period} is shown below.`
        : `No payment data was recorded for ${period}.`,
      metrics: rows,
      link: '#/paymentReport',
      source: 'Payment report',
    };
  }

  if (intent === 'top_items') {
    const rows = topItems.slice(0, 5).map((item) => ({
      label: item.item_name || item.name || 'Item',
      value: item.total_qty ?? item.quantity ?? 0,
    }));
    return {
      answer: rows.length
        ? `The best-selling items for ${period} are shown below.`
        : `No item sales were recorded for ${period}.`,
      metrics: rows,
      link: '#/itemReport',
      source: 'Best-selling products report',
    };
  }

  const amount = totals.sales_amount ?? totals.sales_amounts ?? 0;
  const count = totals.sales_count ?? totals.sales_days ?? 0;
  const metrics = [
    { label: 'Sales', value: money(amount) },
    { label: 'Transactions', value: count },
  ];
  if (topItems[0])
    metrics.push({ label: 'Top item', value: topItems[0].name || topItems[0].item_name || '—' });
  return {
    answer: `Sales for ${period} are ${money(amount)} across ${count} transaction${Number(count) === 1 ? '' : 's'}.`,
    metrics,
    link: '#/dashboard',
    source: 'Live sales dashboard',
  };
}

function answerComparison(current, previous, metric = 'sales') {
  const amount = (data) =>
    Number(
      metric === 'profit'
        ? (data?.profit?.net_profit ?? data?.profit?.profit ?? data?.profit?.amount ?? 0)
        : (data?.totals?.sales_amount ?? 0)
    );
  const currentAmount = amount(current);
  const previousAmount = amount(previous);
  const change =
    previousAmount !== 0
      ? ((currentAmount - previousAmount) / Math.abs(previousAmount)) * 100
      : null;
  const title = metric === 'profit' ? 'Net profit' : 'Sales';
  return {
    answer:
      change === null
        ? `${title} changed from ${money(previousAmount)} to ${money(currentAmount)}. Percentage change is unavailable because the previous total was zero.`
        : `${title} ${change >= 0 ? 'increased' : 'decreased'} ${Math.abs(change).toFixed(1)}% compared with the previous equivalent period.`,
    metrics: [
      { label: `Current ${metric}`, value: money(currentAmount) },
      { label: `Previous ${metric}`, value: money(previousAmount) },
      { label: 'Change', value: change === null ? 'N/A' : `${change.toFixed(1)}%` },
    ],
    source: `${title} period comparison`,
  };
}

module.exports = {
  PERIODS,
  periodFrom,
  dateRange,
  intentFrom,
  answerHelp,
  answerOverview,
  answerComparison,
};
