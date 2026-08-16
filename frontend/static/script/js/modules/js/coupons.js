/*
 * Coupons - admin screen (a tab in Settings) and the till helper.
 *
 * A coupon is a discount code. It is either a percentage or a fixed amount off
 * the bill; the fixed amount is in the branch's own currency, so nothing here
 * assumes a symbol or a country. One coupon row covers both a shared campaign
 * code (usage limits, one use per customer) and a unique one-time code
 * (usage limit 1). The till uses validate() to check a code against a live bill.
 */
PosnicPro.coupons = {
  currencySign: function () {
    return PosnicPro.local.get('currencySign') || '';
  },

  num: function (v, d) {
    var n = parseFloat(v);
    return isFinite(n) ? n : d;
  },

  esc: function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m];
    });
  },

  fmtDate: function (d) {
    if (!d) return '';
    var dt = new Date(d);
    return isNaN(dt.getTime()) ? '' : dt.toISOString().slice(0, 10);
  },

  // --------------------------------- list ---------------------------------

  load: function () {
    PosnicPro.get('coupons', function (res) {
      if (!res || res.type !== 'success') {
        PosnicPro.alert((res && res.type) || 'error', (res && res.message) || 'Failed to load coupons');
        return;
      }
      PosnicPro.coupons.render(res.data || []);
    });
  },

  render: function (rows) {
    var sign = PosnicPro.coupons.currencySign();
    var body = $('#coupons_table_body').empty();
    if (!rows.length) {
      body.append('<tr><td colspan="6" class="text-center text-muted py-3">No coupons yet.</td></tr>');
      return;
    }
    rows.forEach(function (c) {
      var value = c.type === 'fixed' ? sign + PosnicPro.coupons.num(c.value, 0) : PosnicPro.coupons.num(c.value, 0) + '%';
      var window =
        (c.start_date ? PosnicPro.coupons.fmtDate(c.start_date) : '…') +
        ' → ' +
        (c.end_date ? PosnicPro.coupons.fmtDate(c.end_date) : '…');
      var used = (c.times_used || 0) + (Number(c.usage_limit) > 0 ? ' / ' + c.usage_limit : '');
      var active = c.active
        ? '<span class="badge badge-success-inverse">Active</span>'
        : '<span class="badge badge-danger-inverse">Off</span>';
      var actions =
        '<a href="javascript:void(0)" class="point-cursor mr-2 coupon-edit" data-id="' + c._id + '" title="Edit"><i class="feather icon-edit"></i></a>' +
        '<a href="javascript:void(0)" class="point-cursor text-danger coupon-del" data-id="' + c._id + '" title="Delete"><i class="feather icon-trash"></i></a>';
      body.append(
        '<tr>' +
          '<td><strong>' + PosnicPro.coupons.esc(c.code) + '</strong>' +
          (c.description ? '<div class="text-muted small">' + PosnicPro.coupons.esc(c.description) + '</div>' : '') + '</td>' +
          '<td>' + value + '</td>' +
          '<td class="small">' + window + '</td>' +
          '<td>' + used + '</td>' +
          '<td>' + active + '</td>' +
          '<td class="text-center">' + actions + '</td>' +
        '</tr>'
      );
    });
    // keep a copy so edit can repopulate without another round-trip
    PosnicPro.coupons._rows = rows;
  },

  // --------------------------------- form ---------------------------------

  newForm: function () {
    PosnicPro.coupons.fill({ type: 'percent', active: true });
    $('#coupon_form_id').val('');
    $('#coupon_form_title').text('New coupon');
    $('#coupons_form_wrap').show();
    $('#coupon_code').focus();
  },

  editForm: function (id) {
    var c = (PosnicPro.coupons._rows || []).find(function (x) {
      return String(x._id) === String(id);
    });
    if (!c) return;
    PosnicPro.coupons.fill(c);
    $('#coupon_form_id').val(c._id);
    $('#coupon_form_title').text('Edit coupon');
    $('#coupons_form_wrap').show();
  },

  hideForm: function () {
    $('#coupons_form_wrap').hide();
  },

  fill: function (c) {
    c = c || {};
    $('#coupon_code').val(c.code || '');
    $('#coupon_description').val(c.description || '');
    $('#coupon_type').val(c.type || 'percent');
    $('#coupon_value').val(c.value != null ? c.value : 0);
    $('#coupon_min_spend').val(c.min_spend != null ? c.min_spend : 0);
    $('#coupon_max_discount').val(c.max_discount != null ? c.max_discount : 0);
    $('#coupon_start_date').val(PosnicPro.coupons.fmtDate(c.start_date));
    $('#coupon_end_date').val(PosnicPro.coupons.fmtDate(c.end_date));
    $('#coupon_usage_limit').val(c.usage_limit != null ? c.usage_limit : 0);
    $('#coupon_per_customer_limit').val(c.per_customer_limit != null ? c.per_customer_limit : 0);
    $('#coupon_active').prop('checked', c.active === undefined ? true : c.active === true || c.active === 'true');
    $('.coupon-currency-label').text(PosnicPro.coupons.currencySign() || 'currency');
  },

  collect: function () {
    return {
      code: ($('#coupon_code').val() || '').trim(),
      description: ($('#coupon_description').val() || '').trim(),
      type: $('#coupon_type').val() || 'percent',
      value: PosnicPro.coupons.num($('#coupon_value').val(), 0),
      min_spend: PosnicPro.coupons.num($('#coupon_min_spend').val(), 0),
      max_discount: PosnicPro.coupons.num($('#coupon_max_discount').val(), 0),
      start_date: $('#coupon_start_date').val() || null,
      end_date: $('#coupon_end_date').val() || null,
      usage_limit: PosnicPro.coupons.num($('#coupon_usage_limit').val(), 0),
      per_customer_limit: PosnicPro.coupons.num($('#coupon_per_customer_limit').val(), 0),
      active: $('#coupon_active').is(':checked'),
    };
  },

  save: function () {
    var data = PosnicPro.coupons.collect();
    if (!data.code) {
      PosnicPro.alert('error', 'A coupon code is required.');
      return;
    }
    var id = $('#coupon_form_id').val();
    var done = function (res) {
      PosnicPro.alert((res && res.type) || 'error', (res && res.message) || 'Could not save coupon');
      if (res && res.type === 'success') {
        PosnicPro.coupons.hideForm();
        PosnicPro.coupons.load();
      }
    };
    if (id) PosnicPro.put({ url: 'coupons/' + id, data: JSON.stringify(data) }, done);
    else PosnicPro.post({ url: 'coupons', data: JSON.stringify(data) }, done);
  },

  remove: function (id) {
    PosnicPro.delete('coupons/' + id, function (res) {
      PosnicPro.alert((res && res.type) || 'error', (res && res.message) || 'Could not delete');
      if (res && res.type === 'success') PosnicPro.coupons.load();
    });
  },

  // --------------------------------- till ---------------------------------
  // The cashier types a code and applies it; the server (validate) checks it
  // against the live bill, the customer and the coupon's limits and returns the
  // discount. We only remember the code - the sale is priced on the server.

  tillState: { code: null, discount: 0 },

  currentBill: function () {
    if (PosnicPro.loyalty && PosnicPro.loyalty.currentBill) return PosnicPro.loyalty.currentBill();
    var g = parseFloat($('#grand_total').val() || '');
    return isFinite(g) ? g : 0;
  },

  codeForPayload: function () {
    return PosnicPro.coupons.tillState && PosnicPro.coupons.tillState.code
      ? PosnicPro.coupons.tillState.code
      : '';
  },

  tillClear: function () {
    PosnicPro.coupons.tillState = { code: null, discount: 0 };
    $('#sales_coupon_code').val('');
    $('#sales_coupon_status').empty();
  },

  tillApply: function () {
    var code = ($('#sales_coupon_code').val() || '').trim();
    if (!code) {
      PosnicPro.coupons.tillState = { code: null, discount: 0 };
      $('#sales_coupon_status').empty();
      return;
    }
    var bill = PosnicPro.coupons.currentBill();
    var customerId = $('#sales_new_customer_id').val() || null;
    PosnicPro.post(
      { url: 'coupons/validate', data: JSON.stringify({ code: code, billTotal: bill, customerId: customerId }) },
      function (res) {
        var d = res && res.data;
        if (!res || res.type !== 'success' || !d) {
          PosnicPro.coupons.tillState = { code: null, discount: 0 };
          $('#sales_coupon_status').html(
            '<span class="text-danger">' + PosnicPro.coupons.esc((res && res.message) || 'Coupon not accepted') + '</span>'
          );
          return;
        }
        PosnicPro.coupons.tillState = { code: d.code, discount: d.discount };
        var sign = d.currency || PosnicPro.coupons.currencySign() || '';
        $('#sales_coupon_code').val(d.code);
        $('#sales_coupon_status').html(
          '<span class="text-success">&minus;' + sign + PosnicPro.coupons.fmtMoney(d.discount) +
            ' with ' + PosnicPro.coupons.esc(d.code) + (d.capped ? ' &middot; capped' : '') + '</span>'
        );
      }
    );
  },

  fmtMoney: function (n) {
    n = Math.round((parseFloat(n) || 0) * 100) / 100;
    return n % 1 === 0 ? String(n) : n.toFixed(2);
  },
};

$(document).on('click', '#sales_coupon_apply', function () {
  PosnicPro.coupons.tillApply();
});
$(document).on('click', '#sales_coupon_clear', function () {
  PosnicPro.coupons.tillClear();
});

// Form/list event wiring (delegated so it survives tab loads).
$(document).on('click', '#coupons_new', function () {
  PosnicPro.coupons.newForm();
});
$(document).on('click', '#coupon_form_cancel', function () {
  PosnicPro.coupons.hideForm();
});
$(document).on('click', '#coupon_form_save', function () {
  PosnicPro.coupons.save();
});
$(document).on('click', '.coupon-edit', function () {
  PosnicPro.coupons.editForm($(this).data('id'));
});
$(document).on('click', '.coupon-del', function () {
  var id = $(this).data('id');
  if (window.confirm('Delete this coupon? Past redemptions are kept for the record.')) {
    PosnicPro.coupons.remove(id);
  }
});
// Percentage caps at 100; a fixed coupon has no percent cap.
$(document).on('change', '#coupon_type', function () {
  var isPercent = $(this).val() === 'percent';
  $('#coupon_max_discount_wrap').toggle(isPercent);
});
