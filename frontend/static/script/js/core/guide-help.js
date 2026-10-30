/* Contextual guide link. The shipped manifest contains only reviewed releases. */
(function (root) {
    'use strict';
    var GUIDE_ORIGIN = 'https://www.posnic.com';

    function routePath(hash) {
        if (typeof hash !== 'string' || hash.length > 2048 || !/^#?\//.test(hash)) return null;
        var raw = hash.replace(/^#/, '').split(/[?#]/, 1)[0].replace(/\/$/, '');
        if (!raw) return null;
        try {
            var parts = raw.split('/').slice(1).map(function (part) { return decodeURIComponent(part); });
            if (parts.some(function (part) {
                return !part || part === '.' || part === '..' || /[\/\\?#\u0000-\u001f\u007f]/.test(part);
            })) return null;
            return '/' + parts.join('/').toLowerCase();
        } catch (_) { return null; }
    }
    function matches(pattern, route) {
        if (typeof pattern !== 'string' || !/^\/(?:[a-z0-9_-]+|:[a-z][a-z0-9_]*)(?:\/(?:[a-z0-9_-]+|:[a-z][a-z0-9_]*))*$/i.test(pattern)) return false;
        var a = pattern.toLowerCase().split('/'), b = route.split('/');
        return a.length === b.length && a.every(function (part, i) {
            return part.charAt(0) === ':' ? Boolean(b[i]) : part === b[i];
        });
    }
    function specificity(pattern) {
        return pattern.split('/').filter(function (part) { return part && part.charAt(0) !== ':'; }).length;
    }
    function safePath(version, topic) {
        if (!/^\d+\.\d+\.\d+(?:-[a-z0-9]+(?:[.-][a-z0-9]+)*)?$/.test(version)) return null;
        if (topic && !/^[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*)*$/.test(topic)) return null;
        return '/guide/' + version + '/' + (topic ? topic + '/' : '');
    }
    function messagePlacement(rect, viewportWidth, viewportHeight, messageHeight) {
        var width = Math.max(0, Math.min(320, viewportWidth - 16));
        var left = Math.max(8, Math.min(rect.right - width, viewportWidth - width - 8));
        var top = rect.bottom + 7;
        if (top + messageHeight > viewportHeight - 8) top = Math.max(8, rect.top - messageHeight - 7);
        return { left: left, top: top, width: width };
    }
    function resolveGuide(brand, identity, route, context, manifest) {
        if (!brand || brand.resolved !== true || brand.enabled !== false || brand.buildEnabled !== false) return { visible: false };
        var unavailable = function (reason) { return { visible: true, kind: 'unavailable', reason: reason }; };
        if (!identity || !/^(web|desktop)$/.test(identity.platform)) return unavailable('build-unknown');
        var mappings = Array.isArray(manifest && manifest.buildMappings) ? manifest.buildMappings : [];
        var matchesForBuild = mappings.filter(function (item) {
            return item && item.platform === identity.platform && /^[a-f0-9]{6,64}$/.test(item.page || '') &&
                item.page === identity.page && item.app === (identity.app || '') && item.server === (identity.server || '');
        });
        if (matchesForBuild.length !== 1) return unavailable(matchesForBuild.length ? 'build-ambiguous' : 'build-unmapped');
        var mapping = matchesForBuild[0];
        var versions = Array.isArray(manifest.versions) ? manifest.versions.filter(function (v) { return v && v.id === mapping.version; }) : [];
        var version = versions.length === 1 && versions[0];
        if (!version || version.status !== 'released' || version.publicationApproved !== true || !version.releaseTag ||
            !/^[a-f0-9]{40}$/.test(mapping.sourceCommit || '') || mapping.sourceCommit !== version.sourceCommit) return unavailable('version-not-published');
        var library = safePath(version.id);
        if (!library) return unavailable('version-invalid');
        var normalized = routePath(route);
        var eligible = normalized === null ? [] : (Array.isArray(mapping.routes) ? mapping.routes : []).filter(function (rule) {
            return rule && matches(rule.pattern, normalized);
        });
        var chosen = typeof context === 'string' ? eligible.filter(function (rule) { return rule.context === context; }) : [];
        if (!chosen.length) chosen = eligible.filter(function (rule) { return !rule.context; });
        chosen.sort(function (a, b) { return specificity(b.pattern) - specificity(a.pattern); });
        if (chosen[0] && chosen[1] && specificity(chosen[0].pattern) === specificity(chosen[1].pattern)) return unavailable('route-ambiguous');
        var rule = chosen[0];
        var topics = Array.isArray(version.topics) ? version.topics : [];
        var article = rule && topics.find(function (topic) { return topic && topic.id === rule.topic && topic.status === 'verified'; });
        if (!article) return { visible: true, kind: 'library', version: version.id, href: library };
        var href = safePath(version.id, article.id);
        if (!href) return unavailable('topic-invalid');
        if (rule.anchor) {
            if (!/^[a-z][a-z0-9_-]*$/.test(rule.anchor) || !Array.isArray(article.anchors) || article.anchors.indexOf(rule.anchor) === -1) return unavailable('anchor-unavailable');
            href += '#' + rule.anchor;
        }
        return { visible: true, kind: 'article', version: version.id, topic: article.id, href: href };
    }

    if (typeof module !== 'undefined' && module.exports) module.exports = { resolveGuide: resolveGuide, routePath: routePath, pageContext: pageContext, messagePlacement: messagePlacement };
    if (!root || !root.document || !root.PosnicPro) return;

    var host = root.document.getElementById('posnic_guide_help_li');
    var button = root.document.getElementById('posnic_guide_help_button');
    var message = root.document.getElementById('posnic_guide_help_message');
    if (!host || !button || !message) return;
    // Keep the explanation outside the header/sidebar stacking contexts.
    // Its hidden state still follows the same branding policy as the control.
    if (root.document.body && root.document.body.appendChild) root.document.body.appendChild(message);
    function positionMessage() {
        if (message.hidden || !button.getBoundingClientRect || !message.getBoundingClientRect) return;
        var pos = messagePlacement(button.getBoundingClientRect(), root.innerWidth,
            root.innerHeight, message.getBoundingClientRect().height);
        message.style.left = pos.left + 'px';
        message.style.top = pos.top + 'px';
        message.style.width = pos.width + 'px';
    }
    root.addEventListener('resize', positionMessage);
    root.addEventListener('scroll', positionMessage, true);
    var brand = null, manifest = null, identity = null, current = null;
    var brandRequest = 0;

    function pageContext(doc, route) {
        if (!doc || !route) return null;
        if (route === '/sales/new') {
            var tender = doc.getElementById('infobar-settings-sidebar-tender-details');
            if (tender && tender.classList.contains('sidebarview') && tender.querySelector('.payment-amount-input'))
                return 'sales:split-payment';
        }
        if (route !== '/sales/new' && /^\/sales\/[^/]+$/.test(route)) {
            var correction = doc.getElementById('payment-correction');
            if (correction && correction.classList.contains('show')) return 'sales:payment-correction';
        }
        if (route === '/inventorycounts' || route === '/items' || route === '/lowstockitems') {
            var adjustment = doc.getElementById('stock_adjust_modal');
            if (adjustment && adjustment.classList.contains('show')) return 'modal:stock-adjustment';
        }
        if (route === '/items/new') {
            var variants = doc.getElementById('iv2-has-variants');
            var more = doc.getElementById('iv2-panel-more');
            if (variants && variants.checked && more && !more.hidden) return 'item:variants';
        }
        if (route === '/items') {
            var labels = doc.getElementById('view_print_lable');
            if (labels && labels.classList.contains('show')) return 'modal:labels';
            var imports = doc.getElementById('import_modal');
            if (imports && imports.classList.contains('show')) return 'modal:items-import';
        }
        if (/^\/invoices\/[^/]+$/.test(route)) {
            var payment = doc.getElementById('invoices_pay_strip');
            if (payment && payment.style.display !== 'none') return 'invoices:payment';
        }
        if (route === '/pricesettings') {
            var editor = doc.getElementById('ps-grid');
            if (editor && editor.classList.contains('active')) {
                var schedule = doc.getElementById('ps-schedules-tab');
                if (schedule && schedule.getAttribute('aria-selected') === 'true') return 'prices:schedules';
                var file = doc.getElementById('ps-file-tab');
                if (file && file.getAttribute('aria-selected') === 'true') return 'prices:file';
            }
        }
        if (route === '/settings/modules') {
            var detail = doc.getElementById('v-pills-featureconf');
            if (detail && detail.classList.contains('active')) {
                var feature = detail.getAttribute('data-guide-feature');
                return /^[a-z][a-z0-9_]*$/.test(feature || '') ? 'feature:' + feature : null;
            }
        }
        var owners = doc.querySelectorAll('[data-guide-route]');
        var owner = null;
        for (var i = 0; i < owners.length; i++) {
            if (owners[i].getAttribute('data-guide-route') === route) { owner = owners[i]; break; }
        }
        if (owner && route === '/settings/general') {
            // Select the outer Core tab first: inactive payment/print panels
            // retain their own active child and must not override Sale help.
            var coreTab = owner.querySelector('#core_settings_tabs .nav-link.active[data-guide-context]');
            if (!coreTab) return null;
            var coreContext = coreTab.getAttribute('data-guide-context');
            var childSelector = coreContext === 'core:payments' ? '#payments_subnav .nav-link.active[data-guide-context]' :
                coreContext === 'core:print' ? '.print-settings-tabs .nav-link.active[data-guide-context]' : null;
            var child = childSelector && owner.querySelector(childSelector);
            return child ? child.getAttribute('data-guide-context') : coreContext;
        }
        if (owner && route === '/settings/messagingmodule') {
            var centre = owner.querySelector('#message_centre');
            if (centre) {
                var section = centre.querySelector('[data-message-tab][aria-selected="true"]');
                if (!section) return null;
                var sectionName = section.getAttribute('data-message-tab');
                if (sectionName === 'connection') {
                    var channel = centre.querySelector('[data-message-channel][aria-pressed="true"]');
                    var channelName = channel && channel.getAttribute('data-message-channel');
                    return /^(whatsapp|sms|email)$/.test(channelName || '') ? 'messaging:connection:' + channelName : null;
                }
                return /^(automatic|campaigns|reports|history)$/.test(sectionName || '') ? 'messaging:' + sectionName : null;
            }
            var messagingTab = owner.querySelector('#messagingmodule_subnav > .nav-link.active[data-guide-context]');
            if (!messagingTab) return null;
            var messagingContext = messagingTab.getAttribute('data-guide-context');
            if (messagingContext === 'messaging:whatsapp') {
                var whatsappTab = owner.querySelector('#whatsappSubTabs .nav-link.active[data-guide-context]');
                if (whatsappTab) return whatsappTab.getAttribute('data-guide-context');
            }
            return messagingContext;
        }
        var active = owner && owner.querySelector('.nav-link.active[data-guide-context]');
        return active ? active.getAttribute('data-guide-context') : null;
    }
    function paint() {
        var context = pageContext(root.document, routePath(root.location.hash));
        current = resolveGuide(brand, identity, root.location.hash, context, manifest);
        host.hidden = !current.visible;
        message.hidden = true;
        button.setAttribute('aria-expanded', 'false');
        [['posnic_labels_guide_help', 'modal:labels'], ['posnic_items_import_guide_help', 'modal:items-import'],
            ['posnic_stock_adjust_guide_help', 'modal:stock-adjustment']].forEach(function (entry) {
            var modalButton = root.document.getElementById(entry[0] + '_button');
            var modalMessage = root.document.getElementById(entry[0] + '_message');
            if (modalButton) {
                modalButton.hidden = !current.visible || context !== entry[1];
                modalButton.setAttribute('aria-expanded', 'false');
            }
            if (modalMessage) modalMessage.hidden = true;
        });
        if (!current.visible) return;
        var label = current.kind === 'article' ? 'Help for this page, version ' + current.version :
            current.kind === 'library' ? 'Guide library, version ' + current.version : 'Help for this page; exact guide unavailable';
        button.setAttribute('aria-label', label);
        button.setAttribute('title', label);
    }
    function brandIsUnbranded(value) {
        return value && value.resolved === true && value.enabled === false && value.buildEnabled === false;
    }
    function updateBrand() {
        var request = ++brandRequest;
        root.fetch('brand.json', { cache: 'no-store' }).then(function (response) {
            if (!response.ok) throw new Error('Brand unavailable');
            return response.json();
        }).then(function (value) {
            if (request !== brandRequest) return;
            var wasUnbranded = brandIsUnbranded(brand);
            brand = value;
            if (!brandIsUnbranded(value)) { manifest = null; paint(); return; }
            if (manifest) { if (!wasUnbranded) paint(); return; }
            return root.fetch('static/json/guide-manifest.json', { cache: 'no-store' }).then(function (response) {
                if (!response.ok) throw new Error('Guide manifest unavailable');
                return response.json();
            }).then(function (value) {
                if (request !== brandRequest) return;
                manifest = value; paint();
            }).catch(function () {
                if (request !== brandRequest) return;
                manifest = null; paint();
            });
        }).catch(function () {
            if (request !== brandRequest) return;
            brand = null; manifest = null; paint();
        });
    }
    function openCurrent(trigger, status) {
        if (!current || !current.visible) return;
        if (current.href) {
            // resolveGuide emits only a relative, validated guide path. Never
            // append any shop, record, route or customer data to this URL.
            root.open(GUIDE_ORIGIN + current.href, '_blank', 'noopener,noreferrer');
            return;
        }
        status.textContent = 'A guide for this exact build is not available yet. Use About Posnic to copy the app, page and server versions for support.';
        status.hidden = !status.hidden;
        trigger.setAttribute('aria-expanded', String(!status.hidden));
        if (status === message) positionMessage();
    }
    button.addEventListener('click', function () { openCurrent(button, message); });
    root.document.addEventListener('click', function (event) {
        var target = event.target;
        if (target && target.closest && target.closest('#ps-grid .ps-mode-tab')) { paint(); return; }
        if (target && target.closest && target.closest('.infobar-tender-close')) { paint(); return; }
        if (!target || ['posnic_labels_guide_help_button', 'posnic_items_import_guide_help_button',
            'posnic_stock_adjust_guide_help_button'].indexOf(target.id) === -1) return;
        var status = root.document.getElementById(target.id.replace(/_button$/, '_message'));
        if (status && !target.hidden) openCurrent(target, status);
    });
    root.document.addEventListener('change', function (event) {
        if (event.target && event.target.id === 'iv2-has-variants') paint();
    });
    root.addEventListener('hashchange', paint);
    root.addEventListener('posnic:guide-context', paint);
    if (root.jQuery) {
        root.jQuery(root.document).on('shown.bs.tab.posnicGuide', paint);
        root.jQuery(root.document).on('shown.bs.modal.posnicGuide hidden.bs.modal.posnicGuide',
            '#view_print_lable, #import_modal, #stock_adjust_modal, #payment-correction', paint);
    }
    root.PosnicPro.versionBadge.read(true).then(function (parts) {
        identity = { platform: root.navigator.userAgent.indexOf('Electron') !== -1 ? 'desktop' : 'web',
            app: parts.app || '', page: parts.page || '', server: parts.server || '' };
        paint();
    }).catch(function () { paint(); });
    updateBrand();
    root.setInterval(updateBrand, 30_000);
})(typeof window !== 'undefined' ? window : null);
