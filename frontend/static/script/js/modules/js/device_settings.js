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
            PosnicPro.alert('error', PosnicPro.i18n.t('lang_you_are_not_authorized_to_do_this', 'You are not authorized to do this.'));
        }
    }
    else {
        PosnicPro.alert('error', PosnicPro.i18n.t('lang_you_are_not_authorized_to_do_this', 'You are not authorized to do this.'));
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
            PosnicPro.alert('error', PosnicPro.i18n.t('lang_you_are_not_authorized_to_do_this', 'You are not authorized to do this.'));
        }
    }
    else {
        PosnicPro.alert('error', PosnicPro.i18n.t('lang_you_are_not_authorized_to_do_this', 'You are not authorized to do this.'));
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

/*
 * THE KITCHEN'S SPEAKER.
 *
 * Device-local like the switches above, but stored by the desktop app rather
 * than in IndexedDB: the main process is what has to read it when a ticket
 * lands, and a browser database is not somewhere it can look.
 *
 * DESKTOP ONLY, BY CONSTRUCTION. There is no posnic.kitchenCall in a browser,
 * so the block hides itself rather than offering a switch that could not do
 * anything. A dead control is worse than an absent one: somebody turns it on,
 * hears nothing, and stops trusting the rest of the page.
 */
(function () {
    var bridge = window.posnic && window.posnic.kitchenCall;
    var block = function () { return $('#toggleSwitchKitchenTing').closest('.row'); };

    if (!bridge || typeof bridge.get !== 'function') {
        $(function () { block().hide(); });
        return;
    }

    var show = function (said) {
        $('#toggleSwitchKitchenTing').prop('checked', !!(said && said.ting));
        $('#toggleSwitchKitchenSpeak').prop('checked', !!(said && said.speak));
    };

    $(function () {
        bridge.get().then(show).catch(function () { block().hide(); });
    });

    /* Saved immediately, because somebody flipping this is standing next to
       the speaker waiting to hear the difference. */
    $(document).on('change', '.kitchen-sound-switch', function () {
        bridge.set({
            ting: $('#toggleSwitchKitchenTing').is(':checked'),
            speak: $('#toggleSwitchKitchenSpeak').is(':checked')
        }).then(function () {
            $('#kitchenSoundTestResult').text('');
        });
    });

    /*
     * Says what happened, including when nothing did. "I pressed it and
     * nothing happened" is where this feature has spent its entire life, and
     * the two reasons for it are both worth naming out loud.
     */
    $(document).on('click', '#kitchenSoundTest', function () {
        var result = $('#kitchenSoundTestResult');
        result.text(PosnicPro.i18n.t('lang_playing', 'Playing...'));

        bridge.test().then(function (said) {
            if (said && said.reason === 'off') {
                result.text(PosnicPro.i18n.t(
                    'lang_turn_one_of_these_on_first',
                    'Turn one of these on first.'));
                return;
            }
            if (!said || !said.played) {
                result.text(PosnicPro.i18n.t(
                    'lang_this_machine_could_not_play_it',
                    'This machine could not play it.'));
                return;
            }
            result.text(PosnicPro.i18n.t(
                'lang_sent_to_the_speaker_now',
                'Sent to the speaker. If you heard nothing, check the volume.'));
        }).catch(function () {
            result.text(PosnicPro.i18n.t(
                'lang_this_machine_could_not_play_it',
                'This machine could not play it.'));
        });
    });
})();