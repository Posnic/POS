/*
 * Credit & Reminders (khata) - admin screen (a tab in Settings).
 *
 * Sets the shop's credit rules (a default credit limit, credit terms) and how it
 * reminds customers to pay. Reminders go out through the shop's own messaging
 * providers (SMS or WhatsApp). Currency-agnostic - a limit and a due are plain
 * numbers in the branch's own currency.
 */
PosnicPro.credit = {
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

  load: function () {
    PosnicPro.get('credit/settings', function (res) {
      if (res && res.type === 'success') PosnicPro.credit.render(res.data || {});
    });
    PosnicPro.credit.loadOutstanding();
  },

  render: function (c) {
    c = c || {};
    $('#credit_default_limit').val(c.default_credit_limit != null ? c.default_credit_limit : 0);
    $('#credit_terms_days').val(c.credit_terms_days != null ? c.credit_terms_days : 0);
    $('#credit_reminder_enabled').prop('checked', c.reminder_enabled === true || c.reminder_enabled === 'true');
    $('#credit_reminder_channel').val(c.reminder_channel || 'sms');
    $('#credit_reminder_template').val(c.reminder_template || '');
    $('#credit_reminder_min_due').val(c.reminder_min_due != null ? c.reminder_min_due : 0);
    $('.credit-currency-label').text(c.currency || PosnicPro.credit.sign() || 'currency');
  },

  collect: function () {
    return {
      default_credit_limit: PosnicPro.credit.num($('#credit_default_limit').val(), 0),
      credit_terms_days: PosnicPro.credit.num($('#credit_terms_days').val(), 0),
      reminder_enabled: $('#credit_reminder_enabled').is(':checked'),
      reminder_channel: $('#credit_reminder_channel').val() || 'sms',
      reminder_template: $('#credit_reminder_template').val() || '',
      reminder_min_due: PosnicPro.credit.num($('#credit_reminder_min_due').val(), 0),
    };
  },

  save: function () {
    PosnicPro.put({ url: 'credit/settings', data: JSON.stringify(PosnicPro.credit.collect()) }, function (res) {
      PosnicPro.alert((res && res.type) || 'error', (res && res.message) || 'Could not save');
      if (res && res.type === 'success') PosnicPro.credit.render(res.data || {});
    });
  },

  loadOutstanding: function () {
    PosnicPro.get('credit/outstanding', function (res) {
      var rows = (res && res.data) || [];
      var sign = PosnicPro.credit.sign();
      var body = $('#credit_outstanding_body').empty();
      if (!rows.length) {
        body.append('<tr><td colspan="4" class="text-center text-muted py-3">No outstanding customers.</td></tr>');
        $('#credit_outstanding_total').text('0');
        return;
      }
      var total = 0;
      rows.forEach(function (r) {
        total += Number(r.due) || 0;
        body.append(
          '<tr>' +
            '<td>' + PosnicPro.credit.esc(r.name) + '</td>' +
            '<td>' + PosnicPro.credit.esc(r.phone || '') + '</td>' +
            '<td class="text-right text-danger">' + sign + (Number(r.due) || 0).toFixed(2) + '</td>' +
            '<td class="text-center"><a href="javascript:void(0)" class="btn btn-sm btn-outline-primary credit-remind-one" data-id="' + r.customer_id + '">Remind</a></td>' +
          '</tr>'
        );
      });
      $('#credit_outstanding_total').text(sign + total.toFixed(2));
    });
  },

  remindOne: function (customerId) {
    PosnicPro.post({ url: 'credit/reminder/' + customerId, data: JSON.stringify({}) }, function (res) {
      PosnicPro.alert((res && res.type) || 'error', (res && res.message) || 'Could not remind');
    });
  },

  remindAll: function (dryRun) {
    if (!dryRun && !window.confirm('Send a payment reminder to every outstanding customer now?')) return;
    // Save settings first so the run uses the latest template/channel.
    PosnicPro.put({ url: 'credit/settings', data: JSON.stringify(PosnicPro.credit.collect()) }, function () {
      PosnicPro.post({ url: 'credit/run-reminders', data: JSON.stringify({ dryRun: !!dryRun }) }, function (res) {
        if (!res || res.type !== 'success') {
          PosnicPro.alert((res && res.type) || 'error', (res && res.message) || 'Run failed');
          return;
        }
        var d = res.data || {};
        PosnicPro.alert(
          'success',
          (dryRun ? 'Dry run: ' : 'Reminders: ') + (d.sent || 0) + ' sent, ' + (d.failed || 0) + ' failed, ' + (d.skipped || 0) + ' skipped'
        );
      });
    });
  },
};

$(document).on('click', '#credit_save', function () {
  PosnicPro.credit.save();
});
$(document).on('click', '.credit-remind-one', function () {
  PosnicPro.credit.remindOne($(this).data('id'));
});
$(document).on('click', '#credit_remind_all', function () {
  PosnicPro.credit.remindAll(false);
});
$(document).on('click', '#credit_remind_test', function () {
  PosnicPro.credit.remindAll(true);
});
