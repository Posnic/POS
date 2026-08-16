var currentHash = '';
$(document).ready(function () {
    var DEFAULT_HASH = 'dashboard';
    var RECORD_ID = 1;
    crossroads.addRoute('{module}/new', function (module) {
        PosnicPro[module].showAdd()
    });
    crossroads.addRoute('{module}/{id}/return', function (module, id) {
        // A sales refund is a restricted action - a cashier who can't refund on
        // their own needs a manager to approve it before the return screen opens.
        if (module === 'sales' && PosnicPro.posCan && !PosnicPro.posCan('refund')) {
            PosnicPro.requireManagerApproval('refund',
                { saleId: id, prompt: "A refund needs a manager's approval." },
                function () { PosnicPro[module].view.returnPage(module, id); });
            return;
        }
        PosnicPro[module].view.returnPage(module, id)
    });
    crossroads.addRoute('{module}/{id}/edit', function (module, id) {
        RECORD_ID = id;
        PosnicPro[module].showEdit(id)
    });
    crossroads.addRoute('{module}/{id}/delete', function (module, id) {
        RECORD_ID = id;
        PosnicPro[module].showDelete(id)
    });
    crossroads.addRoute('{module}/{id}/transaction', function (module, id) {
        RECORD_ID = id;
        PosnicPro[module].showTransaction(id)
    });
    crossroads.addRoute('{module}/{id}/pdf', function (module, id) {
        RECORD_ID = id;
        PosnicPro[module].showPdf(id)
    });
    crossroads.addRoute('{module}/{id}/received', function (module, id) {
        RECORD_ID = id;
        PosnicPro[module].showReceived(id)
    });
    crossroads.addRoute('{module}/{id}/print', function (module, id) {
        RECORD_ID = id;
        PosnicPro[module].showPrint(id)
    });
    crossroads.addRoute('{module}/new/{id}/print', function (module, id) {
        PosnicPro[module].showPrint(id);
    });
    crossroads.addRoute('{module}/{id}/whatsapp', function (module, id) {
        RECORD_ID = id;
        PosnicPro[module].showWhatsapp(id)
    });
    crossroads.addRoute('{module}/{id}/{phone}/{name}/sms', function (module, id, phone, name) {
        RECORD_ID = id;
        PosnicPro[module].showSMS(id, phone, name)
    });
    crossroads.addRoute('{module}/{id}/returnprint', function (module, id) {
        RECORD_ID = id;
        PosnicPro[module].showReturnPrint(id)
    });
    crossroads.addRoute('{module}/{id}/restore', function (module, id) {
        RECORD_ID = id;
        PosnicPro[module].restoreDetails(id)
    });
    crossroads.addRoute('{module}/{id}/hold', function (module, id) {
        RECORD_ID = id;
        PosnicPro[module].showHold(id)
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
        PosnicPro[module].showDetails(id)
    });
    crossroads.addRoute('{module}/{id}/barcode', function (module, id) {
        RECORD_ID = id;
        PosnicPro[module].showBarcode(id)
    });
    crossroads.addRoute('{module}/{id}/clone', function (module, id) {
        RECORD_ID = id;
        PosnicPro[module].showClone(id)
    });
    crossroads.addRoute('{module}/{id}/change', function (module, id) {
        RECORD_ID = id;
        PosnicPro[module].showChange(id)
    });
    crossroads.addRoute('{module}/{id}/details', function (module, id) {
        RECORD_ID = id;
        PosnicPro[module].showModuleDetails(id)
    });
    crossroads.addRoute('{module}/{id}/product', function (module, id) {
        RECORD_ID = id;
        PosnicPro[module].showModuleProductDetails(id)
    });
    crossroads.addRoute('{module}/{id}/sales', function (module, id) {
        RECORD_ID = id;
        PosnicPro[module].showModuleSalesDetails(id)
    });
    crossroads.addRoute('{module}/{id}/receivings', function (module, id) {
        RECORD_ID = id;
        PosnicPro[module].showModuleReceivingsDetails(id)
    });
    crossroads.addRoute('{module}', function (module) {
        if (PosnicPro[module] && typeof PosnicPro[module].showDataTablePage === 'function') {
            PosnicPro[module].showDataTablePage(module);
            $('.' + module).click();
        } else {
            console.error('Module not found or showDataTablePage not defined for:', module);
        }
    });
    crossroads.addRoute('{page}/new/{name}', function (module, name) {
        PosnicPro[module].triggerAddNew(module)
    });
    crossroads.addRoute('{page}/default/{name}', function (module, name) {
        PosnicPro[module].triggerDefault(name)
    });

    crossroads.addRoute('{page}/{module}/{name}', function (page, module) {
        PosnicPro[module].triggerModules()
    });
    crossroads.addRoute('{page}/{module}/{id}/edit', function (page, module, id) {
        RECORD_ID = id;
        if(module === 'unit'){
           PosnicPro[module].triggerUnitEdit(id);
        }else{
           PosnicPro[module].triggerTaxEdit(id);
        }
    });
    crossroads.addRoute('{page}/{module}/{id}/delete', function (page, module, id) {
        RECORD_ID = id;        
        if(module === 'unit'){
            PosnicPro[module].triggerUnitDelete(id);           
        }else{
           PosnicPro[module].triggerTaxDelete(id);
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
    $('.page_url').click(function () {
        var hash = window.location.hash.slice(1);
        var newAddItemName = $('#items_name').val();
        if (hash === '/items/new/addnewitem' || "'#/items/new/" + newAddItemName + "'" || '/branches/new/addbranch') {
            $('.change_branch').removeClass('show');
            history.back()
        } else {
            var page = $(this).data('page');
            hasher.setHash(page)
        }
    })
})