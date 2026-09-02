/*
 * Invoices (INVOICING_MODULE_DESIGN): the bill a customer is asked to pay.
 *
 * Built on the quotes surface - the same master-detail split, the same A4
 * sheet, the same editor - because a quote becomes an invoice becomes a sale
 * and the three must read as one family. The pure helpers (money, escaping,
 * line math, the tax breakup, the PDF sheet) are the quotes' own, called by
 * reference so the arithmetic on screen is the arithmetic the server stores.
 *
 * The one rule: THE INVOICE NEVER HOLDS MONEY. "Convert to sale" books it
 * through the ordinary sale screen; "Mark paid" settles that sale; and what
 * the document shows as paid or owed is what the sale says, mirrored by the
 * server. Feature-gated by invoices_enable, ACL: sales.
 */
PosnicPro.invoices = {
    _current: null,
    _esc: function (v) { return PosnicPro.quotes._esc(v); },
    _money: function (n) { return PosnicPro.quotes._money(n); },
    _d: function (v) { return v ? new Date(v).toLocaleDateString('en-IN') : ''; },
    _iso: function (v) { return v ? new Date(v).toISOString().slice(0, 10) : ''; },
    _on: function () {
        try {
            var gs = JSON.parse(PosnicPro.local.get('general_settings') || '{}');
            return gs.invoices_enable !== false;
        } catch (e) { return true; }
    },
    /* The status word a shopkeeper reads, and the pill colour it wears. */
    _label: function (s) {
        return { draft: 'Draft', sent: 'Sent', unpaid: 'Unpaid', partial: 'Partially paid', paid: 'Paid', cancelled: 'Cancelled' }[s] || s;
    },
    _pill: function (inv) {
        var s = inv.status;
        var cls = s === 'paid' ? 'paid' : (s === 'cancelled' || inv.is_overdue) ? 'unpaid' : 'hold';
        var text = inv.is_overdue ? 'Overdue' : PosnicPro.invoices._label(s);
        return '<span class="rs-pill ' + cls + '">' + text + '</span>';
    },
    _editable: function (inv) { return inv && (inv.status === 'draft' || inv.status === 'sent'); },
    _booked: function (inv) { return inv && !!inv.sale_id; },

    showDataTablePage: function () {
        PosnicPro.HideSideBarModal();
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $('.vertical-menu li a').removeClass('active');
        $('.page_loader,#osk-container').hide();
        $('.page-title-box,#invoices_new').show();
        $('#invoices_view_card,#invoices_edit_card').hide();
        $('#invoices_list_card').show();
        $('#invoices_new .contentbar').removeClass('master-detail invoices-split rail-collapsed');
        $('#invoices_list_rows tr.invoices-row').removeClass('is-active');
        $('.vertical-layout').removeClass('toggle-menu');
        $('#v-pills-dashboard-tab,#view_invoices_page').addClass('active');
        $('#v-pills-dashboard').addClass('show active');
        PosnicPro.invoices._current = null;
        PosnicPro.invoices.load();
        PosnicPro.invoices.loadSummary();
    },

    /* ------------------------------------------------------------ editor -- */
    _ed: null,
    _edBlank: function () {
        return { id: '', invoice_id: '', customer_id: '', lines: [], charges: [], due_date: '' };
    },
    _edShell: function () {
        PosnicPro.HideSideBarModal();
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $('.vertical-menu li a').removeClass('active');
        $('.page_loader,#osk-container').hide();
        $('.page-title-box,#invoices_new').show();
        $('#v-pills-dashboard-tab,#view_invoices_page').addClass('active');
        $('#v-pills-dashboard').addClass('show active');
        $('#invoices_list_card,#invoices_view_card').hide();
        /* The editor is a third child of this contentbar: the split must be
           off or it is laid out as a rail sibling (see quotes). */
        $('#invoices_new .contentbar').removeClass('master-detail invoices-split rail-collapsed');
        $('#invoices_edit_card').show();
        PosnicPro.collapseMenuForWorkspace();
        PosnicPro.invoices._edInitSort();
    },
    _edSortable: null,
    _edInitSort: function () {
        PosnicPro.lazy.load('sortable').then(function () {
            if (PosnicPro.invoices._edSortable || !window.Sortable) { return; }
            var el = document.getElementById('ie_lines');
            if (!el) { return; }
            PosnicPro.invoices._edSortable = window.Sortable.create(el, {
                handle: '.qe-l-grip',
                animation: 120,
                onEnd: function (evt) {
                    var ed = PosnicPro.invoices._ed;
                    if (!ed || evt.oldIndex === evt.newIndex) { return; }
                    var moved = ed.lines.splice(evt.oldIndex, 1)[0];
                    if (moved) { ed.lines.splice(evt.newIndex, 0, moved); }
                    PosnicPro.invoices.edRender();
                }
            });
        }).catch(function () { /* drag is a nicety */ });
    },
    _edClearForm: function () {
        $('#ie_cust_search,#ie_cust_name,#ie_cust_phone,#ie_cust_email,#ie_cust_gstin,#ie_cust_address').val('');
        $('#ie_item_search,#ie_payment,#ie_bank,#ie_terms,#ie_notes,#ie_disc_value,#ie_reference').val('');
        $('#ie_disc_type').val('');
        $('.ie-due-chip').removeClass('btn-primary').addClass('btn-secondary-rgba');
    },
    showAdd: function () {
        PosnicPro.invoices._ed = PosnicPro.invoices._edBlank();
        PosnicPro.invoices._edShell();
        PosnicPro.invoices._edClearForm();
        $('#ie_title').text('New invoice');
        /* Terms and the due date come from the shop's invoice settings on
           save; the box shows the terms it will get so they can be changed. */
        $('#ie_terms').val(PosnicPro.local.get('invoice_terms') || '');
        $('#ie_due_date').val('');
        PosnicPro.quotes._loadTaxList(function () { PosnicPro.invoices.edRender(); });
        PosnicPro.invoices.edRender();
    },
    showEdit: function (id) {
        PosnicPro.get({ url: 'invoices/' + id, data: {} }, function (r) {
            var inv = r && r.data;
            if (!inv) { PosnicPro.alert('error', 'Invoice not found'); return; }
            if (!PosnicPro.invoices._editable(inv)) {
                PosnicPro.alert('warning', 'This invoice is ' + PosnicPro.invoices._label(inv.status).toLowerCase() + ' - it can no longer be edited.');
                hasher.setHash('invoices/' + id);
                return;
            }
            var ed = PosnicPro.invoices._edBlank();
            ed.id = String(inv._id);
            ed.invoice_id = inv.invoice_id || '';
            ed.customer_id = inv.customer_id ? String(inv.customer_id) : '';
            ed.lines = (inv.items || []).map(function (l) {
                return {
                    kind: l.kind === 'custom' || !l.item_id ? 'custom' : 'item',
                    item_id: l.item_id ? String(l.item_id) : '',
                    item_name: l.item_name || '',
                    description: l.description || '',
                    barcode_id: l.barcode_id || '',
                    qty: Number(l.qty) || 1,
                    unit_price: Number(l.unit_price) || 0,
                    dtype: l.discount ? l.discount.type : '',
                    dval: l.discount ? l.discount.value : '',
                    tax_name: l.tax_name || '',
                    tax_value: Number(l.tax_value) || 0,
                    tax_type: l.tax_type || ''
                };
            });
            ed.charges = (inv.charges || []).map(function (c) {
                return { name: c.name || '', type: c.type === 'amount' ? 'amount' : 'percent', value: Number(c.value) || 0, sign: Number(c.sign) === -1 ? -1 : 1 };
            });
            PosnicPro.invoices._ed = ed;
            PosnicPro.invoices._edShell();
            PosnicPro.invoices._edClearForm();
            $('#ie_title').text('Edit ' + (inv.invoice_id || 'invoice'));
            $('#ie_cust_name').val(inv.customer_name || '');
            $('#ie_cust_phone').val(inv.customer_phone || '');
            $('#ie_cust_email').val(inv.customer_email || '');
            $('#ie_cust_gstin').val(inv.customer_gstin || '');
            $('#ie_cust_address').val(inv.customer_address || '');
            $('#ie_payment').val(inv.payment_method || '');
            $('#ie_bank').val(inv.bank_details || '');
            $('#ie_terms').val(inv.terms || '');
            $('#ie_notes').val(inv.notes || '');
            $('#ie_reference').val(inv.reference || '');
            $('#ie_disc_type').val(inv.discount ? inv.discount.type : '');
            $('#ie_disc_value').val(inv.discount ? inv.discount.value : '');
            $('#ie_due_date').val(PosnicPro.invoices._iso(inv.due_date));
            PosnicPro.quotes._loadTaxList(function () { PosnicPro.invoices.edRender(); });
            PosnicPro.invoices.edRender();
        }, function () { PosnicPro.alert('error', 'Could not load the invoice'); });
    },
    edRender: function () {
        var ed = PosnicPro.invoices._ed;
        if (!ed) { return; }
        var esc = PosnicPro.invoices._esc;
        var html = '';
        ed.lines.forEach(function (l, i) {
            html += '<tr data-i="' + i + '">'
                + '<td><span class="qe-l-grip" title="Drag to reorder">&#x2630;</span>'
                + '<input type="text" class="qe-l-name form-control form-control-sm" maxlength="200" placeholder="' + (l.kind === 'custom' ? 'Custom line name' : 'Item') + '" value="' + esc(l.item_name) + '">'
                + '<input type="text" class="qe-l-desc form-control form-control-sm mt-1" maxlength="500" placeholder="Description (optional)" value="' + esc(l.description) + '">'
                + (l.kind === 'custom'
                    ? '<select class="qe-l-taxsel form-control form-control-sm mt-1" style="max-width:170px;">'
                        + '<option value="">No tax</option>'
                        + ((PosnicPro.quotes._taxList || []).map(function (t) {
                            var sel = Number(l.tax_value) > 0 && String(l.tax_name) === String(t.tax_name) ? ' selected' : '';
                            return '<option value="' + esc(t.tax_value) + '" data-name="' + esc(t.tax_name) + '"' + sel + '>'
                                + esc(t.tax_name) + ' (' + esc(t.tax_value) + '%)</option>';
                        }).join(''))
                        + '</select>'
                    : '')
                + (Number(l.tax_value) > 0
                    ? '<div class="qe-l-tax">' + PosnicPro.quotes._taxNote(l) + ' '
                        + (l.kind === 'custom'
                            ? '<a href="javascript:void(0)" class="qe-l-taxflip">' + (l.tax_type === 'exclusive' ? 'added on top' : 'included') + '</a>'
                            : (l.tax_type === 'exclusive' ? 'added on top' : 'included'))
                        + '</div>'
                    : '')
                + '</td>'
                + '<td><input type="number" class="qe-l-qty form-control form-control-sm" min="0" step="any" value="' + esc(l.qty) + '"></td>'
                + '<td><input type="number" class="qe-l-price form-control form-control-sm" min="0" step="0.01" value="' + esc(l.unit_price) + '"></td>'
                + '<td><div class="input-group input-group-sm" style="min-width:150px;">'
                + '<select class="qe-l-dtype form-control" style="max-width:64px;"><option value=""' + (!l.dtype ? ' selected' : '') + '>-</option>'
                + '<option value="percent"' + (l.dtype === 'percent' ? ' selected' : '') + '>%</option>'
                + '<option value="amount"' + (l.dtype === 'amount' ? ' selected' : '') + '>amt</option></select>'
                + '<input type="number" class="qe-l-dval form-control" min="0" step="0.01" value="' + esc(l.dval) + '"></div></td>'
                + '<td class="text-right qe-l-total" style="white-space:nowrap; padding-top:12px;">' + PosnicPro.quotes._edLineTotal(l).toFixed(2) + '</td>'
                + '<td><button type="button" class="btn qe-l-del" title="Remove line">&times;</button></td>'
                + '</tr>';
        });
        $('#ie_lines').html(html || '<tr><td colspan="6" class="text-center text-muted">Search an item above, or add a custom line.</td></tr>');
        var chtml = '';
        ed.charges.forEach(function (c, i) {
            chtml += '<div class="input-group input-group-sm mb-1 qe-charge" data-i="' + i + '">'
                + '<input type="text" class="qe-c-name form-control" maxlength="60" placeholder="e.g. CGST 9% / Freight / Installation" value="' + esc(c.name) + '">'
                + '<select class="qe-c-type form-control" style="max-width:80px;"><option value="percent"' + (c.type === 'percent' ? ' selected' : '') + '>%</option>'
                + '<option value="amount"' + (c.type === 'amount' ? ' selected' : '') + '>amt</option></select>'
                + '<input type="number" class="qe-c-val form-control" style="max-width:100px;" min="0" step="0.01" value="' + esc(c.value) + '">'
                + '<select class="qe-c-sign form-control" style="max-width:80px;"><option value="1"' + (c.sign !== -1 ? ' selected' : '') + '>add</option>'
                + '<option value="-1"' + (c.sign === -1 ? ' selected' : '') + '>less</option></select>'
                + '<span class="input-group-text qe-c-out">0.00</span>'
                + '<div class="input-group-append"><button type="button" class="btn btn-outline-danger qe-c-del">&times;</button></div>'
                + '</div>';
        });
        $('#ie_charges').html(chtml || '<div class="text-muted small mb-1">No charges yet - add GST, freight, installation, anything, under its own name.</div>');
        PosnicPro.invoices.edRecalc();
    },
    /* The same arithmetic the server stores (document-math.computeTotals). */
    edRecalc: function () {
        var ed = PosnicPro.invoices._ed;
        if (!ed) { return 0; }
        var r2 = PosnicPro.quotes._edR2;
        var subtotal = 0;
        var taxSum = 0;
        ed.lines.forEach(function (l, i) {
            var t = PosnicPro.quotes._edLineTotal(l);
            subtotal += t;
            taxSum += PosnicPro.quotes._edLineTax(l);
            $('#ie_lines tr[data-i="' + i + '"] .qe-l-total').text(t.toFixed(2));
        });
        subtotal = r2(subtotal);
        taxSum = r2(taxSum);
        var dtype = $('#ie_disc_type').val();
        var dval = Number($('#ie_disc_value').val());
        var qdisc = 0;
        if (dtype === 'percent' && dval > 0) { qdisc = r2((subtotal * Math.min(dval, 100)) / 100); }
        if (dtype === 'amount' && dval > 0) { qdisc = r2(Math.min(dval, subtotal)); }
        var base = r2(subtotal - qdisc);
        var chargesSum = 0;
        var chargeRows = [];
        ed.charges.forEach(function (c, i) {
            var computed = c.type === 'percent' ? r2((base * (Number(c.value) || 0)) / 100) : r2(Number(c.value) || 0);
            chargesSum += (c.sign === -1 ? -1 : 1) * computed;
            $('#ie_charges .qe-charge[data-i="' + i + '"] .qe-c-out').text((c.sign === -1 ? '-' : '') + computed.toFixed(2));
            if (c.name) { chargeRows.push({ name: c.name, sign: c.sign, computed: computed }); }
        });
        chargesSum = r2(chargesSum);
        var total = Math.max(0, r2(base + chargesSum));
        PosnicPro.invoices._edPreviewRender({
            subtotal: subtotal, taxSum: taxSum, qdisc: qdisc, dtype: dtype, dval: dval,
            taxRows: PosnicPro.quotes._taxBreakup(ed.lines, PosnicPro.quotes._edLineTax),
            chargeRows: chargeRows, total: total
        });
        return total;
    },
    /* The right-hand paper: the SAME sheet the customer gets, live. */
    _edPreviewRender: function (m) {
        var ed = PosnicPro.invoices._ed;
        if (!ed) { return; }
        var esc = PosnicPro.invoices._esc;
        var money = PosnicPro.invoices._money;
        var taxLabel = PosnicPro.local.get('gst_action') === 'enable' ? 'GSTIN' : 'Tax ID';
        var logo = PosnicPro.local.get('branchimage');
        var custName = $.trim($('#ie_cust_name').val());
        var due = $('#ie_due_date').val();
        var ref = $.trim($('#ie_reference').val());
        var h = '<div class="q-head">'
            + '<div class="q-seller">'
            + (logo && logo !== 'store.png' ? '<img loading="lazy" decoding="async" class="q-logo" src="' + esc(logo) + '" alt="">' : '')
            + '<div class="q-shop">' + esc(PosnicPro.local.get('branchname') || '') + '</div>'
            + (function () {
                var real = PosnicPro.quotes._real;
                var addr = real(PosnicPro.local.get('branchaddress'));
                var ph = real(PosnicPro.local.get('branchphone'));
                var gst = real(PosnicPro.local.get('branchgstin'));
                return (addr ? '<div class="q-muted">' + esc(addr) + '</div>' : '')
                    + (ph ? '<div class="q-muted">' + esc(ph) + '</div>' : '')
                    + (gst ? '<div class="q-muted">' + taxLabel + ': ' + esc(gst) + '</div>' : '');
            })()
            + '</div>'
            + '<div class="q-title-block"><div class="q-doc-title">INVOICE</div>'
            + '<div class="q-num">' + esc(ed.invoice_id || 'New') + '</div>'
            + (due ? '<div class="q-muted">Due: ' + esc(due.split('-').reverse().join('/')) + '</div>' : '<div class="q-muted">Due: per your invoice settings</div>')
            + (ref ? '<div class="q-muted">Ref: ' + esc(ref) + '</div>' : '')
            + '</div></div>'
            + '<div class="q-billto"><div class="q-label">Bill To</div>'
            + '<div class="q-cust">' + (esc(custName) || 'Walk-in customer') + '</div>'
            + '<div class="q-muted">' + esc($.trim($('#ie_cust_address').val())) + '</div>'
            + '<div class="q-muted">' + esc($.trim($('#ie_cust_phone').val()))
            + ($.trim($('#ie_cust_gstin').val()) ? ' &middot; ' + taxLabel + ': ' + esc($.trim($('#ie_cust_gstin').val())) : '') + '</div>'
            + '</div>'
            + '<table class="q-items"><thead><tr><th>#</th><th>Item</th><th class="text-right">Qty</th>'
            + '<th class="text-right">Price</th><th class="text-right">Amount</th></tr></thead><tbody>';
        ed.lines.forEach(function (l, i) {
            var note = esc(l.description || '');
            if (l.dtype && Number(l.dval) > 0) {
                note += (note ? ' &middot; ' : '') + (l.dtype === 'percent' ? l.dval + '% off' : money(l.dval) + ' off');
            }
            if (Number(l.tax_value) > 0) {
                note += (note ? ' &middot; ' : '') + PosnicPro.quotes._taxNote(l)
                    + (l.tax_type === 'exclusive' ? ' added' : ' incl.');
            }
            h += '<tr><td>' + (i + 1) + '</td><td>' + (esc(l.item_name) || '<span class="text-muted">(unnamed)</span>')
                + (note ? '<div class="q-muted" style="font-size:11px;">' + note + '</div>' : '') + '</td>'
                + '<td class="text-right">' + esc(l.qty) + '</td>'
                + '<td class="text-right">' + money(l.unit_price) + '</td>'
                + '<td class="text-right">' + money(PosnicPro.quotes._edLineTotal(l)) + '</td></tr>';
        });
        h += '</tbody><tfoot>'
            + '<tr class="q-sub"><td colspan="4" class="text-right">Subtotal</td><td class="text-right">' + money(m.subtotal) + '</td></tr>'
            + (m.taxRows && m.taxRows.length
                ? m.taxRows.map(function (t) {
                    return '<tr class="q-sub"><td colspan="4" class="text-right">' + esc(t.label) + '</td><td class="text-right">' + money(t.amount) + '</td></tr>';
                }).join('')
                : (m.taxSum > 0 ? '<tr class="q-sub"><td colspan="4" class="text-right">Tax</td><td class="text-right">' + money(m.taxSum) + '</td></tr>' : ''))
            + (m.qdisc > 0 ? '<tr class="q-sub"><td colspan="4" class="text-right">Discount' + (m.dtype === 'percent' ? ' (' + m.dval + '%)' : '') + '</td><td class="text-right">-' + money(m.qdisc) + '</td></tr>' : '');
        m.chargeRows.forEach(function (c) {
            h += '<tr class="q-sub"><td colspan="4" class="text-right">' + esc(c.name) + '</td><td class="text-right">' + (c.sign === -1 ? '-' : '') + money(c.computed) + '</td></tr>';
        });
        h += '<tr class="q-grand"><th colspan="4" class="text-right">TOTAL</th><th class="text-right">' + money(m.total) + '</th></tr>'
            + '</tfoot></table>';
        var pay = $.trim($('#ie_payment').val());
        var bank = $.trim($('#ie_bank').val());
        var terms = $.trim($('#ie_terms').val());
        var notes = $.trim($('#ie_notes').val());
        if (pay || bank) {
            h += '<div class="q-block m-t-10"><div class="q-label">Payment details</div>'
                + (pay ? '<div>' + esc(pay) + '</div>' : '')
                + (bank ? '<div class="q-muted">' + esc(bank) + '</div>' : '') + '</div>';
        }
        if (terms) { h += '<div class="q-block m-t-10"><div class="q-label">Terms &amp; conditions</div>' + esc(terms) + '</div>'; }
        if (notes) { h += '<div class="q-block m-t-10"><div class="q-label">Notes</div>' + esc(notes) + '</div>'; }
        var sig = PosnicPro.local.get('quotesignature');
        if (sig) {
            h += '<div class="q-sign-img"><img loading="lazy" decoding="async" src="' + sig + '" alt="" style="max-height:40px; max-width:160px; display:block; margin:0 auto;"></div>'
                + '<div class="q-sign">Authorised signatory</div>';
        }
        $('#ie_preview').html(h);
    },
    edAddCustom: function () {
        if (!PosnicPro.invoices._ed) { return; }
        PosnicPro.invoices._ed.lines.push({ kind: 'custom', item_id: '', item_name: '', description: '', barcode_id: '', qty: 1, unit_price: 0, dtype: '', dval: '', tax_name: '', tax_value: 0, tax_type: '' });
        PosnicPro.invoices.edRender();
        $('#ie_lines tr:last .qe-l-name').focus();
    },
    edAddItem: function (itemId, seedName) {
        PosnicPro.get('items/' + itemId, function (r) {
            var d = (r && r.data) || {};
            if (!PosnicPro.invoices._ed) { return; }
            PosnicPro.invoices._ed.lines.push({
                kind: 'item', item_id: String(itemId),
                item_name: d.item_name || d.name || seedName || '',
                description: '',
                barcode_id: d.barcode_id || '',
                qty: 1, unit_price: Number(d.selling_price) || 0, dtype: '', dval: '',
                tax_name: d.tax_name || '',
                tax_value: Number(d.tax !== undefined && d.tax !== null && d.tax !== '' ? d.tax : d.tax_value) || 0,
                tax_type: String(d.tax_type || '').toLowerCase().indexOf('ex') === 0 ? 'exclusive' : 'inclusive'
            });
            PosnicPro.invoices.edRender();
        }, function () { PosnicPro.alert('error', 'Could not load that item'); });
    },
    edAddCharge: function () {
        if (!PosnicPro.invoices._ed) { return; }
        PosnicPro.invoices._ed.charges.push({ name: '', type: 'percent', value: 0, sign: 1 });
        PosnicPro.invoices.edRender();
        $('#ie_charges .qe-charge:last .qe-c-name').focus();
    },
    edCancel: function () {
        var ed = PosnicPro.invoices._ed || {};
        hasher.setHash(ed.id ? 'invoices/' + ed.id : 'invoices');
    },
    edSave: function () {
        var ed = PosnicPro.invoices._ed;
        if (!ed) { return; }
        var lines = ed.lines.filter(function (l) {
            return (String(l.item_name).trim() || l.item_id) && Number(l.qty) > 0;
        });
        if (!lines.length) { PosnicPro.alert('warning', 'Add at least one line with a name and quantity.'); return; }
        var payload = {
            lines: lines.map(function (l) {
                var out = {
                    kind: l.kind, item_id: l.item_id || '', item_name: l.item_name,
                    description: l.description, barcode_id: l.barcode_id,
                    qty: Number(l.qty), unit_price: Number(l.unit_price) || 0,
                    tax_name: l.tax_name || '', tax_value: Number(l.tax_value) || 0,
                    tax_type: l.tax_type || ''
                };
                if (l.dtype && Number(l.dval) > 0) { out.discount = { type: l.dtype, value: Number(l.dval) }; }
                return out;
            }),
            charges: ed.charges.filter(function (c) { return String(c.name).trim() && Number(c.value) > 0; }),
            customer_id: ed.customer_id || '',
            customer_name: $.trim($('#ie_cust_name').val()),
            customer_phone: $.trim($('#ie_cust_phone').val()),
            customer_email: $.trim($('#ie_cust_email').val()),
            customer_gstin: $.trim($('#ie_cust_gstin').val()),
            customer_address: $.trim($('#ie_cust_address').val()),
            payment_method: $.trim($('#ie_payment').val()),
            bank_details: $.trim($('#ie_bank').val()),
            terms: $.trim($('#ie_terms').val()),
            notes: $.trim($('#ie_notes').val()),
            reference: $.trim($('#ie_reference').val()),
            due_date: $('#ie_due_date').val() || '',
            total: PosnicPro.invoices.edRecalc()
        };
        var dtype = $('#ie_disc_type').val();
        if (dtype && Number($('#ie_disc_value').val()) > 0) {
            payload.discount = { type: dtype, value: Number($('#ie_disc_value').val()) };
        }
        var done = function (r) {
            PosnicPro.alert(r.type, r.message);
            if (r.type === 'success') {
                var id = ed.id || (r.data && r.data.id);
                hasher.setHash(id ? 'invoices/' + id : 'invoices');
            }
        };
        var fail = function (xhr) {
            var resp = {}; try { resp = JSON.parse(xhr.responseText); } catch (e) { /* plain */ }
            PosnicPro.alert('error', resp.message || 'Could not save the invoice');
        };
        if (ed.id) {
            PosnicPro.request({ method: 'PUT', url: 'invoices/' + ed.id, data: JSON.stringify(payload) }, done, fail);
        } else {
            PosnicPro.post({ url: 'invoices', data: JSON.stringify(payload) }, done, fail);
        }
    },

    /* -------------------------------------------------------------- list -- */
    _page: 1,
    PAGE_SIZE: 20,
    _seq: 0,
    load: function (keepPage) {
        if (!keepPage) { PosnicPro.invoices._page = 1; }
        var mine = ++PosnicPro.invoices._seq;
        var params = { page: PosnicPro.invoices._page, limit: PosnicPro.invoices.PAGE_SIZE };
        $.extend(params, PosnicPro.listFilter.params('invoices'));
        var sort = PosnicPro.listSort.value('invoices');
        if (sort) { params.sort = sort; }
        PosnicPro.get({ url: 'invoices', data: params }, function (r) {
            if (mine !== PosnicPro.invoices._seq) { return; }
            PosnicPro.invoices._rows = (r && r.data) || [];
            PosnicPro.invoices._meta = (r && r.meta) || null;
            PosnicPro.invoices.renderList();
        }, function () {
            if (mine !== PosnicPro.invoices._seq) { return; }
            $('#invoices_list_rows').text('Could not load invoices - try again.');
        });
    },
    /* What the shop is owed, in the chip strip: the two numbers this page
       is opened for. Quiet when there is nothing owed. */
    loadSummary: function () {
        PosnicPro.get({ url: 'invoices/summary', data: {} }, function (r) {
            var s = (r && r.data) || {};
            var money = PosnicPro.invoices._money;
            var out = '';
            if (s.owed_count > 0) {
                out = s.owed_count + ' owed &middot; ' + money(s.owed_total);
                if (s.overdue_count > 0) {
                    out += ' &middot; <span class="i-overdue">' + s.overdue_count + ' overdue &middot; ' + money(s.overdue_total) + '</span>';
                }
            }
            $('#invoices_summary').html(out);
        }, function () { $('#invoices_summary').html(''); });
    },
    renderList: function () {
        var esc = PosnicPro.invoices._esc;
        var rows = PosnicPro.invoices._rows || [];
        var meta = PosnicPro.invoices._meta;
        if (!rows.length) {
            var searching = PosnicPro.listFilter.activeCount('invoices') > 0;
            $('#invoices_list_rows').html('<div class="text-center text-muted p-t-20 p-b-20">'
                + (searching
                    ? 'No invoices match this filter.'
                    : 'No invoices here yet - press New, or Save as invoice on a sale, and it lands in this list.')
                + '</div>');
            return;
        }
        var d = function (v) { return v ? new Date(v).toLocaleDateString('en-IN') : '-'; };
        var html = '<div class="table-responsive"><table class="table table-borderless">'
            + '<thead><tr>'
            + '<th>Invoice #</th><th>Customer</th><th class="i-col-date">Date</th><th class="i-col-due">Due</th>'
            + '<th class="text-right">Total</th><th class="text-right i-col-balance">Balance</th><th class="text-center">Status</th>'
            + '</tr></thead><tbody>';
        rows.forEach(function (inv) {
            var owed = ['draft', 'sent', 'unpaid', 'partial'].indexOf(inv.status) !== -1;
            var balance = inv.balance !== undefined && inv.balance !== null ? Number(inv.balance) : Number(inv.total) || 0;
            html += '<tr class="md-row invoices-row highlight-select" data-id="' + esc(inv._id) + '" style="cursor:pointer;">'
                + '<td>' + esc(inv.invoice_id) + '</td>'
                + '<td>' + esc(inv.customer_name || 'Walk-in') + '</td>'
                + '<td class="i-col-date">' + d(inv.issue_date || inv.created_date) + '</td>'
                + '<td class="i-col-due">' + (inv.is_overdue ? '<span class="i-overdue">' + d(inv.due_date) + '</span>' : d(inv.due_date)) + '</td>'
                + '<td class="text-right">' + PosnicPro.invoices._money(inv.total) + '</td>'
                + '<td class="text-right i-col-balance">' + (owed ? PosnicPro.invoices._money(balance) : '<span class="text-muted">-</span>') + '</td>'
                + '<td class="text-center">' + PosnicPro.invoices._pill(inv) + '</td>'
                + '</tr>';
        });
        html += '</tbody></table></div>';
        /* The pager, honest about what was measured (see quotes.renderList). */
        var cur = (meta && meta.page) || 1;
        var lim = (meta && meta.limit) || rows.length || 1;
        var total = meta && typeof meta.total === 'number' ? meta.total : null;
        var pages = meta && meta.pages ? meta.pages : null;
        var hasMore = meta ? !!meta.hasMore : false;
        var arrow = function (to, label, off) {
            return '<button type="button" class="btn btn-sm btn-secondary-rgba q-pg-btn"' + (off ? ' disabled' : '')
                + ' onclick="PosnicPro.invoices._page = ' + to + '; PosnicPro.invoices.load(true);">' + label + '</button>';
        };
        var label;
        if (total !== null) {
            label = total + (total === 1 ? ' invoice' : ' invoices');
            if (pages > 1) { label = 'Page ' + cur + ' of ' + pages + ' · ' + label; }
        } else {
            var first = (cur - 1) * lim + 1;
            var last = (cur - 1) * lim + rows.length;
            label = rows.length ? 'Showing ' + first + '–' + last : 'No matches';
        }
        var showArrows = (pages && pages > 1) || cur > 1 || hasMore;
        html += '<div class="q-pager">'
            + (showArrows ? arrow(cur - 1, '&laquo;', cur <= 1) : '')
            + '<span class="q-pg-count">' + label + '</span>'
            + (showArrows ? arrow(cur + 1, '&raquo;', !hasMore) : '')
            + '</div>';
        $('#invoices_list_rows').html(html);
        if (PosnicPro.invoices._current && PosnicPro.invoices._current._id) {
            $('#invoices_list_rows tr.invoices-row[data-id="' + PosnicPro.invoices._current._id + '"]').addClass('is-active');
        }
    },

    /* ---------------------------------------------------------- document -- */
    _inSplit: function () {
        return $('#invoices_new').is(':visible')
            && $('#invoices_view_card').is(':visible')
            && !$('#invoices_edit_card').is(':visible')
            && $('#invoices_new .contentbar').hasClass('invoices-split');
    },
    showDetails: function (id) {
        /* Entering the page and moving between invoices are different
           operations; only the first may touch the page chrome (the quotes
           flicker, not repeated). */
        if (!PosnicPro.invoices._inSplit()) {
            PosnicPro.HideSideBarModal();
            $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
            $('.vertical-menu li a').removeClass('active');
            $('.page_loader,#osk-container').hide();
            $('.page-title-box,#invoices_new').show();
            $('#v-pills-dashboard-tab,#view_invoices_page').addClass('active');
            $('#v-pills-dashboard').addClass('show active');
            $('#invoices_edit_card').hide();
            $('#invoices_list_card').show();
            $('#invoices_new .contentbar').addClass('master-detail invoices-split');
            $('.vertical-layout').removeClass('toggle-menu');
            PosnicPro.invoices.load();
            PosnicPro.invoices.loadSummary();
        }
        $('#invoices_pay_strip').hide();
        $('#invoices_list_rows tr.invoices-row').removeClass('is-active')
            .filter('[data-id="' + id + '"]').addClass('is-active');
        PosnicPro.get({ url: 'invoices/' + id, data: {} }, function (r) {
            var inv = r && r.data;
            if (!inv) { PosnicPro.alert('error', 'Invoice not found'); return; }
            PosnicPro.invoices._current = inv;
            $('#invoices_list_rows tr.invoices-row').removeClass('is-active')
                .filter('[data-id="' + String(inv._id) + '"]').addClass('is-active');
            $('#invoices_view_body').html(PosnicPro.invoices._sheet(inv));
            $('#invoices_view_actions').html('<div class="q-actions">' + PosnicPro.invoices._actions(inv) + '</div>');
            PosnicPro.ACLForModule('sales');
            $('#invoices_view_card').show();
            if (PosnicPro.invoices._editable(inv)) { PosnicPro.invoices._pvInitSort(); }
        }, function () { PosnicPro.alert('error', 'Could not load the invoice'); });
    },
    /* The on-screen A4: seller and INVOICE block, bill-to, lines, totals,
       what was paid and what is due, the sale it was recorded as, footer. */
    _sheet: function (inv) {
        var esc = PosnicPro.invoices._esc;
        var money = PosnicPro.invoices._money;
        var d = PosnicPro.invoices._d;
        var open = PosnicPro.invoices._editable(inv);
        var booked = PosnicPro.invoices._booked(inv);
        var taxLabel = PosnicPro.local.get('gst_action') === 'enable' ? 'GSTIN' : 'Tax ID';
        var ed = function (f, val, ph) {
            if (!open) { return esc(val) || '<span class="text-muted">-</span>'; }
            return '<span class="q-edit" contenteditable="true" data-f="' + f + '" data-ph="' + ph + '">' + (esc(val) || '') + '</span>';
        };
        var stamp = PosnicPro.invoices._stamp(inv);
        var logo = PosnicPro.local.get('branchimage');
        var body = '<div class="q-sheet">'
            + '<div class="q-head">'
            + '<div class="q-seller">'
            + (logo && logo !== 'store.png' ? '<img loading="lazy" decoding="async" class="q-logo" src="' + esc(logo) + '" alt="">' : '')
            + '<div class="q-shop">' + esc(PosnicPro.local.get('branchname') || '') + '</div>'
            + (function () {
                var real = PosnicPro.quotes._real;
                var addr = real(PosnicPro.local.get('branchaddress'));
                var ph = real(PosnicPro.local.get('branchphone'));
                var em = real(PosnicPro.local.get('branchemail'));
                var gst = real(PosnicPro.local.get('branchgstin'));
                var out = '';
                if (addr) { out += '<div class="q-muted">' + esc(addr) + '</div>'; }
                if (ph || em) {
                    out += '<div class="q-muted">' + esc(ph) + (ph && em ? ' &middot; ' : '') + (em ? esc(em) : '') + '</div>';
                }
                if (gst) { out += '<div class="q-muted">' + taxLabel + ': ' + esc(gst) + '</div>'; }
                return out;
            })()
            + '</div>'
            + '<div class="q-title-block">'
            + '<div class="q-doc-title">INVOICE</div>'
            + '<div class="q-num">' + esc(inv.invoice_id) + '</div>'
            + '<div class="q-muted">Date: ' + d(inv.issue_date || inv.created_date) + '</div>'
            + '<div class="q-muted">Due: ' + ed('due_date', d(inv.due_date), 'dd/mm/yyyy') + '</div>'
            + (open || inv.reference ? '<div class="q-muted">Ref: ' + ed('reference', inv.reference, 'customer PO / job no.') + '</div>' : '')
            + (inv.source_quote_number ? '<div class="q-muted">From quote ' + esc(inv.source_quote_number) + '</div>' : '')
            + (stamp ? '<div class="q-status' + (inv.status === 'paid' ? ' is-paid' : '') + '">' + esc(stamp) + '</div>' : '')
            + '</div>'
            + '</div>'
            + '<div class="q-billto"><div class="q-label">Bill To</div>'
            + '<div class="q-cust">' + ed('customer_name', inv.customer_name || 'Walk-in customer', 'Customer name') + '</div>'
            + '<div class="q-muted">' + ed('customer_address', inv.customer_address, 'Address') + '</div>'
            + '<div class="q-muted">Phone: ' + ed('customer_phone', inv.customer_phone, 'phone')
            + ' &middot; ' + taxLabel + ': ' + ed('customer_gstin', inv.customer_gstin, taxLabel) + '</div>'
            + '<div class="q-muted">Email: ' + ed('customer_email', inv.customer_email, 'email') + '</div>'
            + '</div>'
            + '<div class="table-responsive"><table class="q-items"><thead><tr>'
            + '<th>#</th><th>Item</th><th class="text-right">Qty</th>'
            + '<th class="text-right">Unit price</th><th class="text-right">Amount</th>'
            + '</tr></thead><tbody>';
        (inv.items || []).forEach(function (l, i) {
            var note = esc(l.description || '');
            if (l.discount && l.discount.value > 0) {
                note += (note ? ' &middot; ' : '') + (l.discount.type === 'percent' ? l.discount.value + '% off' : money(l.discount.value) + ' off');
            }
            if (Number(l.tax_value) > 0) {
                note += (note ? ' &middot; ' : '') + PosnicPro.quotes._taxNote(l) + (l.tax_type === 'exclusive' ? ' added' : ' incl.');
            }
            body += '<tr><td>' + (i + 1) + '</td><td>' + esc(l.item_name)
                + (note ? '<div class="q-muted" style="font-size:11.5px;">' + note + '</div>' : '')
                + '</td>'
                + '<td class="text-right">' + esc(l.qty) + '</td>'
                + '<td class="text-right">' + money(l.unit_price) + '</td>'
                + '<td class="text-right">' + money(l.line_total) + '</td></tr>';
        });
        body += '</tbody><tfoot>'
            + '<tr class="q-sub"><td colspan="4" class="text-right">Subtotal</td>'
            + '<td class="text-right">' + money(inv.subtotal) + '</td></tr>'
            + (inv.discount && inv.discount.computed > 0
                ? '<tr class="q-sub"><td colspan="4" class="text-right">Discount'
                    + (inv.discount.type === 'percent' ? ' (' + inv.discount.value + '%)' : '')
                    + '</td><td class="text-right">-' + money(inv.discount.computed) + '</td></tr>'
                : '')
            + (inv.charges || []).map(function (c) {
                return '<tr class="q-sub"><td colspan="4" class="text-right">' + esc(c.name)
                    + '</td><td class="text-right">' + (c.sign === -1 ? '-' : '') + money(c.computed) + '</td></tr>';
            }).join('')
            + (function () {
                if (!(Number(inv.tax_total) > 0)) { return ''; }
                var rows = PosnicPro.quotes._taxBreakup(inv.items, function (l) { return Number(l.tax_amount) || 0; });
                if (!rows.length) { rows = [{ label: 'Tax', amount: Number(inv.tax_total) }]; }
                return rows.map(function (t) {
                    return '<tr class="q-sub"><td colspan="4" class="text-right">' + esc(t.label) + '</td><td class="text-right">' + money(t.amount) + '</td></tr>';
                }).join('');
            })()
            + '<tr class="q-grand"><th colspan="4" class="text-right">TOTAL</th>'
            + '<th class="text-right">' + money(inv.total) + '</th></tr>'
            + (booked
                ? '<tr class="q-sub"><td colspan="4" class="text-right">Paid</td><td class="text-right">' + money(inv.paid_amount) + '</td></tr>'
                    + '<tr class="q-grand"><th colspan="4" class="text-right">BALANCE DUE</th><th class="text-right">' + money(inv.balance) + '</th></tr>'
                : '')
            + '</tfoot></table></div>'
            + (booked
                ? '<div class="q-muted m-t-5">Recorded as sale ' + esc(inv.sale_number || '') + (inv.converted_date ? ' on ' + d(inv.converted_date) : '')
                    + (inv.paid_date ? ' &middot; paid ' + d(inv.paid_date) : '') + '</div>'
                : '')
            + (inv.status === 'cancelled' && inv.cancel_reason ? '<div class="q-muted m-t-5">Cancelled: ' + esc(inv.cancel_reason) + '</div>' : '')
            + (function () {
                var sections = {
                    payment: '<div class="q-label">Payment details</div>'
                        + '<div>' + ed('payment_method', inv.payment_method, 'e.g. Bank transfer / UPI / Cash') + '</div>'
                        + '<div class="q-muted">' + ed('bank_details', inv.bank_details, 'Account name, number, IFSC') + '</div>',
                    terms: '<div class="q-label">Terms &amp; conditions</div>' + ed('terms', inv.terms, 'e.g. Payment within 30 days of the invoice date.'),
                    custom: (inv.custom_blocks || []).map(function (b) {
                        return '<div class="q-label">' + esc(b.title || '') + '</div><div class="mb-2">' + esc(b.text || '') + '</div>';
                    }).join(''),
                    notes: inv.notes ? '<div class="q-label">Notes</div>' + esc(inv.notes) : ''
                };
                var tokens = ['payment', 'terms', 'custom', 'notes'];
                var order = [];
                (inv.layout || []).forEach(function (t) {
                    if (tokens.indexOf(t) !== -1 && order.indexOf(t) === -1) { order.push(t); }
                });
                tokens.forEach(function (t) { if (order.indexOf(t) === -1) { order.push(t); } });
                var out = '<div class="q-footer' + (open ? ' q-sortable' : '') + '" id="inv_footer_sort">';
                order.forEach(function (t) {
                    if (!sections[t]) { return; }
                    out += '<div class="q-block" data-tok="' + t + '">' + sections[t] + '</div>';
                });
                return out + '</div>';
            })()
            + (PosnicPro.local.get('quotesignature')
                ? '<div class="q-sign-img"><img loading="lazy" decoding="async" src="' + esc(PosnicPro.local.get('quotesignature')) + '" alt="" style="max-height:40px; max-width:160px; display:block; margin:0 auto;"></div>'
                    + '<div class="q-sign">Authorised signatory</div>'
                : '')
            + '</div>';
        return body;
    },
    /* The status word on the paper: nothing while it is still being written,
       and OVERDUE beats UNPAID because it is the thing the reader must act on. */
    _stamp: function (inv) {
        if (inv.status === 'draft' || inv.status === 'sent') { return inv.is_overdue ? 'OVERDUE' : ''; }
        if (inv.status === 'paid') { return 'PAID'; }
        if (inv.status === 'cancelled') { return 'CANCELLED'; }
        if (inv.is_overdue) { return 'OVERDUE'; }
        return inv.status === 'partial' ? 'PARTIALLY PAID' : 'UNPAID';
    },
    /* One primary action per state (the quotes rule): convert while it is a
       bill, mark paid while it is owed. Sending copies lives under Share;
       state changes and destruction live under More. */
    _actions: function (inv) {
        var open = PosnicPro.invoices._editable(inv);
        var booked = PosnicPro.invoices._booked(inv);
        var mi = function (call, label, cls, acc) {
            return '<a class="dropdown-item' + (cls ? ' ' + cls : '')
                + (acc ? '" data-module="sales" data-access="' + acc : '')
                + '" href="javascript:void(0)" onclick="' + call + '">' + label + '</a>';
        };
        var menu = function (label, items, acc) {
            return '<div class="btn-group"' + (acc ? ' data-module="sales" data-access="' + acc + '"' : '') + '>'
                + '<button type="button" class="btn btn-sm btn-light border dropdown-toggle"'
                + ' data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">' + label + '</button>'
                + '<div class="dropdown-menu dropdown-menu-right">' + items + '</div>'
                + '</div>';
        };
        var share = menu('Share', ''
            + mi('PosnicPro.invoices.printNow();', 'Print')
            + mi('PosnicPro.invoices.print();', 'Download PDF')
            + mi('PosnicPro.invoices.emailInvoice();', 'Email')
            + mi('PosnicPro.invoices.whatsappInvoice();', 'WhatsApp')
            + mi('PosnicPro.invoices.shareLink();', 'Copy link'));
        var moreItems = '';
        if (inv.status === 'draft') { moreItems += mi('PosnicPro.invoices.markSent();', 'Mark sent', '', 'write'); }
        if (booked) {
            moreItems += mi('PosnicPro.invoices.sync();', 'Refresh from sale', '', 'write')
                + mi('hasher.setHash(\'sales/' + String(inv.sale_id) + '\');', 'Open the sale');
        }
        if (inv.status !== 'cancelled' && inv.status !== 'paid' && inv.status !== 'partial') {
            moreItems += (moreItems ? '<div class="dropdown-divider"></div>' : '')
                + mi('PosnicPro.invoices.cancel();', 'Cancel invoice', 'text-danger', 'write');
        }
        if (open) { moreItems += mi('PosnicPro.invoices.remove();', 'Delete invoice', 'text-danger', 'delete'); }

        var visible = '';
        if (open) {
            visible += '<button type="button" class="btn btn-sm btn-light border" data-module="sales" data-access="write" onclick="hasher.setHash(\'invoices/'
                + String(inv._id) + '/edit\');">Edit</button>'
                + '<button type="button" class="btn btn-sm btn-primary" id="inv_save_edits" data-module="sales" data-access="write"'
                + ' style="display:none;" onclick="PosnicPro.invoices.saveEdits();">Save changes</button>';
        }
        visible += share;
        if (moreItems) { visible += menu('More', moreItems, 'write||delete'); }
        if (open) {
            visible += '<button type="button" class="btn btn-sm btn-primary" data-module="sales" data-access="write" onclick="PosnicPro.invoices.convert();">Convert to sale</button>';
        } else if (inv.status === 'unpaid' || inv.status === 'partial') {
            visible += '<button type="button" class="btn btn-sm btn-success" data-module="sales" data-access="write" onclick="PosnicPro.invoices.payOpen();">Mark paid</button>';
        }
        return visible;
    },
    _pvSortable: null,
    _pvInitSort: function () {
        PosnicPro.lazy.load('sortable').then(function () {
            if (!window.Sortable) { return; }
            var el = document.getElementById('inv_footer_sort');
            if (!el) { return; }
            if (PosnicPro.invoices._pvSortable) {
                try { PosnicPro.invoices._pvSortable.destroy(); } catch (e) { /* stale */ }
                PosnicPro.invoices._pvSortable = null;
            }
            PosnicPro.invoices._pvSortable = window.Sortable.create(el, {
                handle: '.q-label',
                animation: 120,
                onEnd: function () {
                    var inv = PosnicPro.invoices._current;
                    if (!inv) { return; }
                    var order = [];
                    $('#inv_footer_sort .q-block').each(function () { order.push($(this).data('tok')); });
                    inv.layout = ['billto', 'items', 'charges'].concat(order);
                    PosnicPro.invoices.saveEdits();
                }
            });
        }).catch(function () { /* drag is a nicety */ });
    },
    /* Persist the sheet's inline edits - draft/sent only, the server enforces
       the same rule. Lines, charges and discounts pass through unchanged. */
    saveEdits: function () {
        var inv = PosnicPro.invoices._current;
        if (!inv || !PosnicPro.invoices._editable(inv)) { return; }
        var read = function (f) { return $.trim($('#invoices_view_body .q-edit[data-f="' + f + '"]').text() || ''); };
        var due = read('due_date');
        var m = due.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
        var dueIso = m ? (m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2)) : PosnicPro.invoices._iso(inv.due_date);
        var payload = {
            items: (inv.items || []).map(function (l) {
                return {
                    kind: l.kind, item_id: l.item_id ? String(l.item_id) : '',
                    item_name: l.item_name, description: l.description || '',
                    barcode_id: l.barcode_id, qty: l.qty, unit_price: l.unit_price,
                    tax_name: l.tax_name || '', tax_value: l.tax_value || 0, tax_type: l.tax_type || '',
                    discount: l.discount ? { type: l.discount.type, value: l.discount.value } : undefined
                };
            }),
            charges: (inv.charges || []).map(function (c) { return { name: c.name, type: c.type, value: c.value, sign: c.sign }; }),
            discount: inv.discount ? { type: inv.discount.type, value: inv.discount.value } : undefined,
            custom_blocks: inv.custom_blocks || [],
            layout: inv.layout || undefined,
            notes: inv.notes || '',
            customer_id: inv.customer_id ? String(inv.customer_id) : '',
            customer_name: read('customer_name'),
            customer_address: read('customer_address'),
            customer_phone: read('customer_phone'),
            customer_gstin: read('customer_gstin'),
            customer_email: read('customer_email'),
            payment_method: read('payment_method'),
            bank_details: read('bank_details'),
            terms: read('terms'),
            reference: read('reference'),
            due_date: dueIso,
            tax_total: inv.tax_total,
            total: inv.total
        };
        PosnicPro.request({ method: 'PUT', url: 'invoices/' + inv._id, data: JSON.stringify(payload) }, function (r) {
            PosnicPro.alert(r.type, r.message);
            if (r.type === 'success') { PosnicPro.invoices.showDetails(String(inv._id)); }
        }, function (xhr) {
            var resp = {}; try { resp = JSON.parse(xhr.responseText); } catch (e) { /* plain */ }
            PosnicPro.alert('error', resp.message || 'Could not save the invoice');
        });
    },

    /* --------------------------------------------------------------- PDF -- */
    _pdfMoney: function (n) {
        return 'Rs ' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },
    _dmy: function (v) {
        if (!v) { return ''; }
        var dt = new Date(v);
        if (isNaN(dt)) { return ''; }
        var p = function (x) { return (x < 10 ? '0' : '') + x; };
        return p(dt.getDate()) + '/' + p(dt.getMonth() + 1) + '/' + dt.getFullYear();
    },
    /* The quotation sheet, told it is an invoice: title, number, the head
       lines (date, due, reference, sale), the stamp, and the paid/balance
       rows under the total. */
    _pdfOpts: function (inv) {
        var dmy = PosnicPro.invoices._dmy;
        var booked = PosnicPro.invoices._booked(inv);
        return {
            title: 'INVOICE',
            number: inv.invoice_id,
            headLines: [
                'Date: ' + dmy(inv.issue_date || inv.created_date),
                inv.due_date ? 'Due: ' + dmy(inv.due_date) : '',
                inv.reference ? 'Ref: ' + inv.reference : '',
                inv.source_quote_number ? 'Quote: ' + inv.source_quote_number : '',
                booked && inv.sale_number ? 'Sale: ' + inv.sale_number : ''
            ].filter(Boolean),
            stamp: PosnicPro.invoices._stamp(inv),
            afterTotal: booked ? [
                { label: 'Paid', value: PosnicPro.invoices._pdfMoney(inv.paid_amount) },
                { label: 'BALANCE DUE', value: PosnicPro.invoices._pdfMoney(inv.balance), bold: true }
            ] : []
        };
    },
    _withDoc: function (use) {
        var inv = PosnicPro.invoices._current;
        if (!inv) { PosnicPro.alert('warning', 'Open an invoice first.'); return; }
        PosnicPro.lazy.load('jspdf').then(function () {
            var C = (window.jspdf && typeof window.jspdf.jsPDF === 'function') ? window.jspdf.jsPDF
                : (typeof window.jsPDF === 'function') ? window.jsPDF
                : (typeof window.jspdf === 'function') ? window.jspdf : null;
            if (!C) { PosnicPro.alert('error', 'PDF tools not loaded - refresh and retry.'); return; }
            var src = PosnicPro.local.get('branchimage');
            var done = false;
            var go = function (logo) {
                if (done) { return; }
                done = true;
                use(PosnicPro.quotes._buildPdf(C, inv, PosnicPro.quotes._seller(), logo, PosnicPro.invoices._pdfOpts(inv)));
            };
            if (!src || src === 'store.png') { go(null); return; }
            var img = new Image();
            img.onload = function () {
                try {
                    var cv = document.createElement('canvas');
                    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
                    cv.getContext('2d').drawImage(img, 0, 0);
                    go({ data: cv.toDataURL('image/png'), w: img.naturalWidth, h: img.naturalHeight });
                } catch (e) { go(null); }
            };
            img.onerror = function () { go(null); };
            setTimeout(function () { go(null); }, 1500);
            img.src = src;
        });
    },
    printNow: function () {
        PosnicPro.invoices._withDoc(function (doc) {
            if (typeof doc.autoPrint === 'function') { doc.autoPrint(); }
            var url = doc.output('bloburl');
            var w = window.open(url, '_blank');
            if (!w) { PosnicPro.alert('warning', 'Allow pop-ups so the invoice can print.'); }
        });
    },
    print: function () {
        var inv = PosnicPro.invoices._current || {};
        PosnicPro.invoices._withDoc(function (doc) {
            doc.save((inv.invoice_id || 'invoice').toLowerCase() + '.pdf');
        });
    },
    _markSentQuietly: function (inv) {
        if (!inv || !inv._id || inv.status !== 'draft') { return; }
        PosnicPro.post({ url: 'invoices/' + inv._id + '/transition', data: JSON.stringify({ action: 'send' }) },
            function () { inv.status = 'sent'; }, function () { /* the copy still went - status is cosmetic */ });
    },
    emailInvoice: function () {
        var inv = PosnicPro.invoices._current || {};
        PosnicPro.reportExport.email('invoices_view_body', {
            title: 'Invoice ' + (inv.invoice_id || ''),
            filename: (inv.invoice_id || 'invoice').toLowerCase(),
            to: inv.customer_email || '',
            onSent: function () { PosnicPro.invoices._markSentQuietly(inv); }
        }, PosnicPro.invoices._withDoc);
    },
    shareLink: function (then) {
        var inv = PosnicPro.invoices._current;
        if (!inv) { if (then) { then(null); } return; }
        PosnicPro.invoices._withDoc(function (doc) {
            var b64 = String(doc.output('datauristring')).split(',')[1] || '';
            PosnicPro.post({
                url: 'invoices/' + inv._id + '/share',
                data: JSON.stringify({ pdf_base64: b64 })
            }, function (r) {
                if (r.type !== 'success' || !r.data || !r.data.url) {
                    PosnicPro.alert(r.type === 'success' ? 'error' : r.type, r.message || 'Could not create the link');
                    if (then) { then(null); }
                    return;
                }
                inv.share = { url: r.data.url, rev: r.data.rev };
                if (inv.status === 'draft') { inv.status = 'sent'; }
                if (then) { then(r.data.url); return; }
                var url = r.data.url;
                var copied = function () { PosnicPro.alert('success', 'Link copied - paste it anywhere. ' + url); };
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(url).then(copied, function () { window.prompt('Copy the invoice link:', url); });
                } else {
                    window.prompt('Copy the invoice link:', url);
                }
            }, function (xhr) {
                var resp = {}; try { resp = JSON.parse(xhr.responseText); } catch (e) { /* plain */ }
                PosnicPro.alert('warning', resp.message || 'Could not create the link');
                if (then) { then(null); }
            });
        });
    },
    whatsappInvoice: function () {
        var inv = PosnicPro.invoices._current || {};
        var shop = PosnicPro.local.get('branchname') || 'Our shop';
        var openWa = function (msg) { window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank'); };
        var owed = PosnicPro.invoices._booked(inv) ? Number(inv.balance || 0) : Number(inv.total || 0);
        var head = 'Invoice ' + (inv.invoice_id || '') + ' from ' + shop
            + '\nTotal: ' + Number(inv.total || 0).toFixed(2)
            + (inv.status === 'paid' ? '\nPaid - thank you' : '\nBalance due: ' + owed.toFixed(2)
                + (inv.due_date ? ' by ' + new Date(inv.due_date).toLocaleDateString('en-IN') : ''));
        PosnicPro.invoices.shareLink(function (url) {
            if (url) {
                openWa(head + '\n\nView or download the invoice:\n' + url);
                PosnicPro.invoices._markSentQuietly(inv);
                return;
            }
            openWa(head + '\n\nItems:\n' + (inv.items || []).map(function (l) {
                return '- ' + l.item_name + ' x' + l.qty + ' = ' + Number(l.line_total || 0).toFixed(2);
            }).join('\n'));
            PosnicPro.invoices._markSentQuietly(inv);
        });
    },

    /* --------------------------------------------------------- lifecycle -- */
    /* Convert: the invoice lands on the sale screen at ITS prices - a bill is
       a promise like a quote, and it has no validity to lapse. Tender it,
       take a part payment, or flip Unpaid to book it on credit; the sale's
       payment state comes back to the invoice either way. */
    convert: function () {
        var inv = PosnicPro.invoices._current;
        if (!inv) { return; }
        PosnicPro.sales._sourceInvoiceId = String(inv._id);
        var customCount = 0;
        var lines = [];
        (inv.items || []).forEach(function (l) {
            if (l.kind === 'custom' || !l.item_id) { customCount += 1; return; }
            lines.push({
                item_id: String(l.item_id),
                qty: Number(l.qty) || 1,
                unit_price: Number(l.unit_price) || 0,
                dtype: l.discount ? l.discount.type : '',
                dval: l.discount ? Number(l.discount.value) || 0 : 0
            });
        });
        if (!lines.length) {
            PosnicPro.alert('warning', 'This invoice has only custom lines - there is no catalog item to load on a sale.');
            PosnicPro.sales._sourceInvoiceId = null;
            return;
        }
        PosnicPro.sales.loadDocumentIntoCart({
            lines: lines,
            honour: true,
            discount: (inv.discount && inv.discount.computed > 0) ? inv.discount.computed : 0,
            charges: inv.charges || [],
            onSkipped: function (skipped) {
                PosnicPro.sales._sourceInvoiceId = null;
                PosnicPro.alert('warning', skipped + ' of ' + lines.length
                    + ' invoiced items are no longer sellable and were skipped - invoice '
                    + (inv.invoice_id || '') + ' stays open.');
            },
            onLoaded: function (info) {
                var extras = [];
                if (info.chargeCount) { extras.push(info.chargeCount + ' charge(s) on the bill'); }
                if (info.extra > 0) { extras.push('invoice discount applied'); }
                if (customCount) { extras.push(customCount + ' custom line(s) stay on the invoice'); }
                PosnicPro.alert('success', 'Invoice ' + (inv.invoice_id || '') + ' loaded at its invoiced prices.'
                    + (extras.length ? ' ' + extras.join('; ') + '.' : '')
                    + ' Tender it, or switch the payment toggle to Unpaid to book it on credit.');
            }
        });
    },
    markSent: function () {
        var inv = PosnicPro.invoices._current;
        if (!inv) { return; }
        PosnicPro.post({ url: 'invoices/' + inv._id + '/transition', data: JSON.stringify({ action: 'send' }) }, function (r) {
            PosnicPro.alert(r.type, r.message);
            if (r.type === 'success') { PosnicPro.invoices.showDetails(String(inv._id)); }
        });
    },
    /* Re-read the sale: the mirror is written on every sale save, but a
       shop that edited the sale on another till wants to see it now. */
    sync: function () {
        var inv = PosnicPro.invoices._current;
        if (!inv) { return; }
        PosnicPro.post({ url: 'invoices/' + inv._id + '/transition', data: JSON.stringify({ action: 'sync' }) }, function (r) {
            PosnicPro.alert(r.type, r.message);
            if (r.type === 'success') { PosnicPro.invoices.showDetails(String(inv._id)); PosnicPro.invoices.loadSummary(); }
        });
    },
    cancel: function () {
        var inv = PosnicPro.invoices._current;
        if (!inv) { return; }
        var reason = window.prompt('Cancel invoice ' + (inv.invoice_id || '') + '? A short reason is kept on the document (optional).', '');
        if (reason === null) { return; }
        PosnicPro.post({ url: 'invoices/' + inv._id + '/transition', data: JSON.stringify({ action: 'cancel', reason: reason }) }, function (r) {
            PosnicPro.alert(r.type, r.message);
            if (r.type === 'success') { PosnicPro.invoices.showDetails(String(inv._id)); PosnicPro.invoices.loadSummary(); }
        });
    },
    remove: function () {
        var inv = PosnicPro.invoices._current;
        if (!inv) { return; }
        if (!window.confirm('Delete invoice ' + (inv.invoice_id || '') + ' permanently? This cannot be undone.')) { return; }
        PosnicPro.request({ method: 'DELETE', url: 'invoices/' + inv._id, data: '{}' }, function (r) {
            PosnicPro.alert(r.type, r.message);
            if (r.type === 'success') { hasher.setHash('invoices'); PosnicPro.invoices.showDataTablePage(); }
        }, function () { PosnicPro.alert('error', 'Could not delete the invoice'); });
    },
    /* Mark paid: the strip asks how and with what reference, then the sale
       behind the invoice is settled and the document follows. */
    payOpen: function () {
        var inv = PosnicPro.invoices._current;
        if (!inv) { return; }
        $('#ie_pay_amount').html(PosnicPro.invoices._money(inv.balance));
        $('#ie_pay_reference').val('');
        $('#invoices_pay_strip').show();
        $('#ie_pay_reference').focus();
    },
    payClose: function () { $('#invoices_pay_strip').hide(); },
    payConfirm: function () {
        var inv = PosnicPro.invoices._current;
        if (!inv) { return; }
        var $btn = $('#ie_pay_confirm').prop('disabled', true);
        PosnicPro.post({
            url: 'invoices/' + inv._id + '/payment',
            data: JSON.stringify({ method: $('#ie_pay_method').val() || '', reference: $.trim($('#ie_pay_reference').val()) })
        }, function (r) {
            $btn.prop('disabled', false);
            PosnicPro.alert(r.type, r.message);
            if (r.type === 'success') {
                $('#invoices_pay_strip').hide();
                PosnicPro.invoices.showDetails(String(inv._id));
                PosnicPro.invoices.load(true);
                PosnicPro.invoices.loadSummary();
            }
        }, function (xhr) {
            $btn.prop('disabled', false);
            var resp = {}; try { resp = JSON.parse(xhr.responseText); } catch (e) { /* plain */ }
            PosnicPro.alert('error', resp.message || 'Could not record the payment');
        });
    },
    /* From the quote page: the quote's numbers become an invoice, the quote
       is stamped invoiced, and the new document opens. */
    fromQuote: function (quoteId) {
        if (!quoteId) { return; }
        PosnicPro.post({ url: 'invoices/from-quote/' + quoteId, data: '{}' }, function (r) {
            PosnicPro.alert(r.type, r.message);
            if (r.type === 'success' && r.data && r.data.id) { hasher.setHash('invoices/' + r.data.id); }
        }, function (xhr) {
            var resp = {}; try { resp = JSON.parse(xhr.responseText); } catch (e) { /* plain */ }
            PosnicPro.alert('error', resp.message || 'Could not create the invoice');
        });
    },

    /* --------------------------------------------- born on the sale screen -- */
    saveFromSale: function () {
        try {
            var lines = $('#sales_new_items_table tbody tr').map(function () {
                var itemid = $(this).find(':nth-child(9)').text();
                if (!itemid) { return null; }
                return {
                    item_id: $('#addSalesLineItemId_' + itemid).text(),
                    item_name: $('#addSalesLineItemName_' + itemid).text(),
                    barcode_id: $('#addSalesLineItemBarcodeId_' + itemid).text(),
                    qty: parseFloat($('#touchsale_item_qty' + itemid).val()) || 1,
                    unit_price: parseFloat(String($('#addSalesLineItemPrice_' + itemid).text()).replace(/,/g, '')) || 0
                };
            }).get().filter(Boolean);
            if (!lines.length) { PosnicPro.alert('warning', 'Add at least one item, then save the invoice.'); return false; }
            var payload = {
                items: lines,
                customer_id: $('#sales_new_customer_id').val() || '',
                customer_name: $('#sales_new_customer_name').val() || '',
                customer_phone: $('#sales_new_customer_phone').val() || '',
                customer_address: $('#sales_new_customer_address').val() || '',
                customer_gstin: $('#sales_new_customer_gst_number').val() || '',
                total: parseFloat(String($('#grand_total').val() || '').replace(/,/g, '')) || 0
            };
            PosnicPro.post({ url: 'invoices', data: JSON.stringify(payload) }, function (r) {
                if (r.type !== 'success') { PosnicPro.alert(r.type, r.message); return; }
                PosnicPro.alert('success', 'Invoice ' + ((r.data && r.data.invoice_id) || '') + ' saved');
                // the invoice holds the lines now - the cart clears quietly
                PosnicPro.sales.clear.cartItems(false);
                if (r.data && r.data.id) { hasher.setHash('invoices/' + r.data.id + '/edit'); }
            }, function (xhr) {
                var resp = {}; try { resp = JSON.parse(xhr.responseText); } catch (e) { /* plain */ }
                PosnicPro.alert('error', resp.message || 'Could not save the invoice');
            });
        } catch (e) {
            PosnicPro.alert('error', 'Invoice could not be built: ' + e.message);
        }
        return false;
    }
};

