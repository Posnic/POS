PosnicPro.deviceNotifications = (function () {
    var busy = false;
    function unavailable() { return !window.isSecureContext || !('Notification' in window) || !navigator.serviceWorker || !('PushManager' in window); }
    function message(text, kind) {
        var hint = $('#bell_push_status');
        if (!hint.length) hint = $('<p id="bell_push_status" class="px-3 py-2 mb-0 small" role="status"></p>').insertAfter('#bell_feed_push');
        hint.text(text);
        if (kind) PosnicPro.alert(kind, text);
    }
    function timeout(promise) {
        return new Promise(function (resolve, reject) {
            var timer = setTimeout(function () { reject(new Error('timeout')); }, 15000);
            Promise.resolve(promise).then(function (value) { clearTimeout(timer); resolve(value); }, function (err) { clearTimeout(timer); reject(err); });
        });
    }
    function call(method, options) {
        return timeout(new Promise(function (resolve, reject) {
            PosnicPro[method](options, function (r) { if (r && r.type === 'success') resolve(r); else reject(new Error('server')); }, function () { reject(new Error('network')); });
        }));
    }
    function setup() {
        var button = $('#bell_feed_push');
        if (!button.length || busy) return;
        button.show().prop('disabled', false);
        if (unavailable()) {
            button.prop('disabled', true);
            message(PosnicPro.i18n.t('lang_push_unsupported', 'Device notifications are unavailable in this browser. Use Chrome or Edge over HTTPS. The POS bell still works.')); return;
        }
        if (Notification.permission === 'denied') {
            button.prop('disabled', true);
            message(PosnicPro.i18n.t('lang_push_blocked', 'Notifications are blocked. Allow notifications in this site’s browser settings, then reload.')); return;
        }
        timeout(navigator.serviceWorker.getRegistration()).then(function (reg) {
            if (!reg || !reg.active) throw new Error('worker');
            return timeout(reg.pushManager.getSubscription());
        }).then(function (sub) {
            button.text(sub ? PosnicPro.i18n.t('lang_send_test_notification', 'Send test notification') : PosnicPro.i18n.t('lang_enable_notifications_on_this_device', 'Enable notifications on this device')).data('subscribed', !!sub);
        }).catch(function () { message(PosnicPro.i18n.t('lang_push_reload', 'Notification setup is not ready. Reload this page and try again.')); });
    }
    async function click() {
        if (busy) return;
        if (unavailable() || Notification.permission === 'denied') { setup(); return; }
        busy = true;
        var button = $('#bell_feed_push'), testing = button.data('subscribed') === true;
        button.prop('disabled', true);
        button.text(PosnicPro.i18n.t('lang_push_setting_up', 'Setting up device notifications…'));
        message(PosnicPro.i18n.t('lang_push_setting_up', 'Setting up device notifications…'), 'info');
        try {
            // Request permission immediately within the user's click, before any network wait.
            var permission = Notification.permission === 'granted' ? 'granted' : await timeout(Notification.requestPermission());
            if (permission !== 'granted') { message(PosnicPro.i18n.t('lang_push_permission_needed', 'Notifications were not enabled. Allow the browser permission to receive device notifications.'), 'info'); return; }
            var reg = await timeout(navigator.serviceWorker.getRegistration());
            if (!reg || !reg.active) throw new Error('worker');
            var key = (await call('get', {url:'push/key',data:{}})).data.key;
            if (!key) throw new Error('key');
            var sub = await timeout(reg.pushManager.getSubscription());
            if (!sub) {
                var raw = atob(key.replace(/-/g,'+').replace(/_/g,'/') + '='.repeat((4-key.length%4)%4));
                var bytes = new Uint8Array(raw.length); for(var i=0;i<raw.length;i++) bytes[i]=raw.charCodeAt(i);
                sub = await timeout(reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes}));
            }
            // Repair a missing server registration even when the browser already has one.
            await call('post',{url:'push/subscribe',data:JSON.stringify({subscription:sub.toJSON()})});
            if (testing) {
                var result = await call('post',{url:'push/test',data:JSON.stringify({endpoint:sub.endpoint})});
                if (!result.data || !result.data.sent) throw new Error('delivery');
                message(PosnicPro.i18n.t('lang_push_test_sent', 'Test notification sent. If it is not visible, check your device notification settings.'), 'success');
            } else message(PosnicPro.i18n.t('lang_notifications_enabled_on_this_device', 'Notifications enabled on this device.'), 'success');
        } catch (err) {
            message(err.message === 'worker' ? PosnicPro.i18n.t('lang_push_reload', 'Notification setup is not ready. Reload this page and try again.') : PosnicPro.i18n.t('lang_push_failed', 'Could not enable or send device notifications. Check browser permissions and your connection, then try again. The POS bell still works.'), 'error');
        } finally { busy = false; button.prop('disabled', false); setup(); }
    }
    return { setup: setup, click: click };
})();
