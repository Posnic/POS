/*
 * WHICH TILLS MAY PRINT THIS SHOP'S BILLS.
 *
 * A waiter asks for a bill on a phone and a computer beside the printer prints
 * it. On the shop's own Wi-Fi those two talk directly and none of this exists.
 *
 * Over the internet they have to be introduced, and they cannot introduce
 * themselves: every Posnic installation makes its own printing key the first
 * time it starts, so a till and this shop's server hold different ones and
 * always will. Before this screen the only way to allow a till was to call the
 * API by hand, which is not a thing a shopkeeper can be asked to do.
 *
 * THE KEY IS NEVER SHOWN HERE. It is stored as a digest and never comes back
 * out, so the table shows what a person needs to recognise a machine - its
 * name, the last few characters, and whether it has ever actually asked for
 * work - and nothing that could be replayed.
 */
PosnicPro.printTills = {
    /*
     * Drawn whenever the settings page opens. Silent about failure on
     * purpose: this is one card among many, and a shop with no cloud printing
     * should not meet an error about a feature it does not use.
     */
    render: function () {
        var body = $('#print_tills_body');
        if (!body.length) return;

        PosnicPro.get({ url: 'setting/printTills' }, function (response) {
            var rows = (response && response.data) || [];
            var html = '';

            for (var i = 0; i < rows.length; i++) {
                var r = rows[i];
                html += '<tr>'
                    + '<td>' + $('<span>').text(r.label || '').html() + '</td>'
                    + '<td class="text-muted">' + $('<span>').text(r.hint || '').html() + '</td>'
                    + '<td>' + PosnicPro.printTills.seen(r.last_seen_at) + '</td>'
                    + '<td class="text-right">'
                    + '<button type="button" class="btn btn-sm btn-outline-danger print-till-forget"'
                    + ' data-id="' + $('<span>').text(r.id).html() + '">'
                    + '<i class="feather icon-trash-2"></i></button>'
                    + '</td></tr>';
            }

            if (!html) {
                /* One literal, not a concatenation: the i18n extractor reads this
                   source, so a sentence split across `+` arrives in the language
                   pack with the quotes and plus signs still in it. */
                html = '<tr><td colspan="4" class="text-muted">'
                    + '<lang class="lang_print_tills_none">No till has been allowed yet. Phones on the shop Wi-Fi print without this.</lang>'
                    + '</td></tr>';
            }
            body.html(html);
            if (PosnicPro.i18n && PosnicPro.i18n.apply) PosnicPro.i18n.apply();
        }, function () {
            /* An older server has no such endpoint. The card simply stays
               empty rather than shouting about a route it does not have. */
            body.html('');
        });
    },

    /*
     * "Last asked" is the whole diagnostic.
     *
     * "2 minutes ago" and "never" point at completely different problems - a
     * printer, or a key that was pasted wrong - and without this line they
     * look identical from here.
     */
    seen: function (when) {
        if (!when) {
            return '<span class="badge badge-light"><lang class="lang_print_till_never">Never</lang></span>';
        }
        var at = new Date(when).getTime();
        if (!at) return '';
        var secs = Math.max(0, Math.round((Date.now() - at) / 1000));
        var said;
        if (secs < 60) said = secs + 's ago';
        else if (secs < 3600) said = Math.floor(secs / 60) + 'm ago';
        else if (secs < 86400) said = Math.floor(secs / 3600) + 'h ago';
        else said = new Date(when).toLocaleDateString();
        /* Green only while it is actually working: a till last seen yesterday
           is not a till that is printing today. */
        var fresh = secs < 900;
        return '<span class="badge badge-' + (fresh ? 'success' : 'light') + '">' + said + '</span>';
    },

    /** Allow the till whose key has been pasted in. */
    allow: function () {
        var key = $.trim($('#print_till_key').val() || '');
        var label = $.trim($('#print_till_label').val() || '');
        var error = $('#print_till_error');
        error.hide().text('');

        /*
         * Said here rather than after a round trip. Every real key is 64
         * characters; a short one is a paste that went wrong, and the server
         * refuses it anyway - this only means the shopkeeper hears it at once.
         */
        if (key.length < 32) {
            error.text(PosnicPro.i18n
                ? PosnicPro.i18n.t('lang_print_till_bad_key', 'That does not look like a printing key. Press Copy in Hardware Manager and paste the whole thing.')
                : 'That does not look like a printing key.').show();
            return;
        }

        PosnicPro.request({
            method: 'POST',
            url: 'setting/printTills',
            data: JSON.stringify({ key: key, label: label })
        }, function (response) {
            if (response.type === 'success') {
                $('#print_till_add_modal').modal('hide');
                $('#print_till_key').val('');
                $('#print_till_label').val('');
                PosnicPro.printTills.render();
                PosnicPro.alert(response.type, response.message);
            } else {
                error.text(response.message || 'Could not allow that till').show();
            }
        }, function () {
            error.text(PosnicPro.i18n.t('lang_could_not_allow_that_till', 'Could not allow that till')).show();
        });
    },

    /** Stop a till printing. */
    forget: function (id) {
        if (!id) return;
        PosnicPro.request({
            method: 'DELETE',
            url: 'setting/printTills/' + id
        }, function (response) {
            PosnicPro.printTills.render();
            PosnicPro.alert(response.type, response.message);
        }, function () {
            PosnicPro.alert('error', PosnicPro.i18n.t('lang_could_not_remove_that_till', 'Could not remove that till'));
        });
    }
};

/* Bound once, on the document, because the rows are redrawn. */
$(document).on('click', '#print_till_save', function () {
    PosnicPro.printTills.allow();
});
$(document).on('click', '.print-till-forget', function () {
    PosnicPro.printTills.forget($(this).data('id'));
});
