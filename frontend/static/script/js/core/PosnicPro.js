/*
 * Tooltips are a hover concept, and a phone has no hover.
 *
 * What they delivered on touch devices instead: Bootstrap's sanitizer runs
 * the template through DOMParser once per CONSTRUCTION - a full throwaway
 * HTML document each time - and the modules re-initialise their tooltips on
 * every render. Measured on the owner's crash hunt: 240 documents
 * manufactured at boot, +160 per navigation cycle, on a tab iOS was already
 * killing for memory. Plus the classic stuck-tooltip-after-tap jank.
 *
 * One door: on a coarse-pointer device the whole plugin becomes a chainable
 * no-op, so every existing call site stays byte-identical and costs nothing.
 * Desktop keeps real tooltips. Popover is NOT gated - it can be legitimate
 * tap-driven UI (summernote's toolbars use it).
 */
(function () {
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches
        && window.jQuery && jQuery.fn.tooltip) {
        var real = jQuery.fn.tooltip;
        var noop = function () { return this; };
        noop.Constructor = real.Constructor;
        noop.noConflict = function () { jQuery.fn.tooltip = real; return noop; };
        jQuery.fn.tooltip = noop;
    }
})();

/*
 * The deferred panes (PAGE_SPLIT_ANALYSIS Option A, first slice).
 *
 * The build wraps every report pane in <template class="pane-defer"> -
 * parsed, never rendered, no standing DOM. Inflating replaces the template
 * with its own content, markup byte-identical to the old page, so every
 * selector and test downstream behaves as before.
 *
 * Desktop inflates everything right here, at core load - before any other
 * bundle file runs, which keeps desktop behaviour indistinguishable from
 * the pre-template page. A phone keeps the panes furled and inflates them
 * at ONE choke point: the first PosnicPro.lazy.load('reports') call - the
 * moment a report route is actually entered - which also runs before the
 * chunk's own top-level code can look for its markup.
 */
var __panesInflatedLate = false;
function __posnicInflatePanes() {
    document.querySelectorAll('template.pane-defer').forEach(function (tpl) {
        if (tpl.content && tpl.content.firstChild) {
            tpl.replaceWith(tpl.content);
        } else if (tpl.__paneHtml) {
            /* phone path: the pane lives as a STRING - parse it back into
               exactly the spot the template holds */
            tpl.insertAdjacentHTML('beforebegin', tpl.__paneHtml);
            tpl.__paneHtml = null;
            tpl.remove();
            __panesInflatedLate = true;
        } else {
            tpl.remove();
        }
    });
}

/*
 * A pane inflated after boot missed every boot-time BROADCAST: the branch
 * fill (setBranchDropdownOption writes every .load-select-branch select on
 * the page - the Day-End report's own filter among them), the tax fill,
 * the currency signs, the date pickers. The owner's first phone report
 * after the furl: "i dont see any details inside" - the report's guard
 * read its empty branch select and silently returned.
 *
 * So inflation owes a repair, and the branch fill must COMPLETE before a
 * report can run its guard - it is awaited inside the reports chunk's
 * load promise; the rest may land eventually.
 */
