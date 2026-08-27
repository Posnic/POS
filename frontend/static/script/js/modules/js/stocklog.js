PosnicPro.stocklogs = {
    /* Deep link #/stocklogs/<id>: land on the ledger with that movement
       open in the right pane - the item's own page is a link inside,
       never a redirect (owner rule). Recognises the echo of its own
       setHash and does nothing. */
    showDetails: function (id) {
        if (PosnicPro.listDoc.activeId('stocklogs') === String(id)
            && $('#stocklogs_detail_card').is(':visible')) { return; }
        PosnicPro.stocklogs._chrome();
        PosnicPro.stocklogs.loadList(1);
        PosnicPro.listDoc.open({ key: 'stocklogs', id: id, title: 'Movement' });
        PosnicPro.get('stocklogs/' + id, function (response) {
            var d = response && response.data;
            if (response.type !== 'success' || !d) {
                PosnicPro.listDoc.body('stocklogs', '<div class="text-danger p-3">Could not open this movement.</div>');
                return;
            }
            PosnicPro.listDoc.title('stocklogs', d.item_name || 'Movement');
            PosnicPro.listDoc.body('stocklogs', PosnicPro.stocklogs._docBody({
                process: d.process,
                qty: d.item_quantity,
                opening: d.opening_balance !== 'N/A' ? d.opening_balance : null,
                closing: d.closing_balance,
                reference: d.reference,
                by: d.changed_by,
                date: PosnicPro.convertDate(d.created_date),
                item_id: d.view_item_id
            }));
        }, function () {
            PosnicPro.listDoc.body('stocklogs', '<div class="text-danger p-3">Could not open this movement.</div>');
        });
    },
    /* Row click: the pane fills straight from the row the list holds. */
    openDoc: function (logId) {
        var r = (PosnicPro.stocklogs._lastRows || []).filter(function (x) { return String(x._id) === String(logId); })[0];
        if (!r) { return; }
        var n = Number(r.count) || 0;
        PosnicPro.listDoc.open({
            key: 'stocklogs',
            id: r._id,
            title: r.item_name,
            body: PosnicPro.stocklogs._docBody({
                process: r.process,
                note: r.note,
                change: n,
                opening: r.opening_balance,
                closing: r.closing_balance,
                reference: r.reference,
                by: r.changed_by,
                date: PosnicPro.convertDate(r.string_date),
                item_id: r.view_item_id
            })
        });
    },
    _docBody: function (o) {
        var esc = function (t) { return $('<span>').text(t == null ? '' : t).html(); };
        var change = '—';
        if (o.change != null) {
            change = '<span style="color:' + (o.change < 0 ? 'var(--theme-danger-color, #c0392b)' : 'var(--theme-success-color, #1a7f37)') + ';">'
                + (o.change > 0 ? '+' : '') + o.change + '</span>';
        } else if (o.qty != null) {
            change = esc(o.qty);
        }
        /* The reference IS a document - a bill number for sale movements, a
           purchase number for receivings - so it links to its record
           (owner: "have option go to sale record as well"). */
        var refLine = '';
        if (o.reference) {
            var refTarget = /sale/i.test(o.process || '') ? 'sale'
                : /receiving|purchase/i.test(o.process || '') ? 'purchase' : '';
            refLine = refTarget
                ? '<div><a href="javascript:void(0)" onclick="PosnicPro.stocklogs.openReference(\'' + refTarget + '\', \'' + esc(o.reference) + '\');">'
                    + esc(o.reference) + ' &rarr;</a>'
                    + '<span class="q-muted" style="margin-left:6px;">' + (refTarget === 'sale' ? 'the bill' : 'the purchase') + '</span></div>'
                : '<div class="q-muted">Ref: ' + esc(o.reference) + '</div>';
        }
        return PosnicPro.listDoc.stats([
            { v: change, l: 'Change' },
            { v: o.opening != null ? esc(o.opening) : null, l: 'Opening' },
            { v: o.opening != null ? esc(o.closing) : null, l: 'Closing' }
        ])
            + PosnicPro.listDoc.grid([
                { label: 'Movement', lines: [
                    '<div>' + esc(o.process) + '</div>',
                    o.note ? '<div class="q-muted">' + esc(o.note) + '</div>' : ''
                ] },
                { label: 'Reference', lines: [refLine] },
                { label: 'Recorded', lines: [
                    o.by ? '<div>' + esc(o.by) + '</div>' : '',
                    o.date ? '<div class="q-muted">' + esc(o.date) + '</div>' : ''
                ] }
            ])
            + (o.item_id
                ? PosnicPro.listDoc.link('Open item in Item List', "hasher.setHash('items/" + esc(o.item_id) + "');")
                : '');
    },
    /* Resolve a reference number to its document and land on it - the
       ledger stores the NUMBER, the pages navigate by id. */
    openReference: function (kind, ref) {
        var exact = String(ref).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (kind === 'sale') {
            PosnicPro.get({
                url: 'sales',
                data: { page: 1, limit: 1, filters: JSON.stringify({ sales_id: { $regex: '^' + exact + '$', $options: 'i' } }) }
            }, function (r) {
                var row = r && r.data && r.data.list && r.data.list[0];
                var id = row && (row._id && row._id.$oid ? row._id.$oid : row._id);
                if (id) { hasher.setHash('sales/' + id); }
                else { PosnicPro.alert('warning', 'That bill is not in Sales History any more'); }
            }, function () { PosnicPro.alert('warning', 'Could not look up the bill'); });
            return;
        }
        PosnicPro.get({
            url: 'receivings',
            data: { page: 1, limit: 1, filters: JSON.stringify({ receiving_id: { $regex: '^' + exact + '$', $options: 'i' } }) }
        }, function (r) {
            var row = r && r.data && r.data.list && r.data.list[0];
            var id = row && (row._id && row._id.$oid ? row._id.$oid : row._id);
            if (id) { hasher.setHash('purchaseorders/' + id); }
            else { PosnicPro.alert('warning', 'That purchase is not on record any more'); }
        }, function () { PosnicPro.alert('warning', 'Could not look up the purchase'); });
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
                html += '<tr class="md-row stocklogs-row highlight-select'
                    + (PosnicPro.listDoc.activeId('stocklogs') === String(r._id) ? ' is-active' : '') + '" data-id="' + esc(r._id) + '" style="cursor:pointer;">'
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
    _csvSpec: function () {
        return {
            head: ['Item', 'Movement', 'Note', 'Reference', 'By', 'Date', 'Opening', 'Change', 'Closing'],
            map: function (r) {
                return [r.item_name, r.process, r.note || '', r.reference || '', r.changed_by || '',
                    PosnicPro.convertDate(r.string_date), r.opening_balance, r.count, r.closing_balance];
            }
        };
    },
    exportCsv: function () {
        var spec = PosnicPro.stocklogs._csvSpec();
        PosnicPro.listExport.save(
            [spec.head].concat((PosnicPro.stocklogs._lastRows || []).map(spec.map)), 'inventory-logs.csv');
    },
    /* Everything matching the CURRENT filter, paged through the same
       endpoint the list reads - never a shapeless full dump. */
    exportAllCsv: function () {
        var spec = PosnicPro.stocklogs._csvSpec();
        PosnicPro.listExport.all({
            url: 'stocklogs',
            params: function (page, limit) {
                return { page: page, limit: limit, filters: JSON.stringify(PosnicPro.listFilter.legacyFilters('stocklogs', { dateKey: 'date' })) };
            },
            head: spec.head,
            map: spec.map,
            filename: 'inventory-logs.csv'
        });
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

/* Filter button + Movement dropdown + the row's peek (details first, in
   place - owner: "dont redirect to item page or sales page. show details
   first may give link inside"). */
$(document).on('click', '#stocklogs_filter_btn', function () {
    PosnicPro.stocklogs.mountFilters(true);
    PosnicPro.listFilter.toggle('stocklogs');
});
$(document).on('click', '.il-move-opt', function () {
    PosnicPro.stocklogs.setMove($(this).data('move'));
});
$(document).on('click', '#stocklogs_list_rows tr.stocklogs-row', function () {
    PosnicPro.stocklogs.openDoc($(this).data('id'));
});
