
PosnicPro.receivings.view = {

    /*To display the added receiving data details in view page*/
    viewReceiving: function (id) {
        ($('#indian_gst').val() === 'gst_on') ? $('.indian-gstr').show() : $('.indian-gstr').remove();
        var loader = $(".loader-view-receiving");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        PosnicPro.get('receivings/' + id, function (response) {
            if (response.type === 'success') {
                PosnicPro.record_id = id;
                var data = response.data;
                if (data.payment_description !== '') {
                    $('.note_hide').show();
                } else {
                    $('.note_hide').hide();
                }
                $('#receiving_button_print_view,#receiving_return_print_view').show();
                $('#hide_receiving_print,#hide_receiving_return_print').show();
                if (data.receiving_status === 'FullReturn') {
                    $('.hide-receiving-return,#receiving_return_print_view,#hide_receiving_return_print').show();
                    $('.hide-receiving-table,#receiving_button_print_view,#show_receiving_print,#hide_receiving_print').hide();
                } else if (data.receiving_status === 'Open' || data.receiving_status === 'Received') {
                    $('.hide-receiving-table,#receiving_button_print_view,#hide_receiving_print').show();
                    $('.hide-receiving-return,#receiving_return_print_view,#show_receiving_print,#hide_receiving_return_print').hide();
                } else {
                    $('.hide-receiving-table,.hide-receiving-return,#receiving_button_print_view,#receiving_return_print_view,#show_receiving_print').show();
                    $('#hide_receiving_print,#hide_receiving_return_print').hide();
                }
                (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') ? $('#receivingtitelText').text('பெறுதல் விவரங்கள் (' + data.receiving_status + ')') : $('#receivingtitelText').html('Receiving Details (' + data.receiving_status + ')');
                PosnicPro.receivings.view.viewReceivingData(response, id);
                loader.find(".loadingSpinner:first").remove();
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        });
    },
    viewReceivingData: function (response, id) {
        $('#receiving_print_view tbody').children("tr").remove();
        $('#receiving_print_view').find("tr:not(:first)").remove();
        $('#viewreceiving_return_print_view tbody').children("tr").remove();
        $('#viewreceiving_return_print_view').find("tr:not(:first)").remove();
        $('#viewreceiving_return_print_view').html('');
        $('#detailed_receiving_item_tax tbody').children("tr").remove();
        $('#detailed_receiving_item_tax').find("tr:not(:first)").remove();
        $('#detailed_receiving_itemreturn_tax tbody').children("tr").remove();
        $('#detailed_receiving_itemreturn_tax').find("tr:not(:first)").remove();
        $('#receivings_view').modal('show');
        var data = response.data;
        $.each(data, function (key, val) {
            if (val === '') {
                $('#receiving_view_' + key).html('');
            } else {
                $('#receiving_view_' + key).html(val);
            }
        });
        $('.receiving_id_print').val(id);
        var updateDate = PosnicPro.convertDate(data.date);
        $('#date_view_receiving').html(updateDate);
        var length = data.items.length;
        $('#receiving_id').val(PosnicPro.record_id);
        var currency = PosnicPro.local.get('currencySign');
        var items_subtotal = 0;
        var igst = 0;
        var cgst = 0;
        var itemTaxDetails = [];
        for (var i = 0; i < length; i++) {
            var tax = data.items[i].tax;
            var tax_type = data.items[i].tax_type;
            if (tax_type === 'exclusive') {
                var price = data.items[i].item_price;
            } else {
                var price = data.items[i].item_price / ((tax / 100) + 1);
            }
            var priceAmount = ((price.toFixed(2)) * data.items[i].item_quantity);
            igst += data.items[i].igst_tax;
            cgst += data.items[i].cgst_tax;
            items_subtotal += data.items[i].total_amount;

            var tax_percentage = '--';
            if (tax !== 0) {
                tax_percentage = '' + tax + '%';
            }

            let item_unit = (typeof (data.items[i].item_unit) != "undefined" && data.items[i].item_unit !== null) ? data.items[i].item_unit : 'qty';
            var rowHTMLLine = ' <tr id="receiving_row_' + data.items[i].item_id + '"> ' +
                    '    <td>' + (i + 1) + '</td>' +
                    '    <td data-toggle="tooltip" title="' + data.items[i].item_name + '">' + data.items[i].item_name + '</td>' +
                    '    <td>' + currency + '&nbsp;<span class="number">' + price + '</span> </td>' +
                    '    <td>' + PosnicPro.formatQuantity(data.items[i].item_quantity, item_unit) + ' ' + item_unit + '</td>' +
                    '    <td class="text-center">' + tax_percentage + '</td>' +
                    '    <td class="text-right">' + currency + '&nbsp;<span class="number">' + data.items[i].total_amount + '</span> </td>' +
                    '</tr>';

            $('#receiving_print_view tbody').append(rowHTMLLine);
            if (data.items[i].tax_fields.length > 0) {
                var taxItemLength = data.items[i].tax_fields.length;
                for (var z = 0; z < taxItemLength; z++) {
                    var taxItem = data.items[i].tax_fields[z];
                    var taxAmount = (priceAmount / 100) * taxItem.tax_value;
                    itemTaxDetails.push({
                        "tax_id": taxItem.tax_id.$oid,
                        "tax_name": taxItem.tax_name,
                        "tax_value": taxAmount
                    });
                }
            } else if (data.items[i].tax_fields.length === 0 && data.items[i].tax > 0) {
                var taxAmount = (priceAmount / 100) * data.items[i].tax;
                let taxName = data.items[i].tax_name;
                let hsn_id = taxName.slice(4);
                itemTaxDetails.push({
                    "tax_id": hsn_id,
                    "tax_name": taxName,
                    "tax_value": taxAmount
                });
            }

        }
        var taxItemData = PosnicPro.nestedTaxCalculation(itemTaxDetails);
        $(taxItemData).each(function (key, val) {
            if ((val.amount).toFixed(2) > 0.00) {
                var rowHTMLTaxLine = ' <tr> ' +
                        '    <td>' + val.tax_name + '</td>' +
                        '    <td>' + currency + '&nbsp;<span class="number">' + val.amount + '</span> </td>' +
                        '</tr>';
            }
            $('#detailed_receiving_item_tax tbody').append(rowHTMLTaxLine);
        });

        $('.hide-receiving-tax,#detailed_receiving_item_gsttax,#detailed_receiving_item_tax').hide();

        if (data.tax > 0) {
            $('.hide-receiving-tax').show();
            $('.receiving_tax_view').number(data.tax, 2);
        }

        $('#receiving_view_totals').number((data.items_total), 2);

        /* Indian gst calculation */
        if (PosnicPro.local.get('gst_action') === 'enable' && data.gst === 'enable' && data.supplier_gst_type === 'regular' || data.supplier_gst_type === 'composite') {
            $('.indian-gstr').show();
            if (igst > 0) {
                $('.hide-show-igst').show();
                $('.hide-show-scgst').hide();
                $('#detailed_receiving_item_gsttax').show();
                $('.receiving_igst_tax_view').number(igst, 2);
            } else if (cgst > 0) {
                $('.hide-show-scgst').show();
                $('.hide-show-igst').hide();
                $('#detailed_receiving_item_gsttax').show();
                $('.receiving_csgst_tax_view').number(cgst, 3);
            } else {
                $('.indian-gstr').hide();
                $('#detailed_receiving_item_gsttax').hide();
            }
        } else {
            $('.indian-gstr').hide();
            if ($('#detailed_receiving_item_tax tbody tr').length > 0) {
                $('#detailed_receiving_item_tax').show();
            }
        }

        //Return Receiving details
        var length_return = data.items_return.length;
        var items_return_subtotal = 0;
        var returnigst = 0;
        var returncgst = 0;
        var returnTaxDetails = [];
        $('#viewreceiving_return_print_list').remove();
        $('#viewreceiving_return_print_view').append('<div id="viewreceiving_return_print_list">');
        var app = "<div><div class='table-responsive'><table class='table table-borderless'>";
        for (var j = 0; j < length_return; j++) {

            var date = data.items_return[j].returnArray['returnDate'];
            var timeStamp_value = parseInt(date.$date.$numberLong);
            var timeZone = PosnicPro.timeZone();
            var DateFormat = moment(timeStamp_value).tz(timeZone).format('YYYY/MM/DD LT');
            var updateDate = PosnicPro.convertDate(DateFormat);

            var head = '<thead><tr><td>' + (j + 1) + '</td><td><span class="text-danger">' + data.items_return[j].returnArray['returnId'] + '</span></td><td colspan="4"><span class="text-danger">' + updateDate + '</span></td><td colspan="3">' +
                    '<a href="#/receivings/' + data.items_return[j].returnArray['returnObjId'].$oid + '/returnprint" data-module="receivings" data-access = "read" data-id="receivings/' + data.items_return[j].returnArray['returnObjId'].$oid + '/returnprint" data-toggle="tooltip" title="print" class="point-cursor btn btn-success-rgba"><i class="feather icon-printer"></i></a></td></tr><tr class="row100 head">' +
                    '<th></th>' +
                    '<th width="30%"><lang class="lang_name_title">Name </lang></th>' +
                    '<th width="10%"><lang class="lang_price_title">Price </lang></th>' +
                    '<th width="10%"><lang class="lang_qty_title">Qty </lang></th>' +
                    '<th width="30%"><lang class="lang_tax_title">Exclusive (Tax) </lang></th>' +
                    '<th  width="20%" class="text-center"><lang class="lang_total_title">Total </lang></th>' +
                    '</thead>';
            app = app + '' + head + '';

            $.each(data.items_return[j].returnArray['returnValue'], function (key, val) {
                var tax = val.tax;
                var tax_type = val.tax_type;
                if (tax_type === 'exclusive') {
                    var price = val.item_price;
                } else {
                    var price = val.item_price / ((tax / 100) + 1);
                }
                var priceAmount = ((price.toFixed(2)) * val.item_quantity);
                returnigst += val.igst_tax;
                returncgst += val.cgst_tax;
                items_return_subtotal += val.total_amount;

                var tax_percentage = '--';
                if (tax !== 0) {
                    tax_percentage = '' + tax + '%';
                }

                let item_unit = (typeof (val.item_unit) != "undefined" && val.item_unit !== null) ? val.item_unit : 'qty';
                var body = '<tbody><tr> ' +
                        '<td></td>' +
                        '<td width="30%">' + val.item_name + '</td>' +
                        '<td width="10%">' + currency + '&nbsp;<span class="number">' + price + '</span> </td>' +
                        '<td width="10%">' + PosnicPro.formatQuantity(val.item_quantity, item_unit) + ' ' + item_unit + '</td>' +
                        '<td  width="30%" class="text-center">' + tax_percentage + '</td>' +
                        '<td  width="20%" class="text-right">' + currency + '&nbsp;<span class="number">' + val.total_amount + '</span> </td>' +
                        '</tr></tbody>';

                app = app + '' + body + '';

                if (val.tax_fields.length > 0) {
                    var taxItemLength = val.tax_fields.length;
                    for (var y = 0; y < taxItemLength; y++) {
                        var taxItem = val.tax_fields[y];
                        var taxAmount = (priceAmount / 100) * taxItem.tax_value;
                        returnTaxDetails.push({
                            "tax_id": taxItem.tax_id.$oid,
                            "tax_name": taxItem.tax_name,
                            "tax_value": taxAmount
                        });
                    }
                } else if (val.tax_fields.length === 0 && val.tax > 0) {
                    var taxAmount = (priceAmount / 100) * val.tax;
                    let taxName = val.tax_name;
                    let hsn_id = taxName.slice(4);
                    returnTaxDetails.push({
                        "tax_id": hsn_id,
                        "tax_name": taxName,
                        "tax_value": taxAmount
                    });
                }
            });
        }
        app = app + '</table></div></div>';
        $('#viewreceiving_return_print_view').append(app);

        var returnItemData = PosnicPro.nestedTaxCalculation(returnTaxDetails);
        $(returnItemData).each(function (key, val) {
            if ((val.amount).toFixed(2) > 0.00) {
                var rowHTMLTaxLine = ' <tr> ' +
                        '    <td style="display:none;">' + val.tax_id + '</td>' +
                        '    <td>' + val.tax_name + '</td>' +
                        '    <td>' + currency + '&nbsp;<span class="number">' + val.amount + '</span> </td>' +
                        '</tr>';
            }
            $('#detailed_receiving_itemreturn_tax tbody').append(rowHTMLTaxLine);
        });

        $('.hide-receiving-return-tax,#detailed_receiving_itemreturn_tax,#detailed_receiving_return_item_gsttax').hide();

        if (data.return_tax > 0) {
            $('.hide-receiving-return-tax').show();
            $('.receiving_return_tax_view').number(data.return_tax, 2);
        }

        $('#receiving_return_view_totals').number(data.items_return_total, 2);
        $('span.number').number(true, 2);

        /* Indian gst calculation */
        if (PosnicPro.local.get('gst_action') === 'enable' && data.gst === 'enable' && data.supplier_gst_type === 'regular') {
            $('.return-indian-gstr').show();
            if (returnigst > 0) {
                $('.hide-show-igst').show();
                $('.hide-show-scgst').hide();
                $('#detailed_sale_itemreturn_gsttax').show();
                $('.receiving_return_igst_tax_view').number(returnigst, 2);
            } else if (returncgst > 0) {
                $('.hide-show-scgst').show();
                $('.hide-show-igst').hide();
                $('#detailed_sale_itemreturn_gsttax').show();
                $('.receiving_return_csgst_tax_view').number(returncgst, 3);
            } else {
                $('.return-indian-gstr').hide();
                $('#detailed_sale_itemreturn_gsttax').hide();
            }
        } else {
            $('.return-indian-gstr').hide();
            if ($('#detailed_receiving_itemreturn_tax tbody tr').length > 0) {
                $('#detailed_receiving_itemreturn_tax').show();
            }
        }


        //receving total
        $('#receiving_subtotal_amount_view').number(data.items_subtotal, 2);
        $('#receiving_return_subtotal_amount_view').number(data.items_return_subtotal, 2);
        $('.tax-print-hideshow,.percentage-print-hideshow,.amount-print-hideshow').hide();

        // Receiving attachment images / PDFs
        $("#receiving_view_image").html('');

        var images = data.image || [];
        if (!$.isArray(images)) {
            images = images ? [images] : [];
        }

        if (!images.length) {
            $('#show_receiving_image').hide();
        } else {
            $('#show_receiving_image').show();
            $.each(images, function (key, val) {
                if (!val) {
                    return true; // continue
                }

                var image_path = '';
                if (typeof val === 'string') {
                    image_path = val;
                } else if (typeof val === 'object' && val.name) {
                    image_path = val.name;
                }

                if (!image_path) {
                    return true;
                }

                var extension = image_path.substr((image_path.lastIndexOf('.') + 1)).toLowerCase();
                var title = (typeof val === 'object' && val.name) ? val.name : image_path;

                // Use data: URLs for rendering to bypass CSP blocking http://localhost:5000
                var convertFunction = PosnicPro.convertFileToDataURLviaFileReader;
                convertFunction(image_path, function (base64Img) {
                    if (!base64Img) {
                        return;
                    }

                    if (extension === 'pdf') {
                        var pdfCard = '<div class="col-sm-4">' +
                                '<div class="card" style="border: 1px solid #f0eeee;padding-left: 13px; padding-top: 5px; margin-top: 10px;">' +
                                '<iframe class="card-img-top" src="' + base64Img + '" data-toggle="tooltip" title="' + title + '" style="width: 150px;"></iframe>' +
                                '<div class="card-body">' +
                                // Keep download link pointing to original URL
                                '<a class="btn btn-primary-rgba" id="download_image" href="' + image_path + '" target="_blank" download>Download</a>' +
                                '<div>' +
                                '<div>' +
                                '<div>';
                        $('#receiving_view_image').append(pdfCard);
                    } else {
                        var imgCard = '<div class="col-sm-4">' +
                                '<div class="card" style="border: 1px solid #f0eeee;padding-left: 13px; padding-top: 5px; margin-top: 10px;">' +
                                '<img loading="lazy" decoding="async" class="card-img-top" src="' + base64Img + '" data-toggle="tooltip" title="' + title + '" style="width: 150px;">' +
                                '<div class="card-body">' +
                                '<button class="btn btn-primary-rgba" onclick="downloadImage(\'' + image_path + '\')">Download</button>' +
                                '<div>' +
                                '<div>' +
                                '<div>';
                        $('#receiving_view_image').append(imgCard);
                    }
                });
            });
        }

    },
    returnPage: function (page, id) {
        $('#show_last_created_receiving').hide();
        $('#v-pills-purchase').addClass('show active');
        (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') ? $(".purchase-tittle-change").text('திருப்பி அனுப்பிய') : $('.purchase-tittle-change').html('Return');
        $('table#receiving_print tr#cart_content_area').remove();
        $('.page_loader,#osk-container,#clearReceiving,.chat-search,.receving-return-hide').hide();
        $('.page-title-box,#closeReceiving').show();
        $('#receivings_new').show();
        $('#receiving_add_item_name').focus();
        (PosnicPro.local.get('gst_action') === 'enable') ? $('.indian-gstr').show() : $('.indian-gstr').hide();
        PosnicPro.receivings.receivingReturnAction = 'return';
//        $('.changeReceivingText').text('Return');
        (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') ? $('.changeReceivingText').text('திரும்ப கொள்முதல்') : $('.changeReceivingText').text('Return');

        $('#receving_returned_table tbody').html('');
        PosnicPro.receivings.loadEditReceivings(id);
    },
    showReceivingsEditPage: function (id) {
        $('table#receiving_print tr#cart_content_area').remove();
        $('.page_loader,#osk-container,#clearReceiving').hide();
        $('.page-title-box,#closeReceiving,.chat-search,.receving-return-hide').show();
        $('#receivings_new').show();
        db.recevingAutoFocus.get('1').then(function (data) {
            if (data.editReceiving === true) {
                $('#receiving_add_item_name').focus();
            } else {
                $('#receiving_add_item_name').blur();
            }
        });
        PosnicPro.receivings.receivingReturnAction = 'edit';
//        $(".changeReceivingText").text('Update');
        (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') ? $('.changeReceivingText').text('புதுப்பி') : $('.changeReceivingText').text('Update');

        $('#receiving_submit').removeAttr('disabled');
        $('#receving_returned_table tbody').html('');
        PosnicPro.receivings.loadEditReceivings(id);
    },
    /*printing the receiving data held by this function*/
    printReceivings: function (id, name) {
        $('.Hide-Disc,.print-payment-status-hide,.print-sale-notes-hide').hide();
        $('.gst-text-value,.print_igst_tax_view,.cgst-text-value,.print_csgst_tax_view').html('');
        PosnicPro.get('receivings/' + id, function (response) {
            if (response.type === 'success') {
                var data = response.data;
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
                PosnicPro.record_id = id;
                var currency = PosnicPro.local.get('currencySign');
                $('.tax-print-hideshow,.percentage-print-hideshow,.amount-print-hideshow').hide();

                if (name === 'receiving') {
                    var subtotal = data.items_subtotal;
                    var receivingLineTotal = (PosnicPro.roundoff === true) ? Math.round(data.items_total).toFixed(2) : Number(data.items_total).toFixed(2);
                    $('.print-total').html('<strong>' + currency + '&nbsp;<span class="number">' + receivingLineTotal + '</span></strong>');



                    if (parseFloat(data.tax) > 0) {
                        $('.tax-print-hideshow').show();
                        var taxValue = (name === 'receiving') ? data.tax : data.return_tax;
                        $('.view_sales_tax').html(currency + '<span class="number">' + taxValue.toFixed(2) + '</span>');
                    }

                } else {
                    var subtotal = data.items_return_subtotal;
                    var receivingReturnLineTotal = (PosnicPro.roundoff === true) ? Math.round(data.items_return_total).toFixed(2) : Number(data.items_return_total).toFixed(2);
                    $('.print-total').html('<strong>' + currency + '&nbsp;<span class="number">' + receivingReturnLineTotal + '</span></strong>');


                    if (parseFloat(data.return_tax) > 0) {
                        $('.tax-print-hideshow').show();
                        var taxValue = (name === 'receiving') ? data.tax : data.return_tax;
                        $('.view_sales_tax').html(currency + '<span class="number">' + taxValue.toFixed(2) + '</span>');
                    }
                }
                $('.print-subtotal').html(currency + '&nbsp;<span class="number">' + subtotal.toFixed(2) + '</span>');


                $('.print_view_id').html('#' + data.receiving_id);
                $('.print-invoice-payment-mode').html(data.payment_mode);
                $('#barcodeValue').val(data.receiving_id);
                $('.hide_customer_details').show();
                $('.print-custom-title').html('Supplier Details');
                $('.print-name').html(data.supplier_name);
                $('.print-phone').html(data.supplier_phone);
                $('.print-email').html(data.supplier_email);
                $('.print-address').html(data.supplier_address);
                if (data.print_logoimg === true) {
                    $(".branch_image").css("display", "block");
                    let image_path = (PosnicPro.local.get('branchimage') !== "store.png") ? PosnicPro.local.get('branchimage') : 'static/images/default/store.png';
                    $('#printlogoimage img').attr('src', image_path);
                } else {
                    $(".branch_image").css("display", "none");
                }
                PosnicPro.printBarcode();
                var length = data.items.length;
                var length_return = data.items_return.length;
                var itemTotalQty = 0;
                var itemTotalTax = 0;
                $('.print-invoice-a4-table-content tbody').children("tr").remove();
                $('#tax_print_hide tbody').children("tr").remove();
                $('.print-invoice-table-content').html('');
                $('.tax_print_hide tbody').children("tr").remove();
                $('.hide-receiving-print').hide();
                var itemPrintTaxDetails = [];
                if (name === 'receiving') {
                    $('.print-title').html(PosnicPro.local.get('receiving_title'));
                    $('.print_date').text(data.created_date);
                    if (PosnicPro.resolvePrintType() === 'a4') {
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

                            igst += data.items[i].igst_tax;
                            cgst += data.items[i].cgst_tax;

                            let priceAmount = (((price.toFixed(2)) * data.items[i].item_quantity));

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
                            let rowHTMLLine = '<tr><td height="1" colspan="7" style="border-top:1px solid #e4e4e4"></td></tr><tr>\n\
                                <td style="font-weight: 600;" class="article print-deatils-size-family print-details-align">' + PosnicPro.textOverflowPrintEllipsis(data.items[i].item_name, PosnicPro.local.get('printing_max_char'), true) + '</td>' +
                                    '<td class="print-deatils-size-family print-details-align lineitem_hsn" style="color: #646a6e;">' + hsn + '</td>' +
                                    '<td class="print-deatils-size-family print-details-align lineitem_price" style="color: #646a6e;" align="center">' + price.toFixed(2) + '</td>' +
                                    '<td class="print-deatils-size-family print-details-align lineitem_qty" style="color: #646a6e;" align="center">' + PosnicPro.formatQuantity(data.items[i].item_quantity, item_unit) + ' ' + item_unit + '</td>' +
                                    '<td class="print-deatils-size-family print-details-align lineitem_tax" style="color: #646a6e;" align="center">' + tax + ' ' + taxSigns + '</td>' +
                                    '<td class="print-deatils-size-family print-details-align lineitem_total" style="color: #1e2b33;" align="right">' + currency + '&nbsp;<span class="number">' + data.items[i].total_amount + '</span></td>' +
                                    '</tr><tr><td height="1" colspan="7" style="border-bottom:1px solid #e4e4e4"></td></tr>';

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
                        $('table#tax_print_hide tbody').append(rowHTMLTaxLine);
                    } else {
                        $('.tax_detail_print_hideShow').hide();
                        $('.tax_print_hide').html('');
                        var igst = 0;
                        var cgst = 0;
                        var taxText = [];
                        var taxCgstText = [];
                        for (var i = 0; i < length; i++) {
                            igst += data.items[i].igst_tax;
                            cgst += data.items[i].cgst_tax;
                            var tax = data.items[i].tax;
                            var tax_type = data.items[i].tax_type;
                            if (tax_type === 'exclusive') {
                                var price = data.items[i].item_price;
                            } else {
                                var price = data.items[i].item_price / ((tax / 100) + 1);
                            }
                            let priceAmount = (((price.toFixed(2)) * data.items[i].item_quantity));
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
                                $('.tax_detail_print_hideShow').show();
                            }
                            $('.tax_print_hide').append(rowHTMLTaxLine);
                        });
                    }
                } else {
                    $('.print-title').html(PosnicPro.local.get('receiving_return_title'));
                    $('.print_date').text(data.updated_date);
                    if (PosnicPro.resolvePrintType() === 'a4') {
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

                                igst += val.igst_tax;
                                cgst += val.cgst_tax;

                                let priceAmount = (((price.toFixed(2)) * val.item_quantity));


                                var tax = '-';
                                var taxSigns = '-';
                                if (val.tax !== 0) {
                                    tax = val.tax;
                                    taxSigns = '%';
                                    taxText.push(tax + '% &nbsp;');
                                    taxCgstText.push(tax / 2 + '% &nbsp;');
                                }
                                let item_unit = (typeof (val.item_unit) !== "undefined" && val.item_unit !== null) ? val.item_unit : 'qty';
                                itemTotalQty += val.item_quantity;
                                let hsn = (val.tax_fields.length === 0 && val.tax > 0) ? val.tax_name : '--';
                                let rowHTMLLine = '<tr><td height="1" colspan="7" style="border-top:1px solid #e4e4e4"></td></tr><tr>\n\
                                <td style="color: #506fe4;" class="article print-deatils-size-family print-details-align">' + PosnicPro.textOverflowPrintEllipsis(val.item_name, PosnicPro.local.get('printing_max_char'), true) + '</td>' +
                                        '<td class="print-deatils-size-family print-details-align lineitem_hsn" style="color: #646a6e;">' + hsn + '</td>' +
                                        '<td class="print-deatils-size-family print-details-align lineitem_price" style="color: #646a6e;" align="center">' + price.toFixed(2) + '</td>' +
                                        '<td class="print-deatils-size-family print-details-align lineitem_qty" style="color: #646a6e;" align="center">' + PosnicPro.formatQuantity(val.item_quantity, item_unit) + ' ' + item_unit + '</td>' +
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
                        $('.tax_detail_print_hideShow').hide();
                        $('.tax_print_hide').html('');
                        var igst = 0;
                        var cgst = 0;
                        var taxText = [];
                        var taxCgstText = [];
                        for (var i = 0; i < length_return; i++) {
                            $.each(data.items_return[i].returnArray['returnValue'], function (key, val) {
                                igst += val.igst_tax;
                                cgst += val.cgst_tax;
                                var tax = val.tax;
                                var tax_type = val.tax_type;
                                if (tax_type === 'exclusive') {
                                    var price = val.item_price;
                                } else {
                                    var price = val.item_price / ((tax / 100) + 1);
                                }
                                var priceReturnAmount = (((price.toFixed(2)) * val.item_quantity));
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
                                    let taxName = val.tax_name;
                                    let hsn_id = taxName.slice(4);
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
                                $('.tax_detail_print_hideShow').show();
                            }
                            $('.tax_print_hide').append(rowHTMLTaxLine);
                        });
                    }
                }
                PosnicPro.toggleVisibility('lineitem_hsn', '.lineitem_hsn');
                PosnicPro.toggleVisibility('lineitem_price', '.lineitem_price');
                PosnicPro.toggleVisibility('lineitem_qty', '.lineitem_qty');
                PosnicPro.toggleVisibility('lineitem_tax', '.lineitem_tax');
                PosnicPro.toggleVisibility('lineitem_total', '.lineitem_total');
                PosnicPro.toggleVisibility('print_qty', '.print_qty');
                PosnicPro.toggleVisibility('print_roundoff', '.print_roundoff');

                /* Indian gst calculation */
                $('.taxgst_print_hide,.tax_print_hide').hide();
                $('#tax_print_hide').hide();
                if (PosnicPro.local.get('gst_action') === 'enable' && data.gst === 'enable' && data.supplier_gst_type === 'regular') {
                    $('.indian-gstr').show();
                    if (parseFloat(igst) > 0) {
                        $('.hide-show-igst').show();
                        $('.hide-show-scgst').hide();
                        $('#heading_chnge').hide();
                        $('.taxgst_print_hide').show();
                        $('.gst-text-value').html(PosnicPro.removeDuplicates(taxText));
                        $('.print_igst_tax_view').html(currency + '<span class="number">' + igst.toFixed(2) + '</span>');
                    } else if (parseFloat(cgst) > 0) {
                        $('.hide-show-scgst').show();
                        $('.hide-show-igst').hide();
                        $('#heading_chnge').hide();
                        $('.taxgst_print_hide').show();
                        $('.cgst-text-value').html(PosnicPro.removeDuplicates(taxCgstText));
                        $('.print_csgst_tax_view').html(currency + '<span class="number">' + cgst.toFixed(2) + '</span>');
                    } else {
                        $('.indian-gstr').hide();
                        $('.taxgst_print_hide').hide();
                    }
                } else {
                    $('.indian-gstr').hide();
                    if (PosnicPro.resolvePrintType() === 'a4') {
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
                $('.total-noof-item').html(itemTotalQty.toFixed(2));
                $('span.number').number(true, 2);

                var contents = $(".print-modal-body").html();
                var contentone = $(".print-modal-a4-body").html();
                var canvas = document.getElementById("canvasTarget");
                var img = data.receipt_barcode === true ? canvas.toDataURL("image/png") : '';
                PosnicPro.printView(PosnicPro.resolvePrintType() === 'a4' ? contentone : contents, img);
                $('.invoice-table-content div').empty();
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        });
    },
    /*Perticular Returned printing the receiving data held by this function*/
    returnPrintReceivings: function (id) {
        $('.print-sale-notes-hide').hide();
        var data = {
            id: id
        };
        var params = {
            url: 'receivings/returnPrintDetails',
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
                $('.print-title').html(PosnicPro.local.get('receiving_return_title'));
                $('.print_date').text(data.date);
                $('.print_view_id').html('#' + data.receiving_id);
                $('.print-invoice-payment-mode').html(data.payment_mode);
                $('.barcodeValue').val(data.receiving_id);
                $('.hide_customer_details').show();
                $('.print-custom-title').html('Supplier Details');
                $('.print-name').html(data.supplier_name);
                $('.print-phone').html(data.supplier_phone);
                $('.print-email').html(data.supplier_email);
                $('.print-address').html(data.supplier_address);
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
                if (PosnicPro.resolvePrintType() === 'a4') {
                    var rowHTMLTaxLine;
                    var igst = 0;
                    var cgst = 0;
                    var taxText = [];
                    var taxCgstText = [];
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

                        igst += response.data.return_data[i].item_igst_tax;
                        cgst += response.data.return_data[i].item_cgst_tax;

                        subTotal += (price * response.data.return_data[i].item_quantity);
                        grandTotal += response.data.return_data[i].item_total_amount;
                        if (discountSign === '%') {
                            var priceAmount = (((price.toFixed(2)) * response.data.return_data[i].item_quantity) - (((price.toFixed(2)) * response.data.return_data[i].item_quantity) * (discount / 100)));
                        } else {
                            var priceAmount = (((price.toFixed(2)) * response.data.return_data[i].item_quantity) - (discount * response.data.return_data[i].item_quantity));
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
                    $('.tax_detail_print_hideShow').hide();
                    $('.tax_print_hide').html('');
                    var igst = 0;
                    var cgst = 0;
                    var taxText = [];
                    var taxCgstText = [];
                    for (var i = 0; i < length; i++) {
                        igst += response.data.return_data[i].item_igst_tax;
                        cgst += response.data.return_data[i].item_cgst_tax;
                        var discount = (response.data.return_data[i].item_discount > 0) ? response.data.return_data[i].item_discount : response.data.return_data[i].item_discount_percentage;
                        var discountSign = (response.data.return_data[i].item_discount > 0) ? currency : '%';
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
                        let item_unit = (typeof (response.data.return_data[i].item_unit) !== "undefined" && response.data.return_data[i].item_unit !== null) ? response.data.return_data[i].item_unit : 'qty';
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

                    }
                    var taxPrintItemData = PosnicPro.nestedTaxCalculation(itemPrintTaxDetails);
                    $(taxPrintItemData).each(function (key, val) {
                        if ((val.amount).toFixed(2) > 0.00) {
                            var rowHTMLTaxLine = '<div class="row">' +
                                    '<div class="col-md-offset-2 col-sm-offset-2 col-xs-offset-2 col-md-8 col-sm-8 col-xs-8"><div class="invoice-footer-heading"></div></div>' +
                                    '<div class="col-md-8 col-sm-8 col-xs-6"><div class="invoice-footer-value">' + val.tax_name + '%</div></div>' +
                                    '<div class="col-md-4 col-sm-4 col-xs-6"><div class="invoice-footer-valuew invoice-payment text-right">' + currency + '&nbsp;<span class="number">' + val.amount + '</div></div>' +
                                    '</div>';
                            $('.tax_detail_print_hideShow').show();
                        }
                        $('.tax_print_hide').append(rowHTMLTaxLine);
                    });
                }
                PosnicPro.toggleVisibility('lineitem_hsn', '.lineitem_hsn');
                PosnicPro.toggleVisibility('lineitem_price', '.lineitem_price');
                PosnicPro.toggleVisibility('lineitem_qty', '.lineitem_qty');
                PosnicPro.toggleVisibility('lineitem_tax', '.lineitem_tax');
                PosnicPro.toggleVisibility('lineitem_total', '.lineitem_total');
                PosnicPro.toggleVisibility('print_qty', '.print_qty');
                PosnicPro.toggleVisibility('print_roundoff', '.print_roundoff');
//                var DiscountCal = subTotal - (grandTotal - itemTotalTax);
//                var itemTotalDis = Math.abs(DiscountCal);
                if (parseFloat(data.discount) > 0) {
                    $('.amount-print-hideshow').show();
                    $('.view_sales_discount').html(currency + '&nbsp;<span class="number">' + data.discount + '</span>');
                }

                if (parseFloat(data.tax) > 0) {
                    $('.tax-print-hideshow').show();
                    $('.view_sales_tax').html(currency + ' &nbsp;<span class="number">' + itemTotalTax.toFixed(2) + '</span>');
                }

                /* Indian gst calculation */
                $('.taxgst_print_hide,.tax_print_hide').hide();
                $('#tax_print_hide').hide();
                if (PosnicPro.local.get('gst_action') === 'enable' && data.gst === 'enable' && data.supplier_gst_type === 'regular') {
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

                    if (PosnicPro.resolvePrintType() === 'a4') {
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
                $('.total-noof-item').html(itemTotalQty.toFixed(2));
                $('.print-subtotal').html(currency + '&nbsp;<span class="number">' + subTotal + '</span>');
                $('.print-total').html('<strong>' + currency + '&nbsp;<span class="number">' + grandTotal + '</span></strong>');

                $('span.number').number(true, 2);
                var contents = $(".print-modal-body").html();
                var contentone = $(".print-modal-a4-body").html();
                var canvas = document.getElementById("canvasTarget");
                var img = data.receipt_barcode === true ? canvas.toDataURL("image/png") : '';
                PosnicPro.printView(PosnicPro.resolvePrintType() === 'a4' ? contentone : contents, img);
                $('.invoice-table-content div').empty();

            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    receivingPdf: function (id) {
        window.open(API_URL + 'receivings/receivingsPdf?id=' + id, "_blank");
        hasher.setHash('purchaseorders');
    },
    /* Loyverse study L2: the same PDF, mailed to the supplier. Leave the
       address empty to use the supplier's saved email - the server owns
       that lookup and answers honestly when there is none. */
    emailToSupplier: function (id) {
        swal({
            title: 'Email purchase order',
            text: 'Leave empty to use the supplier\'s saved email address',
            input: 'text',
            inputPlaceholder: 'supplier@example.com (optional)',
            showCancelButton: true,
            confirmButtonText: 'Send'
        }).then(function (result) {
            /*
             * The typed address was being thrown away.
             *
             * This page bundles SweetAlert2 v6, which resolves with the input
             * STRING; the {value, dismiss} object arrived in v7. So
             * `result.value` was always undefined, `to` went up as undefined,
             * the server fell back to the supplier's saved address and
             * answered "the supplier has no email address" - to somebody who
             * had just typed one. The message was true about the supplier and
             * useless about what had happened.
             *
             * Both shapes are read, so upgrading the library later cannot
             * quietly break it back.
             */
            if (result && result.dismiss) { return; }
            var typed = (result && typeof result === 'object') ? result.value : result;
            /* v6 resolves a confirm with `true` when there is nothing typed. */
            typed = String(typed == null || typed === true ? '' : typed).trim();

            PosnicPro.post({
                url: 'receivings/emailToSupplier',
                data: JSON.stringify({ id: id, to: typed || undefined })
            }, function (response) {
                PosnicPro.alert(response.type, response.message);
            }, function (xhr) {
                var resp = {};
                try { resp = JSON.parse(xhr.responseText); } catch (e) { /* plain */ }
                PosnicPro.alert('error', resp.message || 'Could not send the email');
            });
        /* v6 REJECTS with 'cancel' when the dialog is dismissed. Without this
           every cancelled dialog raised an unhandled rejection. */
        }).catch(function () { /* dismissed */ });
    },
    receivedProcess: function (id) {
        PosnicPro.get('receivings/' + id, function (response) {
            if (response.type === 'success') {
                data = response.data;
                var itemDetails = [];
                var itemValue = data.items;
                $(itemValue).each(function (key, val) {

                    if (val.igst_tax > 0) {
                        var gst = val.igst_tax;
                    } else {
                        gst = val.cgst_tax * 2;
                    }
                    let item_unit = val.item_unit;
                    let item_name = val.item_name;
                    let item_price = val.item_price;
                    let item_quantity = val.item_quantity;
                    let item_id = val.item_id;
                    let total_amount = val.total_amount;
                    let barcode_id = val.barcode_id;
                    let tax = val.tax;
                    itemDetails.push({item_unit: item_unit, item_name: item_name, item_price: item_price, item_quantity: item_quantity, item_id: item_id, total_amount: total_amount, barcode_id: barcode_id, gst: gst, item_tax: tax});
                });
                var params = {
                    url: 'receivings/receivedReceiving',
                    data: JSON.stringify({
                        date: data.date,
                        receiving_total: data.total_amount,
                        supplier_id: data.supplier_id,
                        supplier_name: data.supplier_name,
                        supplier_address: data.supplier_address,
                        supplier_phone: data.supplier_phone,
                        supplier_email: data.supplier_email,
                        supplier_state: data.supplier_state,
                        supplier_gst_type: data.supplier_gst_type,
                        supplier_gst_number: data.supplier_gst_number,
                        payment_mode: data.payment_mode,
                        status: 'Received',
                        tax: data.tax,
                        igst_tax: data.igst,
                        csgst_tax: data.cgst,
                        discount: data.discount,
                        //discount_percentage: data.discount_percentage,
                        payment_description: data.payment_description,
                        print: ($('.autoprint').is(':checked', true)) ? 'on' : 'off',
                        items: itemDetails,
                        id: id,
                        alternative_id: data.receiving_id,
                        image: data.image,
                        exclusive_tax: data.exclusive_tax
                    })
                };
                PosnicPro.post(params, function (response) {
                    if (response.type === 'success') {

                        PosnicPro.stocklogs.viewLowStockDashboard();
                        if (response.data.print === true) {
                            PosnicPro.receivings.view.printReceivings(response.data.receiving_id, 'receiving');
                        }
                        PosnicPro.receivings.receivingsTable('receivings');
                        PosnicPro.alert(response.type, response.message);
                    } else {
                        PosnicPro.alert(response.type, response.message);
                    }
                }, function (xhr) {
                    var response = jQuery.parseJSON(xhr.responseText);
                    PosnicPro.alert(response.type, response.message);
                });
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        });
    }
};
$('.receiving_id_print').click(function () {
    let name = $(this).data('id');
    PosnicPro.receivings.view.printReceivings(this.value, name);
    var parts = currentHash.split('/');
    hasher.setHash(parts[0] + '/' + this.value);
});
function downloadImage(url) {
    var filename = url.substring(url.lastIndexOf("/") + 1).split("?")[0];
    var xhr = new XMLHttpRequest();
    xhr.responseType = 'blob';
    xhr.onload = function () {
        var a = document.createElement('a');
        a.href = window.URL.createObjectURL(xhr.response); // xhr.response is a blob
        a.download = filename; // Set the file name.
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        delete a;
    };
    xhr.open('GET', url);
    xhr.send();
}