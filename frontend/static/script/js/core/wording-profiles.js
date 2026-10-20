/* Optional branch wording. No assignment means the shipped labels are unchanged. */
(function () {
    'use strict';
    var active = null, current = '', pending = false;
    function scope() {
        return [typeof API_URL === 'string' ? API_URL : location.origin, PosnicPro.local.get('branch_id_set') || '', PosnicPro.local.get('username') || '', PosnicPro.i18n.code()].join('|');
    }
    function valid(bundle) {
        return bundle && bundle.schemaVersion === 1 && bundle.locale === PosnicPro.i18n.code()
            && String(bundle.branchId) === String(PosnicPro.local.get('branch_id_set'))
            && bundle.values && typeof bundle.values === 'object' && !Array.isArray(bundle.values)
            && Object.keys(bundle.values).every(function (k) { return typeof bundle.values[k] === 'string'; });
    }
    function values() {
        var key = scope();
        if (key !== current) {
            current = key; active = null;
            try { var stored = JSON.parse(localStorage.getItem('posnic.wording.v1:' + key)); if (valid(stored)) active = stored; } catch (_) { }
            setTimeout(function () { PosnicPro.i18n.restore(); PosnicPro.i18n.apply(); }, 0);
        }
        return active && Object.keys(active.values).length ? active.values : null;
    }
    function refresh() {
        values();
        if (pending || !PosnicPro.local.get('usertype') || !PosnicPro.local.get('branch_id_set')) return;
        pending = true;
        var key = scope();
        PosnicPro.get({ url: 'settings/wording/bundle', data: { locale: PosnicPro.i18n.code() }, quietStatuses: [0, 400, 403, 404, 409, 500, 502, 503, 504] }, function (r) {
            pending = false;
            if (key !== scope() || r.type !== 'success' || !valid(r.data)) return;
            var changed = JSON.stringify(active) !== JSON.stringify(r.data);
            active = r.data;
            try { localStorage.setItem('posnic.wording.v1:' + key, JSON.stringify(active)); } catch (_) { }
            if (changed) { PosnicPro.i18n.restore(); PosnicPro.i18n.apply(); }
        }, function () { pending = false; });
    }
    function orderType(value) {
        if (/^take[ -]?away$/i.test(String(value || ''))) return PosnicPro.i18n.t('lang_takeaway', 'Takeaway');
        return value;
    }
    PosnicPro.wording = { values: values, refresh: refresh, orderType: orderType };
    PosnicPro.i18n.apply();
    setTimeout(refresh, 1500);
    window.addEventListener('online', refresh);
    window.addEventListener('hashchange', refresh);
    setInterval(function () { if (!document.hidden) refresh(); }, 60000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
})();
