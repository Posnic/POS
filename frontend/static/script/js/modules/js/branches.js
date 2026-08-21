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
            '<input type="text" class="form-control be-register" maxlength="20" placeholder="Register name">' +
            '<div class="input-group-append"><button class="btn btn-outline-danger" type="button">' +
            '<i class="feather icon-x"></i></button></div></div>');
        row.find('input').val(name || '');
        row.find('button').on('click', function () { row.remove(); });
        $('#be_register_rows').append(row);
    },
    showDelete: function (id) {
        PosnicPro.deleteTableRowData(id, 'branches');
    },
    showDetails: function (id) {
        var loader = $(".loader-view-branch");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.showViewModal('branches');
        PosnicPro.branches.viewBranch(id);
    },
    showChange: function (id) {
        PosnicPro.local.set('changebranchid', id);
        db.currentregister.get('1').then(function (data) {
            if (data.register_status === 'open') {
                $('#branch_register_swipe').modal('show');
            } else {
                let branch_id = PosnicPro.local.get('changebranchid');
                PosnicPro.settings.listBranchName(branch_id);
            }
        }).catch(function () {
            let branch_id = PosnicPro.local.get('changebranchid');
            PosnicPro.settings.listBranchName(branch_id);
            $('#branch_register_swipe').modal('hide');
        });
    },
    branchesTable: function () {
        var loader = $(".loader-table-branch");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        PosnicPro.appendViewDataTableBody('branches');
        var table = $('#view_branches');
        var params = {
            url: 'branches',
            data: {
                page: table.data('current_page'),
                limit: parseInt($('#view_branches_per_page  option:selected').text()),
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
                $('#view_branches_total').text(response.data.total);
                var rowTotal = response.data.total;
                if (rowTotal === 0) {
                    $('.branch_header').hide();
                    let dateRange = $('#view_sales_daterange span span[data-toggle="tooltip"]').attr('data-original-title');
                    $('.branch_norecord').empty().append('<div class="text-center text-dark"> <p>No Records on ' + dateRange + '</p></div>');
                    $('#branch_img_hide,.branch_norecord').show();

                } else {
                    $('.branch_norecord').empty();
                    $('#branch_img_hide,.branch_norecord').hide();
                    $('.branch_header').show();
                }

                var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                $('#view_branches_page_total').text(row_total);
                var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                $('#view_branches_page_perpage_total').text(page_totals + response.data.list.length);
                for (var i = 0; i < response.data.list.length; i++) {
                    var row = response.data.list[i];
                    var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                    var action = '<div id="onclick-toolbar-options_' + i + '" class="hidden">' +
                            '<a data-module = "branch" data-access = "read" href="#/branches/' + row._id + '" data-id="branches/' + row._id + '"  data-toggle="tooltip" title="View Branch" class="point-cursor mobile_tooltip"><i class="feather icon-eye"></i></a>' +
                            '<a data-module = "branch" data-access = "write" href="#/branches/' + row._id + '/edit" data-id="branches/' + row._id + '/edit"  data-toggle="tooltip" title="Edit Branch" class="point-cursor mobile_tooltip"><i class="feather icon-edit"></i></a>' +
                            '<a data-module = "branch" data-access = "delete" href="#/branches/' + row._id + '/delete" data-id="branches/' + row._id + '/delete" data-toggle="tooltip" title="Delete Branch" class="point-cursor mobile_tooltip"><i class="feather icon-trash"></i></a>' +
                            '</div>' +
                            '<div data-toolbar="user-options" class="btn btn-round btn-primary-rgba round-pad" id="onclick-toolbar_' + i + '"><i class="feather icon-more-vertical-"></i></div>';

                    var trow = '<tr><th><input type="checkbox" class="branches-row-id" id="' + row._id + '" name="id[]" value="' + row._id + '" onclick="PosnicPro.checkboxSelectOne(this,\'branches\');"></th> <th scope="row">' + row_no + '</th>  <td>' + row.branch_name + '</td> <td class="text-right"><a class="sale_color" href="tel:' + row.store_telephone + '">' + row.store_telephone + '</a></td> <td><a class="sale_color" href="mailto:' + row.store_email + '">' + row.store_email + '</a></td> <td>' + row.store_address + '</td>'
                            + '<td>' + row.state + '</td>' + '<td>' + row.country + '</td>' + '<td class="text-center"><span>' + action + '</span></td>' +
                            '</tr>';
                    $('#view_branches').children('tbody').append(trow);
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
                PosnicPro.setSelectedCheckbox(PosnicPro["branches_checkbox"], 'branches');
                PosnicPro.ACLForModule('branch');
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
        var loader = $(".loader-table-branch");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.dashboard.datePicker();
        PosnicPro.HideSideBarModal();
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $(".vertical-layout").removeClass("toggle-menu");
        $(".vertical-menu li a").removeClass("active");
        $('.page_loader,#osk-container').hide();
        $('.page-title-box,#branches').show();
        $('#branches_new,#branches_view').modal('hide');
        PosnicPro.branches.branchesTable('branches');
        $('#v-pills-manage-tab').addClass('active');
        $('#v-pills-manage').addClass('show active');
        $('.dashboard_img_menu').hide();
        $('#image_sidebar_branch').show();
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
                (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') ? $('#branch_title').text('திருத்தப்பட்ட') : $('#branch_title').text('Edit');
                (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') ? $('#branch_button_title').text('புதுப்பி') : $('#branch_button_title').text('Update');

                $('.update-button').attr('disabled', 'disabled').removeClass('btn-outline-success');
                PosnicPro.branches.sharingRow(false);
                $('#branch_view').modal('show');
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
        (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') ? $('#branch_title').text('புதிய') : $('#branch_title').text('Add');
//        $('#branch_button_title').text('Save');
        (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') ? $('#branch_button_title').text('சேமி') : $('#branch_button_title').text('Save');

        $('.update-button').attr('disabled', 'disabled').removeClass('btn-outline-success');
        $('#branch_id').val('');
        $('#branches_new .alert').remove();
        $('#show_last_created_branch').hide();
        PosnicPro.branches.sharingRow(true);
    },
    exportBranches: function () {
        PosnicPro.exportTableData(PosnicPro.branches_checkbox, 'branches');
    },
    deleteSelectedBranches: function () {
        PosnicPro.deleteTableData(PosnicPro.branches_checkbox, 'branches');
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
                window.intlTelInputGlobals.getInstance(document.querySelector("#branch_phone")).setCountry(response.data['countrySortName']);
            } else {
                $('#branch_state option:eq(0)').prop('selected', true);
                window.intlTelInputGlobals.getInstance(document.querySelector("#branch_phone")).setCountry(response.data['countrySortName']);
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
                    required: "Please enter a branch name",
                    minlength: "Branch name must be at least 3 characters",
                    maxlength: "Branch name is too long !"
                },
                phone: {
                    branch_phone_number: "Please enter a valid phone number.",
                    minlength: "Please enter at least 3 characters.",
                    maxlength: "Please enter no more than 20 characters."
                },
                address: {
                    required: "Please enter an address",
                    minlength: "Address must be at least 3 characters long",
                    maxlength: "Address is too long !"
                },
                email: {
                    required: "Please enter a email address",
                    maxlength: "Email should not be more than 250 Characters"
                },
                country: {
                    required: "Please choose your country"
                },
                state: {
                    required: "Please choose your state"
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
    PosnicPro.branches.branch_phone = window.intlTelInput(document.querySelector("#branch_phone"), {
        separateDialCode: true,
        preferredCountries: ['in'],
        hiddenInput: "full",
        utilsScript: "../static/script/js/utils.js"
    });
});
