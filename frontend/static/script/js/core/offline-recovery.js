(function (window, document, $) {
    'use strict';
    if (!$ || !window.PosnicPro) return;
    var activeDialog = null, dialogSequence = 0;

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
            PosnicPro.i18n.t('lang_recovery_account_label', 'Account: {account}').replace('{account}', account) + '\n\n' +
            PosnicPro.i18n.t('lang_recovery_one_line_hint', 'Each line is a separate recovery code. To reset your password, enter only one complete line, not the whole list.') + '\n\n' + codes.join('\n') + '\n\n' +
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
        var titleId = 'offline-recovery-title-' + (++dialogSequence);
        node.setAttribute('aria-labelledby', titleId);
        node.innerHTML = '<div class="d-flex justify-content-between align-items-start"><h4></h4><button type="button" class="btn btn-light" data-close aria-label="Close recovery" data-t-aria-label="lang_close_recovery">×</button></div>' + body;
        node.querySelector('h4').id = titleId;
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
            '<p id="recovery-code-help" class="mb-2"><lang class="lang_recovery_code_instructions">Copy one unused code from your saved recovery sheet. Enter all 8 groups of 4 letters or numbers, from just one line.</lang></p>' +
            '<div id="recovery-code-example" class="border rounded p-2 mb-2"><small class="d-block"><lang class="lang_recovery_code_example_hint">Example only — use a code from your own sheet:</lang></small><code dir="ltr" class="d-block" style="font-size:clamp(10px,2.8vw,13px);white-space:nowrap"></code></div>' +
            '<label class="d-block"><lang class="lang_recovery_code">Recovery code</lang><input name="recoveryCode" dir="ltr" class="form-control" style="font-family:monospace;font-size:clamp(11px,3vw,14px)" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" data-t-placeholder="lang_recovery_code_format" aria-describedby="recovery-code-help recovery-code-example recovery-code-error" autocomplete="off" autocapitalize="characters" spellcheck="false" required maxlength="80"></label>' +
            '<p id="recovery-code-error" class="text-danger" role="alert" hidden></p>' +
            '<label class="d-block"><lang class="lang_newpassword_title">New Password</lang><input name="newPassword" class="form-control" type="password" autocomplete="new-password" required minlength="8" maxlength="20"></label>' +
            '<small><lang class="lang_recovery_password_policy">Use 8-20 characters, without spaces at the beginning or end.</lang></small>' +
            '<label class="d-block mt-2"><lang class="lang_confirmpassword_title">Confirm Password</lang><input name="confirmPassword" class="form-control" type="password" autocomplete="new-password" required minlength="8" maxlength="20"></label>' +
            '<p role="status" class="mt-3" data-message></p><button type="submit" class="btn btn-primary"><lang class="lang_foget_mail">Reset Password</lang></button></form>' +
            '<details class="mt-3"><summary><lang class="lang_recovery_no_codes_title">No recovery codes?</lang></summary><p class="mt-2"><lang class="lang_recovery_no_codes_help">An owner who can still sign in can create codes in Profile → Account recovery. If every owner is locked out and no codes were saved, the computer administrator must recover access locally. Support cannot retrieve an old code or password. Keep your shop data; reinstalling is not a password reset.</lang></p></details>');
        var form = node.querySelector('form'), message = node.querySelector('[data-message]');
        node.querySelector('#recovery-code-example code').textContent = 'A1B2-C3D4-E5F6-A7B8-C9D0-E1F2-A3B4-C5D6';
        var code = form.elements.recoveryCode, codeError = node.querySelector('#recovery-code-error');
        function compactCode(value) { return value.replace(/[\s-]/g, '').toUpperCase(); }
        function setCodeError(error) {
            codeError.textContent = error; codeError.hidden = !error;
            code.setCustomValidity(error);
            if (error) code.setAttribute('aria-invalid', 'true');
            else code.removeAttribute('aria-invalid');
        }
        function multipleCodesMessage() {
            return PosnicPro.i18n.t('lang_recovery_code_multiple', 'Paste only one recovery code from one line of your saved sheet, not the whole list.');
        }
        code.addEventListener('input', function () { setCodeError(''); message.textContent = ''; });
        code.addEventListener('paste', function (event) {
            if (!event.clipboardData) return;
            var pasted = event.clipboardData.getData('text');
            var candidate = code.value.slice(0, code.selectionStart) + pasted + code.value.slice(code.selectionEnd);
            var value = compactCode(candidate);
            // Inspect the complete paste before maxlength can silently cut it.
            // Never choose or submit one code on the user's behalf from a list.
            if (value.length > 32) {
                event.preventDefault(); setCodeError(multipleCodesMessage());
            } else if (/^[A-F0-9]{32}$/.test(value)) {
                event.preventDefault(); code.value = value.match(/.{4}/g).join('-'); setCodeError('');
                message.textContent = '';
            }
        });
        var username = document.getElementById('username');
        if (username) form.elements.account.value = username.value;
        form.onsubmit = async function (event) {
            event.preventDefault();
            if (code.validity.customError) { code.focus(); return; }
            var value = compactCode(code.value);
            if (!/^[A-F0-9]{32}$/.test(value)) {
                setCodeError(value.length > 32 ? multipleCodesMessage() : PosnicPro.i18n.t('lang_recovery_code_incomplete', 'Enter the complete code: 8 groups of 4 characters from one line of your saved sheet.'));
                code.focus(); return;
            }
            code.value = value.match(/.{4}/g).join('-');
            var button = form.querySelector('[type=submit]');
            button.disabled = true; message.textContent = '';
            try {
                await request('POST', 'users/recovery/reset', {
                    account: form.elements.account.value, recoveryCode: form.elements.recoveryCode.value,
                    newPassword: form.elements.newPassword.value, confirmPassword: form.elements.confirmPassword.value
                });
                form.reset();
                try { localStorage.removeItem('posnic_jwt_token'); } catch (_) {}
                if (!node.isConnected) return;
                var success = dialog(PosnicPro.i18n.t('lang_recovery_reset_success_title', 'Password reset successfully'),
                    '<div class="alert alert-success d-flex align-items-start mt-3" style="background:#ecfdf5;color:#166534;border-color:#bbf7d0" role="status"><span aria-hidden="true" style="font-size:26px;line-height:1;margin-inline-end:12px">&#10003;</span><p class="mb-0"><lang class="lang_recovery_reset_success_hint">Sign in with your new password.</lang></p></div>' +
                    '<p><lang class="lang_recovery_used_code_hint">This recovery code has been used and cannot be used again. Keep your remaining codes for later.</lang></p>' +
                    '<button type="button" class="btn btn-primary" data-back-to-login><lang class="lang_recovery_back_to_login">Back to sign in</lang></button>');
                var back = success.querySelector('[data-back-to-login]');
                back.onclick = function () { window.location.href = 'login.html'; };
                back.focus();
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
                var help = document.createElement('p'); help.textContent = PosnicPro.i18n.t('lang_recovery_one_line_hint', 'Each line is a separate recovery code. To reset your password, enter only one complete line, not the whole list.');
                var list = document.createElement('pre'); list.dir = 'ltr'; list.style.cssText = 'font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere'; list.textContent = codes.join('\n');
                var save = document.createElement('button'); save.type = 'button'; save.className = 'btn btn-primary'; save.textContent = PosnicPro.i18n.t('lang_recovery_save_codes', 'Save recovery codes');
                save.onclick = function () { saveCodes(data.recoveryAccount, codes); };
                var label = document.createElement('label'); label.className = 'd-block mt-3';
                var check = document.createElement('input'); check.type = 'checkbox'; label.appendChild(check); label.appendChild(document.createTextNode(' ' + PosnicPro.i18n.t('lang_recovery_saved_confirmation', 'I saved these codes somewhere safe.')));
                var done = document.createElement('button'); done.type = 'button'; done.className = 'btn btn-success'; done.textContent = PosnicPro.i18n.t('lang_done', 'Done'); done.disabled = true;
                check.onchange = function () { done.disabled = !check.checked; };
                done.onclick = function () { node.close(); };
                node.append(note, help, list, save, label, done);
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
