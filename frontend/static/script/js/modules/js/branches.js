PosnicPro.branches = {
    branchAction: 'add',
    branch_phone: null,
    showAdd: function () {
        PosnicPro.branches.loadSelectBranchState(PosnicPro.local.get('countryid'), 'add');
        var loader = $(".loader-branch");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.HideSideBarModal();
        PosnicPro.showAddModal('branch');
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $(".vertical-menu li a").removeClass("active");
        $(".vertical-layout").removeClass("toggle-menu");
        $('#v-pills-manage-tab,.branch_new_shortcut').addClass('active');
        $('#v-pills-manage').addClass('show active');
        $('.vertical-menu li a#view_branches_page').addClass('active');
        $('#branch_reset').show();
        $('.branch_edit_reset').hide();
        $('[data-toggle="tooltip"]').on('mouseleave', function () {
            $(this).tooltip('dispose');
        });
        $('#branch_id').val('');
        $('#branch_country').val(PosnicPro.local.get("country_setting")).trigger('change.select2');
        PosnicPro.local.set('edit_branch_state', PosnicPro.local.get("state_setting"));
        var countryDetail = $('#branch_country').select2("data");
        if (PosnicPro.branches.branchAction === 'edit') {
            PosnicPro.branches.branchClearform();
        }
        PosnicPro.branches.branchAction = 'add';
    },
    /*
     * Edit is a FULL PAGE now (modules/branchEdit.html): branch identity,
     * the store/outlet fields that used to live in Config, registers and
     * the logo - one page, one save, any branch of the license.
     */
    showEdit: function (id) {
        PosnicPro.HideSideBarModal();
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $(".vertical-layout").removeClass("toggle-menu");
        $(".vertical-menu li a").removeClass("active");
        $('.page_loader,#osk-container').hide();
        $('.page-title-box,#branchedit_new').show();
        $('#v-pills-manage-tab').addClass('active');
        $('#v-pills-manage').addClass('show active');
        $('.vertical-menu li a#view_branches_page').addClass('active');
        $('.mobile_tooltip').tooltip('hide');
        PosnicPro.branches.branchAction = 'edit';
        PosnicPro.branches.loadFullEdit(id);
    },
    loadFullEdit: function (id) {
        // Option lists first (idempotent - they repopulate by id wherever the
        // controls live), then this branch's values over them.
        PosnicPro.settings.loadSelectSettingCountry();
        PosnicPro.settings.loadSelectSettingCurrency();
        PosnicPro.settings.timeZone();
        PosnicPro.get({ url: 'branches/getBranchDetails', data: { id: id } }, function (response) {
            if (response.type !== 'success') { PosnicPro.alert(response.type, response.message); return; }
            var d = response.data;
            PosnicPro.record_id = id;
            $('#edit_branch_target,#be_logo_target').val(id);
            $('#be_page_branch_name').text(d.branch_name || '');
            $('#store_name').val(d.branch_name);
            $('#store_email').val(d.store_email);
            $('#store_telephone').val(d.store_telephone);
            $('#store_alternativephone').val(d.store_alternativephone);
            $('#store_address').val(d.store_address);
            $('#printing_address').val(d.printing_address);
            $('#city').val(d.city);
            $('#pincode').val(d.pincode);
            $('#website').val(d.website);
            $('#branch_gstin_number').val(d.branch_gstin_number);
            // Selects fill after their (async) option lists land.
            setTimeout(function () {
                $('#setting_country').val(d.country).trigger('change.select2');
                PosnicPro.settings.loadSelectSettingState(d.country_id);
                setTimeout(function () {
                    $('#setting_state').val(d.state).trigger('change.select2');
                }, 400);
                $('#currency_setting').val(d.currency_text).trigger('change.select2');
                var cv = (d.currency_value && d.currency_value[0]) || { currency_text: 'INR', currency_sign: '₹' };
                $('#currencyText').val(cv.currency_sign);
                $('#currencyTextname').val(cv.currency_text);
                $('#currency_type').empty().append(
                    '<option value="' + cv.currency_text + '">Text( ' + cv.currency_text + ' )</option>' +
                    '<option value="' + cv.currency_sign + '">Symbol( ' + cv.currency_sign + ' )</option>');
                $('#currency_type').val(d.currency_type);
                $('#time_zone').val(d.time_zone).trigger('change.select2');
                $('#storedate').val(d.client_dateformat).trigger('change.select2');
                $('#serverdate').val(d.server_dateformat);
                $('#dateText').val(d.dateformat_text);
            }, 600);
            var image_path = (d.logo && d.logo !== 'store.png') ? d.logo : 'static/images/default/store.png';
            $('#previewing').attr('src', image_path);
            $('#setting_logo_value').val(d.logo || 'store.png');
            $('#be_register_rows').empty();
            $.each(d.register || [], function (i, r) {
                var name = (r && (r.register_name || r.name)) || (typeof r === 'string' ? r : '');
                if (name) { PosnicPro.branches.beAddRegisterRow(name); }
            });
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    beAddRegisterRow: function (name) {
        var row = $('<div class="input-group mb-2 be-register-row" style="max-width:340px;">' +
            '<input type="text" class="form-control be-register" maxlength="20" placeholder="Register name" data-t-placeholder="lang_registername_title">' +
            '<div class="input-group-append"><button class="btn btn-outline-danger" type="button">' +
            '<i class="feather icon-x"></i></button></div></div>');
        row.find('input').val(name || '');
        row.find('button').on('click', function () { row.remove(); });
        $('#be_register_rows').append(row);
    },
    showDelete: function (id) {
        PosnicPro.deleteTableRowData(id, 'branches');
    },
    /* Deep link #/branches/<id>: the list with that branch open in the
       right pane; switching and editing are the deliberate acts inside.
       Recognises its own setHash echo. */
    showDetails: function (id) {
        if (PosnicPro.listDoc.activeId('branches') === String(id)
            && $('#branches_detail_card').is(':visible')) { return; }
        PosnicPro.branches.showDataTablePage();
        PosnicPro.branches.openDoc(id);
    },
    openDoc: function (id) {
        var esc = function (t) { return $('<span>').text(t == null ? '' : t).html(); };
        var current = PosnicPro.local.get('branch_id_set') === String(id);
        var pills = current ? '<span class="badge badge-success-inverse"><lang class="lang_current">Current</lang></span>' : '';
        /* The branch you are STANDING in cannot be deleted from under you. */
        var actions = '<button type="button" class="btn btn-sm btn-light" data-module="branch" data-access="write" data-toggle="tooltip" title="Edit this branch" data-t-title="lang_edit_this_branch" aria-label="Edit" data-t-aria-label="lang_edit_title"'
            + ' onclick="hasher.setHash(\'branches/' + esc(id) + '/edit\');"><i class="feather icon-edit-2"></i></button>'
            + (current ? '' : '<button type="button" class="btn btn-sm btn-light" data-module="branch" data-access="delete" data-toggle="tooltip" title="Delete this branch" data-t-title="lang_delete_this_branch" aria-label="Delete" data-t-aria-label="lang_delete"'
                + ' onclick="PosnicPro.listDoc.close(\'branches\'); hasher.setHash(\'branches/' + esc(id) + '/delete\');"><i class="feather icon-trash-2"></i></button>');
        PosnicPro.listDoc.open({ key: 'branches', id: id, title: PosnicPro.i18n.t('lang_newbranch_title', 'Branch'), pills: pills, actions: actions });
        PosnicPro.ACLForModule('branch');
        PosnicPro.get({ url: 'branches/getBranchDetails', data: { id: id } }, function (response) {
            var d = response && response.data;
            if (response.type !== 'success' || !d) {
                PosnicPro.listDoc.body('branches', '<div class="text-danger p-3"><lang class="lang_could_not_open_this_branch">Could not open this branch.</lang></div>');
                return;
            }
            PosnicPro.listDoc.title('branches', d.branch_name || 'Branch');
            var registers = $.map(d.register || [], function (r) {
                return (r && (r.register_name || r.name)) || (typeof r === 'string' ? r : null);
            }).filter(Boolean);
            var cv = (d.currency_value && d.currency_value[0]) || {};
            var currency = [cv.currency_sign, cv.currency_text || d.currency_text].filter(Boolean).join(' ')
                || d.currency_type || '';
            var logo = (d.logo && d.logo !== 'store.png')
                ? '<img src="' + esc(d.logo) + '" style="width:84px; height:84px; object-fit:contain; border-radius:8px; flex:0 0 84px; border:1px solid var(--theme-border-color, #e3e7ee); background:#fff;" alt="">'
                : '';
            PosnicPro.listDoc.body('branches',
                '<div style="display:flex; gap:20px; align-items:flex-start;">'
                + logo
                + '<div style="flex:1 1 auto; min-width:0;">'
                + PosnicPro.listDoc.stats([
                    { v: String(registers.length || 1), l: registers.length === 1 ? PosnicPro.i18n.t('lang_records_title', 'Register') : PosnicPro.i18n.t('lang_registers_title', 'Registers') },
                    { v: esc(currency || '\u2014'), l: PosnicPro.i18n.t('lang_currency_title', 'Currency') },
                    { v: d.branch_gstin_number ? 'GST' : '\u2014', l: d.branch_gstin_number ? PosnicPro.i18n.t('lang_registered', 'Registered') : PosnicPro.i18n.t('lang_no_gstin', 'No GSTIN') }
                ])
                + '</div></div>'
                + PosnicPro.listDoc.grid([
                    { label: PosnicPro.i18n.t('lang_contact', 'Contact'), lines: [
                        d.store_telephone ? '<div><a href="tel:' + esc(d.store_telephone) + '">' + esc(d.store_telephone) + '</a></div>' : '',
                        d.store_alternativephone ? '<div class="q-muted">Alt: ' + esc(d.store_alternativephone) + '</div>' : '',
                        d.store_email ? '<div><a href="mailto:' + esc(d.store_email) + '">' + esc(d.store_email) + '</a></div>' : '',
                        d.website ? '<div class="q-muted">' + esc(d.website) + '</div>' : ''
                    ] },
                    { label: PosnicPro.i18n.t('lang_location', 'Location'), lines: [
                        d.store_address ? '<div>' + esc(d.store_address) + '</div>' : '',
                        (d.city || d.pincode) ? '<div class="q-muted">' + esc([d.city, d.pincode].filter(Boolean).join(' - ')) + '</div>' : '',
                        (d.state || d.country) ? '<div class="q-muted">' + esc([d.state, d.country].filter(Boolean).join(', ')) + '</div>' : ''
                    ] },
                    { label: PosnicPro.i18n.t('lang_module_tax', 'Tax'), lines: [
                        d.branch_gstin_number ? '<div>GSTIN ' + esc(d.branch_gstin_number) + '</div>' : '<div class="q-muted"><lang class="lang_no_gstin_configured">No GSTIN configured</lang></div>'
                    ] },
                    { label: PosnicPro.i18n.t('lang_locale', 'Locale'), lines: [
                        currency ? '<div>' + esc(currency) + '</div>' : '',
                        d.time_zone ? '<div class="q-muted">' + esc(d.time_zone) + '</div>' : '',
                        d.client_dateformat ? '<div class="q-muted">Dates: ' + esc(d.dateformat_text || d.client_dateformat) + '</div>' : ''
                    ] },
                    { label: PosnicPro.i18n.t('lang_printing', 'Printing'), lines: [
                        d.printing_address ? '<div class="q-muted">' + esc(d.printing_address) + '</div>' : ''
                    ] },
                    { label: PosnicPro.i18n.t('lang_registers_title', 'Registers'), lines: [
                        registers.length
                            ? ['<div>' + registers.map(function (r) { return '<span class="badge badge-secondary-inverse mr-1">' + esc(r) + '</span>'; }).join(' ') + '</div>']
                            : '<div class="q-muted"><lang class="lang_one_unnamed_register">One unnamed register</lang></div>'
                    ] }
                ])
                + (current ? '' : PosnicPro.listDoc.link('Switch to this branch', "PosnicPro.branches.showChange('" + esc(id) + "');")));
        }, function () {
            PosnicPro.listDoc.body('branches', '<div class="text-danger p-3"><lang class="lang_could_not_open_this_branch">Could not open this branch.</lang></div>');
        });
    },
    /* The name the OLD table machinery answered to - settings flows still
       call it after branch saves. */
    branchesTable: function () {
        PosnicPro.branches.loadList(1);
    },
    _page: 1,
    PAGE_SIZE: 25,
    _lastRows: [],
    mountFilters: function (force) {
        if (!$('#branches_filter_panel').length) { return; }
        if (!force && $('#branches_filter_panel').data('mounted')) { return; }
        $('#branches_filter_panel').data('mounted', true);
        PosnicPro.listFilter.mount({
            key: 'branches',
            container: '#branches_filter_panel',
            button: '#branches_filter_btn',
            searchPlaceholder: PosnicPro.i18n.t('lang_search_name_phone_or_email', 'Search name, phone or email'),
            searchFields: [
                { value: 'all', label: PosnicPro.i18n.t('lang_all_fields', 'All fields') },
                { value: 'branch_name', label: PosnicPro.i18n.t('lang_name_title', 'Name') },
                { value: 'store_telephone', label: PosnicPro.i18n.t('lang_phone_title', 'Phone') },
                { value: 'store_email', label: PosnicPro.i18n.t('lang_email_title', 'Email') },
                { value: 'store_address', label: PosnicPro.i18n.t('lang_address_title', 'Address') }
            ],
            onChange: function () { PosnicPro.branches.loadList(1); }
        });
    },
    loadList: function (page) {
        PosnicPro.branches.mountFilters();
        var self = PosnicPro.branches;
        if (page) { self._page = page; }
        var filters = PosnicPro.listFilter.legacyFilters('branches', {});
        var esc = function (t) { return $('<span>').text(t == null ? '' : t).html(); };
        PosnicPro.get({
            url: 'branches',
            data: { page: self._page, limit: self.PAGE_SIZE, filters: JSON.stringify(filters) }
        }, function (response) {
            var data = (response && response.data) || {};
            var list = data.list || [];
            self._lastRows = list;
            if (!list.length) {
                var filtered = PosnicPro.listFilter.activeCount('branches') > 0;
                $('#branches_list_rows').html('<div class="text-center text-muted p-t-20 p-b-20">'
                    + (filtered ? PosnicPro.i18n.t('lang_no_branches_match_this_filter', 'No branches match this filter.') : PosnicPro.i18n.t('lang_no_branches_yet_press_new_to_add_the_first', 'No branches yet - press New to add the first.')) + '</div>');
                $('#branches_list_paging').html('');
                return;
            }
            var current = PosnicPro.local.get('branch_id_set');
            var html = '<div class="table-responsive"><table class="table table-borderless">'
                + '<thead><tr><th><lang class="lang_name_title">Name</lang></th><th class="br-col-phone"><lang class="lang_phone_title">Phone</lang></th><th class="br-col-email"><lang class="lang_email_title">Email</lang></th>'
                + '<th class="br-col-address"><lang class="lang_address_title">Address</lang></th><th class="br-col-state"><lang class="lang_state_title">State</lang></th></tr></thead><tbody>';
            list.forEach(function (r) {
                var isCurrent = current === String(r._id);
                html += '<tr class="md-row branches-row highlight-select'
                    + (PosnicPro.listDoc.activeId('branches') === String(r._id) ? ' is-active' : '') + '" data-id="' + esc(r._id) + '" style="cursor:pointer;">'
                    + '<td>' + esc(r.branch_name)
                    + (isCurrent ? ' <span class="badge badge-success-inverse"><lang class="lang_current">Current</lang></span>' : '') + '</td>'
                    + '<td class="br-col-phone">' + esc(r.store_telephone || '-') + '</td>'
                    + '<td class="br-col-email q-muted">' + esc(r.store_email || '-') + '</td>'
                    + '<td class="br-col-address q-muted">' + esc(r.store_address || '-') + '</td>'
                    + '<td class="br-col-state">' + esc(r.state || '-') + '</td>'
                    + '</tr>';
            });
            html += '</tbody></table></div>';
            $('#branches_list_rows').html(html);
            PosnicPro.ACLForModule('branch');
            self.renderPager(Number(data.total) || list.length);
        }, function () {
            $('#branches_list_rows').html('<div class="text-center text-muted p-t-20 p-b-20"><lang class="lang_could_not_load_branches_try_again">Could not load branches - try again.</lang></div>');
        });
    },
    renderPager: function (total) {
        var self = PosnicPro.branches;
        var p = self._page, size = self.PAGE_SIZE;
        var pages = Math.ceil(total / size) || 1;
        var label = total + ' ' + (total === 1 ? PosnicPro.i18n.t('lang_branch_4', 'branch') : PosnicPro.i18n.t('lang_branches', 'branches'));
        if (pages > 1) { label = 'Page ' + p + ' of ' + pages + ' \u00b7 ' + label; }
        var btn = function (to, text, off, cls) {
            return '<button type="button" class="btn btn-sm ' + (cls || 'btn-secondary-rgba') + ' q-pg-btn"' + (off ? ' disabled' : '')
                + ' onclick="PosnicPro.branches.goPage(' + to + ');">' + text + '</button>';
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
        $('#branches_list_paging').html(html);
    },
    goPage: function (n) {
        if (!n || n < 1) { return; }
        PosnicPro.branches._page = n;
        PosnicPro.branches.loadList();
    },
    exportCsv: function () {
        var rows = [['Name', 'Phone', 'Email', 'Address', 'State', 'Country']];
        (PosnicPro.branches._lastRows || []).forEach(function (r) {
            rows.push([r.branch_name, r.store_telephone || '', r.store_email || '', r.store_address || '', r.state || '', r.country || '']);
        });
        var csv = rows.map(function (r) {
            return r.map(function (c) { return '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"'; }).join(',');
        }).join('\n');
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'branches.csv';
        a.click();
        URL.revokeObjectURL(a.href);
    },
    showDataTablePage: function () {
        PosnicPro.HideSideBarModal();
        $('.page_loader,#osk-container').hide();
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $('.vertical-menu li a').removeClass('active');
        $('.page-title-box,#branches').show();
        $('#v-pills-manage-tab').addClass('active');
        $('#v-pills-manage').addClass('show active');
        $('.dashboard_img_menu').hide();
        $('#image_sidebar_branch').show();
        PosnicPro.branches.loadList(1);
    },
    triggerAddNew: function (module) {
        PosnicPro.getAddNewPage(module + '_new');
    },
    /*This Branches Function Used To Add & Edit */
    branch: function () {

        if ($('#name_branch').val() !== '' && $('#branch_email').val() !== '' && PosnicPro.validateEmail($('#branch_email').val()) && $('#branch_phone').val() !== '' && $('#branch_address').val() !== '' && $('#branch_country').val() !== '' && $('#branch_state').val() !== '') {
            var loader = $(".loader-branch");
            $("<div class='loadingSpinner'></div>").appendTo(loader);
            PosnicPro.action = 'add';
            var method = 'POST';
            var url = 'branches';
            if ($('#branch_id').val() !== '') {
                PosnicPro.action = 'edit';
                method = 'PUT';
                url += '/' + $('#branch_id').val();
            }

            var branchId = $(".register_list")
                    .map(function () {
                        return $(this).val();
                    }).get();
            var registerType = {
                register: branchId
            }

            let countryValue = $("#branch_country").select2("data");
            let countryId = {
                country_id: countryValue[0].element.attributes['data-setting-id'].value
            };

            var formData = PosnicPro.getFormData($('#branch_add_form'));
            var params = {
                method: method,
                url: url,
                data: JSON.stringify(
                    Object.assign(formData, registerType, countryId, PosnicPro.branches.sharingChoice())
                )
            };

            PosnicPro.request(params, function (response) {
                if (response.type === 'success') {
                    if (PosnicPro.action === 'add') {
                        var branchList = response.data['branchList'];
                        PosnicPro.setBranchDropdownOption(branchList);
                        PosnicPro.branches.branchesTable('branches');
                        $('#show_last_created_branch').show();
                        var path = '#/branches/' + response.data['insertId'];
                        $('#last_created_branch').attr('href', path);

                    }
                    $('.branch-trigger').val('');
                    $('.register-wrapper .register-fields .register-input:nth-child(n+2)').remove();
                    PosnicPro.alert(response.type, response.message);
                    PosnicPro.getBranchDropdownOption();
                    loader.find(".loadingSpinner:first").remove();
                    var hash = window.location.hash.slice(1);
                    if (hash === '/branches/new/addbranch') {
                        $('#branches_new').modal('hide');
                        history.back();
                        return false;
                    }
                    if (PosnicPro.action === 'edit') {
                        $('#branch_name option[value="' + response.data['id'] + '"]').text(response.data['branch_name']);
                        $(".infobar-settings-sidebar-overlay").css({"background": "transparent", "position": "initial"});
                        $("#infobar-settings-sidebar-branch").removeClass("sidebarshow");
                        let branch_id = PosnicPro.local.get('branch_id_set');
                        if (branch_id === response.data['id']) {
                            $(".branch-name").html(response.data['branch_name']);
                        }
                        PosnicPro.local.set('branchname', response.data['branch_name']);
                        PosnicPro.local.set('branchemail', response.data['store_email']);
                        PosnicPro.local.set('branchphone', response.data['store_telephone']);
                        PosnicPro.local.set('branchaddress', response.data['store_address']);
                    PosnicPro.local.set('branchgstin', response.data['branch_gstin_number'] || '');
                        let branchRecord = [];
                        branchRecord.push({name: response.data['branch_name'], phone: response.data['store_telephone'], email: response.data['store_email'], address: response.data['store_address'], image: response.data['branch_image']});
                        db.customerDisplay.put({id: '2', 'clear': 'no', 'get': 'no', branch: branchRecord});
                        hasher.setHash('branches');
                    }

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
    /*Display the branch details*/
    viewBranch: function (id) {
        var loader = $(".loader-view-branch");
        $("<div class='loadingSpinner'></div>").appendTo(loader);

        PosnicPro.get('branches/' + id, function (response) {
            if (response.type === 'success') {
                PosnicPro.record_id = id;
                PosnicPro.branches.viewBranchData(response);
                loader.find(".loadingSpinner:first").remove();
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    viewBranchData: function (response) {
        $('#v-pills-manage').addClass('show active');
        $(".infobar-settings-sidebar-overlay").css({"background": "rgba(0,0,0,0.4)", "position": "fixed"});
        $("#infobar-settings-sidebar-branches-details").addClass("sidebarview");
        var data = response.data;
        $('#branch_view_store_telephone_icon').attr('href', 'tel:' + data.store_telephone);
        $('#branch_view_store_email_icon').attr('href', 'mailto:' + data.store_email);
        let image_path = (data.logo !== "store.png") ? data.logo : 'static/images/default/' + data.logo;
        $('.branchimageview').attr('src', image_path);
        $('.branchimageview').attr('id', data.logo);
        $('.branchimageview').attr('onClick', 'PosnicPro.viewImage(this.id,\'branch\')');
        $.each(data, function (key, val) {
            if (val === '') {
                $('#branch_view_' + key).text('');
                $('#branch_view_' + key + '_icon').hide();
            } else {
                $('#branch_view_' + key + '_icon').show();
                $('#branch_view_' + key).text(val);
            }
        });
        // Registers may be stored as {register_id, register_name} (current),
        // {id, name} (older) or plain name strings (legacy PHP) - show all.
        var register = [];
        $.each(data.register || [], function (index, value) {
            var name = (value && (value.register_name || value.name))
                || (typeof value === 'string' ? value : '');
            if (name) { register.push(name); }
        });
        $('#branch_view_website_value').text(data.website);
        $('#branch_view_city_value').text(data.city);
        $('#branch_view_pincode_value').text(data.pincode);
        $('#branch_view_currency_text_value').text(data.currency_text);
        $('#branch_view_currency_type_value').text(data.currency);
        $('#branch_view_time_zone_value').text(data.time_zone);
        $('#branch_view_dateformat_text_value').text(data.dateformat_text);
        $('#branch_view_time_format_value').text(data.time_format);
        $('#branch_view_print_type_value').text(data.print_type);
        $('#branch_view_printing_address_value').text(data.printing_address);
        $('#branch_view_indian_gst_value').text(data.indian_gst);
        $('#branch_view_theme_value').text(data.theme);
        $('#branch_view_notification_range_value').text(data.notification_range);
        $('#branch_view_register_value').text(register.length ? register.join(', ') : 'None');
        var updateCreateDate = PosnicPro.convertDate(data.created_date);
        $('#branch_view_created_date').text(updateCreateDate);
        var updateUpdateDate = PosnicPro.convertDate(data.updated_date);
        $('#branch_view_updated_date').text(updateUpdateDate);
    },
    /*Edit the branch details*/
    editBranch: function (id) {
        var loader = $(".loader-branch");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        $(".infobar-settings-sidebar-overlay").css({"background": "rgba(0,0,0,0.4)", "position": "fixed"});
        $("#infobar-settings-sidebar-branch").addClass("sidebarshow");
        var params = {
            url: 'branches/getBranchDetails',
            data: {
                id: id
            }
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                $('#branches_new').modal('show');
                data = response.data;
                PosnicPro.branches.loadSelectBranchState(data.country_id, 'edit');
                PosnicPro.record_id = id;
                $('#branch_id').val(PosnicPro.record_id);
                $('#branch_logo').val(data.logo);
                $('#name_branch').val(data.branch_name);
                $('#branch_phone').val(data.store_telephone);
                $('#branch_email').val(data.store_email);
                $('#branch_address').val(data.store_address);
                $('#branch_country').val(data.country).trigger('change.select2');
                PosnicPro.local.set('edit_branch_state', data.state);
                $('#branch_title').text(PosnicPro.i18n.t('lang_action_edit', 'Edit'));
                $('#branch_button_title').text(PosnicPro.i18n.t('lang_updatebtn_title', 'Update'));

                $('.update-button').attr('disabled', 'disabled').removeClass('btn-outline-success');
                PosnicPro.branches.sharingRow(false);
                $('.register-wrapper .register-fields .register-input:nth-child(n+2)').remove();
                let $test = $('.register-input:parent');
                $('.add-field', $test).hide();
                $.each(data.register, function (index, value) {
                    $('.register-wrapper').each(function () {
                        var $wrapper = $('.register-fields', this);
                        $('.register-input:first-child', $wrapper).clone(true).appendTo($wrapper).find('input').removeClass('edit-register-class').val(value.register_name);
                    });
                });
                if (data.register.length === 0) {
                    $('.register-wrapper').each(function () {
                        var $wrapper = $('.register-fields', this);
                        $('.register-input:first-child', $wrapper).clone(true).appendTo($wrapper).find('input').removeClass('edit-register-class').val('');
                    });
                }
                let $newtest = $('.register-input:last-child');
                $('.add-field', $newtest).show();
                $('.register-wrapper .register-fields .register-input:nth-child(1)').remove();
                loader.find(".loadingSpinner:first").remove();
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    resetEditButton: function (id) {
        PosnicPro.branches.editBranch(id);
        let $firstChild = $('.register-input:first-child');
        $('.add-field', $firstChild).show();
    },
    /*
     * The three sharing boxes, as EXPLICIT booleans (owner ask #85).
     *
     * serializeArray() omits an unchecked checkbox entirely, and the server
     * treats an absent key as "use the default" - which for these is ticked.
     * So unticking Customers and pressing Save would have shared them anyway,
     * with the form showing the opposite. The one failure mode worth more than
     * the others here is silence, so the value is stated rather than implied.
     *
     * Only on CREATE. Editing a branch is not where an account-wide rule is
     * changed, and sending these on every branch save would let a stale form
     * re-impose a default over a rule set in Settings.
     */
    sharingChoice: function () {
        if ($('#branch_id').val() !== '') { return {}; }
        return {
            share_customers: $('#share_customers').is(':checked'),
            share_suppliers: $('#share_suppliers').is(':checked'),
            /* Not a switch. Stock sits on one shelf in one building, so the
               product LIST is copied once here rather than shared as a rule -
               empty means start with nothing. */
            copy_items_from: $('#copy_items_from').val() || ''
        };
    },
    /* Shown while creating, hidden while editing - see sharingChoice. */
    sharingRow: function (creating) {
        $('#branch_sharing_row').toggle(!!creating);
        if (creating) { PosnicPro.branches.fillCopyFrom(); }
    },
    /*
     * The shops a new one can copy its products from.
     *
     * Read from the branch dropdown the header already keeps, rather than
     * another request: it holds exactly the branches this user may see, so a
     * shop they have no access to cannot appear here as a source.
     */
    fillCopyFrom: function () {
        var $sel = $('#copy_items_from');
        if (!$sel.length) { return; }
        var current = $sel.val();
        $sel.find('option').not('[value=""]').remove();
        $('#branch_name option').each(function () {
            var id = $(this).val();
            if (!id) { return; }
            $sel.append($('<option>').attr('value', id).text($(this).text()));
        });
        $sel.val(current || '');
    },
    addbranchButton: function () {
        var loader = $(".loader-branch");
        loader.find(".loadingSpinner:first").remove();
        $('#branch_title').text(PosnicPro.i18n.t('lang_new_title', 'Add'));
//        $('#branch_button_title').text(PosnicPro.i18n.t('lang_save_title', 'Save'));
        $('#branch_button_title').text(PosnicPro.i18n.t('lang_save_title', 'Save'));

        $('.update-button').attr('disabled', 'disabled').removeClass('btn-outline-success');
        $('#branch_id').val('');
        $('#branches_new .alert').remove();
        $('#show_last_created_branch').hide();
        PosnicPro.branches.sharingRow(true);
    },
    branchClearform: function () {
        PosnicPro.branches.loadSelectBranchState(PosnicPro.local.get('countryid'), 'clear');
        $('#branch_add_form')[0].reset();
        $('.register-wrapper .register-fields .register-input:nth-child(n+2)').remove();
        $('#branch_country').val(PosnicPro.local.get("country_setting")).trigger('change.select2');
        PosnicPro.local.set('edit_branch_state', PosnicPro.local.get("state_setting"));
        $('#branch_address').html('');
        $('.error_branch').css('display', 'none');
        var $lastChild = $('.register-input:last-child');
        $('.add-field', $lastChild).show();
    },
    loadSelectBranchState: function (id, action) {
        var stateSelect = $('#branch_state');
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

            if (PosnicPro.local.get('edit_branch_state') !== '' && action === 'edit') {
                stateSelect.val(PosnicPro.local.get('edit_branch_state')).trigger('change.select2');
                (PosnicPro.branches.branch_phone || { setCountry: function () {} }).setCountry(response.data['countrySortName']);
            } else {
                $('#branch_state option:eq(0)').prop('selected', true);
                (PosnicPro.branches.branch_phone || { setCountry: function () {} }).setCountry(response.data['countrySortName']);
            }
        });
    },
    validForm: function () {
        var $branchAddForm = $("#branch_add_form");
        $branchAddForm.validate({
            errorClass: 'error error_branch',
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
                    required: true,
                    minlength: 3,
                    maxlength: 500
                },
                phone: {
                    required: true,
                    minlength: 3,
                    maxlength: 20,
                    branch_phone_number: true
                },
                email: {
                    required: true,
                    email: true,
                    emailExt: true,
                    minlength: 3,
                    maxlength: 250
                },
                country: {
                    required: true
                },
                state: {
                    required: true
                },
                "branchregister[0]": {
                    minlength: 3,
                    maxlength: 20
                }
            },
            messages: {
                name: {
                    required: "Enter the shop name",
                    minlength: "Branch name must be at least 3 characters",
                    maxlength: "Branch name is too long !"
                },
                phone: {
                    branch_phone_number: "Enter a valid phone number",
                    minlength: "Use at least 3 characters",
                    maxlength: "Use no more than 20 characters"
                },
                address: {
                    required: "Enter an address",
                    minlength: "Address must be at least 3 characters long",
                    maxlength: "Address is too long !"
                },
                email: {
                    required: "Enter a valid email address",
                    maxlength: "Email should not be more than 250 Characters"
                },
                country: {
                    required: "Choose your country"
                },
                state: {
                    required: "Choose your state"
                },
                "branchregister[0]": {
                    minlength: "Name Must be in 3 charcters",
                    maxlength: "Register is too long !"
                }
            }
        });
        jQuery.validator.addMethod("branch_phone_number", function (phone_number, element) {
            let valid = PosnicPro.branches.branch_phone.isValidNumber();
            let num = PosnicPro.branches.branch_phone.getNumber();
            if (valid === true) {
                $('#branch_phone').val(num);
                return true;
            } else {
                return false;
            }

        }, "Enter a valid phone number");

        $("#branch_add_form").submit(function (event) {
            event.preventDefault();
            if ($('#branch_add_form').valid()) {            // checks form for validity
                PosnicPro.branches.branch();
            }
        });
    }
};

$("#branches_new").on('shown.bs.modal', function () {
    $(this).find('#name_branch').focus();
});

function validate(input) {
    if (/^\s/.test(input.value))
        input.value = '';
}

$('.register-wrapper').each(function () {
    var $wrapper = $('.register-fields', this);
    var i = 0;
    $(".add-field", $(this)).click(function (e) {
        i++;
        if ($(this).parent('.register-input').find('input').val().length >= 3) {
            var $parent = $('.register-input:parent', $wrapper);
            var $registerField = $('.register-input:first-child', $wrapper).clone(true);
            $registerField.appendTo($wrapper).find('input').attr('id', 'register[' + i + ']').attr('name', 'branchregister[' + i + ']').val('').focus();
            $('.add-field', $registerField).show();
            $('.add-field', $parent).hide();

            // Remove previous error message and validation for the new field
            $('.error_branch', $registerField).remove();
            $('input', $registerField).removeClass('error').removeData('previousValue');

            // Set validation rules for the new field
            $registerField.find('input').rules('add', {
                required: true,
                minlength: 3,
                maxlength: 20,
                messages: {
                    required: "Must be 3 character Need",
                    minlength: "Must be 3 character Need",
                    maxlength: "Too long!"
                }
            });

            // Trigger validation for the new field
            $registerField.find('input').valid();
        }
    });

    $('.register-input .remove-field', $wrapper).click(function () {
        var $registerInput = $(this).closest('.register-input');
        $('input', $registerInput).val('');
        if ($('.register-input', $wrapper).length > 1)
            $(this).parent('.register-input').remove();

        var fieldIndex = $(this).parent('.register-input').find('input').attr('name').match(/\d+/)[0];
        $("#branch_add_form").validate().settings.rules['branchregister[' + fieldIndex + ']'] = undefined; // Remove validation rules for the removed field
        $("#branch_add_form").validate().settings.messages['branchregister[' + fieldIndex + ']'] = undefined; // Remove validation messages for the removed field
    });
});

$("#branchSubmitForm").one('click', function () {
    PosnicPro.branches.validForm();
    var $firstChild = $('.register-input:first-child');
    $('.add-field', $firstChild).show();
});

$('.remove-field').click(function () {
    var $lastChild = $('.register-input:last-child');
    $('.add-field', $lastChild).show();
});

$('#branch_country').one('change', function () {
    var countrySelect = $('#branch_country');
    countrySelect.on('select2:select', function (e) {
        var data = e.params.data;
        PosnicPro.branches.loadSelectBranchState(data.element.attributes['data-setting-id'].value, 'onChange');
    });
});
$(function () {
    PosnicPro.lazyPhoneInput('#branch_phone', PosnicPro.branches, 'branch_phone', {
        separateDialCode: true,
        preferredCountries: ['in'],
        hiddenInput: "full",
        utilsScript: "../static/script/js/utils.js"
    });
});

/* Standard list wiring: Filter button, row click peeks the branch in
   place, row action buttons never also open the row. */
$(document).on('click', '#branches_filter_btn', function () {
    PosnicPro.branches.mountFilters(true);
    PosnicPro.listFilter.toggle('branches');
});
$(document).on('click', '#branches_list_rows tr.branches-row', function () {
    PosnicPro.branches.openDoc($(this).data('id'));
});
