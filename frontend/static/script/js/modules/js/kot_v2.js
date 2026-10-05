/* Separate restaurant workspace. All writes use the existing scoped order services. */
(function () {
    'use strict';
    const P = PosnicPro,
        esc = (v) => P.escapeHtml(String(v ?? ''));
    const branch = () => P.local.get('branch_id_set');
    const enabled = () =>
        ['enable', 'true', '1', 'enabled'].includes(String(P.local.get('table_options')).toLowerCase());
    let activeScope = '';
    const state = {
        floor: [],
        sales: [],
        selected: null,
        sale: null,
        filter: 'active',
        tab: 'order',
        pending: false,
        draft: null,
        search: [],
        catalogue: [],
        categories: [],
        category: "",
        catalogueLoaded: false,
        busy: false,
        generation: 0,
    };
    const money = (v) =>
        (P.local.get('currencySign') || '') +
        Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const paymentTable = (s) =>
        /^take[\s_-]*away$/i.test(s.dine_type) ? 'takeaway:' + s._id : s.table_number;
    const time = (v) =>
        v && Number.isFinite(Date.parse(v))
            ? new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : '';
    const id = () => crypto.randomUUID();
    const root = () => document.getElementById('kot_v2');
    function requestError(response) {
        const error = new Error(response?.message || response?.error?.message || 'Connection failed. Your draft is retained.');
        error.details = response?.data || response?.error?.details || {};
        return error;
    }
    function api(method, url, data) {
        if (activeScope && activeScope !== scopeKey())
            return Promise.reject(
                new Error('Branch or user changed. Reopen Table orders before continuing.'),
            );
        return new Promise((resolve, reject) =>
            P[method](
                { url, data: method === 'get' ? data : JSON.stringify(data), processData: method === 'get' },
                (r) => {
                    if (activeScope && activeScope !== scopeKey()) {
                        reject(new Error('Branch or user changed. Reopen Table orders before continuing.'));
                        return;
                    }
                    if (r?.type === 'error' || r?.error || r?.status === false)
                        reject(requestError(r));
                    else resolve(r?.type === 'success' ? r.data : r);
                },
                (e) =>
                    reject(
                        requestError(e?.responseJSON),
                    ),
            ),
        );
    }
    function notify(message) {
        P.alert('info', message);
    }
    const templates = (values, name) =>
        '<div class="kv2-templates">' +
        values
            .map(
                (v) =>
                    '<button type="button" data-template="' +
                    esc(v) +
                    '" data-field="' +
                    name +
                    '">' +
                    esc(v) +
                    '</button>',
            )
            .join('') +
        '</div>';
    const button = (label, action, extra = '') =>
        `<button type="button" data-action="${action}" ${extra}>${esc(label)}</button>`;
    function scopeKey() {
        return 'posnic.kot-v2.draft:' + location.origin + ':' + branch() + ':' + P.local.get('username');
    }
    function persist() {
        if (state.draft) localStorage.setItem(scopeKey(), JSON.stringify(state.draft));
        else localStorage.removeItem(scopeKey());
    }
    async function run(fn) {
        if (state.busy) return;
        state.busy = true;
        try {
            await fn();
        } catch (e) {
            P.alert('error', e.message);
        } finally {
            state.busy = false;
        }
    }
    let refreshFeedback = '', refreshFeedbackTimer;
    function paintRefreshFeedback() {
        const control = root()?.querySelector('[data-action="refresh"]');
        if (!control) return;
        const loading = refreshFeedback === 'loading';
        const label = loading ? PosnicPro.i18n.t('lang_refreshing', 'Refreshing…') : refreshFeedback === 'success' ? PosnicPro.i18n.t('lang_orders_updated', 'Orders updated') : refreshFeedback === 'error' ? PosnicPro.i18n.t('lang_refresh_failed_try_again', 'Refresh failed. Try again.') : PosnicPro.i18n.t('lang_refresh_orders', 'Refresh orders');
        control.dataset.feedback = refreshFeedback;
        control.disabled = loading;
        control.setAttribute('aria-busy', String(loading));
        control.setAttribute('aria-label', label);
        control.title = label;
        control.innerHTML = refreshFeedback === 'success' ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>' : icon('refresh');
        let status = root().querySelector('.kv2-refresh-status');
        if (!status) {
            status = document.createElement('span');
            status.className = 'kv2-refresh-status';
            status.setAttribute('role', 'status');
            root().querySelector('.kv2-heading').append(status);
        }
        status.textContent = refreshFeedback ? label : '';
    }
    async function refreshFromButton() {
        clearTimeout(refreshFeedbackTimer);
        refreshFeedback = 'loading';
        paintRefreshFeedback();
        try {
            await refresh();
            refreshFeedback = 'success';
        } catch (error) {
            refreshFeedback = 'error';
            throw error;
        } finally {
            paintRefreshFeedback();
            refreshFeedbackTimer = setTimeout(() => {
                refreshFeedback = '';
                paintRefreshFeedback();
            }, 2000);
        }
    }
    function dialog(title, body, save, label = 'Save') {
        const d = document.createElement('dialog');
        d.className = 'kv2-dialog';
        d.innerHTML = `<form><header><h3>${esc(title)}</h3><button type="button" data-close aria-label="Close" data-t-aria-label="lang_close_title">×</button></header><section>${body}</section><p role="alert"></p><footer><button type="button" data-close><lang class="lang_cancel_title">Cancel</lang></button><button class="primary" type="submit">${esc(label)}</button></footer></form>`;
        document.body.append(d);
        let saving = false;
        d.addEventListener('click', (e) => {
            const b = e.target.closest('[data-template]');
            if (b) {
                const field = d.querySelector('[name=' + b.dataset.field + ']');
                field.value = b.dataset.template;
                field.focus();
            }
        });
        d.querySelectorAll('[data-close]').forEach(
            (b) =>
                (b.onclick = () => {
                    if (!saving) d.close();
                }),
        );
        d.addEventListener('cancel', (e) => {
            if (saving) e.preventDefault();
        });
        d.addEventListener('close', () => d.remove());
        d.querySelector('form').onsubmit = async (e) => {
            e.preventDefault();
            if (saving || !d.querySelector('form').reportValidity()) return;
            saving = true;
            d.querySelector('[type=submit]').disabled = true;
            try {
                await save(new FormData(d.querySelector('form')), d);
                d.close();
            } catch (error) {
                d.querySelector('[role=alert]').textContent = error.message;
            } finally {
                saving = false;
                d.querySelector('[type=submit]').disabled = false;
            }
        };
        d.showModal();
        return d;
    }
    function open() {
        if (activeScope !== scopeKey()) {
            activeScope = scopeKey();
            state.draft = null;
            state.sale = null;
            state.selected = null;
            state.sales = [];
            state.floor = [];
            state.catalogue = [];
            state.categories = [];
            state.category = "";
            state.catalogueLoaded = false;
        }
        P.HideSideBarModal();
        $('.page_loader,#osk-container,#closeSaleButton,#closeEditButton').hide();
        $('#v-pills-dashboard').addClass('show active');
        if (P.kotPrint) P.kotPrint.restore();
        if (!root()) {
            const el = document.createElement('div');
            el.id = 'kot_v2';
            el.className = 'page_loader';
            document.querySelector('#kot').after(el);
            el.addEventListener('click', onClick);
        }
        root().style.display = 'block';
        if (!enabled()) {
            root().innerHTML =
                '<p><lang class="lang_enable_restaurant_to_use_table_orders">Enable Restaurant to use table orders.</lang></p>';
            return;
        }
        if (!state.draft) {
            try {
                state.draft = JSON.parse(localStorage.getItem(scopeKey()) || 'null');
            } catch (_) {
                P.alert('error', 'The saved draft could not be read.');
            }
        }
        state.expanded = false;
        if (state.draft) state.selected = state.draft.saleId || null;
        state.filter = 'active';
        render();
        run(refresh);
    }
    async function refresh() {
        const generation = ++state.generation;
        const [floor, list] = await Promise.all([
            api('get', 'captain/v1/tables', { branchId: branch() }),
            api('get', 'sales', {
                page: 1,
                limit: 1000,
                filters: JSON.stringify({
                    sale_process: 'KOT',
                    payment_status: { $nin: ['Paid', 'Cancelled'] },
                    order_state: { $nin: ['rejected', 'cancelled'] },
                }),
            }),
        ]);
        if (generation !== state.generation) return;
        P.restaurantFeedback?.apply(floor.orderFeedback, branch());
        state.floor = floor.tables || [];
        state.sales = list.list || [];
        let page = 1;
        while (state.sales.length < Number(list.total || 0)) {
            const more = await api('get', 'sales', {
                page: ++page,
                limit: 1000,
                filters: JSON.stringify({
                    sale_process: 'KOT',
                    payment_status: { $nin: ['Paid', 'Cancelled'] },
                    order_state: { $nin: ['rejected', 'cancelled'] },
                }),
            });
            if (generation !== state.generation) return;
            if (!more.list?.length) break;
            state.sales.push(...more.list);
        }
        if (!state.draft && !state.sales.some((sale) => String(sale._id) === String(state.selected))) {
            state.selected = state.sales[0]?._id || null;
            state.sale = null;
        }
        if (state.selected) {
            const sale = await api('get', 'sales/' + encodeURIComponent(state.selected));
            if (generation !== state.generation) return;
            state.sale = sale;
        }
        if (
            state.sale &&
            (['Paid', 'Cancelled'].includes(state.sale.payment_status) || state.sale.sale_process !== 'KOT')
        ) {
            state.sale = null;
            state.selected = null;
        }
        state.refreshed = new Date().toISOString();
        render();
    }
    function resolveDraftBeforeSwitch(next, saleId) {
        const draft = state.draft;
        if (!draft) return false;
        if (saleId && String(draft.saleId) === String(saleId)) {
            state.expanded = false;
            render();
            return true;
        }
        if (!draft.items.length && !draft.intent) {
            state.draft = null;
            persist();
            return false;
        }
        const review = P.i18n.t('lang_review_this_round', 'Review this round');
        const modal = dialog(review,
            '<strong>' + esc(draft.table || 'Takeaway') + '</strong><ul>' +
            draft.items.map((line) => '<li>' + esc(line.quantity) + ' × ' + esc(line.name) + '</li>').join('') + '</ul>',
            () => { state.expanded = false; render(); }, review);
        // An uncertain send must be reconciled before its durable request can be discarded.
        if (!draft.intent) {
            const discard = document.createElement('button');
            discard.type = 'button';
            discard.textContent = P.i18n.t('lang_iv2_discard', 'Discard draft');
            discard.onclick = () => run(async () => {
                if (state.draft !== draft || draft.intent) return;
                state.draft = null;
                persist();
                modal.close();
                await next();
            });
            modal.querySelector('footer').prepend(discard);
        }
        return true;
    }
    async function select(saleId) {
        if (resolveDraftBeforeSwitch(() => select(saleId), saleId)) return;
        state.expanded = false;
        state.selected = saleId;
        state.sale = await api('get', 'sales/' + encodeURIComponent(saleId));
        state.tab = 'order';
        render();
    }
    const paths = {
        table: 'M4 8h16v9H4z M6 17v4m12-4v4M8 4h8',
        guests: 'M8 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6m-5 8v-2a5 5 0 0 1 10 0v2m3-14a3 3 0 0 1 0 6m1 3a4 4 0 0 1 4 4',
        move: 'M3 6h7v7H3z M5 13v4m3-4v4m6-8h7m-3-3 3 3-3 3',
        merge: 'M3 4h6v6H3z M15 4h6v6h-6z M6 10v4l6 6 6-6v-4m-9 7 3 3 3-3',
        transfer: 'M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4',
        refresh: 'M20 10a8 8 0 0 0-14-5L3 8m0-5v5h5m-4 6a8 8 0 0 0 14 5l3-3m0 5v-5h-5',
        takeaway: 'M5 7h14l1 14H4L5 7zm4 2V5a3 3 0 0 1 6 0v4',
    };
    function icon(name) {
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + paths[name] + '"/></svg>';
    }
    function iconButton(name, label) {
        return (
            '<button type="button" class="kv2-icon" data-action="' +
            name +
            '" title="' +
            label +
            '" aria-label="' +
            label +
            '">' +
            icon(name) +
            '</button>'
        );
    }
    function floorHTML() {
        const rows = state.floor.map((t) => ({
            ...t,
            sales: state.sales.filter((s) => (t.orders || []).some((o) => o.id === String(s._id))),
        }));
        for (const sale of state.sales.filter(
            (s) =>
                !/^take[\s_-]*away$/i.test(s.dine_type) &&
                !rows.some((t) => t.sales.some((v) => String(v._id) === String(s._id))),
        ))
            rows.push({
                id: 'custom-' + sale._id,
                tableorder_value: sale.table_number,
                status: 'occupied',
                sales: [sale],
            });
        for (const sale of state.sales.filter((s) => /^take[\s_-]*away$/i.test(s.dine_type)))
            rows.push({
                id: 'takeaway-' + sale._id,
                tableorder_value: 'Takeaway ' + (sale.takeaway_number || sale.token_id || ''),
                status: 'occupied',
                sales: [sale],
            });
        return `<aside class="kv2-floor"><header><strong><lang class="lang_orders_tables">Orders & tables</lang></strong><small>${state.sales.length} active</small>${button(state.expanded ? PosnicPro.i18n.t('lang_po_receive_back', 'Back to order') : PosnicPro.i18n.t('lang_expand_tables', 'Expand tables'), 'expand')}</header><nav>${['active', 'available', 'all'].map((f) => button(f[0].toUpperCase() + f.slice(1), 'filter', `data-value="${f}" class="${state.filter === f ? 'selected' : ''}"`)).join('')}</nav><div class="kv2-grid">${
            rows
                .filter(
                    (t) =>
                        state.filter === 'all' ||
                        (state.filter === 'active' ? t.sales.length : t.status === 'available'),
                )
                .map((t) => {
                    const minutes = t.sales.length
                        ? Math.max(
                              0,
                              Math.floor(
                                  (Date.now() -
                                      Math.min(
                                          ...t.sales.map((s) => Date.parse(s.created_date) || Date.now()),
                                      )) /
                                      60000,
                              ),
                          )
                        : 0;
                    return `<button class="kv2-table ${t.sales.some((s) => String(s._id) === state.selected) ? 'selected' : ''}" data-action="table" data-table="${esc(t.id)}" data-sale="${esc(t.sales[0]?._id || '')}" data-opened="${t.sales.length ? Math.min(...t.sales.map((s) => Date.parse(s.created_date) || Date.now())) : ''}" data-age="${!t.sales.length ? '' : minutes >= 30 ? 'late' : minutes >= 15 ? 'waiting' : 'fresh'}"><strong>${icon(t.id.startsWith('takeaway-') ? 'takeaway' : 'table')} ${esc(t.tableorder_value)}</strong><small>${t.sales.length ? t.sales.reduce((n, s) => n + (s.items || []).reduce((q, l) => q + Number(l.item_quantity || 0), 0), 0) + ' items · ' + t.sales.reduce((n, s) => n + Number(s.person_count || 0), 0) + ' guests' : esc(t.status)}</small>${t.sales.length ? `<b>${esc(money(t.sales.reduce((n, s) => n + Number(s.sales_total || 0), 0)))}</b><small data-elapsed>${minutes} min ago</small>` : ''}</button>`;
                })
                .join('') || `<div class="kv2-floor-empty">${icon('table')}<p><lang class="lang_no_orders_here">No orders here.</lang></p>${state.filter === 'active' ? button(PosnicPro.i18n.t('lang_choose_a_table', 'Choose a table'), 'filter', 'data-value="available"') : ''}</div>`
        }</div></aside>`;
    }
    function updateElapsed() {
        if (!root()?.offsetParent || document.hidden) return;
        root().querySelectorAll('.kv2-table[data-opened]').forEach((card) => {
            if (!card.dataset.opened) return;
            const minutes = Math.max(0, Math.floor((Date.now() - Number(card.dataset.opened)) / 60000));
            const label = card.querySelector('[data-elapsed]');
            if (label) label.textContent = minutes + ' min ago';
            card.dataset.age = minutes >= 30 ? 'late' : minutes >= 15 ? 'waiting' : 'fresh';
        });
    }
    setInterval(updateElapsed, 15000);
    document.addEventListener('visibilitychange', updateElapsed);
    function roundHTML(sale) {
        const rounds = sale.restaurant_details?.rounds || [];
        return (
            rounds
                .map((r, i) => {
                    const lines = r.items.filter((l) => !state.pending || l.remaining > 0);
                    if (!lines.length) return '';
                    return `<div class="kv2-round"><strong>${i ? PosnicPro.i18n.t('lang_additional_order', 'Additional order') : PosnicPro.i18n.t('lang_first_order', 'First order')} · KOT ${i + 1}</strong><small>${esc(time(r.ordered_at || r.fired_at))}</small></div>${lines.map((l) => `<div class="kv2-line"><b>${esc(l.quantity)}</b><div><strong>${esc(l.name)}</strong><small>${esc([l.note, l.allergy_note, l.course].filter(Boolean).join(' · '))}</small></div>${button('＋ Add again', 'again', `data-line="${esc(l.id)}"`)}<span>${esc(lineAmount(sale, l))}</span>${button(l.held ? 'Send now' : l.remaining <= 0 ? '✓ Served' : l.quantity === 1 ? 'Mark served' : 'Serve 1 · ' + l.served + '/' + l.quantity, 'serve', `data-line="${esc(l.id)}" ${l.remaining <= 0 ? 'disabled' : ''}`)}${button('✎', 'editLine', `data-line="${esc(l.id)}" title="Edit dish" data-t-title="lang_edit_dish" aria-label="Edit dish" data-t-aria-label="lang_edit_dish"`)}</div>`).join('')}`;
                })
                .join('') ||
            '<p class="kv2-empty"><lang class="lang_no_pending_portions">No pending portions.</lang></p>'
        );
    }
    function emptyOrderHTML() {
        const idle = !state.sales.length;
        return `<section class="kv2-order kv2-welcome"><div class="kv2-illustration" aria-hidden="true"><svg viewBox="0 0 240 180"><ellipse cx="120" cy="155" rx="83" ry="12" fill="#edf3fa" stroke="none"/><circle cx="120" cy="79" r="66" fill="#f0f6ff" stroke="none"/><g class="kv2-cloche"><path d="M66 103h108M75 99a45 45 0 0 1 90 0M113 49h14M120 49v6"/><path d="M63 112h114l-9 10H72Z" fill="#e1edff"/></g><path d="M76 132h88M87 132v20m66-20v20"/><g class="kv2-steam"><path d="M104 32q-6-7 0-14m16 12q-6-7 0-14m16 16q-6-7 0-14"/></g><circle cx="182" cy="54" r="17" fill="#e5f5ef" stroke="none"/><path d="m175 54 5 5 9-11" stroke="#4d9b80"/></svg></div><h2><lang class="${idle ? 'lang_no_active_orders_2' : 'lang_choose_a_table'}">${idle ? PosnicPro.i18n.t('lang_no_active_orders_2', 'No active orders') : PosnicPro.i18n.t('lang_choose_a_table', 'Choose a table')}</lang></h2><p><lang class="${idle ? 'lang_start_a_table_order' : 'lang_choose_an_active_table_or_start_a_new_orde'}">${idle ? PosnicPro.i18n.t('lang_start_a_table_order', 'Start a table order') : PosnicPro.i18n.t('lang_choose_an_active_table_or_start_a_new_orde', 'Choose an active table, or start a new order.')}</lang></p><div class="kv2-welcome-actions">${button(PosnicPro.i18n.t('lang_new_order', 'New order'), 'new', 'class="primary"')}${button(PosnicPro.i18n.t('lang_takeaway', 'Takeaway'), 'takeaway')}</div></section>`;
    }
    function orderHTML() {
        const s = state.sale;
        if (!s) return emptyOrderHTML();
        const details = s.restaurant_details || {};
        return `<section class="kv2-order"><header><div><h2>${esc(s.dine_type === 'Take away' ? 'Takeaway ' + (s.takeaway_number || s.token_id || '') : 'Table ' + s.table_number)}</h2><small>${esc(s.person_count || 0)} guests · ${esc(details.taken_by)} · ${esc(time(s.created_date))}</small></div><div>${iconButton('move', 'Move table')}${iconButton('merge', 'Merge tables')}${iconButton('transfer', 'Transfer items')}${button('Actions', 'actions')}</div></header><div class="kv2-customer">Customer <strong>${esc(s.customer_name || 'Walk-in customer')}</strong> ${esc(s.customer_phone || '')}${button('Choose customer', 'customer')}</div><nav>${button('Order', 'tab', `data-value="order" class="kv2-tab ${state.tab === 'order' ? 'active' : ''}"`)}${button('Activity', 'tab', `data-value="activity" class="kv2-tab ${state.tab === 'activity' ? 'active' : ''}"`)}${button(state.pending ? 'Pending only ✓' : 'Pending only', 'pending')}${button('Serve all', 'serveAll')}${button('＋ Add items', 'add', 'class="primary"')}</nav><div class="kv2-lines">${state.tab === 'activity' ? (details.events || []).map((e) => `<article><strong>${esc(e.kind)}</strong> · ${esc(time(e.at))} · ${esc(e.actor)}<p>${esc((e.items || []).map((l) => l.quantity + ' × ' + l.name).join(', '))}</p></article>`).join('') : roundHTML(s)}</div><details class="kv2-breakdown"><summary>Bill breakdown & kitchen note</summary><div><p>Subtotal <b>${esc(money(s.sales_sub_total || s.subtotal || 0))}</b></p><p>Tax <b>${esc(money(s.tax || 0))}</b></p><p>Discount <b>${esc(money(s.discount || 0))}</b></p>${Number(s.round_off || s.sales_round_off) ? `<p>Rounding <b>${esc(money(s.round_off || s.sales_round_off))}</b></p>` : ''}<p>${esc(details.preparation_note || 'No kitchen note')}</p>${button('Edit details', 'notes')}</div></details><footer><div><small><lang class="lang_total_title">Total</lang></small><strong>${esc(money(s.sales_total))}</strong></div>${button('Discount', 'discount')}${button('Print bill', 'printBill')}${button('Print KOT', 'printKOT')}${button('Take payment', 'pay', 'class="primary"')}</footer></section>`;
    }
    function catalogueHTML() {
        return state.catalogue.map((item, i) => {
            const name = P.itemName ? P.itemName(item) : item.item_name || item.name || '';
            const photo = typeof item.image === 'string' && item.image !== 'item.svg' && !/default\/item\.svg/.test(item.image) && /^(https?:|\/|static\/)/i.test(item.image) ? item.image : '';
            const art = photo ? `<img src="${esc(photo)}" alt="" loading="lazy">` : item.icon ? esc(item.icon) : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8h18v13H3zM3 8l4-5h10l4 5M12 8v13M8 3l4 5 4-5"/></svg>';
            return `<button type="button" data-action="pick" data-index="${i}" class="kv2-product"><span class="kv2-product-art">${art}</span><span class="kv2-product-text"><strong>${esc(name)}</strong><small>${esc([item.plu_code || item.short_code, item.itemid || item.item_code].filter(Boolean).join(' · '))}</small><span class="kv2-product-meta"><small>${esc(item.category_name || '')}</small><b>${esc(money(item.items_selling_price ?? item.selling_price ?? item.item_price ?? item.price ?? 0))}</b></span></span></button>`;
        }).join('');
    }
    function categoriesHTML() {
        return button(PosnicPro.i18n.t('lang_all_items', 'All items'), 'category', 'data-category="" class="' + (!state.category ? 'selected' : '') + '"') + state.categories.map(c => button(c.name, 'category', 'data-category="' + esc(c.id) + '" class="' + (state.category === String(c.id) ? 'selected' : '') + '"')).join('');
    }
    async function loadCatalogue() {
        if (state.loadingMenu) return;
        state.loadingMenu = true;
        const scope = scopeKey(), category = state.category;
        try {
            const r = await api('get', 'items/getOnlineItemsAjaxList', {query: '', limit: 50, ...(category ? {categoryId: category} : {})});
            if (scope !== scopeKey() || category !== state.category) return;
            state.catalogue = (r.suggestions || []).map(v => v.data || v).filter(v => !window.PosnicBillingSearch?.expired(v.items_expiry_date));
            state.catalogueLoaded = true;
            const menu = root()?.querySelector('.kv2-menu');
            if (menu) menu.innerHTML = catalogueHTML();
            if (!state.categories.length) {
                const cats = await api('get', 'categories/getCategoryAjaxList', {query: ''});
                if (scope !== scopeKey()) return;
                state.categories = cats.suggestions || [];
                const chips = root()?.querySelector('.kv2-category-chips');
                if (chips) chips.innerHTML = categoriesHTML();
            }
        } catch (e) { P.alert('error', e.message); }
        finally { state.loadingMenu = false; if (scope === scopeKey() && category !== state.category) loadCatalogue(); }
    }
    function chooseProduct(data, quantity = 1) {
        const price = Number(data.items_selling_price ?? data.selling_price ?? data.item_price ?? data.price ?? 0);
        const openPrice = !price || data.open_price === true;
        const modal = dialog(data.item_name || data.name || data.items_name || '',
            `${openPrice ? '<label>Price<input name="price" type="number" min="0.01" step="0.01" required></label>' : '<p>' + esc(money(price)) + '</p>'}<label><lang class="lang_quantity">Quantity</lang><input name="qty" type="number" min="0.001" max="100000" step="any" value="${quantity}" required></label><label><lang class="lang_kot_workspace_note">Kitchen note</lang><textarea name="note" maxlength="500"></textarea></label>` + templates(['No onion', 'Less spicy', 'Less ice'], 'note'),
            form => { addLine({product_id:data.item_id || data.id || data._id?.$oid || data._id,name:data.item_name || data.name || data.items_name,price:openPrice ? Number(form.get('price')) : price,quantity:Number(form.get('qty')),item_description:String(form.get('note') || '')}); }, 'Add to round');
        modal.classList.add('kv2-product-dialog');
        modal.querySelector(openPrice ? '[name=price]' : '[name=qty]').focus();
        modal.addEventListener('close', () => root()?.querySelector('#kv2-search')?.focus());
    }
    function draftHTML() {
        const d = state.draft;
        return `<section class="kv2-order kv2-editor"><div class="kv2-customer"><strong>${esc(d.customer?.name || 'Walk-in customer')}</strong>${button('Choose customer', 'customer')}</div><header><div><h2>${PosnicPro.i18n.t('lang_add_items', 'Add items')} <span class="kv2-editor-table">/ ${esc(d.table || 'Takeaway')}</span></h2><small><lang class="lang_search_all_dishes_by_name_barcode_or_quick">Search all dishes by name, barcode or quick code. F2 to focus.</lang></small></div>${d.intent ? button('Review latest order', 'rebase') : button('Discard draft', 'discard')}</header><div class="kv2-draft-body"><section class="kv2-catalogue"><div class="kv2-searchbar"><input id="kv2-search" type="search" autocomplete="off" placeholder="Search name, SKU, barcode or quick code" data-t-placeholder="lang_search_name_sku_barcode_or_quick_code"><div id="kv2-results"></div></div><div class="kv2-catalogue-footer">${button('Item not on menu', 'offmenu')}</div><div class="kv2-category-chips">${categoriesHTML()}</div><div class="kv2-menu">${catalogueHTML()}</div></section><aside class="kv2-review"><div class="kv2-review-heading"><h3><lang class="lang_review_this_round">Review this round</lang></h3></div><p class="kv2-review-hint"><lang class="lang_nothing_is_sent_until_you_choose_send_to_k">Nothing is sent until you choose Send to kitchen.</lang></p><div class="kv2-basket">${d.items.length ? d.items.map((l, i) => `<div class="kv2-draft-line"><div class="kv2-draft-name"><strong>${esc(l.name)}</strong><span>${esc(money(l.price * l.quantity))}</span></div>${l.item_description ? `<small>${esc(l.item_description)}</small>` : ''}<div class="kv2-stepper">${button('−', 'qty', `data-index="${i}" data-delta="-1" aria-label="${esc(PosnicPro.i18n.t('lang_quantity','Quantity'))} −"`)}<b>${l.quantity}</b>${button('+', 'qty', `data-index="${i}" data-delta="1" aria-label="${esc(PosnicPro.i18n.t('lang_quantity','Quantity'))} +"`)}${button('Note', 'draftNote', `data-index="${i}"`)}${button(PosnicPro.i18n.t('lang_remove','Remove'), 'removeDraft', `data-index="${i}" class="kv2-remove"`)}</div></div>`).join('') : `<div class="kv2-basket-empty">${icon('takeaway')}<p><lang class="lang_add_item">Add item</lang></p></div>`}</div><div class="kv2-round-total"><span><lang class="lang_amount">Amount</lang></span><strong>${esc(money(d.items.reduce((sum, l) => sum + Number(l.price) * Number(l.quantity), 0)))}</strong></div></aside></div><footer>${button(PosnicPro.i18n.t('lang_cancel', 'Cancel'), 'discard')}<small>${d.items.reduce((n, l) => n + Number(l.quantity), 0)} <lang class="lang_items">Items</lang></small>${button(d.intent ? PosnicPro.i18n.t('lang_retry_saved_send', 'Retry saved send') : PosnicPro.i18n.t('lang_kot_workspace_send', 'Send to kitchen'), 'send', `class="primary" ${d.items.length ? '' : 'disabled'}`)}</footer></section>`;
    }
    function render() {
        if (!root()) return;
        root().classList.toggle('kv2-composing', !!state.draft);
        root().classList.toggle('kv2-playful', !!P.restaurantFeedback?.allowed?.());
        root().innerHTML = `<div class="kv2-heading"><h1><lang class="lang_table_orders">Table orders</lang></h1><small>${state.refreshed ? 'Refreshed ' + esc(time(state.refreshed)) : ''}</small><div>${state.draft ? button(state.expanded ? PosnicPro.i18n.t('lang_review_this_round','Review this round') : PosnicPro.i18n.t('lang_tables','Tables'), 'expand') : ''}${iconButton('refresh', 'Refresh orders')}${state.draft ? '' : button('Item not on menu', 'offmenu') + button('Takeaway', 'takeaway') + button('＋ New order', 'new', 'class="primary"')}</div></div><div class="kv2-workspace ${state.expanded ? 'kv2-expanded' : ''}">${floorHTML()}${state.draft ? draftHTML() : orderHTML()}</div>`;
        if (state.draft) {
            bindSearch();
            if (!state.catalogueLoaded) loadCatalogue();
        }
        paintRefreshFeedback();
    }
    function startDraft(meta) {
        state.expanded = false;
        if (!state.draft)
            state.draft = {
                key: id(),
                saleId: state.sale?._id || null,
                table: state.sale?.table_number || '',
                customer: state.sale ? { id: state.sale.customer_id, name: state.sale.customer_name, phone: state.sale.customer_phone } : null,
                items: [],
                ...meta,
            };
        persist();
        render();
    }
    function addLine(line) {
        if (state.draft?.intent) throw new Error('Retry the saved send before changing this draft.');
        startDraft();
        if (!line.product_id) throw new Error('Item is unavailable. Search again.');
        state.draft.items.push({ ...line, line_id: id() });
        persist();
        render();
        P.restaurantFeedback?.play(state.draft.items.length === 1 ? 'first' : 'add');
    }
    function bindSearch() {
        const input = $('#kv2-search');
        P.kot.bindProductSearch(input, (data, quantity, done) => {
            try {
                const price = Number(
                    data.items_selling_price ?? data.selling_price ?? data.item_price ?? data.price ?? 0,
                );
                if (!price || data.open_price === true) {
                    quantityDialog(data, quantity);
                    done(true);
                    return;
                }
                addLine({
                    product_id: data.item_id || data.id || data._id?.$oid || data._id,
                    name: data.item_name || data.name || data.items_name,
                    price,
                    quantity,
                });
                done(true);
            } catch (e) {
                P.alert('error', e.message);
                done(false);
            }
        });
        if ($.fn.autocomplete) input.autocomplete('setOptions', {onSelect: suggestion => chooseProduct(suggestion.data)});
    }
    function quantityDialog(data, quantity) {
        dialog(
            'Price for this order',
            '<label>Price<input name="price" type="number" min="0.01" step="0.01" required></label>',
            (form) =>
                addLine({
                    product_id: data.item_id || data.id || data._id?.$oid || data._id,
                    name: data.item_name || data.name || data.items_name,
                    price: Number(form.get('price')),
                    quantity,
                }),
            'Add to round',
        );
    }
    function originalLine(sale, line) {
        return (sale.items || []).find(
            (i) => String(i.line_id || i.item_id || i.product_id) === line.line_key,
        );
    }
    function lineAmount(sale, line) {
        const saved = originalLine(sale, line);
        if (!saved) return '';
        return money(
            Number(saved.unit_price ?? saved.item_base_price ?? saved.item_price ?? 0) * line.quantity,
        );
    }
    function customer() {
        const d = state.draft,
            s = state.sale,
            c = d?.customer || { id: s?.customer_id, name: s?.customer_name || '', phone: s?.customer_phone || '' };
        let selected = c.id ? { id: c.id } : null;
        const modal = dialog(
            'Customer',
            `<label>Find an existing customer<input type="search" id="kv2-customer-search" placeholder="Name or mobile number" data-t-placeholder="lang_name_or_mobile_number" autocomplete="off"></label><label>Name<input name="name" maxlength="80" value="${esc(c.name)}"></label><label>Mobile number<input name="phone" type="tel" maxlength="40" value="${esc(c.phone)}"></label><p><lang class="lang_leave_both_blank_for_a_walk_in_customer_ca">Leave both blank for a walk-in customer / cash bill.</lang></p>`,
            async (f) => {
                const value = { name: f.get('name'), phone: f.get('phone') };
                if (d && !d.saleId) {
                    if (d.intent) throw new Error('Confirm the saved send first.');
                    d.customer = { ...value, id: selected?.id };
                    persist();
                    render();
                } else {
                    if (d?.intent) throw new Error('Confirm the saved send first.');
                    await api('post', 'sales/orderCustomer', {
                        saleId: s._id,
                        branchId: branch(),
                        seenAt: s.order_revision || s.updated_date || s.created_date,
                        customerId: selected?.id,
                        ...value,
                    });
                    if (d) {
                        d.customer = { ...value, id: selected?.id };
                        persist();
                    }
                    await refresh();
                }
            },
        );
        $(modal)
            .find('#kv2-customer-search')
            .autocomplete({
                appendTo: modal,
                deferRequestBy: 180,
                lookup: (query, done) => {
                    api('get', 'customers/getCustomersAjaxList', { query, limit: 20 })
                        .then((r) =>
                            done({
                                suggestions: (r.suggestions || []).map((c) => ({
                                    value: c.name + ' · ' + (c.phone || ''),
                                    data: c,
                                })),
                            }),
                        )
                        .catch(() => done({ suggestions: [] }));
                },
                onSelect: (choice) => {
                    selected = choice.data;
                    modal.querySelector('[name=name]').value = selected.name || '';
                    modal.querySelector('[name=phone]').value = selected.phone || '';
                },
                autoSelectFirst: true,
                triggerSelectOnValidInput: false,
            });
        $(modal)
            .find('[name=name],[name=phone]')
            .on('input', () => {
                selected = null;
            });
    }
    async function send() {
        const d = state.draft;
        if (!d?.items.length) return;
        if (!d.intent) {
            if (d.saleId) {
                const sale = await api('get', 'sales/' + d.saleId);
                d.intent = {
                    url: 'sales/updateOrder',
                    body: {
                        ...P.kotWorkspace.editPayload(sale, [
                            ...sale.items.map((l) => P.kot.editLine(l)),
                            ...d.items.map(({ name, ...l }) => l),
                        ]),
                        request_id: d.key,
                    },
                };
            } else
                d.intent = {
                    url: 'sales/qrOrder',
                    body: {
                        idempotencyKey: d.key,
                        branch: branch(),
                        sale_method: 'Table-Order',
                        order: d.dineType,
                        dine_type: d.dineType,
                        kiosk_table_no: d.table,
                        kiosk_table_id: d.tableId || '',
                        person_count: d.guests,
                        customer_id: d.customer?.id || '',
                        customer_name: d.customer?.name || '',
                        customerMobile: d.customer?.phone || '',
                        payment_status: 'cash',
                        client: { app: 'desktop-kot-v2' },
                        items: d.items.map((l) => ({
                            item_id: l.product_id,
                            line_id: l.line_id,
                            item_name: l.name,
                            item_quantity: l.quantity,
                            item_price: l.price,
                            item_description: l.item_description || '',
                        })),
                    },
                };
            persist();
        }
        let result;
        try {
            result = await api('post', d.intent.url, d.intent.body);
        } catch (error) {
            if (d.saleId && error.message === 'order_changed') {
                // This is an explicit refusal, not an unknown network outcome.
                // Reconcile accepted line IDs before unlocking the remaining draft.
                const latest = await api('get', 'sales/' + d.saleId);
                const accepted = new Set((latest.items || []).map(line => line.line_id));
                d.items = d.items.filter(line => !accepted.has(line.line_id));
                delete d.intent;
                d.key = id();
                state.sale = latest;
                persist();
                render();
                notify('Latest order loaded. Review the remaining dishes before sending.');
                return;
            }
            // Pricing validation happens before any order write. Unlike a lost response,
            // this is a confirmed refusal: retain the dishes, but allow corrections.
            if (['item_price_mismatch', 'invalid_price', 'item_needs_price', 'item_price_too_high', 'invalid_tax_configuration', 'price_context_mismatch', 'item_modifiers_changed'].includes(error.details?.state)) {
                delete d.intent;
                d.key = id();
                persist();
                render();
                throw error;
            }
            if (!d.saleId) throw error;
            // Stable line IDs prove the saved addition on a lost response; never send it twice.
            const latest = await api('get', 'sales/' + d.saleId);
            if (
                !d.items.every((line) =>
                    (latest.items || []).some(
                        (saved) =>
                            saved.line_id === line.line_id && Number(saved.item_quantity) === line.quantity,
                    ),
                )
            )
                throw error;
        }
        state.draft = null;
        persist();
        state.selected = d.saleId || result?.sale_id || result?.order_id || result?.id || null;
        render();
        P.restaurantFeedback?.play('sent');
        await refresh();
        if (d.saleId && P.kotPrint) P.kotPrint.afterSave(d.saleId);
    }
    function newOrder(takeaway = false, tableId = '') {
        if (resolveDraftBeforeSwitch(() => newOrder(takeaway, tableId))) return;
        const free = state.floor.filter((t) => t.status === 'available');
        const modal = dialog(
            takeaway ? PosnicPro.i18n.t('lang_new_takeaway', 'New takeaway') : PosnicPro.i18n.t('lang_start_a_table_order', 'Start a table order'),
            `<div class="kv2-seating-layout">${takeaway ? '' : `<div class="kv2-table-section"><h4>${icon('table')} <lang class="lang_choose_a_table">Choose a table</lang></h4><div class="kv2-choices kv2-seat-grid">${[...state.floor].sort((a, b) => Number(b.status === 'available') - Number(a.status === 'available')).map((t) => `<label class="kv2-seat ${t.status !== 'available' ? 'occupied' : ''}"><input type="radio" name="table" value="${esc(t.id)}" ${tableId === t.id && t.status === 'available' ? 'checked' : ''} ${t.status !== 'available' ? 'disabled' : ''}>${icon('table')}<strong>${esc(t.tableorder_value)}</strong><small>${esc(t.status)}</small></label>`).join('')}</div><label>Other table number<input name="custom" maxlength="30" placeholder="For example, Garden 2" data-t-placeholder="lang_for_example_garden_2"></label></div>`}<div class="kv2-guest-section"><h4>${icon('guests')} <lang class="lang_kot_workspace_covers">Number of guests</lang></h4>${takeaway ? '' : `<div class="kv2-choices kv2-guest-grid">${[1, 2, 3, 4, 5, 6, 8, 10].map((n) => `<button type="button" data-guests="${n}" aria-pressed="${n === 2}" class="${n === 2 ? 'primary' : ''}">${icon('guests')}<strong>${n}</strong></button>`).join('')}</div>`}<label>${takeaway ? PosnicPro.i18n.t('lang_guests_optional', 'Guests (optional)') : PosnicPro.i18n.t('lang_guest_count', 'Guest count')}<input name="guests" inputmode="numeric" type="number" value="${takeaway ? 0 : 2}" min="${takeaway ? 0 : 1}" max="1000" required></label></div></div>`,

            (form) => {
                const t = free.find((t) => t.id === form.get('table')),
                    custom = String(form.get('custom') || '').trim();
                if (!takeaway && !t && !custom) throw new Error('Choose a table or enter its number.');
                if (custom.toUpperCase() === 'TA') throw new Error('Use Takeaway for an order to go.');
                state.sale = null;
                state.selected = null;
                startDraft({
                    saleId: null,
                    table: custom || t?.tableorder_value || '',
                    tableId: custom ? '' : t?.id || '',
                    guests: Number(form.get('guests')),
                    dineType: takeaway ? 'Take away' : 'Dine-in',
                });
            },
            'Choose dishes',
        );
        modal.classList.add('kv2-seating-dialog');
        modal.addEventListener('click', (e) => {
            const b = e.target.closest('[data-guests]');
            if (b) {
                modal.querySelector('[name=guests]').value = b.dataset.guests;
                modal
                    .querySelectorAll('[data-guests]')
                    .forEach((v) => { v.classList.toggle('primary', v === b); v.setAttribute('aria-pressed', String(v === b)); });
            }
        });
        modal.querySelector('[name=guests]').addEventListener('input', (e) => {
            modal.querySelectorAll('[data-guests]').forEach((v) => { const on = Number(v.dataset.guests) === Number(e.target.value); v.classList.toggle('primary', on); v.setAttribute('aria-pressed', String(on)); });
        });
        modal
            .querySelector('[name=custom]')
            ?.addEventListener('input', () =>
                modal.querySelectorAll('[name=table]').forEach((v) => (v.checked = false)),
            );
        modal
            .querySelectorAll('[name=table]')
            .forEach((v) =>
                v.addEventListener('change', () => (modal.querySelector('[name=custom]').value = '')),
            );
        return modal;
    }
    function editLine(lineId) {
        const sale = state.sale,
            line = sale.restaurant_details.rounds.flatMap((r) => r.items).find((l) => l.id === lineId),
            original = originalLine(sale, line);
        if (!original) throw new Error('Refresh the order before editing.');
        dialog(
            'Edit ' + line.name,
            `<label>Quantity for this round<input name="qty" type="number" min="${line.served}" step="1" required value="${line.quantity}"></label><label>Kitchen note<textarea name="note" maxlength="500">${esc(line.note)}</textarea></label>${templates(['No onion', 'Less spicy', 'Less oil'], 'note')}<label>Reason for reducing or removing<textarea name="reason" maxlength="200"></textarea></label>`,
            async (f) => {
                const qty = Number(f.get('qty')),
                    note = String(f.get('note'));
                if (qty > line.quantity) {
                    addLine({
                        ...P.kot.editLine(original, qty - line.quantity),
                        name: line.name,
                        item_description: note,
                    });
                    return;
                }
                if (qty < line.quantity && !String(f.get('reason')).trim())
                    throw new Error('Enter a reason for reducing the quantity.');
                // Older clients share one bill line across multiple kitchen rounds.
                // Their reduction contract removes the newest outstanding portion first.
                const shared = sale.restaurant_details.rounds
                    .flatMap((r) => r.items)
                    .filter((l) => l.line_key === line.line_key && l.quantity > 0);
                if (qty < line.quantity && shared.length > 1 && shared[shared.length - 1].id !== line.id)
                    throw new Error(
                        'This dish was ordered in several rounds. Reduce its latest round first.',
                    );
                const items = sale.items
                    .map((i) => {
                        const edit = P.kot.editLine(i);
                        if (i === original) {
                            edit.quantity = Number(i.item_quantity) - (line.quantity - qty);
                            edit.item_description = note;
                        }
                        return edit;
                    })
                    .filter((l) => l.quantity > 0);
                if (!items.length) throw new Error('Use Cancel order to remove the entire order.');
                await api('post', 'sales/updateOrder', {
                    ...P.kotWorkspace.editPayload(sale, items),
                    change_reason: f.get('reason'),
                });
                await refresh();
            },
            'Save changes',
        );
    }
    function discount() {
        const s = state.sale;
        dialog(
            'Discount',
            `<label>Type<select name="type"><option value="amount" data-t="lang_amount_title">Amount</option><option value="percent" data-t="lang_percentages">Percentage</option></select></label><label>Discount<input name="amount" type="number" min="0" step="0.01" required value="${esc(s.extra_discount || 0)}"></label><label>Reason<textarea name="reason" maxlength="200" required>${esc(s.discount_description || '')}</textarea></label>` +
                templates(['Manager approved', 'Customer loyalty', 'Service delay'], 'reason'),
            async (f) => {
                if (f.get('type') === 'percent' && Number(f.get('amount')) > 100)
                    throw new Error('Percentage cannot exceed 100.');
                await api('post', 'sales/updateOrder', {
                    ...P.kotWorkspace.editPayload(
                        s,
                        s.items.map((l) => P.kot.editLine(l)),
                    ),
                    extra_discount_type: f.get('type'),
                    extra_discount: Number(f.get('amount')),
                    discount_description: f.get('reason'),
                });
                await refresh();
            },
        );
    }
    async function offmenu() {
        if (!state.draft && !state.sale) throw new Error('Start a table or takeaway order first.');
        const tax = await api('get', 'items/instantItemTax');
        dialog(
            'Item not on menu',
            '<label>Item name<input name="name" maxlength="100" required></label><label>Price<input name="price" type="number" min="0.01" step="0.01" required></label><p>' +
                esc(tax?.rate ? tax.name + ' · ' + tax.rate + '% tax added to price' : 'No default tax') +
                '</p><label>Quantity<input name="qty" type="number" min="1" value="1" required></label>',
            async (form) => {
                const made = await api('post', 'items/instanceItemInsert', {
                    items_name: form.get('name'),
                    items_selling_price: Number(form.get('price')),
                    items_quantity: 1,
                    quick_sale_default_tax: true,
                    quick_sale_tax: tax,
                    items_unit: 'qty',
                });
                addLine({
                    product_id: made.id || made._id,
                    name: form.get('name'),
                    price: Number(made.selling_price ?? form.get('price')),
                    quantity: Number(form.get('qty')),
                });
            },
            'Add to round',
        );
    }
    async function serveFeedback(control, action) {
        const label = control.innerHTML;
        control.classList.remove('kv2-serve-saved');
        control.closest('.kv2-line')?.classList.remove('kv2-served-row');
        control.disabled = true;
        control.setAttribute('aria-busy', 'true');
        control.classList.add('kv2-serving');
        control.textContent = PosnicPro.i18n.t('lang_loading_3', 'Loading…');
        try {
            await action();
            const updated = Array.from(root().querySelectorAll('[data-action]')).find((el) =>
                el.dataset.action === control.dataset.action && el.dataset.line === control.dataset.line);
            if (updated) {
                updated.classList.add('kv2-serve-saved');
                updated.closest('.kv2-line')?.classList.add('kv2-served-row');
                setTimeout(() => {
                    updated.classList.remove('kv2-serve-saved');
                    updated.closest('.kv2-line')?.classList.remove('kv2-served-row');
                }, 1600);
            }
        } finally {
            if (control.isConnected) {
                control.innerHTML = label;
                control.disabled = false;
                control.removeAttribute('aria-busy');
                control.classList.remove('kv2-serving');
            }
        }
    }
    async function serve(lineId) {
        const s = state.sale,
            l = s.restaurant_details.rounds.flatMap((r) => r.items).find((l) => l.id === lineId);
        if (!l || l.remaining <= 0) return;
        await api('post', l.held ? 'sales/fireKitchenItems' : 'sales/serveKitchenItems', {
            saleId: s._id,
            branchId: branch(),
            requestId: id(),
            items: l.held ? [l.id] : [{ id: l.id, quantity: Math.min(l.quantity, l.served + 1) }],
        });
        await refresh();
    }
    async function onClick(e) {
        const b = e.target.closest('[data-action]');
        if (!b) return;
        await run(async () => {
            const a = b.dataset.action,
                s = state.sale;
            if (a === 'expand') {
                state.expanded = !state.expanded;
                render();
            } else if (a === 'filter') {
                state.filter = b.dataset.value;
                render();
            } else if (a === 'refresh') await refreshFromButton();
            else if (a === 'table') {
                const t = state.floor.find((t) => t.id === b.dataset.table);
                const ids = t?.orders?.map((o) => String(o.id)) || [];
                if (ids.length > 1) {
                    const modal = dialog(
                        'Choose an order',
                        '<div class="kv2-choices">' +
                            state.sales
                                .filter((v) => ids.includes(String(v._id)))
                                .map((v) =>
                                    button(
                                        v.sales_id + ' · ' + money(v.sales_total),
                                        'selectOrder',
                                        `data-sale="${esc(v._id)}"`,
                                    ),
                                )
                                .join('') +
                            '</div>',
                        () => {},
                        'Close',
                    );
                    modal.querySelector('section').onclick = (ev) => {
                        const control = ev.target.closest('[data-sale]');
                        if (control) {
                            modal.close();
                            run(() => select(control.dataset.sale));
                        }
                    };
                } else if (b.dataset.sale) await select(b.dataset.sale);
                else newOrder(false, b.dataset.table);
            } else if (a === 'category') {
                state.category = b.dataset.category; state.catalogue = []; state.catalogueLoaded = false; render();
            } else if (a === 'pick') {
                const item = state.catalogue[Number(b.dataset.index)];
                chooseProduct(item);
            } else if (a === 'new') newOrder();
            else if (a === 'takeaway') newOrder(true);
            else if (a === 'add') startDraft();
            else if (a === 'offmenu') await offmenu();
            else if (a === 'send') await send();
            else if (a === 'rebase') {
                const d = state.draft;
                if (!d.saleId) throw new Error('Retry this new order to confirm its result.');
                const latest = await api('get', 'sales/' + d.saleId);
                const accepted = new Set((latest.items || []).map((l) => l.line_id));
                d.items = d.items.filter((l) => !accepted.has(l.line_id));
                delete d.intent;
                state.sale = latest;
                persist();
                render();
                notify('Latest order loaded. Review the remaining dishes before sending.');
            } else if (a === 'discard') {
                if (state.draft.intent)
                    throw new Error(
                        'Retry the saved send before discarding; it may already have reached the kitchen.',
                    );
                state.draft = null;
                persist();
                render();
            } else if (a === 'removeDraft') {
                if (state.draft.intent) throw new Error('Retry the saved send first.');
                state.draft.items.splice(Number(b.dataset.index), 1);
                persist();
                render();
            } else if (a === 'qty') {
                if (state.draft.intent) throw new Error('Retry the saved send first.');
                const l = state.draft.items[b.dataset.index];
                l.quantity += Number(b.dataset.delta);
                if (l.quantity <= 0) state.draft.items.splice(Number(b.dataset.index), 1);
                persist();
                render();
                P.restaurantFeedback?.play(Number(b.dataset.delta) > 0 ? 'add' : 'reduce');
            } else if (a === 'draftNote') {
                if (state.draft.intent) throw new Error('Confirm the saved send first.');
                const l = state.draft.items[b.dataset.index];
                dialog(
                    'Kitchen note',
                    `<label>Note<textarea name="note" maxlength="500">${esc(l.item_description || '')}</textarea></label>${templates(['No onion', 'Less spicy', 'Less oil', 'No ice'], 'note')}`,
                    (form) => {
                        l.item_description = form.get('note');
                        persist();
                        render();
                    },
                );
            } else if (a === 'tab') {
                state.tab = b.dataset.value;
                render();
            } else if (a === 'pending') {
                state.pending = !state.pending;
                render();
            } else if (a === 'again') {
                const l = s.restaurant_details.rounds
                        .flatMap((r) => r.items)
                        .find((l) => l.id === b.dataset.line),
                    original = originalLine(s, l);
                if (!original) throw new Error('Refresh the order before adding again.');
                dialog(
                    'Add again · ' + l.name,
                    '<label>Additional quantity<input name="qty" type="number" min="1" value="1" required></label>',
                    (f) => addLine({ ...P.kot.editLine(original, Number(f.get('qty'))), name: l.name }),
                    'Add to round',
                );
            } else if (a === 'serve') await serveFeedback(b, () => serve(b.dataset.line));
            else if (a === 'serveAll') {
                const lines = s.restaurant_details.rounds
                    .flatMap((r) => r.items)
                    .filter((l) => !l.held && l.remaining > 0);
                if (lines.length) {
                    await serveFeedback(b, async () => {
                        await api('post', 'sales/serveKitchenItems', {
                            saleId: s._id,
                            branchId: branch(),
                            requestId: id(),
                            items: lines.map((l) => ({ id: l.id, quantity: l.quantity })),
                    });
                    await refresh();
                    });
                }
            } else if (a === 'editLine') editLine(b.dataset.line);
            else if (a === 'customer') customer();
            else if (a === 'notes') await P.kotWorkspace.notes(s._id);
            else if (a === 'move' || a === 'merge') await P.kotWorkspace.move(s._id, a === 'merge');
            else if (a === 'transfer') await P.kotWorkspace.transfer(s._id);
            else if (a === 'discount') discount();
            else if (a === 'printBill') P.kot.printKOTReceipt(s._id);
            else if (a === 'printKOT') P.kot.printKOTSlip(s._id);
            else if (a === 'pay') {
                if (!window.CaptainPayments)
                    throw new Error('Payment screen is unavailable. Reload the app.');
                await CaptainPayments.open(paymentTable(s), branch());
            } else if (a === 'actions') {
                const d = dialog(
                    'Order actions',
                    '<div class="kv2-choices">' +
                        button('Order details', 'details') +
                        button('Guests', 'guests') +
                        button('Hand over', 'handover') +
                        button('Split payment', 'split') +
                        button('Cancel order', 'cancel') +
                        '</div>',
                    () => {},
                    'Close',
                );
                d.querySelector('section').onclick = (ev) => {
                    const v = ev.target.closest('button');
                    if (!v) return;
                    d.close();
                    run(async () => {
                        if (v.dataset.action === 'details') await P.kotWorkspace.notes(s._id);
                        else if (v.dataset.action === 'guests') await P.kotWorkspace.covers(s._id);
                        else if (v.dataset.action === 'handover') await P.kotWorkspace.handover(s._id);
                        else if (v.dataset.action === 'split') await P.kotWorkspace.split(paymentTable(s));
                        else
                            dialog(
                                'Cancel order',
                                '<label>Reason<textarea name="reason" maxlength="200" required></textarea></label>' +
                                    templates(
                                        [
                                            'Customer changed their mind',
                                            'Item unavailable',
                                            'Duplicate order',
                                        ],
                                        'reason',
                                    ),
                                async (f, modal) => {
                                    await api('post', 'sales/updateOrder', {
                                        ...P.kotWorkspace.editPayload(
                                            s,
                                            s.items.map((l) => P.kot.editLine(l)),
                                        ),
                                        status: 'cancelled',
                                        change_reason: f.get('reason'),
                                    });
                                    modal.close();
                                    P.restaurantFeedback?.play('cancelled');
                                    await refresh();
                                },
                                'Cancel order',
                            );
                    });
                };
            }
        });
    }
    P.kot_v2 = {
        showDataTablePage: open,
        showAdd: open,
        showDetails: (saleId) => {
            state.selected = saleId;
            open();
        },
        refresh,
        state,
    };
    window.addEventListener('captain:payment-recorded', () => {
        if (root()?.offsetParent) {
            P.restaurantFeedback?.play('payment');
            run(refresh);
        }
    });
    window.addEventListener('hashchange', () => {
        state.generation++;
    });
    document.addEventListener('keydown', (e) => {
        if (!root()?.offsetParent || document.querySelector('dialog[open]')) return;
        if (e.key === 'F2') {
            e.preventDefault();
            if (!state.draft) startDraft();
            $('#kv2-search').trigger('focus');
        }
        if (e.ctrlKey && e.key === 'Enter' && state.draft) {
            e.preventDefault();
            run(send);
        }
    });
})();
