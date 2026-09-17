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
    /*
     * THE WHOLE BLOCK, not the row the switches happen to sit in.
     *
     * `.closest('.row')` reached only the switches, so hiding it in a browser
     * left the legend, the help text and three dead pickers on screen -
     * exactly the half-a-feature look that made this hard to diagnose in a
     * shop. A fieldset is the thing a person reads as one idea.
     */
    var block = function () { return $('#toggleSwitchKitchenTing').closest('fieldset'); };

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
    /*
     * A WORD, WITHOUT BETTING THE SCREEN ON i18n BEING READY.
     *
     * PosnicPro.i18n may not exist yet at DOM ready - the repository has a
     * test about exactly this - and a throw in here took the switches off the
     * page. English is always available because it is the argument.
     */
    var say = function (key, english) {
        try {
            if (window.PosnicPro && PosnicPro.i18n && PosnicPro.i18n.t) {
                return PosnicPro.i18n.t(key, english);
            }
        } catch (e) {
            /* fall through to the English we were handed */
        }
        return english;
    };

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
            say('lang_best_on_this_machine', 'Best on this machine')));
        voices().forEach(function (v) {
            select.append($('<option>').val(v.name).text(v.name + ' (' + v.lang + ')'));
        });
        select.val(chosen || '');
        if (!select.val()) select.val('');
    };

    var show = function (said) {
        /*
         * THE SWITCHES FIRST, AND NEVER BEHIND ANYTHING THAT CAN FAIL.
         *
         * They are the part that matters and they work on their own. What
         * follows is convenience.
         */
        $('#toggleSwitchKitchenTing').prop('checked', !!(said && said.ting));
        $('#toggleSwitchKitchenSpeak').prop('checked', !!(said && said.speak));

        /*
         * THE PICKERS MUST NOT BE ABLE TO TAKE THE SWITCHES WITH THEM.
         *
         * This went wrong in a shop, in the worst shape available: something
         * in here threw, the failure path hid the row holding the switches AND
         * the Test button, and left the three empty pickers on screen. So the
         * feature looked broken and impossible to turn on at the same time,
         * while the setting underneath was working perfectly.
         *
         * A picker that cannot be filled is a picker somebody ignores. A
         * missing switch is a feature nobody can use.
         */
        try {
            bridge
                .bells()
                .then(function (names) {
                    fill($('#kitchenArrivalBell'), (names && names.arrival) || [], said && said.arrivalBell);
                    fill($('#kitchenItemBell'), (names && names.item) || [], said && said.itemBell);
                })
                .catch(function () {
                    /* An older app with no bells to offer. The switches stand. */
                });
            fillVoices(said && said.voice);
        } catch (e) {
            /* Leave the pickers as they are. Nothing here is worth a switch. */
        }
    };

    $(function () {
        /*
         * A FAILURE HERE HIDES NOTHING.
         *
         * Hiding is for a browser, where there is no bridge at all and the
         * controls could not do anything - that is decided once, above. A
         * setting that would not load is a reason to show the switches
         * unchecked, not a reason to remove them.
         */
        bridge.get().then(show).catch(function () {
            /* Unknown state. The switches show as off, which is the default
               anyway, and flipping one writes the truth. */
        });

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
                say('lang_table_five_new_order_one_chicken_biryani',
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
        result.text(say('lang_playing', 'Playing...'));

        bridge.test().then(function (said) {
            if (said && said.reason === 'off') {
                result.text(say('lang_turn_one_of_these_on_first', 'Turn one of these on first.'));
                return;
            }
            if (!said || !said.played) {
                result.text(say('lang_this_machine_could_not_play_it', 'This machine could not play it.'));
                return;
            }
            result.text(say('lang_sent_to_the_speaker_now', 'Sent to the speaker. If you heard nothing, check the volume.'));
        }).catch(function () {
            result.text(say('lang_this_machine_could_not_play_it',
                'This machine could not play it.'));
        });
    });
})();