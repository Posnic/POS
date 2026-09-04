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
        {
            /* Version surfacing (SW roadmap W3): one screenshotable line
               that tells support which build AND which cache generation a
               till runs - the two can differ when a worker update is still
               pending, which is exactly the case worth seeing. */
            name: 'About This Till', keywords: 'version build cache info support help',
            visible: function () { return true; },
            run: function () {
                var parts = [];
                var finish = function () {
                    PosnicPro.alert('success', parts.join(' · ') || 'No version info available');
                };
                var cachePart = (window.caches && caches.keys)
                    ? caches.keys().then(function (keys) {
                        for (var i = 0; i < keys.length; i++) {
                            if (keys[i].indexOf('posnic-static-') === 0) {
                                parts.push('cache ' + keys[i].slice('posnic-static-'.length, 'posnic-static-'.length + 8));
                                return;
                            }
                        }
                        parts.push('cache none');
                    }).catch(function () {})
                    : Promise.resolve();
                var versionPart = new Promise(function (resolve) {
                    PosnicPro.get({ url: 'runtime-info', data: {} }, function (response) {
                        var d = (response && response.data) || response || {};
                        if (d.version) parts.unshift('Posnic ' + d.version + (d.mode ? ' (' + d.mode + ')' : ''));
                        resolve();
                    }, function () { resolve(); });
                });
                Promise.all([cachePart, versionPart]).then(finish, finish);
            },
        },
        {
            /* The cache doctor (SW roadmap W3): one click instead of the
               "clear site data" support walk-through. Unregisters the
               worker, empties every cache, reloads - the page comes back on
               plain network and re-registers a fresh worker. */
            name: 'Refresh App Cache', keywords: 'clear cache stale doctor reload service worker fix',
            visible: function () { return true; },
            run: function () {
                var done = function () { window.location.reload(); };
                try {
                    var work = [];
                    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
                        work.push(navigator.serviceWorker.getRegistrations().then(function (regs) {
                            return Promise.all(regs.map(function (r) { return r.unregister(); }));
                        }));
                    }
                    if (window.caches && caches.keys) {
                        work.push(caches.keys().then(function (keys) {
                            return Promise.all(keys.map(function (k) { return caches.delete(k); }));
                        }));
                    }
                    Promise.all(work).then(done, done);
                } catch (e) { done(); }
            },
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

    /*
     * Entity search (S3 v2): the same suggestion endpoint the list pages'
     * autocomplete uses, asked for items and customers the query matches.
     * Picking one opens the list ALREADY filtered: the filter is written
     * into the table's data() before navigating, and the page's own load
     * reads it - one fetch, no race with an unfiltered load.
     */
    var ENTITY_SOURCES = [
        { module: 'items', label: 'Item', acl: ['item', 'read'] },
        { module: 'customers', label: 'Customer', acl: ['customer', 'read'] },
    ];

    function searchEntities(query, done) {
        var pending = 0;
        var found = [];
        ENTITY_SOURCES.forEach(function (src) {
            if (!aclCan(src.acl[0], src.acl[1])) return;
            pending++;
            PosnicPro.get({
                url: 'base/autoSuggestionTableField',
                data: 'query=' + encodeURIComponent(query) + '&field=name&module=' + src.module,
            }, function (response) {
                var list = (response && response.data && response.data.suggestions) || [];
                for (var i = 0; i < Math.min(list.length, 4); i++) {
                    var value = list[i] && (list[i].value || list[i]);
                    if (typeof value === 'string' && value) {
                        found.push({ name: value, kind: src.label, module: src.module, value: value });
                    }
                }
                if (--pending === 0) done(found);
            }, function () {
                if (--pending === 0) done(found);
            });
        });
        if (pending === 0) done(found);
    }

    function openEntity(cmd) {
        var module = cmd.module;
        var escaped = cmd.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        var filter = {};
        filter.name = { $regex: '(?=.*' + escaped + ')', $options: 'i' };
        $('#view_' + module + '_fields').val('name');
        $('#view_' + module + '_input').val(cmd.value);
        var table = $('#view_' + module);
        table.data('current_page', 1);
        table.data('filters', JSON.stringify(filter));
        if (window.location.hash.slice(1) === '/' + module) {
            var fn = PosnicPro[module] && PosnicPro[module][module + 'Table'];
            if (fn) fn.call(PosnicPro[module]);
        } else {
            $('[id^="v-pills-"][id$="-tab"]').removeClass('active');
            $('[id^="v-pills-"]').not('[id$="-tab"]').removeClass('show active');
            $('.tool-container').hide();
            hasher.setHash(module);
        }
    }

    var state = { open: false, results: [], index: 0, seq: 0 };

    function ensureDom() {
        if (document.getElementById('cmdk-overlay')) return;
        var overlay = document.createElement('div');
        overlay.id = 'cmdk-overlay';
        overlay.innerHTML =
            '<div id="cmdk-box" role="dialog" aria-label="Command palette" data-t-aria-label="lang_command_palette">' +
            '<input id="cmdk-input" type="text" autocomplete="off" spellcheck="false" ' +
            'placeholder="Type a page or action…" aria-label="Search commands" data-t-aria-label="lang_search_commands">' +
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

    var entityTimer = null;
    function render(query) {
        state.results = matches(query);
        state.index = 0;
        paint();

        /* Entities arrive a beat later, appended below the commands; a stale
           response for an earlier keystroke is ignored. */
        clearTimeout(entityTimer);
        var q = $.trim(query);
        if (q.length < 2) return;
        var seq = ++state.seq;
        entityTimer = setTimeout(function () {
            searchEntities(q, function (found) {
                if (seq !== state.seq || !state.open) return;
                if (found.length) {
                    state.results = state.results.concat(found);
                    paint();
                }
            });
        }, 250);
    }

    function paint() {
        var list = document.getElementById('cmdk-list');
        if (!list) return;
        var html = '';
        for (var i = 0; i < state.results.length; i++) {
            var cmd = state.results[i];
            var kind = cmd.kind ? cmd.kind : (cmd.hash ? '' : 'action');
            html += '<div class="cmdk-item' + (i === state.index ? ' cmdk-active' : '') + '" data-i="' + i + '" role="option">' +
                $('<span>').text(cmd.name).html() +
                (kind ? '<span class="cmdk-kind">' + kind + '</span>' : '') +
                '</div>';
        }
        if (!state.results.length) html = '<div class="cmdk-empty"><lang class="lang_nothing_matches">Nothing matches</lang></div>';
        list.innerHTML = html;
        $(list).children('.cmdk-item').off('click').on('click', function () {
            pick(Number($(this).data('i')));
        });
    }

    function pick(i) {
        var cmd = state.results[i];
        if (!cmd) return;
        close();
        if (cmd.module && cmd.value) {
            openEntity(cmd);
        } else if (cmd.hash) {
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
