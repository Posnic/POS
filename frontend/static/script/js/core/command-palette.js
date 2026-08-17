/*
 * Ctrl+K command palette (SEAMLESS_EXPERIENCE S3).
 *
 * One keystroke, type a few letters, Enter - instead of hunting a sidebar
 * of thirty entries. The registry mirrors custom-shortcutkey.js exactly:
 * same pages, same ACL gates, so the palette can never open a door the
 * sidebar keeps shut. Styled entirely on the theme tokens, so it belongs
 * to all eleven themes without knowing any of them.
 *
 * DOM is injected on first open, not at boot: a till that never presses
 * Ctrl+K pays nothing for this file but its parse.
 */
(function () {
    'use strict';

    function aclCan(module, perm) {
        var u = PosnicPro.userACL;
        return !!(u && u[module] && u[module][perm] === true);
    }

    /* name, hash, acl [module, perm], keywords for matching */
    var PAGES = [
        ['New Sale', 'sales/new', ['sales', 'write'], 'bill billing pos sell tender'],
        ['Sales History', 'sales', ['sales', 'read'], 'invoices orders list'],
        ['Sales Report', 'salereport', ['report', 'read'], 'graph analytics'],
        ['Items', 'items', ['item', 'read'], 'products stock inventory'],
        ['Add Item', 'items/new', ['item', 'write'], 'product create'],
        ['Item Report', 'itemreport', ['report', 'read'], 'product analytics'],
        ['Low Stock', 'lowstock', ['item', 'read'], 'reorder empty'],
        ['Stock Logs', 'stocklogs', ['branch', 'write'], 'movements audit'],
        ['Categories', 'categories', ['category', 'read'], 'groups'],
        ['Customers', 'customers', ['customer', 'read'], 'clients'],
        ['Add Customer', 'customers/new', ['customer', 'write'], 'client create'],
        ['Customer Report', 'customerreport', ['customer', 'read'], 'analytics'],
        ['Suppliers', 'suppliers', ['supplier', 'read'], 'vendors'],
        ['Add Supplier', 'suppliers/new', ['supplier', 'write'], 'vendor create'],
        ['Supplier Report', 'supplierreport', ['report', 'read'], 'vendor analytics'],
        ['Receivings', 'receivings', ['receiving', 'read'], 'purchases grn'],
        ['New Receiving', 'receivings/new', ['receiving', 'write'], 'purchase create'],
        ['Receiving Report', 'receivingreport', ['report', 'read'], 'purchase analytics'],
        ['Expenses', 'expenses', ['expense', 'read'], 'costs spend'],
        ['Add Expense', 'expenses/new', ['expense', 'write'], 'cost create'],
        ['Users', 'users', ['user', 'read'], 'staff team'],
        ['Add User', 'users/new', ['user', 'write'], 'staff create'],
        ['Staff Report', 'userreport', ['report', 'read'], 'user analytics'],
        ['Cash Register', 'registers', ['sales', 'read'], 'till drawer open close denomination'],
        ['Register Report', 'registerreport', ['report', 'read'], 'till sessions'],
        ['Branches', 'branches', ['branch', 'read'], 'outlets stores'],
        ['Roles', 'roles', ['user', 'write'], 'permissions access'],
        ['Settings', 'settings', ['branch', 'write'], 'configuration preferences modules'],
        ['Dashboard', 'dashboard', ['dashboard', 'read'], 'home overview charts'],
    ];

    var ACTIONS = [
        {
            name: 'Clock In / Out', keywords: 'shift attendance tips',
            visible: function () { return !!(PosnicPro.shiftWidget && PosnicPro.shiftWidget.openWidget); },
            run: function () { PosnicPro.shiftWidget.openWidget(); },
        },
        {
            name: 'Labour / Payout Report', keywords: 'payroll wages hours staff',
            visible: function () { return aclCan('user', 'read') && !!(PosnicPro.shiftWidget && PosnicPro.shiftWidget.openReport); },
            run: function () { PosnicPro.shiftWidget.openReport(); },
        },
    ];

    function commands() {
        var list = [];
        for (var i = 0; i < PAGES.length; i++) {
            var p = PAGES[i];
            if (!aclCan(p[2][0], p[2][1])) continue;
            list.push({ name: p[0], keywords: p[3], hash: p[1] });
        }
        for (var a = 0; a < ACTIONS.length; a++) {
            if (ACTIONS[a].visible()) list.push(ACTIONS[a]);
        }
        return list;
    }

    /* Prefix beats word-start beats substring; ties keep registry order,
       which is roughly "how often a shop needs it". */
    function score(q, cmd) {
        var hay = (cmd.name + ' ' + cmd.keywords).toLowerCase();
        var name = cmd.name.toLowerCase();
        if (name.indexOf(q) === 0) return 3;
        if (hay.indexOf(' ' + q) !== -1 || name.split(' ').some(function (w) { return w.indexOf(q) === 0; })) return 2;
        if (hay.indexOf(q) !== -1) return 1;
        return 0;
    }

    function matches(query) {
        var all = commands();
        var q = $.trim(query).toLowerCase();
        if (!q) return all.slice(0, 8);
        return all
            .map(function (c) { return { c: c, s: score(q, c) }; })
            .filter(function (x) { return x.s > 0; })
            .sort(function (a, b) { return b.s - a.s; })
            .slice(0, 10)
            .map(function (x) { return x.c; });
    }

    var state = { open: false, results: [], index: 0 };

    function ensureDom() {
        if (document.getElementById('cmdk-overlay')) return;
        var overlay = document.createElement('div');
        overlay.id = 'cmdk-overlay';
        overlay.innerHTML =
            '<div id="cmdk-box" role="dialog" aria-label="Command palette">' +
            '<input id="cmdk-input" type="text" autocomplete="off" spellcheck="false" ' +
            'placeholder="Type a page or action…" aria-label="Search commands">' +
            '<div id="cmdk-list" role="listbox"></div>' +
            '<div id="cmdk-hint">↑↓ navigate &nbsp; Enter open &nbsp; Esc close</div>' +
            '</div>';
        document.body.appendChild(overlay);

        overlay.addEventListener('mousedown', function (ev) {
            if (ev.target === overlay) close();
        });
        var input = document.getElementById('cmdk-input');
        input.addEventListener('input', function () { render(input.value); });
        input.addEventListener('keydown', function (ev) {
            if (ev.key === 'ArrowDown') { state.index = Math.min(state.index + 1, state.results.length - 1); paint(); ev.preventDefault(); }
            else if (ev.key === 'ArrowUp') { state.index = Math.max(state.index - 1, 0); paint(); ev.preventDefault(); }
            else if (ev.key === 'Enter') { pick(state.index); ev.preventDefault(); }
            else if (ev.key === 'Escape') { close(); ev.preventDefault(); }
        });
    }

    function render(query) {
        state.results = matches(query);
        state.index = 0;
        paint();
    }

    function paint() {
        var list = document.getElementById('cmdk-list');
        if (!list) return;
        var html = '';
        for (var i = 0; i < state.results.length; i++) {
            var cmd = state.results[i];
            html += '<div class="cmdk-item' + (i === state.index ? ' cmdk-active' : '') + '" data-i="' + i + '" role="option">' +
                $('<span>').text(cmd.name).html() +
                (cmd.hash ? '' : '<span class="cmdk-kind">action</span>') +
                '</div>';
        }
        if (!state.results.length) html = '<div class="cmdk-empty">Nothing matches</div>';
        list.innerHTML = html;
        $(list).children('.cmdk-item').off('click').on('click', function () {
            pick(Number($(this).data('i')));
        });
    }

    function pick(i) {
        var cmd = state.results[i];
        if (!cmd) return;
        close();
        if (cmd.hash) {
            /* Same cleanup the keyboard shortcuts do: drop every sidebar pill
               highlight so the destination's own show function starts clean. */
            $('[id^="v-pills-"][id$="-tab"]').removeClass('active');
            $('[id^="v-pills-"]').not('[id$="-tab"]').removeClass('show active');
            $('.tool-container').hide();
            hasher.setHash(cmd.hash);
        } else if (cmd.run) {
            try { cmd.run(); } catch (e) { /* the action surfaces its own errors */ }
        }
    }

    function open() {
        ensureDom();
        state.open = true;
        document.getElementById('cmdk-overlay').style.display = 'flex';
        var input = document.getElementById('cmdk-input');
        input.value = '';
        render('');
        setTimeout(function () { input.focus(); }, 0);
    }

    function close() {
        state.open = false;
        var overlay = document.getElementById('cmdk-overlay');
        if (overlay) overlay.style.display = 'none';
    }

    PosnicPro.palette = {
        open: open,
        close: close,
        toggle: function () { state.open ? close() : open(); },
    };

    $(function () {
        if (typeof Mousetrap === 'undefined') return;
        Mousetrap.bind('ctrl+k', function () {
            PosnicPro.palette.toggle();
            return false;
        });
        /* Works from inside inputs too - that is where a cashier's cursor
           lives. Mousetrap skips fields by default, so bind the class-based
           variant as well. */
        if (Mousetrap.bindGlobal) Mousetrap.bindGlobal('ctrl+k', function () {
            PosnicPro.palette.toggle();
            return false;
        });
    });
})();
