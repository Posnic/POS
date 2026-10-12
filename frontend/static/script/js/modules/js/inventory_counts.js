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
PosnicPro.inventorycounts.loadMobile = function (after) {
    var self = this, branch = PosnicPro.local.get('branch_id_set'), ticket = self.mobileRequest = (self.mobileRequest || 0) + 1;
    if (!$('#mobile_inventory_operations').length) $('#inventory_counts_list').after('<section id="mobile_inventory_operations" class="mt-4"><h5>Mobile inventory operations</h5><button class="btn btn-outline-primary mobile-inventory-refresh">Refresh</button><div id="mobile_inventory_rows" class="mt-3"></div><div id="mobile_inventory_detail"></div></section>');
    PosnicPro.get('mobile/v1/inventory/operations' + (after ? '?after=' + encodeURIComponent(after) : ''), function (r) {
        if (ticket !== self.mobileRequest || branch !== PosnicPro.local.get('branch_id_set')) return;
        var root = $('#mobile_inventory_rows'); if (!after) root.empty();
        root.find('.mobile-inventory-more').remove();
        if (!Array.isArray(r.rows)) return root.text('Could not load inventory operations.');
        if (!r.rows.length) root.text('No mobile inventory operations yet.');
        r.rows.forEach(function (row) {
            var card = $('<div class="border rounded p-3 mb-2">').appendTo(root);
            $('<strong>').text(row.mode + ' · ' + row.state).appendTo(card);
            $('<p>').text(row.reason).appendTo(card);
            $('<button class="btn btn-outline-primary mobile-inventory-open">').text('Review').attr('data-id', row.operationId).appendTo(card);
        });
        if (r.next) $('<button class="btn btn-outline-primary mobile-inventory-more">').text('Load more').attr('data-after', r.next).appendTo(root);
    });
};
PosnicPro.inventorycounts.openMobile = function (id) {
    PosnicPro.get('mobile/v1/inventory/operations/' + encodeURIComponent(id), function (r) {
        var root = $('#mobile_inventory_detail').empty();
        if (!r.operationId) return root.text('Could not load operation.');
        $('<h5>').text(r.mode + ' · ' + r.state).appendTo(root);
        $('<p>').text(r.reason).appendTo(root);
        var table = $('<table class="table"><thead><tr><th>Item</th><th>Expected</th><th>Quantity</th><th>Status</th></tr></thead><tbody></tbody></table>').appendTo(root);
        r.lines.forEach(function (line) {
            var tr = $('<tr>').appendTo(table.find('tbody'));
            [line.name, line.expected / 1000, line.quantity / 1000, r.applied.indexOf(line.itemId) >= 0 ? 'Applied' : 'Not applied'].forEach(function (value) { $('<td>').text(value).appendTo(tr); });
        });
        if (r.state === 'prepared' || r.state === 'applying') $('<button class="btn btn-primary mobile-inventory-confirm">').text(r.approvalRequired ? 'Approve stock changes' : 'Confirm stock changes').attr('data-id', id).appendTo(root);
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
        if (!r.operationId) { PosnicPro.alert('error', 'Could not confirm. Check permissions and refresh the operation before retrying.'); return; }
        PosnicPro.inventorycounts.openMobile(id); PosnicPro.inventorycounts.loadMobile();
    }, function () { button.prop('disabled', false); PosnicPro.alert('error', 'Connection interrupted. Refresh to check the operation before retrying.'); });
});
