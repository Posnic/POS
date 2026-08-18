PosnicPro = {
    config: [],
    modules: ['customers', 'suppliers', 'categories', 'items', 'users', 'branches', 'expenses', 'receivings', 'sales', 'registers'],
    record_url: null,
    record_id: null,
    action: 'add', // can be add or edit
    route_url: null,
    receiving_lineitems: [],
    install_step: [],
    rows_selected: [],
    receivings_checkbox: [],
    sales_checkbox: [],
    kothistory_checkbox: [],
    customers_checkbox: [],
    backup_rows_selected: [],
    suppliers_checkbox: [],
    categories_checkbox: [],
    customercategory_checkbox: [],
    items_checkbox: [],
    item_details_selected: [],
    users_checkbox: [],
    branches_checkbox: [],
    useBranchList: false,
    expenses_checkbox: [],
    stocklogs_checkbox: [],
    registers_checkbox: [],
    variants_checkbox: [],
    returnSalesExchange: 0,
    importAction: 0,
    countryOption: [],
    stateOption: [],
    dateOption: [],
    timezoneOption: [],
    currencyOption: [],
    customerviewdata: [],
    stateOptionId: 0,
    country: '',
    state: '',
    state_select_id: '',
    deleteConfirmation: false,
    roundoff: 0,
    routes: [],
    userACL: '',
    callbackRegistry: {
        name: '',
        arguments: ''
    },
    callbackfilter: {
        name: '',
        nameset: '',
        arguments: ''
    },
    configPaymentType: [],
    nextPage: function (index, element) {
        var module = $(index).data('id');
        var table = $('#view_' + module);
        var current_page = table.data('current_page');
        if ((current_page + 1) <= table.data('total_pages')) {
            table.data('current_page', current_page + 1);
            PosnicPro[module][module + element]('#view_' + module);
        }
    },
    previousPage: function (index, element) {
        var module = $(index).data('id');
        var table = $('#view_' + module);
        var current_page = table.data('current_page');
        if (current_page - 1 >= 1) {
            table.data('current_page', current_page - 1);
            PosnicPro[module][module + element]('#view_' + module);
        }
    },
    setPerPage: function (index, element) {
        let module = $(index).data('id');
        let table = $('#view_' + module);
        let per_page = $('#view_' + module + '_per_page').val();
        per_page = parseInt(per_page, 10) || 5;
        table.data('per_page', per_page);
        let total = table.data('total');
        let total_pages = table.data('total_pages');
        let current_page = table.data('current_page');
        if (parseInt(total) > (parseInt(per_page) * parseInt(total_pages))) {

            let count = parseInt(total) / parseInt(per_page);
            table.data('current_page', (parseInt(current_page) * 2) - 1);
        } else {
            if (parseInt(per_page) > (parseInt(total_pages) * 5)) {
                table.data('current_page', 1);
            } else if (parseInt(total_pages) === current_page) {
                let count = parseInt(total) / parseInt(per_page);
                table.data('current_page', parseInt(count) - 1);
            } else {
                let count = ((current_page * 5) / parseInt(per_page));
                table.data('current_page', Math.round(count));
            }
        }
        PosnicPro[module][module + element]('#view_' + module);
    },
    search: function (index, element) {
        var module = $(index).data('id');
        var table = $('#view_' + module);
        var field = $('#view_' + module + '_fields').val();
        var value = $('#view_' + module + '_input').val();
        var data = {};
        var daterange = $('#view_' + module + '_daterange').val();

        if (daterange !== '') {
            var fields = daterange.split('-');
            var start_date = fields[0];
            var end_date = fields[1];
            data['updated_date'] = { '$gte': start_date, '$lte': end_date };
        }
        if (value !== '') {
            var trimmedValue = value.trim();
            
            // Escape special regex characters
            var escapeRegex = function(string) {
                return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            };

            var tokens = trimmedValue.split(/\s+/).filter(function(t) { return t.length > 0; });
            
            if (tokens.length > 0) {
                // Create a regex that asserts all tokens are present
                // Pattern: (?=.*token1)(?=.*token2)
                var regexPattern = tokens.map(function(token) {
                    return '(?=.*' + escapeRegex(token) + ')';
                }).join('');
                
                data[field] = { '$regex': regexPattern, '$options': 'i' };
            }
        }

        table.data('current_page', 1);
        table.data('filters', JSON.stringify(data));
        PosnicPro[module][module + element]('#view_' + module);
        if (value === '') {
            $('.hide_value_filetr').hide();
            $('.view_' + module + '_filter_value').hide();
        }
    },

    filterClear: function (index) {
        var module = $(index).data('id');
        $('#view_' + module + '_input').val('');
        $('.hide_value_filetr').hide();
        $('.view_' + module + '_filter_value').hide();
    },

    filterDateClear: function (index) {
        var module = $(index).data('id');
        $('#view_' + module + '_daterange').removeClass('active-date');
        $('#view_' + module + '_daterange').val('');
        $('.hide_date_filetr').hide();
        $('.view_' + module + '_date_filter_value').hide();
        if ($('#view_' + module + '_daterange span').html() === 'All Time') {
            $('.daterange-timepicker-all span').html('All Time');
            $('#view_' + module + '_daterange').val(moment().subtract(10, 'years').startOf('month').startOf('day').format('YYYY/MM/DD h:mm A') + ' - ' + moment().endOf('day').format('YYYY/MM/DD h:mm A'));
        } else {
            let startDate = $('#view_' + module + '_daterange').data('daterangepicker').startDate._d;
            let endDate = $('#view_' + module + '_daterange').data('daterangepicker').endDate._d;
            $('#view_' + module + '_daterange').val(moment(startDate).format('YYYY/MM/DD h:mm A') + ' - ' + moment(endDate).format('YYYY/MM/DD h:mm A'));
        }

    },

    filterReportClear: function (index) {
        var module = $(index).data('id');
        $('#view_' + module + '_report_input').val('');
        $('.hide_value_filetr').hide();
        $('.view_' + module + '_filter_value').hide();
    },

    filterReportDateClear: function (index) {
        var module = $(index).data('id');
        $('#view_' + module + '_report_daterange').removeClass('active-date');
        $('.hide_date_filetr').hide();
    },

    dateRangefilterClear: function (index) {
        var module = $(index).data('id');
        $('#view_' + module + '_input').val('');
        $('.hide_value_filetr').hide();
        $('.view_' + module + '_filter_value').hide();

        $('#view_' + module + '_daterange').removeClass('active-date');
        $('#view_' + module + '_daterange').val(moment().startOf('month').startOf('day').format('YYYY/MM/DD h:mm A') + ' - ' + moment().endOf('day').format('YYYY/MM/DD h:mm A'));
        $('.daterange-timepicker span').html('<span>This Month</span>&nbsp;&nbsp;<span  data-toggle="tooltip" data-placement="top" data-original-title="' + moment().startOf('month').startOf('day').format('YYYY/MM/DD h:mm A') + ' - ' + moment().endOf('day').format('YYYY/MM/DD h:mm A') + '"><i class="feather icon-help-circle setfeather_font"></i></span>');
        $('.daterange-timepicker').val(moment().startOf('month').startOf('day').format('YYYY/MM/DD h:mm A') + ' - ' + moment().endOf('day').format('YYYY/MM/DD h:mm A'));
        PosnicPro.dashboard.datePicker();
    },

    dateRangeAllfilterClear: function (index) {
        var module = $(index).data('id');
        $('#view_' + module + '_report_input').val('');
        $('.hide_value_filetr').hide();
        $('.view_' + module + '_filter_value').hide();

        $('#view_' + module + '_report_daterange').removeClass('active-date');
        $('#view_' + module + '_report_daterange').val(moment().startOf('month').startOf('day').format('YYYY/MM/DD h:mm A') + ' - ' + moment().endOf('day').format('YYYY/MM/DD h:mm A'));
        $('.daterange-timepicker-all span').html('<span>This Month</span>&nbsp;&nbsp;<span  data-toggle="tooltip" data-placement="top" data-original-title="' + moment().startOf('month').startOf('day').format('YYYY/MM/DD h:mm A') + ' - ' + moment().endOf('day').format('YYYY/MM/DD h:mm A') + '"><i class="feather icon-help-circle setfeather_font"></i></span>');
        $('.daterange-timepicker-all').val(moment().startOf('month').startOf('day').format('YYYY/MM/DD h:mm A') + ' - ' + moment().endOf('day').format('YYYY/MM/DD h:mm A'));
        PosnicPro.dashboard.datePicker();
    },

    changePlaceholder: function (index) {
        var module = $(index).data('id');
        var field_name = $('#view_' + module + '_fields :selected').text();
        if (typeof field_name === 'string') {
            field_name = field_name.replace(/\s+/g, ' ').trim();
        }
        $('#view_' + module + '_input').prop('placeholder', 'Enter ' + field_name);
    },
    /* Common request for all outgoing server calls */
    requestImage: function (method, params, data, type, callback) {
        let url = API_URL + params;
        // JWT Token support for Electron cross-origin requests
        var headers = {};
        if (navigator.userAgent.indexOf('Electron') !== -1) {
            const token = localStorage.getItem('posnic_jwt_token');
            if (token) {
                headers['Authorization'] = 'Bearer ' + token;
                console.log('✅ JWT added to PosnicPro.requestImage:', url.substring(0, 50) + '...');
            } else {
                console.log('❌ No JWT for PosnicPro.requestImage:', url.substring(0, 50) + '...');
            }
        }
        let request = $.ajax({
            url: url,
            method: method,
            data: data,
            headers: headers,
            xhrFields: {
                withCredentials: true
            },
            processData: type,
            contentType: type
        });

        request.done(function (data) {
            callback(data);
        });

        request.fail(function (jqXHR, textStatus) {
            PosnicPro.alert('error', 'Request Faild!!.');
            return false;
        });
    },
    setResponseData: function (fieldArray) {
        $.each(fieldArray, function (index, value) {
            $('#' + index).html(value);
        });
    },
    mongoIdToDate: function (id) {
        return new Date(parseInt(id.substring(0, 8), 16) * 1000);
    },
    isEmpty: function (str) {
        return (!str || 0 === str.length);
    },
    urlToArray: function (url) {
        var request = {};
        var pairs = url.substring(url.indexOf('?') + 1).split('&');
        for (var i = 0; i < pairs.length; i++) {
            if (!pairs[i])
                continue;
            var pair = pairs[i].split('=');
            request[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1]);
        }
        return request;
    },
    alert: function (heading, text, hideAfter, position) {
        // More Toast details https://kamranahmed.info/toast#toast-head
        hideAfter = typeof hideAfter === 'undefined' ? 4500 : hideAfter;
        position = typeof position === 'undefined' ? 'top-right' : position;
        var icon = heading === 'Information' || heading === 'Alert' ? 'info' : heading;
        icon = icon.toLowerCase();
        $('.jq-toast-wrap').removeClass("top-right bottom-right");
        $.toast({
            heading: heading,
            text: text,
            position: position,
            icon: icon,
            hideAfter: hideAfter,
            stack: 1
        });
    },
    defaultcustomerSet: function () {
        let customerDefaultData = JSON.parse(PosnicPro.local.get('defaultcustomer'));
        if (!customerDefaultData)
            return;
        var params = {
            url: 'setting/getDefaultCustomer',
            data: { data: { customer: customerDefaultData.customer_id } }
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                var responseData = response.data.customer;
                PosnicPro.local.set('defaultcustomer', JSON.stringify(response.data['customer']));
                $('.default-customer-id').val(responseData['customer_id']);
                $('.default-customer-name').val(responseData['customer_name']);
                $('#sales_new_customer_id').val(responseData['customer_id']);
                $('#sales_new_customer_name').val(responseData['customer_name']);
                $('#sales_new_customer_address').val(responseData['customer_address']);
                $('#sales_new_customer_phone').val(responseData['customer_phone']);
                $('#sales_new_customer_email').val(responseData['customer_email']);
                $('#sales_new_customer_state').val(responseData['customer_state']);
                $('#sales_new_customer_country').val(responseData['customer_country']);
                $('#sales_new_customer_gst_type').val(responseData['customer_gst_type']);
                $('#sales_new_customer_gst_number').val(responseData['customer_gst_number']);
                $('#sales_new_customer_partial_balance').val(responseData['customer_partial']);
                $('#customer_current_balance').val(responseData['customer_balance']);
                PosnicPro.local.set('defaultcustomer_partial', responseData['customer_partial']);
                PosnicPro.local.set('customerName', responseData['customer_name']);
                PosnicPro.local.set('customerPhone', responseData['customer_phone']);
                PosnicPro.local.set('customerEmail', responseData['customer_email']);
                PosnicPro.local.set('customerAddress', responseData['customer_address']);
                var customerRecord = [];
                customerRecord.push({ name: responseData['customer_name'], phone: responseData['customer_phone'], email: responseData['customer_email'], address: responseData['customer_address'] });
                db.customerDisplay.put({ id: '1', 'clear': 'no', 'get': 'no', customer: customerRecord });
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        });

        // When we are in the dedicated KOT sales edit flow (kotsales/{id}/edit
        // or kotorder/{id}/edit), keep the primary button label as "Update"
        // instead of resetting it back to "Save" so that the UI clearly
        // indicates an update action.
        var isKotEditFlow = (PosnicPro.sales && PosnicPro.sales.saleProcess === 'KOT' &&
            PosnicPro.kotorder && PosnicPro.kotorder.editSaleId);

        // Also recognize the kotorder/{id}/edit hash as part of the same KOT
        // edit flow to cover KOT History → table+pax → Next navigation.
        if (!isKotEditFlow && typeof window !== 'undefined' && window.location && window.location.hash) {
            var kotOrderHash = window.location.hash;
            if (kotOrderHash.indexOf('kotorder/') !== -1 && kotOrderHash.indexOf('/edit') !== -1) {
                isKotEditFlow = true;
            }
        }

        if (isKotEditFlow) {
            (PosnicPro.local.get('language_herf') === 'ta_dashboard.html')
                ? $('.changeSalesBtnText').text('புதுப்பி')
                : $('.changeSalesBtnText').text('Update');

        } else {
            (PosnicPro.local.get('language_herf') === 'ta_dashboard.html')
                ? $('.changeSalesBtnText').text('சேமி')
                : $('.changeSalesBtnText').text('Save');
        }

    },
    defaultSupplierSet: function () {
        (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') ? $('.changeReceivingText').text('சேமி') : $('.changeReceivingText').text('Save');
        let defaultsupplier = JSON.parse(PosnicPro.local.get('defaultsupplier'));
        if (!defaultsupplier)
            return;
        var params = {
            url: 'setting/getDefaultSupplier',
            data: { data: { supplier: defaultsupplier.supplier_id } }
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                var responseData = response.data.supplier;
                PosnicPro.local.set('defaultsupplier', JSON.stringify(response.data['supplier']));
                $('.default-supplier-id').val(responseData['supplier_id']);
                $('.default-supplier-name').val(responseData['supplier_name']);
                $('#receiving_add_supplier_id').val(responseData['supplier_id']);
                $('#receiving_add_supplier_name').val(responseData['supplier_name']);
                $('#receiving_add_supplier_address').val(responseData['supplier_address']);
                $('#receiving_add_supplier_phone').val(responseData['supplier_phone']);
                $('#receiving_add_supplier_email').val(responseData['supplier_email']);
                $('#receiving_add_supplier_state').val(responseData['supplier_state']);
                $('#receiving_add_supplier_gst_type').val(responseData['supplier_gst_type']);
                $('#receiving_add_supplier_gst_number').val(responseData['supplier_gst_number']);
                $('#receiving_add_payment_mode').val('Cash');
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        });
    },
    /* Set Branches Select Dropdown wherever In branch Select*/
    getBranchDropdownOption: function () {
        PosnicPro.get('branches/getBranchList', function (response) {
            if (response.type === 'success') {
                var data = response.data;
                PosnicPro.setBranchDropdownOption(data);
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        });
    },
    setBranchDropdownOption: function (data) {
        var allbranch = [];
        var branchOption = [];
        var dashboardBranchOption = [];
        var AllbranchOption = [];
        var addNewBranch = [];
        $('#change_branch_list').html('');
        $.each(data, function (index, Value) {
            allbranch.push(Value.id);
            branchOption += '<option selected="selected" value="' + Value.id + '" data-logo="' + Value.branch_image + '" >' + Value.branch_name + '</option>';
            dashboardBranchOption += '<option value="' + Value.id + '">' + Value.branch_name + '</option>';
            var branch_id = PosnicPro.local.get('branch_id_set');
            if (branch_id !== Value.id) {
                var change_branch_value = '<a href="#/branches/' + Value.id + '/change" class="dropdown-item" data-id="' + Value.id + '">' + Value.branch_name + '' +
                    '</a>';
                $('#change_branch_list').append(change_branch_value);
            }
        });
        if (allbranch.length > 1) {
            AllbranchOption += '<option name="selectall" value="' + allbranch + '">selectall</option><option name="removeall" value="' + allbranch + '">removeall</option>';
            $('.dropdown-cursor-pointer').attr("disabled", false).css({ cursor: 'pointer' });
            $('#dropdownMenuLink').addClass('dropdown-toggle');
            document.getElementById("dropdownMenuLink").disabled = false;
        } else if ($("#change_branch_list").is(":empty")) {
            $('.dropdown-cursor-pointer').attr("disabled", false).css({ cursor: 'auto' });
            $('#dropdownMenuLink').removeClass('dropdown-toggle');
            document.getElementById("dropdownMenuLink").disabled = true;
        }
        var listBranch = AllbranchOption.concat(branchOption);
        $('.load-branch').html(listBranch);
        $('.load-select-branch').html(branchOption);
        var branch_id = PosnicPro.local.get('branch_id_set');
        $('.display-current-branch').select2('val', [branch_id]);

        addNewBranch = '<option data-page="branches/new" class="page_url" value="true">Add New Branch</option>';
        if (PosnicPro.local.get('usertype') === 'super_admin') {
            var ChangeBranchOption = addNewBranch.concat(dashboardBranchOption);
        } else {
            var ChangeBranchOption = dashboardBranchOption;
        }
        $('#branch_name').html(ChangeBranchOption);
        var branch_id = PosnicPro.local.get('branch_id_set');
        $("#branch_name option[value='" + branch_id + "']").attr("selected", true);
        $(".select-current-branches").select2().val(branch_id).trigger("change");
    },
    getBranchTaxList: function () {
        var data = {
            tax_group: 'all'
        };
        var params = {
            url: 'setting/getTaxAll',
            data: data
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                var data = response.data;
                if (data.length > 0) {
                    var taxOption = [];
                    $.each(data, function (index, value) {
                        taxOption += '<option value="' + value.tax_id + '" data-tax-id="' + value.tax_id + '" data-tax-name="' + value.tax_name + '" data-tax-value="' + value.tax_value + '">' + value.tax_name + '</option>';
                    });
                } else {
                    taxOption += '<option selected="selected" value="0">No tax</option>';
                }
                $('.items_tax').html(taxOption);
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        });
    },
    //    getBranchRegisterList: function (registerData) {
    //        var branchId = $("#branchtype").val().toString();
    //        if (branchId !== '') {
    //            var value = {
    //                branch: registerData
    //            };
    //            var params = {
    //                url: 'branches/getBranchRegisterList',
    //                data: value
    //            };
    //            PosnicPro.get(params, function (response) {
    //                if (response.type === 'success') {
    //                    var data = response.data;
    //                    var registerOption = [];
    //                    $('#choose_register').empty();
    //                    $.each(data, function (index, value) {
    //                        var registerName = (value.register_name !== '') ? value.register_name : "none";
    //                        registerOption += '<option value="' + value.register_id + '" data-register-name="' + registerName + '" data-register-id="' + value.register_id + '" data-branch-name="' + value.branch_name + '" data-branch-id="' + value.branch_id + '">' + registerName + ' ( ' + value.branch_name + ' )</option>';
    //                    });
    //                    $('#choose_register').append(registerOption).trigger("change");
    //                    let registerId = PosnicPro.local.get("register_ids").split(',');
    //                    $("#choose_register").select2().val(registerId).trigger("change");
    //                } else {
    //                    PosnicPro.alert(response.type, response.message);
    //                }
    //            });
    //        }
    //    },

    /*if click textbox is there any value in textbox select all textbox value like tax ,discount and discount percentage textbox*/
    selectAllText: function (textbox) {
        textbox.focus();
        textbox.select();
    },
    getSum: function (total, num) {
        return total + num;
    },
    /** SALES FUNCTION END **/

    paging: function (total_pages, current_page) {
        if (current_page === 1 && total_pages === 1) {
            $('.previous,.next').attr("disabled", true).css({ cursor: 'not-allowed', color: '#d8d3d3' });
        } else if (current_page === 1) {
            $('.previous').attr("disabled", true).css({ cursor: 'not-allowed', color: '#d8d3d3' });
            $('.next').attr("disabled", false).css({ cursor: 'pointer', color: '#212529' });
        } else if (current_page === total_pages) {
            $('.next').attr("disabled", true).css({ cursor: 'not-allowed', color: '#d8d3d3' });
            $('.previous').attr("disabled", false).css({ cursor: 'pointer', color: '#212529' });
        } else if (current_page > total_pages) {
            $('.previous').attr("disabled", false).css({ cursor: 'pointer', color: '#212529' });
        } else {
            $('.previous,.next').attr("disabled", false).css({ cursor: 'pointer', color: '#212529' });
        }
    },
    refreshDatatable: function (module) {
        PosnicPro[module + "_checkbox"] = [];
        $('.showing-hide-show-' + module).hide();
        $('.hide_value_filetr').hide();
        $('.hide_date_filetr').hide();
        $('.view_' + module + '_filter_value').hide();
        $('#view_' + module + '_input').val('');
        //$('#view_' + module + '_daterange').val('');
        let daterange = $('.daterange-timepicker-all').val();
        var daterangeTxt = $('#view_' + module + '_daterange').text();
        var fields = daterange.split('-');
        var start_date = fields[0];
        var end_date = fields[1];

        $('#view_' + module + '_daterange').removeClass('active-date');
        $('#view_' + module + '_daterange').val(start_date + ' - ' + end_date);

        $('.daterange-timepicker span').html('<span>' + daterangeTxt + '</span>&nbsp;&nbsp;<span  data-toggle="tooltip" data-placement="top" data-original-title="' + start_date + ' - ' + end_date + '"><i class="feather icon-help-circle setfeather_font"></i></span>');
        $('.daterange-timepicker').val(start_date + ' - ' + end_date);
        //PosnicPro.dashboard.datePicker();
        var value = '<button class="btn btn-primary-rgba" type="button" data-id="' + module + '" onclick="PosnicPro.search(this,\"Table\")">'
        PosnicPro.search(value, 'Table');
        $('.add_new_tooltip').tooltip("hide");
    },
    refreshSettingDatatable: function () {
        var module = $('#backuptablelist').val();
        $('.showing-hide-show-' + module).hide();
        $('#view_recycle_bin_input').val('');
        PosnicPro[module + "_checkbox"] = [];
        PosnicPro.settings.settingsTable();
        $('.add_new_tooltip').tooltip("hide");
    },
    refreshReportDatatable: function (index) {
        var module = $(index).data('id');
        PosnicPro[module][module + "Table"]();
        $('.add_new_tooltip').tooltip("hide");
    },
    /*To validate the alphabetic */
    validate: function (evt) {
        $('input.rec_sale_inp_val').on('input', function () {
            this.value = this.value.replace(/[^0-9.]/g, '').replace(/(\..*?)\..*/g, '$1');
        });
        var theEvent = evt || window.event;
        var key = theEvent.keyCode || theEvent.which;
        key = String.fromCharCode(key);
        var regex = /[0-9]|\./;
        if (!regex.test(key)) {
            theEvent.returnValue = false;
            if (theEvent.preventDefault)
                theEvent.preventDefault();
        }
    },
    /*
     * Clamp a typed number, without destroying it on the way.
     *
     * Two faults, both reached from the quantity box on a sale:
     *
     * parseInt cannot see a decimal. Typing ".3" for 300 grams gave NaN, and
     * NaN was treated as below the minimum, so the field blanked to 0 as the
     * decimal point was typed - the value could never be entered at all.
     * parseFloat reads what was actually typed.
     *
     * And going over the maximum returned the literal 100, whatever the
     * maximum was. Quantity is clamped to 100000, so typing past it did not
     * cap the value, it replaced it with an unrelated number.
     *
     * A part-typed number like "0." parses to 0 and is left alone, because
     * this runs on every keystroke and must not fight the person typing.
     */
    /*
     * Units that are measured rather than counted.
     *
     * A quantity in one of these is a reading off a scale, so it is shown to
     * three decimals whatever the value is. Anything else is a count of things
     * and is shown as entered.
     */
    measuredUnits: ['kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms',
        'g', 'gm', 'gms', 'gram', 'grams',
        'l', 'lt', 'ltr', 'litre', 'liter', 'litres', 'liters', 'ml'],

    isMeasuredUnit: function (unit) {
        var u = String(unit === undefined || unit === null ? '' : unit)
            .trim().toLowerCase();
        return PosnicPro.measuredUnits.indexOf(u) !== -1;
    },

    /*
     * A quantity as it should appear in a Qty column.
     *
     * Weights keep all three decimals, including the zeros: 250g and 100g were
     * printing as "0.25" and "0.1", so no two rows in the column were the same
     * width and a column of weights could not be read down or totalled by eye.
     * "0.250" and "0.100" line up, and the trailing zeros read as a weighing
     * rather than as a number somebody rounded off.
     *
     * Counted goods are returned untouched, so a box of 2 does not become
     * "2.000" beside them.
     *
     * Lives here rather than in sales.js because the sale view, the receiving
     * view and the printed receipt all render this column, and only core is on
     * every page.
     */
    formatQuantity: function (value, unit) {
        var n = parseFloat(value);
        if (isNaN(n)) return value;
        return PosnicPro.isMeasuredUnit(unit) ? n.toFixed(3) : String(value);
    },

    /*
     * Lazy libraries (S1 feel-fast).
     *
     * amCharts (1.1MB), ApexCharts (425KB), jsPDF (619KB) and html2canvas
     * (194KB) used to be parsed by every till on every boot, to draw charts
     * and exports most sessions never open. They now load on first use: the
     * build copies them to script/lazy/ under stable names, the service
     * worker caches them after the first click, and a deploy invalidates
     * that cache like any other static file.
     *
     * load() resolves after every file in the set has EXECUTED, in order -
     * amcharts' charts.js needs core.js first, so order is the contract.
     */
    lazy: {
        _sets: {
            amcharts: [
                'script/lazy/amcharts-core.js',
                'script/lazy/amcharts-charts.js',
                'script/lazy/amcharts-animated.js',
            ],
            apexcharts: ['script/lazy/apexcharts.js'],
            jspdf: ['script/lazy/jspdf.js'],
            html2canvas: ['script/lazy/html2canvas.js'],
        },
        _loads: {},
        _script: function (url) {
            return new Promise(function (resolve, reject) {
                var el = document.createElement('script');
                el.src = url;
                el.onload = resolve;
                el.onerror = function () { reject(new Error('failed to load ' + url)); };
                document.head.appendChild(el);
            });
        },
        load: function (name) {
            if (PosnicPro.lazy._loads[name]) return PosnicPro.lazy._loads[name];
            var files = PosnicPro.lazy._sets[name] || [];
            var p = files.reduce(function (prev, url) {
                return prev.then(function () { return PosnicPro.lazy._script(url); });
            }, Promise.resolve());
            p = p.catch(function (err) {
                /* A failed load must be retryable on the next click, never
                   cached as forever-broken. */
                delete PosnicPro.lazy._loads[name];
                PosnicPro.alert('error', 'Could not load the chart / report tools - check the connection and try again.');
                throw err;
            });
            PosnicPro.lazy._loads[name] = p;
            return p;
        },
    },

    /*
     * Realtime (S2): the till listens instead of asking.
     *
     * One SSE connection per till. The server publishes a coarse
     * {type:'change', entity} whenever any till in the shop writes that
     * entity; interested screens register with on(entity, fn) and refresh
     * through the endpoints they already use. Signals only, never data.
     *
     * EventSource reconnects by itself (server sets retry), so a deploy's
     * process reload costs seconds of silence, not a broken page. Handlers
     * are debounced per entity: a burst of writes becomes one refresh.
     * Everything degrades to the existing polls when the stream is down.
     */
    realtime: {
        _source: null,
        _handlers: {},   // entity -> [fn]
        _timers: {},     // entity -> debounce timer
        DEBOUNCE_MS: 1500,
        connected: false,
        start: function () {
            if (PosnicPro.realtime._source || typeof EventSource === 'undefined') return;
            try {
                var es = new EventSource('events');
                PosnicPro.realtime._source = es;
                es.onopen = function () { PosnicPro.realtime.connected = true; };
                es.onerror = function () { PosnicPro.realtime.connected = false; };
                es.onmessage = function (msg) {
                    var event;
                    try { event = JSON.parse(msg.data); } catch (e) { return; }
                    if (!event || event.type !== 'change' || !event.entity) return;
                    var entity = event.entity;
                    try { PosnicPro.bellFeed.record(entity); } catch (e) { /* feed is a bonus */ }
                    clearTimeout(PosnicPro.realtime._timers[entity]);
                    PosnicPro.realtime._timers[entity] = setTimeout(function () {
                        var fns = PosnicPro.realtime._handlers[entity] || [];
                        for (var i = 0; i < fns.length; i++) {
                            try { fns[i](event); } catch (e) { /* one bad handler must not stop the rest */ }
                        }
                    }, PosnicPro.realtime.DEBOUNCE_MS);
                };
            } catch (e) { /* no stream: the polls carry on */ }
        },
        on: function (entity, fn) {
            (PosnicPro.realtime._handlers[entity] =
                PosnicPro.realtime._handlers[entity] || []).push(fn);
        },
    },

    /*
     * The bell (S2): what the shop's other tills just did, in one glance.
     *
     * Fed by the realtime change signals, which carry an entity name and
     * nothing else - so the feed is honest about what it knows: "Sales
     * activity, 2 min ago, ×3", never invented detail. Entries are gated by
     * the same ACL as the page they open, coalesced per entity within a
     * minute so a rush reads as one line, and kept in memory only - the
     * lists themselves are the record; this is just the tap on the shoulder.
     */
    bellFeed: {
        MAX: 20,
        _items: [],       // newest first: {entity, label, hash, count, at}
        _unseen: 0,
        // The feed lives INSIDE the notification bell's dropdown (one bell for
        // everything - user call, 2026-08-18); "open" is the dropdown's state.
        _open: function () {
            var m = document.querySelector('#dropdown-notification .dropdown-menu');
            return !!(m && m.classList.contains('show'));
        },
        _KINDS: {
            sales: { label: 'Sales activity', hash: 'sales', acl: ['sales', 'read'] },
            items: { label: 'Inventory updated', hash: 'items', acl: ['item', 'read'] },
            receivings: { label: 'Receiving activity', hash: 'receivings', acl: ['receiving', 'read'] },
            customers: { label: 'Customer records changed', hash: 'customers', acl: ['customer', 'read'] },
            suppliers: { label: 'Supplier records changed', hash: 'suppliers', acl: ['supplier', 'read'] },
            categories: { label: 'Categories changed', hash: 'categories', acl: ['category', 'read'] },
            expenses: { label: 'Expense recorded', hash: 'expenses', acl: ['expense', 'read'] },
            registers: { label: 'Register activity', hash: 'registers', acl: ['sales', 'read'] },
            shifts: { label: 'Staff clock activity', hash: 'users', acl: ['user', 'read'] },
            easytables: { label: 'Table / KOT activity', hash: 'kothistory', acl: ['sales', 'read'] },
        },
        _can: function (acl) {
            var u = PosnicPro.userACL;
            return !!(u && u[acl[0]] && u[acl[0]][acl[1]] === true);
        },
        record: function (entity) {
            var kind = PosnicPro.bellFeed._KINDS[entity];
            if (!kind || !PosnicPro.bellFeed._can(kind.acl)) return;
            var items = PosnicPro.bellFeed._items;
            var now = Date.now();
            if (items.length && items[0].entity === entity && now - items[0].at < 60000) {
                items[0].count++;
                items[0].at = now;
            } else {
                items.unshift({ entity: entity, label: kind.label, hash: kind.hash, count: 1, at: now });
                if (items.length > PosnicPro.bellFeed.MAX) items.pop();
                PosnicPro.bellFeed._unseen++;
            }
            PosnicPro.bellFeed._badge();
            if (PosnicPro.bellFeed._open()) PosnicPro.bellFeed._paint();
        },
        _badge: function () {
            var el = document.getElementById('bell_feed_badge');
            if (!el) return;
            var n = PosnicPro.bellFeed._unseen;
            el.style.display = n > 0 ? 'inline-block' : 'none';
            el.textContent = n > 99 ? '99+' : String(n);
        },
        _ago: function (at) {
            var s = Math.max(0, Math.round((Date.now() - at) / 1000));
            if (s < 60) return 'just now';
            var m = Math.round(s / 60);
            if (m < 60) return m + ' min ago';
            return Math.round(m / 60) + ' h ago';
        },
        _paint: function () {
            var list = document.getElementById('bell_feed_list');
            if (!list) return;
            var items = PosnicPro.bellFeed._items;
            if (!items.length) {
                list.innerHTML = '<div class="bellfeed-empty">Nothing yet - activity from other tills lands here.</div>';
                return;
            }
            var html = '';
            for (var i = 0; i < items.length; i++) {
                var it = items[i];
                html += '<div class="bellfeed-item" data-i="' + i + '">' +
                    '<span>' + it.label + (it.count > 1 ? ' <span class="bellfeed-count">×' + it.count + '</span>' : '') + '</span>' +
                    '<span class="bellfeed-time">' + PosnicPro.bellFeed._ago(it.at) + '</span>' +
                    '</div>';
            }
            list.innerHTML = html;
            $(list).children('.bellfeed-item').off('click').on('click', function () {
                var it = PosnicPro.bellFeed._items[Number($(this).data('i'))];
                if (PosnicPro.bellFeed._open()) $('#notoficationlink').dropdown('toggle');
                if (it) hasher.setHash(it.hash);
            });
        },
        /*
         * Push opt-in (roadmap W4). The pipe exists server-side; this is the
         * per-device door: ask permission, subscribe with the shop's VAPID
         * key, register with the server, then offer a test send so the
         * person SEES it work. Hidden wherever push cannot work (Electron
         * never registers the worker; unsupported browsers).
         */
        _pushSetup: function () {
            var $btn = $('#bell_feed_push');
            if (!$btn.length) return;
            if (!('Notification' in window) || !navigator.serviceWorker || !('PushManager' in window)) {
                $btn.hide();
                return;
            }
            navigator.serviceWorker.getRegistration().then(function (reg) {
                if (!reg) { $btn.hide(); return; }
                reg.pushManager.getSubscription().then(function (sub) {
                    $btn.text(sub ? 'Send test notification' : 'Enable notifications on this device')
                        .data('subscribed', !!sub).show();
                });
            }).catch(function () { $btn.hide(); });
        },
        _pushClick: function () {
            var $btn = $('#bell_feed_push');
            if ($btn.data('subscribed')) {
                PosnicPro.post({ url: 'push/test', data: JSON.stringify({}) }, function (response) {
                    PosnicPro.alert(response.type, response.message);
                }, function () { PosnicPro.alert('error', 'Could not send the test.'); });
                return;
            }
            Notification.requestPermission().then(function (perm) {
                if (perm !== 'granted') return;
                return navigator.serviceWorker.getRegistration().then(function (reg) {
                    if (!reg) return;
                    return new Promise(function (resolve) {
                        PosnicPro.get({ url: 'push/key', data: {} }, function (r) {
                            resolve(r && r.data && r.data.key);
                        }, function () { resolve(null); });
                    }).then(function (key) {
                        if (!key) return;
                        var raw = atob(key.replace(/-/g, '+').replace(/_/g, '/')
                            + '='.repeat((4 - key.length % 4) % 4));
                        var bytes = new Uint8Array(raw.length);
                        for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
                        return reg.pushManager.subscribe({
                            userVisibleOnly: true,
                            applicationServerKey: bytes,
                        }).then(function (sub) {
                            return new Promise(function (resolve) {
                                PosnicPro.post({
                                    url: 'push/subscribe',
                                    data: JSON.stringify({ subscription: sub.toJSON() }),
                                }, function () {
                                    PosnicPro.alert('success', 'Notifications enabled on this device.');
                                    PosnicPro.bellFeed._pushSetup();
                                    resolve();
                                }, function () { resolve(); });
                            });
                        });
                    });
                });
            }).catch(function () { /* declined or unsupported - the bell still works */ });
        },
        /* Wire the dropdown: opening it marks activity seen, paints the feed
           fresh, and refreshes the push button's state. */
        init: function () {
            var $dd = $('#dropdown-notification');
            if (!$dd.length) return;
            $dd.on('shown.bs.dropdown', function () {
                PosnicPro.bellFeed._unseen = 0;
                PosnicPro.bellFeed._badge();
                PosnicPro.bellFeed._paint();
                PosnicPro.bellFeed._pushSetup();
            });
            PosnicPro.bellFeed._paint();
        },
    },

    /*
     * Charts.
     *
     * Every report used to call am4core.create() straight onto its div, and no
     * report ever disposed the chart it replaced. amCharts does not object: it
     * adds the second chart to the div alongside the first, and the two then
     * measure the same container while resizing it, each triggering the other
     * until the stack runs out. What the shop sees is a grey panel with
     * "Maximum call stack size exceeded" in a small box - amCharts' own error
     * modal - and no report.
     *
     * Reported on Item Reports / Top 5 Selling, where a tab click both fetched
     * the data and rendered a chart with no data, so two charts landed on one
     * div every time. The same shape existed in eight other places waiting for
     * a second render: a date-range change, a branch switch, a revisited tab.
     *
     * So no report creates charts directly any more. This disposes whatever was
     * on the div before putting anything new there, which is the whole fix.
     */
    chart: {
        /*
         * Anything currently living on this div, gone.
         *
         * Tracked by id, plus a sweep of amCharts' own registry: a chart made
         * before this existed, or by a page still doing it the old way, is
         * still attached to the div and would still fight the new one.
         */
        dispose: function (id) {
            var kept = PosnicPro.chart._live[id];
            if (kept) {
                try { if (!kept.isDisposed()) kept.dispose(); } catch (e) { /* already gone */ }
                delete PosnicPro.chart._live[id];
            }

            try {
                var sprites = am4core.registry.baseSprites || [];
                for (var i = sprites.length - 1; i >= 0; i--) {
                    var s = sprites[i];
                    var host = s && s.svgContainer && s.svgContainer.htmlElement;
                    if (host && host.id === id) s.dispose();
                }
            } catch (e) { /* an amCharts without a registry: the tracked one was enough */ }
        },

        /*
         * A chart on a clean div.
         *
         * Returns null when the div is not on the page - a tab that was never
         * opened, a panel a permission hid. Rendering into nothing is how the
         * chart with no size and no parent gets created, and callers guard on
         * null rather than discovering that later.
         */
        create: function (id, type) {
            if (!document.getElementById(id)) return null;
            PosnicPro.chart.dispose(id);
            var chart = am4core.create(id, type);
            PosnicPro.chart._live[id] = chart;
            return chart;
        },

        /*
         * Nothing to plot.
         *
         * An empty chart draws as a grey rectangle, which reads as a failure
         * rather than as a quiet month. This says so in words instead.
         */
        empty: function (id, message) {
            var host = document.getElementById(id);
            if (!host) return;
            PosnicPro.chart.dispose(id);
            host.innerHTML =
                '<div class="chart-empty-state">' +
                '<i class="icon-bar-chart"></i>' +
                '<p>' + (message || 'No data for the selected period') + '</p>' +
                '</div>';
        },

        _live: {}
    },

    minmax: function (value, min, max) {
        var text = String(value);

        /*
         * Mid-keystroke, so there is nothing to clamp yet.
         *
         * Every caller is an oninput handler writing straight back into the
         * field, so anything returned here lands under the cursor. Someone
         * typing ".3" passes through "." on the way, and answering that with 0
         * turned the next keystroke into "03" - three kilos instead of three
         * hundred grams. An emptied box stays empty for the same reason:
         * forcing a 0 back in means deleting it again before retyping.
         */
        if (text === '' || text === '.' || /\.$/.test(text)) return value;

        var n = parseFloat(text);
        if (isNaN(n) || n < min)
            return 0;
        else if (n > max)
            return max;
        else
            return value;
    },
    /*To validate the isNumber or not*/
    isNumber: function (evt) {
        evt = (evt) ? evt : window.event;
        var charCode = (evt.which) ? evt.which : evt.keyCode;
        if (charCode > 31 && (charCode < 48 || charCode > 57)) {
            return false;
        }
        return true;
    },
    /*To validate the email or not*/
    validateEmail: function ($email) {
        var emailReg = /^([\w-\.]+@([\w-]+\.)+[\w-]{2,4})?$/;
        return emailReg.test($email);
    },
    /*For display item name last characters sholud be dot*/
    textOverflowEllipsis: function (text, count, insertDots) {
        return text.slice(0, count) + (((text.length > count) && insertDots) ? "..." : "");
    },
    /*For display item name last characters sholud be dot*/
    textOverflowPrintEllipsis: function (text, count, insertDots) {
        return text.slice(0, count) + (((text.length > count) && insertDots) ? "..." : text);
    },
    exportTableData: function (selectedTableRow, table) {
        // "Select all N" mode: export the whole filtered set, not the ticked
        // page. The count shown is the real total; the row ids are ignored, the
        // server re-derives the set from the same filter the list is using.
        if (PosnicPro.selectAllMatching === table) {
            var total = parseInt($('#view_' + table + '_total').text(), 10) || 0;
            $('.exportCountValue').text(total);
            $('#exportHeading').text(table);
            $('#exportHeading').css('textTransform', 'capitalize');
            $('.export_modal').modal('show');
            $('#selectrow').val('');
            $('#table_row').val(table);
            return;
        }
        if (selectedTableRow.length > 0) {
            $('.exportCountValue').text(selectedTableRow.length);
            $('#exportHeading').text(table);
            $('#exportHeading').css('textTransform', 'capitalize');
            $('.export_modal').modal('show');
            $('#selectrow').val(selectedTableRow);
            $('#table_row').val(table);
        } else {
            PosnicPro.alert('warning', 'Select must atleast one row!!.');
            return false;
        }
    },

    delayKeyUp: function (callback, ms) {
        var timer = 0;
        return function () {
            var context = this, args = arguments;
            clearTimeout(timer);
            timer = setTimeout(function () {
                callback.apply(context, args);
            }, ms || 0);
        };
    },
    /*Export modal show*/

    getExportValue: function (selectedTableRow, table) {
        var payload;
        if (PosnicPro.selectAllMatching === table) {
            // Send the same filter the list is using so the export matches what
            // the shop was looking at. data('filters') is the stringified Mongo
            // filter the list already sends to the items endpoint.
            var filters = $('#view_' + table).data('filters');
            payload = JSON.stringify({ all: true, filters: filters || {} });
        } else {
            payload = JSON.stringify(selectedTableRow);
        }
        var params = {
            url: '' + table + '/export' + table,
            data: payload
        };
        PosnicPro.post(params, function (response) {
            if (response.type === 'success') {
                $('.export_modal').modal('hide');
                PosnicPro.JSONToCSVConvertor(response.data, table, true);
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        });


    },
    importTableHeader: function (table) {
        var tableHead = {
            'customers': ['name', 'email', 'phone', 'address'],
            'suppliers': ['name', 'email', 'phone', 'address'],
            'categories': ['name', 'discount_amount', 'discount_percentage', 'description'],
            'customercategory': ['name', 'description'],
            'items': ['name', 'itemid', 'barcode_id', 'category_name', 'supplier_name', 'discount_amount', 'discount_percentage', 'hsncode', 'hsn_code', 'hsndescription', 'hsn_description', 'tax_name', 'tax', 'tax_type', 'mrp_price', 'company_price', 'selling_price', 'available_quantity', 'unit', 'sort_order'],
            'expenses': ['amount', 'type', 'category', 'recipientname', 'approvedby', 'description']
        };
        var exportData = [];
        $(tableHead).each(function (key, val) {
            exportData = val[table];
        });
        return exportData;
    },
    JSONToCSVConvertor: function (JSONData, ReportTitle, ShowLabel) {
        //If JSONData is not an object then JSON.parse will parse the JSON string in an Object
        var arrData = typeof JSONData != 'object' ? JSON.parse(JSONData) : JSONData;
        var array = arrData;
        var fields = Object.keys(array[0]).filter(field => field !== '_id');
        var replacer = function (key, value) {
            return value === null ? '' : value;
        };
        var csv = array.map(function (row) {
            return fields.map(function (fieldname) {
                return JSON.stringify(row[fieldname], replacer);
            }).join(',');
        });
        csv.unshift(fields.join(',')); // add header column
        var CSV = csv.join('\r\n');
        if (CSV === '') {
            PosnicPro.alert('warning', 'Invalid data...!!!');
            return false;
        }
        //Generate a file name
        var fileName = ReportTitle.replace(/ /g, "_");
        //Initialize file format you want csv or xls
        var uri = 'data:text/csv;charset=utf-8,' + CSV;
        excel = encodeURI(uri); //Links to CSV 
        var link = document.createElement("a");
        link.setAttribute('href', excel);
        link.style = "visibility:hidden";
        link.download = fileName + ".csv";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    },

    /*Import files*/
    importTableFile: function (importform) {
        PosnicPro.importAction = importform;
        $('#import_modal').modal('show');
        $('#errorTable').hide();
        $('#importHeading').html(importform);
        $('#importHeading').css('textTransform', 'capitalize');
        $('.hide-import-table').hide();
        $('.importFileFormat').attr('href', './static/Import_sample_files/' + importform + '.csv');
    },
    /*Images view*/
    viewImage: function (name, path) {
        let image_path = (name !== "category.svg" && name !== "item.svg" && name !== "user.svg" && name !== "store.png") ? name : 'static/images/default/' + name;
        swal({
            imageUrl: image_path,
            imageWidth: 550,
            imageHeight: 350,
            showCloseButton: true,
            showCancelButton: false,
            showConfirmButton: false,
            closeButtonText: 'X'
        });
    },
    deleteTableRowData: function (id, url) {
        (url === 'sales') ? $('.removetransactiontext').show() : $('.removetransactiontext').hide();
        $('.removeText').text('');
        $('.deleteCountValue').text('');
        if (PosnicPro.deleteConfirmation) {
            PosnicPro.callbackRegistry = {};
            var arr = [];
            var obj = {};
            obj = id;
            arr.push(obj);
            var params = {
                url: '' + PosnicPro.record_url + '/delete',
                data: JSON.stringify({ data: arr, approval_token: PosnicPro._approvalToken || undefined })
            };
            PosnicPro._approvalToken = null; // single-use
            PosnicPro.delete(params, function (response) {
                if (response.type === 'success') {
                    let actionUrl = (PosnicPro.record_url === 'customerCategory') ? PosnicPro.record_url.toLowerCase() : PosnicPro.record_url;
                    $('.showing-hide-show-' + actionUrl).hide();
                    $("#" + actionUrl + "_deletebtn").addClass("disabled");
                    $("#" + actionUrl + "_exportbtn").addClass("disabled");
                    $("#" + actionUrl + "_accessbtn").addClass("disabled");
                    PosnicPro[actionUrl + "_checkbox"] = [];
                    if ($('a#contact-tab-justified').hasClass('active')) {
                        PosnicPro.sales.recentMenu.salesList();
                    }
                    (actionUrl === 'customercategory') ? PosnicPro.customercategory.loadSelectCustomereCategory() : '';
                    (actionUrl === 'categories') ? PosnicPro.items.loadSelectCategory() : '';
                    (actionUrl === 'variants') ? PosnicPro.items.loadSelectVariant() : '';
                    (actionUrl === 'branches') ? PosnicPro.setBranchDropdownOption(response.data) : '';
                    if (actionUrl === 'items') {
                        PosnicPro.stocklogs.viewLowStockDashboard();
                    }
                    if (actionUrl === 'sales') {
                        if (PosnicPro.sales.recentSaleAction === true) {
                            hasher.setHash('sales/new');
                        }
                    }

                    PosnicPro[actionUrl][actionUrl + "Table"](actionUrl);
                }
                PosnicPro.alert(response.type, response.message);
                PosnicPro.deleteConfirmation = false;
            });
        } else {
            PosnicPro.record_url = url;
            PosnicPro.callbackRegistry = {
                name: 'deleteTableRowData',
                arguments: id
            };
            $('#delete_modal').modal('show');
        }
    },

    deleteTableSelectedRowData: function (e, action) {
        (PosnicPro.record_url === 'sales') ? $('.removetransactiontext').show() : $('.removetransactiontext').hide();
        $('.removeText').text('selected details will be deleted');
        if (PosnicPro.deleteConfirmation) {
            PosnicPro.callbackRegistry = {};
            var arr = [];
            var obj = {};
            $(e).each(function (key, id) {
                obj = id;
                arr.push(obj);
            });
            var params = {
                url: '' + PosnicPro.record_url + '/delete',
                data: JSON.stringify({ data: arr, approval_token: PosnicPro._approvalToken || undefined })
            };
            PosnicPro._approvalToken = null; // single-use
            //$(e).each(function (key, id) {
            PosnicPro.delete(params, function (response) {
                if (response.type === 'success') {
                    let actionUrl = (PosnicPro.record_url === 'customerCategory') ? PosnicPro.record_url.toLowerCase() : PosnicPro.record_url;
                    $('.showing-hide-show-' + actionUrl).hide();
                    $("#" + actionUrl + "_deletebtn").addClass("disabled");
                    $("#" + actionUrl + "_exportbtn").addClass("disabled");
                    $("#" + actionUrl + "_accessbtn").addClass("disabled");
                    PosnicPro[actionUrl + "_checkbox"] = [];
                    (actionUrl === 'customercategory') ? PosnicPro.customercategory.loadSelectCustomereCategory() : '';
                    (actionUrl === 'categories') ? PosnicPro.items.loadSelectCategory() : '';
                    (actionUrl === 'variants') ? PosnicPro.items.loadSelectVariant() : '';
                    (actionUrl === 'branches') ? PosnicPro.setBranchDropdownOption(response.data) : '';
                    (actionUrl === 'items') ? PosnicPro.stocklogs.viewLowStockDashboard() : '';
                    if (actionUrl === 'sales') {
                        if (PosnicPro.sales.recentSaleAction === true) {
                            hasher.setHash('sales/new');
                        }
                    }
                    if ($('a#contact-tab-justified').hasClass('active')) {
                        PosnicPro.sales.recentMenu.salesList();
                    }
                    PosnicPro[actionUrl][actionUrl + "Table"](actionUrl);
                }
                PosnicPro.alert(response.type, response.message);
                PosnicPro.deleteConfirmation = false;
            });
            // });
        } else {
            PosnicPro.record_url = '';
            PosnicPro.record_url = action;
            PosnicPro.callbackRegistry = {
                name: 'deleteTableSelectedRowData',
                arguments: e
            };
            $('#delete_modal').modal('show');
        }
    },
    /*delete confirmation*/
    deleteConfirmed: function () {
        $('#delete_modal').modal('hide');
        // Capture the pending callback now so the async approval path below is
        // not affected by any later change to callbackRegistry.
        var cb = PosnicPro.callbackRegistry;
        var proceed = function () {
            PosnicPro.deleteConfirmation = true;
            window['PosnicPro']['' + cb.name](cb.arguments);
        };
        // Deleting a sale is a void. When this user can't void on their own a
        // manager must approve it on the spot before we proceed.
        if (PosnicPro.record_url === 'sales' && !PosnicPro.posCan('void_sale')) {
            var sid = (typeof cb.arguments === 'string') ? cb.arguments : null;
            PosnicPro.requireManagerApproval('void_sale',
                { saleId: sid, prompt: "Voiding a sale needs a manager's approval." },
                function (approval) {
                    // Stash the token so the delete request can prove the approval
                    // to the server (it is single-use: cleared once sent).
                    PosnicPro._approvalToken = approval && approval.approval_token;
                    proceed();
                });
            return;
        }
        proceed();
    },
    /*delete confirmation for delete all collection from the admin settings*/
    collectionDeleteConfirmed: function () {
        $('#delete_modal').modal('hide');
        $('#delete_collection_modal').modal('hide');
        $('.user_verify').hide();
        PosnicPro.deleteConfirmation = true;
        window['PosnicPro']['' + PosnicPro.callbackRegistry.name](PosnicPro.callbackRegistry.arguments);
    },

    /* ----- Manager-approval elevation (Phase 2) -----------------------------
     * A cashier's restricted POS action (void / refund / over-limit discount)
     * can be authorised on the spot by a manager entering their PIN. posCan()
     * answers whether the CURRENT user may do the action without a manager;
     * requireManagerApproval() runs onApproved immediately if so, otherwise
     * pops the PIN modal and only proceeds once the server approves the PIN.
     */
    _pendingApproval: null,
    posCan: function (action) {
        var usertype = PosnicPro.local.get('usertype');
        // Owner-class accounts always pass (also grandfathers pre-roles shops).
        if (usertype === 'super_admin' || usertype === 'admin' || usertype === 'manager') {
            return true;
        }
        var pos = PosnicPro.userACL && PosnicPro.userACL.pos;
        // Fail open when the POS matrix isn't present (a session from before this
        // shipped) so the till is never unexpectedly blocked.
        if (!pos || typeof pos !== 'object') return true;
        return pos[action] === true;
    },
    _approvalMode: 'pin', // 'pin' | 'card'
    requireManagerApproval: function (action, opts, onApproved, onDenied) {
        opts = opts || {};
        if (PosnicPro.posCan(action)) {
            if (typeof onApproved === 'function') onApproved(null);
            return;
        }
        PosnicPro._pendingApproval = {
            action: action, opts: opts, onApproved: onApproved, onDenied: onDenied,
        };
        PosnicPro._setApprovalMode('pin'); // always open on the PIN pane
        $('#manager_pin_input, #manager_card_input').val('');
        $('#manager_pin_error').addClass('d-none').text('');
        $('#manager_pin_prompt').text(opts.prompt || "This action needs a manager's approval.");
        $('#manager_pin_submit').prop('disabled', false);
        $('#manager_pin_modal').modal('show');
        setTimeout(function () { $('#manager_pin_input').trigger('focus'); }, 400);
    },
    _setApprovalMode: function (mode) {
        PosnicPro._approvalMode = mode;
        if (mode === 'card') {
            $('#manager_pin_pane').addClass('d-none');
            $('#manager_card_pane').removeClass('d-none');
            $('#manager_approval_toggle').text('Enter PIN instead');
        } else {
            $('#manager_card_pane').addClass('d-none');
            $('#manager_pin_pane').removeClass('d-none');
            $('#manager_approval_toggle').text('Swipe card instead');
        }
    },
    toggleApprovalMode: function () {
        PosnicPro._setApprovalMode(PosnicPro._approvalMode === 'card' ? 'pin' : 'card');
        $('#manager_pin_error').addClass('d-none').text('');
        var sel = PosnicPro._approvalMode === 'card' ? '#manager_card_input' : '#manager_pin_input';
        $(sel).val('').trigger('focus');
    },
    submitManagerApproval: function () {
        var pending = PosnicPro._pendingApproval;
        if (!pending) { $('#manager_pin_modal').modal('hide'); return; }
        var byCard = PosnicPro._approvalMode === 'card';
        var value = byCard ? $('#manager_card_input').val() : $('#manager_pin_input').val();
        if (!value || !value.trim()) {
            $('#manager_pin_error').text(byCard ? 'Swipe a card' : 'Enter a PIN').removeClass('d-none');
            return;
        }
        $('#manager_pin_submit').prop('disabled', true);
        var reEnable = function () {
            $('#manager_pin_submit').prop('disabled', false);
            $(byCard ? '#manager_card_input' : '#manager_pin_input').val('').trigger('focus');
        };
        var payload = byCard
            ? { card_uid: value.trim(), action: pending.action, sale_id: pending.opts.saleId || pending.opts.entityId || null }
            : { pin: value, action: pending.action, sale_id: pending.opts.saleId || pending.opts.entityId || null };
        PosnicPro.post({
            url: byCard ? 'authorizations/verify-card' : 'authorizations/verify-pin',
            data: JSON.stringify(payload),
        }, function (response) {
            if (response && response.type === 'success') {
                $('#manager_pin_modal').modal('hide');
                PosnicPro._pendingApproval = null;
                if (typeof pending.onApproved === 'function') pending.onApproved(response.data);
            } else {
                reEnable();
            }
        }, function () {
            // Failure (e.g. 403 wrong PIN/card). Passing this callback also
            // prevents the global handler from redirecting to login on a 403;
            // the error toast it shows is enough. Keep the modal open to retry.
            reEnable();
        });
    },

    /* ----- Shift / attendance widget (Phase 4) ------------------------------
     * A header button opens a small modal: the logged-in user clocks themselves
     * in/out, and a shared terminal can let any staff member SWIPE their card to
     * clock in/out (POST /shifts/clock-by-card). Failure callbacks are passed so
     * a 409 (e.g. "already clocked in") never bounces the user to login.
     */
    shiftWidget: {
        // Shop-wide staff toggles from General Settings, read from the cached
        // general_settings blob. Each key falls back to its shipping default
        // when the blob (or the key) is absent: clock-in on, tips off
        // (hospitality-only), roster on.
        _setting: function (key, dflt) {
            try {
                var raw = PosnicPro.local.get('general_settings');
                if (!raw) return dflt;
                var v = JSON.parse(raw)[key];
                return typeof v === 'boolean' ? v : dflt;
            } catch (e) { return dflt; }
        },
        enabled: function () {
            return PosnicPro.shiftWidget._setting('staff_shifts_enable', true);
        },
        applyEnabled: function () {
            var on = PosnicPro.shiftWidget.enabled();
            $('#shift_clock_li').toggle(on);
            $('#labour_report_menu').toggle(on);
        },
        // Page-load sync for the header's on-shift dot (the modal's refresh
        // keeps it current afterwards). Silent: never disturbs the page.
        syncHeader: function () {
            if (!$('#shift_clock_btn').length || !PosnicPro.shiftWidget.enabled()) { return; }
            PosnicPro.get('shifts/current', function (r) {
                $('#shift_clock_btn').toggleClass('on-shift', !!(r && r.data && r.data.clock_in));
            }, function () {});
        },
        openWidget: function () {
            if (!PosnicPro.shiftWidget.enabled()) { return; }
            PosnicPro.shiftWidget.refresh();
            $('#shift_card_input').val('');
            // No report entry points here - the header clock button is for
            // clocking in and out; the report lives under Reports.
            $('#shift_tips_wrap').toggle(PosnicPro.shiftWidget._setting('staff_tips_enable', false));
            $('#roster_link_wrap').toggle(PosnicPro.shiftWidget._setting('staff_roster_enable', true));
            $('#shift_modal').modal('show');
            setTimeout(function () { $('#shift_card_input').trigger('focus'); }, 400);
        },
        refresh: function () {
            $('#shift_status').text('Loading…');
            PosnicPro.get('shifts/current', function (response) {
                var s = response && response.data;
                var onShift = !!(s && s.clock_in);
                $('#shift_clock_btn').toggleClass('on-shift', onShift);
                // ONE action at a time (user call): the state shows exactly
                // the button that makes sense. Swipe stays for everyone -
                // an RFID card decides in/out per person on the server.
                $('#shift_clock_in_btn').toggle(!onShift);
                $('#shift_clock_out_btn').toggle(onShift);
                if (onShift) {
                    var since = new Date(s.clock_in);
                    $('#shift_status').html('<span class="badge badge-success">On shift</span><br>'
                        + '<small class="text-muted">since ' + since.toLocaleString() + '</small>');
                    $('#shift_clock_out_btn').prop('disabled', false);
                } else {
                    $('#shift_status').html('<span class="badge badge-secondary">Not clocked in</span>');
                    $('#shift_clock_in_btn').prop('disabled', false);
                }
            }, function () { $('#shift_status').text('—'); });
        },
        clockIn: function () {
            PosnicPro.post({ url: 'shifts/clock-in', data: JSON.stringify({}) },
                function (r) { PosnicPro.alert(r.type, r.message); PosnicPro.shiftWidget.refresh(); },
                function () { PosnicPro.shiftWidget.refresh(); });
        },
        clockOut: function () {
            var payload = {};
            var tips = $('#shift_tips_input').val();
            if (tips !== '' && !isNaN(tips) && Number(tips) >= 0) { payload.tips = Number(tips); }
            PosnicPro.post({ url: 'shifts/clock-out', data: JSON.stringify(payload) },
                function (r) {
                    PosnicPro.alert(r.type, r.message);
                    $('#shift_tips_input').val('');
                    PosnicPro.shiftWidget.refresh();
                },
                function () { PosnicPro.shiftWidget.refresh(); });
        },
        swipe: function () {
            var card = $('#shift_card_input').val();
            if (!card || !card.trim()) return;
            PosnicPro.post({
                url: 'shifts/clock-by-card',
                data: JSON.stringify({ card_uid: card.trim() }),
            }, function (r) {
                if (r && r.type === 'success') {
                    var who = (r.data && r.data.shift && r.data.shift.user_name) || 'Staff';
                    var act = (r.data && r.data.action === 'clock_out') ? 'clocked out' : 'clocked in';
                    PosnicPro.alert('success', who + ' ' + act);
                } else if (r && r.message) {
                    PosnicPro.alert(r.type || 'error', r.message);
                }
                $('#shift_card_input').val('').trigger('focus');
                PosnicPro.shiftWidget.refresh();
            }, function () {
                $('#shift_card_input').val('').trigger('focus');
            });
        },
        // Labour / payout report ------------------------------------------------
        _fmtDate: function (d) {
            var m = ('0' + (d.getMonth() + 1)).slice(-2);
            var day = ('0' + d.getDate()).slice(-2);
            return d.getFullYear() + '-' + m + '-' + day;
        },
        // The report is a page now (#/labourreport); kept as a redirect so
        // any old caller still lands somewhere sensible.
        openReport: function () {
            $('#shift_modal').modal('hide');
            hasher.setHash('labourreport');
        },
        runReport: function () {
            var from = $('#labour_report_from').val();
            var to = $('#labour_report_to').val();
            PosnicPro.shiftWidget._lastRange = { from: from, to: to };
            PosnicPro.shiftWidget._lastReport = null;
            $('#labour_report_body').html('<tr><td colspan="7" class="text-center text-muted">Loading…</td></tr>');
            $('#labour_report_foot').html('');
            var url = 'shifts/report?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to);
            PosnicPro.get(url, function (response) {
                PosnicPro.shiftWidget._renderReport(response && response.data);
            }, function () {
                $('#labour_report_body').html('<tr><td colspan="7" class="text-center text-danger">Could not load the report.</td></tr>');
            });
        },
        _renderReport: function (data) {
            PosnicPro.shiftWidget._lastReport = data || null;
            var rows = (data && data.rows) || [];
            var cur = PosnicPro.local.get('currencySign') || '';
            var esc = function (s) {
                return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
                    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
                });
            };
            var num = function (n) { return (Number(n) || 0).toFixed(2); };
            if (!rows.length) {
                $('#labour_report_body').html('<tr><td colspan="7" class="text-center text-muted">No shifts in this range.</td></tr>');
                $('#labour_report_foot').html('');
                return;
            }
            var html = '';
            rows.forEach(function (r) {
                html += '<tr>'
                    + '<td>' + esc(r.user_name || '—')
                    + (r.open_shifts ? ' <span class="badge badge-success">on shift</span>' : '') + '</td>'
                    + '<td class="text-right">' + (r.shifts || 0) + '</td>'
                    + '<td class="text-right">' + (r.scheduled_hours ? num(r.scheduled_hours) : '—') + '</td>'
                    + '<td class="text-right">' + num(r.worked_hours) + '</td>'
                    + '<td class="text-right">' + (r.tips_total ? cur + num(r.tips_total) : '—') + '</td>'
                    + '<td class="text-right">' + (r.hourly_rate ? cur + num(r.hourly_rate) : '—') + '</td>'
                    + '<td class="text-right">' + (r.payout ? cur + num(r.payout) : '—') + '</td>'
                    + '</tr>';
            });
            $('#labour_report_body').html(html);
            var t = (data && data.totals) || {};
            $('#labour_report_foot').html('<tr class="font-weight-bold">'
                + '<td>Total (' + (t.users || 0) + ' staff)</td>'
                + '<td class="text-right">' + (t.shifts || 0) + '</td>'
                + '<td class="text-right">' + (t.scheduled_hours ? num(t.scheduled_hours) : '—') + '</td>'
                + '<td class="text-right">' + num(t.worked_hours) + '</td>'
                + '<td class="text-right">' + (t.tips_total ? cur + num(t.tips_total) : '—') + '</td>'
                + '<td></td>'
                + '<td class="text-right">' + (t.payout ? cur + num(t.payout) : '—') + '</td>'
                + '</tr>');
        },
        // Payroll / timecard export (Phase 7) --------------------------------
        // Payroll CSV: one row per employee for the pay period (hours x wage),
        // exactly the rows the report shows. Timecards CSV: one row per shift,
        // for audit or import into an external payroll provider. Both go
        // through the existing JSONToCSVConvertor download path.
        exportPayroll: function () {
            var data = PosnicPro.shiftWidget._lastReport;
            var rows = (data && data.rows) || [];
            if (!rows.length) {
                PosnicPro.alert('warning', 'Run the report first — there is nothing to export.');
                return;
            }
            var range = PosnicPro.shiftWidget._lastRange || {};
            var out = rows.map(function (r) {
                return {
                    staff: r.user_name || '',
                    shifts: r.shifts || 0,
                    scheduled_hours: Number(r.scheduled_hours) || 0,
                    hours: Number(r.worked_hours) || 0,
                    hourly_rate: Number(r.hourly_rate) || 0,
                    pay: Number(r.payout) || 0,
                    cash_tips_declared: Number(r.tips) || 0,
                    sale_tips: Number(r.sale_tips) || 0,
                    tips_total: Number(r.tips_total) || 0,
                    period_from: range.from || '',
                    period_to: range.to || '',
                };
            });
            PosnicPro.JSONToCSVConvertor(out, 'payroll_' + (range.from || 'all') + '_' + (range.to || 'all'), true);
        },
        exportTimecards: function () {
            var from = $('#labour_report_from').val();
            var to = $('#labour_report_to').val();
            var url = 'shifts/?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to) + '&limit=5000';
            PosnicPro.get(url, function (response) {
                var shifts = (response && response.data) || [];
                if (!shifts.length) {
                    PosnicPro.alert('warning', 'No shifts in this range.');
                    return;
                }
                var fmt = PosnicPro.shiftWidget._fmtDateTime;
                var out = shifts.map(function (s) {
                    return {
                        staff: s.user_name || '',
                        clock_in: fmt(s.clock_in),
                        clock_out: fmt(s.clock_out),
                        break_minutes: Number(s.break_minutes) || 0,
                        hours: Math.round(((Number(s.worked_minutes) || 0) / 60) * 100) / 100,
                        tips: Number(s.tips_declared) || 0,
                        status: s.status || '',
                    };
                });
                PosnicPro.JSONToCSVConvertor(out, 'timecards_' + (from || 'all') + '_' + (to || 'all'), true);
            }, function () {
                PosnicPro.alert('error', 'Could not load shifts for the export.');
            });
        },
        _fmtDateTime: function (v) {
            if (!v) return '';
            var d = new Date(v);
            if (isNaN(d.getTime())) return '';
            var p = function (n) { return ('0' + n).slice(-2); };
            return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
                + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
        },
        // Roster / scheduling (Phase 7) ------------------------------------
        openRoster: function () {
            if (!PosnicPro.shiftWidget._setting('staff_roster_enable', true)) { return; }
            var now = new Date();
            var monday = new Date(now.getTime() - ((now.getDay() + 6) % 7) * 86400000);
            var sunday = new Date(monday.getTime() + 6 * 86400000);
            $('#roster_from').val(PosnicPro.shiftWidget._fmtDate(monday));
            $('#roster_to').val(PosnicPro.shiftWidget._fmtDate(sunday));
            $('#roster_date').val(PosnicPro.shiftWidget._fmtDate(now));
            PosnicPro.shiftWidget._loadRosterUsers();
            $('#shift_modal').modal('hide');
            $('#roster_modal').modal('show');
            PosnicPro.shiftWidget.runRoster();
        },
        _loadRosterUsers: function () {
            PosnicPro.get({ url: 'users', data: { page: 1, limit: 200, filters: '{}' } }, function (res) {
                var list = (res && res.data && (res.data.list || res.data)) || [];
                if (!Array.isArray(list)) { list = []; }
                var esc = function (s) {
                    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
                        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
                    });
                };
                var html = '<option value="">Select staff…</option>';
                list.forEach(function (u) {
                    var id = (u._id && u._id.$oid) || u._id;
                    var name = [u.firstname, u.lastname].filter(Boolean).join(' ') || u.username || u.email || '';
                    if (id && name) { html += '<option value="' + id + '">' + esc(name) + '</option>'; }
                });
                $('#roster_user').html(html);
            }, function () { $('#roster_user').html('<option value="">Could not load staff</option>'); });
        },
        runRoster: function () {
            var from = $('#roster_from').val();
            var to = $('#roster_to').val();
            $('#roster_body').html('<tr><td colspan="6" class="text-center text-muted">Loading…</td></tr>');
            var url = 'shifts/schedule?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to);
            PosnicPro.get(url, function (res) {
                PosnicPro.shiftWidget._renderRoster((res && res.data) || []);
            }, function () {
                $('#roster_body').html('<tr><td colspan="6" class="text-center text-danger">Could not load the roster.</td></tr>');
            });
        },
        _renderRoster: function (entries) {
            var esc = function (s) {
                return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
                    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
                });
            };
            if (!entries.length) {
                $('#roster_body').html('<tr><td colspan="6" class="text-center text-muted">Nothing planned in this range.</td></tr>');
                return;
            }
            var html = '';
            entries.forEach(function (e) {
                var id = (e._id && e._id.$oid) || e._id;
                html += '<tr>'
                    + '<td>' + esc(e.user_name || '—') + '</td>'
                    + '<td>' + esc(e.date) + '</td>'
                    + '<td>' + esc(e.start) + '</td>'
                    + '<td>' + esc(e.end) + '</td>'
                    + '<td class="text-right">' + (Math.round(((Number(e.minutes) || 0) / 60) * 100) / 100).toFixed(2) + '</td>'
                    + '<td class="text-right"><a href="javascript:void(0);" class="text-danger" '
                    + 'onclick="PosnicPro.shiftWidget.deleteRosterEntry(\'' + id + '\');">'
                    + '<i class="feather icon-x"></i></a></td>'
                    + '</tr>';
            });
            $('#roster_body').html(html);
        },
        addRosterEntry: function () {
            var userId = $('#roster_user').val();
            var userName = $('#roster_user option:selected').text();
            if (!userId) { PosnicPro.alert('warning', 'Pick a staff member.'); return; }
            $('#roster_add_btn').prop('disabled', true);
            var done = function () { $('#roster_add_btn').prop('disabled', false); };
            PosnicPro.post({
                url: 'shifts/schedule',
                data: JSON.stringify({
                    user_id: userId,
                    user_name: userName,
                    date: $('#roster_date').val(),
                    start: $('#roster_start').val(),
                    end: $('#roster_end').val(),
                }),
            }, function (r) {
                done();
                PosnicPro.alert(r.type, r.message);
                if (r.type === 'success') { PosnicPro.shiftWidget.runRoster(); }
            }, function () { done(); });
        },
        deleteRosterEntry: function (id) {
            PosnicPro.delete('shifts/schedule/' + id, function (r) {
                PosnicPro.alert(r.type, r.message);
                PosnicPro.shiftWidget.runRoster();
            }, function () {});
        },
    },
    getAllSelectedCollections: function () {
        if (PosnicPro.local.get('usertype') === 'super_admin' || PosnicPro.local.get('usertype') === 'admin') {
            if ($('#checkall').is(':checked', true) || $('.dangerzone').is(':checked', true)) {
                if ($('.dangerzone').is(':checked', true)) {
                    var checkedIds = $(".dangerzone:checked").map(function () {
                        var deleteval = this.className.replace('dangerzone ', '');
                        return deleteval;
                    }).toArray();
                    PosnicPro.deleteAllSelectedRecords(checkedIds);
                } else {
                    $('#checkall').prop('checked', false);
                    PosnicPro.alert('error', 'Selected Row Empty!!.');
                }
            } else {
                PosnicPro.alert('warning', 'Please selected atleast one row!!.');
            }
        } else {
            PosnicPro.alert('warning', 'No accesss to delete Records!!.');
        }
    },
    getSelectedDangerZoneCollection: function (param) {
        if (!$('.delete_single').is('[disabled=disabled]')) {
            if (PosnicPro.local.get('usertype') === 'super_admin') {
                if (PosnicPro.deleteConfirmation) {
                    PosnicPro.callbackRegistry = {};
                    PosnicPro.delete('setting/deleteCollection?collection=' + param, function (response) {
                        var data = response.data;
                        if (data.ok === 1) {
                            $("input[name='chkSelectOneRow']:checkbox").prop('checked', false);
                            $('.dangerzone').closest('tr').removeClass('dangerzoneBgColor');
                            PosnicPro.alert(response.type, response.message);
                        } else {
                            $('#danger_zone').hide();
                            $('#dangetzoneUserverify').show();
                            PosnicPro.alert(response.type, response.message);
                        }
                        PosnicPro.deleteConfirmation = false;
                    });
                } else {
                    PosnicPro.callbackRegistry = {
                        name: 'getSelectedDangerZoneCollection',
                        arguments: param
                    };
                    $('#delete_collection_modal').modal('show');
                }
            } else {
                PosnicPro.alert('error', 'No accesss to delete Records!!.');
            }
        }
    },
    /*------delete selected colletion------*/
    deleteAllSelectedRecords: function (id) {
        if (PosnicPro.deleteConfirmation) {
            PosnicPro.callbackRegistry = {};
            var params = {
                url: 'setting/deleteAllSelectedCollection',
                data: JSON.stringify({ data: id })
            };
            PosnicPro.post(params, function (response) {

                var data = response.data;
                if (data.ok === 1) {
                    $('.dangerzone').prop('checked', false);
                    $("#checkall").prop('checked', false);
                    $('.dangerzone').closest('tr').toggleClass('dangerzoneBgColor', $(this).is(':checked'));
                    PosnicPro.alert(response.type, response.message);
                } else {
                    PosnicPro.alert(response.type, response.message);
                }
                PosnicPro.deleteConfirmation = false;
            });
        } else {
            PosnicPro.callbackRegistry = {
                name: 'deleteAllSelectedRecords',
                arguments: id
            };
            $('#delete_collection_modal').modal('show');
        }
    },
    /*Restore BackUP data*/
   checkAccess: function (module, access_type) {
         if (PosnicPro.userACL[module] && PosnicPro.userACL[module][access_type]) {
            return true;
        }
     return false;
    },
    ACLForModule: function (module) {
        $('[data-module]').filter(function () {
            return $(this).data('module') === module;
        }).each(function (i, e) {
            PosnicPro.ACLApply(this);
        });
    },
    ACLApply: function (element) {
        var access = $(element).data('access');
        var module = $(element).data('module');
        if (!access.match(/(read|write|delete|super|financials)/)) {
            return;
        }

        // The money-health layer (profit, cost, margin, expenses, cash, dues).
        // The owner always sees it - which grandfathers shops from before the
        // flag existed; anyone else needs it granted. Mirrors the server gate.
        if (access.indexOf('financials') !== -1) {
            var usertype = PosnicPro.local.get('usertype');
            var okFin = usertype === 'admin' || usertype === 'super_admin' ||
                PosnicPro.checkAccess(module, 'financials');
            access = okFin ? access.replace('financials', 'true') : access.replace('financials', 'false');
        }

        if (access.indexOf('read') !== -1) {
            access = PosnicPro.checkAccess(module, 'read') ? access.replace("read", "true") : access.replace("read", "false");
        }

        if (access.indexOf('write') !== -1) {
            access = PosnicPro.checkAccess(module, 'write') ? access.replace("write", "true") : access.replace("write", "false");
        }

        if (access.indexOf('delete') !== -1) {
            access = PosnicPro.checkAccess(module, 'delete') ? access.replace("delete", "true") : access.replace("delete", "false");
        }

        if (access.indexOf('super') !== -1) {
            access = PosnicPro.local.get('usertype') === 'super_admin' ? access.replace("super", "true") : access.replace("super", "false");
        }
        if (!eval(access)) {
            $(element).remove();
        }
        if (module in PosnicPro['userACL'] == true) {
            if (PosnicPro.userACL[module][$(element).data('access')] === true) {
                PosnicPro.routes[PosnicPro.routes.length] = module;

            }
        }



    },
    ACLApplyForAll: function () {
        $('[data-module]').each(function () {
            PosnicPro.ACLApply(this);
        });
    },
    redirectPage: function () {
        if (PosnicPro['userACL'].dashboard.read === false) {
            $("#v-pills-dashboard-tab").removeClass("active");
            $("#v-pills-dashboard").removeClass("show active");
            var result = [];
            $.each(PosnicPro.routes, function (i, e) {
                if ($.inArray(e, result) == -1)
                    result.push(e);
            });

            for (var i = 0; i < result.length; i++) {

                if (result[i] === 'item' || result[i] === 'supplier' || result[i] === 'customer' || result[i] === 'user' || result[i] === 'expense' || result[i] === 'receiving') {
                    hasher.setHash(result[i] + 's');
                    return false;
                } else if (result[i] === 'category') {
                    hasher.setHash('categories');
                    return false;
                } else if (result[i] === 'branch') {
                    hasher.setHash('branches');
                    return false;
                } else if (result[i] === 'report') {
                    hasher.setHash('salereport');
                    return false;
                } else {
                    hasher.setHash(result[i]);
                    return false;
                }
            }
        } else {
            let objDay = document.getElementById('btnDashboardCountDay');
            PosnicPro.dashboard.activeInActiveFilterButtons('day', objDay);
        }
    },

    showAddModal: function (page) {
        $(".infobar-settings-sidebar-overlay").css({ "background": "rgba(0,0,0,0.4)", "position": "fixed" });
        $("#infobar-settings-sidebar-" + page).addClass("sidebarshow");
    },

    showEditModal: function (page) {
        $('#osk-container').hide();
    },
    showViewModal: function (page) {
        $('#osk-container').hide();
        /*PopUpModel*/
    },
    HideSideBarModal: function () {
        $(".infobar-settings-sidebar-overlay").css({ "background": "transparent", "position": "initial" });
        $(".infobar-settings-sidebar").removeClass("sidebarshow sidebarview");
    },
    /*This function call From sales receiving page for Add new Item & customer */
    getAddNewPage: function (getId) {
        $('#' + getId).modal('show');
    },
    /*
     * Which receipt layout to print.
     *
     * Prefers the select on the settings page when it happens to be in the
     * document, then the stored preference, then a sane default. Never touches
     * the bare global, because that only exists on three pages and none of them
     * is the one people print from.
     */
    resolvePrintType: function () {
        if (typeof print_type !== 'undefined' && print_type && print_type.value) {
            return print_type.value;
        }
        var stored = PosnicPro.local && typeof PosnicPro.local.get === 'function'
            ? PosnicPro.local.get('print_type')
            : null;
        return stored || 'standard';
    },

    /*
     * How wide the paper actually is.
     *
     * The receipt used to be printed with `@page { size: auto }`, which hands
     * the decision to the Windows driver. A shop running a 58mm printer whose
     * driver is set to 80mm gets every line cut off on the right, and nothing
     * in the app could correct it - the only "size" setting we had changes the
     * font, not the paper.
     *
     * Thermal rolls are sold as 58mm and 80mm, so that is the vocabulary here
     * rather than small and large. Widths are the printable area, a little
     * under the roll width, because the head does not reach the edge.
     */
    /*
     * Paper, and the type size that fits on it.
     *
     * The receipt stylesheet sets body { font-size: 32px !important }. At 80mm
     * - about 287 CSS pixels - that is roughly nine characters on a line, so
     * the amount column had nowhere to go and printed off the right edge. The
     * sizes below are chosen so a line holds about 32 characters, which is what
     * a receipt needs for a name, a quantity and an amount.
     */
    /*
     * Paper, and the type size that fits on it.
     *
     * The printable width is not the roll width. A print head covers a fixed
     * number of dots and the rest of the roll is margin the printer cannot
     * reach:
     *
     *   80mm roll  576 dots at 203dpi = 72.06mm
     *   58mm roll  384 dots at 203dpi = 48.04mm
     *
     * Laying out to the roll width instead of the head width is what clipped
     * the last few characters of the amount column - the page was four
     * millimetres wider than anything could be printed on.
     */
    PAPER: {
        '58': { css: '58mm', content: '48mm', label: '58mm roll', font: 10, small: 9 },
        '80': { css: '80mm', content: '72mm', label: '80mm roll', font: 12, small: 10 },
        'a4': { css: 'A4', content: 'auto', label: 'A4 sheet', font: 13, small: 11 }
    },

    resolvePaperWidth: function () {
        var stored = PosnicPro.local && typeof PosnicPro.local.get === 'function'
            ? PosnicPro.local.get('print_width')
            : null;
        if (stored && PosnicPro.PAPER[stored]) return stored;

        // Nothing chosen yet: fall back to what the old two-way setting implied,
        // so an existing shop keeps printing exactly as it did today.
        return PosnicPro.resolvePrintType() === 'a4' ? 'a4' : '80';
    },

    /*
     * The printer chosen for receipts, or nothing to mean the Windows default.
     *
     * Stored locally rather than in the shop settings on purpose: two tills in
     * the same shop have different printers attached, and a setting that
     * synced would have them fighting over one name.
     */
    resolveReceiptPrinter: function () {
        var name = PosnicPro.local && typeof PosnicPro.local.get === 'function'
            ? PosnicPro.local.get('receipt_printer')
            : null;
        return name && name !== 'default' ? name : null;
    },

    /*
     * Bring the machine's printer settings into this window.
     *
     * They are set in Hardware Manager, which is a different origin and so has
     * a different localStorage. The shared copy lives in preferences, a file
     * the main process owns. It is mirrored into localStorage here because the
     * print path is synchronous and cannot await a value in the middle of
     * building a receipt.
     *
     * Called at startup and again after printing, so a change made in Hardware
     * Manager while the till is open takes effect on the next sale rather than
     * after a restart.
     */
    /*
     * Show or hide everything that only makes sense with table service.
     *
     * A grocery has no tables. Leaving "Tables List" in Config, and a KOT tab
     * in the Hardware Manager, for a shop that will never use them is a
     * setting somebody has to read, decide about and ignore - every time they
     * go looking for something else.
     *
     * Called from three places: at startup, when settings load, and the moment
     * the switch is saved, so turning KOT on does not need a restart.
     */
    /*
     * Main-sidebar entries follow Module On/Off (the Config nav already
     * does via applyModuleNav). Runs at page load and after a modules save.
     */
    applyModuleSidebar: function () {
        var s = {};
        try { s = JSON.parse(PosnicPro.local.get('general_settings') || '{}'); } catch (e) { /* defaults */ }
        var on = function (k) { return s[k] !== false; };
        $('#viewkioskreport_page').closest('li')
            .toggle(on('module_channels_enable') && on('module_channels_kiosk_enable'));
        $('#viewkotreport_page').closest('li')
            .toggle(PosnicPro.local.get('table_options') === 'enable');

        /*
         * Themes module, applied in REAL TIME: off hides the header theme
         * button and the shop drops to the default look immediately. The
         * saved choice is never wiped (applyTheme, not applyPreset), so
         * switching back on restores it just as immediately.
         */
        var themesOn = on('module_themes_enable');
        $('.themebar').closest('li').toggle(themesOn);
        var tm = PosnicPro.themeManager;
        if (tm && tm.applyTheme) {
            if (!themesOn && !PosnicPro._themeSuppressed) {
                PosnicPro._themeSuppressed = true;
                tm.applyTheme({ preset: 'github', overrides: {} });
            } else if (themesOn && PosnicPro._themeSuppressed) {
                PosnicPro._themeSuppressed = false;
                var saved = tm.getFromLocal && tm.getFromLocal();
                if (saved) { tm.applyTheme(saved); }
            }
        }
    },
    applyKotVisibility: function (enabled) {
        $('#v-pills-tableorder-tab').toggle(!!enabled);
        PosnicPro.applyModuleSidebar();

        /*
         * The Hardware Manager is a separate window with its own storage, so
         * it cannot read this setting directly. Mirroring it through the
         * per-machine preferences is the route the receipt printer already
         * takes.
         */
        if (window.electronAPI && window.electronAPI.preferences) {
            window.electronAPI.preferences.set('kot.enabled', !!enabled);
        }
    },

    syncPrinterPreferences: function () {
        if (!window.electronAPI || !window.electronAPI.preferences) {
            return Promise.resolve(false);
        }
        return Promise.all([
            window.electronAPI.preferences.get('receipt_printer'),
            window.electronAPI.preferences.get('print_width')
        ]).then(function (values) {
            if (values[0]) PosnicPro.local.set('receipt_printer', values[0]);
            if (values[1]) PosnicPro.local.set('print_width', values[1]);
            return true;
        }).catch(function (e) {
            // Printing still works off whatever was mirrored last time.
            console.warn('[print] could not read machine settings:', e);
            return false;
        });
    },

    /* The @page rule and the width the receipt body is held to. */
    paperCss: function () {
        var paper = PosnicPro.PAPER[PosnicPro.resolvePaperWidth()] || PosnicPro.PAPER['80'];

        if (paper.content === 'auto') {
            return '@page { size: ' + paper.css + '; margin: 8mm; }';
        }

        /*
         * Everything here is !important because the receipt stylesheet it has
         * to sit on top of uses !important throughout, including the 32px body
         * size that caused the overflow. Specificity alone would lose.
         *
         * Columns are given explicit widths rather than left to the browser:
         * with table-layout auto a long item name takes the space the amount
         * needs, which is the one column that must never be clipped.
         */
        return [
            '@page { size: ' + paper.css + ' auto; margin: 0; }',
            'html { font-size: ' + paper.font + 'px !important; }',
            'body {',
            '  width: ' + paper.content + ' !important;',
            '  max-width: ' + paper.content + ' !important;',
            '  margin: 0 !important; padding: 0 !important;',
            '  font-size: ' + paper.font + 'px !important;',
            '  line-height: 1.35 !important;',
            '  font-family: "Segoe UI", Arial, sans-serif !important;',
            '  color: #000 !important;',
            '}',
            '* { box-sizing: border-box !important; }',
            // Nothing may be wider than the roll, whatever it was styled as.
            'div, p, table, tr, td, th, img, h1, h2, h3, h4, h5, h6 {',
            '  max-width: ' + paper.content + ' !important;',
            '}',
            /*
             * Undo the Bootstrap grid geometry, keep its proportions.
             *
             * A receipt line is built as a grid row - name in col-xs-5, qty in
             * col-xs-3, amount in col-xs-4 - and the print stylesheet carries
             * Bootstrap's rules with it:
             *
             *   .row      margin-left/right: -15px
             *   .col-xs-* padding-left/right: 15px
             *
             * On a 76mm roll, about 287 pixels, the negative margins push 30px
             * of every row off the paper, which is where the right-hand side of
             * the amount column went. The padding then takes 30px from each of
             * three columns, leaving under 200px of the 287 for text, so lines
             * wrap and the receipt runs to several pages.
             *
             * The percentage widths and the floats are kept, because they are
             * what puts the three columns side by side. Only the spacing built
             * for a 1200px browser window is removed.
             */
            '.row { margin-left: 0 !important; margin-right: 0 !important; }',
            '[class*="col-"] { padding-left: 0 !important; padding-right: 0 !important; }',
            // Floated columns leave the row with no height of its own, so the
            // next line overlaps it.
            '.row::after { content: "" !important; display: table !important; clear: both !important; }',
            // The container itself may carry the same negative margins.
            '#receipt_wrapper, .print-modal-body, .modal-body {',
            '  margin: 0 !important; padding: 0 !important; width: 100% !important;',
            '}',
            'table { width: 100% !important; table-layout: fixed !important; border-collapse: collapse !important; }',
            'td, th {',
            '  font-size: ' + paper.font + 'px !important;',
            '  padding: 1px 0 !important;',
            '  word-wrap: break-word !important; overflow-wrap: break-word !important;',
            '}',
            // The money column: never wrapped, never clipped, always hard right.
            'td:last-child, th:last-child { text-align: right !important; white-space: nowrap !important; }',
            'td:first-child, th:first-child { text-align: left !important; }',
            '.text-center, .text-center * { text-align: center !important; }',
            'small, .small, .font_size10, .font_size11 { font-size: ' + paper.small + 'px !important; }',
            // A logo wider than the roll pushes the whole layout across.
            'img { max-width: ' + paper.content + ' !important; height: auto !important; }'
        ].join('\n');
    },

    /*
     * A sample receipt on the paper that is actually loaded.
     *
     * Choosing a width and finding out it was wrong at the till, in front of a
     * customer, is the expensive way to learn. The strip below deliberately
     * carries the widest things a real receipt contains - a long item name, an
     * amount column pushed to the right edge, and a full-width rule - because
     * those are what reveal a width that is one size out.
     */
    printTest: function () {
        var width = PosnicPro.resolvePaperWidth();
        var paper = PosnicPro.PAPER[width] || PosnicPro.PAPER['80'];
        var now = new Date();

        var rows = [
            ['Rice 5kg premium sona masoori', '1', '480.00'],
            ['Sugar 1kg', '2', '90.00'],
            ['Cooking oil 1L pouch', '1', '145.00']
        ].map(function (r) {
            return '<tr><td style="text-align:left;">' + r[0] + '</td>' +
                '<td style="text-align:center;">' + r[1] + '</td>' +
                '<td style="text-align:right;">' + r[2] + '</td></tr>';
        }).join('');

        var html =
            '<div style="text-align:center;font-weight:bold;">TEST RECEIPT</div>' +
            '<div style="text-align:center;font-size:11px;">' + paper.label + '</div>' +
            '<div style="text-align:center;font-size:11px;">' + now.toLocaleString() + '</div>' +
            '<div style="border-top:1px dashed #000;margin:6px 0;"></div>' +
            '<table style="width:100%;border-collapse:collapse;">' +
            '<tr><th style="text-align:left;">Item</th><th style="text-align:center;">Qty</th>' +
            '<th style="text-align:right;">Amount</th></tr>' + rows +
            '</table>' +
            '<div style="border-top:1px dashed #000;margin:6px 0;"></div>' +
            '<table style="width:100%;"><tr><td style="text-align:left;font-weight:bold;">TOTAL</td>' +
            '<td style="text-align:right;font-weight:bold;">805.00</td></tr></table>' +
            '<div style="border-top:1px solid #000;margin:6px 0;"></div>' +
            '<div style="font-size:10px;text-align:center;">' +
            'If any line above is cut off on the right, choose a narrower paper width.' +
            '</div>' +
            '<div style="text-align:center;font-size:11px;margin-top:6px;">' +
            '1234567890 ABCDEFGHIJKLMNOPQRSTUVWXYZ</div>';

        PosnicPro.printView(html);
    },

    /*
     * Where the app goes once a receipt has printed.
     *
     * A till that has just printed should be ready for the next sale, not
     * sitting on the one that finished. Both desktop print paths need this, so
     * it lives here rather than being written twice and drifting.
     */
    afterPrint: function () {
        setTimeout(function () {
            var parts = currentHash.split('/');
            var page = parts[0] + '/' + parts[1];
            if (page === 'sales/new' || page === 'receivings/new') {
                hasher.setHash(page);
            } else {
                hasher.setHash(parts[0]);
            }
            if (page === 'sales/new') {
                $("#infobar-settings-sidebar-tender-details").addClass("sidebarview");
            }
        }, 800);
    },

    /*
     * Print a thermal receipt as ESC/POS.
     *
     * The sale is read back out of the receipt markup rather than passed in,
     * because all seventeen callers of printView already produce that markup
     * and it carries the shop's print settings with it - anything switched off
     * in Config was already removed before the HTML was taken. See
     * receipt-data.js.
     *
     * Returns false if it cannot handle this receipt, in which case printView
     * carries on down the HTML path. A receipt has to come out either way.
     */
    printReceiptRaw: function (contents) {
        /*
         * The two paper settings can disagree - an older shop has a print type
         * but no width, and either can be edited alone. ESC/POS is for rolls,
         * so if the width says A4 the page path handles it whatever the type
         * says.
         */
        var width = PosnicPro.resolvePaperWidth();
        if (width === 'a4') return false;

        var sale;
        try {
            sale = PosnicPro.receiptData(contents);
        } catch (e) {
            console.warn('[Print] could not read the receipt, falling back to HTML:', e.message);
            return false;
        }

        /*
         * A receipt with no items is not a receipt.
         *
         * If the shop's template is ever edited into a shape the extractor
         * does not recognise it would come back empty, and printing that would
         * waste paper and hide the fault. The HTML path still works, so a sale
         * never fails to print because of this.
         */
        if (!sale.items.length) {
            console.warn('[Print] no items found in the receipt; falling back to HTML');
            return false;
        }

        /*
         * Raw printing needs a printer by name.
         *
         * The page path could pass nothing and let Windows use its default,
         * but bytes have to be addressed to a queue. Every shop running today
         * predates the Receipt Printer setting and so has not chosen one, and
         * refusing to print until they do would break their till on upgrade -
         * so ask Windows what its default is and use that, which is the
         * printer they have been printing to all along.
         */
        Promise.resolve(PosnicPro.resolveReceiptPrinter())
        .then(function (chosen) {
            return chosen || window.electronAPI.printer.getDefault();
        })
        .then(function (printerName) {
            // getDefault answers with the printer object, not its name.
            if (printerName && typeof printerName === 'object') {
                printerName = printerName.name || null;
            }
            if (!printerName) {
                throw new Error('No printer found. Choose one in Hardware Manager, Receipt Printer.');
            }
            // Auto-open the cash drawer on a sale if the shop enabled it in
            // Hardware Manager ("Auto-open on every sale"). The main process
            // already emits the ESC/POS drawer pulse when openDrawer is passed
            // (escpos-receipt). Fail-safe: any error reading the drawer config
            // simply prints without opening, so a sale never fails on this.
            var drawerCfg = (window.electronAPI.cashDrawer && window.electronAPI.cashDrawer.loadConfig)
                ? Promise.resolve(window.electronAPI.cashDrawer.loadConfig()).catch(function () { return null; })
                : Promise.resolve(null);
            return drawerCfg.then(function (cfg) {
                var opts = {
                    printerName: printerName,
                    paperWidth: width,
                    docName: 'Receipt ' + (sale.billNo || '')
                };
                if (cfg && cfg.autoOpenOnSale) {
                    opts.openDrawer = true;
                    opts.drawerPin = (cfg.pin != null) ? cfg.pin : 0;
                }
                return window.electronAPI.printer.printReceipt(sale, opts);
            });
        })
        .then(function (result) {
            if (result && result.success) {
                PosnicPro.afterPrint();
            } else {
                PosnicPro.alert('error', (result && result.error) ? result.error : 'Print failed');
            }
        })
        .catch(function (err) {
            PosnicPro.alert('error', (err && err.message) ? err.message : 'Print failed');
        });

        return true;
    },

    printView: function (contents, image) {
        // Electron: silent print via ipc (window.electronAPI.printer.print)
        if (navigator.userAgent.indexOf('Electron') !== -1 && window.electronAPI && window.electronAPI.printer && window.electronAPI.printer.print) {
            // print_type is a select that only exists on the settings page, the
            // branch modal and the SSO page. Reading it bare threw a TypeError
            // the moment anyone printed from a sale, which is every till, every
            // day - and because the throw happened before the promise chain,
            // there was no catch and no message: pressing Print did nothing at
            // all. The browser path below already guarded this; the desktop
            // path, the one that actually runs on a till, did not.
            var data = PosnicPro.resolvePrintType();

            /*
             * Thermal receipts go as ESC/POS; A4 still goes as a page.
             *
             * Printing HTML works in a browser because the print dialog scales
             * the page to fit the paper. A silent print has no dialog, so
             * nothing scales anything, and a receipt laid out in a 700px-wide
             * grid arrived across three pages with the right-hand column off
             * the edge - the amounts, which are the part that matters.
             *
             * ESC/POS removes the question. The paper is 48 characters wide at
             * 80mm and 32 at 58mm, a line either fits or it does not, and that
             * is decided here rather than by a driver. A4 keeps the HTML path:
             * it is a real page, the layout is a page layout, and it prints
             * correctly today.
             */
            if (data !== 'a4' && window.electronAPI.printer.printReceipt && PosnicPro.receiptData
                && PosnicPro.printReceiptRaw(contents)) {
                return;
            }

            let printUrl = PosnicPro.local.get('print_url');
            // margin-top on the body pushes the first line down the roll and is
            // wasted paper on a receipt; the page rule below owns the margins.
            var html = '<html><head><title>.</title></head><body>';
            if (data === 'a4') {
            html += '<link href="' + PosnicPro.baseUrl + 'static/pages/a4print.css" rel="stylesheet" type="text/css" onload="console.log(\'A4 CSS loaded\')" />';
            } else {
            /*
             * print.css, the same sheet the browser has always used.
             *
             * This asked for silentprint.css, which carries the Bootstrap
             * scaffolding but almost none of the receipt design: 86 rules
             * style #receipt_wrapper in print.css and none of them are in
             * silentprint.css, along with the whole payment block. The desktop
             * app was therefore printing the receipt with its layout but
             * without its design, which is why it never resembled what the
             * browser produces.
             *
             * It is 173KB against 11KB, read from local disk. That is not a
             * cost worth a receipt that looks wrong.
             */
            html += '<link href="' + PosnicPro.baseUrl + 'static/pages/print.css" rel="stylesheet" type="text/css" onload="console.log(\'Print CSS loaded\')" />';
            }
            html += '<style type="text/css" media="print">' + PosnicPro.paperCss() + '</style>';
            html += contents;
            html += '<div class="col-md-12 col-sm-12 col-xs-12"><div class="invoice-policy" style="text-align:center;">';
            if (image) {
            html += '<img style="display:inline-block;" src="' + image + '">';
            }
            if (printUrl === 'true') {
            html += '<div style="margin-top:4px;">https://www.posnic.com</div>';
            }
            html += '</div></div>';
            html += '</body></html>';
            
            // Wait a moment for CSS to load before printing
            setTimeout(function() {
                /*
                 * Which printer gets the receipt.
                 *
                 * This asked for `printer.getDefaultName`, which does not exist
                 * on the bridge - it is `getDefault` - and then passed the
                 * function itself rather than calling it. Both mistakes landed
                 * on the same result: printerName was never a name, so every
                 * receipt went to whatever Windows had set as default, and a
                 * shop with a thermal printer beside an A4 one had no way to
                 * say which was which.
                 */
                Promise.resolve(PosnicPro.resolveReceiptPrinter())
                .then(function (printerName) {
                    return window.electronAPI.printer.print(html, {
                    // undefined, not null: the main process treats undefined as
                    // "use the system default", where null is a bad argument.
                    printerName: printerName || undefined,
                    forceHtml: true,
                    silent: true,
                    printBackground: true,
                    margins: { marginType: 'none' }
                    });
                })
                .then(function (result) {
                    if (result && result.success) {
                    PosnicPro.afterPrint();
                    } else {
                    PosnicPro.alert('error', (result && result.error) ? result.error : 'Print failed');
                    }
                })
                .catch(function (err) {
                    PosnicPro.alert('error', (err && err.message) ? err.message : 'Print failed');
                });
            }, 200); // Wait 200ms for CSS to load
            return;
        }
        
            // Web: existing iframe print
        var data = PosnicPro.resolvePrintType();

        var frame1 = $('<iframe />');
        frame1[0].name = "frame1";
        frame1.css({
            "position": "absolute",
            "top": "-1000000px"
        });
        let printUrlConfig = PosnicPro.local.get('print_url');
        let url = ((printUrlConfig === 'true') ? '<div style="text-align:center;">https://www.posnic.com</div>' : '');
        $("body").append(frame1);
        var frameDoc = frame1[0].contentWindow ? frame1[0].contentWindow : frame1[0].contentDocument.document ? frame1[0].contentDocument.document : frame1[0].contentDocument;
        frameDoc.document.open();
        //Create a new HTML document.
        frameDoc.document.write('<html><head><title>.</title>');
        frameDoc.document.write('</head><body style="margin-top:15px;">');
        //Append the external CSS file.
        if (data === 'a4') {
            frameDoc.document.write('<link href="' + (PosnicPro.baseUrl || '') + 'static/pages/a4print.css" rel="stylesheet" type="text/css" onload="console.log(\'Web A4 CSS loaded\')" />');
        } else {
            frameDoc.document.write('<link href="' + (PosnicPro.baseUrl || '') + 'static/pages/print.css" rel="stylesheet" type="text/css" onload="console.log(\'Web Print CSS loaded\')" />');
        }
        frameDoc.document.write('<style type="text/css" media="print">' + PosnicPro.paperCss() + '</style>');
        frameDoc.document.write(contents);

        // Center barcode image and, if enabled, the URL in the print footer
        frameDoc.document.write('<div class="col-md-12 col-sm-12 col-xs-12"><div class="invoice-policy" style="text-align:center;">');
        if (image) {
            frameDoc.document.write('<img style="display:inline-block;" src="' + image + '">');
        }
        if (printUrlConfig === 'true') {
            frameDoc.document.write('<div style="margin-top:4px;">https://www.posnic.com</div>');
        }
        frameDoc.document.write('</div></div>');

        frameDoc.document.write('</body></html>');
        frameDoc.document.close();

        // Trigger browser print for the hidden iframe. Use a short
        // timeout so the browser has time to layout the contents.
        var frameWindow = frame1[0].contentWindow || (frame1[0].contentDocument && frame1[0].contentDocument.defaultView);
        if (frameWindow && typeof frameWindow.print === 'function') {
            setTimeout(function () {
                try {
                    frameWindow.focus();
                    frameWindow.print();
                } catch (e) {
                    // If print() fails, we silently ignore here so that
                    // navigation logic below still runs.
                }
            }, 500);

            // Best-effort cleanup after printing.
            frameWindow.onafterprint = function () {
                try {
                    $(frame1).remove();
                } catch (e) {
                    // ignore cleanup errors
                }
            };
        }

        setTimeout(function () {
            var parts = currentHash.split('/');
            if (parts[0] + '/' + parts[1] === 'sales/new' || parts[0] + '/' + parts[1] === 'receivings/new') {
                var url = parts[0] + '/' + parts[1];
                hasher.setHash(url);
            } else {
                hasher.setHash(parts[0]);
            }
            if (parts[0] + '/' + parts[1] === 'sales/new') {
                $("#infobar-settings-sidebar-tender-details").addClass("sidebarview");
            }
        }, 800);

    },
    printBarcode: function () {
        var value = $("#barcodeValue").val();
        var btype = "code128";
        var renderer = "canvas";
        var settings = {
            output: renderer,
            barWidth: $("#barWidth").val(),
            barHeight: $("#barHeight").val()
        };
        if (renderer === 'canvas') {
            clearCanvas();
            $("#barcodeTarget").hide();
            $("#canvasTarget").show().barcode(value, btype, settings);
        } else {
            $("#canvasTarget").hide();
            $("#barcodeTarget").html("").show().barcode(value, btype, settings);
        }

        function clearCanvas() {
            var canvas = $('#canvasTarget').get(0);
            var ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
    },
    commonDate: function () {
        let timeZone = PosnicPro.local.get('timezone');
        let dateTime = new Date();
        let currentDateTimeCentralTimeZone = moment(dateTime).tz(timeZone).format('YYYY/MM/DD hh:mm A');
        let currentDate = new Date(currentDateTimeCentralTimeZone);
        currentDate.toLocaleString('en', { timeZone: timeZone });
        $('.commonDate').datepicker({
            language: 'en',
            dateFormat: 'yyyy/mm/dd',
            maxDate: currentDate,
            startDate: new Date(new Date().toLocaleString('en', { timeZone: timeZone })),
            timeFormat: 'h:ii AA',
            timepicker: true,
            autoClose: false,
            dateTimeSeparator: ' ',
            todayButton: new Date(new Date().toLocaleString('en', { timeZone: timeZone })),
            toggleSelected: false,
            onShow: function () {
                var currentDate = currentDate = new Date();
                var jsDate = $('#time-format').val();
                if (currentDate.getDate() !== moment(jsDate).format('DD')) {
                    $('#time-format').data('datepicker').selectDate(new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate(), currentDate.getHours(), currentDate.getMinutes(), currentDate.getSeconds()));
                }
            }
        });
        $('.commonDate').click(function () {
            $(".datepicker").show();
            var currentDate = new Date();
            var jsDate = $('#time-format').val();
            if (currentDate.getDate() !== moment(jsDate).format('DD')) {
                $('#time-format').data('datepicker').selectDate(new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate(), currentDate.getHours(), currentDate.getMinutes(), currentDate.getSeconds()));
            }
        });

        $('.field:last-child').remove();
        var r = $('<input/>').attr({
            type: "button",
            class: "field",
            value: "OK",
            onclick: "PosnicPro.okButtonClickListener()"
        });
        $(".datepicker").append(r);
        $('.field').css({
            'margin-left': '210px',
            'border-radius': '4px',
            'color': '#4EB5E6',
            'display': 'inline-flex',
            'justify-content': 'center',
            'align-items': 'center',
            'height': '25px',
            'cursor': 'pointer',
            'border': 'none',
            'background-color': '#fff',
            'font-weight': '350'
        });
        $('.field').mouseenter(function () {
            $('.field').css({ 'background-color': '#E7E7E7', 'color': '#4A4A4A' });
        });
        $('.field').mouseleave(function () {
            $('.field').css({ 'background-color': '#fff', 'color': '#4EB5E6' });
        });
        $(".commonDate").val(currentDateTimeCentralTimeZone);
    },

    okButtonClickListener: function () {
        $(".datepicker").hide();
    },

    commonEditDate: function (date) {
        $('#receiving_add_date,#time-format,#expenses_date').removeClass('commonDate');
        $('#receiving_add_date,#time-format,#expenses_date').addClass('commonEditDate');
        var currentDateTimeCentralTimeZone = moment(date).format('YYYY/MM/DD hh:mm A');

        var timeZone = PosnicPro.local.get('timezone');
        $('.commonEditDate').datepicker({
            language: 'en',
            dateFormat: 'yyyy/mm/dd',
            startDate: new Date(new Date().toLocaleString('en', { timeZone: timeZone })),
            timeFormat: 'h:ii AA',
            timepicker: true,
            dateTimeSeparator: ' ',
            autoClose: true,
            todayButton: new Date(new Date().toLocaleString('en', { timeZone: timeZone })),
            toggleSelected: false,
            onSelect: function (selectedDate, selectedtime, inst) {
                $(inst.el).trigger('change');
            }
        });

        $("#receiving_add_date,#time-format,#expenses_date").val(currentDateTimeCentralTimeZone);
    },

    convertDate: function (date) {
        
        var dateformatsets = PosnicPro.local.get("dateformatset");
        var formatData = '';
        if (dateformatsets === "yyyy/mm/dd") {
            formatData = "YYYY/MM/DD";
        } else if (dateformatsets === "mm/dd/yyyy") {
            formatData = "MM/DD/YYYY";
        } else if (dateformatsets === "D mm/dd") {
            formatData = "ddd MM/DD";
        } else if (dateformatsets === "MM dd yyyy") {
            formatData = "MMMM DD YYYY";
        } else if (dateformatsets === "d MM yy") {
            formatData = "DD MMMM YY";
        } else if (dateformatsets === "dd/mm/yyyy") {
            formatData = "DD/MM/YYYY";
        } else {
            formatData = "ddd DD MMMM YY";
        }
        /*
         * Parse with the shapes we actually receive, not moment's guesser.
         * A bare moment(string) on a non-ISO value logs the RFC2822
         * deprecation warning - once per rendered date, thousands per
         * session on the lists. Known formats first; anything else goes
         * through Date, which is exactly where moment's fallback ended up
         * anyway, minus the console noise.
         */
        var m = (date instanceof Date || typeof date === 'number')
            ? moment(date)
            : moment(date, [
                moment.ISO_8601,
                'YYYY/MM/DD hh:mm A',
                'YYYY/MM/DD',
                'YYYY-MM-DD HH:mm:ss',
                'DD/MM/YYYY',
                'MM/DD/YYYY',
            ], false);
        if (!m.isValid()) m = moment(new Date(date));
        return (PosnicPro.local.get('timeformat') === 'enable') ? m.format(formatData + " " + "LT") : m.format(formatData);
    },
    convertFormatDateTime: function () {
        var dateformatsets = PosnicPro.local.get("dateformatset");
        var formatData = '';
        if (dateformatsets === "yyyy/mm/dd") {
            formatData = "YYYY/MM/DD";
        } else if (dateformatsets === "mm/dd/yyyy") {
            formatData = "MM/DD/YYYY";
        } else if (dateformatsets === "D mm/dd") {
            formatData = "ddd MM/DD";
        } else if (dateformatsets === "MM dd yyyy") {
            formatData = "MMMM DD YYYY";
        } else if (dateformatsets === "d MM yy") {
            formatData = "DD MMMM YY";
        } else if (dateformatsets === "dd/mm/yyyy") {
            formatData = "DD/MM/YYYY";
        } else {
            formatData = "ddd DD MMMM YY";
        }
        return formatData;
    },

    imageReadURL: function (input, collectionName, width, height) {
        var fileSize = input.files[0].size;
        if (fileSize < 5242880) {
            var validExtensions = ['gif', 'jpg', 'png', 'jpeg', 'bmp'];
            var fileName = input.files[0].name;
            var fileNameExt = fileName.substr(fileName.lastIndexOf('.') + 1);
            if ($.inArray(fileNameExt, validExtensions) === -1) {
                input.type = '';
                input.type = 'file';
                PosnicPro.alert('error', "Only these file types are accepted : " + validExtensions.join(', '));
            } else {
                if (input.files && input.files[0]) {
                    var reader = new FileReader();
                    reader.onload = function (e) {
                        $('#' + collectionName + '_logo').val(fileName);
                        $('#' + collectionName + '_image_upload')
                            .attr('src', e.target.result)
                            .width(width)
                            .height(height);
                    };
                    reader.readAsDataURL(input.files[0]);
                }
            }
        } else {
            PosnicPro.alert('error', "size should be less than 5MB !");
        }
    },

    resetForm: function (input) {
        var id = (input === 'sale') ? $('#sales_new_items_table tbody tr').find(':nth-child(8)').text() : $('#receiving_print tbody tr').find(':nth-child(6)').text();
        if (id !== '') {
            $('#reset_modal').modal('show');
            if (input === 'sale') {
                $('#resetReceivingButton').hide();
                $('#resetSaleButton').show();
                $('#resetHeading').html('Sale');
            } else {
                $('#resetSaleButton').hide();
                $('#resetReceivingButton').show();
                $('#resetHeading').html('Receiving');
            }
        }
    },

    deleteTableData: function (selectedTableRow, table) {
        // Fallback for Sales History: if the internal selection array is empty,
        // recompute the selected rows directly from the DOM so delete still works.
        if ((!selectedTableRow || selectedTableRow.length === 0) && table === 'sales') {
            selectedTableRow = [];
            $('#view_sales').find('tbody .sales-row-id:checked').each(function () {
                selectedTableRow.push($(this).val());
            });

            // Keep Sales module selection state and the bottom counter in sync.
            if (selectedTableRow.length > 0) {
                PosnicPro.sales_checkbox = selectedTableRow.slice(0);
                $('.showing-hide-show-sales').show();
                $('.showing-value-sales').html(selectedTableRow.length);
            }
        }

        if (selectedTableRow && selectedTableRow.length > 0) {
            $('.deleteCountValue').html(selectedTableRow.length);
            PosnicPro.deleteTableSelectedRowData(selectedTableRow, table);
        } else {
            PosnicPro.alert('warning', 'Select must atleast one row!!.');
        }
    },

    appendReportTableBody: function (report) {

        var TableBody = {
            'salesreport': '<tr><th>#</th><th>Id</th><th>Date</th><th class="text-center">Customer</th><th class="text-center">Customer Phone</th><th class="text-center">No.of Item</th><th class="text-right">Subtotal</th><th class="text-right">Tax</th><th class="text-right">Discount</th><th class="text-right">Price</th></tr>',
            'tax': '<tr><th>#</th><th>Id</th><th>Date</th><th class="text-right">GST</th><th class="text-right">Tax[%]</th><th>Tax Description</th><th class="text-right">Sub Total</th><th class="text-right">Price</th></tr>',
            'receivingreport': '<tr><th></th><th>#</th><th>Id</th><th>Date</th><th>Supplier</th><th class="text-right">Supplier Phone</th><th class="text-center">Total Item</th><th class="text-right">Total</th></tr>',
            'salesitemreport': '<tr><th></th><th>#</th><th>Id</th><th>Date</th><th>Customer</th><th class="text-center">Total Item</th><th class="text-right">Price</th></tr>',
            'receivingitemreport': '<tr><th>#</th><th>Id</th><th>Date</th><th>Supplier</th><th class="text-center">Total Item</th><th class="text-right">Price</th></tr>',
            'itemreport': '<tr><th>#</th><th>Name</th><th class="text-center">Total no. of item sold</th><th class="text-center">No. of sale</th><th class="text-right">Profit</th><th class="text-right">Avg.sale</th><th class="text-right">Total sale</th></tr>',
            'itemexpiry': '<tr><th>#</th><th>Item Name</th><th>Category</th><th>SKU</th><th>Expiry Date</th><th class="text-right">Quantity</th><th class="text-right">Company Price</th><th class="text-right">Total Amount</th></tr>',
            'categoryreport': '<tr><th>#</th><th>Name</th><th class="text-center">Total no. of item sold</th><th class="text-right">Profit</th><th class="text-right">Avg.sale</th><th class="text-right">Total sale</th></tr>',
            'customerreport': '<tr><th>#</th><th>Name</th><th>Phone</th><th class="text-center">No. of purchase</th><th class="text-right">Return</th><th class="text-right">Avg.Purchase</th><th class="text-right">Total purchase</th></tr>',
            'supplierreport': '<tr><th>#</th><th>Name</th><th>Phone</th><th class="text-center">No. of sale</th><th class="text-right">Avg.sale</th><th class="text-right">Total sale</th></tr>',
            'userreport': '<tr><th>#</th><th>Name</th><th class="text-center">No. of sale</th><th class="text-right">Return</th><th class="text-right">Profit</th><th class="text-right">Avg.Sale</th><th class="text-right">Total sale</th></tr>',
            'paymentsalesreport': '<tr><th>#</th><th>Id</th><th>Date</th><th>Customer</th><th>Payment Mode</th><th>Payment Note</th><th class="text-right">Price</th></tr>',
            'paymentreceivingreport': '<tr><th>#</th><th>Id</th><th>Date</th><th>Supplier</th><th>Payment Mode</th><th>Payment Note</th><th class="text-right">Price</th></tr>',
            'taxsalesreport': '<tr><th>#</th><th>Tax Name</th><th class="text-right">Amount</th></tr>',
            'registerreport': '<tr><th>#</th><th>Name</th><th>Time opened</th><th>Time closed</th><th class="text-right">Float Amount</th><th class="text-right">Register amount</th></tr>',
            'pendingreport': '<tr><th>#</th><th>Id</th><th>Date</th><th class="text-center">No. of product</th><th class="text-right">Total</th><th class="text-right">Partial</th><th class="text-right">Due</th></tr>',
            'returnreport': '<tr><th>#</th><th>Sales Id</th><th>Date</th><th>Customer name</th><th>Payment Method</th><th>No. of Item </th><th class="text-right">Return Amount</th></tr>',
            'returnreceivingreport': '<tr><th>#</th><th>Receiving Id</th><th>Date</th><th>Supplier name</th><th>Payment Method</th><th>No. of Item </th><th class="text-right">Return Amount</th></tr>',
            'customerdetails': '<tr><th>#</th><th> Sale </th><th>Date</th><th class="text-center">Process</th><th class="text-center">No. of item return</th><th class="text-right">Return total</th><th class="text-center">No. of item sold</th><th class="text-right">Sale total</th></tr>',
            'customertransactiondetails': '<tr><th>#</th><th> Date </th><th class="text-center"> Description </th><th> Type </th><th class="text-center"> Wallet </th><th class="text-center"> Paid </th><th class="text-center"> Pending </th><th class="text-center"> Total </th><th class="text-center"> Image </th><th class="text-center"> Action </th></tr>',
            'supplierdetails': '<tr><th>#</th><th> Purchase </th><th>Date</th><th class="text-center">Process</th><th class="text-center">No. of item return</th><th class="text-right">Return total</th><th class="text-center">No. of item sold</th><th class="text-right">Sale total</th></tr>',
            'usersdetails': '<tr><th>#</th><th> Sale </th><th>Date</th><th class="text-right">Amount</th></tr>',
            'productdetails': '<tr><th>#</th><th> Name </th><th>Date</th><th class="text-right">Selling Amount</th></tr>',
            'returndetails': '<tr><th>#</th><th> Name </th><th>Qty</th><th class="text-right"> Amount</th></tr>',
            'registerdetails': '<tr><th>#</th><th> Sale </th><th>Date</th><th>Payment</th><th class="text-right">Return</th><th class="text-right">Amount</th></tr>',
            'paymenttransaction': '<tr><th>#</th><th>Sale</th><th>Date</th><th>User</th><th>Method</th><th class="text-right">Amount</th></tr>',
            'staffactivity': '<tr><th>#</th><th>Name</th><th>Login Date/Time</th><th>Outlet</th><th>IP address</th><th>Device type</th><th>OS</th><th>Browser</th></tr>',
            'expensesreport': '<tr><th>#</th><th>Amount</th><th>Type</th><th> Category </th><th>Recipient Name</th><th>Approvedby</th><th>Description</th></tr>',
            'transactionreport': '<tr><th>#</th><th>Name</th><th class="text-right">Credit</th><th class="text-right">Debit</th><th class="text-right">Wallet Amount</th><th class="text-right">Sales Pending</th><th class="text-right">Overall Due</th></tr>',
            'itemstock': '<tr><th>#</th><th> Name </th><th>Qty</th><th class="text-right">Company Price</th><th class="text-right">Total Amount</th><th class="text-right">Selling Price</th><th class="text-right">Total Amount</th></tr>'
        };

        $(TableBody).each(function (key, val) {
            $(".report-thead-tfoot").empty().html(val[report]);
        });
    },

    appendViewDataTableBody: function (table) {
        $('#BackupReportName').html(table + ' Document').css('textTransform', 'capitalize').show();
        var TableBody = {
            'sales': '<tr><th><input name="sales-select-all" type="checkbox" onclick="PosnicPro.checkboxSelectAll(this,\'sales\');"></th><th>#</th><th>Id</th><th>Date</th><th width="20%">Customer</th><th class="text-right table-phone-hide">Phone</th><th class="text-center table-number-hide">Table</th><th class="text-center order-type-column" width="10%">Order Type</th><th class="text-center">Process</th><th class="text-right">Price</th><th width="20%">Payment status</th><th class="text-center" width="16%">Actions</th></tr>',
            'kothistory': '<tr><th>#</th><th>Id</th><th>Date</th><th class="text-center table-number-hide">Table</th><th class="text-center">No.of.Pax</th><th class="text-center order-type-column" width="10%">Order Type</th><th class="text-center" width="16%">Actions</th></tr>',
            'receivings': '<tr><th><input name="receivings-select-all" type="checkbox" onclick="PosnicPro.checkboxSelectAll(this,\'receivings\');"></th><th>#</th><th>Id</th><th>Date</th><th width="20%">Supplier</th><th class="text-right">Phone</th><th class="text-center">Status</th><th class="text-right">Price</th><th class="text-center" width="16%">Action</th></tr>',
            'branches': '<tr><th><input name="branches-select-all" type="checkbox" onclick="PosnicPro.checkboxSelectAll(this,\'branches\');"></th><th>#</th><th>Name</th><th class="text-right">Phone</th><th>Email</th><th>Address</th><th>State</th><th>Country</th><th class="text-center">Action</th></tr>',
            'categories': '<tr><th><input name="categories-select-all" type="checkbox" onclick="PosnicPro.checkboxSelectAll(this,\'categories\');"></th><th>#</th><th>Name</th><th>Image</th><th class="text-right">Discount </th><th class="text-center">Description</th><th class="text-center">Action</th></tr>',
            'customercategory': '<tr><th><input name="customercategory-select-all" type="checkbox" onclick="PosnicPro.checkboxSelectAll(this,\'customercategory\');"></th><th>#</th><th>Name</th><th>Description</th><th class="text-center">Action</th></tr>',
            'customers': '<tr><th><input name="customers-select-all" type="checkbox" onclick="PosnicPro.checkboxSelectAll(this,\'customers\');"></th><th>#</th><th>Name</th><th class="text-right">Phone</th><th>Email</th><th>Address</th><th class="text-center">Action</th></tr>',
            'expenses': '<tr><th><input name="expenses-select-all" type="checkbox" onclick="PosnicPro.checkboxSelectAll(this,\'expenses\');"></th><th>#</th><th class="text-right">Amount</th><th>Type</th><th>Category</th><th>Approved By</th><th>Description</th><th class="text-center">Action</th></tr>',
            'items': '<tr><th><input name="items-select-all" type="checkbox" onclick="PosnicPro.checkboxSelectAll(this,\'items\');"></th><th>#</th><th>Name</th><th>Image</th><th class="text-center">SKU</th><th class="text-right">Quantity</th><th class="text-center">Item type</th><th class="text-right">Price</th><th class="text-center kiosk-column">Kiosk</th><th class="text-center">Action</th></tr>',
            'suppliers': '<tr><th><input name="suppliers-select-all" type="checkbox" onclick="PosnicPro.checkboxSelectAll(this,\'suppliers\');"></th><th>#</th><th>Name</th><th class="text-right">Phone</th><th>Email</th><th>Address</th><th class="text-center">Action</th></tr>',
            'registers': '<tr><th data-module="user" data-access="delete"><input name="registers-select-all" type="checkbox" onclick="PosnicPro.checkboxSelectAll(this,\'registers\');"></th><th>#</th><th>Register name</th><th>Date</th><th>Id</th><th>User name</th><th>Branch</th><th class="text-right">Register amount</th><th class="text-center">Action</th></tr>',
            'users': '<tr><th><input name="users-select-all" type="checkbox" onclick="PosnicPro.checkboxSelectAll(this,\'users\');"></th><th>#</th><th width="20%">Username</th><th>Image</th><th>Email Id</th><th class="text-center"> Type</th><th class="text-center">Status</th><th class="text-center" width="15%">Action</th></tr>',
            'lowitem': '<tr><th>#</th><th>Item Name</th><th>Item Image</th><th class="text-center">SKU</th><th>Supplier</th><th>Category</th><th class="text-center">Quantity</th><th colspan="2" class="text-center">Action</th></tr>',
            'stocklog': '<tr><th data-module="item" data-access="read"><input name="stocklogs-select-all" type="checkbox" onclick="PosnicPro.checkboxSelectAll(this,\'stocklogs\');"></th><th>#</th><th>Name</th><th>Date</th><th class="text-center">Activity</th><th class="text-center">User</th><th class="text-right">Opening Stock</th><th class="text-right">Stock Count</th><th class="text-right">Closing Stock</th><th class="text-center">Action</th></tr>',
            'variants': '<tr><th><input name="variants-select-all" type="checkbox" onclick="PosnicPro.checkboxSelectAll(this,\'variants\');"></th><th>#</th><th>Name</th><th class="text-center">Action</th></tr>'
        };

        $(TableBody).each(function (key, val) {
            $(".datatable-thead-tbody").empty().html(val[table]);
        });

        /*
         * Skeleton rows while the list loads (S1 feel-fast).
         *
         * Every list used to clear to a blank white table with a corner
         * spinner; the page looked broken for however long the fetch took.
         * Ghost rows shaped like the data communicate "loading" without a
         * layout jump - the fetch's success handler replaces the tbody, so
         * they can never outlive the data. Column count comes from the
         * thead markup above, so the two cannot drift.
         */
        var head = TableBody[table];
        if (head) {
            PosnicPro.skeleton.fill(table, (head.match(/<th/g) || []).length);
        }
    },

    /* Ghost rows for a table that is fetching. The shimmer runs a bounded
       number of times so a failed fetch degrades to a calm grey ghost, not
       an infinite pulse beside an error toast. */
    skeleton: {
        ROWS: 8,
        fill: function (module, columns) {
            var tbody = $('#view_' + module).children('tbody');
            if (!tbody.length || !columns) return;
            var cells = '';
            for (var c = 0; c < columns; c++) {
                cells += '<td><span class="skeleton-cell"></span></td>';
            }
            var rows = '';
            for (var r = 0; r < PosnicPro.skeleton.ROWS; r++) {
                rows += '<tr class="skeleton-row">' + cells + '</tr>';
            }
            tbody.html(rows);
        },
    },

    appendRecyclebinDataTableBody: function (table) {
        var TableBody = {
            'sales': '<tr><th><input name="sales-select-all" type="checkbox" onclick="PosnicPro.checkboxSelectAll(this,\'sales\');"></th><th>#</th><th>Id</th><th>Date</th><th>Customer</th><th>Process</th><th class="text-center">Price</th><th width="16%">Actions</th></tr>',
            'receivings': '<tr><th><input name="receivings-select-all" type="checkbox" onclick="PosnicPro.checkboxSelectAll(this,\'receivings\');"></th><th>#</th><th>Id</th><th>Date</th><th>Supplier</th><th>Status</th><th class="text-center">Price</th><th width="16%">Action</th></tr>',
            'customers': '<tr><th><input name="customers-select-all" type="checkbox" onclick="PosnicPro.checkboxSelectAll(this,\'customers\');"></th><th>#</th><th>Name</th><th>Phone</th><th>Email</th><th>Address</th><th>Action</th></tr>',
            'suppliers': '<tr><th><input name="suppliers-select-all" type="checkbox" onclick="PosnicPro.checkboxSelectAll(this,\'suppliers\');"></th><th>#</th><th>Name</th><th>Phone</th><th>Email</th><th>Address</th><th>Action</th></tr>',
            'categories': '<tr><th><input name="categories-select-all" type="checkbox" onclick="PosnicPro.checkboxSelectAll(this,\'categories\');"></th><th>#</th><th>Name</th><th>Image</th><th>Discount </th><th>Description</th><th>Action</th></tr>',
            'items': '<tr><th><input name="items-select-all" type="checkbox" onclick="PosnicPro.checkboxSelectAll(this,\'items\');"></th><th>#</th><th>Name</th><th>Image</th><th>SKU</th><th>Price</th><th>Quantity</th><th width="15%">Action</th></tr>',
            'branches': '<tr><th><input name="branches-select-all" type="checkbox" onclick="PosnicPro.checkboxSelectAll(this,\'branches\');"></th><th>#</th><th>Name</th><th>Phone</th><th>Email</th><th>Address</th><th>Country</th><th>State</th><th>Action</th></tr>',
            'users': '<tr><th><input name="users-select-all" type="checkbox" onclick="PosnicPro.checkboxSelectAll(this,\'users\');"></th><th>#</th><th>Name</th><th>Image</th><th>Email Id</th><th> Type</th><th width="15%">Action</th></tr>',
            'expenses': '<tr><th><input name="expenses-select-all" type="checkbox" onclick="PosnicPro.checkboxSelectAll(this,\'expenses\');"></th><th>#</th><th>Amount</th><th>Type</th><th>Category</th><th>Recipient</th><th>Approved By</th><th>Description</th><th>Action</th></tr>',
            'registers': '<tr><th><input name="registers-select-all" type="checkbox" onclick="PosnicPro.checkboxSelectAll(this,\'registers\');"></th><th>#</th><th>Register name</th><th>Date</th><th>Id</th><th>User name</th><th>Branch</th><th>Register amount</th><th>Action</th></tr>',
            'stocklogs': '<tr><th><input name="stocklogs-select-all" type="checkbox" onclick="PosnicPro.checkboxSelectAll(this,\'stocklogs\');"></th><th>#</th><th>SKU</th><th>Name</th><th>Date</th><th>Process</th><th>Opening Balance</th><th>Closing Balance</th><th>Action</th></tr>'
        };
        $(TableBody).each(function (key, val) {
            $(".datatable-thead-tbody").empty().html(val[table]);
        });
    },

    appendImportDataTableBody: function (table) {
        var TableBody = {
            'customers': '<tr><th>#</th><th>Name</th><th>Phone</th><th>Email</th><th>Address</th><th>Status</th></tr>',
            'suppliers': '<tr><th>#</th><th>Name</th><th>Phone</th><th>Email</th><th>Address</th><th>Status</th></tr>',
            'categories': '<tr><th>#</th><th>Name</th><th>Discount Amount</th> <th>Discount Percentage</th><th>Status</th></tr>',
            'customercategory': '<tr><th>#</th><th>Name</th><th>Description</th><th>Status</th></tr>',
            'items': '<tr><th>#</th><th>Name</th><th>Category Name</th><th>Price</th><th>Quantity</th><th>Status</th></tr>',
            'expenses': '<tr><th>#</th><th>Type</th><th>Amount</th><th>Category Name</th><th>Notes</th><th>Status</th></tr>'
        };
        $(TableBody).each(function (key, val) {
            $(".import-datatable-thead").empty().html(val[table]);
        });
    },

    /*
     * "Select all N", the Gmail way.
     *
     * The table only ever holds one page of rows, so ticking the header box
     * selects that page - never the thousands behind it. Export could then
     * only ever write what was on screen, and a shop with 4000 items got a
     * file of 100 with nothing to say the rest were missing.
     *
     * When the page is fully ticked and there is more behind it, we offer to
     * select the whole filtered set. Taking that offer does not try to tick
     * rows that were never loaded - it raises a flag the export reads, and the
     * server exports every item under the same filter the list is showing.
     *
     * selectAllMatching holds the module name while that flag is up, and only
     * that module. It is dropped the moment the selection stops being "all":
     * a row unticked, a search changed, a page turned.
     */
    selectAllMatching: null,

    maybeOfferSelectAll: function (module) {
        var total = parseInt($('#view_' + module + '_total').text(), 10) || 0;
        var loaded = (PosnicPro[module + '_checkbox'] || []).length;
        if (total > loaded && loaded > 0) {
            $('.select-all-loaded-' + module).text(loaded);
            $('.select-all-total-' + module).text(total);
            $('.select-all-offer-' + module).show();
            $('.select-all-active-' + module).hide();
            $('.select-all-banner-' + module).show();
        } else {
            $('.select-all-banner-' + module).hide();
        }
    },

    activateSelectAllMatching: function (module) {
        PosnicPro.selectAllMatching = module;
        var total = parseInt($('#view_' + module + '_total').text(), 10) || 0;
        $('.select-all-total-' + module).text(total);
        $('.select-all-offer-' + module).hide();
        $('.select-all-active-' + module).show();
        $('.select-all-banner-' + module).show();
    },

    clearSelectAllMatching: function (module) {
        if (PosnicPro.selectAllMatching === module) {
            PosnicPro.selectAllMatching = null;
        }
        $('.select-all-banner-' + module).hide();
    },

    checkboxSelectAll: function (element, module) {

        if (element.checked) {
            $("#" + module + "_exportbtn").removeClass("disabled");
            $("#" + module + "_deletebtn").removeClass("disabled");
            $("#" + module + "_accessbtn").removeClass("disabled");
            $('#setting_restorebtn').removeClass("disabled");
            var tableId = $(element).closest('table').attr('id');
            var getRows = $('#' + tableId).find('tbody').find('tr');

            for (var i = 0; i < getRows.length; i++) {
                var values = $(getRows[i]).find('.' + module + '-row-id:eq(0)').val();
                PosnicPro[module + "_checkbox"][PosnicPro[module + "_checkbox"].length] = values;
            }
            $('.showing-hide-show-' + module).show();
            $('.showing-value-' + module).html(PosnicPro[module + "_checkbox"].length);
            $('.' + module + '-row-id').prop("checked", true);
            $('.' + module + '-row-id').closest('tr').addClass('dangerzoneBgColor');
            $('.' + module + '-row-id').closest('.dangerzoneBgColor').css({ 'background': '#edf0fc', 'border-bottom': '1px dotted #ccc' });
            // The page is fully ticked - offer to select everything behind it.
            PosnicPro.maybeOfferSelectAll(module);
        } else {
            $('.' + module + '-row-id').closest('.dangerzoneBgColor').css({ 'background': '#fff', 'border-bottom': '1px dotted #fff' });
            $("#" + module + "_exportbtn").addClass("disabled");
            $("#" + module + "_deletebtn").addClass("disabled");
            $("#" + module + "_accessbtn").addClass("disabled");
            $('#setting_restorebtn').addClass("disabled");
            $('.' + module + '-row-id').prop("checked", false);
            $('.' + module + '-row-id').closest('tr').removeClass('dangerzoneBgColor');
            var tableId = $(element).closest('table').attr('id');
            var getRows = $('#' + tableId).find('tbody').find('tr');
            for (var j = 0; j < PosnicPro[module + "_checkbox"].length; j++) {
                for (var i = 0; i < getRows.length; i++) {
                    var values = $(getRows[i]).find('.' + module + '-row-id:eq(0)').val();
                    if (PosnicPro[module + "_checkbox"][j] === values) {
                        var index = PosnicPro[module + "_checkbox"].indexOf(values);
                        PosnicPro[module + "_checkbox"].splice(index, 1);
                    }
                }
            }
            $('.showing-value-' + module).html(PosnicPro[module + "_checkbox"].length);
            ((PosnicPro[module + "_checkbox"].length) === 0) ? $('.showing-hide-show-' + module).hide() : $('.showing-hide-show-' + module).show();
            $('.variantcheckbox').css({ 'background': '#fff', 'border-bottom': '1px dotted #fff' });
            // Header box cleared - the selection is no longer "all".
            PosnicPro.clearSelectAllMatching(module);
        }
    },
    setSelectedCheckbox: function (total, module) {
        $('input:checkbox[name="' + module + '-select-all"]').prop("checked", false);
        for (var j = 0; j < total.length; j++) {

            var getRows = $('#view_' + module).find('tbody').find('tr');
            for (var i = 0; i < getRows.length; i++) {
                var values = $(getRows[i]).find('.' + module + '-row-id:eq(0)').val();

                if (total[j] === values) {
                    $('input:checkbox[name="' + module + '-select-all"]').prop("checked", true);
                }
            }
            $('#' + total[j] + '').prop("checked", true);
            $('#' + total[j] + '').closest('tr').addClass('dangerzoneBgColor');
            $('#' + total[j] + '').closest('.dangerzoneBgColor').css({ 'background': '#edf0fc', 'border-bottom': '1px dotted #ccc' });
            $('#variantbgcolor_' + total[j] + '').css({ 'background': '#edf0fc', 'border-bottom': '1px dotted #ccc' });
            $('.variantcheck_' + total[j] + '').prop("checked", true);
        }
    },

    /**
     * Handles individual checkbox selection in data tables.
     * Called when a single row checkbox is clicked.
     * @param {HTMLElement} element - The checkbox element that was clicked
     * @param {string} module - The module name (e.g., 'sales', 'customers', 'items')
     */
    checkboxSelectOne: function (element, module) {
        var value = $(element).val();

        // Initialize the checkbox array if it doesn't exist
        if (!PosnicPro[module + "_checkbox"]) {
            PosnicPro[module + "_checkbox"] = [];
        }

        if ($(element).prop("checked") === true) {
            // Add the value to the checkbox array if it's not already there
            if (PosnicPro[module + "_checkbox"].indexOf(value) === -1) {
                PosnicPro[module + "_checkbox"].push(value);
            }

            // Enable export and delete buttons
            $("#" + module + "_exportbtn").removeClass("disabled");
            $("#" + module + "_deletebtn").removeClass("disabled");
            $("#" + module + "_accessbtn").removeClass("disabled");
            $('#setting_restorebtn').removeClass("disabled");

            // Highlight the selected row
            $(element).closest('tr').addClass('dangerzoneBgColor');
            $(element).closest('.dangerzoneBgColor').css({ 'background': '#edf0fc', 'border-bottom': '1px dotted #ccc' });
            $('#variantbgcolor_' + value).css({ 'background': '#edf0fc', 'border-bottom': '1px dotted #ccc' });
        } else {
            // Remove the value from the checkbox array
            var index = PosnicPro[module + "_checkbox"].indexOf(value);
            if (index !== -1) {
                PosnicPro[module + "_checkbox"].splice(index, 1);
            }

            // Remove row highlight
            $(element).closest('tr').removeClass('dangerzoneBgColor');
            $(element).closest('tr').css({ 'background': '#fff', 'border-bottom': '1px dotted #fff' });
            $('#variantbgcolor_' + value).css({ 'background': '#fff', 'border-bottom': '1px dotted #fff' });

            // Disable buttons if no checkboxes are selected
            if (PosnicPro[module + "_checkbox"].length === 0) {
                $("#" + module + "_exportbtn").addClass("disabled");
                $("#" + module + "_deletebtn").addClass("disabled");
                $("#" + module + "_accessbtn").addClass("disabled");
                $('#setting_restorebtn').addClass("disabled");
            }

            // Uncheck select-all checkbox when any individual checkbox is unchecked
            $('input:checkbox[name="' + module + '-select-all"]').prop("checked", false);
            // One row dropped means the selection is no longer the whole set.
            PosnicPro.clearSelectAllMatching(module);
        }

        // Update the count display
        $('.showing-value-' + module).html(PosnicPro[module + "_checkbox"].length);

        // Show/hide the selection count area
        if (PosnicPro[module + "_checkbox"].length === 0) {
            $('.showing-hide-show-' + module).hide();
        } else {
            $('.showing-hide-show-' + module).show();
        }
    },

    getFormData: function ($form) {
        var unindexed_array = $form.serializeArray();
        var indexed_array = {};

        $.map(unindexed_array, function (n, i) {
            indexed_array[n['name']] = n['value'];
        });

        return indexed_array;
    },
    gstrXls: function (element, name) {
        var id = $(element).data('id');
        $('#' + id).table2excel({
            exclude: ".noExl",
            name: name,
            filename: name + "_Report_" + new Date().toISOString().replace(/[\-\:\.]/g, "") + ".xls",
            fileext: ".xls",
            exclude_img: true,
            exclude_links: true,
            exclude_inputs: true,
            preserveColors: false

        });
    },

    daterangeSetsearchData: function () {
        var module = currentHash;
        var removeData = "report"
        var reportSet = module.replace(removeData, '');
        PosnicPro.callbackfilter = {};
        var report_module = reportSet + 'report';
        var datset_id = $('#change_' + reportSet + '_view').data('id');
        if (module === report_module) {
            var index = '<button type="button" class="btn btn-primary-rgba" data-id="' + datset_id + '" id="change_' + reportSet + '_view">';
            PosnicPro.callbackfilter = {
                name: reportSet + 'root',
                nameset: 'viewPage',
                arguments: index
            };
            window['PosnicPro']['' + PosnicPro.callbackfilter.name]['' + PosnicPro.callbackfilter.nameset]('' + PosnicPro.callbackfilter.arguments)
        } else {
            var index = '<button type="button" class="btn btn-primary-rgba" data-id="' + module + '"></button>';
            PosnicPro.search(index, "Table");
        }


    },
    convertFileToDataURLviaFileReader: function (url, callback) {
        var xhr = new XMLHttpRequest();
        xhr.onload = function () {
            var reader = new FileReader();
            reader.onloadend = function () {
                callback(reader.result);
            }
            reader.readAsDataURL(xhr.response);
        };
        xhr.open('GET', url);
        xhr.responseType = 'blob';
        xhr.send();
    },
    nestedTaxCalculation: function (params) {
        var newArray = params.reduce(function (matcharryid, matcharryvalue) {
            //finding Index in the array where the tax_id matched
            var findIfNameExist = matcharryid.findIndex(function (item) {
                return item.tax_id === matcharryvalue.tax_id;
            });
            // if in the new array no such object exist where
            // tax_id matches then create a new object
            if (findIfNameExist === -1) {
                let obj = {
                    'tax_id': matcharryvalue.tax_id,
                    'tax_name': matcharryvalue.tax_name,
                    "value": [matcharryvalue]
                };
                matcharryid.push(obj);
            } else {
                // if name tax_id matches , then push the value
                matcharryid[findIfNameExist].value.push(matcharryvalue);
            }
            return matcharryid;

        }, []);
        newArray.forEach(x => x.amount = x.value.reduce((val, cur) => val + cur.tax_value, 0));
        return newArray;
    },
    getAllUrlParams: function (url) {
        var queryString = url ? url.split('?')[1] : window.location.search.slice(1);
        var obj = {};

        if (queryString) {
            queryString = queryString.split('#')[0];
            var arr = queryString.split('&');

            for (var i = 0; i < arr.length; i++) {
                var a = arr[i].split('=');
                var paramName = a[0];
                let arrayValue = arr[i].replace("" + paramName + "=", "");
                var paramValue = typeof (a[1]) === 'undefined' ? true : arrayValue;
                if (typeof paramValue === 'string')
                    paramValue = paramValue;

                if (paramName.match(/\[(\d+)?\]$/)) {
                    var key = paramName.replace(/\[(\d+)?\]/, '');
                    if (!obj[key])
                        obj[key] = [];

                    if (paramName.match(/\[\d+\]$/)) {
                        var index = /\[(\d+)\]/.exec(paramName)[1];
                        obj[key][index] = paramValue;
                    } else {
                        obj[key].push(paramValue);
                    }
                } else {
                    if (!obj[paramName]) {
                        obj[paramName] = paramValue;
                    } else if (obj[paramName] && typeof obj[paramName] === 'string') {
                        obj[paramName] = [obj[paramName]];
                        obj[paramName].push(paramValue);
                    } else {
                        obj[paramName].push(paramValue);
                    }
                }
            }
        }

        return obj;
    },
    removeDuplicates: function (arr) {
        return arr.filter((item,
            index) => arr.indexOf(item) === index);
    },
    toggleVisibility: function (key, className) {
        (PosnicPro.local.get(key) === 'on') ? $(className).show() : $(className).hide();
    },
    importTableHeader: function (table) {
        var headersMap = {
            customers: ['name', 'phone', 'email', 'address'],
            suppliers: ['name', 'phone', 'email', 'address'],
            categories: ['name', 'discount_amount', 'discount_percentage', 'description'],
            customercategory: ['name', 'description'],
            // hsncode/hsndescription/tax_name are accepted by the server import;
            // they were missing here, which silently dropped them on re-import.
            items: ['name', 'itemid', 'barcode_id', 'supplier_name', 'category_name', 'discount_amount', 'discount_percentage', 'tax', 'tax_type', 'tax_name', 'hsncode', 'hsndescription', 'mrp_price', 'company_price', 'selling_price', 'available_quantity', 'unit', 'sort_order'],
            expenses: ['amount', 'type', 'category', 'recipientname', 'approvedby', 'description'],
            employees: ['Id', 'Name', 'Phone', 'Email', 'Address', 'Country', 'State', 'City']
        };
        return headersMap[table] || [];
    },

    /*
     * Smart column matching for imports. Shops migrate from other POS systems
     * whose headers never match ours exactly - "Product Name", "MRP", "Rate",
     * "SKU", "GST%". This maps common header names (lower-cased) to our field,
     * so those columns land correctly instead of being silently dropped.
     */
    importHeaderAlias: function (table) {
        var maps = {
            items: {
                'name': 'name', 'item name': 'name', 'product name': 'name', 'product': 'name', 'item': 'name', 'description': 'name', 'item description': 'name', 'title': 'name', 'particulars': 'name',
                'itemid': 'itemid', 'sku': 'itemid', 'item code': 'itemid', 'itemcode': 'itemid', 'code': 'itemid', 'item id': 'itemid', 'product code': 'itemid', 'article': 'itemid', 'article no': 'itemid', 'ref': 'itemid',
                'barcode_id': 'barcode_id', 'barcode': 'barcode_id', 'bar code': 'barcode_id', 'ean': 'barcode_id', 'upc': 'barcode_id',
                'category_name': 'category_name', 'category': 'category_name', 'group': 'category_name', 'department': 'category_name', 'item group': 'category_name',
                'supplier_name': 'supplier_name', 'supplier': 'supplier_name', 'vendor': 'supplier_name', 'brand': 'supplier_name', 'manufacturer': 'supplier_name',
                'mrp_price': 'mrp_price', 'mrp': 'mrp_price', 'max price': 'mrp_price', 'maximum retail price': 'mrp_price', 'list price': 'mrp_price', 'm.r.p': 'mrp_price', 'm.r.p.': 'mrp_price',
                'company_price': 'company_price', 'cost': 'company_price', 'cost price': 'company_price', 'purchase price': 'company_price', 'buy price': 'company_price', 'buying price': 'company_price', 'purchase rate': 'company_price', 'cp': 'company_price', 'landing cost': 'company_price',
                'selling_price': 'selling_price', 'selling price': 'selling_price', 'sale price': 'selling_price', 'sales price': 'selling_price', 'price': 'selling_price', 'rate': 'selling_price', 'sell price': 'selling_price', 'unit price': 'selling_price', 'sp': 'selling_price', 'retail price': 'selling_price',
                'tax': 'tax', 'gst': 'tax', 'tax %': 'tax', 'tax percent': 'tax', 'tax percentage': 'tax', 'vat': 'tax', 'gst %': 'tax', 'gst percentage': 'tax', 'tax rate': 'tax',
                'tax_type': 'tax_type', 'tax type': 'tax_type',
                'tax_name': 'tax_name', 'tax name': 'tax_name',
                'hsncode': 'hsncode', 'hsn': 'hsncode', 'hsn code': 'hsncode', 'hsn/sac': 'hsncode', 'hsn sac': 'hsncode', 'hsncode/sac': 'hsncode',
                'hsndescription': 'hsndescription', 'hsn description': 'hsndescription',
                'available_quantity': 'available_quantity', 'quantity': 'available_quantity', 'qty': 'available_quantity', 'stock': 'available_quantity', 'opening stock': 'available_quantity', 'available quantity': 'available_quantity', 'stock qty': 'available_quantity', 'in stock': 'available_quantity', 'current stock': 'available_quantity',
                'unit': 'unit', 'uom': 'unit', 'units': 'unit', 'measure': 'unit', 'unit of measure': 'unit',
                'discount_amount': 'discount_amount', 'discount amount': 'discount_amount', 'discount': 'discount_amount', 'disc': 'discount_amount', 'disc amount': 'discount_amount',
                'discount_percentage': 'discount_percentage', 'discount %': 'discount_percentage', 'discount percent': 'discount_percentage', 'discount percentage': 'discount_percentage', 'disc %': 'discount_percentage',
                'sort_order': 'sort_order', 'sort order': 'sort_order', 'sort': 'sort_order', 'order': 'sort_order'
            }
        };
        return maps[table] || {};
    }
};

