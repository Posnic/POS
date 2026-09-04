/*
 * A filter bar for any data list.
 *
 * Written once because it is going on every list - quotes, items, sales,
 * purchases. The alternative is the same bar copied five times, and this
 * codebase has already paid for that twice today: a helper that existed as
 * five copies, where each fix only ever landed in whichever copy bit that week.
 *
 * What it owns:
 *   - a Filter button that lives in the PAGE HEADER, next to New, and says how
 *     many filters are active. The panel is closed by default: a list is for
 *     reading, and a bar that is always open spends height on controls nobody
 *     is using yet.
 *   - a compact search box with a "which field" selector and an Exact toggle.
 *     Exact narrows the ANSWER, not the cost. It is worth being precise about
 *     this: the server builds /^term$/i, and MongoDB can only use a prefix
 *     index for a case-SENSITIVE regex, so an exact search scans the branch's
 *     rows exactly as a fragment search does. What it buys is one right answer
 *     instead of every row containing the text - which is the whole point when
 *     a name has been picked from a list.
 *   - a date range with the presets people actually pick, carrying real times
 *     rather than bare dates.
 *   - an optional typeahead per field, so choosing "Customer" offers the
 *     customers this till actually uses instead of demanding exact spelling.
 *
 * What each list supplies: its fields, whether it has a date, and what to do
 * when the filter changes. Nothing in here knows what a quote is.
 */
