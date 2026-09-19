/* The tender card uses the saved print template and the sale print renderer.
 * Its document stays detached until it enters a scriptless preview frame. */
(function () {
    var cssRequests = {};
    var revision = 0;
    var resizeObserver;

    function assetBase() {
        return new URL(PosnicPro.baseUrl || '.', document.baseURI).href;
    }

    function number(value) {
        return parseFloat(String(value == null ? '' : value).replace(/,/g, '')) || 0;
    }

    function cartData(branch) {
        var sale = PosnicPro.sales;
        var saved = sale.paymentOnlyMode && sale.EditRecentSaleParams;
        if (saved) {
            return $.extend({}, branch, saved, { items_return: saved.items_return || [] });
        }
        var items = [];
        var interstate = $('#sales_new_customer_state').val() &&
            $('#sales_new_customer_state').val() !== PosnicPro.local.get('state_setting');
        $('#sales_new_items_table tbody tr').each(function () {
            var id = $(this).find(':nth-child(9)').text();
            if (!id) { return; }
            var nameCell = $('#addSalesLineItemName_' + id);
            var name = nameCell.attr('data-id') || nameCell.clone().children().remove().end().text();
            if (!name) { return; }
            var read = function (prefix) { return number($('#' + prefix + id).text()); };
            var tax = read('addSalesGstTax_');
            var cached = (sale.SaleTableLineItems || {})[id] || {};
            items.push({
                item_name: name,
                item_price: $('#addSalesLineItemSellingPrice_' + id).length
                    ? read('addSalesLineItemSellingPrice_') : read('addSalesLineItemPrice_'),
                item_quantity: number($('#touchsale_item_qty' + id).val()),
                item_unit: $('#addSalesLineItemUnit_' + id).text() || 'qty',
                item_discount: read('addSalesLineDiscountAmount_'),
                item_discount_percentage: read('addSalesLineDiscountPercentage_'),
                total_amount: read('addSalesLineTotal_'),
                tax: read('addSalesLineItemTax_'),
                tax_type: /^exc/i.test($('#addSalesLineItemTaxType_' + id).text()) ? 'exclusive' : 'inclusive',
                tax_fields: number(cached.tax) === read('addSalesLineItemTax_') ? cached.tax_fields || [] : [],
                tax_name: cached.tax_name || '',
                igst_tax: interstate ? tax : 0,
                cgst_tax: interstate ? 0 : tax / 2
            });
        });
        var extra = number($('#extraDisc').text());
        if (!$('#percentIcon').hasClass('d-none')) { extra = number($('#grand_total').val()) * extra / 100; }
        return $.extend({}, branch, {
            items: items, items_return: [], sales_id: '',
            created_date: moment().format((PosnicPro.local.get('client_dateformat') === 'mm/dd/yyyy'
                ? 'MM/DD/YYYY' : 'DD/MM/YYYY') + ' h:mm A'),
            customer_name: $('#sales_new_customer_name').val() || '',
            customer_phone: $('#sales_new_customer_phone').val() || '',
            customer_email: $('#sales_new_customer_email').val() || '',
            customer_address: $('#sales_new_customer_address').val() || '',
            items_subtotal: number($('#sales_new_subtotal').text()),
            items_total: number($('.tendered_total').first().text()),
            discount: number($('#discount_sale_amount').text()),
            tax: number($('#tax').text()),
            sale_extra_discount: extra,
            round_off: number($('#RoundOff').text()),
            gst: PosnicPro.local.get('gst_action'),
            sales_description: $('#sales_description').val() || '',
            table_number: sale.saleProcess === 'KOT' && PosnicPro.kotorder ? PosnicPro.kotorder.kotTableNumber || '' : '',
            dine_type: sale.saleProcess === 'KOT' && PosnicPro.kotorder ? PosnicPro.kotorder.kotOrderType || '' : sale.dineType || '',
            charges: (sale.charges || []).map(function (charge) {
                return $.extend({}, charge, {
                    tax_amount: sale.chargeTax ? sale.chargeTax.amountFor(charge) : 0,
                    tax_name: sale.chargeTax ? sale.chargeTax.taxName() : ''
                });
            })
        });
    }

    function documentFor(branch, data, layout) {
        if (branch.receipt_designs && PosnicPro.receiptDesigner) {
            return PosnicPro.receiptDesigner.render($.extend({}, branch, data), layout, true);
        }
        var a4 = layout === 'a4';
        var template = a4 ? (branch.regular_body_print || branch.print_a4html)
            : (branch.thermal_body_print || branch.print_standard_html);
        if (!$.trim(template || '')) { throw new Error('Receipt template unavailable'); }
        var root = $('<div>', document.implementation.createHTMLDocument(''));
        var body = $('<div>').addClass(a4 ? 'print-modal-a4-body' : 'print-modal-body').appendTo(root);
        $('<div id="receipt_wrapper" class="row manage-table">').html(template).appendTo(body);
        var fields = {
            print_store_name: branch.branch_name, print_store_gst: branch.branch_gstin_number,
            print_store_address: branch.printing_address, print_store_email: branch.store_email,
            print_store_telephone: branch.store_telephone, print_store_alternativephone: branch.store_alternativephone,
            print_store_city: branch.city, print_store_country: branch.country,
            print_store_state: branch.state, print_store_pincode: branch.pincode
        };
        Object.keys(fields).forEach(function (key) { root.find('.' + key).text(fields[key] || ''); });
        // Settings stores the editor's text as encoded HTML. Decode it exactly
        // as Settings does, preserving the shop's line breaks.
        root.find('.header-content').text($('<div>').html(branch.header_print || '').text());
        root.find('.footer-content').text($('<div>').html(branch.footer_print || 'Thank you for shopping...!').text());
        PosnicPro.sales.view.renderSaleDocument(data, 'sale', true, root, layout);
        if (!data.sales_id) { root.find('.print_view_id, .invoice-policy, .barcodeValue').hide(); }
        // Payment is still being collected. Do not invent a paid status or a
        // receipt number, and do not leave empty payment rows in the template.
        root.find('.print-invoice-payment-mode, .print-payment-status, .print-payment-balance, .print-payment-pending')
            .each(function () { $(this).closest(a4 ? 'tr' : '.row').hide(); });
        var controls = branch.print_controls && branch.print_controls.a4;
        if (controls) {
            ['lineitem_hsn', 'lineitem_price', 'lineitem_qty', 'lineitem_disc', 'lineitem_tax',
                'lineitem_total', 'print_qty', 'print_roundoff'].forEach(function (key) {
                root.find('.' + key).toggle(controls[key] === 'on');
            });
        }
        root.find('script, iframe, object, embed').remove();
        root.find('img').removeAttr('loading').removeAttr('decoding');
        if (String(branch.print_url) === 'true') {
            $('<div class="receipt-brand-url">').css({ textAlign: 'center', marginTop: '4px' }).text(PosnicPro.BRAND_URL).appendTo(body);
        }
        return body.html();
    }

    function styles(layout) {
        if (!cssRequests[layout]) {
            cssRequests[layout] = $.ajax({
                url: assetBase() + 'static/pages/' + (layout === 'a4' ? 'a4print.css' : 'print.css'),
                dataType: 'text'
            }).then(function (css) { return css.replace(/@media\s+print\b/g, '@media all'); });
            cssRequests[layout].fail(function () { delete cssRequests[layout]; });
        }
        return cssRequests[layout];
    }

    function mount(box, html, css, layout) {
        var sheet = layout === 'a4' || layout === 'a5' || layout === 'letter';
        var designed = html.indexOf('data-receipt-design=') !== -1;
        var width = sheet ? (layout === 'letter' ? 816 : layout === 'a5' ? 559 : 794) : (layout === '58' ? 182 : 273);
        var frame = $('<iframe class="tender-receipt-frame" title="Sale print preview" data-t-title="lang_sale_print_preview" sandbox="allow-same-origin" scrolling="no">');
        var paper = $('<div class="tender-receipt-paper">').append(frame);
        var fit = function () {
            if (!frame[0].contentDocument || !frame[0].contentDocument.body) { return; }
            var scale = Math.min(1, box.width() / width);
            var height = Math.ceil(frame[0].contentDocument.body.getBoundingClientRect().height);
            frame.css({ width: width, height: height, transform: 'scale(' + scale + ')' });
            paper.css({ width: width * scale, height: height * scale });
        };
        frame.on('load', function () {
            fit();
            if (window.ResizeObserver) {
                resizeObserver = new ResizeObserver(fit);
                resizeObserver.observe(box[0]);
                resizeObserver.observe(frame[0].contentDocument.body);
            }
            $(frame[0].contentDocument).find('img').on('load error', fit);
        });
        var esc = PosnicPro.escapeHtml;
        var paperCss = sheet || designed ? '' : PosnicPro.paperCss(layout);
        frame.attr('srcdoc', '<!doctype html><html><head><meta charset="utf-8"><base href="' + esc(assetBase()) + '">' +
            '<style>' + css + '\n' + paperCss + '\nhtml,body{background:#fff;color:#000;overflow:hidden!important;}' +
            'body{margin:0!important;display:flow-root;}a{pointer-events:none;}' +
            (sheet ? 'body{box-sizing:border-box;width:' + width + 'px;padding:12mm!important;}' : '') +
            '</style></head><body>' + html + '</body></html>');
        box.empty().append(paper);
    }

    function rawData(html) {
        var sale = PosnicPro.receiptData(html);
        var root = $('<div>').html(html);
        var footerLines = String(sale.footer || '').split('\n').filter(function (line) { return line !== PosnicPro.BRAND_URL; });
        if (root.find('.receipt-brand-url').length) { footerLines.push(PosnicPro.BRAND_URL); }
        sale.footer = footerLines.join('\n');
        var logo = root.find('.branch_image').filter(function () { return this.style.display !== 'none'; }).find('img').first();
        var footer = root.find('.footer-image img').first();
        if (logo.attr('src')) { sale.logo = { src: new URL(logo.attr('src'), assetBase()).href }; }
        if (footer.attr('src')) { sale.footerImage = { src: new URL(footer.attr('src'), assetBase()).href, dither: false }; }
        return sale;
    }

    function mountRaw(box, doc, layout) {
        var canvas = document.createElement('canvas');
        canvas.width = doc.columns * 12;
        function height(row) {
            return row.kind === 'cut' ? 0 : row.kind === 'raster'
                ? row.h * (row.scale & 2 ? 2 : 1) : 24 * (row.h || 1);
        }
        canvas.height = doc.rows.reduce(function (sum, row) { return sum + (row.overlay ? 0 : height(row)); }, 0);
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        var y = 0;
        doc.rows.forEach(function (row) {
            var h = height(row);
            var top = row.overlay ? y - h : y;
            if (row.kind === 'raster') {
                var bytes = atob(row.data);
                var sx = row.scale & 1 ? 2 : 1;
                var sy = row.scale & 2 ? 2 : 1;
                var w = row.wBytes * 8 * sx;
                var left = row.align === 1 ? (canvas.width - w) / 2 : row.align === 2 ? canvas.width - w : 0;
                ctx.fillStyle = '#000';
                for (var i = 0; i < bytes.length; i += 1) {
                    for (var bit = 0; bit < 8; bit += 1) {
                        if (bytes.charCodeAt(i) & (128 >> bit)) {
                            ctx.fillRect(left + ((i % row.wBytes) * 8 + bit) * sx, top + Math.floor(i / row.wBytes) * sy, sx, sy);
                        }
                    }
                }
            } else if (row.kind === 'text' && row.text) {
                var textWidth = row.text.length * 12 * row.w;
                var x = row.align === 1 ? (canvas.width - textWidth) / 2 : row.align === 2 ? canvas.width - textWidth : 0;
                ctx.save();
                ctx.translate(x, top);
                ctx.font = (row.bold ? 'bold ' : '') + '24px monospace';
                ctx.scale(12 * row.w / ctx.measureText('M').width, row.h);
                if (row.reverse) {
                    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, ctx.measureText(row.text).width, 24);
                }
                ctx.fillStyle = row.reverse ? '#fff' : '#000';
                ctx.fillText(row.text, 0, 19);
                if (row.underline) { ctx.fillRect(0, 22, ctx.measureText(row.text).width, row.underline); }
                ctx.restore();
            }
            if (!row.overlay) { y += h; }
        });
        box.empty().append($('<img class="tender-receipt-thermal" alt="Sale print preview">')
            .attr('src', canvas.toDataURL('image/png')).css('width', layout === '58' ? '48mm' : '72mm'));
    }

    PosnicPro.tenderReceipt = {
        cartData: cartData,
        documentFor: documentFor,
        mount: mount,
        rawData: rawData,
        mountRaw: mountRaw,
        show: function () {
            var current = ++revision;
            var box = $('#tender_receipt_preview');
            if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
            if (!box.length) { return; }
            if (PosnicPro.sales.SaleAction === 'return') {
                box.empty().hide(); $('#tender_amount_list').show(); return;
            }
            var message = $('<div class="text-muted text-center" role="status">')
                .text(PosnicPro.i18n.t('lang_loading_print_preview', 'Loading print preview…'));
            box.empty().append(message).show();
            $('#tender_amount_list').hide();
            function failed() {
                if (current !== revision) { return; }
                box.empty().append($('<button type="button" class="btn btn-link">')
                    .text(PosnicPro.i18n.t('lang_preview_unavailable_retry', 'Preview unavailable. Retry')).on('click', PosnicPro.tenderReceipt.show));
                $('#tender_amount_list').show();
            }
            PosnicPro.get({ url: 'branches/getOneStore', data: 'id=' + encodeURIComponent(PosnicPro.local.get('branch_id_set')) }, function (response) {
                if (current !== revision) { return; }
                if (!response || response.type !== 'success' || !response.data) { failed(); return; }
                var branch = response.data;
                var layout = branch.print_type === 'a4' ? 'a4' : (branch.print_width === '58' ? '58' : '80');
                if (branch.receipt_designs) layout = branch.receipt_designs.defaultFormat;
                var printer = window.electronAPI && window.electronAPI.printer;
                if (!branch.receipt_designs && layout !== 'a4' && printer && printer.previewReceipt && PosnicPro.receiptData) {
                    try {
                        var html = documentFor(branch, cartData(branch), layout);
                        printer.previewReceipt(rawData(html), {
                            paperWidth: layout,
                            symbolGlyphs: PosnicPro.local.get('receipt_symbol_glyphs') !== 'false'
                        }).then(function (doc) {
                            if (current === revision) { mountRaw(box, doc, layout); }
                        }).catch(failed);
                    } catch (error) { failed(); }
                    return;
                }
                (branch.receipt_designs ? $.Deferred().resolve('').promise() : styles(layout)).then(function (css) {
                    if (current !== revision) { return; }
                    try {
                        var data = cartData(branch);
                        mount(box, documentFor(branch, data, layout), css, layout);
                    } catch (error) {
                        console.warn('[receipt preview]', error.message);
                        failed();
                    }
                }, failed);
            }, failed);
        }
    };
}());
