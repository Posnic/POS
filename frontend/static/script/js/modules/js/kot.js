PosnicPro.kot = {
    currentTableNumber: null,
    currentTableId: null,

    showDataTablePage: function (module, table_number) {
        PosnicPro.sales.recentSaleAction = false;
        var loader = $(".loader-table-kot");
        loader.find(".loadingSpinner:first").remove();

        if (PosnicPro.dashboard && typeof PosnicPro.dashboard.datePicker === 'function') {
            PosnicPro.dashboard.datePicker();
        }

        PosnicPro.HideSideBarModal();
        $('.nav-link-active,.tab-pane-active,.dropdown-item').removeClass('active');
        $(".vertical-layout").removeClass("toggle-menu");
        $(".vertical-menu li a").removeClass("active");
        $('#v-pills-dashboard-tab,#view_kot_page').addClass('active');
        $('#v-pills-dashboard').addClass('show active');
        $('.page_loader,#osk-container,#closeSaleButton,#closeEditButton').hide();
        $('.page-title-box,#kot').show();

        // Load tables first, then select the specified table if provided
        if (table_number) {
            console.log('Loading KOT page with table:', table_number);
            PosnicPro.kot.loadTables(function () {
                // After tables are loaded, check if the table exists and has KOTs
                PosnicPro.kot.selectTableFromURL(table_number);
            });
        } else {
            PosnicPro.kot.loadTables();
            // Clear KOT details panel when no table is selected
            var detailsPanel = $('#kot_table_details');
            var emptyStateHtml = '<div class="text-center" style="padding: 100px 20px; color: #6c757d;"><i class="feather icon-arrow-left" style="font-size: 48px; margin-bottom: 20px; opacity: 0.3;"></i><p style="font-size: 16px; margin: 0;">Select a table from the left to view KOT details</p></div>';
            detailsPanel.html(emptyStateHtml);
        }

        $('#image_sidebar_dashboard,#image_sidebar_newsale').hide();
        $('.dashboard_img_menu').hide();
        $('#image_sidebar_salehistry').show();

        var balanceLoader = $(".loader-sales-balance");
        balanceLoader.find(".loadingSpinner:first").remove();
    },

    selectedTable: null,

    goToSalesWithTable: function (table_number, pax_count) {
        console.log('Going to sales with table:', table_number, 'PAX:', pax_count);

        // Set up sales context
        PosnicPro.sales = PosnicPro.sales || {};
        
        // ✅ Reset submission flag before navigating to sales
        PosnicPro.sales.submissionInProgress = false;
                $("#save_btn").prop('disabled', false);
                $("#save_submit").removeClass('disabled');
        
        PosnicPro.sales.saleProcess = 'KOT';
        PosnicPro.sales.selectedTable = {
            id: table_number === 'TA' ? 'TA' : 'table_' + table_number,
            tableNumber: table_number
        };

        // Set up KOT order context
        PosnicPro.kotorder = PosnicPro.kotorder || {};
        PosnicPro.kotorder.kotTableNumber = table_number;
        PosnicPro.kotorder.kotOrderType = table_number === 'TA' ? 'Take away' : 'Dine-in';
        PosnicPro.kotorder.kotPersonCount = parseInt(pax_count) || 0;
        PosnicPro.kotorder.selectedPerson = parseInt(pax_count) || 0;

        // Set dine type
        $('#sale_dine_type').val(table_number === 'TA' ? 'Take away' : 'Dine-in');
        
        // ✅ Reset button states
        $("#save_btn").prop('disabled', false);
        $("#save_submit").removeClass('disabled');

        console.log('Navigating to sales/new with pre-filled data');

        // Navigate to sales page
        if (typeof hasher !== 'undefined') {
            hasher.setHash('sales/new');
        } else {
            window.location.hash = '#/sales/new';
        }
    },

    selectTableFromURL: function (table_number) {
        console.log('Selecting table from URL:', table_number);

        // Check if table exists in the loaded table list (DOM)
        // loadTables API already filters tables with active orders
        var tableBox = $('[data-table-number="' + table_number + '"]');

        if (tableBox.length > 0) {
            // Table exists in DOM, meaning it has active KOTs
            var tableId = tableBox.data('table-id');
            console.log('Table found in loaded list, selecting:', table_number);

            // Set current table
            PosnicPro.kot.currentTableNumber = table_number;
            PosnicPro.kot.currentTableId = tableId;

            // Highlight the table
            $('.kot-table-box').css({
                'background': 'white',
                'transform': 'scale(1)',
                'box-shadow': 'none'
            });
            tableBox.css({
                'background': '#e3f2fd',
                'transform': 'scale(1.05)',
                'box-shadow': '0 4px 8px rgba(33, 150, 243, 0.3)'
            });

            // Load table details
            PosnicPro.kot.loadTableDetails(table_number);
        } else {
            // Table not in DOM = no active KOTs, redirect to #/kot
            console.log('Table not in loaded list (no active KOTs), redirecting to #/kot');
            if (typeof hasher !== 'undefined') {
                hasher.changed.active = false;
                hasher.setHash('kot');
                hasher.changed.active = true;
            } else {
                window.location.hash = '#/kot';
            }
            // Clear current table and show empty state
            PosnicPro.kot.currentTableNumber = null;
            PosnicPro.kot.currentTableId = null;
            var detailsPanel = $('#kot_table_details');
            var emptyStateHtml = '<div class="text-center" style="padding: 100px 20px; color: #6c757d;"><i class="feather icon-arrow-left" style="font-size: 48px; margin-bottom: 20px; opacity: 0.3;"></i><p style="font-size: 16px; margin: 0;">Select a table from the left to view KOT details</p></div>';
            detailsPanel.html(emptyStateHtml);
        }
    },

    loadTables: function (callback) {
        var loader = $(".loader-table-kot");
        $("<div class='loadingSpinner'></div>").appendTo(loader);

        // Use optimized API to get only tables with active orders
        PosnicPro.get('sales/getTablesWithActiveOrders', function (response) {
            loader.find(".loadingSpinner:first").remove();

            if (response.type === 'success' && response.data) {
                var tables = response.data.tables || [];
                var hasTakeaway = response.data.has_takeaway || false;

                $('#kot_tables_grid').empty();

                // Render only tables with active orders
                if (tables.length > 0 || hasTakeaway) {
                    $('#kot_no_tables').hide();

                    // Render table boxes for tables with orders (already sorted by backend)
                    tables.forEach(function (tableNumber) {
                        var table = {
                            tableorder_id: 'table_' + tableNumber,
                            tableorder_value: tableNumber,
                            isCustom: false
                        };
                        PosnicPro.kot.renderTableBox(table);
                    });

                    // Add Takeaway as TA table box if it has active orders
                    if (hasTakeaway) {
                        var taTable = {
                            tableorder_id: 'takeaway_ta',
                            tableorder_value: 'TA',
                            isCustom: false
                        };
                        PosnicPro.kot.renderTableBox(taTable);
                    }
                } else {
                    $('#kot_no_tables').show();
                }

                // Call callback if provided
                if (callback && typeof callback === 'function') {
                    callback(tables, hasTakeaway);
                }
            } else {
                $('#kot_tables_grid').empty();
                $('#kot_no_tables').show();
            }
        }, function (xhr) {
            loader.find(".loadingSpinner:first").remove();
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },


    renderCustomTables: function () {
        // Load custom table numbers from localStorage
        var customTables = PosnicPro.kot.getCustomTables();
        if (customTables && customTables.length > 0) {
            customTables.forEach(function (tableNumber) {
                var customTable = {
                    tableorder_id: 'custom_' + tableNumber,
                    tableorder_value: tableNumber,
                    isCustom: true
                };
                PosnicPro.kot.renderTableBox(customTable);
            });
        }
    },

    getCustomTables: function () {
        try {
            var tables = localStorage.getItem('kot_custom_tables');
            return tables ? JSON.parse(tables) : [];
        } catch (e) {
            return [];
        }
    },

    addCustomTable: function (tableNumber) {
        var customTables = PosnicPro.kot.getCustomTables();
        if (customTables.indexOf(tableNumber) === -1) {
            customTables.push(tableNumber);
            localStorage.setItem('kot_custom_tables', JSON.stringify(customTables));
        }
    },

    removeCustomTable: function (tableNumber) {
        var customTables = PosnicPro.kot.getCustomTables();
        var index = customTables.indexOf(tableNumber);
        if (index > -1) {
            customTables.splice(index, 1);
            localStorage.setItem('kot_custom_tables', JSON.stringify(customTables));
        }
    },

    renderTableBox: function (table) {
        var isCustom = table.isCustom || false;
        var isTakeaway = table.tableorder_value === 'TA';
        var tableId = table.tableorder_id || table.tableorder_value;

        // Different colors for Take Away
        var boxColor = isTakeaway ? '#ffe0b2' : '#d4edda';
        var numberColor = isTakeaway ? '#ff9800' : '#a3d9a5';
        var labelHtml = isTakeaway ? '<div style="font-size: 12px; color: #ff9800; font-weight: 600; margin-top: 4px;">Take Away</div>' : '';

        var tableBox = `
            <a href="#/kot/${table.tableorder_value}" class="kot-table-box page_url" data-table-id="${tableId}" data-table-number="${table.tableorder_value}" 
                 style="position: relative; aspect-ratio: 1; border: 2px solid ${boxColor}; border-radius: 12px; 
                        display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer; 
                        transition: all 0.3s; background: white; min-height: 100px; margin-bottom: 10px; text-decoration: none;">
                <h2 class="mb-0" style="font-weight: 700; color: ${numberColor}; font-size: 36px;">${table.tableorder_value}</h2>
                ${labelHtml}
            </a>
        `;

        $('#kot_tables_grid').append(tableBox);
    },

    addCustomTableBox: function () {
        var customTableHtml = `
            <div style="position: relative; aspect-ratio: 1; border: 2px dashed #17a2b8; border-radius: 12px; 
                        display: flex; flex-direction: column; align-items: center; justify-content: center; 
                        background: #f8f9fa; min-height: 100px; padding: 10px; margin-bottom: 10px;">
                <input type="text" class="form-control form-control-sm" id="custom_table_number_input" 
                       placeholder="Custom #" style="text-align: center; font-size: 14px; margin-bottom: 8px; border: 1px solid #17a2b8;">
                <button type="button" class="btn btn-sm btn-info" onclick="PosnicPro.kot.addCustomTableKOT()" style="padding: 4px 12px;">
                    <i class="feather icon-plus" style="font-size: 14px;"></i>
                </button>
            </div>
        `;
        $('#kot_tables_grid').append(customTableHtml);
    },

    selectTableWithAnimation: function (tableId, tableNumber, element) {
        // Remove previous selection
        $('.kot-table-box').css({
            'background': 'white',
            'transform': 'scale(1)',
            'box-shadow': 'none'
        });

        // Highlight selected table box IMMEDIATELY before API call
        $(element).css({
            'background': '#e3f2fd',
            'transform': 'scale(1.05)',
            'box-shadow': '0 4px 8px rgba(33, 150, 243, 0.3)'
        });

        // Force repaint to ensure highlight shows immediately
        element.offsetHeight;

        PosnicPro.kot.selectedTable = { id: tableId, number: tableNumber };

        // Set currentTableNumber so it persists for refresh operations
        PosnicPro.kot.currentTableNumber = tableNumber;
        PosnicPro.kot.currentTableId = tableId;
        console.log('Table selected - currentTableNumber set to:', tableNumber);

        // Show loading spinner and load table details
        PosnicPro.kot.loadTableDetails(tableNumber);
    },

    refreshKOTData: function () {
        console.log('=== refreshKOTData called ===');

        // Clear table selection after KOT actions
        PosnicPro.kot.currentTableNumber = null;
        PosnicPro.kot.currentTableId = null;

        // Wait for backend to process the action before navigating
        setTimeout(function () {
            // Always navigate to kot page without table selection
            var targetHash = 'kot';
            console.log('Navigating to #/' + targetHash);

            // If already on target hash, go to temp hash first to force change detection
            var currentHash = window.location.hash.replace('#/', '').replace('#', '');
            if (currentHash === targetHash) {
                console.log('Already on target hash, forcing reload via temp hash');
                window.location.hash = '#/dashboard';
                setTimeout(function () {
                    window.location.hash = '#/' + targetHash;
                }, 50);
            } else {
                window.location.hash = '#/' + targetHash;
            }
        }, 800);
    },

    loadTableDetails: function (tableNumber) {
        console.log('=== loadTableDetails called for table:', tableNumber);
        var detailsPanel = $('#kot_table_details');
        console.log('Right panel element found:', detailsPanel.length > 0);

        var loadingHtml = '<div class="text-center" style="padding: 60px 20px;"><div class="loadingSpinner"></div><p class="text-muted mt-3">Loading table details...</p></div>';
        detailsPanel.html(loadingHtml);

        var filters = {
            sale_process: 'KOT'
        };
        
        if (tableNumber === 'TA') {
            filters.dine_type = 'Take away';
        } else {
            filters.table_number = tableNumber;
        }

        var params = {
            url: 'sales',
            data: {
                page: 1,
                limit: 100,
                filters: JSON.stringify(filters)
            }
        };

        PosnicPro.get(params, function (response) {
            console.log('loadTableDetails API response:', response);
            var kotList = [];
            var kotCount = 0;

            if (response.type === 'success' && response.data && response.data.list && response.data.list.length > 0) {
                kotList = response.data.list;
                kotCount = response.data.total;
            }

            console.log('KOT count for table ' + tableNumber + ':', kotCount);
            console.log('KOT list:', kotList);

            // Update KOT count badge on the table box
            var tableBox = $('[data-table-number="' + tableNumber + '"]');
            var countBadge = tableBox.find('.kot-count-badge');
            if (kotCount > 0) {
                countBadge.text(kotCount).show();
            } else {
                countBadge.hide();

                // If this is a custom table with no KOTs, remove it
                var customTables = PosnicPro.kot.getCustomTables();
                if (customTables.indexOf(tableNumber) > -1) {
                    PosnicPro.kot.removeCustomTable(tableNumber);
                    tableBox.fadeOut(300, function () {
                        $(this).remove();
                    });
                }
            }

            // If no KOTs, show empty state and clear selection
            if (kotCount === 0) {
                console.log('No KOTs found - showing empty state');
                var emptyStateHtml = '<div class="text-center" style="padding: 100px 20px; color: #6c757d;"><i class="feather icon-arrow-left" style="font-size: 48px; margin-bottom: 20px; opacity: 0.3;"></i><p style="font-size: 16px; margin: 0;">Select a table from the left to view KOT details</p></div>';
                detailsPanel.html(emptyStateHtml);

                // Clear current table selection
                PosnicPro.kot.currentTableNumber = null;
                PosnicPro.kot.currentTableId = null;

                // Remove highlight from table boxes
                $('.kot-table-box').css({
                    'background': 'white',
                    'transform': 'scale(1)',
                    'box-shadow': 'none'
                });
            } else {
                // Render details panel with KOT list
                var detailsHtml = PosnicPro.kot.buildTableDetailsPanel(tableNumber, kotList, kotCount);
                console.log('Updating right panel HTML, length:', detailsHtml.length);
                detailsPanel.html(detailsHtml);
                console.log('Right panel updated successfully');

                // Initialize tooltips
                PosnicPro.kot.initTooltips();
            }
        });
    },

    convertTo24Hour: function (dateString) {
        if (!dateString) return '';
        var dateObj = new Date(dateString);
        var hours = dateObj.getHours().toString().padStart(2, '0');
        var minutes = dateObj.getMinutes().toString().padStart(2, '0');
        return hours + ':' + minutes;
    },

    buildTableDetailsPanel: function (tableNumber, kotList, kotCount) {
        var statusBadge = kotCount > 0 ? 'badge-success' : 'badge-secondary';
        var statusText = kotCount > 0 ? kotCount + ' Active KOT' + (kotCount > 1 ? 's' : '') : 'No Active Orders';

        var headerHtml = `
            <div class="d-flex justify-content-between align-items-center mb-4" style="border-bottom: 2px solid #e9ecef; padding-bottom: 15px;">
                <div>
                    <h3 class="mb-1" style="font-weight: 700; font-size: 24px;">Table ${tableNumber}</h3>
                    <span class="badge ${statusBadge}">${statusText}</span>
                </div>
                <a href="#/kotorder/new/${tableNumber}/" class="btn btn-light page_url" title="Add KOT" style="border: 1px solid #dee2e6; text-decoration: none;">
                    <i class="feather icon-plus"></i>
                </a>
            </div>
        `;

        var kotItemsHtml = '';
        if (kotList.length > 0) {
            // Sort KOT list in ascending order (oldest first)
            kotList.sort(function (a, b) {
                var dateA = new Date(a.string_date);
                var dateB = new Date(b.string_date);
                return dateA - dateB;
            });

            kotList.forEach(function (kot, index) {
                // Extract date and time
                var dateStr = '';
                var timeStr = '';
                if (kot.string_date) {
                    var dateObj = new Date(kot.string_date);
                    var hours = dateObj.getHours().toString().padStart(2, '0');
                    var minutes = dateObj.getMinutes().toString().padStart(2, '0');
                    timeStr = hours + ':' + minutes;

                    var day = dateObj.getDate().toString().padStart(2, '0');
                    var month = (dateObj.getMonth() + 1).toString().padStart(2, '0');
                    var year = dateObj.getFullYear();
                    dateStr = day + '/' + month + '/' + year;
                }

                var total = (typeof kot.sales_total !== 'undefined' && kot.sales_total !== null) ? parseFloat(kot.sales_total).toFixed(2) : '0.00';
                var hasDiscount = (typeof kot.extra_discount !== 'undefined' && kot.extra_discount !== null && parseFloat(kot.extra_discount) > 0);

                var discountHtml = '';
                if (hasDiscount) {
                    var discountType = (kot.extra_discount_type || 'amount').toString().toLowerCase();
                    if (discountType === 'percentage') discountType = 'percent';
                    if (discountType === 'fixed') discountType = 'amount';

                    var discountValue = parseFloat(kot.extra_discount);
                    var discountText = discountType === 'percent'
                        ? discountValue + '%'
                        : '₹' + discountValue.toFixed(2);
                    var discountDesc = kot.discount_description || '';
                    discountHtml = `
                        <div style="font-size: 13px; color: #ffc107; margin-top: 4px; display: flex; align-items: center; gap: 6px;">
                            <span>
                                <i class="feather icon-tag" style="font-size: 12px;"></i> 
                                <strong>Discount:</strong> ${discountText}${discountDesc ? ' - ' + discountDesc : ''}
                            </span>
                            <i class="feather icon-edit" style="font-size: 14px; cursor: pointer; color: #6c757d;" 
                            onclick="PosnicPro.kot.showDiscount('${kot._id}')" 
                            title="Edit discount"></i>

                            <i class="feather icon-trash" style="font-size: 14px; cursor: pointer; color: #dc3545;" 
                            onclick="PosnicPro.kot.clearDiscountFromIcon('${kot._id}')"
                            title="Clear discount"></i>
                        </div>
                    `;
                }

                var pax = (typeof kot.person_count !== 'undefined' && kot.person_count !== null) ? kot.person_count : '-';

                // Build items list
                var itemsListHtml = '';
                if (kot.items && kot.items.length > 0) {
                    itemsListHtml = '<table style="width: 100%; font-size: 13px; margin-top: 10px;">';
                    kot.items.forEach(function (item, idx) {
                        var itemName = item.item_name || '';
                        var itemQty = item.item_quantity || 0;
                        var itemDesc = item.item_description || '';

                        // Add description in brackets if exists
                        var displayName = itemName;
                        if (itemDesc && itemDesc.trim() !== '') {
                            displayName = itemName + ' <span style="color: #6c757d; font-style: italic;">(' + itemDesc + ')</span>';
                        }

                        var itemId = item.item_id || '';
                        var itemPrice = item.item_price || 0;
                        itemsListHtml += `
                            <tr style="border-bottom: 1px solid #f0f0f0;">
                                <td style="padding: 6px 0; width: 30px;">${idx + 1}.</td>
                                <td style="padding: 6px 0;">${displayName}</td>
                                <td style="padding: 6px 0; text-align: right; width: 80px;">
                                    <span class="kot-item-price-display" data-sale-id="${kot._id}" data-item-id="${itemId}" style="font-weight: 600; color: #28a745;">₹${itemPrice.toFixed(2)}</span>
                                </td>
                                <td style="padding: 6px 0; text-align: right; width: 140px;">
                                    <div class="kot-item-qty-display" data-sale-id="${kot._id}" data-item-id="${itemId}" style="display: inline-flex; align-items: center; justify-content: flex-end;">
                                        <span style="font-weight: 600; padding: 0 5px;">× ${itemQty}</span>
                                    </div>
                                    <div class="kot-item-qty-controls" data-sale-id="${kot._id}" data-item-id="${itemId}" data-item-price="${itemPrice}" style="display: none; align-items: center; justify-content: flex-end;">
                                        <div class="btn-group btn-group-sm" style="display: inline-flex; align-items: center; margin-right: 8px;">
                                            <button type="button" class="btn btn-light btn-sm qty-decrease" style="border: 1px solid #ced4da; padding: 2px 8px;">
                                                <i class="feather icon-minus" style="font-size: 10px;"></i>
                                            </button>
                                            <input type="text" class="form-control form-control-sm qty-input" value="${itemQty}" min="1" style="width: 50px; text-align: center; padding: 2px 5px; height: 28px;">
                                            <button type="button" class="btn btn-light btn-sm qty-increase" style="border: 1px solid #ced4da; padding: 2px 8px;">
                                                <i class="feather icon-plus" style="font-size: 10px;"></i>
                                            </button>
                                        </div>
                                        <button type="button" class="btn btn-outline-danger btn-sm" style="padding: 2px 6px; border-radius: 4px;" onclick="PosnicPro.kot.deleteItem('${kot._id}', '${itemId}')" title="Delete Item">
                                            <i class="feather icon-trash" style="font-size: 12px;"></i>
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        `;
                    });
                    itemsListHtml += '</table>';
                }

                // Show Discount button only if no discount applied
                var discountButtonHtml = hasDiscount ? '' : `
                    <button type="button" class="btn btn-warning" onclick="PosnicPro.kot.showDiscount('${kot._id}')">
                        <i class="feather icon-tag"></i> Discount
                    </button>
                `;

                kotItemsHtml += `
                    <div class="kot-item" style="border-bottom: ${index < kotList.length - 1 ? '2px solid #dee2e6' : 'none'}; padding: 15px 0; margin-bottom: ${index < kotList.length - 1 ? '15px' : '0'};">
                        <div style="background: white; padding: 15px; border-radius: 6px;">
                            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
                                <div style="flex: 1;">
                                    <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 8px;">
                                        <span style="font-size: 13px; color: #6c757d;">
                                            <i class="feather icon-calendar" style="font-size: 13px;"></i> ${dateStr} ${timeStr}
                                        </span>
                                        <span style="font-size: 13px; color: #6c757d;">
                                            <i class="feather icon-users" style="font-size: 13px;"></i> PAX: ${pax}
                                        </span>
                                    </div>
                                    <div class="kot-total-display" data-sale-id="${kot._id}" style="font-size: 18px; font-weight: 700; color: #28a745;">
                                        Total: <span class="kot-total-amount">₹${total}</span>
                                    </div>
                                    ${discountHtml}
                                </div>
                            </div>
                            
                            ${itemsListHtml}
                            
                            <!-- ✅ Add new item section - hidden by default, shown when Modify clicked -->
                            <div class="kot-add-item-section" data-sale-id="${kot._id}" style="display: none; margin-top: 15px; margin-bottom: 15px; padding-bottom: 15px; border-bottom: 2px solid #dee2e6;">
                                <h6 style="font-size: 14px; font-weight: 600; color: #495057; margin-bottom: 10px;">
                                    <i class="feather icon-plus-circle" style="font-size: 14px;"></i> Add new item
                                </h6>
                                <div class="kot-search-product-wrapper" data-sale-id="${kot._id}" style="position: relative;">
                                    <input type="text" 
                                           class="form-control kot-product-search" 
                                           data-sale-id="${kot._id}"
                                           placeholder="Search product to add..."
                                           autocomplete="off"
                                           style="border: 2px solid #dee2e6; border-radius: 6px; padding: 8px 12px; font-size: 14px;">
                                    <div class="kot-search-results" data-sale-id="${kot._id}" style="display: none; position: absolute; z-index: 1000; background: white; border: 1px solid #dee2e6; border-radius: 6px; max-height: 200px; overflow-y: auto; width: 100%; margin-top: 2px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);"></div>
                                </div>
                            </div>
                            
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 12px;">
                                <div class="btn-group btn-group-sm" role="group" style="gap: 8px; margin-right: 12px;">
                                    <button type="button" class="btn btn-outline-secondary kot-modify-btn" data-sale-id="${kot._id}">
                                        <i class="feather icon-edit"></i> Modify
                                    </button>
                                    <button type="button" class="btn btn-success kot-update-btn" data-sale-id="${kot._id}" style="display: none;">
                                        <i class="feather icon-check"></i> Update
                                    </button>
                                    <button type="button" class="btn btn-outline-danger" onclick="PosnicPro.kot.cancelKOTFromList('${kot._id}')">
                                        <i class="feather icon-x"></i> Cancel
                                    </button>
                                </div>
                                <div class="btn-group btn-group-sm" role="group" style="gap: 8px; flex-wrap: wrap; justify-content: flex-end;">
                                    ${discountButtonHtml}
                                    <button type="button" class="btn btn-info" onclick="PosnicPro.kot.printKOTReceipt('${kot._id}')">
                                        <i class="feather icon-printer"></i> Sale Print
                                    </button>
                                    <button type="button" class="btn kot-print-btn" style="background:#6f42c1; color:#fff; display:none;" onclick="PosnicPro.kot.printKOTSlip('${kot._id}')">
                                        <i class="feather icon-printer"></i> KOT Print
                                    </button>
                                    <button type="button" class="btn btn-success" onclick="PosnicPro.kothistory.proceed('${kot._id}')">
                                        <i class="feather icon-credit-card"></i> Settle
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            });
        } else {
            kotItemsHtml = `
                <div class="text-center" style="padding: 40px 20px;">
                    <i class="feather icon-inbox" style="font-size: 48px; color: #dee2e6;"></i>
                    <p class="text-muted mt-3">No active orders for this table</p>
                </div>
            `;
        }

        // ✅ Add event handlers after rendering
        setTimeout(function() {
            PosnicPro.kot.initModifyUpdateHandlers();
            // Update prices on initial load for all KOTs
            if (kotList && kotList.length > 0) {
                kotList.forEach(function(kot) {
                    console.log('Calling updateItemPricesOnLoad for KOT:', kot._id);
                    PosnicPro.kot.updateItemPricesOnLoad(kot._id);
                });
            }
        }, 500);

        return headerHtml + kotItemsHtml;
    },

    updateItemPricesOnLoad: function(saleId) {
        console.log('=== updateItemPricesOnLoad ===');
        console.log('Sale ID:', saleId);

        // Fetch the full order details which includes item information with tax/discounts
        PosnicPro.get('sales/' + saleId, function(response) {
            console.log('Order API Response:', response);
            
            if (response.type === 'success' && response.data && response.data.items) {
                var items = response.data.items;
                console.log('Found', items.length, 'items in order');
                
                items.forEach(function(item) {
                    var itemId = item.item_id || '';
                    var sellingPrice = parseFloat(item.selling_price || item.item_price || 0);
                    var tax = parseFloat(item.tax || 0);
                    var taxType = item.tax_type || 'exclusive';
                    var discountAmount = parseFloat(item.discount_amount || 0);
                    var discountPercentage = parseFloat(item.discount_percentage || 0);
                    var finalPrice = 0;
                    
                    // Calculate final price with discounts and taxes
                    var taxPrice = (sellingPrice * tax) / (100 + tax);
                    var inclusive_price = sellingPrice - taxPrice;
                    
                    if (discountAmount > 0 && tax > 0) {
                        var discountValue = (taxType === 'exclusive') ? sellingPrice - discountAmount : inclusive_price - discountAmount;
                        finalPrice = discountValue + (tax / 100) * discountValue;
                    } else if (discountPercentage > 0 && tax > 0) {
                        var discountValue = 0;
                        var taxValue = 0;
                        if (taxType === 'exclusive') {
                            discountValue = (sellingPrice * (discountPercentage / 100));
                            taxValue = sellingPrice - discountValue;
                        } else {
                            discountValue = (inclusive_price * (discountPercentage / 100));
                            taxValue = inclusive_price - discountValue;
                        }
                        finalPrice = taxValue + (tax / 100) * taxValue;
                    } else if (discountAmount > 0) {
                        finalPrice = sellingPrice - discountAmount;
                    } else if (discountPercentage > 0) {
                        finalPrice = sellingPrice - (sellingPrice * (discountPercentage / 100));
                    } else if (tax > 0) {
                        if (taxType === 'exclusive') {
                            finalPrice = sellingPrice + (sellingPrice * tax / 100);
                        } else {
                            finalPrice = inclusive_price + (inclusive_price / 100) * tax;
                        }
                    } else {
                        finalPrice = sellingPrice;
                    }
                    
                    console.log('Item:', item.item_name, '- Selling Price:', sellingPrice, '- Tax:', tax, '- Final Price:', finalPrice);
                    
                    // Update the displayed price for this item
                    var $priceDisplay = $('.kot-item-price-display[data-sale-id="' + saleId + '"][data-item-id="' + itemId + '"]');
                    console.log('Found price display elements for', itemId, ':', $priceDisplay.length);
                    $priceDisplay.text('₹' + finalPrice.toFixed(2));
                    
                    // Also update the data-item-price attribute for quantity controls
                    $('.kot-item-qty-controls[data-sale-id="' + saleId + '"][data-item-id="' + itemId + '"]').attr('data-item-price', finalPrice.toFixed(2));
                });
            } else {
                console.log('Failed to get order details or no items found');
            }
        }, function(error) {
            console.error('Order API Error:', error);
        });
    },

    initModifyUpdateHandlers: function() {
        // Handle Modify button click - toggle to edit mode
        $(document).off('click', '.kot-modify-btn').on('click', '.kot-modify-btn', function() {
            var saleId = $(this).data('sale-id');
            
            // Show quantity controls for all items in this KOT
            $('.kot-item-qty-display[data-sale-id="' + saleId + '"]').hide();
            $('.kot-item-qty-controls[data-sale-id="' + saleId + '"]').css('display', 'inline-flex');
            
            // ✅ Show Add new item section
            $('.kot-add-item-section[data-sale-id="' + saleId + '"]').show();
            
            // Toggle buttons
            $('.kot-modify-btn[data-sale-id="' + saleId + '"]').hide();
            $('.kot-update-btn[data-sale-id="' + saleId + '"]').show();
            
            // ✅ Fetch and update current prices for all items
            PosnicPro.kot.updateTotalDisplay(saleId);
        });

        // Handle Update button click - save changes
        $(document).off('click', '.kot-update-btn').on('click', '.kot-update-btn', function() {
            var saleId = $(this).data('sale-id');
            
            // ✅ Hide Add new item section
            $('.kot-add-item-section[data-sale-id="' + saleId + '"]').hide();
            
            PosnicPro.kot.saveQuantityChanges(saleId);
        });

        // Handle quantity increase
        $(document).off('click', '.qty-increase').on('click', '.qty-increase', function() {
            var input = $(this).siblings('.qty-input');
            var currentVal = parseInt(input.val()) || 1;
            input.val(currentVal + 1);
            
            // Update total display
            var saleId = $(this).closest('.kot-item-qty-controls').data('sale-id');
            PosnicPro.kot.updateTotalDisplay(saleId);
        });

        // Handle quantity decrease
        $(document).off('click', '.qty-decrease').on('click', '.qty-decrease', function() {
            var input = $(this).siblings('.qty-input');
            var currentVal = parseInt(input.val()) || 1;
            if (currentVal > 1) {
                input.val(currentVal - 1);
                
                // Update total display
                var saleId = $(this).closest('.kot-item-qty-controls').data('sale-id');
                PosnicPro.kot.updateTotalDisplay(saleId);
            }
        });

        // Handle remove new item button
        $(document).off('click', '.kot-remove-new-item').on('click', '.kot-remove-new-item', function() {
            var saleId = $(this).closest('.kot-item-qty-controls').data('sale-id');
            var $table = $(this).closest('table');
            var rowCount = $table.find('tr').length;
            
            // Check if this is the last item
            if (rowCount <= 1) {
                PosnicPro.alert('error', 'You cannot remove the last item. An order needs at least one product.');
                return;
            }
            
            // Remove the row from table (no API call)
            $(this).closest('tr').remove();
            
            // Update total display
            PosnicPro.kot.updateTotalDisplay(saleId);
        });

        // ✅ Handle product search
        var searchTimeout;
        $(document).off('input', '.kot-product-search').on('input', '.kot-product-search', function() {
            var $input = $(this);
            var saleId = $input.data('sale-id');
            var query = $input.val().trim();
            var $results = $('.kot-search-results[data-sale-id="' + saleId + '"]');

            clearTimeout(searchTimeout);

            if (query.length < 2) {
                $results.hide().empty();
                return;
            }

            searchTimeout = setTimeout(function() {
                PosnicPro.kot.searchProducts(query, saleId, $results);
            }, 300);
        });

        // Handle clicking outside to close search results
        $(document).off('click.kotsearch').on('click.kotsearch', function(e) {
            if (!$(e.target).closest('.kot-search-product-wrapper').length) {
                $('.kot-search-results').hide();
            }
        });
    },

    // Store searched products to avoid issues with special characters in inline handlers
    searchedProducts: {},

    searchProducts: function(query, saleId, $results) {
        var params = {
            url: 'items/getOnlineItemsAjaxList',
            data: 'query=' + encodeURIComponent(query) + '&type=normal'
        };

        PosnicPro.get(params, function(response) {
            if (response && response.suggestions && response.suggestions.length > 0) {
                var html = '';
                response.suggestions.forEach(function(item) {
                    var data = item.data || item;
                    var itemId = data.item_id || data.id || (data._id ? data._id.$oid : '');
                    var itemName = data.item_name || item.value || '';
                    
                    // Calculate final price with discounts and taxes
                    var sellingPrice = parseFloat(data.selling_price || 0);
                    var discountAmount = parseFloat(data.discount_amount || 0);
                    var discountPercentage = parseFloat(data.discount_percentage || 0);
                    var tax = parseFloat(data.tax || 0);
                    var taxType = data.tax_type || 'inclusive';
                    var finalPrice = 0;
                    
                    var taxPrice = (sellingPrice * tax) / (100 + tax);
                    var inclusive_price = sellingPrice - taxPrice;
                    
                    if (discountAmount > 0 && tax > 0) {
                        var discountValue = (taxType === 'exclusive') ? sellingPrice - discountAmount : inclusive_price - discountAmount;
                        finalPrice = discountValue + (tax / 100) * discountValue;
                    } else if (discountPercentage > 0 && tax > 0) {
                        var discountValue = 0;
                        var taxValue = 0;
                        if (taxType === 'exclusive') {
                            discountValue = (sellingPrice * (discountPercentage / 100));
                            taxValue = sellingPrice - discountValue;
                        } else {
                            discountValue = (inclusive_price * (discountPercentage / 100));
                            taxValue = inclusive_price - discountValue;
                        }
                        finalPrice = taxValue + (tax / 100) * taxValue;
                    } else if (discountAmount > 0) {
                        finalPrice = sellingPrice - discountAmount;
                    } else if (discountPercentage > 0) {
                        finalPrice = sellingPrice - (sellingPrice * (discountPercentage / 100));
                    } else if (tax > 0) {
                        if (taxType === 'exclusive') {
                            finalPrice = sellingPrice + (sellingPrice * tax / 100);
                        } else {
                            finalPrice = inclusive_price + (inclusive_price / 100) * tax;
                        }
                    } else {
                        finalPrice = sellingPrice;
                    }
                    
                    var priceDisplay = finalPrice.toFixed(2);
                    var basePrice = sellingPrice.toFixed(2);

                    // Store product data for retrieval by ID
                    PosnicPro.kot.searchedProducts[itemId] = {
                        itemId: itemId,
                        itemName: itemName,
                        itemPrice: priceDisplay,
                        basePrice: basePrice,
                        saleId: saleId
                    };

                    // Store item name in data attribute as backup to prevent special character issues
                    html += '<div class="kot-search-result-item" data-item-id="' + itemId + '" data-sale-id="' + saleId + '" ' +
                            'data-item-name="' + itemName.replace(/"/g, '&quot;') + '" data-item-price="' + priceDisplay + '" data-base-price="' + basePrice + '" ' +
                            'style="padding: 8px 12px; cursor: pointer; border-bottom: 1px solid #f0f0f0; transition: background 0.2s; display: flex; justify-content: space-between; align-items: center;" ' +
                            'onmouseover="this.style.background=\'#f8f9fa\'" onmouseout="this.style.background=\'white\'">' +
                            '<div style="font-weight: 600; font-size: 13px; color: #333; flex: 1;">' + itemName + '</div>' +
                            '<div style="text-align: right;"><div style="font-size: 12px; color: #28a745; font-weight: 600;">₹' + priceDisplay + '</div></div>' +
                            '</div>';
                });

                $results.html(html).show();

                // Handle result item click - retrieve data from DOM attributes
                $(document).off('click', '.kot-search-result-item').on('click', '.kot-search-result-item', function() {
                    var $item = $(this);
                    var itemId = $item.data('item-id');
                    var saleId = $item.data('sale-id');
                    var itemName = $item.data('item-name');
                    var itemPrice = $item.data('item-price');
                    var basePrice = $item.data('base-price');
                    
                    // Validate data
                    if (!itemId || !itemName) {
                        console.error('Missing product data:', {itemId: itemId, itemName: itemName});
                        return;
                    }
                    
                    // Add item to edit mode UI with correct data from DOM
                    PosnicPro.kot.addProductToEditMode(
                        saleId,
                        itemId,
                        itemName,
                        itemPrice,
                        basePrice
                    );
                    
                    // Clear search
                    $('.kot-product-search[data-sale-id="' + saleId + '"]').val('');
                    $('.kot-search-results[data-sale-id="' + saleId + '"]').hide().empty();
                });
            } else {
                $results.html('<div style="padding: 12px; text-align: center; color: #6c757d; font-size: 13px;">No products found</div>').show();
            }
        }, function() {
            $results.html('<div style="padding: 12px; text-align: center; color: #dc3545; font-size: 13px;">Search failed</div>').show();
        });
    },

    addProductToEditMode: function(saleId, itemId, itemName, itemPrice, basePrice) {
        // Find the items table for this KOT
        var $kotItem = $('.kot-modify-btn[data-sale-id="' + saleId + '"]').closest('.kot-item');
        var $itemsTable = $kotItem.find('table');
        
        if ($itemsTable.length === 0) {
            PosnicPro.alert('error', 'Could not find items table');
            return;
        }

        // Check if item already exists in the table
        var itemExists = false;
        $itemsTable.find('tr').each(function() {
            var $qtyControls = $(this).find('.kot-item-qty-controls[data-item-id="' + itemId + '"]');
            if ($qtyControls.length > 0) {
                // Item exists, increment quantity
                var $input = $qtyControls.find('.qty-input');
                var currentQty = parseInt($input.val()) || 1;
                $input.val(currentQty + 1);
                itemExists = true;
                return false; // break loop
            }
        });

        if (!itemExists) {
            // Add new row to table
            var rowIndex = $itemsTable.find('tr').length + 1;
            var newRow = `
                <tr style="border-bottom: 1px solid #f0f0f0;">
                    <td style="padding: 6px 0; width: 30px;">${rowIndex}.</td>
                    <td style="padding: 6px 0;">${itemName}</td>
                    <td style="padding: 6px 0; text-align: right; width: 80px;">
                        <span class="kot-item-price-display" data-sale-id="${saleId}" data-item-id="${itemId}" style="font-weight: 600; color: #28a745;">₹${parseFloat(itemPrice).toFixed(2)}</span>
                    </td>
                    <td style="padding: 6px 0; text-align: right; width: 140px;">
                        <div class="kot-item-qty-display" data-sale-id="${saleId}" data-item-id="${itemId}" style="display: none; align-items: center; justify-content: flex-end;">
                            <span style="font-weight: 600; padding: 0 5px;">1</span>
                        </div>
                        <div class="kot-item-qty-controls" data-sale-id="${saleId}" data-item-id="${itemId}" data-item-price="${itemPrice}" data-base-price="${basePrice || itemPrice}" style="display: inline-flex; align-items: center; justify-content: flex-end;">
                            <div class="btn-group btn-group-sm" style="display: inline-flex; align-items: center; margin-right: 8px;">
                                <button type="button" class="btn btn-light btn-sm qty-decrease" style="border: 1px solid #ced4da; padding: 2px 8px;">
                                    <i class="feather icon-minus" style="font-size: 10px;"></i>
                                </button>
                                <input type="text" class="form-control form-control-sm qty-input" value="1" min="1" style="width: 50px; text-align: center; padding: 2px 5px; height: 28px;">
                                <button type="button" class="btn btn-light btn-sm qty-increase" style="border: 1px solid #ced4da; padding: 2px 8px;">
                                    <i class="feather icon-plus" style="font-size: 10px;"></i>
                                </button>
                            </div>
                            <button type="button" class="btn btn-outline-danger btn-sm kot-remove-new-item" style="padding: 2px 6px; border-radius: 4px;" title="Remove Item">
                                <i class="feather icon-trash" style="font-size: 12px;"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
            $itemsTable.append(newRow);
            
            // Re-initialize event handlers for new elements
            PosnicPro.kot.initModifyUpdateHandlers();
        }

        // Update total display (optional - can calculate on Update)
        PosnicPro.kot.updateTotalDisplay(saleId);
    },

    updateTotalDisplay: function(saleId) {
        // Collect all items with current quantities from UI
        var itemQuantities = {};
        $('.kot-item-qty-controls[data-sale-id="' + saleId + '"]').each(function() {
            var itemId = $(this).data('item-id');
            var qty = parseInt($(this).find('.qty-input').val()) || 0;
            itemQuantities[itemId] = qty;
        });

        // Fetch order details to get item prices with tax/discounts
        PosnicPro.get('sales/' + saleId, function(response) {
            var total = 0;
            
            if (response.type === 'success' && response.data && response.data.items) {
                var items = response.data.items;
                
                // Create a map of existing items for quick lookup
                var existingItemIds = {};
                items.forEach(function(item) {
                    var itemId = item.item_id || '';
                    existingItemIds[itemId] = item;
                });
                
                // Calculate total for all items (existing + newly added)
                for (var itemId in itemQuantities) {
                    var qty = itemQuantities[itemId];
                    
                    if (qty > 0) {
                        var finalPrice = 0;
                        
                        // Check if this is an existing item in the order
                        if (existingItemIds[itemId]) {
                            var item = existingItemIds[itemId];
                            
                            // Calculate final price with discounts and taxes
                            var sellingPrice = parseFloat(item.selling_price || item.item_price || 0);
                            var tax = parseFloat(item.tax || 0);
                            var taxType = item.tax_type || 'exclusive';
                            var discountAmount = parseFloat(item.discount_amount || 0);
                            var discountPercentage = parseFloat(item.discount_percentage || 0);
                            
                            var taxPrice = (sellingPrice * tax) / (100 + tax);
                            var inclusive_price = sellingPrice - taxPrice;
                            
                            if (discountAmount > 0 && tax > 0) {
                                var discountValue = (taxType === 'exclusive') ? sellingPrice - discountAmount : inclusive_price - discountAmount;
                                finalPrice = discountValue + (tax / 100) * discountValue;
                            } else if (discountPercentage > 0 && tax > 0) {
                                var discountValue = 0;
                                var taxValue = 0;
                                if (taxType === 'exclusive') {
                                    discountValue = (sellingPrice * (discountPercentage / 100));
                                    taxValue = sellingPrice - discountValue;
                                } else {
                                    discountValue = (inclusive_price * (discountPercentage / 100));
                                    taxValue = inclusive_price - discountValue;
                                }
                                finalPrice = taxValue + (tax / 100) * taxValue;
                            } else if (discountAmount > 0) {
                                finalPrice = sellingPrice - discountAmount;
                            } else if (discountPercentage > 0) {
                                finalPrice = sellingPrice - (sellingPrice * (discountPercentage / 100));
                            } else if (tax > 0) {
                                if (taxType === 'exclusive') {
                                    finalPrice = sellingPrice + (sellingPrice * tax / 100);
                                } else {
                                    finalPrice = inclusive_price + (inclusive_price / 100) * tax;
                                }
                            } else {
                                finalPrice = sellingPrice;
                            }
                            
                            console.log('Existing Item - Final Price:', finalPrice, '- Qty:', qty);
                        } else {
                            // This is a newly added item, get price from data attribute
                            finalPrice = parseFloat($('.kot-item-qty-controls[data-sale-id="' + saleId + '"][data-item-id="' + itemId + '"]').data('item-price')) || 0;
                            console.log('New Item - Price from data:', finalPrice, '- Qty:', qty);
                        }
                        
                        // Update the displayed price for this item
                        $('.kot-item-price-display[data-sale-id="' + saleId + '"][data-item-id="' + itemId + '"]').text('₹' + finalPrice.toFixed(2));
                        
                        total += (qty * finalPrice);
                    }
                }
            }

            console.log('Total calculated:', total);
            // Update total display
            $('.kot-total-display[data-sale-id="' + saleId + '"] .kot-total-amount').text('₹' + total.toFixed(2));
        }, function() {
            // On error, use stored prices from data attributes
            var total = 0;
            $('.kot-item-qty-controls[data-sale-id="' + saleId + '"]').each(function() {
                var qty = parseInt($(this).find('.qty-input').val()) || 0;
                var price = parseFloat($(this).data('item-price')) || 0;
                total += (qty * price);
            });
            $('.kot-total-display[data-sale-id="' + saleId + '"] .kot-total-amount').text('₹' + total.toFixed(2));
        });
    },

    addProductToKOT: function(saleId, itemId) {
        if (!saleId || !itemId) return;

        var loader = $(".loader-table-kot-detail");
        if (loader.length === 0) loader = $("body");
        
        var spinner = $("<div class='loadingSpinner' style='position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); z-index:9999;'></div>");
        if (loader.css('position') === 'static') loader.css('position', 'relative');
        loader.append(spinner);

        // Get current order details
        PosnicPro.get('sales/' + saleId, function(response) {
            if (response.type !== 'success') {
                spinner.remove();
                PosnicPro.alert('error', response.message || 'Failed to load order');
                return;
            }

            var data = response.data || {};
            var items = [];
            var newTotal = 0;
            var itemFound = false;

            // Prepare existing items
            if (data.items && data.items.length) {
                for (var i = 0; i < data.items.length; i++) {
                    var item = data.items[i];
                    var currentQty = parseFloat(item.item_quantity || 0);
                    var price = parseFloat(item.item_price || 0);
                    var id = item.item_id || '';

                    // Check if item already exists, if so increment quantity
                    if (id.toString() === itemId.toString()) {
                        currentQty += 1;
                        itemFound = true;
                    }

                    items.push({
                        product_id: id,
                        quantity: currentQty,
                        price: price
                    });

                    newTotal += (currentQty * price);
                }
            }

            // If item not found, fetch item details and add it
            if (!itemFound) {
                var params = {
                    url: 'items/getOnlineItemsAjaxList',
                    data: 'query=' + itemId
                };
                
                PosnicPro.get(params, function(itemResponse) {
                    var newItemData = null;
                    if (itemResponse && itemResponse.suggestions && itemResponse.suggestions.length > 0) {
                        newItemData = itemResponse.suggestions.find(function(s) { 
                            var d = s.data || s;
                            var sid = d.item_id || d.id || (d._id ? d._id.$oid : '');
                            return sid.toString() === itemId.toString();
                        });
                        
                        if (!newItemData) newItemData = itemResponse.suggestions[0];
                    }
                    
                    if (newItemData) {
                        var d = newItemData.data || newItemData;
                        var price = parseFloat(d.selling_price || 0);
                        
                        items.push({
                            product_id: itemId,
                            quantity: 1,
                            price: price
                        });
                        
                        newTotal += price;
                        
                        PosnicPro.kot.finalizeAddProduct(saleId, data, items, newTotal, spinner);
                    } else {
                        spinner.remove();
                        PosnicPro.alert('error', 'Item details not found');
                    }
                });
            } else {
                PosnicPro.kot.finalizeAddProduct(saleId, data, items, newTotal, spinner);
            }
        }, function(xhr) {
            spinner.remove();
            PosnicPro.alert('error', 'Failed to load order details');
        });
    },

    finalizeAddProduct: function(saleId, data, items, newTotal, spinner) {
        // Apply existing discount if any
        var discountType = data.extra_discount_type || 'amount';
        var discountValue = parseFloat(data.extra_discount || 0);
        
        if (discountValue > 0) {
            if (discountType === 'percentage' || discountType === 'percent') {
                var discAmount = (newTotal * discountValue) / 100;
                newTotal -= discAmount;
            } else {
                newTotal -= discountValue;
            }
        }
        
        if (newTotal < 0) newTotal = 0;

        var params = {
            url: 'sales/updateOrder',
            data: JSON.stringify({
                order_id: data._id || data.id || saleId,
                items: items,
                total_amount: newTotal,
                status: data.sale_status || 'pending',
                extra_discount_type: discountType,
                extra_discount: discountValue,
                discount_description: data.discount_description || '',
                table_number: data.table_number || '',
                dine_type: data.dine_type || ''
            })
        };

        PosnicPro.put(params, function(res) {
            spinner.remove();
            if (res.type === 'success') {
                // Refresh KOT details
                if (PosnicPro.kot.currentTableNumber) {
                    PosnicPro.kot.loadTableDetails(PosnicPro.kot.currentTableNumber);
                }
                // Refresh tables list
                if (typeof PosnicPro.kot.refreshTables === 'function') {
                    PosnicPro.kot.refreshTables();
                }
                PosnicPro.alert('success', 'Item added');
            } else {
                PosnicPro.alert(res.type, res.message);
            }
        }, function(xhr) {
            spinner.remove();
            var err = JSON.parse(xhr.responseText || '{}');
            PosnicPro.alert('error', err.message || 'Could not add the item. Please try again.');
        });
    },

    saveQuantityChanges: function(saleId) {
        var loader = $(".loader-table-kot-detail");
        if (loader.length === 0) loader = $("body");
        
        var spinner = $("<div class='loadingSpinner' style='position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); z-index:9999;'></div>");
        if (loader.css('position') === 'static') loader.css('position', 'relative');
        loader.append(spinner);

        // Get current order details
        PosnicPro.get('sales/' + saleId, function(response) {
            if (response.type !== 'success') {
                spinner.remove();
                PosnicPro.alert('error', response.message || 'Failed to load order');
                return;
            }

            var data = response.data || {};
            var items = [];
            var newTotal = 0;

            // Collect updated quantities from inputs (both existing and new items)
            $('.kot-item-qty-controls[data-sale-id="' + saleId + '"]').each(function() {
                var itemId = $(this).data('item-id');
                var newQty = parseInt($(this).find('.qty-input').val()) || 1;
                
                // Try to get the original base price from order data first
                var price = 0;
                var itemFound = false;
                if (data.items && data.items.length) {
                    for (var i = 0; i < data.items.length; i++) {
                        var item = data.items[i];
                        if ((item.item_id || '').toString() === itemId.toString()) {
                            price = parseFloat(item.item_price || 0);
                            console.log('Existing item - Base Price:', price, '- Qty:', newQty);
                            itemFound = true;
                            break;
                        }
                    }
                }
                
                // If not found in order data, this is a newly added item - get base price from data attribute
                if (!itemFound) {
                    price = parseFloat($(this).data('base-price')) || 0;
                    console.log('New item - Using base price:', price, '- Qty:', newQty);
                }
                
                items.push({
                    product_id: itemId,
                    quantity: newQty,
                    price: price
                });
                newTotal += (newQty * price);
            });

            // Apply existing discount if any
            var discountType = data.extra_discount_type || 'amount';
            var discountValue = parseFloat(data.extra_discount || 0);
            
            if (discountValue > 0) {
                if (discountType === 'percentage' || discountType === 'percent') {
                    var discAmount = (newTotal * discountValue) / 100;
                    newTotal -= discAmount;
                } else {
                    newTotal -= discountValue;
                }
            }
            
            if (newTotal < 0) newTotal = 0;

            var params = {
                url: 'sales/updateOrder',
                data: JSON.stringify({
                    order_id: data._id || data.id || saleId,
                    items: items,
                    total_amount: newTotal,
                    status: data.sale_status || 'pending',
                    extra_discount_type: discountType,
                    extra_discount: discountValue,
                    discount_description: data.discount_description || '',
                    table_number: data.table_number || '',
                    dine_type: data.dine_type || ''
                })
            };

            PosnicPro.put(params, function(res) {
                spinner.remove();
                if (res.type === 'success') {
                    // Refresh KOT details
                    if (PosnicPro.kot.currentTableNumber) {
                        PosnicPro.kot.loadTableDetails(PosnicPro.kot.currentTableNumber);
                    }
                    // Refresh tables list
                    if (typeof PosnicPro.kot.refreshTables === 'function') {
                        PosnicPro.kot.refreshTables();
                    }
                    PosnicPro.alert('success', 'Quantities updated');
                } else {
                    PosnicPro.alert(res.type, res.message);
                }
            }, function(xhr) {
                spinner.remove();
                var err = JSON.parse(xhr.responseText || '{}');
                PosnicPro.alert('error', err.message || 'Could not update quantities. Please try again.');
            });
        }, function(xhr) {
            spinner.remove();
            PosnicPro.alert('error', 'Failed to load order details');
        });
    },

    addCustomTableKOT: function () {
        var customTableNumber = $('#custom_table_number_input').val().trim();
        if (!customTableNumber) {
            PosnicPro.alert('error', 'Enter a table or room number.');
            return;
        }

        // Prevent using TA as it's reserved for takeaway
        if (customTableNumber.toUpperCase() === 'TA') {
            PosnicPro.alert('error', 'TA is reserved for takeaway orders. Use a different table number.');
            return;
        }

        // Add to localStorage
        PosnicPro.kot.addCustomTable(customTableNumber);

        PosnicPro.kotorder = PosnicPro.kotorder || {};
        PosnicPro.kotorder.preSelectedTable = customTableNumber;

        if (typeof hasher !== 'undefined') {
            hasher.setHash('kotorder/new');
        } else {
            window.location.hash = '#/kotorder/new';
        }
    },

    addTakeawayBox: function () {
        var takeawayHtml = `
            <div onclick="PosnicPro.kot.addTakeawayKOT()" 
                 style="grid-column: span 2; border: 2px solid #ffc107; border-radius: 8px; padding: 10px; 
                        background: #fff3cd; cursor: pointer; transition: all 0.3s; display: flex; 
                        align-items: center; justify-content: center;">
                <i class="feather icon-shopping-bag" style="font-size: 20px; color: #856404; margin-right: 8px;"></i>
                <span style="font-weight: 600; color: #856404; font-size: 14px;">Takeaway</span>
                <i class="feather icon-plus" style="font-size: 16px; color: #856404; margin-left: 8px;"></i>
            </div>
        `;
        $('#kot_tables_grid').append(takeawayHtml);
    },

    addTakeawayKOT: function () {
        // Set up sales with TA table, Take away type, and 0 PAX
        PosnicPro.sales = PosnicPro.sales || {};
        PosnicPro.sales.saleProcess = 'KOT';
        PosnicPro.sales.selectedTable = { id: 'TA', tableNumber: 'TA' };

        // Set KOT-specific values
        PosnicPro.kotorder = PosnicPro.kotorder || {};
        PosnicPro.kotorder.kotTableNumber = 'TA';
        PosnicPro.kotorder.kotOrderType = 'Take away';
        PosnicPro.kotorder.kotPersonCount = 0;
        PosnicPro.kotorder.selectedPerson = 0;

        // Set dine type in sale form
        $('#sale_dine_type').val('Take away');

        // Go directly to sales/new page
        if (typeof hasher !== 'undefined') {
            hasher.setHash('sales/new');
        } else {
            window.location.hash = '#/sales/new';
        }
    },

    loadTableKOTs: function (table, callback) {
        var filters = {
            sale_process: 'KOT'
        };
        
        if (table.tableorder_value === 'TA') {
            filters.dine_type = 'Take away';
        } else {
            filters.table_number = table.tableorder_value;
        }
        
        var params = {
            url: 'sales',
            data: {
                page: 1,
                limit: 100,
                filters: JSON.stringify(filters)
            }
        };

        PosnicPro.get(params, function (response) {
            var kotList = [];
            var kotCount = 0;

            if (response.type === 'success' && response.data && response.data.list && response.data.list.length > 0) {
                kotList = response.data.list;
                kotCount = response.data.total;
            }

            // Check if this is a custom table or TA table
            var isCustomTable = table.tableorder_id && table.tableorder_id.toString().startsWith('custom_');
            var isTATable = table.tableorder_value === 'TA';

            // Only show custom tables if they have active KOTs
            if (isCustomTable && kotCount === 0) {
                // Remove from localStorage if no KOTs
                PosnicPro.kot.removeCustomTable(table.tableorder_value);
                // Don't render the card
                if (callback && typeof callback === 'function') {
                    callback();
                }
                return;
            }

            // Build appropriate card based on table type
            var tableCard;
            if (isTATable) {
                tableCard = PosnicPro.kot.buildTakeawayCard(kotList, kotCount);
            } else {
                tableCard = PosnicPro.kot.buildTableCard(table, kotList, kotCount);
            }

            $('#kot_tables_grid').append(tableCard);

            // Initialize tooltips after adding cards
            PosnicPro.kot.initTooltips();

            if (callback && typeof callback === 'function') {
                callback();
            }
        });
    },

    showTableKOTs: function (tableNumber, tableId) {
        PosnicPro.kot.currentTableNumber = tableNumber;
        PosnicPro.kot.currentTableId = tableId;

        var loader = $(".loader-table-kot-detail");
        $("<div class='loadingSpinner'></div>").appendTo(loader);

        $('#table_kot_number').text(tableNumber);
        $('#table_kot_modal').modal('show');

        var filters = {
            sale_process: 'KOT'
        };
        
        if (tableNumber === 'TA') {
            filters.dine_type = 'Take away';
        } else {
            filters.table_number = tableNumber;
        }

        var params = {
            url: 'sales',
            data: {
                page: 1,
                limit: 100,
                filters: JSON.stringify(filters)
            }
        };

        PosnicPro.get(params, function (response) {
            loader.find(".loadingSpinner:first").remove();

            $('#table_kot_tbody').empty();

            if (response.type === 'success' && response.data && response.data.list && response.data.list.length > 0) {
                $('#table_kot_empty').hide();
                $('#table_kot_list').show();

                response.data.list.forEach(function (kot, index) {
                    var updateDate = PosnicPro.convertDate(kot.string_date);
                    var dineType = kot.dine_type || 'Dine-in';
                    var pax = (typeof kot.person_count !== 'undefined' && kot.person_count !== null) ? kot.person_count : '-';
                    var status = kot.sale_status || 'Pending';

                    var statusBadge = 'badge-warning';
                    if (status === 'Completed') statusBadge = 'badge-success';
                    if (status === 'Cancelled') statusBadge = 'badge-danger';

                    var actions = `
                        <a href="javascript:void(0);" class="btn btn-sm btn-primary-rgba mr-1" data-toggle="tooltip" title="View" onclick="PosnicPro.kothistory.view('${kot._id}')">
                            <i class="feather icon-eye"></i>
                        </a>
                        <a href="javascript:void(0);" class="btn btn-sm btn-info-rgba mr-1" data-toggle="tooltip" title="Edit KOT" onclick="PosnicPro.kothistory.edit('${kot._id}')">
                            <i class="feather icon-edit-1"></i>
                        </a>
                        <a href="javascript:void(0);" class="btn btn-sm btn-warning-rgba mr-1" data-toggle="tooltip" title="Discount" onclick="PosnicPro.kot.showDiscount('${kot._id}')">
                            <i class="feather icon-percent"></i>
                        </a>
                        <a href="javascript:void(0);" class="btn btn-sm btn-success-rgba mr-1" data-toggle="tooltip" title="Settlement" onclick="PosnicPro.kothistory.proceed('${kot._id}')">
                            <i class="feather icon-arrow-right-circle"></i>
                        </a>
                        <a href="javascript:void(0);" class="btn btn-sm btn-secondary-rgba mr-1" data-toggle="tooltip" title="Print" onclick="PosnicPro.kothistory.print('${kot._id}')">
                            <i class="feather icon-printer"></i>
                        </a>
                        <a href="javascript:void(0);" class="btn btn-sm btn-danger-rgba" data-toggle="tooltip" title="Cancel" onclick="PosnicPro.kothistory.cancel('${kot._id}')">
                            <i class="feather icon-x-circle"></i>
                        </a>
                    `;

                    var row = `
                        <tr>
                            <td>${index + 1}</td>
                            <td>${kot.sales_id}</td>
                            <td>${updateDate}</td>
                            <td>${dineType}</td>
                            <td class="text-center">${pax}</td>
                            <td class="text-center"><span class="badge ${statusBadge}">${status}</span></td>
                            <td class="text-center">${actions}</td>
                        </tr>
                    `;

                    $('#table_kot_tbody').append(row);
                });

                $('[data-toggle="tooltip"]').tooltip();
            } else {
                $('#table_kot_list').hide();
                $('#table_kot_empty').show();
            }
        }, function (xhr) {
            loader.find(".loadingSpinner:first").remove();
            var response = jQuery.parseJSON(xhr.responseText);
            PosnicPro.alert(response.type, response.message);
        });
    },

    buildTakeawayCard: function (kotList, kotCount) {
        var statusClass = kotCount > 0 ? 'border-warning' : 'border-secondary';
        var statusBadge = kotCount > 0 ? 'badge-warning' : 'badge-secondary';
        var statusText = kotCount > 0 ? kotCount + ' Active KOT' + (kotCount > 1 ? 's' : '') : 'Empty';

        var kotItemsHtml = '';
        if (kotList.length > 0) {
            kotList.forEach(function (kot, index) {
                // Extract time in 24-hour format from date
                var timeStr = '';
                if (kot.string_date) {
                    var dateObj = new Date(kot.string_date);
                    var hours = dateObj.getHours().toString().padStart(2, '0');
                    var minutes = dateObj.getMinutes().toString().padStart(2, '0');
                    timeStr = hours + ':' + minutes;
                }

                var total = (typeof kot.total_amount !== 'undefined' && kot.total_amount !== null) ? parseFloat(kot.total_amount).toFixed(2) : '0.00';
                var hasDiscount = (typeof kot.discount_amount !== 'undefined' && kot.discount_amount !== null && parseFloat(kot.discount_amount) > 0);
                var discountIcon = hasDiscount ? '<i class="feather icon-tag" style="font-size: 12px; margin-left: 4px; color: #ffc107;" title="Discount Applied" data-toggle="tooltip"></i>' : '';

                kotItemsHtml += `
                    <div class="kot-item" style="border-bottom: 1px solid #e9ecef; padding: 8px 0; margin-bottom: 8px;">
                        <div class="d-flex justify-content-between align-items-center">
                            <div style="flex: 1; display: flex; align-items: center; gap: 15px;">
                                <span class="text-muted" style="font-size: 13px; font-weight: 600; display: flex; align-items: center;">
                                    <i class="feather icon-clock" style="font-size: 14px; margin-right: 4px;"></i>${timeStr}
                                </span>
                                <span class="text-primary" style="font-size: 15px; font-weight: 700; display: flex; align-items: center;">₹${total}${discountIcon}</span>
                            </div>
                            <div class="btn-group" role="group">
                                <button type="button" class="btn btn-sm btn-outline-primary" onclick="PosnicPro.kot.viewKOT('${kot._id}')" title="View KOT" data-toggle="tooltip">
                                    <i class="feather icon-eye"></i>
                                </button>
                                <button type="button" class="btn btn-sm btn-outline-success" onclick="PosnicPro.kothistory.proceed('${kot._id}')" title="Settlement" data-toggle="tooltip">
                                    <i class="feather icon-dollar-sign"></i>
                                </button>
                                <button type="button" class="btn btn-sm btn-outline-secondary" onclick="PosnicPro.kot.printKOTReceipt('${kot._id}')" title="Print Bill" data-toggle="tooltip">
                                    <i class="feather icon-printer"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            });
        } else {
            kotItemsHtml = '<div class="text-center text-muted" style="padding: 20px 0;"><small>No active orders</small></div>';
        }

        return `
            <div class="col-lg-6 col-xl-4 mb-4">
                <div class="card ${statusClass}" style="border-width: 2px; min-height: 280px;">
                    <div class="card-header" style="background: #fff3cd; border-bottom: 2px solid #ffc107; padding: 12px 15px;">
                        <div class="d-flex justify-content-between align-items-center">
                            <div class="d-flex align-items-center" style="flex: 1;">
                                <h2 class="mb-0 mr-3" style="font-weight: 700; font-size: 40px; color: #856404; line-height: 1;">TA</h2>
                                <div style="margin-right: auto;">
                                    <i class="feather icon-shopping-bag" style="font-size: 40px; color: #ffc107;"></i>
                                </div>
                                <div class="text-center" style="flex: 1;">
                                    <span class="badge ${statusBadge}" style="font-size: 11px; padding: 4px 10px;">${statusText}</span>
                                </div>
                            </div>
                            <button type="button" class="btn btn-warning btn-sm" onclick="PosnicPro.kot.addTakeawayKOT()">
                                <i class="feather icon-plus"></i> Add KOT
                            </button>
                        </div>
                    </div>
                    <div class="card-body" style="padding: 12px; max-height: 400px; overflow-y: auto;">
                        ${kotItemsHtml}
                    </div>
                </div>
            </div>
        `;
    },

    buildTableCard: function (table, kotList, kotCount) {
        var statusClass = kotCount > 0 ? 'border-success' : 'border-secondary';
        var statusBadge = kotCount > 0 ? 'badge-success' : 'badge-secondary';
        var statusText = kotCount > 0 ? kotCount + ' Active KOT' + (kotCount > 1 ? 's' : '') : 'Empty';

        var kotItemsHtml = '';
        if (kotList.length > 0) {
            kotList.forEach(function (kot, index) {
                // Extract time in 24-hour format from date
                var timeStr = '';
                if (kot.string_date) {
                    var dateObj = new Date(kot.string_date);
                    var hours = dateObj.getHours().toString().padStart(2, '0');
                    var minutes = dateObj.getMinutes().toString().padStart(2, '0');
                    timeStr = hours + ':' + minutes;
                }

                var total = (typeof kot.total_amount !== 'undefined' && kot.total_amount !== null) ? parseFloat(kot.total_amount).toFixed(2) : '0.00';
                var hasDiscount = (typeof kot.discount_amount !== 'undefined' && kot.discount_amount !== null && parseFloat(kot.discount_amount) > 0);
                var discountIcon = hasDiscount ? '<i class="feather icon-tag" style="font-size: 12px; margin-left: 4px; color: #ffc107;" title="Discount Applied" data-toggle="tooltip"></i>' : '';

                kotItemsHtml += `
                    <div class="kot-item" style="border-bottom: 1px solid #e9ecef; padding: 8px 0; margin-bottom: 8px;">
                        <div class="d-flex justify-content-between align-items-center">
                            <div style="flex: 1; display: flex; align-items: center; gap: 15px;">
                                <span class="text-muted" style="font-size: 13px; font-weight: 600; display: flex; align-items: center;">
                                    <i class="feather icon-clock" style="font-size: 14px; margin-right: 4px;"></i>${timeStr}
                                </span>
                                <span class="text-primary" style="font-size: 15px; font-weight: 700; display: flex; align-items: center;">₹${total}${discountIcon}</span>
                            </div>
                            <div class="btn-group" role="group">
                                <button type="button" class="btn btn-sm btn-outline-primary" onclick="PosnicPro.kot.viewKOT('${kot._id}')" title="View KOT" data-toggle="tooltip">
                                    <i class="feather icon-eye"></i>
                                </button>
                                <button type="button" class="btn btn-sm btn-outline-success" onclick="PosnicPro.kothistory.proceed('${kot._id}')" title="Settlement" data-toggle="tooltip">
                                    <i class="feather icon-dollar-sign"></i>
                                </button>
                                <button type="button" class="btn btn-sm btn-outline-secondary" onclick="PosnicPro.kot.printKOTReceipt('${kot._id}')" title="Print Bill" data-toggle="tooltip">
                                    <i class="feather icon-printer"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            });
        } else {
            kotItemsHtml = '<div class="text-center text-muted" style="padding: 20px 0;"><small>No active orders</small></div>';
        }

        // Use table.png icon with gray filter
        var tableIcon = '<img src="static/images/icons/table.png" width="40" height="40" style="opacity: 0.4; filter: grayscale(100%);" alt="Table">';

        return `
            <div class="col-lg-6 col-xl-4 mb-4">
                <div class="card ${statusClass}" style="border-width: 2px; min-height: 280px;">
                    <div class="card-header" style="background: #f8f9fa; border-bottom: 2px solid #dee2e6; padding: 12px 15px;">
                        <div class="d-flex justify-content-between align-items-center">
                            <div class="d-flex align-items-center" style="flex: 1;">
                                <h2 class="mb-0 mr-3" style="font-weight: 700; font-size: 40px; color: #2c3e50; line-height: 1;">${table.tableorder_value}</h2>
                                <div style="margin-right: auto;">
                                    ${tableIcon}
                                </div>
                                <div class="text-center" style="flex: 1;">
                                    <span class="badge ${statusBadge}" style="font-size: 11px; padding: 4px 10px;">${statusText}</span>
                                </div>
                            </div>
                            <button type="button" class="btn btn-success btn-sm" onclick="PosnicPro.kot.addNewKOT('${table.tableorder_value}', '${table.tableorder_id}')">
                                <i class="feather icon-plus"></i> Add KOT
                            </button>
                        </div>
                    </div>
                    <div class="card-body" style="padding: 12px; max-height: 400px; overflow-y: auto;">
                        ${kotItemsHtml}
                    </div>
                </div>
            </div>
        `;
    },

    addNewKOT: function (tableNumber, tableId) {
        console.log('=== addNewKOT called ===');
        console.log('tableNumber:', tableNumber, 'tableId:', tableId);

        if (tableNumber === 'TA') {
            console.log('TA detected - going to sales/new');
            PosnicPro.sales = PosnicPro.sales || {};
            PosnicPro.sales.saleProcess = 'KOT';
            PosnicPro.sales.selectedTable = { id: 'TA', tableNumber: 'TA' };

            PosnicPro.kotorder = PosnicPro.kotorder || {};
            PosnicPro.kotorder.kotTableNumber = 'TA';
            PosnicPro.kotorder.kotOrderType = 'Take away';
            PosnicPro.kotorder.kotPersonCount = 0;
            PosnicPro.kotorder.selectedPerson = 0;

            $('#sale_dine_type').val('Take away');

            console.log('Set for TA - selectedTable:', PosnicPro.sales.selectedTable);

            if (typeof hasher !== 'undefined') {
                hasher.setHash('sales/new');
            } else {
                window.location.hash = '#/sales/new';
            }
        } else {
            console.log('Regular table - going to kotorder/new');

            PosnicPro.kot.currentTableNumber = tableNumber;
            PosnicPro.kot.currentTableId = tableId;

            PosnicPro.kotorder = PosnicPro.kotorder || {};

            PosnicPro.kotorder.preSelectedTable = tableNumber;
            PosnicPro.kotorder.preSelectedTableId = tableId;

            console.log('Set preSelectedTable:', PosnicPro.kotorder.preSelectedTable);
            console.log('Set preSelectedTableId:', PosnicPro.kotorder.preSelectedTableId);

            if (typeof hasher !== 'undefined') {
                hasher.setHash('kotorder/new');
            } else {
                window.location.hash = '#/kotorder/new';
            }
        }
    },

    startNewKOT: function () {
        var tableNumber = PosnicPro.kot.currentTableNumber;
        var tableId = PosnicPro.kot.currentTableId;

        if (tableNumber) {
            if (!tableId && tableNumber !== 'TA') {
                tableId = 'table_' + tableNumber;
            }
            PosnicPro.kot.addNewKOT(tableNumber, tableId);
        } else {
            if (typeof hasher !== 'undefined') {
                hasher.setHash('kotorder/new');
            } else {
                window.location.hash = '#/kotorder/new';
            }
        }
    },

    openBlankKOT: function () {
        // ✅ Initialize sales object and reset submission flag FIRST
        PosnicPro.sales = PosnicPro.sales || {};
        PosnicPro.sales.submissionInProgress = false;
        $("#save_btn").prop('disabled', false);
        $("#save_submit").removeClass('disabled');
        
        
        // Clear any previously selected table context so the KOT
        // wizard starts with an empty table selection.
        PosnicPro.kot.currentTableNumber = null;
        PosnicPro.kot.currentTableId = null;

        PosnicPro.kotorder = PosnicPro.kotorder || {};
        PosnicPro.kotorder.preSelectedTable = null;
        PosnicPro.kotorder.preSelectedTableId = null;

        // Also clear preserved sales table so showAdd() does not
        // restore an old table into the wizard.
        PosnicPro.sales.selectedTable = null;

        if (typeof hasher !== 'undefined') {
            hasher.setHash('kotorder/new');
        } else {
            window.location.hash = '#/kotorder/new';
        }
    },

    viewKOT: function (saleId) {
        var loader = $(".loader-view-kot");
        $("<div class='loadingSpinner'></div>").appendTo(loader);

        PosnicPro.get('sales/' + saleId, function (response) {
            if (response.type === 'success') {
                var data = response.data;

                $('#kot_view_modal').data('sale-id', saleId);
                $('#kot_view_sales_id').text(data.sales_id || '');

                var updateDate = PosnicPro.convertDate(data.date);
                $('#kot_view_date').text(updateDate || '');

                var dineType = data.dine_type || '';
                $('#kot_view_dine_type').text(dineType);

                var tableNumber = data.table_number || '-';
                $('#kot_view_table_number').text(tableNumber);

                var personCount = (typeof data.person_count !== 'undefined' && data.person_count !== null) ? data.person_count : '-';
                $('#kot_view_pax').text(personCount);

                // Show discount information if applied
                var hasDiscount = (typeof data.extra_discount !== 'undefined' && data.extra_discount !== null && parseFloat(data.extra_discount) > 0);
                if (hasDiscount) {
                    var discountType = (data.extra_discount_type || 'amount').toString().toLowerCase();
                    if (discountType === 'percentage') discountType = 'percent';
                    if (discountType === 'fixed') discountType = 'amount';

                    var discountValue = parseFloat(data.extra_discount);
                    var discountText = discountType === 'percent'
                        ? discountValue + '%'
                        : '₹' + discountValue.toFixed(2);
                    var discountDesc = data.discount_description ? ' - ' + data.discount_description : '';
                    $('#kot_view_discount_text').text(discountText + discountDesc);
                    $('#kot_view_discount_section').show();
                } else {
                    $('#kot_view_discount_section').hide();
                }

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
                    itemsHtml = '<tr><td colspan="3" class="text-center text-muted">No items</td></tr>';
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

    editKOT: function () {
        var saleId = $('#kot_view_modal').data('sale-id');
        if (saleId) {
            $('#kot_view_modal').modal('hide');
            if (typeof hasher !== 'undefined') {
                hasher.setHash('kotorder/' + saleId + '/edit');
            } else {
                window.location.hash = '#/kotorder/' + saleId + '/edit';
            }
        }
    },

    cancelKOT: function () {
        var saleId = $('#kot_view_modal').data('sale-id');
        if (saleId) {
            if (PosnicPro.kothistory && typeof PosnicPro.kothistory.cancel === 'function') {
                $('#kot_view_modal').modal('hide');
                PosnicPro.kothistory.cancel(saleId);
            } else if (confirm('Are you sure you want to cancel this KOT?')) {
                PosnicPro.post({ url: 'sales/cancel/' + saleId, data: '{}' }, function (response) {
                    PosnicPro.alert(response.type, response.message);
                    if (response.type === 'success') {
                        $('#kot_view_modal').modal('hide');
                        PosnicPro.kot.refreshTables();
                    }
                });
            }
        }
    },

    printKOT: function () {
        var saleId = $('#kot_view_modal').data('sale-id');
        if (saleId) {
            PosnicPro.kot.printKOTReceipt(saleId);
        }
    },

    printKOTReceipt: function (saleId) {
        // Print KOT receipt with only items, quantity, and customization (no payment details)
        if (PosnicPro && PosnicPro.sales && PosnicPro.sales.view && typeof PosnicPro.sales.view.printSale === 'function') {
            // The third parameter 'true' hides payment/payment status for KOT print
            PosnicPro.sales.view.printSale(saleId, 'sale', true);
        }
    },

    printKOTSlip: function (saleId) {
        if (!saleId) return;

        PosnicPro.get('sales/' + saleId, function (response) {
            if (response.type !== 'success') {
                PosnicPro.alert(response.type, response.message);
                return;
            }

            var data = response.data || {};
            var printSize = PosnicPro.local.get('printing_size') || 'receipt_small';

            function esc(s) {
                return String(s || '').replace(/[&<>"']/g, function (c) {
                    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
                });
            }

            var title = 'New Order';
            var dateTime = data.created_date || data.date || '';
            var orderType = (data.dine_type || '').toString().trim();
            var sid = (data.sales_id || '').toString().trim();
            var tableNo = (data.table_number || '').toString().trim();
            var pax = (data.person_count !== null && typeof data.person_count !== 'undefined') ? data.person_count : '';

            var items = data.items || [];
            var lines = '';

            for (var i = 0; i < items.length; i++) {
                var it = items[i] || {};
                var name = esc(it.item_name || '');
                var qty = it.item_quantity || 0;

                var descRaw = it.item_description || it.description || it.item_desc || '';
                var desc = esc(descRaw);
                var descText = desc ? ('** ' + desc + ' **') : '';

                lines += ''
                    + '<div class="kot-line" style="border-top:1px dashed #000;">'
                    + '<div class="kot-item">'
                    + '<div class="kot-item-name">' + name + '</div>'
                    + (descText ? '<div class="kot-item-desc">' + descText + '</div>' : '')
                    + '</div>'
                    + '<div class="kot-qty">X' + qty + '</div>'
                    + '</div>';
            }

            var content = ''
                + '<div id="receipt_wrapper" class="' + esc(printSize) + '">'
                + '<div id="receipt_wrapper_inner">'
                + '<div class="kot-center kot-title">' + esc(title) + '</div>'
                + '<div class="kot-center kot-datetime">' + esc(dateTime) + '</div>'
                + (orderType ? '<div class="kot-center kot-ordertype">' + esc(orderType) + '</div>' : '')
                + (sid ? '<div class="kot-center kot-sid">SID' + esc(sid) + '</div>' : '')
                + '<div class="kot-center kot-tablepax">Table: [' + esc(tableNo || '-') + '] / Pax: [' + esc(pax || '-') + ']</div>'
                + lines
                + '</div>'
                + '</div>'
                + '<style>'
                + '  #receipt_wrapper_inner{font-family: monospace;}'
                + '  .kot-center{text-align:center;}'
                + '  .kot-title{font-size:18px;font-weight:900;letter-spacing:1px;margin:4px 0 2px;}'
                + '  .kot-datetime{font-size:14px;font-weight:700;margin:2px 0;}'
                + '  .kot-ordertype{font-size:16px;font-weight:900;margin:2px 0;text-transform:uppercase;}'
                + '  .kot-sid{font-size:16px;font-weight:900;margin:2px 0;letter-spacing:2px;}'
                + '  .kot-tablepax{font-size:14px;font-weight:900;margin:4px 0;}'
                + '  .kot-dotted{border-top:1px dotted #000;margin:6px 0;}'
                + '  .kot-item-sep{width:100%;border-top:1px dashed #000;margin:6px 0;}'
                + '  .kot-line{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin:2px 0;}'
                + '  .kot-item{max-width:78%;word-break:break-word;}'
                + '  .kot-item-name{font-size:15px;font-weight:900;text-transform:uppercase;line-height:16px;}'
                + '  .kot-item-desc{font-size:9px !important;font-weight:400;font-style:italic;line-height:12px;margin-top:2px;text-transform:none;}'
                + '  .kot-qty{min-width:45px;text-align:right;font-size:15px;font-weight:900;}'
                + '</style>';

            PosnicPro.printView(content, '');
        });
    },

    editKOTFromList: function (saleId) {
        if (saleId) {
            if (typeof hasher !== 'undefined') {
                hasher.setHash('kotorder/' + saleId + '/edit');
            } else {
                window.location.hash = '#/kotorder/' + saleId + '/edit';
            }
        }
    },

    cancelKOTFromList: function (saleId) {
        if (saleId) {
            PosnicPro.kothistory.cancel(saleId);
        }
    },

    showDiscount: function (saleId) {
        // Fetch KOT data first to check if discount already exists
        PosnicPro.get('sales/' + saleId, function (response) {
            if (response.type === 'success' && response.data) {
                var data = response.data;
                $('#kot_discount_sale_id').val(saleId);
                var hasDiscount = (typeof data.extra_discount !== 'undefined' && data.extra_discount !== null && parseFloat(data.extra_discount) > 0);

                // Store sale ID for discount modal
                $('#kot_discount_modal').data('sale-id', saleId);

                // Close view modal if open
                $('#kot_view_modal').modal('hide');

                // Show discount modal first
                $('#kot_discount_modal').modal('show');

                // Wait for modal to be fully shown before setting values
                setTimeout(function () {
                    // If discount exists, pre-fill the form for editing
                    if (hasDiscount) {
                        var discountType = (data.extra_discount_type || 'amount').toString().toLowerCase();
                        if (discountType === 'fixed') discountType = 'amount';
                        if (discountType === 'percentage') discountType = 'percent';
                        $('#kot_discount_type').val(discountType);
                        var discountValue = data.extra_discount || 0;
                        var discountDesc = data.discount_description || '';
                        $('#kot_discount_value').val(discountValue);
                        $('#kot_discount_description').val(discountDesc);

                        // Change button text to Update for editing
                        $('#kot_discount_modal').find('.btn-success').html('<i class="feather icon-save mr-2"></i>Update');
                        $('#kot_discount_modal').data('edit-mode', true);
                        $('#kot_discount_clear_btn').show();
                    } else {
                        // Clear form for new discount
                        $('#kot_discount_type').val('amount');
                        $('#kot_discount_value').val('0');
                        $('#kot_discount_description').val('');

                        // Change button text to Save for new discount
                        $('#kot_discount_modal').find('.btn-success').html('<i class="feather icon-save mr-2"></i><lang class="lang_save_title">Save</lang>');
                        $('#kot_discount_modal').data('edit-mode', false);
                        $('#kot_discount_clear_btn').hide();
                    }
                }, 200);
            }
        });
    },

    addDiscountFromView: function () {
        var saleId = $('#kot_view_modal').data('sale-id');
        if (saleId) {
            // Hide the view modal first to prevent z-index issues
            $('#kot_view_modal').modal('hide');
            // Small delay to allow view modal to close before opening discount modal
            setTimeout(function () {
                PosnicPro.kot.showDiscount(saleId);
            }, 300);
        }
    },

    saveDiscount: function () {
        PosnicPro.kot.applyDiscount(false);
    },

    saveAndPrintBill: function () {
        PosnicPro.kot.applyDiscount(true);
    },

    applyDiscount: function (printAfterSave) {

        var saleId = $('#kot_discount_sale_id').val();
        var discountType = $('#kot_discount_type').val();
        if (discountType === 'percentage') discountType = 'percent';
        if (discountType === 'fixed') discountType = 'amount';

        var rawDiscountValue = $('#kot_discount_value').val();
        var discountValue = rawDiscountValue === '' ? NaN : parseFloat(rawDiscountValue);
        var description = ($('#kot_discount_description').val() || '').trim();

        // JS-based validation so we don't show native browser tooltip
        if (!saleId || isNaN(discountValue) || description === '') {
            PosnicPro.alert('error', 'Fill in all required fields.');
            return;
        }

        var loader = $(".loader-table-kot-detail");
        $("<div class='loadingSpinner'></div>").appendTo(loader);

        PosnicPro.get('sales/' + saleId, function (response) {
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
                }

                var params = {
                    url: 'sales/updateOrder',
                    data: JSON.stringify({
                        order_id: data._id || data.id || saleId,
                        items: items,
                        total_amount: data.sales_total || 0,
                        status: data.sale_status || 'pending',
                        extra_discount_type: discountType,
                        extra_discount: discountValue,
                        discount_description: description,
                        table_number: data.table_number || '',
                        dine_type: data.dine_type || ''
                    })
                };

                PosnicPro.put(params, function (res) {
                    loader.find(".loadingSpinner:first").remove();
                    PosnicPro.alert(res.type, res.message);

                    if (res.type === 'success') {
                        $('#kot_discount_modal').modal('hide');

                        if (printAfterSave) {
                            // Print the bill after saving discount
                            if (PosnicPro && PosnicPro.sales && PosnicPro.sales.view && typeof PosnicPro.sales.view.printSale === 'function') {
                                PosnicPro.sales.view.printSale(saleId, 'sale', true);
                            }
                        }

                        // Refresh both left and right panels
                        PosnicPro.kot.refreshKOTData();
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
    },

    clearDiscountFromIcon: function (saleId) {
        if (!saleId) return;
        $('#kot_clear_discount_modal').data('sale-id', saleId);
        $('#kot_clear_discount_modal').modal('show');
    },

    confirmClearDiscount: function () {
        var saleId = $('#kot_clear_discount_modal').data('sale-id');
        if (!saleId) return;

        $('#kot_clear_discount_modal').modal('hide');

        $('#kot_discount_sale_id').val(saleId);
        PosnicPro.kot.clearDiscount();
    },

    clearDiscount: function () {
        var saleId = $('#kot_discount_sale_id').val();
        if (!saleId) {
            PosnicPro.alert('error', 'Sale ID not found');
            return;
        }

        var loader = $(".loader-table-kot-detail");
        $("<div class='loadingSpinner'></div>").appendTo(loader);

        PosnicPro.get('sales/' + saleId, function (response) {
            if (response.type !== 'success') {
                loader.find(".loadingSpinner:first").remove();
                PosnicPro.alert('error', response.message || 'Failed to load sale');
                return;
            }

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
            }

            var params = {
                url: 'sales/updateOrder',
                data: JSON.stringify({
                    order_id: data._id || data.id || saleId,
                    items: items,
                    total_amount: data.sales_total || 0,
                    status: data.sale_status || 'pending',
                    extra_discount_type: 'amount',
                    extra_discount: 0,
                    discount_description: '',
                    table_number: data.table_number || '',
                    dine_type: data.dine_type || ''
                })
            };

            PosnicPro.put(params, function (res) {
                loader.find(".loadingSpinner:first").remove();
                PosnicPro.alert(res.type, res.message);

                if (res.type === 'success') {
                    $('#kot_discount_modal').modal('hide');
                    PosnicPro.kot.refreshKOTData();
                }
            }, function () {
                loader.find(".loadingSpinner:first").remove();
                PosnicPro.alert('error', 'Failed to clear discount');
            });
        });
    },

    refreshTables: function () {
        var selected = PosnicPro.kot.currentTableNumber;

        PosnicPro.kot.loadTables(function (tables, hasTakeaway) {
            // Only reselect if a table was already selected
            if (selected) {
                var tableBox = $('[data-table-number="' + selected + '"]');
                if (tableBox.length > 0) {
                    $('.kot-table-box').css({
                        'background': 'white',
                        'transform': 'scale(1)',
                        'box-shadow': 'none'
                    });

                    tableBox.css({
                        'background': '#e3f2fd',
                        'transform': 'scale(1.05)',
                        'box-shadow': '0 4px 8px rgba(33, 150, 243, 0.3)'
                    });

                    PosnicPro.kot.loadTableDetails(selected);
                }
            }
        });
    },

    updateItemQuantity: function (saleId, itemId, change) {
        if (!saleId || !itemId) return;

        var loader = $(".loader-table-kot-detail"); 
        if (loader.length === 0) loader = $("body");
        
        // Show loading indicator
        var spinner = $("<div class='loadingSpinner' style='position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); z-index:9999;'></div>");
        // Ensure parent has relative position
        if (loader.css('position') === 'static') loader.css('position', 'relative');
        loader.append(spinner);

        PosnicPro.get('sales/' + saleId, function (response) {
            if (response.type !== 'success') {
                spinner.remove();
                PosnicPro.alert('error', response.message || 'Failed to load order');
                return;
            }

            var data = response.data || {};
            var items = [];
            var newTotal = 0;
            var itemFound = false;

            if (data.items && data.items.length) {
                for (var i = 0; i < data.items.length; i++) {
                    var item = data.items[i];
                    var currentQty = parseFloat(item.item_quantity || 0);
                    var price = parseFloat(item.item_price || 0);
                    var id = item.item_id || '';

                    if (id.toString() === itemId.toString()) {
                        currentQty += change;
                        if (currentQty < 1) {
                            currentQty = 1; // Minimum 1
                        }
                        itemFound = true;
                    }

                    items.push({
                        product_id: id,
                        quantity: currentQty,
                        price: price
                    });

                    newTotal += (currentQty * price);
                }
            }

            if (!itemFound) {
                spinner.remove();
                return;
            }

            // Apply existing discount if any
            var discountType = data.extra_discount_type || 'amount';
            var discountValue = parseFloat(data.extra_discount || 0);
            
            if (discountValue > 0) {
                 if (discountType === 'percentage' || discountType === 'percent') {
                     var discAmount = (newTotal * discountValue) / 100;
                     newTotal -= discAmount;
                 } else {
                     newTotal -= discountValue;
                 }
            }
            
            // Ensure total is not negative
            if (newTotal < 0) newTotal = 0;

            var params = {
                url: 'sales/updateOrder',
                data: JSON.stringify({
                    order_id: data._id || data.id || saleId,
                    items: items,
                    total_amount: newTotal,
                    status: data.sale_status || 'pending',
                    extra_discount_type: discountType,
                    extra_discount: discountValue,
                    discount_description: data.discount_description || '',
                    table_number: data.table_number || '',
                    dine_type: data.dine_type || ''
                })
            };

            PosnicPro.put(params, function (res) {
                spinner.remove();
                if (res.type === 'success') {
                    // ✅ FIX: Only refresh details panel, don't navigate/reload page
                    if (PosnicPro.kot.currentTableNumber) {
                        PosnicPro.kot.loadTableDetails(PosnicPro.kot.currentTableNumber);
                    }
                    // ✅ FIX: Also refresh tables list to update status without navigation
                    if (typeof PosnicPro.kot.refreshTables === 'function') {
                        PosnicPro.kot.refreshTables();
                    }
                } else {
                    PosnicPro.alert(res.type, res.message);
                }
            }, function (xhr) {
                spinner.remove();
                var err = JSON.parse(xhr.responseText || '{}');
                PosnicPro.alert('error', err.message || 'Failed to update quantity');
            });

        }, function (xhr) {
            spinner.remove();
            PosnicPro.alert('error', 'Failed to load order');
        });
    },

    deleteItem: function (saleId, itemId) {
        if (!saleId || !itemId) return;

        // Check if we're in edit mode
        var $updateBtn = $('.kot-update-btn[data-sale-id="' + saleId + '"]');
        
        if ($updateBtn.is(':visible')) {
            // In edit mode - just remove from table (no API call)
            var $table = $('.kot-item-qty-controls[data-sale-id="' + saleId + '"][data-item-id="' + itemId + '"]').closest('table');
            var rowCount = $table.find('tr').length;
            
            // Check if this is the last item
            if (rowCount <= 1) {
                PosnicPro.alert('error', 'You cannot remove the last item. An order needs at least one product.');
                return;
            }
            
            // Remove the row from table (no API call)
            $('.kot-item-qty-controls[data-sale-id="' + saleId + '"][data-item-id="' + itemId + '"]').closest('tr').remove();
            
            // Update total display
            PosnicPro.kot.updateTotalDisplay(saleId);
            return;
        }

        // Not in edit mode - show confirmation modal for API delete
        $('#kot_delete_item_modal').data('sale-id', saleId);
        $('#kot_delete_item_modal').data('item-id', itemId);
        $('#kot_delete_item_modal').modal('show');
    },

    confirmDeleteItem: function () {
        var saleId = $('#kot_delete_item_modal').data('sale-id');
        var itemId = $('#kot_delete_item_modal').data('item-id');
        
        // Hide modal
        $('#kot_delete_item_modal').modal('hide');

        if (!saleId || !itemId) return;

        var loader = $(".loader-table-kot-detail");
        if (loader.length === 0) loader = $("body");
        
        // Show loading indicator
        var spinner = $("<div class='loadingSpinner' style='position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); z-index:9999;'></div>");
        // Ensure parent has relative position
        if (loader.css('position') === 'static') loader.css('position', 'relative');
        loader.append(spinner);

        PosnicPro.get('sales/' + saleId, function (response) {
            if (response.type !== 'success') {
                spinner.remove();
                PosnicPro.alert('error', response.message || 'Failed to load order');
                return;
            }

            var data = response.data || {};
            var items = [];
            var newTotal = 0;
            var itemFound = false;

            if (data.items && data.items.length) {
                for (var i = 0; i < data.items.length; i++) {
                    var item = data.items[i];
                    var currentQty = parseFloat(item.item_quantity || 0);
                    var price = parseFloat(item.item_price || 0);
                    var id = item.item_id || '';

                    if (id.toString() === itemId.toString()) {
                        itemFound = true;
                        continue; // Skip adding this item to new list
                    }

                    items.push({
                        product_id: id,
                        quantity: currentQty,
                        price: price
                    });

                    newTotal += (currentQty * price);
                }
            }

            if (!itemFound) {
                spinner.remove();
                return;
            }

            // If no items left, cancel the order instead of updating
            if (items.length === 0) {
                PosnicPro.post({ url: 'sales/cancel/' + saleId, data: '{}' }, function (res) {
                    spinner.remove();
                    if (res.type === 'success') {
                        PosnicPro.alert('success', 'Order cancelled - all items were removed.');
                        if (PosnicPro.kot.currentTableNumber) {
                             // Refresh tables and clear details panel
                             PosnicPro.kot.refreshTables();
                             $('#kot_table_details').html('<div class="text-center" style="padding: 100px 20px; color: #6c757d;"><i class="feather icon-arrow-left" style="font-size: 48px; margin-bottom: 20px; opacity: 0.3;"></i><p style="font-size: 16px; margin: 0;">Select a table from the left to view KOT details</p></div>');
                        } else {
                            PosnicPro.kot.refreshKOTData();
                        }
                    } else {
                        PosnicPro.alert(res.type, res.message);
                    }
                }, function(xhr) {
                    spinner.remove();
                    PosnicPro.alert('error', 'Failed to cancel empty order');
                });
                return;
            }

            // Apply existing discount if any
            var discountType = data.extra_discount_type || 'amount';
            var discountValue = parseFloat(data.extra_discount || 0);
            
            if (discountValue > 0) {
                 if (discountType === 'percentage' || discountType === 'percent') {
                     var discAmount = (newTotal * discountValue) / 100;
                     newTotal -= discAmount;
                 } else {
                     newTotal -= discountValue;
                 }
            }
            
            // Ensure total is not negative
            if (newTotal < 0) newTotal = 0;

            var params = {
                url: 'sales/updateOrder',
                data: JSON.stringify({
                    order_id: data._id || data.id || saleId,
                    items: items,
                    total_amount: newTotal,
                    status: data.sale_status || 'pending',
                    extra_discount_type: discountType,
                    extra_discount: discountValue,
                    discount_description: data.discount_description || '',
                    table_number: data.table_number || '',
                    dine_type: data.dine_type || ''
                })
            };

            PosnicPro.put(params, function (res) {
                spinner.remove();
                if (res.type === 'success') {
                    // Refresh KOT details for the current table
                    if (PosnicPro.kot.currentTableNumber) {
                        PosnicPro.kot.loadTableDetails(PosnicPro.kot.currentTableNumber);
                    } else {
                        PosnicPro.kot.refreshKOTData();
                    }
                } else {
                    PosnicPro.alert(res.type, res.message);
                }
            }, function (xhr) {
                spinner.remove();
                var err = JSON.parse(xhr.responseText || '{}');
                PosnicPro.alert('error', err.message || 'Failed to delete item');
            });

        }, function (xhr) {
            spinner.remove();
            PosnicPro.alert('error', 'Failed to load order');
        });
    },

    initTooltips: function () {
        // Initialize Bootstrap tooltips for dynamically added elements
        if (typeof $('[data-toggle="tooltip"]').tooltip === 'function') {
            $('[data-toggle="tooltip"]').tooltip();
        }
    },

    showAddItemFromView: function () {
        var saleId = $('#kot_view_modal').data('sale-id');
        if (saleId) {
            // Hide view modal
            $('#kot_view_modal').modal('hide');
            
            // Store sale ID
            $('#kot_add_item_modal').data('sale-id', saleId);
            
            // Clear search
            $('#kot_item_search').val('');
            $('#kot_item_search_results').html(`
                <div class="text-center text-muted mt-4">
                    <i class="feather icon-search" style="font-size: 32px; opacity: 0.2;"></i>
                    <p class="mt-2">Type to search for items</p>
                </div>
            `);
            
            // Show add modal
            setTimeout(function() {
                $('#kot_add_item_modal').modal('show');
                setTimeout(function() {
                    $('#kot_item_search').focus();
                }, 500);
            }, 300);
            
            // Initialize search listener if not already done
            if (!PosnicPro.kot.searchInitialized) {
                PosnicPro.kot.initItemSearch();
                PosnicPro.kot.searchInitialized = true;
            }
        }
    },

    showAddItemFromPanel: function (saleId) {
        if (saleId) {
            // Store sale ID
            $('#kot_add_item_modal').data('sale-id', saleId);
            
            // Clear search
            $('#kot_item_search').val('');
            $('#kot_item_search_results').html(`
                <div class="text-center text-muted mt-4">
                    <i class="feather icon-search" style="font-size: 32px; opacity: 0.2;"></i>
                    <p class="mt-2">Type to search for items</p>
                </div>
            `);
            
            // Show add modal
            $('#kot_add_item_modal').modal('show');
            setTimeout(function() {
                $('#kot_item_search').focus();
            }, 500);
            
            // Initialize search listener if not already done
            if (!PosnicPro.kot.searchInitialized) {
                PosnicPro.kot.initItemSearch();
                PosnicPro.kot.searchInitialized = true;
            }
        }
    },

    initItemSearch: function () {
        var searchTimeout;
        
        $('#kot_item_search').on('input', function () {
            var query = $(this).val().trim();
            var resultsContainer = $('#kot_item_search_results');
            
            clearTimeout(searchTimeout);
            
            if (query.length < 2) {
                resultsContainer.html(`
                    <div class="text-center text-muted mt-4">
                        <i class="feather icon-search" style="font-size: 32px; opacity: 0.2;"></i>
                        <p class="mt-2">Type to search for items</p>
                    </div>
                `);
                return;
            }
            
            searchTimeout = setTimeout(function () {
                resultsContainer.html('<div class="text-center mt-4"><div class="loadingSpinner"></div></div>');
                
                var params = {
                    url: 'items/getOnlineItemsAjaxList',
                    data: 'query=' + encodeURIComponent(query) + '&type=normal'
                };
                
                PosnicPro.get(params, function (response) {
                    if (response && response.suggestions && response.suggestions.length > 0) {
                        var html = '';
                        response.suggestions.forEach(function (item) {
                            // Item data is returned directly, not wrapped in 'data' property
                            var data = item.data || item;
                            if (!data) return;
                            
                            var itemName = data.item_name || data.name || '';
                            var itemPrice = parseFloat(data.selling_price || 0).toFixed(2);
                            var itemId = data.item_id || data.id || (data._id ? data._id.$oid : '');
                            var imagePath = (data.image && data.image !== "item.svg") ? data.image : 'static/images/default/item.svg';
                            
                            // Check stock if tracked
                            var trackInventory = (data.track_inventory === true || data.track_inventory === 'true' || data.track_inventory === 1);
                            var negativeStock = (data.negative_stock === true || data.negative_stock === 'true' || data.negative_stock === 1);
                            var availableQty = parseFloat(data.available_quantity || 0);
                            var outOfStock = (trackInventory && !negativeStock && availableQty <= 0);
                            
                            var opacity = outOfStock ? '0.6' : '1';
                            var clickAction = outOfStock ? '' : `onclick="PosnicPro.kot.addItemToOrder('${itemId}')"`;
                            var cursor = outOfStock ? 'not-allowed' : 'pointer';
                            var stockBadge = outOfStock ? '<span class="badge badge-danger ml-2">Out of Stock</span>' : '';
                            
                            html += `
                                <a href="javascript:void(0);" class="list-group-item list-group-item-action" 
                                   style="display: flex; align-items: center; padding: 10px; opacity: ${opacity}; cursor: ${cursor};" 
                                   ${clickAction}>
                                    <img src="${imagePath}" style="width: 40px; height: 40px; border-radius: 4px; object-fit: cover; margin-right: 15px;">
                                    <div style="flex: 1;">
                                        <div class="d-flex justify-content-between align-items-center">
                                            <h6 class="mb-0" style="font-weight: 600;">${itemName} ${stockBadge}</h6>
                                            <span class="text-primary font-weight-bold">₹${itemPrice}</span>
                                        </div>
                                    </div>
                                    ${!outOfStock ? '<i class="feather icon-plus-circle text-success ml-3" style="font-size: 20px;"></i>' : ''}
                                </a>
                            `;
                        });
                        resultsContainer.html(html);
                    } else {
                        resultsContainer.html(`
                            <div class="text-center text-muted mt-4">
                                <i class="feather icon-alert-circle" style="font-size: 32px; opacity: 0.2;"></i>
                                <p class="mt-2">No items found</p>
                            </div>
                        `);
                    }
                });
            }, 300);
        });
    },

    addItemToOrder: function (itemId) {
        var saleId = $('#kot_add_item_modal').data('sale-id');
        if (!saleId || !itemId) return;
        
        // Show loading overlay on modal
        var modalContent = $('#kot_add_item_modal .modal-content');
        var spinner = $("<div class='loadingSpinner' style='position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); z-index:9999;'></div>");
        if (modalContent.css('position') === 'static') modalContent.css('position', 'relative');
        modalContent.append(spinner);
        
        // 1. Get current order details
        PosnicPro.get('sales/' + saleId, function (response) {
            if (response.type !== 'success') {
                spinner.remove();
                PosnicPro.alert('error', 'Failed to load order');
                return;
            }

            var data = response.data || {};
            var items = [];
            var newTotal = 0;
            var itemFound = false;

            // 2. Prepare existing items
            if (data.items && data.items.length) {
                for (var i = 0; i < data.items.length; i++) {
                    var item = data.items[i];
                    var currentQty = parseFloat(item.item_quantity || 0);
                    var price = parseFloat(item.item_price || 0);
                    var id = item.item_id || '';

                    // Check if item already exists, if so increment quantity
                    if (id.toString() === itemId.toString()) {
                        currentQty += 1;
                        itemFound = true;
                    }

                    items.push({
                        product_id: id,
                        quantity: currentQty,
                        price: price
                    });

                    newTotal += (currentQty * price);
                }
            }

            // 3. If item not found in existing list, fetch item details and add it
            if (!itemFound) {
                var params = {
                    url: 'items/getOnlineItemsAjaxList',
                    data: 'query=' + itemId + '&type=id' // Assuming we can fetch by ID or using existing search
                };
                
                // Since getOnlineItemsAjaxList is search, let's use a more direct way if possible or search by ID
                // Alternatively, we can use the same search endpoint with specific query
                
                PosnicPro.get(params, function (itemResponse) {
                    var newItemData = null;
                    if (itemResponse && itemResponse.suggestions && itemResponse.suggestions.length > 0) {
                        // Find exact match - items are returned directly, not wrapped in 'data'
                        newItemData = itemResponse.suggestions.find(function(s) { 
                             var d = s.data || s;
                             var sid = d.item_id || d.id || (d._id ? d._id.$oid : '');
                             return sid.toString() === itemId.toString();
                        });
                        
                        if (!newItemData) newItemData = itemResponse.suggestions[0]; // Fallback
                    }
                    
                    if (newItemData) {
                        var d = newItemData.data || newItemData;
                        var price = parseFloat(d.selling_price || 0);
                        
                        // Calculate price with tax/discount logic if needed (simplified here for KOT)
                        // Ideally we should reuse sales.js logic for price calculation, but for now take selling_price
                        
                        items.push({
                            product_id: itemId,
                            quantity: 1,
                            price: price
                        });
                        
                        newTotal += price;
                        
                        PosnicPro.kot.finalizeAddItem(saleId, data, items, newTotal, spinner);
                    } else {
                        spinner.remove();
                        PosnicPro.alert('error', 'Item details not found');
                    }
                });
            } else {
                PosnicPro.kot.finalizeAddItem(saleId, data, items, newTotal, spinner);
            }

        }, function (xhr) {
            spinner.remove();
            PosnicPro.alert('error', 'Failed to load order');
        });
    },

    finalizeAddItem: function(saleId, orderData, items, newTotal, spinner) {
        // Apply existing discount if any
        var discountType = orderData.extra_discount_type || 'amount';
        var discountValue = parseFloat(orderData.extra_discount || 0);
        
        if (discountValue > 0) {
             if (discountType === 'percentage' || discountType === 'percent') {
                 var discAmount = (newTotal * discountValue) / 100;
                 newTotal -= discAmount;
             } else {
                 newTotal -= discountValue;
             }
        }
        
        // Ensure total is not negative
        if (newTotal < 0) newTotal = 0;

        var params = {
            url: 'sales/updateOrder',
            data: JSON.stringify({
                order_id: orderData._id || orderData.id || saleId,
                items: items,
                total_amount: newTotal,
                status: orderData.sale_status || 'pending',
                extra_discount_type: discountType,
                extra_discount: discountValue,
                discount_description: orderData.discount_description || '',
                table_number: orderData.table_number || '',
                dine_type: orderData.dine_type || ''
            })
        };

        PosnicPro.put(params, function (res) {
            spinner.remove();
            if (res.type === 'success') {
                PosnicPro.alert('success', 'Item added');
                
                // Hide add modal
                $('#kot_add_item_modal').modal('hide');
                
                // Refresh table details or list
                if (PosnicPro.kot.currentTableNumber) {
                     PosnicPro.kot.loadTableDetails(PosnicPro.kot.currentTableNumber);
                } else {
                    PosnicPro.kot.refreshKOTData();
                }
                
                // Re-open view modal after short delay to show updated list
                setTimeout(function() {
                    PosnicPro.kot.viewKOT(saleId);
                }, 500);
            } else {
                PosnicPro.alert(res.type, res.message);
            }
        }, function (xhr) {
            spinner.remove();
            var err = JSON.parse(xhr.responseText || '{}');
            PosnicPro.alert('error', err.message || 'Failed to update order');
        });
    },
};
