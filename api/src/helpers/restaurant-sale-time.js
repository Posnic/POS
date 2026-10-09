'use strict';

// The order clock belongs to the kitchen; the sale clock belongs to settlement.
module.exports = function restaurantSaleTime(sale, paymentStatus, paymentAt) {
  if (!sale || (sale.sale_process !== 'KOT' && sale.sale_method !== 'Table-Order')) return {};
  if (sale.settled_at) return { date: sale.settled_at, settled_at: sale.settled_at };
  // Editing an old paid bill must not silently move it to today's accounts.
  if (sale.payment_status === 'Paid') return sale.date ? { date: sale.date } : {};
  if (paymentStatus !== 'Paid') return sale.date ? { date: sale.date } : {};
  const at = new Date(paymentAt);
  if (!Number.isFinite(at.getTime())) throw new Error('Invalid settlement time.');
  return {
    date: at,
    settled_at: at,
    order_date: sale.order_date || sale.created_date || sale.date || at,
  };
};