/* The shared filter bar, mounted on first use (same rules as quotes). */
PosnicPro.invoices.mountFilters = function () {
    if (PosnicPro.invoices._filterMounted) { return; }
    if (!$('#invoices_filter_panel').length) { return; }
    PosnicPro.listFilter.mount({
        key: 'invoices',
        container: '#invoices_filter_panel',
        button: '#invoices_filter_btn',
        searchPlaceholder: 'Search customer or invoice #',
        dateField: 'Created',
        searchFields: [
            { value: 'all', label: 'All fields' },
            { value: 'invoice_id', label: 'Invoice #' },
            { value: 'customer_name', label: 'Customer' }
        ],
        typeahead: 'customer',
        typeaheadField: 'customer_name',
        onChange: function (params, state) {
            PosnicPro.invoices._paintChips((state.extra && state.extra.status) || '');
            PosnicPro.invoices.load();
        }
    });
    PosnicPro.listSort.mount('invoices', {
        options: [
            { v: 'due_asc', l: 'Due: soonest first', i: 'clock' },
            { v: 'due_desc', l: 'Due: latest first', i: 'calendar' },
            { v: 'balance_desc', l: 'Largest balance first', i: 'arrow-down' },
            { v: 'total_desc', l: 'Highest amount first', i: 'arrow-down' },
            { v: 'total_asc', l: 'Lowest amount first', i: 'arrow-up' }
        ],
        onChange: function () { PosnicPro.invoices.load(); }
    });
    PosnicPro.invoices._filterMounted = true;
};
PosnicPro.invoices._paintChips = function (status) {
    PosnicPro.invoices._status = status || '';
    var lit = $('.invoices-chip').filter(function () {
        return String($(this).data('status') || '') === String(status || '');
    }).first();
    $('#invoices_status_dd').text(lit.length ? $.trim(lit.text()) : 'All');
};

