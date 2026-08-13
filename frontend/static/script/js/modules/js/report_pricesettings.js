/**
 * Price Settings page - three tabs over the pricing APIs:
 *   Set Margin     -> items/marginPreview + items/bulkSetMargin
 *   Custom Change  -> items/bulkPricePreview + items/bulkUpdatePrices
 *   History        -> items/bulkPriceHistory (audit of every bulk run)
 * The object name (pricesettings) matches the route hash #/pricesettings.
 */
PosnicPro.pricesettings = {
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
            var opts = '<option value="">Choose a category</option>';
            $.each((response && response.suggestions) || [], function (i, c) {
                opts += '<option value="' + c.id + '">' + $('<div>').text(c.name).html() + '</option>';
            });
            $('#ps_margin_category, #ps_custom_category').html(opts);
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
            PosnicPro.alert('warning', 'Enter a valid margin %.');
            return null;
        }
        var category_id = scope === 'category' ? $('#ps_margin_category').val() : null;
        if (scope === 'category' && !category_id) {
            PosnicPro.alert('warning', 'Choose a category.');
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
        var box = $('#ps_margin_result').html('<span class="text-muted">Checking&hellip;</span>').show();
        PosnicPro.post({ url: 'items/marginPreview', data: JSON.stringify(form) }, function (r) {
            if (r.type !== 'success') { box.hide(); PosnicPro.alert(r.type, r.message); return; }
            var d = r.data || {};
            var msg = '<b>' + (d.willChange || 0) + '</b> of ' + (d.total || 0) + ' item(s) would change.';
            if (d.noCost) msg += ' <span class="text-muted">' + d.noCost + ' have no cost price (left alone).</span>';
            if (d.exceedsMrpCount) msg += '<div class="text-danger" style="margin-top:4px;">' + d.exceedsMrpCount + ' would price above MRP &mdash; skipped when the box is ticked.</div>';
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
            PosnicPro.alert('warning', 'Enter a valid value.');
            return null;
        }
        var category_id = scope === 'category' ? $('#ps_custom_category').val() : null;
        if (scope === 'category' && !category_id) {
            PosnicPro.alert('warning', 'Choose a category.');
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
        var box = $('#ps_custom_result').html('<span class="text-muted">Checking&hellip;</span>').show();
        PosnicPro.post({ url: 'items/bulkPricePreview', data: JSON.stringify(form) }, function (r) {
            if (r.type !== 'success') { box.hide(); PosnicPro.alert(r.type, r.message); return; }
            var d = r.data || {};
            var issues = (d.exceedsMrpCount || 0) + (d.belowCostCount || 0);
            var msg = '<b>' + (d.willChange || 0) + '</b> of ' + (d.total || 0) + ' item(s) would change.';
            if (issues) msg += '<div class="text-danger" style="margin-top:4px;">' + (d.exceedsMrpCount || 0) + ' above MRP, ' + (d.belowCostCount || 0) + ' below cost &mdash; skipped when ticked.</div>';
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
        var body = $('#ps_history_body').html('<tr><td colspan="5" class="text-center text-muted" style="padding:16px;">Loading&hellip;</td></tr>');
        PosnicPro.get({ url: 'items/bulkPriceHistory', data: 'limit=' + size + '&skip=' + skip }, function (r) {
            var d = (r && r.data) || {};
            var runs = d.runs || [];
            var total = d.total || 0;
            if (!runs.length) {
                body.html('<tr><td colspan="5" class="text-center text-muted" style="padding:16px;">No bulk price changes yet.</td></tr>');
                $('#ps_history_pager').html('');
                return;
            }
            var esc = function (v) { return $('<div>').text(v == null ? '' : v).html(); };
            var fmtDate = function (dt) {
                try { return new Date(dt).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }); }
                catch (e) { return ''; }
            };
            var describe = function (run) {
                var f = esc(run.label || run.field || 'Price');
                var scope = run.scope === 'category' ? 'one category' : 'all items';
                if (run.op === 'margin' || run.op === 'markup' || run.direction === 'margin') {
                    return (run.op === 'markup' ? 'Markup' : 'Margin') + ' ' + run.value + '% &rarr; ' + f + ', ' + scope;
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
