/*
 * The guided tour: show a new shop around, once, by pointing at real things.
 *
 * Owner: "first time when user logins, guide him for feature enabled by
 * default let me enable there itself. in feature we might want to do the
 * guide tour for the user."
 *
 * The welcome answers the first half (the switches, right there). This is the
 * second half: after choosing features, walk the person to the places those
 * features live - the menus, the sale screen, the search box, the grid - with
 * a spotlight on the actual element rather than a video of somebody else's
 * shop.
 *
 * DESIGN RULES, each earned elsewhere in this codebase:
 *
 *  - No dependency. A tour library is a third-party script on the till's
 *    boot path forever, for something that runs once per shop.
 *  - A step whose target is missing or hidden is SKIPPED, not shown floating
 *    in space. Menus come and go with features and ACL, so "point at the
 *    thing" must degrade to "say nothing about the thing".
 *  - Steps can navigate (hash) and then WAIT for the target: the SPA builds
 *    pages on arrival, and a fixed delay is either too short on a slow till
 *    or a pause on a fast one.
 *  - Everything is theme tokens. The tour runs on the first day, which is
 *    also the day somebody tries the dark presets.
 *  - Escape leaves at any point, and leaving is remembered per shop the same
 *    way the welcome is - a tour that returns uninvited is nagging.
 */
