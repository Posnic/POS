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
        var total = count(entries), first = from == null ? 1 : from, limit = amount == null ? total : amount;
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
            'display:flex;flex-direction:column;justify-content:' + ((s.previewPaper || s.paper) === 'roll' ? 'flex-start' : 'center') + ';gap:1px;border:' + (s.guides ? '.15mm dashed #aaa' : 'none') + ';font-family:' + s.font + ';font-size:' + s.fontSize + 'px;text-align:' + s.align +
            ';font-weight:' + (s.fontOptions?.includes('bold') ? '700' : '400') + ';font-style:' + (s.fontOptions?.includes('italic') ? 'italic' : 'normal') +
            ';color:' + s.ink + ';background:' + s.background + ';print-color-adjust:exact;-webkit-print-color-adjust:exact}' +
            '.sl-label p{margin:0;line-height:1.15;overflow-wrap:anywhere}.sl-name{font-weight:700;font-size:135%}.sl-price{font-weight:700;font-size:260%}.sl-barcode{display:block;flex-shrink:1;min-height:0;max-width:100%;max-height:45%;' +
            'margin-left:' + (s.align === 'left' ? '0' : 'auto') + ';margin-right:' + (s.align === 'right' ? '0' : 'auto') + '}.sl-foot{font-size:75%}';
    }
    function validateDesign(s) {
        if (!/^[a-zA-Z ,\-]+$/.test(s.font) || !['left', 'center', 'right'].includes(s.align) || !/^#[a-f\d]{6}$/i.test(s.background) || !/^#[a-f\d]{6}$/i.test(s.ink)) throw Error('Invalid label design.');
        if (!Number.isFinite(s.fontSize) || s.fontSize < 3 || s.fontSize > 36) throw Error('Choose a font size between 3 and 36.');
    }
    function label(doc, item, s, barcode) {
        if (!Number.isFinite(item.label_price)) throw Error(item.name + ': ' + (item.label_price_error || 'A fixed price is required.'));
        if (s.barcode !== false && !item.barcode_id) throw Error(item.name + ': ' + t('lang_sl_barcode_missing', 'No barcode. Switch off Show barcode to print a price label.'));
        var div = doc.createElement('div'); div.className = 'sl-label';
        function text(value, cls) { var p = doc.createElement('p'); p.className = cls || ''; p.textContent = value; div.appendChild(p); }
        text(item.name, 'sl-name');
        if (s.barcode !== false) {
            var svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.classList.add('sl-barcode'); div.appendChild(svg);
            barcode(svg, String(item.barcode_id), { format: s.format, width: s.barWidth, height: s.barHeight, margin: s.barMargin,
            marginTop: s.top, marginBottom: s.bottom, marginLeft: s.left, marginRight: s.right,
            displayValue: s.barText, textMargin: s.textMargin, font: s.font, fontSize: s.fontSize,
            textAlign: s.align, fontOptions: s.fontOptions || '', lineColor: s.ink, background: s.background });
        }
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
    var state = { entries: [], byId: new Map(), viewIds: [], filters: {}, step: 0, furthestStep: 0, page: 0, productPage: 1, totalPages: 1, total: 0, loading: false, printing: false, bulkLoading: false, token: 0, loadError: null, completeKey: null };
    var searchTimer;
    function $() { return root.jQuery.apply(null, arguments); }
    function t(key, fallback) { return root.PosnicPro?.i18n?.t(key, fallback) || fallback; }
    function filters() {
        var result = Object.assign({}, state.filters), search = String($('#sl-search').val() || '').trim();
        if ($('#sl-category').val()) result.category_id = $('#sl-category').val();
        if (search) {
            var escaped = search.split('').map(function (c) { return ['.', '*', '+', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']', String.fromCharCode(92)].includes(c) ? String.fromCharCode(92) + c : c; }).join('');
            var terms = { $or: [{ name: { $regex: escaped, $options: 'i' } }, { barcode_id: { $regex: escaped, $options: 'i' } }] };
            if (result.$or) { result.$and = (result.$and || []).concat([{ $or: result.$or }, terms]); delete result.$or; }
            else result.$or = terms.$or;
        }
        return result;
    }
    function settings() {
        var s = {
            paper: $('#sl-paper').val(), width: Number($('#sl-width').val()), height: Number($('#sl-height').val()),
            margin: Number($('#sl-margin').val()), gap: Number($('#sl-gap').val()), start: Number($('#sl-start').val()), guides: $('#sl-guides').is(':checked'),
            font: $('#font').val(), fontSize: Number($('#bar-fontSize').val()), align: $('#view_print_lable .text-align.btn-primary').val() || 'center',
            fontOptions: $('#view_print_lable .font-option.btn-primary').map(function () { return this.value; }).get().join(' '),
            background: $('#background-color').val(), ink: $('#line-color').val(), format: $('#barcodeLabelType').val(),
            barWidth: Number($('#bar-width').val()), barHeight: Number($('#bar-height').val()), barMargin: Number($('#bar-margin').val()), textMargin: Number($('#bar-text-margin').val()),
            top: Number($('#margin_top').val()), bottom: Number($('#margin_bottom').val()), left: Number($('#margin_left').val()), right: Number($('#margin_right').val()),
            barcode: $('#sl-show-barcode').is(':checked'), barText: $('#sl-bar-text').is(':checked'), mrp: $('#sl-mrp').is(':checked'), mfg: $('#mfg_checkbox').is(':checked'), exp: $('#exp_checkbox').is(':checked'),
            shop: $('#sl-shop').is(':checked') ? root.PosnicPro.local.get('branchname') || '' : '', address: $('#address-value').val(),
            date: $('#sl-date').is(':checked'), printedDate: new Date().toLocaleDateString(), currency: root.PosnicPro.local.get('currencySign') || ''
        };
        validateDesign(s); geometry(s); return s;
    }
    function chosen() { return state.entries.filter(function (e) { return e.selected; }); }
    function error(e) { $('#sl-status').text(e.message || String(e)); $('#sl-print,#sl-test').prop('disabled', true); }
    function selectedCount() {
        var entries = chosen(), copies;
        try { copies = count(entries); } catch (_) { copies = '—'; }
        $('#sl-selection-count').text(entries.length + ' ' + t('lang_sl_products_count', 'products') + ' · ' + copies + ' ' + t('lang_sl_labels_count', 'labels'));
        $('#sl-clear').prop('disabled', !entries.length && !state.bulkLoading);
        $('#sl-apply-copies').prop('disabled', !entries.length);
        $('#sl-next-step').prop('disabled', !entries.length || state.loading || !!state.loadError);
        $('[data-sl-step]').each(function () { var step = Number(this.getAttribute('data-sl-step')); this.disabled = step > 0 && (!entries.length || step > state.furthestStep + 1 || state.loading || !!state.loadError); });
        var current = state.entries.filter(function (e) { return state.viewIds.includes(String(e.item._id)); });
        var selected = current.filter(function (e) { return e.selected; }).length;
        $('#sl-page-all').prop('checked', current.length > 0 && selected === current.length).prop('indeterminate', selected > 0 && selected < current.length).prop('disabled', !current.length);
        var complete = state.completeKey === JSON.stringify(filters());
        $('#sl-all').prop('checked', state.bulkLoading || (complete && state.total > 0 && current.length > 0 && selected === current.length && matchingEntries().every(function (e) { return e.selected; })))
            .prop('indeterminate', !state.bulkLoading && selected > 0 && !(complete && matchingEntries().every(function (e) { return e.selected; }))).prop('disabled', state.loading && !state.bulkLoading);
    }
    function matchingEntries() {
        var search = String($('#sl-search').val() || '').trim().toLowerCase(), category = $('#sl-category').val();
        return state.entries.filter(function (e) { return (!category || String(e.item.category_id) === category) && (!search || (e.item.name + ' ' + (e.item.barcode_id || '')).toLowerCase().includes(search)); });
    }
    function mountPreview(host, cells, s, g) {
        var doc = root.document, page = sheet(doc, cells, s, root.JsBarcode), style = doc.createElement('style'), allCss = css(s, g);
        // Scope preview rules: printing's html/body and @page rules never affect the application.
        style.textContent = allCss.slice(allCss.indexOf('.sl-sheet')).replace(/(^|})(\.sl-[^{]+)/g, '$1' + host + ' $2');
        var $host = $(host).empty().append(style, page);
        var thermal = s.paper === 'roll' && $('#sl-print-method').val() === 'thermal';
        var previewWidth = thermal ? 80 : g.width;
        var available = $host.parent().width() || 400;
        var scale = Math.min(1.4, available / (previewWidth * 96 / 25.4));
        if (s.paper === 'a4' && host !== '#sl-sample') {
            if (host === '#sl-preview' && $('#sl-preview-zoom').val() === 'actual') scale = 1;
            else {
                var availableHeight = Math.min(720, (root.innerHeight || 900) - 280);
                if (host === '#sl-preview') {
                    var body = $('#view_print_lable .sl-body')[0], area = $host.parent()[0];
                    var bodyTop = body.getBoundingClientRect().top, areaTop = area.getBoundingClientRect().top;
                    var bodyLimit = parseFloat($(body).css('max-height')) || (root.innerHeight || 900) - 255;
                    availableHeight = Math.max(160, Math.min(bodyTop + bodyLimit, (root.innerHeight || 900) - 100) - areaTop - 44);
                }
                scale = Math.min(scale, availableHeight / (g.height * 96 / 25.4));
            }
        }
        $(page).css({ transform: 'scale(' + scale + ')', transformOrigin: 'top left', marginLeft: thermal ? 4 * 96 / 25.4 * scale + 'px' : 0 });
        $host.css({ width: previewWidth * 96 / 25.4 * scale + 'px', height: g.height * 96 / 25.4 * scale + 'px', background: '#fff' });
        $host.attr('aria-label', thermal ? '80 mm roll, 72 mm printable width. Printer feed and cutter margins vary.' : 'Label print preview');
        return page;
    }
    var presets = {
        a4: { paper: 'a4', width: 63, height: 33, margin: 5, gap: 2 },
        a4small: { paper: 'a4', width: 48, height: 25, margin: 5, gap: 2 },
        a4large: { paper: 'a4', width: 99, height: 38, margin: 5, gap: 2 },
        thermal80: { paper: 'roll', width: 72, height: 33 },
        thermal58: { paper: 'roll', width: 48, height: 33 },
        label40: { paper: 'roll', width: 40, height: 30 },
        label50: { paper: 'roll', width: 50, height: 30 },
        label60: { paper: 'roll', width: 60, height: 40 }
    };
    function capacityText(g) {
        return g.columns + ' ' + t('lang_sl_columns', 'columns') + ' × ' + g.rows + ' ' + t('lang_sl_rows', 'rows') + ' · ' + g.capacity + ' ' + t('lang_sl_per_sheet', 'labels per A4 sheet');
    }
    function choiceCards() {
        [['sl-paper', 'sl-paper-cards'], ['sl-preset', 'sl-size-cards']].forEach(function (pair) {
            var host = $('#' + pair[1]);
            if (!host.children().length) $('#' + pair[0] + ' option').each(function () {
                var value = this.value, card = $('<button type="button" class="sl-choice">').attr('data-value', value);
                if (pair[0] === 'sl-paper') card.append($('<i aria-hidden="true" class="feather">').addClass(value === 'roll' ? 'icon-printer' : 'icon-file-text'), ' ');
                card.append($('<span>').html($(this).html()));
                if (pair[0] === 'sl-preset' && presets[value]?.paper === 'a4') card.append($('<small>').text(capacityText(geometry(Object.assign({ start: 1 }, presets[value])))));
                card.on('click', function () { $('#' + pair[0]).val(value).trigger('change'); });
                host.append(card);
            });
            host.children().each(function () {
                var value = $(this).attr('data-value');
                $(this).attr('aria-pressed', String($('#' + pair[0]).val() === value));
                if (pair[0] === 'sl-preset') $(this).prop('hidden', value !== 'custom' && presets[value]?.paper !== $('#sl-paper').val());
            });
        });
    }
    function printPlan(entries, result, from, s, g) {
        var repeated = entries.some(function (e) { return e.copies > 1; });
        $('#sl-plan-mode').text(entries.length + ' ' + t('lang_sl_products_count', 'products') + ' · ' + (repeated ? t('lang_sl_repeated', 'Repeated labels') : t('lang_sl_one_each', 'One label per selected product')));
        var host = $('#sl-plan-products').empty();
        entries.forEach(function (e) {
            var input = $('<input type="number" class="sl-input" min="1" max="999">').val(e.copies).attr('aria-label', t('lang_print_copies', 'Copies') + ' ' + e.item.name);
            input.on('change', function () { e.copies = Number(this.value); $('#sl-from').val(1); state.page = 0; refresh(); });
            host.append($('<label class="sl-plan-row">').append($('<span>').text(e.item.name), input));
        });
        $('#sl-plan-batch').text(t('lang_sl_this_batch', 'This print batch') + ': ' + result.amount + ' / ' + result.total + ' ' + t('lang_sl_labels_count', 'labels') + ' · ' + from + '–' + (from + result.amount - 1) + ' · ' + result.pages + ' ' + (s.paper === 'a4' ? t('lang_sl_sheets', 'A4 sheets') : t('lang_sl_roll_labels', 'individual roll labels')));
        if (s.paper === 'a4') $('#sl-plan-batch').append($('<small style="display:block">').text(capacityText(g)));
    }
    function refresh() {
        var matched = Object.keys(presets).find(function (key) {
            return ['paper', 'width', 'height', 'margin', 'gap'].every(function (field) {
                return presets[key][field] === undefined || String(presets[key][field]) === String($('#sl-' + field).val());
            });
        });
        $('#sl-preset').val(matched || 'custom');
        choiceCards();
        selectedCount();
        if (!$('#view_print_lable').hasClass('show')) return;
        $('#sl-a4-settings').prop('hidden', $('#sl-paper').val() !== 'a4');
        $('#sl-bar-text,#barcodeLabelType').prop('disabled', !$('#sl-show-barcode').is(':checked'));
        $('#sl-status').empty();
        if (state.loadError) return error(state.loadError);
        var entries = chosen();
        var selectionKey = JSON.stringify(entries.map(function (e) { return [String(e.item._id), e.copies]; }));
        if (state.batchSelection !== selectionKey) {
            state.batchSelection = selectionKey; state.manualBatch = false;
            $('#sl-from').val(1);
        }
        if (!state.manualBatch) {
            try { $('#sl-batch').val(Math.min(2000, Math.max(1, count(entries) - Number($('#sl-from').val()) + 1))); } catch (_) { /* Validation below reports invalid copies. */ }
        }
        if (!entries.length) {
            $('#sl-sample,#sl-preview,#sl-print-sample').empty();
            $('#sl-summary').text(t('lang_select_products_to_print', 'Select products to print.'));
            error(Error(t('lang_select_products_to_print', 'Select products to print.'))); return;
        }
        try {
            var s = settings(), g = geometry(s), amount = Number($('#sl-batch').val()), from = Number($('#sl-from').val());
            $('#sl-capacity').text(s.paper === 'a4' ? capacityText(g) : t('lang_label_roll_one_label_per_page', 'Label roll · one label per page'));
            $('#sl-start').attr('max', g.capacity); $('#sl-dimensions').text(s.width + ' × ' + s.height + ' mm');
            try { root.localStorage.setItem('posnic.shelf-label-layout', JSON.stringify({ paper: s.paper, width: s.width, height: s.height, margin: s.margin, gap: s.gap, start: s.start, guides: s.guides, barcode: s.barcode, barText: s.barText, shop: !!s.shop, date: s.date, mrp: s.mrp, mfg: s.mfg, exp: s.exp,
                design: { font: s.font, fontSize: s.fontSize, align: s.align, ink: s.ink, background: s.background, format: s.format, barWidth: s.barWidth, barHeight: s.barHeight, barMargin: s.barMargin, textMargin: s.textMargin, top: s.top, bottom: s.bottom, left: s.left, right: s.right, fontOptions: s.fontOptions } })); } catch (_) { /* Optional storage. */ }
            if (state.step === 1) {
                var sampleGeometry = geometry(Object.assign({}, s, { paper: 'roll' }));
                try { mountPreview('#sl-sample', [entries[0].item], Object.assign({}, s, { paper: 'roll', previewPaper: s.paper }), sampleGeometry); }
                catch (e) { $('#sl-sample').empty().append($('<p class="sl-muted">').text(e.message || String(e))); }
            }
            if (state.step < 2) return;
            var batchError = null;
            try { slots(entries, g, 0, from, amount); } catch (e) { batchError = e; }
            // A test label remains available while the batch quantity is being edited.
            if (batchError) { slots(entries, g, 0, from, 1); amount = 1; }
            var pages = Math.ceil((g.start - 1 + Math.min(amount, count(entries) - from + 1)) / g.capacity);
            state.page = Math.max(0, Math.min(state.page, pages - 1));
            var result = slots(entries, g, state.page, from, amount);
            if (state.step === 2) mountPreview('#sl-preview', result.cells, s, g);
            if (state.step === 3) mountPreview('#sl-print-sample', result.cells, s, g);
            $('#sl-summary').text(entries.length + ' ' + t('lang_sl_products_count', 'products') + ' · ' + result.amount + ' / ' + result.total + ' ' + t('lang_sl_labels_count', 'labels') + ' · ' + result.pages + ' ' + t('lang_sl_pages_count', 'pages'));
            $('#sl-layout-summary').text(s.paper === 'a4' ? g.columns + ' × ' + g.rows + ' · A4' : s.width + ' × ' + s.height + ' mm');
            $('#sl-page').text((state.page + 1) + ' / ' + result.pages);
            $('#sl-prev').prop('disabled', state.page === 0); $('#sl-next').prop('disabled', state.page === result.pages - 1);
            $('#sl-job-paper').text(s.paper === 'a4' ? 'A4 · 210 × 297 mm' : s.width + ' × ' + s.height + ' mm');
            $('#sl-job-total').text(result.amount); $('#sl-job-pages').text(result.pages);
            printPlan(entries, result, from, s, g);
            var busy = !!(state.loading || state.printing);
            $('#sl-test').prop('disabled', busy);
            $('#sl-print').prop('disabled', busy || !!batchError);
            if (state.loading) $('#sl-status').text(t('lang_sl_wait_loading', 'Wait for products to finish loading.'));
            else if (state.printing) $('#sl-status').text(t('lang_sl_sending', 'Sending labels to the printer. Please wait.'));
            else if (batchError) $('#sl-status').text(batchError.message);
        } catch (e) { error(e); }
    }
    function setStep(step) {
        if (step < 0 || step > 3 || step > state.furthestStep + 1) return;
        if (step > 0 && (!chosen().length || state.loading || state.loadError)) return;
        if (step >= 2) {
            try {
                var s = settings(), g = geometry(s), entries = chosen();
                // Validate every selected item, including later pages; never hide a print failure behind a good first sheet.
                entries.forEach(function (e) {
                    if (!Number.isFinite(e.item.label_price)) throw Error(e.item.name + ': ' + (e.item.label_price_error || t('lang_sl_fixed_price', 'A fixed price is required.')));
                    if (s.barcode) {
                        if (!e.item.barcode_id) throw Error(e.item.name + ': ' + t('lang_sl_barcode_missing', 'No barcode. Switch off Show barcode to print a price label.'));
                        try { root.JsBarcode({}, String(e.item.barcode_id), { format: s.format }); }
                        catch (_) { throw Error(e.item.name + ': ' + t('lang_sl_barcode_format', 'The barcode does not match this format. Choose another format or switch off Show barcode.')); }
                    }
                });
                slots(entries, g, 0, Number($('#sl-from').val()), Number($('#sl-batch').val()));
            } catch (e) { error(e); return; }
        }
        state.step = step;
        state.furthestStep = Math.max(state.furthestStep, step);
        $('[data-sl-panel]').each(function () { this.hidden = Number(this.getAttribute('data-sl-panel')) !== step; });
        $('[data-sl-step]').removeAttr('aria-current').filter('[data-sl-step="' + step + '"]').attr('aria-current', 'step');
        $('#sl-back').prop('hidden', step === 0); $('#sl-print').prop('hidden', step !== 3); $('#sl-next-step').prop('hidden', step === 3)
            .text([t('lang_sl_choose_layout', 'Choose layout →'), t('lang_sl_preview_labels', 'Preview labels →'), t('lang_sl_print_settings', 'Print settings →')][step] || '');
        $('#view_print_lable .sl-body').scrollTop(0); refresh();
    }
    function renderRows() {
        var body = $('#sl-products').empty(), current = state.entries.filter(function (e) { return state.viewIds.includes(String(e.item._id)); });
        current.forEach(function (e, index) {
            var row = $('<div class="sl-product-row">'), checked = $('<input type="checkbox">').prop('checked', e.selected).attr('aria-label', t('lang_select', 'Select') + ' ' + e.item.name);
            checked.attr('id', 'sl-product-select-' + index);
            checked.on('change', function () { cancelBulk(); e.selected = this.checked; state.page = 0; state.furthestStep = 0; refresh(); });
            var name = $('<label>').attr('for', checked.attr('id')).css({ margin: 0, cursor: 'pointer' }).text(e.item.name).append($('<small>').text(e.item.barcode_id || t('lang_sl_no_barcode', 'No barcode')));
            row.css('cursor', 'pointer').on('click', function (event) {
                if ($(event.target).closest('input,label,button,a,select,textarea').length) return;
                checked.prop('checked', !checked.prop('checked')).trigger('change');
            });
            var money = Number.isFinite(e.item.label_price) ? (root.PosnicPro.local.get('currencySign') || '') + ' ' + e.item.label_price.toFixed(e.item.label_currency_digits ?? 2) : '—';
            var copies = $('<input type="number" min="1" max="999" class="sl-input">').val(e.copies).attr('aria-label', t('lang_print_copies', 'Copies') + ' ' + e.item.name);
            copies.on('change', function () { e.copies = Number(this.value); state.page = 0; state.furthestStep = 0; refresh(); });
            row.append(checked, name, $('<div class="sl-product-price">').text(money), copies); body.append(row);
        });
        if (!current.length) body.append($('<div class="sl-empty">').text(state.loading ? t('lang_sl_loading_products', 'Loading products…') : t('lang_sl_no_matches', 'No matching products.')));
        $('#sl-listed').text(state.productPage + ' / ' + state.totalPages + ' · ' + state.total + ' ' + t('lang_sl_products_count', 'products'));
        $('#sl-product-prev').prop('disabled', state.loading || state.productPage <= 1); $('#sl-product-next').prop('disabled', state.loading || state.productPage >= state.totalPages);
        $('#sl-product-note').text(t('lang_sl_none_automatic', 'Click a product row or checkbox to select or deselect it.'));
        refresh();
    }
    function request(params) {
        return new Promise(function (resolve, reject) {
            root.PosnicPro.get(params, function (r) { if (r && r.type === 'success') resolve(r.data); else reject(Error(r?.message || t('lang_sl_load_failed', 'Could not load product prices.'))); }, function () { reject(Error(t('lang_sl_load_failed', 'Could not load product prices.'))); });
        });
    }
    function remember(items, selected) {
        return items.map(function (item) {
            var existing = state.byId.get(String(item._id));
            if (existing) { existing.item = item; if (selected !== undefined) existing.selected = selected; return existing; }
            var entry = { item: item, selected: selected === true, copies: 1 }; state.entries.push(entry); state.byId.set(String(item._id), entry); return entry;
        });
    }
    function cancelBulk() {
        if (!state.bulkLoading) return;
        state.token++; state.bulkLoading = false; state.loading = false; state.completeKey = null;
        $('#sl-all').prop('disabled', false);
    }
    async function loadPage(page) {
        var token = ++state.token; state.loading = true; state.bulkLoading = false; state.loadError = null;
        state.productPage = page; renderRows();
        try {
            var data = await request({ url: 'items', data: { page: page, limit: 30, filters: JSON.stringify(filters()), label_pricing: 'true' } });
            if (state.token !== token) return;
            var current = remember(data.list || []);
            state.viewIds = current.map(function (e) { return String(e.item._id); });
            state.total = Number(data.total) || 0; state.totalPages = Math.max(1, Number(data.total_pages) || 1);
        } catch (e) { if (state.token === token) state.loadError = e; }
        finally { if (state.token === token) { state.loading = false; renderRows(); } }
    }
    async function loadAll() {
        if (state.loading) return;
        var token = ++state.token, query = filters(), key = JSON.stringify(query), loaded = [], expectedTotal;
        state.loading = true; state.bulkLoading = true; state.loadError = null; selectedCount();
        $('#sl-clear').prop('disabled', false);
        try {
            for (var page = 1, last = 1; page <= last; page++) {
                var data = await request({ url: 'items', data: { page: page, limit: 100, filters: key, label_pricing: 'true' } });
                if (state.token !== token) return;
                if (expectedTotal === undefined) expectedTotal = Number(data.total);
                if (Number(data.total) !== expectedTotal) throw Error(t('lang_sl_catalogue_changed', 'The catalogue changed while loading. Reload before printing.'));
                last = Number(data.total_pages) || 1; loaded = loaded.concat(data.list || []);
                $('#sl-product-note').text(t('lang_sl_loading_products', 'Loading products…') + ' ' + loaded.length + ' / ' + expectedTotal);
                if (loaded.length > 100000) throw Error(t('lang_sl_narrow_filter', 'Too many products. Narrow the Items filter before printing.'));
            }
            if (loaded.length !== expectedTotal || new Set(loaded.map(function (item) { return String(item._id); })).size !== loaded.length) throw Error(t('lang_sl_catalogue_changed', 'The catalogue changed while loading. Reload before printing.'));
            remember(loaded, true); state.completeKey = key; state.total = expectedTotal; state.furthestStep = 0;
        } catch (e) { if (state.token === token) state.loadError = e; }
        finally { if (state.token === token) { state.loading = false; state.bulkLoading = false; renderRows(); } }
    }
    function clear() {
        cancelBulk(); state.entries.forEach(function (e) { e.selected = false; }); state.page = 0; state.furthestStep = 0; state.loadError = null;
        setStep(0); renderRows();
    }
    function open(id) {
        state.token++; state.entries = []; state.byId = new Map(); state.viewIds = []; state.step = 0; state.furthestStep = 0; state.page = 0; state.loading = false; state.bulkLoading = false; state.loadError = null; state.completeKey = null;
        state.total = 0; state.totalPages = 1; state.productPage = 1;
        // The wizard owns its visible search/category filters. Tenant scope remains enforced by the Items API.
        state.filters = {};
        $('#sl-search').val(''); $('#sl-category').val(''); $('#sl-from').val(1); $('#sl-batch').val(1); state.manualBatch = false; state.batchSelection = null; $('#sl-copies').val(1);
        $('#sl-paper').val('roll'); $('#sl-width').val(72); $('#sl-height').val(33); $('#sl-start').val(1);
        try {
            var saved = JSON.parse(root.localStorage.getItem('posnic.shelf-label-layout') || 'null');
            if (saved) {
                if (['a4', 'roll'].includes(saved.paper)) $('#sl-paper').val(saved.paper);
                ['width', 'height', 'margin', 'gap', 'start'].forEach(function (key) { if (Number.isFinite(saved[key])) $('#sl-' + key).val(saved[key]); });
                ['guides', 'date', 'mrp', 'shop'].forEach(function (key) { if (typeof saved[key] === 'boolean') $('#sl-' + key).prop('checked', saved[key]); });
                ['mfg', 'exp'].forEach(function (key) { if (typeof saved[key] === 'boolean') $('#' + key + '_checkbox').prop('checked', saved[key]); });
                if (typeof saved.barcode === 'boolean') $('#sl-show-barcode').prop('checked', saved.barcode);
                if (typeof saved.barText === 'boolean') $('#sl-bar-text').prop('checked', saved.barText);
                if (saved.design) {
                    var d = saved.design;
                    Object.entries({ font: 'font', fontSize: 'bar-fontSize', ink: 'line-color', background: 'background-color', format: 'barcodeLabelType', barWidth: 'bar-width', barHeight: 'bar-height', barMargin: 'bar-margin', textMargin: 'bar-text-margin', top: 'margin_top', bottom: 'margin_bottom', left: 'margin_left', right: 'margin_right' }).forEach(function (pair) { if (d[pair[0]] !== undefined) $('#' + pair[1]).val(d[pair[0]]); });
                    if (['left', 'center', 'right'].includes(d.align)) $('.text-align').removeClass('btn-primary').filter('[value="' + d.align + '"]').addClass('btn-primary');
                    $('.font-option').each(function () { $(this).toggleClass('btn-primary', typeof d.fontOptions === 'string' && d.fontOptions.split(' ').includes(this.value)); });
                }
            }
        } catch (_) { /* Use current controls if storage is unavailable. */ }
        $('#document_width').val(Number($('#sl-width').val()) / 25.4); $('#document_height').val(Number($('#sl-height').val()) / 25.4);
        $('#view_print_lable').modal('show'); setStep(0); renderRows(); loadPrinters();
        var scopeToken = state.token;
        root.PosnicPro.get({ url: 'categories/getCategoryAjaxList', data: 'query=' }, function (response) {
            if (!$('#view_print_lable').hasClass('show') || !response) return;
            var category = $('#sl-category').val(); $('#sl-category option:not(:first)').remove();
            (response.suggestions || []).forEach(function (item) { $('#sl-category').append($('<option>').val(item.id).text(item.name || item.value)); });
            $('#sl-category').val(category || '');
        });
        if (!id) { loadPage(1); return; }
        state.loading = true; renderRows();
        request({ url: 'items/' + id, data: { label_pricing: 'true' } }).then(function (item) {
            if (state.token !== scopeToken) return;
            remember([item], true); state.viewIds = [String(item._id)]; state.total = 1; state.loading = false; renderRows();
        }).catch(function (e) { if (state.token === scopeToken) { state.loading = false; state.loadError = e; refresh(); } });
    }
    async function print(test) {
        if (state.printing) return false;
        try {
            if (state.step !== 3) throw Error(t('lang_sl_review_first', 'Review the labels before printing.'));
            if (state.loading) throw Error(t('lang_sl_wait_loading', 'Wait for products to finish loading.'));
            if (state.loadError) throw state.loadError;
            var s = settings(), g = geometry(s), entries = chosen(), from = Number($('#sl-from').val()), amount = test ? 1 : Number($('#sl-batch').val());
            var first = slots(entries, g, 0, from, amount), html = '';
            for (var i = 0; i < first.pages; i++) html += sheet(root.document, slots(entries, g, i, from, amount).cells, s, root.JsBarcode).outerHTML;
            var printer = root.electronAPI && root.electronAPI.printer;
            if (printer && printer.print) {
                var name = $('#sl-printer').val();
                if (!name) throw Error('Choose a shelf-label printer.');
                var thermal = $('#sl-print-method').val() === 'thermal';
                if (thermal && (s.paper !== 'roll' || s.width > 72)) throw Error('For the 80 mm receipt printer, choose Label roll and a label width of 72 mm or less.');
                state.printing = true;
                $('#sl-print,#sl-test').prop('disabled', true);
                $('#sl-status').text('Sending labels to printer…');
                var documents = thermal ? Array.from({ length: first.pages }, function (_, page) {
                    var labelHtml = sheet(root.document, slots(entries, g, page, from, amount).cells, s, root.JsBarcode).outerHTML;
                    return '<div class="rd-document" data-receipt-design="80" style="width:72mm;margin:0">' + labelHtml + '</div>';
                }) : [html];
                for (var job = 0; job < documents.length; job++) {
                    var result = await printer.print('<!doctype html><html><head><meta charset="utf-8"><style>' + css(s, g) + '</style></head><body>' + documents[job] + '</body></html>', {
                        printerName: name, pageSize: thermal ? '80mm' : { width: Math.round(g.width * 1000), height: Math.round(g.height * 1000) },
                        thermalRaster: thermal, exactPageSize: true, silent: true, copies: 1, landscape: false,
                        printBackground: true, margins: { marginType: 'none' }
                    });
                    if (!result || !result.success) throw Error((result && result.error || 'Labels could not be sent to the printer.') +
                        (thermal ? ' ' + job + ' earlier label(s) were sent; check the printer before retrying.' : ''));
                }
                try { root.localStorage.setItem('posnic.shelf-label-printer.' + s.paper, name); root.localStorage.setItem('posnic.shelf-label-method.' + s.paper, thermal ? 'thermal' : 'driver'); } catch (_) {}
                $('#sl-status').text('Sent ' + first.amount + ' label(s) to ' + name + '. Check the printed output.');
            } else {
                if (typeof root.printJS !== 'function') throw Error(t('lang_sl_browser_unavailable', 'The browser print component is unavailable. Reload this page and try again.'));
                root.printJS({ printable: html, type: 'raw-html', style: css(s, g), scanStyles: false, documentTitle: t('lang_shelf_label_products', 'Shelf / product labels') });
            }
        } catch (e) { error(e); }
        finally {
            state.printing = false;
            var message = $('#sl-status').text();
            refresh();
            if (message) $('#sl-status').text(message);
        }
        return false;
    }
    async function loadPrinters(requestedMethod) {
        var printer = root.electronAPI && root.electronAPI.printer;
        var desktop = !!(printer && printer.print && printer.list);
        $('#sl-desktop-printer').prop('hidden', !desktop);
        $('#sl-browser-print-help').prop('hidden', desktop);
        var explicitMethod = ['thermal', 'driver'].includes(requestedMethod);
        $('#sl-print-method').val(explicitMethod ? requestedMethod : 'driver'); $('#sl-thermal-help').prop('hidden', requestedMethod !== 'thermal');
        if (!desktop) return;
        var paper = $('#sl-paper').val(), saved = '';
        try { saved = root.localStorage.getItem('posnic.shelf-label-printer.' + paper) || ''; } catch (_) {}
        $('#sl-printer').empty().append($('<option>').val('').text(PosnicPro.i18n.t('lang_choose_a_printer', 'Choose a printer')));
        try {
            var printers = await printer.list();
            if ($('#sl-paper').val() !== paper) return;
            printers.forEach(function (p) { $('#sl-printer').append($('<option>').val(p.name).text(p.displayName || p.name)); });
            if (printers.some(function (p) { return p.name === saved; })) $('#sl-printer').val(saved);
            try { if (!explicitMethod && paper === 'roll' && root.localStorage.getItem('posnic.shelf-label-method.' + paper) === 'thermal') { $('#sl-print-method').val('thermal'); $('#sl-thermal-help').prop('hidden', false); } } catch (_) {}
            refresh();
        } catch (_) { $('#sl-status').text(PosnicPro.i18n.t('lang_could_not_load_printers_check_the_connecti', 'Could not load printers. Check the connection and refresh printers.')); }
    }
    function init() {
        if (!root.jQuery || !root.document) return;
        $(root.document).on('click', '[data-sl-step]', function () { setStep(Number(this.getAttribute('data-sl-step'))); });
        $(root.document).on('click', '#sl-next-step', function () { setStep(state.step + 1); });
        $(root.document).on('click', '#sl-back', function () { setStep(state.step - 1); });
        $(root.document).on('input change', '#view_print_lable input:not(#sl-search):not(#sl-all):not(#sl-page-all):not(#sl-category),#view_print_lable select:not(#sl-category):not(#sl-preset),#view_print_lable textarea', function () {
            if (this.id === 'sl-batch') state.manualBatch = true;
            if (this.id === 'sl-width' || this.id === 'sl-height') { $('#document_width').val(Number($('#sl-width').val()) / 25.4); $('#document_height').val(Number($('#sl-height').val()) / 25.4); }
            if (state.step === 1) state.furthestStep = 1;
            state.page = 0; refresh();
            if (state.step === 1 && typeof root.newBarcode === 'function') root.newBarcode();
        });
        $(root.document).on('click', '#view_print_lable .text-align,#view_print_lable .font-option', function () {
            if ($(this).hasClass('text-align')) $('#view_print_lable .text-align').removeClass('btn-primary').filter(this).addClass('btn-primary');
            else $(this).toggleClass('btn-primary');
            state.furthestStep = 1;
            if (typeof root.newBarcode === 'function') root.newBarcode();
            refresh();
        });
        $(root.document).on('shown.bs.modal', '#view_print_lable', refresh);
        $(root.document).on('hidden.bs.modal', '#view_print_lable', function () { state.token++; state.loading = false; state.bulkLoading = false; clearTimeout(searchTimer); });
        $(root.document).on('change', '#sl-all', function () { if (this.checked) loadAll(); else clear(); });
        $(root.document).on('change', '#sl-page-all', function () { cancelBulk(); var selected = this.checked; state.entries.forEach(function (e) { if (state.viewIds.includes(String(e.item._id))) e.selected = selected; }); state.furthestStep = 0; renderRows(); });
        $(root.document).on('click', '#sl-clear', clear);
        $(root.document).on('click', '#sl-apply-copies', function () { var n = Number($('#sl-copies').val()); if (!Number.isInteger(n) || n < 1 || n > 999) return error(Error(t('lang_sl_valid_copies', 'Copies must be between 1 and 999.'))); chosen().forEach(function (e) { e.copies = n; }); state.furthestStep = 0; renderRows(); });
        $(root.document).on('input', '#sl-search', function () { cancelBulk(); clearTimeout(searchTimer); searchTimer = setTimeout(function () { state.completeKey = null; loadPage(1); }, 250); });
        $(root.document).on('keydown', '#sl-search', function (e) { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(searchTimer); loadPage(1); } });
        $(root.document).on('change', '#sl-category', function () { cancelBulk(); state.completeKey = null; loadPage(1); });
        $(root.document).on('click', '#sl-product-prev,#sl-product-next', function () { loadPage(state.productPage + (this.id === 'sl-product-next' ? 1 : -1)); });
        $(root.document).on('click', '#sl-prev,#sl-next', function () { state.page += this.id === 'sl-next' ? 1 : -1; refresh(); });
        $(root.document).on('click', '#sl-test', function () { print(true); });
        $(root.document).on('click', '#sl-print', function () { print(false); });
        $(root.document).on('change', '#sl-paper', function () { $('#sl-preset').val(this.value === 'a4' ? 'a4' : 'thermal80').trigger('change'); loadPrinters(); });
        $(root.document).on('click', '#sl-one-each', function () { chosen().forEach(function (e) { e.copies = 1; }); $('#sl-from').val(1); state.page = 0; renderRows(); });
        $(root.document).on('click', '#sl-edit-products', function () { setStep(0); renderRows(); });
        $(root.document).on('change', '#sl-preset', function () {
            var preset = presets[this.value];
            if (!preset) { choiceCards(); $('#sl-width').trigger('focus'); return; }
            ['paper', 'width', 'height', 'margin', 'gap'].forEach(function (field) { if (preset[field] !== undefined) $('#sl-' + field).val(preset[field]); });
            $('#sl-start').val(1);
            $('#document_width').val(preset.width / 25.4); $('#document_height').val(preset.height / 25.4);
            state.page = 0; state.furthestStep = 1;
            refresh();
        });
        $(root.document).on('click', '#sl-refresh-printers', loadPrinters);
        $(root.document).on('change', '#sl-print-method', function () { $('#sl-thermal-help').prop('hidden', this.value !== 'thermal'); try { root.localStorage.setItem('posnic.shelf-label-method.' + $('#sl-paper').val(), this.value); } catch (_) {} refresh(); });
        $(root).on('resize', function () { if (state.step > 0) refresh(); });
    }
    init();
    return { geometry: geometry, count: count, slots: slots, css: css, label: label, sheet: sheet, open: open, print: print, refresh: refresh };
});
