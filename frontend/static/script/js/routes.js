var currentHash = '';
/*
 * The report pages live in a lazy chunk (bundle-split slice 2). A route
 * whose module is not on the window yet loads the chunk once and retries;
 * a module the chunk does not know either is a real error and says so.
 */
function withModule(module, run) {
    if (PosnicPro[module]) { run(); return; }
    if (PosnicPro.lazy && PosnicPro.lazy._sets && PosnicPro.lazy._sets.reports) {
        PosnicPro.lazy.load('reports').then(function () {
            if (PosnicPro[module]) { run(); }
            else { console.error('[routes] unknown module: ' + module); }
        });
        return;
    }
    console.error('[routes] unknown module: ' + module);
}

$(document).ready(function () {
    var DEFAULT_HASH = 'dashboard';
    var RECORD_ID = 1;
    crossroads.addRoute('{module}/new', function (module) {
        withModule(module, function () { PosnicPro[module].showAdd(); });
    });
    crossroads.addRoute('{module}/{id}/return', function (module, id) {
        // A sales refund is a restricted action - a cashier who can't refund on
        // their own needs a manager to approve it before the return screen opens.
        if (module === 'sales' && PosnicPro.posCan && !PosnicPro.posCan('refund')) {
            PosnicPro.requireManagerApproval('refund',
                { saleId: id, prompt: "A refund needs a manager's approval." },
                function (approval) {
                    // Stash the token so the return submission can prove approval
                    // to the server (valid ~5 min, i.e. long enough to finish).
                    PosnicPro._refundApprovalToken = approval && approval.approval_token;
                    withModule(module, function () { PosnicPro[module].view.returnPage(module, id); });
                });
            return;
        }
        withModule(module, function () { PosnicPro[module].view.returnPage(module, id); });
    });
    crossroads.addRoute('{module}/{id}/edit', function (module, id) {
        RECORD_ID = id;
        withModule(module, function () { PosnicPro[module].showEdit(id); });
    });
    crossroads.addRoute('{module}/{id}/delete', function (module, id) {
        RECORD_ID = id;
        withModule(module, function () { PosnicPro[module].showDelete(id); });
    });
    crossroads.addRoute('{module}/{id}/transaction', function (module, id) {
        RECORD_ID = id;
        withModule(module, function () { PosnicPro[module].showTransaction(id); });
    });
    crossroads.addRoute('{module}/{id}/pdf', function (module, id) {
        RECORD_ID = id;
        withModule(module, function () { PosnicPro[module].showPdf(id); });
    });
    crossroads.addRoute('{module}/{id}/received', function (module, id) {
        RECORD_ID = id;
        withModule(module, function () { PosnicPro[module].showReceived(id); });
    });
    crossroads.addRoute('{module}/{id}/print', function (module, id) {
        RECORD_ID = id;
        withModule(module, function () { PosnicPro[module].showPrint(id); });
    });
    crossroads.addRoute('{module}/new/{id}/print', function (module, id) {
        withModule(module, function () { PosnicPro[module].showPrint(id); });
    });
    crossroads.addRoute('{module}/{id}/whatsapp', function (module, id) {
        RECORD_ID = id;
        withModule(module, function () { PosnicPro[module].showWhatsapp(id); });
    });
    crossroads.addRoute('{module}/{id}/{phone}/{name}/sms', function (module, id, phone, name) {
        RECORD_ID = id;
        withModule(module, function () { PosnicPro[module].showSMS(id, phone, name); });
    });
    crossroads.addRoute('{module}/{id}/returnprint', function (module, id) {
        RECORD_ID = id;
        withModule(module, function () { PosnicPro[module].showReturnPrint(id); });
    });
    crossroads.addRoute('{module}/{id}/restore', function (module, id) {
        RECORD_ID = id;
        withModule(module, function () { PosnicPro[module].restoreDetails(id); });
    });
    crossroads.addRoute('{module}/{id}/hold', function (module, id) {
        RECORD_ID = id;
        withModule(module, function () { PosnicPro[module].showHold(id); });
    });
    crossroads.addRoute('kotorder/new/{table_number}/', function (table_number) {
        if (PosnicPro.kotorder && typeof PosnicPro.kotorder.showAdd === 'function') {
            PosnicPro.kotorder.preSelectedTable = table_number;

            if (PosnicPro.sales) {
                PosnicPro.sales.selectedTable = null;
            }

            PosnicPro.kotorder.showAdd();
            $('.kotorder').click();
        }
    });
    crossroads.addRoute('kotorder/new/{table_number}/{pax_count}', function (table_number, pax_count) {
        if (PosnicPro.kotorder && typeof PosnicPro.kotorder.showAdd === 'function') {
            PosnicPro.kotorder.preSelectedTable = table_number;
            PosnicPro.kotorder.preSelectedPax = pax_count;

            if (PosnicPro.sales) {
                PosnicPro.sales.selectedTable = null;
            }

            PosnicPro.kotorder.showAdd();
            $('.kotorder').click();
        }
    });
    crossroads.addRoute('kot/{table_number}', function (table_number) {
        if (PosnicPro.kot && typeof PosnicPro.kot.showDataTablePage === 'function') {
            PosnicPro.kot.showDataTablePage('kot', table_number);
            $('.kot').click();
        }
    });
    crossroads.addRoute('{module}/{id}', function (module, id) {
        RECORD_ID = id;
        withModule(module, function () { PosnicPro[module].showDetails(id); });
    });
    crossroads.addRoute('{module}/{id}/barcode', function (module, id) {
        RECORD_ID = id;
        withModule(module, function () { PosnicPro[module].showBarcode(id); });
    });
    crossroads.addRoute('{module}/{id}/clone', function (module, id) {
        RECORD_ID = id;
        withModule(module, function () { PosnicPro[module].showClone(id); });
    });
    crossroads.addRoute('{module}/{id}/change', function (module, id) {
        RECORD_ID = id;
        withModule(module, function () { PosnicPro[module].showChange(id); });
    });
    crossroads.addRoute('{module}/{id}/details', function (module, id) {
        RECORD_ID = id;
        withModule(module, function () { PosnicPro[module].showModuleDetails(id); });
    });
    crossroads.addRoute('{module}/{id}/product', function (module, id) {
        RECORD_ID = id;
        withModule(module, function () { PosnicPro[module].showModuleProductDetails(id); });
    });
    crossroads.addRoute('{module}/{id}/sales', function (module, id) {
        RECORD_ID = id;
        withModule(module, function () { PosnicPro[module].showModuleSalesDetails(id); });
    });
    crossroads.addRoute('{module}/{id}/receivings', function (module, id) {
        RECORD_ID = id;
        withModule(module, function () { PosnicPro[module].showModuleReceivingsDetails(id); });
    });
    crossroads.addRoute('{module}', function (module) {
        withModule(module, function () {
            if (typeof PosnicPro[module].showDataTablePage === 'function') {
                PosnicPro[module].showDataTablePage(module);
                $('.' + module).click();
            } else {
                console.error('Module not found or showDataTablePage not defined for:', module);
            }
        });
    });
    crossroads.addRoute('{page}/new/{name}', function (module, name) {
        withModule(module, function () { PosnicPro[module].triggerAddNew(module); });
    });
    crossroads.addRoute('{page}/default/{name}', function (module, name) {
        withModule(module, function () { PosnicPro[module].triggerDefault(name); });
    });

    crossroads.addRoute('{page}/{module}/{name}', function (page, module) {
        withModule(module, function () { PosnicPro[module].triggerModules(); });
    });
    crossroads.addRoute('{page}/{module}/{id}/edit', function (page, module, id) {
        RECORD_ID = id;
        if(module === 'unit'){
           withModule(module, function () { PosnicPro[module].triggerUnitEdit(id); });
        }else{
           withModule(module, function () { PosnicPro[module].triggerTaxEdit(id); });
        }
    });
    crossroads.addRoute('{page}/{module}/{id}/delete', function (page, module, id) {
        RECORD_ID = id;        
        if(module === 'unit'){
            withModule(module, function () { PosnicPro[module].triggerUnitDelete(id); });
        }else{
           withModule(module, function () { PosnicPro[module].triggerTaxDelete(id); });
        }
    });
    crossroads.routed.add(function (request, data) {
        crossroads.resetState()
    });

    function parseHash(newHash, oldHash) {
        currentHash = newHash;
        crossroads.parse(newHash)
    }

    hasher.initialized.add(parseHash);
    hasher.changed.add(parseHash);
    hasher.init();
    if (!hasher.getHash()) {
        hasher.setHash(DEFAULT_HASH)
    }
    /*
     * A '.page_url' click handler used to live here. It was dead twice over:
     * it bound non-delegated at ready to elements only created later (so it
     * attached to nothing), and its condition contained a non-empty string
     * literal as an || operand, making the else branch unreachable anyway.
     * The .page_url elements are plain hash links; the router handles them.
     */
})