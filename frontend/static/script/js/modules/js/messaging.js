/*
 * Messaging settings - SMS provider + local WhatsApp (SUPER ADMIN ONLY).
 *
 * SMS is the shop's own account: they pick a provider from the dropdown and
 * enter their own credentials and (for template-based providers, e.g. India DLT)
 * their template. The secrets are stored server-side and never sent back here in
 * the clear - a set secret shows as blank with a "saved" hint; leaving it blank
 * on save keeps it. WhatsApp runs on the shop's own machine as a linked device,
 * so we only record its device id / host, not a credential.
 *
 * Only a super admin can see or change any of this.
 */
PosnicPro.messaging = {
  providers: [],

  isSuperAdmin: function () {
    return PosnicPro.local.get('usertype') === 'super_admin';
  },

  esc: function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m];
    });
  },

  load: function () {
    // Hard gate in the UI; the server enforces it too.
    if (!PosnicPro.messaging.isSuperAdmin()) {
      $('#v-pills-messaging-tab').hide();
      $('#messaging_not_allowed').show();
      $('#messaging_body').hide();
      return;
    }
    $('#messaging_not_allowed').hide();
    $('#messaging_body').show();
    PosnicPro.get('messaging/providers', function (res) {
      PosnicPro.messaging.providers = (res && res.data) || [];
      PosnicPro.messaging.fillProviderDropdown();
      PosnicPro.get('messaging/settings', function (r2) {
        PosnicPro.messaging.render((r2 && r2.data) || {});
      });
    });
  },

  fillProviderDropdown: function () {
    var byScope = {};
    PosnicPro.messaging.providers.forEach(function (p) {
      (byScope[p.scope] = byScope[p.scope] || []).push(p);
    });
    var sel = $('#messaging_sms_provider').empty();
    sel.append('<option value="">— choose a provider —</option>');
    Object.keys(byScope).forEach(function (scope) {
      var group = $('<optgroup label="' + PosnicPro.messaging.esc(scope) + '"></optgroup>');
      byScope[scope].forEach(function (p) {
        group.append('<option value="' + p.id + '">' + PosnicPro.messaging.esc(p.name) + '</option>');
      });
      sel.append(group);
    });
  },

  providerById: function (id) {
    return PosnicPro.messaging.providers.find(function (p) {
      return p.id === id;
    });
  },

  render: function (s) {
    s = s || {};
    $('#messaging_sms_enabled').prop('checked', !!s.sms_enabled);
    $('#messaging_sms_provider').val(s.sms_provider || '');
    $('#messaging_sms_template').val(s.sms_template || '');
    $('#messaging_wa_enabled').prop('checked', !!s.whatsapp_enabled);
    $('#messaging_wa_mode').val(s.whatsapp_mode || 'web');
    $('#messaging_wa_device').val(s.whatsapp_device_id || '');
    $('#messaging_wa_host').val(s.whatsapp_host || '');
    var cloud = s.whatsapp_cloud || {};
    var waSet = s.whatsapp_secrets_set || {};
    $('#messaging_wa_token').val('').attr('placeholder', waSet.access_token ? '•••••• saved — leave blank to keep' : '');
    $('#messaging_wa_phoneid').val(cloud.phone_number_id || '');
    $('#messaging_wa_apiver').val(cloud.api_version || '');
    $('#messaging_wa_tplname').val(cloud.template_name || '');
    $('#messaging_wa_tpllang').val(cloud.template_lang || '');
    PosnicPro.messaging.toggleWaMode();
    PosnicPro.messaging.renderFields(s.sms_provider || '', s.sms_config || {}, s.sms_secrets_set || {});
  },

  toggleWaMode: function () {
    var cloud = $('#messaging_wa_mode').val() === 'cloud';
    $('#messaging_wa_cloud').toggle(cloud);
    $('#messaging_wa_web').toggle(!cloud);
  },

  // Draw the credential inputs for the chosen provider. Secret fields that are
  // already set show a hint and stay blank (blank on save = keep the stored key).
  renderFields: function (providerId, config, secretsSet) {
    var wrap = $('#messaging_sms_fields').empty();
    var p = PosnicPro.messaging.providerById(providerId);
    if (!p) {
      $('#messaging_provider_note').empty();
      return;
    }
    $('#messaging_provider_note').html(
      p.freeform === false
        ? '<div class="alert alert-warning mb-2 small">This provider uses approved templates (e.g. India DLT). Campaign text must match a template you registered with them; enter your Template ID below.</div>'
        : '<div class="text-muted small mb-2">Enter the credentials from your ' + PosnicPro.messaging.esc(p.name) + ' account.</div>'
    );
    (p.fields || []).forEach(function (f) {
      var val = config && config[f.key] != null ? config[f.key] : '';
      var isSet = secretsSet && secretsSet[f.key];
      var input;
      if (f.secret) {
        input =
          '<input type="password" class="form-control messaging-field" data-key="' + f.key + '" ' +
          'autocomplete="new-password" placeholder="' + (isSet ? '•••••• saved — leave blank to keep' : '') + '">';
      } else {
        input =
          '<input type="text" class="form-control messaging-field" data-key="' + f.key + '" value="' +
          PosnicPro.messaging.esc(val) + '">';
      }
      wrap.append(
        '<div class="col-md-4 mb-2"><label>' + PosnicPro.messaging.esc(f.label) +
          (f.required ? ' <span class="text-danger">*</span>' : '') + '</label>' + input + '</div>'
      );
    });
  },

  collect: function () {
    var config = {};
    $('#messaging_sms_fields .messaging-field').each(function () {
      var key = $(this).data('key');
      var v = $(this).val();
      // For secrets left blank the server keeps the stored value; still send the
      // key so non-secret blanks clear correctly.
      config[key] = v;
    });
    return {
      sms_enabled: $('#messaging_sms_enabled').is(':checked'),
      sms_provider: $('#messaging_sms_provider').val() || '',
      sms_config: config,
      sms_template: $('#messaging_sms_template').val() || '',
      whatsapp_enabled: $('#messaging_wa_enabled').is(':checked'),
      whatsapp_mode: $('#messaging_wa_mode').val() || 'web',
      whatsapp_device_id: $('#messaging_wa_device').val() || '',
      whatsapp_host: $('#messaging_wa_host').val() || '',
      whatsapp_cloud: {
        access_token: $('#messaging_wa_token').val() || '',
        phone_number_id: $('#messaging_wa_phoneid').val() || '',
        api_version: $('#messaging_wa_apiver').val() || '',
        template_name: $('#messaging_wa_tplname').val() || '',
        template_lang: $('#messaging_wa_tpllang').val() || '',
      },
    };
  },

  save: function () {
    PosnicPro.put({ url: 'messaging/settings', data: JSON.stringify(PosnicPro.messaging.collect()) }, function (res) {
      PosnicPro.alert((res && res.type) || 'error', (res && res.message) || 'Could not save');
      if (res && res.type === 'success') PosnicPro.messaging.render(res.data || {});
    });
  },

  // Save first so the test uses the latest credentials, then send on `channel`.
  test: function (channel, phoneSel) {
    var phone = $(phoneSel).val();
    if (!phone) {
      PosnicPro.alert('error', 'Enter a phone number (with country code) to send a test.');
      return;
    }
    PosnicPro.put({ url: 'messaging/settings', data: JSON.stringify(PosnicPro.messaging.collect()) }, function () {
      PosnicPro.post(
        { url: 'messaging/test', data: JSON.stringify({ phone: phone, channel: channel || 'sms' }) },
        function (res) {
          PosnicPro.alert((res && res.type) || 'error', (res && res.message) || 'Test failed');
        }
      );
    });
  },
};

$(document).on('change', '#messaging_sms_provider', function () {
  // On provider change, redraw fields fresh (no carried-over secrets).
  PosnicPro.messaging.renderFields($(this).val(), {}, {});
});
$(document).on('click', '#messaging_save, #messaging_wa_save', function () {
  PosnicPro.messaging.save();
});
$(document).on('click', '#messaging_test_btn', function () {
  PosnicPro.messaging.test('sms', '#messaging_test_phone');
});
$(document).on('click', '#messaging_wa_test_btn', function () {
  PosnicPro.messaging.test('whatsapp', '#messaging_wa_test_phone');
});
$(document).on('change', '#messaging_wa_mode', function () {
  PosnicPro.messaging.toggleWaMode();
});
