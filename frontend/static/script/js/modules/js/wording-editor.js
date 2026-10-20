(function () {
    'use strict';
    var data, selected = '', draft, search = '', baseWords = {}, page = 0, pageSize = 25, changedOnly = false;
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
            data = r.data; choose(selected || data.state.profiles[0]?.id || "");
        }, function () { host().textContent = PosnicPro.i18n.t('lang_wording_could_not_load_wording_profiles_reopen_this_page_to_ret', 'Could not load wording profiles. Reopen this page to retry.'); });
    }
    function choose(id) {
        selected = id;
        var profile = data.state.profiles.find(function (p) { return p.id === id; });
        if (!profile) selected = '';
        draft = profile ? JSON.parse(JSON.stringify(profile.draft)) : { name: '', locale: 'en', overrides: {} };
        draft.rules = draft.rules || []; if (!draft.rules.length) draft.rules.push({from:'',to:''});
        search = ''; baseWords = {}; page = 0; changedOnly = false; render(); loadBaseWords();
    }
    function rows() {
        var all = data.labels.filter(function (l) { return (!changedOnly || Object.prototype.hasOwnProperty.call(draft.overrides, l.id)) && [l.english, l.id, baseWords[l.id.replace(/^posnic\./, '')] || '', l.module, draft.overrides[l.id] || ''].join(' ').toLowerCase().includes(search.toLowerCase()); });
        page = Math.max(0, Math.min(page, Math.ceil(all.length / pageSize) - 1));
        var start = page * pageSize;
        document.getElementById('wording-results').textContent = (all.length ? start + 1 : 0) + '–' + Math.min(start + pageSize, all.length) + ' / ' + all.length;
        document.getElementById('wording-prev').disabled = page === 0;
        document.getElementById('wording-next').disabled = start + pageSize >= all.length;
        document.getElementById('wording-rows').innerHTML = all.slice(start, start + pageSize).map(function (l) {
            return '<tr><td>' + esc(baseWords[l.id.replace(/^posnic\./, '')] || l.english) + '<div class="text-muted small">' + esc(l.module) + '</div></td><td><input class="form-control" aria-label="Replacement for ' + esc(l.english) + '" data-word="' + esc(l.id) + '" maxlength="2000" placeholder="Use standard wording" data-t-placeholder="lang_use_standard_wording" value="' + esc(draft.overrides[l.id] || '') + '" ' + (!data.writable ? 'disabled' : '') + '></td><td><button type="button" class="btn btn-link" data-reset="' + esc(l.id) + '" ' + (!data.writable ? 'disabled' : '') + '><lang class="lang_wording_restore_default">Restore default</lang></button></td></tr>';
        }).join('');
    }
    function ruleRows() {
        document.getElementById('wording-rule-list').innerHTML = draft.rules.map(function(r,i){return '<div class="row align-items-end mb-3"><label class="col-md-5">Existing word<input class="form-control" aria-label="Existing word '+(i+1)+'" data-rule="'+i+'" data-field="from" maxlength="100" value="'+esc(r.from)+'" '+(!data.writable?'disabled':'')+'></label><label class="col-md-5">Use instead<input class="form-control" aria-label="Use instead '+(i+1)+'" data-rule="'+i+'" data-field="to" maxlength="100" value="'+esc(r.to)+'" '+(!data.writable?'disabled':'')+'></label><div class="col-md-2 mb-2"><button type="button" class="btn btn-link" data-remove-rule="'+i+'" aria-label="Remove word rule '+(i+1)+'">Remove</button></div></div>';}).join('');
    }
    function render() {
        var h = host(); if (!h) return;
        h.innerHTML = '<p class="text-muted"><lang class="lang_wording_custom_wording_is_saved_separately_from_software_update">Custom wording is saved separately from software updates. Unchanged labels use the standard language.</lang></p>' +
            (!data.writable ? '<div class="alert alert-info"><lang class="lang_manage_profiles_on_your_cloud_server_this">Manage profiles on your cloud server. This till uses synchronized wording.</lang></div>' : '') +
            '<label class="d-block">Language<select id="wording-locale" class="form-control" style="max-width:300px">' + data.locales.map(function(l){ var name=l; try { name=new Intl.DisplayNames(['en'],{type:'language'}).of(l); } catch(e) {} return '<option value="'+esc(l)+'" '+(l===draft.locale?'selected':'')+'>'+esc(name)+'</option>'; }).join('') + '</select></label>' +
            '<h5 class="mt-4">Change a word everywhere</h5><p class="text-muted">Choose the words your business uses. Related screen labels and new document headings update together. Enter singular and plural words as separate rows.</p><div id="wording-rule-list"></div><button type="button" class="btn btn-outline-primary mb-3" id="wording-add-rule">+ Add another word</button>' +
            '<details id="wording-advanced" class="my-3"><summary>Advanced: edit a specific phrase or manage profiles</summary><p class="text-muted mt-3">Specific phrase replacements take priority over word rules.</p><label>Profile<select id="wording-profile" class="form-control"><option value="">Create custom profile</option>' + data.state.profiles.map(function(p){return '<option value="'+esc(p.id)+'" '+(p.id===selected?'selected':'')+'>'+esc(p.draft.name)+'</option>';}).join('') + '</select></label><label class="d-block">Profile name (optional)<input id="wording-name" class="form-control" maxlength="100" value="'+esc(draft.name)+'"></label>' +
            '<label class="d-block mt-3"><lang class="lang_wording_search_existing_wording_or_extension">Search existing wording or extension</lang><input id="wording-search" class="form-control" placeholder="Search e.g. takeaway or product" data-t-placeholder="lang_search_e_g_takeaway_or_product"></label><p id="wording-results" class="small text-muted"></p><div class="table-responsive"><table class="table"><thead><tr><th><lang class="lang_existing_wording">Existing wording</lang></th><th><lang class="lang_your_wording">Your wording</lang></th><th></th></tr></thead><tbody id="wording-rows"></tbody></table></div>' +
            '<div class="d-flex flex-wrap align-items-center mb-3" style="gap:12px"><label><input id="wording-changed" type="checkbox" ' + (changedOnly ? 'checked' : '') + '> <lang class="lang_wording_changed_only">Changed only</lang></label><label><lang class="lang_wording_labels_per_page">Labels per page</lang> <select id="wording-page-size">' + [25,50,100].map(function(n){return '<option ' + (n === pageSize ? 'selected' : '') + '>' + n + '</option>';}).join('') + '</select></label><button type="button" class="btn btn-outline-primary" id="wording-prev" aria-label="Previous page" data-t-aria-label="lang_previous_page">←</button><button type="button" class="btn btn-outline-primary" id="wording-next" aria-label="Next page" data-t-aria-label="lang_next_page">→</button></div>' +
            '</details><h5><lang class="lang_assign_to_branches">Assign to branches</lang></h5>' + data.branches.map(function (b) { var a = data.state.assignments[b.id]; return '<label class="d-block"><input type="checkbox" data-branch="' + b.id + '" ' + (!selected || a && a[draft.locale]?.profileId === selected ? 'checked' : '') + '> ' + esc(b.name) + '</label>'; }).join('') +
            '<p id="wording-notice" role="status"></p><button class="btn btn-primary" id="wording-publish" ' + (!data.writable ? 'disabled' : '') + '>Save changes</button><p class="text-muted small mt-3"><lang class="lang_wording_offline_tills_apply_changes_after_synchronization_publi">Offline tills apply changes after synchronization. Publishing does not confirm every device has applied them.</lang></p>';
        ruleRows(); rows();
        document.getElementById('wording-search').value = search;
        h.oninput = function (e) { if (e.target.dataset.rule != null) { draft.rules[Number(e.target.dataset.rule)][e.target.dataset.field] = e.target.value; return; } if (e.target.id === 'wording-search') { search = e.target.value; page = 0; rows(); } else if (e.target.dataset.word) { if (e.target.value.trim()) draft.overrides[e.target.dataset.word] = e.target.value; else delete draft.overrides[e.target.dataset.word]; } else if (e.target.id === 'wording-name') draft.name = e.target.value; };
        h.onchange = function (e) { if (e.target.id === 'wording-profile') choose(e.target.value); if (e.target.id === 'wording-locale') { if (Object.keys(draft.overrides).length) { e.target.value = draft.locale; tell(PosnicPro.i18n.t('lang_wording_create_a_separate_profile_for_a_different_language_to_k', 'Create a separate profile for a different language to keep its wording separate.')); } else { draft.locale = e.target.value; loadBaseWords(); } } };
        var changeProfile = h.onchange;
        h.onchange = function(e) {
            if (e.target.id === 'wording-page-size') { pageSize = [25,50,100].includes(Number(e.target.value)) ? Number(e.target.value) : 25; page = 0; rows(); }
            else if (e.target.id === 'wording-changed') { changedOnly = e.target.checked; page = 0; rows(); }
            else changeProfile(e);
        };
        h.onclick = function (e) { var b = e.target.closest('button'); if (!b) return;
            if (b.id === 'wording-prev' || b.id === 'wording-next') { page += b.id === 'wording-next' ? 1 : -1; rows(); return; }
            if (!data.writable) return; if(b.id==='wording-add-rule'){draft.rules.push({from:'',to:''});ruleRows();return;} if(b.dataset.removeRule != null){draft.rules.splice(Number(b.dataset.removeRule),1);ruleRows();return;} if (b.dataset.reset) { delete draft.overrides[b.dataset.reset]; rows(); } else if (b.id === 'wording-save' || b.id === 'wording-publish') save(b.id === 'wording-publish'); };
    }
    function save(publish) {
        var targets = Array.from(host().querySelectorAll('[data-branch]:checked')).map(function (e) { return e.dataset.branch; });
        if (!targets.length && publish) return tell('Choose at least one branch.');
        var rules = draft.rules.filter(function(r){return r.from.trim() || r.to.trim();});
        if(rules.some(function(r){return !r.from.trim() || !r.to.trim();})) return tell('Enter both the existing word and its replacement.');
        if (!draft.name.trim()) draft.name = 'Shop wording — ' + draft.locale;

        var before = data.state.profiles.map(function (p) { return p.id; });
        host().querySelectorAll('button').forEach(function (b) { b.disabled = true; });
        tell(PosnicPro.i18n.t('lang_wording_saving', 'Saving…'));
        function failed(r) { host().querySelectorAll('button').forEach(function (b) { b.disabled = false; }); tell(r?.message || PosnicPro.i18n.t('lang_wording_save_failed_your_edits_are_still_here', 'Save failed. Your edits are still here.')); }
        PosnicPro.put({ url: 'settings/wording/draft', data: JSON.stringify(Object.assign({}, draft, { rules: rules, id: selected || undefined, expectedRevision: data.state.revision })) }, function (r) {
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
