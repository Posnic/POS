/*
 * Where this customer is sitting.
 *
 * A restaurant with nine tables puts a code on each. The hotel across the road
 * puts one in every room, and those orders arrive through the same storefront
 * without being the same orders: the room pays an agreed markup, the hotel is
 * owed a cut of it, and the food has to reach a room number rather than a
 * table. All of that is decided on the server. This file's whole job is to
 * carry the two words the URL said - which venue, which room - from the page
 * the customer landed on to the request that places the order.
 *
 *   /order/AZ100                 the shop
 *   /order/AZ100/table/5         its own table five
 *   /order/AZ100/venue/RC/123    Royal Club Hotel, room 123
 *
 * WHY IT IS STORED AT ALL.
 *
 * The customer lands on the deep URL once and then walks through home.html,
 * products.html, cart.html and payment.html, none of which carry it. Reading
 * the URL on each page would lose the room at the first tap.
 *
 * IN sessionStorage, NOT localStorage. A room number is true for one visit. On
 * a hotel's own tablet, or a phone that scanned a different code last week,
 * localStorage would quietly send tonight's food to last week's room. When the
 * tab closes, this is gone.
 *
 * NOTHING HERE IS TRUSTED. The page says WHICH venue the printed code named;
 * the server looks up what that venue's markup and commission are. A customer
 * editing this in a console changes which hotel they claim to be in, which the
 * server will price accordingly - not what any hotel charges.
 */
