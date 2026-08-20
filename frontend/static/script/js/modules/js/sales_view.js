PosnicPro.sales.view = {
    viewSale: function (id) {
        var loader = $(".loader-view-sale");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        PosnicPro.get('sales/' + id, function (response) {
            if (response.type === 'success') {
                PosnicPro.record_id = id;
                $('#sales-total-hide,#viewsale_edit_print_view,#salesitemtitleText,#sale_print_view,#return_print_view').show();
                $('#hide_sales_print,#hide_return_print').show();
                var data = response.data;
                if (data.payment_description === '') {
                    $('.paynote_hide').hide();
                } else {
                    $('.paynote_hide').show();
                }
                if (data.sales_description === '') {
                    $('.salenote_hide').hide();
                } else {
                    $('.salenote_hide').show();
                }
                if (data.sale_process === 'Add' || data.sale_process === 'Edit' || data.sale_process === 'Hold') {
                    $('.sale-view-heading').html('Sale');
                    $('.hide-sale-return,#salesreturntitleText,#return_print_view,#hide_return_print,#show_sales_print').hide();
                } else if (data.sale_process === 'FullReturn') {
                    $('.sale-view-heading').html('Return');
                    $('.hide-sale-return,#salesreturntitleText,#return_print_view,#hide_return_print').show();
                    $('#viewsale_edit_print_view,#salesitemtitleText,#sales-total-hide,#sale_print_view,#hide_sales_print,#show_sales_print').hide();
                } else if (data.sale_process === 'cancelled' || data.sale_process === 'Cancelled') {
                    // Cancelled: act like Sale but hide Return Line Item card
                    $('.sale-view-heading').html('Sale');
                    $('.hide-sale-return,#salesreturntitleText,#return_print_view,#hide_return_print').hide();
                    // keep normal sale totals visible
                    $('#sales-total-hide,#show_sales_print').show();
                    $('#hide_sales_print,#hide_return_print').hide();
                } else {
                    $('.sale-view-heading').html('Sale');
                    $('#sales-total-hide,.hide-sale-return,#salesreturntitleText,#return_print_view,#hide_return_print,#show_sales_print').show();
                    $('#hide_sales_print,#hide_return_print').hide();
                }

                PosnicPro.sales.view.viewSaleData(response, id);
                loader.find(".loadingSpinner:first").remove();
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        });
    },
    viewSaleData: function (response, id) {
        $('#viewsale_edit_print_view tbody,#detailed_sale_item_tax,#detailed_sale_itemreturn_tax,#viewsale_return_print_view tbody').children("tr").remove();
        $('#viewsale_edit_print_view,#detailed_sale_item_tax,#detailed_sale_itemreturn_tax,#viewsale_return_print_view tbody').find("tr:not(:first)").remove();
        $('#viewsale_return_print_view, #round_off_view, #return_round_off_view, #extra_discount_view, #return_extra_discount_view').html('');
        $('#sale_view_payment_status').removeClass('badge badge-success-inverse badge badge-warning-inverse');
        $('#payment_status').removeClass('badge badge-success-inverse badge badge-warning-inverse');
        $('#sales_view').modal('show');
        $('.sale_view_hide').hide();
        var data = response.data;
        (data.partial_check === 'true' && data.sale_process !== 'PartialReturn' && data.sale_process !== 'FullReturn') ? $('#sale_view_Transaction_show').show() : $('#sale_view_Transaction_show').hide();
        $.each(data, function (key, val) {
            if (val === '' || val === null) {
                $('#sale_view_' + key).text('');
                $('.sale_view_' + key).hide();
            } else {
                $('#sale_view_' + key).text(val);
                $('.sale_view_' + key).show();
            }
        });

        // Payment Method + Amounts (multi payment support)
        (function () {
            var multiPayment = data.multi_payment;

            // If backend sent multi_payment as JSON string, try to parse it
            if (typeof multiPayment === 'string' && multiPayment.trim() !== '') {
                try {
                    var trimmed = multiPayment.trim();
                    if (trimmed.charAt(0) === '{' || trimmed.charAt(0) === '[') {
                        multiPayment = JSON.parse(trimmed);
                    }
                } catch (e) {
                    multiPayment = null;
                }
            }

            if (multiPayment && typeof multiPayment === 'object' && Object.keys(multiPayment).length > 0) {
                var currencySign = PosnicPro.local.get('currencySign') || '';
                var rowsHtml = '';
                $.each(multiPayment, function (method, amount) {
                    var num = parseFloat(amount);
                    if (!isNaN(num) && num !== 0) {
                        rowsHtml += '<tr>' +
                            '<td class="pr-3">' + method + '</td>' +
                            '<td class="text-right" style="white-space:nowrap;">' + currencySign + '&nbsp;' + num.toFixed(2) + '</td>' +
                            '</tr>';
                    }
                });

                if (rowsHtml) {
                    var tableHtml = '<table class="table table-borderless table-sm mb-0"><tbody>' + rowsHtml + '</tbody></table>';
                    $('#sale_view_payment_mode').html(tableHtml);
                    return; // done
                }
            }

            // Fallback: no multi_payment data, show single payment_mode with amount
            var singleMode = (data.payment_mode || '').toString().trim();
            var grandTotal = (typeof data.items_total !== 'undefined') ? parseFloat(data.items_total) : NaN;
            if (singleMode) {
                var currencySingle = PosnicPro.local.get('currencySign') || '';
                if (!isNaN(grandTotal) && grandTotal !== 0) {
                    var singleHtml = '<table class="table table-borderless table-sm mb-0"><tbody>' +
                        '<tr>' +
                        '<td class="pr-3">' + singleMode + '</td>' +
                        '<td class="text-right" style="white-space:nowrap;">' + currencySingle + '&nbsp;' + grandTotal.toFixed(2) + '</td>' +
                        '</tr>' +
                        '</tbody></table>';
                    $('#sale_view_payment_mode').html(singleHtml);
                } else {
                    $('#sale_view_payment_mode').text(singleMode);
                }
            }
        })();

        // When table order is disabled, hide table/order-type details in the view modal
        var tableOptionsEnabled = (PosnicPro.local.get('table_options') === 'enable');
        if (!tableOptionsEnabled) {
            $('.sale_view_table_number, .sale_view_dine_type').hide();
        }
        (typeof (data.payment_status) === "undefined" || data.payment_status === null || data.payment_status === 'Paid') ? $('#sale_view_payment_status').addClass('badge badge-success-inverse') : $('#sale_view_payment_status').addClass('badge badge-warning-inverse');
        $('#payment_status').text(data.payment_status);
        (typeof (data.payment_status) === "undefined" || data.payment_status === null || data.payment_status === 'Paid') ? $('#payment_status').addClass('badge badge-success-inverse') : $('#payment_status').addClass('badge badge-warning-inverse');

        $('#salestitleText').html(data.sale_process + ' Details');
        $('.sales_id_print').val(id);

        var updateDate = PosnicPro.convertDate(data.date);
        $('#date_view').html(updateDate);
        var length = data.items.length;
        $('.sales-total-count').html(length);
        $('#sales_view').show();
        var currency = PosnicPro.local.get('currencySign');

        //item line calculation
        var itemTaxDetails = [];
        var igst = 0;
        var cgst = 0;
        for (var i = 0; i < length; i++) {
            var tax = data.items[i].tax;
            var tax_type = data.items[i].tax_type;
            if (tax_type === 'exclusive') {
                var price = data.items[i].item_price;
            } else {
                var price = data.items[i].item_price / ((tax / 100) + 1);
            }
            var discount = (data.items[i].item_discount > 0) ? data.items[i].item_discount : data.items[i].item_discount_percentage;
            var discountSign = (data.items[i].item_discount > 0) ? currency : '%';

            igst += data.items[i].igst_tax;
            cgst += data.items[i].cgst_tax;

            if (discountSign === '%') {
                var priceAmount = (((price.toFixed(2)) * data.items[i].item_quantity) - (((price.toFixed(2)) * data.items[i].item_quantity) * (discount / 100)));
            } else {
                var priceAmount = (((price.toFixed(2)) * data.items[i].item_quantity) - (discount * data.items[i].item_quantity));
            }

            var discount_percentage = '--';
            if (discount !== 0) {
                if (discountSign === '%') {
                    discount_percentage = '' + discount + ' ' + discountSign + '';
                } else {
                    discount_percentage = '' + discountSign + ' ' + discount + '';
                }
            }
            var tax_percentage = '--';
            if (tax !== 0) {
                tax_percentage = '' + tax + '%';
            }
            let item_unit = (typeof (data.items[i].item_unit) !== "undefined" && data.items[i].item_unit !== null) ? data.items[i].item_unit : 'qty';
            var rowHTMLLine = ' <tr> ' +
                '<td>' + (i + 1) + '</td>' +
                '<td width="30%">' + data.items[i].item_name + '</td>' +
                '<td>' + currency + '&nbsp;<span class="number">' + price + '</span> </td>' +
                '<td>' + PosnicPro.formatQuantity(data.items[i].item_quantity, item_unit) + ' ' + item_unit + '</td>' +
                '<td>' + discount_percentage + '</td>' +
                '<td>' + tax_percentage + '</td>' +
                '<td class="text-right">' + currency + '&nbsp;<span class="number">' + data.items[i].total_amount + '</span> </td>' +
                '</tr>';

            $('#viewsale_edit_print_view tbody').append(rowHTMLLine);

            var gstAction = PosnicPro.local.get('gst_action');
            var gstEnabled = (gstAction === 'enable' && data.gst === 'enable');

            // Normalise tax_fields into an array for consistent handling
            var taxFieldsArr = Array.isArray(data.items[i].tax_fields)
                ? data.items[i].tax_fields
                : (data.items[i].tax_fields ? [data.items[i].tax_fields] : []);
            var hasTaxFields = taxFieldsArr.length > 0;

            // HSN code configured on the item (if any)
            var hsnCodeForItem = (data.items[i].hsncode || data.items[i].hsn_code || '').toString().trim();
            var hasHsnCode = hsnCodeForItem !== '';

            // In the Node backend, many HSN-based items propagate the HSN
            // into tax_name on the sale line instead of a separate hsncode
            // field. When gst is disabled, we still want those items to be
            // treated as HSN-tax items. If we don't have an explicit
            // hsncode/hsn_code but tax_name looks like a numeric HSN code
            // (>= 4 digits), treat that as the HSN code.
            if (!hasHsnCode) {
                var saleTaxName = (data.items[i].tax_name || '').toString().trim();
                if (/^[0-9]{4,}$/.test(saleTaxName)) {
                    hsnCodeForItem = saleTaxName;
                    hasHsnCode = true;
                }
            }

            if (gstEnabled && hasTaxFields) {
                // Indian GST enabled: preserve detailed component list so GST
                // summary works, but prefer HSN as label when available
                for (var z = 0; z < taxFieldsArr.length; z++) {
                    var taxItem = taxFieldsArr[z];
                    var taxAmount = (priceAmount / 100) * taxItem.tax_value;
                    var taxName = hasHsnCode ? hsnCodeForItem : (taxItem.tax_name || '');
                    var rawTaxId = taxItem.tax_id || '';
                    var taxId = hasHsnCode
                        ? hsnCodeForItem
                        : (rawTaxId && (rawTaxId.$oid || rawTaxId)) || '';
                    itemTaxDetails.push({
                        "tax_id": taxId,
                        "tax_name": taxName,
                        "tax_value": taxAmount
                    });
                }
            } else if (!gstEnabled) {
                // Indian GST disabled (PHP-style rules):
                //  1) HSN tax item       => show single HSN row
                //  2) Group tax item     => show group components
                //  3) Simple item tax    => NO Tax Details rows

                // Case 1: HSN-based item tax (with or without tax_fields)
                if (hasHsnCode && data.items[i].tax > 0) {
                    var taxAmountHsn = (priceAmount / 100) * data.items[i].tax;
                    itemTaxDetails.push({
                        "tax_id": hsnCodeForItem,
                        "tax_name": hsnCodeForItem,
                        "tax_value": taxAmountHsn
                    });
                }
                // Case 2: Group tax (multi-component tax_fields, no HSN)
                else if (!hasHsnCode && taxFieldsArr.length > 1) {
                    for (var g = 0; g < taxFieldsArr.length; g++) {
                        var groupField = taxFieldsArr[g];
                        var groupAmount = (priceAmount / 100) * groupField.tax_value;
                        var groupRawId = groupField.tax_id || '';
                        var groupId = (groupRawId && (groupRawId.$oid || groupRawId)) || '';
                        itemTaxDetails.push({
                            "tax_id": groupId,
                            "tax_name": groupField.tax_name || '',
                            "tax_value": groupAmount
                        });
                    }
                }
                // Else: simple percentage-only tax (no HSN, no group)
                // => do not push anything so Tax Details stays hidden.
            }

        }
        var taxItemData = PosnicPro.nestedTaxCalculation(itemTaxDetails);
        $(taxItemData).each(function (key, val) {
            if ((val.amount).toFixed(2) > 0.00) {
                var rowHTMLTaxLine = ' <tr> ' +
                    '    <td style="display:none;">' + val.tax_id + '</td>' +
                    '    <td>' + val.tax_name + '</td>' +
                    '    <td>' + currency + '&nbsp;<span class="number">' + val.amount + '</span> </td>' +
                    '</tr>';
            }
            $('#detailed_sale_item_tax tbody').append(rowHTMLTaxLine);
        });

        $('.tax-print-hideshow,.percentage-print-hideshow,.hide-sales-tax,#detailed_sale_item_tax,#detailed_sale_item_gsttax').hide();
        if (data.discount > 0) {
            $('.percentage-print-hideshow').show();
            $('.sales-discount-text').number(data.discount, 2);
        }

        if (data.tax > 0) {
            $('.hide-sales-tax').show();
            $('#sale_view_tax').number(data.tax, 2);
        }

        let roundOffValue = data.round_off;
        let sign = roundOffValue >= 0 ? '+' : '-';
        if (roundOffValue !== 0) {
            let roundOff = '<td>Round Off :</td>' +
                '<td class="pull-right">' + currency + '&nbsp;(' + sign + ')<span class="number">' + Math.abs(roundOffValue).toFixed(2) + '</span></td>';
            $('#round_off_view').append(roundOff);
        }
        let extraDiscount = '';
        if (data.sale_extra_discount !== 0 && data.sale_extra_discount !== null) {
            extraDiscount = '<td>Extra Discount :</td>' +
                '<td class="pull-right">' + currency + "&nbsp;" + '-' + '<span class="number">' + data.sale_extra_discount + '</span></td>';
        }
        $('#extra_discount_view').html(extraDiscount);
        // Charges itemized on the view page too, mirroring the receipt rows
        $('.charge-view-row').remove();
        if (Array.isArray(data.charges) && data.charges.length) {
            var chargeViewRows = '';
            data.charges.forEach(function (c) {
                var cTax = Number(c.tax_amount) || 0;
                chargeViewRows += '<tr class="charge-view-row"><td>' + $('<i>').text(c.name || 'Charge').html()
                    + (cTax > 0 ? ' <small>(+' + (c.tax_name ? $('<i>').text(c.tax_name).html() : 'tax') + ' ' + cTax.toFixed(2) + ')</small>' : '')
                    + ' :</td>'
                    + '<td class="pull-right">' + currency + '&nbsp;<span class="number">' + (Number(c.amount) || 0).toFixed(2) + '</span></td></tr>';
            });
            $('#extra_discount_view').after(chargeViewRows);
        }
        $('#total_amount_view').number(data.items_total, 2);
        $('#subtotal_amount_view').number(data.items_subtotal, 2);

        /* Indian gst calculation */
        if (data.sale_process === 'Add' || data.sale_process === 'Edit' || data.sale_process === 'Hold' || data.sale_process === 'PartialReturn') {
            if (PosnicPro.local.get('gst_action') === 'enable' && data.gst === 'enable') {
                $('.indian-gstr').show();
                if (igst > 0) {
                    $('.hide-show-igst').show();
                    $('.hide-show-scgst').hide();
                    $('.sale_igst_tax_view').number(igst, 2);
                    $('#detailed_sale_item_gsttax').show();
                } else if (cgst > 0) {
                    $('.hide-show-scgst').show();
                    $('.hide-show-igst').hide();
                    $('.sale_csgst_tax_view').number(cgst, 2);
                    $('#detailed_sale_item_gsttax').show();
                } else {
                    $('.indian-gstr').hide();
                    $('#detailed_sale_item_gsttax').hide();
                }
            } else {
                $('.indian-gstr').hide();
                if ($('#detailed_sale_item_tax tbody tr').length > 0) {
                    $('#detailed_sale_item_tax').show();
                }
            }
        }

        //return item line calculation
        var length_return = data.items_return.length;
        $('.sales-return-total-count').html(length_return);
        var returnTaxDetails = [];
        var returnigst = 0;
        var returncgst = 0;
        $('#viewsale_return_print_list').remove();
        $('#viewsale_return_print_view').append('<div id="viewsale_return_print_list">');
        var app = "<div><div class='table-responsive'><table class='table table-borderless'>";
        for (var j = 0; j < length_return; j++) {
            var date = data.items_return[j].returnArray['returnDate'];
            var timeStamp_value = parseInt(date.$date.$numberLong);
            var timeZone = PosnicPro.local.get('timezone');
            var DateFormat = moment(timeStamp_value).tz(timeZone).format('YYYY/MM/DD LT');
            var updateDate = PosnicPro.convertDate(DateFormat);

            var head = '<thead><tr><td>' + (j + 1) + '</td><td><span class="text-danger">' + data.items_return[j].returnArray['returnId'] + '</span></td><td colspan="4"><span class="text-danger">' + updateDate + '</span></td><td colspan="3">' +
                '<a href="#/sales/' + data.items_return[j].returnArray['returnObjId'].$oid + '/returnprint" data-module="sales" data-access = "read" data-id="sales/' + data.items_return[j].returnArray['returnObjId'].$oid + '/returnprint" data-toggle="tooltip" title="print" class="point-cursor btn btn-success-rgba"><i class="feather icon-printer"></i></a></td></tr><tr class="row100 head">' +
                '<th></th>' +
                '<th><lang class="lang_name_title">Name </lang></th>' +
                '<th><lang class="lang_price_title">Price </lang></th>' +
                '<th><lang class="lang_qty_title">Qty </lang></th>' +
                '<th> <lang class="lang_discount_title">Discount </lang></th>' +
                '<th><lang class="lang_tax_title">Tax </lang></th>' +
                '<th class="text-right"><lang class="lang_total_title">Total </lang></th>' +
                '</tr></thead>';
            app = app + '' + head + '';


            $.each(data.items_return[j].returnArray['returnValue'], function (key, val) {
                var tax = val.tax;
                var tax_type = val.tax_type;
                if (tax_type === 'exclusive') {
                    var price = val.item_price;
                } else {
                    var price = val.item_price / ((tax / 100) + 1);
                }
                var discount = (val.item_discount > 0) ? val.item_discount : val.item_discount_percentage;
                var discountSign = (val.item_discount > 0) ? currency : '%';

                returnigst += val.igst_tax;
                returncgst += val.cgst_tax;

                if (discountSign === '%') {
                    var priceAmount = (((price.toFixed(2)) * val.item_quantity) - (((price.toFixed(2)) * val.item_quantity) * (discount / 100)));
                } else {
                    var priceAmount = (((price.toFixed(2)) * val.item_quantity) - (discount * val.item_quantity));
                }
                var returndiscount_percentage = '--';
                if (discount !== 0) {
                    if (discountSign === '%') {
                        returndiscount_percentage = '' + discount + ' ' + discountSign + '';
                    } else {
                        returndiscount_percentage = '' + discountSign + ' ' + discount + '';
                    }
                }
                var tax_percentage = '--';
                if (tax !== 0) {
                    tax_percentage = '' + tax + '%';
                }
                let item_unit = (typeof (val.item_unit) != "undefined" && val.item_unit !== null) ? val.item_unit : 'qty';
                var body = '<tbody><tr id="return_col"> ' +
                    '<td></td>' +
                    '<td width="30%">' + val.item_name + '</td>' +
                    '<td>' + currency + '&nbsp;<span class="number">' + price + '</span> </td>' +
                    '<td>' + PosnicPro.formatQuantity(val.item_quantity, item_unit) + ' ' + item_unit + '</td>' +
                    '<td>' + returndiscount_percentage + '</td>' +
                    '<td>' + tax_percentage + '</td>' +
                    '<td class="text-right">' + currency + '&nbsp;<span class="number">' + val.total_amount + '</span> </td>' +
                    '</tr></tbody>';

                app = app + '' + body + '';

                // Return item tax calculation mirrors the main item rules
                var gstActionReturn = PosnicPro.local.get('gst_action');
                var gstEnabledReturn = (gstActionReturn === 'enable' && data.gst === 'enable');

                var returnTaxFieldsArr = Array.isArray(val.tax_fields)
                    ? val.tax_fields
                    : (val.tax_fields ? [val.tax_fields] : []);
                var hasReturnTaxFields = returnTaxFieldsArr.length > 0;

                var returnHsnCode = (val.hsncode || val.hsn_code || '').toString().trim();
                var hasReturnHsn = returnHsnCode !== '';

                // Same HSN detection for return lines: if no explicit
                // hsncode/hsn_code but tax_name looks like an HSN code
                // (numeric, >= 4 digits), use that as the HSN code so Tax
                // Details can show a single HSN row when GST is disabled.
                if (!hasReturnHsn) {
                    var returnTaxName = (val.tax_name || '').toString().trim();
                    if (/^[0-9]{4,}$/.test(returnTaxName)) {
                        returnHsnCode = returnTaxName;
                        hasReturnHsn = true;
                    }
                }

                if (gstEnabledReturn && hasReturnTaxFields) {
                    var taxItemLength = returnTaxFieldsArr.length;
                    for (var y = 0; y < taxItemLength; y++) {
                        var taxItem = returnTaxFieldsArr[y];
                        var taxAmount = (priceAmount / 100) * taxItem.tax_value;
                        var rawId = taxItem.tax_id || '';
                        var taxId = (rawId && (rawId.$oid || rawId)) || '';
                        returnTaxDetails.push({
                            "tax_id": taxId,
                            "tax_name": taxItem.tax_name,
                            "tax_value": taxAmount
                        });
                    }
                } else if (!gstEnabledReturn) {
                    // GST disabled: same three-way split as main items
                    if (hasReturnHsn && val.tax > 0) {
                        var taxAmountHsnReturn = (priceAmount / 100) * val.tax;
                        returnTaxDetails.push({
                            "tax_id": returnHsnCode,
                            "tax_name": returnHsnCode,
                            "tax_value": taxAmountHsnReturn
                        });
                    } else if (!hasReturnHsn && returnTaxFieldsArr.length > 1) {
                        for (var y2 = 0; y2 < returnTaxFieldsArr.length; y2++) {
                            var rField = returnTaxFieldsArr[y2];
                            var rAmount = (priceAmount / 100) * rField.tax_value;
                            var rRawId = rField.tax_id || '';
                            var rId = (rRawId && (rRawId.$oid || rRawId)) || '';
                            returnTaxDetails.push({
                                "tax_id": rId,
                                "tax_name": rField.tax_name || '',
                                "tax_value": rAmount
                            });
                        }
                    }
                    // Else: simple return tax (no HSN, no group) => no rows
                }

            });

        }
        app = app + '</table></div></div>';
        $('#viewsale_return_print_view').append(app);

        var returnItemData = PosnicPro.nestedTaxCalculation(returnTaxDetails);
        $(returnItemData).each(function (key, val) {
            if ((val.amount).toFixed(2) > 0.00) {
                var rowHTMLTaxLine = ' <tr> ' +
                    '    <td style="display:none;">' + val.tax_id + '</td>' +
                    '    <td>' + val.tax_name + '</td>' +
                    '    <td>' + currency + '&nbsp;<span class="number">' + val.amount + '</span> </td>' +
                    '</tr>';
            }
            $('#detailed_sale_itemreturn_tax tbody').append(rowHTMLTaxLine);
        });

        $('span.number').number(true, 2);

        $('.return-percentage-print-hideshow,.hide-sale-return-tax,#detailed_sale_itemreturn_tax,#detailed_sale_itemreturn_gsttax').hide();
        if (data.return_discount > 0) {
            $('.return-percentage-print-hideshow').show();
            $('.sales-return-discount-value').number(data.return_discount, 2);
        }
        if (data.return_tax > 0) {
            $('.hide-sale-return-tax').show();
            $('#return_tax_view').number(data.return_tax, 2);
        }

        roundOffValue = data.return_round_off;
        sign = roundOffValue >= 0 ? '+' : '-';
        let roundOff = '';
        if (roundOffValue !== 0) {
            roundOff = '<td>Round Off :</td>' +
                '<td class="pull-right">' + currency + '&nbsp;(' + sign + ')<span class="number">' + Math.abs(roundOffValue).toFixed(2) + '</span></td>';
        }
        let returnExtraDiscount = '';
        if (data.return_extra_discount !== 0 && data.return_extra_discount !== null) {
            returnExtraDiscount = '<td>Extra Discount :</td>' +
                '<td class="pull-right">' + currency + '<span class="number">' + "&nbsp;" + '-' + data.return_extra_discount + '</span></td>';
        }
        $('#return_extra_discount_view').append(returnExtraDiscount);
        $('#return_round_off_view').append(roundOff);
        $('#return_total_amount_view').number(data.items_return_total, 2);
        $('#return_subtotal_amount_view').number(data.items_return_subtotal, 2);

        if (data.sale_process === 'FullReturn' || data.sale_process === 'PartialReturn') {
            /* Indian gst calculation */
            if (PosnicPro.local.get('gst_action') === 'enable' && data.gst === 'enable') {
                $('.return-indian-gstr').show();
                if (returnigst > 0) {
                    $('.hide-show-igst').show();
                    $('.hide-show-scgst').hide();
                    $('.return_igst_tax_view').number(returnigst, 2);
                    $('#detailed_sale_itemreturn_gsttax').show();
                } else if (returncgst > 0) {
                    $('.hide-show-scgst').show();
                    $('.hide-show-igst').hide();
                    $('.return_csgst_tax_view').number(returncgst, 3);
                    $('#detailed_sale_itemreturn_gsttax').show();
                } else {
                    $('.return-indian-gstr').hide();
                    $('#detailed_sale_itemreturn_gsttax').hide();
                }

            } else {
                $('.return-indian-gstr').hide();
                if ($('#detailed_sale_itemreturn_tax tbody tr').length > 0) {
                    $('#detailed_sale_itemreturn_tax').show();
                }
            }
        }
    },
    showSalesEditPage: function (id) {
        var loader = $(".loader-edit-sale");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        PosnicPro.get('sales/' + id, function (response) {
            if (response.type === 'success') {
                data = response.data;
                PosnicPro.sales.editSaleId = data._id || data.id || data.sales_document_id || id;

                // Detect dedicated KOT edit sales route (#/kotsales/{id}/edit) even
                // when the page is opened directly or via reload, and ensure the
                // internal flags reflect that we are in the KOT edit flow.
                var currentHash = (typeof window !== 'undefined' && window.location && window.location.hash)
                    ? window.location.hash
                    : '';
                var isKotEditRoute = (currentHash.indexOf('kotsales/') !== -1 && currentHash.indexOf('/edit') !== -1);

                if (isKotEditRoute) {
                    PosnicPro.sales.saleProcess = 'KOT';
                    PosnicPro.kotorder = PosnicPro.kotorder || {};
                    PosnicPro.kotorder.editSaleId = PosnicPro.sales.editSaleId;
                }
                let extra_discount_type = data.extra_discount_type;
                let extra_discount = data.extra_discount;
                $('#extraDisc').text(extra_discount);
                $('#extraDisc').editable('setValue', extra_discount);
                PosnicPro.sales.view.changeExtraDiscType(extra_discount_type);
                if (PosnicPro.local.get('inline_sale') === 'enable' || extra_discount !== 0) {
                    $('.addDisc-hide-show').show();
                } else {
                    $('.addDisc-hide-show').hide();
                    $('#extraDisc').text(0);
                    $('#extraDisc').editable('setValue', 0);
                }
                $('#extraDisc').prop('disabled', false);
                $('#extraDisc').removeClass('extraDisc');
                if (data.sale_process === 'Add' || data.sale_process === 'Edit' || data.sale_process === 'Hold' || data.sale_process === 'PartialReturn' || data.sale_process === 'KOT') {
                    $('#receiving_add_item_name,#sales_new_item_name').val('');
                    if (!(PosnicPro.sales.kotPaymentMode === true && PosnicPro.sales.paymentOnlyMode === true)) {
                        $('.page_loader,#osk-container,#clearSaleButton,.return_discount_show').hide();
                        if (PosnicPro.sales && PosnicPro.sales.syncActionTooltips) { PosnicPro.sales.syncActionTooltips(); }
                        $('.page-title-box,#sales_new_item_name,#sales_new,#closeSaleButton,.return_discount_hide').show();
                        (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') ? $('.changeSalesBtnText').text('புதுப்பி') : $('.changeSalesBtnText').text('Update');
                    }
                    // As an additional safeguard, if this edit page was reached via
                    // the dedicated KOT route (#/kotsales/{id}/edit), always show
                    // "Update" on the primary button so it never falls back to "Save".
                    if (typeof isKotEditRoute !== 'undefined' && isKotEditRoute) {
                        if (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') {
                            $('.changeSalesBtnText').text('புதுப்பி');
                        } else {
                            $('.changeSalesBtnText').text('Update');
                        }
                    }
                    $("#tax").prop('disabled', false);
                    //                    $(".changeSalesBtnText").text('Update');
                    $('#holdSaleButton').hide();

                    /*New Sales*/
                    PosnicPro.sales.recentMenu.editItems(id, response.data, 'edit');
                    loader.find(".loadingSpinner:first").remove();
                } else {
                    $('#edit_sales_' + id).css('pointer-events', 'none');
                    $('#edit_icon_' + id).addClass('sales_icons');
                    hasher.setHash('sales');
                }
            }

        });
    },
    /*For Sales Return action*/
    returnPage: function (page, id) {
        PosnicPro.sales.defaultCustomer = false;
        $('#extraDisc').text(0);
        $('#extraDisc').editable('setValue', 0);
        $('#extraDisc').prop('disabled', true);
        $('#extraDisc').addClass('extraDisc');
        $('#percentIcon, #rupeeIcon').css('pointer-events', 'none').css('opacity', '0.8');
        $("#paymentreturnhistory").hide();
        $("#sales_new_items_table tbody tr").remove();
        $('.salesBalanceAmount,#payment_id').show();
        $("#save_submit,#check_button").attr("disabled", true);
        $("#sales_new_items_table,#paymentdisplay,#return_tax,#return_disc,#return_discount").addClass("customer-display-hide");
        $("#sales_new_items_table,#paymentdisplay,#return_tax").removeClass("display-block");
        $("#refund_pay_hide,#refund_pay_total,#refund_sub_hide,#refund_sub_total").show();
        $(".save_return_submit,#sub_hide,#sub_total_hide,#pay_hide,#pay_total_hide,#show_last_created_sale").hide();
        $("#check_button,#return_button,.return_discount_show").show();
        $("#return_button").removeAttr("disabled");
        $("#items_view_hide,#holdSaleButton,.return_discount_hide").css("display", "none");
        $("#return_view_hide,#button_return").css("display", "block");
        (PosnicPro.local.get('gst_action') === 'enable') ? $('.indian-gstr').show() : $('.indian-gstr').hide();
        $('#sales_tax_return_value,.sales_discount_return_value').text("0.00");

        $('.return_sale_only_show').show();
        (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') ? $("#sales-text-change").text('திருப்பி அனுப்பிய') : $("#sales-text-change").text('Return');
        $(".return_table_head_hide").text('Returning');
        $(".sale_table_head_hide").text('Sold');
        $(".return_table_head_text").text('Cancel Return');
        $(".sale_table_head_text").text('Move to Return');
        $('.kot-save-hide').hide();
        //sold item table
        var myobj = document.getElementById("table_return_page");
        myobj.remove();
        var newDiv = document.createElement("div");
        newDiv.id = "table_return_page";
        var element = document.getElementById("table_return_page_parent");
        element.appendChild(newDiv);
        $('#sales_table').find('table').attr('id', 'sales_new_items_table');
        var sales_table = $("#sales_table").html();
        $("#table_return_page").html(sales_table);
        $("#viewtest").hide();

        //return item table
        var myobj = document.getElementById("table_sale_page");
        myobj.remove();
        var newDiv = document.createElement("div");
        newDiv.id = "table_sale_page";
        var element = document.getElementById("table_sale_page_parent");
        element.appendChild(newDiv);
        $('#return_table').find('table').attr('id', 'sales_return_items_table');
        var return_table = $("#return_table").html();
        $("#table_sale_page").html(return_table);
        $("#return_view_hide").hide();
        //call edit value load function
        PosnicPro.sales.view.showReturnSalesProcess(id);
        //remove table id
        $('#sales_table').find('table').removeAttr('id');
        $('#return_table').find('table').removeAttr('id');
        $('#time-format').addClass('commonDate');
        $('#time-format').removeClass('commonEditDate');
    },
    showReturnSalesProcess: function (id) {
        var loader = $(".loader-return-sale");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        PosnicPro.get('sales/' + id, function (response) {
            if (response.type === 'success') {
                data = response.data;

                // For returns we always work with the resolved currency
                // extra discount amount stored in sale_extra_discount.
                // This is already the final rupee value regardless of
                // whether the original discount was a percentage or a
                // fixed amount.
                var rawSalesTotal = (parseFloat(data.sales_total || 0) || 0);
                var rawRoundOff = (parseFloat(data.sales_round_off || 0) || 0);
                var extraDiscountType = (data.extra_discount_type || '').toString().toLowerCase();
                var extraDiscountInput = (data.extra_discount !== null && data.extra_discount !== undefined)
                    ? parseFloat(data.extra_discount)
                    : 0;
                var saleExtraDiscountAmount = (data.sale_extra_discount !== null && data.sale_extra_discount !== undefined)
                    ? parseFloat(data.sale_extra_discount)
                    : 0;

                var absoluteSaleExtraDiscount = !isNaN(saleExtraDiscountAmount) ? saleExtraDiscountAmount : 0;
                if (absoluteSaleExtraDiscount === 0 && !isNaN(extraDiscountInput) && extraDiscountInput !== 0) {
                    if (extraDiscountType === 'percent') {
                        var itemsAfterExtra = rawSalesTotal - rawRoundOff;
                        if (itemsAfterExtra > 0) {
                            var rate = extraDiscountInput / 100;
                            var baseBeforeExtra = itemsAfterExtra / (1 - rate);
                            absoluteSaleExtraDiscount = baseBeforeExtra - itemsAfterExtra;
                        }
                    } else {
                        absoluteSaleExtraDiscount = extraDiscountInput;
                    }
                }
                if (isNaN(absoluteSaleExtraDiscount)) {
                    absoluteSaleExtraDiscount = 0;
                }

                var baseSalesTotal = rawSalesTotal + absoluteSaleExtraDiscount - rawRoundOff;

                var saleExtraValueForReturn;
                if (extraDiscountType === 'percent') {
                    if (!isNaN(extraDiscountInput) && extraDiscountInput !== 0) {
                        saleExtraValueForReturn = extraDiscountInput;
                    } else if (baseSalesTotal > 0 && absoluteSaleExtraDiscount > 0) {
                        saleExtraValueForReturn = (absoluteSaleExtraDiscount / baseSalesTotal) * 100;
                    } else {
                        saleExtraValueForReturn = 0;
                    }
                } else {
                    saleExtraValueForReturn = absoluteSaleExtraDiscount;
                }

                PosnicPro.sales.extraDiscount = {
                    sales_total: baseSalesTotal,
                    sale_extra_discount: saleExtraValueForReturn,
                    extra_discount_type: extraDiscountType,
                    sales_round_off: rawRoundOff
                };

                // Populate the (read-only) Extra Discount field on the
                // return summary with the original sale's extra discount
                // value so that users immediately see it when opening the
                // Return screen. For amount-based discounts we display the
                // resolved rupee amount; for percentage discounts we show
                // the percentage.
                var uiExtraDiscount;
                if (extraDiscountType === 'percent') {
                    uiExtraDiscount = saleExtraValueForReturn;
                } else {
                    uiExtraDiscount = absoluteSaleExtraDiscount;
                }
                if (!isNaN(uiExtraDiscount) && uiExtraDiscount !== 0) {
                    var uiExtraFormatted = Number(uiExtraDiscount).toFixed(2);
                    $('#extraDisc').text(uiExtraFormatted);
                    $('#extraDisc').editable('setValue', uiExtraFormatted);
                }

                if (absoluteSaleExtraDiscount !== 0) {
                    $('.addDisc-hide-show').show();
                } else {
                    $('.addDisc-hide-show').hide();
                    $('#extraDisc').text(0);
                    $('#extraDisc').editable('setValue', 0);
                }
                if (data.discount_amount > 0) {
                    $('#salesReturnSign').html('$');
                    $("#sales_return_discountpercent").html(data.discount_amount);
                } else {
                    $('#salesReturnSign').html('%');
                    $("#sales_return_discountpercent").html(data.discount);
                }

                if (data.partial_check === 'true') {
                    $("#paymentreturnhistory").show();
                    $('.payreturntext').html(data.payment_mode);
                    $('.duebalance').number(data.payment_pending, 2);
                    let amount = data.wallet_amount - data.partial_balance;
                    let strAmount = amount.toString();
                    let amounts = strAmount.replace(/([-])+/g, '');
                    $('.payreturnamount').number(amounts, 2);
                    $('.walletreturnamount').number(data.wallet_amount, 2);
                }

                if (data.sale_process === 'Add' || data.sale_process === 'PartialReturn' || data.sale_process === 'FullReturn' || data.sale_process === 'Edit') {
                    $('#receiving_add_item_name,#sales_new_item_name').val('');
                    $('.page_loader,#osk-container,#clearSaleButton').hide();
                        if (PosnicPro.sales && PosnicPro.sales.syncActionTooltips) { PosnicPro.sales.syncActionTooltips(); }
                    $('.page-title-box,#sales_new,#closeSaleButton').show();
                    /*New Sales*/
                    $('.payment_mode').val(data.payment_mode);
                    $('.payment_mode').attr('checked', false);
                    $('.payment_detail').removeClass('active');
                    if (data.payment_mode && data.payment_mode.trim() !== '') {
                        var selectorId = '#' + data.payment_mode.trim();
                        $(selectorId).val(data.payment_mode).attr('checked', 'checked');
                        $('.' + data.payment_mode.trim() + '_active').addClass('active');
                    }
                    $('#sales_new_item_name').focus();
                    PosnicPro.sales.recentMenu.editItems(id, response.data, 'return');
                    $('#sales_returned_table tbody').html('');
                    $('#sale_return_view_table').html('');
                    $('#sale_return_view_list').remove();
                    $('#sale_return_view_table').append('<div id="sale_return_view_list">');
                    var currency = PosnicPro.local.get('currencySign');
                    (response.data.items_return.length !== 0) ? $('#show-sale-already-return-table').show() : $('#show-sale-already-return-table').hide();
                    var app = "<div><h4 class='text-center' style='display:none;' id='show-sale-already-return-table'>Already Returned</h4><div class='table-responsive'><table id='table_return_item_length' class='table style='background:#f3f5fd;'>";
                    let returnTotal = 0.00;
                    let returnRoundOff = 0.00;
                    let returnExtraDiscount = 0.00;
                    for (var i = 0; i < response.data.items_return.length; i++) {
                        var date = response.data.items_return[i].returnArray['returnDate'];
                        var timeStamp_value = parseInt(date.$date.$numberLong);
                        var timeZone = PosnicPro.local.get('timezone');
                        var DateFormat = moment(timeStamp_value).tz(timeZone).format('YYYY/MM/DD LT');
                        var updateDate = PosnicPro.convertDate(DateFormat);
                        var head = '<thead><tr><td colspan="7"></td></tr><tr style="background:#e1e6f5;">' +
                            '<td>' + (i + 1) + '</td><td colspan="3"><span class="text-danger">' + response.data.items_return[i].returnArray['returnId'] + '</span></td><td colspan="3"><span class="text-danger">' + updateDate + '</span></td></tr>' +
                            '<tr><th class="text-left"><lang class="lang_name_title">Name </lang></th>' +
                            '<th class="text-right"><lang class="lang_price_title">Price </lang></th>' +
                            '<th class="text-center"><lang class="lang_qty_title">Qty </lang></th>' +
                            '<th class="text-center"> <lang class="lang_discount_title">Discount </lang></th>' +
                            '<th class="text-center"><lang class="lang_tax_title">Tax </lang></th>' +
                            '<th class="text-right"><lang class="lang_total_title">Total </lang></th>' +
                            '</tr></thead>';
                        app = app + '' + head + '';
                        var total = 0, priceValue = 0, discountTotal = 0, priceAmount = 0;
                        returnRoundOff = response.data.items_return[i].returnArray.roundOff;
                        returnExtraDiscount = response.data.items_return[i].returnArray.extraDiscount;
                        returnTotal = response.data.items_return[i].returnArray.itemsTotalAmount;
                        $.each(response.data.items_return[i].returnArray['returnValue'], function (key, val) {
                            total += val.total_amount;

                            var addSalesLineDiscount = (val.item_discount > 0) ? val.item_discount : val.item_discount_percentage;
                            var discountSign = (val.item_discount > 0) ? currency : '%';
                            var tax_type = val.tax_type;
                            var taxTypeText;
                            if (tax_type === 'exclusive') {
                                taxTypeText = "Exc";
                                var price = val.item_price;
                            } else {
                                taxTypeText = "Inc";
                                var price = val.item_price / ((val.tax / 100) + 1);
                            }
                            priceValue += (price * val.item_quantity);

                            var discount_percentage = '--';
                            if (addSalesLineDiscount !== 0) {
                                if (discountSign === '%') {
                                    discount_percentage = '' + addSalesLineDiscount + ' ' + discountSign + '';
                                    priceAmount += (((price.toFixed(2)) * val.item_quantity) - (((price.toFixed(2)) * val.item_quantity) * (addSalesLineDiscount / 100)));
                                    discountTotal += (((price.toFixed(2)) * val.item_quantity) * (addSalesLineDiscount / 100));
                                } else {
                                    discount_percentage = '' + discountSign + ' ' + addSalesLineDiscount + '';
                                    priceAmount += (((price.toFixed(2)) * val.item_quantity) - (addSalesLineDiscount * val.item_quantity));
                                    discountTotal += (addSalesLineDiscount * val.item_quantity);
                                }
                            }
                            var tax = '--';
                            if (val.tax !== 0) {
                                tax = '' + val.tax + '%';
                            }
                            var body = '<tbody><tr>' +
                                '    <td  class="text-left" width="30%">' + val.item_name + '</td>' +
                                '    <td class="text-right">' + currency + '&nbsp;<span class="number">' + price.toFixed(2) + '</span></td>' +
                                '    <td class="text-center">' + val.item_quantity + '</td>' +
                                '    <td class="text-center">' + discount_percentage + '</td>' +
                                '    <td class="text-center">' + tax + '</td>' +
                                '    <td class="text-right">' + currency + '&nbsp;<span class="number">' + val.total_amount.toFixed(2) + '</span></td>' +
                                '</tr></tbody>';

                            app = app + '' + body + '';
                            $('table#sales_return_items_table tr#sales_new_tablerow_content_area').remove();
                        });
                        let returnViewRoundOff = (returnRoundOff !== 0) ? returnRoundOff : 0.00;
                        let returnViewExtraDiscount = (returnExtraDiscount !== 0) ? returnExtraDiscount : 0.00;
                        let sign = returnViewRoundOff >= 0 ? '(+)' : '(-)';
                        let returnViewTotal = (returnTotal !== 0) ? returnTotal : total;
                        var foot = '<tbody><tr>' +
                            '<td colspan="5"><span class="pull-right"><b>Sub Total</b></span></td><td colspan="2"><span class="pull-right"><b>' + currency + '&nbsp;' + priceValue.toFixed(2) + '</b></span></td></tr>' +
                            '<tr><td colspan="5"><span class="pull-right"><b>Discount Amount</b></span></td><td colspan="2"><span class="pull-right">-<b>' + currency + '&nbsp;' + discountTotal.toFixed(2) + '</b></span></td>' +
                            '<tr><td colspan="5"><span class="pull-right"><b>Tax Amount</b></span></td><td colspan="2"><span class="pull-right"><b>' + currency + '&nbsp;' + (total - (priceValue - discountTotal)).toFixed(2) + '</b></span></td>' +
                            '<tr><td colspan="5"><span class="pull-right"><b>Round Off</b></span></td><td colspan="2"><span class="pull-right"><b>' + currency + '&nbsp;' + sign + '&nbsp;' + Math.abs(returnViewRoundOff).toFixed(2) + '</b></span></td>' +
                            '<tr><td colspan="5"><span class="pull-right"><b>Extra Discount</b></span></td><td colspan="2"><span class="pull-right"><b>' + currency + '&nbsp;' + Math.abs(returnViewExtraDiscount).toFixed(2) + '</b></span></td>' +
                            '<tr><td colspan="5"><span class="pull-right"><b>Grand Total</b></span></td><td colspan="2"><span class="pull-right"><b>' + currency + '&nbsp;' + returnViewTotal.toFixed(2) + '</b></span></td>' +
                            '</tr><tr><td colspan="7"></td></tr></tbody>';
                        app = app + '' + foot + '';
                    }
                    app = app + '</table></div></div>';
                    $('#sale_return_view_list').append(app);
                    $("#sale_return_view_list").insertAfter($("#table_return_page"));
                    ($('table#table_return_item_length tbody tr').length > 0) ? $('#show-sale-already-return-table').show() : $('#show-sale-already-return-table').hide();
                    $('span.number').number(true, 2);

                    $('.sales-inline-hide').hide();
                } else {
                    $('#return_sales_' + id).css('pointer-events', 'none');
                    $('#return_icon_' + id).addClass('sales_icons');
                    hasher.setHash('sales');
                }
                $('span.number').number(true, 2);
                $("#sales_return_items_table tbody tr").remove();
                $('#sales_return_items_table tbody').append('<tr class="sales_new_tablerow_content_area" id="sales_new_tablerow_content_area"><td colspan="9"><div class="text-center text-dark"> <p class="table_cart_content"> Return Items Order Empty</p></div><img src="static/images/general/wallet.svg" class="img-fluid sales-cart-image" style="opacity: 0.4;width: 100%;" alt="wallet"></td></tr>');
                var imgHeight = $(window).height() - 500;
                $('.sales-cart-image').height(imgHeight);
                let extra_discount_type = data.extra_discount_type;
                PosnicPro.sales.view.changeExtraDiscType(extra_discount_type);
            } else {
                PosnicPro.alert(response.type, response.message);
            }
            loader.find(".loadingSpinner:first").remove();
        });
    },
    /*sold order printing process held by this function for normal sale order*/
    /*
     * Which paper this print uses. Normally the shop's Print Type setting
     * decides, but the post-sale panel can ask for one explicitly (owner:
     * "Print recept i would like to have thermal as well a4 option"), so an
     * override wins for the duration of that one print and is cleared after.
     */
    _layoutOverride: null,
    /*
     * Amount in words - a required line on an Indian tax invoice and the
     * usual defence against a hand-altered figure. Indian grouping
     * (crore / lakh / thousand), not the Western short scale, because that
     * is what the document is read against here.
     */
    _amountInWords: function (amount) {
        var n = Math.abs(Number(amount) || 0);
        var whole = Math.floor(n);
        var frac = Math.round((n - whole) * 100);
        var ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
            'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
            'Seventeen', 'Eighteen', 'Nineteen'];
        var tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
        function two(x) {
            if (x < 20) { return ones[x]; }
            return tens[Math.floor(x / 10)] + (x % 10 ? ' ' + ones[x % 10] : '');
        }
        function three(x) {
            var h = Math.floor(x / 100), r = x % 100;
            return (h ? ones[h] + ' Hundred' + (r ? ' and ' : '') : '') + (r ? two(r) : '');
        }
        function indian(x) {
            if (x === 0) { return 'Zero'; }
            var parts = [];
            var crore = Math.floor(x / 10000000); x %= 10000000;
            var lakh = Math.floor(x / 100000); x %= 100000;
            var thousand = Math.floor(x / 1000); x %= 1000;
            if (crore) { parts.push(indian(crore) + ' Crore'); }
            if (lakh) { parts.push(two(lakh) + ' Lakh'); }
            if (thousand) { parts.push(two(thousand) + ' Thousand'); }
            if (x) { parts.push(three(x)); }
            return parts.join(' ');
        }
        var out = indian(whole) + (whole === 1 ? ' Rupee' : ' Rupees');
        if (frac > 0) { out += ' and ' + two(frac) + (frac === 1 ? ' Paisa' : ' Paise'); }
        return out + ' Only';
    },
    _isA4: function () {
        if (PosnicPro.sales.view._layoutOverride) {
            return PosnicPro.sales.view._layoutOverride === 'a4';
        }
        // read the setting directly here - this IS the base case
        return typeof print_type !== 'undefined' && print_type && String(print_type.value) === 'a4';
    },
    /*
     * The receipt templates (thermal and A4) are injected into their modal
     * bodies by the Settings page. A till that never opened Settings has an
     * EMPTY A4 body, so asking for an A4 invoice printed a blank sheet -
     * the same shape of bug as the tax flag: a feature depending on a page
     * the user had no reason to visit. Fetch them on demand instead, once.
     */
    _ensurePrintTemplates: function (done) {
        var wantA4 = PosnicPro.sales.view._isA4();
        var $body = wantA4 ? $('.print-modal-a4-body') : $('.print-modal-body');
        if ($.trim($body.html() || '').length > 0) { done(); return; }
        var branchId = PosnicPro.local.get('branch_id_set');
        PosnicPro.get({ url: 'branches/getOneStore', data: 'id=' + branchId }, function (r) {
            var d = (r && r.data) || {};
            if (wantA4) {
                $('.import-print').html(d.regular_body_print || d.print_a4html || '');
            } else {
                $('.import-standard-print').html(d.thermal_body_print || d.print_standard_html || '');
            }
            done();
        }, function () { done(); /* print what we have rather than nothing */ });
    },
    printSale: function (id, name, isKotHistoryPrint, layoutOverride) {
        PosnicPro.sales.view._layoutOverride =
            (layoutOverride === 'a4' || layoutOverride === 'standard') ? layoutOverride : null;
        /* The PAPER has to follow the same choice. printView resolves the page
           size and stylesheet from the shop setting, so picking A4 content
           without this printed the invoice onto an 80mm thermal page. */
        PosnicPro._printTypeOverride = PosnicPro.sales.view._layoutOverride;

        $('.Hide-Disc').show();
        $('.gst-text-value,.print_igst_tax_view,.cgst-text-value,.print_csgst_tax_view').html('');

        PosnicPro.get('sales/' + id, function (response) {
            // A failed lookup used to end here in silence, so pressing Print
            // Receipt appeared to do nothing at all. Say what went wrong.
            if (!response || response.type !== 'success') {
                var reason = (response && response.message)
                    ? response.message
                    : 'Could not load this sale to print. Check that you are still signed in, then try again.';
                if (PosnicPro.alert) PosnicPro.alert('error', reason);
                console.error('[print] sales/' + id + ' failed:', response);
                // a print that never happened must not leave its paper choice
                // behind - otherwise every later receipt inherits it
                PosnicPro._printTypeOverride = null;
                PosnicPro.sales.view._layoutOverride = null;
                return;
            }
            if (response.type === 'success') {
                var data = response.data;
                var isKotPrint = !!isKotHistoryPrint;
                $('#receipt_wrapper').removeClass('receipt_small receipt_medium receipt_large receipt_extra_large');
                let print_size = PosnicPro.local.get('printing_size');
                $('#receipt_wrapper').addClass(print_size);
                $('.print_store_address').html(data.printing_address);
                var branchGstin = (data.branch_gstin_number || '').toString().trim();
                $('.print_store_gst').html(branchGstin);
                if (branchGstin) {
                    $('.gst_hide_show').show();
                } else {
                    $('.gst_hide_show').hide();
                }

                var $a4Body = $('.print-modal-a4-body');
                if ($a4Body.length) {
                    var $a4GstSpan = $a4Body.find('.print_store_gst');
                    if (!$a4GstSpan.length && branchGstin) {
                        var $addrCell = $a4Body.find('.print_store_address').closest('td');
                        if ($addrCell.length) {
                            $addrCell.append('<br><span class="gst_hide_show">GSTIN: <span class="print_store_gst"></span></span>');
                            $a4GstSpan = $a4Body.find('.print_store_gst');
                        }
                    }
                    if ($a4GstSpan.length) {
                        $a4GstSpan.html(branchGstin);
                        var $a4GstContainer = $a4Body.find('.gst_hide_show');
                        if (branchGstin) {
                            $a4GstContainer.show();
                        } else {
                            $a4GstContainer.hide();
                        }
                    }
                }
                PosnicPro.record_id = $(id).data('id');
                var currency = PosnicPro.local.get('currencySign');
                $('.tax-print-hideshow,.amount-print-hideshow,.print-payment-status-hide').hide();

                // Determine whether current print is A4 or thermal (standard) layout
                var isA4Layout = PosnicPro.sales.view._isA4();

                // Reset thermal-only partial payment rows on every print
                $('.thermal-partial-row').hide();

                // For normal (non-KOT History) prints, keep original partial-payment handling.
                // KOT History prints skip this so payment details stay hidden.
                if (!isKotPrint && data.partial_check === 'true' && data.sale_process !== 'PartialReturn' && data.sale_process !== 'FullReturn') {
                    // NOTE: This block matches the original behavior for this section.
                    $('.print-payment-status-hide').hide();
                    $('.print-payment-balance').html(currency + '&nbsp;' + data.partial_balance.toFixed(2));
                    $('.print-payment-pending').html(currency + '&nbsp;' + data.payment_pending.toFixed(2));
                    $('.print-payment-status').html(data.payment_status);

                    // Thermal (non-A4) receipts: show compact Payments/Credits and Balance Due
                    // rows in the footer, mirroring the A4 invoice behaviour.
                    if (!isA4Layout) {
                        $('.thermal-partial-row').show();
                    }
                }
                let extraDisValue = data.sale_extra_discount !== null ? data.sale_extra_discount : 0;
                let extraDiscPrintView = '';
                let extraDiscStandardPrint = '';
                if (extraDisValue !== 0) {
                    extraDiscPrintView =
                        '<td class="print-deatils-size-family print-footer-align"> Extra-Discount:  &nbsp; &nbsp; </td>' +
                        '<td class="print-deatils-size-family print-footer-align">' +
                        currency + '&nbsp; - <span class="number">' + extraDisValue + '</span></td>';
                    extraDiscStandardPrint =
                        '<div class="col-md-8 col-sm-8 col-xs-6">' +
                        '<div class="invoice-footer-value">Extra-Disc</div>' +
                        '</div>' +
                        '<div class="col-md-4 col-sm-4 col-xs-6">' +
                        '<div class="invoice-footer-value invoice-payment text-dark">' + currency + " &nbsp;" + '-' + extraDisValue + '</div>' +
                        '</div>';
                }
                $('#extra_disc_print_view').html(extraDiscPrintView);
                $('#extra_disc_standard_print').html(extraDiscStandardPrint);
                // Charge rows on the receipt (queue #6): every named charge
                // prints as its own footer row, after the discount row and
                // before Round-Off - with its tax when it carries one.
                // Inserted as SIBLINGS (the containers are single rows) and
                // swept first so a reprint can never stack duplicates.
                $('.charge-print-row, .charge-print-row-std').remove();
                if (name === 'sale' && Array.isArray(data.charges) && data.charges.length) {
                    var chargesA4 = '';
                    var chargesStd = '';
                    data.charges.forEach(function (c) {
                        var cName = $('<i>').text(c.name || 'Charge').html();
                        var cAmt = (Number(c.amount) || 0).toFixed(2);
                        var cTax = Number(c.tax_amount) || 0;
                        var taxNote = cTax > 0
                            ? ' <small>(+' + (c.tax_name ? $('<i>').text(c.tax_name).html() : 'tax') + ' ' + cTax.toFixed(2) + ')</small>'
                            : '';
                        chargesA4 += '<tr class="charge-print-row">' +
                            '<td class="print-deatils-size-family print-footer-align">' + cName + ':' + taxNote + ' &nbsp; &nbsp; </td>' +
                            '<td class="print-deatils-size-family print-footer-align">' + currency + '&nbsp;<span class="number">' + cAmt + '</span></td></tr>';
                        chargesStd += '<div class="row charge-print-row-std">' +
                            '<div class="col-md-8 col-sm-8 col-xs-6"><div class="invoice-footer-value">' + cName + taxNote + '</div></div>' +
                            '<div class="col-md-4 col-sm-4 col-xs-6"><div class="invoice-footer-value invoice-payment text-dark">' + currency + '&nbsp;' + cAmt + '</div></div></div>';
                    });
                    $('#extra_disc_print_view').after(chargesA4);
                    $('#extra_disc_standard_print').after(chargesStd);
                }
                if (name === 'sale') {
                    var subtotal = data.items_subtotal;
                    var salesLineTotal = Number(data.items_total).toFixed(2);
                    $('.round-off-hideshow').hide();
                    let roundOffValue = data.round_off;
                    let sign = roundOffValue >= 0 ? '+' : '-';
                    let roundOff = '';
                    let roundOffStandardPrint = '';
                    if (roundOffValue !== 0) {
                        $('.round-off-hideshow').show();
                        roundOff =
                            '<td class="print-deatils-size-family print-footer-align"> Round-Off: &nbsp; &nbsp; </td>' +
                            '<td class="print-deatils-size-family print-footer-align">' +
                            currency + '&nbsp;(' + sign + ')&nbsp;<span class="number">' + Math.abs(roundOffValue).toFixed(2) + '</span></td>';
                        roundOffStandardPrint =
                            '<div class="col-md-8 col-sm-8 col-xs-6">' +
                            '<div class="invoice-footer-value">Round-Off</div>' +
                            '</div>' +
                            '<div class="col-md-4 col-sm-4 col-xs-6">' +
                            '<div class="invoice-footer-value invoice-payment text-dark">' + currency + sign + Math.abs(roundOffValue).toFixed(2) +
                            '</div>' +
                            '</div>';
                    }
                    $('#roundoff-value').html(roundOff);
                    $('#roundoff_standard_print').html(roundOffStandardPrint);
                    $('.print-total').html('<strong>' + currency + '&nbsp;<span class="number">' + salesLineTotal + '</span></strong>');

                    if (parseFloat(data.discount) > 0) {
                        $('.amount-print-hideshow').show();
                        var discountValue = (name === 'sale') ? data.discount : data.return_discount;
                        $('.view_sales_discount').html(currency + '&nbsp;<span class="number">' + discountValue.toFixed(2) + '</span>');
                    }
                    if (parseFloat(data.tax) > 0) {
                        $('.tax-print-hideshow').show();
                        var taxValue = (name === 'sale') ? data.tax : data.return_tax;
                        $('.view_sales_tax').html(currency + ' &nbsp;<span class="number">' + taxValue.toFixed(2) + '</span>');
                    }
                } else {
                    var subtotal = data.items_return_subtotal;
                    var items_return_length = data.items_return.length;
                    let extraDisValue = 0;
                    let roundOffValue = 0;
                    let salesReturnLineTotal = 0;
                    for (var k = 0; k < items_return_length; k++) {
                        roundOffValue += data.items_return[k].returnArray.roundOff;
                        extraDisValue += data.items_return[k].returnArray.extraDiscount;
                        salesReturnLineTotal += data.items_return[k].returnArray.itemsTotalAmount;
                    }
                    let extraDiscPrintView = '';
                    let extraDiscStandardPrint = '';
                    if (extraDisValue !== 0) {
                        extraDiscPrintView =
                            '<td class="print-deatils-size-family print-footer-align"> Extra-Discount:     </td>' +
                            '<td class="print-deatils-size-family print-footer-align">' +
                            currency + '&nbsp; - <span class="number">' + extraDisValue + '</span></td>';
                        extraDiscStandardPrint =
                            '<div class="col-md-8 col-sm-8 col-xs-6">' +
                            '<div class="invoice-footer-value">Extra-Disc</div>' +
                            '</div>' +
                            '<div class="col-md-4 col-sm-4 col-xs-6">' +
                            '<div class="invoice-footer-value invoice-payment text-dark">' + currency + " &nbsp;" + '-' + extraDisValue + '</div>' +
                            '</div>';
                    }
                    $('#extra_disc_print_view').html(extraDiscPrintView);
                    $('#extra_disc_standard_print').html(extraDiscStandardPrint);
                    let sign = roundOffValue >= 0 ? '+' : '-';
                    let roundOff = '';
                    let roundOffStandardPrint = '';
                    if (roundOffValue !== 0) {
                        $('.round-off-hideshow').show();
                        roundOff =
                            '<td class="print-deatils-size-family print-footer-align"> Round-Off: &nbsp; &nbsp; </td>' +
                            '<td class="print-deatils-size-family print-footer-align">' +
                            currency + '&nbsp;(' + sign + ')&nbsp;<span class="number">' + Math.abs(roundOffValue).toFixed(2) + '</span></td>';
                        roundOffStandardPrint =
                            '<div class="col-md-8 col-sm-8 col-xs-6">' +
                            '<div class="invoice-footer-value">Round-Off</div>' +
                            '</div>' +
                            '<div class="col-md-4 col-sm-4 col-xs-6">' +
                            '<div class="invoice-footer-value invoice-payment text-dark">' + currency + sign + Math.abs(roundOffValue).toFixed(2) + '</div>' +
                            '</div>';
                    }
                    $('#roundoff-value').html(roundOff);
                    $('#roundoff_standard_print').html(roundOffStandardPrint);
                    $('.print-total').html('<strong>' + currency + '&nbsp;<span class="number">' + salesReturnLineTotal + '</span></strong>');

                    if (parseFloat(data.return_discount) > 0) {
                        $('.amount-print-hideshow').show();
                        var discountValue = (name === 'sale') ? data.discount : data.return_discount;
                        $('.view_sales_discount').html(currency + '&nbsp;<span class="number">' + discountValue.toFixed(2) + '</span>');
                    }

                    if (parseFloat(data.return_tax) > 0) {
                        $('.tax-print-hideshow').show();
                        var taxValue = (name === 'sale') ? data.tax : data.return_tax;
                        $('.view_sales_tax').html(currency + ' &nbsp;<span class="number">' + taxValue.toFixed(2) + '</span>');
                    }
                }
                $('.print-subtotal').html(currency + '&nbsp;<span class="number">' + subtotal.toFixed(2) + '</span>');


                $('.print_view_id').html('#' + data.sales_id);
                $('.barcodeValue').val(data.sales_id);

                // === Payment Method for printed receipt (with multi-payment support) ===
                var paymentModeDisplay = (data.payment_mode || '').toString().trim() || 'N/A';
                if (isKotPrint) {
                    // Hide payment mode line for KOT prints
                    $('.print-invoice-payment-mode').text('');
                } else {
                    var multiPaymentPrint = data.multi_payment;

                    // If backend sent multi_payment as JSON string, try to parse it
                    if (typeof multiPaymentPrint === 'string' && multiPaymentPrint.trim() !== '') {
                        try {
                            var trimmedMp = multiPaymentPrint.trim();
                            if (trimmedMp.charAt(0) === '{' || trimmedMp.charAt(0) === '[') {
                                multiPaymentPrint = JSON.parse(trimmedMp);
                            }
                        } catch (e) {
                            multiPaymentPrint = null;
                        }
                    }

                    // Build HTML rows so method is on the left and amount (with currency) is right-aligned
                    var paymentHtml = '';
                    if (multiPaymentPrint && typeof multiPaymentPrint === 'object' && Object.keys(multiPaymentPrint).length > 0) {
                        $.each(multiPaymentPrint, function (method, amount) {
                            var num = parseFloat(amount);
                            if (!isNaN(num) && num !== 0) {
                                paymentHtml += '<div class="payment-line">' +
                                    '<span class="payment-method">- ' + method + '</span>' +
                                    '<span class="payment-amount">' + currency + ' ' + num.toFixed(2) + '</span>' +
                                '</div>';
                            }
                        });
                    }

                    // If multi_payment is not present (multi-payment disabled),
                    // fall back to a single line based on payment_mode and grand total.
                    if (!paymentHtml) {
                        var singleModePrint = paymentModeDisplay;
                        var grandTotalPrint = (typeof data.items_total !== 'undefined') ? parseFloat(data.items_total) : NaN;
                        if (singleModePrint && !isNaN(grandTotalPrint) && grandTotalPrint !== 0) {
                            paymentHtml = '<div class="payment-line">' +
                                '<span class="payment-method">- ' + singleModePrint + '</span>' +
                                '<span class="payment-amount">' + currency + ' ' + grandTotalPrint.toFixed(2) + '</span>' +
                                '</div>';
                        }
                    }

                    if (paymentHtml) {
                        // Use HTML so we can align method and amount like the receipt sample
                        $('.print-invoice-payment-mode').html(paymentHtml);
                    } else {
                        // Fallback: names only if we still could not resolve an amount
                        $('.print-invoice-payment-mode').text(paymentModeDisplay);
                    }

                    // Mark the payment block row so it can be styled (centered with lines)
                    var $printContainer = PosnicPro.sales.view._isA4()
                        ? $(".print-modal-a4-body")
                        : $(".print-modal-body");
                    var $paymentRow = $printContainer.find('.print-invoice-payment-mode').closest('.row');
                    if (!$paymentRow.length) {
                        $paymentRow = $printContainer.find('.print-invoice-payment-mode').closest('tr');
                    }
                    $paymentRow.addClass('print-payment-block-wrapper');

                    // For thermal (non-A4) receipts: replace any existing label with a single centred "Payment" heading
                    var isA4Layout = $printContainer.hasClass('print-modal-a4-body');
                    if (!isA4Layout && $paymentRow.length) {
                        // Remove any element in this row whose visible text resolves to just "Payment"
                        // (case-insensitive), allowing for trailing punctuation like ':' or '-' so that
                        // variants such as "Payment:", "Payment -" etc. are also caught. Do not touch
                        // our new heading or the container that holds the payment lines.
                        var $oldPaymentLabels = $paymentRow.find('*').filter(function () {
                            var $el = $(this);
                            if ($el.is('.print-payment-heading') || $el.find('.print-invoice-payment-mode').length) {
                                return false;
                            }
                            var text = $.trim($el.text()).toLowerCase();
                            // Strip common trailing punctuation (colon, hyphen) and whitespace
                            text = text.replace(/[:\-]+$/, '').trim();
                            return text === 'payment';
                        });
                        $oldPaymentLabels.remove();

                        // Insert our own centred heading just above the payment lines (only once)
                        var $paymentContainer = $paymentRow.find('.print-invoice-payment-mode').first();
                        if ($paymentContainer.length && !$paymentContainer.prev('.print-payment-heading').length) {
                            $('<div class="print-payment-heading">Payment</div>').insertBefore($paymentContainer);
                        }
                    }
                }
                /*
                 * A4 is an INVOICE, not a till slip, and the two have different
                 * rules. "Print customer details" is a sensible thing to switch
                 * off for a thermal roll handed to a walk-in - but an invoice
                 * without a buyer on it is not an invoice, so A4 always carries
                 * the customer when the sale has one. Under Indian GST it is
                 * also headed TAX INVOICE rather than Sales Receipt, which is
                 * the wording the law expects.
                 */
                var _isInvoice = PosnicPro.sales.view._isA4();
                var _hasCustomer = $.trim(data.customer_name || '') !== '';
                $('.hide_customer_details').hide();
                if (data.customer_print === true || (_isInvoice && _hasCustomer)) {
                    $('.hide_customer_details').show();
                    $('.print-custom-title').html(_isInvoice ? 'Bill To' : 'Customer Details');
                    $('.print-name').html(data.customer_name);
                    $('.print-phone').html(data.customer_phone);
                    $('.print-email').html(data.customer_email);
                    $('.print-address').html(data.customer_address);
                }


                // Thermal & A4 print: show table number, order type and payment status with conditional hide
                var isA4Print = PosnicPro.sales.view._isA4();
                var tableNumber = (data.table_number || '').toString().trim();
                var orderType = (data.dine_type || '').toString().trim();
                var paymentStatus = (typeof (data.payment_status) === 'undefined' || data.payment_status === null)
                    ? 'Paid'
                    : data.payment_status.toString().trim();
                var paymentMode = (data.payment_mode || '').toString().trim();

                if (!orderType && tableNumber) {
                    orderType = 'Dine-in';
                }

                // Remove any previously injected rows before adding new ones (A4-specific helpers)
                $('.print-table-number-row').remove();
                $('.print-order-type-row').remove();
                $('.print-payment-status-inline').remove();
                $('.thermal-payment-type-row').remove();
                $('.thermal-payment-status-row').remove();

                // Resolve status text once and keep underlying span updated for all layouts
                var statusText = paymentStatus || 'Paid';
                if (isKotPrint) {
                    // Do not show inline payment status for KOT prints
                    $('.print-payment-status').html('');
                } else {
                    $('.print-payment-status').html(statusText);
                }
                if (!isA4Print) {
                    // ===== THERMAL / STANDARD LAYOUT =====
                    // Place Table and Order Type just under #SID in the header, centered.
                    var $printId = $('.print_view_id');
                    if ($printId.length) {
                        if (tableNumber) {
                            $printId.after('<div class="print-table-number-row" style="text-align:center;"><strong>Table - <span class="print-table-number">' + tableNumber + '</span></strong></div>');
                        }

                        if (orderType) {
                            var $insertAfter = tableNumber ? $('.print-table-number-row') : $printId;
                            $insertAfter.after('<div class="print-order-type-row" style="text-align:center;"><span class="print-order-type">' + orderType + '</span></div>');
                        }
                    }
                } else {
                    // ===== A4 (REGULAR) LAYOUT =====
                    // 1) Header: place Table and Order Type just under #SID in the header, right aligned.
                    var $a4PrintId = $('.print_view_id');
                    if ($a4PrintId.length) {
                        if (tableNumber) {
                            $a4PrintId.after('<span class="print-table-number-row" style="font-weight:bold; font-size:12px; display:block; text-align:right;">Table - <span class="print-table-number">' + tableNumber + '</span></span>');
                        }
                        if (orderType) {
                            var orderHtml = '<span class="print-order-type-row" style="font-size:12px; display:block; text-align:right;">' + orderType + '</span>';
                            var $insertAfterA4 = tableNumber ? $('.print-table-number-row') : $a4PrintId;
                            $insertAfterA4.after(orderHtml);
                        }
                    }
                }

                let sales_description = data.sales_description;
                if (data.print_sale_notes === true && $.trim(sales_description).length !== 0) {
                    $('.print-sale-notes-hide').show();
                    $('.print-sale-notes').html(sales_description);
                } else {
                    $('.print-sale-notes-hide').hide();
                }

                // Resolve store logo for the receipt in a CSP-friendly way.
                if (data.print_logoimg === true) {
                    var logoPath = '';

                    // 1) Prefer logo coming from backend sale/branch data
                    if (data.logo && $.trim(data.logo) !== '' && data.logo !== 'store.png') {
                        logoPath = data.logo;
                    } else {
                        // 2) Fallback to logo stored in localStorage
                        var storedLogo = PosnicPro.local.get('branchimage');
                        if (storedLogo && $.trim(storedLogo) !== '' && storedLogo !== 'store.png') {
                            logoPath = storedLogo;
                        }
                    }

                    // 3) If the logo path points to a local API host such as
                    // http://localhost:5000 (which is often blocked by the
                    // dashboard's Content Security Policy when the frontend is
                    // hosted elsewhere), treat it as unsafe for printing and
                    // fall back to the bundled default image instead.
                    if (logoPath && logoPath.indexOf('http://localhost:5000/') === 0) {
                        logoPath = '';
                    }

                    // 4) Final fallback to bundled default image if no valid logo
                    // path is available from backend or local storage.
                    if (!logoPath || logoPath === 'store.png') {
                        logoPath = 'static/images/default/store.png';
                    }

                    $(".branch_image").css("display", "block");
                    $('#printlogoimage img').attr('src', logoPath);
                } else {
                    $(".branch_image").css("display", "none");
                }
                if (data.tax > 0) {
                    $('.heading-tax-name').show();
                    $('.tax_print_hide').show();
                } else {
                    $('.heading-tax-name').hide();
                    $('.tax_print_hide').hide();
                }
                PosnicPro.printBarcode();
                var length = data.items.length;
                var length_return = data.items_return.length;
                var itemTotalQty = 0;
                var itemTotalTax = 0;
                $('.print-invoice-a4-table-content tbody').children("tr").remove();
                $('#tax_print_hide tbody').children("tr").remove();
                $('.print-invoice-table-content').html('');
                $('.hide-receiving-print').show();
                var itemPrintTaxDetails = [];
                if (name === 'sale') {
                    $('.print-title').html(PosnicPro.local.get('sale_title'));
                    // set AFTER sale_title, which would otherwise overwrite it
                    if (PosnicPro.sales.view._isA4()
                        && (branchGstin || PosnicPro.local.get('gst_action') === 'enable')) {
                        $('.print-title').html(
                            '<span style="font-size:16px !important; font-weight:900; letter-spacing:1px;">TAX INVOICE</span>'
                        );
                    }
                    $('.print_date').text(data.created_date);
                    if (PosnicPro.sales.view._isA4()) {
                        var rowHTMLTaxLine;
                        var igst = 0;
                        var cgst = 0;
                        var taxText = [];
                        var taxCgstText = [];
                        for (var i = 0; i < length; i++) {
                            var tax = data.items[i].tax;
                            var tax_type = data.items[i].tax_type;
                            if (tax_type === 'exclusive') {
                                var price = data.items[i].item_price;
                            } else {
                                var price = data.items[i].item_price / ((tax / 100) + 1);
                            }
                            var discount = (data.items[i].item_discount > 0) ? data.items[i].item_discount : data.items[i].item_discount_percentage;
                            var discountSign = (data.items[i].item_discount > 0) ? currency : '%';

                            igst += data.items[i].igst_tax;
                            cgst += data.items[i].cgst_tax;

                            if (discountSign === '%') {
                                var priceAmount = (((price.toFixed(2)) * data.items[i].item_quantity) - (((price.toFixed(2)) * data.items[i].item_quantity) * (discount / 100)));
                            } else {
                                var priceAmount = (((price.toFixed(2)) * data.items[i].item_quantity) - (discount * data.items[i].item_quantity));
                            }

                            var discount_percentage = '--';
                            if (discount !== 0) {
                                if (discountSign === '%') {
                                    discount_percentage = '' + discount + ' ' + discountSign + '';
                                } else {
                                    discount_percentage = '' + discountSign + ' ' + discount + '';
                                }
                            }
                            var tax = '-';
                            var taxSigns = '-';
                            if (data.items[i].tax !== 0) {
                                tax = data.items[i].tax;
                                taxSigns = '%';
                                taxText.push(tax + '% &nbsp;');
                                taxCgstText.push(tax / 2 + '% &nbsp;');
                            }

                            let item_unit = (typeof (data.items[i].item_unit) !== "undefined" && data.items[i].item_unit !== null) ? data.items[i].item_unit : 'qty';
                            itemTotalQty += data.items[i].item_quantity;
                            let hsn = (data.items[i].tax_fields.length === 0 && data.items[i].tax > 0) ? data.items[i].tax_name : '--';
                            let rowHTMLLine = '<tr><td height="1" colspan="7" style="border:1px solid #e4e4e4"></td></tr><tr><td style="color: #506fe4;" class="article print-deatils-size-family print-details-align">' + PosnicPro.textOverflowPrintEllipsis(data.items[i].item_name, PosnicPro.local.get('printing_max_char'), true) + '</td>' +
                                '<td class="print-deatils-size-family print-details-align lineitem_hsn" style="color: #646a6e;">' + hsn + '</td>' +
                                '<td class="print-deatils-size-family print-details-align lineitem_price" style="color: #646a6e;" align="center">' + price.toFixed(2) + '</td>' +
                                '<td class="print-deatils-size-family print-details-align lineitem_qty" style="color: #646a6e;" align="center">' + PosnicPro.formatQuantity(data.items[i].item_quantity, item_unit) + ' ' + item_unit + ' </td>' +
                                '<td class="print-deatils-size-family print-details-align lineitem_disc" style="color: #646a6e;" align="center">' + discount_percentage + '</td>' +
                                '<td class="print-deatils-size-family print-details-align lineitem_tax" style="color: #646a6e;" align="center">' + tax + ' ' + taxSigns + '</td>' +
                                '<td class="print-deatils-size-family print-details-align lineitem_total" style="color: #1e2b33;" align="right">' + currency + '&nbsp;<span class="number">' + data.items[i].total_amount + '</span></td>' +
                                '</tr><tr><td height="1" colspan="7" style="border:1px solid #e4e4e4"></td></tr>';

                            $('table.print-invoice-a4-table-content tbody').append(rowHTMLLine);
                            if (data.items[i].tax_fields.length > 0) {
                                var taxItemLength = data.items[i].tax_fields.length;
                                for (var z = 0; z < taxItemLength; z++) {
                                    var taxItem = data.items[i].tax_fields[z];
                                    var taxAmount = (priceAmount / 100) * taxItem.tax_value;
                                    itemTotalTax += taxAmount;
                                    itemPrintTaxDetails.push({
                                        "tax_id": taxItem.tax_id.$oid,
                                        "tax_name": taxItem.tax_name,
                                        "tax_value": taxAmount
                                    });
                                }
                            } else if (data.items[i].tax_fields.length === 0 && data.items[i].tax > 0) {
                                var taxAmount = (priceAmount / 100) * data.items[i].tax;
                                itemTotalTax += taxAmount;
                                itemPrintTaxDetails.push({
                                    "tax_id": data.items[i].tax,
                                    "tax_name": data.items[i].tax,
                                    "tax_value": taxAmount
                                });
                            }

                        }
                        var taxPrintItemData = PosnicPro.nestedTaxCalculation(itemPrintTaxDetails);
                        $(taxPrintItemData).each(function (key, val) {
                            if ((val.amount).toFixed(2) > 0.00) {
                                rowHTMLTaxLine += ' <tr> ' +
                                    '    <td style="display:none;">' + val.tax_id + '</td>' +
                                    '    <td class="print-deatils-size-family" style="color: #5b5b5b; line-height: 20px; vertical-align: top;">' + val.tax_name + '%</td>' +
                                    '    <td class="print-deatils-size-family print-footer-align" style="white-space:nowrap;" width="80">' + currency + '&nbsp;<span class="number">' + val.amount + '</span> </td>' +
                                    '</tr>';
                            }
                        });
                        let extraDisValue = data.sale_extra_discount !== null ? data.sale_extra_discount : 0;
                        let extraDiscPrintView = '';
                        if (extraDisValue !== 0) {
                            extraDiscPrintView = '<td class="print-deatils-size-family print-footer-align"> Extra-Discount:     </td>' +
                                '<td class="print-deatils-size-family print-footer-align">' +
                                currency + '&nbsp; - <span class="number">' + extraDisValue + '</span></td>';
                        }
                        $('#extra_disc_print_view').html(extraDiscPrintView);
                        let roundOffValue = data.round_off;
                        let sign = roundOffValue >= 0 ? '+' : '-';
                        let roundOff = '';
                        if (roundOffValue !== 0) {
                            roundOff = '<td class="print-deatils-size-family print-footer-align"> Round-Off: &nbsp; &nbsp; </td>' +
                                '<td class="print-deatils-size-family print-footer-align">' +
                                currency + '&nbsp;(' + sign + ')&nbsp;<span class="number">' + Math.abs(roundOffValue).toFixed(2) + '</span></td>';
                        }
                        $('#roundoff-value').html(roundOff);
                        $('table#tax_print_hide tbody').append(rowHTMLTaxLine);

                        // For KOT prints (payment-before print), do not show the
                        // payment summary / status block at all.
                        if (!isKotPrint && data.partial_check === 'true' && data.sale_process !== 'PartialReturn' && data.sale_process !== 'FullReturn') {
                            $('.print-payment-status-hide').show();
                            $('.print-payment-balance').html(currency + '&nbsp;' + data.partial_balance.toFixed(2));
                            $('.print-payment-pending').html(currency + '&nbsp;' + data.payment_pending.toFixed(2));
                            $('.print-payment-status').html(data.payment_status);
                        }
                    } else {
                        $('.tax_print_hide').html('');
                        $('.tax_detail_print_hideShow').hide();
                        var igst = 0;
                        var cgst = 0;
                        var taxText = [];
                        var taxCgstText = [];
                        for (var i = 0; i < length; i++) {
                            igst += data.items[i].igst_tax;
                            cgst += data.items[i].cgst_tax;
                            var discount = (data.items[i].item_discount > 0) ? data.items[i].item_discount : data.items[i].item_discount_percentage;
                            var discountSign = (data.items[i].item_discount > 0) ? currency : '%';
                            var tax = data.items[i].tax;
                            var tax_type = data.items[i].tax_type;
                            if (tax_type === 'exclusive') {
                                var price = data.items[i].item_price;
                            } else {
                                var price = data.items[i].item_price / ((tax / 100) + 1);
                            }
                            if (discountSign === '%') {
                                var priceAmount = (((price.toFixed(2)) * data.items[i].item_quantity) - (((price.toFixed(2)) * data.items[i].item_quantity) * (discount / 100)));
                            } else {
                                var priceAmount = (((price.toFixed(2)) * data.items[i].item_quantity) - (discount * data.items[i].item_quantity));
                            }
                            taxText.push(tax + '% &nbsp;');
                            taxCgstText.push(tax / 2 + '% &nbsp;');
                            let item_unit = (typeof (data.items[i].item_unit) !== "undefined" && data.items[i].item_unit !== null) ? data.items[i].item_unit : 'qty';
                            itemTotalQty += data.items[i].item_quantity;
                            let rowHTMLLine = '<div class="row receipt-row-item-holder" style="margin-top:8px;"><div class="col-md-5 col-sm-5 col-xs-5"><div class="invoice-content invoice-con"><div class="invoice-content-heading">' + PosnicPro.textOverflowPrintEllipsis(data.items[i].item_name, PosnicPro.local.get('printing_max_char'), true) + '</div></div></div>' +
                                '<div class="col-md-3 col-sm-3 col-xs-3 gift_receipt_element"><div class="invoice-content item-qty text-left">' + PosnicPro.formatQuantity(data.items[i].item_quantity, item_unit) + ' ' + item_unit + '</div></div>' +
                                '<div class="col-md-4 col-sm-4 col-xs-4 gift_receipt_element"><div class="invoice-content item-total pull-right ">' + currency + '&nbsp;<span class="number">' + price * data.items[i].item_quantity + '</span></div></div></div>';

                            $('.print-invoice-table-content').append(rowHTMLLine);

                            if (data.items[i].tax_fields.length > 0) {
                                var taxItemLength = data.items[i].tax_fields.length;
                                for (var z = 0; z < taxItemLength; z++) {
                                    var taxItem = data.items[i].tax_fields[z];
                                    var taxAmount = (priceAmount / 100) * taxItem.tax_value;
                                    itemTotalTax += taxAmount;
                                    itemPrintTaxDetails.push({
                                        "tax_id": taxItem.tax_id.$oid,
                                        "tax_name": taxItem.tax_name,
                                        "tax_value": taxAmount
                                    });
                                }
                            } else if (data.items[i].tax_fields.length === 0 && data.items[i].tax > 0) {
                                var taxAmount = (priceAmount / 100) * data.items[i].tax;
                                itemTotalTax += taxAmount;
                                itemPrintTaxDetails.push({
                                    "tax_id": data.items[i].tax,
                                    "tax_name": data.items[i].tax,
                                    "tax_value": taxAmount
                                });
                            }
                        }
                        var taxPrintItemData = PosnicPro.nestedTaxCalculation(itemPrintTaxDetails);
                        $(taxPrintItemData).each(function (key, val) {
                            if ((val.amount).toFixed(2) > 0.00) {
                                var rowHTMLTaxLine = '<div class="row">' +
                                    '<div class="col-md-offset-2 col-sm-offset-2 col-xs-offset-2 col-md-8 col-sm-8 col-xs-8"><div class="invoice-footer-heading"></div></div>' +
                                    '<div class="col-md-8 col-sm-8 col-xs-6"><div class="invoice-footer-value">' + val.tax_name + '%</div></div>' +
                                    '<div class="col-md-4 col-sm-4 col-xs-6"><div class="invoice-footer-valuew invoice-payment text-right">' + currency + '&nbsp;<span class="number">' + val.amount + '</div></div>' +
                                    '</div>';
                            }
                            $('.tax_print_hide').append(rowHTMLTaxLine);
                            $('.tax_detail_print_hideShow').show();
                        });

                        let extraDisValue = data.sale_extra_discount !== null ? data.sale_extra_discount : 0;
                        let extraDiscStandardPrint = '';
                        if (extraDisValue !== 0) {
                            extraDiscStandardPrint =
                                '<div class="col-md-8 col-sm-8 col-xs-6">' +
                                '<div class="invoice-footer-value">Extra-Disc</div>' +
                                '</div>' +
                                '<div class="col-md-4 col-sm-4 col-xs-6">' +
                                '<div class="invoice-footer-value invoice-payment text-dark">' + currency + " &nbsp;" + '-' + extraDisValue + '</div>' +
                                '</div>';
                        }
                        $('#extra_disc_standard_print').html(extraDiscStandardPrint);
                        let roundOffValue = data.round_off;
                        let sign = roundOffValue >= 0 ? '+' : '-';
                        let roundOffHTML = '';
                        if (roundOffValue !== 0) {
                            roundOffHTML =
                                '<div class="col-md-8 col-sm-8 col-xs-6">' +
                                '<div class="invoice-footer-value">Round-Off</div>' +
                                '</div>' +
                                '<div class="col-md-4 col-sm-4 col-xs-6">' +
                                '<div class="invoice-footer-value invoice-payment text-dark">' + currency + sign + Math.abs(roundOffValue).toFixed(2) +
                                '</div>' +
                                '</div>';
                        }
                        $('#roundoff_standard_print').html(roundOffHTML);
                    }

                } else {
                    $('.print-payment-status-hide').hide();
                    $('.print-title').html(PosnicPro.local.get('sale_return_title'));
                    $('.print_date').text(data.updated_date);
                    if (PosnicPro.sales.view._isA4()) {
                        var rowHTMLTaxLine;
                        var igst = 0;
                        var cgst = 0;
                        var taxText = [];
                        var taxCgstText = [];
                        for (var i = 0; i < length_return; i++) {
                            $.each(data.items_return[i].returnArray['returnValue'], function (key, val) {
                                var tax = val.tax;
                                var tax_type = val.tax_type;
                                if (tax_type === 'exclusive') {
                                    var price = val.item_price;
                                } else {
                                    var price = val.item_price / ((tax / 100) + 1);
                                }
                                var discount = (val.item_discount > 0) ? val.item_discount : val.item_discount_percentage;
                                var discountSign = (val.item_discount > 0) ? currency : '%';

                                igst += val.igst_tax;
                                cgst += val.cgst_tax;

                                if (discountSign === '%') {
                                    var priceAmount = (((price.toFixed(2)) * val.item_quantity) - (((price.toFixed(2)) * val.item_quantity) * (discount / 100)));
                                } else {
                                    var priceAmount = (((price.toFixed(2)) * val.item_quantity) - (discount * val.item_quantity));
                                }

                                var discount_percentage = '--';
                                if (discount !== 0) {
                                    if (discountSign === '%') {
                                        discount_percentage = '' + discount + ' ' + discountSign + '';
                                    } else {
                                        discount_percentage = '' + discountSign + ' ' + discount + '';
                                    }
                                }
                                var tax = '-';
                                var taxSigns = '-';
                                if (val.tax !== 0) {
                                    tax = val.tax;
                                    taxSigns = '%';
                                    taxText.push(tax + '% &nbsp;');
                                    taxCgstText.push(tax / 2 + '% &nbsp;');
                                }

                                let item_unit = (typeof (val.item_unit) != "undefined" && val.item_unit !== null) ? val.item_unit : 'qty';
                                itemTotalQty += val.item_quantity;
                                let hsn = (val.tax_fields.length === 0 && val.tax > 0) ? val.tax_name : '--';
                                let rowHTMLLine = '<tr><td height="1" colspan="7" style="border-top:1px solid #e4e4e4"></td></tr><tr><td style="color: #506fe4;" class="article print-deatils-size-family print-details-align">' + PosnicPro.textOverflowPrintEllipsis(val.item_name, PosnicPro.local.get('printing_max_char'), true) + '</td>' +
                                    '<td class="print-deatils-size-family print-details-align lineitem_hsn" style="color: #646a6e;">' + hsn + '</td>' +
                                    '<td class="print-deatils-size-family print-details-align lineitem_price" style="color: #646a6e;" align="center">' + price.toFixed(2) + '</td>' +
                                    '<td class="print-deatils-size-family print-details-align lineitem_qty" style="color: #646a6e;" align="center">' + PosnicPro.formatQuantity(val.item_quantity, item_unit) + ' ' + item_unit + ' </td>' +
                                    '<td class="print-deatils-size-family print-details-align lineitem_disc" style="color: #646a6e;" align="center">' + discount_percentage + '</td>' +
                                    '<td class="print-deatils-size-family print-details-align lineitem_tax" style="color: #646a6e;" align="center">' + tax + ' ' + taxSigns + '</td>' +
                                    '<td class="print-deatils-size-family print-details-align lineitem_total" style="color: #1e2b33;" align="right">' + currency + '&nbsp;<span class="number">' + val.total_amount + '</span></td>' +
                                    '</tr><tr><td height="1" colspan="7" style="border-bottom:1px solid #e4e4e4"></td></tr>';

                                $('table.print-invoice-a4-table-content tbody').append(rowHTMLLine);
                                if (val.tax_fields.length > 0) {
                                    var taxItemLength = val.tax_fields.length;
                                    for (var z = 0; z < taxItemLength; z++) {
                                        var taxItem = val.tax_fields[z];
                                        var taxAmount = (priceAmount / 100) * taxItem.tax_value;
                                        itemTotalTax += taxAmount;
                                        itemPrintTaxDetails.push({
                                            "tax_id": taxItem.tax_id.$oid,
                                            "tax_name": taxItem.tax_name,
                                            "tax_value": taxAmount
                                        });
                                    }
                                } else if (val.tax_fields.length === 0 && val.tax > 0) {
                                    var taxAmount = (priceAmount / 100) * val.tax;
                                    itemTotalTax += taxAmount;
                                    itemPrintTaxDetails.push({
                                        "tax_id": val.tax,
                                        "tax_name": val.tax,
                                        "tax_value": taxAmount
                                    });
                                }
                            });
                        }
                        var taxPrintItemData = PosnicPro.nestedTaxCalculation(itemPrintTaxDetails);
                        $(taxPrintItemData).each(function (key, val) {
                            if ((val.amount).toFixed(2) > 0.00) {
                                rowHTMLTaxLine += ' <tr> ' +
                                    '    <td style="display:none;">' + val.tax_id + '</td>' +
                                    '    <td class="print-deatils-size-family" style="color: #5b5b5b; line-height: 20px; vertical-align: top;">' + val.tax_name + '%</td>' +
                                    '    <td class="print-deatils-size-family print-footer-align" style="white-space:nowrap;" width="80">' + currency + '&nbsp;<span class="number">' + val.amount + '</span> </td>' +
                                    '</tr>';
                            }

                        });
                        $('table#tax_print_hide tbody').append(rowHTMLTaxLine);
                    } else {
                        //$('.tax-print-hideshow').hide();
                        $('.tax_print_hide').html('');
                        $('.tax_detail_print_hideShow').hide();

                        var igst = 0;
                        var cgst = 0;
                        var priceReturnAmount = 0;
                        var taxText = [];
                        var taxCgstText = [];
                        for (var i = 0; i < length_return; i++) {
                            $.each(data.items_return[i].returnArray['returnValue'], function (key, val) {
                                igst += val.igst_tax;
                                cgst += val.cgst_tax;
                                var discount = (val.item_discount > 0) ? val.item_discount : val.item_discount_percentage;
                                var discountSign = (val.item_discount > 0) ? currency : '%';
                                var tax = val.tax;
                                var tax_type = val.tax_type;
                                if (tax_type === 'exclusive') {
                                    var price = val.item_price;
                                } else {
                                    var price = val.item_price / ((tax / 100) + 1);
                                }

                                if (discountSign === '%') {
                                    priceReturnAmount = (((price.toFixed(2)) * val.item_quantity) - (((price.toFixed(2)) * val.item_quantity) * (discount / 100)));
                                } else {
                                    priceReturnAmount = (((price.toFixed(2)) * val.item_quantity) - (discount * val.item_quantity));
                                }
                                taxText.push(tax + '% &nbsp;');
                                taxCgstText.push(tax / 2 + '% &nbsp;');
                                let item_unit = (typeof (val.item_unit) !== "undefined" && val.item_unit !== null) ? val.item_unit : 'qty';
                                itemTotalQty += val.item_quantity;
                                let rowHTMLLine = '<div class="row receipt-row-item-holder" style="margin-top:8px;"><div class="col-md-5 col-sm-5 col-xs-5"><div class="invoice-content invoice-con"><div class="invoice-content-heading">' + PosnicPro.textOverflowPrintEllipsis(val.item_name, PosnicPro.local.get('printing_max_char'), true) + '</div></div></div>' +
                                    '<div class="col-md-3 col-sm-3 col-xs-3 gift_receipt_element"><div class="invoice-content item-qty text-left">' + PosnicPro.formatQuantity(val.item_quantity, item_unit) + ' ' + item_unit + '</div></div>' +
                                    '<div class="col-md-4 col-sm-4 col-xs-4 gift_receipt_element"><div class="invoice-content item-total pull-right ">' + currency + '&nbsp;<span class="number">' + price * val.item_quantity + '</span></div></div></div>';

                                $('.print-invoice-table-content').append(rowHTMLLine);

                                if (val.tax_fields.length > 0) {
                                    var taxItemLength = val.tax_fields.length;
                                    for (var z = 0; z < taxItemLength; z++) {
                                        var taxItem = val.tax_fields[z];
                                        var taxAmount = (priceReturnAmount / 100) * taxItem.tax_value;
                                        itemTotalTax += taxAmount;
                                        itemPrintTaxDetails.push({
                                            "tax_id": taxItem.tax_id.$oid,
                                            "tax_name": taxItem.tax_name,
                                            "tax_value": taxAmount
                                        });
                                    }
                                } else if (val.tax_fields.length === 0 && val.tax > 0) {
                                    var taxAmount = (priceReturnAmount / 100) * val.tax;
                                    itemTotalTax += taxAmount;
                                    itemPrintTaxDetails.push({
                                        "tax_id": val.tax,
                                        "tax_name": val.tax,
                                        "tax_value": taxAmount
                                    });
                                }
                            });
                        }
                        var taxPrintItemData = PosnicPro.nestedTaxCalculation(itemPrintTaxDetails);
                        $(taxPrintItemData).each(function (key, val) {
                            if ((val.amount).toFixed(2) > 0.00) {
                                var rowHTMLTaxLine = '<div class="row">' +
                                    '<div class="col-md-offset-2 col-sm-offset-2 col-xs-offset-2 col-md-8 col-sm-8 col-xs-8"><div class="invoice-footer-heading"></div></div>' +
                                    '<div class="col-md-8 col-sm-8 col-xs-6"><div class="invoice-footer-value">' + val.tax_name + '%</div></div>' +
                                    '<div class="col-md-4 col-sm-4 col-xs-6"><div class="invoice-footer-valuew invoice-payment text-right">' + currency + '&nbsp;<span class="number">' + val.amount + '</div></div>' +
                                    '</div>';
                            }
                            $('.tax_print_hide').append(rowHTMLTaxLine);
                            $('.tax_detail_print_hideShow').show();
                            $('.heading-tax-name').show();
                        });

                    }
                }

                PosnicPro.toggleVisibility('lineitem_hsn', '.lineitem_hsn');
                PosnicPro.toggleVisibility('lineitem_price', '.lineitem_price');
                PosnicPro.toggleVisibility('lineitem_qty', '.lineitem_qty');
                PosnicPro.toggleVisibility('lineitem_disc', '.lineitem_disc');
                PosnicPro.toggleVisibility('lineitem_tax', '.lineitem_tax');
                PosnicPro.toggleVisibility('lineitem_total', '.lineitem_total');
                PosnicPro.toggleVisibility('print_qty', '.print_qty');
                PosnicPro.toggleVisibility('print_roundoff', '.print_roundoff');

                $('.taxgst_print_hide,.tax_print_hide').hide();
                $('#tax_print_hide').hide();

                /* Indian gst calculation */
                if (PosnicPro.local.get('gst_action') === 'enable' && data.gst === 'enable') {
                    $('.heading-tax-name').hide();
                    $('.indian-gstr').show();
                    $('.taxgst_print_hide').show();
                    if (parseFloat(igst) > 0) {
                        $('.hide-show-igst').show();
                        $('.hide-show-scgst').hide();
                        $('.gst-text-value').html(PosnicPro.removeDuplicates(taxText));
                        $('.print_igst_tax_view').html(currency + '&nbsp;<span class="number">' + igst.toFixed(2) + '</span>');
                    } else if (parseFloat(cgst) > 0) {
                        $('.hide-show-scgst').show();
                        $('.hide-show-igst').hide();
                        $('.cgst-text-value').html(PosnicPro.removeDuplicates(taxCgstText));
                        $('.print_csgst_tax_view').html(currency + '&nbsp;<span class="number">' + cgst.toFixed(2) + '</span>');
                    } else {
                        $('.indian-gstr').hide();
                    }
                } else {
                    $('.indian-gstr').hide();
                    if (PosnicPro.sales.view._isA4()) {
                        if (parseFloat(itemTotalTax) > 0) {
                            $('.tax_print_hide').show();
                            $('#tax_print_hide').show();
                            $('.tax-print-hideshow').show();
                        }
                    } else {
                        $('#tax_print_hide').show();
                        $('.tax_print_hide').show();
                    }
                }

                $('.total-noof-item').html(itemTotalQty.toFixed(2));
                $('span.number').number(true, 2);

                // KOT History prints: temporarily hide plain 'Payment' / 'Payment Status' labels.
                // Non-KOT prints: always restore these labels so Sales/Settlement prints are unaffected.
                var $printContainer = PosnicPro.sales.view._isA4()
                    ? $(".print-modal-a4-body")
                    : $(".print-modal-body");

                var $paymentLabels = $printContainer.find('*').filter(function () {
                    var $el = $(this);
                    if ($el.children().length) {
                        return false;
                    }
                    var text = $.trim($el.text());
                    return text === 'Payment' || text === 'Payment Status';
                });

                if (isKotPrint) {
                    $paymentLabels.hide();
                } else {
                    $paymentLabels.show();
                }

                /*
                 * The pieces that make an A4 read as an invoice rather than a
                 * long receipt: the total written out, the shop's terms, and
                 * somewhere to sign. Added here rather than in the stored
                 * template because every shop already holds its own copy of
                 * that template - editing the file would reach new shops only.
                 * Swept first so a reprint cannot stack them.
                 */
                $('.a4-invoice-extras').remove();
                if (PosnicPro.sales.view._isA4() && name === 'sale') {
                    var _escX = function (v) { return $('<i>').text(v == null ? '' : v).html(); };
                    var _gstShop = !!branchGstin || PosnicPro.local.get('gst_action') === 'enable';
                    var _terms = $.trim(PosnicPro.local.get('invoice_terms') || '');
                    var _sig = $.trim(PosnicPro.local.get('quotesignature') || '');
                    var _x = '<div class="a4-invoice-extras" style="margin-top:18px; font-size:12px; color:#5b5b5b;">';
                    if (_gstShop) {
                        _x += '<div style="padding:6px 0; border-top:1px solid #d8d8d8;"><b>Amount in words:</b> '
                            + _escX(PosnicPro.sales.view._amountInWords(data.items_total)) + '</div>';
                    }
                    if (_terms) {
                        _x += '<div style="padding:6px 0;"><b>Terms &amp; conditions</b><br>'
                            + _escX(_terms).split(String.fromCharCode(10)).join('<br>') + '</div>';
                    }
                    _x += '<div style="margin-top:26px; width:220px; margin-left:auto; text-align:center;">'
                        + (_sig ? '<img src="' + _escX(_sig) + '" alt="" style="max-height:38px; max-width:170px; display:block; margin:0 auto;">' : '')
                        + '<div style="border-top:1px solid #8a94a6; padding-top:5px;">Authorised signatory</div>'
                        + '</div></div>';
                    $('.print-modal-a4-body').append(_x);
                }

                var contents = $(".print-modal-body").html();
                var contentone = $(".print-modal-a4-body").html();
                var canvas = document.getElementById("canvasTarget");
                var img = data.receipt_barcode === true ? canvas.toDataURL("image/png") : '';

                PosnicPro.printView(PosnicPro.sales.view._isA4() ? contentone : contents, img);
                // one print only - the next follows the shop setting again
                PosnicPro._printTypeOverride = null;
                PosnicPro.sales.view._layoutOverride = null;

                $('.invoice-table-content div').empty();
            } else {
                PosnicPro.alert(response.type, response.message);
                PosnicPro._printTypeOverride = null;
                PosnicPro.sales.view._layoutOverride = null;
            }
        }, function (xhr) {
            /* There was no error handler here at all, so a dropped request
               left the paper choice set and the NEXT receipt printed on the
               wrong stock with nothing to explain it. */
            PosnicPro._printTypeOverride = null;
            PosnicPro.sales.view._layoutOverride = null;
            if (PosnicPro.alert) {
                PosnicPro.alert('error', 'Could not reach the server to print this receipt - try again.');
            }
            console.error('[print] sales/' + id + ' request failed:', xhr && xhr.status);
        });
    },
    /*Perticular Returned printing the sales data held by this function*/
    returnPrintSales: function (id) {
        var data = {
            id: id
        };
        var params = {
            url: 'sales/returnPrintDetails',
            data: data
        };
        PosnicPro.get(params, function (response) {
            $('.gst-text-value,.print_igst_tax_view,.cgst-text-value,.print_csgst_tax_view').html('');
            if (response.type === 'success') {
                var data = response.data.custom_data;
                $('#receipt_wrapper').removeClass('receipt_small receipt_medium receipt_large receipt_extra_large');
                let print_size = PosnicPro.local.get('printing_size');
                $('#receipt_wrapper').addClass(print_size);
                PosnicPro.record_id = id;
                var currency = PosnicPro.local.get('currencySign');
                $('.tax-print-hideshow,.percentage-print-hideshow,.amount-print-hideshow').hide();
                $('.print_date').text(data.date);
                $('.print_view_id').html('#' + data.return_id);
                $('.print-title').html(PosnicPro.local.get('sale_return_title'));
                $('.print_date').text(data.date);
                $('.print_view_id').html('#' + data.sales_id);
                $('.print-invoice-payment-mode').html(data.payment_mode);
                $('.barcodeValue').val(data.sales_id);
                $('.hide_customer_details,.print-payment-status-hide').hide();
                if (data.customer_print === true) {
                    $('.hide_customer_details').show();
                    $('.print-custom-title').html('Customer Details');
                    $('.print-name').html(data.customer_name);
                    $('.print-phone').html(data.customer_phone);
                    $('.print-email').html(data.customer_email);
                    $('.print-address').html(data.customer_address);
                }
                PosnicPro.printBarcode();
                $('.print-invoice-a4-table-content tbody').children("tr").remove();
                $('#tax_print_hide tbody').children("tr").remove();
                $('.print-invoice-table-content').html('');
                $('.hide-receiving-print').hide();
                var itemTotalQty = 0;
                var itemPrintTaxDetails = [];
                var itemTotalTax = 0;
                var subTotal = 0;
                var grandTotal = 0;
                var length = response.data.return_data.length;
                if (PosnicPro.sales.view._isA4()) {
                    var rowHTMLTaxLine;
                    var igst = 0;
                    var cgst = 0;
                    var taxText = [];
                    var taxCgstText = [];
                    var lineItemDiscount = 0;
                    for (var i = 0; i < length; i++) {
                        var tax = response.data.return_data[i].item_tax;
                        var tax_type = response.data.return_data[i].item_tax_type;
                        if (tax_type === 'exclusive') {
                            var price = response.data.return_data[i].item_price;
                        } else {
                            var price = response.data.return_data[i].item_price / ((tax / 100) + 1);
                        }
                        var discount = (response.data.return_data[i].item_discount > 0) ? response.data.return_data[i].item_discount : response.data.return_data[i].item_discount_percentage;
                        var discountSign = (response.data.return_data[i].item_discount > 0) ? currency : '%';
                        lineItemDiscount += response.data.return_data[i].item_return_discount;
                        igst += response.data.return_data[i].item_igst_tax;
                        cgst += response.data.return_data[i].item_cgst_tax;

                        subTotal += (price * response.data.return_data[i].item_quantity);
                        grandTotal += response.data.return_data[i].item_total_amount;
                        if (discountSign === '%') {
                            var priceAmount = (((price.toFixed(2)) * response.data.return_data[i].item_quantity) - (((price.toFixed(2)) * response.data.return_data[i].item_quantity) * (discount / 100)));
                        } else {
                            var priceAmount = (((price.toFixed(2)) * response.data.return_data[i].item_quantity) - (discount * response.data.return_data[i].item_quantity));
                        }
                        var discount_percentage = '--';
                        if (discount !== 0) {
                            if (discountSign === '%') {
                                discount_percentage = '' + discount + ' ' + discountSign + '';
                            } else {
                                discount_percentage = '' + discountSign + ' ' + discount + '';
                            }
                        }
                        var tax = '-';
                        var taxSigns = '-';
                        if (response.data.return_data[i].item_tax !== 0) {
                            tax = response.data.return_data[i].item_tax;
                            taxSigns = '%';
                            taxText.push(tax + '% &nbsp;');
                            taxCgstText.push(tax / 2 + '% &nbsp;');
                        }

                        let item_unit = (typeof (response.data.return_data[i].item_unit) !== "undefined" && response.data.return_data[i].item_unit !== null) ? response.data.return_data[i].item_unit : 'qty';
                        itemTotalQty += response.data.return_data[i].item_quantity;
                        let hsn = (response.data.return_data[i].item_tax_fields.length === 0 && response.data.return_data[i].item_tax > 0) ? response.data.return_data[i].item_tax_name : '--';
                        let rowHTMLLine = '<tr><td height="1" colspan="7" style="border-top:1px solid #e4e4e4"></td></tr><tr>\n\
                                <td style="color: #506fe4;" class="article print-deatils-size-family print-details-align">' + PosnicPro.textOverflowPrintEllipsis(response.data.return_data[i].item_name, PosnicPro.local.get('printing_max_char'), true) + '</td>' +
                            '<td class="print-deatils-size-family print-details-align lineitem_hsn" style="color: #646a6e;">' + hsn + '</td>' +
                            '<td class="print-deatils-size-family print-details-align lineitem_price" style="color: #646a6e;" align="center">' + price.toFixed(2) + '</td>' +
                            '<td class="print-deatils-size-family print-details-align lineitem_qty" style="color: #646a6e;" align="center">' + PosnicPro.formatQuantity(response.data.return_data[i].item_quantity, item_unit) + ' ' + item_unit + '</td>' +
                            '<td class="print-deatils-size-family print-details-align lineitem_disc" style="color: #646a6e;" align="center">' + discount_percentage + '</td>' +
                            '<td class="print-deatils-size-family print-details-align lineitem_tax" style="color: #646a6e;" align="center">' + tax + ' ' + taxSigns + '</td>' +
                            '<td class="print-deatils-size-family print-details-align lineitem_total" style="color: #1e2b33;" align="right">' + currency + '&nbsp;<span class="number">' + response.data.return_data[i].item_total_amount + '</span></td>' +
                            '</tr><tr><td height="1" colspan="7" style="border-bottom:1px solid #e4e4e4"></td></tr>';

                        $('table.print-invoice-a4-table-content tbody').append(rowHTMLLine);

                        if (response.data.return_data[i].item_tax_fields.length > 0) {
                            var taxItemLength = response.data.return_data[i].item_tax_fields.length;
                            for (var z = 0; z < taxItemLength; z++) {
                                var taxItem = response.data.return_data[i].item_tax_fields[z];
                                var taxAmount = (priceAmount / 100) * taxItem.tax_value;
                                itemTotalTax += taxAmount;
                                itemPrintTaxDetails.push({
                                    "tax_id": taxItem.tax_id.$oid,
                                    "tax_name": taxItem.tax_name,
                                    "tax_value": taxAmount
                                });
                            }
                        } else if (response.data.return_data[i].item_tax_fields.length === 0 && response.data.return_data[i].item_tax > 0) {
                            var taxAmount = (priceAmount / 100) * response.data.return_data[i].item_tax;
                            itemTotalTax += taxAmount;
                            itemPrintTaxDetails.push({
                                "tax_id": response.data.return_data[i].item_tax,
                                "tax_name": response.data.return_data[i].item_tax,
                                "tax_value": taxAmount
                            });
                        }
                        var roundOffValue = response.data.return_data[i].roundOff;
                        var extraDisValue = response.data.return_data[i].extraDiscount;
                        grandTotal = response.data.return_data[i].itemsTotalAmount;
                    }
                    var taxPrintItemData = PosnicPro.nestedTaxCalculation(itemPrintTaxDetails);
                    $(taxPrintItemData).each(function (key, val) {
                        if ((val.amount).toFixed(2) > 0.00) {
                            rowHTMLTaxLine += ' <tr> ' +
                                '    <td style="display:none;">' + val.tax_id + '</td>' +
                                '    <td class="print-deatils-size-family" style="color: #5b5b5b; line-height: 20px; vertical-align: top;">' + val.tax_name + '%</td>' +
                                '    <td class="print-deatils-size-family print-footer-align" style="white-space:nowrap;" width="80">' + currency + '&nbsp;<span class="number">' + val.amount + '</span> </td>' +
                                '</tr>';
                        }

                    });
                    $('table#tax_print_hide tbody').append(rowHTMLTaxLine);
                    let sales_description = data.sales_description;
                    if (data.print_sale_notes === true && $.trim(sales_description).length !== 0) {
                        $('.print-sale-notes-hide').show();
                        $('.print-sale-notes').html(sales_description);
                    } else {
                        $('.print-sale-notes-hide').hide();
                    }
                } else {
                    $('.tax_detail_print_hideShow').hide();
                    $('.tax_print_hide').html('');
                    var igst = 0;
                    var cgst = 0;
                    var taxText = [];
                    var taxCgstText = [];
                    var lineItemDiscount = 0;
                    for (var i = 0; i < length; i++) {
                        igst += response.data.return_data[i].item_igst_tax;
                        cgst += response.data.return_data[i].item_cgst_tax;
                        var discount = (response.data.return_data[i].item_discount > 0) ? response.data.return_data[i].item_discount : response.data.return_data[i].item_discount_percentage;
                        var discountSign = (response.data.return_data[i].item_discount > 0) ? currency : '%';
                        lineItemDiscount += response.data.return_data[i].item_return_discount;
                        var tax = response.data.return_data[i].item_tax;
                        var tax_type = response.data.return_data[i].item_tax_type;
                        if (tax_type === 'exclusive') {
                            var price = response.data.return_data[i].item_price;
                        } else {
                            var price = response.data.return_data[i].item_price / ((tax / 100) + 1);
                        }
                        if (discountSign === '%') {
                            var priceAmount = (((price.toFixed(2)) * response.data.return_data[i].item_quantity) - (((price.toFixed(2)) * response.data.return_data[i].item_quantity) * (discount / 100)));
                        } else {
                            var priceAmount = (((price.toFixed(2)) * response.data.return_data[i].item_quantity) - (discount * response.data.return_data[i].item_quantity));
                        }


                        subTotal += (price * response.data.return_data[i].item_quantity);
                        grandTotal += response.data.return_data[i].item_total_amount;
                        taxText.push(tax + '% &nbsp;');
                        taxCgstText.push(tax / 2 + '% &nbsp;');
                        let item_unit = (typeof (response.data.return_data[i].item_unit) != "undefined" && response.data.return_data[i].item_unit !== null) ? response.data.return_data[i].item_unit : 'qty';
                        itemTotalQty += response.data.return_data[i].item_quantity;
                        let rowHTMLLine = '<div class="row receipt-row-item-holder" style="margin-top:8px;"><div class="col-md-5 col-sm-5 col-xs-5"><div class="invoice-content invoice-con"><div class="invoice-content-heading">' + PosnicPro.textOverflowPrintEllipsis(response.data.return_data[i].item_name, PosnicPro.local.get('printing_max_char'), true) + '</div></div></div>' +
                            '<div class="col-md-3 col-sm-3 col-xs-3 gift_receipt_element"><div class="invoice-content item-qty text-left">' + PosnicPro.formatQuantity(response.data.return_data[i].item_quantity, item_unit) + ' ' + item_unit + '</div></div>' +
                            '<div class="col-md-4 col-sm-4 col-xs-4 gift_receipt_element"><div class="invoice-content item-total pull-right ">' + currency + '&nbsp;<span class="number">' + price * response.data.return_data[i].item_quantity + '</span></div></div></div>';

                        $('.print-invoice-table-content').append(rowHTMLLine);

                        if (response.data.return_data[i].item_tax_fields.length > 0) {
                            var taxItemLength = response.data.return_data[i].item_tax_fields.length;
                            for (var z = 0; z < taxItemLength; z++) {
                                var taxItem = response.data.return_data[i].item_tax_fields[z];
                                var taxAmount = (priceAmount / 100) * taxItem.tax_value;
                                itemTotalTax += taxAmount;
                                itemPrintTaxDetails.push({
                                    "tax_id": taxItem.tax_id.$oid,
                                    "tax_name": taxItem.tax_name,
                                    "tax_value": taxAmount
                                });
                            }
                        } else if (response.data.return_data[i].item_tax_fields.length === 0 && response.data.return_data[i].item_tax > 0) {
                            var taxAmount = (priceAmount / 100) * response.data.return_data[i].item_tax;
                            itemTotalTax += taxAmount;
                            itemPrintTaxDetails.push({
                                "tax_id": response.data.return_data[i].item_tax,
                                "tax_name": response.data.return_data[i].item_tax,
                                "tax_value": taxAmount
                            });
                        }
                        var roundOffValue = response.data.return_data[i].roundOff;
                        var extraDisValue = response.data.return_data[i].extraDiscount;
                        grandTotal = response.data.return_data[i].itemsTotalAmount;
                    }
                    var taxPrintItemData = PosnicPro.nestedTaxCalculation(itemPrintTaxDetails);
                    $(taxPrintItemData).each(function (key, val) {
                        if ((val.amount).toFixed(2) > 0.00) {
                            var rowHTMLTaxLine = '<div class="row">' +
                                '<div class="col-md-offset-2 col-sm-offset-2 col-xs-offset-2 col-md-8 col-sm-8 col-xs-8"><div class="invoice-footer-heading"></div></div>' +
                                '<div class="col-md-8 col-sm-8 col-xs-6"><div class="invoice-footer-value">' + val.tax_name + '%</div></div>' +
                                '<div class="col-md-4 col-sm-4 col-xs-6"><div class="invoice-footer-valuew invoice-payment text-right">' + currency + '&nbsp;<span class="number">' + val.amount + '</div></div>' +
                                '</div>';
                        }
                        $('.tax_print_hide').append(rowHTMLTaxLine);
                        $('.tax_detail_print_hideShow').show();
                        $('.heading-tax-name').show();
                    });
                }
                PosnicPro.toggleVisibility('lineitem_hsn', '.lineitem_hsn');
                PosnicPro.toggleVisibility('lineitem_price', '.lineitem_price');
                PosnicPro.toggleVisibility('lineitem_qty', '.lineitem_qty');
                PosnicPro.toggleVisibility('lineitem_disc', '.lineitem_disc');
                PosnicPro.toggleVisibility('lineitem_tax', '.lineitem_tax');
                PosnicPro.toggleVisibility('lineitem_total', '.lineitem_total');
                PosnicPro.toggleVisibility('print_qty', '.print_qty');
                PosnicPro.toggleVisibility('print_roundoff', '.print_roundoff');

                if (parseFloat(lineItemDiscount) > 0) {
                    $('.amount-print-hideshow').show();
                    $('.view_sales_discount').html(currency + '&nbsp;<span class="number">' + lineItemDiscount + '</span>');
                }
                if (parseFloat(itemTotalTax) > 0) {
                    $('.tax-print-hideshow').show();
                    $('.view_sales_tax').html(currency + ' &nbsp;<span class="number">' + itemTotalTax.toFixed(2) + '</span>');
                }

                /* Indian gst calculation */
                $('.taxgst_print_hide,.tax_print_hide').hide();
                $('#tax_print_hide').hide();
                if (PosnicPro.local.get('gst_action') === 'enable' && data.gst === 'enable') {
                    $('.heading-tax-name').hide();
                    $('.indian-gstr').show();
                    $('.taxgst_print_hide').show();
                    if (parseFloat(igst) > 0) {
                        $('.hide-show-igst').show();
                        $('.hide-show-scgst').hide();
                        $('.gst-text-value').html(PosnicPro.removeDuplicates(taxText));
                        $('.print_igst_tax_view').html(currency + '<span class="number">' + igst.toFixed(2) + '</span>');
                    } else if (parseFloat(cgst) > 0) {
                        $('.hide-show-scgst').show();
                        $('.hide-show-igst').hide();
                        $('.cgst-text-value').html(PosnicPro.removeDuplicates(taxCgstText));
                        $('.print_csgst_tax_view').html(currency + '<span class="number">' + cgst.toFixed(2) + '</span>');
                    } else {
                        $('.indian-gstr').hide();
                    }
                } else {
                    $('.indian-gstr').hide();
                    if (PosnicPro.sales.view._isA4()) {
                        if (data.partial_check === 'true' && data.sale_process !== 'PartialReturn' && data.sale_process !== 'FullReturn') {
                            $('.print-payment-status-hide').hide();
                            $('.print-payment-balance').html(currency + '&nbsp;' + data.partial_balance.toFixed(2));
                            $('.print-payment-pending').html(currency + '&nbsp;' + data.payment_pending.toFixed(2));
                            $('.print-payment-status').html(data.payment_status);
                        }
                        if (parseFloat(itemTotalTax) > 0) {
                            $('.tax_print_hide').show();
                            $('#tax_print_hide').show();
                            $('.tax-print-hideshow').show();
                        }
                    } else {
                        $('.tax_print_hide').show();
                        $('#tax_print_hide').show();
                    }
                }
                let extraDiscPrintView = '';
                let extraDiscStandardPrint = '';
                if (extraDisValue !== 0) {
                    extraDiscPrintView =
                        '<td class="print-deatils-size-family print-footer-align"> Extra-Discount:     </td>' +
                        '<td class="print-deatils-size-family print-footer-align">' +
                        currency + '&nbsp; - <span class="number">' + extraDisValue + '</span></td>';
                    extraDiscStandardPrint =
                        '<div class="col-md-8 col-sm-8 col-xs-6">' +
                        '<div class="invoice-footer-value">Extra-Disc</div>' +
                        '</div>' +
                        '<div class="col-md-4 col-sm-4 col-xs-6">' +
                        '<div class="invoice-footer-value invoice-payment text-dark">' + currency + "&nbsp;" + '-' + extraDisValue + '</div>' +
                        '</div>';
                }
                $('#extra_disc_print_view').html(extraDiscPrintView);
                $('#extra_disc_standard_print').html(extraDiscStandardPrint);
                var sign = roundOffValue >= 0 ? '+' : '-';
                let roundOff = '';
                let roundOffStandardPrint = '';
                if (roundOffValue !== 0) {
                    roundOff =
                        '<td class="print-deatils-size-family print-footer-align"> Round-Off: &nbsp; &nbsp; </td>' +
                        '<td class="print-deatils-size-family print-footer-align">' +
                        currency + '&nbsp;(' + sign + ')&nbsp;<span class="number">' + Math.abs(roundOffValue).toFixed(2) + '</span></td>';
                    roundOffStandardPrint =
                        '<div class="col-md-8 col-sm-8 col-xs-6">' +
                        '<div class="invoice-footer-value">Round-Off</div>' +
                        '</div>' +
                        '<div class="col-md-4 col-sm-4 col-xs-6">' +
                        '<div class="invoice-footer-value invoice-payment text-dark">' + currency + sign + Math.abs(roundOffValue).toFixed(2) + '</div>' +
                        '</div>';
                }
                $('#roundoff-value').html(roundOff);
                $('#roundoff_standard_print').html(roundOffStandardPrint);
                //                grandTotal = (PosnicPro.roundoff === true) ? Math.round(grandTotal).toFixed(2) : Number(grandTotal).toFixed(2);
                $('.total-noof-item').html(itemTotalQty.toFixed(2));
                $('.print-subtotal').html(currency + '&nbsp;<span class="number">' + subTotal + '</span>');
                $('.print-total').html('<strong>' + currency + '&nbsp;<span class="number">' + grandTotal + '</span></strong>');

                $('span.number').number(true, 2);
                var contents = $(".print-modal-body").html();
                var contentone = $(".print-modal-a4-body").html();
                var canvas = document.getElementById("canvasTarget");
                var img = data.receipt_barcode === true ? canvas.toDataURL("image/png") : '';
                PosnicPro.printView(PosnicPro.sales.view._isA4() ? contentone : contents, img);
                $('.invoice-table-content div').empty();

            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    whatsappSale: function (id, name) {
        PosnicPro.get('sales/' + id, function (response) {

        });
    },
    salesPdf: function (id) {
        window.open(API_URL + 'sales/salesPdf?id=' + id, "_blank");
        hasher.setHash('sales');
    },
    exportSales: function () {
        PosnicPro.exportTableData(PosnicPro.sales_checkbox, 'sales');
    },
    deleteSelectedSales: function () {
        PosnicPro.deleteTableData(PosnicPro.sales_checkbox, 'sales');
    },
    changeExtraDiscType: function (extra_discount_type) {
        if (extra_discount_type === 'percent') {
            $('#rupeeIcon').addClass('d-none');
            $('#percentIcon').removeClass('d-none');
        } else {
            $('#percentIcon').addClass('d-none');
            $('#rupeeIcon').removeClass('d-none');
        }
    }
};
$('.sales_id_print').click(function () {
    let name = $(this).data('id');
    PosnicPro.sales.view.printSale(this.value, name);
    hasher.setHash('#' + currentHash);
});

// Store last known sale document id
let lastSalesId = null;
function checkNewSaleAndRefresh() {
    PosnicPro.get('sales/getNewSale', function (response) {

        if (response.type === 'success' && response.data) {
            // latest sale from backend
            var currentId = response.data.sales_document_id;

            // First run: just store and skip refresh
            if (lastSalesId === null) {
                lastSalesId = currentId;
                return;
            }

            // If new sale detected → refresh datatable
            if (currentId !== lastSalesId) {
                lastSalesId = currentId;
                // 🔔 your existing function
                PosnicPro.refreshDatatable('sales');
            }
        }
    });
}

// Auto-refresh for KOT History. Poll is the FALLBACK: when the realtime
// stream is up, pushes drive the refresh and this interval stands down.
setInterval(function () {
    if (PosnicPro.realtime && PosnicPro.realtime.connected) return;
    let hash = window.location.hash.slice(1);
    let tableOpt = PosnicPro.local.get('table_options') === 'enable';
    let autoRefresh = localStorage.getItem('kot_auto_refresh') === 'enable';

    if (hash === '/kothistory' && tableOpt && autoRefresh) {
        PosnicPro.refreshDatatable('kothistory');
    }
}, 30000); // 30 seconds

/*
 * Multi-till: a sale completed on another till appears on this one's sales
 * list without anyone pressing refresh. checkNewSaleAndRefresh() above was
 * written for exactly this and then never called from anywhere - the sales
 * page just showed yesterday until someone navigated away and back.
 *
 * Only while the sales list is actually on screen in a visible tab, and only
 * for users who can pass getNewSale's sales.write gate - anyone else would
 * collect an Unauthorized toast every interval.
 */
function refreshSalesScreensIfWatching() {
    if (document.hidden) return;
    var hash = window.location.hash.slice(1);
    if (hash === '/sales') {
        var acl = PosnicPro.userACL;
        if (!acl || !acl.sales || acl.sales.write !== true) return;
        checkNewSaleAndRefresh();
    } else if (hash === '/kothistory'
        && PosnicPro.local.get('table_options') === 'enable'
        && localStorage.getItem('kot_auto_refresh') === 'enable') {
        PosnicPro.refreshDatatable('kothistory');
    }
}

// Push-driven (S2): another till wrote a sale - refresh within seconds.
if (PosnicPro.realtime) {
    PosnicPro.realtime.on('sales', refreshSalesScreensIfWatching);
}

// Poll fallback for when the stream is down.
setInterval(function () {
    if (PosnicPro.realtime && PosnicPro.realtime.connected) return;
    if (window.location.hash.slice(1) !== '/sales') return;
    refreshSalesScreensIfWatching();
}, 30000);

// Auto-refresh toggle init (KOT History)
$(document).on('change', '#kot_auto_refresh_toggle', function () {
    const enabled = this.checked ? 'enable' : 'disable';
    localStorage.setItem('kot_auto_refresh', enabled);
});

// When page loads, set KOT toggle from stored value
$(function () {
    const stored = localStorage.getItem('kot_auto_refresh');
    const enabled = (stored === null) ? 'enable' : stored;   // default: ON
    localStorage.setItem('kot_auto_refresh', enabled);
    const $toggle = $('#kot_auto_refresh_toggle');
    if ($toggle.length) {
        $toggle.prop('checked', enabled === 'enable');
    }
});
/*END*/
