PosnicPro.kothistory = {
    selectedTableFilter: localStorage.getItem('kothistory_table_filter') || 'all', // Track currently selected table filter
    tableFiltersExpanded: localStorage.getItem('kothistory_filters_expanded') === null ? true : localStorage.getItem('kothistory_filters_expanded') !== 'false',
    
    kothistoryTable: function () {
        var loader = $(".loader-table-kothistory");
        $("<div class='loadingSpinner'></div>").appendTo(loader);
        PosnicPro.appendViewDataTableBody('kothistory');
        var table = $('#view_kothistory');
        var existingFilters = table.data('filters');
        var filterObj = {};
        if (existingFilters) {
            try {
                filterObj = (typeof existingFilters === 'string') ? JSON.parse(existingFilters) : existingFilters;
            } catch (e) {
                filterObj = {};
            }
        }
        filterObj.sale_process = 'KOT';
        var kotFilters = JSON.stringify(filterObj);

        // For KOT History we do not use pagination UI; always load a large slice
        // of sales data for the current branch from the first page.
        var perPage = 1000;
        var params = {
            // Reuse the same sales collection/endpoint as Sales History
            url: 'sales',
            data: {
                page: 1,
                // High limit so that KOT History effectively shows rows
                // for the branch without user-facing pagination.
                limit: perPage,
                filters: kotFilters
            }
        };
        PosnicPro.get(params, function (response) {
            if (response.type === 'success') {
                // No pagination for KOT History; just show all rows.
                table.data('total', response.data.total);
                table.children('tbody').text('');
                $('#view_kothistory_total').text(response.data.total);
                var rowTotal = response.data.total;
                if (rowTotal === 0) {
                    let dateRange = $('#view_kothistory_daterange span span[data-toggle="tooltip"]').attr('data-original-title');
                PosnicPro.renderNoRecords('.kothistory_norecord', 'No Records on ' + dateRange);
                    $('#kothistory_img_hide,.kothistory_norecord').show();
                    $('.kothistory_header').hide();
                } else {
                    $('.kothistory_norecord').empty();
                    $('#kothistory_img_hide,.kothistory_norecord').hide();
                    $('.kothistory_header').show();
                }

                // Collect unique table numbers for filter buttons
                var uniqueTables = {};
                for (var i = 0; i < response.data.list.length; i++) {
                    var row = response.data.list[i];
                    var tableNum = row.table_number || '';
                    if (tableNum && tableNum !== '') {
                        uniqueTables[tableNum] = true;
                    }
                }
                
                // Generate dynamic table filter buttons
                PosnicPro.kothistory.generateTableButtons(uniqueTables);
                
                // Restore previously selected filter state
                var savedFilter = localStorage.getItem('kothistory_table_filter') || 'all';
                PosnicPro.kothistory.selectedTableFilter = savedFilter;
                
                for (var i = 0; i < response.data.list.length; i++) {
                    var row = response.data.list[i];
                    let table_number = row.table_number || '';
                    let dine_type = row.dine_type || '';
                    let person_count = (typeof row.person_count !== 'undefined' && row.person_count !== null) ? row.person_count : '';
                    var row_no = i + 1;

                    var toolbarOptionsId = 'kothistory-onclick-toolbar-options_' + i;
                    var toolbarButtonId = 'kothistory-onclick-toolbar_' + i;

                    var action =
                        '<div id="' + toolbarOptionsId + '" class="hidden">' +
                        '  <a href="javascript:void(0);" class="point-cursor mobile_tooltip" data-toggle="tooltip" title="View" data-t-title="lang_view" onclick="PosnicPro.kothistory.view(\'' + row._id + '\')"><i class="feather icon-eye"></i></a>' +
                        '  <a href="javascript:void(0);" class="point-cursor mobile_tooltip" data-toggle="tooltip" title="Edit KOT" data-t-title="lang_edit_kot" onclick="PosnicPro.kothistory.edit(\'' + row._id + '\')"><i class="feather icon-edit-1"></i></a>' +
                        '  <a href="javascript:void(0);" class="point-cursor mobile_tooltip" data-toggle="tooltip" title="Settlement" data-t-title="lang_settlement" onclick="PosnicPro.kothistory.proceed(\'' + row._id + '\')"><i class="feather icon-arrow-right-circle"></i></a>' +
                        '  <a href="javascript:void(0);" class="point-cursor mobile_tooltip" data-toggle="tooltip" title="Sale Print" data-t-title="lang_saleprint" onclick="PosnicPro.kothistory.print(\'' + row._id + '\')"><i class="feather icon-printer"></i></a>' +
                        '  <a href="javascript:void(0);" class="point-cursor mobile_tooltip text-danger" data-toggle="tooltip" title="Cancel" data-t-title="lang_cancel_title" onclick="PosnicPro.kothistory.cancel(\'' + row._id + '\')"><i class="feather icon-x-circle"></i></a>' +
                        '</div>' +
                        '<div data-toolbar="user-options" class="btn btn-round btn-primary-rgba round-pad" id="' + toolbarButtonId + '"><i class="feather icon-more-vertical-"></i></div>';

                    var updateDate = PosnicPro.convertDate(row.string_date);

                    $('#date_view').html(updateDate);
                    var trow = '<tr data-table-number="' + table_number + '">' +
                        '<td scope="row" data-label="#">' + row_no + '</td>' +
                        '<td class="sale_id" data-label="Sale">' + row.sales_id + '</td>' +
                        '<td class="sale_id" data-label="Date">' + updateDate + '</td>' +
                        '<td class="text-center table-number-hide" data-label="Table"><span>' + table_number + '</span></td>' +
                        '<td class="text-center" data-label="Guests"><span>' + person_count + '</span></td>' +
                        '<td class="text-center order-type-column" data-label="Order type"><span>' + dine_type + '</span></td>' +
                        '<td class="text-center"><span>' + action + ' </span></td>' +
                        '</tr>';
                    $('#view_kothistory').children('tbody').append(trow);
                }
                if (PosnicPro.local.get('table_options') === 'enable') {
                    $('.table-number-hide').show();
                    $('.table-phone-hide').hide();
                    $('.order-type-column').show();
                } else {
                    $('.table-number-hide').hide();
                    $('.table-phone-hide').show();
                    $('.order-type-column').hide();
                }
                PosnicPro.setSelectedCheckbox(PosnicPro["kothistory_checkbox"], 'kothistory');
                PosnicPro.ACLForModule('kothistory');
                
                // Restore button active state based on saved filter
                $('#kothistory_table_filter_buttons button').removeClass('active btn-primary').addClass('btn-outline-primary');
                var savedFilter = localStorage.getItem('kothistory_table_filter') || 'all';
                $('#kothistory_table_filter_buttons button[data-table="' + savedFilter + '"]').removeClass('btn-outline-primary').addClass('active btn-primary');
                
                // Apply current table filter
                PosnicPro.kothistory.applyTableFilter();

                // Initialize onclick toolbar for KOT History actions similar to Sales History
                $(document).ready(function () {
                    for (var k = 0; k < response.data.list.length; k++) {
                        $('#kothistory-onclick-toolbar_' + k).toolbar({
                            content: '#kothistory-onclick-toolbar-options_' + k,
                            event: 'click',
                            style: 'primary',
                            hideOnClick: true
                        });

                        $('#kothistory-onclick-toolbar_' + k).on('toolbarItemClick', function () {
                            $(this).trigger('click');
                            $('.mobile_tooltip').tooltip('hide');
                        });
                    }
                });

                loader.find(".loadingSpinner:first").remove();
            } else {
                loader.find(".loadingSpinner:first").remove();
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            loader.find(".loadingSpinner:first").remove();
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },
    showDataTablePage: function () {
        PosnicPro.sales.recentSaleAction = false;
        var loader = $(".loader-table-kothistory");
        loader.find(".loadingSpinner:first").remove();
        if (PosnicPro.dashboard && typeof PosnicPro.dashboard.datePicker === 'function') {
            PosnicPro.dashboard.datePicker();
        }
        PosnicPro.HideSideBarModal();
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $(".vertical-layout").removeClass("toggle-menu");
        $(".vertical-menu li a").removeClass("active");
        $('#v-pills-dashboard-tab,#view_kothistory_page').addClass('active');
        $('#v-pills-dashboard').addClass('show active');
        $('.page_loader,#osk-container,#closeSaleButton,#closeEditButton').hide();
        $('.page-title-box,#kothistory').show();
        PosnicPro.kothistory.kothistoryTable('kothistory');
        $('#image_sidebar_dashboard,#image_sidebar_newsale').hide();
        $('.dashboard_img_menu').hide();
        $('#image_sidebar_salehistry').show();
        var balanceLoader = $(".loader-sales-balance");
        balanceLoader.find(".loadingSpinner:first").remove();
    },

    edit: function (id) {
        PosnicPro.kotorder = PosnicPro.kotorder || {};
        PosnicPro.kotorder.editSaleId = id;

        if (typeof hasher !== 'undefined') {
            hasher.setHash('kotorder/' + id + '/edit');
        } else {
            window.location.hash = '#/kotorder/' + id + '/edit';
        }
    },

    proceed: function (id) {
        // From KOT History, open payment (tender) directly in payment-only mode
        if (PosnicPro && PosnicPro.sales && typeof PosnicPro.sales.showPayment === 'function') {
            PosnicPro.sales.saleProcess = 'edit';
            PosnicPro.kotorder = PosnicPro.kotorder || {};
            PosnicPro.kotorder.editSaleId = null;
            PosnicPro.kotorder.Settlement = true;
            PosnicPro.sales.kotPaymentMode = true;
            
            // Check if we're on KOT page (not KOT history page)
            var currentHash = window.location.hash;
            if (currentHash === '#/kot' || currentHash === '#kot') {
                PosnicPro.kotorder.returnToKOT = true;
            }
            
            PosnicPro.sales.showPayment(id);
        }
    },

    print: function (id) {
        if (PosnicPro && PosnicPro.sales && PosnicPro.sales.view && typeof PosnicPro.sales.view.printSale === 'function') {
            // KOT History specific print: hide payment/payment status on the receipt
            PosnicPro.sales.view.printSale(id, 'sale', true);
        }
    },

    // Print for the currently opened KOT Details view modal. This simply
    // reuses the existing KOT History print behaviour so both icons work
    // identically.
    printCurrent: function () {
        var currentId = $('#kot_view_modal').data('sale-id');
        if (currentId) {
            PosnicPro.kothistory.print(currentId);
        }
    },

    cancel: function (id) {
        PosnicPro.deleteConfirmation = false;
        PosnicPro.record_url = 'sales';
        $('.deleteCountValue').html('1');

        // When the delete modal is shown from KOT History, override its
        // contents to use cancel wording, then restore on close.
        $('#delete_modal').one('shown.bs.modal', function () {
            var $modal = $(this);
            $modal.data('kot-history-cancel', true);

            var $title = $modal.find('.modal-title').first();
            if (!$title.data('original-html')) {
                $title.data('original-html', $title.html());
            }

            var $row = $modal.find('.modal-body .row.justify-content-center').first();
            var $countLine = $row.find('h6').eq(0);
            var $questionLine = $row.find('h6').eq(1);

            if ($questionLine.length && !$questionLine.data('original-html')) {
                $questionLine.data('original-html', $questionLine.html());
            }

            var $removeText = $row.find('.removeText');
            if ($removeText.length && !$removeText.data('original-remove')) {
                $removeText.data('original-remove', $removeText.text());
            }

            // Apply overrides after other handlers (like i18n) have run. We
            // use .html() so the inner <lang> tags are replaced, preventing
            // the language layer from resetting the text back to "Delete".
            setTimeout(function () {
                $title.html(PosnicPro.i18n.t('lang_cancel_record', 'Cancel Record '));
                if ($removeText.length) {
                    $removeText.text(PosnicPro.i18n.t('lang_selected_details_will_be_canceled', 'Selected details will be canceled'));
                }
                if ($questionLine.length) {
                    $questionLine.html(PosnicPro.i18n.t('lang_are_you_sure_want_to_cancel_this_record', 'Are you sure want to cancel this record ?'));
                }
                $modal.find('.removetransactiontext').hide();
            }, 0);
        });

        $('#delete_modal').one('hidden.bs.modal', function () {
            var $modal = $(this);
            if (!$modal.data('kot-history-cancel')) {
                return;
            }
            $modal.removeData('kot-history-cancel');

            var $title = $modal.find('.modal-title').first();
            var originalTitleHtml = $title.data('original-html');
            if (originalTitleHtml) {
                $title.html(originalTitleHtml);
            }

            var $row = $modal.find('.modal-body .row.justify-content-center').first();
            var $questionLine = $row.find('h6').eq(1);
            var originalQuestionHtml = $questionLine.data('original-html');
            if (originalQuestionHtml) {
                $questionLine.html(originalQuestionHtml);
            }

            var $removeText = $row.find('.removeText');
            var originalRemove = $removeText.data('original-remove');
            $removeText.text(originalRemove || 'Selected details will be deleted');

            $modal.find('.removetransactiontext').show();
        });

        PosnicPro.callbackRegistry = {
            name: 'kothistoryCancelConfirmed',
            arguments: id
        };
        $('#delete_modal').modal('show');
    },

    view: function (id) {
        var loader = $(".loader-view-kot");
        $("<div class='loadingSpinner'></div>").appendTo(loader);

        PosnicPro.get('sales/' + id, function (response) {
            if (response.type === 'success') {
                var data = response.data;

                // Remember which KOT sale is currently being viewed so that
                // the modal-level Print button can reuse the same logic as
                // the list toolbar Print icon.
                $('#kot_view_modal').data('sale-id', id);

                // Populate the modal fields
                $('#kot_view_sales_id').text(data.sales_id || '');

                var updateDate = PosnicPro.convertDate(data.date);
                $('#kot_view_date').text(updateDate || '');

                var dineType = data.dine_type || '';
                $('#kot_view_dine_type').text(dineType);

                var tableNumber = data.table_number || '-';
                $('#kot_view_table_number').text(tableNumber);

                var personCount = (typeof data.person_count !== 'undefined' && data.person_count !== null) ? data.person_count : '-';
                $('#kot_view_pax').text(personCount);

                // Build items table
                var itemsHtml = '';
                if (data.items && data.items.length > 0) {
                    for (var i = 0; i < data.items.length; i++) {
                        var item = data.items[i];
                        var itemName = item.item_name || '';
                        var itemQty = item.item_quantity || 0;

                        itemsHtml += '<tr>' +
                            '<td>' + (i + 1) + '</td>' +
                            '<td>' + itemName + '</td>' +
                            '<td class="text-center">' + itemQty + '</td>' +
                            '</tr>';
                    }
                } else {
                    itemsHtml = '<tr><td colspan="3" class="text-center text-muted"><lang class="lang_no_items">No items</lang></td></tr>';
                }
                $('#kot_view_items_tbody').html(itemsHtml);

                loader.find(".loadingSpinner:first").remove();
                $('#kot_view_modal').modal('show');
            } else {
                loader.find(".loadingSpinner:first").remove();
                PosnicPro.alert(response.type, response.message);
            }
        }, function (xhr) {
            loader.find(".loadingSpinner:first").remove();
            var err = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(err.type, err.message);
        });
    },
    
    generateTableButtons: function(uniqueTables) {
        var $buttonContainer = $('#kothistory_table_filter_buttons');
        
        // Keep the "All Time" button, remove other dynamic buttons
        $buttonContainer.find('button[data-table!="all"]').remove();
        
        // Sort table numbers
        var tableNumbers = Object.keys(uniqueTables).sort(function(a, b) {
            var numA = parseInt(a) || 0;
            var numB = parseInt(b) || 0;
            return numA - numB;
        });
        
        // Add button for each table
        for (var i = 0; i < tableNumbers.length; i++) {
            var tableNum = tableNumbers[i];
            var btnHtml = '<button type="button" class="btn btn-outline-primary" data-table="' + tableNum + '" onclick="PosnicPro.kothistory.filterByTable(\'' + tableNum + '\')" style="min-width: 60px; font-weight: 500;">Table ' + tableNum + '</button>';
            $buttonContainer.append(btnHtml);
        }
    },
    
    filterByTable: function(tableNumber) {
        // Update selected filter
        PosnicPro.kothistory.selectedTableFilter = tableNumber;
        
        // Save filter state to localStorage
        localStorage.setItem('kothistory_table_filter', tableNumber);
        
        // Update button states
        $('#kothistory_table_filter_buttons button').removeClass('active btn-primary').addClass('btn-outline-primary');
        $('#kothistory_table_filter_buttons button[data-table="' + tableNumber + '"]').removeClass('btn-outline-primary').addClass('active btn-primary');
        
        // Apply filter
        PosnicPro.kothistory.applyTableFilter();
    },
    
    applyTableFilter: function() {
        var selectedTable = PosnicPro.kothistory.selectedTableFilter;
        
        if (selectedTable === 'all') {
            // Show all rows
            $('#view_kothistory tbody tr').show();
        } else {
            // Hide all rows first
            $('#view_kothistory tbody tr').hide();
            // Show only rows matching the selected table
            $('#view_kothistory tbody tr[data-table-number="' + selectedTable + '"]').show();
        }
    }
};

PosnicPro.kothistoryCancelConfirmed = function (id) {
    var loader = $(".loader-table-kothistory");
    $("<div class='loadingSpinner'></div>").appendTo(loader);

    PosnicPro.deleteConfirmation = false;

    PosnicPro.get('sales/' + id, function (response) {
        if (response.type === 'success') {
            var data = response.data || {};
            var items = [];

            if (data.items && data.items.length) {
                for (var i = 0; i < data.items.length; i++) {
                    var item = data.items[i];
                    items.push({
                        product_id: item.item_id || '',
                        quantity: item.item_quantity || 0,
                        price: item.item_price || 0
                    });
                }
            } else {
                items.push({ product_id: '', quantity: 0, price: 0 });
            }

            var params = {
                url: 'sales/updateOrder',
                data: JSON.stringify({
                    order_id: data._id || data.id || id,
                    items: items,
                    total_amount: data.sales_total || 0,
                    status: 'cancelled',
                    extra_discount_type: data.extra_discount_type || null,
                    extra_discount: data.extra_discount || 0,
                    discount_description: data.discount_description || '',
                    table_number: data.table_number || '',
                    dine_type: data.dine_type || ''
                })
            };

            PosnicPro.put(params, function (res) {
                loader.find(".loadingSpinner:first").remove();
                PosnicPro.alert(res.type, res.message);
                if (res.type === 'success') {
                    // Check if we're on KOT page (not KOT history page)
                    var currentHash = window.location.hash;
                    if (currentHash.indexOf('#/kot') === 0 || currentHash.indexOf('#kot') === 0) {
                        // On KOT page, refresh data
                        if (PosnicPro.kot && typeof PosnicPro.kot.refreshKOTData === 'function') {
                            PosnicPro.kot.refreshKOTData();
                        }
                    } else {
                        // On KOT history page, reload table
                        PosnicPro.kothistory.kothistoryTable('kothistory');
                    }
                }
            }, function (xhr) {
                loader.find(".loadingSpinner:first").remove();
                var err = jQuery.parseJSON(xhr.responseText);
                PosnicPro.alert(err.type, err.message);
            });
        } else {
            loader.find(".loadingSpinner:first").remove();
            PosnicPro.alert(response.type, response.message);
        }
    }, function (xhr) {
        loader.find(".loadingSpinner:first").remove();
        var err = jQuery.parseJSON(xhr.responseText);
        PosnicPro.alert(err.type, err.message);
    });
};
