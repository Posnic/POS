/**
 * Price Settings page - three tabs over the pricing APIs:
 *   Set Margin     -> items/marginPreview + items/bulkSetMargin
 *   Custom Change  -> items/bulkPricePreview + items/bulkUpdatePrices
 *   History        -> items/bulkPriceHistory (audit of every bulk run)
 * The object name (pricesettings) matches the route hash #/pricesettings.
 */
PosnicPro.pricesettings = {
    _gridDraft: {},
    _gridRows: {},
    _gridPage: 1,
    _gridRequest: 0,
    gridSearch: function () {
        clearTimeout(this._gridTimer);
        this._gridTimer = setTimeout(function () { PosnicPro.pricesettings.gridLoad(1); }, 250);
    },
    gridLoad: function (page) {
        if (this._gridSaving) return;
        var self = this;
        if (!self._gridUnloadBound) {
            window.addEventListener('beforeunload', function (e) { if (Object.keys(self._gridDraft).length) { e.preventDefault(); e.returnValue = ''; } });
            self._gridUnloadBound = true;
        }
        var scope = String(PosnicPro.local.get('branch_id_set') || '') + ':' + String(PosnicPro.local.get('userid') || '');
        if (self._gridScope !== scope) { self._gridScope = scope; self._gridDraft = {}; }
        var request = ++self._gridRequest;
        $('#ps-grid-body').html('<tr><td colspan="7">Loading…</td></tr>');
        PosnicPro.get({ url: 'items/priceGrid', data: $.param({ page: page, search: $('#ps-grid-search').val(), category: $('#ps-grid-category').val() }) }, function (r) {
            if (request !== self._gridRequest) return;
            if (r.type !== 'success') { $('#ps-grid-body').empty(); PosnicPro.alert(r.type, r.message); return; }
            var d = r.data; self._gridPage = d.page; self._gridRows = {};
            var body = $('#ps-grid-body').empty();
            d.items.forEach(function (it) {
                self._gridRows[it._id] = it;
                var tr = $('<tr>').attr('data-price-id', it._id);
                [it.name, it.itemid || '—', it.unit || 'qty'].forEach(function (v) { $('<td>').text(v).appendTo(tr); });
                [it.company_price, it.mrp_price].forEach(function (v) { $('<td>').addClass('price-reference').hide().text(Number(v || 0).toFixed(2)).appendTo(tr); });
                $('<td>').text(Number(it.selling_price || 0).toFixed(2)).appendTo(tr);
                var input = $('<input type="number" min="0" step="0.01" class="form-control" style="min-height:44px;min-width:120px" inputmode="decimal">').attr('aria-label', 'New price for ' + it.name);
                if (self._gridDraft[it._id]) input.val(self._gridDraft[it._id].price);
                input.on('paste', function (e) {
                    var text = (e.originalEvent || e).clipboardData.getData('text');
                    if (!/[\r\n]/.test(text)) return;
                    e.preventDefault();
                    var values = text.trim().split(/\r?\n/);
                    var targets = tr.add(tr.nextAll()).find('input');
                    if (values.length > targets.length || values.some(function (v) { return v.trim() && !/^\d+(?:\.\d{1,2})?$/.test(v.trim()); })) {
                        PosnicPro.alert('warning', 'Paste one column of prices, with at most two decimals, within this page.'); return;
                    }
                    values.forEach(function (v, i) { $(targets[i]).val(v.trim()).trigger('input'); });
                });
                input.on('focus', function () { this.select(); });
                input.on('input', function () { self.gridEdit(it, this.value, tr); });
                input.on('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); tr.next().find('input').focus().select(); } });
                $('<td>').append(input).appendTo(tr); body.append(tr);
                if (self._gridDraft[it._id]) tr.addClass('table-info');
            });
            if (!d.items.length) body.html('<tr><td colspan="7">No matching items</td></tr>');
            $('#ps-grid-page').text('Page ' + d.page + ' of ' + Math.max(1, Math.ceil(d.total / 50)) + ' · ' + d.total + ' items');
            $('#ps-grid-prev').prop('disabled', d.page <= 1); $('#ps-grid-next').prop('disabled', d.page * 50 >= d.total);
            $('#ps-grid .price-reference').toggle($('#ps-grid-reference').is(':checked'));
            self.gridCount();
        }, function () { if (request === self._gridRequest) $('#ps-grid-body').html('<tr><td colspan="7">Could not load prices. Try searching again.</td></tr>'); });
    },
    gridEdit: function (it, value, tr) {
        $('#ps-grid-preview').hide();
        if (value === '' || Number(value) === Number(it.selling_price)) { delete this._gridDraft[it._id]; tr.removeClass('table-info table-warning'); }
        else {
            this._gridDraft[it._id] = { id: it._id, name: it.name, oldPrice: Number(it.selling_price), price: Number(value), cost: Number(it.company_price || 0), mrp: Number(it.mrp_price || 0) };
            tr.addClass('table-info').toggleClass('table-warning', Number(value) <= 0 || Number(value) < Number(it.company_price || 0));
        }
        this.gridCount();
    },
    gridCount: function () { var n = Object.keys(this._gridDraft).length; $('#ps-grid-count').text(n + ' prices changed'); $('#ps-grid-review').prop('disabled', !n); },
    gridDiscard: function () { if (!Object.keys(this._gridDraft).length || window.confirm('Discard all unsaved price changes?')) { this._gridDraft = {}; $('#ps-grid-preview').hide(); this.gridLoad(this._gridPage); } },
    gridReview: function () {
        var rows = Object.values(this._gridDraft), box = $('#ps-grid-preview').empty().show();
        if (rows.some(function (r) { return !Number.isFinite(r.price) || r.price < 0; })) { box.text('Correct invalid prices before saving.'); return; }
        $('<h5>').text('Review ' + rows.length + ' price changes').appendTo(box);
        rows.forEach(function (r) { $('<div>').text(r.name + ': ' + r.oldPrice.toFixed(2) + ' → ' + r.price.toFixed(2) + (r.price < r.cost ? ' · Below cost' : '') + (r.mrp > 0 && r.price > r.mrp ? ' · Above MRP' : '')).appendTo(box); });
        if (rows.some(function (r) { return r.price === 0; })) box.append('<label class="d-block mt-2"><input type="checkbox" id="ps-grid-zero"> I confirm the zero selling prices</label>');
        $('<button class="btn btn-primary mt-3">Confirm update</button>').on('click', function () { PosnicPro.pricesettings.gridSave(this); }).appendTo(box);
    },
    gridSave: function (button) {
        var self = this, rows = Object.values(self._gridDraft);
        var allowZero = $('#ps-grid-zero').is(':checked');
        if (rows.some(function (r) { return r.price === 0; }) && !allowZero) return;
        self._gridSaving = true;
        $('#ps-grid input, #ps-grid select, #ps-grid button').prop('disabled', true);
        PosnicPro.post({ url: 'items/priceGrid', data: JSON.stringify({ rows: rows, allowZero: allowZero }) }, function (r) {
            self._gridSaving = false;
            $('#ps-grid input, #ps-grid select, #ps-grid button').prop('disabled', false);
            if (r.type !== 'success') { PosnicPro.alert(r.type, r.message); return; }
            r.data.saved.forEach(function (id) { delete self._gridDraft[id]; });
            $('#ps-grid-preview').text(r.data.saved.length + ' saved. ' + r.data.conflicts.length + ' changed elsewhere or are unavailable. Clear and re-enter conflicting rows after reviewing current prices.');
            self.gridLoad(self._gridPage);
        }, function () { self._gridSaving = false; $('#ps-grid input, #ps-grid select, #ps-grid button').prop('disabled', false); });
    },
    _catsLoaded: false,
    _histPage: 1,
    _histSize: 15,

    showDataTablePage: function () {
        if (typeof PosnicPro.HideSideBarModal === 'function') PosnicPro.HideSideBarModal();
        $('.page_loader').hide();
        $('.page-title-box').show();
        $('#v-pills-inventory-tab, #pricesettings_page').addClass('active');
        $('#pricesettings_new').show();
        this.loadCategories();
        this.loadHistory(1);
    },

    loadCategories: function () {
        if (this._catsLoaded) return;
        PosnicPro.get({ url: 'categories/getCategoryAjaxList', data: 'query=' }, function (response) {
            var opts = '<option value="" data-t="lang_choose_a_category_2">Choose a category</option>';
            $.each((response && response.suggestions) || [], function (i, c) {
                opts += '<option value="' + c.id + '">' + $('<div>').text(c.name).html() + '</option>';
            });
            $('#ps_margin_category, #ps_custom_category').html(opts);
            $('#ps-grid-category').html(opts.replace('Choose a category', 'All categories'));
            PosnicPro.pricesettings._catsLoaded = true;
        });
    },

    scopeToggle: function (which) {
        var scope = $('#ps_' + which + '_scope').val();
        $('#ps_' + which + '_cat_wrap')[scope === 'category' ? 'show' : 'hide']();
    },

    // ---- Set Margin ---------------------------------------------------------
    _marginForm: function () {
        var scope = $('#ps_margin_scope').val();
        var margin = $('#ps_margin_value').val();
        if (margin === '' || isNaN(margin) || Number(margin) < 0) {
            PosnicPro.alert('warning', PosnicPro.i18n.t('lang_enter_a_valid_margin', 'Enter a valid margin %.'));
            return null;
        }
        var category_id = scope === 'category' ? $('#ps_margin_category').val() : null;
        if (scope === 'category' && !category_id) {
            PosnicPro.alert('warning', PosnicPro.i18n.t('lang_choose_a_category', 'Choose a category.'));
            return null;
        }
        return {
            scope: scope,
            category_id: category_id,
            margin: margin,
            mode: $('input[name="ps_margin_mode"]:checked').val() || 'margin',
        };
    },

    checkMargin: function () {
        var form = this._marginForm();
        if (!form) return;
        var box = $('#ps_margin_result').html('<span class="text-muted"><lang class="lang_checking_2">Checking&hellip;</lang></span>').show();
        PosnicPro.post({ url: 'items/marginPreview', data: JSON.stringify(form) }, function (r) {
            if (r.type !== 'success') { box.hide(); PosnicPro.alert(r.type, r.message); return; }
            var d = r.data || {};
            var msg = '<b>' + (d.willChange || 0) + '</b> of ' + (d.total || 0) + ' item(s) would change.';
            if (d.noCost) msg += ' <span class="text-muted">' + d.noCost + ' have no cost price (left alone).</span>';
            if (d.exceedsMrpCount) msg += '<div class="text-danger" style="margin-top:4px;">' + d.exceedsMrpCount + ' would price above MRP, skipped when the box is ticked.</div>';
            box.attr('class', d.exceedsMrpCount ? 'alert alert-warning' : 'alert alert-success')
                .css({ 'font-size': '12.5px', 'padding': '8px 12px' }).html(msg).show();
        }, function () { box.hide(); });
    },

    applyMargin: function () {
        var form = this._marginForm();
        if (!form) return;
        form.skipViolations = $('#ps_margin_skip').is(':checked');
        $('#ps_margin_apply').prop('disabled', true);
        PosnicPro.post({ url: 'items/bulkSetMargin', data: JSON.stringify(form) }, function (r) {
            $('#ps_margin_apply').prop('disabled', false);
            PosnicPro.alert(r.type, r.message);
            if (r.type === 'success') { $('#ps_margin_result').hide(); PosnicPro.pricesettings.loadHistory(1); }
        }, function () { $('#ps_margin_apply').prop('disabled', false); });
    },

    // ---- Custom Change ------------------------------------------------------
    _customForm: function () {
        var scope = $('#ps_custom_scope').val();
        var value = $('#ps_custom_value').val();
        if (value === '' || isNaN(value) || Number(value) < 0) {
            PosnicPro.alert('warning', PosnicPro.i18n.t('lang_enter_a_valid_value', 'Enter a valid value.'));
            return null;
        }
        var category_id = scope === 'category' ? $('#ps_custom_category').val() : null;
        if (scope === 'category' && !category_id) {
            PosnicPro.alert('warning', PosnicPro.i18n.t('lang_choose_a_category', 'Choose a category.'));
            return null;
        }
        return {
            scope: scope,
            category_id: category_id,
            field: $('#ps_custom_field').val(),
            op: $('#ps_custom_op').val(),
            value: value,
            direction: $('#ps_custom_direction').val(),
        };
    },

    checkCustom: function () {
        var form = this._customForm();
        if (!form) return;
        var box = $('#ps_custom_result').html('<span class="text-muted"><lang class="lang_checking_2">Checking&hellip;</lang></span>').show();
        PosnicPro.post({ url: 'items/bulkPricePreview', data: JSON.stringify(form) }, function (r) {
            if (r.type !== 'success') { box.hide(); PosnicPro.alert(r.type, r.message); return; }
            var d = r.data || {};
            var issues = (d.exceedsMrpCount || 0) + (d.belowCostCount || 0);
            var msg = '<b>' + (d.willChange || 0) + '</b> of ' + (d.total || 0) + ' item(s) would change.';
            if (issues) msg += '<div class="text-danger" style="margin-top:4px;">' + (d.exceedsMrpCount || 0) + ' above MRP, ' + (d.belowCostCount || 0) + ' below cost, skipped when ticked.</div>';
            box.attr('class', issues ? 'alert alert-warning' : 'alert alert-success')
                .css({ 'font-size': '12.5px', 'padding': '8px 12px' }).html(msg).show();
        }, function () { box.hide(); });
    },

    applyCustom: function () {
        var form = this._customForm();
        if (!form) return;
        form.skipViolations = $('#ps_custom_skip').is(':checked');
        $('#ps_custom_apply').prop('disabled', true);
        PosnicPro.post({ url: 'items/bulkUpdatePrices', data: JSON.stringify(form) }, function (r) {
            $('#ps_custom_apply').prop('disabled', false);
            PosnicPro.alert(r.type, r.message);
            if (r.type === 'success') { $('#ps_custom_result').hide(); PosnicPro.pricesettings.loadHistory(1); }
        }, function () { $('#ps_custom_apply').prop('disabled', false); });
    },

    // ---- History (audit) ----------------------------------------------------
    loadHistory: function (page) {
        this._histPage = page || 1;
        var size = this._histSize;
        var skip = (this._histPage - 1) * size;
        var currency = PosnicPro.local.get('currencySign') || '';
        var body = $('#ps_history_body').html('<tr><td colspan="5" class="text-center text-muted" style="padding:16px;"><lang class="lang_loading">Loading&hellip;</lang></td></tr>');
        PosnicPro.get({ url: 'items/bulkPriceHistory', data: 'limit=' + size + '&skip=' + skip }, function (r) {
            var d = (r && r.data) || {};
            var runs = d.runs || [];
            var total = d.total || 0;
            if (!runs.length) {
                body.html('<tr><td colspan="5" class="text-center text-muted" style="padding:16px;"><lang class="lang_no_bulk_price_changes_yet">No bulk price changes yet.</lang></td></tr>');
                $('#ps_history_pager').html('');
                return;
            }
            var esc = function (v) { return $('<div>').text(v == null ? '' : v).html(); };
            var fmtDate = function (dt) {
                try { return new Date(dt).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }); }
                catch (e) { return ''; }
            };
            var describe = function (run) {
                if (run.op === 'individual') return 'Individual selling prices · selected items';
                var f = esc(run.label || run.field || 'Price');
                var scope = run.scope === 'category' ? 'one category' : 'all items';
                if (run.op === 'margin' || run.op === 'markup' || run.direction === 'margin') {
                    return (run.op === 'markup' ? PosnicPro.i18n.t('lang_markup', 'Markup') : PosnicPro.i18n.t('lang_margin', 'Margin')) + ' ' + run.value + '% &rarr; ' + f + ', ' + scope;
                }
                var arrow = run.direction === 'decrease' ? '<span class="text-danger">&darr;</span>' : '<span class="text-success">&uarr;</span>';
                var by = run.op === 'percent' ? run.value + '%' : currency + ' ' + run.value;
                return arrow + ' ' + f + ' ' + (run.direction === 'decrease' ? '&minus;' : '+') + by + ', ' + scope;
            };
            var html = '';
            runs.forEach(function (run) {
                html += '<tr>' +
                    '<td>' + fmtDate(run.date) + '</td>' +
                    '<td>' + esc(run.changed_by || '') + '</td>' +
                    '<td>' + describe(run) + '</td>' +
                    '<td class="text-right">' + (run.items_changed || 0) + '</td>' +
                    '<td class="text-right">' + (run.items_skipped || 0) + '</td>' +
                    '</tr>';
            });
            body.html(html);
            var pages = Math.ceil(total / size) || 1;
            var from = skip + 1;
            var to = Math.min(skip + runs.length, total);
            var cur = PosnicPro.pricesettings._histPage;
            var pager = '<span>Showing ' + from + '&ndash;' + to + ' of ' + total + '</span><span>' +
                '<button class="btn btn-sm btn-light" ' + (cur <= 1 ? 'disabled' : '') + ' onclick="PosnicPro.pricesettings.loadHistory(' + (cur - 1) + ')">Prev</button> ' +
                '<button class="btn btn-sm btn-light" ' + (cur >= pages ? 'disabled' : '') + ' onclick="PosnicPro.pricesettings.loadHistory(' + (cur + 1) + ')">Next</button>' +
                '</span>';
            $('#ps_history_pager').html(pager);
        });
    },
};