(function () {
    'use strict';

    var STORAGE_KEY = 'posnic_service_point';

    function clean(value, max) {
        return String(value == null ? '' : value)
            .trim()
            .slice(0, max || 24);
    }

    /**
     * What the address bar says, or nothing.
     *
     * The shape is fixed by the routes the server answers, so this recognises
     * exactly those and refuses to guess at anything else. A URL it does not
     * understand is the shop's own floor, which is the safe reading: house
     * prices and nobody owed a commission.
     */
    function fromUrl() {
        var parts = String(window.location.pathname || '')
            .split('/')
            .filter(Boolean);
        if (parts[0] === 'order' || parts[0] === 'menu') parts.shift();

        var query = new URLSearchParams(window.location.search);
        var point = {
            table: clean(query.get('table')),
            venue: clean(query.get('venue'), 12),
            unit: clean(query.get('unit')),
            /*
             * Whether this URL is somebody ARRIVING, or the same visit walking
             * from the cart to the checkout.
             *
             * It matters because arriving at a plain shop address has to CLEAR
             * a service point, not inherit one: a guest who orders from room
             * 123 and then scans the code on a table downstairs is at the
             * table. The inner pages - home.html, products.html, cart.html -
             * carry no address at all and must leave the stored one alone, or
             * the room is lost at the first tap.
             *
             * A store address is three to six letters and digits with no dot
             * in it, which is exactly what the server's own route guard
             * accepts and is never one of this bundle's page names.
             */
            arrival: false,
        };

        var first = parts[0] || '';
        point.arrival =
            (/^[A-Za-z0-9]{3,6}$/.test(first) && !/\./.test(first)) || !!query.get('branch');

        if (parts[1] === 'table') point.table = clean(parts[2]);
        if (parts[1] === 'venue') {
            point.venue = clean(parts[2], 12);
            point.unit = clean(parts[3]);
        }
        return point;
    }

    function stored() {
        try {
            var raw = sessionStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            /* Private mode, blocked storage, or something that is not JSON.
               No service point is the shop's own floor. */
            return null;
        }
    }

    function write(point) {
        try {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(point));
        } catch (e) {
            /* A browser refusing storage still gets to order; it just orders
               from the shop's own floor. */
        }
    }

    /**
     * The service point for this visit.
     *
     * AN ARRIVAL REPLACES WHATEVER WAS THERE, including with nothing. A
     * customer who has just scanned the code in room 456 is in room 456
     * whatever the last scan said, and one who scans the plain shop code after
     * that is at the shop. Anything less than replacing would let a room
     * number outlive the visit it belongs to and put a markup on an order
     * placed at a table.
     *
     * Every other page in the walk to checkout carries no address, so it reads
     * back what the arrival stored.
     */
    function resolve() {
        var url = fromUrl();
        if (url.arrival || url.table || url.venue) {
            var fresh = {
                table: url.table,
                venue: url.venue,
                unit: url.unit,
                /* What the customer confirmed at checkout, filled in later.
                   Cleared here on purpose: a new code is a new destination,
                   and the last one's correction must not follow it. */
                destination: null,
            };
            write(fresh);
            return fresh;
        }

        var saved = stored();
        return saved || { table: '', venue: '', unit: '', destination: null };
    }

    /*
     * RESOLVED ONCE PER PAGE LOAD, and this is load-bearing.
     *
     * Doing the arrival check on every read meant the second read on an
     * arrival URL rebuilt the point from the URL again - and threw away the
     * room the customer had just corrected, because a fresh point has no
     * correction on it. The URL does not change under a page; deciding once is
     * both cheaper and the only way a confirmation survives being read back.
     */
    var current = null;

    function read() {
        if (!current) current = resolve();
        return current;
    }

    /** What the customer said the destination really is. */
    function confirm(destination) {
        var point = read();
        point.destination = {
            unit: clean(destination && destination.unit),
            floor: clean(destination && destination.floor, 20),
        };
        write(point);
        return point;
    }

    /** The query string a storefront or menu read needs, "" when there is none. */
    function query() {
        var point = read();
        var params = new URLSearchParams();
        if (point.table) params.set('table', point.table);
        if (point.venue) params.set('venue', point.venue);
        if (point.unit) params.set('unit', point.unit);
        var text = params.toString();
        return text ? '?' + text : '';
    }

    /** The fields an order carries, ready to merge into its payload. */
    function orderFields() {
        var point = read();
        return {
            venue: point.venue || '',
            unit: point.unit || '',
            destination: point.destination || null,
        };
    }

    /* ------------------------------------------------- the server's view
     *
     * What the shop says about this service point: the venue's real name, what
     * it calls a room, whether it needs a floor, and the standing note for
     * whoever carries the food. All of it comes back with the storefront, so
     * the page never has to hold a copy of the shop's settings.
     */

    var VENUE_KEY = 'posnic_service_venue';

    function remember(reply) {
        var point = (reply && reply.service_point) || null;
        try {
            if (point && point.venue) {
                sessionStorage.setItem(VENUE_KEY, JSON.stringify(point.venue));
            } else {
                /* The shop's own floor. Clearing matters: a customer who
                   scanned a hotel code and then a table code must not be
                   asked for a room number at the table. */
                sessionStorage.removeItem(VENUE_KEY);
            }
        } catch (e) {
            /* nothing to do */
        }
    }

    function venue() {
        try {
            var raw = sessionStorage.getItem(VENUE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }

    /**
     * The destination, in the words the customer should be shown.
     *
     * Built from the venue the server described and whatever the customer has
     * already corrected, so the checkout screen and the confirmation screen
     * cannot word it differently.
     */
    function describe() {
        var place = venue();
        if (!place) return null;

        var point = read();
        var confirmed = point.destination || {};
        var unit = confirmed.unit || place.unit || '';
        var floor = place.ask_floor ? confirmed.floor || '' : '';

        var parts = [place.name];
        if (unit) parts.push(place.unit_label + ' ' + unit);
        if (floor) parts.push('floor ' + floor);

        return {
            name: place.name,
            unit_label: place.unit_label || 'Room',
            unit: unit,
            floor: floor,
            ask_floor: place.ask_floor === true,
            note: place.delivery_note || '',
            label: parts.join(', '),
        };
    }

    function clear() {
        try {
            sessionStorage.removeItem(STORAGE_KEY);
        } catch (e) {
            /* nothing to do */
        }
    }

    window.KioskServicePoint = {
        read: read,
        confirm: confirm,
        describe: describe,
        query: query,
        orderFields: orderFields,
        remember: remember,
        venue: venue,
        clear: clear,
        STORAGE_KEY: STORAGE_KEY,
        VENUE_KEY: VENUE_KEY,
    };
})();
