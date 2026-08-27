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
    /* Deep link #/lowstockitems/<id>: the watchlist with that item open
       in the right pane. Recognises its own setHash echo. */
    showDetails: function (id) {
        if (PosnicPro.listDoc.activeId('lowstockitems') === String(id)
            && $('#lowstockitems_detail_card').is(':visible')) { return; }
        PosnicPro.lowstockitems._chrome();
        PosnicPro.lowstockitems.loadList(1);
        PosnicPro.lowstockitems.openDoc(id);
    },
    openDoc: function (id) {
        var self = PosnicPro.lowstockitems;
        var r = (self._lastRows || []).filter(function (x) { return String(x._id) === String(id); })[0];
        var esc = function (t) { return $('<span>').text(t == null ? '' : t).html(); };
        var actions = '<button type="button" class="btn btn-sm btn-primary-rgba ls-restock" data-module="receiving" data-access="write" data-id="' + esc(id) + '">'
            + '<i class="feather icon-plus mr-1"></i>Restock</button>';
        if (r) {
            PosnicPro.listDoc.open({ key: 'lowstockitems', id: id, title: r.name, actions: actions, body: self._docBody(r) });
            PosnicPro.ACLForModule('receiving');
            return;
        }
        /* deep link before the list landed - the item record fills in */
        PosnicPro.listDoc.open({ key: 'lowstockitems', id: id, title: 'Item', actions: actions });
        PosnicPro.ACLForModule('receiving');
        PosnicPro.get('items/' + id, function (response) {
            var d = response && response.data;
            if (response.type !== 'success' || !d) {
                PosnicPro.listDoc.body('lowstockitems', '<div class="text-danger p-3">Could not open this item.</div>');
                return;
            }
            PosnicPro.listDoc.title('lowstockitems', d.name || 'Item');
            PosnicPro.listDoc.body('lowstockitems', self._docBody({
                _id: id,
                name: d.name,
                itemid: d.itemid,
                category_name: d.category_name,
                supplier_name: d.supplier_name,
                available_quantity: d.available_quantity,
                image: d.image
            }));
        }, function () {
            PosnicPro.listDoc.body('lowstockitems', '<div class="text-danger p-3">Could not open this item.</div>');
        });
    },
    _docBody: function (r) {
        var esc = function (t) { return $('<span>').text(t == null ? '' : t).html(); };
        var img = (r.image && r.image !== 'item.svg') ? r.image : 'static/images/default/item.svg';
        return '<div style="display:flex; gap:20px; align-items:flex-start;">'
            + '<img src="' + esc(img) + '" style="width:84px; height:84px; object-fit:cover; border-radius:8px; flex:0 0 84px; border:1px solid var(--theme-border-color, #e3e7ee);" alt="">'
            + '<div style="flex:1 1 auto; min-width:0;">'
            + PosnicPro.listDoc.stats([
                { v: '<span style="color:var(--theme-danger-color, #c0392b);">' + esc(r.available_quantity) + '</span>', l: 'Left in stock' },
                { v: esc(r.itemid || '—'), l: 'SKU' }
            ])
            + '</div></div>'
            + PosnicPro.listDoc.grid([
                { label: 'Identity', lines: [
                    r.category_name ? '<div>' + esc(r.category_name) + '</div>' : '',
                    '<div class="q-muted">' + esc(r.name) + '</div>'
                ] },
                { label: 'Supply', lines: [
                    r.supplier_name ? '<div>' + esc(r.supplier_name) + '</div>' : '<div class="q-muted">No supplier on record</div>'
                ] }
            ])
            + PosnicPro.listDoc.link('Open in Item List', "hasher.setHash('items/" + esc(r._id) + "');");
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
                html += '<tr class="md-row lowstockitems-row highlight-select'
                    + (PosnicPro.listDoc.activeId('lowstockitems') === String(r._id) ? ' is-active' : '') + '" data-id="' + esc(r._id) + '" style="cursor:pointer;">'
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
    _csvSpec: function () {
        return {
            head: ['Item', 'SKU', 'Supplier', 'Category', 'Available'],
            map: function (r) {
                return [r.name, r.itemid || '', r.supplier_name || '', r.category_name || '', r.available_quantity];
            }
        };
    },
    exportCsv: function () {
        var spec = PosnicPro.lowstockitems._csvSpec();
        PosnicPro.listExport.save(
            [spec.head].concat((PosnicPro.lowstockitems._lastRows || []).map(spec.map)), 'low-stock.csv');
    },
    /* Everything matching the CURRENT filter, paged through the same
       endpoint the list reads - never a shapeless full dump. */
    exportAllCsv: function () {
        var spec = PosnicPro.lowstockitems._csvSpec();
        PosnicPro.listExport.all({
            url: 'items/itemLowStockTable',
            params: function (page, limit) {
                return { page: page, limit: limit, filters: JSON.stringify(PosnicPro.listFilter.legacyFilters('lowstockitems', {})), notificationrange: localStorage.getItem('notificationrange') };
            },
            head: spec.head,
            map: spec.map,
            filename: 'low-stock.csv'
        });
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
/* Details first, in the right pane (owner: no popups, no redirects -
   "similar right side open design"). */
$(document).on('click', '#lowstockitems_list_rows tr.lowstockitems-row', function (e) {
    if ($(e.target).closest('.ls-restock').length) { return; }
    PosnicPro.lowstockitems.openDoc($(this).data('id'));
});
$(document).on('click', '.ls-restock', function (e) {
    e.stopPropagation();
    var id = $(this).data('id');
    hasher.setHash('receivings/new');
    PosnicPro.lowstockitems.loadLowStockValue(id);
});
