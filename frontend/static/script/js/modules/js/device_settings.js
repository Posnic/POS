PosnicPro.device_setup = {

    showDataTablePage: function () {
        PosnicPro.HideSideBarModal();
        PosnicPro.dashboard.datePicker();
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $(".vertical-layout").removeClass("toggle-menu");
        $(".vertical-menu li a").removeClass("active");
        $('.page_loader,#osk-container,#danger_zone').hide();
        $('.page-title-box,#devices,#dangerZone,#dangetzoneUserverify').show();
        $('#v-pills-manage-tab').addClass('active');
        $('#view_device_page').addClass('active');
        $('#v-pills-manage').addClass('show active');
        $('.dashboard_img_menu').hide();
        $('#image_sidebar_config').show();
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
            PosnicPro.alert('error', 'Unauthorized..');
        }
    }
    else {
        PosnicPro.alert('error', 'Unauthorized..');
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
            PosnicPro.alert('error', 'Unauthorized..');
        }
    }
    else {
        PosnicPro.alert('error', 'Unauthorized..');
    }
});

$(document).ready(function () {
   PosnicPro.device_setup.setToggleStatesFromIndexedDB();
});