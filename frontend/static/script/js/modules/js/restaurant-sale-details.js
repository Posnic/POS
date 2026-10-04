(function (root) {
    'use strict';
    function render(data, enabled, translate) {
        if (!enabled || !data) return '';
        var t = translate, esc = function (value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); };
        var missing = t('lang_restaurant_not_recorded', 'Not recorded');
        function time(value) {
            if (!value || !Number.isFinite(Date.parse(value))) return missing;
            try { return new Intl.DateTimeFormat(undefined, { timeZone:data.time_zone, year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit' }).format(new Date(value)); }
            catch (_) { return new Date(value).toISOString(); }
        }
        function field(label, value) { return '<div><dt>' + esc(label) + '</dt><dd>' + esc(value == null || value === '' ? missing : value) + '</dd></div>'; }
        var html = '<section class="sale-restaurant-summary"><h3>' + esc(t('lang_restaurant_details', 'Restaurant details')) + '</h3><dl class="sale-restaurant-facts">'
            + field(t('lang_table', 'Table'), data.table)
            + field(t('lang_bill_print_covers', 'Covers'), data.covers)
            + field(t('lang_ordertype_title', 'Order Type'), data.order_type)
            + field(t('lang_restaurant_taken_by', 'Order taken by'), data.taken_by)
            + field(t('lang_po_ordered', 'Ordered'), time(data.ordered_at))
            + field(t('lang_device', 'Device'), data.device)
            + (data.assigned_to ? field(t('lang_restaurant_assigned', 'Currently assigned to'), data.assigned_to) : '')
            + (data.source ? field(t('lang_source', 'Source'), data.source + (data.app_version ? ' · ' + data.app_version : '')) : '')
            + (data.device_id && data.device_id !== data.device ? field(t('lang_device_id', 'Device ID'), data.device_id) : '')
            + '</dl>';
        if (data.preparation_note) html += '<p class="sale-restaurant-note">' + esc(t('lang_prep_note', 'Note for the kitchen')) + ': ' + esc(data.preparation_note) + '</p>';
        var events = Array.isArray(data.events) ? data.events : [];
        html += '<details class="sale-restaurant-history"><summary>' + esc(t('lang_table_kot_activity', 'Table / KOT activity')) + ' <span>' + events.length + '</span></summary>';
        html += '<p class="sale-restaurant-help">' + esc(t('lang_restaurant_service_record', 'Serving times appear only when staff recorded service. Payment does not confirm delivery.')) + ' · ' + esc(data.time_zone) + '</p>';
        if (!events.length) html += '<p>' + esc(missing) + '</p>';
        events.forEach(function (event) {
            var labels = {
                kot: t('lang_kotdetails_title', 'KOT Details') + ' #' + event.sequence,
                served: t('lang_served_at', 'Served at'),
                bill_requested: t('lang_restaurant_bill_requested', 'Bill requested'),
                bill_printed: t('lang_restaurant_bill_printed', 'Bill printed'),
                handover: t('lang_restaurant_handover', 'Staff handover')
            };
            html += '<article class="sale-restaurant-event"><header><strong>' + esc(labels[event.kind] || event.kind) + '</strong><time>' + esc(time(event.at)) + '</time></header>';
            if (event.actor || event.to) html += '<p>' + esc(event.actor || missing) + (event.to ? ' → ' + esc(event.to) : '') + '</p>';
            html += '<ul>';
            (event.items || []).forEach(function (item) {
                var action = item.action === 'add' ? t('lang_added', 'Added') : item.action === 'cancel' ? t('lang_cancelled', 'Cancelled') : item.action;
                html += '<li><span>' + esc(item.quantity) + ' × ' + esc(item.name) + '</span>' + (action ? '<small>' + esc(action) + '</small>' : '') + (item.note ? '<p>' + esc(item.note) + '</p>' : '') + '</li>';
            });
            html += '</ul>' + (event.note ? '<p>' + esc(event.note) + '</p>' : '') + (event.reason ? '<p>' + esc(t('lang_stock_adjust_reason', 'Reason')) + ': ' + esc(event.reason) + '</p>' : '') + '</article>';
        });
        return html + '</details></section>';
    }
    if (typeof module === 'object' && module.exports) module.exports = { render:render };
    else root.PosnicPro.restaurantSaleDetails = { render:function (sale) { return render(sale.restaurant_details, root.PosnicPro.local.get('table_options') === 'enable', function (key, fallback) { return root.PosnicPro.i18n.t(key, fallback); }); } };
}(typeof window === 'undefined' ? globalThis : window));
