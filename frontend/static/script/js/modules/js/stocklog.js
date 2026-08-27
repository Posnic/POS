PosnicPro.stocklogs = {
    /* A ledger line has no document of its own - the deep link lands on the
       ITEM the movement belongs to, where the whole trail is shown. */
    showDetails: function (id) {
        PosnicPro.get('stocklogs/' + id, function (response) {
            var itemId = response && response.data && response.data.view_item_id;
            if (response.type === 'success' && itemId) {
                hasher.setHash('items/' + itemId);
            } else {
                hasher.setHash('stocklogs');
            }
        }, function () {
            hasher.setHash('stocklogs');
        });
    },
    showModuleDetails: function (id) {
        hasher.setHash('items/' + id);
    },

    _page: 1,
    PAGE_SIZE: 25,
    _lastRows: [],
    _chrome: function () {
        PosnicPro.HideSideBarModal();
        $('.page_loader,#osk-container').hide();
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $('.vertical-menu li a').removeClass('active');
        $('#v-pills-inventory-tab,#stockReport_page').addClass('active');
        $('#v-pills-inventory').addClass('show active');
        $('.page-title-box,#stocklogs').show();
        $('.dashboard_img_menu').hide();
        $('#image_sidebar_inventory').show();
    },
    showDataTablePage: function () {
        PosnicPro.stocklogs._chrome();
        PosnicPro.stocklogs.loadList(1);
    },
    mountFilters: function (force) {
        if (!$('#stocklogs_filter_panel').length) { return; }
        if (!force && $('#stocklogs_filter_panel').data('mounted')) { return; }
        $('#stocklogs_filter_panel').data('mounted', true);
        PosnicPro.listFilter.mount({
            key: 'stocklogs',
            container: '#stocklogs_filter_panel',
            button: '#stocklogs_filter_btn',
            searchPlaceholder: 'Search item, activity or reference',
            dateField: 'Stock date',
            searchFields: [
                { value: 'all', label: 'All fields' },
                { value: 'item_name', label: 'Item' },
                { value: 'process', label: 'Activity' },
                { value: 'reference', label: 'Reference' }
            ],
            onChange: function () { PosnicPro.stocklogs.loadList(1); }
        });
    },
    /* The Movement dropdown narrows `process` server-side: every log's
       process names its door (Add Receiving, Edit Sale, Delete Item ...),
       so a family is one regex, not a list to keep in step. */
    MOVES: {
        purchases: { label: 'Purchases', re: 'Receiving|Purchase' },
        sales: { label: 'Sales', re: 'Sale' },
        items: { label: 'Item edits', re: 'Item' }
    },
    setMove: function (key) {
        var m = PosnicPro.stocklogs.MOVES[key];
        $('#stocklogs_move_dd').text(m ? m.label : 'All');
        PosnicPro.stocklogs.mountFilters();
        PosnicPro.listFilter.setExtra('stocklogs', 'process',
            m ? { $regex: m.re, $options: 'i' } : '');
    },
    loadList: function (page) {
        PosnicPro.stocklogs.mountFilters();
        var self = PosnicPro.stocklogs;
        if (page) { self._page = page; }
        var filters = PosnicPro.listFilter.legacyFilters('stocklogs', { dateKey: 'date' });
        var esc = function (t) { return $('<span>').text(t == null ? '' : t).html(); };
        PosnicPro.get({
            url: 'stocklogs',
            data: { page: self._page, limit: self.PAGE_SIZE, filters: JSON.stringify(filters) }
        }, function (response) {
            var data = (response && response.data) || {};
            var list = data.list || [];
            self._lastRows = list;
            if (!list.length) {
                var filtered = PosnicPro.listFilter.activeCount('stocklogs') > 0;
                $('#stocklogs_list_rows').html('<div class="text-center text-muted p-t-20 p-b-20">'
                    + (filtered ? 'No movements match this filter.' : 'No stock movements yet - receive or sell an item and its trail starts here.') + '</div>');
                $('#stocklogs_list_paging').html('');
                return;
            }
            var html = '<div class="table-responsive"><table class="table table-borderless">'
                + '<thead><tr><th>Item</th><th>Movement</th><th class="il-col-ref">Reference</th>'
                + '<th class="il-col-by">By</th><th class="il-col-date">Date</th>'
                + '<th class="text-right il-col-bal">Opening</th><th class="text-right">Change</th>'
                + '<th class="text-right il-col-bal">Closing</th></tr></thead><tbody>';
            list.forEach(function (r) {
                var n = Number(r.count) || 0;
                var note = r.note ? '<div class="q-muted" style="font-size:11.5px; white-space:normal;">' + esc(r.note) + '</div>' : '';
                html += '<tr class="md-row stocklogs-row highlight-select" data-item-id="' + esc(r.view_item_id || '') + '" style="cursor:pointer;">'
                    + '<td>' + esc(r.item_name) + '</td>'
                    + '<td>' + esc(r.process) + note + '</td>'
                    + '<td class="il-col-ref q-muted">' + esc(r.reference || '-') + '</td>'
                    + '<td class="il-col-by">' + esc(r.changed_by || '-') + '</td>'
                    + '<td class="il-col-date">' + esc(PosnicPro.convertDate(r.string_date)) + '</td>'
                    + '<td class="text-right il-col-bal q-muted">' + esc(r.opening_balance) + '</td>'
                    + '<td class="text-right" style="color:' + (n < 0 ? 'var(--theme-danger-color, #c0392b)' : 'var(--theme-success-color, #1a7f37)') + ';">'
                    + (n > 0 ? '+' : '') + n + '</td>'
                    + '<td class="text-right il-col-bal q-muted">' + esc(r.closing_balance) + '</td>'
                    + '</tr>';
            });
            html += '</tbody></table></div>';
            $('#stocklogs_list_rows').html(html);
            self.renderPager(Number(data.total) || list.length);
        }, function () {
            $('#stocklogs_list_rows').html('<div class="text-center text-muted p-t-20 p-b-20">Could not load the stock ledger - try again.</div>');
        });
    },
    renderPager: function (total) {
        var self = PosnicPro.stocklogs;
        var p = self._page, size = self.PAGE_SIZE;
        var pages = Math.ceil(total / size) || 1;
        var label = total + (total === 1 ? ' movement' : ' movements');
        if (pages > 1) { label = 'Page ' + p + ' of ' + pages + ' · ' + label; }
        var btn = function (to, text, off, cls) {
            return '<button type="button" class="btn btn-sm ' + (cls || 'btn-secondary-rgba') + ' q-pg-btn"' + (off ? ' disabled' : '')
                + ' onclick="PosnicPro.stocklogs.goPage(' + to + ');">' + text + '</button>';
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
        $('#stocklogs_list_paging').html(html);
    },
    goPage: function (n) {
        if (!n || n < 1) { return; }
        PosnicPro.stocklogs._page = n;
        PosnicPro.stocklogs.loadList();
    },
    exportCsv: function () {
        var rows = [['Item', 'Movement', 'Note', 'Reference', 'By', 'Date', 'Opening', 'Change', 'Closing']];
        (PosnicPro.stocklogs._lastRows || []).forEach(function (r) {
            rows.push([r.item_name, r.process, r.note || '', r.reference || '', r.changed_by || '',
                PosnicPro.convertDate(r.string_date), r.opening_balance, r.count, r.closing_balance]);
        });
        var csv = rows.map(function (r) {
            return r.map(function (c) { return '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"'; }).join(',');
        }).join('\n');
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'inventory-logs.csv';
        a.click();
        URL.revokeObjectURL(a.href);
    },
    /* The Recycle Bin's preview door (settings.js viewRecycleBinDetails):
       a deleted log's item may no longer exist, so its facts open in the
       modal rather than a cross-link. The list itself never calls this. */
    viewStockData: function (response) {
        $('#view_stock_log').modal('show');
        var data = response.data;
        if (data.opening_balance === 'N/A' || data.closing_balance === 'N/A') {
            $('.hiddenText').hide();
        } else {
            $('.hiddenText').show();
        }
        $.each(data, function (key, val) {
            if (val === '') {
                $('#view_stock_' + key).text('');
            } else {
                $('#view_stock_' + key).text(val);
            }
        });
        var updateCreateDate = PosnicPro.convertDate(data.created_date);
        $('#view_stock_date').text(updateCreateDate);
    },
    /*Display the low stock of item details like  only display below 10 available quantity of each item */
    viewLowStockDashboard: function () {
        var notificationValue = localStorage.getItem("notificationrange");
        var params = {
            url: 'items/quantityCount',
            data: {
                notificationrange: notificationValue
            }
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                var data = response.data;
                PosnicPro.bellFeed.setLowStock(data.count);
                var totalCount = parseInt(data.count);
                $('#list_lowstock_name').html('');
                $(data.list).each(function (key, val) {
                    var branch_value = '<li class="media dropdown-item">' +
                            '<span class="badge badge-secondary-inverse">' + (key + 1) + '</span>&nbsp;&nbsp;' +
                            '<div class="media-body">' +
                            '<h5 class="action-title" width="30%">' + PosnicPro.textOverflowEllipsis(val.name, 30, true) + '</h5>' +
                            '<p><span class="timing">' + val.date + '</span></p>' +
                            '</div>' +
                            '</li>';
                    $('#list_lowstock_name').append(branch_value);
                });
                // The bell is the ONE notification centre now (activity feed +
                // push opt-in live in the same dropdown), so zero low stock
                // only hides the low-stock SECTION - it must never strip the
                // dropdown behaviour off the bell like it used to.
                if (totalCount === 0) {
                    $('.lowstock-section').hide();
                } else {
                    $('.lowstock-section').show();
                }
                let loader = $(".loader-login");
                loader.find(".loadingSpinner:first").remove();
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    }
};

/* Filter button + Movement dropdown + row cross-link into the item dossier. */
$(document).on('click', '#stocklogs_filter_btn', function () {
    PosnicPro.stocklogs.mountFilters(true);
    PosnicPro.listFilter.toggle('stocklogs');
});
$(document).on('click', '.il-move-opt', function () {
    PosnicPro.stocklogs.setMove($(this).data('move'));
});
$(document).on('click', '#stocklogs_list_rows tr.stocklogs-row', function () {
    var itemId = $(this).data('item-id');
    if (itemId) { hasher.setHash('items/' + itemId); }
});
