/* Isolated opt-in route: #/items_v2/new. No existing item or sale handlers are replaced. */
(function (root) {
    'use strict';
    function assess(f) {
        var tracked = f.kind !== 'service' && f.stock === 'tracked';
        var price = Number(f.price), quantity = Number(f.quantity), cost = Number(f.cost);
        if (!String(f.name || '').trim()) return { error: 'Give your item a name.', field: 'iv2-name' };
        if (![price, cost].every(function (n) { return Number.isFinite(n) && n >= 0; })) return { error: 'Enter a valid price of zero or more.', field: 'iv2-price' };
        if (tracked && (!Number.isFinite(quantity) || quantity < 0)) return { error: 'Enter an opening stock quantity of zero or more.', field: 'iv2-quantity' };
        if (!price && !f.confirmZero) return { error: 'Add a selling price, or confirm that you want to save it at zero.', field: 'iv2-confirm-zero' };
        if (tracked && !quantity && !['negative', 'later'].includes(f.zeroStock)) return { error: 'Choose how to handle this item’s zero stock.', field: 'iv2-zero-stock' };
        return { tracked: tracked, price: price, quantity: tracked ? quantity : 0, negative: tracked && f.zeroStock === 'negative', later: tracked && quantity === 0 && f.zeroStock === 'later' };
    }
    function payload(f) {
        var a = assess(f);
        if (a.error) throw new Error(a.error);
        return { name: f.name.trim(), selling_price: a.price, company_price: Number(f.cost), available_quantity: a.quantity,
            inventory: a.tracked, negative_stock: a.negative, item_kind: f.kind === 'service' ? 'service' : 'product', service_unit: 'fixed',
            tax_id: f.taxId || '', tax_name: f.taxName || '', tax: Number(f.taxRate) || 0, tax_type: f.taxType,
            category_id: f.categoryId || '', category_name: f.categoryName || '', barcode_id: f.barcode.trim(), sku_id: f.sku.trim(),
            description: f.description.trim(), unit: 'qty', ecommerce: false, open_price: false, item_weight_machine_based: false };
    }
    if (typeof module === 'object' && module.exports) { module.exports = { assess: assess, payload: payload }; return; }
    var P = root.PosnicPro, $ = root.jQuery;
    var businessContext = null, capabilities = {};
    function readCapabilities() {
        var settings = {};
        try { settings = JSON.parse(P.local.get('general_settings') || '{}'); } catch (_) {}
        return { restaurant: businessContext === 'restaurant' || (businessContext === null && P.local.get('table_options') === 'enable'), tax: settings.module_tax_enable !== false, online: settings.module_online_ordering_enable !== false };
    }
    function loadRestaurantOptions() {
        function fill(id, rows, empty) {
            var box = document.getElementById(id); box.replaceChildren();
            rows.forEach(function (row) {
                if (!row.id || !row.name) return;
                var label = document.createElement('label'); label.className = 'iv2-check';
                var input = document.createElement('input'); input.type = 'checkbox'; input.value = row.id;
                label.append(input, document.createTextNode(row.name)); box.appendChild(label);
            });
            if (!box.children.length) box.textContent = empty;
        }
        P.get({ url: 'settings/group/channels', data: {} }, function (r) {
            var rows = r && r.data && r.data.values && r.data.values.menu_dayparts;
            fill('iv2-periods', Array.isArray(rows) ? rows : [], 'No serving periods set. Add them in Restaurant → Menu.');
        }, function () { text('iv2-periods', 'Serving periods could not load. You can add them from the full editor later.'); });
        P.get({ url: 'setting/modifierGroups', data: {} }, function (r) {
            fill('iv2-modifiers', r && Array.isArray(r.data) ? r.data : [], 'No modifier groups set. Add them in Restaurant settings.');
        }, function () { text('iv2-modifiers', 'Modifier groups could not load. You can add them from the full editor later.'); });
    }
    function checkedValues(id) { return Array.from(document.querySelectorAll('#' + id + ' input:checked')).map(function (el) { return el.value; }); }
    function applyBusinessContext() {
        var restaurant = businessContext === 'restaurant' || (businessContext === null && P.local.get('table_options') === 'enable');
        var kind = restaurant ? 'dish' : businessContext === 'service' ? 'service' : 'product';
        document.querySelector('#items_v2 input[name="iv2-kind"][value="' + kind + '"]').checked = true;
        document.querySelector('#items_v2 input[name="iv2-stock"][value="' + (kind === 'product' ? 'tracked' : 'untracked') + '"]').checked = true;
        text('iv2-product-label', restaurant ? PosnicPro.i18n.t('lang_packaged_product', 'Packaged product') : PosnicPro.i18n.t('lang_retail_product', 'Retail product'));
    }
    var bound = false, taxReady = false, taxLoading = false, busy = false, saved = false, attempted = false;
    function value(id) { return document.getElementById(id).value; }
    function selected(name) { var el = document.querySelector('#items_v2 input[name="' + name + '"]:checked'); return el ? el.value : ''; }
    function show(id, yes) { document.getElementById(id).hidden = !yes; }
    function text(id, message) { document.getElementById(id).textContent = message; }
    function fields() {
        var tax = document.getElementById('iv2-tax').selectedOptions[0];
        var category = document.getElementById('iv2-category').selectedOptions[0];
        return { name: value('iv2-name'), price: value('iv2-price'), cost: value('iv2-cost'), quantity: value('iv2-quantity'), kind: selected('iv2-kind'), stock: selected('iv2-stock'), zeroStock: selected('iv2-zero-stock'), confirmZero: document.getElementById('iv2-confirm-zero').checked,
            taxId: taxReady && capabilities.tax ? value('iv2-tax') : '', taxName: capabilities.tax && tax && tax.dataset.name || '', taxRate: capabilities.tax && tax && tax.dataset.rate || 0, taxType: value('iv2-tax-type'), categoryId: value('iv2-category'), categoryName: category && category.dataset.name || '', barcode: value('iv2-barcode'), sku: value('iv2-sku'), description: value('iv2-description') };
    }
    function money(n) { return (P.local.get('currencySign') || '') + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function render() {
        var f = fields(), a = assess(f), named = !!f.name.trim(), tracked = f.kind !== 'service' && f.stock === 'tracked';
        show('iv2-restaurant', capabilities.restaurant && f.kind !== 'service'); show('iv2-online', capabilities.online);
        var noun = f.kind === 'dish' ? 'dish' : f.kind === 'service' ? 'service' : 'item';
        text('iv2-title', 'Create ' + noun); text('iv2-name-label', noun.charAt(0).toUpperCase() + noun.slice(1) + ' name');
        document.getElementById('iv2-name').placeholder = f.kind === 'dish' ? 'e.g. Tea, Chicken biryani, Butter naan' : f.kind === 'service' ? 'e.g. Haircut, Delivery, Repair' : 'e.g. Mineral water, Blue shirt';
        if (!busy && !saved) text('iv2-save', 'Save ' + noun + ' →');
        var price = Number(f.price), total = f.taxType === 'exclusive' ? price * (1 + Number(f.taxRate) / 100) : price;
        show('iv2-zero-price', (named || attempted) && price === 0);
        show('iv2-quantity-row', tracked);
        show('iv2-zero-stock', (named || attempted) && tracked && Number(f.quantity) === 0);
        document.querySelector('#items_v2 input[name="iv2-stock"][value="tracked"]').disabled = f.kind === 'service' || busy || saved;
        text('iv2-stock-note', tracked ? (f.zeroStock === 'negative' ? PosnicPro.i18n.t('lang_for_this_item_only_sales_can_take_its_stoc', 'For this item only: sales can take its stock below zero.') : PosnicPro.i18n.t('lang_stock_tracking_applies_to_this_item_only', 'Stock tracking applies to this item only.')) : 'This item can be sold without an opening stock quantity.');
        text('iv2-preview-name', f.name.trim() || 'Your next item');
        text('iv2-preview-price', Number.isFinite(total) ? money(total) : '—');
        text('iv2-preview-tax', taxReady ? (Number(f.taxRate) ? 'Customer pays · including tax' : 'Customer pays · no tax selected') : 'Loading tax settings');
        text('iv2-price-hint', taxReady && Number.isFinite(total) ? 'Customer pays ' + money(total) + (Number(f.taxRate) ? ', including tax.' : '.') : 'Checking your tax settings…');
        var title = !named ? 'Let’s get started' : a.error ? 'A little more to decide' : a.later ? PosnicPro.i18n.t('lang_saved_for_later_not_ready_to_sell', 'Saved for later, not ready to sell') : PosnicPro.i18n.t('lang_ready_to_sell', 'Ready to sell');
        var note = !named ? 'Give your item a name to begin.' : a.error ? a.error : a.later ? 'Add stock before looking for this item in sale search.' : !price ? 'This item will sell at zero. You can edit the price later.' : tracked ? 'Opening stock: ' + a.quantity + '. Your stock choice will be saved.' : 'No stock count needed. Save it and start selling.';
        var panel = document.getElementById('iv2-readiness');
        panel.dataset.state = a.error || a.later ? 'attention' : 'ready';
        panel.querySelector('strong').textContent = title; panel.querySelector('p').textContent = note;
        document.getElementById('iv2-check-name').dataset.done = String(named);
        document.getElementById('iv2-check-price').dataset.done = String(Number.isFinite(price) && (price > 0 || f.confirmZero));
        document.getElementById('iv2-check-stock').dataset.done = String(!tracked || Number(f.quantity) > 0 || ['later', 'negative'].includes(f.zeroStock));
    }
    function fail(message, target) {
        text('iv2-error', message); show('iv2-error', true);
        var node = document.getElementById(target || 'iv2-error');
        if (node && node.id === 'iv2-zero-stock') node = node.querySelector('button');
        if (node) { var details = node.closest('details'); if (details) details.open = true; node.focus(); node.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    }
    function loadTax() {
        if (!capabilities.tax) { taxReady = true; show('iv2-tax-error', false); return; }
        if (taxLoading) return;
        taxLoading = true; taxReady = false; show('iv2-tax-error', false);
        P.get({ url: 'setting/getTaxAll', data: { tax_group: 'all' } }, function (r) {
            taxLoading = false;
            if (!r || !Array.isArray(r.data)) { show('iv2-tax-error', true); return; }
            var select = document.getElementById('iv2-tax'); select.replaceChildren(new Option('No tax', ''));
            r.data.forEach(function (tax) { var option = new Option(tax.tax_name, tax.tax_id); option.dataset.name = tax.tax_name; option.dataset.rate = tax.tax_value; select.add(option); });
            var def = P.local.get('default_tax_id');
            if (def && Array.from(select.options).some(function (o) { return o.value === String(def); })) select.value = def;
            select.disabled = busy || saved; taxReady = true; render();
        }, function () { taxLoading = false; show('iv2-tax-error', true); });
    }
    function reset() {
        document.getElementById('iv2-form').reset(); applyBusinessContext(); saved = false; attempted = false;
        document.getElementById('iv2-fields').disabled = false;
        document.getElementById('iv2-save').disabled = false;
        text('iv2-save', 'Save item →'); show('iv2-success', false); show('iv2-error', false);
        document.getElementById('iv2-tax-type').value = P.local.get('tax_type') === 'exclusive' ? 'exclusive' : 'inclusive';
        var def = P.local.get('default_tax_id');
        if (def && Array.from(document.getElementById('iv2-tax').options).some(function (o) { return o.value === String(def); })) document.getElementById('iv2-tax').value = def;
        render(); document.getElementById('iv2-name').focus();
    }
    function save(event) {
        if (event) event.preventDefault();
        if (busy || saved) return false;
        if (P.aclLoaded && P.aclLoaded() && !P.checkAccess('item', 'write')) { fail('You don’t have permission to create items.'); return false; }
        attempted = true; render();
        var f = fields(), a = assess(f);
        if (a.error) { fail(a.error, a.field); return false; }
        var form = document.getElementById('iv2-form');
        if (!form.reportValidity()) return false;
        if (!taxReady) { fail('Wait for tax settings to load, or choose Try again above.', 'iv2-tax-error'); return false; }
        var data = payload(f);
        if (capabilities.restaurant && f.kind !== 'service') {
            data.diet = value('iv2-diet'); data.daypart_ids = checkedValues('iv2-periods');
            data.modifier_group_ids = checkedValues('iv2-modifiers'); data.show_on_menu = document.getElementById('iv2-menu').checked;
        }
        if (capabilities.online) data.ecommerce = document.getElementById('iv2-orderable').checked;
        busy = true; show('iv2-error', false); document.getElementById('iv2-fields').disabled = true;
        document.getElementById('iv2-save').disabled = true; text('iv2-save', 'Saving…');
        function unlock() { busy = false; document.getElementById('iv2-fields').disabled = false; document.getElementById('iv2-save').disabled = false; text('iv2-save', 'Save item →'); render(); }
        P.request({ url: 'items', method: 'POST', data: JSON.stringify(data) }, function (r) {
            unlock();
            if (!r || r.type !== 'success') { fail(r && r.message || 'Couldn’t save. Your entries are still here.'); return; }
            saved = true; document.getElementById('iv2-fields').disabled = true; document.getElementById('iv2-save').disabled = true; text('iv2-save', 'Saved');
            var banner = document.getElementById('iv2-success'); banner.replaceChildren();
            var message = document.createElement('strong'); message.textContent = f.name.trim() + ' saved. ' + (a.later ? 'Add stock before selling.' : !a.price ? PosnicPro.i18n.t('lang_selling_price_is_zero', 'Selling price is zero.') : PosnicPro.i18n.t('lang_ready_to_sell_2', 'Ready to sell.')); banner.appendChild(message);
            var another = document.createElement('button'); another.type = 'button'; another.textContent = 'Create another'; another.onclick = reset; banner.appendChild(another);
            var id = r.data && (r.data.id || r.data._id);
            if (id && /^[a-zA-Z0-9_-]+$/.test(String(id))) { var link = document.createElement('a'); link.href = '#/items/' + encodeURIComponent(id) + '/edit'; link.textContent = 'Edit full details'; banner.appendChild(link); }
            show('iv2-success', true); banner.scrollIntoView({ block: 'start', behavior: 'smooth' }); another.focus();
        }, function (xhr) {
            unlock(); var message = 'Couldn’t confirm the save. Check your item list before trying again.';
            try { message = JSON.parse(xhr.responseText).message || message; } catch (_) { /* preserve the form */ }
            fail(message);
        });
        return false;
    }
    function bind() {
        if (bound) return; bound = true;
        var form = document.getElementById('iv2-form'); form.addEventListener('submit', save);
        form.addEventListener('input', function (event) {
            if (event.target.id === 'iv2-name' || event.target.id === 'iv2-price') document.getElementById('iv2-confirm-zero').checked = false;
            if (event.target.id === 'iv2-quantity') document.querySelectorAll('#items_v2 input[name="iv2-zero-stock"]').forEach(function (el) { el.checked = false; });
            show('iv2-error', false); render();
        });
        form.addEventListener('change', function (event) {
            var el = event.target;
            if (el.name === 'iv2-kind') {
                document.querySelector('#items_v2 input[name="iv2-stock"][value="' + (el.value === 'product' ? 'tracked' : 'untracked') + '"]').checked = true;
                document.querySelectorAll('#items_v2 input[name="iv2-zero-stock"]').forEach(function (node) { node.checked = false; });
            }
            if (el.name === 'iv2-zero-stock' && el.value === 'untracked') document.querySelector('#items_v2 input[name="iv2-stock"][value="untracked"]').checked = true;
            render();
        });
        form.addEventListener('click', function (event) {
            var button = event.target.closest('[data-iv2-action]');
            var action = button && button.dataset.iv2Action;
            if (action === 'retry') loadTax();
            if (action === 'add-stock') document.getElementById('iv2-quantity').focus();
        });
        document.getElementById('iv2-name').addEventListener('keydown', function (event) { if (event.key === 'Enter') { event.preventDefault(); document.getElementById('iv2-price').focus(); } });
        document.getElementById('iv2-price').addEventListener('keydown', function (event) { if (event.key === 'Enter') { event.preventDefault(); if (selected('iv2-stock') === 'tracked') document.getElementById('iv2-quantity').focus(); else save(); } });
    }
    function open() {
        if (P.HideSideBarModal) P.HideSideBarModal();
        $('.page_loader,#osk-container').hide(); $('#items_v2').show();
        capabilities = readCapabilities();
        show('iv2-tax-field', capabilities.tax); document.getElementById('iv2-tax-type').hidden = !capabilities.tax;
        if (!bound) applyBusinessContext();
        if (capabilities.restaurant) loadRestaurantOptions();
        bind(); document.querySelectorAll('#items_v2 .iv2-currency').forEach(function (el) { el.textContent = P.local.get('currencySign') || ''; });
        if (!taxReady) { document.getElementById('iv2-tax-type').value = P.local.get('tax_type') === 'exclusive' ? 'exclusive' : 'inclusive'; loadTax(); }
        P.get({ url: 'categories/getCategoryAjaxList', data: 'query=' }, function (r) {
            var select = document.getElementById('iv2-category'), previous = select.value;
            select.replaceChildren(new Option('No category', ''));
            ((r && r.suggestions) || []).forEach(function (c) { var option = new Option(c.name, c.id); option.dataset.name = c.name; select.add(option); }); select.value = previous;
        }, function () { /* category is optional */ });
        render(); document.getElementById('iv2-name').focus();
    }
    P.items_v2 = { showAdd: open, showDataTablePage: open, setBusinessContext: function (category) {
        businessContext = ['restaurant', 'retail', 'service'].includes(category) ? category : null;
        if (bound) { capabilities = readCapabilities(); reset(); if (capabilities.restaurant) loadRestaurantOptions(); }
    } };
}(typeof window === 'undefined' ? globalThis : window));
