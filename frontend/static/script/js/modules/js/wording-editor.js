(function () {
    'use strict';
    var data, selected = '', draft, targets = [], tab = 'words', search = '', baseWords = {}, page = 0, pageSize = 25, changedOnly = false, busy = false, dirty = false, catalogLoading = false;
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    var host = function () { return document.getElementById('wording-editor'); };
    var el = function (id) { return document.getElementById(id); };
    var profiles = function () { return data.state.profiles.filter(function (p) { return !p.deletedAt; }); };
    function tell(text) { if (el('wording-notice')) el('wording-notice').textContent = text; }
    function changed() { dirty = true; tell(PosnicPro.i18n.t("lang_rd_unsaved_changes","Unsaved changes")); }
    function open() {
        if (!host()) return;
        if (PosnicPro.local.get('usertype') !== 'super_admin') { host().textContent = 'Only super admins can manage wording profiles.'; return; }
        host().textContent = 'Loading wording profiles…';
        PosnicPro.get('settings/wording?catalog=0', function (r) {
            if (!host()) return;
            if (r.type !== 'success') { host().textContent = r.message; return; }
            data = r.data; choose(selected || profiles()[0]?.id || '');
        }, function () { if (host()) host().textContent = 'Could not load wording profiles. Reopen this page to retry.'; });
    }
    function choose(id) {
        var p = profiles().find(function (p) { return p.id === id; });
        selected = p ? id : '';
        draft = p ? JSON.parse(JSON.stringify(p.draft)) : { name: '', locale: 'en', overrides: {}, rules: [] };
        draft.rules = draft.rules || [];
        if (!draft.rules.length) draft.rules.push({ from: '', to: '' });
        targets = data.branches.filter(function (b) { return !p || data.state.assignments[b.id]?.[draft.locale]?.profileId === selected; }).map(function (b) { return b.id; });
        dirty = false; search = ''; page = 0; changedOnly = false; tab = 'words'; baseWords = {}; render();
    }
    function loadBaseWords() {
        var locale = draft.locale;
        if (locale === 'en' || typeof fetch !== 'function') return;
        fetch('languages/' + encodeURIComponent(locale) + '.json').then(function (r) { if (!r.ok) throw Error('Language unavailable'); return r.json(); }).then(function (words) {
            if (draft.locale !== locale || !host()) return;
            baseWords = words; rows(); addedRows();
        }).catch(function () { tell(PosnicPro.i18n.t("lang_wording_ui_base_language_could_not_load_english_labels_are_shown","Base language could not load. English labels are shown.")); });
    }
    function branchSummary() {
        el('wording-branch-summary').textContent = targets.length === data.branches.length && targets.length ? 'All ' + targets.length + ' branches' : targets.length + ' branches selected';
        el('wording-all-branches').checked = targets.length > 0 && targets.length === data.branches.length;
        el('wording-all-branches').indeterminate = targets.length > 0 && targets.length < data.branches.length;
    }
    function profileForm(mode) {
        var previousTargets = targets.slice(), previousDirty = dirty;
        var previous = selected, copy = mode === 'duplicate', rename = mode === 'rename';
        var pending = rename || copy ? JSON.parse(JSON.stringify(draft)) : {name:'',locale:draft.locale || 'en',overrides:{},rules:[]};
        pending.rules = (pending.rules || []).filter(function(r){return r.from.trim() || r.to.trim();});
        if (copy) pending.name += ' copy';
        host().innerHTML = '<div class="border rounded p-4 mx-auto my-4" style="max-width:540px"><h5>' + esc(rename ? PosnicPro.i18n.t('lang_wording_rename_profile', 'Rename profile') : copy ? PosnicPro.i18n.t('lang_duplicate_profile', 'Duplicate profile') : PosnicPro.i18n.t('lang_create_profile', 'Create profile')) + '</h5><label class="d-block mt-3"><lang class="lang_wording_profile_name">Profile name</lang><input class="form-control mt-2" id="wording-name" maxlength="100" value="' + esc(pending.name) + '"></label>' +
            '<label class="d-block mt-3"><lang class="lang_int_voice_language">Language</lang><select class="form-control mt-2" id="wording-create-locale"' + (rename || copy ? ' disabled' : '') + '>' + data.locales.map(function (l) { var name=l; try {name=new Intl.DisplayNames(['en'],{type:'language'}).of(l);}catch(e){} return '<option value="' + esc(l) + '" ' + (l===pending.locale?'selected':'') + '>' + esc(name) + '</option>'; }).join('') + '</select></label><p class="small text-muted">' + esc(copy ? PosnicPro.i18n.t('lang_the_copy_starts_without_branch_assignments', 'The copy starts without branch assignments.') : PosnicPro.i18n.t('lang_your_standard_language_stays_unchanged_unt', 'Your standard language stays unchanged until you save wording changes.')) + '</p><p id="wording-notice" role="status"></p><div class="d-flex justify-content-end" style="gap:8px"><button type="button" class="btn btn-outline-secondary" id="wording-profile-cancel"><lang class="lang_cancel_title">Cancel</lang></button><button type="button" class="btn btn-primary" id="wording-profile-save">' + esc(rename ? PosnicPro.i18n.t('lang_save_name', 'Save name') : PosnicPro.i18n.t('lang_create_profile', 'Create profile')) + '</button></div></div>';
        host().oninput = null; host().onchange = null;
        host().onclick = function(e) {
            var b=e.target.closest('button'); if(!b || busy || !data.writable)return;
            if(b.id==='wording-profile-cancel'){render();return;}
            if(b.id!=='wording-profile-save')return;
            pending.name=el('wording-name').value.trim();pending.locale=el('wording-create-locale').value;
            if(!pending.name){tell(PosnicPro.i18n.t('lang_wording_enter_profile_name', 'Enter a profile name.'));el('wording-name').focus();return;}
            var before=profiles().map(function(p){return p.id;});setBusy(true);
            PosnicPro.put({url:'settings/wording/draft',data:JSON.stringify(Object.assign({},pending,{id:rename?previous:undefined,expectedRevision:data.state.revision}))},function(r){
                if(r.type!=='success')return failed(r);
                busy=false;data.state=r.data;
                choose(rename?previous:profiles().find(function(p){return !before.includes(p.id);}).id);
                if(rename){targets=previousTargets;dirty=previousDirty;render();}
            },failed);
        };
        el('wording-name').focus();
    }
    function emptyState() {
        host().innerHTML='<div class="text-center border rounded p-5 my-4"><i class="feather icon-type text-primary" style="font-size:32px" aria-hidden="true"></i><h5 class="mt-3"><lang class="lang_no_custom_profiles_yet">No custom profiles yet</lang></h5><p class="text-muted"><lang class="lang_standard_language_is_in_use_create_a_profi">Standard language is in use. Create a profile to customize your wording.</lang></p>' + (data.writable ? '<button type="button" id="wording-create" class="btn btn-primary"><lang class="lang_create_profile">Create profile</lang></button>' : '') + '<p id="wording-notice" role="status" class="mt-3 mb-0"></p></div>';
        host().oninput=null;host().onchange=null;host().onclick=function(e){if(e.target.closest('#wording-create'))profileForm('create');};
    }
    function render() {
        var h = host(); if (!h) return;
        if (!selected) { emptyState(); return; }
        var disabled = data.writable ? '' : ' disabled';
        var profileColumn = data.branches.length > 1 ? 'col-md-4' : 'col-md-6';
        h.innerHTML = '<p class="text-muted"><lang class="lang_wording_ui_choose_the_wording_your_business_uses_custom_wording_is_preserved_through_updates">Choose the wording your business uses. Custom wording is preserved through updates.</lang></p>' +
            (!data.writable ? '<div class="alert alert-info"><lang class="lang_manage_profiles_on_your_cloud_server_this">Manage profiles on your cloud server. This till uses synchronized wording.</lang></div>' : '') +
            '<div class="row my-3"><div class="' + profileColumn + '"><div class="d-flex justify-content-between"><span><lang class="lang_wording_profile">Profile</lang></span><details class="position-relative"><summary class="text-primary" style="cursor:pointer"><lang class="lang_wording_profile_actions">Profile actions</lang></summary><div class="position-absolute bg-white border rounded shadow-sm p-2" style="right:0;min-width:180px;z-index:5"><button type="button" class="btn btn-link d-block" id="wording-rename"><lang class="lang_rename">Rename</lang></button><button type="button" class="btn btn-link d-block" id="wording-duplicate"><lang class="lang_duplicate">Duplicate</lang></button><button type="button" class="btn btn-link d-block" id="wording-new"><lang class="lang_new_profile">New profile</lang></button><div class="border-top my-1"></div><button type="button" class="btn btn-link text-danger d-block" id="wording-delete"><lang class="lang_wording_ui_delete_profile">Delete profile</lang></button></div></details></div>' +
            (profiles().length > 1 ? '<select id="wording-profile" class="form-control mt-2">' + profiles().map(function (p) { return '<option value="' + esc(p.id) + '" ' + (selected === p.id ? 'selected' : '') + '>' + esc(p.draft.name) + '</option>'; }).join('') + '</select>' : '<div class="py-2" id="wording-profile-title">' + esc(draft.name || 'Shop wording') + '</div>') +
            '</div><label class="' + profileColumn + '"><lang class="lang_int_voice_language">Language</lang><select id="wording-locale" class="form-control mt-2"' + disabled + '>' + data.locales.map(function (l) { var name = l; try { name = new Intl.DisplayNames(['en'], { type: 'language' }).of(l); } catch (e) {} return '<option value="' + esc(l) + '" ' + (l === draft.locale ? 'selected' : '') + '>' + esc(name) + '</option>'; }).join('') + '</select></label>' +
            '<div class="col-md-4" id="wording-branch-picker"' + (data.branches.length > 1 ? '' : ' hidden') + '><lang class="lang_wording_ui_apply_to">Apply to</lang><details class="mt-2 border rounded p-2"><summary id="wording-branch-summary"></summary><label class="d-block mt-2"><input type="checkbox" id="wording-all-branches"' + disabled + '><lang class="lang_wording_ui_select_all_branches"> Select all branches</lang></label>' + data.branches.map(function (b) { return '<label class="d-block"><input type="checkbox" data-branch="' + esc(b.id) + '" ' + (targets.includes(b.id) ? 'checked' : '') + disabled + '> ' + esc(b.name) + '</label>'; }).join('') + '</details></div></div>' +
            '<div id="wording-delete-confirm" class="alert alert-warning my-3" hidden><p id="wording-delete-impact"></p><button type="button" id="wording-delete-yes" class="btn btn-danger"><lang class="lang_wording_ui_delete_profile">Delete profile</lang></button> <button type="button" id="wording-delete-no" class="btn btn-outline-secondary"><lang class="lang_wording_ui_keep_profile">Keep profile</lang></button></div>' +
            '<div class="nav nav-tabs mb-3" role="tablist"><button type="button" class="nav-link active" id="wording-tab-words" role="tab" aria-selected="true" aria-controls="wording-words"><lang class="lang_wording_ui_replace_words">Replace words</lang></button><button type="button" class="nav-link" id="wording-tab-advanced" role="tab" aria-selected="false" aria-controls="wording-advanced"><lang class="lang_wording_ui_advanced">Advanced</lang></button></div>' +
            '<section id="wording-words" role="tabpanel" aria-labelledby="wording-tab-words"><h5><lang class="lang_wording_ui_replace_a_word_across_the_application">Replace a word across the application</lang></h5><p class="text-muted"><lang class="lang_wording_ui_add_singular_and_plural_forms_as_separate_rows">Add singular and plural forms as separate rows.</lang></p><div id="wording-rule-list"></div><button type="button" class="btn btn-outline-primary mb-3" id="wording-add-rule"' + disabled + '><lang class="lang_wording_ui_add_word">+ Add word</lang></button><p class="small text-muted"><lang class="lang_wording_ui_changes_labels_not_product_names_or_previously_issued_documents">Changes labels, not product names or previously issued documents.</lang></p></section>' +
            '<section id="wording-advanced" role="tabpanel" aria-labelledby="wording-tab-advanced" hidden></section>' +
            '<div class="border-top mt-3 pt-3 d-flex flex-wrap justify-content-between align-items-center" style="gap:12px"><p id="wording-notice" role="status" class="mb-0"></p><button type="button" class="btn btn-primary" id="wording-publish"' + disabled + '><lang class="lang_iv2_save_changes">Save changes</lang></button></div><p class="small text-muted mt-3"><lang class="lang_wording_offline_tills_apply_changes_after_synchronization_publi">Offline tills apply changes after synchronization. Publishing does not confirm every device has applied them.</lang></p>';
        branchSummary(); ruleRows(); bind(); switchTab(tab); if (dirty) tell(PosnicPro.i18n.t("lang_rd_unsaved_changes","Unsaved changes"));
    }
    function ruleRows() {
        el('wording-rule-list').innerHTML = draft.rules.map(function (r, i) { return '<div class="row align-items-end mb-3"><label class="col-md-5"><lang class="lang_wording_ui_existing_word">Existing word</lang><input class="form-control" aria-label="Existing word ' + (i + 1) + '" data-rule="' + i + '" data-field="from" maxlength="100" value="' + esc(r.from) + '" ' + (!data.writable ? 'disabled' : '') + '></label><label class="col-md-5"><lang class="lang_wording_ui_use_instead">Use instead</lang><input class="form-control" aria-label="Use instead ' + (i + 1) + '" data-rule="' + i + '" data-field="to" maxlength="100" value="' + esc(r.to) + '" ' + (!data.writable ? 'disabled' : '') + '></label><div class="col-md-2 mb-2"><button type="button" class="btn btn-link" data-remove-rule="' + i + '" ' + (!data.writable ? 'disabled' : '') + '><lang class="lang_ai_key_remove">Remove</lang></button></div></div>'; }).join('');
    }
    function switchTab(next) {
        tab = next;
        ['words', 'advanced'].forEach(function (name) { el('wording-' + name).hidden = next !== name; el('wording-tab-' + name).classList.toggle('active', next === name); el('wording-tab-' + name).setAttribute('aria-selected', String(next === name)); });
        if (next !== 'advanced') return;
        if (!data.labels) {
            if (catalogLoading) return;
            catalogLoading = true; el('wording-advanced').textContent = 'Loading phrases…';
            PosnicPro.get('settings/wording/labels', function (r) { catalogLoading = false; if (!host()) return; if (r.type !== 'success') return catalogFailed(); data.labels = r.data; advanced(); loadBaseWords(); }, catalogFailed);
        } else { advanced(); loadBaseWords(); }
    }
    function catalogFailed() { catalogLoading = false; if (el('wording-advanced')) el('wording-advanced').innerHTML = '<p><lang class="lang_wording_ui_could_not_load_phrases">Could not load phrases.</lang></p><button type="button" class="btn btn-outline-primary" id="wording-retry"><lang class="lang_retry">Retry</lang></button>'; }
    function advanced() {
        if (!el('wording-search')) el('wording-advanced').innerHTML = '<section class="mb-4"><h5><lang class="lang_wording_ui_added_wording">Added wording</lang></h5><p class="text-muted"><lang class="lang_wording_ui_your_word_rules_and_specific_phrase_changes">Your word rules and specific phrase changes.</lang></p><div id="wording-added"></div></section><h5><lang class="lang_wording_ui_edit_a_specific_phrase">Edit a specific phrase</lang></h5><p class="text-muted"><lang class="lang_wording_ui_specific_phrase_replacements_take_priority_over_word_rules">Specific phrase replacements take priority over word rules.</lang></p><label class="d-block"><lang class="lang_wording_search_existing_wording_or_extension">Search existing wording or extension</lang><input id="wording-search" class="form-control" placeholder="Search phrases" data-t-placeholder="lang_search_phrases"></label><p id="wording-results" class="small text-muted"></p><div class="table-responsive"><table class="table"><thead><tr><th><lang class="lang_existing_wording">Existing wording</lang></th><th><lang class="lang_wording_ui_use_instead">Use instead</lang></th><th></th></tr></thead><tbody id="wording-rows"></tbody></table></div><div class="d-flex flex-wrap align-items-center" style="gap:12px"><label><input type="checkbox" id="wording-changed"><lang class="lang_wording_changed_only"> Changed only</lang></label><label><lang class="lang_wording_labels_per_page">Labels per page </lang><select id="wording-page-size">' + [25,50,100].map(function (n) { return '<option ' + (n === pageSize ? 'selected' : '') + '>' + n + '</option>'; }).join('') + '</select></label><button type="button" class="btn btn-outline-primary" id="wording-prev" aria-label="Previous page" data-t-aria-label="lang_previous_page">←</button><button type="button" class="btn btn-outline-primary" id="wording-next" aria-label="Next page" data-t-aria-label="lang_next_page">→</button></div>';
        el('wording-search').value = search; addedRows(); rows();
    }
    function labelText(l) { return baseWords[l.id.replace(/^posnic\./, '')] || l.english; }
    function addedRows() {
        if (!el('wording-added')) return;
        var html = draft.rules.map(function (r, i) { return r.from && r.to ? '<div class="d-flex flex-wrap justify-content-between border-bottom py-2" style="gap:12px"><span>' + esc(r.from) + ' → ' + esc(r.to) + '<small class="d-block text-muted"><lang class="lang_wording_ui_across_the_application">Across the application</lang></small></span><span><button type="button" class="btn btn-link" data-edit-rule="' + i + '"><lang class="lang_action_edit">Edit</lang></button><button type="button" class="btn btn-link" data-remove-rule="' + i + '" ' + (!data.writable ? 'disabled' : '') + '><lang class="lang_ai_key_remove">Remove</lang></button></span></div>' : ''; }).join('');
        html += Object.keys(draft.overrides).map(function (id) { var l = data.labels.find(function (l) { return l.id === id; }); return '<div class="row border-bottom py-2 align-items-center"><div class="col-md-5">' + esc(l ? labelText(l) : id) + '<small class="d-block text-muted">Specific phrase' + (!l ? ' · Extension unavailable' : '') + '</small></div><div class="col-md-5"><input class="form-control" data-added-word="' + esc(id) + '" aria-label="Added replacement" data-t-aria-label="lang_added_replacement" value="' + esc(draft.overrides[id]) + '" maxlength="2000" ' + (!data.writable ? 'disabled' : '') + '></div><div class="col-md-2"><button type="button" class="btn btn-link" data-reset="' + esc(id) + '" ' + (!data.writable ? 'disabled' : '') + '><lang class="lang_ai_key_remove">Remove</lang></button></div></div>'; }).join('');
        el('wording-added').innerHTML = html || '<p class="text-muted"><lang class="lang_wording_ui_no_wording_added_yet">No wording added yet.</lang></p>';
    }
    function rows() {
        if (!el('wording-rows') || !data.labels) return;
        var all = data.labels.filter(function (l) { return (!changedOnly || Object.prototype.hasOwnProperty.call(draft.overrides, l.id)) && [l.english,l.id,labelText(l),l.module,draft.overrides[l.id] || ''].join(' ').toLowerCase().includes(search.toLowerCase()); });
        page = Math.max(0, Math.min(page, Math.ceil(all.length / pageSize) - 1)); var start = page * pageSize;
        el('wording-results').textContent = (all.length ? start + 1 : 0) + '–' + Math.min(start + pageSize, all.length) + ' / ' + all.length;
        el('wording-prev').disabled = page === 0; el('wording-next').disabled = start + pageSize >= all.length;
        el('wording-rows').innerHTML = all.slice(start,start + pageSize).map(function (l) { return '<tr><td>' + esc(labelText(l)) + '<div class="small text-muted">' + esc(l.module) + '</div></td><td><input class="form-control" data-word="' + esc(l.id) + '" aria-label="Replacement for ' + esc(l.english) + '" value="' + esc(draft.overrides[l.id] || '') + '" maxlength="2000" placeholder="Use word rules" data-t-placeholder="lang_use_word_rules" ' + (!data.writable ? 'disabled' : '') + '></td><td><button type="button" class="btn btn-link" data-reset="' + esc(l.id) + '" ' + (!data.writable ? 'disabled' : '') + '><lang class="lang_wording_restore_default">Restore default</lang></button></td></tr>'; }).join('');
    }
    function bind() {
        host().oninput = function (e) {
            var t = e.target;
            if (t.id === 'wording-search') { search = t.value; page = 0; rows(); return; }
            if (!data.writable || busy) return;
            if (t.dataset.rule != null) draft.rules[+t.dataset.rule][t.dataset.field] = t.value;
            else if (t.dataset.word || t.dataset.addedWord) { var id = t.dataset.word || t.dataset.addedWord; if (t.value.trim()) draft.overrides[id] = t.value; else delete draft.overrides[id]; }
            else if (t.id === 'wording-name') draft.name = t.value;
            else return;
            changed();
        };
        host().onchange = function (e) {
            var t = e.target;
            if (t.id === 'wording-page-size') { pageSize = [25,50,100].includes(+t.value) ? +t.value : 25; page = 0; rows(); return; }
            if (t.id === 'wording-changed') { changedOnly = t.checked; page = 0; rows(); return; }
            if (t.id === 'wording-profile') { if (dirty && !window.confirm(PosnicPro.i18n.t("lang_wording_ui_discard_unsaved_changes_and_switch_profile","Discard unsaved changes and switch profile?"))) { t.value = selected; return; } choose(t.value); return; }
            if (!data.writable || busy) return;
            if (t.id === 'wording-locale') {
                if (selected || Object.keys(draft.overrides).length || draft.rules.some(function (r) { return r.from || r.to; })) { t.value = draft.locale; tell(PosnicPro.i18n.t("lang_wording_ui_create_a_new_profile_for_a_different_language_existing_wording_stays_in_its_original_language","Create a new profile for a different language. Existing wording stays in its original language.")); return; }
                draft.locale = t.value; baseWords = {}; if (tab === 'advanced') loadBaseWords(); changed();
            }
            if (t.id === 'wording-all-branches') { targets = t.checked ? data.branches.map(function (b) { return b.id; }) : []; host().querySelectorAll('[data-branch]').forEach(function (c) { c.checked = t.checked; }); branchSummary(); changed(); }
            if (t.dataset.branch) { targets = Array.from(host().querySelectorAll('[data-branch]:checked')).map(function (c) { return c.dataset.branch; }); branchSummary(); changed(); }
            if (t.dataset.word || t.dataset.addedWord) { addedRows(); rows(); }
        };
        host().onclick = function (e) {
            var b = e.target.closest('button'); if (!b || busy) return;
            if (b.id === 'wording-tab-words' || b.id === 'wording-tab-advanced' || b.id === 'wording-retry') { switchTab(b.id === 'wording-tab-words' ? 'words' : 'advanced'); return; }
            if (b.id === 'wording-prev' || b.id === 'wording-next') { page += b.id === 'wording-next' ? 1 : -1; rows(); return; }
            if (!data.writable) return;
            if (b.id === 'wording-add-rule') { draft.rules.push({from:'',to:''}); ruleRows(); changed(); }
            if (b.dataset.removeRule != null) { draft.rules.splice(+b.dataset.removeRule,1); ruleRows(); addedRows(); changed(); }
            if (b.dataset.editRule != null) { switchTab('words'); host().querySelector('[data-rule="' + b.dataset.editRule + '"][data-field="to"]').focus(); }
            if (b.dataset.reset) { delete draft.overrides[b.dataset.reset]; rows(); addedRows(); changed(); }
            if (b.id === 'wording-new' || b.id === 'wording-duplicate' || b.id === 'wording-rename') {
                if (dirty && b.id === 'wording-new' && !window.confirm(PosnicPro.i18n.t("lang_wording_ui_discard_unsaved_changes_and_create_a_new_profile","Discard unsaved changes and create a new profile?"))) return;
                profileForm(b.id === 'wording-rename' ? 'rename' : b.id === 'wording-duplicate' ? 'duplicate' : 'create'); return;
            }
            if (b.id === 'wording-delete') {
                host().querySelectorAll('details').forEach(function(d){d.open=false;});
                var affected = Object.keys(data.state.assignments).filter(function (id) { return Object.values(data.state.assignments[id]).some(function (a) { return a.profileId === selected; }); }).map(function (id) { return data.branches.find(function (b) { return b.id === id; })?.name || 'Another assigned branch'; });
                el('wording-delete-impact').textContent = 'Delete “' + draft.name + '”? ' + (affected.length ? affected.join(', ') + ' will return to standard wording.' : 'No branches are assigned.') + ' Previously issued documents remain unchanged.'; el('wording-delete-confirm').hidden = false;
            }
            if (b.id === 'wording-delete-no') el('wording-delete-confirm').hidden = true;
            if (b.id === 'wording-delete-yes') remove();
            if (b.id === 'wording-publish') save();
        };
    }
    function setBusy(value) { busy = value; host().querySelectorAll('input,select,button').forEach(function (e) { e.disabled = value || !data.writable; }); }
    function failed(r) { setBusy(false); tell(r?.message || 'Save failed. Your edits are still here.'); }
    function remove() {
        setBusy(true); tell(PosnicPro.i18n.t("lang_wording_ui_deleting_profile","Deleting profile…"));
        PosnicPro.post({url:'settings/wording/remove',data:JSON.stringify({id:selected,expectedRevision:data.state.revision})},function (r) {
            if (r.type !== 'success') return failed(r);
            busy = false; data.state = r.data; choose(profiles()[0]?.id || ''); tell(PosnicPro.i18n.t("lang_wording_ui_profile_deleted_assigned_branches_now_use_standard_wording","Profile deleted. Assigned branches now use standard wording.")); if (PosnicPro.wording) PosnicPro.wording.refresh();
        },failed);
    }
    function save() {
        if (data.branches.length === 1) targets = [data.branches[0].id];
        var rules = draft.rules.filter(function (r) { return r.from.trim() || r.to.trim(); });
        if (rules.some(function (r) { return !r.from.trim() || !r.to.trim(); })) return tell(PosnicPro.i18n.t("lang_wording_ui_enter_both_the_existing_word_and_its_replacement","Enter both the existing word and its replacement."));
        if (!draft.name.trim()) draft.name = 'Shop wording - ' + draft.locale;
        var before = data.state.profiles.map(function (p) { return p.id; });
        setBusy(true); tell(PosnicPro.i18n.t("lang_wording_saving","Saving…"));
        PosnicPro.put({url:'settings/wording/draft',data:JSON.stringify(Object.assign({},draft,{rules:rules,id:selected || undefined,expectedRevision:data.state.revision}))},function (r) {
            if (r.type !== 'success') return failed(r);
            data.state = r.data;
            if (!selected) selected = r.data.profiles.find(function (p) { return !before.includes(p.id); }).id;
            PosnicPro.post({url:'settings/wording/publish',data:JSON.stringify({id:selected,expectedRevision:data.state.revision,branches:targets})},function (out) {
                if (out.type !== 'success') return failed(out);
                busy = false; dirty = false; data.state = out.data; render(); tell(targets.length ? PosnicPro.i18n.t('lang_published_tills_apply_this_revision_after', 'Published. Tills apply this revision after synchronization.') : PosnicPro.i18n.t('lang_saved_without_branch_assignments_previousl', 'Saved without branch assignments. Previously assigned branches use standard wording.')); if (PosnicPro.wording) PosnicPro.wording.refresh();
            },failed);
        },failed);
    }
    PosnicPro.wordingEditor = {open:open};
})();
