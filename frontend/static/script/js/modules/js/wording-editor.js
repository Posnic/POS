(function () {
    'use strict';
    var data, selected = '', draft, search = '', baseWords = {};
    function loadBaseWords() {
        var locale = draft.locale;
        baseWords = {};
        if (locale === 'en' || typeof fetch !== 'function') return;
        fetch('languages/' + encodeURIComponent(locale) + '.json').then(function (r) { if (!r.ok) throw new Error('Language unavailable'); return r.json(); }).then(function (words) {
            if (draft.locale !== locale) return;
            baseWords = words; rows();
        }).catch(function () { /* English remains the searchable fallback. */ });
    }
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    var host = function () { return document.getElementById('wording-editor'); };
    function tell(text) { var el = document.getElementById('wording-notice'); if (el) el.textContent = text; }
    function open() {
        if (!host()) return;
        host().textContent = PosnicPro.i18n.t('lang_wording_loading_wording_profiles', 'Loading wording profiles…');
        if (PosnicPro.local.get('usertype') !== 'super_admin') { host().textContent = PosnicPro.i18n.t('lang_wording_only_super_admins_can_manage_wording_profiles', 'Only super admins can manage wording profiles.'); return; }
        PosnicPro.get('settings/wording', function (r) {
            if (r.type !== 'success') { host().textContent = r.message; return; }
            data = r.data; choose(selected);
        }, function () { host().textContent = PosnicPro.i18n.t('lang_wording_could_not_load_wording_profiles_reopen_this_page_to_ret', 'Could not load wording profiles. Reopen this page to retry.'); });
    }
    function choose(id) {
        selected = id;
        var profile = data.state.profiles.find(function (p) { return p.id === id; });
        if (!profile) selected = '';
        draft = profile ? JSON.parse(JSON.stringify(profile.draft)) : { name: '', locale: 'en', overrides: {} };
        search = ''; baseWords = {}; render(); loadBaseWords();
    }
    function rows() {
        var all = data.labels.filter(function (l) { return [l.english, baseWords[l.id.replace(/^posnic\./, '')] || '', l.module, draft.overrides[l.id] || ''].join(' ').toLowerCase().includes(search.toLowerCase()); });
        document.getElementById('wording-results').textContent = all.length + ' ' + PosnicPro.i18n.t('lang_wording_matching_labels_showing_up_to_100', ' matching labels · showing up to 100');
        document.getElementById('wording-rows').innerHTML = all.slice(0, 100).map(function (l) {
            return '<tr><td>' + esc(baseWords[l.id.replace(/^posnic\./, '')] || l.english) + '<div class="text-muted small">' + esc(l.module) + '</div></td><td><input class="form-control" aria-label="Replacement for ' + esc(l.english) + '" data-word="' + esc(l.id) + '" maxlength="2000" placeholder="Use standard wording" data-t-placeholder="lang_use_standard_wording" value="' + esc(draft.overrides[l.id] || '') + '" ' + (!data.writable ? 'disabled' : '') + '></td><td><button type="button" class="btn btn-link" data-reset="' + esc(l.id) + '" ' + (!data.writable ? 'disabled' : '') + '><lang class="lang_wording_restore_default">Restore default</lang></button></td></tr>';
        }).join('');
    }
    function render() {
        var h = host(); if (!h) return;
        h.innerHTML = '<p class="text-muted"><lang class="lang_wording_custom_wording_is_saved_separately_from_software_update">Custom wording is saved separately from software updates. Unchanged labels use the standard language.</lang></p>' +
            (!data.writable ? '<div class="alert alert-info"><lang class="lang_manage_profiles_on_your_cloud_server_this">Manage profiles on your cloud server. This till uses synchronized wording.</lang></div>' : '') +
            '<label><lang class="lang_wording_profile">Profile</lang><select id="wording-profile" class="form-control"><option value="" data-t="lang_create_custom_profile">Create custom profile</option>' + data.state.profiles.map(function (p) { return '<option value="' + p.id + '" ' + (p.id === selected ? 'selected' : '') + '>' + esc(p.draft.name) + '</option>'; }).join('') + '</select></label>' +
            '<div class="row mt-3"><label class="col-md-7"><lang class="lang_wording_profile_name">Profile name</lang><input id="wording-name" class="form-control" maxlength="100" value="' + esc(draft.name) + '"></label><label class="col-md-5"><lang class="lang_wording_base_language">Base language</lang><select id="wording-locale" class="form-control">' + data.locales.map(function (l) { return '<option ' + (l === draft.locale ? 'selected' : '') + '>' + l + '</option>'; }).join('') + '</select></label></div>' +
            '<details class="my-3"><summary><lang class="lang_wording_change_related_wording_together">Change related wording together</lang></summary><div class="row mt-2"><label class="col-md-4"><lang class="lang_wording_takeaway">Takeaway</lang><input id="wording-takeaway" class="form-control" placeholder="Parcel" data-t-placeholder="lang_parcel"></label><label class="col-md-4"><lang class="lang_wording_product_singular">Product (singular)</lang><input id="wording-singular" class="form-control" placeholder="Item" data-t-placeholder="lang_newitem_title"></label><label class="col-md-4"><lang class="lang_wording_products_plural">Products (plural)</lang><input id="wording-plural" class="form-control" placeholder="Items" data-t-placeholder="lang_itemdetail_title"></label></div><button class="btn btn-outline-primary" id="wording-group"><lang class="lang_apply_linked_english_labels">Apply linked English labels</lang></button><p class="text-muted small"><lang class="lang_wording_updates_matching_labels_and_supported_add_search_sales_">Updates matching labels and supported Add / Search / Sales by phrases. Product names, notes and other languages are unchanged.</lang></p></details>' +
            '<label class="d-block mt-3"><lang class="lang_wording_search_existing_wording_or_extension">Search existing wording or extension</lang><input id="wording-search" class="form-control" placeholder="Search e.g. takeaway or product" data-t-placeholder="lang_search_e_g_takeaway_or_product"></label><p id="wording-results" class="small text-muted"></p><div class="table-responsive"><table class="table"><thead><tr><th><lang class="lang_existing_wording">Existing wording</lang></th><th><lang class="lang_your_wording">Your wording</lang></th><th></th></tr></thead><tbody id="wording-rows"></tbody></table></div>' +
            '<h5><lang class="lang_assign_to_branches">Assign to branches</lang></h5>' + data.branches.map(function (b) { var a = data.state.assignments[b.id]; return '<label class="d-block"><input type="checkbox" data-branch="' + b.id + '" ' + (a && a[draft.locale]?.profileId === selected ? 'checked' : '') + '> ' + esc(b.name) + '</label>'; }).join('') +
            '<p id="wording-notice" role="status"></p><button class="btn btn-outline-primary mr-2" id="wording-save" ' + (!data.writable ? 'disabled' : '') + '><lang class="lang_wording_save_draft">Save draft</lang></button><button class="btn btn-primary" id="wording-publish" ' + (!data.writable ? 'disabled' : '') + '><lang class="lang_wording_save_publish">Save & publish</lang></button><p class="text-muted small mt-3"><lang class="lang_wording_offline_tills_apply_changes_after_synchronization_publi">Offline tills apply changes after synchronization. Publishing does not confirm every device has applied them.</lang></p>';
        rows();
        h.oninput = function (e) { if (e.target.id === 'wording-search') { search = e.target.value; rows(); } else if (e.target.dataset.word) { if (e.target.value.trim()) draft.overrides[e.target.dataset.word] = e.target.value; else delete draft.overrides[e.target.dataset.word]; } else if (e.target.id === 'wording-name') draft.name = e.target.value; };
        h.onchange = function (e) { if (e.target.id === 'wording-profile') choose(e.target.value); if (e.target.id === 'wording-locale') { if (Object.keys(draft.overrides).length) { e.target.value = draft.locale; tell(PosnicPro.i18n.t('lang_wording_create_a_separate_profile_for_a_different_language_to_k', 'Create a separate profile for a different language to keep its wording separate.')); } else { draft.locale = e.target.value; loadBaseWords(); } } };
        h.onclick = function (e) { var b = e.target.closest('button'); if (!b || !data.writable) return; if (b.dataset.reset) { delete draft.overrides[b.dataset.reset]; rows(); } else if (b.id === 'wording-group') {
            if (draft.locale !== 'en') return tell(PosnicPro.i18n.t('lang_wording_edit_phrases_individually_for_this_language_english_phr', 'Edit phrases individually for this language. English phrase grouping is only available for English profiles.'));
            var take = document.getElementById('wording-takeaway').value.trim(), one = document.getElementById('wording-singular').value.trim(), many = document.getElementById('wording-plural').value.trim();
            var changes = {};
            if (take) Object.assign(changes, { takeaway: take, 'take away': take });
            if (one) Object.assign(changes, { product: one, 'add product': 'Add ' + one.toLowerCase(), 'sales by product': 'Sales by ' + one.toLowerCase() });
            if (many) Object.assign(changes, { products: many, 'search products': 'Search ' + many.toLowerCase() });
            var count = 0;
            data.labels.forEach(function (l) { var value = changes[l.english.toLowerCase()]; if (value) { draft.overrides[l.id] = value; count++; } });
            rows(); tell(count + ' ' + PosnicPro.i18n.t('lang_wording_linked_labels_updated_in_this_draft', ' linked labels updated in this draft.'));
        } else if (b.id === 'wording-save' || b.id === 'wording-publish') save(b.id === 'wording-publish'); };
    }
    function save(publish) {
        var targets = Array.from(host().querySelectorAll('[data-branch]:checked')).map(function (e) { return e.dataset.branch; });
        if (!draft.name.trim()) return tell(PosnicPro.i18n.t('lang_wording_enter_a_profile_name', 'Enter a profile name.'));
        var before = data.state.profiles.map(function (p) { return p.id; });
        host().querySelectorAll('button').forEach(function (b) { b.disabled = true; });
        tell(PosnicPro.i18n.t('lang_wording_saving', 'Saving…'));
        function failed(r) { host().querySelectorAll('button').forEach(function (b) { b.disabled = false; }); tell(r?.message || PosnicPro.i18n.t('lang_wording_save_failed_your_edits_are_still_here', 'Save failed. Your edits are still here.')); }
        PosnicPro.put({ url: 'settings/wording/draft', data: JSON.stringify(Object.assign({}, draft, { id: selected || undefined, expectedRevision: data.state.revision })) }, function (r) {
            if (r.type !== 'success') return failed(r);
            data.state = r.data;
            if (!selected) selected = r.data.profiles.find(function (p) { return !before.includes(p.id); }).id;
            if (!publish) { render(); tell(PosnicPro.i18n.t('lang_wording_draft_saved_active_wording_has_not_changed', 'Draft saved. Active wording has not changed.')); return; }
            PosnicPro.post({ url: 'settings/wording/publish', data: JSON.stringify({ id: selected, expectedRevision: data.state.revision, branches: targets }) }, function (out) {
                if (out.type !== 'success') return failed(out);
                data.state = out.data; render(); tell(PosnicPro.i18n.t('lang_wording_published_tills_apply_this_revision_after_synchronizati', 'Published. Tills apply this revision after synchronization.'));
                if (PosnicPro.wording) PosnicPro.wording.refresh();
            }, failed);
        }, failed);
    }
    PosnicPro.wordingEditor = { open: open };
})();
