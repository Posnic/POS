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