PosnicPro.listFilter = {
    _mounted: {},

    /* ---------------------------------------------------------------------
     * Date ranges
     *
     * Every preset returns a real instant, not a bare date. "Today" on a till
     * means since midnight, not since some server's idea of the date, so these
     * are built in the browser's timezone and sent as ISO. A shop closing at
     * 11pm and one closing at 1am both get the day they mean.
     *
     * Weeks start MONDAY. India reads a business week that way, and the
     * alternative silently moves a whole day between "this week" and "last".
     * ------------------------------------------------------------------- */
    PRESETS: [
        { key: 'all', label: 'All time' },
        { key: 'today', label: 'Today' },
        { key: 'yesterday', label: 'Yesterday' },
        { key: 'week', label: 'This week' },
        { key: 'month', label: 'This month' },
        { key: 'year', label: 'This year' },
        { key: 'last7', label: 'Last 7 days' },
        { key: 'last30', label: 'Last 30 days' },
        { key: 'custom', label: 'Custom range' }
    ],

    _startOfDay: function (d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; },
    _endOfDay: function (d) { var x = new Date(d); x.setHours(23, 59, 59, 999); return x; },

    range: function (preset, now) {
        var self = PosnicPro.listFilter;
        var today = now ? new Date(now) : new Date();
        var s = self._startOfDay, e = self._endOfDay;
        var d;

        switch (preset) {
            case 'today':
                return { from: s(today), to: e(today) };
            case 'yesterday':
                d = new Date(today); d.setDate(d.getDate() - 1);
                return { from: s(d), to: e(d) };
            case 'week':
                d = new Date(today);
                // getDay(): 0 = Sunday. Monday-start means Sunday counts as day 7.
                d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
                return { from: s(d), to: e(today) };
            case 'month':
                d = new Date(today.getFullYear(), today.getMonth(), 1);
                return { from: s(d), to: e(today) };
            case 'year':
                d = new Date(today.getFullYear(), 0, 1);
                return { from: s(d), to: e(today) };
            case 'last7':
                d = new Date(today); d.setDate(d.getDate() - 6);
                return { from: s(d), to: e(today) };
            case 'last30':
                d = new Date(today); d.setDate(d.getDate() - 29);
                return { from: s(d), to: e(today) };
            default:
                return { from: null, to: null };
        }
    },

    /* ---------------------------------------------------------------------
     * State
     * ------------------------------------------------------------------- */
    state: function (key) {
        var m = PosnicPro.listFilter._mounted[key];
        return m ? m.state : {};
    },

    /* How many filters a person would say are on. The search FIELD and Exact
       are modifiers of the search, not filters in their own right - counting
       them would show "3 active" for one typed word. */
    /*
     * The search term that is actually IN FORCE, which is not the same as the
     * text in the box.
     *
     * A term below MIN_SEARCH is deliberately never sent - one character
     * matches nearly every row, which is the most expensive query anyone can
     * run for the least useful answer. But the character is still in the input,
     * and state.search follows the input so the box renders what was typed.
     *
     * Without this split the two drift apart in both directions: the Filter
     * button counts a filter that was never applied, and any OTHER trigger -
     * picking a status chip, changing the date - reloads with that one
     * character attached, applying the search the debounce had just refused to
     * run. Both were live until this was added.
     */
    _applied: function (st) {
        var t = String((st && st.search) || '').trim();
        if (!t) return '';
        /*
         * EXACT bypasses the minimum, and the reason is CORRECTNESS rather
         * than cost.
         *
         * Picking a name from the suggestion list sets exact. If the minimum
         * still applied, choosing a customer called "K" would silently do
         * nothing - a deliberate act with no effect, which is the worst kind
         * of nothing.
         *
         * It is NOT because exact is cheaper. The server builds /^term$/i, and
         * MongoDB cannot use a prefix index for a case-insensitive regex, so
         * the scan costs what a fragment scan costs. The saving is in the
         * answer: one row rather than every row containing the letter.
         */
        if (st.exact || st._picked) return t;
        var min = PosnicPro.listFilter.MIN_SEARCH || 2;
        return t.length >= min ? t : '';
    },

    activeCount: function (key) {
        var st = PosnicPro.listFilter.state(key);
        var n = 0;
        if (PosnicPro.listFilter._applied(st)) n++;
        if (st.preset && st.preset !== 'all') n++;
        (st.extra ? Object.keys(st.extra) : []).forEach(function (k) {
            if (st.extra[k] !== '' && st.extra[k] != null) n++;
        });
        return n;
    },

    /*
     * The same state, shaped for the OLDER list endpoints.
     *
     * quotes was written alongside this bar, so it takes the flat parameters
     * params() emits. The lists that came before it - items, sales, receivings
     * and nine others - take a `filters` blob that goes almost straight into a
     * Mongo query, built until now by PosnicPro.search from the input boxes.
     *
     * Translating here rather than in each screen is the whole point: three
     * copies of this mapping would drift, and drift in a filter is invisible -
     * a list quietly answering a slightly different question than the one on
     * screen. It is also why the regex is built to match what search() built:
     * adopting the bar must not silently change which rows a shop's existing
     * habits return.
     *
     * The date key is the CALLER's, because these lists do not agree on it -
     * items filters on updated_date, a sales history on its own sale date - and
     * guessing would filter the wrong column while looking like it worked.
     */
    _escapeRegex: function (v) {
        return String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    },

    legacyFilters: function (key, opts) {
        var LF = PosnicPro.listFilter;
        var m = LF._mounted[key];
        var st = LF.state(key);
        var cfg = (m && m.cfg) || {};
        var out = {};

        var term = LF._applied(st);
        if (term) {
            var value;
            if (st.exact) {
                /* Anchored, matching what Exact promises: the whole value, not
                   a value containing it. */
                value = { $regex: '^' + LF._escapeRegex(term) + '$', $options: 'i' };
            } else {
                /* All tokens present, in any order - the behaviour search()
                   already gave, so "blue shirt" keeps finding "Shirt, blue". */
                var pattern = term.trim().split(/\s+/).filter(function (t) {
                    return t.length > 0;
                }).map(function (t) {
                    return '(?=.*' + LF._escapeRegex(t) + ')';
                }).join('');
                if (!pattern) { pattern = LF._escapeRegex(term); }
                value = { $regex: pattern, $options: 'i' };
            }

            var field = (st.field && st.field !== 'all') ? st.field : '';
            if (field) {
                out[field] = value;
            } else {
                var all = (cfg.searchFields || []).map(function (f) { return f.value; })
                    .filter(function (v) { return v && v !== 'all'; });
                if (all.length === 1) {
                    out[all[0]] = value;
                } else if (all.length > 1) {
                    /* $or is a query operator, not a code operator, so it
                       passes the app's filter guard - see api mongo-guard.js. */
                    out.$or = all.map(function (f) {
                        var o = {};
                        o[f] = value;
                        return o;
                    });
                }
            }
        }

        var dateKey = opts && opts.dateKey;
        if (dateKey && (st.from || st.to)) {
            var range = {};
            if (st.from) range.$gte = st.from.toISOString();
            if (st.to) range.$lte = st.to.toISOString();
            out[dateKey] = range;
        }

        Object.keys(st.extra || {}).forEach(function (k) {
            if (st.extra[k] !== '' && st.extra[k] != null) out[k] = st.extra[k];
        });
        return out;
    },

    /* What the server is sent. Defaults are omitted: field=all&exact=false
       says exactly what sending neither says, and a request that spells out
       its defaults is harder to read in a log. */
    params: function (key) {
        var st = PosnicPro.listFilter.state(key);
        var out = {};
        var term = PosnicPro.listFilter._applied(st);
        if (term) {
            out.search = term;
            if (st.field && st.field !== 'all') out.field = st.field;
            if (st.exact) out.exact = 'true';
        }
        if (st.from) out.from = st.from.toISOString();
        if (st.to) out.to = st.to.toISOString();
        Object.keys(st.extra || {}).forEach(function (k) {
            if (st.extra[k] !== '' && st.extra[k] != null) out[k] = st.extra[k];
        });
        return out;
    }
};

