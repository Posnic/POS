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
        PosnicPro.lowstockitems.renderRestock();
        PosnicPro.ACLForModule('item');
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
        var actions = '<button type="button" class="btn btn-sm btn-primary-rgba ls-restock" data-id="' + esc(id) + '">'
            + '<i class="feather icon-plus mr-1"></i>Restock</button>';
        if (r) {
            PosnicPro.listDoc.open({ key: 'lowstockitems', id: id, title: r.name, actions: actions, body: self._docBody(r) });
            PosnicPro.ACLForModule('receiving');
            return;
        }
        /* deep link before the list landed - the item record fills in */
        PosnicPro.listDoc.open({ key: 'lowstockitems', id: id, title: PosnicPro.i18n.t('lang_newitem_title', 'Item'), actions: actions });
        PosnicPro.ACLForModule('receiving');
        PosnicPro.get('items/' + id, function (response) {
            var d = response && response.data;
            if (response.type !== 'success' || !d) {
                PosnicPro.listDoc.body('lowstockitems', '<div class="text-danger p-3"><lang class="lang_could_not_open_this_item">Could not open this item.</lang></div>');
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
            PosnicPro.listDoc.body('lowstockitems', '<div class="text-danger p-3"><lang class="lang_could_not_open_this_item">Could not open this item.</lang></div>');
        });
    },
    _docBody: function (r) {
        var esc = function (t) { return $('<span>').text(t == null ? '' : t).html(); };
        var img = (r.image && r.image !== 'item.svg') ? r.image : 'static/images/default/item.svg';
        return '<div style="display:flex; gap:20px; align-items:flex-start;">'
            + '<img src="' + esc(img) + '" style="width:84px; height:84px; object-fit:cover; border-radius:8px; flex:0 0 84px; border:1px solid var(--theme-border-color, #e3e7ee);" alt="">'
            + '<div style="flex:1 1 auto; min-width:0;">'
            + PosnicPro.listDoc.stats([
                { v: '<span style="color:var(--theme-danger-color, #c0392b);">' + esc(r.available_quantity) + '</span>', l: PosnicPro.i18n.t('lang_left_in_stock', 'Left in stock') },
                { v: esc(r.itemid || '—'), l: PosnicPro.i18n.t('lang_sku_title', 'SKU') }
            ])
            + '</div></div>'
            + PosnicPro.listDoc.grid([
                { label: PosnicPro.i18n.t('lang_identity', 'Identity'), lines: [
                    r.category_name ? '<div>' + esc(r.category_name) + '</div>' : '',
                    '<div class="q-muted">' + esc(r.name) + '</div>'
                ] },
                { label: PosnicPro.i18n.t('lang_supply', 'Supply'), lines: [
                    r.supplier_name ? '<div>' + esc(r.supplier_name) + '</div>' : '<div class="q-muted"><lang class="lang_no_supplier_on_record">No supplier on record</lang></div>'
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
            rows: '#lowstockitems_list_rows',
            onRefresh: function () { return PosnicPro.lowstockitems.loadList(); },
            container: '#lowstockitems_filter_panel',
            button: '#lowstockitems_filter_btn',
            searchPlaceholder: PosnicPro.i18n.t('lang_search_item_sku_supplier_or_category', 'Search item, SKU, supplier or category'),
            searchFields: [
                { value: 'all', label: PosnicPro.i18n.t('lang_all_fields', 'All fields') },
                { value: 'name', label: PosnicPro.i18n.t('lang_newitem_title', 'Item') },
                { value: 'itemid', label: PosnicPro.i18n.t('lang_sku_title', 'SKU') },
                { value: 'supplier_name', label: PosnicPro.i18n.t('lang_newsupplier_title', 'Supplier') },
                { value: 'category_name', label: PosnicPro.i18n.t('lang_newcategory_title', 'Category') }
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
        PosnicPro.listFilter.request('lowstockitems', {
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
                    + (filtered ? PosnicPro.i18n.t('lang_no_low_stock_items_match_this_filter', 'No low-stock items match this filter.') : PosnicPro.i18n.t('lang_nothing_is_running_low_every_item_is_above', 'Nothing is running low - every item is above its alert level.')) + '</div>');
                $('#lowstockitems_list_paging').html('');
                return;
            }
            var html = '<div class="table-responsive"><table class="table table-borderless">'
                + '<thead><tr><th style="width:44px;"></th><th><lang class="lang_newitem_title">Item</lang></th><th class="ls-col-sku"><lang class="lang_sku_title">SKU</lang></th>'
                + '<th class="ls-col-supplier"><lang class="lang_newsupplier_title">Supplier</lang></th><th class="ls-col-category"><lang class="lang_newcategory_title">Category</lang></th>'
                + '<th class="text-right"><lang class="lang_left">Left</lang></th><th style="width:110px;"></th></tr></thead><tbody>';
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
                    + '<td class="text-right"><button type="button" class="btn btn-sm btn-primary-rgba ls-restock" data-id="' + esc(r._id) + '">'
                    + '<i class="feather icon-plus mr-1"></i>Restock</button></td>'
                    + '</tr>';
            });
            html += '</tbody></table></div>';
            $('#lowstockitems_list_rows').html(html);
            PosnicPro.ACLForModule('receiving');
            self.renderPager(Number(data.total) || list.length);
        }, function () {
            $('#lowstockitems_list_rows').html('<div class="text-center text-muted p-t-20 p-b-20"><lang class="lang_could_not_load_the_low_stock_list_try_agai">Could not load the low stock list - try again.</lang></div>');
        });
    },
    renderPager: function (total) {
        var self = PosnicPro.lowstockitems;
        var p = self._page, size = self.PAGE_SIZE;
        var pages = Math.ceil(total / size) || 1;
        var label = total + ' ' + (total === 1 ? PosnicPro.i18n.t('lang_item_running_low', 'item running low') : PosnicPro.i18n.t('lang_items_running_low', 'items running low'));
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
    _restock: {},
    _restockBranch: null,
    _restockBusy: false,
    restockContext: function () {
        var branch = String(PosnicPro.local.get('branch_id_set') || '');
        if (this._restockBranch !== branch) {
            this._restock = {}; this._restockBranch = branch;
            try { this._restock = JSON.parse(sessionStorage.getItem('restock:' + branch) || '{}'); } catch (e) { this._restock = {}; }
        }
    },
    saveRestock: function () {
        try { sessionStorage.setItem('restock:' + this._restockBranch, JSON.stringify(this._restock)); } catch (e) { /* The current page still keeps the basket. */ }
    },
    restockMessage: function (message) { $('#restock_status').text(message).attr('class', 'alert alert-info'); },
    renderRestock: function () {
        var self = this;
        self.restockContext();
        self.saveRestock();
        var ids = Object.keys(self._restock);
        var esc = function (v) { return $('<span>').text(v == null ? '' : v).html(); };
        $('#restock_dock').toggle(ids.length > 0);
        $('#restock_summary').text(ids.length + ' ' + PosnicPro.i18n.t('lang_restock_selected_count', 'item(s) selected. Continue adding items from the list.'));
        $('#restock_rows').html(ids.map(function (id) {
            var row = self._restock[id];
            return '<tr><td>' + esc(row.name) + '<small class="d-block text-muted">' + esc(row.supplier_name || PosnicPro.i18n.t('lang_restock_choose_supplier', 'Choose supplier in purchase')) + '</small></td><td>' + esc(row.available_quantity) + '</td>'
                + '<td><input class="form-control restock-qty" aria-label="Quantity to add for ' + esc(row.name) + '" type="number" min="0.001" step="any" value="' + esc(row.qty) + '" data-id="' + esc(id) + '" style="min-width:110px; min-height:48px;"></td>'
                + '<td><button type="button" class="btn btn-outline-danger p-3 restock-remove" data-id="' + esc(id) + '" aria-label="Remove ' + esc(row.name) + '">Remove</button></td></tr>';
        }).join('') || '<tr><td colspan="4"><lang class="lang_no_items_selected_close_this_window_and_ch">No items selected. Close this window and choose items to restock.</lang></td></tr>');
        $('#restock_finish_button').prop('disabled', !ids.length).show();
        $('#restock_finish').hide();
    },
    reviewRestock: function () {
        this.renderRestock();
        $('#restock_status').empty().removeClass();
        $('#restock_modal').modal('show');
        PosnicPro.ACLForModule('item');
        PosnicPro.ACLForModule('receiving');
    },
    loadLowStockValue: function (id) {
        var self = this;
        self.restockContext();
        if (self._restockBusy) return;
        if (self._restock[id]) { self.reviewRestock(); return; }
        if (Object.keys(self._restock).length >= 200) { PosnicPro.alert('warning', PosnicPro.i18n.t('lang_finish_this_basket_before_adding_more_than', 'Finish this basket before adding more than 200 items.')); return; }
        self._restockBusy = true;
        var branch = self._restockBranch;
        $('.ls-restock').prop('disabled', true);
        PosnicPro.get('items/' + encodeURIComponent(id), function (response) {
            self._restockBusy = false;
            $('.ls-restock').prop('disabled', false);
            self.restockContext();
            if (branch !== self._restockBranch) return;
            if (!response || response.type !== 'success' || !response.data) { PosnicPro.alert('error', PosnicPro.i18n.t('lang_could_not_load_this_item_try_again', 'Could not load this item. Try again.')); return; }
            self._restock[id] = Object.assign({}, response.data, { qty: 1, restock_id: String(id) });
            self.reviewRestock();
        }, function () {
            self._restockBusy = false;
            $('.ls-restock').prop('disabled', false);
            PosnicPro.alert('error', PosnicPro.i18n.t('lang_could_not_load_this_item_try_again', 'Could not load this item. Try again.'));
        });
    },
    validRestock: function () {
        var self = this;
        self.restockContext();
        var ids = Object.keys(self._restock);
        if (!ids.length || ids.some(function (id) { var qty = Number(self._restock[id].qty); return !Number.isFinite(qty) || qty <= 0 || qty > 100000; })) {
            self.restockMessage(PosnicPro.i18n.t('lang_restock_quantity_invalid', 'Enter a quantity greater than zero and no more than 100,000 for every item.')); return false;
        }
        return true;
    },
    finishRestock: function () {
        if (!this.validRestock()) return;
        var self = this, groups = {};
        Object.keys(self._restock).forEach(function (id) { var r = self._restock[id]; groups[r.supplier_id || ''] = r.supplier_name || PosnicPro.i18n.t('lang_restock_choose_supplier', 'Choose supplier in purchase'); });
        var select = $('#restock_supplier').empty();
        Object.keys(groups).forEach(function (id) { $('<option>').val(id).text(groups[id]).appendTo(select); });
        $('#restock_status').empty().removeClass();
        $('#restock_finish').show();
        $('#restock_finish_button').hide();
    },
    restockDirect: function () {
        var self = this;
        if (!self.validRestock()) return;
        var selected = Object.keys(self._restock);
        $('#restock_modal').one('hidden.bs.modal', function () {
            PosnicPro.items.openStockAdjustment();
            $('#stock_adjust_reason').val('__custom__');
            $('#stock_adjust_custom').val('Restock');
            $('#stock_adjust_mode').val('add');
            selected.forEach(function (id) {
                var r = self._restock[id];
                PosnicPro.items._adjRows[id] = { name: r.name, stock: Number(r.available_quantity) || 0, qty: Number(r.qty) };
            });
            PosnicPro.items._adjustmentComplete = function (data) {
                (data.updatedItemIds || []).forEach(function (id) { delete self._restock[id]; });
                self.renderRestock();
                self.loadList();
            };
            PosnicPro.items.adjReasonChanged();
        }).modal('hide');
    },
    restockPurchase: function () {
        var self = this;
        if (!self.validRestock()) return;
        if (Object.keys(PosnicPro.receiving_lineitems || {}).length) {
            self.restockMessage(PosnicPro.i18n.t('lang_restock_purchase_in_progress', 'An unfinished purchase already has items. Save or clear it in Purchases before transferring this basket. Your restock selection is kept.')); return;
        }
        var supplierId = String($('#restock_supplier').val() || '');
        var ids = Object.keys(self._restock).filter(function (id) { return String(self._restock[id].supplier_id || '') === supplierId; });
        if (!ids.length) return;
        if (self._restockBusy) return;
        var branch = self._restockBranch;
        var transfer = function (supplier) {
            self._restockBusy = false;
            $('#restock_modal button,#restock_modal input,#restock_modal select').prop('disabled', false);
            self.restockContext();
            if (branch !== self._restockBranch) return;
            $('#restock_modal').one('hidden.bs.modal', function () {
                PosnicPro.receivings._restockDraft = { supplierId: supplierId, supplier: supplier, ids: ids, branch: branch };
                hasher.setHash('receivings/new');
            }).modal('hide');
        };
        if (!supplierId) { transfer({}); return; }
        self._restockBusy = true;
        $('#restock_modal button,#restock_modal input,#restock_modal select').prop('disabled', true);
        var failed = function () {
            self._restockBusy = false;
            $('#restock_modal button,#restock_modal input,#restock_modal select').prop('disabled', false);
            self.restockMessage(PosnicPro.i18n.t('lang_could_not_load_this_purchase', 'Could not load this purchase.'));
        };
        PosnicPro.get('suppliers/' + encodeURIComponent(supplierId), function (response) {
            if (!response || response.type !== 'success' || !response.data) { failed(); return; }
            transfer(response.data);
        }, failed);
    },
    applyPurchaseDraft: function () {
        var self = this, draft = PosnicPro.receivings._restockDraft;
        if (!draft) return;
        PosnicPro.receivings._restockDraft = null;
        self.restockContext();
        if (draft.branch !== self._restockBranch) return;
        var ids = draft.ids;
        PosnicPro.receivings.clearReceivingForm();
        $('#receiving_add_supplier_id').val(draft.supplierId);
        $('#receiving_add_supplier_name').val(self._restock[ids[0]].supplier_name || '');
        ['address', 'phone', 'email', 'state', 'gst_type', 'gst_number'].forEach(function (field) {
            $('#receiving_add_supplier_' + field).val((draft.supplier || {})[field] || '');
        });
        ids.forEach(function (id) {
            var r = self._restock[id];
            PosnicPro.receivings.addReceivingLineItems({ item_id: id, item_name: $('<span>').text(r.name).html(), company_price: Number(r.company_price) || 0,
                barcode_id: r.barcode_id || '', item_quantity: Number(r.qty), item_unit: r.unit || 'qty', tax: Number(r.tax) || 0, tax_type: r.tax_type,
                discount_amount: 0, discount_percentage: 0, supplier: r.supplier_name || '' });
            delete self._restock[id];
        });
        self.renderRestock();
        PosnicPro.alert('success', PosnicPro.i18n.t('lang_restock_transferred', 'Items transferred to purchase. Review costs and save the purchase. Other supplier groups remain in your restock basket.'));
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
    PosnicPro.lowstockitems.loadLowStockValue(id);
});

$(document).on('input', '.restock-qty', function () {
    var row = PosnicPro.lowstockitems._restock[$(this).data('id')];
    if (row) row.qty = $(this).val();
    PosnicPro.lowstockitems.saveRestock();
    $('#restock_finish').hide();
    $('#restock_finish_button').show();
});
$(document).on('click', '.restock-remove', function () {
    delete PosnicPro.lowstockitems._restock[$(this).data('id')];
    PosnicPro.lowstockitems.renderRestock();
});
$(document).on('focusin click', '.restock-qty', function () {
    var input = this;
    setTimeout(function () { if (document.activeElement === input) input.select(); }, 0);
});
