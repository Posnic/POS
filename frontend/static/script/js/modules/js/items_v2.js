/* Isolated opt-in route: #/items_v2/new. No existing item or sale handlers are replaced. */
(function (root) {
    'use strict';
    function assess(f) {
        var tracked = f.kind !== 'service' && f.stock === 'tracked';
        var price = Number(f.price), quantity = Number(f.quantity), cost = Number(f.cost);
        if (!String(f.name || '').trim()) return { error: 'Give your item a name.', field: 'iv2-name' };
        if (![price, cost].every(function (n) { return Number.isFinite(n) && n >= 0; })) return { error: 'Enter a valid price of zero or more.', field: 'iv2-price' };
        if (tracked && (!Number.isFinite(quantity) || quantity < 0)) return { error: 'Enter an opening stock quantity of zero or more.', field: 'iv2-quantity' };
        if (!price && !f.confirmZero && !f.openPrice) return { error: 'Add a selling price, or confirm that you want to save it at zero.', field: 'iv2-confirm-zero' };
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
        return { restaurant: businessContext === 'restaurant' || (businessContext === null && P.local.get('table_options') === 'enable'), tax: settings.module_tax_enable !== false, weight: settings.hardware_weight_machine_enable === true, online: settings.module_online_ordering_enable !== false };
    }
    function loadRestaurantOptions() {
        function fill(id, rows, empty) {
            var box = document.getElementById(id), previous = new Set(checkedValues(id)); box.replaceChildren();
            rows.forEach(function (row) {
                if (!row.id || !row.name) return;
                var label = document.createElement('label'); label.className = 'iv2-check';
                var input = document.createElement('input'); input.type = 'checkbox'; input.value = row.id; input.checked = previous.has(String(row.id));
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
    var touched = new Set();
    var bound = false, taxReady = false, taxLoading = false, busy = false, saved = false, attempted = false;
    function value(id) { return document.getElementById(id).value; }
    function selected(name) { var el = document.querySelector('#items_v2 input[name="' + name + '"]:checked'); return el ? el.value : ''; }
    function show(id, yes) { document.getElementById(id).hidden = !yes; }
    function text(id, message) { document.getElementById(id).textContent = message; }
    function fields() {
        var tax = document.getElementById('iv2-tax').selectedOptions[0];
        var category = document.getElementById('iv2-category').selectedOptions[0];
        var details = P.itemsV2Details.status();
        return { name: value('iv2-name'), price: details.family && details.prices.length ? Math.min.apply(null, details.prices) : value('iv2-price'), cost: value('iv2-cost'), quantity: details.family && details.quantities.length ? Math.min.apply(null, details.quantities) : value('iv2-quantity'), kind: selected('iv2-kind'), stock: selected('iv2-stock'), zeroStock: selected('iv2-zero-stock'), confirmZero: document.getElementById('iv2-confirm-zero').checked, openPrice: details.openPrice, family: details.family,
            taxId: taxReady && capabilities.tax ? value('iv2-tax') : '', taxName: capabilities.tax && tax && tax.dataset.name || '', taxRate: capabilities.tax && tax && tax.dataset.rate || 0, taxType: value('iv2-tax-type'), categoryId: value('iv2-category'), categoryName: category && category.dataset.name || '', barcode: value('iv2-barcode'), sku: value('iv2-sku'), description: value('iv2-description') };
    }
    function money(n) { return (P.local.get('currencySign') || '') + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    var previewTimer, previewKey = '', previewSequence = 0;
    function pricePreview(f, details) {
        var params = { price: Number(f.price), tax: details.hsn ? details.tax : Number(f.taxRate), tax_type: f.taxType,
            discount_amount: details.discountType === 'amount' ? details.discount : 0,
            discount_percentage: details.discountType === 'percentage' ? details.discount : 0 };
        var key = JSON.stringify([params, f.family, f.openPrice, taxReady]);
        if (key === previewKey) return;
        previewKey = key; clearTimeout(previewTimer); var sequence = ++previewSequence;
        if (f.family || f.openPrice) {
            text('iv2-price-hint', f.family ? P.i18n.t('lang_item_price_variants', 'Each variant uses its own price and discount.') : P.i18n.t('lang_item_price_open', 'Customer price is entered at the sale.'));
            text('iv2-preview-price', f.family ? P.i18n.t('lang_variants_2', 'Variants') : P.i18n.t('lang_cashier_types_the_price', 'Cashier types the price')); return;
        }
        text('iv2-preview-price', '—');
        text('iv2-price-hint', P.i18n.t('lang_item_price_calculating', 'Checking price…'));
        if (!taxReady || !Number.isFinite(params.price)) return;
        previewTimer = setTimeout(function () {
            P.post({ url: 'items/pricePreview', data: JSON.stringify(params) }, function (r) {
                if (sequence !== previewSequence) return;
                if (!r || r.type !== 'success' || !r.data || !Number.isFinite(Number(r.data.total))) { unavailable(); return; }
                text('iv2-preview-price', money(r.data.total));
                text('iv2-price-hint', P.i18n.t('lang_item_pays_one', 'Customer pays for one: ') + money(r.data.total));
            }, unavailable);
            function unavailable() { if (sequence === previewSequence) { text('iv2-price-hint', P.i18n.t('lang_item_price_unavailable', 'Price preview unavailable. Check the price and tax before saving.')); text('iv2-preview-price', '—'); } }
        }, 200);
    }
    function render() {
        var dishChoice = document.querySelector('#items_v2 input[name="iv2-kind"][value="dish"]');
        dishChoice.closest('label').hidden = !capabilities.restaurant;
        dishChoice.disabled = !capabilities.restaurant;
        document.querySelector('#items_v2 .iv2-types').style.gridTemplateColumns = 'repeat(' + (capabilities.restaurant ? 3 : 2) + ', minmax(0, 1fr))';
        if (!capabilities.restaurant && dishChoice.checked) {
            document.querySelector('#items_v2 input[name="iv2-kind"][value="product"]').checked = true;
            document.querySelector('#items_v2 input[name="iv2-stock"][value="tracked"]').checked = true;
        }
        P.itemsV2Details.update(capabilities, selected('iv2-kind'));
        var f = fields(), a = assess(f), named = !!f.name.trim(), tracked = f.kind !== 'service' && f.stock === 'tracked';
        show('iv2-restaurant', capabilities.restaurant && f.kind !== 'service'); show('iv2-online', capabilities.online);
        var noun = f.kind === 'dish' ? 'dish' : f.kind === 'service' ? 'service' : 'item';
        text('iv2-title', 'Create ' + noun); text('iv2-name-label', noun.charAt(0).toUpperCase() + noun.slice(1) + ' name');
        document.getElementById('iv2-name').placeholder = f.kind === 'dish' ? 'e.g. Tea, Chicken biryani, Butter naan' : f.kind === 'service' ? 'e.g. Haircut, Delivery, Repair' : 'e.g. Mineral water, Blue shirt';
        if (!busy && !saved) text('iv2-save', 'Save ' + noun + ' →');
        var details = P.itemsV2Details.status();
        if (details.hsn) f.taxRate = details.tax;
        var price = Number(f.price);
        show('iv2-zero-price', (attempted || touched.has('iv2-price')) && price === 0 && !f.openPrice);
        show('iv2-quantity-row', tracked && !f.family);
        document.getElementById('iv2-quantity').disabled = !tracked || f.family;
        show('iv2-zero-stock', (attempted || touched.has('iv2-quantity')) && tracked && Number(f.quantity) === 0);
        document.querySelector('#items_v2 input[name="iv2-stock"][value="tracked"]').disabled = f.kind === 'service' || busy || saved;
        text('iv2-stock-note', tracked ? (f.zeroStock === 'negative' ? PosnicPro.i18n.t('lang_for_this_item_only_sales_can_take_its_stoc', 'For this item only: sales can take its stock below zero.') : PosnicPro.i18n.t('lang_stock_tracking_applies_to_this_item_only', 'Stock tracking applies to this item only.')) : 'This item can be sold without an opening stock quantity.');
        text('iv2-preview-name', f.name.trim() || 'Your next item');
        text('iv2-preview-tax', taxReady ? (Number(f.taxRate) ? 'Customer pays · including tax' : 'Customer pays · no tax selected') : 'Loading tax settings');
        pricePreview(f, details);
        P.itemsV2Workspace.update(capabilities);
        var title = !named ? 'Let’s get started' : a.error ? 'A little more to decide' : a.later ? PosnicPro.i18n.t('lang_saved_for_later_not_ready_to_sell', 'Saved for later, not ready to sell') : PosnicPro.i18n.t('lang_ready_to_sell', 'Ready to sell');
        var note = !named ? 'Give your item a name to begin.' : a.error ? a.error : a.later ? 'Add stock before looking for this item in sale search.' : f.openPrice ? 'The cashier enters the price when selling.' : !price ? 'This item will sell at zero. You can edit the price later.' : tracked ? 'Opening stock: ' + a.quantity + '. Your stock choice will be saved.' : 'No stock count needed. Save it and start selling.';
        var panel = document.getElementById('iv2-readiness');
        if (a.error && !attempted) { title = P.i18n.t('lang_iv2_taking_shape', 'Your item is taking shape'); note = P.i18n.t('lang_iv2_optional_hint', 'Enter the essentials. Optional tabs can wait.'); }
        panel.dataset.state = a.error && !attempted ? 'neutral' : a.error || a.later ? 'attention' : 'ready';
        panel.querySelector('strong').textContent = title; panel.querySelector('p').textContent = note;
        document.getElementById('iv2-check-name').dataset.done = String(named);
        document.getElementById('iv2-check-price').dataset.done = String(Number.isFinite(price) && (price > 0 || f.confirmZero || f.openPrice));
        document.getElementById('iv2-check-stock').dataset.done = String(!tracked || Number(f.quantity) > 0 || ['later', 'negative'].includes(f.zeroStock));
    }
    function fail(message, target) {
        text('iv2-error', message); show('iv2-error', true);
        var node = document.getElementById(target || 'iv2-error');
        if (node && node.id === 'iv2-zero-stock') node = node.querySelector('button');
        if (node) { P.itemsV2Workspace.reveal(node); var details = node.closest('details'); if (details) details.open = true; node.focus(); node.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
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
        P.itemsV2Workspace.reset(); touched.clear();
        document.getElementById('iv2-form').reset(); P.itemsV2Details.reset(); applyBusinessContext(); saved = false; attempted = false;
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
        if (!P.itemsV2Workspace.ready()) { fail(P.i18n.t('lang_iv2_draft_lists', 'Some draft selections are unavailable. Reload to retry, or discard the draft before saving.')); return false; }
        var f = fields(), a = assess(f);
        if (a.error) { fail(a.error, a.field); return false; }
        var advancedError = P.itemsV2Details.validate();
        if (advancedError) { fail(advancedError.error, advancedError.field); return false; }
        var form = document.getElementById('iv2-form');
        if (!form.reportValidity()) return false;
        if (!taxReady) { fail('Wait for tax settings to load, or choose Try again above.', 'iv2-tax-error'); return false; }
        var data = Object.assign(payload(f), P.itemsV2Details.data());
        if (capabilities.restaurant && f.kind !== 'service') {
            data.diet = value('iv2-diet'); data.daypart_ids = checkedValues('iv2-periods');
            data.modifier_group_ids = checkedValues('iv2-modifiers'); data.show_on_menu = document.getElementById('iv2-menu').checked;
        }
        if (capabilities.online) data.ecommerce = document.getElementById('iv2-orderable').checked;
        busy = true; show('iv2-error', false); document.getElementById('iv2-fields').disabled = true;
        document.getElementById('iv2-save').disabled = true; text('iv2-save', 'Saving…');
        function unlock() { busy = false; document.getElementById('iv2-fields').disabled = false; document.getElementById('iv2-save').disabled = false; text('iv2-save', 'Save item →'); render(); }
        P.itemsV2Details.upload().then(function(){
        Object.assign(data, P.itemsV2Details.data());
        P.request({ url: f.family ? 'items/createFamily' : 'items', method: 'POST', data: JSON.stringify(f.family ? P.itemsV2Details.family(data) : data) }, function (r) {
            unlock();
            if (!r || r.type !== 'success') { fail(r && r.message || 'Couldn’t save. Your entries are still here.'); return; }
            saved = true; document.getElementById('iv2-fields').disabled = true; document.getElementById('iv2-save').disabled = true; text('iv2-save', 'Saved');
            var id = r.data && (r.data.id || r.data._id || r.data.created && r.data.created[0]);
            P.itemsV2Workspace.saved(data, id, a, f.family);
        }, function (xhr) {
            unlock(); var message = 'Couldn’t confirm the save. Check your item list before trying again.';
            try { message = JSON.parse(xhr.responseText).message || message; } catch (_) { /* preserve the form */ }
            fail(message);
        });
        }).catch(function(error){unlock();fail(error.message);});
        return false;
    }
    function bind() {
        if (bound) return; bound = true;
        var form = document.getElementById('iv2-form'); form.addEventListener('submit', save);
        form.addEventListener('focusout', function (event) { touched.add(event.target.id); if (!saved && !busy) render(); });
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
        P.itemsV2Details.init();
        P.itemsV2Workspace.init({refresh:render,reset:reset,duplicate:function () {
            P.itemsV2Workspace.reset(); saved=false; attempted=false; touched.clear();
            document.getElementById('iv2-fields').disabled=false; document.getElementById('iv2-save').disabled=false;
            ['iv2-sku','iv2-barcode','iv2-gtin','iv2-plu','iv2-alt-barcodes','iv2-quantity'].forEach(function(id){document.getElementById(id).value='';});
            document.querySelectorAll('#items_v2 [name="iv2-zero-stock"]').forEach(function(e){e.checked=false;});
            P.itemsV2Details.duplicate(); render(); document.getElementById('iv2-name').focus();
        }});
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
