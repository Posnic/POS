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
        $(".vertical-layout").addClass("toggle-menu");
        $('#v-pills-purchase-tab,.receiving_new_shortcut').addClass('active');
        $('#v-pills-purchase').addClass('show active');
        $('.vertical-menu li a#view_receiving_page').addClass('active');
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
        var loader = $(".loader-table-receiving");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.dashboard.datePicker();
        PosnicPro.HideSideBarModal();
        $(".vertical-layout").removeClass("toggle-menu");
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $(".vertical-menu li a").removeClass("active");
        $('#v-pills-purchase-tab').addClass('active');
        $('#v-pills-purchase').addClass('show active');
        $('.page_loader,#osk-container,#receiving_view_receiving_edit').hide();
        $('.page-title-box,#showreceivingbody,#receiving_view_view_receiving_table,#receivings').show();
        PosnicPro.receivings.receivingsTable('receivings');
        $('.dashboard_img_menu').hide();
        $('#image_sidebar_purchasehistory').show();
        var loader = $(".loader-receiving");
        loader.find(".loadingSpinner:first").remove();
    },
    receivingsTable: function () {
        var loader = $(".loader-table-receiving");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        PosnicPro.appendViewDataTableBody('receivings');
        var table = $('#view_receivings');
        var params = {
            url: 'receivings',
            data: {
                page: table.data('current_page'),
                limit: parseInt($('#view_receivings_per_page  option:selected').text()),
                filters: table.data('filters')
            }
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                table.data('total', response.data.total);
                table.data('total_pages', response.data.total_pages);
                table.data('current_page', response.data.current_page);
                table.data('per_page', response.data.per_page);
                PosnicPro.paging(response.data.total_pages, response.data.current_page);
                table.children('tbody').text('');
                $('#view_receivings_total').text(response.data.total);
                var rowTotal = response.data.total;
                if (rowTotal === 0) {
                    $('.purchase_header').hide();
                    let dateRange = $('#view_sales_daterange span span[data-toggle="tooltip"]').attr('data-original-title');
                    $('.purchase_norecord').empty().append('<div class="text-center text-dark"> <p>No Records on ' + dateRange + '</p></div>');
                    $('#purchase_img_hide,.purchase_norecord').show();
                } else {
                    $('.purchase_norecord').empty();
                    $('#purchase_img_hide,.purchase_norecord').hide();
                    $('.purchase_header').show();
                }

                var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                $('#view_receivings_page_total').text(row_total);
                var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                $('#view_receivings_page_perpage_total').text(page_totals + response.data.list.length);
                var currency = PosnicPro.local.get('currencySign');
                for (var i = 0; i < response.data.list.length; i++) {
                    var row = response.data.list[i];
                    var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                    var process_class = "";
                    var print_icon = '<a data-module = "receiving" data-access = "read" data-toggle="tooltip" title="Receiving Print" href="#/receivings/' + row._id + '/print" data-id="receivings/' + row._id + '/print" class="point-cursor mobile_tooltip"><i class="feather icon-printer"></i></a>';
                    var pdf_icon = '<a data-module = "receiving" data-access = "read" href="#/receivings/' + row._id + '/pdf" data-id="receivings/' + row._id + '/pdf"  data-toggle="tooltip" title="Pdf" class="point-cursor mobile_tooltip"><i class="feather icon-file"></i></a>';
                    var view_icon = '<a data-module = "receiving" data-access = "read"  href="#/receivings/' + row._id + '" data-id="receivings/' + row._id + '"   data-toggle="tooltip" title="View" class="point-cursor mobile_tooltip"><i class="feather icon-eye"></i></a>';
                    var edit_icon = '<a data-module = "receiving" data-access = "write" href="#/receivings/' + row._id + '/edit" data-id="receivings/' + row._id + '/edit" id="edit_receiving_' + row._id + '" data-toggle="tooltip" title="Edit" class="point-cursor mobile_tooltip"><i class="feather icon-edit"></i></a>';
                    var return_icon = '<a data-module = "receiving" data-access = "write" href="#/receivings/' + row._id + '/return" data-id="receivings/' + row._id + '/return" id="return_receiving_' + row._id + '" data-toggle="tooltip" title="Receiving Return" class="point-cursor mobile_tooltip"><i class="feather icon-corner-up-left"></i></a>';
                    var received_icon = '<a data-module = "receiving" data-access = "write" href="#/receivings/' + row._id + '/received" data-id="receivings/' + row._id + '/received" data-toggle="tooltip" title="Received" class="point-cursor mobile_tooltip"><i class="feather icon-arrow-down-circle"></i></a>';
                    if (row.receiving_status === 'Open') {
                        var receiving_status = row.receiving_status;
                        process_class = "badge badge-primary-inverse";
                        return_icon = '<span class="show_return_icon" style="display:none;"></span>';
                    } else {

                        if (row.items.length === 0 && row.items_return.length > 0) {
                            var receiving_status = 'FullReturn';
                            process_class = "badge badge-danger-inverse";
                            pdf_icon = '<span class="show_pdf_icon" style="display:none;"></span>';
                            print_icon = '<span class="show_print_icon" style="display:none;"></span>';
                            return_icon = '<span class="show_return_icon" style="display:none;"></span>';
                            edit_icon = '<span class="show_edit_icon" style="display:none;"></span>';
                            received_icon = '<span class="show_received_icon" style="display:none;"></span>';
                        } else if (row.receiving_status === 'Received') {
                            var receiving_status = row.receiving_status;
                            process_class = "badge badge-success-inverse";
                            edit_icon = '<span class="show_edit_icon" style="display:none;"></span>';
                            received_icon = '<span class="show_received_icon" style="display:none;"></span>';
                        } else {
                            var receiving_status = 'PartialReturn';
                            process_class = "badge badge-secondary-inverse";
                            edit_icon = '<span class="show_edit_icon" style="display:none;"></span>';
                            received_icon = '<span class="show_received_icon" style="display:none;"></span>';
                        }

                    }

                    var action = '<div id="onclick-toolbar-options_' + i + '" class="hidden">' +
                            '<span class="show_print_icon" style="display:none;">' + print_icon + ' </span>' +
                            '<span class="show_pdf_icon" style="display:none;">' + pdf_icon + ' </span>' +
                            '<span class="show_return_icon" style="display:none;">' + return_icon + ' </span>' +
                            '<span class="show_received_icon" style="display:none;">' + received_icon + ' </span>' +
                            '<span class="show_view_icon" style="display:none;">' + view_icon + ' </span>' +
                            '<span class="show_edit_icon" style="display:none;">' + edit_icon + ' </span>' +
                            '<a data-module = "receiving" data-access = "delete" data-toggle="tooltip" title="Delete Sale" href="#/receivings/' + row._id + '/delete" data-id="receivings/' + row._id + '/delete" class="point-cursor mobile_tooltip"><i class="feather icon-trash"></i></a>' +
                            '</div>' +
                            '<div data-toolbar="user-options" class="btn btn-round btn-primary-rgba round-pad" id="onclick-toolbar_' + i + '"><i class="feather icon-more-vertical-"></i></div>';
                    var updateDate = PosnicPro.convertDate(row.string_date);
                    var trow = '<tr> <td><input type="checkbox" class="receivings-row-id" id="' + row._id + '" name="id[]" value="' + row._id + '" onclick="PosnicPro.checkboxSelectOne(this,\'receivings\');"></td> <td scope="row">' + row_no + '</td>  <td class="sale_id">' + row.receiving_id + '</td> <td class="sale_id">' + updateDate + '</td> <td width="20%">' + row.supplier_name + '</td> <td class="sale_id text-right"><a class="sale_color"  href="tel:' + row.supplier_phone + '">' + row.supplier_phone + '</a></td> <td class="text-center"><span class="' + process_class + '">' + receiving_status + '</span></td> <td class="text-right">' + currency + '&nbsp;<span class="number">' + row.total_amount + '</span></td> ' +
                            '<td class="text-center"> <span>' + action + ' </span>' +
                            ' </td></tr>';
                    $('#view_receivings').children('tbody').append(trow);
                }
                $('span.number').number(true, 2);
                $(document).ready(function () {
                    for (var i = 0; i < response.data.list.length; i++) {
                        $('#onclick-toolbar_' + i).toolbar({
                            content: '#onclick-toolbar-options_' + i,
                            event: 'click',
                            style: 'primary',
                            hideOnClick: true
                        });
                        $('#onclick-toolbar_' + i).on('toolbarItemClick', function (event, element) {
                            hasher.setHash($(element).data('id'));
                            $(this).trigger('click');
                            $('.mobile_tooltip').tooltip('hide');
                        });
                    }
                });
                PosnicPro.setSelectedCheckbox(PosnicPro["receivings_checkbox"], 'receivings');
                PosnicPro.ACLForModule('receiving');
                loader.find(".loadingSpinner:first").remove();
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
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
        var addLineItemQty = '<div class="input-group" id="return_input_group_' + id + '">' +
                '<div class="input-group-prepend">' +
                '<span class="btn btn-secondary-rgba receive_qty_check" id = ' + id + '  onclick="PosnicPro.receivings.qtyIncrementDecrease(this.id,0);"><i class="feather icon-minus"></i></span>' +
                '</div>' +
                '<input type="text" minlength="1" maxlength="5" size="3" min="0" max="100000" class="form-control cart-qty font_size14 float rec_sale_inp_val" id="addReceivingLineItemQty_' + id + '" value=' + item_quantity + ' onkeyup="PosnicPro.receivings.addLineReceivingChangeQty(\'' + id + '\');" style="text-align:center;" oninput="this.value = PosnicPro.minmax(this.value, 0, 100000)" onkeypress="PosnicPro.validate(event)" autocomplete="off">' +
                '<div class="input-group-append">' +
                '<span class="btn btn-success-rgba receive_qty_check" id = ' + id + '  onclick="PosnicPro.receivings.qtyIncrementDecrease(this.id,1);"><i class="feather icon-plus"></i></span>' +
                '</div>' +
                '</div>';
        if (PosnicPro.receivings.receivingReturnAction !== 'return') {
            var remove = '<td id=addReceivingRemoveLineItem_' + id + '>' +
                    '<button type="button" class="btn btn-danger-rgba mb-1" onclick="PosnicPro.receivings.removeLineItemReceiving(\'' + id + '\');" ><i class="feather icon-trash"></i></button>' +
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
                filepath = '<img class="img-thumbnail image_style" src="' + image_path + '" \
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
        $('#receiving-status-open').hide();
        $('#receiving-status-receive').addClass('active');
        $("#open:radio").attr("checked", false);
        $("#received:radio").attr('checked', true);
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
            var receivegrandTotal = (PosnicPro.roundoff === true) ? Math.round(addReceivingLineTotal).toFixed(2) : Number(addReceivingLineTotal).toFixed(2);
            $("#receiving_add_total_amount").number(receivegrandTotal, 2);
            $("#receiving_total").val(addReceivingLineTotal);
            $('span.number').number(true, 2);
        }

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
            title: 'Edit company price',
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
                        <img class="image_style" class="img-thumbnail" src="' + image_path + '" \
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
                    exclusive_tax: ($('#exclusive_tax').is(':checked', true)) ? 'on' : 'off'
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
                        var timeZone = PosnicPro.local.get('timezone');
                        var DateFormat = moment(timeStamp_value).tz(timeZone).format('YYYY/MM/DD LT');
                        var updateDate = PosnicPro.convertDate(DateFormat);
                        var head = '<thead><tr><td colspan="7"></td></tr><tr style="background:#e1e6f5;">' +
                                '<td>' + (i + 1) + '</td><td colspan="3"><span class="text-danger">' + result.items_return[i].returnArray['returnId'] + '</span></td><td colspan="3"><span class="text-danger">' + updateDate + '</span></td></tr>' +
                                '<tr><th class="text-left"><lang class="lang_name_title">Name </lang></th>' +
                                '<th class="text-center"><lang class="lang_qty_title">Qty </lang></th>' +
                                '<th class="text-center"><lang class="lang_unit_title">Unit </lang></th>' +
                                '<th class="text-right"><lang class="lang_price_title">Company Price </lang></th>' +
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
                exclusive_tax: ($('#exclusive_tax').is(':checked', true)) ? 'on' : 'off'
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
                        hasher.setHash('receivings');
                        return false;
                    }
                    PosnicPro.stocklogs.viewLowStockDashboard();
                    loader.find(".loadingSpinner:first").remove();
                    hasher.setHash('receivings');
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
        $(".receiving-status").prop("checked", false);
        $("#Open").val("Open");
        $('#Open').prop("checked", true);
        $('.open_status_active').addClass("active").siblings().removeClass("active");
        $('.open_status_active').addClass("active");
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
    $('#receiving_add_supplier_name').on('keydown.autocomplete', function () {
        $(this).autocomplete({
            lookup: function (query, done) {
                var result = {};
                var suggestions = [];
                var params = {
                    url: 'suppliers/getSuppliersAjaxList',
                    data: 'query=' + query + '&branch=' + PosnicPro.local.get("branch_id_set")
                };
                PosnicPro.get(params, function (response) {
                    if (response.suggestions.length > 0) {
                        suggestions: $.map(response.suggestions, function (dataItem) {
                            suggestions.push({"value": dataItem.name, "data": dataItem});
                        });
                    } else {
                        suggestions.push({value: $('#receiving_add_supplier_name').val() + ' ', data: -1});
                    }
                    result["suggestions"] = suggestions;
                    done(result);
                });
            },
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
            triggerSelectOnValidInput: false,
            formatResult: function (suggestion) {
                var phone = suggestion.data.phone;
                if (suggestion.data === -1 || typeof suggestion.phone === undefined) {
                    phone = "( Add new )";
                }
                return '<div>' +
                        $.Autocomplete.formatResult(suggestion) +
                        '</div><span class="pull-right" style="margin-top:-20px;">' + phone + '</span>';
            }

        });
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
$('#receiving_add_item_name').on('click keydown.autocomplete keyup.autocomplete', function () {
    var id = $('#receiving_add_supplier_id').val();
    var name = $('#receiving_add_supplier_name').val();
    if (name === '') {
        $('#receiving_add_supplier_name').focus();
        PosnicPro.alert('error', 'Enter a supplier name.');
        return false;
    }
    $(this).autocomplete({
        lookup: function (query, done) {
            var result = {};
            var suggestions = [];
            var params = {
                url: 'items/getReceivingItemsAjaxList',
                data: 'query=' + query + '&id=' + id + '&type=normal'
            };
            PosnicPro.get(params, function (response) {
                if (response.suggestions.length > 0) {
                    suggestions: $.map(response.suggestions, function (dataItem) {
                        suggestions.push({"value": dataItem.item_name, "data": dataItem});
                    });
                } else {
                    suggestions.push({value: $('#receiving_add_item_name').val() + ' ', data: -1});
                }
                result["suggestions"] = suggestions;
                done(result);
            });
        },
        onSelect: function (suggestion) {
            if (suggestion.data !== -1) {
                PosnicPro.receivings.suggestionParam = [suggestion.data];
                $('#receiving_add_selling_price').val(suggestion.data.selling_price);
                $('#item_id').val(suggestion.data.item_id);
                $('#barcode_id').val(suggestion.data.itemid);
                $('#receiving_add_available_stock').val(suggestion.data.available_quantity);
                $('#receiving_add_item_unit').val(suggestion.data.item_unit);
                $('#receiving_add_line_total').val(suggestion.data.company_price);
                PosnicPro.receivings.addReceivingLineItems(suggestion.data);
            } else {
                hasher.setHash('items/new/addnewitem');
            }
        },
        autoSelectFirst: true,
        triggerSelectOnValidInput: false,
        formatResult: function (suggestion, currentValue) {
            if (suggestion.data !== -1) {
                var data = suggestion.data.image;
                var price = 0;
                var currency = PosnicPro.local.get('currencySign');
                let sellingPrice = suggestion.data.company_price;
                let tax = suggestion.data.tax;
                let taxType = suggestion.data.tax_type;
                let taxPrice = (sellingPrice * tax) / (100 + tax);
                var inclusive_price = sellingPrice - taxPrice.toFixed(2);
                if (tax > 0) {
                    if (taxType === 'exclusive') {
                        price = sellingPrice + (sellingPrice * tax / 100);
                    } else {
                        price = inclusive_price + (inclusive_price / 100) * tax;
                    }
                } else {
                    price = sellingPrice;
                }
                var final_price = '<span class="suggestion-price pull-right">' + currency + '&nbsp;' + price.toFixed(2) + '</span>';
                var del_price = '<div class="pull-right font-12" style="margin-top:-20px;"><del>' + currency + '&nbsp;' + sellingPrice.toFixed(2) + '</del></div>';
                if (sellingPrice.toFixed(2) === price.toFixed(2)) {
                    del_price = '<span style="display:none;"></span>';
                }

                var action = '' + final_price + '' +
                        '' + del_price + '';
                var image_path = (data !== "item.svg") ? data : 'static/images/default/' + data;
                return '<img src="' + image_path + '" height="40" width="40" style="border-radius: 25%;" /> ' +
                        '<div class="suggestion-name">' +
                        $.Autocomplete.formatResult(suggestion, currentValue) +
                        '</div><span>' + action + '</span>';
            } else {
                let data = "item.svg";
                let price = "( Add new )";
                return '<img src="static/images/default/item.svg" height="40" width="40" style="border-radius: 25%;" /> ' +
                        '<div class="suggestion-name">' +
                        $.Autocomplete.formatResult(suggestion, currentValue) +
                        '</div><span>' + price + '</span>';
            }
        }
    });
});
$(document).on('change', '.receiving-status', function () {
    $('.receiving-status').val(this.id);
});
$('#receiving_upload_image').customFile();
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
                date: "Please enter a valid date",
                maxlength: "Enter a valid date",
            },
            receiving_add_supplier_name: {
                required: "Please Enter a Supplier Name",
                minlength: "Supplier Name Must be Atleast 3 Characters"

            },
        }
    });
    jQuery.validator.addMethod("commonDate", function (value, element) {
        return this.optional(element) || moment(value, 'YYYY/MM/DD LT').isValid();
    }, "Please enter a valid date in the format");
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