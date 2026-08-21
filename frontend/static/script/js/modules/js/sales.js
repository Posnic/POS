PosnicPro.sales = {
    /* Array Declaration */
    extraDiscount: [],
    addLineTable: [],
    addSalesLineTable: [],
    returnSalesLineTable: [],
    SaleTableLineItems: [],
    addSalesItemChars: [],
    EditRecentSaleParams: [],
    submissionInProgress: false,
    SaleDenomination: [],
    tablesList: [],
    selectedTable: null,
    selectedPerson: null,
    currentItemNoteId: null,
    dineType: 'Dine-in',
    recentSaleAction: false,
    recentSaleId: '',
    editSaleAction: false,
    editSaleId: '',
    salesId: '',
    refundSaleAction: false,
    refundSaleId: '',
    SaleAction: 'add',
    salesExchange: false,
    return_remove: null,
    deleteConfirmation: false,
    paymentOnlyMode: false,
    kotPaymentMode: false,
    originalSaleData: null,
    defaultCustomer: true,
    saleProcess: null,
    callbackRegistry: {
        name: '',
        arguments: ''
    },
    sub: function (value1, value2) {
        var sub = value1 - value2;
        return sub;
    },
    showAdd: function () {
        // ✅ Reset submission flag when opening new sale
        PosnicPro.sales.submissionInProgress = false;
        $("#save_btn").prop('disabled', false);
        $("#save_submit").removeClass('disabled');
        
        if (PosnicPro.local.get('table_options') === 'enable') {
            PosnicPro.sales.clear.cartItems(false);
        }
        PosnicPro.kotorder.kotHideShow();
        $('.addDisc-hide-show').hide();
        if (PosnicPro.sales.syncNotesCellSpan) { PosnicPro.sales.syncNotesCellSpan(); }
        $('#extraDisc').prop('disabled', false);
        $('#extraDisc').removeClass('extraDisc');
        $('#percentIcon, #rupeeIcon').css('pointer-events', 'auto').css('opacity', '1');
        PosnicPro.sales.defaultCustomer = true;
        PosnicPro.sales.dineType = 'Dine-in';
        $('#sale_dine_type').val('Dine-in');
        $('#dine_type_dinein').prop('checked', true);
        $('#dine_type_takeaway').prop('checked', false);
        $('#dinein_label').addClass('active');
        $('#takeaway_label').removeClass('active');
        PosnicPro.HideSideBarModal();
        $('.return_sale_only_show').hide();
        $('.RoundOff-hide-show').hide();
        $("#viewtest,#payment_id").show();
        $('#customer_current_balance').val();
        $('#Partial_amount').val();
        $('#table_return_page,#table_sale_page').find('table').removeAttr('id');
        PosnicPro.sales.EditRecentSaleParams = [];
        var myobj = document.getElementById("table_return_page");
        myobj.remove();
        var newDiv = document.createElement("div");
        newDiv.id = "table_return_page";
        var element = document.getElementById("table_return_page_parent");
        element.appendChild(newDiv);
        $('#sales_table').find('table').attr('id', 'sales_new_items_table');
        $('#show-sale-already-return-table').hide();
        if (PosnicPro.sales.SaleAction === 'return' || PosnicPro.sales.SaleAction === 'edit') {
            PosnicPro.sales.setDefaults();
        }
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $(".vertical-menu li a").removeClass("active");
        (PosnicPro.local.get('gst_action') === 'enable') ? $('.indian-gstr').show() : $('.indian-gstr').hide();
        $(".vertical-layout").addClass("toggle-menu");
        $("#sales_new_item_name").css("display", "block");
        $('#image_sidebar_dashboard,#image_sidebar_salehistry').hide();
        $('.dashboard_img_menu').hide();
        $('#image_sidebar_newsale').show();
        if (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') {
            $("#sales-text-change").text('à®ªà¯à®¤à®¿à®¯');
            $('.changeSalesBtnText').text('à®šà¯‡à®®à®¿');
            $('.payment_detail').addClass('tm_payment');
            $('.sales_new_class th').addClass('tm_fontsize');
            $('.items_head').addClass('tm_font12');
            $('.pay_amount_total').addClass('tm_font13');
        } else {
            $("#sales-text-change").text('New');
            $('.changeSalesBtnText').text('Save');
            $('.btn-payment-mode').removeClass('tm_payment');
            $('.sales_new_class th').removeClass('tm_fontsize');
            $('.items_head').removeClass('tm_font12');
            $('.pay_amount_total').removeClass('tm_font13');
        }
        $(".sale_table_head_hide").text('');
        $(".sale_table_head_text").text('Action');
        $("#refund_pay_total,#refund_sub_total,#refund_pay_hide,#refund_sub_hide").hide();
        $("#sales_new_items_table,#paymentdisplay,#return_tax,#return_disc,#return_discount").removeClass("customer-display-hide");
        /***Clear addlineitem table**/
        $(".save_return_submit,#sub_hide,#sub_total_hide,#pay_hide,#pay_total_hide,#items_view_hide,#payment_note").show();
        $(".payment_note").addClass("customer-display-hide");
        $("#return_view_hide,#button_return,#check_button,#return_button").css("display", "none");
        PosnicPro.sales.setSaleDefaults();
        $('.page_loader,#osk-container,#closeSaleButton,#closeEditButton,.return_discount_show').hide();
        $('.page-title-box,#holdSaleButton,#clearSaleButton,.return_discount_hide').show();
                        if (PosnicPro.sales && PosnicPro.sales.syncActionTooltips) { PosnicPro.sales.syncActionTooltips(); }
        /*New Sales*/
        var displayPage = 'sales';
        $('#' + displayPage + '_new').show();
        db.saleAutoFocus.get('1').then(function (data) {
            if (data.addSale === true) {
                $('#sales_new_item_name').focus();
            } else {
                $('#sales_new_item_name').blur();
            }
        });
        $('#time-format').addClass('commonDate');
        $('#time-format').removeClass('commonEditDate');
        PosnicPro.commonDate();
        if (PosnicPro.sales.applySaleDateLock) { PosnicPro.sales.applySaleDateLock(); }
        $('#v-pills-dashboard-tab,.sales_new_shortcut').addClass('active');
        $('#v-pills-dashboard').addClass('show active');
        $('.vertical-menu li a#view_touchsales_page').addClass('active');
        $("#time-format").attr('readOnly', 'true');
        $("#time-format").prop('disabled', false);
        $('.payment_detail').removeClass('active')
        $('.payment_mode').removeClass('active');
        if (PosnicPro.local.get('balance_view') === 'true') {
            $(".infobar-settings-sidebar-overlay").css({ "background": "transparent", "position": "initial" });
            $("#infobar-settings-sidebar-tender-details").removeClass("sidebarview");
            $('.salesBalanceAmount').show();
            $('#sales_save_button').hide();
        } else {
            $('.salesBalanceAmount').hide();
            $('#sales_save_button').show();
        }

        // Bind dine type toggle handler (Dine-in / Take away)
        $(document).off('change.dineType', 'input[name="dine_type"]').on('change.dineType', 'input[name="dine_type"]', function () {
            var value = $(this).val() || 'Dine-in';
            PosnicPro.sales.dineType = value;
            $('#sale_dine_type').val(value);
        });

        PosnicPro.sales.recentMenu.recentSalesTabDetails();
        $("#paymentreturnhistory").hide();
        var loader = $(".loader-sales-balance");
        loader.find(".loadingSpinner:first").remove(); 
    },
    showEdit: function (id) {
        // ✅ Reset submission flag when opening edit sale
        PosnicPro.sales.submissionInProgress = false;
        $("#save_btn").prop('disabled', false);
        $("#save_submit").removeClass('disabled');
        
        if (PosnicPro.sales.saleProcess !== 'KOT') {
            PosnicPro.sales.saleProcess = 'edit';
        }
        PosnicPro.kotorder.kotHideShow();

        $('#percentIcon, #rupeeIcon').css('pointer-events', 'auto').css('opacity', '1');
        PosnicPro.sales.defaultCustomer = false;
        $('[data-toggle="tooltip"]').tooltip("hide");
        $('#sales_new_items_table tbody').html('');

        $('#time-format').removeClass('commonDate');
        $('#time-format').addClass('commonEditDate');
        (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') ? $("#sales-text-change").text('à®¤à®¿à®°à¯à®¤à¯à®¤') : $("#sales-text-change").text('Edit');
        $(".sale_table_head_hide").text('');
        $(".sale_table_head_text").text('Action');
        $('.return_sale_only_show').hide();
        $("#viewtest,#payment_id").show();
        $('#table_return_page,#table_sale_page').find('table').removeAttr('id');
        $('#sales_table').find('table').attr('id', 'sales_new_items_table');
        (PosnicPro.local.get('gst_action') === 'enable') ? $('.indian-gstr').show() : $('.indian-gstr').hide();
        // For KOT History payment-only flow, do not collapse/expand the main
        // layout sidebar. This keeps the current page (KOT History) visible
        // behind the tender popup and avoids a sidebar flicker.
        if (!(PosnicPro.sales.kotPaymentMode === true && PosnicPro.sales.paymentOnlyMode === true)) {
            $(".vertical-layout").addClass("toggle-menu");
        }
        $('#show-sale-already-return-table').hide();
        $('#v-pills-dashboard-tab').addClass('active');
        $('#v-pills-dashboard').addClass('show active');

        $("#refund_pay_total,#refund_sub_total,#refund_pay_hide,#refund_sub_hide").hide();
        $(".save_return_submit,#sub_hide,#sub_total_hide,#pay_hide,#pay_total_hide").show();
        $("#payment_note").show();
        $("#items_view_hide").css("display", "block");
        $("#return_view_hide,#check_button,#return_button,#button_return").css("display", "none");
        PosnicPro.sales.recentMenu.recentSalesTabDetails();
        if (PosnicPro.sales.saleProcess === 'KOT') {
            $('.salesBalanceAmount').hide();
            $('#sales_save_button').show();
        }
        PosnicPro.sales.view.showSalesEditPage(id);

        $("#time-format").attr('readOnly', 'true');
        $("#time-format").prop('disabled', true);
        $("#paymentreturnhistory").hide();
        var loader = $(".loader-sales-balance");
        loader.find(".loadingSpinner:first").remove();
    },
    showDelete: function (id) {
        PosnicPro.deleteTableRowData(id, 'sales');
    },
    showPdf: function (id) {
        PosnicPro.sales.view.salesPdf(id);
    },
    showPrint: function (id) {
        PosnicPro.sales.view.printSale(id, 'sale');
    },
    showPayment: function (id) {
        // Payment-only flow from Sales history (â‚¹ / dollar icon)
        // Mark we are in payment-only mode and reuse the normal Edit flow to load
        // the sale page and items. Once the edit data is ready, we will open the
        // tender screen from recentMenu.editItems.
        PosnicPro.sales.paymentOnlyMode = true;
        PosnicPro.sales.originalSaleData = null;
        PosnicPro.sales.defaultCustomer = false;
        PosnicPro.sales.refundSaleAction = false;
        PosnicPro.sales.recentSaleAction = false;

        // Update URL to mimic viewing this sale (#/sales/{id}) without
        // triggering Crossroads routes.
        if (typeof hasher !== 'undefined') {
            try {
                hasher.changed.active = false;
                hasher.replaceHash('sales/' + id);
                hasher.changed.active = true;
            } catch (e) {
                // ignore hash errors, continue payment flow
            }
        }

        // Delegate to existing edit logic so UI, totals and line items are all
        // initialized consistently.
        PosnicPro.sales.showEdit(id);
    },
    showWhatsapp: function (id) {
        PosnicPro.sales.view.whatsappSale(id, 'sale');
    },
    showSMS: function (id, phone, name) {
        $('#smsModal').modal('show');
        $('#customer_sms_id').val(id);
        $('#customer_sms_phone').val(phone);
        $('#customer_sms_name').val(name);
        $('#customer_sms_fullphone').val(phone);
    },
    
    showWhatsAppReceipt: function (id, phone, name) {
        console.log('showWhatsAppReceipt called');
        console.log('PosnicPro.sales:', PosnicPro.sales);
        console.log('sendWhatsAppReceipt function:', PosnicPro.sales.addSale.sendWhatsAppReceipt);
        
        // Store sale ID for template variable replacement
        PosnicPro.sales.currentSaleId = id;
        console.log('showWhatsAppReceipt - Stored sale ID:', PosnicPro.sales.currentSaleId);
        
        $('#smsModal').modal('show');
        $('#smsModal .modal-title .lang_autosmsaftersales_title').text('WhatsApp Receipt');
        $('#customer_sms_id').val(id);
        $('#customer_sms_phone').val(phone);
        $('#customer_sms_name').val(name);
        $('#customer_sms_fullphone').val(phone);
        
        // Add template selection to WhatsApp receipt modal
        this.addTemplateSelectionToModal(id);
        $('#customer_sms_phone').val(phone);
        $('#customer_sms_name').val(name);
        $('#customer_sms_fullphone').val(phone);
        
        // Change form ID and submit handler for WhatsApp
        $('#sms_form').attr('id', 'whatsapp_receipt_form');
        $('#whatsapp_receipt_form').off('submit').on('submit', function(e) {
            e.preventDefault();
            console.log('Form submitted, calling sendWhatsAppReceipt');
            PosnicPro.sales.addSale.sendWhatsAppReceipt();
        });
    },

    /**
     * Add template selection to WhatsApp receipt modal
     */
    addTemplateSelectionToModal: function(saleId) {
        // Load WhatsApp templates
        const params = {
            url: 'whatsapp/getTemplates'
        };

        PosnicPro.get(params, (response) => {
            if (response.type === 'success' && response.data) {
                // Add template dropdown to modal
                const templateDropdown = `
                    <div class="form-group" id="whatsapp_template_group">
                        <label for="whatsapp_receipt_template">Use Template (Optional)</label>
                        <select class="form-control" id="whatsapp_receipt_template">
                            <option value="">Select a template...</option>
                        </select>
                    </div>
                `;
                
                // Remove existing template dropdown if any
                $('#whatsapp_template_group').remove();
                
                // Add template dropdown after phone field
                $('#customer_sms_fullphone').parent().after(templateDropdown);
                
                // Populate templates (all templates can be used for sales)
                const select = $('#whatsapp_receipt_template');
                response.data.forEach(template => {
                    // Show all templates, but indicate sales_receipt type in display
                    const displayName = template.template_type === 'sales_receipt' ? 
                        `${template.name} (Sales)` : template.name;
                    select.append(`<option value="${template._id}">${displayName}</option>`);
                });
                
                // Add change event handler
                select.off('change').on('change', () => {
                    const templateId = select.val();
                    if (templateId) {
                        // Find template from loaded data
                        const template = response.data.find(t => t._id === templateId);
                        if (template) {
                            $('#customer_sms_message').val(template.message);
                        } else {
                            $('#customer_sms_message').val('Template not found');
                        }
                    } else {
                        // Reset to default message
                        $('#customer_sms_message').val('');
                    }
                });
            }
        });
    },
    showReturnPrint: function (id) {
        PosnicPro.kotorder.kotHideShow();
        PosnicPro.sales.view.returnPrintSales(id);
    },
    showHold: function (id) {
        PosnicPro.kotorder.kotHideShow();
        // Resuming a parked sale means collecting now - Paid is the
        // default, not the hold's stored Unpaid (owner ask).
        setTimeout(function () {
            $('#unpaid_payment_toggle').prop('checked', true).trigger('change');
        }, 600);
        PosnicPro.sales.defaultCustomer = false;
        $('[data-toggle="tooltip"]').tooltip("hide");
        $('#time-format').removeClass('commonDate');
        $('#time-format').addClass('commonEditDate');
        $(".sale_table_head_hide").text('');
        $(".sale_table_head_text").text('Action');
        $('.return_sale_only_show').hide();
        $("#viewtest,#payment_id").show();
        $('#table_return_page,#table_sale_page').find('table').removeAttr('id');
        $('#sales_table').find('table').attr('id', 'sales_new_items_table');
        (PosnicPro.local.get('gst_action') === 'enable') ? $('.indian-gstr').show() : $('.indian-gstr').hide();
        $(".vertical-layout").addClass("toggle-menu");
        $('#show-sale-already-return-table').hide();
        $('#v-pills-dashboard-tab').addClass('active');
        $('#v-pills-dashboard').addClass('show active');
        $("#refund_pay_total,#refund_sub_total,#refund_pay_hide,#refund_sub_hide").hide();
        $(".save_return_submit,#sub_hide,#sub_total_hide,#pay_hide,#pay_total_hide").show();
        $("#payment_note").show();
        $("#items_view_hide").css("display", "block");
        $("#return_view_hide,#check_button,#return_button,#button_return").css("display", "none");
        PosnicPro.sales.recentMenu.recentSalesTabDetails();
        PosnicPro.sales.showSalesHoldPage(id);
        // After retrieving a parked sale, jump to the Items tab - the cashier's
        // next step is almost always to add more items, not stay on Recent Sales.
        $('#home-tab-justified').trigger('click');
        $("#time-format").attr('readOnly', 'true');
        $("#paymentreturnhistory").hide();
        var loader = $(".loader-sales-balance");
        loader.find(".loadingSpinner:first").remove();
    },
    showSalesHoldPage: function (id) {
        var params = {
            url: 'sales/getSaleQtyDetail',
            data: { sale_id: id }
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                PosnicPro.sales.view.showSalesEditPage(id);
            } else {
                hasher.changed.active = false; //disable changed signal
                hasher.replaceHash('sales');
                hasher.changed.active = true; //enable changed signal
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    showDetails: function (id) {
        var loader = $(".loader-view-sale");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.showViewModal('sales');
        PosnicPro.sales.view.viewSale(id);
    },
    viewSaleDetails: function (id) {
        PosnicPro.sales.showDetails(id);
    },
    showDataTablePage: function () {
        PosnicPro.sales.recentSaleAction = false;
        var loader = $(".loader-table-sale");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.dashboard.datePicker();
        PosnicPro.HideSideBarModal();
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $(".vertical-layout").removeClass("toggle-menu");
        $(".vertical-menu li a").removeClass("active");
        $('#v-pills-dashboard-tab,#view_sales_page').addClass('active');
        $('#v-pills-dashboard').addClass('show active');
        $('.page_loader,#osk-container,#closeSaleButton,#closeEditButton').hide();
        $('.page-title-box,#sales,#view_sales_table,#showsalesbody').show();
        $('#view_sales_per_page').closest('.form-group').show();
        $('.card.m-b-30.sales_header .ecommerce-pagination').closest('.card.m-b-30').show();
        PosnicPro.sales.salesTable('sales');
        $('#image_sidebar_dashboard,#image_sidebar_newsale').hide();
        $('.dashboard_img_menu').hide();
        $('#image_sidebar_salehistry').show();
        var loader = $(".loader-sales-balance");
        loader.find(".loadingSpinner:first").remove();
    },
    salesTable: function () {
        var loader = $(".loader-table-sale");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        // ✅ Hide "+ New" button when viewing Sales History (not in sale creation/edit mode)
        if (PosnicPro.local.get('table_options') === 'enable') {
            $('#sales_new_button').hide();
        } else{
            $('#sales_new_button').show();
        }
        PosnicPro.appendViewDataTableBody('sales');
        var table = $('#view_sales');

        var existingFilters = table.data('filters');
        var filterObj = {};
        if (existingFilters) {
            try {
                filterObj = (typeof existingFilters === 'string') ? JSON.parse(existingFilters) : existingFilters;
            } catch (e) {
                filterObj = {};
            }
        }

        var saleProcessFilter = filterObj.sale_process;
        if (!saleProcessFilter || typeof saleProcessFilter !== 'object') {
            saleProcessFilter = {};
        }
        // Exclude KOT records from main Sales History
        saleProcessFilter['$ne'] = 'KOT';
        filterObj.sale_process = saleProcessFilter;
        var salesFilters = JSON.stringify(filterObj);

        // Load client-side cache of KOT proceeded sale ids to ensure we hide
        // edit actions even if the backend doesn't yet return was_kot_proceeded.
        var kotProceededIds = [];
        try {
            var storedKotIds = PosnicPro.local.get('kot_proceeded_ids');
            if (storedKotIds) {
                kotProceededIds = JSON.parse(storedKotIds);
            }
        } catch (e) {
            kotProceededIds = [];
        }

        var params = {
            url: 'sales',
            data: {
                page: table.data('current_page'),
                limit: parseInt($('#view_sales_per_page  option:selected').text()),
                filters: salesFilters
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

                $('#view_sales_total').text(response.data.total);
                var rowTotal = response.data.total;
                if (rowTotal === 0) {
                    $('.sales_header').hide();
                    var dateRange = $('#view_sales_daterange span span[data-toggle="tooltip"]').attr('data-original-title');
                    $('.sales_norecord').empty().append('<div class="text-center text-dark"> <p>No Records on  ' + dateRange + '</p></div>');
                    $('#sales_img_hide,.sales_norecord').show();
                } else {
                    $('.sales_norecord').empty();
                    $('#sales_img_hide,.sales_norecord').hide();
                    $('.sales_header').show();
                }

                var rowStart = (table.data('current_page') - 1) * table.data('per_page') + 1;
                $('#view_sales_page_total').text(rowStart);
                var pageTotals = (table.data('current_page') - 1) * table.data('per_page');
                $('#view_sales_page_perpage_total').text(pageTotals + response.data.list.length);

                var currency = PosnicPro.local.get('currencySign');

                for (var i = 0; i < response.data.list.length; i++) {
                    var row = response.data.list[i];
                    var table_number = row.table_number || '';
                    var dine_type = row.dine_type || '';
                    var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                    var price = parseFloat(row.sales_total).toFixed(2);

                    var pdf_icon = '<a href="#/sales/' + row._id + '/pdf" target="_blank" data-module="sales" data-access="read" data-id="sales/' + row._id + '/pdf" data-toggle="tooltip" title="Pdf" class="point-cursor mobile_tooltip"><i class="feather icon-file"></i></a>';
                    // Q2: permanent S3 invoice link - copied to the clipboard.
                    var link_icon = '<a href="javascript:void(0)" data-module="sales" data-access="read" data-sale-id="' + row._id + '" data-toggle="tooltip" title="Copy invoice link" class="point-cursor mobile_tooltip sale-invoice-link"><i class="feather icon-link"></i></a>';
                    var print_icon = '<a data-module="sales" data-access="read" data-toggle="tooltip" title="Sale Print" href="#/sales/' + row._id + '/print" data-id="sales/' + row._id + '/print" class="point-cursor mobile_tooltip"><i class="feather icon-printer"></i></a>';
                    var return_icon = '<a data-module="sales" data-access="write" href="#/sales/' + row._id + '/return" data-id="sales/' + row._id + '/return" id="return_sales_' + row._id + '" data-toggle="tooltip" title="Sales Return" class="point-cursor mobile_tooltip"><i class="feather icon-corner-up-left"></i></a>';
                    var view_icon = '<a data-module="sales" data-access="read" href="#/sales/' + row._id + '" data-id="sales/' + row._id + '" data-toggle="tooltip" title="View" class="point-cursor mobile_tooltip"><i class="feather icon-eye"></i></a>';
                    var edit_icon = '<a data-module="sales" data-access="write" href="#/sales/' + row._id + '/edit" data-id="sales/' + row._id + '/edit" id="edit_sales_' + row._id + '" data-toggle="tooltip" title="Edit" class="point-cursor mobile_tooltip"><i class="feather icon-edit"></i></a>';
                    var hold_icon = '<a data-module="sales" data-access="write" href="#/sales/' + row._id + '/hold" data-id="sales/' + row._id + '/hold" data-toggle="tooltip" title="Retrieve parked sale" class="point-cursor mobile_tooltip"><i class="feather icon-play-circle"></i></a>';

                    var paymentStatusText = (typeof (row.payment_status) === 'undefined' || row.payment_status === null) ? 'Paid' : row.payment_status;
                    var showUnpaidPayment = (paymentStatusText === 'Unpaid') && (row.sale_process === 'Add' || row.sale_process === 'Edit');
                    var payment_icon = '';
                    if (showUnpaidPayment) {
                        payment_icon = '<a data-module="sales" data-access="write" href="javascript:void(0);" onclick="PosnicPro.sales.showPayment(\'' + row._id + '\');" data-toggle="tooltip" title="Add Payment" class="point-cursor mobile_tooltip"><i class="feather icon-dollar-sign"></i></a>';
                    }

                    var process_class = '';
                    if (row.sale_process === 'Add' || row.sale_process === 'Edit') {
                        process_class = (row.sale_process === 'Add') ? 'badge badge-success-inverse' : 'badge badge-primary-inverse';
                        hold_icon = '<span id="show_hold_icon" style="display:none;"></span>';
                    } else if (row.sale_process === 'PartialReturn') {
                        process_class = 'badge badge-secondary-inverse';
                        edit_icon = '<span id="show_edit_icon" style="display:none;"></span>';
                        hold_icon = '<span id="show_hold_icon" style="display:none;"></span>';
                    } else if (row.sale_process === 'FullReturn') {
                        process_class = 'badge badge-dark-inverse';
                        pdf_icon = '<span id="show_pdf_icon" style="display:none;"></span>';
                        print_icon = '<span id="show_print_icon" style="display:none;"></span>';
                        return_icon = '<span id="show_return_icon" style="display:none;"></span>';
                        edit_icon = '<span id="show_edit_icon" style="display:none;"></span>';
                        hold_icon = '<span id="show_hold_icon" style="display:none;"></span>';
                    } else {
                        process_class = 'badge badge-warning-inverse';
                        return_icon = '<span id="show_return_icon" style="display:none;"></span>';
                        edit_icon = '<span id="show_edit_icon" style="display:none;"></span>';
                    }

                    var processHtml;
                    if (row.sale_process === 'cancelled' || row.sale_process === 'Cancelled') {
                        processHtml = '<span class="badge badge-danger-inverse">Cancel</span>';
                        hold_icon = '<span id="show_hold_icon" style="display:none;"></span>';
                    } else {
                        // Show "Parked" for held sales (keep the stored value 'Hold').
                        var processLabel = (row.sale_process === 'Hold') ? 'Parked' : row.sale_process;
                        processHtml = '<span class="' + process_class + '">' + processLabel + '</span>';
                    }

                    // Hide Edit (but not Return) for KOT orders that have been
                    // settled into Sales History and whose payment status is Paid.
                    // Use the persistent backend flag first and fall back to the
                    // local cache so behaviour is stable even after cache clear.
                    var isKotProceededSale = (row.was_kot_proceeded === true) ||
                        (kotProceededIds.indexOf(row._id) !== -1);
                    var isKotProceededAndPaid = isKotProceededSale && (paymentStatusText === 'Paid');
                    if (isKotProceededAndPaid) {
                        edit_icon = '<span id="show_edit_icon" style="display:none;"></span>';
                    }

                    var updateDate = PosnicPro.convertDate(row.string_date);
                    $('#date_view').html(updateDate);

                    var paymentStatus;
                    if (showUnpaidPayment) {
                        paymentStatus = '<span class="badge badge-warning-inverse payment-status-unpaid" data-toggle="tooltip" data-placement="top" title="Add Payment" onclick="PosnicPro.sales.showPayment(\'' + row._id + '\');">Unpaid</span>';
                    } else {
                        if (paymentStatusText === 'Cancelled' || paymentStatusText === 'cancelled') {
                            paymentStatus = '<span class="badge badge-danger-inverse">' + paymentStatusText + '</span>';
                        } else if (paymentStatusText === 'Paid') {
                            paymentStatus = '<span class="badge badge-success-inverse">Paid</span>';
                        } else {
                            paymentStatus = '<span class="badge badge-warning-inverse">' + paymentStatusText + '</span>';
                        }
                    }

                    var action = '<div id="onclick-toolbar-options_' + i + '" class="hidden">' +
                        '<span id="show_print_icon" style="display:none;">' + print_icon + ' </span>' +
                        '<span id="show_pdf_icon" style="display:none;">' + pdf_icon + link_icon + ' </span>' +
                        '<span id="show_return_icon" style="display:none;">' + return_icon + ' </span>' +
                        '<span id="show_view_icon" style="display:none;">' + view_icon + ' </span>' +
                        '<span id="show_edit_icon" style="display:none;">' + edit_icon + ' </span>' +
                        '<span id="show_payment_icon" style="display:none;">' + payment_icon + ' </span>' +
                        '<span id="show_hold_icon" style="display:none;">' + hold_icon + ' </span>' +
                        '<a data-module="sales" data-access="delete" data-toggle="tooltip" title="Delete Sale" href="#/sales/' + row._id + '/delete" data-id="sales/' + row._id + '/delete" class="point-cursor mobile_tooltip"><i class="feather icon-trash"></i></a>' +
                        '</div>' +
                        '<div data-toolbar="user-options" class="btn btn-round btn-primary-rgba round-pad" id="onclick-toolbar_' + i + '"><i class="feather icon-more-vertical-"></i></div>';

                    var trow = '<tr>' +
                        '<td><input type="checkbox" class="sales-row-id" id="' + row._id + '" name="id[]" value="' + row._id + '" onclick="PosnicPro.checkboxSelectOne(this, \'sales\');"></td>' +
                        '<td scope="row">' + row_no + '</td>' +
                        '<td class="sale_id">' + row.sales_id + '</td>' +
                        '<td class="sale_id">' + updateDate + '</td>' +
                        '<td width="20%">' + row.customer_name + '</td>' +
                        '<td class="sale_id text-right table-phone-hide"><a href="tel:' + row.customer_phone + '" class="table-phone text-right">' + row.customer_phone + '</a></td>' +
                        '<td class="text-center table-number-hide"><span>' + table_number + '</span></td>' +
                        '<td class="text-center order-type-column"><span>' + dine_type + '</span></td>' +
                        '<td class="text-center">' + processHtml + '</td>' +
                        '<td class="sale_id text-right">' + currency + '&nbsp;<span class="number">' + price + '</span></td>' +
                        '<td width="20%" class"right">' + paymentStatus + '</td>' +
                        '<td class="text-center"><span>' + action + ' </span></td>' +
                        '</tr>';

                    $('#view_sales').children('tbody').append(trow);
                }

                if (PosnicPro.local.get('table_options') === 'enable') {
                    $('.table-number-hide').show();
                    $('.table-phone-hide').hide();
                    $('.order-type-column').show();
                } else {
                    $('.table-number-hide').hide();
                    $('.table-phone-hide').show();
                    $('.order-type-column').hide();
                }

                // Re-evaluate column visibility based on actual row data.
                // If all rows have empty table/order type, hide those columns and show phone.
                (function () {
                    var hasTableOrOrderTypeData = false;
                    $('#view_sales').find('tbody tr').each(function () {
                        var tableText = $.trim($(this).find('.table-number-hide span').text());
                        var orderTypeText = $.trim($(this).find('.order-type-column span').text());
                        if (tableText !== '' || orderTypeText !== '') {
                            hasTableOrOrderTypeData = true;
                            return false; // break loop
                        }
                    });

                    if (PosnicPro.local.get('table_options') === 'enable' && hasTableOrOrderTypeData) {
                        $('.table-number-hide').show();
                        $('.table-phone-hide').hide();
                        $('.order-type-column').show();
                    } else {
                        $('.table-number-hide').hide();
                        $('.table-phone-hide').show();
                        $('.order-type-column').hide();
                    }
                })();

                $(document).ready(function () {

                    for (var k = 0; k < response.data.list.length; k++) {
                        $('#onclick-toolbar_' + k).toolbar({
                            content: '#onclick-toolbar-options_' + k,
                            event: 'click',
                            style: 'primary',
                            hideOnClick: true
                        });
                        $('#onclick-toolbar_' + k).on('toolbarItemClick', function (event, element) {
                            var targetId = $(element).data('id');
                            if (targetId) {
                                hasher.setHash(targetId);
                            }
                            $(this).trigger('click');
                            $('.mobile_tooltip').tooltip('hide');
                        });
                    }
                });

                $('span.number').number(true, 2);
                PosnicPro.setSelectedCheckbox(PosnicPro["sales_checkbox"], 'sales');
                PosnicPro.ACLForModule('sales');
                if (PosnicPro.local.get('table_options') === 'enable') {
                    $('.auto-refresh-hide').show();
                } else {
                    $('.auto-refresh-hide').hide();
                }
                loader.find(".loadingSpinner:first").remove();
            } else {
                loader.find(".loadingSpinner:first").remove();
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            loader.find(".loadingSpinner:first").remove();
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    searchItem: function (id) {
        var matched = false;
        for (var key in PosnicPro.sales.SaleTableLineItems) {
            if (PosnicPro.sales.SaleTableLineItems.hasOwnProperty(key)) {
                if (PosnicPro.sales.SaleTableLineItems[key].item_id === id) {
                    matched = PosnicPro.sales.SaleTableLineItems[key];
                }
            }
        }
        return matched;
    },
    /*ADD SALES LINE ITEMS ADD IN ADD SALE PRODUCT TABLE*/
    /*
     * Modifiers at sale time (V2): an item with option sets opens the
     * picker before it lands on the sale. Deltas ride the UNIT price (so
     * discounts and tax flow exactly as for any price - modifiers are
     * taxed with their item, the industry norm), the picked names autofill
     * the line note (which already flows to item_description and the KOT),
     * and the structured list rides the sale payload. One line per item:
     * re-adding the same item increments quantity with the same modifiers.
     */
    _lineModifiers: {},
    _modifierDefs: null,
    _modifierDefsAt: 0,
    /*
     * Price lists (V4): the selected customer's category prices newly
     * added lines - a per-item override wins, else the percentage rule,
     * else the normal selling price. Applied ONCE per line at add time,
     * before the modifier picker so deltas ride the list price. Changing
     * the customer mid-sale does not reprice lines already on the sale
     * (documented default - re-add the line to reprice it).
     */
    _customerCategoryId: '',
    _priceLists: null,
    _priceListsAt: 0,
    _loadPriceLists: function () {
        if (PosnicPro.sales._priceLists && (Date.now() - PosnicPro.sales._priceListsAt) < 60000) { return; }
        PosnicPro.get({ url: 'setting/priceLists', data: {} }, function (r) {
            PosnicPro.sales._priceLists = (r && r.data) || [];
            PosnicPro.sales._priceListsAt = Date.now();
        }, function () { PosnicPro.sales._priceLists = []; });
    },
    _applyPriceList: function (params) {
        if (params._priceListApplied) { return params; }
        params._priceListApplied = true;
        var catId = PosnicPro.sales._customerCategoryId;
        var lists = PosnicPro.sales._priceLists;
        if (!catId || !lists || !lists.length) { return params; }
        var list = null;
        for (var i = 0; i < lists.length; i++) {
            if (String(lists[i].customer_category_id) === String(catId)) { list = lists[i]; break; }
        }
        if (!list) { return params; }
        var itemId = String(params.id ? params.id : params.item_id);
        var override = null;
        (list.item_overrides || []).forEach(function (o) {
            if (String(o.item_id) === itemId) { override = o; }
        });
        var oldPrice = Number(params.selling_price) || 0;
        var newPrice = oldPrice;
        if (override) {
            newPrice = Number(override.price);
        } else if (list.percent_off) {
            newPrice = oldPrice * (1 - Number(list.percent_off) / 100);
            newPrice = Math.round(newPrice * 100) / 100;
        }
        if (Number.isFinite(newPrice) && newPrice >= 0 && newPrice !== oldPrice) {
            // Both fields move together, same rule as modifiers: inclusive
            // de-grossing and discount math downstream read either.
            params.selling_price = newPrice;
            params.mrp_price = newPrice;
        }
        return params;
    },
    _loadModifierDefs: function (cb) {
        if (PosnicPro.sales._modifierDefs && (Date.now() - PosnicPro.sales._modifierDefsAt) < 60000) {
            cb(PosnicPro.sales._modifierDefs);
            return;
        }
        PosnicPro.get({ url: 'setting/modifierGroups', data: {} }, function (r) {
            PosnicPro.sales._modifierDefs = (r && r.data) || [];
            PosnicPro.sales._modifierDefsAt = Date.now();
            cb(PosnicPro.sales._modifierDefs);
        }, function () { cb([]); });
    },
    openModifierPicker: function (params) {
        var esc = function (s) {
            return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
                return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
            });
        };
        var wanted = (params.modifier_group_ids || []).map(String);
        PosnicPro.sales._loadModifierDefs(function (defs) {
            var groups = defs.filter(function (g) { return wanted.indexOf(String(g.id)) >= 0; });
            if (!groups.length) {
                params._modifiersResolved = true;
                PosnicPro.sales.addSalesLineItems(params);
                return;
            }
            var currency = PosnicPro.local.get('currencySign');
            var body = '';
            groups.forEach(function (g, gi) {
                var rules = (g.min > 0 ? 'pick at least ' + g.min : 'optional')
                    + (g.max > 0 ? ', at most ' + g.max : '');
                body += '<div class="mod-pick-group mb-2" data-gi="' + gi + '" data-min="' + (g.min || 0) + '" data-max="' + (g.max || 0) + '" data-gname="' + esc(g.name) + '">'
                    + '<h6 class="mb-1">' + esc(g.name) + ' <small class="text-muted">(' + esc(rules) + ')</small></h6>';
                g.options.forEach(function (o, oi) {
                    var d = Number(o.price_delta) || 0;
                    var dLabel = d ? ' <small class="text-muted">(' + (d > 0 ? '+' : '−') + currency + Math.abs(d).toFixed(2) + ')</small>' : '';
                    body += '<div class="custom-control custom-checkbox">'
                        + '<input type="checkbox" class="custom-control-input mod-pick" id="modpick_' + gi + '_' + oi + '" data-name="' + esc(o.name) + '" data-delta="' + d + '">'
                        + '<label class="custom-control-label" for="modpick_' + gi + '_' + oi + '">' + esc(o.name) + dLabel + '</label>'
                        + '</div>';
                });
                body += '</div>';
            });
            $('#sale_modifier_modal').remove();
            $('body').append(
                '<div class="modal fade close_on_esc" id="sale_modifier_modal" tabindex="-1" role="dialog" aria-hidden="true">'
                + '<div class="modal-dialog modal-sm" role="document"><div class="modal-content">'
                + '<div class="modal-header"><h5 class="modal-title">' + esc(params.item_name || params.name || '') + '</h5>'
                + '<button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button></div>'
                + '<div class="modal-body">' + body + '</div>'
                + '<div class="modal-footer">'
                + '<button type="button" class="btn btn-outline-secondary" data-dismiss="modal">Skip</button>'
                + '<button type="button" class="btn btn-outline-primary" id="mod_pick_confirm">Add to sale</button>'
                + '</div></div></div></div>'
            );
            $('#sale_modifier_modal').modal('show');
            var proceed = function (picked) {
                $('#sale_modifier_modal').modal('hide');
                var sum = picked.reduce(function (a, m) { return a + (Number(m.price_delta) || 0); }, 0);
                var p2 = JSON.parse(JSON.stringify(params));
                p2._modifiersResolved = true;
                if (sum) {
                    p2.selling_price = (Number(p2.selling_price) || 0) + sum;
                    p2.mrp_price = (Number(p2.mrp_price) || 0) + sum;
                }
                var lineId = p2.id ? p2.id : p2.item_id;
                if (picked.length) { PosnicPro.sales._lineModifiers[lineId] = picked; }
                PosnicPro.sales.addSalesLineItems(p2);
                if (picked.length) {
                    // The note cell already flows to item_description and the
                    // KOT - the picked names ride that existing path.
                    setTimeout(function () {
                        $('#addSalesLineItemNote_' + lineId).text(picked.map(function (m) { return m.name; }).join(', '));
                    }, 150);
                }
            };
            $('#mod_pick_confirm').on('click', function () {
                var picked = [];
                var problem = null;
                $('.mod-pick-group').each(function () {
                    var min = parseInt($(this).data('min'), 10) || 0;
                    var max = parseInt($(this).data('max'), 10) || 0;
                    var gname = $(this).data('gname');
                    var chosen = $(this).find('.mod-pick:checked');
                    if (chosen.length < min) { problem = gname + ': pick at least ' + min + '.'; return false; }
                    if (max > 0 && chosen.length > max) { problem = gname + ': at most ' + max + '.'; return false; }
                    chosen.each(function () {
                        picked.push({ group: gname, name: $(this).data('name'), price_delta: Number($(this).data('delta')) || 0 });
                    });
                });
                if (problem) { PosnicPro.alert('warning', problem); return; }
                proceed(picked);
            });
        });
    },
    addSalesLineItems: function (params) {
        // Recency (owner feedback): every added item feeds the recent list -
        // written here so search, scan, camera, tiles and recents all count.
        if (PosnicPro.sales._recentPush && params.sales_type !== 'instant') {
            PosnicPro.sales._recentPush('recent_items', {
                id: params.id || params.item_id,
                name: params.item_name || params.name,
                price: params.selling_price,
                image: params.image || 'item.svg'
            }, 'id');
        }
        // Price list first, so modifier deltas ride the customer's price.
        if (PosnicPro.sales.SaleAction !== 'return'
            && PosnicPro.sales.searchItem(params.id ? params.id : params.item_id) === false) {
            params = PosnicPro.sales._applyPriceList(params);
        }
        if (!params._modifiersResolved
            && PosnicPro.local.get('table_options') === 'enable'
            && Array.isArray(params.modifier_group_ids) && params.modifier_group_ids.length
            && PosnicPro.sales.SaleAction !== 'return'
            && PosnicPro.sales.searchItem(params.id ? params.id : params.item_id) === false) {
            PosnicPro.sales.openModifierPicker(params);
            return;
        }
        var item = PosnicPro.sales.searchItem(params.id);
        // if (item !== false) {
        //     // existing item, do not add
        //     return;
        // }
        $('table#sales_new_items_table tr#sales_new_tablerow_content_area').remove();
        var item_quantity = (typeof (params.item_quantity) != "undefined" && params.item_quantity !== null) ? params.item_quantity : 1;
        if (PosnicPro.sales.editSaleAction === true) {
            PosnicPro.sales.recentMenu.setEditSalesDetails();
        }
        var addSalesLineDiscount = (params.discount_amount > 0) ? params.discount_amount : params.discount_percentage;
        var Discount = (params.discount_amount > 0) ? params.discount_amount : params.selling_price * (params.discount_percentage / 100);
        var currencySign = PosnicPro.local.get('currencySign');
        var discountSign = (params.discount_amount > 0) ? currencySign : '%';
        if ((params.discount_amount > 0)) {
            var discount_percentages = '' + discountSign + '' + addSalesLineDiscount + '';
        } else {
            var discount_percentages = '' + addSalesLineDiscount + '' + discountSign + '';

        }
        var isDiscountAmount = params.discount_amount > 0;
        var discountDisplay = isDiscountAmount ? currencySign + addSalesLineDiscount : addSalesLineDiscount + discountSign;
        /*
         * Tax module OFF means STOP COLLECTING, not just hide the config
         * (common standard - recorded sales keep their stored tax; new
         * sales apply none). One gate at the single entry every line-item
         * calculation flows through: exclusive, inclusive, discounts, GST
         * fields and return lines all read lineItemTax from here.
         */
        var taxModuleOn = true;
        try {
            var gs = JSON.parse(PosnicPro.local.get('general_settings') || '{}');
            taxModuleOn = gs.module_tax_enable !== false;
        } catch (e) { /* default on */ }
        if (!taxModuleOn) {
            // Normalise the param itself: several branches below read
            // params.tax directly, not the local copy.
            params.tax = 0;
        }
        var lineItemTax = params.tax;
        var lineItemTaxType = params.tax_type;
        var id = params.id ? params.id : params.item_id;
        var item_name = params.item_name ? params.item_name : params.name;
        var item_description = '';
        if (typeof (params.item_description) !== "undefined" && params.item_description !== null) {
            item_description = params.item_description;
        } else if (typeof (params.description) !== "undefined" && params.description !== null) {
            item_description = params.description;
        }
        // Normalize any HTML description into plain text so it looks clean in the textarea
        if (item_description && typeof item_description === 'string') {
            item_description = $('<div>').html(item_description).text();
        }
        var item = PosnicPro.sales.searchItem(id);

        if (item !== false) {
            if (PosnicPro.sales.SaleAction === 'return') {
                return false;
            } else {
                var lineqty = params.available_quantity - placedQty;
                /*
                 * parseFloat, not parseInt.
                 *
                 * Adding the same item twice adds the two quantities. With
                 * parseInt, 0.300kg of onions already in the cart read as 0,
                 * so scanning them again replaced the weight with a whole
                 * number - the customer was billed 1kg for 600g.
                 */
                item_quantity = (lineqty === 0) ? item_quantity
                    : parseFloat(item_quantity) + parseFloat($('#touchsale_item_qty' + id).val());
            }
        }
        if (params.track_inventory === true && params.negative_stock === false) {
            var placedQty = $('#touchsale_item_qty' + id).val();
            if (params.available_quantity <= placedQty) {
                $('#touchsale_item_qty' + id).val(params.available_quantity);
                PosnicPro.alert('error', 'Some items are out of stock.');
                return false;
            }
        }

        /*While Refund Sale If Add New Item SalesExchange Should be True - Ordertype Set Into Exchange*/
        var ordertype = (PosnicPro.sales.salesExchange === true) ? 'exchange' : PosnicPro.sales.SaleAction;
        if ((PosnicPro.sales.SaleAction === 'return')) {
            $('#payment_description').editable('setValue', PosnicPro.sales.EditRecentSaleParams.payment_description);
            $('#sales_description').editable('setValue', PosnicPro.sales.EditRecentSaleParams.sales_description);

            if (PosnicPro.sales.EditRecentSaleParams && typeof PosnicPro.sales.EditRecentSaleParams.discount_description !== 'undefined') {
                var discountNote = PosnicPro.sales.EditRecentSaleParams.discount_description || '';
                if (discountNote === '') {
                    $('#discount_description').text('').val('').hide();
                    $('#click_discount_description').css({ color: '#506fe4' });
                } else {
                    $('#discount_description').val(discountNote).hide();
                    $('#discount_description').editable('setValue', discountNote);
                    $('#click_discount_description').css({ color: '#5fd799' });
                }
            }
            var updateReturnPrice = params.selling_price * 1;
            var PriceReturnDiscount = Discount * 1;
            var updateReturnLineTotal = updateReturnPrice - PriceReturnDiscount;
            var salesReturnLineTotal = Number(updateReturnLineTotal).toFixed(2);
            var addSalesReturnTaxValue = (lineItemTax > 0) ? (salesReturnLineTotal / 100) * parseFloat(lineItemTax) : '';
            var return_line_total = updateReturnLineTotal + addSalesReturnTaxValue;
            //            $('.changeSalesBtnText').text('Return');
            $('.salesBalanceAmount').hide();
            (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') ? $('.changeSalesBtnText').text('à®¤à®¿à®°à¯à®®à¯à®ª à®µà®¿à®±à¯à®ªà®©à¯ˆ') : $('.changeSalesBtnText').text('Return');
            $('#closeSaleButton').show();
            $("#return_disc").css("display", "none");
            $('#sales_new_customer_name').val(PosnicPro.sales.EditRecentSaleParams.customer_name);
            $(".vertical-layout").removeClass("toggle-menu");
            $('#v-pills-dashboard-tab').addClass('active');
            $('#v-pills-dashboard').addClass('show active');
            var addLineItemQty = '<div class="input-group">' +
                '<div class="input-group-prepend" id = ' + id + '  onclick="PosnicPro.sales.quantity.qtyreturnDecrease(this.id,0);">' +
                '<span class="btn btn-secondary-rgba button_qty_check"><i class="feather icon-minus"></i></span>' +
                '</div>' +
                '<input type="text" class="form-control cart-qty font_size14" style="text-align:center;background-color:#fff;" minlength="1" maxlength="7" size="3" min="0" max="10000" name="addSalesLineItemQty" id="touchsale_item_return_qty' + id + '" value=' + item_quantity + ' onfocusout="PosnicPro.sales.quantity.returntextOnChange(\'' + id + '\');"  oninput="this.value = PosnicPro.minmax(this.value, 0, 100000)" onkeypress="PosnicPro.validate(event)" autocomplete="off">' +
                '<div class="input-group-append" id = ' + id + '  onclick="PosnicPro.sales.quantity.qtyreturnDecrease(this.id,1);">' +
                '<span class="btn btn-success-rgba button_qty_check"><i class="feather icon-plus"></i></span>' +
                '</div>' +
                '</div>';
            var removeLineItem = '<button type="button" class="btn-danger-rgba mb-1" onclick="PosnicPro.sales.quantity.removeReturnsalesLineRowItems(\'' + id + '\');"><i class="feather icon-arrow-right-circle"></i></button>';
        } else {
            var addLineItemQty = '<div class="input-group">' +
                '<div class="input-group-prepend">' +
                '<span class="btn btn-secondary-rgba button_qty_check" id = ' + id + '  onclick="PosnicPro.sales.quantity.qtyIncreaseDecrease(this.id,0,\'' + params.track_inventory + '\',\'' + params.negative_stock + '\');" style="width:45px;"><i class="feather icon-minus custom_minus" style="margin-left:-7px;"></i></span>' +
                '</div>' +
                '<input type="text" class="form-control cart-qty font_size14 rec_sale_inp_val" minlength="1" maxlength="7" size="4" min="0" max="100000" name="addSalesLineItemQty" id="touchsale_item_qty' + id + '" value=' + item_quantity + ' onkeyup="PosnicPro.sales.quantity.textOnChange(\'' + id + '\',\'' + params.track_inventory + '\',\'' + params.negative_stock + '\');" oninput="this.value = PosnicPro.minmax(this.value, 0, 100000)" onfocusout="PosnicPro.sales.quantity.normalizeInput(\'' + id + '\');" onkeypress="PosnicPro.validate(event)" style="text-align:center;background-color:#fff;width:140px;text-align: center; max-width:120px !important;">' +
                '<div class="input-group-append">' +
                '<span class="btn btn-success-rgba button_qty_check" id = ' + id + '  onclick="PosnicPro.sales.quantity.qtyIncreaseDecrease(this.id,1,\'' + params.track_inventory + '\',\'' + params.negative_stock + '\');" style="width:45px;"><i class="feather icon-plus custom_plus" style="margin-left:-7px;"></i></span>' +
                '</div>' +
                '</div>';
            // matches the edit pencil beside it: same size, same hover plate
            var removeLineItem = '<a href="javascript:void(0)" class="sale-line-act sale-line-del custom_remove" title="Remove this line" onclick="PosnicPro.sales.removeAddsalesLineRowItems(\'' + id + '\');"><i class="feather icon-trash-2"></i></a>';
        }
        var returnqty = 0;
        var updatePrice = params.selling_price * item_quantity;
        var taxTypeText;

        if (lineItemTaxType === "exclusive") {
            taxTypeText = "Exc";
            var mrpPricew = params.selling_price;
            var mrpPrice = mrpPricew;
        } else {
            taxTypeText = "Inc";
            var mrpPricew = params.selling_price;
            var updateLinePrice = mrpPricew / ((lineItemTax / 100) + 1);
            var mrpPrice = updateLinePrice;
        }

        var PriceDiscount = Discount * item_quantity;
        var updateSalesLineTotal = updatePrice - PriceDiscount;

        //discount calculation
        var discount = 0;
        var returndiscount = 0;
        if (addSalesLineDiscount > 0) {
            if (params.discount_amount > 0 && params.tax > 0) {
                discount = params.discount_amount * item_quantity;
                returndiscount = params.discount_amount * 1;
            } else if (params.discount_percentage > 0 && params.tax > 0) {
                var discountCalculation = (mrpPrice * (addSalesLineDiscount / 100));
                discount = discountCalculation * item_quantity;
                returndiscount = discountCalculation * 1;
            } else {
                var discountCalculation = mrpPrice * item_quantity;
                discount = updateSalesLineTotal - discountCalculation;
                var returndiscountCalculation = mrpPrice * 1;
                returndiscount = updateSalesLineTotal - returndiscountCalculation;
            }
        }


        //tax calculation
        var line_total = 0;
        var taxGst = 0;
        var subTaxGst = 0;
        if (params.discount_amount > 0 && params.tax > 0) {
            var salesLineTotal = Number(updatePrice).toFixed(2);
            var multipleDiscount = params.discount_amount * item_quantity;
            var addSalesTaxValue = salesLineTotal - multipleDiscount;
            if (lineItemTaxType === "exclusive") {
                var tax_value = (addSalesTaxValue / 100) * parseFloat(lineItemTax);
                line_total = addSalesTaxValue + tax_value;
                taxGst = tax_value;
            } else {
                var inclusive_tax = mrpPrice - params.discount_amount;
                var inclusive_tax_value = inclusive_tax * item_quantity;
                var inclusive_tax_total = (inclusive_tax_value / 100) * parseFloat(lineItemTax);
                line_total = inclusive_tax_value + inclusive_tax_total;
                subTaxGst = (inclusive_tax / 100) * parseFloat(params.tax);
                taxGst = subTaxGst * item_quantity;

            }
        } else {
            var salesLineTotal = Number(updateSalesLineTotal).toFixed(2);
            if (lineItemTaxType === "exclusive") {
                var addSalesTaxValue = (lineItemTax > 0) ? (salesLineTotal / 100) * parseFloat(lineItemTax) : '0';
                line_total = (parseFloat(updateSalesLineTotal) + parseFloat(addSalesTaxValue));
                taxGst = addSalesTaxValue;
            } else {
                line_total = parseFloat(salesLineTotal);
                var inclusive_tax_total = (mrpPrice - mrpPrice * (addSalesLineDiscount / 100));
                subTaxGst = (inclusive_tax_total / 100) * parseFloat(params.tax);
                taxGst = (subTaxGst * item_quantity);
            }
        }

        var inlinePrice = '';
        var inlineDiscount = '';
        //var inlineTax = '';
        /* pencils removed - double-click quick edit replaced them */

        // KOT setting
        var kotEnabled = (PosnicPro.local.get('table_options') === 'enable');

        var inlineNote = '';
        if (kotEnabled) {
            inlineNote =
                '<span class="sales-inline-hide p-1">' +
                '<i class="feather icon-edit-1 text-primary item-note-icon" ' +
                'onclick="return PosnicPro.sales.openItemNoteModal(this);" ' +
                'data-id="' + id + '" data-toggle="tooltip" title="Item note" ' +
                'style="cursor:pointer;"></i>' +
                '<a href="#" id="item_note_' + id + '" class="item-note-editable" style="display:none;"></a>' +
                '</span>';
        }

        let item_unit = (typeof (params.unit) != "undefined" && params.unit !== null) ? params.unit : "qty";
        var kotHideStyle = (PosnicPro.sales.saleProcess === 'KOT') ? ' style="display:none;" ' : '';
        var colWidth = (PosnicPro.sales.saleProcess === 'KOT') ? 'width="60%"' : 'width="30%"';
        // whole-line editor door (owner ask): one pencil, every field
        var saleEditIcon = (PosnicPro.local.get('sale_quick_edit') === 'disable') ? '' :
            '<a href="javascript:void(0)" class="sale-line-act sale-line-edit" data-id="' + id + '" title="Edit price, qty, discount, tax"><i class="feather icon-edit-2"></i></a>';
        var rowHTMLLine = '<tr id="touch_row_' + id + '" class="touch-sales-hover-effect border-top pt-3"> ' +
            '    <td id="addSalesLineItemName_' + id + '" class="font_size14" data-id="' + item_name + '" ' + colWidth + '>' + item_name + inlineNote + '</td>' +
            '    <td id="addSalesLineItemQty_' + id + '" class="text-center add_circle font_size14">' + addLineItemQty + '</td>' +
            '    <td name ="addSalesLineItemUnit" id="addSalesLineItemUnit_' + id + '" class="text-center">' + item_unit + '</td>' +
            '    <td name ="addSalesLineItemPrice" id="addSalesLineItemPrice_' + id + '" class="font_size14" ' + kotHideStyle + '>' + mrpPrice.toFixed(2) + inlinePrice + '</td>' +
            '    <td name ="addSalesLineItemDiscount" id="addSalesLineItemDiscountprint_' + id + '" class="text-center font_size14" ' + kotHideStyle + '>' + discount_percentages + inlineDiscount + '</td>' +
            '    <td name="addSalesLineItemTax" id="addSalesLineItemTax_' + id + '" class="text-center font_size14" ' + kotHideStyle + '>' + lineItemTax + '<span>%</span></td>' +
            '    <td name ="addSalesLineTotal" id="addSalesLineTotal_' + id + '" class="font_size14" ' + kotHideStyle + '>' + line_total.toFixed(2) + '</td>' +
            '    <td id="addSalesRemoveLineItem_' + id + '" class="text-center font_size14">' + saleEditIcon + removeLineItem +
            '    </td>' +
            '    <td name="addSalesLineItemId" id="addSalesLineItemId_' + id + '" style="display:none;">' + id + '</td>' +
            '    <td id="addSalesLineItemTaxType_' + id + '" style="display:none;"><span class="badge badge-info-inverse">' + taxTypeText + '</span></td>' +
            '    <td id="addSalesLineItemSellingPrice_' + id + '" style="display:none;">' + params.selling_price + '</td>' +
            '    <td  name ="addSalesLineItemCompanyPrice"  id="addSalesLineItemCompanyPrice_' + id + '" style="display:none;">' + params.company_price + '</td>' +
            '    <td name ="addSalesLineItemBarcodeId" id="addSalesLineItemBarcodeId_' + id + '" style="display:none;">' + params.itemid + '</td>' +
            '    <td name ="addSalesLineItemSupplier" id="addSalesLineItemSupplier_' + id + '" style="display:none;">' + params.supplier + '</td>' +
            '    <td name ="addSalesLineDiscountAmount" id="addSalesLineDiscountAmount_' + id + '" style="display:none;">' + params.discount_amount + '</td>' +
            '    <td name ="addSalesLineDiscountPercentage" id="addSalesLineDiscountPercentage_' + id + '" style="display:none;">' + params.discount_percentage + '</td>' +
            '    <td id="addSalesLineavailableQty_' + id + '" style="display:none;">' + params.available_quantity + '</td>' +
            '    <td id="salesOrderType_' + id + '" style="display:none;">' + ordertype + '</td>' +
            '    <td id="salesType_' + id + '" style="display:none;">' + params.sales_type + '</td>' +
            '    <td id="instantStatus_' + id + '" style="display:none;">' + params.instant_status + '</td>' +
            '    <td id="returndecreSales_' + id + '" style="display:none;">' + returnqty + '</td>' +
            '    <td id="returnSalesIncreaseDecrease_' + id + '" style="display:none;">' + returnqty + '</td>' +
            '    <td id="returnavailable_' + id + '" style="display:none;">' + params.item_available_quantity + '</td>' +
            '    <td id="returnTotal_' + id + '" style="display:none;">0</td>' +
            '    <td id="returnLineTotal_' + id + '" style="display:none;">' + line_total + '</td>' +
            '    <td id="returnTaxLineTotal_' + id + '" style="display:none;">' + return_line_total + '</td>' +
            '    <td name="addSalesLinediscountval" id="addSalesLinediscountval_' + id + '" style="display:none;">' + addSalesLineDiscount + '</td>' +
            '    <td id="returnitemQuantity_' + id + '" style="display:none;">' + item_quantity + '</td>' +
            '    <td id="saleCategoryId_' + id + '" style="display:none;">' + params.category_id + '</td>' +
            '    <td id="saleCategoryName_' + id + '" style="display:none;">' + params.category_name + '</td>' +
            '    <td id="saleSupplierId_' + id + '" style="display:none;">' + params.supplier_id + '</td>' +
            '    <td id="saleSupplierName_' + id + '" style="display:none;">' + params.supplier_name + '</td>' +
            '    <td id="addSalesGstTax_' + id + '" style="display:none;">' + taxGst + '</td>' +
            '    <td id="returnSalesGstTax_' + id + '" style="display:none;">0.00</td>' +
            '    <td name ="addSalesLineItemDiscount" id="addSalesLineItemDiscount_' + id + '" style="display:none;">' + addSalesLineDiscount + '<span id="discountSign' + id + '">' + discountSign + '</span></td>' +
            '    <td id="returnItemChangeQuantityValue_' + id + '" style="display:none;">' + PosnicPro.sales.quantity.formatQty(item_quantity) + '</td>' +
            '    <td id="addSalesLineItemSubTotal_' + id + '" style="display:none;">' + mrpPrice + '</td>' +
            '    <td id="addSalesDiscount_' + id + '" style="display:none;">' + Math.abs(discount) + '</td>' +
            '    <td id="returnSalesDiscount_' + id + '" style="display:none;">' + Math.abs(returndiscount) + '</td>' +
            '    <td id="trackInventory_' + id + '" style="display:none;">' + params.track_inventory + '</td>' +
            '    <td id="negativeStock_' + id + '" style="display:none;">' + params.negative_stock + '</td>' +
            '    <td id="saleInlineItemPrice_' + id + '" style="display:none;">' + params.sale_inline_item_price + '</td>' +
            '    <td id="saleInlineDiscount_' + id + '" style="display:none;">' + params.sale_inline_discount_value + '</td>' +
            '    <td id="saleInlineDiscountPer_' + id + '" style="display:none;">' + params.sale_inline_discount_pervalue + '</td>' +
            '    <td id="addSalesLineItemNote_' + id + '" style="display:none;"></td>' +
            '</tr>';
        PosnicPro.sales.SaleTableLineItems[id] = {
            item_id: id,
            item_quantity: item_quantity,
            addSalesLineDiscount: addSalesLineDiscount,
            addSalesLineItemCompanyPrice_: params.company_price,
            addSalesLineItemPrice: params.selling_price,
            addSalesLineItemUnit: params.unit,
            Discount: Discount,
            available_quantity: params.available_quantity,
            tax: lineItemTax,
            addSalesLineItemDiscountAmount: params.discount_amount,
            addSalesLineItemDiscountPercentage: params.discount_percentage,
            addSalesLineItemAmount: mrpPrice,
            item_description: item_description,
            // Carried so the quantity buttons know this line is a weight
            // rather than a count. Without it they step by one, which for
            // something priced by the kilo is a whole kilo per press.
            item_weight_machine_based: params.item_weight_machine_based
        };

        /*Prepend & Replace With Table Row */
        /*If same product id add In To table replace With Matched Table Row*/
        var itemRecord = [];
        if ($('table#sales_new_items_table').find('#touch_row_' + id).length > 0) {
            $('#touch_row_' + id).replaceWith(rowHTMLLine);
            $('#touch_row_' + id).remove();
            $('#sales_new_items_table tbody').prepend(rowHTMLLine);
            itemRecord.push({ name: item_name, qty: item_quantity, price: mrpPrice, discount: $('#addSalesLineItemDiscountprint_' + id).text(), tax: $('#addSalesLineItemTax_' + id).text(), total: line_total.toFixed(2) });
            db.customerDisplay.put({ id: id, 'clear': 'yes', 'get': 'yes', items: itemRecord });
        } else {
            $('#sales_new_items_table tbody').prepend(rowHTMLLine);
            itemRecord.push({ name: item_name, qty: item_quantity, price: mrpPrice, discount: $('#addSalesLineItemDiscountprint_' + id).text(), tax: $('#addSalesLineItemTax_' + id).text(), total: line_total.toFixed(2) });
            db.customerDisplay.add({ id: id, 'clear': 'yes', 'get': 'yes', items: itemRecord });
        }
        var row = "touch_row_" + id;
        $("#" + row + '').addClass('table-highlight-row');
        setTimeout(function () {
            $("#" + row + '').removeClass('table-highlight-row');
        }, 500);

        $('#sales_new_item_name').val('');
        /*Line Total Calculation using Below Function Call*/
        if (PosnicPro.sales.SaleAction !== 'return') {
            PosnicPro.sales.calculation.salesTableRowCart();
        }
        if (PosnicPro.sales.SaleAction === 'add') {
            PosnicPro.sales.customerViewDisplay();
        }

        // Auto-trigger weight reading for weight-based items
        PosnicPro.sales.checkAutoWeightTrigger(params);
    },
    customerViewDisplay: function () {
        //PosnicPro.customerview.customer_display_update();
    },
    openItemNoteModal: function (index) {
        var id = $(index).data('id');
        var $nameCell = $('#addSalesLineItemName_' + id);
        if ($nameCell.length === 0) {
            return;
        }

        var $noteCell = $('#addSalesLineItemNote_' + id);
        var existingNote = $noteCell.length ? $noteCell.text() : '';
        var defaultDescription = '';
        var itemData = PosnicPro.sales.SaleTableLineItems[id];
        if (itemData && typeof (itemData.item_description) !== 'undefined' && itemData.item_description !== null) {
            defaultDescription = itemData.item_description;
        }

        var textValue = existingNote !== '' ? existingNote : defaultDescription;
        var $editable = $('#item_note_' + id);
        if ($editable.length === 0) {
            return;
        }

        PosnicPro.sales.currentItemNoteId = id;

        // Initialise X-editable textarea once per row
        if (!$editable.data('item-note-editable')) {
            $editable.editable({
                type: 'textarea',
                tpl: '<textarea maxlength="500"></textarea>',
                pk: 1,
                placement: 'left',
                placeholder: 'Item description here...',
                title: 'Enter comments',
                inputclass: 'form-control form-control-sm textarea-height',
                emptytext: '',
                onblur: 'ignore',
                validate: function (value) {
                    if (value.length > 500) {
                        return 'Allowed 500 characters only';
                    }
                },
                success: function (k, val) {
                    var noteText = val || '';

                    // Persist note text into hidden cell and cache object
                    $('#addSalesLineItemNote_' + id).text(noteText);
                    if (PosnicPro.sales.SaleTableLineItems[id]) {
                        PosnicPro.sales.SaleTableLineItems[id].item_description = noteText;
                    }

                    // Hide the inline editable anchor and clear its visible text,
                    // so description does NOT show next to the item name
                    $('#item_note_' + id).text('').hide();

                    // Change the pencil icon color similar to payment note behavior
                    var $icon = $('#addSalesLineItemName_' + id + ' .item-note-icon');
                    if (noteText.length > 0) {
                        $icon.css({ color: '#5fd799' });
                    } else {
                        $icon.css({ color: '#506fe4' });
                    }

                    if (PosnicPro.sales.currentItemNoteId === id) {
                        PosnicPro.sales.currentItemNoteId = null;
                    }
                }
            });
            $editable.data('item-note-editable', true);
        }

        // Set the current value for this open and toggle the popup
        $editable.editable('setValue', textValue, true);
        $editable.text('');
        $editable.show();
        $editable.editable('toggle');

        // If there is no saved note and no cached description, fetch description
        // from Items collection on demand so items like "lime soda" still preload
        if ($.trim(existingNote) === '' && $.trim(defaultDescription) === '') {
            var $itemIdCell = $('#addSalesLineItemId_' + id);
            var itemId = $.trim($itemIdCell.text() || '');
            if (itemId !== '') {
                PosnicPro.get('items/' + itemId, function (response) {
                    if (response && response.type === 'success' && response.data) {
                        var desc = '';
                        if (typeof (response.data.item_description) !== 'undefined' && response.data.item_description !== null) {
                            desc = response.data.item_description;
                        } else if (typeof (response.data.description) !== 'undefined' && response.data.description !== null) {
                            desc = response.data.description;
                        }
                        if (desc !== '') {
                            // Strip HTML to plain text for clean textarea content
                            desc = $('<div>').html(desc).text();

                            // Only auto-fill if user is still on this item and has not typed anything yet
                            if (PosnicPro.sales.currentItemNoteId === id) {
                                var currentHidden = $('#addSalesLineItemNote_' + id).text();
                                if ($.trim(currentHidden) === '') {
                                    $editable.editable('setValue', desc, true);
                                }
                            }

                            // Cache description for future opens
                            if (PosnicPro.sales.SaleTableLineItems[id]) {
                                PosnicPro.sales.SaleTableLineItems[id].item_description = desc;
                            }
                        }
                    }
                }, function () {
                    // Ignore errors; simply leave editor empty
                });
            }
        }
    },

    /*add new trash remove if unwanted addline items in touch sale order*/
    removeAddsalesLineRowItems: function (id) {
        /*
         * No confirmation (owner: "its not destructive. he can add back").
         * Taking a line off an unsaved cart is undone by scanning the item
         * again, and a modal between the cashier and that is pure friction
         * at the counter. Voiding a SAVED sale is the destructive one, and
         * that keeps its manager gate.
         */
        PosnicPro.sales.deleteConfirmation = true;
        if (PosnicPro.sales.deleteConfirmation) {
            if ($('#instantStatus_' + id).text() === 'ok') {
                var params = {
                    url: 'items/deleteInstant',
                    data: JSON.stringify({
                        id: id
                    })
                };
                PosnicPro.delete(params, function () {

                });
            }
            $('#touch_row_' + id).remove();
            db.customerDisplay.where('id').equals(id).delete();
            delete PosnicPro.sales.SaleTableLineItems[id];
            PosnicPro.sales.calculation.salesTableRowCart();
            PosnicPro.sales.customerViewDisplay();
            var lineItemLength = PosnicPro.sales.addLineTable.length;
            if (lineItemLength === 0) {
                $("#save_submit,#check_button").attr("disabled", true);
                PosnicPro.sales.setDefaults();
            }
            PosnicPro.sales.deleteConfirmation = false;
        } else {
            PosnicPro.sales.callbackRegistry = {
                name: 'removeAddsalesLineRowItems',
                arguments: id
            };
            $('#delete_lineitem_modal').modal('show');
            $('#sale_line_item_remove').show();
            $('#receiving_line_item_remove').hide();
        }
    },
    /*delete confirmation*/
    deleteConfirmed: function () {
        $('#delete_lineitem_modal').modal('hide');
        $('#sale_line_item_remove').hide();
        PosnicPro.sales.deleteConfirmation = true;
        window['PosnicPro']['sales']['' + PosnicPro.sales.callbackRegistry.name](PosnicPro.sales.callbackRegistry.arguments);
    },
    customerBalanceCheck: function () {
        if (PosnicPro.sales.addLineTable.length > 0) {
            var total = '';
            if (PosnicPro.sales.SaleAction === 'return') {
                total = $('#refund_grand_total').text().replace(/,/g, '');

            } else {
                total = $('#sales_new_grand_total').text().replace(/,/g, '');
            }
            var amount = $('#sales_new_given_amount').val();
            var balance = PosnicPro.sales.sub(amount, total);
            balance = (balance).toFixed(2);
            $('#sales_new_balance_amount').html(balance);
        } else {
            $('#sales_new_given_amount').val('0.00');
            $('#refund_grand_total,#sales_new_grand_total').text('0.00');
            return false;
        }
        PosnicPro.sales.customerViewDisplay();
    },
    openTenderModel: function () {
        // ✅ Reset submission flag when opening tender modal
        PosnicPro.sales.submissionInProgress = false;
        $("#save_btn").prop('disabled', false);
        $("#save_submit").removeClass('disabled');
        
        const saleNewTot = PosnicPro.sales.extraDiscount.sale_new_tot;
        var current_balance = $('#customer_current_balance').val();
        $('.walletbalance').number(current_balance);
        let checked = $("#sales_new_customer_partial_balance").val();
        // walk-in sales must not be refused: fill from the cached default
        // customer when nothing was chosen (see ensureCustomer)
        if (PosnicPro.sales.ensureCustomer) { PosnicPro.sales.ensureCustomer(); }
        var customer_name = $("#sales_new_customer_name").val();
        // In payment-only tender (opened from Add Payment icon), align Unpaid toggle with
        // the existing sale payment_status so that Paid/Unpaid from history is reflected.
        if (PosnicPro.sales.paymentOnlyMode === true) {
            var status = (PosnicPro.sales.EditRecentSaleParams && PosnicPro.sales.EditRecentSaleParams.payment_status) || 'Paid';
            var saleProcess = (PosnicPro.sales.EditRecentSaleParams && PosnicPro.sales.EditRecentSaleParams.sale_process) || '';
            var normalizedStatus = String(status).toLowerCase();
            // Treat anything that is NOT clearly unpaid/cancelled as Paid
            var isUnpaidLike = (normalizedStatus.indexOf('unpaid') !== -1 || normalizedStatus.indexOf('cancel') !== -1);
            var isPaid = !isUnpaidLike;

            // Requirement 1: For Add-process rows with Unpaid status, when opening
            // Add Payment the payment toggle should default to Paid (ON).
            if (saleProcess === 'Add' && isUnpaidLike) {
                isPaid = true;
            }

            // KOT History settlement still always opens as Paid regardless of
            // previous payment_status.
            if (PosnicPro.kotorder && PosnicPro.kotorder.Settlement === true) {
                isPaid = true;
            }

            $('#unpaid_payment_toggle')
                .prop('disabled', false)
                .prop('checked', isPaid)
                .trigger('change');
        }

        // In payment-only mode from Unpaid list, skip normal validations
        if (!PosnicPro.sales.paymentOnlyMode && ($('#sales_new_items_table tbody tr').find(':nth-child(8)').text() === '' || customer_name === '')) {
            if (customer_name === '') {
                $('.toggle-customer-user').css({ display: 'block' });
                $("#sales_new_customer_name").focus();
                PosnicPro.alert('error', 'Enter a customer name.');
                return false;
            }
            $('#collapseOne').removeClass("show");
            $('#collapseTwo').addClass("show");
            PosnicPro.alert('warning', 'Add at least one item.');
            $('#sales_new_item_name').focus();
            return false;
        }

        if (!PosnicPro.sales.paymentOnlyMode && saleNewTot < 0) {
            PosnicPro.alert('error', 'Enter a payment amount greater than zero.');
            return false;
        }

        // When table order is enabled and NOT in return/payment-only flow,
        // require Discount Note on PAY only if there is any discount
        if (!PosnicPro.sales.paymentOnlyMode &&
            PosnicPro.local.get('table_options') === 'enable' &&
            PosnicPro.sales.SaleAction !== 'return') {

            var totalDiscountTender = parseFloat($('#discount_sale_amount').text().replace(/,/g, ''));
            totalDiscountTender = isNaN(totalDiscountTender) ? 0 : totalDiscountTender;

            var extraDiscountTender = parseFloat($('#extraDisc').text());
            extraDiscountTender = isNaN(extraDiscountTender) ? 0 : extraDiscountTender;

            var hasAnyDiscountTender = (Math.abs(totalDiscountTender) > 0 || Math.abs(extraDiscountTender) > 0);

            // if (hasAnyDiscountTender) {
            //     var discountNoteTender = $.trim($('#discount_description').val() || '');
            //     if (discountNoteTender === '') {
            //         PosnicPro.alert('error', 'Please enter Discount Note before proceeding to payment.');
            //         // Open the Discount Note popup and focus the editor, same as in cartOrderSubmit
            //         $('#discount_description').text('');
            //         $('#discount_description').show().editable('show');
            //         setTimeout(function () {
            //             $('.editable-container:last textarea, .editable-container:last input').focus();
            //         }, 10);
            //         return false;
            //     } 
            // }
        }

        // In payment-only flow (from unpaid payment toggle), label the main action as 'Pay'
        if (PosnicPro.sales.paymentOnlyMode === true) {
            $('.changeSalesBtnText').text('Pay');
        }

        var isKotPaymentOnlyFlow = (PosnicPro.sales.kotPaymentMode === true &&
            PosnicPro.sales.paymentOnlyMode === true);

        if (isKotPaymentOnlyFlow && PosnicPro.sales.EditRecentSaleParams) {
            var tableNo = (PosnicPro.sales.EditRecentSaleParams.table_number || '').toString();
            var pax = PosnicPro.sales.EditRecentSaleParams.person_count;
            var orderType = PosnicPro.sales.EditRecentSaleParams.dine_type || PosnicPro.sales.dineType || '';

            $('#kot_payment_table_no').text(tableNo !== '' ? tableNo : '-');
            $('#kot_payment_pax').text((pax !== undefined && pax !== null && pax !== '') ? pax : '-');
            $('#kot_payment_order_type').text(orderType !== '' ? orderType : '-');
            $('.kot-payment-info').show();

            // In KOT History settlement payment-only flow, hide the editable
            // tender Tables/PAX selector card inside the tender sidebar so
            // the user only sees the read-only KOT Details above.
            $('#infobar-settings-sidebar-tender-details .tender-tables-card').closest('.email-leftbar').hide();
        } else {
            $('.kot-payment-info').hide();
            // For all other payment flows, ensure the tender Tables/PAX card
            // in the tender sidebar is visible as usual.
            $('#infobar-settings-sidebar-tender-details .tender-tables-card').closest('.email-leftbar').hide();
        }

        if (PosnicPro.sales.SaleAction === 'add') {
            $('.payment_mode').val('Cash');
            $('.payment_mode').attr('checked', false);
            $('#tendered_payment_method').text('Cash');
        }
        $(".infobar-settings-sidebar-overlay").css({ "background": "rgba(0,0,0,0.4)", "position": "fixed" });
        $("#infobar-settings-sidebar-tender-details").addClass("sidebarview");
        $('#tenderpage').show();
        if (PosnicPro.sales.SaleAction === 'return') {
            $('.cancel-save-hide-show').hide();
        } else {
            $('.cancel-save-hide-show').show();
        }
        $('#newsalespage').hide();
        $('#tendered_subtotal').text($('#sales_new_subtotal').text());
        $('#tendered_discount').text($('#discount_sale_amount').text());
        $('#tendered_tax').text($('#tax').text());
        $('.tendered_total,#tendered_payment').text(saleNewTot.toFixed(2));
        $('#tendered_amount').val(saleNewTot.toFixed(2));
        $('#tendered_balance').text('0.00');
        $('#render_amount').html('');
        var currency = PosnicPro.local.get('currencySign');
        
        // Reset denomination counts
        PosnicPro.sales.denominationCounts = {};
        
        // Get denominations from database or generate universal default
        let denominations = [];
        if (PosnicPro.sales.SaleDenomination && PosnicPro.sales.SaleDenomination.length > 0) {
            // Use denominations from database (preferred method)
            denominations = PosnicPro.sales.SaleDenomination.map(d => parseFloat(d.amount)).sort((a, b) => a - b);
        } else {
            denominations = PosnicPro.sales.defaultDenominations();
        }
        
        // Build denomination HTML
        let renderAmount = '';
        denominations.forEach((denom) => {
            PosnicPro.sales.denominationCounts[denom] = 0;
            
            renderAmount += 
                '<div class="col-6 col-lg-3 mb-2" style="padding: 3px;">' +
                    '<div class="denom-card-' + denom + '" style="border: 1px solid #ddd; border-radius: 6px; padding: 6px; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.06);">' +
                        '<div id="controls-' + denom + '" style="display: none; align-items: center; gap: 4px; margin-bottom: 4px;">' +
                            '<button onclick="PosnicPro.sales.decreaseDenom(' + denom + '); return false;" style="flex: 1; height: 28px; padding: 0; font-size: 20px; line-height: 28px; font-weight: 600; border-radius: 4px; background: #f8b4b4; color: #fff; border: none; cursor: pointer;">−</button>' +
                            '<button onclick="PosnicPro.sales.increaseDenom(' + denom + '); return false;" style="flex: 1; height: 28px; padding: 0; font-size: 20px; line-height: 28px; font-weight: 600; border-radius: 4px; background: #90ee90; color: #fff; border: none; cursor: pointer;">+</button>' +
                        '</div>' +
                        '<div style="position: relative;">' +
                            '<span id="count-' + denom + '" style="position: absolute; top: -4px; left: -4px; display: none; font-size: 11px; min-width: 20px; padding: 2px 5px; background: #34495e; color: #fff; border-radius: 10px; font-weight: 700; text-align: center; z-index: 10; box-shadow: 0 1px 3px rgba(0,0,0,0.3);">0</span>' +
                            '<button id="denom-btn-' + denom + '" onclick="PosnicPro.sales.increaseDenom(' + denom + '); return false;" style="width: 100%; font-weight: 600; font-size: 13px; padding: 6px 4px; background: #fff; color: #3498db; border: 1.5px solid #3498db; border-radius: 4px; cursor: pointer; transition: all 0.2s;">' + 
                                currency + ' ' + denom.toFixed(2) +
                            '</button>' +
                        '</div>' +
                    '</div>' +
                '</div>';
        });
        
        $('#render_amount').append(renderAmount);
        
        // Load saved denomination data if editing a sale
        PosnicPro.sales.charges = (PosnicPro.sales.EditRecentSaleParams
            && Array.isArray(PosnicPro.sales.EditRecentSaleParams.charges))
            ? PosnicPro.sales.EditRecentSaleParams.charges.slice() : [];
        PosnicPro.sales.renderCharges();
        if (PosnicPro.sales.EditRecentSaleParams && PosnicPro.sales.EditRecentSaleParams.denomination_values) {
            let savedDenominations = PosnicPro.sales.EditRecentSaleParams.denomination_values;
            if (Array.isArray(savedDenominations) && savedDenominations.length > 0) {
                savedDenominations.forEach(function(denomData) {
                    let denom = parseFloat(denomData.cash);
                    let count = parseInt(denomData.value);
                    
                    if (PosnicPro.sales.denominationCounts.hasOwnProperty(denom)) {
                        PosnicPro.sales.denominationCounts[denom] = count;
                        
                        // Update UI
                        let $countBadge = $('#count-' + denom);
                        let $denomBtn = $('#denom-btn-' + denom);
                        let $controls = $('#controls-' + denom);
                        
                        $countBadge.text(count);
                        if (count > 0) {
                            $countBadge.css('display', 'inline-block');
                            $controls.css('display', 'flex');
                            $denomBtn.css({
                                'background': '#3498db',
                                'color': '#fff',
                                'border-color': '#3498db'
                            });
                        }
                    }
                });
                
                // Update tender amount from loaded denominations
                PosnicPro.sales.updateTenderFromDenominations();
                
                // Immediately disable unused denominations in edit mode
                PosnicPro.sales.checkDenominationDisableLogic();
            }
        }

        // if (PosnicPro.sales.tablesList.length > 0) {
        //     // Only control the Tables/PAX card inside the tender sidebar.
        //     // Do not touch the KOT table-selection sidebar, which reuses the
        //     // same .tables-list-hide class.
        //     $('#infobar-settings-sidebar-tender-details .tables-list-hide').show();
        //     $('#tables_list').empty();

        //     let tableHtml = '';
        //     let isTableFound = false;
        //     $.each(PosnicPro.sales.tablesList, function (key, val) {
        //         let btnClass = (PosnicPro.sales.selectedTable && PosnicPro.sales.selectedTable.tableNumber === val.tableNumber) ? 'active btn-primary' : 'btn-outline-secondary';
        //         if (PosnicPro.sales.selectedTable && PosnicPro.sales.selectedTable.tableNumber === val.tableNumber) {
        //             isTableFound = true;
        //         }
        //         tableHtml += '<div class="col-12 col-lg-4 mb-2">' +
        //             '<span>' +
        //             '<button type="button" class="btn btn-block ' + btnClass + ' table_select" data-id="' + val.id + '">' + val.tableNumber +
        //             '</button></span>' +
        //             '</div>';
        //     });

        //     // Add Custom Table Input Field
        //     let customTableValue = (!isTableFound && PosnicPro.sales.selectedTable && PosnicPro.sales.selectedTable.tableNumber) ? PosnicPro.sales.selectedTable.tableNumber : '';
        //     tableHtml += '<div class="col-12 col-lg-4 mb-2">' +
        //         '<span>' +
        //         '<input type="text" class="form-control" id="custom_table_input" placeholder="Enter Table Number" autocomplete="off" value="' + customTableValue + '">' +
        //         '</span>' +
        //         '</div>';

        //     $('#tables_list').html(tableHtml);

        //     $(document).off('click', '.table_select').on('click', '.table_select', function () {
        //         $('.table_select').removeClass('active btn-primary').addClass('btn-outline-secondary');
        //         $(this).removeClass('btn-outline-secondary').addClass('active btn-primary');
        //         $('#custom_table_input').val('');
        //         PosnicPro.sales.selectedTable = {
        //             id: $(this).data('id'),
        //             tableNumber: $(this).text().replace('Table ', '').trim()
        //         };
        //     });

        //     $(document).off('input', '#custom_table_input').on('input', '#custom_table_input', function () {
        //         $('.table_select').removeClass('active btn-primary').addClass('btn-outline-secondary');
        //         PosnicPro.sales.selectedTable = {
        //             id: null,
        //             tableNumber: $(this).val()
        //         };
        //     });

        // } else {
        //     // When there are no configured tables, hide the tender's
        //     // Tables/PAX card but leave the KOT sidebar untouched.
        //     $('#infobar-settings-sidebar-tender-details .tables-list-hide').hide();
        // }

        let personsList = [1, 2, 3, 4, 5];
        let personsHtml = '';
        let isPersonFound = false;
        $.each(personsList, function (key, val) {
            let btnClass = (PosnicPro.sales.selectedPerson == val)
                ? 'active btn-primary'
                : 'btn-outline-secondary';
            if (PosnicPro.sales.selectedPerson == val) {
                isPersonFound = true;
            }

            let iconsHtml = '';
            for (let i = 0; i < val; i++) {
                iconsHtml += '<i class="feather icon-user mr-1"></i>';
            }

            personsHtml += '<div class="col-12 col-lg-4 mb-2">' +
                '<span>' +
                '<button type="button" class="btn btn-block ' + btnClass + ' person_select" data-id="' + val + '">' +
                iconsHtml +
                '</button></span>' +
                '</div>';
        });

        // Add Custom Input Field
        let customPersonValue = (!isPersonFound && PosnicPro.sales.selectedPerson) ? PosnicPro.sales.selectedPerson : '';
        personsHtml += '<div class="col-12 col-lg-4 mb-2">' +
            '<span>' +
            '<input type="number" class="form-control" id="custom_person_input" placeholder="Enter Person Count" autocomplete="off" min="1" value="' + customPersonValue + '">' +
            '</span>' +
            '</div>';

        $('#persons_list').html(personsHtml);
        $(document).off('click', '.person_select').on('click', '.person_select', function () {
            $('.person_select').removeClass('active btn-primary').addClass('btn-outline-secondary');
            $(this).removeClass('btn-outline-secondary').addClass('active btn-primary');
            $('#custom_person_input').val('');
            PosnicPro.sales.selectedPerson = $(this).data('id');
        });

        $(document).off('input', '#custom_person_input').on('input', '#custom_person_input', function () {
            $('.person_select').removeClass('active btn-primary').addClass('btn-outline-secondary');
            PosnicPro.sales.selectedPerson = $(this).val();
        });

        // For all tender flows (Add / Edit / payment-only, including KOT
        // payment), keep the tender's Tables/PAX card hidden, without
        // changing visibility of the KOT order sidebar.
        $('#infobar-settings-sidebar-tender-details .tables-list-hide').hide();

        $('.showhidewalletamount,.showhidDue').hide();
        if (checked === 'true') {
            let wallet_balance = parseFloat($('#customer_current_balance').val());
            $('.showhidewallet,.showhidDue').show();
            $('.partial_amount').removeAttr('disabled');
            if (PosnicPro.sales.SaleAction === 'add' || PosnicPro.sales.EditRecentSaleParams.sale_process === 'Hold') {
                $('#Partial_amount').val(saleNewTot.toFixed(2));
                if (wallet_balance > 0) {
                    $('#wallet_balance').attr('disabled', false);
                } else {
                    $('#wallet_balance').attr('disabled', 'disabled');
                }
            } else {
                $('#Partial_amount').val(PosnicPro.sales.EditRecentSaleParams.partial_amounts.toFixed(2));
                if (PosnicPro.sales.EditRecentSaleParams.wallet_amount > 0) {
                    $('#wallet_balance').prop('checked', false);
                    $('.showhidewallet').hide();
                    $('.showhidewalletamount').show();
                    $('.walleteditamount').html(PosnicPro.sales.EditRecentSaleParams.wallet_amount.toFixed(2));
                    let amount = PosnicPro.sales.EditRecentSaleParams.wallet_amount - PosnicPro.sales.EditRecentSaleParams.partial_amounts;
                    let strAmount = amount.toString();
                    let amounts = strAmount.replace(/([-])+/g, '');
                    $('.payeditamount').number(amounts, 2);
                    $('.payedittext').html(PosnicPro.sales.EditRecentSaleParams.payment_mode);
                } else {
                    $('.showhidewalletamount').hide();
                }
                if (wallet_balance > 0) {
                    $('#wallet_balance').attr('disabled', false);
                } else {
                    $('#wallet_balance').attr('disabled', 'disabled');
                }
            }
        } else {
            $('.showhidewallet').hide();
            $('.partial_amount').attr('disabled', 'disabled');
            $('.partial_amount').val(saleNewTot.toFixed(2));
        }

        // In payment-only flow (Add Payment from Sales History), allow
        // editing Pay amount only when this sale is actually a partial
        // flow (partial customer / partial sale) *and* the status is
        // Unpaid / Partial. For normal customers and fully paid sales,
        // keep Pay amount locked (disabled).
        if (PosnicPro.sales.paymentOnlyMode === true) {
            var partialFlag = (PosnicPro.sales.EditRecentSaleParams && PosnicPro.sales.EditRecentSaleParams.partial_check);
            var domPartialFlag = $('#sales_new_customer_partial_balance').val();
            var customerPartialFlag = (PosnicPro.sales.EditRecentSaleParams && PosnicPro.sales.EditRecentSaleParams.customer_partial);

            var partialFlagStr = (partialFlag !== undefined && partialFlag !== null)
                ? String(partialFlag).toLowerCase()
                : '';
            var domPartialStr = (domPartialFlag !== undefined && domPartialFlag !== null)
                ? String(domPartialFlag).toLowerCase()
                : '';
            var customerPartialStr = (customerPartialFlag !== undefined && customerPartialFlag !== null)
                ? String(customerPartialFlag).toLowerCase()
                : '';

            // Treat any explicit "true"/"partial" indicator as a
            // partial-payment capable flow (either sale-level or
            // customer-level).
            var hasPartialCapability = (
                partialFlagStr === 'true' ||
                domPartialStr === 'true' ||
                domPartialStr === 'partial' ||
                customerPartialStr === 'true'
            );

            // Only allow editing when the existing sale status is either
            // Unpaid or Partial (e.g. "Partialy Paid"). Fully paid sales
            // should not reopen an editable Pay amount field.
            var statusForPartial = (PosnicPro.sales.EditRecentSaleParams && PosnicPro.sales.EditRecentSaleParams.payment_status) || '';
            var normalizedStatusForPartial = String(statusForPartial).toLowerCase();
            var isUnpaidOrPartialStatus = (
                normalizedStatusForPartial.indexOf('unpaid') !== -1 ||
                normalizedStatusForPartial.indexOf('partial') !== -1
            );

            var isPartialFlow = hasPartialCapability && isUnpaidOrPartialStatus;

            if (isPartialFlow) {
                $('.partial_amount').removeAttr('disabled');
                $('.showhidDue').show();
            } else {
                // For normal customers (no partial flag) or fully paid
                // sales, ensure the field stays locked so user cannot
                // type Pay amount.
                $('.partial_amount').attr('disabled', 'disabled');
            }
        }
        let Partial_amount = parseFloat($('#Partial_amount').val());
        Partial_amount = isNaN(Partial_amount) ? 0 : Partial_amount;
        let balanceDue = PosnicPro.sales.sub(saleNewTot, Partial_amount).toFixed(2);
        $('.balanceDue').text(balanceDue);
        const multi_payment = PosnicPro.sales.EditRecentSaleParams.multi_payment || {};
        // For payment-only flow from Unpaid list, keep simple single-payment UI
        // if ((PosnicPro.sales.EditRecentSaleParams && PosnicPro.sales.EditRecentSaleParams.sale_process === 'KOT') ||
        var isKotPaymentOnlyFlow = (PosnicPro.sales.kotPaymentMode === true && PosnicPro.sales.paymentOnlyMode === true);
        var enableMulti = (PosnicPro.local.get('enable_multi_payment') === 'enable' || Object.keys(multi_payment).length !== 0);

        if (enableMulti) {
            PosnicPro.sales.showMultiPaymentMode();
            $('#save_btn').prop('disabled', true);
        } else {
            PosnicPro.sales.showPaymentMode();
            $('#save_btn').prop('disabled', false);
        }
        if (PosnicPro.sales.saleProcess === 'KOT') {
            $('.tables-list-hide-show').hide();
            $('#infobar-settings-sidebar-tender-details').hide();
            $('#unpaid_payment_toggle').prop('checked', false);
            PosnicPro.sales.addSale.cartOrderSubmit(data);
        } else {
            $('.tables-list-hide-show').show();
            $('#infobar-settings-sidebar-tender-details').show();
        }
    },
    showPaymentMode: function () {
        $("#payment_id").html("");
        var sales_payment_mode = PosnicPro.sales.EditRecentSaleParams.payment_mode;
        var active_cash_mode = '';
        var active_qrpay_mode = '';
        if (sales_payment_mode === 'Cash' || sales_payment_mode === undefined) {
            active_cash_mode = 'active';
            $('#Cash').val('Cash');
        } else if (sales_payment_mode === 'Qrpay') {
            active_qrpay_mode = 'active';
        }
        let paymentMethod = '<div class="col-lg-4 col-md-2 col-xs-12">' +
            '<label class="btn btn-block btn-payment-mode Cash_active payment_detail save_enable ' + active_cash_mode + ' ">' +
            '<input type="radio" class="payment_mode" name="payment_mode" id="Cash" value="Cash" checked="checked" style="display: none;"> <lang class="lang_cash_title">Cash</lang>' +
            '</label>' +
            '</div>';
        $('#payment_id').append(paymentMethod);
        if (localStorage.getItem("payment_gateway") === 'true') {
            let paymentMethod = '<div class="col-lg-4 col-md-2 col-xs-12">' +
                '<label class="btn btn-block btn-payment-mode Qrpay_active payment_detail change_active save_enable qr_active qr_btn ' + active_qrpay_mode + ' ">' +
                '<input type="radio" class="payment_mode" name="payment_mode" id="Qrpay" value="Qrpay" style="display: none;"/><lang class="lang_qrcode_title"> Razorpay </lang>' +
                '</label>' +
                '</div>';
            $('#payment_id').append(paymentMethod);
        }
        let SalePaymentType = PosnicPro.configPaymentType;
        if (SalePaymentType.leght !== 0) {
            $.each(SalePaymentType, function (key, val) {
                var payment_mode_active = val.payment_value + '_active';
                if (sales_payment_mode !== val.payment_value) {
                    $('.payment_mode').val(sales_payment_mode);
                    let paymentMethod = '<div class="col-lg-4 col-md-2 col-xs-12">' +
                        '<label class="btn btn-block btn-payment-mode payment_detail change_active save_enable ' + payment_mode_active + ' ">' +
                        '<input type="radio" class="payment_mode" name="payment_mode" id="' + val.payment_value + '" value="' + val.payment_value + '" style="display: none;"/>' + val.payment_value + '' +
                        '</label>' +
                        '</div>';
                    $('#payment_id').append(paymentMethod);
                }
            });
        }
        if (sales_payment_mode !== '' && sales_payment_mode !== null && sales_payment_mode !== undefined && sales_payment_mode !== 'Cash') {
            var edit_payment_mode_active = sales_payment_mode + '_active';
            let paymentMethod = '<div class="col-lg-4 col-md-2 col-xs-12">' +
                '<label class="btn btn-block btn-payment-mode payment_detail change_active save_enable active ' + edit_payment_mode_active + ' ">' +
                '<input type="radio" class="payment_mode" name="payment_mode" id="' + sales_payment_mode + '" value="' + sales_payment_mode + '" style="display: none;"/>' + sales_payment_mode + '' +
                '</label>' +
                '</div>';
            $('#payment_id').append(paymentMethod);
        }

        let addMethod = '<div class="col-lg-4 col-md-2 col-xs-12">' +
            '<button type="button" class="btn btn-payment-mode btn-block change_active" onclick="return PosnicPro.payment.triggerModules();" ><i class="feather icon-plus mr-2"></i>Add</button>' +
            '</div>';
        $('#payment_id').append(addMethod);

    },

    increaseDenom: function (denom) {
        if (!PosnicPro.sales.denominationCounts[denom]) {
            PosnicPro.sales.denominationCounts[denom] = 0;
        }
        PosnicPro.sales.denominationCounts[denom]++;
        
        let $countBadge = $('#count-' + denom);
        let $denomBtn = $('#denom-btn-' + denom);
        let $controls = $('#controls-' + denom);
        
        // Update count text
        $countBadge.text(PosnicPro.sales.denominationCounts[denom]);
        
        // Show badge, controls, and activate button when count > 0
        if (PosnicPro.sales.denominationCounts[denom] > 0) {
            $countBadge.css('display', 'inline-block');
            $controls.css('display', 'flex');
            $denomBtn.css({
                'background': '#3498db',
                'color': '#fff',
                'border-color': '#3498db'
            });
        }
        
        PosnicPro.sales.updateTenderFromDenominations();
        
        // Check disable logic after updating tender amount
        PosnicPro.sales.checkDenominationDisableLogic();
    },

    decreaseDenom: function (denom) {
        if (!PosnicPro.sales.denominationCounts[denom]) {
            PosnicPro.sales.denominationCounts[denom] = 0;
        }
        if (PosnicPro.sales.denominationCounts[denom] > 0) {
            PosnicPro.sales.denominationCounts[denom]--;
            
            let $countBadge = $('#count-' + denom);
            let $denomBtn = $('#denom-btn-' + denom);
            let $controls = $('#controls-' + denom);
            
            // Update count text
            $countBadge.text(PosnicPro.sales.denominationCounts[denom]);
            
            // Hide badge, controls, and deactivate button when count = 0
            if (PosnicPro.sales.denominationCounts[denom] === 0) {
                $countBadge.css('display', 'none');
                $controls.css('display', 'none');
                $denomBtn.css({
                    'background': '#fff',
                    'color': '#3498db',
                    'border-color': '#3498db'
                });
            }
            
            PosnicPro.sales.updateTenderFromDenominations();
            
            // Check disable logic after updating tender amount
            PosnicPro.sales.checkDenominationDisableLogic();
        }
    },

    checkDenominationDisableLogic: function () {
        let billAmount = parseFloat($('#tendered_payment').text().replace(/,/g, '')) || 0;
        let tenderAmount = parseFloat($('#tendered_amount').val()) || 0;
        
        // Find which denomination(s) are active
        let activeDenoms = [];
        for (let denom in PosnicPro.sales.denominationCounts) {
            if (PosnicPro.sales.denominationCounts[denom] > 0) {
                activeDenoms.push(parseFloat(denom));
            }
        }
        
        // Check if we're in edit mode
        let isEditMode = PosnicPro.sales.EditRecentSaleParams && Object.keys(PosnicPro.sales.EditRecentSaleParams).length > 0;
        
        // If tender amount reaches or exceeds bill amount
        if (tenderAmount >= billAmount) {
            // Disable ALL increment (+) buttons, but keep - buttons enabled
            $('[id^="controls-"]').each(function() {
                // Disable + button (index 1)
                $(this).find('button').eq(1).prop('disabled', true).css({
                    'opacity': '0.5',
                    'cursor': 'not-allowed',
                    'pointer-events': 'none'
                });
                // Keep - button (index 0) enabled
                $(this).find('button').eq(0).prop('disabled', false).css({
                    'opacity': '1',
                    'cursor': 'pointer',
                    'pointer-events': 'auto'
                });
            });
            
            // Disable all unused denomination cards
            $('[class^="denom-card-"]').each(function() {
                let className = $(this).attr('class');
                let match = className.match(/denom-card-(\d+\.?\d*)/);
                if (match) {
                    let denom = parseFloat(match[1]);
                    if (activeDenoms.indexOf(denom) === -1) {
                        $(this).css({
                            'opacity': '0.4',
                            'pointer-events': 'none'
                        });
                        // Also disable the main denomination button
                        $('#denom-btn-' + denom).prop('disabled', true).css({
                            'opacity': '0.4',
                            'cursor': 'not-allowed'
                        });
                    }
                }
            });
        } else {
            // If tender < bill, enable all denominations (both new and edit mode)
            PosnicPro.sales.enableAllDenominations();
        }
    },

    disableOtherDenominations: function (activeDenom) {
        // Disable all denomination cards except the active one
        $('[class^="denom-card-"]').each(function() {
            let className = $(this).attr('class');
            let match = className.match(/denom-card-(\d+\.?\d*)/);
            if (match) {
                let denom = parseFloat(match[1]);
                if (denom !== activeDenom) {
                    $(this).css({
                        'opacity': '0.4',
                        'pointer-events': 'none'
                    });
                    // Also disable the increment button
                    $('#controls-' + denom).find('button').eq(1).prop('disabled', true).css({
                        'opacity': '0.4',
                        'cursor': 'not-allowed'
                    });
                }
            }
        });
    },

    enableAllDenominations: function () {
        // Enable all denomination cards
        $('[class^="denom-card-"]').css({
            'opacity': '1',
            'pointer-events': 'auto'
        });
        // Re-enable all main denomination buttons
        $('[id^="denom-btn-"]').prop('disabled', false).css({
            'opacity': '1',
            'cursor': 'pointer'
        });
        // Re-enable all increment buttons
        $('[id^="controls-"]').each(function() {
            $(this).find('button').eq(1).prop('disabled', false).css({
                'opacity': '1',
                'cursor': 'pointer',
                'pointer-events': 'auto'
            });
        });
    },

    updateTenderFromDenominations: function () {
        let total = 0;
        
        // Calculate total from all denominations
        for (let denom in PosnicPro.sales.denominationCounts) {
            let count = PosnicPro.sales.denominationCounts[denom] || 0;
            total += (parseFloat(denom) * count);
        }
        
        // Update tender amount
        $('#tendered_amount').val(total.toFixed(2));
        
        // Calculate return balance
        let billAmount = parseFloat($('#tendered_payment').text().replace(/,/g, '')) || 0;
        let balance = total - billAmount;
        
        if (total < billAmount) {
            $('#tendered_balance').text('0.00');
        } else {
            $('#tendered_balance').text(balance.toFixed(2));
        }
    },

    calculateDenominations: function (amount) {
        if (!amount || amount <= 0 || isNaN(amount)) {
            return;
        }
        
        // Get available denominations (same logic as in openTenderModel)
        let denominations = [];
        if (PosnicPro.sales.SaleDenomination && PosnicPro.sales.SaleDenomination.length > 0) {
            denominations = PosnicPro.sales.SaleDenomination.map(d => parseFloat(d.amount)).sort((a, b) => b - a);
        } else {
            denominations = PosnicPro.sales.defaultDenominations().sort(function (a, b) { return b - a; });
        }
        
        // Reset all denomination counts
        PosnicPro.sales.denominationCounts = {};
        
        let remaining = Math.floor(amount);
        
        // Calculate optimal denomination breakdown (greedy algorithm - largest first)
        denominations.forEach(function(denom) {
            if (remaining >= denom) {
                let count = Math.floor(remaining / denom);
                PosnicPro.sales.denominationCounts[denom] = count;
                remaining = remaining % denom;
            } else {
                PosnicPro.sales.denominationCounts[denom] = 0;
            }
        });
        
        // Update UI for all denominations
        denominations.forEach(function(denom) {
            let count = PosnicPro.sales.denominationCounts[denom] || 0;
            let $countBadge = $('#count-' + denom);
            let $denomBtn = $('#denom-btn-' + denom);
            let $controls = $('#controls-' + denom);
            
            if (count > 0) {
                // Show and update
                $countBadge.text(count).css('display', 'inline-block');
                $controls.css('display', 'flex');
                $denomBtn.css({
                    'background': '#3498db',
                    'color': '#fff',
                    'border-color': '#3498db'
                });
            } else {
                // Hide
                $countBadge.css('display', 'none');
                $controls.css('display', 'none');
                $denomBtn.css({
                    'background': '#fff',
                    'color': '#3498db',
                    'border-color': '#3498db'
                });
            }
        });
    },

    showMultiPaymentMode: function () {
        $("#payment_id").empty();
        let sales_payment_mode = PosnicPro.sales.EditRecentSaleParams.payment_mode;
        // ✅ Use sale_new_tot for new sales, EditRecentSaleParams.sales_total for edits
        let sales_total = PosnicPro.sales.EditRecentSaleParams.sales_total || parseFloat(PosnicPro.sales.extraDiscount.sale_new_tot) || 0;
        let multi_payment = PosnicPro.sales.EditRecentSaleParams.multi_payment || {};

        // If the current calculated total differs from the stored sales_total
        // (e.g. user edited products before opening payment), reset the
        // multipayment map so it matches the new total and avoids stale
        // values from the previous amount.
        const currentTotal = parseFloat(PosnicPro.sales.extraDiscount.sale_new_tot) || 0;
        const storedTotal = parseFloat(PosnicPro.sales.EditRecentSaleParams.sales_total || 0) || 0;
        const totalsDiffer = currentTotal > 0 && Math.abs(currentTotal - storedTotal) > 0.01;

        if (totalsDiffer) {
            sales_total = currentTotal;
            multi_payment = { 'Cash': sales_total };
            PosnicPro.sales.EditRecentSaleParams.multi_payment = multi_payment;
            PosnicPro.sales.EditRecentSaleParams.sales_total = sales_total;
        }

        // ✅ Default: Auto-fill Cash with full amount if no multi_payment exists
        if (Object.keys(multi_payment).length === 0) {
            multi_payment = { 'Cash': sales_total };
        }

        // ✅ Determine which payment method should be active
        // For edit: activate the first payment method that has a value
        // For new: always activate Cash
        let activePaymentMethod = 'Cash'; // Default for new sales
        if (Object.keys(multi_payment).length > 0) {
            // Find first payment method with a value > 0
            for (let key in multi_payment) {
                if (parseFloat(multi_payment[key]) > 0) {
                    activePaymentMethod = key;
                    break;
                }
            }
        }

        let active_cash_mode = '';
        let active_qrpay_mode = '';

        // Normalize helper: remove spaces & lowercase
        function normalizeKey(str) {
            return str.replace(/\s+/g, '').toLowerCase();
        }

        // --- Helper function to create each payment block ---
        function createPaymentBlock(id, title, isActive) {
            let disabledAttr = isActive ? '' : 'disabled';
            let activeClass = isActive ? 'active' : '';
            let inputId = id.toLowerCase().replace(/\s+/g, '') + '_input';

            // ðŸ” Match value by normalized key (handles "Google pay", "googlepay", etc.)
            let storedValue = '';
            for (let key in multi_payment) {
                if (normalizeKey(key) === normalizeKey(title)) {
                    storedValue = multi_payment[key];
                    break;
                }
            }

            // Payment method icons
            let icon = '';
            let currencySymbol = PosnicPro.local.get('currencySign') || '₹';
            if (title === 'Cash') icon = '<span class="mr-2" style="font-weight: bold;">' + currencySymbol + '</span>';
            else if (title === 'Card') icon = '<i class="feather icon-credit-card mr-2"></i>';
            else if (title === 'Razorpay' || title === 'Qrpay') icon = '<i class="feather icon-smartphone mr-2"></i>';
            else if (title.toLowerCase().includes('upi') || title.toLowerCase().includes('google')) icon = '<i class="feather icon-smartphone mr-2"></i>';
            else icon = '<span class="mr-2" style="font-weight: bold;">' + currencySymbol + '</span>';

            return (
                '<div class="col-lg-6 col-md-6 col-sm-12 mb-3">' +
                '<div class="payment-method-card ' + (isActive ? 'payment-active' : '') + '" style="border: 2px solid ' + (isActive ? '#5f63f2' : '#e9ecef') + '; border-radius: 8px; padding: 12px; transition: all 0.3s ease;">' +
                '<button type="button" class="btn btn-payment-method ' + activeClass + '" style="min-width:140px; font-weight: 600; border-radius: 6px; padding: 10px 20px; background: ' + (isActive ? '#5f63f2' : 'transparent') + '; color: ' + (isActive ? '#fff' : '#495057') + '; border: 2px solid ' + (isActive ? '#5f63f2' : '#dee2e6') + ';">' +
                '<input type="radio" class="payment_mode d-none" name="payment_mode" id="' + id + '" value="' + id + '">' +
                icon + title +
                '</button>' +
                '<input type="number" class="form-control payment-amount-input mt-2" id="' + inputId + '" placeholder="₹ 0.00" value="' + (storedValue || '') + '" ' + disabledAttr + ' style="font-size: 18px; font-weight: 600; text-align: right; border: 1px solid #dee2e6; border-radius: 6px; padding: 12px;">' +
                '</div>' +
                '</div>'
            );
        }

        // --- Cash ---
        $('#payment_id').append(createPaymentBlock('Cash', 'Cash', normalizeKey(activePaymentMethod) === normalizeKey('Cash')));
        // --- QR / Razorpay ---
        if (localStorage.getItem("payment_gateway") === 'true') {
            $('#payment_id').append(createPaymentBlock('Qrpay', 'Razorpay', normalizeKey(activePaymentMethod) === normalizeKey('Qrpay') || normalizeKey(activePaymentMethod) === normalizeKey('Razorpay')));
        }

        // --- Other Configured Payment Modes ---
        let SalePaymentType = PosnicPro.configPaymentType;
        if (SalePaymentType && SalePaymentType.length !== 0) {
            $.each(SalePaymentType, function (key, val) {
                $('#payment_id').append(createPaymentBlock(val.payment_value, val.payment_value, normalizeKey(activePaymentMethod) === normalizeKey(val.payment_value)));
            });
        }

        // --- Add Button ---
        let addButton =
            '<div class="col-lg-6 col-md-6 mb-3">' +
            '<button type="button" class="btn btn-outline-secondary w-100 py-2" onclick="return PosnicPro.payment.triggerModules();">' +
            '<i class="feather icon-plus me-2"></i>Add' +
            '</button>' +
            '</div>';
        $('#payment_id').append(addButton);
        // --- Click handler with complete multi-payment logic ---
        $(document).off('click', '.btn-payment-method').on('click', '.btn-payment-method', function () {
            // ✅ Don't process if already active (prevents clearing on initial click)
            if ($(this).hasClass('active')) {
                return;
            }
            
            // Use Pay amount field as the target amount for multipayment
            const payAmount = parseFloat($('#Partial_amount').val()) || 0;
            
            // Calculate total from ALL inputs BEFORE switching
            let allPaymentsTotal = 0;
            let nonZeroPaymentCount = 0;
            $('.payment-amount-input').each(function () {
                let val = parseFloat($(this).val()) || 0;
                if (val > 0) {
                    nonZeroPaymentCount++;
                }
                allPaymentsTotal += val;
            });
            
            // Check if current total equals pay amount AND only one payment has value (full amount scenario)
            let isFullAmountScenario = (Math.abs(allPaymentsTotal - payAmount) < 0.01) && (nonZeroPaymentCount === 1);
            
            // Deactivate all buttons and cards
            $('.btn-payment-method').removeClass('active').css({
                'background': 'transparent',
                'color': '#495057',
                'border': '2px solid #dee2e6'
            });
            $('.payment-method-card').removeClass('payment-active').css('border', '2px solid #e9ecef');
            $('.payment-amount-input').prop('disabled', true);
            
            // Only clear all inputs if it's a full amount scenario (switching from one full payment to another)
            if (isFullAmountScenario) {
                $('.payment-amount-input').each(function() {
                    $(this).data('programmatic-change', true);
                    $(this).val('0.00');
                });
            }
            
            // Activate clicked button and its card
            $(this).addClass('active').css({
                'background': '#5f63f2',
                'color': '#fff',
                'border': '2px solid #5f63f2'
            });
            $(this).closest('.payment-method-card').addClass('payment-active').css('border', '2px solid #5f63f2');
            
            let $input = $(this).closest('.payment-method-card').find('.payment-amount-input');
            $input.prop('disabled', false);
            
            // Calculate remaining balance based on Pay amount
            let currentTotal = 0;
            $('.payment-amount-input').each(function () {
                currentTotal += parseFloat($(this).val()) || 0;
            });
            let remainingBalance = payAmount - currentTotal;
            
            // Fill clicked input based on scenario
            if (isFullAmountScenario) {
                // Full amount scenario: Fill with pay amount
                $input.data('programmatic-change', true);
                $input.val(payAmount.toFixed(2));
            } else {
                // Partial payment scenario: Fill with remaining balance from pay amount
                if (remainingBalance > 0) {
                    $input.data('programmatic-change', true);
                    $input.val(remainingBalance.toFixed(2));
                }
                // If no remaining balance, keep current value (don't change)
            }
            
            $input.focus();
            
            // ✅ Trigger validation
            PosnicPro.sales.initPaymentValidation();
        });

        // --- Input change handler: Trigger validation when multipayment input changes ---
        $(document).off('input', '.payment-amount-input').on('input', '.payment-amount-input', function () {
            // Skip if this is a programmatic change (from clicking payment button)
            if ($(this).data('programmatic-change')) {
                $(this).removeData('programmatic-change');
                return;
            }
            
            // Trigger validation to check if multipayment total matches Pay amount
            PosnicPro.sales.initPaymentValidation();
        });

        // ✅ Trigger initial validation after Cash is auto-filled
        setTimeout(function() {
            PosnicPro.sales.initPaymentValidation();
        }, 100);
    },

    editItemPricingSale: function (index) {
        /*
         * On-demand price power (owner ask - fish priced daily): editing a
         * cart price is the price_override permission. A cashier without it
         * gets the manager PIN prompt, same rail as refunds.
         */
        if (PosnicPro.posCan && !PosnicPro.posCan('price_override')) {
            PosnicPro.requireManagerApproval('price_override',
                { prompt: "Changing a price needs a manager's approval." },
                function () { PosnicPro.sales._editItemPricingSaleNow(index); });
            return;
        }
        PosnicPro.sales._editItemPricingSaleNow(index);
    },
    _editItemPricingSaleNow: function (index) {
        var id = $(index).data('id');
        let priceText = $('#addSalesLineItemPrice_' + id).text().trim();

        // Clean only front zeros (0005.5 -> 5.5)
        let priceValue = priceText.replace(/^0+(?=\d)/, '');
        if (priceValue === '0' || priceValue === '0.00') priceValue = '';

        $('#addSalesLineItemPrice_' + id).editable({
            type: 'text',
            pk: 1,
            title: 'Edit price value',
            inputclass: 'form-control form-control-sm',
            tpl:
                '<input size="4" min="0" max="100000" ' +
                'oninput="this.value=this.value.replace(/^0+(?=\\d)/, \'\')" ' + // âœ… allow removing front 0 manually
                'onkeypress="return PosnicPro.validate(event)">',
            value: priceValue,
            validate: function (value) {
                value = $.trim(value);
                if (value === '') {
                    return 'Enter a valid amount!';
                }
                let regex = /^\d+(\.\d+)?$/;
                if (!regex.test(value)) {
                    return 'Enter a valid amount!';
                }
            },
            success: function (k, val) {
                let newValue = parseFloat(val) || 0;

                // Update all related price fields
                $('#saleInlineItemPrice_' + id).text(newValue.toFixed(2));
                $('#addSalesLineItemPrice_' + id).text(newValue.toFixed(2));
                $('#addSalesLineItemSellingPrice_' + id).text(newValue.toFixed(2));

                let taxType = $('#addSalesLineItemTaxType_' + id).text();
                let TaxValue = parseFloat($('#addSalesLineItemTax_' + id).text()) || 0;
                let mrpPrice;

                if (taxType === "Exc") {
                    mrpPrice = newValue; // Exclusive tax
                } else {
                    let basePrice = newValue / (1 + TaxValue / 100);
                    mrpPrice = basePrice;
                }

                $('#addSalesLineItemSubTotal_' + id).text(mrpPrice.toFixed(2));

                if (PosnicPro.local.get('inline_sale') === 'enable') {
                    $('#addSalesLineItemPrice_' + id).replaceWith(
                        '<td name="addSalesLineItemPrice" id="addSalesLineItemPrice_' + id + '" class="font_size14">' +
                        mrpPrice.toFixed(2) +
                        '&nbsp;&nbsp;<span class="sales-inline-hide">' +
                        '<i class="feather icon-edit-1 text-primary" ' +
                        'onclick="return PosnicPro.sales.editItemPricingSale(this);" ' +
                        'data-id="' + id + '" data-toggle="tooltip" title="Price change" style="cursor:pointer;"></i>' +
                        '</span></td>'
                    );
                }

                PosnicPro.sales.commonInlineCalculation(id, taxType, TaxValue);
            }
        });
    },
    editItemDiscountSale: function (index, discountValue, discountType) {
        var id = $(index).data('id');
        let oldDiscountValue = discountValue || parseFloat(
            $('#addSalesLineItemDiscountprint_' + id)
                .text()
                .replace('%', '')
                .replace(PosnicPro.local.get('currencySign'), '')
                .trim()
        ) || 0;

        let isPercentage = discountType === 'percentage';
        let taxType = $('#addSalesLineItemTaxType_' + id).text();
        let TaxValue = parseFloat($('#addSalesLineItemTax_' + id).text()) || 0;

        // âœ… Clean only front zeros (e.g., 0005 â†’ 5)
        let cleanDiscountValue = String(oldDiscountValue).replace(/^0+(?=\d)/, '');
        if (cleanDiscountValue === '0' || cleanDiscountValue === '0.00') cleanDiscountValue = '';

        $('#addSalesLineItemDiscountprint_' + id).editable({
            type: 'text',
            pk: 1,
            title: 'Edit discount value',
            inputclass: 'form-control form-control-sm',
            tpl:
                '<input size="4" min="0" max="100000" ' +
                // âœ… allow manual removal of front 0
                'oninput="this.value=this.value.replace(/^0+(?=\\d)/, \'\')" ' +
                'onkeypress="return PosnicPro.validate(event)">',
            value: cleanDiscountValue,
            validate: function (value) {
                value = $.trim(value);
                if (value === '') {
                    return 'Enter a valid discount value!';
                }

                if (isPercentage) {
                    let regex = /^\d+$/; // whole numbers only
                    if (!regex.test(value)) {
                        return 'Enter a valid whole number!';
                    }
                    let intValue = parseInt(value, 10);
                    if (intValue < 1 || intValue > 100) {
                        return 'Percentage must be between 1 and 100!';
                    }
                } else {
                    let regex = /^\s*?((\d+(\.\d+)?)|(\.\d+))\s*$/;
                    if (!regex.test(value)) {
                        return 'Enter a valid discount amount!';
                    }
                }
            },
            success: function (key, val) {
                let newDiscountValue = parseFloat(val) || 0;
                let currencySign = PosnicPro.local.get('currencySign');
                let newEditDiscountValue = (isPercentage
                    ? newDiscountValue + '%'
                    : currencySign + newDiscountValue.toFixed(2));

                // Inline edit enabled
                if (PosnicPro.local.get('inline_sale') === 'enable') {
                    $('#addSalesLineItemDiscountprint_' + id).replaceWith(
                        '<td name="addSalesLineItemDiscountprint" id="addSalesLineItemDiscountprint_' + id + '" class="font_size14">' +
                        newEditDiscountValue +
                        '&nbsp;&nbsp;<span class="sales-inline-hide">' +
                        '<i class="feather icon-edit-1 text-primary" ' +
                        'onclick="return PosnicPro.sales.editItemDiscountSale(this, ' + newDiscountValue + ', \'' + (isPercentage ? 'percentage' : 'amount') + '\');" ' +
                        'data-id="' + id + '" data-toggle="tooltip" title="Discount change" style="cursor:pointer;"></i>' +
                        '</span></td>'
                    );

                    $('#addSalesLineItemDiscount_' + id).replaceWith(
                        '<td name="addSalesLineItemDiscount" id="addSalesLineItemDiscount_' + id + '" style="display:none;">' +
                        (isPercentage ? newDiscountValue : newDiscountValue.toFixed(2)) +
                        '<span id="discountSign' + id + '">' +
                        (isPercentage ? '%' : currencySign) +
                        '</span></td>'
                    );

                    // Update inline display
                    if (isPercentage) {
                        $('#saleInlineDiscountPer_' + id).text(newDiscountValue.toFixed(2));
                    } else {
                        $('#saleInlineDiscount_' + id).text(newDiscountValue);
                    }
                }

                // Recalculate totals
                PosnicPro.sales.commonInlineCalculation(id, taxType, TaxValue);
            }
        });
    },
    commonInlineCalculation: function (id, taxType, TaxValue) {
        var ItemQty = $('#touchsale_item_qty' + id).val();
        var updatePrice = parseFloat($('#addSalesLineItemSellingPrice_' + id).text()) * ItemQty;
        var PriceDiscount = parseFloat($('#addSalesLineItemDiscount_' + id).text()) * ItemQty;
        var tax = parseFloat($('#addSalesLineItemTax_' + id).text()) * ItemQty;
        var updateSalesLineTotal;
        var taxGst;
        if (PriceDiscount > 0 && tax > 0 && $('#discountSign' + id).text() !== '%') {
            var addSalesTaxValue = updatePrice - PriceDiscount;
            if (taxType === 'Exc') {
                var tax_value = (addSalesTaxValue / 100) * parseFloat(TaxValue);
                updateSalesLineTotal = addSalesTaxValue + tax_value;
                taxGst = tax_value;
            } else {
                var inclusive_price = parseFloat($('#addSalesLineItemPrice_' + id).text());
                var inclusive_tax_calculate = inclusive_price * ItemQty;
                var inclusive_tax_value = inclusive_tax_calculate - PriceDiscount;
                var inclusive_tax_total = (inclusive_tax_value / 100) * parseFloat(TaxValue);
                updateSalesLineTotal = inclusive_tax_value + inclusive_tax_total;
                taxGst = inclusive_tax_total;

            }

        } else if (PriceDiscount > 0 && tax > 0 || PriceDiscount > 0 && tax === 0 && $('#discountSign' + id).text() === '%') {
            if (taxType === 'Exc') {
                var discountValue = parseFloat($('#addSalesLineItemDiscount_' + id).text());
                var discountPercentageCalculation = updatePrice - (updatePrice * (discountValue / 100));
                updateSalesLineTotal = discountPercentageCalculation + (discountPercentageCalculation / 100) * TaxValue;
                taxGst = (discountPercentageCalculation / 100) * TaxValue;
                PriceDiscount = updatePrice * (discountValue / 100);
            } else {
                var discountValue = parseFloat($('#addSalesLineItemDiscount_' + id).text());
                updateSalesLineTotal = updatePrice - (updatePrice * (discountValue / 100));

                var inclusive_price = parseFloat($('#addSalesLineItemPrice_' + id).text()) * ItemQty;
                var itemDiscountPercentageCalculation = inclusive_price - (inclusive_price * (discountValue / 100));
                taxGst = (itemDiscountPercentageCalculation / 100) * TaxValue;
                PriceDiscount = inclusive_price * (discountValue / 100);

            }
        } else {
            if (taxType === 'Exc') {
                var tax_value = (TaxValue / 100) * parseFloat(updatePrice);
                updateSalesLineTotal = updatePrice - PriceDiscount + tax_value;
                taxGst = tax_value;
            } else {
                updateSalesLineTotal = updatePrice - PriceDiscount;
                var inclusive_price = parseFloat($('#addSalesLineItemPrice_' + id).text()) * ItemQty;
                taxGst = (inclusive_price / 100) * TaxValue;
            }

        }
        updateSalesLineTotal = Number(updateSalesLineTotal).toFixed(2);
        $('#addSalesLineTotal_' + id).text(updateSalesLineTotal);
        $('#addSalesGstTax_' + id).text(taxGst.toFixed(2));
        $('#addSalesDiscount_' + id).text(PriceDiscount.toFixed(2));
        var itemRecord = [];
        itemRecord.push({ name: $('#addSalesLineItemName_' + id).text(), qty: ItemQty, price: $('#addSalesLineItemPrice_' + id).text(), discount: $('#addSalesLineItemDiscount_' + id).text(), tax: $('#addSalesLineItemTax_' + id).text(), total: updateSalesLineTotal });
        db.customerDisplay.put({ id: id, clear: 'yes', get: 'yes', items: itemRecord });
        PosnicPro.sales.calculation.salesTableRowCart();
        PosnicPro.sales.customerBalanceCheck();
        PosnicPro.sales.customerViewDisplay();
    },

    getPaymentObject: function () {
        let paymentObj = {};

        // Check for multi-payment UI (.payment-amount-input) or single-payment UI (.payment_input)
        let $paymentInputs = $('.payment-amount-input').length > 0 ? $('.payment-amount-input') : $('.payment_input');
        
        $paymentInputs.each(function () {
            let amount = $(this).val().trim();
            if (amount !== '' && !isNaN(amount) && parseFloat(amount) > 0) {
                let mode = $(this).attr('id').replace('_input', '');
                mode = mode.charAt(0).toUpperCase() + mode.slice(1);
                paymentObj[mode] = parseFloat(amount);
            }
        });

        return paymentObj;
    },

    initPaymentValidation: function () {
        const totalAmount = parseFloat(PosnicPro.sales.extraDiscount.sale_new_tot) || 0;
        const payAmount = parseFloat($('#Partial_amount').val()) || totalAmount;
        const isPaid = $('#unpaid_payment_toggle').is(':checked');
        var sum = 0;

        // Calculate sum from multipayment inputs
        $('.payment-amount-input').each(function () {
            let val = parseFloat($(this).val()) || 0;
            sum += val;
        });

        // Round to 2 decimal places to avoid floating point issues
        sum = parseFloat(sum.toFixed(2));
        const payAmountRounded = parseFloat(payAmount.toFixed(2));

        // Always validate multipayment total against Pay amount
        // Check if multipayment total exceeds Pay amount (with 0.01 tolerance)
        if (sum > payAmountRounded + 0.01) {
            PosnicPro.alert('error', 'Total payment (₹' + sum.toFixed(2) + ') cannot exceed Pay amount (₹' + payAmountRounded.toFixed(2) + ')');
            $('#save_btn').prop('disabled', true);
            return;
        }

        // If multipayment total < Pay amount (with 0.01 tolerance), disable save only if Paid toggle is ON
        if (isPaid && sum < payAmountRounded - 0.01) {
            let remaining = (payAmountRounded - sum).toFixed(2);
            $('#return_balance_amount').text(remaining);
            $('#save_btn').prop('disabled', true);
            return;
        }

        // If multipayment total matches Pay amount (within 0.01 tolerance)
        if (Math.abs(sum - payAmountRounded) <= 0.01) {
            $('#return_balance_amount').text('0.00');
            
            // If Pay amount < Total, auto-set customer to Partial
            if (payAmountRounded < totalAmount - 0.01) {
                $('#sales_new_customer_partial_balance').val('true');
            } else {
                // Full payment, set to Paid
                $('#sales_new_customer_partial_balance').val('false');
            }
            
            // Update payment status label
            if (typeof updatePaymentStatusLabel === 'function') {
                updatePaymentStatusLabel();
            }
            
            $('#save_btn').prop('disabled', false);
        } else if (!isPaid) {
            // Unpaid mode - enable save even if amounts don't match
            $('#save_btn').prop('disabled', false);
        }
    },


};

PosnicPro.kotorder = {
    personsList: [],
    selectedPerson: null,
    kotPersonCount: null,
    kotTableNumber: null,
    kotOrderType: null,
    Settlement: null,
    occupiedTables: [],

    cancelKotSales: function () {
        window.history.back();
    },

    showAdd: function () {
        $("#infobar-settings-sidebar-table-selection").addClass("sidebarview");
        $(".infobar-settings-sidebar-overlay").css({ "background": "rgba(0,0,0,.6)", "position": "fixed" });

        // Preserve selectedTable if already set from KOT page
        var preservedTable = PosnicPro.sales.selectedTable;

        // Reset KOT-specific state so a new order never reuses previous
        // table / pax selections.
        PosnicPro.kotorder.selectedPerson = null;
        PosnicPro.kotorder.kotPersonCount = null;
        PosnicPro.kotorder.kotTableNumber = null;
        PosnicPro.kotorder.kotOrderType = null;
        PosnicPro.kotorder.editSaleId = null;

        // Check if table was pre-selected from KOT page
        if (PosnicPro.kotorder.preSelectedTable) {
            PosnicPro.kotorder.kotTableNumber = PosnicPro.kotorder.preSelectedTable;

            // Also set selectedTable from preSelected values
            if (PosnicPro.kotorder.preSelectedTableId) {
                PosnicPro.sales.selectedTable = {
                    id: PosnicPro.kotorder.preSelectedTableId,
                    tableNumber: PosnicPro.kotorder.preSelectedTable
                };
            }

            PosnicPro.kotorder.preSelectedTable = null;
            PosnicPro.kotorder.preSelectedTableId = null;
        }

        // Restore preserved table or use kotTableNumber
        if (!PosnicPro.sales.selectedTable && preservedTable) {
            PosnicPro.sales.selectedTable = preservedTable;
            if (!PosnicPro.kotorder.kotTableNumber) {
                PosnicPro.kotorder.kotTableNumber = preservedTable.tableNumber;
            }
        }

        // Check if dine type was pre-selected (for takeaway)
        if (PosnicPro.kotorder.preSelectedDineType) {
            PosnicPro.kotorder.kotOrderType = PosnicPro.kotorder.preSelectedDineType;
            PosnicPro.kotorder.preSelectedDineType = null;
        }

        // Check if PAX was pre-selected (for takeaway)
        if (PosnicPro.kotorder.preSelectedPax) {
            PosnicPro.kotorder.kotPersonCount = PosnicPro.kotorder.preSelectedPax;
            PosnicPro.kotorder.selectedPerson = PosnicPro.kotorder.preSelectedPax;
            PosnicPro.kotorder.preSelectedPax = null;
        }

        // Ensure we always have a default order type for a NEW KOT selection.
        // If nothing was pre-selected, default to "Dine-in".
        if (!PosnicPro.kotorder.kotOrderType) {
            PosnicPro.kotorder.kotOrderType = 'Dine-in';
        }

        // Sync the UI toggle with the current kotOrderType value so that the
        // correct button appears active when the sidebar opens. Use a filled
        // btn-info style for the active option and outline style for inactive
        // so the selection is visually clear.
        if (PosnicPro.kotorder.kotOrderType === 'Take away') {
            $('#kot_dine_type_takeaway').prop('checked', true);
            $('#kot_takeaway_label')
                .addClass('active btn-info')
                .removeClass('btn-outline-info');
            $('#kot_dinein_label')
                .removeClass('active btn-info')
                .addClass('btn-outline-info');
        } else {
            $('#kot_dine_type_dinein').prop('checked', true);
            $('#kot_dinein_label')
                .addClass('active btn-info')
                .removeClass('btn-outline-info');
            $('#kot_takeaway_label')
                .removeClass('active btn-info')
                .addClass('btn-outline-info');
        }

        PosnicPro.kotorder.personsList = [1, 2, 3, 4, 5, 6, 8, 10];
        PosnicPro.kotorder.loadTablesList();
        PosnicPro.kotorder.renderPersons();
        PosnicPro.kotorder.initEvents();
    },

    showEdit: function (id) {
        $("#infobar-settings-sidebar-table-selection").addClass("sidebarview");
        $(".infobar-settings-sidebar-overlay").css({ "background": "rgba(0,0,0,.6)", "position": "fixed" });

        // Clear any previous KOT state so we start from a clean selection.
        PosnicPro.kotorder.selectedPerson = null;
        PosnicPro.kotorder.kotPersonCount = null;
        PosnicPro.kotorder.kotTableNumber = null;
        PosnicPro.kotorder.kotOrderType = null;
        PosnicPro.sales.selectedTable = null;

        PosnicPro.kotorder.personsList = [1, 2, 3, 4, 5];
        PosnicPro.kotorder.editSaleId = id;

        // Load existing KOT sale details so we can pre-fill table, pax and
        // order type on the KOT selection screen.
        PosnicPro.get('sales/' + id, function (response) {
            if (response.type === 'success') {
                var data = response.data || {};

                var tableNumber = (typeof data.table_number !== 'undefined' && data.table_number !== null)
                    ? String(data.table_number)
                    : '';
                var personCount = (typeof data.person_count !== 'undefined' && data.person_count !== null)
                    ? parseInt(data.person_count, 10)
                    : null;
                var dineType = data.dine_type || 'Dine-in';

                if (dineType) {
                    dineType = String(dineType).trim();
                    if (/^dine[\s-]?in$/i.test(dineType)) {
                        dineType = 'Dine-in';
                    } else if (/^take[\s-]?away$/i.test(dineType)) {
                        dineType = 'Take away';
                    }
                } else {
                    dineType = 'Dine-in';
                }

                PosnicPro.kotorder.kotTableNumber = tableNumber;
                PosnicPro.kotorder.kotPersonCount = personCount;
                PosnicPro.kotorder.kotOrderType = dineType;

                // Preselect dine type toggle in KOT sidebar and make the
                // active option visually prominent using btn-info.
                if (dineType === 'Take away') {
                    $('#kot_dine_type_takeaway').prop('checked', true);
                    $('#kot_takeaway_label')
                        .addClass('active btn-info')
                        .removeClass('btn-outline-info');
                    $('#kot_dinein_label')
                        .removeClass('active btn-info')
                        .addClass('btn-outline-info');
                } else {
                    $('#kot_dine_type_dinein').prop('checked', true);
                    $('#kot_dinein_label')
                        .addClass('active btn-info')
                        .removeClass('btn-outline-info');
                    $('#kot_takeaway_label')
                        .removeClass('active btn-info')
                        .addClass('btn-outline-info');
                }

                // For small person counts, prefer button selection; larger
                // values will be shown via the custom input field.
                PosnicPro.kotorder.selectedPerson = null;
                if (personCount && PosnicPro.kotorder.personsList.indexOf(personCount) !== -1) {
                    PosnicPro.kotorder.selectedPerson = personCount;
                }

                // Once header values are ready, load tables & persons so that
                // renderTables / renderPersons can highlight the correct
                // choices.
                PosnicPro.kotorder.loadTablesList();
                PosnicPro.kotorder.renderPersons();
            } else {
                PosnicPro.alert(response.type, response.message);
                // Fallback to plain new KOT selection when details cannot be
                // loaded.
                PosnicPro.kotorder.loadTablesList();
                PosnicPro.kotorder.renderPersons();
            }
        });

        // Ensure KOT edit screens reuse the same table / pax interaction
        // handlers as the new KOT flow so that selecting values updates the
        // shared KOT state and the Next button validation behaves
        // consistently.
        if (typeof PosnicPro.kotorder.initEvents === 'function') {
            PosnicPro.kotorder.initEvents();
        }
    },

    loadTablesList: function () {

        var loader = $(".loader-kot-order-tables-list");
        $("<div class='loadingSpinner'></div>").appendTo(loader);

        var params = {
            url: 'setting/getTableOrderAll'
        };

        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                var data = response.data || [];
                PosnicPro.sales.tablesList = [];
                $.each(data, function (key, val) {
                    PosnicPro.sales.tablesList.push({
                        id: val.tableorder_id,
                        tableNumber: val.tableorder_value
                    });
                });
                
                // ✅ NEW: Fetch active orders to disable occupied tables
                PosnicPro.kotorder.fetchActiveOrdersAndRender(loader);
            }
        });
    },

    fetchActiveOrdersAndRender: function(loader) {
        var params = {
            url: 'sales/getTablesWithActiveOrders',
            data: {
                branch_id: localStorage.getItem('branch_id') || null
            }
        };

        PosnicPro.post(params, function (response) {
            var occupiedTables = [];
            if (response.type === 'success' && response.data && response.data.tables) {
                occupiedTables = response.data.tables;
            }
            
            // Store occupied tables for use in renderTables
            PosnicPro.kotorder.occupiedTables = occupiedTables;
            PosnicPro.kotorder.renderTables();
            loader.find(".loadingSpinner:first").remove();
        }, function(error) {
            // On error, render tables without disable logic
            console.error('Failed to fetch active orders:', error);
            PosnicPro.kotorder.occupiedTables = [];
            PosnicPro.kotorder.renderTables();
            loader.find(".loadingSpinner:first").remove();
        });
    },

    renderTables: function () {
        // Build HTML with table-like design
        var tablesHtml = '';

        var targetTableNumber = (PosnicPro.kotorder && PosnicPro.kotorder.kotTableNumber)
            ? $.trim(String(PosnicPro.kotorder.kotTableNumber))
            : '';
        var activeTableId = (PosnicPro.sales.selectedTable && PosnicPro.sales.selectedTable.id)
            ? PosnicPro.sales.selectedTable.id
            : null;
        var matchedByTableNumber = false;
        
        // ✅ NEW: Get occupied tables list
        var occupiedTables = PosnicPro.kotorder.occupiedTables || [];

        $.each(PosnicPro.sales.tablesList, function (key, val) {
            var isActive = false;

            if (activeTableId && val.id == activeTableId) {
                isActive = true;
            } else if (!activeTableId && targetTableNumber &&
                $.trim(String(val.tableNumber)) === targetTableNumber) {
                isActive = true;
                matchedByTableNumber = true;
                activeTableId = val.id;
            }

            // ✅ NEW: Check if table is occupied
            var isOccupied = occupiedTables.indexOf(String(val.tableNumber)) !== -1;
            
            var btnClass = isActive ? 'active' : '';
            if (isOccupied) {
                btnClass += ' table-occupied';
            }
            
            var borderColor = isOccupied ? '#d0d0d0' : (isActive ? '#5969ff' : '#dee2e6');
            var bgColor = isOccupied ? '#e5e5e5' : (isActive ? '#f0f2ff' : '#ffffff');
            var textColor = isOccupied ? '#999' : (isActive ? '#5969ff' : '#495057');
            var cursor = isOccupied ? 'not-allowed' : 'pointer';
            var opacity = isOccupied ? '0.6' : '1';
            var disabledAttr = isOccupied ? 'disabled' : '';

            tablesHtml +=
                '<div class="col-6 col-lg-4 mb-3">' +
                '<button type="button" class="table_select ' + btnClass + '" data-id="' + val.id + '" ' +
                disabledAttr + ' ' +
                'style="width: 100%; height: 80px; border: 3px solid ' + borderColor + '; border-radius: 12px; ' +
                'background: ' + bgColor + '; position: relative; cursor: ' + cursor + '; transition: all 0.3s; opacity: ' + opacity + ';">' +
                '<div class="table-inner" style="position: absolute; top: 8px; left: 12px; right: 12px; bottom: 8px; ' +
                'border: 2px dashed ' + borderColor + '; border-radius: 8px; display: flex; align-items: center; justify-content: center;">' +
                '<strong style="font-size: 24px; color: ' + textColor + '; font-weight: 700;">' + val.tableNumber + '</strong>' +
                '</div>' +
                '</button>' +
                '</div>';
        });

        if (matchedByTableNumber && activeTableId) {
            PosnicPro.sales.selectedTable = {
                id: activeTableId,
                tableNumber: targetTableNumber
            };
        }

        // Custom Input Field with icon
        tablesHtml +=
            '<div class="col-6 col-lg-4 mb-3">' +
            '<div style="position: relative;">' +
            '<i class="feather icon-edit-2" style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: #6c757d; z-index: 1;"></i>' +
            '<input type="text" class="form-control" id="custom_table_input" placeholder="Custom Table" autocomplete="off" ' +
            'style="height: 80px; padding-left: 40px; border: 2px dashed #dee2e6; border-radius: 12px; font-size: 14px;">' +
            '</div>' +
            '</div>';

        $('#kot_order_tables_list').html(tablesHtml);

        // When editing an existing KOT and the table number does not correspond
        // to any configured table, show it as a custom value.
        if (targetTableNumber) {
            var hasMatchingButton = false;
            $('#kot_order_tables_list .table_select').each(function () {
                var tableText = $(this).find('strong').text().trim();
                if (tableText === targetTableNumber) {
                    hasMatchingButton = true;
                    return false;
                }
            });

            if (!hasMatchingButton) {
                $('#custom_table_input').val(targetTableNumber);
            }
        }
    },

    renderPersons: function () {
        let personsHtml = '';
        let targetPersonCount = (typeof PosnicPro.kotorder.kotPersonCount === 'number' && PosnicPro.kotorder.kotPersonCount > 0)
            ? PosnicPro.kotorder.kotPersonCount
            : null;

        // If no explicit selectedPerson but we have a KOT person count within
        // the predefined list, use it as the selected button.
        if (!PosnicPro.kotorder.selectedPerson &&
            targetPersonCount &&
            PosnicPro.kotorder.personsList.indexOf(targetPersonCount) !== -1) {
            PosnicPro.kotorder.selectedPerson = targetPersonCount;
        }

        $.each(PosnicPro.kotorder.personsList, function (key, val) {
            let isActive = (PosnicPro.kotorder.selectedPerson == val);
            let borderColor = isActive ? '#28a745' : '#dee2e6';
            let bgColor = isActive ? '#f0fff4' : '#ffffff';
            let textColor = isActive ? '#28a745' : '#6c757d';

            let iconsHtml = '';
            let displayCount = Math.min(val, 6);
            for (let i = 0; i < displayCount; i++) {
                iconsHtml += '<i class="feather icon-user" style="font-size: 18px; margin: 2px;"></i>';
            }
            if (val > 6) {
                iconsHtml += '<span style="font-size: 14px; margin-left: 4px;">+' + (val - 6) + '</span>';
            }

            personsHtml += '<div class="col-6 col-lg-4 mb-3">' +
                '<button type="button" class="person_select" data-id="' + val + '" ' +
                'style="width: 100%; height: 70px; border: 2px solid ' + borderColor + '; border-radius: 10px; ' +
                'background: ' + bgColor + '; cursor: pointer; transition: all 0.3s; display: flex; flex-direction: column; ' +
                'align-items: center; justify-content: center; padding: 8px;">' +
                '<div style="color: ' + textColor + ';">' + iconsHtml + '</div>' +
                '<strong style="font-size: 16px; color: ' + textColor + '; margin-top: 4px;">' + val + ' PAX</strong>' +
                '</button>' +
                '</div>';
        });

        personsHtml += '<div class="col-6 col-lg-4 mb-3">' +
            '<div style="position: relative;">' +
            '<i class="feather icon-users" style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: #6c757d; z-index: 1; font-size: 20px;"></i>' +
            '<input type="number" class="form-control" id="kot_custom_person_input" placeholder="Custom" autocomplete="off" min="1" max="100" ' +
            'value="' + (PosnicPro.kotorder.selectedPerson || '') + '" ' +
            'style="height: 70px; padding-left: 45px; border: 2px dashed #dee2e6; border-radius: 10px; font-size: 16px; font-weight: 600; text-align: center;">' +
            '</div>' +
            '</div>';

        $('#kot_order_persons_list').html(personsHtml);

        // If the stored KOT person count is not in the predefined list, show
        // it as a custom value instead of a selected button.
        if (targetPersonCount &&
            PosnicPro.kotorder.personsList.indexOf(targetPersonCount) === -1) {
            $('#kot_custom_person_input').val(targetPersonCount);
        }
    },

    initEvents: function () {
        // Table Select
        $(document).off('click', '#kot_order_tables_list .table_select').on('click', '#kot_order_tables_list .table_select', function () {
            // ✅ NEW: Prevent clicking on disabled/occupied tables
            if ($(this).hasClass('table-occupied') || $(this).prop('disabled')) {
                return false;
            }
            
            var id = $(this).data('id');
            var val = $(this).find('strong').text().trim();

            PosnicPro.sales.selectedTable = { id: id, tableNumber: val };
            PosnicPro.kotorder.kotTableNumber = val;

            // UI Update - update styles for all tables (except occupied ones)
            $('#kot_order_tables_list .table_select').each(function () {
                if (!$(this).hasClass('table-occupied')) {
                    $(this).css({
                        'border-color': '#dee2e6',
                        'background': '#ffffff'
                    });
                    $(this).find('strong').css('color', '#495057');
                    $(this).find('.table-inner').css('border-color', '#dee2e6');
                }
            });

            // Highlight selected table
            $(this).css({
                'border-color': '#5969ff',
                'background': '#f0f2ff'
            });
            $(this).find('strong').css('color', '#5969ff');
            $(this).find('.table-inner').css('border-color', '#5969ff');

            $('#custom_table_input').val('');
        });

        // Custom Table Input
        $(document).off('keyup input', '#custom_table_input').on('keyup input', '#custom_table_input', function () {
            var val = $(this).val();
            PosnicPro.sales.selectedTable = null;
            PosnicPro.kotorder.kotTableNumber = val;
            $('#kot_order_tables_list .table_select').each(function () {
                $(this).css({
                    'border-color': '#dee2e6',
                    'background': '#ffffff'
                });
                $(this).find('strong').css('color', '#495057');
                $(this).find('.table-inner').css('border-color', '#dee2e6');
            });

            $('#kot_order_tables_list .table_select')
                .removeClass('active btn-primary')
                .addClass('btn-outline-secondary');
        });

        // Person Select
        $(document).off('click', '#kot_order_persons_list .person_select').on('click', '#kot_order_persons_list .person_select', function () {
            var count = $(this).data('id');

            PosnicPro.kotorder.selectedPerson = count;
            PosnicPro.kotorder.kotPersonCount = count;

            // Reset all PAX buttons to default state
            $('#kot_order_persons_list .person_select').each(function () {
                $(this).css({
                    'border-color': '#dee2e6',
                    'background': '#ffffff'
                });
                $(this).find('div').first().css('color', '#6c757d');
                $(this).find('strong').css('color', '#6c757d');
            });

            // Highlight current selection in green (same as initial render)
            $(this).css({
                'border-color': '#28a745',
                'background': '#f0fff4'
            });
            $(this).find('div').first().css('color', '#28a745');
            $(this).find('strong').css('color', '#28a745');

            $('#kot_custom_person_input').val(count);
        });

        // Custom Person Input
        $(document).off('input', '#kot_custom_person_input').on('input', '#kot_custom_person_input', function () {
            var val = parseInt($(this).val(), 10);

            if (isNaN(val) || val <= 0) {
                PosnicPro.kotorder.kotPersonCount = null;
                PosnicPro.kotorder.selectedPerson = null;
            } else {
                PosnicPro.kotorder.kotPersonCount = val;
                // When using the custom input we treat the value as an
                // adâ€'hoc count rather than a predefined button.
                PosnicPro.kotorder.selectedPerson = null;
            }

            // Clear highlight from all predefined PAX buttons when using custom input
            $('#kot_order_persons_list .person_select').each(function () {
                $(this).css({
                    'border-color': '#dee2e6',
                    'background': '#ffffff'
                });
                $(this).find('div').first().css('color', '#6c757d');
                $(this).find('strong').css('color', '#6c757d');
            });
        });

        // Dine Type Radio Buttons
        $(document).off('change', 'input[name="kot_dine_type"]').on('change', 'input[name="kot_dine_type"]', function () {
            var previousType = PosnicPro.kotorder.kotOrderType || null;
            var dineType = $(this).val();
            PosnicPro.kotorder.kotOrderType = dineType;

            // Update label styles: active option gets solid btn-info, inactive
            // stays as btn-outline-info so the selection is clearly visible.
            if (dineType === 'Take away') {
                $('#kot_takeaway_label')
                    .addClass('active btn-info')
                    .removeClass('btn-outline-info');
                $('#kot_dinein_label')
                    .removeClass('active btn-info')
                    .addClass('btn-outline-info');

                PosnicPro.kotorder.kotPersonCount = 0;
                PosnicPro.kotorder.selectedPerson = null;
                $('#kot_custom_person_input').val('');
                $('#kot_order_persons_list .person_select').each(function () {
                    $(this).css({
                        'border-color': '#dee2e6',
                        'background': '#ffffff'
                    });
                    $(this).find('div').first().css('color', '#6c757d');
                    $(this).find('strong').css('color', '#6c757d');
                });

                // Auto-proceed for Take Away using the shared kotOrderNext flow
                // so that new and edit KOT flows behave consistently.
                if (PosnicPro.kotorder && typeof PosnicPro.kotorder.kotOrderNext === 'function') {
                    PosnicPro.kotorder.kotOrderType = dineType;   
                    PosnicPro.kotorder.kotOrderNext(); 
                }
            } else {
                $('#kot_dinein_label')
                    .addClass('active btn-info')
                    .removeClass('btn-outline-info');
                $('#kot_takeaway_label')
                    .removeClass('active btn-info')
                    .addClass('btn-outline-info');

                if (previousType === 'Take away' || PosnicPro.kotorder.kotTableNumber === 'TA') {
                    PosnicPro.sales.selectedTable = null;
                    PosnicPro.kotorder.kotTableNumber = '';
                    $('#custom_table_input').val('');

                    $('#kot_order_tables_list .table_select').each(function () {
                        $(this).css({
                            'border-color': '#dee2e6',
                            'background': '#ffffff'
                        });
                        $(this).find('strong').css('color', '#495057');
                        $(this).find('.table-inner').css('border-color', '#dee2e6');
                    });

                    $('#kot_order_tables_list .table_select')
                        .removeClass('active btn-primary')
                        .addClass('btn-outline-secondary');
                }
            }

        });
    }, 

    addPerson: function () {
        let list = PosnicPro.kotorder.personsList;
        let last = list.length > 0 ? list[list.length - 1] : 0;
        list.push(last + 1);
        PosnicPro.kotorder.renderPersons();
    },

    kotHideShow: function () {
        if (PosnicPro.sales.saleProcess === 'KOT') {
            $('.kot-hide').hide();
            $('.kot-save-hide').show();
            $('.kot_sales_btn').show();
        } else {
            $('.kot-hide').show();
            $('.kot-save-hide').hide();
            $('.kot_sales_btn').hide();
        }
    },
    
    kotOrderNext: function () {
        // ✅ Reset submission flag before proceeding to sales
        PosnicPro.sales.submissionInProgress = false;
        $("#save_btn").prop('disabled', false);
        $("#save_submit").removeClass('disabled');
        
        PosnicPro.sales.saleProcess = 'KOT';
        var dineType = $('#kot_dine_type_toggle input[name="kot_dine_type"]:checked').val();

        PosnicPro.kotorder.kotOrderType = dineType;

        // Update label styles
        if (dineType === 'Take away') {
            $('#kot_takeaway_label').addClass('active');
            $('#kot_dinein_label').removeClass('active');

            // Auto-proceed for Take Away
            PosnicPro.sales.saleProcess = 'KOT';
            PosnicPro.kotorder.kotTableNumber = 'TA';
            PosnicPro.kotorder.kotPersonCount = 0;
            PosnicPro.kotorder.kotOrderType = 'Take away';
            PosnicPro.sales.selectedTable = { id: 'TA', tableNumber: 'TA' };

            // Navigate to sales/new only for new KOT flows (no editSaleId)
            if (!PosnicPro.kotorder || !PosnicPro.kotorder.editSaleId) {
                if (typeof hasher !== 'undefined') {
                    hasher.setHash('sales/new');
                } else {
                    window.location.hash = '#/sales/new';
                }
            }
        } else {
            $('#kot_dinein_label').addClass('active');
            $('#kot_takeaway_label').removeClass('active');
        }

        // Use stored values first, fallback to DOM 
        var tableNumber = PosnicPro.kotorder.kotTableNumber || '';

        // If no stored value, check DOM
        if (!tableNumber) {
            const customInput = $('#custom_table_input').val();
            const activeSelection = $('#kot_order_tables_list .table_select.active').text();
            tableNumber = (customInput && customInput.trim()) ? customInput.trim() : activeSelection.trim();
        }

        let totalSelected = 0;

        if (dineType === 'Take away') {
            totalSelected = 0;
        } else {
            // Custom input has highest priority when it contains a positive number
            var customPersonRaw = $('#kot_custom_person_input').val();
            var customPersonVal = parseInt(customPersonRaw, 10);

            if (!isNaN(customPersonVal) && customPersonVal > 0) {
                totalSelected = customPersonVal;
            } else {
                // Otherwise, rely only on the visibly active person button
                const $activePerson = $('#kot_order_persons_list .person_select.active');
                if ($activePerson.length) {
                    totalSelected = parseInt($activePerson.data('id'), 10) || 0;
                }
            }
        }

        if (dineType === 'Dine-in' && (!tableNumber || tableNumber === '')) {
            PosnicPro.alert('warning', 'Select a table.');
            return;
        }

        PosnicPro.kotorder.kotTableNumber = tableNumber;
        PosnicPro.kotorder.kotPersonCount = totalSelected;
        PosnicPro.kotorder.kotOrderType = dineType;

        if (PosnicPro.kotorder && PosnicPro.kotorder.editSaleId) {
            var editId = PosnicPro.kotorder.editSaleId;

            if (PosnicPro.kotsales && typeof PosnicPro.kotsales.showEdit === 'function') {
                PosnicPro.kotsales.showEdit(editId);
            }
        } else {
            // Normal KOT -> New Sale flow
            if (typeof hasher !== 'undefined') {
                hasher.setHash('sales/new');
            } else {
                window.location.hash = '#/sales/new';
            }
        }
    }
};

// Manual-discount approval gate (Phase 2). Line discounts and the extra
// discount are restricted till actions; coupon / loyalty discounts are
// validated server-side by their own rules and never counted here. The
// detection mirrors the server's collectSaleAuditChanges, which backs this
// gate with a 403 unless a manager-approval token rides on the payload.
//
// On PosnicPro.sales itself, NOT inside addSale: cartOrderSubmit and every
// helper call resolve these as PosnicPro.sales.* - defined anywhere else,
// the Tender button dies with "guardDiscountApproval is not a function".
PosnicPro.sales._num = function (v) { var n = parseFloat(v); return isFinite(n) ? n : 0; };
PosnicPro.sales._manualDiscountOn = function (data) {
    var num = PosnicPro.sales._num;
    var items = data.items || [];
    for (var i = 0; i < items.length; i++) {
        var it = items[i] || {};
        if (num(it.sale_inline_discount_value) > 0 || num(it.item_discount) > 0 ||
            num(it.discount_amount) > 0 || num(it.sale_inline_discount_pervalue) > 0 ||
            num(it.item_discount_percentage) > 0 || num(it.discount_percentage) > 0) {
            return true;
        }
    }
    return num(data.extra_discount) > 0;
};
// Best-effort percent estimate for the role's discount cap: the larger of
// (total discount amount / subtotal) and any raw percent entered.
PosnicPro.sales._manualDiscountPct = function (data) {
    var num = PosnicPro.sales._num;
    var subtotal = num(data.sales_sub_total) || num(data.sales_total);
    var amount = 0, maxPct = 0;
    (data.items || []).forEach(function (raw) {
        var it = raw || {};
        amount += num(it.sale_inline_discount_value) || num(it.item_discount) || num(it.discount_amount);
        var p = num(it.sale_inline_discount_pervalue) || num(it.item_discount_percentage) || num(it.discount_percentage);
        if (p > maxPct) maxPct = p;
    });
    var extra = num(data.extra_discount);
    if (extra > 0) {
        if (data.extra_discount_type === 'percent') { if (extra > maxPct) maxPct = extra; }
        else { amount += extra; }
    }
    if (subtotal > 0) {
        var pctOfBill = (amount / subtotal) * 100;
        if (pctOfBill > maxPct) maxPct = pctOfBill;
    }
    return maxPct;
};
// Wraps a sale submit. proceed() runs immediately when there is no manual
// discount, or this user may apply it within their cap; otherwise the
// manager PIN/card modal runs first and the token is attached to the
// payload for the server-side check.
PosnicPro.sales.guardDiscountApproval = function (params, proceed) {
    var data;
    try { data = JSON.parse(params.data); } catch (e) { proceed(); return; }
    if (!data || !PosnicPro.sales._manualDiscountOn(data)) { proceed(); return; }
    if (PosnicPro.posCan('discount_apply')) {
        var pos = PosnicPro.userACL && PosnicPro.userACL.pos;
        var cap = pos ? PosnicPro.sales._num(pos.discount_max_percent) : 0;
        if (cap <= 0 || PosnicPro.sales._manualDiscountPct(data) <= cap) {
            proceed();
            return;
        }
    }
    PosnicPro.requireManagerApproval('discount_apply',
        { prompt: "This discount needs a manager's approval." },
        function (approval) {
            if (approval && approval.approval_token) {
                data.approval_token = approval.approval_token;
                params.data = JSON.stringify(data);
            }
            proceed();
        });
};

/*********** START - ADD NEW SALES ***********/
/***********  THIS FUNCTION HANDLE THE ADD NEW SALES ORDER ***********/
PosnicPro.sales.addSale = {
    /*Save Sales Order*/
    cartOrderSubmit: function (payment) {
        // // ✅ Prevent duplicate submissions
        // if (PosnicPro.sales.submissionInProgress || $("#save_btn").prop('disabled') || $("#save_submit").hasClass('disabled')) {
        //     console.log('⚠️ Submission already in progress');
        //     return false;
        // }
        
        // ✅ Mark submission as in progress
        PosnicPro.sales.submissionInProgress = true;
        $("#save_btn").prop('disabled', true);
        $("#save_submit").addClass('disabled');
        if (PosnicPro.sales.saleProcess === 'KOT') {
            $('#infobar-settings-sidebar-tender-details').hide();
        } else {
            $('#infobar-settings-sidebar-tender-details').show();
        }

        // Skip partial-amount validation entirely in payment-only mode
        if (!PosnicPro.sales.paymentOnlyMode && PosnicPro.sales.SaleAction !== 'return' && $('#Partial_amount').val() === '') {
            if ($('#Partial_amount').val() === '') {
                $("#Partial_amount").focus();
                PosnicPro.alert('error', 'Enter a partial amount.');
                return false;
            }
        }
        var partial_check_value = $("#sales_new_customer_partial_balance").val();
        var partial_check = (partial_check_value === 'true' || partial_check_value === 'Partial') ? 'true' : 'false';
        var partial = $('#Partial_amount').val();
        let payments = PosnicPro.sales.getPaymentObject();
        
        // Final validation: Check if multipayment total exceeds Pay amount
        if (PosnicPro.local.get('enable_multi_payment') === 'enable') {
            var multipaymentTotal = 0;
            for (var mode in payments) {
                multipaymentTotal += parseFloat(payments[mode]) || 0;
            }
            multipaymentTotal = parseFloat(multipaymentTotal.toFixed(2));
            var payAmount = parseFloat(partial) || 0;
            
            if (multipaymentTotal > payAmount + 0.01) {
                PosnicPro.sales.submissionInProgress = false;
                $("#save_btn").prop('disabled', false);
                $("#save_submit").removeClass('disabled');
                PosnicPro.alert('error', 'Total payment (₹' + multipaymentTotal.toFixed(2) + ') cannot exceed Pay amount (₹' + payAmount.toFixed(2) + ')');
                return false;
            }
        }
        
        // In payment-only mode or non-add flows, always delegate to editSale
        if (PosnicPro.sales.paymentOnlyMode || PosnicPro.sales.SaleAction !== 'add') {
            /*This Function Call For Edit and Return ,Exchange sales Action*/
            PosnicPro.sales.editSale.cartOrderSubmit(payment);
            return false;
        }

        // 🔒 Table mandatory when table options enabled (new sale)
        var dineType = $('#sale_dine_type').val() || 'Dine-in';
        PosnicPro.sales.dineType = dineType;

        if (PosnicPro.local.get('table_options') === 'enable' && dineType === 'Dine-in' && PosnicPro.sales.saleProcess === 'KOT') {
            var hasTable = (PosnicPro.sales.selectedTable && (PosnicPro.sales.selectedTable.id || PosnicPro.sales.selectedTable.tableNumber)) ||
                (PosnicPro.kotorder && PosnicPro.kotorder.kotTableNumber && PosnicPro.kotorder.kotTableNumber.toString().trim() !== '');

            if (!hasTable) {
                PosnicPro.alert('warning', 'Select a table.');
                return false;
            }

            // 📝 Discount Note mandatory ONLY when there is any discount on new sale
            var totalDiscountAdd = parseFloat($('#discount_sale_amount').text().replace(/,/g, ''));
            totalDiscountAdd = isNaN(totalDiscountAdd) ? 0 : totalDiscountAdd;

            var extraDiscountAdd = parseFloat($('#extraDisc').text());
            extraDiscountAdd = isNaN(extraDiscountAdd) ? 0 : extraDiscountAdd;

            var hasAnyDiscountAdd = (Math.abs(totalDiscountAdd) > 0 || Math.abs(extraDiscountAdd) > 0);

            // if (hasAnyDiscountAdd) {
            //     var discountNoteAdd = $.trim($('#discount_description').val() || '');
            //     if (discountNoteAdd === '') {
            //         PosnicPro.alert('error', 'Please enter Discount Note before saving the sale.');
            //         $('#discount_description').show().editable('show');
            //         setTimeout(function () {
            //             $('.editable-container:last textarea, .editable-container:last input').focus();
            //         }, 10);
            //         return false;
            //     }
            // }
        }

        // walk-in sales must not be refused: fill from the cached default
        // customer when nothing was chosen (see ensureCustomer)
        if (PosnicPro.sales.ensureCustomer) { PosnicPro.sales.ensureCustomer(); }
        var customer_name = $("#sales_new_customer_name").val();
        // Skip customer / item validation in payment-only mode (items already from DB)
        if (!PosnicPro.sales.paymentOnlyMode && ($('#sales_new_items_table tbody tr').find(':nth-child(8)').text() === '' || customer_name === '')) {

            if (customer_name === '') {
                $('.toggle-customer-user').css({ display: 'block' });
                $("#sales_new_customer_name").focus();
                PosnicPro.alert('error', 'Enter a customer name.');
                return false;
            }
            $('#collapseOne').removeClass("show");
            $('#collapseTwo').addClass("show");
            PosnicPro.alert('warning', 'Add at least one item.');
            $('#sales_new_item_name').focus();
            return false;
        } else {
            var loader = $(".loader-sales-balance");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            PosnicPro.sales.addSalesLineTable = $('#sales_new_items_table tbody tr').map(function () {
                let itemid = $(this).find(':nth-child(9)').text();
                var status = ($('#salesType_' + itemid).text() === 'instant') ? 'instant' : 'Add';

                // Prefer custom note from cart; if empty, fall back to original item description
                var noteText = $('#addSalesLineItemNote_' + itemid).text() || '';
                var descriptionFromCache = '';
                var cachedItem = PosnicPro.sales.SaleTableLineItems[itemid];
                if (cachedItem && typeof (cachedItem.item_description) !== 'undefined' && cachedItem.item_description !== null) {
                    descriptionFromCache = cachedItem.item_description;
                }
                var finalItemDescription = $.trim(noteText) !== '' ? noteText : descriptionFromCache;

                return {
                    item_status: status,
                    sale_inline_item_price: $('#saleInlineItemPrice_' + itemid).text(),
                    sale_inline_discount_value: $('#saleInlineDiscount_' + itemid).text(),
                    sale_inline_discount_pervalue: $('#saleInlineDiscountPer_' + itemid).text(),
                    item_name: $('#addSalesLineItemName_' + itemid).text(),
                    item_price: $('#addSalesLineItemPrice_' + itemid).text(),
                    item_unit: $('#addSalesLineItemUnit_' + itemid).text(),
                    item_discount: $('#addSalesLineDiscountAmount_' + itemid).text(),
                    item_discount_percentage: $('#addSalesLineDiscountPercentage_' + itemid).text(),
                    item_quantity: $('#touchsale_item_qty' + itemid).val(),
                    item_available_quantity: $('#addSalesLineavailableQty_' + itemid).text(),
                    item_id: $('#addSalesLineItemId_' + itemid).text(),
                    total_amount: $('#addSalesLineTotal_' + itemid).text(),
                    barcode_id: $('#addSalesLineItemBarcodeId_' + itemid).text(),
                    company_price_total: $('#addSalesLineItemCompanyPrice_' + itemid).text(),
                    category_id: $('#saleCategoryId_' + itemid).text(),
                    category_name: $('#saleCategoryName_' + itemid).text(),
                    supplier_id: $('#saleSupplierId_' + itemid).text(),
                    supplier_name: $('#saleSupplierName_' + itemid).text(),
                    gst: $('#addSalesGstTax_' + itemid).text(),
                    track_inventory: $('#trackInventory_' + itemid).text(),
                    negative_stock: $('#negativeStock_' + itemid).text(),
                    item_price_total: $('#addSalesLineItemSellingPrice_' + itemid).text(),
                    item_description: finalItemDescription,
                    modifiers: PosnicPro.sales._lineModifiers[itemid] || undefined
                };
            }).get();

            var TotalCompanyPrice = 0;
            for (var i = 0; i < PosnicPro.sales.addSalesLineTable.length; i++) {
                TotalCompanyPrice += parseInt(PosnicPro.sales.addSalesLineTable[i].company_price_total);
            }
            let payment_mode_val;
            // payments already defined earlier for debug logging
            let modes = Object.keys(payments).join(', ');
            if (PosnicPro.local.get('enable_multi_payment') === 'enable') {
                payment_mode_val = modes;
            } else if ($('.payment_mode').val() === '' && PosnicPro.local.get('table_options') === 'enable') {
                payment_mode_val = '';
            } else if ($('.payment_mode').val() === '') {
                payment_mode_val = 'Cash';
            } else {
                payment_mode_val = $('.payment_mode').val();
            }
            let register_id = PosnicPro.sales.saleRegisterId();
            var isKotNewSale = (PosnicPro.sales.saleProcess === 'KOT');
            var newSaleTableNumber = '';
            var newSalePersonCount = '';
            var newSaleDineType = '';

            if (isKotNewSale) {
                newSaleTableNumber = PosnicPro.kotorder.kotTableNumber || '';
                newSalePersonCount = PosnicPro.kotorder.kotPersonCount || '';
                newSaleDineType = PosnicPro.kotorder.kotOrderType || '';
            }
             
            // Prepare denomination data
            let denominationData = [];
            if (PosnicPro.sales.denominationCounts) {
                for (let denom in PosnicPro.sales.denominationCounts) {
                    let count = PosnicPro.sales.denominationCounts[denom] || 0;
                    if (count > 0) {
                        denominationData.push({
                            cash: denom.toString(),
                            value: count.toString(),
                            amount: (parseFloat(denom) * count).toString()
                        });
                    }
                }
            }
            
            var params = {
                url: 'sales',
                data: JSON.stringify({
                    items: PosnicPro.sales.addSalesLineTable,
                    sales_total: $("#grand_total").val(),
                    sales_sub_total: String($('#sales_new_subtotal').text() || '').replace(/,/g, ''),
                    customer_id: $('#sales_new_customer_id').val(),
                    redeem_points: (PosnicPro.loyalty ? PosnicPro.loyalty.redeemPointsForPayload() : 0),
                    coupon_code: (PosnicPro.coupons ? PosnicPro.coupons.codeForPayload() : ''),
                    customer_name: $('#sales_new_customer_name').val(),
                    customer_address: $('#sales_new_customer_address').val(),
                    customer_phone: $('#sales_new_customer_phone').val(),
                    customer_email: $('#sales_new_customer_email').val(),
                    customer_state: $('#sales_new_customer_state').val(),
                    customer_country: $('#sales_new_customer_country').val(),
                    customer_gst_type: $('#sales_new_customer_gst_type').val(),
                    customer_gst_number: $('#sales_new_customer_gst_number').val(),
                    sales_total_company_price: TotalCompanyPrice,
                    date: $('#time-format').val(),
                    tax: parseFloat(String($("#tax").text() || '').replace(/,/g, '')),
                    payment_descriptiondiscount: String($("#discount_sale_amount").text() || '').replace(/,/g, ''),
                    payment_mode: payment_mode_val,
                    payment_description: $('#payment_description').val(),
                    sales_description: $('#sales_description').val(),
                    discount_description: $('#discount_description').val(),
                    unpaid: $('#unpaid_payment_toggle').is(':checked') ? 'false' : 'true',
                    sales_id: '',
                    register_id: register_id,
                    partial_balance: partial,
                    customer_current_balance: ($('#customer_current_balance').val() > 0) ? $('#customer_current_balance').val() : 0,
                    partial_check: partial_check,
                    wallet_check: ($('#wallet_balance').is(":checked")) ? 'true' : 'false',
                    extra_discount: parseFloat($('#extraDisc').text()),
                    extra_discount_type: !$('#percentIcon').hasClass('d-none') ? "percent" : "price",
                    tip_amount: parseFloat($('#sale_tip_input').val()) || 0,
                    // India default: a tip is for staff, not the bill. The
                    // per-sale opt-in makes the server grow the due by it.
                    tip_in_total: ($('#sale_tip_in_total').is(':checked')
                        && (parseFloat($('#sale_tip_input').val()) || 0) > 0) ? 'true' : 'false',
                    charges: PosnicPro.sales.charges || [],
                    // quote lineage rides only on a conversion (both cleared after save)
                    source_quote_id: PosnicPro.sales._sourceQuoteId || '',
                    quote_price_honoured: PosnicPro.sales._sourceQuoteId
                        ? (PosnicPro.sales._quoteHonoured ? 'true' : 'false') : undefined,
                    multi_payment: payments,
                    enable_multi_payment: PosnicPro.local.get('enable_multi_payment'),
                    table_number: newSaleTableNumber,
                    person_count: newSalePersonCount,
                    sale_process: PosnicPro.sales.saleProcess,
                    dine_type: newSaleDineType,
                    denomination_values: denominationData
                })
            };
            PosnicPro.sales.guardDiscountApproval(params, function () {
            PosnicPro.post(params, function (response) {
                // ✅ Clear submission flag
    PosnicPro.sales.submissionInProgress = false;
                if (response.type === 'success') {
                    // Stock just changed on the server; cached items are stale.
                    PosnicPro.sales.itemCache.clear();
                    window.intlTelInputGlobals.getInstance(document.querySelector("#customer_sms_phone")).setCountry(response.data.country_sort);
                    $('#extraDisc').text(0);
                    $('#extraDisc').editable('setValue', 0);
                    // A sale born from a quote stamps it converted (fire-safe).
                    if (PosnicPro.sales._sourceQuoteId) {
                        var qid = PosnicPro.sales._sourceQuoteId;
                        PosnicPro.sales._sourceQuoteId = null;
                        PosnicPro.sales._quoteHonoured = null;
                        var sid = (response && response.data && (response.data.id || response.data._id)) || null;
                        PosnicPro.post({ url: 'quotes/' + qid + '/transition', data: JSON.stringify({ action: 'convert', sale_id: sid }) },
                            function () { /* stamped */ }, function () { /* quote stays open - visible on the Quotes page */ });
                    }
                    $('#sale_tip_input').val('');
                    $('#sale_tip_in_total').prop('checked', false);
                    $("#save_submit").addClass("disabled");
                    $('.smsSalesReceipt').hide();
                    if (response.data.sms === true) {
                        $('.smsSalesReceipt').show();
                    }
                    $('.printSalesWhatsAppReceipt').hide();
                    if (response.data.whatsapp === true) {
                        $('.printSalesWhatsAppReceipt').show();
                    }
                    if ($('.payment_mode').val() === 'Qrpay') {
                        var params = {
                            url: 'sales/qrSalePayementUpdate',
                            data: {
                                paymentid: payment.id,
                                salesid: response.data.sales_id
                            }
                        };
                        PosnicPro.get(params, function (response) {
                            if (response.type === 'error') {
                                PosnicPro.alert(response.data, response.message);
                            }
                        }, function (xhr) {
                            var response = jQuery.parseJSON(xhr.responseText);
                            PosnicPro.alert(response.type, response.message);
                        });
                    }
                    if (response.data.waring === 'warning') {
                        swal({
                            title: "Low Stock!",
                            text: "Your sales count for this month is very low!",
                            icon: "warning",
                            button: "Ok",
                        });
                    }
                    if (PosnicPro.sales.saleProcess !== 'KOT' && response.data.print === true) {
                        PosnicPro.sales.view.printSale(response.data.sales_id, 'sale');
                    }
                    if (response.data.mail === true && $('#sales_new_customer_email').val() !== "") {
                        PosnicPro.sales.addSale.sendSalesReceipt(response.data.sales_id);
                    }
                    var path = '#/sales/' + response.data.sales_id;
                    $('.printSalesReceipt')
                        .attr('href', path + '/print')
                        .data('sale-id', response.data.sales_id);
                    let phone = (response.data.phone !== '') ? path + '/' + response.data.phone + '/' + response.data.name + '/sms' : path + '/ /' + response.data.name + '/sms';
                    $('.smsSalesReceipt').attr('href', phone);
                    $('.printSalesWhatsAppReceipt').attr('href', 'javascript:void(0)').attr('onclick', `PosnicPro.sales.showWhatsAppReceipt('${response.data.sales_id}', '${response.data.phone}', '${response.data.name}')`);
                    $('#qr_view').modal('hide');
                    $('#Partial_amount').val('');
                    loader.find(".loadingSpinner:first").remove();

                        PosnicPro.sales.setDefaults();
                    PosnicPro.sales.customerViewDisplay();
                    PosnicPro.stocklogs.viewLowStockDashboard();
                    PosnicPro.sales.recentMenu.recentSalesTabDetails();
                    $('#customer_current_balance').val(response.data.customer_balance);
                    PosnicPro.alert(response.type, response.message);
                    if (PosnicPro.sales.saleProcess === 'KOT' &&
                        !(PosnicPro.kotorder && PosnicPro.kotorder.editSaleId)) {
                        // Refresh KOT data to show updated table list
                        if (PosnicPro.kot && typeof PosnicPro.kot.refreshKOTData === 'function') {
                            PosnicPro.kot.refreshKOTData();
                        } else {
                            hasher.setHash('kot');
                        }
                    }
                } else {
                    // ✅ Re-enable on error response
                    $("#save_btn").prop('disabled', false);
                    $("#save_submit").removeClass('disabled');
                    PosnicPro.alert(response.type, response.message);
                }
            }, function (xhr) {
                // ✅ Clear submission flag and re-enable button on error
                PosnicPro.sales.submissionInProgress = false;
                $("#save_btn").prop('disabled', false);
                $("#save_submit").removeClass('disabled');
                var response = jQuery.parseJSON(xhr.responseText);
                $.each(response.data, function (key, val) {
                    let row = "touch_row_" + val.item_id;
                    $("#" + row + '').removeAttr("style");
                    $("#" + row + '').addClass('table-highlight-row');
                    let rowInput = "touchsale_item_qty" + val.item_id;
                    $("#" + rowInput + '').val(val.item_quantity);
                    setTimeout(function () {
                        $("#" + row + '').removeClass('table-highlight-row');
                    }, 500);
                });
            });
            });
        }
    },
    sendSms: function () {

        var params = {
            url: 'setting/salesSmsReceipt',
            data: JSON.stringify(PosnicPro.getFormData($('#sms_form')))
        };
        PosnicPro.post(params, function (response) {
            if (response.type === 'success') {
                $('#smsModal').modal('hide');
                hasher.changed.active = false;
                hasher.replaceHash('sales/new');
                hasher.changed.active = true;
                PosnicPro.alert(response.type, response.message);
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var errorMessage = 'An unknown error occurred.';
            var response = jQuery.parseJSON(xhr.responseText);
            if (response.message) {
                var match = response.message.match(/"message":"([^"]+)/);
                if (match && match[1]) {
                    errorMessage = match[1];
                } else {
                    errorMessage = response.message;
                }
            }
            PosnicPro.alert('Error', errorMessage);
        });
    },
    
    sendWhatsAppReceipt: function () {
        
        // Get form data using jQuery val() directly
        const phoneNumber = $('#customer_sms_fullphone').val();
        const selectedTemplate = $('#whatsapp_receipt_template').val();
        const message = $('#customer_sms_message').val();
        
                
        // Validate phone number
        if (!phoneNumber) {
            PosnicPro.alert('error', 'Enter a valid phone number');
            return;
        }
        
        // Send WhatsApp message using WhatsApp service
        const params = {
            url: 'whatsapp/sendMessage',
            data: {
                phone_number: phoneNumber.replace(/\D/g, '') // Remove non-digits
            }
        };
        
        // Use template_id if template is selected, otherwise use message
        if (selectedTemplate && selectedTemplate !== '') {
            params.data.template_id = selectedTemplate;
            // Add sale_id for template variable replacement
            params.data.sale_id = PosnicPro.sales.currentSaleId || '';
            console.log('Sending WhatsApp with template:', {
                template_id: params.data.template_id,
                sale_id: params.data.sale_id,
                currentSaleId: PosnicPro.sales.currentSaleId
            });
        } else if (message && message.trim() !== '') {
            params.data.message = message;
        } else {
            PosnicPro.alert('error', 'Please select a template or enter a message');
            return;
        }
        
        PosnicPro.post(params, function (response) {
            if (response.type === 'success') {
                $('#smsModal').modal('hide');
                hasher.changed.active = false;
                hasher.replaceHash('sales/new');
                hasher.changed.active = true;
                PosnicPro.alert(response.type, response.message);
                
                // Reset form ID back to original
                $('#whatsapp_receipt_form').attr('id', 'sms_form');
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var errorMessage = 'An unknown error occurred.';
            var response = jQuery.parseJSON(xhr.responseText);
            if (response.message) {
                errorMessage = response.message;
            }
            PosnicPro.alert('Error', errorMessage);
        });
    },
    sendSalesReceipt: function (sales_id) {

        var params = {
            url: 'sales/salesReceipt',
            data: JSON.stringify({
                email: $("#sales_new_customer_email").val(),
                name: $("#sales_new_customer_name").val(),
                id: sales_id
            })
        };
        PosnicPro.post(params, function (response) {
            if (response.type === 'error') {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    }
};
/*********** END - ADD NEW SALES ***********/
/*********** START - EDIT ,RETURN AND EXCHANGE ***********/
/*********** THIS FUNCTION HANDLE THE EDIT ,RETURN AND EXCHANGE SALES ORDER ***********/
PosnicPro.sales.editSale = {
    cartOrderSubmit: function (payment) {
        var salesAction = (PosnicPro.sales.refundSaleAction === true) ? 'return' : 'edit';

        // Table mandatory when table options enabled (edit / exchange)
        var dineType = $('#sale_dine_type').val() || 'Dine-in';
        PosnicPro.sales.dineType = dineType;
        if (PosnicPro.local.get('table_options') === 'enable' &&
            salesAction !== 'return' &&
            dineType === 'Dine-in' &&
            // Do not enforce table selection when paying from KOT History
            !(PosnicPro.sales.kotPaymentMode === true && PosnicPro.sales.paymentOnlyMode === true)) {

            // if (!PosnicPro.sales.selectedTable || !PosnicPro.sales.selectedTable.id) {
            //     PosnicPro.alert('warning', 'Please select a table before saving the sale.');
            //     return false;
            // }

            // Discount Note mandatory ONLY when there is any discount on edit sale
            var totalDiscountEdit = parseFloat($('#discount_sale_amount').text().replace(/,/g, ''));
            totalDiscountEdit = isNaN(totalDiscountEdit) ? 0 : totalDiscountEdit;

            var extraDiscountEdit = parseFloat($('#extraDisc').text());
            extraDiscountEdit = isNaN(extraDiscountEdit) ? 0 : extraDiscountEdit;

            var hasAnyDiscountEdit = (Math.abs(totalDiscountEdit) > 0 || Math.abs(extraDiscountEdit) > 0);

            // if (hasAnyDiscountEdit) {
            //     var discountNoteEdit = $.trim($('#discount_description').val() || '');
            //     if (discountNoteEdit === '') {
            //         PosnicPro.alert('error', 'Please enter Discount Note before saving the sale.');
            //         $('#discount_description').show().editable('show');
            //         setTimeout(function () {
            //             $('.editable-container:last textarea, .editable-container:last input').focus();
            //         }, 10);
            //         return false;
            //     } 
            // }
        }

        //salesAction = (PosnicPro.sales.salesExchange === true) ? 'exchange' : salesAction;
        // walk-in sales must not be refused: fill from the cached default
        // customer when nothing was chosen (see ensureCustomer)
        if (PosnicPro.sales.ensureCustomer) { PosnicPro.sales.ensureCustomer(); }
        var customer_name = $("#sales_new_customer_name").val();
        // Skip customer/item validation entirely in payment-only mode (items already loaded from DB)
        if (!PosnicPro.sales.paymentOnlyMode && ($('#sales_new_items_table tbody tr').find(':nth-child(8)').text() === '' || customer_name === '')) {
            if (customer_name === '') {
                $("#sales_new_customer_name").focus();
                PosnicPro.alert('error', 'Enter a customer name.');
                return false;
            }
        }

        if (salesAction === 'return') {
            PosnicPro.sales.returnSalesLineTable = $('#sales_new_items_table tbody tr').map(function () {
                let itemid = $(this).find(':nth-child(9)').text();
                var available_qty = parseInt($('#returndecreSales_' + itemid).text()) + parseInt($('#returnavailable_' + itemid).text());
                var total_item_quantity = $('#touchsale_item_return_qty' + itemid).val();

                var gst_tax_value = $('#addSalesGstTax_' + itemid).text();
                var branch_state = $("#setting_state").val();
                var supplier_state = $("#sales_new_customer_state").val();
                if (branch_state === supplier_state) {
                    var csgst_value = ((gst_tax_value / 2));
                } else {
                    var igst_value = (gst_tax_value);
                }


                return {
                    item_status: $('#salesOrderType_' + itemid).text(),
                    item_name: $('#addSalesLineItemName_' + itemid).text(),
                    item_unit: $('#addSalesLineItemUnit_' + itemid).text(),
                    item_price: $('#addSalesLineItemSellingPrice_' + itemid).text(),
                    item_discount: $('#addSalesLineDiscountAmount_' + itemid).text(),
                    item_discount_percentage: $('#addSalesLineDiscountPercentage_' + itemid).text(),
                    item_quantity: total_item_quantity,
                    item_available_quantity: available_qty,
                    payment_mode: $('.payment_mode').val(),
                    item_id: $('#addSalesLineItemId_' + itemid).text(),
                    total_amount: $('#addSalesLineTotal_' + itemid).text(),
                    barcode_id: $('#addSalesLineItemBarcodeId_' + itemid).text(),
                    company_price_total: $('#addSalesLineItemCompanyPrice_' + itemid).text(),
                    category_id: $('#saleCategoryId_' + itemid).text(),
                    category_name: $('#saleCategoryName_' + itemid).text(),
                    supplier_id: $('#saleSupplierId_' + itemid).text(),
                    supplier_name: $('#saleSupplierName_' + itemid).text(),
                    item_value: $('#touchsale_item_return_qty' + itemid).val(),
                    tax: $('#addSalesLineItemTax_' + itemid).text(),
                    tax_type: $('#addSalesLineItemTaxType_' + itemid).text(),
                    igst_tax: igst_value,
                    cgst_tax: csgst_value,
                    sgst_tax: csgst_value,
                    payment_description: $('#payment_description').val(),
                    sales_description: $('#sales_description').val(),
                    discount_description: $('#discount_description').val()
                };
            }).get();
            PosnicPro.sales.returnitemSalesLineTable = $('#sales_return_items_table tbody tr').map(function () {
                let itemid = $(this).find(':nth-child(11)').text();
                var gst_tax_value = $('#returnSalesGstTax_' + itemid).text();
                var branch_state = $("#setting_state").val();
                var supplier_state = $("#sales_new_customer_state").val();
                if (branch_state === supplier_state) {
                    var csgst_value = ((gst_tax_value / 2));
                } else {
                    var igst_value = (gst_tax_value);
                }
                return {
                    item_status: $('#returnsalesOrderType_' + itemid).text(),
                    item_name: $('#returnSalesLineItemName_' + itemid).text(),
                    item_unit: $('#returnSalesLineItemUnit_' + itemid).text(),
                    item_price: $('#addSalesLineItemSellingPrice_' + itemid).text(),
                    item_discount: $('#returnSalesLineDiscountAmount_' + itemid).text(),
                    item_discount_percentage: $('#returnSalesLineItemDiscount_' + itemid).text(),
                    item_quantity: $('#returnSalesLineItemQty_' + itemid).text(),
                    item_id: $('#returnSalesLineItemId_' + itemid).text(),
                    total_amount: $('#returnSalesLineTotal_' + itemid).text(),
                    barcode_id: $('#returnSalesLineItemBarcodeId_' + itemid).text(),
                    company_price_total: $('#returnSalesLineItemCompanyPrice_' + itemid).text(),
                    payment_mode: $('.payment_mode').val(),
                    category_id: $('#saleCategoryId_' + itemid).text(),
                    category_name: $('#saleCategoryName_' + itemid).text(),
                    supplier_id: $('#saleSupplierId_' + itemid).text(),
                    supplier_name: $('#saleSupplierName_' + itemid).text(),
                    tax: $('#returnSalesLineItemTax_' + itemid).text(),
                    tax_type: $('#returnSalesLineItemTaxType_' + itemid).text(),
                    igst_tax: igst_value,
                    cgst_tax: csgst_value,
                    sgst_tax: csgst_value,
                    payment_description: $('#payment_description').val(),
                    sales_description: $('#sales_description').val()
                };
            }).get();
            var editSalesCompanyPrice = 0;
            var process_return = PosnicPro.sales.returnSalesLineTable.length;
            for (var i = 0; i < process_return; i++) {
                editSalesCompanyPrice += parseInt(PosnicPro.sales.returnSalesLineTable[i].company_price_total);
            }
            var process_status = (isNaN(editSalesCompanyPrice) === true) ? 'FullReturn' : 'PartialReturn';
            var SalesDocumentId = 0;
            SalesDocumentId = PosnicPro.sales.editSaleId;
            SalesDocumentId = (salesAction === 'return') ? PosnicPro.sales.refundSaleId : SalesDocumentId;
            SalesDocumentId = (PosnicPro.sales.salesExchange === true) ? PosnicPro.sales.refundSaleId : SalesDocumentId;
            var data = {
                sale_process: process_status,
                date: $('#time-format').val(),
                sales_id: SalesDocumentId,
                alternative_id: PosnicPro.sales.salesId,
                addInventory: false,
                items: PosnicPro.sales.returnSalesLineTable,
                items_return: PosnicPro.sales.returnitemSalesLineTable,
                tax: String($("#tax").text() || '').replace(/,/g, ''),
                discount: String($("#discount_sale_amount").text() || '').replace(/,/g, ''),
                payment_pending: PosnicPro.sales.EditRecentSaleParams.payment_pending,
                partial_check: PosnicPro.sales.EditRecentSaleParams.partial_check,
                extra_discount: parseFloat($('#extraDisc').text()),
                extra_discount_type: !$('#percentIcon').hasClass('d-none') ? "percent" : "price",
                round_off_check: PosnicPro.sales.extraDiscount.sales_round_off !== 0 ? true : false,
                dine_type: dineType
            };
            $('#return_amount_check').modal('hide');
            // Carry the manager-approval token (if a refund needed one) so the
            // server can verify it. Single-use: cleared once sent.
            data.approval_token = PosnicPro._refundApprovalToken || undefined;
            PosnicPro._refundApprovalToken = null;
            var paramsReturn = {
                method: 'POST',
                url: 'sales/returnSales',
                data: JSON.stringify(data)
            };
            PosnicPro.request(paramsReturn, function (response) {
                if (response.type === 'success') {
                    // A return puts stock back; cached items are stale.
                    PosnicPro.sales.itemCache.clear();
                    PosnicPro.alert(response.type, response.message);
                    history.back();
                } else {
                    PosnicPro.alert(response.type, response.message);
                }
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
        } else {
            var loader = $(".loader-sales-balance");
            $("<div class='loadingSpinner'></div>").appendTo(loader);

            PosnicPro.sales.addSalesLineTable = $('#sales_new_items_table tbody tr').map(function () {
                let itemid = $(this).find(':nth-child(9)').text();

                // Prefer custom note from cart; if empty, fall back to cached item description
                var noteText = $('#addSalesLineItemNote_' + itemid).text() || '';
                var descriptionFromCache = '';
                var cachedItem = PosnicPro.sales.SaleTableLineItems[itemid];
                if (cachedItem && typeof (cachedItem.item_description) !== 'undefined' && cachedItem.item_description !== null) {
                    descriptionFromCache = cachedItem.item_description;
                }
                var finalItemDescription = $.trim(noteText) !== '' ? noteText : descriptionFromCache;

                return {
                    sale_inline_item_price: $('#saleInlineItemPrice_' + itemid).text(),
                    sale_inline_discount_pervalue: $("#saleInlineDiscountPer_" + itemid).text(),
                    sale_inline_discount_value: $("#saleInlineDiscount_" + itemid).text(),
                    item_status: $('#salesOrderType_' + itemid).text(),
                    item_name: $('#addSalesLineItemName_' + itemid).text(),
                    item_unit: $('#addSalesLineItemUnit_' + itemid).text(),
                    item_price: $('#addSalesLineItemPrice_' + itemid).text(),
                    item_discount: $('#addSalesLineDiscountAmount_' + itemid).text(),
                    item_discount_percentage: $('#addSalesLineDiscountPercentage_' + itemid).text(),
                    item_quantity: $('#touchsale_item_qty' + itemid).val(),
                    item_id: $('#addSalesLineItemId_' + itemid).text(),
                    total_amount: $('#addSalesLineTotal_' + itemid).text(),
                    barcode_id: $('#addSalesLineItemBarcodeId_' + itemid).text(),
                    company_price_total: $('#addSalesLineItemCompanyPrice_' + itemid).text(),
                    category_id: $('#saleCategoryId_' + itemid).text(),
                    category_name: $('#saleCategoryName_' + itemid).text(),
                    supplier_id: $('#saleSupplierId_' + itemid).text(),
                    supplier_name: $('#saleSupplierName_' + itemid).text(),
                    gst: $('#addSalesGstTax_' + itemid).text(),
                    old_item_quantity: parseFloat($('#returnItemChangeQuantityValue_' + itemid).text()) || 0,
                    track_inventory: $('#trackInventory_' + itemid).text(),
                    negative_stock: $('#negativeStock_' + itemid).text(),
                    item_price_total: $('#addSalesLineItemSellingPrice_' + itemid).text(),
                    item_description: finalItemDescription,
                    modifiers: PosnicPro.sales._lineModifiers[itemid] || undefined
                };
            }).get();

            var editSalesCompanyPrice = 0;
            var editSalesSubTotal = 0;
            for (var i = 0; i < PosnicPro.sales.addSalesLineTable.length; i++) {
                editSalesCompanyPrice += parseInt(PosnicPro.sales.addSalesLineTable[i].company_price_total);
                editSalesSubTotal += parseInt(PosnicPro.sales.addSalesLineTable[i].total_amount);
            }

            var SalesDocumentId = 0;
            SalesDocumentId = PosnicPro.sales.editSaleId;
            SalesDocumentId = (salesAction === 'return') ? PosnicPro.sales.refundSaleId : SalesDocumentId;
            SalesDocumentId = (PosnicPro.sales.salesExchange === true) ? PosnicPro.sales.refundSaleId : SalesDocumentId;

            // Default behaviour: convert Hold -> Add, otherwise keep as Edit
            var sale_process = (PosnicPro.sales.EditRecentSaleParams.sale_process === 'Hold') ? 'Add' : 'Edit';

            // KOT History payment-only flow: when paying a KOT order from KOT History,
            // promote it to a normal completed sale by setting sale_process to 'Add'.
            // This ensures the backend updates payment_status (Paid / Unpaid) based
            // on the unpaid flag, without impacting other payment flows.
            if (PosnicPro.sales.kotPaymentMode === true &&
                PosnicPro.sales.paymentOnlyMode === true &&
                PosnicPro.sales.EditRecentSaleParams.sale_process === 'KOT') {
                sale_process = 'Add';
            }

            var register_id = PosnicPro.sales.saleRegisterId();

            let payment_mode_val;
            let payments = PosnicPro.sales.getPaymentObject();
            const multi_payment = PosnicPro.sales.EditRecentSaleParams.multi_payment || {};
            let modes = Object.keys(payments).join(', ');
            if (PosnicPro.local.get('enable_multi_payment') === 'enable' || Object.keys(multi_payment).length !== 0) {
                payment_mode_val = modes;
            } else if ($('.payment_mode').val() === '') {
                payment_mode_val = 'Cash';
            } else {
                payment_mode_val = $('.payment_mode').val();
            }

            var isKotPaymentOnlyFlow = (PosnicPro.sales.kotPaymentMode === true &&
                PosnicPro.sales.paymentOnlyMode === true &&
                PosnicPro.sales.EditRecentSaleParams &&
                PosnicPro.sales.EditRecentSaleParams.sale_process === 'KOT');

            var isKotOrderEditFlow = (PosnicPro.sales.saleProcess === 'KOT' &&
                PosnicPro.kotorder && PosnicPro.kotorder.editSaleId);

            // In the dedicated KOT order edit flow (kotsales/{id}/edit), keep the
            // sale_process as "KOT" so that updates continue to appear only in
            // KOT History. The payment-only Proceed flow (from KOT History) is
            // still responsible for promoting the order to a normal sale by
            // setting sale_process to "Add" above.
            if (isKotOrderEditFlow) {
                sale_process = 'KOT';
            }

            var isKotEditFlow = (isKotPaymentOnlyFlow || isKotOrderEditFlow);

            // Flag to track KOT sales that have been proceeded to sales history
            // This will be used to hide edit actions for these sales
            var wasKotProceeded = false;
            if (isKotPaymentOnlyFlow) {
                wasKotProceeded = true;
            }

            var editTableNumber = '';
            var editPersonCount = '';
            var editDineType = '';
            if (isKotEditFlow) {
                if (isKotOrderEditFlow) {
                    editTableNumber = PosnicPro.kotorder.kotTableNumber || '';
                    editPersonCount = PosnicPro.kotorder.kotPersonCount || '';
                    editDineType = (PosnicPro.kotorder && PosnicPro.kotorder.kotOrderType)
                        ? PosnicPro.kotorder.kotOrderType
                        : dineType;
                } else if (isKotPaymentOnlyFlow) {
                    if (PosnicPro.sales.selectedTable && PosnicPro.sales.selectedTable.tableNumber) {
                        editTableNumber = PosnicPro.sales.selectedTable.tableNumber;
                    } else if (PosnicPro.sales.EditRecentSaleParams && PosnicPro.sales.EditRecentSaleParams.table_number != null) {
                        editTableNumber = PosnicPro.sales.EditRecentSaleParams.table_number;
                    }
                    if (PosnicPro.sales.selectedPerson) {
                        editPersonCount = PosnicPro.sales.selectedPerson;
                    } else if (PosnicPro.sales.EditRecentSaleParams && PosnicPro.sales.EditRecentSaleParams.person_count != null) {
                        editPersonCount = PosnicPro.sales.EditRecentSaleParams.person_count;
                    } else if (PosnicPro.kotorder && PosnicPro.kotorder.kotPersonCount) {
                        editPersonCount = PosnicPro.kotorder.kotPersonCount;
                    }
                    editDineType = dineType;
                }
            }

            // Prepare denomination data for edit
            let denominationDataEdit = [];
            if (PosnicPro.sales.denominationCounts) {
                for (let denom in PosnicPro.sales.denominationCounts) {
                    let count = PosnicPro.sales.denominationCounts[denom] || 0;
                    if (count > 0) {
                        denominationDataEdit.push({
                            cash: denom.toString(),
                            value: count.toString(),
                            amount: (parseFloat(denom) * count).toString()
                        });
                    }
                }
            }
            
            var dataEdit = {
                sale_process: sale_process,
                date: $('#time-format').val(),
                sales_sub_total: editSalesSubTotal,
                sales_total: $("#grand_total").val(),
                customer_id: $('#sales_new_customer_id').val(),
                customer_name: ($('#sales_new_customer_name').val() === '') ? 'Anonymous' : $('#sales_new_customer_name').val(),
                customer_address: $('#sales_new_customer_address').val(),
                sales_id: SalesDocumentId,
                customer_phone: $('#sales_new_customer_phone').val(),
                customer_email: $('#sales_new_customer_email').val(),
                customer_state: $('#sales_new_customer_state').val(),
                customer_country: $('#sales_new_customer_country').val(),
                customer_gst_type: $('#sales_new_customer_gst_type').val(),
                customer_gst_number: $('#sales_new_customer_gst_number').val(),
                payment_mode: payment_mode_val,
                payment_description: $('#payment_description').val(),
                tax: parseFloat(String($("#tax").text() || '').replace(/,/g, '')),
                discount: String($("#discount_sale_amount").text() || '').replace(/,/g, ''),
                addInventory: false,
                items: PosnicPro.sales.addSalesLineTable,
                sales_total_company_price: editSalesCompanyPrice,
                sales_description: $('#sales_description').val(),
                discount_description: $('#discount_description').val(),
                unpaid: $('#unpaid_payment_toggle').is(':checked') ? 'false' : 'true',
                alternative_id: PosnicPro.sales.salesId,
                register_id: register_id,
                partial_balance: $('#Partial_amount').val(),
                customer_current_balance: $('#customer_current_balance').val(),
                partial_check: $("#sales_new_customer_partial_balance").val(),
                wallet_check: ($('#wallet_balance').is(":checked")) ? 'true' : 'false',
                extra_discount: parseFloat($('#extraDisc').text()),
                extra_discount_type: !$('#percentIcon').hasClass('d-none') ? "percent" : "price",
                multi_payment: payments,
                enable_multi_payment: PosnicPro.local.get('enable_multi_payment'),
                table_number: editTableNumber,
                person_count: editPersonCount,
                dine_type: editDineType,
                was_kot_proceeded: wasKotProceeded,
                denomination_values: denominationDataEdit
            };

            var paramsEdit = {
                method: 'PUT',
                url: 'sales/' + SalesDocumentId,
                data: JSON.stringify(dataEdit)
            };

            PosnicPro.sales._editDiscountRetried = false;
            var submitEditSale = function () {
            PosnicPro.request(paramsEdit, function (response) {
                if (response.type === 'success') {
                    // An edit moves stock; cached items are stale.
                    PosnicPro.sales.itemCache.clear();
                    // Normalise sale id for both legacy (string) and new (object) responses
                    var saleId = null;
                    if (response && typeof response.data !== 'undefined' && response.data !== null) {
                        if (typeof response.data === 'object') {
                            saleId = response.data.sales_id || response.data.sale_id || response.data.id || null;
                        } else {
                            saleId = String(response.data);
                        }
                    }
                    if (!saleId) {
                        saleId = String(SalesDocumentId || '');
                    }

                    $('#extraDisc').text(0);
                    $('#extraDisc').editable('setValue', 0);
                    PosnicPro.alert(response.type, response.message);
                    PosnicPro.sales.recentMenu.recentSalesTabDetails();
                    PosnicPro.sales.salesId = '';
                    (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') ? $('.changeSalesBtnText').text('புதுப்பி') : $('.changeSalesBtnText').text('Update');

    
                    // Cache proceeded KOT sale ids locally so Sales History can
                    // always hide Edit for those finalized KOT orders, even if
                    // the backend does not yet return was_kot_proceeded.
                    if (wasKotProceeded === true) {
                        try {
                            var existingKotIds = [];
                            var storedKotIds = PosnicPro.local.get('kot_proceeded_ids');
                            if (storedKotIds) {
                                existingKotIds = JSON.parse(storedKotIds);
                            }

                            // Prefer the id returned from backend; fall back to
                            // SalesDocumentId if needed.
                            var finalKotId = saleId;
                            if (existingKotIds.indexOf(finalKotId) === -1) {
                                existingKotIds.push(finalKotId);
                                PosnicPro.local.set('kot_proceeded_ids', JSON.stringify(existingKotIds));
                            }
                        } catch (e) {
                            // ignore cache errors; never block payment flow
                        }
                    }

                    if ($('.payment_mode').val() === 'Qrpay') {
                        var paramsQr = {
                            url: 'sales/qrSalePayementUpdate',
                            data: {
                                paymentid: payment.id,
                                salesid: saleId
                            }
                        };

                        PosnicPro.get(paramsQr, function (response) {
                            if (response.type === 'error') {
                                PosnicPro.alert(response.data, response.message);
                            }
                        }, function (xhr) {
                            var response = jQuery.parseJSON(xhr.responseText);
                            PosnicPro.alert(response.type, response.message);
                        });
                    }

                    /* For updating dashboard Today sales report details*/
                    if (salesAction !== 'edit') {
                    }

                    //                if (PosnicPro.local.get('balance_view') === 'true') {
                    //                    $('.salesBalanceAmount,#newsalespage').show();
                    //                    $('#sales_save_button,#tenderpage').hide();
                    //                } else {
                    //                    hasher.setHash('sales');
                    //                    $('.salesBalanceAmount').hide();
                    //                    $('#sales_save_button').show();
                    //                }
                    var phone = (response.data && response.data.phone) ? response.data.phone : '';
                    var name = (response.data && response.data.name) ? response.data.name : 'Anonymous';
                    $('.printSalesReceipt')
                        .attr('href', saleId + '/print')
                        .data('sale-id', saleId);
                    $('.smsSalesReceipt').attr('href', saleId + '/sms');
                    $('.printSalesWhatsAppReceipt').attr('href', 'javascript:void(0)').attr('onclick', `PosnicPro.sales.showWhatsAppReceipt('${saleId}', '${phone}', '${name}')`);

                    // Auto-print on KOT settlement when printall setting is enabled
                    if (isKotPaymentOnlyFlow &&
                        response &&
                        typeof response.data === 'object' &&
                        response.data.print === true &&
                        saleId) {
                        PosnicPro.sales.view.printSale(saleId, 'sale');
                    }
                    if (PosnicPro.sales.recentSaleAction === true) {
                        hasher.setHash('sales/new');
                    }

                    // KOT payment-only flow: after a successful Update from the
                    // tender screen, reuse the existing tender-close handler so that
                    // control returns to KOT page instead of staying on the /sales
                    // route. Other payment screens remain unchanged.
                    if (PosnicPro.sales.kotPaymentMode === true &&
                        PosnicPro.sales.paymentOnlyMode === true) {
                        if (typeof hasher !== 'undefined') {
                            hasher.setHash('kot');
                        } else {
                            window.location.hash = '#/kot';
                        }
                        // Refresh both left and right panels after redirect
                        setTimeout(function () {
                            if (PosnicPro.kot && typeof PosnicPro.kot.refreshKOTData === 'function') {
                                PosnicPro.kot.refreshKOTData();
                            }
                        }, 500);
                    } else {
                        // Dedicated KOT order edit flow (kotsales/{id}/edit): once the
                        // order is updated successfully, navigate back to the KOT
                        // History list instead of leaving the user on the KOT edit
                        // screen.
                        var isKotOrderEditFlow = (PosnicPro.sales &&
                            PosnicPro.sales.saleProcess === 'KOT' &&
                            PosnicPro.kotorder && PosnicPro.kotorder.editSaleId &&
                            PosnicPro.sales.paymentOnlyMode !== true);

                        if (isKotOrderEditFlow) {
                            // Refresh KOT data to show updated table list and details
                            if (PosnicPro.kot && typeof PosnicPro.kot.refreshKOTData === 'function') {
                                PosnicPro.kot.refreshKOTData();
                            } else {
                                if (typeof hasher !== 'undefined') {
                                    hasher.setHash('kot');
                                } else {
                                    window.location.hash = '#/kot';
                                }
                            }
                        } else if (!PosnicPro.sales.paymentOnlyMode && salesAction === 'edit') {
                            // Normal Edit Sale (opened from Sales History): once payment is
                            // updated successfully, return the user to the Sales History
                            // list instead of leaving them on the tender screen.
                            if (typeof hasher !== 'undefined') {
                                hasher.setHash('sales');
                            } else {
                                window.location.hash = '#/sales';
                            }
                        }
                    }

                    $('#qr_view').modal('hide');
                    db.customerDisplay.where('clear').equals('yes').delete();
                    loader.find(".loadingSpinner:first").remove();
                } else {
                    PosnicPro.alert(response.type, response.message);
                    loader.find(".loadingSpinner:first").remove();
                }
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);

                // A discount added while editing needs a manager: prompt for the
                // PIN/card, attach the token, and resubmit once.
                if (xhr.status === 403 && response
                        && /discount needs manager approval/i.test(response.message || '')
                        && !PosnicPro.sales._editDiscountRetried) {
                    PosnicPro.sales._editDiscountRetried = true;
                    loader.find(".loadingSpinner:first").remove();
                    PosnicPro.requireManagerApproval('discount_apply',
                        { prompt: "This discount needs a manager's approval." },
                        function (approval) {
                            try {
                                var d = JSON.parse(paramsEdit.data);
                                d.approval_token = approval && approval.approval_token;
                                paramsEdit.data = JSON.stringify(d);
                            } catch (e) { /* resubmit unchanged; server decides */ }
                            submitEditSale();
                        });
                    return;
                }
                PosnicPro.alert(response.type, response.message);

                // Reset payment-only flags and close tender appropriately on error
                if (PosnicPro.sales.paymentOnlyMode === true) {
                    $('.infobar-settings-sidebar-overlay').css({ 'background': 'transparent', 'position': 'initial' });
                    $('#infobar-settings-sidebar-tender-details').removeClass('sidebarview');
                    PosnicPro.sales.paymentOnlyMode = false;
                    PosnicPro.sales.originalSaleData = null;
                } else {
                    $(".infobar-settings-sidebar-overlay").css({ "background": "rgba(0,0,0,0.4)", "position": "fixed" });
                    $("#infobar-settings-sidebar-tender-details").removeClass("sidebarview");
                }
                loader.find(".loadingSpinner:first").remove();
            });
            };
            submitEditSale();
            return false;
        }
    }
};
/*********** END - EDIT ,RETURN AND EXCHANGE ***********/


PosnicPro.sales.holdSale = {
    /*Hold Sales Order*/

    holdOrderSubmit: function () {
        // walk-in sales must not be refused: fill from the cached default
        // customer when nothing was chosen (see ensureCustomer)
        if (PosnicPro.sales.ensureCustomer) { PosnicPro.sales.ensureCustomer(); }
        var customer_name = $("#sales_new_customer_name").val();
        if ($('#sales_new_items_table tbody tr').find(':nth-child(8)').text() === '' || customer_name === '') {

            if (customer_name === '') {
                $('.toggle-customer-user').css({ display: 'block' });
                $("#sales_new_customer_name").focus();
                PosnicPro.alert('error', 'Enter a customer name.');
                return false;
            }
            PosnicPro.alert('warning', 'Add at least one item.');
            $('#sales_new_item_name').focus();
            return false;
        } else {
            PosnicPro.sales.addSalesLineTable = $('#sales_new_items_table tbody tr').map(function () {
                let itemid = $(this).find(':nth-child(9)').text();
                return {
                    return: false,
                    item_status: 'Hold',
                    item_name: $('#addSalesLineItemName_' + itemid).text(),
                    item_price: $('#addSalesLineItemPrice_' + itemid).text(),
                    item_discount: $('#addSalesLineDiscountAmount_' + itemid).text(),
                    item_discount_percentage: $('#addSalesLineDiscountPercentage_' + itemid).text(),
                    item_quantity: $('#touchsale_item_qty' + itemid).val(),
                    item_available_quantity: $('#addSalesLineavailableQty_' + itemid).text(),
                    item_id: $('#addSalesLineItemId_' + itemid).text(),
                    total_amount: $('#addSalesLineTotal_' + itemid).text(),
                    barcode_id: $('#addSalesLineItemBarcodeId_' + itemid).text(),
                    company_price_total: $('#addSalesLineItemCompanyPrice_' + itemid).text(),
                    category_id: $('#saleCategoryId_' + itemid).text(),
                    category_name: $('#saleCategoryName_' + itemid).text(),
                    supplier_id: $('#saleSupplierId_' + itemid).text(),
                    supplier_name: $('#saleSupplierName_' + itemid).text(),
                    gst: $('#addSalesGstTax_' + itemid).text(),
                    track_inventory: $('#trackInventory_' + itemid).text(),
                    negative_stock: $('#negativeStock_' + itemid).text(),
                    item_price_total: $('#addSalesLineItemSellingPrice_' + itemid).text()
                };
            }).get();
            var TotalCompanyPrice = 0;
            for (var i = 0; i < PosnicPro.sales.addSalesLineTable.length; i++) {
                TotalCompanyPrice += parseInt(PosnicPro.sales.addSalesLineTable[i].company_price_total);
            }
            var partial_check_value = $("#sales_new_customer_partial_balance").val();
            var partial_check = (partial_check_value === 'Partial') ? 'true' : 'false';
            let payments = PosnicPro.sales.getPaymentObject();
            
            // Debug logging for partial payment (EDIT)
            console.log('=== FRONTEND EDIT PARTIAL PAYMENT DEBUG ===');
            console.log('partial_check_value:', partial_check_value);
            console.log('partial_check:', partial_check);
            console.log('partial_balance:', $('#Partial_amount').val());
            console.log('sales_total:', $("#grand_total").val());
            console.log('multi_payment:', payments);
            
            var SalesDocumentId = PosnicPro.sales.editSaleId;
            let register_id = PosnicPro.sales.saleRegisterId();
            var data = {
                items: PosnicPro.sales.addSalesLineTable,
                sales_total: $("#grand_total").val(),
                sales_sub_total: String($('#sales_new_subtotal').text() || '').replace(/,/g, ''),
                customer_id: $('#sales_new_customer_id').val(),
                customer_name: $('#sales_new_customer_name').val(),
                customer_address: $('#sales_new_customer_address').val(),
                customer_phone: $('#sales_new_customer_phone').val(),
                customer_email: $('#sales_new_customer_email').val(),
                customer_state: $('#sales_new_customer_state').val(),
                customer_country: $('#sales_new_customer_country').val(),
                customer_gst_type: $('#sales_new_customer_gst_type').val(),
                customer_gst_number: $('#sales_new_customer_gst_number').val(),
                sales_total_company_price: TotalCompanyPrice,
                date: $('#time-format').val(),
                tax: parseFloat(String($("#tax").text() || '').replace(/,/g, '')),
                discount: String($("#discount_sale_amount").text() || '').replace(/,/g, ''),
                payment_mode: '',
                payment_description: $('#payment_description').val(),
                partial_check: partial_check,
                partial_balance: $('#Partial_amount').val(),
                customer_current_balance: $('#customer_current_balance').val(),
                wallet_check: ($('#wallet_balance').is(":checked")) ? 'true' : 'false',
                sales_description: $('#sales_description').val(),
                discount_description: $('#discount_description').val(),
                sales_id: SalesDocumentId,
                alternative_id: PosnicPro.sales.salesId,
                register_id: register_id,
                extra_discount_type: !$('#percentIcon').hasClass('d-none') ? "percent" : "price",
                // table_id: (PosnicPro.sales.selectedTable) ? PosnicPro.sales.selectedTable.id : '',
                // table_number: (PosnicPro.sales.selectedTable) ? PosnicPro.sales.selectedTable.tableNumber : ''
            };
            var method = "POST";
            if (SalesDocumentId !== '') {
                method = 'PUT';
            }
            var params = {
                method: method,
                url: 'sales/hold',
                data: JSON.stringify(data)
            };
            PosnicPro.request(params, function (response) {
                if (response.type === 'success') {
                    PosnicPro.sales.setDefaults();
                    // The visible tab reflects the park IMMEDIATELY (owner ask) -
                    // the dispatcher refreshes whichever pane is showing.
                    PosnicPro.sales.recentMenu.recentSalesTabDetails();
                }
                PosnicPro.alert(response.type, response.message);
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
            return false;
        }
    }
};
/*********** START ADD SALES LINE ITEMS QUANTITY INCREASE & QUANTITY FUNCTION ***********/
PosnicPro.sales.quantity = {
    /*
     * How much one press of + or - is worth, and how finely to keep it.
     *
     * A counted item steps by one, which is what a button beside a quantity
     * means. An item sold by weight steps by 100g and keeps three decimals,
     * because the scale reports grams and rounding to two would lose them: a
     * reading of 0.305kg became 0.31 and the shop gave away 5g every press.
     */
    /*
     * How many decimals a quantity keeps.
     *
     * A scale reports grams, so a weight needs three: 0.375kg is 375g, and at
     * two decimals it becomes 0.38 - ten grams the shop gives away on a sale
     * and ten it never gets back on a return. Counted goods keep two, which is
     * what every other total on the receipt uses.
     *
     * A weight keeps all three even when they are zeros. Dropping them left the
     * quantity column ragged - 0.25 beside 0.1 beside 1 - because each row was
     * a different width, and a column of weights that does not line up is one
     * nobody can total by eye. 0.250, 0.100 and 1.000 all occupy the same
     * space, and the trailing zeros say "this was weighed" rather than looking
     * like a number somebody rounded.
     *
     * Counted goods still drop them, so a plain 2 does not read as 2.00 beside
     * a genuine weight.
     */
    formatQty: function (value, weighed) {
      var n = parseFloat(value);
      if (isNaN(n)) return '0';
      if (weighed === undefined || weighed) return n.toFixed(3);

      var text = n.toFixed(2);
      return text.indexOf('.') === -1 ? text : text.replace(/\.?0+$/, '');
    },

    /*
     * Put a quantity back in the box the way the column expects to see it.
     *
     * Used everywhere a value is written to a quantity input, so a weight
     * arrives at three decimals whether it came from the scale, the plus and
     * minus buttons, or somebody typing.
     */
    /*
     * Square up the quantity box for a weighed line.
     *
     * Deliberately not wired to keyup or blur. textOnChange rebuilds this input
     * on every keystroke, so a reformat triggered by typing would land in the
     * middle of the number somebody is still entering - "0.25" becomes "0.250"
     * and the next digit makes it 0.2505. Half-typed text is refused here too,
     * so ".", "0." and "" survive long enough to become a number.
     *
     * Called from the paths that set a quantity outright.
     */
    normalizeInput: function (id) {
        var box = $('#touchsale_item_qty' + id);
        if (!box.length) return;

        var raw = String(box.val());
        if (raw === '' || /\.$/.test(raw) || isNaN(parseFloat(raw))) return;

        var unit = PosnicPro.sales.quantity.stepFor(id, raw);
        if (!unit.pad) return;   // counted goods are left exactly as entered

        box.val(PosnicPro.sales.quantity.applyPrecision(raw, unit));
    },

    applyPrecision: function (value, unit) {
        if (!unit || !unit.pad) {
            return (Number.isInteger(parseFloat(value)))
                ? value
                : parseFloat(value).toFixed(unit ? unit.decimals : 2);
        }
        return PosnicPro.sales.quantity.formatQty(value, true);
    },

    stepFor: function (id, currentValue) {
        var line = PosnicPro.sales.SaleTableLineItems[id];
        if (PosnicPro.sales.isWeighedItem(line)) {
            return { step: 0.1, decimals: 3, floor: 0.001, pad: true };
        }
        // Unchanged for counted items: a whole number steps by one, and a
        // quantity someone has typed a fraction into steps finely so the
        // button does not throw the fraction away.
        var fractional = Number.isInteger(parseFloat(currentValue)) === false;
        return { step: fractional ? 0.01 : 1, decimals: 2, floor: 1 };
    },

    qtyIncreaseDecrease: function (id, action, track_inventory, negative_stock) {
        $("#save_submit").removeClass("disabled");
        var oldValue = $('#touchsale_item_qty' + id).val();
        var unit = PosnicPro.sales.quantity.stepFor(id, oldValue);
        let value;
        if (action === 1) {
            value = parseFloat(oldValue) + unit.step;
            value = PosnicPro.sales.quantity.applyPrecision(value, unit);
            var available_quantity = PosnicPro.sales.SaleTableLineItems[id].available_quantity;
            if (track_inventory === 'true' && negative_stock === 'false' && $('#instantStatus_' + id).text() !== 'ok') {
                if (PosnicPro.sales.SaleAction === 'edit') {
                    PosnicPro.get('items/' + id, function (response) {
                        if (response.type === 'success') {
                            let available = response.data.available_quantity;
                            let change = parseInt($('#returnItemChangeQuantityValue_' + id).text());
                            if ((available + change) < value) {
                                PosnicPro.alert('error', 'Items Not Available In The Stock!.');
                                $('#touchsale_item_qty' + id).val(change);
                                return false;
                            }
                        } else {
                            PosnicPro.alert(response.type, response.message);
                        }
                    }, function (xhr) {
                        let change = parseInt($('#returnItemChangeQuantityValue_' + id).text());
                        PosnicPro.alert('error', 'Items Not Available In The Stock!.');
                        $('#touchsale_item_qty' + id).val(change);
                        return false;
                    });
                } else {
                    if (available_quantity < value) {
                        PosnicPro.alert('error', 'Some items are out of stock.');
                        $('#touchsale_item_qty' + id).val(PosnicPro.sales.SaleTableLineItems[id].available_quantity);
                        return false;
                    }
                }
            }
        } else {
            $("#save_submit").removeClass("disabled");
            /*
             * Down to the floor, and no further - but the floor is not always
             * one.
             *
             * This read "if (oldValue > 1) ... else value = 1", so pressing
             * minus on a line of 0.300kg did not decline to go lower: it set
             * the quantity to 1. Three hundred grams became a kilo, and the
             * customer was charged for it. For anything sold by weight the
             * floor has to be a gram, not a kilo.
             */
            var current = parseFloat(oldValue);
            if (isNaN(current)) current = unit.floor;

            if (current - unit.step >= unit.floor) {
                value = current - unit.step;
                value = PosnicPro.sales.quantity.applyPrecision(value, unit);
            } else if (current > unit.floor) {
                // Closer to the floor than a whole step: land on it exactly
                // rather than refusing to move.
                value = PosnicPro.sales.quantity.applyPrecision(unit.floor, unit);
            } else {
                value = PosnicPro.sales.quantity.applyPrecision(current, unit);
            }
        }
        $('#touchsale_item_qty' + id).val(value);
        var ItemQty = $('#touchsale_item_qty' + id).val();
        var updatePrice = parseFloat($('#addSalesLineItemSellingPrice_' + id).text()) * ItemQty;
        var PriceDiscount = parseFloat($('#addSalesLineItemDiscount_' + id).text()) * ItemQty;
        var tax = parseFloat($('#addSalesLineItemTax_' + id).text()) * ItemQty;
        var taxType = $('#addSalesLineItemTaxType_' + id).text();
        var TaxValue = parseFloat($('#addSalesLineItemTax_' + id).text());
        var updateSalesLineTotal;
        var taxGst;
        if (PriceDiscount > 0 && tax > 0 && $('#discountSign' + id).text() !== '%') {
            var addSalesTaxValue = updatePrice - PriceDiscount;
            if (taxType === 'Exc') {
                var tax_value = (addSalesTaxValue / 100) * parseFloat(TaxValue);
                updateSalesLineTotal = addSalesTaxValue + tax_value;
                taxGst = tax_value;
            } else {
                var inclusive_price = parseFloat($('#addSalesLineItemPrice_' + id).text());
                var inclusive_tax_calculate = inclusive_price * ItemQty;
                var inclusive_tax_value = inclusive_tax_calculate - PriceDiscount;
                var inclusive_tax_total = (inclusive_tax_value / 100) * parseFloat(TaxValue);
                updateSalesLineTotal = inclusive_tax_value + inclusive_tax_total;
                taxGst = inclusive_tax_total;

            }

        } else if (PriceDiscount > 0 && tax > 0 || PriceDiscount > 0 && tax === 0 && $('#discountSign' + id).text() === '%') {

            if (taxType === 'Exc') {
                var discountValue = parseFloat($('#addSalesLineItemDiscount_' + id).text());
                var discountPercentageCalculation = updatePrice - (updatePrice * (discountValue / 100));
                updateSalesLineTotal = discountPercentageCalculation + (discountPercentageCalculation / 100) * TaxValue;
                taxGst = (discountPercentageCalculation / 100) * TaxValue;
                PriceDiscount = updatePrice * (discountValue / 100);
            } else {
                var discountValue = parseFloat($('#addSalesLineItemDiscount_' + id).text());
                updateSalesLineTotal = updatePrice - (updatePrice * (discountValue / 100));

                var inclusive_price = parseFloat($('#addSalesLineItemPrice_' + id).text()) * ItemQty;
                var itemDiscountPercentageCalculation = inclusive_price - (inclusive_price * (discountValue / 100));
                taxGst = (itemDiscountPercentageCalculation / 100) * TaxValue;
                PriceDiscount = inclusive_price * (discountValue / 100);

            }
        } else {
            if (taxType === 'Exc') {
                var tax_value = (TaxValue / 100) * parseFloat(updatePrice);
                updateSalesLineTotal = updatePrice - PriceDiscount + tax_value;
                taxGst = tax_value;
            } else {
                updateSalesLineTotal = updatePrice - PriceDiscount;
                var inclusive_price = parseFloat($('#addSalesLineItemPrice_' + id).text()) * ItemQty;
                taxGst = (inclusive_price / 100) * TaxValue;
            }

        }
        updateSalesLineTotal = Number(updateSalesLineTotal).toFixed(2);
        $('#addSalesLineTotal_' + id).text(updateSalesLineTotal);
        $('#addSalesGstTax_' + id).text(taxGst.toFixed(2));
        $('#addSalesDiscount_' + id).text(PriceDiscount.toFixed(2));
        var addLineItemQty = '<input type="text" minlength="1" maxlength="7" size="4" min="0" max="10000" class="form-control cart-qty font_size14" name="addSalesLineItemQty" id="touchsale_item_qty' + id + '" value=' + ItemQty + ' onkeyup="PosnicPro.sales.quantity.textOnChange(\'' + id + '\',\'' + track_inventory + '\',\'' + negative_stock + '\');" oninput="this.value = PosnicPro.minmax(this.value, 0, 100000)" onfocusout="PosnicPro.sales.quantity.normalizeInput(\'' + id + '\');" onkeypress="PosnicPro.validate(event)" style="width: 140px;text-align: center; max-width:120px !important;">';
        $('#touchsale_item_qty' + id).replaceWith(addLineItemQty);
        var itemRecord = [];
        itemRecord.push({ name: $('#addSalesLineItemName_' + id).text(), qty: ItemQty, price: $('#addSalesLineItemPrice_' + id).text(), discount: $('#addSalesLineItemDiscount_' + id).text(), tax: $('#addSalesLineItemTax_' + id).text(), total: updateSalesLineTotal });
        db.customerDisplay.put({ id: id, 'clear': 'yes', 'get': 'yes', items: itemRecord });
        PosnicPro.sales.calculation.salesTableRowCart();
        PosnicPro.sales.customerBalanceCheck();
        PosnicPro.sales.customerViewDisplay();
    },
    /*
     * SALES LINE ITEMS QUANTITY INCREASE & QUANTITY BASED ON KEYDOWN OF THE TEXTBOX VALUE
     */
    textOnChange: function (id, track_inventory, negative_stock) {
        var ItemQty = $('#touchsale_item_qty' + id).val();
        var available_quantity = PosnicPro.sales.SaleTableLineItems[id].available_quantity;
        if (track_inventory === 'true' && negative_stock === 'false') {

            if (PosnicPro.sales.SaleAction === 'edit') {
                PosnicPro.get('items/' + id, function (response) {
                    if (response.type === 'success') {
                        let available = response.data.available_quantity;
                        let change = parseInt($('#returnItemChangeQuantityValue_' + id).text());
                        if ((available + change) < ItemQty) {
                            PosnicPro.alert('error', 'Items Not Available In The Stock!.');
                            $('#touchsale_item_qty' + id).val(change);
                            let lineAmount = PosnicPro.sales.SaleTableLineItems[id].addSalesLineItemAmount * change;
                            let discountAmount = PosnicPro.sales.SaleTableLineItems[id].addSalesLineItemDiscountAmount;
                            let discountPercentage = PosnicPro.sales.SaleTableLineItems[id].addSalesLineItemDiscountPercentage;
                            let discountValue = (discountAmount > 0) ? (parseFloat(lineAmount) - parseFloat(discountAmount)) * change : parseFloat(lineAmount) - (parseFloat(lineAmount) * (parseFloat(discountPercentage) / 100));
                            let tax = PosnicPro.sales.SaleTableLineItems[id].tax;
                            let tax_value = (tax / 100) * parseFloat(discountValue);
                            let salesLineTotal = discountValue + tax_value;
                            $('#addSalesLineTotal_' + id).text(salesLineTotal.toFixed(2));
                            let discountCalculation = (lineAmount * (discountPercentage / 100));
                            $('#addSalesDiscount_' + id).text(discountCalculation);
                            $('#addSalesGstTax_' + id).text(tax_value);
                            var itemRecord = [];
                            itemRecord.push({ name: $('#addSalesLineItemName_' + id).text(), qty: available_quantity, price: $('#addSalesLineItemPrice_' + id).text(), discount: $('#addSalesLineItemDiscount_' + id).text(), tax: $('#addSalesLineItemTax_' + id).text(), total: salesLineTotal });
                            db.customerDisplay.put({ id: id, 'clear': 'yes', 'get': 'yes', items: itemRecord });
                            PosnicPro.sales.calculation.salesTableRowCart();
                            return false;
                        }
                    } else {
                        PosnicPro.alert(response.type, response.message);
                    }
                }, function (xhr) {
                    let change = parseInt($('#returnItemChangeQuantityValue_' + id).text());
                    PosnicPro.alert('error', 'Items Not Available In The Stock!.');
                    $('#touchsale_item_qty' + id).val(change);
                    return false;
                });
            } else {
                if (available_quantity < ItemQty) {
                    $('#touchsale_item_qty' + id).val(available_quantity);
                    let lineAmount = PosnicPro.sales.SaleTableLineItems[id].addSalesLineItemAmount * available_quantity;
                    let discountAmount = PosnicPro.sales.SaleTableLineItems[id].addSalesLineItemDiscountAmount;
                    let discountPercentage = PosnicPro.sales.SaleTableLineItems[id].addSalesLineItemDiscountPercentage;
                    let discountValue = (discountAmount > 0) ? (parseFloat(lineAmount) - parseFloat(discountAmount)) * available_quantity : parseFloat(lineAmount) - (parseFloat(lineAmount) * (parseFloat(discountPercentage) / 100));
                    let tax = PosnicPro.sales.SaleTableLineItems[id].tax;
                    let tax_value = (tax / 100) * parseFloat(discountValue);
                    let salesLineTotal = discountValue + tax_value;
                    $('#addSalesLineTotal_' + id).text(salesLineTotal.toFixed(2));
                    let discountCalculation = (lineAmount * (discountPercentage / 100));
                    $('#addSalesDiscount_' + id).text(discountCalculation);
                    $('#addSalesGstTax_' + id).text(tax_value);
                    var itemRecord = [];
                    itemRecord.push({ name: $('#addSalesLineItemName_' + id).text(), qty: available_quantity, price: $('#addSalesLineItemPrice_' + id).text(), discount: $('#addSalesLineItemDiscount_' + id).text(), tax: $('#addSalesLineItemTax_' + id).text(), total: salesLineTotal });
                    db.customerDisplay.put({ id: id, 'clear': 'yes', 'get': 'yes', items: itemRecord });
                    PosnicPro.sales.calculation.salesTableRowCart();
                    PosnicPro.alert('error', 'Some items are out of stock.');
                    return false;
                }
            }


        }

        $('#touchsale_item_qty' + id).val(ItemQty);
        var updatePrice = parseFloat($('#addSalesLineItemSellingPrice_' + id).text()) * ItemQty;
        var PriceDiscount = parseFloat($('#addSalesLineItemDiscount_' + id).text()) * ItemQty;
        var tax = parseFloat($('#addSalesLineItemTax_' + id).text()) * ItemQty;
        var taxType = $('#addSalesLineItemTaxType_' + id).text();
        var TaxValue = parseFloat($('#addSalesLineItemTax_' + id).text());
        var updateSalesLineTotal;
        var taxGst;
        if (PriceDiscount > 0 && tax > 0 && $('#discountSign' + id).text() !== '%') {
            var addSalesTaxValue = updatePrice - PriceDiscount;
            if (taxType === 'Exc') {
                var tax_value = (addSalesTaxValue / 100) * parseFloat(TaxValue);
                updateSalesLineTotal = addSalesTaxValue + tax_value;
                taxGst = tax_value;
            } else {
                var inclusive_price = parseFloat($('#addSalesLineItemPrice_' + id).text());
                var inclusive_tax_calculate = inclusive_price * ItemQty;
                var inclusive_tax_value = inclusive_tax_calculate - PriceDiscount;
                var inclusive_tax_total = (inclusive_tax_value / 100) * parseFloat(TaxValue);
                updateSalesLineTotal = inclusive_tax_value + inclusive_tax_total;
                taxGst = inclusive_tax_total;

            }

        } else if (PriceDiscount > 0 && tax > 0 || PriceDiscount > 0 && tax === 0 && $('#discountSign' + id).text() === '%') {

            if (taxType === 'Exc') {
                var discountValue = parseFloat($('#addSalesLineItemDiscount_' + id).text());
                var discountPercentageCalculation = updatePrice - (updatePrice * (discountValue / 100));
                updateSalesLineTotal = discountPercentageCalculation + (discountPercentageCalculation / 100) * TaxValue;
                taxGst = (discountPercentageCalculation / 100) * TaxValue;
                PriceDiscount = updatePrice * (discountValue / 100);
            } else {
                var discountValue = parseFloat($('#addSalesLineItemDiscount_' + id).text());
                updateSalesLineTotal = updatePrice - (updatePrice * (discountValue / 100));

                var inclusive_price = parseFloat($('#addSalesLineItemPrice_' + id).text()) * ItemQty;
                var itemDiscountPercentageCalculation = inclusive_price - (inclusive_price * (discountValue / 100));
                taxGst = (itemDiscountPercentageCalculation / 100) * TaxValue;
                PriceDiscount = inclusive_price * (discountValue / 100);
            }
        } else {
            if (taxType === 'Exc') {
                var tax_value = (TaxValue / 100) * parseFloat(updatePrice);
                updateSalesLineTotal = updatePrice - PriceDiscount + tax_value;
                taxGst = tax_value;
            } else {
                updateSalesLineTotal = updatePrice - PriceDiscount;
                var inclusive_price = parseFloat($('#addSalesLineItemPrice_' + id).text()) * ItemQty;
                taxGst = (inclusive_price / 100) * TaxValue;
            }

        }
        updateSalesLineTotal = Number(updateSalesLineTotal).toFixed(2);
        $('#addSalesLineTotal_' + id).text(updateSalesLineTotal);
        $('#addSalesGstTax_' + id).text(taxGst.toFixed(2));
        $('#addSalesDiscount_' + id).text(PriceDiscount.toFixed(2));
        var itemRecord = [];
        itemRecord.push({ name: $('#addSalesLineItemName_' + id).text(), qty: ItemQty, price: $('#addSalesLineItemPrice_' + id).text(), discount: $('#addSalesLineItemDiscount_' + id).text(), tax: $('#addSalesLineItemTax_' + id).text(), total: updateSalesLineTotal });
        db.customerDisplay.put({ id: id, 'clear': 'yes', 'get': 'yes', items: itemRecord });
        PosnicPro.sales.calculation.salesTableRowCart();
        PosnicPro.sales.customerBalanceCheck();
        PosnicPro.sales.customerViewDisplay();
    },

    //Sales return - quantity button wise return
    removeReturnRowLineItems: function (id) {
        $('#RoundOff').html('');
        if (PosnicPro.sales.return_remove === 'increment') {
            var quantityValue = $('#touchsale_item_return_qty' + id).val();
            var item_quantity = (parseFloat($('#returnSalesLineItemQty_' + id).text()) || 0) + (parseFloat(quantityValue) || 0);
        } else {
            var item_quantity = $('#touchsale_item_return_qty' + id).val();
        }
        var item_name = $('#addSalesLineItemName_' + id).text();
        var item_Unit = $('#addSalesLineItemUnit_' + id).text();
        var item_price = $('#addSalesLineItemSellingPrice_' + id).text();
        var returnCalculation = item_quantity * item_price;
        var discountCalculation = parseInt($('#addSalesLineItemDiscount_' + id).text()) * item_quantity;
        var discount = $('#addSalesLinediscountval_' + id).text();
        var discount_percentage = $('#addSalesLineDiscountPercentage_' + id).text();
        var tax = $('#addSalesLineItemTax_' + id).text();
        var ordertype = $('#salesOrderType_' + id).text();
        var discount_amount = $('#addSalesLineDiscountAmount_' + id).text();
        var item_id = $('#addSalesLineItemId_' + id).text();
        var barcode_id = $('#addSalesLineItemBarcodeId_' + id).text();
        var company_price = $('#addSalesLineItemCompanyPrice_' + id).text();
        var supplier = $('#addSalesLineItemSupplier_' + id).text();
        var category_id = $('#saleCategoryId_' + id).text();
        var category_name = $('#saleCategoryName_' + id).text();
        var supplier_id = $('#saleSupplierId_' + id).text();
        var supplier_name = $('#saleSupplierName_' + id).text();
        var removeTotal = $('#returnLineTotal_' + id).text();
        var discount_sign = $('#discountSign' + id).text();
        var tax_type = $('#addSalesLineItemTaxType_' + id).text();

        if ((discount_amount > 0)) {
            var discount_returnpercentages = '' + discount_sign + '' + discount + '';
        } else {
            var discount_returnpercentages = '' + discount + '' + discount_sign + '';

        }

        var returnSalesDiscount = (discount_amount > 0) ? discount_amount : ((parseFloat($('#addSalesLineItemPrice_' + id).text())) * (discount_percentage / 100));
        if (discount > "0" && tax > "0" && $('#discountSign' + id).text() !== '%') {
            var addSalesTaxValue = returnCalculation - discountCalculation;
            if (tax_type === "Exc") {
                var TaxValue = parseFloat($('#addSalesLineItemTax_' + id).text());
                var tax_value = (addSalesTaxValue / 100) * parseFloat(TaxValue);
                var updateSalesLineTotal = parseFloat(addSalesTaxValue) + parseFloat(tax_value);
                var taxGst = tax_value;
            } else {

                updateSalesLineTotal = addSalesTaxValue;
                var TaxValue = parseFloat($('#addSalesLineItemTax_' + id).text());
                var inclusive_price = parseFloat($('#addSalesLineItemPrice_' + id).text()) * item_quantity;
                var inclusive_discount = parseFloat($('#addSalesLineItemDiscount_' + id).text()) * item_quantity;
                var calculate_inclucive_price = inclusive_price - inclusive_discount;
                var taxGst = (calculate_inclucive_price / 100) * TaxValue;
                updateSalesLineTotal = calculate_inclucive_price + taxGst;
            }
        } else if (discount > "0" && tax > "0" && $('#discountSign' + id).text() === '%') {
            var discountValue = parseFloat($('#addSalesLineItemDiscount_' + id).text());
            var discountPercentageCalculation = returnCalculation - (returnCalculation * (discountValue / 100));
            if (tax_type === "Exc") {
                var TaxValue = parseFloat($('#addSalesLineItemTax_' + id).text());
                var updateSalesLineTotal = discountPercentageCalculation + (discountPercentageCalculation / 100) * TaxValue;
                var taxGst = (discountPercentageCalculation / 100) * TaxValue;
            } else {
                updateSalesLineTotal = discountPercentageCalculation;
                var TaxValue = parseFloat($('#addSalesLineItemTax_' + id).text());
                var inclusive_price = parseFloat($('#addSalesLineItemPrice_' + id).text()) * item_quantity;
                var inclusive_price_cal = (inclusive_price - (inclusive_price * (discountValue / 100)));
                var taxGst = (inclusive_price_cal / 100) * TaxValue;
            }

        } else {

            if (tax_type === "Exc") {
                var Tax = parseFloat($('#addSalesLineItemTax_' + id).text());
                var Tax_value = (Tax / 100) * parseFloat(returnCalculation);
                updateSalesLineTotal = parseFloat(returnCalculation) - parseFloat(discountCalculation) + parseFloat(Tax_value);
                var taxGst = parseFloat(Tax_value);
            } else {
                updateSalesLineTotal = returnCalculation;
                var inclusive_price = parseFloat($('#addSalesLineItemPrice_' + id).text()) * item_quantity;
                var TaxValue = parseFloat($('#addSalesLineItemTax_' + id).text());
                var taxGst = (inclusive_price / 100) * TaxValue;
            }

        }
        updateSalesLineTotal = Number(updateSalesLineTotal).toFixed(2);
        $('#addSalesLineTotal_' + id).text(updateSalesLineTotal);
        var items_total = $('#addSalesLineTotal_' + id).text();
        var currentLineItemTotal = $('#returnSalesIncreaseDecrease_' + id).text();
        var discountAmount = $('#addSalesLineDiscountAmount_' + id).text();
        var item_discountPercentage = $('#addSalesLineDiscountPercentage_' + id).text();
        var Discount = (discountAmount > 0) ? discountAmount : item_price * (item_discountPercentage / 100);
        var PriceDiscount = Discount * currentLineItemTotal;
        var updatePrice = item_price * currentLineItemTotal;
        var updateTotal = updatePrice - PriceDiscount;
        if (discountAmount > 0 && parseFloat(tax) > 0) {
            var salesLineTotal = Number(updatePrice).toFixed(2);
            var addSalesTaxValue = (parseFloat(tax) > 0) ? (salesLineTotal / 100) * parseFloat(tax) - PriceDiscount : '';
            var itemLineTotal = updatePrice + addSalesTaxValue;
        } else {
            var salesLineTotal = Number(updateTotal).toFixed(2);
            var addSalesTaxValue = (parseFloat(tax) > 0) ? (salesLineTotal / 100) * parseFloat(tax) : '';
            itemLineTotal = updateTotal + addSalesTaxValue;
        }
        if (tax_type === "Exc") {
            var price = parseFloat(item_price);
        } else {
            var price = item_price / ((parseFloat(tax) / 100) + 1);
        }
        item_Unit = (typeof (item_Unit) != "undefined" && item_Unit !== null) ? item_Unit : "qty";
        var rowHTMLLine = '<tr id="touch_row_return_' + id + '" class="touch-sales-hover-effect border-top pt-3"> ' +
            '    <td id="returnSalesLineItemName_' + id + '" data-id="' + item_name + '" class="font_size14" width="30%">' + item_name + '</td>' +
            '    <td id="returnSalesLineItemQty_' + id + '" class="text-center font_size14">' + item_quantity + '</td>' +
            '    <td name ="returnSalesLineItemUnit" id="returnSalesLineItemUnit_' + id + '">' + item_Unit + '</td>' +
            '    <td id="returnSalesLineItemPrice_' + id + '" class="text-center font_size14">' + price.toFixed(2) + '</td>' +
            '    <td id="returnLineItemDiscount_' + id + '" class="text-center font_size14">' + discount_returnpercentages + '</td>' +
            '    <td id="returnSalesLineItemTax_' + id + '" class="text-center font_size14">' + tax + '</td>' +
            '    <td id="returnSalesLineTotal_' + id + '" class="text-center font_size14">' + items_total + '</td>' +
            '    <td class="text-center"></td>' +
            '    <td id="returnsalesOrderType_' + id + '" style="display:none;">' + ordertype + '</td>' +
            '    <td id="returnSalesLineDiscountAmount_' + id + '" style="display:none;">' + discount_amount + '</td>' +
            '    <td id="returnSalesLineItemId_' + id + '" style="display:none;">' + item_id + '</td>' +
            '    <td id="returnSalesLineItemBarcodeId_' + id + '" style="display:none;">' + barcode_id + '</td>' +
            '    <td id="returnSalesLineItemCompanyPrice_' + id + '" style="display:none;">' + company_price + '</td>' +
            '    <td id="addSalesLineItemSupplier_' + id + '" style="display:none;">' + supplier + '</td>' +
            '    <td id="returnRemoveInLineTotal_' + id + '" style="display:none;">' + removeTotal + '</td>' +
            '    <td id="currentLineItemTotal_' + id + '" style="display:none;">' + itemLineTotal + '</td>' +
            '    <td class="text-center"><button type="button" class="btn-success-rgba mb-1" onclick="PosnicPro.sales.quantity.removeReturnLineRowItems(\'' + id + '\');"><i class="feather icon-arrow-left-circle"></i></button></td>' +
            '    <td id="discountSign' + id + '" style="display:none;">' + discount_sign + '</td>' +
            '    <td name="reSalesLinediscountval" id="reSalesLinediscountval' + id + '" style="display:none;">' + discount + '</td>' +
            '    <td id="rediscountSign' + id + '" style="display:none;">' + discount_sign + '</td>' +
            '    <td name ="reSalesLineDiscountPercentage" id="reSalesLineDiscountPercentage_' + id + '" style="display:none;">' + discount_percentage + '</td>' +
            '    <td id="value_item' + id + '" style="display:none;">' + item_quantity + '</td>' +
            '    <td id="returnSalesLineItemTaxType_' + id + '" style="display:none;"><span class="badge badge-info-inverse">' + tax_type + '</span></td>' +
            '    <td id="addSalesLineItemSellingPrice_' + id + '" style="display:none;">' + item_price + '</td>' +
            '    <td id="returnSalesLineItemDiscount_' + id + '" style="display:none;">' + discount + '<span id="discountSign' + id + '">' + discount_sign + '</td>' +
            '    <td id="saleCategoryId_' + id + '" style="display:none;">' + category_id + '</td>' +
            '    <td id="saleCategoryName_' + id + '" style="display:none;">' + category_name + '</td>' +
            '    <td id="saleSupplierId_' + id + '" style="display:none;">' + supplier_id + '</td>' +
            '    <td id="saleSupplierName_' + id + '" style="display:none;">' + supplier_name + '</td>' +
            '    <td id="returnSalesGstTax_' + id + '" style="display:none;">' + taxGst.toFixed(2) + '</td>' +
            '    <td id="returnSalesGstTax' + id + '" style="display:none;">' + taxGst.toFixed(2) + '</td>' +
            '    <td id="returnSalesDiscount_' + id + '" style="display:none;">' + Math.abs(returnSalesDiscount) + '</td>' +
            '    <td id="returnSalesDiscount' + id + '" style="display:none;">' + Math.abs(returnSalesDiscount) + '</td>' +
            '</tr>';
        if ($('table#sales_return_items_table').find('#touch_row_return_' + id).length > 0) {
            $('#touch_row_return_' + id).replaceWith(rowHTMLLine);
            $('#touch_row_return_' + id).remove();
            $('#sales_return_items_table tbody').prepend(rowHTMLLine);
        } else {
            $('#sales_return_items_table tbody').prepend(rowHTMLLine);
        }
        PosnicPro.sales.addLineTable = $('#sales_return_items_table tbody tr').map(function () {
            let itemid = $(this).find(':nth-child(11)').text();
            return {
                return_total: $('#returnSalesLineTotal_' + itemid).text(),
                return_gst_tax_total: $('#returnSalesGstTax' + itemid).text(),
                subtotalamount: $('#returnSalesLineItemPrice_' + itemid).text() * $('#returnSalesLineItemQty_' + itemid).text(),
                discountamount: $('#returnSalesDiscount' + itemid).text() * $('#returnSalesLineItemQty_' + itemid).text(),
                id: itemid
            };
        }).get();
        var addSalesSubTotal = 0;
        var addSalesGrandTotal = 0;
        var returnSalesGstTax = 0;
        var addSaleLineDiscountTotal = 0;
        for (var i = 0; i < PosnicPro.sales.addLineTable.length; i++) {
            addSalesSubTotal += parseFloat(PosnicPro.sales.addLineTable[i].subtotalamount);
            addSalesGrandTotal += parseFloat(PosnicPro.sales.addLineTable[i].return_total);
            returnSalesGstTax += parseFloat(PosnicPro.sales.addLineTable[i].return_gst_tax_total);
            addSaleLineDiscountTotal += parseFloat(PosnicPro.sales.addLineTable[i].discountamount);
        }
        $('#refund_subtotal').number(addSalesSubTotal, 2);
        PosnicPro.sales.calculation.returnDiscoundCalculation(addSalesGrandTotal);
        $('#sales_tax_return_value').number(returnSalesGstTax, 2);
        $('.sales_discount_return_value').number(addSaleLineDiscountTotal, 2);

        $('.tax-sales-line-total').number((addSalesGrandTotal - returnSalesGstTax), 2);

        $('#touch_row_' + id).remove();
        $('table#sales_return_items_table tr#sales_new_tablerow_content_area').remove();
        var removeCount = PosnicPro.sales.addLineTable = $('#sales_new_items_table tbody tr').map(function () {
            var itemid = $(this).find(':nth-child(8)').text();
            return itemid;
        }).length;
        if (removeCount === 0) {
            $('#sales_new_items_table tbody').append('<tr class="sales_new_tablerow_content_area" id="sales_new_tablerow_content_area"><td colspan="8"><div class="text-center text-dark"> <p class="table_cart_content"><lang class="lang_sale_empty">Sale Order Empty</lang> </p></div><img src="static/images/general/wallet.svg" class="img-fluid sales-cart-image" style="opacity: 0.4;width: 100%;" alt="wallet"></td></tr>');
            var imgHeight = $(window).height() - 500;
            $('.sales-cart-image').height(imgHeight);
            $("#save_submit").removeClass("disabled");
            $("#return_button").attr("disabled", true);
            $('#check_button').removeAttr("disabled");
        }
    },

    removeReturnsalesLineRowItems: function (id) {
        ($('#returnSalesLineItemQty_' + id).text() !== '') ? PosnicPro.sales.return_remove = 'increment' : PosnicPro.sales.return_remove = 'remove';
        $("#save_submit,#check_button,#return_button").removeAttr("disabled");
        $('table#sales_return_items_table tr#sales_new_tablerow_content_area').remove();
        PosnicPro.sales.quantity.removeReturnRowLineItems(id);
        if (PosnicPro.sales.EditRecentSaleParams.payment_pending > 0) {
            $('#check_button').attr('disabled', true);
        } else {
            $('#check_button').attr('disabled', false);
        }
    },

    removeReturnLineRowItems: function (id) {
        $('#RoundOff').html('');
        $('table#sales_new_items_table tbody tr#sales_new_tablerow_content_area').remove();
        var item_name = $('#returnSalesLineItemName_' + id).text();
        var item_Unit = $('#returnSalesLineItemUnit_' + id).text();
        var return_table = $('#value_item' + id).text();
        var quan = ($('#returndecreSales_' + id).text() > 0) ? $('#returndecreSales_' + id).text() : 0;
        var total_quant = parseFloat(return_table) + parseFloat(quan);
        var itemLineprice = $('#returnSalesLineItemPrice_' + id).text();
        var item_price = $('#addSalesLineItemSellingPrice_' + id).text();
        var discountCalculation = parseFloat($('#returnSalesLineItemDiscount_' + id).text()) * total_quant;
        var discount = $('#reSalesLinediscountval' + id).text();
        var tax = $('#returnSalesLineItemTax_' + id).text();
        var discount_amount = $('#returnSalesLineDiscountAmount_' + id).text();
        var discount_percentage = $('#reSalesLineDiscountPercentage_' + id).text();
        var company_price = $('#returnSalesLineItemCompanyPrice_' + id).text();
        var barcode_id = $('#returnSalesLineItemBarcodeId_' + id).text();
        var supplier = $('#addSalesLineItemSupplier_' + id).text();
        var category_id = $('#saleCategoryId_' + id).text();
        var category_name = $('#saleCategoryName_' + id).text();
        var supplier_id = $('#saleSupplierId_' + id).text();
        var supplier_name = $('#saleSupplierName_' + id).text();
        var returnqty = 0;
        var returnCalculation = total_quant * item_price;
        var addiscount_sign = $('#rediscountSign' + id).text();
        var tax_type = $('#returnSalesLineItemTaxType_' + id).text();
        var updateSalesLineTotal;

        if ((discount_amount > 0)) {
            var discount_returnpercentages = '' + addiscount_sign + '' + discount + '';
        } else {
            var discount_returnpercentages = '' + discount + '' + addiscount_sign + '';

        }

        var returnSalesDiscount = (discount_amount > 0) ? discount_amount : ((parseFloat($('#returnSalesLineItemPrice_' + id).text())) * (discount_percentage / 100));
        if (discount > "0" && tax > "0" && $('#rediscountSign' + id).text() !== '%') {
            var addSalesTaxValue = returnCalculation - discountCalculation;
            if (tax_type === "Exc") {
                var TaxValue = parseFloat($('#returnSalesLineItemTax_' + id).text());
                var tax_value = (addSalesTaxValue / 100) * parseFloat(TaxValue);
                updateSalesLineTotal = parseFloat(addSalesTaxValue) + parseFloat(tax_value);
                var taxGst = tax_value;
            } else {
                var TaxValue = parseFloat($('#returnSalesLineItemTax_' + id).text());
                var inclusive_price = parseFloat($('#returnSalesLineItemPrice_' + id).text()) * total_quant;
                var inclusive_discount = parseFloat($('#returnSalesLineDiscountAmount_' + id).text()) * total_quant;
                var calculate_inclucive_price = inclusive_price - inclusive_discount;
                var taxGst = (calculate_inclucive_price / 100) * TaxValue;
                updateSalesLineTotal = calculate_inclucive_price + taxGst;
            }
        } else if (discount > "0" && tax > "0" && $('#discountSign' + id).text() === '%') {
            var discountValue = parseFloat($('#reSalesLinediscountval' + id).text());
            var discountPercentageCalculation = returnCalculation - (returnCalculation * (discountValue / 100));
            if (tax_type === "Exc") {
                var TaxValue = parseFloat($('#returnSalesLineItemTax_' + id).text());
                updateSalesLineTotal = discountPercentageCalculation + (discountPercentageCalculation / 100) * TaxValue;
                var taxGst = (discountPercentageCalculation / 100) * TaxValue;
            } else {
                updateSalesLineTotal = discountPercentageCalculation;
                var TaxValue = parseFloat($('#returnSalesLineItemTax_' + id).text());
                var inclusive_price = parseFloat($('#returnSalesLineItemPrice_' + id).text()) * total_quant;
                var inclusive_price_cal = (inclusive_price - (inclusive_price * (discountValue / 100)));
                var taxGst = (inclusive_price_cal / 100) * TaxValue;
            }

        } else {

            if (tax_type === "Exc") {
                var Tax = parseFloat($('#returnSalesLineItemTax_' + id).text());
                var Tax_value = (Tax / 100) * parseFloat(returnCalculation);
                updateSalesLineTotal = parseFloat(returnCalculation) - parseFloat(discountCalculation) + parseFloat(Tax_value);
                var taxGst = parseFloat(Tax_value);
            } else {
                updateSalesLineTotal = returnCalculation;
                var inclusive_price = parseFloat($('#returnSalesLineItemPrice_' + id).text()) * total_quant;
                var TaxValue = parseFloat($('#returnSalesLineItemTax_' + id).text());
                var taxGst = (inclusive_price / 100) * TaxValue;
            }

        }
        item_Unit = (typeof (item_Unit) != "undefined" && item_Unit !== null) ? item_Unit : "qty";
        updateSalesLineTotal = Number(updateSalesLineTotal).toFixed(2);
        var addLineItemQty = '<div class="input-group">' +
            '<div class="input-group-prepend" id = ' + id + '  onclick="PosnicPro.sales.quantity.qtyreturnDecrease(this.id,0);">' +
            '<span class="button_qty_check btn btn-secondary-rgba"><i class="feather icon-minus"></i></span>' +
            '</div>' +
            '<input type="text" class="form-control cart-qty font_size14" style="text-align:center;background-color:#fff;" minlength="1" maxlength="7" size="4" min="0" max="10000" name="addSalesLineItemQty" id="touchsale_item_return_qty' + id + '" value=' + total_quant + ' onfocusout="PosnicPro.sales.quantity.returntextOnChange(\'' + id + '\');" oninput="this.value = PosnicPro.minmax(this.value, 0, 100000)" onkeypress="PosnicPro.validate(event)">' +
            '<div class="input-group-append" id = ' + id + '  onclick="PosnicPro.sales.quantity.qtyreturnDecrease(this.id,1);">' +
            '<span class="btn btn-success-rgba button_qty_check"><i class="feather icon-plus"></i></span>' +
            '</div>' +
            '</div>';
        var removeLineItem = '<button type="button" class="btn-danger-rgba mb-1" onclick="PosnicPro.sales.quantity.removeReturnsalesLineRowItems(\'' + id + '\');"><i class="feather icon-arrow-right-circle"></i></button>';
        var rowHTMLLine = '<tr id="touch_row_' + id + '" class="touch-sales-hover-effect border-top pt-3"> ' +
            '    <td id="addSalesLineItemName_' + id + '" class="font_size14" data-id="' + item_name + '" width="30%">' + item_name + '</td>' +
            '    <td id="addSalesLineItemQty_' + id + '" class="text-center add_circle font_size14">' + addLineItemQty + '</td>' +
            '    <td name ="addSalesLineItemUnit" id="addSalesLineItemUnit_' + id + '">' + item_Unit + '</td>' +
            '    <td name ="addSalesLineItemPrice" id="addSalesLineItemPrice_' + id + '" class="text-center font_size14">' + itemLineprice + '</td>' +
            '    <td name ="addSalesLineItemDiscount" id="addreturnLineItemDiscount_' + id + '" class="text-center font_size14">' + discount_returnpercentages + '</td>' +
            '    <td name="addSalesLineItemTax" id="addSalesLineItemTax_' + id + '" class="text-center font_size14">' + tax + '</td>' +
            '    <td name ="addSalesLineTotal" id="addSalesLineTotal_' + id + '" class="text-center font_size14">' + updateSalesLineTotal + '</td>' +
            '    <td id="addSalesRemoveLineItem_' + id + '" class="text-center font_size14">' + removeLineItem +
            '    </td>' +
            '    <td name="addSalesLineItemId" id="addSalesLineItemId_' + id + '" style="display:none;">' + id + '</td>' +
            '    <td name="addSalesLineItemCompanyPrice"  id="addSalesLineItemCompanyPrice_' + id + '" style="display:none;">' + company_price + '</td>' +
            '    <td name="addSalesLineItemBarcodeId" id="addSalesLineItemBarcodeId_' + id + '" style="display:none;">' + barcode_id + '</td>' +
            '    <td name="addSalesLineItemSupplier" id="addSalesLineItemSupplier_' + id + '" style="display:none;">' + supplier + '</td>' +
            '    <td name="addSalesLineDiscountPercentage" id="addSalesLineDiscountPercentage_' + id + '" style="display:none;">' + discount_percentage + '</td>' +
            '    <td name="addSalesLineDiscountAmount" id="addSalesLineDiscountAmount_' + id + '" style="display:none;">' + discount_amount + '</td>' +
            '    <td id="returndecreSales_' + id + '" style="display:none;">' + returnqty + '</td>' +
            '    <td id="returnSalesIncreaseDecrease_' + id + '" style="display:none;">' + returnqty + '</td>' +
            '    <td id="adddiscountSign' + id + '" style="display:none;">' + addiscount_sign + '</td>' +
            '    <td name="addSalesLinediscountval" id="addSalesLinediscountval_' + id + '" style="display:none;">' + discount + '</td>' +
            '    <td id="returnitemQuantity_' + id + '" style="display:none;">' + total_quant + '</td>' +
            '    <td id="returnTotal_' + id + '" style="display:none;">0</td>' +
            '    <td name ="addSalesLineItemDiscount" id="addSalesLineItemDiscount_' + id + '" style="display:none;">' + discount + '<span id="discountSign' + id + '">' + addiscount_sign + '</span></td>' +
            '    <td id="addSalesLineItemTaxType_' + id + '" style="display:none;"><span class="badge badge-info-inverse">' + tax_type + '</span></td>' +
            '    <td id="addSalesLineItemSellingPrice_' + id + '" style="display:none;">' + $('#addSalesLineItemSellingPrice_' + id).text() + '</td>' +
            '    <td id="saleCategoryId_' + id + '" style="display:none;">' + category_id + '</td>' +
            '    <td id="saleCategoryName_' + id + '" style="display:none;">' + category_name + '</td>' +
            '    <td id="saleSupplierId_' + id + '" style="display:none;">' + supplier_id + '</td>' +
            '    <td id="saleSupplierName_' + id + '" style="display:none;">' + supplier_name + '</td>' +
            '    <td id="addSalesGstTax_' + id + '" style="display:none;">' + taxGst.toFixed(2) + '</td>' +
            '    <td id="returnSalesGstTax_' + id + '" style="display:none;">0.00</td>' +
            '    <td id="returnItemChangeQuantityValue_' + id + '" style="display:none;">' + total_quant.toFixed(2) + '</td>' +
            '    <td id="returnSalesDiscount_' + id + '" style="display:none;">' + Math.abs(returnSalesDiscount) + '</td>' +
            '    <td id="returnSalesDiscount' + id + '" style="display:none;">' + Math.abs(returnSalesDiscount) + '</td>' +
            '</tr>';
        if ($('table#sales_new_items_table').find('#touch_row_' + id).length > 0) {
            $('#touch_row_' + id).replaceWith(rowHTMLLine);
            $('#touch_row_' + id).remove();
            $('#sales_new_items_table tbody').prepend(rowHTMLLine);
        } else {
            $('#sales_new_items_table tbody').prepend(rowHTMLLine);
        }
        $('#touch_row_return_' + id).remove();
        PosnicPro.sales.addLineTable = $('#sales_return_items_table tbody tr').map(function () {
            var itemid = $(this).find(':nth-child(11)').text();
            return {
                return_total: $('#returnSalesLineTotal_' + itemid).text(),
                return_gst_tax_total: $('#returnSalesGstTax_' + itemid).text(),
                subtotalamount: $('#returnSalesLineItemPrice_' + itemid).text() * $('#returnSalesLineItemQty_' + itemid).text(),
                discountamount: $('#returnSalesDiscount_' + itemid).text() * $('#returnSalesLineItemQty_' + itemid).text()
            };
        }).get();
        var addSalesSubTotal = 0;
        var addSalesGrandTotal = 0;
        var returnSalesGstTax = 0;
        var addSaleLineDiscountTotal = 0;
        for (var i = 0; i < PosnicPro.sales.addLineTable.length; i++) {
            addSalesSubTotal += parseFloat(PosnicPro.sales.addLineTable[i].subtotalamount);
            returnSalesGstTax += parseFloat(PosnicPro.sales.addLineTable[i].return_gst_tax_total);
            addSalesGrandTotal += parseFloat(PosnicPro.sales.addLineTable[i].return_total);
            addSaleLineDiscountTotal += parseFloat(PosnicPro.sales.addLineTable[i].discountamount);
        }
        $('#return_button').removeAttr("disabled");


        addSalesSubTotal = Number(addSalesSubTotal).toFixed(2);
        $('#refund_subtotal').number(addSalesSubTotal, 2);
        $('#sales_tax_return_value').number(returnSalesGstTax, 2);
        $('.sales_discount_return_value').number(addSaleLineDiscountTotal, 2);
        $('.tax-sales-line-total').number((addSalesSubTotal - returnSalesGstTax), 2);
        PosnicPro.sales.calculation.returnDiscoundCalculation(addSalesGrandTotal);
        var removeCount = PosnicPro.sales.addLineReturnTable = $('#sales_return_items_table tbody tr').map(function () {
            var itemid = $(this).find(':nth-child(11)').text();
            return itemid;
        }).length;
        if (removeCount === 0) {
            $('#extraDisc').text(0);
            $('#extraDisc').editable('setValue', 0);
            $("#save_submit,#check_button").attr("disabled", true);
            $('#sales_return_items_table tbody').append('<tr class="sales_new_tablerow_content_area" id="sales_new_tablerow_content_area"><td colspan="9"><div class="text-center text-dark"> <p class="table_cart_content"><lang class="lang_empty_return">Return Items Order Empty</lang></p></div><img src="static/images/general/wallet.svg" class="img-fluid sales-cart-image" style="opacity: 0.4;width: 100%;" alt="wallet"></td></tr>');
            var imgHeight = $(window).height() - 500;
            $('.sales-cart-image').height(imgHeight);
        }
    },
    removeReturnAllLineRowItems: function () {
        $('#RoundOff').html('');
        $("#save_submit").removeClass("disabled");
        $("#return_button").attr("disabled", true);
        $('#check_button').removeAttr("disabled");
        PosnicPro.sales.addLineTable = $('#sales_new_items_table tbody tr').map(function () {
            var id = $(this).find(':nth-child(9)').text();
            var value_product = $('#returnItemChangeQuantityValue_' + id).text();
            var item_name = $('#addSalesLineItemName_' + id).text();
            var item_Unit = $('#addSalesLineItemUnit_' + id).text();
            var item_quantity = $('#touchsale_item_return_qty' + id).val();
            var item_return_quantity = ($('#returnSalesLineItemQty_' + id).text() !== '') ? $('#returnSalesLineItemQty_' + id).text() : $('#returndecreSales_' + id).text();
            var item_return_all_quantity = parseFloat(item_quantity) + parseFloat(item_return_quantity);
            var itemLineprice = $('#addSalesLineItemPrice_' + id).text();
            var item_price = $('#addSalesLineItemSellingPrice_' + id).text();
            var returnCalculation = item_return_all_quantity * item_price;
            var discountCalculation = parseInt($('#addSalesLineItemDiscount_' + id).text()) * item_return_all_quantity;
            var discount = $('#addSalesLinediscountval_' + id).text();
            var discount_sign = $('#discountSign' + id).text();
            var discount_percentage = $('#addSalesLineDiscountPercentage_' + id).text();
            var tax = $('#addSalesLineItemTax_' + id).text();
            var ordertype = $('#salesOrderType_' + id).text();
            var discount_amount = $('#addSalesLineDiscountAmount_' + id).text();
            var item_id = $('#addSalesLineItemId_' + id).text();
            var barcode_id = $('#addSalesLineItemBarcodeId_' + id).text();
            var company_price = $('#addSalesLineItemCompanyPrice_' + id).text();
            var supplier = $('#addSalesLineItemSupplier_' + id).text();
            var category_id = $('#saleCategoryId_' + id).text();
            var category_name = $('#saleCategoryName_' + id).text();
            var supplier_id = $('#saleSupplierId_' + id).text();
            var supplier_name = $('#saleSupplierName_' + id).text();
            var removeTotal = $('#returnLineTotal_' + id).text();
            var tax_type = $('#addSalesLineItemTaxType_' + id).text();
            if ((discount_amount > 0)) {
                var discount_returnpercentages = '' + discount_sign + '' + discount + '';
            } else {
                var discount_returnpercentages = '' + discount + '' + discount_sign + '';

            }

            var returnSalesDiscount = (discount_amount > 0) ? discount_amount : itemLineprice * (discount_percentage / 100);
            if (discount > "0" && tax > "0" && $('#discountSign' + id).text() !== '%') {
                var addSalesTaxValue = returnCalculation - discountCalculation;
                if (tax_type === "Exc") {
                    var TaxValue = parseFloat($('#addSalesLineItemTax_' + id).text());
                    var tax_value = (addSalesTaxValue / 100) * parseFloat(TaxValue);
                    var updateSalesLineTotal = parseFloat(addSalesTaxValue) + parseFloat(tax_value);
                    var taxGst = tax_value;
                } else {

                    updateSalesLineTotal = addSalesTaxValue;
                    var TaxValue = parseFloat($('#addSalesLineItemTax_' + id).text());
                    var inclusive_price = parseFloat($('#addSalesLineItemPrice_' + id).text()) * item_quantity;
                    var inclusive_discount = parseFloat($('#addSalesLineItemDiscount_' + id).text()) * item_quantity;
                    var calculate_inclucive_price = inclusive_price - inclusive_discount;
                    var taxGst = (calculate_inclucive_price / 100) * TaxValue;
                    updateSalesLineTotal = calculate_inclucive_price + taxGst;
                }
            } else if (discount > "0" && tax > "0" && $('#discountSign' + id).text() === '%') {
                var discountValue = parseFloat($('#addSalesLineItemDiscount_' + id).text());
                var discountPercentageCalculation = returnCalculation - (returnCalculation * (discountValue / 100));
                if (tax_type === "Exc") {
                    var TaxValue = parseFloat($('#addSalesLineItemTax_' + id).text());
                    var updateSalesLineTotal = discountPercentageCalculation + (discountPercentageCalculation / 100) * TaxValue;
                    var taxGst = (discountPercentageCalculation / 100) * TaxValue;
                } else {
                    updateSalesLineTotal = discountPercentageCalculation;
                    var TaxValue = parseFloat($('#addSalesLineItemTax_' + id).text());
                    var inclusive_price = parseFloat($('#addSalesLineItemPrice_' + id).text()) * item_quantity;
                    var inclusive_price_cal = (inclusive_price - (inclusive_price * (discountValue / 100)));
                    var taxGst = (inclusive_price_cal / 100) * TaxValue;
                }

            } else {

                if (tax_type === "Exc") {
                    var Tax = parseFloat($('#addSalesLineItemTax_' + id).text());
                    var Tax_value = (Tax / 100) * parseFloat(returnCalculation);
                    updateSalesLineTotal = parseFloat(returnCalculation) - parseFloat(discountCalculation) + parseFloat(Tax_value);
                    var taxGst = parseFloat(Tax_value);
                } else {
                    updateSalesLineTotal = returnCalculation;
                    var inclusive_price = parseFloat($('#addSalesLineItemPrice_' + id).text()) * item_quantity;
                    var TaxValue = parseFloat($('#addSalesLineItemTax_' + id).text());
                    var taxGst = (inclusive_price / 100) * TaxValue;
                }

            }

            updateSalesLineTotal = Number(updateSalesLineTotal).toFixed(2);
            item_Unit = (typeof (item_Unit) != "undefined" && item_Unit !== null) ? item_Unit : "qty";
            $('#addSalesLineTotal_' + id).text(updateSalesLineTotal);
            var rowHTMLLine = '<tr id="touch_row_return_' + id + '" class="touch-sales-hover-effect border-top pt-3"> ' +
                '    <td id="returnSalesLineItemName_' + id + '" class="font_size14" width="30%">' + item_name + '</td>' +
                '    <td id="returnSalesLineItemQty_' + id + '" class="text-center font_size14">' + item_return_all_quantity + '</td>' +
                '    <td name ="returnSalesLineItemUnit" id="returnSalesLineItemUnit_' + id + '">' + item_Unit + '</td>' +
                '    <td id="returnSalesLineItemPrice_' + id + '" class="text-center font_size14">' + itemLineprice + '</td>' +
                '    <td id="returnLineItemDiscount_' + id + '" class="text-center font_size14">' + discount_returnpercentages + '</td>' +
                '    <td id="returnSalesLineItemTax_' + id + '" class="text-center font_size14">' + tax + '</td>' +
                '    <td id="returnSalesLineTotal_' + id + '" class="text-center font_size14">' + updateSalesLineTotal + '</td>' +
                '    <td class="text-center"></td>' +
                '    <td id="returnsalesOrderType_' + id + '" style="display:none;">' + ordertype + '</td>' +
                '    <td id="returnSalesLineDiscountAmount_' + id + '" style="display:none;">' + discount_amount + '</td>' +
                '    <td id="returnSalesLineItemId_' + id + '" style="display:none;">' + item_id + '</td>' +
                '    <td id="returnSalesLineItemBarcodeId_' + id + '" style="display:none;">' + barcode_id + '</td>' +
                '    <td id="returnSalesLineItemCompanyPrice_' + id + '" style="display:none;">' + company_price + '</td>' +
                '    <td id="addSalesLineItemSupplier_' + id + '" style="display:none;">' + supplier + '</td>' +
                '    <td id="returnRemoveInLineTotal_' + id + '" style="display:none;">' + removeTotal + '</td>' +
                '    <td id="rediscountSign' + id + '" style="display:none;">' + discount_sign + '</td>' +
                '    <td name="reSalesLinediscountval" id="reSalesLinediscountval' + id + '" style="display:none;">' + discount + '</td>' +
                '    <td name="reSalesLineDiscountPercentage" id="reSalesLineDiscountPercentage_' + id + '" style="display:none;">' + discount_percentage + '</td>' +
                '    <td class="text-center"><button type="button" class="btn-success-rgba mb-1" onclick="PosnicPro.sales.quantity.removeReturnLineRowItems(\'' + id + '\');"><i class="feather icon-arrow-left-circle"></i></button></td>' +
                '    <td id="value_item' + id + '" style="display:none;">' + value_product + '</td>' +
                '    <td id="returnSalesLineItemTaxType_' + id + '" style="display:none;"><span class="badge badge-info-inverse">' + tax_type + '</span></td>' +
                '    <td id="addSalesLineItemSellingPrice_' + id + '" style="display:none;">' + item_price + '</td>' +
                '    <td id="saleCategoryId_' + id + '" style="display:none;">' + category_id + '</td>' +
                '    <td id="saleCategoryName_' + id + '" style="display:none;">' + category_name + '</td>' +
                '    <td id="saleSupplierId_' + id + '" style="display:none;">' + supplier_id + '</td>' +
                '    <td id="saleSupplierName_' + id + '" style="display:none;">' + supplier_name + '</td>' +
                '    <td id="returnSalesLineItemDiscount_' + id + '" style="display:none;">' + discount + '<span id="discountSign' + id + '">' + discount_sign + '</td>' +
                '    <td id="returnSalesGstTax_' + id + '" style="display:none;">' + taxGst.toFixed(2) + '</td>' +
                '    <td id="returnSalesDiscount_' + id + '" style="display:none;">' + Math.abs(returnSalesDiscount) + '</td>' +
                '</tr>';
            if ($('table#sales_return_items_table').find('#touch_row_return_' + id).length > 0) {
                $('#touch_row_return_' + id).replaceWith(rowHTMLLine);
                $('#touch_row_return_' + id).remove();
                $('#sales_return_items_table tbody').prepend(rowHTMLLine);
            } else {
                $('#sales_return_items_table tbody').prepend(rowHTMLLine);
            }
        }).get();
        PosnicPro.sales.addLineTable = $('#sales_new_items_table tbody tr').map(function () {
            var itemid = $(this).find(':nth-child(9)').text();
            return {
                return_total: $('#returnSalesLineTotal_' + itemid).text(),
                id: itemid
            };
        }).get();
        for (var i = 0; i < PosnicPro.sales.addLineTable.length; i++) {
            $('#touch_row_' + PosnicPro.sales.addLineTable[i].id).remove();
            $('table#sales_return_items_table tr#sales_new_tablerow_content_area').remove();
            $("#sales_new_items_table tbody tr").remove();
            $('#sales_new_items_table tbody').append('<tr class="sales_new_tablerow_content_area" id="sales_new_tablerow_content_area"><td colspan="8"><div class="text-center text-dark"> <p class="table_cart_content"><lang class="lang_sale_empty">Sale Order Empty</lang></p></div><img src="static/images/general/wallet.svg" class="img-fluid sales-cart-image" style="opacity: 0.4;width: 100%;" alt="wallet"></td></tr>');
            var imgHeight = $(window).height() - 500;
            $('.sales-cart-image').height(imgHeight);
        }

        PosnicPro.sales.addLineReturnTable = $('#sales_return_items_table tbody tr').map(function () {
            var itemid = $(this).find(':nth-child(11)').text();
            return {
                return_total: $('#returnSalesLineTotal_' + itemid).text(),
                return_gst_tax_total: $('#returnSalesGstTax_' + itemid).text(),
                subtotalamount: $('#returnSalesLineItemPrice_' + itemid).text() * $('#returnSalesLineItemQty_' + itemid).text(),
                discountamount: $('#returnSalesDiscount_' + itemid).text() * $('#returnSalesLineItemQty_' + itemid).text()
            };
        }).get();
        var addSalesSubTotal = 0;
        var addSalesGrandTotal = 0;
        var addSaleLineDiscountTotal = 0;
        var returnSalesGstTax = 0;
        for (var i = 0; i < PosnicPro.sales.addLineReturnTable.length; i++) {
            addSalesSubTotal += parseFloat(PosnicPro.sales.addLineReturnTable[i].subtotalamount);
            returnSalesGstTax += parseFloat(PosnicPro.sales.addLineReturnTable[i].return_gst_tax_total);
            addSalesGrandTotal += parseFloat(PosnicPro.sales.addLineReturnTable[i].return_total);
            addSaleLineDiscountTotal += parseFloat(PosnicPro.sales.addLineReturnTable[i].discountamount);
        }

        addSalesSubTotal = Number(addSalesSubTotal).toFixed(2);
        $('#refund_subtotal').number(addSalesSubTotal, 2);
        $('#sales_tax_return_value').number(returnSalesGstTax, 2);
        $('.sales_discount_return_value').number(addSaleLineDiscountTotal, 2);
        $('.tax-sales-line-total').number((addSalesSubTotal - returnSalesGstTax), 2);
        PosnicPro.sales.calculation.returnDiscoundCalculation(addSalesGrandTotal);
        if (PosnicPro.sales.EditRecentSaleParams.payment_pending > 0) {
            $('#check_button').attr('disabled', true);
        } else {
            $('#check_button').attr('disabled', false);
        }
    },
    //    return sale add new line of return table    
    returnSaleLineItem: function (id) {
        var item_name = $('#addSalesLineItemName_' + id).text();
        var item_quantity = $('#returndecreSales_' + id).text();
        var item_price = $('#addSalesLineItemPrice_' + id).text();
        var item_unit = $('#addSalesLineItemUnit_' + id).text();
        var itemLineprice = $('#addSalesLineItemSellingPrice_' + id).text();
        var discount = $('#addSalesLinediscountval_' + id).text();
        var discount_sign = $('#discountSign' + id).text();

        var tax = $('#addSalesLineItemTax_' + id).text();
        var tax_type = $('#addSalesLineItemTaxType_' + id).text();
        var ordertype = $('#salesOrderType_' + id).text();
        var discount_amount = $('#addSalesLineDiscountAmount_' + id).text();
        var item_id = $('#addSalesLineItemId_' + id).text();
        var barcode_id = $('#addSalesLineItemBarcodeId_' + id).text();
        var company_price = $('#addSalesLineItemCompanyPrice_' + id).text();
        var supplier = $('#addSalesLineItemSupplier_' + id).text();
        var category_id = $('#saleCategoryId_' + id).text();
        var category_name = $('#saleCategoryName_' + id).text();
        var supplier_id = $('#saleSupplierId_' + id).text();
        var supplier_name = $('#saleSupplierName_' + id).text();
        var removeTotal = $('#returnLineTotal_' + id).text();
        var lineTotal = $('#returnTotal_' + id).text();
        var return_sales_gst_tax = $('#returnSalesGstTax_' + id).text();
        var returnSalesDiscount = parseFloat($('#returnSalesDiscount_' + id).text());
        var value_product = $('#touchsale_item_return_qty' + id).val();
        if ((discount_amount > 0)) {
            var discount_percentages = '' + discount_sign + '' + discount + '';
        } else {
            var discount_percentages = '' + discount + '' + discount_sign + '';

        }
        item_unit = (typeof (item_unit) != "undefined" && item_unit !== null) ? item_unit : "qty";
        var rowHTMLLine = '<tr id="touch_row_return_' + id + '" class="touch-sales-hover-effect border-top pt-3"> ' +
            '    <td id="returnSalesLineItemName_' + id + '" class="font_size14" width="30%">' + item_name + '</td>' +
            '    <td id="returnSalesLineItemQty_' + id + '" class="text-center font_size14">' + item_quantity + '</td>' +
            '    <td id="returnSalesLineItemUnit_' + id + '" class="text-center font_size14">' + item_unit + '</td>' +
            '    <td id="returnSalesLineItemPrice_' + id + '" class="text-center font_size14">' + item_price + '</td>' +
            '    <td id="returnLineItemDiscount_' + id + '" class="text-center font_size14">' + discount_percentages + '</td>' +
            '    <td id="returnSalesLineItemTax_' + id + '" class="text-center font_size14">' + tax + '</td>' +
            '    <td id="returnSalesLineTotal_' + id + '" class="text-center font_size14">' + lineTotal + '</td>' +
            '    <td class="text-center"></td>' +
            '    <td id="returnsalesOrderType_' + id + '" style="display:none;">' + ordertype + '</td>' +
            '    <td id="returnSalesLineDiscountAmount_' + id + '" style="display:none;">' + discount_amount + '</td>' +
            '    <td id="returnSalesLineItemId_' + id + '" style="display:none;">' + item_id + '</td>' +
            '    <td id="returnSalesLineItemBarcodeId_' + id + '" style="display:none;">' + barcode_id + '</td>' +
            '    <td id="returnSalesLineItemCompanyPrice_' + id + '" style="display:none;">' + company_price + '</td>' +
            '    <td id="addSalesLineItemSupplier_' + id + '" style="display:none;">' + supplier + '</td>' +
            '    <td id="returnRemoveInLineTotal_' + id + '" style="display:none;">' + removeTotal + '</td>' +
            '    <td id="currentLineItemTotal_' + id + '" style="display:none;">' + lineTotal + '</td>' +
            '    <td id="rediscountSign' + id + '" style="display:none;">' + discount_sign + '</td>' +
            '    <td name="reSalesLinediscountval" id="reSalesLinediscountval' + id + '" style="display:none;">' + discount + '</td>' +
            '    <td class="text-center"><button type="button" class="btn-success-rgba mb-1" onclick="PosnicPro.sales.quantity.removeReturnLineRowItems(\'' + id + '\');"><i class="feather icon-arrow-left-circle"></i></button></td>' +
            '    <td id="value_item' + id + '" style="display:none;">' + value_product + '</td>' +
            '    <td id="returnSalesLineItemTaxType_' + id + '" style="display:none;"><span class="badge badge-info-inverse">' + tax_type + '</span></td>' +
            '    <td id="addSalesLineItemSellingPrice_' + id + '" style="display:none;">' + itemLineprice + '</td>' +
            '    <td id="saleCategoryId_' + id + '" style="display:none;">' + category_id + '</td>' +
            '    <td id="saleCategoryName_' + id + '" style="display:none;">' + category_name + '</td>' +
            '    <td id="saleSupplierId_' + id + '" style="display:none;">' + supplier_id + '</td>' +
            '    <td id="returnSalesLineItemDiscount_' + id + '" style="display:none;">' + discount + '<span id="discountSign' + id + '">' + discount_sign + '</td>' +
            '    <td id="saleSupplierName_' + id + '" style="display:none;">' + supplier_name + '</td>' +
            '    <td id="returnSalesGstTax_' + id + '" style="display:none;">' + return_sales_gst_tax + '</td>' +
            '    <td id="returnSalesDiscount_' + id + '" style="display:none;">' + Math.abs(returnSalesDiscount) + '</td>' +
            '    <td id="returnSalesDiscount' + id + '" style="display:none;">' + Math.abs(returnSalesDiscount) + '</td>' +
            '    <td id="reSalesLineDiscountPercentage_' + id + '" name="reSalesLineDiscountPercentage" style="display:none;">' + discount + '</td>' +
            '</tr>';
        if ($('table#sales_return_items_table').find('#touch_row_return_' + id).length > 0) {
            $('#touch_row_return_' + id).replaceWith(rowHTMLLine);
            $('#touch_row_return_' + id).remove();
            $('#sales_return_items_table tbody').prepend(rowHTMLLine);
        } else {
            $('#sales_return_items_table tbody').prepend(rowHTMLLine);
        }
    },
    returntextOnChange: function (id) {
        var available_quantity = $('#returnItemChangeQuantityValue_' + id).text();
        var ItemQty = $('#touchsale_item_return_qty' + id).val();

        if (PosnicPro.sales.SaleAction === 'return') {
            if (parseFloat(available_quantity) < parseFloat(ItemQty)) {
                var qtyupdate = $('#returnItemChangeQuantityValue_' + id).text();
                $('#touchsale_item_return_qty' + id).val(qtyupdate);
                PosnicPro.sales.quantity.retrunlineItemCalculation(id, qtyupdate);
                $('#touch_row_return_' + id).remove();
                PosnicPro.alert('error', 'Some items are out of stock.');
                return false;
            } else {
                var total_qty = available_quantity - ItemQty;
                $('#touchsale_item_return_qty' + id).val(total_qty);
                $('#returndecreSales_' + id).text(ItemQty);

            }
            PosnicPro.sales.returnitemSalesLineTable = $('#sales_return_items_table tbody tr').map(function () {
                var itemid = $(this).find(':nth-child(11)').text();
                return {
                    totalPrice: $('#returnSalesLineTotal_' + itemid).text()
                };
            }).get();
            var returnSalesGstTax = 0;
            for (var i = 0; i < PosnicPro.sales.returnitemSalesLineTable.length; i++) {
                returnSalesGstTax += parseFloat(PosnicPro.sales.returnitemSalesLineTable[i].totalPrice);
            }

            if (returnSalesGstTax === 0) {
                $("#save_submit,#check_button").attr("disabled", true);
                $('#sales_return_items_table tbody').append('<tr class="sales_new_tablerow_content_area" id="sales_new_tablerow_content_area"><td colspan="9"><div class="text-center text-dark"> <p class="table_cart_content"><lang class="lang_empty_return">Return Items Order Empty</lang></p></div></td></tr>');
            } else {
                $('table#sales_return_items_table tr#sales_new_tablerow_content_area').remove();
                $("#save_submit,#check_button").removeAttr("disabled");
            }

            PosnicPro.sales.quantity.retrunlineItemCalculation(id, ItemQty);

        }
    },
    retrunlineItemCalculation: function (id, total_qty) {
        $('#RoundOff').html('');
        var item_quantity = $('#touchsale_item_return_qty' + id).val();
        var updatePrice = parseFloat($('#addSalesLineItemSellingPrice_' + id).text()) * item_quantity;
        var PriceDiscount = parseFloat($('#addSalesLineItemDiscount_' + id).text()) * item_quantity;
        var tax = parseFloat($('#addSalesLineItemTax_' + id).text()) * item_quantity;
        var updateReturnPrice = parseFloat($('#addSalesLineItemSellingPrice_' + id).text()) * total_qty;
        var PriceReturnDiscount = parseFloat($('#addSalesLineItemDiscount_' + id).text()) * total_qty;
        var taxReturn = parseFloat($('#addSalesLineItemTax_' + id).text()) * total_qty;
        var discount = $('#addSalesLinediscountval_' + id).text();
        var tax_type = $('#addSalesLineItemTaxType_' + id).text();
        var updateSalesLineTotal;
        var updateReturnSalesLineTotal;
        var taxGst = 0;
        var taxReturnGst = 0;
        if (item_quantity > 0) {
            if (PriceDiscount > 0 && tax > 0 && $('#discountSign' + id).text() !== '%') {
                var addSalesTaxValue = updatePrice - PriceDiscount;
                var returnSalesTaxValue = updateReturnPrice - PriceReturnDiscount;
                if (tax_type === 'Exc') {
                    var TaxValue = parseFloat($('#addSalesLineItemTax_' + id).text());
                    var tax_value = (addSalesTaxValue / 100) * parseFloat(TaxValue);
                    updateSalesLineTotal = addSalesTaxValue + tax_value;
                    var return_tax_value = (returnSalesTaxValue / 100) * parseFloat(TaxValue);
                    updateReturnSalesLineTotal = returnSalesTaxValue + return_tax_value;
                    taxGst = tax_value;
                    taxReturnGst = return_tax_value;
                } else {
                    var TaxValue = parseFloat($('#addSalesLineItemTax_' + id).text());
                    var inclusive_price = parseFloat($('#addSalesLineItemPrice_' + id).text()) * item_quantity;
                    var inclusive_price_value = inclusive_price - PriceDiscount;
                    updateSalesLineTotal = inclusive_price_value + (inclusive_price_value / 100) * TaxValue;
                    var inclusive_return_price = parseFloat($('#addSalesLineItemPrice_' + id).text()) * total_qty;
                    var inclusive_return_price_value = inclusive_return_price - PriceReturnDiscount;
                    updateReturnSalesLineTotal = inclusive_return_price_value + (inclusive_return_price_value / 100) * TaxValue;
                    taxGst = (inclusive_price_value / 100) * TaxValue;
                    taxReturnGst = (inclusive_return_price_value / 100) * TaxValue;
                }
            } else if (PriceDiscount > 0 && tax > 0 || PriceDiscount > 0 && tax === 0 && $('#discountSign' + id).text() === '%') {
                var Discount_amount_value = (discount / 100) * parseFloat(updatePrice);
                var Bal_discounamt = updatePrice - Discount_amount_value;
                var Discount_value = (discount / 100) * parseFloat(updateReturnPrice);
                var returnSalesTaxValue = updateReturnPrice - Discount_value;
                if (tax_type === 'Exc') {
                    var TaxValue = parseFloat($('#addSalesLineItemTax_' + id).text());
                    var tax_value = (TaxValue / 100) * parseFloat(Bal_discounamt);
                    updateSalesLineTotal = Bal_discounamt + tax_value;
                    var return_tax_value = (TaxValue / 100) * parseFloat(returnSalesTaxValue);
                    updateReturnSalesLineTotal = returnSalesTaxValue + return_tax_value;
                    taxGst = tax_value;
                    taxReturnGst = return_tax_value;
                } else {
                    updateSalesLineTotal = Bal_discounamt;
                    updateReturnSalesLineTotal = returnSalesTaxValue;

                    var TaxValue = parseFloat($('#addSalesLineItemTax_' + id).text());
                    var taxSalesPrice = parseFloat($('#addSalesLineItemPrice_' + id).text()) * item_quantity;
                    var taxReturnPrice = parseFloat($('#addSalesLineItemPrice_' + id).text()) * total_qty;
                    var taxSalesGst = taxSalesPrice - (taxSalesPrice * (discount / 100));
                    taxGst = (taxSalesGst / 100) * TaxValue;
                    var taxReturnGst = taxReturnPrice - (taxReturnPrice * (discount / 100));
                    taxReturnGst = (taxReturnGst / 100) * TaxValue;
                }
            } else {

                if (tax_type === 'Exc') {
                    var TaxValue = parseFloat($('#addSalesLineItemTax_' + id).text());
                    var tax_value = (TaxValue / 100) * parseFloat(updatePrice);
                    updateSalesLineTotal = updatePrice - PriceDiscount + tax_value;
                    var tax_value = (TaxValue / 100) * parseFloat(updateReturnPrice);
                    updateReturnSalesLineTotal = updateReturnPrice - PriceReturnDiscount + tax_value;

                    taxGst = (updatePrice / 100) * TaxValue;
                    taxReturnGst = (updateReturnPrice / 100) * TaxValue;
                } else {

                    var TaxValue = parseFloat($('#addSalesLineItemTax_' + id).text());
                    var taxSalesPrice = parseFloat($('#addSalesLineItemPrice_' + id).text()) * item_quantity;
                    var taxReturnPrice = parseFloat($('#addSalesLineItemPrice_' + id).text()) * total_qty;
                    taxGst = (taxSalesPrice / 100) * TaxValue;
                    taxReturnGst = (taxReturnPrice / 100) * TaxValue;

                    if (PriceDiscount > 0) {
                        updateSalesLineTotal = updatePrice - PriceDiscount;
                        updateReturnSalesLineTotal = updateReturnPrice - PriceReturnDiscount;
                    } else {
                        updateSalesLineTotal = updatePrice;
                        updateReturnSalesLineTotal = updateReturnPrice;
                    }
                }
            }
        } else {
            var salesQuantityValue = $('#returnItemChangeQuantityValue_' + id).text();
            if (parseFloat(salesQuantityValue) === parseFloat(total_qty)) {
                $('#touch_row_' + id).hide();
                var ReturnPriceValue = parseFloat($('#addSalesLineItemPrice_' + id).text());
                var ReturnDiscountValue = parseFloat($('#addSalesLineItemDiscount_' + id).text());
                var ReturnSignValue = $('#discountSign' + id).text();
                var ReturnTaxValue = parseFloat($('#addSalesLineItemTax_' + id).text());
                var returnPrice = ReturnPriceValue * total_qty;
                if (ReturnSignValue === '%') {
                    var returnAmount = returnPrice - (returnPrice * (ReturnDiscountValue / 100));
                } else {
                    var returnAmount = returnPrice - (ReturnDiscountValue * total_qty);
                }
                updateReturnSalesLineTotal = returnAmount + (returnAmount / 100) * ReturnTaxValue;
                taxReturnGst = ((returnAmount / 100) * ReturnTaxValue);
            } else {
                var ReturnPriceValue = parseFloat($('#returnSalesLineItemPrice_' + id).text());
                var ReturnDiscountValue = parseFloat($('#returnSalesLineItemDiscount_' + id).text());
                var ReturnSignValue = $('#discountSign' + id).text();
                var ReturnTaxValue = parseFloat($('#returnSalesLineItemTax_' + id).text());
                var returnPrice = ReturnPriceValue * total_qty;
                if (ReturnSignValue === '%') {
                    var returnAmount = returnPrice - (returnPrice * (ReturnDiscountValue / 100));
                } else {
                    var returnAmount = returnPrice - (ReturnDiscountValue * total_qty);
                }
                updateReturnSalesLineTotal = returnAmount + (returnAmount / 100) * ReturnTaxValue;
                taxReturnGst = ((returnAmount / 100) * ReturnTaxValue);
            }
        }

        $('#addSalesGstTax_' + id).text(taxGst.toFixed(2));
        $('#returnSalesGstTax_' + id).text(taxReturnGst.toFixed(2));
        updateSalesLineTotal = Number(updateSalesLineTotal).toFixed(2);
        $('#addSalesLineTotal_' + id).text(updateSalesLineTotal);
        updateReturnSalesLineTotal = Number(updateReturnSalesLineTotal).toFixed(2);
        $('#returnTotal_' + id).text(updateReturnSalesLineTotal);
        PosnicPro.sales.quantity.returnSaleLineItem(id);
        PosnicPro.sales.addLineTable = $('#sales_return_items_table tbody tr').map(function () {
            var itemid = $(this).find(':nth-child(11)').text();
            return {
                return_total: $('#returnSalesLineTotal_' + itemid).text(),
                return_gst_tax_total: $('#returnSalesGstTax_' + itemid).text(),
                subtotalamount: $('#returnSalesLineItemPrice_' + itemid).text() * $('#returnSalesLineItemQty_' + itemid).text(),
                discountamount: $('#returnSalesDiscount_' + itemid).text() * $('#returnSalesLineItemQty_' + itemid).text()
            };
        }).get();
        var addSalesSubTotal = 0;
        var addSalesGrandTotal = 0;
        var addSaleLineDiscountTotal = 0;
        var returnSalesGstTax = 0;
        for (var i = 0; i < PosnicPro.sales.addLineTable.length; i++) {
            addSalesSubTotal += parseFloat(PosnicPro.sales.addLineTable[i].subtotalamount);
            returnSalesGstTax += parseFloat(PosnicPro.sales.addLineTable[i].return_gst_tax_total);
            addSalesGrandTotal += parseFloat(PosnicPro.sales.addLineTable[i].return_total);
            addSaleLineDiscountTotal += parseFloat(PosnicPro.sales.addLineTable[i].discountamount);
        }
        addSalesSubTotal = Number(addSalesSubTotal).toFixed(2);
        $('#refund_subtotal').number(addSalesSubTotal, 2);
        PosnicPro.sales.calculation.returnDiscoundCalculation(addSalesGrandTotal);
        $('#sales_tax_return_value').number(returnSalesGstTax, 2);
        $('.sales_discount_return_value').number(addSaleLineDiscountTotal, 2);

        PosnicPro.sales.return_remove = 'increment';
        $('.tax-sales-line-total').number((addSalesSubTotal - returnSalesGstTax), 2);

        if (total_qty === 0) {
            $('#touch_row_return_' + id).hide();
        }

        var rightTableCount = PosnicPro.sales.addLineTable = $('#sales_return_items_table tbody tr').map(function () {
            var itemid = $(this).find(':nth-child(11)').text();
            return {
                count: $('#returnSalesLineItemQty_' + itemid).text()
            };
        }).get();
        var removeRightcount = 0;
        for (var i = 0; i < rightTableCount.length; i++) {
            removeRightcount += parseFloat(rightTableCount[i].count);
        }
        if (removeRightcount === 0) {
            $('#sales_return_items_table tbody').append('<tr class="sales_new_tablerow_content_area" id="sales_new_tablerow_content_area"><td colspan="9"><div class="text-center text-dark"> <p class="table_cart_content"><lang class="lang_empty_return">Return Items Order Empty</lang></p></div><img src="static/images/general/wallet.svg" class="img-fluid sales-cart-image" style="opacity: 0.4;width: 100%;" alt="wallet"></td></tr>');
            var imgHeight = $(window).height() - 500;
            $('.sales-cart-image').height(imgHeight);
        }

        var leftTableCount = PosnicPro.sales.addLineTable = $('#sales_new_items_table tbody tr').map(function () {
            var itemid = $(this).find(':nth-child(8)').text();
            return {
                count: $('#touchsale_item_return_qty' + itemid).val()
            };
        }).get();
        var removecount = 0;
        for (var i = 0; i < leftTableCount.length; i++) {
            removecount += parseFloat(leftTableCount[i].count);
        }
        if (removecount === 0) {
            $('#sales_new_items_table tbody').append('<tr class="sales_new_tablerow_content_area" id="sales_new_tablerow_content_area"><td colspan="8"><div class="text-center text-dark"> <p class="table_cart_content"><lang class="lang_sale_empty">Sale Order Empty</lang> </p></div><img src="static/images/general/wallet.svg" class="img-fluid sales-cart-image" style="opacity: 0.4;width: 100%;" alt="wallet"></td></tr>');
            var imgHeight = $(window).height() - 500;
            $('.sales-cart-image').height(imgHeight);
            $("#save_submit").removeClass("disabled");
            $("#return_button").attr("disabled", true);
            $('#check_button').removeAttr("disabled");
        }

    },

    // return +/- quantity calculations
    qtyreturnDecrease: function (id, action) {
        var oldValue = $('#touchsale_item_return_qty' + id).val();
        var addSalesLineItemUnit = $('#addSalesLineItemUnit_' + id).text();
        $('#returnSalesLineItemUnit_' + id).text(addSalesLineItemUnit);
        var value;
        var sale_qty;
        if (action === 0) {
            PosnicPro.sales.return_remove = 'increment';
            $('table#sales_return_items_table tr#sales_new_tablerow_content_area').remove();
            $("#save_submit,#check_button").removeAttr("disabled");

            var checkValue = (parseFloat(oldValue));
            sale_qty = (Number.isInteger(checkValue) === false) ? parseFloat(oldValue) - 0.01 : parseFloat(oldValue) - 1;
            sale_qty = (Number.isInteger(value) === false) ? sale_qty.toFixed(2) : sale_qty;

            var return_mode = ($('#returnItemChangeQuantityValue_' + id).text() !== '') ? $('#returnItemChangeQuantityValue_' + id).text() : 0;
            var total_qty = return_mode - sale_qty;
            total_qty = (Number.isInteger(total_qty) === false) ? total_qty.toFixed(2) : total_qty.toFixed(2);
            $('#returndecreSales_' + id).text(total_qty);

            $('#touchsale_item_return_qty' + id).val(sale_qty);
            $('#returnitemQuantity_' + id).text(sale_qty);
            var decrementValue = $('#returnSalesIncreaseDecrease_' + id).text();
            var totalDecrementQuantity = parseFloat(decrementValue) + parseFloat(sale_qty);
            $('#returnSalesIncreaseDecrease_' + id).text(totalDecrementQuantity);
        } else {
            $("#save_submit,#check_button").removeAttr("disabled");
            var checkValue = (parseFloat(oldValue));
            value = (Number.isInteger(checkValue) === false) ? parseFloat(oldValue) + 0.01 : parseFloat(oldValue) + 1;
            value = (Number.isInteger(value) === false) ? value.toFixed(2) : value.toFixed(2);
            var return_mode = ($('#returnItemChangeQuantityValue_' + id).text() !== '') ? $('#returnItemChangeQuantityValue_' + id).text() : 0;
            var total_qty = return_mode - value;
            total_qty = (Number.isInteger(total_qty) === false) ? total_qty.toFixed(2) : total_qty;
            if (parseFloat(return_mode) < parseFloat(value)) {
                PosnicPro.alert('error', 'No items are in stock.');
                $('#touchsale_item_qty' + id).val(return_mode);
                return false;
            }
            $('#returndecreSales_' + id).text(total_qty);
            var incrementValue = $('#returnSalesIncreaseDecrease_' + id).text();
            var sale_plus_qty = 1;
            var totalIncrementQuantity = parseInt(incrementValue) - parseInt(sale_plus_qty);
            $('#returnSalesIncreaseDecrease_' + id).text(totalIncrementQuantity);
            $('#touchsale_item_return_qty' + id).val(value);
            $('table#sales_return_items_table tr#sales_new_tablerow_content_area').remove();
            if ($('#returnSalesLineItemQty_' + id).text() === "1") {
                $('#returnTotal_' + id).text('0');
            }
        }
        PosnicPro.sales.quantity.retrunlineItemCalculation(id, total_qty);
        if (PosnicPro.sales.EditRecentSaleParams.payment_pending > 0) {
            $('#check_button').attr('disabled', true);
        } else {
            $('#check_button').attr('disabled', false);
        }
    }
};
/**********  END SALES QUANTITY FUNCTION *********/

/**********  START - SALES CALCULATION FUNCTION *********/

/*
 * Document-level charges on a sale (owner spec): parcel / service /
 * delivery fees, named, after the item math. Toggle-gated for NEW sales;
 * a sale that already carries charges (or one born from a quote) is
 * always manageable - features never lock existing data.
 */
/*
 * Inline cell editing on the cart (owner spec): double-click Price, Disc
 * or Tax; Enter or focus-out asks ONE clear question - only this sale, or
 * update the item record too. Price and tax ride the price_override rail,
 * discounts ride discount_apply, and "update item" needs item write on
 * the server as well.
 */
/*
 * Whole-line editor (owner ask): the pencil on each cart row opens ONE
 * popup with price, qty, discount and tax together - one approval, one
 * save, instead of three double-click edits when a queue is waiting.
 * Same rails the per-cell editor used: the sale_quick_edit toggle, the ACL perms with
 * a manager-PIN fallback, and items/quickPatch when the item record
 * should learn the change. JS-built and body-appended, the only modal
 * pattern that has never broken here.
 */
PosnicPro.sales.lineEdit = {
    _id: null,
    open: function (itemId) {
        if (PosnicPro.local.get('sale_quick_edit') === 'disable') { return; }
        var go = function () { PosnicPro.sales.lineEdit._show(itemId); };
        if (PosnicPro.posCan && !(PosnicPro.posCan('price_override') && PosnicPro.posCan('discount_apply'))) {
            PosnicPro.requireManagerApproval('price_override',
                { prompt: 'Editing a line needs a manager\'s approval.' }, go);
            return;
        }
        go();
    },
    _show: function (id) {
        PosnicPro.sales.lineEdit._id = id;
        if (!$('#sale_line_edit').length) {
            $('body').append(
                '<div class="modal fade" id="sale_line_edit" tabindex="-1" role="dialog" aria-hidden="true">'
                + '<div class="modal-dialog modal-dialog-centered" role="document"><div class="modal-content">'
                /*
                 * No inline colours here. The theme paints .modal-header with
                 * the primary colour and sets a CONTRASTING title and close to
                 * match - but an inline style carrying !important beats even
                 * that, which is exactly how this dialog ended up with black
                 * text on a blue bar. Let the theme do its job.
                 */
                + '<div class="modal-header"><h5 class="modal-title" id="sale_line_edit_name">Edit line</h5>'
                + '<button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button></div>'
                + '<div class="modal-body pb-2">'
                + '<div class="form-row">'
                + '<div class="form-group col-6"><label class="le-label">Price</label><input type="number" min="0" step="any" class="form-control text-right" id="le_price"></div>'
                + '<div class="form-group col-6"><label class="le-label">Quantity</label><input type="number" min="0" step="any" class="form-control text-right" id="le_qty"></div>'
                + '<div class="form-group col-6"><label class="le-label">Discount</label>'
                + '<div class="input-group"><div class="input-group-prepend"><button type="button" class="btn btn-outline-secondary" id="le_disc_mode" title="Tap to switch amount / percent">%</button></div>'
                + '<input type="number" min="0" step="any" class="form-control text-right" id="le_disc"></div></div>'
                + '<div class="form-group col-6" id="le_tax_group"><label class="le-label">Tax %</label><input type="number" min="0" max="100" step="any" class="form-control text-right" id="le_tax"></div>'
                + '</div>'
                + '<small class="text-muted">"Sale + update item" also writes the change back to the item record for every future sale.</small>'
                + '</div>'
                + '<div class="modal-footer py-2 d-flex" style="gap:6px;">'
                + '<button type="button" class="btn btn-primary flex-fill" id="le_save_sale">Only this sale</button>'
                + '<button type="button" class="btn btn-outline-primary flex-fill" id="le_save_both">Sale + update item</button>'
                + '</div></div></div></div>');
            $(document).on('click', '#le_disc_mode', function () {
                var pct = $(this).data('pct') !== true;
                $(this).data('pct', pct).text(pct ? '%' : (PosnicPro.local.get('currencySign') || '₹'));
            });
            $(document).on('click', '#le_save_sale', function () { PosnicPro.sales.lineEdit._save(false); });
            $(document).on('click', '#le_save_both', function () { PosnicPro.sales.lineEdit._save(true); });
            $(document).on('keydown', '#sale_line_edit input', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); PosnicPro.sales.lineEdit._save(false); }
            });
        }
        $('#sale_line_edit_name').text($('#addSalesLineItemName_' + id).data('id') || 'Edit line');
        $('#le_price').val(parseFloat($('#addSalesLineItemPrice_' + id).text()) || 0);
        $('#le_qty').val(parseFloat($('#touchsale_item_qty' + id).val()) || 1);
        var isPct = $('#discountSign' + id).text() === '%';
        $('#le_disc').val(parseFloat($('#addSalesLineItemDiscount_' + id).text()) || 0);
        $('#le_disc_mode').data('pct', isPct).text(isPct ? '%' : (PosnicPro.local.get('currencySign') || '₹'));
        var curTax = parseFloat($('#addSalesLineItemTax_' + id).text()) || 0;
        $('#le_tax').val(curTax);
        // owner rule: the tax field lives under the tax toggle - hidden when
        // the feature is off, unless this line already carries recorded tax
        var taxOff = !PosnicPro.sales.taxFeatureOn();
        $('#le_tax_group').toggle(!taxOff || curTax > 0);
        $('#sale_line_edit').modal('show');
        setTimeout(function () { $('#le_price').focus().select(); }, 350);
    },
    _save: function (updateItem) {
        var id = PosnicPro.sales.lineEdit._id;
        if (!id || !$('#touch_row_' + id).length) { $('#sale_line_edit').modal('hide'); return; }
        $('#sale_line_edit').modal('hide');
        var taxType = $('#addSalesLineItemTaxType_' + id).text();
        var patch = { id: $('#addSalesLineItemId_' + id).text() || id };
        var np = parseFloat($('#le_price').val());
        var nq = parseFloat($('#le_qty').val());
        var nd = parseFloat($('#le_disc').val());
        var ntx = parseFloat($('#le_tax').val());
        var pct = $('#le_disc_mode').data('pct') === true;
        var curPrice = parseFloat($('#addSalesLineItemPrice_' + id).text()) || 0;
        var curTax = parseFloat($('#addSalesLineItemTax_' + id).text()) || 0;
        var curDisc = parseFloat($('#addSalesLineItemDiscount_' + id).text()) || 0;
        var curPct = $('#discountSign' + id).text() === '%';
        var TaxValue = curTax;
        if (isFinite(np) && np >= 0 && np !== curPrice) {
            $('#saleInlineItemPrice_' + id).text(np.toFixed(2));
            $('#addSalesLineItemPrice_' + id).text(np.toFixed(2));
            $('#addSalesLineItemSellingPrice_' + id).text(np.toFixed(2));
            patch.selling_price = np;
        }
        if ($('#le_tax_group').is(':visible') && isFinite(ntx) && ntx >= 0 && ntx <= 100 && ntx !== curTax) {
            $('#addSalesLineItemTax_' + id).html(ntx + '<span>%</span>');
            TaxValue = ntx;
            patch.tax = ntx;
        }
        var priceNow = parseFloat($('#addSalesLineItemPrice_' + id).text()) || 0;
        var mrp = taxType === 'Exc' ? priceNow : priceNow / (1 + TaxValue / 100);
        $('#addSalesLineItemSubTotal_' + id).text(mrp.toFixed(2));
        if (isFinite(nd) && nd >= 0 && (nd !== curDisc || pct !== curPct)) {
            if (pct) {
                $('#addSalesLineItemDiscount_' + id).html(nd + '<span id="discountSign' + id + '">%</span>');
                $('#addSalesLineDiscountPercentage_' + id).text(nd);
                $('#addSalesLineDiscountAmount_' + id).text(0);
                $('#addSalesLineItemDiscountprint_' + id).text(nd + '%');
                patch.discount_percentage = nd;
            } else {
                $('#addSalesLineItemDiscount_' + id).html(nd.toFixed(2) + '<span id="discountSign' + id + '">' + (PosnicPro.local.get('currencySign') || '') + '</span>');
                $('#addSalesLineDiscountAmount_' + id).text(nd.toFixed(2));
                $('#addSalesLineDiscountPercentage_' + id).text(0);
                $('#addSalesLineItemDiscountprint_' + id).text(nd.toFixed(2));
                patch.discount_amount = nd;
            }
        }
        // quantity flows through its own input so every listener runs
        if (isFinite(nq) && nq > 0 && nq !== (parseFloat($('#touchsale_item_qty' + id).val()) || 0)) {
            $('#touchsale_item_qty' + id).val(nq).trigger('change');
        }
        PosnicPro.sales.commonInlineCalculation(id, taxType, TaxValue);
        if (updateItem && Object.keys(patch).length > 1) {
            PosnicPro.post({ url: 'items/quickPatch', data: JSON.stringify(patch) }, function (r) {
                PosnicPro.alert(r.type, r.type === 'success' ? 'Item record updated too' : r.message);
                if (PosnicPro.sales.itemCache) { PosnicPro.sales.itemCache.clear(); }
            }, function () { PosnicPro.alert('warning', 'Sale updated; the item record could not be'); });
        }
    }
};
$(document).on('click', '.sale-line-edit', function () {
    PosnicPro.sales.lineEdit.open(String($(this).data('id')));
});
/*
 * Double-click cell editing is retired (owner, 2026-08-20: "inline edit of
 * sale not required. we can edit via clicking action edit button"). The
 * pencil in the Action column opens the whole line at once, which is the
 * quicker move with a queue at the counter. The per-cell editor it
 * replaced is gone with it - it had no entry point left.
 */
/*
 * Is the tax feature actually on for this shop?
 *
 * The old answer read `default_tax_enable_disable`, which settings.js only
 * writes when someone OPENS the Settings page. On a till that went straight
 * to the sale screen the key is absent, `=== 'false'` is false, and the Tax
 * column showed a row of 0% on a shop with tax switched off - which is why
 * this kept coming back. The cached general_settings blob carries
 * module_tax_enable, so ask that first; absent everywhere now means OFF.
 */
/*
 * How long a sale has been parked, in the words a cashier would use.
 *
 * A bill held two minutes ago is a customer still at the counter; one held
 * yesterday is probably abandoned and worth clearing. Marking anything over
 * a day stale is what turns this column from a timestamp into a prompt.
 */
PosnicPro.sales.parkedAgo = function (value) {
    if (!value) { return { text: '-', exact: '', stale: false }; }
    var then = new Date(value);
    if (isNaN(then.getTime())) { return { text: '-', exact: '', stale: false }; }
    var mins = Math.floor((Date.now() - then.getTime()) / 60000);
    if (mins < 0) { mins = 0; }
    var text;
    if (mins < 1) { text = 'just now'; }
    else if (mins < 60) { text = mins + ' min ago'; }
    else if (mins < 60 * 24) {
        var hrs = Math.floor(mins / 60);
        text = hrs + (hrs === 1 ? ' hour ago' : ' hours ago');
    } else {
        var days = Math.floor(mins / (60 * 24));
        text = days + (days === 1 ? ' day ago' : ' days ago');
    }
    return { text: text, exact: then.toLocaleString(), stale: mins >= 60 * 24 };
};
PosnicPro.sales.taxFeatureOn = function () {
    if (PosnicPro.local.get('gst_action') === 'enable') { return true; }
    try {
        var gs = JSON.parse(PosnicPro.local.get('general_settings') || '{}');
        if (typeof gs.module_tax_enable === 'boolean') { return gs.module_tax_enable; }
        if (typeof gs.tax_checkbox === 'boolean') { return gs.tax_checkbox; }
    } catch (e) { /* fall through to the legacy flag */ }
    return PosnicPro.local.get('default_tax_enable_disable') === 'true';
};
PosnicPro.sales.charges = [];
PosnicPro.sales.chargesTotal = function () {
    var t = 0;
    (PosnicPro.sales.charges || []).forEach(function (c) { t += Number(c.amount) || 0; });
    return Math.round(t * 100) / 100;
};
PosnicPro.sales.chargesEnabled = function () {
    try {
        var gs = JSON.parse(PosnicPro.local.get('general_settings') || '{}');
        return gs.custom_charges_enable === true;
    } catch (e) { return false; }
};
/*
 * Tax on a charge (queue #5): a charge marked taxed carries the shop's
 * DEFAULT tax on top of its amount - parcel/service charges are quoted
 * net and tax rides on top, the industry norm. The rate resolves once
 * from the same list the quick sale uses; rate 0 (tax feature off, or
 * no default tax) hides the affordance entirely.
 */
PosnicPro.sales.chargeTax = {
    _tax: null,
    ensure: function () {
        if (PosnicPro.sales.chargeTax._tax !== null) { return; }
        PosnicPro.sales.chargeTax._tax = { name: '', value: 0 };
        if (!PosnicPro.sales.taxFeatureOn()) { return; }
        PosnicPro.get({ url: 'setting/getTaxAjaxList', data: 'query=' }, function (response) {
            var wanted = PosnicPro.local.get('default_tax_id');
            var found = null;
            (response.suggestions || []).forEach(function (t) {
                if (String(t.tax_id) === String(wanted)) { found = t; }
            });
            if (found && (Number(found.tax_value) || 0) > 0) {
                PosnicPro.sales.chargeTax._tax = { name: found.tax_name, value: Number(found.tax_value) };
                PosnicPro.sales.renderCharges();
            }
        }, function () { /* stays 0; charges simply offer no tax */ });
    },
    rate: function () {
        return (PosnicPro.sales.chargeTax._tax && PosnicPro.sales.chargeTax._tax.value) || 0;
    },
    taxName: function () {
        return (PosnicPro.sales.chargeTax._tax && PosnicPro.sales.chargeTax._tax.name) || '';
    },
    amountFor: function (c) {
        if (!c || c.taxed !== true) { return 0; }
        return Math.round((Number(c.amount) || 0) * PosnicPro.sales.chargeTax.rate()) / 100;
    }
};
PosnicPro.sales.chargesTax = function () {
    var t = 0;
    (PosnicPro.sales.charges || []).forEach(function (c) { t += PosnicPro.sales.chargeTax.amountFor(c); });
    return Math.round(t * 100) / 100;
};
PosnicPro.sales.renderCharges = function () {
    /*
     * NOTHING in here may throw. This runs at the top of clear.cartItems,
     * before setDefaults - and an exception here aborts that chain, so the
     * walk-in customer is never filled and the sale dies on "Enter a
     * customer name". That regression has now happened twice (the tax-rate
     * lookup below was the second cause: it touches PosnicPro.local and
     * PosnicPro.get, neither of which is guaranteed on first paint).
     */
    try {
        PosnicPro.sales.chargeTax.ensure();
    } catch (e) { /* no rate yet: charges simply render without the tax chip */ }
    var list = PosnicPro.sales.charges || [];
    var rate = 0;
    try { rate = PosnicPro.sales.chargeTax.rate(); } catch (e) { rate = 0; }
    var html = '';
    list.forEach(function (c, i) {
        // keep the payload fields current: the sale save sends these objects as-is
        c.tax_amount = PosnicPro.sales.chargeTax.amountFor(c);
        c.tax_name = c.taxed === true ? PosnicPro.sales.chargeTax.taxName() : '';
        html += '<div class="sale-charge-row"><span>' + $('<i>').text(c.name).html() + '</span>'
            + (rate > 0
                ? '<a href="javascript:void(0)" class="sale-charge-tax badge ' + (c.taxed === true ? 'badge-primary' : 'badge-light') + '" data-i="' + i
                    + '" title="Tax on this charge (' + rate + '%)">'
                    + (c.taxed === true ? '+tax ' + c.tax_amount.toFixed(2) : '+tax') + '</a>'
                : '')
            + '<b>' + Number(c.amount).toFixed(2) + '</b>'
            + '<a href="javascript:void(0)" class="sale-charge-del text-danger" data-i="' + i + '">&times;</a></div>';
    });
    $('#sale_charges_list').html(html);
    $('#sale_add_charge').toggle(PosnicPro.sales.chargesEnabled() || list.length > 0);
    try {
        PosnicPro.sales.calculation.extraDiscoundCalculation();
    } catch (e) {
        /* first page load: totals state not built yet - the regular flow
           recalculates right after; breaking the clear chain here is what
           cost the walk-in default */
    }
};
$(document).on('click', '#sale_add_discount', function () {
    // one action: the user already said "add discount" - the editor opens
    // with the cursor in it. editable('show') skips the click gate, so the
    // same discount_apply rail runs here explicitly.
    var open = function () {
        $('.addDisc-hide-show').show();
        setTimeout(function () {
            try { $('#extraDisc').editable('show'); } catch (e) { $('#extraDisc').trigger('click'); }
            setTimeout(function () { $('.editable-input input').focus().select(); }, 120);
        }, 60);
    };
    if (PosnicPro.posCan && !PosnicPro.posCan('discount_apply')) {
        PosnicPro.requireManagerApproval('discount_apply',
            { prompt: "Applying a discount needs a manager's approval." }, open);
        return;
    }
    open();
});
/*
 * Inline add-charge row (queue #7): the prompt() pair is gone. The entry
 * row is a SIBLING of the list - renderCharges rewrites the list's html
 * and must never eat a half-typed entry. One line, till-readable sizes.
 */
$(document).on('click', '#sale_add_charge', function () {
    var $entry = $('#sale_charge_entry');
    if (!$entry.length) {
        $entry = $(
            '<div id="sale_charge_entry" class="customer-display-hide">' +
            '<input type="text" class="form-control form-control-sm sc-name" maxlength="60" placeholder="Charge name (e.g. Parcel)">' +
            '<input type="number" class="form-control form-control-sm sc-amt" min="0" step="any" placeholder="0.00">' +
            '<a href="javascript:void(0)" class="sc-ok text-success" title="Add"><i class="feather icon-check"></i></a>' +
            '<a href="javascript:void(0)" class="sc-cancel text-danger" title="Cancel">&times;</a>' +
            '</div>');
        $('#sale_charges_list').before($entry);
    }
    $entry.show().find('.sc-name').focus();
});
PosnicPro.sales.commitChargeEntry = function () {
    var name = $.trim($('#sale_charge_entry .sc-name').val() || '');
    var amt = parseFloat($('#sale_charge_entry .sc-amt').val());
    if (!name) { $('#sale_charge_entry .sc-name').focus(); return; }
    if (!isFinite(amt) || amt <= 0) { $('#sale_charge_entry .sc-amt').focus(); return; }
    PosnicPro.sales.charges.push({ name: name.slice(0, 60), amount: Math.round(amt * 100) / 100, taxed: false, source: 'manual' });
    $('#sale_charge_entry').hide().find('input').val('');
    PosnicPro.sales.renderCharges();
};
$(document).on('click', '#sale_charge_entry .sc-ok', function () {
    PosnicPro.sales.commitChargeEntry();
});
$(document).on('click', '#sale_charge_entry .sc-cancel', function () {
    $('#sale_charge_entry').hide().find('input').val('');
});
$(document).on('keydown', '#sale_charge_entry input', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); PosnicPro.sales.commitChargeEntry(); }
    if (e.key === 'Escape') { $('#sale_charge_entry').hide().find('input').val(''); }
});
$(document).on('click', '.sale-charge-del', function () {
    PosnicPro.sales.charges.splice($(this).data('i'), 1);
    PosnicPro.sales.renderCharges();
});
$(document).on('click', '.sale-charge-tax', function () {
    var c = (PosnicPro.sales.charges || [])[$(this).data('i')];
    if (!c) { return; }
    c.taxed = c.taxed !== true;
    PosnicPro.sales.renderCharges();
});

PosnicPro.sales.calculation = {
    /*
     * ADD SALES LINE ITEMS TABLE ROW CALCULATION
     */
    /*
     * Bill-level discounts the cashier applied at the till - a coupon and/or
     * loyalty points spent. They come straight off the payable total, exactly
     * as the server subtracts them at save, so the Pay Total the shop shows is
     * the one the customer pays and the Discount line reflects them live.
     */
    billLevelDiscount: function () {
        var couponDisc =
            (window.PosnicPro && PosnicPro.coupons && PosnicPro.coupons.tillState &&
                Number(PosnicPro.coupons.tillState.discount)) || 0;
        var redeem =
            window.PosnicPro && PosnicPro.loyalty && PosnicPro.loyalty.tillState &&
            PosnicPro.loyalty.tillState.redeem;
        var loyaltyDisc = (redeem && Number(redeem.value)) || 0;
        var d = (couponDisc > 0 ? couponDisc : 0) + (loyaltyDisc > 0 ? loyaltyDisc : 0);
        return isFinite(d) ? d : 0;
    },
    salesTableRowCart: function () {
        $('#RoundOff').html('');
        PosnicPro.sales.addLineTable = $('#sales_new_items_table tbody tr').map(function () {
            let itemid = $(this).find(':nth-child(9)').text();
            $('#sales_new_total_amount').val($('#addSalesLineTotal_' + itemid).text());
            $("#sales_total_company_price").val($('#addSalesLineItemCompanyPrice_' + itemid).text());
            return {
                item_id: $('#addSalesLineItemId_' + itemid).text(),
                item_price: $('#addSalesLineItemPrice_' + itemid).text(),
                item_unit: $('#addSalesLineItemUnit_' + itemid).text(),
                item_quantity: $('#touchsale_item_qty' + itemid).val(),
                CompanyPrice: $('#addSalesLineItemCompanyPrice_' + itemid).text(),
                Discount: $('#addSalesLineItemDiscount_' + itemid).text(),
                Totalamount: $('#addSalesLineTotal_' + itemid).text(),
                gsttaxamount: $('#addSalesGstTax_' + itemid).text(),
                subtotalamount: $('#addSalesLineItemSubTotal_' + itemid).text() * $('#touchsale_item_qty' + itemid).val(),
                discountamount: $('#addSalesDiscount_' + itemid).text()
            };
        }).get();
        var addSalesCompanyPrice = 0;
        var addSalesSubTotal = 0;
        var addSalesLineGstTaxTotal = 0;
        var addSalesLineSubTotal = 0;
        var addReceivingLineDiscountTotal = 0;
        for (var i = 0; i < PosnicPro.sales.addLineTable.length; i++) {
            addSalesCompanyPrice += parseFloat(PosnicPro.sales.addLineTable[i].CompanyPrice);
            addSalesSubTotal += parseFloat(PosnicPro.sales.addLineTable[i].Totalamount);
            addSalesLineGstTaxTotal += parseFloat(PosnicPro.sales.addLineTable[i].gsttaxamount);
            addSalesLineSubTotal += parseFloat(PosnicPro.sales.addLineTable[i].subtotalamount);
            addReceivingLineDiscountTotal += parseFloat(PosnicPro.sales.addLineTable[i].discountamount);
        }
        //addSalesSubTotal = Number(addSalesSubTotal).toFixed(2);
        $('#sales_new_subtotal').number(addSalesLineSubTotal, 2);
        $("#sales_total_company_price").val(addSalesLineSubTotal);
        $("#tax").number(addSalesLineGstTaxTotal, 2);
        // Show line-item discounts plus any coupon/loyalty applied to the bill.
        var billDiscForShow = PosnicPro.sales.calculation.billLevelDiscount();
        $("#discount_sale_amount").number(addReceivingLineDiscountTotal + billDiscForShow, 2);
        $('#sales_new_total_amount').val(addSalesSubTotal);
        $('#grand_total').val(addSalesSubTotal);
        var extraDiscInput = parseFloat($('#extraDisc').text()) || 0;
        var isPercent = !$('#percentIcon').hasClass('d-none');
        var extraDiscAmount = (extraDiscInput > 0) ? (isPercent ? addSalesSubTotal * (extraDiscInput / 100) : extraDiscInput) : 0;
        var grandTotal = addSalesSubTotal - extraDiscAmount;
        if (PosnicPro.roundoff === true && extraDiscAmount > 0) { grandTotal = Math.round(grandTotal); }
        var tenderRecord = [];
        var tenderData = { subtotal: addSalesLineSubTotal.toFixed(2), discount: addReceivingLineDiscountTotal.toFixed(2), tax: addSalesLineGstTaxTotal.toFixed(2), total: addSalesSubTotal.toFixed(2) };
        if (extraDiscAmount > 0) {
            tenderData.extra_discount = extraDiscAmount.toFixed(2);
            tenderData.grand_total = grandTotal.toFixed(2);
        }
        tenderRecord.push(tenderData);
        db.customerDisplay.put({ id: '3', 'clear': 'yes', 'get': 'no', tender: tenderRecord });
        /*indian gst calculation */
        var lineSubTotal = (addSalesSubTotal - addSalesLineGstTaxTotal);
        $('.tax-sales-line-total').number(lineSubTotal, 2);
        PosnicPro.sales.customerBalanceCheck();
        PosnicPro.sales.calculation.extraDiscoundCalculation();
    },
    extraDiscoundCalculation: function () {
        if ($('#sales_new_items_table tbody tr').find(':nth-child(10)').text() === '') {
            $('#grand_total').val('0');
        }
        let inputValue = parseFloat($('#extraDisc').text());
        inputValue = !isNaN(inputValue) ? parseFloat($('#extraDisc').text()) : 0;
        let grand_total = parseFloat($('#grand_total').val());
        let outputVal = grand_total - inputValue;
        if (!$('#percentIcon').hasClass('d-none')) {
            let discAmt = grand_total * (inputValue / 100);
            outputVal = grand_total - discAmt;
        }
        // A coupon and/or redeemed loyalty points come off the payable total too
        // (after the extra discount, before round-off) - the same order the server
        // uses at save, so what the customer sees is what they pay.
        var billDisc = PosnicPro.sales.calculation.billLevelDiscount();
        if (billDisc > 0) {
            outputVal = outputVal - billDisc;
            if (outputVal < 0) outputVal = 0;
        }
        // Tax visibility (owner rule): the module toggle gates NEW tax,
        // recorded tax always shows. Column and totals row hide only when
        // the feature is off AND no line on this sale carries any tax.
        var anyLineTax = false;
        $('[id^="addSalesLineItemTax_"]').each(function () {
            if ((parseFloat($(this).text()) || 0) > 0) { anyLineTax = true; }
        });
        // the column follows the DATA first: a Tax column of nothing but 0%
        // is noise, and it reappears the moment a taxed line lands
        var showTaxCol = anyLineTax || PosnicPro.sales.taxFeatureOn();
        // header AND cells as ONE unit - via ONE class on the table with
        // !important CSS. The old per-element toggling kept desyncing:
        // any other flow calling .show() on the kot-hide headers restored
        // the Tax th with inline style while the cells stayed hidden, and
        // the whole body shifted a column. A class cannot half-apply.
        var $cart = $('#sales_new #return_table');
        $cart.toggleClass('tax-col-off', !showTaxCol);
        if (showTaxCol && PosnicPro.sales.saleProcess !== 'KOT') {
            // sweep stale inline display the old path left behind
            $cart.find('thead th.th-tax-col').css('display', '');
            $('[id^="addSalesLineItemTax_"]').css('display', '');
        }
        // totals row: with no Tax cell the Discount slides into its place
        // on the right; when tax returns, Discount goes back left
        $('#return_discount').toggleClass('disc-solo', !showTaxCol);
        // named charges join the payable after discounts, before round-off;
        // a taxed charge brings its tax with it
        var chargesSum = PosnicPro.sales.chargesTotal();
        var chargesTax = PosnicPro.sales.chargesTax();
        if (chargesSum > 0) { outputVal = outputVal + chargesSum + chargesTax; }
        // the bill's Tax figure = line taxes + charge taxes. Line taxes are
        // re-read from their cells (never from #tax itself) so this stays
        // idempotent however many times the recalc runs.
        if (chargesTax > 0 || PosnicPro.sales._chargeTaxShown) {
            var lineTaxSum = 0;
            $('[id^="addSalesGstTax_"]').each(function () { lineTaxSum += parseFloat($(this).text()) || 0; });
            $('#tax').number(Math.round((lineTaxSum + chargesTax) * 100) / 100, 2);
            PosnicPro.sales._chargeTaxShown = chargesTax > 0;
        }
        // tax feature off AND nothing taxed on this sale: no Tax row at all
        /* #tax is written with .number(), which adds thousand separators, so
           parseFloat('1,234.56') would be 1. This particular use only asks
           "is it zero", which truncation can never get wrong - but the rule is
           uniform on purpose: every read of a formatted display strips the
           separators, so nobody has to work out whether this one is the safe
           exception. Reading display text as a number without stripping is
           what made a Rs34 discount measure 3400% (c57e23a). */
        var taxShown = parseFloat(String($('#tax').text() || '').replace(/,/g, '')) || 0;
        var taxOff = !PosnicPro.sales.taxFeatureOn();
        $('#return_tax').toggle(!(taxOff && taxShown === 0));
        let roundOffValue = (PosnicPro.roundoff === true) ? Math.round(outputVal) - outputVal : 0.00;
        let sign = roundOffValue >= 0 ? '+' : '-';
        let roundOff = '';
        if (roundOffValue !== 0 && !isNaN(roundOffValue)) {
            $('.RoundOff-hide-show').show();
            roundOff = '<span>' + sign + '</span>' +
                '<span class="number">' + Math.abs(roundOffValue).toFixed(2) + '</span>';
        } else {
            $('.RoundOff-hide-show').hide();
        }
        $('#RoundOff').html(roundOff);
        outputVal = (PosnicPro.roundoff === true) ? Math.round(outputVal) : parseFloat(outputVal);
        $('#sales_new_grand_total').number(outputVal, 2);
        PosnicPro.sales.extraDiscount.sale_new_tot = outputVal;
        // Update customer display with extra discount
        var isPercent = !$('#percentIcon').hasClass('d-none');
        var extraDiscAmount = (inputValue > 0) ? (isPercent ? grand_total * (inputValue / 100) : inputValue) : 0;
        db.customerDisplay.get('3').then(function (data) {
            if (data && data.tender && data.tender.length > 0) {
                var tender = data.tender[0];
                if (extraDiscAmount > 0) {
                    tender.extra_discount = extraDiscAmount.toFixed(2);
                    tender.grand_total = outputVal.toFixed(2);
                } else {
                    delete tender.extra_discount;
                    delete tender.grand_total;
                }
                db.customerDisplay.put({ id: '3', 'clear': 'yes', 'get': 'no', tender: [tender] });
            }
        }).catch(function () {});
    },
    returnDiscoundCalculation: function (addSalesGrandTotal) {
        let sales_total = PosnicPro.sales.extraDiscount.sales_total;
        let sales_round_off = PosnicPro.sales.extraDiscount.sales_round_off;
        let sale_extra_discount = PosnicPro.sales.extraDiscount.sale_extra_discount;
        let extra_discount_type = PosnicPro.sales.extraDiscount.extra_discount_type;
        let extraDiscount = addSalesGrandTotal / sales_total * sale_extra_discount;
        let returnsalesgrandTotal = addSalesGrandTotal - extraDiscount;
        if (extra_discount_type === 'percent') {
            let discAmt = addSalesGrandTotal * (sale_extra_discount / 100);
            returnsalesgrandTotal = addSalesGrandTotal - discAmt;
            extraDiscount = sale_extra_discount;
        }
        extraDiscount = Number(extraDiscount).toFixed(2);
        let roundOffValue = (sales_round_off !== 0) ? Math.round(returnsalesgrandTotal) - returnsalesgrandTotal : 0.00;
        returnsalesgrandTotal = (sales_round_off !== 0) ? Math.round(returnsalesgrandTotal).toFixed(2) : Number(returnsalesgrandTotal).toFixed(2);
        $('#extraDisc').text(extraDiscount);
        $('#extraDisc').editable('setValue', extraDiscount);
        let sign = roundOffValue >= 0 ? '+' : '-';
        let roundOff = '';
        if (roundOffValue !== 0) {
            $('.RoundOff-hide-show').show();
            roundOff = '<span>' + sign + '</span>' +
                '<span class="number">' + Math.abs(roundOffValue).toFixed(2) + '</span>';
            $('#RoundOff').html(roundOff);
        } else {
            $('.RoundOff-hide-show').hide();
        }
        $('#refund_grand_total').number(returnsalesgrandTotal, 2);
    }
};

// Initialize fields for a brand new sale (/sales/new)
PosnicPro.sales.setSaleDefaults = function () {

    // A fresh sale carries no picked modifiers and no customer pricing.
    PosnicPro.sales._lineModifiers = {};
    PosnicPro.sales._customerCategoryId = '';
    PosnicPro.sales._loadPriceLists();

    // Tip at tender (owner feedback: SAME line as the discount - the sale
    // page must never scroll). When the discount row itself is hidden
    // Tip sits beside the coupon now; the Workforce switch is the only gate.
    // Tip sits beside the coupon now; the Workforce tips switch is the
    // only gate.
    // Tips are a CHILD of Workforce: parent off means tips off, whatever
    // the sub-switch remembers (owner report - tip showed with Workforce off).
    var _tipsOn = !!(PosnicPro.shiftWidget
        && PosnicPro.shiftWidget._setting('staff_shifts_enable', true)
        && PosnicPro.shiftWidget._setting('staff_tips_enable', false));
    $('.sale-tip-wrap').toggle(_tipsOn);
    // Coupons belong to Marketing - feature off, box gone (owner report).
    var _marketingOn = !!(PosnicPro.shiftWidget
        && PosnicPro.shiftWidget._setting('module_marketing_enable', true));
    $('#sales_coupon_panel').toggle(_marketingOn);


    // Check if register is required and open before allowing sales.
    // ONLY when the module is on: a shop that disabled cash registers in
    // Settings > Modules sells the plain way, and nothing here may block it.
    var registerModuleOn = !!(PosnicPro.shiftWidget
        && PosnicPro.shiftWidget._setting('cash_register_enable', true));
    var branchHasNoRegisters = PosnicPro.local.get('branch_has_no_registers');
    var registerStatus = PosnicPro.local.get('userRegisterStatus');
    var registerId = PosnicPro.local.get('register_id');

    // If branch has registers but no register is open, check database and show modal if needed
    if (registerModuleOn && branchHasNoRegisters !== 'true' && (registerStatus !== 'Open' || !registerId)) {
        var branchId = PosnicPro.local.get('branch_id_set');
        var params = {
            url: 'branches/userRegisterBranchSelect',
            data: {id: branchId}
        };
        
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                if (response.data.open_register && response.data.open_register.register_status === 'Opened') {
                    // Load existing open register
                    PosnicPro.local.set('cash_register_id', response.data.open_register.cash_register_id);
                    PosnicPro.local.set('register_id', response.data.open_register.register_id);
                    PosnicPro.local.set('register_name', response.data.open_register.register_name);
                    PosnicPro.local.set('userRegisterStatus', 'Open');
                    
                    db.currentregister.put({
                        id: '1', 
                        register_id: response.data.open_register.register_id, 
                        register_name: response.data.open_register.register_name, 
                        register_status: 'open'
                    });
                    
                    PosnicPro.alert('success', 'Register loaded: ' + response.data.open_register.register_name);
                } else if (response.data.register_data && response.data.register_data.length > 0) {
                    // Show register selection modal
                    var registerOption = '';
                    for (var i = 0; i < response.data.register_data.length; i++) {
                        var row = response.data.register_data[i];
                        registerOption += '<option id="' + row.register_id + '" value="' + row.register_id + '">' + row.register_name + '</option>';
                    }
                    $('.choose_register_model').html(registerOption);
                    $('#salesRegisterModal').modal('show');
                    
                    PosnicPro.alert('warning', 'Select a register before creating a sale.');
                } else {
                    // No registers for this branch
                    PosnicPro.local.set('branch_has_no_registers', 'true');
                }
            }
        });
    }

    // For normal new sales and new KOT orders, the primary action is
    // "Save". For KOT edit flow coming from KOT History
    // (kotsales/{id}/edit), keep the UI consistent with other edit
    // screens by showing "Update" instead.
    var isKotEditFlow = (PosnicPro.sales && PosnicPro.sales.saleProcess === 'KOT' &&
        PosnicPro.kotorder && PosnicPro.kotorder.editSaleId);

    // Also treat the KOT Order edit hash (#/kotorder/{id}/edit) as a KOT
    // edit context so that flows starting from KOT History â†’ KOT table+pax
    // â†’ Next still receive the "Update" label.
    if (!isKotEditFlow && typeof window !== 'undefined' && window.location && window.location.hash) {
        var kotHash = window.location.hash;
        if (kotHash.indexOf('kotorder/') !== -1 && kotHash.indexOf('/edit') !== -1) {
            isKotEditFlow = true;
        }
    }

    if (isKotEditFlow) {
        (PosnicPro.local.get('language_herf') === 'ta_dashboard.html')
            ? $('.changeSalesBtnText').text('à®ªà¯à®¤à¯à®ªà¯à®ªà®¿')
            : $('.changeSalesBtnText').text('Update');
    } else {
        (PosnicPro.local.get('language_herf') === 'ta_dashboard.html')
            ? $('.changeSalesBtnText').text('à®šà¯‡à®®à®¿')
            : $('.changeSalesBtnText').text('Save');
    }

    $('#sales_new_item_name').focus();
    /*
     * A sale is always billed to SOMEONE. With the default-customer setting
     * off this used to blank every field and stop there - so the chip said
     * "Walk-in" while no customer existed at all, and Pay answered "Enter a
     * customer name" on a shop that had chosen not to prefill one. The
     * fields are still cleared of the previous customer, but the branch's
     * own Walk-in is then resolved (the server finds or creates it), which
     * is exactly what the chip has been claiming all along.
     */
    $('#sales_new_customer_id,#sales_new_customer_name,#sales_new_customer_address,#sales_new_customer_phone,#sales_new_customer_email,#sales_new_customer_state,#sales_new_customer_gst_type,#sales_new_customer_gst_number,#sales_new_customer_partial_balance').val('');
    PosnicPro.defaultcustomerSet();
    if (PosnicPro.loyalty) PosnicPro.loyalty.tillClear();
    if (PosnicPro.coupons) PosnicPro.coupons.tillClear();
    if (PosnicPro.sales.updateCustomerChip) PosnicPro.sales.updateCustomerChip();

    PosnicPro.sales.sale_offlineadditems = [];
    PosnicPro.sales.editSaleAction = false;
    PosnicPro.sales.editSaleId = '';
    PosnicPro.sales.salesId = '';
    PosnicPro.sales.refundSaleAction = false;
    PosnicPro.sales.refundSaleId = '';
    PosnicPro.sales.EditRecentSaleParams = [];
    PosnicPro.sales.SaleAction = 'add';
    PosnicPro.sales.salesExchange = false;

    // Brand new sale: unpaid toggle must start ON and payment details visible
    PosnicPro.sales.paymentOnlyMode = false;
    $('#unpaid_payment_toggle')
        .prop('disabled', false)
        .prop('checked', true)
        .trigger('change');

    if ($('#sales_new_items_table tbody tr').find(':nth-child(10)').text() === '') {
        $('#sales_new_items_table tbody tr').remove();
        $('#sales_new_items_table tbody').append('<tr class="sales_new_tablerow_content_area" id="sales_new_tablerow_content_area"><td colspan="8"><div class="text-center text-dark"> <p class="table_cart_content"> <lang class="lang_sale_empty">Sale Order Empty</lang></p></div><img src="static/images/general/wallet.svg" class="img-fluid sales-cart-image" style="opacity: 0.4;width: 100%;" alt="wallet"></td></tr>');
        var imgHeight = $(window).height() - 500;
        $('.sales-cart-image').height(imgHeight);
    }
};

PosnicPro.sales.setDefaults = function () {

    // For KOT edit opened via KOT History, prefer "Update" label; for
    // all other contexts (new sale, new KOT, returns, etc.) keep
    // "Save" as the primary action text.
    var isKotEditFlow = (PosnicPro.sales && PosnicPro.sales.saleProcess === 'KOT' &&
        PosnicPro.kotorder && PosnicPro.kotorder.editSaleId);

    // Recognize the kotorder/{id}/edit hash as part of the same
    // dedicated KOT edit flow so that the label remains "Update" even
    // when the user reached the edit screen via KOT table+pax.
    if (!isKotEditFlow && typeof window !== 'undefined' && window.location && window.location.hash) {
        var kotOrderHash = window.location.hash;
        if (kotOrderHash.indexOf('kotorder/') !== -1 && kotOrderHash.indexOf('/edit') !== -1) {
            isKotEditFlow = true;
        }
    }

    if (isKotEditFlow) {
        (PosnicPro.local.get('language_herf') === 'ta_dashboard.html')
            ? $('.changeSalesBtnText').text('\u0baa\u0bc1\u0ba4\u0bc1\u0baa\u0bcd\u0baa\u0bbf')
            : $('.changeSalesBtnText').text('Update');
    } else {
        (PosnicPro.local.get('language_herf') === 'ta_dashboard.html')
            ? $('.changeSalesBtnText').text('\u0b9a\u0bc7\u0bae\u0bbf')
            : $('.changeSalesBtnText').text('Save');
    }

    $('#discount_sale_amount,#tax').text('0.00');
    $('.sales_price_fields').text('0.00').val('0.00');

    // Reset extra discount value and icon state when starting from a clean
    // sale so that "Clear Sale" behaves like a brand new sale screen.
    $('#extraDisc').text(0);
    $('#extraDisc').editable('setValue', 0);
    $('#percentIcon').addClass('d-none');
    $('#rupeeIcon').removeClass('d-none');
    if (PosnicPro.sales && PosnicPro.sales.extraDiscount) {
        PosnicPro.sales.extraDiscount.sale_new_tot = 0;
    }
    $("#sales_return_items_table tbody tr").remove();
    $('#sales_return_items_table tbody').append('<tr class="sales_new_tablerow_content_area" id="sales_new_tablerow_content_area"><td colspan="9"><div class="text-center text-dark"> <p class="table_cart_content"><lang class="lang_empty_return">Return Items Order Empty</lang></p></div></td></tr>');
    $('#sales_description,#payment_description,#discount_description').text('').val('').hide();
    $('#sales_description,#payment_description,#discount_description').editable('setValue', null);
    $('#sales_new_radio_discountamount,#sales_new_radio_discountpercent').text('').val('');
    $('#sales_new_radio_discountamount').editable('setValue', '0');
    $('#sales_new_radio_discountpercent').editable('setValue', '0');
    if (PosnicPro.updateSaleNoteFlag) {
        PosnicPro.updateSaleNoteFlag('click_payment_description', 'feather icon-edit-1', '');
        PosnicPro.updateSaleNoteFlag('click_sales_description', 'feather icon-edit-1', '');
        // the discount note carries the same flag now, so it resets the same
        // way - a tint alone left last sale's note text sitting on screen
        PosnicPro.updateSaleNoteFlag('click_discount_description', 'feather icon-edit-1', '');
    }
    // the chips are rebuilt above, so the lock badges go back on after them
    if (PosnicPro.sales.markLockedActions) { PosnicPro.sales.markLockedActions(); }
    if (PosnicPro.sales.syncActionTooltips) { PosnicPro.sales.syncActionTooltips(); }
    if (PosnicPro.sales.defaultCustomer === true) {
        // second copy of the reset above - same rule: clear the previous
        // customer, then resolve the branch Walk-in so the sale is billable
        $('#sales_new_customer_id,#sales_new_customer_name,#sales_new_customer_address,#sales_new_customer_phone,#sales_new_customer_email,#sales_new_customer_state,#sales_new_customer_gst_type,#sales_new_customer_gst_number').val('');
        PosnicPro.defaultcustomerSet();
    }
    PosnicPro.sales.SaleTableLineItems = [];
    PosnicPro.sales.sale_offlineadditems = [];
    PosnicPro.sales.selectedTable = null;
    PosnicPro.sales.editSaleAction = false;
    PosnicPro.sales.editSaleId = '';
    PosnicPro.sales.salesId = '';
    PosnicPro.sales.refundSaleAction = false;
    PosnicPro.sales.refundSaleId = '';
    PosnicPro.sales.EditRecentSaleParams = [];
    PosnicPro.sales.SaleAction = 'add';
    PosnicPro.sales.salesExchange = false;
    $('table#sales_return_items_table tr#sales_new_tablerow_content_area').remove();
    $("#sales_new_items_table tbody tr").remove();
    $('#sales_new_items_table tbody').append('<tr class="sales_new_tablerow_content_area" id="sales_new_tablerow_content_area"><td colspan="8"><div class="text-center text-dark"> <p class="table_cart_content"><lang class="lang_sale_empty">Sale Order Empty</lang></p></div><img src="static/images/general/wallet.svg" class="img-fluid sales-cart-image" style="opacity: 0.4;width: 100%;" alt="wallet"></td></tr>');
    var imgHeight = $(window).height() - 500;
    $('.sales-cart-image').height(imgHeight);
    db.customerDisplay.where("clear").equals("yes").delete();
    if (PosnicPro.local.get('balance_view') === 'true') {
        $('.salesBalanceAmount,#newsalespage').show();
        $('#sales_save_button,#tenderpage,.cancel-save-hide-show').hide();
    } else {
        $('.salesBalanceAmount').hide();
        $('#sales_save_button').show();
    }
};

// Wrapper used by routes/settings to fully clear the current sale,
// reusing the shared setDefaults logic and optionally showing the
// "Sales cancelled" notification when isFalse is not explicitly false.
PosnicPro.sales.clear = PosnicPro.sales.clear || {};
PosnicPro.sales.clear.cartItems = function (isFalse) {
    /*
     * setDefaults fills the walk-in customer, so NOTHING before it may
     * abort this function - a throw up here is exactly how the sale page
     * ended up demanding a customer name with walk-in already chosen.
     * The cosmetic resets are best-effort; the default is not.
     */
    try {
        PosnicPro.sales.charges = [];
        PosnicPro.sales.renderCharges();
        $('#sales_new_item_name').val('');
        $('.tax-sales-line-total').html('0.00');
        $("#tax").val('').trigger('change');
    } catch (e) {
        if (window.console) { console.error('[sale] cart reset partially failed:', e); }
    }
    PosnicPro.sales.setDefaults();
    PosnicPro.sales.SaleTableLineItems = [];
    PosnicPro.sales.customerViewDisplay();
    $('#sales_new_item_name').focus();
    $('#reset_modal').modal('hide');
    if (isFalse !== false) {
        PosnicPro.alert('success', 'Sale cancelled.');
    }
};
/**** END CLEAR SALES FUNCTION ****/

/******** START ~ ADD SALES PAGE MENU ********/
/**** START SALES PRODUCT MENU *****/

/*
 * Item cache for the billing hot path (S1 feel-fast).
 *
 * Every tap on a product tile did a full GET items/:id before the line
 * appeared in the cart - the slowest moment of the fastest-repeated action
 * in the product. A rush hour is the same few items tapped over and over,
 * so a short cache turns everything after the first tap instant.
 *
 * 60 seconds, then re-fetched; cleared outright when a sale is saved,
 * edited or returned, because those change stock. Staleness within the
 * window is no worse than what already existed: stock moves between
 * add-to-cart and save regardless, and the server enforces stock at save.
 *
 * Serves a deep copy - addSalesLineItems and friends mutate what they are
 * given, and a second tap must not inherit the first tap's mutations.
 * Edit-mode stock checks deliberately bypass this and stay live.
 */
PosnicPro.sales.itemCache = {
    TTL_MS: 60 * 1000,
    _map: {},
    get: function (id, onData) {
        var hit = PosnicPro.sales.itemCache._map[id];
        if (hit && (Date.now() - hit.at) < PosnicPro.sales.itemCache.TTL_MS) {
            onData(JSON.parse(hit.json));
            return;
        }
        PosnicPro.get('items/' + id, function (response) {
            if (response.type === 'success') {
                PosnicPro.sales.itemCache._map[id] = { at: Date.now(), json: JSON.stringify(response.data) };
                onData(JSON.parse(JSON.stringify(response.data)));
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    clear: function () {
        PosnicPro.sales.itemCache._map = {};
    },
};

PosnicPro.sales.itemsMenu = {
    /*sales Product Display*/
    onlineProductList: function () {
        var loader = $(".loader-product");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        $('#sales_new_productList').show();
        $('#sales_new_categoryList').hide();
        PosnicPro.get('items/onlineSalesItemsAjaxLists', function (response) {
            if (response.type === 'success') {
                loader.find(".loadingSpinner:first").remove();
                var getItemdata = response.data;
                $('#item-lists').remove();
                $('#sales_new_productList').append(' <div class="col-md-12" id="item-lists">');
                var currency = PosnicPro.local.get('currencySign');
                /*
                 * Variant families (V1): members of a family collapse into
                 * ONE tile - "Shirt", not five unrelated "Shirt / ..."
                 * tiles - and the tile opens a picker. Only groups with 2+
                 * members present collapse; a lone member stands alone.
                 */
                var families = {};
                (getItemdata || []).forEach(function (it) {
                    var gid = it.variant_group_id;
                    if (gid) { (families[gid] = families[gid] || []).push(it); }
                });
                PosnicPro.sales.itemsMenu._families = families;
                var renderedGroups = {};
                if (getItemdata && getItemdata.length > 0) {
                    /*
                     * One wrapper, carrying the grid class. It used to open a div
                     * and then - on the first pass, the only time i % length is 0 -
                     * close it again and open a plain .row, leaving an EMPTY div
                     * behind and putting every tile in a container the grid rules
                     * did not match. That is why the tiles kept their old layout
                     * however often the CSS was corrected.
                     *
                     * The class must be here: Parked and Recent Sales render into
                     * #item-lists too, so the grid must not claim every child.
                     */
                    var app = "<div class='row sale-tile-grid'>";
                    for (var i = 0; i < getItemdata.length; i++) {
                        var familyGid = getItemdata[i]['variant_group_id'];
                        var familyRows = familyGid && families[familyGid];
                        if (familyRows && familyRows.length > 1) {
                            if (renderedGroups[familyGid]) { continue; }
                            renderedGroups[familyGid] = true;
                            app = app + PosnicPro.sales.itemsMenu._familyTile(familyRows, currency);
                            continue;
                        }
                        var list_item_name = getItemdata[i]['item_name'] ? getItemdata[i]['item_name'] : getItemdata[i]['name'];
                        // the name reaches two attributes and a text node; escape
                        // once. It used to be truncated at 30 chars in JS, which is
                        // why the two-line CSS clamp had nothing to wrap.
                        var _escName = $('<i>').text(list_item_name == null ? '' : list_item_name).html();
                        var price = 0;
                        let sellingPrice = getItemdata[i]['selling_price'];
                        let discountAmount = getItemdata[i]['discount_amount'];
                        let discountPercentage = getItemdata[i]['discount_percentage'];
                        let tax = getItemdata[i]['tax'];
                        let taxType = getItemdata[i]['tax_type'];
                        let taxPrice = (sellingPrice * tax) / (100 + tax);
                        var inclusive_price = sellingPrice - taxPrice.toFixed(2);
                        if (discountAmount > 0 && tax > 0) {
                            var discountValue = 0;
                            if (taxType === 'exclusive') {
                                discountValue = sellingPrice - discountAmount;
                            } else {
                                discountValue = inclusive_price - discountAmount;
                            }
                            price = discountValue + (tax / 100) * discountValue;

                        } else if (discountPercentage > 0 && tax > 0) {
                            var discountValue = 0;
                            var taxValue = 0;
                            if (taxType === 'exclusive') {
                                discountValue = (sellingPrice * (discountPercentage / 100));
                                taxValue = sellingPrice - discountValue;
                            } else {
                                discountValue = (inclusive_price * (discountPercentage / 100));
                                taxValue = inclusive_price - discountValue;
                            }
                            price = taxValue + (tax / 100) * taxValue;
                        } else if (discountAmount > 0) {
                            price = sellingPrice - discountAmount;
                        } else if (discountPercentage > 0) {
                            price = sellingPrice - (sellingPrice * (discountPercentage / 100));
                        } else if (tax > 0) {
                            if (taxType === 'exclusive') {
                                price = sellingPrice + (sellingPrice * tax / 100);
                            } else {
                                price = inclusive_price + (inclusive_price / 100) * tax;
                            }
                        } else {
                            price = getItemdata[i]['selling_price']
                        }
                        var image_path = (getItemdata[i]['image'] !== "item.svg") ? getItemdata[i]['image'] : 'static/images/default/' + getItemdata[i]['image'];
                        let timeZone = PosnicPro.local.get('timezone');
                        let dateTime = new Date().getTime();
                        let currentDateTimeCentralTimeZone = moment(dateTime).tz(timeZone).format('YYYY/MM/DD hh:mm A');
                        let currentDate = new Date().getTime(currentDateTimeCentralTimeZone);
                        let items_expiry_date = getItemdata[i]['items_expiry_date'];
                        if (items_expiry_date >= currentDate || items_expiry_date === null || items_expiry_date === '') {
                            // Subtle, light-grey stock count on the card - only when the item
                            // tracks inventory. Fails safe (shows nothing) if the field is absent.
                            var _trackInv = getItemdata[i]['track_inventory'];
                            var _stockHtml = '';
                            if (_trackInv === true || _trackInv === 'true') {
                                var _aq = getItemdata[i]['available_quantity'];
                                _aq = (_aq === undefined || _aq === null || _aq === '') ? 0 : _aq;
                                _stockHtml = '<div class="text-center wsk-cp-stock">' + _aq + ' in stock</div>';
                            }
                            /* Tile colour (Loyverse study L2): an item without a real
                               image but with a chosen colour renders a coloured tile
                               with its initial - an image always wins. */
                            var _tileHtml = '<div class="wsk-cp-img"><img src="' + image_path + '" alt="Product" class="img-responsive" /></div>';
                            var _rt = PosnicPro.resolveTile(getItemdata[i]);
                            var _tileColor = _rt.color;
                            if (getItemdata[i]['image'] === 'item.svg' && _tileColor) {
                                var _initial = getItemdata[i]['plu_code']
                                    ? String(getItemdata[i]['plu_code'])
                                    : String(list_item_name || '?').trim().charAt(0).toUpperCase();
                                var _shapeCss = PosnicPro.tileShapeCss(_rt.shape || '', '8px');
                                // Same square slot the product image fills, but the shape
                                // sits centered at ~62% with breathing room - the default
                                // illustration has built-in whitespace, and the tile should
                                // read the same visual size (owner report).
                                _tileHtml = '<div class="wsk-cp-img"><div style="width:100%;aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;">' +
                                    '<div style="width:62%;aspect-ratio:1/1;' + _shapeCss + 'background:' + _tileColor + ';display:flex;align-items:center;justify-content:center;color:#fff;font-size:34px;font-weight:700;">' + _initial + '</div>' +
                                    '</div></div>';
                            }
                            var product = '<div class="wsk-cp cbutton--effect-novak" id="' + getItemdata[i]['id'] + '" onclick="PosnicPro.sales.itemsMenu.addToLineItemsList(this.id)">' +
                                '<div class="wsk-cp-product">' +
                                '<div class="description-prod">' +
                                '<p data-searchval="' + _escName + '" data-toggle="tooltip" title="' + _escName + '">' + _escName + '</p>' +
                                '</div>' +
                                _tileHtml +
                                '<div class="wsk-cp-text mt-3">' +
                                '<div class="price-text-color">' +
                                '<div class="text-center"><span class="price">' + currency + '&nbsp;' + price.toFixed(2) + '</span></div>' +
                                '</div>' + _stockHtml +
                                '</div>' +
                                '</div>' +
                                '</div>';
                            app = app + '' + product + '';
                            //app = app + '<a style="padding-right:5px;" href="javascript:void(0)" data-searchval="' + list_item_name + '" class="search-product" data-toggle="tooltip" title="' + list_item_name + " ( Available Stock : " + item_stock + ' )" id="' + getItemdata[i]['id'] + '" onclick="PosnicPro.sales.itemsMenu.addToLineItemsList(this.id)"><div class="product color01 flat-box waves-effect waves-block"><h3 id="proname">' + list_item_name.slice(0, 6) + '</h3><img src=' + image_path + ' alt="no image found"><div class="product_two"><div class="mask"><p> </p><h4>' + currency + '<span class="number">' + getItemdata[i]['selling_price'] + ' </span></h4></div></div></div></a>&nbsp;';
                        }
                    }
                    app = app + '</div>';
                    $('#item-lists').append(app);
                } else {
                    app = "<div class='row'></div><div class='row'></div><div class='text-center text-dark'><p>There are no items available ...!!!</p><a href='#/items/new'>Add New Item</a></div>";
                    $('#item-lists').append(app);
                }
                $('span.number').number(true, 2);
                PosnicPro.sales.itemsMenu.clickEffect();
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    /* One tile for the whole family: parent name, "from" price when the
       members differ, combined stock, a variant-count badge. */
    _familyTile: function (rows, currency) {
        var esc = function (s) {
            return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
                return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
            });
        };
        var parent = rows[0]['variant_parent_name']
            || String(rows[0]['name'] || '').split(' / ')[0];
        var prices = rows.map(function (r) { return Number(r.selling_price) || 0; });
        var minPrice = Math.min.apply(null, prices);
        var differ = Math.max.apply(null, prices) !== minPrice;
        var stock = 0;
        var tracked = false;
        rows.forEach(function (r) {
            if (r.track_inventory === true || r.track_inventory === 'true') {
                tracked = true;
                stock += Number(r.available_quantity) || 0;
            }
        });
        var image = (rows[0]['image'] !== 'item.svg')
            ? rows[0]['image'] : 'static/images/default/' + rows[0]['image'];
        var stockHtml = tracked
            ? '<div class="text-center wsk-cp-stock">' + stock + ' in stock</div>' : '';
        return '<div class="wsk-cp wsk-variant cbutton--effect-novak" ' +
            'onclick="PosnicPro.sales.itemsMenu.openVariantPicker(\'' + esc(rows[0]['variant_group_id']) + '\')">' +
            '<div class="wsk-cp-product">' +
            '<div class="description-prod">' +
            '<p data-searchval="' + esc(parent) + '" data-toggle="tooltip" title="' + esc(parent) + '">' +
            esc(parent) +
            ' <span class="badge badge-light">' + rows.length + '</span></p>' +
            '</div>' +
            '<div class="wsk-cp-img"><img src="' + esc(image) + '" alt="Product" class="img-responsive" /></div>' +
            '<div class="wsk-cp-text mt-3">' +
            '<div class="price-text-color">' +
            '<div class="text-center"><span class="price">' + (differ ? 'from ' : '') +
            currency + '&nbsp;' + minPrice.toFixed(2) + '</span></div>' +
            '</div>' + stockHtml +
            '</div>' +
            '</div>' +
            '</div>';
    },
    /* The picker: tap a variant, it lands on the sale like any tile tap. */
    openVariantPicker: function (groupId) {
        var rows = (PosnicPro.sales.itemsMenu._families || {})[groupId] || [];
        if (!rows.length) { return; }
        var esc = function (s) {
            return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
                return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
            });
        };
        var currency = PosnicPro.local.get('currencySign');
        var parent = rows[0]['variant_parent_name']
            || String(rows[0]['name'] || '').split(' / ')[0];
        var list = '';
        rows.forEach(function (r) {
            var label = r.variant_value || String(r.name || '').split(' / ').slice(1).join(' / ') || r.name;
            var tracked = r.track_inventory === true || r.track_inventory === 'true';
            var stock = tracked
                ? '<small class="text-muted ml-2">' + (Number(r.available_quantity) || 0) + ' in stock</small>' : '';
            list += '<a href="javascript:void(0);" class="list-group-item list-group-item-action d-flex justify-content-between align-items-center" ' +
                'onclick="PosnicPro.sales.itemsMenu.pickVariant(\'' + esc(r.id) + '\');">' +
                '<span>' + esc(label) + stock + '</span>' +
                '<span class="price">' + currency + '&nbsp;' + (Number(r.selling_price) || 0).toFixed(2) + '</span>' +
                '</a>';
        });
        $('#variant_picker_modal').remove();
        $('body').append(
            '<div class="modal fade close_on_esc" id="variant_picker_modal" tabindex="-1" role="dialog" aria-hidden="true">' +
            '<div class="modal-dialog modal-sm" role="document"><div class="modal-content">' +
            '<div class="modal-header"><h5 class="modal-title">' + esc(parent) + '</h5>' +
            '<button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button></div>' +
            '<div class="modal-body p-0"><div class="list-group list-group-flush">' + list + '</div></div>' +
            '</div></div></div>'
        );
        $('#variant_picker_modal').modal('show');
    },
    pickVariant: function (item_id) {
        $('#variant_picker_modal').modal('hide');
        PosnicPro.sales.itemsMenu.addToLineItemsList(item_id);
    },
    addToLineItemsList: function (item_id) {
        PosnicPro.sales.itemCache.get(item_id, function (item) {
            $("#save_submit").removeClass("disabled");
            let hash = window.location.hash.slice(1);
            if (hash === '/sales/new') {
                db.saleAutoFocus.get('1').then(function (data) {
                    if (data.addSale === true) {
                        $('#sales_new_item_name').focus();
                    } else {
                        $('#sales_new_item_name').blur();
                    }
                });
            }
            PosnicPro.sales.itemsMenu.clickEffect();
            PosnicPro.sales.addSalesLineItems(item);
        });
    },
    clickEffect: function () {

        var support = { animations: Modernizr.cssanimations },
            animEndEventNames = { 'WebkitAnimation': 'webkitAnimationEnd', 'OAnimation': 'oAnimationEnd', 'msAnimation': 'MSAnimationEnd', 'animation': 'animationend' },
            animEndEventName = animEndEventNames[Modernizr.prefixed('animation')],
            onEndAnimation = function (el, callback) {
                var onEndCallbackFn = function (ev) {
                    if (support.animations) {
                        if (ev.target != this)
                            return;
                        this.removeEventListener(animEndEventName, onEndCallbackFn);
                    }
                    if (callback && typeof callback === 'function') {
                        callback.call();
                    }
                };
                if (support.animations) {
                    el.addEventListener(animEndEventName, onEndCallbackFn);
                } else {
                    onEndCallbackFn();
                }
            },
            eventtype = PosnicPro.sales.itemsMenu.mobilecheck() ? 'touchstart' : 'click';

        [].slice.call(document.querySelectorAll('.wsk-cp')).forEach(function (el) {
            el.addEventListener(eventtype, function (ev) {
                classie.add(el, 'cbutton--click');
                onEndAnimation(classie.has(el, 'cbutton--complex') ? el.querySelector('.cbutton__helper') : el, function () {
                    classie.remove(el, 'cbutton--click');
                });
            });
        });
    },
    mobilecheck: function () {
        var check = false;
        (function (a) {
            if (/(android|ipad|playbook|silk|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows (ce|phone)|xda|xiino/i.test(a) || /1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas\-|your|zeto|zte\-/i.test(a.substr(0, 4)))
                check = true
        })(navigator.userAgent || navigator.vendor || window.opera);
        return check;
    }
};
/******** END SALES PRODUCT MENU ********/

/******** START SALES CATEGORY MENU vs CATEGORY'S ITEMS SUB MENU ********/
PosnicPro.sales.categoryMenu = {
    /* --------------------------
     * GET SALES CATEGORY TAGS (OLD FORMAT)
     * -------------------------- */
    listCategories: function () {
        var loader = $(".loader-category");
        $("<div class='loadingSpinner'></div>").appendTo(loader);

        $('#sales_new_productList').hide();
        $('#sales_new_categoryList').show();

        PosnicPro.get('categories/getCategoriesWithValidItems', function (response) {
            if (response.type === 'success') {
                loader.find(".loadingSpinner:first").remove();
                var categorydata = response.data;

                $('#item-lists').remove();
                $('#category-lists').remove();
                $('#sales_new_categoryList').append('<div class="col col-xs-12" id="category-lists">');

                if (categorydata.length > 0) {
                    var app = "<div class='row sale-tile-grid'>";
                    for (var i = 0; i < categorydata.length; i++) {

                        if (i > 0 && i % 4 === 0) {
                            app += "</div><div class='row'>";
                        }

                        var list_category_name = categorydata[i]['category_name'];
                        var image_path = (categorydata[i]['category_img'] !== "category.svg")
                            ? categorydata[i]['category_img']
                            : 'static/images/default/' + categorydata[i]['category_img'];
                        var _cat = PosnicPro.sales._catTiles[String(categorydata[i]['id'] || '')];

                        app += '<div class="wsk-cp cbutton--effect-novak col-lg-3 col-md-4 col-sm-6 col-12 mb-3" ' +
                            'id="' + categorydata[i]['id'] + '" ' +
                            'onclick="PosnicPro.sales.categoryMenu.listItems(this.id)">' +
                            '<div class="wsk-cp-product">' +
                            '<div class="description-prod">' +
                            '<p data-searchval="' + list_category_name + '">' + list_category_name + '</p>' +
                            '</div>' +
                            '<div class="wsk-cp-img">' +
                            '<img src="' + image_path + '" alt="Category" class="img-responsive" />' +
                            '</div></div></div>';
                    }
                    app += "</div>";
                    $('#category-lists').append(app);
                } else {
                    $('#category-lists').append("<div class='text-center text-dark'><p>No categories found with available or negative-stock items.</p></div>");
                }

                PosnicPro.sales.itemsMenu.clickEffect();

            } else {
                PosnicPro.alert(response.type, response.message);
            }

        }, 'json');
    },

    /* --------------------------
     * GET SALES CATEGORY PRODUCTS (OLD FORMAT)
     * -------------------------- */
    listItems: function (categoryId) {
        $('.product-category').removeClass('category-focused');
        $('#category' + categoryId).addClass('category-focused');

        var params = {
            url: 'items/getItemsByCategoryId',
            data: { category_id: categoryId }
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                var data = response.data || [];

                $('#item-lists').remove();
                $('#category-lists').remove();
                $('#sales_new_categoryList').append('<div class="col col-xs-12" id="item-lists">');

                var currency = PosnicPro.local.get('currencySign') || '';
                var app = '<div class="row mb-3 sale-tile-grid">' +
                    '<button type="button" class="btn btn-dark-rgba font-18" onclick="PosnicPro.sales.categoryMenu.listCategories();">' +
                    '<i class="feather icon-arrow-left profile_left_slide slick-arrow mr-2"></i></button></div><div class="row">';

                var timeZone = PosnicPro.local.get('timezone') || 'Asia/Kolkata';
                var currentTimestamp = moment().tz(timeZone).valueOf();

                var shown = 0;
                for (var i = 0; i < data.length; i++) {
                    var item = data[i];
                    var qty = parseFloat(item.available_quantity) || 0;
                    var allowNegative = item.negative_stock === true;
                    var expiry = item.items_expiry_date;
                    var expiryValid = (expiry === null || expiry === '' || expiry >= currentTimestamp);
                    var showItem = (qty > 0 || allowNegative) && expiryValid;

                    if (showItem) {
                        if (shown > 0 && shown % 4 === 0) {
                            app += '</div><div class="row">';
                        }

                        var image_path = (item.image && item.image !== "item.svg")
                            ? item.image
                            : 'static/images/default/item.svg';

                        app += '<div class="wsk-cp cbutton--effect-novak col-lg-3 col-md-4 col-sm-6 col-12 mb-3" ' +
                            'id="' + item.item_id + '" ' +
                            'onclick="PosnicPro.sales.itemsMenu.addToLineItemsList(this.id)">' +
                            '<div class="wsk-cp-product h-100">' +
                            '<div class="description-prod text-center">' +
                            '<p data-searchval="' + item.item_name + '" title="' + item.item_name + '">' +
                            item.item_name + '</p></div>' +
                            '<div class="wsk-cp-img text-center">' +
                            '<img src="' + image_path + '" alt="Product" class="img-fluid rounded" style="max-height:120px;" />' +
                            '</div><div class="wsk-cp-text mt-3 text-center">' +
                            '<span class="price">' + currency + ' ' + parseFloat(item.selling_price).toFixed(2) + '</span>' +
                            '</div></div></div>';

                        shown++;
                    }
                }

                app += "</div>";

                if (shown === 0) {
                    app = "<div class='text-center text-dark'><p>No items found for this category.</p></div>";
                }

                $('#item-lists').append(app);
                PosnicPro.sales.itemsMenu.clickEffect();

            } else {
                PosnicPro.alert(response.type, response.message);
            }

        }, 'json').fail(function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    }
};
PosnicPro.sales.recentMenu = {
    /*Touchsale recent Sales details*/
    salesList: function () {
        var loader = $(".loader-product");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        $('#sales_new_productList').show();
        $('#sales_new_categoryList').hide();
        $('#item-lists').remove();
        $('#sales_new_productList').append(' <div id="item-lists" style="margin-left: 7px;"/>');
        $('#item-lists').append("<div id='recent_sales_list' class='m-b-30'></div>");
        PosnicPro.get('sales/getLatestSales', function (response) {
            if (response.type === 'success') {
                PosnicPro.sales.recentSaleAction = true;
                loader.find(".loadingSpinner:first").remove();
                var item_data = jQuery.parseJSON(response.data);
                var currency = PosnicPro.local.get('currencySign');
                var esc = function (v) { return $('<i>').text(v == null ? '' : v).html(); };
                var ago = function (d) {
                    if (!d) { return ''; }
                    var mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
                    if (mins < 1) { return 'just now'; }
                    if (mins < 60) { return mins + 'm ago'; }
                    if (mins < 1440) { return Math.round(mins / 60) + 'h ago'; }
                    return Math.round(mins / 1440) + 'd ago';
                };
                $('#recent_sales_list').html('');
                if (item_data.length > 0) {
                    var listHtml = '';
                    $(item_data).each(function (index, params) {
                        var id = params.sales_document_id;
                        var paymentStatus = params.payment_status || '';
                        var isPaid = (String(paymentStatus).toLowerCase() === 'paid');
                        var kotEnabled = (PosnicPro.local.get('table_options') === 'enable');
                        var editIcon = (isPaid || kotEnabled)
                            ? ''
                            : '<a data-module="sales" data-access="write" href="#/sales/' + id + '/edit" class="rs-act btn-success-rgba" data-toggle="tooltip" title="Edit"><i class="feather icon-edit-2"></i></a>';
                        var returnIcon = kotEnabled
                            ? ''
                            : '<a data-module="sales" data-access="write" href="#/sales/' + id + '/return" class="rs-act btn-secondary-rgba" data-toggle="tooltip" title="Return"><i class="feather icon-corner-up-left"></i></a>';
                        var deleteIcon = kotEnabled
                            ? ''
                            : '<a data-module="sales" data-access="delete" href="#/sales/' + id + '/delete" class="rs-act btn-danger-rgba" data-toggle="tooltip" title="Delete"><i class="feather icon-trash"></i></a>';
                        var isParked = (String(params.sale_process) === 'Hold');
                        var retrieveIcon = isParked
                            ? '<a data-module="sales" data-access="write" href="#/sales/' + id + '/hold" class="rs-act btn-success-rgba" data-toggle="tooltip" title="Retrieve parked sale"><i class="feather icon-play-circle"></i></a>'
                            : '';
                        if (isParked) { editIcon = ''; returnIcon = ''; }
                        var pill = isParked
                            ? '<span class="rs-pill hold">Parked</span>'
                            : isPaid
                                ? '<span class="rs-pill paid">Paid</span>'
                                : '<span class="rs-pill unpaid">' + esc(paymentStatus || 'Unpaid') + '</span>';
                        var when = '';
                        try { when = ago(PosnicPro.mongoIdToDate(id)); } catch (e) { /* no time, no label */ }
                        var meta = [esc(params.sales_id), params.number_of_items + ' item' + (params.number_of_items === 1 ? '' : 's')];
                        if (when) { meta.push(when); }
                        listHtml += '<div class="rs-row highlight-select" id="recent_sales_table_row_' + id + '">' +
                            '<div class="rs-main">' +
                            '<div class="rs-cust">' + esc(params.customer_name || 'Walk-in') + '</div>' +
                            '<div class="rs-meta">' + meta.join(' &middot; ') + '</div>' +
                            '</div>' +
                            '<div class="rs-side">' +
                            '<div class="rs-amt">' + currency + '&nbsp;' + Number(params.total_amount || 0).toFixed(2) + '</div>' + pill +
                            '</div>' +
                            '<div class="rs-actions">' +
                            '<a data-module="sales" data-access="read" href="#/sales/' + id + '" class="rs-act btn-primary-rgba" data-toggle="tooltip" title="View"><i class="feather icon-eye"></i></a>' +
                            retrieveIcon + editIcon + returnIcon + deleteIcon +
                            '</div></div>';
                    });
                    $('#recent_sales_list').html(listHtml);
                    PosnicPro.ACLForModule('sales');
                } else {
                    $('#recent_sales_list').html('<div class="text-center text-muted p-t-30 p-b-30">No sales yet today - they will appear here as you bill.</div>');
                }
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    editItems: function (id, data, sale) {
        PosnicPro.sales.defaultCustomer = false;
        PosnicPro.sales.setDefaults();

        // When opening a Sales Return from history (sale === 'return'),
        // always show the return item selection screen first and NEVER
        // reuse any previous payment-only tender mode. This prevents
        // flows like KOT payment-only from causing the first Return
        // click in Sales History to jump directly to the tender page.
        if (sale === 'return') {
            PosnicPro.sales.paymentOnlyMode = false;
            PosnicPro.sales.originalSaleData = null;
        }

        var result = data;
        if (sale === 'edit') {
            var extra_discount = (typeof result.extra_discount !== 'undefined' && result.extra_discount !== null) ? result.extra_discount : 0;
            var extra_discount_type = result.extra_discount_type || 'price';
            $('#extraDisc').text(extra_discount);
            $('#extraDisc').editable('setValue', extra_discount);
            PosnicPro.sales.view.changeExtraDiscType(extra_discount_type);
            if (extra_discount !== 0) {
                $('.addDisc-hide-show').show();
                if (PosnicPro.sales.syncNotesCellSpan) { PosnicPro.sales.syncNotesCellSpan(); }
            } else {
                $('.addDisc-hide-show').hide();
                if (PosnicPro.sales.syncNotesCellSpan) { PosnicPro.sales.syncNotesCellSpan(); }
        if (PosnicPro.sales.syncNotesCellSpan) { PosnicPro.sales.syncNotesCellSpan(); }
            }
            $('#extraDisc').prop('disabled', false);
            $('#extraDisc').removeClass('extraDisc');
        }
        $("#sales_new_customer_state").val(result.customer_state);
        $("#sales_new_customer_country").val(result.customer_country);
        PosnicPro.sales.EditRecentSaleParams = {

            "sale_inline_item_price": result.item_price,
            "sale_inline_discount_value": result.sale_inline_discount_value,
            "sale_inline_discount_pervalue": result.sale_inline_discount_pervalue,
            "sale_process": result.sale_process,
            "customer_id": result.customer_id,
            "customer_name": result.customer_name,
            "customer_address": result.customer_address,
            "customer_phone": result.customer_phone,
            "customer_email": result.customer_email,
            "customer_state": result.customer_state,
            "customer_country": result.customer_country,
            "customer_gst_type": result.customer_gst_type,
            "customer_gst_number": result.customer_gst_number,
            "customer_partial": (typeof result.customer_partial !== 'undefined' && result.customer_partial !== null)
                ? (result.customer_partial === true || String(result.customer_partial).toLowerCase() === 'true')
                : false,
            "sales_new_customer_partial_balance": result.partial_check,
            "customer_balance": result.customer_balance,
            "partial_amounts": result.partial_balance,
            "wallet_amount": result.wallet_amount,
            "payment_mode": (!!(result.payment_mode)) ? result.payment_mode : 'Cash',
            "payment_description": result.payment_description,
            "sales_description": result.sales_description,
            "discount_description": result.discount_description,
            "tax": result.tax,
            "discount": result.discount,
            "user_id": result.user_id,
            "user_name": result.user_name,
            "payment_pending": result.payment_pending,
            "payment_status": result.payment_status,
            "partial_check": result.partial_check,
            "multi_payment": result.multi_payment,
            "sales_total": result.sales_total,
            // "table_id": result.table_id,
            "table_number": result.table_number,
            "person_count": result.person_count,
            "dine_type": result.dine_type || 'Dine-in',
            // Preserve person count (pax) for KOT / dine-in flows
            "person_count": (typeof result.person_count !== 'undefined' && result.person_count !== null)
                ? result.person_count
                : null,
            "denomination_values": result.denomination_values || []
        };

        // Ensure edit/payment flows (including KOT History) have customer fields
        // populated in the DOM so customer_id is never empty in requests.
        $('#sales_new_customer_id').val(result.customer_id || '');
        $('#sales_new_customer_name').val(result.customer_name || '');
        $('#sales_new_customer_address').val(result.customer_address || '');
        $('#sales_new_customer_phone').val(result.customer_phone || '');
        $('#sales_new_customer_email').val(result.customer_email || '');
        $('#sales_new_customer_state').val(result.customer_state || '');
        if (PosnicPro.sales.updateCustomerChip) PosnicPro.sales.updateCustomerChip();
        $('#sales_new_customer_country').val(result.customer_country || '');
        $('#sales_new_customer_gst_type').val(result.customer_gst_type || '');
        $('#sales_new_customer_gst_number').val(result.customer_gst_number || '');
        // Set customer partial_balance field for payment modal to show wallet/due sections
        // Payment modal checks for 'true' string at line 1422, so set 'true' if partial customer
        var rawCustomerPartial;
        if (PosnicPro.sales.paymentOnlyMode === true &&
            (result.customer_partial === true || String(result.customer_partial).toLowerCase() === 'true')) {
            rawCustomerPartial = true;
        } else {
            rawCustomerPartial = result.partial_check;
        }
        var customerPartialStatus = (rawCustomerPartial === true || String(rawCustomerPartial).toLowerCase() === 'true') ? 'true' : 'false';
        $('#sales_new_customer_partial_balance').val(customerPartialStatus);
        $('#customer_current_balance').val(result.customer_balance || 0);

        var status = PosnicPro.sales.EditRecentSaleParams.payment_status || 'Paid';
        var normalizedStatus = String(status).toLowerCase();
        // Treat anything that is NOT clearly unpaid/cancelled as Paid (includes Partially Paid)
        var isUnpaidLike = (normalizedStatus.indexOf('unpaid') !== -1 || normalizedStatus.indexOf('cancel') !== -1);
        var isPaidForToggle = !isUnpaidLike;
        $('#unpaid_payment_toggle')
            .prop('disabled', false)
            .prop('checked', isPaidForToggle)
            .trigger('change');

        PosnicPro.sales.dineType = PosnicPro.sales.EditRecentSaleParams.dine_type;
        $('#sale_dine_type').val(PosnicPro.sales.dineType);
        if (PosnicPro.sales.dineType === 'Dine-in') {
            $('#dinein_label').addClass('active');
            $('#takeaway_label').removeClass('active');
            $('#dine_type_dinein').prop('checked', true);
            $('#dine_type_takeaway').prop('checked', false);
        } else {
            $('#dinein_label').removeClass('active');
            $('#takeaway_label').addClass('active');
            $('#dine_type_dinein').prop('checked', false);
            $('#dine_type_takeaway').prop('checked', true);
        }
        if (result.table_number) {
            PosnicPro.sales.selectedTable = {
                // id: result.table_id,
                tableNumber: result.table_number
            };
        } else {
            PosnicPro.sales.selectedTable = null;
        }
        PosnicPro.sales.selectedPerson = result.person_count;
        if (result.person_count) {
            PosnicPro.sales.EditRecentSaleParams.person_count = result.person_count;
        }
        var EditRecentSaleItems = result.items;
        var lineItem = [];
        PosnicPro.sales.SaleAction = sale;
        if (sale === 'return') {
            PosnicPro.commonDate();
            /*For checking Recent Sale action in addline items*/
            PosnicPro.sales.refundSaleAction = true;
            /* recent Sale Document Id store in array recentSaleId*/
            PosnicPro.sales.refundSaleId = id;
            PosnicPro.sales.salesId = result.sales_id;
            $.each(EditRecentSaleItems, function (key, val) {
                lineItem = {
                    "sale_inline_item_price": val.item_price,
                    "return": val.return,
                    "item_id": val.item_id,
                    "item_name": val.item_name,
                    "selling_price": val.item_price,
                    "itemid": val.barcode_id,
                    "item_quantity": val.item_quantity,
                    "item_available_quantity": val.item_available_quantity,
                    "company_price": val.company_price_total,
                    "sale_inline_discount_value": val.sale_inline_discount_value,
                    "sale_inline_discount_pervalue": val.sale_inline_discount_pervalue,
                    "discount_amount": val.item_discount,
                    "discount_percentage": val.item_discount_percentage,
                    "tax": val.tax,
                    "tax_type": val.tax_type,
                    "category_id": val.category_id,
                    "category_name": val.category_name,
                    "supplier_id": val.supplier_id,
                    "supplier_name": val.supplier_name,
                    "sales_type": val.item_status,
                    "unit": val.item_unit
                };
                PosnicPro.sales.addSalesLineItems(lineItem);
            });
        } else {
            PosnicPro.commonEditDate(result.date);
            /*For checking Edit Sale action in addline items*/
            PosnicPro.sales.editSaleAction = true;
            /* Edit Sale Document Id store in array editSaleId*/
            PosnicPro.sales.editSaleId = id;
            $('.highlight-select').removeClass('table-highlight-row');
            /*Table Blinking*/
            var row = "recent_sales_table_row_" + id;
            $("#" + row + '').addClass('table-highlight-row');
        }
        PosnicPro.sales.salesId = result.sales_id;
        $.each(EditRecentSaleItems, function (key, val) {
            lineItem = {
                "sale_inline_item_price": val.item_price,
                "item_id": val.item_id,
                "item_name": val.item_name,
                "selling_price": val.item_price,
                "itemid": val.barcode_id,
                "item_quantity": val.item_quantity,
                "available_quantity": val.item_available_quantity,
                "company_price": val.company_price_total,
                "sale_inline_discount_value": val.sale_inline_discount_value,
                "sale_inline_discount_pervalue": val.sale_inline_discount_pervalue,
                "discount_amount": val.item_discount,
                "discount_percentage": val.item_discount_percentage,
                "tax": val.tax,
                "tax_type": val.tax_type,
                "category_id": val.category_id,
                "category_name": val.category_name,
                "supplier_id": val.supplier_id,
                "supplier_name": val.supplier_name,
                "sales_type": val.item_status,
                "track_inventory": val.track_inventory,
                "negative_stock": (typeof (val.negative_stock) === "undefined" || val.negative_stock === null) ? false : val.negative_stock,
                "unit": val.item_unit,
                "item_description": (typeof (val.item_description) !== "undefined" && val.item_description !== null) ? val.item_description : ''
            };
            PosnicPro.sales.addSalesLineItems(lineItem);
        });
        $('#sales_description').val(PosnicPro.sales.EditRecentSaleParams.sales_description).hide();

        // If we arrived here via payment-only mode (Unpaid payment icon), directly
        // open the tender/payment popup once the edit view has been fully
        // initialized. This reuses the standard openTenderModel flow.
        if (PosnicPro.sales.paymentOnlyMode === true) {
            PosnicPro.sales.openTenderModel();
        }
    },
    setEditSalesDetails: function () {
        if (PosnicPro.sales.EditRecentSaleParams.payment_description === '') {
            $('#payment_description').text('').val('').hide();
            PosnicPro.updateSaleNoteFlag('click_payment_description', 'feather icon-edit-1', '');
        } else {
            $('#payment_description').val(PosnicPro.sales.EditRecentSaleParams.payment_description).hide();
            $('#payment_description').editable('setValue', PosnicPro.sales.EditRecentSaleParams.payment_description);
            PosnicPro.updateSaleNoteFlag('click_payment_description', 'feather icon-edit-1', PosnicPro.sales.EditRecentSaleParams.payment_description);
        }

        if (PosnicPro.sales.EditRecentSaleParams.sales_description === '') {
            $('#sales_description').text('').val('').hide();
            PosnicPro.updateSaleNoteFlag('click_sales_description', 'feather icon-edit-1', '');
        } else {
            $('#sales_description').val(PosnicPro.sales.EditRecentSaleParams.sales_description).hide();
            $('#sales_description').editable('setValue', PosnicPro.sales.EditRecentSaleParams.sales_description);
            PosnicPro.updateSaleNoteFlag('click_sales_description', 'feather icon-edit-1', PosnicPro.sales.EditRecentSaleParams.sales_description);
        }

        if (PosnicPro.sales.EditRecentSaleParams.discount_description === '') {
            $('#discount_description').text('').val('').hide();
            $('#click_discount_description').css({ color: '#506fe4' });
        } else {
            $('#discount_description').val(PosnicPro.sales.EditRecentSaleParams.discount_description).hide();
            $('#discount_description').editable('setValue', PosnicPro.sales.EditRecentSaleParams.discount_description);
            $('#click_discount_description').css({ color: '#5fd799' });
        }

        // For KOT edit screens opened from KOT History (kotsales/{id}/edit),
        // always show "Update" as the primary action, even if the original
        // sale_process was "Hold". Other edit flows keep the existing
        // behaviour of using "Save" for Hold sales.
        var isKotEditFlow = (PosnicPro.sales && PosnicPro.sales.saleProcess === 'KOT' &&
            PosnicPro.kotorder && PosnicPro.kotorder.editSaleId);
        if (!isKotEditFlow && typeof window !== 'undefined' && window.location && window.location.hash) {
            var kotHash = window.location.hash;
            if ((kotHash.indexOf('kotorder/') !== -1 || kotHash.indexOf('kotsales/') !== -1) &&
                kotHash.indexOf('/edit') !== -1) {
                isKotEditFlow = true;
            }
        }

        // Treat KOT History payment-only settlement as a KOT edit context so that
        // we refresh the sale date/time to the current time before saving.
        if (!isKotEditFlow && PosnicPro.sales && PosnicPro.sales.kotPaymentMode === true &&
            PosnicPro.sales.paymentOnlyMode === true &&
            PosnicPro.sales.EditRecentSaleParams &&
            PosnicPro.sales.EditRecentSaleParams.sale_process === 'KOT') {
            isKotEditFlow = true;
        }

        if (isKotEditFlow || PosnicPro.sales.EditRecentSaleParams.sale_process !== 'Hold') {
            db.saleAutoFocus.get('1').then(function (data) {
                if (data.editSale === true) {
                    $('#sales_new_item_name').focus();
                } else {
                    $('#sales_new_item_name').blur();
                }
            });

            // For all KOT edit screens (including kotorder/{id}/edit and
            // kotsales/{id}/edit), always show "Update" as the primary
            // action label.
            if (PosnicPro && PosnicPro.local && PosnicPro.local.get('language_herf') === 'ta_dashboard.html') {
                $(".changeSalesBtnText").text('புதுப்பி');
            } else {
                $(".changeSalesBtnText").text('Update');
            }

            // And use the *current* date/time as the updated date instead of
            // the original sale date when we are in a KOT edit flow.
            if (isKotEditFlow) {
                $('#time-format').addClass('commonDate');
                $('#time-format').removeClass('commonEditDate');
                if (typeof PosnicPro.commonDate === 'function') {
                    PosnicPro.commonDate();
                }
            } else if (!PosnicPro.sales.paymentOnlyMode &&
                PosnicPro.sales.EditRecentSaleParams &&
                (PosnicPro.sales.EditRecentSaleParams.sale_process === 'Add' ||
                    PosnicPro.sales.EditRecentSaleParams.sale_process === 'Edit')) {

                // Normal Edit Sale (non-KOT, non-Hold, non payment-only): align
                // the sale date/time with the current date/time, similar to the
                // Add New Sale page.
                // $('#time-format').addClass('commonDate');
                // $('#time-format').removeClass('commonEditDate');
                // if (typeof PosnicPro.commonDate === 'function') {
                //     PosnicPro.commonDate();
                // }
            }
        } else {
            db.saleAutoFocus.get('1').then(function (data) {
                if (data.holdSale === true) {
                    $('#sales_new_item_name').focus();
                } else {
                    $('#sales_new_item_name').blur();
                }
            });

            if (PosnicPro && PosnicPro.local && PosnicPro.local.get('language_herf') === 'ta_dashboard.html') {
                $(".changeSalesBtnText").text('சேமி');
            } else {
                $(".changeSalesBtnText").text('Save');
            }

            $('#closeSaleButton').hide();
            $(".vertical-layout").addClass("toggle-menu");
            $('#time-format').addClass('commonDate');
            $('#time-format').removeClass('commonEditDate');
            PosnicPro.commonDate();
        }

        if (PosnicPro.sales && typeof PosnicPro.sales.ensureKotEditButtonLabel === 'function') {
            PosnicPro.sales.ensureKotEditButtonLabel();
        }
    },
    recentSalesTabDetails: function () {
        if ($('a#parked-tab-justified').hasClass('active')) {
            PosnicPro.sales.parkedMenu.list();
        } else if ($('a#contact-tab-justified').hasClass('active')) {
            PosnicPro.sales.recentSaleAction = true;
            PosnicPro.sales.recentMenu.salesList();
        } else if ($('a#profile-tab-justified').hasClass('active')) {
            PosnicPro.sales.recentSaleAction = false;
            PosnicPro.sales.categoryMenu.listCategories();
        } else {
            PosnicPro.sales.recentSaleAction = false;
            PosnicPro.sales.itemsMenu.onlineProductList();
        }
    }

};
/*
 * Parked sales (owner ask): held sales live one tab away from the items,
 * so a busy till parks and resumes without leaving the billing screen.
 * List = the recent-sales endpoint with type=hold (holds only, up to 20);
 * resume = the existing hold route.
 */
PosnicPro.sales.parkedMenu = {
    list: function () {
        var loader = $(".loader-product");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        $('#sales_new_productList').show();
        $('#sales_new_categoryList').hide();
        $('#item-lists').remove();
        $('#sales_new_productList').append(' <div id="item-lists" style="margin-left: 7px;"/>');
        $('#item-lists').append(
            "<div class='m-b-30'><div class='wishlist-box'><div class='table-responsive'><table id='parked_sales_table' class='table table-borderless' cellpadding='1'>" +
            "<thead><tr><th scope='col'>Customer</th><th scope='col' class='text-center'>Items</th><th scope='col' class='text-center'>Total</th><th scope='col' class='text-center'>Parked</th><th scope='col' class='text-center'>Resume</th></tr></thead>" +
            "<tbody></tbody></table></div></div></div>");
        PosnicPro.get('sales/getLatestSales?type=hold', function (response) {
            loader.find(".loadingSpinner:first").remove();
            var rows = [];
            try { rows = jQuery.parseJSON(response.data) || []; } catch (e) { rows = []; }
            var currency = PosnicPro.local.get('currencySign');
            var esc = function (v) { return $('<i>').text(v == null ? '' : v).html(); };
            if (!rows.length) {
                $('#parked_sales_table tbody').html(
                    "<tr><td colspan='5' class='text-center text-muted p-t-20'>Nothing parked - press Hold on a sale and it waits here.</td></tr>");
                return;
            }
            /* Newest first. The server already sorts that way, but a parked
               sale that has been waiting since yesterday matters more than
               where it happens to sit in a list, so the order is made
               explicit rather than inherited. */
            rows.sort(function (a, b) {
                return new Date(b.parked_at || 0) - new Date(a.parked_at || 0);
            });
            var html = '';
            $(rows).each(function (i, r) {
                var waited = PosnicPro.sales.parkedAgo(r.parked_at);
                html += '<tr>' +
                    '<td>' + esc(r.customer_name || 'Walk-in') + '<br><small class="text-muted">' + esc(r.sales_id || '') + '</small></td>' +
                    '<td class="text-center">' + esc(r.number_of_items) + '</td>' +
                    '<td class="text-center">' + currency + '&nbsp;' + Number(r.total_amount || 0).toFixed(2) + '</td>' +
                    '<td class="text-center"><span class="parked-ago' + (waited.stale ? ' stale' : '') + '" title="' + esc(waited.exact) + '">' + esc(waited.text) + '</span></td>' +
                    '<td class="text-center"><a href="#/sales/' + esc(r.sales_document_id) + '/hold" class="btn btn-success-rgba btn-sm" title="Resume this sale"><i class="feather icon-play"></i></a></td>' +
                    '</tr>';
            });
            $('#parked_sales_table tbody').html(html);
        }, function () {
            loader.find(".loadingSpinner:first").remove();
            $('#parked_sales_table tbody').html(
                "<tr><td colspan='5' class='text-center text-muted p-t-20'>Could not load parked sales - try again.</td></tr>");
        });
    }
};
/*
 * Quotes (LS2): list and view here; a quote is BORN on the sale screen
 * (Save as quote) and DIES into a sale (Convert). v1 converts at the
 * items' CURRENT prices - honest to today's pricing; quoted-price
 * override is a noted follow-up. Feature-gated by quotes_enable.
 */
PosnicPro.quotes = {
    _rows: [],
    _status: '',
    _esc: function (v) { return $('<i>').text(v == null ? '' : v).html(); },
    _money: function (n) { return (PosnicPro.local.get('currencySign') || '') + '&nbsp;' + Number(n || 0).toFixed(2); },
    showDataTablePage: function () {
        PosnicPro.HideSideBarModal();
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $('.vertical-menu li a').removeClass('active');
        $('.page_loader,#osk-container').hide();
        $('.page-title-box,#quotes_new').show();
        $('#quotes_view_card,#quotes_edit_card').hide();
        $('#quotes_list_card').show();
        // back to the plain full-width list
        $('#quotes_new .contentbar').removeClass('quotes-split rail-collapsed');
        $('#quotes_list_rows tr.quotes-row').removeClass('is-active');
        $('.vertical-layout').removeClass('toggle-menu');
        $('#v-pills-dashboard-tab,#view_quotes_page').addClass('active');
        $('#v-pills-dashboard').addClass('show active');
        PosnicPro.quotes.load();
    },
    /* ---- Quotation editor (QUOTATION_MODULE_DESIGN Q2) ---- */
    _ed: null,
    _edBlank: function () {
        var week = new Date(Date.now() + 7 * 86400000);
        return { id: '', quote_id: '', customer_id: '', lines: [], charges: [], valid_until: week.toISOString().slice(0, 10) };
    },
    _edShell: function () {
        PosnicPro.HideSideBarModal();
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $('.vertical-menu li a').removeClass('active');
        $('.page_loader,#osk-container').hide();
        $('.page-title-box,#quotes_new').show();
        $('#v-pills-dashboard-tab,#view_quotes_page').addClass('active');
        $('#v-pills-dashboard').addClass('show active');
        $('#quotes_list_card,#quotes_view_card').hide();
        /* The editor is a third child of this contentbar. Leaving the split on
           would lay it out as a flex item inside the joined surface and hand
           it the rail's border, so the authoring page takes the width back. */
        $('#quotes_new .contentbar').removeClass('quotes-split rail-collapsed');
        $('#quotes_edit_card').show();
        $('.vertical-layout').addClass('toggle-menu');
        PosnicPro.quotes._edInitSort();
    },
    /* Row drag (Q5): SortableJS rides the lazy rail; a failed load only
       costs the drag - typing still works. */
    _edSortable: null,
    _edInitSort: function () {
        PosnicPro.lazy.load('sortable').then(function () {
            if (PosnicPro.quotes._edSortable || !window.Sortable) { return; }
            var el = document.getElementById('qe_lines');
            if (!el) { return; }
            PosnicPro.quotes._edSortable = window.Sortable.create(el, {
                handle: '.qe-l-grip',
                animation: 120,
                onEnd: function (evt) {
                    var ed = PosnicPro.quotes._ed;
                    if (!ed || evt.oldIndex === evt.newIndex) { return; }
                    var moved = ed.lines.splice(evt.oldIndex, 1)[0];
                    if (moved) { ed.lines.splice(evt.newIndex, 0, moved); }
                    PosnicPro.quotes.edRender();
                }
            });
        }).catch(function () { /* drag is a nicety */ });
    },
    showAdd: function () {
        PosnicPro.quotes._ed = PosnicPro.quotes._edBlank();
        PosnicPro.quotes._edShell();
        PosnicPro.quotes._loadTaxList(function () { PosnicPro.quotes.edRender(); });
        PosnicPro.quotes._edSigSync();
        $('#qe_title').text('New quotation');
        $('#qe_cust_search,#qe_cust_name,#qe_cust_phone,#qe_cust_email,#qe_cust_gstin,#qe_cust_address').val('');
        $('#qe_item_search,#qe_payment,#qe_bank,#qe_terms,#qe_notes,#qe_disc_value').val('');
        $('#qe_disc_type').val('');
        $('#qe_valid_until').val(PosnicPro.quotes._ed.valid_until);
        $('.qe-valid-chip').removeClass('btn-primary').addClass('btn-secondary-rgba');
        $('.qe-valid-chip[data-days="7"]').removeClass('btn-secondary-rgba').addClass('btn-primary');
        PosnicPro.quotes.edRender();
    },
    showEdit: function (id) {
        PosnicPro.get({ url: 'quotes/' + id, data: {} }, function (r) {
            var q = r && r.data;
            if (!q) { PosnicPro.alert('error', 'Quote not found'); return; }
            if (['open', 'draft', 'sent'].indexOf(q.status) === -1) {
                PosnicPro.alert('warning', 'This quote is ' + q.status + ' - it can no longer be edited.');
                hasher.setHash('quotes/' + id);
                return;
            }
            var ed = PosnicPro.quotes._edBlank();
            ed.id = String(q._id);
            ed.quote_id = q.quote_id || '';
            ed.customer_id = q.customer_id ? String(q.customer_id) : '';
            ed.lines = (q.items || []).map(function (l) {
                return {
                    kind: l.kind === 'custom' || !l.item_id ? 'custom' : 'item',
                    item_id: l.item_id ? String(l.item_id) : '',
                    item_name: l.item_name || '',
                    description: l.description || '',
                    barcode_id: l.barcode_id || '',
                    qty: Number(l.qty) || 1,
                    unit_price: Number(l.unit_price) || 0,
                    dtype: l.discount ? l.discount.type : '',
                    dval: l.discount ? l.discount.value : '',
                    tax_name: l.tax_name || '',
                    tax_value: Number(l.tax_value) || 0,
                    tax_type: l.tax_type || ''
                };
            });
            ed.charges = (q.charges || []).map(function (c) {
                return { name: c.name || '', type: c.type === 'amount' ? 'amount' : 'percent', value: Number(c.value) || 0, sign: Number(c.sign) === -1 ? -1 : 1 };
            });
            PosnicPro.quotes._ed = ed;
            PosnicPro.quotes._edShell();
            PosnicPro.quotes._loadTaxList(function () { PosnicPro.quotes.edRender(); });
            PosnicPro.quotes._edSigSync();
            $('#qe_title').text('Edit ' + (q.quote_id || 'quotation'));
            $('#qe_cust_search,#qe_item_search').val('');
            $('#qe_cust_name').val(q.customer_name || '');
            $('#qe_cust_phone').val(q.customer_phone || '');
            $('#qe_cust_email').val(q.customer_email || '');
            $('#qe_cust_gstin').val(q.customer_gstin || '');
            $('#qe_cust_address').val(q.customer_address || '');
            $('#qe_payment').val(q.payment_method || '');
            $('#qe_bank').val(q.bank_details || '');
            $('#qe_terms').val(q.terms || q.note || '');
            $('#qe_notes').val(q.notes || '');
            $('#qe_disc_type').val(q.discount ? q.discount.type : '');
            $('#qe_disc_value').val(q.discount ? q.discount.value : '');
            $('#qe_valid_until').val(q.valid_until ? new Date(q.valid_until).toISOString().slice(0, 10) : '');
            PosnicPro.quotes.edRender();
        }, function () { PosnicPro.alert('error', 'Could not load the quote'); });
    },
    _edR2: function (n) { return Math.round(n * 100) / 100; },
    /* Shop taxes for the custom-line picker - catalog items bring their
       own; a custom line picks from what the shop configured. */
    _taxList: null,
    _loadTaxList: function (done) {
        if (PosnicPro.quotes._taxList) { done(PosnicPro.quotes._taxList); return; }
        PosnicPro.get({ url: 'setting/getTaxAjaxList', data: 'query=' }, function (response) {
            PosnicPro.quotes._taxList = (response && response.suggestions) || [];
            done(PosnicPro.quotes._taxList);
        }, function () { PosnicPro.quotes._taxList = []; done([]); });
    },
    /* "GST 18%" already names its rate - never print it twice */
    _taxNote: function (l) {
        var esc = PosnicPro.quotes._esc;
        var name = String(l.tax_name || 'Tax');
        if (name.indexOf(l.tax_value + '%') === -1) { name += ' ' + l.tax_value + '%'; }
        return esc(name);
    },
    /*
     * Queue #8: group line taxes for the totals block so CGST and SGST
     * get their own rows. Groups by tax label; with Indian GST on, a
     * combined 'GST n%' group splits into equal CGST/SGST halves
     * (second half takes the rounding remainder so the sum is exact).
     * Labels already split (CGST/SGST/IGST) pass through untouched.
     */
    _taxBreakup: function (lines, amountOf) {
        var groups = {}, order = [];
        (lines || []).forEach(function (l) {
            var amt = amountOf(l);
            if (!(amt > 0)) { return; }
            var name = $.trim(String(l.tax_name || ''));
            var rate = Number(l.tax_value) || 0;
            var label = name || 'Tax';
            if (!/\d/.test(label) && rate > 0) { label += ' ' + rate + '%'; }
            if (!groups[label]) { groups[label] = 0; order.push(label); }
            groups[label] += amt;
        });
        var r2 = function (n) { return Math.round(n * 100) / 100; };
        var gstOn = PosnicPro.local.get('gst_action') === 'enable';
        var rows = [];
        order.forEach(function (label) {
            var amt = r2(groups[label]);
            var m = gstOn && /^\s*gst\b/i.test(label) && !/[cs]gst|igst/i.test(label)
                ? label.match(/([\d.]+)\s*%/) : null;
            if (m) {
                var half = r2(amt / 2);
                var halfRate = Number(m[1]) / 2;
                rows.push({ label: 'CGST ' + halfRate + '%', amount: half });
                rows.push({ label: 'SGST ' + halfRate + '%', amount: r2(amt - half) });
            } else {
                rows.push({ label: label, amount: amt });
            }
        });
        return rows;
    },
    /* One line's total, the same arithmetic the server stores. */
    _edLineTotal: function (l) {
        var r2 = PosnicPro.quotes._edR2;
        var gross = r2((Number(l.qty) || 0) * (Number(l.unit_price) || 0));
        var v = Number(l.dval);
        var taxable = gross;
        if (l.dtype === 'percent' && v > 0) { taxable = r2(gross - r2((gross * Math.min(v, 100)) / 100)); }
        else if (l.dtype === 'amount' && v > 0) { taxable = r2(gross - Math.min(v, gross)); }
        var rate = Number(l.tax_value) || 0;
        if (rate > 0 && l.tax_type === 'exclusive') { return r2(taxable + r2((taxable * rate) / 100)); }
        return taxable;
    },
    /* the tax inside (inclusive) or on top of (exclusive) one line */
    _edLineTax: function (l) {
        var r2 = PosnicPro.quotes._edR2;
        var rate = Number(l.tax_value) || 0;
        if (!(rate > 0)) { return 0; }
        var gross = r2((Number(l.qty) || 0) * (Number(l.unit_price) || 0));
        var v = Number(l.dval);
        var taxable = gross;
        if (l.dtype === 'percent' && v > 0) { taxable = r2(gross - r2((gross * Math.min(v, 100)) / 100)); }
        else if (l.dtype === 'amount' && v > 0) { taxable = r2(gross - Math.min(v, gross)); }
        return l.tax_type === 'exclusive'
            ? r2((taxable * rate) / 100)
            : r2(taxable - taxable / (1 + rate / 100));
    },
    edRender: function () {
        var ed = PosnicPro.quotes._ed;
        if (!ed) { return; }
        var esc = PosnicPro.quotes._esc;
        var html = '';
        ed.lines.forEach(function (l, i) {
            html += '<tr data-i="' + i + '">'
                + '<td><span class="qe-l-grip" title="Drag to reorder">&#x2630;</span>'
                + '<input type="text" class="qe-l-name form-control form-control-sm" maxlength="200" placeholder="' + (l.kind === 'custom' ? 'Custom line name' : 'Item') + '" value="' + esc(l.item_name) + '">'
                + '<input type="text" class="qe-l-desc form-control form-control-sm mt-1" maxlength="500" placeholder="Description (optional)" value="' + esc(l.description) + '">'
                + (l.kind === 'custom'
                    ? '<select class="qe-l-taxsel form-control form-control-sm mt-1" style="max-width:170px;">'
                        + '<option value="">No tax</option>'
                        + ((PosnicPro.quotes._taxList || []).map(function (t) {
                            var sel = Number(l.tax_value) > 0 && String(l.tax_name) === String(t.tax_name) ? ' selected' : '';
                            return '<option value="' + esc(t.tax_value) + '" data-name="' + esc(t.tax_name) + '"' + sel + '>'
                                + esc(t.tax_name) + ' (' + esc(t.tax_value) + '%)</option>';
                        }).join(''))
                        + '</select>'
                    : '')
                + (Number(l.tax_value) > 0
                    ? '<div class="qe-l-tax">' + PosnicPro.quotes._taxNote(l) + ' '
                        + (l.kind === 'custom'
                            ? '<a href="javascript:void(0)" class="qe-l-taxflip">' + (l.tax_type === 'exclusive' ? 'added on top' : 'included') + '</a>'
                            : (l.tax_type === 'exclusive' ? 'added on top' : 'included'))
                        + '</div>'
                    : '')
                + '</td>'
                + '<td><input type="number" class="qe-l-qty form-control form-control-sm" min="0" step="any" value="' + esc(l.qty) + '"></td>'
                + '<td><input type="number" class="qe-l-price form-control form-control-sm" min="0" step="0.01" value="' + esc(l.unit_price) + '"></td>'
                + '<td><div class="input-group input-group-sm" style="min-width:150px;">'
                + '<select class="qe-l-dtype form-control" style="max-width:64px;"><option value=""' + (!l.dtype ? ' selected' : '') + '>-</option>'
                + '<option value="percent"' + (l.dtype === 'percent' ? ' selected' : '') + '>%</option>'
                + '<option value="amount"' + (l.dtype === 'amount' ? ' selected' : '') + '>amt</option></select>'
                + '<input type="number" class="qe-l-dval form-control" min="0" step="0.01" value="' + esc(l.dval) + '"></div></td>'
                + '<td class="text-right qe-l-total" style="white-space:nowrap; padding-top:12px;">' + PosnicPro.quotes._edLineTotal(l).toFixed(2) + '</td>'
                + '<td><button type="button" class="btn qe-l-del" title="Remove line">&times;</button></td>'
                + '</tr>';
        });
        $('#qe_lines').html(html || '<tr><td colspan="6" class="text-center text-muted">Search an item above, or add a custom line.</td></tr>');
        var chtml = '';
        ed.charges.forEach(function (c, i) {
            chtml += '<div class="input-group input-group-sm mb-1 qe-charge" data-i="' + i + '">'
                + '<input type="text" class="qe-c-name form-control" maxlength="60" placeholder="e.g. CGST 9% / Freight / Installation" value="' + esc(c.name) + '">'
                + '<select class="qe-c-type form-control" style="max-width:80px;"><option value="percent"' + (c.type === 'percent' ? ' selected' : '') + '>%</option>'
                + '<option value="amount"' + (c.type === 'amount' ? ' selected' : '') + '>amt</option></select>'
                + '<input type="number" class="qe-c-val form-control" style="max-width:100px;" min="0" step="0.01" value="' + esc(c.value) + '">'
                + '<select class="qe-c-sign form-control" style="max-width:80px;"><option value="1"' + (c.sign !== -1 ? ' selected' : '') + '>add</option>'
                + '<option value="-1"' + (c.sign === -1 ? ' selected' : '') + '>less</option></select>'
                + '<span class="input-group-text qe-c-out">0.00</span>'
                + '<div class="input-group-append"><button type="button" class="btn btn-outline-danger qe-c-del">&times;</button></div>'
                + '</div>';
        });
        $('#qe_charges').html(chtml || '<div class="text-muted small mb-1">No charges yet - add GST, freight, installation, anything, under its own name.</div>');
        PosnicPro.quotes.edRecalc();
    },
    edRecalc: function () {
        var ed = PosnicPro.quotes._ed;
        if (!ed) { return 0; }
        var r2 = PosnicPro.quotes._edR2;
        var subtotal = 0;
        var taxSum = 0;
        ed.lines.forEach(function (l, i) {
            var t = PosnicPro.quotes._edLineTotal(l);
            subtotal += t;
            taxSum += PosnicPro.quotes._edLineTax(l);
            $('#qe_lines tr[data-i="' + i + '"] .qe-l-total').text(t.toFixed(2));
        });
        subtotal = r2(subtotal);
        taxSum = r2(taxSum);
        var dtype = $('#qe_disc_type').val();
        var dval = Number($('#qe_disc_value').val());
        var qdisc = 0;
        if (dtype === 'percent' && dval > 0) { qdisc = r2((subtotal * Math.min(dval, 100)) / 100); }
        if (dtype === 'amount' && dval > 0) { qdisc = r2(Math.min(dval, subtotal)); }
        var base = r2(subtotal - qdisc);
        var chargesSum = 0;
        var chargeRows = [];
        ed.charges.forEach(function (c, i) {
            var computed = c.type === 'percent' ? r2((base * (Number(c.value) || 0)) / 100) : r2(Number(c.value) || 0);
            chargesSum += (c.sign === -1 ? -1 : 1) * computed;
            $('#qe_charges .qe-charge[data-i="' + i + '"] .qe-c-out').text((c.sign === -1 ? '-' : '') + computed.toFixed(2));
            if (c.name) { chargeRows.push({ name: c.name, sign: c.sign, computed: computed }); }
        });
        chargesSum = r2(chargesSum);
        var total = Math.max(0, r2(base + chargesSum));
        PosnicPro.quotes._edPreviewRender({
            subtotal: subtotal, taxSum: taxSum, qdisc: qdisc, dtype: dtype, dval: dval,
            taxRows: PosnicPro.quotes._taxBreakup(ed.lines, PosnicPro.quotes._edLineTax),
            chargeRows: chargeRows, total: total
        });
        return total;
    },
    /* The right-hand paper: the SAME sheet the customer gets, live. */
    _edPreviewRender: function (m) {
        var ed = PosnicPro.quotes._ed;
        if (!ed) { return; }
        var esc = PosnicPro.quotes._esc;
        var money = PosnicPro.quotes._money;
        var taxLabel = PosnicPro.local.get('gst_action') === 'enable' ? 'GSTIN' : 'Tax ID';
        var logo = PosnicPro.local.get('branchimage');
        var custName = $.trim($('#qe_cust_name').val());
        var vu = $('#qe_valid_until').val();
        var h = '<div class="q-head">'
            + '<div class="q-seller">'
            + (logo && logo !== 'store.png' ? '<img class="q-logo" src="' + esc(logo) + '" alt="">' : '')
            + '<div class="q-shop">' + esc(PosnicPro.local.get('branchname') || '') + '</div>'
            /* Same _real filter as the finished document: this preview is a
               promise about what the customer will get, so it must not show a
               placeholder the printed quote would drop. */
            + (function () {
                var real = PosnicPro.quotes._real;
                var addr = real(PosnicPro.local.get('branchaddress'));
                var ph = real(PosnicPro.local.get('branchphone'));
                var gst = real(PosnicPro.local.get('branchgstin'));
                return (addr ? '<div class="q-muted">' + esc(addr) + '</div>' : '')
                    + (ph ? '<div class="q-muted">' + esc(ph) + '</div>' : '')
                    + (gst ? '<div class="q-muted">' + taxLabel + ': ' + esc(gst) + '</div>' : '');
            })()
            + '</div>'
            + '<div class="q-title-block"><div class="q-doc-title">QUOTATION</div>'
            + '<div class="q-num">' + esc(ed.quote_id || 'New') + '</div>'
            + (vu ? '<div class="q-muted">Valid till: ' + esc(vu.split('-').reverse().join('/')) + '</div>' : '')
            + '</div></div>'
            + '<div class="q-billto"><div class="q-label">Bill To</div>'
            + '<div class="q-cust">' + (esc(custName) || 'Walk-in customer') + '</div>'
            + '<div class="q-muted">' + esc($.trim($('#qe_cust_address').val())) + '</div>'
            + '<div class="q-muted">' + esc($.trim($('#qe_cust_phone').val()))
            + ($.trim($('#qe_cust_gstin').val()) ? ' &middot; ' + taxLabel + ': ' + esc($.trim($('#qe_cust_gstin').val())) : '') + '</div>'
            + '</div>'
            + '<table class="q-items"><thead><tr><th>#</th><th>Item</th><th class="text-right">Qty</th>'
            + '<th class="text-right">Price</th><th class="text-right">Amount</th></tr></thead><tbody>';
        ed.lines.forEach(function (l, i) {
            var note = esc(l.description || '');
            if (l.dtype && Number(l.dval) > 0) {
                note += (note ? ' &middot; ' : '') + (l.dtype === 'percent' ? l.dval + '% off' : money(l.dval) + ' off');
            }
            if (Number(l.tax_value) > 0) {
                note += (note ? ' &middot; ' : '') + PosnicPro.quotes._taxNote(l)
                    + (l.tax_type === 'exclusive' ? ' added' : ' incl.');
            }
            h += '<tr><td>' + (i + 1) + '</td><td>' + (esc(l.item_name) || '<span class="text-muted">(unnamed)</span>')
                + (note ? '<div class="q-muted" style="font-size:11px;">' + note + '</div>' : '') + '</td>'
                + '<td class="text-right">' + esc(l.qty) + '</td>'
                + '<td class="text-right">' + money(l.unit_price) + '</td>'
                + '<td class="text-right">' + money(PosnicPro.quotes._edLineTotal(l)) + '</td></tr>';
        });
        h += '</tbody><tfoot>'
            + '<tr class="q-sub"><td colspan="4" class="text-right">Subtotal</td><td class="text-right">' + money(m.subtotal) + '</td></tr>'
            + (m.taxRows && m.taxRows.length
                ? m.taxRows.map(function (t) {
                    return '<tr class="q-sub"><td colspan="4" class="text-right">' + esc(t.label) + '</td><td class="text-right">' + money(t.amount) + '</td></tr>';
                }).join('')
                : (m.taxSum > 0 ? '<tr class="q-sub"><td colspan="4" class="text-right">Tax</td><td class="text-right">' + money(m.taxSum) + '</td></tr>' : ''))
            + (m.qdisc > 0 ? '<tr class="q-sub"><td colspan="4" class="text-right">Discount' + (m.dtype === 'percent' ? ' (' + m.dval + '%)' : '') + '</td><td class="text-right">-' + money(m.qdisc) + '</td></tr>' : '');
        m.chargeRows.forEach(function (c) {
            h += '<tr class="q-sub"><td colspan="4" class="text-right">' + esc(c.name) + '</td><td class="text-right">' + (c.sign === -1 ? '-' : '') + money(c.computed) + '</td></tr>';
        });
        h += '<tr class="q-grand"><th colspan="4" class="text-right">TOTAL</th><th class="text-right">' + money(m.total) + '</th></tr>'
            + '</tfoot></table>';
        var pay = $.trim($('#qe_payment').val());
        var bank = $.trim($('#qe_bank').val());
        var terms = $.trim($('#qe_terms').val());
        var notes = $.trim($('#qe_notes').val());
        if (pay || bank) {
            h += '<div class="q-block m-t-10"><div class="q-label">Payment details</div>'
                + (pay ? '<div>' + esc(pay) + '</div>' : '')
                + (bank ? '<div class="q-muted">' + esc(bank) + '</div>' : '') + '</div>';
        }
        if (terms) { h += '<div class="q-block m-t-10"><div class="q-label">Terms &amp; conditions</div>' + esc(terms) + '</div>'; }
        if (notes) { h += '<div class="q-block m-t-10"><div class="q-label">Notes</div>' + esc(notes) + '</div>'; }
        var sig = PosnicPro.local.get('quotesignature');
        if (sig) {
            // the image sits ABOVE the rule - the line is what one signs on,
            // and the uploaded signature stands in for that stroke
            h += '<div class="q-sign-img"><img src="' + sig + '" alt="" style="max-height:40px; max-width:160px; display:block; margin:0 auto;"></div>'
                + '<div class="q-sign">Authorised signatory</div>';
        }
        $('#qe_preview').html(h);
    },
    edAddCustom: function () {
        if (!PosnicPro.quotes._ed) { return; }
        PosnicPro.quotes._ed.lines.push({ kind: 'custom', item_id: '', item_name: '', description: '', barcode_id: '', qty: 1, unit_price: 0, dtype: '', dval: '', tax_name: '', tax_value: 0, tax_type: '' });
        PosnicPro.quotes.edRender();
        $('#qe_lines tr:last .qe-l-name').focus();
    },
    edAddItem: function (itemId, seedName) {
        PosnicPro.get('items/' + itemId, function (r) {
            var d = (r && r.data) || {};
            if (!PosnicPro.quotes._ed) { return; }
            PosnicPro.quotes._ed.lines.push({
                kind: 'item', item_id: String(itemId),
                // the item doc's field is `name`; item_name appears on some
                // rows only - and the tapped suggestion always knows it
                item_name: d.item_name || d.name || seedName || '',
                description: '',
                barcode_id: d.barcode_id || '',
                qty: 1, unit_price: Number(d.selling_price) || 0, dtype: '', dval: '',
                // the item's own configured tax rides the line (GST style)
                tax_name: d.tax_name || '',
                tax_value: Number(d.tax !== undefined && d.tax !== null && d.tax !== '' ? d.tax : d.tax_value) || 0,
                tax_type: String(d.tax_type || '').toLowerCase().indexOf('ex') === 0 ? 'exclusive' : 'inclusive'
            });
            PosnicPro.quotes.edRender();
        }, function () { PosnicPro.alert('error', 'Could not load that item'); });
    },
    edAddCharge: function () {
        if (!PosnicPro.quotes._ed) { return; }
        PosnicPro.quotes._ed.charges.push({ name: '', type: 'percent', value: 0, sign: 1 });
        PosnicPro.quotes.edRender();
        $('#qe_charges .qe-charge:last .qe-c-name').focus();
    },
    /* The signature block mirrors the shop config: prefilled when set,
       and a replacement here updates the config for every future quote
       (owner's prefill model) - loudly, because it is an authority mark. */
    _edSigSync: function () {
        var sig = PosnicPro.local.get('quotesignature');
        $('#qe_sig_thumb').attr('src', sig || '').toggle(!!sig);
        $('#qe_sig_action').text(sig ? 'Replace' : 'Upload');
    },
    edCancel: function () {
        var ed = PosnicPro.quotes._ed || {};
        hasher.setHash(ed.id ? 'quotes/' + ed.id : 'quotes');
    },
    edSave: function () {
        var ed = PosnicPro.quotes._ed;
        if (!ed) { return; }
        var lines = ed.lines.filter(function (l) {
            return (String(l.item_name).trim() || l.item_id) && Number(l.qty) > 0;
        });
        if (!lines.length) { PosnicPro.alert('warning', 'Add at least one line with a name and quantity.'); return; }
        var payload = {
            lines: lines.map(function (l) {
                var out = {
                    kind: l.kind, item_id: l.item_id || '', item_name: l.item_name,
                    description: l.description, barcode_id: l.barcode_id,
                    qty: Number(l.qty), unit_price: Number(l.unit_price) || 0,
                    tax_name: l.tax_name || '', tax_value: Number(l.tax_value) || 0,
                    tax_type: l.tax_type || ''
                };
                if (l.dtype && Number(l.dval) > 0) { out.discount = { type: l.dtype, value: Number(l.dval) }; }
                return out;
            }),
            charges: ed.charges.filter(function (c) { return String(c.name).trim() && Number(c.value) > 0; }),
            customer_id: ed.customer_id || '',
            customer_name: $.trim($('#qe_cust_name').val()),
            customer_phone: $.trim($('#qe_cust_phone').val()),
            customer_email: $.trim($('#qe_cust_email').val()),
            customer_gstin: $.trim($('#qe_cust_gstin').val()),
            customer_address: $.trim($('#qe_cust_address').val()),
            payment_method: $.trim($('#qe_payment').val()),
            bank_details: $.trim($('#qe_bank').val()),
            terms: $.trim($('#qe_terms').val()),
            notes: $.trim($('#qe_notes').val()),
            valid_until: $('#qe_valid_until').val() || '',
            total: PosnicPro.quotes.edRecalc()
        };
        var dtype = $('#qe_disc_type').val();
        if (dtype && Number($('#qe_disc_value').val()) > 0) {
            payload.discount = { type: dtype, value: Number($('#qe_disc_value').val()) };
        }
        var done = function (r) {
            PosnicPro.alert(r.type, r.message);
            if (r.type === 'success') {
                var id = ed.id || (r.data && r.data.id);
                hasher.setHash(id ? 'quotes/' + id : 'quotes');
            }
        };
        var fail = function (xhr) {
            var resp = {}; try { resp = JSON.parse(xhr.responseText); } catch (e) { /* plain */ }
            PosnicPro.alert('error', resp.message || 'Could not save the quotation');
        };
        if (ed.id) {
            PosnicPro.request({ method: 'PUT', url: 'quotes/' + ed.id, data: JSON.stringify(payload) }, done, fail);
        } else {
            PosnicPro.post({ url: 'quotes', data: JSON.stringify(payload) }, done, fail);
        }
    },
    /* accept / decline from the preview (server enforces the from-states) */
    setStatus: function (action) {
        var q = PosnicPro.quotes._current;
        if (!q) { return; }
        PosnicPro.post({ url: 'quotes/' + q._id + '/transition', data: JSON.stringify({ action: action }) }, function (r) {
            PosnicPro.alert(r.type, r.message);
            if (r.type === 'success') { PosnicPro.quotes.showDetails(String(q._id)); }
        });
    },
    _page: 1,
    PAGE_SIZE: 20,
    /*
     * The server decides status, search and paging now. It used to hand
     * over its first 100 quotes and the browser filtered those - so past
     * 100 quotes, searching for an older one found nothing and the pager
     * never reached the rest. _seq drops a slow response that lands after
     * a newer one (type fast enough and the old answer used to win).
     */
    _seq: 0,
    load: function (keepPage) {
        if (!keepPage) { PosnicPro.quotes._page = 1; }
        var mine = ++PosnicPro.quotes._seq;
        var params = {
            page: PosnicPro.quotes._page,
            limit: PosnicPro.quotes.PAGE_SIZE
        };
        /* Search, field, exact, the date window AND the status chips all come
           from the shared filter bar - quotes owns none of that any more, which
           is what lets items and sales get the same bar without a second copy.
           Status rides as an extra so the Filter button counts it and Clear
           clears it; a chip filtering under a button reading "0" is exactly the
           forgotten filter the count exists to catch. */
        $.extend(params, PosnicPro.listFilter.params('quotes'));
        PosnicPro.get({ url: 'quotes', data: params }, function (r) {
            if (mine !== PosnicPro.quotes._seq) { return; }
            PosnicPro.quotes._rows = (r && r.data) || [];
            PosnicPro.quotes._meta = (r && r.meta) || null;
            PosnicPro.quotes.renderList();
        }, function () {
            if (mine !== PosnicPro.quotes._seq) { return; }
            $('#quotes_list_rows').text('Could not load quotes - try again.');
        });
    },
    renderList: function () {
        var esc = PosnicPro.quotes._esc;
        var rows = PosnicPro.quotes._rows || [];
        var meta = PosnicPro.quotes._meta;
        if (!rows.length) {
            /* #quotes_search stopped existing when the shared bar took over -
               this read `''` from nothing and told anyone whose search found
               nothing that they had never written a quote. */
            var searching = PosnicPro.listFilter.activeCount('quotes') > 0;
            $('#quotes_list_rows').html('<div class="text-center text-muted p-t-20 p-b-20">'
                + (searching
                    ? 'No quotes match this search.'
                    : 'No quotes here yet - press Save as quote on a sale and it lands in this list.')
                + '</div>');
            return;
        }
        var shown = rows;
        var d = function (v) { return v ? new Date(v).toLocaleDateString('en-IN') : '-'; };
        var html = '<div class="table-responsive"><table class="table table-borderless">'
            + '<thead><tr>'
            + '<th>Quote #</th><th>Customer</th><th class="q-col-date">Date</th><th class="q-col-valid">Valid till</th>'
            + '<th class="text-right q-col-qty">Qty</th><th class="text-right">Total</th><th class="text-center">Status</th>'
            + '</tr></thead><tbody>';
        shown.forEach(function (q) {
            var qty = (q.items || []).reduce(function (a, l) { return a + (Number(l.qty) || 0); }, 0);
            var label = String(q.status || 'open');
            label = label.charAt(0).toUpperCase() + label.slice(1);
            var pill = q.status === 'converted' || q.status === 'accepted'
                ? '<span class="rs-pill paid">' + label + '</span>'
                : q.status === 'cancelled' || q.status === 'declined'
                    ? '<span class="rs-pill unpaid">' + label + '</span>'
                    : '<span class="rs-pill hold">' + label + '</span>';
            var expired = q.status === 'open' && q.valid_until && new Date(q.valid_until) < new Date();
            html += '<tr class="quotes-row highlight-select" data-id="' + esc(q._id) + '" style="cursor:pointer;">'
                + '<td>' + esc(q.quote_id) + '</td>'
                + '<td>' + esc(q.customer_name || 'Walk-in') + '</td>'
                + '<td class="q-col-date">' + d(q.created_date) + '</td>'
                + '<td class="q-col-valid">' + (expired ? '<span class="text-danger">' + d(q.valid_until) + '</span>' : d(q.valid_until)) + '</td>'
                + '<td class="text-right q-col-qty">' + qty + '</td>'
                + '<td class="text-right">' + PosnicPro.quotes._money(q.total) + '</td>'
                + '<td class="text-center">' + pill + '</td>'
                + '</tr>';
        });
        html += '</tbody></table></div>';
        /* The pager is real, but it used to render only past page one - so on
           a shop with eight quotes it looked like paging had never been built.
           The count always shows; the arrows appear when there is somewhere
           to go. Sitting in the rail's footer it also says which slice of the
           list you are looking at. */
        /* The pager says only what was actually measured.
           A text search skips the count on purpose - running an unanchored
           regex across every row twice per keystroke is the thing that makes a
           list feel slow - so on that path there is no total and no page
           count, and inventing one would be a pager that lies. What it shows
           instead is the range on screen and a Next that works, because
           "is there more" is the only question a total was answering. */
        var cur = (meta && meta.page) || 1;
        var lim = (meta && meta.limit) || rows.length || 1;
        var total = meta && typeof meta.total === 'number' ? meta.total : null;
        var pages = meta && meta.pages ? meta.pages : null;
        var hasMore = meta ? !!meta.hasMore : false;

        var arrow = function (to, label, off) {
            return '<button type="button" class="btn btn-sm btn-secondary-rgba q-pg-btn"' + (off ? ' disabled' : '')
                + ' onclick="PosnicPro.quotes._page = ' + to + '; PosnicPro.quotes.load(true);">' + label + '</button>';
        };

        var label;
        if (total !== null) {
            label = total + (total === 1 ? ' quote' : ' quotes');
            if (pages > 1) { label = 'Page ' + cur + ' of ' + pages + ' · ' + label; }
        } else {
            var first = (cur - 1) * lim + 1;
            var last = (cur - 1) * lim + rows.length;
            label = rows.length ? 'Showing ' + first + '–' + last : 'No matches';
        }

        var showArrows = (pages && pages > 1) || cur > 1 || hasMore;
        html += '<div class="q-pager">'
            + (showArrows ? arrow(cur - 1, '&laquo;', cur <= 1) : '')
            + '<span class="q-pg-count">' + label + '</span>'
            + (showArrows ? arrow(cur + 1, '&raquo;', !hasMore) : '')
            + '</div>';
        $('#quotes_list_rows').html(html);
        // a re-render (search, filter, page) must not lose which quote is open
        if (PosnicPro.quotes._current && PosnicPro.quotes._current._id) {
            $('#quotes_list_rows tr.quotes-row[data-id="' + PosnicPro.quotes._current._id + '"]')
                .addClass('is-active');
        }
    },
    /* Are we already sitting in master-detail with a document open? Arriving
       at the page and moving between quotes are two different things, and
       only the first one may touch the page chrome. All four conditions
       matter: the editor also lives in this contentbar, so "split is on" by
       itself would let a click leave the editor showing. */
    _inSplit: function () {
        return $('#quotes_new').is(':visible')
            && $('#quotes_view_card').is(':visible')
            && !$('#quotes_edit_card').is(':visible')
            && $('#quotes_new .contentbar').hasClass('quotes-split');
    },
    showDetails: function (id) {
        /* The flicker: this used to run the page-entry ritual on EVERY row
           click, and #quotes_new itself carries .page_loader - so
           $('.page_loader').hide() tore down the very list being clicked in
           and the next line built it back. Re-entering a page you are already
           on also resets the rail's scroll position, restarts its transitions
           and forces a full relayout. Moving between quotes must change the
           document and nothing else. */
        if (!PosnicPro.quotes._inSplit()) {
            PosnicPro.HideSideBarModal();
            $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
            $('.vertical-menu li a').removeClass('active');
            $('.page_loader,#osk-container').hide();
            $('.page-title-box,#quotes_new').show();
            $('#v-pills-dashboard-tab,#view_quotes_page').addClass('active');
            $('#v-pills-dashboard').addClass('show active');
            /* Master-detail: the list stays, the quote opens beside it. Reading
               a second quote is then one click rather than back-then-forward. */
            $('#quotes_edit_card').hide();
            $('#quotes_list_card').show();
            $('#quotes_new .contentbar').addClass('quotes-split');
            $('.vertical-layout').removeClass('toggle-menu');
            /* Arriving straight at a quote - a refresh, a bookmark, a shared
               link - means the rail has never been filled. Only
               showDataTablePage used to load it, so the document appeared
               beside an empty list that said "Loading quotes ..." forever.
               Moving BETWEEN quotes must not reload it (that is the flicker
               this guard exists to prevent), so it belongs here, inside the
               page-entry branch. */
            PosnicPro.quotes.load();
        }
        $('#quotes_list_rows tr.quotes-row').removeClass('is-active')
            .filter('[data-id="' + id + '"]').addClass('is-active');
        PosnicPro.get({ url: 'quotes/' + id, data: {} }, function (r) {
            var q = r && r.data;
            if (!q) { PosnicPro.alert('error', 'Quote not found'); return; }
            PosnicPro.quotes._current = q;
            /* The rail and the document load in parallel on a fresh arrival,
               so whichever lands second has to place the highlight - renderList
               does it when the list wins, this does it when the quote wins. */
            $('#quotes_list_rows tr.quotes-row').removeClass('is-active')
                .filter('[data-id="' + String(q._id) + '"]').addClass('is-active');
            var esc = PosnicPro.quotes._esc;
            var money = PosnicPro.quotes._money;
            var open = ['open', 'draft', 'sent'].indexOf(q.status) !== -1;
            var taxLabel = PosnicPro.local.get('gst_action') === 'enable' ? 'GSTIN' : 'Tax ID';
            var d = function (v) { return v ? new Date(v).toLocaleDateString('en-IN') : ''; };
            /* Inline-editable field: contenteditable on an open quote,
               plain text once converted or cancelled. */
            var ed = function (f, val, ph) {
                if (!open) { return esc(val) || '<span class="text-muted">-</span>'; }
                return '<span class="q-edit" contenteditable="true" data-f="' + f + '" data-ph="' + ph + '">' + (esc(val) || '') + '</span>';
            };
            /*
             * International quotation layout: seller identity + logo left,
             * QUOTATION / number / dates right; Bill To; items; totals;
             * payment, bank and terms footer; signature. Everything
             * owner-editable in place while the quote is open.
             */
            var logo = PosnicPro.local.get('branchimage');
            var body = '<div class="q-sheet">'
                + '<div class="q-head">'
                + '<div class="q-seller">'
                + (logo && logo !== 'store.png' ? '<img class="q-logo" src="' + esc(logo) + '" alt="">' : '')
                + '<div class="q-shop">' + esc(PosnicPro.local.get('branchname') || '') + '</div>'
                + (function () {
                    /* Each line appears only if it has something real to say. */
                    var real = PosnicPro.quotes._real;
                    var addr = real(PosnicPro.local.get('branchaddress'));
                    var ph = real(PosnicPro.local.get('branchphone'));
                    var em = real(PosnicPro.local.get('branchemail'));
                    var gst = real(PosnicPro.local.get('branchgstin'));
                    var out = '';
                    if (addr) { out += '<div class="q-muted">' + esc(addr) + '</div>'; }
                    if (ph || em) {
                        out += '<div class="q-muted">' + esc(ph)
                            + (ph && em ? ' &middot; ' : '') + (em ? esc(em) : '') + '</div>';
                    }
                    if (gst) { out += '<div class="q-muted">' + taxLabel + ': ' + esc(gst) + '</div>'; }
                    return out;
                })()
                + '</div>'
                + '<div class="q-title-block">'
                + '<div class="q-doc-title">QUOTATION</div>'
                + '<div class="q-num">' + esc(q.quote_id) + '</div>'
                + '<div class="q-muted">Date: ' + d(q.created_date) + '</div>'
                + '<div class="q-muted">Valid till: ' + ed('valid_until', d(q.valid_until), 'dd/mm/yyyy') + '</div>'
                + (!open ? '<div class="q-status">' + esc(String(q.status).toUpperCase()) + '</div>' : '')
                + '</div>'
                + '</div>'
                + '<div class="q-billto"><div class="q-label">Bill To</div>'
                + '<div class="q-cust">' + ed('customer_name', q.customer_name || 'Walk-in customer', 'Customer name') + '</div>'
                + '<div class="q-muted">' + ed('customer_address', q.customer_address, 'Address') + '</div>'
                + '<div class="q-muted">Phone: ' + ed('customer_phone', q.customer_phone, 'phone')
                + ' &middot; ' + taxLabel + ': ' + ed('customer_gstin', q.customer_gstin, taxLabel) + '</div>'
                + '<div class="q-muted">Email: ' + ed('customer_email', q.customer_email, 'email') + '</div>'
                + '</div>'
                + '<div class="table-responsive"><table class="q-items"><thead><tr>'
                + '<th>#</th><th>Item</th><th class="text-right">Qty</th>'
                + '<th class="text-right">Unit price</th><th class="text-right">Amount</th>'
                + '</tr></thead><tbody>';
            (q.items || []).forEach(function (l, i) {
                var note = esc(l.description || '');
                if (l.discount && l.discount.value > 0) {
                    var dTxt = l.discount.type === 'percent'
                        ? l.discount.value + '% off'
                        : money(l.discount.value) + ' off';
                    note += (note ? ' &middot; ' : '') + dTxt;
                }
                if (Number(l.tax_value) > 0) {
                    note += (note ? ' &middot; ' : '') + PosnicPro.quotes._taxNote(l)
                        + (l.tax_type === 'exclusive' ? ' added' : ' incl.');
                }
                body += '<tr><td>' + (i + 1) + '</td><td>' + esc(l.item_name)
                    + (note ? '<div class="q-muted" style="font-size:11.5px;">' + note + '</div>' : '')
                    + '</td>'
                    + '<td class="text-right">' + esc(l.qty) + '</td>'
                    + '<td class="text-right">' + money(l.unit_price) + '</td>'
                    + '<td class="text-right">' + money(l.line_total) + '</td></tr>';
            });
            body += '</tbody><tfoot>'
                + '<tr class="q-sub"><td colspan="4" class="text-right">Subtotal</td>'
                + '<td class="text-right">' + money(q.subtotal) + '</td></tr>'
                + (q.discount && q.discount.computed > 0
                    ? '<tr class="q-sub"><td colspan="4" class="text-right">Discount'
                        + (q.discount.type === 'percent' ? ' (' + q.discount.value + '%)' : '')
                        + '</td><td class="text-right">-' + money(q.discount.computed) + '</td></tr>'
                    : '')
                + (q.charges || []).map(function (c) {
                    return '<tr class="q-sub"><td colspan="4" class="text-right">' + esc(c.name)
                        + '</td><td class="text-right">' + (c.sign === -1 ? '-' : '') + money(c.computed) + '</td></tr>';
                }).join('')
                + (function () {
                    if (!(Number(q.tax_total) > 0)) { return ''; }
                    var rows = PosnicPro.quotes._taxBreakup(q.items, function (l) { return Number(l.tax_amount) || 0; });
                    if (!rows.length) {
                        // older quotes without per-line tax figures keep one row
                        rows = [{ label: 'Tax', amount: Number(q.tax_total) }];
                    }
                    return rows.map(function (t) {
                        return '<tr class="q-sub"><td colspan="4" class="text-right">' + esc(t.label) + '</td><td class="text-right">' + money(t.amount) + '</td></tr>';
                    }).join('');
                })()
                + '<tr class="q-grand"><th colspan="4" class="text-right">TOTAL</th>'
                + '<th class="text-right">' + money(q.total) + '</th></tr>'
                + '</tfoot></table></div>'
                + (function () {
                    /* Footer sections follow q.layout (drag a section label
                       to reorder on an open quote); unlisted tokens keep the
                       default order. Same rule the PDF builder runs. */
                    var sections = {
                        payment: '<div class="q-label">Payment details</div>'
                            + '<div>' + ed('payment_method', q.payment_method, 'e.g. Bank transfer / UPI / Cash') + '</div>'
                            + '<div class="q-muted">' + ed('bank_details', q.bank_details, 'Account name, number, IFSC') + '</div>',
                        terms: '<div class="q-label">Terms &amp; conditions</div>' + ed('terms', q.terms || q.note, 'e.g. 50% advance confirms the order. Prices valid till the date above.'),
                        custom: (q.custom_blocks || []).map(function (b) {
                            return '<div class="q-label">' + esc(b.title || '') + '</div><div class="mb-2">' + esc(b.text || '') + '</div>';
                        }).join(''),
                        notes: q.notes ? '<div class="q-label">Notes</div>' + esc(q.notes) : ''
                    };
                    var tokens = ['payment', 'terms', 'custom', 'notes'];
                    var order = [];
                    (q.layout || []).forEach(function (t) {
                        if (tokens.indexOf(t) !== -1 && order.indexOf(t) === -1) { order.push(t); }
                    });
                    tokens.forEach(function (t) { if (order.indexOf(t) === -1) { order.push(t); } });
                    var out = '<div class="q-footer' + (open ? ' q-sortable' : '') + '" id="q_footer_sort">';
                    order.forEach(function (t) {
                        if (!sections[t]) { return; }
                        out += '<div class="q-block" data-tok="' + t + '">' + sections[t] + '</div>';
                    });
                    return out + '</div>';
                })()
                + (PosnicPro.local.get('quotesignature')
                    ? '<div class="q-sign-img"><img src="' + esc(PosnicPro.local.get('quotesignature')) + '" alt="" style="max-height:40px; max-width:160px; display:block; margin:0 auto;"></div>'
                        + '<div class="q-sign">Authorised signatory</div>'
                    : '')
                + '</div>';
            $('#quotes_view_body').html(body);
            /* Eleven buttons across two rows was the whole toolbar shouting at
               once (owner: "too many buttons... move under actions / share").
               What stays visible is what a quote is FOR - convert it, or open
               it to edit. Everything that only sends a copy somewhere lives
               under Share; everything that changes its state or destroys it
               lives under More, where a mis-click is far less likely.
               ONE primary, and danger only where it destroys. */
            var mi = function (call, label, cls) {
                return '<a class="dropdown-item' + (cls ? ' ' + cls : '')
                    + '" href="javascript:void(0)" onclick="' + call + '">' + label + '</a>';
            };
            var menu = function (label, items) {
                return '<div class="btn-group">'
                    + '<button type="button" class="btn btn-sm btn-light border dropdown-toggle"'
                    + ' data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">' + label + '</button>'
                    + '<div class="dropdown-menu dropdown-menu-right">' + items + '</div>'
                    + '</div>';
            };

            var share = menu('Share', ''
                + mi('PosnicPro.quotes.printNow();', 'Print')
                + mi('PosnicPro.quotes.print();', 'Download PDF')
                + mi('PosnicPro.quotes.emailQuote();', 'Email')
                + mi('PosnicPro.quotes.whatsappQuote();', 'WhatsApp')
                + mi('PosnicPro.quotes.shareLink();', 'Copy link'));

            var moreItems = '';
            if (open) {
                moreItems += mi('PosnicPro.quotes.setStatus(\'accept\');', 'Mark accepted')
                    + mi('PosnicPro.quotes.setStatus(\'decline\');', 'Mark declined')
                    + '<div class="dropdown-divider"></div>'
                    + mi('PosnicPro.quotes.cancel();', 'Cancel quote', 'text-danger')
                    + mi('PosnicPro.quotes.remove();', 'Delete quote', 'text-danger');
            }

            var visible = '';
            if (open) {
                visible += '<button type="button" class="btn btn-sm btn-light border" onclick="hasher.setHash(\'quotes/'
                    + String(q._id) + '/edit\');">Edit</button>'
                    /* Save appears only once an inline field has actually been
                       touched - otherwise it sits there all day inviting a
                       click that would do nothing. */
                    + '<button type="button" class="btn btn-sm btn-primary" id="q_save_edits"'
                    + ' style="display:none;" onclick="PosnicPro.quotes.saveEdits();">Save changes</button>';
            }
            visible += share;
            if (moreItems) { visible += menu('More', moreItems); }
            if (open || q.status === 'accepted') {
                /* The accent, not green: green now means "succeeded", and
                   converting a quote is an action, not an outcome. */
                visible += '<button type="button" class="btn btn-sm btn-primary" onclick="PosnicPro.quotes.convert();">Convert to sale</button>';
            }
            $('#quotes_view_actions').html('<div class="q-actions">' + visible + '</div>');
            $('#quotes_view_card').show();
            if (open) { PosnicPro.quotes._pvInitSort(); }
        }, function () { PosnicPro.alert('error', 'Could not load the quote'); });
    },
    /* Drag a footer section by its label to reorder the printed document;
       the order saves onto the quote and the PDF obeys it. */
    _pvSortable: null,
    _pvInitSort: function () {
        PosnicPro.lazy.load('sortable').then(function () {
            if (!window.Sortable) { return; }
            var el = document.getElementById('q_footer_sort');
            if (!el) { return; }
            if (PosnicPro.quotes._pvSortable) {
                try { PosnicPro.quotes._pvSortable.destroy(); } catch (e) { /* stale */ }
                PosnicPro.quotes._pvSortable = null;
            }
            PosnicPro.quotes._pvSortable = window.Sortable.create(el, {
                handle: '.q-label',
                animation: 120,
                onEnd: function () {
                    var q = PosnicPro.quotes._current;
                    if (!q) { return; }
                    var order = [];
                    $('#q_footer_sort .q-block').each(function () {
                        order.push($(this).data('tok'));
                    });
                    q.layout = ['billto', 'items', 'charges'].concat(order);
                    PosnicPro.quotes.saveEdits();
                }
            });
        }).catch(function () { /* drag is a nicety */ });
    },
    /* Persist the preview's inline edits - open quotes only, the server
       enforces the same rule. */
    saveEdits: function () {
        var q = PosnicPro.quotes._current;
        if (!q || ['open', 'draft', 'sent'].indexOf(q.status) === -1) { return; }
        var read = function (f) { return $.trim($('.q-edit[data-f="' + f + '"]').text() || ''); };
        var vu = read('valid_until');
        var m = vu.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
        var vuIso = m ? (m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2)) : '';
        // the preview edits only the header/footer text - lines, charges,
        // discounts and blocks pass through UNCHANGED so an inline save can
        // never strip what the editor authored
        var payload = {
            items: (q.items || []).map(function (l) {
                return {
                    kind: l.kind, item_id: l.item_id ? String(l.item_id) : '',
                    item_name: l.item_name, description: l.description || '',
                    barcode_id: l.barcode_id, qty: l.qty, unit_price: l.unit_price,
                    discount: l.discount ? { type: l.discount.type, value: l.discount.value } : undefined
                };
            }),
            charges: (q.charges || []).map(function (c) {
                return { name: c.name, type: c.type, value: c.value, sign: c.sign };
            }),
            discount: q.discount ? { type: q.discount.type, value: q.discount.value } : undefined,
            custom_blocks: q.custom_blocks || [],
            layout: q.layout || undefined,
            notes: q.notes || '',
            customer_id: q.customer_id ? String(q.customer_id) : '',
            customer_name: read('customer_name'),
            customer_address: read('customer_address'),
            customer_phone: read('customer_phone'),
            customer_gstin: read('customer_gstin'),
            customer_email: read('customer_email'),
            payment_method: read('payment_method'),
            bank_details: read('bank_details'),
            terms: read('terms'),
            valid_until: vuIso,
            tax_total: q.tax_total,
            total: q.total
        };
        PosnicPro.request({ method: 'PUT', url: 'quotes/' + q._id, data: JSON.stringify(payload) }, function (r) {
            PosnicPro.alert(r.type, r.message);
            if (r.type === 'success') { PosnicPro.quotes.showDetails(String(q._id)); }
        }, function (xhr) {
            var resp = {}; try { resp = JSON.parse(xhr.responseText); } catch (e) { /* plain */ }
            PosnicPro.alert('error', resp.message || 'Could not save the quote');
        });
    },
    /*
     * A value fit to print, or nothing.
     *
     * A shop record can carry a placeholder where a real value should be -
     * "Not provided" arrived as a branch address and went straight onto a
     * customer-facing quotation. Blank is always better than a placeholder on
     * a document: an empty line reads as "not applicable", while "Not
     * provided" reads as "we did not finish filling this in".
     *
     * This only guards the DOCUMENT. The settings screen still shows the real
     * stored value, because hiding it there would stop anyone fixing it.
     */
    _real: function (v) {
        var t = String(v == null ? '' : v).trim();
        if (!t) { return ''; }
        var placeholder = [
            'not provided', 'not available', 'not set', 'n/a', 'na', 'nil',
            'none', 'null', 'undefined', '-', '--', '.', 'xxx', 'test'
        ];
        return placeholder.indexOf(t.toLowerCase()) === -1 ? t : '';
    },

    _seller: function () {
        /* _real, not `|| ''`: this feeds the PDF, and a placeholder printed on
           a customer-facing document is worse than a blank line. */
        var real = PosnicPro.quotes._real;
        return {
            name: PosnicPro.local.get('branchname') || '',
            address: real(PosnicPro.local.get('branchaddress')),
            phone: real(PosnicPro.local.get('branchphone')),
            email: real(PosnicPro.local.get('branchemail')),
            gstin: real(PosnicPro.local.get('branchgstin')),
            taxLabel: PosnicPro.local.get('gst_action') === 'enable' ? 'GSTIN' : 'Tax ID',
            signature: PosnicPro.local.get('quotesignature') || ''
        };
    },
    /* jsPDF + the shop logo (as a canvas data URL) resolved async, then
       the builder runs. A logo that will not load never blocks the doc. */
    _withQuoteDoc: function (use) {
        var q = PosnicPro.quotes._current;
        if (!q) { PosnicPro.alert('warning', 'Open a quote first.'); return; }
        PosnicPro.lazy.load('jspdf').then(function () {
            var C = (window.jspdf && typeof window.jspdf.jsPDF === 'function') ? window.jspdf.jsPDF
                : (typeof window.jsPDF === 'function') ? window.jsPDF
                : (typeof window.jspdf === 'function') ? window.jspdf : null;
            if (!C) { PosnicPro.alert('error', 'PDF tools not loaded - refresh and retry.'); return; }
            var src = PosnicPro.local.get('branchimage');
            var done = false;
            var go = function (logo) {
                if (done) { return; }
                done = true;
                use(PosnicPro.quotes._buildPdf(C, q, PosnicPro.quotes._seller(), logo));
            };
            if (!src || src === 'store.png') { go(null); return; }
            var img = new Image();
            img.onload = function () {
                try {
                    var cv = document.createElement('canvas');
                    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
                    cv.getContext('2d').drawImage(img, 0, 0);
                    go({ data: cv.toDataURL('image/png'), w: img.naturalWidth, h: img.naturalHeight });
                } catch (e) { go(null); }
            };
            img.onerror = function () { go(null); };
            setTimeout(function () { go(null); }, 1500);
            img.src = src;
        });
    },
    /* The professional quotation document. Layout verified numerically
       (margins, column edges, leading, pagination) before shipping. */
    _buildPdf: function (C, q, seller, logo) {
      var doc = new C({ unit: 'mm', format: 'a4', orientation: 'portrait' });
        var W = 210, M = 16, R = W - M, bottom = 278;
        var y = M + 2;
        var totalAlias = typeof doc.getNumberOfPages === 'function' ? '{tp}' : '{tp}';
        var txt = function (t) {
          return String(t == null ? '' : t)
            .replace(/\u20b9\s?/g, 'Rs ').replace(/\u20ac\s?/g, 'EUR ').replace(/\u00a3\s?/g, 'GBP ')
            .replace(/\s+/g, ' ').trim();
        };
        var money = function (n) {
          return 'Rs ' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        };
        var dmy = function (v) {
          if (!v) { return ''; }
          var d = new Date(v);
          if (isNaN(d)) { return ''; }
          var p = function (x) { return (x < 10 ? '0' : '') + x; };
          return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear();
        };
        var pageFooter = function () {
          doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(140, 148, 160);
          doc.text(txt(q.quote_id) + '  -  ' + txt(seller.name), M, 289);
          doc.text('Page ' + doc.internal.getNumberOfPages() + ' of ' + totalAlias, R, 289, { align: 'right' });
        };
        var ensure = function (h) {
          if (y + h > bottom) { pageFooter(); doc.addPage(); y = M + 2; }
        };

        /* header band: seller identity left, document identity right */
        var leftY = y;
        if (logo && logo.data) {
          var lw = 30, lh = 12;
          if (logo.w && logo.h) {
            var r0 = Math.min(30 / logo.w, 12 / logo.h);
            lw = logo.w * r0; lh = logo.h * r0;
          }
          try { doc.addImage(logo.data, 'PNG', M, leftY, lw, lh); leftY += lh + 4; } catch (e) { /* no logo */ }
        }
        doc.setFont('helvetica', 'bold'); doc.setFontSize(12.5); doc.setTextColor(26, 32, 44);
        var nameLines = doc.splitTextToSize(txt(seller.name), 104).slice(0, 2);
        nameLines.forEach(function (ln) { doc.text(ln, M, leftY + 4); leftY += 5.8; });
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(103, 112, 127);
        /* filter(Boolean): splitTextToSize('') yields [''], and an empty line
           still costs 4.3mm of header. No address means no gap either. */
        doc.splitTextToSize(txt(seller.address), 104).filter(Boolean).slice(0, 2).forEach(function (ln) {
          doc.text(ln, M, leftY + 3.5); leftY += 4.3;
        });
        var contact = [seller.phone, seller.email].filter(Boolean).map(txt).join('  -  ');
        if (contact) { doc.text(contact, M, leftY + 3.5); leftY += 4.3; }
        var taxLabel = seller.taxLabel || 'GSTIN';
        if (seller.gstin) { doc.text(taxLabel + ': ' + txt(seller.gstin), M, leftY + 3.5); leftY += 4.3; }

        var rightY = y;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.setTextColor(45, 55, 72);
        doc.text('QUOTATION', R, rightY + 6, { align: 'right' });
        doc.setFontSize(10.5); doc.setTextColor(26, 32, 44);
        doc.text(txt(q.quote_id), R, rightY + 12.5, { align: 'right' });
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(103, 112, 127);
        doc.text('Date: ' + dmy(q.created_date), R, rightY + 17.5, { align: 'right' });
        if (q.valid_until) { doc.text('Valid till: ' + dmy(q.valid_until), R, rightY + 21.5, { align: 'right' }); }
        if (q.status && q.status !== 'open') {
          doc.setFont('helvetica', 'bold');
          doc.text(String(q.status).toUpperCase(), R, rightY + 26, { align: 'right' });
        }

        y = Math.max(leftY + 3, rightY + 25);
        doc.setDrawColor(45, 55, 72); doc.setLineWidth(0.6);
        doc.line(M, y, R, y);
        y += 7;

        /* bill to */
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(138, 148, 166);
        doc.text('BILL TO', M, y);
        y += 5;
        doc.setFontSize(10.5); doc.setTextColor(26, 32, 44);
        doc.text(txt(q.customer_name || 'Walk-in customer'), M, y);
        y += 4.6;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(103, 112, 127);
        if (q.customer_address) {
          doc.splitTextToSize(txt(q.customer_address), 100).slice(0, 2).forEach(function (ln) {
            doc.text(ln, M, y); y += 4.3;
          });
        }
        var cLine = [q.customer_phone ? 'Phone: ' + txt(q.customer_phone) : '',
          q.customer_gstin ? taxLabel + ': ' + txt(q.customer_gstin) : ''].filter(Boolean).join('   ');
        if (cLine) { doc.text(cLine, M, y); y += 4.3; }
        if (q.customer_email) { doc.text(txt(q.customer_email), M, y); y += 4.3; }
        y += 4;

        /* items table: fixed professional columns */
        var colIdx = 9, colQty = 16, colPrice = 28, colAmt = 31;
        var tableW = R - M;
        var colItem = tableW - colIdx - colQty - colPrice - colAmt;
        var xIdx = M, xItem = M + colIdx, xQty = xItem + colItem, xPrice = xQty + colQty, xAmt = xPrice + colPrice;
        var padY = 2.1, lineH = 4.1;
        var chunkFit = function (t, wAvail) {
          var out = [], cur = '';
          String(t).split('').forEach(function (ch) {
            if (cur && doc.getTextWidth(cur + ch) > wAvail) { out.push(cur); cur = ch; }
            else { cur += ch; }
          });
          if (cur) { out.push(cur); }
          return out.length ? out : [''];
        };
        var tableHead = function () {
          doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(45, 55, 72);
          doc.text('#', xIdx, y + 4);
          doc.text('ITEM', xItem, y + 4);
          doc.text('QTY', xQty + colQty - 1, y + 4, { align: 'right' });
          doc.text('UNIT PRICE', xPrice + colPrice - 1, y + 4, { align: 'right' });
          doc.text('AMOUNT', xAmt + colAmt, y + 4, { align: 'right' });
          doc.setDrawColor(45, 55, 72); doc.setLineWidth(0.4);
          doc.line(M, y + 6, R, y + 6);
          y += 6;
        };
        ensure(24);
        tableHead();
        (q.items || []).forEach(function (l, i) {
          doc.setFont('helvetica', 'normal'); doc.setFontSize(8.8);
          var wAvail = colItem - 4;
          var lines = [];
          doc.splitTextToSize(txt(l.item_name), wAvail).forEach(function (ln) {
            if (doc.getTextWidth(ln) <= wAvail) { lines.push(ln); }
            else { chunkFit(ln, wAvail).forEach(function (p2) { lines.push(p2); }); }
          });
          lines = lines.slice(0, 3);
          /* description + a per-line discount note ride under the name, gray */
          var subText = txt(l.description || '');
          if (l.discount && l.discount.value > 0) {
            var dNote = l.discount.type === 'percent' ? l.discount.value + '% off' : money(l.discount.value) + ' off';
            subText = subText ? subText + '  -  ' + dNote : dNote;
          }
          if (Number(l.tax_value) > 0) {
            var tName = txt(l.tax_name || 'Tax');
            if (tName.indexOf(l.tax_value + '%') === -1) { tName += ' ' + l.tax_value + '%'; }
            var tNote = tName + (l.tax_type === 'exclusive' ? ' added' : ' incl.');
            subText = subText ? subText + '  -  ' + tNote : tNote;
          }
          var subLines = [];
          if (subText) {
            doc.setFontSize(7.6);
            doc.splitTextToSize(subText, wAvail).forEach(function (ln) {
              if (doc.getTextWidth(ln) <= wAvail) { subLines.push(ln); }
              else { chunkFit(ln, wAvail).forEach(function (p2) { subLines.push(p2); }); }
            });
            subLines = subLines.slice(0, 2);
            doc.setFontSize(8.8);
          }
          var subH = subLines.length * 3.6;
          var rowH = lines.length * lineH + subH + padY * 2;
          if (y + rowH > bottom) { pageFooter(); doc.addPage(); y = M + 2; tableHead(); }
          doc.setFont('helvetica', 'normal'); doc.setFontSize(8.8); doc.setTextColor(26, 32, 44);
          var base = y + padY + lineH * 0.78;
          doc.text(String(i + 1), xIdx, base);
          lines.forEach(function (ln, li) { doc.text(ln, xItem, base + li * lineH); });
          if (subLines.length) {
            doc.setFontSize(7.6); doc.setTextColor(120, 128, 140);
            subLines.forEach(function (ln, li) {
              doc.text(ln, xItem, base + lines.length * lineH + li * 3.6);
            });
            doc.setFontSize(8.8); doc.setTextColor(26, 32, 44);
          }
          doc.text(String(l.qty), xQty + colQty - 1, base, { align: 'right' });
          doc.text(money(l.unit_price), xPrice + colPrice - 1, base, { align: 'right' });
          doc.text(money(l.line_total), xAmt + colAmt, base, { align: 'right' });
          doc.setDrawColor(228, 232, 238); doc.setLineWidth(0.12);
          doc.line(M, y + rowH, R, y + rowH);
          y += rowH;
        });

        /* totals: right-hand block */
        var totX = 128;
        ensure(26);
        y += 3;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(70, 78, 92);
        doc.text('Subtotal', totX, y + 4);
        doc.text(money(q.subtotal), R, y + 4, { align: 'right' });
        y += 6;
        if (q.discount && Number(q.discount.computed) > 0) {
          var dLabel = 'Discount' + (q.discount.type === 'percent' ? ' (' + q.discount.value + '%)' : '');
          doc.text(dLabel, totX, y + 4);
          doc.text('-' + money(q.discount.computed), R, y + 4, { align: 'right' });
          y += 6;
        }
        (q.charges || []).forEach(function (c) {
          ensure(12);
          doc.text(txt(c.name).slice(0, 34), totX, y + 4);
          doc.text((c.sign === -1 ? '-' : '') + money(c.computed), R, y + 4, { align: 'right' });
          y += 6;
        });
        if (Number(q.tax_total) > 0) {
          var taxRows = PosnicPro.quotes._taxBreakup(q.items, function (l) { return Number(l.tax_amount) || 0; });
          if (!taxRows.length) { taxRows = [{ label: 'Tax', amount: Number(q.tax_total) }]; }
          taxRows.forEach(function (t) {
            ensure(12);
            doc.text(txt(t.label).slice(0, 34), totX, y + 4);
            doc.text(money(t.amount), R, y + 4, { align: 'right' });
            y += 6;
          });
        }
        doc.setDrawColor(45, 55, 72); doc.setLineWidth(0.4);
        doc.line(totX, y + 1.5, R, y + 1.5);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(26, 32, 44);
        doc.text('TOTAL', totX, y + 8);
        doc.text(money(q.total), R, y + 8, { align: 'right' });
        y += 14;

        /* payment, bank, terms - stacked, skipped when empty */
        var block = function (label, text) {
          if (!text) { return; }
          var lines = doc.splitTextToSize(txt(text), tableW);
          ensure(8 + lines.length * 4.3);
          doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(138, 148, 166);
          doc.text(label, M, y + 4);
          doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(60, 68, 82);
          lines.forEach(function (ln, i) { doc.text(ln, M, y + 8.5 + i * 4.3); });
          y += 8.5 + lines.length * 4.3 + 2;
        };
        /* Footer sections obey the quote's own layout order (dragged on the
           preview); anything unlisted follows in the default order. */
        var footerTokens = ['payment', 'terms', 'custom', 'notes'];
        var order = [];
        (q.layout || []).forEach(function (t) {
          if (footerTokens.indexOf(t) !== -1 && order.indexOf(t) === -1) { order.push(t); }
        });
        footerTokens.forEach(function (t) {
          if (order.indexOf(t) === -1) { order.push(t); }
        });
        order.forEach(function (t) {
          if (t === 'payment') {
            /* Owner ask: method and bank read as ONE "Payment details" section -
               two wrapped paragraphs under a single label. */
            var paras = [q.payment_method, q.bank_details].filter(Boolean).map(txt);
            if (paras.length) {
              var payLines = [];
              paras.forEach(function (para) {
                doc.splitTextToSize(para, tableW).forEach(function (ln) { payLines.push(ln); });
              });
              ensure(8 + payLines.length * 4.3);
              doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(138, 148, 166);
              doc.text('PAYMENT DETAILS', M, y + 4);
              doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(60, 68, 82);
              payLines.forEach(function (ln, i) { doc.text(ln, M, y + 8.5 + i * 4.3); });
              y += 8.5 + payLines.length * 4.3 + 2;
            }
          }
          else if (t === 'terms') { block('TERMS & CONDITIONS', q.terms || q.note); }
          else if (t === 'custom') {
            (q.custom_blocks || []).forEach(function (b) {
              block(String(b.title || 'NOTE').toUpperCase().slice(0, 60), b.text);
            });
          } else if (t === 'notes') { block('NOTES', q.notes); }
        });

        /* signature - ONLY when the shop uploaded one (owner rule: no image,
           no signatory line at all) */
        if (seller.signature) {
          ensure(40);
          y = Math.min(Math.max(y + 12, 236), bottom - 24);
          try { doc.addImage(seller.signature, 'PNG', 150, y - 4, 36, 12); } catch (e) { /* bad image, line still prints */ }
          doc.setDrawColor(138, 148, 166); doc.setLineWidth(0.3);
          doc.line(138, y + 10, R, y + 10);
          doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(103, 112, 127);
          doc.text('Authorised signatory', (138 + R) / 2, y + 14.5, { align: 'center' });
        }

        pageFooter();
        if (typeof doc.putTotalPages === 'function') { doc.putTotalPages(totalAlias); }
        return doc;
    },
    printNow: function () {
        PosnicPro.quotes._withQuoteDoc(function (doc) {
            if (typeof doc.autoPrint === 'function') { doc.autoPrint(); }
            var url = doc.output('bloburl');
            var w = window.open(url, '_blank');
            if (!w) { PosnicPro.alert('warning', 'Allow pop-ups so the quote can print.'); }
        });
    },
    print: function () {
        var q = PosnicPro.quotes._current || {};
        PosnicPro.quotes._withQuoteDoc(function (doc) {
            doc.save((q.quote_id || 'quote').toLowerCase() + '.pdf');
        });
    },
    /* Apply a quoted unit price to a landed cart row - the SAME math the
       manual price edit runs, so tax (inclusive and exclusive) and totals
       recompute through the one engine. */
    _applyQuotedPrice: function (id, newValue) {
        $('#saleInlineItemPrice_' + id).text(newValue.toFixed(2));
        $('#addSalesLineItemPrice_' + id).text(newValue.toFixed(2));
        $('#addSalesLineItemSellingPrice_' + id).text(newValue.toFixed(2));
        var taxType = $('#addSalesLineItemTaxType_' + id).text();
        var TaxValue = parseFloat($('#addSalesLineItemTax_' + id).text()) || 0;
        var mrpPrice = taxType === 'Exc' ? newValue : newValue / (1 + TaxValue / 100);
        $('#addSalesLineItemSubTotal_' + id).text(mrpPrice.toFixed(2));
        PosnicPro.sales.commonInlineCalculation(id, taxType, TaxValue);
    },
    /*
     * Convert (QUOTED_PRICE_ON_CONVERT_DESIGN): inside validity the sale
     * honours the QUOTED unit prices - a quotation is a price promise.
     * Lapsed quotes convert at today's prices with an explicit notice (the
     * cashier can still override per line through the price_override rail).
     * If any line no longer lands, the quote STAYS open - _sourceQuoteId is
     * cleared so saving the partial sale cannot stamp it converted.
     */
    /*
     * Convert v2 (owner: "all we can match and proceed to receipt"): the
     * sale must equal the quote. Line discounts fold into the NET taxable
     * unit price (the sale re-applies the item's own tax, so tax matches by
     * construction); the quote discount and any named deductions become the
     * sale's extra discount; positive charges land as their own named
     * instant lines. A lapsed quote still loads at today's prices.
     */
    convert: function () {
        var q = PosnicPro.quotes._current;
        if (!q) { return; }
        var lapsed = !!(q.valid_until && new Date(q.valid_until) < new Date());
        PosnicPro.sales._sourceQuoteId = String(q._id);
        PosnicPro.sales._quoteHonoured = !lapsed;
        var customCount = 0;
        var lines = [];
        (q.items || []).forEach(function (l) {
            if (l.kind === 'custom' || !l.item_id) { customCount += 1; return; }
            var qty = Number(l.qty) || 1;
            lines.push({
                item_id: String(l.item_id),
                qty: qty,
                unit_price: Number(l.unit_price) || 0,
                dtype: l.discount ? l.discount.type : '',
                dval: l.discount ? Number(l.discount.value) || 0 : 0
            });
        });
        if (!lines.length) {
            PosnicPro.alert('warning', 'This quote has only custom lines - there is no catalog item to load on a sale.');
            PosnicPro.sales._sourceQuoteId = null;
            return;
        }
        hasher.setHash('sales/new');
        var tries = 0;
        var t = setInterval(function () {
            tries += 1;
            if ($('#sales_new_item_name').is(':visible') || tries > 20) {
                clearInterval(t);
                lines.forEach(function (l) {
                    PosnicPro.sales.itemsMenu.addToLineItemsList(l.item_id);
                });
                var pending = lines.slice();
                var waited = 0;
                var t2 = setInterval(function () {
                    waited += 300;
                    pending = pending.filter(function (l) {
                        var $qty = $('#touchsale_item_qty' + l.item_id);
                        if (!$qty.length) { return true; }
                        if (l.qty > 1 && parseFloat($qty.val()) !== l.qty) {
                            $qty.val(l.qty).trigger('keyup');
                        }
                        if (!lapsed && l.dtype && l.dval > 0) {
                            // the quote's line discount lands as the SALE's
                            // line discount - visible in the Disc column
                            var id2 = l.item_id;
                            if (l.dtype === 'percent') {
                                $('#addSalesLineItemDiscount_' + id2).text(l.dval);
                                $('#discountSign' + id2).text('%');
                            } else {
                                var perUnit = Math.round((l.dval / l.qty) * 100) / 100;
                                $('#addSalesLineItemDiscount_' + id2).text(perUnit.toFixed(2));
                                $('#discountSign' + id2).text(PosnicPro.local.get('currencySign') || '');
                            }
                        }
                        if (!lapsed && l.unit_price > 0) {
                            PosnicPro.quotes._applyQuotedPrice(l.item_id, l.unit_price);
                        }
                        return false;
                    });
                    if (!pending.length || waited > 9000) {
                        clearInterval(t2);
                        if (pending.length) {
                            PosnicPro.sales._sourceQuoteId = null;
                            PosnicPro.sales._quoteHonoured = null;
                            PosnicPro.alert('warning', pending.length + ' of ' + lines.length
                                + ' quoted items are no longer sellable and were skipped - quote '
                                + (q.quote_id || '') + ' stays open.');
                            return;
                        }
                        // quote discount + named deductions -> the sale's
                        // extra discount, as a flat amount
                        var extra = (!lapsed && q.discount && q.discount.computed > 0) ? q.discount.computed : 0;
                        if (!lapsed) {
                            (q.charges || []).forEach(function (c) {
                                if (c.sign === -1) { extra += Number(c.computed) || 0; }
                            });
                        }
                        if (extra > 0) {
                            $('#percentIcon').addClass('d-none');
                            $('#rupeeIcon').removeClass('d-none');
                            $('#extraDisc').text(extra.toFixed(2));
                            try { PosnicPro.sales.calculation.extraDiscoundCalculation(); } catch (e) { /* next edit refreshes */ }
                        }
                        // positive charges become their own named lines
                        var posCharges = lapsed ? [] : (q.charges || []).filter(function (c) {
                            return c.sign !== -1 && Number(c.computed) > 0;
                        });
                        var chargeCount = posCharges.length;
                        posCharges.forEach(function (c) {
                            PosnicPro.sales.charges.push({
                                name: c.name,
                                amount: Number(c.computed) || 0,
                                taxed: false,
                                source: 'quote'
                            });
                        });
                        if (chargeCount) { PosnicPro.sales.renderCharges(); }
                        var finish = function () {
                            var extras = [];
                            if (chargeCount) { extras.push(chargeCount + ' charge(s) on the bill'); }
                            if (extra > 0) { extras.push('quote discount applied'); }
                            if (customCount) { extras.push(customCount + ' custom line(s) stay on the quote'); }
                            var tail = extras.length ? ' ' + extras.join('; ') + '.' : '';
                            if (lapsed) {
                                PosnicPro.alert('warning', 'Quote ' + (q.quote_id || '') + ' lapsed on '
                                    + new Date(q.valid_until).toLocaleDateString('en-IN')
                                    + ' - items loaded at today\'s prices. Quoted total was '
                                    + Number(q.total || 0).toFixed(2) + '.'
                                    + (customCount ? ' ' + customCount + ' custom line(s) stay on the quote.' : ''));
                            } else {
                                PosnicPro.alert('success', 'Quote ' + (q.quote_id || '')
                                    + ' loaded at its quoted prices.' + tail);
                            }
                        };
                        finish();
                    }
                }, 300);
            }
        }, 300);
    },
    cancel: function () {
        var q = PosnicPro.quotes._current;
        if (!q) { return; }
        if (!window.confirm('Cancel quote ' + (q.quote_id || '') + '? The customer can no longer accept it.')) { return; }
        PosnicPro.post({ url: 'quotes/' + q._id + '/transition', data: JSON.stringify({ action: 'cancel' }) }, function (r) {
            PosnicPro.alert(r.type, r.message);
            if (r.type === 'success') { hasher.setHash('quotes'); PosnicPro.quotes.showDataTablePage(); }
        });
    },
    remove: function () {
        var q = PosnicPro.quotes._current;
        if (!q) { return; }
        if (!window.confirm('Delete quote ' + (q.quote_id || '') + ' permanently? This cannot be undone.')) { return; }
        PosnicPro.request({ method: 'DELETE', url: 'quotes/' + q._id, data: '{}' }, function (r) {
            PosnicPro.alert(r.type, r.message);
            if (r.type === 'success') { hasher.setHash('quotes'); PosnicPro.quotes.showDataTablePage(); }
        }, function () { PosnicPro.alert('error', 'Could not delete the quote'); });
    },
    /* Save the CART as a quote - born on the sale screen. */
    saveFromSale: function () {
        try {
        var lines = $('#sales_new_items_table tbody tr').map(function () {
            var itemid = $(this).find(':nth-child(9)').text();
            if (!itemid) { return null; }
            return {
                item_id: $('#addSalesLineItemId_' + itemid).text(),
                item_name: $('#addSalesLineItemName_' + itemid).text(),
                barcode_id: $('#addSalesLineItemBarcodeId_' + itemid).text(),
                qty: parseFloat($('#touchsale_item_qty' + itemid).val()) || 1,
                unit_price: parseFloat(String($('#addSalesLineItemPrice_' + itemid).text()).replace(/,/g, '')) || 0
            };
        }).get().filter(Boolean);
        if (!lines.length) { PosnicPro.alert('warning', 'Add at least one item, then save the quote.'); return false; }
        // Owner flow: no questions at save - the quote lands on its A4
        // preview where everything edits in place.
        PosnicPro.quotes._pendingLines = lines;
        PosnicPro.quotes._submit();
        } catch (e) {
            PosnicPro.alert('error', 'Quote could not be built: ' + e.message);
        }
        return false;
    },
    _submit: function () {
        var lines = PosnicPro.quotes._pendingLines || [];
        PosnicPro.quotes._pendingLines = null;
        if (!lines.length) { return; }
        var week = new Date(Date.now() + 7 * 86400000);
        var payload = {
            items: lines,
            customer_id: $('#sales_new_customer_id').val() || '',
            customer_name: $('#sales_new_customer_name').val() || '',
            customer_phone: $('#sales_new_customer_phone').val() || '',
            customer_address: $('#sales_new_customer_address').val() || '',
            customer_gstin: $('#sales_new_customer_gst_number').val() || '',
            valid_until: week.toISOString().slice(0, 10),
            total: parseFloat(String($('#grand_total').val() || '').replace(/,/g, '')) || 0
        };
        PosnicPro.post({ url: 'quotes', data: JSON.stringify(payload) }, function (r) {
            if (r.type !== 'success') { PosnicPro.alert(r.type, r.message); return; }
            PosnicPro.alert('success', 'Quote ' + ((r.data && r.data.quote_id) || '') + ' saved');
            // Owner rule: no questions after a quote save - the cart clears
            // silently (the quote holds the lines now), no Reset Form modal.
            PosnicPro.sales.clear.cartItems(false);
            // Land on the quote itself - print, email or WhatsApp it right there.
            // straight into the editor - polish and share from there
            if (r.data && r.data.id) { hasher.setHash('quotes/' + r.data.id + '/edit'); }
        }, function (xhr) {
            var resp = {}; try { resp = JSON.parse(xhr.responseText); } catch (e) { /* plain */ }
            PosnicPro.alert('error', resp.message || 'Could not save the quote');
        });
        return false;
    },
    emailQuote: function () {
        var q = PosnicPro.quotes._current || {};
        PosnicPro.reportExport.email('quotes_view_body', {
            title: 'Quotation ' + (q.quote_id || ''),
            filename: (q.quote_id || 'quote').toLowerCase(),
            to: q.customer_email || '',
            // a delivered email means the quote went out - open/draft
            // become 'sent' (server no-ops anything else)
            onSent: function () {
                if (!q._id) { return; }
                PosnicPro.post({
                    url: 'quotes/' + q._id + '/transition',
                    data: JSON.stringify({ action: 'send' })
                }, function () {
                    if (q.status === 'open' || q.status === 'draft') { q.status = 'sent'; }
                }, function () { /* the email still went - status is cosmetic */ });
            }
        }, PosnicPro.quotes._withQuoteDoc);
    },
    /*
     * Share link (Q3): the professional PDF the user sees, uploaded to S3
     * under an unguessable key; the newest revision rides the quote. With a
     * callback, hands the URL over (or null); without one, copies it.
     */
    shareLink: function (then) {
        var q = PosnicPro.quotes._current;
        if (!q) { if (then) { then(null); } return; }
        PosnicPro.quotes._withQuoteDoc(function (doc) {
            var b64 = String(doc.output('datauristring')).split(',')[1] || '';
            PosnicPro.post({
                url: 'quotes/' + q._id + '/share',
                data: JSON.stringify({ pdf_base64: b64 })
            }, function (r) {
                if (r.type !== 'success' || !r.data || !r.data.url) {
                    PosnicPro.alert(r.type === 'success' ? 'error' : r.type, r.message || 'Could not create the link');
                    if (then) { then(null); }
                    return;
                }
                q.share = { url: r.data.url, rev: r.data.rev };
                if (then) { then(r.data.url); return; }
                var url = r.data.url;
                var copied = function () { PosnicPro.alert('success', 'Link copied - paste it anywhere. ' + url); };
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(url).then(copied, function () { window.prompt('Copy the quote link:', url); });
                } else {
                    window.prompt('Copy the quote link:', url);
                }
            }, function (xhr) {
                var resp = {}; try { resp = JSON.parse(xhr.responseText); } catch (e) { /* plain */ }
                PosnicPro.alert('warning', resp.message || 'Could not create the link');
                if (then) { then(null); }
            });
        });
    },
    whatsappQuote: function () {
        var q = PosnicPro.quotes._current || {};
        var shop = PosnicPro.local.get('branchname') || 'Our shop';
        var openWa = function (msg) { window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank'); };
        var head = 'Quotation ' + (q.quote_id || '') + ' from ' + shop
            + '\nTotal: ' + Number(q.total || 0).toFixed(2)
            + (q.valid_until ? '\nValid till ' + new Date(q.valid_until).toLocaleDateString('en-IN') : '');
        // link-first: the message carries the PDF's URL; servers without S3
        // fall back to the text summary, same as before
        PosnicPro.quotes.shareLink(function (url) {
            if (url) {
                openWa(head + '\n\nView or download the quotation:\n' + url);
                return;
            }
            openWa(head + '\n\nItems:\n' + (q.items || []).map(function (l) {
                return '- ' + l.item_name + ' x' + l.qty + ' = ' + Number(l.line_total || 0).toFixed(2);
            }).join('\n'));
        });
    }
};
$(function () {
    // The quote button follows its feature switch, live like quick sale.
    var applyQuotesGate = function () {
        var on = true;
        try {
            var gs = JSON.parse(PosnicPro.local.get('general_settings') || '{}');
            on = gs.quotes_enable !== false;
        } catch (e) { /* default on */ }
        // Toggle the tooltip WRAPPER too - hiding only the button left an
        // orphaned hoverable tooltip and an empty flex slot (owner report).
        var $wrap = $('#saveQuoteButton').closest('span[data-toggle="tooltip"]');
        try { $wrap.tooltip('hide'); } catch (e) { /* tooltip not initialised */ }
        ($wrap.length ? $wrap : $('#saveQuoteButton')).toggle(on);
        $('#saveQuoteButton').toggle(on);
    };
    applyQuotesGate();
    $(window).on('hashchange storage', applyQuotesGate);
});
/******** END SALES RECENT ADD EDIT SALES MENU & RECENT ADDED ITEMS MENU ********/

/******** START SALES RECENT ADD EDIT SALES MENU & RECENT ADDED ITEMS MENU ********/
PosnicPro.sales.qr = {
    "intervalId": null,
    /*Touchsale recent Sales details*/
    generate: function () {
        $('#save_btn').attr("disabled", true).css({ cursor: 'not-allowed', color: '#d8d3d3' });
        $('.payment_detail').removeClass('active');
        let amounts = $('#Partial_amount').val().trim() === '' ? $('#grand_total').val() : $('#Partial_amount').val();
        var amount = amounts.replaceAll(',', '');
        var params = {
            url: 'sales/generateQrCode',
            data: { amount: amount }
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                setTimeout(function () {
                    loader.find(".loadingSpinner:first").remove();
                }, 6000);
                var loader = $(".loader-qrimg");
                $("<div class='loadingSpinner'></div>").appendTo(loader);
                var data = response.data;
                $('#qr_view').modal('show');
                $('#qrcode_id').val(data.id);

                var qrContainer = document.querySelector('#qr_view .modal-body') || document.getElementById("qr_view");
                qrContainer.innerHTML = '<div style="width:100%;height:100%;background:#f0f0f0;border-radius:20px;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:24px;">Loading QR...</div>';

                // Method 2: Try without CORS (CSS cropping)
                function tryMethod2() {
                    var img2 = new Image();

                    img2.onload = function () {
                        console.log('Using CSS cropping method');
                        // Use CSS to crop and display the image
                        qrContainer.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#fff;border-radius:15px;box-shadow:0 8px 32px rgba(0,0,0,0.1);"><div style="width:400px;height:400px;overflow:hidden;display:flex;align-items:center;justify-content:center;border-radius:10px;position:relative;"><img src="' + img2.src + '" alt="QR Code" style="width:100%;height:auto;object-fit:contain;clip-path:inset(25% 15% 15% 15%);" /></div></div>';

                        var qrRecord = [];
                        qrRecord.push({ amount: amount, image_url: data.image_url, status: 'yes' });
                        db.customerDisplay.put({ id: '4', 'clear': 'yes', 'get': 'no', qrdata: qrRecord });
                    };

                    img2.onerror = function () {
                        console.log('Direct image load failed, trying proxy method');
                        //tryMethod3();
                    };

                    img2.src = data.image_url;
                }

                // Start with Method 1
                tryMethod2();

                PosnicPro.sales.qr.intervalId = setInterval(function () {
                    PosnicPro.sales.qr.qrStatusUpdate(data);
                }, 10 * 1000);
                setTimeout(function () {
                    loader.find(".loadingSpinner:first").remove();
                }, 5000);
            } else {
                PosnicPro.alert(response.data, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    qrStatusUpdate: function (data) {
        var params = {
            url: 'sales/getQrStatus',
            data: { id: data.id }
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                var data = response.data;
                if (data.payment === 'captured' && data.qr_code === 'closed') {
                    $('#qr_view .modal-body img').attr('src', 'static/images/success-check.png');
                    $('#qr_done').hide();
                    $('.payment_mode').val('Qrpay');
                    $('.payment_mode').attr('checked', false);
                    $('.Qrpay_active').addClass('active');
                    $('#tendered_payment_method').text('Qrpay');
                    var hash = window.location.hash.slice(1);
                    if (hash === '/sales/new') {
                        PosnicPro.sales.addSale.cartOrderSubmit(data);
                    } else {
                        PosnicPro.sales.editSale.cartOrderSubmit(data);
                    }

                    clearInterval(PosnicPro.sales.qr.intervalId);
                    return false;
                } else if (data.qr_code === 'closed') {
                    $('.qr_active').removeClass('active');
                    $('.payment_mode').val('Cash');
                    $('.payment_mode').attr('checked', false);
                    $('.Cash_active').addClass('active');
                    $('#tendered_payment_method').text('Cash');
                    $('#qr_view').modal('hide');
                    clearInterval(PosnicPro.sales.qr.intervalId);
                }
            } else {
                PosnicPro.alert(response.data, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    qrClose: function () {
        $('#save_btn').attr("disabled", false).css({ cursor: 'pointer', color: '#43d187' });
        var id = $('#qrcode_id').val();
        var params = {
            url: 'sales/qrCodeClose',
            data: { id: id }
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                $('.qr_active').removeClass('active');
                $('.payment_mode').val('Cash');
                $('.payment_mode').attr('checked', false);
                $('.Cash_active').addClass('active');
                $('#tendered_payment_method').text('Cash');
                db.customerDisplay.where('id').equals('4').delete();
                PosnicPro.alert('error', response.message);
            } else {
                PosnicPro.alert(response.data, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    }
};
/******** END ~ ADD SALES PAGE MENU ********/

$('#sales_new_customer_name').click(function () {
    PosnicPro.selectAllText(jQuery(this));
});
var $table = $('table.scroll'),
    $bodyCells = $table.find('tbody tr:first').children(),
    colWidth;
$(window).resize(function () {
    colWidth = $bodyCells.map(function () {
        return $(this).width();
    }).get();
    $table.find('thead tr').children().each(function (i, v) {
        $(v).width(colWidth[i]);
    });
}).resize();
/* ONE resolution path for every way a barcode arrives - hardware scanner
   wedge or the camera (L3). Looks the code up, stock-checks, adds the line. */
PosnicPro.sales.addByBarcode = function (barcode) {
        var params = {
            url: 'items/getOnlineItemsAjaxList',
            data: 'query=' + barcode + '&type=barcode'
        };
        PosnicPro.get(params, function (response) {
            if (response && response.suggestions && response.suggestions.length > 0) {
                var itemData = response.suggestions[0] || {};

                var mustCheckStock =
                    (itemData.track_inventory === true || itemData.track_inventory === 'true' || itemData.track_inventory === 1 || itemData.track_inventory === '1');

                var isNegativeStock =
                    (itemData.negative_stock === true || itemData.negative_stock === 'true' || itemData.negative_stock === 1 || itemData.negative_stock === '1');

                if (mustCheckStock && !isNegativeStock) {
                    var availableQty = parseFloat(itemData.available_quantity) || 0;
                    if (availableQty <= 0) {
                        PosnicPro.alert('error', 'Check the product quantity.');
                        return;
                    }
                }

                (PosnicPro.sales.SaleAction === 'return') ? PosnicPro.sales.salesExchange = true : PosnicPro.sales.salesExchange = false;
                $('#sales_new_item_name').focus();

                if (itemData.item_id) {
                    PosnicPro.sales.itemsMenu.addToLineItemsList(itemData.item_id);
                } else if (itemData.id) {
                    PosnicPro.sales.itemsMenu.addToLineItemsList(itemData.id);
                } else if (itemData._id && itemData._id.$oid) {
                    PosnicPro.sales.itemsMenu.addToLineItemsList(itemData._id.$oid);
                } else {
                    PosnicPro.sales.addSalesLineItems(itemData);
                }
            } else {
                $('#sales_new_item_name').focus();
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
};
$('#sales_new_item_name').scannerDetection({
    timeBeforeScanTest: 200, // wait for the next character for upto 200ms
    avgTimeByChar: 40, // it's not a barcode if a character takes longer than 100ms
    preventDefault: true,
    endChar: [13],
    onComplete: function (barcode, qty) {
        validScan = true;
        PosnicPro.sales.addByBarcode(barcode);
    },
    onError: function (string, qty) {
        $('#sales_new_item_name').val($('#sales_new_item_name').val() + string).trigger('input');
    }
});

/*
 * Camera scan (Loyverse study L3): the browser's BarcodeDetector where it
 * exists (Chromium on Android/desktop - exactly the cheap devices busy
 * shops carry). The button only shows when the capability is real; codes
 * land in the SAME addByBarcode path as the hardware wedge.
 */
PosnicPro.sales.cameraScan = {
    _stream: null,
    _timer: null,
    open: function () {
        if (!('BarcodeDetector' in window)) {
            PosnicPro.alert('warning', 'Camera scanning needs Chrome or Edge on this device');
            return;
        }
        if (!$('#camera_scan_modal').length) {
            $('body').append(
                '<div class="modal fade" id="camera_scan_modal" tabindex="-1" role="dialog" aria-hidden="true">' +
                '<div class="modal-dialog modal-dialog-centered" role="document"><div class="modal-content">' +
                '<div class="modal-header"><h5 class="modal-title"><i class="feather icon-camera mr-2"></i>Scan an item</h5>' +
                '<button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button></div>' +
                '<div class="modal-body p-2 text-center">' +
                '<video id="camera_scan_video" autoplay playsinline muted style="width:100%;border-radius:6px;background:#000;min-height:240px;"></video>' +
                '<small class="text-muted d-block mt-1">Point the camera at a barcode</small>' +
                '</div></div></div></div>');
            $('#camera_scan_modal').on('hidden.bs.modal', PosnicPro.sales.cameraScan.stop);
        }
        var self = PosnicPro.sales.cameraScan;
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(function (stream) {
            self._stream = stream;
            var video = document.getElementById('camera_scan_video');
            $('#camera_scan_modal').modal('show');
            video.srcObject = stream;
            var detector = new window.BarcodeDetector();
            self._timer = setInterval(function () {
                if (!video.videoWidth) { return; }
                detector.detect(video).then(function (codes) {
                    if (codes && codes.length && codes[0].rawValue) {
                        var code = codes[0].rawValue;
                        $('#camera_scan_modal').modal('hide');
                        PosnicPro.sales.addByBarcode(code);
                    }
                }).catch(function () { /* keep looking */ });
            }, 350);
        }).catch(function () {
            PosnicPro.alert('error', 'Could not open the camera - check permission');
        });
    },
    stop: function () {
        var self = PosnicPro.sales.cameraScan;
        if (self._timer) { clearInterval(self._timer); self._timer = null; }
        if (self._stream) {
            self._stream.getTracks().forEach(function (t) { t.stop(); });
            self._stream = null;
        }
    }
};
$(document).ready(function () {
    if ('BarcodeDetector' in window && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        $('#camera_scan_btn').show();
    }
    // Quick Sale is a feature, default ON - the pad follows the switch
    // live: re-checked on every navigation (the settings save rewrites the
    // local blob) and on cross-tab storage writes, so no refresh needed.
    PosnicPro.sales.applyQuickSaleGate();
    $(window).on('hashchange storage', PosnicPro.sales.applyQuickSaleGate);
    PosnicPro.sales.loadCatTiles();
});
/* LS2 (Lightspeed study): cash counting offers the till's real notes and
   coins by currency. Shop-defined denominations in Settings always win;
   this only replaces the one-size-fits-all fallback. */
PosnicPro.sales.defaultDenominations = function () {
    var sign = (PosnicPro.local.get('currencySign') || '').trim();
    var SETS = {
        '₹': [1, 2, 5, 10, 20, 50, 100, 200, 500],
        '$': [0.01, 0.05, 0.1, 0.25, 1, 5, 10, 20, 50, 100],
        '€': [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200],
        '£': [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50],
        'RM': [0.05, 0.1, 0.2, 0.5, 1, 5, 10, 20, 50, 100],
        '฿': [0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 500, 1000],
        'د.إ': [0.25, 0.5, 1, 5, 10, 20, 50, 100, 200, 500, 1000],
        'Rs': [1, 2, 5, 10, 20, 50, 100, 500, 1000, 5000]
    };
    return (SETS[sign] || [1, 2, 5, 10, 20, 50, 100, 200, 500]).slice();
};
/* A sale carries a register session only while the Cash Register feature
   is ON - with it off, a register id left in localStorage from before the
   switch must not lock anyone out of tendering. */
PosnicPro.sales.saleRegisterId = function () {
    try {
        var gs = JSON.parse(PosnicPro.local.get('general_settings') || '{}');
        if (gs.cash_register_enable === false) { return ''; }
    } catch (e) { /* feature defaults on */ }
    return PosnicPro.local.get('cash_register_id') || '';
};
PosnicPro.sales.applyQuickSaleGate = function () {
    var on = true;
    try {
        var gs = JSON.parse(PosnicPro.local.get('general_settings') || '{}');
        on = gs.quick_sale_enable !== false;
    } catch (e) { /* default on */ }
    // Per-user grant (owner ask): deny only when the checkbox was
    // explicitly unticked - old permission sets lack the key entirely.
    var pos = PosnicPro.userACL && PosnicPro.userACL.pos;
    if (pos && typeof pos === 'object' && pos.quick_sale === false) { on = false; }
    $('#quick_sale_btn').toggle(on);
};

/*
 * Quick Sale (Square study Q1): the busy-counter mode - type an amount,
 * it becomes a line, tender as normal. Rides the instant-item rail end to
 * end (items/instanceItemInsert -> addSalesLineItems), so stock, reports,
 * receipts and sync see an ordinary sale; the line is priced tax-INCLUSIVE
 * against the shop's default tax, exactly like a normal inclusive item.
 */
/* Q2: mint (or fetch) the sale's permanent invoice link and copy it. */
$(document).on('click', '.sale-invoice-link', function () {
    var saleId = $(this).data('sale-id');
    PosnicPro.post({ url: 'sales/' + saleId + '/invoiceLink', data: JSON.stringify({}) }, function (response) {
        var url = response && response.data && response.data.url;
        if (response.type === 'success' && url) {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(url);
            }
            PosnicPro.alert('success', 'Invoice link copied - it works forever');
        } else {
            PosnicPro.alert(response.type || 'error', response.message || 'Could not create the link');
        }
    }, function (xhr) {
        var resp = {}; try { resp = JSON.parse(xhr.responseText); } catch (e) { /* plain */ }
        PosnicPro.alert('error', resp.message || 'Could not create the link');
    });
});

/* Tip quick-picks (owner feedback): focus the tip box, tap an amount. */
$(document).on('focus', '#sale_tip_input', function () {
    var $chips = $('.tip-chips');
    if (!$chips.children().length) {
        $chips.html([10, 20, 50, 100].map(function (v) {
            return '<button type="button" class="btn btn-sm btn-outline-secondary tip-chip" data-v="' + v + '" style="padding:0 8px; margin-right:3px;">' + v + '</button>';
        }).join(''));
    }
    $chips.show();
});
$(document).on('blur', '#sale_tip_input', function () {
    setTimeout(function () { $('.tip-chips').hide(); }, 250);
});
$(document).on('mousedown', '.tip-chip', function (e) {
    e.preventDefault();
    $('#sale_tip_input').val($(this).data('v'));
});

/* Recent items under the sale search: rendered from the same LRU, picked
   straight into the cart. */
PosnicPro.sales.renderRecentItems = function () {
    var list = PosnicPro.sales._recentGet('recent_items');
    if (!list.length && PosnicPro.sales._itemSeed) { list = PosnicPro.sales._itemSeed; }
    if (!list.length) {
        PosnicPro.sales.seedRecentItems(function (seed) {
            if (seed.length) { PosnicPro.sales.renderRecentItems(); }
        });
    }
    var box = $('#sales_recent_items');
    if (!list.length) { box.hide(); return; }
    if (!box.length) {
        box = $('<div id="sales_recent_items" class="autocomplete-suggestions" style="position:absolute; z-index:1050; display:none; max-height:280px; overflow-y:auto;"></div>').appendTo('body');
        $(document).on('mousedown', '.recent-item-row', function (e) {
            e.preventDefault();
            var l = PosnicPro.sales._recentGet('recent_items');
            var it = l[$(this).data('i')];
            $('#sales_recent_items').hide();
            if (it) { PosnicPro.sales.itemsMenu.addToLineItemsList(it.id); }
        });
    }
    var input = $('#sales_new_item_name');
    var off = input.offset();
    var currency = PosnicPro.local.get('currencySign');
    box.html(list.map(function (it, i) {
        var img = (it.image && it.image !== 'item.svg') ? it.image : 'static/images/default/item.svg';
        return '<div class="autocomplete-suggestion recent-item-row" data-i="' + i + '" style="cursor:pointer;">' +
            '<img src="' + img + '" height="40" width="40" style="border-radius: 25%;" /> ' +
            '<div class="suggestion-name">' + $('<span>').text(it.name).html() + '</div>' +
            '<span><span class="suggestion-price pull-right">' + currency + '&nbsp;' + (Number(it.price) || 0).toFixed(2) + '</span></span></div>';
    }).join(''))
        .css({ top: off.top + input.outerHeight(), left: off.left, width: input.outerWidth() })
        .show();
};
$(document).on('click', '#sales_new_item_name', function () {
    if (($(this).val() || '').trim() === '') { PosnicPro.sales.renderRecentItems(); }
});
/* A fresh till has no pick history - seed the recents once from the
   ordinary item list (one small indexed fetch, cached for the session). */
PosnicPro.sales._itemSeed = null;
PosnicPro.sales.seedRecentItems = function (done) {
    if (PosnicPro.sales._itemSeed) { done(PosnicPro.sales._itemSeed); return; }
    PosnicPro.get({ url: 'items/getOnlineItemsAjaxList', data: 'query=&type=normal' }, function (r) {
        var rows = (r && r.suggestions) || [];
        PosnicPro.sales._itemSeed = rows.map(function (d) {
            return { id: d.item_id, name: d.item_name, price: d.selling_price, image: d.image };
        }).filter(function (x) { return x.id && x.name; });
        done(PosnicPro.sales._itemSeed);
    }, function () { done([]); });
};
$(document).on('input blur', '#sales_new_item_name', function () {
    var self = this;
    setTimeout(function () {
        if (($(self).val() || '').trim() !== '' || !$(self).is(':focus')) { $('#sales_recent_items').hide(); }
    }, 200);
});

PosnicPro.sales.quickSale = {
    _tax: null,
    _count: 0,
    open: function () {
        if (!$('#quick_sale_modal').length) {
            $('body').append(
                '<div class="modal fade" id="quick_sale_modal" tabindex="-1" role="dialog" aria-hidden="true">' +
                '<div class="modal-dialog modal-sm modal-dialog-centered" role="document"><div class="modal-content">' +
                '<div class="modal-header py-2"><h5 class="modal-title"><i class="feather icon-zap mr-2"></i>Quick sale</h5>' +
                '<button type="button" class="close" data-dismiss="modal" aria-label="Close"><span aria-hidden="true">&times;</span></button></div>' +
                '<div class="modal-body">' +
                '<input type="number" min="0" step="any" class="form-control form-control-lg text-right mb-2" id="quick_sale_amount" placeholder="0.00" autocomplete="off" style="font-size:1.6rem;">' +
                '<input type="text" class="form-control mb-2" id="quick_sale_note" maxlength="100" placeholder="Item name (optional)" autocomplete="off">' +
                '<small class="text-muted d-block" id="quick_sale_hint"></small>' +
                '<small class="text-muted d-block" id="quick_sale_added"></small>' +
                '</div>' +
                '<div class="modal-footer py-2">' +
                '<button type="button" class="btn btn-outline-secondary btn-sm" data-dismiss="modal">Done</button>' +
                '<button type="button" class="btn btn-warning-rgba" id="quick_sale_add" onclick="PosnicPro.sales.quickSale.add();">Add to sale</button>' +
                '</div></div></div></div>');
            $('#quick_sale_amount').on('keydown', function (e) {
                if (e.key === 'Enter') { PosnicPro.sales.quickSale.add(); }
            });
        }
        PosnicPro.sales.quickSale._count = 0;
        $('#quick_sale_added').text('');
        $('#quick_sale_amount,#quick_sale_note').val('');
        // The shop's default tax, fetched once - the amount is treated as
        // tax-inclusive against it, like any inclusive-priced item.
        if (PosnicPro.sales.quickSale._tax === null) {
            if (!PosnicPro.sales.taxFeatureOn()) {
                PosnicPro.sales.quickSale._tax = { id: '', name: '', value: 0 };
                $('#quick_sale_hint').text('No tax applied');
            } else {
                PosnicPro.get({ url: 'setting/getTaxAjaxList', data: 'query=' }, function (response) {
                    var wanted = PosnicPro.local.get('default_tax_id');
                    var found = null;
                    (response.suggestions || []).forEach(function (t) {
                        if (String(t.tax_id) === String(wanted)) { found = t; }
                    });
                    PosnicPro.sales.quickSale._tax = found
                        ? { id: found.tax_id, name: found.tax_name, value: Number(found.tax_value) || 0 }
                        : { id: '', name: '', value: 0 };
                    $('#quick_sale_hint').text(found
                        ? found.tax_name + ' (' + found.tax_value + '%) included in the price'
                        : 'No tax applied');
                }, function () {
                    PosnicPro.sales.quickSale._tax = { id: '', name: '', value: 0 };
                });
            }
        } else {
            var t = PosnicPro.sales.quickSale._tax;
            $('#quick_sale_hint').text(t.id ? t.name + ' (' + t.value + '%) included in the price' : 'No tax applied');
        }
        $('#quick_sale_modal').modal('show');
        setTimeout(function () { $('#quick_sale_amount').focus(); }, 400);
    },
    add: function () {
        var amount = parseFloat($('#quick_sale_amount').val());
        if (!Number.isFinite(amount) || amount <= 0) {
            $('#quick_sale_amount').focus();
            return;
        }
        var note = ($('#quick_sale_note').val() || '').trim();
        var tax = PosnicPro.sales.quickSale._tax || { id: '', name: '', value: 0 };
        $('#quick_sale_add').prop('disabled', true);
        PosnicPro.post({
            url: 'items/instanceItemInsert',
            data: JSON.stringify({
                items_name: note || 'Quick sale',
                items_quantity: 1,
                items_mrp_price: amount,
                items_selling_price: amount,
                items_company_price: 0,
                items_discount_amount: 0,
                items_discount_percentage: 0,
                items_tax_id: tax.id,
                items_tax_name: tax.name,
                items_tax: tax.value,
                items_tax_type: 'inclusive',
                items_sku: '',
                items_category_id: '',
                items_category_name: '',
                items_unit: 'qty'
            })
        }, function (response) {
            $('#quick_sale_add').prop('disabled', false);
            if (response.type !== 'success') {
                PosnicPro.alert(response.type, response.message);
                return;
            }
            var data = response.data;
            PosnicPro.sales.addSalesLineItems({
                item_id: data.id,
                item_name: data.name,
                selling_price: data.selling_price,
                barcode_id: data.barcode_id,
                item_quantity: data.available_quantity,
                discount_amount: data.discount_amount,
                discount_percentage: data.discount_percentage,
                tax: data.tax,
                company_price: data.company_price,
                category_id: data.category_id,
                category_name: data.category_name,
                tax_type: data.tax_type,
                sales_type: 'instant',
                instant_status: 'ok',
                unit: data.unit
            });
            PosnicPro.sales.quickSale._count += 1;
            $('#quick_sale_added').text(PosnicPro.sales.quickSale._count + ' line(s) added to this sale');
            $('#quick_sale_amount,#quick_sale_note').val('');
            $('#quick_sale_amount').focus();
        }, function (xhr) {
            $('#quick_sale_add').prop('disabled', false);
            var resp = {}; try { resp = JSON.parse(xhr.responseText); } catch (e) { /* plain */ }
            PosnicPro.alert('error', resp.message || 'Could not add the quick sale line');
        });
    }
};
/*
 * Discounts are a POS power (owner ask): the discount_apply permission
 * gates the sale-screen discount editor; a cashier without it gets the
 * manager PIN prompt, the same rail as price edits and refunds. The
 * capture-phase listener beats the x-editable's own direct binding.
 */
document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('#extraDisc, #percentIcon, #rupeeIcon, #click_discount_description');
    if (!t) { return; }
    if (PosnicPro._discountApproved) { PosnicPro._discountApproved = false; return; }
    if (PosnicPro.posCan && !PosnicPro.posCan('discount_apply')) {
        e.preventDefault();
        e.stopPropagation();
        PosnicPro.requireManagerApproval('discount_apply',
            { prompt: "Applying a discount needs a manager's approval." },
            function () {
                PosnicPro._discountApproved = true;
                t.click();
            });
    }
}, true);

/* One shape vocabulary for every tile renderer. */
PosnicPro.tileShapeCss = function (shape, baseRadius) {
    var CLIPS = {
        triangle: 'polygon(50% 0,100% 100%,0 100%)',
        pentagon: 'polygon(50% 0,100% 38%,82% 100%,18% 100%,0 38%)',
        hexagon: 'polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%)',
        star: 'polygon(50% 0%,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%)',
        octagon: 'polygon(30% 0,70% 0,100% 30%,100% 70%,70% 100%,30% 100%,0 70%,0 30%)',
        diamond: 'polygon(50% 0,100% 50%,50% 100%,0 50%)'
    };
    if (shape === 'circle') { return 'border-radius:50%;'; }
    if (shape === 'rounded') { return 'border-radius:22%;'; }
    if (CLIPS[shape]) { return 'clip-path:' + CLIPS[shape] + ';'; }
    return 'border-radius:' + (baseRadius || '6px') + ';';
};
/* New imageless items dress themselves: a stable colour and shape from
   the name, changeable any time (owner ask - never a bare placeholder). */
PosnicPro.autoTile = function (name) {
    var h = 0;
    var str = String(name || '');
    for (var i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) >>> 0; }
    var COLORS = ['#e74c3c', '#e91e63', '#f39c12', '#a4c400', '#27ae60', '#2d9cdb', '#8e44ad', '#16a085', '#d35400'];
    // Auto-dress keeps to the calm four; the renderers still draw
    // every shape ever saved.
    var SHAPES = ['square', 'rounded', 'circle', 'diamond'];
    return { color: COLORS[h % COLORS.length], shape: SHAPES[(h >> 4) % SHAPES.length] };
};
/* Category tile inheritance (CATEGORY_TILE_INHERITANCE_DESIGN.md):
   one render-time rule everywhere - photo beats the item's own tile,
   which beats the category's, which beats the name-hash dressing. */
PosnicPro.sales._catTiles = {};
PosnicPro.sales.loadCatTiles = function () {
    PosnicPro.get({
        url: 'categories',
        data: { page: 1, limit: 200, branch_id: PosnicPro.local.get('branch_id_set') }
    }, function (r) {
        var rows = (r && r.data && (r.data.list || r.data)) || [];
        if (!rows.forEach) { rows = []; }
        var map = {};
        rows.forEach(function (c) {
            var id = String(c._id || c.id || '');
            if (id && (c.tile_color || c.tile_shape)) {
                map[id] = { color: c.tile_color || '', shape: c.tile_shape || '' };
            }
        });
        PosnicPro.sales._catTiles = map;
    }, function () { /* no map, no inheritance - never an error */ });
};
PosnicPro.resolveTile = function (d) {
    var color = d.tile_color || '';
    var shape = d.tile_shape || '';
    if (!color) {
        var cat = PosnicPro.sales._catTiles[String(d.category_id || '')];
        if (cat) { color = cat.color || ''; shape = shape || cat.shape || ''; }
    }
    if (!color && PosnicPro.autoTile) {
        var auto = PosnicPro.autoTile(d.item_name || d.name || '');
        color = auto.color; shape = shape || auto.shape;
    }
    return { color: color, shape: shape };
};
/* One suggestion row for every item typeahead (sale + purchase): thumb,
   name + meta (SKU / category), price + live stock badge. */
PosnicPro.sugRow = function (d, nameHtml, o) {
    o = o || {};
    var esc = function (v) { return $('<i>').text(v == null ? '' : v).html(); };
    var thumb;
    if (d.image && d.image !== 'item.svg') {
        thumb = '<img class="sug-thumb" src="' + esc(d.image) + '" loading="lazy" alt="">';
    } else {
        var rt = PosnicPro.resolveTile(d);
        var shapeCss = rt.shape ? PosnicPro.tileShapeCss(rt.shape, '10px') : '';
        thumb = '<span class="sug-tile" style="' + shapeCss + 'background:' + esc(rt.color || '#8a94a6') + '">'
            + esc(d.plu_code || (d.item_name || '?').charAt(0).toUpperCase()) + '</span>';
    }
    var meta = [];
    if (d.itemid || d.item_code) { meta.push(esc(d.itemid || d.item_code)); }
    if (d.category_name) { meta.push(esc(d.category_name)); }
    var stock;
    if (d.item_kind === 'service') {
        stock = '<span class="sug-stock na">Service</span>';
    } else if (d.track_inventory === false) {
        stock = '<span class="sug-stock na">Not tracked</span>';
    } else {
        var q = Number(d.available_quantity) || 0;
        var low = parseFloat(PosnicPro.local.get('notificationrange'));
        if (!isFinite(low) || low <= 0) { low = 5; }
        if (q <= 0) { stock = '<span class="sug-stock out">Out of stock</span>'; }
        else if (q <= low) { stock = '<span class="sug-stock low">' + q + ' left</span>'; }
        else { stock = '<span class="sug-stock in">In stock ' + q + '</span>'; }
    }
    var priceHtml = o.price != null
        ? '<div class="sug-price">' + o.currency + '&nbsp;' + Number(o.price).toFixed(2)
            + (o.was != null ? '<del>' + o.currency + '&nbsp;' + Number(o.was).toFixed(2) + '</del>' : '')
            + '</div>'
        : '';
    return '<div class="sug-row">' + thumb
        + '<div class="sug-main"><div class="sug-name">' + nameHtml + '</div>'
        + (meta.length ? '<div class="sug-meta">' + meta.join(' &middot; ') + '</div>' : '')
        + '</div><div class="sug-side">' + priceHtml + stock + '</div></div>';
};
PosnicPro.sugActionRow = function (icon, cls, title, meta) {
    return '<div class="sug-row sug-action ' + cls + '">'
        + '<span class="sug-tile"><i class="feather ' + icon + '"></i></span>'
        + '<div class="sug-main"><div class="sug-name">' + title + '</div>'
        + '<div class="sug-meta">' + meta + '</div></div></div>';
};
/* Owner: typing here must NEVER wait. One-time widget init (the old code
   re-created the whole autocomplete on every keydown AND keyup), requests
   trail the keystrokes by 120ms, and late responses for stale queries are
   dropped. The lookup itself is async - the input never blocks on it. */
$(function () {
    var itemLookupSeq = 0;
    $('#sales_new_item_name').autocomplete({
        deferRequestBy: 120,
        lookup: function (query, done) {
            var seq = ++itemLookupSeq;
            var result = {};
            var suggestions = [];
            var params = {
                url: 'items/getOnlineItemsAjaxList',
                data: 'query=' + query + '&type=normal'
            };
            PosnicPro.get(params, function (response) {
                if (seq !== itemLookupSeq) { return; }
                if (response.suggestions.length > 0) {
                    suggestions: $.map(response.suggestions, function (dataItem) {
                        let timeZone = PosnicPro.local.get('timezone');
                        let dateTime = new Date().getTime();
                        let currentDateTimeCentralTimeZone = moment(dateTime).tz(timeZone).format('YYYY/MM/DD hh:mm A');
                        let currentDate = new Date().getTime(currentDateTimeCentralTimeZone);
                        let items_expiry_date = dataItem.items_expiry_date;
                        if (items_expiry_date >= currentDate || items_expiry_date === null || items_expiry_date === '') {
                            suggestions.push({ "value": dataItem.item_name, "data": dataItem });
                        }
                    });
                } else {
                    var quickOn = true;
                    try {
                        var gsq = JSON.parse(PosnicPro.local.get('general_settings') || '{}');
                        quickOn = gsq.quick_sale_enable !== false;
                    } catch (e) { /* default on */ }
                    if (quickOn) { suggestions.push({ value: query + ' ', data: { __action: 'quick' } }); }
                    suggestions.push({ value: query + '  ', data: { __action: 'create' } });
                }
                result["suggestions"] = suggestions;
                done(result);
            });
        },
        onSelect: function (suggestion) {
            var act = suggestion.data && suggestion.data.__action;
            if (act) {
                var typed = (suggestion.value || '').trim();
                $('#sales_new_item_name').val('');
                if (act === 'quick') {
                    PosnicPro.sales.quickSale.open();
                    $('#quick_sale_note').val(typed);
                } else {
                    PosnicPro.quickitems.popup(typed, function (newId) {
                        if (newId) { PosnicPro.sales.itemsMenu.addToLineItemsList(newId); }
                    });
                }
                return;
            }
            if (suggestion.data !== -1) {
                $('#sales_new_item_name').val('');
                $('#sales_new_item_name').focus();
                (PosnicPro.sales.SaleAction === 'return') ? PosnicPro.sales.salesExchange = true : PosnicPro.sales.salesExchange = false;

                var itemData = suggestion.data || {};

                // Prefer the explicit item_id returned by getOnlineItemsAjaxLists
                if (itemData.item_id) {
                    PosnicPro.sales.itemsMenu.addToLineItemsList(itemData.item_id);
                } else if (itemData.id) {
                    PosnicPro.sales.itemsMenu.addToLineItemsList(itemData.id);
                } else if (itemData._id && itemData._id.$oid) {
                    PosnicPro.sales.itemsMenu.addToLineItemsList(itemData._id.$oid);
                } else {
                    // Fallback to previous behaviour if no usable id is found
                    PosnicPro.sales.addSalesLineItems(itemData);
                }
            }
        },
        autoSelectFirst: true,
        triggerSelectOnValidInput: false,
        formatResult: function (suggestion, currentValue) {
            var act = suggestion.data && suggestion.data.__action;
            if (act) {
                var typedName = $('<i>').text((suggestion.value || '').trim()).html();
                return act === 'quick'
                    ? PosnicPro.sugActionRow('icon-zap', 'quick',
                        'Sell &quot;' + typedName + '&quot; as a quick sale',
                        'Nothing saved - just enter the amount')
                    : PosnicPro.sugActionRow('icon-plus-circle', 'create',
                        'Create item &quot;' + typedName + '&quot;',
                        'Name and price now - details anytime later');
            }
            {
                var currency = PosnicPro.local.get('currencySign');
                var price = 0;
                let sellingPrice = suggestion.data.selling_price;
                let discountAmount = suggestion.data.discount_amount;
                let discountPercentage = suggestion.data.discount_percentage;
                let tax = suggestion.data.tax;
                let taxType = suggestion.data.tax_type;
                let taxPrice = (sellingPrice * tax) / (100 + tax);
                var inclusive_price = sellingPrice - taxPrice.toFixed(2);
                if (discountAmount > 0 && tax > 0) {
                    var discountValue = 0;
                    if (taxType === 'exclusive') {
                        discountValue = sellingPrice - discountAmount;
                    } else {
                        discountValue = inclusive_price - discountAmount;
                    }
                    price = discountValue + (tax / 100) * discountValue;

                } else if (discountPercentage > 0 && tax > 0) {
                    var discountValue = 0;
                    var taxValue = 0;
                    if (taxType === 'exclusive') {
                        discountValue = (sellingPrice * (discountPercentage / 100));
                        taxValue = sellingPrice - discountValue;
                    } else {
                        discountValue = (inclusive_price * (discountPercentage / 100));
                        taxValue = inclusive_price - discountValue;
                    }
                    price = taxValue + (tax / 100) * taxValue;
                } else if (discountAmount > 0) {
                    price = sellingPrice - discountAmount;
                } else if (discountPercentage > 0) {
                    price = sellingPrice - (sellingPrice * (discountPercentage / 100));
                } else if (tax > 0) {
                    if (taxType === 'exclusive') {
                        price = sellingPrice + (sellingPrice * tax / 100);
                    } else {
                        price = inclusive_price + (inclusive_price / 100) * tax;
                    }
                } else {
                    price = suggestion.data.selling_price;
                }
                return PosnicPro.sugRow(suggestion.data,
                    $.Autocomplete.formatResult(suggestion, currentValue), {
                        currency: currency,
                        price: price,
                        was: (sellingPrice.toFixed(2) === price.toFixed(2)) ? null : sellingPrice
                    });
            }
        }
    });
});

$(document).ready(function () {
    $('#sales_new_item_name').focus();
    $('#sales_new_balance_amount').addClass('bg-white');
    PosnicPro.commonDate();
    // Add active class to the current button (highlight it)
    $('.button-list-categories').click(function () {
        $('.button-list-categories').removeClass('selectedTab');
        $(this).addClass('selectedTab');
    });
});

var substringMatcher = function (strs) {
    return function findMatches(q, cb) {
        var matches = [];
        
        // Escape special characters for regex
        var escapeRegex = function(string) {
            return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        };

        // Split query into words and filter out empty strings
        var tokens = q.trim().split(/\s+/).filter(function(token) {
            return token.length > 0;
        });

        if (tokens.length === 0) {
            cb([]);
            return;
        }

        // Create regex for each token
        var tokenRegexes = tokens.map(function(token) {
            return new RegExp(escapeRegex(token), 'i');
        });

        // Iterate through the pool of strings
        $.each(strs, function (i, str) {
            // Check if ALL tokens match the string
            var allMatch = tokenRegexes.every(function(regex) {
                return regex.test(str);
            });

            if (allMatch) {
                matches.push(str);
            }
        });

        cb(matches);
    };
};
/*
 * Recency lists (owner feedback): the pickers open with the last 10 picks
 * of THIS till, kept as a tiny localStorage LRU written at pick time - the
 * international "recents" pattern, zero server queries, zero aggregation.
 */
PosnicPro.sales._recentGet = function (key) {
    try { return JSON.parse(PosnicPro.local.get(key) || '[]'); } catch (e) { return []; }
};
PosnicPro.sales._recentPush = function (key, entry, idField) {
    if (!entry || !entry[idField]) { return; }
    var list = PosnicPro.sales._recentGet(key).filter(function (r) {
        return String(r[idField]) !== String(entry[idField]);
    });
    list.unshift(entry);
    PosnicPro.local.set(key, JSON.stringify(list.slice(0, 10)));
};
/* ONE customer-pick path: search results and recent rows both land here. */
PosnicPro.sales.applyCustomerPick = function (data) {
    var customerRecord = [];
    PosnicPro.local.set('customerName', data.name);
    PosnicPro.local.set('customerPhone', data.phone);
    PosnicPro.local.set('customerEmail', data.email);
    PosnicPro.local.set('customerAddress', data.address);
    $('#sales_new_customer_id').val(data.id);
    $('#sales_new_customer_name').val(data.name);
    $('#sales_new_customer_address').val(data.address);
    $('#sales_new_customer_phone').val(data.phone);
    $('#sales_new_customer_email').val(data.email);
    $('#sales_new_customer_state').val(data.state);
    $('#sales_new_customer_country').val(data.country);
    $('#sales_new_customer_gst_type').val(data.gst_type);
    $('#sales_new_customer_gst_number').val(data.gst_number);
    $('#sales_new_customer_partial_balance').val(data.partial_balance);
    $('#customer_current_balance').val(data.balance);
    // Price lists (V4): remember this customer's category so newly added
    // lines price from their list; fetch when the payload lacks it.
    PosnicPro.sales._customerCategoryId = String(data.category_id || '');
    if (!PosnicPro.sales._customerCategoryId && data.id) {
        PosnicPro.get('customers/' + data.id, function (r) {
            if (r && r.data) {
                PosnicPro.sales._customerCategoryId = String(r.data.category_id || '');
            }
        }, function () { /* no category, no list */ });
    }
    customerRecord.push({ name: data.name, phone: data.phone, email: data.email, address: data.address });
    db.customerDisplay.put({ id: '1', clear: 'no', 'get': 'no', customer: customerRecord });
    PosnicPro.sales.calculation.salesTableRowCart();
    if (PosnicPro.loyalty) PosnicPro.loyalty.tillShow(data.id);
    if (PosnicPro.sales.updateCustomerChip) PosnicPro.sales.updateCustomerChip();
    $('.toggle-customer-user').hide();
    PosnicPro.sales._recentPush('recent_customers', {
        id: data.id, name: data.name, phone: data.phone, email: data.email,
        address: data.address, state: data.state, country: data.country,
        gst_type: data.gst_type, gst_number: data.gst_number,
        partial_balance: data.partial_balance, balance: data.balance,
        category_id: data.category_id
    }, 'id');
};
PosnicPro.sales._customerSeed = null;
PosnicPro.sales.renderRecentCustomers = function () {
    var recents = PosnicPro.sales._recentGet('recent_customers');
    var wrap = $('#sales_recent_customers');
    var paint = function (rows) {
        if (!rows.length) { wrap.html('').hide(); return; }
        PosnicPro.sales._recentRendered = rows;
        wrap.html(rows.map(function (c, i) {
            var icon = c._seed ? 'icon-user' : 'icon-clock';
            return '<a href="javascript:void(0)" class="sales-customer-pop-action recent-customer-row" data-i="' + i + '">' +
                '<i class="feather ' + icon + ' mr-2"></i>' + $('<span>').text(c.name).html() +
                (c.phone ? ' <small class="text-muted">' + $('<span>').text(c.phone).html() + '</small>' : '') +
                '</a>';
        }).join('')).show();
    };
    /* Recents lead; the plain paged customer list (an indexed find, no
       aggregation) fills the card to 10 so it is never empty on a fresh
       till - the seed is cached per session. */
    var fill = function (seed) {
        var have = {};
        recents.forEach(function (c) { have[String(c.id)] = 1; });
        var rows = recents.slice();
        (seed || []).forEach(function (c) {
            if (rows.length >= 10 || have[String(c.id)]) { return; }
            rows.push(c);
        });
        paint(rows);
    };
    if (recents.length >= 10) { paint(recents); return; }
    if (PosnicPro.sales._customerSeed) { fill(PosnicPro.sales._customerSeed); return; }
    fill([]); // paint what we have instantly; the seed follows
    PosnicPro.get({ url: 'customers', data: { page: 1, limit: 10 } }, function (response) {
        var list = (response && response.data && response.data.list) || [];
        PosnicPro.sales._customerSeed = list.map(function (c) {
            return {
                id: c._id || c.id, name: c.name, phone: c.phone, email: c.email,
                address: c.address, state: c.state, country: c.country,
                gst_type: c.gst_type, gst_number: c.gst_number,
                partial_balance: c.partial_balance, balance: c.balance,
                category_id: c.category_id, _seed: true
            };
        }).filter(function (c) { return c.id && c.name && c.name !== 'Walk-In-Customer'; });
        fill(PosnicPro.sales._customerSeed);
    }, function () { /* recents alone, or empty - never an error popup */ });
};
/* One mount, once. The bar reports a change; quotes just reloads. */
PosnicPro.quotes._filterMounted = false;
PosnicPro.quotes.mountFilters = function () {
    if (PosnicPro.quotes._filterMounted) { return; }
    if (!$('#quotes_filter_panel').length) { return; }
    PosnicPro.listFilter.mount({
        key: 'quotes',
        container: '#quotes_filter_panel',
        button: '#quotes_filter_btn',
        searchPlaceholder: 'Search customer or quote #',
        dateField: 'Created',
        searchFields: [
            { value: 'all', label: 'All fields' },
            { value: 'quote_id', label: 'Quote #' },
            { value: 'customer_name', label: 'Customer' }
        ],
        /* Suggestions come from the customers this till already uses, whatever
           field is selected - picking one narrows the field for you. */
        typeahead: 'customer',
        typeaheadField: 'customer_name',
        onChange: function (params, state) {
            PosnicPro.quotes._paintChips((state.extra && state.extra.status) || '');
            PosnicPro.quotes.load();
        }
    });
    PosnicPro.quotes._filterMounted = true;
};
$(document).on('click', '#quotes_filter_btn', function () {
    PosnicPro.quotes.mountFilters();
    PosnicPro.listFilter.toggle('quotes');
});

$(document).on('click', '.quotes-row', function () {
    hasher.setHash('quotes/' + $(this).data('id'));
});
/* Close, not Back: the list never went anywhere, so there is nothing behind
   this to return to - closing simply hands the list the full width again. */
$(document).on('click', '#quotes_view_close', function () {
    hasher.setHash('quotes');
    PosnicPro.quotes.showDataTablePage();
});
/* Save changes stays hidden until an inline field is actually edited. A save
   button that is always lit teaches people to ignore it. */
$(document).on('input', '#quotes_view_body .q-edit', function () {
    $('#q_save_edits').show();
});
/* Jira-style: give the document the whole width when the list is in the way,
   and bring it back with the same button. */
$(document).on('click', '#quotes_rail_toggle', function () {
    $('#quotes_new .contentbar').toggleClass('rail-collapsed');
});
$(document).on('click', '.quotes-chip', function () {
    /* The bar may not be built yet - it mounts lazily - and a status set
       outside it would be invisible to the count and to Clear. */
    PosnicPro.quotes.mountFilters();
    PosnicPro.listFilter.setExtra('quotes', 'status', $(this).data('status') || '');
});
/* The chips paint from the bar's state, never from the click, so Clear moves
   them back to All instead of leaving a lit chip over an unfiltered list. */
PosnicPro.quotes._paintChips = function (status) {
    PosnicPro.quotes._status = status || '';
    $('.quotes-chip').removeClass('btn-primary-rgba').addClass('btn-secondary-rgba');
    $('.quotes-chip').filter(function () {
        return String($(this).data('status') || '') === String(status || '');
    }).removeClass('btn-secondary-rgba').addClass('btn-primary-rgba');
};
$(document).on('click', '.recent-customer-row', function () {
    var list = PosnicPro.sales._recentRendered || [];
    var c = list[$(this).data('i')];
    if (c) { PosnicPro.sales.applyCustomerPick(c); }
});

/******** START SALES SEARCH CUSTOMER FUNCTION ONLINE ********/
/* Same never-block treatment as the item box: init once, debounce,
   drop stale responses. */
$(function () {
    var customerLookupSeq = 0;
    $('#sales_new_customer_name').autocomplete({
        deferRequestBy: 120,
        lookup: function (query, done) {
            var seq = ++customerLookupSeq;
            var result = {};
            var suggestions = [];
            var params = {
                url: 'customers/getCustomersAjaxList',
                data: 'query=' + query
            };
            PosnicPro.get(params, function (response) {
                if (seq !== customerLookupSeq) { return; }
                if (response.suggestions.length > 0) {
                    suggestions: $.map(response.suggestions, function (dataItem) {
                        suggestions.push({ "value": dataItem.name, "data": dataItem });
                    });
                } else {
                    suggestions.push({ value: query + ' ', data: -1 });
                }
                result["suggestions"] = suggestions;
                done(result);
            });
        },
        onSelect: function (suggestion) {
            if (suggestion.data !== -1) {
                PosnicPro.sales.applyCustomerPick(suggestion.data);
            } else {
                hasher.setHash('sales/customers/new');
            }
        },
        autoSelectFirst: true,
        triggerSelectOnValidInput: false,
        formatResult: function (suggestion) {
            let phone = suggestion.data.phone;
            if (suggestion.data === -1 || typeof suggestion.phone === undefined) {
                phone = "( Add new )";
            }
            let partial_balance_span = "";
            if (suggestion.data.partial_balance === true) {
                let currency = PosnicPro.local.get('currencySign');
                let balance = suggestion.data.balance;
                partial_balance_span = '<span class="pull-left font-weight-bold">' + currency + '&nbsp;' + balance.toFixed(2) + '</span>';
            }
            return '<div>' +
                $.Autocomplete.formatResult(suggestion) +
                '</div>' + partial_balance_span + '<span class="pull-right">' + phone + '</span>';
        }
    });
});
/******** END SALES SEARCH CUSTOMER FUNCTION ONLINE ********/

$("#sales_new").click(function (e) {
    if ($(e.target).hasClass('osk-trigger')) {
        return false;
    }
    $('#osk-container').hide();
});
$(document).on('change', '.payment_mode', function () {
    var value = this.id;
    $('.payment_mode').val(value);
    $('#tendered_payment_method').html(value);
    if (value === 'Qrpay') {
        PosnicPro.sales.qr.generate();
    }
});
$(document).ready(function () {
    $("#sales_new_items_table tbody tr").remove();
    $('#sales_new_items_table tbody').append('<tr class="sales_new_tablerow_content_area" id="sales_new_tablerow_content_area"><td colspan="8"><div class="text-center text-dark"> <p class="table_cart_content"> <lang class="lang_sale_empty">Sale Order Empty</lang></p></div><img src="static/images/general/wallet.svg" class="img-fluid sales-cart-image" style="opacity: 0.4;width: 100%;" alt="wallet"></td></tr>');
    $("#sales_return_items_table tbody tr").remove();
    $('#sales_return_items_table tbody').append('<tr class="sales_new_tablerow_content_area" id="sales_new_tablerow_content_area"><td colspan="9"><div class="text-center text-dark"> <p class="table_cart_content"><lang class="lang_empty_return">Return Items Order Empty</lang></p></div></td></tr>');
    var imgHeight = $(window).height() - 500;
    $('.sales-cart-image').height(imgHeight);
    $(".changeSales").click(function () {
        $('#tender_amount').val(-Math.abs($('#refund_grand_total').html().replace(/,/g, '')));
    });
    $('.discount_amount_display').hide();
    $('.discount_percentage_display').show();
    db.customerDisplay.where("clear").equals("yes").delete();
});
var $table = $('.tableFixHead').find('thead th')
$('.tableFixHead').on('scroll', function () {
    $table.css('transform', 'translateY(' + this.scrollTop + 'px)');
});
// Customer chip on the sales screen: reflect who the sale is for. "Walk-in"
// (muted user icon) when no customer is set; the customer's name (accent,
// checked icon, name + phone on hover) once one is chosen. Kept in sync from
// the autocomplete select, the new-sale reset and the edit-sale load.
/*
 * Notes edit in place (owner: the popup "can be better. UX Feel").
 * Clicking the pencil opens an input right where the note lives, with the
 * cursor already in it - Enter saves, Escape cancels, clicking away saves.
 * The popup it replaces was a dialog for one short line of text, and it
 * needed a polling loop just to land focus inside its own textarea.
 *
 * The hidden <a> keeps being the value carrier, so every save payload
 * still reads $('#payment_description').val() exactly as it did before.
 */
/*
 * Actions that a manager PIN can unlock wear a small lock (owner ask): a
 * cashier who cannot discount on their own should SEE that the button still
 * works and why it will ask for a PIN, rather than pressing it and being
 * surprised. Hovering says so in words. Actions the user can simply perform
 * carry no lock, so the badge means exactly one thing.
 */
/*
 * The notes cell spans the Sub Total / Discount / Additional Discount rows so
 * the chips can use that whole block. The Additional Discount row is shown and
 * hidden on demand, though, and a cell spanning a row that is not there makes
 * the table render short - so the span follows the row.
 */
PosnicPro.sales.syncNotesCellSpan = function () {
    var $cell = $('#payment_note');
    if (!$cell.length) { return; }
    var extraVisible = $('.add-disc-row').is(':visible');
    $cell.attr('rowspan', extraVisible ? 3 : 2);
};
$(document).on('click', '#sale_add_discount', function () {
    setTimeout(function () { PosnicPro.sales.syncNotesCellSpan(); }, 80);
});
/*
 * Keep each action's tooltip wrapper in step with its button.
 *
 * Every button in the sale action row sits inside a
 * <span data-toggle="tooltip">, and the code hides the BUTTON. The span
 * keeps its width and its tooltip, so resuming a parked sale left an
 * invisible Clear Sale that still said "Clear Sale" on hover - a tooltip
 * for a control that is not there.
 *
 * The button's inline display is the thing to read, not :visible: once the
 * wrapper is hidden every child reports invisible, and the button could
 * never be shown again.
 */
PosnicPro.sales.syncActionTooltips = function () {
    $('#edit_style_button > span[data-toggle="tooltip"]').each(function () {
        var btn = $(this).children('button, a').get(0);
        if (!btn) { return; }
        var hidden = btn.style.display === 'none';
        $(this).css('display', hidden ? 'none' : '');
        if (hidden) {
            // a tooltip already on screen when its button goes must go too
            try { $(this).tooltip('hide'); } catch (e) { /* not initialised yet */ }
        }
    });
};
PosnicPro.sales.markLockedActions = function () {
    var mark = function (sel, perm, what) {
        var $el = $(sel);
        if (!$el.length) { return; }
        var locked = PosnicPro.posCan && !PosnicPro.posCan(perm);
        $el.toggleClass('needs-approval', !!locked);
        if (locked) {
            $el.attr('title', what + ' needs a manager\'s approval - you can still do it, a manager just enters their PIN.');
        } else if (($el.attr('title') || '').indexOf('manager') !== -1) {
            $el.removeAttr('title');
        }
    };
    mark('#sale_add_discount', 'discount_apply', 'Applying a discount');
    mark('#sale_add_charge', 'discount_apply', 'Adding a charge');
};
PosnicPro.sales.noteEdit = {
    open: function (linkId, fieldId, placeholder, maxLen) {
        var $link = $('#' + linkId);
        var $field = $('#' + fieldId);
        if (!$link.length || !$field.length) { return; }
        var $open = $link.next('.note-inline');
        if ($open.length) { $open.find('input').focus(); return; }

        var before = String($field.val() || '');
        var $wrap = $('<span class="note-inline"></span>');
        var $in = $('<input type="text" class="form-control form-control-sm note-inline-input">')
            .attr({ maxlength: maxLen || 500, placeholder: placeholder || 'Add a note' })
            .val(before);
        var $ok = $('<a href="javascript:void(0)" class="note-inline-ok" title="Save note"><i class="feather icon-check"></i></a>');
        $wrap.append($in).append($ok);
        $link.hide().after($wrap);

        var done = false;
        var close = function (save) {
            if (done) { return; }
            done = true;
            var text = save ? $.trim($in.val()) : before;
            $field.val(text);
            $wrap.remove();
            $link.show();
            if (PosnicPro.updateSaleNoteFlag) {
                PosnicPro.updateSaleNoteFlag(linkId, 'feather icon-edit-1', text);
            }
        };
        // mousedown, not click: blur would fire first and close the editor
        $ok.on('mousedown', function (e) { e.preventDefault(); close(true); });
        $in.on('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); close(true); }
            if (e.key === 'Escape') { e.preventDefault(); close(false); }
        });
        $in.on('blur', function () { setTimeout(function () { close(true); }, 120); });
        setTimeout(function () {
            $in.focus();
            var el = $in.get(0);
            if (el && el.setSelectionRange) { el.setSelectionRange(el.value.length, el.value.length); }
        }, 0);
    }
};
$(document).on('click', '#click_payment_description', function (e) {
    e.preventDefault(); e.stopPropagation();
    PosnicPro.sales.noteEdit.open('click_payment_description', 'payment_description', 'Payment note', 500);
});
$(document).on('click', '#click_sales_description', function (e) {
    e.preventDefault(); e.stopPropagation();
    PosnicPro.sales.noteEdit.open('click_sales_description', 'sales_description', 'Sale note', 500);
});
$(document).on('click', '#click_discount_description', function (e) {
    e.preventDefault(); e.stopPropagation();
    PosnicPro.sales.noteEdit.open('click_discount_description', 'discount_description', 'Why this discount?', 2500);
});
/*
 * Last line of defence before a save: a sale is always billed to someone,
 * so if no customer is set, fall back to the branch's cached Walk-in.
 * defaultcustomerSet() fills the fields from the server and caches the
 * record, but it is ASYNC - a cashier who scans and hits Pay immediately
 * can beat it. This is the synchronous half, reading that cache, so the
 * save path never has to refuse a walk-in sale.
 */
PosnicPro.sales.ensureCustomer = function () {
    if ($.trim($('#sales_new_customer_name').val() || '') !== '') { return; }
    var def = null;
    try { def = JSON.parse(PosnicPro.local.get('defaultcustomer') || 'null'); } catch (e) { return; }
    if (!def || !def.customer_name) { return; }
    $('#sales_new_customer_id').val(def.customer_id || '');
    $('#sales_new_customer_name').val(def.customer_name);
    $('#sales_new_customer_address').val(def.customer_address || '');
    $('#sales_new_customer_phone').val(def.customer_phone || '');
    $('#sales_new_customer_email').val(def.customer_email || '');
    $('#sales_new_customer_state').val(def.customer_state || '');
    $('#sales_new_customer_gst_type').val(def.customer_gst_type || '');
    $('#sales_new_customer_gst_number').val(def.customer_gst_number || '');
    if (PosnicPro.sales.updateCustomerChip) { PosnicPro.sales.updateCustomerChip(); }
};
PosnicPro.sales.updateCustomerChip = function () {
    var $btn = $('#sales_customer_btn');
    if (!$btn.length) { return; }
    var id = ($('#sales_new_customer_id').val() || '').trim();
    var name = ($('#sales_new_customer_name').val() || '').trim();
    var phone = ($('#sales_new_customer_phone').val() || '').trim();
    var $icon = $btn.children('i.feather');
    // The branch's own Walk-in record is a real customer with a real id, so
    // reading the chip off the id alone showed its record name where the
    // cashier expects "Walk-in". Treat "customer is the default" as walk-in.
    var isDefaultCustomer = false;
    if (id) {
        try {
            var def = JSON.parse(PosnicPro.local.get('defaultcustomer') || '{}');
            isDefaultCustomer = !!(def && def.customer_id && String(def.customer_id) === String(id));
        } catch (e) { isDefaultCustomer = false; }
    }
    if (id && !isDefaultCustomer) {
        $('#sales_customer_btn_label').text(name || 'Customer');
        $btn.addClass('has-customer');
        $icon.removeClass('icon-user').addClass('icon-user-check');
        var tip = (name || 'Customer') + (phone ? ' · ' + phone : '');
        $btn.attr('data-original-title', tip).attr('title', tip);
    } else {
        $('#sales_customer_btn_label').text('Walk-in');
        $btn.removeClass('has-customer');
        $icon.removeClass('icon-user-check').addClass('icon-user');
        var t = 'Walk-in customer — click to choose or add';
        $btn.attr('data-original-title', t).attr('title', t);
    }
};
// Super-admin "lock sale date": when the setting is off, the New Sale date is
// pinned to the current date/time and the picker is disabled, so cashiers can't
// backdate a sale. The value is set explicitly so it is never blank on submit;
// this fails open (stays editable) on any error or if the setting is unset.
PosnicPro.sales.applySaleDateLock = function () {
    if (PosnicPro.local.get('allow_sale_date_edit') !== 'false') { return; }
    try {
        var tz = PosnicPro.local.get('timezone');
        var now = moment(new Date()).tz(tz).format('YYYY/MM/DD hh:mm A');
        var $d = $('#time-format');
        if ($d.data('datepicker') && typeof $d.data('datepicker').destroy === 'function') {
            $d.data('datepicker').destroy();
        }
        $d.removeClass('commonDate').off('click').val(now)
            .attr('readonly', true).css({ 'pointer-events': 'none' });
    } catch (e) { /* fail open: leave the date editable */ }
};
$('.toggle-user-input').click(function () {
    var $pop = $('.toggle-customer-user');
    $pop.toggle();
    if ($pop.is(':visible')) {
        PosnicPro.sales.renderRecentCustomers();
        setTimeout(function () { $('#sales_new_customer_name').trigger('focus'); }, 0);
    }
});
// Customer popover: close on the × or an outside click; "Walk-in" clears the
// customer back to none. Selecting a search result (autocomplete onSelect) also
// closes it. The popover reuses #sales_new_customer_name so search/submit are
// unchanged - only the presentation moved into a floating card.
$(document).on('click', '#sales_customer_pop_close', function () {
    $('.toggle-customer-user').hide();
});
$(document).on('click', '#sales_customer_walkin', function (e) {
    e.preventDefault();
    $('#sales_new_customer_id,#sales_new_customer_name,#sales_new_customer_address,#sales_new_customer_phone,#sales_new_customer_email,#sales_new_customer_state,#sales_new_customer_gst_type,#sales_new_customer_gst_number,#sales_new_customer_partial_balance').val('');
    /*
     * Walk-in means the branch's OWN Walk-in customer record - the same one
     * a fresh sale starts with - not "no customer at all". Blanking every
     * field left the sale unsaveable: the picker offered Walk-in and then
     * Save answered "Enter a customer name". Shops that deliberately run
     * without a default customer keep the blank fields.
     */
    try { PosnicPro.defaultcustomerSet(); } catch (err) { /* chip still updates below */ }
    if (PosnicPro.sales.updateCustomerChip) { PosnicPro.sales.updateCustomerChip(); }
    if (PosnicPro.loyalty && PosnicPro.loyalty.tillClear) { PosnicPro.loyalty.tillClear(); }
    if (PosnicPro.sales.calculation && PosnicPro.sales.calculation.salesTableRowCart) {
        PosnicPro.sales.calculation.salesTableRowCart();
    }
    $('.toggle-customer-user').hide();
});
$(document).on('mousedown', function (e) {
    var $pop = $('.toggle-customer-user');
    if (!$pop.length || !$pop.is(':visible')) { return; }
    if ($(e.target).closest('.toggle-customer-user, #sales_customer_btn, .autocomplete-suggestions').length === 0) {
        $pop.hide();
    }
});
$(document).ready(function () {
    if (PosnicPro.sales.updateCustomerChip) { PosnicPro.sales.updateCustomerChip(); }
});
$(document).ready(function () {
    $(document).click(function (e) {
        var container = $(".autocomplete-suggestions");
        if (!container.is(e.target) && container.has(e.target).length === 0) {
            container.hide();
        }
    });
});

$("#payment_description").hover(function () {
    $(this).css('cursor', 'pointer').attr('data-toggle', 'tooltip');
    $(this).css('cursor', 'pointer').attr('title', 'Payment Note');
}, function () {
    $(this).css('cursor', 'auto');
});

$("#sales_description").hover(function () {
    $(this).css('cursor', 'pointer').attr('data-toggle', 'tooltip');
    $(this).css('cursor', 'pointer').attr('title', 'Sale Description');
}, function () {
    $(this).css('cursor', 'auto');
});

$("#discount_description").hover(function () {
    $(this).css('cursor', 'pointer').attr('data-toggle', 'tooltip');
    $(this).css('cursor', 'pointer').attr('title', 'Discount Note');
}, function () {
    $(this).css('cursor', 'auto');
});

$(document).ready(function () {
    $('.qr_btn').click(function () {
        $('#save_btn').attr("disabled", true).css({ cursor: 'not-allowed', color: '#999' });
    });
    $('.save_enable').click(function () {
        $('#save_btn').attr("disabled", false).css({ cursor: 'pointer', color: '#43d187' });
    });
    $('#save_btn').mouseenter(function () {
        $(this).css('color', '#fff');
    });
    $('#save_btn').mouseleave(function () {
        $(this).css('color', '#43d187');
    });
});

$('#Partial_amount').keyup(
    PosnicPro.delayKeyUp(function () {
        const saleNewTot = PosnicPro.sales.extraDiscount.sale_new_tot;
        // Parse input values
        let Partial_amount = parseFloat($('#Partial_amount').val());
        // Check if rounding is enabled, and round or parse the grand total
        let wallet_balance = parseFloat($('#customer_current_balance').val());
        let wallet_amount = parseFloat(PosnicPro.sales.EditRecentSaleParams.wallet_amount);
        let default_partial_amount = parseFloat(PosnicPro.sales.EditRecentSaleParams.partial_amounts);
        // Function to update the balance due
        function updateBalanceDue(amount) {
            var balanceDue = PosnicPro.sales.sub(saleNewTot, amount).toFixed(2);
            $('.balanceDue').text(balanceDue);
        }
        if (Partial_amount > saleNewTot) {
            $('#Partial_amount').val(saleNewTot);
            updateBalanceDue(saleNewTot);
            $('#tendered_balance').text('0');
            return;
        }
        if ($('#wallet_balance').is(":checked")) {
            let adjustedAmount = Math.min(saleNewTot, wallet_balance);
            if (Partial_amount < wallet_balance) {
                $('#Partial_amount').val(adjustedAmount);
                Partial_amount = adjustedAmount;
            }
        }
        if (PosnicPro.sales.SaleAction === 'edit') {
            if (Partial_amount < wallet_amount || Partial_amount > saleNewTot) {
                $('#Partial_amount').val(default_partial_amount);
                Partial_amount = default_partial_amount;
            }
        }
        updateBalanceDue(Partial_amount);
        
        // Update customer partial balance and payment status label based on Pay amount
        const isPaid = $('#unpaid_payment_toggle').is(':checked');
        if (isPaid && !isNaN(Partial_amount)) {
            if (Partial_amount < saleNewTot) {
                $('#sales_new_customer_partial_balance').val('true');
            } else {
                $('#sales_new_customer_partial_balance').val('false');
            }
            // Update payment status label
            if (typeof updatePaymentStatusLabel === 'function') {
                updatePaymentStatusLabel();
            }
        }

        let $multiInputs = $('.payment-amount-input');
        if ($multiInputs.length > 0) {
            let nonZeroCount = 0;
            let $lastNonZero = null;
            $multiInputs.each(function () {
                let v = parseFloat($(this).val()) || 0;
                if (v > 0) {
                    nonZeroCount++;
                    $lastNonZero = $(this);
                }
            });

            const payAmount = isNaN(Partial_amount) ? 0 : Partial_amount;

            if (!isNaN(payAmount)) {
                if (nonZeroCount === 1 && $lastNonZero) {
                    $lastNonZero.data('programmatic-change', true);
                    $lastNonZero.val(payAmount.toFixed(2));
                } else if (nonZeroCount === 0) {
                    let $activeInput = $('.payment-method-card.payment-active').find('.payment-amount-input');
                    if ($activeInput.length) {
                        $activeInput.data('programmatic-change', true);
                        $activeInput.val(payAmount.toFixed(2));
                    }
                }
            }

            PosnicPro.sales.initPaymentValidation();
        }
    }, 300)
);

$(".sms-modal-close").click(function () {
    hasher.changed.active = false;
    hasher.replaceHash('sales/new');
    hasher.changed.active = true;
});
let sendSms = {
    cust_phone: null
};
$("#sms_form").validate({
    rules: {
        customer_sms_phone: {
            minlength: 3,
            maxlength: 20,
            international_phone_number: true
        }
    },
    messages: {
        customer_sms_phone: "Enter a valid mobile number"
    }
});
jQuery.validator.addMethod("international_phone_number", function (phone_number, element) {
    let valid = sendSms.cust_phone.isValidNumber();
    let num = sendSms.cust_phone.getNumber();
    if (valid === true) {
        $('#customer_sms_fullphone').val(num);
        return true;
    } else {
        $('#customer_sms_fullphone').val('');
        return false;
    }

}, "Enter a valid mobile number");

$(document).ready(function () {

    $(window).resize(function () {
        var height = $(window).height() - 270;
        $('#sales_new_productList,#sales_new_categoryList').height(height);
        $('#sales_new_productList,#sales_new_categoryList').css({ 'max-height': height, overflow: 'auto' });
        var imgHeight = $(window).height() - 500;
        $('.sales-cart-image').height(imgHeight);
    });
    $(window).trigger('resize');

    sendSms.cust_phone = window.intlTelInput(document.querySelector("#customer_sms_phone"), {
        separateDialCode: true,
        preferredCountries: ['in'],
        hiddenInput: "full",
        utilsScript: "../static/script/js/utils.js"
    });


    let $inputs = $(".def-txt-input");
    let intRegex = /^\d+$/;

    // Prevents user from manually entering non-digits.
    $inputs.on("input.fromManual", function () {
        if (!intRegex.test($(this).val())) {
            $(this).val("");
        }
    });
});

$("#sms_form").submit(function (event) {
    event.preventDefault();
    if ($('#sms_form').valid()) {            // checks form for validity
        PosnicPro.sales.addSale.sendSms();
    }
});
$('#wallet_balance').click(function () {
    const saleNewTot = PosnicPro.sales.extraDiscount.sale_new_tot;
    let Partial_amount = !isNaN(parseFloat($('#Partial_amount').val())) ? parseFloat($('#Partial_amount').val()) : 0;
    let wallet_balance = parseFloat($('#customer_current_balance').val());
    if ($(this).is(':checked') && Partial_amount < wallet_balance) {
        (wallet_balance > saleNewTot)
            ? $('#Partial_amount').val(saleNewTot) : $('#Partial_amount').val(wallet_balance);
    }
    Partial_amount = parseFloat($('#Partial_amount').val());
    Partial_amount = isNaN(Partial_amount) ? 0 : Partial_amount;
    
    // Check if wallet is used and total payment equals total amount
    let totalPayment = Partial_amount;
    if ($(this).is(':checked')) {
        totalPayment = Partial_amount + wallet_balance;
    }
    
    // If total payment >= total amount, set to full payment (Paid)
    if (totalPayment >= saleNewTot) {
        $('#sales_new_customer_partial_balance').val('false');
    } else {
        $('#sales_new_customer_partial_balance').val('true');
    }
    
    let balanceDue = PosnicPro.sales.sub(saleNewTot, Partial_amount).toFixed(2);
    $('.balanceDue').text(balanceDue);
});

$('#tendered_amount').on('keyup keydown', function () {
    let tenderedAmountInput = $('#tendered_amount').val();
    let tenderedAmount = Number(tenderedAmountInput);
    let tenderTotalText = $('#tendered_payment').text().replace(/,/g, '');
    let tenderTotal = Number(tenderTotalText);

    tenderedAmount = tenderedAmount.toFixed(2);
    tenderTotal = tenderTotal.toFixed(2);
    let balance = PosnicPro.sales.sub(Number(tenderedAmount), Number(tenderTotal));
    let showBalance = isNaN(balance) ? 0.00 : Number(balance).toFixed(2);
    if (Number(tenderedAmount) < Number(tenderTotal)) {
        $('#tendered_balance').val(0.00);
    } else {
        $('#tendered_balance').text(showBalance);
    }
    
    // Auto-calculate denominations when user types amount
    PosnicPro.sales.calculateDenominations(Number(tenderedAmountInput));
});
// Denomination render_mode click handler moved to initDenominationCounter function
$('#extraDisc').on('change', function () {
    PosnicPro.sales.calculation.extraDiscoundCalculation();
});
$('#percentIcon').on('click', function () {
    $('#percentIcon').addClass('d-none');
    $('#rupeeIcon').removeClass('d-none');
    PosnicPro.sales.calculation.extraDiscoundCalculation();
});
$('#rupeeIcon').on('click', function () {
    $('#rupeeIcon').addClass('d-none');
    $('#percentIcon').removeClass('d-none');
    PosnicPro.sales.calculation.extraDiscoundCalculation();
});
// Toggle unpaid mode â€“ lock/unlock payment controls
$(document).on('change', '#unpaid_payment_toggle', function () {
    const isPaid = this.checked;
    const lock = !isPaid;

    // Update payment status label based on customer partial balance setting
    updatePaymentStatusLabel();

    $('.payment-lockable')
        .find('button, a, select, textarea')
        .not('#unpaid_payment_toggle')
        .prop('disabled', lock)
        .toggleClass('disabled', lock);

    // Paid (toggle ON) â†’ show payment block
    // Unpaid (toggle OFF) â†’ hide payment block
    if (lock) {
        $('.payment-lockable')
            .addClass('payment-locked')
            .hide();
    } else {
        $('.payment-lockable')
            .removeClass('payment-locked')
            .show();
    }
});

// Helper function to update payment status label
function updatePaymentStatusLabel() {
    const isPaid = $('#unpaid_payment_toggle').is(':checked');
    const customerPartialBalance = $('#sales_new_customer_partial_balance').val();
    
    let statusText = 'Unpaid';
    let statusClass = 'text-warning';
    
    if (isPaid) {
        if (customerPartialBalance === 'Partial') {
            statusText = 'Partially Paid';
            statusClass = 'text-info';
        } else {
            statusText = 'Paid';
            statusClass = 'text-success';
        }
    }
    
    $('#payment_status_label')
        .text(statusText)
        .removeClass('text-success text-warning text-info')
        .addClass(statusClass);
}

$(".table-selection-close").on("click", function (e) {
    e.preventDefault();
    $("#infobar-settings-sidebar-table-selection").removeClass("sidebarview");
    $(".infobar-settings-sidebar-overlay").css({ "background": "none", "position": "relative" });

    // Navigate back to KOT page
    if (typeof hasher !== 'undefined') {
        hasher.setHash('kot');
    } else {
        window.location.hash = '#/kot';
    }
});

$('#view_touchsales_page').on('click', function (e) {
    PosnicPro.sales.saleProcess = 'add';
});

$('#kot_order_next_btn').on('click', function (e) {
    PosnicPro.kotorder.kotOrderNext();
});

PosnicPro.kotsales = PosnicPro.kotsales || {};
PosnicPro.kotsales.showEdit = function (id) {

    // First prepare the layout for the Sales edit screen by hiding all
    // existing page containers so we don't briefly show other modules
    // (Customers, Reports, etc.) between the KOT "Next" action and the
    // final edit UI.
    if (typeof $ !== 'undefined') {
        $('.page_loader').not('#sales_new').hide();
        $('.page-title-box,#sales_new').show();
    }

    // Then load the Sales edit page in the main content area so that when
    // we close the KOT sidebar the user lands directly on the edit screen
    // instead of briefly seeing the underlying KOT History page.

    // Ensure this is not treated as a payment-only flow; we are doing a
    // full KOT edit, so disable any payment-only flags that would
    // otherwise send the user back to KOT History when closing tender.
    if (PosnicPro && PosnicPro.sales) {
        PosnicPro.sales.paymentOnlyMode = false;
        PosnicPro.sales.kotPaymentMode = false;
    }

    // Hide the KOT History container so that, once the KOT table selection
    // sidebar is closed, the user does not briefly see the KOT History list
    // before the Sales edit UI is fully rendered.
    if (typeof $ !== 'undefined' && $('#kothistory').length) {
        $('#kothistory').hide();
    }

    if (PosnicPro && PosnicPro.sales && typeof PosnicPro.sales.showEdit === 'function') {
        PosnicPro.sales.showEdit(id);
    }

    // For all KOT sales edit screens (kotsales/{id}/edit), ensure the
    // primary action button label is shown as "Update" instead of "Save".
    // This keeps the UI consistent with other edit flows.
    if (typeof $ !== 'undefined') {
        if (PosnicPro && PosnicPro.local && PosnicPro.local.get('language_herf') === 'ta_dashboard.html') {
            $('.changeSalesBtnText').text('à®ªà¯à®¤à¯à®ªà¯à®ªà®¿');
        } else {
            $('.changeSalesBtnText').text('Update');
        }
    }

    // Now close any open sidebars/overlays (such as the KOT table
    // selection) so that the Sales edit UI is revealed.
    if (PosnicPro && typeof PosnicPro.HideSideBarModal === 'function') {
        PosnicPro.HideSideBarModal();
    }
};

// Ensure that when we are on a dedicated KOT edit route
// (either kotsales/{id}/edit or kotorder/{id}/edit), the
// primary sales button label shows "Update" instead of
// the default "Save".
PosnicPro.sales.ensureKotEditButtonLabel = function () {
    if (typeof window === 'undefined' || typeof $ === 'undefined') {
        return;
    }

    var kotHash = (window.location && window.location.hash) ? window.location.hash : '';
    var isKotEditHash = ((kotHash.indexOf('kotorder/') !== -1 || kotHash.indexOf('kotsales/') !== -1) &&
        kotHash.indexOf('/edit') !== -1);

    if (!isKotEditHash) {
        return;
    }

    var isTamil = (PosnicPro && PosnicPro.local && PosnicPro.local.get('language_herf') === 'ta_dashboard.html');
    if (isTamil) {
        $('.changeSalesBtnText').text('à®ªà¯à®¤à¯à®ªà¯à®ªà®¿');
    } else {
        $('.changeSalesBtnText').text('Update');
    }
};

// Run the KOT edit label helper on page load and whenever
// the hash changes so that direct navigation, back/forward
// and KOT History â†’ KOT Order flows all receive the
// correct "Update" label on the primary button.
if (typeof $ !== 'undefined') {
    $(function () {
        if (PosnicPro.sales && typeof PosnicPro.sales.ensureKotEditButtonLabel === 'function') {
            PosnicPro.sales.ensureKotEditButtonLabel();
        }
    });

    $(window).on('hashchange', function () {
        if (PosnicPro.sales && typeof PosnicPro.sales.ensureKotEditButtonLabel === 'function') {
            PosnicPro.sales.ensureKotEditButtonLabel();
        }
    });
}

/**
 * Weight Machine Integration
 * Handles manual and automatic weight reading from Electron hardware
 */
PosnicPro.sales.readWeightFromMachine = async function () {
    // Check if weight machine is enabled in settings
    const settingsStr = PosnicPro.local.get('general_settings');
    const settings = settingsStr ? JSON.parse(settingsStr) : null;

    if (!settings || !settings.hardware_weight_machine_enable) {
        PosnicPro.alert('warning', 'Weight machine is not enabled in settings.');
        return;
    }

    // Check if WeightBridge is available
    if (!window.WeightBridge || !window.WeightBridge.isAvailable()) {
        PosnicPro.alert('warning', 'Weight machine not available. Please use the desktop app.');
        window.WeightBridge && window.WeightBridge.showBrowserWarning();
        return;
    }

    try {
        // Prefer a settled reading from the scale. The live display shows every
        // frame including mid-swing values, so reading it directly can bill the
        // customer for a weight the load never actually rested at.
        let weight = null;
        try {
            weight = await window.WeightBridge.getCurrentWeight();
        } catch (e) {
            console.warn('[weight] live read failed, falling back to display:', e);
        }

        // Fallback: scales that transmit only once per settle may go quiet
        // before we ask, so use whatever the display last showed.
        if (weight === null || weight === undefined || isNaN(weight) || weight <= 0) {
            const weightText = $('#live_weight_value').text().trim();
            weight = parseFloat(weightText);
        }

        if (!weight || weight <= 0 || isNaN(weight)) {
            // Amber rather than red, and it says what the till did. The scale
            // being empty is the ordinary case of the customer not having put
            // the bag down yet, not a failure - and the sale is not blocked.
            PosnicPro.alert('warning',
                'No weight reading yet. Put the item on the platter and press the weight button, ' +
                'or type the quantity in. Nothing is blocked.');
            return;
        }

        // Check if cursor is in an input field (but exclude item search box)
        const activeElement = document.activeElement;
        const isInputField = activeElement && (
            activeElement.tagName === 'INPUT' ||
            activeElement.tagName === 'TEXTAREA'
        );

        // Exclude the item search box from being filled with weight
        const isSearchBox = activeElement && activeElement.id === 'sales_new_item_name';

        if (isInputField && activeElement.type === 'text' && !isSearchBox) {
            // Fill the focused input field
            $(activeElement).val(weight.toFixed(3));
            $(activeElement).trigger('change');
            PosnicPro.alert('success', 'Weight ' + weight.toFixed(3) + ' kg filled');
        } else {
            // Update quantity of last added item in cart
            // Find first row (newest item since items are prepended)
            const firstRow = $('#sales_new_items_tbody tr[id^="touch_row_"]').first();

            if (firstRow.length) {
                // Extract item ID from row ID (touch_row_{id})
                const rowId = firstRow.attr('id');
                const itemId = rowId.replace('touch_row_', '');

                // Find quantity input with name addSalesLineItemQty
                const qtyInput = firstRow.find('input[name="addSalesLineItemQty"]');
                if (qtyInput.length) {
                    qtyInput.val(weight.toFixed(3));

                    // Get track_inventory and negative_stock from hidden fields
                    const trackInventory = $('#trackInventory_' + itemId).text();
                    const negativeStock = $('#negativeStock_' + itemId).text();

                    // Small delay to ensure DOM is updated before triggering calculation
                    setTimeout(function () {
                        // Trigger price recalculation
                        PosnicPro.sales.quantity.textOnChange(itemId, trackInventory, negativeStock);
                    }, 100);

                    PosnicPro.alert('success', 'Weight ' + weight.toFixed(3) + ' kg set for last item');
                } else {
                    PosnicPro.alert('warning', 'No quantity field found for last item');
                }
            } else {
                PosnicPro.alert('warning', 'No items in cart. Please add an item first.');
            }
        }

    } catch (error) {
        console.error('Weight reading error:', error);
        PosnicPro.alert('error', 'Error reading weight: ' + error.message);
    }
};

/*
 * Whether this item is sold by weight.
 *
 * The flag arrives as a string from one path and a boolean from another, so
 * every caller has to accept both rather than pick one and be wrong half the
 * time.
 */
PosnicPro.sales.isWeighedItem = function (itemData) {
    if (!itemData) return false;
    var v = itemData.item_weight_machine_based;
    return v === '1' || v === 1 || v === true || v === 'true';
};

/*
 * Say the scale could not be read, and carry on.
 *
 * The item is already in the cart at quantity one by the time this runs. That
 * is the right thing to keep: a queue does not stop because a cable is loose,
 * and a cashier can type the weight in. What was missing is being told - the
 * failure only ever reached the console, so the till silently billed 1kg of
 * something priced by the kilo and nobody noticed until the count was short.
 */
PosnicPro.sales.warnWeighedItemFallback = function (itemData, reason) {
    var name = (itemData && itemData.item_name) ? itemData.item_name : 'This item';
    console.warn('[weight] ' + reason + ' - ' + name + ' left at quantity 1');
    if (PosnicPro.alert) {
        PosnicPro.alert('warning',
            name + ' is sold by weight. ' + reason +
            ' Quantity is set to 1 — type the weight in, or press the weight button once the scale is ready.');
    }
};

PosnicPro.sales.checkAutoWeightTrigger = function (itemData) {
    if (!PosnicPro.sales.isWeighedItem(itemData)) return;

    var settingsStr = PosnicPro.local.get('general_settings');
    var settings = settingsStr ? JSON.parse(settingsStr) : null;

    // Weighed item, but the shop has the scale turned off. Worth saying once,
    // because it is almost always someone who has just plugged one in and not
    // enabled it yet.
    if (!settings || !settings.hardware_weight_machine_enable) {
        PosnicPro.sales.warnWeighedItemFallback(itemData, 'The weight machine is switched off in Settings.');
        return;
    }

    if (!window.WeightBridge || !window.WeightBridge.isAvailable()) {
        PosnicPro.sales.warnWeighedItemFallback(itemData, 'The weight machine is not connected.');
        return;
    }

    // Short delay only so the cart row exists in the DOM; the weight read
    // itself then waits for the scale to settle rather than grabbing whatever
    // number happens to be showing.
    setTimeout(function () {
        try {
            var result = PosnicPro.sales.readWeightFromMachine();
            // It is async, so a rejection has to be caught here or it becomes
            // an unhandled rejection and the cashier still sees nothing.
            if (result && typeof result.catch === 'function') {
                result.catch(function (e) {
                    PosnicPro.sales.warnWeighedItemFallback(itemData,
                        'The scale did not respond' + (e && e.message ? ' (' + e.message + ').' : '.'));
                });
            }
        } catch (e) {
            PosnicPro.sales.warnWeighedItemFallback(itemData,
                'The scale could not be read' + (e && e.message ? ' (' + e.message + ').' : '.'));
        }
    }, 250);
};

PosnicPro.sales.initWeightMachine = function () {
    // Check if weight machine is enabled in settings
    const settingsStr = PosnicPro.local.get('general_settings');
    const settings = settingsStr ? JSON.parse(settingsStr) : null;

    console.log('=== Weight Machine Initialization Debug ===');
    console.log('1. Settings from localStorage:');
    console.log('   - settingsStr:', settingsStr);
    console.log('   - parsed settings:', settings);
    console.log('   - hardware_weight_machine_enable:', settings ? settings.hardware_weight_machine_enable : 'N/A');

    console.log('2. WeightBridge availability:');
    console.log('   - window.WeightBridge exists:', !!window.WeightBridge);
    console.log('   - window.electronAPI exists:', !!window.electronAPI);
    if (window.WeightBridge) {
        console.log('   - WeightBridge.isAvailable():', window.WeightBridge.isAvailable());
    }
    console.log('===========================================');

    if (settings && settings.hardware_weight_machine_enable) {
        // Show weight button in search area
        $('#sales_read_weight_btn').show();

        // Check if running in Electron
        if (window.WeightBridge && window.WeightBridge.isAvailable()) {
            console.log('Weight machine integration active (Electron)');

            // Show weight machine container with live display
            $('#weight_machine_container').show();

            // Start live weight monitoring
            if (window.WeightBridge.startMonitoring) {
                window.WeightBridge.startMonitoring(function (weight) {
                    if (weight !== null && weight !== undefined && !isNaN(weight)) {
                        $('#live_weight_value').text(weight.toFixed(3));
                        // Change color based on weight
                        if (weight > 0) {
                            $('#live_weight_display').css('background', '#d4edda');
                            $('#live_weight_display').css('color', '#155724');
                        } else {
                            $('#live_weight_display').css('background', '#f0f0f0');
                            $('#live_weight_display').css('color', '#333');
                        }
                    }
                });
                console.log('Live weight monitoring started');
            }
        } else {
            console.log('Weight machine enabled but WeightBridge not available');
            console.log('window.WeightBridge:', window.WeightBridge);
            console.log('window.electronAPI:', window.electronAPI);
        }
    } else {
        // Hide the weight buttons and container
        $('#sales_read_weight_btn').hide();
        $('#weight_machine_container').hide();
    }
};

// Initialize on page load
$(document).ready(function () {
    if ($('#sales_new').length) {
        PosnicPro.sales.initWeightMachine();
    }

    // Intercept Print Receipt clicks on the new sale success panel so that
    // we invoke the existing print logic directly instead of navigating to
    // the #/sales/{id}/print route (which would otherwise send the user to
    // the Sales History page after printing).
    $(document).on('click', '.printSalesReceipt', function (e) {
        var $btn = $(this);
        var saleId = $btn.data('sale-id');

        // If we have a valid sale id and the view.printSale function is
        // available, handle printing in-place and prevent hash navigation.
        if (saleId &&
            window.PosnicPro &&
            PosnicPro.sales &&
            PosnicPro.sales.view &&
            typeof PosnicPro.sales.view.printSale === 'function') {
            e.preventDefault();
            PosnicPro.sales.view.printSale(saleId, 'sale');
        }
        // If anything above is missing, we intentionally fall through and
        // let the browser follow the href (#/sales/{id}/print) so that
        // existing deep links and non-JS environments still behave.
    });
});

console.log('Weight machine integration loaded in sales.js');

// Function to open register from sales page modal
PosnicPro.sales.openRegisterFromSales = function () {
    let registerName = $('#sales_choose_register_model').find(":selected").text();
    let registerId = $('#sales_choose_register_model option:selected').val();
    
    if (!registerId) {
        PosnicPro.alert('warning', 'Select a register.');
        return false;
    }
    
    let registerNameType = {
        register_name: registerName,
        register_Id: registerId,
        opening_float: $('#sales_opening_float').val()
    };
    
    let params = {
        method: 'POST',
        url: 'registers/registerAdd',
        data: JSON.stringify(Object.assign(registerNameType))
    };
    
    PosnicPro.request(params, function (response) {
        if (response.type === 'success') {
            db.currentregister.put({id: '1', register_id: registerId, register_name: registerName, register_status: 'open'});
            PosnicPro.local.set('cash_register_id', response.data);
            PosnicPro.local.set('register_id', registerId);
            PosnicPro.local.set('register_name', registerName);
            PosnicPro.local.set('userRegisterStatus', 'Open');
            
            $('#salesRegisterModal').modal('hide');
            PosnicPro.alert('success', 'Register opened: ' + registerName);
        } else {
            PosnicPro.alert(response.type, response.message);
        }
    });
    return false;
};

/* ---- Quotation editor wiring (Q2): state follows every keystroke ---- */
$(document).on('input change', '#qe_lines input, #qe_lines select', function () {
    var i = $(this).closest('tr').data('i');
    var ed = PosnicPro.quotes._ed;
    if (!ed || !ed.lines[i]) { return; }
    var l = ed.lines[i];
    var $t = $(this);
    if ($t.hasClass('qe-l-name')) { l.item_name = $t.val(); }
    else if ($t.hasClass('qe-l-desc')) { l.description = $t.val(); }
    else if ($t.hasClass('qe-l-qty')) { l.qty = $t.val(); }
    else if ($t.hasClass('qe-l-price')) { l.unit_price = $t.val(); }
    else if ($t.hasClass('qe-l-dtype')) { l.dtype = $t.val(); }
    else if ($t.hasClass('qe-l-dval')) { l.dval = $t.val(); }
    PosnicPro.quotes.edRecalc();
});
$(document).on('change', '#qe_lines .qe-l-taxsel', function () {
    var i = $(this).closest('tr').data('i');
    var ed = PosnicPro.quotes._ed;
    if (!ed || !ed.lines[i]) { return; }
    var $opt = $(this).find('option:selected');
    ed.lines[i].tax_value = Number($opt.val()) || 0;
    ed.lines[i].tax_name = $opt.data('name') || '';
    if (!ed.lines[i].tax_type) { ed.lines[i].tax_type = 'inclusive'; }
    if (!(Number($opt.val()) > 0)) { ed.lines[i].tax_type = ''; }
    PosnicPro.quotes.edRender();
});
$(document).on('click', '#qe_lines .qe-l-taxflip', function () {
    var i = $(this).closest('tr').data('i');
    var ed = PosnicPro.quotes._ed;
    if (!ed || !ed.lines[i]) { return; }
    ed.lines[i].tax_type = ed.lines[i].tax_type === 'exclusive' ? 'inclusive' : 'exclusive';
    PosnicPro.quotes.edRender();
});
$(document).on('click', '#qe_lines .qe-l-del', function () {
    var i = $(this).closest('tr').data('i');
    if (PosnicPro.quotes._ed) { PosnicPro.quotes._ed.lines.splice(i, 1); PosnicPro.quotes.edRender(); }
});
$(document).on('input change', '#qe_charges input, #qe_charges select', function () {
    var i = $(this).closest('.qe-charge').data('i');
    var ed = PosnicPro.quotes._ed;
    if (!ed || !ed.charges[i]) { return; }
    var c = ed.charges[i];
    var $t = $(this);
    if ($t.hasClass('qe-c-name')) { c.name = $t.val(); }
    else if ($t.hasClass('qe-c-type')) { c.type = $t.val(); }
    else if ($t.hasClass('qe-c-val')) { c.value = $t.val(); }
    else if ($t.hasClass('qe-c-sign')) { c.sign = Number($t.val()); }
    PosnicPro.quotes.edRecalc();
});
$(document).on('click', '#qe_charges .qe-c-del', function () {
    var i = $(this).closest('.qe-charge').data('i');
    if (PosnicPro.quotes._ed) { PosnicPro.quotes._ed.charges.splice(i, 1); PosnicPro.quotes.edRender(); }
});

$(document).on('click', '.qe-valid-chip', function () {
    var days = Number($(this).data('days')) || 7;
    var d = new Date(Date.now() + days * 86400000);
    $('#qe_valid_until').val(d.toISOString().slice(0, 10));
    $('.qe-valid-chip').removeClass('btn-primary').addClass('btn-secondary-rgba');
    $(this).removeClass('btn-secondary-rgba').addClass('btn-primary');
    PosnicPro.quotes.edRecalc();
});
$(document).on('input', '#qe_valid_until', function () {
    $('.qe-valid-chip').removeClass('btn-primary').addClass('btn-secondary-rgba');
});
$(document).on('input change', '#qe_disc_type, #qe_disc_value, #qe_cust_name, #qe_cust_phone, #qe_cust_email, #qe_cust_gstin, #qe_cust_address, #qe_payment, #qe_bank, #qe_terms, #qe_notes, #qe_valid_until', function () {
    PosnicPro.quotes.edRecalc();
});
$(function () {
    if (!$.fn.autocomplete) { return; }
    $('#qe_item_search').autocomplete({
        deferRequestBy: 120,
        lookup: function (query, done) {
            PosnicPro.get({ url: 'items/getOnlineItemsAjaxList', data: 'query=' + query + '&type=normal' }, function (response) {
                var suggestions = [];
                ((response && response.suggestions) || []).forEach(function (d) {
                    suggestions.push({ value: d.item_name || d.value || '', data: d });
                });
                done({ suggestions: suggestions });
            });
        },
        onSelect: function (s2) {
            $('#qe_item_search').val('');
            var d = s2.data || {};
            var id = d.item_id || d.id;
            if (id) { PosnicPro.quotes.edAddItem(String(id), d.item_name || d.name || s2.value || ''); }
        },
        autoSelectFirst: true,
        triggerSelectOnValidInput: false
    });
    $('#qe_cust_search').autocomplete({
        deferRequestBy: 120,
        lookup: function (query, done) {
            PosnicPro.get({ url: 'customers/getCustomersAjaxList', data: 'query=' + query }, function (response) {
                var suggestions = [];
                ((response && response.suggestions) || []).forEach(function (d) {
                    suggestions.push({ value: d.name || '', data: d });
                });
                done({ suggestions: suggestions });
            });
        },
        onSelect: function (s2) {
            var d = s2.data || {};
            $('#qe_cust_search').val('');
            if (PosnicPro.quotes._ed) { PosnicPro.quotes._ed.customer_id = String(d.id || ''); }
            $('#qe_cust_name').val(d.name || '');
            $('#qe_cust_phone').val(d.phone || '');
            $('#qe_cust_email').val(d.email || '');
            $('#qe_cust_gstin').val(d.gst_number || '');
            $('#qe_cust_address').val(d.address || '');
            PosnicPro.quotes.edRecalc();
        },
        autoSelectFirst: true,
        triggerSelectOnValidInput: false
    });
});

/* Quote-page signature upload: saves to the shop settings (presence-
   gated partial post) and repaints the live paper immediately. */
$(document).on('change', '#qe_sig_file', function () {
    var f = this.files && this.files[0];
    var input = this;
    if (!f) { return; }
    if (f.size > 300 * 1024) {
        PosnicPro.alert('warning', 'Keep the signature under 300 KB - a small PNG works best.');
        $(input).val('');
        return;
    }
    var reader = new FileReader();
    reader.onload = function (e) {
        var dataUrl = e.target.result;
        /* The documents endpoint, not the god endpoint. This exact call is
           what returned "Default customer is required" (69bc0cd): the old
           validator demanded fields that belong to another group on every
           save, including a one-key one like this. An endpoint that knows
           only `documents` cannot ask for them. */
        PosnicPro.put({
            url: 'settings/group/documents',
            data: JSON.stringify({ quote_default_signature: dataUrl })
        }, function (r) {
            $(input).val('');
            if (r.type !== 'success') { PosnicPro.alert(r.type, r.message); return; }
            PosnicPro.local.set('quotesignature', dataUrl);
            $('#quote_default_signature').val(dataUrl);
            $('#quote_signature_thumb').attr('src', dataUrl).show();
            $('#quote_signature_clear').show();
            PosnicPro.quotes._edSigSync();
            PosnicPro.quotes.edRecalc();
            PosnicPro.alert('success', 'Signature saved - it now signs this and every future quote.');
        }, function () {
            $(input).val('');
            PosnicPro.alert('error', 'Could not save the signature');
        });
    };
    reader.readAsDataURL(f);
});

/*
 * Paper choice at print time (owner: "Print recept i would like to have
 * thermal as well a4 option based user preference"). The main button follows
 * the shop's Print Type setting; these two override it for one print without
 * changing the setting, because the choice is usually per customer - a walk-in
 * wants the roll, a business customer wants the A4 invoice for their books.
 */
$(document).on('click', '#print_receipt_a4, #print_receipt_thermal', function () {
    var id = $('.printSalesReceipt').data('sale-id');
    if (!id) { return; }
    var layout = (this.id === 'print_receipt_a4') ? 'a4' : 'standard';
    var view = PosnicPro.sales.view;
    if (!view || !view.printSale) { return; }
    // the chosen paper decides which template must be present, so set it
    // before asking for the templates, then print once they are there
    view._layoutOverride = layout;
    view._ensurePrintTemplates(function () {
        view.printSale(id, 'sale', false, layout);
    });
});
