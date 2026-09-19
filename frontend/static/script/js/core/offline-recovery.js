(function (window, document, $) {
    'use strict';
    if (!$ || !window.PosnicPro) return;
    var activeDialog = null;

    function request(method, path, data) {
        return new Promise(function (resolve, reject) {
            function failed(xhr) {
                var body = xhr && xhr.responseJSON;
                if (!body && xhr && xhr.responseText) { try { body = JSON.parse(xhr.responseText); } catch (_) {} }
                reject(new Error(body && body.message || PosnicPro.i18n.t('lang_recovery_connection_failed', 'Could not reach this shop. Please try again.')));
            }
            if (method === 'GET') PosnicPro.get(path, resolve, failed);
            else PosnicPro.post({ url: path, data: JSON.stringify(data) }, resolve, failed);
        });
    }
    function saveCodes(account, codes) {
        var text = PosnicPro.i18n.t('lang_recovery_download_title', 'POSNIC - OFFLINE RECOVERY CODES') + '\n' +
            PosnicPro.i18n.t('lang_recovery_account_label', 'Account: {account}').replace('{account}', account) + '\n\n' + codes.join('\n') + '\n\n' +
            PosnicPro.i18n.t('lang_recovery_sheet_warning', 'Each code works once. Keep this sheet away from the till. Anyone with a code can reset this account.') + '\n';
        var url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
        var link = document.createElement('a');
        link.href = url; link.download = 'posnic-recovery-codes.txt';
        document.body.appendChild(link); link.click(); link.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }
    function dialog(title, body) {
        if (activeDialog) activeDialog.close();
        var node = document.createElement('dialog');
        node.style.cssText = 'width:600px;max-width:calc(100vw - 32px);max-height:90vh;overflow:auto;border:1px solid #ddd;border-radius:12px;padding:24px;color:var(--theme-text-color,#222);background:var(--theme-card-bg,#fff)';
        node.innerHTML = '<div class="d-flex justify-content-between align-items-start"><h4></h4><button type="button" class="btn btn-light" data-close aria-label="Close recovery" data-t-aria-label="lang_close_recovery">×</button></div>' + body;
        node.querySelector('h4').textContent = title;
        node.querySelector('[data-close]').onclick = function () { node.close(); };
        node.addEventListener('close', function () { node.innerHTML = ''; node.remove(); if (activeDialog === node) activeDialog = null; });
        document.body.appendChild(node); activeDialog = node; node.showModal();
        return node;
    }
    function recoveryForm() {
        var node = dialog(PosnicPro.i18n.t('lang_recovery_offline_title', 'Recover your account offline'),
            '<p><lang class="lang_recovery_offline_hint">Use one of the recovery codes you saved for this shop. No email or internet connection is needed.</lang></p>' +
            '<form><label class="d-block"><lang class="lang_recovery_username">Email or username</lang><input name="account" dir="auto" class="form-control" autocomplete="username" required maxlength="250"></label>' +
            '<label class="d-block"><lang class="lang_recovery_code">Recovery code</lang><input name="recoveryCode" dir="ltr" class="form-control" autocomplete="off" autocapitalize="characters" spellcheck="false" required maxlength="80"></label>' +
            '<label class="d-block"><lang class="lang_newpassword_title">New Password</lang><input name="newPassword" class="form-control" type="password" autocomplete="new-password" required minlength="8" maxlength="20"></label>' +
            '<small><lang class="lang_recovery_password_policy">Use 8-20 characters, without spaces at the beginning or end.</lang></small>' +
            '<label class="d-block mt-2"><lang class="lang_confirmpassword_title">Confirm Password</lang><input name="confirmPassword" class="form-control" type="password" autocomplete="new-password" required minlength="8" maxlength="20"></label>' +
            '<p role="status" class="mt-3" data-message></p><button type="submit" class="btn btn-primary"><lang class="lang_foget_mail">Reset Password</lang></button></form>' +
            '<details class="mt-3"><summary><lang class="lang_recovery_no_codes_title">No recovery codes?</lang></summary><p class="mt-2"><lang class="lang_recovery_no_codes_help">An owner who can still sign in can create codes in Profile → Account recovery. If every owner is locked out and no codes were saved, the computer administrator must recover access locally. Support cannot retrieve an old code or password. Keep your shop data; reinstalling is not a password reset.</lang></p></details>');
        var form = node.querySelector('form'), message = node.querySelector('[data-message]');
        var username = document.getElementById('username');
        if (username) form.elements.account.value = username.value;
        form.onsubmit = async function (event) {
            event.preventDefault();
            var button = form.querySelector('[type=submit]');
            button.disabled = true; message.textContent = '';
            try {
                var result = await request('POST', 'users/recovery/reset', {
                    account: form.elements.account.value, recoveryCode: form.elements.recoveryCode.value,
                    newPassword: form.elements.newPassword.value, confirmPassword: form.elements.confirmPassword.value
                });
                form.reset(); form.hidden = true;
                try { localStorage.removeItem('posnic_jwt_token'); } catch (_) {}
                var done = document.createElement('p'); done.setAttribute('role', 'status'); done.textContent = PosnicPro.i18n.say(result.message);
                var back = document.createElement('button'); back.type = 'button'; back.className = 'btn btn-primary'; back.textContent = PosnicPro.i18n.t('lang_recovery_back_to_login', 'Back to sign in');
                back.onclick = function () { window.location.href = 'login.html'; };
                node.appendChild(done); node.appendChild(back); back.focus();
            } catch (error) { message.textContent = PosnicPro.i18n.say(error.message); button.disabled = false; }
        };
    }
    function manageCodes() {
        var node = dialog(PosnicPro.i18n.t('lang_recovery_codes_title', 'Offline recovery codes'),
            '<p><lang class="lang_recovery_replace_hint">Keep these codes somewhere separate from the till. Creating a new set replaces every previous code.</lang></p>' +
            '<form><label class="d-block"><lang class="lang_currentpassword_title">Current Password</lang><input name="currentPassword" class="form-control" type="password" autocomplete="current-password" required></label>' +
            '<p role="status" data-message></p><button type="submit" class="btn btn-primary"><lang class="lang_generate_recovery_codes">Generate recovery codes</lang></button></form>');
        var form = node.querySelector('form'), message = node.querySelector('[data-message]');
        form.onsubmit = async function (event) {
            event.preventDefault();
            var button = form.querySelector('button'); button.disabled = true; message.textContent = '';
            try {
                var result = await request('POST', 'users/recovery/codes', { currentPassword: form.elements.currentPassword.value });
                form.reset(); form.remove();
                var data = result.data, codes = data.recoveryCodes;
                var note = document.createElement('p'); note.textContent = PosnicPro.i18n.t('lang_recovery_shown_once', 'Shown once. Each code can reset {account} once.').replace('{account}', data.recoveryAccount);
                var list = document.createElement('pre'); list.dir = 'ltr'; list.style.cssText = 'font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere'; list.textContent = codes.join('\n');
                var save = document.createElement('button'); save.type = 'button'; save.className = 'btn btn-primary'; save.textContent = PosnicPro.i18n.t('lang_recovery_save_codes', 'Save recovery codes');
                save.onclick = function () { saveCodes(data.recoveryAccount, codes); };
                var label = document.createElement('label'); label.className = 'd-block mt-3';
                var check = document.createElement('input'); check.type = 'checkbox'; label.appendChild(check); label.appendChild(document.createTextNode(' ' + PosnicPro.i18n.t('lang_recovery_saved_confirmation', 'I saved these codes somewhere safe.')));
                var done = document.createElement('button'); done.type = 'button'; done.className = 'btn btn-success'; done.textContent = PosnicPro.i18n.t('lang_done', 'Done'); done.disabled = true;
                check.onchange = function () { done.disabled = !check.checked; };
                done.onclick = function () { node.close(); };
                node.append(note, list, save, label, done);
                node.addEventListener('close', function () { codes.length = 0; data.recoveryCodes = []; });
                updateStatus({ remaining: codes.length });
                var banner = document.getElementById('offline_recovery_notice'); if (banner) banner.remove();
            } catch (error) { message.textContent = PosnicPro.i18n.say(error.message); button.disabled = false; }
        };
    }
    function updateStatus(data) {
        var section = document.getElementById('offline_recovery_settings');
        if (!section) return;
        section.hidden = false;
        document.getElementById('offline_recovery_status').textContent = data.remaining ?
            PosnicPro.i18n.t('lang_recovery_remaining', '{count} unused recovery codes. Generate replacements if you no longer have your saved copy.').replace('{count}', data.remaining) :
            PosnicPro.i18n.t('lang_recovery_none_saved', 'No recovery codes are saved for this account. Set them up before you need them.');
        document.getElementById('offline_recovery_manage').onclick = manageCodes;
    }
    $(function () {
        request('GET', 'users/recovery/options').then(function (result) {
            if (!result.data || !result.data.offline) return;
            var login = document.getElementById('offline_recovery_login');
            if (login) {
                login.hidden = false;
                document.getElementById('offline_recovery_open').onclick = recoveryForm;
                document.getElementById('offline_recovery_email_help').hidden = false;
                return;
            }
            if (!document.getElementById('offline_recovery_settings')) return;
            request('GET', 'users/recovery/codes').then(function (response) {
                if (!response.data || !response.data.eligible) return;
                updateStatus(response.data);
                if (!response.data.remaining) {
                    var host = document.querySelector('.rightbar');
                    if (!host) return;
                    var banner = document.createElement('div'); banner.id = 'offline_recovery_notice'; banner.className = 'alert alert-warning m-3';
                    banner.textContent = PosnicPro.i18n.t('lang_recovery_setup_reminder', 'Protect access to your shop: save offline recovery codes in case email is unavailable.') + ' ';
                    var button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-sm btn-outline-dark'; button.textContent = PosnicPro.i18n.t('lang_recovery_setup_action', 'Set up recovery'); button.onclick = manageCodes;
                    banner.appendChild(button); host.prepend(banner);
                }
            }).catch(function () { /* Staff and Cloud accounts do not manage owner recovery. */ });
        }).catch(function () { /* Older servers and Cloud do not offer this capability. */ });
    });
})(window, document, window.jQuery);
