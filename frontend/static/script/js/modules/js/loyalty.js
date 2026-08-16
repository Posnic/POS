/*
 * Loyalty & Rewards - client side.
 *
 * The rules are configured per branch and are deliberately currency- and
 * country-agnostic: a point is just a point, and every rate is a ratio against
 * the branch's own currency. Nothing here assumes a symbol or a country - the
 * currency label is only ever a decoration read from the branch settings, while
 * the numbers the cashier and the customer see are pure counts and ratios.
 *
 * This namespace is shared: the Settings tab uses load()/save(), and the
 * customer and till screens use summary() to show a balance and a tier.
 */
PosnicPro.loyalty = {
  // The branch's currency symbol, used only as a label next to amounts.
  currencySign: function () {
    return PosnicPro.local.get('currencySign') || '';
  },

  num: function (v, d) {
    var n = parseFloat(v);
    return isFinite(n) ? n : d;
  },

  // ------------------------------- settings -------------------------------

  load: function () {
    PosnicPro.get('loyalty/config', function (res) {
      if (!res || res.type !== 'success') {
        PosnicPro.alert((res && res.type) || 'error', (res && res.message) || 'Failed to load loyalty settings');
        return;
      }
      PosnicPro.loyalty.render(res.data || {});
    });
    PosnicPro.loyalty.loadLiability();
  },

  // Outstanding points and what they would cost if every customer redeemed.
  loadLiability: function () {
    PosnicPro.get('loyalty/report/liability', function (res) {
      if (!res || res.type !== 'success' || !res.data) return;
      var d = res.data;
      var sign = d.currency || PosnicPro.loyalty.currencySign() || '';
      $('#loyalty_liab_members').text(d.members || 0);
      $('#loyalty_liab_points').text(d.totalPoints || 0);
      $('#loyalty_liab_value').text(sign + PosnicPro.loyalty.fmt(d.totalValue || 0));
      var body = $('#loyalty_liab_tier_body').empty();
      (d.byTier || []).forEach(function (t) {
        body.append(
          '<tr><td>' + PosnicPro.loyalty.esc(t.tier) + '</td>' +
            '<td class="text-right">' + (t.members || 0) + '</td>' +
            '<td class="text-right">' + (t.points || 0) + '</td>' +
            '<td class="text-right">' + sign + PosnicPro.loyalty.fmt(t.value || 0) + '</td></tr>'
        );
      });
      $('#loyalty_liab_tier_wrap').toggle((d.byTier || []).length > 0);
      $('#loyalty_liability').show();
    });
  },

  render: function (c) {
    c = c || {};
    var sign = c.currency || PosnicPro.loyalty.currencySign();
    $('.loyalty-currency-label').text(sign || 'currency');

    $('#loyalty_enabled').prop('checked', c.enabled === true || c.enabled === 'true');
    $('#loyalty_earn_points').val(c.earn_points != null ? c.earn_points : 1);
    $('#loyalty_earn_amount').val(c.earn_amount != null ? c.earn_amount : 100);
    $('#loyalty_min_spend').val(c.min_spend != null ? c.min_spend : 0);
    $('#loyalty_earn_rounding').val(c.earn_rounding || 'floor');
    $('#loyalty_redeem_points').val(c.redeem_points != null ? c.redeem_points : 1);
    $('#loyalty_redeem_value').val(c.redeem_value != null ? c.redeem_value : 1);
    $('#loyalty_min_redeem').val(c.min_redeem != null ? c.min_redeem : 0);
    $('#loyalty_max_redeem_percent').val(c.max_redeem_percent != null ? c.max_redeem_percent : 100);
    $('#loyalty_expiry_months').val(c.expiry_months != null ? c.expiry_months : 0);

    $('#loyalty_referral_enabled').prop('checked', c.referral_enabled === true || c.referral_enabled === 'true');
    $('#loyalty_referral_referrer_points').val(c.referral_referrer_points != null ? c.referral_referrer_points : 0);
    $('#loyalty_referral_referee_points').val(c.referral_referee_points != null ? c.referral_referee_points : 0);
    $('#loyalty_referral_min_spend').val(c.referral_min_spend != null ? c.referral_min_spend : 0);

    var body = $('#loyalty_tiers_body').empty();
    var tiers = Array.isArray(c.tiers) && c.tiers.length ? c.tiers : [{ name: 'Member', threshold: 0, multiplier: 1 }];
    tiers.forEach(function (t) {
      body.append(PosnicPro.loyalty.tierRow(t));
    });
    PosnicPro.loyalty.toggleEnabledState();
    PosnicPro.loyalty.updatePreview();
  },

  tierRow: function (t) {
    t = t || {};
    var row = $(
      '<tr>' +
        '<td><input type="text" class="form-control loyalty-tier-name" placeholder="Tier name"></td>' +
        '<td><input type="number" min="0" step="1" class="form-control loyalty-tier-threshold" placeholder="0"></td>' +
        '<td><input type="number" min="0" step="0.01" class="form-control loyalty-tier-multiplier" placeholder="1"></td>' +
        '<td class="text-center"><a href="javascript:void(0)" class="btn btn-danger-rgba loyalty-tier-remove" title="Remove tier"><i class="feather icon-trash"></i></a></td>' +
      '</tr>'
    );
    row.find('.loyalty-tier-name').val(t.name || '');
    row.find('.loyalty-tier-threshold').val(t.threshold != null ? t.threshold : 0);
    row.find('.loyalty-tier-multiplier').val(t.multiplier != null ? t.multiplier : 1);
    return row;
  },

  addTier: function () {
    $('#loyalty_tiers_body').append(PosnicPro.loyalty.tierRow({ name: '', threshold: 0, multiplier: 1 }));
  },

  collect: function () {
    var tiers = [];
    $('#loyalty_tiers_body tr').each(function () {
      var name = ($(this).find('.loyalty-tier-name').val() || '').trim();
      if (!name) return; // skip blank rows
      tiers.push({
        name: name,
        threshold: PosnicPro.loyalty.num($(this).find('.loyalty-tier-threshold').val(), 0),
        multiplier: PosnicPro.loyalty.num($(this).find('.loyalty-tier-multiplier').val(), 1),
      });
    });
    return {
      enabled: $('#loyalty_enabled').is(':checked'),
      earn_points: PosnicPro.loyalty.num($('#loyalty_earn_points').val(), 1),
      earn_amount: PosnicPro.loyalty.num($('#loyalty_earn_amount').val(), 100),
      min_spend: PosnicPro.loyalty.num($('#loyalty_min_spend').val(), 0),
      earn_rounding: $('#loyalty_earn_rounding').val() || 'floor',
      redeem_points: PosnicPro.loyalty.num($('#loyalty_redeem_points').val(), 1),
      redeem_value: PosnicPro.loyalty.num($('#loyalty_redeem_value').val(), 1),
      min_redeem: PosnicPro.loyalty.num($('#loyalty_min_redeem').val(), 0),
      max_redeem_percent: PosnicPro.loyalty.num($('#loyalty_max_redeem_percent').val(), 100),
      expiry_months: PosnicPro.loyalty.num($('#loyalty_expiry_months').val(), 0),
      referral_enabled: $('#loyalty_referral_enabled').is(':checked'),
      referral_referrer_points: PosnicPro.loyalty.num($('#loyalty_referral_referrer_points').val(), 0),
      referral_referee_points: PosnicPro.loyalty.num($('#loyalty_referral_referee_points').val(), 0),
      referral_min_spend: PosnicPro.loyalty.num($('#loyalty_referral_min_spend').val(), 0),
      tiers: tiers,
    };
  },

  save: function () {
    var data = PosnicPro.loyalty.collect();
    if (data.earn_amount <= 0 || data.earn_points <= 0) {
      PosnicPro.alert('error', 'Earn rate needs a points value and an amount greater than zero.');
      return;
    }
    PosnicPro.put({ url: 'loyalty/config', data: JSON.stringify(data) }, function (res) {
      PosnicPro.alert((res && res.type) || 'error', (res && res.message) || 'Could not save');
      if (res && res.type === 'success') PosnicPro.loyalty.render(res.data || data);
    });
  },

  // Enable/disable dims the rules when loyalty is off, but never hides them.
  toggleEnabledState: function () {
    var on = $('#loyalty_enabled').is(':checked');
    $('#loyalty_rules_fieldset').css('opacity', on ? '1' : '0.55');
  },

  // A tiny worked example so the shop can see what a rate means before saving.
  // Mirrors the server maths (floor by default) for the current field values.
  updatePreview: function () {
    var sign = ($('.loyalty-currency-label').first().text() || '').replace('currency', '');
    var earnPts = PosnicPro.loyalty.num($('#loyalty_earn_points').val(), 0);
    var earnAmt = PosnicPro.loyalty.num($('#loyalty_earn_amount').val(), 0);
    var rounding = $('#loyalty_earn_rounding').val() || 'floor';
    var sample = earnAmt > 0 ? earnAmt * 10 : 1000; // a representative bill
    var raw = earnAmt > 0 && earnPts > 0 ? (sample / earnAmt) * earnPts : 0;
    var pts = rounding === 'ceil' ? Math.ceil(raw) : rounding === 'round' ? Math.round(raw) : Math.floor(raw);

    var rPts = PosnicPro.loyalty.num($('#loyalty_redeem_points').val(), 1);
    var rVal = PosnicPro.loyalty.num($('#loyalty_redeem_value').val(), 0);
    var per = rPts > 0 ? rVal / rPts : 0;

    $('#loyalty_preview_earn').text('A ' + sign + PosnicPro.loyalty.fmt(sample) + ' sale earns ' + pts + ' point' + (pts === 1 ? '' : 's') + '.');
    $('#loyalty_preview_redeem').text(
      per > 0
        ? '100 points are worth ' + sign + PosnicPro.loyalty.fmt(100 * per) + ' off a bill.'
        : 'Redemption is turned off (points have no cash value).'
    );
  },

  fmt: function (n) {
    n = Math.round((parseFloat(n) || 0) * 100) / 100;
    return n % 1 === 0 ? String(n) : n.toFixed(2);
  },

  // ------------------------------- summary --------------------------------
  // Shared read used by the customer view and the till to show a badge.

  summary: function (customerId, cb) {
    if (!customerId) {
      cb && cb(null);
      return;
    }
    PosnicPro.get('loyalty/customer/' + customerId, function (res) {
      cb && cb(res && res.type === 'success' ? res.data : null);
    });
  },

  // ------------------------------- till ----------------------------------
  // The New Sale screen shows the selected customer's balance and tier, and
  // (when redemption is on) lets the cashier spend points as a discount. The
  // summary is cached so redeem-at-checkout can validate without another call.

  tillState: { customerId: null, summary: null, redeem: null },

  tillShow: function (customerId) {
    PosnicPro.loyalty.tillState = { customerId: customerId || null, summary: null, redeem: null };
    if (!customerId) {
      PosnicPro.loyalty.tillClear();
      return;
    }
    PosnicPro.loyalty.summary(customerId, function (s) {
      if (PosnicPro.loyalty.tillState.customerId !== customerId) return; // selection moved on
      if (!s || !s.enabled) {
        PosnicPro.loyalty.tillClear();
        return;
      }
      PosnicPro.loyalty.tillState.summary = s;
      $('#sales_loyalty_badge').html(PosnicPro.loyalty.badgeHtml(s));
      var per = Number(s.redeemValuePerPoint) || 0;
      $('#sales_loyalty_hint').text(
        per > 0 ? 'Each point = ' + (s.currency || '') + PosnicPro.loyalty.fmt(per) : ''
      );
      $('#sales_loyalty_redeem_wrap').toggle(per > 0 && (Number(s.balance) || 0) > 0);
      $('#sales_loyalty_redeem_points').val('');
      $('#sales_loyalty_redeem_status').empty();
      $('#sales_loyalty_panel').show();
    });
  },

  tillClear: function () {
    PosnicPro.loyalty.tillState = { customerId: null, summary: null, redeem: null };
    $('#sales_loyalty_badge').empty();
    $('#sales_loyalty_hint').empty();
    $('#sales_loyalty_redeem_points').val('');
    $('#sales_loyalty_redeem_status').empty();
    $('#sales_loyalty_redeem_wrap').hide();
    $('#sales_loyalty_panel').hide();
  },

  // Small inline HTML badge: "Gold - 1,240 pts". Currency-free by design.
  badgeHtml: function (data) {
    if (!data || !data.enabled) return '';
    var tier = data.tier ? '<span class="loyalty-tier-name-badge">' + PosnicPro.loyalty.esc(data.tier) + '</span> ' : '';
    return (
      '<span class="loyalty-badge badge badge-warning-rgba">' +
      '<i class="feather icon-award mr-1"></i>' +
      tier +
      '<strong>' + (Number(data.balance) || 0) + '</strong> pts' +
      '</span>'
    );
  },

  esc: function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m];
    });
  },
};

