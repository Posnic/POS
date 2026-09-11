/*
 * Campaigns - admin screen (a tab in Settings).
 *
 * Reach a segment of customers with a message over SMS or WhatsApp. Sending is
 * deliberately deliberate: you preview the reach, can send a dry run that
 * dispatches nothing, and a real send asks for confirmation. Opt-outs and
 * customers with no phone are skipped on the server; a customer is never
 * messaged twice for the same campaign.
 */
PosnicPro.campaigns = {
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

  // --------------------------------- list ---------------------------------

  load: function () {
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
    $('#campaigns_form_wrap').show();
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
    $('#campaigns_form_wrap').show();
  },

  hideForm: function () {
    $('#campaigns_form_wrap').hide();
  },

  fill: function (c) {
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
    PosnicPro.campaigns.toggleSegFields();
  },

  toggleSegFields: function () {
    var t = $('#campaign_seg_type').val();
    $('.campaign-seg-field').hide();
    $('#campaign_seg_' + t + '_wrap').show();
  },

  collectSegment: function () {
    var t = $('#campaign_seg_type').val() || 'all';
    var seg = { type: t };
    if (t === 'tier') seg.tier = $('#campaign_seg_tier').val() || '';
    if (t === 'min_points') seg.min_points = PosnicPro.campaigns.num($('#campaign_seg_min_points').val(), 0);
    if (t === 'lapsed') seg.lapsed_days = PosnicPro.campaigns.num($('#campaign_seg_lapsed_days').val(), 30);
    if (t === 'category') seg.category_id = $('#campaign_seg_category').val() || null;
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

  save: function (after) {
    var data = PosnicPro.campaigns.collect();
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
        PosnicPro.campaigns.load();
        if (typeof after === 'function') after(res.data);
        else PosnicPro.alert('success', res.message || 'Saved');
      } else {
        PosnicPro.alert((res && res.type) || 'error', (res && res.message) || 'Could not save');
      }
    };
    if (id) PosnicPro.put({ url: 'campaigns/' + id, data: JSON.stringify(data) }, done);
    else PosnicPro.post({ url: 'campaigns', data: JSON.stringify(data) }, done);
  },

  remove: function (id) {
    PosnicPro.delete('campaigns/' + id, function (res) {
      PosnicPro.alert((res && res.type) || 'error', (res && res.message) || 'Could not delete');
      if (res && res.type === 'success') PosnicPro.campaigns.load();
    });
  },

  // ------------------------------- actions --------------------------------

  preview: function () {
    var seg = PosnicPro.campaigns.collectSegment();
    var channel = $('#campaign_channel').val();
    PosnicPro.post({ url: 'campaigns/preview', data: JSON.stringify({ segment: seg, channel: channel }) }, function (res) {
      if (!res || res.type !== 'success' || !res.data) {
        PosnicPro.alert('error', (res && res.message) || 'Could not preview');
        return;
      }
      var d = res.data;
      var names = (d.sample || []).map(function (s) {
        return PosnicPro.campaigns.esc(s.name || s.phone || '');
      });
      $('#campaign_preview_out').html(
        '<div class="alert alert-info mb-0"><strong>' + d.reachable + '</strong> reachable of ' + d.total +
          ' in this segment' + (names.length ? ' &middot; e.g. ' + names.join(', ') : '') +
          '<div class="small text-muted mt-1"><lang class="lang_opt_outs_and_customers_with_no_phone_are_s">Opt-outs and customers with no phone are skipped automatically.</lang></div></div>'
      );
    });
  },

  // dryRun true = test (dispatch nothing); false = real send (asks first).
  sendNow: function (dryRun) {
    PosnicPro.campaigns.save(function (data) {
      var id = data && data._id;
      if (!id) return;
      if (!dryRun) {
        if (!window.confirm('Send this campaign for real now? Reachable customers will be messaged.')) return;
      }
      PosnicPro.post({ url: 'campaigns/' + id + '/send', data: JSON.stringify({ dryRun: !!dryRun }) }, function (res) {
        if (!res || res.type !== 'success') {
          PosnicPro.alert((res && res.type) || 'error', (res && res.message) || 'Send failed');
          return;
        }
        var d = res.data || {};
        PosnicPro.alert(
          'success',
          (dryRun ? PosnicPro.i18n.t('lang_dry_run', 'Dry run: ') : PosnicPro.i18n.t('lang_sent', 'Sent: ')) + (d.sent || 0) + ' sent, ' + (d.failed || 0) + ' failed, ' + (d.skipped || 0) + ' skipped'
        );
        PosnicPro.campaigns.load();
      });
    });
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
  if (window.confirm('Delete this campaign? Its send history is kept.')) {
    PosnicPro.campaigns.remove($(this).data('id'));
  }
});
$(document).on('click', '.campaign-merge', function () {
  PosnicPro.campaigns.insertMerge($(this).data('field'));
});
