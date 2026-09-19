/* The editor, tender preview and printed sale share this renderer. */
(function () {
    'use strict';
    var contract = window.PosnicReceiptDesign;
    var esc = function (v) { return PosnicPro.escapeHtml(v == null ? '' : String(v)); };
    var plain = function (v) { var inert = document.implementation.createHTMLDocument(''); inert.body.innerHTML = v || ''; return inert.body.textContent; };
    var on = function (v) { return v === true || v === 'true' || v === 'enable'; };
    var copy = function (v) { return JSON.parse(JSON.stringify(v)); };
    function label(value) { return PosnicPro.receiptDesignLabel ? PosnicPro.receiptDesignLabel(value) : value; }
    function block(type, extra) { return Object.assign({ id: 'b' + Math.random().toString(36).slice(2), type: type, align: 'left' }, extra || {}); }
    function defaults(branch) {
        var result = { version: 1, defaultFormat: branch.print_type === 'a4' ? 'a4' : branch.print_width === '58' ? '58' : '80', layouts: {} };
        Object.keys(contract.formats).forEach(function (format) {
            var sheet = !!contract.formats[format].height;
            var blocks = [];
            if (on(branch.print_logoimg)) blocks.push(block('logo', { align: sheet ? 'left' : 'center' }));
            if (branch.header_print && branch.header_print !== 'default') blocks.push(block('text', { text: plain(branch.header_print), align: 'center' }));
            blocks.push(block('store', { align: sheet ? 'left' : 'center' }), block('transaction'));
            if (on(branch.customer_print)) ['customer_name', 'customer_phone', 'customer_address'].forEach(function (field) { blocks.push(block('field', { field: field })); });
            Object.keys({ table: 1, order_type: 1, covers: 1, steward: 1, session: 1, fssai: 1, source: 1 }).forEach(function (field) {
                var key = { order_type: 'dine_type' }[field] || field;
                if (on(branch['bill_print_' + key])) blocks.push(block('field', { field: field }));
            });
            blocks.push(block('items', { hsn: on(branch.bill_print_hsn) }), block('totals'));
            if (on(branch.bill_print_total_qty)) blocks.push(block('field', { field: 'total_quantity' }));
            if (on(branch.print_sale_notes)) blocks.push(block('field', { field: 'sale_note' }));
            if (branch.footer_print) blocks.push(block('text', { text: plain(branch.footer_print), align: 'center' }));
            if (branch.footer_image_caption) blocks.push(block('text', { text: branch.footer_image_caption, align: 'center' }));
            if (branch.footer_qr_url) blocks.push(block('qr', { text: branch.footer_qr_url, src: branch.footer_image || '', width: sheet ? 20 : 50, align: 'center' }));
            else if (contract.image(branch.footer_image)) blocks.push(block('image', { src: branch.footer_image, width: sheet ? 25 : 65, align: 'center' }));
            if (on(branch.receipt_barcode)) blocks.push(block('barcode', { align: 'center' }));
            if (on(branch.print_url)) blocks.push(block('field', { field: 'brand_url', align: 'center' }));
            result.layouts[format] = { fontSize: contract.formats[format].font, blocks: blocks };
        });
        return result;
    }
    function safeImage(src) {
        if (contract.image(src)) return src;
        if (!src || /[<>"'\s]/.test(src)) return '';
        try {
            var url = new URL(src, document.baseURI);
            return url.protocol === 'https:' || (url.protocol === 'http:' && url.origin === new URL(document.baseURI).origin) ? url.href : '';
        } catch (_) { return ''; }
    }
    function barcode(text) {
        if (!text || !$.fn.barcode) return '';
        var canvas = $('<canvas>');
        canvas.barcode(String(text), 'code128', { output: 'canvas', barWidth: 2, barHeight: 42, showHRI: true });
        return canvas[0].toDataURL('image/png');
    }
    function formatFor(data, requested) {
        if (!data.receipt_designs) return requested;
        if (requested === 'a4' || requested === 'a5' || requested === 'letter') return requested;
        if (requested === '58' || requested === '80') return requested;
        if (requested === 'standard') return PosnicPro.resolvePaperWidth() === '58' ? '58' : '80';
        return data.receipt_designs.defaultFormat;
    }
    function css(format, font) {
        var f = contract.formats[format];
        var sheet = !!f.height;
        return '@page{size:' + (sheet ? f.width + 'mm ' + f.height + 'mm' : f.width + 'mm auto') + ';margin:' + (sheet ? '12mm' : '0') + ';}' +
            'html,body{margin:0!important;padding:0!important;background:#fff!important;color:#161b25!important;}' +
            '.rd-document,.rd-document *{box-sizing:border-box;}' +
            '.rd-document{width:' + f.content + 'mm;max-width:100%;margin:0 auto;font:' + font + 'px/' + (sheet ? '1.5 Arial,sans-serif' : '1.4 monospace') + ';color:#111;overflow-wrap:anywhere;}' +
            '.rd-block{margin:0 0 ' + (sheet ? '14px' : '7px') + ';break-inside:avoid;}' +
            '.rd-block-items{break-inside:auto;}.rd-document h1{font-size:1.7em;line-height:1.2;margin:0 0 5px;color:#111;}' +
            '.rd-store-contact{white-space:pre-line;}.rd-document p{margin:2px 0;}.rd-document img{height:auto;max-width:100%;object-fit:contain;}' +
            '.rd-document table{width:100%;border-collapse:collapse;table-layout:fixed;font:inherit;color:inherit;}' +
            '.rd-document th{font-weight:bold;border-top:1px solid #333;border-bottom:1px solid #333;text-align:left;padding:7px 3px;}' +
            '.rd-document td{padding:6px 3px;vertical-align:top;border-bottom:1px solid #ddd;}.rd-document tr{break-inside:avoid;}.rd-document thead{display:table-header-group;}' +
            '.rd-number{text-align:right!important;white-space:normal;}.rd-line-detail{font-size:.88em;color:#444;}' +
            '.rd-total-row{display:flex;justify-content:space-between;gap:12px;margin:3px 0;}.rd-grand-total{font-size:1.3em;font-weight:bold;border-top:2px solid #111;padding-top:7px;margin-top:8px;}' +
            '.rd-totals{width:' + (sheet ? '48%' : '100%') + ';margin-left:auto;}.rd-transaction{display:flex;justify-content:space-between;gap:16px;border-bottom:1px solid #bbb;padding-bottom:8px;}' +
            '.rd-muted{color:#555;font-size:.9em;}.rd-text{white-space:pre-wrap;}.rd-divider{border:0;border-top:1px dashed #777;margin:10px 0;}' +
            '.rd-sheet .rd-store{padding-bottom:12px;border-bottom:2px solid #222;}.rd-terms{margin-top:20px;font-size:.9em;white-space:pre-line;}' +
            '@media print{.rd-document{max-width:none!important;}body{width:auto!important;min-width:0!important;}}';
    }
    function render(data, format, preview) {
        var designs = data.receipt_designs;
        format = formatFor(data, format);
        var layout = contract.layoutFor(designs, format);
        var sheet = !!contract.formats[format].height;
        var currency = (typeof data.currency_type === 'string' ? data.currency_type : '') || PosnicPro.local.get('currencySign') || '';
        var money = function (v) { return esc(currency) + ' ' + esc(Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })); };
        var pair = function (name, value, total) { return '<div class="rd-total-row' + (total ? ' rd-grand-total' : '') + '"><span>' + esc(label(name)) + '</span><span>' + value + '</span></div>'; };
        var items = data.items || [];
        var values = {
            customer_name: data.customer_name, customer_phone: data.customer_phone, customer_email: data.customer_email,
            customer_address: data.customer_address, sale_note: data.sales_description, brand_url: data.website || PosnicPro.BRAND_URL,
            total_quantity: items.reduce(function (n, i) { return n + Number(i.item_quantity || 0); }, 0),
            table: data.table_number, order_type: data.dine_type, covers: data.covers || data.person_count,
            steward: data.steward_name || data.steward || data.created_by || data.user_name, session: data.serving_session || data.session_name,
            fssai: data.branch_fssai_number, source: data.order_source || data.source,
        };
        var html = layout.blocks.map(function (b) {
            var content = '';
            if (b.type === 'field' && contract.restaurant.indexOf(b.field) !== -1 && !on(data.table_options)) return '';
            if (b.type === 'store') {
                content = '<div class="rd-store"><h1>' + esc(data.branch_name || data.store_name || PosnicPro.local.get('branchname')) + '</h1><div class="rd-store-contact">' + esc(plain(data.printing_address || data.store_address || '')) + '</div>';
                if (data.store_telephone) content += '<p>' + esc(data.store_telephone) + '</p>';
                if (data.store_email) content += '<p>' + esc(data.store_email) + '</p>';
                if (data.branch_gstin_number) content += '<p>GSTIN: ' + esc(data.branch_gstin_number) + '</p>';
                content += '</div>';
            } else if (b.type === 'transaction') {
                content = '<div class="rd-transaction"><strong>' + esc(data.sales_id ? label('Receipt') + ' ' + data.sales_id : label('Bill')) + '</strong><span>' + esc(data.created_date || data.date || '') + '</span></div>';
                if (data.customer_gstin || data.customer_gstin_number || data.customer_gst_number) content += '<p>' + esc(label('Customer GSTIN')) + ': ' + esc(data.customer_gstin || data.customer_gstin_number || data.customer_gst_number) + '</p>';
            } else if (b.type === 'items') {
                content = '<table><colgroup><col style="width:' + (sheet ? '44' : '60') + '%">' + (sheet ? '<col style="width:18%"><col style="width:14%"><col style="width:24%">' : '<col style="width:40%">') + '</colgroup><thead><tr><th>' + esc(label('Item')) + '</th>' + (sheet ? '<th class="rd-number">' + esc(label('Unit price')) + '</th><th class="rd-number">' + esc(label('Qty')) + '</th>' : '') + '<th class="rd-number">' + esc(label('Amount')) + '</th></tr></thead><tbody>';
                items.forEach(function (item) {
                    var qty = Number(item.item_quantity || 0);
                    var hsn = item.hsncode || item.hsn_code || item.hsn || (/^\d{4,8}$/.test(item.tax_name || '') ? item.tax_name : '');
                    content += '<tr><td>' + esc(item.item_name) + (b.hsn && hsn ? '<div class="rd-line-detail">HSN/SAC: ' + esc(hsn) + '</div>' : '');
                    if (!sheet) content += '<div class="rd-line-detail">' + esc(qty + ' ' + (item.item_unit || '') + ' × ') + money(item.item_price) + '</div>';
                    if (Number(item.item_discount) || Number(item.item_discount_percentage)) content += '<div class="rd-line-detail">' + esc(label('Discount')) + ': ' + (Number(item.item_discount_percentage) ? esc(item.item_discount_percentage) + '%' : money(item.item_discount)) + '</div>';
                    content += '</td>' + (sheet ? '<td class="rd-number">' + money(item.item_price) + '</td><td class="rd-number">' + esc(qty + ' ' + (item.item_unit || '')) + '</td>' : '') + '<td class="rd-number">' + money(item.total_amount) + '</td></tr>';
                });
                content += '</tbody></table>';
            } else if (b.type === 'totals') {
                content = '<div class="rd-totals">' + pair('Subtotal', money(data.items_subtotal));
                if (Number(data.discount)) content += pair('Discount', money(-Number(data.discount)));
                if (Number(data.sale_extra_discount)) content += pair('Extra discount', money(-Number(data.sale_extra_discount)));
                var igst = items.reduce(function (n, i) { return n + Number(i.igst_tax || 0); }, 0);
                var cgst = items.reduce(function (n, i) { return n + Number(i.cgst_tax || 0); }, 0);
                if (on(data.gst) && igst) content += pair('IGST', money(igst));
                else if (on(data.gst) && cgst) content += pair('CGST', money(cgst)) + pair('SGST', money(cgst));
                else if (Number(data.tax)) content += pair('Tax', money(data.tax));
                (data.charges || []).forEach(function (c) { content += pair(c.name || 'Charge', money(Number(c.amount || 0) + Number(c.tax_amount || 0))); });
                if (Number(data.round_off)) content += pair('Rounding', money(data.round_off));
                content += pair('Total', money(data.items_total), true);
                if (!preview && data.sales_id) {
                    if (data.payment_mode) content += pair('Payment', esc(data.payment_mode));
                    if (data.partial_check === 'true') content += pair('Payments / credits', money(data.partial_balance)) + pair('Balance due', money(data.payment_pending));
                }
                content += '</div>';
            } else if (b.type === 'field') {
                var value = values[b.field];
                if (value === undefined || value === null || value === '') return '';
                content = '<div class="rd-text">' + (b.field === 'brand_url' ? '' : '<strong>' + esc(label(contract.fields[b.field])) + ':</strong> ') + esc(value) + '</div>';
            } else if (b.type === 'text') content = '<div class="rd-text">' + esc(b.text) + '</div>';
            else if (b.type === 'divider') {
                var lineStyle = ['solid', 'dashed', 'dotted'].indexOf(b.lineStyle) !== -1 ? b.lineStyle : 'dashed';
                var width = Math.max(15, Math.min(100, Number(b.width) || 100));
                var thickness = Math.max(1, Math.min(4, Number(b.thickness) || 1));
                content = '<hr class="rd-divider" style="border-top-style:' + lineStyle + ';border-top-width:' + thickness + 'px;width:' + width + '%;margin-left:' + (b.align === 'center' || b.align === 'right' ? 'auto' : '0') + ';margin-right:' + (b.align === 'center' ? 'auto' : '0') + '">';
            }
            else {
                var logo = data.logo || data.branch_image;
                var src = b.type === 'logo' ? safeImage(!logo || logo === 'store.png' ? 'static/images/default/store.png' : logo) : b.type === 'barcode' ? barcode(data.sales_id) : safeImage(b.src);
                if (!src) return '';
                content = '<img src="' + esc(src) + '" alt="' + esc(label(b.type === 'qr' ? 'QR code' : b.type === 'logo' ? 'Store logo' : b.type === 'barcode' ? PosnicPro.i18n.t('lang_rd_receipt_barcode', 'Receipt barcode') : PosnicPro.i18n.t('lang_image', 'Image'))) + '" style="width:' + (b.type === 'logo' ? (sheet ? 22 : 45) : b.type === 'barcode' ? 90 : b.width) + '%;max-height:' + (b.type === 'logo' ? '100px' : 'none') + ';">';
            }
            var style = 'text-align:' + b.align;
            if (contract.textTypes.indexOf(b.type) !== -1) {
                if (Number.isFinite(Number(b.fontSize)) && Number(b.fontSize) >= 8 && Number(b.fontSize) <= 32) style += ';font-size:' + Number(b.fontSize) + 'px';
                if (b.bold === true) style += ';font-weight:bold';
            }
            return '<section class="rd-block rd-block-' + b.type + '" data-block-id="' + esc(b.id) + '" style="' + style + '">' + content + '</section>';
        }).join('');
        if (sheet) {
            if ((data.branch_gstin_number || on(data.gst)) && PosnicPro.sales && PosnicPro.sales.view && PosnicPro.sales.view._amountInWords) {
                html += '<div class="rd-terms"><strong>' + esc(PosnicPro.i18n.t('lang_amount_in_words', 'Amount in words:')) + '</strong> ' + esc(PosnicPro.sales.view._amountInWords(data.items_total)) + '</div>';
            }
            if (data.invoice_terms) html += '<div class="rd-terms"><strong>' + esc(PosnicPro.i18n.t('lang_terms_conditions', 'Terms & conditions')) + '</strong><br>' + esc(data.invoice_terms) + '</div>';
            var signature = safeImage(data.quote_default_signature);
            html += '<div class="rd-terms" style="width:220px;margin-left:auto;text-align:center;break-inside:avoid">' + (signature ? '<img src="' + esc(signature) + '" alt="" style="max-height:38px;max-width:170px"><br>' : '') + '<div style="border-top:1px solid #999;padding-top:5px">' + esc(PosnicPro.i18n.t('lang_authorised_signatory', 'Authorised signatory')) + '</div></div>';
        }
        return '<style>' + css(format, layout.fontSize) + '</style><article class="rd-document' + (sheet ? ' rd-sheet' : '') + '" data-receipt-design="' + format + '">' + html + '</article>';
    }
    function print(html, format) {
        var doc = '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(label('Receipt')) + '</title></head><body>' + html + '</body></html>';
        var printer = window.electronAPI && window.electronAPI.printer;
        var failure = function (error) { PosnicPro.alert('error', error.message || label('Print failed')); };
        if (printer && printer.print) {
            return Promise.resolve(PosnicPro.syncPrinterPreferences ? PosnicPro.syncPrinterPreferences() : null)
                .catch(function () {})
                .then(function () {
                    var chosen = PosnicPro.resolveReceiptPrinter();
                    if (chosen) return chosen;
                    return Promise.resolve(printer.getDefault()).then(function (fallback) {
                        var name = fallback && typeof fallback === 'object' ? fallback.name : fallback;
                        if (!name || (PosnicPro._kitchenPrinters || []).indexOf(String(name).trim().toLowerCase()) !== -1) {
                            throw new Error('Choose a receipt printer in Hardware Manager.');
                        }
                        return name;
                    });
                }).then(function (name) { return printer.print(doc, { printerName: name,
                pageSize: format === '58' || format === '80' ? format + 'mm' : format,
                fitReceipt: format === '58' || format === '80',
                silent: true, forceHtml: true, printBackground: true, margins: { marginType: 'none' } }); })
                .then(function (result) {
                    if (!result || !result.success) throw new Error(result && result.error || label('Print failed'));
                    PosnicPro.afterPrint();
                }).catch(failure);
        }
        var frame = $('<iframe title="Receipt print" data-t-title="lang_receipt_print" sandbox="allow-same-origin allow-modals">').css({ position: 'fixed', left: '-10000px', top: 0, width: contract.formats[format].width + 'mm', height: '1000px', border: 0 });
        frame.on('load', function () {
            var win = frame[0].contentWindow;
            PosnicPro.waitForPrintAssets(win.document).then(function () {
                win.onafterprint = function () { frame.remove(); };
                win.focus(); win.print(); PosnicPro.afterPrint();
            }).catch(function (error) { frame.remove(); failure(error); });
        });
        frame.attr('srcdoc', doc).appendTo('body');
    }
    PosnicPro.receiptDesigner = { contract: contract, defaults: defaults, render: render, css: css, print: print, block: block, label: label, copy: copy, formatFor: formatFor };
}());
