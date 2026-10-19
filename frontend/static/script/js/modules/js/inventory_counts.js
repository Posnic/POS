PosnicPro.inventorycounts = {
    esc: function (value) { return $('<span>').text(value == null ? '' : value).html(); },
    showDataTablePage: function () {
        PosnicPro.HideSideBarModal();
        $('.page_loader,#osk-container').hide();
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $('.vertical-menu li a').removeClass('active');
        $('#v-pills-inventory-tab,#view_inventorycounts_page').addClass('active');
        $('#v-pills-inventory').addClass('show active');
        $('.page-title-box,#inventorycounts').show();
        PosnicPro.ACLForModule('item');
        this.load();
    },
    load: function () {
        var self = this;
        PosnicPro.get('inventory-counts', function (response) {
            var rows = response && response.data || [];
            if (!rows.length) return $('#inventory_counts_list').html('<div class="text-center p-4"><lang class="lang_no_stock_count_drafts_yet">No stock-count drafts yet.</lang><p class="mt-3 mb-0">Use Start recount to enter actual quantities and review the stock changes before applying them.</p></div>');
            $('#inventory_counts_list').html('<div class="table-responsive"><table class="table"><thead><tr><th><lang class="lang_created">Created</lang></th><th><lang class="lang_scope">Scope</lang></th><th><lang class="lang_userstatus">Status</lang></th><th></th></tr></thead><tbody>' + rows.map(function (row) { return '<tr><td>' + self.esc(moment(row.created_at).format('LLL')) + '</td><td>' + self.esc(row.scope || 'all') + '</td><td><span class="badge badge-primary-inverse">' + self.esc(row.status) + '</span></td><td class="text-right"><button class="btn btn-sm btn-primary-rgba inventory-count-open" data-id="' + self.esc(row._id) + '">Review</button></td></tr>'; }).join('') + '</tbody></table></div>');
        });
    },
    open: function (id) {
        var self = this;
        PosnicPro.get('inventory-counts/' + encodeURIComponent(id), function (response) {
            var row = response && response.data;
            if (!row) return;
            $('#inventory_count_detail').show().html('<h5><lang class="lang_count_worksheet">Count worksheet</lang></h5><p class="text-muted">Expected quantities are a snapshot. Entering and applying counted quantities will remain a separate reviewed inventory operation.</p><div class="table-responsive"><table class="table table-sm"><thead><tr><th><lang class="lang_newitem_title">Item</lang></th><th><lang class="lang_sku_title">SKU</lang></th><th class="text-right"><lang class="lang_expected">Expected</lang></th><th class="text-right"><lang class="lang_counted">Counted</lang></th></tr></thead><tbody>' + (row.items || []).map(function (item) { return '<tr><td>' + self.esc(item.item_name) + '</td><td>' + self.esc(item.barcode_id || '—') + '</td><td class="text-right">' + self.esc(item.expected_quantity) + ' ' + self.esc(item.unit) + '</td><td class="text-right">—</td></tr>'; }).join('') + '</tbody></table></div>');
        });
    }
};
$(document).on('click', '.inventory-count-open', function () { PosnicPro.inventorycounts.open($(this).data('id')); });
// Mobile inventory shares the item ledger; reviewed operations are visible here.
PosnicPro.inventorycounts.operationLabel = function (mode) {
    var labels = {count:['lang_stock_counts','Stock Counts'],receive:['lang_receive','Receive'],damage:['lang_damage','Damage'],loss:['lang_loss','Loss']};
    var value = labels[mode]; return value ? PosnicPro.i18n.t(value[0],value[1]) : mode;
};
PosnicPro.inventorycounts.statusBadge = function (state) {
    var labels = {complete:['lang_completed','Completed'],prepared:['lang_review_title','Review'],applying:['lang_processing_and_review','Processing and review'],conflict:['lang_review_changes','Review changes']};
    var value = labels[state], known = Object.prototype.hasOwnProperty.call(labels,state);
    return $('<span class="inventory-status">').addClass(known ? state : '').append($('<i aria-hidden="true" class="feather">').addClass(state === 'complete' ? 'icon-check-circle' : state === 'conflict' ? 'icon-alert-circle' : 'icon-clock')).append(document.createTextNode(value ? PosnicPro.i18n.t(value[0],value[1]) : state));
};
PosnicPro.inventorycounts.loadMobile = function (after) {
    var self = this, branch = PosnicPro.local.get('branch_id_set'), ticket = self.mobileRequest = (self.mobileRequest || 0) + 1;
    if (!$('#mobile_inventory_operations').length) $('#inventory_counts_list').after('<section id="mobile_inventory_operations" class="inventory-panel"><div class="inventory-panel-header"><h5><i class="feather icon-smartphone" aria-hidden="true"></i><lang class="lang_mobile_inventory_operations">Mobile inventory operations</lang></h5><button class="btn btn-sm btn-outline-primary mobile-inventory-refresh"><i class="feather icon-refresh-cw" aria-hidden="true"></i><lang class="lang_wf_refresh">Refresh</lang></button></div><div id="mobile_inventory_rows" aria-live="polite"></div></section><div id="mobile_inventory_detail" tabindex="-1"></div>');
    $('#mobile_inventory_operations').attr('aria-busy','true');
    PosnicPro.get('mobile/v1/inventory/operations' + (after ? '?after=' + encodeURIComponent(after) : ''), function (r) {
        if (ticket !== self.mobileRequest || branch !== PosnicPro.local.get('branch_id_set')) return;
        $('#mobile_inventory_operations').attr('aria-busy','false');
        var root = $('#mobile_inventory_rows');
        if (!Array.isArray(r.rows)) { if (!after) root.empty(); return $('<p class="inventory-empty" role="alert">').text(PosnicPro.i18n.t('lang_could_not_load_inventory_operations', 'Could not load inventory operations.')).appendTo(root); }
        if (!after) root.empty();
        root.find('.mobile-inventory-more').remove();
        if (!r.rows.length && !root.find('tbody tr').length) return root.html('<div class="inventory-empty">' + self.esc(PosnicPro.i18n.t('lang_no_mobile_inventory_operations_yet', 'No mobile inventory operations yet.')) + '</div>');
        if (!root.find('table').length) root.append('<div class="table-responsive"><table class="table inventory-table"><thead><tr><th><lang class="lang_activity_2">Activity</lang></th><th><lang class="lang_created">Created</lang></th><th class="text-right"><lang class="lang_items">Items</lang></th><th><lang class="lang_userstatus">Status</lang></th><th><span class="sr-only"><lang class="lang_review_title">Review</lang></span></th></tr></thead><tbody></tbody></table></div>');
        r.rows.forEach(function (row) {
            var tr = $('<tr>').appendTo(root.find('tbody')), icon = {count:'clipboard',receive:'truck',damage:'alert-triangle',loss:'minus-circle'}[row.mode] || 'package';
            var cell = $('<td>').appendTo(tr), operation = $('<div class="inventory-operation">').appendTo(cell);
            $('<span class="inventory-operation-icon" aria-hidden="true">').append($('<i class="feather">').addClass('icon-' + icon)).appendTo(operation);
            var description = $('<div>').appendTo(operation);
            $('<strong>').text(self.operationLabel(row.mode)).appendTo(description);
            if (row.reason) $('<small>').text(row.reason).appendTo(description);
            $('<td class="inventory-date">').text(row.createdAt && moment(row.createdAt).isValid() ? moment(row.createdAt).format('lll') : '—').appendTo(tr);
            $('<td class="text-right">').text((row.lines || []).length).appendTo(tr);
            $('<td>').append(self.statusBadge(row.state)).appendTo(tr);
            $('<td class="text-right">').append($('<button class="btn btn-sm btn-outline-primary mobile-inventory-open">').text(PosnicPro.i18n.t('lang_review_title', 'Review')).append(' ').append($('<i class="feather icon-arrow-right" aria-hidden="true">')).attr('data-id', row.operationId)).appendTo(tr);
        });
        if (r.next) $('<button class="btn btn-sm btn-outline-primary mobile-inventory-more">').text(PosnicPro.i18n.t('lang_load_more', 'Load more')).attr('data-after', r.next).appendTo(root);
    });
};
PosnicPro.inventorycounts.openMobile = function (id) {
    var self = this, branch = PosnicPro.local.get('branch_id_set'), ticket = self.detailRequest = (self.detailRequest || 0) + 1;
    PosnicPro.get('mobile/v1/inventory/operations/' + encodeURIComponent(id), function (r) {
        if (ticket !== self.detailRequest || branch !== PosnicPro.local.get('branch_id_set')) return;
        var root = $('#mobile_inventory_detail').empty();
        if (!r.operationId) return root.text(PosnicPro.i18n.t('lang_could_not_load_operation', 'Could not load operation.'));
        var header = $('<div class="inventory-panel-header">').appendTo(root);
        $('<h5>').text(self.operationLabel(r.mode)).append(self.statusBadge(r.state)).appendTo(header);
        $('<button class="btn btn-sm btn-outline-secondary mobile-inventory-close">').append('<i class="feather icon-x" aria-hidden="true"></i>').append(document.createTextNode(PosnicPro.i18n.t('lang_close','Close'))).appendTo(header);
        $('<p>').text(r.reason).appendTo(root);
        var table = $('<table class="table inventory-table"><thead><tr><th><lang class="lang_newitem_title">Item</lang></th><th><lang class="lang_expected">Expected</lang></th><th><lang class="lang_quantity">Quantity</lang></th><th><lang class="lang_userstatus">Status</lang></th></tr></thead><tbody></tbody></table>').appendTo($('<div class="table-responsive">').appendTo(root));
        (r.lines || []).forEach(function (line) {
            var tr = $('<tr>').appendTo(table.find('tbody'));
            [line.name, line.expected / 1000, line.quantity / 1000, (r.applied || []).indexOf(line.itemId) >= 0 ? PosnicPro.i18n.t('lang_applied', 'Applied') : PosnicPro.i18n.t('lang_not_applied', 'Not applied')].forEach(function (value) { $('<td>').text(value).appendTo(tr); });
        });
        if (r.state === 'prepared' || r.state === 'applying') $('<button class="btn btn-primary mobile-inventory-confirm">').text(r.approvalRequired ? PosnicPro.i18n.t('lang_approve_stock_changes', 'Approve stock changes') : PosnicPro.i18n.t('lang_confirm_stock_changes', 'Confirm stock changes')).attr('data-id', id).appendTo(root);
        root[0].scrollIntoView({behavior:'smooth',block:'start'}); root.trigger('focus');
        if (r.state === 'conflict') $('<p role="status">').text('Some lines could not be applied. Refresh stock and recount unresolved items. Applied lines stay applied.').appendTo(root);
    });
};
var originalInventoryLoad = PosnicPro.inventorycounts.load;
PosnicPro.inventorycounts.load = function () { originalInventoryLoad.call(this); this.loadMobile(); };
$(document).on('click', '.mobile-inventory-refresh', function () { PosnicPro.inventorycounts.loadMobile(); });
$(document).on('click', '.mobile-inventory-more', function () { PosnicPro.inventorycounts.loadMobile($(this).attr('data-after')); });
$(document).on('click', '.mobile-inventory-open', function () { PosnicPro.inventorycounts.openMobile($(this).attr('data-id')); });
$(document).on('click', '.mobile-inventory-confirm', function () {
    var button = $(this).prop('disabled', true), id = button.attr('data-id');
    PosnicPro.post({url:'mobile/v1/inventory/operations/' + encodeURIComponent(id) + '/confirm',data:'{}'}, function (r) {
        button.prop('disabled', false);
        if (!r.operationId) { PosnicPro.alert('error', PosnicPro.i18n.t('lang_could_not_confirm_check_permissions_and_re', 'Could not confirm. Check permissions and refresh the operation before retrying.')); return; }
        PosnicPro.inventorycounts.openMobile(id); PosnicPro.inventorycounts.loadMobile();
    }, function () { button.prop('disabled', false); PosnicPro.alert('error', PosnicPro.i18n.t('lang_connection_interrupted_refresh_to_check_th', 'Connection interrupted. Refresh to check the operation before retrying.')); });
});

$(document).on('click', '.mobile-inventory-close', function () { PosnicPro.inventorycounts.detailRequest = (PosnicPro.inventorycounts.detailRequest || 0) + 1; $('#mobile_inventory_detail').empty(); $('#mobile_inventory_operations .mobile-inventory-refresh').trigger('focus'); });
