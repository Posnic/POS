/* Live sales remain ordinary authenticated list reads; the stream carries signals only. */
(function (root) {
    'use strict';
    function shouldChime(event, config, seen) {
        if (!config.enabled || !event || event.newSale !== true || !config.branchId ||
            String(event.branchId || '') !== String(config.branchId) ||
            (event.sourceDeviceId && event.sourceDeviceId === config.deviceId)) return false;
        if (event.eventId) {
            if (seen.has(event.eventId)) return false;
            seen.add(event.eventId);
            if (seen.size > 500) seen.delete(seen.values().next().value);
        }
        return true;
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = { shouldChime: shouldChime };
    if (!root || !root.document) return;
    var audio, seen = new Set(), mountedBranch;
    function branch() { return String(PosnicPro.local.get('branch_id_set') || ''); }
    function settings() {
        try { return Object.assign({ refresh: true, sound: false }, JSON.parse(localStorage.getItem('posnic.sales.live.' + branch()) || '{}')); }
        catch (_) { return { refresh: true, sound: false }; }
    }
    function chime() {
        try {
            var AudioContext = root.AudioContext || root.webkitAudioContext;
            if (!AudioContext) return;
            audio = audio || new AudioContext();
            Promise.resolve(audio.resume()).then(function () {
                [880, 1174.66].forEach(function (frequency, i) {
                    var oscillator = audio.createOscillator(), gain = audio.createGain();
                    var start = audio.currentTime + i * 0.1;
                    oscillator.frequency.value = frequency;
                    gain.gain.setValueAtTime(0, start);
                    gain.gain.linearRampToValueAtTime(0.12, start + 0.008);
                    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.45);
                    oscillator.connect(gain); gain.connect(audio.destination);
                    oscillator.start(start); oscillator.stop(start + 0.5);
                    oscillator.onended = function () { oscillator.disconnect(); gain.disconnect(); };
                });
            }).catch(function () {});
        } catch (_) { /* A muted device must not interrupt selling. */ }
    }
    function visible() { return !document.hidden && $('#sales').is(':visible'); }
    function refresh() {
        if (visible() && PosnicPro.sales && !PosnicPro.sales._historyLoading) PosnicPro.sales.loadHistory();
    }
    function mount() {
        if (mountedBranch === branch()) return;
        mountedBranch = branch(); seen.clear();
        var config = settings();
        $('#sales_auto_refresh').prop('checked', config.refresh);
        $('#sales_arrival_sound').prop('checked', config.sound);
    }
    $(function () {
        mount();
        $('#sales_refresh_btn').on('click', refresh);
        $('#sales_sound_test').on('click', chime);
        $('#sales_auto_refresh,#sales_arrival_sound').on('change', function () {
            try { localStorage.setItem('posnic.sales.live.' + branch(), JSON.stringify({
                refresh: $('#sales_auto_refresh').prop('checked'), sound: $('#sales_arrival_sound').prop('checked')
            })); } catch (_) {}
            if (this.id === 'sales_arrival_sound' && this.checked) chime();
        });
        PosnicPro.realtime.on('sales', function (event) {
            mount();
            if (settings().refresh) refresh();
        });
        PosnicPro.realtime.on('sale-arrival', function (event) {
            mount();
            var acl = PosnicPro.userACL;
            if (acl && acl.sales && acl.sales.read === true && shouldChime(event, {
                enabled: settings().sound, branchId: branch(), deviceId: PosnicPro.requestDeviceId()
            }, seen)) chime();
        });
        setInterval(function () { mount(); if (settings().refresh) refresh(); }, 5000);
        document.addEventListener('visibilitychange', function () { if (settings().refresh) refresh(); });
    });
})(typeof window === 'undefined' ? null : window);
