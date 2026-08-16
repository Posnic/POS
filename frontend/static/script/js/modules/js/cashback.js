/*
 * Cashback - admin screen (a tab in Settings).
 *
 * A qualifying sale mints a single-use coupon worth a % of the bill, redeemable
 * on the customer's next visit before it expires. It reuses the coupon engine,
 * so redemption happens through the normal till coupon box (type the code, or
 * scan the printed barcode with a handheld scanner). The message can also go out
 * over SMS/WhatsApp. Currency-agnostic - the % needs no currency.
 */
PosnicPro.cashback = {
  _rows: [],

  esc: function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m];
    });
  },
  num: function (v, d) {
    var n = parseFloat(v);
    return isFinite(n) ? n : d;
  },
  sign: function () {
    return PosnicPro.local.get('currencySign') || '';
  },
  fmtDate: function (d) {
    if (!d) return '';
    var dt = new Date(d);
    return isNaN(dt.getTime()) ? '' : dt.toISOString().slice(0, 10);
  },

  load: function () {
    PosnicPro.get('cashback/settings', function (res) {
      if (res && res.type === 'success') PosnicPro.cashback.render(res.data || {});
    });
    PosnicPro.cashback.loadRecent();
  },

  render: function (c) {
    c = c || {};
    $('#cashback_enabled').prop('checked', c.enabled === true || c.enabled === 'true');
    $('#cashback_percent').val(c.percent != null ? c.percent : 0);
    $('#cashback_min_spend').val(c.min_spend != null ? c.min_spend : 0);
    $('#cashback_max').val(c.max_cashback != null ? c.max_cashback : 0);
    $('#cashback_validity').val(c.validity_days != null ? c.validity_days : 30);
    $('#cashback_min_redeem').val(c.min_redeem_spend != null ? c.min_redeem_spend : 0);
    $('#cashback_bind').prop('checked', c.bind_to_customer === true || c.bind_to_customer === 'true');
    $('#cashback_channel').val(c.deliver_channel || 'none');
    $('#cashback_template').val(c.deliver_template || '');
    $('.cashback-currency-label').text(c.currency || PosnicPro.cashback.sign() || 'currency');
  },

  collect: function () {
    return {
      enabled: $('#cashback_enabled').is(':checked'),
      percent: PosnicPro.cashback.num($('#cashback_percent').val(), 0),
      min_spend: PosnicPro.cashback.num($('#cashback_min_spend').val(), 0),
      max_cashback: PosnicPro.cashback.num($('#cashback_max').val(), 0),
      validity_days: PosnicPro.cashback.num($('#cashback_validity').val(), 30),
      min_redeem_spend: PosnicPro.cashback.num($('#cashback_min_redeem').val(), 0),
      bind_to_customer: $('#cashback_bind').is(':checked'),
      deliver_channel: $('#cashback_channel').val() || 'none',
      deliver_template: $('#cashback_template').val() || '',
    };
  },

  save: function () {
    PosnicPro.put({ url: 'cashback/settings', data: JSON.stringify(PosnicPro.cashback.collect()) }, function (res) {
      PosnicPro.alert((res && res.type) || 'error', (res && res.message) || 'Could not save');
      if (res && res.type === 'success') PosnicPro.cashback.render(res.data || {});
    });
  },

  loadRecent: function () {
    PosnicPro.get('cashback/recent', function (res) {
      var rows = (res && res.data) || [];
      PosnicPro.cashback._rows = rows;
      var sign = PosnicPro.cashback.sign();
      var body = $('#cashback_recent_body').empty();
      if (!rows.length) {
        body.append('<tr><td colspan="6" class="text-center text-muted py-3">No cashback issued yet.</td></tr>');
        return;
      }
      rows.forEach(function (r) {
        var status = r.voided
          ? '<span class="badge badge-danger-inverse">Voided</span>'
          : r.delivered
            ? '<span class="badge badge-success-inverse">Sent</span>'
            : '<span class="badge badge-secondary-inverse">Issued</span>';
        body.append(
          '<tr>' +
            '<td><strong>' + PosnicPro.cashback.esc(r.code) + '</strong></td>' +
            '<td class="text-right">' + sign + (Number(r.amount) || 0).toFixed(2) + '</td>' +
            '<td>' + PosnicPro.cashback.esc(r.customer_name || 'Walk-in') + '</td>' +
            '<td class="small">' + PosnicPro.cashback.fmtDate(r.end_date) + '</td>' +
            '<td>' + status + '</td>' +
            '<td class="text-center">' + (r.voided ? '' :
              '<a href="javascript:void(0)" class="btn btn-sm btn-outline-primary cashback-print" data-code="' +
              PosnicPro.cashback.esc(r.code) + '">Print</a>') + '</td>' +
          '</tr>'
        );
      });
    });
  },

  // Print a scannable coupon: the code as a Code128 barcode (handheld scanners
  // read it straight into the till coupon box), plus the amount and expiry.
  print: function (code) {
    var r = (PosnicPro.cashback._rows || []).find(function (x) {
      return String(x.code) === String(code);
    }) || { code: code };
    var sign = PosnicPro.cashback.sign();
    var amount = sign + (Number(r.amount) || 0).toFixed(2);
    var expiry = PosnicPro.cashback.fmtDate(r.end_date);
    var shop = PosnicPro.local.get('branchname') || '';

    // Render the barcode as a self-contained SVG in this document, then embed it.
    var barcodeSvg = '';
    try {
      var holder = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      holder.id = 'cashback_tmp_barcode';
      document.body.appendChild(holder);
      if (window.JsBarcode) {
        window.JsBarcode('#cashback_tmp_barcode', code, {
          format: 'CODE128',
          displayValue: true,
          fontSize: 16,
          height: 60,
          margin: 4,
        });
        barcodeSvg = holder.outerHTML;
      }
      holder.remove();
    } catch (e) {
      barcodeSvg = '';
    }

    var w = window.open('', '_blank', 'width=420,height=640');
    if (!w) {
      PosnicPro.alert('error', 'Allow pop-ups to print the coupon.');
      return;
    }
    w.document.write(
      '<html><head><title>Cashback ' + PosnicPro.cashback.esc(code) + '</title><style>' +
        'body{font-family:Arial,Helvetica,sans-serif;text-align:center;margin:0;padding:18px;color:#111;}' +
        '.c{border:2px dashed #333;border-radius:10px;padding:18px 14px;max-width:340px;margin:0 auto;}' +
        '.t{font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#666;}' +
        '.a{font-size:34px;font-weight:800;margin:6px 0;}' +
        '.s{font-size:15px;font-weight:600;}' +
        '.code{font-size:15px;font-weight:700;letter-spacing:1px;margin-top:8px;}' +
        '.e{font-size:12px;color:#666;margin-top:10px;}' +
        'svg{max-width:100%;height:auto;margin-top:10px;}' +
        '</style></head><body><div class="c">' +
        '<div class="t">Cashback voucher</div>' +
        '<div class="a">' + amount + '</div>' +
        '<div class="s">' + PosnicPro.cashback.esc(shop) + '</div>' +
        barcodeSvg +
        '<div class="code">' + PosnicPro.cashback.esc(code) + '</div>' +
        (expiry ? '<div class="e">Use on your next purchase before ' + expiry + '</div>' : '') +
        '</div>' +
        '<script>window.onload=function(){setTimeout(function(){window.print();},150);};<\/script>' +
        '</body></html>'
    );
    w.document.close();
  },
};

$(document).on('click', '#cashback_save', function () {
  PosnicPro.cashback.save();
});
$(document).on('click', '.cashback-print', function () {
  PosnicPro.cashback.print($(this).data('code'));
});