function __posnicRepairInflatedPanes() {
    if (!__panesInflatedLate) { return Promise.resolve(); }
    __panesInflatedLate = false;
    try { $('.display-currency').html(PosnicPro.local.get('currencySign') || ''); } catch (e) { }
    /* selects born after boot never met select2 - the branch setter calls
       .select2('val', ...) and select2 throws at uninitialised elements */
    try {
        $('select.select2').each(function () {
            if (!$(this).data('select2')) { $(this).select2(); }
        });
    } catch (e) { }
    try { PosnicPro.dashboard.datePicker(); } catch (e) { }
    try { PosnicPro.getBranchTaxList(); } catch (e) { }
    return new Promise(function (resolve) {
        var done = function () { resolve(); };
        try {
            PosnicPro.get('branches/getBranchList', function (response) {
                try {
                    if (response.type === 'success') {
                        PosnicPro.setBranchDropdownOption(response.data);
                    }
                } catch (e) { }
                done();
            }, done);
        } catch (e) { done(); }
    });
}
window.__posnicInflatePanes = __posnicInflatePanes;
if (!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches)) {
    __posnicInflatePanes();
} else {
    /*
     * The honest phone win is NODE MEMORY, and a template's content is
     * still 6,442 parsed nodes - display:none panes never had render
     * boxes to save. So on a phone the furled panes are demoted further:
     * each template keeps its pane as one STRING (bytes, roughly a tenth
     * of the same markup as live nodes) and the parsed fragment is
     * dropped for the collector. The empty template element stays as the
     * position marker; inflation parses the string back into place.
     */
    document.querySelectorAll('template.pane-defer').forEach(function (tpl) {
        tpl.__paneHtml = tpl.innerHTML;
        tpl.innerHTML = '';
    });
}

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

    /*
     * Is this list showing a filtered view, or all of it?
     *
     * An empty list means two completely different things and the difference
     * is invisible from the row count alone. "No items yet - add your first
     * item" told a shop with five thousand items, whose search happened to
     * match none of them, that their catalogue was empty. That is the same
     * failure quotes had: an answer that is confidently wrong is worse than no
     * answer, because it sends somebody looking for missing DATA instead of
     * fixing their SEARCH.
     *
     * search() is the one place a list's filters are set, so this reads what
     * that wrote rather than inspecting the inputs - a date range left in the
     * box but never applied is not a filter, and asking the inputs would count
     * it as one.
     */
    hasActiveFilters: function (module) {
        var raw = $('#view_' + module).data('filters');
        if (!raw) { return false; }
        if (typeof raw === 'object') { return Object.keys(raw).length > 0; }
        try {
            var parsed = JSON.parse(raw);
            return !!parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0;
        } catch (e) {
            /* Unparseable is not "filtered" - it is broken, and claiming a
               filter is active would hide every row behind a message about a
               search nobody can see or clear. */
            return false;
        }
    },

    /*
     * Put a list back to showing everything.
     *
     * dateRangefilterClear empties the INPUTS but leaves data('filters') and
     * never reloads, so on its own it makes the controls disagree with the
     * rows on screen until Apply is pressed again. An empty-state offering to
     * clear the search has to actually clear it.
     */
    clearListFilters: function (module) {
        var table = $('#view_' + module);
        $('#view_' + module + '_input').val('');
        $('.hide_value_filetr').hide();
        $('.view_' + module + '_filter_value').hide();
        table.data('filters', '');
        table.data('current_page', 1);
        var mod = PosnicPro[module];
        if (mod && typeof mod[module + 'Table'] === 'function') {
            mod[module + 'Table']('#view_' + module);
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
            $('.daterange-timepicker-all span').html(PosnicPro.i18n.t('lang_all_time', 'All Time'));
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
        $('.daterange-timepicker span').html('<span><lang class="lang_this_month">This Month</lang></span>&nbsp;&nbsp;<span  data-toggle="tooltip" data-placement="top" data-original-title="' + moment().startOf('month').startOf('day').format('YYYY/MM/DD h:mm A') + ' - ' + moment().endOf('day').format('YYYY/MM/DD h:mm A') + '"><i class="feather icon-help-circle setfeather_font"></i></span>');
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
        $('.daterange-timepicker-all span').html('<span><lang class="lang_this_month">This Month</lang></span>&nbsp;&nbsp;<span  data-toggle="tooltip" data-placement="top" data-original-title="' + moment().startOf('month').startOf('day').format('YYYY/MM/DD h:mm A') + ' - ' + moment().endOf('day').format('YYYY/MM/DD h:mm A') + '"><i class="feather icon-help-circle setfeather_font"></i></span>');
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
            PosnicPro.alert('error', PosnicPro.i18n.t('lang_request_faild', 'Request Faild!!.'));
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
        // 2500, down from 4500 (owner: "reduce auto close time") - a
        // confirmation is read in a glance; errors linger a little longer
        // because they carry something to act on.
        if (typeof hideAfter === 'undefined') {
            hideAfter = String(heading).toLowerCase() === 'error' ? 4000 : 2500;
        }
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
        /*
         * A branch without a configured default customer sells to Walk-In -
         * fetching with an empty id is what threw "customer required" 400s
         * on every branch except the one that had a default set.
         */
        let customerDefaultData = null;
        try {
            customerDefaultData = JSON.parse(PosnicPro.local.get('defaultcustomer'));
        } catch (e) { return; }
        // Even with no stored id the server now answers: it finds or
        // creates this branch's Walk-in and heals the branch pointer.
        var defId = (customerDefaultData && customerDefaultData.customer_id) || '';
        var params = {
            url: 'setting/getDefaultCustomer',
            data: { data: { customer: defId } }
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
                // the fields arrive asynchronously - refresh the chip, or it
                // keeps showing whoever the previous sale was for
                if (PosnicPro.sales && PosnicPro.sales.updateCustomerChip) {
                    PosnicPro.sales.updateCustomerChip();
                }
            } else {
                // This branch simply has no default customer - Walk-In it is.
                // An error toast on every sale-page load taught nothing.
            }
        }, function () { /* same: absent default is a state, not an error */ });

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
            $('.changeSalesBtnText').text(PosnicPro.i18n.t('lang_updatebtn_title', 'Update'));
        } else {
            $('.changeSalesBtnText').text(PosnicPro.i18n.t('lang_save_title', 'Save'));
        }

    },
    defaultSupplierSet: function () {
        $('.changeReceivingText').text(PosnicPro.i18n.t('lang_save_title', 'Save'));
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
                $('#receiving_add_supplier_name').val(responseData['supplier_name'])
                    .data('prefilled-default', {
                        id: responseData['supplier_id'],
                        name: responseData['supplier_name'],
                        phone: responseData['supplier_phone'] || ''
                    });
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

        addNewBranch = '<option data-page="branches/new" class="page_url" value="true" data-t="lang_add_new_branch">Add New Branch</option>';
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
                    taxOption += '<option selected="selected" value="0" data-t="lang_no_tax">No tax</option>';
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
     * The chart libraries (1.5MB, since removed outright), jsPDF (619KB) and html2canvas
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
            jspdf: ['script/lazy/jspdf2.js'],
            html2canvas: ['script/lazy/html2canvas.js'],
            sortable: ['script/lazy/sortable.js'],
            summernote: ['script/lazy/summernote.js'],
            colorpicker: ['script/lazy/colorpicker.js'],
            reports: ['script/lazy/reports.js'],
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
            /* a phone's furled report panes must exist before the chunk's
               own code goes looking for them */
            if (name === 'reports') { __posnicInflatePanes(); }
            if (PosnicPro.lazy._loads[name]) return PosnicPro.lazy._loads[name];
            var files = PosnicPro.lazy._sets[name] || [];
            var p = files.reduce(function (prev, url) {
                return prev.then(function () { return PosnicPro.lazy._script(url); });
            }, Promise.resolve());
            if (name === 'reports') {
                /* the late panes' broadcasts (branch fill above all) must be
                   in place before the router runs a report's own code */
                p = p.then(function () { return __posnicRepairInflatedPanes(); });
            }
            p = p.catch(function (err) {
                /* A failed load must be retryable on the next click, never
                   cached as forever-broken. */
                delete PosnicPro.lazy._loads[name];
                PosnicPro.alert('error', PosnicPro.i18n.t('lang_could_not_load_the_report_tools_check_the', 'Could not load the report tools - check the connection and try again.'));
                throw err;
            });
            p = p.then(function () {
                var init = PosnicPro.lazy._afterLoad[name];
                if (init && !init._ran) { init._ran = true; init(); }
            });
            PosnicPro.lazy._loads[name] = p;
            return p;
        },

        /*
         * One-time taming, the moment a library lands - BEFORE any page draws
         * with it, so every caller inherits the same rules.
         */
        /* One-time taming hooks, keyed by set name; ran once after a set
           loads. Empty since the chart purge - the shape stays for the next
           library that needs it. */
        _afterLoad: {},
    },

    /*
     * Report exports (owner ask): every report should leave the screen as a
     * professional A4 PDF, a CSV, or an Excel sheet - never a themed
     * screenshot. gather() walks the on-screen report so every export agrees
     * with the page; the PDF is drawn as real text on white with its own
     * fixed palette, independent of the app theme.
     */
    reportExport: {
        /* Currency signs jsPDF's built-in fonts cannot draw. */
        _pdfText: function (t) {
            return String(t == null ? '' : t)
                .replace(/\u20b9\s?/g, 'Rs ')
                .replace(/\u20ac\s?/g, 'EUR ')
                .replace(/\u00a3\s?/g, 'GBP ')
                .replace(/\s+/g, ' ').trim();
        },
        _isNum: function (t) {
            var c = String(t || '').replace(/[\u20b9$\u20ac\u00a3,%\s]|Rs/g, '');
            return c !== '' && /^-?[\d.,]+$/.test(c);
        },
        /* Headings and tables in DOM order; a heading names the tables after it. */
        gather: function (elId) {
            var el = document.getElementById(elId) || document.querySelector(elId);
            if (!el) { return null; }
            var out = [];
            var title = '';
            $(el).find('h1,h2,h3,h4,h5,h6,table').each(function () {
                if (this.tagName !== 'TABLE') {
                    var t = $.trim($(this).text()).replace(/\s+/g, ' ');
                    if (t) { title = t; }
                    return;
                }
                // Export-only tables ride along even though hidden on screen
                // (the day-end summary numbers live in cards, not tables).
                if (!$(this).is(':visible') && !$(this).is('[data-export-include]')) { return; }
                // Identity blocks (page titles, shop headers) opt out - the
                // PDF draws its own header band.
                if ($(this).closest('[data-export-skip]').length || $(this).is('[data-export-skip]')) { return; }
                var rows = [];
                $(this).find('tr').each(function () {
                    var cells = [];
                    $(this).children('th,td').each(function () {
                        cells.push($.trim($(this).text()).replace(/\s+/g, ' '));
                    });
                    if (cells.join('') !== '') { rows.push({ head: $(this).children('th').length > 0, cells: cells }); }
                });
                if (rows.length) {
                    // Reports often mark their header row with styled <td>s,
                    // not <th> - treat the first of several rows as the header.
                    if (rows.length > 1) { rows[0].head = true; }
                    out.push({ title: title, rows: rows }); title = '';
                }
            });
            return out.length ? out : null;
        },
        _buildDoc: function (elId, meta, jsPDFCtor) {
            var ex = PosnicPro.reportExport;
            var sections = ex.gather(elId);
            if (!sections) { PosnicPro.alert('warning', PosnicPro.i18n.t('lang_run_the_report_first_then_export_it', 'Run the report first, then export it.')); return null; }
            var doc = new jsPDFCtor({ unit: 'mm', format: 'a4', orientation: 'portrait' });
            var W = 210, M = 14, bottom = 283;
            var y = M;
            var totalAlias = '{tp}';
            var footer = function () {
                doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(140, 148, 160);
                doc.text('Page ' + doc.internal.getNumberOfPages() + ' of ' + totalAlias, W - M, 292, { align: 'right' });
                doc.text(ex._pdfText(meta.shop || '') + '  -  generated ' + new Date().toLocaleString('en-IN'), M, 292);
            };
            // Header band: shop identity left, report identity right.
            doc.setTextColor(26, 32, 44);
            doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
            doc.text(ex._pdfText(meta.shop || 'Report'), M, y + 2);
            doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(110, 118, 130);
            var sub = [meta.address, meta.phone].filter(Boolean).map(ex._pdfText);
            for (var i = 0; i < sub.length; i++) { doc.text(sub[i], M, y + 7 + i * 4); }
            doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(26, 32, 44);
            doc.text(ex._pdfText(meta.title || 'Report'), W - M, y + 2, { align: 'right' });
            doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(110, 118, 130);
            if (meta.range) { doc.text(ex._pdfText(meta.range), W - M, y + 7, { align: 'right' }); }
            y += 7 + Math.max(sub.length, 1) * 4 + 3;
            doc.setDrawColor(45, 55, 72); doc.setLineWidth(0.5);
            doc.line(M, y, W - M, y);
            y += 6;
            // The period the reader is looking at, unmissable (owner ask).
            if (meta.range) {
                doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(70, 78, 92);
                doc.text('Period: ' + ex._pdfText(meta.range), M, y);
                y += 6;
            }

            /*
             * Proven table engine (verified against a rendered reproduction):
             * body-measured natural widths, headers wrap at 22mm instead of
             * forcing columns, font autoscales down (8.3 -> 6.6) until wide
             * tables fit one line per cell, long tokens soft-chunk, numeric
             * columns right-align header included. No fills - print-friendly.
             */
            var padX = 1.5, padY = 1.7;
            sections.forEach(function (sec) {
                var cols = 0;
                sec.rows.forEach(function (r) { cols = Math.max(cols, r.cells.length); });
                if (!cols) { return; }
                var tableW = W - M * 2;

                var fs = 8.3, maxW = [], numCount = [], bodyRows = 0;
                for (var attempt = 0; attempt < 6; attempt++) {
                    doc.setFont('helvetica', 'normal'); doc.setFontSize(fs);
                    maxW = []; numCount = []; bodyRows = 0;
                    for (var c0 = 0; c0 < cols; c0++) { maxW.push(6); numCount.push(0); }
                    sec.rows.forEach(function (r, ri) {
                        if (ri > 0) { bodyRows++; }
                        r.cells.forEach(function (cell, c) {
                            var measured = doc.getTextWidth(ex._pdfText(cell)) + padX * 2 + 2;
                            var w = (ri === 0 && sec.rows.length > 1) ? Math.min(measured, 22) : Math.min(measured, 70);
                            if (w > maxW[c]) { maxW[c] = w; }
                            if (ri > 0 && ex._isNum(cell)) { numCount[c] += 1; }
                        });
                    });
                    var need = maxW.reduce(function (a, b) { return a + b; }, 0);
                    if (need <= tableW || fs <= 6.6) { break; }
                    fs -= 0.4;
                }
                var lineH = fs * 0.47;
                var rightCol = maxW.map(function (_, c) {
                    return bodyRows > 0 && numCount[c] >= bodyRows * 0.6;
                });
                var wSum = maxW.reduce(function (a, b) { return a + b; }, 0);
                var scaleW = wSum > tableW ? tableW / wSum : 1;
                var colW = maxW.map(function (w) { return w * scaleW; });
                var usedW = colW.reduce(function (a, b) { return a + b; }, 0);

                if (y + 14 > bottom) { footer(); doc.addPage(); y = M; }
                if (sec.title) {
                    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(26, 32, 44);
                    doc.text(ex._pdfText(sec.title), M, y);
                    y += 5;
                }
                var headRow = sec.rows.length > 1 ? sec.rows[0] : null;
                var chunkFit = function (txt, wAvail) {
                    var out = [], cur = '';
                    String(txt).split('').forEach(function (ch) {
                        if (cur && doc.getTextWidth(cur + ch) > wAvail) { out.push(cur); cur = ch; }
                        else { cur += ch; }
                    });
                    if (cur) { out.push(cur); }
                    return out.length ? out : [''];
                };
                var drawRow = function (r, isHead) {
                    doc.setFont('helvetica', isHead || r.head ? 'bold' : 'normal');
                    doc.setFontSize(fs);
                    var linesPer = r.cells.map(function (cell, c) {
                        var wAvail = colW[Math.min(c, colW.length - 1)] - padX * 2;
                        var lines = [];
                        doc.splitTextToSize(ex._pdfText(cell), wAvail).forEach(function (ln) {
                            if (doc.getTextWidth(ln) <= wAvail) { lines.push(ln); }
                            else { chunkFit(ln, wAvail).forEach(function (p2) { lines.push(p2); }); }
                        });
                        return lines.slice(0, 3);
                    });
                    var maxLines = 1;
                    linesPer.forEach(function (l) { maxLines = Math.max(maxLines, l.length); });
                    var rowH = maxLines * lineH + padY * 2;
                    if (y + rowH > bottom) {
                        footer(); doc.addPage(); y = M;
                        if (headRow && !isHead) { drawRow(headRow, true); }
                    }
                    doc.setFont('helvetica', isHead || r.head ? 'bold' : 'normal');
                    doc.setTextColor(26, 32, 44);
                    var x = M;
                    for (var c = 0; c < r.cells.length; c++) {
                        var wCol = colW[Math.min(c, colW.length - 1)];
                        var lines = linesPer[c];
                        var right = rightCol[Math.min(c, rightCol.length - 1)];
                        for (var li = 0; li < lines.length; li++) {
                            if (right) { doc.text(lines[li], x + wCol - padX, y + padY + lineH * (li + 0.78), { align: 'right' }); }
                            else { doc.text(lines[li], x + padX, y + padY + lineH * (li + 0.78)); }
                        }
                        x += wCol;
                    }
                    if (isHead) { doc.setDrawColor(45, 55, 72); doc.setLineWidth(0.4); }
                    else { doc.setDrawColor(228, 232, 238); doc.setLineWidth(0.12); }
                    doc.line(M, y + rowH, M + usedW, y + rowH);
                    y += rowH;
                };
                sec.rows.forEach(function (r, i) {
                    drawRow(r, i === 0 && sec.rows.length > 1);
                });
                y += 7;
            });
            footer();
            if (typeof doc.putTotalPages === 'function') { doc.putTotalPages(totalAlias); }
            return doc;
        },
        _withPdf: function (elId, meta, use) {
            PosnicPro.lazy.load('jspdf').then(function () {
                var C = (window.jspdf && typeof window.jspdf.jsPDF === 'function') ? window.jspdf.jsPDF
                    : (typeof window.jsPDF === 'function') ? window.jsPDF
                    : (typeof window.jspdf === 'function') ? window.jspdf : null;
                if (!C) { PosnicPro.alert('error', PosnicPro.i18n.t('lang_pdf_tools_not_loaded_refresh_and_retry', 'PDF tools not loaded - refresh and retry.')); return; }
                var doc = PosnicPro.reportExport._buildDoc(elId, meta, C);
                if (doc) { use(doc); }
            });
        },
        pdf: function (elId, meta) {
            PosnicPro.reportExport._withPdf(elId, meta, function (doc) {
                doc.save((meta.filename || 'report') + '.pdf');
            });
        },
        printPdf: function (elId, meta) {
            PosnicPro.reportExport._withPdf(elId, meta, function (doc) {
                if (typeof doc.autoPrint === 'function') { doc.autoPrint(); }
                var url = doc.output('bloburl');
                var w = window.open(url, '_blank');
                if (!w) { PosnicPro.alert('warning', PosnicPro.i18n.t('lang_allow_pop_ups_so_the_report_can_print', 'Allow pop-ups so the report can print.')); }
            });
        },
        _download: function (blob, filename) {
            var a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
        },
        csv: function (elId, meta) {
            var sections = PosnicPro.reportExport.gather(elId);
            if (!sections) { PosnicPro.alert('warning', PosnicPro.i18n.t('lang_run_the_report_first_then_export_it', 'Run the report first, then export it.')); return; }
            var esc = function (v) { return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
            var lines = [];
            if (meta.title) { lines.push(esc(meta.title + (meta.range ? ' (' + meta.range + ')' : ''))); lines.push(''); }
            sections.forEach(function (sec) {
                if (sec.title) { lines.push(esc(sec.title)); }
                sec.rows.forEach(function (r) { lines.push(r.cells.map(esc).join(',')); });
                lines.push('');
            });
            var blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
            PosnicPro.reportExport._download(blob, (meta.filename || 'report') + '.csv');
        },
        /* Email the exact PDF the user would download - address typed in a
           small modal, the send happens server-side. */
        email: function (elId, meta, builder) {
            var ex = PosnicPro.reportExport;
            if (!$('#report_email_modal').length) {
                $('body').append(
                    '<div class="modal fade" id="report_email_modal" tabindex="-1" role="dialog" aria-hidden="true">'
                    + '<div class="modal-dialog modal-dialog-centered modal-sm" role="document"><div class="modal-content">'
                    + '<div class="modal-header py-2"><h5 class="modal-title"><lang class="lang_email_this_report">Email this report</lang></h5>'
                    + '<button type="button" class="close" data-dismiss="modal">&times;</button></div>'
                    + '<div class="modal-body">'
                    + '<label class="mb-0 small text-muted" for="report_email_to"><lang class="lang_send_to">Send to</lang></label>'
                    + '<input type="email" class="form-control" id="report_email_to" placeholder="name@example.com" autocomplete="off">'
                    + '</div>'
                    + '<div class="modal-footer py-2">'
                    + '<button type="button" class="btn btn-secondary-rgba" data-dismiss="modal"><lang class="lang_cancel_title">Cancel</lang></button>'
                    + '<button type="button" class="btn btn-primary" id="report_email_send"><lang class="lang_send">Send</lang></button>'
                    + '</div></div></div></div>');
                $(document).on('click', '#report_email_send', function () {
                    var to = $.trim($('#report_email_to').val());
                    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
                        PosnicPro.alert('error', PosnicPro.i18n.t('lang_enter_a_valid_email_address_2', 'Enter a valid email address'));
                        return;
                    }
                    var m = PosnicPro.reportExport._emailJob || {};
                    $('#report_email_send').prop('disabled', true);
                    var build = m.builder || function (cb) { PosnicPro.reportExport._withPdf(m.elId, m.meta, cb); };
                    build(function (doc) {
                        var b64 = String(doc.output('datauristring')).split(',')[1] || '';
                        PosnicPro.post({
                            url: 'reports/email',
                            data: JSON.stringify({ to: to, pdf_base64: b64, filename: (m.meta || {}).filename, title: (m.meta || {}).title })
                        }, function (r) {
                            $('#report_email_send').prop('disabled', false);
                            PosnicPro.alert(r.type, r.message);
                            if (r.type === 'success') {
                                $('#report_email_modal').modal('hide');
                                if (m.meta && typeof m.meta.onSent === 'function') { m.meta.onSent(); }
                            }
                        }, function (xhr) {
                            $('#report_email_send').prop('disabled', false);
                            var resp = {}; try { resp = JSON.parse(xhr.responseText); } catch (e) { /* plain */ }
                            PosnicPro.alert('error', resp.message || 'Could not email the report');
                        });
                    });
                });
            }
            PosnicPro.reportExport._emailJob = { elId: elId, meta: meta, builder: builder };
            $('#report_email_to').val((meta && meta.to) || '');
            $('#report_email_modal').modal('show');
        },
        xls: function (elId, meta) {
            var sections = PosnicPro.reportExport.gather(elId);
            if (!sections) { PosnicPro.alert('warning', PosnicPro.i18n.t('lang_run_the_report_first_then_export_it', 'Run the report first, then export it.')); return; }
            var esc = function (v) { return $('<i>').text(v).html(); };
            var html = '<html><head><meta charset="utf-8"><style>td,th{border:1px solid #ccc;padding:4px 8px;font-family:Arial;font-size:12px;}th{background:#2d3748;color:#fff;}h3{font-family:Arial;}</style></head><body>';
            if (meta.title) { html += '<h2>' + esc(meta.title) + '</h2>' + (meta.range ? '<p>' + esc(meta.range) + '</p>' : ''); }
            sections.forEach(function (sec) {
                if (sec.title) { html += '<h3>' + esc(sec.title) + '</h3>'; }
                html += '<table>';
                sec.rows.forEach(function (r) {
                    var tag = r.head ? 'th' : 'td';
                    html += '<tr>' + r.cells.map(function (c) { return '<' + tag + '>' + esc(c) + '</' + tag + '>'; }).join('') + '</tr>';
                });
                html += '</table><br>';
            });
            html += '</body></html>';
            var blob = new Blob(['\ufeff' + html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
            PosnicPro.reportExport._download(blob, (meta.filename || 'report') + '.xls');
        },
    },

    /*
     * Export buttons for every report page (owner ask), injected at
     * runtime: the pages duplicate ids like defaultTabContentLine across
     * the concatenated DOM, so each page is addressed by its unique root
     * and the buttons ride its contentbar. Exports capture what the
     * screen shows - same principle as the day-end summary.
     */
    reportPages: [
        { root: '#salereport_new', title: PosnicPro.i18n.t('lang_sales_report', 'Sales Report'), range: '#view_sale_report_daterange', file: 'sales-report',
            full: [
                { when: '#sale-view-tab-line', table: '#view_salereport', per: '#view_salereport_per_page', load: 'salereport.salereportTable' },
                { when: '#instant-tab-line', table: '#view_instantreport', per: '#view_instantreport_per_page', load: 'instantreport.instantreportTable' }
            ] },
        { root: '#categoryreport_new', title: PosnicPro.i18n.t('lang_category_report', 'Category Report'), range: '.view_category_report_daterange', file: 'category-report',
            full: [{ table: '#view_categoryreport', per: '#view_categoryreport_per_page', load: 'categoryreport.categoryreportTable' }] },
        { root: '#customerreport_new', title: PosnicPro.i18n.t('lang_customer_report', 'Customer Report'), range: '#view_customer_report_daterange', file: 'customer-report',
            full: [{ table: '#view_customerreport', per: '#view_customerreport_per_page', load: 'customerreport.customerreportTable' }] },
        { root: '#expensesreport_new', title: PosnicPro.i18n.t('lang_expense_report', 'Expense Report'), range: '#view_expenses_report_daterange', file: 'expense-report',
            full: [{ table: '#view_expensesreport', per: '#view_expensesreport_per_page', load: 'expensesreport.expensesreportTable' }] },
        { root: '#itemreport_new', title: PosnicPro.i18n.t('lang_item_report', 'Item Report'), range: '.view_item_report_daterange', file: 'item-report',
            full: [{ table: '#view_itemreport', per: '#view_itemreport_per_page', load: 'itemreport.itemreportTable' }] },
        { root: '#kioskreport_new', title: PosnicPro.i18n.t('lang_kiosk_report', 'Kiosk Report'), range: '#view_kiosk_report_daterange', file: 'kiosk-report',
            full: [{ table: '#view_kioskreport', per: '#view_kioskreport_per_page', load: 'kioskreport.kioskreportTable' }] },
        // KOT is five reports behind one date range; the active tab decides
        // which table the full-range export loads.
        { root: '#kotreport_new', title: PosnicPro.i18n.t('lang_kot_report', 'KOT Report'), range: '#view_kot_report_daterange', file: 'kot-report',
            // (sales-summary is not paginated - it has no per-page selector,
            //  so its export already carries every row)
            full: [
                { when: '#kot-itemwise-tab', table: '#view_kotitemreport', per: '#view_kotitemreport_per_page', load: 'kotitemreport.kotitemreportTable' },
                { when: '#kot-discount-tab', table: '#view_kotdiscountreport', per: '#view_kotdiscountreport_per_page', load: 'kotdiscountreport.kotdiscountreportTable' },
                { when: '#kot-cancellation-tab', table: '#view_kotcancellation', per: '#view_kotcancellation_per_page', load: 'kotcancellation.kotcancellationTable' },
                { when: '#kot-open-item-tab', table: '#view_kotopenitemreport', per: '#view_kotopenitemreport_per_page', load: 'kotopenitemreport.kotopenitemreportTable' }
            ] },
        { root: '#labourreport_new', title: PosnicPro.i18n.t('lang_labourreport_title', 'Labour / Payout'), range: '', file: 'labour-report' },
        { root: '#paymentreport_new', title: PosnicPro.i18n.t('lang_payment_report', 'Payment Report'), range: '#view_paymentransaction_transaction_daterange', file: 'payment-report',
            full: [{ table: '#view_paymentransaction', per: '#view_paymentransaction_per_page', load: 'paymentransaction.paymentransactionTable' }] },
        { root: '#pendingreport_new', title: PosnicPro.i18n.t('lang_pending_report', 'Pending Payments'), range: '.view_pending_report_daterange', file: 'pending-payments',
            full: [{ table: '#view_pendingreport', per: '#view_pendingreport_per_page', load: 'pendingreport.pendingreportTable' }] },
        { root: '#receivingreport_new', title: PosnicPro.i18n.t('lang_purchase_report', 'Purchase Report'), range: '#view_receiving_report_daterange', file: 'purchase-report',
            full: [{ table: '#view_receivingreport', per: '#view_receivingreport_per_page', load: 'receivingreport.receivingreportTable' }] },
        { root: '#returnreport_new', title: PosnicPro.i18n.t('lang_sales_return_report', 'Sales Return Report'), range: '.view_return_report_daterange', file: 'sales-return-report',
            full: [{ table: '#view_returnreport', per: '#view_returnreport_per_page', load: 'returnreport.returnreportTable' }] },
        { root: '#returnreceivingreport_new', title: PosnicPro.i18n.t('lang_purchase_return_report', 'Purchase Return Report'), range: '.view_return_receiving_report_daterange', file: 'purchase-return-report',
            full: [{ table: '#view_returnreceivingreport', per: '#view_returnreceivingreport_per_page', load: 'returnreceivingreport.returnreceivingreportTable' }] },
        { root: '#supplierreport_new', title: PosnicPro.i18n.t('lang_supplier_report', 'Supplier Report'), range: '.view_supplier_report_daterange', file: 'supplier-report',
            full: [{ table: '#view_supplierreport', per: '#view_supplierreport_per_page', load: 'supplierreport.supplierreportTable' }] },
        { root: '#taxsummaryreport_new', title: PosnicPro.i18n.t('lang_taxsummary_title', 'Tax Summary'), range: '', file: 'tax-summary' },
        { root: '#taxpayable_new', title: PosnicPro.i18n.t('lang_taxpayable_title', 'Tax Payable'), range: '', file: 'tax-payable' },
        // scans the whole catalogue already - no paging to expand
        { root: '#gstreadiness_new', title: PosnicPro.i18n.t('lang_gstreadiness_title', 'GST 2.0 Readiness'), range: '', file: 'gst-readiness' },
        { root: '#taxdiscountreport_new', title: PosnicPro.i18n.t('lang_tax_report', 'Tax Report'), range: '.view_tax_sales_report_daterange', file: 'tax-report' },
        { root: '#userreport_new', title: PosnicPro.i18n.t('lang_user_report', 'User Report'), range: '.view_user_report_daterange', file: 'user-report',
            full: [{ table: '#view_userreport', per: '#view_userreport_per_page', load: 'userreport.userreportTable' }] },
        { root: '#gstr_one', title: PosnicPro.i18n.t('lang_gstr1_report', 'GSTR1 Report'), range: '#gst_form_one_daterange_one', file: 'gstr1' },
        { root: '#gstr_two', title: PosnicPro.i18n.t('lang_gstr2_report', 'GSTR2 Report'), range: '#gst_form_two_daterange_one', file: 'gstr2' },
        { root: '#gstr_twob', title: PosnicPro.i18n.t('lang_gstr2b_report', 'GSTR2B Report'), range: '#gst_form_twob_daterange_one', file: 'gstr2b' },
        { root: '#gstr_three', title: PosnicPro.i18n.t('lang_gstr3b_report', 'GSTR3B Report'), range: '#gst_form_three_daterange_one', file: 'gstr3b' },
        { root: '#gstrNine', title: PosnicPro.i18n.t('lang_gstr9_report', 'GSTR9 Report'), range: '#gst_form_nine_daterange_one', file: 'gstr9' },
    ],
    /*
     * Full-duration export (owner report: "pdf reports are taking first
     * records only"). Pages that declare `full` get their page size bumped
     * to the server's own total, their normal loader re-renders every row
     * for the selected range, the export runs, and the cashier's paged
     * view is restored. Everything else keeps exporting what the screen
     * shows. runAsync(done) MUST call done() when the export has finished
     * reading the DOM; a failsafe restores the view after 25s regardless.
     */
    _fullExportRun: function (cfg, runAsync, fallback) {
        var spec = null;
        (cfg.full || []).forEach(function (f) {
            if (!spec && (!f.when || $(f.when).hasClass('active'))) { spec = f; }
        });
        if (!spec) { fallback(); return; }
        var $table = $(spec.table);
        var $per = $(spec.per);
        var total = parseInt($table.data('total'), 10) || 0;
        var rowsNow = $table.children('tbody').find('tr').length;
        if (!$table.length || !$per.length || !total || total <= rowsNow) { fallback(); return; }
        var loader = spec.load.split('.').reduce(function (o, k) { return o && o[k]; }, PosnicPro);
        if (typeof loader !== 'function') { fallback(); return; }
        var perBefore = $per.val();
        // the loaders read the SELECTED OPTION'S TEXT as the page size
        var $opt = $('<option selected>' + total + '</option>');
        $per.append($opt);
        $table.data('current_page', 1);
        var restored = false;
        var restore = function () {
            if (restored) { return; }
            restored = true;
            $opt.remove();
            $per.val(perBefore);
            $table.data('current_page', 1);
            loader();
        };
        var failsafe = setTimeout(restore, 25000);
        loader();
        var waited = 0;
        var t = setInterval(function () {
            waited += 300;
            var busy = $(cfg.root).find('.loadingSpinner').length > 0;
            var n = $table.children('tbody').find('tr').length;
            if ((!busy && n >= total) || waited > 20000) {
                clearInterval(t);
                runAsync(function () { clearTimeout(failsafe); restore(); });
            }
        }, 300);
    },
    pageExport: function (i, kind) {
        var cfg = PosnicPro.reportPages[i];
        if (!cfg) { return false; }
        var meta = {
            shop: PosnicPro.local.get('branchname') || '',
            address: PosnicPro.local.get('branchaddress') || '',
            phone: PosnicPro.local.get('branchphone') || '',
            title: cfg.title,
            range: (function () {
                if (!cfg.range) { return ''; }
                var el = $(cfg.root).find(cfg.range).first();
                var v = el.val();
                if (v) { return $.trim(String(v)); }
                // Date filters that are divs (This Month pickers) - take the
                // label text, cleaned of tooltip icon leftovers.
                return $.trim(el.text().replace(/\s+/g, ' '));
            })(),
            filename: cfg.file
        };
        var ex = PosnicPro.reportExport;
        if (kind === 'email') {
            // the email modal builds its PDF at Send-click; the full-load
            // wrap rides the builder so the send also carries every row
            ex.email(cfg.root, meta, cfg.full ? function (cb) {
                PosnicPro._fullExportRun(cfg, function (done) {
                    ex._withPdf(cfg.root, meta, function (doc) { cb(doc); done(); });
                }, function () {
                    ex._withPdf(cfg.root, meta, cb);
                });
            } : undefined);
            return false;
        }
        if (kind === 'pdf') {
            PosnicPro._fullExportRun(cfg, function (done) {
                ex._withPdf(cfg.root, meta, function (doc) {
                    doc.save((meta.filename || 'report') + '.pdf');
                    done();
                });
            }, function () { ex.pdf(cfg.root, meta); });
            return false;
        }
        // csv / xls gather synchronously
        PosnicPro._fullExportRun(cfg, function (done) {
            ex[kind](cfg.root, meta);
            done();
        }, function () { ex[kind](cfg.root, meta); });
        return false;
    },
    injectReportExportButtons: function () {
        PosnicPro.reportPages.forEach(function (cfg, i) {
            var $root = $(cfg.root);
            if (!$root.length || $root.find('.report-export-bar').length) { return; }
            var host = $root.find('.contentbar').first();
            if (!host.length) { host = $root.find('.card-body').first(); }
            if (!host.length) { return; }
            host.prepend(
                '<div class="report-export-bar text-right m-b-10">'
                + '<button type="button" class="btn btn-danger-rgba btn-sm" onclick="return PosnicPro.pageExport(' + i + ', \'pdf\');" title="Download A4 PDF" data-t-title="lang_download_a4_pdf"><i class="fa fa-file-pdf-o mr-1"></i>PDF</button> '
                + '<button type="button" class="btn btn-secondary-rgba btn-sm" onclick="return PosnicPro.pageExport(' + i + ', \'csv\');" title="Export CSV" data-t-title="lang_export_csv"><i class="fa fa-file-text-o mr-1"></i>CSV</button> '
                + '<button type="button" class="btn btn-secondary-rgba btn-sm" onclick="return PosnicPro.pageExport(' + i + ', \'xls\');" title="Export Excel" data-t-title="lang_export_excel"><i class="fa fa-file-excel-o mr-1"></i>Excel</button> '
                + '<button type="button" class="btn btn-secondary-rgba btn-sm" onclick="return PosnicPro.pageExport(' + i + ', \'email\');" title="Email this report" data-t-title="lang_email_this_report"><i class="fa fa-envelope-o mr-1"></i>Email</button>'
                + '</div>');
        });
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
            sales: { label: PosnicPro.i18n.t('lang_sales_activity', 'Sales activity'), hash: 'sales', acl: ['sales', 'read'] },
            items: { label: PosnicPro.i18n.t('lang_inventory_updated', 'Inventory updated'), hash: 'items', acl: ['item', 'read'] },
            receivings: { label: PosnicPro.i18n.t('lang_receiving_activity', 'Receiving activity'), hash: 'receivings', acl: ['receiving', 'read'] },
            customers: { label: PosnicPro.i18n.t('lang_customer_records_changed', 'Customer records changed'), hash: 'customers', acl: ['customer', 'read'] },
            suppliers: { label: PosnicPro.i18n.t('lang_supplier_records_changed', 'Supplier records changed'), hash: 'suppliers', acl: ['supplier', 'read'] },
            categories: { label: PosnicPro.i18n.t('lang_categories_changed', 'Categories changed'), hash: 'categories', acl: ['category', 'read'] },
            expenses: { label: PosnicPro.i18n.t('lang_expense_recorded', 'Expense recorded'), hash: 'expenses', acl: ['expense', 'read'] },
            registers: { label: PosnicPro.i18n.t('lang_register_activity', 'Register activity'), hash: 'registers', acl: ['sales', 'read'] },
            shifts: { label: PosnicPro.i18n.t('lang_staff_clock_activity', 'Staff clock activity'), hash: 'users', acl: ['user', 'read'] },
            easytables: { label: PosnicPro.i18n.t('lang_table_kot_activity', 'Table / KOT activity'), hash: 'kothistory', acl: ['sales', 'read'] },
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
            /* ONE number on the bell (owner: "notification show two number
               ... need fix") - unseen activity plus low-stock, combined.
               The split into sections happens inside the panel, not on the
               icon. */
            /* Opening the panel marks things SEEN and the number rests at
               zero (owner: "after see the notification numbers will reset
               or not?"). Activity clears outright; low stock clears down to
               a remembered water-mark, so only NEW lows re-light the badge
               - the standing list stays readable inside the panel. */
            var seen = parseInt(PosnicPro.local.get('bell_lowstock_seen'), 10) || 0;
            var low = PosnicPro.bellFeed._lowStock || 0;
            var n = PosnicPro.bellFeed._unseen + Math.max(0, low - seen);
            el.style.display = n > 0 ? 'inline-block' : 'none';
            el.textContent = n > 99 ? '99+' : String(n);
        },
        setLowStock: function (count) {
            PosnicPro.bellFeed._lowStock = parseInt(count, 10) || 0;
            /* restocking below the water-mark lowers it, so the NEXT new
               low is a fresh +1 instead of being swallowed */
            var seen = parseInt(PosnicPro.local.get('bell_lowstock_seen'), 10) || 0;
            if (PosnicPro.bellFeed._lowStock < seen) {
                PosnicPro.local.set('bell_lowstock_seen', String(PosnicPro.bellFeed._lowStock));
            }
            PosnicPro.bellFeed._badge();
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
                list.innerHTML = '<div class="bellfeed-empty"><lang class="lang_nothing_yet_activity_from_other_tills_land">Nothing yet - activity from other tills lands here.</lang></div>';
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
                    $btn.text(sub ? PosnicPro.i18n.t('lang_send_test_notification', 'Send test notification') : PosnicPro.i18n.t('lang_enable_notifications_on_this_device', 'Enable notifications on this device'))
                        .data('subscribed', !!sub).show();
                });
            }).catch(function () { $btn.hide(); });
        },
        _pushClick: function () {
            var $btn = $('#bell_feed_push');
            if ($btn.data('subscribed')) {
                PosnicPro.post({ url: 'push/test', data: JSON.stringify({}) }, function (response) {
                    PosnicPro.alert(response.type, response.message);
                }, function () { PosnicPro.alert('error', PosnicPro.i18n.t('lang_could_not_send_the_test', 'Could not send the test.')); });
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
                                    PosnicPro.alert('success', PosnicPro.i18n.t('lang_notifications_enabled_on_this_device', 'Notifications enabled on this device.'));
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
                PosnicPro.local.set('bell_lowstock_seen', String(PosnicPro.bellFeed._lowStock || 0));
                PosnicPro.bellFeed._badge();
                PosnicPro.bellFeed._paint();
                PosnicPro.bellFeed._pushSetup();
            });
            PosnicPro.bellFeed._paint();
        },
    },

    /*
     * REMOVED 2026-08-26, owner order "delete all chart related code":
     * the PosnicPro.chart namespace (create/dispose/disabledHere and the
     * touch-taming), the chart-loader stub, and the chart vendor
     * lazy chunks. The graph report sections were already deleted; the
     * dashboard's two remaining chart functions had no callers and no
     * containers. Do not reintroduce charts - and NEVER on mobile.
     */


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
            PosnicPro.alert('warning', PosnicPro.i18n.t('lang_select_must_atleast_one_row', 'Select must atleast one row!!.'));
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
    /* importTableHeader lives further down (beside importHeaderAlias). A
       second, older copy used to sit here - a duplicate object key, so the
       later definition silently won and edits here changed nothing. */
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
            PosnicPro.alert('warning', PosnicPro.i18n.t('lang_invalid_data', 'Invalid data...!!!'));
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
            $('#manager_approval_toggle').text(PosnicPro.i18n.t('lang_enter_pin_instead', 'Enter PIN instead'));
        } else {
            $('#manager_card_pane').addClass('d-none');
            $('#manager_pin_pane').removeClass('d-none');
            $('#manager_approval_toggle').text(PosnicPro.i18n.t('lang_swipe_card_instead', 'Swipe card instead'));
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
            $('#manager_pin_error').text(byCard ? PosnicPro.i18n.t('lang_swipe_a_card', 'Swipe a card') : PosnicPro.i18n.t('lang_enter_a_pin', 'Enter a PIN')).removeClass('d-none');
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
                    $('#shift_status').html('<span class="badge badge-success"><lang class="lang_on_shift">On shift</lang></span><br>'
                        + '<small class="text-muted">since ' + since.toLocaleString() + '</small>');
                    $('#shift_clock_out_btn').prop('disabled', false);
                } else {
                    $('#shift_status').html('<span class="badge badge-secondary"><lang class="lang_not_clocked_in">Not clocked in</lang></span>');
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
                $('#labour_report_body').html('<tr><td colspan="7" class="text-center text-danger"><lang class="lang_could_not_load_the_report">Could not load the report.</lang></td></tr>');
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
                $('#labour_report_body').html('<tr><td colspan="7" class="text-center text-muted"><lang class="lang_no_shifts_in_this_range">No shifts in this range.</lang></td></tr>');
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
                PosnicPro.alert('warning', PosnicPro.i18n.t('lang_run_the_report_first_there_is_nothing_to_e_2', 'Run the report first. There is nothing to export.'));
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
                    PosnicPro.alert('warning', PosnicPro.i18n.t('lang_no_shifts_in_this_range', 'No shifts in this range.'));
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
                PosnicPro.alert('error', PosnicPro.i18n.t('lang_could_not_load_shifts_for_the_export', 'Could not load shifts for the export.'));
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
        // The clock-button link shows staff THEIR week (#/roster, read-only);
        // planning moved under Manage > Workforce with the rest of the
        // module's management.
        openRoster: function () {
            if (!PosnicPro.shiftWidget._setting('staff_roster_enable', true)) { return; }
            $('#shift_modal').modal('hide');
            hasher.setHash('roster');
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
            }, function () { $('#roster_user').html('<option value="" data-t="lang_could_not_load_staff">Could not load staff</option>'); });
        },
        runRoster: function () {
            var from = $('#roster_from').val();
            var to = $('#roster_to').val();
            $('#roster_body').html('<tr><td colspan="6" class="text-center text-muted">Loading…</td></tr>');
            var url = 'shifts/schedule?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to);
            PosnicPro.get(url, function (res) {
                PosnicPro.shiftWidget._renderRoster((res && res.data) || []);
            }, function () {
                $('#roster_body').html('<tr><td colspan="6" class="text-center text-danger"><lang class="lang_could_not_load_the_roster">Could not load the roster.</lang></td></tr>');
            });
        },
        _renderRoster: function (entries) {
            var esc = function (s) {
                return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
                    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
                });
            };
            if (!entries.length) {
                $('#roster_body').html('<tr><td colspan="6" class="text-center text-muted"><lang class="lang_nothing_planned_in_this_range">Nothing planned in this range.</lang></td></tr>');
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
            if (!userId) { PosnicPro.alert('warning', PosnicPro.i18n.t('lang_pick_a_staff_member', 'Pick a staff member.')); return; }
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
                    PosnicPro.alert('error', PosnicPro.i18n.t('lang_selected_row_empty', 'Selected Row Empty!!.'));
                }
            } else {
                PosnicPro.alert('warning', PosnicPro.i18n.t('lang_please_selected_atleast_one_row', 'Please selected atleast one row!!.'));
            }
        } else {
            PosnicPro.alert('warning', PosnicPro.i18n.t('lang_no_accesss_to_delete_records', 'No accesss to delete Records!!.'));
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
                PosnicPro.alert('error', PosnicPro.i18n.t('lang_no_accesss_to_delete_records', 'No accesss to delete Records!!.'));
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
   /*
    * Has the permission list actually arrived?
    *
    * userACL starts as an empty STRING and is replaced by an object when
    * users/getUserAccessDetails answers. Until then every lookup misses, so
    * checkAccess said no to everything and the page was stripped of controls
    * that the shop was perfectly entitled to.
    */
   aclLoaded: function () {
       var acl = PosnicPro.userACL;
       return !!acl && typeof acl === 'object' && Object.keys(acl).length > 0;
   },

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
        /*
         * Unknown is not denied.
         *
         * With no permission list loaded this stripped the page bare - every
         * Add, Edit and Delete removed from the DOM, which is indistinguishable
         * from a shop whose plan does not include them. Reported as "cashbook
         * page no option to add or edit expenses": the button was not hidden by
         * a rule, it was deleted because the rules had not arrived.
         *
         * Leaving the controls alone is the safer wrong answer. The server
         * checks every one of these operations regardless, so the worst case is
         * a button that answers "unauthorised" - visible and explicable, rather
         * than a feature that appears not to exist.
         */
        if (!PosnicPro.aclLoaded()) { return; }
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
        /* Same reason, and worse: this throws outright on an empty ACL, and
           it runs during boot - so one failed permissions call took the whole
           dashboard down rather than one button. */
        if (!PosnicPro.aclLoaded() || !PosnicPro['userACL'].dashboard) { return; }
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
    /* One print asked for a specific paper (the A4 / Thermal buttons after a
       sale). It wins over the shop setting for that print only, and the caller
       clears it afterwards. Without this the content came out A4 while the
       PAPER and stylesheet stayed thermal - an invoice squeezed into 80mm. */
    _printTypeOverride: null,
    resolvePrintType: function () {
        if (PosnicPro._printTypeOverride) {
            return PosnicPro._printTypeOverride;
        }
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
        'a4': { css: 'A4', content: 'auto', label: PosnicPro.i18n.t('lang_a4_sheet', 'A4 sheet'), font: 13, small: 11 }
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
     * Reports are grouped like Config modules: the rail shows five groups,
     * and every report page carries this injected navigator - the group's
     * reports as tabs, current one active. One component, injected after
     * each route lands, so the sixteen report pages need no markup of
     * their own. Items follow Module On/Off like everything else.
     */
    REPORT_GROUPS: [
        { name: 'Sales', items: [
            { hash: 'quickreport', label: PosnicPro.i18n.t('lang_day_end', 'Day-End'), icon: 'zap' },
            { hash: 'salereport', label: PosnicPro.i18n.t('lang_rgrp_sales', 'Sales'), icon: 'shopping-cart' },
            { hash: 'returnreport', label: PosnicPro.i18n.t('lang_return_sale', 'Return Sale'), icon: 'refresh-ccw' },
            { hash: 'pendingreport', label: PosnicPro.i18n.t('lang_pending_report', 'Pending Payments'), icon: 'clock' },
            { hash: 'registerreport', label: PosnicPro.i18n.t('lang_records_title', 'Register'), icon: 'inbox', module: 'cash_register_enable' },
            { hash: 'kotreport', label: PosnicPro.i18n.t('lang_kot_title', 'KOT'), icon: 'grid', kot: true },
            { hash: 'kioskreport', label: PosnicPro.i18n.t('lang_module_kiosk', 'Kiosk'), icon: 'monitor', module: 'module_channels_enable' },
        ] },
        { name: 'Purchase', items: [
            { hash: 'receivingreport', label: PosnicPro.i18n.t('lang_newpurchase_title', 'Purchase'), icon: 'truck' },
            { hash: 'returnreceivingreport', label: PosnicPro.i18n.t('lang_return_purchase', 'Return Purchase'), icon: 'refresh-ccw' },
            { hash: 'supplierreport', label: PosnicPro.i18n.t('lang_newsupplier_title', 'Supplier'), icon: 'user-check' },
        ] },
        { name: 'Inventory', items: [
            { hash: 'itemreport', label: PosnicPro.i18n.t('lang_newitem_title', 'Item'), icon: 'package' },
            { hash: 'categoryreport', label: PosnicPro.i18n.t('lang_newcategory_title', 'Category'), icon: 'layers' },
        ] },
        { name: 'People', items: [
            { hash: 'customerreport', label: PosnicPro.i18n.t('lang_newcustomer_title', 'Customer'), icon: 'users' },
            { hash: 'userreport', label: PosnicPro.i18n.t('lang_newuser_title', 'User'), icon: 'user-check' },
            { hash: 'labourreport', label: PosnicPro.i18n.t('lang_labourreport_title', 'Labour / Payout'), icon: 'clock', module: 'staff_shifts_enable' },
        ] },
        { name: 'Money', items: [
            { hash: 'paymentreport', label: PosnicPro.i18n.t('lang_payment_2', 'Payment'), icon: 'dollar-sign' },
            { hash: 'taxreport', label: PosnicPro.i18n.t('lang_module_tax', 'Tax'), icon: 'percent', module: 'module_tax_enable' },
            { hash: 'taxsummaryreport', label: PosnicPro.i18n.t('lang_taxsummary_title', 'Tax Summary'), icon: 'layers', module: 'module_tax_enable' },
            { hash: 'taxpayable', label: PosnicPro.i18n.t('lang_taxpayable_title', 'Tax Payable'), icon: 'trending-up', module: 'module_tax_enable' },
            { hash: 'gstreadiness', label: PosnicPro.i18n.t('lang_gstreadiness_title', 'GST 2.0 Readiness'), icon: 'check-square', module: 'module_tax_enable' },
            { hash: 'expensesreport', label: PosnicPro.i18n.t('lang_expense_title', 'Cash Book'), icon: 'file-text', module: 'module_cashbook_enable' },
        ] },
    ],
    injectReportGroupTabs: function () {
        var hash = window.location.hash.replace(/^#\//, '').split('/')[0];
        $('.report-group-tabs').remove();
        var group = null;
        for (var g = 0; g < PosnicPro.REPORT_GROUPS.length; g++) {
            if (PosnicPro.REPORT_GROUPS[g].items.some(function (i) { return i.hash === hash; })) {
                group = PosnicPro.REPORT_GROUPS[g];
                break;
            }
        }
        if (!group) { return; }
        var s = {};
        try { s = JSON.parse(PosnicPro.local.get('general_settings') || '{}'); } catch (e) { /* defaults */ }
        var html = '<div class="col-12 report-group-tabs"><ul class="nav nav-tabs users-roles-tabs">';
        group.items.forEach(function (i) {
            if (i.module && s[i.module] === false) { return; }
            if (i.kot && PosnicPro.local.get('table_options') !== 'enable') { return; }
            html += '<li class="nav-item"><a class="nav-link' + (i.hash === hash ? ' active' : '') +
                '" href="#/' + i.hash + '">' +
                (i.icon ? '<i class="feather icon-' + i.icon + ' mr-1"></i>' : '') +
                i.label + '</a></li>';
        });
        html += '</ul></div>';
        var $row = $('.page_loader:visible .breadcrumbbar .row').first();
        if ($row.length) { $row.after('<div class="row">' + html + '</div>'); }
        // The rail entry for the CURRENT group highlights like any other
        // menu (user call): one active group at a time.
        var entryId = 'rgrp_' + group.name.toLowerCase() + '_page';
        $('[id^="rgrp_"][id$="_page"]').removeClass('active');
        $('#' + entryId).addClass('active');
    },
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
        /* Manage-sidebar settings entries (the Config layer collapsed into
           them) follow the same switches as the panes they open. */
        $('#manage_li_taxmodule').toggle(on('module_tax_enable'));
        $('#manage_li_tableorder').toggle(PosnicPro.local.get('table_options') === 'enable');
        $('#manage_li_cashregister').toggle(on('cash_register_enable'));
        $('#manage_li_workforce').toggle(on('staff_shifts_enable'));
        $('#manage_li_cashbook').toggle(on('module_cashbook_enable'));
        $('#li_quotes').toggle(on('quotes_enable'));
        $('#li_invoices').toggle(on('invoices_enable'));
        $('#manage_li_credit').toggle(on('module_credit_enable'));
        /*
         * Customer Dues on the dashboard follows the same switch.
         *
         * A shop that never sells on account cannot have dues, so the panel
         * could only ever say "No customer owes money right now" - which reads
         * as a feature that is broken rather than one the shop does not use.
         *
         * Best Selling takes the whole row when it goes, rather than sitting at
         * two thirds width beside a gap.
         */
        var creditOn = on('module_credit_enable');
        $('#dashboard_dues_col').toggle(creditOn);
        $('#dashboard_best_col').toggleClass('col-md-8', creditOn).toggleClass('col-md-12', !creditOn);
        $('#manage_li_marketingmodule').toggle(on('module_marketing_enable'));
        $('#manage_li_messagingmodule').toggle(on('module_messaging_enable'));
        $('#manage_li_kiosk').toggle(on('module_channels_enable'));
        $('#manage_li_theme').toggle(on('module_themes_enable'));
        $('#manage_li_recyclebin').toggle(on('module_recyclebin_enable'));
        /* One system, owner's rule: a feature's card explains it; a
           feature's CONFIGURATION lives here, in its own entry - the same
           door for every feature, however many we grow. */
        $('#manage_li_demodata').toggle(on('module_demo_data_enable'));
        $('#manage_li_quotes').toggle(on('quotes_enable'));
        $('#manage_li_invoices').toggle(on('invoices_enable'));
        $('#manage_li_tillpin').toggle(s.till_lock_enable === true);
        $('#manage_modules_header').toggle(
            $('[id^="manage_li_"]').filter(function () { return $(this).css('display') !== 'none'; }).length > 0
        );

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
            '<div style="text-align:center;font-weight:bold;"><lang class="lang_test_receipt">TEST RECEIPT</lang></div>' +
            '<div style="text-align:center;font-size:11px;">' + paper.label + '</div>' +
            '<div style="text-align:center;font-size:11px;">' + now.toLocaleString() + '</div>' +
            '<div style="border-top:1px dashed #000;margin:6px 0;"></div>' +
            '<table style="width:100%;border-collapse:collapse;">' +
            '<tr><th style="text-align:left;"><lang class="lang_newitem_title">Item</lang></th><th style="text-align:center;"><lang class="lang_qty_title">Qty</lang></th>' +
            '<th style="text-align:right;"><lang class="lang_amount_title">Amount</lang></th></tr>' + rows +
            '</table>' +
            '<div style="border-top:1px dashed #000;margin:6px 0;"></div>' +
            '<table style="width:100%;"><tr><td style="text-align:left;font-weight:bold;"><lang class="lang_total">TOTAL</lang></td>' +
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
                $("#infobar-settings-sidebar-tender-details").addClass("sidebarview");
                return;
            }
            /* A document address (#/purchaseorders/<id>, #/suppliers/<id>)
               is exactly where the reader wants to remain - resetting the
               hash here CLOSED the open document after every print. The
               reset was for modal-era pages whose print swallowed the
               screen; the master-detail pages keep their place. */
            if (parts.length === 2 && /^[0-9a-f]{24}$/i.test(parts[1] || '')) {
                return;
            }
            hasher.setHash(parts[0]);
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
            PosnicPro.alert('error', (err && err.message) ? err.message : PosnicPro.i18n.t('lang_print_failed', 'Print failed'));
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
                    PosnicPro.alert('error', (err && err.message) ? err.message : PosnicPro.i18n.t('lang_print_failed', 'Print failed'));
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
                hasher.setHash(parts[0] + '/' + parts[1]);
                $("#infobar-settings-sidebar-tender-details").addClass("sidebarview");
                return;
            }
            /* Same rule as afterPrint: a document address on a
               master-detail page stays put - this inline twin of the old
               epilogue was closing the open purchase after every browser
               print. */
            if (parts.length === 2 && /^[0-9a-f]{24}$/i.test(parts[1] || '')) {
                return;
            }
            hasher.setHash(parts[0]);
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
    /*
     * The shop's timezone, never null.
     *
     * THE WHITE PAGE THIS ENDS. localStorage carries no 'timezone' until the
     * first settings read lands, and local.get returns null before that - so
     * on a FRESH BROWSER ORIGIN (every brand-new shop's first visitor, every
     * new subdomain), moment().tz(null) hits moment-timezone's GETTER form,
     * returns undefined, and the .format() that follows throws inside the
     * ready handlers that reveal the page. The whole dashboard rendered
     * white with every request returning 200 - and it never reproduced for
     * anybody whose browser had ever loaded the shop before, which is why it
     * survived until the owner opened a brand-new shop in a brand-new tab.
     *
     * The fallback is the BROWSER'S own zone: for the seconds before the
     * server answers, where the person is standing is the best truth
     * available - and strictly better than a fixed default that is wrong on
     * every till outside one country.
     */
    timeZone: function () {
        var t = PosnicPro.local.get('timezone');
        if (t && t !== 'null' && t !== 'undefined') { return t; }
        try { return moment.tz.guess(); } catch (e) { return 'Asia/Kolkata'; }
    },

    commonDate: function () {
        let timeZone = PosnicPro.timeZone();
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

        var timeZone = PosnicPro.timeZone();
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
        /*
         * The API's own stamp, parsed exactly instead of guessed.
         *
         * Every list endpoint dates its rows through utils/helpers.formatDate,
         * which writes MM/DD/YYYY hh:mm am/pm. That shape had no entry in the
         * format list below, so non-strict moment fell through to DD/MM/YYYY
         * and chewed across the separator: "08/09/2026 09:05 am" came back as
         * 20/09/2008 - wrong day AND wrong year - and "08/28/2026 08:59 am"
         * lost its time entirely and rendered as midnight (owner, on the
         * login history: "all are 12am only?"). Every screen showing a
         * string_date was affected: sign-ins, sales history, the panes.
         *
         * Matched here explicitly, so there is no guessing left to get wrong.
         * Anything that is not this exact shape falls through untouched.
         */
        var stamp = (typeof date === 'string')
            && date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap])\.?m\.?$/i);
        if (stamp) {
            var hh = parseInt(stamp[4], 10) % 12;
            if (/p/i.test(stamp[7])) { hh += 12; }
            var exact = new Date(
                parseInt(stamp[3], 10), parseInt(stamp[1], 10) - 1, parseInt(stamp[2], 10),
                hh, parseInt(stamp[5], 10), parseInt(stamp[6] || '0', 10));
            if (!isNaN(exact.getTime())) {
                return (PosnicPro.local.get('timeformat') === 'enable')
                    ? moment(exact).format(formatData + ' ' + 'LT')
                    : moment(exact).format(formatData);
            }
        }
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
                $('#resetHeading').html(PosnicPro.i18n.t('lang_newsale_title', 'Sale'));
            } else {
                $('#resetSaleButton').hide();
                $('#resetReceivingButton').show();
                $('#resetHeading').html(PosnicPro.i18n.t('lang_receiving_title', 'Receiving'));
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
            PosnicPro.alert('warning', PosnicPro.i18n.t('lang_select_must_atleast_one_row', 'Select must atleast one row!!.'));
        }
    },

    appendReportTableBody: function (report) {

        var TableBody = {
            'salesreport': '<tr><th>#</th><th><lang class="lang_id_title">Id</lang></th><th><lang class="lang_date_title">Date</lang></th><th class="text-center"><lang class="lang_newcustomer_title">Customer</lang></th><th class="text-center"><lang class="lang_customer_phone">Customer Phone</lang></th><th class="text-center"><lang class="lang_no_of_item">No.of Item</lang></th><th class="text-right"><lang class="lang_subtotal">Subtotal</lang></th><th class="text-right"><lang class="lang_module_tax">Tax</lang></th><th class="text-right"><lang class="lang_discount_title">Discount</lang></th><th class="text-right"><lang class="lang_price_title">Price</lang></th></tr>',
            'tax': '<tr><th>#</th><th><lang class="lang_id_title">Id</lang></th><th><lang class="lang_date_title">Date</lang></th><th class="text-right"><lang class="lang_gst">GST</lang></th><th class="text-right">Tax[%]</th><th><lang class="lang_tax_description">Tax Description</lang></th><th class="text-right"><lang class="lang_sub_total">Sub Total</lang></th><th class="text-right"><lang class="lang_price_title">Price</lang></th></tr>',
            'receivingreport': '<tr><th></th><th>#</th><th><lang class="lang_id_title">Id</lang></th><th><lang class="lang_date_title">Date</lang></th><th><lang class="lang_newsupplier_title">Supplier</lang></th><th class="text-right"><lang class="lang_supplier_phone">Supplier Phone</lang></th><th class="text-center"><lang class="lang_total_item">Total Item</lang></th><th class="text-right"><lang class="lang_total_title">Total</lang></th></tr>',
            'salesitemreport': '<tr><th></th><th>#</th><th><lang class="lang_id_title">Id</lang></th><th><lang class="lang_date_title">Date</lang></th><th><lang class="lang_newcustomer_title">Customer</lang></th><th class="text-center"><lang class="lang_total_item">Total Item</lang></th><th class="text-right"><lang class="lang_price_title">Price</lang></th></tr>',
            'receivingitemreport': '<tr><th>#</th><th><lang class="lang_id_title">Id</lang></th><th><lang class="lang_date_title">Date</lang></th><th><lang class="lang_newsupplier_title">Supplier</lang></th><th class="text-center"><lang class="lang_total_item">Total Item</lang></th><th class="text-right"><lang class="lang_price_title">Price</lang></th></tr>',
            'itemreport': '<tr><th>#</th><th><lang class="lang_name_title">Name</lang></th><th class="text-center"><lang class="lang_total_no_of_item_sold">Total no. of item sold</lang></th><th class="text-center"><lang class="lang_no_of_sale">No. of sale</lang></th><th class="text-right"><lang class="lang_profit">Profit</lang></th><th class="text-right"><lang class="lang_avg_sale">Avg.sale</lang></th><th class="text-right"><lang class="lang_total_sale">Total sale</lang></th></tr>',
            'itemexpiry': '<tr><th>#</th><th><lang class="lang_itemname_title">Item Name</lang></th><th><lang class="lang_newcategory_title">Category</lang></th><th><lang class="lang_sku_title">SKU</lang></th><th><lang class="lang_expiry_date">Expiry Date</lang></th><th class="text-right"><lang class="lang_quantity">Quantity</lang></th><th class="text-right"><lang class="lang_company_price_2">Company Price</lang></th><th class="text-right"><lang class="lang_total_amount">Total Amount</lang></th></tr>',
            'categoryreport': '<tr><th>#</th><th><lang class="lang_name_title">Name</lang></th><th class="text-center"><lang class="lang_total_no_of_item_sold">Total no. of item sold</lang></th><th class="text-right"><lang class="lang_profit">Profit</lang></th><th class="text-right"><lang class="lang_avg_sale">Avg.sale</lang></th><th class="text-right"><lang class="lang_total_sale">Total sale</lang></th></tr>',
            'customerreport': '<tr><th>#</th><th><lang class="lang_name_title">Name</lang></th><th><lang class="lang_phone_title">Phone</lang></th><th class="text-center"><lang class="lang_no_of_purchase">No. of purchase</lang></th><th class="text-right"><lang class="lang_return_title">Return</lang></th><th class="text-right"><lang class="lang_avg_purchase">Avg.Purchase</lang></th><th class="text-right"><lang class="lang_total_purchase_2">Total purchase</lang></th></tr>',
            'supplierreport': '<tr><th>#</th><th><lang class="lang_name_title">Name</lang></th><th><lang class="lang_phone_title">Phone</lang></th><th class="text-center"><lang class="lang_no_of_sale">No. of sale</lang></th><th class="text-right"><lang class="lang_avg_sale">Avg.sale</lang></th><th class="text-right"><lang class="lang_total_sale">Total sale</lang></th></tr>',
            'userreport': '<tr><th>#</th><th><lang class="lang_name_title">Name</lang></th><th class="text-center"><lang class="lang_no_of_sale">No. of sale</lang></th><th class="text-right"><lang class="lang_return_title">Return</lang></th><th class="text-right"><lang class="lang_profit">Profit</lang></th><th class="text-right"><lang class="lang_avg_sale_2">Avg.Sale</lang></th><th class="text-right"><lang class="lang_total_sale">Total sale</lang></th></tr>',
            'paymentsalesreport': '<tr><th>#</th><th><lang class="lang_id_title">Id</lang></th><th><lang class="lang_date_title">Date</lang></th><th><lang class="lang_newcustomer_title">Customer</lang></th><th><lang class="lang_paymentmode">Payment Mode</lang></th><th><lang class="lang_paymentdescription_title">Payment Note</lang></th><th class="text-right"><lang class="lang_price_title">Price</lang></th></tr>',
            'paymentreceivingreport': '<tr><th>#</th><th><lang class="lang_id_title">Id</lang></th><th><lang class="lang_date_title">Date</lang></th><th><lang class="lang_newsupplier_title">Supplier</lang></th><th><lang class="lang_paymentmode">Payment Mode</lang></th><th><lang class="lang_paymentdescription_title">Payment Note</lang></th><th class="text-right"><lang class="lang_price_title">Price</lang></th></tr>',
            'taxsalesreport': '<tr><th>#</th><th><lang class="lang_tax_name">Tax Name</lang></th><th class="text-right"><lang class="lang_amount_title">Amount</lang></th></tr>',
            'registerreport': '<tr><th>#</th><th><lang class="lang_name_title">Name</lang></th><th><lang class="lang_time_opened">Time opened</lang></th><th><lang class="lang_time_closed">Time closed</lang></th><th class="text-right"><lang class="lang_float_amount">Float Amount</lang></th><th class="text-right"><lang class="lang_registeramount_title">Register amount</lang></th></tr>',
            'pendingreport': '<tr><th>#</th><th><lang class="lang_id_title">Id</lang></th><th><lang class="lang_date_title">Date</lang></th><th class="text-center"><lang class="lang_no_of_product">No. of product</lang></th><th class="text-right"><lang class="lang_total_title">Total</lang></th><th class="text-right"><lang class="lang_partial">Partial</lang></th><th class="text-right"><lang class="lang_due">Due</lang></th></tr>',
            'returnreport': '<tr><th>#</th><th><lang class="lang_sales_id">Sales Id</lang></th><th><lang class="lang_date_title">Date</lang></th><th><lang class="lang_customer_name">Customer name</lang></th><th><lang class="lang_paymentmethod">Payment Method</lang></th><th><lang class="lang_no_of_item_2">No. of Item </lang></th><th class="text-right"><lang class="lang_return_amount">Return Amount</lang></th></tr>',
            'returnreceivingreport': '<tr><th>#</th><th><lang class="lang_receiving_id">Receiving Id</lang></th><th><lang class="lang_date_title">Date</lang></th><th><lang class="lang_supplier_name_2">Supplier name</lang></th><th><lang class="lang_paymentmethod">Payment Method</lang></th><th><lang class="lang_no_of_item_2">No. of Item </lang></th><th class="text-right"><lang class="lang_return_amount">Return Amount</lang></th></tr>',
            'customerdetails': '<tr><th>#</th><th> Sale </th><th><lang class="lang_date_title">Date</lang></th><th class="text-center"><lang class="lang_process_title">Process</lang></th><th class="text-center"><lang class="lang_no_of_item_return">No. of item return</lang></th><th class="text-right"><lang class="lang_return_total">Return total</lang></th><th class="text-center"><lang class="lang_no_of_item_sold">No. of item sold</lang></th><th class="text-right"><lang class="lang_sale_total">Sale total</lang></th></tr>',
            'customertransactiondetails': '<tr><th>#</th><th> Date </th><th class="text-center"> Description </th><th> Type </th><th class="text-center"> Wallet </th><th class="text-center"> Paid </th><th class="text-center"> Pending </th><th class="text-center"> Total </th><th class="text-center"> Image </th><th class="text-center"> Action </th></tr>',
            'supplierdetails': '<tr><th>#</th><th> Purchase </th><th><lang class="lang_date_title">Date</lang></th><th class="text-center"><lang class="lang_process_title">Process</lang></th><th class="text-center"><lang class="lang_no_of_item_return">No. of item return</lang></th><th class="text-right"><lang class="lang_return_total">Return total</lang></th><th class="text-center"><lang class="lang_no_of_item_sold">No. of item sold</lang></th><th class="text-right"><lang class="lang_sale_total">Sale total</lang></th></tr>',
            'usersdetails': '<tr><th>#</th><th> Sale </th><th><lang class="lang_date_title">Date</lang></th><th class="text-right"><lang class="lang_amount_title">Amount</lang></th></tr>',
            'productdetails': '<tr><th>#</th><th> Name </th><th><lang class="lang_date_title">Date</lang></th><th class="text-right"><lang class="lang_sellingamount_title">Selling Amount</lang></th></tr>',
            'returndetails': '<tr><th>#</th><th> Name </th><th><lang class="lang_qty_title">Qty</lang></th><th class="text-right"> Amount</th></tr>',
            'registerdetails': '<tr><th>#</th><th> Sale </th><th><lang class="lang_date_title">Date</lang></th><th><lang class="lang_payment_2">Payment</lang></th><th class="text-right"><lang class="lang_return_title">Return</lang></th><th class="text-right"><lang class="lang_amount_title">Amount</lang></th></tr>',
            'paymenttransaction': '<tr><th>#</th><th><lang class="lang_newsale_title">Sale</lang></th><th><lang class="lang_date_title">Date</lang></th><th><lang class="lang_newuser_title">User</lang></th><th><lang class="lang_method_title">Method</lang></th><th class="text-right"><lang class="lang_amount_title">Amount</lang></th></tr>',
            'staffactivity': '<tr><th>#</th><th><lang class="lang_name_title">Name</lang></th><th><lang class="lang_login_date_time">Login Date/Time</lang></th><th><lang class="lang_outlet">Outlet</lang></th><th><lang class="lang_ip_address">IP address</lang></th><th><lang class="lang_device_type">Device type</lang></th><th><lang class="lang_os">OS</lang></th><th><lang class="lang_browser">Browser</lang></th></tr>',
            'expensesreport': '<tr><th>#</th><th><lang class="lang_amount_title">Amount</lang></th><th><lang class="lang_type_title">Type</lang></th><th> Category </th><th><lang class="lang_recipientname_title">Recipient Name</lang></th><th><lang class="lang_approvedby">Approvedby</lang></th><th><lang class="lang_description_title">Description</lang></th></tr>',
            'transactionreport': '<tr><th>#</th><th><lang class="lang_name_title">Name</lang></th><th class="text-right"><lang class="lang_credit_title">Credit</lang></th><th class="text-right"><lang class="lang_debit_title">Debit</lang></th><th class="text-right"><lang class="lang_wallet_amount">Wallet Amount</lang></th><th class="text-right"><lang class="lang_sales_pending">Sales Pending</lang></th><th class="text-right"><lang class="lang_overall_due">Overall Due</lang></th></tr>',
            'itemstock': '<tr><th>#</th><th> Name </th><th><lang class="lang_qty_title">Qty</lang></th><th class="text-right"><lang class="lang_company_price_2">Company Price</lang></th><th class="text-right"><lang class="lang_total_amount">Total Amount</lang></th><th class="text-right"><lang class="lang_selling_price">Selling Price</lang></th><th class="text-right"><lang class="lang_total_amount">Total Amount</lang></th></tr>'
        };

        $(TableBody).each(function (key, val) {
            $(".report-thead-tfoot").empty().html(val[report]);
        });
    },

    appendViewDataTableBody: function (table) {
        /*
         * Sweep the row-menu popups before the list re-renders.
         *
         * jquery.toolbar appends a `.tool-container` straight to <body> for
         * EVERY row's action button and ships no destroy method, so each
         * re-render orphaned another set - measured at ~196 detached nodes
         * per navigation cycle that were never released. Worse, the plugin
         * re-binds its handlers to `$('.tool-container')` (all of them) on
         * every init, so the cost compounds with each orphan left behind.
         * Every list render passes through here, and every container is
         * rebuilt per row anyway, so clearing them here is both safe and
         * the only place that catches all 14 lists.
         */
        $('body > .tool-container').remove();
        $('#BackupReportName').html(table + ' Document').css('textTransform', 'capitalize').show();
        /* Only the pages still on the OLD DataTable machinery keep an
           entry - the standard lists render their own headers, and their
           keys came out with them (owner: clean up after the redesign). */
        var TableBody = {
            'kothistory': '<tr><th>#</th><th><lang class="lang_id_title">Id</lang></th><th><lang class="lang_date_title">Date</lang></th><th class="text-center table-number-hide"><lang class="lang_table_title">Table</lang></th><th class="text-center"><lang class="lang_no_of_pax_2">No.of.Pax</lang></th><th class="text-center order-type-column" width="10%"><lang class="lang_ordertype_title">Order Type</lang></th><th class="text-center" width="16%"><lang class="lang_action_title">Actions</lang></th></tr>',
            'branches': '<tr><th><input name="branches-select-all" type="checkbox" onclick="PosnicPro.checkboxSelectAll(this,\'branches\');"></th><th>#</th><th><lang class="lang_name_title">Name</lang></th><th class="text-right"><lang class="lang_phone_title">Phone</lang></th><th><lang class="lang_email_title">Email</lang></th><th><lang class="lang_address_title">Address</lang></th><th><lang class="lang_state_title">State</lang></th><th><lang class="lang_country_title">Country</lang></th><th class="text-center"><lang class="lang_action">Action</lang></th></tr>',
            'expenses': '<tr><th><input name="expenses-select-all" type="checkbox" onclick="PosnicPro.checkboxSelectAll(this,\'expenses\');"></th><th>#</th><th class="text-right"><lang class="lang_amount_title">Amount</lang></th><th><lang class="lang_type_title">Type</lang></th><th><lang class="lang_newcategory_title">Category</lang></th><th><lang class="lang_approved_by">Approved By</lang></th><th><lang class="lang_description_title">Description</lang></th><th class="text-center"><lang class="lang_action">Action</lang></th></tr>',
            'registers': '<tr><th data-module="user" data-access="delete"><input name="registers-select-all" type="checkbox" onclick="PosnicPro.checkboxSelectAll(this,\'registers\');"></th><th>#</th><th><lang class="lang_registername_title">Register name</lang></th><th><lang class="lang_date_title">Date</lang></th><th><lang class="lang_id_title">Id</lang></th><th><lang class="lang_user_name">User name</lang></th><th><lang class="lang_newbranch_title">Branch</lang></th><th class="text-right"><lang class="lang_registeramount_title">Register amount</lang></th><th class="text-center"><lang class="lang_action">Action</lang></th></tr>'
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
            'sales': '<tr><th><input name="sales-select-all" type="checkbox" onclick="PosnicPro.checkboxSelectAll(this,\'sales\');"></th><th>#</th><th><lang class="lang_id_title">Id</lang></th><th><lang class="lang_date_title">Date</lang></th><th><lang class="lang_newcustomer_title">Customer</lang></th><th><lang class="lang_process_title">Process</lang></th><th class="text-center"><lang class="lang_price_title">Price</lang></th><th width="16%"><lang class="lang_action_title">Actions</lang></th></tr>',
            'receivings': '<tr><th><input name="receivings-select-all" type="checkbox" onclick="PosnicPro.checkboxSelectAll(this,\'receivings\');"></th><th>#</th><th><lang class="lang_id_title">Id</lang></th><th><lang class="lang_date_title">Date</lang></th><th><lang class="lang_newsupplier_title">Supplier</lang></th><th><lang class="lang_userstatus">Status</lang></th><th class="text-center"><lang class="lang_price_title">Price</lang></th><th width="16%"><lang class="lang_action">Action</lang></th></tr>',
            'customers': '<tr><th><input name="customers-select-all" type="checkbox" onclick="PosnicPro.checkboxSelectAll(this,\'customers\');"></th><th>#</th><th><lang class="lang_name_title">Name</lang></th><th><lang class="lang_phone_title">Phone</lang></th><th><lang class="lang_email_title">Email</lang></th><th><lang class="lang_address_title">Address</lang></th><th><lang class="lang_action">Action</lang></th></tr>',
            'suppliers': '<tr><th><input name="suppliers-select-all" type="checkbox" onclick="PosnicPro.checkboxSelectAll(this,\'suppliers\');"></th><th>#</th><th><lang class="lang_name_title">Name</lang></th><th><lang class="lang_phone_title">Phone</lang></th><th><lang class="lang_email_title">Email</lang></th><th><lang class="lang_address_title">Address</lang></th><th><lang class="lang_action">Action</lang></th></tr>',
            'categories': '<tr><th><input name="categories-select-all" type="checkbox" onclick="PosnicPro.checkboxSelectAll(this,\'categories\');"></th><th>#</th><th><lang class="lang_name_title">Name</lang></th><th><lang class="lang_image">Image</lang></th><th><lang class="lang_discount_title">Discount </lang></th><th><lang class="lang_description_title">Description</lang></th><th><lang class="lang_action">Action</lang></th></tr>',
            'items': '<tr><th><input name="items-select-all" type="checkbox" onclick="PosnicPro.checkboxSelectAll(this,\'items\');"></th><th>#</th><th><lang class="lang_name_title">Name</lang></th><th><lang class="lang_image">Image</lang></th><th><lang class="lang_sku_title">SKU</lang></th><th><lang class="lang_price_title">Price</lang></th><th><lang class="lang_quantity">Quantity</lang></th><th width="15%"><lang class="lang_action">Action</lang></th></tr>',
            'branches': '<tr><th><input name="branches-select-all" type="checkbox" onclick="PosnicPro.checkboxSelectAll(this,\'branches\');"></th><th>#</th><th><lang class="lang_name_title">Name</lang></th><th><lang class="lang_phone_title">Phone</lang></th><th><lang class="lang_email_title">Email</lang></th><th><lang class="lang_address_title">Address</lang></th><th><lang class="lang_country_title">Country</lang></th><th><lang class="lang_state_title">State</lang></th><th><lang class="lang_action">Action</lang></th></tr>',
            'users': '<tr><th><input name="users-select-all" type="checkbox" onclick="PosnicPro.checkboxSelectAll(this,\'users\');"></th><th>#</th><th><lang class="lang_name_title">Name</lang></th><th><lang class="lang_image">Image</lang></th><th><lang class="lang_email_id">Email Id</lang></th><th> Type</th><th width="15%"><lang class="lang_action">Action</lang></th></tr>',
            'expenses': '<tr><th><input name="expenses-select-all" type="checkbox" onclick="PosnicPro.checkboxSelectAll(this,\'expenses\');"></th><th>#</th><th><lang class="lang_amount_title">Amount</lang></th><th><lang class="lang_type_title">Type</lang></th><th><lang class="lang_newcategory_title">Category</lang></th><th><lang class="lang_recipient">Recipient</lang></th><th><lang class="lang_approved_by">Approved By</lang></th><th><lang class="lang_description_title">Description</lang></th><th><lang class="lang_action">Action</lang></th></tr>',
            'registers': '<tr><th><input name="registers-select-all" type="checkbox" onclick="PosnicPro.checkboxSelectAll(this,\'registers\');"></th><th>#</th><th><lang class="lang_registername_title">Register name</lang></th><th><lang class="lang_date_title">Date</lang></th><th><lang class="lang_id_title">Id</lang></th><th><lang class="lang_user_name">User name</lang></th><th><lang class="lang_newbranch_title">Branch</lang></th><th><lang class="lang_registeramount_title">Register amount</lang></th><th><lang class="lang_action">Action</lang></th></tr>',
            'stocklogs': '<tr><th><input name="stocklogs-select-all" type="checkbox" onclick="PosnicPro.checkboxSelectAll(this,\'stocklogs\');"></th><th>#</th><th><lang class="lang_sku_title">SKU</lang></th><th><lang class="lang_name_title">Name</lang></th><th><lang class="lang_date_title">Date</lang></th><th><lang class="lang_process_title">Process</lang></th><th><lang class="lang_opening_balance">Opening Balance</lang></th><th><lang class="lang_closing_balance">Closing Balance</lang></th><th><lang class="lang_action">Action</lang></th></tr>'
        };
        $(TableBody).each(function (key, val) {
            $(".datatable-thead-tbody").empty().html(val[table]);
        });
    },

    appendImportDataTableBody: function (table) {
        var TableBody = {
            'customers': '<tr><th>#</th><th><lang class="lang_name_title">Name</lang></th><th><lang class="lang_phone_title">Phone</lang></th><th><lang class="lang_email_title">Email</lang></th><th><lang class="lang_address_title">Address</lang></th><th><lang class="lang_userstatus">Status</lang></th></tr>',
            'suppliers': '<tr><th>#</th><th><lang class="lang_name_title">Name</lang></th><th><lang class="lang_phone_title">Phone</lang></th><th><lang class="lang_email_title">Email</lang></th><th><lang class="lang_address_title">Address</lang></th><th><lang class="lang_userstatus">Status</lang></th></tr>',
            'categories': '<tr><th>#</th><th><lang class="lang_name_title">Name</lang></th><th><lang class="lang_discount_amount_2">Discount Amount</lang></th> <th><lang class="lang_discount_percentage_2">Discount Percentage</lang></th><th><lang class="lang_userstatus">Status</lang></th></tr>',
            'customercategory': '<tr><th>#</th><th><lang class="lang_name_title">Name</lang></th><th><lang class="lang_description_title">Description</lang></th><th><lang class="lang_userstatus">Status</lang></th></tr>',
            'items': '<tr><th>#</th><th><lang class="lang_name_title">Name</lang></th><th><lang class="lang_category_name">Category Name</lang></th><th><lang class="lang_price_title">Price</lang></th><th><lang class="lang_quantity">Quantity</lang></th><th><lang class="lang_userstatus">Status</lang></th></tr>',
            'expenses': '<tr><th>#</th><th><lang class="lang_type_title">Type</lang></th><th><lang class="lang_amount_title">Amount</lang></th><th><lang class="lang_category_name">Category Name</lang></th><th><lang class="lang_notes_title">Notes</lang></th><th><lang class="lang_userstatus">Status</lang></th></tr>'
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
/*
 * Phone inputs, built when they are wanted rather than at boot.
 *
 * intl-tel-input renders its whole country list into the DOM the moment it
 * initialises: ~1,222 nodes EACH. Three of them were live on the dashboard -
 * 3,666 nodes, 14% of the entire document - for dropdowns behind forms most
 * sessions never open, and all three were built inside the first second,
 * which is exactly the window where iPhones were dying (OWNER_QUEUE 193/195).
 *
 * Nothing about the call sites changes: the instance property is a getter,
 * so `PosnicPro.customers.customer_phone.isValidNumber()` still works and
 * simply builds the widget at that moment. Three triggers, whichever comes
 * first: the user focusing the field, any code touching the property, or -
 * on desktop only - an idle callback, so the flag appears without anyone
 * noticing a change. Phones skip the idle build on purpose: there the whole
 * point is that those nodes never exist unless the field is used.
 */
/*
 * "Collapse the menu so this screen gets the room" - what the sale, item
 * and receiving screens have always done on entry. The catch is that
 * 'toggle-menu' is two different states depending on the breakpoint: on
 * desktop the theme reads it as menu COLLAPSED to the icon rail, but on a
 * phone the hamburger toggles the very same class to mean menu OPEN (an
 * unwrapped `.toggle-menu .leftbar { margin-left: 0 }` in the theme wins
 * over the phone's off-canvas hide by specificity). So a screen adding it
 * unconditionally was opening the full menu OVER itself on every phone.
 * One door for the gesture, with the breakpoint check inside.
 */
PosnicPro.collapseMenuForWorkspace = function () {
    if (window.matchMedia('(min-width: 768px)').matches) {
        $('.vertical-layout').addClass('toggle-menu');
    }
};

PosnicPro.lazyPhoneInput = function (selector, target, prop, opts) {
    var made = null;
    function build() {
        if (made) { return made; }
        var el = document.querySelector(selector);
        if (!el) { return null; }
        try {
            var existing = window.intlTelInputGlobals && window.intlTelInputGlobals.getInstance(el);
            made = existing || window.intlTelInput(el, opts || {});
        } catch (e) { return null; }
        return made;
    }
    try {
        Object.defineProperty(target, prop, { configurable: true, get: build });
    } catch (e) { target[prop] = build(); }
    $(document).on('focusin', selector, build);
    if (!window.__mobileSafeMode) {
        var idle = window.requestIdleCallback || function (fn) { return setTimeout(fn, 4000); };
        idle(function () { build(); });
    }
    return build;
};

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

/*
 * Language, for text JavaScript writes after the page is built.
 *
 * The HTML is translated at build time. Anything drawn later - a button that
 * says Save until you edit something and then says Update - was not, and was
 * handled like this, in fifteen files:
 *
 *     (PosnicPro.local.get('language_herf') === 'ta_dashboard.html')
 *         ? $('#branch_title').text('...') : $('#branch_title').text(PosnicPro.i18n.t('lang_edit_title', 'Edit'));
 *
 * Three problems in one line. The language was identified by a FILENAME. It
 * was a two-way branch, so a third language did not fit without editing all
 * sixty-three of them. And the words lived in code, where no translator could
 * reach them and where nine of them in sales.js had been silently corrupted
 * into mojibake - Tamil bytes read as Latin-1 - and shipped to the sale
 * screen, the most used screen in the product.
 *
 * Now: a language CODE, one dictionary per language as data, and one function.
 *
 * The English is always passed in as the fallback. That is the whole safety
 * property - before the pack loads, if the pack 404s, if a key is missing or
 * a language is half translated, the caller still gets real English rather
 * than "undefined", which is exactly what the build already does for HTML.
 *
 * See Intranet docs/MULTI_LANGUAGE_ARCHITECTURE.md.
 */
PosnicPro.i18n = {
    _dict: null,
    _code: null,
    /* Original English nodes are kept outside the mutable DOM. */
    _english: new WeakMap(),

    /*
     * 'en' | 'ta' | ...
     *
     * Read from the legacy `language_herf`, which holds a page filename like
     * 'ta_dashboard.html'. Existing installs already have that value, so it is
     * migrated rather than reset - resetting would silently put every Tamil
     * shop back into English on upgrade.
     */
    code: function () {
        if (PosnicPro.i18n._code) return PosnicPro.i18n._code;
        var stored = PosnicPro.local.get('language_code');
        if (!stored) {
            var href = PosnicPro.local.get('language_herf') || '';
            var m = /^([a-z]{2})_/.exec(href);
            if (!m) {
                /* Nothing chosen, ever. English for now, and NOT written back:
                   a stored value looks exactly like a choice, and the first-run
                   detection below only runs for a machine that never chose. */
                return 'en';
            }
            stored = m[1];
            PosnicPro.local.set('language_code', stored);
        }
        PosnicPro.i18n._code = stored;
        return stored;
    },

    /* Has anybody on this machine ever picked a language? */
    chosen: function () {
        return !!(PosnicPro.local.get('language_code') || PosnicPro.local.get('language_herf'));
    },

    is: function (code) {
        return PosnicPro.i18n.code() === code;
    },

    /*
     * The user picked a language.
     *
     * Still takes the page filename, because until the HTML stops being built
     * per language that filename is also where the browser has to go. It
     * records the CODE alongside it, and drops the cached value so the next
     * t() answers as the new language rather than the one being left.
     */
    select: function (href) {
        var m = /^([a-z]{2})_/.exec(String(href || ''));
        var code = m ? m[1] : 'en';
        PosnicPro.local.set('language_herf', href);
        PosnicPro.local.set('language_code', code);
        PosnicPro.i18n._code = code;
        PosnicPro.i18n._dict = null;
        return code;
    },

    /*
     * t('lang_edit', 'Edit')
     *
     * The second argument is not optional in spirit: it is the English the old
     * code carried in its else branch, and it is what ships when anything at
     * all goes wrong.
     */
    t: function (key, english) {
        var d = PosnicPro.i18n._dict;
        if (d && Object.prototype.hasOwnProperty.call(d, key)) {
            var value = d[key];
            /* An empty entry is not a translation. Treating it as one is how a
               generated skeleton blanks a button. */
            if (typeof value === 'string' && value.trim() !== '') return value;
        }
        return english;
    },

    /*
     * Scripts written right to left, by BCP 47 primary subtag.
     *
     * The document direction follows the language, so Arabic mirrors the
     * layout without its pack having to say so - and a language this list
     * does not know is left to right, the safe default for a till.
     */
    /* Attributes people read. Marked in the markup as data-t-<attr>="key"
       by the tagger, translated here, restored by restore(). */
    _attrs: ['placeholder', 'title', 'aria-label'],

    _rtl: { ar: 1, he: 1, fa: 1, ur: 1, ps: 1, sd: 1, ug: 1, yi: 1, dv: 1, ckb: 1 },

    rtl: function (code) {
        var primary = String(code || '').toLowerCase().split('-')[0];
        return !!PosnicPro.i18n._rtl[primary];
    },

    /*
     * Tell the document which language it is in.
     *
     * <html lang> is what screen readers, spell-checkers, hyphenation and font
     * fallback read: a Tamil page marked lang="en" gets English hyphenation
     * and whichever font the browser reaches for first. dir="rtl" is the
     * whole of Arabic's text layout - the browser mirrors text, tables and
     * inline flow from that one attribute, and static/style/css/rtl.css
     * mirrors the chrome. Runs before the pack arrives, so direction never
     * waits on a fetch.
     */
    mark: function () {
        if (typeof document === 'undefined' || !document.documentElement) return;
        var code = PosnicPro.i18n.code();
        document.documentElement.setAttribute('lang', code);
        document.documentElement.setAttribute('dir', PosnicPro.i18n.rtl(code) ? 'rtl' : 'ltr');
    },

    /*
     * The language a first run should start in.
     *
     * BCP 47 lookup (RFC 4647): walk the browser's preferences in order and
     * take the first one this build ships, trying the full tag ('pt-BR') and
     * then its primary subtag ('pt'). English when nothing matches. Only ever
     * consulted for a machine where nobody has chosen - a choice, once made,
     * is never second-guessed by the operating system's locale.
     *
     * `preferred` is for tests; the browser's list is the real input.
     */
    detect: function (offered, preferred) {
        var byCode = {};
        (offered || []).forEach(function (l) {
            if (l && l.code) byCode[String(l.code).toLowerCase()] = String(l.code);
        });
        var nav = (typeof navigator !== 'undefined') ? navigator : {};
        var prefs = preferred
            || (nav.languages && nav.languages.length ? nav.languages : [nav.language || 'en']);
        for (var i = 0; i < prefs.length; i++) {
            var tag = String(prefs[i] || '').toLowerCase();
            if (!tag) continue;
            if (byCode[tag]) return byCode[tag];
            var primary = tag.split('-')[0];
            if (byCode[primary]) return byCode[primary];
        }
        return 'en';
    },

    /*
     * Fetch this shop's language pack, once.
     *
     * English loads nothing at all - it is in the markup and in every t()
     * call, so there is nothing to fetch and no request to fail.
     *
     * Deliberately not awaited by callers. The pack is a local file behind the
     * service worker and lands long before any button is clicked; if it were
     * ever late, t() returns English for a moment rather than blocking the
     * page on a network read.
     */
    load: function () {
        var code = PosnicPro.i18n.code();
        PosnicPro.i18n.mark();
        if (code === 'en' || PosnicPro.i18n._dict) return Promise.resolve();
        return fetch('languages/' + code + '.json')
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (json) { if (json) PosnicPro.i18n._dict = json; })
            .catch(function () { /* English is already the answer */ });
    },

    /*
     * Translate the markup in place.
     *
     * Pages are built ONCE now, in English, and carry their keys with them:
     *
     *     <lang class="lang_item_name">Item name</lang>
     *     <title data-t="lang_login_title">Login Here</title>
     *
     * The <lang> element stays where the words are ordinary content. Inside
     * <title> and <option> the parser will not build an element for it, so
     * the build hoists the key onto the parent instead - both are handled
     * here, because a caller should not have to know which is which.
     *
     * English does nothing at all: the markup is already English, so there is
     * no work, no flicker and nothing to get wrong.
     *
     * Takes a root so markup rendered later - a modal, an AJAX table - can be
     * translated the moment it exists rather than waiting for a reload.
     */
    /*
     * The few tags a translation is allowed to carry.
     *
     * Not a general HTML subset - just what the packs actually need: a feather
     * icon before "Download", and the <span> the code later rewrites with a
     * screen name. Anything else is unwrapped, keeping its text.
     */
    _allowedTags: { SPAN: 1, I: 1, B: 1, STRONG: 1, EM: 1, SMALL: 1, BR: 1, U: 1 },
    _allowedAttrs: { id: 1, class: 1 },

    /*
     * Put a translation that carries markup onto the page, safely.
     *
     * This was `el.innerHTML = value`, justified by a comment saying the packs
     * were "this repository's own files... not user input". That was true when
     * it was written and stopped being true the same week, when translations
     * were opened to outside contributors and twelve packs were seeded for
     * strangers to correct. A pack is now a pull request reviewed by somebody
     * who by definition cannot read the language: `<img src=x onerror=...>`
     * inside a Malayalam string looks exactly like Malayalam. Signing the asset
     * channel proves where a pack came from, never that it is safe to run.
     *
     * The parse happens inside a <template>, whose content is an inert
     * fragment - scripts do not run and images do not load, even for what is
     * about to be thrown away. Only then is the tree walked and anything
     * outside the allowlist removed, so what reaches the page is a small,
     * known set of tags carrying nothing but id and class.
     */
    _setMarkup: function (el, value) {
        var doc = el.ownerDocument;
        var tpl = doc.createElement('template');
        /* Inert: nothing here is rendered, fetched or executed. */
        tpl.innerHTML = value;

        var clean = function (node) {
            var child = node.firstChild;
            while (child) {
                var next = child.nextSibling;
                if (child.nodeType === 1) {
                    if (!PosnicPro.i18n._allowedTags[child.tagName]) {
                        /* Unwrap rather than delete: a translator who wrapped a
                           word in something we do not allow still wrote the
                           word, and losing it silently would be worse. */
                        clean(child);
                        while (child.firstChild) node.insertBefore(child.firstChild, child);
                        node.removeChild(child);
                    } else {
                        var attrs = child.attributes;
                        for (var a = attrs.length - 1; a >= 0; a--) {
                            if (!PosnicPro.i18n._allowedAttrs[attrs[a].name.toLowerCase()]) {
                                child.removeAttribute(attrs[a].name);
                            }
                        }
                        clean(child);
                    }
                } else if (child.nodeType !== 3) {
                    /* Comments and anything else carry no words. */
                    node.removeChild(child);
                }
                child = next;
            }
        };
        clean(tpl.content);

        while (el.firstChild) el.removeChild(el.firstChild);
        el.appendChild(tpl.content);
    },

    apply: function (root) {
        var dict = PosnicPro.i18n._dict;
        if (!dict) return;
        var scope = root || document;
        var set = function (el, key) {
            if (!key) return;
            var value = dict[key];
            /* Missing or blank leaves the English that is already there. */
            if (typeof value !== 'string' || value.trim() === '') return;
            /* The English is in no pack - it is what the page shipped with.
               Keep clones outside the mutable DOM the first time it is
               overwritten, so a switch back to English is a restore rather
               than a reload. */
            if (!PosnicPro.i18n._english.has(el)) {
                var original = [];
                for (var child = el.firstChild; child; child = child.nextSibling) {
                    original.push(child.cloneNode(true));
                }
                PosnicPro.i18n._english.set(el, original);
            }
            /*
             * A handful of strings carry an &nbsp; or similar entity. Three
             * cases:
             *
             *   the page has markup, the words do not   -> keep the page's
             *                                              icon, swap the words
             *   plain text on both sides                -> the common case
             *   the translation contains a tag          -> shown as text
             *
             * A TAG IS NEVER TREATED AS MARKUP. This used to read
             * `if (/[<&]/.test(value)) el.innerHTML = value`, justified by the
             * packs being "this repository's own files... not user input".
             *
             * That stopped being true the day translations were opened to
             * outside contributors. A pack is now a pull request from a
             * stranger, reviewed by somebody who by definition cannot read the
             * language - `<img src=x onerror=...>` in a Malayalam string looks
             * exactly like Malayalam to the reviewer. Signing the asset channel
             * proves where a pack came from, not that it is safe.
             *
             * Entities are still decoded, because &nbsp; is legitimate and
             * common. A detached <textarea> parses its content as text rather
             * than markup, so nothing is ever constructed as an element - and
             * it is only reached for values with no `<` in them at all.
             */
            if (/[<&]/.test(value)) {
                PosnicPro.i18n._setMarkup(el, value);
                return;
            }
            if (el.children && el.children.length) {
                var swapped = false;
                for (var n = el.firstChild; n; n = n.nextSibling) {
                    if (n.nodeType !== 3) continue;
                    if (!swapped && n.nodeValue.trim() !== '') { n.nodeValue = value; swapped = true; }
                    else n.nodeValue = '';
                }
                if (!swapped) el.appendChild(el.ownerDocument.createTextNode(value));
                return;
            }
            el.textContent = value;
        };
        /* querySelectorAll never returns its own root; a <lang> handed in
           by the observer is the thing to translate. */
        if (root && root.nodeType === 1) {
            if (root.tagName === 'LANG') set(root, (root.getAttribute('class') || '').trim());
            else if (root.hasAttribute('data-t')) set(root, root.getAttribute('data-t'));
        }
        var tags = scope.querySelectorAll('lang[class]');
        for (var i = 0; i < tags.length; i++) {
            set(tags[i], (tags[i].getAttribute('class') || '').trim());
        }
        var marked = scope.querySelectorAll('[data-t]');
        for (var j = 0; j < marked.length; j++) {
            set(marked[j], marked[j].getAttribute('data-t'));
        }
        /* placeholder, title, aria-label: the words a person reads that are
           not text nodes. The English is kept the same way, per attribute. */
        var attrs = PosnicPro.i18n._attrs;
        for (var a = 0; a < attrs.length; a++) {
            var els = Array.prototype.slice.call(scope.querySelectorAll('[data-t-' + attrs[a] + ']'));
            if (root && root.nodeType === 1 && root.hasAttribute('data-t-' + attrs[a])) els.unshift(root);
            for (var e = 0; e < els.length; e++) {
                var value = dict[els[e].getAttribute('data-t-' + attrs[a])];
                if (typeof value !== 'string' || value.trim() === '') continue;
                if (!els[e].hasAttribute('data-en-' + attrs[a])) {
                    els[e].setAttribute('data-en-' + attrs[a], els[e].getAttribute(attrs[a]) || '');
                }
                els[e].setAttribute(attrs[a], value);
            }
        }
    },

    /*
     * Put the English back.
     *
     * apply() keeps cloned English nodes outside the DOM the first time it
     * overwrites them, so this is the whole of "switch to English": the
     * words are not fetched from anywhere, they were here all along.
     */
    restore: function (root) {
        var scope = root || document;
        var kept = scope.querySelectorAll('lang[class], [data-t]');
        for (var i = 0; i < kept.length; i++) {
            var original = PosnicPro.i18n._english.get(kept[i]);
            if (!original) continue;
            while (kept[i].firstChild) kept[i].removeChild(kept[i].firstChild);
            for (var j = 0; j < original.length; j++) {
                kept[i].appendChild(original[j].cloneNode(true));
            }
        }
        var attrs = PosnicPro.i18n._attrs;
        for (var a = 0; a < attrs.length; a++) {
            var els = scope.querySelectorAll('[data-en-' + attrs[a] + ']');
            for (var e = 0; e < els.length; e++) {
                els[e].setAttribute(attrs[a], els[e].getAttribute('data-en-' + attrs[a]));
            }
        }
    },

    /*
     * Translate markup as it lands.
     *
     * Most of the interface is drawn by JavaScript after load - list rows,
     * table headers, the receipt panel, every modal body - and none of it
     * passed through apply(). A module can write <lang class="key">English
     * </lang> into any string it renders and forget about it: each added
     * subtree is translated the moment it is in the document. Nothing at all
     * happens for a shop in English (no dictionary, no work), and apply()
     * reads keys rather than text, so it cannot translate its own output
     * twice. Text nodes are skipped: a translation that only changed words
     * must not wake the observer that made it.
     */
    watch: function (root) {
        if (typeof document === 'undefined') return null;
        /* The observer of the document being watched - a test's, or ours. */
        var doc = (root && root.ownerDocument) || document;
        var Observer = (doc.defaultView && doc.defaultView.MutationObserver)
            || (typeof MutationObserver !== 'undefined' ? MutationObserver : null);
        if (!Observer) return null;
        var observer = new Observer(function (records) {
            if (!PosnicPro.i18n._dict) return;
            for (var r = 0; r < records.length; r++) {
                var added = records[r].addedNodes;
                for (var a = 0; a < added.length; a++) {
                    if (added[a].nodeType === 1) PosnicPro.i18n.apply(added[a]);
                }
            }
        });
        observer.observe(root || document.documentElement, { childList: true, subtree: true });
        return observer;
    },

    /*
     * Switch language without leaving the page.
     *
     * This used to navigate to ta_dashboard.html, because the language WAS the
     * filename. There is one page now, so switching is a fetch and a redraw -
     * which is also why it is instant rather than a reload. English is the one
     * language with no pack: switching to it restores what the page shipped.
     */
    change: function (code) {
        PosnicPro.i18n.select(code === 'en' ? 'dashboard.html' : code + '_dashboard.html');
        PosnicPro.i18n.mark();
        return PosnicPro.i18n.load().then(function () {
            if (PosnicPro.i18n.code() === 'en') PosnicPro.i18n.restore();
            else PosnicPro.i18n.apply();
        });
    }
};
PosnicPro.i18n.load().then(function () { PosnicPro.i18n.apply(); });
/*
 * First run.
 *
 * A machine where nobody has chosen a language starts in the browser's
 * language if this build ships it, else English - decided once, here, so the
 * login page and the dashboard agree without either knowing about the other.
 * Anything that wants the settled language (the menu label, the per-language
 * type sizes) waits on `ready`, which never rejects: whatever fails along the
 * way, English is already on the screen.
 */
PosnicPro.i18n.ready = (function firstRun() {
    var settle = (PosnicPro.i18n.chosen() || typeof fetch !== 'function')
        ? Promise.resolve()
        : fetch('languages/index.json')
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (list) {
                var detected = PosnicPro.i18n.detect(list || []);
                if (detected !== 'en') return PosnicPro.i18n.change(detected);
            });
    return settle
        .then(function () { return PosnicPro.i18n.load(); })
        .then(function () { PosnicPro.i18n.apply(); })
        .catch(function () { /* English, as shipped */ });
}());
/* Markup drawn after load is translated as it lands - see i18n.watch(). */
PosnicPro.i18n.watch();
/*
 * A plain <select id="language_select"> anywhere offers the same list the
 * header menu does. The login page has one: somebody who cannot read the
 * sign-in screen should not have to sign in to change it. Filled after the
 * first run has settled, so it opens on the language actually in use.
 */
