/* One label renderer for single-item, bulk, roll and A4 printing. */
(function (root, factory) {
    'use strict';
    var api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.PosnicShelfLabels = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
    'use strict';
    function geometry(s) {
        ['width', 'height', 'margin', 'gap'].forEach(function (key) {
            if (!Number.isFinite(s[key]) || s[key] < 0) throw Error('Enter valid label dimensions.');
        });
        if (s.width < 15 || s.height < 15) throw Error('Labels must be at least 15 mm wide and high.');
        if (s.paper === 'roll') return { columns: 1, rows: 1, capacity: 1, start: 1, width: s.width, height: s.height };
        var columns = Math.floor((210 - 2 * s.margin + s.gap) / (s.width + s.gap));
        var rows = Math.floor((297 - 2 * s.margin + s.gap) / (s.height + s.gap));
        if (columns < 1 || rows < 1) throw Error('Labels do not fit on A4. Reduce size, margins or gaps.');
        var capacity = columns * rows;
        if (!Number.isInteger(s.start) || s.start < 1 || s.start > capacity) throw Error('Starting position must be between 1 and ' + capacity + '.');
        return { columns: columns, rows: rows, capacity: capacity, start: s.start, width: 210, height: 297 };
    }
    function count(entries) {
        return entries.reduce(function (n, entry) {
            if (!Number.isInteger(entry.copies) || entry.copies < 1 || entry.copies > 999) throw Error('Copies must be between 1 and 999.');
            return n + entry.copies;
        }, 0);
    }
    function slots(entries, layout, page, from, amount) {
        var total = count(entries), first = from || 1, limit = amount || total;
        if (!Number.isInteger(first) || first < 1 || first > total) throw Error('Choose a valid first label.');
        if (!Number.isInteger(limit) || limit < 1 || limit > 2000) throw Error('Print up to 2,000 labels per batch.');
        limit = Math.min(limit, total - first + 1);
        var pages = Math.ceil((layout.start - 1 + limit) / layout.capacity);
        if (!Number.isInteger(page) || page < 0 || page >= pages) throw Error('Choose a valid page.');
        var offsets = [], running = 0;
        entries.forEach(function (entry) { offsets.push(running); running += entry.copies; });
        var cells = [];
        for (var i = 0; i < layout.capacity; i++) {
            var position = page * layout.capacity + i - layout.start + 1;
            if (position < 0 || position >= limit) { cells.push(null); continue; }
            var index = first - 1 + position, owner = 0;
            while (owner + 1 < offsets.length && offsets[owner + 1] <= index) owner++;
            cells.push(entries[owner].item);
        }
        return { cells: cells, pages: pages, amount: limit, total: total };
    }
    function css(s, g) {
        return '@page{size:' + (s.paper === 'a4' ? 'A4' : s.width + 'mm ' + s.height + 'mm') + ';margin:0}' +
            'html,body{margin:0;padding:0}*{box-sizing:border-box}.sl-sheet{width:' + g.width + 'mm;height:' + g.height + 'mm;' +
            'padding:' + (s.paper === 'a4' ? s.margin : 0) + 'mm;display:grid;grid-template-columns:repeat(' + g.columns + ',' + s.width + 'mm);' +
            'grid-template-rows:repeat(' + g.rows + ',' + s.height + 'mm);gap:' + (s.paper === 'a4' ? s.gap : 0) + 'mm;break-after:page;overflow:hidden}' +
            '.sl-sheet:last-child{break-after:auto}.sl-label{width:' + s.width + 'mm;height:' + s.height + 'mm;padding:1mm;overflow:hidden;' +
            'border:' + (s.guides ? '.15mm dashed #aaa' : 'none') + ';font-family:' + s.font + ';font-size:' + s.fontSize + 'px;text-align:' + s.align +
            ';font-weight:' + (s.fontOptions?.includes('bold') ? '700' : '400') + ';font-style:' + (s.fontOptions?.includes('italic') ? 'italic' : 'normal') +
            ';color:' + s.ink + ';background:' + s.background + ';print-color-adjust:exact;-webkit-print-color-adjust:exact}' +
            '.sl-label p{margin:0;line-height:1.15;overflow-wrap:anywhere}.sl-price{font-weight:700}.sl-barcode{display:block;max-width:100%;max-height:55%;' +
            'margin-left:' + (s.align === 'left' ? '0' : 'auto') + ';margin-right:' + (s.align === 'right' ? '0' : 'auto') + '}.sl-foot{font-size:75%}';
    }
    function validateDesign(s) {
        if (!/^[a-zA-Z ,\-]+$/.test(s.font) || !['left', 'center', 'right'].includes(s.align) || !/^#[a-f\d]{6}$/i.test(s.background) || !/^#[a-f\d]{6}$/i.test(s.ink)) throw Error('Invalid label design.');
        if (!Number.isFinite(s.fontSize) || s.fontSize < 3 || s.fontSize > 36) throw Error('Choose a font size between 3 and 36.');
    }
    function label(doc, item, s, barcode) {
        if (!Number.isFinite(item.label_price) || !item.barcode_id) throw Error(item.name + ': ' + (item.label_price_error || 'A valid barcode and fixed price are required.'));
        var div = doc.createElement('div'); div.className = 'sl-label';
        function text(value, cls) { var p = doc.createElement('p'); p.className = cls || ''; p.textContent = value; div.appendChild(p); }
        text(item.name);
        var svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.classList.add('sl-barcode'); div.appendChild(svg);
        barcode(svg, String(item.barcode_id), { format: s.format, width: s.barWidth, height: s.barHeight, margin: s.barMargin,
            marginTop: s.top, marginBottom: s.bottom, marginLeft: s.left, marginRight: s.right,
            displayValue: s.barText, textMargin: s.textMargin, font: s.font, fontSize: s.fontSize,
            textAlign: s.align, fontOptions: s.fontOptions || '', lineColor: s.ink, background: s.background });
        text(s.currency + ' ' + item.label_price.toFixed(item.label_currency_digits ?? 2), 'sl-price');
        if (s.mrp && Number(item.mrp_price) > 0) text('MRP ' + s.currency + ' ' + Number(item.mrp_price).toFixed(item.label_currency_digits ?? 2), 'sl-foot');
        if (s.mfg && item.items_mfg_date) text('MFG ' + String(item.items_mfg_date).split(' ')[0], 'sl-foot');
        if (s.exp && item.items_expiry_date) text('EXP ' + String(item.items_expiry_date).split(' ')[0], 'sl-foot');
        if (s.shop) text(s.shop, 'sl-foot');
        if (s.address) text(s.address, 'sl-foot');
        if (s.date) text(s.printedDate, 'sl-foot');
        return div;
    }
    function sheet(doc, cells, s, barcode) {
        var page = doc.createElement('div'); page.className = 'sl-sheet';
        cells.forEach(function (item) { page.appendChild(item ? label(doc, item, s, barcode) : doc.createElement('div')); });
        return page;
    }
    var state = { entries: [], filters: {}, page: 0, loading: false, token: 0, loadError: null };
    function $() { return root.jQuery.apply(null, arguments); }
    function settings() {
        var s = {
            paper: $('#sl-paper').val(), width: Number($('#document_width').val()) * 25.4, height: Number($('#document_height').val()) * 25.4,
            margin: Number($('#sl-margin').val()), gap: Number($('#sl-gap').val()), start: Number($('#sl-start').val()), guides: $('#sl-guides').is(':checked'),
            font: $('#font').val(), fontSize: Number($('#bar-fontSize').val()), align: $('.text-align.btn-primary').val() || 'center',
            fontOptions: $('.font-option.btn-primary').map(function () { return this.value; }).get().join(' '),
            background: $('#background-color').val(), ink: $('#line-color').val(), format: $('#barcodeLabelType').val(),
            barWidth: Number($('#bar-width').val()), barHeight: Number($('#bar-height').val()), barMargin: Number($('#bar-margin').val()), textMargin: Number($('#bar-text-margin').val()),
            top: Number($('#margin_top').val()), bottom: Number($('#margin_bottom').val()), left: Number($('#margin_left').val()), right: Number($('#margin_right').val()),
            barText: $('#sl-bar-text').is(':checked'), mrp: $('#sl-mrp').is(':checked'), mfg: $('#mfg_checkbox').is(':checked'), exp: $('#exp_checkbox').is(':checked'),
            shop: $('#sl-shop').is(':checked') ? root.PosnicPro.local.get('branchname') || '' : '', address: $('#address-value').val(),
            date: $('#sl-date').is(':checked'), printedDate: new Date().toLocaleDateString(), currency: root.PosnicPro.local.get('currencySign') || ''
        };
        validateDesign(s); geometry(s); return s;
    }
    function chosen() { return state.entries.filter(function (e) { return e.selected; }); }
    function error(e) { $('#sl-status').text(e.message || String(e)).addClass('text-danger'); $('#sl-print').prop('disabled', true); }
    function refresh() {
        if (!$('#view_print_lable').hasClass('show')) return;
        if (state.loadError) return error(state.loadError);
        $('#sl-status').removeClass('text-danger').text('');
        try {
            var s = settings(), g = geometry(s), entries = chosen();
            if (!entries.length) { $('#sl-preview').empty(); $('#sl-summary').text(PosnicPro.i18n.t('lang_select_products_to_print', 'Select products to print.')); $('#sl-print').prop('disabled', true); return; }
            var amount = Number($('#sl-batch').val()), from = Number($('#sl-from').val());
            var pages = Math.ceil((g.start - 1 + Math.min(amount, count(entries) - from + 1)) / g.capacity);
            state.page = Math.max(0, Math.min(state.page, pages - 1));
            var result = slots(entries, g, state.page, from, amount), doc = root.document;
            var page = sheet(doc, result.cells, s, root.JsBarcode);
            $('#sl-preview').empty(); var style = doc.createElement('style'); style.textContent = css(s, g).slice(css(s, g).indexOf('.sl-sheet'));  $('#sl-preview').append(style, page);
            var scale = Math.min(1, $('#sl-preview').width() / (g.width * 96 / 25.4));
            $(page).css({ transform: 'scale(' + scale + ')', transformOrigin: 'top left' });
            $('#sl-preview').css('height', g.height * 96 / 25.4 * scale + 'px');
            $('#sl-summary').text(entries.length + ' products / ' + result.total + ' labels. Batch: ' + result.amount + ' labels / ' + result.pages + ' pages. ' + g.columns + ' columns × ' + g.rows + ' rows.');
            $('#sl-page').text('Page ' + (state.page + 1) + ' / ' + result.pages);
            $('#sl-prev').prop('disabled', state.page === 0); $('#sl-next').prop('disabled', state.page === result.pages - 1);
            $('#sl-print').prop('disabled', state.loading);
            $('#sl-start').attr('max', g.capacity);
            // Native style controls keep their existing local preset. New layout options use a separate key.
            try { root.localStorage.setItem('posnic.shelf-label-layout', JSON.stringify({ paper: s.paper, margin: s.margin, gap: s.gap, start: s.start, guides: s.guides })); } catch (_) { /* Storage is optional. */ }
        } catch (e) { error(e); }
    }
    function renderRows() {
        var body = $('#sl-products').empty(), search = String($('#sl-search').val() || '').toLowerCase();
        var visible = state.entries.filter(function (e) { return (e.item.name + ' ' + e.item.barcode_id).toLowerCase().includes(search); });
        visible.slice(0, 100).forEach(function (e) {
            var row = $('<tr>'), checked = $('<input type="checkbox">').prop('checked', e.selected).attr('aria-label', 'Select ' + e.item.name);
            checked.on('change', function () { e.selected = this.checked; refresh(); });
            row.append($('<td>').append(checked), $('<td>').text(e.item.name), $('<td>').text(e.item.barcode_id || 'No barcode'));
            var copies = $('<input type="number" min="1" max="999" class="form-control">').val(e.copies).attr('aria-label', 'Copies for ' + e.item.name);
            copies.on('change', function () { e.copies = Number(this.value); refresh(); });
            row.append($('<td>').append(copies)); body.append(row);
        });
        $('#sl-listed').text(visible.length > 100 ? 'Showing the first 100 of ' + visible.length + ' matching products. Use search to find a product.' : visible.length + ' products loaded.');
        refresh();
    }
    function request(params) {
        return new Promise(function (resolve, reject) {
            root.PosnicPro.get(params, function (r) { if (r && r.type === 'success') resolve(r.data); else reject(Error(r?.message || 'Could not load product prices.')); }, function () { reject(Error('Could not load product prices.')); });
        });
    }
    async function loadAll() {
        if (state.loading) return;
        var token = ++state.token; state.loading = true; state.loadError = null; $('#sl-all').prop('disabled', true); $('#sl-print').prop('disabled', true);
        var loaded = [], expectedTotal;
        try {
            for (var page = 1, last = 1; page <= last; page++) {
                var data = await request({ url: 'items', data: { page: page, limit: 100, filters: JSON.stringify(state.filters), label_pricing: 'true' } });
                if (state.token !== token) return;
                if (expectedTotal === undefined) expectedTotal = Number(data.total);
                if (Number(data.total) !== expectedTotal) throw Error('The catalogue changed while loading. Reload before printing.');
                last = Number(data.total_pages) || 1;
                (data.list || []).forEach(function (item) { loaded.push({ item: item, selected: true, copies: Number($('#sl-copies').val()) || 1 }); });
                $('#sl-status').text('Loading products: ' + loaded.length + ' / ' + data.total);
                if (loaded.length > 100000) throw Error('Too many products. Narrow the Items filter before printing.');
            }
            if (loaded.length !== expectedTotal || new Set(loaded.map(function (e) { return String(e.item._id); })).size !== loaded.length) throw Error('The catalogue changed while loading. Reload before printing.');
            state.entries = loaded; state.page = 0; renderRows();
        } catch (e) { if (state.token === token) { state.loadError = e; error(e); } }
        finally { if (state.token === token) { state.loading = false; $('#sl-all').prop('disabled', false); refresh(); } }
    }
    function open(id) {
        state.token++; state.entries = []; state.page = 0; state.loading = true; state.loadError = null;
        try {
            var saved = JSON.parse(root.localStorage.getItem('posnic.shelf-label-layout') || 'null');
            if (saved && ['roll', 'a4'].includes(saved.paper)) {
                $('#sl-paper').val(saved.paper);
                ['margin', 'gap', 'start'].forEach(function (key) { if (Number.isFinite(saved[key])) $('#sl-' + key).val(saved[key]); });
                $('#sl-guides').prop('checked', saved.guides === true);
            }
        } catch (_) { /* Use defaults if storage is unavailable. */ }
        state.filters = root.PosnicPro.listFilter.legacyFilters('items', { dateKey: 'updated_date' });
        $('#view_print_lable').modal('show'); $('#view_print_lable .modal-dialog').css('max-width', '1100px');
        $('#sl-all,#sl-print,#sl-test').prop('disabled', true); $('#sl-products,#sl-preview').empty(); $('#sl-search').val(''); $('#sl-from').val(1); $('#sl-batch').val(2000); $('#sl-status').text('Loading current prices…');
        $('#price-value,#mrp-price-value,#branch-value,#userInput,#mfg-date-value,#exp-date-value').prop('readonly', true);
        var token = state.token;
        var params = id ? { url: 'items/' + id, data: { label_pricing: 'true' } } : { url: 'items', data: { page: root.PosnicPro.items._page || 1, limit: root.PosnicPro.items.PAGE_SIZE || 25, filters: JSON.stringify(state.filters), label_pricing: 'true' } };
        request(params).then(function (data) {
            if (state.token !== token) return;
            state.loading = false; $('#sl-all,#sl-test').prop('disabled', false);
            var items = id ? [data] : data.list || [];
            state.entries = items.map(function (item) { return { item: item, selected: true, copies: 1 }; });
            var item = items[0];
            if (item) {
                $('#userInput').val(item.barcode_id); $('#branch-value').val(item.name);
                $('#price-value').val((root.PosnicPro.local.get('currencySign') || '') + ' ' + item.label_price); $('#mrp-price-value').val(item.mrp_price || '');
                $('#mfg-date-value').val(item.items_mfg_date || ''); $('#exp-date-value').val(item.items_expiry_date || '');
            }
            if (typeof root.newBarcode === 'function') root.newBarcode();
            renderRows();
        }).catch(function (e) { if (state.token === token) { state.loading = false; state.loadError = e; $('#sl-all').prop('disabled', false); error(e); } });
    }
    function print(test) {
        try {
            if (state.loading) throw Error('Wait for products to finish loading.');
            if (state.loadError) throw state.loadError;
            var s = settings(), g = geometry(s), entries = chosen(), from = Number($('#sl-from').val()), amount = test ? 1 : Number($('#sl-batch').val());
            var first = slots(entries, g, 0, from, amount), html = '';
            for (var i = 0; i < first.pages; i++) html += sheet(root.document, slots(entries, g, i, from, amount).cells, s, root.JsBarcode).outerHTML;
            root.printJS({ printable: html, type: 'raw-html', style: css(s, g), scanStyles: false, documentTitle: 'Shelf labels' });
            $('#sl-status').text('Choose the printer in the browser dialog. Use 100% scale, no browser margins, and no headers or footers.');
        } catch (e) { error(e); }
        return false;
    }
    function init() {
        if (!root.jQuery || !root.document) return;
        $(root.document).on('input change', '#view_print_lable input,#view_print_lable select,#view_print_lable textarea', function () { state.page = 0; refresh(); });
        $(root.document).on('click', '#view_print_lable .text-align,#view_print_lable .font-option', function () { setTimeout(refresh, 0); });
        $(root.document).on('shown.bs.modal', '#view_print_lable', refresh);
        $(root.document).on('hidden.bs.modal', '#view_print_lable', function () { state.token++; state.loading = false; });
        $(root.document).on('click', '#sl-all', loadAll);
        $(root.document).on('click', '#sl-clear', function () { state.entries.forEach(function (e) { e.selected = false; }); renderRows(); });
        $(root.document).on('click', '#sl-select-loaded', function () { state.entries.forEach(function (e) { e.selected = true; }); renderRows(); });
        $(root.document).on('click', '#sl-apply-copies', function () { var n = Number($('#sl-copies').val()); if (!Number.isInteger(n) || n < 1 || n > 999) return error(Error('Copies must be between 1 and 999.')); chosen().forEach(function (e) { e.copies = n; }); renderRows(); });
        $(root.document).on('input', '#sl-search', renderRows);
        $(root.document).on('click', '#sl-prev,#sl-next', function () { state.page += this.id === 'sl-next' ? 1 : -1; refresh(); });
        $(root.document).on('click', '#sl-test', function () { print(true); });
        $(root.document).on('click', '#sl-print', function () { print(false); });
        $(root.document).on('change', '#sl-paper', function () { $('#sl-start').val(1); refresh(); });
    }
    init();
    return { geometry: geometry, count: count, slots: slots, css: css, label: label, sheet: sheet, open: open, print: print, refresh: refresh };
});
