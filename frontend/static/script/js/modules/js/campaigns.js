/*
 * Campaigns - admin screen (a tab in Settings).
 *
 * Reach a segment of customers with a message over SMS or WhatsApp. Sending is
 * deliberately deliberate: you preview the reach, can send a dry run that
 * dispatches nothing, and the review screen is the final confirmation. Opt-outs and
 * customers with no phone are skipped on the server; a customer is never
 * messaged twice for the same campaign.
 */
PosnicPro.campaigns = {
  _rows: [],
  _selection: { customers: {}, category: {} },
  _searchVersion: 0,
  _reviewVersion: 0,

  mountAudience: function () {
    if ($('#campaign_picker').length) return;
    if (!$('#campaign_seg_type option[value="customers"]').length) $('#campaign_seg_type').append('<option value="customers" data-t="lang_choose_customers">Choose customers</option>');
    $('#campaign_seg_type').parent().removeClass('col-md-3').addClass('col-12');
    $('#campaign_seg_category_wrap').hide();
    $('#campaign_seg_type').closest('.form-row').after('<div id="campaign_picker" class="mb-3" hidden>' +
      '<div id="campaign_selected" class="message-choices mb-2" aria-live="polite"></div>' +
      '<label for="campaign_search"><lang class="lang_search_by_name_or_phone">Search by name or phone</lang></label><input id="campaign_search" type="search" class="form-control" autocomplete="off">' +
      '<div id="campaign_matches" class="message-matches" aria-live="polite"></div><small class="text-muted"><lang class="lang_up_to_50_matches_refine_your_search_to_fin">Up to 50 matches. Refine your search to find more. Selections stay when you search again.</lang></small></div>');
    $('#campaign_message').before('<details class="campaign-starters"><summary>Use a message starter</summary><div class="message-choices" aria-label="Message starters" data-t-aria-label="lang_message_starters">' +
      [['offer','tag','Offer'], ['christmas','gift','Christmas'], ['newyear','sun','New Year'], ['custom','edit-3','Custom']].map(function (p) {
        return '<button type="button" class="btn btn-light" data-message-preset="' + p[0] + '"><i class="feather icon-' + p[1] + ' mr-2" aria-hidden="true"></i>' + p[2] + '</button>';
      }).join('') + '</div></details>');
    $('#campaign_message').after('<aside class="campaign-preview-panel"><div class="campaign-preview-label"><lang class="lang_customer_preview">CUSTOMER PREVIEW</lang></div><p class="text-muted small"><lang class="lang_an_example_of_your_message">An example of your message</lang></p><div class="message-preview"><div id="campaign_message_preview"></div></div><p class="text-muted small mt-3"><lang class="lang_names_and_loyalty_details_are_filled_in_fo">Names and loyalty details are filled in for each customer.</lang></p></aside>');
    PosnicPro.campaigns.layoutComposer();
  },

  layoutComposer: function () {
    var form = $('#campaigns_form_wrap'), body = form.children('.card-body');
    form.addClass('campaign-composer');
    if (!$('#campaign_send_result').length) form.before('<div id="campaign_send_result" hidden tabindex="-1"></div>');
    form.parent().children('p').first().text(PosnicPro.i18n.t('lang_send_offers_greetings_and_updates_to_your', 'Send offers, greetings and updates to your customers.'));
    var meta = $('#campaign_name').closest('.form-row').addClass('campaign-meta');
    var audience = $('#campaign_seg_type').closest('.form-row');
    var message = $('#campaign_message').parent().addClass('campaign-message-field');
    var preview = $('.campaign-preview-panel').detach();
    $('#campaign_message').attr('rows', 7);
    $('#campaign_name').parent().removeClass('col-md-6').addClass('col-md-8');
    $('#campaign_channel').parent().removeClass('col-md-3').addClass('col-md-4');
    body.append('<div class="campaign-compose-grid"><div class="campaign-editor"></div><div class="campaign-preview-column"></div></div>');
    var editor = body.find('.campaign-editor');
    meta.appendTo(editor);
    editor.append('<section class="campaign-section campaign-recipients"><h3><lang class="lang_recipients">Recipients</lang></h3><p class="text-muted small"><lang class="lang_choose_who_should_receive_this_message">Choose who should receive this message.</lang></p></section>');
    audience.appendTo(editor.find('.campaign-recipients'));
    $('#campaign_picker').appendTo(editor.find('.campaign-recipients'));
    message.appendTo(editor);
    preview.appendTo(body.find('.campaign-preview-column'));
    $('#campaign_message').siblings('label').text(PosnicPro.i18n.t('lang_your_message', 'Your message'));
    $('#campaign_message').siblings('.mb-1').addClass('campaign-personalise');
    $('#campaign_selected').removeClass('message-choices').addClass('campaign-selection-chips');
    $('#campaign_picker > small').text(PosnicPro.i18n.t('lang_search_and_select_more_than_one_your_selec', 'Search and select more than one. Your selections are kept.'));
    var actions = $('#campaign_preview_btn').parent().empty();
    actions.removeClass().addClass('campaign-footer').append('<button type="button" class="btn btn-link text-muted" id="campaign_form_cancel"><lang class="lang_cancel_title">Cancel</lang></button><div class="campaign-footer-actions"><button type="button" class="btn btn-light" id="campaign_save_draft"><lang class="lang_save_draft">Save draft</lang></button><button type="button" class="btn btn-primary" id="campaign_preview_btn">Review message <span aria-hidden="true">→</span></button></div>');
    actions.appendTo(body);
    body.append('<section id="campaign_review" class="campaign-review" hidden tabindex="-1"><h3><lang class="lang_review_before_sending">Review before sending</lang></h3><div id="campaign_review_message" class="message-preview"></div><div id="campaign_review_reach"></div><div class="campaign-review-actions"><button type="button" class="btn btn-primary" id="campaign_send_btn"><lang class="lang_send_now">Send now</lang></button><button type="button" class="btn btn-link" id="campaign_edit_again"><lang class="lang_back_to_editing">Back to editing</lang></button></div><details class="campaign-delivery-options"><summary>Scheduling and checks</summary><p class="small text-muted mt-2">Scheduled sending requires the server’s campaign scheduler to be running.</p><label for="campaign_schedule_at"><lang class="lang_send_at">Send at</lang></label><div class="campaign-schedule"><input type="datetime-local" class="form-control" id="campaign_schedule_at"><button type="button" class="btn btn-light" id="campaign_schedule_btn"><lang class="lang_schedule">Schedule</lang></button></div><button type="button" class="btn btn-link" id="campaign_test_btn"><lang class="lang_check_without_sending">Check without sending</lang></button></details></section>');
    $('#campaign_preview_out').remove();
  },

  invalidateReview: function () {
    ++PosnicPro.campaigns._reviewVersion;
    $('#campaign_review').prop('hidden', true);
    $('#campaigns_form_wrap').removeClass('is-reviewing');
    $('.campaign-compose-grid, .campaign-footer').prop('hidden', false);
    $('#campaign_preview_btn').prop('disabled', false).text('Review message →');
  },

  selectedKind: function () { return $('#campaign_seg_type').val(); },

  showSelected: function () {
    var self = PosnicPro.campaigns, kind = self.selectedKind(), selected = self._selection[kind] || {};
    $('#campaign_selected').html(Object.keys(selected).map(function (id) {
      return '<button type="button" class="btn btn-outline-secondary" data-remove-recipient="' + self.esc(id) + '">' + self.esc(selected[id]) + ' <span aria-hidden="true">×</span><span class="sr-only"> Remove</span></button>';
    }).join(''));
  },

  searchAudience: function (ids) {
    var self = PosnicPro.campaigns, kind = self.selectedKind();
    if (kind !== 'category' && kind !== 'customers') return;
    var version = ++self._searchVersion;
    $('#campaign_matches').text('Loading…');
    PosnicPro.get('campaigns/audience-options?kind=' + kind + '&search=' + encodeURIComponent($('#campaign_search').val() || '') +
      (ids ? '&ids=' + encodeURIComponent(ids.join(',')) : ''), function (res) {
      if (version !== self._searchVersion || kind !== self.selectedKind()) return;
      if (!res || res.type !== 'success') { $('#campaign_matches').text((res && res.message) || 'Could not load customers. Try searching again.'); return; }
      var rows = res.data || [];
      if (ids) rows.forEach(function (r) { self._selection[kind][String(r._id)] = r.name || r.phone || 'Unnamed'; });
      self.showSelected();
      $('#campaign_matches').html(rows.length ? rows.map(function (r) {
        return '<label class="message-match"><input type="checkbox" data-recipient="' + self.esc(r._id) + '" data-name="' + self.esc(r.name || r.phone || 'Unnamed') + '" ' +
          (self._selection[kind][String(r._id)] ? 'checked' : '') + '> <span>' + self.esc(r.name || 'Unnamed') + '<small class="d-block text-muted">' + self.esc(r.phone || '') + '</small></span></label>';
      }).join('') : '<p class="text-muted py-2"><lang class="lang_no_matches_found">No matches found.</lang></p>');
    });
  },

  previewText: function () {
    $('#campaign_message_preview').text(($('#campaign_message').val() || '').replace(/\{name\}/g, 'Customer').replace(/\{points\}/g, '100').replace(/\{tier\}/g, 'Member'));
  },

  esc: function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m];
    });
  },

  num: function (v, d) {
    var n = parseFloat(v);
    return isFinite(n) ? n : d;
  },

  // --------------------------------- list ---------------------------------

  load: function () {
    PosnicPro.campaigns.mountAudience();
    PosnicPro.campaigns.loadTierOptions();
    PosnicPro.get('campaigns', function (res) {
      if (!res || res.type !== 'success') {
        PosnicPro.alert((res && res.type) || 'error', (res && res.message) || 'Failed to load campaigns');
        return;
      }
      PosnicPro.campaigns._rows = res.data || [];
      PosnicPro.campaigns.render(res.data || []);
    });
  },

  // Tier names come from the loyalty config so the segment matches real tiers.
  loadTierOptions: function () {
    PosnicPro.get('loyalty/config', function (res) {
      var tiers = res && res.data && res.data.tiers ? res.data.tiers : [];
      var sel = $('#campaign_seg_tier').empty();
      tiers.forEach(function (t) {
        sel.append('<option value="' + PosnicPro.campaigns.esc(t.name) + '">' + PosnicPro.campaigns.esc(t.name) + '</option>');
      });
    });
  },

  segLabel: function (seg) {
    seg = seg || {};
    switch (seg.type) {
      case 'tier':
        return 'Tier: ' + PosnicPro.campaigns.esc(seg.tier || '');
      case 'min_points':
        return '≥ ' + (seg.min_points || 0) + ' points';
      case 'category':
        return 'Category';
      case 'customers':
        return (seg.customer_ids || []).length + ' selected customers';
      case 'lapsed':
        return 'No purchase in ' + (seg.lapsed_days || 0) + 'd';
      default:
        return 'All customers';
    }
  },

  statusBadge: function (s) {
    var map = {
      draft: 'badge-secondary-inverse',
      scheduled: 'badge-info-inverse',
      sending: 'badge-warning-inverse',
      sent: 'badge-success-inverse',
      partial: 'badge-warning-inverse',
      cancelled: 'badge-danger-inverse',
    };
    return '<span class="badge ' + (map[s] || 'badge-secondary-inverse') + '">' + PosnicPro.campaigns.esc(s || 'draft') + '</span>';
  },

  render: function (rows) {
    var body = $('#campaigns_table_body').empty();
    if (!rows.length) {
      body.append('<tr><td colspan="6" class="text-center text-muted py-3"><lang class="lang_no_campaigns_yet">No campaigns yet.</lang></td></tr>');
      return;
    }
    rows.forEach(function (c) {
      var reach = (c.sent_count || 0) + ' sent' + (c.failed_count ? ', ' + c.failed_count + ' failed' : '');
      body.append(
        '<tr>' +
          '<td><strong>' + PosnicPro.campaigns.esc(c.name) + '</strong>' +
          '<div class="text-muted small">' + PosnicPro.campaigns.esc(c.message || '') + '</div></td>' +
          '<td class="text-uppercase small">' + PosnicPro.campaigns.esc(c.channel) + '</td>' +
          '<td class="small">' + PosnicPro.campaigns.segLabel(c.segment) + '</td>' +
          '<td>' + PosnicPro.campaigns.statusBadge(c.status) + '</td>' +
          '<td class="small">' + reach + '</td>' +
          '<td class="text-center text-nowrap">' +
            '<a href="javascript:void(0)" class="point-cursor mr-2 campaign-edit" data-id="' + c._id + '" title="Open" data-t-title="lang_open"><i class="feather icon-edit"></i></a>' +
            '<a href="javascript:void(0)" class="point-cursor text-danger campaign-del" data-id="' + c._id + '" title="Delete" data-t-title="lang_delete"><i class="feather icon-trash"></i></a>' +
          '</td>' +
        '</tr>'
      );
    });
  },

  // --------------------------------- form ---------------------------------

  newForm: function () {
    PosnicPro.campaigns.fill({ channel: 'whatsapp', segment: { type: 'all' } });
    $('#campaign_form_id').val('');
    $('#campaign_form_title').text(PosnicPro.i18n.t('lang_new_campaign', 'New campaign'));
    $('#campaign_preview_out').empty();
    $('#campaigns_form_wrap').show().siblings('.table-responsive').hide();
    $('#campaigns_new').hide();
    $('#campaign_name').focus();
  },

  editForm: function (id) {
    var c = (PosnicPro.campaigns._rows || []).find(function (x) {
      return String(x._id) === String(id);
    });
    if (!c) return;
    PosnicPro.campaigns.fill(c);
    $('#campaign_form_id').val(c._id);
    $('#campaign_form_title').text(c.status === 'sent' || c.status === 'partial' ? PosnicPro.i18n.t('lang_campaign_sent', 'Campaign (sent)') : PosnicPro.i18n.t('lang_edit_campaign', 'Edit campaign'));
    $('#campaign_preview_out').empty();
    $('#campaigns_form_wrap').show().siblings('.table-responsive').hide();
    $('#campaigns_new').hide();
  },

  hideForm: function () {
    $('#campaigns_form_wrap').hide().siblings('.table-responsive').show();
    $('#campaigns_new').show();
  },

  fill: function (c) {
    PosnicPro.campaigns.mountAudience();
    PosnicPro.campaigns.invalidateReview();
    c = c || {};
    var seg = c.segment || { type: 'all' };
    $('#campaign_name').val(c.name || '');
    $('#campaign_channel').val(c.channel || 'whatsapp');
    $('#campaign_message').val(c.message || '');
    $('#campaign_seg_type').val(seg.type || 'all');
    $('#campaign_seg_tier').val(seg.tier || '');
    $('#campaign_seg_min_points').val(seg.min_points != null ? seg.min_points : 0);
    $('#campaign_seg_lapsed_days').val(seg.lapsed_days != null ? seg.lapsed_days : 30);
    $('#campaign_seg_category').val(seg.category_id || '');
    var self = PosnicPro.campaigns;
    self._selection = { customers: {}, category: {} };
    (seg.customer_ids || []).forEach(function (id) { self._selection.customers[String(id)] = 'Selected customer'; });
    (seg.category_ids || (seg.category_id ? [seg.category_id] : [])).forEach(function (id) { self._selection.category[String(id)] = 'Selected category'; });
    $('#campaign_search').val('');
    PosnicPro.campaigns.toggleSegFields();
    if (self._selection[seg.type] && Object.keys(self._selection[seg.type]).length) self.searchAudience(Object.keys(self._selection[seg.type]));
    self.previewText();
  },

  toggleSegFields: function () {
    var t = $('#campaign_seg_type').val();
    $('.campaign-seg-field').hide();
    $('#campaign_seg_' + t + '_wrap').show();
    $('#campaign_seg_category_wrap').hide();
    $('[data-audience]').each(function () { $(this).attr('aria-pressed', String($(this).data('audience') === t)); });
    $('#campaign_picker').prop('hidden', t !== 'category' && t !== 'customers');
    $('label[for="campaign_search"]').text(t === 'category' ? PosnicPro.i18n.t('lang_search_categories', 'Search categories') : PosnicPro.i18n.t('lang_search_customers_by_name_or_phone', 'Search customers by name or phone'));
    PosnicPro.campaigns.showSelected();
    PosnicPro.campaigns.searchAudience();
  },

  collectSegment: function () {
    var t = $('#campaign_seg_type').val() || 'all';
    var seg = { type: t };
    if (t === 'tier') seg.tier = $('#campaign_seg_tier').val() || '';
    if (t === 'min_points') seg.min_points = PosnicPro.campaigns.num($('#campaign_seg_min_points').val(), 0);
    if (t === 'lapsed') seg.lapsed_days = PosnicPro.campaigns.num($('#campaign_seg_lapsed_days').val(), 30);
    if (t === 'category') seg.category_ids = Object.keys(PosnicPro.campaigns._selection.category);
    if (t === 'customers') seg.customer_ids = Object.keys(PosnicPro.campaigns._selection.customers);
    return seg;
  },

  collect: function () {
    return {
      name: ($('#campaign_name').val() || '').trim(),
      channel: $('#campaign_channel').val() || 'whatsapp',
      message: ($('#campaign_message').val() || '').trim(),
      segment: PosnicPro.campaigns.collectSegment(),
    };
  },

  save: function (after, failed) {
    var data = PosnicPro.campaigns.collect();
    if ((data.segment.type === 'category' && !data.segment.category_ids.length) ||
        (data.segment.type === 'customers' && !data.segment.customer_ids.length)) {
      PosnicPro.alert('error', PosnicPro.i18n.t('lang_select_at_least_one_customer_or_category', 'Select at least one customer or category.'));
      return;
    }
    if (!data.name) {
      PosnicPro.alert('error', PosnicPro.i18n.t('lang_a_campaign_name_is_required', 'A campaign name is required.'));
      return;
    }
    if (!data.message) {
      PosnicPro.alert('error', PosnicPro.i18n.t('lang_a_message_is_required', 'A message is required.'));
      return;
    }
    var id = $('#campaign_form_id').val();
    var done = function (res) {
      if (res && res.type === 'success') {
        if (res.data && res.data._id) $('#campaign_form_id').val(res.data._id);
        if (typeof after !== 'function') PosnicPro.campaigns.load();
        if (typeof after === 'function') after(res.data);
        else PosnicPro.alert('success', res.message || 'Saved');
      } else {
        if (typeof failed === 'function') failed();
        PosnicPro.alert((res && res.type) || 'error', (res && res.message) || 'Could not save');
      }
    };
    if (id) PosnicPro.put({ url: 'campaigns/' + id, data: JSON.stringify(data) }, done, failed);
    else PosnicPro.post({ url: 'campaigns', data: JSON.stringify(data) }, done, failed);
    return true;
  },

  remove: function (id) {
    PosnicPro.delete('campaigns/' + id, function (res) {
      PosnicPro.alert((res && res.type) || 'error', (res && res.message) || 'Could not delete');
      if (res && res.type === 'success') PosnicPro.campaigns.load();
    });
  },

  // ------------------------------- actions --------------------------------

  preview: function () {
    var self = PosnicPro.campaigns, data = self.collect();
    if (!data.name || !data.message) { PosnicPro.alert('error', PosnicPro.i18n.t('lang_enter_a_campaign_name_and_message', 'Enter a campaign name and message.')); return; }
    var seg = data.segment;
    if ((seg.type === 'category' && !seg.category_ids.length) || (seg.type === 'customers' && !seg.customer_ids.length)) {
      PosnicPro.alert('error', PosnicPro.i18n.t('lang_select_at_least_one_customer_or_category', 'Select at least one customer or category.')); return;
    }
    var version = ++self._reviewVersion;
    $('#campaign_preview_btn').prop('disabled', true).text('Checking recipients…');
    var channel = $('#campaign_channel').val();
    PosnicPro.post({ url: 'campaigns/preview', data: JSON.stringify({ segment: seg, channel: channel }) }, function (res) {
      if (version !== self._reviewVersion) return;
      $('#campaign_preview_btn').prop('disabled', false).text('Review message →');
      if (!res || res.type !== 'success' || !res.data) {
        PosnicPro.alert('error', (res && res.message) || 'Could not preview');
        return;
      }
      var d = res.data;
      var names = (d.sample || []).map(function (s) {
        return PosnicPro.campaigns.esc(s.name || s.phone || '');
      });
      $('#campaign_review_reach').html(
        '<div class="alert alert-info mb-0"><strong>' + d.reachable + '</strong> reachable of ' + d.total +
          ' in this segment' + (names.length ? ' &middot; e.g. ' + names.join(', ') : '') +
          '<div class="small text-muted mt-1"><lang class="lang_opt_outs_and_customers_with_no_phone_are_s">Opt-outs and customers with no phone are skipped automatically.</lang></div></div>'
      );
      $('#campaign_review_message').text(data.message);
      $('#campaign_send_btn, #campaign_schedule_btn').prop('disabled', !d.reachable);
      $('#campaigns_form_wrap').addClass('is-reviewing');
      $('.campaign-compose-grid, .campaign-footer').prop('hidden', true);
      var review = $('#campaign_review').prop('hidden', false);
      review.trigger('focus');
      if (review[0] && review[0].scrollIntoView) review[0].scrollIntoView({block:'start', behavior:'instant'});
    });
  },

  showSendResult: function (text, error) {
    var result = $('#campaign_send_result');
    result.prop('hidden', false).attr('role', error ? 'alert' : 'status')
      .attr('class', 'alert ' + (error ? 'alert-danger' : 'alert-info')).text(text);
    result.trigger('focus');
    if (result[0] && result[0].scrollIntoView) result[0].scrollIntoView({block:'nearest'});
  },

  // The reviewed Send now action is the confirmation; no browser dialog.
  sendNow: function (dryRun) {
    var self = PosnicPro.campaigns;
    if (self._sending || $('#campaign_review').prop('hidden') || $('#campaign_send_btn').prop('disabled')) return;
    self._sending = true;
    self.showSendResult('Sending…', false);
    var controls = $('#campaign_send_btn, #campaign_test_btn, #campaign_schedule_btn, #campaign_edit_again');
    controls.prop('disabled', true);
    var release = function () { self._sending = false; controls.prop('disabled', false); };
    var failed = function (xhr) {
      release(); self.invalidateReview();
      self.showSendResult((xhr && xhr.responseJSON && xhr.responseJSON.message) || 'Could not confirm sending. Check Message history before trying again.', true);
    };
    var started = self.save(function (data) {
      var id = data && data._id;
      if (!id) { failed(); return; }
      PosnicPro.post({ url: 'campaigns/' + id + '/send', data: JSON.stringify({ dryRun: !!dryRun }) }, function (res) {
        release();
        self.invalidateReview();
        if (!res || res.type !== 'success') {
          self.showSendResult((res && res.message) || 'Send failed', true);
          return;
        }
        var d = res.data || {};
        PosnicPro.alert(d.failed ? 'error' : 'success',
          (dryRun ? PosnicPro.i18n.t('lang_dry_run', 'Dry run: ') : PosnicPro.i18n.t('lang_sent', 'Sent: ')) + (d.sent || 0) + ' sent, ' + (d.failed || 0) + ' failed, ' + (d.skipped || 0) + ' skipped');
        var summary = (dryRun ? 'Check complete: ' : '') + (d.sent || 0) + ' sent, ' + (d.failed || 0) + ' failed, ' + (d.skipped || 0) + ' skipped';
        if (d.errors && d.errors.length) summary += '. ' + d.errors.join('; ');
        self.showSendResult(summary, !!d.failed);
        self.load();
        if (!dryRun) self.hideForm();
      }, failed);
    }, failed);
    if (!started) release();
  },

  schedule: function () {
    var when = $('#campaign_schedule_at').val();
    if (!when) {
      PosnicPro.alert('error', PosnicPro.i18n.t('lang_pick_a_date_and_time_to_schedule', 'Pick a date and time to schedule.'));
      return;
    }
    PosnicPro.campaigns.save(function (data) {
      var id = data && data._id;
      if (!id) return;
      PosnicPro.post({ url: 'campaigns/' + id + '/schedule', data: JSON.stringify({ schedule_at: when }) }, function (res) {
        PosnicPro.alert((res && res.type) || 'error', (res && res.message) || 'Could not schedule');
        if (res && res.type === 'success') PosnicPro.campaigns.load();
      });
    });
  },

  insertMerge: function (field) {
    var el = document.getElementById('campaign_message');
    if (!el) return;
    var token = '{' + field + '}';
    var start = el.selectionStart || el.value.length;
    el.value = el.value.slice(0, start) + token + el.value.slice(el.selectionEnd || start);
    el.focus();
  },
};

