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
    /* #/customers/<id>: the dossier opens in the right pane - never a
       popup. (The customer REPORT page keeps its own viewCustomer sidebar;
       only this page's route changed.) */
    showDetails: function (id) {
        var self = PosnicPro.customers;
        if (self._openDocId === String(id) && $('#customers_detail_card').is(':visible')) { return; }
        self._chrome();
        self.loadList(1);
        self.openDoc(id);
    },

    _page: 1,
    PAGE_SIZE: 25,
    _lastRows: [],
    _openDocId: null,
    _chrome: function () {
        PosnicPro.HideSideBarModal();
        $('.page_loader,#osk-container').hide();
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $('.vertical-menu li a').removeClass('active');
        $('#v-pills-customer-tab').addClass('active');
        $('#v-pills-customer').addClass('show active');
        $('.vertical-menu li a#view_customers_page').addClass('active');
        $('.page-title-box,#customers').show();
        $('#customers_new,#customers_view').modal('hide');
        $('.dashboard_img_menu').hide();
        $('#image_sidebar_customsdetails').show();
    },
    showDataTablePage: function () {
        PosnicPro.customers._chrome();
        PosnicPro.customers.closeDoc();
        PosnicPro.customers.loadList(1);
    },
    mountFilters: function (force) {
        if (!$('#customers_filter_panel').length) { return; }
        if (!force && $('#customers_filter_panel').data('mounted')) { return; }
        $('#customers_filter_panel').data('mounted', true);
        PosnicPro.listFilter.mount({
            key: 'customers',
            container: '#customers_filter_panel',
            button: '#customers_filter_btn',
            searchPlaceholder: 'Search name, phone or email',
            dateField: 'Added',
            searchFields: [
                { value: 'all', label: 'All fields' },
                { value: 'name', label: 'Name' },
                { value: 'phone', label: 'Phone' },
                { value: 'email', label: 'Email' },
                { value: 'address', label: 'Address' }
            ],
            onChange: function () { PosnicPro.customers.loadList(1); }
        });
    },
    /* The name the OLD table machinery answered to - the save flow still
       calls it after adding a customer, and the shared clearListFilters/
       refresh doors resolve <module>Table by convention. */
    customersTable: function () {
        PosnicPro.customers.loadList(1);
    },
    loadList: function (page) {
        PosnicPro.customers.mountFilters();
        var self = PosnicPro.customers;
        if (page) { self._page = page; }
        var filters = PosnicPro.listFilter.legacyFilters('customers', { dateKey: 'created_date' });
        var esc = function (t) { return $('<span>').text(t == null ? '' : t).html(); };
        PosnicPro.get({
            url: 'customers',
            data: { page: self._page, limit: self.PAGE_SIZE, filters: JSON.stringify(filters) }
        }, function (response) {
            var data = (response && response.data) || {};
            var list = data.list || [];
            self._lastRows = list;
            if (!list.length) {
                var filtered = PosnicPro.listFilter.activeCount('customers') > 0;
                $('#customers_list_rows').html('<div class="text-center text-muted p-t-20 p-b-20">'
                    + (filtered ? 'No customers match this filter.' : 'No customers yet - press New to add the first.') + '</div>');
                $('#customers_list_paging').html('');
                return;
            }
            var html = '<div class="table-responsive"><table class="table table-borderless">'
                + '<thead><tr><th>Name</th><th class="c-col-phone">Phone</th>'
                + '<th class="c-col-email">Email</th><th class="c-col-address">Address</th><th class="text-center">Dues</th></tr></thead><tbody>';
            list.forEach(function (r) {
                var due = Number(r.partial_balance) > 0
                    ? '<span class="rs-pill unpaid">Due</span>'
                    : '<span class="q-muted">-</span>';
                html += '<tr class="md-row customers-row highlight-select' + (self._openDocId === String(r._id) ? ' is-active' : '') + '"'
                    + ' data-id="' + esc(r._id) + '" style="cursor:pointer;">'
                    + '<td>' + esc(r.name) + '</td>'
                    + '<td class="c-col-phone">' + esc(r.phone || '-') + '</td>'
                    + '<td class="c-col-email">' + esc(r.email || '-') + '</td>'
                    + '<td class="c-col-address">' + esc(r.address || '-') + '</td>'
                    + '<td class="text-center">' + due + '</td>'
                    + '</tr>';
            });
            html += '</tbody></table></div>';
            $('#customers_list_rows').html(html);
            self.renderPager(Number(data.total) || list.length);
        }, function () {
            $('#customers_list_rows').html('<div class="text-center text-muted p-t-20 p-b-20">Could not load customers - try again.</div>');
        });
    },
    renderPager: function (total) {
        var self = PosnicPro.customers;
        var p = self._page, size = self.PAGE_SIZE;
        var pages = Math.ceil(total / size) || 1;
        var label = total + (total === 1 ? ' customer' : ' customers');
        if (pages > 1) { label = 'Page ' + p + ' of ' + pages + ' \u00b7 ' + label; }
        var btn = function (to, text, off, cls) {
            return '<button type="button" class="btn btn-sm ' + (cls || 'btn-secondary-rgba') + ' q-pg-btn"' + (off ? ' disabled' : '')
                + ' onclick="PosnicPro.customers.goPage(' + to + ');">' + text + '</button>';
        };
        var html = '';
        if (pages > 1) {
            html += btn(p - 1, '&laquo;', p <= 1);
            var end = Math.min(pages, Math.max(1, p - 2) + 4);
            var start = Math.max(1, end - 4);
            for (var n = start; n <= end; n++) {
                html += '<span class="q-pg-num">' + btn(n, n, false, n === p ? 'btn-primary-rgba' : 'btn-secondary-rgba') + '</span>';
            }
        }
        html += '<span class="q-pg-count">' + label + '</span>';
        if (pages > 1) { html += btn(p + 1, '&raquo;', p >= pages); }
        $('#customers_list_paging').html(html);
    },
    goPage: function (n) {
        if (!n || n < 1) { return; }
        PosnicPro.customers._page = n;
        PosnicPro.customers.loadList();
    },
    _csvSpec: function () {
        return {
            head: ['Name', 'Phone', 'Email', 'Address', 'Tax number'],
            map: function (r) {
                return [r.name, r.phone || '', r.email || '', r.address || '', r.gst_number || ''];
            }
        };
    },
    exportCsv: function () {
        var spec = PosnicPro.customers._csvSpec();
        PosnicPro.listExport.save(
            [spec.head].concat((PosnicPro.customers._lastRows || []).map(spec.map)), 'customers.csv');
    },
    /* Everything matching the CURRENT filter, paged through the same
       endpoint the list reads - never a shapeless full dump. */
    exportAllCsv: function () {
        var spec = PosnicPro.customers._csvSpec();
        PosnicPro.listExport.all({
            url: 'customers',
            params: function (page, limit) {
                return { page: page, limit: limit, filters: JSON.stringify(PosnicPro.listFilter.legacyFilters('customers', { dateKey: 'created_date' })) };
            },
            head: spec.head,
            map: spec.map,
            filename: 'customers.csv'
        });
    },
    /* ---- the dossier pane ---- */
    openDoc: function (id) {
        var self = PosnicPro.customers;
        if (!PosnicPro.masterDetail.inSplit('#customers_split', 'customers-split')) {
            PosnicPro.masterDetail.enter('#customers_split', 'customers-split');
            $('#customers_detail_card').show();
        }
        self._openDocId = String(id);
        $('#customers_list_rows tr.customers-row').removeClass('is-active');
        $('#customers_list_rows tr.customers-row[data-id="' + id + '"]').addClass('is-active');
        if (window.location.hash.slice(2) !== 'customers/' + id) {
            hasher.setHash('customers/' + id);
        }
        $('#customers_doc').html('<div class="text-center text-muted" style="padding:60px;">Loading ...</div>');
        PosnicPro.get('customers/' + id, function (response) {
            if (response.type !== 'success') {
                $('#customers_doc').html('<div class="text-danger p-4">Could not open this customer.</div>');
                return;
            }
            PosnicPro.customers.renderCustomerDoc(response.data);
            PosnicPro.ACLForModule('customer');
        }, function () {
            $('#customers_doc').html('<div class="text-danger p-4">Could not open this customer.</div>');
        });
    },
    closeDoc: function () {
        PosnicPro.customers._openDocId = null;
        $('#customers_detail_card').hide();
        $('#customers_list_rows tr.customers-row').removeClass('is-active');
        PosnicPro.masterDetail.leave('#customers_split', 'customers-split');
        if (window.location.hash.slice(2).indexOf('customers/') === 0) {
            hasher.setHash('customers');
        }
    },
    renderCustomerDoc: function (d) {
        var esc = function (t) { return $('<span>').text(t == null ? '' : t).html(); };
        var real = function (v) { return v && v !== 'null' && v !== 'undefined' ? v : ''; };
        var taxLabel = PosnicPro.local.get('gst_action') === 'enable' ? 'GSTIN' : 'Tax ID';
        var id = String(d._id || PosnicPro.customers._openDocId);
        var toolbar = '<div class="p-doc-toolbar">'
            + '<button type="button" class="btn btn-sm btn-light" title="Show or hide the list" aria-label="Show or hide the list" onclick="PosnicPro.masterDetail.toggleRail(\'#customers_split\');"><i class="feather icon-sidebar"></i></button>'
            + '<span class="p-doc-title">' + esc(d.name) + '</span>'
            + (Number(d.partial_balance) > 0 ? '<span class="rs-pill unpaid">Dues ' + PosnicPro.local.get('currencySign') + '&nbsp;' + Number(d.partial_balance).toFixed(2) + '</span>' : '')
            + '<span class="ml-auto"></span>'
            + (Number(d.partial_balance) > 0
                ? '<button type="button" class="btn btn-sm btn-primary" data-module="customer" data-access="write" onclick="hasher.setHash(\'customers/' + esc(id) + '/transaction\');"><i class="feather icon-credit-card mr-1"></i>Settle dues</button>'
                : '')
            + '<button type="button" class="btn btn-sm btn-light" data-module="customer" data-access="write" onclick="hasher.setHash(\'customers/' + esc(id) + '/edit\');"><i class="feather icon-edit-2 mr-1"></i>Edit</button>'
            + '<div class="btn-group">'
            + '<button type="button" class="btn btn-sm btn-light dropdown-toggle" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">More</button>'
            + '<div class="dropdown-menu dropdown-menu-right">'
            + '<a class="dropdown-item text-danger" data-module="customer" data-access="delete" href="javascript:void(0)" onclick="PosnicPro.customers.deleteAsk();"><i class="feather icon-trash mr-2"></i>Delete</a>'
            + '</div></div>'
            + '<button type="button" class="btn btn-sm btn-light" title="Close and show the full list" aria-label="Close" onclick="PosnicPro.customers.closeDoc();"><i class="feather icon-x"></i></button>'
            + '</div>';
        var strip = '<div class="p-void-strip" id="c_delete_strip" style="display:none;">'
            + '<span>Delete <b>' + esc(d.name) + '</b>? Their sales stay on record; only the customer card goes.</span>'
            + '<button type="button" class="btn btn-sm btn-danger" onclick="PosnicPro.customers.deleteConfirm(\'' + esc(id) + '\');">Delete customer</button>'
            + '<button type="button" class="btn btn-sm btn-light" onclick="$(\'#c_delete_strip\').slideUp(120);">Cancel</button>'
            + '</div>';
        var contact = '<div class="q-block"><div class="q-label">Contact</div>'
            + (real(d.phone) ? '<div><a href="tel:' + esc(d.phone) + '">' + esc(d.phone) + '</a></div>' : '')
            + (real(d.email) ? '<div><a href="mailto:' + esc(d.email) + '">' + esc(d.email) + '</a></div>' : '')
            + (real(d.address) ? '<div class="q-muted">' + esc(d.address) + '</div>' : '')
            + (real(d.state) ? '<div class="q-muted">' + esc(d.state) + (real(d.country) ? ', ' + esc(d.country) : '') + '</div>' : '')
            + '</div>';
        var tax = (real(d.gst_type) || real(d.gst_number))
            ? '<div class="q-block"><div class="q-label">Tax</div>'
                + (real(d.gst_type) ? '<div>' + esc(d.gst_type) + '</div>' : '')
                + (real(d.gst_number) ? '<div class="q-muted">' + taxLabel + ': ' + esc(d.gst_number) + '</div>' : '')
                + '</div>'
            : '';
        var record = '<div class="q-block"><div class="q-label">On record</div>'
            + (d.created_date ? '<div class="q-muted">Added ' + esc(PosnicPro.convertDate(d.created_date)) + '</div>' : '')
            + (d.updated_date ? '<div class="q-muted">Updated ' + esc(PosnicPro.convertDate(d.updated_date)) + '</div>' : '')
            + '<div class="q-muted" id="c_doc_loyalty"></div>'
            + '</div>';
        var body = '<div class="s-doc-body"><div class="q-sheet s-sheet">'
            + '<div class="s-doc-stats" id="c_doc_stats"></div>'
            + '<div class="s-doc-grid">' + contact + tax + record + '</div>'
            + '<div class="q-label" style="margin-top:18px;">Recent sales</div>'
            + '<div id="c_doc_sales" class="text-muted" style="font-size:13px;">Loading ...</div>'
            + '</div></div>';
        $('#customers_doc').html(toolbar + strip + body);
        PosnicPro.customers.loadRecentSales(id, d);
        /* loyalty points, when the branch runs the programme */
        if (PosnicPro.loyalty && PosnicPro.loyalty.summary) {
            PosnicPro.loyalty.summary(id, function (sum) {
                if (sum && sum.enabled) {
                    $('#c_doc_loyalty').text('Loyalty: ' + (sum.points != null ? sum.points + ' points' : '')
                        + (sum.tier ? ' \u00b7 ' + sum.tier : ''));
                }
            });
        }
    },
    /*
     * Overview first: the report endpoint carries the authoritative
     * lifetime aggregates (it also powers the customer report), and the
     * sales list supplies the latest documents. Two small fetches, one
     * dossier.
     */
    loadRecentSales: function (id, d) {
        var cur = PosnicPro.local.get('currencySign');
        var esc = function (t) { return $('<span>').text(t == null ? '' : t).html(); };
        var dues = Number(d && d.partial_balance) || 0;
        PosnicPro.get({
            url: 'sales/customerSalesReportTable',
            data: { page: 1, limit: 1, starting_date: '', ending_date: '', branch: PosnicPro.local.get('branch_id_set'), field_input: id }
        }, function (r) {
            var row = ((r.data || {}).list || [])[0] || {};
            $('#c_doc_stats').html(
                '<div class="s-stat"><div class="s-stat-value">' + cur + '&nbsp;' + (Number(row.sales_payment) || 0).toFixed(2) + '</div>'
                + '<div class="s-stat-label">Lifetime sales</div></div>'
                + '<div class="s-stat"><div class="s-stat-value">' + (Number(row.sales_count) || 0) + '</div>'
                + '<div class="s-stat-label">' + (Number(row.sales_count) === 1 ? 'Sale' : 'Sales') + '</div></div>'
                + '<div class="s-stat"><div class="s-stat-value">' + cur + '&nbsp;' + (Number(row.sales_avg) || 0).toFixed(2) + '</div>'
                + '<div class="s-stat-label">Average sale</div></div>'
                + (Number(row.refund_payment) > 0
                    ? '<div class="s-stat"><div class="s-stat-value">' + cur + '&nbsp;' + Number(row.refund_payment).toFixed(2) + '</div>'
                        + '<div class="s-stat-label">Refunded</div></div>'
                    : '')
                + (dues > 0
                    ? '<div class="s-stat"><div class="s-stat-value" style="color: var(--theme-danger-color, #c0392b);">' + cur + '&nbsp;' + dues.toFixed(2) + '</div>'
                        + '<div class="s-stat-label">Dues</div></div>'
                    : '')
            );
        }, function () { $('#c_doc_stats').html(''); });
        /* the latest documents - matched by the exact customer name the
           sales carry (the list endpoint takes the same blob as the page) */
        var nameExact = String((d && d.name) || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        PosnicPro.get({
            url: 'sales',
            data: { page: 1, limit: 5, filters: JSON.stringify({ customer_name: { $regex: '^' + nameExact + '$', $options: 'i' } }) }
        }, function (response) {
            var list = ((response && response.data) || {}).list || [];
            var total = Number((response.data || {}).total) || list.length;
            if (!list.length) {
                $('#c_doc_sales').html('<div class="text-muted">No sales for this customer yet.</div>');
                return;
            }
            var html = '<table class="q-items s-doc-purchases-table"><thead><tr>'
                + '<th>Sale #</th><th>Status</th><th class="text-right">Date</th><th class="text-right">Total</th>'
                + '</tr></thead><tbody>';
            list.forEach(function (r) {
                var unpaid = String(r.payment_status || '').toLowerCase() === 'unpaid' || Number(r.partial_balance) > 0;
                var refunded = /return/i.test(String(r.sale_process || ''));
                var pill = refunded
                    ? '<span class="rs-pill hold">' + esc(r.sale_process) + '</span>'
                    : unpaid
                        ? '<span class="rs-pill unpaid">Unpaid</span>'
                        : '<span class="rs-pill paid">Paid</span>';
                html += '<tr>'
                    + '<td>' + esc(r.sales_id || '') + '</td>'
                    + '<td>' + pill + '</td>'
                    + '<td class="text-right q-muted">' + esc(r.date ? String(r.date).slice(0, 10) : '') + '</td>'
                    + '<td class="text-right">' + cur + '&nbsp;' + (Number(r.sales_total) || 0).toFixed(2) + '</td>'
                    + '</tr>';
            });
            html += '</tbody></table>';
            if (total > 5) {
                html += '<div class="q-muted" style="font-size:12.5px; padding: 8px 4px 0;">'
                    + (total - 5) + ' more in <a href="javascript:void(0)" onclick="hasher.setHash(\'sales\');">Sales History</a></div>';
            }
            $('#c_doc_sales').html(html);
        }, function () {
            $('#c_doc_sales').html('<div class="text-muted">Sales history unavailable.</div>');
        });
    },
    deleteAsk: function () {
        $('#c_delete_strip').slideDown(120);
    },
    deleteConfirm: function (id) {
        PosnicPro.request({
            method: 'DELETE',
            url: 'customers',
            data: JSON.stringify({ data: [id] })
        }, function (r) {
            PosnicPro.alert(r.type || 'success', r.message || 'Customer deleted');
            PosnicPro.customers.closeDoc();
            PosnicPro.customers.loadList(1);
        }, function (xhr) {
            var resp = {}; try { resp = jQuery.parseJSON(xhr.responseText) || {}; } catch (e) { }
            PosnicPro.alert('error', resp.message || 'Could not delete this customer');
        });
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
                (PosnicPro.customers.customer_phone || { setCountry: function () {} }).setCountry(response.data['countrySortName']);
            } else {
                $('#customer_state option:eq(0)').prop('selected', true);
                (PosnicPro.customers.customer_phone || { setCountry: function () {} }).setCountry(response.data['countrySortName']);
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
                        if (!row.sale_process || row.sale_process == 'Add' || row.sale_process == 'Edit') {
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
                        let trow = '<tr> <td scope="row" data-label="#">' + row_no + '</td> <td data-label="Sale">' + row.sales_id + '</td> <td class="export-date" data-label="Date">' + updateDate + '</td> <td class="text-center" data-label="Process"><span class="' + process_class + '">' + (row.sale_process || 'Add') + '</span></td> <td class="text-center text-danger" data-label="Return qty">' + returnQty + '</td> <td class="text-right text-danger" data-label="Return total">' + currency + '&nbsp;' + (Number(row.items_return_total) || 0).toFixed(2) + '</td><td class="text-center text-success" data-label="Qty">' + salesQty + '</td><td class="text-right text-success" data-label="Total">' + currency + '&nbsp;' + (Number(row.items_total) || 0).toFixed(2) + '</td></tr>';
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
                        let process = val.sale_process || 'Add';
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
                                    <td class="text-center"><img loading="lazy" decoding="async" src=' + image_path + ' width=30 height=20 class="imagezoom" id="' + image_path + '" onclick="PosnicPro.viewImage(this.id,\'customers\');"></td>\n\
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

    PosnicPro.lazyPhoneInput('#customer_phone', PosnicPro.customers, 'customer_phone', {
        separateDialCode: true,
        preferredCountries: ['in'],
        hiddenInput: "full",
        utilsScript: "../static/script/js/utils.js"
    });
});

/*end*/

$(document).on('click', '#customers_list_rows tr.customers-row', function () {
    PosnicPro.customers.openDoc($(this).data('id'));
});
$(document).on('click', '#customers_filter_btn', function () {
    PosnicPro.customers.mountFilters(true);
    PosnicPro.listFilter.toggle('customers');
});
