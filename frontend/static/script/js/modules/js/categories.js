PosnicPro.categories = {
    setCatTileColor: function (color) {
        $('#category_tile_color').val(color || '');
        $('#category_tile_swatches .tile-swatch').removeClass('is-picked').filter(function () {
            return ($(this).data('color') || '') === (color || '');
        }).addClass('is-picked');
    },
    setCatTileShape: function (shape) {
        $('#category_tile_shape').val(shape || '');
        $('#category_tile_shapes .tile-shape').removeClass('is-picked').filter(function () {
            return ($(this).data('shape') || '') === (shape || '');
        }).addClass('is-picked');
    },
    categoryAction: 'add',
    showAdd: function () {
        PosnicPro.HideSideBarModal();
        $('#category_discount').hide();
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $(".vertical-menu li a").removeClass("active");
        $(".vertical-layout").removeClass("toggle-menu");
        $('#v-pills-inventory-tab,.category_new_shortcut').addClass('active');
        $('#v-pills-inventory').addClass('show active');
        $('.vertical-menu li a#view_categories_page').addClass('active');
        PosnicPro.showAddModal('category');
        PosnicPro.categories.addCategoryButton();
        $('#category_reset').show();
        $('.category_edit_reset').hide();
        $('.add_new_tooltip').tooltip("hide");
        if (PosnicPro.categories.categoryAction === 'edit') {
            PosnicPro.categories.categoryClearForm();
        }
        PosnicPro.categories.categoryAction = 'add';
    },
    showEdit: function (id) {
        var loader = $(".loader-category");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.showEditModal('categories');
        PosnicPro.categories.editCategory(id);
        $('#v-pills-inventory').addClass('show active');
        $('#category_discount').show();
        $('#category_reset').hide();
        $('.category_edit_reset').show();
        $('.category_edit_reset').attr("id", id);
        PosnicPro.categories.categoryAction = 'edit';
    },
    showDelete: function (id) {
        PosnicPro.deleteTableRowData(id, 'categories');
    },
    showDetails: function (id) {
        var loader = $(".loader-view-category");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.showViewModal('categories');
        PosnicPro.categories.viewCategory(id);
    },
    /* The name the OLD table machinery answered to - the save flow and the
       shared clearListFilters/refresh doors still call it. */
    categoriesTable: function () {
        PosnicPro.categories.loadList(1);
    },
    _page: 1,
    PAGE_SIZE: 25,
    _lastRows: [],
    _chrome: function () {
        PosnicPro.HideSideBarModal();
        $('.page_loader,#osk-container').hide();
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $('.vertical-menu li a').removeClass('active');
        $('#v-pills-inventory-tab,#view_categories_page').addClass('active');
        $('#v-pills-inventory').addClass('show active');
        $('.page-title-box,#categories').show();
        $('#categories_new,#categories_view').modal('hide');
        $('.dashboard_img_menu').hide();
        $('#image_sidebar_itemcatgory').show();
    },
    showDataTablePage: function () {
        PosnicPro.categories._chrome();
        PosnicPro.categories.loadList(1);
    },
    mountFilters: function (force) {
        if (!$('#categories_filter_panel').length) { return; }
        if (!force && $('#categories_filter_panel').data('mounted')) { return; }
        $('#categories_filter_panel').data('mounted', true);
        PosnicPro.listFilter.mount({
            key: 'categories',
            container: '#categories_filter_panel',
            button: '#categories_filter_btn',
            searchPlaceholder: 'Search category name',
            dateField: 'Added',
            searchFields: [
                { value: 'name', label: 'Name' }
            ],
            onChange: function () { PosnicPro.categories.loadList(1); }
        });
    },
    loadList: function (page) {
        PosnicPro.categories.mountFilters();
        var self = PosnicPro.categories;
        if (page) { self._page = page; }
        var filters = PosnicPro.listFilter.legacyFilters('categories', { dateKey: 'created_date' });
        var esc = function (t) { return $('<span>').text(t == null ? '' : t).html(); };
        PosnicPro.get({
            url: 'categories',
            data: {
                page: self._page,
                limit: self.PAGE_SIZE,
                filters: JSON.stringify(filters),
                // Send the active branch so the list matches the branch the
                // user has open (consistent with category create).
                branch_id: PosnicPro.local.get('branch_id_set')
            }
        }, function (response) {
            var data = (response && response.data) || {};
            var list = data.list || [];
            self._lastRows = list;
            if (!list.length) {
                var filtered = PosnicPro.listFilter.activeCount('categories') > 0;
                $('#categories_list_rows').html('<div class="text-center text-muted p-t-20 p-b-20">'
                    + (filtered ? 'No categories match this filter.' : 'No categories yet - press New to add the first.') + '</div>');
                $('#categories_list_paging').html('');
                return;
            }
            var currency = PosnicPro.local.get('currencySign');
            var html = '<div class="table-responsive"><table class="table table-borderless">'
                + '<thead><tr><th style="width:44px;"></th><th>Name</th><th class="text-right">Discount</th>'
                + '<th class="cg-col-desc">Description</th><th style="width:90px;"></th></tr></thead><tbody>';
            list.forEach(function (r) {
                var img = (r.image && r.image !== 'category.svg') ? r.image : 'static/images/default/category.svg';
                var discount = (Number(r.discount_amount) > 0)
                    ? currency + ' ' + r.discount_amount
                    : (Number(r.discount_percentage) > 0 ? r.discount_percentage + ' %' : '-');
                html += '<tr class="md-row categories-row highlight-select" data-id="' + esc(r._id) + '" style="cursor:pointer;">'
                    + '<td><img loading="lazy" decoding="async" src="' + esc(img) + '" style="width:30px; height:30px; object-fit:cover; border-radius:5px;" alt=""></td>'
                    + '<td>' + esc(r.name) + '</td>'
                    + '<td class="text-right">' + esc(discount) + '</td>'
                    + '<td class="cg-col-desc q-muted">' + esc(r.description || '-') + '</td>'
                    + '<td class="text-right" style="white-space:nowrap;">'
                    + '<a data-module="category" data-access="write" href="#/categories/' + esc(r._id) + '/edit" class="btn btn-sm btn-light cg-row-act" data-toggle="tooltip" title="Edit"><i class="feather icon-edit-2"></i></a> '
                    + '<a data-module="category" data-access="delete" href="#/categories/' + esc(r._id) + '/delete" class="btn btn-sm btn-light cg-row-act" data-toggle="tooltip" title="Delete"><i class="feather icon-trash-2"></i></a>'
                    + '</td>'
                    + '</tr>';
            });
            html += '</tbody></table></div>';
            $('#categories_list_rows').html(html);
            PosnicPro.ACLForModule('category');
            self.renderPager(Number(data.total) || list.length);
        }, function () {
            $('#categories_list_rows').html('<div class="text-center text-muted p-t-20 p-b-20">Could not load categories - try again.</div>');
        });
    },
    renderPager: function (total) {
        var self = PosnicPro.categories;
        var p = self._page, size = self.PAGE_SIZE;
        var pages = Math.ceil(total / size) || 1;
        var label = total + (total === 1 ? ' category' : ' categories');
        if (pages > 1) { label = 'Page ' + p + ' of ' + pages + ' · ' + label; }
        var btn = function (to, text, off, cls) {
            return '<button type="button" class="btn btn-sm ' + (cls || 'btn-secondary-rgba') + ' q-pg-btn"' + (off ? ' disabled' : '')
                + ' onclick="PosnicPro.categories.goPage(' + to + ');">' + text + '</button>';
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
        $('#categories_list_paging').html(html);
    },
    goPage: function (n) {
        if (!n || n < 1) { return; }
        PosnicPro.categories._page = n;
        PosnicPro.categories.loadList();
    },
    exportCsv: function () {
        var rows = [['Name', 'Discount amount', 'Discount %', 'Description']];
        (PosnicPro.categories._lastRows || []).forEach(function (r) {
            rows.push([r.name, r.discount_amount || 0, r.discount_percentage || 0, r.description || '']);
        });
        var csv = rows.map(function (r) {
            return r.map(function (c) { return '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"'; }).join(',');
        }).join('\n');
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'categories.csv';
        a.click();
        URL.revokeObjectURL(a.href);
    },
    triggerModules: function () {
        PosnicPro.showAddModal('category');
        PosnicPro.categories.addCategoryButton();
        $('#category_reset').show();
        $('.category_edit_reset').hide();
        if (PosnicPro.categories.categoryAction === 'edit') {
            PosnicPro.categories.categoryClearForm();
        }
        PosnicPro.categories.categoryAction = 'add';
    },
    /*This Categories Function Used To Add & Edit*/
    category: function () {
        var loader = $(".loader-category");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        var method = 'POST';
        var url = 'categories';
        if ($('#category_id').val() === '') {
            PosnicPro.action = 'add';
            if ($('#category_logo').val() === '') {
                $('#category_logo').val('category.svg');
            }
        } else {
            method = 'PUT';
            url += '/' + $('#category_id').val();
            PosnicPro.action = 'edit';
            if ($('#category_image').val() === 'category.svg') {
                $('#category_logo').val($('#get_category_image_value').val());
            } else {
                $('#category_logo').val($('#category_image').val());
            }
        }
        var categoryFormData = PosnicPro.getFormData($('.category_add'));
        // Send the currently selected branch so the category is saved against the
        // branch the user actually has open (same source the rest of the app uses).
        categoryFormData.branch_id = PosnicPro.local.get('branch_id_set');
        var params = {
            method: method,
            url: url,
            data: JSON.stringify(categoryFormData)
        };
        PosnicPro.request(params, function (response) {

            if (response.type === 'success') {
                loader.find(".loadingSpinner:first").remove();
                $('#category_value_check').val('');
                $("#category_image_upload").attr('src', 'static/images/default/category.svg');
                $(".category_add").trigger('reset');
                $('#radio_category_discount_amount').prop('checked', 'checked');
                $('#category_discount_percentage').attr('disabled', 'disabled').addClass('bg-white').hide();
                $('#category_discount_amount').removeAttr('disabled', 'disabled').show();
                $("#category_logo").val('');
                $("#category_image_upload").html('');
                $('#category_image').val('');
                var hash = window.location.hash.slice(1);
                if (hash === '/items/categories/new') {
                    hasher.changed.active = false; //disable changed signal    
                    $(".infobar-settings-sidebar-overlay").css({"background": "transparent", "position": "initial"});
                    $("#infobar-settings-sidebar-category").removeClass("sidebarshow");
                    hasher.changed.active = true; //enable changed signal
                    hasher.replaceHash('items/new');
                } else if (hash === '/sales/categories/new') {
                    $('#category_name').val('');
                    PosnicPro.categories.setCatTileColor('');
                    PosnicPro.categories.setCatTileShape('');
                    hasher.replaceHash('sales/new');
                } else {
                    /* ONE reload, not two (saves patch): when this navigation
                       actually changes the hash, the route loads the table -
                       the direct call below is only for saves made while
                       already sitting on the list. */
                    var wasOnCategoryList = (hash === '/categories');
                    hasher.setHash('categories');
                }
                if (PosnicPro.action === 'add') {
                    if (wasOnCategoryList) {
                        PosnicPro.categories.categoriesTable('categories');
                    }
                    $('#show_last_created_category').show();
                    var path = '#/categories/' + response.data;
                    $('#last_created_category').attr('href', path);
                }
                if (PosnicPro.action === 'edit') {
                    if (wasOnCategoryList) {
                        PosnicPro.categories.categoriesTable('categories');
                    }
                    $(".infobar-settings-sidebar-overlay").css({"background": "transparent", "position": "initial"});
                    $("#infobar-settings-sidebar-category").removeClass("sidebarshow");
                }
                PosnicPro.items.loadSelectCategory();
                PosnicPro.alert(response.type, response.message);
                $(".infobar-settings-sidebar-overlay").css({"background": "transparent", "position": "initial"});
                $("#infobar-settings-sidebar-category").removeClass("sidebarshow");
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
        return false;
    },
    /*Display the category details*/
    viewCategory: function (id) {
        var loader = $(".loader-view-category");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        PosnicPro.get('categories/' + id, function (response) {
            if (response.type === 'success') {
                PosnicPro.record_id = id;
                PosnicPro.categories.viewCategoryData(response);
                loader.find(".loadingSpinner:first").remove();
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        });
    },
    viewCategoryData: function (response) {
        $('#v-pills-inventory').addClass('show active');
        $(".infobar-settings-sidebar-overlay").css({"background": "rgba(0,0,0,0.4)", "position": "fixed"});
        $("#infobar-settings-sidebar-categories-details").addClass("sidebarview");
        $("#category-detail-tab").addClass("active");
        $("#category-sale-tab").removeClass("active");
        $("#category_detail").addClass("active show");
        $("#category_sale").removeClass("active show");
        var data = response.data;
        if (data.discount_amount > 0) {
            var currency = PosnicPro.local.get('currencySign');
            $('.category-discount-title').html(currency);
            $('.category-discount-value').html(data.discount_amount);
        } else if (data.discount_amount === 0 && data.discount_percentage === 0) {
            $('.category-discount-value').html('0');
        } else {
            $('.category-discount-title').html('%');
            $('.category-discount-value').html(data.discount_percentage);
        }
        var sign = $('.category-discount-title').html();
        if (sign === '%') {
            $('.discount_amountval').css("display", "none");
            $('.discount_percentageval').css("display", "block");
        } else {
            $('.discount_amountval').css("display", "block");
            $('.discount_percentageval').css("display", "none");
        }

        var image_path = (data.image !== "category.svg") ? data.image : 'static/images/default/' + data.image;
        $('#categoryimageview').attr('src', image_path);
        $.each(data, function (key, val) {
            if (val === '') {
                $('#category_view_' + key).html('');
            } else {
                $('#category_view_' + key).html(val);
            }
        });
        var updateCreateDate = PosnicPro.convertDate(data.created_date);
        $('#category_view_created_date').html(updateCreateDate);
        var updateUpdateDate = PosnicPro.convertDate(data.updated_date);
        $('#category_view_updated_date').html(updateUpdateDate);

    },

    clickImagePopup: function () {
        var imagepath = $('#categoryimageview').attr('src');
        $('#image_zoom_categoryview').attr('src', imagepath);
    },
    /*Edit category details*/
    editCategory: function (id) {
        $('#category_value_check').val('');
        var loader = $(".loader-category");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        $(".infobar-settings-sidebar-overlay").css({"background": "rgba(0,0,0,0.4)", "position": "fixed"});
        $("#infobar-settings-sidebar-category").addClass("sidebarshow");
        $('.category-image-label-title').html('<i class="feather icon-edit"></i>');
        var params = {
            url: 'categories/getCategoryDetails',
            data: {
                id: id
            }
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                $('#categories_new').modal('show');
                data = response.data;
                PosnicPro.record_id = id;
                $('#category_id').val(PosnicPro.record_id);
                $('#category_name').val(data.name);
                PosnicPro.categories.setCatTileColor(data.tile_color || '');
                PosnicPro.categories.setCatTileShape(data.tile_shape || '');
                $('#category_discount_amount').val(data.discount_amount);
                $('#category_discount_percentage').val(data.discount_percentage);
                $('#category_description').val(data.description);
                if (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') {
                    $('#category_title').text('திருத்தப்பட்ட');
                    $('#category_button_title').text('புதுப்பி');
                } else {
                    $('#category_title').text('Edit');
                    $('#category_button_title').text('Update');
                }
                $('.update-button').attr('disabled', 'disabled').removeClass('btn-outline-success');
                $('#category_image').val(data.image);
                $('#get_category_image_value').val(data.image);
                var image_path = (data.image !== "category.svg") ? data.image : 'static/images/default/' + data.image;
                $('#category_image_upload').attr('src', image_path);
                $('#addCategory').modal('show');
                loader.find(".loadingSpinner:first").remove();
                var radionbutton = $('#category_discount_amount').val();
                if (radionbutton > 0) {
                    $("#radio_category_discount_amount").prop('checked', 'checked');
                    $('#category_discount_percentage').attr('disabled', 'disabled').addClass('bg-white').hide();
                    $('#category_discount_amount').removeAttr('disabled', 'disabled').show();
                } else {
                    $("#radio_category_discount_percentage").prop('checked', 'checked');
                    $('#category_discount_amount').attr('disabled', 'disabled').addClass('bg-white').hide();
                    $('#category_discount_percentage').removeAttr('disabled', 'disabled').show();
                }
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    resetEditButton: function (id) {
        PosnicPro.categories.editCategory(id);
    },
    addCategoryButton: function () {
        var loader = $(".loader-category");
        loader.find(".loadingSpinner:first").remove();
        if (PosnicPro.local.get('language_herf') === 'ta_dashboard.html') {
            $('#category_title').text('புதிய');
            $('#category_button_title').text('சேமி');
        } else {
            $('#category_title').text('Add');
            $('#category_button_title').text('Save');
        }
        $('.category-image-label-title').html('<i class="feather icon-edit"></i>');
        $('.update-button').attr('disabled', 'disabled').removeClass('btn-outline-success');
        $('#get_category_image_value').val('category.svg');
        $('#category_id').val('');
        $('#categories_new .alert').remove();
        $('#category_value_check').val('');
        $('#show_last_created_category').hide();
        if (PosnicPro.local.get('setting-discount-amount') > 0) {
            $("#radio_category_discount_amount").prop('checked', 'checked');
            $('#category_discount_percentage').attr('disabled', 'disabled').addClass('bg-white').hide().val('0');
            $('#category_discount_amount').removeAttr('disabled', 'disabled').show().val(PosnicPro.local.get('setting-discount-amount'));
        } else {
            $("#radio_category_discount_percentage").prop('checked', 'checked');
            $('#category_discount_amount').attr('disabled', 'disabled').addClass('bg-white').hide().val('0.00');
            $('#category_discount_percentage').removeAttr('disabled', 'disabled').show().val(PosnicPro.local.get('setting-discount-percentage'));
        }
    },
    categoryImageFormSubmit: function () {
        var data = new FormData(document.getElementById("category_image_upload_form"));
        PosnicPro.requestImage('POST', "categories/uploadCategoryImage", data, false, function (response) {
            if (response.type === 'success') {
                var imgdata = response.data.replace(/\s/g, '');
                $("#category_logo").val(imgdata);
                $("#category_image_upload").html(response.data);
                $('#category_image').val(response.data);
                PosnicPro.categories.category();
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        });
        return false;
    },

    removeCategoryImage: function () {
        var image_value = $('#get_category_image_value').val();
        var id = $('#category_id').val();
        var params = {
            url: 'categories/categoryImageDelete',
            data: JSON.stringify({data: image_value, id: id})
        };
        PosnicPro.delete(params, function (response) {
            if (response.type === 'success') {
                var image_path = 'static/images/default/category.svg';
                $('#category_image_upload').attr('src', image_path);
                $('#category_image,#get_category_image_value').val('category.svg');
                $('#category_value_check').val('');
            }
            PosnicPro.alert(response.type, response.message);
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },

    categoryClearForm: function () {
        $(".category_add")[0].reset();
        $("#category_image_upload_form").validate().resetForm();
        $('.error_category').css('display', 'none');
        $("#category_image_upload_form").find('.has-error').removeClass("haserror");
        $('#category_image_upload').attr('src', 'static/images/default/category.svg');
        $('#category_description').html('');
    },
    validForm: function () {

        // validate signup form on keyup and submit
        $(".category_add").validate({
            errorClass: 'error error_category',
            highlight: function (element, errorClass) {
                $(element).css("border-color", "#f9616d");
            },
            unhighlight: function (element, errorClass) {
                $(element).css("border-color", "#eae8e8");
            },
            rules: {
                name: {
                    required: true,
                    cname: true,
                    minlength: 3,
                    maxlength: 50
                },
                description: {
                    minlength: 3,
                    maxlength: 500
                },
                discount_amount: {
                    minlength: 1,
                    maxlength: 10
                },
                discount_percentage: {
                    minlength: 1,
                    maxlength: 4
                }
            },
            messages: {
                name: {
                    required: "Enter the category name",
                    minlength: "Category Name must consist of at least 3 Characters",
                    maxlength: "Category name should not be more than 250 characters"
                },
                description: {
                    minlength: "Category description must be at least 3 characters",
                    maxlength: "Description is too long."
                },
                discount_amount: {
                    minlength: "Discount amount must be at least 1 digit",
                    maxlength: "Discount amount should not be more than 10 digits"
                },
                discount_percentage: {
                    minlength: "Discount percentage must be at least 1 digit",
                    maxlength: "Discount percentage should not be more than 4 digits"
                }
            }
        });
        $(".category_add").submit(function (event) {
            event.preventDefault();
            if ($('.category_add').valid()) {            // checks form for validity
                if ($('#category_value_check').val() !== '') {
                    PosnicPro.categories.categoryImageFormSubmit();
                } else {
                    $('#category_logo').val('category.svg');
                    PosnicPro.categories.category();
                }
            }
        });
    }
};

PosnicPro.categorydetails = {

    categorydetailsTable: function (type) {
        PosnicPro.appendReportTableBody('customerdetails');
        var loader = $(".loader-categoryactivity");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        var table = $('#view_categorydetails');
        if ($('a#view_categories_page').hasClass('active')) {
            var branch = [];
            branch.push(PosnicPro.local.get("branch_id_set"));
        } else {
            var branch = $("#category_branch_value").val()
        }
        if (type === 'categoryreportexport') {
            var per_page = table.data('total');
        } else {
            var current_page = table.data('current_page');
            var per_page = $('#view_categorydetails_per_page').val();
        }
        let category_id = currentHash.replace("categories/", "");
        var data = {
            page: current_page,
            limit: per_page,
            category_id: category_id,
            branch: branch
        };
        var params = {
            url: 'sales/categorySaleDetails',
            data: data
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                if (type !== 'categoryreportexport') {
                    table.data('total', response.data.table.data.total);
                    table.data('total_pages', response.data.table.data.total_pages);
                    table.data('current_page', response.data.table.data.current_page);
                    table.data('per_page', response.data.table.data.per_page);
                    PosnicPro.paging(response.data.table.data.total_pages, response.data.table.data.current_page);
                    table.children('tbody').text('');
                    $('#view_categorydetails_total,.item_details_noofsale').text(response.data.table.data.total);
                    var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                    $('#view_categorydetails_page_total').text(row_total);
                    var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                    $('#view_categorydetails_page_perpage_total').text(page_totals + response.data.table.data.list.length);
                    var currency = PosnicPro.local.get('currencySign');
                    var rowTotal = response.data.table.data.total;
                    if (rowTotal === 0) {
                        $('.categoryactivity_content').hide();
                        $('#categoryactivity_img_hide').show();

                    } else {
                        $('#categoryactivity_img_hide').hide();
                        $('.categoryactivity_content').show();
                    }
                    var process_class = "badge badge-success-inverse";
                    var saleTotalValue = 0;
                    var returnTotalValue = 0;
                    for (let i = 0; i < response.data.table.data.list.length; i++) {
                        let row = response.data.table.data.list[i];
                        saleTotalValue += Number(row.items_total) || 0;
                        returnTotalValue += Number(row.items_return_total) || 0;
                        if (!row.sale_process || row.sale_process == 'Add' || row.sale_process == 'Edit') {
                            process_class = "badge badge-success-inverse";
                        } else if (row.sale_process == 'PartialReturn') {
                            process_class = "badge badge-secondary-inverse";
                        } else {
                            process_class = "badge badge-danger-inverse";
                        }
                        let salesQty = 0;
                        $(row.items).each(function (key, val) {
                            salesQty += val.item_quantity;
                        });
                        let returnQty = 0;
                        $(row.items_return).each(function (key, val) {
                            $(val.returnArray.returnValue).each(function (key, val) {
                                returnQty += val.item_quantity;
                            });
                        });

                        let row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                        let updateDate = PosnicPro.convertDate(row.string_date);
                        let trow = '<tr> <td scope="row" data-label="#">' + row_no + '</td> <td data-label="Sale">' + row.sales_id + '</td> <td class="export-date" data-label="Date">' + updateDate + '</td> <td class="text-center" data-label="Process"><span class="' + process_class + '">' + (row.sale_process || 'Add') + '</span></td> <td class="text-center text-danger" data-label="Return qty">' + returnQty + '</td> <td class="text-right text-danger" data-label="Return total">' + currency + '&nbsp;' + (Number(row.items_return_total) || 0).toFixed(2) + '</td><td class="text-center text-success" data-label="Qty">' + salesQty + '</td><td class="text-right text-success" data-label="Total">' + currency + '&nbsp;' + (Number(row.items_total) || 0).toFixed(2) + '</td></tr>';
                        $('#view_categorydetails').children('tbody').append(trow);
                    }
                    let total = 0;
                    $('.category_details_totalsale').html('0');
                    if (response.data.sale.length !== 0) {
                        total = response.data.sale[0];
                        $('.category_details_totalsale').html(total);
                    }

                    let totalreturn = 0;
                    $('.category_details_totalreturn').html('0');
                    if (response.data.return.length !== 0) {
                        totalreturn = response.data.return[0];
                        $('.category_details_totalreturn').html(totalreturn);
                    }

                    // Prefer the server's category-revenue total (sum of this
                    // category's item line totals). The old fallback summed each
                    // sale's whole-bill total over the loaded page, counting
                    // items from other categories and changing as you paged.
                    var catSaleValue =
                        response.data.sale_amount !== undefined && response.data.sale_amount !== null
                            ? Number(response.data.sale_amount)
                            : saleTotalValue;
                    var catReturnValue =
                        response.data.return_amount !== undefined && response.data.return_amount !== null
                            ? Number(response.data.return_amount)
                            : returnTotalValue;
                    $('.category_details_saletotalvalue').html(catSaleValue.toFixed(2));
                    $('.category_details_returntotalvalue').html(catReturnValue.toFixed(2));

                } else {
                    var categorysalesreport = [];
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
                        categorysalesreport.push({SalesId: saleId, Date: date, Process: process, NoOfReturn: returnQty, ReturnAmount: returnTotal, NoOfSale: salesQty, SaleAmount: saleTotal});
                    });
                    PosnicPro.JSONToCSVConvertor(categorysalesreport, 'category-sales-reports', true);
                    PosnicPro.categorydetails.categorydetailsTable();
                }

            }
            loader.find(".loadingSpinner:first").remove();
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    categorydetailsreportexport: function (index) {
        var type = $(index).data('id');
        PosnicPro.categorydetails.categorydetailsTable(type);
    }
};

$(function () {
    $('#category_discount_percentage').attr('disabled', 'disabled').addClass('bg-white').val('0').hide();
    $("#radio_category_discount_amount, #radio_category_discount_percentage").change(function () {
        if ($("#radio_category_discount_amount").is(":checked")) {
            $('#category_discount_percentage').attr('disabled', 'disabled').addClass('bg-white').val('0').hide();
            $('#category_discount_amount').removeAttr('disabled', 'disabled').show().focus().select();
        } else {
            $('#category_discount_amount').attr('disabled', 'disabled').addClass('bg-white').val('0').hide();
            $('#category_discount_percentage').removeAttr('disabled', 'disabled').show().focus().select();
        }
    });
});

$('#upload_file_category').change(function () {
    $('#category_value_check').val(this.files[0].name);
});
$("#categories_new").on('shown.bs.modal', function () {
    $(this).find('#category_name').focus();
});
$('.categoryimageview').click(function () {
    $('#category_img_popup').modal('show');
});
$("#categorySubmitForm").one('click', function () {
    PosnicPro.categories.validForm();
});
/*end*/


/* Standard list wiring: Filter button, row click into the details
   slide-over, row action buttons that must not also open the row. */
$(document).on('click', '#categories_filter_btn', function () {
    PosnicPro.categories.mountFilters(true);
    PosnicPro.listFilter.toggle('categories');
});
$(document).on('click', '#categories_list_rows tr.categories-row', function (e) {
    if ($(e.target).closest('.cg-row-act').length) { return; }
    hasher.setHash('categories/' + $(this).data('id'));
});

$(document).on('click', '#category_tile_swatches .tile-swatch', function () {
    PosnicPro.categories.setCatTileColor($(this).data('color') || '');
});
$(document).on('click', '#category_tile_shapes .tile-shape', function () {
    var shape = $(this).data('shape') || '';
    if (($('#category_tile_shape').val() || '') === shape) { shape = ''; }
    PosnicPro.categories.setCatTileShape(shape);
});
