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
  waProviders: [],
  waSaved: {},
  waSecrets: {},
  waConnected: false,
  testPending: false,
  settingsLoaded: false,
  providerHelp: {
    twilio: 'https://www.twilio.com/docs/messaging',
    vonage: 'https://developer.vonage.com/en/messaging/sms/overview',
    vonage_messages: 'https://developer.vonage.com/en/messages/overview',
    plivo: 'https://www.plivo.com/',
    infobip: 'https://www.infobip.com/docs',
    brevo: 'https://developers.brevo.com/',
    messagebird: 'https://bird.com/',
    sinch: 'https://developers.sinch.com/',
    telnyx: 'https://developers.telnyx.com/',
    clicksend: 'https://help.clicksend.com/',
    msg91: 'https://docs.msg91.com/sms/send-sms',
    textlocal: 'https://www.textlocal.in/',
    gupshup: 'https://www.gupshup.io/',
    kaleyra: 'https://www.kaleyra.com/',
    twofactor: 'https://2factor.in/',
    fast2sms: 'https://www.fast2sms.com/',
    africastalking: 'https://developers.africastalking.com/',
    termii: 'https://www.termii.com/',
    unifonic: 'https://www.unifonic.com/',
    zenvia: 'https://www.zenvia.com/',
  },

  setupHelp: function (p) {
    var esc = this.esc;
    var steps = [
      'Sign in to your ' + p.name + ' account and enable SMS sending.',
      'Find the credentials and sender details listed below in your provider account, then enter them here.',
      'Save, send a test to your own number with its country code, and check that it arrives. If it does not, check your provider’s delivery logs.',
    ];
    if (p.id === 'msg91') steps = [
      'In MSG91, open Settings → Authkey. Create or copy an AuthKey with SMS sending access. If IP security is on, allow the server that sends your messages.',
      'Open SMS → Senders and Templates. Copy your approved Sender ID and MSG91 Template ID into the matching fields below.',
      'For receipts, use an approved template with name and url variables. Other messages need a separate compatible template using VAR1. The text must match the approved template.',
      'Save and send a test to your own number. Check SMS → Logs in MSG91 if it does not arrive.',
    ];
    if (p.id === 'brevo') steps = [
      'Sign in to Brevo and check that transactional SMS is available for your account and destination country.',
      'Open SMTP & API → API keys to obtain an API key. Enter it below with your approved sender name. An SMTP key is for email and will not work here.',
      'Check your SMS credits and any sender approval requirements, then save and send a test to your own number.',
    ];
    if (p.id === 'vonage' || p.id === 'vonage_messages') steps = [
      'In Vonage, open API Settings and copy your API Key and API Secret. Your account password is not the API Secret.',
      'Match the API selected in Vonage: choose Messages API for new accounts, or SMS API (Legacy) for an existing legacy setup.',
      'Enter your sender name or number. Trial accounts can send only to registered or verified test numbers.',
      'Save and send a test. Check Messages Logs for Messages API, or SMS Logs for the legacy API. An accepted request is not confirmation of delivery.',
    ];
    if (p.id === 'custom') steps = [
      'Ask your SMS provider for its official HTTP API guide, sending URL, authentication method and required fields.',
      'Have your administrator match the request settings below to that guide. Do not paste an email SMTP password here.',
      'Save and send one test to your own number, then check delivery in your provider account.',
    ];
    var url = this.providerHelp[p.id];
    return '<details class="border rounded p-3 mb-3 messaging-setup-help" open><summary class="font-weight-bold">How to set up ' +
      esc(p.name) + '</summary><ol class="mt-2 mb-2 pl-3">' +
      steps.map(function (s) { return '<li class="mb-1">' + esc(s) + '</li>'; }).join('') +
      '</ol>' + (url ? '<a href="' + url + '" target="_blank" rel="noopener noreferrer">Official ' + esc(p.name) + ' help / website (opens a new tab)</a>' : '') +
      (p.id === 'msg91' ? ' · <a href="https://msg91.com/help/text-sms/where-to-find-my-flow-id" target="_blank" rel="noopener noreferrer"><lang class="lang_find_your_msg91_template_id">Find your MSG91 Template ID</lang></a>' : '') +
      '</details>';
  },

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
      $('#v-pills-messagingmodule-tab').hide();
      $('#messaging_not_allowed').show();
      $('#messaging_body').hide();
      return;
    }
    $('#messaging_not_allowed').hide();
    if (PosnicPro.messageCentre) PosnicPro.messageCentre.mount();
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
    sel.append('<option value="" data-t="lang_choose_a_provider">Choose a provider</option>');
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
    this.settingsLoaded = true;
    $('#messaging_sms_enabled').prop('checked', !!s.sms_enabled);
    $('#messaging_sms_provider').val(s.sms_provider || '');
    $('#messaging_sms_template').val(s.sms_template || '');
    $('#messaging_wa_enabled').prop('checked', !!s.whatsapp_enabled);
    $('#messaging_wa_mode').val(s.whatsapp_mode || 'web');
    $('#messaging_wa_device').val(s.whatsapp_device_id || '');
    $('#messaging_wa_host').val(s.whatsapp_host || '');
    var cloud = s.whatsapp_cloud || {};
    var waSet = s.whatsapp_secrets_set || {};
    this.waProviders = s.whatsapp_providers || this.waProviders;
    this.waSaved = cloud; this.waSecrets = waSet;
    var providerSelect = $('#messaging_wa_provider').empty();
    (this.waProviders.length ? this.waProviders : [{id:'meta',name:'Meta (direct)'}]).forEach(function(p) {
      providerSelect.append($('<option>').val(p.id).text(p.name));
    });
    providerSelect.val(cloud.provider || 'meta');
    if (!$('#messaging_wa_provider_names').length) providerSelect.after('<p id="messaging_wa_provider_names" class="wa-provider-names"></p>');
    $('#messaging_wa_provider_names').text(this.waProviders.map(function(p) { return p.name; }).join(' · '));
    this.renderWaProvider();
    $('#messaging_wa_token').val('').attr('placeholder', waSet.access_token ? '•••••• saved, leave blank to keep' : '');
    $('#messaging_wa_phoneid').val(cloud.phone_number_id || '');
    $('#messaging_wa_apiver').val(cloud.api_version || '');
    $('#messaging_wa_tplname').val(cloud.template_name || '');
    $('#messaging_wa_tpllang').val(cloud.template_lang || '');
    PosnicPro.messaging.toggleWaMode();
    PosnicPro.messaging.renderFields(s.sms_provider || '', s.sms_config || {}, s.sms_secrets_set || {});
  },

  renderWaProvider: function () {
    var id = $('#messaging_wa_provider').val() || 'meta';
    $('#messaging_wa_meta_fields').toggle(id === 'meta');
    var wrap = $('#messaging_wa_provider_fields').empty();
    $('#messaging_wa_cloud').addClass('wa-api-setup');
    $('#messaging_wa_meta_fields > details').removeAttr('open').appendTo('#messaging_wa_meta_fields');
    if (id === 'meta') return;
    var p = this.waProviders.find(function(p) { return p.id === id; });
    if (!p) { wrap.text(PosnicPro.i18n.t('lang_this_provider_is_not_available_on_this_ser', 'This provider is not available on this server. Reload settings.')); return; }
    var same = (this.waSaved.provider || 'meta') === id;
    var c = same ? this.waSaved : {}, saved = same ? this.waSecrets : {};
    var help = $('<details class="border rounded p-3 mb-3 wa-provider-help">');
    help.append($('<summary class="font-weight-bold">').text('Set up ' + p.name));
    var list = $('<ol class="mt-2 mb-2 pl-3">');
    [
      'Open your ' + p.name + ' account and connect your WhatsApp Business number.',
      'Copy the credentials and sender details below from that account. SMS credentials do not automatically enable WhatsApp.',
      'For templates, use an approved text-body template with one variable for the Posnic message. Media, buttons and multiple variables are not supported here yet.',
      'Save, send one test to your own number, then check delivery in your provider account.'
    ].forEach(function(text){ list.append($('<li class="mb-1">').text(text)); });
    help.append(list);
    if (/^https:\/\//.test(p.help || '')) help.append($('<a target="_blank" rel="noopener noreferrer">').attr('href',p.help).text('Open official '+p.name+' setup guide'));
    wrap.append(help);
    wrap.append($('<p class="small text-muted">').text(id === 'msg91' ? 'MSG91 uses an approved template. The Posnic message fills body variable 1.' : 'Leave the template blank only for replies within an active WhatsApp conversation. Receipts, scheduled reports and campaigns normally need an approved template.'));
    var row = $('<div class="form-row">');
    p.fields.forEach(function(f){
      var fieldId='messaging_wa_field_'+f.key;
      var input=$('<input class="form-control wa-provider-field">').attr({id:fieldId,'data-key':f.key,type:f.secret?'password':'text',autocomplete:f.secret?'new-password':'off'});
      if(f.secret) input.attr('placeholder',saved[f.key]?'Saved - leave blank to keep':''); else input.val(c[f.key] || '');
      row.append($('<div class="col-md-6 mb-3">').append($('<label>').attr('for',fieldId).text(f.label+(f.required?' *':'')),input));
    });
    wrap.prepend($('<h6 class="wa-provider-title">').text(p.name));
    wrap.append(row);
    wrap.append(help);
  },

  toggleWaMode: function () {
    var cloud = $('#messaging_wa_mode').val() === 'cloud';
    $('#messaging_wa_cloud').toggle(cloud);
    $('#messaging_wa_web').toggle(!cloud);
    $('[data-wa-mode]').each(function () {
      $(this).attr('aria-pressed', String($(this).data('wa-mode') === (cloud ? 'cloud' : 'web')));
    });
    PosnicPro.messaging.updateReadiness();
  },

  updateReadiness: function () {
    var enabled = $('#messaging_wa_enabled').is(':checked');
    var scan = $('#messaging_wa_mode').val() !== 'cloud';
    var reason = !this.settingsLoaded ? 'Loading settings…' : !enabled ? 'Sending is off. Enable WhatsApp above, then save or send a test.' : scan && !this.waConnected ? PosnicPro.i18n.t('lang_link_your_phone_before_sending_a_test', 'Link your phone before sending a test.') : PosnicPro.i18n.t('lang_send_a_test_to_your_own_number_to_check_de', 'Send a test to your own number to check delivery.');
    $('#messaging_wa_readiness').text(reason);
    $('#messaging_wa_test_btn').prop('disabled', !this.settingsLoaded || !enabled || (scan && !this.waConnected) || this.testPending);
    $('#whatsapp_connected_info .alert').text(enabled ? PosnicPro.i18n.t('lang_phone_linked_send_a_test_to_check_message', 'Phone linked. Send a test to check message delivery.') : PosnicPro.i18n.t('lang_phone_linked_sending_is_currently_off', 'Phone linked. Sending is currently off.'));
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
      PosnicPro.messaging.setupHelp(p) + (p.id === 'msg91'
        ? '<div class="alert alert-info mb-2 small"><lang class="lang_when_a_receipt_template_is_saved_send_test">When a receipt template is saved, Send test sends a sample receipt to your number.</lang></div>'
        : p.freeform === false
        ? '<div class="alert alert-warning mb-2 small">This provider uses approved templates (e.g. India DLT). Campaign text must match a template you registered with them; enter your Template ID below.</div>'
        : '<div class="text-muted small mb-2">Enter the credentials from your ' + PosnicPro.messaging.esc(p.name) + ' account.</div>')
    );
    (p.fields || []).forEach(function (f) {
      var val = config && config[f.key] != null ? config[f.key] : '';
      var isSet = secretsSet && secretsSet[f.key];
      var input;
      if (f.secret) {
        input =
          '<input type="password" class="form-control messaging-field" data-key="' + f.key + '" ' +
          'autocomplete="new-password" placeholder="' + (isSet ? '•••••• saved, leave blank to keep' : '') + '">';
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

  collect: function (channel) {
    var config = {};
    $('#messaging_sms_fields .messaging-field').each(function () {
      var key = $(this).data('key');
      var v = $(this).val();
      // For secrets left blank the server keeps the stored value; still send the
      // key so non-secret blanks clear correctly.
      config[key] = v;
    });
    var data = {
      sms_enabled: $('#messaging_sms_enabled').is(':checked'),
      sms_provider: $('#messaging_sms_provider').val() || '',
      sms_config: config,
      sms_template: $('#messaging_sms_template').val() || '',
      whatsapp_enabled: $('#messaging_wa_enabled').is(':checked'),
      whatsapp_mode: $('#messaging_wa_mode').val() || 'web',
      whatsapp_device_id: $('#messaging_wa_device').val() || $('#whatsapp_device_id').val() || 'posnic',
      whatsapp_host: $('#messaging_wa_host').val() || '',
      whatsapp_cloud: {
        access_token: $('#messaging_wa_token').val() || '',
        phone_number_id: $('#messaging_wa_phoneid').val() || '',
        api_version: $('#messaging_wa_apiver').val() || '',
        template_name: $('#messaging_wa_tplname').val() || '',
        template_lang: $('#messaging_wa_tpllang').val() || '',
      },
    };
    var waProvider = $('#messaging_wa_provider').val() || 'meta';
    if (waProvider !== 'meta') {
      data.whatsapp_cloud = {};
      $('#messaging_wa_provider_fields .wa-provider-field').each(function(){ data.whatsapp_cloud[$(this).data('key')] = $(this).val() || ''; });
    }
    data.whatsapp_cloud.provider = waProvider;
    if (channel) {
      Object.keys(data).forEach(function (key) {
        if (key.indexOf(channel + '_') !== 0) delete data[key];
      });
    }
    return data;
  },

  save: function (channel) {
    PosnicPro.put({ url: 'messaging/settings', data: JSON.stringify(PosnicPro.messaging.collect(channel)) }, function (res) {
      PosnicPro.alert((res && res.type) || 'error', (res && res.message) || 'Could not save');
      if (res && res.type === 'success') PosnicPro.messaging.render(res.data || {});
    });
  },

  // Save first so the test uses the latest credentials, then send on `channel`.
  test: function (channel, phoneSel) {
    if (this.testPending) return;
    var wa = channel === 'whatsapp';
    var phone = String($(phoneSel).val() || '').replace(/[\s()-]/g, '');
    var fail = function (message) { $('#messaging_test_result').attr('role','alert').text(message); PosnicPro.alert('error', message); };
    if (!(wa ? $('#messaging_wa_enabled') : $('#messaging_sms_enabled')).is(':checked')) {
      fail('Sending is off. Enable ' + (wa ? PosnicPro.i18n.t('lang_whatsapp', 'WhatsApp') : PosnicPro.i18n.t('lang_sms', 'SMS')) + ' before testing.'); return;
    }
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
      fail('Enter the full number with + and country code, for example +919008427482.'); return;
    }
    if (wa && $('#messaging_wa_mode').val() !== 'cloud' && !this.waConnected) {
      fail('Link your phone before sending a test.'); return;
    }
    this.testPending = true;
    var button = $(wa ? '#messaging_wa_test_btn' : '#messaging_test_btn');
    var originalText = button.text();
    button.prop('disabled', true).text('Sending…');
    $('#messaging_test_result').attr('role','status').text('Saving settings and sending one test…');
    var finish = function () {
      PosnicPro.messaging.testPending = false;
      button.prop('disabled', false).text(originalText);
      PosnicPro.messaging.updateReadiness();
    };
    PosnicPro.put({ url: 'messaging/settings', data: JSON.stringify(PosnicPro.messaging.collect(channel)) }, function (saved) {
      if (!saved || saved.type !== 'success') {
        finish(); fail((saved && saved.message) || 'Save failed. No test was sent.'); return;
      }
      PosnicPro.post(
        { url: 'messaging/test', timeout: 60000, data: JSON.stringify({ phone: phone, channel: channel || 'sms' }) },
        function (res) {
          finish();
          var ok = res && res.type === 'success';
          var message = ok ? (res.data && res.data.queued ? PosnicPro.i18n.t('lang_test_queued_check_message_history_for_the', 'Test queued. Check Message history for the sending result.') : PosnicPro.i18n.t('lang_test_accepted_by_the_sender_check', 'Test accepted by the sender. Check ') + (wa ? PosnicPro.i18n.t('lang_whatsapp', 'WhatsApp') : PosnicPro.i18n.t('lang_sms', 'SMS')) + ' on the recipient’s phone to confirm delivery.') : (res && res.message) || 'Test failed. Check your connection and try again.';
          $('#messaging_test_result').attr('role', ok ? 'status' : 'alert').text(message);
          PosnicPro.alert(ok ? 'success' : 'error', message);
        },
        function (xhr) {
          finish();
          fail(xhr && xhr.responseJSON && xhr.responseJSON.message || 'Sending could not be confirmed. Check Message history and the recipient before retrying.');
        }
      );
    }, function (xhr) {
      finish();
      fail(xhr && xhr.responseJSON && xhr.responseJSON.message || 'Settings could not be saved. No test was sent.');
    });
  },
};

$(document).on('change', '#messaging_sms_provider', function () {
  // On provider change, redraw fields fresh (no carried-over secrets).
  PosnicPro.messaging.renderFields($(this).val(), {}, {});
});
$(document).on('click', '#messaging_save, #messaging_wa_save', function () {
  PosnicPro.messaging.save(this.id === 'messaging_wa_save' ? 'whatsapp' : 'sms');
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

$(document).on('change', '#messaging_wa_enabled', function () { PosnicPro.messaging.updateReadiness(); });

$(document).on('change', '#messaging_wa_provider', function () { PosnicPro.messaging.renderWaProvider(); });
