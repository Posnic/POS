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
    showDetails: function (id) {
        var loader = $(".loader-view-variant");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.showViewModal('variants');
        PosnicPro.variants.viewVariant(id);
    },
    variantsTable: function () {
        var loader = $(".loader-table-variant");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        PosnicPro.appendViewDataTableBody('variants');
        var table = $('#view_variants');
        var params = {
            url: 'variants',
            data: {
                page: table.data('current_page'),
                limit: parseInt($('#view_variants_per_page  option:selected').text()),
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
                $('#view_variants_total').text(response.data.total);
                var rowTotal = response.data.total;
                if (rowTotal === 0) {
                    $('.variant_header').hide();
                    let dateRange = $('#view_sales_daterange span span[data-toggle="tooltip"]').attr('data-original-title');
                    $('.variant_norecord').empty().append('<div class="text-center text-dark"> <p>No Records on ' + dateRange + '</p></div>');
                    $('#variant_img_hide,.variant_norecord').show();

                } else {
                    $('.category_norecord').empty();
                    $('#variant_img_hide,.variant_norecord').hide();
                    $('.variant_header').show();
                }

                var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                $('#view_variants_page_total').text(row_total);
                var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                $('#view_variants_page_perpage_total').text(page_totals + response.data.list.length);

                for (var i = 0; i < response.data.list.length; i++) {
                    var row = response.data.list[i];
                    var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;

                    var action = '<div id="onclick-toolbar-options_' + i + '" class="hidden">' +
                            '<a data-module = "item" data-access = "read" href="#/variants/' + row._id + '" data-id="variants/' + row._id + '"  data-toggle="tooltip" title="View Variant" class="point-cursor mobile_tooltip"><i class="feather icon-eye"></i></a>' +
                            '<a data-module = "item" data-access = "write" href="#/variants/' + row._id + '/edit" data-id="variants/' + row._id + '/edit"  data-toggle="tooltip" title="Edit Variant" class="point-cursor mobile_tooltip"><i class="feather icon-edit"></i></a>' +
                            '<a data-module = "item" data-access = "delete" href="#/variants/' + row._id + '/delete" data-id="variants/' + row._id + '/delete" data-toggle="tooltip" title="Delete Variant" class="point-cursor mobile_tooltip"><i class="feather icon-trash"></i></a>' +
                            '</div>' +
                            '<div data-toolbar="user-options" class="btn btn-round btn-primary-rgba round-pad" id="onclick-toolbar_' + i + '"><i class="feather icon-more-vertical-"></i></div>';

                    var trow = '<tr id="variantbgcolor_' + row._id + '" class="variantcheckbox">' +
                            '<th><input type="checkbox" class="variants-row-id variantcheck_' + row._id + '" id="' + row._id + '" name="id[]" value="' + row._id + '" onclick="PosnicPro.checkboxSelectOne(this,\'variants\');"></th> <th scope="row">' + row_no + '</th>' +
                            '<td width="30%">' + row.name + '</td>' +
                            '<td class="text-center"><span>' + action + '</span></td>' +
                            '</tr>';

                    $('#view_variants').children('tbody').append(trow);
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
                PosnicPro.setSelectedCheckbox(PosnicPro["variants_checkbox"], 'variants');
                PosnicPro.ACLForModule('item');
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
        var loader = $(".loader-table-variant");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.dashboard.datePicker();
        PosnicPro.HideSideBarModal();
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $(".vertical-layout").removeClass("toggle-menu");
        $(".vertical-menu li a").removeClass("active");
        $('.dropdown-item').removeClass('active');
        $('.page_loader,#osk-container').hide();
        $('.page-title-box,#variants').show();
        $('#variants_new,#variants_view').modal('hide');
        $('#v-pills-inventory-tab').addClass('active');
        $('#v-pills-inventory').addClass('show active');
        PosnicPro.variants.variantsTable('variants');
        $('.dashboard_img_menu').hide();
        $('#image_sidebar_itemvariant').show();
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
    /*Display the variant details*/
    viewVariant: function (id) {
        var loader = $(".loader-view-variant");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        $('#variants_view').modal('show');
        $('#view_variant_fields').html('');
        PosnicPro.get('variants/' + id, function (response) {
            if (response.type === 'success') {
                var data = response.data;
                PosnicPro.record_id = id;
                $('#variant_view_name').text(data.name);
                var fieldsAppend;
                $.each(data.fields, function (index, value) {
                    fieldsAppend += '<tr><th scope="row">Product variant <span>' + (index + 1) + '</span> :</th><td>' + value.name + '</td></tr>';
                });
                $('#view_variant_fields').append(fieldsAppend);
                var updateCreateDate = PosnicPro.convertDate(data.created_date);
                $('#variant_view_created_date').text(updateCreateDate);
                var updateUpdateDate = PosnicPro.convertDate(data.updated_date);
                $('#variant_view_updated_date').text(updateUpdateDate);
                loader.find(".loadingSpinner:first").remove();
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
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
                if (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') {
                    $('#variant_title').text('திருத்தப்பட்ட');
                    $('#variant_button_title').text('புதுப்பி');

                } else {
                    $('#variant_title').text('Edit');
                    $('#variant_button_title').text('Update');

                }
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
        if (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') {
            $('#variant_title').text('புதிய');
            $('#variant_button_title').text('சேமி');
        } else {
            $('#variant_title').text('Add');
            $('#variant_button_title').text('Save');
        }
        $('.update-button').attr('disabled', 'disabled').removeClass('btn-outline-success');
        $('#variant_id').val('');
    },
    exportVarients: function () {
        PosnicPro.exportTableData(PosnicPro.variants_checkbox, 'variants');
    },
    deleteSelectedVariants: function () {
        PosnicPro.deleteTableData(PosnicPro.variants_checkbox, 'variants');
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
                required: "Please enter a Variant Name",
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