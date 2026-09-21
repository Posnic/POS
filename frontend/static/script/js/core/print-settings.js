/* Printer destinations belong to this computer. Document layouts belong to
   the shop. Keep the existing receipt preferences shared with Hardware Manager. */
(function () {
    'use strict';
    var state, featureState = {}, queues = [], loading;
    var sheets = { a4: 'A4', a5: 'A5', letter: 'US Letter' };
    var papers = Object.assign({ '58mm': '58 mm thermal', '80mm': '80 mm thermal' }, sheets);

    var esc = function (value) { return PosnicPro.escapeHtml(String(value == null ? '' : value)); };
    var desktop = function () { return !!(window.electronAPI && window.electronAPI.preferences); };
    function parse(value, fallback) { try { return (typeof value === 'string' ? JSON.parse(value) : value) || fallback; } catch (_) { return fallback; } }
    function sheet(value) {
        value = value || {};
        return { printerName: String(value.printerName || ''), paperSize: sheets[value.paperSize] ? value.paperSize : 'a4', copies: Math.min(20, Math.max(1, parseInt(value.copies, 10) || 1)) };
    }
    function fromLocal() {
        var documents = parse(PosnicPro.local.get('document_print_profiles'), {});
        var sales = parse(PosnicPro.local.get('receipt_printers'), []);
        if (!Array.isArray(sales) || !sales.length) sales = [{ name: PosnicPro.local.get('receipt_printer') || 'default', pageSize: PosnicPro.local.get('print_width') || '80mm', copies: 1 }];
        sales = sales.map(function (v) { return { name: String(v.name || 'default'), pageSize: String(v.pageSize || '80mm'), copies: Math.min(20, Math.max(1, parseInt(v.copies, 10) || 1)) }; });
        return { sales: sales, invoice: sheet(documents.invoice), quotation: sheet(documents.quotation) };
    }
    function mirror(value) {
        state = value;
        PosnicPro.local.set('document_print_profiles', JSON.stringify({ invoice: state.invoice, quotation: state.quotation }));
        PosnicPro.local.set('receipt_printers', JSON.stringify(state.sales));
        PosnicPro.local.set('receipt_printer', state.sales[0].name || 'default');
        PosnicPro.local.set('print_width', state.sales[0].pageSize);
    }
    function ready() {
        if (loading) return loading;
        var api = window.electronAPI && window.electronAPI.printer;
        if (!api || !api.getDocumentSettings) { state = fromLocal(); return Promise.resolve(state); }
        loading = api.getDocumentSettings().then(function (value) { mirror(value); return state; }).finally(function () { loading = null; });
        return loading;
    }
    function get(kind) { return (state || fromLocal())[kind] || sheet(); }
    function enabled(value) { return value === true || value === 'true' || value === 'enable'; }
    function features(data) {
        featureState = data || featureState;
        $('#document-print-settings [data-profile="invoice"]').prop('hidden', !enabled(featureState.invoices_enable));
        $('#document-print-settings [data-profile="quotation"]').prop('hidden', !enabled(featureState.quotes_enable));
    }
    function select(options, selected, attr) {
        return '<select class="form-control form-control-sm" ' + attr + '>' + Object.keys(options).map(function (key) {
            return '<option value="' + esc(key) + '"' + (key === selected ? ' selected' : '') + '>' + esc(options[key]) + '</option>';
        }).join('') + '</select>';
    }
    function row(kind, value, index) {
        var sale = kind === 'sales', name = sale ? value.name : value.printerName;
        var choices = sale ? {} : { '': PosnicPro.i18n.t('lang_print_ask_each_time', 'Ask each time') };
        choices.default = PosnicPro.i18n.t('lang_system_default', 'System Default');
        queues.forEach(function (q) { choices[q.name] = q.displayName || q.name; });
        if (name && !choices[name]) choices[name] = name + ' (' + PosnicPro.i18n.t('lang_about_unavailable', 'Unavailable') + ')';
        var title = sale ? PosnicPro.i18n.t('lang_print_sales_receipts', 'Sales receipts') : kind === 'invoice' ? PosnicPro.i18n.t('lang_invoices_enable', 'Invoices') : PosnicPro.i18n.t('lang_print_quotations', 'Quotations');
        var format = String(value.pageSize || value.paperSize || '80mm').toLowerCase();
        if (format === '58' || format === '80') format += 'mm';
        var sizes = Object.assign({}, sale ? papers : sheets);
        if (sale && !sizes[format]) sizes[format] = format;
        return '<tr data-profile="' + kind + '"><th scope="row">' + esc(title) + (sale && index ? ' ' + (index + 1) : '') + '</th><td>' +
            (desktop() ? select(choices, name, 'data-setting="printer" aria-label="' + esc(title + ' — ' + PosnicPro.i18n.t('lang_printer', 'Printer')) + '"') : '<span>' + esc(PosnicPro.i18n.t('lang_print_browser_dialog', 'Browser print dialog')) + '</span>') +
            '</td><td>' + select(sizes, format, 'data-setting="paper" aria-label="' + esc(title + ' — ' + PosnicPro.i18n.t('lang_print_paper_size', 'Paper size')) + '"') +
            '</td><td><input class="form-control form-control-sm" type="number" min="1" max="20" data-setting="copies" value="' + value.copies + '" aria-label="' + esc(title + ' — ' + PosnicPro.i18n.t('lang_print_copies', 'Copies')) + '"' + (desktop() ? '' : ' disabled') + '></td><td>' +
            (sale && index ? '<button type="button" class="btn btn-light btn-sm" data-print-remove aria-label="' + esc(PosnicPro.i18n.t('lang_print_remove_printer', 'Remove printer')) + '">×</button>' : '') + '</td></tr>';
    }
    function render() {
        var host = $('#document-print-settings');
        host.html('<section class="print-settings-panel"><h5>' + esc(PosnicPro.i18n.t('lang_print_printers_paper', 'Printers & paper')) + '</h5><p class="small text-muted">' + esc(PosnicPro.i18n.t('lang_print_this_device', 'Saved on this computer')) + '</p><p class="small text-muted mt-2">' +
            esc(desktop() ? PosnicPro.i18n.t('lang_print_device_help', 'Choose a printer and paper for each document. Other computers keep their own choices.') : PosnicPro.i18n.t('lang_print_browser_help', 'Paper choices are saved in this browser. Choose the printer and copies in the browser print dialog.')) + '</p><div class="table-responsive"><table class="table table-sm mb-2"><thead><tr><th>' + esc(PosnicPro.i18n.t('lang_print_document', 'Document')) + '</th><th>' + esc(PosnicPro.i18n.t('lang_printer', 'Printer')) + '</th><th>' + esc(PosnicPro.i18n.t('lang_print_paper_size', 'Paper size')) + '</th><th>' + esc(PosnicPro.i18n.t('lang_print_copies', 'Copies')) + '</th><th></th></tr></thead><tbody>' +
            state.sales.map(function (v, i) { return row('sales', v, i); }).join('') + row('invoice', state.invoice) + row('quotation', state.quotation) +
            '</tbody></table></div><div class="d-flex align-items-center flex-wrap mb-2"><button type="button" class="btn btn-outline-primary btn-sm mr-2" data-print-refresh>' + esc(PosnicPro.i18n.t('lang_print_refresh_printers', 'Refresh printers')) + '</button>' +
            (desktop() ? '<button type="button" class="btn btn-outline-primary btn-sm mr-2" data-print-add>' + esc(PosnicPro.i18n.t('lang_print_add_sales_printer', 'Add sales printer')) + '</button>' : '') +
            '<button type="button" class="btn btn-primary btn-sm" data-print-save>' + esc(PosnicPro.i18n.t('lang_print_save_settings', 'Save print settings')) + '</button><span class="small ml-2" role="status" data-print-status></span></div></section>');
        features(featureState);
    }
    function collect() {
        var next = { sales: [], invoice: state.invoice, quotation: state.quotation };
        $('#document-print-settings [data-profile]').each(function () {
            var el = $(this), kind = el.attr('data-profile');
            if (el.prop('hidden')) return;
            var copies = Number(el.find('[data-setting="copies"]').val());
            if (!Number.isInteger(copies) || copies < 1 || copies > 20) throw new Error(PosnicPro.i18n.t('lang_print_valid_copies', 'Choose between 1 and 20 copies.'));
            var name = el.find('[data-setting="printer"]').val() || (kind === 'sales' ? 'default' : '');
            var paper = el.find('[data-setting="paper"]').val();
            if (kind === 'sales') next.sales.push({ name: name, pageSize: paper, copies: copies });
            else next[kind] = { printerName: name, paperSize: paper, copies: copies };
        });
        return next;
    }
    async function save() {
        var host = $('#document-print-settings'), button = host.find('[data-print-save]');
        button.prop('disabled', true);
        try {
            var next = collect(), api = window.electronAPI && window.electronAPI.printer;
            if (desktop()) {
                if (!api || !api.saveDocumentSettings) throw new Error(PosnicPro.i18n.t('lang_print_update_desktop', 'Update the desktop app to save these printer settings.'));
                var result = await api.saveDocumentSettings(next);
                if (!result || !result.success) throw new Error(result && result.error || PosnicPro.i18n.t('lang_print_save_failed', 'Could not save print settings.'));
                next = result.settings;
            }
            mirror(next);
            host.find('[data-print-status]').text(PosnicPro.i18n.t('lang_print_settings_saved', 'Print settings saved.'));
        } catch (error) { host.find('[data-print-status]').text(error.message); }
        finally { button.prop('disabled', false); }
    }
    async function mount(data) {
        features(data);
        var host = $('#document-print-settings');
        if (!host.length) return;
        try {
            await ready();
            var api = window.electronAPI && window.electronAPI.printer;
            queues = api && api.list ? await api.list() : [];
            queues = Array.isArray(queues) ? queues : [];
            render();
        } catch (_) { state = fromLocal(); queues = []; render(); host.find('[data-print-status]').text(PosnicPro.i18n.t('lang_print_load_failed', 'Could not read printers. Refresh to try again.')); }
        host.off('.documentPrint').on('click.documentPrint', '[data-print-save]', save)
            .on('change.documentPrint', 'select,input', function () { host.find('[data-print-status]').text(PosnicPro.i18n.t('lang_rd_unsaved_changes', 'Unsaved changes')); })
            .on('click.documentPrint', '[data-print-refresh]', async function () {
                try { state = collect(); var api = window.electronAPI && window.electronAPI.printer; queues = api && api.list ? await api.list() : []; render(); }
                catch (error) { host.find('[data-print-status]').text(error.message); }
            })
            .on('click.documentPrint', '[data-print-add]', function () {
                try { state = collect(); if (state.sales.length >= 10) return; state.sales.push({ name: 'default', pageSize: '80mm', copies: 1 }); render(); }
                catch (error) { host.find('[data-print-status]').text(error.message); }
            })
            .on('click.documentPrint', '[data-print-remove]', function () { $(this).closest('tr').remove(); });
    }
    PosnicPro.printSettings = { ready: ready, get: get, mount: mount, features: features, save: save,
        saleFormat: function () { var value = get('sales')[0].pageSize; return value === '58mm' || value === '80mm' ? value.slice(0, 2) : value; } };
}());