// Event wiring (delegated so it survives tab loads).
$(document).on('click', '#campaigns_new', function () {
  PosnicPro.campaigns.newForm();
});
$(document).on('click', '#campaign_form_cancel', function () {
  PosnicPro.campaigns.hideForm();
});
$(document).on('click', '#campaign_save_draft', function () {
  PosnicPro.campaigns.save();
});
$(document).on('click', '#campaign_preview_btn', function () {
  PosnicPro.campaigns.preview();
});
$(document).on('click', '#campaign_test_btn', function () {
  PosnicPro.campaigns.sendNow(true);
});
$(document).on('click', '#campaign_send_btn', function () {
  PosnicPro.campaigns.sendNow(false);
});
$(document).on('click', '#campaign_schedule_btn', function () {
  PosnicPro.campaigns.schedule();
});
$(document).on('change', '#campaign_seg_type', function () {
  PosnicPro.campaigns.toggleSegFields();
});
$(document).on('click', '.campaign-edit', function () {
  PosnicPro.campaigns.editForm($(this).data('id'));
});
$(document).on('click', '.campaign-del', function () {
  var id = $(this).data('id');
  swal({
    title: PosnicPro.i18n.t('lang_delete_this_campaign', 'Delete this campaign?'), text: 'Its send history is kept.',
    showCancelButton: true, confirmButtonText: 'Delete campaign',
    cancelButtonText: 'Keep campaign', confirmButtonClass: 'btn btn-danger',
    cancelButtonClass: 'btn btn-light'
  }).then(function () { PosnicPro.campaigns.remove(id); }, function () {});
});
$(document).on('click', '.campaign-merge', function () {
  PosnicPro.campaigns.insertMerge($(this).data('field'));
  PosnicPro.campaigns.previewText();
});