// Live preview + enable toggle wiring (delegated, so it survives tab loads).
$(document).on(
  'input change',
  '#loyalty_earn_points, #loyalty_earn_amount, #loyalty_earn_rounding, #loyalty_redeem_points, #loyalty_redeem_value',
  function () {
    PosnicPro.loyalty.updatePreview();
  }
);
$(document).on('change', '#loyalty_enabled', function () {
  PosnicPro.loyalty.toggleEnabledState();
});
$(document).on('click', '#loyalty_add_tier', function () {
  PosnicPro.loyalty.addTier();
});
$(document).on('click', '.loyalty-tier-remove', function () {
  if ($('#loyalty_tiers_body tr').length > 1) $(this).closest('tr').remove();
});
$(document).on('click', '#loyalty_save', function () {
  PosnicPro.loyalty.save();
});

// --- Redeem at the till ---------------------------------------------------
// The cashier types points to spend; the server (via preview) decides what
// they are worth against the branch rules and the live bill, and caps them.
// We only remember the decision - the sale is priced on the server at save.
PosnicPro.loyalty.currentBill = function () {
  var g = parseFloat($('#grand_total').val() || '');
  if (isFinite(g) && g > 0) return g;
  var t = parseFloat(($('#sales_new_grand_total').text() || '0').replace(/,/g, ''));
  return isFinite(t) ? t : 0;
};

