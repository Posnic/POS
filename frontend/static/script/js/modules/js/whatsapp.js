/**
 * WhatsApp Connection Module
 * Handles WhatsApp Web integration with QR code authentication
 */

if (typeof PosnicPro === 'undefined') {
    var PosnicPro = {};
}

console.log('WhatsApp module loading...');

PosnicPro.whatsapp = {
    deviceId: null,
    statusCheckInterval: null,
    qrCheckInterval: null,
    templates: [],

    /**
     * Initialize WhatsApp connection
     */
    connect: function() {
        const deviceId = $('#whatsapp_device_id').val().trim();
        
        if (!deviceId) {
            PosnicPro.alert('error', PosnicPro.i18n.t('lang_please_enter_a_device_id', 'Please enter a Device ID'));
            return;
        }

        this.deviceId = deviceId;
        
        // Show loading state
        $('#whatsapp_connect_btn').prop('disabled', true).html('<i class="feather icon-loader"></i> Connecting...');
        
        // Resolve the currently selected branch (same source the rest of the app uses)
        const branchId = PosnicPro.local.get('branch_id_set');
        if (!branchId) {
            this.hideConnectLoading();
            $('#whatsapp_connect_btn').prop('disabled', false).html('<i class="feather icon-link mr-1"></i> Connect WhatsApp');
            $('#whatsapp_refresh_status').prop('disabled', false);
            PosnicPro.alert('error', PosnicPro.i18n.t('lang_please_select_a_branch_before_connecting_w', 'Please select a branch before connecting WhatsApp'));
            return;
        }

        // Initialize connection
        const params = {
            url: 'whatsapp/initialize',
            data: { device_id: deviceId, branch_id: branchId }
        };

        PosnicPro.post(params, (response) => {
            if (response.type === 'success') {
                // Show QR container
                $('#whatsapp_qr_container').show();
                $('#whatsapp_connect_btn').hide();
                
                // Start polling for QR code
                this.startQRPolling();
                
                PosnicPro.alert('success', PosnicPro.i18n.t('lang_connecting_to_whatsapp', 'Connecting to WhatsApp...'));
            } else {
                $('#whatsapp_connect_btn').prop('disabled', false).html('<i class="feather icon-link"></i> Connect WhatsApp');
                PosnicPro.alert('error', response.message || 'Failed to initialize connection');
            }
        });
    },

    /**
     * Start polling for QR code
     */
    startQRPolling: function() {
        let attempts = 0;
        const maxAttempts = 60; // Poll for 60 seconds
        
        this.qrCheckInterval = setInterval(() => {
            attempts++;
            
            if (attempts > maxAttempts) {
                clearInterval(this.qrCheckInterval);
                PosnicPro.alert('error', PosnicPro.i18n.t('lang_qr_code_generation_timeout_please_try_agai', 'QR code generation timeout. Please try again.'));
                this.resetUI();
                return;
            }

            const params = {
                url: 'whatsapp/getQRCode',
                data: { device_id: this.deviceId }
            };

            PosnicPro.get(params, (response) => {
                if (response.type === 'success' && response.data) {
                    const { qr_code, status } = response.data;
                    
                    if (qr_code) {
                        // Display QR code
                        $('#whatsapp_qr_code').html(`<img loading="lazy" decoding="async" src="${qr_code}" alt="WhatsApp QR Code" style="max-width:300px;">`);
                        
                        // Start status checking
                        clearInterval(this.qrCheckInterval);
                        this.startStatusPolling();
                    }
                    
                    if (status === 'connected') {
                        clearInterval(this.qrCheckInterval);
                        this.onConnected();
                    }
                }
            });
        }, 1000); // Check every second
    },

    /**
     * Start polling for connection status
     */
    startStatusPolling: function() {
        this.statusCheckInterval = setInterval(() => {
            this.checkStatus(true);
        }, 3000); // Check every 3 seconds
    },

    /**
     * Check connection status
     */
    checkStatus: function(silent = false) {
        const deviceId = this.deviceId || $('#whatsapp_device_id').val().trim();
        
        if (!deviceId) {
            if (!silent) {
                PosnicPro.alert('error', PosnicPro.i18n.t('lang_please_enter_a_device_id', 'Please enter a Device ID'));
            }
            return;
        }

        const params = {
            url: 'whatsapp/getStatus',
            data: { device_id: deviceId }
        };

        PosnicPro.get(params, (response) => {
            if (response.type === 'success' && response.data) {
                const { status, connected } = response.data;
                
                this.updateStatusBadge(status, connected);
                
                if (connected) {
                    this.onConnected();
                } else if (status === 'qr_ready') {
                    // QR code is ready, fetch and display it
                    this.fetchAndDisplayQR();
                } else if (status === 'not_initialized' || status === 'disconnected') {
                    // Only show connect button for truly disconnected states
                    this.showConnectButton();
                }
            } else {
                // If status check fails, show connect button
                this.showConnectButton();
            }
        });
    },

    /**
     * Fetch and display QR code
     */
    fetchAndDisplayQR: function() {
        const params = {
            url: 'whatsapp/getQRCode',
            data: { device_id: this.deviceId }
        };

        PosnicPro.get(params, (response) => {
            if (response.type === 'success' && response.data && response.data.qr_code) {
                // Show QR container and hide buttons
                $('#whatsapp_qr_container').show();
                $('#whatsapp_connect_btn').hide();
                $('#whatsapp_disconnect_btn').hide();
                $('#whatsapp_connected_info').hide();
                $('#whatsapp_device_id').prop('disabled', true);
                
                // Display QR code
                $('#whatsapp_qr_code').html(`
                    <img loading="lazy" decoding="async" src="${response.data.qr_code}" alt="WhatsApp QR Code" style="max-width:300px; border:1px solid #ddd; padding:10px; border-radius:8px;">
                    <p class="mt-3 text-muted"><lang class="lang_scan_this_qr_code_with_whatsapp_on_your_ph">Scan this QR code with WhatsApp on your phone</lang></p>
                `);
                
                // Start status polling if not already started
                if (!this.statusCheckInterval) {
                    this.startStatusPolling();
                }
            }
        });
    },

    /**
     * Show connect button for new/failed connections
     */
    showConnectButton: function() {
        $('#whatsapp_qr_container').hide();
        $('#whatsapp_connected_info').hide();
        $('#whatsapp_connect_btn').show();
        $('#whatsapp_disconnect_btn').hide();
        $('#whatsapp_device_id').prop('disabled', false);
    },

    /**
     * Update status badge
     */
    updateStatusBadge: function(status, connected) {
        const badge = $('#whatsapp_status_badge');
        
        const statusMap = {
            'not_initialized': { text: 'Not Connected', class: 'badge-secondary' },
            'initializing': { text: 'Initializing...', class: 'badge-info' },
            'qr_ready': { text: 'QR Ready - Scan Now', class: 'badge-warning' },
            'authenticated': { text: 'Authenticated', class: 'badge-info' },
            'connected': { text: 'Connected', class: 'badge-success' },
            'disconnected': { text: 'Disconnected', class: 'badge-danger' },
            'auth_failed': { text: 'Authentication Failed', class: 'badge-danger' }
        };

        const statusInfo = statusMap[status] || statusMap['not_initialized'];
        
        badge.removeClass('badge-secondary badge-info badge-warning badge-success badge-danger')
             .addClass(statusInfo.class)
             .text(statusInfo.text);
    },

    /**
     * Handle successful connection
     */
    onConnected: function() {
        // Clear intervals
        if (this.qrCheckInterval) {
            clearInterval(this.qrCheckInterval);
        }
        if (this.statusCheckInterval) {
            clearInterval(this.statusCheckInterval);
        }

        // Update UI
        $('#whatsapp_qr_container').hide();
        $('#whatsapp_connected_info').show();
        $('#whatsapp_connect_btn').hide();
        $('#whatsapp_disconnect_btn').show();
        $('#whatsapp_device_id').prop('disabled', true);

        // Show Send WhatsApp Message tab
        $('#whatsapp-send-tab').show();
        
        this.updateStatusBadge('connected', true);
        
        PosnicPro.alert('success', PosnicPro.i18n.t('lang_whatsapp_connected', 'WhatsApp connected'));
    },

    /**
     * Disconnect WhatsApp
     */
    disconnect: function() {
        const deviceId = this.deviceId || $('#whatsapp_device_id').val().trim();
        
        if (!deviceId) {
            PosnicPro.alert('error', PosnicPro.i18n.t('lang_device_id_not_found', 'Device ID not found'));
            return;
        }

        if (!confirm('Are you sure you want to disconnect WhatsApp? You will need to scan the QR code again to reconnect.')) {
            return;
        }

        $('#whatsapp_disconnect_btn').prop('disabled', true).html('<i class="feather icon-loader"></i> Disconnecting...');

        const params = {
            url: 'whatsapp/logout',
            data: { device_id: deviceId }
        };

        PosnicPro.post(params, (response) => {
            if (response.type === 'success') {
                this.resetUI();
                PosnicPro.alert('success', PosnicPro.i18n.t('lang_whatsapp_disconnected', 'WhatsApp disconnected'));
            } else {
                $('#whatsapp_disconnect_btn').prop('disabled', false).html('<i class="feather icon-log-out"></i> Disconnect');
                PosnicPro.alert('error', response.message || 'Failed to disconnect');
            }
        });
    },

    /**
     * Reset UI to initial state
     */
    resetUI: function() {
        // Clear intervals
        if (this.qrCheckInterval) {
            clearInterval(this.qrCheckInterval);
        }
        if (this.statusCheckInterval) {
            clearInterval(this.statusCheckInterval);
        }

        // Reset UI elements
        $('#whatsapp_qr_container').hide();
        $('#whatsapp_connected_info').hide();
        $('#whatsapp_connect_btn').show().prop('disabled', false).html('<i class="feather icon-link"></i> Connect WhatsApp');
        $('#whatsapp_disconnect_btn').hide().prop('disabled', false).html('<i class="feather icon-log-out"></i> Disconnect');
        $('#whatsapp_device_id').prop('disabled', false);
        $('#whatsapp_qr_code').html(`
            <div class="spinner-border text-primary" role="status">
                <span class="sr-only"><lang class="lang_loading_2">Loading...</lang></span>
            </div>
            <p class="mt-2"><lang class="lang_generating_qr_code">Generating QR Code...</lang></p>
        `);

        // Hide Send WhatsApp Message tab
        $('#whatsapp-send-tab').hide();

        this.updateStatusBadge('not_initialized', false);
        this.deviceId = null;
    },

    /**
     * Send WhatsApp message
     */
    sendMessage: function() {
        const deviceId = this.deviceId || $('#whatsapp_device_id').val().trim();
        const phoneNumber = $('#whatsapp_phone_number').val().trim();
        const message = $('#whatsapp_message_text').val().trim();
        
        if (!deviceId) {
            PosnicPro.alert('error', PosnicPro.i18n.t('lang_please_connect_whatsapp_first', 'Please connect WhatsApp first'));
            return;
        }
        
        if (!phoneNumber) {
            PosnicPro.alert('error', PosnicPro.i18n.t('lang_please_enter_phone_number', 'Please enter phone number'));
            return;
        }
        
        // Validate phone number format (digits only, min 10, max 15)
        if (!/^\d{10,15}$/.test(phoneNumber)) {
            PosnicPro.alert('error', 'Please enter valid phone number with country code (10-15 digits, no +)');
            return;
        }
        
        // Check if we should use template
        const selectedTemplate = $('#whatsapp_test_template').val();
        
        if (selectedTemplate) {
            // Send using template
            this.sendTemplateMessage(deviceId, phoneNumber, selectedTemplate);
        } else if (message) {
            // Send custom message
            this.sendCustomMessage(deviceId, phoneNumber, message);
        } else {
            PosnicPro.alert('error', PosnicPro.i18n.t('lang_please_enter_message_or_select_a_template', 'Please enter message or select a template'));
            return;
        }
    },

    /**
     * Send custom message
     */
    sendCustomMessage: function(deviceId, phoneNumber, message) {
        // Disable send button
        $('#whatsapp_send_btn').prop('disabled', true).html('<i class="feather icon-loader"></i> Sending...');
        
        const params = {
            url: 'whatsapp/sendMessage',
            data: {
                device_id: deviceId,
                phone_number: phoneNumber,
                message: message,
                branch_id: PosnicPro.local.get('branch_id_set')
            }
        };
        
        PosnicPro.post(params, (response) => {
            // Re-enable send button
            $('#whatsapp_send_btn').prop('disabled', false).html('<i class="feather icon-send mr-2"></i> Send Message');
            
            if (response.type === 'success') {
                this.showMessageResult('success', 'Message sent successfully!');
                this.clearMessageForm();
            } else {
                this.showMessageResult('error', response.message || 'Failed to send message');
            }
        });
    },

    /**
     * Send template message
     */
    sendTemplateMessage: function(deviceId, phoneNumber, templateId) {
        // Disable send button
        $('#whatsapp_send_btn').prop('disabled', true).html('<i class="feather icon-loader"></i> Sending...');
        
        const params = {
            url: 'whatsapp/sendMessage',
            data: {
                device_id: deviceId,
                phone_number: phoneNumber,
                template_id: templateId,
                branch_id: PosnicPro.local.get('branch_id_set')
            }
        };
        
        PosnicPro.post(params, (response) => {
            // Re-enable send button
            $('#whatsapp_send_btn').prop('disabled', false).html('<i class="feather icon-send mr-2"></i> Send Message');
            
            if (response.type === 'success') {
                this.showMessageResult('success', 'Template message sent successfully!');
                this.clearMessageForm();
            } else {
                this.showMessageResult('error', response.message || 'Failed to send template message');
            }
        });
    },
    
    /**
     * Clear message form
     */
    clearMessageForm: function() {
        $('#whatsapp_phone_number').val('');
        $('#whatsapp_message_text').val('');
        this.updateCharCount();
        this.hideMessageResult();
    },
    
    /**
     * Show message result
     */
    showMessageResult: function(type, message) {
        const alertClass = type === 'success' ? 'alert-success' : 'alert-danger';
        const icon = type === 'success' ? 'check-circle' : 'x-circle';
        
        $('#whatsapp_message_alert').html(`
            <div class="alert ${alertClass} alert-dismissible fade show" role="alert">
                <i class="feather icon-${icon} mr-2"></i>
                ${message}
                <button type="button" class="close" data-dismiss="alert" aria-label="Close" data-t-aria-label="lang_close_title">
                    <span aria-hidden="true">&times;</span>
                </button>
            </div>
        `);
        
        $('#whatsapp_message_result').show();
        
        // Auto-hide after 5 seconds for success messages
        if (type === 'success') {
            setTimeout(() => {
                this.hideMessageResult();
            }, 5000);
        }
    },
    
    /**
     * Hide message result
     */
    hideMessageResult: function() {
        $('#whatsapp_message_result').hide();
    },
    
    /**
     * Update character count
     */
    updateCharCount: function() {
        const message = $('#whatsapp_message_text').val();
        const charCount = message.length;
        const maxChars = 1000;
        
        $('#whatsapp_char_count').text(`${charCount} / ${maxChars} characters`);
        
        // Change color based on character count
        if (charCount > 900) {
            $('#whatsapp_char_count').removeClass('text-muted').addClass('text-warning');
        } else if (charCount >= maxChars) {
            $('#whatsapp_char_count').removeClass('text-muted text-warning').addClass('text-danger');
        } else {
            $('#whatsapp_char_count').removeClass('text-warning text-danger').addClass('text-muted');
        }
    },

    /**
     * Toggle WhatsApp receipt setting
     */
    toggleWhatsAppReceipt: function() {
        const checkbox = $('#whatsapp_receipt');
        const isEnabled = checkbox.is(':checked');
        
        // Disable checkbox during save
        checkbox.prop('disabled', true);
        
        const params = {
            url: 'settings/saveWhatsAppReceipt',
            data: {
                whatsapp_receipt: isEnabled ? 1 : 0
            }
        };
        
        PosnicPro.post(params, (response) => {
            // Re-enable checkbox
            checkbox.prop('disabled', false);
            
            if (response.type === 'success') {
                PosnicPro.alert('success', PosnicPro.i18n.t('lang_whatsapp_receipt_setting_saved', 'WhatsApp receipt setting saved'));
            } else {
                // Revert checkbox state if save failed
                checkbox.prop('checked', !isEnabled);
                PosnicPro.alert('error', response.message || 'Failed to save WhatsApp receipt setting');
            }
        });
    },

    /**
     * Load WhatsApp receipt setting
     */
    loadWhatsAppReceipt: function() {
        const params = {
            url: 'settings/getWhatsAppReceipt'
        };
        
        PosnicPro.get(params, (response) => {
            if (response.type === 'success' && response.data) {
                const isEnabled = response.data.whatsapp_receipt === 1;
                $('#whatsapp_receipt').prop('checked', isEnabled).prop('disabled', false);
            } else {
                // Enable checkbox even if loading fails
                $('#whatsapp_receipt').prop('disabled', false);
            }
        });
    },

    /**
     * Initialize on page load
     */
    init: function() {
        // Load saved device_id from backend
        this.loadDeviceId();
        
        // Setup character counting
        this.updateCharCount();
        this.loadTemplates();
    },

    /**
     * Load saved device_id from backend
     */
    loadDeviceId: function() {
        const branchId = PosnicPro.local.get('branch_id_set');
        if (!branchId) {
            console.log('No branch selected');
            return;
        }

        const params = {
            url: 'branches/getOneStore',
            data: 'id=' + branchId
        };

        PosnicPro.get(params, (response) => {
            if (response.type === 'success' && response.data) {
                const deviceId = response.data.whatsapp_device_id;
                if (deviceId) {
                    $('#whatsapp_device_id').val(deviceId);
                    this.deviceId = deviceId;
                    this.checkStatus(true);
                }
            }
        });
    },

    /**
     * Load all templates
     */
    loadTemplates: function() {
        const branchId = PosnicPro.local.get('branch_id_set');
        const params = {
            url: 'whatsapp/getTemplates',
            data: { branch_id: branchId }
        };

        PosnicPro.get(params, (response) => {
            if (response.type === 'success' && response.data) {
                // Store templates in object for later use
                this.templates = response.data;
                this.updateTemplatesTable(response.data);
                this.updateTemplateDropdown(response.data);
                console.log('Templates loaded:', response.data);
            } else {
                console.log('No templates found or error:', response);
                // Show empty state even on error
                this.templates = [];
                this.updateTemplatesTable([]);
                this.updateTemplateDropdown([]);
                
                // Show error message if it's an authentication issue
                if (response.message && response.message.includes('Branch ID')) {
                    console.error('Authentication issue - please ensure you are logged in');
                }
            }
        });
    },

    /**
     * Update templates table
     */
    updateTemplatesTable: function(templates) {
        const tbody = $('#whatsapp_templates_table tbody');
        tbody.empty();

        if (templates.length === 0) {
            tbody.append(`
                <tr>
                    <td colspan="4" class="text-center text-muted">
                        <i class="feather icon-inbox mr-2"></i>
                        No templates found. Add your first template above.
                    </td>
                </tr>
            `);
            return;
        }

        templates.forEach(template => {
            const createdDate = new Date(template.created_at).toLocaleDateString();
            const messagePreview = template.message.length > 50 ? 
                template.message.substring(0, 50) + '...' : 
                template.message;

            tbody.append(`
                <tr>
                    <td>${template.name}</td>
                    <td>${messagePreview}</td>
                    <td>${createdDate}</td>
                    <td>
                        <button type="button" class="btn btn-sm btn-outline-primary mr-1" onclick="PosnicPro.whatsapp.editTemplate('${template._id}')" aria-label="Edit" data-t-aria-label="lang_edit_title">
                            <i class="feather icon-edit"></i>
                        </button>
                        <button type="button" class="btn btn-sm btn-outline-danger" onclick="PosnicPro.whatsapp.deleteTemplate('${template._id}')" aria-label="Delete" data-t-aria-label="lang_delete">
                            <i class="feather icon-trash"></i>
                        </button>
                    </td>
                </tr>
            `);
        });
    },

    /**
     * Update template dropdown
     */
    updateTemplateDropdown: function(templates) {
        // Update test message template dropdown
        const testSelect = $('#whatsapp_test_template');
        testSelect.empty();
        testSelect.append('<option value="" data-t="lang_select_a_template">Select a template...</option>');

        templates.forEach(template => {
            testSelect.append(`<option value="${template._id}">${template.name}</option>`);
        });
    },

    /**
     * Load template content
     */
    loadTemplateContent: function(templateId) {
        const template = this.templates.find(t => t._id === templateId);
        if (template) {
            $('#whatsapp_message_text').val(template.message);
            this.updateCharCount();
        }
    },

    /**
     * Add new template
     */
    addTemplate: function() {
        // Show modal for adding template
        const modalHtml = `
            <div class="modal fade" id="whatsappTemplateModal" tabindex="-1" role="dialog">
                <div class="modal-dialog" role="document">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title"><lang class="lang_add_whatsapp_template">Add WhatsApp Template</lang></h5>
                            <button type="button" class="close" data-dismiss="modal">
                                <span>&times;</span>
                            </button>
                        </div>
                        <div class="modal-body">
                            <div class="form-group">
                                <label for="template_name">Template Name <span class="text-danger">*</span></label>
                                <input type="text" class="form-control" id="template_name" maxlength="100" required>
                            </div>
                            <div class="form-group">
                                <label for="template_type"><lang class="lang_template_type">Template Type</lang></label>
                                <select class="form-control" id="template_type" onchange="PosnicPro.whatsapp.setDefaultTemplateContent()">
                                    <option value="" data-t="lang_select_template_type">Select Template Type</option>
                                    <option value="sales_receipt" data-t="lang_sales_receipt_2">Sales Receipt</option>
                                    <option value="payment_reminder" data-t="lang_payment_reminder">Payment Reminder</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label for="template_message">Message <span class="text-danger">*</span></label>
                                <textarea class="form-control" id="template_message" rows="6" maxlength="1000" required></textarea>
                                <small class="form-text text-muted">
                                    Available variables for Sales Receipt templates:
                                    <br>{customer_name}, {sale_id}, {sale_date}, {total_amount}, {company_name}, {items_list}
                                </small>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-dismiss="modal"><lang class="lang_cancel_title">Cancel</lang></button>
                            <button type="button" class="btn btn-primary" onclick="PosnicPro.whatsapp.saveTemplate()"><lang class="lang_save_template">Save Template</lang></button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Remove existing modal if any
        $('#whatsappTemplateModal').remove();
        
        // Add modal to body
        $('body').append(modalHtml);
        
        // Show modal
        $('#whatsappTemplateModal').modal('show');
    },

    /**
     * Set default template content based on type
     */
    setDefaultTemplateContent: function() {
        const templateType = $('#template_type').val();
        const messageTextarea = $('#template_message');
        
        const defaultMessages = {
            'sales_receipt': 'Dear {customer_name},\n\nThank you for your purchase! 🛍️\n\n📋 Sale Details:\n• Sale ID: {sale_id}\n• Date: {sale_date}\n• Total: ₹{total_amount}\n\n{items_list}\n\nVisit again! 😊',
            'payment_reminder': 'Dear {customer_name},\n\nThis is a friendly reminder about your pending payment of ₹{total_amount} for Sale ID: {sale_id}.\n\nPlease make the payment at your earliest convenience.\n\nThank you!'
        };
        
        if (defaultMessages[templateType]) {
            messageTextarea.val(defaultMessages[templateType]);
        } else {
            messageTextarea.val('');
        }
    },

    /**
     * Save template
     */
    saveTemplate: function() {
        const name = $('#template_name').val().trim();
        const message = $('#template_message').val().trim();
        const templateType = $('#template_type').val();

        if (!name || !message) {
            PosnicPro.alert('error', PosnicPro.i18n.t('lang_enter_a_template_name_and_message', 'Enter a template name and message.'));
            return;
        }

        const branchId = PosnicPro.local.get('branch_id_set');
        const params = {
            url: 'whatsapp/saveTemplate',
            data: {
                name: name,
                message: message,
                template_type: templateType,
                branch_id: branchId
            }
        };

        PosnicPro.post(params, (response) => {
            if (response.type === 'success') {
                $('#whatsappTemplateModal').modal('hide');
                PosnicPro.alert('success', PosnicPro.i18n.t('lang_template_saved', 'Template saved'));
                this.loadTemplates(); // Reload templates
            } else {
                PosnicPro.alert('error', response.message);
            }
        });
    },

    /**
     * Edit template
     */
    editTemplate: function(templateId) {
        const template = this.templates.find(t => t._id === templateId);
        if (!template) {
            PosnicPro.alert('error', PosnicPro.i18n.t('lang_template_not_found', 'Template not found'));
            return;
        }

        // Show modal for editing template
        const modalHtml = `
            <div class="modal fade" id="whatsappTemplateModal" tabindex="-1" role="dialog">
                <div class="modal-dialog" role="document">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title"><lang class="lang_edit_whatsapp_template">Edit WhatsApp Template</lang></h5>
                            <button type="button" class="close" data-dismiss="modal">
                                <span>&times;</span>
                            </button>
                        </div>
                        <div class="modal-body">
                            <input type="hidden" id="template_id" value="${template._id}">
                            <div class="form-group">
                                <label for="template_name">Template Name <span class="text-danger">*</span></label>
                                <input type="text" class="form-control" id="template_name" value="${template.name}" maxlength="100" required>
                            </div>
                            <div class="form-group">
                                <label for="template_type"><lang class="lang_template_type">Template Type</lang></label>
                                <select class="form-control" id="template_type" onchange="PosnicPro.whatsapp.setDefaultTemplateContent()">
                                    <option value="" data-t="lang_select_template_type">Select Template Type</option>
                                    <option value="sales_receipt" ${template.template_type === 'sales_receipt' ? 'selected' : ''}>Sales Receipt</option>
                                    <option value="payment_reminder" ${template.template_type === 'payment_reminder' ? 'selected' : ''}>Payment Reminder</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label for="template_message">Message <span class="text-danger">*</span></label>
                                <textarea class="form-control" id="template_message" rows="6" maxlength="1000" required>${template.message}</textarea>
                                <small class="form-text text-muted">
                                    Available variables for Sales Receipt templates:
                                    <br>{customer_name}, {sale_id}, {sale_date}, {total_amount}, {company_name}, {items_list}
                                </small>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-dismiss="modal"><lang class="lang_cancel_title">Cancel</lang></button>
                            <button type="button" class="btn btn-primary" onclick="PosnicPro.whatsapp.updateTemplate()"><lang class="lang_update_template">Update Template</lang></button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Remove existing modal if any
        $('#whatsappTemplateModal').remove();
        
        // Add modal to body
        $('body').append(modalHtml);
        
        // Show modal
        $('#whatsappTemplateModal').modal('show');
    },

    /**
     * Update template
     */
    updateTemplate: function() {
        const templateId = $('#template_id').val();
        const name = $('#template_name').val().trim();
        const message = $('#template_message').val().trim();
        const templateType = $('#template_type').val();

        if (!name || !message) {
            PosnicPro.alert('error', PosnicPro.i18n.t('lang_enter_a_template_name_and_message', 'Enter a template name and message.'));
            return;
        }

        const params = {
            url: 'whatsapp/updateTemplate',
            data: {
                template_id: templateId,
                name: name,
                message: message,
                template_type: templateType
            }
        };

        PosnicPro.post(params, (response) => {
            if (response.type === 'success') {
                $('#whatsappTemplateModal').modal('hide');
                PosnicPro.alert('success', PosnicPro.i18n.t('lang_template_updated', 'Template updated'));
                this.loadTemplates(); // Reload templates
            } else {
                PosnicPro.alert('error', response.message);
            }
        });
    },

    /**
     * Delete template
     */
    deleteTemplate: function(templateId) {
        PosnicPro.callbackRegistry = {
            name: 'deleteTemplateData',
            arguments: templateId
        };
        
        // Force modal to show with proper Bootstrap styling
        const $modal = $('#whatsapp_delete_template_modal');
        
        // Remove any existing backdrop
        $('.modal-backdrop').remove();
        
        // Show modal with proper Bootstrap classes
        $modal.addClass('show').css({
            'display': 'block',
            'padding-right': '17px'
        });
        
        // Add backdrop
        $('<div class="modal-backdrop fade show"></div>').appendTo('body');
        
        // Add modal-open class to body
        $('body').addClass('modal-open').css('padding-right', '17px');
    },

    /**
     * Close delete modal
     */
    closeDeleteModal: function() {
        // Hide modal properly
        const $modal = $('#whatsapp_delete_template_modal');
        $modal.removeClass('show').css('display', 'none');
        
        // Remove backdrop
        $('.modal-backdrop').remove();
        
        // Remove modal-open class from body
        $('body').removeClass('modal-open').css('padding-right', '');
    },

    /**
     * Delete template confirmation
     */
    deleteTemplateConfirmed: function() {
        // Hide modal properly
        const $modal = $('#whatsapp_delete_template_modal');
        $modal.removeClass('show').css('display', 'none');
        
        // Remove backdrop
        $('.modal-backdrop').remove();
        
        // Remove modal-open class from body
        $('body').removeClass('modal-open').css('padding-right', '');
        
        PosnicPro.deleteConfirmation = true;
        window['PosnicPro']['whatsapp']['' + PosnicPro.callbackRegistry.name](PosnicPro.callbackRegistry.arguments);
    },

    /**
     * Delete template data
     */
    deleteTemplateData: function(templateId) {
        if (!PosnicPro.deleteConfirmation) {
            return;
        }
        PosnicPro.deleteConfirmation = false;

        const params = {
            url: 'whatsapp/deleteTemplate',
            data: {
                template_id: templateId
            }
        };

        PosnicPro.post(params, (response) => {
            if (response.type === 'success') {
                PosnicPro.alert('success', PosnicPro.i18n.t('lang_template_deleted', 'Template deleted'));
                this.loadTemplates(); // Reload templates
            } else {
                PosnicPro.alert('error', response.message);
            }
        });
    },

    /**
     * Get sales receipt template with data
     */
    getSalesReceiptTemplate: function(templateId, saleId, callback) {
        const params = {
            url: 'whatsapp/getSalesReceiptTemplate',
            data: {
                template_id: templateId,
                sale_id: saleId
            }
        };

        PosnicPro.post(params, (response) => {
            if (response.type === 'success') {
                callback(response.data);
            } else {
                PosnicPro.alert('error', response.message);
            }
        });
    },

    /**
     * Send test message
     */
    sendTestMessage: function() {
        const phoneNumber = $('#whatsapp_test_phone').val().trim();
        const message = $('#whatsapp_test_message').val().trim();
        const selectedTemplate = $('#whatsapp_test_template').val();

        if (!phoneNumber) {
            PosnicPro.alert('error', PosnicPro.i18n.t('lang_please_enter_a_phone_number', 'Please enter a phone number'));
            return;
        }

        // Check if we should use template
        if (selectedTemplate) {
            // Send using template
            this.sendTestTemplateMessage(phoneNumber, selectedTemplate);
        } else if (message) {
            // Send custom message
            this.sendTestCustomMessage(phoneNumber, message);
        } else {
            PosnicPro.alert('error', PosnicPro.i18n.t('lang_please_enter_message_or_select_a_template', 'Please enter message or select a template'));
            return;
        }
    },

    /**
     * Send test custom message
     */
    sendTestCustomMessage: function(phoneNumber, message) {
        $('#whatsapp_test_send_btn').prop('disabled', true).html('<i class="feather icon-loader"></i> Sending...');

        const params = {
            url: 'whatsapp/sendMessage',
            data: {
                phone_number: phoneNumber.replace(/\D/g, ''),
                message: message,
                branch_id: PosnicPro.local.get('branch_id_set')
            }
        };

        PosnicPro.post(params, (response) => {
            $('#whatsapp_test_send_btn').prop('disabled', false).html('<i class="feather icon-send mr-2"></i> Send Test Message');
            
            if (response.type === 'success') {
                PosnicPro.alert('success', PosnicPro.i18n.t('lang_test_message_sent', 'Test message sent'));
                this.clearTestForm();
            } else {
                PosnicPro.alert('error', response.message);
            }
        });
    },

    /**
     * Send test template message
     */
    sendTestTemplateMessage: function(phoneNumber, templateId) {
        $('#whatsapp_test_send_btn').prop('disabled', true).html('<i class="feather icon-loader"></i> Sending...');

        const params = {
            url: 'whatsapp/sendMessage',
            data: {
                phone_number: phoneNumber.replace(/\D/g, ''),
                template_id: templateId,
                branch_id: PosnicPro.local.get('branch_id_set')
            }
        };

        PosnicPro.post(params, (response) => {
            $('#whatsapp_test_send_btn').prop('disabled', false).html('<i class="feather icon-send mr-2"></i> Send Test Message');
            
            if (response.type === 'success') {
                PosnicPro.alert('success', PosnicPro.i18n.t('lang_test_template_message_sent_successfully', 'Test template message sent successfully!'));
                this.clearTestForm();
            } else {
                PosnicPro.alert('error', response.message);
            }
        });
    },

    /**
     * Clear test form
     */
    clearTestForm: function() {
        $('#whatsapp_test_phone').val('');
        $('#whatsapp_test_message').val('');
        $('#whatsapp_test_template').val('');
        this.updateTestCharCount();
    },

    /**
     * Update test message character count
     */
    updateTestCharCount: function() {
        const message = $('#whatsapp_test_message').val() || '';
        const count = message.length;
        $('#whatsapp_test_char_count').text(count + ' / 1000 characters');
    },

    /**
     * Update character count
     */
    updateCharCount: function() {
        const message = $('#whatsapp_message_text').val() || '';
        const count = message.length;
        $('#whatsapp_char_count').text(count + ' / 1000 characters');
    }
};

