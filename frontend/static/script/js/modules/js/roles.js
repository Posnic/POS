/*
 * Roles admin screen (#/roles): list, create, clone, edit and delete the
 * tenant's roles. A role is a reusable permission set - the module access
 * matrix plus the granular till (POS) actions - assigned to users on the user
 * form. Editing a role recomputes every assigned user's access server-side.
 * Gated by the `user` permission, same as the rest of staff management.
 */
PosnicPro.roles = {
    // Module keys mirror the access matrix in api/src/models/user.model.js.
    MODULES: ['dashboard', 'sales', 'receiving', 'customer', 'supplier',
        'category', 'item', 'expense', 'branch', 'report', 'user'],
    // Till actions mirror POS_PERMISSIONS in api/src/constants/roles.constants.js.
    POS_KEYS: ['discount_apply', 'price_override', 'void_line', 'void_sale', 'refund',
        'reprint_receipt', 'no_sale_open_drawer', 'register_open', 'register_close',
        'cash_in_out', 'cash_drop', 'quick_sale'],
    POS_LABELS: {
        discount_apply: 'Apply discount', price_override: 'Price override',
        void_line: 'Void a line', void_sale: 'Void a sale', refund: 'Refund / return',
        reprint_receipt: 'Reprint receipt', no_sale_open_drawer: 'No-sale open drawer',
        register_open: 'Open register', register_close: 'Close register',
        quick_sale: 'Quick sale / instant items',
        cash_in_out: 'Cash in / out', cash_drop: 'Cash drop',
    },
    listCache: [],
    _esc: function (s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    },
    showDataTablePage: function () {
        PosnicPro.HideSideBarModal();
        $(".vertical-layout").removeClass("toggle-menu");
        $('.dropdown-item').removeClass('active');
        $('.page_loader,#osk-container').hide();
        $('#roles_admin_detail').show();
        $('.dashboard_img_menu').hide();
        PosnicPro.roles.load();
    },
    load: function () {
        PosnicPro.get('roles', function (res) {
            PosnicPro.roles.listCache = (res && res.data) || [];
            PosnicPro.roles.renderList();
        }, function () {
            $('#roles_admin_body').html('<tr><td colspan="5" class="text-center text-danger">Could not load roles.</td></tr>');
        });
    },
    renderList: function () {
        var esc = PosnicPro.roles._esc;
        var canWrite = PosnicPro.checkAccess('user', 'write')
            || ['super_admin', 'admin', 'manager'].indexOf(PosnicPro.local.get('usertype')) !== -1;
        var html = '';
        (PosnicPro.roles.listCache || []).forEach(function (r) {
            var id = r._id && r._id.$oid ? r._id.$oid : r._id;
            var pos = r.pos || {};
            var allowed = PosnicPro.roles.POS_KEYS.filter(function (k) { return pos[k] === true; });
            var mgrCount = (r.requires_manager_approval || []).length;
            /* A COUNT, not the full list - eleven comma-separated actions
               made every row four lines tall (owner: "hight looks big").
               The pane spells them out; the row only has to say how much. */
            var authority = allowed.length
                ? allowed.length + ' till action' + (allowed.length === 1 ? '' : 's')
                    + (mgrCount ? ' · ' + mgrCount + ' need a manager' : '')
                : 'Everything needs a manager';
            html += '<tr class="md-row roles-row highlight-select'
                + (PosnicPro.listDoc.activeId('roles') === String(id) ? ' is-active' : '') + '" data-id="' + esc(id) + '" style="cursor:pointer;">'
                + '<td style="font-weight:600; white-space:nowrap;">' + esc(r.name) + '</td>'
                + '<td class="rl-col-type">' + (r.is_system
                    ? '<span class="badge badge-primary-inverse">System</span>'
                    : '<span class="badge badge-success-inverse">Custom</span>') + '</td>'
                + '<td class="rl-col-desc" style="max-width:320px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + esc(r.description || '') + '</td>'
                + '<td class="rl-col-auth q-muted" style="white-space:nowrap;">' + esc(authority) + '</td>'
                + '<td class="text-right" style="white-space:nowrap;">'
                + (canWrite
                    ? '<a href="javascript:void(0);" class="btn btn-sm btn-light rl-row-act" title="Edit" onclick="PosnicPro.roles.openEditor(\'' + id + '\');"><i class="feather icon-edit-2"></i></a> '
                      + '<a href="javascript:void(0);" class="btn btn-sm btn-light rl-row-act" title="Clone as custom role" onclick="PosnicPro.roles.openEditor(\'' + id + '\', true);"><i class="feather icon-copy"></i></a>'
                      + (r.is_system ? ''
                          : ' <a href="javascript:void(0);" class="btn btn-sm btn-light text-danger rl-row-act" title="Delete" onclick="PosnicPro.roles.remove(\'' + id + '\');"><i class="feather icon-trash-2"></i></a>')
                    : '')
                + '</td>'
                + '</tr>';
        });
        $('#roles_admin_body').html(html
            || '<tr><td colspan="5" class="text-center text-muted">No roles yet.</td></tr>');
        if (PosnicPro.roles._pendingDoc) {
            var pending = PosnicPro.roles._pendingDoc;
            PosnicPro.roles._pendingDoc = null;
            PosnicPro.roles.openDoc(pending);
        }
    },
    /* Deep link #/roles/<id>: the list with that role open in the right
       pane - what it permits at a glance; editing is the deliberate act.
       Recognises its own setHash echo. */
    showDetails: function (roleId) {
        if (PosnicPro.listDoc.activeId('roles') === String(roleId)
            && $('#roles_detail_card').is(':visible')) { return; }
        PosnicPro.roles.showDataTablePage();
        PosnicPro.roles._pendingDoc = String(roleId);
    },
    openDoc: function (roleId) {
        var esc = PosnicPro.roles._esc;
        var r = (PosnicPro.roles.listCache || []).filter(function (x) {
            var id = x._id && x._id.$oid ? x._id.$oid : x._id;
            return String(id) === String(roleId);
        })[0];
        if (!r) { return; }
        var pos = r.pos || {};
        var allowed = PosnicPro.roles.POS_KEYS.filter(function (k) { return pos[k] === true; })
            .map(function (k) { return '<span class="badge badge-secondary-inverse mr-1">' + esc(PosnicPro.roles.POS_LABELS[k]) + '</span>'; });
        var mgr = (r.requires_manager_approval || [])
            .map(function (k) { return '<span class="badge badge-warning-inverse mr-1">' + esc(PosnicPro.roles.POS_LABELS[k] || k) + '</span>'; });
        var caps = [];
        if (pos.discount_max_percent > 0) { caps.push('Discount up to ' + pos.discount_max_percent + '%'); }
        if (pos.refund_max_amount > 0) { caps.push('Refund up to ' + pos.refund_max_amount); }
        var body = PosnicPro.listDoc.table(
            PosnicPro.listDoc.row('Type', r.is_system
                ? '<span class="badge badge-primary-inverse">System</span>'
                : '<span class="badge badge-success-inverse">Custom</span>')
            + PosnicPro.listDoc.row('Description', esc(r.description || '-'))
            + PosnicPro.listDoc.row('Till authority', allowed.length ? allowed.join(' ') : 'Everything needs a manager')
            + PosnicPro.listDoc.row('Needs a manager', mgr.length ? mgr.join(' ') : '')
            + PosnicPro.listDoc.row('Caps', caps.length ? esc(caps.join(' · ')) : ''));
        var canWrite = PosnicPro.checkAccess('user', 'write')
            || ['super_admin', 'admin', 'manager'].indexOf(PosnicPro.local.get('usertype')) !== -1;
        var actions = canWrite
            ? '<button type="button" class="btn btn-sm btn-light" data-toggle="tooltip" title="Clone as custom role" aria-label="Clone"'
                + ' onclick="PosnicPro.roles.openEditor(\'' + esc(roleId) + '\', true);"><i class="feather icon-copy"></i></button>'
                + '<button type="button" class="btn btn-sm btn-light" data-toggle="tooltip" title="Edit this role" aria-label="Edit"'
                + ' onclick="PosnicPro.roles.openEditor(\'' + esc(roleId) + '\');"><i class="feather icon-edit-2"></i></button>'
            : '';
        PosnicPro.listDoc.open({ key: 'roles', id: roleId, title: r.name, actions: actions, body: body });
    },
    _renderEditorGrids: function () {
        if ($('#role_editor_acl_body tr').length) { return; }
        var acl = '';
        PosnicPro.roles.MODULES.forEach(function (m) {
            acl += '<tr><td style="text-transform:capitalize;">' + m + '</td>'
                + '<td class="text-center"><input type="checkbox" id="role_acl_' + m + '_read"></td>'
                + '<td class="text-center"><input type="checkbox" id="role_acl_' + m + '_write"></td>'
                + '<td class="text-center"><input type="checkbox" id="role_acl_' + m + '_delete"></td>'
                + '</tr>';
        });
        $('#role_editor_acl_body').html(acl);
        var pos = '';
        PosnicPro.roles.POS_KEYS.forEach(function (k) {
            pos += '<tr><td>' + PosnicPro.roles.POS_LABELS[k] + '</td>'
                + '<td class="text-center"><input type="checkbox" id="role_pos_' + k + '"></td>'
                + '<td class="text-center"><input type="checkbox" id="role_mgr_' + k + '"></td>'
                + '</tr>';
        });
        $('#role_editor_pos_body').html(pos);
    },
    openEditor: function (roleId, asClone) {
        PosnicPro.roles._renderEditorGrids();
        var role = null;
        if (roleId) {
            role = (PosnicPro.roles.listCache || []).filter(function (r) {
                var id = r._id && r._id.$oid ? r._id.$oid : r._id;
                return String(id) === String(roleId);
            })[0];
        }
        var isSystem = !!(role && role.is_system && !asClone);
        $('#role_editor_id').val(role && !asClone ? roleId : '');
        $('#role_editor_title').text(!role ? 'New Role' : (asClone ? 'Clone: ' + (role.name || '') : 'Edit: ' + (role.name || '')));
        $('#role_editor_name').val(role ? (asClone ? (role.name || '') + ' (copy)' : role.name || '') : '');
        $('#role_editor_description').val(role ? role.description || '' : '');
        $('#role_editor_name').prop('disabled', isSystem);
        $('#role_editor_system_note').toggle(isSystem);

        var access = (role && role.access) || {};
        PosnicPro.roles.MODULES.forEach(function (m) {
            var mod = access[m] || {};
            $('#role_acl_' + m + '_read').prop('checked', mod.read === true);
            $('#role_acl_' + m + '_write').prop('checked', mod.write === true);
            $('#role_acl_' + m + '_delete').prop('checked', mod.delete === true);
        });
        $('#role_acl_dashboard_financials').prop('checked', !!(access.dashboard && access.dashboard.financials));

        var pos = (role && role.pos) || {};
        var mgr = (role && role.requires_manager_approval) || [];
        PosnicPro.roles.POS_KEYS.forEach(function (k) {
            $('#role_pos_' + k).prop('checked', pos[k] === true);
            $('#role_mgr_' + k).prop('checked', mgr.indexOf(k) !== -1);
        });
        $('#role_editor_discount_cap').val(pos.discount_max_percent != null ? pos.discount_max_percent : 0);
        $('#role_editor_refund_cap').val(pos.refund_max_amount != null ? pos.refund_max_amount : 0);
        $('#role_editor_modal').modal('show');
    },
    save: function () {
        var name = ($('#role_editor_name').val() || '').trim();
        if (!name) { PosnicPro.alert('warning', 'Give the role a name.'); return; }
        var access = {};
        PosnicPro.roles.MODULES.forEach(function (m) {
            access[m] = {
                read: $('#role_acl_' + m + '_read').is(':checked'),
                write: $('#role_acl_' + m + '_write').is(':checked'),
                delete: $('#role_acl_' + m + '_delete').is(':checked'),
            };
        });
        access.dashboard.financials = $('#role_acl_dashboard_financials').is(':checked');
        var pos = {};
        var mgr = [];
        PosnicPro.roles.POS_KEYS.forEach(function (k) {
            pos[k] = $('#role_pos_' + k).is(':checked');
            if ($('#role_mgr_' + k).is(':checked')) { mgr.push(k); }
        });
        pos.discount_max_percent = Number($('#role_editor_discount_cap').val()) || 0;
        pos.refund_max_amount = Number($('#role_editor_refund_cap').val()) || 0;

        var id = $('#role_editor_id').val();
        var payload = {
            name: name,
            description: ($('#role_editor_description').val() || '').trim(),
            access: access,
            pos: pos,
            requires_manager_approval: mgr,
        };
        $('#role_editor_save').prop('disabled', true);
        var done = function () { $('#role_editor_save').prop('disabled', false); };
        PosnicPro.request({
            method: id ? 'PUT' : 'POST',
            url: id ? 'roles/' + id : 'roles',
            data: JSON.stringify(payload),
        }, function (response) {
            done();
            PosnicPro.alert(response.type, response.message);
            if (response.type === 'success') {
                $('#role_editor_modal').modal('hide');
                PosnicPro.roles.load();
            }
        }, function () { done(); });
    },
    remove: function (roleId) {
        swal({
            title: 'Delete this role?',
            text: 'A role still assigned to users cannot be deleted.',
            showCancelButton: true,
            confirmButtonClass: 'btn btn-danger',
            cancelButtonClass: 'btn btn-secondary m-l-10',
            confirmButtonText: 'Delete',
            cancelButtonText: 'Cancel'
        }).then(function () {
            PosnicPro.delete('roles/' + roleId, function (response) {
                PosnicPro.alert(response.type, response.message);
                if (response.type === 'success') { PosnicPro.roles.load(); }
            }, function (xhr) {
                try {
                    var response = jQuery.parseJSON(xhr.responseText);
                    PosnicPro.alert(response.type || 'error', response.message);
                } catch (e) {
                    PosnicPro.alert('error', 'Could not delete the role.');
                }
            });
        }, function () {});
    },
};

/* Row click peeks the role in place; the action buttons never also open it. */
$(document).on('click', '#roles_admin_body tr.roles-row', function (e) {
    if ($(e.target).closest('.rl-row-act').length) { return; }
    PosnicPro.roles.openDoc($(this).data('id'));
});
