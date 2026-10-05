(function () {
    'use strict';
    const P = PosnicPro;
    const esc = value => P.escapeHtml(String(value ?? ''));
    const branch = () => P.local.get('branch_id_set');
    const messages = [
        { label: 'Order details', t: 'lang_kot_workspace_details' },
        { label: 'Kitchen note', t: 'lang_kot_workspace_note' },
        { label: 'Seat', t: 'lang_kot_workspace_seat' },
        { label: 'Course', t: 'lang_kot_workspace_course' },
        { label: 'Allergy note', t: 'lang_kot_workspace_allergy' },
        { label: 'Hold for later', t: 'lang_kot_workspace_hold' },
        { label: 'Move table', t: 'lang_kot_workspace_move' },
        { label: 'Choose a destination table', t: 'lang_kot_workspace_destination' },
        { label: 'Number of guests', t: 'lang_kot_workspace_covers' },
        { label: 'Guests', t: 'lang_kot_workspace_guests' },
        { label: 'Hand over order', t: 'lang_kot_workspace_handover' },
        { label: 'Split payment', t: 'lang_splitpay_title' },
        { label: 'Review payment', t: 'lang_kot_workspace_review' },
        { label: 'Split by', t: 'lang_kot_workspace_split_by' },
        { label: 'Equal shares', t: 'lang_kot_workspace_equal' },
        { label: 'Share equally', t: 'lang_kot_workspace_share' },
        { label: 'Collect payment', t: 'lang_captain_collect_payment' },
        { label: 'Kitchen progress', t: 'lang_kot_workspace_progress' },
        { label: 'Served', t: 'lang_kot_workspace_served' },
        { label: 'Send to kitchen', t: 'lang_kot_workspace_send' },
        { label: 'Mark served', t: 'lang_kot_workspace_serve' },
        { label: 'Please retry', t: 'lang_kot_workspace_retry' },
        { label: 'Merge tables', t: 'lang_kot_workspace_merge' },
        { label: 'Transfer items', t: 'lang_kot_workspace_transfer' },
        { label: 'Remaining on this order', t: 'lang_kot_workspace_remaining' },
        { label: 'Transfer total', t: 'lang_kot_workspace_transfer_total' },
        { label: 'Confirm transfer', t: 'lang_kot_workspace_transfer_confirm' },
        { label: 'Review transfer', t: 'lang_kot_workspace_transfer_review' },
        { label: 'Served quantity to transfer', t: 'lang_kot_workspace_transfer_served' },
        { label: 'Retry the saved transfer to confirm its result', t: 'lang_kot_workspace_transfer_retry' },
        { label: 'Permission is required', t: 'lang_permission_is_required' }
    ];
    const text = label => P.i18n.t(messages.find(m => m.label === label)?.t || 'lang_' + label.toLowerCase().replace(/[^a-z0-9]+/g, '_'), label);
    const requestId = () => crypto.randomUUID();
    function request(method, url, data) {
        return new Promise((resolve, reject) => P[method]({ url,
            data: method === 'get' ? data : JSON.stringify(data), processData: method === 'get'
        }, result => {
            if (result.type === 'error' || result.error) reject(new Error(result.message || result.error.message));
            else resolve(result.type === 'success' ? result.data : result);
        }, error => reject(new Error(error?.responseJSON?.error?.message || error?.responseJSON?.message || text('Please retry')))));
    }
    function refresh() {
        if (document.getElementById("kot_v2")?.offsetParent && P.kot_v2) { P.kot_v2.refresh().catch(e => P.alert("error", e.message)); return; }
        if (P.kot.currentTableNumber) P.kot.loadTableDetails(P.kot.currentTableNumber, true);
        P.kot.loadTables(null, true);
    }
    function button(label, action, className) {
        return $('<button type="button"></button>').addClass('btn btn-sm ' + (className || 'btn-outline-primary'))
            .text(text(label)).on('click', action);
    }
    async function run(control, action) {
        if (control.disabled) return;
        control.disabled = true;
        try { await action(); } catch (error) { P.alert('error', error.message); }
        finally { control.disabled = false; }
    }
    function dialog(title) {
        const el = document.createElement('dialog');
        el.className = 'kot-workspace-dialog';
        el.innerHTML = '<form><header><h3></h3><button type="button" data-close aria-label="Close" data-t-aria-label="lang_close_title">×</button></header><section></section><p role="alert"></p><footer><button type="button" data-close></button><button type="submit" class="primary"></button></footer></form>';
        el.querySelector('h3').textContent = text(title);
        el.querySelector('footer [data-close]').textContent = text('Cancel');
        el.querySelector('[type=submit]').textContent = text('Save');
        el.querySelectorAll('[data-close]').forEach(b => b.onclick = () => el.close());
        el.addEventListener('close', () => el.remove());
        document.body.append(el);
        el.showModal();
        el.save = action => el.querySelector('form').onsubmit = async event => {
            event.preventDefault();
            if (!el.querySelector('form').reportValidity()) return;
            const submit = el.querySelector('[type=submit]');
            if (submit.disabled) return;
            submit.disabled = true;
            el.querySelector('[role=alert]').textContent = '';
            try { await action(new FormData(el.querySelector('form'))); el.close(); }
            catch (error) { el.querySelector('[role=alert]').textContent = error.message; }
            finally { submit.disabled = false; }
        };
        return el;
    }
    const field = (label, name, value, attrs = '') => '<label>' + esc(text(label)) + '<input name="' + name + '" value="' + esc(value) + '" ' + attrs + '></label>';
    const area = (label, name, value, max = 500) => '<label>' + esc(text(label)) + '<textarea name="' + name + '" maxlength="' + max + '">' + esc(value) + '</textarea></label>';
    function editPayload(sale, items) {
        return { order_id: sale._id || sale.id, items,
            seen_at: sale.updated_date || sale.created_date,
            extra_discount_type: sale.extra_discount_type || 'amount',
            extra_discount: sale.extra_discount || 0,
            discount_description: sale.discount_description || '' };
    }
    async function notes(saleId) {
        const sale = await request('get', 'sales/' + saleId);
        const d = dialog('Order details');
        d.querySelector('section').innerHTML = area('Kitchen note', 'note', sale.preparation_note || '') +
            sale.items.map((line, i) => '<fieldset><legend>' + esc(line.item_name) + '</legend>' +
                area('Item note', 'note' + i, line.item_description || '') + '<div class="fields">' +
                field('Seat', 'seat' + i, line.seat || 0, 'type="number" min="0" max="99" step="1"') +
                field('Course', 'course' + i, line.course || '', 'maxlength="40"') + '</div>' +
                area('Allergy note', 'allergy' + i, line.allergy_note || '', 200) +
                '<label class="check"><input type="checkbox" name="held' + i + '" ' + (line.held ? 'checked' : '') + '> ' + esc(text('Hold for later')) + '</label></fieldset>').join('');
        d.save(async form => {
            const items = sale.items.map((line, i) => Object.assign(P.kot.editLine(line), {
                item_description: form.get('note' + i), seat: Number(form.get('seat' + i)),
                course: form.get('course' + i), allergy_note: form.get('allergy' + i), held: form.has('held' + i)
            }));
            await request('put', 'sales/updateOrder', { ...editPayload(sale, items), preparation_note: form.get('note') });
            if (P.kotPrint) P.kotPrint.afterSave(saleId);
            refresh();
        });
    }
    async function move(saleId, merge = false) {
        const [sale, floor] = await Promise.all([request('get', 'sales/' + saleId), request('get', 'captain/v1/tables', { branchId: branch() })]);
        if (merge && !floor.canMerge) throw new Error(text('Permission is required'));
        const d = dialog(merge ? PosnicPro.i18n.t('lang_kot_workspace_merge', 'Merge tables') : PosnicPro.i18n.t('lang_kot_workspace_move', 'Move table'));
        d.querySelector('section').innerHTML = '<p>' + esc(text('Choose a destination table')) + '</p><label>' + esc(text('Table')) + '<select name="table" required><option value="">—</option>' +
            floor.tables.filter(t => merge ? t.orders?.length === 1 && !t.orders[0].paid && t.orders[0].id !== saleId : t.status === 'available').map(t => '<option value="' + esc(t.id) + '">' + esc(t.tableorder_value) + '</option>').join('') + '</select></label>';
        // Retain the same request on a network retry; never issue a second move.
        const key = 'posnic.kot.' + (merge ? 'merge:' : 'move:') + location.origin + ':' + branch() + ':' + saleId;
        let intent;
        try { intent = JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { throw new Error(text('Please retry')); }
        const id = intent?.request_id || requestId();
        if (intent) {
            const select = d.querySelector('select');
            if (![...select.options].some(o => o.value === intent.primaryId)) select.add(new Option(intent.primaryId, intent.primaryId));
            select.value = intent.primaryId;
            select.disabled = true;
        }
        let prepared = false;
        d.save(async form => {
            if (!prepared) {
                intent = intent || { branchId: branch(), orderId: saleId,
                    request_id: id, tableIds: [form.get('table')], primaryId: form.get('table'),
                    guests: sale.person_count, dineType: sale.dine_type || 'Dine-in',
                    ...(merge ? { targetOrderId: floor.tables.find(t => t.id === form.get('table'))?.orders[0]?.id } : {}) };
                localStorage.setItem(key, JSON.stringify(intent));
                d.querySelector('select').disabled = true;
                await request('post', merge ? 'captain/v1/tables/merge/prepare' : 'captain/v1/tables/move/prepare', intent);
                prepared = true;
            }
            await request('post', 'captain/v1/tables/move/complete', { branchId: branch(), request_id: id });
            localStorage.removeItem(key);
            refresh();
        });
        // Release a prepared reservation on explicit cancellation, using the same operation.
        d.querySelectorAll('[data-close]').forEach(b => b.onclick = async () => {
            try {
                if (!intent) { d.close(); return; }
                await request('post', 'captain/v1/tables/move/cancel', { branchId: branch(), request_id: id, orderId: saleId });
                localStorage.removeItem(key);
                d.close(); refresh();
            } catch (error) { d.querySelector('[role=alert]').textContent = error.message; }
        });
        d.addEventListener('cancel', event => { event.preventDefault(); d.querySelector('[data-close]').click(); });
    }
    async function covers(saleId) {
        const sale = await request('get', 'sales/' + saleId);
        const d = dialog('Number of guests');
        d.querySelector('section').innerHTML = field('Guests', 'guests', sale.person_count, 'type="number" min="1" max="1000" required step="1"');
        const id = requestId();
        d.save(async form => {
            await request('post', 'captain/v1/tables/guests', { branchId: branch(), orderId: saleId, request_id: id, guests: Number(form.get('guests')) });
            refresh();
        });
    }
    async function transfer(saleId) {
        const [sale, floor] = await Promise.all([request('get', 'sales/' + saleId), request('get', 'captain/v1/tables', { branchId: branch() })]);
        if (!floor.canMerge) throw new Error(text('Permission is required'));
        const lines = sale.restaurant_details?.rounds?.flatMap(r => r.items) || [];
        const key = 'posnic.kot.transfer:' + location.origin + ':' + branch() + ':' + saleId;
        let intent = JSON.parse(localStorage.getItem(key) || 'null');
        let preview = null;
        const d = dialog('Transfer items');
        const section = d.querySelector('section');
        const submit = d.querySelector('[type=submit]');
        function review(value) {
            const money = n => value.currencySymbol + (n / Math.pow(10, value.currencyDigits)).toFixed(value.currencyDigits);
            section.innerHTML = '<p>' + esc(text('Remaining on this order')) + ': <strong>' + esc(money(value.source.totalMinor)) + '</strong></p><p>' + esc(text('Transfer total')) + ': <strong>' + esc(money(value.destination.totalMinor)) + '</strong></p>';
            submit.textContent = text('Confirm transfer');
        }
        if (intent) {
            section.textContent = text('Retry the saved transfer to confirm its result');
            submit.textContent = text('Retry');
        } else {
            submit.textContent = text('Review transfer');
            section.innerHTML = '<label>' + esc(text('Table')) + '<select name="table" required><option value="">—</option>' + floor.tables.filter(t => t.status === 'available').map(t => '<option value="' + esc(t.id) + '">' + esc(t.tableorder_value) + '</option>').join('') + '</select></label>' +
                field('Guests', 'guests', 1, 'type="number" min="1" max="1000" step="1" required') +
                lines.map((line, i) => '<fieldset><legend>' + esc(line.name) + '</legend><p>' + esc(line.quantity + ' · ' + line.served + ' ' + text('Served')) + '</p>' +
                    field('Quantity', 'qty' + i, 0, 'type="number" min="0" max="' + line.quantity + '" step="0.001" required') +
                    (line.served ? field('Served quantity to transfer', 'served' + i, 0, 'type="number" min="0" max="' + line.served + '" step="0.001" required') : '') + '</fieldset>').join('');
        }
        // Preview is read-only. The complete request is persisted before the first
        // commit so a lost response cannot cause a second stock/billing operation.
        d.querySelector('form').onsubmit = async event => {
            event.preventDefault();
            if (submit.disabled || !d.querySelector('form').reportValidity()) return;
            submit.disabled = true;
            try {
                if (!intent) {
                    const form = new FormData(d.querySelector('form'));
                    const items = lines.map((line, i) => ({ id: line.id, quantity: Number(form.get('qty' + i)), servedQuantity: Number(form.get('served' + i) || 0) })).filter(l => l.quantity > 0);
                    preview = await request('post', 'captain/v1/tables/transfer/preview', { branchId: branch(), orderId: saleId, items });
                    intent = { branchId: branch(), orderId: saleId, requestId: requestId(), revision: preview.revision, items,
                        destination: { tableIds: [form.get('table')], primaryId: form.get('table'), guests: Number(form.get('guests')) } };
                    review(preview);
                } else {
                    localStorage.setItem(key, JSON.stringify(intent));
                    await request('post', 'captain/v1/tables/transfer/complete', intent);
                    localStorage.removeItem(key);
                    d.close(); refresh();
                }
            } catch (error) { d.querySelector('[role=alert]').textContent = error.message; }
            finally { submit.disabled = false; }
        };
    }
    async function handover(saleId) {
        const staff = await request('get', 'sales/handoverStaff', { branchId: branch() });
        const d = dialog('Hand over order');
        d.querySelector('section').innerHTML = '<label>' + esc(text('Staff')) + '<select name="staff" required>' + staff.map(s => '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>').join('') + '</select></label>';
        const id = requestId();
        d.save(async form => { await request('post', 'sales/handoverOrder', { branchId: branch(), saleId, staffId: form.get('staff'), requestId: id }); refresh(); });
    }
    async function split(table) {
        const snapshot = await request('get', 'sales/guestBills/table', { branchId: branch(), ...(table.startsWith('takeaway:') ? {saleId:table.slice(9)} : {table_number:table}) });
        const d = dialog('Split payment');
        d.querySelector('[type=submit]').textContent = text('Review payment');
        d.querySelector('section').innerHTML = field('Guests', 'guests', snapshot.guests, 'type="number" min="2" max="20" step="1" required') +
            '<label>' + esc(text('Split by')) + '<select name="mode"><option value="equal">' + esc(text('Equal shares')) + '</option><option value="items">' + esc(text('Items')) + '</option></select></label><div data-allocations></div>';
        function allocations() {
            const count = Number(d.querySelector('[name=guests]').value);
            const byItem = d.querySelector('[name=mode]').value === 'items';
            d.querySelector('[data-allocations]').innerHTML = !byItem || count < 2 || count > 20 ? '' : snapshot.lines.map((line, i) =>
                '<label>' + esc(line.quantity + ' × ' + line.name) + '<select name="line' + i + '"><option value="all">' + esc(text('Share equally')) + '</option>' + Array.from({ length: count }, (_, g) => '<option value="' + g + '">' + esc(text('Guest') + ' ' + (g + 1)) + '</option>').join('') + '</select></label>').join('');
        }
        d.querySelector('[name=guests]').onchange = allocations;
        d.querySelector('[name=mode]').onchange = allocations;
        d.save(async form => {
            const count = Number(form.get('guests'));
            const plan = { mode: form.get('mode'), guests: Array.from({ length: count }, (_, i) => text('Guest') + ' ' + (i + 1)), allocations: {} };
            snapshot.lines.forEach((line, i) => { plan.allocations[line.id] = plan.guests.map((_, g) => form.get('line' + i) === 'all' || Number(form.get('line' + i)) === g ? 1 : 0); });
            await CaptainPayments.open(table, branch(), { revision: snapshot.revision, plan });
        });
    }
    function mount(sale) {
        const id = String(sale._id || sale.id);
        const anchor = $('#kot_table_details .kot-modify-btn').filter(function () { return String($(this).attr('data-sale-id')) === id; }).closest('.kot-item');
        if (!anchor.length) return;
        anchor.find('.kot-workspace-tools').remove();
        const tools = $('<section class="kot-workspace-tools"></section>');
        const actions = $('<div class="kot-workspace-actions"></div>');
        const add = (label, fn) => actions.append(button(label, function () { run(this, fn); }));
        add('Order details', () => notes(id));
        if (sale.dine_type === 'Dine-in' && sale.table_number) {
            add('Move table', () => move(id));
            add('Merge tables', () => move(id, true));
            add('Transfer items', () => transfer(id));
            add('Number of guests', () => covers(id));
        }
        add('Hand over order', () => handover(id));
        if (window.CaptainPayments && sale.table_number) CaptainPayments.available().then(enabled => {
            if (enabled && tools[0].isConnected) {
                add('Split payment', () => split(sale.table_number));
                add('Collect payment', () => CaptainPayments.open(sale.table_number, branch()));
            }
        });
        tools.append(actions);
        const details = sale.restaurant_details;
        if (details?.preparation_note) tools.append($('<p class="kot-workspace-note"></p>').text(details.preparation_note));
        if (details?.rounds) {
            const kitchen = $('<details class="kot-workspace-kitchen" open></details>').append($('<summary></summary>').text(text('Kitchen progress')));
            details.rounds.forEach((round, index) => {
                const group = $('<div class="kot-workspace-round"></div>');
                const at = round.fired_at || round.ordered_at;
                group.append($('<h6></h6>').text('KOT ' + (index + 1) + (at ? ' · ' + new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '')));
                round.items.forEach(line => {
                    const row = $('<div class="kot-workspace-line"></div>');
                    const label = $('<div></div>').append($('<strong></strong>').text(line.quantity + ' × ' + line.name));
                    label.append($('<small></small>').text([line.note, line.course, line.seat ? text('Seat') + ' ' + line.seat : '', line.allergy_note].filter(Boolean).join(' · ')));
                    row.append(label, $('<span></span>').text(line.served + '/' + line.quantity + ' ' + text('Served')));
                    if (line.remaining > 0) row.append(button(line.held ? PosnicPro.i18n.t('lang_kot_workspace_send', 'Send to kitchen') : PosnicPro.i18n.t('lang_kot_workspace_serve', 'Mark served'), function () {
                        run(this, async () => {
                            await request('post', line.held ? 'sales/fireKitchenItems' : 'sales/serveKitchenItems', {
                                saleId: id, branchId: branch(), requestId: requestId(),
                                items: line.held ? [line.id] : [{ id: line.id, quantity: line.quantity }]
                            }); refresh();
                        });
                    }));
                    group.append(row);
                });
                kitchen.append(group);
            });
            tools.append(kitchen);
            const remaining = details.rounds.flatMap(r => r.items).filter(l => !l.held).reduce((n, l) => n + l.remaining, 0);
            anchor.find('.kot-serve-all').prop('disabled', remaining === 0);
        }
        anchor.append(tools);
    }
    const style = document.createElement('style');
    style.textContent = '.kot-workspace-tools{padding:16px;background:#f6f8fc;border:1px solid #e1e7f0;border-radius:12px;margin:12px 15px}.kot-workspace-actions{display:flex;flex-wrap:wrap;gap:8px}.kot-workspace-kitchen{margin-top:16px}.kot-workspace-kitchen summary{cursor:pointer;font-weight:600}.kot-workspace-round{padding-top:14px}.kot-workspace-line{display:flex;align-items:center;gap:16px;padding:12px 0;border-top:1px solid #e1e7f0}.kot-workspace-line>div{flex:1;min-width:0}.kot-workspace-line small{display:block;overflow-wrap:anywhere}.kot-workspace-dialog{width:min(640px,94vw);max-height:90vh;border:1px solid #dce3ed;border-radius:16px;padding:0;color:#17314f;background:#fff;box-shadow:0 24px 80px #10203c33}.kot-workspace-dialog::backdrop{background:#14243866}.kot-workspace-dialog form{display:flex;flex-direction:column;max-height:88vh}.kot-workspace-dialog header,.kot-workspace-dialog footer{display:flex;gap:12px;align-items:center;padding:18px 24px;border-bottom:1px solid #e1e7f0}.kot-workspace-dialog h3{flex:1;margin:0;font-size:20px}.kot-workspace-dialog section{padding:20px 24px;overflow:auto}.kot-workspace-dialog label{display:block;margin:0 0 16px}.kot-workspace-dialog input:not([type=checkbox]),.kot-workspace-dialog textarea,.kot-workspace-dialog select{display:block;width:100%;min-height:42px;padding:10px;border:1px solid #c7d3e3;border-radius:8px;margin-top:6px;color:inherit;background:#fff;font:inherit}.kot-workspace-dialog input:focus,.kot-workspace-dialog textarea:focus,.kot-workspace-dialog select:focus{outline:2px solid #0969da;outline-offset:2px}.kot-workspace-dialog button{min-height:40px;border:1px solid #ccd7e6;border-radius:8px;padding:8px 16px;background:#fff;color:inherit;cursor:pointer}.kot-workspace-dialog .primary{background:#0969da;color:#fff;border-color:#0969da}.kot-workspace-dialog footer{justify-content:flex-end;border-top:1px solid #e1e7f0}.kot-workspace-dialog fieldset{border:1px solid #e1e7f0;border-radius:10px;padding:16px;margin:16px 0}.kot-workspace-dialog legend{font-size:16px;width:auto;padding:0 8px}.kot-workspace-dialog .fields{display:grid;grid-template-columns:1fr 2fr;gap:16px}.kot-workspace-dialog [role=alert]{color:#b42318;margin:0;padding:0 24px}.kot-workspace-dialog .check{display:flex;gap:8px;align-items:center}#kot_details_panel{min-width:0}#kot_tables_grid>*{min-width:0}#kot_table_details .btn-group{flex-wrap:wrap}#kot_table_details .kot-item table{table-layout:auto}@media(max-width:767px){.kot-workspace-line{flex-wrap:wrap}.kot-workspace-line>div{flex-basis:100%}}';
    document.head.append(style);
    const layout = document.createElement('style');
    layout.textContent = '#kot_tables_grid .kot-table-box{aspect-ratio:auto!important;min-height:74px!important;margin-bottom:0!important}#kot_tables_grid .kot-table-box h2{font-size:26px!important;color:#125b42!important}#kot_table_details .kot-item>div>div:last-child{flex-wrap:wrap;gap:12px}#kot_table_details .kot-item .btn{min-height:38px}#infobar-settings-sidebar-table-selection.sidebarview,#infobar-settings-sidebar-table-selection.sidebarshow{width:min(1040px,100vw)}#infobar-settings-sidebar-table-selection .contentbar-new{padding:24px}#infobar-settings-sidebar-table-selection .card{border-radius:14px;box-shadow:none}#infobar-settings-sidebar-table-selection .card-header{background:transparent;text-align:left!important}#infobar-settings-sidebar-table-selection .table_select{height:64px!important;border-width:1px!important}#infobar-settings-sidebar-table-selection .table_select>div{border:0!important}#infobar-settings-sidebar-table-selection .person_select{height:56px!important;flex-direction:row!important;gap:8px}#infobar-settings-sidebar-table-selection .person_select>div{display:none}#infobar-settings-sidebar-table-selection #custom_table_input,#infobar-settings-sidebar-table-selection #kot_custom_person_input{height:56px!important}#infobar-settings-sidebar-table-selection #kot_order_next_btn{background:#0869da;color:#fff;border-color:#0869da;min-height:44px}@media(max-width:767px){#kot_tables_grid{grid-template-columns:repeat(4,minmax(0,1fr))!important}#infobar-settings-sidebar-table-selection .contentbar-new{padding:12px}}';
    document.head.append(layout);
    P.kotWorkspace = { mount, notes, move, covers, handover, split, transfer, editPayload };
    window.addEventListener('captain:payment-recorded', refresh);
})();
