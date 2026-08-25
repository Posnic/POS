PosnicPro.customers = {
    customerAction: 'add',
    customer_phone: null,
    showAdd: function () {
        PosnicPro.customers.loadSelectCustomerState(PosnicPro.local.get('countryid'), 'add');
        $(".infobar-settings-sidebar-overlay").css({"background": "transparent", "position": "initial"});
        $(".infobar-settings-sidebar").removeClass("sidebarshow");
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $(".vertical-menu li a").removeClass("active");
        $(".vertical-layout").removeClass("toggle-menu");
        $('#v-pills-customer-tab,.customer_new_shortcut').addClass('active');
        $('#v-pills-customer').addClass('show active');
        $('.vertical-menu li a#view_customers_page').addClass('active');
        PosnicPro.showAddModal('customer');
        $('#customer_reset').show();
        $('.customer_edit_reset').hide();
        $('#customer_country').val(PosnicPro.local.get("country_setting")).trigger('change.select2');
        PosnicPro.local.set('edit_customer_state', PosnicPro.local.get("state_setting"));        
        PosnicPro.customers.addCustomerButton();
        $('.add_new_tooltip').tooltip("hide");
        if (PosnicPro.customers.customerAction === 'edit') {
            PosnicPro.customers.customerClearForm();
        }
        PosnicPro.customers.customerAction = 'add';
    },
    showEdit: function (id) {
        var loader = $(".loader-customer");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.showEditModal('customers');
        PosnicPro.customers.editCustomer(id);
        $('#v-pills-customer').addClass('show active');
        $('#customer_reset').hide();
        $('.customer_edit_reset').show();
        $('.customer_edit_reset').attr("id", id);
        PosnicPro.customers.customerAction = 'edit';
    },
    showDelete: function (id) {
        PosnicPro.deleteTableRowData(id, 'customers');
    },
    showDetails: function (id) {
        var loader = $(".loader-view-customer");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.showViewModal('customers');
        PosnicPro.customers.viewCustomer(id);
    },
    customersTable: function () {
        var loader = $(".loader-table-customer");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        PosnicPro.appendViewDataTableBody('customers');
        var table = $('#view_customers');
        var params = {
            url: 'customers',
            data: {
                page: table.data('current_page'),
                limit: parseInt($('#view_customers_per_page  option:selected').text()),
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
                $('#view_customers_total').text(response.data.total);
                var rowTotal = response.data.total;
                if (rowTotal === 0) {
                    /* Which kind of empty - see customers.html and
                       PosnicPro.hasActiveFilters. */
                    var filtered = PosnicPro.hasActiveFilters('customers');
                    $('.customer_header').hide();
                    $('#customer_img_hide').toggle(!filtered);
                    $('#customer_no_match').toggle(filtered);
                } else {
                    $('#customer_img_hide,#customer_no_match').hide();
                    $('.customer_header').show();
                }

                var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                $('#view_customers_page_total').text(row_total);
                var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                $('#view_customers_page_perpage_total').text(page_totals + response.data.list.length);
                for (var i = 0; i < response.data.list.length; i++) {
                    var row = response.data.list[i];
                    var transactionTab = '';
                    if (row.partial_balance) {
                        transactionTab = '<a data-module="customer" data-access="read" href="#/customers/' + row._id + '/transaction" data-id="customers/' + row._id + '/transaction" data-toggle="tooltip" title="Customer transaction" class="point-cursor mobile_tooltip"><i class="feather icon-credit-card"></i></a>';
                    }
                    var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                    var action = '<div id="onclick-toolbar-options_' + i + '" class="hidden">' +
                            transactionTab +
                            '<a data-module = "customer" data-access = "read" href="#/customers/' + row._id + '" data-id="customers/' + row._id + '" data-toggle="tooltip" title="View Customer" class="point-cursor mobile_tooltip"><i class="feather icon-eye"></i></a>' +
                            '<a data-module = "customer" data-access = "write" href="#/customers/' + row._id + '/edit" data-id="customers/' + row._id + '/edit" data-toggle="tooltip" title="Edit Customer" class="point-cursor mobile_tooltip"><i class="feather icon-edit"></i></a>' +
                            '<a data-module = "customer" data-access = "delete" href="#/customers/' + row._id + '/delete" data-id="customers/' + row._id + '/delete" data-toggle="tooltip" title="Delete Customer" class="point-cursor mobile_tooltip"><i class="feather icon-trash"></i></a>' +
                            '</div>' +
                            '<div data-toolbar="user-options" class="btn btn-round btn-primary-rgba round-pad" id="onclick-toolbar_' + i + '"><i class="feather icon-more-vertical-"></i></div>';

                    var trow = '<tr><th><input type="checkbox" class="customers-row-id" id="' + row._id + '" name="id[]" value="' + row._id + '" onclick="PosnicPro.checkboxSelectOne(this,\'customers\');"></th><th scope="row" data-label="#">' + row_no + '</th><td width="30%" data-label="Name"><a href="#/customers/' + row._id + '"><i class="table_model_item">' + row.name + '</i></a></td> <td class="text-right" data-label="Phone"><a class="sale_color" href="tel:' + (row.phone || '') + '">' + (row.phone || '') + '</a></td> <td width="15%" data-label="Email"><a class="sale_color" href="mailto:' + (row.email || '') + '">' + (row.email || '') + '</a></td> <td width="40%" data-label="Address">' + (row.address || '') + '</td>' +
                            '<td class="text-center"><span>' + action + '</span></td>' +
                            '</tr>';
                    $('#view_customers').children('tbody').append(trow);
                }
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
                PosnicPro.setSelectedCheckbox(PosnicPro["customers_checkbox"], 'customers');
                PosnicPro.ACLForModule('customer');
                loader.find(".loadingSpinner:first").remove();
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    showDataTablePage: function () {
        var loader = $(".loader-table-customer");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.dashboard.datePicker();
        PosnicPro.HideSideBarModal();
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $(".vertical-menu li a").removeClass("active");
        $(".vertical-layout").removeClass("toggle-menu");
        $('.page_loader,#osk-container').hide();
        $('.page-title-box,#customers').show();
        $('#customers_new,#customers_view').modal('hide');
        PosnicPro.customers.customersTable('customers');
        $('#v-pills-customer-tab').addClass('active');
        $('#v-pills-customer').addClass('show active');
        $('.dashboard_img_menu').hide();
        $('#image_sidebar_customsdetails').show();
    },
    triggerModules: function () {
        PosnicPro.showAddModal('customer');
        PosnicPro.customers.addCustomerButton();
        let hash = window.location.hash.slice(1);
        if (hash === '/sales/customers/new') {
            $('#customer_name').val('');
        } else {
            let regex = /^[a-z\s]+$/i;
            let salesValue = $('#sales_new_customer_name').val();
            if (regex.test(salesValue)) {
                $('#customer_name').val($('#sales_new_customer_name').val());
                $('#customer_phone').val('');
            } else {
                $('#customer_name').val('Mob' + $('#sales_new_customer_name').val());
                $('#customer_phone').val($('#sales_new_customer_name').val());
            }
        }
        $('#customer_reset').show();
        $('.customer_edit_reset').hide();
    },
    //This Customer Function Used To Add & Edit
    customer: function () {
        if ($('#customer_name').val() !== '' && PosnicPro.validateEmail($('#customer_email').val())) {
            var loader = $(".loader-customer");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            var method = 'POST';
            var url = 'customers';
            PosnicPro.action = 'add';
            if ($('#customer_id').val() !== '') {
                PosnicPro.action = 'edit';
                method = 'PUT';
                url += '/' + $('#customer_id').val();
            }
            var formData = PosnicPro.getFormData($('#customer_add_form'));
            var categoryDetail = $("#customer_category").select2("data");
            var categoryData = {
                category_id: categoryDetail.length > 0 ? categoryDetail[0].element.attributes['data-category-id'].value : '',
                category_name: categoryDetail.length > 0 ? categoryDetail[0].element.attributes['data-category-name'].value : ''
            };
            var params = {
                method: method,
                url: url,
                data: JSON.stringify(Object.assign(formData, categoryData))
            };

            PosnicPro.request(params, function (response) {
                if (response.type === 'success') {

                    loader.find(".loadingSpinner:first").remove();
                    let data = response.data || {};

                    if (!data.customer_id) {
                        if (data.id) {
                            data.customer_id = data.id;
                        } else if (data._id) {
                            data.customer_id = (typeof data._id === 'object' && data._id.toString) ? data._id.toString() : data._id;
                        }
                    }
                    var hash = window.location.hash.slice(1);
                    if (hash === '/sales/customers/new') {
                        hasher.changed.active = false; //disable changed signal
                        hasher.replaceHash('sales/new');
                        $('#sales_new_customer_partial_balance').val(data.partial_balance);
                        $('#customer_current_balance').val('0');
                        $('#sales_new_customer_id').val(data.customer_id);
                        $('#sales_new_customer_name').val(data.name);
                        $('#sales_new_customer_address').val(data.address);
                        $('#sales_new_customer_phone').val(data.phone);
                        $('#sales_new_customer_email').val(data.email);
                        $('#sales_new_customer_state').val(data.state);
                        $('#sales_new_customer_country').val(data.country);
                        $('#sales_new_customer_gst_type').val(data.gst_type);
                        $('#sales_new_customer_gst_number').val(data.gst_number);
                        $(".infobar-settings-sidebar-overlay").css({"background": "transparent", "position": "initial"});
                        $("#infobar-settings-sidebar-customer").removeClass("sidebarshow");
                        hasher.changed.active = true; //enable changed signal
                    }
                    if (PosnicPro.action === 'add') {
                        PosnicPro.customers.customersTable('customers');
                        $('#show_last_created_customer').show();
                        let customerId = data.customer_id || data._id || data.id;
                        let path = '#/customers/' + customerId;
                        $('#last_created_customer').attr('href', path);
                    }
                    if (PosnicPro.action === 'edit') {
                        $(".infobar-settings-sidebar-overlay").css({"background": "transparent", "position": "initial"});
                        $("#infobar-settings-sidebar-customer").removeClass("sidebarshow");
                        let customerRecord = [];
                        customerRecord.push({name: data.name, phone: data.phone, email: data.email, address: data.address});
                        db.customerDisplay.put({id: '1', 'clear': 'no', 'get': 'no', customer: customerRecord});
                        hasher.setHash('customers');
                    }
                    $('.customer-trigger').val('');
                    loader.find(".loadingSpinner:first").remove();
                    /*This function call for updating customername.json,getcustomers.json file */
                    PosnicPro.alert(response.type, response.message);
                } else {
                    PosnicPro.alert(response.type, response.message);
                }
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
            return false;
        }
    },
    /*To display the customer details form in customer view page*/
    viewCustomer: function (id) {
        var loader = $(".loader-view-customer");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        PosnicPro.get('customers/' + id, function (response) {
            if (response.type === 'success') {
                PosnicPro.record_id = id;
                PosnicPro.customers.viewCustomerData(response);
                loader.find(".loadingSpinner:first").remove();
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    viewCustomerData: function (response) {
        $('#v-pills-customer').addClass('show active');
        $(".infobar-settings-sidebar-overlay").css({"background": "rgba(0,0,0,0.4)", "position": "fixed"});
        $("#infobar-settings-sidebar-customer-details").addClass("sidebarview");

        let url = currentHash.split('/');
        if (url[0] === 'customerreport') {
            $("#customer-transaction-tab").addClass("active");
            $("#customer_transaction").addClass("active show");
            $('#customer-sale-tab,#customer-detail-tab,#customer-closed-tab').removeClass('active');
            $("#customer_detail,#customer_sale,#sale_closed").removeClass("active show");
            PosnicPro.transactiondetails.transactiondetailsTable();
        } else {
            $("#customer-detail-tab").addClass("active");
            $("#customer_detail").addClass("active show");
            $("#customer-sale-tab,#customer-transaction-tab,#customer-closed-tab").removeClass("active");
            $("#customer_transaction,#customer_sale,#sale_closed").removeClass("active show");
        }

        if (response.data.partial_balance === true) {
            $("#customer-transaction-tab,#customer-closed-tab").show();
        } else {
            $("#customer-transaction-tab,#customer-closed-tab").hide();
        }

        var data = response.data;
        let customer_view_partialBalance = data.partial_balance === true ? '<span class="text-success">true</span>' : '<span class="text-danger">false</span>';
        let customer_viewBalance = (data.balance !== null && data.balance !== undefined) ? PosnicPro.local.get('currencySign') + parseFloat(data.balance).toFixed(2) : 0;
        $("#customer_view_partialBalance").html(customer_view_partialBalance);
        $("#customer_viewBalance").html(customer_viewBalance);
        $('#customer_view_phone_icon').attr('href', 'tel:' + data.phone);
        $('#customer_view_email_icon').attr('href', 'mailto:' + data.email);
        $.each(data, function (key, val) {
            if (val === '') {
                $('#customer_view_' + key).text('');
                $('#customer_view_' + key + '_icon').hide();
            } else {
                $('#customer_view_' + key + '_icon').show();
                $('#customer_view_' + key).text(val);
            }
        });
        var updateCreateDate = PosnicPro.convertDate(data.created_date);
        $('#customer_view_created_date').text(updateCreateDate);
        var updateUpdateDate = PosnicPro.convertDate(data.updated_date);
        $('#customer_view_updated_date').text(updateUpdateDate);
        $('.indian-gstr').hide();
        if (PosnicPro.local.get('gst_action') === 'enable' && data.gst === 'enable') {
            $('.indian-gstr').show();
        }
        PosnicPro.customers.renderLoyalty(data._id || PosnicPro.record_id);
    },
    /* Show the customer's points balance and tier, if loyalty is on for the branch. */
    renderLoyalty: function (customerId) {
        var row = $('#customer_view_loyalty_row');
        row.hide();
        $('#loyalty_customer_badge').empty();
        $('#loyalty_customer_next').empty();
        if (!customerId || !PosnicPro.loyalty) return;
        PosnicPro.loyalty.summary(customerId, function (s) {
            if (!s || !s.enabled) return; // loyalty off => leave the row hidden
            $('#loyalty_customer_badge').html(PosnicPro.loyalty.badgeHtml(s));
            if (s.nextTier && s.nextTier.needs > 0) {
                $('#loyalty_customer_next').text(s.nextTier.needs + ' points to ' + s.nextTier.name);
            } else {
                $('#loyalty_customer_next').text('Lifetime points: ' + (s.lifetime || 0));
            }
            row.show();
        });
    },
    /*Edit added customer in view customer page*/
    editCustomer: function (id) {
        var loader = $(".loader-customer");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        if (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') {
            $('#customer_title').text('திருத்தப்பட்ட');
            $('#customer_button_title').text('புதுப்பி');
        } else {
            $('#customer_title').text('Edit');
            $('#customer_button_title').text('Update');
        }
        $(".infobar-settings-sidebar-overlay").css({"background": "rgba(0,0,0,0.4)", "position": "fixed"});
        $("#infobar-settings-sidebar-customer").addClass("sidebarshow");
        var params = {
            url: 'customers/getCustomerDetails',
            data: {
                id: id
            }
        };
        PosnicPro.get(params, function (response) {

            if (response.type === 'success') {
                data = response.data;
                PosnicPro.record_id = id;
                $('#customer_id').val(PosnicPro.record_id);
                $('#customer_name').val(data.name);
                $('#customer_phone').val(data.phone);
                $('#customer_email').val(data.email);
                $('#customer_address').val(data.address);
                $('#customer_city').val(data.city);
                $('#customer_country').val(data.country).trigger('change.select2');
                $('#customer_category').val(data.category_id).trigger("change");
                $('#customer_referrer_name').val(data.referrer_name);
                $('#customer_referrer_id').val(data.referrer_id);
                $('#partial_balance').prop("checked", data.partial_balance);
                PosnicPro.local.set('edit_customer_state', data.state);
                var countryDetail = $('#customer_country').select2("data");
                PosnicPro.customers.loadSelectCustomerState(countryDetail[0].element.attributes['data-setting-id'].value, 'edit');

                $('.indian-gstr').hide();
                if (PosnicPro.local.get('gst_action') === 'enable' && data.gst === 'enable') {
                    $('.indian-gstr').show();
                    $("#customer_gst_type option[value='" + data.gst_type + "']").prop("selected", true);
                    $('#customer_gstin_number').val(data.gst_number);
                    $('.customer-gstr-number').hide();
                    if (data.gst_type !== 'consumer') {
                        $('.customer-gstr-number').show();
                    }
                }
                loader.find(".loadingSpinner:first").remove();
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    showTransaction: function (id) {
        $("#customerTransaction_id").val(id);
        $("#infobar-transection-sidebar-transaction").addClass("sidebarshow");
        $("#transactionSubmitForm").removeAttr("disabled");
    },
    transaction: function () {
        var params = {
            method: 'POST',
            url: 'customers/transaction',
            data: JSON.stringify(PosnicPro.getFormData($('#transaction_add_list_form')))
        };
        PosnicPro.request(params, function (response) {
            if (response.type === 'success') {
                $('#customer_current_balance').val(response.data);
                $("#transactionSubmitForm").removeAttr("disabled");
                $("#transaction_add_list_form").trigger('reset');
                PosnicPro.commonDate();
                $('#transaction_image_upload').attr('src', 'static/images/default/category.svg');
                $('#transaction_value_check').val('');
                PosnicPro.alert(response.type, response.message);
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
        return false;
    },

    transactionImageFormSubmit: function () {
        var data = new FormData(document.getElementById("transaction_add_list_form"));
        PosnicPro.requestImage('POST', "customers/uploadTransactionImage", data, false, function (response) {
            if (response.type === 'success') {
                $("#transaction_image_upload").html(response.data);
                $('#transaction_image').val(response.data);
                PosnicPro.customers.transaction();
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        });
        return false;
    },

    transactionValidForm: function () {
        // validate signup form on keyup and submit
        $("#transaction_add_list_form").validate({
            errorClass: 'error error_transaction',
            highlight: function (element, errorClass) {
                $(element).css("border-color", "#f9616d");
            },
            unhighlight: function (element, errorClass) {
                $(element).css("border-color", "#eae8e8");
            },
            rules: {
                date: {
                    required: true,
                    date: true,
                    transactionDate: true
                },
                amount: {
                    required: true,
                    min: 1,
                    minlength: 1,
                    maxlength: 10
                },
                type: {
                    required: true
                }
            },
            messages: {
                date: {
                    required: "Choose a date",
                    commonDate: "Enter a valid date"
                },
                amount: {
                    required: "Enter the amount",
                    minlength: "Transaction amount must be at least 1 characters",
                    maxlength: "Transaction amount should not be more than 10 characters"
                },
                type: {
                    required: "Choose transaction type"
                }
            }
        });
        jQuery.validator.addMethod("transactionDate", function (value, element) {
            return this.optional(element) || moment(value, 'YYYY/MM/DD LT').isValid();
        }, "Use the date format");
        $("#transaction_add_list_form").submit(function (event) {
            event.preventDefault();
            if ($('#transaction_add_list_form').valid()) {            // checks form for validity
                $("#transactionSubmitForm").attr("disabled", "disabled");
                if ($('#transaction_value_check').val() !== '') {
                    PosnicPro.customers.transactionImageFormSubmit();
                } else {
                    $('#transaction_image').val('category.svg');
                    PosnicPro.customers.transaction();
                }

            }

        });
    },
    transanctionClearForm: function () {
        $('#transaction_add_list_form')[0].reset();
        $('#transaction_notes').html('');
        $('#transaction_image_upload').html('');
        $('#transaction_image_upload').attr('src', 'static/images/default/category.svg');
        $('.error_transaction').css('display', 'none');
        PosnicPro.commonDate();
    },
    resetEditButton: function (id) {
        PosnicPro.customers.editCustomer(id);
    },
    addCustomerButton: function () {
        var loader = $(".loader-customer");
        loader.find(".loadingSpinner:first").remove();
        if (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') {
            $('#customer_title').text('புதிய');
            $('#customer_button_title').text('சேமி');
        } else {
            $('#customer_title').text('Add');
            $('#customer_button_title').text('Save');

        }
        $('#customer_id').val('');
        $('#customers_new .alert').remove();

        (PosnicPro.local.get('gst_action') === 'enable') ? $('.indian-gstr').show() : $('.indian-gstr').hide();
        $('.customer-gstr-number').hide();
        $('#show_last_created_customer').hide();
    },
    exportCustomers: function () {
        PosnicPro.exportTableData(PosnicPro.customers_checkbox, 'customers');
    },
    deleteSelectedCustomers: function () {
        PosnicPro.deleteTableData(PosnicPro.customers_checkbox, 'customers');
    },
    gstFields: function () {
        $('.customer-gstr-number').hide();
        if ($('#customer_gst_type').val() !== 'consumer') {
            $('.customer-gstr-number').show();
        }
    },
    customerClearForm: function () {
        PosnicPro.customers.loadSelectCustomerState(PosnicPro.local.get('countryid'), 'clear');
        $('#customer_add_form')[0].reset();
        $('#customer_country').val(PosnicPro.local.get("country_setting")).trigger('change.select2');
        PosnicPro.local.set('edit_customer_state', PosnicPro.local.get("state_setting"));        
        $('.error_customer').css('display', 'none')
    },
    loadSelectCustomerState: function (id, action) {
        var stateSelect = $('#customer_state');
        var params = {
            url: 'setting/getJSONState',
            data: {id: id}
        };
        PosnicPro.get(params, function (response) {
            stateSelect.empty();
            suggestions: $.map(response.data['stateJsonArray'], function (dataItem) {
                var options;
                options += '<option value="' + dataItem + '">' + dataItem + ' </option>';
                stateSelect.append(options).trigger('change');
            });

            if (PosnicPro.local.get('edit_customer_state') !== '' && action === 'edit') {
                stateSelect.val(PosnicPro.local.get('edit_customer_state')).trigger('change.select2');
                window.intlTelInputGlobals.getInstance(document.querySelector("#customer_phone")).setCountry(response.data['countrySortName']);
            } else {
                $('#customer_state option:eq(0)').prop('selected', true);
                window.intlTelInputGlobals.getInstance(document.querySelector("#customer_phone")).setCountry(response.data['countrySortName']);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    validForm: function () {

        $("#customer_add_form").validate({
            errorClass: 'error error_customer',
            highlight: function (element, errorClass) {
                $(element).css("border-color", "#f9616d");
            },
            unhighlight: function (element, errorClass) {
                $(element).css("border-color", "#eae8e8");
            },
            rules: {
                name: {
                    required: true,
                    minlength: 3,
                    maxlength: 250,
                    cname: true
                },
                address: {
                    minlength: 3,
                    maxlength: 500
                },
                email: {
                    email: true,
                    emailExt: true,
                    maxlength: 250
                },
                phone: {
                    minlength: 3,
                    maxlength: 20,
                    customer_phone_number: true
                },
                city: {
                    city: true,
                    maxlength: 20
                },
                gstin_number: {
                    required: true,
                    gst: true,
                    minlength: 15,
                    maxlength: 15
                }
            },
            messages: {
                name: {
                    required: "Enter the customer name",
                    minlength: "Customer name must be at least 3 characters",
                    maxlength: "Customer name should not be more than 250 characters"
                },
                address: {
                    minlength: "Customer address must be at least 3 characters",
                    maxlength: "Address is too Long !"
                },
                email: {
                    maxlength: "Email should not be more than 250 Characters"
                },
                phone: {
                    customer_phone_number: "Enter a valid phone number",
                    minlength: "Use at least 3 characters",
                    maxlength: "Use no more than 20 characters"
                },
                city: {
                    maxlength: "Customer city should not be more than 20 digits"
                },
                gstin_number: {
                    required: "Enter a valid GSTIN",
                    minlength: "Gstr must be Atleast 15 Characters long",
                    maxlength: "Gstr should not be more than 15 digits"
                }
            }
        });
        jQuery.validator.addMethod("customer_phone_number", function (phone_number, element) {
            // If the field is empty, allow it to be valid
            if (!phone_number) {
                return true;  // Allow blank phone number
            }
            let valid = PosnicPro.customers.customer_phone.isValidNumber();
            let num = PosnicPro.customers.customer_phone.getNumber();
            if (valid === true) {
                $('#customer_phone').val(num);
                return true;
            } else {
                return false;
            }

        }, "Enter a valid phone number");
        jQuery.validator.addMethod("gst", function (value, element) {
            return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(value);
        }, "Enter a valid GSTIN");

        $("#customer_add_form").submit(function (event) {
            event.preventDefault();
            if ($('#customer_add_form').valid()) {            // checks form for validity
                PosnicPro.customers.customer();
            }
        });
    }
};
PosnicPro.customerdetails = {

    customerdetailsTable: function (type) {
        PosnicPro.appendReportTableBody('customerdetails');
        var loader = $(".loader-customeractivity");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        var table = $('#view_customerdetails');
        if ($('a#view_customers_page').hasClass('active')) {
            var branch = [];
            branch.push(PosnicPro.local.get("branch_id_set"));
        } else {
            var branch = $("#customer_branch_value").val()
        }
        if (type === 'customerreportexport') {
            var per_page = table.data('total');
        } else {
            var current_page = table.data('current_page');
            var per_page = $('#view_customerdetails_per_page').val();
        }
        let customer_id = currentHash.split('/');
        var data = {
            page: current_page,
            limit: per_page,
            customer_id: customer_id[1],
            branch: branch
        };
        var params = {
            url: 'sales/customerSaleDetails',
            data: data
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                if (type !== 'customerreportexport') {
                    table.data('total', response.data.table.data.total);
                    table.data('total_pages', response.data.table.data.total_pages);
                    table.data('current_page', response.data.table.data.current_page);
                    table.data('per_page', response.data.table.data.per_page);
                    PosnicPro.paging(response.data.table.data.total_pages, response.data.table.data.current_page);
                    table.children('tbody').text('');
                    $('#view_customerdetails_total,.customer_details_noofsale').text(response.data.table.data.total);
                    var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                    $('#view_customerdetails_page_total').text(row_total);
                    var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                    $('#view_customerdetails_page_perpage_total').text(page_totals + response.data.table.data.list.length);
                    var currency = PosnicPro.local.get('currencySign');
                    var rowTotal = response.data.table.data.total;
                    if (rowTotal === 0) {
                        $('.customeractivity_content').hide();
                        $('#customeractivity_img_hide').show();

                    } else {
                        $('#customeractivity_img_hide').hide();
                        $('.customeractivity_content').show();
                    }
                    var process_class = "badge badge-success-inverse";
                    var saleTotalValue = 0;
                    var returnTotalValue = 0;
                    var salesTotalQty = 0;
                    var returnTotalQty = 0;
                    for (var i = 0; i < response.data.table.data.list.length; i++) {
                        let row = response.data.table.data.list[i];
                        saleTotalValue += Number(row.items_total) || 0;
                        returnTotalValue += Number(row.items_return_total) || 0;
                        if (row.sale_process == 'Add' || row.sale_process == 'Edit') {
                            process_class = "badge badge-success-inverse";
                        } else if (row.sale_process == 'Edit') {
                            process_class = "badge badge-primary-inverse";
                        } else if (row.sale_process == 'PartialReturn') {
                            process_class = "badge badge-secondary-inverse";
                        } else {
                            process_class = "badge badge-danger-inverse";
                        }
                        let salesQty = 0;
                        $(row.items).each(function (key, val) {
                            salesQty += val.item_quantity;
                            salesTotalQty += val.item_quantity;
                        });
                        let returnQty = 0;
                        $(row.items_return).each(function (key, val) {
                            $(val.returnArray.returnValue).each(function (key, val) {
                                returnQty += val.item_quantity;
                                returnTotalQty += val.item_quantity;
                            });
                        });
                        let row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                        let updateDate = PosnicPro.convertDate(row.string_date);
                        let trow = '<tr> <td scope="row">' + row_no + '</td> <td>' + row.sales_id + '</td> <td class="export-date">' + updateDate + '</td> <td class="text-center"><span class="' + process_class + '">' + row.sale_process + '</span></td> <td class="text-center text-danger">' + returnQty + '</td> <td class="text-right text-danger">' + currency + '&nbsp;' + (Number(row.items_return_total) || 0).toFixed(2) + '</td><td class="text-center text-success">' + salesQty + '</td><td class="text-right text-success">' + currency + '&nbsp;' + (Number(row.items_total) || 0).toFixed(2) + '</td></tr>';
                        $('#view_customerdetails').children('tbody').append(trow);
                        $('span.number').number(true, 2);
                    }
                    $('.customer_details_totalsale').html(salesTotalQty);
                    $('.customer_details_totalreturn').html(returnTotalQty);
                    // Prefer the server's COMPLETE totals for this customer (over
                    // all their sales), not a sum of just the loaded page which
                    // under-counts once there is more than one page. Round to 2dp.
                    var custSaleTotal =
                        response.data.total && response.data.total.length
                            ? Number(response.data.total[0])
                            : saleTotalValue;
                    var custReturnTotal =
                        response.data.return_total && response.data.return_total.length
                            ? Number(response.data.return_total[0])
                            : returnTotalValue;
                    $('.customer_details_saletotalvalue').html(custSaleTotal.toFixed(2));
                    $('.customer_details_returntotalvalue').html(custReturnTotal.toFixed(2));

                } else {
                    var customersalesreport = [];
                    data = response.data.table.data.list;
                    $(data).each(function (key, val) {
                        let salesQty = 0;
                        $(val.items).each(function (key, val) {
                            salesQty += val.item_quantity;
                        });
                        let returnQty = 0;
                        $(val.items_return).each(function (key, val) {
                            $(val.returnArray.returnValue).each(function (key, val) {
                                returnQty += val.item_quantity;
                            });
                        });
                        let date = PosnicPro.convertDate(val.string_date);
                        let process = val.sale_process;
                        let saleId = val.sales_id;
                        let returnTotal = val.items_return_total;
                        let saleTotal = val.items_total;
                        customersalesreport.push({SalesId: saleId, Date: date, Process: process, NoOfReturn: returnQty, ReturnAmount: returnTotal, NoOfSale: salesQty, SaleAmount: saleTotal});
                    });
                    PosnicPro.JSONToCSVConvertor(customersalesreport, 'customer-sales-reports', true);
                    PosnicPro.customerdetails.customerdetailsTable();
                }

            }
            loader.find(".loadingSpinner:first").remove();
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    customerdetailsreportexport: function (index) {
        var type = $(index).data('id');
        PosnicPro.customerdetails.customerdetailsTable(type);
    }
};

PosnicPro.transactiondetails = {
    deleteConfirmation: false,
    callbackRegistry: {
        name: '',
        arguments: ''
    },
    transactiondetailsTable: function (type) {
        PosnicPro.appendReportTableBody('customertransactiondetails');
        var loader = $(".loader-transactionactivity");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        var table = $('#view_transactiondetails');
        if ($('a#view_customers_page').hasClass('active')) {
            var branch = [];
            branch.push(PosnicPro.local.get("branch_id_set"));
        } else {
            var branch = $("#customer_branch_value").val()
        }
        if (type === 'transactionreportexport') {
            var per_page = table.data('total');
        } else {
            var current_page = table.data('current_page');
            var per_page = $('#view_transactiondetails_per_page').val()
        }
        let customer_id = currentHash.split('/');
        var data = {
            page: current_page,
            limit: per_page,
            customer_id: customer_id[1],
            branch: branch
        };
        var params = {
            url: 'customers/transactionDetails',
            data: data
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                if (type !== 'transactionreportexport') {
                    table.data('total', response.data.table.data.total);
                    table.data('total_pages', response.data.table.data.total_pages);
                    table.data('current_page', response.data.table.data.current_page);
                    table.data('per_page', response.data.table.data.per_page);
                    PosnicPro.paging(response.data.table.data.total_pages, response.data.table.data.current_page);
                    table.children('tbody').text('');
                    $('#view_transactiondetails_total,.item_details_noofsale').text(response.data.table.data.total);
                    var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                    $('#view_transactiondetails_page_total').text(row_total);
                    var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                    $('#view_transactiondetails_page_perpage_total').text(page_totals + response.data.table.data.list.length);
                    var currency = PosnicPro.local.get('currencySign');
                    var rowTotal = response.data.table.data.total;
                    if (rowTotal === 0) {
                        $('.transactionactivity_content').hide();
                        $('#transactionactivity_img_hide').show();

                    } else {
                        $('#transactionactivity_img_hide').hide();
                        $('.transactionactivity_content').show();
                    }
                    for (let i = 0; i < response.data.table.data.list.length; i++) {
                        let row = response.data.table.data.list[i];
                        let salesPending = row.pending !== undefined ? row.pending : 0.00;
                        let saleTotal = row.sale_total !== undefined ? row.sale_total : 0.00;
                        let image_path = (row.transaction_image !== "category.svg") ? row.transaction_image : 'static/images/default/' + row.transaction_image;
                        let deleteTransaction = '<span data-module="customers" data-access="delete" data-toggle="tooltip" title="Delete Transaction" onclick="return PosnicPro.transactiondetails.removeTransactionDetails(\'' + row._id + '\');" class="point-cursor mobile_tooltip text-danger"><i class="feather icon-trash"></i></a>';
                        let deleteSaleTransaction = '<span data-module="customers" data-access="delete" data-toggle="tooltip" title="Connected with sale" class="point-cursor mobile_tooltip text-secondary" style="cursor: default;"><i class="feather icon-link"></i></a>';
                        let row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                        let type = (row.type === 'in') ? '<span class="badge badge-success-inverse">Credit</span>'
                                : (row.type === 'out' && row.sale_id !== '') ? '<span class="badge badge-info-inverse">Sale - Debit</span>'
                                : (row.type === 'out') ? '<span class="badge badge-danger-inverse">Debit</span>'
                                : '<span class="badge badge-warning-inverse">Sale - Due</span>';
                        let trash = (row.sale_id !== '') ? deleteSaleTransaction : deleteTransaction;
                        let connect = (row.sale_id !== '') ? '<span class="badge badge-secondary">Sale Bill</span>' : '';
                        let trow = '<tr> <td scope="row">' + row_no + '</td><td>' + row.string_date + '<br>' + connect + '</td><td class="text-center">' + (row.description || '') + '</td>\n\
                                    <td class="text-left">' + type + '</td><td class="text-center">' +
                                (row.type === 'out' ? '-' : '+') + currency + '&nbsp;' + row.amount + '</td>\n\
                                    <td class="text-center">' + currency + '&nbsp;' + (saleTotal - salesPending) + '</td>\n\
                                    <td class="text-center">' + currency + '&nbsp;' + salesPending + '</td>\n\
                                    <td class="text-center">' + currency + '&nbsp;' + saleTotal + '</td>\n\
                                    <td class="text-center"><img src=' + image_path + ' width=30 height=20 class="imagezoom" id="' + image_path + '" onclick="PosnicPro.viewImage(this.id,\'customers\');"></td>\n\
                                    <td class="text-center">' + trash + '</td></tr>';
                        $('#view_customer_transaction_details').children('tbody').append(trow);
                        $('span.number').number(true, 2);
                        $('#view_transactiondetails').children('tbody').append(trow);
                    }

                    let pendingAmount = 0;
                    $('.transaction_details_pending').html(currency + " " + '0.00');
                    if (response.data.pending !== 0) {
                        pendingAmount = response.data.pending;
                        $('.transaction_details_pending').html(currency + " " + pendingAmount.toFixed(2));
                    }

                    let walletAmount = 0;
                    $('.transaction_details_wallet').html(currency + " " + '0.00');
                    if (response.data.wallet !== 0) {
                        walletAmount = response.data.wallet;
                        $('.transaction_details_wallet').html(currency + " " + walletAmount.toFixed(2));
                    }

                    $('.transaction_details_due').html(currency + " " + '0.00');
                    if (walletAmount < 0 && pendingAmount >= 0) {
                        $('.transaction_details_due').html(currency + " " + (pendingAmount + Math.abs(walletAmount)).toFixed(2));
                    } else {
                        $('.transaction_details_due').html(currency + " " + pendingAmount.toFixed(2));
                    }

                    let inAmount = 0;
                    $('.transaction_details_in').html(currency + " " + '0.00');
                    if (response.data.in !== 0) {
                        inAmount = response.data.in;
                        $('.transaction_details_in').html(currency + " " + inAmount.toFixed(2));
                    }

                    let outAmount = 0;
                    $('.transaction_details_out').html(currency + " " + '0.00');
                    if (response.data.out !== 0) {
                        outAmount = response.data.out;
                        $('.transaction_details_out').html(currency + " " + outAmount.toFixed(2));
                    }

                } else {
                    var transactioncustomerreport = [];
                    data = response.data.table.data.list;
                    $(data).each(function (key, val) {
                        let salesPending = val.pending !== undefined ? val.pending : 0.00;
                        let saleTotal = val.sale_total !== undefined ? val.sale_total : 0.00;
                        let paid = saleTotal - salesPending;
                        let date = val.string_date;
                        let description = val.description;
                        let pending = salesPending;
                        let total = saleTotal;
                        let wallet = val.amount;
                        transactioncustomerreport.push({Date: date, Description: description, Type: type, wallet: wallet, Paid: paid, Pending: pending, Total: total});
                    });
                    PosnicPro.JSONToCSVConvertor(transactioncustomerreport, 'transaction-customer-reports', true);
                    PosnicPro.transactiondetails.transactiondetailsTable();
                }

            }
            loader.find(".loadingSpinner:first").remove();
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    transactiondetailsreportexport: function (index) {
        var type = $(index).data('id');
        PosnicPro.transactiondetails.transactiondetailsTable(type);
    },
    removeTransactionDetails: function (id) {
        if (PosnicPro.transactiondetails.deleteConfirmation) {
            let customer_id = currentHash.split('/');
            var params = {
                url: 'customers/deleteTransaction',
                data: JSON.stringify({
                    id: id,
                    customer_id: customer_id[1]
                })
            };
            PosnicPro.delete(params, function (response) {
                if (response.type === 'success') {
                    PosnicPro.transactiondetails.transactiondetailsTable();
                } else {
                    PosnicPro.alert(response.type, response.message);
                }
                PosnicPro.transactiondetails.deleteConfirmation = false;
            });
        } else {
            PosnicPro.transactiondetails.callbackRegistry = {
                name: 'removeTransactionDetails',
                arguments: id
            };
            $('#delete_transaction_modal').modal('show');
        }
    },
    deleteConfirmed: function () {
        $('#delete_transaction_modal').modal('hide');
        PosnicPro.transactiondetails.deleteConfirmation = true;
        window['PosnicPro']['transactiondetails']['' + PosnicPro.transactiondetails.callbackRegistry.name](PosnicPro.transactiondetails.callbackRegistry.arguments);
    }
};

PosnicPro.closesalesdetails = {
    partialy_checkbox: [],
    walletbalance: 0,
    fixedwalletbalance: 0,
    closesalesdetailsTable: function () {

        let customer_id = currentHash.split('/');
        let data = {
            customer_id: customer_id[1]
        };
        var params = {
            url: 'customers/customerPaymentDetails',
            data: data
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                PosnicPro.closesalesdetails.partialy_checkbox = [];
                let currency = PosnicPro.local.get('currencySign');
                PosnicPro.closesalesdetails.walletbalance = response.data.wallet;
                PosnicPro.closesalesdetails.fixedwalletbalance = response.data.wallet;
                $('.closedsale_details_wallet').html(currency + ' ' + response.data.wallet.toFixed(2));
                $('#listpayment').html('');
                $('.customer-payment-details').hide();
                $('.customer-payment-details-hide').show();
                for (var i = 0; i < response.data.sales.length; i++) {
                    let row = response.data.sales[i];
                    $('.customer-payment-details-hide').hide();
                    $('.customer-payment-details').show();
                    let row_no = i + 1;
                    var checkboxvalue = '';
                    if (response.data.wallet > 0) {
                        $('#walletamount').hide();
                        if (PosnicPro.closesalesdetails.walletbalance >= row.payment_pending) {
                            checkboxvalue = '<input type="checkbox" class="ml-4" id="' + row._id + '" data-amount="' + row.payment_pending + '" data-paidamount="' + row.partial_balance + '" name="id[]" value="' + row._id + '" checked onclick="PosnicPro.closesalesdetails.checkboxSelectOne(this,\'partialy\');">';
                            PosnicPro.closesalesdetails.walletbalance = PosnicPro.closesalesdetails.walletbalance - row.payment_pending;
                            PosnicPro.closesalesdetails["partialy_checkbox"][PosnicPro.closesalesdetails["partialy_checkbox"].length] = {id: row._id, amount: row.payment_pending, paidamount: row.partial_balance};
                            $('#walletsubmitbutton').removeAttr('disabled');
                        } else {
                            checkboxvalue = '<input type="checkbox" class="ml-4" id="' + row._id + '" data-amount="' + row.payment_pending + '" data-paidamount="' + row.partial_balance + '" name="id[]" value="' + row._id + '" onclick="PosnicPro.closesalesdetails.checkboxSelectOne(this,\'partialy\');">';
                        }

                    } else {
                        $('#walletamount').show();
                        $('#walletsubmitbutton').attr('disabled', 'disabled');
                        checkboxvalue = '<input type="checkbox" class="ml-4" disabled="disabled">';
                    }

                    let trow = '<li class="media">' +
                            '<div class="media-body">' +
                            '<h5><span>' + row_no + ')&nbsp;&nbsp;</span>' + row.sales_id + '<span class="badge badge-success ml-3 number">' + currency + ' ' + row.payment_pending.toFixed(2) + '</span> ' + checkboxvalue + ' </h5>' +
                            '<p class="timing ml-3 font-10">Partially Paid :' + currency + ' ' + row.partial_balance.toFixed(2) + '</p>' +
                            '<span class="timing ml-3">' + row.date + '</span>' +
                            '</div>' +
                            '</li>';
                    $('#listpayment').append(trow);
                }
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });

    },
    checkboxSelectOne: function (element, module) {
        if ($(element).prop("checked") === true) {
            PosnicPro.closesalesdetails[module + "_checkbox"][PosnicPro.closesalesdetails[module + "_checkbox"].length] = {id: $(element).val(), amount: $(element).data('amount'), paidamount: $(element).data('paidamount')};
            $('#walletsubmitbutton').removeAttr('disabled');
        } else if ($(element).prop("checked") === false) {
            var removeIndex = PosnicPro.closesalesdetails.partialy_checkbox.map(function (item) {
                return item.id === $(element).val() ? $(element).val() : '';
            }).indexOf($(element).val());
            PosnicPro.closesalesdetails.partialy_checkbox.splice(removeIndex, 1);
        }
        var checkedWalletBalance = 0;
        PosnicPro.closesalesdetails.partialy_checkbox.map(function (item) {
            checkedWalletBalance += item.amount;
        });
        if (PosnicPro.closesalesdetails.fixedwalletbalance < checkedWalletBalance) {
            $(element).prop("checked", false);
            PosnicPro.alert('warning', 'Not enough wallet balance.');
            var removeRmIndex = PosnicPro.closesalesdetails.partialy_checkbox.map(function (item) {
                return item.id === $(element).val() ? $(element).val() : '';
            }).indexOf($(element).val());
            PosnicPro.closesalesdetails.partialy_checkbox.splice(removeRmIndex, 1);
        }
        if (checkedWalletBalance === 0) {
            $('#walletsubmitbutton').attr('disabled', 'disabled');
        }
    },

    paymentClose: function () {

        if (PosnicPro.closesalesdetails.partialy_checkbox.length === 0) {
            PosnicPro.alert('error', 'Select a sale.');
            return false;
        }
        let customer_id = currentHash.split('/');
        var params = {
            method: 'POST',
            url: 'sales/salesPaymentClose',
            data: JSON.stringify({
                "sales": PosnicPro.closesalesdetails.partialy_checkbox,
                "id": customer_id[1]
            })
        };
        PosnicPro.request(params, function (response) {
            if (response.type === 'success') {
                let currency = PosnicPro.local.get('currencySign');
                $('.closedsale_details_wallet').html(currency + ' ' + response.data.toFixed(2));
                PosnicPro.alert(response.type, response.message);
                PosnicPro.closesalesdetails.closesalesdetailsTable();
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        });
    }
};

$("#customers_new").on('shown.bs.modal', function () {
    $(this).find('#customer_name').focus();
});
$("#customer_gstin_number").keyup(function (event) {
    $('#customer_country').val('India');
    var stateOption = '';
    if ($(this).val().length === 2) {
        var params = {
            url: 'setting/getJSONGstState'
        };
        PosnicPro.get(params, function (response) {
            var gst = response.data['gststate'];
            $.each(gst, function (key, val) {

                if ($('#customer_gstin_number').val() === val.id) {
                    PosnicPro.customers.stateOption = val.value;
                    stateOption += '<option id="' + val.id + '" value="' + val.value + '">' + val.value + '</option>';
                    $('#customer_state').html(stateOption);
                }
            });
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    }
});
$("#customerSubmitForm").one('click', function () {
    PosnicPro.customers.validForm();
});
$('#customer_country').one('change', function () {
    var countrySelect = $('#customer_country');
    countrySelect.on('select2:select', function (e) {
        var data = e.params.data;
        PosnicPro.customers.loadSelectCustomerState(data.element.attributes['data-setting-id'].value, 'oneChange');
    });
});

$("#transactionSubmitForm").one('click', function () {
    PosnicPro.customers.transactionValidForm();
});

$('#upload_file_transaction').change(function () {
    $('#transaction_value_check').val(this.files[0].name);
});

$(function () {
    $('#customer_referrer_name').autocomplete({
        deferRequestBy: 120,
            lookup: function (query, done) {
                var result = {};
                var suggestions = [];
                var params = {
                    url: 'customers/getCustomersAjaxList',
                    data: 'query=' + query
                };
                PosnicPro.get(params, function (response) {
                    if (response.suggestions.length > 0) {
                        suggestions: $.map(response.suggestions, function (dataItem) {
                            suggestions.push({"value": dataItem.name, "data": dataItem});
                        });
                    } else {
                        suggestions.push({value: $('#customer_referrer_name').val() + ' ', data: -1});
                    }
                    result["suggestions"] = suggestions;
                    done(result);
                }, function (xhr) {
                    var response = jQuery.parseJSON(xhr.responseText);
                    PosnicPro.alert(response.type, response.message);
                });
            },
            onSelect: function (suggestion) {
                $('#customer_referrer_id').val(suggestion.data.id);
            },
            autoSelectFirst: true,
            triggerSelectOnValidInput: false,
            formatResult: function (suggestion) {
                var phone = suggestion.data.phone;
                return '<div>' +
                        $.Autocomplete.formatResult(suggestion) +
                        '</div><span class="pull-right">' + phone + '</span>';
            }
    });

    PosnicPro.customers.customer_phone = window.intlTelInput(document.querySelector("#customer_phone"), {
        separateDialCode: true,
        preferredCountries: ['in'],
        hiddenInput: "full",
        utilsScript: "../static/script/js/utils.js"
    });
});

/*end*/