// Initialize when WhatsApp tab is shown (not on page load)
$(document).ready(function() {
    // Only initialize when WhatsApp tab is shown
    $('a[href="#v-pills-whatsapp"]').on('shown.bs.tab', function() {
        console.log('WhatsApp main tab shown, initializing...');
        PosnicPro.whatsapp.init();
        
        // Also check status after a short delay to ensure device ID is loaded
        setTimeout(() => {
            const deviceId = $('#whatsapp_device_id').val().trim();
            console.log('Checking WhatsApp status on tab switch, device ID:', deviceId);
            if (deviceId) {
                PosnicPro.whatsapp.checkStatus(true);
            }
        }, 1500);
    });
    
    // Handle WhatsApp sub-tab events
    $('#whatsappSubTabs a[data-toggle="tab"]').on('shown.bs.tab', function(e) {
        const target = $(e.target).attr('href');
        console.log('Tab switched to:', target);
        
        // Load templates when template tab is shown
        if (target === '#whatsapp-template') {
            console.log('Loading templates...');
            PosnicPro.whatsapp.loadTemplates();
        }
        
        // Check connection status when connection tab is shown
        if (target === '#whatsapp-connection') {
            console.log('WhatsApp connection sub-tab shown, checking status...');
            const deviceId = $('#whatsapp_device_id').val().trim();
            console.log('Device ID for status check:', deviceId);
            if (deviceId) {
                PosnicPro.whatsapp.checkStatus(true);
            } else {
                console.log('No device ID found, cannot check status');
            }
        }
    });
    
    // Character count update on typing
    $(document).on('input', '#whatsapp_message_text', function() {
        PosnicPro.whatsapp.updateCharCount();
    });
    
    // Test message character count
    $(document).on('input', '#whatsapp_test_message', function() {
        PosnicPro.whatsapp.updateTestCharCount();
    });
    
    // Load templates in test message dropdown
    $(document).on('change', '#whatsapp_test_template', function() {
        const templateId = $(this).val();
        if (templateId && PosnicPro.whatsapp.templates) {
            const template = PosnicPro.whatsapp.templates.find(t => t._id === templateId);
            if (template) {
                $('#whatsapp_test_message').val(template.message);
                PosnicPro.whatsapp.updateTestCharCount();
            }
        }
    });
    
    // WhatsApp receipt toggle
    $(document).on('change', '#whatsapp_receipt', function() {
        PosnicPro.whatsapp.toggleWhatsAppReceipt();
    });
});
