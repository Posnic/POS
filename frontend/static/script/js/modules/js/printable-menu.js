(function () {
    'use strict';
    var contract = window.PosnicPrintableMenuDesign;
    var renderer = window.PosnicPrintableMenuRenderer;
    var data, design, result, stage, busy = false, dirty = false, generation = 0, timer;
    var t = function (key, fallback) { return PosnicPro.i18n.t(key, fallback); };
    var el = function (id) { return document.getElementById(id); };
    function status(message) { if (el('pm-status')) el('pm-status').textContent = message; }
    function controls() {
        $('#pm-controls').prop('disabled', busy || !data);
        $('#pm-save').prop('disabled', busy || !data);
        $('#pm-download, #pm-print').prop('disabled', busy || !result || !result.pages.length);
        $('#pm-reload').prop('disabled', busy);
    }
    function request(method, url, payload) {
        return new Promise(function (resolve, reject) {
            PosnicPro[method]({ url: url, data: payload ? JSON.stringify(payload) : {} }, function (r) {
                if (!r || r.type !== 'success') reject(new Error(r && r.message || t('lang_pm_load_error', 'Could not load the menu. Try again.')));
                else resolve(r.data);
            }, function (xhr) {
                var message; try { message = JSON.parse(xhr.responseText).message; } catch (_) { /* Network error. */ }
                reject(new Error(message || t('lang_pm_connection_error', 'Could not connect. Check your connection and try again.')));
            });
        });
    }
    function read() {
        var values = Object.assign({}, design);
        document.querySelectorAll('#pm-controls [data-pm]').forEach(function (input) {
            values[input.dataset.pm] = input.type === 'checkbox' ? input.checked : input.value;
        });
        var checks = Array.from(document.querySelectorAll('#pm-categories input'));
        values.categories = checks.every(function (x) { return x.checked; }) ? null :
            checks.filter(function (x) { return x.checked; }).map(function (x) { return x.value; });
        return contract.normalize(values);
    }
    function fill() {
        document.querySelectorAll('#pm-controls [data-pm]').forEach(function (input) {
            var v = design[input.dataset.pm];
            if (input.type === 'checkbox') input.checked = v;
            else input.value = v;
        });
        el('pm-title').placeholder = data.name;
        el('pm-categories').replaceChildren();
        data.categories.forEach(function (c) {
            var label = document.createElement('label'); label.className = 'pm-check';
            var check = document.createElement('input'); check.type = 'checkbox'; check.value = c.id;
            check.checked = design.categories === null || design.categories.indexOf(c.id) !== -1;
            label.appendChild(check); label.appendChild(document.createTextNode(c.name + ' (' + c.items.length + ')'));
            el('pm-categories').appendChild(label);
        });
        $('#pm-remove-background').prop('disabled', !design.background);
        patternChoices();
    }
    function patternChoices() {
        var host = el('pm-patterns');
        if (!host) return;
        if (!host.children.length) {
            Array.from(el('pm-pattern').options).forEach(function (option) {
                var button = document.createElement('button'); button.type = 'button';
                button.className = 'pm-pattern-choice'; button.dataset.pattern = option.value;
                var image = document.createElement('img'); image.alt = '';
                var label = document.createElement('span'); label.textContent = option.textContent;
                button.appendChild(image); button.appendChild(label); host.appendChild(button);
            });
        }
        host.querySelectorAll('button').forEach(function (button) {
            button.setAttribute('aria-pressed', String(!design.background && button.dataset.pattern === el('pm-pattern').value));
            button.querySelector('img').src = renderer.pattern(button.dataset.pattern, el('pm-accent').value, true);
        });
    }
    function scalePreview() {
        var preview = el('pm-preview');
        if (!preview || !preview.clientWidth) return;
        preview.querySelectorAll('.pm-preview-frame').forEach(function (frame) {
            var sheet = frame.firstElementChild;
            var width = parseFloat(sheet.style.width), height = parseFloat(sheet.style.height);
            var scale = Math.min(1, Math.max(0.1, (preview.clientWidth - 40) / width));
            sheet.style.transform = 'scale(' + scale + ')';
            frame.style.width = (width * scale) + 'px'; frame.style.height = (height * scale) + 'px';
        });
    }
    function render() {
        if (!data) return;
        try {
            if (!stage) { stage = document.createElement('div'); stage.className = 'pm-stage'; stage.setAttribute('aria-hidden', 'true'); document.body.appendChild(stage); }
            design = read();
            patternChoices();
            result = renderer.render(stage, data, design);
            var preview = el('pm-preview'); preview.replaceChildren();
            result.pages.forEach(function (page) {
                var frame = document.createElement('div'); frame.className = 'pm-preview-frame';
                frame.appendChild(page.cloneNode(true)); preview.appendChild(frame);
            });
            if (!result.count) preview.textContent = t('lang_pm_empty', 'No menu items to print. Select a category, or add items and enable their menu visibility.');
            el('pm-summary').textContent = result.count + ' ' + t('lang_pm_items', 'items') + ' · ' + result.pages.length + ' ' + t('lang_pm_pages', 'pages') + ' · ' + design.size.toUpperCase();
            scalePreview();
        } catch (error) {
            result = null; el('pm-preview').replaceChildren(); el('pm-summary').textContent = '';
            status(error.message);
        }
        controls();
    }
    function changed() {
        if (busy || !data) return;
        dirty = true; status(t('lang_pm_unsaved', 'Unsaved design'));
        clearTimeout(timer); timer = setTimeout(render, 180);
    }
    async function load() {
        var ticket = ++generation;
        busy = true; data = null; result = null; controls();
        el('pm-preview').replaceChildren(); el('pm-summary').textContent = '';
        status(t('lang_pm_loading', 'Loading menu and design…'));
        try {
            var responses = await Promise.all([request('get', 'items/printable-menu'), request('get', 'settings/group/documents')]);
            if (ticket !== generation) return;
            data = responses[0]; design = contract.normalize(responses[1].values.printable_menu_design);
            fill(); dirty = false; busy = false; status(''); render();
        } catch (error) {
            if (ticket === generation) { busy = false; status(error.message); controls(); }
        }
    }
    async function save() {
        clearTimeout(timer); render(); if (!data) return;
        var ticket = generation;
        busy = true; controls(); status(t('lang_saving', 'Saving…'));
        try {
            await request('put', 'settings/group/documents', { printable_menu_design: read() });
            if (ticket !== generation) return;
            dirty = false; status(t('lang_pm_saved', 'Design saved for this branch.'));
        } catch (error) { if (ticket === generation) status(error.message); }
        finally { if (ticket === generation) { busy = false; controls(); } }
    }
    async function background(file) {
        if (!file || !data) return;
        var ticket = generation;
        if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 10 * 1024 * 1024) {
            status(t('lang_pm_bad_image', 'Choose a PNG, JPEG or WebP image up to 10 MB.')); return;
        }
        busy = true; controls();
        var url = URL.createObjectURL(file);
        try {
            var image = new Image(); image.src = url; await image.decode();
            if (ticket !== generation) return;
            if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 60000000) throw new Error(t('lang_pm_image_large', 'Choose an image smaller than 60 megapixels.'));
            var scale = Math.min(1, 2000 / Math.max(image.naturalWidth, image.naturalHeight));
            var canvas = document.createElement('canvas');
            canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale);
            var ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
            var encoded = canvas.toDataURL('image/jpeg', 0.85);
            if (encoded.length > 1400000) encoded = canvas.toDataURL('image/jpeg', 0.6);
            design = contract.normalize(Object.assign({}, read(), { background: encoded }));
            $('#pm-remove-background').prop('disabled', false);
            busy = false; changed();
        } catch (error) { if (ticket === generation) status(error.message || t('lang_pm_bad_image', 'Could not read this image. Choose a PNG, JPEG or WebP.')); }
        finally { URL.revokeObjectURL(url); if (ticket === generation) { el('pm-background').value = ''; busy = false; controls(); } }
    }
    async function output(print) {
        clearTimeout(timer); render(); if (!result || !result.pages.length) return;
        var ticket = generation;
        var exportResult = result, exportTitle = design.title || data.name || 'Menu';
        busy = true; controls(); status(t('lang_pm_preparing', 'Preparing PDF…'));
        try {
            await Promise.all([PosnicPro.lazy.load('jspdf'), PosnicPro.lazy.load('html2canvas')]);
            if (document.fonts) await document.fonts.ready;
            if (ticket !== generation) return;
            var C = window.jspdf && window.jspdf.jsPDF || window.jsPDF ||
                (typeof window.jspdf === 'function' ? window.jspdf : null);
            if (typeof C !== 'function' || typeof window.html2canvas !== 'function') throw new Error(t('lang_pm_tools_error', 'PDF tools could not load. Please try again.'));
            var dimensions = contract.sizes[exportResult.design.size];
            var doc = new C({ orientation: 'portrait', unit: 'mm', format: dimensions, compress: true });
            for (var i = 0; i < exportResult.pages.length; i++) {
                if (ticket !== generation) throw new Error(t('lang_pm_branch_changed', 'Branch changed. Open the menu again before printing.'));
                status(t('lang_pm_preparing', 'Preparing PDF…') + ' ' + (i + 1) + ' / ' + exportResult.pages.length);
                var page = exportResult.pages[i];
                await Promise.all(Array.from(page.querySelectorAll('img')).map(function (img) { return img.decode(); }));
                var canvas = await window.html2canvas(page, { scale: 3, backgroundColor: '#ffffff', logging: false });
                if (i) doc.addPage(dimensions, 'portrait');
                doc.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, dimensions[0], dimensions[1]);
                canvas.width = 0; canvas.height = 0;
            }
            if (ticket !== generation) throw new Error(t('lang_pm_branch_changed', 'Branch changed. Open the menu again before printing.'));
            doc.setProperties({ title: exportTitle });
            var filename = exportTitle.replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 80) || 'menu';
            if (print && doc.output('arraybuffer').byteLength > 25 * 1024 * 1024) {
                doc.save(filename + '-menu.pdf');
                status(t('lang_pm_large_pdf', 'PDF downloaded. Open the file to print this large menu.'));
                return;
            }
            if (print) await PosnicPro.printPdfDocument(doc, filename + '-menu', t('lang_pm_popup', 'Allow pop-ups to open the printable PDF, or use Download PDF.'), 'menu', exportResult.design.size);
            else doc.save(filename + '-menu.pdf');
            if (ticket !== generation) return;
            status(dirty ? t('lang_pm_unsaved', 'Unsaved design') : t('lang_pm_pdf_ready', 'PDF ready.'));
        } catch (error) { if (ticket === generation) status(error.message); }
        finally { if (ticket === generation) { busy = false; controls(); } }
    }
    $(document).on('shown.bs.tab', '#restaurantprintmenu-tab-line', function () { if (!data) load(); else scalePreview(); });
    function invalidate() {
        ++generation; clearTimeout(timer); data = null; result = null; dirty = false; busy = false;
        if (el('pm-preview')) { el('pm-preview').replaceChildren(); el('pm-summary').textContent = ''; }
        controls();
    }
    $(document).on('change', '#branch_name', invalidate);
    $(document).on('posnic:branch-changed', function () {
        invalidate();
        if ($('#restaurantprintmenu-line').is(':visible')) load();
    });
    // Leaving and re-entering Restaurant picks up a switched branch and fresh prices.
    $(document).on('click', '#v-pills-tableorder-tab, #manage_sec_tableorder', function () {
        invalidate();
        if ($('#restaurantprintmenu-line').hasClass('active')) load();
    });
    $(document).on('input change', '#pm-controls [data-pm], #pm-categories input', changed);
    $(document).on('click', '#pm-patterns button', function () {
        if (busy || !data) return;
        design.background = ''; el('pm-pattern').value = this.dataset.pattern;
        $('#pm-remove-background').prop('disabled', true);
        patternChoices(); changed();
    });
    $(document).on('click', '#pm-save', save);
    $(document).on('click', '#pm-download', function () { output(false); });
    $(document).on('click', '#pm-print', function () { output(true); });
    $(document).on('click', '#pm-reload', function () { if (!dirty || window.confirm(t('lang_pm_discard', 'Reload the menu and discard unsaved design changes?'))) load(); });
    $(document).on('change', '#pm-background', function () { background(this.files[0]); });
    $(document).on('click', '#pm-remove-background', function () { design.background = ''; $(this).prop('disabled', true); changed(); });
    $(document).on('click', '#pm-all, #pm-none', function () { $('#pm-categories input').prop('checked', this.id === 'pm-all'); changed(); });
    $(window).on('resize', scalePreview);
    $(function () { if (window.ResizeObserver && el('pm-preview')) new ResizeObserver(scalePreview).observe(el('pm-preview')); });
})();
