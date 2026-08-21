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
 *     Exact is not cosmetic - an anchored match can be served by an index
 *     where a fragment cannot.
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
    activeCount: function (key) {
        var st = PosnicPro.listFilter.state(key);
        var n = 0;
        if (st.search) n++;
        if (st.preset && st.preset !== 'all') n++;
        (st.extra ? Object.keys(st.extra) : []).forEach(function (k) {
            if (st.extra[k] !== '' && st.extra[k] != null) n++;
        });
        return n;
    },

    /* What the server is sent. Defaults are omitted: field=all&exact=false
       says exactly what sending neither says, and a request that spells out
       its defaults is harder to read in a log. */
    params: function (key) {
        var st = PosnicPro.listFilter.state(key);
        var out = {};
        if (st.search) {
            out.search = st.search;
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

    LF.mount = function (cfg) {
        var key = cfg.key;
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

        var fields = cfg.searchFields || [{ value: 'all', label: 'All fields' }];
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
            + '  <label class="lf-exact mb-0" title="Match the whole value, not part of it">'
            + '    <input type="checkbox" class="lf-exact-cb"' + (st.exact ? ' checked' : '') + '> Exact'
            + '  </label>';

        if (cfg.dateField) {
            html += ''
                + '  <select class="form-control form-control-sm lf-preset">'
                + LF.PRESETS.map(function (p) {
                    return '<option value="' + p.key + '"' + (st.preset === p.key ? ' selected' : '') + '>'
                        + esc(p.label) + '</option>';
                }).join('')
                + '  </select>'
                + '  <div class="lf-custom" style="display:' + (st.preset === 'custom' ? 'flex' : 'none') + ';">'
                + '    <input type="datetime-local" class="form-control form-control-sm lf-from" value="' + forInput(st.from) + '">'
                + '    <span class="lf-sep">to</span>'
                + '    <input type="datetime-local" class="form-control form-control-sm lf-to" value="' + forInput(st.to) + '">'
                + '  </div>'
                + '  <button type="button" class="btn btn-sm btn-light border lf-clear">Clear</button>';
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
        var from = $panel.find('.lf-from').val();
        var to = $panel.find('.lf-to').val();
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

    var uniq = function (rows) {
        var seen = {}, out = [];
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
            }
        },
        item: {
            title: 'Choose item',
            icon: 'icon-box',
            rows: function () {
                return uniq(recents('recent_items').map(function (i) {
                    return { id: i.id, label: i.name, note: i.sku || i.barcode, recent: true };
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

        var rows = LF.suggest(entity, term);
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
            : '<div class="lf-pick-empty">Nothing matches - press Enter to search anyway</div>';

        $box.html(
            '<div class="lf-pick-head">'
            + '<span class="lf-pick-title"><i class="feather ' + esc(e.icon) + ' mr-1"></i>' + esc(e.title) + '</span>'
            + '<a href="javascript:void(0)" class="lf-pick-x" title="Close">&times;</a>'
            + '</div>'
            + '<div class="lf-pick-list">' + body + '</div>'
        ).show();
    };

    /* Picking narrows the field and switches to exact - choosing from a list
       means you have stopped wanting fuzzy. */
    $(document).on('click', '.lf-pick-row', function () {
        var $panel = $(this).closest('[data-lf]');
        var key = $panel.attr('data-lf');
        var m = LF._mounted[key];
        if (!m) return;
        var name = String($(this).data('name'));
        m.state.search = name;
        m.state.exact = true;
        if (m.cfg.typeaheadField) {
            m.state.field = m.cfg.typeaheadField;
            $panel.find('.lf-field').val(m.cfg.typeaheadField);
        }
        $panel.find('.lf-q').val(name);
        $panel.find('.lf-exact-cb').prop('checked', true);
        $panel.find('.lf-typeahead').hide().empty();
        LF._changed(key);
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
})();
