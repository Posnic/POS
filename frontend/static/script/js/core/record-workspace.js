/* Presentation only: move existing controls, never clone forms or replace save handlers. */
(function () {
    'use strict';
    function label(key, fallback) {
        // Literal keys keep the translation extractor and staff editor in sync.
        switch (key) {
        case 'lang_record_checkout': fallback = PosnicPro.i18n.t('lang_record_checkout', 'Checkout'); break;
        case 'lang_record_receipts': fallback = PosnicPro.i18n.t('lang_record_receipts', 'Receipts & sharing'); break;
        case 'lang_record_controls': fallback = PosnicPro.i18n.t('lang_record_controls', 'Controls'); break;
        case 'lang_record_regional': fallback = PosnicPro.i18n.t('lang_record_regional', 'Regional & tax'); break;
        case 'lang_vieweditprofile_title': fallback = PosnicPro.i18n.t('lang_vieweditprofile_title', 'Profile Details'); break;
        case 'lang_record_print_details': fallback = PosnicPro.i18n.t('lang_record_print_details', 'Printing details'); break;
        case 'lang_record_access': fallback = PosnicPro.i18n.t('lang_record_access', 'Access & branches'); break;
        case 'lang_record_setup': fallback = PosnicPro.i18n.t('lang_record_setup', 'Registers & setup'); break;
        }
        var node = document.createElement('lang');
        node.className = key;
        node.textContent = PosnicPro.i18n ? PosnicPro.i18n.t(key, fallback) : fallback;
        return node;
    }
    function section(parent, key, title) {
        var box = document.createElement('section');
        box.className = 'record-section';
        var heading = document.createElement('h5');
        heading.appendChild(label(key, title));
        box.appendChild(heading);
        var grid = document.createElement('div');
        grid.className = 'record-grid';
        box.appendChild(grid);
        parent.appendChild(box);
        return grid;
    }
    function moveFields(root, target, ids) {
        ids.forEach(function (id) {
            var input = root.querySelector('#' + id);
            var group = input && input.closest('.form-group');
            if (group && !target.contains(group)) {
                if (group.parentElement.classList.contains('hide_show_user_password')) group.classList.add('hide_show_user_password');
                target.appendChild(group);
            }
        });
    }
    function details(form, key, title, ids) {
        var box = document.createElement('details');
        box.className = 'record-details';
        var summary = document.createElement('summary');
        summary.appendChild(label(key, title));
        box.appendChild(summary);
        var grid = document.createElement('div');
        grid.className = 'record-grid';
        box.appendChild(grid);
        moveFields(form, grid, ids);
        if (grid.children.length) form.appendChild(box);
        return box;
    }
    function formTabs(form, names, choose) {
        var children = Array.from(form.children);
        var nav = document.createElement('div');
        nav.className = 'record-tabs'; nav.setAttribute('role', 'tablist');
        var panels = names.map(function (name, index) {
            var panel = document.createElement('div');
            panel.className = 'record-form-panel'; panel.id = form.id + '-section-' + index;
            panel.setAttribute('role', 'tabpanel');
            var button = document.createElement('button'); button.type = 'button';
            button.id = panel.id + '-tab'; button.setAttribute('role', 'tab');
            button.setAttribute('aria-controls', panel.id); panel.setAttribute('aria-labelledby', button.id);
            button.appendChild(label(name[0], name[1]));
            button.onclick = function () { show(index); };
            button.onkeydown = function (event) {
                if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
                event.preventDefault();
                var next = (index + (event.key === 'ArrowRight' ? 1 : names.length - 1)) % names.length;
                show(next); nav.children[next].focus();
            };
            nav.appendChild(button); form.appendChild(panel); return panel;
        });
        var activeIndex = 0;
        var restoreTimer;
        function show(index) {
            activeIndex = index;
            panels.forEach(function (p, i) { p.hidden = i !== index; nav.children[i].setAttribute('aria-selected', String(i === index)); });
        }
        children.forEach(function (child) {
            if (child.classList.contains('record-actions') || child.matches('input[type="hidden"]')) return;
            panels[choose(child)].appendChild(child);
        });
        form.prepend(nav);
        var actions = form.querySelector('.record-actions');
        if (actions) form.appendChild(actions);
        function validateAll() {
            clearTimeout(restoreTimer);
            restoreTimer = setTimeout(function () { show(activeIndex); }, 0);
            panels.forEach(function (p) { p.hidden = false; });
            form.querySelectorAll('details.record-details').forEach(function (p) { p.open = true; });
        }
        // Reveal before native and jQuery validation, so hidden sections never skip required fields.
        form.addEventListener('click', function (event) { if (event.target.closest('button[type="submit"],#clicksubmit')) validateAll(); }, true);
        form.addEventListener('keydown', function (event) { if (event.key === 'Enter' && event.target.tagName !== 'TEXTAREA' && event.target.tagName !== 'BUTTON') validateAll(); }, true);
        form.addEventListener('submit', validateAll, true);
        function reveal(input) {
            var disclosure = input.closest('details');
            if (disclosure) disclosure.open = true;
            var index = panels.findIndex(function (p) { return p.contains(input); });
            if (index >= 0) show(index);
        }
        $(form).on('record-reveal', function (event, input) { reveal(input); });
        form.addEventListener('invalid', function (event) { reveal(event.target); }, true);
        $(form).on('invalid-form.recordWorkspace', function (event, validator) {
            if (validator.errorList.length) reveal(validator.errorList[0].element);
        });
        show(0);
    }
    function decorateDialog(panel) {
        if (!panel || panel.dataset.recordReady) return;
        var form = panel.querySelector('form');
        if (!form) return;
        panel.dataset.recordReady = 'true';
        panel.classList.add('record-dialog');
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.addEventListener('keydown', function (event) {
            if (event.key !== 'Tab') return;
            var focusable = Array.from(panel.querySelectorAll('button,a[href],input,select,textarea')).filter(function (node) {
                return !node.disabled && node.tabIndex !== -1 && node.getClientRects().length;
            });
            var first = focusable[0], last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        });
        var heading = panel.querySelector('.infobar-settings-sidebar-head h4');
        if (heading) {
            heading.id = panel.id + '-heading';
            panel.setAttribute('aria-labelledby', heading.id);
        }
        // Keep every button and its existing handler, including Reset on edits.
        var submit = form.querySelector('button[type="submit"]') || panel.querySelector('#clicksubmit');
        if (submit) {
            var actions = submit.closest('.form-row') || submit.parentElement;
            actions.classList.add('record-actions');
            form.appendChild(actions);
            submit.classList.remove('btn-outline-primary');
            submit.classList.add('btn-primary');
        }
        // Optional sections must not cause jQuery Validate to skip their fields.
        form.addEventListener('submit', function () {
            form.querySelectorAll('details.record-details').forEach(function (node) { node.open = true; });
        }, true);
        form.addEventListener('invalid', function (event) {
            var box = event.target.closest('details');
            if (box) box.open = true;
        }, true);
        panel.querySelectorAll('input,select,textarea').forEach(function (input) {
            input.addEventListener('focus', function () {
                var box = input.closest('details');
                if (box) box.open = true;
            });
        });
    }
    function contacts(kind, formId) {
        var form = document.getElementById(formId);
        if (!form) return;
        var basics = section(form, kind === 'customer' ? 'lang_newcustomer_title' : 'lang_newsupplier_title', kind === 'customer' ? PosnicPro.i18n.t('lang_newcustomer_title', 'Customer') : PosnicPro.i18n.t('lang_newsupplier_title', 'Supplier'));
        moveFields(form, basics, [kind + '_name', kind + '_phone', kind + '_email']);
        var address = section(form, 'lang_address_title', 'Address');
        moveFields(form, address, [kind + '_address', kind + '_country', kind + '_state', kind + '_city']);
        if (kind === 'customer') details(form, 'lang_choosecategory_title', 'Category', ['customer_category', 'customer_referrer_name']);
        // Leave tax/credit controls and their conditional visibility intact, below identity.
        form.prepend(basics.parentElement, address.parentElement);
        form.querySelectorAll(':scope > .form-row').forEach(function (row) {
            if (!row.children.length) row.remove();
        });
        decorateDialog(form.closest('.infobar-settings-sidebar'));
    }
    function shapes() {
        document.querySelectorAll('#category_tile_shapes .tile-shape, #category_tile_swatches .tile-swatch').forEach(function (old) {
            var button = document.createElement('button');
            button.type = 'button';
            Array.from(old.attributes).forEach(function (attr) {
                if (attr.name !== 'style' && attr.name !== 'title' && attr.name !== 'data-t-title') button.setAttribute(attr.name, attr.value);
            });
            var shape = old.dataset.shape;
            button.setAttribute('aria-pressed', old.classList.contains('is-picked') ? 'true' : 'false');
            if (shape) {
                var glyph = document.createElement('span');
                glyph.className = 'record-shape record-shape-' + shape;
                glyph.setAttribute('aria-hidden', 'true');
                button.appendChild(glyph);
                button.appendChild(label('lang_' + shape, shape.charAt(0).toUpperCase() + shape.slice(1)));
            } else {
                button.style.backgroundColor = old.dataset.color || 'transparent';
                button.setAttribute('aria-label', old.dataset.color || 'Default');
                if (!old.dataset.color) button.textContent = '×';
            }
            old.replaceWith(button);
        });
    }
    function sales() {
        var root = document.getElementById('core-tab-sale');
        if (!root) return;
        root.classList.add('record-sales');
        var original = Array.from(root.children);
        var nav = document.createElement('div');
        nav.className = 'record-tabs';
        nav.setAttribute('role', 'tablist');
        var names = [['lang_record_checkout', 'Checkout'], ['lang_sales_item_search', 'Product search'], ['lang_record_receipts', 'Receipts & sharing'], ['lang_record_controls', 'Controls']];
        var panels = names.map(function (name, index) {
            var panel = document.createElement('div');
            panel.className = 'record-sales-panel';
            panel.id = 'record-sales-panel-' + index;
            panel.setAttribute('role', 'tabpanel');
            panel.hidden = index !== 0;
            var button = document.createElement('button');
            button.type = 'button';
            button.id = 'record-sales-tab-' + index;
            button.setAttribute('role', 'tab');
            button.setAttribute('aria-controls', panel.id);
            button.setAttribute('aria-selected', index === 0 ? 'true' : 'false');
            panel.setAttribute('aria-labelledby', button.id);
            button.appendChild(label(name[0], name[1]));
            button.addEventListener('click', function () {
                panels.forEach(function (p, i) { p.hidden = i !== index; nav.children[i].setAttribute('aria-selected', i === index ? 'true' : 'false'); });
            });
            button.addEventListener('keydown', function (event) {
                if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
                event.preventDefault();
                var next = (index + (event.key === 'ArrowRight' ? 1 : 3)) % 4;
                nav.children[next].click(); nav.children[next].focus();
            });
            nav.appendChild(button);
            root.appendChild(panel);
            return panel;
        });
        root.prepend(nav);
        var search = root.querySelector('#sales_search_custom_fields');
        if (search) panels[1].appendChild(search.closest('fieldset'));
        var controls = ['allow_sale_date_edit', 'allow_payment_correction', 'allow_sale_hard_delete', 'pl_include_cashbook'];
        var sharing = ['sales_sms', 'whatsapp_receipt', 'set_share_customers', 'set_share_suppliers'];
        original.forEach(function (block) {
            if (block.parentElement !== root) return;
            if (block.matches('.form-row,.row')) {
                Array.from(block.children).forEach(function (group) {
                    var target = controls.some(function (id) { return group.querySelector('#' + id); }) ? 3 : sharing.some(function (id) { return group.querySelector('#' + id); }) ? 2 : 0;
                    panels[target].appendChild(group);
                });
                block.remove();
            } else panels[block.id === 'sharing_fieldset' ? 2 : 0].appendChild(block);
        });
        var form = root.closest('form');
        if (form) {
            form.addEventListener('submit', function () {
                if (!root.classList.contains('active')) return;
                panels.forEach(function (panel) { panel.hidden = false; });
                // Existing validation runs synchronously; restore the selected section afterwards.
                setTimeout(function () {
                    panels.forEach(function (panel, index) { panel.hidden = nav.children[index].getAttribute('aria-selected') !== 'true'; });
                }, 0);
            }, true);
            $(form).on('invalid-form.recordSales', function (event, validator) {
                var input = validator.errorList.length && validator.errorList[0].element;
                var index = panels.findIndex(function (panel) { return input && panel.contains(input); });
                if (index >= 0) nav.children[index].click();
            });
        }
    }
    function branchEdit() {
        var form = document.getElementById('setting_add');
        if (!form) return;
        var page = form.closest('#branchedit_new');
        if (!page) return;
        page.classList.add('record-branch-page');
        var basics = section(form, 'lang_shopinfo', 'Branch / Outlet Info');
        moveFields(form, basics, ['store_name', 'store_email', 'store_telephone', 'store_alternativephone', 'store_address', 'setting_country', 'setting_state', 'city', 'pincode']);
        var regional = section(form, 'lang_record_regional', 'Regional & tax');
        moveFields(form, regional, ['currency_setting', 'currency_type', 'time_zone', 'storedate', 'branch_gstin_number']);
        details(form, 'lang_record_print_details', 'Printing details', ['printing_address', 'website']);
        form.prepend(basics.parentElement, regional.parentElement);
        var submit = form.querySelector('button[type="submit"]');
        if (submit) {
            var actions = submit.closest('.card-footer') || submit.parentElement;
            actions.classList.add('record-actions');
            form.appendChild(actions);
        }
        formTabs(form, [['lang_shopinfo', 'Branch / Outlet Info'], ['lang_record_regional', 'Regional & tax'], ['lang_record_setup', 'Registers & setup']], function (child) {
            if (child === basics.parentElement) return 0;
            if (child === regional.parentElement) return 1;
            return 2;
        });
    }
    var initialized = false;
    function init() {
        if (initialized) return;
        initialized = true;
        contacts('customer', 'customer_add_form');
        contacts('supplier', 'supplier_add');
        ['users', 'branch', 'category', 'customercategory', 'variant', 'unit', 'tax', 'taxgroup', 'payment', 'denomcash', 'expense', 'tableorder'].forEach(function (name) {
            var panel = document.getElementById('infobar-settings-sidebar-' + name);
            decorateDialog(panel);
            if (panel && !['users', 'branch', 'category'].includes(name)) panel.classList.add('record-dialog-small');
        });
        var branch = document.getElementById('branch_add_form');
        if (branch) {
            var identity = section(branch, 'lang_shopinfo', 'Branch / Outlet Info');
            moveFields(branch, identity, ['name_branch', 'branch_phone', 'branch_email']);
            var location = section(branch, 'lang_address_title', 'Address');
            moveFields(branch, location, ['branch_address', 'branch_country', 'branch_state', 'branch_city']);
            branch.prepend(identity.parentElement, location.parentElement);
            var branchActions = branch.querySelector('.record-actions');
            if (branchActions) branch.appendChild(branchActions);
            formTabs(branch, [['lang_shopinfo', 'Branch / Outlet Info'], ['lang_record_regional', 'Regional & tax'], ['lang_record_setup', 'Registers & setup']], function (child) {
                return child === identity.parentElement || child === location.parentElement ? 0 : child.id === 'branch_regional_fields' ? 1 : 2;
            });
        }
        var user = document.getElementById('user_form_upload');
        if (user) {
            var profile = section(user, 'lang_vieweditprofile_title', 'Profile Details');
            profile.parentElement.classList.add('record-staff-profile');
            moveFields(user, profile, ['users_firstname', 'users_lastname', 'users_name', 'users_email', 'users_password', 'users_retype_password']);
            user.prepend(profile.parentElement);
            var photo = user.querySelector('.profilebox');
            if (photo) user.prepend(photo);
            var actions = user.querySelector('.record-actions');
            if (actions) user.appendChild(actions);
            formTabs(user, [['lang_vieweditprofile_title', 'Profile Details'], ['lang_record_access', 'Access & branches']], function (child) {
                return child.querySelector('#branchtype,#choose_register,#click_collapse') ? 1 : 0;
            });
            var accountTypes = user.querySelector('#defaultMethod').closest('.row.m-b-20');
            accountTypes.classList.add('record-account-types');
            user.prepend(accountTypes);
            var status = user.querySelector('#ActiveMethod').closest('.col-md-12.mt-5');
            status.classList.add('record-account-status');
            user.insertBefore(status, user.querySelector('.record-actions'));
        }
        shapes(); sales(); branchEdit();
        document.querySelectorAll('.record-dialog .form-row,.record-dialog .row').forEach(function (row) {
            if (!row.textContent.trim() && !row.querySelector('input,select,textarea,button,a,img')) row.remove();
        });
    }
    PosnicPro.recordWorkspace = { init: init };
    $(init);
}());