$(document).on('click', '[data-audience]', function () {
  $('#campaign_seg_type').val($(this).data('audience')).trigger('change');
});
$(document).on('input', '#campaign_search', function () {
  clearTimeout(PosnicPro.campaigns._searchTimer);
  ++PosnicPro.campaigns._searchVersion;
  PosnicPro.campaigns._searchTimer = setTimeout(function () { PosnicPro.campaigns.searchAudience(); }, 250);
});
$(document).on('change', '[data-recipient]', function () {
  var self = PosnicPro.campaigns, selected = self._selection[self.selectedKind()], id = String($(this).data('recipient'));
  if (this.checked) selected[id] = $(this).attr('data-name');
  else delete selected[id];
  self.showSelected();
});
$(document).on('click', '[data-remove-recipient]', function () {
  var self = PosnicPro.campaigns, id = String($(this).data('remove-recipient'));
  delete self._selection[self.selectedKind()][id];
  $('[data-recipient]').each(function () { if (String($(this).data('recipient')) === id) this.checked = false; });
  self.showSelected();
});
$(document).on('input', '#campaign_message', function () { PosnicPro.campaigns.previewText(); });
$(document).on('click', '[data-message-preset]', function () {
  var kind = $(this).data('message-preset');
  var button = this;
  function applyStarter() {
    var templates = {
      offer: 'Hi {name}, we have a special offer for you. [Add your offer, valid code and expiry date.]',
      christmas: 'Merry Christmas, {name}! Wishing you and your family a joyful festive season.',
      newyear: 'Happy New Year, {name}! Thank you for shopping with us. We look forward to welcoming you again.',
      custom: 'Hi {name}, '
    };
    $('#campaign_message').val(templates[kind] || '');
    $('[data-message-preset]').attr('aria-pressed', 'false');
    $(button).attr('aria-pressed', 'true');
    $('#campaign_message').trigger('input');
    PosnicPro.campaigns.previewText();
  }
  if (!$('#campaign_message').val().trim()) { applyStarter(); return; }
  swal({
    title: PosnicPro.i18n.t('lang_replace_your_message', 'Replace your message?'), text: 'Use this starter instead of your current message.',
    showCancelButton: true, confirmButtonText: 'Use starter',
    cancelButtonText: 'Keep my message', confirmButtonClass: 'btn btn-primary',
    cancelButtonClass: 'btn btn-light'
  }).then(applyStarter, function () {});
});

$(document).on('input change', '#campaign_name, #campaign_channel, #campaign_seg_type, .campaign-seg-field input, .campaign-seg-field select, #campaign_message, [data-recipient]', function () { PosnicPro.campaigns.invalidateReview(); });
$(document).on('click', '[data-remove-recipient], [data-message-preset], .campaign-merge, #campaign_edit_again', function () { PosnicPro.campaigns.invalidateReview(); });

$(document).on('click', '#campaign_edit_again', function () { $('#campaign_message').trigger('focus'); });