$(document).on('click', '#invoices_filter_btn', function () {
    PosnicPro.invoices.mountFilters();
    PosnicPro.listFilter.toggle('invoices');
});
$(document).on('click', '.invoices-row', function () {
    hasher.setHash('invoices/' + $(this).data('id'));
});
$(document).on('click', '#invoices_view_close', function () {
    hasher.setHash('invoices');
    PosnicPro.invoices.showDataTablePage();
});
$(document).on('input', '#invoices_view_body .q-edit', function () {
    $('#inv_save_edits').show();
});
$(document).on('click', '#invoices_rail_toggle', function () {
    $('#invoices_new .contentbar').toggleClass('rail-collapsed');
});
$(document).on('click', '.invoices-chip', function () {
    PosnicPro.invoices.mountFilters();
    PosnicPro.listFilter.setExtra('invoices', 'status', $(this).data('status') || '');
});
$(document).on('click', '#ie_pay_confirm', function () { PosnicPro.invoices.payConfirm(); });
$(document).on('click', '#ie_pay_cancel', function () { PosnicPro.invoices.payClose(); });

/* ---- Invoice editor wiring: state follows every keystroke ---- */
$(document).on('input change', '#ie_lines input, #ie_lines select', function () {
    var i = $(this).closest('tr').data('i');
    var ed = PosnicPro.invoices._ed;
    if (!ed || !ed.lines[i]) { return; }
    var l = ed.lines[i];
    var $t = $(this);
    if ($t.hasClass('qe-l-name')) { l.item_name = $t.val(); }
    else if ($t.hasClass('qe-l-desc')) { l.description = $t.val(); }
    else if ($t.hasClass('qe-l-qty')) { l.qty = $t.val(); }
    else if ($t.hasClass('qe-l-price')) { l.unit_price = $t.val(); }
    else if ($t.hasClass('qe-l-dtype')) { l.dtype = $t.val(); }
    else if ($t.hasClass('qe-l-dval')) { l.dval = $t.val(); }
    PosnicPro.invoices.edRecalc();
});
$(document).on('change', '#ie_lines .qe-l-taxsel', function () {
    var i = $(this).closest('tr').data('i');
    var ed = PosnicPro.invoices._ed;
    if (!ed || !ed.lines[i]) { return; }
    var $opt = $(this).find('option:selected');
    ed.lines[i].tax_value = Number($opt.val()) || 0;
    ed.lines[i].tax_name = $opt.data('name') || '';
    if (!ed.lines[i].tax_type) { ed.lines[i].tax_type = 'inclusive'; }
    if (!(Number($opt.val()) > 0)) { ed.lines[i].tax_type = ''; }
    PosnicPro.invoices.edRender();
});
$(document).on('click', '#ie_lines .qe-l-taxflip', function () {
    var i = $(this).closest('tr').data('i');
    var ed = PosnicPro.invoices._ed;
    if (!ed || !ed.lines[i]) { return; }
    ed.lines[i].tax_type = ed.lines[i].tax_type === 'exclusive' ? 'inclusive' : 'exclusive';
    PosnicPro.invoices.edRender();
});
$(document).on('click', '#ie_lines .qe-l-del', function () {
    var i = $(this).closest('tr').data('i');
    if (PosnicPro.invoices._ed) { PosnicPro.invoices._ed.lines.splice(i, 1); PosnicPro.invoices.edRender(); }
});
$(document).on('input change', '#ie_charges input, #ie_charges select', function () {
    var i = $(this).closest('.qe-charge').data('i');
    var ed = PosnicPro.invoices._ed;
    if (!ed || !ed.charges[i]) { return; }
    var c = ed.charges[i];
    var $t = $(this);
    if ($t.hasClass('qe-c-name')) { c.name = $t.val(); }
    else if ($t.hasClass('qe-c-type')) { c.type = $t.val(); }
    else if ($t.hasClass('qe-c-val')) { c.value = $t.val(); }
    else if ($t.hasClass('qe-c-sign')) { c.sign = Number($t.val()); }
    PosnicPro.invoices.edRecalc();
});
$(document).on('click', '#ie_charges .qe-c-del', function () {
    var i = $(this).closest('.qe-charge').data('i');
    if (PosnicPro.invoices._ed) { PosnicPro.invoices._ed.charges.splice(i, 1); PosnicPro.invoices.edRender(); }
});
$(document).on('click', '.ie-due-chip', function () {
    var days = Number($(this).data('days')) || 0;
    var dt = new Date(Date.now() + days * 86400000);
    $('#ie_due_date').val(dt.toISOString().slice(0, 10));
    $('.ie-due-chip').removeClass('btn-primary').addClass('btn-secondary-rgba');
    $(this).removeClass('btn-secondary-rgba').addClass('btn-primary');
    PosnicPro.invoices.edRecalc();
});
$(document).on('input', '#ie_due_date', function () {
    $('.ie-due-chip').removeClass('btn-primary').addClass('btn-secondary-rgba');
});
$(document).on('input change', '#ie_disc_type, #ie_disc_value, #ie_cust_name, #ie_cust_phone, #ie_cust_email, #ie_cust_gstin, #ie_cust_address, #ie_payment, #ie_bank, #ie_terms, #ie_notes, #ie_due_date, #ie_reference', function () {
    PosnicPro.invoices.edRecalc();
});
$(function () {
    if ($.fn.autocomplete) {
        $('#ie_item_search').autocomplete({
            deferRequestBy: 120,
            lookup: function (query, done) {
                PosnicPro.get({ url: 'items/getOnlineItemsAjaxList', data: 'query=' + query + '&type=normal' }, function (response) {
                    var suggestions = [];
                    ((response && response.suggestions) || []).forEach(function (d) {
                        suggestions.push({ value: d.item_name || d.value || '', data: d });
                    });
                    done({ suggestions: suggestions });
                });
            },
            onSelect: function (s2) {
                $('#ie_item_search').val('');
                var d = s2.data || {};
                var id = d.item_id || d.id;
                if (id) { PosnicPro.invoices.edAddItem(String(id), d.item_name || d.name || s2.value || ''); }
            },
            autoSelectFirst: true,
            triggerSelectOnValidInput: false
        });
        $('#ie_cust_search').autocomplete({
            deferRequestBy: 120,
            lookup: function (query, done) {
                PosnicPro.get({ url: 'customers/getCustomersAjaxList', data: 'query=' + query }, function (response) {
                    var suggestions = [];
                    ((response && response.suggestions) || []).forEach(function (d) {
                        suggestions.push({ value: d.name || '', data: d });
                    });
                    done({ suggestions: suggestions });
                });
            },
            onSelect: function (s2) {
                var d = s2.data || {};
                $('#ie_cust_search').val('');
                if (PosnicPro.invoices._ed) { PosnicPro.invoices._ed.customer_id = String(d.id || ''); }
                $('#ie_cust_name').val(d.name || '');
                $('#ie_cust_phone').val(d.phone || '');
                $('#ie_cust_email').val(d.email || '');
                $('#ie_cust_gstin').val(d.gst_number || '');
                $('#ie_cust_address').val(d.address || '');
                PosnicPro.invoices.edRecalc();
            },
            autoSelectFirst: true,
            triggerSelectOnValidInput: false
        });
    }
    /* The Save-as-invoice button on the sale screen follows its feature
       switch, live - the same gate the quote button uses. */
    var applyInvoicesGate = function () {
        var on = PosnicPro.invoices._on();
        var $wrap = $('#saveInvoiceButton').closest('span[data-toggle="tooltip"]');
        try { $wrap.tooltip('hide'); } catch (e) { /* tooltip not initialised */ }
        ($wrap.length ? $wrap : $('#saveInvoiceButton')).toggle(on);
        $('#saveInvoiceButton').toggle(on);
    };
    applyInvoicesGate();
    $(window).on('hashchange storage', applyInvoicesGate);
});
