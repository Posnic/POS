PosnicPro.device_setup = {

    // The auto-focus switches live inside Core Settings now (Sale and
    // Receivings tabs); the old #/device_setup route lands on Config.
    showDataTablePage: function () {
        hasher.setHash('settings');
        setTimeout(function () {
            PosnicPro.device_setup.setToggleStatesFromIndexedDB();
        }, 300);
    },
    autoFocus: function () {
        var branchid = PosnicPro.local.get('branch_id_set');
        db.saleAutoFocus.put({id: '1', branch_id: branchid, addSale: $("#toggleSwitchAddSale").is(":checked"), editSale: $('#toggleSwitchEditSale').is(":checked"), holdSale: $('#toggleSwitchHoldSale').is(":checked")});
        db.recevingAutoFocus.put({id: '1', branch_id: branchid, addReceiving: $("#toggleSwitchReceivingAdd").is(":checked"), editReceiving: $('#toggleSwitchReceivingEdit').is(":checked")});
    },
    setToggleStatesFromIndexedDB: function () {
        db.saleAutoFocus.get('1', function (result) {
            if (result) {
                $("#toggleSwitchAddSale").prop("checked", result.addSale);
                $("#toggleSwitchEditSale").prop("checked", result.editSale);
                $("#toggleSwitchHoldSale").prop("checked", result.holdSale);
            }
        });
        db.recevingAutoFocus.get('1', function (result) {
            if (result) {
                $("#toggleSwitchReceivingAdd").prop("checked", result.addReceiving);
                $("#toggleSwitchReceivingEdit").prop("checked", result.editReceiving);
            }
        });
    }
};

$('#saveButton').click(function () {
    if('plan' in PosnicPro['userACL'] == true) {
        if(PosnicPro['userACL'].plan.read == true) {
            PosnicPro.alert('Success', 'Device AutoFocus Saved Successfully..');
            PosnicPro.device_setup.autoFocus();
        }
        else {
            PosnicPro.alert('error', 'You are not authorized to do this.');
        }
    }
    else {
        PosnicPro.alert('error', 'You are not authorized to do this.');
    }
});
$('#device_edit_reset').click(function () {
    if('plan' in PosnicPro['userACL'] == true) {
        if(PosnicPro['userACL'].plan.read == true) {
    var branchid = PosnicPro.local.get('branch_id_set');
    PosnicPro.device_setup.setToggleStatesFromIndexedDB();

    db.saleAutoFocus.put({id: '1', branch_id: branchid, addSale: true, editSale: true, holdSale: true});
    db.recevingAutoFocus.put({id: '1', branch_id: branchid, addReceiving: true, editReceiving: true});
    PosnicPro.alert('Success', 'Device AutoFocus Reset Successfully..');
        }
        else {
            PosnicPro.alert('error', 'You are not authorized to do this.');
        }
    }
    else {
        PosnicPro.alert('error', 'You are not authorized to do this.');
    }
});

$(document).ready(function () {
   PosnicPro.device_setup.setToggleStatesFromIndexedDB();
});

// The switches sit inside Core Settings now and save IMMEDIATELY on change -
// they are device-local (IndexedDB), so there is nothing to batch behind a
// Save button.
$(document).on('change', '.autofocus-switch', function () {
    PosnicPro.device_setup.autoFocus();
});