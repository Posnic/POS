PosnicPro.lowstockitems = {
    _page: 1,
    PAGE_SIZE: 25,
    _lastRows: [],
    _chrome: function () {
        PosnicPro.HideSideBarModal();
        $('.page_loader,#osk-container').hide();
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $('.vertical-menu li a').removeClass('active');
        $('#v-pills-inventory-tab,#view_itemslow_page').addClass('active');
        $('#v-pills-inventory').addClass('show active');
        $('.page-title-box,#lowstockitems').show();
        $('.dashboard_img_menu').hide();
        $('#image_sidebar_lowstock').show();
    },
    showDataTablePage: function () {
        PosnicPro.lowstockitems._chrome();
        PosnicPro.lowstockitems.loadList(1);
    },
    /* The watchlist is about the item, so the deep link is the item's. */
    showDetails: function (id) {
        hasher.setHash('items/' + id);
    },
    mountFilters: function (force) {
        if (!$('#lowstockitems_filter_panel').length) { return; }
        if (!force && $('#lowstockitems_filter_panel').data('mounted')) { return; }
        $('#lowstockitems_filter_panel').data('mounted', true);
        PosnicPro.listFilter.mount({
            key: 'lowstockitems',
            container: '#lowstockitems_filter_panel',
            button: '#lowstockitems_filter_btn',
            searchPlaceholder: 'Search item, SKU, supplier or category',
            searchFields: [
                { value: 'all', label: 'All fields' },
                { value: 'name', label: 'Item' },
                { value: 'itemid', label: 'SKU' },
                { value: 'supplier_name', label: 'Supplier' },
                { value: 'category_name', label: 'Category' }
            ],
            onChange: function () { PosnicPro.lowstockitems.loadList(1); }
        });
    },
    loadList: function (page) {
        PosnicPro.lowstockitems.mountFilters();
        var self = PosnicPro.lowstockitems;
        if (page) { self._page = page; }
        var filters = PosnicPro.listFilter.legacyFilters('lowstockitems', {});
        var esc = function (t) { return $('<span>').text(t == null ? '' : t).html(); };
        PosnicPro.get({
            url: 'items/itemLowStockTable',
            data: {
                page: self._page,
                limit: self.PAGE_SIZE,
                filters: JSON.stringify(filters),
                notificationrange: localStorage.getItem('notificationrange')
            }
        }, function (response) {
            var data = (response && response.data) || {};
            var list = data.list || [];
            self._lastRows = list;
            if (!list.length) {
                var filtered = PosnicPro.listFilter.activeCount('lowstockitems') > 0;
                $('#lowstockitems_list_rows').html('<div class="text-center text-muted p-t-20 p-b-20">'
                    + (filtered ? 'No low-stock items match this filter.' : 'Nothing is running low - every item is above its alert level.') + '</div>');
                $('#lowstockitems_list_paging').html('');
                return;
            }
            var html = '<div class="table-responsive"><table class="table table-borderless">'
                + '<thead><tr><th style="width:44px;"></th><th>Item</th><th class="ls-col-sku">SKU</th>'
                + '<th class="ls-col-supplier">Supplier</th><th class="ls-col-category">Category</th>'
                + '<th class="text-right">Left</th><th style="width:110px;"></th></tr></thead><tbody>';
            list.forEach(function (r) {
                var img = (r.image && r.image !== 'item.svg') ? r.image : 'static/images/default/item.svg';
                html += '<tr class="md-row lowstockitems-row highlight-select" data-id="' + esc(r._id) + '" style="cursor:pointer;">'
                    + '<td><img loading="lazy" decoding="async" src="' + esc(img) + '" style="width:30px; height:30px; object-fit:cover; border-radius:5px;" alt=""></td>'
                    + '<td>' + esc(r.name) + '</td>'
                    + '<td class="ls-col-sku q-muted">' + esc(r.itemid || '-') + '</td>'
                    + '<td class="ls-col-supplier">' + esc(r.supplier_name || '-') + '</td>'
                    + '<td class="ls-col-category">' + esc(r.category_name || '-') + '</td>'
                    + '<td class="text-right"><span class="rs-pill unpaid">' + esc(r.available_quantity) + ' left</span></td>'
                    + '<td class="text-right"><button type="button" class="btn btn-sm btn-primary-rgba ls-restock" data-module="receiving" data-access="write" data-id="' + esc(r._id) + '">'
                    + '<i class="feather icon-plus mr-1"></i>Restock</button></td>'
                    + '</tr>';
            });
            html += '</tbody></table></div>';
            $('#lowstockitems_list_rows').html(html);
            PosnicPro.ACLForModule('receiving');
            self.renderPager(Number(data.total) || list.length);
        }, function () {
            $('#lowstockitems_list_rows').html('<div class="text-center text-muted p-t-20 p-b-20">Could not load the low stock list - try again.</div>');
        });
    },
    renderPager: function (total) {
        var self = PosnicPro.lowstockitems;
        var p = self._page, size = self.PAGE_SIZE;
        var pages = Math.ceil(total / size) || 1;
        var label = total + (total === 1 ? ' item running low' : ' items running low');
        if (pages > 1) { label = 'Page ' + p + ' of ' + pages + ' · ' + label; }
        var btn = function (to, text, off, cls) {
            return '<button type="button" class="btn btn-sm ' + (cls || 'btn-secondary-rgba') + ' q-pg-btn"' + (off ? ' disabled' : '')
                + ' onclick="PosnicPro.lowstockitems.goPage(' + to + ');">' + text + '</button>';
        };
        var html = '';
        if (pages > 1) {
            html += btn(p - 1, '&laquo;', p <= 1);
            var end = Math.min(pages, Math.max(1, p - 2) + 4);
            var start = Math.max(1, end - 4);
            for (var n = start; n <= end; n++) {
                html += '<span class="q-pg-num">' + btn(n, n, false, n === p ? 'btn-primary-rgba' : 'btn-secondary-rgba') + '</span>';
            }
        }
        html += '<span class="q-pg-count">' + label + '</span>';
        if (pages > 1) { html += btn(p + 1, '&raquo;', p >= pages); }
        $('#lowstockitems_list_paging').html(html);
    },
    goPage: function (n) {
        if (!n || n < 1) { return; }
        PosnicPro.lowstockitems._page = n;
        PosnicPro.lowstockitems.loadList();
    },
    exportCsv: function () {
        var rows = [['Item', 'SKU', 'Supplier', 'Category', 'Available']];
        (PosnicPro.lowstockitems._lastRows || []).forEach(function (r) {
            rows.push([r.name, r.itemid || '', r.supplier_name || '', r.category_name || '', r.available_quantity]);
        });
        var csv = rows.map(function (r) {
            return r.map(function (c) { return '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"'; }).join(',');
        }).join('\n');
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'low-stock.csv';
        a.click();
        URL.revokeObjectURL(a.href);
    },
    /* Restock: open a new purchase with the item AND its supplier already
       filled - the flow the old Add Stock action carried, kept as-is. */
    loadLowStockValue: function (id) {
        var loader = $(".loader-low_stock");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        PosnicPro.get('items/' + id, function (response) {
            loader.find(".loadingSpinner:first").remove();
            PosnicPro.receivings.clearReceivingForm();
            var data = response.data;
            var itemDetails = {
                "item_id": data.id,
                "item_name": data.name,
                "company_price": data.company_price,
                "barcode_id": data.barcode_id,
                "item_quantity": data.available_quantity,
                "discount_amount": data.discount_amount,
                "discount_percentage": data.discount_percentage,
                "tax": data.tax,
                "supplier": data.supplier_name
            };
            PosnicPro.receivings.addReceivingLineItems(itemDetails);
            PosnicPro.get('suppliers/' + data.supplier_id, function (response) {
                if (response.type === 'success') {
                    let supplierData = response.data;
                    $('#receiving_add_supplier_id').val(supplierData._id);
                    $('#receiving_add_supplier_name').val(supplierData.name);
                    $('#receiving_add_supplier_address').val(supplierData.address);
                    $('#receiving_add_supplier_phone').val(supplierData.phone);
                    $('#receiving_add_supplier_email').val(supplierData.email);
                    $('#receiving_add_supplier_state').val(supplierData.state);
                    $('#receiving_add_supplier_gst_type').val(supplierData.gst_type);
                    $('#receiving_add_supplier_gst_number').val(supplierData.gst_number);
                }
            });
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    }
};

$(document).on('click', '#lowstockitems_filter_btn', function () {
    PosnicPro.lowstockitems.mountFilters(true);
    PosnicPro.listFilter.toggle('lowstockitems');
});
$(document).on('click', '#lowstockitems_list_rows tr.lowstockitems-row', function () {
    hasher.setHash('items/' + $(this).data('id'));
});
$(document).on('click', '.ls-restock', function (e) {
    e.stopPropagation();
    var id = $(this).data('id');
    hasher.setHash('receivings/new');
    PosnicPro.lowstockitems.loadLowStockValue(id);
});
