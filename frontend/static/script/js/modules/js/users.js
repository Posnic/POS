PosnicPro.users = {
    userAction: 'add',
    showAdd: function () {
        var loader = $(".loader-user");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.HideSideBarModal();
        $(".infobar-settings-sidebar-overlay").css({"background": "transparent", "position": "initial"});
        $(".infobar-settings-sidebar").removeClass("sidebarshow");
        $('#accordionExample').show();
        PosnicPro.showAddModal('users');
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $(".vertical-layout").removeClass("toggle-menu");
        $(".vertical-menu li a").removeClass("active");
        $('#v-pills-manage-tab,.user_new_shortcut').addClass('active');
        $('#v-pills-manage').addClass('show active');
        $('.vertical-menu li a#view_users_page').addClass('active');
        PosnicPro.local.set("register_ids", '');
        var branch_id_set = PosnicPro.local.get('branch_id_set');
        //var branchId = [branch_id_set];
        $('#branchtype').select2('val', [branch_id_set]);
        $('.select2-container .select2-selection--multiple').css('min-height', '55px');
        PosnicPro.users.addUserButton();
        $('#user_reset').show();
        $('.user_edit_reset').hide();
        $('[data-toggle="tooltip"]').on('mouseleave', function () {
            $(this).tooltip('dispose');
        });
//        $("#choose_register").select2({
//            placeholder: "Select Register"
//        });
        if (PosnicPro.users.userAction === 'edit') {
            PosnicPro.users.userClearForm();
        }
        PosnicPro.users.userAction = 'add';
    },
    showEdit: function (id) {
        var loader = $(".loader-user");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.showEditModal('users');
        $('#v-pills-manage').addClass('show active');
        PosnicPro.users.editUser(id);
        $('#user_reset').hide();
        $('.user_edit_reset').show();
        $('.user_edit_reset').attr("id", id);
        PosnicPro.users.userAction = 'edit';
    },
    showDelete: function (id) {
        PosnicPro.deleteTableRowData(id, 'users');
    },
    showDetails: function (id) {
        var loader = $(".loader-view-user");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.showViewModal('users');
        PosnicPro.users.viewUser(id);
    },
    usersTable: function () {
        var loader = $(".loader-table-user");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        PosnicPro.appendViewDataTableBody('users');
        var table = $('#view_users');
        var params = {
            url: 'users',
            data: {
                page: table.data('current_page'),
                limit: parseInt($('#view_users_per_page  option:selected').text()),
                filters: table.data('filters')
            }
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                (response.data.total > 0) ? $('#userreport_exportbtn').removeAttr('disabled') : $('#userreport_exportbtn').attr('disabled', 'disabled');
                table.data('total', response.data.total);
                table.data('total_pages', response.data.total_pages);
                table.data('current_page', response.data.current_page);
                table.data('per_page', response.data.per_page);
                PosnicPro.paging(response.data.total_pages, response.data.current_page);
                table.children('tbody').text('');
                $('#view_users_total').text(response.data.total);
                var rowTotal = response.data.total;
                if (rowTotal === 0) {
                    $('.user_header').hide();
                    let dateRange = $('#view_sales_daterange span span[data-toggle="tooltip"]').attr('data-original-title');
                    $('.user_norecord').empty().append('<div class="text-center text-dark"> <p>No Records on ' + dateRange + ' </p></div>');
                    $('#user_img_hide,.user_norecord').show();
                } else {
                    $('.user_norecord').empty();
                    $('#user_img_hide,.user_norecord').hide();
                    $('.user_header').show();
                }

                var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                $('#view_users_page_total').text(row_total);
                var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                $('#view_users_page_perpage_total').text(page_totals + response.data.list.length);
                for (var i = 0; i < response.data.list.length; i++) {
                    var row = response.data.list[i];
                    var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                    if (row.activate === true) {
                        var activate = '<span class="badge badge-success-inverse">Active</span>';
                    } else {
                        var activate = '<span class="badge badge-danger-inverse">InActive</span>';
                    }

                    var process_class = '';
                    if (row.usertype == 'super_admin') {
                        process_class = "badge badge-success-inverse";
                    } else if (row.usertype == 'admin') {
                        process_class = "badge badge-primary-inverse";
                    } else {
                        process_class = "badge badge-info-inverse";
                    }

                    var edit_icon = '<a data-module = "user" data-access = "write" href="#/users/' + row._id + '/edit" data-id="users/' + row._id + '/edit"  data-toggle="tooltip" title="Edit User" class="point-cursor mobile_tooltip"><i class="feather icon-edit"></i></a>';
                    if (PosnicPro.local.get('userid') === row._id) {
                        edit_icon = '<span class="show_edit_icon" style="display:none;"></span>';
                    }
                    var action = '<div id="onclick-toolbar-options_' + i + '" class="hidden">' +
                            '<a data-module = "user" data-access = "read" href="#/users/' + row._id + '"  data-id="users/' + row._id + '"  data-toggle="tooltip" title="View User" class="point-cursor mobile_tooltip"><i class="feather icon-eye"></i></a>' +
                            '<span class="show_edit_icon" style="display:none;">' + edit_icon + ' </span>' +
                            '<a data-module = "user" data-access = "delete" href="#/users/' + row._id + '/delete" data-id="users/' + row._id + '/delete" data-toggle="tooltip" title="Delete User" class="point-cursor mobile_tooltip"><i class="feather icon-trash"></i></a>' +
                            '</div>' +
                            '<div data-toolbar="user-options" class="btn btn-round btn-primary-rgba round-pad" id="onclick-toolbar_' + i + '"><i class="feather icon-more-vertical-"></i></div>';
                    var image_path = (row.image !== "user.svg") ? row.image : 'static/images/default/' + row.image;
                    var trow = '<tr> <th><input type="checkbox" class="users-row-id" id="' + row._id + '" name="id[]" value="' + row._id + '" onclick="PosnicPro.checkboxSelectOne(this,\'users\');"></th> <th scope="row">' + row_no + '</th>  <td width="20%"><a href="#/users/' + row._id + '"><i class="table_model_item">' + row.username + '</i></a></td> <td class="sale_id"><img src=' + image_path + ' class="imagezoom table_img_alter" id="' + row.image + '" onclick="PosnicPro.viewImage(this.id,\'user\');"></td> <td class="sale_id" width="15%"><a class="sale_color" href="mailto:' + (row.email || '') + '">' + (row.email || '') + '</a></td> <td class="sale_id text-center"><span class="' + process_class + '">' + row.usertype + '</span></td><td class="text-center">' + activate + '</td>' +
                            '<td class="text-center"><span>' + action + '</span></td>' +
                            '</tr>';
                    $('#view_users').children('tbody').append(trow);
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
                PosnicPro.setSelectedCheckbox(PosnicPro["users_checkbox"], 'users');
                PosnicPro.ACLForModule('user');
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
        var loader = $(".loader-table-user");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.dashboard.datePicker();
        PosnicPro.HideSideBarModal();
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $(".vertical-layout").removeClass("toggle-menu");
        $(".vertical-menu li a").removeClass("active");
        $('.dropdown-item').removeClass('active');
        $('.page_loader,#osk-container').hide();
        $('.page-title-box,#users').show();
        $('#users_new,#users_view').modal('hide');
        PosnicPro.users.usersTable('users');
        $('#v-pills-manage-tab').addClass('active');
        $('#v-pills-manage').addClass('show active');
        $('.dashboard_img_menu').hide();
        $('#image_sidebar_user').show();
    },
    //This Users Function Used To Add & Edit
    user: function () {
        var loader = $(".loader-user");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        PosnicPro.action = 'add';
        var method = 'POST';
        var url = 'users';
        if ($('#logo_user').val() === '') {
            $('#logo_user').val('user.svg');
        }
        if ($('#users_id').val() !== '') {
            PosnicPro.action = 'edit';
            method = 'PUT';
            url += '/' + $('#users_id').val();
            if ($('#image_upload_file_user').val() === 'user.svg') {
                $('#logo_user').val($('#get_user_image_value').val());
            } else {
                $('#logo_user').val($('#image_upload_file_user').val());
            }
        }
        var appkey = $("#users_api").val();
        var key = {
            app_key: appkey
        };
        var selectBranch = $("#branchtype").select2('data');
        var branchData = [];
        $(selectBranch).each(function (index) {
            var branch_id = selectBranch[index].id;
            var branch_name = selectBranch[index].text;
            var branch_image = selectBranch[index].element.attributes['data-logo'].value;
            branchData.push({branch_id: branch_id, branch_name: branch_name, branch_image: branch_image});
        });
        var branchType = {
            branch_data: branchData
        };
        // Registers this user may operate (empty = all of the branch's
        // registers). Sent as explicit {register_id, register_name} pairs.
        var registerData = [];
        if ($('#choose_register').length) {
            $($("#choose_register").select2('data') || []).each(function (index, r) {
                registerData.push({ register_id: r.id, register_name: r.text });
            });
        }
        var registerType = { registers: registerData };
        var formData = PosnicPro.getFormData($('.user_add'));
        // The Till/POS actions matrix travels as an explicit object. With a role
        // selected the server resolves pos from the role and ignores this; for
        // "Custom" users it becomes their access.pos, so till gating never
        // depends on an absent (fail-open) pos object.
        var posType = $('#pos_actions_row').length ? { pos: PosnicPro.users.collectPosForm() } : {};
        var params = {
            method: method,
            url: url,
            data: JSON.stringify(Object.assign(formData, branchType, key, registerType, posType))
        };
        PosnicPro.request(params, function (response) {
            if (response.type === 'success') {
                PosnicPro.alert(response.type, response.message);
                PosnicPro.users.userClearForm();
                loader.find(".loadingSpinner:first").remove();
                $('#show_last_created_user').show();
                var path = '#/users/' + response.data;
                $('#last_created_user').attr('href', path);
                PosnicPro.users.usersTable('users');
                if (PosnicPro.action === 'edit') {
                    $(".infobar-settings-sidebar-overlay").css({"background": "transparent", "position": "initial"});
                    $("#infobar-settings-sidebar-users").removeClass("sidebarshow");
                    hasher.setHash('users');
                }
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
        return false;
    },
    /*view user details*/
    viewUser: function (id) {
        /*Condition To refresh checkbox*/
        $("input[name='user_admin_chk[]']:checkbox").removeAttr('checked');
        /*condition close*/
        var loader = $(".loader-view-user");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        PosnicPro.get('users/' + id, function (response) {
            if (response.type === 'success') {
                PosnicPro.users.viewUserData(response);
                PosnicPro.record_id = id;
                loader.find(".loadingSpinner:first").remove();
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    viewUserData: function (response) {
        $('#v-pills-manage').addClass('show active');
        $('.hide-username').show();
        $(".infobar-settings-sidebar-overlay").css({"background": "rgba(0,0,0,0.4)", "position": "fixed"});
        $("#infobar-settings-sidebar-users-details").addClass("sidebarview");
        $("#user-detail-tab").addClass("active");
        $("#user-sale-tab").removeClass("active");
        $("#user_detail").addClass("active show");
        $("#user_sale").removeClass("active show");
        var data = response.data;
        var branchAccess = [];
        var image_path = (data.image !== "user.svg") ? data.image : 'static/images/default/' + data.image;
        $('.userimageview').attr('src', image_path);
        $('.userimageview').attr('id', data.image);
        $('.userimageview').attr('onClick', 'PosnicPro.viewImage(this.id,\'user\')');
        for (var i = 0; i < data.branch_access.length; i++) {
            branchAccess.push(data.branch_access[i].branch_name);
        }
        var branchAccessText = (branchAccess.length === 0) ? 'No Branch Found' : branchAccess;
        // Linked registers (empty = all of the branch's registers).
        var regNames = $.map(data.registers || [], function (r) {
            return (r && r.register_name) || null;
        }).join(', ');
        $('#user_view_register_name').text(regNames || 'All registers');
        $.each(data, function (key, val) {
            if (val === '') {
                $('#user_view_' + key).text('');
            } else {
                $('.text-change-user').text('email');
                $('#user_view_' + key).text(val);
            }
        });
        if (data.usertype === 'api') {
            $('.text-change-user').text('apikey');
            $('#user_view_email').text(data.apikey);
            $('.hide-username').hide();
        }
        if (data.activate === true) {
            $('#user-access').removeClass('badge-danger').addClass('badge-success');
            $('#user-view-access').removeClass('fa-times').addClass('fa-check');
            $('#text-change-access-user').html('Active');
        } else {
            $('#user-access').removeClass('badge-success').addClass('badge-danger');
            $('#user-view-access').removeClass('fa-check').addClass('fa-times');
            $('#text-change-access-user').html('InActive');
        }
        $('#user_branch_type').text(branchAccessText);
        var registerAccess = [];
        if (data.registers !== null && data.registers.length > 0) {
            for (var i = 0; i < data.registers.length; i++) {
                registerAccess.push(data.registers[i].register_name);
            }
            var registerAccessText = registerAccess;
        } else {
            var registerAccessText = 'No Register Found';
        }
        $('#user_view_register_name').text(registerAccessText);
        var updateCreateDate = PosnicPro.convertDate(data.created_date);
        $('#user_view_created_date').text(updateCreateDate);
        var updateUpdateDate = PosnicPro.convertDate(data.updated_date);
        $('#user_view_updated_date').text(updateUpdateDate);
        $.each(data.access, function (page, val) {
            $.each(val, function (mode, access) {
                if (access === true) {
                    $('#user_' + page + '_' + mode + '_access').removeClass('badge-danger').addClass('badge-success');
                    $('#user_' + page + '_' + mode + '_chk').removeClass('fa-times').addClass('fa-check');
                } else {
                    $('#user_' + page + '_' + mode + '_access').addClass('badge-danger').removeClass('badge-success');
                    $('#user_' + page + '_' + mode + '_chk').addClass('fa-times').removeClass('fa-check');
                }
            });
        });
    },
    /*Edit user details*/
    editUser: function (id) {
        /*Condition To refresh checkbox*/
        $('#user_value_check').val('');
        // The RFID + wage controls apply to an existing user (edit mode). The
        // manager-PIN row shows only once we know the user can approve
        // (updatePinRowVisibility, after details load).
        $('#rfid_row, #wage_row').show();
        $('#manager_pin_row').hide();
        $('#user_manager_pin, #user_rfid_uid').val('');
        var loader = $(".loader-user");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        $('.onoffswitch-checkbox').removeAttr('checked');
        $('.update-button').attr('disabled', 'disabled').removeClass('btn-outline-success');
        /*condition close*/
        if ($('#update').is(":visible") !== 'true') {
            $('#update').show();
        }
        $(".infobar-settings-sidebar-overlay").css({"background": "rgba(0,0,0,0.4)", "position": "fixed"});
        $("#infobar-settings-sidebar-users").addClass("sidebarshow");
        $('.user-image-label-title').html('<i class="feather icon-edit-2 mr-2"></i>Edit Image');
        var params = {
            url: 'users/getUserDetails',
            data: {
                id: id
            }
        };
        PosnicPro.get(params, function (response) {
            loader.find(".loadingSpinner:first").remove();
            if (response.type === 'success') {
                $('#user_button_title,#submit_user_img').text('Update');
                $("#check_password").val('no');
                $('#users_new').modal('show');
                $('#admin_table').show();
                data = response.data;
                PosnicPro.record_id = id;
                $('#users_id').val(PosnicPro.record_id);
                $('#users_name').val(data.username);
                $('#users_firstname').val(data.firstname);
                $('#users_lastname').val(data.lastname);
                $('#users_email').val(data.email);
                $('#user_hourly_rate').val(data.hourly_rate || '');
                $('#targets_row').show();
                var st = data.sales_target || {};
                $('#user_target_daily').val(st.daily === null || st.daily === undefined ? '' : st.daily);
                $('#user_target_weekly').val(st.weekly === null || st.weekly === undefined ? '' : st.weekly);
                $('#user_target_monthly').val(st.monthly === null || st.monthly === undefined ? '' : st.monthly);
                $("#users_password,#users_retype_password").css({cursor: "not-allowed"}).attr('disabled', 'disabled');
                $("#users_password,#users_retype_password").val('Demo@000');
                $('#usertype').val(data.usertype);
                $('#hide_show_user_type').hide();
                $('#accordionExample').show();
                if (data.usertype === 'super_admin') {
                    $('#accordionExample').hide();
                    $('.icon-help-circle').show();
                } else {
                    $('.icon-help-circle').hide();
                }
                if (data.usertype === 'api') {
                    $('#app_name').val(data.username);
                    $('#users_api').val(data.apikey);
                    $('.hide_show_user_api').show();
                    $('.hide_show_user_password').hide();
                    // Don't set apiMethod radio here - it will trigger apiMethodAccess() which clears checkboxes
                    // We'll set it after populating access permissions
                    $('.adminAccessLabel').hide();
                    $('.apiAccessLabel').show();
                } else {
                    $('.hide_show_user_api').hide();
                    $('.hide_show_user_password').show();
                    $('#defaultMethod').prop('checked', true);
                    $('.adminAccessLabel').show();
                    $('.apiAccessLabel').hide();
                }

                var branchOption = [];
                $.each(data.branch_access, function (key, val) {
                    branchOption.push(val.branch_id.$oid);
                });
                $('#branchtype').select2('val', [branchOption]);
                //PosnicPro.getBranchRegisterList(branchOption);

                var registerOption = [];
                $.each(data.registers, function (key, val) {
                    var rid = val && val.register_id;
                    registerOption.push((rid && rid.$oid) || rid);
                });
                PosnicPro.local.set("register_ids", [registerOption]);
                // Fill the Choose Register options from the user's branches and
                // preselect their linked registers.
                PosnicPro.users.loadRegisterOptions(registerOption);
                if (data.activate === true) {
                    $('#ActiveMethod').prop('checked', true);
                    $('#InActiveMethod').prop('checked', false);
                } else {
                    $('#InActiveMethod').prop('checked', true);
                    $('#ActiveMethod').prop('checked', false);
                }
                // Populate access permissions BEFORE setting user type to prevent onclick from clearing them
                $.each(data.access, function (page, val) {
                    $.each(val, function (mode, access) {
                        if (access === true) {
                            $('#' + page + '_' + mode).prop('checked', true);
                            $('#' + page + '_' + mode).next('label').addClass('badge-success-inverse').removeClass('badge-danger-inverse');
                            if ($('.write-selectall,.delete-selectall').is(':checked')) {
                                var el = $('.write-selectall,.delete-selectall');
                                for (var i = 0; i < el.length; i++) {
                                    if ($(el[i]).is(":checked")) {
                                        var module = $(el[i]).data("id");
                                        $('#' + module + '_read').prop('checked', true).css({"cursor": "not-allowed", "pointer-events": "none"});
                                    }
                                }
                            }
                        } else {
                            $('#' + page + '_' + mode).prop('checked', false);
                            $('#' + page + '_' + mode).next('label').addClass('badge-danger-inverse').removeClass('badge-success-inverse');
                            $('#' + page + '_read').css({"cursor": "pointer", "pointer-events": "auto"});
                        }
                    });
                });
                
                // Show the user's current till permissions; if a role is
                // assigned, renderRoleOptions re-fills and locks them from the
                // role in a moment.
                PosnicPro.users.fillPosForm((data.access && data.access.pos) || {}, false);
                PosnicPro.users.updatePinRowVisibility();

                // Reflect the user's assigned role (if any) in the dropdown +
                // matrix; "Custom" (no role) leaves the boxes editable as before.
                PosnicPro.users.renderRoleOptions(data.role_id || '');

                // Update select-all checkboxes based on individual checkboxes
                var allReadChecked = $('.read-selectall:not(.read-selectall-only)').length === $('.read-selectall:not(.read-selectall-only):checked').length;
                var allWriteChecked = $('.write-selectall:not(.write-selectall_only)').length === $('.write-selectall:not(.write-selectall_only):checked').length;
                var allDeleteChecked = $('.delete-selectall:not(.delete-selectall_only)').length === $('.delete-selectall:not(.delete-selectall_only):checked').length;
                
                $('#all_read').prop('checked', allReadChecked);
                $('#all_write').prop('checked', allWriteChecked);
                $('#all_delete').prop('checked', allDeleteChecked);
                
                // Set user type radio buttons AFTER populating access permissions
                if (data.usertype === "admin" || data.usertype === "super_admin") {
                    $('.adminAccessLabel').show();
                    $('#adminUser').prop('checked', true);
                    $('#normalUser,#apiUser').prop('checked', false);
                    $('.apiAccessLabel,#select_all_checkbox').hide();
                } else if (data.usertype === 'api') {
                    $('.apiAccessLabel,#select_all_checkbox').show();
                    $('#apiUser').prop('checked', true);
                    $('#normalUser').prop('checked', false);
                    $('.adminAccessLabel').hide();
                    // Set flag to prevent apiMethodAccess from clearing checkboxes
                    PosnicPro.users._isEditingUser = true;
                    $('#apiMethod').prop('checked', true);
                    PosnicPro.users._isEditingUser = false;
                } else {
                    $('.adminAccessLabel,#select_all_checkbox').show();
                    $('#normalUser').prop('checked', true);
                    $('#adminUser,#apiUser').prop('checked', false);
                    $('.apiAccessLabel').hide();
                }
                (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') ? $('#user_title').text('திருத்தப்பட்ட') : $('#user_title').text('Edit');
                $('#image_upload_file_user').val(data.image);
                $('#get_user_image_value').val(data.image);
                $('#logo_user').val(data.image);
                $('#register_select_id').val(data.register_id);
                $('#register_select_name').val(data.register_name);
                var image_path = (data.image !== "user.svg") ? data.image : 'static/images/default/' + data.image;
                $('#user_image_upload').attr('src', image_path);
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    resetEditButton: function (id) {
        PosnicPro.users.editUser(id);
    },
    rolesCache: [],
    _escRole: function (s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (m) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m];
        });
    },
    // Load the register options for the currently selected branches into
    // #choose_register (union across branches, deduped), preselecting the
    // user's linked registers. Empty selection = no restriction (all).
    loadRegisterOptions: function (preselect) {
        var $sel = $('#choose_register');
        if (!$sel.length) { return; }
        if (!$sel.data('select2')) {
            $sel.select2({ placeholder: 'Select Register', width: '100%' });
        }
        var branches = $('#branchtype').select2('data') || [];
        var ids = $.map(branches, function (b) { return b.id; });
        $sel.empty();
        if (!ids.length) { $sel.trigger('change'); return; }
        var pending = ids.length;
        var seen = {};
        var finish = function () {
            if (--pending === 0) {
                $sel.val(preselect && preselect.length ? preselect : null).trigger('change');
            }
        };
        ids.forEach(function (branchId) {
            PosnicPro.get({
                url: 'branches/userRegisterBranchSelect',
                data: { id: branchId }
            }, function (res) {
                var rows = (res && res.data && res.data.register_data) || [];
                rows.forEach(function (r) {
                    if (!r.register_id || seen[r.register_id]) { return; }
                    seen[r.register_id] = true;
                    $sel.append('<option value="' + r.register_id + '">'
                        + PosnicPro.users._escRole(r.register_name || '') + '</option>');
                });
                finish();
            }, finish);
        });
    },
    // Load the tenant's roles into #user_role_id (GET /roles auto-seeds the
    // defaults), preselect one, and reflect it on the ACL matrix.
    renderRoleOptions: function (preselectId) {
        if (!$('#user_role_id').length) { return; }
        // getUserDetails returns ObjectIds in EJSON form ({$oid: '...'}); an
        // object never matches an <option> value, which showed an assigned role
        // as unset (and a save in that state would null the role out).
        if (preselectId && preselectId.$oid) { preselectId = preselectId.$oid; }
        PosnicPro.get('roles', function (res) {
            var roles = (res && res.data) || [];
            if (!Array.isArray(roles)) { roles = []; }
            PosnicPro.users.rolesCache = roles;
            var $sel = $('#user_role_id');
            $sel.find('option').not('[value=""]').remove();
            roles.forEach(function (r) {
                $sel.append('<option value="' + (r._id || r.id) + '">' +
                    PosnicPro.users._escRole(r.name) + '</option>');
            });
            $sel.val(preselectId || '');
            PosnicPro.users.applyRoleToForm($sel.val());
        });
    },
    // The granular till permissions shown on the user form. Mirrors
    // POS_PERMISSIONS in api/src/constants/roles.constants.js.
    POS_ACTION_KEYS: ['discount_apply', 'price_override', 'void_line', 'void_sale', 'refund',
        'reprint_receipt', 'no_sale_open_drawer', 'register_open', 'register_close',
        'cash_in_out', 'cash_drop', 'quick_sale'],
    // Fill the Till/POS Actions section from a pos object; locked = driven by a
    // role (read-only), unlocked = Custom (editable).
    fillPosForm: function (pos, locked) {
        if (!$('#pos_actions_row').length) { return; }
        pos = (pos && typeof pos === 'object') ? pos : {};
        PosnicPro.users.POS_ACTION_KEYS.forEach(function (k) {
            $('#pos_' + k).prop('checked', pos[k] === true);
        });
        $('#pos_discount_max_percent').val(pos.discount_max_percent != null ? pos.discount_max_percent : 0);
        $('#pos_refund_max_amount').val(pos.refund_max_amount != null ? pos.refund_max_amount : 0);
        $('.pos-action-box, #pos_discount_max_percent, #pos_refund_max_amount').prop('disabled', !!locked);
    },
    collectPosForm: function () {
        var pos = {};
        PosnicPro.users.POS_ACTION_KEYS.forEach(function (k) {
            pos[k] = $('#pos_' + k).is(':checked');
        });
        pos.discount_max_percent = Number($('#pos_discount_max_percent').val()) || 0;
        pos.refund_max_amount = Number($('#pos_refund_max_amount').val()) || 0;
        return pos;
    },
    // The Manager Approval PIN only means something for a user who can approve
    // (admin types, or a till permission that carries authority) - hide it
    // otherwise so a cashier's form stops suggesting they need one. Edit mode
    // only: a new user has no id to attach a PIN to yet.
    updatePinRowVisibility: function () {
        if (!$('#users_id').val()) { $('#manager_pin_row').hide(); return; }
        var isAdmin = $('#adminUser').is(':checked') ||
            ['super_admin', 'admin', 'owner', 'manager', 'store_manager']
                .indexOf(String($('#usertype').val() || '').toLowerCase()) !== -1;
        var canApprove = isAdmin ||
            $('#pos_void_sale').is(':checked') || $('#pos_refund').is(':checked') ||
            $('#pos_discount_apply').is(':checked');
        $('#manager_pin_row').toggle(!!canApprove);
    },
    // A chosen role fills the ACL matrix + POS actions (read-only) and replaces
    // the Admin/Normal/Api choice; "Custom" unlocks both for manual editing.
    applyRoleToForm: function (roleId) {
        var $boxes = $('.onoffswitch-checkbox');
        if (!roleId) {
            $boxes.prop('disabled', false).css({ 'pointer-events': 'auto', opacity: 1 });
            $('.userAccessLabel').show();
            $('.pos-action-box, #pos_discount_max_percent, #pos_refund_max_amount').prop('disabled', false);
            $('#pos_mgr_hint').text('Custom: tick exactly what this user may do without a manager.');
            PosnicPro.users.updatePinRowVisibility();
            return;
        }
        var role = (PosnicPro.users.rolesCache || []).filter(function (r) {
            return String(r._id || r.id) === String(roleId);
        })[0];
        if (!role || !role.access) { return; }
        $boxes.prop('checked', false);
        $.each(role.access, function (mod, val) {
            if (val && typeof val === 'object') {
                $.each(val, function (action, on) {
                    $('#' + mod + '_' + action).prop('checked', !!on);
                });
            }
        });
        $boxes.prop('disabled', true).css({ 'pointer-events': 'none', opacity: 0.7 });
        $('.userAccessLabel').hide();
        PosnicPro.users.fillPosForm(role.pos || {}, true);
        var mgr = role.requires_manager_approval;
        $('#pos_mgr_hint').text(Array.isArray(mgr) && mgr.length
            ? 'This role needs a manager’s approval for: ' + mgr.join(', ').replace(/_/g, ' ') + '.'
            : 'Set by the "' + (role.name || 'selected') + '" role.');
        PosnicPro.users.updatePinRowVisibility();
    },
    // Set (or replace) this user's manager-approval PIN. Only meaningful once the
    // user exists (edit mode), so the row is hidden when adding a new user.
    setManagerPin: function () {
        var userId = $('#users_id').val();
        if (!userId) {
            PosnicPro.alert('warning', 'Save the user first, then set a PIN.');
            return;
        }
        var pin = $('#user_manager_pin').val();
        if (!pin || !/^\d{4,8}$/.test(pin)) {
            PosnicPro.alert('warning', 'Enter a 4 to 8 digit PIN.');
            return;
        }
        $('#user_manager_pin_btn').prop('disabled', true);
        var done = function () { $('#user_manager_pin_btn').prop('disabled', false); };
        PosnicPro.post({
            url: 'authorizations/set-manager-pin',
            data: JSON.stringify({ user_id: userId, pin: pin }),
        }, function (response) {
            done();
            PosnicPro.alert(response.type, response.message);
            if (response.type === 'success') { $('#user_manager_pin').val(''); }
        }, function () { done(); });
    },
    // Assign / clear this user's RFID swipe card (edit mode only).
    _postRfid: function (cardUid) {
        var userId = $('#users_id').val();
        if (!userId) {
            PosnicPro.alert('warning', 'Save the user first, then assign a card.');
            return;
        }
        $('#user_rfid_btn,#user_rfid_clear_btn').prop('disabled', true);
        var done = function () { $('#user_rfid_btn,#user_rfid_clear_btn').prop('disabled', false); };
        PosnicPro.post({
            url: 'authorizations/set-rfid',
            data: JSON.stringify({ user_id: userId, card_uid: cardUid }),
        }, function (response) {
            done();
            PosnicPro.alert(response.type, response.message);
            if (response.type === 'success') { $('#user_rfid_uid').val(''); }
        }, function () { done(); });
    },
    setRfid: function () {
        var card = $('#user_rfid_uid').val();
        if (!card || !card.trim()) {
            PosnicPro.alert('warning', 'Swipe or type a card, then Assign.');
            return;
        }
        PosnicPro.users._postRfid(card.trim());
    },
    clearRfid: function () {
        PosnicPro.users._postRfid('');
    },
    // Save this user's hourly wage for the payout report (edit mode only).
    setRate: function () {
        var userId = $('#users_id').val();
        if (!userId) {
            PosnicPro.alert('warning', 'Save the user first, then set a wage.');
            return;
        }
        var rate = $('#user_hourly_rate').val();
        if (rate === '' || isNaN(rate) || Number(rate) < 0) {
            PosnicPro.alert('warning', 'Enter a valid wage (0 or more).');
            return;
        }
        $('#user_wage_btn').prop('disabled', true);
        var done = function () { $('#user_wage_btn').prop('disabled', false); };
        PosnicPro.post({
            url: 'shifts/set-rate',
            data: JSON.stringify({ user_id: userId, hourly_rate: Number(rate) }),
        }, function (response) {
            done();
            PosnicPro.alert(response.type, response.message);
        }, function () { done(); });
    },
    // Save this user's sales targets (LS1) - edit mode only, like the wage.
    setTargets: function () {
        var userId = $('#users_id').val();
        if (!userId) {
            PosnicPro.alert('warning', 'Save the user first, then set targets.');
            return;
        }
        $('#user_targets_btn').prop('disabled', true);
        var done = function () { $('#user_targets_btn').prop('disabled', false); };
        PosnicPro.post({
            url: 'shifts/set-targets',
            data: JSON.stringify({
                user_id: userId,
                daily: $('#user_target_daily').val(),
                weekly: $('#user_target_weekly').val(),
                monthly: $('#user_target_monthly').val()
            }),
        }, function (response) {
            done();
            PosnicPro.alert(response.type, response.message);
        }, function () { done(); });
    },
    addUserButton: function () {
        var loader = $(".loader-user");
        loader.find(".loadingSpinner:first").remove();
        // A new user has no id yet, so the manager-PIN + RFID + wage controls can't apply.
        $('#manager_pin_row, #rfid_row, #wage_row, #targets_row').hide();
        $('#user_manager_pin, #user_rfid_uid, #user_hourly_rate').val('');
        (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') ? $('#user_title').text('புதிய') : $('#user_title').text('Add');
        $('.user-image-label-title').html('<i class="feather icon-plus-circle mr-2"></i>Add Image');
        $('#user_button_title,#submit_user_img').text('Save');
        $("#users_password,#users_retype_password").css({cursor: "auto"}).removeAttr('disabled');
        $('.update-button').attr('disabled', 'disabled').removeClass('btn-outline-success');
        $("#check_password").val('yes');
        $('.icon-help-circle').hide();
        $('#show_last_created_user').hide();
        $('#users_id').val('');
        $('#logo_user').val('user.svg');
        // New user: start the till permissions from nothing - what you tick is
        // exactly what they get (a picked role overrides this).
        PosnicPro.users.fillPosForm({}, false);
        $('#choose_register').empty().trigger('change');
        PosnicPro.users.renderRoleOptions('');
        if (document.getElementById('apiMethod').checked) {
            $('#apiMethod').prop('checked', true);
            $('.adminAccessLabel').hide();
            $('.hide_show_user_api').show();
            $('.apiAccessLabel').show();
            $('.hide_show_user_password').hide();
        } else {
            $('#defaultMethod').prop('checked', true);
            $('.hide_show_user_api').hide();
            $('.adminAccessLabel').show();
            $('.apiAccessLabel').hide();
            $('.hide_show_user_password').show();
        }
    },
    exportUsers: function () {
        PosnicPro.exportTableData(PosnicPro.users_checkbox, 'users');
    },
    deleteSelectedUsers: function () {
        PosnicPro.deleteTableData(PosnicPro.users_checkbox, 'users');
    },
    userForm: function () {
        if ($('#user_value_check').val() !== '' && $('#branchtype option:selected').length > 0) {
            var data = new FormData(document.getElementById("user_form_upload"));
            PosnicPro.requestImage('POST', "users/uploadUserImage", data, false, function (response) {
                if (response.type === 'success') {
                    var imgdata = response.data.replace(/\s/g, '');
                    $('#logo_user').val(imgdata);
                    $("#user_image_upload").html(response.data);
                    $('#image_upload_file_user').val(response.data);
                    PosnicPro.users.user();
                } else {
                    PosnicPro.alert(response.type, response.message);
                }
            });
        } else {
            PosnicPro.users.user();
        }
        return false;
    },
    /*user access details store in Localstorage*/
    insertLocalStorage: function (resultData) {
        var getdata = resultData.data;
        $.each(getdata, function (index, val) {
            PosnicPro.local.set(index, val);
        });
    },
    /*Reset forget password  */
    forgotPassword: function () {
        var email = $("#email").val();
        if (email !== '') {
            if (PosnicPro.validateEmail(email)) {
                var params = {
                    url: 'setting/forgotPassword',
                    data: JSON.stringify({email: email})
                };
                PosnicPro.post(params, function (response) {
                    PosnicPro.alert(response.type, response.message);
                    $("#email").val('');
                }, function (xhr) {
                    var response = jQuery.parseJSON(xhr.responseText);
                    PosnicPro.alert(response.type, response.message);
                });
            } else {
                $('#email').focus();
                PosnicPro.alert('error', 'Enter a valid email address.');
            }
        } else {
            $('#email').focus();
            PosnicPro.alert('error', 'Fill in the required fields.');
        }
    },

    /*
     * One way to fill a register dropdown, everywhere one exists.
     *
     * The server annotates each register with who holds it right now
     * (in_use / in_use_by / in_use_by_me), so the screen can say "in use by
     * Priya" BESIDE THE NAME instead of letting the cashier pick it, type a
     * float, press Open and only then meet the session lock. Selecting an
     * in-use register shows a note under the select; opening your OWN open
     * register is fine (the server resumes the session) and says so.
     */
    fillRegisterSelect: function ($selects, list) {
        var html = '';
        for (var i = 0; i < list.length; i++) {
            var row = list[i];
            var name = row.register_name;
            var suffix = '';
            if (row.in_use && row.in_use_by_me) suffix = ' — your open session';
            else if (row.in_use) suffix = ' — in use' + (row.in_use_by ? ' by ' + row.in_use_by : '');
            html += '<option id="' + row.register_id + '" value="' + row.register_id + '"' +
                ' data-inuse="' + (row.in_use ? '1' : '') + '"' +
                ' data-inuseby="' + $('<span>').text(row.in_use_by || '').html() + '"' +
                ' data-mine="' + (row.in_use_by_me ? '1' : '') + '">' +
                $('<span>').text(name + suffix).html() +
                '</option>';
        }
        $selects.each(function () {
            var $sel = $(this);
            $sel.html(html);
            var $note = $sel.parent().find('.register-inuse-note');
            if (!$note.length) {
                $note = $('<div class="register-inuse-note" style="display:none;"></div>');
                $sel.after($note);
            }
            var update = function () {
                var $opt = $sel.find(':selected');
                if ($opt.data('inuse') && !$opt.data('mine')) {
                    var who = $opt.data('inuseby');
                    $note.text('Already open' + (who ? ' by ' + who : ' on another till') +
                        '. Choose another register, or ask them to close it first.')
                        .show();
                } else if ($opt.data('mine')) {
                    $note.text('This is your open session - opening will resume it.').show();
                } else {
                    $note.hide();
                }
            };
            $sel.off('change.inuse').on('change.inuse', update);
            update();
        });
    },

    selectedRegisterActiveBranchUser: function (id) {
        var params = {
            url: 'branches/userRegisterBranchSelect',
            data: {id: id}
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                var data = response.data;
                $('#containerbar_sso').show();
                $('#login_form').hide();
                $('#Branch_selection_form').hide();

                /*
                 * The cash-register module is optional (Settings > Modules).
                 * Off = no register ceremony at login: straight to selling.
                 * The flag rides the server response because localStorage is
                 * not populated yet on a fresh browser at this point.
                 */
                if (data.cash_register_enable === false) {
                    PosnicPro.local.set('userRegisterStatus', 'Closed');
                    PosnicPro.local.set('cash_register_id', '');
                    PosnicPro.local.set('register_id', '');
                    PosnicPro.local.set('branch_has_no_registers', 'true');
                    $('.loginform_card').hide();
                    PosnicPro.users.createCookie('loginuser', 'yes', 1);
                    window.location = 'dashboard.html#/dashboard';
                    return;
                }

                // Check if there's an open register in database
                if (data.open_register && data.open_register.register_status === 'Opened') {
                    // Load existing open register to local storage and IndexedDB
                    PosnicPro.local.set('cash_register_id', data.open_register.cash_register_id);
                    PosnicPro.local.set('register_id', data.open_register.register_id);
                    PosnicPro.local.set('register_name', data.open_register.register_name);
                    PosnicPro.local.set('userRegisterStatus', 'Open');
                    
                    db.currentregister.put({
                        id: '1', 
                        register_id: data.open_register.register_id, 
                        register_name: data.open_register.register_name, 
                        register_status: 'open'
                    });
                    
                    // Continue to dashboard without showing modal
                    $('.loginform_card').hide();
                    PosnicPro.users.createCookie('loginuser', 'yes', 1);
                    window.location = 'dashboard.html#/dashboard';
                } else if (data.register_data.length > 0) {
                    // No open register - show modal to select one
                    let loader = $(".loader-login");
                    loader.find(".loadingSpinner:first").remove();
                    $('#registerselect_form').show();
                    PosnicPro.users.fillRegisterSelect($('.choose_register_model'), data.register_data);
                } else {
                    // No registers for this branch
                    $('.cashRegisterModule').remove();
                    PosnicPro.local.set('Registerstatus', 'Closed');
                    PosnicPro.local.set('RegisterId', '');
                    $('.loginform_card').hide();
                    PosnicPro.users.createCookie('loginuser', 'yes', 1);
                    window.location = 'dashboard.html#/dashboard';
                }
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    loginregisterSelectFormSubmit: function () {
        let registerName = $('#choose_register_model').find(":selected").text();
        let registerId = $('#choose_register_model option:selected').val();
        let registerNameType = {
            register_name: registerName,
            register_Id: registerId,
            opening_float: $('#opening_float').val()
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
                PosnicPro.local.set('hourAlertregister', 'false');
                $('.loginform_card').hide();
                PosnicPro.users.createCookie('loginuser', 'yes', 1);
                window.location = 'dashboard.html#/dashboard';
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        });
    },
    //    register cashregister open again 
    cashregisterOpenForm: function () {
        let registerName = $('#choose_register_model').find(":selected").text();
        let registerId = $('#choose_register_model option:selected').val();
        let registerNameType = {
            register_name: registerName,
            register_Id: registerId,
            opening_float: $('#closingopening_float').val()
        };
        let params = {
            method: 'POST',
            url: 'registers/registerAdd',
            data: JSON.stringify(Object.assign(registerNameType))
        };
        PosnicPro.request(params, function (response) {
            if (response.type === 'success') {
                db.currentregister.put({id: '1', register_id: registerId, register_name: registerName, register_status: 'open'});
                // The sale payload sends cash_register_id, and the server only
                // accepts the session THIS open created (session locking). The
                // login-path open sets these; this path forgot to, so sales
                // went out with a stale session id and were refused with
                // "register is already open on another device".
                PosnicPro.local.set('cash_register_id', response.data);
                PosnicPro.local.set('register_id', registerId);
                PosnicPro.local.set('register_name', registerName);
                PosnicPro.local.set('userRegisterStatus', 'Open');
                PosnicPro.local.set('hourAlertregister', 'false');
                PosnicPro.users.registerMenuDetails();
                PosnicPro.alert(response.type, response.message);
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        });
        return false;
    },
    registerMenuDetails: function () {
        // A browser that has never opened a register here simply has no
        // currentregister record - which is exactly the case for admins, who
        // skip register selection at login. That used to fall through to a
        // catch that REMOVED the whole Cash Register menu: the people who
        // administer the tills were the ones the menu vanished for, until
        // the next full reload. No record is the 'closed' state, not an error.
        var renderClosed = function () {
            $('.register_details_data').hide();
            $('#close_register_card').show();
            $(".register_details_visibledata").hide();

            // Load registers for the current branch immediately
            let id = PosnicPro.local.get("branch_id_set");
            var params = {
                url: 'branches/userRegisterBranchSelect',
                data: {id: id}
            };
            PosnicPro.get(params, function (response) {
                if (response.type === 'success' && response.data.register_data.length > 0) {
                    PosnicPro.users.fillRegisterSelect(
                        $('#choose_register_model'), response.data.register_data);
                }
                if (PosnicPro.registers && PosnicPro.registers.renderOverview) {
                    PosnicPro.registers.renderOverview(response && response.data);
                }
            });
        };
        db.currentregister.get('1').then(function (data) {
            if (data && data.register_status === 'open') {
                $('.register_details_data').show();
                $('#close_register_card').hide();
                $(".register_details_visibledata").show();
                PosnicPro.registers.cashReportRegister(data.register_id);
            } else {
                renderClosed();
            }
        }).catch(function (err) {
            // A storage hiccup must degrade to the closed view, never take
            // the menu away.
            console.error('currentregister lookup failed:', err);
            renderClosed();
        });
    },

    /*User Selected Branch will OPen*/
    selectedUserBranchDisplay: function (id) {
        var params = {
            url: 'users/userDefaultBranchSet',
            data: {id: id}
        };
        PosnicPro.get(params, function (response) {
            PosnicPro.local.set("branch_id_set", response.data.branch_id);
            PosnicPro.local.set('branchname', response.data.branch_name);
            PosnicPro.local.set('branchimage', response.data.branch_logo);
            PosnicPro.local.set('customerName', response.data['customer_name']);
            PosnicPro.local.set('customerPhone', response.data['customer_phone']);
            PosnicPro.local.set('customerEmail', response.data['customer_email']);
            PosnicPro.local.set('customerAddress', response.data['customer_address']);
            var customerRecord = [];
            customerRecord.push({name: response.data['customer_name'], phone: response.data['customer_phone'], email: response.data['customer_email'], address: response.data['customer_address']});
            db.customerDisplay.add({id: '1', 'clear': 'no', 'get': 'no', customer: customerRecord});
            var branchRecord = [];
            branchRecord.push({name: response.data.branch_name, phone: response.data.branch_phone, email: response.data.branch_email, address: response.data.branch_address, image: response.data.branch_logo});
            db.customerDisplay.add({id: '2', 'clear': 'no', 'get': 'no', branch: branchRecord});
            db.currentbranch.put({id: '1', branch_id: response.data.branch_id, branch_name: response.data.branch_name, user_id: response.data.user_id});
            db.saleAutoFocus.add({id: '1', branch_id: response.data.branch_id, addSale: true, editSale: true, holdSale: true});
            db.recevingAutoFocus.add({id: '1', branch_id: response.data.branch_id, addReceiving: true, editReceiving: true});

            db.currentregister.get('1').then(function (data) {
                if (data.register_status === 'close') {
                    PosnicPro.users.selectedRegisterActiveBranchUser(response.data.branch_id);
                } else {
                    PosnicPro.users.createCookie('loginuser', 'yes', 1);
                    window.location = 'dashboard.html#/dashboard';
                }
            }).catch(function () {
                PosnicPro.users.selectedRegisterActiveBranchUser(response.data.branch_id);
            });
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    userVerify: function () {
        $('.user_verify').show();
        $('.hideconfirm').hide();
    },
    /* Turn a failed sign-in into something the cashier can act on. The old
       handler parsed the body without a guard and let the page reload, so a
       wrong password looked exactly like nothing happening. */
    showLoginError: function (xhr) {
        var box = $('#login_error');
        var body = (xhr && xhr.responseJSON) || null;
        if (!body && xhr && xhr.responseText) {
            try {
                body = JSON.parse(xhr.responseText);
            } catch (e) {
                body = null;
            }
        }
        var message;
        if (!xhr || xhr.status === 0) {
            // No product name here on purpose. JavaScript is never rebranded
            // for a white-label build, because PosnicPro.js holds the pattern
            // that does the rebranding at runtime. A named service would put
            // our name in front of a customer's staff at the one moment
            // something has already gone wrong.
            message = 'Cannot reach the service. Please wait for the application to finish starting, then try again.';
        } else if (body && body.data === 'incorrect') {
            message = 'Username or password is incorrect. Please check and try again.';
        } else if (body && body.data === 'inactive') {
            message = body.message || 'This account is inactive. Please contact your administrator.';
        } else if (body && Array.isArray(body.data) && body.data.length) {
            message = body.data.join(' ');
        } else if (body && body.message) {
            message = body.message;
        } else {
            message = 'Sign-in failed (error ' + xhr.status + '). Please try again.';
        }
        if (box.length) {
            box.html(message).show();
        } else {
            PosnicPro.alert('error', message);
        }
        $('#password').val('').focus();
    },
    /*Login username and password check*/
    loginCheck: function () {
        var loader = $(".loader-login");
        $('#login_error').hide().html('');
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        var username = $('#username').val();
        var password = $('#password').val();
        if (username !== '') {
            if (password !== '') {
                var params = {
                    url: 'users/verify',
                    data: JSON.stringify({
                        username: username,
                        password: password
                    })
                };
                PosnicPro.post(params, function (response) {
                    if (response.type === 'success') {
                        // Store JWT token for Electron authentication
                        if (response.data.jwt_token && navigator.userAgent.indexOf('Electron') !== -1) {
                            localStorage.setItem('posnic_jwt_token', response.data.jwt_token);
                            console.log('JWT token stored for Electron authentication');
                        }
                        
                        db.customerPlan.put({id: '1', read: response.data['userACLPlan']});
                        PosnicPro.users.createCookie('loginuser', '', -1);
                        PosnicPro.local.set('userid', response.data['sid']);
                        PosnicPro.local.set('userfirstname', response.data['firstname']);
                        PosnicPro.local.set('userlastname', response.data['lastname']);
                        PosnicPro.local.set('username', response.data['user_name']);
                        PosnicPro.local.set('userimage', response.data['user_image']);
                        PosnicPro.local.set('usertype', response.data['usertype']);
                        PosnicPro.local.set('branchimage', response.data['branch_image']);
                        PosnicPro.local.set('branchname', response.data['branch_name']);
                        PosnicPro.local.set('branchphone', response.data['branch_phone']);
                        PosnicPro.local.set('branchemail', response.data['branch_email']);
                        PosnicPro.local.set('branchaddress', response.data['branch_address']);
                        PosnicPro.local.set('timezone', response.data['branch_timezone']);
                        PosnicPro.local.set('timeformat', response.data['branch_timeformat']);
                        PosnicPro.local.set('currencySign', response.data['currency_type']);
                        PosnicPro.local.set('userplan', response.data['plan']);
                        PosnicPro.users.insertLocalStorage(response);
                        PosnicPro.local.set('countryStateStorage', '');
                        PosnicPro.local.set('useBranchForm', true);
                        PosnicPro.local.set('language', '');
                        /*
                         * Remember who, never the password.
                         *
                         * This used to write the password itself into a cookie
                         * in the clear, readable by anything with access to the
                         * machine's profile and carried on every request to the
                         * API. Remembering the name is what the checkbox is for
                         * and what every other application means by it - the
                         * saving is the typing, and the password was never the
                         * long part.
                         *
                         * The stale password cookie is cleared either way, so a
                         * machine that stored one before this change is cleaned
                         * up the next time anybody signs in on it.
                         */
                        PosnicPro.users.createCookie('password', "", -1);
                        if ($('#rememberme').is(":checked")) {
                            PosnicPro.users.createCookie('username', username, 30);
                        } else {
                            PosnicPro.users.createCookie('username', "", -1);
                        }
                        $('.loader').show();
                        $("#body").addClass("body");
//                        if (response.data['branchCount'] === 1 || response.data['usertype'] === 'super_admin') 

                        db.currentbranch.get('1').then(function (data) {
                            if (data.user_id === response.data['sid']) {
                                $(response.data['print_type']).each(function (index, val) {
                                    if (data.branch_id === val.branch_id.$oid) {
                                        PosnicPro.local.set('print_type', val.printing_design);
                                        PosnicPro.local.set('printing_max_char', val.printing_max_char);
                                        PosnicPro.local.set('printing_size', val.printing_size);
                                    }
                                });
                                PosnicPro.local.set("branch_id_set", data.branch_id);
                                PosnicPro.local.set('branchname', data.branch_name);
                                PosnicPro.users.selectedUserBranchDisplay(data.branch_id);
//                                loader.find(".loadingSpinner:first").remove();
                                var loader = $(".loader-login");
                                $("<div class='loadingSpinner'></div>").appendTo(loader);
                            } else {
                                PosnicPro.users.selectedBranch(response);
                            }
                        }).catch(function () {
                            PosnicPro.users.selectedBranch(response);
                        });

                    } else {
                        $('#user_img_show').attr('src', 'static/images/default/user.svg');
                        PosnicPro.alert(response.type, response.message);
                    }
                }, function (xhr) {
                    loader.find(".loadingSpinner:first").remove();
                    $(".loadingSpinner").remove();
                    PosnicPro.users.showLoginError(xhr);
                    return false;
                });
            } else {
                $('#password').focus();
                PosnicPro.alert('error', 'Please enter password');
            }
        } else {
            $('#username').focus();
            PosnicPro.alert('error', 'Please enter username');
        }
    },
    selectedBranch: function (response) {
        if (response.data['branchCount'] === 1) {
            $(response.data['print_type']).each(function (index, val) {
                if (response.data['branchId'] === val.branch_id.$oid) {
                    PosnicPro.local.set('print_type', val.printing_design);
                    PosnicPro.local.set('printing_size', val.printing_size);
                    PosnicPro.local.set('printing_max_char', val.printing_max_char);
                }
            });
            PosnicPro.local.set("branch_id_set", response.data['branchId']);
            PosnicPro.local.set('branchname', response.data['branch_name']);
            PosnicPro.local.set('branchimage', response.data['branch_image']);
            PosnicPro.users.selectedUserBranchDisplay(response.data['branchId']);
        } else {
            $('#containerbar_sso').show();
            $('#login_form,#forgotslide').hide();
            $('#Loginslide,#Branch_selection_form').show();
            $('.formhead').html('Choose Branch');
            PosnicPro.get('users/userBranchSelection', function (response) {
                PosnicPro.useBranchList = true;
                var data = response.data;
                var i;
                $('.multi_branch_selection').html('');
                for (i = 0; i < data.branch_id.length; ++i) {
                    var row = data.branch_id[i];
                    var image_path = (row.branch_image !== "store.png") ? row.branch_image : 'static/images/default/' + row.branch_image;
                    var details = '<div class="col-6"><span id="' + row.branch_access + '" data-print="' + row.printing_design + '" data-printmaxchr="' + row.printing_max_char + '" data-printsize="' + row.printing_size + '" onclick="PosnicPro.users.userAccessBranch(this);" style="cursor:pointer;"><div class="account-box" style="height:266px;"><img class="img-fluid" style="height:184px;" src="' + image_path + '">' +
                            '<h5>' + row.branch_name + '</h5></div></span></div>';
                    $('.multi_branch_selection').append(details);
                }
            });
        }
    },
    userAccessBranch: function (element) {
        var id = $(element).attr("id");
        PosnicPro.local.set('print_type', $(element).data("print"));
        PosnicPro.local.set('printing_size', $(element).data("printsize"));
        PosnicPro.local.set('printing_max_char', $(element).data("printmaxchr"));
        PosnicPro.users.selectedUserBranchDisplay(id);
        PosnicPro.local.set("branch_id_set", id);
    },
    logoutCheck: function () {
        PosnicPro.get('users/logOut', function (response) {
            if (response.type === 'success') {
                let loader = $(".loader-login");
                $("<div class='loadingSpinner'></div>").appendTo(loader);
                localStorage.removeItem("dropdown-menu");
                localStorage.removeItem("dropdown-submenu");
                localStorage.removeItem("dropdown-href");
                PosnicPro.local.set("branch_id_set", '');
                PosnicPro.local.set('userfirstname', '');
                PosnicPro.local.set('userlastname', '');
                PosnicPro.local.set('username', '');
                PosnicPro.local.set('userimage', '');
                PosnicPro.local.set('usertype', '');
                PosnicPro.local.set('branchimage', '');
                PosnicPro.local.set('branchname', '');
                PosnicPro.local.set('branchphone', '');
                PosnicPro.local.set('branchemail', '');
                PosnicPro.local.set('branchaddress', '');
                PosnicPro.local.set('timezone', '');
                PosnicPro.local.set('timeformat', '');
                PosnicPro.local.set('currencySign', '');
                PosnicPro.local.set('countryStateStorage', '');
                PosnicPro.local.set('useBranchForm', '');
                PosnicPro.local.set('print_type', '');
                PosnicPro.local.set('printing_max_char', '');
                PosnicPro.local.set('printing_size', '');
                PosnicPro.local.set('customerName', '');
                PosnicPro.local.set('customerPhone', '');
                PosnicPro.local.set('customerEmail', '');
                PosnicPro.local.set('customerAddress', '');
                PosnicPro.local.set('hourAlertregister', 'false');
                PosnicPro.local.set('language', '');
                PosnicPro.local.set('outstandingModalShown', ''); // Clear outstanding modal flag
                // Clear JWT token on logout
                if (navigator.userAgent.indexOf('Electron') !== -1) {
                    localStorage.removeItem('posnic_jwt_token');
                    console.log('JWT token cleared on logout');
                }

                /*
                 * A deliberate logout forgets the PIN too.
                 *
                 * Logging out has to mean something, and if a PIN still opened
                 * the till afterwards it would not. The way back in after this
                 * is the password, which is the whole distinction: a PIN
                 * resumes a session, a password creates one.
                 */
                if (PosnicPro.lockScreen) {
                    var lockUser = PosnicPro.local.get('username');
                    if (lockUser) PosnicPro.lockScreen.forget(lockUser);
                }
                PosnicPro.users.createCookie('loginuser', '', -1);
                window.location.href = "login.html?msg=You%20have%20been%20logged%20out!&type=information";
            }
        });
    },
    /*To set checkboxes on*/
    userAdminAccess: function () {
        $("#checkbox_error").text("").removeClass('error');
        var usertype = $('#adminUser').val();
        $('#admin_table').show();
        $('#select_all_checkbox').hide();
        if (usertype === 'admin' || usertype === 'super_admin') {
            $('.onoffswitch-checkbox').prop('checked', true).css({"cursor": "not-allowed", "pointer-events": "none"});
            $('.onoffswitch-checkbox-userreport').prop('checked', false).css({"cursor": "not-allowed", "pointer-events": "none"});
            $('.active_user_access_class').addClass('badge badge-success-inverse').removeClass('badge badge-danger-inverse');
        }
    },
    /*To set checkboxes off*/
    userNormalAccess: function () {
        var usertype = $('#normalUser').val();
        $('#admin_table').show();
        $('#select_all_checkbox').show();
        if (usertype === 'normal') {
            $('.onoffswitch-checkbox,.read-selectall-only,.read-selectall,.write-selectall,.delete-selectall').prop('checked', false).css({"cursor": "pointer", "pointer-events": "auto"});
            $('.onoffswitch-checkbox-userreport').prop('checked', true).css({"cursor": "not-allowed", "pointer-events": "none"});
            $('.active_user_access_class').addClass('badge badge-danger-inverse').removeClass('badge badge-success-inverse');
        }
    },
    /*To set checkboxes off*/
    userApiAccess: function () {
        var usertype = $('#apiUser').val();
        $('#admin_table').show();
        if (usertype === 'api') {
            $('#select_all_checkbox').show();
            $('.onoffswitch-checkbox').prop('checked', false).css({"cursor": "pointer", "pointer-events": "auto"});
            $('.onoffswitch-checkbox-userreport').prop('checked', true).css({"cursor": "not-allowed", "pointer-events": "none"});
            $('.active_user_access_class').addClass('badge badge-danger-inverse').removeClass('badge badge-success-inverse');
        }
    },
    defaultMethodAccess: function () {
        $('#apiUser').prop('checked', false);
        $('#normalUser').prop('checked', true);
        $('.onoffswitch-checkbox').prop('checked', false).css({"cursor": "pointer", "pointer-events": "auto"});
        $('.onoffswitch-checkbox-userreport').prop('checked', true).css({"cursor": "not-allowed", "pointer-events": "none"});
        $('.active_user_access_class').addClass('badge badge-danger-inverse').removeClass('badge badge-success-inverse');
        $('.hide_show_user_api,.apiAccessLabel').hide();
        $('.hide_show_user_password,.adminAccessLabel').show();
    },
    apiMethodAccess: function () {
        // Don't clear checkboxes if we're editing an existing user
        if (PosnicPro.users._isEditingUser) {
            return;
        }
        $('#select_all_checkbox').show();
        $('#adminUser,#normalUser').prop('checked', false);
        $('#apiUser').prop('checked', true).css({"cursor": "pointer", "pointer-events": "auto"});
        $('.onoffswitch-checkbox').prop('checked', false).css({"cursor": "pointer", "pointer-events": "auto"});
        $('.active_user_access_class').addClass('badge badge-danger-inverse').removeClass('badge badge-success-inverse');
        $('.hide_show_user_api,.apiAccessLabel').show();
        $('.hide_show_user_password,.adminAccessLabel').hide();
        PosnicPro.users.generateApiKey();
    },
    /*profile user image upload form*/

    profileImageFormSubmit: function () {
        if ($('#name_users').val() !== '') {
            var file_data = $("#profile_file").prop("files")[0];
            var data = new FormData();
            data.append("ImageUser", file_data);
            PosnicPro.requestImage('POST', "users/uploadUserImage", data, false, function (response) {
                if (response.type === 'success') {
                    let username = $('#editableusername').text();
                    let lastname = $('#editablelastname').text();
                    PosnicPro.users.updateUserImage(response.data, username, lastname);
                }
                PosnicPro.alert(response.type, response.message);
            });
            return false;
        }
    },
    updateUserImageform: function () {
        var id = PosnicPro.local.get('sid');
        PosnicPro.get('users/' + id, function (response) {
            if (response.type === 'success') {
                $(".infobar-settings-sidebar-overlay").css({"background": "rgba(0,0,0,0.4)", "position": "fixed"});
                $("#infobar-settings-sidebar-profile-details").addClass("sidebarview");
                var data = response.data;
                $('#profile_value_check').val('');
                $('.profile_username').val(data.firstname).html(data.firstname);
                $('#editableusername').editable('setValue', data.firstname);
                $('#editablelastname').editable('setValue', data.lastname);
                $('.profile_useremail').val(data.email).html(data.email);
                var image_path = (data.image !== "user.svg") ? data.image : 'static/images/default/' + data.image;
                $('#profile_image_upload').attr('src', image_path).width('205px').height('160px');
                $('#get_profile_image_value').val(data.image);
                $.each(data.access, function (page, val) {
                    $.each(val, function (mode, access) {
                        if (access === true) {
                            $('#' + page + '_' + mode + '_access').removeClass('badge-danger').addClass('badge-success');
                            $('#' + page + '_' + mode + '_chk').removeClass('fa-times').addClass('fa-check');
                        }
                    });
                });
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        });
    },
    /*Update user image here*/
    updateUserImage: function (user_img, username, lastname) {
        var params = {
            url: 'users/userProfile',
            data: JSON.stringify({
                image: user_img,
                name: username,
                lastname: lastname
            })
        };
        PosnicPro.post(params, function (response) {
            if (response.type === 'success') {
                var data = response.data;
                var image_path = (data.imagename !== "user.svg") ? data.imagename : 'static/images/default/' + data.imagename;
                $('.profile-img').attr('src', image_path);
                $("#user-image").attr('src', image_path);
                var nameSet = data.firstname + ' ' + data.lastname;
                PosnicPro.local.set('userimage', data.imagename);
                PosnicPro.local.set('userfirstname', response.data['firstname']);
                PosnicPro.local.set('userlastname', response.data['lastname']);
                $('.user-name').html(nameSet);
                $('#profile_img').modal('hide');
                $('#profile_value_check').val('');
                PosnicPro.alert(response.type, response.message);
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    removePopupUserImage: function () {
        $('#deleteUserImagePopup').modal('show');
    },
    removeProfileImage: function () {
        var image_value = $('#get_profile_image_value').val();
        var params = {
            url: 'users/userImageDelete',
            data: JSON.stringify({data: image_value})
        };
        PosnicPro.delete(params, function (response) {
            if (response.type === 'success') {
                var image_path = 'static/images/default/user.svg';
                $('#profile_image_upload,#user-image').attr('src', image_path);
                $('#get_profile_image_value').val('user.svg');
                PosnicPro.local.set('userimage', 'user.svg');
                $('#profile_value_check').val('');
                $('#deleteUserImagePopup').modal('hide');
            }
            PosnicPro.alert(response.type, response.message);
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    removeUserImage: function () {
        var image_value = $('#get_user_image_value').val();
        var id = $('#users_id').val();
        var params = {
            url: 'users/userImageDelete',
            data: JSON.stringify({data: image_value, id: id})
        };
        PosnicPro.delete(params, function (response) {
            if (response.type === 'success') {
                var image_path = 'static/images/default/user.svg';
                $('#user_image_upload,#user-image,#profile_image_upload').attr('src', image_path);
                $('#get_user_image_value,#image_upload_file_user,#logo_user').val('user.svg');
                PosnicPro.local.set('userimage', 'user.svg');
                $('#user_value_check').val('');
            }
            PosnicPro.alert(response.type, response.message);
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    changeUserPassword: function () {
        var regexPassword = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{5,20}$/;
        var new_password = $('#retype_new_password').val();
        var confirm_password = $('#update_new_password').val();
        if ((regexPassword.test(confirm_password)) && (regexPassword.test(new_password))) {
            if (new_password === confirm_password) {
                var params = {
                    url: 'users/updateNewPassword',
                    data: JSON.stringify(PosnicPro.getFormData($('#forgotpassword_form')))
                };
                PosnicPro.put(params, function (resultData) {
                    if (resultData.type === 'success') {
                        PosnicPro.alert(resultData.type, resultData.message);
                        setTimeout(function () {
                            location.href = "login.html";
                        }, 1000);
                    } else if (resultData.type === 'exist') {
                        PosnicPro.alert('error', resultData.message);
                        setTimeout(function () {
                            location.href = "error-404.html";
                        }, 1000);
                    } else {
                        PosnicPro.alert(resultData.type, resultData.message);
                    }
                });
            } else {
                PosnicPro.alert('error', 'Passwords do not match.');
                $('#update_new_password').focus();
            }
        } else {
            PosnicPro.alert('error', 'Fill in the required fields.');
        }
    },
    /*Change user account password*/
    changePassword: function () {
        var regexPassword = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{5,20}$/;
        var confirm_password = $('#confirm_password').val();
        var new_password = $('#new_password').val();
        if ((regexPassword.test(confirm_password)) && (regexPassword.test(new_password))) {

            var params = {
                url: 'setting/changePassword',
                data: JSON.stringify(PosnicPro.getFormData($('#changed_password')))
            };
            PosnicPro.post(params, function (response) {
                if (response.type === 'success') {
                    $('#changePasswordView').modal('toggle');
                    $('#password_new').modal('hide');
                    $('#session-timeout-dialog').modal('show');
                    $.sessionTimeout({
                        message: '',
                        keepAliveUrl: 'dashboard.html',
                        redirUrl: 'logout.html',
                        warnAfter: 5000, // 5 Seconds 
                        redirAfter: 5010, // 20 Seconds 
                        ignoreUserActivity: true,
                        countdownMessage: 'Redirecting in 5 seconds.',
                        countdownBar: true,
                        onRedir: function () {
                            PosnicPro.users.logoutCheck()
                        }
                    });
                }
                PosnicPro.alert(response.type, response.message);
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
            return false;
        }
    },
    createCookie: function (name, value, days) {
        var expires;
        if (days) {
            var date = new Date();
            date.setTime(date.getTime() + (days * 30 * 24 * 60 * 60 * 1000));
            expires = "; expires=" + date.toGMTString();
        } else {
            expires = "";
        }
        document.cookie = encodeURIComponent(name) + "=" + encodeURIComponent(value) + expires + "; path=/";
    },
    readCookie: function (name) {
        var nameEQ = encodeURIComponent(name) + "=";
        var ca = document.cookie.split(';');
        for (var i = 0; i < ca.length; i++) {
            var c = ca[i];
            while (c.charAt(0) === ' ')
                c = c.substring(1, c.length);
            if (c.indexOf(nameEQ) === 0)
                return decodeURIComponent(c.substring(nameEQ.length, c.length));
        }
        return null;
    },
    generateApiKey: function () {
        var date = new Date().getTime();
        if (window.performance && typeof window.performance.now === "function")
        {
            date += performance.now();
        }

        var apikey = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'.replace(/[xy]/g, function (c)
        {
            var r = (date + Math.random() * 16) % 16 | 0;
            date = Math.floor(date / 16);
            return (c == 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
        $('#users_api').val(apikey);
    },
    clickNormalForm: function () {

        $(".user_add").validate({
            errorClass: 'error error_users',
            highlight: function (element, errorClass) {
                $(element).css("border-color", "#f9616d");
            },
            unhighlight: function (element, errorClass) {
                $(element).css("border-color", "#eae8e8");
            },
            rules: {
                firstname: {
                    required: true,
                    lettersonly: true,
                    minlength: 3,
                    maxlength: 20

                },
                lastname: {
                    lettersonly: true,
                    minlength: 3,
                    maxlength: 20

                },
                name: {
                    required: true,
                    maxlength: 30,
                    username: true

                },
                password: {
                    required: true,
                    maxlength: 20
                },
                retype_password: {
                    required: true,
                    maxlength: 20,
                    equalTo: "#users_password"
                },
                branch_id: {
                    required: true
                },
                email: {
                    required: true,
                    maxlength: 250
                },
                usertype: {
                    required: true
                }
            },
            messages: {
                firstname: {
                    required: "Please Enter a Firstname",
                    minlength: "Firstname must be at least 3 Characters",
                    maxlength: "Firstname should not be more than 20 characters"
                },
                lastname: {
                    required: "Please Enter a Lastname",
                    minlength: "Last Name must be at least 3 Characters",
                    maxlength: "Lastname should not be more than 20 characters"
                },
                name: {
                    required: "Please Enter the UserName",
                    minlength: "UserName must be at least 6 Characters",
                    maxlength: "UserName should not be more than 30 characters"
                },
                password: {
                    required: "Please Enter a Password",
                    minlength: "Password must be at least 5 characters",
                    maxlength: "Password should not be more than 20 characters"
                },
                retype_password: {
                    required: "Please Enter the Retype Password",
                    minlength: "Password must be at least 5 characters",
                    maxlength: "Password should not be more than 20 characters",
                    equalTo: "Not match retype Password"
                },
                email: {
                    required: "Please Enter the Email",
                    minlength: "Password must be at least 5 characters",
                    maxlength: "Password should not be more than 20 characters"
                },
                branch_id: {
                    required: "Please Select a Branch"
                },
                usertype: {
                    required: "Please Choose a User Type"
                }
            }
        });
        jQuery.validator.addMethod("lettersonly", function (value, element) {
            return this.optional(element) || /^[a-z\s]+$/i.test(value);
        }, "Please Enter a Valid Name");
        if ($('.user_add').valid()) {            // checks form for validity
            var checked = $(".onoffswitch-checkbox:checked").length;
            if (checked > 0) {
                $("#checkbox_error").text("").removeClass('error');
                PosnicPro.users.userForm();
            } else {
                $("#checkbox_error").text("You must check at least 1 box").addClass('error');
            }
        }
    },
    clickApiForm: function () {
        $("#app_name,#users_api").on('keyup', function () {
            if ($("#app_name").val().length >= 3) {
                $("#app_name").css('border-color', 'rgba(0,0,0,0.03)');
                $("#error_app_name").hide();
            }
            if ($("#users_api").val().length >= 30) {
                $("#users_api").css('border-color', 'rgba(0,0,0,0.03)');
                $("#error_users_api").hide();
            }
        });
        if ($("#app_name").val() !== '' || $("#users_api").val() !== '') {

            if ($("#app_name").val().length <= 2) {
                $("#error_app_name").show();
                $("#error_app_name").html('<label for="app_name" class="error" style="">App Name must be at least 3 Characters</label>');
                $("#app_name").css('border-color', 'rgb(249, 97, 109)').focus();
            } else if ($("#users_api").val().length <= 29) {
                $("#error_users_api").show();
                $("#error_users_api").html('<label for="app_name" class="error" style="">Api key must be at least 30 Characters</label>');
                $("#users_api").css('border-color', 'rgb(249, 97, 109)').focus();
            } else {
                $("#error_app_name,#error_users_api").hide();
                var checked = $(".onoffswitch-checkbox:checked").length;
                if (checked > 0) {
                    $("#checkbox_error").text("").removeClass('error');
                    PosnicPro.users.userForm();
                } else {
                    $("#checkbox_error").text("You must check at least 1 box").addClass('error');
                }

            }
        } else {

            if ($("#app_name").val() === '') {
                $("#error_app_name").show();
                $("#error_app_name").html('<label for="app_name" class="error" style="">App Name must be at least 3 Characters</label>');
                $("#app_name").css('border-color', 'rgb(249, 97, 109)').focus();
            }
            if ($("#users_api").val() === '') {
                $("#error_users_api").show();
                $("#error_users_api").html('<label for="app_name" class="error" style="">Api key must be at least 30 Characters</label>');
                $("#users_api").css('border-color', 'rgb(249, 97, 109)').focus();
            }
        }
    },
    userClearForm: function () {
        $("#branchtype").select2({
            placeholder: "Select branch"
        });
//        $("#choose_register > option").prop("selected", false);
//        $("#choose_register").select2({
//            placeholder: "Select Register"
//        });
        PosnicPro.local.set("register_ids", '');
        var branch_id_set = PosnicPro.local.get('branch_id_set');
        $('#branchtype').select2('val', [branch_id_set]);
        //var branchId = [branch_id_set];
        //PosnicPro.getBranchRegisterList(branchId);
        $("#user_image_upload").attr('src', 'static/images/default/user.svg');
        $('#logo_user').val('user.svg');
        $('.password_clear').val('');
        $(".user-text-clear").val('');
        $('#normalUser').prop('checked', true);
        $('#defaultMethod').prop('checked', true);
        $('#admin_table').hide();
        $('#users_id').val('');
        $('#user_value_check').val('');
        $(".hide_show_user_api,.apiAccessLabel").hide();
        $(".hide_show_user_password,.adminAccessLabel").show();
        $('.onoffswitch-checkbox,.read-selectall-only,.read-selectall,.write-selectall,.delete-selectall').prop('checked', false).css({"cursor": "pointer", "pointer-events": "auto"});
        $('.read-selectall-label,.write-selectall-label,.delete-selectall-label').addClass('badge-danger-inverse');
        $('.read-selectall-label,.write-selectall-label,.delete-selectall-label,.write-select-only-label').removeClass('badge-success-inverse');
        $('#ActiveMethod').prop('checked', true);
        $('.error_users').css('display', 'none');
    },
    accountGoToWebsiteURL: function () {
        var params = {
            url: 'users/ssoClientLogin'
        };
        PosnicPro.post(params, function (response) {
            var data = response.data;
            window.open(data, '_blank');
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    }
};
PosnicPro.usersdetails = {

    usersdetailsTable: function (type) {
        PosnicPro.appendReportTableBody('usersdetails');
        var loader = $(".loader-useractivity");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        var table = $('#view_usersdetails');
        if ($('a#view_users_page').hasClass('active')) {
            var branch = [];
            branch.push(PosnicPro.local.get("branch_id_set"));
        } else {
            var branch = $("#user_branch_value").val()
        }
        if (type === 'userreportexport') {
            var per_page = table.data('total');
        } else {
            var current_page = table.data('current_page');
            var per_page = $('#view_usersdetails_per_page').val();
        }
        let user_id = currentHash.split('/');
        var data = {
            page: current_page,
            limit: per_page,
            user_id: user_id[1],
            branch: branch
        };
        var params = {
            url: 'sales/userSalesDetails',
            data: data
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                if (type !== 'userreportexport') {
                    table.data('total', response.data.table.data.total);
                    table.data('total_pages', response.data.table.data.total_pages);
                    table.data('current_page', response.data.table.data.current_page);
                    table.data('per_page', response.data.table.data.per_page);
                    PosnicPro.paging(response.data.table.data.total_pages, response.data.table.data.current_page);
                    table.children('tbody').text('');
                    $('#view_usersdetails_total,.users_details_noofsale').text(response.data.table.data.total);
                    var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                    $('#view_usersdetails_page_total').text(row_total);
                    var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                    $('#view_usersdetails_page_perpage_total').text(page_totals + response.data.table.data.list.length);
                    var currency = PosnicPro.local.get('currencySign');
                    var rowTotal = response.data.table.data.total;
                    if (rowTotal === 0) {
                        $('.useractivity_content').hide();
                        $('#useractivity_img_hide').show();
                    } else {
                        $('#useractivity_img_hide').hide();
                        $('.useractivity_content').show();
                    }
                    for (var i = 0; i < response.data.table.data.list.length; i++) {
                        var row = response.data.table.data.list[i];
                        var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                        var updateDate = PosnicPro.convertDate(row.string_date);
                        var trow = '<tr> <td scope="row">' + row_no + '</td> <td>' + row.sales_id + '</td> <td class="export-date">' + updateDate + '</td> <td class="text-right">' + currency + '&nbsp;<span class="number">' + row.sales_total + '</span></td></tr>';
                        $('#view_usersdetails').children('tbody').append(trow);
                        $('span.number').number(true, 2);
                    }
                    var total = 0;
                    if (response.data.total.length !== 0) {
                        total = response.data.total[0];
                    }
                    $('.users_details_totalsale').number(total, 2);
                    $('.users_details_avgsale').html('0.00');
                    if (total > 0) {
                        var avg = (total / response.data.table.data.total);
                        $('.users_details_avgsale').number(avg, 2);
                    }
                } else {
                    var usersalesreport = [];
                    data = response.data.table.data.list;
                    $(data).each(function (key, val) {
                        var date = PosnicPro.convertDate(val.string_date);
                        var Date = date;
                        var Salesid = val.sales_id;
                        var Total = val.sales_total;
                        usersalesreport.push({SalesId: Salesid, Date: Date, Amount: Total});
                    });
                    PosnicPro.JSONToCSVConvertor(usersalesreport, 'user-sales-reports', true);
                    PosnicPro.usersdetails.usersdetailsTable();
                }
            }
            loader.find(".loadingSpinner:first").remove();
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    userdetailsreportexport: function (index) {
        var type = $(index).data('id');
        PosnicPro.usersdetails.usersdetailsTable(type);
    }
};
$(".onoffswitch-checkbox").click(function () {
    $("#checkbox_error").text("").removeClass('error');
    if ($("#adminUser").is(":checked")) {
        $(this).prop('checked', true).css({"cursor": "not-allowed", "pointer-events": "none"});
        $('.active_user_access_class').addClass('badge-success-inverse').removeClass('badge-danger-inverse');
        return false;
    }
    $('#all_read, #all_write, #all_delete').prop('checked', false);
    if ($('.read-selectall:checked').length == $('.read-selectall').length) {
        $('#all_read').prop('checked', true);
    } else {
        $('#all_read').prop('checked', false);
    }
    if ($(this).is(':checked')) {
        $(this).next('label').addClass('badge-success-inverse').removeClass('badge-danger-inverse');
        var module = $(this).data("id");
        var readSelectVal = $('input:checkbox.read-selectall:checked').length;
        (readSelectVal == '11') ? $('.read-selectall-only').prop('checked', true) : $('.read-selectall-only').prop('checked', false);
        var writeSelectVal = $('input:checkbox.write-select_only:checked').length;
        var deleteSelectVal = $('input:checkbox.delete-select_only:checked').length;
        (deleteSelectVal == '7') ? $('.delete-selectall_only').prop('checked', true) : $('.delete-selectall_only').prop('checked', false);
        (writeSelectVal == '7') ? $('.write-selectall_only').prop('checked', true) : $('.write-selectall_only').prop('checked', false);
        if ($('#' + module + '_write').is(':checked') || $('#' + module + '_delete').is(':checked')) {
            $('#' + module + '_read').prop('checked', true).css({"cursor": "not-allowed", "pointer-events": "none"});
            $('#' + module + '_read').next('label').addClass('badge-success-inverse').removeClass('badge-danger-inverse');
        }
    } else {
        var readSelectVal = $('input:checkbox.read-selectall:checked').length;
        (readSelectVal == '11') ? $('.read-selectall-only').prop('checked', true) : $('.read-selectall-only').prop('checked', false);
        var writeSelectVal = $('input:checkbox.write-select_only:checked').length;
        var deleteSelectVal = $('input:checkbox.delete-select_only:checked').length;
        (deleteSelectVal == '7') ? $('.delete-selectall_only').prop('checked', true) : $('.delete-selectall_only').prop('checked', false);
        (writeSelectVal == '7') ? $('.write-selectall_only').prop('checked', true) : $('.write-selectall_only').prop('checked', false);
        $(this).next('label').addClass('badge-danger-inverse').removeClass('badge-success-inverse');
        var module = $(this).data("id");
        if ($('#' + module + '_write').is(':unchecked') && $('#' + module + '_delete').is(':unchecked')) {
            $('#' + module + '_read').css({"cursor": "pointer", "pointer-events": "auto"});
        }
    }

});
$('#all_read').click(function () {
    $("#checkbox_error").text("").removeClass('error');
    if ($(this).is(':checked')) {
        $('.read-selectall,.read-selectall-only').prop('checked', true);
        $('.read-selectall-label').addClass('badge-success-inverse').removeClass('badge-danger-inverse');
        if ($('.delete-selectall').is(':checked') || $('.write-selectall').is(':checked')) {
            var el = $('.delete-selectall,.write-selectall');
            for (var i = 0; i < el.length; i++) {
                if ($(el[i]).is(":checked")) {
                    var module = $(el[i]).data("id");
                    $('#' + module + '_read').prop('checked', true).css({"cursor": "not-allowed", "pointer-events": "none"});
                    $('#' + module + '_read').next('label').addClass('badge-success-inverse').removeClass('badge-danger-inverse');
                }
            }
        }
    } else {
        $('.read-selectall,.read-selectall-only').prop('checked', false);
        $('.read-selectall-label').css({"cursor": "not-allowed", "pointer-events": "none"});
        $('.read-selectall-label').removeClass('badge-success-inverse').addClass('badge-danger-inverse');
        if ($('.delete-selectall').is(':checked') || $('.write-selectall').is(':checked')) {
            var el = $('.read-selectall,.delete-selectall,.write-selectall');
            for (var i = 0; i < el.length; i++) {
                if ($(el[i]).is(":checked")) {
                    var module = $(el[i]).data("id");
                    $('#' + module + '_read').prop('checked', true).css({"cursor": "not-allowed", "pointer-events": "none"});
                    $('#' + module + '_read').next('label').addClass('badge-success-inverse').removeClass('badge-danger-inverse');
                }
            }
            var ml = $('.read-selectall');
            for (var i = 0; i < ml.length; i++) {
                if ($(ml[i]).is(":checked")) {
                } else {
                    var module = $(ml[i]).data("id");
                    $('#' + module + '_read').prop('checked', false).css({"cursor": "pointer", "pointer-events": "auto"});
                }
            }
        }
    }
});
$('#all_write').click(function () {
    $("#checkbox_error").text("").removeClass('error');
    if ($(this).is(':checked')) {
        $('.write-selectall').prop('checked', true);
        $('.write-selectall-label').addClass('badge-success-inverse').removeClass('badge-danger-inverse');
        $('.write-select-only').css({"cursor": "pointer", "pointer-events": "auto"});
        if ($('.write-selectall').is(':checked')) {
            var el = $('.write-selectall');
            for (var i = 0; i < el.length; i++) {
                if ($(el[i]).is(":checked")) {
                    var module = $(el[i]).data("id");
                    $('#' + module + '_read').prop('checked', true).css({"cursor": "not-allowed", "pointer-events": "none"});
                    $('#' + module + '_read').next('label').addClass('badge-success-inverse').removeClass('badge-danger-inverse');
                }
            }
        }

    } else {
        $('.write-selectall').prop('checked', false);
        $('.write-selectall-label').removeClass('badge-success-inverse').addClass('badge-danger-inverse');
        if ($('.delete-selectall').is(':checked')) {
            var el = $('.delete-selectall');
            for (var i = 0; i < el.length; i++) {
                if ($(el[i]).is(":checked")) {
                    var module = $(el[i]).data("id");
                    $('#' + module + '_read').prop('checked', true).css({"cursor": "not-allowed", "pointer-events": "none"});
                    $('#' + module + '_read').next('label').addClass('badge-success-inverse').removeClass('badge-danger-inverse');
                }
            }
        }

    }
});
$('#all_delete').click(function () {
    $("#checkbox_error").text("").removeClass('error');
    if ($(this).is(':checked')) {
        $('.delete-selectall').prop('checked', true);
        $('.delete-selectall-label').addClass('badge-success-inverse').removeClass('badge-danger-inverse');
        if ($('.delete-selectall').is(':checked')) {
            var el = $('.delete-selectall');
            for (var i = 0; i < el.length; i++) {
                if ($(el[i]).is(":checked")) {
                    var module = $(el[i]).data("id");
                    $('#' + module + '_read').prop('checked', true).css({"cursor": "not-allowed", "pointer-events": "none"});
                    $('#' + module + '_read').next('label').addClass('badge-success-inverse').removeClass('badge-danger-inverse');
                }
            }
        }
    } else {
        $('.delete-selectall').prop('checked', false);
        $('.delete-selectall-label').removeClass('badge-success-inverse').addClass('badge-danger-inverse');
        if ($('.write-selectall').is(':checked')) {
            var el = $('.write-selectall');
            for (var i = 0; i < el.length; i++) {
                if ($(el[i]).is(":checked")) {
                    var module = $(el[i]).data("id");
                    $('#' + module + '_read').prop('checked', true).css({"cursor": "not-allowed", "pointer-events": "none"});
                    $('#' + module + '_read').next('label').addClass('badge-success-inverse').removeClass('badge-danger-inverse');
                }
            }
        }
    }
});
$('.write-selectall_only,.delete-selectall_only').click(function () {
    if ($('#all_write').is(':unchecked') && $('#all_delete').is(':unchecked')) {
        var module = $(this).data("id");
        var el = $('.write-selectall,.delete-selectall');
        for (var i = 0; i < el.length; i++) {
            if ($(el[i]).is(":unchecked")) {
                var module = $(el[i]).data("id");
                $('#' + module + '_read').css({"cursor": "pointer", "pointer-events": "auto"});
            }
        }
    }
});
$('input[name="user_admin_chk[]"]').click(function () {
    if (!$(this).is(':checked')) {
        return false;
    } else {
        return false;
    }
});
$(document).ready(function () {
    $('.select2-container .select2-selection--multiple').css('min-height', '55px');
    $("#changed_password").validate({
        highlight: function (element, errorClass) {
            $(element).css("border-color", "#f9616d");
        },
        unhighlight: function (element, errorClass) {
            $(element).css("border-color", "#eae8e8");
        },
        errorPlacement: function (error, element) {
            var placement = element.closest('.input-group');
            if (!placement.get(0)) {
                placement = element;
            }
            placement.after(error);
        },
        rules: {
            old_password: {
                required: true
            },
            new_password: {
                required: true,
                minlength: 5,
                strong_password: true,
                maxlength: 20
            },
            confirm_password: {
                required: true,
                minlength: 5,
                maxlength: 20,
                equalTo: "#new_password"
            }
        },
        messages: {
            old_password: {
                required: "Enter Your Current Password"
            },
            new_password: {
                required: "Enter New Password",
                minlength: "Password must be at least 5 characters",
                maxlength: "Password should not be more than 20 characters"
            },
            confirm_password: {
                required: "Enter Confirm Password",
                minlength: "Password must be at least 5 characters",
                maxlength: "Password should not be more than 20 characters",
                equalTo: "Not match confirm Password"
            }
        }
    });
    $("#changed_password").submit(function (event) {
        event.preventDefault();
        if ($('#changed_password').valid()) {            // checks form for validity
            PosnicPro.users.changePassword();
        }
    });
    if ($("#user_access").is(":checked")) {
        $("#usersAccess").val(true);
        $("#active_class_add").addClass('badge badge-success-inverse');
        $("#deactive_class_add").removeClass('badge badge-danger-inverse');
    } else {
        $("#usersAccess").val(false);
        $("#deactive_class_add").addClass('badge badge-danger-inverse');
        $("#active_class_add").removeClass('badge badge-success-inverse');
    }

    $("#user_access").click(function () {
        var checked = $("#user_access").attr('checked');
        if (checked) {
            $("#usersAccess").val(false);
            $("#user_access").attr('checked', false);
            $("#deactive_class_add").addClass('badge badge-danger-inverse');
            $("#active_class_add").removeClass('badge badge-success-inverse');
        } else {
            $("#usersAccess").val(true);
            $("#user_access").attr('checked', true);
            $("#active_class_add").addClass('badge badge-success-inverse');
            $("#deactive_class_add").removeClass('badge badge-danger-inverse');
        }

    });
    $(".uploadprofileimage").validate({
        highlight: function (element, errorClass) {
            $(element).css("border-color", "#f9616d");
        },
        unhighlight: function (element, errorClass) {
            $(element).css("border-color", "#eae8e8");
        },
        rules: {
            name_users: {
                required: true,
                minlength: 3,
                maxlength: 20
            }
        },
        messages: {
            name_users: {
                required: "Please Enter a Name",
                minlength: "Name must be at least 3 characters",
                maxlength: "Name should not be more than 20 characters"
            }
        }
    });
    $(".uploadprofileimage").submit(function (event) {
        event.preventDefault();
        if ($('.uploadprofileimage').valid()) {            // checks form for validity
            if ($('#profile_value_check').val() !== '') {
                PosnicPro.users.profileImageFormSubmit();
            } else {
                let image = $('#get_profile_image_value').val();
                let username = $('#editableusername').text();
                let lastname = $('#editablelastname').text();
                PosnicPro.users.updateUserImage(image, username, lastname);
            }

        }
    });
});
// The user editor is a drawer, not a modal, so its controls are wired
// directly: the Choose Register options track the selected branches -
// picking or removing a branch reloads them (keeping current picks).
$(document).on('change', '#branchtype', function () {
    PosnicPro.users.loadRegisterOptions($('#choose_register').val() || []);
});
$('#panel-collapse').find('.panel-default:has(".in")').addClass('panel-primary');
$('#panel-collapse').on('show.bs.collapse', function (e) {
    $(e.target).closest('.panel-default').addClass(' panel-primary');
    $('.collapse').collapse('hide');
}).on('hide.bs.collapse', function (e) {
    $(e.target).closest('.panel-default').removeClass(' panel-primary');
});
$("#users_password").on("input", function () {
    $("#check_password").val('yes');
});
$(function () {
    $('#search_user_name').autocomplete({
        deferRequestBy: 120,
        lookup: function (query, done) {
            var result = {};
            var suggestions = [];
            var params = {
                url: 'users/getUserAjaxList',
                data: 'query=' + query
            };
            PosnicPro.get(params, function (response) {
                suggestions: $.map(response.suggestions, function (dataItem) {
                    suggestions.push({"value": dataItem.name, "data": dataItem});
                });
                result["suggestions"] = suggestions;
                done(result);
            }, function (xhr) {
                var response = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(response.type, response.message);
            });
        },
        autoSelectFirst: true,
        onSelect: function (suggestion) {
            $('#search_user_id').val(suggestion.data.userid);
            $('#search_register_id').val(suggestion.data.registerid);
            $('#search_register_name').val(suggestion.data.registername);
        }
    });
});
$('#upload_file_user').change(function () {
    $('#get_user_image_value').val(this.files && this.files.length ? this.files[0].name.split('.')[0] : '');
    $('#image_upload_file_user').val(this.files[0].name);
    $('#user_value_check').val(this.files[0].name);
});
$('#profile_file').change(function () {
    $('#profile_value_check').val(this.files[0].name);
});
$("#password_close").click(function (element, errorClass) {
    var validator = $("#changed_password").validate();
    validator.resetForm();
    $('.pass_valid').css("border-color", "#eae8e8");
});
$("#clicksubmit").click(function () {
    var usertype = $("input[name='usertype']:checked").val();
    if (usertype !== 'api') {
        $(".user_add").submit();
        PosnicPro.users.clickNormalForm();
    } else {
        PosnicPro.users.clickApiForm();
    }
});
$('#click_collapse').click(function () {
    $(this).find('#change_collapse_icon').toggleClass('feather icon-chevron-down feather icon-chevron-up');
});
$('#branchtype').on("select2:select", function () {
    PosnicPro.local.set("register_ids", '');
//    var branchId = $("#branchtype").val();
//    PosnicPro.getBranchRegisterList(branchId);
}).trigger('change');
$('#branchtype').on("select2:unselect", function () {
    PosnicPro.local.set("register_ids", '');
//    var branchId = $("#branchtype").val();
//    PosnicPro.getBranchRegisterList(branchId);
}).trigger('change');
$(document).ready(function () {
    $('.onoffswitch-checkbox,.read-selectall-only,.read-selectall,.write-selectall,.delete-selectall').prop('checked', false);
    $('.read-selectall-label,.write-selectall-label,.delete-selectall-label').addClass('badge-danger-inverse');
});
$('.userimageview').click(function () {
    $('#user_img_popup').modal('show');
});
/*end*/
