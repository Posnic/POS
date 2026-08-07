/**
 * Weight Machine Integration Module for POS Sales
 * Handles manual and automatic weight reading from Electron hardware
 */

(function() {
    'use strict';

    // Extend PosnicPro.sales with weight machine functionality
    if (typeof PosnicPro !== 'undefined' && PosnicPro.sales) {
        
        /**
         * Read weight from machine and populate quantity
         */
        PosnicPro.sales.readWeightFromMachine = async function() {
            // Check if weight machine is enabled in settings
            const settingsStr = PosnicPro.local.get('general_settings');
            const settings = settingsStr ? JSON.parse(settingsStr) : null;
            if (!settings || !settings.hardware_weight_machine_enable) {
                PosnicPro.toastr('warning', 'Weight machine is not enabled in settings');
                return;
            }

            // Check if WeightBridge is available
            if (!window.WeightBridge || !window.WeightBridge.isAvailable()) {
                PosnicPro.toastr('warning', 'Weight machine not available. Please use the desktop app.');
                window.WeightBridge && window.WeightBridge.showBrowserWarning();
                return;
            }

            try {
                // Show loading indicator
                $('#sales_read_weight_btn').html('<i class="feather icon-loader"></i> Reading...');
                $('#sales_read_weight_btn').prop('disabled', true);

                // Get current weight
                const weight = await window.WeightBridge.getCurrentWeight();

                if (weight === null || weight <= 0) {
                    PosnicPro.toastr('error', 'Could not read weight. Please ensure the weight machine is connected.');
                    return;
                }

                // Check if cursor is in an input field
                const activeElement = document.activeElement;
                const isInputField = activeElement && (
                    activeElement.tagName === 'INPUT' || 
                    activeElement.tagName === 'TEXTAREA'
                );

                if (isInputField && activeElement.type === 'text') {
                    // Fill the focused input field
                    $(activeElement).val(weight.toFixed(3));
                    $(activeElement).trigger('change');
                    PosnicPro.toastr('success', `Weight ${weight.toFixed(3)} kg filled`);
                } else {
                    // Update quantity of last added item in cart
                    const lastRow = $('.register-item-content tbody tr').last();
                    if (lastRow.length && lastRow.attr('id') !== 'sales_new_tablerow_content_area') {
                        const qtyInput = lastRow.find('input[name="sales_new_qty[]"]');
                        if (qtyInput.length) {
                            qtyInput.val(weight.toFixed(3));
                            qtyInput.trigger('change');
                            PosnicPro.toastr('success', `Weight ${weight.toFixed(3)} kg set for last item`);
                        } else {
                            PosnicPro.toastr('warning', 'No quantity field found for last item');
                        }
                    } else {
                        PosnicPro.toastr('warning', 'No items in cart. Please add an item first.');
                    }
                }

            } catch (error) {
                console.error('Weight reading error:', error);
                PosnicPro.toastr('error', 'Error reading weight: ' + error.message);
            } finally {
                // Reset button
                $('#sales_read_weight_btn').html('<i class="feather icon-anchor"></i> Weight');
                $('#sales_read_weight_btn').prop('disabled', false);
            }
        };

        /**
         * Auto-trigger weight reading when a weighed item is selected
         */
        PosnicPro.sales.checkAutoWeightTrigger = function(itemData) {
            // Check if weight machine is enabled
            const settingsStr = PosnicPro.local.get('general_settings');
            const settings = settingsStr ? JSON.parse(settingsStr) : null;
            if (!settings || !settings.hardware_weight_machine_enable) {
                return;
            }

            // Check if item is marked as weight-based
            if (itemData && itemData.item_weight_machine_based === '1') {
                // Check if WeightBridge is available
                if (window.WeightBridge && window.WeightBridge.isAvailable()) {
                    console.log('Auto-triggering weight reading for weighed item:', itemData.item_name);
                    
                    // Delay to allow item to be added to cart first
                    setTimeout(() => {
                        PosnicPro.sales.readWeightFromMachine();
                    }, 500);
                }
            }
        };

        /**
         * Initialize weight machine UI elements
         */
        PosnicPro.sales.initWeightMachine = function() {
            // Check if weight machine is enabled in settings
            const settingsStr = PosnicPro.local.get('general_settings');
            const settings = settingsStr ? JSON.parse(settingsStr) : null;
            
            console.log('initWeightMachine - settingsStr:', settingsStr);
            console.log('initWeightMachine - parsed settings:', settings);
            
            if (settings && settings.hardware_weight_machine_enable) {
                // Show both weight buttons
                $('#sales_read_weight_btn').show();
                $('#sales_read_weight_btn_top').show();
                
                // Check if running in Electron
                if (window.WeightBridge && window.WeightBridge.isAvailable()) {
                    console.log('Weight machine integration active (Electron)');
                } else {
                    console.log('Weight machine enabled but not in Electron environment');
                }
            } else {
                // Hide the weight button
                $('#sales_read_weight_btn').hide();
            }
        };

        // Hook into existing item selection logic
        const originalAddItem = PosnicPro.sales.addItem;
        if (originalAddItem) {
            PosnicPro.sales.addItem = function(itemData) {
                // Call original function
                const result = originalAddItem.apply(this, arguments);
                
                // Check for auto weight trigger
                PosnicPro.sales.checkAutoWeightTrigger(itemData);
                
                return result;
            };
        }

        // Initialize on page load
        $(document).ready(function() {
            if ($('#sales_new').length) {
                PosnicPro.sales.initWeightMachine();
            }
        });

        console.log('Weight machine integration module loaded');
    }

})();
