/* Page help is bundled with the till. Only an explicit guide click goes online. */
(function () {
    'use strict';
    var origin = 'https://www.posnic.com/guides/posnic-pos-complete-user-guide/';
    var returnFocus = null;
    var home = null;
    function t(key, english) {
        return PosnicPro.i18n && PosnicPro.i18n.t ? PosnicPro.i18n.t(key, english) : english;
    }
    function node(id) { return document.getElementById(id); }
    function hash() {
        return String(window.location.hash || '#/dashboard').replace(/^#\/?/, '').split('?')[0].replace(/\/$/, '') || 'dashboard';
    }
    function resolve(route) {
        var topics = window.PosnicHelpTopics || {};
        if (topics[route]) return topics[route];
        var parts = route.split('/');
        var pattern = parts.map(function (part, i) { return i === 1 ? ':id' : part; }).join('/');
        if (topics[pattern]) return topics[pattern];
        // Do not guess a guide for an unknown extension, record action or tab.
        var heading = document.querySelector('.page_loader[style]:not([style*="display: none"]):not([style*="display:none"]) .page-title');
        return { title: heading ? heading.textContent.trim() : t('lang_posnic', 'Posnic'), guide: null, status: 'missing' };
    }
    function refresh() {
        var link = node('posnic_page_help');
        if (!link) return;
        var topic = resolve(hash());
        var title = topic.titleKey ? t(topic.titleKey, topic.title) : topic.title;
        if (hash() === 'settings/taxmodule') title = t('lang_help_tax_settings', 'Tax Settings');
        link.textContent = t('lang_help_with_page', 'Help with {page}').replace('{page}', title);
        var safe = typeof topic.guide === 'string' && /^[a-z0-9-]+(?:\/[a-z0-9-]+)*\/$/.test(topic.guide);
        if (safe) link.href = origin + topic.guide;
        else link.removeAttribute('href');
        link.setAttribute('aria-disabled', safe ? 'false' : 'true');
        node('posnic_guide_status').hidden = safe && topic.status === 'verified';
    }
    function close(focus) {
        var menu = node('posnic_help_menu'), toggle = node('posnic_help_toggle');
        if (!menu || !toggle) return;
        menu.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
        if (home && menu.parentElement !== home) home.appendChild(menu);
        if (focus) (returnFocus && returnFocus.isConnected ? returnFocus : toggle).focus();
    }
    function open() {
        if (!node('posnic_help_menu') || !node('posnic_help_toggle')) return;
        var menu = node('posnic_help_menu');
        if (!menu.hidden) { refresh(); return; }
        returnFocus = document.activeElement && document.activeElement !== document.body ? document.activeElement : node('posnic_help_toggle');
        if (!home) home = menu.parentElement;
        // Keep Help inside an open dialog's focus boundary, without changing it.
        var modal = document.querySelector('.modal.show');
        if (modal) modal.appendChild(menu);
        refresh();
        menu.hidden = false;
        node('posnic_help_toggle').setAttribute('aria-expanded', 'true');
        var first = node('posnic_help_menu').querySelector('a[href],button');
        if (first) first.focus();
    }
    PosnicPro.pageHelp = { open: open, close: close, refresh: refresh, resolve: resolve };
    $(document).on('click.posnichelp', '#posnic_help_toggle', function () {
        if (node('posnic_help_menu').hidden) open(); else close(true);
    });
    $(document).on('click.posnichelp', '#posnic_help_feedback', function () {
        close(false);
        $('#posnic_feedback_dialog').modal('show');
    });
    $(document).on('click.posnichelp', '#posnic_help_about', function () {
        close(false);
        $('#posnic_about_dialog').modal('show');
    });
    document.addEventListener('click', function (event) {
        if (!event.target.closest('#posnic_help_menu,#posnic_help_toggle')) close(false);
    }, true);
    document.addEventListener('keydown', function (event) {
        if (event.key === 'F1' && !event.ctrlKey && !event.altKey && !event.metaKey) {
            event.preventDefault(); open();
        } else if (event.key === 'Escape' && node('posnic_help_menu') && !node('posnic_help_menu').hidden) {
            event.preventDefault(); event.stopPropagation(); close(true);
        }
    }, true);
    window.addEventListener('hashchange', function () { refresh(); close(false); });
    if (node('posnic_help_toggle') && node('posnic_help_menu')) document.body.classList.add('posnic-help-ready');
}());
