PosnicPro.stocklogs = {
    showDelete: function (id) {
        PosnicPro.deleteTableRowData(id, 'stocklogs');
    },
    showDetails: function (id) {
        var loader = $(".loader-view-stocklog");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.stocklogs.viewStock(id);
    },
    showModuleDetails: function (id) {
        PosnicPro.items.viewItem(id);
    },
    stocklogsTable: function () {
        var loader = $(".loader-table-stocklog");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        PosnicPro.appendViewDataTableBody('stocklog');
        var table = $('#view_stocklogs');
        var params = {
            url: 'stocklogs',
            data: {
                page: table.data('current_page'),
                limit: parseInt($('#view_stocklogs_per_page  option:selected').text()),
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
                $('#view_stocklogs_total').text(response.data.total);

                var rowTotal = response.data.total;
                if (rowTotal === 0) {
                    $('.stock_header').hide();
                    let dateRange = $('#view_sales_daterange span span[data-toggle="tooltip"]').attr('data-original-title');
                    $('.stock_norecord').empty().append('<div class="text-center text-dark"> <p>No Records on ' + dateRange + ' </p></div>');
                    $('#stock_img_hide,.stock_norecord').show();

                } else {
                    $('.stock_norecord').empty();
                    $('#stock_img_hide,.stock_norecord').hide();
                    $('.stock_header').show();
                }

                var row_total = (table.data('current_page') - 1) * table.data('per_page') + 1;
                $('#view_stocklogs_page_total').text(row_total);
                var page_totals = (table.data('current_page') - 1) * table.data('per_page');
                $('#view_stocklogs_page_perpage_total').text(page_totals + response.data.list.length);
                for (var i = 0; i < response.data.list.length; i++) {
                    var row = response.data.list[i];
                    var row_no = (table.data('current_page') - 1) * table.data('per_page') + i + 1;
                    var updateDate = PosnicPro.convertDate(row.string_date);

                    var process_class = "";
                    if (row.process === "Add Item" || row.process === "Add Sale" || row.process === "Add Receiving") {
                        process_class = "badge badge-success-inverse";
                    } else if (row.process === "Edit Item" || row.process === "Edit Sale" || row.process === "Edit Receiving") {
                        process_class = "badge badge-primary-inverse";
                    } else if (row.process === "Delete Sale" || row.process === "Delete Receiving" || row.process === "Delete Item") {
                        process_class = "badge badge-danger-inverse";
                    } else {
                        process_class = "badge badge-secondary-inverse";
                    }

                    var action = '<div id="onclick-toolbar-options_' + i + '" class="hidden">' +
                            '<a data-module = "item" data-access = "read" href="#/stocklogs/' + row._id + '" data-id="stocklogs/' + row._id + '"  data-toggle="tooltip" title="View" class="point-cursor mobile_tooltip"><i class="feather icon-eye"></i></a>' +
//                            '<a data-module = "user" data-access = "delete" href="#/stocklogs/' + row._id + '/delete" data-id="stocklogs/' + row._id + '/delete" data-toggle="tooltip" title="Delete Log" class="point-cursor mobile_tooltip"><i class="feather icon-trash"></i></a>' +
                            '</div>' +
                            '<div data-toolbar="user-options" class="btn btn-round btn-primary-rgba round-pad" id="onclick-toolbar_' + i + '"><i class="feather icon-more-vertical-"></i></div>';

                    // Escape the free-text note before it goes into the row (it
                    // is user-entered, unlike the fixed process labels).
                    var noteEsc = row.note ? $('<div>').text(row.note).html() : '';
                    var trow = '<tr><td data-module="item" data-access="write"><input type="checkbox" class="stocklogs-row-id" id="' + row._id + '" name="id[]" value="' + row._id + '" onclick="PosnicPro.checkboxSelectOne(this,\'stocklogs\');"></td> <td scope="row">' + row_no + '</td> <td width="30%">' + row.item_name + '</td><td>' + updateDate + '</td> <td class="text-center"><span class="' + process_class + '">' + row.process + '</span>' + (noteEsc ? '<div class="text-muted" style="font-size:11px;margin-top:3px;white-space:normal;word-break:break-word;">' + noteEsc + '</div>' : '') + '</td><td class="text-center">' + row.changed_by + '</td><td class="text-right"><span>' + row.opening_balance + '</span></td><td class="text-right">' + row.count + '</td><td class="text-right"><span>' + row.closing_balance + '</span></td> ' +
                            '<td class="text-center"> <span>' + action + ' </span>' +
                            ' </td></tr>';
                    $('#view_stocklogs').children('tbody').append(trow);
                }
                $('span.number').number(true, 2);
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
                PosnicPro.setSelectedCheckbox(PosnicPro["stocklogs_checkbox"], 'stocklogs');
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
        var loader = $(".loader-table-stocklog");
        loader.find(".loadingSpinner:first").remove();
        PosnicPro.dashboard.datePicker();
        PosnicPro.HideSideBarModal();
        $(".vertical-layout").removeClass("toggle-menu");
        $(".vertical-menu li a").removeClass("active");
        $('.dropdown-item').removeClass('active');
        $('.page_loader,#osk-container').hide();
        $('.page-title-box,#stocklogs').show();
        PosnicPro.stocklogs.stocklogsTable('stocklogs');
        $('#v-pills-inventory-tab').addClass('active');
        $('#v-pills-inventory').addClass('show active');
        $('.dashboard_img_menu').hide();
        $('#image_sidebar_inventory').show();
    },
    //view stored database details in stocklog activity
    viewStock: function (id) {
        var loader = $(".loader-view-stocklog");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        PosnicPro.get('stocklogs/' + id, function (response) {
            if (response.type === 'success') {
                PosnicPro.stocklogs.viewStockData(response);
                loader.find(".loadingSpinner:first").remove();
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
        return false;
    },
    viewStockData: function (response) {
        $('#view_stock_log').modal('show');
        var data = response.data;
        if (data.opening_balance === 'N/A' || data.closing_balance === 'N/A') {
            $('.hiddenText').hide();
        } else {
            $('.hiddenText').show();
        }
        $.each(data, function (key, val) {
            if (val === '') {
                $('#view_stock_' + key).text('');
            } else {
                $('#view_stock_' + key).text(val);
            }
        });


        var updateCreateDate = PosnicPro.convertDate(data.created_date);
        $('#view_stock_date').text(updateCreateDate);
    },
    /*Display the low stock of item details like  only display below 10 available quantity of each item */
    viewLowStockDashboard: function () {
        var notificationValue = localStorage.getItem("notificationrange");
        var params = {
            url: 'items/quantityCount',
            data: {
                notificationrange: notificationValue
            }
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                var data = response.data;
                $('#low_item_stock_count').text(data.count);
                var totalCount = parseInt(data.count);
                $('#list_lowstock_name').html('');
                $(data.list).each(function (key, val) {
                    var branch_value = '<li class="media dropdown-item">' +
                            '<span class="badge badge-secondary-inverse">' + (key + 1) + '</span>&nbsp;&nbsp;' +
                            '<div class="media-body">' +
                            '<h5 class="action-title" width="30%">' + PosnicPro.textOverflowEllipsis(val.name, 30, true) + '</h5>' +
                            '<p><span class="timing">' + val.date + '</span></p>' +
                            '</div>' +
                            '</li>';
                    $('#list_lowstock_name').append(branch_value);
                });
                // The bell is the ONE notification centre now (activity feed +
                // push opt-in live in the same dropdown), so zero low stock
                // only hides the low-stock SECTION - it must never strip the
                // dropdown behaviour off the bell like it used to.
                if (totalCount === 0) {
                    $('.lowstock-section').hide();
                    $('#low_item_stock_count').hide();
                } else {
                    $('.lowstock-section').show();
                    $('#low_item_stock_count').show();
                }
                let loader = $(".loader-login");
                loader.find(".loadingSpinner:first").remove();
            } else {
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    exportStocklogs: function () {
        PosnicPro.exportTableData(PosnicPro.stocklogs_checkbox, 'stocklogs');
    },
    deleteSelectedStocklogs: function () {
        PosnicPro.deleteTableData(PosnicPro.stocklogs_checkbox, 'stocklogs');
    }
};