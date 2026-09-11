/*
 * The queue behind the alarm.
 *
 * A shop in manual mode holds every incoming online order until a person
 * accepts it. Until somebody does, the kitchen does not know that customer
 * exists - no ticket printed, and the sales list is not where anybody would
 * think to look. This screen is where those orders live.
 *
 * WHY THE SCREEN AND THE SOUND ARE SEPARATE THINGS.
 *
 * src/order-alert.js makes the noise, and it gives up after five minutes: an
 * alarm that never stops is one somebody mutes at the speaker, and then it is
 * gone for every future order too. This list is the part that must never be
 * silenceable. The sound is a prompt to look; the queue is the record.
 *
 * ACCEPTING PRINTS, EXACTLY ONCE. The server decides that (utils/order-approval),
 * because a double-tap on a slow screen is the ordinary way two tickets get
 * printed for one order, and two tickets is two lots of food.
 */
PosnicPro.onlineorders = {
    showDataTablePage: function () {
        PosnicPro.HideSideBarModal();
        $(".vertical-layout").removeClass("toggle-menu");
        $(".vertical-menu li a").removeClass("active");
        $('.dropdown-item').removeClass('active');
        $('.page_loader,#osk-container').hide();
        $('.page-title-box,#onlineorders_new').show();
        $('#view_onlineorders_page').addClass('active');
        PosnicPro.onlineorders.load();
    },

    /**
     * One order, as a card.
     *
     * Read top to bottom in the order somebody needs it: where it goes, what
     * was ordered, what it comes to, then the two buttons. A destination
     * buried under a list of dishes is a destination that gets misread.
     */
    card: function (order) {
        var safe = function (value) { return $('<div>').text(value == null ? '' : value).html(); };
        var t = function (key, fallback) { return PosnicPro.i18n.t(key, fallback); };
        /* The shop's own sign, not a hardcoded rupee: this product sells in
           Nairobi too. */
        var money = function (amount) {
            return (PosnicPro.local.get('currencySign') || '') + (Number(amount) || 0).toFixed(2);
        };

        var lines = (order.items || []).map(function (item) {
            return '<li>' + safe(item.quantity) + ' &times; ' + safe(item.name) + '</li>';
        }).join('');

        /* The venue's standing instruction, copied onto the order when it was
           placed. Shown here because whoever accepts it is often the person
           who hands it to the driver. */
        var note = order.delivery_note
            ? '<p class="text-muted small mb-2"><i class="feather icon-info mr-1" aria-hidden="true"></i>' + safe(order.delivery_note) + '</p>'
            : '';

        var customerNote = order.note
            ? '<p class="small mb-2"><strong>' + t('lang_customer_note', 'Note') + ':</strong> ' + safe(order.note) + '</p>'
            : '';

        var fee = Number(order.delivery_fee) > 0
            ? '<div class="small text-muted">' + t('lang_delivery_fee', 'Delivery') + ': ' + money(order.delivery_fee) + '</div>'
            : '';

        return '<div class="card border mb-3 online-order-card" data-id="' + safe(order.sale_id) + '">' +
            '<div class="card-body">' +
            '<div class="d-flex justify-content-between align-items-start flex-wrap">' +
            '<div>' +
            '<h6 class="mb-1">' + safe(order.destination || t('lang_no_destination', 'No table or room given')) + '</h6>' +
            '<div class="small text-muted mb-2">' +
            safe(order.sales_id || '') +
            (order.token_id ? ' &middot; ' + t('lang_token', 'Token') + ' ' + safe(order.token_id) : '') +
            (order.customer_phone ? ' &middot; ' + safe(order.customer_phone) : '') +
            '</div>' +
            '</div>' +
            '<div class="text-right">' +
            '<div class="h5 mb-0">' + money(order.total) + '</div>' +
            fee +
            '</div>' +
            '</div>' +
            '<ul class="pl-3 mb-2">' + lines + '</ul>' +
            customerNote +
            note +
            '<div class="text-right">' +
            '<button type="button" class="btn btn-outline-danger btn-sm mr-2 online-order-reject">' +
            t('lang_reject_order', 'Reject') +
            '</button>' +
            '<button type="button" class="btn btn-primary-rgba btn-sm online-order-accept">' +
            t('lang_accept_and_print', 'Accept and print') +
            '</button>' +
            '</div>' +
            '</div></div>';
    },

    load: function () {
        var self = PosnicPro.onlineorders;
        var loader = $('.loader-view-onlineorders');
        loader.find('.loadingSpinner:first').remove();
        $("<div class='loadingSpinner'></div>").appendTo(loader);

        PosnicPro.get({ url: 'sales/pendingOnlineOrders', data: {} }, function (response) {
            loader.find('.loadingSpinner:first').remove();
            var list = (response && response.data) || [];
            $('#onlineorders_list').html(list.map(self.card).join(''));
            $('#onlineorders_empty').toggle(list.length === 0);

            /*
             * An empty queue stops the alarm.
             *
             * The main process repeats the waiting sound until something is
             * dealt with. It cannot see this list, so the page is what tells
             * it the queue is clear. Without this, an order accepted on
             * another till leaves this one nagging about nothing.
             */
            if (!list.length) self.silence();
        }, function () {
            loader.find('.loadingSpinner:first').remove();
            $('#onlineorders_list').html('');
            $('#onlineorders_empty').show();
        });
    },

    /** Somebody dealt with the queue, so stop the alarm repeating. */
    silence: function (saleId) {
        try {
            var api = window.electronAPI && window.electronAPI.orderAlert;
            if (!api) return;
            if (saleId) api.resolve(String(saleId));
            else api.clear();
        } catch (e) {
            /* In a browser there is no main process to tell, and the queue on
               the screen is the part that matters. */
        }
    },

    decide: function (saleId, decision, reason) {
        var self = PosnicPro.onlineorders;
        var $card = $('.online-order-card[data-id="' + saleId + '"]');

        /* Both buttons off the moment one is pressed. The whole failure this
           guards against is a second tap on a screen that has not caught up. */
        $card.find('button').prop('disabled', true);

        PosnicPro.post({
            url: 'sales/' + encodeURIComponent(saleId) + '/approval',
            data: JSON.stringify({ decision: decision, reason: reason || '' })
        }, function (response) {
            if (response && response.type === 'success') {
                self.silence(saleId);
                PosnicPro.alert('success', response.message);
            } else {
                PosnicPro.alert('error', (response && response.message) || '');
            }
            /* Reloaded either way. If somebody on another till got there
               first, the honest thing is to show the queue as it now is. */
            self.load();
        }, function (xhr) {
            var body = xhr && xhr.responseJSON;
            PosnicPro.alert('error', (body && body.message) ||
                PosnicPro.i18n.t('lang_could_not_update_the_order', 'Could not update the order'));
            self.load();
        });
    }
};

$(document).on('click', '.online-order-accept', function () {
    PosnicPro.onlineorders.decide($(this).closest('.online-order-card').data('id'), 'accepted');
});

$(document).on('click', '.online-order-reject', function () {
    PosnicPro.onlineorders.decide($(this).closest('.online-order-card').data('id'), 'rejected');
});