// The points to submit with the sale, if a redemption was applied.
PosnicPro.loyalty.redeemPointsForPayload = function () {
  var r = PosnicPro.loyalty.tillState && PosnicPro.loyalty.tillState.redeem;
  return r && r.points > 0 ? r.points : 0;
};

// Refresh the till totals so spent points show in Pay Total / Discount.
PosnicPro.loyalty.recalc = function () {
  if (window.PosnicPro && PosnicPro.sales && PosnicPro.sales.calculation &&
      PosnicPro.sales.calculation.salesTableRowCart) {
    PosnicPro.sales.calculation.salesTableRowCart();
  }
};

$(document).on('click', '#sales_loyalty_redeem_apply', function () {
  var st = PosnicPro.loyalty.tillState;
  if (!st || !st.customerId || !st.summary) return;
  var pts = PosnicPro.loyalty.num($('#sales_loyalty_redeem_points').val(), 0);
  if (pts <= 0) {
    PosnicPro.loyalty.tillState.redeem = null;
    $('#sales_loyalty_redeem_status').empty();
    PosnicPro.loyalty.recalc();
    return;
  }
  var bill = PosnicPro.loyalty.currentBill();
  PosnicPro.post(
    {
      url: 'loyalty/preview',
      data: JSON.stringify({ redeemPoints: pts, billTotal: bill, availablePoints: st.summary.balance }),
    },
    function (res) {
      var rd = res && res.data ? res.data.redeem : null;
      if (!res || res.type !== 'success' || !rd) {
        PosnicPro.alert('error', (res && res.message) || 'Could not apply points');
        return;
      }
      if (!rd.valid) {
        PosnicPro.loyalty.tillState.redeem = null;
        $('#sales_loyalty_redeem_status').html(
          '<span class="text-danger">' + PosnicPro.loyalty.esc(rd.error || 'Cannot redeem these points') + '</span>'
        );
        PosnicPro.loyalty.recalc();
        return;
      }
      PosnicPro.loyalty.tillState.redeem = { points: rd.points, value: rd.value };
      var sign = st.summary.currency || '';
      $('#sales_loyalty_redeem_points').val(rd.points);
      $('#sales_loyalty_redeem_status').html(
        '<span class="text-success">&minus;' + sign + PosnicPro.loyalty.fmt(rd.value) +
          ' will apply (' + rd.points + ' pts)' + (rd.capped ? ' &middot; capped to the bill limit' : '') + '</span>'
      );
      PosnicPro.loyalty.recalc();
    }
  );
});

$(document).on('click', '#sales_loyalty_redeem_clear', function () {
  if (PosnicPro.loyalty.tillState) PosnicPro.loyalty.tillState.redeem = null;
  $('#sales_loyalty_redeem_points').val('');
  $('#sales_loyalty_redeem_status').empty();
  PosnicPro.loyalty.recalc();
});