/* -------------------------------------------------------------------------
 * Rendering and behaviour
 * ---------------------------------------------------------------------- */
(function () {
    var LF = PosnicPro.listFilter;
    var esc = function (v) { return $('<span>').text(v == null ? '' : String(v)).html(); };

    /* A datetime-local value, in LOCAL time. toISOString() would shift it by
       the timezone offset and show the user a different hour than they picked. */
    var forInput = function (d) {
        if (!d) return '';
        var p = function (n) { return String(n).padStart(2, '0'); };
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
            + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
    };

    /*
     * Mounting twice must not throw away what someone has typed.
     *
     * The first version replaced _mounted[key] wholesale, so a second mount
     * reset the search, the date range and the status chips to empty while the
     * LIST still showed the filtered results - the bar and the list disagreeing,
     * which is the failure this component was written to stop happening five
     * times over.
     *
     * Quotes avoided it with a `_filterMounted` flag on the SCREEN. That works,
     * and it is exactly the wrong place for it: every screen that adopts this
     * bar would have to remember the same flag, and the first one to forget
     * gets a bug that only shows up when a page is re-entered. The component
     * owns its own idempotence now.
     *
     * A different container IS a different mount - that is a real re-parent,
     * not a repeat - so it resets.
     */
    LF.mount = function (cfg) {
        var key = cfg.key;
        var existing = LF._mounted[key];
        if (existing && existing.cfg.container === cfg.container) {
            /* Config can legitimately change between mounts (a screen adding a
               field), so it is refreshed; the STATE is what must survive.
             *
             * The STRIP must survive too. Every loadList re-mounts on its way
             * through, and rebuilding the strip here REPLACED the search input
             * while someone was typing in it - focus fell to the page and the
             * very next letters became navigation shortcuts (owner: "focus
             * going outside input box ... it went to different page"). A live
             * strip is never rebuilt; only an EMPTY container renders. */
            existing.cfg = cfg;
            if (!$(cfg.container).children().length) {
                LF.render(key);
            }
            return existing;
        }
        LF._mounted[key] = {
            cfg: cfg,
            state: { search: '', field: 'all', exact: false, preset: 'all', from: null, to: null, extra: {} }
        };
        LF.render(key);
        return LF._mounted[key];
    };

    LF.render = function (key) {
        var m = LF._mounted[key];
        if (!m) return;
        var cfg = m.cfg, st = m.state;
        var $panel = $(cfg.container);
        if (!$panel.length) return;

        var fields = cfg.searchFields || [{ value: 'all', label: PosnicPro.i18n.t('lang_all_fields', 'All fields') }];
        /* A single row. The bar sits in the page header between the title and
           the buttons, so it has to read as one strip of controls - stacked
           rows there would push the header open and misalign against both. */
        var html = ''
            + '<div class="lf-row">'
            + '  <div class="lf-search">'
            + '    <input type="text" class="form-control form-control-sm lf-q" placeholder="'
            + esc(cfg.searchPlaceholder || 'Search') + '" autocomplete="off" value="' + esc(st.search) + '">'
            + '    <div class="lf-typeahead" style="display:none;"></div>'
            + '  </div>'
            + '  <select class="form-control form-control-sm lf-field">'
            + fields.map(function (f) {
                return '<option value="' + esc(f.value) + '"' + (st.field === f.value ? ' selected' : '') + '>'
                    + esc(f.label) + '</option>';
            }).join('')
            + '  </select>'
            + '  <label class="lf-exact mb-0" title="Match the whole value, not part of it" data-t-title="lang_match_the_whole_value_not_part_of_it">'
            + '    <input type="checkbox" class="lf-exact-cb"' + (st.exact ? ' checked' : '') + '> Exact'
            + '  </label>';

        if (cfg.dateField) {
            html += ''
                /* The preset and its range editor are wrapped together so the
                   editor can be positioned against the control that opened it
                   while staying out of the strip's flow - two datetime-local
                   inputs are ~185px each and would break the single line. */
                + '  <div class="lf-preset-wrap">'
                + '    <select class="form-control form-control-sm lf-preset">'
                + LF.PRESETS.map(function (p) {
                    return '<option value="' + p.key + '"' + (st.preset === p.key ? ' selected' : '') + '>'
                        + esc(p.label) + '</option>';
                }).join('')
                + '    </select>'
                + '    <div class="lf-custom" style="display:' + (st.preset === 'custom' ? 'flex' : 'none') + ';">'
                /* min/max from the current pair, so the range cannot be
                   inverted on the FIRST edit either - the change handler keeps
                   them in step after that. */
                + '      <input type="datetime-local" class="form-control form-control-sm lf-from" value="' + forInput(st.from) + '"'
                + (st.to ? ' max="' + forInput(st.to) + '"' : '') + '>'
                + '      <span class="lf-sep">to</span>'
                + '      <input type="datetime-local" class="form-control form-control-sm lf-to" value="' + forInput(st.to) + '"'
                + (st.from ? ' min="' + forInput(st.from) + '"' : '') + '>'
                + '    </div>'
                + '  </div>'
                + '  <button type="button" class="btn btn-sm btn-light border lf-clear"><lang class="lang_clear_title">Clear</lang></button>';
        }
        html += '</div>';

        $panel.html(html).attr('data-lf', key);
        LF.paintButton(key);
    };

    /* The Filter button lives in the page header. It carries the active count
       because a closed panel is otherwise a place filters go to hide - someone
       filters to one customer, forgets, and reports the list as broken. */
    LF.paintButton = function (key) {
        var m = LF._mounted[key];
        if (!m) return;
        var n = LF.activeCount(key);
        var $btn = $(m.cfg.button);
        if (!$btn.length) return;
        $btn.toggleClass('lf-btn-active', n > 0);
        $btn.find('.lf-count').remove();
        if (n > 0) $btn.append('<span class="lf-count">' + n + '</span>');
    };

    /* Toggling is a state, so the button has to look like one.
     *
     * A button that looks identical open and closed leaves the panel's own
     * appearance as the only clue - and the panel sits in a different part of
     * the header. Pressing it should look pressed, the way a real toggle does.
     * aria-expanded says the same thing to a screen reader. */
    /*
     * A filter a screen owns, put where the bar can see it.
     *
     * Quotes has status chips outside the panel. They filter the list, so if
     * the bar does not know about them the Filter button says "0 filters" while
     * a filter is on - which is the precise thing the count exists to prevent -
     * and Clear leaves the list filtered by something it just told you was
     * gone.
     *
     * Putting the value in `extra` makes the bar the single source of truth:
     * it is counted, it is sent, and Clear removes it. The screen learns the
     * new value back through onChange, so the chips repaint from the same
     * state rather than keeping their own.
     */
    LF.setExtra = function (key, name, value) {
        var m = LF._mounted[key];
        if (!m) return false;
        if (!m.state.extra) m.state.extra = {};
        if (value === '' || value === null || value === undefined) delete m.state.extra[name];
        else m.state.extra[name] = value;
        LF._changed(key);
        return true;
    };

    LF.toggle = function (key) {
        var m = LF._mounted[key];
        if (!m) return;
        var $panel = $(m.cfg.container);
        var opening = !$panel.is(':visible');
        $panel.slideToggle(120);
        $(m.cfg.button).toggleClass('lf-btn-open', opening).attr('aria-expanded', opening ? 'true' : 'false');
    };

    LF._changed = function (key) {
        var m = LF._mounted[key];
        if (!m) return;
        LF.paintButton(key);
        if (typeof m.cfg.onChange === 'function') m.cfg.onChange(LF.params(key), m.state);
    };

    /*
     * Programmatic filter, for doors that land a page PRE-FILTERED - the
     * item pane's "all movements for this item" lands on Inventory Logs
     * already narrowed to the item, with the strip OPEN so the person can
     * see what is applied and add the date range themselves. Rebuilding the
     * strip here is safe on purpose: this runs on arrival, never while
     * someone is typing in it.
     */
    LF.preset = function (key, opts) {
        var m = LF._mounted[key];
        if (!m) return;
        opts = opts || {};
        m.state.search = String(opts.search || '');
        m.state.field = opts.field || 'all';
        m.state.exact = !!opts.exact;
        m.state._picked = !!opts.exact;
        var $panel = $(m.cfg.container);
        $panel.empty();
        LF.render(key);
        if (!$panel.is(':visible')) {
            $panel.show();
            $(m.cfg.button).addClass('lf-btn-open').attr('aria-expanded', 'true');
        }
        LF._changed(key);
    };

    var owner = function (el) { return $(el).closest('[data-lf]').attr('data-lf'); };

    /* Search-as-you-type, without a query per letter.
     *
     * Three things keep this honest, and they matter more in the cloud than on
     * a till: there the database is local, but pos.sbala.in is a network hop
     * AND one process serving many shops, so an expensive scan competes with
     * somebody else's request.
     *
     *   1. DEBOUNCE. Typing is not a decision. "acme" is one request after the
     *      pause, not four.
     *   2. MINIMUM LENGTH. One character matches almost every row - the most
     *      expensive query anyone can run and the least useful answer. Below
     *      the minimum the list simply keeps what it has.
     *   3. SEQUENCE GUARD (in the calling module): a slow response that lands
     *      after a newer one is dropped, so results cannot arrive out of order.
     *
     * The typeahead is exempt from all of it - it reads cached recents, so it
     * updates on every keystroke and costs nothing.
     */
    LF.MIN_SEARCH = 2;
    LF.DEBOUNCE_MS = 350;

    LF.shouldQuery = function (term) {
        var t = String(term || '').trim();
        // clearing is always worth a request - it is how you get the list back
        return t.length === 0 || t.length >= LF.MIN_SEARCH;
    };

    $(document).on('input', '.lf-q', function () {
        var key = owner(this);
        if (!key) return;
        var term = $.trim(this.value);
        LF._mounted[key].state.search = term;
        /* typing again is no longer the picked value */
        LF._mounted[key].state._picked = false;

        // cached, so it can keep up with every keystroke
        LF.typeahead(key, this.value);

        clearTimeout(LF._mounted[key]._t);
        if (!LF.shouldQuery(term)) {
            // one character: keep the list as it is rather than scanning for it
            LF.paintButton(key);
            return;
        }
        LF._mounted[key]._t = setTimeout(function () { LF._changed(key); }, LF.DEBOUNCE_MS);
    });

    $(document).on('change', '.lf-field,.lf-exact-cb', function () {
        var key = owner(this);
        if (!key) return;
        var st = LF._mounted[key].state;
        st.field = $(this).closest('[data-lf]').find('.lf-field').val();
        st.exact = $(this).closest('[data-lf]').find('.lf-exact-cb').is(':checked');
        /* Choosing Customer is what SHOWS the customer suggestions now (and
           choosing anything else hides them) - re-evaluate with the term
           already typed. */
        LF.typeahead(key, $(this).closest('[data-lf]').find('.lf-q').val());

        /*
         * Both of these MODIFY a search rather than being one. With no term in
         * force, params() omits them entirely, so reloading would send a
         * request byte-identical to the one already on screen - a round trip
         * per dropdown change for a list that cannot move.
         *
         * The check runs AFTER the state is updated, and that ordering matters:
         * ticking Exact can bring a below-minimum term INTO force (see
         * _applied), so the very keystroke that makes a reload necessary is one
         * of the two this guard would otherwise skip.
         */
        if (!LF._applied(st)) {
            LF.paintButton(key);
            return;
        }
        LF._changed(key);
    });

    $(document).on('change', '.lf-preset', function () {
        var key = owner(this);
        if (!key) return;
        var st = LF._mounted[key].state;
        st.preset = this.value;
        var $panel = $(this).closest('[data-lf]');
        $panel.find('.lf-custom').css('display', st.preset === 'custom' ? 'flex' : 'none');
        if (st.preset !== 'custom') {
            var r = LF.range(st.preset);
            st.from = r.from; st.to = r.to;
            $panel.find('.lf-from').val(forInput(st.from));
            $panel.find('.lf-to').val(forInput(st.to));
            LF._changed(key);
        }
    });

    $(document).on('change', '.lf-from,.lf-to', function () {
        var key = owner(this);
        if (!key) return;
        var st = LF._mounted[key].state;
        var $panel = $(this).closest('[data-lf]');
        var $from = $panel.find('.lf-from');
        var $to = $panel.find('.lf-to');
        var from = $from.val();
        var to = $to.val();

        /*
         * An inverted range cannot be entered, rather than being caught after.
         *
         * "To" before "from" matches nothing, and the list then says "no quotes
         * match this search" - true and useless, because the search is not what
         * is wrong. Letting the browser refuse it beats any message we could
         * write: min/max on datetime-local is native, needs no validation UI,
         * and the picker will not offer the bad dates in the first place.
         *
         * Set from the CURRENT values on every change, so widening one end
         * releases the other rather than trapping someone who picked the wrong
         * one first.
         */
        $to.attr('min', from || null);
        $from.attr('max', to || null);

        st.from = from ? new Date(from) : null;
        st.to = to ? new Date(to) : null;
        st.preset = 'custom';
        LF._changed(key);
    });

    $(document).on('click', '.lf-clear', function () {
        var key = owner(this);
        if (!key) return;
        LF._mounted[key].state = {
            search: '', field: 'all', exact: false, preset: 'all', from: null, to: null, extra: {}
        };
        LF.render(key);
        LF._changed(key);
    });
})();

