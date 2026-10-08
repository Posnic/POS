/* Product expiry reminders belong to core inventory, independent of extensions. */
PosnicPro.expiryReminders = (function () {
    var page = 1, loading = false, generation = 0, initialized = false, activeBranch = null;
    function error() { PosnicPro.alert('error', PosnicPro.i18n.t('lang_expiry_load_failed', 'Could not load expiry reminders. Please try again.')); }
    function modal() {
        if ($('#expiry_reminders_modal').length) return;
        $('body').append('<div class="modal fade" id="expiry_reminders_modal" tabindex="-1" role="dialog" aria-labelledby="expiry_reminders_title"><div class="modal-dialog modal-lg modal-dialog-scrollable"><div class="modal-content"><div class="modal-header"><h5 id="expiry_reminders_title"></h5><button type="button" class="close" data-dismiss="modal" aria-label="Close" data-t-aria-label="lang_close_title">&times;</button></div><div class="modal-body"><p id="expiry_reminders_help"></p><div id="expiry_reminders_settings" class="border rounded p-3 mb-3"><label><input type="checkbox" id="expiry_reminders_enabled"> <span id="expiry_reminders_enabled_label"></span></label><div class="d-flex align-items-center"><label for="expiry_reminders_days" class="mr-2 mb-0" id="expiry_reminders_days_label"></label><input type="number" min="0" max="365" step="1" id="expiry_reminders_days" class="form-control mr-2" style="max-width:100px"><button type="button" id="expiry_reminders_save" class="btn btn-primary"></button></div></div><p id="expiry_reminders_summary" role="status"></p><div class="table-responsive"><table class="table"><thead><tr id="expiry_reminders_head"></tr></thead><tbody id="expiry_reminders_rows"></tbody></table></div></div><div class="modal-footer"><button type="button" id="expiry_reminders_previous" class="btn btn-outline-primary"></button><button type="button" id="expiry_reminders_next" class="btn btn-outline-primary"></button><button type="button" class="btn btn-secondary" data-dismiss="modal" id="expiry_reminders_close"></button></div></div></div></div>');
        $('#expiry_reminders_title').text(PosnicPro.i18n.t('lang_expiry_reminders', 'Expiry reminders'));
        $('#expiry_reminders_help').text(PosnicPro.i18n.t('lang_expiry_reminders_help', 'Reminders appear in the POS bell for products with stock and a saved expiry date. Dates use the shop timezone. No email or WhatsApp messages are sent.'));
        $('#expiry_reminders_enabled_label').text(PosnicPro.i18n.t('lang_enable_expiry_reminders', 'Enable expiry reminders'));
        $('#expiry_reminders_days_label').text(PosnicPro.i18n.t('lang_expiry_days_ahead', 'Days before expiry'));
        $('#expiry_reminders_save').text(PosnicPro.i18n.t('lang_save_title', 'Save')).on('click', save);
        $('#expiry_reminders_previous').text(PosnicPro.i18n.t('lang_previous', 'Previous')).on('click', function () { load(page - 1); });
        $('#expiry_reminders_next').text(PosnicPro.i18n.t('lang_next', 'Next')).on('click', function () { load(page + 1); });
        $('#expiry_reminders_close').text(PosnicPro.i18n.t('lang_close_title', 'Close'));
        [PosnicPro.i18n.t('lang_itemname_title', 'Item Name'), PosnicPro.i18n.t('lang_expiry_date', 'Expiry Date'), PosnicPro.i18n.t('lang_quantity', 'Quantity'), PosnicPro.i18n.t('lang_status', 'Status:')].forEach(function (label) { $('<th>').text(label).appendTo('#expiry_reminders_head'); });
    }
    function paint(data) {
        page = data.page;
        $('#expiry_reminders_settings').toggle(data.canManage === true);
        $('#expiry_reminders_enabled').prop('checked', data.enabled);
        $('#expiry_reminders_days').val(data.days);
        $('#expiry_reminders_summary').text(data.enabled ? data.total + ' ' + PosnicPro.i18n.t('lang_products_due_for_expiry_review', 'products due for expiry review') + ' | ' + data.today + ' - ' + data.through + ' | ' + data.timezone : PosnicPro.i18n.t('lang_expiry_reminders_off', 'Expiry reminders are off.'));
        var body = $('#expiry_reminders_rows').empty();
        data.rows.forEach(function (row) {
            var tr = $('<tr>').appendTo(body);
            $('<td>').text(row.name).appendTo(tr);
            $('<td>').text(row.expiryDate).appendTo(tr);
            $('<td>').text(row.quantity).appendTo(tr);
            $('<td>').text(row.daysRemaining < 0 ? PosnicPro.i18n.t('lang_expired', 'Expired') : row.daysRemaining === 0 ? PosnicPro.i18n.t('lang_expires_today', 'Expires today') : row.daysRemaining + ' ' + PosnicPro.i18n.t('lang_days_remaining', 'days remaining')).appendTo(tr);
        });
        if (!data.rows.length) $('<tr>').append($('<td colspan="4">').text(PosnicPro.i18n.t('lang_no_products_expiry_review', 'No products to review.'))).appendTo(body);
        $('#expiry_reminders_previous').prop('disabled', page <= 1);
        $('#expiry_reminders_next').prop('disabled', page * 25 >= data.total);
    }
    function load(next) {
        if (loading) return;
        loading = true;
        var branch = PosnicPro.local.get('branch'), ticket = ++generation;
        $('#expiry_reminders_summary').text(PosnicPro.i18n.t('lang_loading', 'Loading…'));
        PosnicPro.get({ url: 'items/expiryReminders', data: { page: next } }, function (r) {
            loading = false;
            if (ticket !== generation || branch !== PosnicPro.local.get('branch')) return;
            if (r.type === 'success') paint(r.data); else error();
        }, function () { loading = false; error(); });
    }
    function save() {
        var days = Number($('#expiry_reminders_days').val());
        if (!Number.isInteger(days) || days < 0 || days > 365 || $('#expiry_reminders_days').val() === '') {
            PosnicPro.alert('error', PosnicPro.i18n.t('lang_expiry_days_invalid', 'Choose a reminder period between 0 and 365 days.')); return;
        }
        $('#expiry_reminders_save').prop('disabled', true);
        PosnicPro.put({ url: 'items/expiryReminders/preference', data: JSON.stringify({ enabled: $('#expiry_reminders_enabled').prop('checked'), days: days }) }, function (r) {
            $('#expiry_reminders_save').prop('disabled', false);
            if (r.type !== 'success') { error(); return; }
            PosnicPro.alert('success', PosnicPro.i18n.t('lang_expiry_preferences_saved', 'Expiry reminder settings saved.'));
            load(1); refresh();
        }, function () { $('#expiry_reminders_save').prop('disabled', false); error(); });
    }
    function refresh() {
        var branch = PosnicPro.local.get('branch');
        if (activeBranch !== branch) { activeBranch = branch; PosnicPro.bellFeed._expiryCount = 0; PosnicPro.bellFeed._expirySignature = ''; $('#expiry_bell_section').hide(); PosnicPro.bellFeed._badge(); }
        if (!branch || !PosnicPro.bellFeed._can(['item', 'read'])) { $('#expiry_bell_section').hide(); return; }
        PosnicPro.get({ url: 'items/expiryReminders' }, function (r) {
            if (branch !== PosnicPro.local.get('branch') || r.type !== 'success') return;
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
        open: function () { modal(); $('#expiry_reminders_modal').modal('show'); load(1); },
        refresh: refresh,
        init: function () {
            if (initialized) return; initialized = true;
            if (!$('#expiry_bell_section').length) $('<div id="expiry_bell_section" class="dropdown-item" style="display:none"><button type="button" id="expiry_bell_link" class="btn btn-outline-primary btn-block"></button></div>').insertAfter('#bell_feed_list');
            $('#expiry_bell_link').off('click.expiry').on('click.expiry', function () { window.location.hash = '#/items'; PosnicPro.expiryReminders.open(); });
            $('#dropdown-notification').on('shown.bs.dropdown.expiry', function () {
                PosnicPro.local.set('expiry_reminders_seen', PosnicPro.bellFeed._expirySignature || '');
                PosnicPro.bellFeed._expiryCount = 0; PosnicPro.bellFeed._badge(); refresh();
            });
            refresh();
            window.setInterval(function () { if (!document.hidden) refresh(); }, 300000);
        }
    };
})();
