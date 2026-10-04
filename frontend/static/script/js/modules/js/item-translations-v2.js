(function () {
    'use strict';
    var rows = [], active = '', original = '', catalog = [], wired = false;
    var core = window.PosnicItemText;
    var requestId = 0, formVersion = 0, busy = false, available = false, suggestion = null;
    function status(message) { el('item_translation_status').textContent = message; }
    function clearSuggestion() {
        requestId++; busy = false; suggestion = null;
        el('item_translation_ai_review').hidden = true;
    }
    function snapshot() {
        capture();
        return JSON.stringify({ original: original, locale: active, name: el('items_name').value,
            description: el('items_description').value, row: rows.find(function (r) { return r.locale === active; }) });
    }
    function el(id) { return document.getElementById(id === 'items_name' ? 'iv2-name' : id === 'items_description' ? 'iv2-description' : 'iv2-' + id); }
    function languageName(code) {
        var entry = catalog.find(function (row) { return row.code === code; });
        if (entry) return entry.name;
        try { return new Intl.DisplayNames([code], { type: 'language' }).of(code); }
        catch (_) { return code; }
    }
    function capture() {
        var row = rows.find(function (entry) { return entry.locale === active; });
        if (row) { row.name = el('item_translation_name').value; row.description = el('item_translation_description').value; }
    }
    function option(select, code, label) {
        var opt = document.createElement('option'); opt.value = code; opt.textContent = label; select.appendChild(opt);
    }
    function paint() {
        var choices = catalog.slice();
        [original].concat(rows.map(function (row) { return row.locale; })).filter(Boolean).forEach(function (code) {
            if (!choices.some(function (row) { return row.code === code; })) choices.push({ code: code, name: languageName(code) });
        });
        var source = el('item_original_language'), add = el('item_translation_language');
        source.replaceChildren(); add.replaceChildren();
        option(source, '', PosnicPro.i18n.t('lang_item_language_unspecified', 'Not specified'));
        option(add, '', PosnicPro.i18n.t('lang_item_choose_translation', 'Add a language\u2026'));
        choices.forEach(function (row) {
            option(source, row.code, row.name);
            if (row.code !== original && !rows.some(function (entry) { return entry.locale === row.code; })) option(add, row.code, row.name);
        });
        source.value = original;
        add.disabled = rows.length >= 60;
        var chips = el('item_translation_chips'); chips.replaceChildren();
        rows.forEach(function (row) {
            var button = document.createElement('button'); button.type = 'button';
            button.className = 'btn btn-sm ' + (active === row.locale ? 'btn-primary' : 'btn-outline-primary');
            button.textContent = languageName(row.locale) + (row.name || row.description ? ' \u2713' : '');
            button.setAttribute('aria-pressed', String(active === row.locale)); button.lang = row.locale;
            button.addEventListener('click', function () { capture(); clearSuggestion(); active = row.locale; paint(); el('item_translation_name').focus(); });
            chips.appendChild(button);
        });
        el('item_translation_count').textContent = rows.length ? ' (' + rows.length + ')' : '';
        var selected = rows.find(function (row) { return row.locale === active; });
        el('item_translation_fields').hidden = !selected;
        el('item_translation_empty').hidden = !!selected;
        el('item_translation_ai').hidden = !available;
        el('item_translation_ai_stop').hidden = !busy;
        el('item_translation_ai').disabled = busy || !el('items_name').value.trim();
        if (selected) {
            ['name', 'description'].forEach(function (field) {
                var input = el('item_translation_' + field);
                input.value = selected[field] || ''; input.lang = active; input.dir = 'auto';
                input.placeholder = PosnicPro.i18n.t('lang_item_translation_fallback', 'Leave empty to use the original');
                el('item_translation_original_' + field).textContent = el('items_' + field).value || '\u2014';
            });
            el('item_translation_heading').textContent = languageName(active);
        }
    }
    function wire() {
        if (wired || !el('item_translation_panel')) return;
        wired = true;
        el('item_translation_toggle').addEventListener('click', function () {
            var panel = el('item_translation_panel'); panel.hidden = !panel.hidden;
            this.setAttribute('aria-expanded', String(!panel.hidden));
            if (!panel.hidden) { paint(); el('item_translation_language').focus(); }
        });
        el('item_translation_ai').addEventListener('click', function () {
            if (busy || !active || !el('items_name').value.trim()) return;
            clearSuggestion();
            var before = snapshot(), target = active, token = ++requestId;
            busy = true; paint();
            status(PosnicPro.i18n.t('lang_item_ai_working', 'Preparing a translation\u2026 You can keep editing.'));
            PosnicPro.post({ url: 'items/aiTranslation', data: JSON.stringify({
                name: el('items_name').value, description: el('items_description').value,
                source_language: original, target_language: target
            }) }, function (response) {
                if (token !== requestId) return;
                busy = false;
                var unchanged = before === snapshot(); paint();
                if (!unchanged) {
                    status(PosnicPro.i18n.t('lang_item_ai_changed', 'The text changed while translating. Request a new suggestion.')); return;
                }
                if (!response || response.type !== 'success' || !response.data || response.data.locale !== target) {
                    status((response && response.message) || PosnicPro.i18n.t('lang_item_ai_failed', 'Translation unavailable. You can still type it yourself.')); return;
                }
                suggestion = { before: before };
                el('item_translation_ai_name').value = response.data.name || '';
                el('item_translation_ai_description').value = response.data.description || '';
                ['name', 'description'].forEach(function (field) { el('item_translation_ai_' + field).lang = target; });
                el('item_translation_ai_review').hidden = false;
                status(PosnicPro.i18n.t('lang_item_ai_review_help', 'Review the suggestion. Your existing translation stays unchanged until you keep it.'));
            }, function () {
                if (token !== requestId) return;
                busy = false; capture(); paint();
                status(PosnicPro.i18n.t('lang_item_ai_failed', 'Translation unavailable. You can still type it yourself.'));
            });
        });
        el('item_translation_ai_keep').addEventListener('click', function () {
            if (!suggestion) return;
            if (suggestion.before !== snapshot()) {
                clearSuggestion(); paint();
                status(PosnicPro.i18n.t('lang_item_ai_changed', 'The text changed while translating. Request a new suggestion.')); return;
            }
            var row = rows.find(function (r) { return r.locale === active; });
            row.name = el('item_translation_ai_name').value;
            row.description = el('item_translation_ai_description').value;
            clearSuggestion(); paint();
            status(PosnicPro.i18n.t('lang_item_ai_kept', 'Suggestion kept. Save the item to apply your changes.'));
        });
        el('item_translation_ai_discard').addEventListener('click', function () { clearSuggestion(); paint(); status(PosnicPro.i18n.t('lang_item_ai_discarded', 'Suggestion discarded. Your translation is unchanged.')); });
        el('item_translation_ai_stop').addEventListener('click', function () { capture(); clearSuggestion(); paint(); status(PosnicPro.i18n.t('lang_item_ai_discarded', 'Suggestion discarded. Your translation is unchanged.')); });
        el('item_translation_language').addEventListener('change', function () {
            if (!this.value) return;
            capture(); clearSuggestion(); active = this.value; rows.push({ locale: active, name: '', description: '' });
            paint(); el('item_translation_name').focus();
        });
        el('item_original_language').addEventListener('change', function () {
            if (rows.some(function (row) { return row.locale === this.value; }, this)) {
                this.value = original;
                PosnicPro.alert('warning', PosnicPro.i18n.t('lang_item_original_language_conflict', 'This language already has a translation. Remove that translation before assigning it to the original.'));
                return;
            }
            capture(); clearSuggestion(); original = this.value; paint();
        });
        el('item_translation_remove').addEventListener('click', function () {
            capture();
            var current = rows.find(function (row) { return row.locale === active; });
            if (current && (current.name || current.description) && !window.confirm(PosnicPro.i18n.t('lang_item_remove_translation_confirm', 'Remove this translation? The original item stays unchanged.'))) return;
            clearSuggestion();
            rows = rows.filter(function (row) { return row.locale !== active; });
            active = rows.length ? rows[0].locale : ''; paint();
            el(active ? 'item_translation_name' : 'item_translation_language').focus();
        });
        ['name', 'description'].forEach(function (field) {
            el('items_' + field).addEventListener('input', function () { el('item_translation_original_' + field).textContent = this.value || '\u2014'; el('item_translation_ai').disabled = busy || !el('items_name').value.trim(); });
        });
        fetch('languages/index.json').then(function (r) { if (!r.ok) throw new Error('Unavailable'); return r.json(); })
            .then(function (list) { list.forEach(function (row) {
                if (core.locale(row.code) && !catalog.some(function (entry) { return entry.code === row.code; })) catalog.push(row);
            }); capture(); paint(); })
            .catch(function () { /* Saved translations remain editable offline. */ });
    }
    PosnicPro.itemTranslationsV2 = {
        reset: function (item) {
            wire(); item = item || {};
            clearSuggestion(); available = false;
            rows = core.normalize(item.translations || []);
            original = core.locale(item.default_language || '');
            active = rows.length ? rows[0].locale : '';
            catalog = catalog.length ? catalog : core.languages.map(function (code) { return { code: code, name: languageName(code) }; });
            el('item_translation_panel').hidden = true;
            el('item_translation_toggle').setAttribute('aria-expanded', 'false'); paint();
            status(PosnicPro.i18n.t('lang_item_translation_save_hint', "Saved with this item. Empty fields use the original. Descriptions appear only on the customer menu."));
            var token = ++formVersion;
            if (typeof PosnicPro.get === 'function') PosnicPro.get('items/aiAvailability', {}, function (response) {
                if (token !== formVersion) return;
                available = !!(response && response.data && response.data.available); capture(); paint();
            }, function () { /* Manual translation always works. */ });

        },
        ready: function () {
            if (!busy && !suggestion) return true;
            el('item_translation_panel').hidden = false;
            el('item_translation_toggle').setAttribute('aria-expanded', 'true');
            el('item_translation_ai').scrollIntoView({block: 'center'});
            status(PosnicPro.i18n.t('lang_item_ai_finish', 'Wait for the suggestion, then keep or cancel it before saving.'));
            return false;
        },
        data: function () { capture(); return { default_language: original, translations: core.normalize(rows) }; }
    };
}());
