/* One entry point for existing messaging workflows. No sample state or sends. */
PosnicPro.messageCentre = {
  mount: function () {
    if ($('#message_centre').length || !$('#messaging_body').length) return;
    $('#messagingmodule_subnav').closest('.core-subnav-col').hide();
    $('#msg-sub-providers').closest('.col-lg-9').removeClass('col-lg-9').addClass('col-12');
    $('#v-pills-messagingmodule').addClass('message-module');
    var body = $('#messaging_body'), cards = body.children('.card'), sms = cards.eq(0), wa = cards.eq(1);
    body.prepend('<section id="message_centre"><p class="text-muted">Receipts, reminders and customer messages.</p>' +
      '<div class="message-navigation mb-3" role="tablist" aria-label="Messaging sections">' +
      [['connection','settings','Settings'],['campaigns','send','Customer messages'],['automatic','repeat','Automatic messages'],['reports','bar-chart-2','Reports'],['history','clock','Message history']].map(function (t) {
        return '<button type="button" class="message-nav-item" role="tab" data-message-tab="' + t[0] + '" aria-pressed="false" aria-selected="false" aria-controls="message_' + t[0] + '" id="message_tab_' + t[0] + '"><i class="feather icon-' + t[1] + ' mr-2" aria-hidden="true"></i>' + t[2] + '</button>';
      }).join('') + '</div><div id="message_connection"></div><div id="message_automatic" hidden></div><div id="message_campaigns" hidden></div><div id="message_history" hidden></div><div id="message_reports" hidden></div></section>');
    $('#message_connection').html('<h5>Choose how your shop sends messages</h5><p class="text-muted">Set up each service once, then choose when to use it.</p><div class="message-channel-nav" role="group" aria-label="Message services"><button type="button" data-message-channel="whatsapp" aria-pressed="true">WhatsApp</button><button type="button" data-message-channel="sms" aria-pressed="false">SMS</button><button type="button" data-message-channel="email" aria-pressed="false">Email</button></div><div id="message_whatsapp"></div><div id="message_sms" hidden></div><div id="message_email" hidden></div>');
    wa.appendTo('#message_whatsapp'); sms.appendTo('#message_sms');
    $('#email_smtp_host').closest('.card').appendTo('#message_email');
    $('#message_email').append('<button type="button" class="btn btn-primary" id="message_email_save">Save email settings</button><p id="message_email_result" role="status"></p>');
    $('#message_reports').html('<div class="message-section-heading"><div><h5>Reports delivered to you</h5><p class="text-muted">Receive sales, profit or stock summaries by email or WhatsApp.</p></div><button type="button" class="btn btn-primary" id="message_report_add">Add report</button></div><div id="message_report_editor" hidden></div><div id="message_report_list"></div><details class="mt-4"><summary>Previous email report settings</summary><p class="text-muted">Your previous settings are kept here. Check these before enabling another report to avoid duplicate emails.</p><div id="message_previous_reports"></div></details>');
    $('#msg-sub-email').children().appendTo('#message_previous_reports');
    $('#message_centre > div[id]').each(function () { $(this).attr({role:'tabpanel', 'aria-labelledby':'message_tab_' + this.id.replace('message_', '')}); });
    $('#messaging_wa_save').parent().addClass('message-connection-actions').before('<p id="messaging_wa_readiness" class="message-readiness" role="status"></p>').after('<p id="messaging_test_result" class="message-test-result" role="status"></p>');
    $('#messaging_wa_test_phone').attr('aria-label', 'Test phone number with country code').attr('type', 'tel').attr('placeholder', '+919008427482').removeAttr('data-t-placeholder').attr('aria-describedby', 'messaging_wa_readiness');
    $('#messaging_wa_test_phone').closest('.input-group').addClass('message-test-group').removeAttr('style');
    $('#messaging_wa_mode').hide().before('<div class="message-choices">' +
      '<button type="button" class="btn btn-outline-primary" data-wa-mode="cloud" aria-pressed="false"><i class="feather icon-cloud mr-2" aria-hidden="true"></i>WhatsApp API</button>' +
      '<button type="button" class="btn btn-outline-primary" data-wa-mode="web" aria-pressed="false"><i class="feather icon-smartphone mr-2" aria-hidden="true"></i>Scan with your phone</button></div>');
    $('#messaging_wa_mode').parent().removeClass('col-md-6').addClass('col-12');
    $('#messaging_wa_web > p').text('Keep the linked WhatsApp account available to send messages.');
    $('#messaging_wa_host').closest('.col-md-6').hide();
    $('#messaging_wa_device').closest('.col-md-6').hide();
    $('#whatsapp-connection > .card').appendTo('#messaging_wa_web');
    $('#whatsapp_device_id').closest('.col-md-6').hide();
    $('#message_automatic').attr('aria-label', 'Automatic message settings');
    $('a[href="#msg-sub-whatsapp"]').hide();
    $('#whatsapp_connect_btn').show();
    $('#messaging_wa_web').prepend('<p class="small text-muted">Open WhatsApp → Linked devices → Link a device. The QR code appears below.</p>');
    // Keep existing campaign IDs/handlers and data. Marketing remains a shortcut.
    $('#mkt-sub-campaigns > .card').appendTo('#message_campaigns');
    $('#mkt-sub-campaigns').append('<button type="button" class="btn btn-primary" data-open-message-campaigns><i class="feather icon-send mr-2" aria-hidden="true"></i>Open campaigns</button>');
    $('#message_automatic').html('<div class="card"><div class="card-body"><h5>Messages after a sale</h5><div id="message_receipt_option"></div>' +
      '<hr><div class="d-flex flex-wrap align-items-center justify-content-between"><div><h6>Customer credit reminders</h6><p class="text-muted">Manage balances, reminder text and sending.</p></div><button type="button" class="btn btn-outline-primary" data-message-config="credit">Set up reminders</button></div>' +
      '<hr><div class="d-flex flex-wrap align-items-center justify-content-between"><div><h6>Cashback and reward codes</h6><p class="text-muted">Use your existing cashback rules and message settings.</p></div><button type="button" class="btn btn-outline-primary" data-message-config="cashback">Set up cashback</button></div>' +
      '<hr><p class="text-muted">Send greetings and offers from Customer messages. Automatic birthday and annual greetings are not available yet.</p></div></div>');
    $('#whatsapp_receipt').closest('.custom-control').appendTo('#message_receipt_option');
    $('#message_receipt_option label').text('Offer WhatsApp receipt after a sale');
    $('#message_automatic').append('<details id="message_templates"><summary>Receipt and message wording</summary></details>');
    $('#whatsapp-template > .card').appendTo('#message_templates');
    var connection = $('#whatsapp_status_badge').closest('.card');
    connection.addClass('message-phone-status');
    connection.children('.card-header').hide();
    var statusBody = connection.children('.card-body');
    statusBody.prepend('<div class="message-status-row"><div><h6>Linked phone</h6><div id="message_phone_badge"></div></div><div class="message-status-actions"></div></div>');
    $('#whatsapp_status_badge').appendTo('#message_phone_badge');
    $('#whatsapp_refresh_status, #whatsapp_connect_btn, #whatsapp_disconnect_btn').appendTo('.message-status-actions');
    statusBody.children('.row').first().hide();
    $('#whatsapp_disconnect_btn').removeClass('btn-danger').addClass('btn-outline-secondary');
    PosnicPro.messageCentre.show('connection');
  },

  show: function (tab) {
    ['connection','automatic','campaigns','history','reports'].forEach(function (name) {
      $('#message_' + name).prop('hidden', name !== tab);
    });
    $('[data-message-tab]').each(function () { var selected = $(this).data('message-tab') === tab; $(this).attr({'aria-pressed':String(selected), 'aria-selected':String(selected), tabindex:selected ? 0 : -1}); });
    if (tab === 'connection') PosnicPro.whatsapp.init();
    if (tab === 'automatic') {
      PosnicPro.whatsapp.loadWhatsAppReceipt();
      PosnicPro.messageCentre.loadAutomatic();
    }
    if (tab === 'campaigns') PosnicPro.campaigns.load();
    if (tab === 'reports') PosnicPro.messageCentre.reports();
    if (tab === 'history') PosnicPro.messageCentre.history();
  },

  loadAutomatic: function () {
    ['credit', 'cashback'].forEach(function (kind) {
      var button = $('[data-message-config="' + kind + '"]');
      if (!$('#message_toggle_' + kind).length) button.before('<div class="custom-control custom-switch mr-3"><input type="checkbox" class="custom-control-input" id="message_toggle_' + kind + '" data-message-rule="' + kind + '" disabled><label class="custom-control-label" for="message_toggle_' + kind + '">WhatsApp messages</label></div>');
      PosnicPro.get(kind + '/settings', function (res) {
        if (!res || res.type !== 'success') return;
        var data = res.data || {};
        var enabled = kind === 'credit' ? (data.reminder_enabled && data.reminder_channel === 'whatsapp') : (data.enabled && data.deliver_channel === 'whatsapp');
        $('#message_toggle_' + kind).prop('checked', !!enabled).prop('disabled', false).data('settings', data);
      });
    });
  },

  history: function () {
    $('#message_history').html('<p role="status">Loading messages…</p>');
    PosnicPro.get('messaging/history', function (res) {
      if (!res || res.type !== 'success') { PosnicPro.messageCentre.historyError(); return; }
      var esc = PosnicPro.messaging.esc, states = {queued:'Waiting to send', sending:'Sending', needs_review:'Check delivery', accepted:'Accepted by sender', failed:'Not sent'};
      $('#message_history').html('<div class="card"><div class="card-body"><h5>Recent messages</h5><p class="text-muted">Your latest 100 SMS and WhatsApp attempts. Accepted means the sending service received the message; delivery is not yet confirmed.</p>' +
        ((res.data || []).map(function (r) {
          return '<div class="message-history-row"><span><strong>' + esc(r.purpose) + '</strong><br><small class="text-muted">•••• ' + esc(r.recipient_last4) + ' · ' + esc(new Date(r.created_date).toLocaleString()) + '</small></span><span>' + esc(states[r.status] || r.status) + '</span></div>';
        }).join('') || '<p>No messages yet.</p>') + '</div></div>');
    }, function (xhr) { PosnicPro.messageCentre.historyError(xhr && xhr.status); });
  },

  historyError: function (status) {
    var text = status === 404 ? 'Message history is unavailable on this version. Refresh the page to load the latest update, then try again.' : 'We could not load your messages. Check your connection and try again.';
    $('#message_history').html('<div class="card card-body"><p role="alert">' + text + '</p><div><button type="button" class="btn btn-outline-primary" data-message-history-retry>Retry</button></div></div>');
  }
};
$(document).on('click', '[data-message-tab]', function () { PosnicPro.messageCentre.show($(this).data('message-tab')); });
$(document).on('click', '[data-wa-mode]', function () { $('#messaging_wa_mode').val($(this).data('wa-mode')).trigger('change'); });
$(document).on('change', '[data-message-rule]', function () {
  var input = $(this), kind = input.data('message-rule'), enabled = input.is(':checked');
  var data = Object.assign({}, input.data('settings') || {});
  if (kind === 'cashback' && enabled && !data.enabled) {
    input.prop('checked', false);
    PosnicPro.alert('error', 'Set up and enable cashback rules first.');
    return;
  }
  if (kind === 'credit') { data.reminder_enabled = enabled; if (enabled) data.reminder_channel = 'whatsapp'; }
  else data.deliver_channel = enabled ? 'whatsapp' : 'none';
  input.prop('disabled', true);
  PosnicPro.put({ url: kind + '/settings', data: JSON.stringify(data) }, function (res) {
    input.prop('disabled', false);
    if (!res || res.type !== 'success') input.prop('checked', !enabled);
    else input.data('settings', data);
    PosnicPro.alert(res && res.type || 'error', res && res.message || 'Could not save.');
  });
});
$(document).on('click', '[data-open-message-campaigns]', function () {
  $('#v-pills-messagingmodule-tab').tab('show');
  PosnicPro.messaging.load();
  PosnicPro.messageCentre.show('campaigns');
});
$(document).on('click', '[data-message-config]', function () {
  if ($(this).data('message-config') === 'credit') { $('#v-pills-credit-tab').tab('show'); PosnicPro.credit.load(); }
  else { $('#v-pills-marketingmodule-tab').tab('show'); $('a[href="#mkt-sub-cashback"]').tab('show'); PosnicPro.cashback.load(); }
});