PosnicPro.i18n.ready.then(function () {
    var pick = (typeof document !== 'undefined') ? document.getElementById('language_select') : null;
    if (!pick || typeof fetch !== 'function') return;
    fetch('languages/index.json')
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (list) {
            if (!Array.isArray(list) || !list.length) return;
            var current = PosnicPro.i18n.code();
            pick.innerHTML = list.map(function (l) {
                return '<option value="' + l.code + '"' + (l.code === current ? ' selected' : '') + '>'
                    + l.name + (l.reviewed === false ? ' (beta)' : '') + '</option>';
            }).join('');
            pick.onchange = function () { PosnicPro.i18n.change(pick.value); };
            pick.style.display = '';
        })
        .catch(function () { /* the page stays as it is */ });
});
/* Markup that exists before the pack lands still gets translated: this runs
   again once the DOM is ready, and apply() is idempotent. */
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', function () { PosnicPro.i18n.apply(); });
}
$(document).ready(function () {
    // Printer and paper are set per machine in Hardware Manager. Pull them in
    // before the first sale so the first receipt is right, not the second.
    PosnicPro.syncPrinterPreferences();

    //    $(".changeCountry").append('<option id="Select country"  value="" data-t="lang_select_country">Select Country</option>');
    //    $(".changeState").append('<option id="Select State" value="" data-t="lang_select_state">Select State</option>');

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
                        PosnicPro.alert('error', PosnicPro.i18n.t('lang_empty_csv_file', 'Empty CSV file'));
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
/*
 * NO DEXIE ON PHONES (owner's order mid crash-hunt: "stop dexie itself.
 * dont include in mobile and lets see."). Apple's IndexedDB backend is the
 * one boot subsystem no probe ever gated - it is shared by every iOS
 * browser, absent from desktop WebKit builds, and carries a long history
 * of WebKit process crashes. On phones the db is an inert stand-in whose
 * every read answers empty and every write vanishes: the features it
 * backs (customer display sync, focus restore, print label memory) are
 * desk-till features anyway. Desktop keeps real Dexie, unchanged.
 */
var db;
if (window.__mobileSafeMode) {
    db = (function () {
        var done = function () { return Promise.resolve(); };
        var none = function (cb) {
            /* Dexie's toArray accepts a callback - honour both styles */
            if (typeof cb === 'function') { try { cb([]); } catch (e) { } }
            return Promise.resolve([]);
        };
        var chain = { toArray: none, delete: done, first: function () { return Promise.resolve(undefined); }, modify: done, count: function () { return Promise.resolve(0); } };
        var tbl = {
            get: function () { return Promise.resolve(undefined); },
            put: done, add: done, delete: done, clear: done, update: done, bulkPut: done,
            toArray: none,
            where: function () { return { equals: function () { return chain; }, anyOf: function () { return chain; } }; }
        };
        var stub = {
            version: function () { return { stores: function () { return this; }, upgrade: function () { return this; } }; },
            open: done, close: function () { }, delete: done,
            table: function () { return tbl; },
            on: function () { }
        };
        ['customers', 'items', 'suppliers', 'categories', 'users', 'branches', 'expenses',
         'receivings', 'sales', 'offline_hash', 'queue', 'currentbranch', 'currentregister',
         'customerDisplay', 'saleAutoFocus', 'recevingAutoFocus', 'customerPlan',
         'printLableValues'].forEach(function (t) { stub[t] = tbl; });
        return stub;
    })();
} else {
    db = new Dexie("posnicpro");
}
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
$(function () { PosnicPro.injectReportExportButtons(); });
/*
 * Where Close should go back to, when the answer is not "the list".
 *
 * "Saved an item. Open it" is a detour from a form somebody is still working
 * in. Following it and closing sent them to the item LIST, because the close
 * handler below reads the hash and #/items/<id> means "a record, so go to the
 * records" - it has no way to know you arrived from the form rather than from
 * the list (reported: "i opened it. i closed it. page went item list").
 *
 * One marker fixes it for every screen with that strip - there are ten - rather
 * than teaching the close handler about each one. It is set on the way out and
 * cleared on the way back, so it can never leak into an unrelated Close: a
 * stale marker sending someone to a form they did not come from would be worse
 * than the list.
 */
PosnicPro.returnTo = '';
$(document).on('click', '[id^="last_created_"]', function () {
    PosnicPro.returnTo = currentHash || '';
});

/*
 * The modules whose ADD form is an infobar floating over its own list -
 * the only ones whose cancelled add may close silently. A module whose
 * form is a full page (items, receivings, sales) must never join this
 * list: for those the route dispatch is what brings the list back.
 */
PosnicPro.INFOBAR_LIST_ADDS = {
    customers: 1, suppliers: 1, users: 1, expenses: 1,
    categories: 1, customercategory: 1, variants: 1
};
$(".infobar-settings-close").on("click", function (e) {
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
    /* Honoured once, then forgotten. */
    if (PosnicPro.returnTo) {
        var back = PosnicPro.returnTo;
        PosnicPro.returnTo = '';
        if (back && back !== currentHash) {
            hasher.setHash(back);
            return;
        }
    }
    /*
     * A slide-over opened OVER a mini-dossier pane (a category's sales
     * activity, an employee's full profile) is an overlay, not the owner
     * of the hash - closing it must leave the pane's document address
     * alone, or the pane snaps shut with it.
     */
    var overParts = currentHash.split('/');
    if (typeof overParts[1] !== 'undefined' && /^[a-f\d]{24}$/i.test(overParts[1])
        && typeof overParts[2] === 'undefined'
        && PosnicPro.listDoc && PosnicPro.listDoc.activeId(overParts[0]) === overParts[1]) {
        var overId = $(this).data('id');
        e.preventDefault();
        $('#infobar-settings-sidebar-' + overId).removeClass('sidebarshow');
        $('#infobar-settings-sidebar-' + overId + '-details').removeClass('sidebarview');
        $('.infobar-settings-sidebar-overlay').css({ "background": "transparent", "position": "initial" });
        return;
    }
    var patt = /^[a-f\d]{24}$/i;
    var parts = currentHash.split('/');
    if (typeof parts[1] !== 'undefined' && patt.test(parts[1])) {
        if (parts[0] === 'sales' && (parts[2] === 'hold' || parts[2] === 'edit')) {
            hasher.setHash(parts[0] + '/' + parts[1] + '/' + parts[2]);
        } else if (typeof parts[2] === 'undefined'
                && (PosnicPro.INFOBAR_LIST_ADDS[parts[0]] || parts[0] === 'items')
                && $('#view_' + parts[0]).data('total') !== undefined) {
            /*
             * Closing a DETAILS panel over its loaded list: the same silent
             * restore as a cancelled add - reading a record changes nothing,
             * so the list needs no re-fetch. Pure details only (no parts[2]):
             * an edit route may be a full page (items), where the dispatch
             * is the way back.
             */
            hasher.changed.active = false;
            hasher.setHash(parts[0]);
            hasher.changed.active = true;
            currentHash = parts[0];
        } else {
            hasher.setHash(parts[0]);
        }
    } else if (parts[0] === 'sales') {
        hasher.setHash(parts[0] + '/' + parts[1]);
    } else if (parts[0] === 'kotorder' && parts[1] === 'new') {
        hasher.setHash(parts[0] + '/' + parts[1]); // Keep kotorder/new intact
    } else if (parts[1] === 'new' && PosnicPro.INFOBAR_LIST_ADDS[parts[0]]
            && $('#view_' + parts[0]).data('total') !== undefined) {
        /*
         * Cancelling an add panel that floats OVER its list (saves patch,
         * close edition): the list beneath is already rendered and nothing
         * changed, so restore the hash WITHOUT the changed signal - which
         * is what the comment below always claimed and never did. The
         * route not firing is the point: no re-fetch, no re-render.
         * Two escapes stay on the dispatching branch: full-page forms
         * (items, receivings), for which the route IS the way back - and
         * a DEEP-LINKED add panel, where showAdd opened over a list that
         * never loaded (data('total') unset until the table's first
         * fetch), so the dispatch is what fills the empty page.
         */
        hasher.changed.active = false;
        hasher.setHash(parts[0]);
        hasher.changed.active = true;
        currentHash = parts[0];
    } else if (parts[1] === 'new' || parts[1] === 'tax' || parts[1] === 'unit' || parts[1] === 'taxgroup' || parts[1] === 'denom' || parts[1] === 'default' || parts[1] === 'payment' || parts[1] === 'tableorder') {
        hasher.setHash(parts[0]); //set hash without dispatching changed signal
    } else if (parts[2] === 'new' && parts[2] !== 'sales/categories/new') {
        hasher.setHash(parts[0] + '/' + parts[2]); //set hash without dispatching changed signal
    }

    let stringData = $(this).data("id");
    $("#infobar-settings-sidebar-category").removeClass("sidebarshow");
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
            { name: 'minimize', label: PosnicPro.i18n.t('lang_minimise', 'Minimise'),
              path: '<rect x="2" y="5.5" width="8" height="1" fill="currentColor" />' },
            /* Two icons, because this button means two different things. Not
               maximised it maximises, and shows one square. Maximised it
               restores, and every other application on the machine draws two
               overlapping squares for that - one square there tells the shop
               the click will do something it will not. See paintMaximise. */
            { name: 'maximize', label: PosnicPro.i18n.t('lang_maximise', 'Maximise'),
              path: '<rect x="2.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" />' },
            { name: 'close', label: PosnicPro.i18n.t('lang_close_title', 'Close'),
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
            var label = maximised ? PosnicPro.i18n.t('lang_restore_down', 'Restore down') : PosnicPro.i18n.t('lang_maximise', 'Maximise');
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

/*
 * GST 2.0 readiness (#/gstreadiness) - the migration checklist from
 * HSN_GST2_RATE_REFRESH_DESIGN increment 2. Read-only by design: it names
 * items whose rate deserves a look and links out to the item, and never
 * writes a rate itself. The server decides what qualifies; this renders it.
 */
PosnicPro.gstreadiness = {
    _last: null,
    showDataTablePage: function () {
        PosnicPro.HideSideBarModal();
        $(".vertical-layout").removeClass("toggle-menu");
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $(".vertical-menu li a").removeClass("active");
        $('.page_loader,#osk-container').hide();
        $('.page-title-box,#gstreadiness_new').show();
        $('#v-pills-report-tab').addClass('active');
        $('#v-pills-report').addClass('show active');
        PosnicPro.gstreadiness.run();
    },
    _esc: function (s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    },
    run: function () {
        var esc = PosnicPro.gstreadiness._esc;
        $('#gstready_retired').html('<tr><td colspan="4" class="text-center text-muted"><lang class="lang_scanning">Scanning&hellip;</lang></td></tr>');
        $('#gstready_differs').html('<tr><td colspan="5" class="text-center text-muted"><lang class="lang_scanning">Scanning&hellip;</lang></td></tr>');
        PosnicPro.get('items/gstReadiness', function (response) {
            var d = (response && response.data) || {};
            PosnicPro.gstreadiness._last = d;
            var retired = d.retired || [];
            var differs = d.differs || [];

            $('#gstready_counts').text(
                (retired.length + differs.length) + ' of ' + (d.examined || 0) + ' items need a look'
            );
            $('#gstready_notice').text(d.notice || '').toggle(!!d.notice);

            if (!retired.length) {
                $('#gstready_retired').html('<tr><td colspan="4" class="text-center text-muted">'
                    + 'Nothing on a withdrawn slab - this part is done.</td></tr>');
            } else {
                $('#gstready_retired').html(retired.map(function (r) {
                    return '<tr class="gstready-row" data-id="' + esc(r.id) + '" style="cursor:pointer;">'
                        + '<td>' + esc(r.name) + '</td>'
                        + '<td>' + (esc(r.hsncode) || '<span class="text-muted">not set</span>') + '</td>'
                        + '<td class="text-right text-danger font-weight-bold">' + r.rate + '%</td>'
                        + '<td class="text-muted">' + esc(r.reason) + '</td></tr>';
                }).join(''));
            }

            if (!differs.length) {
                $('#gstready_differs').html('<tr><td colspan="5" class="text-center text-muted">'
                    + 'No item disagrees with a live reference rate.</td></tr>');
            } else {
                $('#gstready_differs').html(differs.map(function (r) {
                    return '<tr class="gstready-row" data-id="' + esc(r.id) + '" style="cursor:pointer;">'
                        + '<td>' + esc(r.name) + '</td>'
                        + '<td>' + esc(r.hsncode) + '</td>'
                        + '<td class="text-right">' + r.rate + '%</td>'
                        + '<td class="text-right">' + r.reference_rate + '%</td>'
                        + '<td class="text-muted">HSN ' + esc(r.matched_on) + '</td></tr>';
                }).join(''));
            }
        }, function () {
            $('#gstready_retired').html('<tr><td colspan="4" class="text-center text-muted"><lang class="lang_could_not_run_the_scan_try_again">Could not run the scan - try again.</lang></td></tr>');
            $('#gstready_differs').html('');
        });
    },
    exportCsv: function () {
        var d = PosnicPro.gstreadiness._last;
        if (!d) { PosnicPro.alert('warning', PosnicPro.i18n.t('lang_run_the_scan_first', 'Run the scan first.')); return; }
        var rows = [['Section', 'Item', 'HSN', 'Current rate', 'Reference rate', 'Note']];
        (d.retired || []).forEach(function (r) {
            rows.push(['Withdrawn slab', r.name, r.hsncode, r.rate + '%', '', r.reason]);
        });
        (d.differs || []).forEach(function (r) {
            rows.push(['Differs from reference', r.name, r.hsncode, r.rate + '%', r.reference_rate + '%', r.reason]);
        });
        var csv = rows.map(function (row) {
            return row.map(function (cell) {
                return '"' + String(cell == null ? '' : cell).replace(/"/g, '""') + '"';
            }).join(',');
        }).join('\n');
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.download = 'gst-readiness.csv';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }
};
$(document).on('click', '.gstready-row', function () {
    var id = $(this).data('id');
    if (id) { hasher.setHash('items/' + id + '/edit'); }
});

/*
 * The shared master-detail pattern (owner: "these designs should be common
 * and sharable to other features"). A page starts as a plain full-width
 * list; opening a document adds the split classes so the list becomes the
 * rail and the document sits beside it. Quotes pioneered the look; every
 * adopter passes its own ids and shares the CSS.
 */
PosnicPro.masterDetail = {
    /* sel is the element that BECOMES the split surface - quotes uses its
       contentbar, purchases an inner wrapper. The splitClass is the page's
       own name for its split, so page CSS can differ without forking the
       pattern. */
    enter: function (sel, splitClass) {
        $(sel).addClass('master-detail ' + splitClass);
    },
    leave: function (sel, splitClass) {
        $(sel).removeClass('master-detail ' + splitClass + ' rail-collapsed');
    },
    inSplit: function (sel, splitClass) {
        return $(sel).hasClass(splitClass);
    },
    toggleRail: function (sel) {
        $(sel).toggleClass('rail-collapsed');
    }
};

/*
 * The peek modal (LIST_PAGE_UX_STANDARD field lesson): a widget or a list
 * row on a WORK screen shows its record IN PLACE - details first, with a
 * deliberate link out for whoever wants the full page. One shared modal so
 * five pages do not each grow their own; the hash never moves, so closing
 * it leaves the page exactly as it was.
 */
PosnicPro.peek = {
    _ensure: function () {
        if ($('#pp_peek_modal').length) { return; }
        $('body').append(
            '<div class="modal fade close_on_esc" id="pp_peek_modal" tabindex="-1" role="dialog" aria-hidden="true">'
            + '<div class="modal-dialog" role="document"><div class="modal-content">'
            + '<div class="modal-header" style="align-items:center;">'
            + '<h5 class="modal-title" id="pp_peek_title"></h5>'
            + '<button type="button" class="close" data-dismiss="modal" aria-label="Close" data-t-aria-label="lang_close_title"><span aria-hidden="true">&times;</span></button>'
            + '</div>'
            + '<div class="modal-body" id="pp_peek_body" style="max-height:70vh; overflow-y:auto;"></div>'
            + '<div class="modal-footer" id="pp_peek_footer" style="justify-content:space-between; display:none;"></div>'
            + '</div></div></div>');
    },
    open: function (o) {
        o = o || {};
        PosnicPro.peek._ensure();
        $('#pp_peek_modal .modal-dialog').toggleClass('modal-lg', !!o.large);
        $('#pp_peek_title').text(o.title || '');
        $('#pp_peek_body').html(o.body || '<div class="text-center text-muted" style="padding:40px;"><lang class="lang_loading_4">Loading ...</lang></div>');
        $('#pp_peek_footer').html(o.footer || '').toggle(!!o.footer);
        $('#pp_peek_modal').modal('show');
    },
    /* Fill in a late-arriving body/footer without reopening. */
    fill: function (o) {
        o = o || {};
        if (o.title != null) { $('#pp_peek_title').text(o.title); }
        if (o.body != null) { $('#pp_peek_body').html(o.body); }
        if (o.footer != null) { $('#pp_peek_footer').html(o.footer).toggle(!!o.footer); }
    },
    close: function () {
        $('#pp_peek_modal').modal('hide');
    },
    /* A labelled fact row - the vocabulary every peek shares. */
    row: function (label, value) {
        if (value == null || value === '') { return ''; }
        return '<tr><th style="white-space:nowrap; padding:6px 14px 6px 0; font-weight:600;">' + label + '</th>'
            + '<td style="padding:6px 0;">' + value + '</td></tr>';
    },
    table: function (rows) {
        return '<table class="table table-borderless mb-0" style="font-size:13.5px;"><tbody>' + rows + '</tbody></table>';
    }
};

/*
 * The mini-dossier pane (owner: "i didnt want pop. i want similar right
 * side open design. maintain consistency"): every list opens its record
 * in the SAME right pane the big pages use - master-detail split, URL per
 * record, pull/close toolbar, boxed sheet. One helper so eight small pages
 * do not each grow their own openDoc/closeDoc.
 */
PosnicPro.listDoc = {
    _cfg: {},
    activeId: function (key) {
        var c = PosnicPro.listDoc._cfg[key];
        return c ? c.id : null;
    },
    open: function (o) {
        var split = '#' + o.key + '_split';
        if (!PosnicPro.masterDetail.inSplit(split, o.key + '-split')) {
            PosnicPro.masterDetail.enter(split, o.key + '-split');
            $('#' + o.key + '_detail_card').show();
        }
        PosnicPro.listDoc._cfg[o.key] = { hashBase: o.hashBase || o.key, id: String(o.id) };
        $('#' + o.key + '_list_rows tr').removeClass('is-active');
        $('#' + o.key + '_list_rows tr[data-id="' + o.id + '"]').addClass('is-active');
        if (o.hash !== false) {
            var want = (o.hashBase || o.key) + '/' + o.id;
            if (window.location.hash.slice(2) !== want) { hasher.setHash(want); }
        }
        var esc = function (t) { return $('<span>').text(t == null ? '' : t).html(); };
        var toolbar = '<div class="p-doc-toolbar">'
            + '<button type="button" class="btn btn-sm btn-light" title="Show or hide the list" data-t-title="lang_show_or_hide_the_list" aria-label="Show or hide the list" data-t-aria-label="lang_show_or_hide_the_list" onclick="PosnicPro.masterDetail.toggleRail(\'' + split + '\');"><i class="feather icon-sidebar"></i></button>'
            + '<span class="p-doc-title">' + esc(o.title) + '</span>' + (o.pills || '')
            + '<span class="ml-auto"></span>'
            + (o.actions || '')
            + '<button type="button" class="btn btn-sm btn-light" title="Close and show the full list" data-t-title="lang_close_and_show_the_full_list" aria-label="Close" data-t-aria-label="lang_close_title" onclick="PosnicPro.listDoc.close(\'' + o.key + '\');"><i class="feather icon-x"></i></button>'
            + '</div>';
        $('#' + o.key + '_doc').html(toolbar
            + '<div class="s-doc-body"><div class="q-sheet s-sheet">'
            + (o.body || '<div class="text-center text-muted" style="padding:40px;"><lang class="lang_loading_4">Loading ...</lang></div>')
            + '</div></div>');
    },
    /* Swap the sheet's content once a fetch lands - the pane is already
       open, the toolbar already right. */
    body: function (key, html) {
        $('#' + key + '_doc .q-sheet').html(html);
    },
    title: function (key, text) {
        $('#' + key + '_doc .p-doc-title').text(text);
    },
    close: function (key) {
        var c = PosnicPro.listDoc._cfg[key] || {};
        $('#' + key + '_detail_card').hide();
        $('#' + key + '_list_rows tr').removeClass('is-active');
        PosnicPro.masterDetail.leave('#' + key + '_split', key + '-split');
        var base = c.hashBase || key;
        if (window.location.hash.slice(2).indexOf(base + '/') === 0) {
            hasher.setHash(base);
        }
        PosnicPro.listDoc._cfg[key] = null;
    },
    /* The shared fact vocabulary the panes and the till peek both speak. */
    row: function (label, value) {
        return PosnicPro.peek.row(label, value);
    },
    table: function (rows) {
        return PosnicPro.peek.table(rows);
    },
    /* The DOSSIER vocabulary (owner: the bare fact table read as
       unfinished) - the same stats strip and labeled blocks the supplier
       and customer dossiers wear, so a small pane is a small dossier,
       never a form dump. */
    stats: function (items) {
        var cells = (items || []).filter(function (i) { return i && i.v != null && i.v !== ''; })
            .map(function (i) {
                return '<div class="s-stat"><div class="s-stat-value">' + i.v + '</div>'
                    + '<div class="s-stat-label">' + i.l + '</div></div>';
            }).join('');
        return cells ? '<div class="s-doc-stats">' + cells + '</div>' : '';
    },
    grid: function (blocks) {
        var cells = (blocks || []).map(function (b) {
            var lines = ((b && b.lines) || []).filter(Boolean);
            if (!lines.length) { return ''; }
            return '<div class="q-block"><div class="q-label">' + b.label + '</div>' + lines.join('') + '</div>';
        }).join('');
        return cells ? '<div class="s-doc-grid">' + cells + '</div>' : '';
    },
    link: function (label, onclick, attrs) {
        return '<div style="margin-top:16px; font-size:13px;">'
            + '<a href="javascript:void(0)"' + (attrs ? ' ' + attrs : '') + ' onclick="' + onclick + '">' + label + ' &rarr;</a></div>';
    }
};

/*
 * List export, scoped (owner: "export button seems export everything...
 * confirm with duration or selection... still user should have option to
 * choose all"): every export button offers THIS PAGE or EVERYTHING
 * MATCHING THE FILTER. "Everything" walks the list's own endpoint page by
 * page with the filters that are on screen, capped so one click can never
 * ask the server for an unbounded catalogue.
 */
PosnicPro.listExport = {
    CAP: 5000,
    save: function (rows, filename) {
        var csv = rows.map(function (r) {
            return r.map(function (c) { return '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"'; }).join(',');
        }).join('\n');
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
    },
    all: function (cfg) {
        var rows = [cfg.head];
        var page = 1;
        var LIMIT = 100;
        var step = function () {
            PosnicPro.get({ url: cfg.url, data: cfg.params(page, LIMIT) }, function (r) {
                var data = (r && r.data) || {};
                var list = data.list || [];
                list.forEach(function (x) { rows.push(cfg.map(x)); });
                var total = Number(data.total) || (rows.length - 1);
                var have = rows.length - 1;
                if (list.length === LIMIT && have < Math.min(total, PosnicPro.listExport.CAP)) {
                    page += 1;
                    step();
                    return;
                }
                if (total > PosnicPro.listExport.CAP) {
                    PosnicPro.alert('warning', 'Exported the first ' + PosnicPro.listExport.CAP
                        + ' of ' + total + ' rows - narrow the filter for the rest');
                }
                PosnicPro.listExport.save(rows, cfg.filename);
            }, function () {
                PosnicPro.alert('error', PosnicPro.i18n.t('lang_export_failed_part_way_nothing_was_downloa', 'Export failed part-way - nothing was downloaded'));
            });
        };
        step();
    }
};

/*
 * The Sort control (owner: "high margin / low margin, recent, low stock,
 * cost, price... similarly high total sales... quotes"): a labelled
 * dropdown in the page header, one shared builder so every list gets the
 * same control. The chosen sort is SERVER-side - a whitelisted name, never
 * a raw field - so page 2 keeps the same order as page 1.
 */
PosnicPro.listSort = {
    _reg: {},
    mount: function (key, cfg) {
        PosnicPro.listSort._reg[key] = PosnicPro.listSort._reg[key] || { _v: '' };
        var reg = PosnicPro.listSort._reg[key];
        reg.options = cfg.options;
        reg.onChange = cfg.onChange;
        var host = $('#' + key + '_sort_host');
        if (!host.length || host.children().length) { return; }
        var items = cfg.options.map(function (o) {
            /* o.i = a feather icon name; the arrows say which END of the list
               the option puts on top (owner: "sort we can have down arrow and
               up arrow or any other icons inside options"). */
            var icon = o.i ? '<i class="feather icon-' + o.i + ' mr-2 q-muted"></i>' : '';
            return '<a class="dropdown-item ls-sort-opt" href="javascript:void(0)" data-key="' + key + '" data-sort="' + o.v + '">' + icon + o.l + '</a>';
        }).join('');
        host.html('<div class="btn-group">'
            + '<button type="button" class="btn btn-primary-rgba dropdown-toggle" data-toggle="dropdown"'
            + ' aria-haspopup="true" aria-expanded="false" id="' + key + '_sort_btn" title="Sort the list" data-t-title="lang_sort_the_list">'
            + '<i class="feather icon-bar-chart mr-2"></i><span id="' + key + '_sort_label"><lang class="lang_sort">Sort</lang></span></button>'
            + '<div class="dropdown-menu dropdown-menu-right">'
            + '<a class="dropdown-item ls-sort-opt" href="javascript:void(0)" data-key="' + key + '" data-sort=""><lang class="lang_default">Default</lang></a>'
            + items + '</div></div>');
    },
    value: function (key) {
        var reg = PosnicPro.listSort._reg[key];
        return (reg && reg._v) || '';
    }
};
$(document).on('click', '.ls-sort-opt', function () {
    var key = $(this).data('key');
    var reg = PosnicPro.listSort._reg[key];
    if (!reg) { return; }
    reg._v = String($(this).data('sort') || '');
    $('#' + key + '_sort_label').text(reg._v ? $(this).text() : PosnicPro.i18n.t('lang_sort', 'Sort'));
    if (typeof reg.onChange === 'function') { reg.onChange(reg._v); }
});

/* Tax Payable (#/taxpayable, PURCHASE_TAX_PLAN P4) - months of output vs
 * input tax and the net owed, credits in the statutory order (server math,
 * tested in tax-netting). Regime-aware: single-head shops see one column
 * set. The route table dispatches {module} -> PosnicPro.taxpayable. */
PosnicPro.taxpayable = {
    _months: null,
    _register: null,
    _threeHead: true,
    _label: 'Tax',
    display: function () {
        PosnicPro.HideSideBarModal();
        $(".vertical-layout").removeClass("toggle-menu");
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $(".vertical-menu li a").removeClass("active");
        $('.page_loader,#osk-container').hide();
        $('.page-title-box,#taxpayable_new').show();
        $('#v-pills-report-tab').addClass('active');
        $('#v-pills-report').addClass('show active');
        PosnicPro.injectReportGroupTabs();
        var to = new Date();
        var from = new Date(to.getFullYear(), to.getMonth() - 2, 1);
        var iso = function (d) { return d.toISOString().slice(0, 10); };
        if (!$('#taxpayable_from').val()) { $('#taxpayable_from').val(iso(from)); }
        if (!$('#taxpayable_to').val()) { $('#taxpayable_to').val(iso(to)); }
        PosnicPro.get({ url: 'setting/taxProfile', data: {} }, function (r) {
            var d = (r && r.data) || {};
            PosnicPro.taxpayable._threeHead = (d.components && d.components.mode === 'split_equal');
            PosnicPro.taxpayable._label = d.label || 'Tax';
            var family = d.regime === 'sales_tax' ? 'sales tax collected'
                : d.regime === 'none' ? 'no consumption tax configured'
                : 'output minus input credit';
            $('#taxpayable_regime_note').text((d.label || 'Tax') + ' \u2014 ' + family);
            PosnicPro.taxpayable.run();
        }, function () { PosnicPro.taxpayable.run(); });
    },
    run: function () {
        var q = 'starting_date=' + $('#taxpayable_from').val() + '&ending_date=' + $('#taxpayable_to').val() + ' 23:59:59';
        PosnicPro.get({ url: 'sales/taxPayable?' + q, data: {} }, function (r) {
            PosnicPro.taxpayable._months = (r.data && r.data.months) || [];
            PosnicPro.taxpayable.renderMonths();
        }, function () { $('#taxpayable_months_body').html('<tr><td class="text-danger"><lang class="lang_could_not_load_try_again">Could not load - try again.</lang></td></tr>'); });
        PosnicPro.get({ url: 'sales/taxPayableRegister?' + q, data: {} }, function (r) {
            PosnicPro.taxpayable._register = (r.data && r.data.list) || [];
            PosnicPro.taxpayable.renderRegister();
        }, function () { /* register is secondary */ });
    },
    renderMonths: function () {
        var three = PosnicPro.taxpayable._threeHead;
        var L = PosnicPro.taxpayable._label;
        var n = function (v) { return (Number(v) || 0).toFixed(2); };
        var head = three
            ? '<tr><th rowspan="2"><lang class="lang_month">Month</lang></th><th colspan="4" class="text-center">Output (' + L + ' collected)</th>'
              + '<th colspan="4" class="text-center"><lang class="lang_input_credit_purchases">Input credit (purchases)</lang></th>'
              + '<th colspan="4" class="text-center"><lang class="lang_net_payable">Net payable</lang></th><th rowspan="2" class="text-right"><lang class="lang_credit_carried">Credit carried</lang></th></tr>'
              + '<tr><th class="text-right"><lang class="lang_igst_tax_receiving">IGST</lang></th><th class="text-right"><lang class="lang_cgst_tax_receiving">CGST</lang></th><th class="text-right"><lang class="lang_sgst_tax_receiving">SGST</lang></th><th class="text-right"><lang class="lang_total_title">Total</lang></th>'
              + '<th class="text-right"><lang class="lang_igst_tax_receiving">IGST</lang></th><th class="text-right"><lang class="lang_cgst_tax_receiving">CGST</lang></th><th class="text-right"><lang class="lang_sgst_tax_receiving">SGST</lang></th><th class="text-right"><lang class="lang_total_title">Total</lang></th>'
              + '<th class="text-right"><lang class="lang_igst_tax_receiving">IGST</lang></th><th class="text-right"><lang class="lang_cgst_tax_receiving">CGST</lang></th><th class="text-right"><lang class="lang_sgst_tax_receiving">SGST</lang></th><th class="text-right"><lang class="lang_total_title">Total</lang></th></tr>'
            : '<tr><th><lang class="lang_month">Month</lang></th><th class="text-right">' + L + ' collected</th><th class="text-right"><lang class="lang_input_credit">Input credit</lang></th><th class="text-right"><lang class="lang_net_payable">Net payable</lang></th><th class="text-right"><lang class="lang_credit_carried">Credit carried</lang></th></tr>';
        $('#taxpayable_months_head').html(head);
        var rows = PosnicPro.taxpayable._months || [];
        if (!rows.length) {
            $('#taxpayable_months_body').html('<tr><td class="text-muted" colspan="14"><lang class="lang_nothing_in_this_period">Nothing in this period.</lang></td></tr>');
            return;
        }
        var html = '';
        rows.forEach(function (m) {
            html += three
                ? '<tr><td>' + m.period + '</td>'
                  + '<td class="text-right">' + n(m.output.igst) + '</td><td class="text-right">' + n(m.output.cgst) + '</td><td class="text-right">' + n(m.output.sgst) + '</td><td class="text-right"><b>' + n(m.output.total) + '</b></td>'
                  + '<td class="text-right">' + n(m.input.igst) + '</td><td class="text-right">' + n(m.input.cgst) + '</td><td class="text-right">' + n(m.input.sgst) + '</td><td class="text-right"><b>' + n(m.input.total) + '</b></td>'
                  + '<td class="text-right">' + n(m.net.igst) + '</td><td class="text-right">' + n(m.net.cgst) + '</td><td class="text-right">' + n(m.net.sgst) + '</td><td class="text-right"><b>' + n(m.net.total) + '</b></td>'
                  + '<td class="text-right">' + n(m.credit_carried) + '</td></tr>'
                : '<tr><td>' + m.period + '</td>'
                  + '<td class="text-right">' + n(m.output.total) + '</td>'
                  + '<td class="text-right">' + n(m.input.total) + '</td>'
                  + '<td class="text-right"><b>' + n(m.net.total) + '</b></td>'
                  + '<td class="text-right">' + n(m.credit_carried) + '</td></tr>';
        });
        $('#taxpayable_months_body').html(html);
    },
    renderRegister: function () {
        var three = PosnicPro.taxpayable._threeHead;
        var n = function (v) { return (Number(v) || 0).toFixed(2); };
        var esc = function (t) { return $('<i/>').text(t == null ? '' : t).html(); };
        $('#taxpayable_register_head').html('<tr><th><lang class="lang_newpurchase_title">Purchase</lang></th><th><lang class="lang_date_title">Date</lang></th><th><lang class="lang_newsupplier_title">Supplier</lang></th><th><lang class="lang_tax_id">Tax ID</lang></th>'
            + (three ? '<th class="text-right"><lang class="lang_igst_tax_receiving">IGST</lang></th><th class="text-right"><lang class="lang_cgst_tax_receiving">CGST</lang></th><th class="text-right"><lang class="lang_sgst_tax_receiving">SGST</lang></th>' : '<th class="text-right"><lang class="lang_tax_paid">Tax paid</lang></th>')
            + '<th class="text-right"><lang class="lang_total_title">Total</lang></th><th class="text-center"><lang class="lang_credit_title">Credit</lang></th><th class="text-center"><lang class="lang_doc">Doc</lang></th></tr>');
        var rows = PosnicPro.taxpayable._register || [];
        if (!rows.length) {
            $('#taxpayable_register_body').html('<tr><td class="text-muted" colspan="10"><lang class="lang_no_purchases_in_this_period">No purchases in this period.</lang></td></tr>');
            return;
        }
        var html = '';
        rows.forEach(function (r) {
            var warn = r.invoice_total_mismatch ? ' <i class="feather icon-alert-triangle text-warning" title="Declared invoice total does not match the lines" data-t-title="lang_declared_invoice_total_does_not_match_the"></i>' : '';
            html += '<tr><td>' + esc(r.receiving_id) + warn + '</td>'
                + '<td>' + (r.date ? new Date(r.date).toLocaleDateString('en-IN') : '-') + '</td>'
                + '<td>' + esc(r.supplier_name) + '</td>'
                + '<td>' + esc(r.supplier_gst_number || '-') + '</td>'
                + (three
                    ? '<td class="text-right">' + n(r.igst) + '</td><td class="text-right">' + n(r.cgst) + '</td><td class="text-right">' + n(r.sgst) + '</td>'
                    : '<td class="text-right">' + n((Number(r.igst) || 0) + (Number(r.cgst) || 0) + (Number(r.sgst) || 0)) + '</td>')
                + '<td class="text-right">' + n(r.total_amount) + '</td>'
                + '<td class="text-center">' + (r.itc_eligible === false ? '<span class="rs-pill unpaid"><lang class="lang_no">No</lang></span>' : '<span class="rs-pill paid"><lang class="lang_yes">Yes</lang></span>') + '</td>'
                + '<td class="text-center">' + (r.has_document ? '<i class="feather icon-paperclip"></i>' : '-') + '</td>'
                + '</tr>';
        });
        $('#taxpayable_register_body').html(html);
    },
    exportCsv: function () {
        var rows = [['Period', 'Output IGST', 'Output CGST', 'Output SGST', 'Output Total',
            'Input IGST', 'Input CGST', 'Input SGST', 'Input Total',
            'Net IGST', 'Net CGST', 'Net SGST', 'Net Total', 'Credit carried']];
        (PosnicPro.taxpayable._months || []).forEach(function (m) {
            rows.push([m.period, m.output.igst, m.output.cgst, m.output.sgst, m.output.total,
                m.input.igst, m.input.cgst, m.input.sgst, m.input.total,
                m.net.igst, m.net.cgst, m.net.sgst, m.net.total, m.credit_carried]);
        });
        rows.push([]);
        rows.push(['Purchase', 'Date', 'Supplier', 'Tax ID', 'IGST', 'CGST', 'SGST', 'Total', 'Credit claimable', 'Mismatch', 'Document']);
        (PosnicPro.taxpayable._register || []).forEach(function (r) {
            rows.push([r.receiving_id, r.date ? new Date(r.date).toISOString().slice(0, 10) : '',
                r.supplier_name, r.supplier_gst_number || '', r.igst, r.cgst, r.sgst,
                r.total_amount, r.itc_eligible === false ? 'no' : 'yes',
                r.invoice_total_mismatch ? 'yes' : '', r.has_document ? 'yes' : '']);
        });
        var csv = rows.map(function (r) {
            return r.map(function (c) { return '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"'; }).join(',');
        }).join('\n');
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'tax-payable.csv';
        a.click();
        URL.revokeObjectURL(a.href);
    }
};

/* Tax summary report (#/taxsummaryreport, T3) - totals per rate class over
 * a period, straight off the generic endpoint. The route table dispatches
 * {module} -> PosnicPro.taxsummaryreport. */
PosnicPro.taxsummaryreport = {
    _last: null,
    showDataTablePage: function () {
        PosnicPro.HideSideBarModal();
        $(".vertical-layout").removeClass("toggle-menu");
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $(".vertical-menu li a").removeClass("active");
        $('.page_loader,#osk-container').hide();
        $('.page-title-box,#taxsummaryreport_new').show();
        $('#v-pills-report-tab').addClass('active');
        $('#v-pills-report').addClass('show active');
        var to = new Date();
        var from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
        var fmt = PosnicPro.shiftWidget._fmtDate;
        $('#taxsummary_from').val(fmt(from));
        $('#taxsummary_to').val(fmt(to));
        PosnicPro.taxsummaryreport.run();
    },
    run: function () {
        var from = $('#taxsummary_from').val();
        var to = $('#taxsummary_to').val();
        $('#taxsummary_body').html('<tr><td colspan="6" class="text-center text-muted"><lang class="lang_loading">Loading&hellip;</lang></td></tr>');
        $('#taxsummary_foot').html('');
        var url = 'sales/taxSummaryReportTable?starting_date=' + encodeURIComponent(from)
            + '&ending_date=' + encodeURIComponent(to);
        PosnicPro.get(url, function (response) {
            var d = response && response.data;
            PosnicPro.taxsummaryreport._last = d;
            var rows = (d && d.list) || [];
            var cur = PosnicPro.local.get('currencySign') || '';
            /* The GST position renders even for a range with no sales - a
               period of pure purchasing still builds credit. */
            PosnicPro.taxsummaryreport.renderGst(d, cur);
            if (!rows.length) {
                $('#taxsummary_body').html('<tr><td colspan="6" class="text-center text-muted"><lang class="lang_no_sales_in_this_range">No sales in this range.</lang></td></tr>');
                return;
            }
            var esc = function (s) {
                return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
                    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
                });
            };
            var html = '';
            rows.forEach(function (r) {
                html += '<tr>'
                    + '<td>' + (r.rate ? r.rate + '%' : '<span class="text-muted">0% / untaxed</span>') + '</td>'
                    + '<td>' + (esc(r.tax_name) || '&mdash;') + '</td>'
                    + '<td class="text-right">' + cur + '&nbsp;' + r.net.toFixed(2) + '</td>'
                    + '<td class="text-right">' + cur + '&nbsp;' + r.tax.toFixed(2) + '</td>'
                    + '<td class="text-right">' + cur + '&nbsp;' + r.gross.toFixed(2) + '</td>'
                    + '<td class="text-right">' + r.lines + '</td>'
                    + '</tr>';
            });
            $('#taxsummary_body').html(html);
            var t = d.totals || {};
            $('#taxsummary_foot').html('<tr class="font-weight-bold">'
                + '<td colspan="2"><lang class="lang_total_title">Total</lang></td>'
                + '<td class="text-right">' + cur + '&nbsp;' + (t.net || 0).toFixed(2) + '</td>'
                + '<td class="text-right">' + cur + '&nbsp;' + (t.tax || 0).toFixed(2) + '</td>'
                + '<td class="text-right">' + cur + '&nbsp;' + (t.gross || 0).toFixed(2) + '</td>'
                + '<td></td></tr>');
        }, function () {
            $('#taxsummary_body').html('<tr><td colspan="6" class="text-center text-danger"><lang class="lang_could_not_load_the_summary">Could not load the summary.</lang></td></tr>');
        });
    },
    /*
     * The GST position (owner: "we need to know how we already paid tax
     * while purchase... exactly how much need to pay"). Output minus input
     * credit, the way GSTR-3B owes it; a credit surplus carries forward
     * rather than going negative.
     */
    renderGst: function (d, cur) {
        var gst = d && d.gst;
        var p = (d && d.purchases) || { list: [], totals: {} };
        if (!gst) { $('#taxsummary_gst_card').hide(); return; }
        var money = function (v) { return cur + '&nbsp;' + (Number(v) || 0).toFixed(2); };
        var cell = function (label, value, tone) {
            return '<div class="col-md-3 col-6 mb-2">'
                + '<div style="font-size:12px;color:#69758c;">' + label + '</div>'
                + '<div style="font-size:18px;font-weight:700;' + (tone ? 'color:' + tone + ';' : '') + '">' + money(value) + '</div>'
                + '</div>';
        };
        $('#taxsummary_gst').html(
            cell('Output tax (sales)', gst.output_tax)
            + cell('Input tax credit (purchases)', gst.input_tax_credit)
            + cell('Net payable', gst.net_payable, '#d33a2c')
            + (Number(gst.credit_carry_forward) > 0
                ? cell('Credit carried forward', gst.credit_carry_forward, '#1a7f37')
                : '')
        );
        var rows = p.list || [];
        if (!rows.length) {
            $('#taxsummary_purchase_body').html('<tr><td colspan="5" class="text-center text-muted"><lang class="lang_no_purchases_in_this_range">No purchases in this range.</lang></td></tr>');
            $('#taxsummary_purchase_foot').html('');
        } else {
            var html = '';
            rows.forEach(function (r) {
                html += '<tr>'
                    + '<td>' + (r.rate ? r.rate + '%' : '<span class="text-muted">0% / untaxed</span>') + '</td>'
                    + '<td class="text-right">' + money(r.net) + '</td>'
                    + '<td class="text-right">' + money(r.tax) + '</td>'
                    + '<td class="text-right">' + money(r.gross) + '</td>'
                    + '<td class="text-right">' + (r.lines || 0) + '</td>'
                    + '</tr>';
            });
            $('#taxsummary_purchase_body').html(html);
            var t = p.totals || {};
            $('#taxsummary_purchase_foot').html('<tr class="font-weight-bold">'
                + '<td><lang class="lang_total_title">Total</lang></td>'
                + '<td class="text-right">' + money(t.net) + '</td>'
                + '<td class="text-right">' + money(t.tax) + '</td>'
                + '<td class="text-right">' + money(t.gross) + '</td>'
                + '<td></td></tr>');
        }
        $('#taxsummary_gst_card').show();
    },
    exportCsv: function () {
        var d = PosnicPro.taxsummaryreport._last;
        var rows = (d && d.list) || [];
        if (!rows.length) {
            PosnicPro.alert('warning', PosnicPro.i18n.t('lang_run_the_report_first_there_is_nothing_to_e', 'Run the report first - there is nothing to export.'));
            return;
        }
        var out = rows.map(function (r) {
            return { rate: r.rate, tax_name: r.tax_name, net: r.net, tax: r.tax, gross: r.gross, lines: r.lines };
        });
        PosnicPro.JSONToCSVConvertor(out, 'tax-summary_' + $('#taxsummary_from').val() + '_' + $('#taxsummary_to').val(), true);
    }
};

/* Roster week view (#/roster) - the page a staff member opens from the clock
 * button to see who works when. Read-only: planning lives under
 * Manage > Workforce. The route table dispatches {module} -> PosnicPro.roster. */
PosnicPro.roster = {
    _monday: null,
    showDataTablePage: function () {
        if (!PosnicPro.shiftWidget.enabled()
            || !PosnicPro.shiftWidget._setting('staff_roster_enable', true)) {
            hasher.setHash('dashboard');
            return;
        }
        PosnicPro.HideSideBarModal();
        $(".vertical-layout").removeClass("toggle-menu");
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $(".vertical-menu li a").removeClass("active");
        $('.page_loader,#osk-container').hide();
        $('.page-title-box,#roster_new').show();
        PosnicPro.roster.thisWeek();
    },
    thisWeek: function () {
        var now = new Date();
        PosnicPro.roster._monday = new Date(now.getTime() - ((now.getDay() + 6) % 7) * 86400000);
        PosnicPro.roster.load();
    },
    shiftWeek: function (delta) {
        var m = PosnicPro.roster._monday || new Date();
        PosnicPro.roster._monday = new Date(m.getTime() + delta * 7 * 86400000);
        PosnicPro.roster.load();
    },
    load: function () {
        var fmt = PosnicPro.shiftWidget._fmtDate;
        var monday = PosnicPro.roster._monday;
        var sunday = new Date(monday.getTime() + 6 * 86400000);
        var label = function (d) {
            return d.getDate() + ' ' + d.toLocaleString(undefined, { month: 'short' });
        };
        $('#roster_week_label').text(label(monday) + ' – ' + label(sunday));
        $('#roster_view_body').html('<div class="text-center text-muted p-4"><lang class="lang_loading">Loading&hellip;</lang></div>');
        var url = 'shifts/schedule?from=' + encodeURIComponent(fmt(monday)) + '&to=' + encodeURIComponent(fmt(sunday));
        PosnicPro.get(url, function (res) {
            PosnicPro.roster._render((res && res.data) || []);
        }, function () {
            $('#roster_view_body').html('<div class="text-center text-danger p-4"><lang class="lang_could_not_load_the_roster">Could not load the roster.</lang></div>');
        });
    },
    _render: function (entries) {
        var esc = function (s) {
            return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
                return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
            });
        };
        var fmt = PosnicPro.shiftWidget._fmtDate;
        var monday = PosnicPro.roster._monday;
        var today = fmt(new Date());
        var byDate = {};
        entries.forEach(function (e) {
            (byDate[e.date] = byDate[e.date] || []).push(e);
        });
        var html = '';
        for (var i = 0; i < 7; i++) {
            var d = new Date(monday.getTime() + i * 86400000);
            var key = fmt(d);
            var day = byDate[key] || [];
            var isToday = key === today;
            html += '<div class="mb-3' + (isToday ? ' p-2 rounded" style="background:rgba(0,123,255,.06);' : '"') + '">'
                + '<h6 class="mb-1">' + d.toLocaleString(undefined, { weekday: 'long' })
                + ' <small class="text-muted">' + d.getDate() + ' ' + d.toLocaleString(undefined, { month: 'short' }) + '</small>'
                + (isToday ? ' <span class="badge badge-primary"><lang class="lang_this_day">Today</lang></span>' : '') + '</h6>';
            if (!day.length) {
                html += '<small class="text-muted"><lang class="lang_no_one_planned">No one planned.</lang></small>';
            } else {
                day.sort(function (a, b) { return String(a.start).localeCompare(String(b.start)); });
                day.forEach(function (e) {
                    html += '<div class="d-flex align-items-center" style="gap:8px; padding:2px 0;">'
                        + '<span style="min-width:110px;">' + esc(e.start) + ' – ' + esc(e.end) + '</span>'
                        + '<span>' + esc(e.user_name || '—') + '</span>'
                        + '</div>';
                });
            }
            html += '</div>';
        }
        $('#roster_view_body').html(html);
    }
};

/* Workforce pane under Manage (#/settings/workforce) - the module's
 * management roof: an on-shift-now board on General, roster PLANNING on
 * Roster (the old modal's markup lives in the pane now, ids unchanged, so
 * shiftWidget.runRoster/addRosterEntry/deleteRosterEntry work as before). */
PosnicPro.workforce = {
    load: function () {
        // Roster planning follows its sub-switch; the pane itself follows
        // the module (the Manage entry is gated the same way).
        $('#wf_roster_subtab').toggle(PosnicPro.shiftWidget._setting('staff_roster_enable', true));
        PosnicPro.workforce.loadOnShift();
    },
    loadOnShift: function () {
        var today = PosnicPro.shiftWidget._fmtDate(new Date());
        $('#wf_onshift_body').html('<tr><td colspan="2" class="text-center text-muted"><lang class="lang_loading">Loading&hellip;</lang></td></tr>');
        PosnicPro.get('shifts/report?from=' + today + '&to=' + today, function (response) {
            var rows = ((response && response.data && response.data.rows) || [])
                .filter(function (r) { return r.open_shifts; });
            if (!rows.length) {
                $('#wf_onshift_body').html('<tr><td colspan="2" class="text-center text-muted"><lang class="lang_no_one_is_clocked_in_right_now">No one is clocked in right now.</lang></td></tr>');
                return;
            }
            var esc = function (s) {
                return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
                    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
                });
            };
            var html = '';
            rows.forEach(function (r) {
                html += '<tr><td>' + esc(r.user_name || '—')
                    + ' <span class="badge badge-success">on shift</span></td>'
                    + '<td class="text-right">' + (Number(r.worked_hours) || 0).toFixed(2) + '</td></tr>';
            });
            $('#wf_onshift_body').html(html);
        }, function () {
            $('#wf_onshift_body').html('<tr><td colspan="2" class="text-center text-danger"><lang class="lang_could_not_load_shifts">Could not load shifts.</lang></td></tr>');
        });
    },
    openRosterTab: function () {
        var now = new Date();
        var monday = new Date(now.getTime() - ((now.getDay() + 6) % 7) * 86400000);
        var sunday = new Date(monday.getTime() + 6 * 86400000);
        $('#roster_from').val(PosnicPro.shiftWidget._fmtDate(monday));
        $('#roster_to').val(PosnicPro.shiftWidget._fmtDate(sunday));
        $('#roster_date').val(PosnicPro.shiftWidget._fmtDate(now));
        PosnicPro.shiftWidget._loadRosterUsers();
        PosnicPro.shiftWidget.runRoster();
    }
};

// Report group navigator rides every route change. Injected IMMEDIATELY
// after the route lands so the strip is part of the page's single entry
// motion - a late strip shoved the layout and read as a second splash.
// One short retry covers show functions that finish a beat later.
$(function () {
    if (window.hasher && hasher.changed) {
        var paint = function () {
            setTimeout(function () {
                PosnicPro.injectReportGroupTabs();
                if (!$('.report-group-tabs').length) {
                    setTimeout(PosnicPro.injectReportGroupTabs, 150);
                }
            }, 0);
        };
        hasher.changed.add(paint);
        hasher.initialized.add(paint);
        paint();
    }
});
