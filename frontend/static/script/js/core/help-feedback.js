(function () {
    'use strict';
    var busy = false;
    var opened = false;
    var contextLoaded = false;
    function field(name) { return document.getElementById('posnic_feedback_' + name); }
    function t(key, fallback) {
        return PosnicPro.i18n && PosnicPro.i18n.t ? PosnicPro.i18n.t(key, fallback) : fallback;
    }
    function status(message, ok) {
        var node = field('status');
        node.hidden = false;
        node.className = 'alert ' + (ok ? 'alert-success' : 'alert-danger');
        node.textContent = message;
    }
    function pending(value) {
        busy = value;
        field('send').disabled = value;
        ['email', 'name', 'category', 'comment'].forEach(function (name) { field(name).disabled = value; });
        field('send').textContent = value
            ? t('lang_feedback_sending', 'Sending…') : t('lang_feedback_send', 'Send');
        field('form').setAttribute('aria-busy', String(value));
    }
    $(document).on('show.bs.modal', '#posnic_feedback_dialog', function () {
        // Only fetch after the user opens the form. Never overwrite manual edits
        // if context arrives after they have begun typing.
        if (opened || contextLoaded) { return; }
        opened = true;
        PosnicPro.get('base/help-feedback', function (response) {
            opened = false;
            contextLoaded = true;
            var data = (response && response.data) || {};
            ['email', 'name'].forEach(function (name) {
                if (!field(name).value && !field(name).dataset.edited) { field(name).value = data[name] || ''; }
            });
            var details = [data.branch, data.account, data.version].filter(Boolean).join(' · ');
            field('context').textContent = details ? t('lang_feedback_included', 'Shop / account / version included:') + ' ' + details : '';
        }, function () { opened = false; });
    });
    $(document).on('input', '#posnic_feedback_email, #posnic_feedback_name', function () {
        this.dataset.edited = 'true';
    });
    // Closing does not discard the draft. Prevent a dismissal during a request
    // so its result remains visible, including when Escape/backdrop is used.
    $(document).on('hide.bs.modal', '#posnic_feedback_dialog', function (event) {
        if (busy) { event.preventDefault(); }
    });
    $(document).on('submit', '#posnic_feedback_form', function (event) {
        event.preventDefault();
        if (busy || !this.reportValidity()) { return; }
        if (!field('comment').value.trim()) { field('comment').focus(); return; }
        pending(true);
        field('status').hidden = true;
        var data = {};
        ['email', 'name', 'category', 'comment'].forEach(function (name) { data[name] = field(name).value.trim(); });
        PosnicPro.request({ url: 'base/help-feedback', method: 'POST', timeout: 30000, data: JSON.stringify(data), quietStatuses: [400, 429, 502, 503] }, function (response) {
            pending(false);
            if (response.type !== 'success' || !response.data || !response.data.reference) {
                status(t('lang_feedback_failed', 'Could not send your message. Your comment is kept; please retry.'), false);
                return;
            }
            status(t('lang_feedback_received', 'Posnic support received your message. Reference:') + ' ' + response.data.reference, true);
            field('comment').value = '';
        }, function (xhr) {
            pending(false);
            status((xhr.responseJSON && xhr.responseJSON.message) || t('lang_feedback_offline', 'Could not send. Check your internet connection and retry. Your comment is kept.'), false);
        });
    });
})();
