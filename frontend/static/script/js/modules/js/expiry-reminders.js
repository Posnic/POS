/* Product expiry reminders belong to core inventory, independent of extensions. */
PosnicPro.expiryReminders = (function () {
    var initialized = false, activeBranch = null;
    function error() { PosnicPro.alert('error', PosnicPro.i18n.t('lang_expiry_load_failed', 'Could not load expiry reminders. Please try again.')); }
    function refresh() {
        var branch = PosnicPro.local.get('branch_id_set');
        if (activeBranch !== branch) { activeBranch = branch; PosnicPro.bellFeed._expiryCount = 0; PosnicPro.bellFeed._expirySignature = ''; $('#expiry_bell_section').hide(); PosnicPro.bellFeed._badge(); }
        if (!branch || !PosnicPro.bellFeed._can(['item', 'read'])) { $('#expiry_bell_section').hide(); return; }
        PosnicPro.get({ url: 'items/expiryReminders' }, function (r) {
            if (branch !== PosnicPro.local.get('branch_id_set') || r.type !== 'success') return;
            var data = r.data, signature = branch + ':' + data.today + ':' + data.total + ':' + data.rows.map(function (row) { return row.id + ':' + row.expiryDate; }).join(',');
            var seen = PosnicPro.local.get('expiry_reminders_seen') === signature;
            PosnicPro.bellFeed._expiryCount = data.enabled && !seen ? data.total : 0;
            PosnicPro.bellFeed._expirySignature = signature;
            PosnicPro.bellFeed._badge();
            $('#expiry_bell_section').toggle(data.enabled && data.total > 0);
            $('#expiry_bell_link').text(PosnicPro.i18n.t('lang_expiry_reminders', 'Expiry reminders') + ' (' + data.total + ')');
        }, function () {});
    }
    return {
        open: function () { window.location.hash = '#/expiryreport'; },
        refresh: refresh,
        init: function () {
            if (initialized) return; initialized = true;
            if (!$('#expiry_bell_section').length) $('<div id="expiry_bell_section" class="dropdown-item" style="display:none"><button type="button" id="expiry_bell_link" class="btn btn-outline-primary btn-block"></button></div>').insertAfter('#bell_feed_list');
            $('#expiry_bell_link').off('click.expiry').on('click.expiry', function () { $('#notoficationlink').dropdown('hide'); PosnicPro.expiryReminders.open(); });
            $('#dropdown-notification').on('shown.bs.dropdown.expiry', function () {
                PosnicPro.local.set('expiry_reminders_seen', PosnicPro.bellFeed._expirySignature || '');
                PosnicPro.bellFeed._expiryCount = 0; PosnicPro.bellFeed._badge(); refresh();
            });
            refresh();
            window.setInterval(function () { if (!document.hidden) refresh(); }, 300000);
        }
    };
})();
