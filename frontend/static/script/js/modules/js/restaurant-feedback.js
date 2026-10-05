/* Restaurant-only, opt-in feedback. Effects never own focus or intercept input. */
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
        const rect = panel.getBoundingClientRect(),
            el = document.createElement('div');
        el.className = 'restaurant-feedback';
        el.setAttribute('aria-hidden', 'true');
        el.style.left = Math.max(15, Math.min(innerWidth - 310, rect.right - 325)) + 'px';
        el.style.top = Math.max(70, Math.min(innerHeight - 150, rect.top + 145)) + 'px';
        if (kind === 'sent') {
            el.classList.add('transparent-kitchen');
            el.style.left = Math.max(10, (innerWidth - 300) / 2) + 'px';
            el.style.top = Math.max(10, (innerHeight - 100) / 2) + 'px';
            el.innerHTML =
                '<svg class="free-arrow" viewBox="0 0 32 32"><path d="m3 13 26-10-10 26-4-12-12-4Z"/><path d="M15 17 29 3"/></svg><svg class="free-vessel" viewBox="0 0 64 64"><path d="M14 28h36l-3 23H17Z M9 28h46M22 23h20M32 18v5M14 32H7v9h9M50 32h7v9h-9"/><path class="steam" d="M23 16c-5-5 5-6 0-11M41 16c-5-5 5-6 0-11"/></svg><span class="vessel-ring"></span>' +
                Array.from(
                    { length: 7 },
                    (_, i) => `<i class="kitchen-spark" style="--angle:${i * 51}deg"></i>`,
                ).join('');
        } else if (kind === 'cancelled') {
            el.classList.add('sad-chef');
            el.style.left = Math.max(10, (innerWidth - 160) / 2) + 'px';
            el.style.top = Math.max(10, (innerHeight - 120) / 2) + 'px';
            el.innerHTML = '<svg viewBox="0 0 160 120"><ellipse class="chef-shadow" cx="80" cy="108" rx="24" ry="3"/><g class="chef-walk"><path class="chef-leg chef-leg-left" d="M73 85v17l-8 3"/><path class="chef-leg chef-leg-right" d="M87 85v17l8 3"/><g class="chef-body"><path class="chef-coat" d="M67 60q13-6 26 0l4 27H63Z"/><path d="m67 66-9 14m35-14 9 12M80 66v18"/><circle cx="80" cy="47" r="16" fill="#fff4e8"/><path class="chef-hat" d="M65 37v-9c-12-9 0-22 9-15 5-12 22-7 22 3 13 0 15 17 1 19l-2 5Z"/><path d="m69 46 5 2m12 0 5-2M74 58q6-7 12 0"/><circle cx="74" cy="50" r="1"/><circle cx="86" cy="50" r="1"/></g></g></svg>';
        } else if (kind === 'payment') {
            el.classList.add('transparent-gold');
            el.innerHTML =
                Array.from(
                    { length: 7 },
                    (_, i) =>
                        `<span class="free-coin" style="--dx:${[-65, -40, -12, 18, 48, 70, 0][i]}px;--dy:${[-44, -85, -110, -100, -74, -30, -60][i]}px;--delay:${i * 35}ms">★</span>`,
                ).join('') +
                Array.from(
                    { length: 10 },
                    (_, i) => `<i class="gold-spark" style="--angle:${i * 36}deg"></i>`,
                ).join('');
        } else {
            el.classList.add('small-feedback');
            if (kind === 'reduce') el.classList.add('reduce');
            el.textContent = kind === 'reduce' ? '☹' : '♥';
            if (kind === 'first')
                el.innerHTML += Array.from(
                    { length: 6 },
                    (_, i) => `<i style="--angle:${i * 60}deg"></i>`,
                ).join('');
        }
        const width = kind === 'sent' ? 300 : kind === 'cancelled' ? 160 : kind === 'payment' ? 140 : 40;
        el.style.left = Math.max(8, (innerWidth - width) / 2) + 'px';
        el.style.top = 'auto';
        el.style.bottom = 'max(24px, env(safe-area-inset-bottom))';
        document.body.append(el);
        timer = setTimeout(clear, kind === 'cancelled' ? 1800 : kind === 'sent' ? 2100 : kind === 'payment' ? 1800 : 950);
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
