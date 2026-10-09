(function () {
    function show(id) {
        PosnicPro.HideSideBarModal();
        $('.page_loader,#osk-container').hide();
        $('.nav-link-active,.tab-pane-active,.dropdown-item,.vertical-menu li a').removeClass('active');
        $('#v-pills-inventory-tab,#view_' + id + '_page').addClass('active');
        $('#v-pills-inventory').addClass('show active');
        $('.page-title-box,#' + id).show();
    }
    function failed() { PosnicPro.alert('error', PosnicPro.i18n.t('lang_expiry_load_failed', 'Could not load expiry reminders. Please try again.')); }
    PosnicPro.itemsettings = {
        showDataTablePage: function () {
            PosnicPro.local.set('posnic_core_tab', '#core-tab-inventory');
            hasher.setHash('settings/general');
        },
        load: function () {
            $('#item_settings_status').text(PosnicPro.i18n.t('lang_loading', 'Loading…'));
            $('#item_settings_save_stock,#expiry_reminders_save').prop('disabled', true);
            PosnicPro.itemStockPreference.load('#item_stock_preference');
            PosnicPro.get({url:'items/expiryReminders'}, function (r) {
                if (r.type !== 'success') { failed(); return; }
                $('#item_stock_preference,#item_settings_save_stock,#expiry_reminders_enabled,#expiry_reminders_days,#expiry_reminders_save').prop('disabled', !r.data.canManage);
                $('#expiry_reminders_enabled').prop('checked', r.data.enabled);
                $('#expiry_reminders_days').val(r.data.days);
                $('#item_settings_status').text(r.data.canManage ? '' : PosnicPro.i18n.t('lang_item_settings_admin', 'An administrator can change item settings.'));
            }, failed);
        }
    };
    var page = 1, request = 0;
    PosnicPro.expiryreport = {
        showDataTablePage: function () { show('expiryreport'); this.load(1); },
        load: function (next) {
            var ticket = ++request, branch = PosnicPro.local.get('branch_id_set');
            var days = Number($('#expiry_report_days').val());
            if (!Number.isInteger(days) || days < 0 || days > 365 || $('#expiry_report_days').val() === '') { failed(); return; }
            $('#expiry_report_summary').text(PosnicPro.i18n.t('lang_loading', 'Loading…'));
            $('#expiry_report_previous,#expiry_report_next').prop('disabled', true);
            $('#expiry_report_rows').empty();
            PosnicPro.get({url:'items/expiryReport', data:{ page:next, days:days, search:$('#expiry_report_search').val(), status:$('#expiry_report_status').val(), sort:$('#expiry_report_sort').val() }}, function (r) {
                if (ticket !== request || branch !== PosnicPro.local.get('branch_id_set')) return;
                if (r.type !== 'success') { $('#expiry_report_summary').text(''); failed(); return; }
                var d = r.data; page = d.page;
                $('#expiry_report_summary').text(d.total + ' ' + PosnicPro.i18n.t('lang_products_due_for_expiry_review', 'products due for expiry review') + ' | ' + d.today + ' - ' + d.through + ' | ' + d.timezone);
                d.rows.forEach(function (row) {
                    var tr = $('<tr>').appendTo('#expiry_report_rows');
                    [row.name, row.sku, row.expiryDate, row.quantity, row.daysRemaining < 0 ? PosnicPro.i18n.t('lang_expired', 'Expired') : row.daysRemaining === 0 ? PosnicPro.i18n.t('lang_expires_today', 'Expires today') : row.daysRemaining + ' ' + PosnicPro.i18n.t('lang_days_remaining', 'days remaining')].forEach(function (value) { $('<td>').text(value).appendTo(tr); });
                });
                if (!d.rows.length) $('<tr>').append($('<td colspan="5">').text(PosnicPro.i18n.t('lang_no_products_expiry_review', 'No products to review.'))).appendTo('#expiry_report_rows');
                $('#expiry_report_page').text(page + ' / ' + Math.max(1, Math.ceil(d.total / 25)));
                $('#expiry_report_previous').prop('disabled', page <= 1);
                $('#expiry_report_next').prop('disabled', page * 25 >= d.total);
            }, function () { if (ticket === request) { $('#expiry_report_summary').text(''); failed(); } });
        }
    };
    $(document).on('submit', '#expiry_report_filters', function (e) { e.preventDefault(); PosnicPro.expiryreport.load(1); });
    $(document).on('click', '#expiry_report_previous', function () { PosnicPro.expiryreport.load(page - 1); });
    $(document).on('click', '#expiry_report_next', function () { PosnicPro.expiryreport.load(page + 1); });
    $(document).on('click', '#item_settings_save_stock', function () {
        var button = $(this).prop('disabled', true);
        PosnicPro.itemStockPreference.save($('#item_stock_preference').val(), function () { button.prop('disabled', false); PosnicPro.alert('success', PosnicPro.i18n.t('lang_item_settings_saved', 'Item settings saved.')); }, function () { button.prop('disabled', false); });
    });
    $(document).on('click', '#expiry_reminders_save', function () {
        var days = Number($('#expiry_reminders_days').val()), button = $(this);
        if (!Number.isInteger(days) || days < 0 || days > 365 || $('#expiry_reminders_days').val() === '') { PosnicPro.alert('error', PosnicPro.i18n.t('lang_expiry_days_invalid', 'Choose a reminder period between 0 and 365 days.')); return; }
        button.prop('disabled', true);
        PosnicPro.put({url:'items/expiryReminders/preference',data:JSON.stringify({enabled:$('#expiry_reminders_enabled').prop('checked'),days:days})},function(r){button.prop('disabled',false);if(r.type!=='success'){failed();return;}PosnicPro.alert('success',PosnicPro.i18n.t('lang_expiry_preferences_saved','Expiry reminder settings saved.'));PosnicPro.expiryReminders.refresh();},function(){button.prop('disabled',false);failed();});
    });
})();
