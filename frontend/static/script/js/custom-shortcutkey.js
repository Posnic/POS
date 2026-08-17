$(document).ready(function () {
    /*
     * ACL, read safely. Every binding used to reach straight into
     * PosnicPro['userACL'].module.perm - which THROWS when a shortcut is
     * pressed in the seconds before the ACL blob loads, killing the handler
     * for the rest of the session. Absent ACL now simply means "not allowed
     * yet", the same answer the sidebar gives while it waits.
     */
    function aclCan(module, perm) {
        var u = PosnicPro.userACL;
        return !!(u && u[module] && u[module][perm] === true);
    }

    Mousetrap.bind(['s', 'ctrl+1'], function (e) {
        if (aclCan('sales', 'write')) {
            $('#v-pills-manage-tab,#v-pills-report-tab,#v-pills-purchase-tab,#v-pills-customer-tab,#v-pills-inventory-tab').removeClass('active');
            $('#v-pills-manage,#v-pills-report,#v-pills-purchase,#v-pills-customer,#v-pills-inventory').removeClass('show active');
            $('.tool-container').hide();
            var page = "sales/new";
            hasher.setHash(page);
            return !1;
        }
    });

    Mousetrap.bind(['ctrl+2', 'a'], function (e) {
        if (aclCan('sales', 'read')) {
            $('#v-pills-manage-tab,#v-pills-report-tab,#v-pills-purchase-tab,#v-pills-customer-tab,#v-pills-inventory-tab').removeClass('active');
            $('#v-pills-manage,#v-pills-report,#v-pills-purchase,#v-pills-customer,#v-pills-inventory').removeClass('show active');
            $('.tool-container').hide();
            var page = "sales";
            hasher.setHash(page);
            return !1;
        }
    });

    Mousetrap.bind(['ctrl+3', 'f'], function (e) {
        if (aclCan('report', 'read')) {
            $('#v-pills-manage-tab,#v-pills-sales-tab,#v-pills-dashboard-tab,#v-pills-purchase-tab,#v-pills-customer-tab,#v-pills-inventory-tab').removeClass('active');
            $('#v-pills-manage,#v-pills-sales,#v-pills-dashboard,#v-pills-purchase,#v-pills-customer,#v-pills-inventory').removeClass('show active');
            $('.tool-container').hide();
            var page = "salereport";
            hasher.setHash(page);
            return !1;
        }
    });
    Mousetrap.bind(['ctrl+4', 'p'], function (e) {
        if (aclCan('receiving', 'write')) {
            $('#v-pills-manage-tab,#v-pills-report-tab,#v-pills-dashboard-tab,#v-pills-sales-tab,#v-pills-customer-tab,#v-pills-inventory-tab').removeClass('active');
            $('#v-pills-manage,#v-pills-report,#v-pills-dashboard,#v-pills-sales,#v-pills-customer,#v-pills-inventory').removeClass('show active');
            $('.tool-container').hide();
            var page = "receivings/new";
            hasher.setHash(page);
            return !1;
        }
    });
    Mousetrap.bind(['ctrl+5', 'z'], function (e) {
        if (aclCan('receiving', 'read')) {
            $('#v-pills-manage-tab,#v-pills-report-tab,#v-pills-dashboard-tab,#v-pills-sales-tab,#v-pills-customer-tab,#v-pills-inventory-tab').removeClass('active');
            $('#v-pills-manage,#v-pills-report,#v-pills-dashboard,#v-pills-sales,#v-pills-customer,#v-pills-inventory').removeClass('show active');
            $('.tool-container').hide();
            var page = "receivings";
            hasher.setHash(page);
            return !1;
        }
    });
    Mousetrap.bind(['ctrl+6', 'h'], function (e) {
        if (aclCan('report', 'read')) {
            $('#v-pills-manage-tab,#v-pills-sales-tab,#v-pills-dashboard-tab,#v-pills-purchase-tab,#v-pills-customer-tab,#v-pills-inventory-tab').removeClass('active');
            $('#v-pills-manage,#v-pills-sales,#v-pills-dashboard,#v-pills-purchase,#v-pills-customer,#v-pills-inventory').removeClass('show active');
            $('.tool-container').hide();
            var page = "receivingreport";
            hasher.setHash(page);
            return !1;
        }
    });
    Mousetrap.bind(['ctrl+7', 'c'], function (e) {
        if (aclCan('customer', 'write')) {
            $('#v-pills-manage-tab,#v-pills-report-tab,#v-pills-dashboard-tab,#v-pills-sales-tab,#v-pills-purchase-tab,#v-pills-inventory-tab').removeClass('active');
            $('#v-pills-manage,#v-pills-report,#v-pills-dashboard,#v-pills-sales,#v-pills-purchase,#v-pills-inventory').removeClass('show active');
            $('.tool-container').hide();
            var page = "customers/new";
            hasher.setHash(page);
            return !1;
        }
    });
    Mousetrap.bind(['ctrl+8', 'j'], function (e) {
        if (aclCan('customer', 'read')) {
            $('#v-pills-manage-tab,#v-pills-report-tab,#v-pills-dashboard-tab,#v-pills-sales-tab,#v-pills-purchase-tab,#v-pills-inventory-tab').removeClass('active');
            $('#v-pills-manage,#v-pills-report,#v-pills-dashboard,#v-pills-sales,#v-pills-purchase,#v-pills-inventory').removeClass('show active');
            $('.tool-container').hide();
            var page = "customers";
            hasher.setHash(page);
            return !1;
        }
    });
    Mousetrap.bind(['ctrl+9', 'v'], function (e) {
        if (aclCan('customer', 'read')) {
            $('#v-pills-manage-tab,#v-pills-sales-tab,#v-pills-dashboard-tab,#v-pills-purchase-tab,#v-pills-customer-tab,#v-pills-inventory-tab').removeClass('active');
            $('#v-pills-manage,#v-pills-sales,#v-pills-dashboard,#v-pills-purchase,#v-pills-customer,#v-pills-inventory').removeClass('show active');
            $('.tool-container').hide();
            var page = "customerreport";
            hasher.setHash(page);
            return !1;
        }
    });
    Mousetrap.bind(['ctrl+shift+1', 'i'], function (e) {

        if (aclCan('item', 'write')) {
            $('#v-pills-manage-tab,#v-pills-sales-tab,#v-pills-dashboard-tab,#v-pills-purchase-tab,#v-pills-customer-tab,#v-pills-report-tab').removeClass('active');
            $('#v-pills-manage,#v-pills-sales,#v-pills-dashboard,#v-pills-purchase,#v-pills-customer,#v-pills-report').removeClass('show active');
            $('.tool-container').hide();
            var page = "items/new";
            hasher.setHash(page);
            return !1;
        }
    });
    Mousetrap.bind(['ctrl+shift+2', 'm'], function (e) {
        if (aclCan('item', 'read')) {
            $('#v-pills-manage-tab,#v-pills-sales-tab,#v-pills-dashboard-tab,#v-pills-purchase-tab,#v-pills-customer-tab,#v-pills-report-tab').removeClass('active');
            $('#v-pills-manage,#v-pills-sales,#v-pills-dashboard,#v-pills-purchase,#v-pills-customer,#v-pills-report').removeClass('show active');
            $('.tool-container').hide();
            var page = "items";
            hasher.setHash(page);
            return !1;
        }
    });
    Mousetrap.bind(['ctrl+shift+3', 'n'], function (e) {
        if (aclCan('report', 'read')) {
            $('#v-pills-manage-tab,#v-pills-sales-tab,#v-pills-dashboard-tab,#v-pills-purchase-tab,#v-pills-customer-tab,#v-pills-inventory-tab').removeClass('active');
            $('#v-pills-manage,#v-pills-sales,#v-pills-dashboard,#v-pills-purchase,#v-pills-customer,#v-pills-inventory').removeClass('show active');
            $('.tool-container').hide();
            var page = "itemreport";
            hasher.setHash(page);
            return !1;
        }
    });
    Mousetrap.bind(['ctrl+shift+4', 'y'], function (e) {
        if (aclCan('supplier', 'write')) {
            $('#v-pills-manage-tab,#v-pills-report-tab,#v-pills-dashboard-tab,#v-pills-sales-tab,#v-pills-purchase-tab,#v-pills-customer-tab').removeClass('active');
            $('#v-pills-manage,#v-pills-report,#v-pills-dashboard,#v-pills-sales,#v-pills-purchase,#v-pills-customer').removeClass('show active');
            $('.tool-container').hide();
            var page = "suppliers/new";
            hasher.setHash(page);
            return !1;
        }
    });
    Mousetrap.bind(['ctrl+shift+5', 'o'], function (e) {
        if (aclCan('supplier', 'read')) {
            $('#v-pills-manage-tab,#v-pills-report-tab,#v-pills-dashboard-tab,#v-pills-sales-tab,#v-pills-customer-tab').removeClass('active');
            $('#v-pills-manage,#v-pills-report,#v-pills-dashboard,#v-pills-sales,#v-pills-customer').removeClass('show active');
            $('.tool-container').hide();
            var page = "suppliers";
            hasher.setHash(page);
            return !1;
        }
    });
    Mousetrap.bind(['ctrl+shift+6', 'q'], function (e) {
        if (aclCan('report', 'read')) {
            $('#v-pills-manage-tab,#v-pills-sales-tab,#v-pills-dashboard-tab,#v-pills-purchase-tab,#v-pills-customer-tab,#v-pills-inventory-tab').removeClass('active');
            $('#v-pills-manage,#v-pills-sales,#v-pills-dashboard,#v-pills-purchase,#v-pills-customer,#v-pills-inventory').removeClass('show active');
            $('.tool-container').hide();
            var page = "supplierreport";
            hasher.setHash(page);
            return !1;
        }
    });
    Mousetrap.bind(['ctrl+shift+7', 'u'], function (e) {
        if (aclCan('user', 'write')) {
            $('#v-pills-inventory-tab,#v-pills-report-tab,#v-pills-dashboard-tab,#v-pills-sales-tab,#v-pills-purchase-tab,#v-pills-customer-tab').removeClass('active');
            $('#v-pills-inventory,#v-pills-report,#v-pills-dashboard,#v-pills-sales,#v-pills-purchase,#v-pills-customer').removeClass('show active');
            $('.tool-container').hide();
            var page = "users/new";
            hasher.setHash(page);
            return !1;
        }
    });
    Mousetrap.bind(['ctrl+shift+8', 'w'], function (e) {
        if (aclCan('user', 'read')) {
            $('#v-pills-inventory-tab,#v-pills-report-tab,#v-pills-dashboard-tab,#v-pills-sales-tab,#v-pills-purchase-tab,#v-pills-customer-tab').removeClass('active');
            $('#v-pills-inventory,#v-pills-report,#v-pills-dashboard,#v-pills-sales,#v-pills-purchase,#v-pills-customer').removeClass('show active');
            $('.tool-container').hide();
            var page = "users";
            hasher.setHash(page);
            return !1;
        }
    });
    Mousetrap.bind(['ctrl+shift+9', 't'], function (e) {
        if (aclCan('report', 'read')) {
            $('#v-pills-manage-tab,#v-pills-sales-tab,#v-pills-dashboard-tab,#v-pills-purchase-tab,#v-pills-customer-tab,#v-pills-inventory-tab').removeClass('active');
            $('#v-pills-manage,#v-pills-sales,#v-pills-dashboard,#v-pills-purchase,#v-pills-customer,#v-pills-inventory').removeClass('show active');
            $('.tool-container').hide();
            var page = "userreport";
            hasher.setHash(page);
            return !1;
        }
    });
    Mousetrap.bind(['ctrl+d', 'e'], function (e) {
        if (aclCan('expense', 'write')) {
            $('#v-pills-inventory-tab,#v-pills-report-tab,#v-pills-dashboard-tab,#v-pills-sales-tab,#v-pills-purchase-tab,#v-pills-customer-tab').removeClass('active');
            $('#v-pills-inventory,#v-pills-report,#v-pills-dashboard,#v-pills-sales,#v-pills-purchase,#v-pills-customer').removeClass('show active');
            $('.tool-container').hide();
            var page = "expenses/new";
            hasher.setHash(page);
            return !1;
        }
    });
    /*
     * Expenses is "l" alone. Ctrl+L belongs to the lock.
     *
     * Both used to be bound here, and the lock screen binds Ctrl+L too - on
     * separate document listeners, so both fired. The till locked and the page
     * navigated to Expenses behind it, so whoever unlocked found themselves on
     * the wrong screen with the cart gone. A lock has to be the last thing that
     * happens, not one of two.
     */
    Mousetrap.bind(['l'], function (e) {
        if (aclCan('expense', 'read')) {
            $('#v-pills-inventory-tab,#v-pills-report-tab,#v-pills-dashboard-tab,#v-pills-sales-tab,#v-pills-purchase-tab,#v-pills-customer-tab').removeClass('active');
            $('#v-pills-inventory,#v-pills-report,#v-pills-dashboard,#v-pills-sales,#v-pills-purchase,#v-pills-customer').removeClass('show active');
            $('.tool-container').hide();
            var page = "expenses";
            hasher.setHash(page);
            return !1;
        }
    });
    /*
     * Branches is "b" alone: Ctrl+B opens the Backup Manager from the
     * application menu, and a menu accelerator is handled before the page ever
     * sees the key. The pairing was dead on the desktop and alive in a browser,
     * which is how a shortcut gets reported as working on one machine only.
     */
    Mousetrap.bind(['b'], function (e) {
        if (aclCan('branch', 'read')) {
            $('#v-pills-dashboard-tab,#v-pills-sales-tab,#v-pills-inventory-tab,#v-pills-purchase-tab,#v-pills-customer-tab,#v-pills-report-tab').removeClass('active');
            $('#v-pills-dashboard,#v-pills-sales,#v-pills-inventory,#v-pills-purchase,#v-pills-customer,#v-pills-report').removeClass('show active');
            $('.tool-container').hide();
            var page = "branches";
            hasher.setHash(page);
            return !1;
        }
    });
    // Categories is "r" alone. Ctrl+R is Reload, in the menu here and in
    // every browser everywhere; taking it would be surprising even if it worked.
    Mousetrap.bind(['r'], function (e) {
        if (aclCan('category', 'read')) {
            $('#v-pills-dashboard-tab,#v-pills-sales-tab,#v-pills-manage-tab,#v-pills-purchase-tab,#v-pills-customer-tab,#v-pills-report-tab').removeClass('active');
            $('#v-pills-dashboard,#v-pills-sales,#v-pills-manage,#v-pills-purchase,#v-pills-customer,#v-pills-report').removeClass('show active');
            $('.tool-container').hide();
            var page = "categories";
            hasher.setHash(page);
            return !1;
        }
    });

    // ctrl+k now opens the command palette (command-palette.js); the bare
    // letter keeps taking long-time users to stock logs.
    Mousetrap.bind(['k'], function (e) {
        if (aclCan('branch', 'write')) {
            $('#v-pills-dashboard-tab,#v-pills-sales-tab,#v-pills-manage-tab,#v-pills-purchase-tab,#v-pills-customer-tab,#v-pills-report-tab').removeClass('active');
            $('#v-pills-dashboard,#v-pills-sales,#v-pills-manage,#v-pills-purchase,#v-pills-customer,#v-pills-report').removeClass('show active');
            $('.tool-container').hide();
            var page = "stocklogs";
            hasher.setHash(page);
            return !1;
        }
    });
    Mousetrap.bind(['ctrl+g', 'g'], function (e) {
        if (aclCan('branch', 'write')) {
            $('#v-pills-dashboard-tab,#v-pills-sales-tab,#v-pills-inventory-tab,#v-pills-purchase-tab,#v-pills-customer-tab,#v-pills-report-tab').removeClass('active');
            $('#v-pills-dashboard,#v-pills-sales,#v-pills-inventory,#v-pills-purchase,#v-pills-customer,#v-pills-report').removeClass('show active');
            $('.tool-container').hide();
            var page = "settings";
            hasher.setHash(page);
            return !1;
        }
    });
    Mousetrap.bind(['home', 'd'], function (e) {
        if (aclCan('dashboard', 'read')) {
            $('#v-pills-manage-tab,#v-pills-sales-tab,#v-pills-inventory-tab,#v-pills-purchase-tab,#v-pills-customer-tab,#v-pills-report-tab').removeClass('active');
            $('#v-pills-manage,#v-pills-sales,#v-pills-inventory,#v-pills-purchase,#v-pills-customer,#v-pills-report').removeClass('show active');
            $('.tool-container').hide();
            var page = "dashboard";
            hasher.setHash(page);
            return !1;
        }
    });

    /*
     * Working a sale without letting go of the keyboard.
     *
     * A till is driven by a scanner and a keyboard with a queue watching. The
     * shortcuts above move between screens, which is worth having, but there
     * was nothing for the actions a cashier performs a hundred times a day -
     * so every payment meant finding a button with a mouse.
     *
     * Function keys, because that is what every till in every shop has used for
     * thirty years and the muscle memory is already in the room. They are also
     * the only keys safe to bind while somebody is typing: they insert nothing,
     * so a cashier mid-way through a customer's name can still press F9.
     *
     * Which is why this is a plain keydown handler and not Mousetrap. Mousetrap
     * ignores keystrokes inside inputs by design - correct for the letter
     * shortcuts above, and precisely wrong here, because the search box is
     * where the cursor almost always is.
     */
    var TILL_KEYS = {
        F2: {
            label: 'Search item',
            run: function () {
                var box = document.getElementById('sales_new_item_name');
                if (box) { box.focus(); box.select && box.select(); }
            }
        },
        F4: {
            label: 'Hold sale',
            needs: 'write',
            run: function () { $('#holdSaleButton').trigger('click'); }
        },
        F8: {
            label: 'Clear sale',
            needs: 'write',
            // Clear keeps its own confirmation; this only presses the button.
            run: function () { $('#clearSaleButton').trigger('click'); }
        },
        F9: {
            label: 'Complete sale',
            needs: 'write',
            run: function () {
                if (window.PosnicPro && PosnicPro.sales && PosnicPro.sales.addSale &&
                    typeof PosnicPro.sales.addSale.cartOrderSubmit === 'function') {
                    PosnicPro.sales.addSale.cartOrderSubmit();
                }
            }
        }
    };

    /* Label the buttons with their key, or nobody will ever learn them. */
    function labelTillButtons() {
        var pairs = [['#holdSaleButton', 'F4'], ['#clearSaleButton', 'F8'], ['#save_submit', 'F9']];
        for (var i = 0; i < pairs.length; i++) {
            var el = $(pairs[i][0]);
            if (!el.length) continue;
            var existing = (el.attr('title') || '').replace(/\s*\(F\d+\)\s*$/, '');
            el.attr('title', (existing || el.text().trim()) + ' (' + pairs[i][1] + ')');
        }
    }
    $(document).on('shown.bs.modal hidden.bs.modal', labelTillButtons);
    setInterval(labelTillButtons, 4000);   // the cart re-renders constantly

    $(document).bind('keydown', function (e) {
        if (window.location.hash.slice(1) !== '/sales/new') return;

        var binding = TILL_KEYS[e.key];
        if (!binding) return;

        /*
         * Not while a dialog is open.
         *
         * The payment dialog has its own buttons and its own Enter handling;
         * a stray F9 behind it is how one press becomes two sales.
         */
        if (document.querySelector('.modal.show')) return;

        try {
            var acl = PosnicPro['userACL'] && PosnicPro['userACL'].sales;
            if (binding.needs && !(acl && acl[binding.needs] === true)) return;
        } catch (err) {
            return;   // no ACL loaded yet: do nothing rather than guess
        }

        e.preventDefault();
        binding.run();
        return false;
    });

    $(document).bind("keydown", function (e) {
        var hash = window.location.hash.slice(1);
        if (aclCan('sales', 'write') && hash === "/sales/new") {
            if (e.ctrlKey && e.keyCode === 13) {
                // Call the New Sale submit handler directly to avoid triggering
                // multiple hidden/duplicate .save_return_submit buttons, which
                // can create duplicate sales for a single key press.
                if (window.PosnicPro && PosnicPro.sales && PosnicPro.sales.addSale &&
                    typeof PosnicPro.sales.addSale.cartOrderSubmit === 'function') {
                    PosnicPro.sales.addSale.cartOrderSubmit();
                }
                return !1;
            }
        }
    });
});