(function () {
    'use strict';
    var engine, schema, branch, design, saved, format, selected, box, observer;
    var undo = [], qrTimer, previewTimer, frameRevision = 0, saving = false, drag = null;
    var esc = function (value) { return PosnicPro.escapeHtml(String(value == null ? '' : value)); };
    var t = function (value) { return engine.label(value); };
    var names = { store: 'Store details', transaction: 'Receipt details', items: 'Items', totals: 'Totals', logo: 'Store logo', text: 'Text', field: 'Dynamic field', qr: 'QR code', image: 'Image', barcode: 'Receipt barcode', divider: 'Divider' };
    function restaurant() { return branch.table_options === true || branch.table_options === 'true' || branch.table_options === 'enable'; }
    function layout() { return design.layouts[format]; }
    function visible(b) { return b.type !== 'field' || restaurant() || schema.restaurant.indexOf(b.field) === -1; }
    function title(b) { return t(b.type === 'field' ? schema.fields[b.field] : names[b.type]); }
    function editableState(value) {
        var state = engine.copy(value);
        Object.keys(state.layouts).forEach(function (f) {
            state.layouts[f].blocks.forEach(function (b) { if (b.type === 'qr') delete b.src; });
        });
        return JSON.stringify(state);
    }
    function dirty() { return editableState(design) !== saved; }
    function status(text, error) { box.find('.rd-status').text(text).toggleClass('rd-error', !!error); }
    function checkpoint() { undo.push(engine.copy(design)); if (undo.length > 30) undo.shift(); }
    function changed() { status(t('Unsaved changes')); box.find('[data-action="undo"]').prop('disabled', !undo.length); schedulePreview(); }
    function sample() {
        var item = function (name, price, qty) { return { item_name: name, item_price: price, item_quantity: qty, item_unit: 'ea', total_amount: price * qty, hsn_code: '1234' }; };
        return Object.assign({}, branch, { receipt_designs: design, sales_id: 'S-000128', created_date: new Date().toLocaleString(),
            customer_name: 'Alex Morgan', customer_phone: '+1 202 555 0148', customer_email: 'alex@example.com', customer_address: '24 Market Street',
            customer_gstin: '', items: [item('Everyday notebook', 12, 2), item('Reusable travel cup', 18, 1), item('Gift wrap', 3, 1)],
            items_subtotal: 45, items_total: 45, tax: 0, discount: 0, sale_extra_discount: 0, round_off: 0, charges: [],
            sales_description: t('Please keep this receipt for your records.'), payment_mode: 'Card', partial_check: 'false',
            table_number: '12', dine_type: 'Dine in', covers: 2, steward_name: 'Sam', serving_session: 'Lunch', order_source: 'Counter' });
    }
    function preview() {
        if (!box || !box.length || !design) return;
        var host = box.find('.rd-preview-page');
        var f = schema.formats[format];
        var width = f.width * 96 / 25.4;
        var innerWidth = (f.height ? f.width : f.content) * 96 / 25.4;
        var html = engine.render(sample(), format, false);
        var rev = ++frameRevision;
        var frame = $('<iframe title="Receipt design preview" data-t-title="lang_receipt_design_preview" sandbox="allow-same-origin" scrolling="no">');
        frame.on('load', function () {
            if (rev !== frameRevision) return;
            var doc = frame[0].contentDocument;
            var fit = function () {
                if (rev !== frameRevision || !doc || !doc.body) return;
                var scale = Math.min(1, Math.max(150, host.parent().width() - 40) / width);
                var height = Math.max(doc.body.scrollHeight, f.height ? f.height * 96 / 25.4 : 0);
                frame.css({ width: width, height: height, transform: 'scale(' + scale + ')' });
                host.css({ width: width * scale, height: height * scale });
            };
            fit(); $(doc).find('img').on('load error', fit);
            $(doc).find('[data-block-id]').on('click', function () { selected = this.getAttribute('data-block-id'); renderList(); });
            if (observer) observer.disconnect();
            if (window.ResizeObserver) { observer = new ResizeObserver(fit); observer.observe(box.find('.rd-preview-stage')[0]); }
        });
        var padding = f.height ? '12mm' : '4mm ' + ((f.width - f.content) / 2) + 'mm';
        frame.attr('srcdoc', '<!doctype html><html><head><meta charset="utf-8"></head><body>' + html +
            '<style>html{width:' + width + 'px;}body{box-sizing:border-box;width:' + width + 'px;padding:' + padding + '!important;display:flow-root;}' +
            '.rd-document{width:' + innerWidth + 'px;max-width:100%;}.rd-block{cursor:pointer;}.rd-block:hover{outline:1px dashed #3878d8;outline-offset:3px;}</style></body></html>');
        host.empty().append(frame);
        box.find('.rd-preview-name').text(t(f.name));
        box.find('.rd-dimensions').text(f.height ? f.width + ' × ' + f.height + ' mm' : f.width + ' mm · ' + f.content + ' mm ' + t('printable width'));
    }
    function schedulePreview() { clearTimeout(previewTimer); previewTimer = setTimeout(preview, 180); }
    function button(action, name, icon, extra) {
        return '<button type="button" class="rd-icon-button" data-action="' + action + '" aria-label="' + esc(t(name)) + '" title="' + esc(t(name)) + '" ' + (extra || '') + '><i class="feather icon-' + icon + '" aria-hidden="true"></i></button>';
    }
    function inspector(b) {
        var html = '<div class="rd-inspector">';
        if (b.type === 'text' || b.type === 'qr') {
            html += '<label for="rd-block-text">' + esc(t(b.type === 'qr' ? PosnicPro.i18n.t('lang_rd_qr_content', 'QR content') : PosnicPro.i18n.t('lang_rd_text_to_print', 'Text to print'))) + '</label><textarea id="rd-block-text" data-prop="text" rows="3" maxlength="1000" placeholder="' + esc(t(b.type === 'qr' ? PosnicPro.i18n.t('lang_rd_website_payment_link_or_other_text', 'Website, payment link or other text') : PosnicPro.i18n.t('lang_rd_enter_your_message', 'Enter your message'))) + '">' + esc(b.text) + '</textarea>';
            if (b.type === 'qr') html += '<small>' + esc(t('The exact content above is encoded in the QR code.')) + '</small><span class="rd-qr-status" role="status"></span>';
            else html += '<label class="rd-inline"><input type="checkbox" data-prop="bold" ' + (b.bold ? 'checked' : '') + '> ' + esc(t('Bold text')) + '</label>';
        }
        if (b.type === 'image') html += '<label for="rd-image-file">' + esc(t('Upload image')) + '</label><input id="rd-image-file" type="file" accept="image/png,image/jpeg,image/webp"><small>' + esc(t('PNG, JPEG or WebP. Up to 5 MB.')) + '</small>' + (b.src ? '<img class="rd-image-thumb" src="' + esc(b.src) + '" alt="' + esc(t('Uploaded image')) + '">' : '');
        if (b.type === 'logo') html += '<p class="rd-help">' + esc(t('Uses the logo saved in Branches / Outlet.')) + '</p>';
        if (b.type === 'field') html += '<p class="rd-help">' + esc(t('Filled from each sale. Omitted when no value is available.')) + '</p>';
        if (b.type === 'barcode') html += '<p class="rd-help">' + esc(t('Code 128 barcode of the saved receipt number. Appears after the sale is saved.')) + '</p>';
        if (b.type === 'items') html += '<label class="rd-inline"><input type="checkbox" data-prop="hsn" ' + (b.hsn ? 'checked' : '') + '> ' + esc(t('Show HSN / SAC codes')) + '</label><p class="rd-help">' + esc(t('Item names wrap onto the next line. Prices and quantities stay readable.')) + '</p>';
        if (b.type === 'totals') html += '<p class="rd-help">' + esc(t('Uses the actual sale amounts, including discounts, tax, charges and rounding.')) + '</p>';
        if (['items', 'totals', 'transaction', 'divider'].indexOf(b.type) === -1) html += '<label for="rd-align">' + esc(t('Alignment')) + '</label><select id="rd-align" data-prop="align">' + ['left', 'center', 'right'].map(function (a) { return '<option value="' + a + '"' + (b.align === a ? ' selected' : '') + '>' + esc(t(a.charAt(0).toUpperCase() + a.slice(1))) + '</option>'; }).join('') + '</select>';
        if (b.type === 'image' || b.type === 'qr') html += '<label for="rd-image-width">' + esc(t('Width (% of printable area)')) + '</label><input id="rd-image-width" type="range" min="15" max="100" step="5" data-prop="width" value="' + (b.width || 45) + '"><output class="rd-width-value">' + (b.width || 45) + '%</output>';
        return html + '</div>';
    }
    function renderList() {
        box.find('.rd-block-list').html(layout().blocks.filter(visible).map(function (b) {
            var mandatory = schema.required.indexOf(b.type) !== -1;
            return '<li class="rd-block-card' + (selected === b.id ? ' is-selected' : '') + '" data-id="' + esc(b.id) + '"><div class="rd-block-heading">' +
                '<span class="rd-drag" data-drag="' + esc(b.id) + '" aria-hidden="true">⠿</span><button type="button" class="rd-select" data-action="select">' + esc(title(b)) + (mandatory ? '<span class="rd-required">' + esc(t('Required')) + '</span>' : '') + '</button>' +
                button('up', 'Move up', 'chevron-up') + button('down', 'Move down', 'chevron-down') + (mandatory ? '' : button('remove', 'Remove block', 'x')) + '</div>' + (selected === b.id ? inspector(b) : '') + '</li>';
        }).join(''));
        box.find('.rd-block-count').text(layout().blocks.filter(visible).length + ' / 40');
        box.find('[data-action="undo"]').prop('disabled', !undo.length);
    }
    function renderEditor() {
        box.find('[data-format]').each(function () { $(this).toggleClass('is-active', this.getAttribute('data-format') === format).attr('aria-pressed', String(this.getAttribute('data-format') === format)); });
        box.find('#rd-text-size').val(layout().fontSize);
        box.find('#rd-default-format').val(design.defaultFormat);
        renderList(); preview();
    }
    function move(id, at) {
        var blocks = layout().blocks;
        var from = blocks.findIndex(function (b) { return b.id === id; });
        if (from < 0 || at < 0 || at >= blocks.length || at === from) return;
        var next = blocks.slice(); var item = next.splice(from, 1)[0]; next.splice(at, 0, item);
        if (next.findIndex(function (b) { return b.type === 'totals'; }) < next.findIndex(function (b) { return b.type === 'items'; })) {
            status(t('Keep totals below the items.'), true); return;
        }
        checkpoint(); layout().blocks = next; renderList(); changed();
    }
    function updateQr(b) {
        clearTimeout(qrTimer); var text = b.text; var id = b.id; var atFormat = format;
        b.src = '';
        if (!text.trim()) { box.find('.rd-qr-status').text(t('Enter content to generate a QR code.')); return; }
        box.find('.rd-qr-status').text(t('Generating QR code…'));
        qrTimer = setTimeout(function () {
            PosnicPro.post({ url: 'setting/receiptDesignQr', data: JSON.stringify({ text: text }) }, function (res) {
                var current = design.layouts[atFormat].blocks.find(function (v) { return v.id === id; });
                if (!current || current.text !== text) return;
                if (res.type === 'success') { current.src = res.data.src; box.find('.rd-qr-status').text(t('QR code ready')); schedulePreview(); }
                else box.find('.rd-qr-status').text(res.message || t('Could not generate QR code.'));
            }, function () { box.find('.rd-qr-status').text(t('Could not generate QR code. Check your connection and edit the content to retry.')); });
        }, 350);
    }
    function upload(file, b) {
        if (!file) return;
        if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 5 * 1024 * 1024) { status(t('Choose a PNG, JPEG or WebP image smaller than 5 MB.'), true); return; }
        var reader = new FileReader();
        reader.onerror = function () { status(t('Could not read this image.'), true); };
        reader.onload = function () {
            var image = new Image(); image.onerror = function () { status(t('Could not read this image.'), true); };
            image.onload = function () {
                var canvas = document.createElement('canvas'); var scale = Math.min(1, 768 / image.width, 768 / image.height);
                canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
                var ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
                var src = canvas.toDataURL('image/png');
                if (src.length > 400000) src = canvas.toDataURL('image/jpeg', 0.85);
                if (!schema.image(src)) { status(t('This image is too detailed. Choose a smaller image.'), true); return; }
                checkpoint(); b.src = src; renderList(); changed();
            }; image.src = reader.result;
        }; reader.readAsDataURL(file);
    }
    function save() {
        if (saving) return;
        var payload;
        try { payload = schema.normalize(design); } catch (error) { status(error.message, true); return; }
        saving = true; box.find('[data-action="save"]').prop('disabled', true); status(t('Saving designs…'));
        var sent = editableState(design);
        PosnicPro.put({ url: 'setting/updateCommonSettings', data: JSON.stringify({ receipt_designs: payload,
            print_type: schema.formats[payload.defaultFormat].height ? 'a4' : 'standard',
            printall: $('#printall').is(':checked') ? 'true' : 'false', bill_print_copies: $('#bill_print_copies').val(),
            branch_fssai_number: $('#branch_fssai_number').val() || '' }) }, function (res) {
            saving = false; box.find('[data-action="save"]').prop('disabled', false);
            if (res.type !== 'success' || !res.data.receipt_designs) { status(res.message || t('Could not save designs.'), true); return; }
            if (editableState(design) === sent) {
                design = res.data.receipt_designs; saved = editableState(design); undo = []; renderEditor(); status(t('All designs saved'));
            } else { saved = editableState(res.data.receipt_designs); status(t('Saved. You have newer unsaved changes.')); }
            branch.receipt_designs = res.data.receipt_designs;
            var type = schema.formats[res.data.receipt_designs.defaultFormat].height ? 'a4' : 'standard';
            $('#print_type').val(type); PosnicPro.local.set('print_type', type);
        }, function (xhr) {
            saving = false; box.find('[data-action="save"]').prop('disabled', false);
            status(xhr && xhr.responseJSON && xhr.responseJSON.message || t('Could not save designs. Your changes are still here.'), true);
        });
    }
    function load(data) {
        engine = PosnicPro.receiptDesigner; schema = engine.contract; branch = data;
        box = $('#receipt-designer'); if (!box.length) return;
        var controls = {};
        ['printall', 'bill_print_copies', 'branch_fssai_number'].forEach(function (id) { controls[id] = $('#' + id).closest('.form-group').detach(); });
        if (observer) observer.disconnect();
        design = data.receipt_designs ? schema.normalize(data.receipt_designs) : engine.defaults(data);
        saved = editableState(design); format = design.defaultFormat; selected = null; undo = [];
        box.html('<div class="rd-topbar"><div><h3>' + esc(t('Receipt designer')) + '</h3><p>' + esc(t('Create a distinct layout for every paper format.')) + '</p></div><div class="rd-save-area"><span class="rd-status" role="status">' + esc(t(data.receipt_designs ? PosnicPro.i18n.t('lang_rd_all_designs_saved', 'All designs saved') : PosnicPro.i18n.t('lang_rd_starting_from_your_current_receipt_settings', 'Starting from your current receipt settings'))) + '</span><button type="button" class="btn btn-primary" data-action="save">' + esc(t('Save designs')) + '</button></div></div>' +
            '<div class="rd-formats" role="group" aria-label="' + esc(t('Edit paper format')) + '">' + Object.keys(schema.formats).map(function (f) { return '<button type="button" data-format="' + f + '"><i class="feather icon-' + (schema.formats[f].height ? 'file-text' : 'printer') + '"></i>' + esc(t(schema.formats[f].name)) + '<small>' + esc(schema.formats[f].height ? schema.formats[f].width + ' × ' + schema.formats[f].height + ' mm' : t('Receipt roll')) + '</small></button>'; }).join('') + '</div>' +
            '<div class="rd-toolbar"><label for="rd-default-format">' + esc(t('Default receipt format')) + '</label><select id="rd-default-format">' + Object.keys(schema.formats).map(function (f) { return '<option value="' + f + '">' + esc(t(schema.formats[f].name)) + '</option>'; }).join('') + '</select><span class="rd-toolbar-help">' + esc(t('Editing a design does not change the default.')) + '</span></div>' +
            '<div class="rd-workspace"><aside class="rd-library"><h4>' + esc(t('Add a block')) + '</h4><p>' + esc(t('Click to add. Drag blocks to reorder.')) + '</p><div class="rd-library-buttons">' + ['text', 'qr', 'image', 'logo', 'barcode', 'divider'].map(function (type) { return '<button type="button" data-add="' + type + '"><span>+</span>' + esc(t(names[type])) + '</button>'; }).join('') + '</div><h4>' + esc(t('Sale fields')) + '</h4><div class="rd-library-buttons">' + Object.keys(schema.fields).filter(function (f) { return restaurant() || schema.restaurant.indexOf(f) === -1; }).map(function (field) { return '<button type="button" data-add="field" data-field="' + field + '"><span>+</span>' + esc(t(schema.fields[field])) + '</button>'; }).join('') + '</div></aside>' +
            '<section class="rd-layout"><div class="rd-section-heading"><h4>' + esc(t('Your layout')) + ' <small class="rd-block-count"></small></h4>' + button('undo', 'Undo', 'rotate-ccw', 'disabled') + '</div><div class="rd-font-control"><label for="rd-text-size">' + esc(t('Text size')) + '</label><select id="rd-text-size">' + [8,9,10,11,12,13,14,16,18].map(function (n) { return '<option value="' + n + '">' + n + ' px</option>'; }).join('') + '</select></div><ol class="rd-block-list"></ol><p class="rd-help">' + esc(t('Store details, receipt details, items and totals are always included.')) + '</p></section>' +
            '<aside class="rd-preview"><div class="rd-section-heading"><h4>' + esc(t('Live preview')) + '</h4><span class="rd-sample-label">' + esc(t('Sample sale')) + '</span></div><div class="rd-preview-stage"><div class="rd-preview-page"></div></div><div class="rd-preview-footer"><strong class="rd-preview-name"></strong><span class="rd-dimensions"></span></div><p class="rd-help">' + esc(t('Preview uses sample customer and item details. Actual receipts use the sale data.')) + '</p></aside></div>' +
            '<details class="rd-print-options"><summary>' + esc(t('Printing options')) + '</summary><div class="rd-existing-options"></div><p class="rd-help">' + esc(t('Choose the connected printer in Hardware Manager. Match its paper to the receipt format.')) + '</p><button type="button" class="btn btn-outline-primary btn-sm" data-action="hardware">' + esc(t('Open Hardware Manager')) + '</button></details>');
        // Keep the existing settings controls and values; only their presentation changes.
        ['printall', 'bill_print_copies', 'branch_fssai_number'].forEach(function (id) {
            var group = controls[id];
            if (group.length) {
                group.removeClass('col-md-6 col-md-12').appendTo(box.find('.rd-existing-options'));
                if (id !== 'printall') group.addClass('restaurant-only').toggle(restaurant());
                else group.find('small').text(t('Print a receipt automatically after payment.'));
            }
        });
        box.off('.receiptDesigner').on('click.receiptDesigner', '[data-format]', function () {
            format = this.getAttribute('data-format'); selected = null; box.find('.rd-preview-stage').scrollTop(0); renderEditor();
        }).on('click.receiptDesigner', '[data-add]', function () {
            if (layout().blocks.length >= 40) { status(t('Each design can contain up to 40 blocks.'), true); return; }
            checkpoint(); var type = this.getAttribute('data-add');
            var b = engine.block(type, { align: ['qr','image','logo','barcode'].indexOf(type) !== -1 ? 'center' : 'left' });
            if (type === 'field') b.field = this.getAttribute('data-field');
            if (type === 'text' || type === 'qr') b.text = '';
            if (type === 'qr' || type === 'image') b.width = schema.formats[format].height ? 25 : 60;
            layout().blocks.push(b); selected = b.id; renderList(); changed();
            var card = box.find('.rd-block-card.is-selected')[0];
            if (card && card.scrollIntoView) { card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); box.find('.rd-block-card.is-selected textarea').trigger('focus'); }
        }).on('click.receiptDesigner', '[data-action]', function () {
            var action = this.getAttribute('data-action'); var id = $(this).closest('[data-id]').attr('data-id');
            var at = layout().blocks.findIndex(function (b) { return b.id === id; });
            if (action === 'save') save();
            else if (action === 'hardware') $('#open_hardware_manager').trigger('click');
            else if (action === 'undo' && undo.length) { design = undo.pop(); renderEditor(); status(t(dirty() ? PosnicPro.i18n.t('lang_rd_unsaved_changes', 'Unsaved changes') : PosnicPro.i18n.t('lang_rd_all_designs_saved', 'All designs saved'))); }
            else if (action === 'select') { selected = selected === id ? null : id; renderList(); }
            else if (action === 'remove' && at >= 0 && schema.required.indexOf(layout().blocks[at].type) === -1) { checkpoint(); layout().blocks.splice(at, 1); renderList(); changed(); }
            else if (action === 'up' || action === 'down') move(id, at + (action === 'up' ? -1 : 1));
        }).on('change.receiptDesigner', '#rd-default-format, #rd-text-size', function () {
            checkpoint(); if (this.id === 'rd-default-format') design.defaultFormat = this.value; else layout().fontSize = Number(this.value); changed();
        }).on('input.receiptDesigner change.receiptDesigner', '[data-prop]', function (event) {
            if (event.type === 'change' && this.tagName === 'TEXTAREA') return;
            var b = layout().blocks.find(function (v) { return v.id === selected; }); if (!b) return;
            var key = this.getAttribute('data-prop'); var value = this.type === 'checkbox' ? this.checked : key === 'width' ? Number(this.value) : this.value;
            if (b[key] === value) return;
            checkpoint(); b[key] = value;
            if (key === 'width') box.find('.rd-width-value').text(value + '%');
            if (b.type === 'qr' && key === 'text') updateQr(b); changed();
        }).on('change.receiptDesigner', '#rd-image-file', function () {
            var b = layout().blocks.find(function (v) { return v.id === selected; }); if (b) upload(this.files[0], b);
        }).on('pointerdown.receiptDesigner', '[data-drag]', function (event) {
            var e = event.originalEvent; if (e.button !== 0) return;
            event.preventDefault(); drag = { id: this.getAttribute('data-drag'), target: null };
            this.setPointerCapture(e.pointerId); $(this).closest('.rd-block-card').addClass('is-dragging');
        }).on('pointermove.receiptDesigner', '[data-drag]', function (event) {
            if (!drag) return;
            var e = event.originalEvent; var target = $(document.elementFromPoint(e.clientX, e.clientY)).closest('.rd-block-card');
            box.find('.rd-drop-target').removeClass('rd-drop-target');
            drag.target = target.attr('data-id');
            if (drag.target && drag.target !== drag.id) target.addClass('rd-drop-target');
        }).on('pointerup.receiptDesigner pointercancel.receiptDesigner', '[data-drag]', function (event) {
            if (!drag) return;
            var ended = drag; drag = null; box.find('.is-dragging,.rd-drop-target').removeClass('is-dragging rd-drop-target');
            if (event.type === 'pointerup' && ended.target) move(ended.id, layout().blocks.findIndex(function (b) { return b.id === ended.target; }));
        });
        renderEditor();
    }
    PosnicPro.receiptDesignerEditor = { load: load, save: save };
}());
