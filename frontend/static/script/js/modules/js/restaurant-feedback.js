/* Restaurant-only feedback, respecting saved preferences. Never intercepts input. */
(function () {
    'use strict';
    const P = PosnicPro;
    let optedIn = false,
        loadedBranch = null,
        generation = 0,
        timer;
    const enabled = (value) => value === true || value === 'true' || value === 'enable' || value === '1';
    function clear() {
        clearTimeout(timer);
        document.querySelectorAll('.restaurant-feedback').forEach((el) => el.remove());
    }
    function load() {
        const branch = P.local.get('branch_id_set'),
            version = ++generation;
        optedIn = false;
        loadedBranch = null;
        return new Promise((resolve) =>
            P.get(
                { url: 'settings/group/channels', data: {} },
                (result) => {
                    if (version !== generation || branch !== P.local.get('branch_id_set'))
                        return resolve(false);
                    if (result?.type === 'success') {
                        optedIn = enabled(result.data?.values?.restaurant_playful_feedback);
                        loadedBranch = branch;
                    }
                    resolve(optedIn);
                },
                () => resolve(false),
            ),
        );
    }
    function allowed() {
        return (
            loadedBranch === P.local.get('branch_id_set') &&
            optedIn &&
            enabled(P.local.get('table_options')) &&
            !window.matchMedia('(prefers-reduced-motion: reduce)').matches
        );
    }
    function play(kind) {
        if (!allowed()) return;
        const panel = document.querySelector('#kot_v2 .kv2-order');
        if (!panel || !panel.getClientRects().length) return;
        clear();
        const el = document.createElement('div');
        el.className = 'restaurant-feedback';
        el.setAttribute('aria-hidden', 'true');
        // Captain develop f280fcb: kitchen-send-feedback.js and thankyou/placed.css.
        // Reuse its dish, plane, chef and drawn tick; keep the scene at the POS footer.
        if (kind === 'sent') {
            el.classList.add('captain-kitchen');
            el.innerHTML = '<svg class="kitchen-flight-dish" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 24h24M6 21a10 10 0 0 1 20 0Z M16 8v3m-2-3h4"/></svg><svg class="kitchen-flight-plane" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="m3 10 18-7-7 18-3-8-8-3Z m8 3L21 3"/></svg>';
            const tables = new Map((P.kot_v2?.state?.floor || []).filter(row => row.tableorder_value != null).map(row => [String(row.tableorder_value), row]));
            if (tables.size && [...tables.values()].filter(row => row.status === 'occupied').length / tables.size >= .7) {
                el.querySelector('.kitchen-flight-plane').remove();
                el.innerHTML += '<span class="kitchen-chef-runner"><span class="kitchen-chef-person">👨‍🍳</span><span class="kitchen-chef-meal">🍲</span></span><span class="kitchen-chef-finish">👍</span>';
            }
        } else if (kind === 'cancelled') {
            el.classList.add('captain-chef-dismiss');
            el.innerHTML = '<span class="kitchen-chef-person">👨‍🍳</span>';
        } else if (kind === 'served' || kind === 'payment') {
            el.classList.add('captain-confirmation');
            el.innerHTML = '<svg viewBox="0 0 52 52"><circle class="tick-ring" cx="26" cy="26" r="24" fill="none"/><path class="tick-mark" fill="none" d="M14.5 27l7.5 7.5 15.5-16"/></svg>';
        } else {
            // Captain's local bill nudge replaces floating hearts and faces.
            const cart = document.querySelector('#kot_v2 .kv2-round-total strong') || document.querySelector('#kot_v2 .kv2-order>footer strong');
            cart?.animate?.([{transform:'scale(1)'},{transform:'scale(1.08)'},{transform:'scale(1)'}], {duration:340,easing:'cubic-bezier(.34,1.56,.64,1)'});
            return;
        }
        const width = kind === 'sent' ? Math.min(360, innerWidth - 16) : 96;
        el.style.width = width + 'px';
        el.style.left = Math.max(8, (innerWidth - width) / 2) + 'px';
        el.style.top = 'auto';
        el.style.bottom = 'max(24px, env(safe-area-inset-bottom))';
        document.body.append(el);
        timer = setTimeout(clear, kind === 'cancelled' ? 1800 : kind === 'sent' ? 2100 : kind === 'payment' ? 1400 : kind === 'served' ? 1200 : 950);
    }
    P.restaurantFeedback = {
        load,
        play,
        clear,
        allowed,
        apply(value, branch) {
            generation++;
            loadedBranch = branch;
            optedIn = value === true;
            if (!optedIn) clear();
        },
    };
    window.addEventListener('hashchange', clear);
    window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', clear);
    $(document).on('click', '#restaurantfeedback-tab', async function () {
        const checkbox = document.getElementById('restaurant-feedback-enabled'),
            save = document.getElementById('restaurant-feedback-save');
        checkbox.disabled = save.disabled = true;
        await load();
        checkbox.checked = optedIn;
        checkbox.disabled = save.disabled = loadedBranch === null;
        document.getElementById('restaurant-feedback-status').textContent =
            loadedBranch === null ? 'Could not load the setting. Reopen this tab to retry.' : '';
    });
    $(document).on('click', '#restaurant-feedback-save', function () {
        const control = this,
            branch = P.local.get('branch_id_set'),
            value = document.getElementById('restaurant-feedback-enabled').checked;
        control.disabled = true;
        const finish = (ok, message) => {
            control.disabled = false;
            document.getElementById('restaurant-feedback-status').textContent = message;
            if (ok && branch === P.local.get('branch_id_set')) {
                optedIn = value;
                loadedBranch = branch;
                if (!value) clear();
            }
        };
        P.put(
            { url: 'settings/group/channels', data: JSON.stringify({ restaurant_playful_feedback: value }) },
            (r) =>
                finish(
                    r?.type === 'success',
                    r?.type === 'success' ? 'Saved' : r?.message || 'Could not save',
                ),
            () => finish(false, 'Could not save. Please retry.'),
        );
    });
})();
