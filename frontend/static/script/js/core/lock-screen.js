/*
 * Locking the till.
 *
 * The app used to open straight onto the dashboard for a whole day after a
 * login, because a cookie said somebody had signed in once. That is convenient
 * and it is also why shops end up sharing one account: full login at a busy
 * counter is friction, and the way out of friction is to never log out. Then
 * every sale, discount and drawer-open for the day belongs to whoever signed
 * in yesterday, which is exactly the record you want when the till is short.
 *
 * A PIN is quick enough that switching user costs nothing, so attribution
 * survives the lunch rush. The rule it is built on:
 *
 *   a PIN unlocks, a password authenticates.
 *
 * A PIN can only resume a session a password already established on this
 * machine. Log out deliberately and the till forgets you; the way back in is
 * the password. Everything about the PIN itself lives in the main process -
 * this file asks to unlock and is given a session or refused.
 */
(function () {
    'use strict';

    var IDLE_KEY = 'lock.idleMinutes';
    var LAST_USER_KEY = 'lock.lastUser';
    var DEFAULT_IDLE_MINUTES = 0;   // off until a shop turns it on

    /*
     * Offer the password once three tries have gone.
     *
     * The main process allows five before it forgets the PIN altogether, so
     * two left means three have been missed. Expressed in tries remaining
     * because that is what the main process reports back - it owns the limit,
     * and this must not hold a second opinion about what it is.
     */
    var SUGGEST_PASSWORD_AT_TRIES_LEFT = 2;

    var state = {
        open: false,
        username: null,
        displayName: '',
        entered: '',
        length: 4,
        idleTimer: null,
    };

    /*
     * The bridge, or nothing.
     *
     * In a browser there is no electronAPI, so this returns null and every
     * entry point below turns into a no-op. The web app therefore behaves
     * exactly as it did before this file existed - no lock, no keyboard
     * shortcut, no errors in the console. A till lock needs somewhere safe to
     * keep an encrypted session, and a browser tab is not that.
     */
    function api() {
        return (window.electronAPI && window.electronAPI.lock) || null;
    }

    /*
     * Whether the shop wants this at all.
     *
     * Stored on the branch rather than the machine, so it is one decision for
     * the shop and an admin can turn it off for everyone from Config. Off
     * unless switched on: an update must never start demanding a PIN that
     * nobody has been given.
     */
    function enabled() {
        if (!api()) return false;
        try {
            var raw = PosnicPro.local.get('general_settings');
            if (!raw) return false;
            return JSON.parse(raw).till_lock_enable === true;
        } catch (e) {
            return false;
        }
    }

    function configuredIdleMinutes() {
        try {
            var raw = PosnicPro.local.get('general_settings');
            if (!raw) return null;
            var value = JSON.parse(raw).till_lock_idle_minutes;
            return (value === undefined || value === null) ? null : parseInt(value, 10);
        } catch (e) {
            return null;
        }
    }

    /* ---------------------------------------------------------------- *
     * Markup
     * ---------------------------------------------------------------- */

    var KEYPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

    function build() {
        if (document.getElementById('posnic-lock')) return;

        var root = document.createElement('div');
        root.id = 'posnic-lock';
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-modal', 'true');
        root.setAttribute('aria-label', 'Till locked');

        var keys = '';
        for (var i = 0; i < KEYPAD.length; i++) {
            keys += '<button type="button" class="lock-key" data-digit="' + KEYPAD[i] + '"'
                + ' aria-label="' + KEYPAD[i] + '">' + KEYPAD[i] + '</button>';
        }
        // Bottom row: switch user, zero, delete. Zero stays in the middle where
        // a phone keypad puts it, because that is where a thumb expects it.
        keys += '<button type="button" class="lock-key is-quiet" data-action="switch"'
            + ' aria-label="Switch user" data-t-aria-label="lang_switch_user">Switch</button>';
        keys += '<button type="button" class="lock-key" data-digit="0" aria-label="0">0</button>';
        keys += '<button type="button" class="lock-key is-quiet" data-action="delete"'
            + ' aria-label="Delete last digit" data-t-aria-label="lang_delete_last_digit">'
            + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 3H7L1 12l6 9h15a2 2 0 0 0'
            + ' 2-2V5a2 2 0 0 0-2-2zm-3.7 12.3-1.4 1.4L14 13.8l-2.9 2.9-1.4-1.4 2.9-2.9-2.9-2.9'
            + ' 1.4-1.4 2.9 2.9 2.9-2.9 1.4 1.4-2.9 2.9 2.9 2.9z"/></svg></button>';

        root.innerHTML =
            '<div class="lock-clock"><p class="lock-time" id="lock_time"></p>'
            + '<p class="lock-date" id="lock_date"></p></div>'
            + '<div class="lock-panel">'
            + '  <img class="lock-brand" id="lock_brand" alt="" style="display:none;">'
            + '  <div id="lock_single">'
            + '    <div class="lock-avatar" id="lock_avatar"></div>'
            + '    <p class="lock-name" id="lock_name"></p>'
            + '    <p class="lock-hint" id="lock_hint"><lang class="lang_enter_your_pin">Enter your PIN</lang></p>'
            + '    <div class="lock-dots" id="lock_dots"></div>'
            + '    <div class="lock-keys">' + keys + '</div>'
            + '  </div>'
            + '  <div id="lock_chooser" style="display:none;">'
            + '    <p class="lock-name"><lang class="lang_who_is_at_the_till">Who is at the till?</lang></p>'
            + '    <p class="lock-hint"><lang class="lang_choose_your_name_to_enter_your_pin">Choose your name to enter your PIN.</lang></p>'
            + '    <div class="lock-users" id="lock_users"></div>'
            + '  </div>'
            + '</div>'
            /*
             * Outside the panel, not inside it.
             *
             * The clock and this were both positioned over the screen while the
             * panel was centred in it, so at a middling window size - the size
             * the app opens at - they landed on top of the keypad. Three rows
             * that cannot overlap by construction beats three things placed
             * carefully enough to miss each other.
             */
            + '<div class="lock-actions">'
            + '  <button type="button" class="lock-link" id="lock_password">'
            + '    Use password instead</button>'
            + '</div>';

        document.body.appendChild(root);
        wire(root);
    }

    function wire(root) {
        root.addEventListener('click', function (e) {
            var key = e.target.closest('.lock-key');
            if (key) {
                if (key.dataset.digit) press(key.dataset.digit);
                else if (key.dataset.action === 'delete') backspace();
                else if (key.dataset.action === 'switch') showChooser();
                return;
            }
            var user = e.target.closest('.lock-user');
            if (user) {
                showUser(user.dataset.username, user.dataset.display);
                return;
            }
            if (e.target.closest('#lock_password')) {
                // In setup this button is "Not now", and skipping a PIN must
                // not throw away the session the user just logged in with.
                if (state.mode === 'setup') {
                    state.mode = 'unlock';
                    close();
                    if (typeof state.onDone === 'function') state.onDone(false);
                    return;
                }
                toPassword();
            }
        });

        /*
         * The physical keyboard matters as much as the touchscreen: plenty of
         * tills have a keyboard with a numeric pad, and a cashier who can type
         * will always be faster than one who taps.
         */
        document.addEventListener('keydown', function (e) {
            if (!state.open) return;
            if (e.key >= '0' && e.key <= '9') { press(e.key); e.preventDefault(); return; }
            if (e.key === 'Backspace') { backspace(); e.preventDefault(); return; }
            if (e.key === 'Escape') { e.preventDefault(); return; }   // no way past it
            if (e.key === 'Enter' && state.entered.length >= 4) { submit(); e.preventDefault(); }
        }, true);
    }

    /* ---------------------------------------------------------------- *
     * Entry
     * ---------------------------------------------------------------- */

    function renderDots() {
        var target = document.getElementById('lock_dots');
        if (!target) return;
        var html = '';
        for (var i = 0; i < state.length; i++) {
            html += '<span class="lock-dot' + (i < state.entered.length ? ' is-filled' : '') + '"></span>';
        }
        target.innerHTML = html;
    }

    function press(digit) {
        if (state.entered.length >= state.length) return;
        state.entered += digit;
        renderDots();
        // Auto-submit on the last digit: nobody wants to reach for a separate
        // confirm key when the length is already known.
        if (state.entered.length === state.length) setTimeout(submit, 120);
    }

    function backspace() {
        state.entered = state.entered.slice(0, -1);
        renderDots();
    }

    function wrong(message) {
        var dots = document.getElementById('lock_dots');
        if (!dots) return;
        dots.classList.add('is-wrong');
        setTimeout(function () { dots.classList.remove('is-wrong'); }, 500);
        var hint = document.getElementById('lock_hint');
        hint.textContent = message;
        hint.classList.add('is-error');
        state.entered = '';
        setTimeout(renderDots, 400);
    }

    /*
     * Choosing a PIN, on the same keypad it will be typed on afterwards.
     *
     * Once to choose, once to confirm. A PIN nobody can reproduce is worse
     * than no PIN, because it is discovered at the counter with a queue
     * waiting.
     */
    function submitSetup() {
        var pin = state.entered;
        state.entered = '';

        if (!state.firstPin) {
            state.firstPin = pin;
            var hint = document.getElementById('lock_hint');
            hint.textContent = 'Enter it once more to confirm';
            hint.classList.remove('is-error');
            renderDots();
            return;
        }

        if (state.firstPin !== pin) {
            state.firstPin = '';
            wrong('Those did not match. Start again.');
            setTimeout(function () {
                var hint = document.getElementById('lock_hint');
                if (hint) hint.textContent = 'Choose a PIN';
            }, 1400);
            return;
        }

        api().enroll({
            username: state.username,
            displayName: state.displayName,
            pin: pin,
            session: state.session,
        }).then(function (result) {
            if (result && result.success) {
                PosnicPro.local.set(LAST_USER_KEY, state.username);
                state.mode = 'unlock';
                close();
                if (typeof state.onDone === 'function') state.onDone(true);
                return;
            }
            // The main process refuses 1234 and its relatives. Say why rather
            // than just refusing, or it reads as a fault.
            state.firstPin = '';
            wrong((result && result.error) || 'That PIN was not accepted.');
            setTimeout(function () {
                var hint = document.getElementById('lock_hint');
                if (hint) hint.textContent = 'Choose a PIN';
            }, 1800);
        });
    }

    function submit() {
        if (state.mode === 'setup') return submitSetup();

        var pin = state.entered;
        if (!api()) return;

        api().unlock({ username: state.username, pin: pin }).then(function (result) {
            if (result && result.success) {
                restore(result.session);
                close();
                return;
            }
            if (result && result.reason === 'locked-out') {
                // Five wrong tries and the till forgets the PIN entirely. It
                // says so rather than simply refusing again, so nobody stands
                // there retrying a PIN that no longer exists.
                toPassword('Too many wrong PINs. Sign in with your password.');
                return;
            }
            var left = (result && result.attemptsLeft) || 0;
            wrong(left === 1 ? 'Wrong PIN. One try left before you need your password.'
                : 'Wrong PIN. ' + left + ' tries left.');

            /*
             * After three wrong PINs, point at the way out.
             *
             * Somebody who has missed three times is not going to get it on the
             * fourth by concentrating harder - they have forgotten it, or they
             * are on a colleague's till. Saying so before the lockout, rather
             * than after, is the difference between signing in with a password
             * and calling somebody because the PIN "stopped working".
             */
            if (left <= SUGGEST_PASSWORD_AT_TRIES_LEFT) suggestPassword();
        }).catch(function () {
            wrong('Could not check that PIN.');
        });
    }

    /*
     * Draw attention to "Use password instead".
     *
     * It sits quietly in the corner the rest of the time - it is the way out,
     * not the way in, and a lock screen offering two equal choices invites the
     * slower one. Once somebody is clearly stuck it stops being quiet.
     */
    function suggestPassword() {
        var link = document.getElementById('lock_password');
        if (link) link.classList.add('is-suggested');
    }

    function unsuggestPassword() {
        var link = document.getElementById('lock_password');
        if (link) link.classList.remove('is-suggested');
    }

    /* ---------------------------------------------------------------- *
     * Opening and closing
     * ---------------------------------------------------------------- */

    function showUser(username, displayName) {
        state.username = username;
        state.displayName = displayName || username;
        state.entered = '';
        document.getElementById('lock_chooser').style.display = 'none';
        document.getElementById('lock_single').style.display = '';
        document.getElementById('lock_name').textContent = state.displayName;
        document.getElementById('lock_avatar').textContent =
            String(state.displayName).trim().charAt(0).toUpperCase() || '?';
        var hint = document.getElementById('lock_hint');
        hint.textContent = 'Enter your PIN';
        hint.classList.remove('is-error');
        unsuggestPassword();   // a different person starts with a clean slate
        renderDots();
    }

    function showChooser() {
        api().users().then(function (users) {
            if (!users || users.length < 2) return;   // nothing to choose between
            var html = '';
            for (var i = 0; i < users.length; i++) {
                html += '<button type="button" class="lock-user" data-username="'
                    + users[i].username + '" data-display="' + users[i].displayName + '">'
                    + users[i].displayName + '</button>';
            }
            document.getElementById('lock_users').innerHTML = html;
            document.getElementById('lock_single').style.display = 'none';
            document.getElementById('lock_chooser').style.display = '';
        });
    }

    function clock() {
        var now = new Date();
        var time = document.getElementById('lock_time');
        var date = document.getElementById('lock_date');
        if (!time) return;
        time.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        date.textContent = now.toLocaleDateString([],
            { weekday: 'long', day: 'numeric', month: 'long' });
    }

    /*
     * Lock, and take the session away while locked.
     *
     * Hiding the page behind an overlay is theatre if the token is still in
     * localStorage - anything running in the page could still call the API.
     * The token goes back only when a PIN produces it.
     */
    /*
     * Lock the till.
     *
     * Who is enrolled is settled before anything is taken away. Locking a till
     * where nobody has a PIN would leave the only way back in as the password
     * screen - which is to say, locking would log the cashier out. That is a
     * worse outcome than not locking, so it simply does not happen.
     */
    /*
     * Take the cover off the page.
     *
     * dashboard.html hides everything before it draws when it has reason to
     * think a lock is coming, so nobody reads the till over the shoulder of a
     * loading screen. Whoever settles the question - the lock going up, or the
     * discovery that no lock is needed - uncovers.
     */
    function uncover() {
        if (typeof window.__posnicUncover === 'function') window.__posnicUncover();
    }

    /*
     * Remember, for next time, whether anyone can unlock this machine.
     *
     * The cover has to be decided before a single script runs, and asking the
     * main process takes a round trip. So the answer from last time is left in
     * localStorage and read synchronously on the way in.
     */
    function rememberEnrolled(yes) {
        try { PosnicPro.local.set('lock.enrolled', yes ? 'yes' : 'no'); } catch (e) {}
    }

    function open() {
        if (state.open || !api()) { uncover(); return; }

        api().users().then(function (users) {
            rememberEnrolled(users && users.length);
            if (!users || !users.length) { uncover(); return; }   // nobody could unlock it
            if (state.open) { uncover(); return; }

            build();
            state.open = true;
            state.mode = 'unlock';
            state.entered = '';
            document.getElementById('lock_password').textContent = 'Use password instead';
            /*
             * No uncover here on purpose. The lock is exempt from the cover, so
             * it shows; everything behind it stays hidden until the PIN is
             * right. The overlay is opaque, so this is belt and braces - but
             * belt and braces is the correct amount for a screen whose whole
             * job is that the till cannot be read.
             */

            /*
             * The session goes away while locked.
             *
             * Covering the page is theatre if the token is still in
             * localStorage - anything running behind the overlay could keep
             * calling the API. It comes back only when a PIN produces it.
             */
            try {
                localStorage.removeItem('posnic_jwt_token');
            } catch (e) { /* nothing to remove */ }

            var root = document.getElementById('posnic-lock');
            root.classList.add('is-open');
            clock();
            state.clockTimer = setInterval(clock, 10000);

            var brand = document.getElementById('lock_brand');
            var logo = PosnicPro.local.get('branchimage') || '';
            if (logo) { brand.src = logo; brand.style.display = ''; }

            var last = PosnicPro.local.get(LAST_USER_KEY);
            var chosen = users.filter(function (u) { return u.username === last; })[0] || users[0];
            showUser(chosen.username, chosen.displayName);
            document.querySelector('[data-action="switch"]').style.visibility =
                users.length > 1 ? '' : 'hidden';
        }).catch(function () {
            /*
             * The lock could not be put up. Uncover rather than leave a till
             * that will not draw: a machine nobody can use is a worse failure
             * than one that did not lock, and the shop can still sign out.
             */
            uncover();
        });
    }

    function close() {
        var root = document.getElementById('posnic-lock');
        if (root) root.classList.remove('is-open');
        state.open = false;
        state.entered = '';
        clearInterval(state.clockTimer);
        uncover();          // the till is theirs again; let the page show
        resetIdle();
    }

    function restore(session) {
        if (!session) return;
        if (session.token) {
            try { localStorage.setItem('posnic_jwt_token', session.token); } catch (e) {}
        }
        if (session.cookie) PosnicPro.users.createCookie('loginuser', 'yes', 1);
        PosnicPro.local.set(LAST_USER_KEY, state.username);
    }

    function toPassword(message) {
        if (message) {
            try { sessionStorage.setItem('lock.message', message); } catch (e) {}
        }
        try {
            localStorage.removeItem('posnic_jwt_token');
            PosnicPro.users.createCookie('loginuser', '', -1);
        } catch (e) {}
        PosnicPro.lockScreen.navigate('login.html');
    }

    /* ---------------------------------------------------------------- *
     * When to lock
     * ---------------------------------------------------------------- */

    function idleMinutes() {
        // The shop's setting wins; the local one is only a fallback for a till
        // that has not synced its settings yet.
        var configured = configuredIdleMinutes();
        if (configured !== null && !isNaN(configured)) return configured;
        var stored = parseInt(PosnicPro.local.get(IDLE_KEY), 10);
        return isNaN(stored) ? DEFAULT_IDLE_MINUTES : stored;
    }

    function resetIdle() {
        clearTimeout(state.idleTimer);
        var minutes = idleMinutes();
        if (!minutes || state.open) return;
        state.idleTimer = setTimeout(function () {
            PosnicPro.lockScreen.lock();
        }, minutes * 60000);
    }

    PosnicPro.lockScreen = {
        lock: open,
        isOpen: function () { return state.open; },

        /*
         * Whether locking is actually possible here.
         *
         * The menu entry asks before showing itself. In a browser, or in a shop
         * that has not switched the lock on, there is nothing behind the button
         * and an entry that does nothing when clicked is worse than no entry.
         */
        available: function () { return Boolean(api()) && enabled(); },

        // Leaving the page, as its own function so a test can watch for it
        // rather than actually navigating.
        navigate: function (url) { window.location = url; },

        /*
         * Offer to remember this user, after a password login.
         *
         * Only ever called with a session in hand, because only a password
         * login has one to give.
         */
        enroll: function (details) {
            if (!api()) return Promise.resolve({ success: false });
            return api().enroll(details).then(function (result) {
                if (result && result.success) PosnicPro.local.set(LAST_USER_KEY, details.username);
                return result;
            });
        },

        forget: function (username) {
            return api() ? api().forget(username) : Promise.resolve({ success: false });
        },

        /*
         * Stop everything this holds open.
         *
         * The clock and the idle countdown are both live timers, and a page
         * that is going away should not leave them running.
         */
        destroy: function () {
            clearInterval(state.clockTimer);
            clearTimeout(state.idleTimer);
            state.clockTimer = null;
            state.idleTimer = null;
            state.open = false;
        },

        /*
         * Offer to set a PIN, on the same screen it will be used on.
         *
         * Called after a password login, which is the only moment a session
         * exists to be locked away.
         */
        setup: function (details, onDone) {
            if (!api()) return;
            build();
            state.mode = 'setup';
            state.open = true;
            state.firstPin = '';
            state.entered = '';
            state.session = details.session;
            state.username = details.username;
            state.displayName = details.displayName || details.username;
            state.onDone = onDone;

            var root = document.getElementById('posnic-lock');
            root.classList.add('is-open');
            clock();
            state.clockTimer = setInterval(clock, 10000);

            document.getElementById('lock_chooser').style.display = 'none';
            document.getElementById('lock_single').style.display = '';
            document.getElementById('lock_name').textContent = state.displayName;
            document.getElementById('lock_avatar').textContent =
                String(state.displayName).trim().charAt(0).toUpperCase() || '?';
            document.getElementById('lock_hint').textContent = 'Choose a PIN';
            document.querySelector('[data-action="switch"]').style.visibility = 'hidden';
            // Setting up is optional, so there has to be a way past it that is
            // not "guess a PIN you have not chosen yet".
            document.getElementById('lock_password').textContent = 'Not now';
            renderDots();
        },

        users: function () {
            return api() ? api().users() : Promise.resolve([]);
        },

        setIdleMinutes: function (minutes) {
            PosnicPro.local.set(IDLE_KEY, String(minutes || 0));
            resetIdle();
        },

        idleMinutes: idleMinutes,

        /*
         * Lock on startup when somebody is enrolled.
         *
         * This is the answer to the app opening straight onto the dashboard a
         * day after a login: the session is still good, but the till has no
         * idea who is holding it until somebody says so.
         */
        start: function () {
            // No bridge means a browser, and no setting means the shop has not
            // asked for this. Either way nothing below runs and nothing is
            // bound - the web app is untouched.
            if (!api()) { uncover(); return; }

            /*
             * Ctrl+L locks the till.
             *
             * Bound only on the desktop, and only when the shop has the lock
             * switched on, so a browser never has Ctrl+L taken away from it.
             */
            document.addEventListener('keydown', function (e) {
                if ((e.ctrlKey || e.metaKey) && (e.key === 'l' || e.key === 'L')) {
                    if (!enabled() || state.open) return;
                    e.preventDefault();
                    open();
                }
            });

            /*
             * The shop switched the lock off since this machine last looked.
             * Clear the remembered flag so the next start does not cover the
             * page for a lock that is not coming.
             */
            if (!enabled()) { rememberEnrolled(false); uncover(); return; }

            /*
             * Closing to the tray locks too.
             *
             * X hides the window instead of quitting, so the page stays loaded
             * and nothing that runs on load runs again. Quitting and reopening
             * locked the till; closing it did not, which is the wrong way round
             * - closing is what somebody does when they walk away.
             */
            if (api().onLockRequest) {
                api().onLockRequest(function () {
                    if (!state.open) open();
                });
            }

            /*
             * The menu entry, revealed now that locking is known to work here.
             *
             * Ctrl+L is faster once somebody knows it exists, and nobody knows
             * it exists. A till is handed between people who were shown the
             * screen once, so the way to lock it has to be visible in the place
             * they already go to sign out.
             */
            (function () {
                var item = document.getElementById('lock_screen_item');
                var link = document.getElementById('lock_screen');
                if (!item || !link) return;   // a page without the header
                item.style.display = '';
                link.addEventListener('click', function (e) {
                    e.preventDefault();
                    if (!state.open) open();
                });
            }());

            api().users().then(function (users) {
                if (users && users.length) { open(); return; }

                /*
                 * Nobody can unlock this machine, so nothing is going to cover
                 * it. Say so now - both to this page, which is sitting behind a
                 * blank screen waiting, and to the next start, which decides
                 * whether to cover before any of this code runs.
                 */
                rememberEnrolled(false);
                uncover();

                /*
                 * Nobody is enrolled yet, so offer it once.
                 *
                 * Offered here rather than during login because login
                 * navigates away the moment it succeeds - and offered only
                 * once, because a prompt that returns every morning gets
                 * dismissed on reflex and teaches people to ignore it.
                 */
                var username = PosnicPro.local.get('username');
                var token = null;
                try { token = localStorage.getItem('posnic_jwt_token'); } catch (e) {}
                if (!username || !token || PosnicPro.local.get('lock.declined') === 'yes') {
                    resetIdle();
                    return;
                }

                var name = [PosnicPro.local.get('userfirstname'),
                    PosnicPro.local.get('userlastname')].filter(Boolean).join(' ');
                PosnicPro.lockScreen.setup({
                    username: username,
                    displayName: name || username,
                    session: { token: token, cookie: true },
                }, function (enrolled) {
                    if (!enrolled) PosnicPro.local.set('lock.declined', 'yes');
                });
            });

            ['mousedown', 'keydown', 'touchstart', 'wheel'].forEach(function (event) {
                document.addEventListener(event, function () {
                    if (!state.open) resetIdle();
                }, { passive: true });
            });
        },
    };
}());