/*** Common Function For LocalStorage ***/
PosnicPro.local = {
    set: function (key, value) {
        localStorage.setItem(key, value);
    },
    get: function (key) {
        return localStorage.getItem(key);
    },
    // Needed to put a setting back to "never chosen" rather than to an empty
    // string, which is a different thing: code here falls back on absence, and
    // an empty value would defeat that.
    remove: function (key) {
        localStorage.removeItem(key);
    }
};
$(document).ready(function () {
    // Printer and paper are set per machine in Hardware Manager. Pull them in
    // before the first sale so the first receipt is right, not the second.
    PosnicPro.syncPrinterPreferences();

    //    $(".changeCountry").append('<option id="Select country"  value="">Select Country</option>');
    //    $(".changeState").append('<option id="Select State" value="">Select State</option>');

    var kotEnabled = (PosnicPro.local.get('table_options') === 'enable');
    var $newSaleLi = $('#view_touchsales_page').closest('li');
    
    console.log('KOT Menu Debug:', {
        kotEnabled: kotEnabled,
        table_options: PosnicPro.local.get('table_options'),
        newSaleLi: $newSaleLi.length,
        kotMenu: $('#kot_menu').length,
        itemMasterMenu: $('#item_master_menu').length
    });
    
    if (kotEnabled) {
        console.log('KOT is ENABLED - showing KOT and Item Master menus');
        $newSaleLi.hide();
        $('#image_sidebar_newsale').hide();
        $('#kot_menu').show();
        $('#item_master_menu').show();
    } else {
        console.log('KOT is DISABLED - showing New Sale menu');
        $newSaleLi.show();
        $('#kot_menu').hide();
        $('#item_master_menu').hide();
    }

    PosnicPro.applyKotVisibility(kotEnabled);
});

