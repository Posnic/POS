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

    /*
     * BELL NAMES ARE NOT LABELS. The stored value is a short name the sound
     * file owns ('rising', 'tick'); what a person reads is written here, and
     * anything the app offers that this list has not heard of still appears,
     * spelled as it came. A downloaded bell later should show up rather than
     * vanish because nobody updated a dictionary.
     */
    var BELL_LABEL = {
        rising: 'Three notes rising',
        marimba: 'Marimba pair',
        bell: 'Service bell',
        soft: 'Soft marimba',
        tick: 'Short tick',
        tap: 'Two note tap'
    };

    var fill = function (select, names, chosen) {
        select.empty();
        names.forEach(function (name) {
            select.append($('<option>').val(name).text(BELL_LABEL[name] || name));
        });
        if (chosen) select.val(chosen);
        if (!select.val() && names.length) select.val(names[0]);
    };

    /*
     * THE VOICES THIS MACHINE ACTUALLY HAS.
     *
     * Owner: "different countries might need different voice and accent."
     *
     * Read from the speech engine rather than a list we keep, because the
     * answer differs per machine and changes the moment somebody adds a
     * language in Windows. The empty option is not "none": it means let the
     * app choose the best one here, which is also what a machine that lacks
     * the chosen voice falls back to.
     */
    var voices = function () {
        try {
            var engine = window.speechSynthesis;
            var all = engine && engine.getVoices ? engine.getVoices() : [];
            return all.filter(function (v) { return /^en/i.test(String(v.lang || '')); });
        } catch (e) {
            return [];
        }
    };

    var fillVoices = function (chosen) {
        var select = $('#kitchenVoice');
        select.empty();
        select.append($('<option>').val('').text(
            PosnicPro.i18n.t('lang_best_on_this_machine', 'Best on this machine')));
        voices().forEach(function (v) {
            select.append($('<option>').val(v.name).text(v.name + ' (' + v.lang + ')'));
        });
        select.val(chosen || '');
        if (!select.val()) select.val('');
    };

    var show = function (said) {
        $('#toggleSwitchKitchenTing').prop('checked', !!(said && said.ting));
        $('#toggleSwitchKitchenSpeak').prop('checked', !!(said && said.speak));
        if (said) {
            bridge.bells().then(function (names) {
                fill($('#kitchenArrivalBell'), names.arrival || [], said.arrivalBell);
                fill($('#kitchenItemBell'), names.item || [], said.itemBell);
            }).catch(function () { /* older app: the pickers stay empty. */ });
            fillVoices(said.voice);
        }
    };

    $(function () {
        bridge.get().then(show).catch(function () { block().hide(); });

        /* Voices arrive asynchronously on Windows. Asking once at load usually
           returns an empty list, which would offer a shop nothing to pick. */
        try {
            if (window.speechSynthesis && 'onvoiceschanged' in window.speechSynthesis) {
                window.speechSynthesis.onvoiceschanged = function () {
                    fillVoices($('#kitchenVoice').val());
                };
            }
        } catch (e) { /* nothing to do */ }
    });

    /* One player, reused. A new Audio() per press leaves the old ones alive. */
    var preview = null;
    var hear = function (src) {
        try {
            if (!preview) preview = new Audio();
            preview.src = src;
            preview.volume = 1;
            var a = preview.play();
            if (a && a.catch) a.catch(function () {});
        } catch (e) { /* nothing to do */ }
    };

    $(document).on('click', '[data-kitchen-play]', function () {
        var kind = $(this).data('kitchen-play');
        var which = kind === 'item' ? $('#kitchenItemBell').val() : $('#kitchenArrivalBell').val();
        bridge.preview(kind, which).then(hear).catch(function () {});
    });

    $(document).on('click', '#kitchenVoicePlay', function () {
        try {
            var engine = window.speechSynthesis;
            if (!engine || typeof window.SpeechSynthesisUtterance !== 'function') return;
            if (engine.speaking || engine.pending) engine.cancel();

            var said = new window.SpeechSynthesisUtterance(
                PosnicPro.i18n.t('lang_table_five_new_order_one_chicken_biryani',
                    'Table 5, new order. One Chicken Biryani.'));
            var wanted = $('#kitchenVoice').val();
            var all = voices();
            for (var i = 0; i < all.length; i += 1) {
                if (all[i].name === wanted) { said.voice = all[i]; said.lang = all[i].lang; break; }
            }
            said.rate = 1;
            said.pitch = 1.1;
            engine.speak(said);
        } catch (e) { /* nothing to do */ }
    });

    $(document).on('change', '.kitchen-sound-choice', function () {
        bridge.set({
            arrivalBell: $('#kitchenArrivalBell').val(),
            itemBell: $('#kitchenItemBell').val(),
            voice: $('#kitchenVoice').val() || ''
        });
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