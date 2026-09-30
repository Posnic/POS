/* Branch-scoped outlets. Each billing window owns its cart and context. */
(function () {
    'use strict';
    var ui = PosnicPro.billingoutlets = { current: null, data: null };
    var escape = function (value) { return $('<span>').text(String(value == null ? '' : value)).html(); };
    var amount = function (value) { return Math.round(Number(value) * 100) / 100; };
    function request(url, data, method) {
        return new Promise(function (resolve, reject) {
            PosnicPro.request({ url: 'billing-outlets' + url, method: method || 'GET', data: method ? JSON.stringify(data) : data || {} },
                function (r) { if (r && r.status === true) resolve(r.data); else reject(new Error(r && r.message || 'Request failed')); },
                function (r) { reject(new Error(r && r.message || 'Could not load billing outlets.')); });
        });
    }
    function error(e) { $('#billing_message').text(e.message || String(e)).addClass('text-danger'); }
    ui.load = function () {
        return request('').then(function (data) {
            ui.data = data;
            if (billingWindowId) {
                var previous = ui.current;
                ui.current = data.outlets.find(function (o) { return String(o._id) === billingWindowId; }) || null;
                if (!ui.current) throw new Error('This outlet is unavailable or your access has changed.');
                if (previous && previous.updated_at !== ui.current.updated_at && PosnicPro.sales && PosnicPro.sales.addSalesLineTable && PosnicPro.sales.addSalesLineTable.length) { ui.current = previous; throw new Error('Outlet settings changed while this cart was open. Clear this unsaved cart and reload the outlet before using the new prices.'); }
                document.title = ui.current.name + ' — ' + data.branch.name + ' — Posnic';
                $('#billing_outlet_label').text(ui.current.name + ' · ' + data.branch.name);
                $('#billing_room_wrap').show();
            }
            return data;
        });
    };
    ui.open = function (id) {
        var outlet = ui.data.outlets.find(function (o) { return String(o._id) === id; });
        if (!outlet) return;
        if (window.electronAPI && window.electronAPI.billing) {
            window.electronAPI.billing.openOutlet({ branchId: ui.data.branch.id, outletId: id, name: outlet.name + ' — ' + ui.data.branch.name }).catch(error);
            return;
        }
        var url = new URL(window.location.href);
        url.search = ''; url.searchParams.set('billing_window', id); url.searchParams.set('billing_branch', ui.data.branch.id);
        url.hash = '/sales/new';
        var child = window.open(url.href, 'posnic-outlet-' + id);
        if (child) child.focus(); else error(new Error('Allow this billing window to open, then try again.'));
    };
    ui.price = function (params) {
        var config = PosnicPro.sales && PosnicPro.sales.EditRecentSaleParams && PosnicPro.sales.EditRecentSaleParams.outlet_snapshot || ui.current;
        if (!config) return params;
        var id = String(params.id || params.item_id);
        if (params.open_price === true || Number(params.selling_price || 0) <= 0 || params.item_status === 'instant' || params.sales_type === 'instant') return params;
        var override = (config.prices || []).find(function (p) { return p.item_id === id; });
        var value = override ? Number(override.price) : amount(Number(params.selling_price) * (1 + config.markup_percent / 100));
        params.selling_price = value; params.mrp_price = value;
        return params;
    };
    ui.charge = function (base) {
        if (!PosnicPro.sales) return;
        var sale = PosnicPro.sales.EditRecentSaleParams;
        var config = sale && sale.outlet_snapshot || ui.current;
        if (!config) return;
        var itemTax = 0;
        $('[id^="addSalesGstTax_"]').each(function () { itemTax += Number(String($(this).text()).replace(/,/g, '')) || 0; });
        var beforeDiscount = Number($('#grand_total').val()) || base;
        base = beforeDiscount > 0 ? Math.max(0, base * (1 - itemTax / beforeDiscount)) : 0;
        var charges = (PosnicPro.sales.charges || []).filter(function (c) { return c.source !== 'outlet'; });
        if (base > 0 && config.service_percent > 0) {
            var value = amount(base * config.service_percent / 100);
            var tax = amount(value * config.service_tax_percent / 100);
            charges.push({ name: 'Service charge (' + config.service_percent + '%)', amount: value, taxed: tax > 0,
                tax_amount: tax, tax_name: 'Service charge tax', source: 'outlet' });
            $('#billing_outlet_charge').text('Service charge ' + config.service_percent + '%: ' + value.toFixed(2) + (tax ? ' + tax ' + tax.toFixed(2) : ''));
        } else $('#billing_outlet_charge').empty();
        PosnicPro.sales.charges = charges;
    };
    ui.payload = function (data) {
        var existing = PosnicPro.sales && PosnicPro.sales.EditRecentSaleParams;
        var outletId = billingWindowId || existing && existing.outlet_id;
        if (!outletId) return data;
        if (!ui.current && !(existing && existing.outlet_snapshot)) throw new Error('Outlet settings must be loaded before saving.');
        var body = typeof data === 'string' ? JSON.parse(data) : Object.assign({}, data);
        body.outlet_id = outletId;
        body.outlet_revision = ui.current && ui.current.updated_at;
        body.outlet_expected_total = Number(PosnicPro.sales.extraDiscount.sale_new_tot);
        body.room_reference = $('#billing_room_reference').val() || '';
        return JSON.stringify(body);
    };
    ui.showDataTablePage = ui.show = function () {
        ui.previousPages = $('.page_loader:visible').not('#billing_outlets_page');
        $('.page_loader').hide();
        if (!$('#billing_outlets_page').length) $('body').append('<main id="billing_outlets_page" class="page_loader" style="position:fixed;inset:65px 0 0 0;overflow:auto;background:var(--theme-body-bg,#fff);color:var(--theme-text-primary,#172b4d);z-index:100;padding:24px"><div style="max-width:1100px;margin:auto"><div class="d-flex justify-content-between"><h3>Billing outlets</h3><button class="btn btn-outline-secondary" id="billing_back">Back to billing</button></div><p id="billing_message" role="status"></p><div class="nav nav-tabs mb-3"><button class="btn btn-link" data-billing-tab="windows">Billing windows</button><button class="btn btn-link" data-billing-tab="summary">Daily summary</button><button class="btn btn-link" data-billing-tab="setup">Outlet settings</button></div><section id="billing_content"></section></div></main>');
        $('#billing_outlets_page').show();
        $('#billing_message').removeClass('text-danger').text('Loading…');
        ui.load().then(function () { $('#billing_message').text(ui.data.branch.name); ui.tab('windows'); }).catch(error);
    };
    ui.tab = function (tab) {
        var box = $('#billing_content').empty();
        if (tab === 'windows') {
            box.append('<p>Each outlet opens in its own named window. Keep several open and switch using the taskbar or these buttons.</p>');
            ui.data.outlets.forEach(function (o) {
                box.append('<button class="btn btn-outline-primary m-2" data-billing-open="' + escape(o._id) + '">' + escape(o.name) + ' ↗</button>');
            });
            if (!ui.data.outlets.length) box.append('<p>No outlets are configured for your access.</p>');
        } else if (tab === 'setup') {
            if (!ui.data.manage) { box.text('Your account cannot change outlet settings.'); return; }
            box.append('<p>Outlets share this branch’s product catalogue and stock. Exact item prices override the percentage. Service charge applies after discounts, before tax. Existing bills retain their saved rules.</p><select class="form-control mb-3" id="billing_edit"><option value="">New outlet</option></select><form id="billing_form"><input type="hidden" name="id"><label class="d-block">Outlet name<input name="name" required maxlength="60" class="form-control"></label><div class="row"><label class="col-md-4">Price adjustment %<input name="markup_percent" type="number" min="-100" max="1000" step="0.01" value="0" class="form-control"></label><label class="col-md-4">Service charge %<input name="service_percent" type="number" min="0" max="100" step="0.01" value="0" class="form-control"></label><label class="col-md-4">Tax on service charge %<input name="service_tax_percent" type="number" min="0" max="100" step="0.01" value="0" class="form-control"></label></div><label><input name="active" type="checkbox" checked> Active for new bills</label><label class="d-block">Allowed billing staff (leave unselected for everyone with branch access)<select id="billing_members" multiple class="form-control"></select></label><h5>Exact item prices</h5><div id="billing_prices"></div><button class="btn btn-outline-secondary" type="button" id="billing_add_price">Add item price</button><button class="btn btn-primary ml-2" type="submit">Save outlet</button></form>');
            (ui.data.configuration || []).forEach(function (o) { $('#billing_edit').append($('<option>').val(o._id).text(o.name)); });
            request('/staff').then(function (staff) { staff.forEach(function (u) { $('#billing_members').append($('<option>').val(u._id).text(u.name || u.username)); }); }).catch(error);
        } else if (tab === 'summary') {
            box.append('<p>One branch report combines Restaurant, Bar and other outlets. Payment totals describe settlement of the selected day’s bills; use register closing for cash float, payouts and collections against older bills.</p><label>Report date<input id="billing_day" type="date" class="form-control"></label> <button class="btn btn-primary" id="billing_report">Generate summary</button> <button class="btn btn-outline-primary" id="billing_print" disabled>Print summary</button><div id="billing_report_body" class="mt-3"></div>');
            var now = new Date(); $('#billing_day').val(now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0'));
        }
    };
    function priceRow(value) {
        var row = $('<div class="d-flex mb-2" style="gap:8px"><select class="form-control billing_item" aria-label="Item"></select><input type="number" class="form-control billing_price" min="0" max="1000000" step="0.01" aria-label="Price" required><button type="button" class="btn btn-outline-danger billing_remove">Remove</button></div>');
        $('#billing_prices').append(row);
        row.find('select').select2({ minimumInputLength: 1, ajax: { url: API_URL + 'billing-outlets/items', dataType: 'json', xhrFields: { withCredentials: true },
            transport: function (opts) { request('/items', opts.data).then(function (data) { opts.success({ data: data }); }).catch(error); },
            data: function (term) { return { query: term, branch: PosnicPro.local.get('branch_id_set') }; },
            results: function (r) { return { results: (r.data || r || []).map(function (i) { return { id: i.id || i._id, text: i.name || i.item_name }; }) }; } } });
        if (value) { row.find('select').append($('<option selected>').val(value.item_id).text(value.name || value.item_id)); row.find('input').val(value.price); }
    }
    $(document).on('click', '#billing_back', function () { $('#billing_outlets_page').hide(); if (ui.previousPages && ui.previousPages.length) ui.previousPages.show(); else $('#sales_new').show(); })
        .on('click', '[data-billing-tab]', function () { ui.tab($(this).attr('data-billing-tab')); })
        .on('click', '[data-billing-open]', function () { ui.open($(this).attr('data-billing-open')); })
        .on('click', '#billing_add_price', function () { priceRow(); })
        .on('click', '.billing_remove', function () { $(this).parent().remove(); })
        .on('change', '#billing_edit', function () {
            var o = (ui.data.configuration || []).find(function (v) { return String(v._id) === $('#billing_edit').val(); }) || { active: true };
            $('#billing_form')[0].reset(); ['name', 'markup_percent', 'service_percent', 'service_tax_percent'].forEach(function (key) { $('#billing_form [name="' + key + '"]').val(o[key] || (key === 'name' ? '' : 0)); });
            $('#billing_form [name=id]').val(o._id || ''); $('#billing_form [name=active]').prop('checked', o.active !== false);
            $('#billing_members').val(o.members || []); $('#billing_prices').empty(); (o.prices || []).forEach(priceRow);
        }).on('submit', '#billing_form', function (event) {
            event.preventDefault(); var values = {};
            var submit = $(this).find('[type=submit]'); submit.prop('disabled', true);
            $(this).serializeArray().forEach(function (p) { values[p.name] = p.value; });
            values.active = $('#billing_form [name=active]').prop('checked'); values.members = $('#billing_members').val() || [];
            values.prices = []; $('#billing_prices > div').each(function () { values.prices.push({ item_id: $(this).find('select').val(), price: $(this).find('input').val() }); });
            request('', values, 'POST').then(function () { return ui.load(); }).then(function () { ui.tab('setup'); $('#billing_message').removeClass('text-danger').text('Outlet saved.'); }).catch(error).finally(function () { submit.prop('disabled', false); });
        }).on('click', '#billing_report', function () {
            $('#billing_print').prop('disabled', true); $('#billing_report_body').text('Loading…');
            request('/summary', { day: $('#billing_day').val() }).then(function (r) {
                var money = function (v) { return (v / Math.pow(10, r.currencyDigits)).toLocaleString(undefined, { minimumFractionDigits: r.currencyDigits, maximumFractionDigits: r.currencyDigits }); };
                var html = '<h3>' + escape(r.branch) + ' — Daily outlet summary</h3><p>' + escape(r.day + ' · ' + r.timezone + ' · ' + r.currency) + '</p><table class="table"><thead><tr><th>Outlet</th><th>Bills</th><th>Sales</th><th>Refunds</th><th>Outstanding</th></tr></thead><tbody>';
                r.outlets.concat([{ name: 'Total', bills: r.bills, sales: r.sales, refunds: r.refunds, outstanding: r.outstanding }]).forEach(function (o) { html += '<tr><td>' + escape(o.name) + '</td><td>' + o.bills + '</td><td>' + money(o.sales) + '</td><td>' + money(o.refunds) + '</td><td>' + money(o.outstanding) + '</td></tr>'; });
                html += '</tbody></table><h4>Payments recorded against these bills</h4><table class="table">';
                r.payments.forEach(function (p) { html += '<tr><td>' + escape(p.name) + '</td><td>' + money(p.amount) + '</td></tr>'; });
                html += '</table><p>' + escape(r.settlementBasis) + '</p><p>Prepared at ' + escape(new Date(r.generatedAt).toLocaleString()) + '</p>';
                if (r.closings && r.closings.length) {
                    html += '<h4>Register handover — closed on this date</h4><table class="table"><tr><th>Register</th><th>Expected cash</th><th>Counted cash</th></tr>';
                    r.closings.forEach(function (c) { html += '<tr><td>' + escape(c.name) + '</td><td>' + (c.expected == null ? 'Unavailable' : money(c.expected)) + '</td><td>' + (c.counted == null ? 'Not counted' : money(c.counted)) + '</td></tr>'; });
                    html += '<tr><th>Total</th><th>' + (r.cashExpected == null ? 'Incomplete' : money(r.cashExpected)) + '</th><th>' + (r.cashCounted == null ? 'Incomplete' : money(r.cashCounted)) + '</th></tr></table><p>Saved register closing figures. Open registers are not included. Includes the register’s opening cash and recorded cash movements.</p>';
                    if (r.countedPayments && r.countedPayments.length) {
                        html += '<h5>Recorded closing counts by payment type</h5><table class="table">';
                        r.countedPayments.forEach(function (p) { html += '<tr><td>' + escape(p.name) + '</td><td>' + money(p.amount) + '</td></tr>'; });
                        html += '</table><p>Combined declarations from closed registers; unentered counts are not inferred.</p>';
                    }
                } else html += '<p>No register closing is recorded for this date. Close and count the registers to include cash handover figures.</p>';
                if (r.unresolved.length) html += '<p class="text-danger">Payment breakdown needs reconciliation for: ' + escape(r.unresolved.join(', ')) + '</p>';
                $('#billing_report_body').html(html); $('#billing_print').prop('disabled', false);
            }).catch(function (e) { $('#billing_report_body').empty(); error(e); });
        }).on('click', '#billing_print', function () {
            var frame = document.createElement('iframe');
            frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-9999px';
            frame.onload = function () { frame.contentWindow.addEventListener('afterprint', function () { frame.remove(); }); frame.contentWindow.print(); };
            frame.srcdoc = '<!doctype html><title>Daily outlet summary</title><style>body{font:14px system-ui;padding:24px;color:#111}table{width:100%;border-collapse:collapse}td,th{padding:8px;text-align:left;border-bottom:1px solid #ddd}</style>' + $('#billing_report_body').html();
            document.body.appendChild(frame);
        });
    $(function () { if (billingWindowId) ui.load().catch(function (e) { window.alert(e.message); }); });
}());