$(document).on('keydown', '[data-message-tab]', function (event) {
  var tabs = $('[data-message-tab]'), index = tabs.index(this);
  if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
  event.preventDefault();
  index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  tabs.eq(index).trigger('click').trigger('focus');
});

$(document).on('click', '[data-message-channel]', function () {
  var channel = $(this).data('message-channel');
  ['whatsapp','sms','email'].forEach(function (name) { $('#message_' + name).prop('hidden', name !== channel); });
  $('[data-message-channel]').attr('aria-pressed', 'false'); $(this).attr('aria-pressed', 'true');
});
$(document).on('click', '#message_email_save', function () {
  var button = $(this), data = {};
  ['host','port','username','password','from'].forEach(function (key) { data['email_smtp_' + key] = $('#email_smtp_' + key).val() || ''; });
  data.email_smtp_secure = $('#email_smtp_secure').is(':checked');
  button.prop('disabled', true);
  PosnicPro.put({url:'setting/updateCommonSettings',data:JSON.stringify(data)}, function (res) {
    button.prop('disabled', false); $('#message_email_result').text(res && res.type === 'success' ? 'Email settings saved.' : 'Could not save email settings.');
  }, function () { button.prop('disabled', false); $('#message_email_result').text('Could not save. Please try again.'); });
});
PosnicPro.messageCentre.reports = function () {
  $('#message_report_list').html('<p role="status">Loading reports…</p>');
  PosnicPro.get('messaging/reports', function (res) {
    if (!res || res.type !== 'success') { $('#message_report_list').text(res && res.message || 'Could not load reports.'); return; }
    PosnicPro.messageCentre.reportRows = res.data || [];
    var esc = PosnicPro.messaging.esc, labels = {sales:'Sales summary',profit:'Profit summary',low_stock:'Low stock'}, frequency = {daily:'Every day',weekly:'Every week',monthly:'Every month'}, states = {sent:'Sent',failed:'Could not send',queued:'Waiting to send',needs_review:'Check delivery before restarting'};
    $('#message_report_list').html(PosnicPro.messageCentre.reportRows.map(function (row, i) {
      return '<div class="message-report-row"><div><strong>' + esc(labels[row.report]) + '</strong><p>' + esc(frequency[row.frequency]) + ' at ' + esc(String(row.hour).padStart(2,'0')) + ':00 (' + esc(row.timezone) + ') · ' + esc(row.channel === 'email' ? 'Email' : 'WhatsApp') + ' · ' + esc(row.destination) + '</p><small class="text-muted">' + (row.enabled ? 'Next: ' + esc(new Date(row.next_run_at).toLocaleString()) : 'Delivery is off') + (row.last_status ? ' · Last result: ' + esc(states[row.last_status] || 'Check delivery') : '') + '</small></div><div class="message-status-actions"><button type="button" class="btn btn-outline-secondary" data-report-test="' + esc(row._id) + '">Send test</button><button type="button" class="btn btn-outline-primary" data-report-edit="' + i + '">Edit</button></div></div>';
    }).join('') || '<div class="message-empty"><h6>No reports scheduled</h6><p>Add a report, choose who receives it and turn delivery on when you are ready.</p></div>');
  });
};
PosnicPro.messageCentre.editReport = function (row) {
  row = row || {}; var esc = PosnicPro.messaging.esc;
  $('#message_report_editor').prop('hidden',false).html('<form id="message_report_form" class="card card-body"><h5>' + (row._id ? 'Edit report' : 'Add a report') + '</h5><div class="message-report-fields"><label>Report<select name="report" class="form-control"><option value="sales">Sales summary</option><option value="profit">Profit summary</option><option value="low_stock">Low stock</option></select></label><label>How often<select name="frequency" class="form-control"><option value="daily">Daily / day-end</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label><label>Send by<select name="channel" class="form-control"><option value="email">Email</option><option value="whatsapp">WhatsApp</option></select></label><label>Send to<input name="destination" class="form-control" required maxlength="254" placeholder="Email address or +country code and phone number"></label><label>Send at<select name="hour" class="form-control">' + Array.from({length:24},function(_,h){return '<option value="'+h+'">'+String(h).padStart(2,'0')+':00</option>';}).join('') + '</select></label><label>Time zone<input name="timezone" class="form-control" required></label><label id="message_report_weekday">Day of week<select name="weekday" class="form-control">' + ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map(function(d,i){return '<option value="'+i+'">'+d+'</option>';}).join('') + '</select></label></div><p class="text-muted">Daily sales and profit cover the previous completed day; weekly covers the previous seven days. Monthly reports arrive on the 1st and cover the previous month. Low stock shows current stock. This is not a register-closing report.</p><label class="message-report-enable"><input name="enabled" type="checkbox"> Send this report automatically</label><p class="small text-muted">WhatsApp must be enabled and connected. Email uses your saved email settings.</p><p id="message_report_result" role="status"></p><div class="message-status-actions"><button type="submit" class="btn btn-primary">Save report</button><button type="button" class="btn btn-outline-secondary" id="message_report_cancel">Cancel</button></div></form>');
  var form = $('#message_report_form'); form.data('id',row._id || '');
  ['report','frequency','channel','destination','hour','timezone','weekday'].forEach(function(key){ var defaults={report:'sales',frequency:'daily',channel:'email',destination:'',hour:8,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',weekday:1}; form.find('[name="'+key+'"]').val(row[key] === undefined ? defaults[key] : row[key]); });
  form.find('[name="enabled"]').prop('checked',row.enabled === true);
  form.find('[name="frequency"]').trigger('change');
};
$(document).on('click','#message_report_add',function(){ PosnicPro.messageCentre.editReport(); });
$(document).on('click','[data-report-edit]',function(){ PosnicPro.messageCentre.editReport(PosnicPro.messageCentre.reportRows[$(this).data('report-edit')]); });
$(document).on('click','#message_report_cancel',function(){ $('#message_report_editor').prop('hidden',true); });
$(document).on('change','#message_report_form [name="frequency"]',function(){ $('#message_report_weekday').prop('hidden',$(this).val() !== 'weekly'); });
$(document).on('submit','#message_report_form',function(event){
  event.preventDefault(); var form=$(this), data={id:form.data('id')};
  form.serializeArray().forEach(function(field){data[field.name]=field.value;}); data.enabled=form.find('[name="enabled"]').is(':checked');
  form.find('[type="submit"]').prop('disabled',true);
  PosnicPro.post({url:'messaging/reports',data:JSON.stringify(data)},function(res){
    form.find('[type="submit"]').prop('disabled',false);
    if(res && res.type === 'success'){ $('#message_report_editor').prop('hidden',true); PosnicPro.messageCentre.reports(); }
    else $('#message_report_result').text(res && res.message || 'Could not save report.');
  },function(){form.find('[type="submit"]').prop('disabled',false);$('#message_report_result').text('Could not save report. Please try again.');});
});

$(document).on('click', '[data-message-history-retry]', function () { PosnicPro.messageCentre.history(); });

$(document).on('click','[data-report-test]',function(){
  var button=$(this); if(button.prop('disabled')) return;
  button.prop('disabled',true).text('Sending test…');
  function done(message,type){ button.prop('disabled',false).text('Send test'); PosnicPro.alert(type,message); }
  PosnicPro.post({url:'messaging/reports/'+encodeURIComponent(button.attr('data-report-test'))+'/test',data:JSON.stringify({})},function(res){
    done(res.message || 'Check the recipient for the report.',res.type || 'warning');
  },function(){done('Could not confirm sending. Check the recipient and message history before retrying.','warning');});
});
