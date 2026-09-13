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
            return '<li>' + safe(item.quantity) + ' &times; ' + safe(item.name) +
                /* The note on this line, under the dish, the way the kitchen
                   ticket prints it. */
                (item.note ? '<div class="small text-muted font-italic">' + safe(item.note) + '</div>' : '') +
                '</li>';
        }).join('');

        /*
         * How the order travels, in the words the console already uses for
         * the channel settings, and where it is going: a table, the counter,
         * or a name and an address. A delivery card with no address is a
         * card nobody can act on, and that is what this drew.
         */
        var how = {
            dine_in: t('lang_fulfilment_dine_in', 'Dine in'),
            takeaway: t('lang_fulfilment_takeaway', 'Takeaway'),
            pickup: t('lang_fulfilment_pickup', 'Pickup'),
            delivery: t('lang_fulfilment_delivery', 'Delivery')
        }[order.fulfilment] || '';

        var where;
        if (order.fulfilment === 'delivery') {
            where = (order.customer_name ? safe(order.customer_name) + ' &middot; ' : '') +
                (order.customer_address ? safe(order.customer_address) : t('lang_no_address', 'No address given'));
        } else if (order.fulfilment === 'pickup' || order.fulfilment === 'takeaway') {
            where = t('lang_collect_at_counter', 'Collect at the counter') +
                (order.customer_name ? ' &middot; ' + safe(order.customer_name) : '');
        } else {
            where = safe(order.destination || t('lang_no_destination', 'No table or room given')) +
                (order.person_count > 0 ? ' &middot; ' + safe(order.person_count) + ' ' + t('lang_pax', 'pax') : '');
        }

        var howChip = how
            ? '<span class="badge badge-light border mr-2 align-middle">' + how + '</span>'
            : '';

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

        /*
         * An order whose customer has asked to call it off. It sits in this
         * same queue because it is the same job - somebody deciding - and
         * the two buttons mean the obvious thing: accept the request and the
         * order is cancelled, refuse it and the order stands.
         */
        var asked = order.cancel_requested === true;
        var askedChip = asked
            ? '<span class="badge badge-danger mr-2 align-middle">' +
              t('lang_cancel_requested', 'Customer asked to cancel') +
              '</span>'
            : '';

        return '<div class="card border mb-3 online-order-card' + (asked ? ' border-danger' : '') +
            '" data-id="' + safe(order.sale_id) + '" data-asked="' + (asked ? '1' : '0') + '">' +
            '<div class="card-body">' +
            '<div class="d-flex justify-content-between align-items-start flex-wrap">' +
            '<div>' +
            '<h6 class="mb-1">' + askedChip + howChip + where + '</h6>' +
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
            (asked ? t('lang_keep_the_order', 'Keep the order') : t('lang_reject_order', 'Reject')) +
            '</button>' +
            '<button type="button" class="btn btn-primary-rgba btn-sm online-order-accept">' +
            (asked
                ? t('lang_cancel_it', 'Cancel it')
                : t('lang_accept_and_print', 'Accept and print')) +
            '</button>' +
            '</div>' +
            '</div></div>';
    },

    /*
     * While somebody is actually looking at the queue, keep it current.
     *
     * The page used to draw once and then sit there: an order accepted on
     * another till, or a cancellation asked for while this screen was open,
     * showed up only if somebody pressed Refresh. core/online-order-watch.js
     * carries the count everywhere else; this is the same idea for the one
     * screen where the rows themselves matter.
     */
    watch: function () {
        var self = PosnicPro.onlineorders;
        if (self._watching) return;
        self._watching = setInterval(function () {
            if (document.hidden) return;
            /* Gone from this screen: stop rather than reload a page nobody
               is on. The badge keeps watching. */
            if (!document.getElementById('onlineorders_list')) {
                clearInterval(self._watching);
                self._watching = 0;
                return;
            }
            self.load();
        }, 20000);
    },

    load: function () {
        var self = PosnicPro.onlineorders;
        self.watch();
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
    var card = $(this).closest('.online-order-card');
    /* On a cancellation request the primary button means the customer's
       wish, which is the order off. */
    if (String(card.data('asked')) === '1') {
        PosnicPro.onlineorders.decide(card.data('id'), 'cancel');
        return;
    }
    PosnicPro.onlineorders.decide(card.data('id'), 'accepted');
});

$(document).on('click', '.online-order-reject', function () {
    var card = $(this).closest('.online-order-card');
    /* Refusing a cancellation leaves the order exactly as it was. */
    if (String(card.data('asked')) === '1') {
        PosnicPro.onlineorders.decide(card.data('id'), 'keep');
        return;
    }
    PosnicPro.onlineorders.decide(card.data('id'), 'rejected');
});
