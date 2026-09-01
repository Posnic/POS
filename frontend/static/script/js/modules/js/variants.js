PosnicPro.variants = {
    variantAction: 'add',
    showAdd: function () {
        var loader = $(".loader-variant");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.HideSideBarModal();
        PosnicPro.showAddModal('variant');
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $(".vertical-layout").removeClass("toggle-menu");
        $(".vertical-menu li a").removeClass("active");
        $('#v-pills-inventory-tab,.variant_new_shortcut').addClass('active');
        $('#v-pills-inventory').addClass('show active');
        $('.vertical-menu li a#view_variants_page').addClass('active');
        PosnicPro.variants.addVariantButton();
        $('#variant_reset').show();
        $('.variant_edit_reset').hide();
        $('.add_new_tooltip').tooltip("hide");
        $('#variant_id').val('');
        if (PosnicPro.variants.variantAction === 'edit') {
            PosnicPro.variants.variantClearForm();
        }
        PosnicPro.variants.variantAction = 'add';
    },
    showEdit: function (id) {
        var loader = $(".loader-variant");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.showEditModal('variants');
        PosnicPro.variants.editVariant(id);
        $('#variant_reset').hide();
        $('.variant_edit_reset').show();
        $('.variant_edit_reset').attr("id", id);
        PosnicPro.variants.variantAction = 'edit';
    },
    showDelete: function (id) {
        PosnicPro.deleteTableRowData(id, 'variants');
    },
    /* Deep link #/variants/<id>: the list with that variant open in the
       right pane. Recognises its own setHash echo. */
    showDetails: function (id) {
        if (PosnicPro.listDoc.activeId('variants') === String(id)
            && $('#variants_detail_card').is(':visible')) { return; }
        PosnicPro.variants._chrome();
        PosnicPro.variants.loadList(1);
        PosnicPro.variants.openDoc(id);
    },
    openDoc: function (id) {
        var esc = function (t) { return $('<span>').text(t == null ? '' : t).html(); };
        var actions = '<button type="button" class="btn btn-sm btn-light" data-module="item" data-access="write" data-toggle="tooltip" title="Edit this variant" aria-label="Edit"'
            + ' onclick="hasher.setHash(\'variants/' + esc(id) + '/edit\');"><i class="feather icon-edit-2"></i></button>'
            + '<button type="button" class="btn btn-sm btn-light" data-module="item" data-access="delete" data-toggle="tooltip" title="Delete this variant" aria-label="Delete"'
            + ' onclick="PosnicPro.listDoc.close(\'variants\'); hasher.setHash(\'variants/' + esc(id) + '/delete\');"><i class="feather icon-trash-2"></i></button>';
        PosnicPro.listDoc.open({ key: 'variants', id: id, title: 'Variant', actions: actions });
        PosnicPro.ACLForModule('item');
        PosnicPro.get('variants/' + id, function (response) {
            var d = response && response.data;
            if (response.type !== 'success' || !d) {
                PosnicPro.listDoc.body('variants', '<div class="text-danger p-3">Could not open this variant.</div>');
                return;
            }
            var values = (d.fields || []).map(function (f) { return f && f.name; }).filter(Boolean);
            PosnicPro.listDoc.title('variants', d.name || 'Variant');
            PosnicPro.listDoc.body('variants', PosnicPro.listDoc.table(
                PosnicPro.listDoc.row('Values', values.length
                    ? values.map(function (v) { return '<span class="badge badge-secondary-inverse mr-1">' + esc(v) + '</span>'; }).join(' ')
                    : '-')
                + PosnicPro.listDoc.row('Added', d.created_date ? esc(PosnicPro.convertDate(d.created_date)) : '')
                + PosnicPro.listDoc.row('Updated', d.updated_date ? esc(PosnicPro.convertDate(d.updated_date)) : '')));
        }, function () {
            PosnicPro.listDoc.body('variants', '<div class="text-danger p-3">Could not open this variant.</div>');
        });
    },
    /* The name the OLD table machinery answered to - the save flow and the
       shared clearListFilters/refresh doors still call it. */
    variantsTable: function () {
        PosnicPro.variants.loadList(1);
    },
    _page: 1,
    PAGE_SIZE: 25,
    _lastRows: [],
    _chrome: function () {
        PosnicPro.HideSideBarModal();
        $('.page_loader,#osk-container').hide();
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $('.vertical-menu li a').removeClass('active');
        $('#v-pills-inventory-tab,#view_variants_page').addClass('active');
        $('#v-pills-inventory').addClass('show active');
        $('.page-title-box,#variants').show();
        $('#variants_new').modal('hide');
        $('.dashboard_img_menu').hide();
        $('#image_sidebar_itemvariant').show();
    },
    showDataTablePage: function () {
        PosnicPro.variants._chrome();
        PosnicPro.variants.loadList(1);
    },
    mountFilters: function (force) {
        if (!$('#variants_filter_panel').length) { return; }
        if (!force && $('#variants_filter_panel').data('mounted')) { return; }
        $('#variants_filter_panel').data('mounted', true);
        PosnicPro.listFilter.mount({
            key: 'variants',
            container: '#variants_filter_panel',
            button: '#variants_filter_btn',
            searchPlaceholder: 'Search variant name',
            searchFields: [
                { value: 'name', label: 'Name' }
            ],
            onChange: function () { PosnicPro.variants.loadList(1); }
        });
    },
    loadList: function (page) {
        PosnicPro.variants.mountFilters();
        var self = PosnicPro.variants;
        if (page) { self._page = page; }
        var filters = PosnicPro.listFilter.legacyFilters('variants', {});
        var esc = function (t) { return $('<span>').text(t == null ? '' : t).html(); };
        PosnicPro.get({
            url: 'variants',
            data: { page: self._page, limit: self.PAGE_SIZE, filters: JSON.stringify(filters) }
        }, function (response) {
            var data = (response && response.data) || {};
            var list = data.list || [];
            self._lastRows = list;
            if (!list.length) {
                var filtered = PosnicPro.listFilter.activeCount('variants') > 0;
                $('#variants_list_rows').html('<div class="text-center text-muted p-t-20 p-b-20">'
                    + (filtered ? 'No variants match this filter.' : 'No variants yet - press New to add the first.') + '</div>');
                $('#variants_list_paging').html('');
                return;
            }
            var html = '<div class="table-responsive"><table class="table table-borderless">'
                + '<thead><tr><th>Name</th><th class="vr-col-values">Values</th></tr></thead><tbody>';
            list.forEach(function (r) {
                var values = (r.fields || []).map(function (f) { return f && f.name; }).filter(Boolean).join(', ');
                html += '<tr class="md-row variants-row highlight-select'
                    + (PosnicPro.listDoc.activeId('variants') === String(r._id) ? ' is-active' : '') + '" data-id="' + esc(r._id) + '" style="cursor:pointer;">'
                    + '<td>' + esc(r.name) + '</td>'
                    + '<td class="vr-col-values q-muted">' + esc(values || '-') + '</td>'
                    + '</tr>';
            });
            html += '</tbody></table></div>';
            $('#variants_list_rows').html(html);
            PosnicPro.ACLForModule('item');
            self.renderPager(Number(data.total) || list.length);
        }, function () {
            $('#variants_list_rows').html('<div class="text-center text-muted p-t-20 p-b-20">Could not load variants - try again.</div>');
        });
    },
    renderPager: function (total) {
        var self = PosnicPro.variants;
        var p = self._page, size = self.PAGE_SIZE;
        var pages = Math.ceil(total / size) || 1;
        var label = total + (total === 1 ? ' variant' : ' variants');
        if (pages > 1) { label = 'Page ' + p + ' of ' + pages + ' · ' + label; }
        var btn = function (to, text, off, cls) {
            return '<button type="button" class="btn btn-sm ' + (cls || 'btn-secondary-rgba') + ' q-pg-btn"' + (off ? ' disabled' : '')
                + ' onclick="PosnicPro.variants.goPage(' + to + ');">' + text + '</button>';
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
        $('#variants_list_paging').html(html);
    },
    goPage: function (n) {
        if (!n || n < 1) { return; }
        PosnicPro.variants._page = n;
        PosnicPro.variants.loadList();
    },
    exportCsv: function () {
        var rows = [['Name', 'Values']];
        (PosnicPro.variants._lastRows || []).forEach(function (r) {
            rows.push([r.name, (r.fields || []).map(function (f) { return f && f.name; }).filter(Boolean).join(', ')]);
        });
        var csv = rows.map(function (r) {
            return r.map(function (c) { return '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"'; }).join(',');
        }).join('\n');
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'variants.csv';
        a.click();
        URL.revokeObjectURL(a.href);
    },
    /*This Variants Function Used To Add & Edit*/
    variant: function () {
        var loader = $(".loader-variant");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        var method = 'POST';
        var url = 'variants';
        if ($('#variant_id').val() === '') {
            PosnicPro.action = 'add';
        } else {
            method = 'PUT';
            url += '/' + $('#variant_id').val();
            PosnicPro.action = 'edit';
        }

        var variant = $(".variant_list")
                .map(function () {
                    return $(this).val();
                }).get();
        var variantType = {
            product_type: variant
        }
        var formData = PosnicPro.getFormData($('.variant_add'));
        var params = {
            method: method,
            url: url,
            data: JSON.stringify(Object.assign(formData, variantType))
        };
        PosnicPro.request(params, function (response) {

            loader.find(".loadingSpinner:first").remove();
            if (response.type === 'success') {
                $(".variant_add").trigger('reset');
                $('.variant-wrapper .variant-fields .variant-input:nth-child(n+2)').remove();
                PosnicPro.alert(response.type, response.message);
                if (PosnicPro.action === 'add') {
                    PosnicPro.variants.variantsTable('variants');
                    $('#show_last_created_variant').show();
                    var path = '#/variants/' + response.data;
                    $('#last_created_variant').attr('href', path);
                }
                if (PosnicPro.action === 'edit') {
                    hasher.setHash('variants');
                    $(".infobar-settings-sidebar-overlay").css({"background": "transparent", "position": "initial"});
                    $("#infobar-settings-sidebar-variant").removeClass("sidebarshow");
                }
                PosnicPro.items.loadSelectVariant();
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
        return false;
    },
    /*Edit variant details*/
    editVariant: function (id) {
        var loader = $(".loader-variant");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        $(".infobar-settings-sidebar-overlay").css({"background": "rgba(0,0,0,0.4)", "position": "fixed"});
        $("#infobar-settings-sidebar-variant").addClass("sidebarshow");
        var params = {
            url: 'variants/getVariantDetails',
            data: {
                id: id
            }
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                $('#variants_new').modal('show');
                data = response.data;
                PosnicPro.record_id = id;
                $('#variant_id').val(PosnicPro.record_id);
                $('#variant_name').val(data.name);
                    $('#variant_title').text(PosnicPro.i18n.t('lang_action_edit', 'Edit'));
                    $('#variant_button_title').text(PosnicPro.i18n.t('lang_updatebtn_title', 'Update'));
                $('.variant-wrapper .variant-fields .variant-input:nth-child(n+2)').remove();
                let $test = $('.variant-input:parent');
                $('.add-variant-field', $test).hide();
                $.each(data.fields, function (index, value) {
                    $('.variant-wrapper').each(function () {
                        var $wrapper = $('.variant-fields', this);
                        $('.variant-input:first-child', $wrapper).clone(true).appendTo($wrapper).find('input').removeClass('edit-variant-class').val(value.name);
                    });
                });
                $('.variant-wrapper .variant-fields .variant-input:nth-child(1)').remove();
                let $newtest = $('.variant-input:last-child');
                $('.add-variant-field', $newtest).show();
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
        PosnicPro.variants.editVariant(id);
        let $firstChild = $('.variant-input:first-child');
        $('.add-variant-field', $firstChild).show();
    },
    addVariantButton: function () {
        var loader = $(".loader-variant");
        loader.find(".loadingSpinner:first").remove();
            $('#variant_title').text(PosnicPro.i18n.t('lang_new_title', 'Add'));
            $('#variant_button_title').text(PosnicPro.i18n.t('lang_save_title', 'Save'));
        $('.update-button').attr('disabled', 'disabled').removeClass('btn-outline-success');
        $('#variant_id').val('');
    },
    variantClearForm: function () {
        $(".variant_add").trigger('reset');
        $('.error_variant').css('display', 'none');
        $('#variant_id').val('');
        $('.variant-wrapper .variant-fields .variant-input:nth-child(n+2)').remove();
        $('#show_last_created_variant').hide();
        var $lastChild = $('.variant-input:last-child');
        $('.add-variant-field', $lastChild).show();
    }
};

/* Standard list wiring: Filter button, row click into the edit sidebar,
   row action buttons that must not also open the row. */
$(document).on('click', '#variants_filter_btn', function () {
    PosnicPro.variants.mountFilters(true);
    PosnicPro.listFilter.toggle('variants');
});
$(document).on('click', '#variants_list_rows tr.variants-row', function () {
    PosnicPro.variants.openDoc($(this).data('id'));
});

$(function () {
    // Validate signup form on keyup and submit
    $(".variant_add").validate({
        errorClass: 'error error_variant',
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
                maxlength: 20
            },
            "variantfield[0]": {
                required: true,
                minlength: 1,
                maxlength: 20
            }
        },
        messages: {
            name: {
                required: "Enter the variant name",
                minlength: "Variant Name must consist of at least 3 characters"
            },
            "variantfield[0]": {
                required: "Variant Must be 1 character",
                maxlength: "Variant too Long!"
            }
        }
    });

    $("#variants_new").on('shown.bs.modal', function () {
        $(this).find('#variant_name').focus();
    });

    $(".variant_add").submit(function (event) {
        event.preventDefault();
        if ($(this).valid()) { // Check form validity
            PosnicPro.variants.variant();
            var $firstChild = $('.variant-input:first-child');
            $('.add-variant-field', $firstChild).show();
        }
    });

    function validate(input) {
        if (/^\s/.test(input.value))
            input.value = '';
    }

    $('.variant-wrapper').each(function () {
        var $wrapper = $('.variant-fields', this);
        var i = 0;

        $(".add-variant-field", $(this)).click(function (e) {
            $('.variant_list').valid();
            i++;
            if ($(this).parent('.variant-input').find('input').val().length >= 1) {
                var $parent = $('.variant-input:parent', $wrapper);
                var $variantField = $('.variant-input:first-child', $wrapper).clone(true);
                $variantField.appendTo($wrapper).find('input').attr('id', 'variantfield[' + i + ']').attr('name', 'variantfield[' + i + ']').val('').focus();
                $('.add-variant-field', $variantField).show();
                $('.add-variant-field', $parent).hide();

                // Remove previous error message and validation for the new field
                $('.error_variant', $variantField).remove();
                $('input', $variantField).removeClass('error').removeData('previousValue');

                // Set validation rules for the new field
                $variantField.find('input').rules('add', {
                    required: true,
                    minlength: 1,
                    maxlength: 20,
                    messages: {
                        required: "Variant Must be 1 character",
                        maxlength: "Variant too long!"
                    }
                });

                // Trigger validation for the new field
                $variantField.find('input').valid();
            }
        });

        $('.variant-input .remove-variant-field', $wrapper).click(function () {
            var $variantInput = $(this).closest('.variant-input');
            $('input', $variantInput).val('');
            if ($('.variant-input', $wrapper).length > 1) {
                $variantInput.remove();
            }
        });
    });

    $('.remove-variant-field').click(function () {
        var $lastChild = $('.variant-input:last-child');
        $('.add-variant-field', $lastChild).show();
    });
});