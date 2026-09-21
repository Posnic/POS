/*
 * THE PHONES THIS SHOP HAS, AND THE SWITCH THAT STOPS ONE.
 *
 * Owner: "map device to cloud account."
 *
 * A handset signs in with a username and a password and is given a token that
 * lasts thirty days, because a part-time waiter who does not know the shop's
 * password cannot be made to find a manager every morning. That is only safe
 * while the shop can stop ONE phone without stopping the rest, and until this
 * screen there was nowhere to do it: the endpoints existed and nothing could
 * reach them, which is a feature nobody has.
 *
 * WHY A LIST AND NOT A COUNT. "Four handsets" is not something anybody can
 * act on. The model, who last used it and when it was last seen are what let
 * somebody point at the row that is the phone left in a taxi last night.
 */
PosnicPro.handsets = {
    rows: [],
    filter: "",
    appType: function (row) { return /mobile.?pos/i.test([row.app, row.platform, row.model].join(" ")) ? "mobile-pos" : /captain/i.test([row.app, row.model].join(" ")) ? "captain" : "other"; },

    _esc: function (s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    },

    _t: function (key, english) {
        /*
         * i18n is not always ready when a pane renders, and a screen that
         * throws on a missing translator shows nothing at all. The English is
         * the argument, so it is always available.
         */
        try {
            return PosnicPro.i18n.t(key, english);
        } catch (e) {
            return english;
        }
    },

    /*
     * "Last used" is the column somebody reads first, so it answers in the
     * words a person would use. An exact timestamp is in the title attribute
     * for whoever needs to compare it with a bill.
     */
    _when: function (value) {
        if (!value) return '';
        var then = new Date(value);
        if (isNaN(then.getTime())) return '';

        var seconds = Math.floor((Date.now() - then.getTime()) / 1000);
        if (seconds < 90) return PosnicPro.i18n.t('lang_just_now', 'just now');
        var minutes = Math.floor(seconds / 60);
        if (minutes < 60) return minutes + ' ' + PosnicPro.i18n.t('lang_minutes_ago', 'minutes ago');
        var hours = Math.floor(minutes / 60);
        if (hours < 24) return hours + ' ' + PosnicPro.i18n.t('lang_hours_ago', 'hours ago');
        var days = Math.floor(hours / 24);
        if (days < 30) return days + ' ' + PosnicPro.i18n.t('lang_days_ago', 'days ago');
        return then.toLocaleDateString();
    },

    load: function () {
        var body = $('#handsets_body');
        if (!body.length) return;
        $('#devices_app_filter').val(PosnicPro.handsets.filter);

        body.html(
            '<tr><td colspan="6" class="text-center text-muted">' +
            '<lang class="lang_loading_handsets">Loading the handsets.</lang></td></tr>'
        );

        PosnicPro.get('handsets', function (res) {
            PosnicPro.handsets.rows = (res && res.data) || [];
            PosnicPro.handsets.render();
        }, function () {
            body.html(
                '<tr><td colspan="6" class="text-center text-danger">' +
                '<lang class="lang_could_not_load_handsets">Could not load the handsets.</lang>' +
                '</td></tr>'
            );
        });
    },

    render: function () {
        var esc = PosnicPro.handsets._esc;
        var t = PosnicPro.handsets._t;
        var body = $('#handsets_body');
        if (!body.length) return;

        var html = '';
        (PosnicPro.handsets.rows || []).forEach(function (row) {
            var app = PosnicPro.handsets.appType(row);
            if (PosnicPro.handsets.filter && PosnicPro.handsets.filter !== app) return;
            var id = String(row.device_id || '');
            var stopped = row.revoked === true;

            /*
             * The model, and the platform beneath it. A shop with four
             * identical phones needs the second line; a shop with one does not
             * read it at all.
             */
            var name = esc(row.model) || '<lang class="lang_a_phone">A phone</lang>';
            var platform = row.platform || '';
            if (row.app_version) platform += (platform ? ' · ' : '') + row.app_version;

            html += '<tr class="md-row' + (stopped ? ' handset-stopped' : '') + '" data-id="' + esc(id) + '">'
                + '<td style="font-weight:600;white-space:nowrap;">' + name
                + (platform ? '<div class="q-muted" style="font-weight:400;font-size:12px;">' + esc(platform) + '</div>' : '')
                + '</td>'
                + '<td>' + esc(app === 'mobile-pos' ? 'Mobile POS' : app === 'captain' ? 'Captain App' : (row.app || 'Unclassified')) + '<div class="q-muted">' + esc(row.branch_name || 'Branch not recorded') + '</div></td>'
                + '<td style="white-space:nowrap;">' + esc(row.user_name || '') + '</td>'
                + '<td style="white-space:nowrap;" title="' + esc(row.last_seen || '') + '">'
                + esc(PosnicPro.handsets._when(row.last_seen)) + '</td>'
                + '<td style="white-space:nowrap;">' + (stopped
                    ? '<span class="badge badge-danger-inverse"><lang class="lang_stopped">Stopped</lang></span>'
                    : '<span class="badge badge-success-inverse">Authorized</span>')
                + '</td>'
                + '<td style="text-align:right;white-space:nowrap;">' + (stopped
                    ? '<button type="button" class="btn btn-sm btn-outline-primary handset-allow" data-id="' + esc(id) + '">'
                        + '<lang class="lang_let_it_back">Let it back</lang></button>'
                    : '<button type="button" class="btn btn-sm btn-outline-danger handset-stop" data-id="' + esc(id) + '">'
                        + '<lang class="lang_stop_this_phone">Stop this phone</lang></button>')
                + '</td>'
                + '</tr>';
        });

        body.html(html || '<tr><td colspan="6" class="text-center text-muted">' +
            '<lang class="lang_no_handset_has_signed_in_yet">No handset has signed in to this shop yet. Sign in on a phone and it appears here.</lang></td></tr>');
    },

    /*
     * Asked about, because it takes a waiter's phone out of service mid-shift
     * and the person doing it is usually in a hurry. The sentence says what
     * happens next rather than "are you sure", which answers nothing.
     */
    stop: function (id) {
        var t = PosnicPro.handsets._t;
        /* The house dialog, the same one a role is deleted with. */
        swal({
            title: PosnicPro.i18n.t('lang_stop_this_phone', 'Stop this phone'),
            text: 'Access stops when the phone reconnects. Offline authorization remains valid until it expires. Recorded sales stay on the phone. Signing in again with authorized credentials restores access.',
            showCancelButton: true,
            confirmButtonClass: 'btn btn-danger',
            cancelButtonClass: 'btn btn-secondary m-l-10',
            confirmButtonText: 'Stop it',
            cancelButtonText: 'Cancel'
        }).then(function () {
            PosnicPro.post('handsets/' + encodeURIComponent(id) + '/revoke', function (res) {
                PosnicPro.alert((res && res.type) || 'success', (res && res.message) || 'Done');
                PosnicPro.handsets.load();
            }, function () {
                PosnicPro.alert('error', PosnicPro.i18n.t('lang_could_not_stop_that_phone', 'Could not stop that phone.'));
            });
        }, function () {});
    },

    allow: function (id) {
        var t = PosnicPro.handsets._t;
        PosnicPro.post('handsets/' + encodeURIComponent(id) + '/allow', function (res) {
            PosnicPro.alert('success', (res && res.message) || PosnicPro.i18n.t('lang_done', 'Done'));
            PosnicPro.handsets.load();
        }, function () {
            PosnicPro.alert('error', PosnicPro.i18n.t('lang_could_not_change_that_phone', 'Could not change that phone.'));
        });
    },
};

/* Delegated: the rows are drawn and redrawn, and the pane outlives all of
   them. */
$(document).on('click', '.handset-stop', function () {
    PosnicPro.handsets.stop($(this).data('id'));
});

$(document).on('click', '.handset-allow', function () {
    PosnicPro.handsets.allow($(this).data('id'));
});

$(document).on("change", "#devices_app_filter", function () { PosnicPro.handsets.filter = $(this).val(); PosnicPro.handsets.render(); });
