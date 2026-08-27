PosnicPro.lowstockitems = {
    lowstockitemsTable: function () {
        var loader = $(".loader-table-lowstock");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        PosnicPro.appendViewDataTableBody('lowitem');
        var table = $('#view_lowstockitems');
        var notificationValue = localStorage.getItem("notificationrange");
        var params = {
            url: 'items/itemLowStockTable',
            data: {
                page: table.data('current_page'),
                limit: parseInt($('#view_lowstockitems_per_page  option:selected').text()),
                filters: table.data('filters'),
                notificationrange: notificationValue
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
                $('#view_lowstockitems_total').text(response.data.total);

                var rowTotal = response.data.total;
                if (rowTotal === 0) {
                    $('.lowstock_header').hide();
                    let dateRange = $('#view_sales_daterange span span[data-toggle="tooltip"]').attr('data-original-title');
                    $('.lowstock_norecord').empty().append('<div class="text-center text-dark"> <p>No Records on ' + dateRange + ' </p></div>');
                    $('#lowstock_img_hide,.lowstock_norecord').show();

                } else {
                    $('.lowstock_norecord').empty();
                    $('#lowstock_img_hide,.lowstock_norecord').hide();
                    $('.lowstock_header').show();
                }
                var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                $('#view_lowstockitems_page_total').text(row_total);
                var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                $('#view_lowstockitems_page_perpage_total').text(page_totals + response.data.list.length);
                for (var i = 0; i < response.data.list.length; i++) {
                    var row = response.data.list[i];
                    var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                    var image_path = (row.image !== "item.svg") ? row.image : 'static/images/default/' + row.image;
                    var action = '<div id="onclick-toolbar-options_' + i + '" class="hidden">' +
                            '<a data-module="lowstockitems" data-access="read" href="#/lowstockitems/' + row._id + '" id="' + row._id + '" data-id="lowstockitems/' + row._id + '" data-toggle="tooltip" title="View Items" class="point-cursor mobile_tooltip"><i class="feather icon-eye"></i></a>' +
                            '<a data-module = "receiving" data-access = "write" href="#/receivings/new"  id="' + row._id + '" data-id="receivings/new" onclick="PosnicPro.lowstockitems.loadLowStockValue(this.id)"  data-toggle="tooltip" title="Add Stock" class="point-cursor mobile_tooltip"><i class="feather icon-plus mr-2"></i></a>' +
                            '</div>' +
                            '<div data-toolbar="user-options" class="btn btn-round btn-primary-rgba round-pad" id="onclick-toolbar_' + i + '"><i class="feather icon-more-vertical-"></i></div>';
                    var trow = '<tr> <td scope="row">' + row_no + '</td>  <td>' + row.name + '</td> <td><img loading="lazy" decoding="async" src=' + image_path + ' class="imagezoom table_img_alter" id="' + row.image + '" onclick="PosnicPro.viewImage(this.id,\'item\');"></td> <td class="text-center">' + row.itemid + '</td> <td>' + row.supplier_name + '</td> <td>' + row.category_name + '</td> <td class="text-center">' + row.available_quantity + '</td> ' +
                            '<td class="text-center"><span>' + action + '</span></td>' +
                            '</tr>';
                    $('#view_lowstockitems').children('tbody').append(trow);
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
                PosnicPro.ACLForModule('receiving');
                loader.find(".loadingSpinner:first").remove();
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    loadLowStockValue: function (id) {
        var loader = $(".loader-low_stock");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        PosnicPro.get('items/' + id, function (response) {
            loader.find(".loadingSpinner:first").remove();
            PosnicPro.receivings.clearReceivingForm();
            var data = response.data;
            var itemDetails = {
                "item_id": data.id,
                "item_name": data.name,
                "company_price": data.company_price,
                "barcode_id": data.barcode_id,
                "item_quantity": data.available_quantity,
                "discount_amount": data.discount_amount,
                "discount_percentage": data.discount_percentage,
                "tax": data.tax,
                "supplier": data.supplier_name
            };
            PosnicPro.receivings.addReceivingLineItems(itemDetails);
            PosnicPro.get('suppliers/' + data.supplier_id, function (response) {
                if (response.type === 'success') {
                    let supplierData = response.data;
                    $('#receiving_add_supplier_id').val(supplierData._id);
                    $('#receiving_add_supplier_name').val(supplierData.name);
                    $('#receiving_add_supplier_address').val(supplierData.address);
                    $('#receiving_add_supplier_phone').val(supplierData.phone);
                    $('#receiving_add_supplier_email').val(supplierData.email);
                    $('#receiving_add_supplier_state').val(supplierData.state);
                    $('#receiving_add_supplier_gst_type').val(supplierData.gst_type);
                    $('#receiving_add_supplier_gst_number').val(supplierData.gst_number);
                }
            });
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    showDataTablePage: function () {
        var loader = $(".loader-table-lowstock");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.HideSideBarModal();
        $('.page_loader,#osk-container').hide();
        $('.page-title-box,#lowstockitems').show();
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $(".vertical-layout").removeClass("toggle-menu");
        $(".vertical-menu li a").removeClass("active");
        $('#v-pills-inventory-tab').addClass('active');
        $('#v-pills-inventory').addClass('show active');
        $('.vertical-menu li a#view_itemslow_page').addClass('active');
        PosnicPro.lowstockitems.lowstockitemsTable('lowstockitems');
        $('.dashboard_img_menu').hide();
        $('#image_sidebar_lowstock').show();
    },
    showDetails: function (id) {
        hasher.setHash('lowstockitems/' + id);
        hasher.setHash('items/' + id);
    }
};
