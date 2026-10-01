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
        this.load();
    },
    load: function () {
        var self = this;
        PosnicPro.get('inventory-counts', function (response) {
            var rows = response && response.data || [];
            if (!rows.length) return $('#inventory_counts_list').html('<div class="text-center p-4">No stock-count drafts yet.</div>');
            $('#inventory_counts_list').html('<div class="table-responsive"><table class="table"><thead><tr><th>Created</th><th>Scope</th><th>Status</th><th></th></tr></thead><tbody>' + rows.map(function (row) { return '<tr><td>' + self.esc(moment(row.created_at).format('LLL')) + '</td><td>' + self.esc(row.scope || 'all') + '</td><td><span class="badge badge-primary-inverse">' + self.esc(row.status) + '</span></td><td class="text-right"><button class="btn btn-sm btn-primary-rgba inventory-count-open" data-id="' + self.esc(row._id) + '">Review</button></td></tr>'; }).join('') + '</tbody></table></div>');
        });
    },
    open: function (id) {
        var self = this;
        PosnicPro.get('inventory-counts/' + encodeURIComponent(id), function (response) {
            var row = response && response.data;
            if (!row) return;
            $('#inventory_count_detail').show().html('<h5>Count worksheet</h5><p class="text-muted">Expected quantities are a snapshot. Entering and applying counted quantities will remain a separate reviewed inventory operation.</p><div class="table-responsive"><table class="table table-sm"><thead><tr><th>Item</th><th>SKU</th><th class="text-right">Expected</th><th class="text-right">Counted</th></tr></thead><tbody>' + (row.items || []).map(function (item) { return '<tr><td>' + self.esc(item.item_name) + '</td><td>' + self.esc(item.barcode_id || '—') + '</td><td class="text-right">' + self.esc(item.expected_quantity) + ' ' + self.esc(item.unit) + '</td><td class="text-right">—</td></tr>'; }).join('') + '</tbody></table></div>');
        });
    }
};
$(document).on('click', '.inventory-count-open', function () { PosnicPro.inventorycounts.open($(this).data('id')); });
