PosnicPro.receivings = {
    addLineReceivingTable: [],
    returnLineReceivingTable: [],
    suggestionParam: [],
    receivingAddAction: false,
    receivingReturnAction: 'add',
    receivingAddId: '',
    receivingId: '',
    editPriceAction: 'add',
    receivingsEditParams: [],
    imageParams: [],
    deleteConfirmation: false,
    callbackRegistry: {
        name: '',
        arguments: ''
    },
    form_data: new FormData(),
    showPaymentMode: function (payment_mode) {
        $("#receiving_add_payment_mode").empty();
        let paymentMethod = "";
        let ReceivingPaymentType = PosnicPro.configPaymentType;
        $('#receiving_add_payment_mode').append('<option value="Cash" selected="selected">Cash</option>');
        if (ReceivingPaymentType.leght !== 0) {
            $.each(ReceivingPaymentType, function (key, val) {
                if (val.payment_value !== payment_mode) {
                    paymentMethod = '<option value="' + val.payment_value + '">' + val.payment_value + ' </option>';
                    $('#receiving_add_payment_mode').append(paymentMethod).trigger('change');
                }
            });
        }
        if (payment_mode !== '' && payment_mode !== 'Cash') {
            $('#receiving_add_payment_mode').append('<option value=" ' + payment_mode + ' " selected="selected"> ' + payment_mode + ' </option>');
        }
    },
    showAdd: function () {
        PosnicPro.receivings.showPaymentMode('');
        (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') ? $('.purchase-tittle-change').text('புதிய') : $('.purchase-tittle-change').text('New');
//        $('.changeReceivingText').text('Save');
        (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') ? $('.changeReceivingText').text('சேமி') : $('.changeReceivingText').text('Save');
        PosnicPro.HideSideBarModal();
        $('#receiving_submit').removeAttr('disabled');
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $(".vertical-menu li a").removeClass("active");
        (PosnicPro.local.get('gst_action') === 'enable') ? $('.indian-gstr').show() : $('.indian-gstr').hide();
        $('#receving_returned_table tbody').html('');
        $('#receiving_return_view_table').html('');
        $('#show-already-return-table').hide();
        if (PosnicPro.receivings.receivingReturnAction === 'return' || PosnicPro.receivings.receivingReturnAction === 'edit') {
            PosnicPro.receivings.clearReceivingForm();
        }
        PosnicPro.receivings.ReceivingFormadd();
        PosnicPro.receivings.receivingReturnAction = 'add';
        $('.page_loader,#osk-container,.hide-add-page').hide();
        $(".popup_closed").css("display", "none");
        $('.page-title-box,#receivings_new,#receiving-status-open,.chat-search,.receving-return-hide').show();
        /*New Receiving*/
        db.recevingAutoFocus.get('1').then(function (data) {
            if (data.addReceiving === true) {
                $('#receiving_add_item_name').focus();
            } else {
                $('#receiving_add_item_name').blur();
            }
        });
        $('#receiving_add_date').addClass('commonDate');
        $('#receiving_add_date').removeClass('commonEditDate');
        PosnicPro.commonDate();
        $('#receiving_image_upload').attr('src', 'static/images/default/receiving.png');
        //$('#receiving_logo').val('receiving.png');
        $('.fileupload-preview').html('Upload file');
        $('.update-button').attr('disabled', 'disabled').removeClass('btn-outline-success');
        PosnicPro.collapseMenuForWorkspace();
        $('#v-pills-purchase-tab,.receiving_new_shortcut').addClass('active');
        $('#v-pills-purchase').addClass('show active');
        $('.vertical-menu li a#view_purchaseorders_page').addClass('active');
        $('.dashboard_img_menu').hide();
        $('#image_sidebar_purchase').show();
        $('#item_upload_receiving_status').val('no');
        $('#show_last_created_receiving').hide();
        var loader = $(".loader-receiving");
        loader.find(".loadingSpinner:first").remove();
    },
    showEdit: function (id) {
        $('#receiving_add_date').removeClass('commonDate');
        $('#receiving_add_date').addClass('commonEditDate');
        (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') ? $('.purchase-tittle-change').text('திருத்தப்பட்ட') : $('.purchase-tittle-change').text('Edit');
        $('#show-already-return-table').hide();
        $('#v-pills-purchase').addClass('show active');
        (PosnicPro.local.get('gst_action') === 'enable') ? $('.indian-gstr').show() : $('.indian-gstr').hide();
        $('#item_upload_receiving_status').val('no');
        PosnicPro.receivings.view.showReceivingsEditPage(id);
        var loader = $(".loader-receiving");
        loader.find(".loadingSpinner:first").remove();
    },
    showDelete: function (id) {
        PosnicPro.deleteTableRowData(id, 'receivings');
    },
    showPdf: function (id) {
        PosnicPro.receivings.view.receivingPdf(id);
    },
    showReceived: function (id) {
        PosnicPro.receivings.view.receivedProcess(id);
    },
    showPrint: function (id) {
        PosnicPro.receivings.view.printReceivings(id, 'receiving');
    },
    showReturnPrint: function (id) {
        PosnicPro.receivings.view.returnPrintReceivings(id);
    },
    showDetails: function (id) {
        var loader = $(".loader-view-receiving");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.showViewModal('receivings');
        PosnicPro.receivings.view.viewReceiving(id);
    },
    showDataTablePage: function () {
        /* Purchase History retired (owner order): purchases has ONE surface.
           Old links, bookmarks and post-action redirects all land there. */
        hasher.setHash('purchaseorders');
    },
    searchItemReceiving: function (id) {
        var matched = false;
        for (var key in PosnicPro.receiving_lineitems) {
            if (PosnicPro.receiving_lineitems.hasOwnProperty(key)) {
                if (PosnicPro.receiving_lineitems[key].item_id === id) {
                    matched = PosnicPro.receiving_lineitems[key];
                }
            }
        }
        return matched;
    },
//ADD LINE ITEM FOR receiving
    /* Loyverse study L2: fill the order from the chosen supplier - every
       item they supply, or only the ones at/below the low-stock range the
       dashboard already uses. Each row rides the normal add-line path, so
       duplicates increment and all the line math stays untouched. */
    autofillFromSupplier: function (lowStockOnly) {
        var supplierId = $('#receiving_add_supplier_id').val();
        if (!supplierId) {
            PosnicPro.alert('warning', 'Choose a supplier first');
            return;
        }
        var range = localStorage.getItem('notificationrange') || 10;
        PosnicPro.get({
            url: 'items/bySupplier',
            data: 'supplier_id=' + encodeURIComponent(supplierId) +
                '&low_stock=' + (lowStockOnly ? 'true' : 'false') +
                '&notificationrange=' + encodeURIComponent(range)
        }, function (response) {
            var rows = (response && response.data) || [];
            if (!rows.length) {
                PosnicPro.alert('info', lowStockOnly
                    ? 'No low-stock items for this supplier'
                    : 'No items linked to this supplier');
                return;
            }
            rows.forEach(function (row) {
                PosnicPro.receivings.addReceivingLineItems(row);
            });
            PosnicPro.alert('success', rows.length + (lowStockOnly ? ' low-stock' : '') + ' item(s) added from the supplier');
        }, function () {
            PosnicPro.alert('error', 'Could not load the supplier items');
        });
    },
    addReceivingLineItems: function (param) {
        $('table#receiving_print tr#cart_content_area').remove();
        $('#receving_tab_list').show();
        $('#receiviing_img_hide').hide();
        let id = param.item_id;
        //let Tax_type = param.tax_type;
        let Tax_type = 'exclusive';
        let item_quantity = (typeof (param.item_quantity) != "undefined" && param.item_quantity !== null) ? param.item_quantity : 1;
        let item = PosnicPro.receivings.searchItemReceiving(id);
        if (item !== false) {
            var prev_item_qunty = $('#addReceivingLineItemQty_' + id).val();
            item_quantity = parseInt(item_quantity) + parseInt(prev_item_qunty);
        }
        let taxTypeText;
        let tax_itemprice;
        let updatePrice = param.company_price * item_quantity;

        if ($('#exclusive_tax').is(':checked')) {
            $('.show-hide-exc-tax').show();
            var lineItemTax = (param.tax_type === 'exclusive') ? param.tax : 0;
        } else {
            $('.show-hide-exc-tax').hide();
            var lineItemTax = 0;
        }
        let taxGst = 0;
        let subTaxGst = 0;
        let line_total = 0;
        let addReceivingTaxValue = updatePrice;
        if (Tax_type === 'exclusive') {
            let tax_value = (addReceivingTaxValue / 100) * parseFloat(lineItemTax);
            line_total = addReceivingTaxValue + tax_value;
            taxGst = tax_value;
            taxTypeText = "Exc";
            tax_itemprice = param.company_price;
        } else {
            taxTypeText = "Inc";
            var tax_price = (param.company_price * param.tax) / (100 + param.tax);
            tax_itemprice = (param.company_price - tax_price);
            let inclusive_tax_value = tax_itemprice * item_quantity;
            let inclusive_tax_total = (inclusive_tax_value / 100) * lineItemTax;
            line_total = parseFloat(inclusive_tax_value.toFixed(2)) + parseFloat(inclusive_tax_total.toFixed(2));
            subTaxGst = (tax_itemprice / 100) * parseFloat(param.tax);
            taxGst = subTaxGst * item_quantity;
        }
        /*
         * Unit conversion assist (V3): a "×N box" button when the item
         * declares a purchase unit. The cashier types how many PACKS
         * arrived, taps it once, and the qty becomes base units - the
         * only thing stock has ever counted. Explicit tap, never implicit:
         * a supplier who delivers loose pieces types pieces as always.
         */
        var convFactor = Number(param.conversion_factor) || 0;
        var convUnit = String(param.purchase_unit || '').trim();
        var convBtn = (convFactor > 1 && convUnit)
            ? '<div class="input-group-append">' +
              '<span class="btn btn-warning-rgba" data-toggle="tooltip" title="Convert packs to units: multiplies the quantity by ' + convFactor + '" ' +
              'onclick="PosnicPro.receivings.applyUnitConversion(\'' + id + '\', ' + convFactor + ');">&times;' + convFactor + ' ' + convUnit + '</span>' +
              '</div>'
            : '';
        var addLineItemQty = '<div class="input-group" id="return_input_group_' + id + '">' +
                '<div class="input-group-prepend">' +
                '<span class="btn btn-secondary-rgba receive_qty_check" id = ' + id + '  onclick="PosnicPro.receivings.qtyIncrementDecrease(this.id,0);"><i class="feather icon-minus"></i></span>' +
                '</div>' +
                '<input type="text" minlength="1" maxlength="5" size="3" min="0" max="100000" class="form-control cart-qty font_size14 float rec_sale_inp_val" inputmode="decimal" id="addReceivingLineItemQty_' + id + '" value=' + item_quantity + ' onkeyup="PosnicPro.receivings.addLineReceivingChangeQty(\'' + id + '\');" style="text-align:center;" oninput="this.value = PosnicPro.minmax(this.value, 0, 100000)" onkeypress="PosnicPro.validate(event)" autocomplete="off">' +
                '<div class="input-group-append">' +
                '<span class="btn btn-success-rgba receive_qty_check" id = ' + id + '  onclick="PosnicPro.receivings.qtyIncrementDecrease(this.id,1);"><i class="feather icon-plus"></i></span>' +
                '</div>' +
                convBtn +
                '</div>';
        if (PosnicPro.receivings.receivingReturnAction !== 'return') {
            var remove = '<td id=addReceivingRemoveLineItem_' + id + '>' +
                    '<button type="button" class="btn btn-danger-rgba mb-1" onclick="PosnicPro.receivings.removeLineItemReceiving(\'' + id + '\');"  aria-label="Delete"><i class="feather icon-trash"></i></button>' +
                    '</td>';
            $('#return_hide_text').show();
            $('#return_show_text').hide();
            var checkbox = '';
        } else {
            var remove = '';
            $('#return_show_text').show();
            $('#return_hide_text').hide();
            var checkbox = '<td class="text-center">' +
                    '<input type="checkbox" id=addReceivingCheckedLineItem_' + id + ' onclick="PosnicPro.receivings.checkedItemReceiving(\'' + id + '\');" checked="checked">' +
                    '</td>';
        }

        let item_unit = (typeof (param.item_unit) != "undefined" && param.item_unit !== null) ? param.item_unit : "qty";
        var rowHTMLLine = ' <tr id="receiving_row_' + id + '" class="touch-sales-hover-effect border-top pt-3"> ' +
                '   <span>' + checkbox + ' </span>' +
                '   <td id=addReceivingLineItemName_' + id + ' width="30%" class="font_size14">' + param.item_name + '</td>' +
                '   <td class="text-center add_circle font_size14">' + addLineItemQty + '</td>' +
                '   <td name ="addReceivingLineItemUnit" id="addReceivingLineItemUnit_' + id + '">' + item_unit + '</td>' +
                '   <td id=addReceivingLineItemPrice_' + id + ' class="text-center font_size14">' + tax_itemprice.toFixed(2) + '&nbsp;&nbsp;<span class="receving-return-hide"><i class="feather icon-edit-1 text-success" onclick="return PosnicPro.receivings.editItemCompanyPriceReceiving(this);"  data-id="' + id + '" data-toggle="tooltip" title="Edit item price" style="cursor:pointer;"></i></span></td>' +
                '   <td name="addReceivingLineItemTax" id="addReceivingLineItemTax_' + id + '" class="text-center font_size14 show-hide-exc-tax" style="display:none;">' + lineItemTax + '<span>%</span>&nbsp;&nbsp;<span class="receving-return-hide"><i class="feather icon-edit-1 text-success" onclick="return PosnicPro.receivings.editItemTaxReceiving(this);"  data-id="' + id + '" data-toggle="tooltip" title="Edit item tax" style="cursor:pointer;"></i></span></td>' +
                '   <td id=addReceivingLineItemTotal_' + id + ' class="text-right font_size14">' + line_total.toFixed(2) + '</td>' +
                '   <span>' + remove + ' </span>' +
                '   <td id=addReceivingLineItemId_' + id + ' class="col-md-1" style="display:none;">' + id + '</td>' +
                '   <td id=addReceivingBarcodeId_' + id + ' class="col-md-1"  style="display:none;">' + param.barcode_id + '</td>' +
                '   <td id="addReceivingAvailableQty_' + id + '" style="display:none;">' + param.available_quantity + '</td>' +
                '   <td name="addReceivingItemTax" id="addReceivingItemTax_' + id + '" class="text-center" style="display:none;">' + lineItemTax + '</td>' +
                '   <td name="addReceivingLineTaxtype" id="addReceivingLineTaxtype_' + id + '" class="text-center" style="display:none;"><span>' + taxTypeText + '</span></td>' +
                '   <td id=addpurchasePrice_' + id + ' class="text-center" style="display:none;">' + param.company_price + '</td>' +
                '   <td id="addReceivingGstTax_' + id + '" style="display:none;">' + taxGst + '</td>' +
                '   </tr>';
        if ($('table#receiving_print').find('#receiving_row_' + id).length > 0) {
            $('#receiving_row_' + id).replaceWith(rowHTMLLine);
            $('#receiving_row_' + id).remove();
            $('#receiving_print tbody').prepend(rowHTMLLine);
        } else {
            $('#receiving_print tbody').prepend(rowHTMLLine);
        }
        $('#receiving_row_' + id).addClass('table-highlight-row');
        setTimeout(function () {
            $('#receiving_row_' + id).removeClass('table-highlight-row');
        }, 500);
        (PosnicPro.receivings.receivingReturnAction === 'return') ? $('.receving-return-hide').hide() : $('.receving-return-hide').show();
        $('.update-button').removeAttr('disabled').addClass('btn-outline-success');
        if (PosnicPro.receivings.receivingAddAction === true) {
            PosnicPro.receivings.loadEditReceivingValue();
        }
        if ($('#exclusive_tax').is(':checked')) {
            $('.show-hide-exc-tax').show();
        } else {
            $('.show-hide-exc-tax').hide();
        }
        PosnicPro.receiving_lineitems[id] = {
            row_id: id,
            item_id: id,
            item_name: param.item_name,
            item_price: param.company_price,
            item_quantity: item_quantity,
            item_unit: item_unit,
            available_qnty: param.available_quantity,
            barcode_id: param.itemid,
            tax: taxGst,
            tax_percentage: (param.tax_type === 'exclusive') ? param.tax : 0
        };
        $('#item_id, #receiving_add_item_name, #barcode_id, #receiving_add_selling_price, #receiving_add_available_stock, #row_id, #receiving_add_line_total').val('');
        PosnicPro.receivings.addReceivingTableRowCalc();
        let hash = window.location.hash.slice(1);
        let receivingAddId = PosnicPro.local.get('receivingAddId');
        if (hash === '/receivings/new') {
            db.recevingAutoFocus.get('1').then(function (data) {
                if (data.addReceiving === true) {
                    $('#receiving_add_item_name').focus();
                } else {
                    $('#receiving_add_item_name').blur();
                }
            });
        }
        if (hash === '/receivings/' + receivingAddId + '/edit') {
            db.recevingAutoFocus.get('1').then(function (data) {
                if (data.editReceiving === true) {
                    $('#receiving_add_item_name').focus();
                } else {
                    $('#receiving_add_item_name').blur();
                }
            });
        }
    },
    // +/- quantity calculations
    qtyIncrementDecrease: function (id, action) {
        var oldValue = parseFloat($('#addReceivingLineItemQty_' + id).val());
        let value;
        var checkValue = (parseFloat(oldValue));


        if (action === 1) {
            if (oldValue != NaN)
            {
                value = (Number.isInteger(checkValue) === false) ? parseFloat(oldValue) + 0.01 : parseFloat(oldValue) + 1;
                value = (Number.isInteger(value) === false) ? value.toFixed(2) : value;
                $('#addReceivingLineItemQty_' + id).val(value);
            }
        } else {
            if (oldValue != NaN)
            {
                if (oldValue > 1) {
                    value = (Number.isInteger(checkValue) === false) ? parseFloat(oldValue) - 0.01 : parseFloat(oldValue) - 1;
                    value = (Number.isInteger(value) === false) ? value.toFixed(2) : value;
                    $('#addReceivingLineItemQty_' + id).val(value);
                }
            }
        }
        PosnicPro.receivings.addLineReceivingChangeQty(id);
    },
    loadEditReceivingValue: function () {
        (PosnicPro.receivingsEditParams.receiving_exclusive_tax === 'on') ? $("#exclusive_tax").prop('checked', true) : $("#exclusive_tax").prop('checked', false);
        $("#receiving_add_supplier_id").val(PosnicPro.receivingsEditParams.receiving_supplier_id);
        $("#receiving_add_supplier_name").val(PosnicPro.receivingsEditParams.receiving_supplier_name);
        $("#receiving_add_supplier_phone").val(PosnicPro.receivingsEditParams.receiving_supplier_phone);
        $("#receiving_add_supplier_email").val(PosnicPro.receivingsEditParams.receiving_supplier_email);
        $("#receiving_add_supplier_address").val(PosnicPro.receivingsEditParams.receiving_supplier_address);
        $("#receiving_add_supplier_state").val(PosnicPro.receivingsEditParams.receiving_supplier_state);
        $("#receiving_add_supplier_gst_type").val(PosnicPro.receivingsEditParams.receiving_supplier_gst_type);
        $("#receiving_add_supplier_gst_number").val(PosnicPro.receivingsEditParams.receiving_supplier_gst_number);
        $("#receiving_discount_amount").val(PosnicPro.receivingsEditParams.receiving_discount_amount);
        $("#receiving_add_payment_description").html(PosnicPro.receivingsEditParams.receiving_payment_description);
        $("#receiving_add_payment_mode option[value='" + PosnicPro.receivingsEditParams.receiving_payment_mode + "']").prop("selected", "selected");

        $('#display-preview').html('');
        var image_name = PosnicPro.receivingsEditParams.receiving_image || [];
        if (!$.isArray(image_name)) {
            image_name = image_name ? [image_name] : [];
        }

        $(image_name).each(function (key, val) {
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

            var filepath;
            if (extension === 'pdf') {
                filepath = '<iframe class="img-thumbnail image_style" src="' + image_path + '" frameborder="0" style="border:none;" data-toggle="tooltip" title="' + escape(title) + '"></iframe>';
            } else {
                filepath = '<img loading="lazy" decoding="async" class="img-thumbnail image_style" src="' + image_path + '" \
                            data-toggle="tooltip" title="' + escape(title) + '" />';
            }

            $('#display-preview').append(
                    '<div id="selector_' + key + '" class="receiving-image-wrapper image-area" style="position: relative;"> \
            <span>' + filepath + ' </span><br /> \
            <a class="remove-image" style="cursor:pointer;display: inline;position: absolute; top: -10px; right: -10px; border-radius: 10em; padding: 2px 6px 3px; text-decoration: none; font: 700 21px/20px sans-serif; background: #f48787; border: 3px solid #fff; color: #FFF; box-shadow: 0 2px 6px rgba(0,0,0,0.5), inset 0 2px 4px rgba(0,0,0,0.3); text-shadow: 0 1px 2px rgba(0,0,0,0.5); -webkit-transition: background 0.5s; transition: background 0.5s;" onclick="PosnicPro.receivings.image_edit_remove_selected(\'' + key + '\',\'' + image_path + '\')">&#215;</a> \
            </div>');

            // Keep only the URL for edit submissions; uploads for new images
            // still go through receiving_image_preview -> uploadReceivingImage.
            PosnicPro.receivings.imageParams[key] = {
                name: image_path
            };
        });

        $('.hide-add-page').show();
        /* Restore EVERYTHING the record carries - the old radio block here
           targeted #open/#received, ids that never existed, so editing a
           Received purchase silently saved it back to Open. */
        var ep = PosnicPro.receivingsEditParams;
        /* A partially received document's status belongs to the Receive
           flow, not the edit page: it shows, locked, and rides through the
           save untouched (the server keeps what arrived as fact). */
        $('#receiving_status_select option[value="Partial"]').remove();
        if (ep.receiving_receiving_status === 'Partial') {
            $('#receiving_status_select')
                .append('<option value="Partial">Partially received</option>')
                .val('Partial')
                .prop('disabled', true)
                .attr('title', 'Managed by the Receive flow - receive or cancel the rest from the purchase document');
            $('#receiving_expected_wrap').show();
        } else {
            $('#receiving_status_select').prop('disabled', false);
            $('#receiving_status_select').val(ep.receiving_receiving_status === 'Received' ? 'Received' : 'Open').trigger('change');
        }
        $('#receiving_itc_eligible').prop('checked', ep.receiving_itc_eligible !== false);
        $('#receiving_expected_date').val(ep.receiving_expected_date ? String(ep.receiving_expected_date).slice(0, 10) : '');
        $('#receiving_invoice_total_declared').val(ep.receiving_invoice_total_declared || '');
        $('#receiving_charges_rows').empty();
        (ep.receiving_additional_charges || []).forEach(function (c) {
            PosnicPro.receivings.addChargeRow(c.label, c.amount);
        });
        PosnicPro.receivings.addReceivingTableRowCalc();
    },
    /* ---- Additional charges (freight etc.) - ride on the total ---- */
    addChargeRow: function (label, amount) {
        $('#receiving_charges_rows').append(
            '<div class="form-row charge-row align-items-center mt-2">'
            + '<div class="col-7"><input type="text" class="form-control form-control-sm charge-label" placeholder="Freight" maxlength="40" aria-label="Charge label"></div>'
            + '<div class="col-4"><input type="number" step="0.01" min="0" class="form-control form-control-sm text-right charge-amount" placeholder="0.00" aria-label="Charge amount"></div>'
            + '<div class="col-1 text-center"><a href="javascript:void(0)" class="charge-remove text-danger" aria-label="Remove charge"><i class="feather icon-x"></i></a></div>'
            + '</div>');
        var row = $('#receiving_charges_rows .charge-row').last();
        if (label !== undefined) { row.find('.charge-label').val(label); }
        if (amount !== undefined) { row.find('.charge-amount').val(amount); }
        if (label === undefined) { row.find('.charge-label').trigger('focus'); }
    },
    collectCharges: function () {
        return $('#receiving_charges_rows .charge-row').map(function () {
            return {
                label: $.trim($(this).find('.charge-label').val() || ''),
                amount: parseFloat($(this).find('.charge-amount').val()) || 0
            };
        }).get().filter(function (c) { return c.amount > 0 || c.label; });
    },
    chargesTotal: function () {
        return PosnicPro.receivings.collectCharges().reduce(function (sum, c) { return sum + c.amount; }, 0);
    },
    addReceivingTableRowCalc: function () {

        PosnicPro.receivings.addLineReceivingTable = $('#receiving_print tbody tr').map(function () {
            let itemid = $(this).find(':nth-child(8)').text();
            return {
                item_name: $('#addReceivingLineItemName_' + itemid).text(),
                item_price: $('#addReceivingLineItemPrice_' + itemid).text(),
                item_quantity: $('#addReceivingLineItemQty_' + itemid).val(),
                item_unit: $('#addReceivingLineItemUnit_' + itemid).text(),
                item_id: $('#addReceivingLineItemId_' + itemid).text(),
                totalamount: $('#addReceivingLineItemTotal_' + itemid).text(),
                gsttaxamount: $('#addReceivingGstTax_' + itemid).text()
            };
        }).get();
        var addReceivingLineTotal = 0;
        var addReceivingLineGstTaxTotal = 0;
        for (var i = 0; i < PosnicPro.receivings.addLineReceivingTable.length; i++) {
            addReceivingLineTotal += parseFloat(PosnicPro.receivings.addLineReceivingTable[i].totalamount);
            addReceivingLineGstTaxTotal += parseFloat(PosnicPro.receivings.addLineReceivingTable[i].gsttaxamount);
        }
        addReceivingLineTotal = (addReceivingLineTotal).toFixed(2);
        if (isNaN('NaN')) {
            $('#receiving_add_subtotal_amount').html('0.00');
            $("#receiving_add_total_amount").text('0.00');
            $("#receiving_total").val('0.00');
        }
        if (addReceivingLineTotal > 0) {

            var tax_value = addReceivingLineGstTaxTotal.toFixed(2);
            $('.tax-receiving-value').html('<span class="number">' + tax_value + '</span>');
            var tot = ((parseFloat(addReceivingLineTotal) - parseFloat(tax_value)));
            $('#receiving_add_subtotal_amount').number(tot, 2);
            /* Additional charges ride on the grand total - never on item
               cost, never on the tax heads. The declared-invoice check uses
               the same base, because the supplier's total includes them. */
            var chargesTotal = PosnicPro.receivings.chargesTotal();
            if (chargesTotal > 0) {
                $('#receiving_charges_row').show();
                $('.charges-receiving-value').text(chargesTotal.toFixed(2));
            } else {
                $('#receiving_charges_row').hide();
            }
            var withCharges = parseFloat(addReceivingLineTotal) + chargesTotal;
            var receivegrandTotal = (PosnicPro.roundoff === true) ? Math.round(withCharges).toFixed(2) : Number(withCharges).toFixed(2);
            $("#receiving_add_total_amount").number(receivegrandTotal, 2);
            $("#receiving_total").val(withCharges.toFixed(2));
            $('span.number').number(true, 2);
        }

        PosnicPro.receivings.invoiceTotalCheck();
    },
    /*
     * P2: the declared invoice total against what the lines add up to.
     * A mismatch WARNS - the goods are already in the shop; the badge makes
     * somebody look, the save never refuses (owner's ruling).
     */
    invoiceTotalCheck: function () {
        var declared = parseFloat($('#receiving_invoice_total_declared').val());
        var note = $('#receiving_invoice_total_note');
        if (!declared || isNaN(declared)) { note.text('').attr('class', 'form-text'); return; }
        var computed = parseFloat($('#receiving_total').val()) || 0;
        if (Math.abs(declared - computed) > 0.5) {
            note.text('Does not match the lines (' + computed.toFixed(2) + ') - saved with a warning flag.')
                .attr('class', 'form-text text-warning');
        } else {
            note.text('Matches the lines.').attr('class', 'form-text text-success');
        }
    },
    /* The credit flag speaks the shop's regime (set once per page load). */
    applyTaxRegimeWording: function () {
        PosnicPro.get({ url: 'setting/taxProfile', data: {} }, function (r) {
            var d = r && r.data;
            if (!d || !d.regime) { return; }
            if (d.regime === 'sales_tax') {
                $('#receiving_itc_label').text('Purchased for resale (tax-exempt)');
            } else if (d.regime === 'none') {
                $('#receiving_itc_eligible').closest('.form-group').hide();
            }
        }, function () { /* wording only */ });
    },
    receivingTextboxQtyChange: function (ItemQty, id) {
        $('#addReceivingLineItemQty_' + id).val(ItemQty);
        $('#addReceivingLineItemPrice_' + id).text();
        var updatePrice = parseFloat($('#addpurchasePrice_' + id).text()) * ItemQty;
        var Tax_type = $('#addReceivingLineTaxtype_' + id).text();
        var TaxValue = parseFloat($('#addReceivingLineItemTax_' + id).text());
        var addSalesTaxValue = updatePrice;
        var tax_value = (addSalesTaxValue / 100) * parseFloat(TaxValue);
        var updateLineItemTotal = addSalesTaxValue + tax_value;
        if (Tax_type === 'Exc') {
            var TaxValue = parseFloat($('#addReceivingLineItemTax_' + id).text());
            var tax_value = (TaxValue / 100) * parseFloat(updatePrice);
            updateLineItemTotal = updatePrice + tax_value;
            var taxGst = tax_value;
        } else {
            updateLineItemTotal = updatePrice;
            var TaxValue = parseFloat($('#addReceivingLineItemTax_' + id).text());
            var inclusive_price = parseFloat($('#addReceivingLineItemPrice_' + id).text()) * ItemQty;
            var taxGst = (inclusive_price / 100) * TaxValue;
        }
        updateLineItemTotal = Number(updateLineItemTotal).toFixed(2);
        $('#addReceivingLineItemTotal_' + id).text(updateLineItemTotal);
        $('#addReceivingGstTax_' + id).text(taxGst.toFixed(2));
        PosnicPro.receivings.addReceivingTableRowCalc();
    },
    /* One tap: packs typed -> base units counted (V3). Reuses the normal
       qty-change path so every price/tax cell recomputes as usual. */
    applyUnitConversion: function (id, factor) {
        var $qty = $('#addReceivingLineItemQty_' + id);
        var current = parseFloat($qty.val());
        if (!current || current <= 0 || !factor || factor <= 1) { return; }
        $qty.val(current * factor);
        PosnicPro.receivings.addLineReceivingChangeQty(id);
    },
    addLineReceivingChangeQty: function (id) {
        var available_quantity = PosnicPro.receiving_lineitems[id].item_quantity;
        var ItemQty = $('#addReceivingLineItemQty_' + id).val();
        if (PosnicPro.receivings.receivingReturnAction === 'return') {
            if (parseInt(available_quantity) < parseInt(ItemQty)) {
                var ItemQty = available_quantity;
                PosnicPro.receivings.receivingTextboxQtyChange(ItemQty, id);
                PosnicPro.receivings.addReceivingTableRowCalc();
                PosnicPro.alert('error', 'Some items are out of stock.');
                return false;
            }
        }
        PosnicPro.receivings.receivingTextboxQtyChange(ItemQty, id);
    },
    /*--------REMOVE LINE ITEMS FOR RECEIVING---------*/
    removeLineItemReceiving: function (id) {
        if (PosnicPro.receivings.deleteConfirmation) {
            $('#receiving_row_' + id).remove();
            $('#receive_out').val('');
            delete PosnicPro.receiving_lineitems[id];
            PosnicPro.receivings.addReceivingTableRowCalc();
            var length = PosnicPro.receivings.addLineReceivingTable.length;
            if (length === 0) {
                PosnicPro.receivings.clearReceivingForm();
                $('.update-button').attr('disabled', 'disabled').removeClass('btn-outline-success');
                $('#clearReceiving').show();
                $('#closeReceiving').show();
            }
            PosnicPro.receivings.deleteConfirmation = false;
        } else {
            PosnicPro.receivings.callbackRegistry = {
                name: 'removeLineItemReceiving',
                arguments: id
            };
            $('#delete_lineitem_modal').modal('show');
            $('#sale_line_item_remove').hide();
            $('#receiving_line_item_remove').show();
        }
    },
    /*delete confirmation*/
    deleteConfirmed: function () {
        $('#delete_lineitem_modal').modal('hide');
        $('#receiving_line_item_remove').hide();
        PosnicPro.receivings.deleteConfirmation = true;
        window['PosnicPro']['receivings']['' + PosnicPro.receivings.callbackRegistry.name](PosnicPro.receivings.callbackRegistry.arguments);
    },
    checkedItemReceiving: function (id) {
        $('#receiving_submit').removeAttr('disabled');
        (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') ? $('.changeReceivingText').text('திரும்ப கொள்முதல்') : $('.changeReceivingText').text('Return');
        if ($('#addReceivingCheckedLineItem_' + id).is(":checked")) {
            $('#return_input_group_' + id).css({cursor: 'pointer', 'pointer-events': 'auto'});
            $('#receiving_row_' + id).css({cursor: 'pointer', background: '#ffffff'});
            $('#addReceivingLineItemQty_' + id).prop("disabled", false);
            var available_quantity = PosnicPro.receiving_lineitems[id].item_quantity;
            PosnicPro.receivings.receivingTextboxQtyChange(available_quantity, id);
        } else {
            $('#return_input_group_' + id).css({cursor: 'not-allowed', 'pointer-events': 'none'});
            $('#receiving_row_' + id).css({cursor: 'not-allowed', background: '#eeecec'});
            $('#addReceivingLineItemQty_' + id).prop("disabled", true);
            PosnicPro.receivings.receivingTextboxQtyChange(0, id);
        }
        var $checkboxes = $('#receiving_print tr td input[type="checkbox"]');
        var countCheckedCheckboxes = $checkboxes.filter(':checked').length;
        if (countCheckedCheckboxes === 0) {
            $('#receiving_submit').attr('disabled', 'disabled');
            $('.tax-receiving-value').text('0.00');
        }
    },
    ReceivingFormadd: function () {

        var length = PosnicPro.receivings.addLineReceivingTable.length;
        if (length === 0) {
            $('#receving_tab_list').hide();
        }
        $('#receive_out').val('');
        $('#receiving_add_item_name').focus();
        $('#clearReceiving').show();
        $('#closeReceiving').hide();
        $('.fileupload-preview').html('Upload file');
        (PosnicPro.local.get('default_supplier_enable_disable') === 'false') ? $('#receiving_add_supplier_id,#receiving_add_supplier_name,#receiving_add_supplier_address,#receiving_add_supplier_phone,#receiving_add_supplier_email,#receiving_add_supplier_state,#receiving_add_supplier_gst_type,#receiving_add_supplier_gst_number').val('') : PosnicPro.defaultSupplierSet();
        PosnicPro.receivings.imageParams = [];
        PosnicPro.receivings.receivingAddAction = false;
        PosnicPro.receivings.receivingId = '';
        PosnicPro.receivings.receivingAddId = '';
    },
    clearReceivingForm: function () {
        $('#receiving_print tbody').children("tr").remove();
        $("#receiving_print").find("tr:not(:first)").remove();
        $('#receving_tab_list').hide();
        $('#receive_out').val('');
        $('table#receiving_print tbody').append('<tr class="cart_content_area" id="cart_content_area"><td colspan="7"><div class="text-center text-dark"> <p><lang class="lang_receive_empty">Receiving Order Empty</lang></p></div></td></tr>');
        $('#receiviing_img_hide').show();
        db.recevingAutoFocus.get('1').then(function (data) {
            if (data.addReceiving === true) {
                $('#receiving_add_item_name').focus();
            } else {
                $('#receiving_add_item_name').blur();
            }
        });
        $('#receiving_add_total_amount,#receiving_add_subtotal_amount').text("0");
        $('.tax-receiving-value,.discount-receiving-value').text("0.00");
        $('#receiving_add_payment_description').val("");
        $('#clearReceiving').show();
        $('#closeReceiving').hide();
        $('#receiving_discount_amount,#receiving_total').val("0");
        $('.fileupload-preview').html('Upload file');
        $('#receiving_upload_image').val('');
        PosnicPro.receiving_lineitems = [];
        PosnicPro.receivings.imageParams = [];
        PosnicPro.receivings.receivingAddAction = false;
        PosnicPro.receivings.receivingId = '';
        PosnicPro.receivings.receivingAddId = '';
        $('#display-preview').html('');
    },
    editItemCompanyPriceReceiving: function (index) {
        var id = $(index).data('id');
        $('#addReceivingLineItemPrice_' + id).editable({
            type: 'text',
            pk: 1,
            title: 'Edit cost',
            inputclass: 'form-control form-control-sm',
            tpl: '<input size="4"></input>',
            validate: function (value) {
                let regex = /^\s*?((\d+(\.\d+)?)|(\.\d+))\s*$/;
                if (!regex.test(value)) {
                    return 'Enter a valid amount!';
                }
            },
            success: function (k, val) {
                $('#addpurchasePrice_' + id + '').text(val);
                $('#addReceivingLineItemPrice_' + id).replaceWith('<td id=addReceivingLineItemPrice_' + id + ' class="text-center font_size14">' + parseFloat(val).toFixed(2) + '&nbsp;&nbsp;<span class="receving-return-hide"><i class="feather icon-edit-1 text-success" onclick="return PosnicPro.receivings.editItemCompanyPriceReceiving(this);"  data-id="' + id + '" data-toggle="tooltip" title="Edit item price" style="cursor:pointer;"></i></span></td>');
                let taxValue = $('#addReceivingLineItemTax_' + id + '').text();
                let excvalue = (val / 100) * parseFloat(taxValue);
                let lineTotal = parseFloat(val) + parseFloat(excvalue);
                $('#addReceivingLineItemTotal_' + id + '').text(lineTotal.toFixed(2));
                $('#addReceivingLineTaxtype_' + id).text('Exc');
                PosnicPro.receivings.addLineReceivingChangeQty(id);
                let params = {
                    method: 'PUT',
                    url: 'receivings/companyPriceUpdate',
                    data: JSON.stringify({
                        item_id: id,
                        item_price: val
                    })
                };
                PosnicPro.request(params, function (response) {
                    if (response.type === 'success') {
                        PosnicPro.alert(response.type, response.message);
                    }
                });
            }
        });
    },
    editItemTaxReceiving: function (index) {
        var id = $(index).data('id');
        let intValue = parseInt($('#addReceivingLineItemTax_' + id + '').text());
        $('#addReceivingLineItemTax_' + id).editable({
            type: 'text',
            pk: 1,
            title: 'Edit tax value',
            inputclass: 'form-control form-control-sm',
            tpl: '<input size="4" min="0" max="100" maxlength="4" onkeyup="this.value=PosnicPro.minmax(this.value,0,100)" onkeypress="return PosnicPro.isNumber(event)"></input>',
            value: intValue,
            validate: function (value) {
                let regex = /^\s*?((\d+(\.\d+)?)|(\.\d+))\s*$/;
                if (!regex.test(value)) {
                    return 'Enter a valid amount!';
                }
            },
            success: function (k, val) {
                $('#addReceivingLineItemTax_' + id + '').text(val);
                $('#addReceivingLineItemTax_' + id).replaceWith('<td id=addReceivingLineItemTax_' + id + ' class="text-center font_size14 show-hide-exc-tax">' + val + '%&nbsp;&nbsp;<span class="receving-return-hide"><i class="feather icon-edit-1 text-success" onclick="return PosnicPro.receivings.editItemTaxReceiving(this);"  data-id="' + id + '" data-toggle="tooltip" title="Edit item tax" style="cursor:pointer;"></i></span></td>');

                let price = $('#addpurchasePrice_' + id + '').text();
                let Excvalue = (price / 100) * parseFloat(val);
                let lineTotal = parseFloat(price) + parseFloat(Excvalue);
                $('#addReceivingLineItemTotal_' + id + '').text(lineTotal.toFixed(2));
                $('#addReceivingLineTaxtype_' + id).text('Exc');
                PosnicPro.receivings.addLineReceivingChangeQty(id);
            }
        });
    },
    editItemPriceReceiving: function (index) {
        let id = $(index).data('id');
        PosnicPro.get('items/' + id, function (response) {
            var data = response.data;
            $('#items_name').val(data.name);
            $('#items_itemid').val(data.itemid);
            $('#items_barcodeid').val(data.barcode_id);
            $('#items_date').val(response.data.item_date);
            $('#items_supplier').val(data.supplier_name);
            $('#items_category').val(data.category_id).trigger("change");
            $('#items_discount_amount').val(data.discount_amount);
            $('#items_discount_percentage').val(data.discount_percentage);
            $('#items_available_quantity').val(data.available_quantity);
            var url = window.location.hash.slice(1);
            if (url === '/receivings/new') {
                PosnicPro.receivings.editPriceAction = 'add';
            } else {
                PosnicPro.receivings.editPriceAction = 'edit';
            }
            if (data.available_quantity > 0) {
                $('#item_title_data').text('Add');
                $('#item_button_title').text('Save');
                $('#items_edit_reset,.items_edit_reset').hide();
                $('#items_reset').show();
                $('#itemid').val('');
                $('#items_company_price').val('0');
                $('#items_mrp_price').val('0');
                $('#items_selling_price').val('0');
                PosnicPro.alert('info', 'This item is already in stock and was added as a new line. Enter its price details.', '10000');
                hasher.changed.active = false; //disable changed signal
                hasher.replaceHash('receivings/items/new');
                hasher.changed.active = true; //enable changed signal
            } else {
                $('#items_mrp_price').val(data.mrp_price);
                $('#items_company_price').val(data.company_price);
                $('#items_selling_price').val(data.selling_price);
                $('#item_title_data').text('Edit');
                $('#item_button_title').text('Update');
                $('#items_edit_reset,.items_edit_reset').show();
                $('#items_reset').hide();
                $('#itemid').val(id);
                hasher.changed.active = false; //disable changed signal
                hasher.setHash('receivings/' + id + '/price');
                hasher.changed.active = true; //enable changed signal
            }
            if (data.hsncode > 0) {
                $('#item_tax_hsncode').prop('checked', true);
                $('#hsn_code_show').show();
                $('#hsn_tax').show().val(data.tax);
                $('#items_tax').hide();
            } else {
                $('#item_tax_default').prop('checked', true);
                $('#hsn_code_show').hide();
                $('#hsn_tax').hide();
                $('#items_tax').show();
            }
            $('#item_upload_image_status').val('no');
            $('#item-display-preview').html('');
            (data.tax_type === 'inclusive') ? $('#item_tax_inclusive').prop('checked', true) : $('#item_tax_exclusive').prop("checked", true);
            $.each(data.multi_image, function (key, val) {
                var image_path = val.name;
                var convertFunction = PosnicPro.convertFileToDataURLviaFileReader;
                convertFunction(image_path, function (base64Img) {
                    var strImage = base64Img.replace(/^data:image\/[a-z]+;base64,/, "");
                    PosnicPro.items.imageParams[key] = {
                        name: val.name,
                        data: strImage,
                        size: base64Img.length,
                        cover: val.cover
                    };
                });
                $('#item-display-preview').append(
                        '<div id="selector_' + key + '" class="receiving-image-wrapper image-area" style="position: relative;"> \
                        <img loading="lazy" decoding="async" class="image_style" class="img-thumbnail" src="' + image_path + '" \
                        title="' + escape(val.name) + '" /><br /> \
                    <span id="coverimage_selector_' + key + '" class="coverImageAdd" style="display: block;border: 1px solid #ddd;border-radius: 5px;margin-top: 2px; background: #506fe4; color: #fff" onclick="PosnicPro.items.coverImageEdit(this.id,\'' + key + '\',\'' + val.name + '\',\'' + val.size + '\')">Choose Cover</span><a class="remove-image" style="cursor:pointer;display: inline;position: absolute; top: -10px; right: -10px; border-radius: 10em; padding: 2px 6px 3px; text-decoration: none; font: 700 21px/20px sans-serif; background: #f48787; border: 3px solid #fff; color: #FFF; box-shadow: 0 2px 6px rgba(0,0,0,0.5), inset 0 2px 4px rgba(0,0,0,0.3); text-shadow: 0 1px 2px rgba(0,0,0,0.5); -webkit-transition: background 0.5s; transition: background 0.5s;" onclick="PosnicPro.items.image_edit_remove_selected(\'' + key + '\',\'' + val.name + '\')">&#215;</a> \
                        </div>');
                if (val.cover === "yes") {
                    $('#item_logo').val(val.name);
                    $('#coverimage_selector_' + key).html('');
                    var styles = {
                        display: 'block',
                        border: '1px solid #ddd',
                        'border-radius': '5px',
                        'margin-top': '2px',
                        background: 'green',
                        color: '#fff'
                    };
                    $('#coverimage_selector_' + key).css(styles).append('Cover');
                }

            });
            $('#items_hsncode').val(data.hsncode);
            $('#items_hsndescription').val(data.hsndescription);
            var branchOption = [];
            $.each(data.branch_access, function (key, val) {
                branchOption.push(val.branch_id.$oid);
                $('#item_branch').select2('val', [branchOption]);
            });
            $('#items_tax option[value="' + data.tax + '"]').attr("selected", true);
            var radionbutton = $('#items_discount_amount').val();
            if (radionbutton > 0) {
                $("#item_radio_discount_amount").prop('checked', 'checked');
                $('#items_discount_percentage').attr('disabled', 'disabled').addClass('bg-white').hide();
                $('#items_discount_amount').removeAttr('disabled', 'disabled').show();
            } else {
                $("#item_radio_discount_percentage").prop('checked', 'checked');
                $('#items_discount_amount').attr('disabled', 'disabled').addClass('bg-white').hide();
                $('#items_discount_percentage').removeAttr('disabled', 'disabled').show();
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
        $('.page_loader,#osk-container').hide();
        $('.page-title-box,#items_new,#item_variant_header').show();
        $('#show_variant_fields').hide();
        $('#show_price_fields').show();
        $('#category_check').val("yes");
        $('#supplier_check').val("yes");
    },
    /*adding new item like purchase new items adding held by this function*/
    addReceivings: function () {
        if (PosnicPro.receivings.receivingAddAction === true) {
            PosnicPro.receivings.editReceivings();
            return false;
        }
        var supplier_name = $("#receiving_add_supplier_name").val();
        if ($('#receiving_print tbody tr').find(':nth-child(8)').text() === '' || supplier_name === '') {
            if (supplier_name === '') {
                $("#receiving_add_supplier_name").focus();
                PosnicPro.alert('error', 'Enter a supplier name.');
                return false;
            }
            PosnicPro.alert('warning', 'Add at least one item.');
            $('#receiving_add_item_name').focus();
            return false;
        } else {
            var loader = $(".loader-receiving");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            PosnicPro.receivings.addLineReceivingTable = $('#receiving_print tbody tr').map(function () {
                let itemid = $(this).find(':nth-child(8)').text();
                //Added Item Unit
                return {
                    item_id: $('#addReceivingLineItemId_' + itemid).text(),
                    item_name: $('#addReceivingLineItemName_' + itemid).text(),
                    item_quantity: $('#addReceivingLineItemQty_' + itemid).val(),
                    item_unit: $('#addReceivingLineItemUnit_' + itemid).text(),
                    total_amount: $('#addReceivingLineItemTotal_' + itemid).text(),
                    gst: $('#addReceivingGstTax_' + itemid).text(),
                    item_tax: parseFloat($('#addReceivingLineItemTax_' + itemid).text())
                };
            }).get();
            var params = {
                url: 'receivings',
                data: JSON.stringify({
                    date: $('#receiving_add_date').val(),
                    supplier_id: $('#receiving_add_supplier_id').val(),
                    supplier_name: $('#receiving_add_supplier_name').val(),
                    supplier_address: $('#receiving_add_supplier_address').val(),
                    supplier_phone: $('#receiving_add_supplier_phone').val(),
                    supplier_email: $('#receiving_add_supplier_email').val(),
                    supplier_state: $('#receiving_add_supplier_state').val(),
                    supplier_gst_type: $('#receiving_add_supplier_gst_type').val(),
                    supplier_gst_number: $('#receiving_add_supplier_gst_number').val(),
                    payment_mode: $('#receiving_add_payment_mode').val(),
                    status: $('.receiving-status').val(),
                    tax: $('.tax-receiving-value').text(),
                    discount: $('.discount-receiving-value').text(),
                    payment_description: $('#receiving_add_payment_description').val(),
                    print: ($('.autoprint').is(':checked', true)) ? 'on' : 'off',
                    items: PosnicPro.receivings.addLineReceivingTable,
                    id: PosnicPro.receivings.receivingAddId,
                    image: PosnicPro.receivings.imageParams,
                    exclusive_tax: ($('#exclusive_tax').is(':checked', true)) ? 'on' : 'off',
                    itc_eligible: $('#receiving_itc_eligible').is(':checked'),
                    expected_date: $('#receiving_expected_date').val(),
                    invoice_total_declared: $('#receiving_invoice_total_declared').val(),
                    additional_charges: PosnicPro.receivings.collectCharges()
                })
            };
            PosnicPro.post(params, function (response) {
                if (response.type === 'success') {
                    PosnicPro.receivings.clearReceivingForm();
                    PosnicPro.commonDate();
                    if (response.data.print === true) {
                        PosnicPro.receivings.view.printReceivings(response.data.receiving_id, 'receiving');
                    }
                    $('#show_last_created_receiving').show();
                    var path = '#/receivings/' + response.data.receiving_id;
                    $('#last_created_receiving').attr('href', path);
                    PosnicPro.alert(response.type, response.message);
                    /*call for updating lowstock report in dashboard navbar dropdown area*/
                    PosnicPro.stocklogs.viewLowStockDashboard();
                    $('#receiving_print tbody').children("tr").remove();
                    $("#receiving_print").find("tr:not(:first)").remove();
//                    $('#receiving_add_item_name').focus();
                    PosnicPro.receiving_lineitems = [];
                    $('#receiving_add_total_amount').text("0");
                    $('#receiving_total').val("0");
                    $('.update-button').attr('disabled', 'disabled').removeClass('btn-outline-success');
                    $('#item_upload_receiving_status').val('no');
                    PosnicPro.receivings.imageParams = [];
                } else {
                    PosnicPro.alert(response.type, response.message);
                }
                $('table#receiving_print tbody').append('<tr class="cart_content_area" id="cart_content_area"><td colspan="7"><div class="text-center text-dark"> <p><lang class="lang_receive_empty">Receiving Order Empty</lang></p></div></td></tr>');
                $('#receiviing_img_hide').show();
                loader.find(".loadingSpinner:first").remove();
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
            return false;
        }
    },
    /*Edit the receving items fetching data from the database to display edit page*/
    loadEditReceivings: function (id) {
        var loader = $(".loader-edit-receiving");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        $('#receiving_print tbody').children("tr").remove();
        $('#receving_tab_list').hide();
        $("#receiving_print").find("tr:not(:first)").remove();
        PosnicPro.receiving_lineitems = [];
        PosnicPro.receivings.receivingAddAction = false;
        PosnicPro.receivings.receivingId = '';
        PosnicPro.receivings.receivingAddId = '';
        PosnicPro.get('receivings/' + id, function (response) {
            loader.find(".loadingSpinner:first").remove();
            var result = response.data;
            var receivingItems = result.items;
            PosnicPro.commonEditDate(result.date);
            var itemDetails = [];
            if (response.type === 'success') {
                PosnicPro.receivings.receivingAddAction = true;
                PosnicPro.receivings.receivingAddId = id;
                PosnicPro.local.set('receivingAddId', id);
                PosnicPro.receivings.receivingId = result.receiving_id;
                (result.exclusive_tax === 'on') ? $("#exclusive_tax").prop('checked', true) : $("#exclusive_tax").prop('checked', false);
                PosnicPro.receivingsEditParams = {
                    receiving_supplier_id: result.supplier_id,
                    receiving_supplier_name: result.supplier_name,
                    receiving_supplier_phone: result.supplier_phone,
                    receiving_supplier_email: result.supplier_email,
                    receiving_supplier_address: result.supplier_address,
                    receiving_supplier_state: result.supplier_state,
                    receiving_supplier_gst_type: result.supplier_gst_type,
                    receiving_supplier_gst_number: result.supplier_gst_number,
                    receiving_tax: result.tax,
                    receiving_discount_amount: result.discount,
                    //receiving_discount_percentage: result.discount_percentage,
                    receiving_payment_description: result.payment_description,
                    receiving_payment_mode: result.payment_mode,
                    receiving_receiving_status: result.receiving_status,
                    receiving_itc_eligible: result.itc_eligible,
                    receiving_expected_date: result.expected_date,
                    receiving_invoice_total_declared: result.invoice_total_declared,
                    receiving_additional_charges: result.additional_charges,
                    receiving_image: result.image,
                    receiving_exclusive_tax: result.exclusive_tax
                };
                $.each(receivingItems, function (key, val) {
                    itemDetails = {
                        "item_id": val.item_id,
                        "item_name": val.item_name,
                        "company_price": val.item_price,
                        "barcode_id": val.barcode_id,
                        "item_quantity": val.item_quantity,
                        "item_unit": val.item_unit,
                        "available_quantity": val.item_available_quantity,
                        "discount_amount": val.item_discount,
                        "discount_percentage": val.item_discount_percentage,
                        "tax": val.tax,
                        "tax_type": val.tax_type,
                        "supplier": val.item_supplier
                    };
                    PosnicPro.receivings.addReceivingLineItems(itemDetails);
                });
                if (PosnicPro.receivings.receivingReturnAction === 'return') {
                    $("#receiving_add_payment_mode option[value='" + PosnicPro.receivingsEditParams.receiving_payment_mode + "']").prop("selected", "selected");
                    $("#receiving_add_payment_mode").val(PosnicPro.receivingsEditParams.receiving_payment_mode);
                    $('#receiving_return_view_table').html('');
                    $('#receiving_return_view_list').remove();
                    $('#receiving_return_view_table').append('<div id="receiving_return_view_list">');
                    (result.items_return.length !== 0) ? $('#show-already-return-table').show() : $('#show-already-return-table').hide();
                    var app = "<div><div class='table-responsive'><table class='table' style='background:#f3f5fd;'>";
                    var currency = PosnicPro.local.get('currencySign');
                    for (var i = 0; i < result.items_return.length; i++) {
                        var date = result.items_return[i].returnArray['returnDate'];
                        var timeStamp_value = parseInt(date.$date.$numberLong);
                        var timeZone = PosnicPro.timeZone();
                        var DateFormat = moment(timeStamp_value).tz(timeZone).format('YYYY/MM/DD LT');
                        var updateDate = PosnicPro.convertDate(DateFormat);
                        var head = '<thead><tr><td colspan="7"></td></tr><tr style="background:#e1e6f5;">' +
                                '<td>' + (i + 1) + '</td><td colspan="3"><span class="text-danger">' + result.items_return[i].returnArray['returnId'] + '</span></td><td colspan="3"><span class="text-danger">' + updateDate + '</span></td></tr>' +
                                '<tr><th class="text-left"><lang class="lang_name_title">Name </lang></th>' +
                                '<th class="text-center"><lang class="lang_qty_title">Qty </lang></th>' +
                                '<th class="text-center"><lang class="lang_unit_title">Unit </lang></th>' +
                                '<th class="text-right"><lang class="lang_cost_title">Cost </lang></th>' +
                                '<th class="text-center"><lang class="lang_tax_title">Tax </lang></th>' +
                                '<th class="text-right"><lang class="lang_total_title">Total </lang></th>' +
                                '</tr></thead>';
                        app = app + '' + head + '';
                        var total = 0;
                        var priceValue = 0;
                        $.each(result.items_return[i].returnArray['returnValue'], function (key, val) {
                            let itemUnit = (typeof (val.item_unit) !== "undefined" && val.item_unit !== null) ? val.item_unit : 'qty';
                            total += val.total_amount;
                            priceValue += val.item_price * val.item_quantity;
                            var tax_type = val.tax_type;
                            if (tax_type === 'exclusive') {
                                var price = val.item_price;
                            } else {
                                var price = val.item_price / ((val.tax / 100) + 1);
                            }
                            var tax = '--';
                            if (val.tax !== 0) {
                                tax = '' + val.tax + '%';
                            }
                            if ((price).toFixed(2) > 0.00) {
                                var body = '<tbody><tr>' +
                                        '    <td  class="text-left" width="30%">' + val.item_name + '</td>' +
                                        '    <td class="text-center">' + val.item_quantity + '</td>' +
                                        '    <td class="text-center">' + itemUnit + '</td>' +
                                        '    <td class="text-right">' + currency + '&nbsp;<span class="number">' + price + '</span></td>' +
                                        '    <td class="text-center">' + tax + '</td>' +
                                        '    <td class="text-right">' + currency + '&nbsp;<span class="number">' + val.total_amount + '</span></td>' +
                                        '</tr></tbody>';
                            }
                            app = app + '' + body + '';
                        });
                        var foot = '<tbody><tr>' +
                                '<td colspan="4"><span class="pull-right"><b>Sub Total</b></span></td><td colspan="2"><span class="pull-right"><b>' + currency + '&nbsp;' + priceValue.toFixed(2) + '</b></span></td></tr>' +
                                '<tr><td colspan="4"><span class="pull-right"><b>Tax Amount</b></span></td><td colspan="2"><span class="pull-right"><b>' + currency + '&nbsp;' + (total - priceValue).toFixed(2) + '</b></span></td>' +
                                '<tr><td colspan="4"><span class="pull-right"><b>Grand Total</b></span></td><td colspan="2"><span class="pull-right"><b>' + currency + '&nbsp;' + total.toFixed(2) + '</b></span></td>' +
                                '</tr><tr><td colspan="6"></td></tr></tbody>';
                        app = app + '' + foot + '';
                    }
                    app = app + '</table></div></div>';
                    $('#receiving_return_view_list').append(app);
                    $('span.number').number(true, 2);
                }
                PosnicPro.receivings.showPaymentMode(result.payment_mode);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    /*---------update the View receiving Details --------*/
    editReceivings: function () {
        var supplier_name = $("#receiving_add_supplier_name").val();
        if ($('#receiving_print tbody tr').find(':nth-child(8)').text() === '' || supplier_name === '') {
            if (supplier_name === '') {
                $("#receiving_add_supplier_name").focus();
                PosnicPro.alert('error', 'Enter a supplier name.');
                return false;
            }
            PosnicPro.alert('warning', 'Add at least one item.');
            $('#receiving_add_item_name').focus();
            return false;
        } else {
            var loader = $(".loader-receiving");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            PosnicPro.receivings.addLineReceivingTable = $('#receiving_print tbody tr').map(function () {
                let itemid = $(this).find(':nth-child(8)').text();
                return {
                    item_name: $('#addReceivingLineItemName_' + itemid).text(),
                    item_price: $('#addReceivingLineItemPrice_' + itemid).text(),
                    item_quantity: $('#addReceivingLineItemQty_' + itemid).val(),
                    item_unit: $('#addReceivingLineItemUnit_' + itemid).text(),
                    item_id: $('#addReceivingLineItemId_' + itemid).text(),
                    total_amount: $('#addReceivingLineItemTotal_' + itemid).text(),
                    gst: $('#addReceivingGstTax_' + itemid).text(),
                    item_tax: parseFloat($('#addReceivingLineItemTax_' + itemid).text())
                };
            }).get();
            //return data table
            if (PosnicPro.receivings.receivingReturnAction === 'return') {
                PosnicPro.receivings.returnLineReceivingTable = $('#receiving_print tbody tr').map(function () {
                    let itemid = $(this).find(':nth-child(8)').text();
                    if ($('#addReceivingCheckedLineItem_' + itemid).is(":checked")) {
                        var available_quantity = PosnicPro.receiving_lineitems[itemid].item_quantity;
                        var qty = $('#addReceivingLineItemQty_' + itemid).val();
                        var available_qty = (parseFloat(available_quantity)) - (parseFloat(qty));
                        var updatePrice = parseFloat($('#addpurchasePrice_' + itemid).text()) * available_qty;
                        var Tax_type = $('#addReceivingLineTaxtype_' + itemid).text();

                        var TaxValue = parseFloat($('#addReceivingLineItemTax_' + itemid).text());
                        var addSalesTaxValue = updatePrice;
                        var tax_value = (addSalesTaxValue / 100) * parseFloat(TaxValue);
                        var updateLineItemTotal = addSalesTaxValue + tax_value;
                        if (Tax_type === 'Exc') {
                            var TaxValue = parseFloat($('#addReceivingLineItemTax_' + itemid).text());
                            var tax_value = (TaxValue / 100) * parseFloat(updatePrice);
                            updateLineItemTotal = updatePrice + tax_value;
                            var taxGst = tax_value;
                        } else {
                            updateLineItemTotal = updatePrice;
                            var TaxValue = parseFloat($('#addReceivingLineItemTax_' + itemid).text());
                            var inclusive_price = parseFloat($('#addReceivingLineItemPrice_' + itemid).text()) * available_qty;
                            var taxGst = (inclusive_price / 100) * TaxValue;
                        }

                        return {
                            item_name: $('#addReceivingLineItemName_' + itemid).text(),
                            item_price: $('#addReceivingLineItemPrice_' + itemid).text(),
                            item_unit: $('#addReceivingLineItemUnit_' + itemid).text(),
                            item_quantity: available_qty,
                            return_quantity: qty,
                            item_id: $('#addReceivingLineItemId_' + itemid).text(),
                            total_amount: updateLineItemTotal,
                            gst: taxGst.toFixed(3),
                            return_total_amount: $('#addReceivingLineItemTotal_' + itemid).text(),
                            return_gst: $('#addReceivingGstTax_' + itemid).text(),
                            item_tax: parseFloat($('#addReceivingLineItemTax_' + itemid).text())
                        };
                    }
                }).get();
            }

            var data = {
                date: $('#receiving_add_date').val(),
                receiving_total: $('#receiving_total').val(),
                supplier_id: $('#receiving_add_supplier_id').val(),
                supplier_name: $('#receiving_add_supplier_name').val(),
                supplier_address: $('#receiving_add_supplier_address').val(),
                supplier_phone: $('#receiving_add_supplier_phone').val(),
                supplier_email: $('#receiving_add_supplier_email').val(),
                supplier_state: $('#receiving_add_supplier_state').val(),
                supplier_gst_type: $('#receiving_add_supplier_gst_type').val(),
                supplier_gst_number: $('#receiving_add_supplier_gst_number').val(),
                payment_mode: $('#receiving_add_payment_mode').val(),
                status: $('.receiving-status').val(),
                payment_description: $('#receiving_add_payment_description').val(),
                tax: $('.tax-receiving-value').text(),
                discount: $('.discount-receiving-value').text(),
                print: $('#receiving_print').val(),
                items: PosnicPro.receivings.addLineReceivingTable,
                items_return: PosnicPro.receivings.returnLineReceivingTable,
                id: PosnicPro.receivings.receivingAddId,
                alternative_id: PosnicPro.receivings.receivingId,
                image: PosnicPro.receivings.imageParams,
                exclusive_tax: ($('#exclusive_tax').is(':checked', true)) ? 'on' : 'off',
                    itc_eligible: $('#receiving_itc_eligible').is(':checked'),
                    expected_date: $('#receiving_expected_date').val(),
                    invoice_total_declared: $('#receiving_invoice_total_declared').val(),
                    additional_charges: PosnicPro.receivings.collectCharges()
            };
            if (PosnicPro.receivings.receivingReturnAction === 'return') {
                var $checkboxes = $('#receiving_print tr td input[type="checkbox"]');
                var countCheckedCheckboxes = $checkboxes.filter(':checked').length;
                if (countCheckedCheckboxes === 0) {
                    var data = {};
                }
            }
            var params = {
                url: PosnicPro.receivings.receivingReturnAction === 'return' ? 'receivings/' + PosnicPro.receivings.receivingReturnAction + 'Receiving' : 'receivings/' + PosnicPro.receivings.receivingAddId,
                data: JSON.stringify(data)
            };
            PosnicPro.put(params, function (response) {
                if (response.type === 'success') {
                    PosnicPro.alert(response.type, response.message);
                    if (PosnicPro.receivings.receivingReturnAction === 'return') {
                        $('#receving_returned_table tbody').html('');
                        $('#receiving_print tbody').html('');
                        if (response.data.print === true) {
                            PosnicPro.receivings.view.returnPrintReceivings(response.data.receiving_id);
                        }
                        loader.find(".loadingSpinner:first").remove();
                        hasher.setHash('purchaseorders');
                        return false;
                    }
                    PosnicPro.stocklogs.viewLowStockDashboard();
                    loader.find(".loadingSpinner:first").remove();
                    hasher.setHash('purchaseorders');
//                    $('#receiving_add_item_name').focus();
                } else {
                    loader.find(".loadingSpinner:first").remove();
                    PosnicPro.alert(response.type, response.message);
                }
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                if (PosnicPro.receivings.receivingReturnAction === 'return') {
                    $.each(response.data, function (key, val) {
                        let row = "receiving_row_" + val.item_id;
                        $("#" + row + '').removeAttr("style");
                        $("#" + row + '').addClass('table-highlight-row');
                        let rowInput = "addReceivingLineItemQty_" + val.item_id;
                        $("#" + rowInput + '').val(val.item_quantity);
                        setTimeout(function () {
                            $("#" + row + '').removeClass('table-highlight-row');
                        }, 500);
                    });
                }
                PosnicPro.alert(response.type, response.message);
                loader.find(".loadingSpinner:first").remove();
            });
            return false;
        }
    },
    resetReceivingsForm: function () {
        $('#receiving_add_item_name').val('');
        $('#receiving_discount_amount').val(PosnicPro.local.get('setting-discount-amount'));
        $("#receiving_add_payment_mode").val('Cash');
        $("#receiving_add_payment_description").val('');
        $('#receiving_status_select option[value="Partial"]').remove();
        $('#receiving_status_select').prop('disabled', false).val('Open').trigger('change');
        $('#receiving_charges_rows').empty();
        $('#receiving_charges_row').hide();
        $('#display-preview').html('');
        $('#receiving_discount_amount,#receiving_total').val("0");
        $('#receiving_add_total_amount,#receiving_add_subtotal_amount,.discount-receiving-value,.tax-receiving-value').text("0.00");
        $('#receiving_upload_image').val('');
        $('#receiving_print tbody').children("tr").remove();
        $('#receving_tab_list').hide();
        $("#receiving_print").find("tr:not(:first)").remove();
        $('#row_id,#receiving_add_supplier_address,#receiving_add_supplier_phone,#receiving_add_supplier_email,#receiving_add_payment_description').val('');
        $('table#receiving_print tbody').append('<tr class="cart_content_area" id="cart_content_area"><td colspan="7"><div class="text-center text-dark"> <p><lang class="lang_receive_empty">Receiving Order Empty</lang></p></div></td></tr>');
        $('#receiviing_img_hide').show();
        (PosnicPro.local.get('default_supplier_enable_disable') === 'false') ? $('#receiving_add_supplier_id,#receiving_add_supplier_name,#receiving_add_supplier_address,#receiving_add_supplier_phone,#receiving_add_supplier_email,#receiving_add_supplier_state,#receiving_add_supplier_gst_type,#receiving_add_supplier_gst_number').val('') : PosnicPro.defaultSupplierSet();
        PosnicPro.receiving_lineitems = [];
        PosnicPro.alert('success', 'Receiving cancelled.');
        $('#reset_modal').modal('hide');
    },
    receivingImageFormSubmit: function () {
        if ($('#receiving_print tbody tr').find(':nth-child(8)').text() !== '' && $('#receiving_add_supplier_name').val() !== '') {
            if ($('#item_upload_receiving_status').val() === 'no') {
                PosnicPro.receivings.addReceivings();
            } else {
                var loader = $(".loader-receiving");
                $("<div class='loadingSpinner'></div>").appendTo(loader);
                let uniqueImageParams = PosnicPro.receivings.imageParams.filter((c, index) => {
                    return PosnicPro.receivings.imageParams.indexOf(c) === index;
                });
                var params = {
                    url: 'receivings/uploadReceivingImage',
                    data: JSON.stringify({
                        "receiving_image": uniqueImageParams
                    })
                };
                PosnicPro.post(params, function (response) {
                    PosnicPro.receivings.imageParams = [];
                    $.each(response.data, function (key, val) {
                        PosnicPro.receivings.imageParams[key] = {
                            name: val.name
                        };
                        $('#display-preview').html('');
                    });
                    PosnicPro.receivings.addReceivings();
                    loader.find(".loadingSpinner:first").remove();
                }, function (xhr) {
                    var response = jQuery.parseJSON(xhr.responseText);
                    PosnicPro.alert(response.type, response.message);
                });
            }
        } else {
            $('#receiving_add_item_name').focus();
            PosnicPro.alert('error', 'Add product');
        }
        return false;
    },
    receiving_image_preview: function () {

        var len_files = $("#receiving_upload_image").prop("files").length;
        for (var i = 0; i < len_files; i++) {
            var file_data = $("#receiving_upload_image").prop("files")[i];
            PosnicPro.receivings.form_data.append(file_data.name, file_data);
            reader = new FileReader();
            reader.fileName = file_data.name;
            reader.fileSize = file_data.size;
            reader.onload = function (e) {
                var count = $('#display-preview').find('div').length;
                var validExtensions = ['gif', 'GIF', 'jpg', 'JPG', 'png', 'PNG', 'jpeg', 'JPEG', 'bmp', 'BMP', 'pdf', 'PDF'];
                var fileName = e.target.fileName;
                var fileNameExt = fileName.substr(fileName.lastIndexOf('.') + 1);
                if ($.inArray(fileNameExt, validExtensions) === -1) {
                    this.type = '';
                    this.type = 'file';
                    PosnicPro.alert('error', "Only these file types are accepted : " + validExtensions.join(', '));
                    return false;
                }
                //Checking FileSize greater then 5 mb
                let fileSize = e.target.fileSize;
                let imageSizeArr = 0;
                let imageArr = document.getElementById('receiving_upload_image');
                let fileNameArray = [];
                let imageToBig = false;
                for (let i = 0; i < imageArr.files.length; i++) {
                    let imageSize = imageArr.files[i].size;
                    let imageName = imageArr.files[i].name;
                    if (imageSize > 5242880) {
                        imageSizeArr = 1;
                    }
                    if (imageSizeArr == 1) {
                        fileNameArray.push(imageName);
                        imageToBig = true;
                    }
                }
                if (imageToBig) {
                    //give an alert that at least one image is to big
                    PosnicPro.alert('error', fileNameArray + "Size should be less than 5MB !");
                    return false;
                }

                if ($('#display-preview').find('div').length > 5) {
                    PosnicPro.alert('error', "Maximum 6 files are allowed");
                    return false;
                }

                var fileImage = e.target.result.substr(e.target.result.indexOf(',') + 1);
                PosnicPro.receivings.imageParams[count] = {
                    name: fileName,
                    size: fileSize,
                    data: fileImage
                };
                $('#item_upload_receiving_status').val('yes');
                $('#display-preview').append(
                        '<div id="selector_' + count + '" class="receiving-image-wrapper image-area" style="position: relative;"> \
                        <iframe class="image_style" src="' + e.target.result + '" \
                        data-toggle="tooltip" title="' + escape(fileName) + '" /></iframe><br /> \
                            <a class="remove-image" style="cursor:pointer;display: inline;position: absolute; top: -10px; right: -10px; border-radius: 10em; padding: 2px 6px 3px; text-decoration: none; font: 700 21px/20px sans-serif; background: #f48787; border: 3px solid #fff; color: #FFF; box-shadow: 0 2px 6px rgba(0,0,0,0.5), inset 0 2px 4px rgba(0,0,0,0.3); text-shadow: 0 1px 2px rgba(0,0,0,0.5); -webkit-transition: background 0.5s; transition: background 0.5s;" onclick="PosnicPro.receivings.image_remove_selected(\'' + count + '\',\'' + fileName + '\')">&#215;</a> \
                        </div>');
            };
            reader.readAsDataURL(file_data);
        }
    },
    image_remove_selected: function (id, name) {

        var removeIndex = PosnicPro.receivings.imageParams.map(function (item) {
            return item.name;
        }).indexOf(name);
        PosnicPro.receivings.imageParams.splice(removeIndex, 1);
        $('#selector_' + id).remove();
        if (PosnicPro.receivings.imageParams.length === 0) {
            $('#item_upload_receiving_status').val('no');
        }
    },
    image_edit_remove_selected: function (id, name) {

        var removeIndex = PosnicPro.receivings.imageParams.map(function (item) {
            return item.name;
        }).indexOf(name);
        PosnicPro.receivings.imageParams.splice(removeIndex, 1);
        $('#selector_' + id).remove();
        if (PosnicPro.receivings.imageParams.length === 0) {
            $('#item_upload_receiving_status').val('no');
        }
    }

};
$(function () {
    // One-time init like the sale search: never rebuild per keystroke.
    /*
     * OWNER STANDING RULE (2026-08-27): every master picker shows something
     * the moment it is focused - frequently-used first (the recent_* lists
     * the sale screen feeds), the latest 10 as the fallback, and typeahead
     * narrows from there. Never an empty box waiting for typing.
     */
    PosnicPro.receivings.supplierLookup = function (inputSel) {
        return function (query, done) {
            var q = String(query || '').trim();
            if (q) {
                var suggestions = [];
                PosnicPro.get({
                    url: 'suppliers/getSuppliersAjaxList',
                    data: 'query=' + encodeURIComponent(q) + '&branch=' + PosnicPro.local.get("branch_id_set")
                }, function (response) {
                    if (response.suggestions && response.suggestions.length > 0) {
                        $.map(response.suggestions, function (dataItem) {
                            suggestions.push({ value: dataItem.name, data: dataItem });
                        });
                    } else {
                        suggestions.push({ value: $(inputSel).val() + ' ', data: -1 });
                    }
                    done({ suggestions: suggestions });
                });
                return;
            }
            /*
             * Empty query = the on-focus list (owner's picker rule + the
             * star idea): default first (tagged), then starred favourites,
             * then recents, then the latest from the server to fill ten.
             */
            var seen = {};
            var out = [];
            var push = function (row, flags) {
                if (!row || !row.id || seen[row.id] || out.length >= 10) { return; }
                seen[row.id] = true;
                out.push({ value: row.name, data: $.extend({}, row, flags || {}) });
            };
            var readList = function (key) {
                try { return JSON.parse(PosnicPro.local.get(key) || '[]') || []; } catch (e) { return []; }
            };
            /* Favourites were PUSHED BACK (owner, 2026-08-27): recency
               self-maintains, stars rot. Default, then recents, then the
               latest from the server. */
            var def = $(inputSel).data('prefilled-default');
            if (def && def.id) {
                push({ id: def.id, name: def.name, phone: def.phone || '' }, { isDefault: true });
            }
            readList('recent_suppliers').forEach(function (r) { push(r); });
            PosnicPro.get({
                url: 'suppliers/getSuppliersAjaxList',
                data: 'query=&branch=' + PosnicPro.local.get("branch_id_set")
            }, function (response) {
                /* The on-focus list may resolve AFTER focus has moved on -
                   page entry focuses the field for a beat before the item
                   box takes over, and rendering then leaves an orphaned
                   dropdown floating over the form. Only speak while the
                   field is still listening. */
                if (!$(inputSel).is(':focus')) { done({ suggestions: [] }); return; }
                (response.suggestions || []).forEach(function (d) {
                    push({ id: d.id, name: d.name, phone: d.phone, address: d.address, email: d.email,
                        state: d.state, gst_type: d.gst_type, gst_number: d.gst_number });
                });
                done({ suggestions: out });
            }, function () {
                done({ suggestions: $(inputSel).is(':focus') ? out : [] });
            });
        };
    };
    /* Star rendering for the on-focus list; typed searches stay plain. */
    PosnicPro.receivings.supplierFormatResult = function (suggestion, currentValue) {
        var esc = function (t) { return $('<i/>').text(t == null ? '' : t).html(); };
        var d = suggestion.data || {};
        if (d === -1 || !d.id) {
            return '<div>' + $.Autocomplete.formatResult(suggestion, currentValue) +
                '</div><span class="pull-right" style="margin-top:-20px;">( Add new )</span>';
        }
        /* Favourites are made on the supplier LIST page, not here - the
           dropdown stays a picker (standard §7). They still lead the
           on-focus ordering. Phone keeps its long-standing place. */
        var tag = d.isDefault ? ' <span class="text-muted" style="font-size:11px;">(default)</span>' : '';
        var sub = d.phone ? ' <span class="text-muted" style="font-size:11px;">' + esc(d.phone) + '</span>' : '';
        return esc(suggestion.value) + tag + sub;
    };
    $('#receiving_add_supplier_name').autocomplete({
        deferRequestBy: 120,
            minChars: 0,
            formatResult: PosnicPro.receivings.supplierFormatResult,
            lookup: PosnicPro.receivings.supplierLookup('#receiving_add_supplier_name'),
            onSelect: function (suggestion) {
                if (suggestion.data !== -1) {
                    $(".clear-supplier-error").find('.error').text("").removeClass('error');
                    $('#receiving_add_supplier_id').val(suggestion.data.id);
                    $('#receiving_add_supplier_address').val(suggestion.data.address);
                    $('#receiving_add_supplier_phone').val(suggestion.data.phone);
                    $('#receiving_add_supplier_email').val(suggestion.data.email);
                    $('#receiving_add_supplier_state').val(suggestion.data.state);
                    $('#receiving_add_supplier_gst_type').val(suggestion.data.gst_type);
                    $('#receiving_add_supplier_gst_number').val(suggestion.data.gst_number);
                    /* Recency, the same way the sale screen records customers
                       and items. The shared filter bar offers a supplier picker
                       (core/list-filter.js, LF.ENTITIES.supplier) that reads
                       this list - without it that picker opens empty on every
                       till and looks broken. Written where the choice is made,
                       so every path that picks a supplier feeds it. */
                    if (PosnicPro.sales && PosnicPro.sales._recentPush) {
                        PosnicPro.sales._recentPush('recent_suppliers', {
                            id: suggestion.data.id,
                            name: suggestion.value || suggestion.data.name,
                            phone: suggestion.data.phone
                        }, 'id');
                    }
//                    let hash = window.location.hash.slice(1);
//                    if (hash === '/receivings/new') {
//                        PosnicPro.receivings.clearReceivingForm();
//                        PosnicPro.receivings.addReceivingTableRowCalc();
//                    }

                } else {
                    hasher.setHash('receivings/suppliers/new');
                }
            },
            autoSelectFirst: true,
            triggerSelectOnValidInput: false
    });
});
$('#receiving_add_supplier_name').click(function () {
    PosnicPro.selectAllText(jQuery(this));
});
$('#receiving_add_item_name').scannerDetection({
    timeBeforeScanTest: 200, // wait for the next character for upto 200ms
    avgTimeByChar: 40, // it's not a barcode if a character takes longer than 100ms
    preventDefault: true,
    endChar: [13],
    onComplete: function (barcode, qty) {
        validScan = true;
        var params = {
            url: 'items/getReceivingItemsAjaxList',
            data: 'query=' + barcode + '&type=barcode'
        };
        PosnicPro.get(params, function (response) {
            if (response.suggestions.length > 0) {
                suggestions: $.map(response.suggestions, function (suggestion) {
                    $('#receiving_add_item_name').focus();
                    PosnicPro.receivings.suggestionParam = [suggestion];
                    $('#receiving_add_selling_price').val(suggestion.selling_price);
                    $('#item_id').val(suggestion.item_id);
                    $('#barcode_id').val(suggestion.itemid);
                    $('#receiving_add_available_stock').val(suggestion.available_quantity);
                    $('#receiving_add_line_total').val(suggestion.company_price);
                    PosnicPro.receivings.addReceivingLineItems(suggestion);
                });
            } else {
                $('#receiving_add_item_name').focus();
                swal({
                    title: "Not found!",
                    text: "Barcode item not found. Please check item page.",
                    icon: "warning",
                    button: "Ok"
                });
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    onError: function (string, qty) {
        $('#receiving_add_item_name').val($('#receiving_add_item_name').val() + string).trigger('input');
    }
});
/* Same never-block treatment as the sale search: init once, debounce,
   drop stale responses. The supplier check moved to focus time. */
$(function () {
    var receivingLookupSeq = 0;
    $('#receiving_add_item_name').on('focus', function () {
        // Guide, don't scold: the page auto-focuses this field on open
        // (racing the default-supplier fill), so an empty supplier just
        // moves the cursor to the supplier box - the submit path still
        // enforces it with words when it actually matters.
        if ($('#receiving_add_supplier_name').val() === '') {
            $('#receiving_add_supplier_name').focus();
        }
    });
    $('#receiving_add_item_name').autocomplete({
        deferRequestBy: 120,
        lookup: function (query, done) {
            var seq = ++receivingLookupSeq;
            var id = $('#receiving_add_supplier_id').val();
            var result = {};
            var suggestions = [];
            var params = {
                url: 'items/getReceivingItemsAjaxList',
                data: 'query=' + query + '&id=' + id + '&type=normal'
            };
            PosnicPro.get(params, function (response) {
                if (seq !== receivingLookupSeq) { return; }
                if (response.suggestions.length > 0) {
                    suggestions: $.map(response.suggestions, function (dataItem) {
                        suggestions.push({"value": dataItem.item_name, "data": dataItem});
                    });
                } else {
                    suggestions.push({ value: query + ' ', data: { __action: 'create' } });
                }
                result["suggestions"] = suggestions;
                done(result);
            });
        },
        onSelect: function (suggestion) {
            if (suggestion.data && suggestion.data.__action === 'create') {
                var typed = (suggestion.value || '').trim();
                $('#receiving_add_item_name').val('');
                PosnicPro.quickitems.popup(typed, function (newId, f) {
                    if (!newId) { return; }
                    PosnicPro.receivings.addReceivingLineItems({
                        item_id: newId,
                        item_name: f.name,
                        selling_price: f.selling_price,
                        item_code: '',
                        item_unit: 'qty',
                        purchase_unit: '',
                        conversion_factor: 0,
                        company_price: 0,
                        discount_amount: 0,
                        discount_percentage: 0,
                        tax: 0,
                        tax_type: '',
                        category_id: '',
                        category_name: '',
                        image: 'item.svg',
                        supplier_id: $('#receiving_add_supplier_id').val() || '',
                        supplier_name: $('#receiving_add_supplier_name').val() || '',
                        available_quantity: f.quantity || 0
                    });
                });
                return;
            }
            if (suggestion.data !== -1) {
                PosnicPro.receivings.suggestionParam = [suggestion.data];
                $('#receiving_add_selling_price').val(suggestion.data.selling_price);
                $('#item_id').val(suggestion.data.item_id);
                $('#barcode_id').val(suggestion.data.itemid);
                $('#receiving_add_available_stock').val(suggestion.data.available_quantity);
                $('#receiving_add_item_unit').val(suggestion.data.item_unit);
                $('#receiving_add_line_total').val(suggestion.data.company_price);
                PosnicPro.receivings.addReceivingLineItems(suggestion.data);
                // Clear the search and refocus so the next item can be typed
                // straight away (rapid entry). Previously the picked item name
                // stayed stuck in the box with no easy way to clear it.
                var $box = $('#receiving_add_item_name');
                $box.val('');
                if ($box.data('autocomplete')) { $box.autocomplete('clear'); }
                setTimeout(function () { $box.focus(); }, 0);
            }
        },
        autoSelectFirst: true,
        triggerSelectOnValidInput: false,
        formatResult: function (suggestion, currentValue) {
            if (suggestion.data && suggestion.data.__action === 'create') {
                var typedName = $('<i>').text((suggestion.value || '').trim()).html();
                return PosnicPro.sugActionRow('icon-plus-circle', 'create',
                    'Create item &quot;' + typedName + '&quot;',
                    'Name and price now - details anytime later');
            }
            var currency = PosnicPro.local.get('currencySign');
            return PosnicPro.sugRow(suggestion.data,
                $.Autocomplete.formatResult(suggestion, currentValue), {
                    currency: currency,
                    price: Number(suggestion.data.company_price) || 0
                });
        }
    });
});
/* Expected-on only matters while the order is still out (status Ordered). */
$(document).on('change', '#receiving_status_select', function () {
    $('#receiving_expected_wrap').toggle($(this).val() === 'Open');
});
$(document).on('input', '#receiving_charges_rows .charge-amount, #receiving_charges_rows .charge-label', function () {
    PosnicPro.receivings.addReceivingTableRowCalc();
});
$(document).on('click', '#receiving_charges_rows .charge-remove', function () {
    $(this).closest('.charge-row').remove();
    PosnicPro.receivings.addReceivingTableRowCalc();
});
$(document).ready(function () {
    $('#receiving_print tbody').children("tr").remove();
    $("#receiving_print").find("tr:not(:first)").remove();
    $('#receiviing_img_hide').show();
    $('table#receiving_print tbody').append('<tr class="cart_content_area" id="cart_content_area"><td colspan="7"><div class="text-center text-dark"> <p><lang class="lang_receive_empty">Receiving Order Empty</lang></p></div></td></tr>');
    var format = PosnicPro.convertFormatDateTime();
    $("#receiving_add").validate({
        errorPlacement: function (error, element) {
            var placement = element.closest('.input-group');
            if (!placement.get(0)) {
                placement = element;
            }
            placement.after(error);
        },
        highlight: function (element, errorClass) {
            $(element).css("border-color", "#F9616D");
        },
        unhighlight: function (element, errorClass) {
            $(element).css("border-color", "#EAE8E8");
        },
        rules: {
            receiving_add_date: {
                required: true,
                date: true,
                commonDate: true
            },
            receiving_add_supplier_name: {
                required: true,
                minlength: 3,
                maxlength: 250

            },
        },
        messages: {
            receiving_add_date: {
                required: "This field is required",
                date: "Enter a valid date",
                maxlength: "Enter a valid date",
            },
            receiving_add_supplier_name: {
                required: "Enter the supplier name",
                minlength: "Supplier Name Must be Atleast 3 Characters"

            },
        }
    });
    jQuery.validator.addMethod("commonDate", function (value, element) {
        return this.optional(element) || moment(value, 'YYYY/MM/DD LT').isValid();
    }, "Use the date format");
});
$("#receiving_add").submit(function (event) {
    event.preventDefault();
    if ($('#receiving_add').valid()) {            // checks form for validity

        PosnicPro.receivings.receivingImageFormSubmit();
    }
});

$('#exclusive_tax').click(function () {
    var isChecked = $(this).is(':checked');
    
    if (isChecked) {
        $('.show-hide-exc-tax').show();
    } else {
        $('.show-hide-exc-tax').hide();
    }
    
    // Update tax values for all line items based on checkbox state
    for (var itemId in PosnicPro.receiving_lineitems) {
        if (PosnicPro.receiving_lineitems.hasOwnProperty(itemId)) {
            var originalTaxPercentage = PosnicPro.receiving_lineitems[itemId].tax_percentage || 0;
            
            // Get the visible and hidden tax fields
            var visibleTaxElement = $('#addReceivingLineItemTax_' + itemId);
            var hiddenTaxElement = $('#addReceivingItemTax_' + itemId);
            
            if (isChecked) {
                // When checked, restore the original tax percentage
                hiddenTaxElement.text(originalTaxPercentage);
                visibleTaxElement.html(originalTaxPercentage + '<span>%</span>&nbsp;&nbsp;<span class="receving-return-hide"><i class="feather icon-edit-1 text-success" onclick="return PosnicPro.receivings.editItemTaxReceiving(this);"  data-id="' + itemId + '" data-toggle="tooltip" title="Edit item tax" style="cursor:pointer;"></i></span>');
            } else {
                // When unchecked, set tax to 0 for calculation
                hiddenTaxElement.text(0);
                visibleTaxElement.html('0<span>%</span>&nbsp;&nbsp;<span class="receving-return-hide"><i class="feather icon-edit-1 text-success" onclick="return PosnicPro.receivings.editItemTaxReceiving(this);"  data-id="' + itemId + '" data-toggle="tooltip" title="Edit item tax" style="cursor:pointer;"></i></span>');
            }
            
            // Recalculate this line item
            PosnicPro.receivings.addLineReceivingChangeQty(itemId);
        }
    }
});
/*
 * Purchase orders (PO_LIFECYCLE_DESIGN.md): the plan that never touches
 * stock. List / form / view sections on one page; Receive opens the
 * ordinary receiving screen pre-filled with the outstanding quantities and
 * stamps source_po_id so the bridge can mirror what arrived.
 */
PosnicPro.purchaseorders = {
    _lines: {},
    _detail: null,
    /* The page chrome, shared by list entry and deep links: pane, title,
       and the LEFT MENU highlight - which must also survive a refresh
       (owner: "when refresh left side correct menu not highlighted"). */
    _chrome: function () {
        PosnicPro.HideSideBarModal();
        $('.page_loader,#osk-container').hide();
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $('.vertical-menu li a').removeClass('active');
        $('#v-pills-purchase-tab').addClass('active');
        $('#v-pills-purchase').addClass('show active');
        $('#view_purchaseorders_page').addClass('active');
        $('.page-title-box,#purchaseorders_new').show();
        $('#po_form_section,#po_view_section,#po_receive_section').hide();
        $('#po_list_section').show();
    },
    showDataTablePage: function () {
        PosnicPro.purchaseorders._chrome();
        PosnicPro.purchaseorders.closeDoc();
        PosnicPro.purchaseorders.loadList(1);
    },
    showAdd: function () { PosnicPro.purchaseorders.showDataTablePage(); PosnicPro.purchaseorders.openForm(''); },
    showEdit: function (id) { PosnicPro.purchaseorders.showDataTablePage(); PosnicPro.purchaseorders.openForm(id); },
    /*
     * #/purchaseorders/<id> - the document's own address, like a quote's
     * (owner: "its not changing... as quote url system"). A refresh or a
     * shared link lands on the OPEN document; the hash echo of a row click
     * is recognised and ignored.
     */
    showDetails: function (id) {
        var self = PosnicPro.purchaseorders;
        var key = self._openDocKey || '';
        if (key.slice(key.indexOf(':') + 1) === String(id) && $('#purchases_detail_card').is(':visible')) {
            return;
        }
        self._chrome();
        self.loadList(1);
        /* which kind lives at this id? a receiving answers; a PO does not */
        PosnicPro.get('receivings/' + id, function (r) {
            if (r && r.type === 'success' && r.data) { self.openDoc('purchase', id); }
            else { self.openDoc('po', id); }
        }, function () { self.openDoc('po', id); });
    },
    /*
     * ONE list for the whole purchases area (owner: "keep one"). Orders and
     * received purchases, merged newest-first. Orders open their document;
     * purchases open the receiving view. Paging is a growing window over
     * both sources - simple, honest, and gone entirely when the
     * master-detail surface replaces this page.
     */
    _page: 1,
    PAGE_SIZE: 25,
    _lastRows: [],
    _openDocKey: null,
    _status: '',
    _expected: '',
    mountPurchaseFilters: function (force) {
        if (!$('#purchases_filter_panel').length) { return; }
        if (!force && $('#purchases_filter_panel').data('mounted')) { return; }
        $('#purchases_filter_panel').data('mounted', true);
        PosnicPro.listFilter.mount({
            key: 'receivings',
            container: '#purchases_filter_panel',
            button: '#purchases_filter_btn',
            searchPlaceholder: 'Search purchase no, supplier or phone',
            dateField: 'Bill date',
            searchFields: [
                { value: 'all', label: 'All fields' },
                { value: 'receiving_id', label: 'Purchase no' },
                { value: 'supplier_name', label: 'Supplier' },
                { value: 'supplier_phone', label: 'Phone' }
            ],
            typeahead: 'supplier',
            typeaheadField: 'supplier_name',
            onChange: function () { PosnicPro.purchaseorders.loadList(1); }
        });
    },
    exportCsv: function () {
        var rows = [['No', 'Kind', 'Bill date', 'Created', 'Supplier', 'Status', 'Expected', 'Total']];
        (PosnicPro.purchaseorders._lastRows || []).forEach(function (r) {
            rows.push([r.no, r.kind === 'po' ? 'order' : 'purchase',
                r.date ? new Date(r.date).toISOString().slice(0, 10) : '',
                r.created ? new Date(r.created).toISOString().slice(0, 10) : '',
                r.supplier, r.status, r.expected || '', r.total]);
        });
        var csv = rows.map(function (r) {
            return r.map(function (c) { return '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"'; }).join(',');
        }).join('\n');
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'purchases.csv';
        a.click();
        URL.revokeObjectURL(a.href);
    },
    STATUS_PILL: { ordered: 'hold', partial: 'hold', draft: 'hold', received: 'paid', closed: 'paid', cancelled: 'unpaid' },
    STATUS_LABEL: { ordered: 'Ordered', partial: 'Partially received', draft: 'Draft', received: 'Received', closed: 'Received', cancelled: 'Cancelled' },
    /*
     * ONE list over two sources (orders + received purchases), merged
     * newest-first, with real page numbers (owner: "pagination is
     * important"). Each source is asked for the whole window up to the
     * current page (capped at 100 a side), so the merged slice for page N
     * is exact; past 2x100 rows the pager stops honestly and the archive
     * link carries the deep history.
     */
    loadList: function (page) {
        PosnicPro.purchaseorders.mountPurchaseFilters();
        var self = PosnicPro.purchaseorders;
        if (page) { self._page = page; }
        var p = self._page;
        var size = self.PAGE_SIZE;
        var fetchLimit = Math.min(p * size + 1, 100);
        var filters = PosnicPro.listFilter.legacyFilters('receivings', { dateKey: 'date' });
        var esc = function (t) { return $('<span>').text(t == null ? '' : t).html(); };
        var done = { po: null, rec: null };
        var totals = { po: 0, rec: 0 };
        var render = function () {
            if (done.po === null || done.rec === null) { return; }
            var rows = done.po.concat(done.rec);
            var ts = function (v) { var t = new Date(v || 0).getTime(); return isNaN(t) ? 0 : t; };
            /* Same bill date is the NORMAL case (today's purchases) - the
               tie breaks on created time so the newest entry leads. */
            rows.sort(function (a, b) { return ts(b.date) - ts(a.date) || ts(b.created) - ts(a.created); });
            self._lastRows = rows;
            var chip = self._status;
            var filtered = !chip ? rows : rows.filter(function (r) {
                if (chip === 'ordered') { return r.status === 'ordered' || r.status === 'draft'; }
                if (chip === 'received') { return r.status === 'received' || r.status === 'closed'; }
                return r.status === chip;
            });
            /* Expected-date quick chips (owner): due today, tomorrow, or in
               the coming seven days. Calendar days, local time. */
            var expChip = self._expected;
            if (expChip) {
                var today = new Date(); today.setHours(0, 0, 0, 0);
                filtered = filtered.filter(function (r) {
                    if (!r.expected) { return false; }
                    var due = new Date(r.expected);
                    if (isNaN(due.getTime())) { return false; }
                    due.setHours(0, 0, 0, 0);
                    var days = Math.round((due - today) / 86400000);
                    if (expChip === 'today') { return days === 0; }
                    if (expChip === 'tomorrow') { return days === 1; }
                    return days >= 0 && days <= 6;
                });
            }
            if (p > 1 && !filtered.slice((p - 1) * size).length) { self._page = 1; p = 1; }
            var pageRows = filtered.slice((p - 1) * size, p * size);
            if (!pageRows.length) {
                var isFiltered = !!chip || !!expChip || PosnicPro.listFilter.activeCount('receivings') > 0;
                $('#po_list_rows').html('<div class="text-center text-muted p-t-20 p-b-20">'
                    + (isFiltered ? 'No purchases match this filter.' : 'No purchases yet - press New Purchase to record the first.') + '</div>');
                $('#po_list_paging').html('');
                return;
            }
            var d = function (v) { return v ? new Date(v).toLocaleDateString('en-IN') : '-'; };
            var P = self.STATUS_PILL, L = self.STATUS_LABEL;
            var html = '<div class="table-responsive"><table class="table table-borderless">'
                + '<thead><tr>'
                + '<th class="p-col-num">Purchase #</th><th>Supplier</th><th class="p-col-date">Date</th><th class="p-col-created">Created</th>'
                + '<th class="p-col-expected">Expected</th><th class="text-right">Total</th><th class="text-center">Status</th>'
                + '</tr></thead><tbody>';
            pageRows.forEach(function (r) {
                var key = r.kind + ':' + r.id;
                var badges = '';
                if (r.mismatch) { badges += ' <i class="feather icon-alert-triangle text-warning" title="Invoice total mismatch"></i>'; }
                if (r.hasDoc) { badges += ' <i class="feather icon-paperclip text-muted"></i>'; }
                var pill = '<span class="rs-pill ' + (P[r.status] || 'hold') + '">' + (L[r.status] || esc(r.status)) + '</span>';
                html += '<tr class="md-row purchases-row highlight-select' + (self._openDocKey === key ? ' is-active' : '') + '"'
                    + ' data-kind="' + r.kind + '" data-id="' + esc(r.id) + '" style="cursor:pointer;">'
                    + '<td class="p-col-num">' + esc(r.no) + badges + '</td>'
                    + '<td>' + esc(r.supplier) + (r.progress ? ' <span class="text-muted p-col-progress">' + esc(r.progress) + '</span>' : '') + '</td>'
                    + '<td class="p-col-date">' + d(r.date) + '</td>'
                    + '<td class="p-col-created">' + d(r.created) + '</td>'
                    + '<td class="p-col-expected">' + (r.expected ? d(r.expected) : '-') + '</td>'
                    + '<td class="text-right">' + PosnicPro.local.get('currencySign') + '&nbsp;' + (Number(r.total) || 0).toFixed(2) + '</td>'
                    + '<td class="text-center">' + pill + '</td>'
                    + '</tr>';
            });
            html += '</tbody></table></div>';
            $('#po_list_rows').html(html);
            self.renderPager(filtered.length, chip || expChip ? null : totals.po + totals.rec);
        };
        PosnicPro.get({ url: 'purchaseOrders', data: 'page=1&limit=' + fetchLimit }, function (response) {
            var data = (response && response.data) || {};
            totals.po = Number(data.total) || 0;
            done.po = (data.list || []).map(function (po) {
                return {
                    kind: 'po', id: po.id, no: po.po_id,
                    date: String(po.order_date || ''),
                    created: po.created_date || po.order_date || '',
                    supplier: po.supplier_name, status: po.status,
                    progress: po.ordered_qty > 0 ? (po.received_qty + '/' + po.ordered_qty) : '',
                    expected: po.expected_date || '',
                    total: po.grand_total
                };
            });
            render();
        }, function () { done.po = []; render(); });
        PosnicPro.get({ url: 'receivings', data: { page: 1, limit: fetchLimit, filters: JSON.stringify(filters) } }, function (response) {
            var data = (response && response.data) || {};
            totals.rec = Number(data.total) || 0;
            done.rec = (data.list || []).map(function (r) {
                return {
                    kind: 'purchase', id: r._id, no: r.receiving_id,
                    date: String(r.date || r.updated_date || ''),
                    created: r.created_date || '',
                    supplier: r.supplier_name,
                    status: r.receiving_status === 'Open' ? 'ordered'
                        : r.receiving_status === 'Received' ? 'received'
                        : String(r.receiving_status || '').toLowerCase(),
                    progress: '',
                    expected: r.expected_date || '',
                    total: r.total_amount,
                    mismatch: r.invoice_total_mismatch === true,
                    hasDoc: !!(r.image && r.image.length)
                };
            });
            render();
        }, function () { done.rec = []; render(); });
    },
    /*
     * Pager per LIST_PAGE_UX_STANDARD §3: numbered window when the total is
     * known, arrows always, count that never lies. A chip filters
     * client-side so its total is unknown - the pager falls back to the
     * range on screen, exactly like the quotes search path.
     */
    renderPager: function (reach, total) {
        var self = PosnicPro.purchaseorders;
        var p = self._page, size = self.PAGE_SIZE;
        var hasMore = reach > p * size;
        var pages = null;
        var label;
        if (total !== null && total !== undefined) {
            pages = Math.ceil(total / size) || 1;
            label = total + (total === 1 ? ' purchase' : ' purchases');
            if (pages > 1) { label = 'Page ' + p + ' of ' + pages + ' \u00b7 ' + label; }
        } else {
            var first = (p - 1) * size + 1;
            var last = Math.min(reach, p * size);
            label = reach ? 'Showing ' + first + '\u2013' + last : 'No matches';
        }
        var btn = function (to, text, off, cls) {
            return '<button type="button" class="btn btn-sm ' + (cls || 'btn-secondary-rgba') + ' q-pg-btn"' + (off ? ' disabled' : '')
                + ' onclick="PosnicPro.purchaseorders.goPage(' + to + ');">' + text + '</button>';
        };
        var html = '';
        var showArrows = p > 1 || hasMore || (pages && pages > 1);
        if (showArrows) { html += btn(p - 1, '&laquo;', p <= 1); }
        if (pages && pages > 1) {
            var reachablePages = Math.max(1, Math.ceil(Math.min(total, 200) / size));
            var shown = Math.min(pages, reachablePages);
            var pgEnd = Math.min(shown, Math.max(1, p - 2) + 4);
            var pgStart = Math.max(1, pgEnd - 4);
            for (var n = pgStart; n <= pgEnd; n++) {
                html += '<span class="q-pg-num">' + btn(n, n, false, n === p ? 'btn-primary-rgba' : 'btn-secondary-rgba') + '</span>';
            }
        }
        html += '<span class="q-pg-count">' + label + '</span>';
        if (showArrows) { html += btn(p + 1, '&raquo;', !hasMore); }
        $('#po_list_paging').html(html);
    },
    goPage: function (n) {
        if (!n || n < 1) { return; }
        PosnicPro.purchaseorders._page = n;
        PosnicPro.purchaseorders.loadList();
    },
    /* ---- opening a document IS entering the split (standard §4) ---- */
    openDoc: function (kind, id) {
        var self = PosnicPro.purchaseorders;
        if (!PosnicPro.masterDetail.inSplit('#purchases_split', 'purchases-split')) {
            PosnicPro.masterDetail.enter('#purchases_split', 'purchases-split');
            $('#purchases_detail_card').show();
        }
        self._openDocKey = kind + ':' + id;
        $('#po_list_rows tr.purchases-row').removeClass('is-active');
        $('#po_list_rows tr.purchases-row[data-id="' + id + '"]').addClass('is-active');
        /* the document's address, like a quote's - showDetails recognises
           the echo of this setHash and does nothing */
        if (window.location.hash.slice(2) !== 'purchaseorders/' + id) {
            hasher.setHash('purchaseorders/' + id);
        }
        if (kind === 'po') {
            $('#purchases_doc').hide();
            $('#purchases_po_host').show();
            if (!$('#po_view_section').length || !$.contains($('#purchases_po_host')[0], $('#po_view_section')[0])) {
                $('#po_view_section').appendTo('#purchases_po_host');
            }
            PosnicPro.purchaseorders.openView(id);
            $('#po_view_section').show();
            return;
        }
        $('#purchases_po_host').hide();
        $('#purchases_doc').show().html('<div class="text-center text-muted" style="padding:60px;">Loading ...</div>');
        PosnicPro.get('receivings/' + id, function (response) {
            if (response.type !== 'success') { $('#purchases_doc').html('<div class="text-danger p-4">Could not open this purchase.</div>'); return; }
            PosnicPro.purchaseorders.renderPurchaseDoc(response.data);
        }, function () { $('#purchases_doc').html('<div class="text-danger p-4">Could not open this purchase.</div>'); });
    },
    closeDoc: function () {
        PosnicPro.purchaseorders._openDocKey = null;
        $('#purchases_detail_card').hide();
        $('#po_list_rows tr.purchases-row').removeClass('is-active');
        PosnicPro.masterDetail.leave('#purchases_split', 'purchases-split');
        if (window.location.hash.slice(2).indexOf('purchaseorders/') === 0) {
            hasher.setHash('purchaseorders');
        }
    },
    /*
     * The document pane, paper-styled (standard §4): pull first, title and
     * pills, grouped actions right (one primary, Edit, More, close last).
     * Soft hairlines and muted labels - the theme's font does the talking.
     */
    /*
     * The document is the quote's A4 sheet (owner: "show similar as quote.
     * like full box and neatly aligned professional like A4 document") -
     * same q-sheet vocabulary, same CSS, so the two documents age together.
     * Toolbar above the paper; the void strip asks its reason inline.
     */
    /*
     * The A4 sheet alone - shared with every pane that previews a purchase
     * (the supplier profile embeds it, so reading a supplier's history
     * never means leaving the page and hunting for the back button).
     */
    buildPurchaseSheet: function (d) {
        var esc = function (t) { return $('<span>').text(t == null ? '' : t).html(); };
        var money = function (v) { return PosnicPro.local.get('currencySign') + '&nbsp;' + (Number(v) || 0).toFixed(2); };
        var dt = function (v) { return v ? new Date(v).toLocaleDateString('en-IN') : '-'; };
        var real = function (v) { return v && v !== 'null' && v !== 'undefined' ? v : ''; };
        var open = d.receiving_status === 'Open';
        var cancelled = d.receiving_status === 'Cancelled';
        var partial = d.receiving_status === 'Partial';
        var L = PosnicPro.purchaseorders.STATUS_LABEL;
        var st = cancelled ? 'cancelled' : partial ? 'partial' : open ? 'ordered' : 'received';
        var logo = PosnicPro.local.get('branchimage');
        var taxLabel = PosnicPro.local.get('gst_action') === 'enable' ? 'GSTIN' : 'Tax ID';
        var seller = '<div class="q-seller">'
            + (logo && logo !== 'store.png' ? '<img loading="lazy" decoding="async" class="q-logo" src="' + esc(logo) + '" alt="">' : '')
            + '<div class="q-shop">' + esc(PosnicPro.local.get('branchname') || '') + '</div>';
        var addr = real(PosnicPro.local.get('branchaddress'));
        var ph = real(PosnicPro.local.get('branchphone'));
        var em = real(PosnicPro.local.get('branchemail'));
        var gst = real(PosnicPro.local.get('branchgstin'));
        if (addr) { seller += '<div class="q-muted">' + esc(addr) + '</div>'; }
        if (ph || em) { seller += '<div class="q-muted">' + esc(ph) + (ph && em ? ' &middot; ' : '') + esc(em) + '</div>'; }
        if (gst) { seller += '<div class="q-muted">' + taxLabel + ': ' + esc(gst) + '</div>'; }
        seller += '</div>';
        var title = '<div class="q-title-block">'
            + '<div class="q-doc-title">PURCHASE</div>'
            + '<div class="q-num">' + esc(d.receiving_id) + '</div>'
            + '<div class="q-muted">Bill date: ' + dt(d.date) + '</div>'
            + (d.expected_date ? '<div class="q-muted">Expected: ' + dt(d.expected_date) + '</div>' : '')
            + '<div class="q-status">' + L[st].toUpperCase() + '</div>'
            + '</div>';
        var supplier = '<div class="q-billto"><div class="q-label">Supplier</div>'
            + '<div class="q-cust">' + esc(d.supplier_name || '-') + '</div>'
            + (real(d.supplier_address) ? '<div class="q-muted">' + esc(d.supplier_address) + '</div>' : '')
            + '<div class="q-muted">'
            + (real(d.supplier_phone) ? 'Phone: ' + esc(d.supplier_phone) : '')
            + (real(d.supplier_phone) && real(d.supplier_gst_number) ? ' &middot; ' : '')
            + (real(d.supplier_gst_number) ? taxLabel + ': ' + esc(d.supplier_gst_number) : '')
            + '</div>'
            + (real(d.supplier_email) ? '<div class="q-muted">Email: ' + esc(d.supplier_email) + '</div>' : '')
            + '</div>';
        var items = '<div class="table-responsive"><table class="q-items"><thead><tr>'
            + '<th>#</th><th>Item</th><th class="text-right">Qty</th>'
            + '<th class="text-right">Unit cost</th><th class="text-right">Tax</th><th class="text-right">Amount</th>'
            + '</tr></thead><tbody>';
        (d.items || []).forEach(function (l, i) {
            var tax = (Number(l.igst_tax) || 0) + (Number(l.cgst_tax) || 0) + (Number(l.sgst_tax) || 0);
            var got = l.qty_received !== undefined && l.qty_received !== null ? parseFloat(l.qty_received) : null;
            var qtyCell = got !== null && got < (parseFloat(l.item_quantity) || 0)
                ? got + ' / ' + esc(l.item_quantity)
                : esc(l.item_quantity);
            items += '<tr><td>' + (i + 1) + '</td><td>' + esc(l.item_name) + '</td>'
                + '<td class="text-right"' + (got !== null && got < (parseFloat(l.item_quantity) || 0) ? ' title="Received so far / ordered"' : '') + '>' + qtyCell + ' ' + esc(l.item_unit || '') + '</td>'
                + '<td class="text-right">' + money(l.item_price) + '</td>'
                + '<td class="text-right">' + money(tax) + '</td>'
                + '<td class="text-right">' + money(l.total_amount) + '</td></tr>';
        });
        items += '</tbody><tfoot>'
            + '<tr class="q-sub"><td colspan="5" class="text-right">Subtotal</td>'
            + '<td class="text-right">' + money(d.subtotal_amount) + '</td></tr>'
            + (Number(d.tax) > 0
                ? '<tr class="q-sub"><td colspan="5" class="text-right">Tax</td><td class="text-right">' + money(d.tax) + '</td></tr>'
                : '')
            + (d.additional_charges || []).map(function (c) {
                return '<tr class="q-sub"><td colspan="5" class="text-right">' + esc(c.label || 'Charge')
                    + '</td><td class="text-right">' + money(c.amount) + '</td></tr>';
            }).join('')
            + (d.invoice_total_declared
                ? '<tr class="q-sub"><td colspan="5" class="text-right">Supplier\u2019s invoice states'
                    + (d.invoice_total_mismatch ? ' <i class="feather icon-alert-triangle text-warning"></i>' : '')
                    + '</td><td class="text-right">' + money(d.invoice_total_declared) + '</td></tr>'
                : '')
            + '<tr class="q-grand"><th colspan="5" class="text-right">TOTAL</th>'
            + '<th class="text-right">' + money(d.total_amount) + '</th></tr>'
            + '</tfoot></table></div>';
        var footer = '<div class="q-footer">';
        footer += '<div class="q-block"><div class="q-label">Payment details</div>'
            + '<div>' + esc(d.payment_mode || '-') + '</div>'
            + (real(d.payment_description) ? '<div class="q-muted">' + esc(d.payment_description) + '</div>' : '')
            + '</div>';
        if (d.image && d.image.length) {
            footer += '<div class="q-block"><div class="q-label">Attachments</div>';
            d.image.forEach(function (f) {
                footer += '<div><a href="' + esc(f.name) + '" target="_blank" rel="noopener"><i class="feather icon-paperclip mr-1"></i>' + esc(String(f.name).split('/').pop()) + '</a></div>';
            });
            footer += '</div>';
        }
        if (cancelled && d.void_reason) {
            footer += '<div class="q-block"><div class="q-label">Voided</div>'
                + '<div class="q-muted">By ' + esc(d.voided_by || '?')
                + (d.voided_at ? ' on ' + dt(d.voided_at) : '') + '</div>'
                + '<div>' + esc(d.void_reason) + '</div></div>';
        }
        footer += '</div>';
        return '<div class="q-sheet">'
            + '<div class="q-head">' + seller + title + '</div>'
            + supplier + items + footer
            + '</div>';
    },
    renderPurchaseDoc: function (d) {
        PosnicPro.purchaseorders._doc = d;
        var esc = function (t) { return $('<span>').text(t == null ? '' : t).html(); };
        var money = function (v) { return PosnicPro.local.get('currencySign') + '&nbsp;' + (Number(v) || 0).toFixed(2); };
        var dt = function (v) { return v ? new Date(v).toLocaleDateString('en-IN') : '-'; };
        var real = function (v) { return v && v !== 'null' && v !== 'undefined' ? v : ''; };
        var open = d.receiving_status === 'Open';
        var cancelled = d.receiving_status === 'Cancelled';
        var P = PosnicPro.purchaseorders.STATUS_PILL, L = PosnicPro.purchaseorders.STATUS_LABEL;
        var partial = d.receiving_status === 'Partial';
        var st = cancelled ? 'cancelled' : partial ? 'partial' : open ? 'ordered' : 'received';
        var chip = '<span class="rs-pill ' + P[st] + '">' + L[st] + '</span>';
        var itc = d.itc_eligible === false
            ? '<span class="rs-pill unpaid" title="No input credit on this purchase">No credit</span>' : '';
        var mismatch = d.invoice_total_mismatch
            ? '<span class="rs-pill hold" title="Declared invoice total does not match the lines"><i class="feather icon-alert-triangle"></i> Mismatch</span>' : '';
        var more = '<div class="btn-group">'
            + '<button type="button" class="btn btn-sm btn-light dropdown-toggle" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">More</button>'
            + '<div class="dropdown-menu dropdown-menu-right">'
            + '<a class="dropdown-item" href="javascript:void(0)" onclick="PosnicPro.receivings.showPrint(\'' + esc(d._id) + '\'); return false;"><i class="feather icon-printer mr-2"></i>Print</a>'
            + '<a class="dropdown-item" href="javascript:void(0)" onclick="PosnicPro.receivings.view.receivingPdf(\'' + esc(d._id) + '\');"><i class="feather icon-file mr-2"></i>Download PDF</a>'
            + '<a class="dropdown-item" href="javascript:void(0)" onclick="PosnicPro.receivings.view.emailToSupplier(\'' + esc(d._id) + '\');"><i class="feather icon-mail mr-2"></i>Email supplier</a>'
            + (!open && !cancelled
                ? '<a class="dropdown-item" href="javascript:void(0)" onclick="hasher.setHash(\'receivings/' + esc(d._id) + '/return\');"><i class="feather icon-corner-up-left mr-2"></i>Return items</a>'
                : '')
            + (!cancelled
                ? '<div class="dropdown-divider"></div>'
                    + '<a class="dropdown-item text-danger" href="javascript:void(0)" onclick="PosnicPro.purchaseorders.voidPurchase(\'' + esc(d._id) + '\',\'' + esc(d.receiving_id) + '\');"><i class="feather icon-slash mr-2"></i>Void</a>'
                : '')
            + '</div></div>';
        var toolbar = '<div class="p-doc-toolbar">'
            + '<button type="button" class="btn btn-sm btn-light" title="Show or hide the list" aria-label="Show or hide the list" onclick="PosnicPro.masterDetail.toggleRail(\'#purchases_split\');"><i class="feather icon-sidebar"></i></button>'
            + '<span class="p-doc-title">' + esc(d.receiving_id) + '</span>' + chip + itc + mismatch
            + '<span class="ml-auto"></span>'
            + ((open || partial) && !cancelled
                ? '<div class="btn-group">'
                    + '<button type="button" class="btn btn-sm btn-primary dropdown-toggle" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false"><i class="feather icon-check mr-1"></i>Receive</button>'
                    + '<div class="dropdown-menu">'
                    + '<a class="dropdown-item" href="javascript:void(0)" onclick="PosnicPro.purchaseorders.receiveAll(\'' + esc(d._id) + '\');">Received all</a>'
                    + '<a class="dropdown-item" href="javascript:void(0)" onclick="PosnicPro.purchaseorders.receiveStripOpen(\'' + esc(d._id) + '\');">Partially \u2026</a>'
                    + (partial
                        ? '<div class="dropdown-divider"></div><a class="dropdown-item text-danger" href="javascript:void(0)" onclick="PosnicPro.purchaseorders.closeShortOpen(\'' + esc(d._id) + '\');">Cancel remaining</a>'
                        : '')
                    + '</div></div>'
                : '')
            + (!cancelled ? '<button type="button" class="btn btn-sm btn-light" onclick="hasher.setHash(\'receivings/' + esc(d._id) + '/edit\');"><i class="feather icon-edit-2 mr-1"></i>Edit</button>' : '')
            + more
            + '<button type="button" class="btn btn-sm btn-light" title="Close this purchase and show the full list" aria-label="Close" onclick="PosnicPro.purchaseorders.closeDoc();"><i class="feather icon-x"></i></button>'
            + '</div>';
        var voidStrip = '<div class="p-void-strip" id="p_void_strip" style="display:none;">'
            + '<span>Void <b>' + esc(d.receiving_id) + '</b> \u2014 stock reverses, the record stays, the tax leaves the input credit.</span>'
            + '<input type="text" class="form-control form-control-sm" id="p_void_reason" maxlength="200" placeholder="Reason (required)" aria-label="Void reason">'
            + '<button type="button" class="btn btn-sm btn-danger" onclick="PosnicPro.purchaseorders.voidConfirm(\'' + esc(d._id) + '\');">Void purchase</button>'
            + '<button type="button" class="btn btn-sm btn-light" onclick="$(\'#p_void_strip\').slideUp(120);">Cancel</button>'
            + '</div>';
        var sheet = PosnicPro.purchaseorders.buildPurchaseSheet(d);
        var receiveStrip = '<div class="p-receive-strip" id="p_receive_strip" style="display:none;"></div>';
        $('#purchases_doc').html(toolbar + voidStrip + receiveStrip + '<div class="doc-scroll">' + sheet + '</div>');
    },
    /* Void asks its reason inline, in the pane - no native prompt. */
    /* ---- Partial receiving (owner: "received 5 items but remaining will
       receive later") - all, entered per line, or cancel the rest ---- */
    receiveAll: function (id) {
        PosnicPro.purchaseorders._postReceive(id, { all: true });
    },
    receiveStripOpen: function (id) {
        var d = PosnicPro.purchaseorders._doc || {};
        var esc = function (t) { return $('<span>').text(t == null ? '' : t).html(); };
        var rows = '';
        (d.items || []).forEach(function (l, i) {
            var ordered = parseFloat(l.item_quantity) || 0;
            var got = l.qty_received !== undefined && l.qty_received !== null ? (parseFloat(l.qty_received) || 0) : 0;
            var remaining = Math.max(0, ordered - got);
            if (remaining <= 0) { return; }
            rows += '<div class="p-rcv-row" data-item="' + esc(l.item_id) + '">'
                + '<span class="p-rcv-name">' + esc(l.item_name) + '</span>'
                + '<span class="p-rcv-progress">' + got + ' of ' + ordered + ' ' + esc(l.item_unit || '') + '</span>'
                + '<input type="number" class="form-control form-control-sm p-rcv-qty" min="0" max="' + remaining + '" step="any" value="' + remaining + '" aria-label="Quantity arriving now">'
                + '</div>';
        });
        if (!rows) { PosnicPro.alert('warning', 'Nothing left to receive.'); return; }
        $('#p_receive_strip').html(
            '<div class="p-rcv-head">Receiving now \u2014 adjust what actually arrived:</div>'
            + rows
            + '<div class="p-rcv-actions">'
            + '<button type="button" class="btn btn-sm btn-primary" onclick="PosnicPro.purchaseorders.receiveConfirm(\'' + esc(d._id) + '\');">Receive these quantities</button>'
            + '<button type="button" class="btn btn-sm btn-light" onclick="$(\'#p_receive_strip\').slideUp(120);">Cancel</button>'
            + '</div>'
        ).slideDown(120);
    },
    receiveConfirm: function (id) {
        var lines = $('#p_receive_strip .p-rcv-row').map(function () {
            return {
                item_id: $(this).data('item'),
                qty: parseFloat($(this).find('.p-rcv-qty').val()) || 0
            };
        }).get().filter(function (l) { return l.qty > 0; });
        if (!lines.length) { PosnicPro.alert('warning', 'Enter a quantity for at least one line.'); return; }
        PosnicPro.purchaseorders._postReceive(id, { lines: lines });
    },
    closeShortOpen: function (id) {
        var d = PosnicPro.purchaseorders._doc || {};
        var esc = function (t) { return $('<span>').text(t == null ? '' : t).html(); };
        $('#p_receive_strip').html(
            '<span>Close <b>' + esc(d.receiving_id) + '</b> at what has arrived \u2014 the remaining quantities will no longer be expected. No stock moves.</span>'
            + '<div class="p-rcv-actions">'
            + '<button type="button" class="btn btn-sm btn-danger" onclick="PosnicPro.purchaseorders._postReceive(\'' + esc(d._id) + '\', { close_short: true });">Cancel remaining</button>'
            + '<button type="button" class="btn btn-sm btn-light" onclick="$(\'#p_receive_strip\').slideUp(120);">Back</button>'
            + '</div>'
        ).slideDown(120);
    },
    _postReceive: function (id, payload) {
        PosnicPro.post({ url: 'receivings/' + id + '/receive', data: JSON.stringify(payload) }, function (r) {
            PosnicPro.alert(r.type || 'success', r.message || 'Received');
            PosnicPro.purchaseorders.loadList();
            PosnicPro.purchaseorders.openDoc('purchase', id);
        }, function (xhr) {
            var resp = {}; try { resp = jQuery.parseJSON(xhr.responseText) || {}; } catch (e) { }
            PosnicPro.alert('error', resp.message || 'Could not receive');
        });
    },
    voidPurchase: function (id, no) {
        $('#p_void_strip').slideDown(120);
        setTimeout(function () { $('#p_void_reason').trigger('focus'); }, 140);
    },
    voidConfirm: function (id) {
        var reason = $.trim($('#p_void_reason').val() || '');
        if (!reason) {
            $('#p_void_reason').addClass('is-invalid').attr('placeholder', 'A reason is required').trigger('focus');
            return;
        }
        PosnicPro.post({ url: 'receivings/' + id + '/void', data: JSON.stringify({ reason: reason }) }, function (r) {
            PosnicPro.alert(r.type || 'success', r.message || 'Purchase voided');
            PosnicPro.purchaseorders.loadList();
            PosnicPro.purchaseorders.openDoc('purchase', id);
        }, function (xhr) {
            var resp = {}; try { resp = jQuery.parseJSON(xhr.responseText) || {}; } catch (e) { }
            PosnicPro.alert('error', resp.message || 'Could not void this purchase');
        });
    },
    backToList: function () {
        $('#po_form_section,#po_view_section,#po_receive_section').hide();
        $('#po_list_section').show();
        PosnicPro.purchaseorders.loadList(1);
    },
    /* ---- form ---- */
    openForm: function (id) {
        PosnicPro.purchaseorders._lines = {};
        $('#po_form_id').val('');
        $('#po_supplier_name,#po_supplier_id,#po_expected_date,#po_notes,#po_item_search').val('');
        $('#po_cost_rows').html('');
        $('#po_form_verb').text(id ? 'Edit' : 'Create');
        PosnicPro.purchaseorders.renderLines();
        $('#po_list_section,#po_view_section,#po_receive_section').hide();
        $('#po_form_section').show();
        if (id) {
            PosnicPro.get({ url: 'purchaseOrders/' + id, data: '' }, function (response) {
                var po = response && response.data;
                if (!po) { return; }
                $('#po_form_id').val(id);
                $('#po_supplier_name').val(po.supplier_name);
                $('#po_supplier_id').val(po.supplier_id || '');
                $('#po_expected_date').val(po.expected_date ? String(po.expected_date).slice(0, 10) : '');
                $('#po_notes').val(po.notes || '');
                (po.items || []).forEach(function (line) {
                    PosnicPro.purchaseorders._lines[String(line.item_id)] = {
                        name: line.item_name, barcode: line.barcode_id || '',
                        stock: '', incoming: '',
                        qty: line.qty_ordered, cost: Math.round((Number(line.unit_cost) || 0) * 100) / 100
                    };
                });
                (po.additional_costs || []).forEach(function (c) {
                    PosnicPro.purchaseorders.addCostRow(c.label, c.amount);
                });
                PosnicPro.purchaseorders.renderLines();
            });
        }
    },
    addLine: function (row) {
        var key = String(row.item_id);
        if (!PosnicPro.purchaseorders._lines[key]) {
            PosnicPro.purchaseorders._lines[key] = {
                name: row.item_name, barcode: row.barcode_id || '',
                stock: (row.available_quantity === undefined ? '' : row.available_quantity),
                incoming: (row.incoming === undefined ? '' : row.incoming),
                /* Money, so two decimals: a company_price born of price*0.7
                   arrives as 27.999999999999996 and the cost input printed
                   every digit (owner: "purchase cost with so many decimal"). */
                qty: 1, cost: Math.round((Number(row.company_price) || 0) * 100) / 100
            };
        }
        PosnicPro.purchaseorders.renderLines();
    },
    renderLines: function () {
        var keys = Object.keys(PosnicPro.purchaseorders._lines);
        if (!keys.length) {
            $('#po_form_rows').html('<tr><td colspan="7" class="text-center text-muted">Search or fill from the supplier.</td></tr>');
            $('#po_form_total').text('0.00');
            return;
        }
        var html = keys.map(function (id) {
            var l = PosnicPro.purchaseorders._lines[id];
            var amount = (Number(l.qty) || 0) * (Number(l.cost) || 0);
            return '<tr>' +
                '<td>' + $('<span>').text(l.name).html() + '</td>' +
                '<td class="text-right">' + (l.stock === '' ? '-' : l.stock) + '</td>' +
                '<td class="text-right">' + (l.incoming === '' ? '-' : l.incoming) + '</td>' +
                '<td class="text-right"><input type="number" min="0.001" step="any" class="form-control form-control-sm text-right po-line-qty" data-id="' + id + '" value="' + l.qty + '"></td>' +
                '<td class="text-right"><input type="number" min="0" step="any" class="form-control form-control-sm text-right po-line-cost" data-id="' + id + '" value="' + l.cost + '"></td>' +
                '<td class="text-right">' + amount.toFixed(2) + '</td>' +
                '<td><a href="javascript:void(0)" class="text-danger po-line-remove" data-id="' + id + '">&times;</a></td>' +
                '</tr>';
        }).join('');
        $('#po_form_rows').html(html);
        PosnicPro.purchaseorders.renderTotal();
    },
    renderTotal: function () {
        var total = 0;
        Object.keys(PosnicPro.purchaseorders._lines).forEach(function (id) {
            var l = PosnicPro.purchaseorders._lines[id];
            total += (Number(l.qty) || 0) * (Number(l.cost) || 0);
        });
        $('#po_cost_rows .po-cost-amount').each(function () { total += Number($(this).val()) || 0; });
        $('#po_form_total').text(total.toFixed(2));
    },
    addCostRow: function (label, amount) {
        $('#po_cost_rows').append(
            '<div class="form-row align-items-center mb-1 po-cost-row">' +
            '<div class="col-5"><input type="text" class="form-control form-control-sm po-cost-label" maxlength="100" placeholder="e.g. freight" value="' + $('<span>').text(label || '').html() + '"></div>' +
            '<div class="col-3"><input type="number" min="0" step="any" class="form-control form-control-sm text-right po-cost-amount" value="' + (amount || '') + '"></div>' +
            '<div class="col-1"><a href="javascript:void(0)" class="text-danger po-cost-remove">&times;</a></div>' +
            '</div>');
    },
    fillFromSupplier: function (lowStockOnly) {
        var supplierId = $('#po_supplier_id').val();
        if (!supplierId) { PosnicPro.alert('warning', 'Choose a supplier first'); return; }
        var range = localStorage.getItem('notificationrange') || 10;
        PosnicPro.get({
            url: 'items/bySupplier',
            data: 'supplier_id=' + encodeURIComponent(supplierId) + '&low_stock=' + (lowStockOnly ? 'true' : 'false') + '&notificationrange=' + encodeURIComponent(range)
        }, function (response) {
            var rows = (response && response.data) || [];
            if (!rows.length) { PosnicPro.alert('info', 'No items for this supplier'); return; }
            rows.forEach(function (row) { PosnicPro.purchaseorders.addLine(row); });
        }, function () { PosnicPro.alert('error', 'Could not load the supplier items'); });
    },
    save: function (status) {
        var id = $('#po_form_id').val();
        var items = Object.keys(PosnicPro.purchaseorders._lines).map(function (key) {
            var l = PosnicPro.purchaseorders._lines[key];
            return { item_id: key, item_name: l.name, barcode_id: l.barcode, qty_ordered: Number(l.qty) || 0, unit_cost: Number(l.cost) || 0 };
        });
        var costs = $('#po_cost_rows .po-cost-row').map(function () {
            return { label: $(this).find('.po-cost-label').val(), amount: Number($(this).find('.po-cost-amount').val()) || 0 };
        }).get().filter(function (c) { return c.label; });
        var payload = {
            supplier_id: $('#po_supplier_id').val() || undefined,
            supplier_name: $('#po_supplier_name').val(),
            status: status,
            expected_date: $('#po_expected_date').val() || undefined,
            notes: $('#po_notes').val(),
            items: items,
            additional_costs: costs
        };
        var params = id
            ? { url: 'purchaseOrders/' + id, data: JSON.stringify(payload) }
            : { url: 'purchaseOrders', data: JSON.stringify(payload) };
        (id ? PosnicPro.put : PosnicPro.post)(params, function (response) {
            PosnicPro.alert(response.type, response.message);
            if (response.type === 'success') { PosnicPro.purchaseorders.backToList(); }
        }, function (xhr) {
            var resp = {}; try { resp = JSON.parse(xhr.responseText); } catch (e) { /* plain */ }
            PosnicPro.alert('error', resp.message || 'Could not save the purchase order');
        });
    },
    /* ---- view ---- */
    openView: function (id) {
        PosnicPro.get({ url: 'purchaseOrders/' + id, data: '' }, function (response) {
            var po = response && response.data;
            if (!po) { return; }
            PosnicPro.purchaseorders._detail = po;
            PosnicPro.purchaseorders.renderAttachments(po.attachments || []);
            var currency = PosnicPro.local.get('currencySign');
            $('#po_view_id').text(po.po_id);
            $('#po_view_status').text(po.status);
            $('#po_view_supplier').text(po.supplier_name);
            $('#po_view_date').text(String(po.order_date).slice(0, 10));
            $('#po_view_expected').text(po.expected_date ? String(po.expected_date).slice(0, 10) : '-');
            var ordered = 0, received = 0, rows = '';
            (po.items || []).forEach(function (line) {
                ordered += Number(line.qty_ordered) || 0;
                received += Number(line.qty_received) || 0;
                rows += '<tr><td>' + $('<span>').text(line.item_name).html() + '</td>' +
                    '<td class="text-right">' + line.qty_ordered + '</td>' +
                    '<td class="text-right">' + line.qty_received + '</td>' +
                    '<td class="text-right">' + (Number(line.unit_cost) || 0).toFixed(2) + '</td>' +
                    '<td class="text-right">' + (Number(line.line_total) || 0).toFixed(2) + '</td></tr>';
            });
            $('#po_view_rows').html(rows);
            var pct = ordered > 0 ? Math.min(100, Math.round(received * 100 / ordered)) : 0;
            $('#po_view_progress').html('<div class="progress" style="height:8px;"><div class="progress-bar" style="width:' + pct + '%;"></div></div><small class="text-muted">Received ' + received + ' of ' + ordered + '</small>');
            var costs = '';
            (po.additional_costs || []).forEach(function (c) {
                costs += '<div><small class="text-muted">' + $('<span>').text(c.label).html() + '</small> ' + currency + '&nbsp;' + (Number(c.amount) || 0).toFixed(2) + '</div>';
            });
            $('#po_view_costs').html(costs);
            $('#po_view_total').text(currency + ' ' + (Number(po.grand_total) || 0).toFixed(2));
            $('#po_view_notes').text(po.notes || '');
            var actions = '<button type="button" class="btn btn-sm btn-outline-secondary mr-1" onclick="PosnicPro.purchaseorders.backToList();">Back</button>';
            if (po.status === 'draft') {
                actions += '<button type="button" class="btn btn-sm btn-outline-primary mr-1" data-act="order">Place order</button>' +
                    '<button type="button" class="btn btn-sm btn-outline-secondary mr-1" data-act="edit">Edit</button>' +
                    '<button type="button" class="btn btn-sm btn-outline-danger mr-1" data-act="delete">Delete</button>';
            }
            if (po.status === 'ordered' || po.status === 'partial') {
                actions += '<button type="button" class="btn btn-sm btn-outline-primary mr-1" data-act="receive">Receive</button>';
                if (po.status === 'ordered') {
                    actions += '<button type="button" class="btn btn-sm btn-outline-secondary mr-1" data-act="edit">Edit</button>';
                }
                actions += '<button type="button" class="btn btn-sm btn-outline-danger mr-1" data-act="cancel_remaining">Cancel remaining</button>';
            }
            if ((po.items || []).length) {
                actions += '<button type="button" class="btn btn-sm btn-outline-secondary mr-1" data-act="labels">Print labels</button>';
            }
            $('#po_view_actions').html(actions).data('po-id', String(po._id));
            if ($('#purchases_po_host').length && $.contains($('#purchases_po_host')[0], $('#po_view_section')[0])) {
                /* master-detail: the document lives in the right pane; the
                   rail stays. Only the form/receive overlays hide. */
                $('#po_form_section,#po_receive_section').hide();
                $('#po_list_section,#po_view_section').show();
            } else {
                $('#po_list_section,#po_form_section,#po_receive_section').hide();
                $('#po_view_section').show();
            }
        });
    },
    transition: function (id, action) {
        PosnicPro.post({ url: 'purchaseOrders/' + id + '/transition', data: JSON.stringify({ action: action }) }, function (response) {
            PosnicPro.alert(response.type, response.message);
            if (response.type === 'success') { PosnicPro.purchaseorders.openView(id); }
        });
    },
    removeDraft: function (id) {
        PosnicPro.delete({ url: 'purchaseOrders/' + id, data: JSON.stringify({}) }, function (response) {
            PosnicPro.alert(response.type, response.message);
            if (response.type === 'success') { PosnicPro.purchaseorders.backToList(); }
        });
    },
    /*
     * Bulk labels from the open order (Loyverse study L3): one label per
     * ordered unit, name + barcode, rendered with the bundled JsBarcode and
     * printed from a plain window. Lines without any code are skipped and
     * counted honestly; the sheet caps at 500 labels so a typo in a
     * quantity cannot hang the browser.
     */
    printLabels: function () {
        var po = PosnicPro.purchaseorders._detail;
        if (!po) { return; }
        var labels = [];
        var skipped = 0;
        (po.items || []).forEach(function (line) {
            var code = String(line.barcode_id || '').trim();
            if (!code) { skipped += 1; return; }
            var copies = Math.max(1, Math.round(Number(line.qty_ordered) || 1));
            for (var c = 0; c < copies && labels.length < 500; c++) {
                labels.push({ name: line.item_name, code: code });
            }
        });
        if (!labels.length) {
            PosnicPro.alert('warning', 'No lines with a barcode to print');
            return;
        }
        // Render each unique code once, reuse the SVG per copy.
        var svgByCode = {};
        var $work = $('<div style="position:absolute;left:-9999px;top:0;"></div>').appendTo('body');
        Object.keys(labels.reduce(function (acc, l) { acc[l.code] = 1; return acc; }, {})).forEach(function (code) {
            var $svg = $('<svg></svg>').appendTo($work);
            try {
                $svg.JsBarcode(code, { format: 'CODE128', height: 40, width: 1.6, fontSize: 12, margin: 4, displayValue: true });
                svgByCode[code] = $work.children().last().prop('outerHTML');
            } catch (e) { svgByCode[code] = ''; }
        });
        $work.remove();
        var cells = labels.map(function (l) {
            return '<div class="lbl"><div class="lbl-name">' + $('<span>').text(l.name).html() + '</div>' + (svgByCode[l.code] || '') + '</div>';
        }).join('');
        var w = window.open('', '_blank');
        if (!w) { PosnicPro.alert('error', 'Allow pop-ups to print labels'); return; }
        w.document.write('<html><head><title>Labels ' + (po.po_id || '') + '</title><style>' +
            'body{margin:0;font-family:sans-serif;}' +
            '.sheet{display:flex;flex-wrap:wrap;}' +
            '.lbl{width:38mm;padding:2mm;border:1px dotted #ccc;text-align:center;page-break-inside:avoid;}' +
            '.lbl-name{font-size:9px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}' +
            'svg{max-width:100%;}' +
            '@media print{.lbl{border:none;}}' +
            '</style></head><body><div class="sheet">' + cells + '</div></body></html>');
        w.document.close();
        setTimeout(function () { w.print(); }, 400);
        if (skipped > 0) {
            PosnicPro.alert('info', skipped + ' line(s) had no barcode and were skipped');
        }
    },
    /*
     * Receive: open the ORDINARY receiving screen pre-filled with the
     * outstanding quantities, IN THIS PAGE ("receive items its going old
     * design" - the detour to the old receiving screen ends here). The item
     * rows come from items/bySupplier for tax rate and unit; quantities and
     * costs come from the PO; source_po_id rides the receiving payload so
     * the bridge mirrors received quantities back onto the order.
     */
    _receive: null,
    receive: function (id) {
        var po = PosnicPro.purchaseorders._detail;
        if (!po || String(po._id) !== String(id)) { PosnicPro.alert('error', 'Open the order first'); return; }
        PosnicPro.get({
            url: 'items/bySupplier',
            data: 'supplier_id=' + encodeURIComponent(po.supplier_id || '') + '&low_stock=false'
        }, function (response) {
            var byId = {};
            ((response && response.data) || []).forEach(function (row) { byId[row.item_id] = row; });
            var lines = [];
            (po.items || []).forEach(function (line) {
                var outstanding = (Number(line.qty_ordered) || 0) - (Number(line.qty_received) || 0);
                if (outstanding <= 0) { return; }
                var row = byId[String(line.item_id)] || {};
                lines.push({
                    item_id: String(line.item_id),
                    item_name: line.item_name || row.item_name || '',
                    item_unit: row.item_unit || 'qty',
                    outstanding: outstanding,
                    qty: outstanding,
                    cost: Math.round(((Number(line.unit_cost) || Number(row.company_price) || 0)) * 100) / 100,
                    rate: Number(row.tax) || 0,
                    tax_type: row.tax_type || ''
                });
            });
            if (!lines.length) { PosnicPro.alert('info', 'Nothing outstanding on this order'); return; }
            PosnicPro.purchaseorders._receive = { po: po, lines: lines };
            PosnicPro.purchaseorders.openReceive();
        }, function () { PosnicPro.alert('error', 'Could not load the order items'); });
    },
    openReceive: function () {
        var st = PosnicPro.purchaseorders._receive;
        if (!st) { return; }
        $('#po_receive_ref').text(st.po.po_id + ' · ' + (st.po.supplier_name || ''));
        var d = new Date();
        $('#po_receive_date').val(d.getFullYear() + '-'
            + String(d.getMonth() + 1).padStart(2, '0') + '-'
            + String(d.getDate()).padStart(2, '0'));
        $('#po_receive_note').val('');
        $('#po_receive_excl').prop('checked', false);
        var sel = $('#po_receive_payment').empty();
        sel.append('<option value="Cash" selected="selected">Cash</option>');
        $.each(PosnicPro.configPaymentType || [], function (i, val) {
            if (val.payment_value && val.payment_value !== 'Cash') {
                sel.append($('<option>').attr('value', val.payment_value).text(val.payment_value));
            }
        });
        PosnicPro.purchaseorders.renderReceiveRows();
        $('#po_list_section,#po_form_section,#po_view_section').hide();
        $('#po_receive_section').show();
    },
    cancelReceive: function () {
        var st = PosnicPro.purchaseorders._receive;
        PosnicPro.purchaseorders._receive = null;
        $('#po_receive_section').hide();
        if (st && st.po) { PosnicPro.purchaseorders.openView(String(st.po._id)); }
        else { PosnicPro.purchaseorders.backToList(); }
    },
    /* The same line math as the receiving screen: tax rides on top only when
       the switch says prices exclude it AND the item's own tax type agrees. */
    _receiveLineCalc: function (line, excl) {
        var rate = (excl && line.tax_type === 'exclusive') ? line.rate : 0;
        var base = (Number(line.qty) || 0) * (Number(line.cost) || 0);
        var tax = (base / 100) * rate;
        return { rate: rate, base: base, tax: tax, total: base + tax };
    },
    renderReceiveRows: function () {
        var st = PosnicPro.purchaseorders._receive;
        if (!st) { return; }
        var excl = $('#po_receive_excl').is(':checked');
        var esc = function (v) { return $('<i>').text(v == null ? '' : v).html(); };
        var rows = '', grand = 0;
        st.lines.forEach(function (line, idx) {
            var c = PosnicPro.purchaseorders._receiveLineCalc(line, excl);
            grand += c.total;
            rows += '<tr>' +
                '<td data-label="Item">' + esc(line.item_name) + '</td>' +
                '<td class="text-right" data-label="Outstanding">' + line.outstanding + ' ' + esc(line.item_unit) + '</td>' +
                '<td class="text-right" data-label="Receive qty"><input type="number" min="0" max="' + line.outstanding + '" step="any" class="form-control form-control-sm text-right po-receive-qty" data-idx="' + idx + '" value="' + line.qty + '" aria-label="Receive quantity"></td>' +
                '<td class="text-right" data-label="Purchase cost"><input type="number" min="0" step="any" class="form-control form-control-sm text-right po-receive-cost" data-idx="' + idx + '" value="' + line.cost + '" aria-label="Unit cost"></td>' +
                '<td class="text-right po-receive-taxcol" data-label="Tax">' + (c.rate > 0 ? c.rate + '% = ' + c.tax.toFixed(2) : '-') + '</td>' +
                '<td class="text-right" data-label="Amount">' + c.total.toFixed(2) + '</td>' +
                '</tr>';
        });
        $('#po_receive_rows').html(rows);
        $('#po_receive_total').text(grand.toFixed(2));
        $('.po-receive-taxcol').toggle(excl);
    },
    saveReceive: function () {
        var st = PosnicPro.purchaseorders._receive;
        if (!st) { return; }
        var excl = $('#po_receive_excl').is(':checked');
        var items = [], headerTax = 0;
        st.lines.forEach(function (line) {
            if ((Number(line.qty) || 0) <= 0) { return; }
            var c = PosnicPro.purchaseorders._receiveLineCalc(line, excl);
            headerTax += c.tax;
            items.push({
                item_id: line.item_id,
                item_name: line.item_name,
                item_quantity: String(line.qty),
                item_unit: line.item_unit,
                total_amount: c.total.toFixed(2),
                gst: Number(c.tax.toFixed(2)),
                item_tax: c.rate
            });
        });
        if (!items.length) { PosnicPro.alert('warning', 'Every quantity is 0 - nothing to receive.'); return; }
        var po = st.po;
        $('#po_receive_save').attr('disabled', 'disabled');
        PosnicPro.post({
            url: 'receivings',
            data: JSON.stringify({
                date: $('#po_receive_date').val(),
                supplier_id: po.supplier_id || '',
                supplier_name: po.supplier_name || '',
                supplier_address: po.supplier_address || '',
                supplier_phone: po.supplier_phone || '',
                supplier_email: po.supplier_email || '',
                supplier_state: po.supplier_state || '',
                supplier_gst_type: po.supplier_gst_type || '',
                supplier_gst_number: po.supplier_gst_number || '',
                payment_mode: $('#po_receive_payment').val(),
                status: 'Received',
                tax: headerTax.toFixed(2),
                discount: '0',
                payment_description: $('#po_receive_note').val(),
                print: 'off',
                items: items,
                id: null,
                image: [],
                exclusive_tax: excl ? 'on' : 'off',
                source_po_id: String(po._id)
            })
        }, function (response) {
            $('#po_receive_save').removeAttr('disabled');
            PosnicPro.alert(response.type, response.message);
            if (response.type !== 'success') { return; }
            PosnicPro.purchaseorders._receive = null;
            $('#po_receive_section').hide();
            /* the create endpoint syncs the PO mirror before answering, so
               the reopened order already shows the fresh received counts */
            PosnicPro.purchaseorders.openView(String(po._id));
            if (PosnicPro.stocklogs && PosnicPro.stocklogs.viewLowStockDashboard) {
                PosnicPro.stocklogs.viewLowStockDashboard();
            }
        }, function () {
            $('#po_receive_save').removeAttr('disabled');
            PosnicPro.alert('error', 'The receiving could not be saved.');
        });
    }
};
$(document).on('input', '.po-receive-qty, .po-receive-cost', function () {
    var st = PosnicPro.purchaseorders._receive;
    var line = st && st.lines[Number($(this).data('idx'))];
    if (!line) { return; }
    if ($(this).hasClass('po-receive-qty')) { line.qty = Math.max(0, Number($(this).val()) || 0); }
    else { line.cost = Math.max(0, Number($(this).val()) || 0); }
    /* re-render totals without rebuilding the row under the typing finger */
    var excl = $('#po_receive_excl').is(':checked');
    var row = $(this).closest('tr');
    var c = PosnicPro.purchaseorders._receiveLineCalc(line, excl);
    row.find('.po-receive-taxcol').text(c.rate > 0 ? c.rate + '% = ' + c.tax.toFixed(2) : '-');
    row.find('td').last().text(c.total.toFixed(2));
    var grand = 0;
    st.lines.forEach(function (l) { grand += PosnicPro.purchaseorders._receiveLineCalc(l, excl).total; });
    $('#po_receive_total').text(grand.toFixed(2));
});
$(document).on('click', '.po-list-row', function () {
    PosnicPro.purchaseorders.openView($(this).data('id'));
});
$(document).on('click', '#po_view_actions [data-act]', function () {
    var id = $('#po_view_actions').data('po-id');
    var act = $(this).data('act');
    if (act === 'edit') { PosnicPro.purchaseorders.openForm(id); }
    else if (act === 'delete') { PosnicPro.purchaseorders.removeDraft(id); }
    else if (act === 'receive') { PosnicPro.purchaseorders.receive(id); }
    else if (act === 'labels') { PosnicPro.purchaseorders.printLabels(); }
    else { PosnicPro.purchaseorders.transition(id, act); }
});
$(document).on('input', '.po-line-qty, .po-line-cost', function () {
    var id = $(this).data('id');
    var l = PosnicPro.purchaseorders._lines[id];
    if (!l) { return; }
    if ($(this).hasClass('po-line-qty')) { l.qty = Number($(this).val()) || 0; }
    else { l.cost = Number($(this).val()) || 0; }
    var amount = (l.qty * l.cost).toFixed(2);
    $(this).closest('tr').find('td').eq(5).text(amount);
    PosnicPro.purchaseorders.renderTotal();
});
$(document).on('input', '.po-cost-amount, .po-cost-label', function () { PosnicPro.purchaseorders.renderTotal(); });
$(document).on('click', '.po-cost-remove', function () { $(this).closest('.po-cost-row').remove(); PosnicPro.purchaseorders.renderTotal(); });
$(document).on('click', '.po-line-remove', function () {
    delete PosnicPro.purchaseorders._lines[$(this).data('id')];
    PosnicPro.purchaseorders.renderLines();
});
$(document).on('click', '#po_list_rows tr.purchases-row', function () {
    PosnicPro.purchaseorders.openDoc($(this).data('kind'), $(this).data('id'));
});
$(document).on('click', '#suppliers_list_rows tr.suppliers-row', function () {
    PosnicPro.suppliers.openDoc($(this).data('id'));
});
$(document).on('click', '#purchases_quick_filters .p-status-opt', function () {
    PosnicPro.purchaseorders._status = $(this).data('status') || '';
    $('#purchases_status_dd').text($(this).text());
    PosnicPro.purchaseorders.loadList(1);
});
$(document).on('click', '#purchases_quick_filters .p-exp-opt', function () {
    PosnicPro.purchaseorders._expected = $(this).data('expected') || '';
    $('#purchases_expected_dd').text($(this).text());
    PosnicPro.purchaseorders.loadList(1);
});

$(document).on('focus', '#receiving_add_supplier_name, #po_supplier_name', function () {
    /* devbridge fires no lookup on plain focus, even at minChars 0 - the
       standing picker rule (frequent-on-focus) needs this nudge. A box
       PREFILLED with the default supplier clears on click and shows the
       list with the default first; leaving without choosing restores it. */
    var $el = $(this);
    var ac = $el.data('autocomplete');
    if (!ac) { return; }
    var def = $el.data('prefilled-default');
    if ($el.val() && def && $el.val() === def.name) {
        $el.data('restore-default', $el.val());
        $el.val('');
    }
    $('.autocomplete-suggestions').data('ac-owner', $el);
    if (!$el.val()) { ac.onValueChange(); }
});
$(document).on('blur', '#receiving_add_supplier_name, #po_supplier_name', function () {
    var $el = $(this);
    var stash = $el.data('restore-default');
    if (stash && !$el.val()) {
        setTimeout(function () { if (!$el.val()) { $el.val(stash); } }, 200);
    }
    $el.removeData('restore-default');
});

$(document).ready(function () {
    // Supplier + item autocompletes for the PO form.
    $('#po_supplier_name').autocomplete({
        minChars: 0,
        formatResult: PosnicPro.receivings.supplierFormatResult,
        lookup: PosnicPro.receivings.supplierLookup('#po_supplier_name'),
        onSelect: function (suggestion) {
            if (suggestion.data && suggestion.data !== -1) { $('#po_supplier_id').val(suggestion.data.id); }
        },
        autoSelectFirst: true,
        triggerSelectOnValidInput: false
    });
    $('#po_item_search').autocomplete({
        lookup: function (query, done) {
            PosnicPro.get({ url: 'items/getReceivingItemsAjaxList', data: 'query=' + encodeURIComponent(query) + '&type=normal' }, function (response) {
                done({ suggestions: $.map(response.suggestions || [], function (d) { return { value: d.item_name, data: d }; }) });
            }, function () { done({ suggestions: [] }); });
        },
        onSelect: function (suggestion) {
            if (suggestion.data && suggestion.data.item_id) { PosnicPro.purchaseorders.addLine(suggestion.data); }
            var $box = $('#po_item_search');
            $box.val('');
            if ($box.data('autocomplete')) { $box.autocomplete('clear'); }
            setTimeout(function () { $box.focus(); }, 0);
        },
        autoSelectFirst: true,
        triggerSelectOnValidInput: false
    });
});

/* The joined purchases surface shares the same filter machinery; each page
   mounts on entry, so the key's config always points at the panel on screen. */
$(document).on('click', '#purchases_filter_btn', function () {
    PosnicPro.purchaseorders.mountPurchaseFilters(true);
    PosnicPro.listFilter.toggle('receivings');
});

/*
 * The paperwork that belongs to a purchase (owner: "we cant upload any
 * file. supplier po or some other stuff"). The endpoint accepts a receiving
 * OR a purchase order id, so the one purchases door attaches to either.
 */
PosnicPro.purchaseorders.renderAttachments = function (list) {
    var esc = function (v) { return $('<i>').text(v == null ? '' : v).html(); };
    if (!list.length) {
        $('#po_view_attachments').html('<li class="text-muted" style="font-size:12.5px;">Nothing attached yet.</li>');
        return;
    }
    $('#po_view_attachments').html(list.map(function (a) {
        var kb = a.size ? ' <span class="text-muted">(' + Math.max(1, Math.round(a.size / 1024)) + ' KB)</span>' : '';
        return '<li class="mb-1" style="font-size:13px;">'
            + '<a href="' + esc(a.url) + '" target="_blank" rel="noopener"><i class="feather icon-file mr-1"></i>' + esc(a.name) + '</a>' + kb
            + ' <a href="javascript:void(0)" class="text-danger ml-2 po-attach-remove" data-att="' + esc(a.id) + '" title="Remove">&times;</a>'
            + '</li>';
    }).join(''));
};
$(document).on('change', '#po_attach_file', function () {
    var file = this.files && this.files[0];
    this.value = '';
    var po = PosnicPro.purchaseorders._detail;
    if (!file || !po) { return; }
    if (file.size > 10 * 1024 * 1024) { PosnicPro.alert('error', 'That file is over 10MB.'); return; }
    var fd = new FormData();
    fd.append('file', file);
    $.ajax({
        url: 'api/receivings/' + po._id + '/attachments',
        method: 'POST',
        data: fd,
        processData: false,
        contentType: false,
        headers: { Authorization: 'Bearer ' + PosnicPro.local.get('posnic_jwt_token') },
        success: function (r) {
            po.attachments = (po.attachments || []).concat([(r && r.data) || {}]);
            PosnicPro.purchaseorders.renderAttachments(po.attachments);
            PosnicPro.alert('success', 'Attached.');
        },
        error: function (xhr) {
            var m = {}; try { m = JSON.parse(xhr.responseText); } catch (e) { }
            PosnicPro.alert('error', m.message || 'Could not attach the file.');
        }
    });
});
$(document).on('click', '.po-attach-remove', function () {
    var po = PosnicPro.purchaseorders._detail;
    var attId = $(this).data('att');
    if (!po || !attId) { return; }
    PosnicPro.delete({ url: 'receivings/' + po._id + '/attachments/' + attId, data: JSON.stringify({}) }, function () {
        po.attachments = (po.attachments || []).filter(function (a) { return a.id !== attId; });
        PosnicPro.purchaseorders.renderAttachments(po.attachments);
    }, function () { PosnicPro.alert('error', 'Could not remove it.'); });
});