/*Import Csv File Into Table By Type of Table Request*/
$(".files").on('change', function (e) {
    var fileSize = this.files[0].size;
    if (fileSize < '337920') {
        var validExtensions = ['csv'];
        var fileName = this.files[0].name;
        var fileNameExt = fileName.substr(fileName.lastIndexOf('.') + 1);
        if ($.inArray(fileNameExt, validExtensions) === -1) {
            this.type = ''
            this.type = 'file'
            PosnicPro.alert('error', "Only these file types are accepted : " + validExtensions.join(', '));
        } else {
            var result = [];
            if (e.target.files !== undefined) {
                var reader = new FileReader();
                reader.onload = function (e) {
                    var csv = e.target.result;
                    var lines = (csv && typeof csv === 'string') ? csv.split(/\r\n|\n/) : [];

                    // drop completely empty lines
                    lines = lines.filter(function (line) {
                        return line && line.trim() !== '';
                    });

                    if (!lines || lines.length === 0) {
                        PosnicPro.alert('error', 'Empty CSV file');
                        return false;
                    }

                    // CSV row parser that respects double quotes so that
                    // fields containing commas (for example HSN descriptions)
                    // remain in a single column when importing.
                    var parseCsvRow = function (line) {
                        var cells = [];
                        var value = '';
                        var insideQuotes = false;

                        for (var idx = 0; idx < line.length; idx++) {
                            var ch = line[idx];
                            var nextCh = line[idx + 1];

                            if (ch === '"') {
                                if (insideQuotes && nextCh === '"') {
                                    value += '"';
                                    idx++;
                                } else {
                                    insideQuotes = !insideQuotes;
                                }
                            } else if (ch === ',' && !insideQuotes) {
                                cells.push(value);
                                value = '';
                            } else {
                                value += ch;
                            }
                        }

                        cells.push(value);
                        return cells;
                    };

                    var headers = parseCsvRow(lines[0]);
                    var TableHead = PosnicPro.importTableHeader(PosnicPro.importAction);

                    // Normalize expected headers once (trim + lowercase) so that
                    // CSV files with minor casing / whitespace differences or BOM
                    // still match the configured template.
                    var normalizedTableHead = $.map(TableHead, function (h) {
                        return String(h).trim().toLowerCase();
                    });
                    // Smart aliases, so a migrating shop's headers ("Product Name",
                    // "MRP", "Rate", "SKU"...) land on the right field instead of
                    // being dropped.
                    var importAliasMap = PosnicPro.importHeaderAlias(PosnicPro.importAction);

                    for (var i = 1; i < lines.length; i++) {
                        var obj = {};
                        var currentline = parseCsvRow(lines[i]);

                        for (var j = 0; j < headers.length; j++) {
                            if (typeof (currentline[j]) !== 'undefined' && currentline[j] !== '') {
                                // Clean up the header cell: remove CR, BOM, trim spaces.
                                var rawHeader = String(headers[j] || '');
                                var headTitle = rawHeader
                                    .replace(/\r/g, "")
                                    .replace(/^\uFEFF/, '')
                                    .trim();

                                if (!headTitle) {
                                    continue;
                                }

                                var lookupTitle = headTitle.toLowerCase();
                                var headerIndex = $.inArray(lookupTitle, normalizedTableHead);
                                // Exact header match first; if that misses, fall back to
                                // the smart alias map so common variants still map.
                                var keyName = headerIndex !== -1
                                    ? TableHead[headerIndex]
                                    : (importAliasMap[lookupTitle] || null);

                                if (keyName) {
                                    obj[keyName] = String(currentline[j]).replace(/\"/g, "");
                                } else {
                                    // Unknown / extra column - ignored gracefully; the server
                                    // validates required fields and reports issues row-by-row.
                                    continue;
                                }
                            }
                        }

                        result.push(obj);
                    }

                    var resultData = result.filter(function (row) {
                        return Object.keys(row).length !== 0;
                    });
                    var params = {
                        url: '' + PosnicPro.importAction + '/' + PosnicPro.importAction + 'Import',
                        data: JSON.stringify({ result: resultData })
                    };
                    PosnicPro.post(params, function (response) {
                        if (response.type === 'success') {
                            var responseData = response.data;
                            $('.import-table tbody').children("tr").remove();
                            $('.hide-import-table').show();
                            if (PosnicPro.importAction === 'customers') {
                                var row = response.data;
                                PosnicPro.appendImportDataTableBody('customers');
                                var message = response.message;
                                if (message === 'CSV') {
                                    for (var i = 0; i < row.length; i++) {
                                        var trow = '<tr> <td>' + (i + 1) + '</td> <td>' + row[i].name + '</td> <td><a href="tel:' + row[i].phone + '">' + row[i].phone + '</a><td><a href="mailto:' + row.email + '">' + row[i].email + '</a></td><td>' + row[i].address + '</td><td><i class="feather icon-x-circle mr-2 text-danger"></i> CSV Field Missing ' + row[i].status + '</td></tr>';
                                        $('.import-table').children('tbody').append(trow);
                                    }
                                } else {
                                    for (var i = 0; i < row.length; i++) {
                                        var trow = '<tr> <td>' + (i + 1) + '</td> <td>' + row[i].name + '</td> <td><a href="tel:' + row[i].phone + '">' + row[i].phone + '</a><td><a href="mailto:' + row.email + '">' + row[i].email + '</a></td><td>' + row[i].address + '</td><td><i class="fa fa-check text-success"></i> Import</td></tr>';
                                        $('.import-table').children('tbody').append(trow);
                                    }
                                }
                            } else if (PosnicPro.importAction === 'suppliers') {
                                var row = response.data;
                                PosnicPro.appendImportDataTableBody('suppliers');
                                var message = response.message;
                                if (message === 'CSV') {
                                    for (var i = 0; i < row.length; i++) {
                                        var trow = '<tr> <td>' + (i + 1) + '</td> <td>' + row[i].name + '</td> <td><a href="tel:' + row[i].phone + '">' + row[i].phone + '</a><td><a href="mailto:' + row.email + '">' + row[i].email + '</a></td><td>' + row[i].address + '</td><td><i class="feather icon-x-circle mr-2 text-danger"></i> CSV Field Missing ' + row[i].status + '</td></tr>';
                                        $('.import-table').children('tbody').append(trow);
                                    }
                                } else {
                                    for (var i = 0; i < row.length; i++) {
                                        var trow = '<tr> <td>' + (i + 1) + '</td> <td>' + row[i].name + '</td> <td><a href="tel:' + row[i].phone + '">' + row[i].phone + '</a><td><a href="mailto:' + row.email + '">' + row[i].email + '</a></td><td>' + row[i].address + '</td><td><i class="fa fa-check text-success"></i> Import</td></tr>';
                                        $('.import-table').children('tbody').append(trow);
                                    }
                                }
                            } else if (PosnicPro.importAction === 'categories') {
                                var row = response.data;
                                PosnicPro.appendImportDataTableBody('categories');
                                var message = response.message;
                                if (message === 'CSV') {
                                    for (var i = 0; i < row.length; i++) {
                                        var trow = '<tr> <td>' + (i + 1) + '</td> <td>' + row[i].name + '</td> <td>' + row[i].discount_amount + '<td>' + row[i].discount_percentage + '</td>  <td><i class="feather icon-x-circle mr-2 text-danger"></i> CSV Field Missing ' + row[i].status + '</td></tr>';
                                        $('.import-table').children('tbody').append(trow);
                                    }
                                } else {
                                    for (var i = 0; i < row.length; i++) {
                                        var trow = '<tr> <td>' + (i + 1) + '</td> <td>' + row[i].name + '</td> <td>' + row[i].discount_amount + '<td>' + row[i].discount_percentage + '</td> <td><i class="fa fa-check text-success"></i> Import</td></tr>';
                                        $('.import-table').children('tbody').append(trow);
                                    }
                                }
                            } else if (PosnicPro.importAction === 'customercategory') {
                                var row = response.data;
                                PosnicPro.appendImportDataTableBody('customercategory');
                                PosnicPro.customercategory.loadSelectCustomereCategory();
                                var message = response.message;
                                if (message === 'CSV') {
                                    for (var i = 0; i < row.length; i++) {
                                        var trow = '<tr> <td>' + (i + 1) + '</td> <td>' + row[i].name + '</td><td>' + row[i].description + '</td> <td><i class="feather icon-x-circle mr-2 text-danger"></i> CSV Field Missing ' + row[i].status + '</td></tr>';
                                        $('.import-table').children('tbody').append(trow);
                                    }
                                } else {
                                    for (var i = 0; i < row.length; i++) {
                                        var trow = '<tr> <td>' + (i + 1) + '</td> <td>' + row[i].name + '</td><td>' + row[i].description + '</td><td><i class="fa fa-check text-success"></i> Import</td></tr>';
                                        $('.import-table').children('tbody').append(trow);
                                    }
                                }
                            } else if (PosnicPro.importAction === 'items') {
                                var row = response.data;
                                PosnicPro.appendImportDataTableBody('items');
                                PosnicPro.items.loadSelectCategory();
                                PosnicPro.stocklogs.viewLowStockDashboard();
                                var message = response.message;
                                if (message === 'CSV') {
                                    for (var i = 0; i < row.length; i++) {
                                        var trow = '<tr> <td>' + (i + 1) + '</td> <td>' + row[i].name + '</td> <td>' + row[i].category_name + '</td> <td>' + row[i].selling_price + '</td> <td>' + row[i].available_quantity + '</td> <td><i class="feather icon-x-circle mr-2 text-danger"></i> CSV Field Missing ' + row[i].status + '</td></tr>';
                                        $('.import-table').children('tbody').append(trow);
                                    }
                                } else {
                                    for (var i = 0; i < row.length; i++) {
                                        var trow = '<tr> <td>' + (i + 1) + '</td> <td>' + row[i].name + '</td> <td>' + row[i].category_name + '</td> <td>' + row[i].selling_price + '</td> <td>' + row[i].available_quantity + '</td> <td><i class="fa fa-check text-success"></i> Import</td></tr>';
                                        $('.import-table').children('tbody').append(trow);
                                    }
                                }

                            } else {
                                var row = response.data;
                                PosnicPro.appendImportDataTableBody('expenses');
                                var message = response.message;
                                if (message === 'CSV') {
                                    for (var i = 0; i < row.length; i++) {
                                        var trow = '<tr> <td>' + (i + 1) + '</td> <td>' + row[i].type + '</td> <td>' + row[i].amount + '</td> <td>' + row[i].category + '</td> <td>' + row[i].description + '</td>  <td><i class="feather icon-x-circle mr-2 text-danger"></i> CSV Field Missing ' + row[i].status + '</td></tr>';
                                        $('.import-table').children('tbody').append(trow);
                                    }
                                } else {
                                    for (var i = 0; i < row.length; i++) {
                                        var trow = '<tr> <td>' + (i + 1) + '</td> <td>' + row[i].type + '</td> <td>' + row[i].amount + '</td> <td>' + row[i].category + '</td> <td>' + row[i].description + '</td>  <td><i class="fa fa-check text-success"></i> Import</td></tr>';
                                        $('.import-table').children('tbody').append(trow);
                                    }
                                }
                            }
                            $('#progressBar').show();
                            var elem = document.getElementById("loadingBar");
                            var width = 1;
                            var id = setInterval(frame, 10);
                            function frame() {
                                if (width >= 100) {
                                    clearInterval(id);
                                    $('#progressBar').hide();
                                } else {
                                    width++;
                                    elem.style.width = width + '%';
                                }
                            }
                            let actionUrl = (PosnicPro.importAction === 'customercategory') ? PosnicPro.importAction.toLowerCase() : PosnicPro.importAction;
                            PosnicPro[actionUrl][actionUrl + "Table"](actionUrl);
                        }
                        PosnicPro.alert(response.type, response.message);
                    }, function (xhr) {
                        var response = jQuery.parseJSON(xhr.responseText);
                        PosnicPro.alert(response.type, response.message);
                    });
                };
                reader.readAsText(e.target.files.item(0));
            }
        }
    } else {
        PosnicPro.alert('error', "size should be less than 330kb !");
    }
});
/*GO Back History*/
$('.history-back').on("click", function () {
    history.back();
});
$(".newbranch").on('change', function () {
    if ($(this).val() === "true") {
        hasher.setHash('branches/new');
    }
});

(function ($) {
    $.fn.reverseChildren = function (childSelector) {
        this.each(function (el, index) {
            var children = $.makeArray($(childSelector, this).detach());
            children.reverse();
            $(this).append(children);
        });
        return this;
    };
    var date = new Date();

    setTimeout(function () {
        setInterval(PosnicPro.commonDate, 60000);
        PosnicPro.commonDate();
    }, (60 - date.getSeconds()) * 1000);
}(jQuery));


//https://dexie.org/
var db = new Dexie("posnicpro");
// Define Database Schema
db.version(1).stores({
    customers: "id, jsDate, name, branch_id",
    items: "id, jsDate, name, itemid, branch_id",
    suppliers: "id, jsDate, name, branch_id",
    categories: "id, jsDate, name, branch_id",
    users: "id, jsDate, username, branch_id",
    branches: "id, jsDate, branch_name",
    expenses: "id, jsDate, branch_id",
    receivings: "id, jsDate, receiving_id, supplier_name, supplier_phone, branch_id",
    sales: "id, jsDate, sales_id, branch_id, customer_name, customer_phone",
    offline_hash: "module",
    queue: "++id, module, method",
    currentbranch: "++id, id, branch_id, branch_name, user_id",
    currentregister: "++id, id, register_id, register_name, register_status",
    customerDisplay: "id, clear, get, customer, branch, items, tender",
    saleAutoFocus: "id, clear, get, branch_id, addSale, editSale, holdSale",
    recevingAutoFocus: "id, clear, get, branch_id, addReceiving, editReceiving",
    customerPlan: "id, read",
    printLableValues: "++id, id, printLabel"
});
/*
 * v2 deletes the abandoned offline layer's stores: the nine collection mirrors
 * (never populated - the downloader was dead code), the change-hash table, and
 * the write-only queue that silently swallowed offline sales. Version 1 above
 * must stay as-is so existing installs upgrade cleanly (Dexie needs the old
 * schema to diff against); a null store means "delete this table and its data".
 */
db.version(2).stores({
    customers: null,
    items: null,
    suppliers: null,
    categories: null,
    users: null,
    branches: null,
    expenses: null,
    receivings: null,
    sales: null,
    offline_hash: null,
    queue: null
});

/*
 * Customer display sync (S4 v2): pushed, not polled.
 *
 * The sales page talks to the customer-facing window through the
 * customerDisplay Dexie store - fifteen write sites across five files. The
 * display used to discover those writes by re-reading the store every
 * 500ms, forever. Wrapping the store's write methods once here means every
 * writer broadcasts without knowing it, and the display re-renders the
 * moment something changed instead of on a timer. BroadcastChannel reaches
 * every window of the origin - including a second Electron BrowserWindow.
 */
(function () {
    if (typeof BroadcastChannel === 'undefined' || !db.customerDisplay) return;
    var channel;
    try { channel = new BroadcastChannel('posnic-customer-display'); } catch (e) { return; }
    ['put', 'add', 'update'].forEach(function (op) {
        var original = db.customerDisplay[op].bind(db.customerDisplay);
        db.customerDisplay[op] = function () {
            var result = original.apply(null, arguments);
            if (result && result.then) {
                result.then(function () {
                    try { channel.postMessage('changed'); } catch (e) { /* display falls back to its safety poll */ }
                }).catch(function () { /* the caller owns the failure */ });
            }
            return result;
        };
    });
})();

/*
 * amCharts loads lazily, and no report file knows it.
 *
 * Every chart in the product enters through am4core.ready(cb) - the library's
 * own idiom. This stub queues that callback, loads the real library (whose
 * UMD assigns window.am4core wholesale, replacing the stub), then hands the
 * callback to the real ready(). Eight report modules stay byte-identical
 * while 1.1MB leaves the boot path.
 */
(function () {
    function stubReady(cb) {
        PosnicPro.lazy.load('amcharts').then(function () {
            if (window.am4core && window.am4core.ready !== stubReady) {
                window.am4core.ready(cb);
            } else {
                console.error('[lazy] amcharts loaded but did not replace the stub');
            }
        }).catch(function () { /* already surfaced by lazy.load */ });
    }
    if (!window.am4core) window.am4core = { ready: stubReady };
})();

/*
 * Realtime wiring for the generic lists (S2). The dashboard is the only
 * page with lists to keep fresh; login and friends never open the stream.
 * The sales list has a smarter handler in sales_view.js - these are the
 * screens where "someone changed it, re-ask" is the whole requirement.
 */
$(function () {
    if (!/dashboard\.html$/i.test(window.location.pathname)) return;
    PosnicPro.realtime.start();
    /* Ask the browser not to evict this origin's caches under storage
       pressure - a LAN counter that loses them re-downloads megabytes
       mid-shift. Silent grant for installed/engaged origins; a refusal
       just means today's behaviour. */
    try {
        if (navigator.storage && navigator.storage.persist) {
            navigator.storage.persist().catch(function () {});
        }
    } catch (e) { /* optional everywhere */ }
    ['items', 'customers', 'suppliers', 'receivings', 'expenses', 'categories']
        .forEach(function (entity) {
            PosnicPro.realtime.on(entity, function () {
                if (document.hidden) return;
                if (window.location.hash.slice(1) === '/' + entity) {
                    PosnicPro.refreshDatatable(entity);
                }
            });
        });
});

$('.custom_search_input').on('keypress keydown.autocomplete', function () {
    var module = $(this).data('id');
    var field_name = $('#view_' + module + '_fields :selected').val();

    var moduleMap = {
        'lowstockitems': 'items',
        'customercategory': 'customer_category'
    };

    module = moduleMap[module] || module;
    $(this).autocomplete({
        lookup: function (query, done) {
            var result = {};
            var suggestions = [];
            var params = {
                url: 'base/autoSuggestionTableField',
                data: 'query=' + query + '&field=' + field_name + '&module=' + module
            };
            PosnicPro.get(params, function (response) {
                suggestions: $.map(response.suggestions, function (dataItem) {
                    suggestions.push({ "value": dataItem, "data": dataItem });
                });
                result["suggestions"] = suggestions;
                done(result);
            });
        },
        autoSelectFirst: true
    });
});
$('.custom_report_search_input').on('keypress keydown.autocomplete', function () {
    let module = $(this).data('id');
    let field_name = $('#view_' + module + '_fields :selected').val();
    let branchField = $(this).data('field');
    let branch = $('#' + branchField + '_branch_value').val();
    $(this).autocomplete({
        lookup: function (query, done) {
            var result = {};
            var suggestions = [];
            var params = {
                url: 'base/autoSuggestionReportTableField',
                data: 'query=' + query + '&field=' + field_name + '&module=' + module + '&branch[]=' + branch
            };
            PosnicPro.get(params, function (response) {
                $('.' + module + '_input_id').val('');
                suggestions: $.map(response.suggestions, function (dataItem) {
                    suggestions.push({ "value": dataItem['name'], "data": dataItem['name'], "id": dataItem['id'] });
                });
                result["suggestions"] = suggestions;
                done(result);
            });
        },
        onSelect: function (suggestion) {
            $('.' + module + '_input_id').val(suggestion.id);
        },
        autoSelectFirst: true
    });
});
$(".infobar-settings-close").on("click", function (e) {
    var instant = 'sales/instant/new';
    if (currentHash === instant) {
        hasher.changed.active = true;
        hasher.replaceHash('sales/new');
    }
    var category = 'sales/categories/new';
    if (currentHash === category) {
        hasher.changed.active = true;
        hasher.replaceHash('sales/new');
    }
    var customer = 'sales/customers/new';
    if (currentHash === customer) {
        hasher.changed.active = true;
        hasher.replaceHash('sales/new');
    }
    var patt = /^[a-f\d]{24}$/i;
    var parts = currentHash.split('/');
    if (typeof parts[1] !== 'undefined' && patt.test(parts[1])) {
        if (parts[0] === 'sales' && (parts[2] === 'hold' || parts[2] === 'edit')) {
            hasher.setHash(parts[0] + '/' + parts[1] + '/' + parts[2]);
        } else {
            hasher.setHash(parts[0]);
        }
    } else if (parts[0] === 'sales') {
        hasher.setHash(parts[0] + '/' + parts[1]);
    } else if (parts[0] === 'kotorder' && parts[1] === 'new') {
        hasher.setHash(parts[0] + '/' + parts[1]); // Keep kotorder/new intact
    } else if (parts[1] === 'new' || parts[1] === 'tax' || parts[1] === 'unit' || parts[1] === 'taxgroup' || parts[1] === 'denom' || parts[1] === 'default' || parts[1] === 'payment' || parts[1] === 'tableorder') {
        hasher.setHash(parts[0]); //set hash without dispatching changed signal
    } else if (parts[2] === 'new' && parts[2] !== 'sales/categories/new') {
        hasher.setHash(parts[0] + '/' + parts[2]); //set hash without dispatching changed signal
    }

    let stringData = $(this).data("id");
    let hash = window.location.hash.slice(1);
    if (stringData === 'category' && hash === '/sales/new') {
        $("#infobar-settings-sidebar-instance").addClass("sidebarshow");
        $("#infobar-settings-sidebar-category").removeClass("sidebarshow");
        hasher.replaceHash('sales/instant/new');
    } else {
        $("#infobar-settings-sidebar-category").removeClass("sidebarshow");
    }
    e.preventDefault();
    $(".infobar-settings-sidebar-overlay").css({ "background": "transparent", "position": "initial" });
    $("#infobar-settings-sidebar-" + stringData).removeClass("sidebarshow");
    $("#infobar-settings-sidebar-" + stringData + "-details").removeClass("sidebarview");
    $('.error_' + stringData).css('display', 'none');
    $('.error').css('display', 'none');
});
$(".infobar-denom-close").on("click", function (e) {
    e.preventDefault();
    var parts = currentHash.split('/');
    if (parts[0] + '/' + parts[1] === 'registers/denom' || parts[0] + '/' + parts[2] === 'registers/cashregister') {
        hasher.setHash('registers/registers/cashregister');
    } else {
        hasher.setHash(parts[0]);
    }
    $(".infobar-settings-sidebar-overlay").css({ "background": "transparent", "position": "initial" });
    $("#infobar-settings-sidebar-denom").removeClass("sidebarshow");
    $("#infobar-settings-sidebar-denomcash").removeClass("sidebarshow");
});
$(".infobar-tender-close").on("click", function (e) {
    e.preventDefault();
    $(".infobar-settings-sidebar-overlay").css({ "background": "transparent", "position": "initial" });
    $("#infobar-settings-sidebar-tender-details").removeClass("sidebarview");
    $("#infobar-settings-sidebar-profile-details").removeClass("sidebarview");
    $('#save_btn').attr("disabled", false).css({ cursor: 'pointer', color: '#43d187' });
    $('.cash_active').addClass('active');
    $('.qr_active ').removeClass('active');
    $('.change_active').removeClass('active');
    $('#Partial_amount').val('');

    // If tender was opened from a payment-only flow, go back to the
    // appropriate history page and reset flags, without impacting
    // normal sale / edit / return flows.
    if (window.PosnicPro && PosnicPro.sales && PosnicPro.sales.paymentOnlyMode === true) {
        try {
            if (typeof hasher !== 'undefined') {
                hasher.changed.active = false;
                if (PosnicPro.sales.kotPaymentMode === true) {
                    hasher.replaceHash('kot');
                } else {
                    hasher.replaceHash('sales');
                }
                hasher.changed.active = true;
            }
        } catch (e) {
            // ignore routing errors
        }

        if (PosnicPro.sales.kotPaymentMode === true && PosnicPro.kot && typeof PosnicPro.kot.showDataTablePage === 'function') {
            PosnicPro.kot.showDataTablePage();
        } else if (typeof PosnicPro.sales.showDataTablePage === 'function') {
            PosnicPro.sales.showDataTablePage();
        }

        PosnicPro.sales.paymentOnlyMode = false;
        PosnicPro.sales.kotPaymentMode = false;
        PosnicPro.sales.originalSaleData = null;
    }
});
$(".infobar-transaction-close").on("click", function (e) {
    e.preventDefault();
    var parts = currentHash.split('/');
    hasher.setHash(parts[0] + '/' + parts[1]);
    $(".infobar-settings-sidebar-overlay").css({ "background": "transparent", "position": "initial" });
    $("#infobar-settings-sidebar-transaction").removeClass("sidebarshow");
});

$('#onclickExportButton').click(function () {
    let selectedTableRow = $('#selectrow').val().split(",");
    let table = $('#table_row').val();
    PosnicPro.getExportValue(selectedTableRow, table);
});

$('.custom_report_search_input').on('keyup', function (event) {
    if (event.keyCode == 8 || event.keyCode == 46) {
        let module = $(this).data('id');
        $('.' + module + '_input_id').val('');
    }
});
/*
 * White label. The logos are swapped by the server on the stock image paths,
 * so only the visible product name has to be handled here. Runs on every page
 * because this file is in every bundle.
 *
 * Deliberately silent on failure: an unbranded till is a cosmetic problem,
 * a till that will not load is not.
 */
(function applyBrand() {
    function paint(brand) {
        if (!brand || !brand.enabled || !brand.name) return;
        // Read by the desktop title bar, which is built before this runs on a
        // cold load and must not fall back to our name.
        window.POSNIC_BRAND_NAME = brand.name;
        $('h1.title_h2').text(brand.name);
        if (document.title) {
            document.title = document.title.replace(/PosnicPro|POSNIC|Posnic/g, brand.name);
        }
        $('img[alt="logo"], .logobar img').attr('alt', brand.name);
        // The bar may already be on screen with the old title in it.
        $('.posnic-titlebar span').text(document.title || brand.name);
    }
    try {
        var cached = window.localStorage && localStorage.getItem('posnic_brand');
        if (cached) paint(JSON.parse(cached));   // no flash of the stock name
    } catch (e) { /* private mode, or nothing cached yet */ }

    $(function () {
        $.getJSON('brand.json').done(function (brand) {
            try {
                localStorage.setItem('posnic_brand', JSON.stringify(brand));
            } catch (e) { /* storage full or blocked */ }
            paint(brand);
        });
    });
})();

/*
 * Desktop title bar.
 *
 * The window hides the one Windows draws, because its height is not ours to
 * set and it shrinks further when maximised. This puts the app's own bar in
 * that space: draggable, readable, and carrying the brand rather than "Posnic"
 * regardless of who the shop is.
 *
 * Only runs inside the desktop app. A shop opened in a browser has a real
 * title bar already and must not get a second one.
 */
(function desktopTitlebar() {
    if (navigator.userAgent.indexOf('Electron') === -1) return;
    document.documentElement.classList.add('is-electron');

    $(function () {
        if (document.querySelector('.posnic-titlebar')) return;
        var bar = document.createElement('div');
        bar.className = 'posnic-titlebar';

        /*
         * The name of the screen you are on, not the brand.
         *
         * The brand was already in three places at once: the icon on the
         * collapsed rail, the wordmark above the menu, and this bar carrying
         * both a logo and the name again. Four sightings of the same word,
         * none of them telling you anything. The one piece of information a
         * title bar can usefully hold is where you are, so put that there.
         */
        var label = document.createElement('span');
        bar.appendChild(label);

        /*
         * Our own minimise, maximise and close.
         *
         * Windows will draw these itself in an overlay, and that overlay is a
         * separate surface it paints its own way - so the strip ended up two
         * shades, one for the bar and one for the region behind the buttons,
         * and no amount of handing it the same colour made them agree. A shop
         * reported it three times.
         *
         * Drawing them here removes the overlay from the picture: one element,
         * one background, one colour, whatever the theme is. It is what VS Code
         * does on Windows and for the same reason. The cost is that these are
         * ours to get right - the hover states, the red close, and marking them
         * no-drag so they can be clicked at all on a strip that drags the
         * window.
         */
        var controls = document.createElement('div');
        controls.className = 'posnic-window-controls';

        var buttons = [
            /* fill is spelled out on every shape. An SVG shape with no fill
               defaults to black, which is how the minimise bar came out dark
               on a dark title bar while the other two - drawn with stroke -
               were correctly following the text colour. */
            { name: 'minimize', label: 'Minimise',
              path: '<rect x="2" y="5.5" width="8" height="1" fill="currentColor" />' },
            /* Two icons, because this button means two different things. Not
               maximised it maximises, and shows one square. Maximised it
               restores, and every other application on the machine draws two
               overlapping squares for that - one square there tells the shop
               the click will do something it will not. See paintMaximise. */
            { name: 'maximize', label: 'Maximise',
              path: '<rect x="2.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" />' },
            { name: 'close', label: 'Close',
              path: '<path d="M2.5 2.5 L9.5 9.5 M9.5 2.5 L2.5 9.5" stroke="currentColor" fill="none" />' }
        ];

        buttons.forEach(function (b) {
            var el = document.createElement('button');
            el.type = 'button';
            el.className = 'posnic-window-control is-' + b.name;
            el.setAttribute('aria-label', b.label);
            el.title = b.label;
            el.innerHTML = '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">'
                + b.path + '</svg>';
            el.addEventListener('click', function () {
                try {
                    if (window.electronAPI && window.electronAPI.window) {
                        window.electronAPI.window[b.name]();
                    }
                } catch (e) { /* the window stays as it is */ }
            });
            controls.appendChild(el);
        });
        /*
         * Keep the middle button honest about what it will do.
         *
         * The back square is the window behind, the front one the restored size. Drawn
         * into the same 12x12 box as the other two, so nothing shifts when the state
         * changes.
         */
        var MAXIMISE_ICON = '<rect x="2.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" />';
        var RESTORE_ICON  = '<rect x="4" y="1.5" width="6.5" height="6.5" fill="none" stroke="currentColor" />'
                          + '<rect x="1.5" y="4" width="6.5" height="6.5" fill="none" stroke="currentColor" />';

        function paintMaximise(maximised) {
            var btn = controls.querySelector('.is-maximize');
            if (!btn) return;
            var svg = btn.querySelector('svg');
            if (!svg) return;
            svg.innerHTML = maximised ? RESTORE_ICON : MAXIMISE_ICON;
            var label = maximised ? 'Restore down' : 'Maximise';
            btn.setAttribute('aria-label', label);
            btn.title = label;
        }

        try {
            if (window.electronAPI && window.electronAPI.window) {
                /* Asked on load, because the window can already be maximised: Windows
                   remembers, so a shop that snapped it yesterday opens maximised. */
                if (window.electronAPI.window.isMaximized) {
                    window.electronAPI.window.isMaximized().then(paintMaximise).catch(function () {});
                }
                /* And on every change, since double-clicking the bar, Win+Up and the
                   Windows snap gesture all maximise without touching this button. */
                if (window.electronAPI.window.onMaximizeChange) {
                    window.electronAPI.window.onMaximizeChange(paintMaximise);
                }
            }
        } catch (e) { /* the button still works; it just will not change shape */ }

        bar.appendChild(controls);
        document.body.insertBefore(bar, document.body.firstChild);

        /*
         * The window title: "Sridhar - POS".
         *
         * Not a clock - the taskbar already has one, and a second clock two
         * inches away is noise. Not the current page either: the rail icons
         * carry the same active class as the menu items, so there is no single
         * element that honestly answers "where am I", and the first attempt at
         * it showed "Branches List" while the user was on Sales History.
         *
         * document.title is the one string that is already correct. It says
         * what the window is, applyBrand has already rebranded it, and it
         * matches what Windows shows in the taskbar and Alt-Tab - so the strip
         * agrees with the rest of the system instead of inventing its own idea.
         * Nothing to detect, nothing to keep in step.
         */
        function paintLabel() {
            label.textContent = document.title || '';
        }
        paintLabel();
        // applyBrand rewrites the title once brand.json answers, so pick that
        // up rather than showing the stock name until the next navigation.
        setTimeout(paintLabel, 1500);
    });
})();

// Shift header state at page load: show/hide the clock button and roster menu
// per the shop's settings, and light the on-shift dot if the user is clocked
// in. The shift modal keeps both in sync afterwards.
$(function () {
    if (PosnicPro.shiftWidget) {
        PosnicPro.shiftWidget.applyEnabled();
        PosnicPro.shiftWidget.syncHeader();
    }
    if (PosnicPro.bellFeed) PosnicPro.bellFeed.init();
    if (PosnicPro.applyModuleSidebar) PosnicPro.applyModuleSidebar();
});

/* Labour / payout report page (#/labourreport) - a report page like the other
 * reports, fed by the shiftWidget report/export functions it always used.
 * The route table dispatches {module} -> PosnicPro.labourreport. */
PosnicPro.labourreport = {
    showDataTablePage: function () {
        PosnicPro.HideSideBarModal();
        $(".vertical-layout").removeClass("toggle-menu");
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $(".vertical-menu li a").removeClass("active");
        $('.page_loader,#osk-container').hide();
        $('.page-title-box,#labourreport_new').show();
        $('#v-pills-report-tab,#viewlabourreport_page').addClass('active');
        $('#v-pills-report').addClass('show active');
        // Land with data: default to the last 30 days and run immediately.
        var to = new Date();
        var from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
        $('#labour_report_from').val(PosnicPro.shiftWidget._fmtDate(from));
        $('#labour_report_to').val(PosnicPro.shiftWidget._fmtDate(to));
        PosnicPro.shiftWidget.runReport();
    }
};
