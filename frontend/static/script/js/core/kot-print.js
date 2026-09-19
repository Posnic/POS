/* Counter KOT printing shares the kitchen queue. Browser dialog completion is
 * not proof that paper came out; only a printer result or cashier confirms it. */
(function () {
    'use strict';
    var active = null, busy = false, queued = [], lastId = '', focusNext = false, leaseTimer, branchKey;
    var esc = function (value) { return PosnicPro.escapeHtml(String(value == null ? '' : value)); };
    function key(suffix) { return 'kot_counter_' + suffix + '_' + PosnicPro.local.get('branch_id_set'); }
    function automatic() { return PosnicPro.local.get(key('auto')) === 'true'; }
    function api(id, body) {
        return new Promise(function (resolve, reject) {
            PosnicPro.post({ url: 'sales/' + id + '/kotPrint', data: JSON.stringify(body) }, function (res) {
                if (res.type === 'success') resolve(res.data);
                else reject(new Error(res.message || PosnicPro.i18n.t('lang_kot_print_failed', 'Could not print the KOT.')));
            }, function (xhr) { var error = new Error(xhr.responseJSON && xhr.responseJSON.message || PosnicPro.i18n.t('lang_kot_print_failed', 'Could not print the KOT.')); error.status = xhr.status; reject(error); });
        });
    }
    function remember() {
        try {
            if (active && active.token) sessionStorage.setItem(key('pending'), JSON.stringify(active));
            else sessionStorage.removeItem(key('pending'));
        } catch (_) { /* Printing still works without session storage. */ }
    }
    function feedback(message) {
        var box = $('#kot-print-feedback').empty().prop('hidden', false);
        $('<span role="status">').text(message || PosnicPro.i18n.t('lang_kot_print_saved', 'Order saved.')).appendTo(box);
        if (lastId || active) $('<button type="button" class="btn btn-sm btn-outline-primary ml-3">')
            .text(active ? PosnicPro.i18n.t('lang_kot_print_confirm', 'Confirm KOT printing') : PosnicPro.i18n.t('lang_kot_print_button', 'Print KOT'))
            .on('click', function () { if (active) confirmation(); else start(lastId, false); }).appendTo(box);
        if (focusNext && box.is(':visible')) { box.find('button').trigger('focus'); focusNext = false; }
    }
    function render(sale, width) {
        var titles = { new: PosnicPro.i18n.t('lang_kot_print_new', 'New Order'), modified: PosnicPro.i18n.t('lang_kot_print_additional', 'Additional Order'),
            cancel: PosnicPro.i18n.t('lang_kot_print_cancelled', 'Cancelled Items'), copy: PosnicPro.i18n.t('lang_kot_print_copy', 'KOT COPY - Do not prepare again') };
        return '<!doctype html><html><head><meta charset="utf-8"><title>KOT</title><style>' +
            '@page{size:auto;margin:0}html,body{margin:0;padding:0;background:white;color:black}' +
            'body{font:12px/1.3 monospace;width:' + (width === '58' ? 48 : 72) + 'mm}' +
            'section{padding:1mm 0;break-after:page}section:last-child{break-after:auto}' +
            'h1{font-size:17px;text-align:center;margin:0 0 4px}p{margin:3px 0;overflow-wrap:anywhere}' +
            '.item{display:flex;gap:8px;border-top:1px dashed;padding:4px 0}.name{flex:1;min-width:0;overflow-wrap:anywhere}.qty{white-space:nowrap;font-weight:bold}.note{font-size:11px}.cancel .name{text-decoration:line-through}' +
            '</style></head><body>' + sale.print_jobs.map(function (job) {
                var date = job.timestamp || sale.updated_date || sale.created_date;
                var dateText = date && !isNaN(new Date(date).getTime()) ? new Date(date).toLocaleString() : date || '';
                return '<section><h1>' + esc(titles[job.type] || titles.new) + '</h1><p>' + esc(sale.sales_id || '') + '</p><p>' + esc(dateText) + '</p>' +
                    (sale.table_number ? '<p>' + esc(PosnicPro.i18n.t('lang_kot_print_table', 'Table')) + ': ' + esc(sale.table_number) + '</p>' : '') +
                    (sale.dine_type ? '<p>' + esc(sale.dine_type) + '</p>' : '') +
                    (sale.person_count ? '<p>' + esc(PosnicPro.i18n.t('lang_kot_print_covers', 'Covers')) + ': ' + esc(sale.person_count) + '</p>' : '') +
                    job.items.map(function (item) {
                        var note = item.item_note || item.item_description || '';
                        var spice = item.spice_level != null && item.spice_level !== '' ? String(item.spice_level) : '';
                        return '<div class="item ' + (job.type === 'cancel' ? 'cancel' : '') + '"><div class="name"><strong>' + esc(item.item_name) + '</strong>' +
                            (note ? '<p class="note">' + esc(note) + '</p>' : '') + (spice ? '<p class="note">' + esc(PosnicPro.i18n.t('lang_kot_print_spice', 'Spice')) + ': ' + esc(spice) + '</p>' : '') +
                            '</div><div class="qty">× ' + esc(item.item_quantity) + '</div></div>';
                    }).join('') + (sale.sales_description ? '<p>' + esc(sale.sales_description) + '</p>' : '') + '</section>';
            }).join('') + '</body></html>';
    }
    function browserPrint(sale) {
        return new Promise(function (resolve, reject) {
            var width = PosnicPro.local.get(key('width')) === '58' ? '58' : '80';
            var frame = $('<iframe title="KOT print" data-t-title="lang_kot_print" sandbox="allow-same-origin allow-modals">')
                .css({ position: 'fixed', left: '-10000px', top: 0, width: width + 'mm', height: '1000px', border: 0 });
            var timeout = setTimeout(function () { frame.remove(); reject(new Error(PosnicPro.i18n.t('lang_kot_print_failed', 'Could not print the KOT.'))); }, 15000);
            frame.on('load', function () {
                clearTimeout(timeout);
                try {
                    var win = frame[0].contentWindow;
                    if (window.PosnicReceiptPage) window.PosnicReceiptPage.fitDocument(win.document, { usePrinterPaper: true });
                    win.onafterprint = function () { frame.remove(); resolve({ dialog: true }); };
                    win.focus(); win.print();
                } catch (error) { frame.remove(); reject(error); }
            });
            frame.attr('srcdoc', render(sale, width)).appendTo('body');
        });
    }
    function watchLease() {
        clearInterval(leaseTimer);
        if (!active || !active.token) return;
        leaseTimer = setInterval(function () {
            if (active && active.token) api(active.id, { action: 'renew', token: active.token }).catch(function (error) {
                clearInterval(leaseTimer); feedback(error.message);
            });
        }, 30000);
    }
    function closeDialog() { var dialog = document.getElementById('kot-print-confirm'); if (dialog) dialog.remove(); }
    function drain() { if (!busy && !active && queued.length) start(queued.shift(), true); }
    async function finish(action) {
        if (!active || busy) return;
        busy = true;
        try {
            if (active.token) {
                try { await api(active.id, { action: action, token: active.token }); }
                catch (error) { if (action !== 'release' || error.status !== 409) throw error; }
            }
            active = null; clearInterval(leaseTimer); remember(); closeDialog();
            feedback(action === 'confirm' ? PosnicPro.i18n.t('lang_kot_print_printed', 'KOT printed.') : PosnicPro.i18n.t('lang_kot_print_pending', 'KOT returned to the kitchen queue.'));
        } catch (error) { feedback(error.message); }
        finally { busy = false; setTimeout(drain, 0); }
    }
    function confirmation(error) {
        if (!active) return;
        closeDialog();
        var dialog = $('<dialog id="kot-print-confirm" aria-labelledby="kot-print-confirm-title">')
            .css({ border: '1px solid #ccd5e2', borderRadius: '10px', padding: '24px', maxWidth: '480px', width: 'calc(100% - 32px)' });
        $('<h3 id="kot-print-confirm-title">').text(PosnicPro.i18n.t('lang_kot_print_question', 'Did the KOT print?')).appendTo(dialog);
        $('<p>').text(error || PosnicPro.i18n.t('lang_kot_print_confirm_help', 'Confirm only after the ticket comes out. Cancelling the print dialog does not mark it printed.')).appendTo(dialog);
        $('<button type="button" class="btn btn-primary mr-2">').text(PosnicPro.i18n.t('lang_kot_print_yes', 'Printed')).on('click', function () { finish('confirm'); }).appendTo(dialog);
        $('<button type="button" class="btn btn-outline-primary mr-2">').text(PosnicPro.i18n.t('lang_kot_print_retry', 'Print again')).on('click', function () { if (!busy) { closeDialog(); send(); } }).appendTo(dialog);
        $('<button type="button" class="btn btn-link mt-2">').text(PosnicPro.i18n.t('lang_kot_print_return', 'Return to kitchen queue')).on('click', function () { finish('release'); }).appendTo(dialog);
        dialog.on('cancel', function (event) { event.preventDefault(); closeDialog(); feedback(PosnicPro.i18n.t('lang_kot_print_unconfirmed', 'KOT printing needs confirmation.')); });
        dialog.appendTo('body')[0].showModal();
    }
    async function send() {
        if (!active || busy) return;
        busy = true;
        try {
            // A suspended tab may have lost its reservation. Revalidate before
            // sending any bytes, including when the cashier chooses to retry.
            if (active.token) await api(active.id, { action: 'renew', token: active.token });
            var kot = window.electronAPI && window.electronAPI.kot;
            var result = kot && kot.printTicket ? await kot.printTicket(active.sale) : { available: false };
            if (result.available === false) { await browserPrint(active.sale); busy = false; confirmation(); return; }
            if (!result.success) throw new Error(result.error || PosnicPro.i18n.t('lang_kot_print_failed', 'Could not print the KOT.'));
            busy = false; await finish('confirm');
        } catch (error) { busy = false; confirmation(error.message); }
    }
    async function start(id, auto, copy) {
        restoreBranch();
        if (!id || busy) return;
        if (active) { confirmation(); return; }
        busy = true; lastId = id;
        feedback(PosnicPro.i18n.t('lang_kot_print_preparing', 'Preparing KOT…'));
        try {
            var result = await api(id, { action: 'prepare', copy: !!copy });
            if (result.state === 'busy') { feedback(PosnicPro.i18n.t('lang_kot_print_elsewhere', 'The kitchen printer is already handling this KOT.')); return; }
            if (result.state === 'printed') {
                feedback(PosnicPro.i18n.t('lang_kot_print_already', 'This KOT has already been printed.'));
                if (!auto) $('<button type="button" class="btn btn-sm btn-outline-secondary ml-2">')
                    .text(PosnicPro.i18n.t('lang_kot_print_reprint', 'Reprint a copy')).on('click', function () { start(id, false, true); }).appendTo('#kot-print-feedback');
                return;
            }
            active = { id: id, token: result.token, sale: result.sale };
            remember(); watchLease(); busy = false; await send();
        } catch (error) { feedback(error.message); }
        finally { busy = false; setTimeout(drain, 0); }
    }
    function loadSettings() {
        restoreBranch();
        $('#kot-counter-auto').prop('checked', automatic());
        $('#kot-counter-width').val(PosnicPro.local.get(key('width')) || '80');
    }
    function afterSave(id) {
        restoreBranch();
        if (!id) return;
        lastId = id; focusNext = !automatic(); feedback();
        if (automatic()) { if (queued.indexOf(id) === -1) queued.push(id); drain(); }
    }
    function restoreBranch() {
        var current = key('pending');
        if (branchKey === current) return;
        branchKey = current; active = null; lastId = ''; queued = []; clearInterval(leaseTimer); closeDialog();
        if (!active) {
            try { active = JSON.parse(sessionStorage.getItem(key('pending')) || 'null'); } catch (_) { active = null; }
            if (active) watchLease();
        }
    }
    function restore() {
        restoreBranch();
        if (active || lastId) feedback(active ? PosnicPro.i18n.t('lang_kot_print_unconfirmed', 'KOT printing needs confirmation.') : undefined);
        loadSettings();
    }
    $(document).on('change', '#kot-counter-auto, #kot-counter-width', function () {
        PosnicPro.local.set(key('auto'), String($('#kot-counter-auto').is(':checked')));
        PosnicPro.local.set(key('width'), $('#kot-counter-width').val() || '80');
        $('#kot-counter-saved').text(PosnicPro.i18n.t('lang_kot_print_settings_saved', 'Saved for this counter.'));
    });
    PosnicPro.kotPrint = { print: function (id) { return start(id, false); }, afterSave: afterSave,
        restore: restore, loadSettings: loadSettings, render: render, browserPrint: browserPrint };
}());