/* -------------------------------------------------------------------------
 * The picker
 *
 * Same shape as the sale screen's Choose-customer popover, because that one is
 * already familiar and already right: a titled card, a list where every row
 * carries an icon saying WHY it is there, and the recent ones first.
 *
 * Entity-driven so the next list gets it free. Quotes asks for customers;
 * sales will ask for items, purchases for suppliers. Each entity supplies a
 * title, an icon and a source - nothing else differs, so nothing else is
 * duplicated.
 *
 * Every source reads what is already cached. A picker that queries per
 * keystroke is the thing this whole bar exists to avoid.
 * ---------------------------------------------------------------------- */
(function () {
    var LF = PosnicPro.listFilter;
    var esc = function (v) { return $('<span>').text(v == null ? '' : String(v)).html(); };

    /*
     * Object.create(null), not {}.
     *
     * A plain object inherits from Object.prototype, so seen['constructor'] is
     * truthy before anything has been stored - as are toString, valueOf and
     * hasOwnProperty. A customer or item whose name is one of those would be
     * treated as already seen and silently dropped from the suggestions. Rare,
     * but the failure is invisible: the row simply is not offered, and nobody
     * can tell why. A null-prototype object has no such names.
     */
    var uniq = function (rows) {
        var seen = Object.create(null), out = [];
        rows.forEach(function (r) {
            if (!r || !r.label) return;
            var k = String(r.id || r.label).toLowerCase();
            if (seen[k]) return;
            seen[k] = 1;
            out.push(r);
        });
        return out;
    };

    var match = function (rows, term) {
        var q = String(term || '').trim().toLowerCase();
        if (!q) return rows.slice(0, 8);
        return rows.filter(function (r) {
            return String(r.label).toLowerCase().indexOf(q) !== -1
                || String(r.note || '').toLowerCase().indexOf(q) !== -1;
        }).slice(0, 8);
    };

    /* recent: this till's own history, so it leads and says so with a clock. */
    var recents = function (key) {
        try {
            if (PosnicPro.sales && typeof PosnicPro.sales._recentGet === 'function') {
                return PosnicPro.sales._recentGet(key) || [];
            }
        } catch (e) { /* a cold till has no history - not an error */ }
        return [];
    };

    LF.ENTITIES = {
        customer: {
            title: 'Choose customer',
            icon: 'icon-users',
            rows: function () {
                var r = recents('recent_customers').map(function (c) {
                    return { id: c.id, label: c.name, note: c.phone, recent: true };
                });
                var seed = ((PosnicPro.sales && PosnicPro.sales._customerSeed) || []).map(function (c) {
                    return { id: c.id, label: c.name, note: c.phone };
                });
                return uniq(r.concat(seed));
            },
            /*
             * ...and the shop's actual customers, which the rows above do not
             * contain.
             *
             * `rows` is recents plus `_customerSeed`, and that seed is the FIRST
             * TEN customers, fetched only by renderRecentCustomers on the sale
             * screen. On the quotes page nothing ever calls it, so the seed is
             * null and the suggestions are recents alone.
             *
             * The result was a picker saying "Nothing matches" for a customer
             * whose quotes were listed underneath it - because the LIST asks the
             * server and the picker was filtering a cache of ten. A suggestion
             * box that disagrees with the results it sits on top of is worse
             * than no suggestion box.
             */
            lookup: function (term, done) {
                PosnicPro.get(
                    { url: 'customers/getCustomersAjaxList', data: 'query=' + encodeURIComponent(term) },
                    function (response) {
                        done(((response && response.suggestions) || []).map(function (c) {
                            return { id: c._id || c.id, label: c.name, note: c.phone };
                        }));
                    },
                    function () { done([]); }   /* offline is not an error here */
                );
            }
        },
        item: {
            title: 'Choose item',
            icon: 'icon-box',
            rows: function () {
                /* price, not sku: that is what the sale screen actually
                   stores on a recent item (sales.js _recentPush at the add-line
                   path). Reading a field nothing writes renders a blank note
                   on every row and looks like a bug in the picker. */
                return uniq(recents('recent_items').map(function (i) {
                    return { id: i.id, label: i.name, note: i.price, recent: true };
                }));
            }
        },
        supplier: {
            title: 'Choose supplier',
            icon: 'icon-truck',
            rows: function () {
                return uniq(recents('recent_suppliers').map(function (s) {
                    return { id: s.id, label: s.name, note: s.phone, recent: true };
                }));
            }
        }
    };

    LF.suggest = function (entity, term) {
        var e = LF.ENTITIES[entity];
        if (!e) return [];
        return match(e.rows(), term);
    };

    LF.typeahead = function (key, term) {
        var m = LF._mounted[key];
        if (!m) return;
        var $box = $(m.cfg.container).find('.lf-typeahead');
        var entity = m.cfg.typeahead;
        var e = entity && LF.ENTITIES[entity];
        if (!e) { $box.hide().empty(); return; }
        /*
         * Owner: "customer typeahead only drop down customer chose and show
         * customer typeahead." Suggestions belong to the field they suggest
         * FOR - offering customers while the dropdown says All fields or
         * Quote # reads as the search guessing, and picking one silently
         * changed the field under the user. Choose Customer, get customers.
         */
        if (m.cfg.typeaheadField && m.state.field !== m.cfg.typeaheadField) {
            $box.hide().empty();
            return;
        }

        var rows = LF.suggest(entity, term);

        /*
         * Ask the server too, when the entity knows how.
         *
         * Cached rows render immediately so the box never feels slow, and the
         * server's answer merges in when it lands. `seq` drops a slow reply that
         * arrives after a newer keystroke - without it, typing "Cus" then
         * "Custom" can end with the results for "Cus" on screen.
         */
        if (e.lookup && String(term || '').trim().length >= LF.MIN_SEARCH) {
            m._taSeq = (m._taSeq || 0) + 1;
            var mine = m._taSeq;
            e.lookup(String(term).trim(), function (found) {
                if (mine !== m._taSeq) return;
                LF.paintTypeahead(key, e, uniq(rows.concat(found || [])));
            });
        }

        LF.paintTypeahead(key, e, rows);
    };

    /* Drawing the box, split out so a late server answer can repaint it
       without repeating the lookup that produced it. */
    LF.paintTypeahead = function (key, e, rows) {
        var m = LF._mounted[key];
        if (!m) return;
        var $box = $(m.cfg.container).find('.lf-typeahead');
        var body = rows.length
            ? rows.map(function (r) {
                /* a clock means "you used this here", a plain icon means "this
                   exists" - the distinction is why recents are worth showing */
                var ic = r.recent ? 'icon-clock' : e.icon;
                return '<a href="javascript:void(0)" class="lf-pick-row" data-name="' + esc(r.label) + '">'
                    + '<i class="feather ' + ic + '"></i>'
                    + '<span class="lf-pick-name">' + esc(r.label) + '</span>'
                    + (r.note ? '<span class="lf-pick-note">' + esc(r.note) + '</span>' : '')
                    + '</a>';
            }).join('')
            : '<div class="lf-pick-empty"><lang class="lang_nothing_matches_press_enter_to_search_anyw">Nothing matches - press Enter to search anyway</lang></div>';

        $box.html(
            '<div class="lf-pick-head">'
            + '<span class="lf-pick-title"><i class="feather ' + esc(e.icon) + ' mr-1"></i>' + esc(e.title) + '</span>'
            + '<a href="javascript:void(0)" class="lf-pick-x" title="Close" data-t-title="lang_close_title">&times;</a>'
            + '</div>'
            + '<div class="lf-pick-list">' + body + '</div>'
        ).show();
    };

    /*
     * Picking fills the term - and TOUCHES NOTHING ELSE.
     *
     * The first version also ticked Exact, which read as the checkbox
     * deciding things by itself (owner: "exact tick should not ticked by
     * default"). The one job Exact was doing there - letting a one-letter
     * customer name through the two-character minimum - moves to a picked
     * flag that the next keystroke clears.
     */
    $(document).on('click', '.lf-pick-row', function () {
        var $panel = $(this).closest('[data-lf]');
        var key = $panel.attr('data-lf');
        var m = LF._mounted[key];
        if (!m) return;
        var name = String($(this).data('name'));
        m.state.search = name;
        m.state._picked = true;
        $panel.find('.lf-q').val(name);
        $panel.find('.lf-typeahead').hide().empty();
        LF._changed(key);
    });

    /*
     * Arrow keys and Enter, because the sale screen has them.
     *
     * The owner asked for this picker to work "similar as in sales new", and
     * that one runs on the autocomplete plugin, which moves through its list on
     * the arrow keys. A till is operated from the keyboard - reaching for a
     * mouse to pick the customer you have already half-typed is the slow path -
     * so a hand-rolled popover that only takes clicks is a downgrade wearing
     * the same design.
     *
     * Enter with nothing highlighted deliberately does NOT pick the first row.
     * It lets the typed text through as a plain search, which is what the empty
     * state promises ("press Enter to search anyway") and what someone typing a
     * partial name usually means. Highlighting is a deliberate act; Enter after
     * one is a deliberate choice.
     */
    $(document).on('keydown', '.lf-q', function (e) {
        var $box = $(this).closest('.lf-search').find('.lf-typeahead');
        if (!$box.is(':visible')) return;
        var $rows = $box.find('.lf-pick-row');
        if (!$rows.length) return;

        var down = e.key === 'ArrowDown' || e.keyCode === 40;
        var up = e.key === 'ArrowUp' || e.keyCode === 38;
        var enter = e.key === 'Enter' || e.keyCode === 13;
        if (!down && !up && !enter) return;

        var i = $rows.index($rows.filter('.is-active'));
        if (enter) {
            if (i < 0) return;   // nothing chosen - let the search run
            e.preventDefault();
            $rows.eq(i).trigger('click');
            return;
        }

        /* preventDefault or the caret jumps to either end of the box while the
           highlight moves, which reads as the text being eaten. */
        e.preventDefault();
        var next = down ? i + 1 : i - 1;
        if (next >= $rows.length) next = 0;
        if (next < 0) next = $rows.length - 1;
        $rows.removeClass('is-active').eq(next).addClass('is-active');

        /* Keep the highlight in view - the list scrolls, and a selection you
           cannot see is worse than none. */
        var row = $rows.get(next);
        if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
    });

    /* Hovering moves the keyboard highlight rather than adding a second one.
       Otherwise a hand landing on the mouse mid-arrow-key leaves two rows lit
       and Enter takes the one the cursor is NOT on. */
    $(document).on('mouseenter', '.lf-pick-row', function () {
        $(this).closest('.lf-pick-list').find('.lf-pick-row').removeClass('is-active');
        $(this).addClass('is-active');
    });

    $(document).on('click', '.lf-pick-x', function () {
        $(this).closest('.lf-typeahead').hide().empty();
    });

    /* Opening with no term shows the frequent ones - "just show on click",
       without making anyone type first. */
    $(document).on('focus', '.lf-q', function () {
        var key = $(this).closest('[data-lf]').attr('data-lf');
        if (key) LF.typeahead(key, this.value);
    });

    $(document).on('click', function (e) {
        if (!$(e.target).closest('.lf-search').length) {
            $('.lf-typeahead').hide().empty();
        }
    });

    /*
     * Escape closes the picker, and only the picker.
     *
     * Every other overlay in this app closes on Escape - the modals carry a
     * close_on_esc class for exactly that - so a popover that ignores it is the
     * odd one out, and the reflex is to press Escape before reaching for a
     * mouse. stopPropagation matters: without it the same keypress carries on
     * to whatever is behind, and dismissing a suggestion list would also close
     * the panel or the modal around it. The guard is "is one actually open", so
     * Escape behaves normally everywhere else.
     */
    $(document).on('keydown', function (e) {
        if (e.key !== 'Escape' && e.keyCode !== 27) return;
        var $open = $('.lf-typeahead:visible');
        if (!$open.length) return;
        e.stopPropagation();
        /* No re-focus. The input still HAS focus - that is how Escape got
           pressed - and .trigger('focus') would fire the delegated focus
           handler above, which opens the picker. Escape would reopen the thing
           it just closed. */
        $open.hide().empty();
    });
})();
