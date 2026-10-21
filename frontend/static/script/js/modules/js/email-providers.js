/* Provider setup belongs to the branch's sending server. Secrets stay write-only. */
PosnicPro.emailProviders = {
  catalog: {
    platform: {name:'Posnic cloud email', methods:['platform'], steps:'Use the email service managed by Posnic. Receipt and report schedules remain separate choices.', url:'https://posnic.com'},
    gmail: {name:'Gmail / Google Workspace', host:'smtp.gmail.com', steps:'Turn on Google 2-Step Verification, then create an app password. Use your full Gmail address and the app password, not your normal password. Your administrator may disable app passwords. From must be your mailbox or an approved alias.', url:'https://support.google.com/accounts/answer/185833'},
    outlook: {name:'Outlook.com / Hotmail / Live', host:'smtp-mail.outlook.com', oauth:true, steps:'Microsoft requires OAuth. Your administrator must register an Entra application for personal Microsoft accounts, grant SMTP.Send and offline_access permission, and obtain a refresh token with your consent. Enter those app details below. A normal account password will not work.', url:'https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth'},
    microsoft365: {name:'Microsoft 365 / Exchange Online', host:'smtp.office365.com', oauth:true, steps:'Ask your administrator to enable authenticated SMTP for this mailbox and register an Entra application. Grant delegated SMTP.Send and offline_access, complete consent, and enter the client ID, client secret and refresh token below. From must be the mailbox or an address with Send As permission.', url:'https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth'},
    yahoo: {name:'Yahoo Mail', host:'smtp.mail.yahoo.com', steps:'Generate an app password in Yahoo Account Security. Use your full Yahoo email address as the username and From address. Ports 587 (STARTTLS) and 465 (SSL/TLS) are available.', url:'https://help.yahoo.com/kb/SLN4724.html'},
    icloud: {name:'Apple iCloud Mail', host:'smtp.mail.me.com', steps:'Create an app-specific password for your Apple Account. Use your full iCloud Mail address. Use port 587 with STARTTLS.', url:'https://support.apple.com/en-us/102525'},
    zoho: {name:'Zoho Mail', host:'smtp.zoho.com', steps:'Copy the outgoing server from your Zoho account settings. Region and paid organization accounts can use a different host (such as smtppro.zoho.com). Use your full email address and an app password if two-factor authentication is on. Ports 587 or 465.', url:'https://www.zoho.com/mail/help/zoho-smtp.html'},
    brevo: {name:'Brevo', host:'smtp-relay.brevo.com', methods:['smtp','api'], steps:'Verify your sender or domain in Brevo. For SMTP, open SMTP & API > SMTP and copy the SMTP login and SMTP key. For API, create an API key instead. These keys are different. Authenticate your domain with the DNS records Brevo provides. SMTP supports 587 or 2525 with STARTTLS and 465 with SSL/TLS.', allow:'If Brevo blocks an unknown IP, approve the sending server in Security > Authorized IPs or follow its approval email. Allow the public outbound IP of the Posnic sending server, not your browser or phone. Ask your Posnic administrator for this IP; a local sender may use a different IP.', url:'https://developers.brevo.com/docs/smtp-integration', links:[['Open SMTP and API settings','https://app.brevo.com/settings/keys/smtp'],['Authorized IP help','https://help.brevo.com/hc/en-us/articles/7959631848850-Create-and-manage-your-SMTP-keys'],['Email API guide','https://developers.brevo.com/reference/send-transac-email']]},
    sendgrid: {name:'Twilio SendGrid', host:'smtp.sendgrid.net', user:'apikey', methods:['smtp','api'], steps:'Verify your sender or authenticate your domain. Create a restricted API key with Mail Send permission. SMTP username is exactly apikey and the password is that key. API uses the key below. SMTP supports 587/2525 with STARTTLS or 465 with SSL/TLS. This preset uses the global API endpoint.', allow:'If IP Access Management is enabled, allow the sending server public outbound IP in SendGrid. Do not allow your phone IP instead.', url:'https://www.twilio.com/docs/sendgrid/for-developers/sending-email/integrating-with-the-smtp-api', links:[['Email API guide','https://www.twilio.com/docs/sendgrid/api-reference/mail-send']]},
    postmark: {name:'Postmark', host:'smtp.postmarkapp.com', methods:['smtp','api'], steps:'Verify a sender signature or domain. For API use the Server API token, not the account token. For SMTP use your SMTP access key and secret, or your server token as both username and password. This setup uses the transactional outbound stream for bills and reports. SMTP supports STARTTLS on 587 or 2525; do not use 465.', url:'https://postmarkapp.com/developer/user-guide/send-email-with-smtp', links:[['Email API guide','https://postmarkapp.com/developer/api/email-api']]},
    resend: {name:'Resend', host:'smtp.resend.com', user:'resend', methods:['smtp','api'], steps:'Verify your sending domain and add its DNS records. Create an API key with sending permission. For SMTP use resend as username and the API key as password. For API enter the same key below. Trial/test sender addresses can restrict recipients.', url:'https://resend.com/docs/send-with-smtp', links:[['Email API guide','https://resend.com/docs/api-reference/emails/send-email']]},
    ses: {name:'Amazon SES (SMTP)', host:'', steps:'Choose your AWS Region, verify your domain, and copy that region\'s SMTP endpoint from SES. Create SES SMTP credentials; these are not AWS access keys. While in the sandbox, verify recipients too or request production access. STARTTLS: 587 or 2587. SSL/TLS: 465 or 2465. Port 25 is often blocked.', url:'https://docs.aws.amazon.com/ses/latest/dg/smtp-connect.html'},
    hostinger: {name:'Hostinger Email', host:'smtp.hostinger.com', steps:'In hPanel open Emails > Manage > Connect Apps & Devices. Copy your mailbox credentials. This preset is for Hostinger Email; Titan and Microsoft mail plans use different settings. Use the full mailbox address. Ports 587 with STARTTLS or 465 with SSL/TLS.', url:'https://support.hostinger.com/en/articles/1575756-how-to-get-email-account-configuration-details-for-hostinger-email'},
    hosting: {name:'Shared hosting / cPanel / Plesk', host:'', steps:'Open your hosting panel > Email Accounts > Connect Devices (cPanel), or Mail > Mail Client Setup (Plesk). Copy the secure outgoing server, full mailbox username and port. The server can differ from mail.yourdomain.com; use the hostname covered by its certificate. Ask your host to allow external SMTP access and check sending limits.', url:'https://docs.cpanel.net/cpanel/email/set-up-mail-client/'},
    custom: {name:'Other email provider (SMTP)', host:'', steps:'Copy your provider\'s outgoing SMTP host, port and username. Use its SMTP/app password. Select the encryption specified by the provider. Ask your administrator to verify the sender, domain DNS records, sending limits and any server IP restrictions.', url:'https://nodemailer.com/smtp'}
  },
  mount: function () {
    if ($('#email_provider').length) return;
    var body = $('#email_smtp_host').closest('.card-body');
    $('#messaging_email_help').remove();
    body.prev('.card-header').find('small').text(PosnicPro.i18n.t('lang_use_posnic_cloud_email_or_connect_your_own', 'Use Posnic cloud email or connect your own account for bills and reports.'));
    body.prepend('<div class="email-setup-grid"><label>Email provider<select id="email_provider" class="form-control"></select></label><label id="email_method_label">Send using<select id="email_method" class="form-control"></select></label></div><div id="email_provider_help" class="email-provider-help"></div>');
    Object.keys(this.catalog).forEach(function (key) { $('<option>').val(key).text(PosnicPro.emailProviders.catalog[key].name).appendTo('#email_provider'); });
    $('#email_smtp_host').closest('.form-row').attr('id','email_smtp_fields');
    $('#email_smtp_secure').closest('.form-group').removeClass('d-flex').hide().after('<div class="form-group col-md-4" id="email_encryption_field"><label for="email_encryption"><lang class="lang_connection_security">Connection security</lang></label><select id="email_encryption" class="form-control"><option value="starttls" data-t="lang_starttls_usually_587_or_2525">STARTTLS (usually 587 or 2525)</option><option value="tls" data-t="lang_ssl_tls_usually_465">SSL/TLS (usually 465)</option></select></div>');
    body.append('<div id="email_api_fields"><label for="email_api_key"><lang class="lang_api_key_server_token">API key / server token</lang></label><input id="email_api_key" type="password" class="form-control" autocomplete="new-password"></div><div id="email_oauth_fields"><p><lang class="lang_microsoft_administrator_setup">Microsoft administrator setup</lang></p><div class="email-setup-grid"><label>Application (client) ID<input id="email_oauth_client_id" class="form-control" autocomplete="off"></label><label>Client secret<input id="email_oauth_client_secret" type="password" class="form-control" autocomplete="new-password"></label><label>Refresh token<input id="email_oauth_refresh_token" type="password" class="form-control" autocomplete="new-password"></label></div></div><p id="email_port_help" class="text-muted small mt-3">587 uses STARTTLS; 465 uses SSL/TLS. Alternative ports such as 2525, 2587 or 2465 only work if your provider supports them. Port 25 is often blocked. Encryption is required.</p><p class="text-muted small mt-3">Saved passwords and keys are hidden. Leave a secret field blank to keep its saved value. Save, then send a test receipt or report to your own address. Provider acceptance does not confirm inbox delivery; check spam and delivery logs.</p>');
    body.append('<div class="email-test-panel"><h6><lang class="lang_check_email_delivery">Check email delivery</lang></h6><p class="text-muted"><lang class="lang_save_your_settings_first_this_test_uses_th">Save your settings first. This test uses the saved account.</lang></p><div class="email-setup-grid"><label>Send a test to<input type="email" required id="email_test_to" class="form-control" placeholder="you@example.com"></label><div><button type="button" id="email_test_send" class="btn btn-outline-primary"><lang class="lang_send_test_email">Send test email</lang></button></div></div><p id="email_test_result" role="status"></p></div>');
    this.render();
  },
  fetch: function () {
    this.mount();
    $('#message_email_save').prop('disabled',true);
    PosnicPro.get('messaging/email',function(res) {
      if (res && res.type === 'success') { PosnicPro.emailProviders.load(res.data || {}); $('#message_email_save').prop('disabled',false); }
      else $('#message_email_result').text(PosnicPro.i18n.t('lang_could_not_load_email_settings_refresh_befo', 'Could not load email settings. Refresh before making changes.'));
    }, function () { $('#message_email_result').text(PosnicPro.i18n.t('lang_could_not_load_email_settings_refresh_befo', 'Could not load email settings. Refresh before making changes.')); });
  },
  load: function (data) {
    this.saved = data; this.mount();
    var provider = data.email_provider || (data.email_smtp_host ? 'custom' : 'platform');
    $('#email_provider').val(this.catalog[provider] ? provider : 'custom');
    this.methods(data.email_method || (data.email_smtp_host ? 'smtp' : 'platform'));
    $('#email_encryption').val(data.email_encryption || ((data.email_smtp_secure === true || data.email_smtp_secure === 'true') ? 'tls' : 'starttls'));
    $('#email_oauth_client_id').val(data.email_oauth_client_id || '');
    ['email_api_key','email_oauth_client_secret','email_oauth_refresh_token'].forEach(function (key) { $('#'+key).val('').attr('placeholder',data.secrets_configured && data.secrets_configured[key] ? PosnicPro.i18n.t('lang_saved_leave_blank_to_keep', 'Saved - leave blank to keep') : PosnicPro.i18n.t('lang_not_configured', 'Not configured')); });
    ['host','port','username','from'].forEach(function(key) { $('#email_smtp_'+key).val(data['email_smtp_'+key] || (key === 'port' ? '587' : '')); });
    $('#email_smtp_password').val('').attr('placeholder',data.secrets_configured && data.secrets_configured.email_smtp_password ? PosnicPro.i18n.t('lang_saved_leave_blank_to_keep', 'Saved - leave blank to keep') : PosnicPro.i18n.t('lang_not_configured', 'Not configured'));
    this.render();
  },
  methods: function (preferred) {
    var p = this.catalog[$('#email_provider').val()] || this.catalog.platform;
    $('#email_method').empty();
    (p.methods || ['smtp']).forEach(function (mode) { $('<option>').val(mode).text({platform:'Managed by Posnic',smtp:'SMTP',api:'Email API'}[mode]).appendTo('#email_method'); });
    if ((p.methods || ['smtp']).includes(preferred)) $('#email_method').val(preferred);
  },
  render: function () {
    var p = this.catalog[$('#email_provider').val()] || this.catalog.platform;
    if (!$('#email_method option').length) this.methods();
    var mode = $('#email_method').val(), esc = function (s) { return $('<span>').text(s).html(); };
    $('#email_smtp_fields,#email_encryption_field,#email_port_help').toggle(mode === 'smtp');
    $('#email_smtp_password').closest('.form-group').toggle(!p.oauth);
    $('#email_smtp_from').closest('.form-group').toggle(mode !== 'platform');
    $('#email_api_fields').toggle(mode === 'api'); $('#email_oauth_fields').toggle(mode === 'smtp' && !!p.oauth);
    $('#email_method_label').toggle((p.methods || []).length > 1);
    $('#email_provider_help').html('<details><summary>Set up '+esc(p.name)+' - instructions and official links</summary><p class="mt-3">'+esc(p.steps)+'</p>'+(p.allow ? '<p>'+esc(p.allow)+'</p>' : '')+'<a target="_blank" rel="noopener noreferrer" href="'+p.url+'">Official setup guide</a>'+ (p.links || []).map(function (link) {return ' · <a target="_blank" rel="noopener noreferrer" href="'+link[1]+'">'+esc(link[0])+'</a>';}).join('')+'</details>');
  },
  values: function () {
    var data = {};
    ['email_provider','email_method','email_encryption','email_api_key','email_oauth_client_id','email_oauth_client_secret','email_oauth_refresh_token'].forEach(function(key) { data[key] = $('#'+key).val() || ''; });
    data.email_smtp_secure = data.email_encryption === 'tls';
    return data;
  }
};
$(document).on('change','#email_provider',function () {
  var setup = PosnicPro.emailProviders, p = setup.catalog[$(this).val()];
  setup.methods();
  $('#email_smtp_host').val(p.host || ''); $('#email_smtp_port').val('587'); $('#email_encryption').val('starttls');
  $('#email_smtp_username').val(p.user || '');
  // Do not send one provider\'s stored credential to a newly selected service.
  ['email_smtp_password','email_api_key','email_oauth_client_secret','email_oauth_refresh_token'].forEach(function (key) { $('#'+key).val('').attr('placeholder', PosnicPro.i18n.t('lang_enter_credentials_for_this_provider', 'Enter credentials for this provider')); });
  setup.render();
});
$(document).on('change','#email_method',function () { PosnicPro.emailProviders.render(); });
$(document).on('change','#email_smtp_port',function () { var port = Number($(this).val()); if ([465,2465].includes(port)) $('#email_encryption').val('tls'); else if ([25,587,2525,2587].includes(port)) $('#email_encryption').val('starttls'); });

$(document).on('click','#email_test_send',function () {
  var button = $(this), input = $('#email_test_to')[0];
  if (!input.checkValidity()) { input.reportValidity(); return; }
  button.prop('disabled',true); $('#email_test_result').text(PosnicPro.i18n.t('lang_sending_test_email', 'Sending test email...'));
  PosnicPro.post({url:'messaging/email/test',data:JSON.stringify({to:input.value.trim()})},function(res) { button.prop('disabled',false); $('#email_test_result').text(res && res.message || 'Could not confirm submission. Check provider logs before retrying.'); },function() { button.prop('disabled',false); $('#email_test_result').text(PosnicPro.i18n.t('lang_could_not_confirm_submission_check_provide', 'Could not confirm submission. Check provider logs before retrying.')); });
});
