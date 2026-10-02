'use strict';

// Legacy desktop KOTs keep the default tender in partial_balance even when
// the complete bill is still outstanding. Only discard that exact unpaid
// shape; explicit paid amounts and partial tenders remain payment evidence.
function paidAmount(sale) {
  if (Number(sale.paid_amount) > 0) return Number(sale.paid_amount);
  const legacy = Number(sale.partial_balance || 0);
  if (
    sale.payment_status === 'Unpaid' &&
    [false, 'false', 0, '0'].includes(sale.partial_check) &&
    sale.payment_pending != null &&
    Number.isFinite(Number(sale.sales_total)) &&
    Number(sale.payment_pending) === Number(sale.sales_total) &&
    legacy === Number(sale.sales_total)
  )
    return 0;
  return Number(sale.paid_amount || sale.partial_balance || 0);
}

module.exports = { paidAmount };