PosnicPro.tour = {
    _steps: [],
    _at: -1,
    _reposition: null,

    seenKey: function () {
        var branch = PosnicPro.local.get('branch_id_set');
        branch = (branch == null || branch === 'null' || branch === 'undefined') ? '' : String(branch);
        return 'feature_tour_done:' + branch;
    },

    /*
     * The first-run walk. Selectors are the app's real ids, and every one is
     * optional at runtime - a shop with Quick Sale off simply never hears
     * about the pad.
     */
    firstRun: function () {
        PosnicPro.tour.start([
            {
                hash: 'dashboard',
                target: '.vertical-menu',
                title: 'Everything lives here',
                text: 'Sales, items, customers, reports. When you switch a feature on, its menu appears here; switch it off and the menu goes - nothing is deleted.',
                side: 'right'
            },
            {
                hash: 'sales/new',
                target: '#sales_new_item_name',
                title: 'Sell by typing or scanning',
                text: 'Type a name, SKU or barcode - or just scan. A connected barcode scanner works with no set-up.',
                side: 'bottom'
            },
            {
                hash: 'sales/new',
                target: '#sales_new_productList',
                title: 'Or tap the shelf',
                text: 'Tap a product to add it to the sale. A tile with a number badge holds sizes or colours - point at it and the list opens beside it.',
                side: 'top'
            },
            {
                hash: 'sales/new',
                target: '#quick_sale_btn',
                title: 'Quick sale',
                text: 'For the busy counter: type an amount and take payment, no product needed.',
                side: 'bottom'
            },
            {
                hash: 'settings/modules',
                target: '#v-pills-modules',
                title: 'Shape the till any time',
                text: 'Every feature is a switch here. Off keeps the menus short; on brings it back exactly as it was. Each card opens its own page with its settings.',
                side: 'top'
            }
        ]);
    },

    start: function (steps) {
        var self = PosnicPro.tour;
        self.close(true);
        self._steps = steps || [];
        self._at = -1;
        if (!self._steps.length) { return; }
        self.build();
        self.next();
    },

    build: function () {
        var self = PosnicPro.tour;
        if (document.getElementById('posnic_tour')) { return; }
        var el = document.createElement('div');
        el.id = 'posnic_tour';
        el.innerHTML =
            '<div class="tour-backdrop"></div>' +
            '<div class="tour-spot" id="tour_spot"></div>' +
            '<div class="tour-card" id="tour_card" role="dialog" aria-labelledby="tour_title">' +
            '  <div class="tour-title" id="tour_title"></div>' +
            '  <div class="tour-text" id="tour_text"></div>' +
            '  <div class="tour-foot">' +
            '    <span class="tour-dots" id="tour_dots"></span>' +
            '    <span class="tour-actions">' +
            '      <button type="button" class="btn btn-sm btn-light" id="tour_skip">Skip</button>' +
            '      <button type="button" class="btn btn-sm btn-light" id="tour_back">Back</button>' +
            '      <button type="button" class="btn btn-sm btn-primary" id="tour_next">Next</button>' +
            '    </span>' +
            '  </div>' +
            '</div>';
        document.body.appendChild(el);

        $(document).on('click.posnictour', '#tour_next', function () { PosnicPro.tour.next(); });
        $(document).on('click.posnictour', '#tour_back', function () { PosnicPro.tour.back(); });
        $(document).on('click.posnictour', '#tour_skip', function () { PosnicPro.tour.close(); });
        $(document).on('keydown.posnictour', function (e) {
            if (!document.getElementById('posnic_tour')) { return; }
            if (e.key === 'Escape') { PosnicPro.tour.close(); }
            if (e.key === 'ArrowRight' || e.key === 'Enter') { PosnicPro.tour.next(); }
            if (e.key === 'ArrowLeft') { PosnicPro.tour.back(); }
        });
        self._reposition = function () { PosnicPro.tour.place(); };
        window.addEventListener('resize', self._reposition);
        /* Capture: scroll does not bubble, and the grid scrolls inside its
           own container. */
        document.addEventListener('scroll', self._reposition, true);
    },

    next: function () { PosnicPro.tour._move(1); },
    back: function () { PosnicPro.tour._move(-1); },

    _move: function (dir) {
        var self = PosnicPro.tour;
        var at = self._at + dir;
        if (at < 0) { return; }
        if (at >= self._steps.length) { self.close(); return; }
        self._at = at;
        var step = self._steps[at];

        if (step.hash && window.location.hash.slice(2) !== step.hash) {
            hasher.setHash(step.hash);
        }

        /*
         * Wait for the target, then show. Up to three seconds: the SPA builds
         * pages when the hash lands, and an item grid needs a server round
         * trip. A target that never appears - feature off, ACL, an id that
         * moved - skips the step in the direction of travel, so a missing
         * anchor costs one sentence and never strands the tour.
         */
        var waited = 0;
        var tryShow = function () {
            var el = document.querySelector(step.target);
            var visible = el && el.offsetWidth > 0 && el.offsetHeight > 0;
            if (visible) { self.show(step, el); return; }
            waited += 150;
            if (waited >= 3000) { self._move(dir); return; }
            setTimeout(tryShow, 150);
        };
        tryShow();
    },

    show: function (step, el) {
        var self = PosnicPro.tour;
        self._target = el;
        self._side = step.side || 'bottom';
        $('#tour_title').text(step.title);
        $('#tour_text').text(step.text);
        $('#tour_back').toggle(self._at > 0);
        $('#tour_next').text(self._at === self._steps.length - 1 ? 'Done' : 'Next');
        $('#tour_dots').html(self._steps.map(function (s, i) {
            return '<span class="tour-dot' + (i === self._at ? ' is-here' : '') + '"></span>';
        }).join(''));

        if (el.scrollIntoView) {
            el.scrollIntoView({ block: 'center', behavior: 'auto' });
        }
        self.place();
    },

    place: function () {
        var self = PosnicPro.tour;
        var el = self._target;
        var spot = document.getElementById('tour_spot');
        var card = document.getElementById('tour_card');
        if (!el || !spot || !card) { return; }

        var r = el.getBoundingClientRect();
        var pad = 6;
        spot.style.top = Math.round(r.top - pad) + 'px';
        spot.style.left = Math.round(r.left - pad) + 'px';
        spot.style.width = Math.round(r.width + pad * 2) + 'px';
        spot.style.height = Math.round(r.height + pad * 2) + 'px';

        /* The card sits on the asked-for side, then is pulled back inside the
           window - the sidebar step's card would otherwise start off-screen
           on a narrow till. */
        var vw = window.innerWidth;
        var vh = window.innerHeight;
        var cw = card.offsetWidth;
        var ch = card.offsetHeight;
        var gap = 12;
        var top;
        var left;
        if (self._side === 'right') { top = r.top; left = r.right + gap; }
        else if (self._side === 'left') { top = r.top; left = r.left - gap - cw; }
        else if (self._side === 'top') { top = r.top - gap - ch; left = r.left; }
        else { top = r.bottom + gap; left = r.left; }
        if (left + cw > vw - 8) { left = vw - 8 - cw; }
        if (left < 8) { left = 8; }
        if (top + ch > vh - 8) { top = vh - 8 - ch; }
        if (top < 8) { top = 8; }
        card.style.top = Math.round(top) + 'px';
        card.style.left = Math.round(left) + 'px';
    },

    /*
     * `silent` restarts (a new start() replacing a running tour) do not mark
     * the tour seen - only a person closing or finishing does.
     */
    close: function (silent) {
        var self = PosnicPro.tour;
        var el = document.getElementById('posnic_tour');
        if (el && el.parentNode) { el.parentNode.removeChild(el); }
        $(document).off('.posnictour');
        if (self._reposition) {
            window.removeEventListener('resize', self._reposition);
            document.removeEventListener('scroll', self._reposition, true);
            self._reposition = null;
        }
        self._target = null;
        if (!silent && self._steps.length) {
            PosnicPro.local.set(PosnicPro.tour.seenKey(), 'true');
        }
        self._steps = [];
    }
};
